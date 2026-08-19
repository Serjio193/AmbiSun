# TV Runtime Probe Instructions

This document provides instructions for installing the AmbiSun debug package on a rooted LG webOS TV and running read-only diagnostics on the background service.

## 1. Prerequisites
Ensure you have the webOS CLI tools installed on your PC (`ares-package`, `ares-install`, `ares-setup-device`, `ares-launch`).

## 2. Package the Application (If not already packaged)
From the root directory of the AmbiSun repository on your PC, execute:
```bash
ares-package --no-minify . service/com.github.serjio193.ambisun.service -o dist
```
This will generate `com.github.serjio193.ambisun_0.2.0_all.ipk` in the `dist/` directory, containing both the UI app and the background service.

## 3. Install on TV
Ensure your target TV is configured via `ares-setup-device` (we will refer to it as `<TV_DEVICE>`).
```bash
ares-install -d <TV_DEVICE> dist/com.github.serjio193.ambisun_0.2.0_all.ipk
```
Verify the output confirms successful installation.

## 4. Run Read-Only Diagnostics
Connect to the TV shell (via SSH or `ares-novacom`) or run these commands directly from your PC if `luna-send` is exposed, but usually `luna-send` must be run from inside the TV's shell.

Open the TV shell:
```bash
ares-novacom -d <TV_DEVICE> -f
```
(Alternatively, SSH into the TV).

Execute the following read-only commands and record their output:

**A. PING**
```bash
luna-send -n 1 luna://com.github.serjio193.ambisun.service/ping '{}'
```

**B. GET RUNTIME INFO**
```bash
luna-send -n 1 luna://com.github.serjio193.ambisun.service/getRuntimeInfo '{}'
```

**C. GET CAPABILITIES**
```bash
luna-send -n 1 luna://com.github.serjio193.ambisun.service/getCapabilities '{}'
```

**D. PING AFTER IDLE (Optional)**
Wait 10-15 seconds after running the previous commands, then run the ping command again to ensure the service wakes up successfully from an idle state:
```bash
luna-send -n 1 luna://com.github.serjio193.ambisun.service/ping '{}'
```

## 5. REAL TV PROBE RESULTS (VERIFIED)

**TV Environment:**
- **TV model:** OLED65G51LW.DEUQLJP (Board: O24N_DVB_EU)
- **webOS version:** 10.3.1 (OTA: HE_DTV_W25O_AFABATAA)
- **firmware:** 33.31.68
- **Node runtime:** v16.20.2 (linux/arm)

**INSTALLATION ISSUE (ares-install.cmd):**
`ares-install.cmd 3.2.5` on rooted TV fails during SSH exec channel open (`Error: Unable to exec /bin/ls...`) after successful SFTP upload. 
*Workaround Installation Command on TV:*
```bash
luna-send -i -f luna://com.webos.appInstallService/dev/install '{"id":"com.ares.defaultName","ipkUrl":"/media/developer/temp/com.github.serjio193.ambisun_0.2.0_all.ipk","subscribe":true}'
```

**PING:**
```json
{
  "returnValue": true,
  "service": "com.github.serjio193.ambisun.service",
  "apiVersion": 1,
  "version": "0.1.0"
}
```

**GET RUNTIME INFO:**
```json
{
  "returnValue": true,
  "service": "com.github.serjio193.ambisun.service",
  "apiVersion": 1,
  "runtime": {
    "node": "v16.20.2",
    "platform": "linux",
    "arch": "arm"
  }
}
```

**GET CAPABILITIES:**
```json
{
  "returnValue": true,
  "apiVersion": 1,
  "capabilities": {
    "automation": false,
    "persistentConfig": false,
    "activityScheduler": false,
    "hyperhdrServiceTransport": false,
    "sourceDetection": false
  }
}
```
*(Wake/restart check passed)*

## 6. REAL TV PHASE B RESULTS (VERIFIED)

**Cold Start / Persistence:**
- "Unknown method getConfig" bug resolved via synchronous Luna method registration.
- Persisted config successfully loads from disk after service wake/restart.
- FIFO operation queue ensures deterministic config ordering even during startup.

**Revisions & Conflict:**
- `updateConfig` successfully increments revision.
- `updateConfig` with stale `expectedRevision` correctly returns `REVISION_CONFLICT`.

**Validation & State Preservation:**
- Empty patches, unknown fields, and invalid offset multiples correctly return `CONFIG_INVALID` or `INVALID_REQUEST`.
- Failed mutations (including intentional conflicts or invalid schemas) leave the committed state and revision completely unchanged.

**Reset Semantics:**
- `resetConfig` successfully restores default values.
- Final verified stored state after reset: `revision = 4`, defaults restored.

**Capabilities:**
- `persistentConfig`: true
- All other capabilities (`automation`, `activityScheduler`, `hyperhdrServiceTransport`, `sourceDetection`): false.

## REAL TV PHASE C RESULTS (VERIFIED)
- **Date**: 2026-08-16
- **Test execution**: Successful packaging and installation via SCP + SSH luna-send.
- **Capabilities check**: Returns \persistentConfig: true\ and \hyperhdrServiceTransport: true\.
- **Status check**: \getHyperhdrStatus\ successfully queries local \:8090\ json-rpc and returns serverinfo containing LED layout and priorities.
- **Toggle tests**: \setLedDevice\ successfully transitions to \alse\ and restores to \	rue\.
- **Cold start**: The service wakes up synchronously and handles \getHyperhdrStatus\ without 'Unknown method' errors after being idle.
- **Validation check**: Passing non-boolean state string correctly returns \INVALID_REQUEST\.
- **Regression**: Phase B \getConfig\ continues to work fine, returning the exact same persistent config.

