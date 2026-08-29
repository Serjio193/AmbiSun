var activeService = null;
var diagnostics = require("./diagnostics.js");

var currentCandidate = null;
var candidateSince = 0;
var stableSource = { type: "unknown", id: null, name: null, raw: null };
var lastChangeAt = null;
var lastError = null;
var debounceTimer = null;
var placeholderRetryTimer = null;
var sourceActivitySubscription = null;
var lastInputId = null;
var sourceTransition = {
    active: false,
    reason: null,
    foregroundAppId: null,
    since: null
};

var DEBOUNCE_MS = 2000;
var PLACEHOLDER_RETRY_MS = 5000;
var FOREGROUND_APP_URI = "luna://com.webos.applicationManager/getForegroundAppInfo";
var CURRENT_INPUT_URI = "luna://com.webos.service.eim/getCurrentInput";
var PERFORMANCE_TEST_DISABLE_ACTIVITY = false;

var appsCache = {}; // appId -> title
var hdmiCache = {}; // appId -> label
var LIVE_TV_APP_IDS = ["com.webos.app.livetv", "com.webos.app.livetvopapp"];

function getSourceDetectorStatus() {
    return {
        mode: PERFORMANCE_TEST_DISABLE_ACTIVITY ? "disabled-for-performance-test" : "foreground-subscription",
        triggerConfigured: !PERFORMANCE_TEST_DISABLE_ACTIVITY,
        stableSource: stableSource,
        displaySource: getVisibleSource(),
        transition: sourceTransition,
        candidate: currentCandidate,
        placeholderRetryPending: !!placeholderRetryTimer,
        lastChangeAt: lastChangeAt ? lastChangeAt.toISOString() : null,
        lastError: lastError
    };
}

function getVisibleSource() {
    if (sourceTransition.active) {
        return { type: "unknown", id: null, name: null, raw: null };
    }
    return stableSource;
}

function enterSourceTransition(appId) {
    var cancelledCandidate = currentCandidate;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    currentCandidate = null;
    candidateSince = 0;
    if (!sourceTransition.active) {
        sourceTransition.since = new Date().toISOString();
        diagnostics.record("source.transition.start", {
            reason: "launcher-between-sources",
            foregroundAppId: appId || null,
            previousSource: stableSource.id,
            cancelledCandidate: cancelledCandidate ? cancelledCandidate.id : null
        });
    } else if (cancelledCandidate) {
        diagnostics.record("source.transition.cancel-candidate", {
            candidate: cancelledCandidate.id,
            previousSource: stableSource.id
        });
    }
    sourceTransition.active = true;
    sourceTransition.reason = "launcher-between-sources";
    sourceTransition.foregroundAppId = appId || null;
}

function leaveSourceTransition() {
    if (!sourceTransition.active) return;
    diagnostics.record("source.transition.end", {
        foregroundAppId: sourceTransition.foregroundAppId,
        source: currentCandidate ? currentCandidate.id : stableSource.id
    });
    sourceTransition.active = false;
    sourceTransition.reason = null;
    sourceTransition.foregroundAppId = null;
    sourceTransition.since = null;
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
        var previous = stableSource;
        stableSource = candidate;
        leaveSourceTransition();
        lastChangeAt = new Date();
        diagnostics.sourceChange({ previous: previous, current: candidate });
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

function isPlaceholderTvInput(inputSource, appId) {
    return !!(inputSource && inputSource.type === "tv" &&
        (!appId || IGNORED_FOREGROUND_APP_IDS.indexOf(appId) !== -1));
}

function cancelPlaceholderRetry() {
    if (!placeholderRetryTimer) return;
    clearTimeout(placeholderRetryTimer);
    placeholderRetryTimer = null;
    diagnostics.record("source.placeholder.retry.cancel", {});
}

function schedulePlaceholderRetry() {
    if (placeholderRetryTimer || !activeService) return;

    placeholderRetryTimer = setTimeout(function() {
        placeholderRetryTimer = null;
        diagnostics.record("source.placeholder.retry", { delayMs: PLACEHOLDER_RETRY_MS });
        requestForegroundSource();
    }, PLACEHOLDER_RETRY_MS);
    diagnostics.record("source.placeholder.retry.schedule", { delayMs: PLACEHOLDER_RETRY_MS });
}

function handleSourceCandidate(candidate) {
    if (!candidate) return;

    // A real source notification makes any pending ATV placeholder retry stale.
    cancelPlaceholderRetry();

    diagnostics.sourceEvent({
        source: candidate.id,
        previous: stableSource.id,
        changed: stableSource.id !== candidate.id || stableSource.type !== candidate.type,
        type: candidate.type
    });

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
    if (appId === "com.webos.app.home") {
        enterSourceTransition(appId);
        return;
    }
    if (appId && IGNORED_FOREGROUND_APP_IDS.indexOf(appId) !== -1) {
        // Ignored foreground apps (AmbiSun UI and LG Home launcher) must not alter stable source, trigger debounce, or invoke automation
        return;
    }

    handleSourceCandidate(normalizeSource(appId, rawPayload));
}

function setupForegroundSubscription() {
    if (PERFORMANCE_TEST_DISABLE_ACTIVITY) return;
    if (!activeService || typeof activeService.subscribe !== "function") return false;

    sourceActivitySubscription = activeService.subscribe(FOREGROUND_APP_URI, {
        subscribe: true,
        extraInfo: true
    });

    sourceActivitySubscription.on("response", function(msg) {
        var resp = msg.payload || {};
        diagnostics.sourceActivity({
            phase: "foreground",
            returnValue: resp.returnValue === true,
            errorText: resp.errorText || null
        });
        if (!resp.returnValue) {
            lastError = "Foreground subscription failed: " + resp.errorText;
        } else {
            lastError = null;
            requestForegroundSource(resp);
        }
    });
    sourceActivitySubscription.on("cancel", function() {
        lastError = "Foreground subscription cancelled";
    });
    return true;
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

function requestForegroundSource(foregroundOverride, callback) {
    if (typeof foregroundOverride === "function") {
        callback = foregroundOverride;
        foregroundOverride = null;
    }
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

    if (foregroundOverride) {
        foregroundPayload = foregroundOverride;
        var foregroundAppId = extractForegroundAppId(foregroundPayload);
        if (foregroundAppId && IGNORED_FOREGROUND_APP_IDS.indexOf(foregroundAppId) !== -1) {
            // Home and AmbiSun can emit several foreground notifications while
            // their cards animate. They are not sources, so do not query EIM
            // for each duplicate notification or apply the last HDMI rule.
            if (foregroundAppId === "com.webos.app.home") enterSourceTransition(foregroundAppId);
            diagnostics.sourceRefresh({
                ignoredForeground: foregroundAppId,
                appId: foregroundAppId,
                candidate: currentCandidate,
                stableSource: stableSource
            });
            if (callback) callback();
            return;
        }
    }

    function done() {
        pending--;
        if (pending > 0) return;

        var inputId = inputPayload.mainInputSourceId || inputPayload.inputSourceId || null;
        var inputSource = inputPayload.returnValue ? normalizeInputSource(inputId, inputPayload) : null;
        var appId = extractForegroundAppId(foregroundPayload);
        var inputChanged = inputId && lastInputId && inputId !== lastInputId;
        var appIsIgnored = !!appId && IGNORED_FOREGROUND_APP_IDS.indexOf(appId) !== -1;
        var appIsMissing = !appId;
        var appIsHdmi = /^com\.webos\.app\.hdmi\d+$/i.test(appId || "");
        var isTvPreview = isPlaceholderTvInput(inputSource, appId);

        if (inputId) lastInputId = inputId;

        var refreshDetails = {
            inputId: inputId,
            appId: appId,
            inputChanged: !!inputChanged,
            stableSource: stableSource,
            candidate: currentCandidate
        };
        if (isTvPreview) {
            // ATV/DTV returned by Home is only the last-input placeholder.
            // Wait for the real Live TV foreground application instead.
            refreshDetails.ignoredPreview = inputSource.id;
            schedulePlaceholderRetry();
        } else if (appIsIgnored) {
            // Home and AmbiSun are containers, not lighting sources. Do not
            // substitute the last HDMI input while leaving an app or the
            // launcher; that would unexpectedly apply the HDMI rule.
            refreshDetails.ignoredForeground = appId;
            if (appId === "com.webos.app.home") enterSourceTransition(appId);
            cancelPlaceholderRetry();
        } else if (inputSource && (inputChanged || appIsMissing || appIsHdmi)) {
            cancelPlaceholderRetry();
            handleSourceCandidate(inputSource);
        } else if (appId) {
            cancelPlaceholderRetry();
            handleCandidate(appId, foregroundPayload);
        } else if (inputSource) {
            cancelPlaceholderRetry();
            handleSourceCandidate(inputSource);
        }
        diagnostics.sourceRefresh(refreshDetails);
        if (callback) callback();
    }

    activeService.call(CURRENT_INPUT_URI, {}, function(inputMsg) {
        inputPayload = inputMsg.payload || {};
        done();
    });
    if (foregroundOverride) {
        done();
    } else {
        activeService.call(FOREGROUND_APP_URI, {}, function(msg) {
            foregroundPayload = msg.payload || {};
            done();
        });
    }
}

function startSourcePolling() {
    // Activity Manager subscription is the live source signal. Keep one
    // initial snapshot for startup, but do not poll webOS every second.
    requestForegroundSource();
}

function init(service) {
    cancelPlaceholderRetry();
    activeService = service;
    // Normal source activity, cache loading, and the initial source request
    // are enabled. Only the old unconditional polling loop remains removed.
    if (!PERFORMANCE_TEST_DISABLE_ACTIVITY) {
        updateCaches();
        var hasForegroundSubscription = setupForegroundSubscription();
        if (!hasForegroundSubscription) startSourcePolling();
    }
}

function injectMocks(serviceMock, cachesMock) {
    cancelPlaceholderRetry();
    activeService = serviceMock;
    lastInputId = null;
    sourceTransition = {
        active: false,
        reason: null,
        foregroundAppId: null,
        since: null
    };
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
    getVisibleSource: getVisibleSource,
    _setStableSource: function(s) { stableSource = s; },
    onStableSource: onStableSource,
    normalizeSource: normalizeSource,
    normalizeInputSource: normalizeInputSource,
    handleCandidate: handleCandidate,
    FOREGROUND_APP_URI: FOREGROUND_APP_URI,
    CURRENT_INPUT_URI: CURRENT_INPUT_URI,
    IGNORED_FOREGROUND_APP_IDS: IGNORED_FOREGROUND_APP_IDS,
    isPlaceholderTvInput: isPlaceholderTvInput,
    PLACEHOLDER_RETRY_MS: PLACEHOLDER_RETRY_MS,
    LIVE_TV_APP_IDS: LIVE_TV_APP_IDS,
    injectMocks: injectMocks,
    simulateForegroundMessage: simulateForegroundMessage,
    setupForegroundSubscription: setupForegroundSubscription,
    DEBOUNCE_MS: DEBOUNCE_MS
};
