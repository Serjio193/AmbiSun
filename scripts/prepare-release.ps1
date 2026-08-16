param (
    [Parameter(Mandatory=$true)]
    [string]$Version,
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
$ServicePackagePath = Join-Path $RepoRoot "service\org.webosbrew.ambisun.service\package.json"
$DistDir = Join-Path $RepoRoot "dist"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 3. Read exact original bytes for byte-for-byte DryRun restoration
$OriginalAppInfoBytes = [System.IO.File]::ReadAllBytes($AppInfoPath)
$OriginalServicePackageBytes = [System.IO.File]::ReadAllBytes($ServicePackagePath)

# Read strings for JSON modification
$OriginalAppInfoText = [System.Text.Encoding]::UTF8.GetString($OriginalAppInfoBytes)
$OriginalServicePackageText = [System.Text.Encoding]::UTF8.GetString($OriginalServicePackageBytes)

try {
    # 4. Determine expected IPK path and prevent stale IPK usage
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

    # 5. Verify build artifact freshness and integrity
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

    # 6. Compute SHA-256 and size
    $Hash = (Get-FileHash -Path $ExpectedIpkPath -Algorithm SHA256).Hash.ToLower()
    $IpkSize = $IpkItem.Length

    # 7. Generate dist/update.json (in-app updater manifest)
    $UpdateManifest = [ordered]@{
        version = $Version
        sha256 = $Hash
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

    # 8. Generate dist/org.webosbrew.ambisun.manifest.json (Homebrew Channel manifest)
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
