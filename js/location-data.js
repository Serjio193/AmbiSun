(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  const locationData = window.AmbiSun.locationData = window.AmbiSun.locationData || {};
  const CONTINENT_ORDER = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];
  let countryCatalogCache = null;
  const cityCache = {};
  const CITY_CACHE_TTL = 3600 * 1000;

  async function getCountryCatalog() {
    if (countryCatalogCache) return countryCatalogCache;
    try {
      const res = await AmbiSun.webos.getLocationCountries();
      if (res && res.returnValue && res.catalog) {
        countryCatalogCache = res.catalog;
        return countryCatalogCache;
      }
    } catch (_) {}
    return null;
  }

  function getCountryName(countryCode, wizardState) {
    if (wizardState && wizardState.countryCode === countryCode && wizardState.countryName) {
      return wizardState.countryName;
    }
    if (countryCatalogCache) {
      for (const countries of Object.values(countryCatalogCache)) {
        if (!Array.isArray(countries)) continue;
        const found = countries.find(country => country.code === countryCode);
        if (found) return found.name;
      }
    }
    return countryCode;
  }

  async function getRegions() {
    const catalog = await getCountryCatalog();
    if (!catalog) return null;
    const available = Object.keys(catalog).filter(region => Array.isArray(catalog[region]) && catalog[region].length > 0);
    const sorted = CONTINENT_ORDER.filter(continent => available.includes(continent));
    available.forEach(continent => {
      if (!sorted.includes(continent)) sorted.push(continent);
    });
    return sorted;
  }

  async function getCountries(region) {
    const catalog = await getCountryCatalog();
    return catalog && Array.isArray(catalog[region]) ? catalog[region] : null;
  }

  async function fetchCityPage(countryCode, offset, limit) {
    offset = typeof offset === 'number' && offset >= 0 ? offset : 0;
    limit = typeof limit === 'number' && limit > 0 ? limit : 60;
    const cacheKey = countryCode + '_' + offset + '_' + limit;
    const cached = cityCache[cacheKey];
    const now = Date.now();
    if (cached && (now - cached.ts) < CITY_CACHE_TTL && Array.isArray(cached.cities)) return cached;
    try {
      const res = await AmbiSun.webos.searchLocations({ countryCode: countryCode, offset: offset, limit: limit });
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
    } catch (_) {}
    return null;
  }

  async function detectCountry() {
    try {
      const res = await AmbiSun.webos.detectCountryByIp();
      if (res && res.returnValue && res.country && res.country.countryCode) {
        return {
          country: res.country.name || res.country.countryCode,
          countryCode: res.country.countryCode,
          provider: 'countries.dev'
        };
      }
    } catch (_) {}
    const fallback = window.AmbiSun.state.location || { country: 'Estonia', countryCode: 'EE' };
    return {
      country: fallback.country || fallback.countryCode || 'Estonia',
      countryCode: fallback.countryCode || 'EE',
      provider: 'fallback'
    };
  }

  locationData.getCountryCatalog = getCountryCatalog;
  locationData.getCountryName = getCountryName;
  locationData.getRegions = getRegions;
  locationData.getCountries = getCountries;
  locationData.fetchCityPage = fetchCityPage;
  locationData.detectCountry = detectCountry;
  locationData.clearCityCache = function (code) {
    if (!code) return;
    Object.keys(cityCache).forEach(function (key) {
      if (key.startsWith(code + '_')) delete cityCache[key];
    });
  };
  locationData.clearCatalogCache = function () {
    countryCatalogCache = null;
  };
}());
