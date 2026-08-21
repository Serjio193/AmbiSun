var Service = require("webos-service");
var runtimeInfo = require("./lib/runtime-info");
var config = require("./lib/config");
var appIcon = require("./lib/app-icon");

var service = new Service("com.github.serjio193.ambisun.service");

var scheduler = require("./lib/scheduler");
scheduler.init(service);

var source = require("./lib/source");
source.init(service);

var automation = require("./lib/automation");

var ELEVATION_BIN = "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service";
var AMBISUN_APP_ID = "com.github.serjio193.ambisun";
var HBCHANNEL_SERVICE_URI = "luna://org.webosbrew.hbchannel.service";
var AMBISUN_SERVICE_ID = "com.github.serjio193.ambisun.service";
var ELEVATION_CMD = ELEVATION_BIN + " " + AMBISUN_APP_ID + "; " + ELEVATION_BIN + " " + AMBISUN_SERVICE_ID;
var elevationAttempted = false;
var elevationInProgress = false;
var elevationRestartScheduled = false;

function isServiceElevated() {
    return typeof process.getuid === "function" && process.getuid() === 0;
}

function elevateAndRestart(callback) {
    if (elevationInProgress) {
        return callback(new Error("Elevation is already in progress"));
    }

    elevationInProgress = true;
    function handleResult(msg, fallback) {
        var payload = msg && msg.payload ? msg.payload : (msg || {});
        elevationInProgress = false;

        if (!payload.returnValue) {
            if (fallback) {
                return elevateWithTypedApi();
            }
            return callback(new Error(payload.errorText || payload.error || "Elevation failed"));
        }

        elevationRestartScheduled = true;
        callback(null);

        // elevate-service changes the launcher used for future instances. The
        // current Node process cannot change its UID, so let webOS restart it.
        setTimeout(function() {
            process.exit(0);
        }, 250);
    }

    function elevateWithTypedApi() {
        elevationInProgress = true;
        service.call(HBCHANNEL_SERVICE_URI + "/elevateService", {
            id: AMBISUN_APP_ID
        }, function(appMsg) {
            var appPayload = appMsg && appMsg.payload ? appMsg.payload : (appMsg || {});
            if (!appPayload.returnValue) {
                return handleResult(appMsg, false);
            }
            service.call(HBCHANNEL_SERVICE_URI + "/elevateService", {
                id: AMBISUN_SERVICE_ID
            }, function(serviceMsg) {
                handleResult(serviceMsg, false);
            });
        });
    }

    // Match PicCap's working flow: repair both the app and service launcher
    // permissions through the root Homebrew exec service. The typed API is a
    // fallback for Homebrew Channel versions where /exec is unavailable.
    service.call(HBCHANNEL_SERVICE_URI + "/exec", {
        command: ELEVATION_CMD
    }, function(msg) {
        handleResult(msg, true);
    });
}

function tryAutomaticElevation() {
    if (isServiceElevated() || elevationAttempted || elevationInProgress) return;
    elevationAttempted = true;
    elevateAndRestart(function(err) {
        if (err) {
            console.warn("[elevation] automatic recovery failed:", err.message || err);
        }
    });
}

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
    var payload = message.payload || {};
    var currentCfg = config.get().config;
    var host = payload.host || (currentCfg.hyperhdr && currentCfg.hyperhdr.host) || "127.0.0.1";
    var port = payload.port || (currentCfg.hyperhdr && currentCfg.hyperhdr.port) || 8090;

    hyperhdr.getStatus(function(err, result) {
        if (err) {
            return message.respond({
                returnValue: false,
                errorCode: err.code || "INTERNAL_ERROR",
                errorText: err.message,
                testedEndpoint: { host: host, port: port }
            });
        }
        
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            testedEndpoint: { host: host, port: port },
            hyperhdr: {
                reachable: true,
                response: result
            }
        });
    }, { host: host, port: port });
});

service.register("getHyperhdrEffects", function (message) {
    var currentCfg = config.get().config;
    var options = (currentCfg.hyperhdr && currentCfg.hyperhdr.host)
        ? { host: currentCfg.hyperhdr.host, port: currentCfg.hyperhdr.port }
        : undefined;
    hyperhdr.getEffects(function(err, effects) {
        if (err) {
            return message.respond({
                returnValue: false,
                errorCode: err.code || "HYPERHDR_ERROR",
                errorText: err.message
            });
        }
        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            effects: effects
        });
    }, options);
});

service.register("setLedDevice", function (message) {
    var payload = message.payload || {};
    var state = payload.state;
    var currentCfg = config.get().config;
    var options = (currentCfg.hyperhdr && currentCfg.hyperhdr.host)
        ? { host: currentCfg.hyperhdr.host, port: currentCfg.hyperhdr.port }
        : undefined;
    
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
    }, options);
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
    var serviceElevated = isServiceElevated();
    var sys = {
        healthy: false,
        elevated: serviceElevated,
        elevationPending: elevationInProgress || elevationRestartScheduled,
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
    
    var currentCfg = config.get().config;
    var options = (currentCfg.hyperhdr && currentCfg.hyperhdr.host)
        ? { host: currentCfg.hyperhdr.host, port: currentCfg.hyperhdr.port }
        : undefined;

    hyperhdr.getStatus(function(err, res) {
        sys.hyperhdrReachable = !err;
        checkDone();
    }, options);
    
    service.call("luna://com.webos.service.applicationmanager/getForegroundAppInfo", {}, function(msg) {
        var payload = msg.payload || {};
        if (payload.returnValue) {
            sys.sourceAccessAvailable = true;
        } else {
            sys.sourceAccessAvailable = false;
        }
        checkDone();
    });
    
    var st = scheduler.getStatus();
    sys.schedulerActive = !!(st && st.active);
    
    var auto = automation.getAutomationStatus();
    sys.automationEnabled = auto ? auto.enabled : false;

    // A service can be restarted by webOS after being idle or after an
    // activity wake. If the launcher was not elevated, repair it once and
    // restart this instance automatically instead of waiting for the user.
    if (!serviceElevated) {
        tryAutomaticElevation();
        sys.elevationPending = elevationInProgress || elevationRestartScheduled;
    }
});

service.register("requestElevation", function(message) {
    elevateAndRestart(function(err) {
        if (!err) {
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION });
        } else {
            message.respond({ returnValue: false, apiVersion: runtimeInfo.SERVICE_API_VERSION, errorCode: "ELEVATION_FAILED", errorText: err.message || "Exec failed" });
        }
    });
});

service.register("restartAfterElevation", function(message) {
    message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION });
    // The launcher may have been patched by a direct Homebrew Channel call.
    // Exit the stale jailed process so the next Luna request starts it again.
    setTimeout(function() {
        process.exit(0);
    }, 250);
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
    'com.webos.app.welcomewizard', 'com.webos.ott.appcard', 'com.github.serjio193.ambisun',
    'com.webos.app.inputcommon', 'com.webos.app.cnbcplus', 'com.webos.channelplus',
    'com.webos.app.photovideo', 'com.webos.app.music'
];

service.register("getAvailableSources", function (message) {
    var currentSrc = source.getStableSource();
    var cfg = config.get();
    var overrides = (cfg && cfg.config && cfg.config.overrides) ? cfg.config.overrides : {};
    var effectOverrides = (cfg && cfg.config && cfg.config.effectOverrides) ? cfg.config.effectOverrides : {};
    var hiddenSources = (cfg && cfg.config && cfg.config.hiddenSources) ? cfg.config.hiddenSources : {};

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
        Object.keys(effectOverrides).forEach(function(id) {
            if (!seen[id]) { all.push({ id: id, name: id, type: 'app', current: false }); seen[id] = true; }
        });
        Object.keys(hiddenSources).forEach(function(id) {
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
                appSources.push({
                    id: app.id,
                    name: app.title,
                    type: 'app',
                    icon: appIcon.toDataUri(app),
                    current: false
                });
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
// countries.dev:
//   ONLY country detection by public IP.
//
// GeoNames bundled database:
//   countries, cities, coordinates, population, timezone.
//
// No city selection requires Internet access.
// ---------------------------------------------------------------------------

var https = require("https");
var fs = require("fs");
var path = require("path");

var LOCATION_HTTP_TIMEOUT = 3500;
var LOCATION_MAX_RESPONSE = 128 * 1024;

var LOCATION_DATA_ROOT = path.join(__dirname, "data");
var LOCATION_CITIES_ROOT = path.join(LOCATION_DATA_ROOT, "cities");

var countryCatalogCache = null;
var localCityCache = {};


function locationHttpGetJson(url, callback) {
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


function loadCountryCatalog(callback) {
    if (countryCatalogCache) {
        callback(null, countryCatalogCache);
        return;
    }

    fs.readFile(
        path.join(LOCATION_DATA_ROOT, "countries.json"),
        "utf8",
        function(err, body) {

            if (err) {
                callback(err);
                return;
            }

            try {
                countryCatalogCache = JSON.parse(body);
                callback(null, countryCatalogCache);
            } catch (e) {
                callback(e);
            }
        }
    );
}


function normalizeLocalCity(raw) {
    if (!raw || !raw.n) return null;

    var lat = Number(raw.a);
    var lon = Number(raw.o);

    if (!isFinite(lat) || !isFinite(lon)) {
        return null;
    }

    return {
        name: String(raw.n),
        lat: lat,
        lon: lon,
        tz: raw.t ? String(raw.t) : "UTC",
        population: Number(raw.p) || 0
    };
}


function loadLocalCities(countryCode, callback) {
    countryCode = String(countryCode || "").trim().toUpperCase();

    if (!/^[A-Z]{2}$/.test(countryCode)) {
        callback(new Error("INVALID_COUNTRY_CODE"));
        return;
    }

    if (localCityCache[countryCode]) {
        callback(null, localCityCache[countryCode]);
        return;
    }

    var file = path.join(
        LOCATION_CITIES_ROOT,
        countryCode + ".json"
    );

    fs.readFile(file, "utf8", function(err, body) {

        if (err) {
            callback(err);
            return;
        }

        try {
            var raw = JSON.parse(body);

            if (!Array.isArray(raw)) {
                callback(new Error("INVALID_CITY_DATABASE"));
                return;
            }

            var cities = raw
                .map(normalizeLocalCity)
                .filter(function(city) {
                    return !!city;
                });

            localCityCache[countryCode] = cities;

            callback(null, cities);

        } catch (e) {
            callback(e);
        }
    });
}


// Real country detection from TV public IP.
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

            var code =
                data && data.countryCode
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


// All bundled countries grouped by continent.
service.register("getLocationCountries", function(message) {

    loadCountryCatalog(function(err, catalog) {

        if (err) {
            message.respond({
                returnValue: false,
                errorCode: "LOCATION_DATABASE_ERROR",
                errorText: err.toString()
            });
            return;
        }

        message.respond({
            returnValue: true,
            provider: "geonames-offline",
            catalog: catalog
        });
    });
});


// Cities from local GeoNames database with pagination support.
service.register("searchLocations", function(message) {

    var params = message.payload || {};

    var countryCode =
        String(params.countryCode || "")
            .trim()
            .toUpperCase();

    var offset = parseInt(params.offset, 10);
    if (isNaN(offset) || offset < 0) {
        offset = 0;
    }

    var limit = parseInt(params.limit, 10);
    if (isNaN(limit) || limit <= 0 || limit > 60) {
        limit = 60;
    }

    loadLocalCities(countryCode, function(err, cities) {

        if (err) {
            message.respond({
                returnValue: false,
                errorCode: "LOCATION_DATABASE_ERROR",
                errorText: err.toString()
            });
            return;
        }

        var total = cities.length;
        var sliced = cities.slice(offset, offset + limit);

        message.respond({
            returnValue: true,
            provider: "geonames-offline",
            countryCode: countryCode,
            total: total,
            offset: offset,
            limit: limit,
            cities: sliced
        });
    });
});


// Compatibility method: entirely local.
service.register("resolveLocation", function(message) {

    var params = message.payload || {};

    var countryCode =
        String(params.countryCode || "")
            .trim()
            .toUpperCase();

    var cityName =
        String(params.city || "").trim();

    loadLocalCities(countryCode, function(err, cities) {

        if (err) {
            message.respond({
                returnValue: false,
                errorCode: "LOCATION_DATABASE_ERROR",
                errorText: err.toString()
            });
            return;
        }

        var wanted = cityName.toLowerCase();
        var city = null;

        for (var i = 0; i < cities.length; i++) {
            if (cities[i].name.toLowerCase() === wanted) {
                city = cities[i];
                break;
            }
        }

        if (!city) {
            message.respond({
                returnValue: false,
                errorCode: "LOCATION_NOT_FOUND"
            });
            return;
        }

        message.respond({
            returnValue: true,
            provider: "geonames-offline",
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

var updater = require("./lib/updater");

service.register("checkForUpdate", function (message) {
    updater.checkForUpdate(function(err, result) {
        if (err) {
            return message.respond({
                returnValue: false,
                errorCode: err.code || "INTERNAL_ERROR",
                errorText: err.message
            });
        }
        message.respond(result);
    });
});

service.register("installUpdate", function (message) {
    var payload = message.payload || {};
    updater.installUpdate(payload, service, function(err, result) {
        if (err) {
            return message.respond({
                returnValue: false,
                errorCode: err.code || "INSTALL_FAILED",
                errorText: err.message
            });
        }
        message.respond(result);
    });
});

service.register("minimizeApp", function (message) {
    service.call("luna://com.webos.applicationManager/launch", { id: "com.webos.app.home" }, function (res) {
        var payload = res && res.payload ? res.payload : res;
        if (payload && payload.returnValue === true) {
            message.respond({ returnValue: true, message: "App minimized" });
        } else {
            message.respond({
                returnValue: false,
                errorCode: "MINIMIZE_FAILED",
                errorText: (payload && (payload.errorText || payload.error)) || "Failed to launch home screen"
            });
        }
    });
});
