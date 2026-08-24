var crypto = require('crypto');

var IPK_MAX_BYTES = 52428800;
var SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;
var SHA256_REGEX = /^[a-f0-9]{64}$/i;
var PRODUCTION_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\n" +
    "MCowBQYDK2VwAyEA+RfgUWfN5e9kI520tAU8ibgzHX0avakHFI23enIhQ7M=\n" +
    "-----END PUBLIC KEY-----\n";
var activePublicKey = PRODUCTION_PUBLIC_KEY;

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
    return compareSemver(latestVer, currentVer) === 1;
}

function getCanonicalPayload(version, sha256, size) {
    return "ambisun-update-v1\nversion=" + version + "\nsha256=" + sha256 + "\nsize=" + size + "\n";
}

function verifyManifestSignature(manifest, publicKeyPem) {
    if (!manifest || typeof manifest !== 'object') return false;
    if (typeof manifest.signature !== 'string' || !manifest.signature.trim()) return false;
    if (typeof manifest.version !== 'string' || typeof manifest.sha256 !== 'string' || typeof manifest.size !== 'number') return false;
    var canonical = getCanonicalPayload(manifest.version.trim(), manifest.sha256.trim().toLowerCase(), manifest.size);
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
    var host = hostname.toLowerCase();
    return host === 'github.com' ||
        host === 'raw.githubusercontent.com' ||
        host === 'objects.githubusercontent.com' ||
        host === 'github-releases.githubusercontent.com' ||
        host.endsWith('.githubusercontent.com') ||
        host.endsWith('.github.com');
}

function validateManifest(manifest, publicKeyPem) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return "Manifest is not a valid JSON object";
    if (typeof manifest.version !== 'string' || !SEMVER_REGEX.test(manifest.version.trim())) return "Manifest missing or invalid version (must be MAJOR.MINOR.PATCH)";
    if (typeof manifest.sha256 !== 'string' || !SHA256_REGEX.test(manifest.sha256.trim())) return "Manifest missing or invalid sha256 (must be 64 hex chars)";
    if (typeof manifest.size !== 'number' || !Number.isInteger(manifest.size) || manifest.size <= 0 || manifest.size > IPK_MAX_BYTES) {
        return "Manifest missing or invalid size (must be positive integer <= " + IPK_MAX_BYTES + " bytes)";
    }
    if (typeof manifest.signature !== 'string' || !manifest.signature.trim()) return "Manifest missing signature";
    if (!verifyManifestSignature(manifest, publicKeyPem)) return "Signature verification failed";
    return null;
}

module.exports = {
    IPK_MAX_BYTES: IPK_MAX_BYTES,
    SEMVER_REGEX: SEMVER_REGEX,
    PRODUCTION_PUBLIC_KEY: PRODUCTION_PUBLIC_KEY,
    parseSemver: parseSemver,
    compareSemver: compareSemver,
    isUpdateAvailable: isUpdateAvailable,
    getCanonicalPayload: getCanonicalPayload,
    verifyManifestSignature: verifyManifestSignature,
    isAllowedHost: isAllowedHost,
    validateManifest: validateManifest,
    setPublicKey: function (publicKeyPem) { activePublicKey = publicKeyPem || PRODUCTION_PUBLIC_KEY; },
    resetPublicKey: function () { activePublicKey = PRODUCTION_PUBLIC_KEY; }
};
