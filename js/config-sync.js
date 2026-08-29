(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.configSync = AmbiSun.configSync || {};

  var RETRY_DELAYS = [250, 1000, 2500];

  function create(options) {
    options = options || {};
    var syncPromise = null;

    function applyConfig(res) {
      var cfg = res && res.config;
      if (!cfg) throw new Error("Config response is empty");

      var state = options.state;
      options.setRevision(res.revision);
      state.configRevision = res.revision;
      state.enabled = !!cfg.enabled;
      state.defaultRule = cfg.defaultRule || "sun";
      state.defaultEffect = cfg.defaultEffect || null;
      state.sunsetOffset = typeof cfg.sunsetOffset === "number" ? cfg.sunsetOffset : 0;
      state.sunriseOffset = typeof cfg.sunriseOffset === "number" ? cfg.sunriseOffset : 0;
      state.brightness = typeof cfg.brightness === "number" ? cfg.brightness : 50;
      if (Object.prototype.hasOwnProperty.call(cfg, "location")) state.location = cfg.location;
      if (cfg.overrides) state.sourceRules = cfg.overrides;
      state.effectOverrides = cfg.effectOverrides || {};
      state.sourceBrightness = cfg.sourceBrightness || {};
      state.hiddenSources = cfg.hiddenSources || {};
      if (typeof window.updateBrightnessUi === "function") window.updateBrightnessUi();

      if (cfg.hyperhdr) {
        state.hyperhdr = {
          host: cfg.hyperhdr.host || "127.0.0.1",
          port: cfg.hyperhdr.port || 8090
        };
        AmbiSun.config.hyperhdrEndpoint = "http://" + state.hyperhdr.host + ":" +
          state.hyperhdr.port + "/json-rpc?request";
      }
      options.updateHyperhdrBadge();
      document.querySelectorAll('[data-setting-value="sunset"]').forEach(function (el) {
        el.textContent = options.formatOffset(cfg.sunsetOffset);
      });
      document.querySelectorAll('[data-setting-value="sunrise"]').forEach(function (el) {
        el.textContent = options.formatOffset(cfg.sunriseOffset);
      });
      if (typeof window.updateBoolean === "function") window.updateBoolean("enabled");
      if (AmbiSun.location && AmbiSun.location.updateUI) AmbiSun.location.updateUI();
      if (AmbiSun.sources && AmbiSun.sources.updateDefaultEffect) AmbiSun.sources.updateDefaultEffect();
      if (AmbiSun.sources && AmbiSun.sources.renderSourceList) AmbiSun.sources.renderSourceList();
      return true;
    }

    function load(attempt) {
      return options.getConfig().then(applyConfig).catch(function (error) {
        if (attempt < RETRY_DELAYS.length) {
          return new Promise(function (resolve) {
            setTimeout(resolve, RETRY_DELAYS[attempt]);
          }).then(function () { return load(attempt + 1); });
        }
        console.warn("[bridge] syncConfig failed:", error && error.message);
        return false;
      });
    }

    return function syncConfig() {
      if (syncPromise) return syncPromise;
      syncPromise = load(0).then(function (result) {
        syncPromise = null;
        return result;
      }, function (error) {
        syncPromise = null;
        throw error;
      });
      return syncPromise;
    };
  }

  AmbiSun.configSync.create = create;
}());
