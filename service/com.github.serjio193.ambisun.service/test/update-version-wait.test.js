const assert = require('assert');
const cp = require('child_process');
const updater = require('../lib/updater');
const script = updater._generateHelperScript('0.2.11', '/tmp/a', '/tmp/b', '/tmp/c', '/tmp/d');
const start = script.indexOf('FOUND_APPINFO=0');
const end = script.indexOf('if [ "$FOUND_APPINFO"', start);
assert(start >= 0 && end > start);
const loop = script.slice(start, end);
const shell = process.platform === 'win32' ? 'C:/msys64/usr/bin/sh.exe' : '/bin/sh';
// Run the actual generated wait loop. The installed file already exists, but
// grep does not see the target version until the third simulated second.
for (const readyAt of [3, 99]) {
    const harness = `
APPINFO_PATH=/dev/null
TARGET_VERSION=0.2.11
ticks=0
grep() { [ "$ticks" -ge ${readyAt} ]; }
sleep() { ticks=$((ticks + 1)); }
${loop.replace('[ -f "$APPINFO_PATH" ]', '[ -e "$APPINFO_PATH" ]')}
printf '%s %s' "$FOUND_APPINFO" "$ticks"
`;
    const result = cp.spawnSync(shell, ['-s'], {input: harness, encoding: 'utf8'});
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, readyAt === 3 ? '1 3' : '0 30');
}
console.log('PASS: update waits for target version and times out after 30 attempts');
