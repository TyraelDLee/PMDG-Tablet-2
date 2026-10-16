(function (root) {
    'use strict';
    function node(tag, className, text, parent) {
        var e = document.createElement(tag); e.className = className || '';
        if (text != null) e.textContent = text;
        if (parent) parent.appendChild(e);
        return e;
    }
    function fmt(n, places) { return typeof n === 'number' && isFinite(n) ? n.toFixed(places || 0) : '--'; }
    function dateText(record) {
        if (Object.prototype.hasOwnProperty.call(record,'zuluTimestamp')) {
            if (typeof record.zuluTimestamp !== 'number' || !isFinite(record.zuluTimestamp)) return '-- Z';
            var utc=new Date(record.zuluTimestamp);
            return utc.toISOString().slice(0,19).replace('T','  ') + ' Z';
        }
        // Legacy records have only a real-world timestamp: retain their old display.
        var d = new Date(record.timestamp);
        function two(n) { return ('0' + n).slice(-2); }
        return d.getFullYear() + '-' + two(d.getMonth()+1) + '-' + two(d.getDate()) + '  ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
    }
    function metrics(parent) {
        var grid = node('div','la-metrics',null,parent), fields = {};
        [['g','Touchdown G','G'],['rate','Touchdown rate','ft/min'],['pitch','Pitch','° · nose up +'],
            ['speed','Speed','kt · IAS / GS'],['wind','Wind','kt · direction °T'],
            ['slip','Sideslip','° · body velocity'],['bounces','Bounces','after first contact']].forEach(function (item) {
            var cell = node('div','la-metric la-' + item[0],null,grid);
            node('div','la-label',item[1],cell);
            fields[item[0]] = node('div','la-value','--',cell);
            node('div','la-unit',item[2],cell);
        });
        return function (r) {
            Object.keys(fields).forEach(function (k) { fields[k].textContent = '--'; });
            if (!r) return;
            fields.rate.textContent = fmt(r.rate);
            fields.g.textContent = fmt(r.g,2);
            fields.pitch.textContent = (r.pitch > 0 ? '+' : '') + fmt(r.pitch,1);
            fields.speed.textContent = fmt(r.airspeed) + ' / ' + fmt(r.groundSpeed);
            var degrees = typeof r.windDirection === 'number' ? Math.round((r.windDirection % 360 + 360) % 360) % 360 : null;
            fields.wind.textContent = fmt(r.windSpeed) + ' / ' + (degrees === null ? '--' : ('00'+degrees).slice(-3)) + '°';
            fields.slip.textContent = r.slip == null ? '--' : fmt(Math.abs(r.slip),1) + (r.slip > 0.05 ? ' L' : r.slip < -0.05 ? ' R' : '');
            fields.bounces.textContent = String(r.bounces);
        };
    }
    function View(page, service) {
        var self = this; this.service = service; this.selected = null; this.signature = '';
        page.classList.add('landing-analysis');
        var heading = node('header','la-header',null,page);
        node('h1','la-title','Landing Analysis',heading);

        var body = node('div','la-body',null,page), left = node('div','la-left',null,body);
        var current = node('section','la-panel la-current',null,left);
        var currentBar = node('div','la-section-bar',null,current);
        node('h2','','Current landing',currentBar);
        this.currentBadge = node('span','la-badge','LIVE',currentBar);
        this.currentMeta = node('div','la-meta','No touchdown recorded this flight',current);
        this.renderCurrent = metrics(current);
        var previous = node('section','la-panel la-previous',null,left);
        var previousBar = node('div','la-section-bar',null,previous);
        node('h2','','Selected landing',previousBar);
        this.selectedMeta = node('div','la-meta','Select a landing from the history',previous);
        this.renderSelected = metrics(previous);
        var right = node('aside','la-panel la-history',null,body);
        var historyBar = node('div','la-section-bar',null,right);
        node('h2','','History',historyBar); this.count = node('span','la-count','0',historyBar);
        node('div','la-history-note','Touchdown time · aircraft',right);
        this.list = node('div','la-history-list',null,right);
        this.list.setAttribute('aria-label','Landing history');

        // Drag scrolling is scoped to this app. A drag must never select a record.
        var drag = null, suppress = 0;
        page.addEventListener('mousedown',function (e) {
            if (e.button !== 0) return;
            var target = e.target;
            while (target && target !== page) {
                if (target.scrollHeight > target.clientHeight+1 && /auto|scroll/.test(getComputedStyle(target).overflowY)) break;
                target = target.parentNode;
            }
            if (!target || target === page) return;
            drag = {node:target,y:e.clientY,top:target.scrollTop,moved:false};
        });
        document.addEventListener('mousemove',function (e) {
            if (!drag) return;
            if (!drag.moved && Math.abs(e.clientY-drag.y)<6) return;
            drag.moved = true; suppress = Date.now()+500;
            drag.node.scrollTop = drag.top-(e.clientY-drag.y); e.preventDefault();
        },true);
        function end() { if (drag && drag.moved) suppress = Date.now()+500; drag=null; }
        document.addEventListener('mouseup',end,true); root.addEventListener('blur',end);
        page.addEventListener('dragstart',function(e) { e.preventDefault(); });
        this.list.addEventListener('click',function(e) {
            if (Date.now()<suppress) { e.preventDefault(); e.stopImmediatePropagation(); }
        },true);
        this.render();
        this.timer = setInterval(function () { if (page.style.display !== 'none') self.render(); },250);
        root.addEventListener('beforeunload',function () { clearInterval(self.timer); });
    }
    View.prototype.render = function () {
        var self = this, state = this.service.state(), c = state.current;

        this.currentBadge.textContent = c ? (c.complete ? 'RECORDED' : 'BOUNCE WATCH') : 'ARMED / WAITING';
        this.currentMeta.textContent = c ? dateText(c) + '  ·  ' + c.aircraft : 'No touchdown recorded this flight';
        this.renderCurrent(c);
        var selected = state.history.find(function (r) { return r.id === self.selected; });
        this.selectedMeta.textContent = selected ? dateText(selected) + '  ·  ' + selected.aircraft : 'Select a landing from the history';
        this.renderSelected(selected);
        this.count.textContent = state.history.length;
        var signature = state.history.map(function (r) { return r.id; }).join('|');
        if (signature !== this.signature || !this.list.firstChild) {
            this.signature = signature;
            var top = this.list.scrollTop; this.list.textContent = '';
            if (!state.history.length) node('div','la-empty','Your landings will appear here after touchdown.',this.list);
            state.history.forEach(function (r) {
                var button = node('button','la-history-item',null,self.list);
                button.type='button'; button.setAttribute('data-record',r.id);
                node('span','la-history-time',dateText(r),button);
                node('span','la-history-aircraft',r.aircraft,button);
                button.addEventListener('click',function () { self.selected=r.id; self.render(); });
            });
            this.list.scrollTop = top;
        }
        Array.prototype.forEach.call(this.list.querySelectorAll('button'),function (b) {
            var selected = b.getAttribute('data-record') === self.selected;
            b.classList.toggle('la-selected',selected); b.setAttribute('aria-pressed',String(selected));
        });
    };
    root.PMDGLandingAnalysis = {
        View: View,
        install: function (bus, side, base) {
            if (this.service) return;
            var service = new root.LandingAnalysisService(side); this.service = service;
            var page = node('div','efb_page',null,document.getElementById('AppContent'));
            page.id = 'landing_analysis'; page.style.display='none';
            var view = new View(page,service);
            var button = node('button','',null,document.getElementById('remote-app-launchers'));
            button.type='button'; button.setAttribute('aria-label','Landing Analysis');
            var icon = node('img','',null,button); icon.src=base+'/landing-analysis/icon.svg'; icon.alt='';
            var label = node('span','','Landing Analysis',button);
            label.style.fontSize = '20px';
            button.addEventListener('click',function () { bus.getPublisher().pub('current_app','landing_analysis'); });
            bus.getSubscriber().on('current_app').whenChanged().handle(function (app) {
                page.style.display=app==='landing_analysis'?'flex':'none'; if (app==='landing_analysis') view.render();
            });
        }
    };
})(window);
