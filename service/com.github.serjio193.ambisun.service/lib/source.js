var activeService = null;

var currentCandidate = null;
var candidateSince = 0;
var stableSource = { type: "unknown", id: null, name: null, raw: null };
var lastChangeAt = null;
var lastError = null;
var debounceTimer = null;
var sourcePollTimer = null;
var sourceActivitySubscription = null;
var lastInputId = null;

var DEBOUNCE_MS = 2000;
var SOURCE_POLL_MS = 1000;
var FOREGROUND_APP_URI = "luna://com.webos.applicationManager/getForegroundAppInfo";
var CURRENT_INPUT_URI = "luna://com.webos.service.eim/getCurrentInput";

var appsCache = {}; // appId -> title
var hdmiCache = {}; // appId -> label
var LIVE_TV_APP_IDS = ["com.webos.app.livetv", "com.webos.app.livetvopapp"];

function getSourceDetectorStatus() {
    return {
        mode: "activity-trigger",
        triggerConfigured: true,
        stableSource: stableSource,
        candidate: currentCandidate,
        lastChangeAt: lastChangeAt ? lastChangeAt.toISOString() : null,
        lastError: lastError
    };
}

function updateCaches(callback) {
    if (!activeService) return callback && callback();
    
    var pending = 2;
    function done() {
        pending--;
        if (pending === 0 && callback) callback();
    }
    
    activeService.call("luna://com.webos.service.eim/getAllInputStatus", {}, function(msg) {
        var resp = msg.payload || {};
        if (resp.returnValue && Array.isArray(resp.devices)) {
            resp.devices.forEach(function(dev) {
                if (dev.appId && dev.label) {
                    hdmiCache[dev.appId] = dev.label;
                }
            });
        }
        done();
    });
    
    activeService.call("luna://com.webos.applicationManager/listApps", {}, function(msg) {
        var resp = msg.payload || {};
        if (resp.returnValue && Array.isArray(resp.apps)) {
            resp.apps.forEach(function(app) {
                if (app.id && app.title) {
                    appsCache[app.id] = app.title;
                }
            });
        }
        done();
    });
}

function normalizeSource(appId, rawPayload) {
    if (!appId || appId === "") {
        return { type: "unknown", id: null, name: null, raw: rawPayload };
    }
    
    var match = /^com\.webos\.app\.hdmi(\d+)$/.exec(appId);
    if (match) {
        var hdmiId = "HDMI_" + match[1];
        var hdmiName = hdmiCache[appId] || hdmiId;
        return { type: "hdmi", id: hdmiId, name: hdmiName, raw: rawPayload };
    }

    if (LIVE_TV_APP_IDS.indexOf(appId) !== -1) {
        return { type: "tv", id: "ATV", name: "Эфир", raw: rawPayload };
    }
    
    var appName = appsCache[appId] || appId;
    return { type: "app", id: appId, name: appName, raw: rawPayload };
}

function normalizeInputSource(inputId, rawPayload) {
    if (!inputId || inputId === "") return null;

    var hdmiMatch = /^(?:HDMI[_-]?|com\.webos\.app\.hdmi)(\d+)$/i.exec(inputId);
    if (hdmiMatch) {
        var hdmiNumber = hdmiMatch[1];
        var hdmiAppId = "com.webos.app.hdmi" + hdmiNumber;
        var hdmiId = "HDMI_" + hdmiNumber;
        return {
            type: "hdmi",
            id: hdmiId,
            name: hdmiCache[hdmiAppId] || hdmiId,
            raw: rawPayload
        };
    }

    if (/^(?:ATV|DTV|TV|LIVE[_-]?TV)$/i.test(inputId)) {
        return { type: "tv", id: "ATV", name: "Эфир", raw: rawPayload };
    }

    return { type: "input", id: inputId, name: inputId, raw: rawPayload };
}

function commitCandidate(candidate) {
    if (stableSource.id !== candidate.id || stableSource.type !== candidate.type) {
        stableSource = candidate;
        lastChangeAt = new Date();
        listeners.forEach(function(cb) {
            try { cb(stableSource); } catch (e) { console.error("source listener error", e); }
        });
    }
    currentCandidate = null;
}

var IGNORED_FOREGROUND_APP_IDS = [
    "com.github.serjio193.ambisun",
    "com.webos.app.home"
];

function handleSourceCandidate(candidate) {
    if (!candidate) return;

    if (stableSource.id === candidate.id && stableSource.type === candidate.type) {
        // Already stable, clear any pending debounce
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        currentCandidate = null;
        return;
    }

    if (currentCandidate && currentCandidate.id === candidate.id && currentCandidate.type === candidate.type) {
        // Same candidate, wait for timer
        return;
    }

    // New candidate
    currentCandidate = candidate;
    candidateSince = Date.now();

    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(function() {
        debounceTimer = null;
        commitCandidate(candidate);
    }, DEBOUNCE_MS);
}

function handleCandidate(appId, rawPayload) {
    if (appId && IGNORED_FOREGROUND_APP_IDS.indexOf(appId) !== -1) {
        // Ignored foreground apps (AmbiSun UI and LG Home launcher) must not alter stable source, trigger debounce, or invoke automation
        return;
    }

    handleSourceCandidate(normalizeSource(appId, rawPayload));
}

var ACTIVITY_NAME = "com.github.serjio193.ambisun.source";

function setupSourceActivity() {
    if (!activeService) return;
    var activitySpec = {
        activity: {
            name: ACTIVITY_NAME,
            description: "AmbiSun source trigger",
            type: { foreground: true, persist: true },
            trigger: {
                method: FOREGROUND_APP_URI,
                params: { subscribe: true, extraInfo: true },
                key: "foregroundAppInfo"
            },
            callback: {
                method: "luna://com.github.serjio193.ambisun.service/sourceWake",
                params: {}
            }
        },
        replace: true,
        start: true,
        subscribe: true
    };

    function handleActivityResponse(msg) {
        var resp = msg.payload || {};
        if (!resp.returnValue) {
            lastError = "Activity create failed: " + resp.errorText;
        } else {
            lastError = null;
        }
    }

    if (typeof activeService.subscribe === "function") {
        sourceActivitySubscription = activeService.subscribe(
            "luna://com.webos.service.activitymanager/create", activitySpec);
        sourceActivitySubscription.on("response", handleActivityResponse);
        sourceActivitySubscription.on("cancel", function(msg) {
            lastError = "Source activity subscription cancelled";
        });
        return;
    }

    activeService.call("luna://com.webos.service.activitymanager/create", activitySpec,
        handleActivityResponse);
}

function extractForegroundAppId(payload) {
    var appId = null;
    if (Array.isArray(payload.foregroundAppInfo) && payload.foregroundAppInfo.length > 0) {
        var topApp = payload.foregroundAppInfo[0];
        for (var i = 0; i < payload.foregroundAppInfo.length; i++) {
            if (payload.foregroundAppInfo[i].order === 0) {
                topApp = payload.foregroundAppInfo[i];
                break;
            }
        }
        appId = topApp.appId;
    } else if (payload.appId) {
        appId = payload.appId;
    }
    return appId;
}

function requestForegroundSource(callback) {
    if (!activeService) {
        if (callback) callback();
        return;
    }

    // A foreground app can remain alive after the TV switches to an external
    // input. EIM reports input transitions, while the foreground endpoint
    // remains authoritative when an app is opened over the same input.
    var inputPayload = {};
    var foregroundPayload = {};
    var pending = 2;

    function done() {
        pending--;
        if (pending > 0) return;

        var inputId = inputPayload.mainInputSourceId || inputPayload.inputSourceId || null;
        var inputSource = inputPayload.returnValue ? normalizeInputSource(inputId, inputPayload) : null;
        var appId = extractForegroundAppId(foregroundPayload);
        var inputChanged = inputId && lastInputId && inputId !== lastInputId;
        var appIsIgnored = !appId || IGNORED_FOREGROUND_APP_IDS.indexOf(appId) !== -1;
        var appIsHdmi = /^com\.webos\.app\.hdmi\d+$/i.test(appId || "");

        if (inputId) lastInputId = inputId;

        if (inputSource && (inputChanged || appIsIgnored || appIsHdmi)) {
            handleSourceCandidate(inputSource);
        } else if (appId) {
            handleCandidate(appId, foregroundPayload);
        } else if (inputSource) {
            handleSourceCandidate(inputSource);
        }
        if (callback) callback();
    }

    activeService.call(CURRENT_INPUT_URI, {}, function(inputMsg) {
        inputPayload = inputMsg.payload || {};
        done();
    });
    activeService.call(FOREGROUND_APP_URI, {}, function(msg) {
        foregroundPayload = msg.payload || {};
        done();
    });
}

function startSourcePolling() {
    if (sourcePollTimer) return;
    requestForegroundSource();
    sourcePollTimer = setInterval(requestForegroundSource, SOURCE_POLL_MS);
}

function init(service) {
    activeService = service;
    updateCaches(); // Run in background, do not block subscription
    setupSourceActivity();
    startSourcePolling();
}

function injectMocks(serviceMock, cachesMock) {
    activeService = serviceMock;
    lastInputId = null;
    if (cachesMock) {
        appsCache = cachesMock.apps || {};
        hdmiCache = cachesMock.hdmi || {};
    }
}

function simulateForegroundMessage(payload) {
    handleCandidate(extractForegroundAppId(payload), payload);
}

var listeners = [];

function onStableSource(callback) {
    listeners.push(callback);
}

function getStableSource() {
    return stableSource;
}

module.exports = {
    init: init,
    getSourceDetectorStatus: getSourceDetectorStatus,
    refreshForegroundSource: requestForegroundSource,
    getStableSource: getStableSource,
    _setStableSource: function(s) { stableSource = s; },
    onStableSource: onStableSource,
    normalizeSource: normalizeSource,
    normalizeInputSource: normalizeInputSource,
    handleCandidate: handleCandidate,
    FOREGROUND_APP_URI: FOREGROUND_APP_URI,
    CURRENT_INPUT_URI: CURRENT_INPUT_URI,
    IGNORED_FOREGROUND_APP_IDS: IGNORED_FOREGROUND_APP_IDS,
    LIVE_TV_APP_IDS: LIVE_TV_APP_IDS,
    injectMocks: injectMocks,
    simulateForegroundMessage: simulateForegroundMessage,
    DEBOUNCE_MS: DEBOUNCE_MS
};
