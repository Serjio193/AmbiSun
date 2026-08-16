(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.location = AmbiSun.location || {};

  // Expanded offline location database
  const DEMO_LOCATION_DATA = {
    'Europe': {
      labelKey: 'region.europe',
      countries: {
        'EE': { name: 'Estonia', cities: [
          {name:'Tallinn', lat:59.4370, lon:24.7536, tz:'Europe/Tallinn'},
          {name:'Tartu', lat:58.3776, lon:26.7290, tz:'Europe/Tallinn'},
          {name:'Narva', lat:59.3797, lon:28.1791, tz:'Europe/Tallinn'},
          {name:'Pärnu', lat:58.3859, lon:24.4971, tz:'Europe/Tallinn'},
          {name:'Kohtla-Järve', lat:59.3986, lon:27.2731, tz:'Europe/Tallinn'}
        ]},
        'UA': { name: 'Ukraine', cities: [
          {name:'Kyiv', lat:50.4501, lon:30.5234, tz:'Europe/Kyiv'},
          {name:'Kharkiv', lat:49.9935, lon:36.2304, tz:'Europe/Kyiv'},
          {name:'Odesa', lat:46.4825, lon:30.7233, tz:'Europe/Kyiv'},
          {name:'Dnipro', lat:48.4647, lon:35.0462, tz:'Europe/Kyiv'},
          {name:'Lviv', lat:49.8397, lon:24.0297, tz:'Europe/Kyiv'},
          {name:'Zaporizhzhia', lat:47.8388, lon:35.1396, tz:'Europe/Kyiv'},
          {name:'Kryvyi Rih', lat:47.9102, lon:33.3918, tz:'Europe/Kyiv'},
          {name:'Mykolaiv', lat:46.9750, lon:31.9946, tz:'Europe/Kyiv'},
          {name:'Vinnytsia', lat:49.2331, lon:28.4682, tz:'Europe/Kyiv'},
          {name:'Poltava', lat:49.5883, lon:34.5514, tz:'Europe/Kyiv'},
          {name:'Chernihiv', lat:51.4982, lon:31.2893, tz:'Europe/Kyiv'},
          {name:'Cherkasy', lat:49.4444, lon:32.0598, tz:'Europe/Kyiv'},
          {name:'Sumy', lat:50.9077, lon:34.7981, tz:'Europe/Kyiv'},
          {name:'Zhytomyr', lat:50.2547, lon:28.6587, tz:'Europe/Kyiv'},
          {name:'Ivano-Frankivsk', lat:48.9226, lon:24.7111, tz:'Europe/Kyiv'},
          {name:'Ternopil', lat:49.5535, lon:25.5948, tz:'Europe/Kyiv'},
          {name:'Lutsk', lat:50.7472, lon:25.3254, tz:'Europe/Kyiv'},
          {name:'Rivne', lat:50.6199, lon:26.2516, tz:'Europe/Kyiv'},
          {name:'Uzhhorod', lat:48.6239, lon:22.2950, tz:'Europe/Kyiv'},
          {name:'Chernivtsi', lat:48.2921, lon:25.9358, tz:'Europe/Kyiv'},
          {name:'Kherson', lat:46.6354, lon:32.6169, tz:'Europe/Kyiv'}
        ]},
        'RU': { name: 'Russia', cities: [
          {name:'Moscow', lat:55.7558, lon:37.6176, tz:'Europe/Moscow'},
          {name:'Saint Petersburg', lat:59.9343, lon:30.3351, tz:'Europe/Moscow'},
          {name:'Novosibirsk', lat:54.9833, lon:82.8964, tz:'Asia/Novosibirsk'},
          {name:'Yekaterinburg', lat:56.8356, lon:60.6122, tz:'Asia/Yekaterinburg'},
          {name:'Kazan', lat:55.8304, lon:49.0661, tz:'Europe/Moscow'}
        ]},
        'DE': { name: 'Germany', cities: [
          {name:'Berlin', lat:52.5200, lon:13.4050, tz:'Europe/Berlin'},
          {name:'Hamburg', lat:53.5511, lon:9.9937, tz:'Europe/Berlin'},
          {name:'Munich', lat:48.1351, lon:11.5820, tz:'Europe/Berlin'},
          {name:'Cologne', lat:50.9333, lon:6.9500, tz:'Europe/Berlin'},
          {name:'Frankfurt', lat:50.1109, lon:8.6821, tz:'Europe/Berlin'},
          {name:'Stuttgart', lat:48.7758, lon:9.1829, tz:'Europe/Berlin'},
          {name:'Düsseldorf', lat:51.2217, lon:6.7762, tz:'Europe/Berlin'}
        ]},
        'FR': { name: 'France', cities: [
          {name:'Paris', lat:48.8566, lon:2.3522, tz:'Europe/Paris'},
          {name:'Lyon', lat:45.7640, lon:4.8357, tz:'Europe/Paris'},
          {name:'Marseille', lat:43.2965, lon:5.3698, tz:'Europe/Paris'},
          {name:'Nice', lat:43.7102, lon:7.2620, tz:'Europe/Paris'},
          {name:'Bordeaux', lat:44.8378, lon:-0.5792, tz:'Europe/Paris'}
        ]},
        'GB': { name: 'United Kingdom', cities: [
          {name:'London', lat:51.5074, lon:-0.1278, tz:'Europe/London'},
          {name:'Manchester', lat:53.4808, lon:-2.2426, tz:'Europe/London'},
          {name:'Birmingham', lat:52.4862, lon:-1.8904, tz:'Europe/London'},
          {name:'Glasgow', lat:55.8642, lon:-4.2518, tz:'Europe/London'},
          {name:'Edinburgh', lat:55.9533, lon:-3.1883, tz:'Europe/London'}
        ]},
        'PL': { name: 'Poland', cities: [
          {name:'Warsaw', lat:52.2297, lon:21.0122, tz:'Europe/Warsaw'},
          {name:'Kraków', lat:50.0647, lon:19.9450, tz:'Europe/Warsaw'},
          {name:'Gdańsk', lat:54.3520, lon:18.6466, tz:'Europe/Warsaw'},
          {name:'Wrocław', lat:51.1079, lon:17.0385, tz:'Europe/Warsaw'},
          {name:'Poznań', lat:52.4064, lon:16.9252, tz:'Europe/Warsaw'}
        ]},
        'FI': { name: 'Finland', cities: [
          {name:'Helsinki', lat:60.1699, lon:24.9384, tz:'Europe/Helsinki'},
          {name:'Tampere', lat:61.4978, lon:23.7610, tz:'Europe/Helsinki'},
          {name:'Turku', lat:60.4518, lon:22.2666, tz:'Europe/Helsinki'},
          {name:'Oulu', lat:65.0121, lon:25.4651, tz:'Europe/Helsinki'}
        ]},
        'SE': { name: 'Sweden', cities: [
          {name:'Stockholm', lat:59.3293, lon:18.0686, tz:'Europe/Stockholm'},
          {name:'Gothenburg', lat:57.7089, lon:11.9746, tz:'Europe/Stockholm'},
          {name:'Malmö', lat:55.6050, lon:13.0038, tz:'Europe/Stockholm'}
        ]},
        'NO': { name: 'Norway', cities: [
          {name:'Oslo', lat:59.9139, lon:10.7522, tz:'Europe/Oslo'},
          {name:'Bergen', lat:60.3929, lon:5.3245, tz:'Europe/Oslo'},
          {name:'Trondheim', lat:63.4305, lon:10.3951, tz:'Europe/Oslo'}
        ]},
        'DK': { name: 'Denmark', cities: [
          {name:'Copenhagen', lat:55.6761, lon:12.5683, tz:'Europe/Copenhagen'},
          {name:'Aarhus', lat:56.1629, lon:10.2039, tz:'Europe/Copenhagen'}
        ]},
        'IT': { name: 'Italy', cities: [
          {name:'Rome', lat:41.9028, lon:12.4964, tz:'Europe/Rome'},
          {name:'Milan', lat:45.4642, lon:9.1900, tz:'Europe/Rome'},
          {name:'Naples', lat:40.8518, lon:14.2681, tz:'Europe/Rome'},
          {name:'Turin', lat:45.0703, lon:7.6869, tz:'Europe/Rome'},
          {name:'Venice', lat:45.4408, lon:12.3155, tz:'Europe/Rome'}
        ]},
        'ES': { name: 'Spain', cities: [
          {name:'Madrid', lat:40.4168, lon:-3.7038, tz:'Europe/Madrid'},
          {name:'Barcelona', lat:41.3851, lon:2.1734, tz:'Europe/Madrid'},
          {name:'Valencia', lat:39.4699, lon:-0.3763, tz:'Europe/Madrid'},
          {name:'Seville', lat:37.3891, lon:-5.9845, tz:'Europe/Madrid'}
        ]},
        'PT': { name: 'Portugal', cities: [
          {name:'Lisbon', lat:38.7223, lon:-9.1393, tz:'Europe/Lisbon'},
          {name:'Porto', lat:41.1579, lon:-8.6291, tz:'Europe/Lisbon'}
        ]},
        'NL': { name: 'Netherlands', cities: [
          {name:'Amsterdam', lat:52.3676, lon:4.9041, tz:'Europe/Amsterdam'},
          {name:'Rotterdam', lat:51.9225, lon:4.4792, tz:'Europe/Amsterdam'},
          {name:'The Hague', lat:52.0705, lon:4.3007, tz:'Europe/Amsterdam'}
        ]},
        'BE': { name: 'Belgium', cities: [
          {name:'Brussels', lat:50.8503, lon:4.3517, tz:'Europe/Brussels'},
          {name:'Antwerp', lat:51.2194, lon:4.4025, tz:'Europe/Brussels'}
        ]},
        'CH': { name: 'Switzerland', cities: [
          {name:'Zurich', lat:47.3769, lon:8.5417, tz:'Europe/Zurich'},
          {name:'Geneva', lat:46.2044, lon:6.1432, tz:'Europe/Zurich'},
          {name:'Bern', lat:46.9480, lon:7.4474, tz:'Europe/Zurich'}
        ]},
        'AT': { name: 'Austria', cities: [
          {name:'Vienna', lat:48.2082, lon:16.3738, tz:'Europe/Vienna'},
          {name:'Graz', lat:47.0707, lon:15.4395, tz:'Europe/Vienna'}
        ]},
        'CZ': { name: 'Czech Republic', cities: [
          {name:'Prague', lat:50.0755, lon:14.4378, tz:'Europe/Prague'},
          {name:'Brno', lat:49.1951, lon:16.6068, tz:'Europe/Prague'}
        ]},
        'SK': { name: 'Slovakia', cities: [
          {name:'Bratislava', lat:48.1486, lon:17.1077, tz:'Europe/Bratislava'},
          {name:'Košice', lat:48.7164, lon:21.2611, tz:'Europe/Bratislava'}
        ]},
        'HU': { name: 'Hungary', cities: [
          {name:'Budapest', lat:47.4979, lon:19.0402, tz:'Europe/Budapest'},
          {name:'Debrecen', lat:47.5316, lon:21.6273, tz:'Europe/Budapest'}
        ]},
        'RO': { name: 'Romania', cities: [
          {name:'Bucharest', lat:44.4268, lon:26.1025, tz:'Europe/Bucharest'},
          {name:'Cluj-Napoca', lat:46.7712, lon:23.6236, tz:'Europe/Bucharest'}
        ]},
        'BG': { name: 'Bulgaria', cities: [
          {name:'Sofia', lat:42.6977, lon:23.3219, tz:'Europe/Sofia'},
          {name:'Plovdiv', lat:42.1354, lon:24.7453, tz:'Europe/Sofia'}
        ]},
        'GR': { name: 'Greece', cities: [
          {name:'Athens', lat:37.9838, lon:23.7275, tz:'Europe/Athens'},
          {name:'Thessaloniki', lat:40.6401, lon:22.9444, tz:'Europe/Athens'}
        ]},
        'HR': { name: 'Croatia', cities: [
          {name:'Zagreb', lat:45.8150, lon:15.9819, tz:'Europe/Zagreb'},
          {name:'Split', lat:43.5081, lon:16.4402, tz:'Europe/Zagreb'}
        ]},
        'RS': { name: 'Serbia', cities: [
          {name:'Belgrade', lat:44.8176, lon:20.4633, tz:'Europe/Belgrade'},
          {name:'Novi Sad', lat:45.2671, lon:19.8335, tz:'Europe/Belgrade'}
        ]},
        'BA': { name: 'Bosnia and Herzegovina', cities: [
          {name:'Sarajevo', lat:43.8563, lon:18.4131, tz:'Europe/Sarajevo'}
        ]},
        'SI': { name: 'Slovenia', cities: [
          {name:'Ljubljana', lat:46.0569, lon:14.5058, tz:'Europe/Ljubljana'}
        ]},
        'LT': { name: 'Lithuania', cities: [
          {name:'Vilnius', lat:54.6872, lon:25.2797, tz:'Europe/Vilnius'},
          {name:'Kaunas', lat:54.8985, lon:23.9036, tz:'Europe/Vilnius'}
        ]},
        'LV': { name: 'Latvia', cities: [
          {name:'Riga', lat:56.9460, lon:24.1059, tz:'Europe/Riga'},
          {name:'Daugavpils', lat:55.8747, lon:26.5361, tz:'Europe/Riga'}
        ]},
        'BY': { name: 'Belarus', cities: [
          {name:'Minsk', lat:53.9045, lon:27.5615, tz:'Europe/Minsk'},
          {name:'Gomel', lat:52.4345, lon:30.9754, tz:'Europe/Minsk'}
        ]},
        'MD': { name: 'Moldova', cities: [
          {name:'Chișinău', lat:47.0105, lon:28.8638, tz:'Europe/Chisinau'}
        ]},
        'IE': { name: 'Ireland', cities: [
          {name:'Dublin', lat:53.3498, lon:-6.2603, tz:'Europe/Dublin'},
          {name:'Cork', lat:51.8985, lon:-8.4756, tz:'Europe/Dublin'}
        ]},
        'IS': { name: 'Iceland', cities: [
          {name:'Reykjavik', lat:64.1265, lon:-21.8174, tz:'Atlantic/Reykjavik'}
        ]}
      }
    },
    'Asia': {
      labelKey: 'region.asia',
      countries: {
        'JP': { name: 'Japan', cities: [
          {name:'Tokyo', lat:35.6762, lon:139.6503, tz:'Asia/Tokyo'},
          {name:'Osaka', lat:34.6937, lon:135.5023, tz:'Asia/Tokyo'},
          {name:'Kyoto', lat:35.0116, lon:135.7681, tz:'Asia/Tokyo'},
          {name:'Sapporo', lat:43.0618, lon:141.3545, tz:'Asia/Tokyo'}
        ]},
        'CN': { name: 'China', cities: [
          {name:'Beijing', lat:39.9042, lon:116.4074, tz:'Asia/Shanghai'},
          {name:'Shanghai', lat:31.2304, lon:121.4737, tz:'Asia/Shanghai'},
          {name:'Shenzhen', lat:22.5431, lon:114.0579, tz:'Asia/Shanghai'},
          {name:'Chengdu', lat:30.5728, lon:104.0668, tz:'Asia/Shanghai'}
        ]},
        'KR': { name: 'South Korea', cities: [
          {name:'Seoul', lat:37.5665, lon:126.9780, tz:'Asia/Seoul'},
          {name:'Busan', lat:35.1796, lon:129.0756, tz:'Asia/Seoul'}
        ]},
        'IN': { name: 'India', cities: [
          {name:'New Delhi', lat:28.7041, lon:77.1025, tz:'Asia/Kolkata'},
          {name:'Mumbai', lat:19.0760, lon:72.8777, tz:'Asia/Kolkata'},
          {name:'Bangalore', lat:12.9716, lon:77.5946, tz:'Asia/Kolkata'},
          {name:'Chennai', lat:13.0827, lon:80.2707, tz:'Asia/Kolkata'}
        ]},
        'TR': { name: 'Türkiye', cities: [
          {name:'Istanbul', lat:41.0082, lon:28.9784, tz:'Europe/Istanbul'},
          {name:'Ankara', lat:39.9334, lon:32.8597, tz:'Europe/Istanbul'},
          {name:'Izmir', lat:38.4237, lon:27.1428, tz:'Europe/Istanbul'}
        ]},
        'IL': { name: 'Israel', cities: [
          {name:'Tel Aviv', lat:32.0853, lon:34.7818, tz:'Asia/Jerusalem'},
          {name:'Jerusalem', lat:31.7683, lon:35.2137, tz:'Asia/Jerusalem'}
        ]},
        'AE': { name: 'UAE', cities: [
          {name:'Dubai', lat:25.2048, lon:55.2708, tz:'Asia/Dubai'},
          {name:'Abu Dhabi', lat:24.4539, lon:54.3773, tz:'Asia/Dubai'}
        ]},
        'SG': { name: 'Singapore', cities: [
          {name:'Singapore', lat:1.3521, lon:103.8198, tz:'Asia/Singapore'}
        ]},
        'KZ': { name: 'Kazakhstan', cities: [
          {name:'Almaty', lat:43.2220, lon:76.8512, tz:'Asia/Almaty'},
          {name:'Astana', lat:51.1801, lon:71.4460, tz:'Asia/Almaty'}
        ]}
      }
    },
    'Africa': {
      labelKey: 'region.africa',
      countries: {
        'EG': { name: 'Egypt', cities: [
          {name:'Cairo', lat:30.0444, lon:31.2357, tz:'Africa/Cairo'},
          {name:'Alexandria', lat:31.2001, lon:29.9187, tz:'Africa/Cairo'}
        ]},
        'ZA': { name: 'South Africa', cities: [
          {name:'Johannesburg', lat:-26.2041, lon:28.0473, tz:'Africa/Johannesburg'},
          {name:'Cape Town', lat:-33.9249, lon:18.4241, tz:'Africa/Johannesburg'}
        ]},
        'MA': { name: 'Morocco', cities: [
          {name:'Casablanca', lat:33.5731, lon:-7.5898, tz:'Africa/Casablanca'},
          {name:'Rabat', lat:34.0209, lon:-6.8416, tz:'Africa/Casablanca'}
        ]},
        'NG': { name: 'Nigeria', cities: [
          {name:'Lagos', lat:6.5244, lon:3.3792, tz:'Africa/Lagos'},
          {name:'Abuja', lat:9.0579, lon:7.4951, tz:'Africa/Lagos'}
        ]},
        'KE': { name: 'Kenya', cities: [
          {name:'Nairobi', lat:-1.2921, lon:36.8219, tz:'Africa/Nairobi'}
        ]}
      }
    },
    'North America': {
      labelKey: 'region.northAmerica',
      countries: {
        'US': { name: 'United States', cities: [
          {name:'New York', lat:40.7128, lon:-74.0060, tz:'America/New_York'},
          {name:'Los Angeles', lat:34.0522, lon:-118.2437, tz:'America/Los_Angeles'},
          {name:'Chicago', lat:41.8781, lon:-87.6298, tz:'America/Chicago'},
          {name:'Houston', lat:29.7604, lon:-95.3698, tz:'America/Chicago'},
          {name:'Phoenix', lat:33.4484, lon:-112.0740, tz:'America/Phoenix'},
          {name:'Seattle', lat:47.6062, lon:-122.3321, tz:'America/Los_Angeles'},
          {name:'Miami', lat:25.7617, lon:-80.1918, tz:'America/New_York'},
          {name:'Denver', lat:39.7392, lon:-104.9903, tz:'America/Denver'}
        ]},
        'CA': { name: 'Canada', cities: [
          {name:'Toronto', lat:43.6532, lon:-79.3832, tz:'America/Toronto'},
          {name:'Vancouver', lat:49.2827, lon:-123.1207, tz:'America/Vancouver'},
          {name:'Montreal', lat:45.5017, lon:-73.5673, tz:'America/Toronto'},
          {name:'Calgary', lat:51.0447, lon:-114.0719, tz:'America/Edmonton'}
        ]},
        'MX': { name: 'Mexico', cities: [
          {name:'Mexico City', lat:19.4326, lon:-99.1332, tz:'America/Mexico_City'},
          {name:'Guadalajara', lat:20.6597, lon:-103.3496, tz:'America/Mexico_City'}
        ]}
      }
    },
    'South America': {
      labelKey: 'region.southAmerica',
      countries: {
        'BR': { name: 'Brazil', cities: [
          {name:'São Paulo', lat:-23.5505, lon:-46.6333, tz:'America/Sao_Paulo'},
          {name:'Rio de Janeiro', lat:-22.9068, lon:-43.1729, tz:'America/Sao_Paulo'},
          {name:'Brasília', lat:-15.7942, lon:-47.8822, tz:'America/Sao_Paulo'}
        ]},
        'AR': { name: 'Argentina', cities: [
          {name:'Buenos Aires', lat:-34.6037, lon:-58.3816, tz:'America/Argentina/Buenos_Aires'},
          {name:'Córdoba', lat:-31.4201, lon:-64.1888, tz:'America/Argentina/Buenos_Aires'}
        ]},
        'CO': { name: 'Colombia', cities: [
          {name:'Bogotá', lat:4.7110, lon:-74.0721, tz:'America/Bogota'}
        ]},
        'CL': { name: 'Chile', cities: [
          {name:'Santiago', lat:-33.4489, lon:-70.6693, tz:'America/Santiago'}
        ]}
      }
    },
    'Oceania': {
      labelKey: 'region.oceania',
      countries: {
        'AU': { name: 'Australia', cities: [
          {name:'Sydney', lat:-33.8688, lon:151.2093, tz:'Australia/Sydney'},
          {name:'Melbourne', lat:-37.8136, lon:144.9631, tz:'Australia/Melbourne'},
          {name:'Brisbane', lat:-27.4698, lon:153.0251, tz:'Australia/Brisbane'},
          {name:'Perth', lat:-31.9505, lon:115.8605, tz:'Australia/Perth'},
          {name:'Adelaide', lat:-34.9285, lon:138.6007, tz:'Australia/Adelaide'}
        ]},
        'NZ': { name: 'New Zealand', cities: [
          {name:'Auckland', lat:-36.8509, lon:174.7645, tz:'Pacific/Auckland'},
          {name:'Wellington', lat:-41.2865, lon:174.7762, tz:'Pacific/Auckland'}
        ]}
      }
    }
  };

  const wizardState = {
    step: 'confirm-country',
    region: null,
    countryCode: 'EE',
    fromIPStep: false  // tracks if we entered via IP detection
  };

  async function detectCountry() {
    try {
      const res = await AmbiSun.webos.detectCountryByIp();

      if (
        res &&
        res.returnValue &&
        res.country &&
        res.country.countryCode
      ) {
        wizardState.countryCode = res.country.countryCode;

        return {
          country: res.country.name || res.country.countryCode,
          countryCode: res.country.countryCode,
          provider: 'countries.dev'
        };
      }
    } catch (e) {}

    const fallback =
      window.AmbiSun.state.location || {
        country: 'Estonia',
        countryCode: 'EE'
      };

    wizardState.countryCode = fallback.countryCode || 'EE';

    return {
      country: fallback.country || fallback.countryCode || 'Estonia',
      countryCode: fallback.countryCode || 'EE',
      provider: 'fallback'
    };
  }

  // ---- City data: bundled fallback + backend API expansion ----
  // cityCache: { 'EE': { ts, cities: [...] } }
  const cityCache = {};
  const CITY_CACHE_TTL = 24 * 3600 * 1000;

  // Get bundled cities for a country from DEMO_LOCATION_DATA
  function getBundledCities(countryCode) {
    for (const region of Object.values(DEMO_LOCATION_DATA)) {
      if (region.countries && region.countries[countryCode]) {
        return region.countries[countryCode].cities || [];
      }
    }
    return [];
  }

  // Fetch via backend searchLocations service (Node.js, no CORS issues)
  function fetchCitiesFromBackend(countryCode) {
    const bundled = getBundledCities(countryCode);

    return AmbiSun.webos.searchLocations({
      countryCode: countryCode
    })
      .then(function(res) {

        if (
          !res ||
          !res.returnValue ||
          !Array.isArray(res.cities) ||
          res.cities.length === 0
        ) {
          return bundled;
        }

        const merged = [];
        const names = new Set();

        // API cities are population sorted and already contain
        // coordinates/timezone.
        res.cities.forEach(function(city) {
          if (!city || !city.name) return;

          const key = city.name.toLowerCase();

          if (names.has(key)) return;
          names.add(key);

          merged.push(city);
        });

        // Offline fallback entries are appended only if missing.
        bundled.forEach(function(city) {
          const key = city.name.toLowerCase();

          if (names.has(key)) return;
          names.add(key);

          merged.push(city);
        });

        return merged;
      })
      .catch(function() {
        return bundled;
      });
  }

  // getCities — always returns immediately with bundled data,
  // then fires background API expansion and re-renders wizard
  async function getCities(countryCode) {
    const now = Date.now();
    const cached = cityCache[countryCode];

    if (
      cached &&
      (now - cached.ts) < CITY_CACHE_TTL &&
      cached.cities.length > 0
    ) {
      return cached.cities;
    }

    const bundled = getBundledCities(countryCode);

    try {
      const cities = await fetchCitiesFromBackend(countryCode);

      if (cities && cities.length > 0) {
        cityCache[countryCode] = {
          ts: Date.now(),
          cities: cities
        };

        return cities;
      }
    } catch (e) {}

    return bundled.length > 0 ? bundled : null;
  }

  function getCountryName(countryCode) {
    for (const region of Object.values(DEMO_LOCATION_DATA)) {
      if (region.countries[countryCode]) return region.countries[countryCode].name;
    }
    return countryCode;
  }

  async function getRegions() {
    return Object.keys(DEMO_LOCATION_DATA);
  }

  async function getCountries(region) {
    const r = DEMO_LOCATION_DATA[region];
    return r ? Object.entries(r.countries) : [];
  }

  function getRegionLabelKey(region) {
    return DEMO_LOCATION_DATA[region] && DEMO_LOCATION_DATA[region].labelKey ? DEMO_LOCATION_DATA[region].labelKey : region;
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

    // Always reset to IP confirmation on fresh wizard open.
    // The first step performs real country-level IP geolocation through the backend.
    // Once user proceeds past this step, the wizard state machine tracks manually.
    wizardState.step = 'confirm-country';
    wizardState.region = null;
    wizardState.fromIPStep = false;
    wizardState.countryCode = (window.AmbiSun.state.location && window.AmbiSun.state.location.countryCode) || 'EE';

    w.classList.add('open');
    w.setAttribute('aria-hidden', 'false');
    renderWizard();
  }

  function closeWizard() {
    const w = document.getElementById('locationWizard');
    if (!w) return;
    w.classList.remove('open');
    w.setAttribute('aria-hidden','true');

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
      if (wizardState.region) wizardState.step = 'countries';
      else wizardState.step = 'confirm-country';
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

  async function renderWizard(silent) {
    const content = document.getElementById('locationWizardContent');
    const stepLabel = document.getElementById('locationStepLabel');
    if (!content || !stepLabel) return;

    let html = '';

    if (wizardState.step === 'confirm-country') {
      const detected = await detectCountry();
      stepLabel.textContent = AmbiSun.i18n.t('location.stepDetected','Определено по IP');
      html = `
        <div class="location-lead">${AmbiSun.i18n.t('location.detectedLead','По IP определена страна:')}</div>
        <div class="location-detected">${detected.country}</div>
        <div class="location-lead">${AmbiSun.i18n.t('location.isCountryCorrect','Вы находитесь в этой стране?')}</div>
        <div class="location-actions">
          <div class="location-big-button actionable" data-action="location-country-yes" role="button" tabindex="-1">
            <span>${AmbiSun.i18n.t('common.yes','Да')}</span><span>✓</span>
          </div>
          <div class="location-big-button actionable" data-action="location-country-no" role="button" tabindex="-1">
            <span>${AmbiSun.i18n.t('common.no','Нет')}</span><span>›</span>
          </div>
        </div>
        <div class="location-footer">
          <span>${AmbiSun.i18n.t('location.noKeyboard','Без клавиатуры — только пульт')}</span>
          <span class="location-current">${window.AmbiSun.state.location.city}, ${window.AmbiSun.state.location.country}</span>
        </div>`;
    } else if (wizardState.step === 'regions') {
      stepLabel.textContent = AmbiSun.i18n.t('location.stepRegion','Регион');
      const regions = await getRegions();
      html = `
        <div class="location-lead">${AmbiSun.i18n.t('location.chooseRegion','Выберите регион')}</div>
        <div class="location-choice-list">
          ${regions.map(region =>
            wizardChoice(
              AmbiSun.i18n.t(getRegionLabelKey(region), region),
              'location-region',
              `data-region="${region}"`
            )
          ).join('')}
        </div>
        <div class="location-footer">
          <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
            <span>← ${AmbiSun.i18n.t('common.back','Назад')}</span>
          </div>
        </div>`;
    } else if (wizardState.step === 'countries') {
      stepLabel.textContent = AmbiSun.i18n.t('location.stepCountry','Страна');
      const countries = await getCountries(wizardState.region);
      html = `
        <div class="location-lead">${AmbiSun.i18n.t('location.chooseCountry','Выберите страну')}</div>
        <div class="location-choice-list">
          ${countries.map(([code,country]) =>
            wizardChoice(country.name,'location-country',`data-country-code="${code}"`)
          ).join('')}
        </div>
        <div class="location-footer">
          <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
            <span>← ${AmbiSun.i18n.t('common.back','Назад')}</span>
          </div>
        </div>`;
    } else if (wizardState.step === 'cities') {
      stepLabel.textContent = AmbiSun.i18n.t('location.stepCity','Город');
      
      const cities = await getCities(wizardState.countryCode);

      if (cities === null || cities.length === 0) {
        // Network error and no fallback
        html = `
          <div class="location-lead" style="color:var(--danger)">${AmbiSun.i18n.t('location.apiError','Не удалось загрузить города. Проверьте подключение.')}</div>
          <div class="location-choice-list">
            <div class="location-big-button actionable" data-action="location-city-retry" role="button" tabindex="-1">
              <span>↻ ${AmbiSun.i18n.t('common.retry','Повторить')}</span>
            </div>
          </div>
          <div class="location-footer">
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back','Назад')}</span>
            </div>
          </div>`;
      } else {
        html = `
          <div class="location-lead">${AmbiSun.i18n.t('location.chooseCity','Выберите город')}</div>
          <div class="location-choice-list">
            ${cities.slice(0, 60).map(city =>
              wizardChoice(
                city.name,
                'location-city',
                `data-city="${city.name}"`,
                city.population > 0 ? (city.population >= 1000000 ? Math.round(city.population/1000000*10)/10+'M жит.' : Math.round(city.population/1000)+'K жит.') : ''
              )
            ).join('')}
          </div>
          <div class="location-footer">
            <span style="font-size:14px">${AmbiSun.i18n.t('location.apiSourceCountriesDev','Данные: countries.dev / GeoNames')}</span>
            <div class="location-big-button actionable" data-action="location-back" role="button" tabindex="-1">
              <span>← ${AmbiSun.i18n.t('common.back','Назад')}</span>
            </div>
          </div>`;
      }
    }

    // Only update innerHTML if it changed, or if not silent, to prevent losing focus during background update
    if (content.innerHTML !== html) {
      // Find what was focused
      const focusedAction = document.activeElement ? document.activeElement.dataset.action : null;
      const focusedValue = document.activeElement ? (document.activeElement.dataset.city || document.activeElement.dataset.countryCode || document.activeElement.dataset.region) : null;
      
      content.innerHTML = html;
      
      if (silent) {
          // Restore focus if possible
          let restored = false;
          if (focusedAction && focusedValue) {
             const selector = `[data-action="${focusedAction}"][data-city="${focusedValue}"], [data-action="${focusedAction}"][data-country-code="${focusedValue}"], [data-action="${focusedAction}"][data-region="${focusedValue}"]`;
             const el = content.querySelector(selector);
             if (el && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
                 AmbiSun.navigation.setFocus(el);
                 restored = true;
             }
          }
          if (!restored) {
             const first = content.querySelector('.actionable');
             if (first && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
                 AmbiSun.navigation.setFocus(first);
             }
          }
      } else {
          const first = content.querySelector('.actionable');
          if (first && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
            AmbiSun.navigation.setFocus(first);
          }
      }
    }
  }

  async function selectCity(countryCode, cityName) {
    const cities = await getCities(countryCode);

    if (!cities) return null;

    let city = cities.find(function(c) {
      return c.name === cityName;
    });

    if (!city) return null;

    const countryName = getCountryName(countryCode);

    // API city entries intentionally contain only the name.
    // Resolve coordinates/timezone only after the user chooses one.
    if (
      city.needsResolve ||
      typeof city.lat !== 'number' ||
      typeof city.lon !== 'number' ||
      !city.tz
    ) {
      try {
        const resolved = await AmbiSun.webos.resolveLocation({
          countryCode: countryCode,
          city: city.name
        });

        if (
          !resolved ||
          !resolved.returnValue ||
          !resolved.location
        ) {
          return null;
        }

        city = {
          name: resolved.location.city || cityName,
          lat: resolved.location.lat,
          lon: resolved.location.lon,
          tz: resolved.location.timezone
        };

      } catch (e) {
        return null;
      }
    }

    window.AmbiSun.state.location = {
      country: countryName,
      countryCode: countryCode,
      city: city.name,
      lat: city.lat,
      lon: city.lon,
      timezone: city.tz
    };

    await Promise.resolve(
      AmbiSun.bridge.mutateConfig({
        location: window.AmbiSun.state.location
      })
    );

    updateUI();
    closeWizard();

    return city.name + ", " + countryName;
  }

  function actionCountryYes() {
    wizardState.countryCode = wizardState.countryCode || 'EE';
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

  function actionCountry(code) {
    wizardState.countryCode = code;
    wizardState.step = 'cities';
    renderWizard();
  }

  async function actionCity(cityName) {
    return await selectCity(wizardState.countryCode, cityName);
  }

  AmbiSun.location.detectCountry = detectCountry;
  AmbiSun.location.getRegions = getRegions;
  AmbiSun.location.getCountries = getCountries;
  AmbiSun.location.getCities = getCities;

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
  AmbiSun.location.wizardCountryCode = function() { return wizardState.countryCode; };
  AmbiSun.location.clearCityCache = function(code) { if (code) delete cityCache[code]; };
})();
