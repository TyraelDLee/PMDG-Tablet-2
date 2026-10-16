const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function({native,remote,screen,tablet,output,until,logs}){
 const dir=path.join(tablet,'pmdg-777-300ER');
 const code=fs.readFileSync(path.join(dir,'PMDGTablet.js'),'utf8');
 const classes=code.slice(code.indexOf('class Popup extends DisplayComponent'),code.indexOf('class StatusBar extends DisplayComponent'));
 const css=fs.readFileSync(path.join(dir,'PMDGTablet.css'),'utf8');
 await native.evaluate(({classes,css})=>{
  // Render PMDG's actual Popup and AutoCruisePopup, without starting its avionics.
  class DisplayComponent{constructor(props){this.props=props;}}
  const getAircraftBroadFamily=()=> '777';
  const FSComponent={buildComponent(tag,props,...children){
   if(typeof tag==='function')return new tag(props).render();
   const n=document.createElement(tag);for(const [k,v]of Object.entries(props||{}))n.setAttribute(k,v);
   for(const child of children.flat())if(child!=null)n.append(child);return n;
  }};
  const popup=eval(classes+'; FSComponent.buildComponent(AutoCruisePopup, {bus:{}})');
  const style=document.createElement('style');style.textContent=css+'#StatusBar{position:static}';document.head.appendChild(style);
  document.querySelector('#StatusBar>.row').append(popup);
  const button=document.createElement('button');button.id='statusbar_autocruise_open';button.textContent='AUTO CRUISE';
  document.querySelector('#StatusBar>.row>.col-md-1').replaceChildren(button);
  button.onclick=()=>document.getElementById('autocruise_popup').style.display='block';
  document.getElementById('autocruise_close').onclick=()=>document.getElementById('autocruise_popup').style.display='none';
  document.getElementById('autocruise_reset').onclick=()=>document.getElementById('autocruise_sim_rate').textContent='RESET';
  const performance=document.createElement('div');performance.style.cssText='position:absolute;top:1300px;left:30px;width:700px';
  performance.innerHTML='<button class="opt_clear">Clear</button><button class="opt_calculate">Calculate</button><button class="opt_calculate" disabled>Calculate</button>';
  document.getElementById('FullScreen').append(performance);
 },{classes,css});
 await screen.locator('#statusbar_autocruise_open').waitFor();
 await screen.locator('#statusbar_autocruise_open').tap();
 await until(async()=>await screen.locator('#autocruise_popup').isVisible(),'Auto Cruise did not open');
 for(const size of [{width:1194,height:834},{width:834,height:1194},{width:1920,height:1080}]){
  await remote.setViewportSize(size);
  const metrics=await screen.locator('#autocruise_popup').evaluate(n=>{
   const r=n.getBoundingClientRect(),c=n.querySelector('.popup-content').getBoundingClientRect(),v=document.getElementById('FullScreen').getBoundingClientRect();
   return {r:r.toJSON(),c:c.toJSON(),v:v.toJSON(),shade:getComputedStyle(n).backgroundColor,bg:getComputedStyle(n.querySelector('.popup-content')).backgroundColor};
  });
  for(const k of ['x','y','width','height'])assert.ok(Math.abs(metrics.r[k]-metrics.v[k])<1,'Overlay '+k+JSON.stringify(metrics));
  assert.ok(Math.abs(metrics.c.x+metrics.c.width/2-metrics.v.x-metrics.v.width/2)<1);
  assert.ok(Math.abs(metrics.c.y+metrics.c.height/2-metrics.v.y-metrics.v.height/2)<1);
  assert.equal(metrics.shade,'rgba(0, 0, 0, 0.7)');assert.equal(metrics.bg,'rgb(71, 77, 82)');
  assert(await screen.locator('#autocruise_reset').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));
 }
 await screen.locator('#autocruise_reset').tap();
 await until(async()=>await screen.locator('#autocruise_sim_rate').textContent()==='RESET','Popup interaction not bridged');
 await remote.setViewportSize({width:1194,height:834});
 await remote.screenshot({path:path.join(output,'autocruise-popup.png')});
 await screen.locator('#autocruise_close').tap();
 await until(async()=>await screen.locator('#autocruise_popup').isHidden(),'Auto Cruise did not close');
 for(const selector of ['#statusbar_autocruise_open','button.opt_clear','button.opt_calculate:not(:disabled)'])
  assert.equal(await screen.locator(selector).evaluate(n=>getComputedStyle(n).color),'rgb(0, 0, 0)');
 assert.equal(await screen.locator('button.opt_calculate:disabled').evaluate(n=>getComputedStyle(n).color),'rgb(156, 155, 153)');
 logs.push('Actual PMDG Auto Cruise markup: full visible-tablet dimming, grey centered dialog in landscape/portrait/desktop; open/reset/close touch roundtrip works; requested button text black with disabled grey retained');
};
