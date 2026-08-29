module.exports = function registerHyperhdr(service, deps) {
    var hyperhdr = deps.hyperhdr;
    var config = deps.config;
    var runtimeInfo = deps.runtimeInfo;
    var automation = deps.automation;
    var DISABLE_HYPERHDR_PREVIEW = false;

    function hyperhdrOptions(diagnosticSource) {
        var currentCfg = config.get().config;
        return (currentCfg.hyperhdr && currentCfg.hyperhdr.host)
            ? { host: currentCfg.hyperhdr.host, port: currentCfg.hyperhdr.port, diagnosticSource: diagnosticSource || "service" } : undefined;
    }

    service.register("getHyperhdrStatus", function (message) {
        var payload = message.payload || {};
        var currentCfg = config.get().config;
        var host = payload.host || (currentCfg.hyperhdr && currentCfg.hyperhdr.host) || "127.0.0.1";
        var port = payload.port || (currentCfg.hyperhdr && currentCfg.hyperhdr.port) || 8090;
        hyperhdr.getStatus({ reason: "manual-test", caller: "ui-test" }, { host: host, port: port, diagnosticSource: "health-check" }, function (err, result) {
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
        });
    });

    service.register("getHyperhdrEffects", function (message) {
        if (DISABLE_HYPERHDR_PREVIEW) {
            return message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, effects: [], disabledForDiagnostics: true });
        }
        var options = hyperhdrOptions("ui-effects");
        hyperhdr.getEffects({ reason: "manual-effects", caller: "ui-effects" }, options, function (err, effects) {
            if (err) {
                return message.respond({ returnValue: false, errorCode: err.code || "HYPERHDR_ERROR", errorText: err.message });
            }
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, effects: effects });
        });
    });

    var previewTimer = null;
    var previewQueue = null;
    var previewRunning = false;
    var previewActive = false;
    var clearRequested = false;
    var clearWaiters = [];
    var brightnessPreviewLedEnabled = false;
    var PREVIEW_PRIORITY = 64;

    function respondSuperseded(job) {
        if (job && job.message) {
            job.message.respond({ returnValue: true, superseded: true, durationMs: null, brightness: null });
        }
    }

    function runClearQueue() {
        if (previewRunning || !clearRequested) return;
        clearRequested = false;
        previewRunning = true;
        hyperhdr.clearEffectWithPriority(PREVIEW_PRIORITY, { reason: "preview-clear", caller: "preview" }, hyperhdrOptions("ui-control"), function (clearErr) {
            function finish(err, forceApply) {
                var waiters = clearWaiters.slice();
                clearWaiters = [];
                function complete() {
                    previewRunning = false;
                    waiters.forEach(function (waiter) { waiter(err); });
                    runClearQueue();
                    runPreviewQueue();
                }
                if (!previewActive) return complete();
                previewActive = false;
                brightnessPreviewLedEnabled = false;
                automation.resumeAfterPreview(function (resumeErr) {
                    complete(err || resumeErr || null);
                }, forceApply);
            }
            if (clearErr) return finish(clearErr);
            // The preview explicitly enables HyperHDR, so the cached automation
            // state is no longer authoritative. Resume with one forced restore
            // instead of evaluating while preview is still paused.
            finish(null, true);
        });
    }

    function enqueueClear(waiter) {
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = null;
        if (previewQueue) {
            respondSuperseded(previewQueue);
            previewQueue = null;
        }
        clearRequested = true;
        if (typeof waiter === "function") clearWaiters.push(waiter);
        runClearQueue();
    }

    function runPreviewQueue() {
        if (previewRunning || clearRequested || !previewQueue) return;
        var job = previewQueue;
        previewQueue = null;
        previewRunning = true;
        var options = hyperhdrOptions("ui-preview");
        var setPreview = job.durationMs > 0
            ? function (callback) { hyperhdr.setEffectWithPriorityDuration(job.name, PREVIEW_PRIORITY, job.durationMs, { reason: "preview-effect", caller: "preview" }, options, callback); }
            : function (callback) { hyperhdr.setEffectWithPriority(job.name, PREVIEW_PRIORITY, { reason: "preview-effect", caller: "preview" }, options, callback); };

        function finish(response) {
            function complete() {
                previewRunning = false;
                job.message.respond(response);
                runClearQueue();
                runPreviewQueue();
            }
            if (response.returnValue !== false || !previewActive || previewQueue || clearRequested) {
                return complete();
            }
            previewActive = false;
            automation.resumeAfterPreview(function () { complete(); });
        }

        setPreview(function (err) {
            if (err) return finish({ returnValue: false, errorCode: err.code || "HYPERHDR_ERROR", errorText: err.message });
            function enablePreview() {
                hyperhdr.setLedDevice(true, { reason: "preview-effect", caller: "preview" }, options, function (ledErr) {
                    if (ledErr) return finish({ returnValue: false, errorCode: ledErr.code || "HYPERHDR_ERROR", errorText: ledErr.message });
                    if (job.durationMs > 0) {
                        previewTimer = setTimeout(function () {
                            previewTimer = null;
                            enqueueClear();
                        }, job.durationMs);
                    }
                    finish({ returnValue: true, durationMs: job.durationMs > 0 ? job.durationMs : null, brightness: job.brightness });
                });
            }
            if (job.brightness !== null) {
                hyperhdr.setBrightness(job.brightness, { reason: "preview-effect", caller: "preview" }, options, function (brightnessErr) {
                    if (brightnessErr) return finish({ returnValue: false, errorCode: brightnessErr.code || "HYPERHDR_ERROR", errorText: brightnessErr.message });
                    enablePreview();
                });
            } else {
                enablePreview();
            }
        }, options);
    }

    service.register("previewHyperhdrEffect", function (message) {
        if (DISABLE_HYPERHDR_PREVIEW) {
            return message.respond({ returnValue: true, disabledForDiagnostics: true });
        }
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
        if (!previewActive) {
            previewActive = true;
            automation.pauseForPreview();
        }
        if (previewQueue) respondSuperseded(previewQueue);
        previewQueue = {
            message: message,
            name: name,
            durationMs: durationMs,
            brightness: hasBrightness ? brightness : null
        };
        runClearQueue();
        runPreviewQueue();
    });

    service.register("previewHyperhdrBrightness", function (message) {
        var payload = message.payload || {};
        var brightness = Number(payload.brightness);
        if (!isFinite(brightness) || Math.floor(brightness) !== brightness || brightness < 0 || brightness > 100) {
            return message.respond({ returnValue: false, errorCode: "INVALID_REQUEST", errorText: "Brightness must be an integer between 0 and 100" });
        }
        if (!previewActive) {
            previewActive = true;
            automation.pauseForPreview();
        }
        var options = hyperhdrOptions("ui-brightness-preview");
        hyperhdr.setBrightness(brightness, { reason: "preview-brightness", caller: "preview" }, options, function (brightnessErr) {
            if (brightnessErr) {
                return message.respond({ returnValue: false, errorCode: brightnessErr.code || "HYPERHDR_ERROR", errorText: brightnessErr.message });
            }
            if (brightnessPreviewLedEnabled) {
                return message.respond({ returnValue: true, brightness: brightness });
            }
            hyperhdr.setLedDevice(true, { reason: "preview-brightness", caller: "preview" }, options, function (ledErr) {
                if (ledErr) {
                    return message.respond({ returnValue: false, errorCode: ledErr.code || "HYPERHDR_ERROR", errorText: ledErr.message });
                }
                brightnessPreviewLedEnabled = true;
                message.respond({ returnValue: true, brightness: brightness });
            });
        });
    });

    service.register("clearHyperhdrPreview", function (message) {
        if (DISABLE_HYPERHDR_PREVIEW) {
            return message.respond({ returnValue: true, disabledForDiagnostics: true });
        }
        enqueueClear(function (err) {
            if (err) return message.respond({ returnValue: false, errorCode: err.code || "HYPERHDR_ERROR", errorText: err.message });
            message.respond({ returnValue: true });
        });
    });

    service.register("setLedDevice", function (message) {
        var payload = message.payload || {};
        var state = payload.state;
        var options = hyperhdrOptions();
        hyperhdr.setLedDevice(state, { reason: "manual-set-led", caller: "ui-manual" }, options, function (err) {
            if (err) return message.respond({ returnValue: false, errorCode: err.code || "INTERNAL_ERROR", errorText: err.message });
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, state: state });
        });
    });
};
