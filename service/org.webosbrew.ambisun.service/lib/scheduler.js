const sun = require('./sun');

const ACTIVITY_NAME = "org.webosbrew.ambisun.solar";

// State
let status = {
    configured: false,
    active: false,
    activityName: ACTIVITY_NAME,
    activityId: null,
    nextEventType: null,
    nextEventAt: null,
    lastError: null,
    lastWakeAt: null,
    lastWakeResult: null
};

let activeService = null;
let amProxy = null; // Used for dependency injection in tests

function formatScheduleStart(date) {
    // YYYY-MM-DD HH:MM:SSZ
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
           `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
}

function getNextSolarEvent(config, nowStrOrDate) {
    if (!config.enabled || config.defaultRule !== "sun" || !config.location) {
        return null;
    }
    
    const now = nowStrOrDate instanceof Date ? nowStrOrDate : new Date(nowStrOrDate);
    if (isNaN(now.getTime())) return null;
    
    if (typeof config.location.lat !== 'number' || !isFinite(config.location.lat) ||
        typeof config.location.lon !== 'number' || !isFinite(config.location.lon) ||
        config.location.lat < -90 || config.location.lat > 90 ||
        config.location.lon < -180 || config.location.lon > 180 ||
        typeof config.location.timezone !== 'string' ||
        config.location.timezone.trim() === '') {
        return null;
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
        for (let part of parts) { p[part.type] = part.value; }
        year = parseInt(p.year, 10);
        month = parseInt(p.month, 10) - 1;
        day = parseInt(p.day, 10);
    } catch (e) {
        return null;
    }
    
    const lat = config.location.lat;
    const lon = config.location.lon;
    const sunriseOffset = config.sunriseOffset || 0;
    const sunsetOffset = config.sunsetOffset || 0;

    let ev1 = sun.calculate({ year, month, day, lat, lon });
    if (ev1.sunrise.status !== "ok" || ev1.sunset.status !== "ok") return null;
    
    let effSunrise1 = new Date(ev1.sunrise.date.getTime() + sunriseOffset * 60000);
    let effSunset1 = new Date(ev1.sunset.date.getTime() + sunsetOffset * 60000);
    
    const tomorrowLocal = new Date(Date.UTC(year, month, day, 12, 0, 0) + 86400000);
    let ev2 = sun.calculate({ 
        year: tomorrowLocal.getUTCFullYear(), 
        month: tomorrowLocal.getUTCMonth(), 
        day: tomorrowLocal.getUTCDate(), 
        lat, lon 
    });
    if (ev2.sunrise.status !== "ok" || ev2.sunset.status !== "ok") return null;
    
    let effSunrise2 = new Date(ev2.sunrise.date.getTime() + sunriseOffset * 60000);
    let effSunset2 = new Date(ev2.sunset.date.getTime() + sunsetOffset * 60000);
    
    const events = [
        { type: "sunrise", date: effSunrise1 },
        { type: "sunset", date: effSunset1 },
        { type: "sunrise", date: effSunrise2 },
        { type: "sunset", date: effSunset2 }
    ];
    
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    for (let e of events) {
        if (e.date.getTime() > now.getTime()) {
            return e;
        }
    }
    
    return null;
}

function lunaCall(uri, payload, callback) {
    if (amProxy) {
        // Use test mock if injected
        return amProxy.call(uri, payload, callback);
    }
    if (activeService) {
        activeService.call(uri, payload, function(message) {
            var response = message.payload || {};
            if (response.returnValue) {
                callback(null, response);
            } else {
                callback(new Error(response.errorText || "LUNA_CALL_FAILED"), response);
            }
        });
    } else {
        callback(new Error("SERVICE_NOT_INITIALIZED"));
    }
}

function cancelActivity(name, callback) {
    lunaCall("luna://com.webos.service.activitymanager/cancel", { activityName: name }, function(err, result) {
        if (err) {
            // Treat "not found" or similar as idempotent success
            if (err.message && (err.message.indexOf("not found") !== -1 || err.message.indexOf("does not exist") !== -1)) {
                return callback(null);
            }
            return callback(err);
        }
        callback(null);
    });
}

function getActivityInfo(name, callback) {
    lunaCall("luna://com.webos.service.activitymanager/getActivityInfo", { activityName: name, subscribers: false }, function(err, result) {
        if (err) return callback(err);
        callback(null, result.activity);
    });
}

function createActivity(spec, callback) {
    lunaCall("luna://com.webos.service.activitymanager/create", spec, function(err, result) {
        if (err) return callback(err);
        callback(null, result.activityId);
    });
}

function scheduleActivity(event, callback) {
    const spec = {
        activity: {
            name: ACTIVITY_NAME,
            description: "AmbiSun solar transition wake",
            type: { foreground: true, persist: true },
            schedule: {
                start: formatScheduleStart(event.date)
            },
            callback: {
                method: "luna://org.webosbrew.ambisun.service/solarWake",
                params: {}
            }
        },
        replace: true,
        start: true,
        subscribe: false
    };

    createActivity(spec, function(err, activityId) {
        if (err) {
            status.active = false;
            status.lastError = { message: err.message || err.toString() };
            if (callback) callback(err);
            return;
        }
        status.active = true;
        status.activityId = activityId;
        status.nextEventType = event.type;
        status.nextEventAt = formatScheduleStart(event.date);
        status.lastError = null;
        if (callback) callback(null);
    });
}

function reconcile(config, nowStrOrDate, callback) {
    const nextEvent = getNextSolarEvent(config, nowStrOrDate);
    status.configured = !!nextEvent;
    
    if (!nextEvent) {
        cancelActivity(ACTIVITY_NAME, function(err) {
            status.active = false;
            status.activityId = null;
            status.nextEventType = null;
            status.nextEventAt = null;
            if (err) {
                status.lastError = { message: err.message };
                if (callback) callback(err);
            } else {
                status.lastError = null;
                if (callback) callback(null);
            }
        });
    } else {
        scheduleActivity(nextEvent, callback);
    }
}

function init(service) {
    activeService = service;
}

function injectAmProxy(proxy) {
    amProxy = proxy;
}

function getStatus() {
    return JSON.parse(JSON.stringify(status));
}

function recordWake(result) {
    status.lastWakeAt = formatScheduleStart(new Date());
    status.lastWakeResult = result;
}

function executeWake(currentConfig, decisionModule, hyperhdrModule, nowStrOrDate, callback) {
    var result = decisionModule.evaluate({
        config: currentConfig,
        source: null,
        now: nowStrOrDate
    });
    
    function performReconcile(ledError, ledResult) {
        if (ledError) {
            result = {
                action: "error",
                errorCode: "HYPERHDR_ERROR",
                errorText: ledError.message || ledError.toString(),
                decision: result
            };
        }
        recordWake(result);
        
        reconcile(currentConfig, nowStrOrDate, function(errReconcile) {
            if (result.action === "error") {
                result.rescheduled = !errReconcile;
                if (errReconcile) result.reconcileError = errReconcile.toString();
                if (callback) callback(null, result); // returning structured error as result
            } else {
                if (errReconcile) {
                    var finalRes = {
                        action: "error",
                        errorCode: "ACTIVITY_CREATE_FAILED",
                        errorText: errReconcile.message || errReconcile.toString(),
                        decision: result,
                        rescheduled: false
                    };
                    recordWake(finalRes);
                    if (callback) callback(null, finalRes);
                } else {
                    if (callback) callback(null, result);
                }
            }
        });
    }
    
    if (result.action === "set") {
        var options = (currentConfig && currentConfig.hyperhdr && currentConfig.hyperhdr.host)
            ? { host: currentConfig.hyperhdr.host, port: currentConfig.hyperhdr.port }
            : undefined;
        hyperhdrModule.setLedDevice(result.state, function(err) {
            performReconcile(err, null);
        }, options);
    } else {
        performReconcile(null, null);
    }
}

module.exports = {
    init: init,
    reconcile: reconcile,
    getStatus: getStatus,
    recordWake: recordWake,
    getNextSolarEvent: getNextSolarEvent,
    formatScheduleStart: formatScheduleStart,
    injectAmProxy: injectAmProxy,
    executeWake: executeWake,
    getActivityInfo: getActivityInfo,
    ACTIVITY_NAME: ACTIVITY_NAME
};
