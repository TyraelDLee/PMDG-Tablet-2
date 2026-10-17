/* app.js - bootstrap. Classic script (loaded last). Wires connection -> store ->
 * the two surface renderers, and drives the connecting/offline/gsx-offline/live
 * overlay. No layout logic (CSS owns the responsive grid). */
(function () {
  "use strict";

  var store = createStore();
  var phase = "connecting";   // 'connecting' | 'connected' | 'offline'
  var toastTimer = null;
  // After the WS has been unreachable this long, nudge the user: GSX may not be
  // running, or the Remote control server may be disabled in GSX Settings (we
  // can't tell the two apart — disabling stops the server entirely). Keeps retrying.
  var notConnectedSince = null;
  var REMOTE_HINT_MS = 12000;
  var REMOTE_HINT = "Can't reach GSX. If GSX is running, enable the Remote control server in GSX Settings.";
  // Hosted in the MSFS EFB (Coherent), a WebSocket that died with a Couatl
  // restart can fail every reconnect ("Couldn't connect to server") even once
  // the server is back, until the page itself is reloaded — the EFB then sat on
  // "Restarting GSX, please wait..." until the app was restarted. After this
  // long without a connection we ask the host to reload the frame (a plain
  // browser has no host and simply keeps retrying).
  var STUCK_RELOAD_MS = 20000;
  var stuckReported = false;

  var conn = createConnection({
    onConnecting: function () { phase = "connecting"; updateOverlay(); },
    onOpen: function () { /* still 'connecting' until the first snapshot arrives */ },
    onClose: function () { phase = "offline"; store.setDisconnected(); updateOverlay(); },
    onMessage: function (m) {
      if (m && m.type === "result" && m.ok === false) flashError(m.error);
      store.apply(m);
    },
  });

  // GSX owns menu visibility and workflow timing.
  // Open only via the blue menu button; render automatic menus from server state.


  Menu.setContext({ sendCommand: conn.sendCommand, getState: store.get });
  Settings.setContext({ sendCommand: conn.sendCommand, getState: store.get });
  Prompt.setContext({ sendCommand: conn.sendCommand, getState: store.get });

  store.subscribe(function (state, meta) {
    if (meta.connected) phase = "connected";
    updateOverlay();
    Menu.render(state, meta);
    Status.render(state, meta);
    Settings.render(state, meta);
    Prompt.render(state, meta);
  });

  // Couatl startup/restart progress bars, rendered into #menuSurface while booting
  // (the same the in-game panel shows from the COUATL_STARTED_*_PROGRESS LVars,
  // here from state.startup). Like the panel: rows ACCUMULATE in index order and
  // are never removed mid-session, each step is MONOTONIC (never regresses) and
  // LOCKS at 100 ("Done", green). Rows are patched in place (only the fill width /
  // percent change) so the CSS width transition animates smoothly - and never
  // moved, since moving a DOM node restarts its transition (snap instead of fill).
  // The whole list is cleared only on a fresh snapshot (a new connection / boot).
  var progressRows = {};
  var lastSid = null;            // engine session id; bars cleared only when it changes
  var wasBooting = false;        // for the boot-complete edge (clears the restart flag)
  function insertRowInOrder(el, idx, row) {
    var next = null, bestIdx = Infinity;
    for (var k in progressRows) {                  // first already-placed row with a higher index
      var ki = +k, pr = progressRows[k];
      if (ki > idx && ki < bestIdx && pr.row.parentNode === el) { bestIdx = ki; next = pr.row; }
    }
    el.insertBefore(row, next);                    // next === null -> append at end
  }
  function clearProgress() {
    var el = document.getElementById("progress-bars");
    if (el) el.textContent = "";
    progressRows = {};
  }
  // Build (once) the startup panel inside #menuSurface and keep it patched. We
  // APPEND it rather than wiping the surface, so a #statusSurface that the EFB
  // parked inside #menuSurface (closed-menu fill) is preserved; the .has-startup
  // class hides the leftover menu content. menu.js yields the surface while
  // booting and rebuilds it (rescuing the status) once boot ends.
  function renderBootSurface(startup, restarting) {
    var root = document.getElementById("menuSurface");
    if (!root) return;
    root.classList.add("has-startup");
    var wrap = document.getElementById("startupWrap");
    if (!wrap || wrap.parentNode !== root) {
      wrap = document.createElement("div"); wrap.id = "startupWrap"; wrap.className = "startup-progress";
      var title = document.createElement("div"); title.id = "progress-title"; title.className = "progress-title";
      var bars = document.createElement("div"); bars.id = "progress-bars"; bars.className = "progress-bars";
      wrap.appendChild(title); wrap.appendChild(bars);
      root.appendChild(wrap);
      progressRows = {};
    }
    document.getElementById("progress-title").textContent = (restarting ? "Restarting GSX" : "Starting GSX") + "…";
    renderProgress(startup.bars);
  }
  function renderProgress(bars) {
    var el = document.getElementById("progress-bars");
    if (!el || !bars) return;
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      var pct = Math.max(0, Math.min(100, b.progress | 0));
      var r = progressRows[b.i];
      if (!r) {
        var row = document.createElement("div"); row.className = "progress-row";
        var label = document.createElement("div"); label.className = "progress-label";
        var percent = document.createElement("div"); percent.className = "progress-percent";
        var track = document.createElement("div"); track.className = "progress-track";
        var fill = document.createElement("div"); fill.className = "progress-fill";
        track.appendChild(fill);
        row.appendChild(label); row.appendChild(percent); row.appendChild(track);
        insertRowInOrder(el, b.i, row);            // place once, in index order
        r = progressRows[b.i] = { row: row, fill: fill, percent: percent, label: label, shown: -1, done: false };
      }
      if (b.label) r.label.textContent = b.label;
      if (r.done || pct < r.shown) continue;       // locked at 100 / never regress
      r.shown = pct;
      r.fill.style.width = pct + "%";               // animates via the CSS width transition
      if (pct >= 100) { r.fill.className = "progress-fill done"; r.percent.textContent = "Done"; r.done = true; }
      else { r.percent.textContent = pct + "%"; }
    }
  }

  // Ask the host (the EFB app) to reload this frame once the WS has been down
  // for STUCK_RELOAD_MS. Called from updateOverlay AND on a timer: the check
  // used to run only on connection events, and when the reconnect loop itself
  // stalled (a socket that never settled - see connection.js) there were no
  // more events, so the report never went out and the EFB sat on "Restarting
  // GSX, please wait..." until the app was restarted by hand.
  function reportStuckIfNeeded() {
    if (notConnectedSince !== null && !stuckReported && window.parent !== window
        && (Date.now() - notConnectedSince) > STUCK_RELOAD_MS) {
      stuckReported = true;
      try { window.parent.postMessage({ type: "gsx-client-stuck" }, "*"); } catch (e) { /* host gone */ }
    }
  }
  setInterval(reportStuckIfNeeded, 5000);

  function updateOverlay() {
    var overlay = document.getElementById("overlay");
    var msgEl = document.getElementById("overlay-msg");
    var st, text;
    var connected = store.isConnected(), gsx = store.isGsxRunning();
    var startup = (store.get() || {}).startup || {};
    // Clear the accumulated bar list ONLY when the engine's session id changes (a
    // new process / restart) - never on a reconnect or a `booting` flicker. Within
    // a session the bars then only accumulate, exactly like the in-game panel.
    if (startup.sid != null && startup.sid !== lastSid) { lastSid = startup.sid; clearProgress(); }
    // `active` is true from boot start until the engine's startup work goes quiet
    // (latched), mirroring the panel keeping its loading screen until the menu
    // loads. As soon as a RESTART is selected (and through the whole boot) we BLANK
    // everything except the restart UI - no dimming, no stale controls. The blank
    // ends only when boot completes (booting -> false), at which point the restart
    // is over.
    var booting = connected && !!startup.active, restarting = store.isRestarting();
    if (wasBooting && !booting) store.clearRestarting();   // boot finished -> restart is over
    wasBooting = booting;
    var blank = booting || store.isRestarting();           // re-read: clearRestarting may have flipped it
    document.body.classList.toggle("booting", blank);      // set BEFORE Menu.render (it yields the surface)
    var menuRoot = document.getElementById("menuSurface");
    if (blank) {
      if (menuRoot) menuRoot.classList.add("has-startup");  // blank the menu surface (bars-only or empty)
      if (booting) renderBootSurface(startup, restarting);  // ...and fill it with the live bars
    } else if (menuRoot) {
      menuRoot.classList.remove("has-startup");             // menu.js rebuilds the surface
    }

    // Track how long the WS has been down (connecting/offline), for the hint below.
    if (phase === "connected") { notConnectedSince = null; stuckReported = false; }
    else if (notConnectedSince === null) notConnectedSince = Date.now();
    var remoteStuck = notConnectedSince !== null && (Date.now() - notConnectedSince) > REMOTE_HINT_MS;
    reportStuckIfNeeded();

    if (booting)                             { st = "booting";    text = ""; }   // bars live in the menu surface
    else if (blank)                          { st = "restarting"; text = "Restarting GSX, please wait..."; }
    else if (phase === "connected" && gsx)   { st = "live";       text = ""; }
    else if (phase === "connected" && !gsx)  { st = "gsx-offline"; text = "Waiting for GSX (sim not ready)..."; }
    else if (phase === "connecting")         { st = "connecting";  text = connected ? "Loading..." : (remoteStuck ? REMOTE_HINT : "Connecting to GSX..."); }
    else                                     { st = "offline";     text = remoteStuck ? REMOTE_HINT : "GSX Remote is offline. Retrying..."; }
    if (overlay) overlay.dataset.state = st;        // CSS hides the overlay for "booting" and "live"
    if (msgEl && text) msgEl.textContent = text;
    document.body.dataset.conn = (st === "live") ? "live" : (st === "booting" ? "booting" : "down");
  }

  function flashError(err) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = (err && (err.message || err.code)) || "Command failed";
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }

  // iOS suspends sockets when backgrounded, sometimes with no close - re-kick on return.
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") conn.reconnectNow(); });
  window.addEventListener("pageshow", function () { conn.reconnectNow(); });
  window.addEventListener("focus", function () { conn.reconnectNow(); });

  updateOverlay();   // initial "Connecting..."

  // Tell the EFB host we loaded. The host retries the iframe load until this
  // arrives, because the GSX HTTP server may not be up when the app first opens
  // (engine not started yet) - the page GET fails and there's no JS to retry. A
  // successful page load means the server IS up, so this fires right away.
  // Embedded (EFB) only; a browser/device has no parent to tell.
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "gsx-client-ready" }, "*");
    }
  } catch (e) { /* no host */ }
})();
