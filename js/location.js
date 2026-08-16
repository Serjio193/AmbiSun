(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.location = AmbiSun.location || {};

  const CONTINENT_ORDER = [
    'Europe',
    'Asia',
    'Africa',
    'North America',
    'South America',
    'Oceania'
  ];

  const CONTINENT_I18N = {
    'Europe': 'region.europe',
    'Asia': 'region.asia',
    'Africa': 'region.africa',
    'North America': 'region.northAmerica',
    'South America': 'region.southAmerica',
    'Oceania': 'region.oceania'
  };

  const wizardState = {
    step: 'confirm-country', // 'confirm-country' | 'regions' | 'countries' | 'cities'
    region: null,
    countryCode: 'EE',
    countryName: null,
    cityOffset: 0,
    cityLimit: 60,
    cityTotal: 0,
    cities: []
  };

  let countryCatalogCache = null;
  const cityCache = {};
  const CITY_CACHE_TTL = 3600 * 1000;

  async function getCountryCatalog() {
    if (countryCatalogCache) {
      return countryCatalogCache;
    }

    try {
      const res = await AmbiSun.webos.getLocationCountries();
      if (res && res.returnValue && res.catalog) {
        countryCatalogCache = res.catalog;
        return countryCatalogCache;
      }
    } catch (e) {}

    return null;
  }

  function getCountryName(countryCode) {
    if (wizardState.countryCode === countryCode && wizardState.countryName) {
      return wizardState.countryName;
    }

    if (countryCatalogCache) {
      for (const countries of Object.values(countryCatalogCache)) {
        if (Array.isArray(countries)) {
          const found = countries.find(c => c.code === countryCode);
          if (found) {
            return found.name;
          }
        }
      }
    }

    return countryCode;
  }

  async function getRegions() {
    const catalog = await getCountryCatalog();
    if (!catalog) return null;

    const available = Object.keys(catalog).filter(r => Array.isArray(catalog[r]) && catalog[r].length > 0);
    const sorted = [];

    for (const cont of CONTINENT_ORDER) {
      if (available.includes(cont)) {
        sorted.push(cont);
      }
    }

    for (const cont of available) {
      if (!sorted.includes(cont)) {
        sorted.push(cont);
      }
    }

    return sorted;
  }

  async function getCountries(region) {
    const catalog = await getCountryCatalog();
    if (!catalog || !Array.isArray(catalog[region])) {
      return null;
    }

    return catalog[region];
  }

  async function fetchCityPage(countryCode, offset, limit) {
    offset = typeof offset === 'number' && offset >= 0 ? offset : 0;
    limit = typeof limit === 'number' && limit > 0 ? limit : 60;

    const cacheKey = countryCode + '_' + offset + '_' + limit;
    const cached = cityCache[cacheKey];
    const now = Date.now();

    if (cached && (now - cached.ts) < CITY_CACHE_TTL && Array.isArray(cached.cities)) {
      return cached;
    }

    try {
      const res = await AmbiSun.webos.searchLocations({
        countryCode: countryCode,
        offset: offset,
        limit: limit
      });

      if (res && res.returnValue && Array.isArray(res.cities)) {
        const data = {
          ts: now,
          total: typeof res.total === 'number' ? res.total : res.cities.length,
          offset: typeof res.offset === 'number' ? res.offset : offset,
          limit: typeof res.limit === 'number' ? res.limit : limit,
          cities: res.cities
        };
        cityCache[cacheKey] = data;
        return data;
      }
    } catch (e) {}

    return null;
  }

  async function detectCountry() {
    try {
      const res = await AmbiSun.webos.detectCountryByIp();

      if (res && res.returnValue && res.country && res.country.countryCode) {
        wizardState.countryCode = res.country.countryCode;
        wizardState.countryName = res.country.name || res.country.countryCode;

        return {
          country: wizardState.countryName,
          countryCode: wizardState.countryCode,
          provider: 'countries.dev'
        };
      }
    } catch (e) {}

    const fallback = window.AmbiSun.state.location || {
      country: 'Estonia',
      countryCode: 'EE'
    };

    wizardState.countryCode = fallback.countryCode || 'EE';
    wizardState.countryName = fallback.country || fallback.countryCode || 'Estonia';

    return {
      country: wizardState.countryName,
      countryCode: wizardState.countryCode,
      provider: 'fallback'
    };
  }

  // -------------------------------------------------
  // Location wizard UI
  // -------------------------------------------------

  function updateUI() {
    const state = window.AmbiSun.state;
    if (!state.location || !state.location.city) return;
    const text = state.location.city + ', ' + state.location.country;
    const fullText = '📍 ' + text;
    // Home card location display
    const display = document.getElementById('locationDisplay');
    if (display) display.textContent = fullText;
    // Settings badge
    const badge = document.getElementById('settingsLocationBadge');
    if (badge) badge.textContent = text;
    // Also update any .location .left elements
    document.querySelectorAll('.location .left').forEach(el => {
      el.textContent = fullText;
    });
  }

  function openWizard() {
    const w = document.getElementById('locationWizard');
    if (!w) return;

    wizardState.step = 'confirm-country';
    wizardState.region = null;
    wizardState.countryName = null;
    wizardState.cityOffset = 0;
    wizardState.cityTotal = 0;
    wizardState.cities = [];
    wizardState.countryCode = (window.AmbiSun.state.location && window.AmbiSun.state.location.countryCode) || 'EE';

    w.classList.add('open');
    w.setAttribute('aria-hidden', 'false');
    renderWizard();
  }

  function closeWizard() {
    const w = document.getElementById('locationWizard');
    if (!w) return;
    w.classList.remove('open');
    w.setAttribute('aria-hidden', 'true');

    const locationButton = document.querySelector('.location .pill');
    if (locationButton && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
      AmbiSun.navigation.setFocus(locationButton);
    }
  }

  function back() {
    if (wizardState.step === 'confirm-country') {
      closeWizard();
      return;
    }
    if (wizardState.step === 'regions') {
      wizardState.step = 'confirm-country';
    } else if (wizardState.step === 'countries') {
      wizardState.step = 'regions';
    } else if (wizardState.step === 'cities') {
      if (wizardState.region) {
        wizardState.step = 'countries';
      } else {
        wizardState.step = 'confirm-country';
      }
    }
    renderWizard();
  }

  function wizardChoice(label, action, attrs = '', detail = '') {
    return `
      <div class="location-choice actionable" data-action="${action}" ${attrs} role="button" tabindex="-1">
        <span>${label}${detail ? `<small>${detail}</small>` : ''}</span>
        <span>›</span>
      </div>`;
  }

  async function renderWizard() {
    const content = document.getElementById('locationWizardContent');
    const stepLabel = document.getElementById('locationStepLabel');
    if (!content || !stepLabel) return;

    let html = '';

    if (wizardState.step === 'confirm-country') {
      stepLabel.textContent = AmbiSun.i18n.t('location.stepDetected', 'Определено по IP');
      const detected = await detectCountry();

      html = `
        <div class="location-lead">
          ${AmbiSun.i18n.t('location.detectedLead', 'По IP определена страна:')}
        </div>
        <div class="location-choice-list">
          <div
            class="location-big-button actionable"
            data-action="location-country-yes"
            role="button"
            tabindex="-1">
            <span>${detected.country}</span>
            <span>✓</span>
          </div>
          <div
            class="location-big-button actionable"
            data-action="location-country-no"
            role="button"
            tabindex="-1">
            <span>${AmbiSun.i18n.t('location.chooseCountry', 'Выбрать другую страну')}</span>
            <span>›</span>
          </div>
        </div>`;

    } else if (wizardState.step === 'regions') {
      stepLabel.textContent = AmbiSun.i18n.t('location.stepRegion', 'Регион');
      const regions = await getRegions();

      if (!regions || regions.length === 0) {
        html = `
          <div class="location-lead" style="color:var(--danger)">${AmbiSun.i18n.t('location.apiError', 'Не удалось загрузить регионы. Проверьте подключение.')}</div>
          <div class="location-choice-list">
            <div class="location-big-button actionable" data-action="location-region-retry" role="button" tabindex="-1">
              <span>↻ ${AmbiSun.i18n.t('common.retry', 'Повторить')}</span>
            </div>
          </div>
          <div class="location-footer">
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back', 'Назад')}</span>
            </div>
          </div>`;
      } else {
        html = `
          <div class="location-lead">${AmbiSun.i18n.t('location.chooseRegion', 'Выберите регион')}</div>
          <div class="location-choice-list">
            ${regions.map(region =>
              wizardChoice(
                AmbiSun.i18n.t(CONTINENT_I18N[region] || region, region),
                'location-region',
                `data-region="${region}"`
              )
            ).join('')}
          </div>
          <div class="location-footer">
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back', 'Назад')}</span>
            </div>
          </div>`;
      }

    } else if (wizardState.step === 'countries') {
      stepLabel.textContent = AmbiSun.i18n.t('location.stepCountry', 'Страна');
      const countries = await getCountries(wizardState.region);

      if (!countries || countries.length === 0) {
        html = `
          <div class="location-lead" style="color:var(--danger)">${AmbiSun.i18n.t('location.apiError', 'Не удалось загрузить страны. Проверьте подключение.')}</div>
          <div class="location-choice-list">
            <div class="location-big-button actionable" data-action="location-region-retry" role="button" tabindex="-1">
              <span>↻ ${AmbiSun.i18n.t('common.retry', 'Повторить')}</span>
            </div>
          </div>
          <div class="location-footer">
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back', 'Назад')}</span>
            </div>
          </div>`;
      } else {
        html = `
          <div class="location-lead">${AmbiSun.i18n.t('location.chooseCountry', 'Выберите страну')}</div>
          <div class="location-choice-list">
            ${countries.map(country =>
              wizardChoice(
                country.name,
                'location-country',
                `data-country-code="${country.code}" data-country-name="${country.name}"`
              )
            ).join('')}
          </div>
          <div class="location-footer">
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back', 'Назад')}</span>
            </div>
          </div>`;
      }

    } else if (wizardState.step === 'cities') {
      stepLabel.textContent = AmbiSun.i18n.t('location.stepCity', 'Город');
      const pageData = await fetchCityPage(wizardState.countryCode, wizardState.cityOffset, wizardState.cityLimit);

      if (!pageData || !Array.isArray(pageData.cities) || pageData.cities.length === 0) {
        html = `
          <div class="location-lead" style="color:var(--danger)">${AmbiSun.i18n.t('location.apiError', 'Не удалось загрузить города. Проверьте подключение.')}</div>
          <div class="location-choice-list">
            <div class="location-big-button actionable" data-action="location-city-retry" role="button" tabindex="-1">
              <span>↻ ${AmbiSun.i18n.t('common.retry', 'Повторить')}</span>
            </div>
          </div>
          <div class="location-footer">
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back', 'Назад')}</span>
            </div>
          </div>`;
      } else {
        wizardState.cities = pageData.cities;
        wizardState.cityTotal = pageData.total;

        const from = wizardState.cityOffset + 1;
        const to = wizardState.cityOffset + pageData.cities.length;
        const hasPrev = wizardState.cityOffset > 0;
        const hasNext = (wizardState.cityOffset + pageData.cities.length) < pageData.total;

        const leadTitle = pageData.total > pageData.cities.length
          ? `${AmbiSun.i18n.t('location.chooseCity', 'Выберите город')} (${from}–${to} из ${pageData.total})`
          : AmbiSun.i18n.t('location.chooseCity', 'Выберите город');

        let prevBtn = '';
        if (hasPrev) {
          const prevStart = Math.max(1, wizardState.cityOffset - wizardState.cityLimit + 1);
          const prevEnd = wizardState.cityOffset;
          prevBtn = `
            <div class="location-big-button actionable" data-action="location-city-prev" role="button" tabindex="-1">
              <span>↑ Предыдущие (${prevStart}–${prevEnd})</span>
            </div>`;
        }

        let nextBtn = '';
        if (hasNext) {
          const nextStart = wizardState.cityOffset + pageData.cities.length + 1;
          const nextEnd = Math.min(wizardState.cityOffset + pageData.cities.length + wizardState.cityLimit, pageData.total);
          nextBtn = `
            <div class="location-big-button actionable" data-action="location-city-next" role="button" tabindex="-1">
              <span>↓ Следующие (${nextStart}–${nextEnd})</span>
            </div>`;
        }

        html = `
          <div class="location-lead">${leadTitle}</div>
          <div class="location-choice-list">
            ${prevBtn}
            ${pageData.cities.map(city =>
              wizardChoice(
                city.name,
                'location-city',
                `data-city="${city.name}" data-lat="${city.lat}" data-lon="${city.lon}" data-tz="${city.tz}"`,
                city.population > 0
                  ? (city.population >= 1000000
                      ? Math.round(city.population / 1000000 * 10) / 10 + 'M жит.'
                      : Math.round(city.population / 1000) + 'K жит.')
                  : ''
              )
            ).join('')}
            ${nextBtn}
          </div>
          <div class="location-footer">
            <span style="font-size:14px">Данные: GeoNames · локальная база</span>
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back', 'Назад')}</span>
            </div>
          </div>`;
      }
    }

    if (content.innerHTML !== html) {
      content.innerHTML = html;

      const first = content.querySelector('.actionable');
      if (first && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
        AmbiSun.navigation.setFocus(first);
      }
    }
  }

  async function selectCity(cityName, cityData) {
    const countryCode = wizardState.countryCode;
    const countryName = wizardState.countryName || getCountryName(countryCode);

    let lat = cityData && typeof cityData.lat === 'number' ? cityData.lat : null;
    let lon = cityData && typeof cityData.lon === 'number' ? cityData.lon : null;
    let tz = cityData && cityData.tz ? cityData.tz : null;

    if (lat === null || lon === null || !tz) {
      const found = wizardState.cities.find(c => c.name === cityName);
      if (found) {
        lat = typeof found.lat === 'number' ? found.lat : null;
        lon = typeof found.lon === 'number' ? found.lon : null;
        tz = found.tz || null;
      }
    }

    // Compatibility fallback: if coordinates or tz missing, resolve via backend
    if (lat === null || lon === null || !tz) {
      try {
        const resolved = await AmbiSun.webos.resolveLocation({
          countryCode: countryCode,
          city: cityName
        });

        if (resolved && resolved.returnValue && resolved.location) {
          lat = resolved.location.lat;
          lon = resolved.location.lon;
          tz = resolved.location.timezone;
        }
      } catch (e) {}
    }

    if (lat === null || lon === null) {
      return null;
    }

    window.AmbiSun.state.location = {
      country: countryName,
      countryCode: countryCode,
      city: cityName,
      lat: lat,
      lon: lon,
      timezone: tz || 'UTC'
    };

    await Promise.resolve(
      AmbiSun.bridge.mutateConfig({
        location: window.AmbiSun.state.location
      })
    );

    updateUI();
    closeWizard();

    return cityName + ", " + countryName;
  }

  function actionCountryYes() {
    wizardState.countryCode = wizardState.countryCode || 'EE';
    wizardState.countryName = wizardState.countryName || getCountryName(wizardState.countryCode);
    wizardState.region = null;
    wizardState.cityOffset = 0;
    wizardState.step = 'cities';
    renderWizard();
  }

  function actionCountryNo() {
    wizardState.step = 'regions';
    renderWizard();
  }

  function actionRegion(region) {
    wizardState.region = region;
    wizardState.step = 'countries';
    renderWizard();
  }

  function actionCountry(code, name) {
    wizardState.countryCode = code;
    wizardState.countryName = name || getCountryName(code);
    wizardState.cityOffset = 0;
    wizardState.step = 'cities';
    renderWizard();
  }

  async function actionCity(cityName, cityData) {
    return await selectCity(cityName, cityData);
  }

  function actionCityNext() {
    if (wizardState.cityOffset + wizardState.cityLimit < wizardState.cityTotal) {
      wizardState.cityOffset += wizardState.cityLimit;
      renderWizard();
    }
  }

  function actionCityPrev() {
    wizardState.cityOffset = Math.max(0, wizardState.cityOffset - wizardState.cityLimit);
    renderWizard();
  }

  AmbiSun.location.detectCountry = detectCountry;
  AmbiSun.location.getRegions = getRegions;
  AmbiSun.location.getCountries = getCountries;
  AmbiSun.location.getCountryCatalog = getCountryCatalog;
  AmbiSun.location.getCountryName = getCountryName;

  AmbiSun.location.openWizard = openWizard;
  AmbiSun.location.closeWizard = closeWizard;
  AmbiSun.location.back = back;
  AmbiSun.location.renderWizard = renderWizard;
  AmbiSun.location.updateUI = updateUI;
  AmbiSun.location.selectCity = selectCity;

  AmbiSun.location.wizardActionYes = actionCountryYes;
  AmbiSun.location.wizardActionNo = actionCountryNo;
  AmbiSun.location.wizardActionRegion = actionRegion;
  AmbiSun.location.wizardActionCountry = actionCountry;
  AmbiSun.location.wizardActionCity = actionCity;
  AmbiSun.location.wizardActionCityNext = actionCityNext;
  AmbiSun.location.wizardActionCityPrev = actionCityPrev;
  AmbiSun.location.wizardCountryCode = function() { return wizardState.countryCode; };
  AmbiSun.location.clearCityCache = function(code) {
    if (code) {
      for (const k of Object.keys(cityCache)) {
        if (k.startsWith(code + '_')) delete cityCache[k];
      }
    }
  };
  AmbiSun.location.clearCatalogCache = function() { countryCatalogCache = null; };
})();
