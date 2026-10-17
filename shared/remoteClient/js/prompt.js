/* prompt.js - the modal text-input prompt surface.
 *
 * GSX asks for free text during a menu flow (Save / Rename Location, custom
 * values, ...) via common.jsBridge.requestTextInput. The server projects the
 * live request as state.prompt = { kind:"text", gen, title, description,
 * default, maxLength } (or null). We render a modal over it and answer as a
 * PEER of the in-game panel: input.submit{gen,text} / input.cancel{gen}. `gen`
 * matches our answer to the request the server is currently waiting on, so a
 * stale answer is ignored on both sides.
 *
 * No LVar/encoding work here - the text rides the JSON socket as-is. The <input>
 * comes from the shared GsxInput helper, so EFB sim-input masking is automatic.
 *
 * Classic script: window.Prompt = { render, setContext }.
 */
(function () {
  "use strict";

  var CTX = { sendCommand: function () {}, getState: function () { return {}; } };
  var overlay = null, titleEl = null, descEl = null, wrapEl = null, input = null;
  var currentGen = null;     // gen of the prompt currently shown
  var answeredGen = null;    // gen we just answered (ignore its lingering snapshot)

  function h(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (kids) { if (!Array.isArray(kids)) kids = [kids];
      for (var i = 0; i < kids.length; i++) { var c = kids[i]; if (c == null) continue;
        e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); } }
    return e;
  }

  function ensureDom() {
    if (overlay) return;
    overlay = h("div", { id: "promptOverlay", "class": "prompt-overlay", hidden: "" }, [
      h("div", { "class": "prompt-card" }, [
        titleEl = h("div", { "class": "prompt-title" }),
        descEl  = h("div", { "class": "prompt-desc" }),
        wrapEl  = h("div", { "class": "prompt-input-wrap" }),
        h("div", { "class": "prompt-actions" }, [
          h("button", { "class": "prompt-btn prompt-cancel", type: "button", onclick: doCancel }, "Cancel"),
          h("button", { "class": "prompt-btn prompt-ok", type: "button", onclick: doOK }, "OK")
        ])
      ])
    ]);
    document.body.appendChild(overlay);
  }

  function doOK() {
    if (currentGen == null) return;
    CTX.sendCommand("input.submit", { gen: currentGen, text: input ? input.value : "" });
    answeredGen = currentGen;
    close();   // optimistic; the cleared state.prompt keeps us closed
  }
  function doCancel() {
    if (currentGen == null) return;
    CTX.sendCommand("input.cancel", { gen: currentGen });
    answeredGen = currentGen;
    close();
  }

  function open(p) {
    ensureDom();
    currentGen = p.gen;
    titleEl.textContent = p.title || "";
    descEl.textContent = p.description || "";
    descEl.style.display = p.description ? "" : "none";
    wrapEl.textContent = "";
    input = GsxInput.create({
      "className": "prompt-input",
      value: p.default || "",
      maxLength: p.maxLength || 64,
      onEnter: doOK,
      onEscape: doCancel
    });
    wrapEl.appendChild(input);
    overlay.hidden = false;
    // Defer focus/select until the modal has painted.
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 0);
  }

  function close() {
    // Release the sim-input mask before the input is removed - hiding/removing a
    // focused field doesn't reliably fire `blur`, which would leave the sim masked.
    if (input) {
      try { input.blur(); } catch (e) {}
      if (window.GsxInput && GsxInput.releaseMask) GsxInput.releaseMask(input);
    }
    currentGen = null;
    input = null;
    if (overlay) { overlay.hidden = true; if (wrapEl) wrapEl.textContent = ""; }
  }

  function render(state, meta) {
    // No server -> nothing can be answered; drop the modal (it would otherwise sit
    // above the offline overlay). On reconnect the snapshot re-raises it if pending.
    if (meta && meta.connected === false) { close(); return; }
    var p = state && state.prompt;
    if (!p || p.kind !== "text" || p.gen === answeredGen) { close(); return; }
    if (p.gen === currentGen) return;   // already showing this exact request
    open(p);
  }

  window.Prompt = {
    render: render,
    setContext: function (ctx) { CTX = ctx || CTX; }
  };
})();
