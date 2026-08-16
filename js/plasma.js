(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.plasma = AmbiSun.plasma || {};

  const WIDTH = 48;    // Reduced from 80 — still smooth when CSS-scaled
  const HEIGHT = 27;   // Reduced from 45 — 16:9 aspect
  const PALETTE_SIZE = 360;
  const HUE_STEPS_PER_SECOND = 8;
  const TARGET_FPS = 15;           // 15fps — imperceptible for abstract BG, saves CPU
  const FRAME_INTERVAL = 1000 / TARGET_FPS;

  let canvas = null;
  let ctx = null;
  let img = null;
  let pixels = null;
  let plasma = null;
  let palette = null;

  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let lastRenderTime = 0;
  let phase = 0;
  let initialized = false;

  function hsvToRgb(h){
    const hp = ((h % 360) + 360) % 360 / 60;
    const c = 1;
    const x = 1 - Math.abs((hp % 2) - 1);
    let r=0, g=0, b=0;
    if (hp < 1)      {r=c; g=x;}
    else if (hp < 2) {r=x; g=c;}
    else if (hp < 3) {g=c; b=x;}
    else if (hp < 4) {g=x; b=c;}
    else if (hp < 5) {r=x; b=c;}
    else             {r=c; b=x;}
    return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
  }

  function render(now){
    if (!running) return;
    // Throttle to TARGET_FPS
    const elapsed = now - lastRenderTime;
    if (elapsed < FRAME_INTERVAL) {
      rafId = requestAnimationFrame(render);
      return;
    }
    lastRenderTime = now - (elapsed % FRAME_INTERVAL);

    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.15) dt = 0.15;
    phase = (phase + HUE_STEPS_PER_SECOND * dt) % PALETTE_SIZE;

    const len = plasma.length;
    for (let i = 0; i < len; i++){
      let hue = (plasma[i] + phase) % PALETTE_SIZE;
      if (hue < 0) hue += PALETTE_SIZE;
      const h0 = hue | 0;
      const frac = hue - h0;
      const p0 = h0 * 3;
      const p1 = p0 + 3;
      const o = i * 4;
      pixels[o]   = palette[p0]   + (palette[p1]   - palette[p0])   * frac;
      pixels[o+1] = palette[p0+1] + (palette[p1+1] - palette[p0+1]) * frac;
      pixels[o+2] = palette[p0+2] + (palette[p1+2] - palette[p0+2]) * frac;
      pixels[o+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    rafId = requestAnimationFrame(render);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    lastRenderTime = lastTime;
    rafId = requestAnimationFrame(render);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stop();
    } else if (window.AmbiSun.state.plasma) {
      start();
    }
  }

  function init() {
    if (initialized) return;

    canvas = document.getElementById('hyperPlasma');
    if (!canvas) return;

    // Update canvas dimensions to match reduced resolution
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    ctx = canvas.getContext('2d', {alpha: false, desynchronized: true});
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    img = ctx.createImageData(WIDTH, HEIGHT);
    pixels = img.data;
    plasma = new Float32Array(WIDTH * HEIGHT);
    palette = new Uint8Array((PALETTE_SIZE + 1) * 3);

    for (let h = 0; h <= PALETTE_SIZE; h++){
      const c = hsvToRgb(h === PALETTE_SIZE ? 0 : h);
      const p = h * 3;
      palette[p] = c[0];
      palette[p+1] = c[1];
      palette[p+2] = c[2];
    }

    for (let y = 0; y < HEIGHT; y++){
      for (let x = 0; x < WIDTH; x++){
        const i = y * WIDTH + x;
        const a = 128 + 128 * Math.sin(x / 10.0);
        const b = 128 + 128 * Math.sin(y / 5.0);
        const cc = 128 + (128 * Math.sin(x + y) / 10.0);
        const d = 128 + 128 * Math.sin(Math.sqrt(x*x + y*y) / 5.0);
        plasma[i] = (a + b + cc + d) / 4;
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    initialized = true;

    if (window.AmbiSun.state.plasma) {
      start();
    }
    updateDOM();
  }

  function updateDOM() {
    const isEnabled = window.AmbiSun.state.plasma;
    if (canvas) canvas.style.display = isEnabled ? 'block' : 'none';
    const dim = document.querySelector('.plasma-dim');
    if (dim) dim.style.display = isEnabled ? 'block' : 'none';
  }

  function toggle() {
    window.AmbiSun.state.plasma = !window.AmbiSun.state.plasma;
    updateDOM();
    if (window.AmbiSun.state.plasma && !document.hidden) {
      start();
    } else {
      stop();
    }
  }

  function dispose() {
    stop();
    if (initialized) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      initialized = false;
    }
  }

  let pauseTimer = 0;
  function pauseTemporary() {
    if (!running) return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(function() {
      if (running && !document.hidden && !rafId) {
        lastTime = performance.now();
        lastRenderTime = lastTime;
        rafId = requestAnimationFrame(render);
      }
    }, 400); // pause for 400ms after last navigation key
  }

  function isRunning() {
    return running;
  }

  AmbiSun.plasma.init = init;
  AmbiSun.plasma.start = start;
  AmbiSun.plasma.stop = stop;
  AmbiSun.plasma.toggle = toggle;
  AmbiSun.plasma.dispose = dispose;
  AmbiSun.plasma.isRunning = isRunning;
  AmbiSun.plasma.pauseTemporary = pauseTemporary;
})();
