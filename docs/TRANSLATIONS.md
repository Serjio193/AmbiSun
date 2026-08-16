# Translations

The source language is `i18n/en.json`.

Built-in languages:
- `en` — English
- `et` — Eesti
- `uk` — Українська
- `ru` — Русский

## Planned generated-language flow

1. User selects **Other languages…**.
2. AmbiSun loads the supported language list from the translation backend.
3. User chooses a language using the remote.
4. AmbiSun sends only the source keys that do not already exist locally.
5. Backend returns translated values without changing JSON keys.
6. AmbiSun stores the resulting locale and applies it immediately.
7. Future app updates translate only new/missing keys.

API credentials must not be embedded in the TV application. A small translation proxy/backend
should hold provider credentials.
