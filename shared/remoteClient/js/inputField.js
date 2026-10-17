/* inputField.js - shared editable text-field helper for the GSX Remote client.
 *
 * One place that creates an <input>, so the modal prompt (prompt.js) and the
 * settings text fields (settings.js) behave identically and - crucially - both
 * get sim-input MASKING for free.
 *
 * Masking: when this client runs INSIDE the EFB it lives in a cross-origin
 * http iframe with no `Coherent` global of its own, yet typed characters would
 * still reach MSFS's key pump and fire sim bindings. So on focus/blur we
 * postMessage the EFB host app (GSX_EFB.tsx), which calls
 * Coherent.trigger("FOCUS_INPUT_FIELD"/"UNFOCUS_INPUT_FIELD"). On a browser or a
 * separate device the page isn't embedded and the sim never sees the keys, so
 * the bridge is a no-op there - no masking code path runs at all.
 *
 * Classic script: window.GsxInput = { create, bindMasking, embedded }.
 */
(function () {
  "use strict";

  // Embedded == hosted in an iframe (the EFB). A plain browser/standalone tab
  // has window.parent === window. Wrapped in try/catch for the (cross-origin)
  // access, defaulting to "not embedded" so the web path never masks.
  var embedded = false;
  try { embedded = !!(window.parent && window.parent !== window); } catch (e) { embedded = false; }

  function postHost(type) {
    if (!embedded) return;                         // web / standalone: nothing to mask
    try { window.parent.postMessage({ type: type }, "*"); } catch (e) { /* host gone */ }
  }

  // Resolve a Coherent global if it's injected into THIS frame. Some EFB configs
  // expose it to the hosted iframe; `typeof` guard so a plain browser (where it's
  // undeclared) doesn't throw.
  function coherent() {
    try {
      if (typeof Coherent !== "undefined" && Coherent && Coherent.trigger) return Coherent;
    } catch (e) { /* not declared */ }
    return (window.Coherent && window.Coherent.trigger) ? window.Coherent : null;
  }

  // The <input> currently holding the sim-input mask, or null. Tracked so a
  // release only fires for the input that engaged it (focus moving between two
  // fields doesn't drop the mask spuriously), and so an explicit release on
  // teardown can't tear down a DIFFERENT field's mask.
  var maskedInput = null;

  // Fire FOCUS_INPUT_FIELD / UNFOCUS_INPUT_FIELD both ways: directly if Coherent
  // reaches this frame, and via the postMessage bridge to the EFB host.
  function trigger(focus) {
    var C = coherent();
    if (C) {
      try {
        if (focus) C.trigger("FOCUS_INPUT_FIELD", "gsxRemoteInput", "", "", "", false);
        else C.trigger("UNFOCUS_INPUT_FIELD", "gsxRemoteInput");
      } catch (e) { /* ignore */ }
    }
    postHost(focus ? "gsx-input-focus" : "gsx-input-blur");
  }

  function maskOn(input) { maskedInput = input; trigger(true); }
  function maskOff(input) {
    // input == null -> forced release of whatever holds the mask. Otherwise only
    // release if THIS input is the holder.
    if (input == null || maskedInput === input) {
      if (maskedInput != null) trigger(false);
      maskedInput = null;
    }
  }

  // SAFETY NETS - a missed release is catastrophic: FOCUS_INPUT_FIELD is sim-side
  // state, so a stuck mask survives a Couatl/iframe restart and swallows ALL sim
  // input until the sim is restarted. These guarantee the mask can never stay on
  // after the field is gone, even if `blur` never fired:
  //  - WATCHDOG: the moment the masked input leaves the DOM (a focused field
  //    removed on close/re-render is the main failure mode), release. This check
  //    only fires when the input is genuinely detached, so it never false-releases
  //    while the user is typing into a connected, focused field.
  //  - release when the page is hidden (EFB panel closed / app suspended).
  try {
    setInterval(function () {
      if (maskedInput != null && !document.contains(maskedInput)) maskOff(maskedInput);
    }, 1000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) maskOff(maskedInput);
    }, false);
  } catch (e) { /* environment without setInterval/visibility - explicit releases still apply */ }

  // Wire sim-input masking onto an existing <input> (EFB only in effect).
  function bindMasking(input) {
    input.addEventListener("focus", function () { maskOn(input); });
    input.addEventListener("blur", function () { maskOff(input); });
    return input;
  }

  // Force-release the mask held by `input` (or whatever holds it, if omitted).
  // MUST be called when destroying a possibly-focused field: removing a focused
  // element from the DOM does NOT reliably fire `blur`, so without this the sim
  // would stay masked and the user would lose all sim input.
  function releaseMask(input) { maskOff(input); }   // no arg -> force release; with arg -> owner release

  // Create a text <input> with masking + Enter/Escape handling.
  // opts: { value, maxLength, placeholder, className,
  //         onCommit(value)  - fired on `change` (blur / committed edit),
  //         onInput(value)   - fired on EVERY keystroke (streaming, e.g. search),
  //         onEnter()        - Enter pressed (default: blur -> commits),
  //         onEscape() }     - Escape pressed (default: blur -> commits).
  function create(opts) {
    opts = opts || {};
    var input = document.createElement("input");
    input.type = "text";
    if (opts.className) input.className = opts.className;
    input.value = opts.value == null ? "" : String(opts.value);
    if (opts.maxLength) input.maxLength = opts.maxLength;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    bindMasking(input);
    input.addEventListener("keydown", function (e) {
      var enter = (e.keyCode === 13 || e.key === "Enter");
      var esc   = (e.keyCode === 27 || e.key === "Escape");
      if (!enter && !esc) return;
      // Stop the host menu/hotkey handlers from also seeing Enter/Escape.
      e.preventDefault(); e.stopPropagation();
      if (enter && opts.onEnter) opts.onEnter();
      else if (esc && opts.onEscape) opts.onEscape();
      else input.blur();                           // default: commit-on-Enter/Escape
    });
    if (opts.onCommit) input.addEventListener("change", function () { opts.onCommit(input.value); });
    if (opts.onInput) input.addEventListener("input", function () { opts.onInput(input.value); });
    return input;
  }

  window.GsxInput = { create: create, bindMasking: bindMasking, releaseMask: releaseMask, embedded: embedded };
})();
