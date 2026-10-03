const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../../../js/webos.js'), 'utf8');

async function runWithResponse(response) {
    let request;
    const context = {
        Promise,
        setTimeout,
        clearTimeout,
        console,
        webOS: {
            service: {
                request(uri, options) {
                    request = {uri, options};
                    options.onSuccess(response);
                }
            }
        }
    };
    context.window = context;
    vm.runInNewContext(source, context, {filename: 'webos.js'});
    const result = context.AmbiSun.webos.requestElevationDirect();
    return {request, result};
}

(async function () {
    const success = await runWithResponse({
        returnValue: true,
        stdoutString: 'Elevating service...\n'
    });
    assert.strictEqual(success.request.uri, 'luna://org.webosbrew.hbchannel.service');
    assert.strictEqual(success.request.options.method, 'exec');
    assert.match(success.request.options.parameters.command, /elevate-service com\.github\.serjio193\.ambisun\.service/);
    assert.strictEqual((await success.result).returnValue, true);

    const failed = await runWithResponse({returnValue: false, errorText: 'exec denied'});
    await assert.rejects(failed.result, /exec denied/);

    console.log('PASS: Homebrew elevation invokes elevate-service directly and checks returnValue');
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
