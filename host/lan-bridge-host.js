/* EFB v2 LAN: native code remains authoritative; this adapter sends DOM state,
 * drawing commands and UI events, never screenshots, video or executable RPC. */
(function () {
  'use strict';
  if (window.__efbLanHost) return;
  window.__efbLanHost = true;
  var config = window.EFB_LAN_CONFIG;
  if (!config || !config.enabled) return;
  var socket, retry, timeout, lastReceive = 0, lastStyle = '', force = true, subscribed = false;
  var lastGeometry = '';
  var epoch = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var ids = new WeakMap(), live = new Map(), previous = new Map(), serial = 0, sequence = 0;
  var canvasState = new WeakMap(), canvasInstrumented = false;
  var resources = new Map(), resourceSerial = 0, loadingResources = 0, resourceBytes = 0;
  var transparentImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function nativeImage(url) {
    return /^blob:/i.test(url) || /^https:\/\/(enroute-bitmap\.charts\.api-v2|enroute\.charts\.api-v2)\.navigraph\.com\//i.test(url);
  }
  function imageResource(url) {
    var r = resources.get(url);
    if (!r) { r = { id: String(++resourceSerial), url: url, data: null, offset: 0, uploaded: false, loading: false, retryAt: 0 }; resources.set(url, r); }
    r.used = Date.now();
    var tablet = document.querySelector('#FullScreen[data-tablet-side]');
    if (r.uploaded && tablet) return '/resources/' + String(tablet.getAttribute('data-tablet-side')).toUpperCase() + '/' + epoch + '/' + r.id;
    return transparentImage;
  }
  function loadResource(r) {
    r.loading = true; loadingResources++;
    var request = new XMLHttpRequest(), finished = false;
    function fail(reason, status, mime) {
      r.failure = reason;
      send({type:'resource-error',id:r.id,kind:/^blob:/i.test(r.url)?'blob':'navigraph-tile',reason:reason,status:status||0,mime:String(mime||'').slice(0,80)});
      finish();
    }
    function finish() { if (finished) return; finished = true; loadingResources--; r.loading = false; r.retryAt = r.data ? 0 : Date.now() + 10000; }
    try {
      request.open('GET', r.url, true); request.responseType = 'blob'; request.timeout = 15000;
      // Tile cookies stay inside the simulator's browser session.
      if (/^https:/i.test(r.url)) request.withCredentials = true;
      request.onload = function () {
        var blob = request.response;
        if (request.status !== 0 && request.status !== 200) { fail('http',request.status); return; }
        if (!blob || blob.size > 12 * 1024 * 1024) { fail('empty-or-oversized',request.status); return; }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var result = String(reader.result), match = /^data:([^;,]*);base64,/.exec(result);
            if (!match) { fail('invalid-data-url',request.status,blob.type); return; }
            var data = result.slice(match[0].length);
            var mime = match[1].toLowerCase();
            // Tile CDNs may return binary/octet-stream or no MIME type. Inspect
            // the bytes instead of silently discarding a valid PNG/JPEG/WebP.
            var signature = atob(data.slice(0,32));
            if (signature.slice(0,8) === '\x89PNG\r\n\x1a\n') mime = 'image/png';
            else if (signature.slice(0,3) === '\xff\xd8\xff') mime = 'image/jpeg';
            else if (/^GIF8[79]a/.test(signature)) mime = 'image/gif';
            else if (signature.slice(0,4) === 'RIFF' && signature.slice(8,12) === 'WEBP') mime = 'image/webp';
            if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mime)) { fail('unsupported-mime',request.status,match[1]); return; }
            if (resourceBytes + data.length > 96 * 1024 * 1024 || resources.get(r.url) !== r) return;
            r.mime = mime; r.data = data; r.offset = 0; r.failure = null; resourceBytes += data.length;
          } catch (_) { fail('image-parse',request.status,blob.type); } finally { finish(); }
        };
        reader.onerror = function(){fail('file-reader',request.status,blob.type);}; reader.onabort = function(){fail('aborted');}; reader.readAsDataURL(blob);
      };
      request.onerror = function(){fail('network-or-cors',request.status);}; request.ontimeout = function(){fail('timeout');}; request.onabort = function(){fail('aborted');}; request.send();
    } catch (_) { fail('request-api'); }
  }
  function resetResources() { resources.forEach(function (r) { r.uploaded = false; r.offset = 0; r.awaiting = false; }); }
  function pumpResources() {
    if (!socket || socket.readyState !== 1) return;
    var now = Date.now(), candidate = null;
    resources.forEach(function (r, url) {
      if (now - r.used > 120000) {
        send({type:'resource-drop',epoch:epoch,id:r.id});
        resourceBytes -= r.data ? r.data.length : 0; resources.delete(url); return;
      }
      if (!subscribed) return;
      if (!r.data && !r.loading && loadingResources < 3 && now >= r.retryAt) loadResource(r);
      if (!candidate && r.data && !r.uploaded && !r.awaiting && now >= r.retryAt) candidate = r;
    });
    if (!candidate || socket.bufferedAmount > 512000) return;
    var r = candidate, size = 131072, count = Math.ceil(r.data.length / size);
    if (send({type:'resource',epoch:epoch,id:r.id,mime:r.mime,part:r.offset,count:count,data:r.data.slice(r.offset*size,(r.offset+1)*size)})) {
      r.offset++; if (r.offset === count) r.awaiting = true;
    }
  }
  function id(node) { if (!ids.has(node)) ids.set(node, ++serial); return ids.get(node); }
  function state(canvas) { var s = canvasState.get(canvas); if (!s) { s = { commands: [], depth: 0, unsupported: false }; canvasState.set(canvas, s); } return s; }
  var props = ['fillStyle','strokeStyle','font','textAlign','textBaseline','lineWidth','lineCap','lineJoin','miterLimit','globalAlpha','globalCompositeOperation','shadowBlur','shadowColor','shadowOffsetX','shadowOffsetY','lineDashOffset','imageSmoothingEnabled'];
  // Install before PMDG creates charts. Keep vector commands for redraw on a new client.
  try { if (window.CanvasRenderingContext2D) {
    var proto = CanvasRenderingContext2D.prototype;
    props.forEach(function (name) {
      var d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || !d.set || !d.configurable) return;
      Object.defineProperty(proto, name, { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) {
        d.set.call(this, v);
        var s = state(this.canvas);
        if (s.commands.length < 60000 && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) s.commands.push(['set', name, v]);
        else s.unsupported = true;
      }});
    });
    ['save','restore','beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','arc','arcTo','ellipse','rect','fill','stroke','clip','fillRect','strokeRect','clearRect','fillText','strokeText','translate','rotate','scale','transform','setTransform','resetTransform','setLineDash','drawImage','putImageData'].forEach(function (name) {
      var fn = proto[name]; if (!fn) return;
      proto[name] = function () {
        var a = Array.prototype.slice.call(arguments), s = state(this.canvas);
        if (name === 'clearRect' && !s.depth && a[0] === 0 && a[1] === 0 && a[2] >= this.canvas.width && a[3] >= this.canvas.height) {
          s.commands = []; s.unsupported = false;
          for (var i = 0; i < props.length; i++) if (typeof this[props[i]] !== 'object') s.commands.push(['set', props[i], this[props[i]]]);
          if (this.getTransform) { var t = this.getTransform(); s.commands.push(['setTransform',t.a,t.b,t.c,t.d,t.e,t.f]); }
        }
        if (name === 'save') s.depth++;
        if (name === 'restore') s.depth = Math.max(0, s.depth - 1);
        if (name === 'drawImage') {
          if (a[0] && a[0].tagName === 'IMG') a[0] = { image: a[0].currentSrc || a[0].src };
          else { s.unsupported = true; a = null; }
        } else if (name === 'putImageData' || a.some(function (x) { return x && typeof x === 'object' && !Array.isArray(x); })) { s.unsupported = true; a = null; }
        if (a && s.commands.length < 60000) s.commands.push([name].concat(a));
        else s.unsupported = true;
        return fn.apply(this, arguments);
      };
    });
    ['width','height'].forEach(function (name) {
      var d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name);
      if (d && d.set && d.configurable) Object.defineProperty(HTMLCanvasElement.prototype, name, { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) {
        d.set.call(this, v); canvasState.delete(this);
      }});
    });
    canvasInstrumented = true;
  } } catch (_) { /* An unsupported canvas API must never disable normal EFB controls. */ }
  function asset(value, base) {
    if (value && nativeImage(value)) return imageResource(value);
    if (!value || /^(data:|#)/i.test(value)) return value;
    if (/^coui:\/\//i.test(value)) return '/assets/' + value.replace(/^coui:\/\/[^/]*\/*/i, '');
    if (/^\/(?!\/)/.test(value)) return '/assets' + value;
    try {
      // Resolve relative stylesheet assets without relying on support for a custom URL scheme.
      var documentBase = (document.baseURI || location.href).replace(/^coui:\/\/[^/]*/i, 'http://efb-native.invalid');
      var resolvedBase = base ? new URL(base.replace(/^coui:\/\/[^/]*/i, 'http://efb-native.invalid'), documentBase).href : documentBase;
      var u = new URL(value, resolvedBase), p = u.pathname;
      if (u.origin === 'http://efb-native.invalid' || u.origin === location.origin) return '/assets' + p + u.search + u.hash;
      return value;
    } catch (_) { return value; }
  }
  function css(text, base) {
    return text.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, function (_, q, u) { return 'url("' + asset(u, base).replace(/"/g, '%22') + '")'; });
  }
  function styles() {
    var result = '';
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      try { result += css(Array.prototype.map.call(sheet.cssRules, function (r) { return r.cssText; }).join('\n'), sheet.href || location.href) + '\n'; } catch (_) {}
    });
    return result;
  }
  function stylesheetLinks() {
    var result = [];
    Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"][href]'), function (link) {
      var href = asset(link.href || link.getAttribute('href'));
      if (result.indexOf(href) === -1) result.push(href);
    });
    return result;
  }
  function read(node, records, visibleParent) {
    if (node.nodeType !== 1 && node.nodeType !== 3) return null;
    if (node.nodeType === 1 && /^(SCRIPT|STYLE|LINK|META|BASE|NOSCRIPT|TEMPLATE|AUDIO|VIDEO|OBJECT|EMBED)$/i.test(node.tagName)) return null;
    var key = id(node), r = { id: key };
    live.set(key, node);
    if (node.nodeType === 3) {
      r.text = node.nodeValue;
      // Encode an explicit line break only in the LAN snapshot, never in the native DOM.
      if (node.parentElement && node.parentElement.matches('#groundops_doors_management > span') && /^Door\s+Management$/i.test(r.text.trim())) r.text = 'Door\nManagement';
    }
    else {
      r.tag = node.localName; r.ns = node.namespaceURI; r.attrs = {};
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (/^on/i.test(a.name) || /^(srcdoc|integrity|nonce|autofocus)$/i.test(a.name)) return;
        var v = a.value;
        if (/^(src|href|xlink:href|poster)$/i.test(a.name)) v = asset(v);
        if (a.name === 'style') v = css(v);
        r.attrs[a.name] = v;
      });
      if ('value' in node && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) { r.value = node.value; r.checked = !!node.checked; }
      r.scroll = [Math.round(node.scrollLeft), Math.round(node.scrollTop)];
      var visible = visibleParent;
      if (node.tagName === 'CANVAS' && node.getClientRects().length) {
        var s = state(node); r.canvas = { width: node.width, height: node.height, commands: s.commands.map(function (cmd) {
          if (cmd[0] !== 'drawImage' || !cmd[1].image) return cmd;
          var copy = cmd.slice(); copy[1] = {image:asset(cmd[1].image)}; return copy;
        }), unsupported: s.unsupported || !canvasInstrumented };
      }
      if (node.tagName === 'IFRAME') {
        // Only our two known service apps execute locally. Other frames need a dedicated adapter.
        var src = node.getAttribute('src') || '';
        if (!/\/(remoteClient|beyondatc_toolbar)\//i.test(src)) { delete r.attrs.src; r.frameUnavailable = true; }
        else r.attrs.src = asset(src);
      }
      r.children = [];
      if (node.tagName !== 'IFRAME') Array.prototype.forEach.call(node.childNodes, function (child) { var cid = read(child, records, visible); if (cid !== null) r.children.push(cid); });
    }
    records.set(key, r); return key;
  }
  function send(msg) { if (socket && socket.readyState === 1 && !(socket.bufferedAmount > 2000000)) { socket.send(JSON.stringify(msg)); return true; } return false; }
  function aircraftLabel() {
    function normalize(value) {
      var text=String(value || '').toUpperCase().replace(/_/g,' '), m;
      if ((m=text.match(/\b737[ -]*(600|700|800|900)(?:[ -]*(ER))?/))) return '737-'+m[1]+(m[2] || '');
      if ((m=text.match(/\b777[ -]*(200|300)(?:[ -]*(ER|LR))?/))) return '777-'+m[1]+(m[2] || '');
      if (/\b777[ -]*F\b/.test(text)) return '777F';
      return '';
    }
    var label='';
    // PMDG resolves 737-900ER from its subtype even when the page folder is 737-900.
    try { if (typeof getAircraftType === 'function') label=normalize(getAircraftType()); } catch (_) {}
    try { if (!label && typeof SimVar !== 'undefined') label=normalize(SimVar.GetSimVarValue('TITLE','string')); } catch (_) {}
    return label || normalize(window.pmdg_tablet_path);
  }
  function snapshot() {
    if (!socket || socket.readyState !== 1 || !document.body || !document.querySelector('#FullScreen')) return;
    if (socket.bufferedAmount > 2000000) { force = true; return; }
    var records = new Map(); live.clear(); var root = read(document.body, records, true), changed = [], removed = [];
    var next = new Map(); records.forEach(function (r, key) { var json = JSON.stringify(r); next.set(key, json); if (force || previous.get(key) !== json) changed.push(r); });
    previous.forEach(function (_, key) { if (!next.has(key)) removed.push(key); });
    var links = stylesheetLinks(), style = styles(), styleKey = style + JSON.stringify(links), styleChanged = styleKey !== lastStyle;
    var rect = (document.querySelector('pmdg-tablet') || document.querySelector('#FullScreen')).getBoundingClientRect();
    var contentRect = {x:rect.left,y:rect.top,width:rect.width,height:rect.height};
    var aircraft = aircraftLabel();
    var geometry = JSON.stringify([innerWidth,innerHeight,contentRect,aircraft]);
    if (force || changed.length || removed.length || styleChanged || geometry !== lastGeometry) {
      var msg = { type: force ? 'frame' : 'patch', epoch: epoch, seq: ++sequence, root: root, nodes: changed, removed: removed, width: innerWidth, height: innerHeight, contentRect:contentRect, aircraft:aircraft };
      if (force || styleChanged) { msg.css = style; msg.stylesheets = links; }
      if (send(msg)) { previous = next; lastStyle = styleKey; lastGeometry = geometry; force = false; }
    }
  }
  function mouseAction(n, name, m) {
    var buttons = name === 'mousedown' ? 1 : name === 'mouseup' ? 0 : m.buttons || 0;
    var event = new MouseEvent(name, { bubbles: true, cancelable: true, clientX: +m.x || 0, clientY: +m.y || 0, button: 0, buttons: buttons, view: window });
    try { Object.defineProperty(event,'which',{value:1}); } catch (_) {}
    n.dispatchEvent(event);
  }
  function finishRemoteSelection(select, option) {
    // PMDG hides these lists on mouseleave, not when an option is selected.
    // Only complete remotely initiated clicks; local simulator mouse behavior stays intact.
    document.querySelectorAll('.custom-select').forEach(function (other) {
      if (other === select && !option) return;
      var options = other.querySelector('.options');
      if (options && options.style.visibility === 'visible')
        other.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: false, view: window }));
    });
  }
  function action(m) {
    if (m.epoch !== epoch) return;
    var n = live.get(m.id); if (!n || n.nodeType !== 1 || !document.documentElement.contains(n)) return;
    var name = m.event;
    if (name === 'scroll') { n.scrollLeft = +m.x || 0; n.scrollTop = +m.y || 0; return; }
    if (name === 'input' || name === 'change') {
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.disabled || n.readOnly) return;
      n.focus(); n.value = String(m.value || '').slice(0, 16000); if ('checked' in m) n.checked = !!m.checked;
      n.dispatchEvent(new Event(name, { bubbles: true })); return;
    }
    if (/^key(down|up)$/.test(name)) { n.dispatchEvent(new KeyboardEvent(name, { key: m.key, code: m.code, keyCode: m.keyCode, which: m.keyCode, bubbles: true, cancelable: true })); return; }
    if (/^(tap|click|mousedown|mouseup|mousemove)$/.test(name)) {
      if (n.closest('button:disabled,input:disabled,select:disabled,[aria-disabled="true"],.custom-select.disabled,.custom-select-disabled')) return;
      var select = n.closest('.custom-select'), option = n.closest('.option');
      if (name === 'tap') {
        // One message / one handler turn: background snapshots cannot split the gesture.
        if (!(n.matches('button,.custom-select') || (option && select))) return;
        mouseAction(n, 'mousedown', m);
        mouseAction(n, 'mouseup', m);
        if (!document.documentElement.contains(n) || n.matches(':disabled')) return;
        mouseAction(n, 'click', m);
      } else mouseAction(n, name, m);
      if (name === 'tap' || name === 'click') finishRemoteSelection(select, option);
    }
  }

  function connect() {
    clearTimeout(retry);
    var el = document.querySelector('#FullScreen[data-tablet-side]');
    if (!el) { retry = setTimeout(connect, 2000); return; }
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    var side = String(el.getAttribute('data-tablet-side')).toUpperCase();
    var s = new WebSocket('ws://127.0.0.1:' + config.port + '/ws/host?side=' + side + '&key=' + encodeURIComponent(config.hostKey)); socket = s;
    timeout = setTimeout(function () { if (socket === s && s.readyState !== 1) s.close(); }, 8000);
    s.onopen = function () { if (socket !== s) return; clearTimeout(timeout); lastReceive = Date.now(); force = true; subscribed = false; resetResources(); };
    s.onmessage = function (e) { if (socket !== s) return; lastReceive = Date.now(); try { var m = JSON.parse(e.data); if (m.type === 'subscribers') { subscribed = m.count > 0; if (subscribed) { force = true; snapshot(); } } else if (m.type === 'resync') { if (subscribed) { force = true; snapshot(); } } else if (m.type === 'ping') send({type:'pong'}); else if (m.type === 'action') action(m); else if (m.type === 'resource-ack') resources.forEach(function (r) { if (r.id === m.id) { r.uploaded = !!m.ok; r.awaiting = false; r.offset = 0; r.retryAt = m.ok ? 0 : Date.now()+10000; } }); } catch (_) {} };
    s.onerror = function () { s.close(); };
    s.onclose = function () { if (socket !== s) return; clearTimeout(timeout); socket = null; retry = setTimeout(connect, 3000); };
  }
  // No background DOM traversal unless a browser is actually subscribed.
  setInterval(function () {
    if (socket && socket.readyState === 1 && Date.now() - lastReceive > 35000) { socket.close(); return; }
    if (subscribed && socket && socket.readyState === 1) snapshot();
  }, 250);
  setInterval(pumpResources, 40);
  window.addEventListener('beforeunload', function () { clearTimeout(retry); if (socket) { socket.onclose = null; socket.close(); } });
  connect();
}());
