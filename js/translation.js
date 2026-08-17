(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.translation = AmbiSun.translation || {};

  let isFirstRunContext = false;
  let cachedLanguagesList = null;

  function openOtherLanguages(isFirstRun = false) {
    isFirstRunContext = !!isFirstRun;
    const modal = document.getElementById('otherLanguagesModal');
    const listEl = document.getElementById('otherLanguagesList');
    const loadingEl = document.getElementById('otherLanguagesLoading');
    const statusLabel = document.getElementById('otherLanguagesStatusLabel');

    if (!modal) return;

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');

    if (statusLabel) statusLabel.textContent = '';
    if (loadingEl) {
      loadingEl.textContent = AmbiSun.i18n.t('language.loading', 'Загрузка списка языков…');
      loadingEl.style.display = 'block';
    }
    if (listEl) {
      listEl.innerHTML = '';
      listEl.style.display = 'block';
    }

    loadLanguagesList();
  }

  function closeOtherLanguages() {
    const modal = document.getElementById('otherLanguagesModal');
    if (!modal) return;

    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');

    if (isFirstRunContext) {
      const preferred = document.querySelector('#firstRunLanguageList .startup-language.other') ||
                        document.querySelector('#firstRunLanguageList .startup-language');
      if (preferred && AmbiSun.navigation) AmbiSun.navigation.setFocus(preferred);
    } else {
      const preferred = document.querySelector('#language .list-item.other-languages') ||
                        document.querySelector('#language .list-item');
      if (preferred && AmbiSun.navigation) AmbiSun.navigation.setFocus(preferred);
    }
  }

  async function loadLanguagesList() {
    const listEl = document.getElementById('otherLanguagesList');
    const loadingEl = document.getElementById('otherLanguagesLoading');
    const statusLabel = document.getElementById('otherLanguagesStatusLabel');

    if (cachedLanguagesList && cachedLanguagesList.length > 0) {
      if (loadingEl) loadingEl.style.display = 'none';
      renderLanguages(cachedLanguagesList);
      return;
    }

    try {
      let res = null;
      if (AmbiSun.webos && AmbiSun.webos.getTranslationLanguages) {
        res = await AmbiSun.webos.getTranslationLanguages();
      }

      if (res && res.returnValue && Array.isArray(res.languages) && res.languages.length > 0) {
        cachedLanguagesList = res.languages;
        if (loadingEl) loadingEl.style.display = 'none';
        renderLanguages(res.languages);
      } else {
        if (loadingEl) loadingEl.style.display = 'none';
        const errMsg = (res && (res.errorText || res.errorCode)) || AmbiSun.i18n.t('language.downloadFailed', 'Не удалось загрузить список языков');
        if (statusLabel) statusLabel.textContent = errMsg;
        if (listEl) {
          listEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--danger)">${errMsg}</div>`;
        }
      }
    } catch (e) {
      if (loadingEl) loadingEl.style.display = 'none';
      const errMsg = AmbiSun.i18n.t('language.downloadFailed', 'Не удалось загрузить список языков');
      if (statusLabel) statusLabel.textContent = errMsg;
      if (listEl) {
        listEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--danger)">${errMsg}</div>`;
      }
    }
  }

  function renderLanguages(languages) {
    const listEl = document.getElementById('otherLanguagesList');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (!languages || languages.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding:30px; color:var(--muted)">${AmbiSun.i18n.t('language.empty', 'Языки не найдены')}</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    languages.forEach((lang) => {
      const row = document.createElement('div');
      row.className = 'list-item actionable';
      row.dataset.action = 'select-other-language';
      row.dataset.language = lang.code;
      row.dataset.name = lang.name;
      row.dataset.native = lang.nativeName || lang.name;
      row.dataset.dir = lang.dir || 'ltr';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '-1');

      row.innerHTML = `
        <span class="glyph-badge">${lang.code.toUpperCase()}</span>
        <span style="font-weight:600">${lang.nativeName || lang.name}</span>
        <span style="color:var(--muted); font-size:16px; margin-left:auto">${lang.name !== lang.nativeName ? lang.name : ''}</span>
      `;
      frag.appendChild(row);
    });

    listEl.appendChild(frag);

    setTimeout(() => {
      const firstItem = listEl.querySelector('.list-item');
      if (firstItem && AmbiSun.navigation) {
        AmbiSun.navigation.setFocus(firstItem);
      }
    }, 60);
  }

  async function selectLanguage(el) {
    if (!el) return;
    const code = el.dataset.language;
    const name = el.dataset.name;
    const nativeName = el.dataset.native;
    const dir = el.dataset.dir || 'ltr';

    const statusLabel = document.getElementById('otherLanguagesStatusLabel');
    const listEl = document.getElementById('otherLanguagesList');
    const loadingEl = document.getElementById('otherLanguagesLoading');

    if (loadingEl) {
      loadingEl.textContent = AmbiSun.i18n.t('language.downloading', 'Скачивание перевода…');
      loadingEl.style.display = 'block';
    }
    if (listEl) listEl.style.display = 'none';

    try {
      let res = null;
      if (AmbiSun.webos && AmbiSun.webos.downloadTranslation) {
        res = await AmbiSun.webos.downloadTranslation({
          language: code,
          name: name,
          nativeName: nativeName,
          dir: dir
        });
      }

      if (res && res.returnValue && res.locale) {
        if (AmbiSun.i18n.registerDynamicLocale) {
          AmbiSun.i18n.registerDynamicLocale(code, res.locale, dir, nativeName || name);
        }

        if (isFirstRunContext) {
          closeOtherLanguages();
          if (AmbiSun.startup && AmbiSun.startup.completeLanguage) {
            await AmbiSun.startup.completeLanguage(code);
          }
        } else {
          closeOtherLanguages();
          await AmbiSun.i18n.setLanguage(code);
          if (AmbiSun.i18n.renderLanguageScreen) {
            AmbiSun.i18n.renderLanguageScreen();
          }
        }
      } else {
        if (loadingEl) loadingEl.style.display = 'none';
        if (listEl) listEl.style.display = 'block';
        const errMsg = (res && (res.errorText || res.errorCode)) || AmbiSun.i18n.t('language.downloadFailed', 'Не удалось загрузить перевод');
        if (statusLabel) statusLabel.textContent = errMsg;
      }
    } catch (err) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (listEl) listEl.style.display = 'block';
      const errMsg = AmbiSun.i18n.t('language.downloadFailed', 'Не удалось загрузить перевод');
      if (statusLabel) statusLabel.textContent = errMsg;
    }
  }

  AmbiSun.translation.openOtherLanguages = openOtherLanguages;
  AmbiSun.translation.closeOtherLanguages = closeOtherLanguages;
  AmbiSun.translation.selectLanguage = selectLanguage;
  AmbiSun.translation.loadLanguagesList = loadLanguagesList;
})();
