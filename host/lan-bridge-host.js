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
  var viewNodes=new Set(),viewAcks=[];
  function viewState(node){
    if(node.id!=='efb_navigraph_chart_container_scroll'&&!(node.classList&&node.classList.contains('leaflet-container')))return null;
    try{return window.PMDGLanViewAdapter&&window.PMDGLanViewAdapter.read(node);}catch(_){return null;}
  }
  var resources = new Map(), resourceSerial = 0, loadingResources = 0, resourceBytes = 0;
  var dirtyNodes = new Set(), detachedRoots = new Set(), currentRecords = new Map(), propertyNodes = new Set();
  var cssDirty = true, styleCache = '', linksCache = [], styleKeyCache = '', geometryDirty = true, geometryCache, aircraftCache = '', lastPoll = 0, rootKey;
  var readingOwner = null, resourceOwners = new Map(), observer, nextSnapshot = 0;
  var metrics = { snapshots:0, full:0, nodes:0, cssBuilds:0, totalMs:0, maxMs:0, errors:0 };
  window.__efbLanPerformance = function () { return Object.assign({subscribed:subscribed}, metrics); };
  function mark(node) { if (subscribed && node) dirtyNodes.add(node); }
  function releaseResources(owner) {
    var refs=resourceOwners.get(owner); if (!refs) return;
    refs.forEach(function(r){r.owners.delete(owner);}); resourceOwners.delete(owner);
  }
  function setSubscribed(value) {
    if (subscribed === value) return;
    subscribed=value;
    if (observer) observer.disconnect();
    dirtyNodes.clear(); detachedRoots.clear();
    if (value) { force=true; cssDirty=true; geometryDirty=true; lastPoll=0; nextSnapshot=0;
      if (observer) observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
    }
  }
  var transparentImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function nativeImage(url) {
    return /^blob:/i.test(url) || /^https:\/\/(enroute-bitmap\.charts\.api-v2|enroute\.charts\.api-v2)\.navigraph\.com\//i.test(url);
  }
  function imageResource(url) {
    var r = resources.get(url);
    if (!r) { r = { id: String(++resourceSerial), url: url, data: null, offset: 0, uploaded: false, loading: false, retryAt: 0, owners:new Set() }; resources.set(url, r); }
    r.used = Date.now();
    if (readingOwner) {
      r.owners.add(readingOwner);
      var refs=resourceOwners.get(readingOwner);
      if (!refs) { refs=new Set(); resourceOwners.set(readingOwner,refs); }
      refs.add(r);
    }
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
      if (subscribed && r.owners.size) r.used=now;
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
  var canvasStyleSerial=0;
  function state(canvas) { var s = canvasState.get(canvas); if (!s) { s = { commands: [], depth: 0, unsupported: false, assigned:{}, styleVersion:0, stack:[], clearVersion:-1, clearState:[], queued:false }; canvasState.set(canvas, s); } return s; }
  function markCanvas(canvas,s) { if(subscribed&&!s.queued){s.queued=true;mark(canvas);} }
  window.__efbLanCanvasInfo=function(canvas){var s=canvasState.get(canvas);return s?{commands:s.commands.length,depth:s.depth,unsupported:s.unsupported}:null;};
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
        // Native assignment always runs. Redundant assignments need no second
        // replay command; save/restore below also restores this shadow cache.
        // These string styles can resolve relative to CSS (em/currentColor).
        // Reassigning the same text can therefore change their native value.
        if(name!=='font'&&name!=='fillStyle'&&name!=='strokeStyle'&&Object.prototype.hasOwnProperty.call(s.assigned,name)&&s.assigned[name]===v)return;
        s.assigned[name]=v;s.styleVersion=++canvasStyleSerial;markCanvas(this.canvas,s);
        if (s.commands.length < 60000 && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) s.commands.push(['set', name, v]);
        else s.unsupported = true;
      }});
    });
    ['save','restore','beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','arc','arcTo','ellipse','rect','fill','stroke','clip','fillRect','strokeRect','clearRect','fillText','strokeText','translate','rotate','scale','transform','setTransform','resetTransform','setLineDash','drawImage','putImageData'].forEach(function (name) {
      var fn = proto[name]; if (!fn) return;
      proto[name] = function () {
        var s = state(this.canvas);
        if (name === 'clearRect' && !s.depth && arguments[0] === 0 && arguments[1] === 0 && arguments[2] >= this.canvas.width && arguments[3] >= this.canvas.height) {
          s.commands = []; s.unsupported = false;
          // Reuse verified native styles across full redraws instead of
          // calling every native property getter on every full clear.
          if(s.clearVersion!==s.styleVersion){
            s.clearState=[];
            for(var i=0;i<props.length;i++){var value=this[props[i]];if(typeof value!=='object')s.clearState.push(['set',props[i],value]);}
            s.clearVersion=s.styleVersion;
          }
          s.commands=s.clearState.slice();
          if (this.getTransform) { var t = this.getTransform(); s.commands.push(['setTransform',t.a,t.b,t.c,t.d,t.e,t.f]); }
        }
        if (name === 'save') {s.depth++;s.stack.push({assigned:Object.assign({},s.assigned),version:s.styleVersion});}
        if (name === 'restore') {s.depth=Math.max(0,s.depth-1);var saved=s.stack.pop();if(saved){s.assigned=saved.assigned;s.styleVersion=saved.version;}}
        // Keep native drawing and stack bookkeeping at the cap, without making
        // throw-away argument arrays for every subsequent vertex/text call.
        if(s.commands.length>=60000){if(!s.unsupported){s.unsupported=true;markCanvas(this.canvas,s);}return fn.apply(this,arguments);}
        var a=Array.prototype.slice.call(arguments);markCanvas(this.canvas,s);
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
        d.set.call(this, v); canvasState.delete(this); mark(this);
      }});
    });
    // Attribute writes also reset the native bitmap/context, even when the
    // numeric size stays unchanged. Do not reuse styles from before that reset.
    ['setAttribute','setAttributeNS','removeAttribute','removeAttributeNS'].forEach(function(name){
      var fn=HTMLCanvasElement.prototype[name];if(!fn)return;
      HTMLCanvasElement.prototype[name]=function(){
        var result=fn.apply(this,arguments),key=String(arguments[/NS$/.test(name)?1:0]).toLowerCase();
        if(key==='width'||key==='height'){canvasState.delete(this);mark(this);}
        return result;
      };
    });
    if(typeof proto.reset==='function'){
      var resetContext=proto.reset;proto.reset=function(){var result=resetContext.apply(this,arguments);canvasState.delete(this.canvas);mark(this.canvas);return result;};
    }
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
  function serializable(node) {
    return (node.nodeType === 1 || node.nodeType === 3) && !(node.nodeType === 1 && /^(SCRIPT|STYLE|LINK|META|BASE|NOSCRIPT|TEMPLATE|AUDIO|VIDEO|OBJECT|EMBED)$/i.test(node.tagName));
  }
  function read(node, records, deep) {
    if (node.nodeType !== 1 && node.nodeType !== 3) return null;
    if (node.nodeType === 1 && /^(SCRIPT|STYLE|LINK|META|BASE|NOSCRIPT|TEMPLATE|AUDIO|VIDEO|OBJECT|EMBED)$/i.test(node.tagName)) return null;
    var key = id(node), r = { id: key };
    metrics.nodes++; releaseResources(node); readingOwner=node;
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
      if ('value' in node && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) { propertyNodes.add(node); r.value = node.value; r.checked = !!node.checked; }
      r.scroll = [Math.round(node.scrollLeft), Math.round(node.scrollTop)];
      if (node.tagName === 'CANVAS') {
        var s = state(node); s.queued=false; r.canvas = { width: node.width, height: node.height, commands: s.commands.map(function (cmd) {
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
      var view=viewState(node);if(view){r.view=view;viewNodes.add(node);}
      if (node.tagName !== 'IFRAME') Array.prototype.forEach.call(node.childNodes, function (child) {
        if (!serializable(child)) return;
        var cid=id(child);
        if (deep || !currentRecords.has(cid)) read(child,records,true);
        r.children.push(cid);
      });
    }
    readingOwner=null; records.set(key, r); return key;
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
    if (!socket || socket.readyState !== 1 || !subscribed || !document.body || !document.querySelector('#FullScreen')) return;
    if (socket.bufferedAmount > 2000000) { force = true; return; }
    var now=Date.now(), started=performance.now(), records=new Map(), removed=[], changed=[];
    metrics.snapshots++;
    if (force) {
      metrics.full++; live.clear(); currentRecords.clear(); propertyNodes.clear(); viewNodes.clear(); previous.clear();
      resourceOwners.forEach(function(_,owner){releaseResources(owner);});
      rootKey=read(document.body,records,true); cssDirty=true; geometryDirty=true;
    } else {
      // Only detached subtrees need removal work. Reparented nodes retain IDs.
      function forget(key) {
        var node=live.get(key), old=currentRecords.get(key);
        if (!node || document.documentElement.contains(node)) return;
        if (old && old.children) old.children.forEach(forget);
        releaseResources(node); propertyNodes.delete(node); viewNodes.delete(node); dirtyNodes.delete(node);
        live.delete(key); currentRecords.delete(key); previous.delete(key); removed.push(key);
      }
      detachedRoots.forEach(function(node){if(ids.has(node))forget(ids.get(node));});
      dirtyNodes.forEach(function(node){
        if (document.body.contains(node) && serializable(node)) read(node,records,false);
      });
      viewNodes.forEach(function(node){
        var old=records.get(id(node))||currentRecords.get(id(node));
        if(document.body.contains(node)&&old&&JSON.stringify(old.view)!==JSON.stringify(viewState(node)))read(node,records,false);
      });
    }
    dirtyNodes.clear(); detachedRoots.clear();
    // Programmatic value/checked assignments do not emit DOM mutations.
    // Poll only form controls, never the entire document or all scroll offsets.
    if (now-lastPoll>=1000) {
      lastPoll=now; geometryDirty=true; aircraftCache=aircraftLabel();
      propertyNodes.forEach(function(node){
        var old=records.get(id(node)) || currentRecords.get(id(node));
        if (old && (old.value!==node.value || old.checked!==!!node.checked)) read(node,records,false);
      });
    }
    if (cssDirty) {
      releaseResources('styles'); readingOwner='styles';
      styleCache=styles(); linksCache=stylesheetLinks(); readingOwner=null;
      styleKeyCache=styleCache+JSON.stringify(linksCache); cssDirty=false; metrics.cssBuilds++;
    }
    var styleKey=styleKeyCache, styleChanged=styleKey!==lastStyle;
    if (geometryDirty || !geometryCache) {
      var rect=(document.querySelector('pmdg-tablet') || document.querySelector('#FullScreen')).getBoundingClientRect();
      geometryCache={x:rect.left,y:rect.top,width:rect.width,height:rect.height}; geometryDirty=false;
    }
    records.forEach(function(r,key){
      var json=JSON.stringify(r); if(force || previous.get(key)!==json)changed.push(r);
      currentRecords.set(key,r); previous.set(key,json);
    });
    var geometry=JSON.stringify([innerWidth,innerHeight,geometryCache,aircraftCache]);
    if (force || changed.length || removed.length || styleChanged || geometry!==lastGeometry || viewAcks.length) {
      var msg={type:force?'frame':'patch',epoch:epoch,seq:++sequence,root:rootKey,nodes:changed,removed:removed,width:innerWidth,height:innerHeight,contentRect:geometryCache,aircraft:aircraftCache};
      if(force || styleChanged){msg.css=styleCache;msg.stylesheets=linksCache;}
      if(viewAcks.length)msg.viewAcks=viewAcks.slice(0,128);
      if(send(msg)){if(msg.viewAcks)viewAcks.splice(0,msg.viewAcks.length);lastStyle=styleKey;lastGeometry=geometry;force=false;}else force=true;
    }
    var elapsed=performance.now()-started;
    metrics.totalMs+=elapsed; metrics.maxMs=Math.max(metrics.maxMs,elapsed);
    // Expensive map/canvas updates must leave time for the simulator renderer.
    nextSnapshot=now+Math.min(1500,elapsed*25);
  }
  try {
    observer=new MutationObserver(function(changes){
      changes.forEach(function(m){
        var el=m.target.nodeType===1?m.target:m.target.parentElement;
        if (el && (el.closest('head,style') || el.tagName==='LINK')) cssDirty=true;
        if (m.type==='childList') {
          Array.prototype.forEach.call(m.removedNodes,function(n){detachedRoots.add(n);});
          // Body-level style/link insertion also changes the stylesheet set.
          Array.prototype.forEach.call(m.addedNodes,function(n){if(n.nodeType===1 && (n.matches('style,link') || n.querySelector('style,link')))cssDirty=true;});
          Array.prototype.forEach.call(m.removedNodes,function(n){if(n.nodeType===1 && (n.matches('style,link') || n.querySelector('style,link')))cssDirty=true;});
        }
        mark(m.target); geometryDirty=true;
      });
    });
  } catch (_) { observer=null; }
  // Sheet APIs do not emit MutationObserver records. Keep these edits coherent.
  if (window.CSSStyleSheet) ['insertRule','deleteRule','addRule','removeRule','replaceSync','replace'].forEach(function(name){
    var original=CSSStyleSheet.prototype[name]; if(typeof original!=='function')return;
    try { CSSStyleSheet.prototype[name]=function(){var result=original.apply(this,arguments);cssDirty=true;
      if(result && typeof result.then==='function')result.then(function(){cssDirty=true;},function(){});return result;}; } catch(_){}
  });
  ['input','change','scroll'].forEach(function(name){document.addEventListener(name,function(e){mark(e.target);},true);});
  document.addEventListener('load',function(e){if(e.target && e.target.tagName==='LINK')cssDirty=true;},true);
  window.addEventListener('resize',function(){geometryDirty=true;});
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
    if(name==='view-scroll'||name==='view-map'){
      if(typeof m.token!=='string'||m.token.length>80||!m.token||viewAcks.length>=128)return;
      var ok=false;
      if(name==='view-scroll'&&Number.isFinite(m.x)&&Number.isFinite(m.y)&&m.x>=0&&m.y>=0&&m.x<=20000000&&m.y<=20000000){
        var view=viewState(n);
        if(!m.viewKey||(view&&view.key===m.viewKey)){n.scrollLeft=m.x;n.scrollTop=m.y;ok=true;}
      }
      if(name==='view-map'&&Number.isFinite(m.lat)&&Number.isFinite(m.lon)&&Math.abs(m.lat)<=85.05112879&&Math.abs(m.lon)<=180&&Number.isFinite(m.zoom)&&Number.isFinite(m.bearing)){
        try{ok=!!(window.PMDGLanViewAdapter&&window.PMDGLanViewAdapter.commitMap(n,m));}catch(_){}
        // Capture the changed view, tile transforms and marker positions in one
        // patch after the current native handler turn has completed.
        mark(n);if(n.querySelectorAll)n.querySelectorAll('*').forEach(mark);
      }
      mark(n);viewAcks.push({id:m.id,token:m.token,ok:ok});nextSnapshot=0;return;
    }
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
    s.onopen = function () { if (socket !== s) return; clearTimeout(timeout); lastReceive = Date.now(); force = true; setSubscribed(false); resetResources(); };
    s.onmessage = function (e) { if (socket !== s) return; lastReceive = Date.now(); try { var m = JSON.parse(e.data); if (m.type === 'subscribers') { setSubscribed(m.count > 0); if (subscribed) { force = true; nextSnapshot=0; } } else if (m.type === 'resync') { if (subscribed) { force = true; nextSnapshot=0; } } else if (m.type === 'ping') send({type:'pong'}); else if (m.type === 'action') action(m); else if (m.type === 'resource-ack') resources.forEach(function (r) { if (r.id === m.id) { r.uploaded = !!m.ok; r.awaiting = false; r.offset = 0; r.retryAt = m.ok ? 0 : Date.now()+10000; r.owners.forEach(function(owner){if(owner==='styles')cssDirty=true;else mark(owner);}); } }); } catch (_) {} };
    s.onerror = function () { s.close(); };
    s.onclose = function () { if (socket !== s) return; clearTimeout(timeout); setSubscribed(false); socket = null; retry = setTimeout(connect, 3000); };
  }
  // No background DOM traversal unless a browser is actually subscribed.
  setInterval(function () {
    if (socket && socket.readyState === 1 && Date.now() - lastReceive > 35000) { socket.close(); return; }
    if (subscribed && socket && socket.readyState === 1 && Date.now()>=nextSnapshot) {
      // Compatibility fallback for an engine without MutationObserver.
      if (!observer) force=true;
      try { snapshot(); } catch (_) { metrics.errors++; readingOwner=null; force=true; nextSnapshot=Date.now()+1500; }
    }
  }, 250);
  setInterval(pumpResources, 40);
  window.addEventListener('beforeunload', function () { clearTimeout(retry); if (socket) { socket.onclose = null; socket.close(); } });
  connect();
}());
