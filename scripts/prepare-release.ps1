param (
    [Parameter(Mandatory=$true)]
    [string]$Version,
    [string]$SigningKeyPath,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# 1. Strict SemVer validation
$SemverRegex = '^\d+\.\d+\.\d+$'
if ($Version -notmatch $SemverRegex) {
    throw "Invalid SemVer format: '$Version'. Must strictly match MAJOR.MINOR.PATCH (e.g. 0.1.1)."
}

# 2. Paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$AppInfoPath = Join-Path $RepoRoot "appinfo.json"
$ServicePackagePath = Join-Path $RepoRoot "service\com.github.serjio193.ambisun.service\package.json"
$PublicKeyPath = Join-Path $RepoRoot "release\update-public-key.pem"
$DistDir = Join-Path $RepoRoot "dist"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 3. Read production public key
if (-not (Test-Path $PublicKeyPath)) {
    throw "Production public key file not found: $PublicKeyPath"
}
$ProductionPublicKeyPem = [System.IO.File]::ReadAllText($PublicKeyPath, [System.Text.Encoding]::UTF8)

# 4. Resolve and verify signing key BEFORE build or metadata changes
$EffectiveSigningKey = $SigningKeyPath
if (-not $EffectiveSigningKey -and $env:AMBISUN_SIGNING_KEY_PATH) {
    $EffectiveSigningKey = $env:AMBISUN_SIGNING_KEY_PATH
}

$EphemeralKeyUsed = $false
if (-not $EffectiveSigningKey) {
    $DefaultHomeKey = Join-Path $HOME "ambisun-release-signing-ed25519.key"
    if (Test-Path $DefaultHomeKey) {
        $EffectiveSigningKey = $DefaultHomeKey
    } elseif ($DryRun) {
        $EphemeralKeyUsed = $true
        Write-Host "Notice: No signing key provided for DryRun. Using ephemeral in-memory Ed25519 key for simulation."
        Write-Host "SIGNATURE TYPE: EPHEMERAL TEST SIGNATURE (NOT VALID FOR PRODUCTION UPDATER)"
    } else {
        throw "RELEASE ERROR: Private Ed25519 signing key is required for real release preparation. Pass -SigningKeyPath <path> or set `$env:AMBISUN_SIGNING_KEY_PATH."
    }
}

if (-not $EphemeralKeyUsed) {
    if (-not (Test-Path $EffectiveSigningKey)) {
        throw "Signing key file not found: $EffectiveSigningKey"
    }

    # Verify that private key matches production public key
    $PreVerifyScript = @"
const crypto = require('crypto');
const fs = require('fs');
const privPath = process.argv[1];
const pubPem = process.argv[2];

try {
    const privPem = fs.readFileSync(privPath, 'utf8');
    const privKey = crypto.createPrivateKey(privPem);
    const derivedPub = crypto.createPublicKey(privKey);
    const derivedDer = derivedPub.export({ type: 'spki', format: 'der' });
    const derivedFingerprint = crypto.createHash('sha256').update(derivedDer).digest('hex');

    const expectedPub = crypto.createPublicKey(pubPem);
    const expectedDer = expectedPub.export({ type: 'spki', format: 'der' });
    const expectedFingerprint = crypto.createHash('sha256').update(expectedDer).digest('hex');

    const challenge = 'ambisun-signing-key-check-v1\n';
    const sig = crypto.sign(null, Buffer.from(challenge, 'utf8'), privKey);
    const verified = crypto.verify(null, Buffer.from(challenge, 'utf8'), expectedPub, sig);

    process.stdout.write(JSON.stringify({
        match: verified && (derivedFingerprint === expectedFingerprint),
        derivedFingerprint: 'sha256:' + derivedFingerprint,
        expectedFingerprint: 'sha256:' + expectedFingerprint
    }));
} catch (e) {
    process.stdout.write(JSON.stringify({
        match: false,
        error: e.message
    }));
}
"@
    $VerifyOutput = & node -e $PreVerifyScript $EffectiveSigningKey $ProductionPublicKeyPem
    if ($LASTEXITCODE -ne 0 -or -not $VerifyOutput) {
        throw "Failed to execute signing key verification helper"
    }

    $VerifyResult = $VerifyOutput | ConvertFrom-Json
    Write-Host "Production public key fingerprint: $($VerifyResult.expectedFingerprint)"
    Write-Host "Signing key public fingerprint:    $($VerifyResult.derivedFingerprint)"

    if (-not $VerifyResult.match) {
        throw "SIGNING KEY MISMATCH: Private signing key does not match AmbiSun production public key."
    }
    Write-Host "Signing key validation:            MATCH (Verified)`n"
}

# 5. Read exact original bytes for byte-for-byte DryRun restoration
$OriginalAppInfoBytes = [System.IO.File]::ReadAllBytes($AppInfoPath)
$OriginalServicePackageBytes = [System.IO.File]::ReadAllBytes($ServicePackagePath)

# Read strings for JSON modification
$OriginalAppInfoText = [System.Text.Encoding]::UTF8.GetString($OriginalAppInfoBytes)
$OriginalServicePackageText = [System.Text.Encoding]::UTF8.GetString($OriginalServicePackageBytes)

try {
    # 6. Determine expected IPK path and prevent stale IPK usage
    $ExpectedIpkName = "com.github.serjio193.ambisun_${Version}_all.ipk"
    $ExpectedIpkPath = Join-Path $DistDir $ExpectedIpkName

    if (Test-Path $ExpectedIpkPath) {
        Write-Host "Removing existing artifact to prevent stale IPK: $ExpectedIpkPath"
        Remove-Item -Path $ExpectedIpkPath -Force
    }

    Write-Host "Updating version to $Version in metadata files..."

    # Update appinfo.json
    $AppInfo = $OriginalAppInfoText | ConvertFrom-Json
    $AppInfo.version = $Version
    $AppInfoJson = $AppInfo | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($AppInfoPath, $AppInfoJson, $Utf8NoBom)

    # Update service package.json
    $ServicePackage = $OriginalServicePackageText | ConvertFrom-Json
    $ServicePackage.version = $Version
    $ServicePackageJson = $ServicePackage | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($ServicePackagePath, $ServicePackageJson, $Utf8NoBom)

    $BuildStarted = Get-Date

    Write-Host "Building package..."
    $PackageScript = Join-Path $ScriptDir "package-debug.ps1"
    & powershell -ExecutionPolicy Bypass -File $PackageScript

    if ($LASTEXITCODE -ne 0) {
        throw "package-debug.ps1 failed with exit code $LASTEXITCODE"
    }

    # 7. Verify build artifact freshness and integrity
    if (-not (Test-Path $ExpectedIpkPath)) {
        throw "Expected IPK artifact not found after build: $ExpectedIpkPath"
    }

    $IpkItem = Get-Item $ExpectedIpkPath
    if ($IpkItem.Length -le 0) {
        throw "Generated IPK artifact is empty: $ExpectedIpkPath"
    }

    if ($IpkItem.LastWriteTime -lt $BuildStarted) {
        throw "Generated IPK artifact is older than build start time: $ExpectedIpkPath"
    }

    # 8. Compute SHA-256 and size
    $Hash = (Get-FileHash -Path $ExpectedIpkPath -Algorithm SHA256).Hash.ToLower()
    $IpkSize = $IpkItem.Length

    # 9. Sign canonical payload
    $Canonical = "ambisun-update-v1`nversion=$Version`nsha256=$Hash`nsize=$IpkSize`n"
    if ($EphemeralKeyUsed) {
        $NodeSignScript = @"
const crypto = require('crypto');
const canonical = process.argv[1];
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);
process.stdout.write(sig.toString('base64'));
"@
        $Signature = & node -e $NodeSignScript $Canonical
    } else {
        $NodeSignScript = @"
const crypto = require('crypto');
const fs = require('fs');
const keyPath = process.argv[1];
const canonical = process.argv[2];
const privPem = fs.readFileSync(keyPath, 'utf8');
const privKey = crypto.createPrivateKey(privPem);
const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privKey);
process.stdout.write(sig.toString('base64'));
"@
        $Signature = & node -e $NodeSignScript $EffectiveSigningKey $Canonical
    }

    if ($LASTEXITCODE -ne 0 -or -not $Signature) {
        throw "Failed to cryptographically sign update manifest"
    }
    $Signature = $Signature.Trim()

    # 10. Generate dist/update.json (in-app updater manifest) and dist/com.github.serjio193.ambisun.manifest.json
    $NodeGenManifestsScript = @"
const fs = require('fs');
const path = require('path');
const [distDir, version, hash, sizeStr, signature] = process.argv.slice(1);
const size = parseInt(sizeStr, 10);

const updateManifest = {
    version: version,
    sha256: hash,
    size: size,
    signature: signature,
    notes: {
        ru: 'AmbiSun переведён в namespace com.github.serjio193 для совместимости с официальным репозиторием webOS Homebrew. Установки 0.1.8 используют старый package ID; версию 0.2.0 необходимо установить как отдельное приложение. Существующие настройки сохраняются в /media/internal/ambisun/config.json.',
        en: 'Migrated AmbiSun to the com.github.serjio193 namespace for official webOS Homebrew repository compatibility. Existing 0.1.8 installations use the old package ID and must install 0.2.0 as a separate app. Existing settings remain in /media/internal/ambisun/config.json.',
        uk: 'AmbiSun переведено до namespace com.github.serjio193 для сумісності з офіційним репозиторієм webOS Homebrew. Встановлення 0.1.8 використовують старий package ID; версію 0.2.0 потрібно встановити як окремий застосунок. Наявні налаштування зберігаються у /media/internal/ambisun/config.json.',
        et: "AmbiSun viidi üle namespace'i com.github.serjio193, et tagada ühilduvus ametliku webOS Homebrew repositooriumiga. Olemasolevad 0.1.8 paigaldused kasutavad vana package ID-d; versioon 0.2.0 tuleb paigaldada eraldi rakendusena. Olemasolevad seaded säilivad failis /media/internal/ambisun/config.json."
    }
};
fs.writeFileSync(path.join(distDir, 'update.json'), JSON.stringify(updateManifest, null, 4) + '\n', 'utf8');

const homebrewManifest = {
    id: 'com.github.serjio193.ambisun',
    version: version,
    type: 'web',
    title: 'AmbiSun',
    appDescription: 'Smart Ambilight for HyperHDR on LG webOS.',
    iconUri: 'https://raw.githubusercontent.com/Serjio193/AmbiSun/main/assets/icon.png',
    sourceUrl: 'https://github.com/Serjio193/AmbiSun',
    rootRequired: true,
    ipkUrl: 'https://github.com/Serjio193/AmbiSun/releases/download/v' + version + '/com.github.serjio193.ambisun_' + version + '_all.ipk',
    requirements: {
        webosRelease: '>=7.4'
    },
    ipkHash: {
        sha256: hash
    },
    ipkSize: size
};
fs.writeFileSync(path.join(distDir, 'com.github.serjio193.ambisun.manifest.json'), JSON.stringify(homebrewManifest, null, 4) + '\n', 'utf8');
"@
    & node -e $NodeGenManifestsScript $DistDir $Version $Hash $IpkSize $Signature
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to write release manifests"
    }

    $UpdateJsonPath = Join-Path $DistDir "update.json"
    $HomebrewManifestPath = Join-Path $DistDir "com.github.serjio193.ambisun.manifest.json"

    Write-Host "========================================="
    Write-Host "RELEASE PREPARATION SUCCESSFUL"
    Write-Host "========================================="
    Write-Host "Version:    $Version"
    Write-Host "IPK Path:   $ExpectedIpkPath"
    Write-Host "IPK Size:   $IpkSize bytes"
    Write-Host "SHA-256:    $Hash"
    Write-Host "Signature:  $Signature"
    if ($EphemeralKeyUsed) {
        Write-Host "Sig Status: EPHEMERAL TEST SIGNATURE (NOT VALID FOR PRODUCTION UPDATER)"
    } else {
        Write-Host "Sig Status: PRODUCTION ED25519 SIGNATURE (MATCHES PRODUCTION PUBLIC KEY)"
    }
    Write-Host "Manifest:   $UpdateJsonPath"
    Write-Host "Homebrew:   $HomebrewManifestPath"
    Write-Host ""
    Write-Host "Release files ready:"
    Write-Host "- $ExpectedIpkName"
    Write-Host "- update.json"
    Write-Host "- com.github.serjio193.ambisun.manifest.json"
    Write-Host ""
    Write-Host "Short Homebrew repository source:"
    Write-Host "homebrew/r.json"
    Write-Host ""
    Write-Host "Future public URL:"
    Write-Host "https://serjio193.github.io/r.json"
}
finally {
    if ($DryRun) {
        Write-Host "DryRun enabled: Restoring exact original metadata bytes..."
        [System.IO.File]::WriteAllBytes($AppInfoPath, $OriginalAppInfoBytes)
        [System.IO.File]::WriteAllBytes($ServicePackagePath, $OriginalServicePackageBytes)
        Write-Host "Metadata files restored byte-for-byte."
    }
}
