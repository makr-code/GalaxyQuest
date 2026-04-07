/**
 * DriveButtons.js
 *
 * Builds FTL drive button markup for the settings window.
 */

'use strict';

(function () {
  function createSettingsFtlDriveButtonsBuilder() {
    function build(opts = {}) {
      const drives = Array.isArray(opts.drives) ? opts.drives : [];
      const esc = typeof opts.esc === 'function' ? opts.esc : ((value) => String(value || ''));
      const buttonStyle = String(opts.buttonStyle || 'text-align:left;padding:0.35rem 0.5rem;font-size:0.78rem;line-height:1.3;');

      return drives.map((drive) => {
        return `<button class="btn btn-secondary set-ftl-drive-btn" data-drive="${esc(drive.id)}"
              style="${buttonStyle}" type="button">
              <strong>${esc(drive.name)}</strong><br><span style="color:var(--text-muted)">${esc(drive.desc)}</span>
            </button>`;
      }).join('');
    }

    return {
      build,
    };
  }

  const api = {
    createSettingsFtlDriveButtonsBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsFtlDriveButtons = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
