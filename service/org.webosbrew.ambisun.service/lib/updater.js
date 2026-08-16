var https = require('https');
var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var MANIFEST_URL = "https://github.com/Serjio193/AmbiSun/releases/latest/download/update.json";
var MANIFEST_MAX_BYTES = 131072; // 128 KB
var IPK_MAX_BYTES = 52428800;    // 50 MB
var HTTP_TIMEOUT_MS = 8000;
var CACHE_TTL_MS = 1800000;       // 30 minutes

var TEMP_DIR = "/media/developer/temp";
var SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;
var SHA256_REGEX = /^[a-f0-9]{64}$/i;

var cachedManifest = null;

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

function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return "Manifest is not a valid JSON object";
    }
    if (typeof manifest.version !== 'string' || !SEMVER_REGEX.test(manifest.version.trim())) {
        return "Manifest missing or invalid version (must be MAJOR.MINOR.PATCH)";
    }
    if (typeof manifest.sha256 !== 'string' || !SHA256_REGEX.test(manifest.sha256.trim())) {
        return "Manifest missing or invalid sha256 (must be 64 hex chars)";
    }
    return null;
}

function fetchWithRedirects(targetUrl, maxBytes, redirectCount, callback) {
    if (redirectCount > 5) {
        return callback(new Error("Too many redirects"));
    }

    var parsedUrl;
    try {
        parsedUrl = url.parse(targetUrl);
    } catch (e) {
        return callback(new Error("Invalid URL: " + targetUrl));
    }

    var client = (parsedUrl.protocol === 'https:') ? https : http;
    var options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.path,
        headers: {
            'User-Agent': 'AmbiSun-Updater/1.0'
        },
        timeout: HTTP_TIMEOUT_MS
    };

    var req = client.get(options, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            var nextUrl = url.resolve(targetUrl, res.headers.location);
            res.resume();
            return fetchWithRedirects(nextUrl, maxBytes, redirectCount + 1, callback);
        }

        if (res.statusCode !== 200) {
            res.resume();
            return callback(new Error("HTTP error " + res.statusCode));
        }

        var chunks = [];
        var totalBytes = 0;

        res.on('data', function(chunk) {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                req.destroy();
                return callback(new Error("Response exceeds size limit of " + maxBytes + " bytes"));
            }
            chunks.push(chunk);
        });

        res.on('end', function() {
            var body = Buffer.concat(chunks).toString('utf8');
            callback(null, body);
        });
    });

    req.on('timeout', function() {
        req.destroy();
        callback(new Error("Request timeout"));
    });

    req.on('error', function(err) {
        callback(err);
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

        var valErr = validateManifest(manifest);
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
        var updateAvail = isUpdateAvailable(currentVer, latestVer);
        var ipkUrl = getExpectedIpkUrl(latestVer);

        cachedManifest = {
            version: latestVer,
            sha256: sha256,
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

function downloadFileWithHash(targetUrl, destPath, maxBytes, redirectCount, callback) {
    if (redirectCount > 5) {
        return callback(new Error("Too many redirects"));
    }

    var parsedUrl;
    try {
        parsedUrl = url.parse(targetUrl);
    } catch (e) {
        return callback(new Error("Invalid URL: " + targetUrl));
    }

    var client = (parsedUrl.protocol === 'https:') ? https : http;
    var options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.path,
        headers: {
            'User-Agent': 'AmbiSun-Updater/1.0'
        },
        timeout: HTTP_TIMEOUT_MS * 2
    };

    var req = client.get(options, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            var nextUrl = url.resolve(targetUrl, res.headers.location);
            res.resume();
            return downloadFileWithHash(nextUrl, destPath, maxBytes, redirectCount + 1, callback);
        }

        if (res.statusCode !== 200) {
            res.resume();
            return callback(new Error("HTTP error " + res.statusCode));
        }

        var hash = crypto.createHash('sha256');
        var outStream = fs.createWriteStream(destPath);
        var totalBytes = 0;
        var finished = false;

        function cleanup(err, computedHash) {
            if (finished) return;
            finished = true;
            if (err) {
                try { fs.unlinkSync(destPath); } catch (_) {}
                return callback(err);
            }
            callback(null, computedHash);
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
                var computedHash = hash.digest('hex').toLowerCase();
                cleanup(null, computedHash);
            });
        });

        outStream.on('error', function(err) {
            req.destroy();
            cleanup(err);
        });
    });

    req.on('timeout', function() {
        req.destroy();
        callback(new Error("Download timeout"));
    });

    req.on('error', function(err) {
        callback(err);
    });
}

function installUpdate(payload, serviceHandle, callback) {
    payload = payload || {};
    var expectedVer = payload.expectedVersion;

    if (!cachedManifest) {
        return callback(new Error("NO_UPDATE_CHECK: Check for update first"));
    }

    if (Date.now() - cachedManifest.fetchedAt > CACHE_TTL_MS) {
        return callback(new Error("UPDATE_EXPIRED: Manifest is older than 30 minutes. Check for update again"));
    }

    if (!expectedVer || expectedVer !== cachedManifest.version) {
        return callback(new Error("VERSION_MISMATCH: Expected version " + expectedVer + " does not match cached version " + cachedManifest.version));
    }

    var targetVersion = cachedManifest.version;
    var targetSha256 = cachedManifest.sha256;
    var downloadUrl = cachedManifest.ipkUrl;

    // Ensure temp dir exists
    try {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
    } catch (_) {}

    var ipkFileName = "ambisun-update-" + targetVersion + ".ipk";
    var ipkPath = path.join(TEMP_DIR, ipkFileName);
    var helperPath = path.join(TEMP_DIR, "ambisun-selfupdate.sh");
    var logPath = path.join(TEMP_DIR, "ambisun-update.log");

    downloadFileWithHash(downloadUrl, ipkPath, IPK_MAX_BYTES, 0, function(err, computedHash) {
        if (err) {
            return callback(new Error("DOWNLOAD_FAILED: " + err.message));
        }

        if (computedHash !== targetSha256) {
            try { fs.unlinkSync(ipkPath); } catch (_) {}
            return callback(new Error("UPDATE_HASH_MISMATCH: Computed " + computedHash + " expected " + targetSha256));
        }

        // Create self-update helper script
        var helperScript = "#!/bin/sh\n" +
            "IPK_PATH=\"" + ipkPath + "\"\n" +
            "LOG_PATH=\"" + logPath + "\"\n" +
            "APP_ID=\"org.webosbrew.ambisun\"\n" +
            "SVC_ID=\"org.webosbrew.ambisun.service\"\n" +
            "ELEVATE_BIN=\"/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service\"\n\n" +
            "echo \"[$(date)] Starting AmbiSun update to " + targetVersion + "...\" >> \"$LOG_PATH\"\n" +
            "sleep 2\n\n" +
            "# 1. Install IPK via appInstallService\n" +
            "echo \"[$(date)] Installing IPK...\" >> \"$LOG_PATH\"\n" +
            "luna-send -n 1 -w 60000 luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"" + ipkPath + "\",\"subscribe\":false}' >> \"$LOG_PATH\" 2>&1\n" +
            "INSTALL_EXIT=$?\n" +
            "echo \"[$(date)] Install command completed with code $INSTALL_EXIT\" >> \"$LOG_PATH\"\n\n" +
            "# 2. Wait and restore elevation\n" +
            "sleep 3\n" +
            "if [ -x \"$ELEVATE_BIN\" ]; then\n" +
            "    echo \"[$(date)] Restoring elevation...\" >> \"$LOG_PATH\"\n" +
            "    \"$ELEVATE_BIN\" \"$SVC_ID\" >> \"$LOG_PATH\" 2>&1\n" +
            "fi\n\n" +
            "sleep 2\n\n" +
            "# 3. Launch updated app\n" +
            "echo \"[$(date)] Launching AmbiSun...\" >> \"$LOG_PATH\"\n" +
            "luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"'\"$APP_ID\"'\"}' >> \"$LOG_PATH\" 2>&1\n\n" +
            "# 4. Clean up downloaded IPK and script\n" +
            "rm -f \"$IPK_PATH\"\n" +
            "rm -f \"" + helperPath + "\"\n" +
            "echo \"[$(date)] Update process completed successfully.\" >> \"$LOG_PATH\"\n";

        try {
            fs.writeFileSync(helperPath, helperScript, { mode: 493 }); // 0755
        } catch (e) {
            try { fs.unlinkSync(ipkPath); } catch (_) {}
            return callback(new Error("HELPER_WRITE_FAILED: " + e.message));
        }

        // Trigger helper script detached in background via hbchannel exec
        if (serviceHandle && typeof serviceHandle.call === 'function') {
            var execCmd = "sh " + helperPath + " >" + logPath + " 2>&1 &";
            serviceHandle.call("luna://org.webosbrew.hbchannel.service/exec", { command: execCmd }, function(res) {
                // Background execution dispatched
            });
        }

        callback(null, {
            returnValue: true,
            stage: "installing",
            targetVersion: targetVersion,
            message: "Update installation handoff initiated"
        });
    });
}

module.exports = {
    getCurrentVersion: getCurrentVersion,
    checkForUpdate: checkForUpdate,
    installUpdate: installUpdate,
    _compareSemver: compareSemver,
    _isUpdateAvailable: isUpdateAvailable,
    _validateManifest: validateManifest,
    _setCachedManifest: function(m) { cachedManifest = m; },
    _getCachedManifest: function() { return cachedManifest; },
    _getExpectedIpkUrl: getExpectedIpkUrl
};
