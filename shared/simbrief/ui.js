(function(root){
 'use strict';
 var C=root.PMDGSimBriefCore;
 function el(tag,cls,text,parent){var n=document.createElement(tag);n.className=cls || '';if(text!=null)n.textContent=text;if(parent)parent.appendChild(n);return n;}
 function button(text,parent,fn){var n=el('button','sb-button',text,parent);n.type='button';n.onclick=fn;return n;}
 function options(node,items,value){node._choices=items.map(function(i){return {value:String(i.value),label:String(i.label)};});node.value=value!=null&&node._choices.some(function(i){return i.value===String(value);})?String(value):node._choices.length?node._choices[0].value:'';if(node._sync)node._sync();}
 function plainOFP(html){
  var text=String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div|pre|tr|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,'');
  var decoder=document.createElement('textarea');decoder.innerHTML=text.replace(/</g,'&lt;');return decoder.value.trim();
 }
 function View(page,env){
  var fields={},groups=[],frames=[],ready=false,busy=false,cancelling=false,initialized=false,client=new root.PMDGSimBriefClient(setSignedIn),picker=null,tools=null,navButtons={},activeTab='edit',additionalOptions={};
  var planningBusy=false,airlabs=new root.PMDGAirlabsClient();
  var routeView=null,active=false,autoCallsign='',autoAlternate='',planningTimer=null,planningVersion=0,alternateKey='',calendar=null,autoRoute='',routeKey='',suggestionKey='',planningReads={};
  function simNow(){return C.utcInput(C.simulatorUTC(root.SimVar));}
  var preferenceKey='PMDG_EFB_SIMBRIEF_PREFER_INSTALLED_V1',preferInstalled=true;
  try{preferInstalled=!(root.GetStoredData&&root.GetStoredData(preferenceKey)==='0');}catch(_){}
  var header=el('header','sb-header',null,page),title=el('div','',null,header);el('h1','','SimBrief',title);el('p','sb-subtitle','Flight planning',title);
  var actions=el('div','sb-actions',null,header),preference=el('div','sb-installed-preference',null,actions);el('span','','Prefer installed airport:',preference);
  var preferSwitch=button('',preference,function(){if(busy||planningBusy)return;preferInstalled=!preferInstalled;syncPreference();try{if(root.SetStoredData)root.SetStoredData(preferenceKey,preferInstalled?'1':'0');}catch(_){}});
  preferSwitch.id='sb-prefer-installed';preferSwitch.classList.add('sb-installed-switch');preferSwitch.setAttribute('role','switch');preferSwitch.setAttribute('aria-label','Prefer installed airport');el('span','sb-switch-thumb',null,preferSwitch);
  function syncPreference(){preferSwitch.setAttribute('aria-checked',String(preferInstalled));}syncPreference();
  var reconnect=button('Reconnect',actions,load),latest=button('Load latest OFP',actions,function(){run('Loading latest briefing…',async function(){showPlan(await client.call('GET','/flightplans/latest'));notice('Latest briefing loaded.');});});
  var tabs=el('nav','sb-tabs',null,page);
  [['new','New'],['edit','Edit'],['view','View'],['flights','Flights'],['fleet','Fleet'],['wx','WX'],['perf','Perf.'],['help','Help']].forEach(function(item){navButtons[item[0]]=button(item[1],tabs,function(){if(busy)return;if(item[0]==='new'){tools.confirm('Clear the working flight form and start a new plan?','New flight',resetForm);return;}navigate(item[0]);});});
  navButtons.edit.setAttribute('aria-label','Flight plan');navButtons.view.setAttribute('aria-label','Briefing');
  var login=button('Sign in / Account',actions,function(){if(!busy)navigate('account');});login.id='sb-account';function setSignedIn(value){login.textContent=value?'Signed in':'Sign in / Account';if(!value){ready=false;lock(busy);notice('Login expired. Open the official SimBrief app to refresh, then reconnect.',true);}}
  var status=el('div','sb-status','Open the official SimBrief app to sign in, then connect here.',page);status.setAttribute('role','status');
  var progress=el('div','sb-progress',null,page),fill=el('div','sb-progress-fill',null,progress);progress.style.display='none';
  var workspace=el('div','sb-workspace',null,page),form=el('div','sb-form sb-scroll',null,workspace),sidebar=el('aside','sb-sidebar sb-scroll',null,workspace);
  var briefing=el('section','sb-briefing sb-scroll',null,page);briefing.style.display='none';var briefSummary=el('div','sb-brief-summary','No briefing loaded. Generate a flight plan or load your latest OFP.',briefing),ofp=el('pre','sb-ofp','',briefing);
  function section(name){var panel=el('section','sb-panel',null,form);el('h2','sb-bar',name,panel);return el('div','sb-fields',null,panel);}
  function field(name,label,parent,kind,choices,initial,wide){
   // Keep action buttons outside the input's label. An enclosing label can
   // otherwise associate with its first button and activate Pick on field taps.
   var wrap=el('div','sb-field'+(wide?' sb-wide':''),null,parent),heading=el('div','sb-label',null,wrap);
   var textLabel=el(kind==='select'||name==='date'?'span':'label','',label,heading);
   // Coherent cannot be relied on to implement native select/option controls.
   // Keep form values in ordinary inputs; actual choices are DOM buttons that
   // are also operable through the existing LAN event bridge.
   var n=el(kind==='textarea'?'textarea':'input','',null,wrap);n.id='sb-'+name;n.name=name;fields[name]=n;
   if(textLabel.tagName==='LABEL')textLabel.htmlFor=n.id;
   if(kind==='select'){
    n.type='hidden';n._choices=[];
    var trigger=button('',wrap,function(){openPicker(label,n._choices,n.value,function(v){n.value=v;n._sync();n.dispatchEvent(new Event('change',{bubbles:true}));},trigger);});
    trigger.id=n.id+'-open';trigger.classList.add('sb-select-trigger');trigger.setAttribute('aria-label','Choose '+label);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger._inlinePicker=true;
    var caption=el('span','',null,trigger);el('i','sb-select-chevron',null,trigger);
    n._sync=function(){var item=n._choices.filter(function(i){return i.value===n.value;})[0];caption.textContent=item?item.label:ready?(name==='type'?'No saved airframes':'No options'):'Loading…';trigger.disabled=n.disabled||!n._choices.length;};
   }
   if(choices)options(n,choices.map(function(v){return typeof v==='string'?{value:v,label:v}:v;}),initial);
   else{if(n.tagName==='INPUT')n.type='text';n.value=initial || '';n.setAttribute('autocomplete','off');n.setAttribute('spellcheck','false');n.placeholder='AUTO';}
   n._initial=n.value;n.addEventListener('change',saveDraft);return n;
  }
  var editActions=el('div','sb-tool-actions',null,form);button('Load latest for editing',editActions,function(){if(!busy)tools.editLatest();});
  var flight=section('Flight');flight.classList.add('sb-flight-fields');
  field('airline','Airline · ICAO',flight).maxLength=3;field('fltnum','Flight number',flight).maxLength=5;
  field('orig','Departure · ICAO',flight).maxLength=4;field('dest','Destination · ICAO',flight).maxLength=4;
  field('date','Departure · UTC',flight,'text',null,simNow(),true);
  fields.date.type='hidden';var dateButton=button('',fields.date.parentNode,openCalendar);dateButton.id='sb-date-open';dateButton.classList.add('sb-select-trigger');dateButton.setAttribute('aria-label','Departure UTC');dateButton.setAttribute('aria-haspopup','dialog');fields.date._sync=function(){dateButton.textContent=fields.date.value||'Select simulator UTC';dateButton.disabled=fields.date.disabled;};fields.date._sync();
  var nowButton=button('Now',fields.date.parentNode.firstChild,function(){if(busy||!ready)return;var now=simNow();if(!now){notice('Simulator UTC is unavailable. Wait for the aircraft to load.',true);return;}fields.date.value=now;fields.date._sync();fields.date.dispatchEvent(new Event('change',{bubbles:true}));});nowButton.id='sb-date-now';nowButton.classList.add('sb-now');nowButton.setAttribute('aria-label','Use current simulator UTC');
  field('altn_1_id','Alternate · ICAO',flight).maxLength=4;field('callsign','ATC callsign',flight).maxLength=8;
  function flightAction(name,caption,action){var b=button(caption,fields[name].parentNode.firstChild,action);b.id='sb-'+name+'-'+caption.toLowerCase();b.classList.add('sb-now');return b;}
  var pickNumber=flightAction('fltnum','Pick',function(){
   if(busy||planningBusy||!ready)return;
   run('Picking a flight number…',async function(){
    var choice=await airlabs.pickNumber(fields.airline.value,fields.orig.value,fields.dest.value,fields.fltnum.value);
    fields.fltnum.value=choice.number;updateCallsign(true);
    notice(choice.source==='airlabs'?'AirLabs flight number selected · '+fields.airline.value.trim().toUpperCase()+choice.number:'Random flight number selected · '+choice.number+' · '+(choice.reason==='missing-key'?'AirLabs is not configured.':choice.reason==='no-route'?'No matching AirLabs flight number.':'Enter airline, departure and destination to look up real flights.'));
   });
  });pickNumber.setAttribute('aria-label','Pick a flight number');
  var swap=flightAction('orig','Swap',function(){
   if(busy||planningBusy||!ready)return;var origin=fields.orig.value;fields.orig.value=fields.dest.value.trim().toUpperCase();fields.dest.value=origin.trim().toUpperCase();saveDraft();schedulePlanning();
  });swap.setAttribute('aria-label','Swap departure and destination');
  var pickDestination=flightAction('dest','Pick',function(){
   if(busy||planningBusy||!ready)return;
   run('Picking an AirLabs flight…',async function(){
    var choice=await airlabs.pick(fields.airline.value,fields.orig.value,fields.dest.value.trim().toUpperCase(),preferInstalled);
    fields.dest.value=choice.destination;fields.fltnum.value=choice.number;updateCallsign(true);notice('AirLabs flight selected · '+choice.airline+choice.number+' · '+choice.origin+' → '+choice.destination);
   });
  });pickDestination.setAttribute('aria-label','Pick a destination and real flight number');

  var alternateStatus=el('small','sb-alternate-status','Automatic after departure, destination and airframe are selected.',fields.altn_1_id.parentNode);alternateStatus.id='sb-alternate-status';alternateStatus.style.display='none';
  ['airline','orig','dest','altn_1_id','callsign'].forEach(function(k){fields[k].classList.add('sb-uppercase');function normalize(){var start=this.selectionStart,end=this.selectionEnd;this.value=this.value.toUpperCase();if(start!=null)this.setSelectionRange(start,end);}fields[k].addEventListener('input',normalize);fields[k].addEventListener('change',normalize);});
  function updateCallsign(force){
   if(!force&&fields.callsign.value&&fields.callsign.value!==autoCallsign)return;
   var airline=fields.airline.value.trim().toUpperCase(),value=airline?airline+fields.fltnum.value.trim():'';
   if(!airline)try{value=String(root.SimVar.GetSimVarValue('ATC ID','string')||'').trim().toUpperCase();}catch(_){}
   fields.callsign.value=value;autoCallsign=value;saveDraft();
  }
  ['airline','fltnum'].forEach(function(k){fields[k].addEventListener('input',function(){updateCallsign(true);});fields[k].addEventListener('change',function(){updateCallsign(true);});});
  ['orig','dest','date'].forEach(function(k){fields[k].addEventListener('input',schedulePlanning);fields[k].addEventListener('change',schedulePlanning);});
  fields.altn_1_id.addEventListener('input',function(){invalidatePlanning();alternateKey='';autoAlternate='';alternateStatus.textContent=this.value?'Manual alternate.':'Automatic after departure, destination and airframe are selected.';schedulePlanning();});
  var aircraft=section('Aircraft');
  field('icao','Aircraft type',aircraft,'select',[],null,true);field('type','Airframe',aircraft,'select',[],null,true);
  var fleetTools=el('div','sb-fleet-tools sb-full',null,aircraft),fleetInfo=el('span','sb-fleet-info','Loading saved airframes…',fleetTools);
  var allFrames=button('All my airframes',fleetTools,function(){
   var mine=[];groups.forEach(function(g){g.frames.forEach(function(f){if(f.personal)mine.push({value:f.id,label:g.icao+' · '+f.label,frame:f});});});
   openPicker('My saved airframes',mine,fields.type.value,function(id){var item=mine.filter(function(i){return i.value===id;})[0];if(!item)return;fields.icao.value=item.frame.group;fields.icao._sync();pickAircraft(id);},allFrames);
  });
  field('reg','Registration',aircraft).maxLength=10;
  field('pounds','Weight units',aircraft,'select',[{value:'0',label:'Kilograms'},{value:'1',label:'Pounds'}],'0');
  field('fl','Cruise altitude · ft',aircraft).placeholder='AUTO / FL350';field('cruisesub','Cost index',aircraft);
  field('climb','Climb profile',aircraft,'select',[]);field('cruisemode','Cruise profile',aircraft,'select',[]);field('descent','Descent profile',aircraft,'select',[]);field('pax','Passengers',aircraft);
  field('cargo','Freight · kg',aircraft);field('addedfuel','Extra fuel · kg',aircraft);
  field('taxiout','Taxi out · min',aircraft,'text',null,'20');field('taxiin','Taxi in · min',aircraft,'text',null,'8');
  var route=section('Route');field('origrwy','Departure runway',route);field('destrwy','Arrival runway',route);
  async function findRoute(p){var d=await client.call('GET','/routes/generate',C.routeQuery(p),{timeout:60000});if(!d||typeof d.routefinder_route!=='string'||!d.routefinder_route.trim())throw new Error('No route returned. Enter a route manually.');return d.routefinder_route.trim();}
  var find=button('Find route',el('div','sb-field sb-wide sb-route-action',null,route),function(){run('Finding a route…',async function(){fields.route.value=await findRoute(readPayload());autoRoute='';notice('Route filled. Review it before generating.');});});
  field('route','Route · leave blank for automatic routing',route,'textarea',null,'',true).parentNode.classList.add('sb-full');var suggest=button('Suggest routes',el('div','sb-full sb-route-action',null,route),function(){if(routeView)routeView.search();});suggest.id='sb-suggest-routes';var routeContainer=el('div','sb-full sb-route-workspace',null,route);
  ['origrwy','destrwy','fl'].forEach(function(k){fields[k].addEventListener('input',schedulePlanning);fields[k].addEventListener('change',schedulePlanning);});
  fields.route.addEventListener('input',function(){autoRoute='';routeKey='';});
  var settings=section('Dispatch options');
  field('planformat','OFP layout',settings,'select',[{value:'lido',label:'LIDO'}],'lido',true);
  [['navlog','Detailed navlog','1'],['etops','ETOPS','1'],['stepclimbs','Step climbs','1'],['tlr','Runway analysis','0'],['notams','Include NOTAMs','0'],['firnot','FIR NOTAMs','0']].forEach(function(v){field(v[0],v[1],settings,'select',[{value:'1',label:'On'},{value:'0',label:'Off'}],v[2]);});
  el('h2','sb-bar','Briefing summary',sidebar);var summary=el('div','sb-summary',null,sidebar);
  el('p','sb-empty','Your generated flight plan will appear here.',summary);
  el('p','sb-help','Blank optional fields use automatic planning. Freight and extra fuel use the selected weight units. Review the OFP before importing it into the aircraft.',sidebar);
  var footer=el('footer','sb-footer',null,page);
  var cancel=button('Cancel generation',footer,async function(){if(!planner.busy()||cancelling)return;cancelling=true;cancel.disabled=true;try{await planner.cancel();notice('Cancellation sent.');}catch(e){notice('Cancellation could not be confirmed. Use Load latest before generating again.',true);}finally{cancelling=false;lock(false);}});cancel.style.display='none';
  var generate=button('Generate flight plan',footer,function(){run('Preparing flight plan…',async function(){var p=readPayload();if(!p.route){notice('Finding a route…');p.route=await findRoute(p);fields.route.value=p.route;}cancel.style.display='block';cancel.disabled=false;var data=await planner.generate(p);showPlan(data);notice('Flight plan generated. Review the briefing before import.');
   if(env.importSimbrief){try{await env.importSimbrief();notice('Flight plan generated. PMDG import requested.');}catch(e){notice('Flight plan generated. '+(e.message||'PMDG import unavailable. Use Request Data from Simbrief in the EFB app.'),true);}}
  },true);});generate.classList.add('sb-generate');
  var planner=new root.PMDGSimBriefPlanner(client,function(d){notice(d.message);fill.style.width=d.percent+'%';});
  var overlay=el('div','sb-picker-overlay',null,page);overlay.id='sb-picker';overlay.style.display='none';
  var dialog=el('section','sb-picker-dialog',null,overlay);dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','sb-picker-title');
  var pickerHeader=el('div','sb-picker-header',null,dialog),pickerTitle=el('h2','',null,pickerHeader);pickerTitle.id='sb-picker-title';button('Close',pickerHeader,closePicker);
  var search=el('input','sb-picker-search',null,dialog);search.id='sb-picker-search';search.type='text';search.placeholder='Search aircraft, registration or description';search.setAttribute('aria-label','Search choices');search.setAttribute('autocomplete','off');
  var pickerList=el('div','sb-picker-list sb-scroll',null,dialog);
  function closePicker(){if(picker&&picker.trigger)picker.trigger.setAttribute('aria-expanded','false');picker=null;overlay.style.display='none';pickerList.textContent='';search.blur();if(root.Coherent)root.Coherent.trigger('UNFOCUS_INPUT_FIELD');}
  function openPicker(title,items,value,choose,trigger){
   if(busy||!ready||trigger.disabled)return;if(picker&&picker.trigger===trigger){closePicker();return;}closePicker();picker={items:items,value:value,choose:choose,trigger:trigger};
   pickerTitle.textContent=title;search.value='';trigger.setAttribute('aria-expanded','true');overlay.classList.toggle('sb-picker-inline',!!trigger._inlinePicker);overlay.classList.toggle('sb-picker-compact',!!trigger._compactPicker);dialog.removeAttribute('style');
   search.placeholder=/airframe|aircraft/i.test(title)?'Search aircraft, registration or description':'Search '+title.toLowerCase();
   search.style.display=!trigger._compactPicker&&(!trigger._inlinePicker||items.length>8||trigger.id==='sb-type-open'||trigger.id==='sb-icao-open')?'block':'none';
   if(trigger._inlinePicker){
    // Anchor to the field like PMDG's selected-option/options controls. Keep
    // the list outside the scrolling form so it is not clipped by the panel.
    var bounds=page.getBoundingClientRect(),r=trigger.getBoundingClientRect(),sx=page.offsetWidth/bounds.width,sy=page.offsetHeight/bounds.height;
    var left=(r.left-bounds.left)*sx,top=(r.bottom-bounds.top)*sy+2,above=(r.top-bounds.top)*sy-12,below=page.offsetHeight-top-12;
    var width=Math.min(page.offsetWidth-24,Math.max(r.width*sx,trigger._compactPicker?140:320)),wanted=Math.min(trigger._compactPicker?300:520,Math.max(90,items.length*68+20+(search.style.display==='none'?0:86))),useAbove=below<Math.min(wanted,250)&&above>below,height=Math.min(wanted,useAbove?above:below);
    if(useAbove)top=Math.max(12,above-height);
    dialog.style.left=Math.max(12,Math.min(left,page.offsetWidth-width-12))+'px';dialog.style.top=top+'px';dialog.style.width=width+'px';dialog.style.maxHeight=Math.max(90,height)+'px';
   }
   overlay.style.display='flex';renderPicker();
   // A focus/scroll-into-view event queued before opening is not a user scroll.
   // Compare with the positions at opening, instead of closing on that event.
   picker.scrollPositions=[];var ancestor=trigger.parentNode;while(ancestor&&ancestor!==page.parentNode){picker.scrollPositions.push({node:ancestor,top:ancestor.scrollTop,left:ancestor.scrollLeft});ancestor=ancestor.parentNode;}
  }
  function renderPicker(){
   if(!picker)return;var query=search.value.toLowerCase().trim(),shown=0;
   // Preserve row identities while filtering: LAN may already have a tap for
   // a visible row in flight when the search text reaches the simulator.
   if(!picker.rows){
    picker.rows=picker.items.map(function(item){var b=button(item.label,pickerList,function(){if(!picker||busy)return;var choose=picker.choose;closePicker();choose(item.value);saveDraft();});b.classList.add('sb-picker-option');b.setAttribute('data-sb-choice',item.value);b.setAttribute('aria-pressed',String(item.value===picker.value));return {node:b,text:(item.label+' '+item.value).toLowerCase()};});
    picker.empty=el('p','sb-empty','',pickerList);
   }
   picker.rows.forEach(function(row){var match=row.text.indexOf(query)!==-1;row.node.style.display=match?'block':'none';if(match)shown++;});
   picker.empty.style.display=shown?'none':'block';picker.empty.textContent=query?'No matching airframes or options.':'No saved airframes in this account. Create an airframe in SimBrief, then reconnect.';
   pickerList.scrollTop=0;if(picker.trigger._compactPicker){var chosen=pickerList.querySelector('[aria-pressed="true"]');if(chosen)pickerList.scrollTop=Math.max(0,chosen.offsetTop-pickerList.offsetTop-(pickerList.clientHeight-chosen.offsetHeight)/2);}
  }
  search.addEventListener('input',renderPicker);search.addEventListener('keydown',function(e){if(e.key==='Escape')closePicker();});overlay.addEventListener('click',function(e){if(e.target===overlay)closePicker();});
  page.addEventListener('click',function(e){if(picker&&!dialog.contains(e.target)&&!picker.trigger.contains(e.target))closePicker();},true);
  page.addEventListener('scroll',function(e){if(picker&&picker.trigger._inlinePicker&&e.target!==pickerList&&e.target.contains(picker.trigger)){var saved=(picker.scrollPositions||[]).filter(function(p){return p.node===e.target;})[0];if(saved&&(saved.top!==e.target.scrollTop||saved.left!==e.target.scrollLeft))closePicker();}},true);
  var calendarOverlay=el('div','popup sb-calendar-overlay',null,page);calendarOverlay.id='sb-calendar';calendarOverlay.style.display='none';
  var calendarDialog=el('section','popup-content sb-calendar-dialog',null,calendarOverlay);calendarDialog.setAttribute('role','dialog');calendarDialog.setAttribute('aria-modal','true');calendarDialog.setAttribute('aria-label','Departure UTC calendar');
  el('h2','sb-bar','Departure · UTC',calendarDialog);var calendarMessage=el('p','sb-help','',calendarDialog);var retryTime=button('Read simulator UTC',calendarDialog,openCalendar);retryTime.id='sb-calendar-retry';retryTime.style.display='none';
  var monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'],calendarHeader=el('div','sb-calendar-heading',null,calendarDialog);
  var previousMonth=button('‹',calendarHeader,function(){moveMonth(-1);});previousMonth.setAttribute('aria-label','Previous month');
  var monthButton=button('',calendarHeader,function(){openPicker('Month',monthNames.map(function(v,i){return {value:String(i),label:v};}),String(calendar.month),function(v){calendar.month=+v;renderCalendar();},monthButton);});monthButton.id='sb-calendar-month';
  var yearButton=button('',calendarHeader,function(){var years=[];for(var y=Math.max(100,calendar.year-100);y<=Math.min(9999,calendar.year+100);y++)years.push({value:String(y),label:String(y)});openPicker('Year',years,String(calendar.year),function(v){calendar.year=+v;renderCalendar();},yearButton);});yearButton.id='sb-calendar-year';
  var nextMonth=button('›',calendarHeader,function(){moveMonth(1);});nextMonth.setAttribute('aria-label','Next month');
  var week=el('div','sb-calendar-week',null,calendarDialog);['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(v){el('span','',v,week);});
  var days=el('div','sb-calendar-days',null,calendarDialog),timeRow=el('div','sb-calendar-time',null,calendarDialog);
  function timePicker(label,key,count){var wrap=el('div','',null,timeRow);el('span','sb-label',label,wrap);var b=button('',wrap,function(){var choices=[];for(var i=0;i<count;i++)choices.push({value:String(i),label:('0'+i).slice(-2)});openPicker(label,choices,String(calendar[key]),function(v){calendar[key]=+v;renderCalendar();},b);});b.id='sb-calendar-'+key;b.classList.add('sb-select-trigger');b.setAttribute('aria-label',label);b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');b._caption=el('span','',null,b);el('i','sb-select-chevron',null,b).setAttribute('aria-hidden','true');b._inlinePicker=true;b._compactPicker=true;return b;}
  var hourButton=timePicker('Hour','hour',24),minuteButton=timePicker('Minute','minute',60),calendarActions=el('div','sb-calendar-actions',null,calendarDialog);
  button('Cancel',calendarActions,closeCalendar).id='sb-calendar-cancel';button('Apply',calendarActions,function(){if(!calendar)return;fields.date.value=C.utcInput(Date.UTC(calendar.selectedYear,calendar.selectedMonth,calendar.day,calendar.hour,calendar.minute));closeCalendar();fields.date.dispatchEvent(new Event('change',{bubbles:true}));}).id='sb-calendar-apply';
  function closeCalendar(){if(!calendarOverlay)return;closePicker();calendar=null;calendarOverlay.style.display='none';dateButton.setAttribute('aria-expanded','false');}
  function openCalendar(){if(busy||!ready)return;closePicker();calendarOverlay.style.display='block';dateButton.setAttribute('aria-expanded','true');var stamp=C.simulatorUTC(root.SimVar);calendarDialog.classList.toggle('sb-time-unavailable',stamp==null);retryTime.style.display=stamp==null?'block':'none';calendarMessage.textContent=stamp==null?'Simulator UTC is not available yet. Load the aircraft, then retry.':'Opens at the current simulator date and time.';if(stamp==null){calendar=null;return;}var d=new Date(stamp);calendar={year:d.getUTCFullYear(),month:d.getUTCMonth(),selectedYear:d.getUTCFullYear(),selectedMonth:d.getUTCMonth(),day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes()};calendarOverlay.style.display='block';dateButton.setAttribute('aria-expanded','true');renderCalendar();}
  function moveMonth(delta){var date=new Date(Date.UTC(calendar.year,calendar.month+delta,1));if(date.getUTCFullYear()<100||date.getUTCFullYear()>9999)return;calendar.year=date.getUTCFullYear();calendar.month=date.getUTCMonth();renderCalendar();}
  function renderCalendar(){
   if(!calendar)return;monthButton.textContent=monthNames[calendar.month];yearButton.textContent=String(calendar.year);hourButton._caption.textContent=('0'+calendar.hour).slice(-2);minuteButton._caption.textContent=('0'+calendar.minute).slice(-2);days.textContent='';
   var offset=(new Date(Date.UTC(calendar.year,calendar.month,1)).getUTCDay()+6)%7,total=new Date(Date.UTC(calendar.year,calendar.month+1,0)).getUTCDate();
   for(var i=0;i<42;i++){var day=i-offset+1;if(day<1||day>total){el('span','',null,days);continue;}(function(day){var b=button(String(day),days,function(){calendar.day=day;calendar.selectedYear=calendar.year;calendar.selectedMonth=calendar.month;renderCalendar();});b.setAttribute('data-sb-day',String(day));b.setAttribute('aria-pressed',String(calendar.selectedYear===calendar.year&&calendar.selectedMonth===calendar.month&&calendar.day===day));})(day);}
  }
  calendarOverlay.addEventListener('click',function(e){if(e.target===calendarOverlay)closeCalendar();});page.addEventListener('keydown',function(e){if(e.key==='Escape'){if(picker)closePicker();else closeCalendar();}});
  function invalidatePlanning(){clearTimeout(planningTimer);planningTimer=null;planningVersion++;}
  // One bounded cache per read type; manual refresh reuses an in-flight request.
  function planningRead(slot,key,fetch,force){
   var entry=planningReads[slot];if(entry&&entry.key===key&&(entry.pending||!force))return entry.promise;
   entry={key:key,pending:true};planningReads[slot]=entry;
   entry.promise=Promise.resolve().then(fetch).then(function(data){entry.pending=false;return data;},function(error){if(planningReads[slot]===entry)delete planningReads[slot];throw error;});return entry.promise;
  }
  function searchRoutes(p,date,force){var query=C.routeSearchQuery(p,date);return planningRead('search',JSON.stringify(query),function(){return client.call('GET','/routes/search',query,{timeout:60000});},force);}
  var retryAlternate=button('Auto',fields.altn_1_id.parentNode.firstChild,function(){if(busy||!ready)return;fields.altn_1_id.value='';autoAlternate='';alternateKey='';schedulePlanning();saveDraft();});retryAlternate.id='sb-alternate-auto';retryAlternate.classList.add('sb-now');retryAlternate.setAttribute('aria-label','Find alternate automatically');
  function schedulePlanning(){
   if(planningBusy)return;invalidatePlanning();if(!active||activeTab!=='edit'||!ready||busy)return;
   var frame=selected(),orig=fields.orig.value.trim().toUpperCase(),dest=fields.dest.value.trim().toUpperCase(),date=fields.date.value;
   if(!frame||!/^[A-Z]{4}$/.test(orig)||!/^[A-Z]{4}$/.test(dest)||orig===dest){
    if(autoAlternate&&fields.altn_1_id.value===autoAlternate)fields.altn_1_id.value='';autoAlternate='';alternateKey='';
    if(autoRoute&&fields.route.value===autoRoute)fields.route.value='';autoRoute='';routeKey='';suggestionKey='';
    alternateStatus.textContent='Select departure, destination and a saved airframe.';return;
   }
   if(!date){date=simNow();fields.date.value=date;fields.date._sync();}try{C.utcDate(date);}catch(_){notice('Simulator UTC is unavailable. Use Now once the aircraft has loaded.',true);return;}
   var p={orig:orig,dest:dest,type:frame.id,fl:fields.fl.value.trim().toUpperCase(),origrwy:fields.origrwy.value.trim().toUpperCase(),destrwy:fields.destrwy.value.trim().toUpperCase()};if(/^FL\d{2,3}$/.test(p.fl))p.fl=String(+p.fl.slice(2)*100);
   var query=C.routeSearchQuery(p,date),flightKey=JSON.stringify([query,p.fl]),criteria=C.alternateCriteria(frame,additionalOptions),altKey=JSON.stringify([query,criteria]);
   var manualAlternate=fields.altn_1_id.value&&fields.altn_1_id.value!==autoAlternate,manualRoute=fields.route.value&&fields.route.value!==autoRoute;
   var needAlternate=!manualAlternate&&!(alternateKey===altKey&&autoAlternate&&fields.altn_1_id.value===autoAlternate),needRoute=!manualRoute&&!(routeKey===flightKey&&autoRoute&&fields.route.value===autoRoute),needSuggestions=suggestionKey!==JSON.stringify(query);
   if(!needAlternate&&!needRoute&&!needSuggestions)return;
   if(needAlternate&&autoAlternate){fields.altn_1_id.value='';autoAlternate='';}
   if(needRoute&&autoRoute){fields.route.value='';autoRoute='';}
   var version=planningVersion,routeBefore=fields.route.value;
   function current(){return version===planningVersion&&active&&activeTab==='edit'&&ready&&!busy;}
   function settled(task){return task.then(function(value){return {value:value};},function(error){return {error:error};});}
   async function lookup(){
    planningTimer=null;if(!current())return;planningBusy=true;page.classList.add('sb-planning-busy');page.setAttribute('aria-busy','true');lock(false,true);
    try{notice('Finding route, suggestions and alternate…');
    var search=needAlternate||needSuggestions?settled(searchRoutes(p,date)):Promise.resolve({}),generated=needRoute?settled(planningRead('generate',JSON.stringify(C.routeQuery(p)),function(){return findRoute(p);})):Promise.resolve({});
    var alternate=(async function(){
     if(!needAlternate)return {};
     var response=await search;if(!current())return {};if(response.error)return {error:response.error};
     try{
      var duration;try{duration=C.routeDuration(response.value);}catch(e){var cached=planningReads.search;if(cached&&cached.key===JSON.stringify(query))delete planningReads.search;throw e;}var start=query.departure_time+duration-3600;
      var data=await client.call('GET','/alternates/search',{destination:dest,time_start:start,time_end:start+18000,minimum_ceiling:0,minimum_visibility:0,minimum_runway_length:0,avoid_fg_ts_fzra:0,search_distance:criteria.radius},{timeout:30000});
      return {value:C.chooseAlternate(data,criteria)};
     }catch(e){return {error:e};}
    })();
    var results=await Promise.all([search,generated,alternate]);if(!current())return;
    var warnings=[],completed=[],r=results[1],a=results[2];
    if(needRoute){
     if(r.error)warnings.push('Find route unavailable. '+r.error.message);
     else if(fields.route.value===routeBefore){autoRoute=r.value;fields.route.value=autoRoute;routeKey=flightKey;completed.push('Route filled');}
    }
    if(needAlternate&&!fields.altn_1_id.value){
     if(a.error){alternateKey='';warnings.push('Auto alternate unavailable. '+a.error.message+' Use Auto to retry or enter one manually.');}
     else {autoAlternate=a.value||'';alternateKey=autoAlternate?altKey:'';fields.altn_1_id.value=autoAlternate;if(autoAlternate)completed.push('Alternate selected · '+autoAlternate);else warnings.push('No suitable alternate found. Enter one manually or use Auto to retry.');}
     alternateStatus.textContent=a.error?'Auto alternate unavailable. '+a.error.message:autoAlternate?'Automatically selected · review before generating.':'No suitable alternate found.';
    }
    saveDraft();
    if(needSuggestions){
     if(results[0].error)warnings.push('Suggested routes unavailable. '+results[0].error.message);
     else try{routeView.accept(results[0].value);suggestionKey=JSON.stringify(query);completed.push('Suggested routes loaded');}catch(e){warnings.push('Suggested routes unavailable. '+e.message);}
    }
    notice(warnings.length?warnings.join(' '):completed.join(' · ')||'Flight data is up to date.',!!warnings.length);
    }finally{var resume=version!==planningVersion&&active&&ready&&!busy;planningBusy=false;page.classList.remove('sb-planning-busy');page.setAttribute('aria-busy','false');lock(false,true);if(resume)schedulePlanning();}
   }
   planningTimer=setTimeout(lookup,700);
  }
  function notice(message,error){status.textContent=message;status.classList.toggle('sb-error',!!error);}
  function navigate(name){if(routeView)routeView.invalidate();closeCalendar();invalidatePlanning();toolbox.scrollTop=0;if(tools)tools.hide();activeTab=name;workspace.style.display=name==='edit'?'flex':'none';briefing.style.display=name==='view'?'block':'none';toolbox.style.display=name!=='edit'&&name!=='view'?'block':'none';generate.style.display=name==='edit'?'block':'none';Object.keys(navButtons).forEach(function(k){navButtons[k].setAttribute('aria-pressed',String(k===name));});if(tools&&name!=='edit'&&name!=='view')tools.show(name);if(name==='edit')schedulePlanning();}
  function tab(brief){navigate(brief?'view':'edit');}
  function selected(){return frames.filter(function(f){return f.id===fields.type.value;})[0];}
  function readPayload(){var values={};Object.keys(fields).forEach(function(k){values[k]=fields[k].value;});var p=C.payload(values,selected());var result=Object.assign({},additionalOptions,p);['maps','flightrules','flighttype','addedfuel_units'].forEach(function(k){if(additionalOptions[k]!=null)result[k]=additionalOptions[k];});return result;}
  function lock(value,skipSchedule){busy=value;var blocked=value||planningBusy;if(preferSwitch)preferSwitch.disabled=blocked;if(routeView)routeView.lock(blocked||!ready);if(value){invalidatePlanning();closeCalendar();}nowButton.disabled=blocked||!ready;Object.keys(navButtons).forEach(function(k){navButtons[k].disabled=blocked;});login.disabled=blocked;if(tools)tools.lock(blocked);reconnect.disabled=blocked;latest.disabled=blocked;find.disabled=blocked||!ready||!selected();generate.disabled=blocked||!ready||!selected();suggest.disabled=blocked||!ready||!selected();allFrames.disabled=blocked||!ready;Object.keys(fields).forEach(function(k){fields[k].disabled=blocked||!ready;if(fields[k]._sync)fields[k]._sync();});cancel.disabled=!value;cancel.style.display=value&&planner.busy()?'block':'none';if(blocked){closePicker();closeCalendar();if(root.Coherent)root.Coherent.trigger('UNFOCUS_INPUT_FIELD');}if(!blocked){progress.style.display='none';if(!skipSchedule&&activeTab==='edit')schedulePlanning();}if(pickNumber)pickNumber.disabled=blocked||!ready;if(pickDestination)pickDestination.disabled=blocked||!ready;if(swap)swap.disabled=blocked||!ready;}
  async function run(message,fn,generating){if(busy||planningBusy)return;saveDraft();lock(true);notice(message);if(generating){progress.style.display='block';fill.style.width='0%';}try{await fn();}catch(e){if(e.status===401)ready=false;notice(e.message || 'Request failed.',true);}finally{if(!cancelling){lock(false);saveDraft();}}}
  function pickFrame(){
   invalidatePlanning();if(generate){suggest.disabled=busy||!ready||!selected();generate.disabled=busy||!ready||!selected();find.disabled=generate.disabled;}
   var f=selected();if(!f){fields.reg.value='';fields.cruisesub.value='';['climb','cruisemode','descent'].forEach(function(k){options(fields[k],[]);});schedulePlanning();saveDraft();return;}var d=C.defaults(f);
   ['climb','cruisemode','descent'].forEach(function(k){var key=k==='cruisemode'?'cruise':k,list=f.data['aircraft_profiles_'+key] || [];if(!list.length)list=[d[k] || ''];options(fields[k],list.map(function(v){return {value:v,label:v || 'Automatic'};}),d[k]);});
   fields.reg.value=d.reg;fields.cruisesub.value=d.cruisesub;
   if(f.options.planunits==='0'||f.options.planunits==='1'){convertUnits(f.options.planunits);}
   schedulePlanning();saveDraft();
  }
  function pickAircraft(id,restore){var g=groups.filter(function(g){return g.id===fields.icao.value;})[0];frames=g?g.frames.filter(function(f){return f.personal;}):[];options(fields.type,frames.length?[{value:'',label:'Select an airframe (required)'}].concat(frames.map(function(f){return {value:f.id,label:f.label || f.name};})):[],id);var mine=frames.length;fleetInfo.textContent=mine?mine+' saved airframe'+(mine===1?'':'s')+' for this type':'No saved airframes for this type. Choose another aircraft or use All my airframes.';if(!restore)pickFrame();find.disabled=busy||!ready||!selected();generate.disabled=busy||!ready||!selected();}
  var units='0';
  function convertUnits(next){
   if(units!==next)['cargo','addedfuel'].forEach(function(k){var v=fields[k].value;if(/^\d+$/.test(v))fields[k].value=String(Math.round(+v*(next==='1'?2.20462262185:1/2.20462262185)));});
   fields.pounds.value=next;fields.pounds._sync();units=next;fields.cargo.parentNode.firstChild.textContent='Freight · '+(next==='1'?'lb':'kg');fields.addedfuel.parentNode.firstChild.textContent='Extra fuel · '+(next==='1'?'lb':'kg');
  }
  fields.icao.onchange=function(){additionalOptions={};pickAircraft();};fields.type.onchange=function(){additionalOptions={};pickFrame();};fields.pounds.onchange=function(){convertUnits(fields.pounds.value);saveDraft();};
  // Keep the working form only in this view's memory. Reopening/Reconnect in
  // the same flight keeps it; a new tablet session never restores an old plan.
  function saveDraft(){fields.date._sync();if(!ready||busy)return;if(routeView)routeView.invalidate();}
  async function currentDeparture(){
   var timer;
   try{
    if(!env.currentAirport||!root.SimVar||!root.SimVar.GetSimVarValue('SIM ON GROUND','bool'))return '';
    var lat=Number(root.SimVar.GetSimVarValue('PLANE LATITUDE','degrees')),lon=Number(root.SimVar.GetSimVarValue('PLANE LONGITUDE','degrees'));
    if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return '';
    var airport=await Promise.race([env.currentAirport(lat,lon),new Promise(function(resolve){timer=setTimeout(function(){resolve(null);},3000);})]);
    var ident=airport&&airport.icaoStruct&&airport.icaoStruct.ident;ident=String(ident||'').trim().toUpperCase();return /^[A-Z]{4}$/.test(ident)?ident:'';
   }catch(_){return '';}finally{clearTimeout(timer);}
  }
  async function load(){
   if(busy)return;
   var previous=null;if(initialized){previous={};Object.keys(fields).forEach(function(k){previous[k]=fields[k].value;});previous._additionalOptions=additionalOptions;previous._autoCallsign=autoCallsign;previous._autoAlternate=autoAlternate;previous._alternateKey=alternateKey;previous._autoRoute=autoRoute;}
   await run('Connecting to SimBrief…',async function(){
    var results=await Promise.all([client.call('GET','/airframes'),client.call('GET','/airframes/user'),client.call('GET','/plan/inputs'),initialized?Promise.resolve(''):currentDeparture()]);
    groups=C.catalog(results[0],results[1]);if(!groups.length)throw new Error('No aircraft available.');
    var saved=previous || {},match=location.pathname.match(/pmdg-(737-600|737-700|737-800|737-900|777-200ER|777-200LR|777-300ER|777F)/i),codes={'737-600':'B736','737-700':'B737','737-800':'B738','737-900':'B739','777-200er':'B772','777-200lr':'B77L','777-300er':'B77W','777f':'B77F'},defaultCode=match?codes[match[1].toLowerCase()]:'B738';
    options(fields.icao,groups.map(function(g){return {value:g.id,label:g.icao+' · '+g.name};}),saved.icao || defaultCode);pickAircraft(saved.type,true);pickFrame();
    var layouts=results[2].layouts;if(Array.isArray(layouts)&&layouts.length)options(fields.planformat,layouts.map(function(l){return {value:l.id,label:l.name_short || l.name};}),'lido');
    autoRoute=saved._autoRoute||'';autoCallsign=saved._autoCallsign||'';autoAlternate=saved._autoAlternate||'';alternateKey=saved._alternateKey||'';var savedFrame=selected()&&selected().id===saved.type;additionalOptions=savedFrame&&saved._additionalOptions?scalarOptions(saved._additionalOptions):{};
    Object.keys(fields).forEach(function(k){if(k==='icao'||k==='type'||saved[k]==null)return;if(['reg','climb','cruisemode','descent','cruisesub'].indexOf(k)>=0&&!savedFrame)return;var n=fields[k];if(n._choices&&!n._choices.some(function(o){return o.value===saved[k];}))return;n.value=saved[k];});
    if(!initialized){if(!fields.orig.value)fields.orig.value=results[3];fields.date.value=simNow();}
    ['airline','orig','dest','callsign','altn_1_id'].forEach(function(k){fields[k].value=fields[k].value.toUpperCase();});if(!fields.date.value)fields.date.value=simNow();units=fields.pounds.value;convertUnits(units);ready=true;initialized=true;updateCallsign();var savedCount=0;groups.forEach(function(g){g.frames.forEach(function(f){if(f.personal)savedCount++;});});notice('Connected · '+savedCount+' saved airframe'+(savedCount===1?'':'s')+' loaded.');
   });
  }
  function scalarOptions(data){var result={};Object.keys(data).forEach(function(k){if(/^[a-z][a-z0-9_]*$/i.test(k)&&['__proto__','constructor','prototype'].indexOf(k)<0&&!/token|secret|password/i.test(k)&&['string','number','boolean'].indexOf(typeof data[k])>=0)result[k]=String(data[k]);});return result;}
  function formValues(){var d={};Object.keys(fields).forEach(function(k){d[k]=fields[k].value;});return d;}
  function resetForm(){invalidatePlanning();planningReads={};autoRoute='';routeKey='';suggestionKey='';alternateKey='';autoAlternate='';autoCallsign='';additionalOptions={};fields.type.value='';fields.type._sync();Object.keys(fields).forEach(function(k){if(k==='icao'||k==='type')return;var n=fields[k];n.value=n._initial||'';if(n._sync)n._sync();});fields.date.value=simNow();units=fields.pounds.value;convertUnits(units);pickFrame();updateCallsign();saveDraft();navigate('edit');notice('New flight form ready. Select a saved airframe to generate.');}
  function inputDate(raw){
   if(!raw)return simNow();var v=String(raw).trim(),m=v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);if(m){v=m[1]+' '+m[2];C.utcDate(v);return v;}
   m=v.match(/^(\d{1,2})\s*([A-Za-z]{3})\s*(\d{2}|\d{4})\s*(?:-\s*)?(\d{1,2}):(\d{2})(?:Z| UTC)?$/i);if(!m)throw new Error('Unrecognized departure date in this flight. The working form was kept.');
   var month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase())+1,year=+m[3]+(m[3].length===2?2000:0);v=year+'-'+('0'+month).slice(-2)+'-'+('0'+m[1]).slice(-2)+' '+('0'+m[4]).slice(-2)+':'+m[5];C.utcDate(v);return v;
  }
  function applyForm(data){invalidatePlanning();planningReads={};autoRoute='';routeKey='';suggestionKey='';autoAlternate='';alternateKey='';autoCallsign='';var restoredDate=inputDate(data.date);
   var frame=null;groups.forEach(function(g){g.frames.forEach(function(f){if(f.personal&&f.id===String(data.type))frame=f;});});
   if(!frame)throw new Error('This flight uses an airframe that is not in your saved fleet. Add it in Fleet first; the working form was kept.');
   additionalOptions=scalarOptions(data);
   fields.icao.value=frame.group;fields.icao._sync();pickAircraft(frame.id);
   Object.keys(fields).forEach(function(k){if(k==='icao'||k==='type')return;var n=fields[k],v=data[k];if(v==null)v=n._initial||'';v=String(v);if(k==='date')v=restoredDate;if(n._choices&&!n._choices.some(function(c){return c.value===v;}))return;n.value=v;if(n._sync)n._sync();});
   units=fields.pounds.value;convertUnits(units);saveDraft();
  }
  async function refreshCatalog(){var current=fields.type.value,all=await Promise.all([client.call('GET','/airframes'),client.call('GET','/airframes/user')]);groups=C.catalog(all[0],all[1]);options(fields.icao,groups.map(function(g){return {value:g.id,label:g.icao+' · '+g.name};}),fields.icao.value);pickAircraft(current);}
  var toolbox=el('section','sb-toolbox sb-scroll',null,page);page.insertBefore(toolbox,footer);toolbox.style.display='none';
  tools=new root.PMDGSimBriefTools({container:toolbox,page:page,el:el,button:button,client:client,run:run,notice:notice,plain:plainOFP,picker:openPicker,ready:function(){return ready;},groups:function(){return groups;},selected:selected,form:formValues,payload:readPayload,applyForm:applyForm,showPlan:showPlan,navigate:navigate,load:load,refreshCatalog:refreshCatalog,useFrame:function(f){fields.icao.value=f.group;fields.icao._sync();additionalOptions={};pickAircraft(f.id);},setRoute:function(o,d,r){fields.orig.value=o;fields.dest.value=d;fields.route.value=r;schedulePlanning();saveDraft();}});
  routeView=new root.PMDGSimBriefRoutes({container:routeContainer,client:client,el:el,button:button,run:run,notice:notice,payload:readPayload,values:formValues,date:function(){return fields.date.value;},searchData:function(p,date){return searchRoutes(p,date,true);},searched:function(p,date){suggestionKey=JSON.stringify(C.routeSearchQuery(p,date));},setRoute:function(v){autoRoute='';routeKey='';fields.route.value=v;saveDraft();}});Object.keys(fields).forEach(function(k){fields[k].addEventListener('input',function(){routeView.invalidate();});fields[k].addEventListener('change',function(){routeView.invalidate();});});
  function value(v){return v==null||v===''?'—':String(v);}
  function showPlan(data){
   if(!data || !data.origin || !data.destination || !data.general)throw new Error('No complete briefing found. Generate a flight plan first.');
   var g=data.general,w=data.weights || {},f=data.fuel || {},a=data.aircraft || {},unitsText=data.params&&data.params.units || '',routeText=value(data.origin.icao_code)+' → '+value(data.destination.icao_code);
   summary.textContent='';el('h3','sb-summary-route',routeText,summary);
   var items=[['Flight',String(g.icao_airline || '')+String(g.flight_number || '')],['Aircraft',a.name || a.icao_code],['Departure runway',data.origin.plan_rwy],['Arrival runway',data.destination.plan_rwy],['Cruise altitude',g.initial_altitude?g.initial_altitude+' ft':''],['Passengers',w.pax_count_actual || w.pax_count],['Block fuel',f.plan_ramp?f.plan_ramp+' '+unitsText:''],['Takeoff weight',w.est_tow?w.est_tow+' '+unitsText:''],['Landing weight',w.est_ldw?w.est_ldw+' '+unitsText:'']];
   items.forEach(function(i){var row=el('div','sb-summary-row',null,summary);el('span','',i[0],row);el('strong','',value(i[1]),row);});
   el('p','sb-summary-route-text',value(g.route),summary);
   briefSummary.textContent=routeText+' · '+value(a.name || a.icao_code)+' · '+value(data.params&&data.params.units);
   var warnings=[].concat(g.sys_rmk || [],g.dx_rmk || []).filter(function(s){return s&&s!=='NONE';});if(warnings.length){el('p','sb-warning',warnings.join('\n'),summary);el('p','sb-warning',warnings.join('\n'),briefSummary);}
   ofp.textContent=plainOFP(data.text&&data.text.plan_html) || 'The briefing response contains no OFP text.';
   tab(true);
  }
  page.addEventListener('focusin',function(e){if(/^(INPUT|TEXTAREA)$/.test(e.target.tagName)&&root.Coherent)root.Coherent.trigger('FOCUS_INPUT_FIELD','simbriefInput','','','',false);});
  page.addEventListener('focusout',function(){if(root.Coherent)root.Coherent.trigger('UNFOCUS_INPUT_FIELD');});
  // Coherent supports mouse dragging; LAN touch scrolling is handled by its
  // existing scroll-event bridge. Limit this handler to our own blank surfaces.
  var drag=null,suppress=0;
  page.addEventListener('mousedown',function(e){if(e.button!==0||(e.target.closest('input,textarea,select,button')&&!e.target.closest('.sb-picker-option')))return;var n=e.target.closest('.sb-scroll');if(n)drag={node:n,y:e.clientY,top:n.scrollTop,moved:false};});
  page.addEventListener('mousemove',function(e){if(!drag)return;if(Math.abs(e.clientY-drag.y)>6)drag.moved=true;if(drag.moved){drag.node.scrollTop=drag.top+drag.y-e.clientY;e.preventDefault();}});
  function endDrag(){if(drag&&drag.moved)suppress=Date.now()+300;drag=null;}
  page.addEventListener('mouseup',endDrag);page.addEventListener('mouseleave',endDrag);page.addEventListener('click',function(e){if(Date.now()<suppress){e.preventDefault();e.stopImmediatePropagation();}},true);
  this.activate=function(visible){active=visible;if(active&&!initialized&&!busy)load();else if(active){if(!fields.date.value)fields.date.value=simNow();updateCallsign();if(activeTab==='edit')schedulePlanning();}if(!active){invalidatePlanning();closeCalendar();tools.hide();saveDraft();if(root.Coherent)root.Coherent.trigger('UNFOCUS_INPUT_FIELD');}};
  root.addEventListener('beforeunload',function(){invalidatePlanning();saveDraft();client.destroy();});
  tab(false);lock(false);
 }
 root.PMDGSimBrief={install:function(bus,env,base){
  if(document.getElementById('simbrief_dispatch'))return;
  var page=el('div','efb_page',null,document.getElementById('AppContent'));page.id='simbrief_dispatch';page.style.display='none';var view=new View(page,env);
  var launcher=button('',document.getElementById('remote-app-launchers'),function(){bus.getPublisher().pub('current_app','simbrief_dispatch');});launcher.setAttribute('aria-label','SimBrief');
  var icon=el('img','',null,launcher);icon.src=base+'/simbrief/icon.svg';icon.alt='';el('span','','SimBrief',launcher);
  bus.getSubscriber().on('current_app').whenChanged().handle(function(app){var active=app==='simbrief_dispatch';page.style.display=active?'flex':'none';view.activate(active);});return view;
 }};
})(window);
