var MAX_EVENTS = 240;

var events = [];
var counters = {
    rpcTotal: 0,
    rpcLastMinute: 0,
    rpcCompleted: 0,
    rpcErrors: 0,
    rpcPending: 0,
    rpcMaxPending: 0,
    componentStateCount: 0,
    serverInfoCount: 0,
    effectCount: 0,
    duplicateSkipCount: 0,
    sourceEvents: 0,
    rpcByCommand: {},
    rpcBySource: {},
    rpcTimingByCommand: {},
    rpcErrorsByCode: {},
    sourceRefreshes: 0,
    sourceActivityCallbacks: 0,
    sourceChanges: 0,
    automationEnqueued: 0,
    automationEvaluated: 0,
    automationSkipped: 0,
    automationApplied: 0,
    automationErrors: 0
};

var startedAt = new Date().toISOString();
var startedAtMs = Date.now();
var previousCpuUsage = null;
var rpcSentAt = [];
var rpcSequence = 0;
var sourceEventSequence = 0;
var instanceId = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function safeString(value, fallback) {
    if (value === undefined || value === null) return fallback || null;
    return String(value).slice(0, 160);
}

function cleanValue(value, depth) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return value.slice(0, 160);
    if (typeof value !== "object") return value;
    if (depth >= 3) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 12).map(function (item) { return cleanValue(item, depth + 1); });
    var result = {};
    Object.keys(value).slice(0, 24).forEach(function (key) {
        if (key === "raw") return;
        result[key] = cleanValue(value[key], depth + 1);
    });
    return result;
}

function record(type, data) {
    var event = {
        at: new Date().toISOString(),
        type: type,
        data: cleanValue(data || {}, 0)
    };
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    return event;
}

function rpcSummary(payload, options) {
    payload = payload || {};
    options = options || {};
    var summary = {
        command: safeString(payload.command, "unknown"),
        source: safeString(options.diagnosticSource, "unknown"),
        host: safeString(options.host, "127.0.0.1"),
        port: options.port || 8090
    };
    if (payload.subcommand) summary.subcommand = safeString(payload.subcommand);
    if (payload.priority !== undefined) summary.priority = payload.priority;
    if (payload.duration !== undefined) summary.duration = payload.duration;
    if (payload.effect && payload.effect.name) summary.effect = safeString(payload.effect.name);
    if (payload.componentstate) {
        summary.component = safeString(payload.componentstate.component);
        summary.state = payload.componentstate.state === true;
    }
    if (payload.adjustment && payload.adjustment.brightness !== undefined) {
        summary.brightness = payload.adjustment.brightness;
    }
    summary.reason = safeString(options.reason, "unknown");
    summary.caller = safeString(options.caller, "unknown");
    return summary;
}

function beginRpc(payload, options) {
    var summary = rpcSummary(payload, options);
    var key = summary.command;
    var sourceKey = summary.source;
    counters.rpcTotal++;
    rpcSequence++;
    rpcSentAt.push(Date.now());
    counters.rpcLastMinute = rpcSentAt.length;
    counters.rpcByCommand[key] = (counters.rpcByCommand[key] || 0) + 1;
    if (key === "componentstate") counters.componentStateCount++;
    if (key === "serverinfo") counters.serverInfoCount++;
    if (key === "effect" || key === "clear") counters.effectCount++;
    counters.rpcBySource[sourceKey] = (counters.rpcBySource[sourceKey] || 0) + 1;
    counters.rpcPending++;
    if (counters.rpcPending > counters.rpcMaxPending) counters.rpcMaxPending = counters.rpcPending;
    var started = Date.now();
    record("hyperhdr.rpc.start", summary);
    var detail = "";
    if (summary.state !== undefined) detail += " state=" + summary.state;
    if (summary.effect) detail += " effect=" + summary.effect;
    if (summary.brightness !== undefined) detail += " brightness=" + summary.brightness;
    if (summary.priority !== undefined) detail += " priority=" + summary.priority;
    console.log("[HYPERHDR RPC #" + rpcSequence + "] time=" + new Date(started).toISOString() +
        " command=" + summary.command + detail + " reason=" + summary.reason + " caller=" + summary.caller);
    return { started: started, summary: summary };
}

function finishRpc(token, err, result) {
    if (!token) return;
    counters.rpcPending = Math.max(0, counters.rpcPending - 1);
    counters.rpcCompleted++;
    var durationMs = Date.now() - token.started;
    var timing = counters.rpcTimingByCommand[token.summary.command] || {
        count: 0,
        totalMs: 0,
        maxMs: 0
    };
    timing.count++;
    timing.totalMs += durationMs;
    timing.maxMs = Math.max(timing.maxMs, durationMs);
    counters.rpcTimingByCommand[token.summary.command] = timing;
    var data = {
        command: token.summary.command,
        source: token.summary.source,
        durationMs: durationMs,
        ok: !err
    };
    if (err) {
        counters.rpcErrors++;
        var code = safeString(err.code, "ERROR");
        counters.rpcErrorsByCode[code] = (counters.rpcErrorsByCode[code] || 0) + 1;
        data.errorCode = code;
        data.error = safeString(err.message, "HyperHDR request failed");
    } else if (result && result.success === false) {
        data.responseSuccess = false;
    }
    record("hyperhdr.rpc.finish", data);
}

function sourceRefresh(data) {
    counters.sourceRefreshes++;
    record("source.refresh", data);
}

function sourceActivity(data) {
    counters.sourceActivityCallbacks++;
    record("source.activity", data);
}

function sourceChange(data) {
    counters.sourceChanges++;
    record("source.change", data);
}

function duplicateSkip(command, data, meta) {
    counters.duplicateSkipCount++;
    var details = Object.assign({}, data || {}, {
        command: command,
        reason: "duplicate-state",
        caller: meta && meta.caller ? meta.caller : "unknown"
    });
    record("hyperhdr.rpc.skip", details);
    var stateText = details.state !== undefined ? " state=" + details.state : "";
    console.log("[HYPERHDR SKIP] command=" + command + stateText + " reason=duplicate-state caller=" + details.caller);
}

function sourceEvent(data) {
    counters.sourceEvents++;
    sourceEventSequence++;
    record("source.event", Object.assign({ eventNumber: sourceEventSequence }, data || {}));
}

function automationEnqueued(data) {
    counters.automationEnqueued++;
    record("automation.enqueue", data);
}

function automationEvaluated(data) {
    counters.automationEvaluated++;
    record("automation.evaluate", data);
}

function automationSkipped(data) {
    counters.automationSkipped++;
    record("automation.skip", data);
}

function automationApplied(data) {
    counters.automationApplied++;
    record("automation.apply", data);
}

function automationError(data) {
    counters.automationErrors++;
    record("automation.error", data);
}

function processSnapshot() {
    var result = {
        uptimeSec: Math.round(process.uptime() * 10) / 10,
        memory: null,
        cpuSincePreviousReadMicros: null
    };
    if (typeof process.memoryUsage === "function") result.memory = process.memoryUsage();
    if (typeof process.cpuUsage === "function") {
        var usage = process.cpuUsage(previousCpuUsage || undefined);
        previousCpuUsage = process.cpuUsage();
        result.cpuSincePreviousReadMicros = usage;
    }
    return result;
}

function getSnapshot() {
    var cutoff = Date.now() - 60000;
    rpcSentAt = rpcSentAt.filter(function (at) { return at >= cutoff; });
    counters.rpcLastMinute = rpcSentAt.length;
    return {
        enabled: true,
        instanceId: instanceId,
        startedAt: startedAt,
        elapsedSec: Math.round((Date.now() - startedAtMs) / 100) / 10,
        process: processSnapshot(),
        counters: clone(counters),
        recentEvents: clone(events)
    };
}

function setInstanceId(value) {
    instanceId = safeString(value, null);
}

function reset() {
    events = [];
    Object.keys(counters).forEach(function (key) {
        if (typeof counters[key] === "object") counters[key] = {};
        else counters[key] = 0;
    });
    startedAt = new Date().toISOString();
    startedAtMs = Date.now();
    previousCpuUsage = null;
    rpcSentAt = [];
    rpcSequence = 0;
    sourceEventSequence = 0;
    record("diagnostics.reset", {});
}

module.exports = {
    record: record,
    beginRpc: beginRpc,
    finishRpc: finishRpc,
    duplicateSkip: duplicateSkip,
    sourceEvent: sourceEvent,
    setInstanceId: setInstanceId,
    sourceRefresh: sourceRefresh,
    sourceActivity: sourceActivity,
    sourceChange: sourceChange,
    automationEnqueued: automationEnqueued,
    automationEvaluated: automationEvaluated,
    automationSkipped: automationSkipped,
    automationApplied: automationApplied,
    automationError: automationError,
    getSnapshot: getSnapshot,
    reset: reset
};
