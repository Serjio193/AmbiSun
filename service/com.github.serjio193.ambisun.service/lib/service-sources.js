module.exports = function registerSources(service, deps) {
    var source = deps.source;
    var config = deps.config;
    var runtimeInfo = deps.runtimeInfo;
    var automation = deps.automation;
    var appIcon = deps.appIcon;

    service.register("getCurrentSource", function (message) {
        source.refreshForegroundSource(function () {
            var status = source.getSourceDetectorStatus();
            message.respond({
                returnValue: true,
                apiVersion: runtimeInfo.SERVICE_API_VERSION,
                source: status.stableSource,
                detector: {
                    mode: status.mode,
                    triggerConfigured: status.triggerConfigured,
                    lastChangeAt: status.lastChangeAt,
                    lastError: status.lastError
                }
            });
        });
    });

    service.register("getAutomationStatus", function (message) {
        message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, automation: automation.getAutomationStatus() });
    });

    service.register("evaluateAndApplyNow", function (message) {
        automation.evaluateAndApplyNow(function (err, result) {
            if (err) return message.respond({ returnValue: false, errorCode: "INTERNAL_ERROR", errorText: err.toString() });
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, decision: result });
        });
    });

    service.register("getSourceDetectorStatus", function (message) {
        message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION, status: source.getSourceDetectorStatus() });
    });

    service.register("sourceWake", function (message) {
        source.refreshForegroundSource(function () {
            message.respond({ returnValue: true, apiVersion: runtimeInfo.SERVICE_API_VERSION });
        });
    });

    var EXCLUDED_APP_IDS = [
        'airplay', 'amazon.alexapr', 'com.webos.app.home', 'com.webos.app.inputcommon',
        'com.webos.app.screensaver', 'com.webos.app.tvhotkey', 'com.webos.app.voice',
        'com.webos.app.welcomewizard', 'com.webos.ott.appcard', 'com.github.serjio193.ambisun',
        'com.webos.app.livetv', 'com.webos.app.livetvopapp', 'com.webos.app.inputcommon',
        'com.webos.app.cnbcplus', 'com.webos.channelplus', 'com.webos.app.photovideo', 'com.webos.app.music'
    ];

    service.register("getAvailableSources", function (message) {
        var currentSrc = source.getStableSource();
        var cfg = config.get();
        var overrides = cfg && cfg.config && cfg.config.overrides || {};
        var effectOverrides = cfg && cfg.config && cfg.config.effectOverrides || {};
        var hiddenSources = cfg && cfg.config && cfg.config.hiddenSources || {};
        var tvSources = [{ id: 'ATV', name: 'Эфир', type: 'tv', current: false }];
        var hdmiSources = [];
        var appSources = [];
        var errors = [];
        var doneCount = 0;
        var settled = false;
        var PROVIDER_TIMEOUT = 3000;

        function tryFinish() {
            doneCount++;
            if (doneCount < 2 || settled) return;
            settled = true;
            var all = [];
            var seen = {};
            tvSources.concat(hdmiSources, appSources).forEach(function (item) {
                if (!seen[item.id]) { all.push(item); seen[item.id] = true; }
            });
            [overrides, effectOverrides, hiddenSources].forEach(function (map) {
                Object.keys(map).forEach(function (id) {
                    if (!seen[id]) { all.push({ id: id, name: id, type: 'app', current: false }); seen[id] = true; }
                });
            });
            var compactCurrent = { type: 'unknown', id: null, name: null };
            if (currentSrc) {
                compactCurrent = { type: currentSrc.type || 'unknown', id: currentSrc.id || null, name: currentSrc.name || null };
                if (currentSrc.id) all.forEach(function (item) { item.current = item.id === currentSrc.id; });
            }
            message.respond({
                returnValue: true,
                apiVersion: runtimeInfo.SERVICE_API_VERSION,
                currentSource: compactCurrent,
                sources: all,
                partial: errors.length > 0,
                errors: errors
            });
        }

        var hdmiTimer = setTimeout(function () { errors.push({ provider: 'eim', code: 'TIMEOUT' }); tryFinish(); }, PROVIDER_TIMEOUT);
        service.call("luna://com.webos.service.eim/getAllInputStatus", {}, function (eimMsg) {
            clearTimeout(hdmiTimer);
            var response = eimMsg.payload || {};
            if (response.returnValue && Array.isArray(response.devices)) {
                response.devices.forEach(function (device) {
                    if (device.id && device.id.startsWith('HDMI_')) {
                        hdmiSources.push({ id: device.id, name: device.label || device.id, type: 'hdmi', current: false, connected: !!device.connected });
                    }
                });
            } else {
                errors.push({ provider: 'eim', code: 'FAILED' });
            }
            tryFinish();
        });

        var appsTimer = setTimeout(function () { errors.push({ provider: 'apps', code: 'TIMEOUT' }); tryFinish(); }, PROVIDER_TIMEOUT);
        service.call("luna://com.webos.applicationManager/listApps", {}, function (appsMsg) {
            clearTimeout(appsTimer);
            var response = appsMsg.payload || {};
            if (response.returnValue && Array.isArray(response.apps)) {
                response.apps.forEach(function (app) {
                    if (!app.visible || !app.id || !app.title || (app.class || {}).hidden || EXCLUDED_APP_IDS.indexOf(app.id) >= 0) return;
                    appSources.push({ id: app.id, name: app.title, type: 'app', icon: appIcon.toDataUri(app), current: false });
                });
                appSources.sort(function (a, b) { return a.name.localeCompare(b.name); });
            } else {
                errors.push({ provider: 'apps', code: 'FAILED' });
            }
            tryFinish();
        });
    });
};
