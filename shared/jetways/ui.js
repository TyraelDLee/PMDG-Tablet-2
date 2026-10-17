(function(root){
 'use strict';
 function el(tag,cls,text,parent){var n=document.createElement(tag);n.className=cls || '';if(text!=null)n.textContent=text;if(parent)parent.appendChild(n);return n;}
 function button(text,parent,callback){var n=el('button','jw-button',text,parent);n.type='button';n.onclick=callback;return n;}
 function View(page,env){
  var self=this;this.selected=null;this.signature='';
  var header=el('header','jw-header',null,page),heading=el('div','',null,header);
  el('h1','','IniJetway',heading);this.location=el('p','jw-subtitle','—',heading);
  this.refresh=button('Refresh',header,function(){self.selected=null;self.controller.refresh();});
  this.status=el('div','jw-status','Waiting for airport module',page);this.status.setAttribute('role','status');
  var body=el('div','jw-body',null,page),left=el('section','jw-panel',null,body),right=el('section','jw-panel',null,body);
  el('h2','jw-bar','1  Select a jetway',left);this.jetways=el('div','jw-list',null,left);
  el('h2','jw-bar','2  Select an aircraft door',right);this.doors=el('div','jw-list',null,right);
  var footer=el('footer','jw-footer',null,page);
  this.disconnect=button('Disconnect All',footer,function(){self.selected=null;self.controller.disconnectAll();});this.disconnect.classList.add('jw-danger');
  this.controller=new root.PMDGJetwayController(function(d){self.render(d);},env);
  window.addEventListener('beforeunload',function(){self.controller.destroy();});
 }
 View.prototype.render=function(d){
  var self=this,c=this.controller,available=c.available();
  if(!available || d.states[this.selected]!==0 || d.pending[this.selected])this.selected=null;
  var message=d.error || (!d.enabled?'This airport has not enabled iniBuilds multi-jetways.':d.onRunway?'Jetways are unavailable on a runway.':d.ready<3?'Waiting for airport jetways to become ready.':d.loading?'Loading jetways and aircraft doors…':!d.gotJetways || !d.gotDoors?'Refresh to load airport data.':!d.jetways.length?'No jetways detected at this parking position.':!d.doors.length?'No compatible forward left doors reported.':d.notice || 'Ready · '+d.jetways.length+' jetways · '+d.doors.length+' doors');
  this.status.textContent=message;this.status.classList.toggle('jw-error',!!d.error);
  this.refresh.disabled=d.loading || !c.bound || Object.keys(d.pending).length>0;
  this.disconnect.disabled=!available || !d.jetways.some(function(j){return d.states[j.index]===6 && !d.pending[j.index];});
  this.location.textContent=d.airport?(d.airport+(d.gate?' · '+d.gate:'')):'—';
  var sig=JSON.stringify([d.jetways,d.doors,d.states,d.pending,d.assignments,available,this.selected]);if(sig===this.signature)return;this.signature=sig;
  this.jetways.textContent='';this.doors.textContent='';
  var names=['Available','Rotating base','Adjusting height','Rotating cabin','Extending','In transit','Connected'];
  d.jetways.forEach(function(j){
   var state=d.states[j.index],pending=!!d.pending[j.index],b=button('',self.jetways,function(){if(state===6){self.selected=null;c.disconnect(j.index);}else{self.selected=self.selected===j.index?null:j.index;self.render(d);}});
   b.classList.add('jw-card');b.setAttribute('data-jetway',String(j.index));b.setAttribute('aria-pressed',self.selected===j.index?'true':'false');
   el('strong','','Jetway '+(j.index+1),b);el('span','jw-card-note',pending?'Command sent…':names[state] || 'Unknown state',b);
   if(state===6)el('span','jw-card-action','Disconnect',b);
   b.disabled=!available || pending || (state!==0 && state!==6);
  });
  if(!d.jetways.length)el('p','jw-empty','Airport jetways will appear here.',this.jetways);
  var minimum=d.doors.length?Math.min.apply(Math,d.doors.map(function(door){return Math.abs(door.pos_y);})):0,left=0,upper=0;
  d.doors.forEach(function(door){
   var isUpper=Math.abs(door.pos_y)>minimum*0.7 && Math.abs(door.pos_y)-minimum>1.5;
   var label=isUpper?'Upper Door '+(++upper):'Left Door '+(++left);
   var occupied=Object.keys(d.assignments).some(function(id){return d.assignments[id]===door.interactive_point && (d.pending[id] || d.states[id]!==0);});
   var b=button('',self.doors,function(){if(self.selected!==null && c.summon(self.selected,door.interactive_point)){self.selected=null;self.render(d);}});
   b.classList.add('jw-card');b.setAttribute('data-door',String(door.interactive_point));el('strong','',label,b);
   el('span','jw-card-note',occupied?'Assigned to a jetway':self.selected===null?'Select a jetway first':'Connect selected jetway',b);
   b.disabled=!available || self.selected===null || occupied;
  });
  if(!d.doors.length)el('p','jw-empty','Compatible aircraft doors will appear here.',this.doors);
 };
 root.PMDGMultiJetways={install:function(bus,base,env){
  if(document.getElementById('ini_jetways'))return;
  var page=el('div','efb_page',null,document.getElementById('AppContent'));page.id='ini_jetways';page.style.display='none';var view=new View(page,env);
  var launcher=button('',document.getElementById('remote-app-launchers'),function(){bus.getPublisher().pub('current_app','ini_jetways');});launcher.setAttribute('aria-label','IniJetway');
  var image=el('img','',null,launcher);image.src=base+'/jetways/icon.svg';image.alt='';el('span','','IniJetway',launcher);
  bus.getSubscriber().on('current_app').whenChanged().handle(function(app){var active=app==='ini_jetways';page.style.display=active?'flex':'none';view.selected=null;view.controller.activate(active);});
  return view;
 }};
})(window);
