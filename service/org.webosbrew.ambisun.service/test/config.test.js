var assert = require('assert');
var config = require('../lib/config');
var storage = require('../lib/storage');

// Mock storage
var mockData = null;
var mockSaveError = null;
var activeSaves = 0;
var activeLoads = 0;

storage.load = function(cb) {
    activeLoads++;
    setTimeout(function() {
        activeLoads--;
        if (!mockData) {
            var e = new Error("No file");
            e.code = "ENOENT";
            return cb(e);
        }
        cb(null, JSON.parse(mockData));
    }, 50); // Artificially delay init load
};

storage.save = function(snapshot, cb) {
    activeSaves++;
    setTimeout(function() {
        activeSaves--;
        if (mockSaveError) {
            return cb(mockSaveError);
        }
        mockData = JSON.stringify(snapshot);
        cb(null);
    }, 10);
};

function runTest() {
    console.log("TEST: Starting config logic tests...");
    assert.strictEqual(config.isInitialized(), false);
    
    // 1 & 2. PRE-INIT ORDERING TESTS
    var preInitResults = [];
    
    // Enqueue UPDATE first
    config.update({ defaultRule: "on" }, 1, function(err, newState) {
        assert.ifError(err);
        preInitResults.push({ op: "update1", rev: newState.revision });
        checkPreInitFinished();
    });
    
    // Enqueue READ second (should see update1's result)
    config.read(function(err, state) {
        assert.ifError(err);
        preInitResults.push({ op: "read1", rev: state.revision });
        checkPreInitFinished();
    });
    
    // We can't do pre-init reverse easily without a second fresh init, so we do it in READY state or with 
    // a second UPDATE. Let's just enqueue another READ then UPDATE
    
    config.read(function(err, state) {
        assert.ifError(err);
        preInitResults.push({ op: "read2", rev: state.revision }); // Will read rev 2 because update1 finished
        checkPreInitFinished();
    });
    
    config.update({ defaultRule: "off" }, 2, function(err, newState) {
        assert.ifError(err);
        preInitResults.push({ op: "update2", rev: newState.revision });
        checkPreInitFinished();
    });

    config.init();
    
    // Verify double-init protection
    var loadsBefore = activeLoads;
    config.init();
    assert.strictEqual(activeLoads, loadsBefore);
    
    function checkPreInitFinished() {
        if (preInitResults.length === 4) {
            assert.strictEqual(preInitResults[0].op, "update1");
            assert.strictEqual(preInitResults[0].rev, 2);
            assert.strictEqual(preInitResults[1].op, "read1");
            assert.strictEqual(preInitResults[1].rev, 2); // Read sees the update before it
            assert.strictEqual(preInitResults[2].op, "read2");
            assert.strictEqual(preInitResults[2].rev, 2); // Read sees the update before it, but not the one after
            assert.strictEqual(preInitResults[3].op, "update2");
            assert.strictEqual(preInitResults[3].rev, 3);
            
            console.log("TEST: Pre-init ordering tests PASSED.");
            testReadyStateOrdering();
        }
    }
}

function testReadyStateOrdering() {
    // Current revision is 3
    var results = [];
    
    // 3. READY state: UPDATE then READ immediately
    config.update({ defaultRule: "sun" }, 3, function(err, newState) {
        assert.ifError(err);
        results.push({ op: "update3", rev: newState.revision });
        checkReadyFinished();
    });
    
    config.read(function(err, state) {
        assert.ifError(err);
        results.push({ op: "read3", rev: state.revision });
        checkReadyFinished();
    });
    
    // 4. READY state reverse order: READ then UPDATE
    config.read(function(err, state) {
        assert.ifError(err);
        results.push({ op: "read4", rev: state.revision });
        checkReadyFinished();
    });
    
    config.update({ sunsetOffset: 15 }, 4, function(err, newState) {
        assert.ifError(err);
        results.push({ op: "update4", rev: newState.revision });
        checkReadyFinished();
    });
    
    function checkReadyFinished() {
        if (results.length === 4) {
            assert.strictEqual(results[0].op, "update3");
            assert.strictEqual(results[0].rev, 4);
            assert.strictEqual(results[1].op, "read3");
            assert.strictEqual(results[1].rev, 4); // Waited for update3
            
            assert.strictEqual(results[2].op, "read4");
            assert.strictEqual(results[2].rev, 4); // Executed before update4
            assert.strictEqual(results[3].op, "update4");
            assert.strictEqual(results[3].rev, 5);
            
            console.log("TEST: Ready state ordering tests PASSED.");
            testStorageFailureOrdering();
        }
    }
}

function testStorageFailureOrdering() {
    // Current revision is 5
    var results = [];
    
    // 5. UPDATE storage failure followed by READ
    mockSaveError = new Error("Disk Full");
    
    config.update({ defaultRule: "off" }, 5, function(err) {
        assert.strictEqual(err.code, "STORAGE_ERROR");
        results.push({ op: "updateFail" });
        checkFailFinished();
    });
    
    config.read(function(err, state) {
        assert.ifError(err);
        results.push({ op: "readFail", rev: state.revision });
        checkFailFinished();
    });
    
    function checkFailFinished() {
        if (results.length === 2) {
            mockSaveError = null;
            assert.strictEqual(results[0].op, "updateFail");
            assert.strictEqual(results[1].op, "readFail");
            assert.strictEqual(results[1].rev, 5); // Remained at 5
            
            console.log("TEST: Storage failure ordering tests PASSED.");
            testRapidSequence();
        }
    }
}

function testRapidSequence() {
    // Current revision is 5
    var results = [];
    
    // 6. UPDATE then RESET then READ
    config.update({ defaultRule: "on" }, 5, function(err, newState) {
        assert.ifError(err);
        results.push({ op: "updateFast", rev: newState.revision });
        checkFastFinished();
    });
    
    config.reset(function(err, newState) {
        assert.ifError(err);
        results.push({ op: "resetFast", rev: newState.revision });
        checkFastFinished();
    });
    
    config.read(function(err, state) {
        assert.ifError(err);
        results.push({ op: "readFast", rev: state.revision, rule: state.config.defaultRule });
        checkFastFinished();
    });
    
    function checkFastFinished() {
        if (results.length === 3) {
            assert.strictEqual(results[0].op, "updateFast");
            assert.strictEqual(results[0].rev, 6);
            assert.strictEqual(results[1].op, "resetFast");
            assert.strictEqual(results[1].rev, 7);
            assert.strictEqual(results[2].op, "readFast");
            assert.strictEqual(results[2].rev, 7);
            assert.strictEqual(results[2].rule, "sun"); // Defaults restored
            
            console.log("TEST: Rapid sequence tests PASSED.");
            continueLegacyTests();
        }
    }
}

function continueLegacyTests() {
    // Current revision is 7
    config.update({ defaultRule: "invalid" }, 7, function(err) {
        assert.strictEqual(err.code, "CONFIG_INVALID");
        
        config.update({ sunsetOffset: 31 }, 7, function(err) {
            assert.strictEqual(err.code, "CONFIG_INVALID");
            
            config.update({ sunsetOffset: 400 }, 7, function(err) {
                assert.strictEqual(err.code, "CONFIG_INVALID");
                
                config.update({ unknownField: true }, 7, function(err) {
                    assert.strictEqual(err.code, "CONFIG_INVALID");
                    
                    config.update({ defaultRule: "off" }, "not-a-number", function(err) {
                        assert.strictEqual(err.code, "INVALID_REQUEST");
                        
                        config.update({}, 7, function(err) {
                            assert.strictEqual(err.code, "CONFIG_INVALID");
                            
                            config.update({ defaultRule: "off" }, 6, function(err) {
                                assert.strictEqual(err.code, "REVISION_CONFLICT");
                                
                                var docErr = config._validateDocument({ schemaVersion: 2 });
                                assert.ok(docErr);
                                
                                docErr = config._validateDocument({ schemaVersion: 1, revision: 1.5, config: {} });
                                assert.ok(docErr);
                                
                                var goodDoc = { schemaVersion: 1, revision: 10, config: JSON.parse(JSON.stringify(config.get().config)) };
                                assert.strictEqual(config._validateDocument(goodDoc), null);
                                
                                goodDoc.config.defaultRule = "banana";
                                assert.ok(config._validateDocument(goodDoc));
                                
                                config.update({ overrides: [] }, 7, function(err) {
                                    assert.strictEqual(err.code, "CONFIG_INVALID");
                                    
                                    config.update({ location: { country: "Test", lat: 100 } }, 7, function(err) {
                                        assert.strictEqual(err.code, "CONFIG_INVALID");
                                        
                                        config.update({ location: null }, 7, function(err, stateNullLoc) {
                                            assert.ifError(err);
                                            assert.strictEqual(stateNullLoc.revision, 8);
                                            
                                            console.log("TEST: All config logic tests PASSED.");
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

runTest();
