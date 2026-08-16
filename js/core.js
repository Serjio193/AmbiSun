(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};

  AmbiSun.state = {
    screen: 'home',
    sunsetOffset: 30,
    sunriseOffset: 0,
    enabled: true,
    autostart: true,
    plasma: true,
    defaultRule: 'sun',
    language: 'en',
    sourceRules: {},
    location: {
      country: 'Estonia',
      countryCode: 'EE',
      city: 'Tallinn',
      lat: 59.437,
      lon: 24.7536,
      timezone: 'Europe/Tallinn'
    }
  };

  AmbiSun.constants = {
    RULES: ['off', 'sun', 'on'],
    STORAGE_KEYS: {
      firstRunLanguageDone: 'ambisun.firstRunLanguageDone',
      language: 'ambisun.language'
    },
    SUPPORT: {
      paypal: {
        title: 'PayPal',
        value: 'https://paypal.me/SerhiiTarnopovych',
        qr: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQgAAAEIAQAAAACLjVdSAAABjklEQVR4nO2ZwY7CQAxD/dD8/y97D0mm5cSJNNoBUFUVH0yUeOyA9eH1+gT4If4xQq4GcV4syddTT2Hag1jKSiALI2GBXE/HMO2rh4iaYFlY7Fq4jcdABCK7RDzJ41HEut1bWJKzP1p5TEEsSdfPjxtDCWsbjymI+/ny/q6vpzDtQeDbLXnE6D4wU5i2zQtWlaFqQd3hMUw7EaSSKktR7oNmHs8jcFqxfa5gZLQtyRSmbYhwYDa2iHLcWmUS0y6ELQgbRumHK8yMYvp1xFJOSHpSC5ktqcfNy8pAm5oROmLh0JXj8lzpaTmR8h8hqOi0/nhJpaPbdsiS48g9Tj9u/oPI+3sfAgfuPyjLoRiS3H7s4TltXuqHx5XYfjhV9UD9qHzrnfB9ZV77uHy79tKjPpcpcyOPKYi3/bqvJ3W8HNgfe79ORrpaKZ/o11+SBCiWHzEvQlBmZBTTTkRMCxXmHJZ9ItM2xM50uQ46Nu9nb1SmM5dRHcX064il6grVn5SpqeZEPb3t1x/l8UPMRPwB4Q/E5mXDyLAAAAAASUVORK5CYII='
      },
      usdt: {
        title: 'USDT TRC20',
        value: 'TB4kzsHL3emLtdvDroNE9dEpMhUW6r3bTL',
        qr: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQgAAAEIAQAAAACLjVdSAAABiklEQVR4nO2ZwY4CMQxDn9H8/y97D0475cSJTrQFhKg6PpjIqd0g8+H1+gT4If4xAg+BGOPaqRVgd2G6B3FBfrtAFhjlydjtwnQjQhJgFF1USbLbi+nXEde9VCnCejtjuzDdjrDGl/Qkj0cRF8CiB1kYyXO3C9Nn/OV+j8ddmG7Tx1SHIO2SQ3Urjy6IpI2ylRJGLbI+TB/VL/XbGcrwvejCdBsieXRYSlVCxokjjZhuRMgGuY4OKceIj8unMkr0MFm5ghnZa8N0H8IuKVQdRk61dZw+cn9Jr4i7GEJJZb2Yfh0x88doFJFyuNqoDdNtCMm6hXFf+BWzacR0DyJ+Ow13Jnhz4PxDRh6DoNTEDNs50F+WNnk3XxkdWA/syue2l9tLnp2X15dZWFx3/Zzpt3N+rOoZZhDRcf6yztdRogdY86bbhum+etRxGqepikQ05+ljQWheb2seogPvtyvCY2CYShw5T37B9FwZJBxpjBO2FdOvIy6mwchpmGnBOvA8ff8v7jkeP0RPxB+ihdTFgBJ/lgAAAABJRU5ErkJggg=='
      }
    }
  };

})();
