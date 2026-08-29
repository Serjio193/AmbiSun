(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};

  var overlay = null;
  var valueEl = null;
  var meterEl = null;
  var statusEl = null;
  var active = false;
  var closing = false;
  var requestInFlight = false;
  var requestedValue = null;
  var scope = "default";
  var sourceId = null;
  var originalValue = 50;
  var currentValue = 50;
  var returnScreen = "home";

  function clamp(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function translate(key, fallback) {
    return AmbiSun.i18n && AmbiSun.i18n.t ? AmbiSun.i18n.t(key, fallback) : fallback;
  }

  function getCurrentValue() {
    if (scope === "source" && sourceId) {
      var overrides = AmbiSun.state.sourceBrightness || {};
      if (Object.prototype.hasOwnProperty.call(overrides, sourceId)) return clamp(overrides[sourceId]);
    }
    return clamp(AmbiSun.state.brightness);
  }

  function renderValue() {
    if (valueEl) valueEl.textContent = currentValue + "%";
    if (meterEl) meterEl.style.width = currentValue + "%";
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function sendPreview() {
    if (!active || requestedValue === null || requestInFlight) return;
    var value = requestedValue;
    requestedValue = null;
    requestInFlight = true;
    AmbiSun.webos.previewHyperhdrBrightness(value).then(function (response) {
      if (response && response.returnValue === false) {
        throw new Error(response.errorText || response.errorCode || "Preview failed");
      }
      setStatus("");
    }).catch(function () {
      setStatus(translate("error.connection", "Connection error"));
    }).then(function () {
      requestInFlight = false;
      if (closing) {
        clearPreview();
      } else if (requestedValue !== null) {
        sendPreview();
      }
    });
  }

  function requestPreview(value) {
    currentValue = clamp(value);
    requestedValue = currentValue;
    renderValue();
    sendPreview();
  }

  function updateValue(delta) {
    if (!active || closing) return;
    requestPreview(currentValue + delta);
  }

  function persistValue() {
    if (scope === "source" && sourceId) {
      var values = Object.assign({}, AmbiSun.state.sourceBrightness || {});
      values[sourceId] = currentValue;
      AmbiSun.state.sourceBrightness = values;
      return AmbiSun.bridge.mutateConfig({ sourceBrightness: values }, { skipSync: true, skipSolarSync: true });
    }
    AmbiSun.state.brightness = currentValue;
    return AmbiSun.bridge.mutateConfig({ brightness: currentValue });
  }

  function restoreFocus() {
    var target = document.querySelector('[data-action="open-brightness-test"][data-source="' + (sourceId || "") + '"]');
    if (scope === "default") target = document.querySelector('#home [data-action="open-brightness-test"]');
    if (target && AmbiSun.navigation && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(target);
  }

  function finishClose() {
    if (!closing || requestInFlight) return;
    closing = false;
    active = false;
    requestedValue = null;
    if (overlay) {
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden", "true");
    }
    AmbiSun.navigation.openScreen(returnScreen);
    restoreFocus();
  }

  function close(save) {
    if (!active || closing) return;
    closing = true;
    requestedValue = null;
    if (save && currentValue !== originalValue) {
      persistValue().then(function (success) {
        if (!success) {
          closing = false;
          setStatus(translate("error.saveFailed", "Save failed"));
          return;
        }
        if (!requestInFlight) clearPreview();
      });
      return;
    }
    clearPreview();
  }

  function clearPreview() {
    if (requestInFlight) return;
    AmbiSun.webos.clearHyperhdrPreview().catch(function () {
      setStatus(translate("error.connection", "Connection error"));
    }).then(finishClose);
  }

  function open(nextScope, nextSourceId, nextReturnScreen) {
    if (active) return;
    overlay = document.getElementById("brightnessTestOverlay");
    valueEl = document.getElementById("brightnessTestValue");
    meterEl = document.getElementById("brightnessTestMeterFill");
    statusEl = document.getElementById("brightnessTestStatus");
    if (!overlay || !AmbiSun.webos || !AmbiSun.webos.previewHyperhdrBrightness) return;
    scope = nextScope === "source" ? "source" : "default";
    sourceId = nextSourceId || null;
    returnScreen = nextReturnScreen || "home";
    originalValue = getCurrentValue();
    currentValue = originalValue;
    active = true;
    closing = false;
    requestInFlight = false;
    requestedValue = null;
    setStatus("");
    renderValue();
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    var back = overlay.querySelector('[data-action="brightness-test-cancel"]');
    if (back && AmbiSun.navigation && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(back);
    requestPreview(currentValue);
  }

  document.addEventListener("keydown", function (event) {
    if (!active) return;
    var key = event.key;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      updateValue(key === "ArrowRight" ? 5 : -5);
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (key === "Escape" || key === "Backspace" || key === "GoBack") {
      close(false);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  AmbiSun.brightnessTest = {
    open: open,
    save: function () { close(true); },
    cancel: function () { close(false); }
  };
})();
