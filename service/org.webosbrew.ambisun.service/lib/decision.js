const sun = require('./sun');

function evaluate(input) {
    const config = input.config;
    const source = input.source;
    const now = input.now instanceof Date ? input.now : new Date(input.now);

    if (isNaN(now.getTime())) {
        return { action: "none", reason: "INVALID_CONFIG" };
    }

    if (!config || typeof config.enabled === 'undefined') {
        return { action: "none", reason: "INVALID_CONFIG" };
    }

    if (!config.enabled) {
        return {
            action: "none",
            reason: "AUTOMATION_DISABLED"
        };
    }

    let activeRule = config.defaultRule;
    let sourceId = null;

    if (source && source.id) {
        sourceId = source.id;
        if (config.overrides && config.overrides[source.id]) {
            activeRule = config.overrides[source.id];
        }
    }

    if (activeRule === "on") {
        return {
            action: "set",
            state: true,
            rule: "on",
            reason: "RULE_FORCE_ON",
            sourceId: sourceId
        };
    } else if (activeRule === "off") {
        return {
            action: "set",
            state: false,
            rule: "off",
            reason: "RULE_FORCE_OFF",
            sourceId: sourceId
        };
    } else if (activeRule === "sun") {
        if (!config.location ||
            typeof config.location.lat !== 'number' ||
            !isFinite(config.location.lat) ||
            typeof config.location.lon !== 'number' ||
            !isFinite(config.location.lon) ||
            config.location.lat < -90 || config.location.lat > 90 ||
            config.location.lon < -180 || config.location.lon > 180 ||
            typeof config.location.timezone !== 'string' ||
            config.location.timezone.trim() === '') {
            return {
                action: "none",
                rule: "sun",
                reason: "INVALID_LOCATION",
                sourceId: sourceId
            };
        }

        const tz = config.location.timezone.trim();
        let year, month, day;

        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour12: false
            });
            const parts = formatter.formatToParts(now);
            const p = {};
            for (let part of parts) {
                p[part.type] = part.value;
            }
            year = parseInt(p.year, 10);
            month = parseInt(p.month, 10) - 1;
            day = parseInt(p.day, 10);
        } catch (e) {
            // Invalid IANA timezone should not fallback, it should fail
            return {
                action: "none",
                rule: "sun",
                reason: "INVALID_LOCATION",
                sourceId: sourceId
            };
        }

        const solarEvents = sun.calculate({ year, month, day, lat: config.location.lat, lon: config.location.lon });

        let decisionState;
        let reason;
        let effSunriseIso = null;
        let effSunsetIso = null;

        if (solarEvents.sunrise.status === "ok" && solarEvents.sunset.status === "ok") {
            const sunriseOffset = config.sunriseOffset || 0;
            const sunsetOffset = config.sunsetOffset || 0;

            const effectiveSunrise = new Date(solarEvents.sunrise.date.getTime() + sunriseOffset * 60000);
            const effectiveSunset = new Date(solarEvents.sunset.date.getTime() + sunsetOffset * 60000);
            
            effSunriseIso = effectiveSunrise.toISOString();
            effSunsetIso = effectiveSunset.toISOString();

            if (now.getTime() < effectiveSunrise.getTime()) {
                decisionState = true;
                reason = "SUN_NIGHT";
            } else if (now.getTime() >= effectiveSunrise.getTime() && now.getTime() < effectiveSunset.getTime()) {
                decisionState = false;
                reason = "SUN_DAY";
            } else {
                decisionState = true;
                reason = "SUN_NIGHT";
            }
        } else if (solarEvents.sunrise.status === "polar-night" || solarEvents.sunset.status === "polar-night") {
            decisionState = true;
            reason = "SUN_NIGHT";
        } else if (solarEvents.sunrise.status === "midnight-sun" || solarEvents.sunset.status === "midnight-sun") {
            decisionState = false;
            reason = "SUN_DAY";
        } else {
            return {
                action: "none",
                rule: "sun",
                reason: "SUN_UNAVAILABLE",
                sourceId: sourceId
            };
        }

        return {
            action: "set",
            state: decisionState,
            rule: "sun",
            reason: reason,
            sourceId: sourceId,
            solar: {
                sunrise: solarEvents.sunrise.date ? solarEvents.sunrise.date.toISOString() : null,
                sunset: solarEvents.sunset.date ? solarEvents.sunset.date.toISOString() : null,
                effectiveSunrise: effSunriseIso,
                effectiveSunset: effSunsetIso
            }
        };

    }

    return {
        action: "none",
        reason: "UNKNOWN_RULE",
        sourceId: sourceId
    };
}

module.exports = {
    evaluate: evaluate
};
