
const state = window.AmbiSun.state;

const showToast = window.showToast;
const updateBoolean = window.updateBoolean;




/* Shared UI helpers live in app-ui.js. */

// Shared button feedback is handled by buttons.js.



// Support selector lives in app-ui.js.


// Reset behavior lives in app-ui.js.


/*
 * ONE ACTION REGISTRY.
 * In the real webOS app, replace the body of an action with a Luna/HyperHDR call.
 * HTML and navigation can stay unchanged.
 */








// Persistent storage keys are owned by app-ui.js.







const ACTIONS = {
  'first-run-language': async ({el}) => { await AmbiSun.startup.completeLanguage(el.dataset.language || 'en'); },

  'onboarding-hyperhdr-test': async () => {
    const endpoint = AmbiSun.hyperhdrSettings.endpointFromInputs('onboardingHyperhdrHost', 'onboardingHyperhdrPort');
    if (!endpoint) {
      AmbiSun.hyperhdrSettings.showInvalid('onboardingHyperhdrResult');
      return;
    }
    await AmbiSun.hyperhdrSettings.testEndpoint(endpoint, 'onboardingHyperhdrResult');
  },

  'onboarding-hyperhdr-save': async () => {
    const endpoint = AmbiSun.hyperhdrSettings.endpointFromInputs('onboardingHyperhdrHost', 'onboardingHyperhdrPort');
    if (!endpoint) {
      AmbiSun.hyperhdrSettings.showInvalid('onboardingHyperhdrResult');
      return;
    }
    const success = await AmbiSun.bridge.mutateConfig({ hyperhdr: endpoint });
    if (!success) {
      AmbiSun.hyperhdrSettings.showResult?.('onboardingHyperhdrResult', '✖', 'error.saveFailed', 'Save failed', 'var(--danger)');
      return;
    }
    state.hyperhdr = endpoint;
    if (AmbiSun.bridge.updateHyperhdrBadge) AmbiSun.bridge.updateHyperhdrBadge(null);
    if (AmbiSun.bridge.checkHyperhdrReachability) {
      AmbiSun.bridge.checkHyperhdrReachability(endpoint);
    }
    if (AmbiSun.startup && AmbiSun.startup.finishFirstRun) {
      AmbiSun.startup.finishFirstRun();
    }
  },

  'onboarding-hyperhdr-skip': () => {
    if (AmbiSun.startup && AmbiSun.startup.finishFirstRun) {
      AmbiSun.startup.finishFirstRun();
    }
  },

  'restore-elevation': async ({el}) => {
    const statusEl = document.getElementById('elevationStatus');
    if (statusEl) statusEl.textContent = AmbiSun.i18n.t('elevation.restoring', 'Restoring...');
    try {
      let res = null;
      if (AmbiSun.webos.requestElevationDirect) {
        res = await AmbiSun.webos.requestElevationDirect();
        if (res && res.returnValue) {
          try {
            await AmbiSun.webos.requestService('restartAfterElevation', {});
          } catch (_) {
            // The service may exit immediately after the direct elevation.
          }
        }
      }
      if (!res || !res.returnValue) {
        res = await AmbiSun.webos.requestElevation();
      }
      if (res && res.returnValue) {
        AmbiSun.bridge.startElevationRetry(function(confirmed) {
          if (confirmed) {
            if (statusEl) statusEl.textContent = AmbiSun.i18n.t('elevation.success', 'Access restored');
          } else {
            if (statusEl) statusEl.textContent = AmbiSun.i18n.t('error.connection', 'Connection error');
          }
        });
      } else {
        if (statusEl) statusEl.textContent = AmbiSun.i18n.t('error.saveFailed', 'Save failed: ') + ((res && res.errorText) || '');
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = AmbiSun.i18n.t('error.connection', 'Connection error');
    }
  },

  'open-screen': ({el}) => {
    AmbiSun.navigation.openScreen(el.dataset.screen);
  },

  'open-source-page': ({el}) => {
    const screenId = el.dataset.screen;
    AmbiSun.navigation.openScreen(screenId);
    if (AmbiSun.sources && AmbiSun.sources.renderSourceList) {
      requestAnimationFrame(() => AmbiSun.sources.renderSourceList());
    }
    const back = document.querySelector('#' + screenId + ' .source-page-backbar .actionable');
    if (back && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(back);
  },

  'source-page-next': () => {
    if (AmbiSun.sources && AmbiSun.sources.changeApplicationPage) AmbiSun.sources.changeApplicationPage(1);
  },

  'source-page-prev': () => {
    if (AmbiSun.sources && AmbiSun.sources.changeApplicationPage) AmbiSun.sources.changeApplicationPage(-1);
  },

  'edit-location': () => {
    AmbiSun.location.openWizard();
  },

  'location-country-yes': () => {
    AmbiSun.location.wizardActionYes();
  },

  'location-country-no': () => {
    AmbiSun.location.wizardActionNo();
  },

  'location-region': ({el}) => {
    AmbiSun.location.wizardActionRegion(el.dataset.region);
  },

  'location-country': ({el}) => {
    AmbiSun.location.wizardActionCountry(el.dataset.countryCode);
  },

  'location-city': async ({el}) => {
    const res = await AmbiSun.location.wizardActionCity(el.dataset.city, {
      lat: el.dataset.lat ? Number(el.dataset.lat) : undefined,
      lon: el.dataset.lon ? Number(el.dataset.lon) : undefined,
      tz: el.dataset.tz || undefined
    });
    if (res) showToast(res);
  },

  'location-city-next': () => {
    AmbiSun.location.wizardActionCityNext && AmbiSun.location.wizardActionCityNext();
  },

  'location-city-prev': () => {
    AmbiSun.location.wizardActionCityPrev && AmbiSun.location.wizardActionCityPrev();
  },

  'location-city-retry': () => {
    AmbiSun.location.clearCityCache && AmbiSun.location.clearCityCache(AmbiSun.location.wizardCountryCode());
    AmbiSun.location.renderWizard();
  },

  'location-region-retry': () => {
    AmbiSun.location.clearCatalogCache && AmbiSun.location.clearCatalogCache();
    AmbiSun.location.renderWizard();
  },

  'sources-retry': () => {
    AmbiSun.bridge.syncSources(true);
  },

  'location-back': () => {
    AmbiSun.location.back();
  },

  'location-close': () => {
    AmbiSun.location.closeWizard();
  },

  'adjust-offset': ({el}) => {
    const setting = el.dataset.setting;
    const delta = Number(el.dataset.delta || 0);
    const key = setting === 'sunrise' ? 'sunriseOffset' : 'sunsetOffset';
    const newVal = Math.max(-360, Math.min(360, (state[key] || 0) + delta));
    // Optimistic local update so stepper feels responsive
    state[key] = newVal;
    const formatted = AmbiSun.sunFormat.formatOffset(newVal);
    document.querySelectorAll(`[data-setting-value="${setting}"]`).forEach(el => {
      el.textContent = formatted;
    });
    if (AmbiSun.sun && AmbiSun.sun.updateUI) AmbiSun.sun.updateUI();
    AmbiSun.bridge.mutateConfig({ [key]: newVal });
  },

  'cycle-source-rule': ({el, direction = 1}) => {
    // The source row is focusable for remote navigation and brightness control,
    // but only its dedicated rule control may change the lighting mode.
    if (el && el.classList && el.classList.contains('source-row')) return;
    const src = el.dataset.source;
    const current = Object.prototype.hasOwnProperty.call(state.sourceRules, src) ? state.sourceRules[src] : state.defaultRule;
    setSourceRule(src, AmbiSun.sources.cycleRule(current, direction));
  },

  'open-source-effect': ({el}) => {
    if (AmbiSun.effectPicker) {
      const ownerScreen = el.closest && el.closest('.screen');
      AmbiSun.effectPicker.open(el.dataset.source, ownerScreen ? ownerScreen.id : 'sources');
    }
  },

  'open-default-effect': () => {
    if (AmbiSun.effectPicker) AmbiSun.effectPicker.openDefault();
  },

  'select-source-effect': ({el}) => {
    if (AmbiSun.effectPicker) AmbiSun.effectPicker.select(el.dataset.effect);
  },

  'close-effect-picker': () => {
    if (AmbiSun.effectPicker) AmbiSun.effectPicker.close();
  },

  'toggle-hidden-sources': () => {
    state.showHiddenSources = !state.showHiddenSources;
    AmbiSun.sources.renderSourceList();
  },

  'toggle-source-hidden': ({el}) => {
    const src = el.dataset.source;
    const hidden = el.dataset.hidden !== 'true';
    const hiddenSources = Object.assign({}, state.hiddenSources || {});
    if (hidden) hiddenSources[src] = true;
    else delete hiddenSources[src];
    state.hiddenSources = hiddenSources;
    AmbiSun.sources.renderSourceList();
    AmbiSun.bridge.mutateConfig({ hiddenSources });
  },

  'toggle-setting': ({el}) => {
    const key = el.dataset.setting;
    const newVal = !state[key];
    state[key] = newVal;
    if (typeof window.updateBoolean === 'function') window.updateBoolean(key);
    AmbiSun.bridge.mutateConfig({ [key]: newVal });
  },

  'open-hyperhdr': () => {
    const hostInput = document.getElementById('hyperhdrHostInput');
    const portInput = document.getElementById('hyperhdrPortInput');
    const resEl = document.getElementById('hyperhdrTestResult');
    if (resEl) resEl.textContent = '';
    const cur = state.hyperhdr || { host: '127.0.0.1', port: 8090 };
    if (hostInput) hostInput.value = cur.host || '127.0.0.1';
    if (portInput) portInput.value = cur.port || 8090;
    const modal = document.getElementById('hyperhdrModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      if (hostInput && AmbiSun.navigation.setFocus) {
        AmbiSun.navigation.setFocus(hostInput);
      }
      AmbiSun.hyperhdrSettings.testEndpoint(cur, 'hyperhdrTestResult');
    }
  },

  'hyperhdr-test': async () => {
    const endpoint = AmbiSun.hyperhdrSettings.endpointFromInputs('hyperhdrHostInput', 'hyperhdrPortInput');
    if (!endpoint) {
      AmbiSun.hyperhdrSettings.showInvalid('hyperhdrTestResult');
      return;
    }
    await AmbiSun.hyperhdrSettings.testEndpoint(endpoint, 'hyperhdrTestResult');
  },

  'hyperhdr-save': async () => {
    const endpoint = AmbiSun.hyperhdrSettings.endpointFromInputs('hyperhdrHostInput', 'hyperhdrPortInput');
    if (!endpoint) {
      AmbiSun.hyperhdrSettings.showInvalid('hyperhdrTestResult');
      return;
    }
    AmbiSun.hyperhdrSettings.showPending('hyperhdrTestResult', 'toast.saving', 'Saving…');
    const success = await AmbiSun.bridge.mutateConfig({ hyperhdr: endpoint });
    if (success) {
      state.hyperhdr = endpoint;
      const modal = document.getElementById('hyperhdrModal');
      if (modal) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
      }
      if (AmbiSun.bridge.updateHyperhdrBadge) AmbiSun.bridge.updateHyperhdrBadge(null);
      if (AmbiSun.bridge.checkHyperhdrReachability) {
        AmbiSun.bridge.checkHyperhdrReachability(endpoint);
      }
      showToast(AmbiSun.i18n.t('settings.saved', 'Settings saved'));
      const openRow = document.querySelector('.list-item[data-action="open-hyperhdr"]');
      if (openRow && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(openRow);
    } else {
      AmbiSun.hyperhdrSettings.showResult?.('hyperhdrTestResult', '✖', 'error.saveFailed', 'Save failed', 'var(--danger)');
    }
  },

  'hyperhdr-cancel': () => {
    const modal = document.getElementById('hyperhdrModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
    const openRow = document.querySelector('.list-item[data-action="open-hyperhdr"]');
    if (openRow && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(openRow);
  },

  'open-language': () => {
    AmbiSun.navigation.openScreen('language');
    const currentLang = (AmbiSun.i18n && AmbiSun.i18n.currentLanguage) ? AmbiSun.i18n.currentLanguage() : 'en';
    const targetItem = document.querySelector(`#language [data-language="${currentLang}"]`) || document.querySelector('#language .list-item.actionable');
    if (targetItem && AmbiSun.navigation.setFocus) {
      AmbiSun.navigation.setFocus(targetItem);
    }
  },

  'reset-settings': async () => {
    await AmbiSunUi.resetDemoState();
  },

  'set-language': async ({el}) => {
    const lang = el.dataset.language;
    if (!lang) return;
    await AmbiSun.i18n.setLanguage(lang);
    AmbiSun.app.updateSettingsLanguageBadge();
    AmbiSun.app.updateClock();
    AmbiSun.navigation.openScreen('settings');
    const langRow = document.querySelector('.list-item[data-action="open-language"]');
    if (langRow && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(langRow);
  },

  'install-update': async ({el}) => {
    const updateInfo = AmbiSun.state.update;
    if (!updateInfo || !updateInfo.latestVersion) {
      return;
    }

    const progressModal = document.getElementById('updateProgressModal');
    const statusEl = document.getElementById('updateProgressStatus');
    const subtextEl = document.getElementById('updateProgressSubtext');

    if (progressModal) {
      progressModal.classList.add('open');
      progressModal.setAttribute('aria-hidden', 'false');
    }
    if (statusEl) {
      statusEl.textContent = AmbiSun.i18n.t('update.preparing', 'Preparing update…');
    }
    if (subtextEl) {
      subtextEl.textContent = AmbiSun.i18n.t('update.restart', 'AmbiSun may close during the update. It will try to reopen automatically. If it does not reopen, start AmbiSun again.');
    }

    try {
      const res = await AmbiSun.webos.installUpdate(updateInfo.latestVersion);
      if (res && res.returnValue) {
        if (statusEl) {
          statusEl.textContent = AmbiSun.i18n.t('update.installing', 'Installing update…');
        }
      } else {
        if (progressModal) {
          progressModal.classList.remove('open');
          progressModal.setAttribute('aria-hidden', 'true');
        }
        showToast(AmbiSun.i18n.t('update.failed', 'Update failed: ') + ((res && res.errorText) || ''));
      }
    } catch (e) {
      if (progressModal) {
        progressModal.classList.remove('open');
        progressModal.setAttribute('aria-hidden', 'true');
      }
      showToast(AmbiSun.i18n.t('update.failed', 'Update failed: ') + (e && e.message));
    }
  },

  'open-url': ({el}) => {
    const url = el.dataset.url;
    showToast(AmbiSun.i18n.t('toast.openGithub','Opening GitHub'));
    if (url) window.open(url, '_blank');
  },

  'open-license': () => {
    if (AmbiSun.license) AmbiSun.license.open();
  },

  'select-support': ({el}) => {
    AmbiSunUi.selectSupport(el.dataset.support);
    showToast(el.dataset.support === 'paypal' ? 'PayPal' : 'USDT TRC20');
  },

  'minimize-app': async ({el}) => {
    try {
      const res = await AmbiSun.webos.minimizeApp();
      if (!res || !res.returnValue) {
        showToast(AmbiSun.i18n.t('error.minimizeFailed', 'Failed to minimize application'));
      }
    } catch (e) {
      showToast(AmbiSun.i18n.t('error.minimizeFailed', 'Failed to minimize application'));
    }
  }
};

window.AmbiSunActions = ACTIONS;

function setSourceRule(sourceId, newRule) {
  if (!sourceId || (newRule !== 'default' && !window.AmbiSun.constants.RULES.includes(newRule))) return;
  const overrides = Object.assign({}, state.sourceRules || {});
  if (newRule === 'default') delete overrides[sourceId];
  else overrides[sourceId] = newRule;
  state.sourceRules = overrides;
  AmbiSun.sources.renderSourceList();
  AmbiSun.bridge.mutateConfig({ overrides });
}

function setSourceEffect(sourceId, value) {
  if (!sourceId) return;
  const effectOverrides = Object.assign({}, state.effectOverrides || {});
  effectOverrides[sourceId] = value === 'capture' ? { mode: 'capture' } : { mode: 'effect', name: value };
  state.effectOverrides = effectOverrides;
  if (AmbiSun.sources && AmbiSun.sources.renderSourceList) AmbiSun.sources.renderSourceList();
  AmbiSun.bridge.mutateConfig({ effectOverrides });
}

function setDefaultEffect(value) {
  if (!value) return;
  const previous = state.defaultEffect || null;
  const next = value === 'capture' ? null : value;
  state.defaultEffect = next;
  if (AmbiSun.sources && AmbiSun.sources.updateDefaultEffect) AmbiSun.sources.updateDefaultEffect();
  AmbiSun.bridge.mutateConfig({ defaultEffect: next }).then(function (success) {
    if (!success) {
      state.defaultEffect = previous;
      if (AmbiSun.sources && AmbiSun.sources.updateDefaultEffect) AmbiSun.sources.updateDefaultEffect();
    }
  });
}

function dispatchAction(el, direction) {
  const action = el.dataset.action;
  if (!action) return;
  const handler = ACTIONS[action];

  if (!handler) {
    showToast(`No handler: ${action || 'unknown'}`);
    return;
  }

  try {
    const result = handler({el, direction});
    if (result && typeof result.catch === 'function') {
      result.catch(err => {
        console.error('AmbiSun action failed:', action, err);
        showToast(`Action failed: ${action}`, 2200);
      });
    }
  } catch (err) {
    console.error('AmbiSun action failed:', action, err);
    showToast(`Action failed: ${action}`, 2200);
  }
}











window.setSourceRule = setSourceRule;
window.setSourceEffect = setSourceEffect;
window.setDefaultEffect = setDefaultEffect;
window.dispatchAmbiSunAction = dispatchAction;
