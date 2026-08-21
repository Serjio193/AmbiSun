param(
    [string]$PackagePath
)

$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent $PSScriptRoot
$Tv = "root@192.168.1.3"
$AppId = "com.github.serjio193.ambisun"

Set-Location $Repo

# 1. Read and validate version from appinfo.json
$AppInfoPath = Join-Path $Repo "appinfo.json"
if (-not (Test-Path $AppInfoPath)) {
    throw "appinfo.json not found: $AppInfoPath"
}

$AppInfoText = [System.IO.File]::ReadAllText($AppInfoPath, [System.Text.Encoding]::UTF8)
$AppInfo = $AppInfoText | ConvertFrom-Json
$Version = [string]$AppInfo.version

$SemverRegex = '^\d+\.\d+\.\d+$'
if ($Version -notmatch $SemverRegex) {
    throw "Invalid SemVer version in appinfo.json: '$Version'. Must match MAJOR.MINOR.PATCH (e.g. 0.1.0)."
}

# 2. Form IPK name and path dynamically
$ExpectedIpkName = "com.github.serjio193.ambisun_${Version}_all.ipk"
$IpkName = $ExpectedIpkName
$Ipk = Join-Path $Repo "dist\$IpkName"

if ($PackagePath) {
    $ResolvedPackage = Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop
    $Ipk = $ResolvedPackage.Path
    $IpkName = Split-Path -Leaf $Ipk
    if ($IpkName -ne $ExpectedIpkName) {
        throw "Package version mismatch: expected '$ExpectedIpkName', got '$IpkName'."
    }
}

Write-Host "Application version: $Version"
Write-Host "Expected IPK: $Ipk"

# 3. Build or use an already signed artifact
if ($PackagePath) {
    Write-Host "`n=== 1. USE EXISTING SIGNED IPK ==="
    Write-Host "Skipping rebuild to preserve the signed artifact byte-for-byte."
} else {
    if (Test-Path $Ipk) {
        Write-Host "Removing existing artifact to prevent stale IPK: $Ipk"
        Remove-Item -Path $Ipk -Force
    }

    $BuildStarted = Get-Date

    Write-Host "`n=== 1. BUILD ==="
    powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\package-debug.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "package-debug.ps1 failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path $Ipk)) {
        throw "IPK artifact not found after build: $Ipk"
    }
}

$IpkItem = Get-Item $Ipk
if ($IpkItem.Length -le 0) {
    throw "Generated IPK artifact is empty: $Ipk"
}

if (-not $PackagePath -and $IpkItem.LastWriteTime -lt $BuildStarted) {
    throw "Generated IPK artifact is older than build start time: $Ipk"
}

Write-Host "`n=== 2. LOCAL BUILD INFO ==="
$size = $IpkItem.Length
Write-Host "IPK: $Ipk"
Write-Host "Size: $size bytes"

$localNav = Join-Path $Repo "js\navigation.js"
$localHash = (Get-FileHash $localNav -Algorithm SHA256).Hash.ToLower()
Write-Host "Local navigation.js SHA256: $localHash"

Write-Host "`n=== 3. COPY IPK ==="
& scp $Ipk "${Tv}:/media/developer/temp/$IpkName"
if ($LASTEXITCODE -ne 0) {
    throw "SCP of IPK failed."
}

Write-Host "`n=== 4. CREATE INSTALL PAYLOAD ==="
$tempJson = Join-Path $env:TEMP "ambisun-install.json"

$payload = @{
    id = "com.ares.defaultName"
    ipkUrl = "/media/developer/temp/$IpkName"
    subscribe = $false
} | ConvertTo-Json -Compress

[System.IO.File]::WriteAllText(
    $tempJson,
    $payload,
    (New-Object System.Text.UTF8Encoding($false))
)

& scp $tempJson "${Tv}:/media/developer/temp/ambisun-install.json"
if ($LASTEXITCODE -ne 0) {
    throw "SCP of install payload failed."
}

Write-Host "`n=== 5. INSTALL ==="

$remoteInstall = 'payload=$(cat /media/developer/temp/ambisun-install.json); luna-send -n 1 -f luna://com.webos.appInstallService/dev/install "$payload"'

$installResult = & ssh $Tv $remoteInstall

$installResult | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    throw "SSH/luna install command failed with exit code $LASTEXITCODE."
}

$installOutput = ($installResult -join "`n").Trim()
if (-not $installOutput -or $installOutput -notmatch '"returnValue"\s*:\s*true' -or $installOutput -match '"returnValue"\s*:\s*false') {
    throw "TV rejected installation or failed to report success."
}

Write-Host "`n=== 6. VERIFY ACTUAL INSTALLED FILES & VERSION ==="

$remoteNav = "/media/developer/apps/usr/palm/applications/$AppId/js/navigation.js"
$remoteAppInfoPath = "/media/developer/apps/usr/palm/applications/$AppId/appinfo.json"

$verified = $false

for ($i = 1; $i -le 20; $i++) {

    Start-Sleep -Seconds 1

    $remoteHashLine = & ssh $Tv "sha256sum '$remoteNav' 2>/dev/null"

    if ($LASTEXITCODE -eq 0 -and $remoteHashLine) {

        $remoteHash = (($remoteHashLine -split '\s+')[0]).Trim().ToLower()

        Write-Host "Attempt $i - TV navigation SHA256: $remoteHash"

        if ($remoteHash -eq $localHash) {
            $verified = $true
            break
        }
    }
}

if (-not $verified) {
    throw "INSTALL VERIFICATION FAILED: TV navigation.js does not match local build."
}

# Verify installed appinfo version
$remoteAppInfoText = (& ssh $Tv "cat '$remoteAppInfoPath' 2>/dev/null") -join "`n"
if (-not $remoteAppInfoText) {
    throw "INSTALL VERSION VERIFICATION FAILED: Could not read remote appinfo.json on TV."
}

try {
    $remoteAppInfo = $remoteAppInfoText | ConvertFrom-Json
    $remoteVersion = [string]$remoteAppInfo.version
} catch {
    throw "INSTALL VERSION VERIFICATION FAILED: Failed to parse remote appinfo.json."
}

Write-Host "TV installed version: $remoteVersion"
if ($remoteVersion -ne $Version) {
    throw "INSTALL VERSION VERIFICATION FAILED: TV version ($remoteVersion) does not match local version ($Version)."
}

Write-Host "Installed application matches current local source and version."

Write-Host "`n=== 7. RESTORE ELEVATION ==="

$elevate = "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service com.github.serjio193.ambisun; /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service com.github.serjio193.ambisun.service"

& ssh $Tv $elevate

if ($LASTEXITCODE -ne 0) {
    throw "Elevation failed."
}

Write-Host "`n======================================"
Write-Host "AMBISUN DEPLOY SUCCESS"
Write-Host "======================================"
Write-Host "Version: $Version"
Write-Host "Installed navigation SHA256: $localHash"
Write-Host "Now launch AmbiSun on the TV."
