var childProcess = require('child_process');
var path = require('path');
var fs = require('fs');

var SERVICE_ID = 'com.github.serjio193.ambisun.service';
var PERMS_FILE = '/var/luna-service2-dev/client-permissions.d/' + SERVICE_ID + '.service.json';

// Ensure the service's base client-permissions include "public" so the
// jailed instance can call org.webosbrew.hbchannel.service/exec for
// self-elevation after a reboot or package update.
function ensurePublicPermission() {
    try {
        var raw = fs.readFileSync(PERMS_FILE, 'utf8');
        var perms = JSON.parse(raw);
        var key = Object.keys(perms)[0];
        if (!key) return;
        var list = perms[key];
        if (Array.isArray(list) && list.indexOf('public') < 0) {
            list.push('public');
            fs.writeFileSync(PERMS_FILE, JSON.stringify(perms));
            childProcess.execFile('/usr/sbin/ls-control', ['scan-services'], { timeout: 10000 },
                function (err) { if (err) console.warn('[bootstrap] scan-services:', err.message); });
            console.info('[bootstrap] Added "public" to service client-permissions');
        }
    } catch (e) {
        console.warn('[bootstrap] ensurePublicPermission:', e.message);
    }
}

// An already elevated installation must also repair its persistent hook
// and guarantee the "public" Luna group survives package updates.
module.exports = function () {
    if (process.getuid() !== 0) return;
    ensurePublicPermission();
    childProcess.execFile('/bin/sh', [
        path.join(__dirname, '..', 'homebrew-autostart.sh'), '--install'
    ], {timeout: 15000}, function (error) {
        if (error) console.error('[autostart] Bootstrap failed:', error.message);
    });
};
