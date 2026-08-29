var POWER_STATE_URI = "luna://com.webos.service.tvpower/power/getPowerState";

var SLEEP_STATE_RE = /screen\s*saver|standby|suspend|power\s*off|^off$|^sleep$/i;
var subscription = null;
var currentState = null;
var lastError = null;

function extractState(payload) {
    if (!payload || payload.returnValue === false) return null;
    if (typeof payload.state === "string") return payload.state;
    if (typeof payload.powerState === "string") return payload.powerState;
    return null;
}

function isSleepState(value) {
    return typeof value === "string" && SLEEP_STATE_RE.test(value.trim());
}

function handleResponse(message, callbacks) {
    var payload = message && message.payload ? message.payload : message;
    var nextState = extractState(payload);
    if (!nextState) {
        lastError = payload && payload.errorText ? payload.errorText : "Power state is unavailable";
        return;
    }

    var hadPreviousState = currentState !== null;
    var wasSleeping = isSleepState(currentState);
    var isSleeping = isSleepState(nextState);
    currentState = nextState;
    lastError = null;

    if (hadPreviousState && isSleeping && !wasSleeping && callbacks.onSleep) callbacks.onSleep(nextState);
    if (hadPreviousState && !isSleeping && wasSleeping && callbacks.onWake) {
        callbacks.onWake(nextState);
    }
}

function init(service, callbacks) {
    callbacks = callbacks || {};
    if (!service || typeof service.subscribe !== "function") {
        lastError = "Power state subscription is unavailable";
        return false;
    }

    try {
        subscription = service.subscribe(POWER_STATE_URI, { subscribe: true });
        subscription.on("response", function(message) {
            handleResponse(message, callbacks);
        });
        subscription.on("cancel", function(message) {
            var payload = message && message.payload ? message.payload : message;
            lastError = payload && payload.errorText ? payload.errorText : "Power state subscription cancelled";
        });
        return true;
    } catch (error) {
        lastError = error.toString();
        return false;
    }
}

function getStatus() {
    return {
        uri: POWER_STATE_URI,
        state: currentState,
        sleeping: isSleepState(currentState),
        subscribed: !!subscription,
        lastError: lastError
    };
}

module.exports = {
    init: init,
    getStatus: getStatus,
    isSleepState: isSleepState,
    _handleResponse: handleResponse,
    POWER_STATE_URI: POWER_STATE_URI
};
