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

  // Development preview fallback.
  const I18N_FALLBACK = {
    en: {
      nav: {home:"Home",sources:"Sources & apps",sun:"Sun & schedule",settings:"Settings",language:"Language",about:"About"},
      common: {yes:"Yes",no:"No",back:"Back",change:"Change"},
      rule: {sun:"By sun",on:"Always ON",off:"Always OFF"}
    }
  };

  let I18N = {};
  let I18N_LANG = 'ru';

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

  async function loadLanguage(lang){
    const requested = lang === 'system'
      ? systemLanguageCode()
      : lang;

    const candidates = [...new Set([requested, 'en'])];
    let data = null;
    let used = null;

    // Real app path: load separate JSON files.
    for (const code of candidates) {
      try {
        const r = await fetch(`i18n/${code}.json`, {cache:'no-store'});
        if (!r.ok) continue;
        data = await r.json();
        used = code;
        break;
      } catch (_) {
        // file:// preview commonly blocks fetch; fallback below handles it.
      }
    }

    // Emergency fallback only. Translation JSON files are the source of truth.
    if (!data) {
      for (const code of candidates) {
        if (I18N_FALLBACK[code]) {
          data = I18N_FALLBACK[code];
          used = code;
          break;
        }
      }
    }

    if (!data) return false;

    I18N = data;
    I18N_LANG = used;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = t(key, el.textContent);
    });

    document.documentElement.lang = used;
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

    document.querySelectorAll('#language .list-item').forEach(item => {
      const selected = item.dataset.language === lang;
      item.classList.toggle('language-selected', selected);
      const first = item.querySelector('span');
      if (first) first.textContent = selected ? '◉' : '○';
    });

    const selectedItem = document.querySelector(`#language .list-item[data-language="${lang}"]`);
    const label = (selectedItem && selectedItem.querySelectorAll('span')[1]?.textContent) || languageName(lang);
    const sub = document.querySelector('.nav-item[data-screen="language"] .sub');
    if (sub) sub.textContent = label;

    const settingsBadge = document.getElementById('settingsLanguageBadge');
    if (settingsBadge) settingsBadge.textContent = label;
  }

  function currentLanguage(){
    return I18N_LANG || window.AmbiSun.state.language || 'en';
  }

  function languageName(lang){
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
      return localStorage.getItem(window.AmbiSun.constants.STORAGE_KEYS.language) || 'en';
    } catch (_) {
      return 'en';
    }
  }

  AmbiSun.i18n.t = t;
  AmbiSun.i18n.loadLanguage = loadLanguage;
  AmbiSun.i18n.setLanguage = setLanguage;
  AmbiSun.i18n.savedLanguage = savedLanguage;
  AmbiSun.i18n.systemLanguageCode = systemLanguageCode;
  AmbiSun.i18n.currentLanguage = currentLanguage;
  AmbiSun.i18n.languageName = languageName;

})();
