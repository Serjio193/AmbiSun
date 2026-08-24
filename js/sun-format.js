(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  const sunFormat = window.AmbiSun.sunFormat = window.AmbiSun.sunFormat || {};

  sunFormat.formatOffset = function (value, withParens) {
    const unit = (AmbiSun.i18n && AmbiSun.i18n.t)
      ? AmbiSun.i18n.t('unit.minuteShort', 'min') : 'min';
    if (value == null) return withParens ? '' : '+0 ' + unit;
    const sign = value >= 0 ? '+' : '';
    const text = sign + value + ' ' + unit;
    return withParens ? '(' + text + ')' : text;
  };
}());
