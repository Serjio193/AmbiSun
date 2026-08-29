(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.sources = AmbiSun.sources || {};

  var CAPTURE = "capture";
  var EFFECT_TTL = 60000;
  var effectsRequest = null;
  var applicationPage = 0;
  var BRIGHTNESS_STEP = 5;
  var BRIGHTNESS_PREVIEW_MS = 10000;
  var APPLICATIONS_PER_PAGE = 10;
  var LIVE_TV_SOURCE_IDS = ["com.webos.app.livetv", "com.webos.app.livetvopapp"];

  function t(key, fallback) {
    return AmbiSun.i18n && AmbiSun.i18n.t ? AmbiSun.i18n.t(key, fallback) : fallback;
  }

  function ruleLabel(rule) {
    if (rule === "default") return t("rule.default", "Disabled");
    if (rule === "on") return t("rule.on", "Always ON");
    if (rule === "off") return t("rule.off", "Always OFF");
    return t("rule.sun", "By sun");
  }

  function ruleHint(rule) {
    var isRussian = AmbiSun.i18n && AmbiSun.i18n.currentLanguage &&
      AmbiSun.i18n.currentLanguage() === "ru";
    if (rule === "default") {
      return isRussian
        ? "Индивидуальное правило отключено. Используется общий режим."
        : "Individual rule disabled. The global mode is used.";
    }
    if (rule === "on") {
      return isRussian
        ? "Подсветка всегда включена для этого источника."
        : "Lighting is always on for this source.";
    }
    if (rule === "off") {
      return isRussian
        ? "Подсветка всегда выключена для этого источника."
        : "Lighting is always off for this source.";
    }
    return isRussian
      ? "Подсветка работает по солнцу: от заката до рассвета."
      : "Lighting follows the sun: from sunset to sunrise.";
  }

  function cycleRule(current, direction) {
    var rules = AmbiSun.constants.RULES;
    var index = rules.indexOf(current);
    if (index < 0) index = 1;
    return rules[(index + (direction == null ? 1 : direction) + rules.length) % rules.length];
  }

  function iconFor(source, parent) {
    if (source.icon) {
      var image = document.createElement("img");
      image.className = "source-icon-image";
      image.alt = "";
      image.src = source.icon;
      image.onerror = function () {
        image.remove();
        parent.textContent = source.type === "hdmi" ? "🎮" : (source.type === "tv" ? "📺" : "▣");
      };
      parent.appendChild(image);
      return;
    }
    parent.textContent = source.type === "hdmi" ? "🎮" : (source.type === "tv" ? "📺" : "▣");
  }

  function getObservedSources() {
    try {
      var saved = localStorage.getItem("ambisun.observedSources");
      var sources = saved ? JSON.parse(saved) : [];
      return sources.filter(function (source) {
        return source && LIVE_TV_SOURCE_IDS.indexOf(source.id) === -1;
      });
    } catch (_) { return []; }
  }

  function addObservedSource(source) {
    if (!source || source.type === "unknown" || !source.id) return;
    var sources = getObservedSources();
    var index = sources.findIndex(function (item) { return item.id === source.id; });
    var cachedIcon = source.icon && !/^data:image\//i.test(source.icon) ? source.icon : null;
    var item = { id: source.id, label: source.name || source.id, type: source.type, icon: cachedIcon, lastSeenAt: Date.now() };
    if (index >= 0) sources[index] = Object.assign({}, sources[index], item);
    else sources.push(item);
    if (sources.length > 100) sources = sources.slice(-100);
    try { localStorage.setItem("ambisun.observedSources", JSON.stringify(sources)); } catch (_) {}
  }

  function updateDefaultEffect() {
    var buttons = document.querySelectorAll('[data-action="open-default-effect"]');
    if (!buttons.length) return;
    var value = AmbiSun.state.defaultEffect || "capture";
    var label = (AmbiSun.effectPicker && AmbiSun.effectPicker.label ? AmbiSun.effectPicker.label(value) : value) + " ›";
    buttons.forEach(function (button) { button.textContent = label; });
  }

  function adjustBrightness(sourceId, direction) {
    if (!sourceId || typeof window.setSourceBrightness !== "function") return;
    var overrides = AmbiSun.state.sourceBrightness || {};
    var rules = AmbiSun.state.sourceRules || {};
    var hasRule = Object.prototype.hasOwnProperty.call(rules, sourceId);
    var rule = hasRule ? rules[sourceId] : (AmbiSun.state.defaultRule || "sun");
    if (!hasRule || rule === "off") return;
    var current = Object.prototype.hasOwnProperty.call(overrides, sourceId)
      ? overrides[sourceId] : AmbiSun.state.brightness;
    var delta = Number(direction) >= 0 ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP;
    var next = Math.max(0, Math.min(100, Math.round(Number(current) || 0) + delta));
    var focusedBefore = AmbiSun.navigation && AmbiSun.navigation.getFocusedElement
      ? AmbiSun.navigation.getFocusedElement() : null;
    var shouldRestoreFocus = !!(focusedBefore && focusedBefore.dataset && focusedBefore.dataset.source === sourceId);
    window.setSourceBrightness(sourceId, next, function () {
      if (rule !== "off") previewSelectedEffect(sourceId, next);
    });
    if (shouldRestoreFocus) {
      var restoreFocus = function () {
        var focused = AmbiSun.navigation && AmbiSun.navigation.getFocusedElement
          ? AmbiSun.navigation.getFocusedElement() : null;
        if (focused && focused.dataset && focused.dataset.source !== sourceId) return;
        var row = Array.prototype.find.call(document.querySelectorAll(".source-row"), function (candidate) {
          return candidate.dataset.source === sourceId;
        });
        if (row && AmbiSun.navigation && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(row);
      };
      window.requestAnimationFrame(restoreFocus);
      window.setTimeout(restoreFocus, 350);
    }
  }

  function previewSelectedEffect(sourceId, brightness) {
    var override = (AmbiSun.state.effectOverrides || {})[sourceId];
    var effectName = override
      ? (override.mode === "effect" ? override.name : null)
      : AmbiSun.state.defaultEffect;
    if (!effectName || !AmbiSun.webos || !AmbiSun.webos.previewHyperhdrEffect) return;
    AmbiSun.webos.previewHyperhdrEffect(effectName, BRIGHTNESS_PREVIEW_MS, brightness).catch(function () {});
  }

  function sourceEntries() {
    var entries = [];
    var seen = {};
    (AmbiSun.state.sourceCatalog || []).forEach(function (source) {
      if (!source || !source.id || seen[source.id]) return;
      if (LIVE_TV_SOURCE_IDS.indexOf(source.id) !== -1) return;
      entries.push({ id: source.id, name: source.name || source.id, type: source.type || "app", icon: source.icon || null, current: !!source.current });
      seen[source.id] = true;
    });
    getObservedSources().forEach(function (source) {
      if (!source || !source.id || seen[source.id]) return;
      entries.push({ id: source.id, name: source.label || source.id, type: source.type || "app", icon: source.icon || null, current: false });
      seen[source.id] = true;
    });
    [AmbiSun.state.sourceRules || {}, AmbiSun.state.effectOverrides || {}, AmbiSun.state.hiddenSources || {}].forEach(function (map) {
      Object.keys(map).forEach(function (id) {
        if (LIVE_TV_SOURCE_IDS.indexOf(id) !== -1) return;
        if (seen[id]) return;
        entries.push({ id: id, name: id, type: "app", icon: null, current: false });
        seen[id] = true;
      });
    });
    var current = AmbiSun.state.currentSource;
    if (current && current.id) entries.forEach(function (source) { source.current = source.id === current.id; });
    return entries;
  }

  function addOption(select, value, label) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function ruleSelect(source, rule) {
    var select = document.createElement("select");
    select.className = "source-control source-rule-select";
    select.setAttribute("aria-label", t("sources.ruleFor", "Lighting rule for") + " " + source.name);
    select.title = ruleHint(rule);
    addOption(select, "default", ruleLabel("default"));
    [["sun", ruleLabel("sun")], ["on", ruleLabel("on")], ["off", ruleLabel("off")]].forEach(function (item) { addOption(select, item[0], item[1]); });
    select.value = rule;
    select.addEventListener("click", function (event) { event.stopPropagation(); });
    select.addEventListener("change", function (event) {
      event.stopPropagation();
      if (AmbiSun.app && AmbiSun.app.setSourceRule) AmbiSun.app.setSourceRule(source.id, select.value);
      select.title = ruleHint(select.value);
    });
    return select;
  }

  function effectSelect(source, effectRule) {
    var selected = effectRule && effectRule.mode === "effect" ? effectRule.name : CAPTURE;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "source-control source-effect-button windows-action-button actionable";
    button.dataset.action = "open-source-effect";
    button.dataset.source = source.id;
    button.setAttribute("aria-label", t("sources.effectFor", "Effect for") + " " + source.name);
    button.textContent = AmbiSun.effectPicker && AmbiSun.effectPicker.label ?
      AmbiSun.effectPicker.label(selected) : selected;
    return button;
  }

  function actionButton(source, hidden) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "source-hide-button windows-action-button actionable";
    button.dataset.action = "toggle-source-hidden";
    button.dataset.source = source.id;
    button.dataset.hidden = hidden ? "true" : "false";
    button.title = hidden ? t("sources.showApp", "Show application") : t("sources.hideApp", "Hide application");
    button.setAttribute("aria-label", button.title);
    button.innerHTML = hidden ? "<span aria-hidden=\"true\">◉</span>" : "<span aria-hidden=\"true\">◉̸</span>";
    return button;
  }

  function brightnessControl(source, rule, hasRule) {
    var values = AmbiSun.state.sourceBrightness || {};
    var globalBrightness = Number.isFinite(Number(AmbiSun.state.brightness)) ? Number(AmbiSun.state.brightness) : 50;
    var brightness = Object.prototype.hasOwnProperty.call(values, source.id) ? values[source.id] : globalBrightness;
    brightness = Math.max(0, Math.min(100, Math.round(Number(brightness) || 0)));
    var wrap = document.createElement("div");
    wrap.className = "source-brightness-control";
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.className = "source-brightness-slider";
    slider.dataset.brightnessSource = source.id;
    slider.value = String(brightness);
    slider.title = "Яркость приложения";
    slider.setAttribute("aria-label", "Яркость приложения " + source.name);
    var badge = document.createElement("span");
    badge.className = "source-brightness-value";
    badge.textContent = brightness + "%";
    slider.addEventListener("click", function (event) { event.stopPropagation(); });
    slider.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    slider.addEventListener("input", function (event) {
      event.stopPropagation();
      var next = Math.max(0, Math.min(100, Math.round(Number(slider.value) || 0)));
      badge.textContent = next + "%";
      if (typeof window.setSourceBrightness === "function") {
        window.setSourceBrightness(source.id, next, function () {
          previewSelectedEffect(source.id, next);
        });
      }
    });
    wrap.appendChild(slider);
    var test = document.createElement("button");
    test.type = "button";
    test.className = "windows-action-button actionable brightness-test-source-button";
    test.dataset.action = "open-brightness-test";
    test.dataset.brightnessScope = "source";
    test.dataset.source = source.id;
    test.textContent = t("settings.brightnessTest", "Test capture brightness");
    test.title = t("settings.brightnessTestDescription", "Maximum brightness during capture with a full white frame");
    wrap.appendChild(test);
    wrap.appendChild(badge);
    return wrap;
  }

  function makeRow(source, hidden) {
    var rules = AmbiSun.state.sourceRules || {};
    var effects = AmbiSun.state.effectOverrides || {};
    var hasRule = Object.prototype.hasOwnProperty.call(rules, source.id);
    var rule = hasRule ? rules[source.id] : (AmbiSun.state.defaultRule || "sun");
    var showSourceSettings = hasRule && rule !== "off";
    var row = document.createElement("div");
    row.className = "list-item actionable source-row";
    if (!showSourceSettings) row.classList.add("source-row-settings-hidden");
    row.dataset.action = "cycle-source-rule";
    row.dataset.source = source.id;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "-1");

    var icon = document.createElement("span");
    icon.className = "source-icon";
    iconFor(source, icon);
    row.appendChild(icon);

    var label = document.createElement("span");
    label.className = "source-name";
    label.textContent = source.name || source.id;
    if (source.current) {
      var dot = document.createElement("span");
      dot.className = "current-dot";
      dot.textContent = " ●";
      label.appendChild(dot);
    }
    row.appendChild(label);
    row.appendChild(ruleSelect(source, hasRule ? rules[source.id] : "default"));
    if (showSourceSettings) {
      row.appendChild(effectSelect(source, effects[source.id] || { mode: CAPTURE }));
      row.appendChild(brightnessControl(source, rule, hasRule));
    }
    row.appendChild(actionButton(source, hidden));
    return row;
  }

  function sourceToolbar(showHidden) {
    var toolbar = document.createElement("div");
    toolbar.className = "source-toolbar";
    var hint = document.createElement("span");
    hint.textContent = showHidden ? t("sources.hiddenList", "Hidden applications") : t("sources.hint", "Choose a rule and effect for each application");
    toolbar.appendChild(hint);
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "source-hidden-toggle actionable";
    toggle.dataset.action = "toggle-hidden-sources";
    toggle.textContent = showHidden ? t("sources.showApps", "Show applications") : t("sources.showHidden", "Show hidden");
    toolbar.appendChild(toggle);
    return toolbar;
  }

  function pageButton(action, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "windows-action-button actionable";
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function applyApplicationPage(list, page) {
    var state = list && list._applicationPageState;
    if (!state) return null;
    state.page = Math.max(0, Math.min(page, state.pageCount - 1));
    state.rows.forEach(function (row, index) {
      row.style.display = Math.floor(index / state.pageSize) !== state.page ? "none" : "";
    });
    state.prevButton.style.display = state.page === 0 ? "none" : "";
    state.nextButton.style.display = state.page + 1 >= state.pageCount ? "none" : "";
    return state;
  }

  function renderSourceListInto(list, entries, showHidden, paginate) {
    if (!list) return;
    var oldScrollTop = list.scrollTop;
    var oldVisibility = list.style.visibility;
    list.style.visibility = "hidden";
    try {
      var toolbar = sourceToolbar(showHidden);
      list.innerHTML = "";
      list.appendChild(toolbar);

      if (!entries.length) {
        var empty = document.createElement("div");
        empty.className = "source-empty";
        empty.textContent = showHidden ? t("sources.noHidden", "There are no hidden applications") : t("sources.pressOkToLoad", "Press OK to load sources");
        list.appendChild(empty);
        return;
      }

      var rows = entries.map(function (source) { return makeRow(source, showHidden); });
      rows.forEach(function (row) { list.appendChild(row); });
      list._applicationPageState = null;

      if (paginate && entries.length > APPLICATIONS_PER_PAGE) {
        var pageSize = APPLICATIONS_PER_PAGE;
        var pageCount = Math.ceil(entries.length / pageSize);
        var footer = document.createElement("div");
        footer.className = "source-page-footer";
        var previous = pageButton("source-page-prev", t("sources.previousPage", "Previous page"));
        var next = pageButton("source-page-next", t("sources.nextPage", "Next page"));
        footer.appendChild(previous);
        footer.appendChild(next);
        list.appendChild(footer);
        list._applicationPageState = {
          rows: rows,
          pageSize: pageSize,
          pageCount: pageCount,
          prevButton: previous,
          nextButton: next
        };
        applyApplicationPage(list, applicationPage);
      }
    } finally {
      list.style.visibility = oldVisibility;
      list.scrollTop = oldScrollTop;
    }
  }

  function visibleSourceGroups() {
    var entries = sourceEntries();
    var hiddenMap = AmbiSun.state.hiddenSources || {};
    var showHidden = !!AmbiSun.state.showHiddenSources;
    var visible = entries.filter(function (source) { return !!hiddenMap[source.id] === showHidden; });
    return {
      showHidden: showHidden,
      inputSources: visible.filter(function (source) { return source.type === "hdmi" || source.type === "tv"; }),
      apps: visible.filter(function (source) { return source.type !== "hdmi" && source.type !== "tv"; })
    };
  }

  function renderSourceList() {
    var focused = AmbiSun.navigation && AmbiSun.navigation.getFocusedElement ? AmbiSun.navigation.getFocusedElement() : null;
    var focusedSource = focused && focused.dataset ? focused.dataset.source : null;
    var groups = visibleSourceGroups();
    renderSourceListInto(document.getElementById("sourceListHdmi"), groups.inputSources, groups.showHidden, false);
    renderSourceListInto(document.getElementById("sourceListApps"), groups.apps, groups.showHidden, true);
    if (focusedSource && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
      var nextFocus = Array.from(document.querySelectorAll('.source-row')).find(function (row) {
        return row.dataset.source === focusedSource;
      });
      if (nextFocus) AmbiSun.navigation.setFocus(nextFocus);
    }
  }

  function changeApplicationPage(direction) {
    var list = document.getElementById("sourceListApps");
    var state = list && list._applicationPageState;
    if (!state) return;
    applicationPage = Math.max(0, applicationPage + (direction > 0 ? 1 : -1));
    list.classList.add("source-page-switching");
    clearTimeout(list._sourcePageSwitchTimer);
    list._sourcePageSwitchTimer = setTimeout(function () {
      list.classList.remove("source-page-switching");
    }, 260);
    applyApplicationPage(list, applicationPage);
    var button = direction > 0 && state.page + 1 < state.pageCount ? state.nextButton : state.prevButton;
    if (button && button.style.display === "none") button = state.nextButton.style.display === "none" ? state.prevButton : state.nextButton;
    var focused = AmbiSun.navigation && AmbiSun.navigation.getFocusedElement
      ? AmbiSun.navigation.getFocusedElement() : null;
    if (button && focused !== button && AmbiSun.navigation && AmbiSun.navigation.setFocus) AmbiSun.navigation.setFocus(button);
  }

  function refreshEffects(force) {
    var now = Date.now();
    if (!force && AmbiSun.state.hyperhdrEffects && now - (AmbiSun.state.hyperhdrEffectsAt || 0) < EFFECT_TTL) return Promise.resolve(AmbiSun.state.hyperhdrEffects);
    if (effectsRequest) return effectsRequest;
    if (!AmbiSun.webos || !AmbiSun.webos.getHyperhdrEffects) return Promise.resolve([]);
    effectsRequest = AmbiSun.webos.getHyperhdrEffects().then(function (res) {
      if (res && res.returnValue && Array.isArray(res.effects)) {
        AmbiSun.state.hyperhdrEffects = res.effects;
        AmbiSun.state.hyperhdrEffectsAt = Date.now();
      }
      return AmbiSun.state.hyperhdrEffects || [];
    }).catch(function () { return AmbiSun.state.hyperhdrEffects || []; }).finally(function () { effectsRequest = null; });
    return effectsRequest;
  }

  AmbiSun.sources.ruleLabel = ruleLabel;
  AmbiSun.sources.cycleRule = cycleRule;
  AmbiSun.sources.updateDefaultEffect = updateDefaultEffect;
  AmbiSun.sources.adjustBrightness = adjustBrightness;
  AmbiSun.sources.addObservedSource = addObservedSource;
  AmbiSun.sources.renderSourceList = renderSourceList;
  AmbiSun.sources.changeApplicationPage = changeApplicationPage;
  AmbiSun.sources.refreshEffects = refreshEffects;
})();
