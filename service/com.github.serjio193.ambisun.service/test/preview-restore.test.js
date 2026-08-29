var assert = require("assert");
var config = require("../lib/config");
var source = require("../lib/source");
var scheduler = require("../lib/scheduler");
var hyperhdr = require("../lib/hyperhdr");
var controller = require("../lib/hyperhdr-controller");
var automation = require("../lib/automation");

var writes = [];
var testConfig = {
    enabled: true,
    defaultRule: "off",
    defaultEffect: null,
    brightness: 50,
    sunsetOffset: 0,
    sunriseOffset: 0,
    overrides: {},
    effectOverrides: {},
    sourceBrightness: {},
    hiddenSources: {},
    location: null,
    hyperhdr: { host: "127.0.0.1", port: 8090 }
};

config.get = function () { return { config: testConfig }; };
config.onCommit = function () {};
source.getStableSource = function () {
    return { type: "app", id: "youtube.leanback.v4", name: "YouTube", raw: null };
};
source.onStableSource = function () {};
scheduler.reconcile = function (cfg, now, callback) { if (callback) callback(null); };
hyperhdr.setLedDevice = function (enabled, callback) {
    writes.push(enabled);
    callback(null, { success: true });
};

controller.invalidateState();
automation.init();

automation.evaluateAndApplyNow(function (err) {
    assert.ifError(err);
    var initial = automation.getAutomationStatus();
    assert.strictEqual(initial.lastAppliedState, false);
    assert.strictEqual(initial.physicalStateValid, true);
    assert.deepStrictEqual(writes, []);

    // A preview enables HyperHDR directly while automation still caches OFF.
    controller.setLedDevice(true, { reason: "preview-test", caller: "preview" }, {}, function (previewErr) {
        assert.ifError(previewErr);
        automation.pauseForPreview();
        automation.resumeAfterPreview(function (restoreErr) {
            assert.ifError(restoreErr);
            assert.deepStrictEqual(writes, [true, false]);
            var restored = automation.getAutomationStatus();
            assert.strictEqual(restored.lastAppliedState, false);
            assert.strictEqual(restored.lastApplyReason, "APPLIED_OFF");
            console.log("TEST: Preview restore forces HyperHDR off when the cached state was stale.");
        }, true);
    });
});
