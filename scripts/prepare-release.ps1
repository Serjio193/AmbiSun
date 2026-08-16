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

# 3. Read initial files using explicit UTF-8
$OriginalAppInfoText = [System.IO.File]::ReadAllText($AppInfoPath, [System.Text.Encoding]::UTF8)
$OriginalServicePackageText = [System.IO.File]::ReadAllText($ServicePackagePath, [System.Text.Encoding]::UTF8)

try {
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

    Write-Host "Building package..."
    $PackageScript = Join-Path $ScriptDir "package-debug.ps1"
    & powershell -ExecutionPolicy Bypass -File $PackageScript

    # Locate output IPK
    $ExpectedIpkName = "org.webosbrew.ambisun_${Version}_all.ipk"
    $IpkPath = Join-Path $DistDir $ExpectedIpkName

    if (-not (Test-Path $IpkPath)) {
        throw "Expected IPK file not found: $IpkPath"
    }

    # 4. Compute SHA-256 and size
    $Hash = (Get-FileHash -Path $IpkPath -Algorithm SHA256).Hash.ToLower()
    $IpkSize = (Get-Item $IpkPath).Length

    # 5. Generate dist/update.json (in-app updater manifest)
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

    # 6. Generate dist/org.webosbrew.ambisun.manifest.json (Homebrew Channel manifest)
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
    Write-Host "IPK Path:   $IpkPath"
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
        Write-Host "DryRun enabled: Restoring original metadata files..."
        [System.IO.File]::WriteAllText($AppInfoPath, $OriginalAppInfoText, $Utf8NoBom)
        [System.IO.File]::WriteAllText($ServicePackagePath, $OriginalServicePackageText, $Utf8NoBom)
        Write-Host "Metadata files restored to original versions."
    }
}
