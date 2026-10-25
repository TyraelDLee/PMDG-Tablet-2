/* LAN-only view gestures. No intermediate actions leave the browser. */
(function(root){
 'use strict';
 root.EfbLanGestures=function(env){
  const doc=env.doc,states=new Map(),echo=new WeakMap();
  let serial=0,mapTouch=null;
  const session=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const idle=180,ackTimeout=5000;
  function record(n){return env.record(n);}
  function key(n){return record(n)?.view?.key || '';}
  function identity(n){return n.id==='efb_navigraph_chart_container_scroll'?key(n):'';}
  function valid(g){return g.n.isConnected && record(g.n) && (g.kind!=='scroll'||identity(g.n)===g.key);}
  function stopTimer(g){clearTimeout(g.timer);clearTimeout(g.deadline);}
  function release(g){stopTimer(g);states.delete(g.n);if(mapTouch===g)mapTouch=null;}
  function repaint(g){env.repaint(g?.n,g?.kind==='map');}
  function fresh(n,kind){
   let g=states.get(n);if(g&&g.kind===kind&&valid(g))return g;
   if(g)release(g);
   g={n,kind,key:identity(n),x:n.scrollLeft,y:n.scrollTop,touching:false,changed:false,token:null};states.set(n,g);return g;
  }
  function writeScroll(n,x,y){
   if(Math.abs(n.scrollLeft-x)>1 || Math.abs(n.scrollTop-y)>1){n.scrollLeft=x;n.scrollTop=y;echo.set(n,{x:n.scrollLeft,y:n.scrollTop});}
  }
  function finish(g){
   clearTimeout(g.timer);
   if(!valid(g)){release(g);repaint(g);return;}
   if(g.touching)return;
   if(!g.changed){if(!g.token){release(g);repaint(g);}return;}
   if(g.kind==='scroll'){g.x=Math.max(0,Math.min(g.n.scrollWidth-g.n.clientWidth,g.x));g.y=Math.max(0,Math.min(g.n.scrollHeight-g.n.clientHeight,g.y));writeScroll(g.n,g.x,g.y);}
   const token=session+'-'+(++serial);g.token=token;g.changed=false;
   const payload=g.kind==='scroll'?{token,x:g.x,y:g.y,viewKey:g.key}:{token,key:g.view.key,lat:g.final.lat,lon:g.final.lon,zoom:g.view.zoom,bearing:g.view.bearing};
   env.action(g.n,g.kind==='scroll'?'view-scroll':'view-map',payload);
   clearTimeout(g.deadline);g.deadline=setTimeout(()=>{if(states.get(g.n)===g&&g.token===token){release(g);repaint(g);}},ackTimeout);
  }
  function settle(g){clearTimeout(g.timer);g.timer=setTimeout(()=>finish(g),idle);}
  function scrollParent(n){
   while(n&&n!==doc){if(n.nodeType===1&&n.__efbId){const s=doc.defaultView.getComputedStyle(n);if((/auto|scroll/.test(s.overflowY)&&n.scrollHeight>n.clientHeight+1)||(/auto|scroll/.test(s.overflowX)&&n.scrollWidth>n.clientWidth+1))return n;}n=n.parentNode;}
   return null;
  }
  function scroll(e){
   const n=e.target;if(!n?.__efbId||!env.online())return;
   const expected=echo.get(n);if(expected){echo.delete(n);if(Math.abs(n.scrollLeft-expected.x)<1&&Math.abs(n.scrollTop-expected.y)<1)return;}
   const g=fresh(n,'scroll');g.x=n.scrollLeft;g.y=n.scrollTop;g.changed=true;g.token=null;clearTimeout(g.deadline);settle(g);
  }
  function sameView(a,b){return a&&b&&a.key===b.key&&a.source===b.source&&a.locked===b.locked&&Math.abs(a.zoom-b.zoom)<1e-8&&Math.abs(a.bearing-b.bearing)<1e-5;}
  function pan(view,dx,dy){
   const world=256*Math.pow(2,view.zoom),r=view.bearing*Math.PI/180;
   const ux=dx*Math.cos(r)+dy*Math.sin(r),uy=-dx*Math.sin(r)+dy*Math.cos(r);
   const lat=Math.max(-85.05112878,Math.min(85.05112878,view.lat))*Math.PI/180;
   const x=(view.lon+180)/360*world-ux,y=(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2*world-uy;
   return {lat:Math.atan(Math.sinh(Math.PI*(1-2*Math.max(0,Math.min(world,y))/world)))*180/Math.PI,lon:((x/world*360)%360+360)%360-180};
  }
  function preview(g){g.pane.style.transform='translate3d('+g.dx+'px,'+g.dy+'px,0) '+g.transform;}
  function endMap(cancelled){
   const g=mapTouch;if(!g)return;mapTouch=null;g.touching=false;
   if(cancelled){g.dx=g.oldDx;g.dy=g.oldDy;g.final=pan(g.view,g.dx,g.dy);preview(g);if(!g.token){release(g);repaint(g);}return;}
   if(!g.moved){if(!g.token){release(g);repaint(g);env.action(g.n,'mousedown',{x:g.startX,y:g.startY,buttons:1});env.action(g.n,'mouseup',{x:g.startX,y:g.startY,buttons:0});env.action(g.n,'click',{x:g.startX,y:g.startY,buttons:0});}return;}
   finish(g);
  }
  let mapMouseUntil=0;
  doc.addEventListener('touchstart',e=>{
   if(!env.online())return;
   if(e.touches.length!==1){if(mapTouch){e.preventDefault();endMap(true);}for(const g of states.values())if(g.kind==='scroll'){g.touching=false;settle(g);}return;}
   const target=e.target,map=target.closest?.('.leaflet-container');
   if(map&&!target.closest('.leaflet-control,button,a,input,select,textarea')){
    const view=record(map)?.view,pane=map.querySelector('.leaflet-map-pane');
    if(view?.kind!=='map'||!pane)return; // Older hosts keep the existing event path.
    e.preventDefault();e.stopImmediatePropagation();mapMouseUntil=Date.now()+800;
    if(view.locked)return;
    let g=states.get(map);
    if(g&&(!sameView(g.view,view)||g.pane!==pane)){release(g);repaint(g);g=null;}
    if(!g){g=fresh(map,'map');g.view={...view};g.pane=pane;g.transform=pane.style.transform;g.dx=0;g.dy=0;}
    const t=e.touches[0];g.touchId=t.identifier;g.startX=t.clientX;g.startY=t.clientY;g.oldDx=g.dx;g.oldDy=g.dy;g.moved=false;g.touching=true;mapTouch=g;
    return;
   }
   const n=scrollParent(target);if(n){const g=fresh(n,'scroll');g.touching=true;clearTimeout(g.timer);}
  },{capture:true,passive:false});
  doc.addEventListener('touchmove',e=>{
   const g=mapTouch;if(!g)return;
   e.preventDefault();e.stopImmediatePropagation();mapMouseUntil=Date.now()+800;
   if(e.touches.length!==1){endMap(true);return;}
   const t=Array.from(e.touches).find(t=>t.identifier===g.touchId);if(!t){endMap(true);return;}
   if(!g.moved&&Math.hypot(t.clientX-g.startX,t.clientY-g.startY)<5)return;
   g.moved=true;g.token=null;g.changed=true;clearTimeout(g.deadline);
   g.dx=g.oldDx+t.clientX-g.startX;g.dy=g.oldDy+t.clientY-g.startY;g.final=pan(g.view,g.dx,g.dy);preview(g);
  },{capture:true,passive:false});
  for(const name of ['touchend','touchcancel'])doc.addEventListener(name,e=>{
   if(mapTouch){e.preventDefault();e.stopImmediatePropagation();mapMouseUntil=Date.now()+800;endMap(name==='touchcancel'||e.touches.length>0);}
   for(const g of states.values())if(g.kind==='scroll'){g.touching=false;settle(g);}
  },{capture:true,passive:false});
  for(const name of ['mousedown','mousemove','mouseup','click'])doc.addEventListener(name,e=>{
   if(Date.now()<mapMouseUntil&&e.target.closest?.('.leaflet-container')&&!e.target.closest('.leaflet-control,button,a,input,select,textarea')&&e.sourceCapabilities?.firesTouchEvents!==false){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  doc.addEventListener('scroll',scroll,true);
  function deferred(n){if(!states.size)return false;for(const g of states.values())if(g.kind==='map'&&(n===g.pane||g.pane.contains(n)))return true;return false;}
  function receive(m){
   const refresh=[];
   for(const g of Array.from(states.values())){
    const current=record(g.n);
    if(!current||(g.kind==='map'&&!sameView(g.view,current.view))||(g.kind==='scroll'&&g.key!==identity(g.n))){release(g);refresh.push({n:g.n,deep:g.kind==='map'});continue;}
    const ack=(m.viewAcks||[]).find(a=>a.id===g.n.__efbId&&a.token===g.token);
    if(ack){if(ack.ok&&g.touching){g.token=null;clearTimeout(g.deadline);}else{release(g);refresh.push({n:g.n,deep:g.kind==='map'});}}
   }
   return refresh;
  }
  function afterPatch(){
   let released=false;
   for(const g of Array.from(states.values())){
    if(!valid(g)||!g.n.getClientRects().length){release(g);released=true;continue;}
    if(g.kind==='scroll')writeScroll(g.n,g.x,g.y);else preview(g);
   }
   return released;
  }
  function cancelAll(){const had=states.size>0;for(const g of states.values())stopTimer(g);states.clear();mapTouch=null;return had;}
  root.addEventListener('blur',()=>{if(cancelAll())repaint();});
  root.addEventListener('resize',()=>{if(cancelAll())repaint();});
  return {receive,deferred,afterPatch,cancelAll,applyScroll(n,xy){if(!states.has(n))writeScroll(n,xy[0],xy[1]);}};
 };
})(window);
