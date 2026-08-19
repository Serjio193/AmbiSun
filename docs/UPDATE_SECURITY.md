# AmbiSun Update Security Architecture

This document describes the cryptographic authentication and security model for AmbiSun automated updates.

---

## 1. Threat Model & Security Goals

The AmbiSun in-app updater is designed to protect rooted LG webOS TVs against malicious or corrupted software updates.

### Security Guarantees
1. **Authenticity & Integrity**: Every update manifest is cryptographically signed using an offline Ed25519 private key.
2. **Deterministic Payload Canonicalization**: Signed fields (`version`, `sha256`, `size`) are normalized into a fixed canonical text format before signing and verification.
3. **No Arbitrary URLs**: The IPK download URL is constructed locally from the validated SemVer version; the manifest cannot point to arbitrary download locations.
4. **HTTPS & Redirect Restriction**: All network operations require HTTPS. Redirects are strictly limited to GitHub-controlled release domains (`github.com`, `*.githubusercontent.com`).
5. **Downgrade & Replay Prevention**: The updater rejects same-version reinstalls and version downgrades.
6. **Integrity Double-Check**: Before installation, the downloaded IPK is verified for exact byte length and SHA-256 hash.

---

## 2. Cryptographic Algorithm (Ed25519)

AmbiSun uses **Ed25519** (Edwards-curve Digital Signature Algorithm), supported natively by Node.js 12+ / 16+ on webOS:
- **Public Key**: Bundled into `service/com.github.serjio193.ambisun.service/lib/updater.js` in SPKI PEM format.
- **Private Key**: Kept strictly offline on the developer machine and **NEVER committed to git**.

---

## 3. Canonical Signed Payload

To prevent JSON formatting or whitespace discrepancies from affecting signature validation, the signature is computed on exact UTF-8 bytes of the following canonical format:

```text
ambisun-update-v1
version=<MAJOR.MINOR.PATCH>
sha256=<64 lowercase hex characters>
size=<decimal byte count>
```

*(Each line ends with a standard LF `\n` character, including the final line).*

### Manifest Format (`dist/update.json`):
```json
{
  "version": "0.1.1",
  "sha256": "3f2f12252c1ac571068ceea43312fbb5550a8c8cd601a65025b3c8169de22b80",
  "size": 986222,
  "signature": "gRp8Wr3fF03FedIdahfyMqPkhuWC18BjOuo29QZq2hbfpZd2C9U2khSYl51rGLRAHQcpkysL11GQxYaSNGoeBQ==",
  "notes": {
    "ru": "Исправления и улучшения",
    "en": "Fixes and improvements",
    "uk": "Виправлення та покращення",
    "et": "Parandused ja täiustused"
  }
}
```

---

## 4. Key Generation

To generate a new Ed25519 key pair using Node.js:

```javascript
const crypto = require('crypto');
const fs = require('fs');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// Save private key offline in a secure folder (outside repository!)
fs.writeFileSync('ambisun-release-signing-ed25519.key', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

// Export public key to embed in updater.js
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
```

---

## 5. Release Signing Workflow

When preparing a production release:

```powershell
# Run prepare-release with your offline private key
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-release.ps1 `
  -Version 0.1.1 `
  -SigningKeyPath "$HOME\ambisun-release-signing-ed25519.key"
```

The script:
1. Validates SemVer version format.
2. Builds the IPK package.
3. Calculates exact file size and SHA-256 hash.
4. Generates the canonical payload and signs it using the Ed25519 private key.
5. Writes `dist/update.json` and `dist/com.github.serjio193.ambisun.manifest.json`.

---

## 6. Key Rotation & Recovery

- If the private signing key is lost or compromised, the public key embedded in `updater.js` must be updated.
- Existing installed versions will not accept updates signed with a different key. Users will need to install the new version once manually (e.g. via Homebrew Channel or `deploy-tv.ps1`).
