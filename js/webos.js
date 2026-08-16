(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.webos = AmbiSun.webos || {};
  AmbiSun.config = AmbiSun.config || {};

  AmbiSun.config.serviceUri = AmbiSun.config.serviceUri || "luna://org.webosbrew.ambisun.service";

  const LUNA_TIMEOUT_MS = 5000;

  function hasWebOS() {
    return !!(window.webOS && window.webOS.service && window.webOS.service.request);
  }

  function requestService(method, parameters) {
    return new Promise((resolve, reject) => {
      if (!hasWebOS()) {
        reject(new Error("webOS service API is unavailable"));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("LUNA_TIMEOUT:" + method));
        }
      }, LUNA_TIMEOUT_MS);

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
  AmbiSun.webos.searchLocations = searchLocations;
  AmbiSun.webos.resolveLocation = resolveLocation;
})();
