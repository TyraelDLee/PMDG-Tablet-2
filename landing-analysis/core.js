/* Landing Analysis — independent detector. No Gees runtime or proprietary code required.
 * Metric definitions follow the Gees 1.0.1 panel: 20 ms sampling, five samples,
 * touchdown normal velocity, last airborne speed/wind/slip, 10 s bounce window.
 */
(function (root) {
    'use strict';
    var N = 5, BOUNCE_SECONDS = 10, HISTORY_LIMIT = 100;
    function finite(n) { return typeof n === 'number' && isFinite(n); }
    function number(n) { return finite(n) ? n : null; }
    function copy(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
    function Detector(onRecord) {
        this.onRecord = onRecord || function () {};
        this.reset();
    }
    Detector.prototype.reset = function () {
        this.air = []; this.ground = []; this.airStart = null; this.maxAgl = 0;
        this.armed = false; this.current = null; this.active = false;
        this.lastContact = null; this.previous = null; this.status = 'Waiting for flight';
    };
    Detector.prototype.emit = function () { this.onRecord(copy(this.current)); };
    Detector.prototype.finish = function () {
        if (this.active && this.current) {
            this.active = false; this.current.complete = true; this.emit();
        }
    };
    Detector.prototype.impact = function () {
        var a = this.air[this.air.length - 1], g = this.ground[0];
        if (!a || !g) return;
        if (this.active) {
            this.current.bounces++;
        } else {
            // Water surfaces do not provide a useful touchdown-normal velocity.
            var fpm = g.surface === 2 ? a.verticalSpeed * 60 : -g.touchdownVelocity * 60;
            var peak = null;
            this.ground.forEach(function (s) {
                if (finite(s.g)) peak = peak === null ? s.g : Math.max(peak, s.g);
            });
            this.current = {
                id: 'la-' + g.wallTime + '-' + Math.round(g.time * 100),
                timestamp: g.wallTime, simTime: g.time, aircraft: a.title, zuluTimestamp: number(g.zuluTimestamp),
                rate: number(fpm), g: peak, airspeed: number(a.airspeed),
                groundSpeed: number(a.groundSpeed), windX: number(a.windX), windZ: number(a.windZ),
                windSpeed: finite(a.windX) && finite(a.windZ) ? Math.sqrt(a.windX * a.windX + a.windZ * a.windZ) : null,
                windDirection: number(a.windDirection),
                slip: finite(a.bodyX) && a.bodyZ > 0 ? Math.atan(a.bodyX / a.bodyZ) * 180 / Math.PI : null,
                pitch: finite(g.touchdownPitch) ? -g.touchdownPitch : null,
                rawPitch: number(g.touchdownPitch), bounces: 0, complete: false,
                rateSource: g.surface === 2 ? 'vertical-speed-water' : 'touchdown-normal',
                sampleSpan: this.ground[this.ground.length - 1].time - g.time
            };
            this.active = true;
        }
        this.lastContact = g.time;
        this.armed = false; this.air = []; this.ground = [];
        this.airStart = null; this.maxAgl = 0;
        this.status = 'Touchdown recorded · monitoring bounces';
        this.emit();
    };
    Detector.prototype.step = function (s) {
        if (!s || !finite(s.time) || !s.title || !finite(s.agl) || !finite(s.bodyZ)) {
            this.status = 'Waiting for simulator data'; return;
        }
        if (s.slew || s.replay || s.inactive) {
            this.finish(); this.reset(); this.status = s.replay ? 'Replay · recording suspended' : 'Recording suspended'; return;
        }
        if (s.paused) return;
        if (this.previous) {
            var delta = s.time - this.previous.time;
            if (s.title !== this.previous.title || delta < 0 || delta > 2) {
                this.finish(); this.reset();
            } else if (delta === 0) return; // Paused / duplicate simulator frame.
        }
        this.previous = s;
        if (this.active && s.time - this.lastContact >= BOUNCE_SECONDS) this.finish();
        if (!s.onGround) {
            this.ground = [];
            if (this.airStart === null) this.airStart = s.time;
            this.maxAgl = Math.max(this.maxAgl, s.agl);
            this.air.push(s); if (this.air.length > N) this.air.shift();
            var airborneTime = s.time - this.airStart;
            // Distinguish a sustained departure / go-around from a runway bounce.
            if (this.active && airborneTime >= 3 && s.agl > 50) this.finish();
            if (!this.active && airborneTime >= 1 && this.maxAgl >= 30 && s.bodyZ >= 4) {
                this.armed = true; this.current = null;
            }
            this.status = this.active ? 'Touchdown recorded · monitoring bounces' :
                (this.armed ? 'Armed · waiting for touchdown' : 'Waiting for stable flight');
            return;
        }
        if (s.bodyZ >= 4 && this.air.length === N && (this.armed || this.active)) {
            this.ground.push(s);
            if (this.ground.length === N) this.impact();
        } else {
            this.air = []; this.ground = []; this.airStart = null; this.maxAgl = 0;
            if (!this.active) this.armed = false;
            this.status = this.active ? 'Touchdown recorded · monitoring bounces' :
                (this.current ? 'Landing saved' : 'Waiting for flight');
        }
    };
    function validateRecord(r) {
        if (!r || typeof r.id !== 'string' || typeof r.aircraft !== 'string' ||
            !finite(r.timestamp) || !finite(r.simTime) || !Number.isInteger(r.bounces) || r.bounces < 0) return false;
        return ['rate','g','airspeed','groundSpeed','windX','windZ','windSpeed','windDirection','slip','pitch'].every(function (key) {
            return r[key] === null || finite(r[key]);
        });
    }
    function decodeHistory(raw) {
        if (!raw) return [];
        var data = JSON.parse(raw);
        if (!data || data.version !== 1 || !Array.isArray(data.records) || !data.records.every(validateRecord)) {
            throw new Error('Unrecognised landing history; original data preserved');
        }
        return data.records;
    }
    function sameLanding(a, b) {
        return a.id === b.id || (a.aircraft === b.aircraft && Math.abs(a.timestamp - b.timestamp) < 2000 && Math.abs(a.simTime - b.simTime) < 2);
    }
    function mergeHistory(records, record) {
        var result = copy(records), index = result.findIndex(function (r) { return sameLanding(r, record); });
        if (index < 0) result.push(copy(record));
        else {
            var old = result[index], next = copy(record);
            next.id = old.id; next.bounces = Math.max(old.bounces, next.bounces);
            next.complete = old.complete || next.complete; result[index] = next;
        }
        result.sort(function (a,b) { return b.timestamp - a.timestamp; });
        return result.slice(0, HISTORY_LIMIT);
    }
    var api = { Detector: Detector, decodeHistory: decodeHistory, mergeHistory: mergeHistory,
        sameLanding: sameLanding, copy: copy, finite: finite, historyLimit: HISTORY_LIMIT };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LandingAnalysisCore = api;
})(typeof window !== 'undefined' ? window : this);
