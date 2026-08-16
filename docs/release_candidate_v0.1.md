# AmbiSun v0.1 RC

## Features
- persistent backend config
- local HyperHDR LEDDEVICE control
- solar rules
- per-source overrides
- HDMI/app source detection
- Activity Manager solar scheduling
- Activity Manager source wake
- automatic Homebrew elevation recovery
- English / Eesti / Українська / Русский

## Requirements
- rooted LG webOS TV
- Homebrew Channel
- HyperHDR on 127.0.0.1:8090

## Installation behavior
- IPK installation
- elevation may be removed after install/update
- AmbiSun restores elevation through Homebrew Channel

## Configuration storage
/media/internal/ambisun/config.json

## Known limitations
- location selection currently uses wizard/static city data
- no advanced HyperHDR configuration editor
- rooted/Homebrew environment required

## Verified environment
- webOS TV 10.3.1
- Node 16.20.2
- arm
- HyperHDR local JSON-RPC
