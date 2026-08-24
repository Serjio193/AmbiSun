(function () {
  'use strict';

  window.AmbiSun = window.AmbiSun || {};
  AmbiSun.onboarding = AmbiSun.onboarding || {};

  function t(key, fallback) {
    return AmbiSun.i18n.t(key, fallback);
  }

  function renderHyperhdrSetup(hdr) {
    var setupHint = t(
      'hyperhdr.setupHint',
      'If the lighting is not connected to the TV, enter the HyperHDR server IP address and port.'
    );
    var skipLabel = t('hyperhdr.skip', 'Skip');
    var host = hdr && hdr.host ? hdr.host : '127.0.0.1';
    var port = hdr && hdr.port ? hdr.port : 8090;

    return `
      <div class="location-lead">HyperHDR</div>
      <div class="onboarding-copy">${setupHint}</div>
      <div class="onboarding-inputs">
        <div class="setting-field">
          <label class="setting-input-label" for="onboardingHyperhdrHost">${t('hyperhdr.host', 'Server address:')}</label>
          <input class="actionable text-input" id="onboardingHyperhdrHost" type="text" value="${host}" spellcheck="false" autocomplete="off" />
        </div>
        <div class="setting-field">
          <label class="setting-input-label" for="onboardingHyperhdrPort">${t('hyperhdr.port', 'Port:')}</label>
          <input class="actionable text-input" id="onboardingHyperhdrPort" type="number" min="1" max="65535" value="${port}" />
        </div>
      </div>
      <div id="onboardingHyperhdrResult" class="onboarding-status"></div>
      <div class="location-actions onboarding-actions">
        <div class="windows-action-button actionable" data-action="onboarding-hyperhdr-test" role="button" tabindex="-1">
          <span>${t('hyperhdr.test', 'Test')}</span><span>›</span>
        </div>
        <div class="windows-action-button actionable" data-action="onboarding-hyperhdr-save" role="button" tabindex="-1">
          <span>${t('hyperhdr.save', 'Save')}</span><span>✓</span>
        </div>
        <div class="windows-action-button actionable" data-action="onboarding-hyperhdr-skip" role="button" tabindex="-1">
          <span>${skipLabel}</span><span>›</span>
        </div>
      </div>`;
  }

  function renderHyperhdrStartupRecommendation() {
    return `
      <div class="location-lead">${t('hyperhdr.startupTitle', 'Stable HyperHDR startup')}</div>
      <div class="onboarding-copy onboarding-recommendation-copy">
        ${t('hyperhdr.startupDescription', 'For stable operation, we recommend enabling “Disable LEDs at startup” in HyperHDR. This prevents the lighting from turning on by itself when the TV starts or wakes up.')}
      </div>
      <div class="onboarding-setting-path">
        ${t('hyperhdr.startupPath', 'HyperHDR → General settings → Disable LEDs at startup')}
      </div>
      <div class="location-actions onboarding-actions onboarding-recommendation-actions">
        <div class="windows-action-button actionable" data-action="onboarding-hyperhdr-continue" role="button" tabindex="-1">
          <span>${t('hyperhdr.continue', 'Continue')}</span><span>✓</span>
        </div>
      </div>`;
  }

  AmbiSun.onboarding.renderHyperhdrSetup = renderHyperhdrSetup;
  AmbiSun.onboarding.renderHyperhdrStartupRecommendation = renderHyperhdrStartupRecommendation;
}());
