(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.startup = AmbiSun.startup || {};
  AmbiSun.config = AmbiSun.config || {};
  AmbiSun.config.startupSplashMs = 2500;

  function isFirstRun() {
    const STORAGE_KEYS = window.AmbiSun.constants.STORAGE_KEYS;
    try {
      return localStorage.getItem(STORAGE_KEYS.firstRunLanguageDone) !== '1';
    } catch (_) {
      return true;
    }
  }

  function show(firstRun) {
    const startup = document.getElementById('startupScreen');
    if (!startup) return;

    startup.classList.remove('closing');
    startup.classList.toggle('first-run', !!firstRun);
    startup.classList.add('open');
    startup.setAttribute('aria-hidden', 'false');

    if (firstRun) {
      // Always start on English so an unknown TV language cannot lock the user out.
      const preferred =
        document.querySelector('#firstRunLanguageList [data-language="en"]') ||
        document.querySelector('#firstRunLanguageList .startup-language');

      setTimeout(() => {
        if (AmbiSun.navigation && AmbiSun.navigation.setFocus) {
          AmbiSun.navigation.setFocus(preferred);
        }
      }, 80);
    }
  }

  function hide(callback) {
    const startup = document.getElementById('startupScreen');
    document.documentElement.classList.remove('ambisun-booting');

    if (!startup) {
      if (callback) callback();
      return;
    }

    startup.classList.add('closing');

    setTimeout(() => {
      startup.classList.remove('open', 'closing', 'first-run');
      startup.setAttribute('aria-hidden', 'true');
      if (callback) callback();
    }, 560);
  }

  async function completeLanguage(lang) {
    const STORAGE_KEYS = window.AmbiSun.constants.STORAGE_KEYS;
    await AmbiSun.i18n.setLanguage(lang);

    try {
      localStorage.setItem(STORAGE_KEYS.language, lang);
      localStorage.setItem(STORAGE_KEYS.firstRunLanguageDone, '1');
    } catch (_) {}

    hide(() => {
      setTimeout(() => {
        if (AmbiSun.location && AmbiSun.location.openWizard) {
          AmbiSun.location.openWizard();
        }
      }, 100);
    });
  }

  function start() {
    const firstRun = isFirstRun();
    show(firstRun);

    // On normal launches the splash is logo-only and dismisses automatically.
    if (!firstRun) {
      setTimeout(() => hide(), AmbiSun.config.startupSplashMs);
    }
  }

  AmbiSun.startup.isFirstRun = isFirstRun;
  AmbiSun.startup.show = show;
  AmbiSun.startup.hide = hide;
  AmbiSun.startup.completeLanguage = completeLanguage;
  AmbiSun.startup.start = start;
})();
