module.exports = function registerHyperhdr(service, deps) {
    var hyperhdr = deps.hyperhdr;
    var config = deps.config;
    var runtimeInfo = deps.runtimeInfo;
    var automation = deps.automation;

    function hyperhdrOptions() {
        var currentCfg = config.get().config;
        return (currentCfg.hyperhdr && currentCfg.hyperhdr.host)
            ? { host: currentCfg.hyperhdr.host, port: currentCfg.hyperhdr.port } : undefined;
    }

    service.register("getHyperhdrStatus", function (message) {
        var payload = message.payload || {};
        var currentCfg = config.get().config;
        var host = payload.host || (currentCfg.hyperhdr && currentCfg.hyperhdr.host) || "127.0.0.1";
        var port = payload.port || (currentCfg.hyperhdr && currentCfg.hyperhdr.port) || 8090;
        hyperhdr.getStatus(function (err, result) {
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
                hyperhdr: { reachable: true, response: result }
            });
        }, { host: host, port: port });
    });

    service.register("getHyperhdrEffects", function (message) {
        var options = hyperhdrOptions();
        hyperhdr.getEffects(function (err, effects) {
            if (err) {
                return message.respond({ returnValue: false, errorCode: err.code || "HYPERHDR_ERROR", errorText: err.message });
            }
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, effects: effects });
        }, options);
    });

    var previewTimer = null;
    var PREVIEW_PRIORITY = 32;
    service.register("previewHyperhdrEffect", function (message) {
        var payload = message.payload || {};
        var name = typeof payload.name === "string" ? payload.name.trim() : "";
        var hasDuration = payload.durationMs !== undefined && payload.durationMs !== null;
        var durationMs = hasDuration ? Number(payload.durationMs) : -1;
        var hasBrightness = payload.brightness !== undefined && payload.brightness !== null;
        var brightness = hasBrightness ? Number(payload.brightness) : null;
        if (!name || (hasDuration && !isFinite(durationMs)) ||
            (hasBrightness && (!isFinite(brightness) || Math.floor(brightness) !== brightness || brightness < 0 || brightness > 100))) {
            return message.respond({ returnValue: false, errorCode: "INVALID_REQUEST", errorText: "Effect name is required" });
        }
        if (hasDuration) durationMs = Math.max(1000, Math.min(15000, Math.floor(durationMs)));
        if (hasBrightness) brightness = Math.max(0, Math.min(100, Math.floor(brightness)));
        var options = hyperhdrOptions();
        if (previewTimer) clearTimeout(previewTimer);
        var setPreview = durationMs > 0
            ? hyperhdr.setEffectWithPriorityDuration.bind(null, name, PREVIEW_PRIORITY, durationMs)
            : hyperhdr.setEffectWithPriority.bind(null, name, PREVIEW_PRIORITY);
        setPreview(function (err) {
            if (err) return message.respond({ returnValue: false, errorCode: err.code || "HYPERHDR_ERROR", errorText: err.message });
            function enablePreview() {
                hyperhdr.setLedDevice(true, function (ledErr) {
                    if (ledErr) return message.respond({ returnValue: false, errorCode: ledErr.code || "HYPERHDR_ERROR", errorText: ledErr.message });
                    if (durationMs > 0) {
                        previewTimer = setTimeout(function () {
                            previewTimer = null;
                            hyperhdr.clearEffectWithPriority(PREVIEW_PRIORITY, function (clearErr) {
                                if (!clearErr) automation.evaluateAndApplyNow(function () {});
                            }, options);
                        }, durationMs);
                    }
                    message.respond({ returnValue: true, durationMs: durationMs > 0 ? durationMs : null, brightness: hasBrightness ? brightness : null });
                }, options);
            }
            if (hasBrightness) {
                hyperhdr.setBrightness(brightness, function (brightnessErr) {
                    if (brightnessErr) return message.respond({ returnValue: false, errorCode: brightnessErr.code || "HYPERHDR_ERROR", errorText: brightnessErr.message });
                    enablePreview();
                }, options);
            } else {
                enablePreview();
            }
        }, options);
    });

    service.register("clearHyperhdrPreview", function (message) {
        var options = hyperhdrOptions();
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = null;
        hyperhdr.clearEffectWithPriority(PREVIEW_PRIORITY, function (err) {
            if (err) return message.respond({ returnValue: false, errorCode: err.code || "HYPERHDR_ERROR", errorText: err.message });
            automation.evaluateAndApplyNow(function (applyErr) {
                message.respond({ returnValue: !applyErr, errorText: applyErr ? applyErr.message : undefined });
            });
        }, options);
    });

    service.register("setLedDevice", function (message) {
        var payload = message.payload || {};
        var state = payload.state;
        var options = hyperhdrOptions();
        hyperhdr.setLedDevice(state, function (err) {
            if (err) return message.respond({ returnValue: false, errorCode: err.code || "INTERNAL_ERROR", errorText: err.message });
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, state: state });
        }, options);
    });
};
