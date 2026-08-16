# AmbiSun

**Smart Ambilight for HyperHDR on rooted LG webOS TVs.**

AmbiSun is being built to control HyperHDR's LED output automatically from
sunrise/sunset and the currently active HDMI source or webOS application.

## Current status

This repository contains the first development scaffold and the interactive TV UI prototype.
The UI is usable with arrow keys / OK and is structured so real webOS and HyperHDR calls can
replace the prototype actions without redesigning the screens.

### Implemented in the UI

- black AmbiSun startup splash;
- first-launch language choice: English, Eesti, Українська, Русский, plus future online languages;
- first-launch location wizard;
- source/application rules: by sun, always on, always off;
- sunrise/sunset offsets;
- HyperHDR Plasma-style animated background;
- settings, update/about and support screens;
- JSON localization files.

### Planned runtime behavior

- calculate sunrise/sunset locally from latitude/longitude;
- use TV system timezone for local display and DST;
- detect active webOS app / HDMI input;
- control HyperHDR `LEDDEVICE`;
- run automation in a background JS service when the UI is closed;
- generate additional language JSON files on demand through a translation backend.

## Project layout

```text
AmbiSun/
├── appinfo.json
├── packageinfo.json
├── index.html
├── assets/
│   ├── icon.png
│   └── largeicon.png
├── css/
│   └── app.css
├── js/
│   ├── app.js
│   ├── hyperhdr.js
│   ├── location.js
│   ├── sun.js
│   └── webos.js
├── i18n/
│   ├── en.json
│   ├── et.json
│   ├── uk.json
│   └── ru.json
├── service/
│   └── org.webosbrew.ambisun.service/
│       ├── package.json
│       ├── services.json
│       └── service.js
└── docs/
```

## Packaging

With the webOS TV CLI installed, the intended package layout is a web app plus a JS service.

```sh
ares-package . ./service/org.webosbrew.ambisun.service
```

The package ID is currently `org.webosbrew.ambisun`.

## HyperHDR

The app-side adapter is in `js/hyperhdr.js`. AmbiSun is designed to switch the
`LEDDEVICE` component rather than stop the HyperHDR process.

## Languages

`i18n/en.json` is the canonical source language. Built-in translations currently include
English, Estonian, Ukrainian and Russian. The planned **Other languages** flow will request
a supported-language list, translate missing English strings through a backend, save the
returned JSON locally, and apply it immediately.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

> Early development project. Do not treat the current UI values or service behavior as final.
