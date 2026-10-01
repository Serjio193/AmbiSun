var childProcess = require('child_process');
var path = require('path');

// An already elevated installation must also repair its persistent hook.
module.exports = function () {
    if (process.getuid() !== 0) return;
    childProcess.execFile('/bin/sh', [
        path.join(__dirname, '..', 'homebrew-autostart.sh'), '--install'
    ], {timeout: 15000}, function (error) {
        if (error) console.error('[autostart] Bootstrap failed:', error.message);
    });
};
