/* SimBrief v2 form mapping. No authentication or simulator dependencies. */
(function (root) {
 'use strict';
 function str(value) { return value == null || value === false ? '' : String(value).trim(); }
 function upper(value) { return str(value).toUpperCase(); }
 function catalog(system, personal) {
  if (!Array.isArray(system) || !Array.isArray(personal)) throw new Error('Unexpected aircraft catalogue response.');
  var byBase = {}, groups = {}, frames = {};
  system.forEach(function (aircraft) { byBase[aircraft.aircraft_id] = aircraft; });
  function add(frame, personalFrame) {
   var id = str(frame.airframe_internal_id), base = str(frame.airframe_base_type), code = upper(frame.airframe_icao || base);
   if (!id || !code || !base) return;
   var data = byBase[base] || {}, options = frame.airframe_options || {};
   var group=data.aircraft_icao===code?base:code;
   frames[id] = {id:id, recordId:str(frame.airframe_id), base:base, icao:code, group:group, groupName:str(group===base?data.aircraft_name:frame.airframe_name), name:str(frame.airframe_name || data.aircraft_name || code),
    label:[frame.airframe_registration, frame.airframe_comments || frame.airframe_name].filter(Boolean).join(' · '),
    options:options, data:data, personal:!!personalFrame};
  }
  system.forEach(function (a) { (a.airframes || []).forEach(function (f) { add(f, false); }); });
  personal.forEach(function (f) { add(f, true); });
  Object.keys(frames).forEach(function (id) { var f=frames[id]; if(!groups[f.group])groups[f.group]={id:f.group,icao:f.icao,name:f.groupName || f.name,frames:[]};groups[f.group].frames.push(f); });
  return Object.keys(groups).sort().map(function (code) { groups[code].frames.sort(function(a,b){return Number(b.personal)-Number(a.personal) || a.label.localeCompare(b.label);});return groups[code]; });
 }
 function utcInput(now) { return typeof now==='number'&&isFinite(now)?new Date(now).toISOString().slice(0,16).replace('T',' '):''; }
 function simulatorUTC(sim) {
  if(!sim)return null;
  function read(name,unit,global){try{var value=global?sim.GetGlobalVarValue(name,unit):sim.GetSimVarValue('E:'+name,unit);return value==null||value===''?NaN:Number(value);}catch(_){return NaN;}}
  for(var mode=0;mode<2;mode++){
   var y=read('ZULU YEAR','number',mode),m=read('ZULU MONTH OF YEAR','number',mode),d=read('ZULU DAY OF MONTH','number',mode),s=read('ZULU TIME','seconds',mode);
   if(Math.floor(y)!==y||y<100||y>9999||Math.floor(m)!==m||m<1||m>12||Math.floor(d)!==d||d<1||d>31||!isFinite(s)||s<0||s>=86400)continue;
   var date=new Date(Date.UTC(y,m-1,d));if(date.getUTCMonth()!==m-1||date.getUTCDate()!==d)continue;
   return date.getTime()+Math.floor(s)*1000;
  }
  // SDK ABSOLUTE TIME is simulator Zulu seconds since 0001-01-01.
  // This fallback is still simulator data, never the device's clock.
  for(var absoluteMode=0;absoluteMode<2;absoluteMode++){
   var absolute=read('ABSOLUTE TIME','seconds',absoluteMode),stamp=(absolute-62135596800)*1000;
   if(isFinite(absolute)&&stamp>=Date.UTC(1900,0,1)&&stamp<=Date.UTC(9999,11,31))return Math.floor(stamp/1000)*1000;
  }
  return null;
 }
 // Dispatch searches in server-ranked order, then applies the airframe's
 // alternate weather/runway criteria locally. Do not invent an airport.
 function alternateCriteria(frame,extra) {
  var o=Object.assign({},frame.options,extra||{}),a=frame.data;
  function num(k,fallback){return o[k]!==false&&o[k]!=null&&String(o[k]).trim()!==''&&isFinite(+o[k])?+o[k]:fallback;}
  var runway=100*Math.round(Math.min(Math.max(Math.min(1.25*(+a.aircraft_takeoff||0),7000),Math.min(2*(+a.aircraft_landing||0),7000)),7000)/100)||7000;
  var visibility=num('altnsadv_vis',3000),length=num('altnsadv_rwy',runway);
  if(o.altnsadv_units_vis==='sm'&&o.altnsadv_vis)visibility=Math.round(visibility*1609.344);
  if(o.altnsadv_units_rwy==='m'&&o.altnsadv_rwy)length=Math.round(length*3.28084);
  return {ceiling:num('altnsadv_cig',600),visibility:visibility,runway:length,avoid:num('altnsadv_tsfgfz',1)===1,radius:num('altnsadv_radius',+a.aircraft_diversion_distance||400),exclude:String(o.altnsadv_exclude||'').toUpperCase().split(/[^A-Z0-9]+/)};
 }
 function chooseAlternate(data,criteria) {
  if(!data||!Array.isArray(data.destination))throw new Error('Unexpected alternate search response.');
  var list=data.destination.filter(function(a){return /^[A-Z0-9]{4}$/.test(a.airport_icao)&&criteria.exclude.indexOf(a.airport_icao)<0&&criteria.exclude.indexOf(a.airport_iata)<0&&a.lowest_ceiling!=null&&a.lowest_visibility!=null&&a.runways_longest!=null&&+a.lowest_ceiling>=criteria.ceiling&&+a.lowest_visibility>=criteria.visibility&&+a.runways_longest>=criteria.runway&&(!criteria.avoid||String(a.fg_ts_fzra)!=='1');});
  return list.length?list[0].airport_icao:'';
 }
 function utcDate(value) {
  var m=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(str(value));
  if(!m)throw new Error('Departure UTC must be YYYY-MM-DD HH:mm.');
  var d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]));
  if(d.toISOString().slice(0,16)!==m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5])throw new Error('Departure UTC is not a valid date/time.');
  return m[3]+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2]-1]+' '+m[1]+' - '+m[4]+':'+m[5];
 }
 function defaults(frame) {
  var o=frame.options,d=frame.data;
  return {reg:upper(o.reg),cruisesub:str(o.defaultci),cruisemode:str(o.defaultcruise || d.aircraft_default_cruise || 'CI'),
   climb:str(o.defaultclimb || (d.aircraft_profiles_climb || [])[0]),descent:str(o.defaultdescent || (d.aircraft_profiles_descent || [])[0])};
 }
 function payload(form,frame) {
  if(!frame)throw new Error('Select an aircraft and airframe.');
  var p={type:frame.id,basetype:frame.base},o=frame.options;
  ['orig','dest'].forEach(function(k){p[k]=upper(form[k]);if(!/^[A-Z0-9]{4}$/.test(p[k]))throw new Error('Enter a four-character '+(k==='orig'?'departure':'destination')+' ICAO code.');});
  p.airline=upper(form.airline);if(p.airline && !/^[A-Z0-9]{3}$/.test(p.airline))throw new Error('Airline must be its three-character ICAO code.');
  p.fltnum=str(form.fltnum);if(p.fltnum && !/^\d{1,5}$/.test(p.fltnum))throw new Error('Flight number must contain digits only; enter the airline separately.');
  p.date=utcDate(form.date);p.pounds=form.pounds==='1'?'1':'0';
  ['reg','route','callsign','origrwy','destrwy','altn_1_id'].forEach(function(k){p[k]=upper(form[k]);});
  if(p.altn_1_id && !/^[A-Z0-9]{4}$/.test(p.altn_1_id))throw new Error('Alternate must be a four-character ICAO code, or blank for automatic.');
  ['pax','cargo','cruisesub','addedfuel','taxiout','taxiin'].forEach(function(k){p[k]=str(form[k]);if(p[k] && !/^\d+$/.test(p[k]))throw new Error(k+' must be a non-negative whole number or blank.');});
  if(p.pax && +p.pax>+(o.maxpax || 999))throw new Error('Passengers exceed the selected airframe capacity.');
  if(p.cruisesub && frame.data.aircraft_max_costindex!=null && +p.cruisesub>+frame.data.aircraft_max_costindex)throw new Error('Cost index exceeds this aircraft’s limit.');
  var fl=upper(form.fl);if(fl && !/^(FL\d{2,3}|\d{4,5})$/.test(fl))throw new Error('Altitude must be feet (35000) or a flight level (FL350).');
  p.fl=fl.indexOf('FL')===0?String(+fl.slice(2)*100):fl;
  if(p.fl && (+p.fl<1000 || +p.fl>60000))throw new Error('Altitude must be between 1000 and 60000 feet.');
  ['cruisemode','climb','descent','planformat'].forEach(function(k){p[k]=str(form[k]);});
  ['navlog','etops','stepclimbs','tlr','notams','firnot'].forEach(function(k){p[k]=form[k]==='1'?'1':'0';});
  p.maps='-1';p.flightrules='i';p.flighttype='s';p.addedfuel_units='wgt';
  // The airframe ID resolves its weight/performance model on the server. These
  // values are explicitly populated by Dispatch when changing an airframe.
  ['fin','selcal','hexcode','transponder','pbn','extrarmk','etopsthreshold','manualrmk'].forEach(function(k){if(str(o[k]))p[k]=str(o[k]);});
  if(str(o.equip))p.equipment=str(o.equip);
  p.fuelfactor='1';var factor=/^([PM])(\d+(?:\.\d+)?)$/.exec(str(o.fuelfactor));
  if(factor)p.fuelfactor=String(1+(factor[1]==='M'?-1:1)*+factor[2]/100);
  return p;
 }
 function routeQuery(p) {return {orig:p.orig,dest:p.dest,type:p.type,targetfl:p.fl,origrwy:p.origrwy,destrwy:p.destrwy};}
 // Dispatch format_data(..., 'time') accepts HH:mm[:ss], not just seconds.
 function durationSeconds(value){
  if(value==null||value===''||typeof value==='boolean')return null;
  var text=String(value).trim(),m=/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if(m)return +m[2]<60&&(+m[3]||0)<60?+m[1]*3600+(+m[2])*60+(+m[3]||0):null;
  // Some responses format durations as a UTC time on the epoch date.
  m=/^1970-01-01T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(text);
  if(m)return +m[1]<24&&+m[2]<60&&(+m[3]||0)<60?+m[1]*3600+(+m[2])*60+(+m[3]||0):null;
  return /^\d+(?:\.\d+)?$/.test(text)&&isFinite(+text)?+text:null;
 }
 function routeDuration(routes){
  var first=Array.isArray(routes)&&routes[0],value=first&&first.estimated_gatetogate;
  if(value==null&&first&&first.sample_result)value=first.sample_result.estimated_gatetogate;
  var duration=durationSeconds(value);if(duration==null||duration<=0)throw new Error('Route search returned no valid gate-to-gate duration.');return duration;
 }
 function routeSearchQuery(p,date){
  utcDate(date);var query={origin:upper(p.orig),destination:upper(p.dest),aircraft:p.type,enable_routefinder:'1',departure_time:Date.parse(date.replace(' ','T')+':00Z')/1000};
  if(p.origrwy)query.origin_runway=upper(p.origrwy);if(p.destrwy)query.destination_runway=upper(p.destrwy);return query;
 }
 var api={catalog:catalog,defaults:defaults,payload:payload,routeQuery:routeQuery,routeSearchQuery:routeSearchQuery,durationSeconds:durationSeconds,routeDuration:routeDuration,utcInput:utcInput,utcDate:utcDate,simulatorUTC:simulatorUTC,alternateCriteria:alternateCriteria,chooseAlternate:chooseAlternate};
 root.PMDGSimBriefCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
