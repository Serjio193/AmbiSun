var assert = require('assert');
var http = require('http');
var hyperhdr = require('../lib/hyperhdr');

function runTests() {
    console.log("TEST: Starting HyperHDR transport tests...");

    var server = http.createServer(function(req, res) {
        var body = '';
        req.on('data', function(chunk) { body += chunk; });
        req.on('end', function() {
            var parsedBody = {};
            if (body) {
                try {
                    parsedBody = JSON.parse(body);
                } catch(e) {}
            }

            if (req.url === '/timeout') {
                // Do not respond
                return;
            }

            if (req.url === '/error500') {
                res.writeHead(500);
                res.end();
                return;
            }

            if (req.url === '/badjson') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end("{ invalid: json ");
                return;
            }

            if (req.url === '/apperror') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: "Mock application error" }));
                return;
            }
            
            if (req.url === '/huge') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                var chunk = Buffer.alloc(100000, 'a');
                for (var i=0; i<15; i++) { // 1.5MB total
                    res.write(chunk);
                }
                res.end();
                return;
            }

            // Normal success
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                echoMethod: req.method,
                echoBody: parsedBody
            }));
        });
    });

    server.listen(0, '127.0.0.1', function() {
        var port = server.address().port;
        var opts = { host: '127.0.0.1', port: port };

        var testsFinished = 0;
        var totalTests = 13;

        function checkDone() {
            testsFinished++;
            if (testsFinished === totalTests) {
                server.close();
                console.log("TEST: All HyperHDR transport tests PASSED.");
            }
        }

        // 1. JSON RPC HTTP request (success)
        hyperhdr.rpc({ test: "data" }, function(err, result) {
            assert.ifError(err);
            assert.strictEqual(result.success, true);
            // 2. Exact request method = POST
            assert.strictEqual(result.echoMethod, 'POST');
            // 3. Expected JSON body sent
            assert.strictEqual(result.echoBody.test, "data");
            checkDone();
        }, opts);

        // 4. LEDDEVICE true payload
        hyperhdr.setLedDevice(true, function(err, result) {
            assert.ifError(err);
            assert.strictEqual(result.echoBody.command, "componentstate");
            assert.strictEqual(result.echoBody.componentstate.component, "LEDDEVICE");
            assert.strictEqual(result.echoBody.componentstate.state, true);
            checkDone();
        }, opts);

        // 5. LEDDEVICE false payload
        hyperhdr.setLedDevice(false, function(err, result) {
            assert.ifError(err);
            assert.strictEqual(result.echoBody.componentstate.state, false);
            checkDone();
        }, opts);

        // 6. Brightness adjustment payload
        hyperhdr.setBrightness(50, function(err, result) {
            assert.ifError(err);
            assert.strictEqual(result.echoBody.command, "adjustment");
            assert.strictEqual(result.echoBody.adjustment.brightness, 50);
            checkDone();
        }, opts);

        // 7. Effect preview payload includes HyperHDR's native duration
        hyperhdr.setEffectWithPriorityDuration("Plasma", 128, 6000, function(err, result) {
            assert.ifError(err);
            assert.strictEqual(result.echoBody.command, "effect");
            assert.strictEqual(result.echoBody.effect.name, "Plasma");
            assert.strictEqual(result.echoBody.priority, 128);
            assert.strictEqual(result.echoBody.duration, 6000);
            checkDone();
        }, opts);

        // 8. Invalid boolean rejected
        hyperhdr.setLedDevice("true", function(err) {
            assert.strictEqual(err.code, "INVALID_REQUEST");
            checkDone();
        }, opts);

        // 8. HTTP 500
        var opts500 = Object.assign({}, opts, { path: '/error500' });
        hyperhdr.rpc({}, function(err) {
            assert.strictEqual(err.code, "HYPERHDR_HTTP_ERROR");
            assert.strictEqual(err.statusCode, 500);
            checkDone();
        }, opts500);

        // 9. Connection refused
        var optsRefused = { host: '127.0.0.1', port: port + 1 }; // Wrong port
        hyperhdr.rpc({}, function(err) {
            assert.strictEqual(err.code, "HYPERHDR_UNREACHABLE");
            checkDone();
        }, optsRefused);

        // 10. Timeout
        var optsTimeout = Object.assign({}, opts, { path: '/timeout', timeout: 50 });
        hyperhdr.rpc({}, function(err) {
            assert.strictEqual(err.code, "HYPERHDR_TIMEOUT");
            checkDone();
        }, optsTimeout);

        // 11. Malformed JSON
        var optsBadJson = Object.assign({}, opts, { path: '/badjson' });
        hyperhdr.rpc({}, function(err) {
            assert.strictEqual(err.code, "HYPERHDR_INVALID_JSON");
            checkDone();
        }, optsBadJson);

        // 12. Application error
        var optsAppError = Object.assign({}, opts, { path: '/apperror' });
        hyperhdr.rpc({}, function(err) {
            assert.strictEqual(err.code, "HYPERHDR_ERROR");
            assert.strictEqual(err.hyperhdrResponse.success, false);
            checkDone();
        }, optsAppError);
        
        // 13. Response body limit
        var optsHuge = Object.assign({}, opts, { path: '/huge' });
        hyperhdr.rpc({}, function(err) {
            assert.strictEqual(err.code, "INTERNAL_ERROR");
            assert.ok(err.message.indexOf("exceeded maximum size") !== -1);
            checkDone();
        }, optsHuge);

        // 15. Successful status request
        hyperhdr.getStatus(function(err, result) {
            assert.ifError(err);
            assert.strictEqual(result.echoBody.command, "serverinfo");
            checkDone();
        }, opts);
    });
}

runTests();
