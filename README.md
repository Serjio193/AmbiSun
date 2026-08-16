# AmbiSun

**Smart ambient lighting automation for HyperHDR on LG webOS.**

[English](#english) | [Русский](#русский) | [Українська](#українська)

---

<a name="english"></a>
## English

### What is AmbiSun?

AmbiSun is an ambient lighting automation application and background service for LG webOS TVs running HyperHDR. It automatically switches HyperHDR's LED output based on astronomical sunrise and sunset times, combined with customized rules for each HDMI input and webOS application.

> [!WARNING]
> **AmbiSun has been developed and tested on a rooted LG webOS TV.**<br>
> Unrooted TVs have not been validated and full functionality should not be expected, because source detection and several system integrations require privileged webOS services.

### Why I Made AmbiSun

The idea for AmbiSun came from a simple everyday inconvenience. After setting up ambient lighting with HyperHDR for my TV, I quickly realized how tedious it was to manually turn the LEDs on and off every single day.

A standard fixed-time schedule simply didn't work. I live in Estonia, where day length varies dramatically across the year: winters have very short daylight hours, while summers bring bright white nights. A fixed turn-on time like 18:00 (6:00 PM) might feel natural in December, but makes little sense in June when the sun is still high above the horizon.

Rather than relying on a static clock timer or requiring dedicated ambient light sensors, I decided to link the lighting directly to local astronomical sunrise and sunset calculations for the user's city. AmbiSun calculates these transition times automatically on the TV, while adjustable minute offsets (+/- minutes) let you dial in the exact moment your room gets dark enough for ambient backlighting.

Later, I expanded the concept to support per-source rules — so lighting can follow the sun for your streaming media box (e.g. Apple TV / SHIELD), stay always on for YouTube, and remain completely off for ordinary Live TV channels.

### What It Does

- **Astronomical Solar Calculations**: Computes daily sunrise, sunset, and solar schedule locally on the TV.
- **Configurable Time Offsets**: Adjust LED turn-on and turn-off times relative to sunset and sunrise (+/- minutes).
- **Automatic Source Detection**: Seamlessly detects active HDMI inputs and foreground webOS applications.
- **Per-Source Automation Rules**: Assign individual rules (*Follow Sun*, *Always On*, *Always Off*) to each HDMI port and app.
- **Default Rule for New Apps**: Set a baseline rule for newly launched or unconfigured applications.
- **HyperHDR `LEDDEVICE` Control**: Toggles the LED output via HyperHDR JSON-RPC without restarting or terminating the HyperHDR process.
- **Configurable Endpoint**: Connects to local (`127.0.0.1:8090`) or remote HyperHDR network instances with a built-in connection test.
- **Background webOS Service**: Runs as a lightweight background daemon (`org.webosbrew.ambisun.service`) to ensure automation works even when the UI is closed.
- **Offline GeoNames Database**: Select countries and cities from an integrated offline database without requiring third-party location APIs.
- **TV Remote Navigation**: Intuitive D-pad spatial navigation tailored for the LG Magic Remote.
- **Clean Minimize**: Quickly return to the webOS Home launcher with the *Minimize* button while background services continue running.
- **Multilingual UI**: Native support for English, Eesti (Estonian), Українська (Ukrainian), and Русский (Russian).
- **Update Infrastructure**: Built-in GitHub Releases update checker with badge notifications. *(In-app self-update is implemented and pending final physical release validation).*
- **Homebrew Channel Custom Repository**: Ready for installation via the webOS Homebrew Channel repository ecosystem.

### Screenshots

> Screenshots from the TV interface will be added here soon.

<!--
Future screenshots:
- Main screen / Status & Solar summary
- Sources and applications list
- Settings screen
- HyperHDR configuration dialog
- About / Update panel
-->

### Requirements

- **LG webOS TV** (tested and verified on rooted webOS with Homebrew Channel).
- **HyperHDR** installed locally on the TV or running on an accessible local network device.
- **Network access** to the HyperHDR JSON-RPC port (default `8090`).

### Basic Workflow

1. **Install AmbiSun** on your LG webOS TV.
2. **Select your language** (English, Eesti, Українська, Русский).
3. **Select your country and city** from the integrated offline database.
4. **Configure the HyperHDR address and port** (default `127.0.0.1:8090`).
5. **Test the connection** to verify communication with HyperHDR.
6. **Open Sources & Applications** to see detected inputs and apps.
7. **Assign lighting rules** to individual HDMI ports and applications.
8. **Adjust sunrise/sunset offsets** on the Home screen to match your room lighting preferences.
9. **Minimize AmbiSun** to return to the LG Home launcher.
10. **Enjoy automatic ambient lighting** — the background service handles the rest.

**Example rule setup:**
```text
HDMI 1 (Apple TV / Shield)  ──►  Follow Sun   (LEDs on at dusk, off at dawn)
YouTube                      ──►  Always On    (LEDs always active)
Live TV / News               ──►  Always Off   (LEDs remain disabled)
```

### HyperHDR Integration

AmbiSun communicates with HyperHDR through its standard JSON-RPC interface and manages the `LEDDEVICE` component directly:
- When turning lighting on, AmbiSun sends `{ "command": "componentstate", "componentstate": { "component": "LEDDEVICE", "state": true } }`.
- When turning lighting off, AmbiSun sets `LEDDEVICE` state to `false`.

This architecture ensures HyperHDR stays running smoothly without process interruptions or HDMI capture restarts.

### Location & Privacy

- **Offline GeoNames Database**: Cities and coordinates are stored locally inside the service package. Choosing a location does not require an active internet connection or third-party web services.
- **Optional IP Country Detection**: On first run, an optional network lookup can suggest your current country, after which all city searching remains completely offline.

### Installation

- **Package ID**: `org.webosbrew.ambisun`
- **Service ID**: `org.webosbrew.ambisun.service`

**Homebrew Channel Custom Repository:**
AmbiSun is distributed through a dedicated custom Homebrew Channel repository:

```text
https://serjio193.github.io/r.json
```

*The repository endpoint is live. The installable package will become available there with the first public AmbiSun release.*

**Building from source:**
```powershell
# Build debug IPK package
powershell -ExecutionPolicy Bypass -File .\scripts\package-debug.ps1

# Or package with webOS CLI
ares-package . ./service/org.webosbrew.ambisun.service -o ./dist
```

### Updates

AmbiSun periodically checks GitHub Releases for new updates:
- An update indicator (`!`) appears in the sidebar next to **About** when a new release is found.
- The About screen displays release notes and an *Install Update* button.
- *In-app self-update is implemented and pending final physical release validation.*

### Supported Languages

- **English**
- **Eesti** (Estonian)
- **Українська** (Ukrainian)
- **Русский** (Russian)

### Support

If you enjoy using AmbiSun and would like to support its ongoing development:

- **PayPal**: [https://paypal.me/SerhiiTarnopovych](https://paypal.me/SerhiiTarnopovych)
- **USDT (TRC20)**: `TB4kzsHL3emLtdvDroNE9dEpMhUW6r3bTL`

### License

Distributed under the MIT License. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

Copyright (c) 2026 Serjio193

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
    ├── prepare-release.ps1                      # Release artifact generator
    └── deploy-tv.ps1                            # TV deployment and testing script
```

---

<a name="русский"></a>
## Русский

### Что такое AmbiSun?

AmbiSun — приложение и фоновый сервис для телевизоров LG webOS с подсветкой HyperHDR. Оно автоматически управляет выводом подсветки на основе времени восхода и заката солнца, а также активного HDMI-входа или приложения webOS.

> [!WARNING]
> **AmbiSun разработан и протестирован на рутированном LG webOS TV.**<br>
> Работа на нерутированных телевизорах не проверена и не поддерживается. Полная функциональность, скорее всего, будет недоступна, так как определение источников и часть системных функций требуют доступа к привилегированным сервисам webOS.

### Почему я сделал AmbiSun

Идея AmbiSun появилась из простой бытовой проблемы. Я собрал себе фоновую подсветку телевизора на базе HyperHDR, но довольно быстро понял, что постоянно включать и выключать её вручную мне просто лень.

Настроить обычный таймер по фиксированным часам тоже не получилось. Я живу в Эстонии: зимой здесь очень короткий световой день, а летом — белые ночи. Фиксированное время включения, например 18:00, может быть правильным в декабре и совершенно бессмысленным в июне, когда на улице ещё вовсю светит солнце.

Поэтому я решил привязать работу подсветки не к статическому времени на часах и не к дополнительным датчикам освещённости, а к реальному астрономическому восходу и закату солнца для выбранного города. AmbiSun рассчитывает эти моменты прямо на телевизоре, а настраиваемые смещения в минутах (+/- минут) позволяют идеально подогнать момент включения и выключения под конкретную комнату.

Позже к этому добавились индивидуальные правила для HDMI и приложений webOS: например, подсветку можно оставить «По солнцу» для медиаприставки (Apple TV / SHIELD), всегда включать для YouTube и всегда выключать для эфирного телевидения.

### Возможности

- **Расчёт восхода и заката**: локальный астрономический расчёт времени восхода, заката и положения солнца на телевизоре.
- **Смещения по времени**: удобная настройка задержки включения и выключения относительно заката и восхода (+/- минут).
- **Автоматическое определение источников**: определение активных HDMI-портов и запущенных приложений webOS.
- **Индивидуальные правила подсветки**: выбор режима (*По солнцу*, *Всегда включено*, *Всегда выключено*) для каждого источника.
- **Правило по умолчанию**: автоматическое применение правила для новых и не настроенных приложений.
- **Управление `LEDDEVICE` HyperHDR**: переключение вывода на светодиоды через JSON-RPC без остановки и перезапуска самого HyperHDR.
- **Гибкая настройка адреса HyperHDR**: поддержка локального (`127.0.0.1:8090`) и удалённого сервера с мгновенной проверкой связи.
- **Фоновый сервис webOS**: демон `org.webosbrew.ambisun.service` обеспечивает непрерывную работу автоматики даже при закрытом интерфейсе.
- **Встроенная база городов GeoNames**: выбор страны и города офлайн без обращения к сторонним интернет-сервисам.
- **Удобное управление с пульта**: полноценная адаптация под стрелки и колесо пульта LG Magic Remote.
- **Кнопка «Свернуть»**: быстрый переход в системный LG Home без выключения фонового сервиса.
- **Многоязычный интерфейс**: поддержка английского, эстонского, украинского и русского языков.
- **Проверка обновлений**: проверка новых релизов на GitHub Releases. *(Встроенный установщик обновлений реализован и готовится к релизному тестированию).*
- **Поддержка репозитория Homebrew Channel**: готовность к установке через каталог Homebrew.

### Скриншоты

> Скриншоты интерфейса с телевизора будут добавлены позже.

### Требования

- **Телевизор LG webOS** (разработано и протестировано на рутированном webOS с Homebrew Channel).
- **HyperHDR**, установленный на телевизоре или на отдельном устройстве в локальной сети.
- **Сетевой доступ** к порту JSON-RPC HyperHDR (по умолчанию `8090`).

### Как пользоваться

1. **Установите AmbiSun** на телевизор LG webOS.
2. **Выберите язык** (English, Eesti, Українська, Русский).
3. **Выберите страну и город** из встроенной базы локаций.
4. **Укажите адрес и порт HyperHDR** (по умолчанию `127.0.0.1:8090`).
5. **Проверьте соединение**, нажав на строку адреса HyperHDR.
6. **Откройте «Источники и приложения»** со списком найденных входов и программ.
7. **Назначьте правила** для нужных HDMI-портов и приложений.
8. **Настройте смещения заката и восхода** на Главном экране при необходимости.
9. **Нажмите «Свернуть»**, чтобы вернуться в домашнее меню LG Home.
10. **Фоновый сервис** продолжит автоматически управлять подсветкой.

**Пример настройки:**
```text
HDMI 1 (Apple TV / Shield)  ──►  По солнцу         (включается в сумерках, гаснет на рассвете)
YouTube                      ──►  Всегда включено   (подсветка горит всегда)
Эфирное ТВ / Новости         ──►  Всегда выключено  (подсветка отключена)
```

### Управление HyperHDR

AmbiSun работает с HyperHDR через стандартный протокол JSON-RPC и переключает исключительно компонент `LEDDEVICE`:
- При необходимости включить подсветку отправляется команда активации `LEDDEVICE`.
- При выключении подсветки компонент `LEDDEVICE` отключается.

Сам HyperHDR остаётся активным, непрерывно обрабатывая захват изображения.

### Локация и конфиденциальность

- **Офлайн-база GeoNames**: координаты городов хранятся локально в пакете сервиса. Выбор города не требует подключения к внешним веб-API.
- **Определение страны по IP**: опционально используется при первом запуске для подсказки страны, после чего поиск городов работает офлайн.

### Установка

- **ID пакета**: `org.webosbrew.ambisun`
- **ID сервиса**: `org.webosbrew.ambisun.service`

**Кастомный репозиторий Homebrew Channel:**
AmbiSun подготовлен для распространения через официальный механизм репозиториев webOS Homebrew Channel:

```text
https://serjio193.github.io/r.json
```

*Адрес репозитория уже опубликован. Установочный пакет появится в нём вместе с первым публичным релизом AmbiSun.*

**Сборка из исходников:**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-debug.ps1
```

### Обновления

AmbiSun автоматически проверяет наличие новых версий на GitHub Releases:
- При выходе обновления возле пункта **«О приложении»** появляется индикатор `!`.
- На экране «О приложении» открывается список изменений и кнопка установки.
- *Встроенный установщик обновлений реализован и готовится к релизному тестированию.*

### Поддерживаемые языки

- **English** (Английский)
- **Eesti** (Эстонский)
- **Українська** (Украинский)
- **Русский** (Русский)

### Поддержать проект

Если вам нравится AmbiSun и вы хотите поддержать его развитие:

- **PayPal**: [https://paypal.me/SerhiiTarnopovych](https://paypal.me/SerhiiTarnopovych)
- **USDT (TRC20)**: `TB4kzsHL3emLtdvDroNE9dEpMhUW6r3bTL`

### Лицензия

Распространяется под лицензией MIT. Подробности в файлах [LICENSE](LICENSE) и [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 Serjio193

---

<a name="українська"></a>
## Українська

### Що таке AmbiSun?

AmbiSun — застосунок та фоновий сервіс для телевізорів LG webOS із фоновим підсвічуванням HyperHDR. Він автоматично керує увімкненням та вимкненням підсвічування на основі астрономічного розкладу сходу й заходу сонця, а також активного входу HDMI чи застосунку webOS.

> [!WARNING]
> **AmbiSun розроблено та протестовано на рутованому LG webOS TV.**<br>
> Роботу на нерутованих телевізорах не перевірено і вона не підтримується. Повна функціональність, найімовірніше, буде недоступною, оскільки визначення джерел і частина системних функцій потребують доступу до привілейованих сервісів webOS.

### Чому я створив AmbiSun

Ідея AmbiSun виникла зі звичайної побутової проблеми. Склавши власну систему фонового підсвічування телевізора на базі HyperHDR, я досить швидко помітив, як незручно щодня вручну вмикати та вимикати її.

Звичайний таймер за фіксованим часом для мене не підійшов. Я живу в Естонії, де тривалість світлового дня кардинально змінюється впродовж року: взимку світловий день дуже короткий, а влітку настають білі ночі. Фіксований час увімкнення, наприклад 18:00, може бути доречним у грудні, але втрачає будь-який сенс у червні, коли надворі ще довго світить сонце.

Тому я вирішив прив'язати роботу підсвічування не до статичного годинника чи додаткових датчиків освітлення, а до реального астрономічного сходу та заходу сонця для обраного міста. AmbiSun самостійно розраховує цей розклад прямо на телевізорі, а зміщення у хвилинах (+/- хвилин) дають змогу точно підлаштувати вмикання під умови вашої кімнати.

Згодом до цього додалися індивідуальні правила для входів HDMI та застосунків webOS: наприклад, підсвічування можна вмикати «За сонцем» для медіаприставки (Apple TV / SHIELD), завжди тримати увімкненим для YouTube та повністю вимикати для ефірного телебачення.

### Можливості

- **Розрахунок сходу та заходу сонця**: локальне астрономічне обчислення сходу, заходу та положення сонця на телевізорі.
- **Зміщення часу**: зручне налаштування затримки вмикання та вимикання відносно заходу та сходу (+/- хвилин).
- **Автоматичне визначення джерел**: виявлення активних входів HDMI та запущених програм webOS.
- **Індивідуальні правила підсвічування**: вибір режиму (*За сонцем*, *Завжди увімкнено*, *Завжди вимкнено*) для кожного джерела.
- **Правило за замовчуванням**: автоматичне застосування правила для нових та ненастроєних програм.
- **Керування `LEDDEVICE` HyperHDR**: перемикання світлодіодного виводу через JSON-RPC без перезапуску чи зупинки HyperHDR.
- **Гнучке налаштування адреси HyperHDR**: підтримка локального (`127.0.0.1:8090`) та віддаленого сервера зі швидкою перевіркою зв'язку.
- **Фоновий сервіс webOS**: демон `org.webosbrew.ambisun.service` підтримує автоматизацію навіть за закритого інтерфейсу.
- **Вбудована база міст GeoNames**: вибір країни та міста офлайн без звернення до сторонніх інтернет-сервісів.
- **Зручне керування пультом**: повна оптимізація під навігацію D-pad пульта LG Magic Remote.
- **Кнопка «Згорнути»**: плавний перехід до домашнього екрана LG Home зі збереженням роботи фонового сервісу.
- **Багатомовний інтерфейс**: підтримка англійської, естонської, української та російської мов.
- **Перевірка оновлень**: моніторинг нових релізів на GitHub Releases. *(Вбудоване оновлення реалізовано та готується до релізного тестування).*
- **Підтримка репозиторію Homebrew Channel**: сумісність із каталогом Homebrew.

### Скріншоти

> Скріншоти інтерфейсу з телевізора будуть додані пізніше.

### Вимоги

- **Телевізор LG webOS** (розроблено та протестовано на рутованому webOS із Homebrew Channel).
- **HyperHDR**, встановлений на телевізорі або на іншому пристрої в локальній мережі.
- **Мережевий доступ** до порту JSON-RPC HyperHDR (за замовчуванням `8090`).

### Як користуватися

1. **Встановіть AmbiSun** на телевізор LG webOS.
2. **Оберіть мову** (English, Eesti, Українська, Русский).
3. **Оберіть країну та місто** з інтегрованої офлайн-бази.
4. **Вкажіть адресу та порт HyperHDR** (за замовчуванням `127.0.0.1:8090`).
5. **Перевірте з'єднання**, натиснувши на рядок адреси HyperHDR.
6. **Відкрийте «Джерела та застосунки»** зі списком знайдених входів і програм.
7. **Призначте правила** для потрібних входів HDMI та застосунків.
8. **Налаштуйте зміщення сходу й заходу сонця** на Головному екрані за потреби.
9. **Натисніть «Згорнути»**, щоб перейти до системного меню LG Home.
10. **Фоновий сервіс** продовжить самостійно керувати підсвічуванням.

**Приклад налаштування:**
```text
HDMI 1 (Apple TV / Shield)  ──►  За сонцем           (вмикається в сутінках, згасає на світанку)
YouTube                      ──►  Завжди увімкнено   (підсвічування активне завжди)
Ефірне ТБ / Новини           ──►  Завжди вимкнено    (підсвічування вимкнено)
```

### Керування HyperHDR

AmbiSun взаємодіє з HyperHDR за стандартом JSON-RPC і керує виключно компонентом `LEDDEVICE`:
- Для ввімкнення підсвічування AmbiSun надсилає команду активації `LEDDEVICE`.
- Для вимкнення підсвічування стан `LEDDEVICE` встановлюється у `false`.

HyperHDR безперервно залишається активним, не перериваючи захоплення відео.

### Локація та конфіденційність

- **Офлайн-база GeoNames**: координати міст зберігаються локально. Пошук та вибір міста не залежать від сторонніх веб-сервісів.
- **Визначення країни за IP**: опціонально використовується під час першого запуску для підказки країни, після чого вибір міста працює офлайн.

### Встановлення

- **ID пакета**: `org.webosbrew.ambisun`
- **ID сервісу**: `org.webosbrew.ambisun.service`

**Кастомний репозиторій Homebrew Channel:**
AmbiSun адаптовано для встановлення через систему репозиторіїв webOS Homebrew Channel:

```text
https://serjio193.github.io/r.json
```

*Адресу репозиторію вже опубліковано. Інсталяційний пакет з'явиться в ньому разом із першим публічним релізом AmbiSun.*

**Збирання з вихідного коду:**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-debug.ps1
```

### Оновлення

AmbiSun автоматично перевіряє вихід нових версій на GitHub Releases:
- Поруч із пунктом **«Про застосунок»** з'являється індикатор `!`, коли доступне оновлення.
- На екрані «Про застосунок» відображається список змін та кнопка для встановлення.
- *Вбудоване оновлення реалізовано та готується до релізного тестування.*

### Підтримувані мови

- **English** (Англійська)
- **Eesti** (Естонська)
- **Українська** (Українська)
- **Русский** (Російська)

### Підтримати проєкт

Якщо вам подобається AmbiSun і ви бажаєте підтримати його розробку:

- **PayPal**: [https://paypal.me/SerhiiTarnopovych](https://paypal.me/SerhiiTarnopovych)
- **USDT (TRC20)**: `TB4kzsHL3emLtdvDroNE9dEpMhUW6r3bTL`

### Ліцензія

Поширюється за ліцензією MIT. Деталі у файлах [LICENSE](LICENSE) та [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 Serjio193

---

## Links

- **GitHub Repository**: [https://github.com/Serjio193/AmbiSun](https://github.com/Serjio193/AmbiSun)
- **Releases**: [https://github.com/Serjio193/AmbiSun/releases](https://github.com/Serjio193/AmbiSun/releases)
- **Issues**: [https://github.com/Serjio193/AmbiSun/issues](https://github.com/Serjio193/AmbiSun/issues)
- **Homebrew Repository Endpoint**: [https://serjio193.github.io/r.json](https://serjio193.github.io/r.json)
- **HyperHDR Project**: [https://github.com/awawa-dev/HyperHDR](https://github.com/awawa-dev/HyperHDR)
