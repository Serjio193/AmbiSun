(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.webos = AmbiSun.webos || {};
  AmbiSun.config = AmbiSun.config || {};

  AmbiSun.config.serviceUri = AmbiSun.config.serviceUri || "luna://com.github.serjio193.ambisun.service";

  const LUNA_TIMEOUT_MS = 5000;
  const LUNA_INSTALL_TIMEOUT_MS = 45000;
  const HBCHANNEL_SERVICE_URI = "luna://org.webosbrew.hbchannel.service";
  const ELEVATE_SERVICE_BIN = "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service";
  const SERVICE_ID = "com.github.serjio193.ambisun.service";

  function hasWebOS() {
    return !!(
      (window.webOS && window.webOS.service && window.webOS.service.request) ||
      (typeof window.PalmServiceBridge === "function")
    );
  }

  function requestUri(serviceUri, method, parameters, timeoutMs) {
    const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : LUNA_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("LUNA_TIMEOUT:" + method));
        }
      }, timeout);

      if (window.webOS && window.webOS.service && window.webOS.service.request) {
        try {
          window.webOS.service.request(serviceUri, {
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
          const fullUri = serviceUri + "/" + method;
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

  function requestService(method, parameters, timeoutMs) {
    return requestUri(AmbiSun.config.serviceUri || "luna://com.github.serjio193.ambisun.service", method, parameters, timeoutMs);
  }

  function requireSuccessfulResponse(res, operation) {
    if (!res || res.returnValue === false) {
      throw new Error((res && (res.errorText || res.error)) || operation + " failed");
    }
    return res;
  }

  function getSystemStatus()  { return requestService("getSystemStatus", {}); }
  function getConfig()        { return requestService("getConfig", {}); }
  function updateConfig(patch, rev) { return requestService("updateConfig", { patch: patch, expectedRevision: rev }); }
  function resetConfig()      { return requestService("resetConfig", {}); }
  function getCurrentSource() { return requestService("getCurrentSource", {}); }
  function getAutomationStatus() { return requestService("getAutomationStatus", {}); }
  function getSchedulerStatus()  { return requestService("getSchedulerStatus", {}); }
  function requestElevationDirect() {
    // PicCap-style elevation: execute Homebrew elevate-service directly for the service.
    // Ensure standard tools (mktemp, sed) are reachable via PATH.
    const cmd = 'PATH="/usr/sbin:/usr/bin:/sbin:/bin:$PATH" ' + ELEVATE_SERVICE_BIN + " " + SERVICE_ID;
    return requestUri(HBCHANNEL_SERVICE_URI, "exec", { command: cmd }, 20000)
      .then(function(res) {
        if (!res || res.returnValue === false) {
          var failureDetails = [res && (res.errorText || res.errorCode || res.error),
            res && res.stderrString, res && res.stdoutString].filter(Boolean).join(" | ");
          throw new Error((failureDetails || "Homebrew elevation request failed").slice(0, 400));
        }
        return res;
      }).catch(function(err) {
        if (err && err.message) throw err;
        var details = [err && (err.errorText || err.errorCode || err.error),
          err && err.stderrString, err && err.stdoutString].filter(Boolean).join(" | ");
        throw new Error(details || "Homebrew elevation request failed");
      });
  }
  function requestElevation()    { return requestElevationDirect(); }
  function getSolarStatus()      { return requestService("getSolarStatus", {}); }
  function getAvailableSources() { return requestService("getAvailableSources", {}); }
  function getHyperhdrEffects() { return requestService("getHyperhdrEffects", {}); }
  function detectCountryByIp() { return requestService("detectCountryByIp", {}); }
  function getLocationCountries() { return requestService("getLocationCountries", {}); }
  function getHyperhdrStatus(params) { return requestService("getHyperhdrStatus", params || {}); }
  function previewHyperhdrEffect(name, durationMs, brightness) {
    const payload = { name: name };
    if (typeof durationMs === "number") payload.durationMs = durationMs;
    if (typeof brightness === "number") payload.brightness = brightness;
    return requestService("previewHyperhdrEffect", payload);
  }
  function previewHyperhdrBrightness(brightness) {
    return requestService("previewHyperhdrBrightness", { brightness: brightness });
  }
  function clearHyperhdrPreview() { return requestService("clearHyperhdrPreview", {}); }
  function searchLocations(params) { return requestService("searchLocations", params || {}); }
  function resolveLocation(params) { return requestService("resolveLocation", params || {}); }
  function checkForUpdate() { return requestService("checkForUpdate", {}); }
  function installUpdate(expectedVersion) { return requestService("installUpdate", { expectedVersion: expectedVersion }, LUNA_INSTALL_TIMEOUT_MS); }
  function minimizeApp() { return requestService("minimizeApp", {}); }

  AmbiSun.webos.hasWebOS = hasWebOS;
  AmbiSun.webos.requestService = requestService;
  AmbiSun.webos.getSystemStatus = getSystemStatus;
  AmbiSun.webos.getHyperhdrStatus = getHyperhdrStatus;
  AmbiSun.webos.previewHyperhdrEffect = previewHyperhdrEffect;
  AmbiSun.webos.previewHyperhdrBrightness = previewHyperhdrBrightness;
  AmbiSun.webos.clearHyperhdrPreview = clearHyperhdrPreview;
  AmbiSun.webos.getConfig = getConfig;
  AmbiSun.webos.updateConfig = updateConfig;
  AmbiSun.webos.resetConfig = resetConfig;
  AmbiSun.webos.getCurrentSource = getCurrentSource;
  AmbiSun.webos.getAutomationStatus = getAutomationStatus;
  AmbiSun.webos.getSchedulerStatus = getSchedulerStatus;
  AmbiSun.webos.requestElevation = requestElevation;
  AmbiSun.webos.requestElevationDirect = requestElevationDirect;
  AmbiSun.webos.getSolarStatus = getSolarStatus;
  AmbiSun.webos.getAvailableSources = getAvailableSources;
  AmbiSun.webos.getHyperhdrEffects = getHyperhdrEffects;
  AmbiSun.webos.detectCountryByIp = detectCountryByIp;
  AmbiSun.webos.getLocationCountries = getLocationCountries;
  AmbiSun.webos.searchLocations = searchLocations;
  AmbiSun.webos.resolveLocation = resolveLocation;
  AmbiSun.webos.checkForUpdate = checkForUpdate;
  AmbiSun.webos.installUpdate = installUpdate;
  AmbiSun.webos.minimizeApp = minimizeApp;
})();
