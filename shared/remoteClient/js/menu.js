/* menu.js - the MENU surface: a THIN, GENERIC, index-based mirror of the live GSX
 * menu, exactly like the Stream Deck plugin's menu-option keys. Classic script:
 * window.Menu = { render, setContext }.
 *
 * For every option index i it has three server-supplied facts and one index-only
 * action: entries[i] (label, verbatim) + icons[i] (a PNG data URI GSX supplies, or
 * "") + disabled[i] (greyed), and on tap -> menu.pick{index:i}.
 *
 * It reads NO services array, recognizes NO ids/names, ships NO art, maps NO state
 * to colour, synthesizes NO shortcuts. The ONLY a-priori knowledge is the four
 * static command.run ids (which never change). */
(function () {
  "use strict";

  // Mirrors the real GSX commands menu order: Settings is the 3rd command,
  // right before Restart Couatl. SETTINGS is special - it opens the settings
  // form (settings.js) rather than running a command.run; it only appears when
  // GSX advertises a settings schema (`s.settings`). SimBrief follows on its
  // own full-width row (see simbriefBtn / .cmd--wide).
  var STATIC_COMMANDS = [
    { id: "CUSTOMIZE_AIRPORT_POSITION", label: "Customize Airport" },
    { id: "CUSTOMIZE_AIRPLANE",         label: "Customize Aircraft" },
    { id: "SETTINGS",                   label: "Settings", settings: true },
    { id: "RESTART_COUATL",             label: "Restart Couatl", confirm: true },
  ];
  var SB_TIMEOUT_MS = 30000;

  var CTX = { sendCommand: function () {}, getState: function () { return {}; } };
  var lastSig = null;
  var rendering = false;
  var searchBox = null;          // persistent live-search box element (survives re-renders)
  var searchSession = null;      // active search session id (rebuild the box on change)
  var pendingSearchFocus = false;
  var searchSuppressed = false;  // hide the box NOW (title clicked) before the server confirms

  // Release the sim-input mask the search box held. Removing a focused input
  // doesn't reliably fire `blur` (so UNFOCUS would be missed and the sim would
  // stay masked) - blur it AND force the release.
  function releaseSearchMask(box) {
    if (!window.GsxInput || !GsxInput.releaseMask) return;
    var si = box && box.querySelector ? box.querySelector("input") : null;
    if (si) { try { si.blur(); } catch (e) {} GsxInput.releaseMask(si); }
    else GsxInput.releaseMask();
  }

  // Drop the search box instantly (don't wait for the menu.close round-trip to
  // clear state.search). Suppressed until the server confirms the session ended.
  function closeSearchNow() {
    searchSuppressed = true;
    releaseSearchMask(searchBox);
    if (searchBox && searchBox.parentNode) searchBox.parentNode.removeChild(searchBox);
    searchBox = null; searchSession = null;
  }
  var armed = null, armedTimer = null;
  var sb = { active: false, gen: -1 }, sbTimer = null;
  var seenReceiptKey = null;   // the invoice already opened in-browser (notification consumed)

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
  function cmd(verb, args) { CTX.sendCommand(verb, args); }

  // ---- Menu fit (portrait) --------------------------------------------------
  // Fit the WHOLE top area (header + entries + Open/Close + commands) into one
  // screen by sizing the entries to the space left after the chrome - same idea
  // for the T9 grid and the rich list. JS supplies ONLY reliable px box metrics:
  //   rows   = number of entry rows
  //   chrome = app top-padding + everything in the surface that ISN'T the entries
  // CSS does the fit with 100lvh (see shell.css), which the browser computes
  // correctly (iOS toolbar / safe areas) - JS viewport APIs do NOT agree across
  // iOS Safari / Chrome. T9 cells keep their 1.6:1 aspect; list rows get a height
  // capped to a normal max and floored so a very long list still page-scrolls.
  var sizeRAF = 0;
  function scheduleFit() {
    if (sizeRAF) return;
    sizeRAF = (window.requestAnimationFrame || setTimeout)(function () {
      sizeRAF = 0; sizeMenuFit();
    });
  }
  function sizeMenuFit() {
    var surface = document.getElementById("menuSurface");
    if (!surface) return;
    var grid = surface.querySelector(".menu-grid");
    var list = surface.querySelector(".menu-list");
    var el = grid || list;
    if (!el) return;
    var rowsVar   = grid ? "--t9-rows"   : "--list-rows";
    var chromeVar = grid ? "--t9-chrome" : "--list-chrome";
    var availVar  = grid ? "--t9-avail"  : "--list-avail";
    var count = el.children.length;
    if (!count) {
      el.style.removeProperty(rowsVar); el.style.removeProperty(chromeVar); el.style.removeProperty(availVar);
      return;
    }
    el.style.setProperty(rowsVar, String(grid ? Math.ceil(count / 3) : count));
    var SAFE = 6;
    if (window.matchMedia && window.matchMedia("(orientation: portrait)").matches) {
      // Portrait: menu at the top, status below (page-scroll) -> fit ONE screen.
      // The surface is auto-height, so chrome = scrollHeight - entries height is
      // stable regardless of overflow. CSS pairs --t9-chrome with 100lvh.
      var app = document.querySelector(".app");
      var padTop = app ? (parseFloat(getComputedStyle(app).paddingTop) || 0) : 0;
      var chrome = Math.max(0, surface.scrollHeight - el.offsetHeight);
      el.style.setProperty(chromeVar, (padTop + chrome + SAFE) + "px");
      el.style.removeProperty(availVar);   // CSS computes avail from 100lvh
    } else {
      // Landscape: the menu is a BOUNDED flex column; the entries flex to fill the
      // leftover AFTER the chrome (flexbox does the subtraction, whatever the
      // chrome's own size). Read that leftover and hand it straight to CSS - no
      // viewport math, no scrollbar -> stable when the window is resized laterally
      // (entries.clientHeight is the flex height, independent of the cell size, so
      // there's no feedback loop).
      el.style.setProperty(availVar, Math.max(0, el.clientHeight - SAFE) + "px");
      el.style.removeProperty(chromeVar);
    }
  }

  function sigOf(s) {
    var m = s.menu || {};
    return JSON.stringify([
      m.title, m.header, m.subtitle, m.entries, m.icons, m.iconsSvg, m.iconWide, m.stateClass, m.disabled, m.layout,
      m.document ? m.document.length : 0,
      !!s.menuShown, s.message, s.simbrief,
      !!(s.settings && s.settings.tabs && s.settings.tabs.length),
      Object.keys(s.commandIcons || {}), Object.keys(s.commandIconsSvg || {}),
      s.receipt ? (s.receipt.operator + "|" + (s.receipt.html ? s.receipt.html.length : 0)) : 0,
      armed, sb.active,
      s.search ? (!!s.search.active + "|" + s.search.session) : 0,
    ]);
  }

  function render(state, meta) {
    if (rendering) return;        // ignore re-entrant renders (DOM is mid-build)
    // While the engine is booting, app.js owns #menuSurface (it renders the
    // startup progress bars there). Don't clobber it; force a fresh render on the
    // first tick after boot so the real menu rebuilds (rescuing any parked status).
    if (document.body.classList.contains("booting")) { lastSig = null; return; }
    var root = document.getElementById("menuSurface");
    if (!root) return;
    var sig = sigOf(state) + "|" + (meta && meta.connected && meta.gsxRunning ? 1 : 0);
    if (sig === lastSig) return;
    lastSig = sig;
    // Expose menu open/closed on <html> so the EFB layout can let the status
    // surface fill the empty space while the menu is closed (see efb.css).
    document.documentElement.classList.toggle("gsx-menu-open", !!state.menuShown);
    rendering = true;
    try {
    // Live gate-search box: a persistent element KEPT across re-renders so its
    // focus/caret/value survive the live re-filter (every keystroke re-renders the
    // menu). Created on a new search session; dropped when search closes.
    var srch = state.search;
    var active = !!(srch && srch.active);
    if (!active) searchSuppressed = false;   // server confirmed close -> ready for the next session
    var searchOn = active && !searchSuppressed;
    if (searchOn) {
      if (!searchBox || searchSession !== srch.session) {
        searchSession = srch.session; searchBox = buildSearchBox(); pendingSearchFocus = true;
      }
    } else {
      // Search ended (server-side: pick / timeout / preempt). Release the mask
      // before the clear loop removes the (possibly focused) box.
      if (searchBox) releaseSearchMask(searchBox);
      searchBox = null; searchSession = null;
    }
    // If the status surface is parked inside the menu surface (closed-state fill),
    // stash it in the right column before the clear so the clear doesn't detach it;
    // reflowLayout() re-places it afterwards.
    var stashRight = document.getElementById("efbRight");
    var stashStatus = document.getElementById("statusSurface");
    if (stashRight && stashStatus && stashStatus.parentNode === root) stashRight.appendChild(stashStatus);
    // Clear the surface but KEEP the live search box (removing it would blur it).
    for (var ch = root.lastChild; ch; ) { var pv = ch.previousSibling; if (ch !== searchBox) root.removeChild(ch); ch = pv; }
    if (searchBox && searchBox.parentNode !== root) root.appendChild(searchBox);   // fresh box -> top
    root.appendChild(menuHead(state));
    // A read-only HTML document (invoice / price list / past-invoices browser)
    // renders above the entries, exactly like the panel's in-menu document.
    var ds = documentSection(state); if (ds) root.appendChild(ds);
    // Live menu options (only when a GSX menu is actually open).
    if (state.menuShown && state.menu && state.menu.entries && state.menu.entries.length)
      root.appendChild(menuList(state));
    // The static command bar is always available.
    root.appendChild(commandBar(state));
    // The invoice notification sits below the command bar.
    var rb = receiptBanner(state); if (rb) root.appendChild(rb);
    // (No Close button: the title bar is the open/close toggle, and menus self-
    // dismiss on timeout.)
    } finally { rendering = false; }
    // Focus a freshly-created search box (new session) once it's painted.
    if (pendingSearchFocus && searchBox) {
      pendingSearchFocus = false;
      var si = searchBox.querySelector("input");
      if (si) setTimeout(function () { try { si.focus(); si.select(); } catch (e) {} }, 0);
    }
    reflowLayout();  // regroup the command bar + status into the right column (EFB + web)
    // Fit SYNCHRONOUSLY (before the browser paints this render), not via rAF.
    // Deferring let the buttons paint one frame at their default (smaller) size
    // and then snap to the fitted page size -- the resize flash on every page
    // switch. One forced layout read here makes the FIRST paint already correct.
    // (resize / orientation changes still use the rAF-coalesced scheduleFit.)
    sizeMenuFit();
  }

  // The live gate-search box (the panel's "Search parking..." field). A streaming
  // input via the shared GsxInput helper: each keystroke -> menu.search, which GSX
  // re-filters; the filtered rows arrive through the normal menu model. EFB
  // sim-input masking comes free from GsxInput.
  function buildSearchBox() {
    var input = GsxInput.create({
      "className": "menu-search-input",
      placeholder: "Search parking...",
      onInput: function (v) { CTX.sendCommand("menu.search", { text: v }); }
    });
    return h("div", { "class": "menu-search" }, input);
  }
  function force() { lastSig = null; render(CTX.getState(), { connected: true, gsxRunning: true }); }

  // Layout regroup (BOTH the EFB and the web client): move the command bar
  // (+ receipt) into a right-hand column (`.efb-right`), so in landscape the
  // entries sit on the left and the buttons on the right - the .app grid (web) /
  // flex (EFB) places the two columns. The STATUS surface lives in that right
  // column below the buttons. The EFB ADDITIONALLY parks it inside the menu
  // surface to fill the empty entry area while the menu is CLOSED (efb.css styles
  // that, keeping the buttons from shifting); the web client always keeps it on
  // the right.
  function reflowLayout() {
    var app = document.querySelector(".app");
    var menu = document.getElementById("menuSurface");
    var statusEl = document.getElementById("statusSurface");
    if (!app || !menu || !statusEl) return;
    var right = document.getElementById("efbRight");
    var chrome = document.getElementById("efbChrome");
    if (!right) {
      chrome = h("div", { "class": "efb-chrome", id: "efbChrome" });
      right = h("div", { "class": "efb-right", id: "efbRight" }, [chrome]);
      app.appendChild(right);       // right column, after #menuSurface
    } else {
      chrome.textContent = "";      // clear the previous render's chrome before re-filling
    }
    // Drop the previous render's receipt: it sits after the status (outside the
    // chrome cleared above), so remove any lingering copy in the right column.
    for (var j = right.children.length - 1; j >= 0; j--) {
      if (right.children[j].classList.contains("receipt-banner")) right.removeChild(right.children[j]);
    }
    // Chrome = the command bar (the receipt is placed after the status).
    var nodes = menu.querySelectorAll(".cmd-bar");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode === menu) chrome.appendChild(nodes[i]);
    }
    // Status placement: the EFB parks it in the menu surface to fill the empty
    // entry area while CLOSED; otherwise (web client, or menu OPEN) it lives in
    // the right column below the buttons.
    // The EFB parks the status in the menu surface to fill the empty entry area
    // while CLOSED - but NOT while the settings overlay is open, which covers the
    // menu surface and would hide the status (it stays in the right column,
    // visible alongside the left-side settings in landscape).
    var efbClosedFill = document.documentElement.classList.contains("legacy") &&
                        !document.documentElement.classList.contains("gsx-menu-open") &&
                        !document.body.classList.contains("settings-active");
    if (efbClosedFill) {
      if (statusEl.parentNode !== menu) menu.appendChild(statusEl);
    } else {
      if (statusEl.parentNode !== right) right.appendChild(statusEl);
    }
    // The invoice notification follows the status area (rendered into the menu
    // surface; relocate it to sit right after the status wherever that lives).
    var receipt = menu.querySelector(".receipt-banner");
    if (receipt && statusEl.parentNode) statusEl.parentNode.insertBefore(receipt, statusEl.nextSibling);
  }

  // The tooltip/message slot. Always rendered (so it RESERVES its space and the
  // commands below don't jump when a message appears/clears); ".empty" makes it an
  // invisible blank gap when there's no message. Sits below the Open/Close button.
  function messageBanner(s) {
    var m = s.message || {};
    var show = !!m.visible && !!(m.text && String(m.text).trim());
    return h("div", { "class": "menu-banner" + (show ? "" : " empty"), text: show ? m.text : "" });
  }

  // The receipt/invoice banner (the panel's "View Invoice"): shown whenever GSX
  // has a published invoice this session. Clicking opens the rendered invoice in
  // an overlay - the same self-contained document the in-game panel shows.
  function receiptKey(r) { return r && r.html ? (String(r.operator || "") + "|" + r.html.length) : null; }

  function receiptBanner(s) {
    var r = s.receipt;
    if (!r || !r.html) return null;
    // Viewing the invoice in the browser IS seeing it: once opened, drop the
    // notification (the in-game banner instead waits for "Open in browser",
    // because the panel can't render the invoice page itself). A NEW invoice
    // has a different key, so its banner shows again.
    if (receiptKey(r) === seenReceiptKey) return null;
    var btn = h("button", { "class": "receipt-banner", onclick: function () { openInvoice(r); } });
    if (r.logo) btn.appendChild(h("img", { "class": "receipt-logo", src: r.logo, alt: "" }));
    btn.appendChild(h("span", { "class": "receipt-text" }, [
      h("span", { "class": "receipt-title", text: r.operator ? ("Invoice from " + String(r.operator)) : "Invoice available" }),
      h("span", { "class": "receipt-op", text: "Click to view" }),
    ]));
    return btn;
  }

  // Document HTML (invoice, price list, SimBrief OFP) asks for a monospace face
  // by various names: the invoice template uses "GSX Receipt Mono" -> /Fonts/...;
  // the SimBrief OFP uses "Courier New"/"Consolas"/generic monospace. None of
  // those resolve in the EFB (this http iframe can't reach Coherent's /Fonts/,
  // and its Coherent ships no Courier/Consolas), so they all fall back to a
  // proportional face. Inject @font-face rules that point ALL the common mono
  // names at the SAME VFS RobotoMono the rest of the EFB uses (coui:// loads
  // cross-scheme), plus a catch-all for <pre>/<code>. Placed after the doc's own
  // styles so it wins. No-op in real browsers (no .legacy class).
  var EFB_MONO_REG = "coui://html_ui/efb_ui/efb_os/Assets/fonts/Roboto/RobotoMono-Medium.ttf";
  var EFB_MONO_BOLD = "coui://html_ui/efb_ui/efb_os/Assets/fonts/Roboto/RobotoMono-Bold.ttf";
  function monoFace(fam, url, wt) {
    return '@font-face{font-family:"' + fam + '";src:url("' + url + '") format("truetype");' +
           (wt ? 'font-weight:' + wt + ';' : 'font-weight:normal;') + 'font-style:normal;}';
  }
  var EFB_MONO_CSS =
    '<style>' +
    monoFace("GSX Receipt Mono", EFB_MONO_REG) + monoFace("GSX Receipt Mono", EFB_MONO_BOLD, 700) +
    monoFace("Courier New", EFB_MONO_REG) + monoFace("Courier New", EFB_MONO_BOLD, 700) +
    monoFace("Courier", EFB_MONO_REG) +
    monoFace("Consolas", EFB_MONO_REG) +
    monoFace("Monaco", EFB_MONO_REG) +
    monoFace("Menlo", EFB_MONO_REG) +
    monoFace("Lucida Console", EFB_MONO_REG) +
    'pre,code,kbd,samp,tt{font-family:"GSX Receipt Mono","Courier New",monospace !important;}' +
    '</style>';
  function efbDocHtml(html) {
    if (!html || !document.documentElement.classList.contains("legacy")) return html;
    return html.indexOf("</head>") !== -1
      ? html.replace("</head>", EFB_MONO_CSS + "</head>")
      : EFB_MONO_CSS + html;
  }
  // Build a sandboxed document iframe. On the EFB, allow-same-origin so the
  // injected coui:// font can load (scripts stay disabled); browsers remain fully
  // sandboxed.
  function makeDocFrame(cls, title, html) {
    var legacy = document.documentElement.classList.contains("legacy");
    var frame = h("iframe", { "class": cls, title: title, sandbox: legacy ? "allow-same-origin" : "" });
    var doc = efbDocHtml(html);
    // On the EFB, set srcdoc AFTER the iframe is attached (next frame): setting it
    // on a still-detached iframe and then attaching races in Coherent and
    // sometimes leaves the document's own <style> unapplied - seen as a page
    // rendering unstyled at random when switching SimBrief pages quickly.
    if (legacy && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () { frame.srcdoc = doc; });
    } else {
      frame.srcdoc = doc;
    }
    return frame;
  }

  // A menu page can carry a read-only HTML document (invoice viewer, price list,
  // past-invoices browser). Render it as a sandboxed iframe above the entries -
  // the same place the in-game panel shows its in-menu document.
  function documentSection(s) {
    var doc = s.menuShown && s.menu && s.menu.document;
    if (!doc) return null;
    return makeDocFrame("menu-document", "Document", doc);
  }

  function openInvoice(r) {
    seenReceiptKey = receiptKey(r);   // instant: re-render drops the bottom banner now
    force();
    cmd("invoice.seen");              // tell GSX (clears the in-game banner too)
    var prev = document.getElementById("invoiceOverlay");
    if (prev) prev.remove();
    var ov = h("div", { "class": "invoice-overlay", id: "invoiceOverlay" });
    document.body.appendChild(ov);

    // Two views in one overlay: the invoice document, and (behind
    // "Print Receipt") the thermal print preview - the SAME strip the
    // in-game print-preview menu shows, rendered server-side at the
    // receipt printer's column count. Print fires the invoice.print
    // verb (native ESC/POS on the GSX host); fire-and-forget, so the
    // button acknowledges the send and the outcome shows as the
    // in-sim GSX message. Shown only when GSX reports a 58/80 mm
    // receipt printer.
    function renderView(previewMode) {
      while (ov.firstChild) ov.removeChild(ov.firstChild);
      var opName = r.operator ? String(r.operator) : "";
      var headKids = [];
      if (previewMode) {
        headKids.push(h("span", { text: opName ? ("Print preview - " + opName) : "Print preview" }));
        var printBtn = h("button", {
          "class": "invoice-close invoice-print",
          text: r.printer ? ("Print on " + String(r.printer)) : "Print",
          onclick: function () {
            cmd("invoice.print");
            printBtn.disabled = true;
            printBtn.textContent = "Sent to printer";
          },
        });
        headKids.push(printBtn);
        headKids.push(h("button", { "class": "invoice-close", text: "Back",
                                    onclick: function () { renderView(false); } }));
      } else {
        headKids.push(h("span", { text: opName ? ("Invoice - " + opName) : "Invoice" }));
        if (r.canPrint && r.printPreview) {
          headKids.push(h("button", {
            "class": "invoice-close invoice-print", text: "Print Receipt",
            onclick: function () { renderView(true); },
          }));
        }
        headKids.push(h("button", { "class": "invoice-close", text: "Close",
                                    onclick: function () { ov.remove(); } }));
      }
      ov.appendChild(h("div", { "class": "invoice-head" }, headKids));
      // Static documents -> sandboxed iframe (with the EFB mono-font fix).
      ov.appendChild(previewMode
        ? makeDocFrame("invoice-frame", "Print preview", r.printPreview)
        : makeDocFrame("invoice-frame", "Invoice", r.html));
    }
    renderView(false);
  }

  function menuHead(s) {
    var m = s.menu || {};
    var closed = !s.menuShown;
    // The title bar is the single open/close toggle (no separate Close button):
    // click to open when closed, click to close when open. The menus also self-
    // dismiss on timeout. The "Tap to open" hint shows only while closed; when
    // open the title shows the menu's question/subtitle.
    return h("div", {
      "class": "menu-head menu-head--action",
      role: "button",
      onclick: function () { if (!closed) closeSearchNow(); cmd(closed ? "menu.toggle" : "menu.close"); },
    }, [
      h("div", { "class": "m-title", text: closed ? "GSX Menu" : (m.title || "GSX Menu") }),
      // Always render the subtitle line so the title bar is a CONSTANT height
      // across pages (some have a subtitle, some don't). A varying title height
      // changes the space the buttons fill -> buttons resize page-to-page.
      // Reserve the line with a non-breaking space when open and there's none
      // (mirrors the EFB's fixed-height title).
      m.subtitle ? h("div", { "class": "m-sub", text: m.subtitle })
                 : (closed ? h("div", { "class": "m-sub m-hint", text: "Tap to open" })
                           : h("div", { "class": "m-sub", text: " " })),
    ]);
  }

  // Mirror GSX's own arrangement: a 3x3 keypad grid when GSX renders T9, else a
  // vertical row list (operator selection, long menus, ...).
  function menuList(s) {
    return (s.menu && s.menu.layout === "t9") ? menuGrid(s.menu) : menuRows(s.menu);
  }

  // Prefer the original SVG (crisp, no quality loss); fall back to the PNG that
  // the Stream Deck needs when no vector exists (operator-logo rasters).
  function iconUri(m, i) {
    return (m.iconsSvg && m.iconsSvg[i]) || (m.icons && m.icons[i]) || "";
  }

  function menuRows(m) {
    var list = h("div", { "class": "menu-list" });
    m.entries.forEach(function (label, i) {
      // Skip empty-label rows (the search menu pads to a fixed slot count with
      // blanks; the panel renders no button for them). `i` is the ORIGINAL index,
      // so non-empty rows keep their correct click mapping.
      if (label == null || label === "") return;
      var disabled = !!(m.disabled && m.disabled[i]);
      var uri = iconUri(m, i);
      // Operator logos (and other non-SVG rasters) are 4:1 wide, not 1:1 square.
      var wide = !!(m.iconWide && m.iconWide[i]);
      var sc = (m.stateClass && m.stateClass[i]) || "";   // service-state colour cue
      var ico = h("img", { "class": "opt-ico" + (wide ? " wide" : "") + (uri ? "" : " blank"), alt: "" });
      if (uri) ico.src = uri;
      var row = h("button", { "class": "opt" + (wide ? " has-logo" : "") + (sc ? " " + sc : "") + (disabled ? " disabled" : "") }, [
        ico, h("span", { "class": "opt-label", text: String(label) }),
      ]);
      if (disabled) row.setAttribute("aria-disabled", "true");
      else row.addEventListener("click", function () { pick(label, i); });
      list.appendChild(row);
    });
    return list;
  }

  function menuGrid(m) {
    var grid = h("div", { "class": "menu-grid" });
    m.entries.forEach(function (label, i) {
      var disabled = !!(m.disabled && m.disabled[i]);
      var uri = iconUri(m, i);
      var ico = h("img", { "class": "cell-ico" + (uri ? "" : " blank"), alt: "" });
      if (uri) ico.src = uri;
      // The 10th entry is the "0" key (row 4) - centre it like a phone keypad
      // instead of letting it auto-place into the left column.
      var zero = (i === 9);
      // Service-state colour cue (GSX-supplied class) -> tints the icon (CSS).
      var sc = (m.stateClass && m.stateClass[i]) || "";
      var cell = h("button", { "class": "cell" + (zero ? " cell-zero" : "") + (sc ? " " + sc : "") + (disabled ? " disabled" : "") }, [
        ico, h("span", { "class": "cell-label", text: String(label) }),
      ]);
      if (disabled) cell.setAttribute("aria-disabled", "true");
      else cell.addEventListener("click", function () { pick(label, i); });
      grid.appendChild(cell);
    });
    return grid;
  }

  // Re-read the index from the LIVE menu at click time (a navigation may have
  // arrived between paint and tap). Never trust the paint-time index blindly.
  function pick(label, paintIdx) {
    var m = (CTX.getState() || {}).menu || {};
    var ents = m.entries || [];
    var idx = (paintIdx < ents.length && ents[paintIdx] === label) ? paintIdx : ents.indexOf(label);
    if (idx < 0) return;
    if (m.disabled && m.disabled[idx]) return;
    cmd("menu.pick", { index: idx });
  }

  function commandBar(s) {
    var wrap = h("div", { "class": "cmd-bar" });   // class lets reflowLayout() relocate the whole bar
    wrap.appendChild(messageBanner(s));   // tooltip slot (blank reserved space when empty)
    var grid = h("div", { "class": "cmd-grid" });
    var hasSettings = !!(s.settings && s.settings.tabs && s.settings.tabs.length);
    STATIC_COMMANDS.forEach(function (c) {
      if (c.settings && !hasSettings) return;   // hide Settings until GSX advertises it
      grid.appendChild(commandBtn(s, c));
    });
    grid.appendChild(simbriefBtn(s));
    wrap.appendChild(grid);
    return wrap;
  }

  function commandBtn(s, c) {
    var isArmed = armed === c.id;
    var btn = h("button", { "class": "cmd" + (isArmed ? " armed" : "") });
    var uri = (s.commandIconsSvg || {})[c.id] || (s.commandIcons || {})[c.id];
    if (uri) btn.appendChild(h("img", { src: uri, alt: "" }));
    btn.appendChild(h("span", {}, [h("span", { text: isArmed ? "Confirm restart?" : c.label })]));
    btn.addEventListener("click", function () {
      if (c.settings) { if (window.Settings) Settings.open(); return; }   // opens the form, not command.run
      if (c.confirm && !isArmed) { armed = c.id; clearTimeout(armedTimer); armedTimer = setTimeout(disarm, 4000); force(); return; }
      disarm();
      cmd("command.run", { command: c.id });
    });
    return btn;
  }
  function disarm() { if (!armed) return; armed = null; clearTimeout(armedTimer); force(); }

  function simbriefBtn(s) {
    var st = s.simbrief || {};
    // Reload finished (gen bumped): drop the optimistic state. We are INSIDE a
    // render (simbriefBtn builds the button), so clear it inline and let this
    // build show the resolved state - NEVER call force() here, or the re-entrant
    // render mid-build duplicates the whole command bar.
    if (sb.active && typeof st.gen === "number" && st.gen > sb.gen) {
      sb = { active: false, gen: -1 };
      clearTimeout(sbTimer);
    }
    var cls = "cmd cmd--wide", sub = "";   // full-width row of its own (below the 2x2 commands), for longer status text
    if (sb.active) { cls += " sb-busy"; sub = "Downloading..."; }
    else if (st.status === "loaded") { cls += " sb-loaded"; sub = "Plan loaded"; }
    else if (st.status === "error")  { cls += " sb-error";  sub = st.error || "Error"; }
    var btn = h("button", { "class": cls });
    var uri = (s.commandIconsSvg || {})["RELOAD_SIMBRIEF"] || (s.commandIcons || {})["RELOAD_SIMBRIEF"];
    if (uri) btn.appendChild(h("img", { src: uri, alt: "" }));
    btn.appendChild(h("span", {}, [
      h("span", { text: "Reload SimBrief" }),
      sub ? h("span", { "class": "cmd-sub", text: sub }) : null,
    ]));
    if (!sb.active) btn.addEventListener("click", function () {
      sb = { active: true, gen: (typeof st.gen === "number" ? st.gen : -1) };
      clearTimeout(sbTimer); sbTimer = setTimeout(sbClear, SB_TIMEOUT_MS);
      cmd("command.run", { command: "RELOAD_SIMBRIEF" });
      force();
    });
    return btn;
  }
  function sbClear() { sb = { active: false, gen: -1 }; clearTimeout(sbTimer); force(); }

  // Rotation / window-resize / URL-bar changes don't alter the menu signature,
  // so re-test the fit on viewport changes too (render() covers content changes).
  window.addEventListener("resize", scheduleFit);
  // Rotation: the immediate measurement can land mid-transition (wrong sizes), so
  // re-fit once the new layout settles. The cell floor + scroll keep it usable
  // even if a transient bad measurement slips through.
  window.addEventListener("orientationchange", function () {
    scheduleFit();
    setTimeout(scheduleFit, 350);
  });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleFit);

  window.Menu = {
    render: render,
    setContext: function (ctx) { CTX = ctx; },
    relayout: scheduleFit,
    refresh: force,   // force a re-render (e.g. settings overlay open/close re-places the status)
  };
})();
