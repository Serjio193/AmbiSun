# AmbiSun Service Implementation Plan

This document outlines the step-by-step phases required to implement the background automation service for AmbiSun on LG webOS TVs. Each phase is small, isolated, and designed to be verified independently.

## PHASE A: Service Foundation & API
- **STATUS: COMPLETED + REAL TV VERIFIED**
- Runtime gate: **PASSED**
  - Node: v16.20.2
  - Platform: linux / arm
  - webOS: 10.3.1
  - *Note on Installation:* `ares-install` fails on SSH exec channel open. Use `luna-send -i -f luna://com.webos.appInstallService/dev/install` workaround.
- Initialize the Node.js webOS service boilerplate using pre-ES6 syntax.
- Implement the minimal Luna public API structure (`ping`, `getRuntimeInfo`, `getCapabilities`).
- *Verification:* `luna-send` calls on a real TV succeed and return runtime info and capabilities.

## PHASE B: Persistent Config & Storage
- **STATUS: COMPLETED + REAL TV VERIFIED**
- Develop `lib/storage.js` to persist JSON configuration to the filesystem.
- Wire `setConfig` and `getConfig` APIs to the storage layer.
- Ensure incrementing of `configRevision` on saves.
- *Verification:* Configurations persist across TV reboots and app updates. Verified cross-operation FIFO queue, robust error recovery, and schema validation. Reset state confirmed at revision 4.

## PHASE C: Service-side HyperHDR
- **STATUS: COMPLETED + REAL TV VERIFIED**
- Implement `lib/hyperhdr.js` using the core Node.js `http` module.
- Add bounded retry and error recording logic.
- Expose `getHyperhdrStatus` and `setLedDevice` Luna methods.
- *Verification:* Service can successfully query status and toggle `LEDDEVICE` via Luna request without blocking or crashing. HTTP/JSON transport implemented with strict error handling, limits, and timeouts.

## PHASE D: Service Decision Engine
- **STATUS: IMPLEMENTED LOCALLY (NOT YET REAL TV VERIFIED)**
- Implement `lib/sun.js` with autonomous solar calculation (no DOM dependency).
- Implement `lib/decision.js` which evaluates config, source, and time to produce an explicit structured decision.
- Support deterministic timezone handling and offsets.
- Register diagnostic `evaluateNow` method.
- Must not call HyperHDR during evaluation.
- Implement pure logic `decision-engine.js` merging config rules, solar state, and mock source state.
- Wire `evaluateNow()` to execute the decision engine and trigger HyperHDR if the LED state diverges.
- *Verification:* Unit tests or mock Luna calls return expected `desiredLedState` based on varying solar times.

### Phase E — Solar Activity Scheduler
**Status:** COMPLETED + REAL TV VERIFIED

**Overview:**
Integrates webOS `Activity Manager` via `webos-service` proxy to provide autonomous waking based purely on solar transitions.

**Details:**
- **Activity Name**: `org.webosbrew.ambisun.solar`
- **Activity Type**: `{ foreground: false, persist: true }`
- **Schedule Format**: Standard ISO 8601 string (e.g., `2026-08-16T18:40:12.475Z`), which will be verified on Real TV.
- **Callback**: `luna://org.webosbrew.ambisun.service/solarWake`
- **Behavior**:
  - `replace: true` is used to prevent accumulating multiple overlapping activities.
  - Automatically reschedules after successful config updates (except overrides because source detection isn't ready) or upon wake.
  - Cancels activity if `enabled=false`, rule is forced to `on`/`off`, or location is invalid/polar.
- **Limitation**: `solarWake` always evaluates with `source: null`, falling back to `defaultRule`. Source detection is missing, so `automation: false` capability remains until Phase F.

---

## PHASE F: Real TV Source Capability Probe
- Deploy a standalone probe script to discover rooted/private Luna endpoints for foreground app and HDMI detection.
- Determine if subscriptions are supported on these private endpoints.
- Document stable IDs for common HDMI inputs and apps.
- *Verification:* We know definitively how to listen for source changes on this TV model.

## PHASE G: Source Monitoring Integration
- Build `source-provider.js` based on Phase F discoveries.
- Implement ~2000ms debounce.
- Wire source change callbacks to invoke `evaluateNow()`.
- *Verification:* Switching from HDMI to YouTube updates service `currentSource` state and adjusts LEDDEVICE immediately based on rules.

## PHASE H: UI/Service Synchronization
- Modify UI `app.js` to fetch `getConfig` and `getStatus` at startup.
- Change UI settings panels to execute `AmbiSun.webos.requestService('setConfig', ...)` rather than caching locally.
- Implement a graceful fallback for local browser development using mocks.
- *Verification:* UI correctly reflects background service authoritative state and updates it flawlessly.

## PHASE I: Controlled TV Integration Tests
- Full end-to-end testing on the physical LG TV.
- Test cold boots, TV sleep/wake scenarios, power loss, and rapid HDMI switching.
- Validate logger output for race conditions.

## PHASE J: Packaging, Startup & Update Verification
- Validate `package.json`, `services.json`, and permissions.
- Ensure installation works smoothly on Homebrew Channel.
- *Verification:* Upgrading the application leaves the persistent config intact and restarts the service successfully.

---
## REAL LG TV PROBE PLAN (To execute during Phase F)
Before full source integration, the following facts must be probed and confirmed on the target TV:
1. **webOS version:** What is the underlying webOS release?
2. **Node.js version:** `process.version` from the service.
3. **Service Starts:** Does a basic service boot and stay alive?
4. **Service Idle Lifecycle:** How long before webOS kills an idle service?
5. **Activity Manager Permission:** Can our app create `persist: true` and `type.background: true` activities?
6. **Activity Callback:** Does the callback successfully wake up the dead service?
7. **Reboot Persistence:** Do Activities and JSON configs survive TV restarts?
8. **HyperHDR Connectivity:** Is localhost `:8090` fully accessible from the service sandbox?
9. **Private APIs:** Does `com.webos.applicationManager/getForegroundAppInfo` exist? Does `com.webos.service.eim/getAllInputStatus` exist?
10. **Subscriptions:** Do the aforementioned source APIs support `subscribe: true`?
11. **Stable IDs:** What are the exact string IDs for HDMI 1, HDMI 2, YouTube, etc.?
