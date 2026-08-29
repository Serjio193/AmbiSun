(function () {
  "use strict";

  const state = window.AmbiSun.state;
  const SUPPORT = window.AmbiSun.constants.SUPPORT;
  const STORAGE_KEYS = window.AmbiSun.constants.STORAGE_KEYS;

  function showToast(text, timeout = 1400) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), timeout);
  }

  function updateBoolean(setting) {
    const value = !!state[setting];
    document.querySelectorAll(`[data-setting-badge="${setting}"]`).forEach(badge => {
      badge.textContent = value ? AmbiSun.i18n.t('common.on', 'ON') : AmbiSun.i18n.t('common.off', 'OFF');
      badge.classList.toggle('on', value);
      badge.classList.toggle('off', !value);
    });
  }

  window.updateBoolean = updateBoolean;
  window.showToast = showToast;

  function clearAmbiSunStorage() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('ambisun.') === 0) keys.push(key);
      }
      keys.forEach(function (key) { localStorage.removeItem(key); });
    } catch (_) {}
  }

  function selectSupport(key) {
    const data = SUPPORT[key];
    if (!data) return;
    document.querySelectorAll('.support-method').forEach(item => {
      item.classList.toggle('active', item.dataset.support === key);
    });
    document.getElementById('supportQr').src = data.qr;
    document.getElementById('supportTitle').textContent = data.title;
    document.getElementById('supportAddress').textContent = data.value;
  }

  async function resetDemoState() {
    showToast(AmbiSun.i18n.t('toast.resetting', 'Resetting settings…'));
    try {
      const res = await AmbiSun.webos.resetConfig();
      if (!res.returnValue) throw new Error(res.errorText || 'reset failed');
      clearAmbiSunStorage();
      state.showHiddenSources = false;
      await AmbiSun.bridge.syncConfig();
      try {
        const fallbackLanguage = AmbiSun.i18n.systemLanguageCode ? AmbiSun.i18n.systemLanguageCode() : 'en';
        await AmbiSun.i18n.setLanguage(fallbackLanguage);
        localStorage.removeItem(STORAGE_KEYS.language);
      } catch (_) {}
      if (AmbiSun.location && AmbiSun.location.closeWizard) AmbiSun.location.closeWizard();
      if (state.screen === 'effectPicker' && AmbiSun.effectPicker && AmbiSun.effectPicker.close) AmbiSun.effectPicker.close();
      AmbiSun.navigation.openScreen('home');
      if (AmbiSun.startup && AmbiSun.startup.restartFirstRun) AmbiSun.startup.restartFirstRun();
      showToast(AmbiSun.i18n.t('toast.reset', 'Settings reset'));
    } catch (error) {
      showToast(AmbiSun.i18n.t('error.saveFailed', 'Save failed: ') + error.message);
    }
  }

  window.AmbiSunUi = {
    selectSupport: selectSupport,
    resetDemoState: resetDemoState
  };
}());
