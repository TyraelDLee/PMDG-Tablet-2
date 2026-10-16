const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/leety/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=path.resolve(__dirname,'..'),dir=path.join(base,'landing-analysis');
const Core=require(path.join(dir,'core.js'));
let sample={},readNames=[];
const root={LandingAnalysisCore:Core,addEventListener(){}};
const context={window:root,setInterval:()=>1,clearInterval(){},SimVar:{GetSimVarValue(name){readNames.push(name);return sample[name]??0},SetSimVarValue(){}}};
vm.runInNewContext(fs.readFileSync(path.join(dir,'host.js'),'utf8'),context);
const service=new root.LandingAnalysisService('CA');
function tick(i,ground,zulu){sample={'E:SIMULATION TIME':i*.02,TITLE:'PMDG test','SIM ON GROUND':ground,'PLANE ALT ABOVE GROUND':ground?0:50,'VELOCITY BODY Z':200,'AIRSPEED INDICATED':130,'GROUND VELOCITY':125,'VERTICAL SPEED':-2,'G FORCE':1.15,'PLANE TOUCHDOWN NORMAL VELOCITY':2,'PLANE TOUCHDOWN PITCH DEGREES':-4,'E:ZULU YEAR':2030,'E:ZULU MONTH OF YEAR':12,'E:ZULU DAY OF MONTH':31,'E:ZULU TIME':zulu};service.tick();}
for(let i=0;i<80;i++)tick(i,false,86398);
tick(80,true,86399);
for(let i=81;i<85;i++)tick(i,true,10); // Clock subsequently changes: retain first contact.
const record=service.detector.current;
assert.equal(record.zuluTimestamp,Date.UTC(2030,11,31,23,59,59));assert.equal(record.g,1.15);assert.equal(record.rate,-120);
assert(record.timestamp<Date.UTC(2030,0,1));assert(readNames.includes('E:ZULU YEAR'));
const old={...record,id:'legacy'};delete old.zuluTimestamp;
const encoded=JSON.stringify({version:1,records:[old]});assert.equal(JSON.stringify({version:1,records:Core.decodeHistory(encoded)}),encoded);
assert.equal(Core.decodeHistory(JSON.stringify({version:1,records:[record]}))[0].zuluTimestamp,record.zuluTimestamp);
// A failed UTC read must not suppress landing detection or invent real-world UTC.
service.detector.reset();for(let i=0;i<80;i++)tick(i,false,0);for(let i=80;i<85;i++)tick(i,true,NaN);assert.equal(service.detector.current.zuluTimestamp,null);
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try {
 for(const timezoneId of ['Australia/Sydney','America/Los_Angeles']) {
  const page=await browser.newPage({timezoneId,viewport:{width:1600,height:1100}});
  await page.setContent('<style>html,body{margin:0;height:100%}</style><div id="landing_analysis" style="display:flex"></div>');
  const css=path.join(base,'dist/EfbV2-LAN-0.2.11/package/pmdg-tablet-v2/html_ui/Pages/VCockpit/Instruments/PMDGTablet/pmdg-777-300ER/landing-analysis/landing-analysis.css');
  await page.addStyleTag({content:fs.readFileSync(css,'utf8')});await page.addScriptTag({content:fs.readFileSync(path.join(dir,'ui.js'),'utf8')});
  await page.evaluate(({record,old})=>{window.view=new PMDGLandingAnalysis.View(document.getElementById('landing_analysis'),{state:()=>({current:record,history:[record,old],status:'Waiting for flight',storage:'Storage'})});},{record,old});
  assert((await page.locator('.la-current .la-meta').textContent()).startsWith('2030-12-31  23:59:59 Z'));
  assert.equal(await page.locator('.la-status,.la-footer').count(),0);
  await page.locator('.la-history-item').first().click();assert((await page.locator('.la-previous .la-meta').textContent()).startsWith('2030-12-31  23:59:59 Z'));
  assert(!(await page.locator('.la-history-time').nth(1).textContent()).endsWith(' Z'));
  if(timezoneId==='Australia/Sydney')await page.screenshot({path:path.join(base,'tests/results/landing-zulu.png')});
  await page.close();
 }
 console.log('Landing Zulu: simulated date/time at first contact, invalid-clock fallback, legacy persistence, current/history/details and two device time zones passed.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
