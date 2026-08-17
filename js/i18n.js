(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.i18n = AmbiSun.i18n || {};

  const titleKeys = {
    home: 'nav.home',
    sources: 'nav.sources',
    sun: 'nav.sun',
    settings: 'nav.settings',
    language: 'nav.language',
    about: 'nav.about'
  };

  const BUILTIN_CODES = ['en', 'et', 'uk', 'ru'];

  const I18N_FALLBACK = {
    en: {
      nav: { home: "Home", sources: "Sources & apps", sun: "Sun & schedule", settings: "Settings", language: "Language", about: "About" },
      common: { yes: "Yes", no: "No", back: "Back", change: "Change", minimize: "Minimize" },
      rule: { sun: "By sun", on: "Always ON", off: "Always OFF" }
    }
  };

  let I18N = {};
  let I18N_LANG = 'ru';
  let dynamicLocales = {};
  let dynamicNames = {};

  function t(key, fallback = key){
    const parts = key.split('.');
    let cur = I18N;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object' || !(p in cur)) return fallback;
      cur = cur[p];
    }
    return typeof cur === 'string' ? cur : fallback;
  }

  function systemLanguageCode(){
    return ((navigator.language || 'en').split('-')[0] || 'en').toLowerCase();
  }

  function registerDynamicLocale(code, localeObj, dir = 'ltr', displayName = code) {
    if (!code || !localeObj) return;
    dynamicLocales[code] = {
      locale: localeObj,
      dir: dir === 'rtl' ? 'rtl' : 'ltr',
      name: displayName
    };
    dynamicNames[code] = displayName;
  }

  async function loadLanguage(lang){
    const requested = lang === 'system'
      ? systemLanguageCode()
      : lang;

    let data = null;
    let used = null;
    let direction = 'ltr';

    if (dynamicLocales[requested] && dynamicLocales[requested].locale) {
      data = dynamicLocales[requested].locale;
      used = requested;
      direction = dynamicLocales[requested].dir || 'ltr';
    } else if (BUILTIN_CODES.indexOf(requested) !== -1) {
      const candidates = [...new Set([requested, 'en'])];
      for (const code of candidates) {
        try {
          const r = await fetch(`i18n/${code}.json`, { cache: 'no-store' });
          if (!r.ok) continue;
          data = await r.json();
          used = code;
          direction = 'ltr';
          break;
        } catch (_) {}
      }
    } else {
      // Dynamic language fetch from service
      try {
        if (AmbiSun.webos && AmbiSun.webos.getTranslationLocale) {
          const res = await AmbiSun.webos.getTranslationLocale(requested);
          if (res && res.returnValue && res.locale) {
            data = res.locale;
            used = requested;
            direction = res.dir || 'ltr';
            registerDynamicLocale(requested, data, direction, res.nativeName || res.name || requested);
          }
        }
      } catch (_) {}
    }

    // Emergency fallback to en.json or local fallback
    if (!data) {
      try {
        const r = await fetch(`i18n/en.json`, { cache: 'no-store' });
        if (r.ok) {
          data = await r.json();
          used = 'en';
        }
      } catch (_) {}
    }

    if (!data && I18N_FALLBACK.en) {
      data = I18N_FALLBACK.en;
      used = 'en';
    }

    if (!data) return false;

    I18N = data;
    I18N_LANG = used;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = t(key, el.textContent);
    });

    document.documentElement.lang = used;
    document.documentElement.dir = direction;

    const currentScreen = window.AmbiSun.state.screen;
    const titleEl = document.getElementById('screenTitle');
    if (titleEl && titleKeys[currentScreen]) {
      titleEl.textContent = t(titleKeys[currentScreen], currentScreen);
    }

    return true;
  }

  async function setLanguage(lang){
    window.AmbiSun.state.language = lang;
    try {
      localStorage.setItem(window.AmbiSun.constants.STORAGE_KEYS.language, lang);
    } catch (_) {}

    await loadLanguage(lang);

    renderLanguageScreen();

    const label = languageName(lang);
    const sub = document.querySelector('.nav-item[data-screen="language"] .sub');
    if (sub) sub.textContent = label;

    const settingsBadge = document.getElementById('settingsLanguageBadge');
    if (settingsBadge) settingsBadge.textContent = label + ' ›';
  }

  function renderLanguageScreen() {
    const container = document.querySelector('#language .page-card');
    if (!container) return;

    const current = currentLanguage();
    const builtin = [
      { code: 'en', name: 'English', badge: 'EN' },
      { code: 'et', name: 'Eesti', badge: 'ET' },
      { code: 'uk', name: 'Українська', badge: 'UK' },
      { code: 'ru', name: 'Русский', badge: 'RU' }
    ];

    let html = '';

    builtin.forEach(item => {
      const isSel = item.code === current;
      html += `<div class="list-item actionable ${isSel ? 'language-selected' : ''}" data-action="set-language" data-language="${item.code}" role="button" tabindex="-1">
        <span>${isSel ? '◉' : '○'}</span>
        <span>${item.name}</span>
        <span>${item.badge}</span>
      </div>`;
    });

    // Dynamic downloaded languages
    for (const code in dynamicLocales) {
      if (BUILTIN_CODES.indexOf(code) !== -1) continue;
      const dyn = dynamicLocales[code];
      const isSel = code === current;
      html += `<div class="list-item actionable ${isSel ? 'language-selected' : ''}" data-action="set-language" data-language="${code}" role="button" tabindex="-1">
        <span>${isSel ? '◉' : '○'}</span>
        <span>${dyn.name || code}</span>
        <span>${code.toUpperCase()}</span>
      </div>`;
    }

    // Other languages action row
    html += `<div class="list-item actionable other-languages" data-action="open-other-languages" role="button" tabindex="-1" style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.06); padding-top:14px">
      <span>🌐</span>
      <span data-i18n="language.otherLanguages">${t('language.otherLanguages', 'Другие языки…')}</span>
      <span>›</span>
    </div>`;

    container.innerHTML = html;
  }

  function currentLanguage(){
    return I18N_LANG || window.AmbiSun.state.language || 'ru';
  }

  function languageName(lang){
    if (dynamicNames[lang]) return dynamicNames[lang];
    const names = {
      en: 'English',
      ru: 'Русский',
      uk: 'Українська',
      et: 'Eesti',
      de: 'Deutsch',
      fr: 'Français',
      es: 'Español',
      it: 'Italiano',
      system: t('language.system', 'Как на телевизоре')
    };
    return names[lang] || lang;
  }

  function savedLanguage(){
    try {
      return localStorage.getItem(window.AmbiSun.constants.STORAGE_KEYS.language) || 'ru';
    } catch (_) {
      return 'ru';
    }
  }

  async function loadDownloadedOnStartup() {
    try {
      if (AmbiSun.webos && AmbiSun.webos.getDownloadedLanguages) {
        const res = await AmbiSun.webos.getDownloadedLanguages();
        if (res && res.returnValue && Array.isArray(res.downloaded)) {
          res.downloaded.forEach(item => {
            dynamicNames[item.code] = item.nativeName || item.name || item.code;
          });
        }
      }
    } catch (_) {}
  }

  AmbiSun.i18n.t = t;
  AmbiSun.i18n.loadLanguage = loadLanguage;
  AmbiSun.i18n.setLanguage = setLanguage;
  AmbiSun.i18n.savedLanguage = savedLanguage;
  AmbiSun.i18n.systemLanguageCode = systemLanguageCode;
  AmbiSun.i18n.currentLanguage = currentLanguage;
  AmbiSun.i18n.languageName = languageName;
  AmbiSun.i18n.renderLanguageScreen = renderLanguageScreen;
  AmbiSun.i18n.registerDynamicLocale = registerDynamicLocale;
  AmbiSun.i18n.loadDownloadedOnStartup = loadDownloadedOnStartup;
})();
