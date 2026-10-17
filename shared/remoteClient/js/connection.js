/* connection.js - the link to the Couatl Remote API. Classic script:
 * attaches window.createConnection.
 *
 * TWO TRANSPORTS, one interface. createConnection(handlers) always returns
 * { send, sendCommand, reconnectNow, isOpen } and always drives the same
 * handlers (onConnecting / onOpen / onClose / onMessage), so nothing else in
 * the client knows or cares which one is carrying it.
 *
 *   WebSocket  - legacy desktop Couatl, which owns a real socket. The page is
 *                served by GSX's own RemoteServer over HTTP on the SAME
 *                origin/port that serves the WebSocket, so we connect straight
 *                back to location.host. A plain GET returned this page; an
 *                Upgrade on the same URL becomes the WS. Zero config, unchanged.
 *
 *   CommBus    - MSFS2024 WASM, which has no sockets at all. The client ships
 *                as static files inside the EFB package and is loaded from
 *                coui://, so there is no origin to connect back to; the same
 *                protocol frames ride fsCommBus instead (wire format and the
 *                reasoning behind it: common/remoteServer.py _CommBusTransport).
 *
 * The pick is by CAPABILITY, not by sniffing the runtime: an http(s) origin
 * means a server served us, and therefore a WebSocket exists on it - which
 * keeps the desktop path byte-identical to what shipped before. Only a page
 * loaded from inside the package takes the CommBus rung.
 *
 * ES5-flavoured on purpose: this runs in MSFS Coherent, whose JS engine is not
 * a modern browser and does not even define globalThis. No arrow functions, no
 * let/const, no template literals, no optional chaining.
 */
(function () {
  "use strict";

  var SUBSCRIBE = { type: "subscribe", channels: ["state", "prompts", "toasts"] };

  /* --------------------------------------------------------------- WebSocket */

  // Match the BATC host: one connection, 8 s handshake timeout, 3 s retry.
  var RECONNECT_DELAY_MS = 3000, CONNECT_TIMEOUT_MS = 8000;

  function wsUrl() {
    var q = new URLSearchParams(location.search);
    var proto = (location.protocol === "https:") ? "wss:" : "ws:";
    if (q.get("host")) return proto + "//" + q.get("host") + ":" + (q.get("port") || "8744");
    if (location.host) {
      var port = q.get("port");
      return port ? (proto + "//" + location.hostname + ":" + port) : (proto + "//" + location.host + "/");
    }
    return "ws://127.0.0.1:" + (q.get("port") || "8744");   // file:// dev fallback
  }

  function createWsConnection(handlers) {
    var ws = null, retry = null, connectTimer = null, stopped = false;

    function release(sock) {
      if (!sock) return;
      sock.onopen = sock.onclose = sock.onerror = sock.onmessage = null;
      try { sock.close(); } catch (e) {}
    }
    function scheduleReconnect() {
      if (stopped || retry !== null) return;
      retry = setTimeout(function () {
        retry = null;
        open();
      }, RECONNECT_DELAY_MS);
    }
    function failed(sock) {
      // Late callbacks from a retired connection cannot alter the live one.
      if (stopped || ws !== sock) return;
      ws = null;
      clearTimeout(connectTimer); connectTimer = null;
      release(sock);
      scheduleReconnect();
      if (handlers.onClose) handlers.onClose();
    }
    function open() {
      // Focus/pageshow may fire repeatedly while the handshake is in flight.
      if (stopped || (ws && ws.readyState < 2)) return;
      clearTimeout(retry); retry = null;
      clearTimeout(connectTimer); connectTimer = null;
      var old = ws; ws = null; release(old);
      var sock;
      try { sock = new WebSocket(wsUrl()); }
      catch (e) {
        scheduleReconnect();
        if (handlers.onClose) handlers.onClose();
        return;
      }
      ws = sock;
      connectTimer = setTimeout(function () { failed(sock); }, CONNECT_TIMEOUT_MS);
      sock.onopen = function () {
        if (stopped || ws !== sock) return;
        clearTimeout(connectTimer); connectTimer = null;
        // Re-subscribe once; GSX provides a fresh snapshot for this connection.
        if (send(SUBSCRIBE) && handlers.onOpen) handlers.onOpen();
      };
      sock.onclose = function () { failed(sock); };
      sock.onerror = function () { failed(sock); }; // Does not rely on a later close event.
      sock.onmessage = function (e) {
        if (stopped || ws !== sock) return;
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (handlers.onMessage) handlers.onMessage(m);
      };
      if (handlers.onConnecting) handlers.onConnecting();
    }
    function send(obj) {
      var sock = ws;
      if (stopped || !sock || sock.readyState !== WebSocket.OPEN) return false;
      try { sock.send(JSON.stringify(obj)); return true; }
      catch (e) { failed(sock); return false; }
    }
    function sendCommand(verb, args) {
      // Never queue/replay service commands after reconnecting.
      return send(args ? { type: "command", verb: verb, args: args } : { type: "command", verb: verb });
    }
    function reconnectNow() {
      // Lifecycle events must not bypass the retry delay or duplicate a socket.
      if (stopped || retry !== null || (ws && ws.readyState < 2)) return;
      open();
    }
    function dispose() {
      stopped = true;
      clearTimeout(retry); retry = null;
      clearTimeout(connectTimer); connectTimer = null;
      var sock = ws; ws = null; release(sock);
    }
    window.addEventListener('beforeunload', dispose);
    open();
    return { send: send, sendCommand: sendCommand, reconnectNow: reconnectNow,
             isOpen: function () { return !!ws && ws.readyState === WebSocket.OPEN; } };
  }

  /* ----------------------------------------------------------------- CommBus */

  var CB_EVENT_FRAME = "GsxRemoteFrame";   // WASM -> JS, one envelope for everything
  var CB_EVENT_HELLO = "GsxRemoteHello";   // JS -> WASM, connect doorbell + keepalive
  var CB_EVENT_MSG = "GsxRemoteMsg";       // JS -> WASM, a protocol message
  var CB_EVENT_BYE = "GsxRemoteBye";       // JS -> WASM, clean close
  var CB_PROTOCOL_VERSION = 1;

  // HELLO is BOTH the connect doorbell and the keepalive: the engine expires a
  // client that has gone quiet for 15 s, so this must stay well under that.
  var CB_HELLO_MS = 5000;
  // The bus has no close event, so silence is the only death signal there is.
  // The engine pongs every HELLO from a client it knows, so hearing nothing
  // across several keepalives really does mean it is gone (or has forgotten us).
  var CB_DEAD_MS = 20000;
  var CB_WATCHDOG_MS = 2000;
  // If JS_LISTENER_COMM_BUS never invokes its ready callback, bind anyway.
  var CB_BIND_FALLBACK_MS = 2000;

  /**
   * Find RegisterViewListener. It is a global of the Coherent VIEW, so a client
   * running inside an <iframe> has none of its own - fall back to the parent,
   * which is same-origin when both come from the package. Wrapped in try/catch
   * because reaching across origins throws.
   */
  function viewListenerFactory() {
    if (typeof RegisterViewListener === "function") return RegisterViewListener;
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.RegisterViewListener === "function") {
        return window.parent.RegisterViewListener;
      }
    } catch (e) { /* cross-origin parent */ }
    return null;
  }

  function hasCommBus() { return !!viewListenerFactory(); }

  /** Per-load client id. The bus is a broadcast medium with no connection
   *  identity, so the CLIENT supplies one and stamps it on everything it says. */
  function newClientId() {
    return "efb-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function createCommBusConnection(handlers) {
    var clientId = newClientId();
    var listener = null, bound = false, isOpen = false;
    var boot = null, lastHeard = 0;
    var helloTimer = null, watchTimer = null;

    function post(event, payload) {
      if (!listener || typeof listener.call !== "function") return false;
      try {
        listener.call("COMM_BUS_WASM_CALLBACK", event, JSON.stringify(payload));
        return true;
      } catch (e) { return false; }
    }

    function hello() { post(CB_EVENT_HELLO, { v: CB_PROTOCOL_VERSION, client: clientId }); }

    function markOpen() {
      if (isOpen) return;
      // Set the flag BEFORE subscribing: send() refuses to write while closed,
      // exactly as the WebSocket path refuses while readyState isn't OPEN.
      isOpen = true;
      send(SUBSCRIBE);
      if (handlers.onOpen) handlers.onOpen();
    }

    function markClosed() {
      if (!isOpen) return;
      isOpen = false;
      if (handlers.onClose) handlers.onClose();
      // Deliberately keep the HELLO ticker running. There is no socket to
      // re-open, so recovery is just the engine answering again - when it comes
      // back, or when it has forgotten us and our next HELLO re-mints a session.
      if (handlers.onConnecting) handlers.onConnecting();
    }

    function onFrame(raw) {
      var env;
      try { env = (typeof raw === "string") ? JSON.parse(raw) : raw; }
      catch (e) { return; }
      if (!env) return;
      // Addressed to someone else: every surface on the bus sees every frame,
      // so this filter is what stops two of them crossing streams.
      if (env.client !== null && env.client !== undefined && env.client !== clientId) return;

      lastHeard = Date.now();

      // A new boot id is a different engine run (Restart Interpreter, or the
      // module reloaded): our session over there is gone, so drop to closed and
      // let this same frame re-open us, which re-subscribes.
      if (boot !== null && env.boot !== boot) {
        isOpen = false;
        if (handlers.onClose) handlers.onClose();
      }
      boot = env.boot;

      // Transport-level keepalive answer: carries no protocol frame and must
      // never reach the protocol layer above.
      if (env.pong) { markOpen(); return; }

      if (!isOpen) markOpen();
      if (env.frame && handlers.onMessage) handlers.onMessage(env.frame);
    }

    function bind(l) {
      if (bound || !l || typeof l.on !== "function") return;
      bound = true;
      listener = l;
      l.on(CB_EVENT_FRAME, onFrame);
      lastHeard = Date.now();   // don't let the watchdog fire before we've begun
      hello();
    }

    function start() {
      if (handlers.onConnecting) handlers.onConnecting();
      var factory = viewListenerFactory();
      if (!factory) return;
      var l = null;
      try {
        l = factory("JS_LISTENER_COMM_BUS", function () { bind(l); });
      } catch (e) { return; }
      // Belt and braces: if the ready callback never fires, bind to the object
      // we were handed anyway. bind() is idempotent, so a late callback is fine.
      setTimeout(function () { bind(l); }, CB_BIND_FALLBACK_MS);

      helloTimer = setInterval(hello, CB_HELLO_MS);
      watchTimer = setInterval(function () {
        if (isOpen && (Date.now() - lastHeard) > CB_DEAD_MS) markClosed();
      }, CB_WATCHDOG_MS);
    }

    function send(obj) {
      if (!isOpen) return false;
      return post(CB_EVENT_MSG, {
        v: CB_PROTOCOL_VERSION, client: clientId, body: JSON.stringify(obj)
      });
    }
    function sendCommand(verb, args) {
      return send(args ? { type: "command", verb: verb, args: args } : { type: "command", verb: verb });
    }
    function reconnectNow() {
      // No socket to re-open - just knock again, immediately.
      lastHeard = Date.now();
      hello();
    }

    // Best-effort clean close, so the engine drops the session at once instead
    // of waiting out its 15 s expiry.
    try {
      window.addEventListener("beforeunload", function () {
        post(CB_EVENT_BYE, { v: CB_PROTOCOL_VERSION, client: clientId });
      });
    } catch (e) { /* no window lifecycle here */ }

    start();
    return { send: send, sendCommand: sendCommand, reconnectNow: reconnectNow,
             isOpen: function () { return isOpen; } };
  }

  /* ------------------------------------------------------------------ ladder */

  function createConnection(handlers) {
    var params = new URLSearchParams(location.search);
    if (params.get("transport") === "ws") {
      return createWsConnection(handlers);
    }
    var proto = (typeof location !== "undefined" && location.protocol) || "";
    // Served over HTTP => a RemoteServer served us, so its WebSocket is on the
    // same origin. This is the desktop path, unchanged.
    if (proto === "http:" || proto === "https:") return createWsConnection(handlers);
    // Loaded from inside the package (coui://): no origin, no server, no socket.
    if (hasCommBus()) return createCommBusConnection(handlers);
    // A file:// dev opening, or a view with no CommBus: fall through to the
    // WebSocket's 127.0.0.1 fallback rather than failing outright.
    return createWsConnection(handlers);
  }

  window.createConnection = createConnection;
})();
