var config = require("./config.js");
var source = require("./source.js");
var decision = require("./decision.js");
var hyperhdrController = require("./hyperhdr-controller.js");
var scheduler = require("./scheduler.js");
var diagnostics = require("./diagnostics.js");

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
    lastAppliedEffect: null,
    physicalStateValid: false,
    hasAppliedInitialState: false,
    lastError: null,
    queueDepth: 0
};

var queue = [];
var isProcessing = false;
var recoveryRetryTimer = null;
var recoveryRetryAttempt = 0;
var startupEvaluationTimer = null;
var wakeRecoveryTimer = null;
var startupEvaluationPending = false;
var wakeRecoveryPending = false;
var previewPaused = false;
var previewResumePending = false;
var STABILITY_DELAY_MS = 5000;
var WAKE_START_DELAY_MS = 10000;
var RECOVERY_RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];
// Recovery retries apply only after a failed HyperHDR write. Startup and a
// real TV wake each keep their own single delayed evaluation.
var PERFORMANCE_TEST_DISABLE_RECOVERY = false;
function getAutomationStatus() {
    var result = JSON.parse(JSON.stringify(state));
    result.previewPaused = previewPaused;
    return result;
}

function scheduleRecoveryRetry() {
    if (PERFORMANCE_TEST_DISABLE_RECOVERY) return;
    if (state.physicalStateValid || recoveryRetryTimer ||
        recoveryRetryAttempt >= RECOVERY_RETRY_DELAYS.length) return;

    var delay = RECOVERY_RETRY_DELAYS[recoveryRetryAttempt++];
    recoveryRetryTimer = setTimeout(function () {
        recoveryRetryTimer = null;
        enqueueEvaluate("recovery-retry", false);
    }, delay);
}

function processQueue() {
    if (previewPaused || isProcessing || queue.length === 0) return;
    isProcessing = true;
    
    var job = queue.shift();
    state.queueDepth = queue.length;
    diagnostics.record("automation.process", {
        trigger: job.trigger,
        forceApply: !!job.forceApply,
        queueDepth: state.queueDepth,
        source: job.source
    });
    
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
    diagnostics.automationEvaluated({
        trigger: job.trigger,
        forceApply: !!job.forceApply,
        action: result.action,
        state: result.state,
        source: job.source
    });
    
    function done(err) {
        if (err) {
            state.lastError = err.toString();
            diagnostics.automationError({ trigger: job.trigger, error: err.toString() });
            if (!state.physicalStateValid) scheduleRecoveryRetry();
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
        diagnostics.automationSkipped({
            trigger: job.trigger,
            reason: !state.enabled ? "DISABLED" : "NO_ACTION",
            action: result.action
        });
        return done(null);
    }
    
    // Apply. An effect occupies AmbiSun's private HyperHDR priority channel.
    var options = (cfg.hyperhdr && cfg.hyperhdr.host)
        ? { host: cfg.hyperhdr.host, port: cfg.hyperhdr.port, diagnosticSource: "automation" }
        : { diagnosticSource: "automation" };

    var sourceId = job.source && job.source.id;
    var effectRule = sourceId && cfg.effectOverrides ? cfg.effectOverrides[sourceId] : null;
    if (!effectRule && cfg.defaultEffect) effectRule = { mode: "effect", name: cfg.defaultEffect };
    var useEffect = result.state && effectRule && effectRule.mode === "effect" && effectRule.name;
    var brightness = sourceId && cfg.sourceBrightness && typeof cfg.sourceBrightness[sourceId] === "number"
        ? cfg.sourceBrightness[sourceId] : (typeof cfg.brightness === "number" ? cfg.brightness : 50);
    var useBrightness = result.state ? brightness : null;
    var targetEffect = useEffect ? effectRule.name : null;
    var profileKey = JSON.stringify({
        state: !!result.state,
        effect: targetEffect,
        brightness: useBrightness
    });

    // The profile describes HyperHDR control, not the source identity. Two
    // sources using the same effect must not cause another HyperHDR write.
    if (!job.forceApply && state.physicalStateValid &&
        state.lastAppliedState === result.state && state.lastAppliedProfile === profileKey) {
        state.lastApplySkipped = true;
        state.lastApplyReason = "DUPLICATE_STATE";
        diagnostics.automationSkipped({ trigger: job.trigger, reason: "DUPLICATE_STATE", profile: profileKey });
        return done(null);
    }

    function applyBrightness(next) {
        if (useBrightness === null || typeof hyperhdrController.setBrightness !== "function") return next();
        // HyperHDR keeps the adjustment while its LED component is disabled.
        // A wake must restore the HyperHDR instance, but repeating the same adjustment
        // creates unnecessary work in HyperHDR's component pipeline.
        if (job.trigger === "power-wake" && state.lastAppliedBrightness === useBrightness) return next();
        if (state.physicalStateValid && state.lastAppliedBrightness === useBrightness) return next();
        hyperhdrController.setBrightness(useBrightness, { reason: job.trigger, caller: "automation" }, options, function(brightnessErr) {
            if (brightnessErr) return done(brightnessErr);
            next();
        }, options);
    }

    var previousEffect = state.lastAppliedEffect;
    var needsLedOn = !state.physicalStateValid || state.lastAppliedState !== true;
    var needsEffect = !!targetEffect && (!state.physicalStateValid || state.lastAppliedEffect !== targetEffect || state.lastAppliedState !== true);
    var needsClear = !targetEffect && previousEffect !== null;

    function applyOff() {
        if (!state.physicalStateValid && !job.forceApply) {
            return finishExpectedOff();
        }
        if (state.lastAppliedState === false && !job.forceApply) return finishExpectedOff();
        if (previousEffect !== null) {
            return hyperhdrController.clearEffect({ reason: job.trigger, caller: "automation" }, options, function(clearErr) {
                if (clearErr) return done(clearErr);
                hyperhdrController.setLedDevice(false, { reason: job.trigger, caller: "automation" }, options, finishApply);
            });
        }
        hyperhdrController.setLedDevice(false, { reason: job.trigger, caller: "automation" }, options, finishApply);
    }

    function applyOn() {
        function afterEffect() {
            applyBrightness(function() {
                if (!needsLedOn) return finishApply(null);
                hyperhdrController.setLedDevice(true, { reason: job.trigger, caller: "automation" }, options, finishApply);
            });
        }

        if (needsClear) {
            return hyperhdrController.clearEffect({ reason: job.trigger, caller: "automation" }, options, function(clearErr) {
                if (clearErr) return done(clearErr);
                afterEffect();
            });
        }
        if (needsEffect) {
            return hyperhdrController.setEffect(targetEffect, { reason: job.trigger, caller: "automation" }, options, function(effectErr) {
                if (effectErr) return done(effectErr);
                afterEffect();
            });
        }
        afterEffect();
    }

    function finishExpectedOff() {
        state.lastAppliedState = false;
        state.lastAppliedProfile = profileKey;
        state.lastAppliedBrightness = null;
        state.lastAppliedEffect = null;
        state.physicalStateValid = true;
        state.hasAppliedInitialState = true;
        state.lastApplySkipped = true;
        state.lastApplyReason = "OFF_EXPECTED";
        diagnostics.automationSkipped({ trigger: job.trigger, reason: "OFF_EXPECTED", profile: profileKey });
        done(null);
    }

    if (result.state) applyOn();
    else applyOff();

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
            state.lastAppliedEffect = result.state ? targetEffect : null;
            state.physicalStateValid = true;
            state.lastAppliedAt = new Date().toISOString();
            state.lastApplySkipped = false;
            state.lastApplyReason = targetEffect ? "APPLIED_EFFECT" : (result.state ? "APPLIED_CAPTURE" : "APPLIED_OFF");
            state.hasAppliedInitialState = true;
            diagnostics.automationApplied({
                trigger: job.trigger,
                state: result.state,
                effect: targetEffect,
                brightness: useBrightness,
                reason: state.lastApplyReason
            });
        }
        done(err);
    }
}

function scheduleStartupEvaluation() {
    if (startupEvaluationPending || startupEvaluationTimer || state.hasAppliedInitialState) return;
    startupEvaluationPending = true;
    diagnostics.record("startup.wait", { delayMs: STABILITY_DELAY_MS, oneShot: true });
    startupEvaluationTimer = setTimeout(function () {
        startupEvaluationTimer = null;
        startupEvaluationPending = false;
        if (!state.hasAppliedInitialState) enqueueEvaluate("startup", false);
    }, STABILITY_DELAY_MS);
}

function scheduleWakeRecovery() {
    if (wakeRecoveryPending || wakeRecoveryTimer) return;
    wakeRecoveryPending = true;
    diagnostics.record("power.wake.wait", { delayMs: WAKE_START_DELAY_MS, oneShot: true });
    wakeRecoveryTimer = setTimeout(function () {
        wakeRecoveryTimer = null;
        wakeRecoveryPending = false;
        diagnostics.record("power.wake.apply", { source: source.getStableSource() });
        enqueueEvaluate("power-wake", false);
    }, WAKE_START_DELAY_MS);
}

function enqueueEvaluate(trigger, forceApply, callback) {
    if (previewPaused) {
        previewResumePending = true;
        diagnostics.automationSkipped({ trigger: trigger, reason: "PREVIEW_PAUSED" });
        if (callback) callback(null, null);
        return;
    }
    queue.push({
        trigger: trigger,
        source: source.getStableSource(),
        now: new Date(),
        forceApply: forceApply,
        callback: callback
    });
    state.queueDepth = queue.length;
    diagnostics.automationEnqueued({
        trigger: trigger,
        forceApply: !!forceApply,
        queueDepth: state.queueDepth,
        source: source.getStableSource()
    });
    processQueue();
}

function evaluateAndApplyNow(callback, forceApply) {
    enqueueEvaluate("diagnostic", !!forceApply, callback);
}

function pauseForPreview() {
    previewPaused = true;
    previewResumePending = false;
    queue = [];
    state.queueDepth = 0;
    diagnostics.record("automation.preview.pause", {});
}

function resumeAfterPreview(callback, forceApply) {
    var wasPaused = previewPaused;
    previewPaused = false;
    if (!wasPaused) {
        if (callback) callback(null);
        return;
    }
    var shouldEvaluate = previewResumePending || !!forceApply;
    diagnostics.record("automation.preview.resume", { pending: previewResumePending, forceApply: !!forceApply });
    previewResumePending = false;
    if (shouldEvaluate) enqueueEvaluate("preview-resume", !!forceApply, callback);
    else if (callback) callback(null);
}

function handlePowerSleep() {
    if (startupEvaluationTimer) {
        clearTimeout(startupEvaluationTimer);
        startupEvaluationTimer = null;
    }
    startupEvaluationPending = false;
    if (wakeRecoveryTimer) {
        clearTimeout(wakeRecoveryTimer);
        wakeRecoveryTimer = null;
    }
    wakeRecoveryPending = false;
    hyperhdrController.invalidateState();
    state.physicalStateValid = false;
    state.lastApplySkipped = true;
    state.lastApplyReason = "PHYSICAL_STATE_INVALIDATED";
}

function handlePowerWake() {
    if (startupEvaluationTimer) {
        clearTimeout(startupEvaluationTimer);
        startupEvaluationTimer = null;
    }
    startupEvaluationPending = false;
    state.physicalStateValid = false;
    scheduleWakeRecovery();
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
        if (wakeRecoveryPending) {
            // Keep the original ten-second wake deadline. The evaluation uses
            // the latest stable source when the one-shot timer fires.
            return;
        } else if (!state.hasAppliedInitialState) {
            scheduleStartupEvaluation();
        } else {
            enqueueEvaluate("source-change", false);
        }
    });
    
}

function executeSolarWake(callback) {
    // Schedule next
    var cfg = config.get().config;
    scheduler.reconcile(cfg, new Date(), function() {
        enqueueEvaluate("solar-wake", false, callback);
    });
}

module.exports = {
    init: init,
    getAutomationStatus: getAutomationStatus,
    evaluateAndApplyNow: evaluateAndApplyNow,
    handlePowerSleep: handlePowerSleep,
    handlePowerWake: handlePowerWake,
    executeSolarWake: executeSolarWake,
    pauseForPreview: pauseForPreview,
    resumeAfterPreview: resumeAfterPreview
};
