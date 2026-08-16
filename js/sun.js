(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.sun = AmbiSun.sun || {};

  // NOAA-style sunrise/sunset calculation.
  // Returns local Date instances using the TV/browser timezone for display.
  function degToRad(v) { return v * Math.PI / 180; }
  function radToDeg(v) { return v * 180 / Math.PI; }
  function normalize(v, mod) { return ((v % mod) + mod) % mod; }

  function dayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((now - start) / 86400000);
  }

  function solarEventUTC(date, latitude, longitude, sunrise) {
    const n = dayOfYear(date);
    const lngHour = longitude / 15;
    const t = n + ((sunrise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;

    let L = M + 1.916 * Math.sin(degToRad(M))
      + 0.020 * Math.sin(degToRad(2 * M)) + 282.634;
    L = normalize(L, 360);

    let RA = radToDeg(Math.atan(0.91764 * Math.tan(degToRad(L))));
    RA = normalize(RA, 360);
    const Lquadrant = Math.floor(L / 90) * 90;
    const RAquadrant = Math.floor(RA / 90) * 90;
    RA = (RA + Lquadrant - RAquadrant) / 15;

    const sinDec = 0.39782 * Math.sin(degToRad(L));
    const cosDec = Math.cos(Math.asin(sinDec));
    const zenith = 90.833; // standard sunrise/sunset
    const cosH = (
      Math.cos(degToRad(zenith)) -
      sinDec * Math.sin(degToRad(latitude))
    ) / (cosDec * Math.cos(degToRad(latitude)));

    if (cosH > 1) return {status:"polar-night", date:null};
    if (cosH < -1) return {status:"midnight-sun", date:null};

    let H = sunrise
      ? 360 - radToDeg(Math.acos(cosH))
      : radToDeg(Math.acos(cosH));
    H /= 15;

    const T = H + RA - 0.06571 * t - 6.622;
    const UT = normalize(T - lngHour, 24);

    const dayStart = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0, 0, 0, 0
    );
    return {status:"ok", date:new Date(dayStart + UT * 3600000)};
  }

  function calculate(date, latitude, longitude) {
    return {
      sunrise: solarEventUTC(date, latitude, longitude, true),
      sunset: solarEventUTC(date, latitude, longitude, false)
    };
  }

  function formatOffset(value){
    const sign = value > 0 ? '+' : '';
    return `${sign}${value} минут`;
  }

  function minutesToTime(total){
    total = ((total % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  function updateUI(){
    const state = window.AmbiSun.state;
    document.querySelectorAll('[data-setting-value="sunset"]').forEach(el => {
      el.textContent = formatOffset(state.sunsetOffset);
    });
    document.querySelectorAll('[data-setting-value="sunrise"]').forEach(el => {
      el.textContent = formatOffset(state.sunriseOffset);
    });

    const loc = state.location;
    let onTime = '--:--';
    let offTime = '--:--';

    if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') {
      const now = new Date();
      // To get today's sunrise/sunset:
      const evToday = calculate(now, loc.lat, loc.lon);
      if (evToday.sunset.status === 'ok') {
        const sunsetDate = new Date(evToday.sunset.date.getTime() + state.sunsetOffset * 60000);
        onTime = minutesToTime(sunsetDate.getHours() * 60 + sunsetDate.getMinutes());
      }
      
      const tomorrow = new Date(now.getTime() + 86400000);
      const evTomorrow = calculate(tomorrow, loc.lat, loc.lon);
      if (evTomorrow.sunrise.status === 'ok') {
        const sunriseDate = new Date(evTomorrow.sunrise.date.getTime() + state.sunriseOffset * 60000);
        offTime = minutesToTime(sunriseDate.getHours() * 60 + sunriseDate.getMinutes());
      }
    }

    // Keep duplicated values on Home/Sun screens synchronized.
    document.querySelectorAll('.sun-summary').forEach(summary => {
      const cells = summary.querySelectorAll('.sun-cell');
      if (cells.length >= 3) {
        const middle = cells[1].querySelector('.v');
        const last = cells[2].querySelector('.v');
        if (middle) middle.textContent = onTime;
        if (last) last.textContent = offTime;

        const middleSub = cells[1].querySelector('.s');
        const lastSub = cells[2].querySelector('.s');
        if (middleSub) middleSub.textContent = `(${formatOffset(state.sunsetOffset).replace(' минут',' мин')})`;
        if (lastSub) lastSub.textContent = `(${formatOffset(state.sunriseOffset).replace(' минут',' мин')})`;
      }
    });

    const nextRows = document.querySelectorAll('#home .rows .row .value');
    if (nextRows.length >= 3) {
      nextRows[1].innerHTML = `Сегодня, <span class="yellow">${onTime}</span> <span style="font-size:17px;color:#c6ccd5">(закат ${formatOffset(state.sunsetOffset).replace(' минут',' мин')})</span>`;
      nextRows[2].innerHTML = `Завтра, <span class="blue">${offTime}</span> <span style="font-size:17px;color:#c6ccd5">(восход ${formatOffset(state.sunriseOffset).replace(' минут',' мин')})</span>`;
    }
  }

  AmbiSun.sun.calculate = calculate;
  AmbiSun.sun.formatOffset = formatOffset;
  AmbiSun.sun.minutesToTime = minutesToTime;
  AmbiSun.sun.updateUI = updateUI;
})();
