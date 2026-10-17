/* All authenticated requests execute inside the simulator. Only view data is
 * mirrored to LAN; tokens stay in this closure and are never persisted by us. */
(function(root){
 'use strict';
 var PREFIX='NAVIGRAPH_SIMBRIEF_EFB_DATASTORE_';
 function fault(message,status){var e=new Error(message);e.status=status || 0;return e;}
 function encode(data){return Object.keys(data || {}).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(String(data[k]));}).join('&');}
 function Client(authChanged){
  var listener=null,ready=null,pending={},seq=0,dead=false,requests=[];
  function receive(raw,failed){try{var d=typeof raw==='string'?JSON.parse(raw):raw,e=d&&pending[d.uuid];if(!e)return;delete pending[d.uuid];clearTimeout(e.timer);if(failed)e.reject(fault('Official SimBrief login store is unavailable.'));else e.resolve(d.result);}catch(_){} }
  function connect(){
   if(ready)return ready;
   ready=new Promise(function(resolve,reject){var expired=false,t=setTimeout(function(){expired=true;reject(fault('Open the official SimBrief app once, then reconnect here.'));},5000);
    try{listener=root.RegisterViewListener('JS_LISTENER_COMM_BUS',function(){setTimeout(function(){if(expired || dead)return;listener.on(PREFIX+'RESULT',function(raw){receive(raw,false);});listener.on(PREFIX+'ERROR',function(raw){receive(raw,true);});clearTimeout(t);resolve();},0);});}
    catch(_){clearTimeout(t);reject(fault('Simulator login service unavailable.'));}
   }).catch(function(e){if(listener&&listener.unregister)listener.unregister();ready=null;listener=null;throw e;});return ready;
  }
  async function token(){
   await connect();if(dead)throw fault('Request cancelled.');
   var result=await new Promise(function(resolve,reject){var id='pmdg-sb-'+Date.now()+'-'+(++seq)+'-'+Math.random().toString(36).slice(2);pending[id]={resolve:resolve,reject:reject,timer:setTimeout(function(){delete pending[id];reject(fault('Open the official SimBrief app to sign in or refresh its login, then reconnect here.'));},5000)};
    function fail(){if(pending[id]){clearTimeout(pending[id].timer);delete pending[id];reject(fault('Shared login could not be read.'));}}
    try{var task=listener.call('COMM_BUS_WASM_CALLBACK',PREFIX+'GET_KEY',JSON.stringify({uuid:id,params:{key:'NG_SIMBRIEF_ACCESS_TOKEN'}}));if(task&&task.catch)task.catch(fail);}catch(_){fail();}
   });
   if(!result || typeof result.value!=='string' || !result.value)throw fault('Sign in with the official SimBrief app, then reconnect here.',401);
   return result.value;
  }
  function allowed(method,path){
   if(method==='GET')return /^\/(airframes(?:\/user)?|plan\/inputs|alternates\/search|routes\/(generate|search|analyze)|tracks\/messages|plates|notams|performance\/(takeoff|landing)|flights\/(saved|history))$/.test(path)||/^\/flightplans\/[A-Za-z0-9_-]+$/.test(path)||/^\/flights\/(saved|history)\/mine\/[A-Za-z0-9_-]+$/.test(path)||/^\/(airports|airspace)\/[A-Z0-9]{4}$/.test(path)||/^\/plan\/progress\/[A-Za-z0-9_-]+$/.test(path);
   if(method==='POST')return path==='/plan/generate'||path==='/plan/calculate'||path==='/airframes/user/mine'||path==='/flights/saved/mine';
   if(method==='PUT')return /^\/airframes\/user\/mine\/[0-9]+$/.test(path);
   if(method==='DELETE')return /^\/(airframes\/user|flights\/saved)\/mine\/[0-9]+$/.test(path)||/^\/plan\/cancel\/[A-Za-z0-9_-]+$/.test(path);
   return false;
  }
  function request(method,path,data,access,options){
   options=options || {};
   return new Promise(function(resolve,reject){
    if(dead || options.job&&options.job.cancelled){reject(fault('Request cancelled.'));return;}
    var xhr=new root.XMLHttpRequest(),done=false;requests.push(xhr);if(options.job)options.job.xhr=xhr;
    function end(error,value){if(done)return;done=true;var i=requests.indexOf(xhr);if(i>=0)requests.splice(i,1);if(options.job&&options.job.xhr===xhr)options.job.xhr=null;if(error)reject(error);else resolve(value);}
    function progress(){if(options.onId){try{var id=xhr.getResponseHeader('X-Progress-ID');if(id&&/^[A-Za-z0-9_-]+$/.test(id))options.onId(id);}catch(_){}}}
    try{
     var query=method==='GET'?encode(Object.assign({_ :Date.now()},data || {})):'';
     xhr.open(method,'https://api.simbrief.com/v2'+path+(query?'?'+query:''),true);xhr.timeout=options.timeout || 20000;
     if(access)xhr.setRequestHeader('Authorization','Bearer '+access);
     if(method==='POST'||method==='PUT')xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
     xhr.onprogress=progress;
     xhr.onload=function(){progress();if(xhr.status<200 || xhr.status>=300){
      var message=xhr.status===401?'Login expired. Open the official SimBrief app to refresh, then reconnect.':'SimBrief returned HTTP '+xhr.status+'.';
      if(xhr.status!==401){try{var detail=JSON.parse(xhr.responseText).message;if(typeof detail==='string'){if(access)detail=detail.split(access).join('[redacted]');message+=' '+detail.slice(0,240);}}catch(_){}}
      if(method!=='GET')message+=' The change may not be confirmed. Refresh the server list before retrying.';end(fault(message,xhr.status));return;}
      if(method==='DELETE'&&!xhr.responseText){end(null,{});return;}if(options.text){end(null,xhr.responseText);return;}try{end(null,JSON.parse(xhr.responseText));}catch(_){end(fault('SimBrief returned an unexpected response.'));}
     };
     var uncertain=method!=='GET'&&path!=='/plan/generate'?' The server may have applied the change. Refresh the list before retrying.':'';xhr.onerror=function(){end(fault('Network / browser origin error. Check your connection.'+uncertain));};xhr.ontimeout=function(){end(fault('Request timed out.'+uncertain));};xhr.onabort=function(){end(fault('Request cancelled.'));};
     xhr.send(method==='POST'||method==='PUT'?encode(data):null);
    }catch(_){end(fault('Request could not be sent.'));}
   });
  }
  this.call=async function(method,path,data,options){
   options=options || {};if(!allowed(method,path))throw fault('Unsupported SimBrief request.');
   var publicRequest=path==='/airframes'||path==='/plan/inputs'||path.indexOf('/plan/progress/')===0;
   var access;
   try{access=publicRequest?null:await token();var result=await request(method,path,data,access,options);if(!publicRequest&&authChanged)authChanged(true);return result;}catch(e){
    // Only safe reads may retry, and only if the official app replaced its token.
    if(e.status===401&&method==='GET'&&!publicRequest&&access){try{var updated=await token();if(updated!==access){var retry=await request(method,path,data,updated,options);if(authChanged)authChanged(true);return retry;}}catch(refreshError){e=refreshError;}}
    if(e.status===401&&authChanged)authChanged(false);
    throw e;
   }
  };
  this.destroy=function(){dead=true;requests.slice().forEach(function(x){x.abort();});Object.keys(pending).forEach(function(k){clearTimeout(pending[k].timer);pending[k].reject(fault('Request cancelled.'));delete pending[k];});if(listener&&listener.unregister)listener.unregister();};
 }
 // Requests run in the simulator. Settings are installed locally and are never
 // added to the DOM or the LAN event stream. Only sanitized routes are cached.
 function AirlabsClient(){
  var settings=null,inventory=null,pending={},cache={},store='PMDG_EFB_AIRLABS_ROUTES_V1';
  try{var saved=root.GetStoredData&&root.GetStoredData(store);if(saved){var value=JSON.parse(saved);if(value&&typeof value==='object'&&!Array.isArray(value))cache=value;}}catch(_){}
  function read(url,secret){return new Promise(function(resolve,reject){
   var x=new root.XMLHttpRequest();x.open('GET',url,true);x.timeout=20000;
   x.onload=function(){
    if(x.status!==0&&(x.status<200||x.status>=300)){reject(new Error('AirLabs returned HTTP '+x.status+'.'));return;}
    try{var data=JSON.parse(x.responseText);if(data.error){var msg=String(data.error.message||'Request rejected.');if(secret)msg=msg.split(secret).join('[redacted]');throw new Error('AirLabs: '+msg.slice(0,180));}resolve(data);}catch(e){reject(e instanceof SyntaxError?new Error('AirLabs returned an unexpected response.'):e);}
   };
   x.onerror=function(){reject(new Error('AirLabs network / browser origin error.'));};x.ontimeout=function(){reject(new Error('AirLabs request timed out.'));};x.send();
  });}
  function key(){
   if(!settings)settings=read('/Pages/VCockpit/Instruments/PMDGTablet/shared/simbrief/airlabs-settings.json').then(function(data){var k=String(data.ApiKey||'').trim();if(!k)settings=null;return k;}).catch(function(e){settings=null;throw e;});return settings;
  }
  function clean(rows,airline,origin){
   if(!Array.isArray(rows))throw new Error('AirLabs returned no route list.');var seen={};return rows.map(function(r){return {airline:String(r.airline_icao||'').toUpperCase(),origin:String(r.dep_icao||'').toUpperCase(),destination:String(r.arr_icao||'').toUpperCase(),number:String(r.flight_number||'')};}).filter(function(r){var id=r.destination+':'+r.number;if(r.airline!==airline||r.origin!==origin||!/^[A-Z]{4}$/.test(r.destination)||r.destination===origin||!/^\d{1,5}$/.test(r.number)||seen[id])return false;seen[id]=true;return true;});
  }
  async function destinationRows(apiKey,airline,origin,targets){
   var id=airline+':'+origin+(targets?':installed:'+targets:''),entry=cache[id];
   if(entry&&Date.now()-entry.time>=0&&Date.now()-entry.time<6*3600000&&Array.isArray(entry.rows))return entry.rows;
    if(!pending[id])pending[id]=(async function(){
     var params={api_key:apiKey,airline_icao:airline,dep_icao:origin,limit:50,_fields:'airline_icao,dep_icao,arr_icao,flight_number'};
     if(targets)params.arr_icao=targets;
     var url='https://airlabs.co/api/v9/routes?'+encode(params),data=await read(url,apiKey),result=clean(data.response,airline,origin);
     if(targets){var allowed=targets.split(',');result=result.filter(function(r){return allowed.indexOf(r.destination)>=0;});}
     cache[id]={time:Date.now(),rows:result};var ids=Object.keys(cache).sort(function(a,b){return cache[b].time-cache[a].time;});ids.slice(8).forEach(function(k){delete cache[k];});
     try{if(root.SetStoredData)root.SetStoredData(store,JSON.stringify(cache));}catch(_){}return result;
    })().then(function(result){delete pending[id];return result;},function(error){delete pending[id];throw error;});
    return pending[id];
  }
  this.pick=async function(airline,origin,previous,preferInstalled){
   airline=String(airline||'').trim().toUpperCase();origin=String(origin||'').trim().toUpperCase();
   if(!/^[A-Z]{3}$/.test(airline)||!/^[A-Z]{4}$/.test(origin))throw new Error('Enter a three-letter airline ICAO and four-letter departure ICAO first.');
   var apiKey=await key();if(!apiKey)throw new Error('Add an AirLabs API key in the installer, then install / update.');
   var rows=[],installed=false;
   if(preferInstalled){
    var list=[];try{var snapshot=await this.installedAirports();if(Array.isArray(snapshot.Icaos))list=snapshot.Icaos;}catch(_){}
    var seenCodes={};list=list.map(function(v){return String(v).trim().toUpperCase();}).filter(function(v){if(!/^[A-Z]{4}$/.test(v)||v===origin||seenCodes[v])return false;seenCodes[v]=true;return true;}).sort();
    // Bound URL size even for large collections; normally the installed list
    // fits one request. Rotate chunk order to avoid always preferring A… codes.
    var chunks=[];for(var at=0;at<list.length;at+=240)chunks.push(list.slice(at,at+240).join(','));
    var start=Math.floor(Math.random()*chunks.length);
    for(var i=0;i<chunks.length&&!rows.length;i++)rows=await destinationRows(apiKey,airline,origin,chunks[(start+i)%chunks.length]);
    installed=rows.length>0;
   }
   if(!rows.length)rows=await destinationRows(apiKey,airline,origin,'');
   if(!rows.length)throw new Error('AirLabs returned no usable ICAO destinations and numeric flight numbers for this airline / departure.');
   // Retain the previous cache, but deduplicate old entries that differed only by aircraft.
   var seen={};rows=rows.filter(function(r){var id=r.destination+':'+r.number;if(seen[id])return false;seen[id]=true;return true;});
   var airports=[];rows.forEach(function(r){if(airports.indexOf(r.destination)<0)airports.push(r.destination);});if(airports.length>1&&previous)airports=airports.filter(function(d){return d!==previous;});
   var destination=airports[Math.floor(Math.random()*airports.length)],flights=rows.filter(function(r){return r.destination===destination;});return Object.assign({},flights[Math.floor(Math.random()*flights.length)],{installed:installed});
  };
  this.pickNumber=async function(airline,origin,destination,previous){
   function random(reason){var n=String(1+Math.floor(Math.random()*9999));if(n===previous)n=String(+n%9999+1);return {number:n,source:'random',reason:reason};}
   airline=String(airline||'').trim().toUpperCase();origin=String(origin||'').trim().toUpperCase();destination=String(destination||'').trim().toUpperCase();
   if(!/^[A-Z]{3}$/.test(airline)||!/^[A-Z]{4}$/.test(origin)||!/^[A-Z]{4}$/.test(destination)||origin===destination)return random('incomplete-input');
   var apiKey=await key();if(!apiKey)return random('missing-key');
   // A truncated departure list cannot prove that a particular route is absent.
   // Cache exact-route reads separately, including confirmed empty responses.
   var id=airline+':'+origin+':'+destination,entry=cache[id],rows;
   if(entry&&Date.now()-entry.time>=0&&Date.now()-entry.time<6*3600000&&Array.isArray(entry.rows))rows=entry.rows;
   else {
    if(!pending[id])pending[id]=(async function(){
     var params={api_key:apiKey,airline_icao:airline,dep_icao:origin,arr_icao:destination,limit:50,_fields:'airline_icao,dep_icao,arr_icao,flight_number'};
     var data=await read('https://airlabs.co/api/v9/routes?'+encode(params),apiKey),result=clean(data.response,airline,origin).filter(function(r){return r.destination===destination;});
     cache[id]={time:Date.now(),rows:result};var ids=Object.keys(cache).sort(function(a,b){return cache[b].time-cache[a].time;});ids.slice(8).forEach(function(k){delete cache[k];});
     try{if(root.SetStoredData)root.SetStoredData(store,JSON.stringify(cache));}catch(_){}return result;
    })().then(function(result){delete pending[id];return result;},function(error){delete pending[id];throw error;});
    rows=await pending[id];
   }
   var numbers=[];rows.forEach(function(r){if(r.destination===destination&&/^\d{1,5}$/.test(r.number)&&numbers.indexOf(r.number)<0)numbers.push(r.number);});
   if(!numbers.length)return random('no-route');if(numbers.length>1&&previous)numbers=numbers.filter(function(n){return n!==previous;});
   return {number:numbers[Math.floor(Math.random()*numbers.length)],source:'airlabs'};
  };
  this.installedAirports=function(){if(!inventory)inventory=read('/Pages/VCockpit/Instruments/PMDGTablet/shared/simbrief/installed-airports.json').catch(function(e){inventory=null;throw e;});return inventory;};
 }
 root.PMDGAirlabsClient=AirlabsClient;

 // Own one generation transaction per view. Never replay a POST automatically.
 function Planner(client,changed){
  var current=null;
  this.busy=function(){return !!current;};
  this.generate=async function(payload){
   if(current)throw fault('A flight plan is already being generated.');
   var job={id:Math.floor(Date.now()/1000)+'_'+Math.random().toString(36).slice(2,12),cancelled:false,timer:null,xhr:null,complete:false};current=job;
   var p=Object.assign({},payload,{progress_id:job.id}),lastProgress=null;
   function emit(d){if(current===job&&!job.cancelled)changed(d);}
   async function progress(){
    try{var d=await client.call('GET','/plan/progress/'+job.id,{}, {timeout:10000});lastProgress=d;emit({message:String(d.current_task || 'Generating flight plan…'),percent:Math.max(0,Math.min(100,Number(d.progress)||0))});return d;}catch(_){return null;}
   }
   async function poll(){await progress();if(current===job&&!job.cancelled&&!job.complete)job.timer=setTimeout(poll,1500);}
   emit({message:'Submitting flight plan…',percent:0});
   // Start polling after the POST has had time to create its progress record.
   job.timer=setTimeout(poll,1500);
   try{
    var log=await client.call('POST','/plan/generate',p,{text:true,timeout:180000,job:job,onId:function(id){job.id=id;}});
    job.complete=true;clearTimeout(job.timer);if(job.cancelled)throw fault('Generation cancelled.');
    var final=await progress() || lastProgress;
    // Official Dispatch uses `redirect == 1`, which includes JSON true.
    // A final "Done" progress record may briefly precede its redirect flag.
    function confirmed(d){return !!d&&(d.redirect===true||d.redirect===1||d.redirect==='1');}
    for(var attempt=0;attempt<2&&!confirmed(final)&&final&&/^Done\s*$/i.test(final.current_task||'')&&(final.redirect===0||final.redirect==='0'||final.redirect===false);attempt++){
     await new Promise(function(resolve){setTimeout(resolve,600);});if(job.cancelled)throw fault('Generation cancelled.');final=await progress()||final;
    }
    if(!confirmed(final) && !((!final||final.redirect==null)&&/\]\s+Done\s*$/i.test(log)))throw fault('SimBrief did not confirm completion. '+(final&&typeof final.current_task==='string'?final.current_task.slice(0,240):'Review the flight parameters and try again.'));
    emit({message:'Loading briefing…',percent:100});
    var plan=await client.call('GET','/flightplans/latest');if(job.cancelled)throw fault('Generation cancelled.');
    if(!plan.origin||!plan.destination||String(plan.origin.icao_code).toUpperCase()!==p.orig||String(plan.destination.icao_code).toUpperCase()!==p.dest)throw fault('The latest briefing belongs to another flight. Use Load latest to review it.');
    return plan;
   }catch(e){if(job.cancelled)throw fault('Generation cancelled.');if(!e.status&&/Network|timed out/.test(e.message))throw fault(e.message+' Generation may still finish on the server. Use Load latest before generating again.');throw e;}
   finally{clearTimeout(job.timer);if(current===job&&!job.cancelled)current=null;}
  };
  this.cancel=async function(){
   if(!current)return;var job=current;job.cancelled=true;clearTimeout(job.timer);if(job.xhr)job.xhr.abort();
   try{await client.call('DELETE','/plan/cancel/'+job.id,{}, {timeout:10000});}
   finally{if(current===job)current=null;}
  };
 }
 root.PMDGSimBriefClient=Client;root.PMDGSimBriefPlanner=Planner;
})(typeof window!=='undefined'?window:globalThis);
