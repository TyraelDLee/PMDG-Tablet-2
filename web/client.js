(function () {
  'use strict';
  const frame = document.getElementById('screen'), viewport = document.getElementById('viewport');
  const surface = document.getElementById('surface');
  const status = document.getElementById('status'), offline = document.getElementById('offline');
  const pair = document.getElementById('pair'), side = document.getElementById('side');
  // Keep browser-owned controls intact across patches, resyncs and CA/FO changes.
  const controls = document.getElementById('lan-controls');
  const reconnect = document.getElementById('reconnect');
  const aircraft = document.getElementById('lan-aircraft');
  let currentAircraft='', lastAircraft='';
  function mountControls(enabled) {
    const bar = doc.getElementById('StatusBar');
    const slot = doc.getElementById('statusbar_time')?.nextElementSibling;
    const nativeSlot = slot?.parentElement?.parentElement === bar && slot.classList.contains('col-md-2') && !slot.id;
    const target = enabled && bar ? (nativeSlot ? slot : bar) : offline;
    controls.classList.toggle('lan-controls-overlay', target === bar);
    if (controls.parentElement !== target) target.appendChild(controls);
  }
  let socket, retry, timeout, epoch, sequence = 0, width = 1280, height = 1024, scale = 1, online = false;
  let serverTime = 0, localTime = 0, lastReceive = 0;
  let contentRect = null, rootId;
  let gestures;
  let nodes = new Map(), records = new Map(), inputGuard = new WeakMap(), images = new Map();
  let doc = frame.contentDocument;
  doc.open(); doc.write('<!doctype html><html><head><style id="native-css"></style><style>html,body{margin:0;overflow:hidden}iframe{border:0}body{font-family:Arial,sans-serif}canvas[data-incomplete] {outline:1px dashed #a98b4d}</style></head><body></body></html>'); doc.close();
  const css = doc.getElementById('native-css');
  const fixes = doc.createElement('link');
  fixes.rel = 'stylesheet'; fixes.href = '/client-fixes.css';
  doc.head.appendChild(fixes);
  const controlStyle = doc.createElement('link');
  controlStyle.rel='stylesheet'; controlStyle.href='/lan-controls.css'; doc.head.appendChild(controlStyle);
  const stylesheetNodes = new Map();
  gestures = window.EfbLanGestures({doc,record:n=>records.get(n.__efbId),online:()=>online,action:(...args)=>action(...args),repaint:(n,deep)=>render(viewRecords(n,deep))});
  function viewRecords(n,deep) {
    if(!n)return Array.from(records.values());
    const found=[];function visit(id){const r=records.get(id);if(!r)return;found.push(r);if(deep)for(const child of r.children||[])visit(child);}visit(n.__efbId);return found;
  }
  function fit() {
    // Keep native layout/coordinates intact, but exclude unused simulator texture
    // space from the fit calculation. The outer surface clips that space away.
    frame.style.width = width + 'px'; frame.style.height = height + 'px';
    const measured = (doc.querySelector('pmdg-tablet') || doc.getElementById('FullScreen'))?.getBoundingClientRect();
    let r = contentRect || measured;
    if (!r || ![r.x,r.y,r.width,r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0)
      r = {x:0,y:0,width,height};
    // Auto Cruise is nested inside the status bar. Its fixed overlay must cover
    // the visible tablet, not the unused part of the simulator texture.
    for (const key of ['x','y','width','height'])
      doc.documentElement.style.setProperty('--efb-lan-view-' + key, r[key] + 'px');
    scale = Math.min(viewport.clientWidth / r.width, viewport.clientHeight / r.height);
    surface.style.width = r.width * scale + 'px'; surface.style.height = r.height * scale + 'px';
    surface.style.left = (viewport.clientWidth - r.width * scale) / 2 + 'px';
    surface.style.top = (viewport.clientHeight - r.height * scale) / 2 + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    frame.style.left = -r.x * scale + 'px'; frame.style.top = -r.y * scale + 'px';
  }
  // Installed web apps need an opaque top-level surface, outside the mirrored iframe.
  // navigator.standalone covers iOS versions without display-mode media support.
  const standaloneMode = window.matchMedia('(display-mode: standalone)');
  function updateDisplayMode() {
    document.documentElement.classList.toggle('efb-standalone', navigator.standalone === true || standaloneMode.matches);
    fit();
  }
  if (standaloneMode.addEventListener) standaloneMode.addEventListener('change', updateDisplayMode);
  else standaloneMode.addListener(updateDisplayMode);
  window.addEventListener('pageshow', updateDisplayMode);
  updateDisplayMode();
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(viewport);
  window.visualViewport?.addEventListener('resize', fit);
  fit();
  function state(text, enabled) {
    if(!enabled&&gestures.cancelAll())render(Array.from(records.values()));
    status.textContent = text; online = enabled; offline.hidden = enabled;
    aircraft.textContent=enabled?(currentAircraft||'—'):(lastAircraft?'Last used: '+lastAircraft:'—');
    aircraft.setAttribute('aria-label',enabled?'Current aircraft':'Last used aircraft');
    mountControls(enabled);
  }
  function send(m) { if (socket && socket.readyState === 1) socket.send(JSON.stringify(m)); }
  function safeUrl(v) { return /^(\/assets\/|\/resources\/|https?:\/\/|data:image\/|#)/i.test(v) ? v : ''; }
  const valueTimers = new WeakMap();
  function syncValue(n, r, sourceEpoch) {
    clearTimeout(valueTimers.get(n)); valueTimers.delete(n);
    if (sourceEpoch !== epoch || nodes.get(r.id) !== n || !('value' in r)) return;
    const remaining = 1201 - (Date.now() - (inputGuard.get(n) || 0));
    if (remaining > 0) {
      // Do not discard a server-side conversion while protecting active typing.
      // Reconcile the newest record once the existing input guard expires.
      if (n.value !== r.value || n.checked !== r.checked) valueTimers.set(n, setTimeout(() => {
        const latest = records.get(r.id);
        if (latest) syncValue(n, latest, sourceEpoch);
      }, remaining));
      return;
    }
    if (n.value !== r.value) n.value = r.value;
    if ('checked' in r) n.checked = r.checked;
  }
  function update(r) {
    let n = nodes.get(r.id);
    if (!n) { n = r.tag ? doc.createElementNS(r.ns || 'http://www.w3.org/1999/xhtml', r.tag) : doc.createTextNode(''); nodes.set(r.id, n); n.__efbId = r.id; }
    if (!r.tag) { if (n.nodeValue !== r.text) n.nodeValue = r.text; return; }
    for (const a of Array.from(n.attributes)) if (!(a.name in r.attrs) && a.name !== 'data-incomplete') n.removeAttribute(a.name);
    for (const [k, v] of Object.entries(r.attrs)) {
      if (/^on/i.test(k) || /^(srcdoc|autofocus)$/i.test(k)) continue;
      const value = /^(src|href|xlink:href)$/i.test(k) ? safeUrl(v) : v;
      if (n.getAttribute(k) !== value) n.setAttribute(k, value);
    }
    if (r.tag === 'iframe') { n.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms'); if (r.frameUnavailable) n.title = '此嵌入页面需要单独适配，请使用模拟器内 EFB'; }
    if ('value' in r) syncValue(n, r, epoch);
    if (r.canvas) draw(n, r.canvas);
  }
  async function draw(n, data) {
    const revision = (n.__revision || 0) + 1; n.__revision = revision;
    const loaded = new Map();
    for (const cmd of data.commands) if (cmd[0] === 'drawImage' && cmd[1]?.image) {
      const url = safeUrl(cmd[1].image); if (!url) continue;
      if (!images.has(url)) images.set(url, new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = url; }));
      loaded.set(url, await images.get(url));
    }
    if (n.__revision !== revision) return;
    n.width = data.width; n.height = data.height; const ctx = n.getContext('2d');
    n.toggleAttribute('data-incomplete', data.unsupported); n.title = data.unsupported ? '此图形含暂未支持的绘图操作，请以模拟器内显示为准' : '';
    const allowed = new Set(['save','restore','beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','arc','arcTo','ellipse','rect','fill','stroke','clip','fillRect','strokeRect','clearRect','fillText','strokeText','translate','rotate','scale','transform','setTransform','resetTransform','setLineDash','drawImage']);
    for (const cmd of data.commands) { try { if (cmd[0] === 'set' && typeof ctx[cmd[1]] !== 'function' && cmd[1] !== '__proto__') ctx[cmd[1]] = cmd[2]; else if (allowed.has(cmd[0])) { const a = cmd.slice(1); if (cmd[0] === 'drawImage') { a[0] = loaded.get(a[0].image); if (!a[0]) continue; } ctx[cmd[0]](...a); } } catch (_) {} }
  }
  function apply(m) {
    if (m.type === 'frame') { if (epoch !== m.epoch) { gestures.cancelAll();nodes.clear(); doc.body.replaceChildren(); } epoch = m.epoch; sequence = 0; records.clear(); }
    else if (m.epoch !== epoch || m.seq !== sequence + 1) { send({type:'resync'}); return; }
    sequence = m.seq; rootId=m.root; width = m.width; height = m.height;
    contentRect = m.contentRect || null;
    if (m.css !== undefined) css.textContent = m.css;
    if (m.stylesheets) {
      for (const [url, link] of stylesheetNodes) if (!m.stylesheets.includes(url)) { link.remove(); stylesheetNodes.delete(url); }
      for (const url of m.stylesheets) if (safeUrl(url) && !stylesheetNodes.has(url)) {
        const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = safeUrl(url); link.onload = fit; doc.head.insertBefore(link, css); stylesheetNodes.set(url, link);
      }
    }
    for (const r of m.nodes) records.set(r.id, r);
    for (const id of m.removed || []) records.delete(id);
    const refresh=gestures.receive(m);
    for (const id of m.removed || []) { const n=nodes.get(id);if(!n||gestures.deferred(n))continue;n.remove();nodes.delete(id); }
    if(refresh.length){
      const updated=new Map(m.nodes.map(r=>[r.id,r]));
      for(const item of refresh)for(const r of viewRecords(item.n,item.deep))updated.set(r.id,r);
      render(Array.from(updated.values()));
    }else render(m.nodes);
    // This selector is visible only in native Navigraph mode. Keep the marker on
    // the LAN document root so it is never sent back to the simulator's DOM.
    doc.documentElement.classList.toggle('efb-lan-navi-mode', !!doc.getElementById('efb_dashboard_map_leaflet_source')?.classList.contains('visible'));
    currentAircraft=typeof m.aircraft === 'string'&&m.aircraft&&m.aircraft!=='—'?m.aircraft:'';
    if(currentAircraft)lastAircraft=currentAircraft;
    fit(); state('Connected · ' + side.value + ' · Simulator EFB', true);
  }
  function render(updated) {
    for (const r of updated) if(!nodes.has(r.id)||!gestures.deferred(nodes.get(r.id)))update(r);
    // Reconcile in place: unchanged native inputs and GSX/BATC frames retain their state.
    for (const r of records.values()) if (r.children) {
      const n = nodes.get(r.id);if(!n||gestures.deferred(n))continue;let at = n.firstChild;
      for (const id of r.children) { const child = nodes.get(id); if (!child) continue; if (at !== child) n.insertBefore(child, at); at = child.nextSibling; }
      while (at) { const next = at.nextSibling; if (at !== controls) at.remove(); at = next; }
    }
    const root = nodes.get(rootId); if (root && doc.body !== root) doc.body.replaceWith(root);
    for (const [id, n] of nodes) if (!records.has(id)&&!gestures.deferred(n)) { n.remove(); nodes.delete(id); }
    for (const r of updated) if(r.scroll&&nodes.has(r.id))gestures.applyScroll(nodes.get(r.id),r.scroll);
    if(gestures.afterPatch())render(Array.from(records.values()));
  }
  function action(n, event, extra) { if (!online || !serverTime || !n?.__efbId) return; send(Object.assign({type:'action',epoch,id:n.__efbId,event,createdAt:Math.round(serverTime + performance.now() - localTime)}, extra)); }
  for (const name of ['input','change']) doc.addEventListener(name, e => { inputGuard.set(e.target, Date.now()); action(e.target, name, {value:e.target.value,checked:e.target.checked}); }, true);
  for (const name of ['keydown','keyup']) doc.addEventListener(name, e => { if (controls.contains(e.target)) return; if (e.key === 'Enter') e.preventDefault(); action(e.target, name, {key:e.key,code:e.code,keyCode:e.keyCode}); }, true);
  let controlTouch = null, lastControlTouch = null;
  function touchControl(target) {
    if (!target?.closest || controls.contains(target) || target.closest('.leaflet-container,input,select,textarea,[contenteditable]')) return null;
    return target.closest('.custom-select .option') || target.closest('button,.custom-select');
  }
  function disabledControl(n) { return !n || n.matches(':disabled') || !!n.closest('[aria-disabled="true"],.custom-select.disabled,.custom-select-disabled'); }
  function compatibilityMouse(e) {
    if (!lastControlTouch || Date.now() > lastControlTouch.until || e.detail === 0 || controls.contains(e.target)) return false;
    if (e.sourceCapabilities?.firesTouchEvents === false || e.pointerType === 'mouse') return false;
    return Math.hypot(e.clientX-lastControlTouch.x,e.clientY-lastControlTouch.y)*scale < 25;
  }
  // Wait for release before sending a single bounded tap. Do not prevent touchstart:
  // users must still be able to scroll a long options list or the ground-ops page.
  doc.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { if (controlTouch) controlTouch.cancelled = true; return; }
    const target = touchControl(e.target);
    if (!target?.__efbId || disabledControl(target)) return;
    const t=e.touches[0];
    controlTouch={target,id:t.identifier,x:t.clientX,y:t.clientY,started:Date.now(),cancelled:false};
  },{capture:true,passive:true});
  doc.addEventListener('touchmove', e => {
    if (!controlTouch) return;
    const t=Array.from(e.touches).find(t=>t.identifier===controlTouch.id);
    if (!t || e.touches.length!==1 || Math.hypot(t.clientX-controlTouch.x,t.clientY-controlTouch.y)*scale>10) controlTouch.cancelled=true;
  },{capture:true,passive:true});
  for (const name of ['touchend','touchcancel']) doc.addEventListener(name,e=>{
    const g=controlTouch; if (!g) return;
    const t=Array.from(e.changedTouches).find(t=>t.identifier===g.id); if (!t) return;
    controlTouch=null;
    lastControlTouch={x:t.clientX,y:t.clientY,until:Date.now()+800};
    if (e.cancelable) e.preventDefault();
    if (name==='touchcancel' || g.cancelled || e.touches.length || Date.now()-g.started>650 ||
        Math.hypot(t.clientX-g.x,t.clientY-g.y)*scale>10 || !g.target.isConnected || disabledControl(g.target)) return;
    const hit=doc.elementFromPoint(t.clientX,t.clientY);
    if (!hit || !g.target.contains(hit)) return;
    action(g.target,'tap',{x:t.clientX,y:t.clientY});
  },{capture:true,passive:false});
  doc.addEventListener('scroll',e=>{if(controlTouch && e.target.contains?.(controlTouch.target))controlTouch.cancelled=true;},true);
  window.addEventListener('blur',()=>{controlTouch=null;});
  let mouseDragTarget = null;
  for (const name of ['mousedown','mouseup','click']) doc.addEventListener(name, e => {
    if (compatibilityMouse(e)) { e.preventDefault(); return; }
    if (Date.now() < suppressMapMouseUntil && e.target.closest?.('.leaflet-container')) { e.preventDefault(); return; }
    if (name === 'click' && e.target.closest('a')) e.preventDefault();
    if (name === 'mousedown') mouseDragTarget = e.target.closest?.('.leaflet-container');
    // The final mousemove can fall inside the throttle window. Deliver its end
    // position before mouseup so native dragging never stops short of the finger.
    if (name === 'mouseup' && mouseDragTarget) { action(mouseDragTarget,'mousemove',{x:e.clientX,y:e.clientY,buttons:1}); mouseDragTarget = null; }
    action(e.target, name, {x:e.clientX,y:e.clientY,buttons:e.buttons});
  }, true);
  let lastMove = 0; doc.addEventListener('mousemove', e => { if (e.buttons && Date.now() - lastMove > 40) { lastMove = Date.now(); action(e.target,'mousemove',{x:e.clientX,y:e.clientY,buttons:e.buttons}); } }, true);
  // Leaflet in the simulator expects a continuous mouse drag. iPad only emits
  // compatibility mouse events for taps, so convert a single-finger map gesture.
  let mapTouch = null, suppressMapMouseUntil = 0;
  function finishMapTouch(cancelled) {
    if (!mapTouch) return;
    const g = mapTouch; mapTouch = null; suppressMapMouseUntil = Date.now()+800;
    action(g.target,'mousemove',{x:g.x,y:g.y,buttons:1});
    action(g.target,'mouseup',{x:g.x,y:g.y,buttons:0});
    if (!cancelled && !g.moved) action(g.target,'click',{x:g.x,y:g.y,buttons:0});
  }
  doc.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { finishMapTouch(true); return; }
    const map = e.target.closest?.('.leaflet-container');
    if (!map) return;
    if (e.target.closest('.leaflet-control,button,a,input,select,textarea')) { suppressMapMouseUntil = 0; return; }
    e.preventDefault(); const t = e.touches[0];
    mapTouch = {target:map,id:t.identifier,x:t.clientX,y:t.clientY,startX:t.clientX,startY:t.clientY,moved:false,last:0};
    suppressMapMouseUntil = Date.now()+800;
    action(map,'mousedown',{x:t.clientX,y:t.clientY,buttons:1});
  },{capture:true,passive:false});
  doc.addEventListener('touchmove', e => {
    if (!mapTouch) return; e.preventDefault();
    const t = Array.from(e.touches).find(t=>t.identifier===mapTouch.id); if (!t) { finishMapTouch(true); return; }
    const g = mapTouch; g.x = t.clientX; g.y = t.clientY;
    g.moved ||= Math.abs(g.x-g.startX)+Math.abs(g.y-g.startY)>5;
    if (Date.now()-g.last>=40) { g.last=Date.now(); action(g.target,'mousemove',{x:g.x,y:g.y,buttons:1}); }
  },{capture:true,passive:false});
  for (const name of ['touchend','touchcancel']) doc.addEventListener(name,e=>{
    if (!mapTouch) return; e.preventDefault();
    const t = Array.from(e.changedTouches).find(t=>t.identifier===mapTouch.id);
    if (t) { mapTouch.x=t.clientX; mapTouch.y=t.clientY; finishMapTouch(name==='touchcancel'); }
  },{capture:true,passive:false});
  window.addEventListener('blur',()=>finishMapTouch(true));
  function connect() {
    gestures.cancelAll();finishMapTouch(true); controlTouch=null;
    clearTimeout(retry); if (socket) { socket.onclose = null; socket.close(); }
    state('Connecting…', false);
    const s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/client?side=' + side.value); socket = s;
    timeout = setTimeout(() => s.close(), 8000);
    s.onopen = () => { clearTimeout(timeout); lastReceive = Date.now(); serverTime = 0; pair.hidden = true; send({type:'resync'}); };
    s.onmessage = e => { if (socket !== s) return; lastReceive = Date.now(); const m = JSON.parse(e.data); if (m.type === 'ping') { serverTime = m.now; localTime = performance.now(); send({type:'pong'}); } else if (m.type === 'host') state(m.online ? 'Synchronizing EFB…' : 'Waiting for MSFS to load an aircraft and open the EFB…', false); else if (m.type === 'frame' || m.type === 'patch') apply(m); };
    s.onclose = async () => { if (socket !== s) return; clearTimeout(timeout); state('Disconnected. Reconnecting…', false); try { const r = await fetch('/session'); if (socket !== s) return; if (r.status === 401) { pair.hidden = false; state('Enter your pairing code again.',false); return; } } catch (_) {} if (socket === s) retry = setTimeout(connect, 3000); };
  }
  setInterval(() => { if (socket?.readyState === 1 && Date.now() - lastReceive > 35000) { state('Connection timed out. Retrying…',false); socket.close(); } }, 1000);
  pair.addEventListener('submit', async e => { e.preventDefault(); const r = await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:document.getElementById('key').value})}); if (r.ok) { pair.hidden = true; connect(); } else document.getElementById('pair-error').textContent = r.status === 429 ? 'Too many attempts. Try again in one minute.' : 'Incorrect pairing code.'; });
  // A new browser session always opens the captain's tablet, regardless of old preferences.
  side.value = 'CA';
  side.onclick = () => {
    side.value = side.value === 'CA' ? 'FO' : 'CA';
    side.setAttribute('aria-checked',String(side.value === 'FO'));
    gestures.cancelAll();epoch = null; sequence = 0; nodes.clear(); records.clear(); doc.body.replaceChildren(); connect();
  };
  reconnect.onclick = () => { if(gestures.cancelAll())render(Array.from(records.values()));if (socket?.readyState === 1) send({type:'resync'}); else connect(); };

  fetch('/session').then(r => { if (r.ok) connect(); else { pair.hidden = false; state('Pair your EFB to continue.', false); } }).catch(() => state('Unable to reach the bridge.',false));
}());
