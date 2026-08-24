(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.bridge = AmbiSun.bridge || {};

  // ---- State ----
  var isElevated = false;
  var isChecking = false;
  var configRevision = null;
  var directElevationAttempted = false;
  var directElevationInProgress = false;
  var hyperhdrReachable = null;
  var sourceMonitorTimer = null;

  // ---- Time formatting ----
  function fmt(isoStr, tz) {
    if (!isoStr) return null;
    try {
      var lang = (AmbiSun.i18n && AmbiSun.i18n.currentLanguage) ? AmbiSun.i18n.currentLanguage() : 'en';
      return new Date(isoStr).toLocaleTimeString(lang, {
        hour: '2-digit', minute: '2-digit',
        timeZone: tz || 'Europe/Tallinn',
        hour12: false
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
      var lang = (AmbiSun.i18n && AmbiSun.i18n.currentLanguage) ? AmbiSun.i18n.currentLanguage() : 'en';
      var timePart = d.toLocaleTimeString(lang, { hour:'2-digit', minute:'2-digit', timeZone: tz || 'UTC', hour12: false });
      var dDay = new Date(d.toLocaleString('en-US', { timeZone: tz || 'UTC' })).toDateString();
      var nowDay = new Date(now.toLocaleString('en-US', { timeZone: tz || 'UTC' })).toDateString();
      var todayStr = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('time.today', 'Today') : 'Today';
      var tomorrowStr = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('time.tomorrow', 'Tomorrow') : 'Tomorrow';
      return (dDay === nowDay ? todayStr : tomorrowStr) + ', ' + timePart;
    } catch(e) { return null; }
  }

  function fmtOffset(n) {
    if (n == null) return '';
    return AmbiSun.sunFormat.formatOffset(n, true);
  }

  function fmtOffsetStepper(n) {
    if (n == null) n = 0;
    return AmbiSun.sunFormat.formatOffset(n, false);
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el && val != null) el.textContent = val;
  }

  // ---- System Status check (elevation gate) ----
  function checkSystemStatus() {
    if (isChecking) return Promise.resolve();
    startSourceMonitor();
    isChecking = true;
    return AmbiSun.webos.getSystemStatus()
      .then(function(res) {
        isChecking = false;
        handleSystemStatus(res.system || res);
      })
      .catch(function(e) {
        isChecking = false;
        console.warn('[bridge] getSystemStatus failed:', e && e.message);
        var unavailMsg = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.serviceUnavailable', 'Service unavailable') : 'Service unavailable';
        renderSolarUnavailable(unavailMsg);
        renderSourcesError(unavailMsg);

        // PicCap can recover even when its background service is not
        // responding yet. Do the same: call Homebrew directly so the
        // launcher and permissions are repaired before retrying Luna.
        if (!directElevationAttempted && AmbiSun.webos.requestElevationDirect) {
          directElevationAttempted = true;
          directElevationInProgress = true;
          var elevWizard = document.getElementById('elevationWizard');
          if (elevWizard) elevWizard.setAttribute('aria-hidden', 'true');
          AmbiSun.webos.requestElevationDirect()
            .then(function() {
              return AmbiSun.webos.requestService('restartAfterElevation', {}).catch(function() {});
            })
            .then(function() {
              setTimeout(function() {
                directElevationInProgress = false;
                checkSystemStatus();
              }, 1500);
            })
            .catch(function(err) {
              directElevationInProgress = false;
              console.warn('[bridge] recovery from unavailable service failed:', err && err.message);
              if (elevWizard) elevWizard.setAttribute('aria-hidden', 'false');
            });
        }
      });
  }

  function handleSystemStatus(sys) {
    var elevWizard = document.getElementById('elevationWizard');

    if (!sys || !sys.elevated) {
      isElevated = false;
      if (sys && sys.elevationPending) {
        // The service is repairing its launcher and will exit so webOS can
        // start a new elevated instance. Avoid showing a false root prompt.
        if (elevWizard) elevWizard.setAttribute('aria-hidden', 'true');
        setTimeout(function() {
          if (!document.hidden) checkSystemStatus();
        }, 1500);
        return;
      }

      if (!directElevationAttempted && AmbiSun.webos.requestElevationDirect) {
        directElevationAttempted = true;
        directElevationInProgress = true;
        if (elevWizard) elevWizard.setAttribute('aria-hidden', 'true');
        AmbiSun.webos.requestElevationDirect()
          .then(function(res) {
            if (!res || !res.returnValue) {
              throw new Error((res && (res.errorText || res.error)) || 'Direct elevation failed');
            }
            return AmbiSun.webos.requestService('restartAfterElevation', {});
          })
          .then(function() {
            setTimeout(function() {
              directElevationInProgress = false;
              checkSystemStatus();
            }, 1500);
          })
          .catch(function(err) {
            directElevationInProgress = false;
            console.warn('[bridge] direct elevation failed:', err && err.message);
            if (elevWizard) elevWizard.setAttribute('aria-hidden', 'false');
          });
        return;
      }

      if (directElevationInProgress) {
        if (elevWizard) elevWizard.setAttribute('aria-hidden', 'true');
        return;
      }
      if (elevWizard) elevWizard.setAttribute('aria-hidden', 'false');
      return;
    }

    directElevationInProgress = false;

    startSourceMonitor();

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

  // webOS can stop a dynamic service when it has no active Luna request.
  // Keep our own service warm from the app process so its foreground-source
  // polling remains available while AmbiSun is minimized behind another app.
  function pollCurrentSource() {
    if (!AmbiSun.webos || !AmbiSun.webos.getCurrentSource) return;
    AmbiSun.webos.getCurrentSource().catch(function (err) {
      console.warn('[bridge] source monitor failed:', err && err.message);
    });
  }

  function startSourceMonitor() {
    if (sourceMonitorTimer || !AmbiSun.webos || !AmbiSun.webos.getCurrentSource) return;
    pollCurrentSource();
    sourceMonitorTimer = setInterval(pollCurrentSource, 1000);
  }

  function updateHyperhdrBadge(status) {
    var badge = document.getElementById('hyperhdrStatusBadge');
    var navBadge = document.getElementById('hyperhdrNavStatusBadge');
    if (!badge && !navBadge) return;
    if (status !== undefined) {
      hyperhdrReachable = status === true || status === 'ok' ? true :
        (status === false || status === 'error' ? false : null);
    }
    var hdr = AmbiSun.state.hyperhdr || { host: '127.0.0.1', port: 8090 };
    var ep = hdr.host + ':' + hdr.port;
    var stateClass = hyperhdrReachable === true ? 'on' : (hyperhdrReachable === false ? 'off' : 'unknown');
    if (badge) {
      if (hyperhdrReachable === true) {
        badge.textContent = ep + ' OK ›';
      } else if (hyperhdrReachable === false) {
        var unavail = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('hyperhdr.unavailable', 'Unavailable') : 'Unavailable';
        badge.textContent = ep + ' ' + unavail + ' ›';
      } else {
        badge.textContent = ep + ' ›';
      }
      badge.className = 'mode hyperhdr-status-badge ' + stateClass;
    }
    if (navBadge) {
      navBadge.className = 'hyperhdr-status-indicator ' + stateClass;
      navBadge.setAttribute('title', hyperhdrReachable === false ? 'HyperHDR unavailable' :
        (hyperhdrReachable === true ? 'HyperHDR available' : 'HyperHDR status unknown'));
    }
  }

  function checkHyperhdrReachability(endpoint) {
    var target = endpoint || AmbiSun.state.hyperhdr || { host: '127.0.0.1', port: 8090 };
    return AmbiSun.webos.getHyperhdrStatus(target)
      .then(function(res) {
        var reachable = !!(res && res.returnValue && res.hyperhdr && res.hyperhdr.reachable);
        updateHyperhdrBadge(reachable);
        return reachable;
      })
      .catch(function() {
        updateHyperhdrBadge(false);
        return false;
      });
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
        AmbiSun.state.defaultEffect = cfg.defaultEffect || null;
        AmbiSun.state.sunsetOffset = typeof cfg.sunsetOffset === 'number' ? cfg.sunsetOffset : 0;
        AmbiSun.state.sunriseOffset = typeof cfg.sunriseOffset === 'number' ? cfg.sunriseOffset : 0;
        AmbiSun.state.brightness = typeof cfg.brightness === 'number' ? cfg.brightness : 50;
        if (Object.prototype.hasOwnProperty.call(cfg, 'location')) AmbiSun.state.location = cfg.location;
        if (cfg.overrides) AmbiSun.state.sourceRules = cfg.overrides;
        AmbiSun.state.effectOverrides = cfg.effectOverrides || {};
        AmbiSun.state.sourceBrightness = cfg.sourceBrightness || {};
        AmbiSun.state.hiddenSources = cfg.hiddenSources || {};
        if (typeof window.updateBrightnessUi === 'function') window.updateBrightnessUi();
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
        if (AmbiSun.sources && AmbiSun.sources.updateDefaultEffect) AmbiSun.sources.updateDefaultEffect();
        if (AmbiSun.sources && AmbiSun.sources.renderSourceList) AmbiSun.sources.renderSourceList();
      })
      .catch(function(e) {
        console.warn('[bridge] syncConfig failed:', e && e.message);
      });
  }

  // ---- Solar sync ----
  var lastSolarData = null;
  var lastSolarTz = null;

  function renderSolarData(s, tz) {
    if (!s) return;
    tz = tz || s.timezone || 'Europe/Tallinn';
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
  }

  function reRenderSolar() {
    if (lastSolarData) {
      renderSolarData(lastSolarData, lastSolarTz);
    }
  }

  function syncSolar() {
    // Show loading state first
    renderSolarLoading();
    return AmbiSun.webos.getSolarStatus()
      .then(function(res) {
        if (!res || !res.returnValue || !res.solar) {
          var noDataMsg = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.noData', 'No data') : 'No data';
          renderSolarUnavailable(noDataMsg);
          return;
        }
        lastSolarData = res.solar;
        lastSolarTz = res.solar.timezone || 'Europe/Tallinn';
        renderSolarData(lastSolarData, lastSolarTz);
      })
      .catch(function(e) {
        var timeoutMsg = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.timeout', 'Timeout') : 'Timeout';
        var errorMsg = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.error', 'Error') : 'Error';
        var msg = (e && e.message && e.message.indexOf('TIMEOUT') >= 0) ? timeoutMsg : errorMsg;
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
          var noRespMsg = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.noResponse', 'No response from service') : 'No response from service';
          renderSourcesError(noRespMsg);
          return;
        }
        if (res.currentSource) {
          // Strip raw field — only keep type/id/name
          var cs = res.currentSource;
          AmbiSun.state.currentSource = { type: cs.type, id: cs.id, name: cs.name };
        }
        if (res.sources && res.sources.length > 0) {
          AmbiSun.state.sourceCatalog = res.sources;
          res.sources.forEach(function(source) {
            if (AmbiSun.sources && AmbiSun.sources.addObservedSource) AmbiSun.sources.addObservedSource(source);
          });
        }

        if (AmbiSun.sources && AmbiSun.sources.renderSourceList) {
          AmbiSun.sources.renderSourceList();
        }
        if (AmbiSun.sources && AmbiSun.sources.refreshEffects) AmbiSun.sources.refreshEffects(false);
      })
      .catch(function(e) {
        var timeoutMsg = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.timeout', 'Timeout') : 'Timeout';
        var errorMsg = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.error', 'Error') : 'Error';
        var msg = (e && e.message && e.message.indexOf('TIMEOUT') >= 0)
          ? timeoutMsg : ((e && e.message) || errorMsg);
        renderSourcesError(msg);
      });
  }

  function renderSourcesLoading() {
    var lists = Array.prototype.slice.call(document.querySelectorAll('.source-list'));
    if (!lists.length) return;
    lists.forEach(function(list) {
      // Only show spinner if the page list is currently empty
      if (list.children.length === 0) {
      var loadingText = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.loading', 'Loading...') : 'Loading...';
        list.innerHTML = '<div style="padding:32px;color:var(--muted);font-size:18px;text-align:center">⏳ ' + loadingText + '</div>';
      }
    });
  }

  function renderSourcesError(msg) {
    // If we already have catalog data — don't overwrite with error
    if (AmbiSun.state.sourceCatalog && AmbiSun.state.sourceCatalog.length > 0) {
      if (AmbiSun.sources && AmbiSun.sources.renderSourceList) {
        AmbiSun.sources.renderSourceList();
      }
      return;
    }
    var lists = Array.prototype.slice.call(document.querySelectorAll('.source-list'));
    if (!lists.length) return;
    var errorText = msg || ((AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.error', 'Error') : 'Error');
    var retryText = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('sources.pressOkToRetry', 'Press OK to retry') : 'Press OK to retry';
    lists.forEach(function(list) {
      list.innerHTML =
        '<div style="padding:32px;color:var(--danger);font-size:18px;text-align:center">' +
        '⚠ ' + errorText + '</div>' +
        '<div style="padding:8px 32px;color:var(--muted);font-size:15px;text-align:center">' +
        retryText + '</div>';
      // Allow retry via OK on this element
      var retryEl = list.firstChild;
      if (retryEl) {
        retryEl.className = 'actionable';
        retryEl.dataset.action = 'sources-retry';
        retryEl.setAttribute('tabindex', '-1');
        retryEl.setAttribute('role', 'button');
      }
    });
  }

  // ---- Config mutation ----
  function mutateConfig(patch, options) {
    options = options || {};
    var rev = configRevision != null ? configRevision : (AmbiSun.state.configRevision || 1);
    return AmbiSun.webos.updateConfig(patch, rev)
      .then(function(res) {
        if (res && res.returnValue) {
          configRevision = res.revision;
          AmbiSun.state.configRevision = res.revision;
          // Re-sync authoritative values quietly
          if (!options.skipSync) syncConfig();
          if (!options.skipSolarSync) syncSolar();
          return true;
        } else if (res && res.errorCode === 'REVISION_CONFLICT') {
          syncConfig();
          if (typeof window.showToast === 'function') {
            var conflictText = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('status.conflict', 'Conflict — updating...') : 'Conflict — updating...';
            window.showToast(conflictText);
          }
          return false;
        } else {
          if (typeof window.showToast === 'function') {
            var saveFailedText = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('error.saveFailed', 'Save failed: ') : 'Save failed: ';
            window.showToast(saveFailedText + ((res && res.errorText) || ''));
          }
          return false;
        }
      })
      .catch(function(e) {
        if (typeof window.showToast === 'function') {
          var connErr = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('error.connection', 'Connection error') : 'Connection error';
          window.showToast(connErr);
        }
        return false;
      });
  }

  // ---- Public API ----
  AmbiSun.bridge.checkSystemStatus = checkSystemStatus;
  AmbiSun.bridge.mutateConfig = mutateConfig;
  AmbiSun.bridge.syncConfig = syncConfig;
  AmbiSun.bridge.syncSolar = syncSolar;
  AmbiSun.bridge.reRenderSolar = reRenderSolar;
  AmbiSun.bridge.syncSources = syncSources;
  AmbiSun.bridge.updateHyperhdrBadge = updateHyperhdrBadge;
  AmbiSun.bridge.checkHyperhdrReachability = checkHyperhdrReachability;
  AmbiSun.bridge.pollCurrentSource = pollCurrentSource;
  AmbiSun.bridge.isElevated = function() { return isElevated; };
})();
