var config = require("./config.js");
var source = require("./source.js");
var decision = require("./decision.js");
var hyperhdr = require("./hyperhdr.js");
var scheduler = require("./scheduler.js");

var state = {
    enabled: false,
    currentSource: { type: "unknown", id: null, name: null, raw: null },
    lastDecision: null,
    lastDecisionAt: null,
    lastTrigger: null,
    lastAppliedState: null,
    lastAppliedProfile: null,
    lastAppliedBrightness: null,
    brightnessBaseline: null,
    lastAppliedAt: null,
    lastApplySkipped: false,
    lastApplyReason: null,
    lastObservedLedState: null,
    lastObservedEffect: null,
    hasAppliedInitialState: false,
    lastError: null,
    queueDepth: 0
};

var isColdStart = true;
var queue = [];
var isProcessing = false;
var recoveryRetryTimer = null;
var recoveryRetryAttempt = 0;
var RECOVERY_RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];
var startupRecheckTimer = null;
var startupRecheckAttempt = 0;
var STARTUP_RECHECK_DELAYS = [5000, 15000, 30000, 60000];
var stateReconcileTimer = null;
var STATE_RECONCILE_INTERVAL_MS = 10000;

function getAutomationStatus() {
    return JSON.parse(JSON.stringify(state));
}

function scheduleRecoveryRetry() {
    if (state.hasAppliedInitialState || recoveryRetryTimer ||
        recoveryRetryAttempt >= RECOVERY_RETRY_DELAYS.length) return;

    var delay = RECOVERY_RETRY_DELAYS[recoveryRetryAttempt++];
    recoveryRetryTimer = setTimeout(function () {
        recoveryRetryTimer = null;
        enqueueEvaluate("recovery-retry", true);
    }, delay);
}

function scheduleStartupRecheck() {
    if (startupRecheckTimer || startupRecheckAttempt >= STARTUP_RECHECK_DELAYS.length) return;

    var delay = STARTUP_RECHECK_DELAYS[startupRecheckAttempt++];
    startupRecheckTimer = setTimeout(function () {
        startupRecheckTimer = null;
        enqueueEvaluate("startup-recheck", true);
        scheduleStartupRecheck();
    }, delay);
}

function scheduleStateReconcile() {
    if (stateReconcileTimer) return;

    stateReconcileTimer = setTimeout(function () {
        stateReconcileTimer = null;
        enqueueEvaluate("state-reconcile", true);
        scheduleStateReconcile();
    }, STATE_RECONCILE_INTERVAL_MS);
    if (typeof stateReconcileTimer.unref === "function") stateReconcileTimer.unref();
}

function readLedDeviceState(options, callback) {
    hyperhdr.getStatus(function (err, status) {
        if (err) return callback(err);
        var info = status && (status.info || status);
        var components = info && Array.isArray(info.components) ? info.components : [];
        var ledDevice = null;
        for (var i = 0; i < components.length; i++) {
            if (components[i] && components[i].name === "LEDDEVICE") {
                ledDevice = components[i];
                break;
            }
        }
        if (!ledDevice || typeof ledDevice.enabled !== "boolean") {
            return callback(new Error("HyperHDR LEDDEVICE state is unavailable"));
        }
        var activeEffects = info && Array.isArray(info.activeEffects) ? info.activeEffects : [];
        var activeEffect = null;
        for (var j = 0; j < activeEffects.length; j++) {
            var effect = activeEffects[j];
            var effectName = typeof effect === "string" ? effect : effect && effect.name;
            if (!effectName) continue;
            if (effect && effect.priority === 64) {
                activeEffect = effectName;
                break;
            }
            if (!activeEffect) activeEffect = effectName;
        }
        callback(null, { enabled: ledDevice.enabled, effect: activeEffect });
    }, options);
}

function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    
    var job = queue.shift();
    state.queueDepth = queue.length;
    
    var cfg = config.get().config;
    state.enabled = cfg.enabled;
    
    // Evaluate
    var result = decision.evaluate({
        config: cfg,
        source: job.source,
        now: job.now
    });
    
    state.lastDecision = result;
    state.lastDecisionAt = new Date().toISOString();
    state.lastTrigger = job.trigger;
    
    function done(err) {
        if (err) {
            state.lastError = err.toString();
            if (!state.hasAppliedInitialState) scheduleRecoveryRetry();
        } else {
            state.lastError = null;
        }
        
        isProcessing = false;
        if (job.callback) {
            try { job.callback(err, result); } catch (e) { console.error(e); }
        }
        processQueue();
    }
    
    if (!state.enabled || result.action !== "set") {
        return done(null);
    }
    
    // Apply. An effect occupies AmbiSun's private HyperHDR priority channel.
    var options = (cfg.hyperhdr && cfg.hyperhdr.host)
        ? { host: cfg.hyperhdr.host, port: cfg.hyperhdr.port }
        : undefined;

    var sourceId = job.source && job.source.id;
    var effectRule = sourceId && cfg.effectOverrides ? cfg.effectOverrides[sourceId] : null;
    if (!effectRule && cfg.defaultEffect) effectRule = { mode: "effect", name: cfg.defaultEffect };
    var useEffect = result.state && effectRule && effectRule.mode === "effect" && effectRule.name;
    var brightness = sourceId && cfg.sourceBrightness && typeof cfg.sourceBrightness[sourceId] === "number"
        ? cfg.sourceBrightness[sourceId] : (typeof cfg.brightness === "number" ? cfg.brightness : 50);
    var useBrightness = result.state ? brightness : null;
    var restoreBrightness = result.state && useBrightness === null && state.lastAppliedBrightness !== null && state.brightnessBaseline !== null
        ? state.brightnessBaseline : null;
    var profileKey = JSON.stringify({
        sourceId: sourceId || null,
        effect: useEffect ? effectRule.name : null,
        brightness: useBrightness
    });

    // Avoid duplicate writes, but re-apply when source-specific settings change.
    if (!job.forceApply && state.lastAppliedState === result.state && state.lastAppliedProfile === profileKey) {
        state.lastApplySkipped = true;
        state.lastApplyReason = "DUPLICATE_STATE";
        return done(null);
    }

    function applyBrightness(next) {
        var target = useBrightness !== null ? useBrightness : restoreBrightness;
        if (target === null || typeof hyperhdr.setBrightness !== "function") return next();

        function writeBrightness() {
            hyperhdr.setBrightness(target, function(brightnessErr) {
                if (brightnessErr) return done(brightnessErr);
                next();
            }, options);
        }

        if (useBrightness !== null && state.brightnessBaseline === null && typeof hyperhdr.getStatus === "function") {
            return hyperhdr.getStatus(function(statusErr, status) {
                if (statusErr) return done(statusErr);
                var info = status && (status.info || status);
                var adjustment = info && Array.isArray(info.adjustment) ? info.adjustment[0] : null;
                if (!adjustment || typeof adjustment.brightness !== "number") return done(new Error("HyperHDR brightness is unavailable"));
                state.brightnessBaseline = adjustment.brightness;
                writeBrightness();
            }, options);
        }
        writeBrightness();
    }

    function applyToHyperhdr(observedState) {
        var observedLedState = observedState && typeof observedState === "object"
            ? observedState.enabled : observedState;
        var observedEffect = observedState && typeof observedState === "object"
            ? observedState.effect : null;
        state.lastObservedLedState = observedLedState;
        state.lastObservedEffect = observedEffect;
        var effectMatches = !useEffect || observedEffect === effectRule.name;
        if ((job.trigger === "startup-recheck" || job.trigger === "state-reconcile") &&
            observedLedState === result.state && effectMatches) {
            state.lastApplySkipped = true;
            state.lastApplyReason = "STATE_ALREADY_MATCHED";
            return done(null);
        }
        hyperhdr.clearEffect(function(clearErr) {
            if (clearErr) return done(clearErr);
            if (!result.state) {
                return hyperhdr.setLedDevice(false, finishApply, options);
            }
            if (useEffect) {
                return hyperhdr.setEffect(effectRule.name, function(effectErr) {
                    if (effectErr) return done(effectErr);
                    applyBrightness(function() { hyperhdr.setLedDevice(true, finishApply, options); });
                }, options);
            }
            applyBrightness(function() { hyperhdr.setLedDevice(true, finishApply, options); });
        }, options);
    }

    var shouldReadLedState = job.trigger === "recovery" ||
        job.trigger === "recovery-retry" || job.trigger === "startup-recheck" ||
        job.trigger === "state-reconcile";
    if (shouldReadLedState) {
        readLedDeviceState(options, function (statusErr, observedLedState) {
            if (statusErr) return done(statusErr);
            applyToHyperhdr(observedLedState);
        });
    } else {
        applyToHyperhdr(null);
    }

    function finishApply(err) {
        if (!err) {
            if (recoveryRetryTimer) {
                clearTimeout(recoveryRetryTimer);
                recoveryRetryTimer = null;
            }
            recoveryRetryAttempt = 0;
            state.lastAppliedState = result.state;
            state.lastAppliedProfile = profileKey;
            state.lastAppliedBrightness = result.state ? useBrightness : null;
            state.lastAppliedAt = new Date().toISOString();
            state.lastApplySkipped = false;
            state.lastApplyReason = useEffect ? "APPLIED_EFFECT" : "APPLIED_CAPTURE";
            state.hasAppliedInitialState = true;
            if (job.trigger === "recovery" || job.trigger === "recovery-retry") {
                scheduleStartupRecheck();
            }
        }
        done(err);
    }
}

function enqueueEvaluate(trigger, forceApply, callback) {
    queue.push({
        trigger: trigger,
        source: source.getStableSource(),
        now: new Date(),
        forceApply: forceApply,
        callback: callback
    });
    state.queueDepth = queue.length;
    processQueue();
}

function evaluateAndApplyNow(callback) {
    enqueueEvaluate("diagnostic", true, callback);
}

function init() {
    state.currentSource = source.getStableSource();
    
    config.onCommit(function(cfg) {
        state.enabled = cfg.config.enabled;
        scheduler.reconcile(cfg.config, new Date(), function(err) {
            // Reconciled
        });
        enqueueEvaluate("config-change", false);
    });
    
    source.onStableSource(function(src) {
        state.currentSource = src;
        if (!state.hasAppliedInitialState) {
            enqueueEvaluate("recovery", true);
        } else {
            enqueueEvaluate("source-change", false);
        }
    });
    
    // Cold start recovery
    if (isColdStart) {
        isColdStart = false;
        setTimeout(function() {
            var cfg = config.get().config;
            state.enabled = cfg.enabled;
            if (!state.hasAppliedInitialState) {
                enqueueEvaluate("recovery", true);
            }
        }, source.DEBOUNCE_MS + 500);
    }
    scheduleStateReconcile();
}

function executeSolarWake(callback) {
    // Schedule next
    var cfg = config.get().config;
    scheduler.reconcile(cfg, new Date(), function() {
        enqueueEvaluate("solar-wake", true, callback);
    });
}

module.exports = {
    init: init,
    getAutomationStatus: getAutomationStatus,
    evaluateAndApplyNow: evaluateAndApplyNow,
    executeSolarWake: executeSolarWake
};
