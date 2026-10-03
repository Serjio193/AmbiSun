var childProcess = require('child_process');
var path = require('path');
var fs = require('fs');

var SERVICE_ID = 'com.github.serjio193.ambisun.service';
var APP_ID = 'com.github.serjio193.ambisun';
var PERMS_DIR = '/var/luna-service2-dev/client-permissions.d';

function addPublicToPermFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        var raw = fs.readFileSync(filePath, 'utf8');
        var perms = JSON.parse(raw);
        var key = Object.keys(perms)[0];
        if (!key) return false;
        var list = perms[key];
        if (Array.isArray(list) && list.indexOf('public') < 0) {
            list.push('public');
            fs.writeFileSync(filePath, JSON.stringify(perms));
            return true;
        }
    } catch (e) {
        console.warn('[bootstrap] perm patch error for ' + filePath + ':', e.message);
    }
    return false;
}

// Ensure base client-permissions include "public" so both service and app
// can call org.webosbrew.hbchannel.service endpoints if needed.
function ensurePublicPermissions() {
    var changed = false;
    if (addPublicToPermFile(path.join(PERMS_DIR, SERVICE_ID + '.service.json'))) {
        changed = true;
    }
    if (addPublicToPermFile(path.join(PERMS_DIR, APP_ID + '.app.json'))) {
        changed = true;
    }
    if (changed) {
        childProcess.execFile('/usr/sbin/ls-control', ['scan-services'], { timeout: 10000 },
            function (err) { if (err) console.warn('[bootstrap] scan-services:', err.message); });
        console.info('[bootstrap] Added "public" to Luna client-permissions');
    }
}

// An already elevated installation must also repair its persistent hook
// and guarantee the "public" Luna group survives package updates.
module.exports = function () {
    if (process.getuid() !== 0) return;
    ensurePublicPermissions();
    childProcess.execFile('/bin/sh', [
        path.join(__dirname, '..', 'homebrew-autostart.sh'), '--install'
    ], {timeout: 15000}, function (error) {
        if (error) console.error('[autostart] Bootstrap failed:', error.message);
    });
};
