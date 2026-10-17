/* settings.js - the SETTINGS surface: a THIN, GENERIC form renderer over the
 * GSX settings schema the server emits (state.settings = { tabs:[...] }).
 *
 * It knows NO setting ids, NO semantics - only control TYPES (toggle, range,
 * choice, text, action, info, separator) and tab/subtab nesting. Every change
 * round-trips to GSX as settings.set{key,value} / settings.action{key}; GSX
 * does all the real work (validation, side effects, disk, panel sync) and
 * pushes the updated schema back, which we reconcile in place.
 *
 * Classic script: window.Settings = { render, setContext, open, close, isOpen }.
 */
(function () {
  "use strict";

  var CTX = { sendCommand: function () {}, getState: function () { return {}; } };
  var open = false;
  var activeTab = null;          // top-level tab id currently shown
  var activeSub = {};            // tabId -> active subtab id
  var structSig = null;          // last structural signature (rebuild trigger)
  var ctrls = {};                // field key -> { el, type, set(value), dis(bool) }
  var infos = {};                // field key -> { valueEl, buttons:{key:btnEl} }
  var root = null, body = null, tabsBar = null;

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
  function setVal(verb, key, value) { CTX.sendCommand(verb, { key: key, value: value }); }
  function doAction(key) { CTX.sendCommand("settings.action", { key: key }); }
  // Test-sound preview trigger (Audio tab). De-duped so a stream of
  // pointer/change events doesn't spam identical start/stop frames; channel 0
  // stops. The sound plays on the GSX host through the sim's audio devices.
  var activeAudioCh = 0;
  function audioCheck(ch) {
    if (ch === activeAudioCh) return;
    activeAudioCh = ch;
    CTX.sendCommand("settings.audioCheck", { channel: ch });
  }

  // Custom dropdown for the EFB: Coherent (GameFace) won't open a native <select>
  // popup inside our iframe, so a choice field uses a button + an inline list
  // there. Browsers keep the native <select> (see buildField). A document click
  // closes any open list (button / option clicks stopPropagation).
  var openReposition = null;   // positioner of the currently-open dropdown (so it follows on scroll)
  function closeDropdowns() {
    openReposition = null;
    var open = document.querySelectorAll(".set-dropdown.is-open");
    for (var i = 0; i < open.length; i++) {
      open[i].classList.remove("is-open");
      var l = open[i].querySelector(".dd-list");
      if (l) l.hidden = true;
    }
  }
  document.addEventListener("click", closeDropdowns);
  // Keep the open list glued to its button as the body scrolls (don't close);
  // the positioner auto-closes only if the button scrolls out of the body.
  window.addEventListener("scroll", function () { if (openReposition) openReposition(); }, true);
  function customDropdown(key, choices, value) {
    var cur = value, opts = [];
    function labelFor(v) {
      for (var i = 0; i < choices.length; i++)
        if (String(choices[i][0]) === String(v)) return choices[i][1];
      return "";
    }
    function refreshSel() {
      for (var i = 0; i < opts.length; i++)
        opts[i].className = "dd-opt" + (String(choices[i][0]) === String(cur) ? " is-sel" : "");
    }
    var lbl = h("span", { "class": "dd-label", text: labelFor(cur) });
    var btn = h("button", { "class": "set-select dd-btn", type: "button" }, [lbl]);
    var list = h("div", { "class": "dd-list", hidden: "" });
    choices.forEach(function (c) {
      var opt = h("div", { "class": "dd-opt", text: c[1] });
      opt.addEventListener("click", function (e) {
        e.stopPropagation();
        cur = c[0]; lbl.textContent = c[1]; refreshSel(); closeDropdowns();
        setVal("settings.set", key, parseInt(c[0], 10));
      });
      opts.push(opt); list.appendChild(opt);
    });
    refreshSel();
    var dd = h("div", { "class": "set-dropdown" }, [btn, list]);
    // Position the fixed list right under the button, capped to the visible
    // bottom of the settings body so a long list scrolls rather than running off
    // the panel. (window.innerHeight is unreliable in the EFB overlay.) Re-run on
    // scroll so the list follows the button; closes if it scrolls out of view.
    function position() {
      var r = btn.getBoundingClientRect();
      var bodyEl = document.querySelector(".settings-body");
      var br = bodyEl ? bodyEl.getBoundingClientRect() : null;
      if (br && (r.bottom <= br.top || r.top >= br.bottom)) { closeDropdowns(); return; }
      var limit = br ? br.bottom : (r.bottom + 320);
      list.style.left = Math.round(r.left) + "px";
      list.style.top = Math.round(r.bottom) + "px";
      list.style.width = Math.round(r.width) + "px";
      list.style.maxHeight = Math.max(100, Math.round(limit - r.bottom - 8)) + "px";
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = list.hidden;
      closeDropdowns();
      if (willOpen) { position(); list.hidden = false; dd.classList.add("is-open"); openReposition = position; }
    });
    return { el: dd, api: { el: dd, type: "choice",
      set: function (v) { cur = v; lbl.textContent = labelFor(v); refreshSel(); },
      dis: function (d) { btn.disabled = !!d; } } };
  }

  // ---- scaffold (overlay), built once ---------------------------------------
  // The settings page is opened from the menu's "Settings" command (menu.js),
  // mirroring the real GSX commands menu - there is no separate launcher here.
  function ensureScaffold() {
    if (root) return;
    body = h("div", { "class": "settings-body" });
    tabsBar = h("div", { "class": "settings-tabs", role: "tablist" });
    // Title bar styled like a normal menu title, clickable to close (no dedicated
    // close icon).
    var head = h("div", {
      "class": "settings-head menu-head--action", role: "button",
      onclick: function () { Settings.close(); },
    }, [
      h("div", { "class": "settings-title", text: "GSX Settings" }),
      h("div", { "class": "settings-hint", text: "Tap to close" }),
    ]);
    root = h("div", { "class": "settings-overlay", hidden: "" }, [
      h("div", { "class": "settings-panel" }, [head, tabsBar, body]),
    ]);
    document.body.appendChild(root);
  }

  // ---- signatures -----------------------------------------------------------
  // Structural = everything that changes the FORM (tabs/fields/types/choices).
  // A structural change forces a rebuild; otherwise we patch values/disabled in
  // place so the user's focus/scroll/drag survives a live patch.
  function fieldStruct(f) {
    return [f.type, f.key, f.label, f.tooltip, f.button, f.placeholder, f.maxlength,
            f.min, f.max, f.step, f.unit, f.float,
            f.choices ? f.choices.map(function (c) { return c[0] + "" + c[1]; }) : 0,
            f.buttons ? f.buttons.map(function (b) { return b.key + "" + b.button; }) : 0];
  }
  function structuralSig(settings) {
    var tabs = (settings && settings.tabs) || [];
    return JSON.stringify(tabs.map(function (t) {
      return [t.id, t.label,
        t.subtabs ? t.subtabs.map(function (s) {
          return [s.id, s.label, (s.fields || []).map(fieldStruct)];
        }) : 0,
        t.fields ? t.fields.map(fieldStruct) : 0,
        t.placeholder || 0];
    }));
  }

  // ---- field controls -------------------------------------------------------
  function labelCell(f) { return h("div", { "class": "set-label", text: f.label || "" }); }

  function buildField(f) {
    if (f.type === "separator") {
      return h("div", { "class": "set-sep" }, f.label ? h("span", { text: f.label }) : null);
    }
    if (f.type === "info") {
      var valEl = h("div", { "class": "set-info-val", text: f.value || "" });
      var btnWrap = null;
      var btnMap = {};
      if (f.buttons && f.buttons.length) {
        var bks = f.buttons.map(function (b) {
          var bt = h("button", { "class": "set-btn", disabled: b.disabled ? "" : null,
                                  "data-disabled": b.disabled ? "1" : null,
                                  onclick: function () { if (!bt.disabled) doAction(b.key); } }, b.button);
          btnMap[b.key] = bt;
          return bt;
        });
        btnWrap = h("div", { "class": "set-info-actions" }, bks);
      }
      infos[f.key || ("info_" + (f.label || ""))] = { valueEl: valEl, buttons: btnMap, field: f };
      var rowKids = [h("div", { "class": "set-info-text" }, [labelCell(f), valEl])];
      if (btnWrap) rowKids.push(btnWrap);
      return h("div", { "class": "set-field set-field--info", "data-type": "info" }, rowKids);
    }
    if (f.type === "action") {
      var ab = h("button", { "class": "set-btn", disabled: f.disabled ? "" : null,
                             "data-disabled": f.disabled ? "1" : null,
                             onclick: function () { if (!ab.disabled) doAction(f.key); } }, f.button || "Open");
      ctrls[f.key] = { el: ab, type: "action",
        set: function () {}, dis: function (d) { ab.setAttribute("data-disabled", d ? "1" : ""); ab.disabled = !!d; } };
      return h("div", { "class": "set-field set-field--action", "data-type": "action", title: f.tooltip || "" },
               [labelCell(f), h("div", { "class": "set-ctrl" }, ab)]);
    }
    var ctrl, api;
    if (f.type === "toggle") {
      var on = !!f.value;
      var sw = h("button", { "class": "set-switch", role: "switch", "aria-checked": on ? "true" : "false",
        onclick: function () { var nv = sw.getAttribute("aria-checked") !== "true";
          sw.setAttribute("aria-checked", nv ? "true" : "false"); setVal("settings.set", f.key, nv ? 1 : 0); } },
        h("span", { "class": "set-switch-knob" }));
      ctrl = sw;
      api = { el: sw, type: "toggle",
        set: function (v) { sw.setAttribute("aria-checked", v ? "true" : "false"); },
        dis: function (d) { sw.disabled = !!d; } };
    } else if (f.type === "choice") {
      if (document.documentElement.classList.contains("legacy")) {
        var dd = customDropdown(f.key, f.choices || [], f.value);   // EFB: native <select> won't open
        ctrl = dd.el; api = dd.api;
      } else {
        var sel = h("select", { "class": "set-select",
          onchange: function () { setVal("settings.set", f.key, parseInt(sel.value, 10)); } },
          (f.choices || []).map(function (c) {
            return h("option", { value: c[0], selected: (String(c[0]) === String(f.value)) ? "" : null }, c[1]);
          }));
        ctrl = sel;
        api = { el: sel, type: "choice",
          set: function (v) { sel.value = String(v); },
          dis: function (d) { sel.disabled = !!d; } };
      }
    } else if (f.type === "range") {
      var readout = h("span", { "class": "set-range-val" });
      function fmt(v) { return (f.float ? v : Math.round(v)) + (f.unit ? (" " + f.unit) : ""); }
      function rngVal() { return f.float ? parseFloat(rng.value) : parseInt(rng.value, 10); }
      var audioCh = f.audioCheck || 0;   // 1..5 = a volume slider with a test-sound preview
      var liveT = 0;                      // throttle for the live `settings.set` during an audio drag
      // Paint the filled portion left of the thumb (the in-game slider look);
      // WebKit has no progress pseudo-element, so the track gradient reads --fill.
      function setFill() {
        var lo = parseFloat(f.min), hi = parseFloat(f.max), v = parseFloat(rng.value);
        var p = (hi > lo) ? ((v - lo) / (hi - lo) * 100) : 0;
        rng.style.setProperty("--fill", Math.max(0, Math.min(100, p)) + "%");
      }
      var rng = h("input", { "class": "set-range", type: "range",
        min: f.min, max: f.max, step: f.step, value: f.value,
        oninput: function () {
          readout.textContent = fmt(parseFloat(rng.value));
          setFill();
          // Audio sliders push the value live (throttled) so the running
          // preview's gain tracks the drag; plain sliders commit on release.
          if (audioCh && !liveT) liveT = setTimeout(function () {
            liveT = 0; setVal("settings.set", f.key, rngVal());
          }, 110);
        },
        onchange: function () {
          if (liveT) { clearTimeout(liveT); liveT = 0; }
          setVal("settings.set", f.key, rngVal());          // final value
          // Don't stop the preview here - the EFB fires change on release, and an
          // immediate stop kills the tail. The idle timer (keepAlive) ends it.
        } });
      if (audioCh) {
        // The EFB's Coherent gives no reliable press->release bracket for a range
        // slider (it fires a mouseup/pointerup on the initial click, then drags
        // separately, and may never fire change/pointerup on the real release).
        // So don't try to stop "on release" - instead keep the preview alive on
        // every interaction (press + each drag move) and stop a short moment
        // after interaction ceases. That sustains the sound while the slider is
        // in use AND guarantees it stops (no runaway "headphones check" loop).
        var idleTimer = 0;
        var stop = function () {
          if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
          audioCheck(0);
        };
        var keepAlive = function () {
          audioCheck(audioCh);                  // start (de-duped while already playing)
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(stop, 3000);   // sustain while in use + a tail after the last interaction
        };
        rng.addEventListener("pointerdown", keepAlive);
        rng.addEventListener("mousedown",   keepAlive);
        rng.addEventListener("input",       keepAlive);   // each drag move keeps it alive
      }
      readout.textContent = fmt(parseFloat(f.value));
      setFill();
      ctrl = h("div", { "class": "set-range-wrap" }, [rng, readout]);
      api = { el: rng, type: "range",
        set: function (v) { rng.value = v; readout.textContent = fmt(parseFloat(v)); setFill(); },
        dis: function (d) { rng.disabled = !!d; } };
    } else if (f.type === "text") {
      // Shared input helper: commit on Enter/blur + EFB sim-input masking.
      var inp = GsxInput.create({ "className": "set-text", value: f.value || "",
        maxLength: f.maxlength, placeholder: f.placeholder || "",
        onCommit: function (v) { setVal("settings.set", f.key, v); } });
      ctrl = inp;
      api = { el: inp, type: "text",
        set: function (v) { inp.value = v == null ? "" : v; },
        dis: function (d) { inp.disabled = !!d; } };
    } else {
      return null;   // unknown type - ignore (forward-compatible)
    }
    ctrls[f.key] = api;
    return h("div", { "class": "set-field", "data-type": f.type, title: f.tooltip || "" },
             [labelCell(f), h("div", { "class": "set-ctrl" }, ctrl)]);
  }

  function buildFields(fields) {
    var rows = [];
    for (var i = 0; i < fields.length; i++) {
      var el = buildField(fields[i]);
      if (el) rows.push(el);
    }
    return rows;
  }

  function tabById(settings, id) {
    var tabs = (settings.tabs || []);
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
    return tabs[0] || null;
  }

  function buildTabBody(tab) {
    if (!tab) return;
    if (tab.subtabs && tab.subtabs.length) {
      var subId = activeSub[tab.id];
      if (!subId || !tab.subtabs.some(function (s) { return s.id === subId; }))
        subId = tab.subtabs[0].id;
      activeSub[tab.id] = subId;
      var nav = h("div", { "class": "settings-subtabs", role: "tablist" },
        tab.subtabs.map(function (s) {
          return h("button", { "class": "settings-subtab" + (s.id === subId ? " is-active" : ""),
            onclick: function () { activeSub[tab.id] = s.id; rebuild(CTX.getState()); } }, s.label);
        }));
      var sub = tab.subtabs.filter(function (s) { return s.id === subId; })[0];
      body.appendChild(nav);
      body.appendChild(h("div", { "class": "settings-fields" }, buildFields(sub.fields || [])));
    } else if (tab.fields && tab.fields.length) {
      body.appendChild(h("div", { "class": "settings-fields" }, buildFields(tab.fields)));
    } else if (tab.placeholder) {
      body.appendChild(h("div", { "class": "settings-placeholder", text: tab.placeholder }));
    }
  }

  // Full (re)build of tabs bar + active tab body.
  function rebuild(state) {
    var settings = (state && state.settings) || {};
    var tabs = settings.tabs || [];
    ctrls = {}; infos = {};
    tabsBar.textContent = ""; body.textContent = "";
    if (!activeTab || !tabs.some(function (t) { return t.id === activeTab; }))
      activeTab = tabs.length ? tabs[0].id : null;
    tabs.forEach(function (t) {
      tabsBar.appendChild(h("button", { "class": "settings-tab" + (t.id === activeTab ? " is-active" : ""),
        role: "tab", onclick: function () { activeTab = t.id; rebuild(CTX.getState()); } }, t.label));
    });
    buildTabBody(tabById(settings, activeTab));
  }

  // Patch values / disabled / info text in place without rebuilding (so focus,
  // scroll and an in-progress drag are preserved). Skips the focused element.
  function patchValues(state) {
    var settings = (state && state.settings) || {};
    var focused = document.activeElement;
    function walk(fields) {
      (fields || []).forEach(function (f) {
        if (f.type === "info") {
          var inf = infos[f.key || ("info_" + (f.label || ""))];
          if (inf) {
            inf.valueEl.textContent = f.value || "";
            (f.buttons || []).forEach(function (b) {
              var bt = inf.buttons[b.key];
              if (bt) { bt.disabled = !!b.disabled; bt.setAttribute("data-disabled", b.disabled ? "1" : ""); }
            });
          }
          return;
        }
        var c = ctrls[f.key];
        if (!c) return;
        if (typeof f.disabled !== "undefined") c.dis(f.disabled);
        if (c.type === "action") return;
        if (c.el !== focused) c.set(f.value);
      });
    }
    (settings.tabs || []).forEach(function (t) {
      if (t.subtabs) t.subtabs.forEach(function (s) { walk(s.fields); });
      else walk(t.fields);
    });
  }

  // ---- public API -----------------------------------------------------------
  var Settings = {
    setContext: function (ctx) { if (ctx) CTX = ctx; },
    isOpen: function () { return open; },
    open: function () {
      ensureScaffold();
      open = true;
      root.hidden = false;
      document.body.classList.add("settings-active");
      // Re-place the menu's status surface now that settings covers the menu area
      // (EFB: keep it in the right column instead of filling the menu surface).
      if (window.Menu && window.Menu.refresh) window.Menu.refresh();
      structSig = structuralSig((CTX.getState() || {}).settings);
      rebuild(CTX.getState());
      // Tell GSX the form opened so it bootstraps live data (controller
      // enumeration, refresh hook). The reply/patch refreshes us reactively.
      CTX.sendCommand("settings.get", {});
    },
    close: function () {
      open = false;
      audioCheck(0);   // stop any in-flight test-sound preview if closed mid-drag
      // Release any sim-input mask a focused text field held - hiding the form
      // won't fire blur, so without this the sim could stay masked.
      if (window.GsxInput && GsxInput.releaseMask) GsxInput.releaseMask();
      if (root) root.hidden = true;
      document.body.classList.remove("settings-active");
      // Restore the menu's normal layout (EFB: the closed-state status-fill).
      if (window.Menu && window.Menu.refresh) window.Menu.refresh();
    },
    render: function (state) {
      ensureScaffold();
      var settings = (state && state.settings) || {};
      var has = !!(settings.tabs && settings.tabs.length);
      if (!open) return;
      // Close if GSX stopped advertising settings while the page was open.
      if (!has) { Settings.close(); return; }
      var sig = structuralSig(settings);
      if (sig !== structSig) { structSig = sig; rebuild(state); }
      else patchValues(state);
    },
  };
  window.Settings = Settings;
})();
