var assert = require('assert');
var config = require('../lib/config');
var source = require('../lib/source');
var scheduler = require('../lib/scheduler');
var hyperhdr = require('../lib/hyperhdr');
var automation = require('../lib/automation');

console.log('TEST: Starting delayed startup and wake recovery test...');

var recoveryListener = null;
var ledStates = [];
var brightnessWrites = [];
var testConfig = {
    enabled: true,
    defaultRule: 'off',
    defaultEffect: null,
    brightness: 50,
    sunsetOffset: 0,
    sunriseOffset: 0,
    overrides: {},
    effectOverrides: {},
    sourceBrightness: {},
    hiddenSources: {},
    location: null,
    hyperhdr: { host: '127.0.0.1', port: 8090 }
};

config.get = function () { return { config: testConfig }; };
config.onCommit = function () {};
source.DEBOUNCE_MS = 0;
source.getStableSource = function () {
    return { type: 'tv', id: 'ATV', name: 'Air', raw: null };
};
source.onStableSource = function (callback) { recoveryListener = callback; };
scheduler.reconcile = function (cfg, now, callback) {
    if (callback) callback(null);
};
hyperhdr.clearEffect = function (callback) { callback(null); };
hyperhdr.setLedDevice = function (enabled, callback) {
    ledStates.push(enabled);
    callback(null);
};
hyperhdr.setBrightness = function (brightness, callback) {
    brightnessWrites.push(brightness);
    callback(null);
};

automation.init();
assert.strictEqual(typeof recoveryListener, 'function');
recoveryListener(source.getStableSource());

var status = automation.getAutomationStatus();
assert.deepStrictEqual(ledStates, []);
assert.strictEqual(status.lastAppliedState, null);
assert.strictEqual(status.hasAppliedInitialState, false);

setTimeout(function () {
    status = automation.getAutomationStatus();
    assert.strictEqual(status.lastTrigger, null);
    assert.strictEqual(status.lastAppliedState, null);
    assert.strictEqual(status.physicalStateValid, false);
    assert.strictEqual(status.hasAppliedInitialState, false);

    testConfig.defaultRule = 'on';
    automation.handlePowerSleep();
    automation.handlePowerWake();

    status = automation.getAutomationStatus();
    assert.deepStrictEqual(brightnessWrites, []);
    assert.deepStrictEqual(ledStates, []);

    setTimeout(function () {
        status = automation.getAutomationStatus();
        assert.deepStrictEqual(brightnessWrites, []);
        assert.deepStrictEqual(ledStates, []);
        assert.strictEqual(status.lastTrigger, null);
        assert.strictEqual(status.lastAppliedState, null);
        assert.strictEqual(status.physicalStateValid, false);
        console.log('TEST: Startup and wake recovery are stability-delayed, not immediate.');
        process.exit(0);
    }, 100);
}, 100);
