const assert = require('assert');
const decision = require('../lib/decision');

console.log("TEST: Starting extra decision logic tests...");

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

// Test 1: Invalid timezone returns INVALID_LOCATION instead of falling back
let res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, timezone: "Invalid/Timezone" } }, now: Date.now() });
assert.strictEqual(res.action, "none");
assert.strictEqual(res.reason, "INVALID_LOCATION");

// Test 2: Invalid lat/lon returns INVALID_LOCATION
res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, lat: 91 } }, now: Date.now() });
assert.strictEqual(res.reason, "INVALID_LOCATION");
res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, lon: -181 } }, now: Date.now() });
assert.strictEqual(res.reason, "INVALID_LOCATION");

// Test 3: Empty timezone returns INVALID_LOCATION
res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, timezone: "   " } }, now: Date.now() });
assert.strictEqual(res.reason, "INVALID_LOCATION");

// Test 4: Missing timezone returns INVALID_LOCATION
res = decision.evaluate({ config: { ...baseConfig, location: { lat: 59.437, lon: 24.7536 } }, now: Date.now() });
assert.strictEqual(res.reason, "INVALID_LOCATION");

// DST Transition tests
// Tallinn changes to Summer time on the last Sunday of March (e.g. March 29, 2026).
// On March 28 (Winter time), UTC offset is +02:00.
// On March 30 (Summer time), UTC offset is +03:00.

const beforeDstDate = new Date(Date.UTC(2026, 2, 28, 12, 0, 0)); // March 28
const afterDstDate = new Date(Date.UTC(2026, 2, 30, 12, 0, 0)); // March 30

res = decision.evaluate({ config: baseConfig, now: beforeDstDate });
assert.strictEqual(res.action, "set", "Before DST: Should return valid action");
let localSunriseBefore = new Intl.DateTimeFormat('en-US', { timeZone: "Europe/Tallinn", year: 'numeric', month: 'numeric', day: 'numeric', hour12: false }).format(new Date(res.solar.sunrise));
assert.strictEqual(localSunriseBefore, "3/28/2026", "Before DST: Local formatted date must match requested date");

res = decision.evaluate({ config: baseConfig, now: afterDstDate });
assert.strictEqual(res.action, "set", "After DST: Should return valid action");
let localSunriseAfter = new Intl.DateTimeFormat('en-US', { timeZone: "Europe/Tallinn", year: 'numeric', month: 'numeric', day: 'numeric', hour12: false }).format(new Date(res.solar.sunrise));
assert.strictEqual(localSunriseAfter, "3/30/2026", "After DST: Local formatted date must match requested date");

console.log("TEST: Extra decision logic tests PASSED.");
