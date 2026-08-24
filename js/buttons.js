(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.buttons = AmbiSun.buttons || {};

  const SELECTOR = [
    'button',
    '.pill',
    '.effect-picker-back',
    '.windows-unified-picker-back',
    '.source-hide-button'
  ].join(',');

  function apply(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SELECTOR) &&
        !root.matches('#home .location .pill, #sun .location .pill')) {
      prepare(root);
    }
    root.querySelectorAll(SELECTOR).forEach(function (element) {
      if (element.matches('#home .location .pill, #sun .location .pill')) return;
      prepare(element);
    });
  }

  function prepare(element) {
    element.classList.add('windows-action-button', 'windows-button-initializing');
    window.requestAnimationFrame(function () {
      element.classList.remove('windows-button-initializing');
    });
  }

  function init() {
    apply(document);
    if (!document.body || !window.MutationObserver) return;
    const observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) apply(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  AmbiSun.buttons.apply = apply;
  document.addEventListener('DOMContentLoaded', init);
})();
