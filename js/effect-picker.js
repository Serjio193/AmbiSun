(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  var CAPTURE = "capture";
  var currentSourceId = null;
  var isDefaultMode = false;

  function t(key, fallback) {
    return AmbiSun.i18n && AmbiSun.i18n.t ? AmbiSun.i18n.t(key, fallback) : fallback;
  }

  function effectLabel(name) {
    var music = /^Music:\s*(.+)$/i.exec(name || "");
    if (!music) return name;
    return music[1]
      .replace(/^fullscreen pulse\s*/i, "Pulse ")
      .replace(/^pulse waves for LED strip\s*/i, "Waves ")
      .replace(/^quatro for LED strip\s*/i, "Quatro ")
      .replace(/^stereo for LED strip\s*/i, "Stereo ")
      .replace(/^equalizer test \(turn on video preview\)$/i, "Equalizer")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function valueLabel(value) {
    return value === CAPTURE ? t("sources.screenCapture", "Screen capture") : effectLabel(value);
  }

  function currentValue(sourceId) {
    var rule = (AmbiSun.state.effectOverrides || {})[sourceId];
    return rule && rule.mode === "effect" && rule.name ? rule.name : CAPTURE;
  }

  function selectedValue() {
    return isDefaultMode ? (AmbiSun.state.defaultEffect || CAPTURE) : currentValue(currentSourceId);
  }

  function items() {
    var effects = (AmbiSun.state.hyperhdrEffects || []).slice();
    var result = [{ value: CAPTURE, label: valueLabel(CAPTURE) }];
    effects.filter(function (name) { return !/^Music:/i.test(name); }).forEach(function (name) {
      result.push({ value: name, label: effectLabel(name) });
    });
    var music = effects.filter(function (name) { return /^Music:/i.test(name); });
    if (music.length) {
      result.push({ group: true, label: t("sources.musicEffects", "Music effects") });
      music.forEach(function (name) { result.push({ value: name, label: effectLabel(name) }); });
    }
    return result;
  }

  function ensureScreen() {
    var screen = document.getElementById("effectPicker");
    if (screen) return screen;
    screen = document.createElement("section");
    screen.id = "effectPicker";
    screen.className = "screen";
    screen.innerHTML =
      '<div class="simple-page effect-picker-page">' +
        '<div class="card page-card effect-picker-card">' +
          '<div class="effect-picker-head">' +
            '<div class="effect-picker-title" id="effectPickerTitle"></div>' +
            '<button type="button" class="effect-picker-back actionable" data-action="close-effect-picker">' +
              '<span aria-hidden="true">←</span> ' +
              '<span data-i18n="common.back">Back</span>' +
            '</button>' +
          '</div>' +
          '<div class="effect-picker-list list" id="effectPickerList"></div>' +
        '</div>' +
      '</div>';
    document.querySelector("main.main").appendChild(screen);
    return screen;
  }

  function render() {
    var list = document.getElementById("effectPickerList");
    var title = document.getElementById("effectPickerTitle");
    if (!list || !title) return;
    title.textContent = isDefaultMode
      ? t("settings.defaultEffectTitle", "Favorite effect")
      : t("sources.effectPickerTitle", "Select effect");
    list.innerHTML = "";
    var selected = selectedValue();
    var values = items();
    if (!values.length) {
      var empty = document.createElement("div");
      empty.className = "source-empty";
      empty.textContent = t("status.noEffects", "No effects available");
      list.appendChild(empty);
      return;
    }
    values.forEach(function (item) {
      if (item.group) {
        var heading = document.createElement("div");
        heading.className = "effect-picker-group";
        heading.textContent = item.label;
        list.appendChild(heading);
        return;
      }
      var row = document.createElement("div");
      row.className = "list-item actionable effect-picker-item" + (item.value === selected ? " selected" : "");
      row.dataset.action = "select-source-effect";
      row.dataset.effect = item.value;
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "-1");
      var radio = document.createElement("span");
      radio.className = "effect-picker-radio";
      radio.textContent = item.value === selected ? "◉" : "○";
      radio.setAttribute("aria-hidden", "true");
      var label = document.createElement("span");
      label.className = "effect-picker-label";
      label.textContent = item.label;
      row.appendChild(radio);
      row.appendChild(label);
      list.appendChild(row);
    });
  }

  function open(sourceId) {
    isDefaultMode = false;
    currentSourceId = sourceId;
    ensureScreen();
    AmbiSun.navigation.openScreen("effectPicker");
    render();
    var first = document.querySelector("#effectPickerList .effect-picker-item");
    if (first && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(first);
  }

  function openDefault() {
    isDefaultMode = true;
    currentSourceId = null;
    ensureScreen();
    AmbiSun.navigation.openScreen("effectPicker");
    render();
    var first = document.querySelector("#effectPickerList .effect-picker-item");
    if (first && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(first);
  }

  function close() {
    var source = currentSourceId;
    var returnScreen = isDefaultMode ? "settings" : "sources";
    AmbiSun.navigation.openScreen(returnScreen);
    currentSourceId = null;
    if (isDefaultMode) {
      isDefaultMode = false;
      var defaultButton = document.querySelector('[data-action="open-default-effect"]');
      if (defaultButton && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(defaultButton);
      return;
    }
    var row = null;
    if (source) {
      Array.prototype.forEach.call(document.querySelectorAll(".source-row"), function (candidate) {
        if (!row && candidate.dataset.source === source) row = candidate;
      });
    }
    if (row && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(row);
  }

  function select(value) {
    if (!value) return;
    if (isDefaultMode) {
      if (AmbiSun.app && AmbiSun.app.setDefaultEffect) AmbiSun.app.setDefaultEffect(value);
    } else if (currentSourceId) {
      if (AmbiSun.app && AmbiSun.app.setSourceEffect) AmbiSun.app.setSourceEffect(currentSourceId, value);
    } else {
      return;
    }
    close();
  }

  AmbiSun.effectPicker = { open: open, openDefault: openDefault, close: close, select: select, label: valueLabel, render: render };
})();
