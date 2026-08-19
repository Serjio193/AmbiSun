function degToRad(v) { return v * Math.PI / 180; }
function radToDeg(v) { return v * 180 / Math.PI; }
function normalize(v, mod) { return ((v % mod) + mod) % mod; }

function dayOfYear(y, m, d) {
    const start = Date.UTC(y, 0, 0);
    const now = Date.UTC(y, m, d);
    return Math.floor((now - start) / 86400000);
}

function solarEventUTC(year, month, day, latitude, longitude, sunrise) {
    const n = dayOfYear(year, month, day);
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
    const zenith = 90.833;
    const cosH = (
        Math.cos(degToRad(zenith)) -
        sinDec * Math.sin(degToRad(latitude))
    ) / (cosDec * Math.cos(degToRad(latitude)));

    if (cosH > 1) return { status: "polar-night", date: null };
    if (cosH < -1) return { status: "midnight-sun", date: null };

    let H = sunrise
        ? 360 - radToDeg(Math.acos(cosH))
        : radToDeg(Math.acos(cosH));
    H /= 15;

    let T = H + RA - 0.06571 * t - 6.622;
    // According to NOAA, T must be normalized to [0, 24)
    T = normalize(T, 24);
    
    // UT is then T - lngHour
    let UT = T - lngHour;
    
    // Instead of normalize(UT, 24), we leave the wrap intact!
    const dayStart = Date.UTC(year, month, day, 0, 0, 0, 0);
    return { status: "ok", date: new Date(dayStart + UT * 3600000) };
}

function calculate({ year, month, day, lat, lon }) {
    return {
        sunrise: solarEventUTC(year, month, day, lat, lon, true),
        sunset: solarEventUTC(year, month, day, lat, lon, false)
    };
}

module.exports = { calculate };
