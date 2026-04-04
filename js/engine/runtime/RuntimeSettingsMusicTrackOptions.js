/**
 * RuntimeSettingsMusicTrackOptions.js
 *
 * Builds music track option markup for the settings UI.
 */

'use strict';

(function () {
  function createSettingsMusicTrackOptionsBuilder() {
    function build(opts = {}) {
      const tracks = Array.isArray(opts.audioTrackOptions) ? opts.audioTrackOptions : [];
      const esc = typeof opts.esc === 'function' ? opts.esc : ((value) => String(value || ''));

      return tracks
        .map((entry) => `<option value="${esc(entry.value)}">${esc(entry.label)}</option>`)
        .join('');
    }

    return {
      build,
    };
  }

  const api = {
    createSettingsMusicTrackOptionsBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsMusicTrackOptions = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
