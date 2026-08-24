(function () {
  'use strict';

  var MIT_TEXT =
`MIT License

Copyright (c) 2026 AmbiSun contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

  function translate(key, fallback) {
    return AmbiSun.i18n && typeof AmbiSun.i18n.t === 'function'
      ? AmbiSun.i18n.t(key, fallback)
      : fallback;
  }

  function refreshText() {
    var summary = document.getElementById('ambisunLicenseSummary');
    var closeButton = document.getElementById('ambisunLicenseClose');
    if (summary) {
      summary.textContent = translate('about.licenseSummary',
        'MIT is a permissive license: you may use, modify, distribute, and use the software commercially, provided the copyright notice and license text are preserved.');
    }
    if (closeButton) closeButton.textContent = translate('about.close', 'Close');
  }

  function ensureModal() {
    if (document.getElementById('ambisunLicenseModal')) return;
    var modal = document.createElement('div');
    modal.id = 'ambisunLicenseModal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML =
      '<div id="ambisunLicenseDialog" role="dialog" aria-modal="true" aria-labelledby="ambisunLicenseTitle">' +
      '<div id="ambisunLicenseHead"><div id="ambisunLicenseTitle">MIT License</div>' +
      '<button id="ambisunLicenseClose" type="button">Закрыть</button></div>' +
      '<div id="ambisunLicenseBody"><div id="ambisunLicenseSummary"></div>' +
      '<pre id="ambisunLicenseText"></pre></div></div>';
    document.body.appendChild(modal);

    refreshText();
    document.getElementById('ambisunLicenseText').textContent = MIT_TEXT;
    document.getElementById('ambisunLicenseClose').addEventListener('click', close);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) close();
    });
  }

  function open() {
    ensureModal();
    refreshText();
    var modal = document.getElementById('ambisunLicenseModal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(function () { document.getElementById('ambisunLicenseClose').focus(); }, 0);
  }

  function close() {
    var modal = document.getElementById('ambisunLicenseModal');
    if (!modal) return false;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    return true;
  }

  window.AmbiSun = window.AmbiSun || {};
  window.AmbiSun.license = { open: open, close: close };
}());
