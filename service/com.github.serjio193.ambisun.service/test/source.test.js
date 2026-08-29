var assert = require("assert");
var source = require("../lib/source");

console.log("TEST: Starting source detection logic tests...");

assert.strictEqual(source.FOREGROUND_APP_URI,
    "luna://com.webos.applicationManager/getForegroundAppInfo");
// Mock service
var mockCurrentInput = { returnValue: false };
var mockForegroundAppId = "youtube.leanback.v4";
var mockService = {
    _subs: {},
    _callbacks: {},
    call: function(uri, payload, callback) {
        if (uri === source.CURRENT_INPUT_URI && callback) {
            callback({ payload: mockCurrentInput });
            return;
        }
        if (uri === source.FOREGROUND_APP_URI && callback) {
            callback({ payload: { returnValue: true, appId: mockForegroundAppId } });
        }
    },
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

    var t2b = source.normalizeInputSource("ATV", {});
    assert.strictEqual(t2b.type, "tv");
    assert.strictEqual(t2b.id, "ATV");
    assert.strictEqual(t2b.name, "Эфир");
    assert.strictEqual(source.isPlaceholderTvInput(t2b, "com.webos.app.home"), true);
    assert.strictEqual(source.isPlaceholderTvInput(t2b, "com.webos.app.livetv"), false);

    var t2c = source.normalizeSource("com.webos.app.livetv", {});
    assert.strictEqual(t2c.type, "tv");
    assert.strictEqual(t2c.id, "ATV");
    assert.strictEqual(t2c.name, "Эфир");

    var t3 = source.normalizeSource("", {});
    assert.strictEqual(t3.type, "unknown");
    assert.strictEqual(t3.id, null);

    var t4 = source.normalizeSource("unknown.app", {});
    assert.strictEqual(t4.type, "app");
    assert.strictEqual(t4.id, "unknown.app");
    assert.strictEqual(t4.name, "unknown.app"); // fallback to id

    // ATV reported by Home is a last-input preview. It must schedule a
    // conditional retry and must not become the active source.
    mockForegroundAppId = "com.webos.app.home";
    mockCurrentInput = { returnValue: true, mainInputSourceId: "ATV" };
    source.refreshForegroundSource(function() {});
    assert.strictEqual(source.getSourceDetectorStatus().placeholderRetryPending, true);

    // A real source cancels the placeholder retry immediately.
    mockForegroundAppId = "youtube.leanback.v4";
    mockCurrentInput = { returnValue: false };
    source.refreshForegroundSource(function() {});
    assert.strictEqual(source.getSourceDetectorStatus().placeholderRetryPending, false);

    // The service refreshes the real foreground endpoint on status requests.
    source.refreshForegroundSource(function() {});

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

        // A stale EIM HDMI value can arrive shortly before Home while the
        // user has not changed source. Home must cancel that pending change.
        mockForegroundAppId = "";
        mockCurrentInput = { returnValue: true, mainInputSourceId: "HDMI_4" };
        source.refreshForegroundSource(function() {});
        assert.strictEqual(source.getSourceDetectorStatus().candidate.id, "HDMI_4");
        mockForegroundAppId = "com.webos.app.home";
        source.refreshForegroundSource(function() {});
        assert.strictEqual(source.getSourceDetectorStatus().candidate, null);
        assert.strictEqual(source.getSourceDetectorStatus().stableSource.id,
            "youtube.leanback.v4");

        // Home is a launcher, not a source. Leaving YouTube for Home must not
        // replace the app with the last HDMI input and trigger its rule.
        mockForegroundAppId = "com.webos.app.home";
        mockCurrentInput = { returnValue: true, mainInputSourceId: "HDMI_4" };
        source.refreshForegroundSource(function() {});
        assert.strictEqual(source.getSourceDetectorStatus().stableSource.id,
            "youtube.leanback.v4");
        assert.strictEqual(source.getSourceDetectorStatus().displaySource.id, null);
        assert.strictEqual(source.getSourceDetectorStatus().transition.active, true);
        assert.strictEqual(source.getSourceDetectorStatus().candidate, null);

        // An app can remain alive while an external input is displayed.
        mockForegroundAppId = "";
        mockCurrentInput = { returnValue: true, mainInputSourceId: "DTV" };
        source.refreshForegroundSource(function() {});
        setTimeout(function() {
        mockCurrentInput = { returnValue: true, mainInputSourceId: "HDMI_1" };
        source.refreshForegroundSource(function() {});
        var stInput = source.getSourceDetectorStatus();
        assert.strictEqual(stInput.candidate.id, "HDMI_1");
        assert.strictEqual(stInput.candidate.type, "hdmi");

        setTimeout(function() {
            var stInput2 = source.getSourceDetectorStatus();
            assert.strictEqual(stInput2.stableSource.id, "HDMI_1");
            assert.strictEqual(stInput2.displaySource.id, "HDMI_1");
            assert.strictEqual(stInput2.transition.active, false);

        // Test HDMI transition
        source.simulateForegroundMessage({
            returnValue: true,
            foregroundAppInfo: [
                { order: 0, appId: "com.webos.app.hdmi2" }
            ]
        });

        var st3 = source.getSourceDetectorStatus();
            assert.strictEqual(st3.stableSource.id, "HDMI_1"); // Still old
        assert.strictEqual(st3.candidate.id, "HDMI_2"); // New candidate

        setTimeout(function() {
            var st4 = source.getSourceDetectorStatus();
            assert.strictEqual(st4.stableSource.id, "HDMI_2");
            assert.strictEqual(st4.stableSource.type, "hdmi");
            
            console.log("TEST: All source logic tests PASSED.");
        }, source.DEBOUNCE_MS + 50);
        }, source.DEBOUNCE_MS + 50);
        }, 50);

    }, source.DEBOUNCE_MS + 50);

}, 50);
