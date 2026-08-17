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

# 2. Resolve signing key
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
    } else {
        throw "RELEASE ERROR: Private Ed25519 signing key is required for real release preparation. Pass -SigningKeyPath <path> or set `$env:AMBISUN_SIGNING_KEY_PATH."
    }
} elseif (-not (Test-Path $EffectiveSigningKey)) {
    throw "Signing key file not found: $EffectiveSigningKey"
}

# 3. Paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$AppInfoPath = Join-Path $RepoRoot "appinfo.json"
$ServicePackagePath = Join-Path $RepoRoot "service\org.webosbrew.ambisun.service\package.json"
$DistDir = Join-Path $RepoRoot "dist"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 4. Read exact original bytes for byte-for-byte DryRun restoration
$OriginalAppInfoBytes = [System.IO.File]::ReadAllBytes($AppInfoPath)
$OriginalServicePackageBytes = [System.IO.File]::ReadAllBytes($ServicePackagePath)

# Read strings for JSON modification
$OriginalAppInfoText = [System.Text.Encoding]::UTF8.GetString($OriginalAppInfoBytes)
$OriginalServicePackageText = [System.Text.Encoding]::UTF8.GetString($OriginalServicePackageBytes)

try {
    # 5. Determine expected IPK path and prevent stale IPK usage
    $ExpectedIpkName = "org.webosbrew.ambisun_${Version}_all.ipk"
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

    # 6. Verify build artifact freshness and integrity
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

    # 7. Compute SHA-256 and size
    $Hash = (Get-FileHash -Path $ExpectedIpkPath -Algorithm SHA256).Hash.ToLower()
    $IpkSize = $IpkItem.Length

    # 8. Sign canonical payload
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

    # 9. Generate dist/update.json (in-app updater manifest)
    $UpdateManifest = [ordered]@{
        version = $Version
        sha256 = $Hash
        size = $IpkSize
        signature = $Signature
        notes = [ordered]@{
            ru = "Исправления и улучшения"
            en = "Fixes and improvements"
            uk = "Виправлення та покращення"
            et = "Parandused ja täiustused"
        }
    }
    $UpdateJsonPath = Join-Path $DistDir "update.json"
    $UpdateJsonContent = $UpdateManifest | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($UpdateJsonPath, $UpdateJsonContent, $Utf8NoBom)

    # 10. Generate dist/org.webosbrew.ambisun.manifest.json (Homebrew Channel manifest)
    $HomebrewManifest = [ordered]@{
        id = "org.webosbrew.ambisun"
        version = $Version
        type = "web"
        title = "AmbiSun"
        appDescription = "Smart Ambilight for HyperHDR"
        iconUri = "https://raw.githubusercontent.com/Serjio193/AmbiSun/main/assets/icon.png"
        sourceUrl = "https://github.com/Serjio193/AmbiSun"
        rootRequired = $true
        ipkUrl = "https://github.com/Serjio193/AmbiSun/releases/download/v${Version}/org.webosbrew.ambisun_${Version}_all.ipk"
        ipkHash = [ordered]@{
            sha256 = $Hash
        }
        ipkSize = $IpkSize
    }
    $HomebrewManifestPath = Join-Path $DistDir "org.webosbrew.ambisun.manifest.json"
    $HomebrewManifestContent = $HomebrewManifest | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($HomebrewManifestPath, $HomebrewManifestContent, $Utf8NoBom)

    Write-Host "========================================="
    Write-Host "RELEASE PREPARATION SUCCESSFUL"
    Write-Host "========================================="
    Write-Host "Version:    $Version"
    Write-Host "IPK Path:   $ExpectedIpkPath"
    Write-Host "IPK Size:   $IpkSize bytes"
    Write-Host "SHA-256:    $Hash"
    Write-Host "Signature:  $Signature"
    Write-Host "Manifest:   $UpdateJsonPath"
    Write-Host "Homebrew:   $HomebrewManifestPath"
    Write-Host ""
    Write-Host "Release files ready:"
    Write-Host "- $ExpectedIpkName"
    Write-Host "- update.json"
    Write-Host "- org.webosbrew.ambisun.manifest.json"
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
