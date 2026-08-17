var https = require('https');
var url = require('url');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var MANIFEST_URL = "https://github.com/Serjio193/AmbiSun/releases/latest/download/update.json";
var MANIFEST_MAX_BYTES = 131072; // 128 KB
var IPK_MAX_BYTES = 52428800;    // 50 MB
var HTTP_TIMEOUT_MS = 8000;
var CACHE_TTL_MS = 1800000;       // 30 minutes
var INSTALL_LOCK_TIMEOUT_MS = 300000; // 5 minutes failsafe lock timeout

var TEMP_DIR = "/media/developer/temp";
var SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;
var SHA256_REGEX = /^[a-f0-9]{64}$/i;

// Public verification key only.
// Private signing key must never be committed to the repository or bundled into the application.
var PRODUCTION_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\n" +
    "MCowBQYDK2VwAyEA+RfgUWfN5e9kI520tAU8ibgzHX0avakHFI23enIhQ7M=\n" +
    "-----END PUBLIC KEY-----\n";

var activePublicKey = PRODUCTION_PUBLIC_KEY;
var cachedManifest = null;
var isInstalling = false;
var installStartedAt = 0;

function getCurrentVersion() {
    try {
        var pkg = require('../package.json');
        if (pkg && pkg.version && SEMVER_REGEX.test(pkg.version)) {
            return pkg.version;
        }
    } catch (_) {}
    return "0.1.0";
}

function parseSemver(v) {
    if (typeof v !== 'string') return null;
    var m = v.trim().match(SEMVER_REGEX);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function compareSemver(v1, v2) {
    var p1 = parseSemver(v1);
    var p2 = parseSemver(v2);
    if (!p1 || !p2) return null;

    for (var i = 0; i < 3; i++) {
        if (p1[i] > p2[i]) return 1;
        if (p1[i] < p2[i]) return -1;
    }
    return 0;
}

function isUpdateAvailable(currentVer, latestVer) {
    var cmp = compareSemver(latestVer, currentVer);
    return cmp === 1;
}

function getExpectedIpkUrl(version) {
    return "https://github.com/Serjio193/AmbiSun/releases/download/v" + version + "/org.webosbrew.ambisun_" + version + "_all.ipk";
}

function getCanonicalPayload(version, sha256, size) {
    return "ambisun-update-v1\nversion=" + version + "\nsha256=" + sha256 + "\nsize=" + size + "\n";
}

function verifyManifestSignature(manifest, publicKeyPem) {
    if (!manifest || typeof manifest !== 'object') return false;
    if (typeof manifest.signature !== 'string' || !manifest.signature.trim()) return false;
    if (typeof manifest.version !== 'string' || typeof manifest.sha256 !== 'string' || typeof manifest.size !== 'number') return false;

    var canonical = getCanonicalPayload(
        manifest.version.trim(),
        manifest.sha256.trim().toLowerCase(),
        manifest.size
    );
    var data = Buffer.from(canonical, 'utf8');
    var sigBuf;
    try {
        sigBuf = Buffer.from(manifest.signature.trim(), 'base64');
        if (sigBuf.length !== 64) return false;
    } catch (_) {
        return false;
    }

    try {
        var keyObj = crypto.createPublicKey(publicKeyPem || activePublicKey);
        return crypto.verify(null, data, keyObj, sigBuf);
    } catch (_) {
        return false;
    }
}

function isAllowedHost(hostname) {
    if (!hostname || typeof hostname !== 'string') return false;
    var h = hostname.toLowerCase();
    return h === 'github.com' ||
           h === 'raw.githubusercontent.com' ||
           h === 'objects.githubusercontent.com' ||
           h === 'github-releases.githubusercontent.com' ||
           h.endsWith('.githubusercontent.com') ||
           h.endsWith('.github.com');
}

function validateManifest(manifest, publicKeyPem) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return "Manifest is not a valid JSON object";
    }
    if (typeof manifest.version !== 'string' || !SEMVER_REGEX.test(manifest.version.trim())) {
        return "Manifest missing or invalid version (must be MAJOR.MINOR.PATCH)";
    }
    if (typeof manifest.sha256 !== 'string' || !SHA256_REGEX.test(manifest.sha256.trim())) {
        return "Manifest missing or invalid sha256 (must be 64 hex chars)";
    }
    if (typeof manifest.size !== 'number' || !Number.isInteger(manifest.size) || manifest.size <= 0 || manifest.size > IPK_MAX_BYTES) {
        return "Manifest missing or invalid size (must be positive integer <= " + IPK_MAX_BYTES + " bytes)";
    }
    if (typeof manifest.signature !== 'string' || !manifest.signature.trim()) {
        return "Manifest missing signature";
    }
    if (!verifyManifestSignature(manifest, publicKeyPem)) {
        return "Signature verification failed";
    }
    return null;
}

function fetchWithRedirects(targetUrl, maxBytes, redirectCount, callback) {
    var settled = false;
    function finish(err, result) {
        if (settled) return;
        settled = true;
        callback(err, result);
    }

    if (redirectCount > 5) {
        return finish(new Error("Too many redirects"));
    }

    var parsedUrl;
    try {
        parsedUrl = url.parse(targetUrl);
    } catch (e) {
        return finish(new Error("Invalid URL: " + targetUrl));
    }

    if (parsedUrl.protocol !== 'https:') {
        return finish(new Error(redirectCount > 0 ? "INSECURE_REDIRECT: Downgrade to http is not allowed" : "HTTPS_REQUIRED: Protocol must be https:"));
    }

    if (!isAllowedHost(parsedUrl.hostname)) {
        return finish(new Error("UNTRUSTED_REDIRECT_HOST: Target or redirect host '" + parsedUrl.hostname + "' is not in allowed GitHub domains"));
    }

    var options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        headers: {
            'User-Agent': 'AmbiSun-Updater/1.0'
        },
        timeout: HTTP_TIMEOUT_MS
    };

    var req = https.get(options, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            var nextUrl = url.resolve(targetUrl, res.headers.location);
            res.resume();
            return fetchWithRedirects(nextUrl, maxBytes, redirectCount + 1, finish);
        }

        if (res.statusCode !== 200) {
            res.resume();
            return finish(new Error("HTTP error " + res.statusCode));
        }

        var chunks = [];
        var totalBytes = 0;

        res.on('data', function(chunk) {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                req.destroy();
                return finish(new Error("Response exceeds size limit of " + maxBytes + " bytes"));
            }
            chunks.push(chunk);
        });

        res.on('end', function() {
            var body = Buffer.concat(chunks).toString('utf8');
            finish(null, body);
        });
    });

    req.on('timeout', function() {
        req.destroy();
        finish(new Error("Request timeout"));
    });

    req.on('error', function(err) {
        finish(err);
    });
}

function checkForUpdate(callback) {
    var currentVer = getCurrentVersion();

    fetchWithRedirects(MANIFEST_URL, MANIFEST_MAX_BYTES, 0, function(err, body) {
        if (err) {
            return callback(null, {
                returnValue: false,
                currentVersion: currentVer,
                errorCode: "CHECK_FAILED",
                errorText: err.message
            });
        }

        var manifest;
        try {
            manifest = JSON.parse(body);
        } catch (e) {
            return callback(null, {
                returnValue: false,
                currentVersion: currentVer,
                errorCode: "INVALID_JSON",
                errorText: "Failed to parse update manifest JSON"
            });
        }

        var valErr = validateManifest(manifest, activePublicKey);
        if (valErr) {
            return callback(null, {
                returnValue: false,
                currentVersion: currentVer,
                errorCode: "INVALID_MANIFEST",
                errorText: valErr
            });
        }

        var latestVer = manifest.version.trim();
        var sha256 = manifest.sha256.trim().toLowerCase();
        var size = manifest.size;
        var updateAvail = isUpdateAvailable(currentVer, latestVer);
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

        callback(null, {
            returnValue: true,
            currentVersion: currentVer,
            updateAvailable: updateAvail,
            latestVersion: latestVer,
            notes: manifest.notes || {}
        });
    });
}

function downloadFileWithHash(targetUrl, destPath, expectedSize, maxBytes, redirectCount, callback) {
    var settled = false;
    function finish(err, result) {
        if (settled) return;
        settled = true;
        callback(err, result);
    }

    if (redirectCount > 5) {
        return finish(new Error("Too many redirects"));
    }

    var parsedUrl;
    try {
        parsedUrl = url.parse(targetUrl);
    } catch (e) {
        return finish(new Error("Invalid URL: " + targetUrl));
    }

    if (parsedUrl.protocol !== 'https:') {
        return finish(new Error(redirectCount > 0 ? "INSECURE_REDIRECT: Downgrade to http is not allowed" : "HTTPS_REQUIRED: Protocol must be https:"));
    }

    if (!isAllowedHost(parsedUrl.hostname)) {
        return finish(new Error("UNTRUSTED_REDIRECT_HOST: Target or redirect host '" + parsedUrl.hostname + "' is not in allowed GitHub domains"));
    }

    var options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        headers: {
            'User-Agent': 'AmbiSun-Updater/1.0'
        },
        timeout: HTTP_TIMEOUT_MS * 2
    };

    var req = https.get(options, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            var nextUrl = url.resolve(targetUrl, res.headers.location);
            res.resume();
            return downloadFileWithHash(nextUrl, destPath, expectedSize, maxBytes, redirectCount + 1, finish);
        }

        if (res.statusCode !== 200) {
            res.resume();
            return finish(new Error("HTTP error " + res.statusCode));
        }

        var hash = crypto.createHash('sha256');
        var outStream = fs.createWriteStream(destPath);
        var totalBytes = 0;

        function cleanup(err, computedResult) {
            if (err) {
                try { fs.unlinkSync(destPath); } catch (_) {}
                return finish(err);
            }
            finish(null, computedResult);
        }

        res.on('data', function(chunk) {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                req.destroy();
                outStream.destroy();
                return cleanup(new Error("Download exceeds maximum allowed size of " + maxBytes + " bytes"));
            }
            hash.update(chunk);
            outStream.write(chunk);
        });

        res.on('end', function() {
            outStream.end(function() {
                if (typeof expectedSize === 'number' && expectedSize > 0 && totalBytes !== expectedSize) {
                    return cleanup(new Error("UPDATE_SIZE_MISMATCH: Downloaded " + totalBytes + " bytes, expected " + expectedSize));
                }
                var computedHash = hash.digest('hex').toLowerCase();
                cleanup(null, { hash: computedHash, size: totalBytes });
            });
        });

        outStream.on('error', function(err) {
            req.destroy();
            cleanup(err);
        });
    });

    req.on('timeout', function() {
        req.destroy();
        finish(new Error("Download timeout"));
    });

    req.on('error', function(err) {
        finish(err);
    });
}

function generateHelperScript(targetVersion, ipkPath, helperPath, resultPath, logPath) {
    return "#!/bin/sh\n" +
        "IPK_PATH=\"" + ipkPath + "\"\n" +
        "HELPER_PATH=\"" + helperPath + "\"\n" +
        "RESULT_PATH=\"" + resultPath + "\"\n" +
        "LOG_PATH=\"" + logPath + "\"\n" +
        "APP_ID=\"org.webosbrew.ambisun\"\n" +
        "SVC_ID=\"org.webosbrew.ambisun.service\"\n" +
        "TARGET_VERSION=\"" + targetVersion + "\"\n" +
        "APPINFO_PATH=\"/media/developer/apps/usr/palm/applications/org.webosbrew.ambisun/appinfo.json\"\n" +
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
        "    luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n" +
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
        "    luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n" +
        "    exit 1\n" +
        "fi\n\n" +
        "VERSION_MATCH=0\n" +
        "if grep -E -q '\"version\"[[:space:]]*:[[:space:]]*\"'$TARGET_VERSION'\"' \"$APPINFO_PATH\"; then\n" +
        "    VERSION_MATCH=1\n" +
        "fi\n\n" +
        "if [ \"$VERSION_MATCH\" -ne 1 ]; then\n" +
        "    echo \"[$(date)] VERSION VERIFY FAILED: Installed version does not match target $TARGET_VERSION\" >> \"$LOG_PATH\"\n" +
        "    echo \"[$(date)] Recovery: attempting to launch AmbiSun...\" >> \"$LOG_PATH\"\n" +
        "    luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n" +
        "    exit 1\n" +
        "fi\n\n" +
        "echo \"[$(date)] Installed version $TARGET_VERSION verified successfully.\" >> \"$LOG_PATH\"\n\n" +
        "# 4. Restore elevation after verified install\n" +
        "sleep 2\n" +
        "if [ -x \"$ELEVATE_BIN\" ]; then\n" +
        "    echo \"[$(date)] Restoring elevation...\" >> \"$LOG_PATH\"\n" +
        "    \"$ELEVATE_BIN\" \"$SVC_ID\" >> \"$LOG_PATH\" 2>&1\n" +
        "    ELEV_EXIT=$?\n" +
        "    if [ \"$ELEV_EXIT\" -ne 0 ]; then\n" +
        "        echo \"[$(date)] ELEVATION FAILED with code $ELEV_EXIT\" >> \"$LOG_PATH\"\n" +
        "    else\n" +
        "        echo \"[$(date)] Elevation restored successfully.\" >> \"$LOG_PATH\"\n" +
        "    fi\n" +
        "else\n" +
        "    echo \"[$(date)] ELEVATION FAILED: Elevate binary not found or not executable: $ELEVATE_BIN\" >> \"$LOG_PATH\"\n" +
        "fi\n\n" +
        "sleep 2\n\n" +
        "# 5. Launch updated app\n" +
        "echo \"[$(date)] Launching updated AmbiSun...\" >> \"$LOG_PATH\"\n" +
        "luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n\n" +
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

    // Check lock
    var now = Date.now();
    if (isInstalling && (now - installStartedAt) < INSTALL_LOCK_TIMEOUT_MS) {
        return callback(new Error("UPDATE_ALREADY_IN_PROGRESS: Another update installation is already running"));
    }

    if (!cachedManifest) {
        return callback(new Error("NO_UPDATE_CHECK: Check for update first"));
    }

    if (now - cachedManifest.fetchedAt > CACHE_TTL_MS) {
        return callback(new Error("UPDATE_EXPIRED: Manifest is older than 30 minutes. Check for update again"));
    }

    if (!expectedVer || expectedVer !== cachedManifest.version) {
        return callback(new Error("VERSION_MISMATCH: Expected version " + expectedVer + " does not match cached version " + cachedManifest.version));
    }

    // Require target version to be strictly newer than installed version (prevent downgrade / same-version reinstall)
    var currentVer = getCurrentVersion();
    if (compareSemver(cachedManifest.version, currentVer) !== 1) {
        return callback(new Error("NO_DOWNGRADE_OR_REINSTALL: Target version " + cachedManifest.version + " is not newer than current installed version " + currentVer));
    }

    // Double check signature of cached manifest
    if (!verifyManifestSignature(cachedManifest, activePublicKey)) {
        return callback(new Error("SIGNATURE_INVALID: Cached update manifest signature verification failed"));
    }

    // Acquire lock
    isInstalling = true;
    installStartedAt = now;

    function releaseLock() {
        isInstalling = false;
        installStartedAt = 0;
    }

    var targetVersion = cachedManifest.version;
    var targetSha256 = cachedManifest.sha256;
    var targetSize = cachedManifest.size;
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

    downloadFileWithHash(downloadUrl, ipkPath, targetSize, IPK_MAX_BYTES, 0, function(err, downloadResult) {
        if (err) {
            try { fs.unlinkSync(ipkPath); } catch (_) {}
            releaseLock();
            return callback(new Error("DOWNLOAD_FAILED: " + err.message));
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
            var payload = res && res.payload ? res.payload : res;
            if (payload && payload.returnValue === true) {
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
                var errMsg = (payload && (payload.errorText || payload.error)) || "Failed to execute update helper via hbchannel";
                callback(new Error("UPDATE_HANDOFF_FAILED: " + errMsg));
            }
        });
    });
}

module.exports = {
    getCurrentVersion: getCurrentVersion,
    checkForUpdate: checkForUpdate,
    installUpdate: installUpdate,
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
    _setPublicKey: function(pk) { activePublicKey = pk; },
    _resetPublicKey: function() { activePublicKey = PRODUCTION_PUBLIC_KEY; },
    _fetchWithRedirects: fetchWithRedirects,
    _downloadFileWithHash: downloadFileWithHash
};
