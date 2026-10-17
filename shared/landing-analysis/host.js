/* Host service: eager sampling, independent of the visible EFB app. */
(function (root) {
    'use strict';
    var Core = root.LandingAnalysisCore;
    var KEY = 'PMDG_LANDING_ANALYSIS_V1';
    var HEARTBEAT = 'L:PMDG_LANDING_ANALYSIS_CA_HEARTBEAT';
    function readZuluTimestamp() {
        // Capture simulator UTC at contact; wallTime remains the history identity/order.
        try {
            var year=SimVar.GetSimVarValue('E:ZULU YEAR','number');
            var month=SimVar.GetSimVarValue('E:ZULU MONTH OF YEAR','number');
            var day=SimVar.GetSimVarValue('E:ZULU DAY OF MONTH','number');
            var seconds=SimVar.GetSimVarValue('E:ZULU TIME','seconds');
            if (!Number.isInteger(year) || year<100 || year>9999 || !Number.isInteger(month) || month<1 || month>12 ||
                !Number.isInteger(day) || day<1 || day>31 || !Core.finite(seconds) || seconds<0 || seconds>=86400) return null;
            var date=new Date(Date.UTC(year,month-1,day));
            if(date.getUTCMonth()!==month-1 || date.getUTCDate()!==day)return null;
            return date.getTime()+Math.floor(seconds)*1000;
        } catch (_) { return null; }
    }
    function Service(side) {
        var self = this;
        this.side = String(side).toUpperCase(); this.history = []; this.pending = [];
        this.storageReady = false; this.storageError = ''; this.replay = false; this.error = '';
        this.started = Date.now(); this.lastMaintenance = 0;
        this.detector = new Core.Detector(function (record) {
            self.pending = Core.mergeHistory(self.pending, record);
            self.history = Core.mergeHistory(self.history, record);
            self.flush();
        });
        if (typeof RegisterViewListener === 'function') {
            this.storageListener = RegisterViewListener('JS_LISTENER_DATASTORAGE', function () {
                self.storageReady = true; self.refresh(); self.flush();
            });
        }
        // The simulator replay service is optional; the detector can still run without it.
        if (typeof RegisterReplayListener === 'function') {
            this.replayListener = RegisterReplayListener(function () {});
            this.replayListener.onUpdate(function (data) { self.replay = !!data.bIsPlaying; });
        }
        this.timer = setInterval(function () { self.tick(); }, 20);
        root.addEventListener('beforeunload', function () { clearInterval(self.timer); });
    }
    Service.prototype.writer = function () {
        if (this.side === 'CA') return true;
        var heartbeat = SimVar.GetSimVarValue(HEARTBEAT, 'number');
        return Date.now() - this.started > 3000 && Math.abs(Date.now() / 1000 - heartbeat) > 3;
    };
    Service.prototype.refresh = function () {
        if (!this.storageReady) return;
        try {
            var records = Core.decodeHistory(GetStoredData(KEY));
            this.pending = this.pending.filter(function (r) {
                return !records.some(function (v) { return Core.sameLanding(v,r) && v.bounces >= r.bounces && (!r.complete || v.complete); });
            });
            this.pending.forEach(function (r) { records = Core.mergeHistory(records, r); });
            this.history = records; this.storageError = '';
        } catch (e) { this.storageError = 'History unavailable · original data preserved'; }
    };
    Service.prototype.flush = function () {
        if (!this.storageReady || !this.pending.length) return;
        try {
            if (!this.writer()) return;
            // Read/merge before writing; CA is the normal writer, FO takes over if CA stops.
            var records = Core.decodeHistory(GetStoredData(KEY));
            this.pending.forEach(function (r) { records = Core.mergeHistory(records, r); });
            SetStoredData(KEY, JSON.stringify({version: 1, records: records}));
            // Do not claim persistence until the simulator returns the written records.
            var readback = Core.decodeHistory(GetStoredData(KEY));
            var saved = this.pending.every(function (r) {
                return readback.some(function (v) { return Core.sameLanding(v,r) && v.bounces >= r.bounces && (!r.complete || v.complete); });
            });
            if (!saved) throw new Error('Awaiting storage confirmation');
            this.history = records; this.pending = []; this.storageError = '';
        } catch (e) { this.storageError = 'History not saved yet · retrying'; }
    };
    Service.prototype.tick = function () {
        var now = Date.now(), self = this;
        try {
            if (now - this.lastMaintenance >= 1000) {
                this.lastMaintenance = now;
                if (this.side === 'CA') {
                    var result = SimVar.SetSimVarValue(HEARTBEAT, 'number', now / 1000);
                    if (result && result.catch) result.catch(function () {});
                }
                this.refresh(); this.flush();
            }
            function read(name, unit) { return SimVar.GetSimVarValue(name, unit); }
            var s = {
                time: read('E:SIMULATION TIME','seconds'), wallTime: now,
                title: read('TITLE','string'), onGround: !!read('SIM ON GROUND','bool'),
                agl: read('PLANE ALT ABOVE GROUND','feet'), bodyZ: read('VELOCITY BODY Z','feet per second'),
                slew: !!read('IS SLEW ACTIVE','bool'), replay: this.replay,
                inactive: read('CAMERA STATE','number') >= 9
            };
            // On the ground, away from impact detection, only the inexpensive state reads are needed.
            if (!s.onGround || this.detector.air.length) {
                if (s.onGround) s.zuluTimestamp = readZuluTimestamp();
                s.airspeed = read('AIRSPEED INDICATED','knots');
                s.groundSpeed = read('GROUND VELOCITY','knots');
                s.bodyX = read('VELOCITY BODY X','feet per second');
                s.windX = read('AIRCRAFT WIND X','knots'); s.windZ = read('AIRCRAFT WIND Z','knots');
                s.windDirection = read('AMBIENT WIND DIRECTION','degrees');
                s.verticalSpeed = read('VERTICAL SPEED','feet per second');
                s.g = read('G FORCE','gforce');
                s.touchdownVelocity = read('PLANE TOUCHDOWN NORMAL VELOCITY','feet per second');
                s.touchdownPitch = read('PLANE TOUCHDOWN PITCH DEGREES','degrees');
                s.surface = read('SURFACE TYPE','enum');
            }
            this.detector.step(s); this.error = '';
        } catch (e) { self.error = 'Waiting for simulator connection'; }
    };
    Service.prototype.state = function () {
        return {current: this.detector.current, history: this.history,
            status: this.error || this.detector.status,
            storage: this.storageError || (!this.storageReady ? 'Connecting to history storage' : 'Last 100 landings · saved in simulator')};
    };
    root.LandingAnalysisService = Service;
})(window);
