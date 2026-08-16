(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.bridge = AmbiSun.bridge || {};

  // ---- State ----
  var isElevated = false;
  var isChecking = false;
  var configRevision = null;

  // ---- Time formatting ----
  function fmt(isoStr, tz) {
    if (!isoStr) return null;
    try {
      return new Date(isoStr).toLocaleTimeString('ru-RU', {
        hour: '2-digit', minute: '2-digit',
        timeZone: tz || 'Europe/Tallinn'
      });
    } catch(e) {
      try { return new Date(isoStr).toUTCString().slice(17,22); } catch(_) { return null; }
    }
  }

  function fmtNext(isoStr, tz) {
    if (!isoStr) return null;
    try {
      var d = new Date(isoStr);
      var now = new Date();
      var timePart = d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit', timeZone: tz || 'UTC' });
      var dDay = new Date(d.toLocaleString('en-US', { timeZone: tz || 'UTC' })).toDateString();
      var nowDay = new Date(now.toLocaleString('en-US', { timeZone: tz || 'UTC' })).toDateString();
      return (dDay === nowDay ? 'Сегодня' : 'Завтра') + ', ' + timePart;
    } catch(e) { return null; }
  }

  function fmtOffset(n) {
    if (n == null) return '';
    return '(' + (n >= 0 ? '+' : '') + n + ' мин)';
  }

  function fmtOffsetStepper(n) {
    if (n == null) return '0 мин';
    return (n >= 0 ? '+' : '') + n + ' мин';
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el && val != null) el.textContent = val;
  }

  // ---- System Status check (elevation gate) ----
  function checkSystemStatus() {
    if (isChecking) return Promise.resolve();
    isChecking = true;
    return AmbiSun.webos.getSystemStatus()
      .then(function(res) {
        isChecking = false;
        handleSystemStatus(res.system || res);
      })
      .catch(function(e) {
        isChecking = false;
        console.warn('[bridge] getSystemStatus failed:', e && e.message);
        // Show solar/sources as unavailable since service unreachable
        renderSolarUnavailable('Сервис недоступен');
        renderSourcesError('Сервис недоступен');
      });
  }

  function handleSystemStatus(sys) {
    var elevWizard = document.getElementById('elevationWizard');

    if (!sys || !sys.elevated) {
      isElevated = false;
      if (elevWizard) elevWizard.setAttribute('aria-hidden', 'false');
      return;
    }

    if (!isElevated) {
      isElevated = true;
      if (elevWizard && elevWizard.getAttribute('aria-hidden') === 'false') {
        elevWizard.setAttribute('aria-hidden', 'true');
      }
    }

    // Fire sync jobs in parallel — each handles its own errors
    if (sys) updateHyperhdrBadge(sys.hyperhdrReachable);
    syncConfig();
    syncSolar();
    syncSources();
  }

  function updateHyperhdrBadge(status) {
    var badge = document.getElementById('hyperhdrStatusBadge');
    if (!badge) return;
    var hdr = AmbiSun.state.hyperhdr || { host: '127.0.0.1', port: 8090 };
    var ep = hdr.host + ':' + hdr.port;
    if (status === true || status === 'ok') {
      badge.textContent = ep + ' OK ›';
      badge.className = 'mode on';
    } else if (status === false || status === 'error') {
      var unavail = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('hyperhdr.unavailable', 'Недоступен') : 'Недоступен';
      badge.textContent = ep + ' ' + unavail + ' ›';
      badge.className = 'mode off';
    } else {
      badge.textContent = ep + ' ›';
      badge.className = 'mode';
    }
  }

  // ---- Config sync ----
  function syncConfig() {
    return AmbiSun.webos.getConfig()
      .then(function(res) {
        var cfg = res && res.config;
        if (!cfg) return;
        configRevision = res.revision;
        AmbiSun.state.enabled = !!cfg.enabled;
        AmbiSun.state.defaultRule = cfg.defaultRule || 'sun';
        AmbiSun.state.sunsetOffset = typeof cfg.sunsetOffset === 'number' ? cfg.sunsetOffset : 0;
        AmbiSun.state.sunriseOffset = typeof cfg.sunriseOffset === 'number' ? cfg.sunriseOffset : 0;
        if (cfg.location) AmbiSun.state.location = cfg.location;
        if (cfg.overrides) AmbiSun.state.sourceRules = cfg.overrides;
        if (cfg.hyperhdr) {
          AmbiSun.state.hyperhdr = {
            host: cfg.hyperhdr.host || '127.0.0.1',
            port: cfg.hyperhdr.port || 8090
          };
          if (AmbiSun.config) {
            AmbiSun.config.hyperhdrEndpoint = "http://" + AmbiSun.state.hyperhdr.host + ":" + AmbiSun.state.hyperhdr.port + "/json-rpc?request";
          }
        }
        updateHyperhdrBadge();

        // Update steppers immediately
        document.querySelectorAll('[data-setting-value="sunset"]').forEach(function(el) {
          el.textContent = fmtOffsetStepper(cfg.sunsetOffset);
        });
        document.querySelectorAll('[data-setting-value="sunrise"]').forEach(function(el) {
          el.textContent = fmtOffsetStepper(cfg.sunriseOffset);
        });

        if (typeof window.updateBoolean === 'function') window.updateBoolean('enabled');
        if (AmbiSun.location && AmbiSun.location.updateUI) AmbiSun.location.updateUI();
        if (AmbiSun.sources && AmbiSun.sources.updateDefaultRule) AmbiSun.sources.updateDefaultRule();
      })
      .catch(function(e) {
        console.warn('[bridge] syncConfig failed:', e && e.message);
      });
  }

  // ---- Solar sync ----
  function syncSolar() {
    // Show loading state first
    renderSolarLoading();
    return AmbiSun.webos.getSolarStatus()
      .then(function(res) {
        if (!res || !res.returnValue || !res.solar) {
          renderSolarUnavailable('Нет данных');
          return;
        }
        var s = res.solar;
        var tz = s.timezone || 'Europe/Tallinn';

        setText('homeSunset',          fmt(s.todaySunset, tz)        || '—');
        setText('homeEffSunset',        fmt(s.effectiveSunset, tz)    || '—');
        setText('homeSunrise',          fmt(s.tomorrowSunrise, tz)    || '—');
        setText('homeEffSunsetOffset',  fmtOffset(s.sunsetOffset));
        setText('homeEffSunriseOffset', fmtOffset(s.sunriseOffset));

        var nextOn  = document.getElementById('homeNextOn');
        var nextOff = document.getElementById('homeNextOff');
        if (s.nextEventType === 'on') {
          if (nextOn)  nextOn.textContent  = fmtNext(s.nextEventAt, tz) || '—';
          if (nextOff) nextOff.textContent = fmtNext(s.effectiveSunrise, tz) || '—';
        } else if (s.nextEventType === 'off') {
          if (nextOn)  nextOn.textContent  = '—';
          if (nextOff) nextOff.textContent = fmtNext(s.nextEventAt, tz) || '—';
        } else {
          if (nextOn)  nextOn.textContent  = '—';
          if (nextOff) nextOff.textContent = '—';
        }
      })
      .catch(function(e) {
        var msg = (e && e.message && e.message.indexOf('TIMEOUT') >= 0)
          ? 'Таймаут' : 'Ошибка';
        renderSolarUnavailable(msg);
      });
  }

  function renderSolarLoading() {
    // Don't clear current values — just leave as-is during reload
  }

  function renderSolarUnavailable(reason) {
    var ids = ['homeSunset','homeEffSunset','homeSunrise','homeNextOn','homeNextOff'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (el && (el.textContent === '—' || el.textContent === '')) {
        el.textContent = reason || '—';
        el.style.color = 'var(--muted)';
        el.style.fontSize = '14px';
      }
    });
  }

  // ---- Sources sync ----
  var sourcesLastFetch = 0;
  var SOURCES_TTL = 20000;

  function syncSources(force) {
    var now = Date.now();
    if (!force && (now - sourcesLastFetch) < SOURCES_TTL) return Promise.resolve();
    sourcesLastFetch = now;

    // Show loading state on sources screen
    renderSourcesLoading();

    return AmbiSun.webos.getAvailableSources()
      .then(function(res) {
        if (!res || !res.returnValue) {
          renderSourcesError('Нет ответа от сервиса');
          return;
        }
        if (res.currentSource) {
          // Strip raw field — only keep type/id/name
          var cs = res.currentSource;
          AmbiSun.state.currentSource = { type: cs.type, id: cs.id, name: cs.name };
        }
        if (res.sources && res.sources.length > 0) {
          AmbiSun.state.sourceCatalog = res.sources;
        }

        // Update home current source label
        var cs = AmbiSun.state.currentSource;
        setText('homeCurrentSource',
          (cs && cs.type !== 'unknown' && cs.name) ? cs.name : '—');

        if (AmbiSun.sources && AmbiSun.sources.renderSourceList) {
          AmbiSun.sources.renderSourceList();
        }
      })
      .catch(function(e) {
        var msg = (e && e.message && e.message.indexOf('TIMEOUT') >= 0)
          ? 'Таймаут (5с)' : (e && e.message) || 'Ошибка';
        renderSourcesError(msg);
      });
  }

  function renderSourcesLoading() {
    var list = document.getElementById('sourceList');
    if (!list) return;
    // Only show spinner if list is currently empty
    if (list.children.length === 0) {
      list.innerHTML = '<div style="padding:32px;color:var(--muted);font-size:18px;text-align:center">⏳ Загрузка...</div>';
    }
  }

  function renderSourcesError(msg) {
    // If we already have catalog data — don't overwrite with error
    if (AmbiSun.state.sourceCatalog && AmbiSun.state.sourceCatalog.length > 0) {
      if (AmbiSun.sources && AmbiSun.sources.renderSourceList) {
        AmbiSun.sources.renderSourceList();
      }
      return;
    }
    var list = document.getElementById('sourceList');
    if (!list) return;
    list.innerHTML =
      '<div style="padding:32px;color:var(--danger);font-size:18px;text-align:center">' +
      '⚠ ' + (msg || 'Ошибка') + '</div>' +
      '<div style="padding:8px 32px;color:var(--muted);font-size:15px;text-align:center">' +
      'Нажмите OK для повтора</div>';
    // Allow retry via OK on this element
    var retryEl = list.firstChild;
    if (retryEl) {
      retryEl.className = 'actionable';
      retryEl.dataset.action = 'sources-retry';
      retryEl.setAttribute('tabindex', '-1');
      retryEl.setAttribute('role', 'button');
    }
  }

  // ---- Config mutation ----
  function mutateConfig(patch) {
    var rev = configRevision != null ? configRevision : (AmbiSun.state.configRevision || 1);
    return AmbiSun.webos.updateConfig(patch, rev)
      .then(function(res) {
        if (res && res.returnValue) {
          configRevision = res.revision;
          AmbiSun.state.configRevision = res.revision;
          // Re-sync authoritative values quietly
          syncConfig();
          syncSolar();
          return true;
        } else if (res && res.errorCode === 'REVISION_CONFLICT') {
          syncConfig();
          if (typeof window.showToast === 'function')
            window.showToast('Конфликт — обновление...');
          return false;
        } else {
          if (typeof window.showToast === 'function')
            window.showToast('Ошибка: ' + ((res && res.errorText) || 'неизвестно'));
          return false;
        }
      })
      .catch(function(e) {
        if (typeof window.showToast === 'function') {
          var msg = (e && e.message && e.message.indexOf('TIMEOUT') >= 0)
            ? 'Таймаут соединения' : 'Ошибка соединения';
          window.showToast(msg);
        }
        return false;
      });
  }

  // ---- Screen-aware refresh ----
  var lastUpdateCheck = 0;
  var UPDATE_CHECK_TTL = 900000; // 15 minutes

  function checkForUpdate(force) {
    var now = Date.now();
    if (!force && (now - lastUpdateCheck) < UPDATE_CHECK_TTL) {
      return Promise.resolve();
    }
    lastUpdateCheck = now;

    return AmbiSun.webos.checkForUpdate()
      .then(function(res) {
        if (!res || !res.returnValue) return;

        if (res.currentVersion) {
          var verEl = document.getElementById('aboutVersionNumber');
          if (verEl) verEl.textContent = res.currentVersion;
        }

        AmbiSun.state.update = res;

        var badge = document.getElementById('aboutUpdateBadge');
        if (badge) {
          badge.classList.toggle('visible', !!res.updateAvailable);
        }

        var panel = document.getElementById('updateAvailablePanel');
        if (panel) {
          if (res.updateAvailable) {
            panel.style.display = 'block';
            var titleEl = document.getElementById('updateTitle');
            if (titleEl) {
              var availText = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('update.available', 'Доступно обновление') : 'Доступно обновление';
              titleEl.textContent = availText + ' ' + (res.latestVersion || '');
            }
            var notesEl = document.getElementById('updateNotes');
            if (notesEl) {
              var lang = (AmbiSun.i18n && AmbiSun.i18n.currentLanguage) ? AmbiSun.i18n.currentLanguage() : 'ru';
              var notesText = (res.notes && (res.notes[lang] || res.notes.en || res.notes.ru)) || '';
              notesEl.textContent = typeof notesText === 'string' ? notesText : '';
            }
          } else {
            panel.style.display = 'none';
          }
        }
      })
      .catch(function(e) {
        console.warn('[bridge] checkForUpdate error:', e && e.message);
      });
  }

  function onScreenOpen(screenId) {
    if (!isElevated) return;
    if (screenId === 'home') {
      syncSolar();
      syncSources();
    } else if (screenId === 'sources') {
      syncSources(true);
    } else if (screenId === 'settings') {
      syncConfig();
      syncSolar();
    } else if (screenId === 'about') {
      checkForUpdate();
    }
  }

  // ---- Elevation retry ----
  var elevRetries = 0;
  function startElevationRetry() {
    elevRetries = 0;
    doElevationRetry();
  }

  function doElevationRetry() {
    if (elevRetries >= 6) {
      elevRetries = 0;
      return;
    }
    elevRetries++;
    setTimeout(function() {
      checkSystemStatus().then(function() {
        if (!isElevated) doElevationRetry();
        else elevRetries = 0;
      });
    }, 1500);
  }

  // ---- Visibility change ----
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && isElevated) {
      // Sync solar on return from background — but don't re-check elevation
      syncSolar();
    }
  });

  // ---- Public API ----
  AmbiSun.bridge.checkSystemStatus = checkSystemStatus;
  AmbiSun.bridge.mutateConfig = mutateConfig;
  AmbiSun.bridge.syncConfig = syncConfig;
  AmbiSun.bridge.syncSolar = syncSolar;
  AmbiSun.bridge.syncSources = syncSources;
  AmbiSun.bridge.checkForUpdate = checkForUpdate;
  AmbiSun.bridge.onScreenOpen = onScreenOpen;
  AmbiSun.bridge.startElevationRetry = startElevationRetry;
  AmbiSun.bridge.updateHyperhdrBadge = updateHyperhdrBadge;
  AmbiSun.bridge.isElevated = function() { return isElevated; };
})();
