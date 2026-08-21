var storage = require('./storage');

var DEFAULT_CONFIG = {
    enabled: true,
    defaultRule: "sun",
    defaultEffect: null,
    sunsetOffset: 30,
    sunriseOffset: 0,
    overrides: {},
    effectOverrides: {},
    hiddenSources: {},
    location: null,
    hyperhdr: {
        host: "127.0.0.1",
        port: 8090
    }
};

// Global committed state
var state = {
    schemaVersion: 1,
    revision: 1,
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG))
};

// Lifecycle
var initStatus = "UNINITIALIZED"; // UNINITIALIZED, INITIALIZING, READY
var readyCallbacks = [];

function whenReady(callback) {
    if (initStatus === "READY") {
        process.nextTick(function() { callback(); });
    } else {
        readyCallbacks.push(callback);
    }
}

// Operation Queue
var operationQueue = [];
var isProcessing = false;

function isPlainObject(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function isValidRule(rule) {
    return rule === "sun" || rule === "on" || rule === "off";
}

function isValidOffset(offset) {
    if (typeof offset !== "number" || isNaN(offset) || Math.floor(offset) !== offset) return false;
    if (offset < -360 || offset > 360) return false;
    if (offset % 5 !== 0) return false;
    return true;
}

function validateHyperhdr(hdr) {
    if (hdr === null || hdr === undefined) return "hyperhdr is required";
    if (!isPlainObject(hdr)) return "hyperhdr must be a plain object";

    var allowedKeys = ["host", "port"];
    for (var key in hdr) {
        if (Object.prototype.hasOwnProperty.call(hdr, key)) {
            if (allowedKeys.indexOf(key) === -1) return "Unknown hyperhdr field: " + key;
        }
    }

    if (typeof hdr.host !== "string" || hdr.host.trim() === "") {
        return "hyperhdr.host must be a non-empty string";
    }
    var trimmedHost = hdr.host.trim();
    if (/^https?:\/\//i.test(trimmedHost)) {
        return "hyperhdr.host must not contain protocol (http:// or https://)";
    }
    if (trimmedHost.indexOf('/') !== -1) {
        return "hyperhdr.host must not contain URL path";
    }
    if (/\s/.test(trimmedHost)) {
        return "hyperhdr.host must not contain whitespace";
    }

    if (typeof hdr.port !== "number" || isNaN(hdr.port) || Math.floor(hdr.port) !== hdr.port || hdr.port < 1 || hdr.port > 65535) {
        return "hyperhdr.port must be an integer between 1 and 65535";
    }

    return null;
}

function migrateDocument(doc) {
    if (!doc || !isPlainObject(doc)) return doc;
    if (!doc.config || !isPlainObject(doc.config)) return doc;

    if (!doc.config.hyperhdr) {
        doc.config.hyperhdr = {
            host: "127.0.0.1",
            port: 8090
        };
    }
    if (!doc.config.effectOverrides) doc.config.effectOverrides = {};
    if (!doc.config.hiddenSources) doc.config.hiddenSources = {};
    if (!Object.prototype.hasOwnProperty.call(doc.config, "defaultEffect")) doc.config.defaultEffect = null;
    return doc;
}

function validateLocation(loc) {
    if (loc === null) return null;
    if (!isPlainObject(loc)) return "location must be a plain object or null";
    
    var allowedKeys = ["country", "countryCode", "city", "lat", "lon", "timezone"];
    for (var key in loc) {
        if (Object.prototype.hasOwnProperty.call(loc, key)) {
            if (allowedKeys.indexOf(key) === -1) return "Unknown location field: " + key;
        }
    }
    
    if (typeof loc.country !== "string" || loc.country.trim() === "") return "location.country must be a non-empty string";
    if (typeof loc.countryCode !== "string" || loc.countryCode.trim() === "") return "location.countryCode must be a non-empty string";
    if (typeof loc.city !== "string" || loc.city.trim() === "") return "location.city must be a non-empty string";
    
    if (typeof loc.lat !== "number" || !isFinite(loc.lat) || loc.lat < -90 || loc.lat > 90) return "location.lat must be a number between -90 and 90";
    if (typeof loc.lon !== "number" || !isFinite(loc.lon) || loc.lon < -180 || loc.lon > 180) return "location.lon must be a number between -180 and 180";
    
    if (typeof loc.timezone !== "string" || loc.timezone.trim() === "") return "location.timezone must be a non-empty string";

    return null;
}

function validateDocument(doc) {
    if (!isPlainObject(doc)) return "Document is not a plain object";
    if (doc.schemaVersion !== 1) return "Unsupported schemaVersion";
    if (typeof doc.revision !== "number" || Math.floor(doc.revision) !== doc.revision || doc.revision < 1) return "Invalid revision";
    if (!isPlainObject(doc.config)) return "config is not a plain object";

    var cfg = doc.config;
    var allowedKeys = ["enabled", "defaultRule", "defaultEffect", "sunsetOffset", "sunriseOffset", "overrides", "effectOverrides", "hiddenSources", "location", "hyperhdr"];
    for (var key in cfg) {
        if (Object.prototype.hasOwnProperty.call(cfg, key)) {
            if (allowedKeys.indexOf(key) === -1) return "Unknown config field: " + key;
        }
    }

    if (typeof cfg.enabled !== "boolean") return "enabled must be a boolean";
    if (!isValidRule(cfg.defaultRule)) return "defaultRule must be 'sun', 'on', or 'off'";
    if (cfg.defaultEffect !== null && (typeof cfg.defaultEffect !== "string" || cfg.defaultEffect.trim() === "")) return "defaultEffect must be an effect name or null";
    if (!isValidOffset(cfg.sunsetOffset)) return "sunsetOffset must be valid integer multiple of 5 in [-360,360]";
    if (!isValidOffset(cfg.sunriseOffset)) return "sunriseOffset must be valid integer multiple of 5 in [-360,360]";
    
    if (!isPlainObject(cfg.overrides)) return "overrides must be a plain object";
    for (var k in cfg.overrides) {
        if (Object.prototype.hasOwnProperty.call(cfg.overrides, k)) {
            if (!isValidRule(cfg.overrides[k])) return "override value must be 'sun', 'on', or 'off'";
        }
    }

    if (!isPlainObject(cfg.effectOverrides)) return "effectOverrides must be a plain object";
    for (var effectId in cfg.effectOverrides) {
        if (!Object.prototype.hasOwnProperty.call(cfg.effectOverrides, effectId)) continue;
        var effectRule = cfg.effectOverrides[effectId];
        if (!isPlainObject(effectRule)) return "effect override must be a plain object";
        if (effectRule.mode !== "capture" && effectRule.mode !== "effect") return "effect override mode must be 'capture' or 'effect'";
        if (effectRule.mode === "effect" && (typeof effectRule.name !== "string" || effectRule.name.trim() === "")) {
            return "effect override name is required";
        }
    }

    if (!isPlainObject(cfg.hiddenSources)) return "hiddenSources must be a plain object";
    for (var hiddenId in cfg.hiddenSources) {
        if (Object.prototype.hasOwnProperty.call(cfg.hiddenSources, hiddenId) && typeof cfg.hiddenSources[hiddenId] !== "boolean") {
            return "hidden source value must be boolean";
        }
    }

    var locErr = validateLocation(cfg.location);
    if (locErr) return locErr;

    var hdrErr = validateHyperhdr(cfg.hyperhdr);
    if (hdrErr) return hdrErr;

    return null;
}

function validatePatch(patch) {
    if (!isPlainObject(patch)) return "Patch must be a plain object";
    if (Object.keys(patch).length === 0) return "Patch is empty";

    var allowedKeys = ["enabled", "defaultRule", "defaultEffect", "sunsetOffset", "sunriseOffset", "overrides", "effectOverrides", "hiddenSources", "location", "hyperhdr"];
    for (var key in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
            if (allowedKeys.indexOf(key) === -1) return "Unknown field: " + key;
        }
    }
    
    if (patch.hasOwnProperty("enabled") && typeof patch.enabled !== "boolean") return "enabled must be a boolean";
    if (patch.hasOwnProperty("defaultRule") && !isValidRule(patch.defaultRule)) return "defaultRule must be 'sun', 'on', or 'off'";
    if (patch.hasOwnProperty("defaultEffect") && patch.defaultEffect !== null && (typeof patch.defaultEffect !== "string" || patch.defaultEffect.trim() === "")) return "defaultEffect must be an effect name or null";
    if (patch.hasOwnProperty("sunsetOffset") && !isValidOffset(patch.sunsetOffset)) return "sunsetOffset must be an integer between -360 and 360, multiple of 5";
    if (patch.hasOwnProperty("sunriseOffset") && !isValidOffset(patch.sunriseOffset)) return "sunriseOffset must be an integer between -360 and 360, multiple of 5";
    
    if (patch.hasOwnProperty("overrides")) {
        if (!isPlainObject(patch.overrides)) return "overrides must be a plain object";
        for (var k in patch.overrides) {
            if (Object.prototype.hasOwnProperty.call(patch.overrides, k)) {
                if (!isValidRule(patch.overrides[k])) return "override value for " + k + " must be 'sun', 'on', or 'off'";
            }
        }
    }

    if (patch.hasOwnProperty("effectOverrides")) {
        if (!isPlainObject(patch.effectOverrides)) return "effectOverrides must be a plain object";
        for (var effectId in patch.effectOverrides) {
            if (!Object.prototype.hasOwnProperty.call(patch.effectOverrides, effectId)) continue;
            var effectRule = patch.effectOverrides[effectId];
            if (!isPlainObject(effectRule)) return "effect override must be a plain object";
            if (effectRule.mode !== "capture" && effectRule.mode !== "effect") return "effect override mode must be 'capture' or 'effect'";
            if (effectRule.mode === "effect" && (typeof effectRule.name !== "string" || effectRule.name.trim() === "")) return "effect override name is required";
        }
    }

    if (patch.hasOwnProperty("hiddenSources")) {
        if (!isPlainObject(patch.hiddenSources)) return "hiddenSources must be a plain object";
        for (var hiddenId in patch.hiddenSources) {
            if (Object.prototype.hasOwnProperty.call(patch.hiddenSources, hiddenId) && typeof patch.hiddenSources[hiddenId] !== "boolean") return "hidden source value must be boolean";
        }
    }

    if (patch.hasOwnProperty("location")) {
        var locErr = validateLocation(patch.location);
        if (locErr) return locErr;
    }

    if (patch.hasOwnProperty("hyperhdr")) {
        var hdrErr = validateHyperhdr(patch.hyperhdr);
        if (hdrErr) return hdrErr;
    }
    
    return null;
}

function processNextJob() {
    if (initStatus !== "READY") return;
    if (isProcessing) return;
    if (operationQueue.length === 0) return;
    
    isProcessing = true;
    var job = operationQueue.shift();

    if (job.type === "READ") {
        job.callback(null, get());
        isProcessing = false;
        processNextJob();
    } else if (job.type === "UPDATE") {
        var expectedRevision = job.expectedRevision;
        var patch = job.patch;

        if (typeof expectedRevision !== "number" || Math.floor(expectedRevision) !== expectedRevision || expectedRevision < 1) {
            var errType = new Error("expectedRevision must be an integer >= 1");
            errType.code = "INVALID_REQUEST";
            return finishJob(errType, null);
        }

        if (expectedRevision !== state.revision) {
            var errConf = new Error("REVISION_CONFLICT");
            errConf.code = "REVISION_CONFLICT";
            errConf.revision = state.revision;
            return finishJob(errConf, null);
        }

        var validationError = validatePatch(patch);
        if (validationError) {
            var errValid = new Error(validationError);
            errValid.code = "CONFIG_INVALID";
            return finishJob(errValid, null);
        }

        // Create deep clone candidate
        var candidate = JSON.parse(JSON.stringify(state));
        
        // Apply patch to candidate
        for (var key in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                candidate.config[key] = patch[key];
            }
        }
        candidate.revision = state.revision + 1;

        executeSaveTransaction(candidate, job.callback);

    } else if (job.type === "RESET") {
        var candidateReset = {
            schemaVersion: 1,
            revision: state.revision + 1,
            config: JSON.parse(JSON.stringify(DEFAULT_CONFIG))
        };
        executeSaveTransaction(candidateReset, job.callback);
    }

    function finishJob(err, result) {
        job.callback(err, result);
        isProcessing = false;
        processNextJob();
    }

    function executeSaveTransaction(candidate, callback) {
        storage.save(candidate, function(err) {
            if (err) {
                // Storage failed. Committed state remains unchanged.
                var storeErr = new Error("STORAGE_ERROR: " + err.message);
                storeErr.code = "STORAGE_ERROR";
                return finishJob(storeErr, null);
            }
            
            // Storage succeeded. Commit candidate to memory.
            state = candidate;
            var currentConfig = get();
            commitListeners.forEach(function(cb) {
                try { cb(currentConfig); } catch (e) { console.error("config listener error", e); }
            });
            finishJob(null, currentConfig);
        });
    }
}

function init(callback) {
    if (initStatus === "INITIALIZING" || initStatus === "READY") {
        if (callback) whenReady(callback);
        return;
    }
    initStatus = "INITIALIZING";

    storage.load(function(err, data) {
        if (err) {
            if (err.code === "ENOENT") {
                // Normal first-run
                console.log("No config file found (first run), using defaults.");
            } else {
                console.error("Storage load error or malformed JSON, using defaults:", err);
            }
        } else {
            var migrated = migrateDocument(data);
            var docError = validateDocument(migrated);
            if (docError) {
                console.error("Structurally invalid config file, falling back to defaults:", docError);
            } else {
                state = migrated;
            }
        }
        initStatus = "READY";
        
        var callbacksToRun = readyCallbacks.slice();
        readyCallbacks = [];
        for (var i = 0; i < callbacksToRun.length; i++) {
            callbacksToRun[i]();
        }
        
        processNextJob();
        
        if (callback) callback();
    });
}

function get() {
    return JSON.parse(JSON.stringify(state));
}

function read(callback) {
    operationQueue.push({
        type: "READ",
        callback: callback
    });
    processNextJob();
}

function update(patch, expectedRevision, callback) {
    operationQueue.push({
        type: "UPDATE",
        patch: patch,
        expectedRevision: expectedRevision,
        callback: callback
    });
    processNextJob();
}

function reset(callback) {
    operationQueue.push({
        type: "RESET",
        callback: callback
    });
    processNextJob();
}

function isInitialized() {
    return initStatus === "READY";
}

var commitListeners = [];

function onCommit(callback) {
    commitListeners.push(callback);
}

module.exports = {
    init: init,
    get: get,
    read: read,
    update: update,
    reset: reset,
    isInitialized: isInitialized,
    onCommit: onCommit,
    _validateDocument: validateDocument, // exposed for testing
    _validatePatch: validatePatch,       // exposed for testing
    _migrateDocument: migrateDocument    // exposed for testing
};
