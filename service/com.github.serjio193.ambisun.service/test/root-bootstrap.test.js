const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bootstrapPath = path.join(__dirname, '../lib/root-bootstrap.js');
const source = fs.readFileSync(bootstrapPath, 'utf8');

function runBootstrap(uid, permissionsJson) {
    const calls = [];
    const writes = [];
    const fakeFs = {
        readFileSync(file, encoding) {
            calls.push(['read', file, encoding]);
            return permissionsJson;
        },
        writeFileSync(file, data) {
            writes.push([file, data]);
        }
    };
    const fakeChildProcess = {
        execFile(file, args, options, callback) {
            calls.push(['exec', file, args, options]);
            if (callback) callback(null);
        }
    };
    const module = {exports: null};
    vm.runInNewContext(source, {
        require(name) {
            if (name === 'fs') return fakeFs;
            if (name === 'child_process') return fakeChildProcess;
            return require(name);
        },
        module,
        __dirname: path.dirname(bootstrapPath),
        process: {getuid: () => uid},
        console: {info() {}, warn() {}, error() {}}
    });
    module.exports();
    return {calls, writes};
}

const jailed = runBootstrap(5000, '{"com.github.serjio193.ambisun.service":["media"]}');
assert.strictEqual(jailed.writes.length, 0);
assert.strictEqual(jailed.calls.length, 0);

const root = runBootstrap(0, '{"com.github.serjio193.ambisun.service":["media"]}');
assert.strictEqual(root.writes.length, 1);
assert.deepStrictEqual(
    JSON.parse(root.writes[0][1]),
    {'com.github.serjio193.ambisun.service': ['media', 'public']}
);
assert(root.calls.some(call => call[0] === 'exec' &&
    call[1] === '/usr/sbin/ls-control' && call[2][0] === 'scan-services'));
console.log('PASS: root bootstrap grants public Luna access only from root and scans services');
