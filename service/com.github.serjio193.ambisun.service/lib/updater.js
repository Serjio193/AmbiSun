var url = require('url');
var fs = require('fs');
var path = require('path');
var validation = require('./updater-validation');
var createTransfer = require('./updater-transfer');

var MANIFEST_URL = "https://github.com/Serjio193/AmbiSun/releases/latest/download/update.json";
var MANIFEST_MAX_BYTES = 131072; // 128 KB
var IPK_MAX_BYTES = validation.IPK_MAX_BYTES;
var HTTP_TIMEOUT_MS = 8000;
var CACHE_TTL_MS = 1800000;       // 30 minutes
var INSTALL_LOCK_TIMEOUT_MS = 300000; // 5 minutes failsafe lock timeout

var TEMP_DIR = "/media/developer/temp";
var SEMVER_REGEX = validation.SEMVER_REGEX;
var PRODUCTION_PUBLIC_KEY = validation.PRODUCTION_PUBLIC_KEY;

var cachedManifest = null;
var isInstalling = false;
var installStartedAt = 0;
var activeFetcher = null;
var activeDownloader = null;

function getCurrentVersion() {
    try {
        var pkg = require('../package.json');
        if (pkg && pkg.version && SEMVER_REGEX.test(pkg.version)) {
            return pkg.version;
        }
    } catch (_) {}
    return "0.1.0";
}

var compareSemver = validation.compareSemver;
var isUpdateAvailable = validation.isUpdateAvailable;
function getExpectedIpkUrl(version) {
    return "https://github.com/Serjio193/AmbiSun/releases/download/v" + version + "/com.github.serjio193.ambisun_" + version + "_all.ipk";
}
var getCanonicalPayload = validation.getCanonicalPayload;
var verifyManifestSignature = validation.verifyManifestSignature;
var isAllowedHost = validation.isAllowedHost;
var validateManifest = validation.validateManifest;

var transfer = createTransfer({ isAllowedHost: isAllowedHost, httpTimeoutMs: HTTP_TIMEOUT_MS });
var fetchWithRedirects = transfer.fetchWithRedirects;
var downloadFileWithHash = transfer.downloadFileWithHash;

function fetchAndValidateManifest(callback) {
    var fetchFn = activeFetcher || fetchWithRedirects;
    fetchFn(MANIFEST_URL, MANIFEST_MAX_BYTES, 0, function(err, body) {
        if (err) {
            return callback(new Error("CHECK_FAILED: " + err.message));
        }

        var manifest;
        try {
            manifest = JSON.parse(body);
        } catch (e) {
            return callback(new Error("INVALID_JSON: Failed to parse update manifest JSON"));
        }

        var valErr = validateManifest(manifest);
        if (valErr) {
            return callback(new Error("INVALID_MANIFEST: " + valErr));
        }

        var latestVer = manifest.version.trim();
        var sha256 = manifest.sha256.trim().toLowerCase();
        var size = manifest.size;
        var ipkUrl = getExpectedIpkUrl(latestVer);

        cachedManifest = {
            version: latestVer,
            sha256: sha256,
            size: size,
            signature: manifest.signature.trim(),
            notes: manifest.notes || {},
            ipkUrl: ipkUrl,
            fetchedAt: Date.now()
        };

        callback(null, cachedManifest);
    });
}

function checkForUpdate(callback) {
    var currentVer = getCurrentVersion();

    fetchAndValidateManifest(function(err, manifest) {
        if (err) {
            var msg = err.message || "";
            var code = "CHECK_FAILED";
            if (msg.startsWith("INVALID_JSON:")) code = "INVALID_JSON";
            else if (msg.startsWith("INVALID_MANIFEST:")) code = "INVALID_MANIFEST";

            return callback(null, {
                returnValue: false,
                currentVersion: currentVer,
                errorCode: code,
                errorText: msg.replace(/^[A-Z_]+:\s*/, "")
            });
        }

        var latestVer = manifest.version;
        var updateAvail = isUpdateAvailable(currentVer, latestVer);

        callback(null, {
            returnValue: true,
            currentVersion: currentVer,
            updateAvailable: updateAvail,
            latestVersion: latestVer,
            notes: manifest.notes || {}
        });
    });
}

function generateHelperScript(targetVersion, ipkPath, helperPath, resultPath, logPath) {
    return "#!/bin/sh\n" +
        "IPK_PATH=\"" + ipkPath + "\"\n" +
        "HELPER_PATH=\"" + helperPath + "\"\n" +
        "RESULT_PATH=\"" + resultPath + "\"\n" +
        "LOG_PATH=\"" + logPath + "\"\n" +
        "APP_ID=\"com.github.serjio193.ambisun\"\n" +
        "SVC_ID=\"com.github.serjio193.ambisun.service\"\n" +
        "TARGET_VERSION=\"" + targetVersion + "\"\n" +
        "APPINFO_PATH=\"/media/developer/apps/usr/palm/applications/com.github.serjio193.ambisun/appinfo.json\"\n" +
        "ELEVATE_BIN=\"/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service\"\n\n" +
        "echo \"[$(date)] Starting AmbiSun update to $TARGET_VERSION...\" >> \"$LOG_PATH\"\n" +
        "sleep 2\n\n" +
        "# Remove previous result if any\n" +
        "rm -f \"$RESULT_PATH\"\n\n" +
        "# 1. Install IPK via appInstallService\n" +
        "echo \"[$(date)] Executing appInstallService/dev/install...\" >> \"$LOG_PATH\"\n" +
        "luna-send -n 1 -w 60000 luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"'\"$IPK_PATH\"'\",\"subscribe\":false}' > \"$RESULT_PATH\" 2>&1\n" +
        "INSTALL_EXIT=$?\n\n" +
        "cat \"$RESULT_PATH\" >> \"$LOG_PATH\"\n" +
        "echo \"[$(date)] Install command shell exit code: $INSTALL_EXIT\" >> \"$LOG_PATH\"\n\n" +
        "# 2. Verify install returnValue\n" +
        "INSTALL_SUCCESS=0\n" +
        "if [ \"$INSTALL_EXIT\" -eq 0 ] && [ -f \"$RESULT_PATH\" ]; then\n" +
        "    if grep -E -q '\"returnValue\"[[:space:]]*:[[:space:]]*true' \"$RESULT_PATH\"; then\n" +
        "        INSTALL_SUCCESS=1\n" +
        "    fi\n" +
        "fi\n\n" +
        "if [ \"$INSTALL_SUCCESS\" -ne 1 ]; then\n" +
        "    echo \"[$(date)] INSTALL FAILED: exit code $INSTALL_EXIT, response: $(cat \"$RESULT_PATH\" 2>/dev/null)\" >> \"$LOG_PATH\"\n" +
        "    echo \"[$(date)] Recovery: attempting to launch existing AmbiSun...\" >> \"$LOG_PATH\"\n" +
        "    luna-send -n 1 -w 5000 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n" +
        "    exit 1\n" +
        "fi\n\n" +
        "echo \"[$(date)] appInstallService returned success, verifying installed files...\" >> \"$LOG_PATH\"\n\n" +
        "# 3. Poll for installed appinfo.json and verify target version\n" +
        "FOUND_APPINFO=0\n" +
        "for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do\n" +
        "    if [ -f \"$APPINFO_PATH\" ]; then\n" +
        "        FOUND_APPINFO=1\n" +
        "        break\n" +
        "    fi\n" +
        "    sleep 1\n" +
        "done\n\n" +
        "if [ \"$FOUND_APPINFO\" -ne 1 ]; then\n" +
        "    echo \"[$(date)] VERSION VERIFY FAILED: $APPINFO_PATH not found after 30s\" >> \"$LOG_PATH\"\n" +
        "    echo \"[$(date)] Recovery: attempting to launch existing AmbiSun...\" >> \"$LOG_PATH\"\n" +
        "    luna-send -n 1 -w 5000 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n" +
        "    exit 1\n" +
        "fi\n\n" +
        "VERSION_MATCH=0\n" +
        "if grep -E -q '\"version\"[[:space:]]*:[[:space:]]*\"'$TARGET_VERSION'\"' \"$APPINFO_PATH\"; then\n" +
        "    VERSION_MATCH=1\n" +
        "fi\n\n" +
        "if [ \"$VERSION_MATCH\" -ne 1 ]; then\n" +
        "    echo \"[$(date)] VERSION VERIFY FAILED: Installed version does not match target $TARGET_VERSION\" >> \"$LOG_PATH\"\n" +
        "    echo \"[$(date)] Recovery: attempting to launch AmbiSun...\" >> \"$LOG_PATH\"\n" +
        "    luna-send -n 1 -w 5000 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n" +
        "    exit 1\n" +
        "fi\n\n" +
        "echo \"[$(date)] Installed version $TARGET_VERSION verified successfully.\" >> \"$LOG_PATH\"\n\n" +
        "# 4. Restore elevation after verified install with bounded retries\n" +
        "sleep 2\n" +
        "ELEV_SUCCESS=0\n" +
        "if [ -x \"$ELEVATE_BIN\" ]; then\n" +
        "    echo \"[$(date)] Restoring app and service elevation...\" >> \"$LOG_PATH\"\n" +
        "    for elev_attempt in 1 2 3 4 5; do\n" +
        "        echo \"[$(date)] Elevation attempt $elev_attempt/5...\" >> \"$LOG_PATH\"\n" +
        "        \"$ELEVATE_BIN\" \"$APP_ID\" >> \"$LOG_PATH\" 2>&1\n" +
        "        APP_ELEV_EXIT=$?\n" +
        "        \"$ELEVATE_BIN\" \"$SVC_ID\" >> \"$LOG_PATH\" 2>&1\n" +
        "        SVC_ELEV_EXIT=$?\n" +
        "        if [ \"$APP_ELEV_EXIT\" -eq 0 ] && [ \"$SVC_ELEV_EXIT\" -eq 0 ]; then\n" +
        "            ELEV_SUCCESS=1\n" +
        "            echo \"[$(date)] App and service elevation restored successfully on attempt $elev_attempt.\" >> \"$LOG_PATH\"\n" +
        "            break\n" +
        "        else\n" +
        "            echo \"[$(date)] Elevation attempt $elev_attempt failed: app=$APP_ELEV_EXIT service=$SVC_ELEV_EXIT.\" >> \"$LOG_PATH\"\n" +
        "            sleep 2\n" +
        "        fi\n" +
        "    done\n" +
        "    if [ \"$ELEV_SUCCESS\" -ne 1 ]; then\n" +
        "        echo \"[$(date)] Warning: Automatic elevation failed after 5 attempts. User can restore access manually in the UI.\" >> \"$LOG_PATH\"\n" +
        "    fi\n" +
        "else\n" +
        "    echo \"[$(date)] Warning: Elevate binary not found or not executable: $ELEVATE_BIN\" >> \"$LOG_PATH\"\n" +
        "fi\n\n" +
        "sleep 2\n\n" +
        "# 5. Launch updated app with bounded retries and response verification\n" +
        "LAUNCH_SUCCESS=0\n" +
        "echo \"[$(date)] Launching updated AmbiSun...\" >> \"$LOG_PATH\"\n" +
        "for launch_attempt in 1 2 3 4 5; do\n" +
        "    rm -f \"$RESULT_PATH\"\n" +
        "    echo \"[$(date)] Launch attempt $launch_attempt/5...\" >> \"$LOG_PATH\"\n" +
        "    luna-send -n 1 -w 5000 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' > \"$RESULT_PATH\" 2>&1\n" +
        "    LAUNCH_EXIT=$?\n" +
        "    cat \"$RESULT_PATH\" >> \"$LOG_PATH\"\n" +
        "    if [ \"$LAUNCH_EXIT\" -eq 0 ] && [ -f \"$RESULT_PATH\" ]; then\n" +
        "        if grep -E -q '\"returnValue\"[[:space:]]*:[[:space:]]*true' \"$RESULT_PATH\"; then\n" +
        "            LAUNCH_SUCCESS=1\n" +
        "            echo \"[$(date)] AmbiSun launched successfully on attempt $launch_attempt.\" >> \"$LOG_PATH\"\n" +
        "            break\n" +
        "        fi\n" +
        "    fi\n" +
        "    echo \"[$(date)] Launch attempt $launch_attempt failed, retrying in 2s...\" >> \"$LOG_PATH\"\n" +
        "    sleep 2\n" +
        "done\n\n" +
        "if [ \"$LAUNCH_SUCCESS\" -ne 1 ]; then\n" +
        "    echo \"[$(date)] Warning: Automatic launch did not succeed after 5 attempts. User can open AmbiSun manually.\" >> \"$LOG_PATH\"\n" +
        "fi\n\n" +
        "# 6. Clean up temporary files on verified success\n" +
        "echo \"[$(date)] Cleaning up temporary installation files...\" >> \"$LOG_PATH\"\n" +
        "rm -f \"$IPK_PATH\"\n" +
        "rm -f \"$RESULT_PATH\"\n" +
        "rm -f \"$HELPER_PATH\"\n" +
        "echo \"[$(date)] UPDATE COMPLETED SUCCESSFULLY\" >> \"$LOG_PATH\"\n";
}

function installUpdate(payload, serviceHandle, callback) {
    payload = payload || {};
    var expectedVer = payload.expectedVersion;

    if (!expectedVer || typeof expectedVer !== 'string' || !SEMVER_REGEX.test(expectedVer.trim())) {
        return callback(new Error("INVALID_EXPECTED_VERSION: expectedVersion is required and must be valid SemVer"));
    }
    expectedVer = expectedVer.trim();

    // Check lock
    var now = Date.now();
    if (isInstalling && (now - installStartedAt) < INSTALL_LOCK_TIMEOUT_MS) {
        return callback(new Error("UPDATE_ALREADY_IN_PROGRESS: Another update installation is already running"));
    }

    // Acquire lock immediately to protect against concurrent/duplicate requests
    isInstalling = true;
    installStartedAt = now;

    function releaseLock() {
        isInstalling = false;
        installStartedAt = 0;
    }

    function getManifest(cb) {
        if (cachedManifest &&
            (now - cachedManifest.fetchedAt) <= CACHE_TTL_MS &&
            verifyManifestSignature(cachedManifest)) {
            return cb(null, cachedManifest);
        }

        fetchAndValidateManifest(function(err, freshManifest) {
            if (err) return cb(err);
            cb(null, freshManifest);
        });
    }

    getManifest(function(err, manifest) {
        if (err) {
            releaseLock();
            return callback(new Error("UPDATE_CHECK_FAILED: " + (err.message || "Failed to fetch update manifest")));
        }

        if (expectedVer !== manifest.version) {
            releaseLock();
            return callback(new Error("VERSION_MISMATCH: Expected version " + expectedVer + " does not match manifest version " + manifest.version));
        }

        // Require target version to be strictly newer than installed version (prevent downgrade / same-version reinstall)
        var currentVer = getCurrentVersion();
        if (compareSemver(manifest.version, currentVer) !== 1) {
            releaseLock();
            return callback(new Error("NO_DOWNGRADE_OR_REINSTALL: Target version " + manifest.version + " is not newer than current installed version " + currentVer));
        }

        // Double check signature of manifest (fail-closed)
        if (!verifyManifestSignature(manifest)) {
            releaseLock();
            return callback(new Error("SIGNATURE_INVALID: Update manifest signature verification failed"));
        }

        var targetVersion = manifest.version;
        var targetSha256 = manifest.sha256;
        var targetSize = manifest.size;
        var downloadUrl = getExpectedIpkUrl(targetVersion);

        // Ensure temp dir exists
        try {
            if (!fs.existsSync(TEMP_DIR)) {
                fs.mkdirSync(TEMP_DIR, { recursive: true });
            }
        } catch (_) {}

        var ipkFileName = "ambisun-update-" + targetVersion + ".ipk";
        var ipkPath = path.join(TEMP_DIR, ipkFileName);
        var helperPath = path.join(TEMP_DIR, "ambisun-selfupdate.sh");
        var resultPath = path.join(TEMP_DIR, "ambisun-install-result.json");
        var logPath = path.join(TEMP_DIR, "ambisun-update.log");

        // Clean up any existing temp files before download
        try { fs.unlinkSync(ipkPath); } catch (_) {}
        try { fs.unlinkSync(helperPath); } catch (_) {}
        try { fs.unlinkSync(resultPath); } catch (_) {}

        var dlFn = activeDownloader || downloadFileWithHash;
        dlFn(downloadUrl, ipkPath, targetSize, IPK_MAX_BYTES, 0, function(dlErr, downloadResult) {
            if (dlErr) {
                try { fs.unlinkSync(ipkPath); } catch (_) {}
                releaseLock();
                return callback(new Error("DOWNLOAD_FAILED: " + dlErr.message));
            }

            var computedHash = downloadResult && downloadResult.hash;
            if (computedHash !== targetSha256) {
                try { fs.unlinkSync(ipkPath); } catch (_) {}
                releaseLock();
                return callback(new Error("UPDATE_HASH_MISMATCH: Computed " + computedHash + " expected " + targetSha256));
            }

            // Generate self-update helper script
            var helperScript = generateHelperScript(targetVersion, ipkPath, helperPath, resultPath, logPath);

            try {
                fs.writeFileSync(helperPath, helperScript, { mode: 493 }); // 0755
            } catch (e) {
                try { fs.unlinkSync(ipkPath); } catch (_) {}
                releaseLock();
                return callback(new Error("HELPER_WRITE_FAILED: " + e.message));
            }

            if (!serviceHandle || typeof serviceHandle.call !== 'function') {
                try { fs.unlinkSync(ipkPath); } catch (_) {}
                try { fs.unlinkSync(helperPath); } catch (_) {}
                releaseLock();
                return callback(new Error("UPDATE_HANDOFF_UNAVAILABLE: Service bridge is unavailable to trigger background execution"));
            }

            // Trigger helper script detached in background via hbchannel exec
            var execCmd = "sh " + helperPath + " >" + logPath + " 2>&1 &";
            serviceHandle.call("luna://org.webosbrew.hbchannel.service/exec", { command: execCmd }, function(res) {
                var resPayload = res && res.payload ? res.payload : res;
                if (resPayload && resPayload.returnValue === true) {
                    callback(null, {
                        returnValue: true,
                        stage: "installing",
                        targetVersion: targetVersion,
                        message: "Update installation handoff initiated"
                    });
                } else {
                    try { fs.unlinkSync(ipkPath); } catch (_) {}
                    try { fs.unlinkSync(helperPath); } catch (_) {}
                    releaseLock();
                    var errMsg = (resPayload && (resPayload.errorText || resPayload.error)) || "Failed to execute update helper via hbchannel";
                    callback(new Error("UPDATE_HANDOFF_FAILED: " + errMsg));
                }
            });
        });
    });
}

module.exports = {
    getCurrentVersion: getCurrentVersion,
    checkForUpdate: checkForUpdate,
    installUpdate: installUpdate,
    fetchAndValidateManifest: fetchAndValidateManifest,
    PRODUCTION_PUBLIC_KEY: PRODUCTION_PUBLIC_KEY,
    _compareSemver: compareSemver,
    _isUpdateAvailable: isUpdateAvailable,
    _getCanonicalPayload: getCanonicalPayload,
    _verifyManifestSignature: verifyManifestSignature,
    _isAllowedHost: isAllowedHost,
    _validateManifest: validateManifest,
    _setCachedManifest: function(m) { cachedManifest = m; },
    _getCachedManifest: function() { return cachedManifest; },
    _getExpectedIpkUrl: getExpectedIpkUrl,
    _generateHelperScript: generateHelperScript,
    _isInstalling: function() { return isInstalling; },
    _releaseLock: function() { isInstalling = false; installStartedAt = 0; },
    _acquireLock: function() { isInstalling = true; installStartedAt = Date.now(); },
    _setPublicKey: function(pk) { validation.setPublicKey(pk); },
    _resetPublicKey: function() { validation.resetPublicKey(); },
    _setManifestUrl: function(u) { MANIFEST_URL = u; },
    _resetManifestUrl: function() { MANIFEST_URL = "https://github.com/Serjio193/AmbiSun/releases/latest/download/update.json"; },
    _setTempDir: function(d) { TEMP_DIR = d; },
    _resetTempDir: function() { TEMP_DIR = "/media/developer/temp"; },
    _setFetcher: function(fn) { activeFetcher = fn; },
    _setDownloader: function(fn) { activeDownloader = fn; },
    _fetchWithRedirects: fetchWithRedirects,
    _downloadFileWithHash: downloadFileWithHash
};
