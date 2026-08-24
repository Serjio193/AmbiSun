(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  const bridge = window.AmbiSun.bridge;
  let lastUpdateCheck = 0;
  const UPDATE_CHECK_TTL = 900000;

  function checkForUpdate(force) {
    const now = Date.now();
    if (!force && (now - lastUpdateCheck) < UPDATE_CHECK_TTL) return Promise.resolve();
    lastUpdateCheck = now;
    return AmbiSun.webos.checkForUpdate().then(function (res) {
      if (!res || !res.returnValue) return;
      if (res.currentVersion) {
        const version = document.getElementById('aboutVersionNumber');
        if (version) version.textContent = res.currentVersion;
      }
      AmbiSun.state.update = res;
      const badge = document.getElementById('aboutUpdateBadge');
      if (badge) badge.classList.toggle('visible', !!res.updateAvailable);
      const panel = document.getElementById('updateAvailablePanel');
      if (!panel) return;
      if (!res.updateAvailable) {
        panel.style.display = 'none';
        return;
      }
      panel.style.display = 'block';
      const title = document.getElementById('updateTitle');
      if (title) title.textContent = AmbiSun.i18n.t('update.available', 'Update available') + ' ' + (res.latestVersion || '');
      const notes = document.getElementById('updateNotes');
      if (notes) {
        const lang = AmbiSun.i18n.currentLanguage ? AmbiSun.i18n.currentLanguage() : 'en';
        const text = (res.notes && (res.notes[lang] || res.notes.en || res.notes.ru)) || '';
        notes.textContent = typeof text === 'string' ? text : '';
      }
    }).catch(function (error) {
      console.warn('[bridge] checkForUpdate error:', error && error.message);
    });
  }

  function onScreenOpen(screenId) {
    if (!bridge.isElevated()) return;
    if (screenId === 'home') {
      bridge.syncSolar();
      bridge.syncSources();
    } else if (screenId === 'sources' || screenId === 'sourcesHdmi' || screenId === 'sourcesApps') {
      bridge.syncSources();
    } else if (screenId === 'settings') {
      bridge.syncConfig();
      bridge.syncSolar();
    } else if (screenId === 'about') {
      checkForUpdate();
    }
  }

  let elevRetries = 0;
  function startElevationRetry(onComplete) {
    elevRetries = 0;
    doElevationRetry(onComplete);
  }

  function doElevationRetry(onComplete) {
    if (elevRetries >= 8) {
      elevRetries = 0;
      if (typeof onComplete === 'function') onComplete(false);
      return;
    }
    elevRetries++;
    setTimeout(function () {
      bridge.checkSystemStatus().then(function () {
        if (!bridge.isElevated()) return doElevationRetry(onComplete);
        elevRetries = 0;
        if (typeof onComplete === 'function') onComplete(true);
      }).catch(function () {
        if (!bridge.isElevated()) return doElevationRetry(onComplete);
        elevRetries = 0;
        if (typeof onComplete === 'function') onComplete(true);
      });
    }, 1500);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && bridge.isElevated()) {
      bridge.checkSystemStatus();
      bridge.pollCurrentSource();
    }
  });

  bridge.checkForUpdate = checkForUpdate;
  bridge.onScreenOpen = onScreenOpen;
  bridge.startElevationRetry = startElevationRetry;
}());
