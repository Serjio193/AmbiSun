(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.webos = AmbiSun.webos || {};
  AmbiSun.config = AmbiSun.config || {};

  AmbiSun.config.serviceUri = AmbiSun.config.serviceUri || "luna://org.webosbrew.ambisun.service";

  const LUNA_TIMEOUT_MS = 5000;

  function hasWebOS() {
    return !!(
      (window.webOS && window.webOS.service && window.webOS.service.request) ||
      (typeof window.PalmServiceBridge === "function")
    );
  }

  function requestService(method, parameters) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("LUNA_TIMEOUT:" + method));
        }
      }, LUNA_TIMEOUT_MS);

      if (window.webOS && window.webOS.service && window.webOS.service.request) {
        try {
          window.webOS.service.request(AmbiSun.config.serviceUri, {
            method: method,
            parameters: parameters || {},
            onSuccess: function(res) {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(res);
              }
            },
            onFailure: function(err) {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err || new Error("Luna call failed: " + method));
              }
            }
          });
        } catch(e) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(e);
          }
        }
      } else if (typeof window.PalmServiceBridge === "function") {
        try {
          const bridge = new window.PalmServiceBridge();
          bridge.onservicecallback = function(msg) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              try {
                const res = typeof msg === "string" ? JSON.parse(msg) : msg;
                if (res && res.returnValue === false) {
                  reject(new Error(res.errorText || res.errorCode || ("Luna call failed: " + method)));
                } else {
                  resolve(res);
                }
              } catch(e) {
                reject(e);
              }
            }
          };
          const fullUri = (AmbiSun.config.serviceUri || "luna://org.webosbrew.ambisun.service") + "/" + method;
          bridge.call(fullUri, JSON.stringify(parameters || {}));
        } catch(e) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(e);
          }
        }
      } else {
        settled = true;
        clearTimeout(timer);
        reject(new Error("webOS service API is unavailable"));
      }
    });
  }

  function getSystemStatus()  { return requestService("getSystemStatus", {}); }
  function getConfig()        { return requestService("getConfig", {}); }
  function updateConfig(patch, rev) { return requestService("updateConfig", { patch: patch, expectedRevision: rev }); }
  function resetConfig()      { return requestService("resetConfig", {}); }
  function getCurrentSource() { return requestService("getCurrentSource", {}); }
  function getAutomationStatus() { return requestService("getAutomationStatus", {}); }
  function getSchedulerStatus()  { return requestService("getSchedulerStatus", {}); }
  function requestElevation()    { return requestService("requestElevation", {}); }
  function getSolarStatus()      { return requestService("getSolarStatus", {}); }
  function getAvailableSources() { return requestService("getAvailableSources", {}); }
  function detectCountryByIp() { return requestService("detectCountryByIp", {}); }
  function getLocationCountries() { return requestService("getLocationCountries", {}); }
  function searchLocations(params) { return requestService("searchLocations", params || {}); }
  function resolveLocation(params) { return requestService("resolveLocation", params || {}); }

  AmbiSun.webos.hasWebOS = hasWebOS;
  AmbiSun.webos.requestService = requestService;
  AmbiSun.webos.getSystemStatus = getSystemStatus;
  AmbiSun.webos.getConfig = getConfig;
  AmbiSun.webos.updateConfig = updateConfig;
  AmbiSun.webos.resetConfig = resetConfig;
  AmbiSun.webos.getCurrentSource = getCurrentSource;
  AmbiSun.webos.getAutomationStatus = getAutomationStatus;
  AmbiSun.webos.getSchedulerStatus = getSchedulerStatus;
  AmbiSun.webos.requestElevation = requestElevation;
  AmbiSun.webos.getSolarStatus = getSolarStatus;
  AmbiSun.webos.getAvailableSources = getAvailableSources;
  AmbiSun.webos.detectCountryByIp = detectCountryByIp;
  AmbiSun.webos.getLocationCountries = getLocationCountries;
  AmbiSun.webos.searchLocations = searchLocations;
  AmbiSun.webos.resolveLocation = resolveLocation;
})();
