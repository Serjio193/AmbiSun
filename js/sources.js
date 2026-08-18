(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.sources = AmbiSun.sources || {};

  function ruleLabel(rule) {
    if (rule === 'on')  return AmbiSun.i18n.t('rule.on',  'Always ON');
    if (rule === 'off') return AmbiSun.i18n.t('rule.off', 'Always OFF');
    return AmbiSun.i18n.t('rule.sun', 'By sun');
  }

  function cycleRule(current, direction) {
    var d = (direction == null) ? 1 : direction;
    var RULES = window.AmbiSun.constants.RULES;
    var i = RULES.indexOf(current);
    if (i < 0) i = 1;
    return RULES[(i + d + RULES.length) % RULES.length];
  }

  function updateDefaultRule() {
    var rule = window.AmbiSun.state.defaultRule || 'sun';
    document.querySelectorAll('[data-default-rule-badge]').forEach(function(badge) {
      badge.textContent = ruleLabel(rule);
      badge.className = 'mode ' + (rule === 'sun' ? 'sun' : rule);
    });
  }

  // ---- LocalStorage observed cache ----
  function getObservedSources() {
    try {
      var saved = localStorage.getItem('ambisun.observedSources');
      return saved ? JSON.parse(saved) : [];
    } catch(_) { return []; }
  }

  function addObservedSource(source) {
    if (!source || source.type === 'unknown' || !source.id) return;
    var id = source.id;
    if (id.startsWith('com.webos.app.hdmi')) id = 'HDMI_' + id.replace('com.webos.app.hdmi', '');
    var sources = getObservedSources();
    var idx = sources.findIndex(function(s) { return s.id === id; });
    if (idx >= 0) {
      sources[idx].label = source.name || id;
      sources[idx].lastSeenAt = Date.now();
    } else {
      sources.push({ id: id, label: source.name || id, type: source.type, lastSeenAt: Date.now() });
    }
    if (sources.length > 100) sources = sources.slice(0, 100);
    try { localStorage.setItem('ambisun.observedSources', JSON.stringify(sources)); } catch(_) {}
  }

  // ---- Render sources list ----
  function renderSourceList() {
    var list = document.getElementById('sourceList');
    if (!list) return;

    var overrides = window.AmbiSun.state.sourceRules || {};
    var defaultRule = window.AmbiSun.state.defaultRule || 'sun';
    var currentSource = window.AmbiSun.state.currentSource || null;

    // Build entry list — backend catalog is primary
    var entries = [];
    var seen = {};

    var catalog = window.AmbiSun.state.sourceCatalog;
    if (catalog && catalog.length > 0) {
      catalog.forEach(function(s) {
        if (!seen[s.id]) {
          entries.push({ id: s.id, name: s.name, type: s.type, current: !!s.current });
          seen[s.id] = true;
        }
      });
    }

    // Fill from localStorage cache
    getObservedSources().forEach(function(s) {
      if (!seen[s.id]) {
        entries.push({ id: s.id, name: s.label || s.id, type: s.type || 'app', current: false });
        seen[s.id] = true;
      }
    });

    // Any override IDs not yet listed
    Object.keys(overrides).forEach(function(id) {
      if (!seen[id]) {
        entries.push({ id: id, name: id, type: 'app', current: false });
        seen[id] = true;
      }
    });

    // Mark current source
    if (currentSource && currentSource.id && currentSource.type !== 'unknown') {
      var cid = currentSource.id;
      if (cid.startsWith('com.webos.app.hdmi')) cid = 'HDMI_' + cid.replace('com.webos.app.hdmi', '');
      entries.forEach(function(e) { e.current = (e.id === cid); });
    }

    var oldScrollTop = list.scrollTop;
    var focusedEl = AmbiSun.navigation && AmbiSun.navigation.getFocusedElement ? AmbiSun.navigation.getFocusedElement() : null;
    var focusedSourceId = (focusedEl && focusedEl.closest && focusedEl.closest('#sourceList') && focusedEl.dataset) ? focusedEl.dataset.source : null;

    list.innerHTML = '';

    if (entries.length === 0) {
      var loadSourcesText = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('sources.pressOkToLoad', 'Press OK to load sources') : 'Press OK to load sources';
      list.innerHTML = '<div style="padding:32px;color:var(--muted);font-size:18px;text-align:center">' +
        loadSourcesText + '</div>';
      return;
    }

    // Split HDMI / Apps
    var hdmi = entries.filter(function(e) { return e.type === 'hdmi'; });
    var apps = entries.filter(function(e) { return e.type !== 'hdmi'; });

    function makeSection(title, items) {
      if (!items.length) return;
      var hdr = document.createElement('div');
      hdr.className = 'source-section-header';
      hdr.textContent = title;
      list.appendChild(hdr);

      items.forEach(function(s) {
        var hasOverride = Object.prototype.hasOwnProperty.call(overrides, s.id);
        var rule = hasOverride ? overrides[s.id] : defaultRule;

        var item = document.createElement('div');
        item.className = 'list-item actionable';
        item.dataset.action = 'cycle-source-rule';
        item.dataset.source = s.id;
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '-1');

        var icon = document.createElement('span');
        icon.textContent = s.type === 'hdmi' ? '🎮' : '▶';
        item.appendChild(icon);

        var label = document.createElement('span');
        label.style.flex = '1';
        label.textContent = s.name || s.id;
        if (s.current) {
          var dot = document.createElement('span');
          dot.className = 'current-dot';
          dot.textContent = ' ●';
          label.appendChild(dot);
        }
        item.appendChild(label);

        var badge = document.createElement('span');
        badge.className = 'mode ' + (rule === 'sun' ? 'sun' : rule);
        badge.textContent = ruleLabel(rule);
        item.appendChild(badge);

        list.appendChild(item);
      });
    }

    var hdmiTitle = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('sources.hdmiInputs', 'HDMI inputs') : 'HDMI inputs';
    var appsTitle = (AmbiSun.i18n && AmbiSun.i18n.t) ? AmbiSun.i18n.t('sources.apps', 'Applications') : 'Applications';
    makeSection(hdmiTitle, hdmi);
    makeSection(appsTitle, apps);

    list.scrollTop = oldScrollTop;

    if (focusedSourceId) {
      var toFocus = list.querySelector('.list-item[data-source="' + focusedSourceId + '"]');
      if (toFocus && AmbiSun.navigation && AmbiSun.navigation.setFocus) {
        AmbiSun.navigation.setFocus(toFocus);
      }
    }
  }

  AmbiSun.sources.ruleLabel = ruleLabel;
  AmbiSun.sources.cycleRule = cycleRule;
  AmbiSun.sources.updateDefaultRule = updateDefaultRule;
  AmbiSun.sources.addObservedSource = addObservedSource;
  AmbiSun.sources.renderSourceList = renderSourceList;
})();
