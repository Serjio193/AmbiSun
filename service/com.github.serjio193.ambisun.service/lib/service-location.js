var https = require('https');
var fs = require('fs');
var path = require('path');

module.exports = function registerLocation(service) {
    var LOCATION_HTTP_TIMEOUT = 3500;
    var LOCATION_MAX_RESPONSE = 128 * 1024;
    var LOCATION_DATA_ROOT = path.join(__dirname, '..', 'data');
    var LOCATION_CITIES_ROOT = path.join(LOCATION_DATA_ROOT, 'cities');
    var countryCatalogCache = null;
    var localCityCache = {};

    function locationHttpGetJson(targetUrl, callback) {
        var finished = false;
        function finish(err, data) {
            if (finished) return;
            finished = true;
            callback(err, data);
        }
        var req;
        try {
            req = https.get(targetUrl, {
                headers: { 'User-Agent': 'AmbiSun/0.1', 'Accept': 'application/json' }
            }, function (res) {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    return finish(new Error('LOCATION_HTTP_' + res.statusCode));
                }
                var body = '';
                var size = 0;
                res.setEncoding('utf8');
                res.on('data', function (chunk) {
                    if (finished) return;
                    size += Buffer.byteLength(chunk, 'utf8');
                    if (size > LOCATION_MAX_RESPONSE) {
                        req.destroy();
                        return finish(new Error('LOCATION_RESPONSE_TOO_LARGE'));
                    }
                    body += chunk;
                });
                res.on('end', function () {
                    if (finished) return;
                    try { finish(null, JSON.parse(body)); } catch (_) { finish(new Error('LOCATION_INVALID_JSON')); }
                });
            });
            req.setTimeout(LOCATION_HTTP_TIMEOUT, function () {
                req.destroy();
                finish(new Error('LOCATION_TIMEOUT'));
            });
            req.on('error', function (err) { finish(err); });
        } catch (err) {
            finish(err);
        }
    }

    function loadCountryCatalog(callback) {
        if (countryCatalogCache) return callback(null, countryCatalogCache);
        fs.readFile(path.join(LOCATION_DATA_ROOT, 'countries.json'), 'utf8', function (err, body) {
            if (err) return callback(err);
            try {
                countryCatalogCache = JSON.parse(body);
                callback(null, countryCatalogCache);
            } catch (parseErr) {
                callback(parseErr);
            }
        });
    }

    function normalizeLocalCity(raw) {
        if (!raw || !raw.n) return null;
        var lat = Number(raw.a);
        var lon = Number(raw.o);
        if (!isFinite(lat) || !isFinite(lon)) return null;
        return { name: String(raw.n), lat: lat, lon: lon, tz: raw.t ? String(raw.t) : 'UTC', population: Number(raw.p) || 0 };
    }

    function loadLocalCities(countryCode, callback) {
        countryCode = String(countryCode || '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(countryCode)) return callback(new Error('INVALID_COUNTRY_CODE'));
        if (localCityCache[countryCode]) return callback(null, localCityCache[countryCode]);
        var file = path.join(LOCATION_CITIES_ROOT, countryCode + '.json');
        fs.readFile(file, 'utf8', function (err, body) {
            if (err) return callback(err);
            try {
                var raw = JSON.parse(body);
                if (!Array.isArray(raw)) return callback(new Error('INVALID_CITY_DATABASE'));
                var cities = raw.map(normalizeLocalCity).filter(function (city) { return !!city; });
                localCityCache[countryCode] = cities;
                callback(null, cities);
            } catch (parseErr) {
                callback(parseErr);
            }
        });
    }

    service.register('detectCountryByIp', function (message) {
        locationHttpGetJson('https://countries.dev/ip', function (err, data) {
            if (err) return message.respond({ returnValue: false, errorCode: 'IP_GEO_ERROR', errorText: err.message });
            var code = data && data.countryCode ? String(data.countryCode).toUpperCase() : '';
            var name = data && data.country && data.country.name ? String(data.country.name) : '';
            if (!code) return message.respond({ returnValue: false, errorCode: 'IP_GEO_INVALID_RESPONSE' });
            message.respond({ returnValue: true, provider: 'countries.dev', country: { countryCode: code, name: name || code } });
        });
    });

    service.register('getLocationCountries', function (message) {
        loadCountryCatalog(function (err, catalog) {
            if (err) return message.respond({ returnValue: false, errorCode: 'LOCATION_DATABASE_ERROR', errorText: err.toString() });
            message.respond({ returnValue: true, provider: 'geonames-offline', catalog: catalog });
        });
    });

    service.register('searchLocations', function (message) {
        var params = message.payload || {};
        var countryCode = String(params.countryCode || '').trim().toUpperCase();
        var offset = parseInt(params.offset, 10);
        if (isNaN(offset) || offset < 0) offset = 0;
        var limit = parseInt(params.limit, 10);
        if (isNaN(limit) || limit <= 0 || limit > 60) limit = 60;
        loadLocalCities(countryCode, function (err, cities) {
            if (err) return message.respond({ returnValue: false, errorCode: 'LOCATION_DATABASE_ERROR', errorText: err.toString() });
            message.respond({
                returnValue: true,
                provider: 'geonames-offline',
                countryCode: countryCode,
                total: cities.length,
                offset: offset,
                limit: limit,
                cities: cities.slice(offset, offset + limit)
            });
        });
    });

    service.register('resolveLocation', function (message) {
        var params = message.payload || {};
        var countryCode = String(params.countryCode || '').trim().toUpperCase();
        var cityName = String(params.city || '').trim();
        loadLocalCities(countryCode, function (err, cities) {
            if (err) return message.respond({ returnValue: false, errorCode: 'LOCATION_DATABASE_ERROR', errorText: err.toString() });
            var wanted = cityName.toLowerCase();
            var city = null;
            for (var i = 0; i < cities.length; i++) {
                if (cities[i].name.toLowerCase() === wanted) {
                    city = cities[i];
                    break;
                }
            }
            if (!city) return message.respond({ returnValue: false, errorCode: 'LOCATION_NOT_FOUND' });
            message.respond({
                returnValue: true,
                provider: 'geonames-offline',
                location: { city: city.name, countryCode: countryCode, lat: city.lat, lon: city.lon, timezone: city.tz }
            });
        });
    });
};
