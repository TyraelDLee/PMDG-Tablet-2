/* Read-only SimBrief shared-login diagnostic. No refresh-token reads or writes. */
(function (root) {
 'use strict';
 var PREFIX = 'NAVIGRAPH_SIMBRIEF_EFB_DATASTORE_';
 var KEY = 'NG_SIMBRIEF_ACCESS_TOKEN';
 function expiry(token) {
  try {
   var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
   while (part.length % 4) part += '=';
   var claims = JSON.parse(root.atob(part));
   return typeof claims.exp === 'number' && isFinite(claims.exp) ? claims.exp * 1000 : null;
  } catch (_) { return null; }
 }
 function Probe(changed, options) {
  options = options || {};
  var self = this, listener = null, ready = null, pending = {}, timer = null;
  var active = false, dead = false, generation = 0, busy = false, lastToken = null, sequence = 0, xhr = null;
  var requestTimeout = options.requestTimeout || 5000;
  var state = {side: options.side || 'CA', store: 'Not checked', token: 'Not checked', expires: null,
   api: 'Not checked', changes: 0, watch: false, busy: false, events: []};
  function emit() { if (!dead) changed(JSON.parse(JSON.stringify(state))); }
  function event(message) {
   state.events.unshift({time: new Date().toISOString(), message: message});
   state.events = state.events.slice(0, 18);
  }
  function result(raw, failed) {
   try {
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || !pending[data.uuid]) return;
    var entry = pending[data.uuid]; delete pending[data.uuid]; clearTimeout(entry.timer);
    // Never forward the vendor's error text; it may contain stored values.
    if (failed) entry.reject(new Error('store-error')); else entry.resolve(data.result);
   } catch (_) { /* Ignore unrelated or malformed CommBus broadcasts. */ }
  }
  function connect() {
   if (ready) return ready;
   ready = new Promise(function (resolve, reject) {
    var cancelled = false;
    var timeout = setTimeout(function () { cancelled = true; reject(new Error('listener-timeout')); }, requestTimeout);
    try {
     listener = root.RegisterViewListener('JS_LISTENER_COMM_BUS', function () {
      // The simulator can call this callback before returning the listener.
      setTimeout(function () {
       if (dead || cancelled) { clearTimeout(timeout); reject(new Error('stopped')); return; }
       listener.on(PREFIX + 'RESULT', function (raw) { result(raw, false); });
       listener.on(PREFIX + 'ERROR', function (raw) { result(raw, true); });
       clearTimeout(timeout); resolve();
      }, 0);
     });
    } catch (_) { clearTimeout(timeout); reject(new Error('listener-unavailable')); }
   }).catch(function () {
    if (listener && listener.unregister) listener.unregister();
    listener = null; ready = null; throw new Error('listener-unavailable');
   });
   return ready;
  }
  function read() {
   return connect().then(function () {
    if (dead || !active) throw new Error('stopped');
    return new Promise(function (resolve, reject) {
     var id = 'pmdg-sb-probe-' + state.side + '-' + Date.now() + '-' + (++sequence) + '-' + Math.random().toString(36).slice(2);
     var timeout = setTimeout(function () { delete pending[id]; reject(new Error('store-timeout')); }, requestTimeout);
     pending[id] = {resolve: resolve, reject: reject, timer: timeout};
     function fail() { if (pending[id]) { clearTimeout(timeout); delete pending[id]; reject(new Error('store-error')); } }
     try {
      var task = listener.call('COMM_BUS_WASM_CALLBACK', PREFIX + 'GET_KEY', JSON.stringify({uuid: id, params: {key: KEY}}));
      if (task && task.catch) task.catch(fail);
     } catch (_) { fail(); }
    });
   }).then(function (data) {
    if (!data || typeof data.value !== 'string' || !data.value) return null;
    return data.value;
   });
  }
  function verify(token) {
   return new Promise(function (resolve) {
    var request = new root.XMLHttpRequest(); xhr = request;
    function done(value) { if (xhr === request) xhr = null; resolve(value); }
    try {
     request.open('GET', 'https://api.simbrief.com/v2/airframes/user', true);
     request.timeout = 15000;
     request.setRequestHeader('Authorization', 'Bearer ' + token);
     // Match the official client's CORS-safe headers. The API does not allow Cache-Control.
     request.onload = function () {
      // Do not expose account data, response bodies, or credentials to DOM/LAN/logs.
      var code = request.status;
      if (code === 200) {
       try { var data = JSON.parse(request.responseText); if (!data || typeof data !== 'object') throw new Error(); }
       catch (_) { done('Unexpected response; authentication not confirmed'); return; }
       done('HTTP 200 — shared login accepted');
      } else if (code === 401) done('HTTP 401 — rejected; open the official app to refresh, then check again');
      else if (code === 403) done('HTTP 403 — access denied; sharing not confirmed');
      else done('HTTP ' + code + ' — not verified');
     };
     request.onerror = function () { done('Network / CORS failure (HTTP 0) — API response unavailable'); };
     request.ontimeout = function () { done('Request timed out — not verified'); };
     request.onabort = function () { done('Cancelled'); };
     request.send();
    } catch (_) { done('Request unavailable — not verified'); }
   });
  }
  this.check = async function (checkApi) {
   if (dead || !active || busy) return;
   busy = true; state.busy = true; emit(); var run = generation;
   try {
    var token = await read();
    if (dead || run !== generation || !active) return;
    state.store = 'Responding';
    var replaced = !!token && lastToken !== null && token !== lastToken;
    var lost = !token && lastToken !== null;
    if (replaced) { state.changes++; event('Token replacement observed. This alone does not prove a refresh.'); }
    if (lost) event('Shared login cleared or unavailable.');
    lastToken = token; state.expires = token ? expiry(token) : null;
    state.token = !token ? 'No saved login' : !state.expires ? 'Present — expiry unreadable' : state.expires <= Date.now() ? 'Expired' : 'Present — not expired';
    if (!token) state.api = 'No saved login — sign in using the official SimBrief app';
    else if (replaced) state.api = 'New token not checked';
    if (token && (checkApi || (state.watch && replaced))) {
     state.api = 'Checking read-only API…'; emit();
     var status = await verify(token);
     if (dead || run !== generation || !active) return;
     state.api = status; event((replaced ? 'Replacement token: ' : 'API check: ') + status);
    }
   } catch (_) {
    if (dead || run !== generation || !active) return;
    state.store = 'No usable reply — check that the official SimBrief package is installed and loaded';
    state.token = 'Unknown'; state.expires = null; state.api = 'Not verified';
    // A fresh attempt can recover after the simulator listener becomes available.
    if (!listener) ready = null;
   } finally {
    busy = false; state.busy = false;
    if (!dead && run === generation) { emit(); schedule(); }
    else if (!dead && active) { setTimeout(function () { self.check(false); }, 0); }
   }
  };
  function schedule() {
   clearTimeout(timer); timer = null;
   if (active && state.watch && !dead) timer = setTimeout(function () { self.check(false); }, options.interval || 10000);
  }
  this.setWatch = function (value) { state.watch = !!value; emit(); schedule(); };
  this.activate = function (value) {
   active = !!value; generation++; clearTimeout(timer); timer = null;
   if (!active) {
    if (xhr) xhr.abort();
    Object.keys(pending).forEach(function (id) { clearTimeout(pending[id].timer); pending[id].reject(new Error('stopped')); delete pending[id]; });
   } else if (!busy) self.check(false);
   else schedule();
  };
  this.destroy = function () {
   self.activate(false); dead = true; lastToken = null;
   if (listener && listener.unregister) listener.unregister();
  };
  this.snapshot = function () { return JSON.parse(JSON.stringify(state)); };
 }
 root.PMDGSimBriefAuthProbeController = Probe;
})(typeof window !== 'undefined' ? window : globalThis);
