const assert = require('assert');
const decision = require('../lib/decision');

console.log("TEST: Starting decision logic tests...");

const baseConfig = {
    enabled: true,
    defaultRule: "sun",
    sunsetOffset: 0,
    sunriseOffset: 0,
    overrides: {
        "HDMI_1": "on",
        "HDMI_2": "off",
        "HDMI_3": "sun"
    },
    location: {
        lat: 59.437,
        lon: 24.7536,
        timezone: "Europe/Tallinn"
    }
};

// 1. enabled=false => action none
assert.strictEqual(decision.evaluate({ config: { ...baseConfig, enabled: false }, now: Date.now() }).action, "none");
assert.strictEqual(decision.evaluate({ config: { ...baseConfig, enabled: false }, now: Date.now() }).reason, "AUTOMATION_DISABLED");

// 2. defaultRule=on => state true
let res = decision.evaluate({ config: { ...baseConfig, defaultRule: "on" }, now: Date.now() });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, true);
assert.strictEqual(res.reason, "RULE_FORCE_ON");

// 3. defaultRule=off => state false
res = decision.evaluate({ config: { ...baseConfig, defaultRule: "off" }, now: Date.now() });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, false);
assert.strictEqual(res.reason, "RULE_FORCE_OFF");

// Winter date (Dec 21, 2026). Tallinn UTC noon. Sunrise is around 07:15 UTC, sunset around 13:20 UTC.
const winterDateNoon = new Date(Date.UTC(2026, 11, 21, 12, 0, 0)); // 14:00 Tallinn time. It's DAY.
const winterDateNight = new Date(Date.UTC(2026, 11, 21, 18, 0, 0)); // 20:00 Tallinn time. It's NIGHT.
const winterDateMorning = new Date(Date.UTC(2026, 11, 21, 4, 0, 0)); // 06:00 Tallinn time. It's NIGHT.

// 4. defaultRule=sun daytime => false
res = decision.evaluate({ config: baseConfig, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, false);
assert.strictEqual(res.reason, "SUN_DAY");

// 5. defaultRule=sun nighttime => true
res = decision.evaluate({ config: baseConfig, now: winterDateNight });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, true);
assert.strictEqual(res.reason, "SUN_NIGHT");

res = decision.evaluate({ config: baseConfig, now: winterDateMorning });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, true);
assert.strictEqual(res.reason, "SUN_NIGHT");

// 6. matching override on
res = decision.evaluate({ config: baseConfig, source: { id: "HDMI_1", name: "Apple TV" }, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, true);
assert.strictEqual(res.reason, "RULE_FORCE_ON");

// 7. matching override off
res = decision.evaluate({ config: baseConfig, source: { id: "HDMI_2" }, now: winterDateNight });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, false);
assert.strictEqual(res.reason, "RULE_FORCE_OFF");

// 8. matching override sun
res = decision.evaluate({ config: { ...baseConfig, defaultRule: "on" }, source: { id: "HDMI_3" }, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, false);
assert.strictEqual(res.reason, "SUN_DAY");

// 9. unknown source uses defaultRule
res = decision.evaluate({ config: { ...baseConfig, defaultRule: "off" }, source: { id: "UNKNOWN_HDMI" }, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, false);
assert.strictEqual(res.reason, "RULE_FORCE_OFF");

// 10. null source uses defaultRule
res = decision.evaluate({ config: { ...baseConfig, defaultRule: "off" }, source: null, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, false);
assert.strictEqual(res.reason, "RULE_FORCE_OFF");

// 11. missing location + sun => no action
res = decision.evaluate({ config: { ...baseConfig, location: null }, now: winterDateNoon });
assert.strictEqual(res.action, "none");
assert.strictEqual(res.reason, "INVALID_LOCATION");

res = decision.evaluate({ config: { ...baseConfig, location: { lat: "not-a-number" } }, now: winterDateNoon });
assert.strictEqual(res.action, "none");
assert.strictEqual(res.reason, "INVALID_LOCATION");

// 12. on/off rules do not require location
res = decision.evaluate({ config: { ...baseConfig, location: null, defaultRule: "on" }, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, true);

// 13. source friendly name does not affect override lookup
res = decision.evaluate({ config: baseConfig, source: { id: "HDMI_1", name: "COMPLETELY DIFFERENT NAME" }, now: winterDateNoon });
assert.strictEqual(res.reason, "RULE_FORCE_ON");

// 14. offsets affect decision
// Winter noon is ~14:00 Tallinn time. Sunrise is ~09:15 Tallinn time (07:15 UTC).
// If we add 500 minutes (8 hours) to sunrise offset, sunrise becomes 17:15 Tallinn time.
// So at 14:00, it should still be SUN_NIGHT because effective sunrise hasn't happened.
res = decision.evaluate({ config: { ...baseConfig, sunriseOffset: 500 }, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, true);
assert.strictEqual(res.reason, "SUN_NIGHT");

// 15. decision module produces no HyperHDR side effects
// (this is true by design as it only returns an object)

// Edge cases: Svalbard polar night
res = decision.evaluate({ config: { ...baseConfig, location: { lat: 78.2232, lon: 15.6267, timezone: "Arctic/Longyearbyen" } }, now: winterDateNoon });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, true);
assert.strictEqual(res.reason, "SUN_NIGHT");

// Svalbard midnight sun (summer)
const summerDate = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
res = decision.evaluate({ config: { ...baseConfig, location: { lat: 78.2232, lon: 15.6267, timezone: "Arctic/Longyearbyen" } }, now: summerDate });
assert.strictEqual(res.action, "set");
assert.strictEqual(res.state, false);
assert.strictEqual(res.reason, "SUN_DAY");

// Defensive lat/lon validation tests
res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, lat: NaN } }, now: winterDateNoon });
assert.strictEqual(res.reason, "INVALID_LOCATION");

res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, lon: NaN } }, now: winterDateNoon });
assert.strictEqual(res.reason, "INVALID_LOCATION");

res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, lat: Infinity } }, now: winterDateNoon });
assert.strictEqual(res.reason, "INVALID_LOCATION");

res = decision.evaluate({ config: { ...baseConfig, location: { ...baseConfig.location, lon: -Infinity } }, now: winterDateNoon });
assert.strictEqual(res.reason, "INVALID_LOCATION");

// Invalid `now` test
res = decision.evaluate({ config: baseConfig, now: "not-a-date" });
assert.strictEqual(res.action, "none");
assert.strictEqual(res.reason, "INVALID_CONFIG");

console.log("TEST: All decision logic tests PASSED.");
