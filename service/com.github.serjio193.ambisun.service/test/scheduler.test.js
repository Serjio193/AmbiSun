const assert = require('assert');
const scheduler = require('../lib/scheduler');

console.log("TEST: Starting scheduler logic tests...");

const baseConfig = {
    enabled: true,
    defaultRule: "sun",
    sunsetOffset: 0,
    sunriseOffset: 0,
    location: {
        lat: 59.437,
        lon: 24.7536,
        timezone: "Europe/Tallinn"
    }
};

const TALLINN_LAT = 59.437;
const TALLINN_LON = 24.7536;
const SVALBARD_LAT = 78.2232;
const SVALBARD_LON = 15.6267;

// Winter Date: Dec 21, 2026. Sunrise ~07:17 UTC, Sunset ~13:20 UTC.
const winterMorning = new Date(Date.UTC(2026, 11, 21, 4, 0, 0)); // Before sunrise
const winterDay = new Date(Date.UTC(2026, 11, 21, 10, 0, 0)); // Daytime
const winterNight = new Date(Date.UTC(2026, 11, 21, 18, 0, 0)); // After sunset

// 1. before sunrise -> next sunrise
let ev = scheduler.getNextSolarEvent(baseConfig, winterMorning);
assert.strictEqual(ev.type, "sunrise");
assert.strictEqual(ev.date.getUTCDate(), 21);

// 2. daytime -> next sunset
ev = scheduler.getNextSolarEvent(baseConfig, winterDay);
assert.strictEqual(ev.type, "sunset");
assert.strictEqual(ev.date.getUTCDate(), 21);

// 3. after sunset -> next sunrise tomorrow
ev = scheduler.getNextSolarEvent(baseConfig, winterNight);
assert.strictEqual(ev.type, "sunrise");
assert.strictEqual(ev.date.getUTCDate(), 22);

// 4. sunsetOffset applied
// sunset is around 13:20 UTC. Add +120 minutes = 15:20 UTC.
ev = scheduler.getNextSolarEvent({ ...baseConfig, sunsetOffset: 120 }, winterDay);
assert.strictEqual(ev.type, "sunset");
assert.ok(ev.date.getUTCHours() >= 15);

// 5. sunriseOffset applied
// sunrise is around 07:17 UTC. Add -60 minutes = 06:17 UTC.
ev = scheduler.getNextSolarEvent({ ...baseConfig, sunriseOffset: -60 }, winterMorning);
assert.strictEqual(ev.type, "sunrise");
assert.ok(ev.date.getUTCHours() === 6);

// 6. DST boundary
const beforeDstDate = new Date(Date.UTC(2026, 2, 28, 12, 0, 0));
ev = scheduler.getNextSolarEvent(baseConfig, beforeDstDate);
assert.ok(ev !== null);

// 7. Auckland/UTC-day-wrap case
const aucklandConfig = { ...baseConfig, location: { lat: -36.8485, lon: 174.7633, timezone: "Pacific/Auckland" } };
ev = scheduler.getNextSolarEvent(aucklandConfig, new Date(Date.UTC(2026, 11, 21, 0, 0, 0)));
assert.ok(ev !== null);

// 8. enabled=false -> cancel/no activity
assert.strictEqual(scheduler.getNextSolarEvent({ ...baseConfig, enabled: false }, winterMorning), null);

// 9. defaultRule=on -> cancel/no activity
assert.strictEqual(scheduler.getNextSolarEvent({ ...baseConfig, defaultRule: "on" }, winterMorning), null);

// 10. defaultRule=off -> cancel/no activity
assert.strictEqual(scheduler.getNextSolarEvent({ ...baseConfig, defaultRule: "off" }, winterMorning), null);

// 11. missing location -> no activity
assert.strictEqual(scheduler.getNextSolarEvent({ ...baseConfig, location: null }, winterMorning), null);

// 12. polar day/night safe behavior
const polarConfig = { ...baseConfig, location: { lat: SVALBARD_LAT, lon: SVALBARD_LON, timezone: "Arctic/Longyearbyen" } };
assert.strictEqual(scheduler.getNextSolarEvent(polarConfig, winterDay), null); // polar night
const summerDay = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
assert.strictEqual(scheduler.getNextSolarEvent(polarConfig, summerDay), null); // midnight sun

// Mock Activity Manager
let creates = 0;
let cancels = 0;
let lastSpec = null;
let forceError = false;

const mockAm = {
    call: function(uri, payload, cb) {
        if (uri === "luna://com.webos.service.activitymanager/create") {
            if (forceError) return cb(new Error("CREATE_FAILED"), { returnValue: false });
            creates++;
            lastSpec = payload;
            cb(null, { returnValue: true, activityId: 12345 });
        } else if (uri === "luna://com.webos.service.activitymanager/cancel") {
            if (forceError) {
                if (payload.activityName === scheduler.PROBE_ACTIVITY_NAME) {
                    return cb(new Error("not found"), { returnValue: false, errorText: "not found" });
                }
                return cb(new Error("CANCEL_FAILED"), { returnValue: false });
            }
            cancels++;
            cb(null, { returnValue: true });
        } else if (uri === "luna://com.webos.service.activitymanager/getActivityInfo") {
            if (forceError) return cb(new Error("INFO_FAILED"), { returnValue: false });
            cb(null, { returnValue: true, activity: { name: payload.activityName, activityId: 12345 } });
        }
    }
};

scheduler.injectAmProxy(mockAm);

// 13. create success
scheduler.reconcile(baseConfig, winterMorning, (err) => {
    assert.ifError(err);
    assert.strictEqual(creates, 1);
    assert.strictEqual(lastSpec.activity.name, scheduler.ACTIVITY_NAME);
    
    // Check type and schedule format
    assert.strictEqual(lastSpec.activity.type.foreground, true);
    assert.strictEqual(lastSpec.activity.type.persist, true);
    assert.strictEqual(lastSpec.start, true);
    assert.strictEqual(lastSpec.subscribe, false);
    assert.strictEqual(lastSpec.replace, true);
    
    const st = scheduler.getStatus();
    assert.strictEqual(st.active, true);
    assert.strictEqual(st.activityId, 12345);
    assert.ok(st.nextEventAt.endsWith('Z'));
    assert.ok(st.nextEventAt.indexOf('T') === -1);
});

// 15. create failure
forceError = true;
scheduler.reconcile(baseConfig, winterMorning, (err) => {
    assert.ok(err);
    assert.strictEqual(err.message, "CREATE_FAILED");
    const st = scheduler.getStatus();
    assert.strictEqual(st.active, false);
    assert.strictEqual(st.lastError.message, "CREATE_FAILED");
});

// 16. cancel success
forceError = false;
scheduler.reconcile({ ...baseConfig, enabled: false }, winterMorning, (err) => {
    assert.ifError(err);
    assert.strictEqual(cancels, 1);
    const st = scheduler.getStatus();
    assert.strictEqual(st.active, false);
    assert.strictEqual(st.activityId, null);
});

// 17. cancel failure
forceError = true;
scheduler.reconcile({ ...baseConfig, enabled: false }, winterMorning, (err) => {
    assert.ok(err);
    assert.strictEqual(err.message, "CANCEL_FAILED");
});

// Mock modules for executeWake testing
let setLedCalledWith = null;
let setLedError = null;
const mockDecisionDay = {
    evaluate: () => ({ action: "set", state: false, rule: "sun", reason: "SUN_DAY" })
};
const mockDecisionNight = {
    evaluate: () => ({ action: "set", state: true, rule: "sun", reason: "SUN_NIGHT" })
};
const mockDecisionNone = {
    evaluate: () => ({ action: "none", reason: "AUTOMATION_DISABLED" })
};
const mockHyperhdr = {
    setLedDevice: (state, cb) => { 
        setLedCalledWith = state; 
        if (setLedError) return cb(setLedError);
        cb(null); 
    }
};

// 18. solarWake SUN_DAY -> setLedDevice(false)
forceError = false;
creates = 0;
setLedCalledWith = null;
scheduler.executeWake(baseConfig, mockDecisionDay, mockHyperhdr, winterDay, (err, res) => {
    assert.strictEqual(setLedCalledWith, false);
    assert.strictEqual(creates, 1);
});

// 19. solarWake SUN_NIGHT -> setLedDevice(true)
creates = 0;
setLedCalledWith = null;
scheduler.executeWake(baseConfig, mockDecisionNight, mockHyperhdr, winterNight, (err, res) => {
    assert.strictEqual(setLedCalledWith, true);
    assert.strictEqual(creates, 1);
});

// 20. solarWake action=none -> no HyperHDR call
creates = 0;
setLedCalledWith = "uncalled";
scheduler.executeWake(baseConfig, mockDecisionNone, mockHyperhdr, winterDay, (err, res) => {
    assert.strictEqual(setLedCalledWith, "uncalled");
});

// Test HyperHDR failure
creates = 0;
setLedError = new Error("HYPERHDR_ERROR");
scheduler.executeWake(baseConfig, mockDecisionDay, mockHyperhdr, winterDay, (err, res) => {
    assert.strictEqual(res.action, "error");
    assert.strictEqual(res.errorCode, "HYPERHDR_ERROR");
    assert.strictEqual(res.rescheduled, true);
    assert.strictEqual(creates, 1); // Still attempted to reschedule
});

// Test Reschedule failure
setLedError = null;
forceError = true;
scheduler.executeWake(baseConfig, mockDecisionDay, mockHyperhdr, winterDay, (err, res) => {
    assert.strictEqual(res.action, "error");
    assert.strictEqual(res.errorCode, "ACTIVITY_CREATE_FAILED");
    assert.strictEqual(res.rescheduled, false);
});


// Test getActivityInfo
forceError = false;
scheduler.getActivityInfo("com.github.serjio193.ambisun.solar", (err, act) => {
    assert.ifError(err);
    assert.strictEqual(act.activityId, 12345);
});

console.log("TEST: All scheduler logic tests PASSED.");
