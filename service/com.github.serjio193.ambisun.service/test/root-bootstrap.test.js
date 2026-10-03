const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bootstrapPath = path.join(__dirname, '../lib/root-bootstrap.js');
const source = fs.readFileSync(bootstrapPath, 'utf8');

function runBootstrap(uid) {
    const calls = [];
    const writes = [];
    const permissionFiles = {
        '/var/luna-service2-dev/client-permissions.d/com.github.serjio193.ambisun.service.service.json':
            '{"com.github.serjio193.ambisun.service":["media"]}',
        '/var/luna-service2-dev/client-permissions.d/com.github.serjio193.ambisun.app.json':
            '{"com.github.serjio193.ambisun":["media"]}'
    };
    const fakeFs = {
        existsSync(file) {
            return Object.prototype.hasOwnProperty.call(permissionFiles, file);
        },
        readFileSync(file, encoding) {
            calls.push(['read', file, encoding]);
            return permissionFiles[file];
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
            if (name === 'path') return path.posix;
            return require(name);
        },
        module,
        __dirname: '/service/lib',
        process: {getuid: () => uid},
        console: {info() {}, warn() {}, error() {}}
    });
    module.exports();
    return {calls, writes};
}

const jailed = runBootstrap(5000);
assert.strictEqual(jailed.writes.length, 0);
assert.strictEqual(jailed.calls.length, 0);

const root = runBootstrap(0);
assert.strictEqual(root.writes.length, 2);
assert.deepStrictEqual(JSON.parse(root.writes[0][1]),
    {'com.github.serjio193.ambisun.service': ['media', 'public']});
assert.deepStrictEqual(JSON.parse(root.writes[1][1]),
    {'com.github.serjio193.ambisun': ['media', 'public']});
assert(root.calls.some(call => call[0] === 'exec' &&
    call[1] === '/usr/sbin/ls-control' && call[2][0] === 'scan-services'));
console.log('PASS: root bootstrap grants public Luna access only from root and scans services');
