const assert = require('assert');
const sun = require('../lib/sun');

console.log("TEST: Starting sun logic tests...");

// Tallinn: lat 59.437, lon 24.7536
const TALLINN_LAT = 59.437;
const TALLINN_LON = 24.7536;

// Svalbard (Longyearbyen): lat 78.2232, lon 15.6267
const SVALBARD_LAT = 78.2232;
const SVALBARD_LON = 15.6267;

// Helper to format date in given timezone
function formatLocal(date, tz) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour12: false
    });
    return formatter.format(date);
}

// 1. Known Tallinn date in winter: Dec 21, 2026
const winterEvents = sun.calculate({ year: 2026, month: 11, day: 21, lat: TALLINN_LAT, lon: TALLINN_LON });
assert.strictEqual(winterEvents.sunrise.status, 'ok');
assert.strictEqual(winterEvents.sunset.status, 'ok');
assert.ok(winterEvents.sunrise.date.getTime() < winterEvents.sunset.date.getTime(), "Sunrise should be before sunset");
// Sunrise should be late, sunset should be early
assert.ok(winterEvents.sunrise.date.getUTCHours() > 6);
assert.ok(winterEvents.sunset.date.getUTCHours() < 15);
assert.strictEqual(formatLocal(winterEvents.sunrise.date, "Europe/Tallinn"), "12/21/2026");

// 2. Known Tallinn date in summer: Jun 21, 2026
const summerEvents = sun.calculate({ year: 2026, month: 5, day: 21, lat: TALLINN_LAT, lon: TALLINN_LON });
assert.strictEqual(summerEvents.sunrise.status, 'ok');
assert.strictEqual(summerEvents.sunset.status, 'ok');
assert.ok(summerEvents.sunrise.date.getTime() < summerEvents.sunset.date.getTime(), "Sunrise should be before sunset");
assert.ok(summerEvents.sunrise.date.getUTCHours() < 3); // 01:xx UTC
assert.ok(summerEvents.sunset.date.getUTCHours() >= 19); // 19:xx UTC
assert.strictEqual(formatLocal(summerEvents.sunrise.date, "Europe/Tallinn"), "6/21/2026");

// Global Date Wrap Tests
const globalLocations = [
    { name: 'Auckland', tz: 'Pacific/Auckland', lat: -36.8485, lon: 174.7633, expUtcDaySunrise: 20, expUtcDaySunset: 21 },
    { name: 'Sydney', tz: 'Australia/Sydney', lat: -33.8688, lon: 151.2093, expUtcDaySunrise: 20, expUtcDaySunset: 21 },
    { name: 'Tokyo', tz: 'Asia/Tokyo', lat: 35.6762, lon: 139.6503, expUtcDaySunrise: 20, expUtcDaySunset: 21 },
    { name: 'Honolulu', tz: 'Pacific/Honolulu', lat: 21.3069, lon: -157.8583, expUtcDaySunrise: 21, expUtcDaySunset: 22 },
    { name: 'Los Angeles', tz: 'America/Los_Angeles', lat: 34.0522, lon: -118.2437, expUtcDaySunrise: 21, expUtcDaySunset: 22 }
];

for (const loc of globalLocations) {
    const res = sun.calculate({ year: 2026, month: 11, day: 21, lat: loc.lat, lon: loc.lon });
    assert.strictEqual(res.sunrise.status, 'ok', `${loc.name} sunrise status`);
    assert.strictEqual(res.sunset.status, 'ok', `${loc.name} sunset status`);
    
    // Order check
    assert.ok(res.sunrise.date.getTime() < res.sunset.date.getTime(), `${loc.name}: Sunrise must precede sunset`);
    
    // Local date check
    assert.strictEqual(formatLocal(res.sunrise.date, loc.tz), "12/21/2026", `${loc.name}: Sunrise local date match`);
    assert.strictEqual(formatLocal(res.sunset.date, loc.tz), "12/21/2026", `${loc.name}: Sunset local date match`);
    
    // UTC day check (proves the unwrapped hour shifts the absolute timestamp correctly)
    assert.strictEqual(res.sunrise.date.getUTCDate(), loc.expUtcDaySunrise, `${loc.name}: UTC Sunrise day should be ${loc.expUtcDaySunrise}`);
    assert.strictEqual(res.sunset.date.getUTCDate(), loc.expUtcDaySunset, `${loc.name}: UTC Sunset day should be ${loc.expUtcDaySunset}`);
}

// Polar behavior: Svalbard in summer (midnight sun)
const svalbardSummer = sun.calculate({ year: 2026, month: 5, day: 21, lat: SVALBARD_LAT, lon: SVALBARD_LON });
assert.strictEqual(svalbardSummer.sunrise.status, 'midnight-sun');
assert.strictEqual(svalbardSummer.sunset.status, 'midnight-sun');

// Polar behavior: Svalbard in winter (polar night)
const svalbardWinter = sun.calculate({ year: 2026, month: 11, day: 21, lat: SVALBARD_LAT, lon: SVALBARD_LON });
assert.strictEqual(svalbardWinter.sunrise.status, 'polar-night');
assert.strictEqual(svalbardWinter.sunset.status, 'polar-night');

console.log("TEST: All sun logic tests PASSED.");
