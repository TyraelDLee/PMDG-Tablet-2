/* store.js - a dumb, flat mirror of GSX's state. Classic script: window.createStore.
 *
 * The snapshot is FLAT: its top-level keys (menu, menuShown, message, simbrief,
 * commandIcons, statusHtml, services, ...) ARE the model. snapshot seeds the whole
 * thing; patch replaces one top-level key (state[path.slice(1)] = value; null
 * drops). Never deep-merge. */
(function () {
  "use strict";

  function createStore() {
    var state = {};
    var connected = false;     // socket open AND a snapshot received
    var gsxRunning = false;    // from hello / engine event
    var restarting = false;    // engine restart in progress (kept across the reconnect)
    var subs = [];
    var _sawStartupEvent = false;   // a streamed `startup` event has arrived -> the
                                    // stream owns state.startup (see snapshot handler)

    // Coalesce renders into ONE per animation frame. During boot, common streams
    // a `startup` event on every progress-bar tick — hundreds per second, dozens
    // within a single frame — and each one used to run a full synchronous render
    // pass (Menu + Status + Settings + overlay). That render STORM is what flickers
    // the boot bars / status surface. Batching to one render per frame (latest
    // state wins) collapses the storm; it also smooths any other rapid patch burst.
    // apply() still mutates state synchronously, so reads are always current; only
    // the render is deferred (<=1 frame).
    var _raf = (typeof requestAnimationFrame === "function")
      ? requestAnimationFrame : function (cb) { return setTimeout(cb, 16); };
    var _renderPending = false;
    var _pendingReason = null;
    function _flush() {
      _renderPending = false;
      var reason = _pendingReason; _pendingReason = null;
      for (var i = 0; i < subs.length; i++) {
        try { subs[i](state, { connected: connected, gsxRunning: gsxRunning, restarting: restarting, reason: reason }); }
        catch (e) { console.error(e); }
      }
    }
    function notify(reason) {
      _pendingReason = reason;
      if (_renderPending) return;
      _renderPending = true;
      _raf(_flush);
    }

    function apply(msg) {
      if (!msg) return;
      switch (msg.type) {
        case "hello":
          gsxRunning = !!msg.gsxRunning;
          if (gsxRunning) restarting = false;   // engine is up -> restart is over
          notify("hello"); break;
        case "snapshot": {
          var next = {};
          for (var k in msg) if (k !== "v" && k !== "type" && k !== "ts" && k !== "id") next[k] = msg[k];
          // `startup` ownership: the streamed `startup` events are the
          // authoritative, high-frequency boot progress. A snapshot also carries
          // `startup` (GSX's couatlStartupModel) which can DISAGREE mid-boot
          // (e.g. active=false while the stream says active=true) and would flip
          // the boot surface off->on = the bars<->status flash. So once any stream
          // event has arrived, the stream owns it and a snapshot never touches
          // startup; before that, take the snapshot's startup as a seed (a client
          // connecting mid-boot), and keep what we have if the snapshot omits it.
          if (_sawStartupEvent && state.startup !== undefined) next.startup = state.startup;
          else if (next.startup === undefined && state.startup !== undefined) next.startup = state.startup;
          // Don't clear `restarting` here: the engine event / hello clears it once
          // GSX is actually up; the streaming `startup` bars carry the UX until then.
          state = next; connected = true;
          notify("snapshot"); break;
        }
        case "patch": {
          var key = String(msg.path).slice(1);
          if (msg.value === null || msg.value === undefined) delete state[key];
          else state[key] = msg.value;
          notify("patch:" + key); break;
        }
        case "event":
          if (msg.topic === "engine") {
            gsxRunning = !!msg.gsxRunning;
            if (msg.restarting) restarting = true;        // pre-restart signal (before the socket drops)
            else if (gsxRunning) restarting = false;      // engine back up -> restart is over
            notify("engine");
          } else if (msg.topic === "startup") {
            // Live boot/restart progress, streamed straight from common as each
            // bar changes (faster than the snapshot tick). Mirror into state.
            // The stream now owns state.startup (snapshots stop touching it).
            _sawStartupEvent = true;
            state.startup = msg.model || { active: false, bars: [] };
            notify("startup");
          }
          break;   // "menu" topic is a hint; content arrives via patch /menu
        // "result": fire-and-forget; app.js handles error toasts.
      }
    }

    function setDisconnected() {
      if (!connected) return;
      connected = false; gsxRunning = false; notify("disconnected");
    }

    return {
      apply: apply, setDisconnected: setDisconnected,
      get: function () { return state; },
      subscribe: function (fn) { subs.push(fn); },
      isConnected: function () { return connected; },
      isGsxRunning: function () { return gsxRunning; },
      isRestarting: function () { return restarting; },
      clearRestarting: function () { restarting = false; },
    };
  }

  window.createStore = createStore;
})();
