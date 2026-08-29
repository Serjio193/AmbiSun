var assert = require("assert");
var controller = require("../lib/hyperhdr-controller");
var transport = require("../lib/hyperhdr");

var writes = [];
var active = 0;
var maxActive = 0;
var effectWrites = [];

transport.setLedDevice = function (state, callback) {
    writes.push(state);
    active++;
    maxActive = Math.max(maxActive, active);
    setTimeout(function () {
        active--;
        callback(null, { success: true });
    }, 15);
};

transport.setEffectWithPriorityDuration = function (name, priority, duration, callback) {
    effectWrites.push({ name: name, priority: priority, duration: duration });
    setTimeout(function () {
        callback(null, { success: true });
    }, 5);
};

controller.invalidateState();

var first = new Promise(function (resolve, reject) {
    controller.setLedDevice(true, { reason: "hdmi4-test", caller: "automation" }, {}, function (err, result) {
        if (err) reject(err); else resolve(result);
    });
});
var duplicate = new Promise(function (resolve, reject) {
    controller.setLedDevice(true, { reason: "hdmi4-test", caller: "automation" }, {}, function (err, result) {
        if (err) reject(err); else resolve(result);
    });
});

Promise.all([first, duplicate]).then(function (results) {
    assert.deepStrictEqual(writes, [true]);
    assert.strictEqual(results[1].skipped, true);
    assert.strictEqual(maxActive, 1);

    return new Promise(function (resolve, reject) {
        controller.setLedDevice(false, { reason: "hdmi4-test", caller: "automation" }, {}, function (err) {
            if (err) reject(err); else resolve();
        });
    });
}).then(function () {
    assert.deepStrictEqual(writes, [true, false]);
    assert.strictEqual(maxActive, 1);
    return new Promise(function (resolve, reject) {
        controller.setEffectWithPriority("Plasma", 64, { reason: "preview-test", caller: "preview" }, {}, function (err) {
            if (err) reject(err); else resolve();
        });
    });
}).then(function () {
    assert.deepStrictEqual(effectWrites, [{ name: "Plasma", priority: 64, duration: -1 }]);
    console.log("TEST: HyperHDR controller serializes writes, suppresses duplicate LED state, and supports preview effects.");
}).catch(function (error) {
    console.error("TEST FAILED:", error);
    process.exit(1);
});
