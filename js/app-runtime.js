(function () {
  "use strict";

  const state = window.AmbiSun.state;

  function updateSettingsLanguageBadge() {
    const badge = document.getElementById('settingsLanguageBadge');
    if (!badge) return;
    const lang = (AmbiSun.i18n && AmbiSun.i18n.currentLanguage) ? AmbiSun.i18n.currentLanguage() : (state.language || 'en');
    const label = (AmbiSun.i18n && AmbiSun.i18n.languageName) ? AmbiSun.i18n.languageName(lang) : lang;
    badge.textContent = label + ' ›';
  }

  function clampBrightness(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function updateBrightnessUi() {
    const globalValue = clampBrightness(state.brightness);
    document.querySelectorAll('[data-brightness-scope="default"]').forEach(slider => {
      slider.value = String(globalValue);
    });
    document.querySelectorAll('[data-default-brightness-badge]').forEach(badge => {
      badge.textContent = globalValue + '%';
    });
    const overrides = state.sourceBrightness || {};
    document.querySelectorAll('[data-brightness-source]').forEach(slider => {
      const sourceId = slider.dataset.brightnessSource;
      const value = Object.prototype.hasOwnProperty.call(overrides, sourceId)
        ? clampBrightness(overrides[sourceId]) : globalValue;
      slider.value = String(value);
      const badge = slider.parentElement && slider.parentElement.querySelector('.source-brightness-value');
      if (badge) badge.textContent = value + '%';
    });
  }

  function setDefaultBrightness(value) {
    const next = clampBrightness(value);
    state.brightness = next;
    updateBrightnessUi();
    clearTimeout(window._brightnessSaveTimer);
    window._brightnessSaveTimer = setTimeout(() => AmbiSun.bridge.mutateConfig({ brightness: next }), 250);
  }

  function setSourceBrightness(sourceId, value, onSaved) {
    if (!sourceId) return;
    const sourceBrightness = Object.assign({}, state.sourceBrightness || {});
    sourceBrightness[sourceId] = clampBrightness(value);
    state.sourceBrightness = sourceBrightness;
    updateBrightnessUi();
    clearTimeout(window._sourceBrightnessSaveTimer);
    window._sourceBrightnessSaveTimer = setTimeout(() => {
      AmbiSun.bridge.mutateConfig({ sourceBrightness: state.sourceBrightness }, { skipSync: true, skipSolarSync: true }).then(function (success) {
        if (success && typeof onSaved === 'function') window.setTimeout(onSaved, 250);
      });
    }, 250);
  }

  window.updateBrightnessUi = updateBrightnessUi;
  window.setSourceBrightness = setSourceBrightness;

  document.addEventListener('input', event => {
    const slider = event.target && event.target.closest
      ? event.target.closest('[data-brightness-scope="default"]') : null;
    if (slider) setDefaultBrightness(slider.value);
  });

  function updateClock() {
    const date = new Date();
    const lang = (AmbiSun.i18n && AmbiSun.i18n.currentLanguage) ? AmbiSun.i18n.currentLanguage() : 'en';
    try {
      document.getElementById('clock').textContent = date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
      document.getElementById('date').textContent = date.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (_) {
      document.getElementById('clock').textContent = date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
      document.getElementById('date').textContent = date.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });
    }
  }

  async function initUI() {
    AmbiSun.navigation.setActionHandler(window.dispatchAmbiSunAction);
    AmbiSun.navigation.setBackHandler(() => {
      const startup = document.getElementById('startupScreen');
      const wizard = document.getElementById('locationWizard');
      const hyperhdrModal = document.getElementById('hyperhdrModal');
      if (startup && startup.classList.contains('open') && startup.classList.contains('first-run')) return;
      if (hyperhdrModal && hyperhdrModal.classList.contains('open')) {
        hyperhdrModal.classList.remove('open');
        hyperhdrModal.setAttribute('aria-hidden', 'true');
        const openRow = document.querySelector('.list-item[data-action="open-hyperhdr"]');
        if (openRow && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(openRow);
        return;
      }
      if (wizard && wizard.classList.contains('open')) {
        if (AmbiSun.location && AmbiSun.location.back) AmbiSun.location.back();
        return;
      }
      if (AmbiSun.license && AmbiSun.license.close()) return;
      if (window.AmbiSun.state.screen === 'effectPicker' && AmbiSun.effectPicker) {
        AmbiSun.effectPicker.close();
        return;
      }
      if (window.AmbiSun.state.screen === 'language') {
        AmbiSun.navigation.openScreen('settings');
        const langRow = document.querySelector('.list-item[data-action="open-language"]');
        if (langRow && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(langRow);
        return;
      }
      const nav = document.querySelector(`.nav-item[data-screen="${window.AmbiSun.state.screen}"]`);
      if (nav) AmbiSun.navigation.setFocus(nav);
    });
    AmbiSun.navigation.bind();
    AmbiSun.plasma.init();
    if (AmbiSun.sources.renderSourceList) AmbiSun.sources.renderSourceList();
    AmbiSun.location.updateUI();
    updateBoolean('enabled');
    const lang = AmbiSun.i18n.savedLanguage();
    await AmbiSun.i18n.setLanguage(lang);
    updateSettingsLanguageBadge();
    if (AmbiSun.bridge && AmbiSun.bridge.updateHyperhdrBadge) AmbiSun.bridge.updateHyperhdrBadge();
    AmbiSunUi.selectSupport('paypal');
    AmbiSun.navigation.openScreen('home');
    updateClock();
    setInterval(updateClock, 30000);
    AmbiSun.startup.start();
    const splashMs = (AmbiSun.config.startupSplashMs || 2500) + 300;
    setTimeout(() => {
      if (AmbiSun.bridge && AmbiSun.bridge.checkSystemStatus) AmbiSun.bridge.checkSystemStatus();
    }, splashMs);
    setTimeout(() => {
      if (AmbiSun.bridge && AmbiSun.bridge.checkForUpdate) AmbiSun.bridge.checkForUpdate();
    }, splashMs + 4000);
  }

  window.AmbiSun.app = {
    updateClock: updateClock,
    updateSettingsLanguageBadge: updateSettingsLanguageBadge,
    setSourceRule: window.setSourceRule,
    setSourceEffect: window.setSourceEffect,
    setDefaultEffect: window.setDefaultEffect
  };
  initUI();
}());
