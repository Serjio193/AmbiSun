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
    lastAppliedAt: null,
    lastApplySkipped: false,
    lastApplyReason: null,
    hasAppliedInitialState: false,
    lastError: null,
    queueDepth: 0
};

var isColdStart = true;
var queue = [];
var isProcessing = false;

function getAutomationStatus() {
    return JSON.parse(JSON.stringify(state));
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
    
    // Duplicate suppression
    if (!job.forceApply && state.lastAppliedState === result.state) {
        state.lastApplySkipped = true;
        state.lastApplyReason = "DUPLICATE_STATE";
        return done(null);
    }
    
    // Apply
    hyperhdr.setLedDevice(result.state, function(err, ok) {
        if (!err) {
            state.lastAppliedState = result.state;
            state.lastAppliedAt = new Date().toISOString();
            state.lastApplySkipped = false;
            state.lastApplyReason = "APPLIED";
            state.hasAppliedInitialState = true;
        }
        done(err);
    });
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
        enqueueEvaluate("source-change", false);
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
