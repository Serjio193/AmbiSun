var assert = require("assert");
var diagnostics = require("../lib/diagnostics.js");

diagnostics.reset();
var token = diagnostics.beginRpc({
    command: "effect",
    effect: { name: "Plasma" },
    priority: 64
}, { diagnosticSource: "test", host: "127.0.0.1", port: 8090 });
diagnostics.finishRpc(token, null, { success: true });
diagnostics.automationEnqueued({ trigger: "test", queueDepth: 0 });

var snapshot = diagnostics.getSnapshot();
assert.strictEqual(snapshot.enabled, true);
assert.strictEqual(snapshot.counters.rpcTotal, 1);
assert.strictEqual(snapshot.counters.rpcCompleted, 1);
assert.strictEqual(snapshot.counters.rpcErrors, 0);
assert.strictEqual(snapshot.counters.rpcByCommand.effect, 1);
assert.strictEqual(snapshot.counters.automationEnqueued, 1);
assert.ok(snapshot.recentEvents.some(function (event) {
    return event.type === "hyperhdr.rpc.finish" && event.data.durationMs >= 0;
}));

console.log("TEST: Diagnostics counters and ring buffer PASSED.");
