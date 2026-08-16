(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.navigation = AmbiSun.navigation || {};

  let focusedEl = null;
  let actionHandler = null;
  let backHandler = null;

  function setActionHandler(fn) {
    actionHandler = fn;
  }

  function setBackHandler(fn) {
    backHandler = typeof fn === 'function' ? fn : null;
  }

  function activate(el, direction = 1) {
    if (!el) return;
    setFocus(el);
    if (actionHandler) {
      actionHandler(el, direction);
    }
  }

  function openScreen(id) {
    const screenEl = document.getElementById(id);
    if (!screenEl || !screenEl.classList.contains('screen')) return;

    window.AmbiSun.state.screen = id;
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.toggle('active', s.id === id);
    });
    
    const titleEl = document.getElementById('screenTitle');
    if (titleEl) {
      // Use i18n key convention nav.{id}
      titleEl.textContent = AmbiSun.i18n.t('nav.' + id, id);
    }

    const nav = document.querySelector(`.nav-item[data-screen="${id}"]`);
    if (nav) setFocus(nav);

    // Notify bridge to refresh data for this screen
    if (AmbiSun.bridge && AmbiSun.bridge.onScreenOpen) {
      AmbiSun.bridge.onScreenOpen(id);
    }
  }

  function isVisible(el) {
    return !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }

  function visibleActions() {
    return [...document.querySelectorAll('.actionable')].filter(isVisible);
  }

  function getScrollParent(el) {
    if (!el) return null;
    let parent = el.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const style = window.getComputedStyle(parent);
      const overflowY = style.overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function scrollIntoViewIfNeeded(el) {
    if (!el) return;
    const parent = getScrollParent(el);
    if (!parent) return;

    const elRect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const padding = 16;

    if (elRect.top < parentRect.top + padding) {
      parent.scrollTop -= (parentRect.top + padding - elRect.top);
    } else if (elRect.bottom > parentRect.bottom - padding) {
      parent.scrollTop += (elRect.bottom - (parentRect.bottom - padding));
    }
  }

  function setFocus(el) {
    if (!el || !isVisible(el)) return;
    document.querySelectorAll('.ui-focus').forEach(x => x.classList.remove('ui-focus'));
    focusedEl = el;
    el.classList.add('ui-focus');
    scrollIntoViewIfNeeded(el);
  }

  function getFocusedElement() {
    return focusedEl;
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return {x: r.left + r.width/2, y: r.top + r.height/2};
  }

  function moveFocus(direction) {
    if (!focusedEl || !isVisible(focusedEl)) {
      const currentNav = document.querySelector(`.nav-item[data-screen="${window.AmbiSun.state.screen}"]`);
      setFocus(currentNav || visibleActions()[0]);
      return;
    }

    // Rule rows use LEFT / RIGHT to change their mode immediately.
    if ((direction === 'left' || direction === 'right') &&
        (focusedEl.dataset.action === 'cycle-source-rule' ||
         focusedEl.dataset.action === 'cycle-default-rule')) {
      activate(focusedEl, direction === 'right' ? 1 : -1);
      return;
    }

    // Deterministic vertical navigation inside #sourceList
    if (focusedEl.closest && focusedEl.closest('#sourceList') && (direction === 'up' || direction === 'down')) {
      const rows = [...document.querySelectorAll('#sourceList .list-item.actionable')];
      const index = rows.indexOf(focusedEl);
      if (index >= 0) {
        if (direction === 'down' && index + 1 < rows.length) {
          setFocus(rows[index + 1]);
          return;
        } else if (direction === 'up' && index > 0) {
          setFocus(rows[index - 1]);
          return;
        }
        return;
      }
    }

    const from = centerOf(focusedEl);
    const candidates = visibleActions().filter(el => el !== focusedEl);
    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      const to = centerOf(el);
      const dx = to.x - from.x;
      const dy = to.y - from.y;

      let primary, secondary, valid = false;
      if (direction === 'right' && dx > 5) { primary = dx; secondary = Math.abs(dy); valid = true; }
      if (direction === 'left'  && dx < -5){ primary = -dx; secondary = Math.abs(dy); valid = true; }
      if (direction === 'down'  && dy > 5) { primary = dy; secondary = Math.abs(dx); valid = true; }
      if (direction === 'up'    && dy < -5){ primary = -dy; secondary = Math.abs(dx); valid = true; }
      if (!valid) continue;

      const score = primary + secondary * 2.35;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) setFocus(best);
  }

  let isBound = false;

  function bind() {
    if (isBound) return;
    isBound = true;

    document.addEventListener('keydown', e => {
      if (e.repeat) return; // Fix double press issue if TV sends repeats
      // Pause plasma renderer to ensure UI is instantly responsive
      if (AmbiSun.plasma && AmbiSun.plasma.pauseTemporary) {
        AmbiSun.plasma.pauseTemporary();
      }

const key = e.key;

      if (key === 'Enter') {
        activate(focusedEl);
        e.preventDefault();
        return;
      }

      if (key === 'ArrowUp')    { moveFocus('up'); e.preventDefault(); return; }
      if (key === 'ArrowDown')  { moveFocus('down'); e.preventDefault(); return; }
      if (key === 'ArrowLeft')  { moveFocus('left'); e.preventDefault(); return; }
      if (key === 'ArrowRight') { moveFocus('right'); e.preventDefault(); return; }

      if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') {
        if (backHandler) {
          backHandler();
        }
        e.preventDefault();
      }
    });

    document.addEventListener('click', e => {
      const el = e.target.closest('.actionable');
      if (!el) return;
      activate(el);
    });
  }

  AmbiSun.navigation.setActionHandler = setActionHandler;
  AmbiSun.navigation.setBackHandler = setBackHandler;
  AmbiSun.navigation.activate = activate;
  AmbiSun.navigation.openScreen = openScreen;
  AmbiSun.navigation.setFocus = setFocus;
  AmbiSun.navigation.moveFocus = moveFocus;
  AmbiSun.navigation.getFocusedElement = getFocusedElement;
  AmbiSun.navigation.bind = bind;
})();
