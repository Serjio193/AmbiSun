var assert = require('assert');
var config = require('../lib/config');
var source = require('../lib/source');
var scheduler = require('../lib/scheduler');
var hyperhdr = require('../lib/hyperhdr');
var automation = require('../lib/automation');

console.log('TEST: Starting startup recovery test...');

var recoveryListener = null;
var ledStates = [];
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
hyperhdr.getStatus = function (callback) {
    callback(null, { info: { components: [{ name: 'LEDDEVICE', enabled: true }] } });
};
hyperhdr.clearEffect = function (callback) { callback(null); };
hyperhdr.setLedDevice = function (enabled, callback) {
    ledStates.push(enabled);
    callback(null);
};

automation.init();
assert.strictEqual(typeof recoveryListener, 'function');
recoveryListener(source.getStableSource());

var status = automation.getAutomationStatus();
assert.deepStrictEqual(ledStates, [false]);
assert.strictEqual(status.lastTrigger, 'recovery');
assert.strictEqual(status.lastAppliedState, false);
assert.strictEqual(status.hasAppliedInitialState, true);

console.log('TEST: Startup recovery applies the off rule after restart.');
process.exit(0);
