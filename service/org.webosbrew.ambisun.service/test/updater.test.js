"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");

const updater = require("../lib/updater.js");

// Setup temporary test directory for updater
const testTempDir = path.join(os.tmpdir(), "ambisun-updater-test-" + Date.now());
fs.mkdirSync(testTempDir, { recursive: true });
updater._setTempDir(testTempDir);

// Generate Ed25519 keypair for tests
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const testPubKeyPem = publicKey.export({ type: "spki", format: "pem" });
updater._setPublicKey(testPubKeyPem);

function createSignedManifest(version, size, sha256) {
    const canonical = `ambisun-update-v1\nversion=${version}\nsha256=${sha256}\nsize=${size}\n`;
    const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey);
    return {
        version: version,
        sha256: sha256,
        size: size,
        signature: sig.toString("base64"),
        notes: { en: "Test update" }
    };
}

const validIpkContent = Buffer.from("DUMMY_IPK_CONTENT_FOR_TESTING_12345");
const validIpkSha256 = crypto.createHash("sha256").update(validIpkContent).digest("hex").toLowerCase();
const validIpkSize = validIpkContent.length;

// Mock serviceHandle
const mockServiceHandle = {
    call: function(uri, params, cb) {
        if (uri === "luna://org.webosbrew.hbchannel.service/exec") {
            return cb({ returnValue: true });
        }
        cb({ returnValue: false });
    }
};

let mockFetchManifestResult = null;
let mockDownloadResult = null;

function mockNetwork(fetchResult, downloadResult) {
    mockFetchManifestResult = fetchResult;
    mockDownloadResult = downloadResult;
}

function restoreNetwork() {
    mockFetchManifestResult = null;
    mockDownloadResult = null;
}

updater._setFetcher(function(targetUrl, maxBytes, redirectCount, cb) {
    if (mockFetchManifestResult) {
        if (mockFetchManifestResult.err) {
            return process.nextTick(() => cb(mockFetchManifestResult.err));
        }
        return process.nextTick(() => cb(null, mockFetchManifestResult.body));
    }
    return process.nextTick(() => cb(new Error("Unexpected unmocked fetch")));
});

updater._setDownloader(function(targetUrl, destPath, expectedSize, maxBytes, redirectCount, cb) {
    if (mockDownloadResult) {
        if (mockDownloadResult.err) {
            return process.nextTick(() => cb(mockDownloadResult.err));
        }
        fs.writeFileSync(destPath, validIpkContent);
        return process.nextTick(() => cb(null, { hash: validIpkSha256, size: validIpkSize }));
    }
    return process.nextTick(() => cb(new Error("Unexpected unmocked download")));
});

async function runTests() {
    console.log("=== RUNNING UPDATER TEST SUITE (A-I) ===");

    // Scenario A: cachedManifest exists + fresh -> install proceeds
    await new Promise((resolve, reject) => {
        console.log("\n[Test A] cachedManifest exists + fresh -> install proceeds");
        updater._releaseLock();
        const manifestA = createSignedManifest("0.2.0", validIpkSize, validIpkSha256);
        updater._setCachedManifest({
            version: manifestA.version,
            sha256: manifestA.sha256,
            size: manifestA.size,
            signature: manifestA.signature,
            notes: manifestA.notes,
            ipkUrl: updater._getExpectedIpkUrl("0.2.0"),
            fetchedAt: Date.now()
        });
        mockNetwork(null, { success: true });

        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err, res) => {
            try {
                assert.ifError(err);
                assert.strictEqual(res.returnValue, true);
                assert.strictEqual(res.stage, "installing");
                assert.strictEqual(res.targetVersion, "0.2.0");
                console.log("  [PASS] Scenario A passed");
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Scenario B: cachedManifest is null -> install refreshes manifest and proceeds
    await new Promise((resolve, reject) => {
        console.log("\n[Test B] cachedManifest is null -> install refreshes manifest and proceeds");
        updater._releaseLock();
        updater._setCachedManifest(null);

        const manifestB = createSignedManifest("0.2.0", validIpkSize, validIpkSha256);
        mockNetwork({ body: JSON.stringify(manifestB) }, { success: true });

        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err, res) => {
            try {
                assert.ifError(err);
                assert.strictEqual(res.returnValue, true);
                assert.strictEqual(res.stage, "installing");
                assert.strictEqual(res.targetVersion, "0.2.0");
                console.log("  [PASS] Scenario B passed");
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Scenario C: cachedManifest expired -> install refreshes manifest and proceeds
    await new Promise((resolve, reject) => {
        console.log("\n[Test C] cachedManifest expired -> install refreshes manifest and proceeds");
        updater._releaseLock();
        updater._setCachedManifest({
            version: "0.1.9",
            sha256: validIpkSha256,
            size: validIpkSize,
            signature: "dummy",
            fetchedAt: Date.now() - 3600000 // 1 hour ago (expired)
        });

        const manifestC = createSignedManifest("0.2.0", validIpkSize, validIpkSha256);
        mockNetwork({ body: JSON.stringify(manifestC) }, { success: true });

        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err, res) => {
            try {
                assert.ifError(err);
                assert.strictEqual(res.returnValue, true);
                assert.strictEqual(res.stage, "installing");
                assert.strictEqual(res.targetVersion, "0.2.0");
                console.log("  [PASS] Scenario C passed");
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Scenario D: refresh returns invalid signature -> install ABORT
    await new Promise((resolve, reject) => {
        console.log("\n[Test D] refresh returns invalid signature -> install ABORT");
        updater._releaseLock();
        updater._setCachedManifest(null);

        const manifestD = createSignedManifest("0.2.0", validIpkSize, validIpkSha256);
        manifestD.signature = Buffer.from(new Uint8Array(64).fill(1)).toString("base64"); // corrupted signature
        mockNetwork({ body: JSON.stringify(manifestD) }, { success: true });

        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err, res) => {
            try {
                assert(err !== null, "Should return error for invalid signature");
                assert.strictEqual(updater._isInstalling(), false, "Lock must be released");
                assert(err.message.includes("Signature verification failed") || err.message.includes("SIGNATURE_INVALID") || err.message.includes("UPDATE_CHECK_FAILED"));
                console.log("  [PASS] Scenario D passed:", err.message);
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Scenario E: fresh manifest version != expectedVersion -> VERSION_MISMATCH, no download/install
    await new Promise((resolve, reject) => {
        console.log("\n[Test E] fresh manifest version != expectedVersion -> VERSION_MISMATCH");
        updater._releaseLock();
        updater._setCachedManifest(null);

        const manifestE = createSignedManifest("0.2.0", validIpkSize, validIpkSha256);
        mockNetwork({ body: JSON.stringify(manifestE) }, { success: true });

        updater.installUpdate({ expectedVersion: "0.3.0" }, mockServiceHandle, (err, res) => {
            try {
                assert(err !== null, "Should return error on version mismatch");
                assert(err.message.includes("VERSION_MISMATCH"));
                assert.strictEqual(updater._isInstalling(), false, "Lock must be released");
                console.log("  [PASS] Scenario E passed:", err.message);
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Scenario F: same / downgrade version -> reject
    await new Promise((resolve, reject) => {
        console.log("\n[Test F] same or downgrade version -> reject");
        updater._releaseLock();
        updater._setCachedManifest(null);

        const currentVer = updater.getCurrentVersion(); // e.g. 0.1.1
        const manifestF = createSignedManifest(currentVer, validIpkSize, validIpkSha256);
        mockNetwork({ body: JSON.stringify(manifestF) }, { success: true });

        updater.installUpdate({ expectedVersion: currentVer }, mockServiceHandle, (err, res) => {
            try {
                assert(err !== null, "Should reject same/downgrade version");
                assert(err.message.includes("NO_DOWNGRADE_OR_REINSTALL"));
                assert.strictEqual(updater._isInstalling(), false, "Lock must be released");
                console.log("  [PASS] Scenario F passed:", err.message);
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Scenario G: two simultaneous installUpdate calls -> only one allowed
    await new Promise((resolve, reject) => {
        console.log("\n[Test G] two simultaneous installUpdate calls -> only one allowed");
        updater._releaseLock();
        updater._setCachedManifest(null);

        const manifestG = createSignedManifest("0.2.0", validIpkSize, validIpkSha256);
        mockNetwork({ body: JSON.stringify(manifestG) }, { success: true });

        let firstCompleted = false;
        let secondCompleted = false;
        let secondErr = null;

        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err1, res1) => {
            firstCompleted = true;
            assert.ifError(err1);
            assert.strictEqual(res1.returnValue, true);
        });

        // Immediately attempt second call while first is in progress
        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err2, res2) => {
            secondCompleted = true;
            secondErr = err2;
        });

        setTimeout(() => {
            try {
                assert.strictEqual(firstCompleted, true, "First install should complete");
                assert.strictEqual(secondCompleted, true, "Second install should be rejected");
                assert(secondErr !== null, "Second install must return error");
                assert(secondErr.message.includes("UPDATE_ALREADY_IN_PROGRESS"));
                console.log("  [PASS] Scenario G passed (Concurrent install blocked by lock)");
                resolve();
            } catch (e) { reject(e); }
        }, 50);
    });

    // Scenario H: manifest refresh network failure -> clean error, lock released
    await new Promise((resolve, reject) => {
        console.log("\n[Test H] manifest refresh network failure -> clean error, lock released");
        updater._releaseLock();
        updater._setCachedManifest(null);

        mockNetwork({ err: new Error("ENOTFOUND github.com") }, null);

        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err, res) => {
            try {
                assert(err !== null, "Should return network error");
                assert(err.message.includes("ENOTFOUND") || err.message.includes("UPDATE_CHECK_FAILED"));
                assert.strictEqual(updater._isInstalling(), false, "Lock must be released on network failure");
                console.log("  [PASS] Scenario H passed:", err.message);
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Scenario I: subsequent retry after failed refresh -> possible, lock not stuck
    await new Promise((resolve, reject) => {
        console.log("\n[Test I] subsequent retry after failed refresh -> possible, lock not stuck");
        // State is after failed Scenario H
        assert.strictEqual(updater._isInstalling(), false, "Lock must be free before retry");

        const manifestI = createSignedManifest("0.2.0", validIpkSize, validIpkSha256);
        mockNetwork({ body: JSON.stringify(manifestI) }, { success: true });

        updater.installUpdate({ expectedVersion: "0.2.0" }, mockServiceHandle, (err, res) => {
            try {
                assert.ifError(err);
                assert.strictEqual(res.returnValue, true);
                assert.strictEqual(res.stage, "installing");
                console.log("  [PASS] Scenario I passed (Retry succeeded, lock was not stuck)");
                resolve();
            } catch (e) { reject(e); }
        });
    });

    // Cleanup
    updater._resetPublicKey();
    updater._resetTempDir();
    updater._releaseLock();
    updater._setCachedManifest(null);
    updater._setFetcher(null);
    updater._setDownloader(null);
    restoreNetwork();
    try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch (_) {}

    console.log("\n=========================================");
    console.log("ALL SCENARIOS A-I PASSED SUCCESSFULLY!");
    console.log("=========================================");
}

runTests().catch((err) => {
    console.error("Test failure:", err);
    process.exit(1);
});
