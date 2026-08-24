var assert = require('assert');
var registerLocation = require('../lib/service-location');

var handlers = {};
registerLocation({
    register: function (name, handler) {
        handlers[name] = handler;
    }
});

assert.strictEqual(typeof handlers.getLocationCountries, 'function');
assert.strictEqual(typeof handlers.searchLocations, 'function');

handlers.getLocationCountries({
    respond: function (catalogResponse) {
        assert.strictEqual(catalogResponse.returnValue, true);
        assert.ok(catalogResponse.catalog.Europe.length > 0);

        handlers.searchLocations({
            payload: { countryCode: 'EE', offset: 0, limit: 1 },
            respond: function (citiesResponse) {
                assert.strictEqual(citiesResponse.returnValue, true);
                assert.ok(citiesResponse.total > 0);
                assert.strictEqual(citiesResponse.cities.length, 1);
                console.log('TEST: Location catalog and city data tests PASSED.');
            }
        });
    }
});
