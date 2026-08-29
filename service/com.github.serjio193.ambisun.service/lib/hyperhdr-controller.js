var transport = require("./hyperhdr.js");
var diagnostics = require("./diagnostics.js");

var queue = [];
var processing = false;
var lastSentState = { ledDevice: null };
var pendingLedState = null;

function optionsFor(meta, options) {
    var result = Object.assign({}, options || {});
    meta = meta || {};
    result.reason = meta.reason || result.reason || "unknown";
    result.caller = meta.caller || result.caller || "unknown";
    result.diagnosticSource = result.diagnosticSource || result.caller;
    return result;
}

function processQueue() {
    if (processing || queue.length === 0) return;
    processing = true;
    var job = queue.shift();
    job.run(function (err, result) {
        processing = false;
        if (job.callback) job.callback(err, result);
        processQueue();
    });
}

function enqueue(run, callback) {
    queue.push({ run: run, callback: callback });
    processQueue();
}

function skipDuplicate(command, details, meta, callback) {
    diagnostics.duplicateSkip(command, details, meta);
    process.nextTick(function () {
        if (callback) callback(null, { skipped: true });
    });
}

function setLedDevice(state, meta, options, callback) {
    if (typeof meta === "function") {
        callback = meta;
        meta = { reason: "legacy-call", caller: "controller" };
    }
    if (typeof state !== "boolean") {
        return process.nextTick(function () {
            if (callback) callback(new Error("state must be a boolean"));
        });
    }

    meta = meta || {};
    if (lastSentState.ledDevice === state || pendingLedState === state) {
        return skipDuplicate("componentstate", { state: state }, meta, callback);
    }

    pendingLedState = state;
    enqueue(function (done) {
        transport.setLedDevice(state, function (err, result) {
            if (!err) lastSentState.ledDevice = state;
            if (pendingLedState === state) pendingLedState = null;
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function setEffect(name, meta, options, callback) {
    enqueue(function (done) {
        transport.setEffect(name, function (err, result) {
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function setEffectWithPriorityDuration(name, priority, duration, meta, options, callback) {
    enqueue(function (done) {
        transport.setEffectWithPriorityDuration(name, priority, duration, function (err, result) {
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function setEffectWithPriority(name, priority, meta, options, callback) {
    setEffectWithPriorityDuration(name, priority, -1, meta, options, callback);
}

function clearEffect(meta, options, callback) {
    enqueue(function (done) {
        transport.clearEffect(function (err, result) {
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function clearEffectWithPriority(priority, meta, options, callback) {
    enqueue(function (done) {
        transport.clearEffectWithPriority(priority, function (err, result) {
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function setBrightness(brightness, meta, options, callback) {
    enqueue(function (done) {
        transport.setBrightness(brightness, function (err, result) {
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function getStatus(meta, options, callback) {
    enqueue(function (done) {
        transport.getStatus(function (err, result) {
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function getEffects(meta, options, callback) {
    enqueue(function (done) {
        transport.getEffects(function (err, result) {
            done(err, result);
        }, optionsFor(meta, options));
    }, callback);
}

function invalidateState() {
    lastSentState.ledDevice = null;
    pendingLedState = null;
}

function getStatusSnapshot() {
    return {
        queueDepth: queue.length + (processing ? 1 : 0),
        processing: processing,
        lastSentState: { ledDevice: lastSentState.ledDevice }
    };
}

module.exports = {
    setLedDevice: setLedDevice,
    applyLedState: setLedDevice,
    setEffect: setEffect,
    setEffectWithPriority: setEffectWithPriority,
    setEffectWithPriorityDuration: setEffectWithPriorityDuration,
    clearEffect: clearEffect,
    clearEffectWithPriority: clearEffectWithPriority,
    setBrightness: setBrightness,
    getStatus: getStatus,
    getEffects: getEffects,
    invalidateState: invalidateState,
    getStatusSnapshot: getStatusSnapshot
};
