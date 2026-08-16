var activeService = null;

var currentCandidate = null;
var candidateSince = 0;
var stableSource = { type: "unknown", id: null, name: null, raw: null };
var lastChangeAt = null;
var lastError = null;
var debounceTimer = null;

var DEBOUNCE_MS = 2000;

var appsCache = {}; // appId -> title
var hdmiCache = {}; // appId -> label

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
    
    var appName = appsCache[appId] || appId;
    return { type: "app", id: appId, name: appName, raw: rawPayload };
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

function handleCandidate(appId, rawPayload) {
    var candidate = normalizeSource(appId, rawPayload);
    
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

var ACTIVITY_NAME = "org.webosbrew.ambisun.source";

function setupSourceActivity() {
    if (!activeService) return;
    activeService.call("luna://com.webos.service.activitymanager/create", {
        activity: {
            name: ACTIVITY_NAME,
            description: "AmbiSun source trigger",
            type: { foreground: true, persist: true },
            trigger: {
                method: "luna://com.webos.service.applicationmanager/getForegroundAppInfo",
                params: { subscribe: true, extraInfo: true }
            },
            callback: {
                method: "luna://org.webosbrew.ambisun.service/sourceWake",
                params: {}
            }
        },
        replace: true,
        start: true,
        subscribe: false
    }, function(msg) {
        var resp = msg.payload || {};
        if (!resp.returnValue) {
            lastError = "Activity create failed: " + resp.errorText;
        } else {
            lastError = null;
        }
    });
}

function getInitialSource() {
    if (!activeService) return;
    activeService.call("luna://com.webos.service.applicationmanager/getForegroundAppInfo", {}, function(msg) {
        var payload = msg.payload || {};
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
        handleCandidate(appId, payload);
    });
}

function init(service) {
    activeService = service;
    updateCaches(); // Run in background, do not block subscription
    setupSourceActivity();
    getInitialSource();
}

function injectMocks(serviceMock, cachesMock) {
    activeService = serviceMock;
    if (cachesMock) {
        appsCache = cachesMock.apps || {};
        hdmiCache = cachesMock.hdmi || {};
    }
}

function simulateForegroundMessage(payload) {
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
    handleCandidate(appId, payload);
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
    getStableSource: getStableSource,
    onStableSource: onStableSource,
    normalizeSource: normalizeSource,
    injectMocks: injectMocks,
    simulateForegroundMessage: simulateForegroundMessage,
    DEBOUNCE_MS: DEBOUNCE_MS
};
