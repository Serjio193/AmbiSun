var Service = require("webos-service");
var runtimeInfo = require("./lib/runtime-info");
var config = require("./lib/config");

var service = new Service("org.webosbrew.ambisun.service");

var scheduler = require("./lib/scheduler");
scheduler.init(service);

var source = require("./lib/source");
source.init(service);

var automation = require("./lib/automation");

function respondSafe(message, fn) {
    try {
        message.respond(fn());
    } catch (e) {
        message.respond({ returnValue: false, errorCode: "INTERNAL_ERROR", errorText: e.toString() });
    }
}

service.register("ping", function (message) {
    respondSafe(message, runtimeInfo.getPingResponse);
});

service.register("getRuntimeInfo", function (message) {
    respondSafe(message, runtimeInfo.getRuntimeInfo);
});

service.register("getCapabilities", function (message) {
    respondSafe(message, runtimeInfo.getCapabilities);
});

service.register("getConfig", function (message) {
    config.read(function(err, current) {
        respondSafe(message, function() {
            return {
                returnValue: true,
                apiVersion: runtimeInfo.SERVICE_API_VERSION,
                revision: current.revision,
                config: current.config
            };
        });
    });
});

service.register("updateConfig", function (message) {
    var payload = message.payload || {};
    var patch = payload.patch;
    var expectedRevision = payload.expectedRevision;
    
    config.update(patch, expectedRevision, function(err, current) {
        if (err) {
            var response = { returnValue: false };
            if (err.code === "REVISION_CONFLICT") {
                response.errorCode = "REVISION_CONFLICT";
                response.revision = err.revision;
            } else if (err.code === "CONFIG_INVALID" || err.code === "INVALID_REQUEST") {
                response.errorCode = err.code;
                response.errorText = err.message;
            } else {
                response.errorCode = "STORAGE_ERROR";
                response.errorText = err.toString();
            }
            return message.respond(response);
        }
        
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            revision: current.revision,
            config: current.config
        });
    });
});

service.register("resetConfig", function (message) {
    config.reset(function(err, current) {
        if (err) {
            return message.respond({ returnValue: false, errorCode: "STORAGE_ERROR", errorText: err.toString() });
        }
        
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            revision: current.revision,
            config: current.config
        });
    });
});

// Start asynchronous config initialization
config.init(function() {
    config.read(function(err, current) {
        automation.init();
        if (!err && current) {
            scheduler.reconcile(current.config, new Date());
        }
    });
});

var hyperhdr = require("./lib/hyperhdr");

service.register("getHyperhdrStatus", function (message) {
    hyperhdr.getStatus(function(err, result) {
        if (err) {
            return message.respond({
                returnValue: false,
                errorCode: err.code || "INTERNAL_ERROR",
                errorText: err.message
            });
        }
        
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            hyperhdr: {
                reachable: true,
                response: result
            }
        });
    });
});

service.register("setLedDevice", function (message) {
    var payload = message.payload || {};
    var state = payload.state;
    
    hyperhdr.setLedDevice(state, function(err, result) {
        if (err) {
            return message.respond({
                returnValue: false,
                errorCode: err.code || "INTERNAL_ERROR",
                errorText: err.message
            });
        }
        
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            state: state
        });
    });
});

var decision = require("./lib/decision");

service.register("evaluateNow", function (message) {
    var payload = message.payload || {};
    var source = payload.source;

    config.read(function(err, current) {
        if (err) {
            return message.respond({
                returnValue: false,
                errorCode: "STORAGE_ERROR",
                errorText: err.toString()
            });
        }

        try {
            var result = decision.evaluate({
                config: current.config,
                source: source,
                now: Date.now()
            });

            message.respond({
                returnValue: true,
                apiVersion: runtimeInfo.SERVICE_API_VERSION,
                decision: result
            });
        } catch (e) {
            message.respond({
                returnValue: false,
                errorCode: "INTERNAL_ERROR",
                errorText: e.toString()
            });
        }
    });
});

service.register("getSchedulerStatus", function (message) {
    respondSafe(message, function() {
        var st = scheduler.getStatus();
        return {
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            scheduler: st
        };
    });
});

var sunLib = require("./lib/sun");

service.register("getSolarStatus", function (message) {
    config.read(function(err, current) {
        if (err || !current) {
            return message.respond({ returnValue: false, errorCode: "STORAGE_ERROR" });
        }
        var cfg = current.config;
        var loc = cfg.location;
        if (!loc || !loc.lat || !loc.lon || !loc.timezone) {
            return message.respond({ returnValue: false, errorCode: "NO_LOCATION", errorText: "Location not configured" });
        }

        var now = new Date();
        // Calculate for today
        var todayResult = sunLib.calculate({
            year: now.getUTCFullYear(),
            month: now.getUTCMonth(),
            day: now.getUTCDate(),
            lat: loc.lat,
            lon: loc.lon
        });
        // Calculate for tomorrow (for "next sunrise after sunset")
        var tomorrow = new Date(now.getTime() + 86400000);
        var tomorrowResult = sunLib.calculate({
            year: tomorrow.getUTCFullYear(),
            month: tomorrow.getUTCMonth(),
            day: tomorrow.getUTCDate(),
            lat: loc.lat,
            lon: loc.lon
        });

        var todaySunrise = todayResult.sunrise.status === "ok" ? todayResult.sunrise.date : null;
        var todaySunset  = todayResult.sunset.status  === "ok" ? todayResult.sunset.date  : null;
        var tomorrowSunrise = tomorrowResult.sunrise.status === "ok" ? tomorrowResult.sunrise.date : null;

        var sunsetOffsetMs  = (cfg.sunsetOffset  || 0) * 60000;
        var sunriseOffsetMs = (cfg.sunriseOffset || 0) * 60000;

        var effectiveSunset  = todaySunset  ? new Date(todaySunset.getTime()  + sunsetOffsetMs)  : null;
        var effectiveSunrise = tomorrowSunrise ? new Date(tomorrowSunrise.getTime() + sunriseOffsetMs) : null;

        // Determine next event
        var nextEventType = null;
        var nextEventAt = null;
        if (effectiveSunset && now < effectiveSunset) {
            nextEventType = "on";
            nextEventAt = effectiveSunset.toISOString();
        } else if (effectiveSunrise && now < effectiveSunrise) {
            nextEventType = "off";
            nextEventAt = effectiveSunrise.toISOString();
        }

        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            solar: {
                todaySunrise:    todaySunrise  ? todaySunrise.toISOString()  : null,
                todaySunset:     todaySunset   ? todaySunset.toISOString()   : null,
                tomorrowSunrise: tomorrowSunrise ? tomorrowSunrise.toISOString() : null,
                effectiveSunset:  effectiveSunset  ? effectiveSunset.toISOString()  : null,
                effectiveSunrise: effectiveSunrise ? effectiveSunrise.toISOString() : null,
                nextEventType: nextEventType,
                nextEventAt:   nextEventAt,
                timezone: loc.timezone,
                sunsetOffset:  cfg.sunsetOffset  || 0,
                sunriseOffset: cfg.sunriseOffset || 0
            }
        });
    });
});

service.register("solarWake", function (message) {
    automation.executeSolarWake(function(err, result) {
        if (err) {
            scheduler.recordWake({ action: "error", errorText: err.toString() });
            return message.respond({ returnValue: false, errorCode: "INTERNAL_ERROR" });
        }
        scheduler.recordWake(result);
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            decision: result
        });
    });
});

service.register("reconcileScheduler", function (message) {
    config.read(function(err, current) {
        if (err) {
            return message.respond({ returnValue: false, errorCode: "STORAGE_ERROR", errorText: err.toString() });
        }
        scheduler.reconcile(current.config, new Date(), function(errScheduler) {
            if (errScheduler) {
                return message.respond({
                    returnValue: false,
                    errorCode: "ACTIVITY_CREATE_FAILED",
                    errorText: errScheduler.message || errScheduler.toString(),
                    scheduler: scheduler.getStatus()
                });
            }
            message.respond({
                returnValue: true,
                apiVersion: runtimeInfo.SERVICE_API_VERSION,
                scheduler: scheduler.getStatus()
            });
        });
    });
});

service.register("getSystemStatus", function(message) {
    var sys = {
        healthy: false,
        elevated: false,
        hyperhdrReachable: false,
        sourceAccessAvailable: false,
        schedulerActive: false,
        automationEnabled: false,
        currentSource: source.getStableSource()
    };
    
    var pending = 2;
    function checkDone() {
        pending--;
        if (pending === 0) {
            sys.healthy = sys.elevated && sys.sourceAccessAvailable && sys.hyperhdrReachable;
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, system: sys });
        }
    }
    
    hyperhdr.getStatus(function(err, res) {
        sys.hyperhdrReachable = !err;
        checkDone();
    });
    
    service.call("luna://com.webos.service.applicationmanager/getForegroundAppInfo", {}, function(msg) {
        var payload = msg.payload || {};
        if (payload.returnValue) {
            sys.elevated = true;
            sys.sourceAccessAvailable = true;
        } else {
            sys.elevated = false;
            sys.sourceAccessAvailable = false;
        }
        checkDone();
    });
    
    var st = scheduler.getStatus();
    sys.schedulerActive = !!(st && st.active);
    
    var auto = automation.getAutomationStatus();
    sys.automationEnabled = auto ? auto.enabled : false;
});

const ELEVATION_CMD = "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service org.webosbrew.ambisun.service";

service.register("requestElevation", function(message) {
    service.call("luna://org.webosbrew.hbchannel.service/exec", {
        command: ELEVATION_CMD
    }, function(msg) {
        var payload = msg.payload || {};
        if (payload.returnValue) {
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION });
        } else {
            message.respond({ returnValue: false, apiVersion: runtimeInfo.SERVICE_API_VERSION, errorCode: "ELEVATION_FAILED", errorText: payload.errorText || "Exec failed" });
        }
    });
});

service.register("getCurrentSource", function (message) {
    var st = source.getSourceDetectorStatus();
    message.respond({
        returnValue: true,
        apiVersion: runtimeInfo.SERVICE_API_VERSION,
        source: st.stableSource,
        detector: {
            mode: st.mode,
            triggerConfigured: st.triggerConfigured,
            lastChangeAt: st.lastChangeAt,
            lastError: st.lastError
        }
    });
});

service.register("getAutomationStatus", function (message) {
    message.respond({
        returnValue: true,
        apiVersion: runtimeInfo.SERVICE_API_VERSION,
        automation: automation.getAutomationStatus()
    });
});

service.register("evaluateAndApplyNow", function (message) {
    automation.evaluateAndApplyNow(function(err, result) {
        if (err) {
            return message.respond({ returnValue: false, errorCode: "INTERNAL_ERROR", errorText: err.toString() });
        }
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            decision: result
        });
    });
});

service.register("getSourceDetectorStatus", function (message) {
    message.respond({
        returnValue: true,
        apiVersion: runtimeInfo.SERVICE_API_VERSION,
        status: source.getSourceDetectorStatus()
    });
});

service.register("sourceWake", function (message) {
    var payload = message.payload || {};
    // Activity manager wraps trigger responses. 
    // Usually it's in payload.event or payload itself.
    var eventData = payload.event ? payload.event : payload;
    
    // Process through source.js
    source.simulateForegroundMessage(eventData);
    
    message.respond({
        returnValue: true,
        apiVersion: runtimeInfo.SERVICE_API_VERSION
    });
});

// IDs of system/internal apps to exclude from the sources catalog
var EXCLUDED_APP_IDS = [
    'airplay', 'amazon.alexapr', 'com.webos.app.home', 'com.webos.app.inputcommon',
    'com.webos.app.screensaver', 'com.webos.app.tvhotkey', 'com.webos.app.voice',
    'com.webos.app.welcomewizard', 'com.webos.ott.appcard', 'org.webosbrew.ambisun',
    'com.webos.app.inputcommon', 'com.webos.app.cnbcplus', 'com.webos.channelplus',
    'com.webos.app.photovideo', 'com.webos.app.music'
];

service.register("getAvailableSources", function (message) {
    var currentSrc = source.getStableSource();
    var cfg = config.get();
    var overrides = (cfg && cfg.config && cfg.config.overrides) ? cfg.config.overrides : {};

    var hdmiSources = [];
    var appSources  = [];
    var errors = [];
    var doneCount = 0;
    var settled = false;
    var PROVIDER_TIMEOUT = 3000;

    function tryFinish() {
        doneCount++;
        if (doneCount < 2 || settled) return;
        settled = true;

        var all = [];
        var seen = {};
        hdmiSources.forEach(function(s) { all.push(s); seen[s.id] = true; });
        appSources.forEach(function(s) {
            if (!seen[s.id]) { all.push(s); seen[s.id] = true; }
        });
        Object.keys(overrides).forEach(function(id) {
            if (!seen[id]) { all.push({ id: id, name: id, type: 'app', current: false }); seen[id] = true; }
        });

        // Strip raw from currentSource
        var compactCurrent = { type: 'unknown', id: null, name: null };
        if (currentSrc) {
            compactCurrent = { type: currentSrc.type || 'unknown', id: currentSrc.id || null, name: currentSrc.name || null };
            if (currentSrc.id) {
                all.forEach(function(s) { s.current = (s.id === currentSrc.id); });
            }
        }

        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            currentSource: compactCurrent,
            sources: all,
            partial: errors.length > 0,
            errors: errors
        });
    }

    // EIM — 3s timeout
    var hdmiTimer = setTimeout(function() {
        errors.push({ provider: 'eim', code: 'TIMEOUT' });
        tryFinish();
    }, PROVIDER_TIMEOUT);

    service.call("luna://com.webos.service.eim/getAllInputStatus", {}, function(eimMsg) {
        clearTimeout(hdmiTimer);
        var eimResp = eimMsg.payload || {};
        if (eimResp.returnValue && Array.isArray(eimResp.devices)) {
            eimResp.devices.forEach(function(dev) {
                if (!dev.id || !dev.id.startsWith('HDMI_')) return;
                hdmiSources.push({ id: dev.id, name: dev.label || dev.id, type: 'hdmi', current: false, connected: !!dev.connected });
            });
        } else {
            errors.push({ provider: 'eim', code: 'FAILED' });
        }
        tryFinish();
    });

    // Apps — 3s timeout
    var appsTimer = setTimeout(function() {
        errors.push({ provider: 'apps', code: 'TIMEOUT' });
        tryFinish();
    }, PROVIDER_TIMEOUT);

    service.call("luna://com.webos.applicationManager/listApps", {}, function(appsMsg) {
        clearTimeout(appsTimer);
        var appsResp = appsMsg.payload || {};
        if (appsResp.returnValue && Array.isArray(appsResp.apps)) {
            appsResp.apps.forEach(function(app) {
                if (!app.visible || !app.id || !app.title) return;
                if ((app.class || {}).hidden) return;
                if (EXCLUDED_APP_IDS.indexOf(app.id) >= 0) return;
                appSources.push({ id: app.id, name: app.title, type: 'app', current: false });
            });
            appSources.sort(function(a, b) { return a.name.localeCompare(b.name); });
        } else {
            errors.push({ provider: 'apps', code: 'FAILED' });
        }
        tryFinish();
    });
});

// ---- Location API ---------------------------------------------------------
//
// Single provider: countries.dev
//
// detectCountryByIp:
//   real country-level geolocation from the TV public IP.
//
// searchLocations:
//   top cities for ISO alpha-2 country code.
//   Response already includes coordinates, population and IANA timezone.
//
// resolveLocation:
//   compatibility lookup for one city.
// ---------------------------------------------------------------------------

var https = require("https");

var LOCATION_HTTP_TIMEOUT = 3500;
var LOCATION_MAX_RESPONSE = 1024 * 1024;

function locationHttpGetJson(url, callback, redirectCount) {
    redirectCount = redirectCount || 0;

    var finished = false;

    function finish(err, data) {
        if (finished) return;
        finished = true;
        callback(err, data);
    }

    var req;

    try {
        req = https.get(url, {
            headers: {
                "User-Agent": "AmbiSun/0.1",
                "Accept": "application/json"
            }
        }, function(res) {

            if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                res.resume();

                if (redirectCount >= 2) {
                    finish(new Error("LOCATION_TOO_MANY_REDIRECTS"));
                    return;
                }

                finished = true;

                locationHttpGetJson(
                    res.headers.location,
                    callback,
                    redirectCount + 1
                );

                return;
            }

            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                finish(new Error("LOCATION_HTTP_" + res.statusCode));
                return;
            }

            var body = "";
            var size = 0;

            res.setEncoding("utf8");

            res.on("data", function(chunk) {
                if (finished) return;

                size += Buffer.byteLength(chunk, "utf8");

                if (size > LOCATION_MAX_RESPONSE) {
                    req.destroy();
                    finish(new Error("LOCATION_RESPONSE_TOO_LARGE"));
                    return;
                }

                body += chunk;
            });

            res.on("end", function() {
                if (finished) return;

                try {
                    finish(null, JSON.parse(body));
                } catch (e) {
                    finish(new Error("LOCATION_INVALID_JSON"));
                }
            });
        });

        req.setTimeout(LOCATION_HTTP_TIMEOUT, function() {
            req.destroy();
            finish(new Error("LOCATION_TIMEOUT"));
        });

        req.on("error", function(err) {
            finish(err);
        });

    } catch (e) {
        finish(e);
    }
}


function normalizeCountryDevCity(c) {
    if (!c || !c.name) return null;

    var lat = Number(c.latitude);
    var lon = Number(c.longitude);

    if (!isFinite(lat) || !isFinite(lon)) {
        return null;
    }

    return {
        name: String(c.name),
        lat: lat,
        lon: lon,
        tz: c.timezone ? String(c.timezone) : "UTC",
        population: Number(c.population) || 0
    };
}


var locationCitiesCache = {};
var LOCATION_CACHE_MS = 24 * 60 * 60 * 1000;


service.register("detectCountryByIp", function(message) {

    locationHttpGetJson(
        "https://countries.dev/ip",
        function(err, data) {

            if (err) {
                message.respond({
                    returnValue: false,
                    errorCode: "IP_GEO_ERROR",
                    errorText: err.message
                });
                return;
            }

            var code = data && data.countryCode
                ? String(data.countryCode).toUpperCase()
                : "";

            var name =
                data &&
                data.country &&
                data.country.name
                    ? String(data.country.name)
                    : "";

            if (!code) {
                message.respond({
                    returnValue: false,
                    errorCode: "IP_GEO_INVALID_RESPONSE"
                });
                return;
            }

            message.respond({
                returnValue: true,
                provider: "countries.dev",
                country: {
                    countryCode: code,
                    name: name || code
                }
            });
        }
    );
});


service.register("searchLocations", function(message) {
    var params = message.payload || {};

    var countryCode = String(params.countryCode || "")
        .trim()
        .toUpperCase();

    if (!countryCode || countryCode.length !== 2) {
        message.respond({
            returnValue: false,
            errorCode: "INVALID_REQUEST",
            errorText: "ISO alpha-2 countryCode required"
        });
        return;
    }

    var cached = locationCitiesCache[countryCode];

    if (
        cached &&
        (Date.now() - cached.timestamp) < LOCATION_CACHE_MS
    ) {
        message.respond({
            returnValue: true,
            provider: "countries.dev",
            cached: true,
            countryCode: countryCode,
            cities: cached.cities
        });
        return;
    }

    var url =
        "https://countries.dev/cities" +
        "?country=" + encodeURIComponent(countryCode) +
        "&limit=60";

    locationHttpGetJson(url, function(err, data) {

        if (err) {
            message.respond({
                returnValue: false,
                errorCode: "LOCATION_API_ERROR",
                errorText: err.message
            });
            return;
        }

        if (!Array.isArray(data)) {
            message.respond({
                returnValue: false,
                errorCode: "LOCATION_INVALID_RESPONSE"
            });
            return;
        }

        var seen = {};
        var cities = [];

        data.forEach(function(raw) {
            var city = normalizeCountryDevCity(raw);

            if (!city) return;

            var key = city.name.toLowerCase();

            if (seen[key]) return;
            seen[key] = true;

            cities.push(city);
        });

        // countries.dev normally returns population order,
        // but keep our response deterministic.
        cities.sort(function(a, b) {
            return (b.population || 0) - (a.population || 0);
        });

        if (!cities.length) {
            message.respond({
                returnValue: false,
                errorCode: "NO_CITIES"
            });
            return;
        }

        locationCitiesCache[countryCode] = {
            timestamp: Date.now(),
            cities: cities
        };

        message.respond({
            returnValue: true,
            provider: "countries.dev",
            cached: false,
            countryCode: countryCode,
            cities: cities
        });
    });
});


service.register("resolveLocation", function(message) {
    var params = message.payload || {};

    var countryCode = String(params.countryCode || "")
        .trim()
        .toUpperCase();

    var cityName = String(params.city || "").trim();

    if (!countryCode || !cityName) {
        message.respond({
            returnValue: false,
            errorCode: "INVALID_REQUEST"
        });
        return;
    }

    var url =
        "https://countries.dev/cities" +
        "?country=" + encodeURIComponent(countryCode) +
        "&q=" + encodeURIComponent(cityName) +
        "&limit=10";

    locationHttpGetJson(url, function(err, data) {

        if (err || !Array.isArray(data) || !data.length) {
            message.respond({
                returnValue: false,
                errorCode: err ? "LOCATION_API_ERROR" : "LOCATION_NOT_FOUND",
                errorText: err ? err.message : "City not found"
            });
            return;
        }

        var chosen = null;
        var wanted = cityName.toLowerCase();

        for (var i = 0; i < data.length; i++) {
            if (
                data[i] &&
                data[i].name &&
                String(data[i].name).toLowerCase() === wanted
            ) {
                chosen = data[i];
                break;
            }
        }

        if (!chosen) {
            chosen = data[0];
        }

        var city = normalizeCountryDevCity(chosen);

        if (!city) {
            message.respond({
                returnValue: false,
                errorCode: "LOCATION_INVALID_RESPONSE"
            });
            return;
        }

        message.respond({
            returnValue: true,
            provider: "countries.dev",
            location: {
                city: city.name,
                countryCode: countryCode,
                lat: city.lat,
                lon: city.lon,
                timezone: city.tz
            }
        });
    });
});
