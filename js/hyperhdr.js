(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.hyperhdr = AmbiSun.hyperhdr || {};
  AmbiSun.config = AmbiSun.config || {};

  AmbiSun.config.hyperhdrEndpoint = AmbiSun.config.hyperhdrEndpoint || "http://127.0.0.1:8090/json-rpc?request";

  async function rpc(payload) {
    const response = await fetch(AmbiSun.config.hyperhdrEndpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HyperHDR HTTP ${response.status}`);
    return response.json();
  }

  async function setLedDevice(state) {
    return rpc({
      command: "componentstate",
      componentstate: {
        component: "LEDDEVICE",
        state: !!state
      }
    });
  }

  function getStatus() {
    return rpc({command: "serverinfo"});
  }

  async function testLedDevice(durationMs) {
    await setLedDevice(true);
    await new Promise(resolve => setTimeout(resolve, durationMs || 5000));
    return setLedDevice(false);
  }

  AmbiSun.hyperhdr.rpc = rpc;
  AmbiSun.hyperhdr.setLedDevice = setLedDevice;
  AmbiSun.hyperhdr.getStatus = getStatus;
  AmbiSun.hyperhdr.testLedDevice = testLedDevice;
})();
