var assert = require('assert');
var powerState = require('../lib/power-state');

console.log('TEST: Starting power state transition tests...');

var sleeps = [];
var wakes = [];
var callbacks = {
    onSleep: function (state) { sleeps.push(state); },
    onWake: function (state) { wakes.push(state); }
};

powerState._handleResponse({ payload: { returnValue: true, state: 'On' } }, callbacks);
assert.deepStrictEqual(sleeps, []);
assert.deepStrictEqual(wakes, []);

powerState._handleResponse({ payload: { returnValue: true, state: 'Screen Saver' } }, callbacks);
assert.deepStrictEqual(sleeps, ['Screen Saver']);

powerState._handleResponse({ payload: { returnValue: true, state: 'Active' } }, callbacks);
assert.deepStrictEqual(wakes, ['Active']);

powerState._handleResponse({ payload: { returnValue: true, state: 'Standby' } }, callbacks);
assert.deepStrictEqual(sleeps, ['Screen Saver', 'Standby']);

powerState._handleResponse({ payload: { returnValue: true, state: 'On' } }, callbacks);
assert.deepStrictEqual(wakes, ['Active', 'On']);

console.log('TEST: Power state transitions correctly invalidate and restore physical state.');
