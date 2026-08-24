(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  const locationDisplay = window.AmbiSun.locationDisplay = window.AmbiSun.locationDisplay || {};

  locationDisplay.updateUI = function () {
    const state = window.AmbiSun.state;
    if (!state.location || !state.location.city) {
      const display = document.getElementById('locationDisplay');
      if (display) display.textContent = '📍 —';
      document.querySelectorAll('.location .left').forEach(el => { el.textContent = '📍 —'; });
      return;
    }
    const text = state.location.city + ', ' + state.location.country;
    const fullText = '📍 ' + text;
    const display = document.getElementById('locationDisplay');
    if (display) display.textContent = fullText;
    const badge = document.getElementById('settingsLocationBadge');
    if (badge) badge.textContent = text;
    document.querySelectorAll('.location .left').forEach(el => { el.textContent = fullText; });
  };
}());
