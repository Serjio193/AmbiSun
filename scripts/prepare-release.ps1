param (
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# 1. Strict semver validation
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

Write-Host "Updating version to $Version in metadata files..."

# Update appinfo.json
$AppInfo = Get-Content $AppInfoPath -Raw | ConvertFrom-Json
$AppInfo.version = $Version
$AppInfoJson = $AppInfo | ConvertTo-Json -Depth 10
Set-Content -Path $AppInfoPath -Value $AppInfoJson -NoNewline

# Update service package.json
$ServicePackage = Get-Content $ServicePackagePath -Raw | ConvertFrom-Json
$ServicePackage.version = $Version
$ServicePackageJson = $ServicePackage | ConvertTo-Json -Depth 10
Set-Content -Path $ServicePackagePath -Value $ServicePackageJson -NoNewline

Write-Host "Building package..."
$PackageScript = Join-Path $ScriptDir "package-debug.ps1"
& powershell -ExecutionPolicy Bypass -File $PackageScript

# Locate output IPK
$ExpectedIpkName = "org.webosbrew.ambisun_${Version}_all.ipk"
$IpkPath = Join-Path $DistDir $ExpectedIpkName

if (-not (Test-Path $IpkPath)) {
    throw "Expected IPK file not found: $IpkPath"
}

# 3. Compute SHA-256
$Hash = (Get-FileHash -Path $IpkPath -Algorithm SHA256).Hash.ToLower()

# 4. Generate dist/update.json
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
Set-Content -Path $UpdateJsonPath -Value $UpdateJsonContent -NoNewline

Write-Host "========================================="
Write-Host "RELEASE PREPARATION SUCCESSFUL"
Write-Host "========================================="
Write-Host "Version:    $Version"
Write-Host "IPK Path:   $IpkPath"
Write-Host "SHA-256:    $Hash"
Write-Host "Manifest:   $UpdateJsonPath"
Write-Host ""
Write-Host "Release files ready:"
Write-Host "- $ExpectedIpkName"
Write-Host "- update.json"
