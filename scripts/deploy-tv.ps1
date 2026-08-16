$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent $PSScriptRoot
$Tv = "root@192.168.1.3"
$AppId = "org.webosbrew.ambisun"
$IpkName = "org.webosbrew.ambisun_0.1.0_all.ipk"

Set-Location $Repo

Write-Host "`n=== 1. BUILD ==="
powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\package-debug.ps1"
if ($LASTEXITCODE -ne 0) {
    throw "Packaging failed."
}

$Ipk = Join-Path $Repo "dist\$IpkName"

if (-not (Test-Path $Ipk)) {
    throw "IPK not found: $Ipk"
}

Write-Host "`n=== 2. LOCAL BUILD INFO ==="
$size = (Get-Item $Ipk).Length
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
    throw "SSH/luna install command failed."
}

if (($installResult -join "`n") -match '"returnValue"\s*:\s*false') {
    throw "TV rejected installation."
}

Write-Host "`n=== 6. VERIFY ACTUAL INSTALLED FILE ==="

$remoteNav = "/media/developer/apps/usr/palm/applications/$AppId/js/navigation.js"

$verified = $false

for ($i = 1; $i -le 20; $i++) {

    Start-Sleep -Seconds 1

    $remoteHashLine = & ssh $Tv "sha256sum '$remoteNav' 2>/dev/null"

    if ($LASTEXITCODE -eq 0 -and $remoteHashLine) {

        $remoteHash = (($remoteHashLine -split '\s+')[0]).Trim().ToLower()

        Write-Host "Attempt $i - TV SHA256: $remoteHash"

        if ($remoteHash -eq $localHash) {
            $verified = $true
            break
        }
    }
}

if (-not $verified) {
    throw "INSTALL VERIFICATION FAILED: TV navigation.js does not match local build."
}

Write-Host "Installed application matches current local source."

Write-Host "`n=== 7. RESTORE ELEVATION ==="

$elevate = "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service org.webosbrew.ambisun.service"

& ssh $Tv $elevate

if ($LASTEXITCODE -ne 0) {
    throw "Elevation failed."
}

Write-Host "`n======================================"
Write-Host "AMBISUN DEPLOY SUCCESS"
Write-Host "======================================"
Write-Host "Installed navigation SHA256: $localHash"
Write-Host "Now launch AmbiSun on the TV."