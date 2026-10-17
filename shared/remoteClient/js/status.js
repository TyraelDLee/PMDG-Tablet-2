/* status.js - the STATUS surface. Classic script: window.Status.
 *
 * Displays GSX's idle status page AS GSX PROVIDES IT: the server sends `statusHtml`
 * (a self-contained fragment GSX builds for its own panel) and we inject it
 * verbatim. The client holds ZERO status semantics - it never parses, branches on,
 * or composes the status. Styling of GSX's fixed structural classes is in shell.css. */
(function () {
  "use strict";

  var lastHtml = null;

  function renderStatus(state, meta) {
    var panel = document.getElementById("statusSurface");
    if (!panel) return;
    var html = (meta.connected && meta.gsxRunning) ? (state.statusHtml || "") : "";
    if (html === lastHtml) return;     // coarse patches resend the whole key; skip no-op repaints
    lastHtml = html;
    // GSX-authored, html.escaped, script-free fragment from the same trusted origin;
    // a <script> set via innerHTML does not execute. Inject as-is.
    panel.innerHTML = html;
  }

  window.Status = { render: renderStatus };
})();
