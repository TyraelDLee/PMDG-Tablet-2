(function (root) {
 'use strict';
 function el(tag, text, parent) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (parent) parent.appendChild(n); return n; }
 root.PMDGSimBriefAuthProbe = {install: function (bus, env, base) {
  if (document.getElementById('simbrief_auth_probe')) return;
  var page = el('div', null, document.getElementById('AppContent'));
  page.id = 'simbrief_auth_probe'; page.className = 'efb_page'; page.style.display = 'none';
  el('h1', 'SimBrief · Shared Login Check · Test 2', page);
  el('p', 'Diagnostic only. The official SimBrief app owns login and token renewal.', page);
  var rows = el('section', null, page), cells = {};
  ['side', 'store', 'token', 'expires', 'api', 'changes'].forEach(function (key, i) {
   var row = el('div', null, rows); el('strong', ['Tablet', 'Official datastore', 'Access token', 'Expires (real UTC)', 'Last API check', 'Token replacements'][i], row);
   cells[key] = el('span', '—', row);
  });
  var controls = el('nav', null, page);
  function button(text, callback) { var b = el('button', text, controls); b.type = 'button'; b.onclick = callback; return b; }
  var check = button('Check login', function () { probe.check(false); });
  var api = button('Verify API access', function () { probe.check(true); });
  var watch = button('Watch changes: OFF', function () { probe.setWatch(!probe.snapshot().watch); });
  el('p', '1. Sign in once in the official MSFS SimBrief app.  2. Verify API access here.  3. Reopen the official app without signing out, then verify here again. A newer token + HTTP 200 confirms that its replacement is usable.', page);
  el('p', 'Watch checks storage every 10 seconds while this page is visible; only a token replacement triggers an API check. For natural expiry testing, leave the official app loaded and compare after the expiry time. No automatic renewal is implemented by this probe.', page);
  var log = el('pre', 'No API checks yet.', page); log.setAttribute('aria-live', 'polite');
  var signature = '';
  var probe = new root.PMDGSimBriefAuthProbeController(function (state) {
   Object.keys(cells).forEach(function (key) { var value = key === 'expires' ? (state.expires ? new Date(state.expires).toISOString().replace('T', ' ').replace('.000Z', ' Z') : '—') : String(state[key]); if (cells[key].textContent !== value) cells[key].textContent = value; });
   if (check.disabled !== state.busy) check.disabled = state.busy;
   if (api.disabled !== state.busy) api.disabled = state.busy;
   var watchText = 'Watch changes: ' + (state.watch ? 'ON' : 'OFF');
   if (watch.textContent !== watchText) watch.textContent = watchText;
   if (watch.getAttribute('aria-pressed') !== String(state.watch)) watch.setAttribute('aria-pressed', String(state.watch));
   var text = state.events.map(function (e) { return e.time.slice(11, 19) + 'Z  ' + e.message; }).join('\n');
   if (text !== signature) { signature = text; log.textContent = text || 'No API checks yet.'; }
  }, {side: env.side});
  var launcher = el('button', null, document.getElementById('remote-app-launchers')); launcher.type = 'button';
  launcher.setAttribute('aria-label', 'SimBrief Check');
  var icon = el('img', null, launcher); icon.src = base + '/simbrief-auth-probe/icon.svg'; icon.alt = '';
  el('span', 'SimBrief Check', launcher);
  launcher.onclick = function () { env.unfocus(); bus.getPublisher().pub('current_app', 'simbrief_auth_probe'); };
  bus.getSubscriber().on('current_app').whenChanged().handle(function (app) {
   var active = app === 'simbrief_auth_probe'; page.style.display = active ? 'flex' : 'none'; probe.activate(active);
  });
  root.addEventListener('beforeunload', function () { probe.destroy(); });
  return probe;
 }};
})(window);
