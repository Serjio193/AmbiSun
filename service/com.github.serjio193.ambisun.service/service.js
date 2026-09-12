var Service = require("webos-service");
var runtimeInfo = require("./lib/runtime-info");
var config = require("./lib/config");
var appIcon = require("./lib/app-icon");
var diagnostics = require("./lib/diagnostics");
var powerState = require("./lib/power-state");
var INSTANCE_ID = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
diagnostics.setInstanceId(INSTANCE_ID);
console.log("[AMBISUN SERVICE START] instance=" + INSTANCE_ID);

var service = new Service("com.github.serjio193.ambisun.service", null, {
    idleTimer: 86400
});

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
        powerState.init(service, {
            onSleep: function () { automation.handlePowerSleep(); },
            onWake: function () { automation.handlePowerWake(); }
        });
        if (!err && current) {
            // Keep one persistent boot callback so a reboot after sunset still
            // starts the service and applies the current rule once.
            scheduler.ensureBootActivity(function (bootError) {
                if (bootError) console.log("[SCHEDULER] boot activity: " + bootError.toString());
            });
            scheduler.reconcile(current.config, new Date());
        }
    });
});

var hyperhdrController = require("./lib/hyperhdr-controller");
var hyperhdrHandlers = require("./lib/service-hyperhdr");
hyperhdrHandlers(service, { config: config, runtimeInfo: runtimeInfo, automation: automation, hyperhdr: hyperhdrController });

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
        // Calculate for tomorrow so the UI can show both upcoming transitions.
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
        var tomorrowSunset = tomorrowResult.sunset.status === "ok" ? tomorrowResult.sunset.date : null;

        var sunsetOffsetMs  = (cfg.sunsetOffset  || 0) * 60000;
        var sunriseOffsetMs = (cfg.sunriseOffset || 0) * 60000;

        var effectiveSunset  = todaySunset  ? new Date(todaySunset.getTime()  + sunsetOffsetMs)  : null;
        var effectiveSunrise = tomorrowSunrise ? new Date(tomorrowSunrise.getTime() + sunriseOffsetMs) : null;
        var effectiveTomorrowSunset = tomorrowSunset ? new Date(tomorrowSunset.getTime() + sunsetOffsetMs) : null;

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

        // Keep the next ON time available even while the current next event is OFF.
        // The UI shows both fields, so an already-active night schedule must not
        // make the following sunset disappear.
        var nextOnAt = null;
        if (effectiveSunset && now < effectiveSunset) {
            nextOnAt = effectiveSunset.toISOString();
        } else if (effectiveTomorrowSunset && now < effectiveTomorrowSunset) {
            nextOnAt = effectiveTomorrowSunset.toISOString();
        }

        message.respond({
            returnValue: true,
            apiVersion: runtimeInfo.SERVICE_API_VERSION,
            solar: {
                todaySunrise:    todaySunrise  ? todaySunrise.toISOString()  : null,
                todaySunset:     todaySunset   ? todaySunset.toISOString()   : null,
                tomorrowSunrise: tomorrowSunrise ? tomorrowSunrise.toISOString() : null,
                tomorrowSunset:  tomorrowSunset ? tomorrowSunset.toISOString() : null,
                effectiveSunset:  effectiveSunset  ? effectiveSunset.toISOString()  : null,
                effectiveSunrise: effectiveSunrise ? effectiveSunrise.toISOString() : null,
                effectiveTomorrowSunset: effectiveTomorrowSunset ? effectiveTomorrowSunset.toISOString() : null,
                nextEventType: nextEventType,
                nextEventAt:   nextEventAt,
                nextOnAt:       nextOnAt,
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

service.register("bootWake", function (message) {
    // Re-arm the non-continuous activity before acknowledging the callback so
    // the same activity can fire again on the next TV reboot.
    scheduler.restartBootActivity(function (bootError) {
        if (bootError) console.log("[SCHEDULER] boot activity restart: " + bootError.toString());
        message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION });
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
        // HyperHDR serverinfo is intentionally not queried here. It is a
        // heavyweight read and is available through explicit UI actions.
        hyperhdrReachable: null,
        sourceAccessAvailable: false,
        schedulerActive: false,
        automationEnabled: false,
        currentSource: source.getStableSource()
    };
    
    var pending = 1;
    function checkDone() {
        pending--;
        if (pending === 0) {
            sys.healthy = sys.elevated && sys.sourceAccessAvailable;
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, system: sys });
        }
    }

    service.call(source.FOREGROUND_APP_URI, {}, function(msg) {
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

var sourceHandlers = require("./lib/service-sources");
sourceHandlers(service, { source: source, config: config, runtimeInfo: runtimeInfo, automation: automation, appIcon: appIcon, diagnostics: diagnostics });

var locationHandlers = require("./lib/service-location");
locationHandlers(service);

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
