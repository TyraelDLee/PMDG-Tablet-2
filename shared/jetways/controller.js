/* iniBuilds airport CommBus adapter. No animation engine and no background commands. */
(function(root){
 'use strict';
 function number(v){return typeof v==='number' && isFinite(v);}
 function index(v){return number(v) && v>=0 && Math.floor(v)===v;}
 function parse(v){return typeof v==='string'?JSON.parse(v):v;}
 function Controller(changed,env){
  this.env=env||{};this.locationBusy=false;this.locationVersion=0;
  this.changed=changed;this.active=false;this.listener=null;this.bound=false;this.timer=null;this.requestedAt=0;this.lastKey='';
  this.data={airport:'',gate:'',enabled:false,ready:0,onRunway:false,loading:false,gotJetways:false,gotDoors:false,version:'',error:'',notice:'',jetways:[],doors:[],states:{},assignments:{},pending:{}};
 }
 // ini's AirportHelper resolves a nearby airport and its parking bias offsets.
 // Query on entry/Refresh, never on a per-frame or periodic timer.
 Controller.prototype.updateLocation=async function(){
  if(!this.active||this.locationBusy||!this.env.currentAirport)return;
  this.locationBusy=true;var version=this.locationVersion;
  try{
   var lat=Number(SimVar.GetSimVarValue('PLANE LATITUDE','degrees')),lon=Number(SimVar.GetSimVarValue('PLANE LONGITUDE','degrees'));
   if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;
   var airport=await this.env.currentAirport(lat,lon);if(!this.active||version!==this.locationVersion)return;
   var ident=airport&&airport.icaoStruct&&airport.icaoStruct.ident,gate=null,best=Infinity;
   if(airport&&isFinite(airport.lat)&&isFinite(airport.lon)){
    var cos=Math.cos(airport.lat*Math.PI/180),meters=111320;
    (airport.gates||[]).forEach(function(g){
     var x=Number(g.longitude),z=Number(g.latitude);if(!isFinite(x)||!isFinite(z)||Math.sqrt(x*x+z*z)>5000)return;
     var dx=(lon-airport.lon)*meters*cos-x,dz=(lat-airport.lat)*meters-z,distance=dx*dx+dz*dz;
     if(distance<best){best=distance;gate=g;}
    });
   }
   this.data.airport=ident?String(ident).toUpperCase():'';
   this.data.gate=gate&&gate.number!=null?((gate.name>=12&&gate.name<=37?String.fromCharCode(65+gate.name-12):'')+String(gate.number)):'';
   this.emit();
  }catch(_){if(this.active&&version===this.locationVersion){this.data.airport='';this.data.gate='';this.emit();}}
  finally{this.locationBusy=false;if(this.active&&version!==this.locationVersion)this.updateLocation();}
 };
 Controller.prototype.emit=function(){if(this.active && this.changed)this.changed(this.data);};
 Controller.prototype.call=function(name,payload,onError){
  try{
   if(!this.listener || !this.bound)throw Error('CommBus unavailable');
   var task=this.listener.call('COMM_BUS_WASM_CALLBACK',name,payload || '');
   if(task && task.catch)task.catch(onError || function(){});
  }catch(e){if(onError)onError(e);}
 };
 Controller.prototype.init=function(){
  if(this.listener)return;
  var self=this;
  try{
   this.listener=RegisterViewListener('JS_LISTENER_COMM_BUS',function(){
    // RegisterViewListener may invoke its callback before returning the listener.
    setTimeout(function(){if(self.active)self.poll();},0);
   });
   ['JetwayDataResponse','DoorDataResponse','JetwayAnimUpdate','JetwayNotification','JetwayVersionNumber'].forEach(function(name){
    self.listener.on(name,function(raw){if(self.active)self.receive(name,raw);});
   });
   this.bound=true;
  }catch(e){if(this.listener && this.listener.unregister)this.listener.unregister();this.listener=null;this.bound=false;this.data.error='Simulator communication is unavailable';}
 };
 Controller.prototype.receive=function(name,raw){
  var d=this.data;
  try{
   if(name==='JetwayVersionNumber'){d.version=String(raw).slice(0,60);this.emit();return;}
   var v=parse(raw);
   if(!v || typeof v!=='object')return;
   if(name==='JetwayDataResponse'){
    if(!Array.isArray(v.jetway_data))return;
    d.jetways=v.jetway_data.filter(function(j){return j && index(j.index) && j.index!==99;});
    var states={},pending={};d.jetways.forEach(function(j){states[j.index]=number(j.anim_stage)?j.anim_stage:0;if(d.pending[j.index] && states[j.index]===d.pending[j.index].from)pending[j.index]=d.pending[j.index];});
    d.states=states;d.pending=pending;Object.keys(d.assignments).forEach(function(id){if(!Object.prototype.hasOwnProperty.call(states,id) || (states[id]===0 && !pending[id]))delete d.assignments[id];});d.gotJetways=true;
   }else if(name==='DoorDataResponse'){
    if(!Array.isArray(v.door_data))return;
    d.doors=v.door_data.filter(function(door){return door && index(door.interactive_point) && number(door.pos_x) && number(door.pos_z) && number(door.pos_y) && door.pos_x<0 && door.pos_z>0 && (door.type===0 || door.type===2);});
    d.gotDoors=true;
    if(d.doors.length){
     var minimum=Math.min.apply(Math,d.doors.map(function(door){return Math.abs(door.pos_y);}));
     // The original app publishes this value for the airport's module too.
     try{var result=SimVar.SetSimVarValue('L:INI_JETWAY_MIN_DOOR_Y','number',minimum);if(result && result.catch)result.catch(function(){});}catch(_){}
    }
   }else if(name==='JetwayAnimUpdate'){
    if(!index(v.jetway_index) || !number(v.anim_stage))return;
    d.states[v.jetway_index]=v.anim_stage;
    if(d.pending[v.jetway_index] && d.pending[v.jetway_index].from!==v.anim_stage)delete d.pending[v.jetway_index];
    if(v.anim_stage===0)delete d.assignments[v.jetway_index];
   }else if(name==='JetwayNotification'){
    d.notice=typeof v.message==='string'?v.message.slice(0,1000):'';
    if(v.level==='error' && v.meta && index(v.meta.jetway_index))delete d.pending[v.meta.jetway_index];
   }
   if(d.gotJetways && d.gotDoors)d.loading=false;
   this.emit();
  }catch(e){d.error='Unrecognized airport response. Try Refresh.';this.emit();}
 };
 Controller.prototype.available=function(){var d=this.data;return this.active && this.bound && d.enabled && d.ready>=3 && !d.onRunway && !d.loading && d.gotJetways && d.gotDoors;};
 Controller.prototype.refresh=function(reconcile){
  var self=this,d=this.data;
  if(!this.active || !this.bound || d.loading || (Object.keys(d.pending).length && reconcile!==true))return;
  this.updateLocation();
  d.error='';d.notice='';
  if(!d.enabled || d.ready<3 || d.onRunway){this.emit();return;}
  d.loading=true;d.gotJetways=false;d.gotDoors=false;this.requestedAt=Date.now();this.emit();
  function fail(){d.loading=false;d.error='Airport did not accept the data request. Try Refresh.';self.emit();}
  this.call('JetwayVersionNumberRequest','',function(){});
  this.call('JetwayDataRequest','',fail);this.call('AircraftDoorCountRequest','',fail);
 };
 Controller.prototype.poll=function(){
  if(!this.active)return;
  var d=this.data,self=this,old=this.lastKey;
  try{d.enabled=!!SimVar.GetSimVarValue('L:INI_JETWAYS_ENABLED','bool');d.ready=Number(SimVar.GetSimVarValue('L:INI_JETWAYS_READY_STATE','number'))||0;d.onRunway=!!SimVar.GetSimVarValue('ON ANY RUNWAY','bool');}catch(e){d.error='Waiting for simulator variables';}
  var key=[d.enabled,d.ready>=3,d.onRunway].join(':');this.lastKey=key;
  if(key!==old){
   if(!d.enabled || d.ready<3 || d.onRunway){d.loading=false;d.gotJetways=false;d.gotDoors=false;d.jetways=[];d.doors=[];d.pending={};d.assignments={};}
   else this.refresh(true);
   this.emit();
  }
  if(d.loading && Date.now()-this.requestedAt>10000){d.loading=false;d.error='No response from the airport module. Try Refresh.';this.emit();}
  Object.keys(d.pending).forEach(function(id){if(Date.now()-d.pending[id].at>12000){delete d.pending[id];d.error='Command status is unknown. Refresh before trying again.';d.gotJetways=false;self.emit();}});
 };
 Controller.prototype.summon=function(jw,target){
  var self=this,d=this.data,state=d.states[jw];
  if(!this.available() || !index(jw) || !index(target) || d.pending[jw] || (state!==0 && state!==6) || !d.jetways.some(function(j){return j.index===jw;}))return false;
  if(state===0 && !d.doors.some(function(door){return door.interactive_point===target;}))return false;
  // Do not dispatch a second jetway to an already assigned door.
  if(state===0 && Object.keys(d.assignments).some(function(id){return Number(id)!==jw && d.assignments[id]===target && (d.pending[id] || d.states[id]!==0);}))return false;
  d.pending[jw]={at:Date.now(),from:state};d.notice='';d.error='';if(state===0)d.assignments[jw]=target;this.emit();
  this.call('JetwaySummonRequest',JSON.stringify({jetway_index:jw,target_index:target}),function(){delete d.pending[jw];d.error='Command could not be sent. Refresh and check the jetway.';d.gotJetways=false;self.emit();});return true;
 };
 Controller.prototype.disconnect=function(jw){var d=this.data;if(d.states[jw]!==6)return false;return this.summon(jw,Object.prototype.hasOwnProperty.call(d.assignments,jw)?d.assignments[jw]:0);};
 Controller.prototype.disconnectAll=function(){var self=this;this.data.jetways.forEach(function(j){self.disconnect(j.index);});};
 Controller.prototype.activate=function(active){
  if(this.active===active)return;this.active=active;this.locationVersion++;clearInterval(this.timer);this.timer=null;
  if(active){this.data.airport='';this.data.gate='';this.updateLocation();}
  if(active){this.lastKey='';this.data.loading=false;this.init();this.poll();var self=this;this.timer=setInterval(function(){self.poll();},1000);this.emit();}
 };
 Controller.prototype.destroy=function(){this.activate(false);if(this.listener && this.listener.unregister)this.listener.unregister();this.changed=null;};
 root.PMDGJetwayController=Controller;
})(window);
