(function () {
  'use strict';

  window.AmbiSun = window.AmbiSun || {};

  function endpointFromInputs(hostId, portId) {
    var host = (document.getElementById(hostId)?.value || '').trim();
    var port = parseInt(document.getElementById(portId)?.value, 10);
    if (!host || /^https?:\/\//i.test(host) || host.indexOf('/') !== -1 ||
        isNaN(port) || port < 1 || port > 65535) {
      return null;
    }
    return { host: host, port: port };
  }

  function showResult(id, icon, key, fallback, color) {
    var result = document.getElementById(id);
    if (!result) return;
    result.textContent = icon + ' ' + AmbiSun.i18n.t(key, fallback);
    result.style.color = color;
  }

  function showInvalid(id) {
    showResult(id, '✖', 'hyperhdr.invalid', 'Invalid address or port', 'var(--danger)');
  }

  function showPending(id, key, fallback) {
    showResult(id, '⏳', key, fallback, 'var(--muted)');
  }

  async function testEndpoint(endpoint, resultId) {
    showPending(resultId, 'hyperhdr.testing', 'Testing connection...');
    try {
      var response = await AmbiSun.webos.getHyperhdrStatus(endpoint);
      var available = !!(response && response.returnValue && response.hyperhdr && response.hyperhdr.reachable);
      showResult(
        resultId,
        available ? '✔' : '✖',
        available ? 'hyperhdr.available' : 'hyperhdr.unavailable',
        available ? 'HyperHDR available' : 'Unavailable',
        available ? 'var(--green)' : 'var(--danger)'
      );
      return available;
    } catch (_) {
      showResult(resultId, '✖', 'hyperhdr.unavailable', 'Unavailable', 'var(--danger)');
      return false;
    }
  }

  AmbiSun.hyperhdrSettings = {
    endpointFromInputs: endpointFromInputs,
    showResult: showResult,
    showInvalid: showInvalid,
    showPending: showPending,
    testEndpoint: testEndpoint
  };
}());
