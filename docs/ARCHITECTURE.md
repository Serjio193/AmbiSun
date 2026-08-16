# Architecture

## UI

`index.html` contains markup only. Styling is in `css/app.css`; the main interaction controller
is in `js/app.js`. Low-level integrations are isolated in adapter files.

## HyperHDR

`js/hyperhdr.js` targets the local HyperHDR JSON-RPC endpoint and exposes a small API to the UI.
The final background service should own reliable long-running automation and reconnection.

## Solar schedule

`js/sun.js` contains an offline NOAA-style sunrise/sunset calculation. Solar event instants are
calculated independently of the display timezone; the TV/browser timezone is used when formatting
Dates. Polar day/night results are represented explicitly.

## Location

The first-run wizard is already present. `js/location.js` intentionally does not hard-code an IP
geolocation provider. We will choose/configure the provider later and keep provider-specific code
behind that adapter.

## Localization

Each locale is a JSON file. English is canonical. Extra languages will eventually be generated
on demand by sending only missing keys to a translation backend. Existing user-installed
translations should not be overwritten unnecessarily.

## Background service

The service scaffold currently exposes only `ping`. It will eventually own:
1. settings persistence;
2. source/app monitoring;
3. solar schedule evaluation;
4. HyperHDR LEDDEVICE switching;
5. reconnect/recovery logic.
