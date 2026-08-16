var assert = require("assert");
var source = require("../lib/source");

console.log("TEST: Starting source detection logic tests...");

// Mock service
var mockService = {
    _subs: {},
    _callbacks: {},
    call: function() {},
    subscribe: function() {}
};

source.injectMocks(mockService, {
    apps: {
        "youtube.leanback.v4": "YouTube",
        "netflix": "Netflix"
    },
    hdmi: {
        "com.webos.app.hdmi1": "Apple TV",
        "com.webos.app.hdmi2": "PS5"
    }
});


setTimeout(function() {
    // Basic Normalization Tests
    var t1 = source.normalizeSource("youtube.leanback.v4", {});
    assert.strictEqual(t1.type, "app");
    assert.strictEqual(t1.id, "youtube.leanback.v4");
    assert.strictEqual(t1.name, "YouTube");

    var t2 = source.normalizeSource("com.webos.app.hdmi1", {});
    assert.strictEqual(t2.type, "hdmi");
    assert.strictEqual(t2.id, "HDMI_1");
    assert.strictEqual(t2.name, "Apple TV");

    var t3 = source.normalizeSource("", {});
    assert.strictEqual(t3.type, "unknown");
    assert.strictEqual(t3.id, null);

    var t4 = source.normalizeSource("unknown.app", {});
    assert.strictEqual(t4.type, "app");
    assert.strictEqual(t4.id, "unknown.app");
    assert.strictEqual(t4.name, "unknown.app"); // fallback to id

    // Test Event Processing & Debounce
    source.simulateForegroundMessage({
        returnValue: true,
        appId: "youtube.leanback.v4"
    });

    var st = source.getSourceDetectorStatus();
    assert.strictEqual(st.stableSource.type, "unknown"); // Not yet debounced
    assert.strictEqual(st.candidate.id, "youtube.leanback.v4");

    // Wait for debounce
    setTimeout(function() {
        var st2 = source.getSourceDetectorStatus();
        assert.strictEqual(st2.stableSource.id, "youtube.leanback.v4");
        assert.strictEqual(st2.candidate, null);

        // Test HDMI transition
        source.simulateForegroundMessage({
            returnValue: true,
            foregroundAppInfo: [
                { order: 0, appId: "com.webos.app.hdmi2" }
            ]
        });

        var st3 = source.getSourceDetectorStatus();
        assert.strictEqual(st3.stableSource.id, "youtube.leanback.v4"); // Still old
        assert.strictEqual(st3.candidate.id, "HDMI_2"); // New candidate

        setTimeout(function() {
            var st4 = source.getSourceDetectorStatus();
            assert.strictEqual(st4.stableSource.id, "HDMI_2");
            assert.strictEqual(st4.stableSource.type, "hdmi");
            
            console.log("TEST: All source logic tests PASSED.");
        }, source.DEBOUNCE_MS + 50);

    }, source.DEBOUNCE_MS + 50);

}, 50);
