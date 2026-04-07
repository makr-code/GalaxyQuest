/**
 * SfxRows.js
 *
 * Builds SFX browser rows for the settings window.
 */

'use strict';

(function () {
  function createSettingsSfxRowsBuilder() {
    function buildOptionMarkup(sfxOptions, esc) {
      const options = Array.isArray(sfxOptions) ? sfxOptions : [];
      return options
        .map((entry) => `<option value="${esc(entry.value)}">${esc(entry.label)}</option>`)
        .join('');
    }

    function buildRows(opts = {}) {
      const audioState = opts.audioState || {};
      const settingsState = opts.settingsState || {};
      const audioEvents = Array.isArray(opts.audioEvents) ? opts.audioEvents : [];
      const esc = typeof opts.esc === 'function' ? opts.esc : ((value) => String(value || ''));
      const sfxOptionMarkup = buildOptionMarkup(opts.sfxOptions, esc);

      return audioEvents.map((item) => {
        const value = String(audioState.sfxMap?.[item.key] || settingsState.sfxMap?.[item.key] || '');
        return `
        <div class="system-row" style="display:grid;grid-template-columns:minmax(120px, 160px) 1fr auto;gap:0.5rem;align-items:center;">
          <span>${esc(item.label)}</span>
          <select class="set-sfx-select" data-sfx-key="${esc(item.key)}">
            ${sfxOptionMarkup.replace(`value="${esc(value)}"`, `value="${esc(value)}" selected`)}
          </select>
          <button class="btn btn-secondary btn-sm set-sfx-test" type="button" data-sfx-test="${esc(item.tester)}">Test</button>
        </div>`;
      }).join('');
    }

    return {
      buildRows,
    };
  }

  const api = {
    createSettingsSfxRowsBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsSfxRows = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
