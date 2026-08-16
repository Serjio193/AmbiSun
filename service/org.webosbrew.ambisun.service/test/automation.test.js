const assert = require('assert');
const automation = require('../lib/automation.js');
const source = require('../lib/source.js');
const config = require('../lib/config.js');
const hyperhdr = require('../lib/hyperhdr.js');

console.log("TEST: Starting automation logic tests...");

// Mock hyperhdr
let writeCount = 0;
let lastState = null;
hyperhdr.setLedDevice = function(state, cb) {
    writeCount++;
    lastState = state;
    if (cb) cb(null, true);
};

// Reset automation state manually to simulate cold start
const st = automation.getAutomationStatus();

try {
    assert.ok(typeof automation.init === 'function');
    assert.ok(typeof automation.getAutomationStatus === 'function');
    
    // Simulate diagnostic to check status semantics
    automation.evaluateAndApplyNow(function(err, res) {
        const after = automation.getAutomationStatus();
        assert.ok(after.lastDecisionAt !== null, "lastDecisionAt must be set");
        // It might be skipped due to no valid config in test
        assert.strictEqual(typeof after.lastApplySkipped, 'boolean', "lastApplySkipped must be boolean");
    });
    
    console.log("TEST: All automation logic tests PASSED.");
} catch (e) {
    console.error("TEST FAILED:", e);
    process.exit(1);
}
