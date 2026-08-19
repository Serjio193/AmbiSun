# AmbiSun Background Service Architecture Design

## 1. Architecture Overview
AmbiSun background automation service is designed to be the authoritative engine managing HyperHDR LED state based on solar events, TV source rules, and user configuration. The UI becomes a presentation and configuration layer that delegates execution to this service. The service is event-driven (using webOS Activity Manager and Luna subscriptions when possible) rather than relying on constant polling, ensuring minimal resource consumption.

## 2. UI Responsibilities
- Presentation of the current automation state and configuration.
- Capturing user configuration changes and forwarding them to the service.
- Performing UI-specific functionality like location wizard, Plasma renderer, and language selection.
- Development-time mock testing (via `AmbiSun.hyperhdr` when `window.webOS` is unavailable).

## 3. Service Responsibilities
- Authoritative ownership and persistence of the production configuration.
- Accurate scheduling and firing of events based on solar calculations.
- Source/app state detection on rooted webOS TVs.
- Independent execution of the Decision Engine to control HyperHDR LEDDEVICE without UI interaction.
- State recovery after TV sleep/restart or HyperHDR connection drops.

## 4. Proposed Service Directory Structure
```
service/
└── com.github.serjio193.ambisun.service/
    ├── package.json
    ├── services.json
    ├── service.js
    ├── lib/
    │   ├── config.js               // Validation and state holding
    │   ├── storage.js              // Persistence adapter (JSON or DB8)
    │   ├── scheduler.js            // Activity Manager lifecycle
    │   ├── activity-manager.js     // Wrapper for com.palm.activitymanager
    │   ├── sun-engine.js           // Pure logic for solar calculations
    │   ├── decision-engine.js      // Pure logic comparing config, sun, and source
    │   ├── hyperhdr.js             // Localhost HTTP transport to HyperHDR
    │   ├── source-provider.js      // webOS foreground/input detection
    │   └── logger.js               // Diagnostic ring-buffer
```

## 5. Luna Public API Contracts
Minimal API for UI to Service communication:

- **ping**
  - *Request:* `{}`
  - *Response:* `{"returnValue": true, "version": "0.1.0"}`
- **getConfig**
  - *Request:* `{}`
  - *Response:* `{"returnValue": true, "config": {...}, "revision": 17}`
- **setConfig**
  - *Request:* `{"config": {...}}`
  - *Response:* `{"returnValue": true, "revision": 18, "schedule": {...}}`
  - *Side Effect:* Validates, saves, and triggers `evaluateNow()`.
- **getStatus**
  - *Request:* `{}`
  - *Response:* `{"returnValue": true, "automationEnabled": true, "currentSource": {...}, "schedule": {...}, ...}`
- **evaluateNow**
  - *Request:* `{"reason": "manual_request"}`
  - *Response:* `{"returnValue": true, "desiredLedState": true}`
  - *Side Effect:* Forces decision engine evaluation and HyperHDR update.

## 6. Config Model
Authoritative structure held by the service:
```json
{
  "version": 1,
  "enabled": true,
  "autostart": true,
  "location": {
    "lat": 59.437,
    "lon": 24.7536,
    "timezone": "Europe/Tallinn"
  },
  "sunsetOffset": 30,
  "sunriseOffset": 0,
  "defaultRule": "sun",
  "overrides": {},
  "sourceChangeDelayMs": 2000,
  "hyperhdr": {
    "endpoint": "http://127.0.0.1:8090/json-rpc?request"
  }
}
```
*Note:* The `language` property is omitted as it is a UI-only concern.

## 7. Config Ownership
The Background Service is the **authoritative owner** of the configuration.
**Flow:** UI updates configuration → Service `setConfig()` → Service validates and persists → Service reschedules activities → UI receives updated state.
**Revision Tracking:** Every change increments `configRevision` to invalidate stale scheduled events.

## 8. Persistence/Storage Options
- **A. persistent JSON/file storage (Recommended)**
  - *Pros:* Simple, reliable, easy to implement in Node.js, accessible from JS service, no DB schema migrations.
  - *Cons:* May be deleted on app uninstallation, file corruption risks during sudden power loss.
- **B. DB8**
  - *Pros:* Official webOS storage, survives updates, robust permissions.
  - *Cons:* Complex implementation, Luna call overhead, requires kind registrations.
*Decision:* JSON file storage is recommended initially, but must be probed for read/write persistence across reboots.

## 9. Sun Calculation Architecture
- **Recommendation:** `service/lib/sun-engine.js` is the absolute authority for solar math.
- The UI will retrieve the schedule via `getStatus`.
- `js/sun.js` in the UI will become a fallback for PC development or mock displays only. We do not use bundlers, so we keep them as two separate modules, but only the service version controls automation.

## 10. Timezone/DST Strategy
- Store exact event instants (UTC timestamps).
- `sun-engine.js` generates the next event instant `nextEventTimeMs`.
- The scheduler computes `delay = nextEventTimeMs - Date.now()` to schedule the Activity.
- Node.js native date APIs are used; fallback polyfills may be needed depending on target webOS Node.js version.

## 11. Activity Manager Strategy
**Recommended:** ONE NEXT EVENT ACTIVITY (`AmbiSun.NextSolarEvent`).
- Instead of keeping the service alive forever, schedule a single Activity for the closest upcoming solar event (Sunrise or Sunset).
- When the Activity fires, the service awakes, evaluates `evaluateNow()`, calculates the *next* event, replaces the Activity, and exits.

## 12. Scheduled Event Lifecycle
1. Activity fires.
2. Callback hits `luna://com.github.serjio193.ambisun.service/scheduledEvent`.
3. Service loads authoritative config (checking revision).
4. `evaluateNow()` evaluates source and solar state.
5. HyperHDR is updated if needed.
6. A new `AmbiSun.NextSolarEvent` is created via Activity Manager.
7. Service responds to Luna request.

## 13. Source Detection Architecture
`source-provider.js` provides normalized source information:
```json
{ "type": "app", "id": "youtube.leanback.v4", "name": "YouTube" }
```
- A ~2000ms debounce should be implemented for HDMI/App switching to prevent spurious LED flickers during intermediate states.

## 14. Private/Rooted API Uncertainty
Many APIs needed for background automation (e.g., `com.webos.applicationManager/getForegroundAppInfo`) are private or require root privileges. We cannot assume their availability without running a probe on a rooted TV.

## 15. Source Capability Probe Plan
A separate implementation phase (Phase F) will deploy a diagnostic script to the TV to probe:
- Availability of foreground app endpoints.
- Subscription support on those endpoints.
- HDMI input stable IDs.
- Service idle termination behavior.

## 16. Decision Engine
Pure logic function `decision-engine.js`:
**Input:** `(config, currentSource, nowTimestamp, sunSchedule)`
**Output:** `{"desiredLedState": true, "reason": "SUN_ACTIVE", "rule": "sun", "sourceId": "HDMI_1"}`

## 17. HyperHDR Transport
`service/lib/hyperhdr.js` executes HTTP requests to `127.0.0.1:8090`.
- Only uses `LEDDEVICE` component.
- Does not kill the HyperHDR process.

## 18. Retry/Recovery Behavior
- **HyperHDR failure:** Non-blocking bounded retry strategy. `evaluateNow()` will record failure. Activity manager or secondary triggers will eventually retry.
- **Missed Event / Wake up:** Whenever `evaluateNow()` is invoked (e.g. at startup or source change), it compares current time against the sun schedule and corrects the LED state immediately.

## 19. Autostart/Reboot Behavior
- The service relies on persistent Activity Manager schedules (`persist=true`, `type.background=true`) to wake up.
- If this fails on webOS due to TV reboot, a rooted startup script or `boot` Activity event should be used to call `evaluateNow()`.

## 20. Concurrency Strategy
A single evaluation queue or lock is used inside the service to prevent race conditions when UI updates config at the exact moment a sun event fires. The lock drops or queues the subsequent request until `evaluateNow()` completes.

## 21. Logging/Diagnostics
- A small ring-buffer `logger.js` keeping the last ~50 evaluation events (Time, Source, Reason, LEDState).
- Available via `getDiagnostics` Luna method.

## 22. UI/Service Synchronization
- First run: UI runs Location Wizard → `setConfig`.
- Subsequent runs: UI opens → calls `getConfig` and `getStatus` → UI updates view.

## 23. Node/webOS Compatibility
**Target webOS Compatibility Concern:** LG TVs have deeply outdated Node.js versions (e.g., Node 0.12 to Node 12 depending on TV year).
- We must avoid modern ES syntax (`fetch`, optional chaining, ES modules, top-level `await`) in the service codebase.
- The built-in Node `http` module must be used for HyperHDR HTTP requests.

## 24. Error Model
Standardized error responses across Luna calls:
- `CONFIG_INVALID`
- `HYPERHDR_UNREACHABLE`
- `SOURCE_UNAVAILABLE`
- `ACTIVITY_ERROR`

## 25. Security/Permissions Concerns
Running private Luna APIs and keeping Activities persistent requires rooted environments. This software is targeted purely at Homebrew/Rooted LG TVs. Appropriate `services.json` permissions must be crafted.

## 26. Open Product Decisions
1. **AmbiSun Enabled = OFF:** If user disables AmbiSun, should automation leave current LEDs untouched, or force LEDs OFF? *(PRODUCT DECISION REQUIRED)*
2. **Unknown Source:** If current input is unknown, should we fallback to `defaultRule` or ignore? *(PRODUCT DECISION REQUIRED)*
3. **Manual Override:** If user toggles HyperHDR manually outside AmbiSun, should AmbiSun force its state back on the next event, or immediately? *(PRODUCT DECISION REQUIRED)*
4. **Wake after Sleep:** If TV wakes up, should AmbiSun immediately enforce expected LED state? *(PRODUCT DECISION REQUIRED - likely YES)*

## 27. Implementation Stages
See `docs/implementation_plan_service.md` for detailed phases.

## 28. Risks
- WebOS terminating the service aggressively despite Activity Manager usage.
- Private Luna APIs changing or being locked down in newer webOS versions.
- Memory leaks in Node service leading to TV slowdown.
- Incompatible Node.js versions on older TV models.
