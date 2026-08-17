(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  const AmbiSun = window.AmbiSun;
  AmbiSun.i18n = AmbiSun.i18n || {};

  const titleKeys = {
    home: 'nav.home',
    sources: 'nav.sources',
    sun: 'nav.sun',
    settings: 'nav.settings',
    language: 'nav.language',
    about: 'nav.about'
  };

  const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
    { code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr' },
    { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
    { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', dir: 'ltr' },
    { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português (Portugal)', dir: 'ltr' },
    { code: 'it', name: 'Italian', nativeName: 'Italiano', dir: 'ltr' },
    { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', dir: 'ltr' },
    { code: 'pl', name: 'Polish', nativeName: 'Polski', dir: 'ltr' },
    { code: 'cs', name: 'Czech', nativeName: 'Čeština', dir: 'ltr' },
    { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', dir: 'ltr' },
    { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', dir: 'ltr' },
    { code: 'ro', name: 'Romanian', nativeName: 'Română', dir: 'ltr' },
    { code: 'bg', name: 'Bulgarian', nativeName: 'Български', dir: 'ltr' },
    { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', dir: 'ltr' },
    { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', dir: 'ltr' },
    { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', dir: 'ltr' },
    { code: 'sr', name: 'Serbian', nativeName: 'Српски', dir: 'ltr' },
    { code: 'et', name: 'Estonian', nativeName: 'Eesti', dir: 'ltr' },
    { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', dir: 'ltr' },
    { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', dir: 'ltr' },
    { code: 'fi', name: 'Finnish', nativeName: 'Suomi', dir: 'ltr' },
    { code: 'sv', name: 'Swedish', nativeName: 'Svenska', dir: 'ltr' },
    { code: 'da', name: 'Danish', nativeName: 'Dansk', dir: 'ltr' },
    { code: 'no', name: 'Norwegian', nativeName: 'Norsk', dir: 'ltr' },
    { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', dir: 'ltr' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
    { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', dir: 'ltr' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
    { code: 'he', name: 'Hebrew', nativeName: 'עברית', dir: 'rtl' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' },
    { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', dir: 'ltr' },
    { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', dir: 'ltr' },
    { code: 'th', name: 'Thai', nativeName: 'ไทย', dir: 'ltr' },
    { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', dir: 'ltr' },
    { code: 'ko', name: 'Korean', nativeName: '한국어', dir: 'ltr' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
    { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', dir: 'ltr' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', dir: 'ltr' }
  ];

  const I18N_FALLBACK = {
    en: {
      nav: { home: "Home", sources: "Sources & apps", sun: "Sun & schedule", settings: "Settings", language: "Language", about: "About" },
      common: { yes: "Yes", no: "No", back: "Back", change: "Change", minimize: "Minimize" },
      rule: { sun: "By sun", on: "Always ON", off: "Always OFF" }
    }
  };

  let I18N = {};
  let I18N_LANG = 'en';

  function t(key, fallback = key){
    const parts = key.split('.');
    let cur = I18N;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object' || !(p in cur)) return fallback;
      cur = cur[p];
    }
    return typeof cur === 'string' ? cur : fallback;
  }

  function normalizeLocale(rawLocale) {
    if (!rawLocale || typeof rawLocale !== 'string') return 'en';
    const tag = rawLocale.trim();
    const lower = tag.toLowerCase();

    // Exact code matches (case-insensitive check against supported list)
    for (const item of SUPPORTED_LANGUAGES) {
      if (item.code.toLowerCase() === lower) return item.code;
    }

    // Specific regional mappings
    if (lower === 'zh-hans' || lower === 'zh-sg' || lower === 'zh-my' || lower.startsWith('zh-cn')) return 'zh-CN';
    if (lower === 'zh-hant' || lower === 'zh-hk' || lower === 'zh-mo' || lower.startsWith('zh-tw')) return 'zh-TW';
    if (lower === 'pt-br') return 'pt-BR';
    if (lower === 'pt-pt' || lower === 'pt') return 'pt-PT';

    // Prefix matching
    const prefix = lower.split(/[-_]/)[0];
    if (prefix === 'zh') return 'zh-CN';
    if (prefix === 'pt') return 'pt-PT';

    for (const item of SUPPORTED_LANGUAGES) {
      if (item.code.toLowerCase() === prefix) return item.code;
    }

    return 'en';
  }

  function systemLanguageCode(){
    const raw = (navigator.language || (navigator.languages && navigator.languages[0]) || 'en');
    return normalizeLocale(raw);
  }

  async function loadLanguage(lang){
    const requested = lang === 'system'
      ? systemLanguageCode()
      : normalizeLocale(lang);

    let data = null;
    let used = null;

    const langMeta = SUPPORTED_LANGUAGES.find(l => l.code === requested) ||
                     SUPPORTED_LANGUAGES.find(l => l.code === 'en');
    const targetCode = langMeta ? langMeta.code : 'en';
    const direction = langMeta && langMeta.dir === 'rtl' ? 'rtl' : 'ltr';

    // Load local JSON from i18n/<code_with_case>.json
    const candidates = [targetCode];
    if (targetCode !== 'en') candidates.push('en');

    for (const code of candidates) {
      try {
        const r = await fetch(`i18n/${code}.json`, { cache: 'no-store' });
        if (!r.ok) continue;
        data = await r.json();
        used = code;
        break;
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

    const currentScreen = window.AmbiSun.state ? window.AmbiSun.state.screen : 'home';
    const titleEl = document.getElementById('screenTitle');
    if (titleEl && titleKeys[currentScreen]) {
      titleEl.textContent = t(titleKeys[currentScreen], currentScreen);
    }

    return true;
  }

  async function setLanguage(lang){
    const normalized = normalizeLocale(lang);
    if (window.AmbiSun.state) {
      window.AmbiSun.state.language = normalized;
    }
    try {
      localStorage.setItem(window.AmbiSun.constants.STORAGE_KEYS.language, normalized);
    } catch (_) {}

    await loadLanguage(normalized);

    renderLanguageScreen();

    const label = languageName(normalized);
    const sub = document.querySelector('.nav-item[data-screen="language"] .sub');
    if (sub) sub.textContent = label;

    const settingsBadge = document.getElementById('settingsLanguageBadge');
    if (settingsBadge) settingsBadge.textContent = label + ' ›';
  }

  function renderLanguageScreen() {
    const container = document.querySelector('#language .page-card');
    if (!container) return;

    const current = currentLanguage();
    const frag = document.createDocumentFragment();

    SUPPORTED_LANGUAGES.forEach(item => {
      const isSel = item.code === current;
      const row = document.createElement('div');
      row.className = `list-item actionable ${isSel ? 'language-selected' : ''}`;
      row.dataset.action = 'set-language';
      row.dataset.language = item.code;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '-1');

      const iconSpan = document.createElement('span');
      iconSpan.textContent = isSel ? '◉' : '○';
      row.appendChild(iconSpan);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.nativeName;
      if (item.name !== item.nativeName) {
        nameSpan.title = item.name;
      }
      row.appendChild(nameSpan);

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'glyph-badge';
      badgeSpan.textContent = item.code.toUpperCase();
      row.appendChild(badgeSpan);

      frag.appendChild(row);
    });

    container.textContent = '';
    container.appendChild(frag);
  }

  function renderFirstRunLanguageList() {
    const container = document.getElementById('firstRunLanguageList');
    if (!container) return;

    const frag = document.createDocumentFragment();
    SUPPORTED_LANGUAGES.forEach(item => {
      const el = document.createElement('div');
      el.className = 'startup-language actionable';
      el.dataset.action = 'first-run-language';
      el.dataset.language = item.code;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '-1');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.nativeName;
      el.appendChild(nameSpan);

      const badgeSmall = document.createElement('small');
      badgeSmall.textContent = item.code.toUpperCase();
      el.appendChild(badgeSmall);

      frag.appendChild(el);
    });

    container.textContent = '';
    container.appendChild(frag);
  }

  function currentLanguage(){
    return I18N_LANG || (window.AmbiSun.state && window.AmbiSun.state.language) || 'en';
  }

  function languageName(lang){
    const target = normalizeLocale(lang);
    const found = SUPPORTED_LANGUAGES.find(l => l.code === target);
    if (found) return found.nativeName;
    return lang;
  }

  function savedLanguage(){
    try {
      const saved = localStorage.getItem(window.AmbiSun.constants.STORAGE_KEYS.language);
      if (saved) return normalizeLocale(saved);
    } catch (_) {}
    return systemLanguageCode();
  }

  AmbiSun.i18n.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
  AmbiSun.i18n.normalizeLocale = normalizeLocale;
  AmbiSun.i18n.t = t;
  AmbiSun.i18n.loadLanguage = loadLanguage;
  AmbiSun.i18n.setLanguage = setLanguage;
  AmbiSun.i18n.savedLanguage = savedLanguage;
  AmbiSun.i18n.systemLanguageCode = systemLanguageCode;
  AmbiSun.i18n.currentLanguage = currentLanguage;
  AmbiSun.i18n.languageName = languageName;
  AmbiSun.i18n.renderLanguageScreen = renderLanguageScreen;
  AmbiSun.i18n.renderFirstRunLanguageList = renderFirstRunLanguageList;
})();
