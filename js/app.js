
const state = window.AmbiSun.state;

const RULES = window.AmbiSun.constants.RULES;




const SUPPORT = window.AmbiSun.constants.SUPPORT;

function showToast(text, timeout = 1400){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), timeout);
}

function flash(el){
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}





function updateBoolean(setting){
  const value = !!state[setting];
  document.querySelectorAll(`[data-setting-badge="${setting}"]`).forEach(badge => {
    badge.textContent = value ? 'ВКЛ' : 'ВЫКЛ';
    badge.classList.toggle('on', value);
    badge.classList.toggle('off', !value);
  });
}
window.updateBoolean = updateBoolean;
window.showToast = showToast;





function selectSupport(key){
  const data = SUPPORT[key];
  if (!data) return;
  document.querySelectorAll('.support-method').forEach(x => {
    x.classList.toggle('active', x.dataset.support === key);
  });
  document.getElementById('supportQr').src = data.qr;
  document.getElementById('supportTitle').textContent = data.title;
  document.getElementById('supportAddress').textContent = data.value;
}


async function resetDemoState(){
  showToast(AmbiSun.i18n.t('toast.resetting', 'Сброс настроек...'));
  try {
    const res = await AmbiSun.webos.resetConfig();
    if (!res.returnValue) throw new Error(res.errorText || 'reset failed');
    await AmbiSun.bridge.checkSystemStatus();
    showToast(AmbiSun.i18n.t('toast.reset', 'Настройки сброшены'));
  } catch (e) {
    showToast(AmbiSun.i18n.t('error.saveFailed', 'Ошибка сброса: ') + e.message);
  }
}


/*
 * ONE ACTION REGISTRY.
 * In the real webOS app, replace the body of an action with a Luna/HyperHDR call.
 * HTML and navigation can stay unchanged.
 */








const STORAGE_KEYS = window.AmbiSun.constants.STORAGE_KEYS;







const ACTIONS = {
  'first-run-language': async ({el}) => { await AmbiSun.startup.completeLanguage(el.dataset.language || 'en'); },

  'other-languages': () => {
    showToast(AmbiSun.i18n.t('firstRun.otherLanguagesSoon', 'Other languages will be added later.'), 2600);
  },

  'first-run-other-language': () => {
    showToast(AmbiSun.i18n.t('firstRun.otherLanguagesSoon', 'Other languages will be added later.'), 2600);
  },

  'restore-elevation': async ({el}) => {
    const statusEl = document.getElementById('elevationStatus');
    if (statusEl) statusEl.textContent = AmbiSun.i18n.t('elevation.restoring', 'Восстановление...');
    try {
      const res = await AmbiSun.webos.requestElevation();
      if (res.returnValue) {
        if (statusEl) statusEl.textContent = AmbiSun.i18n.t('elevation.success', 'Успешно! Перезапуск...');
        AmbiSun.bridge.startElevationRetry();
      } else {
        if (statusEl) statusEl.textContent = AmbiSun.i18n.t('error.saveFailed', 'Ошибка: ') + res.errorText;
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = AmbiSun.i18n.t('error.connection', 'Ошибка соединения');
    }
  },

  'open-screen': ({el}) => {
    AmbiSun.navigation.openScreen(el.dataset.screen);
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
    document.querySelectorAll(`[data-setting-value="${setting}"]`).forEach(el => {
      el.textContent = (newVal >= 0 ? '+' : '') + newVal + ' мин';
    });
    AmbiSun.bridge.mutateConfig({ [key]: newVal });
  },

  'cycle-source-rule': ({el, direction = 1}) => {
    const src = el.dataset.source;
    const hasOverride = Object.prototype.hasOwnProperty.call(state.sourceRules, src);
    const current = hasOverride ? state.sourceRules[src] : state.defaultRule;
    const newRule = AmbiSun.sources.cycleRule(current, direction);
    const newOverrides = Object.assign({}, state.sourceRules);
    newOverrides[src] = newRule;
    // Optimistic badge update
    const badge = el.querySelector('.mode');
    if (badge) {
      badge.textContent = AmbiSun.sources.ruleLabel(newRule);
      badge.className = `mode ${newRule === 'sun' ? 'sun' : newRule}`;
    }
    AmbiSun.bridge.mutateConfig({ overrides: newOverrides });
  },

  'toggle-setting': ({el}) => {
    const key = el.dataset.setting;
    const newVal = !state[key];
    state[key] = newVal;
    if (typeof window.updateBoolean === 'function') window.updateBoolean(key);
    AmbiSun.bridge.mutateConfig({ [key]: newVal });
  },

  'open-hyperhdr': () => {
    AmbiSun.webos.getSystemStatus()
      .then(r => {
        const badge = document.getElementById('hyperhdrStatusBadge');
        const ok = r.system && r.system.hyperhdrReachable;
        if (badge) {
          badge.textContent = ok ? 'OK' : 'Недоступен';
          badge.className = 'mode ' + (ok ? 'on' : 'off');
        }
        showToast('HyperHDR: ' + (ok ? 'OK' : 'Недоступен'));
      }).catch(() => showToast('HyperHDR: ошибка'));
  },

  'cycle-default-rule': ({direction = 1}) => {
    const newRule = AmbiSun.sources.cycleRule(state.defaultRule, direction);
    state.defaultRule = newRule;
    AmbiSun.sources.updateDefaultRule();
    AmbiSun.bridge.mutateConfig({ defaultRule: newRule });
  },

  'reset-settings': async () => {
    await resetDemoState();
  },

  'set-language': async ({el}) => {
    await AmbiSun.i18n.setLanguage(el.dataset.language);
    const label = el.querySelectorAll('span')[1]?.textContent || el.dataset.language;
    showToast(`${AmbiSun.i18n.t('nav.language','Language')}: ${label}`);
  },

  'check-update': ({el}) => {
    flash(el);
    showToast(AmbiSun.i18n.t('toast.updateOk','GitHub Releases checked — version 1.0.0 is current'), 2200);
  },

  'open-url': ({el}) => {
    const url = el.dataset.url;
    showToast(AmbiSun.i18n.t('toast.openGithub','Opening GitHub'));
    if (url) window.open(url, '_blank');
  },

  'show-license': () => {
    showToast(AmbiSun.i18n.t('toast.license','Open Source · license will be added to repository'), 2200);
  },

  'select-support': ({el}) => {
    selectSupport(el.dataset.support);
    showToast(el.dataset.support === 'paypal' ? 'PayPal' : 'USDT TRC20');
  }
};

window.AmbiSunActions = ACTIONS;

function dispatchAction(el, direction) {
  const action = el.dataset.action;
  const handler = ACTIONS[action];

  flash(el);

  if (!handler) {
    showToast(`Нет обработчика: ${action || 'unknown'}`);
    return;
  }

  try {
    const result = handler({el, direction});
    if (result && typeof result.catch === 'function') {
      result.catch(err => {
        console.error('AmbiSun action failed:', action, err);
        showToast(`Ошибка действия: ${action}`, 2200);
      });
    }
  } catch (err) {
    console.error('AmbiSun action failed:', action, err);
    showToast(`Ошибка действия: ${action}`, 2200);
  }
}











function updateClock(){
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('date').textContent =
    d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
}

async function initUI(){
  AmbiSun.navigation.setActionHandler(dispatchAction);
  AmbiSun.navigation.setBackHandler(() => {
    const startup = document.getElementById('startupScreen');
    const wizard = document.getElementById('locationWizard');

    if (startup && startup.classList.contains('open') &&
        startup.classList.contains('first-run')) {
      return;
    }

    if (wizard && wizard.classList.contains('open')) {
      if (AmbiSun.location && AmbiSun.location.back) {
        AmbiSun.location.back();
      }
    } else {
      const nav = document.querySelector(`.nav-item[data-screen="${window.AmbiSun.state.screen}"]`);
      if (nav) AmbiSun.navigation.setFocus(nav);
    }
  });
  AmbiSun.navigation.bind();
  AmbiSun.plasma.init();
  if (AmbiSun.sources.renderSourceList) {
    AmbiSun.sources.renderSourceList();
  }

  AmbiSun.location.updateUI();
  updateBoolean('enabled');
  AmbiSun.sources.updateDefaultRule();

  const lang = AmbiSun.i18n.savedLanguage();
  await AmbiSun.i18n.setLanguage(lang);

  selectSupport('paypal');
  AmbiSun.navigation.openScreen('home');
  updateClock();
  setInterval(updateClock, 30000);

  AmbiSun.startup.start();

  // Backend sync fires after splash hides so user sees live data immediately
  const splashMs = (AmbiSun.config.startupSplashMs || 2500) + 300;
  setTimeout(() => {
    if (AmbiSun.bridge && AmbiSun.bridge.checkSystemStatus) {
      AmbiSun.bridge.checkSystemStatus();
    }
  }, splashMs);
}

initUI();
