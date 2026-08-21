(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.sources = AmbiSun.sources || {};

  var CAPTURE = "capture";
  var EFFECT_TTL = 60000;
  var effectsRequest = null;

  function t(key, fallback) {
    return AmbiSun.i18n && AmbiSun.i18n.t ? AmbiSun.i18n.t(key, fallback) : fallback;
  }

  function ruleLabel(rule) {
    if (rule === "on") return t("rule.on", "Always ON");
    if (rule === "off") return t("rule.off", "Always OFF");
    return t("rule.sun", "By sun");
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
        parent.textContent = source.type === "hdmi" ? "🎮" : "▣";
      };
      parent.appendChild(image);
      return;
    }
    parent.textContent = source.type === "hdmi" ? "🎮" : "▣";
  }

  function getObservedSources() {
    try {
      var saved = localStorage.getItem("ambisun.observedSources");
      return saved ? JSON.parse(saved) : [];
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

  function updateDefaultRule() {
    var rule = AmbiSun.state.defaultRule || "sun";
    document.querySelectorAll("[data-default-rule-badge]").forEach(function (badge) {
      badge.textContent = ruleLabel(rule);
      badge.className = "mode " + (rule === "sun" ? "sun" : rule);
    });
  }

  function updateDefaultEffect() {
    var button = document.querySelector('[data-action="open-default-effect"]');
    if (!button) return;
    var value = AmbiSun.state.defaultEffect || "capture";
    button.textContent = (AmbiSun.effectPicker && AmbiSun.effectPicker.label ? AmbiSun.effectPicker.label(value) : value) + " ›";
  }

  function sourceEntries() {
    var entries = [];
    var seen = {};
    (AmbiSun.state.sourceCatalog || []).forEach(function (source) {
      if (!source || !source.id || seen[source.id]) return;
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
    [["sun", ruleLabel("sun")], ["on", ruleLabel("on")], ["off", ruleLabel("off")]].forEach(function (item) { addOption(select, item[0], item[1]); });
    select.value = rule;
    select.addEventListener("click", function (event) { event.stopPropagation(); });
    select.addEventListener("change", function (event) {
      event.stopPropagation();
      if (AmbiSun.app && AmbiSun.app.setSourceRule) AmbiSun.app.setSourceRule(source.id, select.value);
    });
    return select;
  }

  function effectSelect(source, effectRule) {
    var selected = effectRule && effectRule.mode === "effect" ? effectRule.name : CAPTURE;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "source-control source-effect-button actionable";
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
    button.className = "source-hide-button actionable";
    button.dataset.action = "toggle-source-hidden";
    button.dataset.source = source.id;
    button.dataset.hidden = hidden ? "true" : "false";
    button.title = hidden ? t("sources.showApp", "Show application") : t("sources.hideApp", "Hide application");
    button.setAttribute("aria-label", button.title);
    button.innerHTML = hidden ? "<span aria-hidden=\"true\">◉</span>" : "<span aria-hidden=\"true\">◉̸</span>";
    return button;
  }

  function makeRow(source, hidden) {
    var rules = AmbiSun.state.sourceRules || {};
    var effects = AmbiSun.state.effectOverrides || {};
    var rule = Object.prototype.hasOwnProperty.call(rules, source.id) ? rules[source.id] : (AmbiSun.state.defaultRule || "sun");
    var row = document.createElement("div");
    row.className = "list-item actionable source-row";
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
    row.appendChild(ruleSelect(source, Object.prototype.hasOwnProperty.call(rules, source.id) ? rules[source.id] : (AmbiSun.state.defaultRule || "sun")));
    row.appendChild(effectSelect(source, effects[source.id] || { mode: CAPTURE }));
    row.appendChild(actionButton(source, hidden));
    return row;
  }

  function renderSourceList() {
    var list = document.getElementById("sourceList");
    if (!list) return;
    var oldScrollTop = list.scrollTop;
    var focused = AmbiSun.navigation && AmbiSun.navigation.getFocusedElement ? AmbiSun.navigation.getFocusedElement() : null;
    var focusedSource = focused && focused.dataset ? focused.dataset.source : null;
    var entries = sourceEntries();
    var hiddenMap = AmbiSun.state.hiddenSources || {};
    var showHidden = !!AmbiSun.state.showHiddenSources;
    var visible = entries.filter(function (source) { return !!hiddenMap[source.id] === showHidden; });
    list.innerHTML = "";

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
    list.appendChild(toolbar);

    if (!visible.length) {
      var empty = document.createElement("div");
      empty.className = "source-empty";
      empty.textContent = showHidden ? t("sources.noHidden", "There are no hidden applications") : t("sources.pressOkToLoad", "Press OK to load sources");
      list.appendChild(empty);
      return;
    }

    var hdmi = visible.filter(function (source) { return source.type === "hdmi"; });
    var apps = visible.filter(function (source) { return source.type !== "hdmi"; });
    function section(title, items) {
      if (!items.length) return;
      var header = document.createElement("div");
      header.className = "source-section-header";
      header.textContent = title;
      list.appendChild(header);
      items.forEach(function (source) { list.appendChild(makeRow(source, showHidden)); });
    }
    section(t("sources.hdmiInputs", "HDMI inputs"), hdmi);
    section(t("sources.apps", "Applications"), apps);
    list.scrollTop = oldScrollTop;
    if (focusedSource && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
      var nextFocus = list.querySelector('.source-row[data-source="' + focusedSource + '"]');
      if (nextFocus) AmbiSun.navigation.setFocus(nextFocus);
    }
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
        renderSourceList();
      }
      return AmbiSun.state.hyperhdrEffects || [];
    }).catch(function () { return AmbiSun.state.hyperhdrEffects || []; }).finally(function () { effectsRequest = null; });
    return effectsRequest;
  }

  AmbiSun.sources.ruleLabel = ruleLabel;
  AmbiSun.sources.cycleRule = cycleRule;
  AmbiSun.sources.updateDefaultRule = updateDefaultRule;
  AmbiSun.sources.updateDefaultEffect = updateDefaultEffect;
  AmbiSun.sources.addObservedSource = addObservedSource;
  AmbiSun.sources.renderSourceList = renderSourceList;
  AmbiSun.sources.refreshEffects = refreshEffects;
})();
