(function () {
  "use strict";

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.translation = AmbiSun.translation || {};

  let isFirstRunContext = false;
  let cachedLanguagesList = null;

  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

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
      clearElement(listEl);
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

  function renderError(msg) {
    const listEl = document.getElementById('otherLanguagesList');
    const statusLabel = document.getElementById('otherLanguagesStatusLabel');
    if (statusLabel) statusLabel.textContent = msg;
    if (listEl) {
      clearElement(listEl);
      const errDiv = document.createElement('div');
      errDiv.style.textAlign = 'center';
      errDiv.style.padding = '30px';
      errDiv.style.color = 'var(--danger)';
      errDiv.textContent = msg;
      listEl.appendChild(errDiv);
    }
  }

  async function loadLanguagesList() {
    const loadingEl = document.getElementById('otherLanguagesLoading');

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
        renderError(errMsg);
      }
    } catch (e) {
      if (loadingEl) loadingEl.style.display = 'none';
      const errMsg = (e && e.message) || AmbiSun.i18n.t('language.downloadFailed', 'Не удалось загрузить список языков');
      renderError(errMsg);
    }
  }

  function renderLanguages(languages) {
    const listEl = document.getElementById('otherLanguagesList');
    if (!listEl) return;

    clearElement(listEl);

    if (!languages || languages.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.padding = '30px';
      emptyDiv.style.color = 'var(--muted)';
      emptyDiv.textContent = AmbiSun.i18n.t('language.empty', 'Языки не найдены');
      listEl.appendChild(emptyDiv);
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

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'glyph-badge';
      badgeSpan.textContent = String(lang.code || '').toUpperCase();
      row.appendChild(badgeSpan);

      const nameSpan = document.createElement('span');
      nameSpan.style.fontWeight = '600';
      nameSpan.textContent = String(lang.nativeName || lang.name || lang.code);
      row.appendChild(nameSpan);

      if (lang.name && lang.name !== lang.nativeName) {
        const subSpan = document.createElement('span');
        subSpan.style.color = 'var(--muted)';
        subSpan.style.fontSize = '16px';
        subSpan.style.marginLeft = 'auto';
        subSpan.textContent = String(lang.name);
        row.appendChild(subSpan);
      }

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
      const errMsg = (err && err.message) || AmbiSun.i18n.t('language.downloadFailed', 'Не удалось загрузить перевод');
      if (statusLabel) statusLabel.textContent = errMsg;
    }
  }

  AmbiSun.translation.openOtherLanguages = openOtherLanguages;
  AmbiSun.translation.closeOtherLanguages = closeOtherLanguages;
  AmbiSun.translation.selectLanguage = selectLanguage;
  AmbiSun.translation.loadLanguagesList = loadLanguagesList;
})();
