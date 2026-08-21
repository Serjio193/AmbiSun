var http = require('http');

var DEFAULT_HOST = '127.0.0.1';
var DEFAULT_PORT = 8090;
var DEFAULT_PATH = '/json-rpc?request';
var TIMEOUT_MS = 3000;
var MAX_RESPONSE_SIZE = 1048576; // 1 MB

function rpc(payload, callback, optionsOverride) {
    if (typeof callback !== 'function') {
        throw new Error("Callback must be a function");
    }

    var payloadString;
    try {
        payloadString = JSON.stringify(payload);
    } catch (e) {
        var errStr = new Error("Failed to stringify payload");
        errStr.code = "INTERNAL_ERROR";
        return process.nextTick(function() { callback(errStr, null); });
    }

    var opts = optionsOverride || {};
    var reqOptions = {
        hostname: opts.host || DEFAULT_HOST,
        port: opts.port || DEFAULT_PORT,
        path: opts.path || DEFAULT_PATH,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payloadString)
        },
        timeout: opts.timeout || TIMEOUT_MS
    };

    var req = http.request(reqOptions, function(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
            var errHttp = new Error("HTTP Status " + res.statusCode);
            errHttp.code = "HYPERHDR_HTTP_ERROR";
            errHttp.statusCode = res.statusCode;
            res.resume(); // consume response body to free up memory
            return finishSafe(errHttp, null);
        }

        var chunks = [];
        var totalLength = 0;

        res.on('data', function(chunk) {
            totalLength += chunk.length;
            if (totalLength > MAX_RESPONSE_SIZE) {
                res.destroy();
                var errSize = new Error("Response body exceeded maximum size of " + MAX_RESPONSE_SIZE + " bytes");
                errSize.code = "INTERNAL_ERROR";
                finishSafe(errSize, null);
            } else {
                chunks.push(chunk);
            }
        });

        res.on('end', function() {
            if (totalLength > MAX_RESPONSE_SIZE) {
                return; // Already handled in 'data'
            }

            var body = Buffer.concat(chunks).toString('utf8');
            var jsonResponse;
            try {
                jsonResponse = JSON.parse(body);
            } catch (e) {
                var errJson = new Error("Invalid JSON response");
                errJson.code = "HYPERHDR_INVALID_JSON";
                return finishSafe(errJson, null);
            }

            // Check for application-level HyperHDR error
            if (jsonResponse && jsonResponse.success === false) {
                var errApp = new Error(jsonResponse.error || "HyperHDR returned an error");
                errApp.code = "HYPERHDR_ERROR";
                errApp.hyperhdrResponse = jsonResponse;
                return finishSafe(errApp, null);
            }

            finishSafe(null, jsonResponse);
        });
    });

    var finished = false;
    function finishSafe(err, result) {
        if (finished) return;
        finished = true;
        callback(err, result);
    }

    req.on('timeout', function() {
        req.destroy();
        var errTimeout = new Error("Request timed out after " + reqOptions.timeout + "ms");
        errTimeout.code = "HYPERHDR_TIMEOUT";
        finishSafe(errTimeout, null);
    });

    req.on('error', function(err) {
        if (finished) return;
        
        var wrapperErr = new Error("Network error: " + err.message);
        wrapperErr.code = "HYPERHDR_UNREACHABLE";
        wrapperErr.originalError = err;
        
        if (err.code === 'ECONNREFUSED') {
            wrapperErr.code = "HYPERHDR_UNREACHABLE";
        } else if (err.code === 'ECONNRESET') {
            wrapperErr.code = "HYPERHDR_UNREACHABLE";
        }
        
        finishSafe(wrapperErr, null);
    });

    req.write(payloadString);
    req.end();
}

function getStatus(callback, optionsOverride) {
    rpc({ command: "serverinfo" }, callback, optionsOverride);
}

function setLedDevice(state, callback, optionsOverride) {
    if (typeof state !== 'boolean') {
        var err = new Error("state must be a boolean");
        err.code = "INVALID_REQUEST";
        return process.nextTick(function() { callback(err, null); });
    }

    var payload = {
        command: "componentstate",
        componentstate: {
            component: "LEDDEVICE",
            state: state
        }
    };
    rpc(payload, callback, optionsOverride);
}

function getEffects(callback, optionsOverride) {
    getStatus(function(err, result) {
        if (err) return callback(err, null);
        var info = result && (result.info || result);
        var effects = info && Array.isArray(info.effects) ? info.effects : [];
        var names = [];
        var seen = {};
        effects.forEach(function(effect) {
            var name = typeof effect === "string" ? effect : (effect && effect.name);
            if (!name || name === "System Shutdown" || seen[name]) return;
            seen[name] = true;
            names.push(name);
        });
        names.sort(function(a, b) { return a.localeCompare(b); });
        callback(null, names);
    }, optionsOverride);
}

function setEffect(name, callback, optionsOverride) {
    if (typeof name !== "string" || name.trim() === "") {
        var err = new Error("effect name is required");
        err.code = "INVALID_REQUEST";
        return process.nextTick(function() { callback(err, null); });
    }
    rpc({
        command: "effect",
        effect: { name: name, args: {} },
        priority: 64,
        duration: -1,
        origin: "AmbiSun"
    }, callback, optionsOverride);
}

function clearEffect(callback, optionsOverride) {
    rpc({ command: "clear", priority: 64 }, callback, optionsOverride);
}

module.exports = {
    rpc: rpc,
    getStatus: getStatus,
    setLedDevice: setLedDevice,
    getEffects: getEffects,
    setEffect: setEffect,
    clearEffect: clearEffect
};
