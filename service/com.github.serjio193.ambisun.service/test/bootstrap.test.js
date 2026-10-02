const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const original = fs.readFileSync(path.join(__dirname, '../homebrew-autostart.sh'), 'utf8');
const shell = process.platform === 'win32' ? 'C:/msys64/usr/bin/sh.exe' : '/bin/sh';
// Redirect every device path into a disposable sandbox. No TV is contacted.
const script = original.replace(/\/media\/developer\/apps/g, '$TEST_ROOT/apps')
    .replace(/\/var\/lib\/webosbrew/g, '$TEST_ROOT/boot')
    .replace(/\/var\/luna-service2-dev/g, '$TEST_ROOT/luna')
    .replace('/tmp/ambisun-autostart.log', '$TEST_ROOT/log')
    .replace("'Exec=$TEST_ROOT/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service ",
        "'Exec=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service ");
for (const elevationFails of [false, true]) {
    const harness = `
TEST_ROOT=$(mktemp -d)
export TEST_ROOT
trap 'rm -rf "$TEST_ROOT"' EXIT
id() { echo 0; }
export -f id 2>/dev/null || true
service="$TEST_ROOT/apps/usr/palm/services/com.github.serjio193.ambisun.service"
hb="$TEST_ROOT/apps/usr/palm/services/org.webosbrew.hbchannel.service"
mkdir -p "$service" "$hb" "$TEST_ROOT/boot/init.d" "$TEST_ROOT/luna/services.d"
touch "$service/service.js"
printf '#!/bin/sh\\ntouch "$TEST_ROOT/elevation-called"\\nexit ${elevationFails ? 1 : 0}\\n' > "$hb/elevate-service"
chmod 755 "$hb/elevate-service"
printf 'Exec=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service -n app\\n' > "$TEST_ROOT/luna/services.d/com.github.serjio193.ambisun.service.service"
printf '#!/bin/sh\\nexit 0\\n' > "$service/homebrew-autostart.sh"
chmod 644 "$service/homebrew-autostart.sh"
ln -s "$service/homebrew-autostart.sh" "$TEST_ROOT/boot/init.d/90-ambisun"
set -- --install
(
${script}
)
result=$?
[ "$result" = 0 ] || exit 20
[ ! -e "$TEST_ROOT/elevation-called" ] || exit 24
[ ! -L "$TEST_ROOT/boot/init.d/90-ambisun" ] || exit 21
[ -x "$TEST_ROOT/boot/init.d/90-ambisun" ] || exit 22
# Simulate package replacement: the independent boot copy must survive.
rm "$service/homebrew-autostart.sh"
[ -x "$TEST_ROOT/boot/init.d/90-ambisun" ] || exit 23
printf '#!/bin/sh\\nexit 0\\n' > "$service/homebrew-autostart.sh"
chmod 644 "$service/homebrew-autostart.sh"
set -- --recover
(
${script}
)
result=$?
if [ "$result" != ${elevationFails ? 1 : 0} ]; then cat "$TEST_ROOT/log"; echo "recover exit=$result"; ls -l "$TEST_ROOT/elevation-called" "$TEST_ROOT/luna/services.d/com.github.serjio193.ambisun.service.service"; cat "$TEST_ROOT/luna/services.d/com.github.serjio193.ambisun.service.service"; exit 25; fi
[ -e "$TEST_ROOT/elevation-called" ] || exit 26
`;
    const result = cp.spawnSync(shell, ['-s'], {input: harness, encoding: 'utf8'});
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
}
console.log('PASS: boot hook survives package replacement; elevation failure is rejected');
