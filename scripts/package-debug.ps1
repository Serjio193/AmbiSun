$ErrorActionPreference = "Stop"

# 1. Determine repository root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

# 2. Create staging directory in TEMP
$StagingDir = Join-Path $env:TEMP "AmbiSun-build"

Write-Host "Setting up build staging at $StagingDir..."

if (Test-Path $StagingDir) {
    # 3. Safe Staging Delete Guard
    $ResolvedStagingDir = (Resolve-Path $StagingDir).Path
    $ResolvedTemp = (Resolve-Path $env:TEMP).Path
    $ResolvedRepoRoot = (Resolve-Path $RepoRoot).Path

    if (-not $ResolvedStagingDir.StartsWith($ResolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Safety Check Failed: Staging directory is not inside TEMP."
    }
    if ((Split-Path -Leaf $ResolvedStagingDir) -ne "AmbiSun-build") {
        throw "Safety Check Failed: Staging leaf directory is not 'AmbiSun-build'."
    }
    if ($ResolvedStagingDir -eq $ResolvedRepoRoot) {
        throw "Safety Check Failed: Staging directory matches repository root."
    }
    
    Remove-Item -Path $StagingDir -Recurse -Force
}

$AppStaging = Join-Path $StagingDir "app"
$ServiceStaging = Join-Path $StagingDir "service"
$DistDir = Join-Path $RepoRoot "dist"

New-Item -ItemType Directory -Path $AppStaging | Out-Null
New-Item -ItemType Directory -Path $ServiceStaging | Out-Null
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

# 4. Copy app files using explicit allowlist
Write-Host "Copying app files to staging (allowlist)..."
$AppAllowlistFiles = @("appinfo.json", "index.html", "LICENSE", "THIRD_PARTY_NOTICES.md")
$AppAllowlistDirs = @("assets", "css", "i18n", "js")

foreach ($item in $AppAllowlistFiles) {
    $SourcePath = Join-Path $RepoRoot $item
    if (Test-Path $SourcePath -PathType Leaf) {
        Copy-Item -Path $SourcePath -Destination $AppStaging -Force
    }
}

foreach ($item in $AppAllowlistDirs) {
    $SourcePath = Join-Path $RepoRoot $item
    if (Test-Path $SourcePath -PathType Container) {
        $DestDir = Join-Path $AppStaging $item
        New-Item -ItemType Directory -Path $DestDir | Out-Null
        Copy-Item -Path "$SourcePath\*" -Destination $DestDir -Recurse -Force
    }
}

# 5. Copy service files using explicit allowlist
Write-Host "Copying service files to staging (allowlist)..."
$ServiceSource = Join-Path $RepoRoot "service\org.webosbrew.ambisun.service"
$ServiceAllowlistFiles = @("package.json", "services.json", "service.js")
$ServiceAllowlistDirs = @("lib", "data")

foreach ($item in $ServiceAllowlistFiles) {
    $SourcePath = Join-Path $ServiceSource $item
    if (Test-Path $SourcePath -PathType Leaf) {
        Copy-Item -Path $SourcePath -Destination $ServiceStaging -Force
    }
}

foreach ($item in $ServiceAllowlistDirs) {
    $SourcePath = Join-Path $ServiceSource $item
    if (Test-Path $SourcePath -PathType Container) {
        $DestDir = Join-Path $ServiceStaging $item
        New-Item -ItemType Directory -Path $DestDir | Out-Null
        Copy-Item -Path "$SourcePath\*" -Destination $DestDir -Recurse -Force
    }
}

# 6. Verify essential files exist
Write-Host "Verifying staging contents..."
$EssentialFiles = @(
    "$AppStaging\appinfo.json",
    "$AppStaging\index.html",
    "$AppStaging\js\i18n.js",
    "$ServiceStaging\package.json",
    "$ServiceStaging\services.json",
    "$ServiceStaging\service.js",
    "$ServiceStaging\lib\runtime-info.js",
    "$ServiceStaging\data\countries.json",
    "$ServiceStaging\data\manifest.json",
    "$ServiceStaging\data\cities\RU.json",
    "$ServiceStaging\data\cities\EE.json"
)

foreach ($file in $EssentialFiles) {
    if (-not (Test-Path $file)) {
        throw "Required file not found in staging: $file"
    }
}

# 6b. Verify all 39 built-in locale JSON files in staging
Write-Host "Validating all 39 built-in locale JSON files..."
$RequiredLocales = @(
    "en", "de", "fr", "es", "pt-BR", "pt-PT", "it", "nl", "pl", "cs",
    "sk", "hu", "ro", "bg", "el", "hr", "sl", "sr", "et", "lv",
    "lt", "fi", "sv", "da", "no", "tr", "ru", "uk", "ar", "he",
    "hi", "id", "ms", "th", "vi", "ko", "ja", "zh-CN", "zh-TW"
)

$AppEnJsonPath = Join-Path $AppStaging "i18n\en.json"
if (-not (Test-Path $AppEnJsonPath)) {
    throw "Source locale file missing from staging: $AppEnJsonPath"
}

foreach ($loc in $RequiredLocales) {
    $locPath = Join-Path $AppStaging "i18n\$loc.json"
    if (-not (Test-Path $locPath)) {
        throw "Built-in locale file missing from staging: $locPath"
    }
}

# 7. Check ares-package availability
if (-not (Get-Command ares-package.cmd -ErrorAction SilentlyContinue)) {
    throw "ares-package.cmd not found in PATH. Please install webOS CLI and ensure it's in your PATH."
}

# 8. Record build start time
$BuildStarted = Get-Date

# 9. Run ares-package
Write-Host "Running ares-package..."
$AresCmd = "ares-package.cmd"
$AresArgs = @(
    "--no-minify",
    $AppStaging,
    $ServiceStaging,
    "-o",
    $DistDir
)

Write-Host "Executing: $AresCmd $AresArgs"

# Invoke command using call operator and argument splatting
& $AresCmd @AresArgs
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    throw "ares-package failed with exit code $exitCode"
}

Write-Host ""
Write-Host "========================================="
Write-Host "PACKAGING SUCCESSFUL"
Write-Host "========================================="

# 10. Find ONLY the new IPK
$NewIpks = Get-ChildItem -Path $DistDir -Filter "*.ipk" | Where-Object { $_.LastWriteTime -ge $BuildStarted }

if ($NewIpks.Count -eq 0) {
    throw "ERROR: Packaging succeeded but no new IPK found in dist directory."
} elseif ($NewIpks.Count -gt 1) {
    Write-Host "WARNING: Multiple new IPKs found!"
    $NewIpks | ForEach-Object { Write-Host $_.FullName }
    throw "ERROR: Expected exactly 1 new IPK, found $($NewIpks.Count)."
}

$CurrentIpk = $NewIpks[0].FullName
$SizeMb = [math]::Round($NewIpks[0].Length / 1MB, 2)
Write-Host "NEW IPK Path: $CurrentIpk"
Write-Host "NEW IPK Size: $SizeMb MB"

# 11. Run Package Inspection (read-only)
Write-Host ""
Write-Host "--- Package Inspection ---"
$InspectArgs = @("-I", $CurrentIpk)
& $AresCmd @InspectArgs
$inspectExit = $LASTEXITCODE
if ($inspectExit -ne 0) {
    Write-Host "WARNING: ares-package inspection returned code $inspectExit"
}

Write-Host ""
Write-Host "DO NOT auto-install yet. Follow TV probe instructions."
