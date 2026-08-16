# AmbiSun

**Smart Ambilight for HyperHDR on LG webOS TVs.**

[English](#english) | [Русский](#русский) | [Українська](#українська)

---

<a name="english"></a>
## English

> [!WARNING]
> **AmbiSun has been developed and tested on a rooted LG webOS TV.**<br>
> Unrooted TVs have not been validated and full functionality should not be expected, because source detection and several system integrations require privileged webOS services.

### What is AmbiSun?

AmbiSun is an LG webOS application and background service that automatically manages HyperHDR's LED output based on astronomical solar schedules (sunrise and sunset) and the currently active HDMI input or webOS application.

Instead of keeping ambient lighting permanently enabled or turning it on and off manually, AmbiSun computes local sunrise and sunset times on the TV and dynamically applies per-source automation rules:

- **Follow sun**: Turns LEDs on after sunset and off after sunrise.
- **Always on**: Keeps LEDs active whenever this input or application is open.
- **Always off**: Keeps LEDs disabled for this input or application (e.g., Live TV or news apps).

### Key Features

- **Astronomical Solar Calculations**: Accurate local sunrise and sunset times computed directly on the TV.
- **Configurable Time Offsets**: Adjust LED switch-on and switch-off times relative to sunset and sunrise (+/- minutes).
- **Offline Location Database**: Select countries and cities from an integrated offline GeoNames database without relying on external location APIs.
- **Automatic Source Detection**: Seamlessly detects active HDMI inputs and foreground webOS applications.
- **Per-Source Lighting Rules**: Configure individual rules for each HDMI port and application, with a fallback default rule for new apps.
- **HyperHDR `LEDDEVICE` Control**: Manages LED output via HyperHDR JSON-RPC without terminating or restarting the HyperHDR process.
- **Configurable Endpoint**: Connect to local or remote HyperHDR instances (default: `127.0.0.1:8090`) with an instant connection test.
- **Background webOS Service**: Lightweight background daemon (`org.webosbrew.ambisun.service`) maintains schedule timers and handles source change events.
- **Persistent Configuration**: User preferences, rules, and location data are saved persistently on the TV.
- **TV Remote Navigation**: Full D-pad spatial navigation tailored for standard LG Magic Remote controls.
- **Clean Minimize**: Minimize the application to the webOS Home launcher without interrupting background automation.
- **Multilingual UI**: Built-in support for English, Eesti (Estonian), Українська (Ukrainian), and Русский (Russian).
- **Update Infrastructure**: Built-in GitHub Releases update checker with UI badge notifications. *(In-app update support is implemented and is being prepared for release testing).*
- **Homebrew Channel Custom Repository**: Ready for custom repository distribution.

### How Automation Works

```text
Active Source Event (e.g., HDMI 1 / YouTube / Live TV)
               │
               ▼
   Check AmbiSun Automation Rule
   ├── Always On  ──────────► Turn HyperHDR LEDDEVICE On
   ├── Always Off ──────────► Turn HyperHDR LEDDEVICE Off
   └── Follow Sun ──────────► Evaluate local Sun Schedule
                                ├── Night (Sun below threshold) ──► LEDDEVICE On
                                └── Day   (Sun above threshold) ──► LEDDEVICE Off
```

**Example configuration:**
- `HDMI 1` (Apple TV / NVIDIA Shield) → **Follow sun**
- `YouTube` → **Always on**
- `Live TV` → **Always off**

### HyperHDR Integration

AmbiSun interacts with HyperHDR through its standard JSON-RPC interface. It targets the `LEDDEVICE` component specifically:
- When AmbiSun activates lighting, it enables `LEDDEVICE`.
- When AmbiSun disables lighting, it turns off `LEDDEVICE`.

HyperHDR continues processing video captures and stays running in the background without interruptions.

### Location & Privacy

- **Offline GeoNames Database**: City data is stored locally within the application service. Selecting a location does not require an active internet connection or third-party web APIs.
- **IP Country Detection**: An optional initial country suggestion can use network lookup on first run, while subsequent city selection is performed entirely offline.

### Supported Languages

- **English**
- **Eesti** (Estonian)
- **Українська** (Ukrainian)
- **Русский** (Russian)

### Project Layout

```text
AmbiSun/
├── appinfo.json                                  # webOS application metadata
├── packageinfo.json                              # Combined package definition
├── index.html                                    # Main TV user interface
├── assets/                                       # Application icons and branding
├── css/
│   └── app.css                                  # TV UI styles and animations
├── js/
│   ├── app.js                                   # UI controller and actions
│   ├── bridge.js                                # Frontend-to-backend bridge
│   ├── core.js                                  # Global namespace and helpers
│   ├── hyperhdr.js                              # HyperHDR client adapter
│   ├── i18n.js                                  # Localization runtime
│   ├── location.js                              # Location selection controller
│   ├── navigation.js                            # D-pad spatial navigation
│   ├── plasma.js                                # Background canvas animation
│   ├── sources.js                               # Source and app management UI
│   ├── startup.js                               # First-run wizard
│   ├── sun.js                                   # Solar schedule UI rendering
│   └── webos.js                                 # webOS Luna service bindings
├── i18n/
│   ├── en.json                                  # English localization
│   ├── et.json                                  # Estonian localization
│   ├── uk.json                                  # Ukrainian localization
│   └── ru.json                                  # Russian localization
├── service/
│   └── org.webosbrew.ambisun.service/           # Background Node.js service
│       ├── package.json                         # Service metadata
│       ├── services.json                        # Luna service registrations
│       ├── service.js                           # Main service entry point
│       ├── data/                                # Offline countries and cities database
│       └── lib/
│           ├── automation.js                    # Rule evaluation engine
│           ├── config.js                        # Persistent configuration manager
│           ├── decision.js                      # Source and solar decision logic
│           ├── hyperhdr.js                      # HyperHDR JSON-RPC client
│           ├── scheduler.js                     # Solar event scheduler
│           ├── source.js                        # Foreground source detector
│           ├── storage.js                       # Storage file helper
│           ├── sun.js                           # Solar angle calculations
│           └── updater.js                       # Secure release updater
├── homebrew/
│   └── r.json                                   # Homebrew Channel repository manifest
└── scripts/
    ├── package-debug.ps1                        # Build IPK package
    └── prepare-release.ps1                      # Release artifact generator
```

### Installation

- **Package ID**: `org.webosbrew.ambisun`
- **Service ID**: `org.webosbrew.ambisun.service`

*Release installation instructions and a short Homebrew Channel repository URL will be provided with the first public release.*

**Building from source:**
```powershell
# Build debug IPK package
powershell -ExecutionPolicy Bypass -File .\scripts\package-debug.ps1

# Or package via webOS CLI
ares-package . ./service/org.webosbrew.ambisun.service -o ./dist
```

### Updates

AmbiSun includes a background updater that checks GitHub Releases for new versions:
- When an update is available, a notification badge (`!`) appears in the sidebar next to **About**.
- Inside the About screen, an update card with release notes and an install button is displayed.
- *In-app update support is implemented and is being prepared for release testing.*

### License

Distributed under the MIT License. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

Copyright (c) 2026 Serjio193

---

<a name="русский"></a>
## Русский

> [!WARNING]
> **AmbiSun разработан и протестирован на рутированном LG webOS TV.**<br>
> Работа на нерутированных телевизорах не проверена и не поддерживается. Полная функциональность, скорее всего, будет недоступна, так как определение источников и часть системных функций требуют доступа к привилегированным сервисам webOS.

### Что такое AmbiSun?

AmbiSun — приложение и фоновый сервис для LG webOS, которое автоматически управляет выводом подсветки HyperHDR на основе астрономического времени восхода/заката солнца, а также текущего активного входа HDMI или приложения webOS.

Вместо постоянной работы подсветки или ручного переключения, AmbiSun вычисляет солнечное расписание прямо на телевизоре и применяет правила автоматизации:

- **По солнцу**: подсветка включается после заката и выключается после восхода.
- **Всегда включено**: подсветка активна при использовании выбранного источника или приложения.
- **Всегда выключено**: подсветка отключена (например, для эфирного ТВ или новостей).

### Основные возможности

- **Локальный расчет восхода и заката**: точные астрономические расчеты выполняются локально на телевизоре.
- **Смещения по времени**: настройка включения и выключения относительно заката и восхода (+/- минут).
- **Офлайн-база локаций**: выбор страны и города из встроенной базы GeoNames без необходимости сторонних онлайн API.
- **Автоматическое определение источников**: определение активных входов HDMI и запущенных приложений webOS.
- **Индивидуальные правила**: настройка правил для каждого источника/приложения и общее правило для новых программ.
- **Управление `LEDDEVICE` HyperHDR**: переключение компонента через JSON-RPC без остановки и перезапуска самого процесса HyperHDR.
- **Настройка адреса HyperHDR**: подключение к локальному или удаленному серверу (по умолчанию: `127.0.0.1:8090`) с проверкой связи.
- **Фоновый сервис webOS**: сервис `org.webosbrew.ambisun.service` обрабатывает таймеры расписания и события смены источников в фоне.
- **Сохранение настроек**: конфигурация, выбранный город и правила сохраняются на телевизоре.
- **Удобное управление с пульта**: полная адаптация интерфейса под D-pad пульта LG Magic Remote.
- **Корректное сворачивание**: кнопка «Свернуть» переводит экран на LG Home, сохраняя работу фонового сервиса.
- **Многоязычный интерфейс**: поддержка английского, эстонского, украинского и русского языков.
- **Проверка обновлений**: проверка новых версий через GitHub Releases. *(Механизм встроенного обновления реализован и готовится к релизному тестированию).*
- **Поддержка репозитория Homebrew Channel**: полная совместимость с экосистемой webOS Homebrew.

### Управление HyperHDR

AmbiSun взаимодействует с HyperHDR через JSON-RPC API и управляет исключительно компонентом `LEDDEVICE`:
- При наступлении условий включения AmbiSun активирует `LEDDEVICE`.
- При выключении AmbiSun деактивирует `LEDDEVICE`.

Сам HyperHDR продолжает работать в штатном режиме, не прерывая захват видеопотока.

### Конфиденциальность и локация

- **Встроенная база городов GeoNames**: данные хранятся локально. Поиск и выбор города не зависят от внешних веб-сервисов.
- **Определение страны по IP**: используется при первом запуске для подсказки страны, после чего выбор города происходит полностью офлайн.

### Поддерживаемые языки

- **English** (Английский)
- **Eesti** (Эстонский)
- **Українська** (Украинский)
- **Русский** (Русский)

### Установка

- **ID пакета**: `org.webosbrew.ambisun`
- **ID сервиса**: `org.webosbrew.ambisun.service`

*Инструкция по установке релизного пакета и короткий адрес репозитория Homebrew Channel будут опубликованы вместе с первым публичным релизом.*

**Сборка из исходников:**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-debug.ps1
```

### Обновления

AmbiSun автоматически проверяет наличие новых версий на GitHub Releases:
- При наличии обновления рядом с разделом **«О приложении»** появляется индикатор `!`.
- На экране «О приложении» отображается описание релиза и кнопка установки.
- *Механизм встроенного обновления реализован и готовится к релизному тестированию.*

### Лицензия

Проект распространяется под лицензией MIT. Подробности в файлах [LICENSE](LICENSE) и [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 Serjio193

---

<a name="українська"></a>
## Українська

> [!WARNING]
> **AmbiSun розроблено та протестовано на рутованому LG webOS TV.**<br>
> Роботу на нерутованих телевізорах не перевірено і вона не підтримується. Повна функціональність, найімовірніше, буде недоступною, оскільки визначення джерел і частина системних функцій потребують доступу до привілейованих сервісів webOS.

### Що таке AmbiSun?

AmbiSun — застосунок та фоновий сервіс для LG webOS, який автоматично керує підсвічуванням HyperHDR на основі астрономічного розкладу сходу/заходу сонця, а також активного входу HDMI або застосунку webOS.

Замість постійної роботи підсвічування чи ручного перемикання, AmbiSun обчислює сонячний розклад безпосередньо на телевізорі та застосовує гнучкі правила автоматизації:

- **За сонцем**: підсвічування вмикається після заходу сонця та вимикається після сходу.
- **Завжди увімкнено**: підсвічування працює під час використання обраного джерела або застосунку.
- **Завжди вимкнено**: підсвічування вимкнено (наприклад, для ефірного ТБ чи новинних програм).

### Основні можливості

- **Локальний розрахунок сходу та заходу сонця**: точні астрономічні обчислення виконуються локально на телевізорі.
- **Зміщення часу**: налаштування вмикання та вимикання відносно заходу та сходу (+/- хвилин).
- **Офлайн-база локацій**: вибір країни та міста з інтегрованої бази GeoNames без потреби у зовнішніх онлайн API.
- **Автоматичне визначення джерел**: розпізнавання активних входів HDMI та відкритих застосунків webOS.
- **Індивідуальні правила**: налаштування правил для кожного джерела/застосунку та загальне правило для нових програм.
- **Керування `LEDDEVICE` HyperHDR**: перемикання компонента через JSON-RPC без зупинки та перезапуску процесу HyperHDR.
- **Налаштування адреси HyperHDR**: підключення до локального або віддаленого сервера (за замовчуванням: `127.0.0.1:8090`) із перевіркою з'єднання.
- **Фоновий сервіс webOS**: демон `org.webosbrew.ambisun.service` підтримує таймери розкладу та обробляє події зміни джерел у фоні.
- **Збереження налаштувань**: конфігурація, обране місто та правила надійно зберігаються на телевізорі.
- **Зручна навігація пультом**: інтерфейс оптимізовано для керування D-pad пульта LG Magic Remote.
- **Коректне згортання**: кнопка «Згорнути» перемикає екран на LG Home, зберігаючи роботу фонової автоматизації.
- **Багатомовний інтерфейс**: підтримка англійської, естонської, української та російської мов.
- **Перевірка оновлень**: автоматична перевірка нових версій через GitHub Releases. *(Механізм оновлення в застосунку реалізовано та готується до релізного тестування).*
- **Підтримка репозиторію Homebrew Channel**: повна сумісність з екосистемою webOS Homebrew.

### Керування HyperHDR

AmbiSun взаємодіє з HyperHDR через JSON-RPC API та керує виключно компонентом `LEDDEVICE`:
- Коли настають умови для ввімкнення підсвічування, AmbiSun активує `LEDDEVICE`.
- Коли підсвічування має бути вимкнено, AmbiSun вимикає `LEDDEVICE`.

Сам HyperHDR продовжує безперервно працювати у штатному режимі.

### Конфіденційність та локація

- **Офлайн-база міст GeoNames**: база зберігається локально. Пошук та вибір міста не потребують підключення до сторонніх онлайн-сервісів.
- **Визначення країни за IP**: використовується під час першого запуску для підказки країни, після чого вибір міста здійснюється повністю офлайн.

### Підтримувані мови

- **English** (Англійська)
- **Eesti** (Естонська)
- **Українська** (Українська)
- **Русский** (Російська)

### Встановлення

- **ID пакета**: `org.webosbrew.ambisun`
- **ID сервісу**: `org.webosbrew.ambisun.service`

*Інструкція зі встановлення релізного пакета та коротка адреса репозиторію Homebrew Channel будуть надані разом із першим публічним релізом.*

**Збирання з вихідного коду:**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-debug.ps1
```

### Оновлення

AmbiSun автоматично перевіряє наявність нових версій на GitHub Releases:
- Якщо доступна нова версія, поруч із розділом **«Про застосунок»** з'являється індикатор `!`.
- На екрані «Про застосунок» відображається опис змін та кнопка для встановлення.
- *Механізм оновлення в застосунку реалізовано та готується до релізного тестування.*

### Ліцензія

Проєкт поширюється за ліцензією MIT. Деталі у файлах [LICENSE](LICENSE) та [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 Serjio193
