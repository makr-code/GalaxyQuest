/**
 * RuntimeSettingsFtlSectionTemplate.js
 *
 * Builds the FTL section markup for the settings window.
 */

'use strict';

(function () {
  function createSettingsFtlSectionTemplateBuilder() {
    function build(opts = {}) {
      const styles = opts.styles || {};
      const ftlDriveButtons = String(opts.ftlDriveButtons || '');

      return `
      <div class="system-card" style="${String(styles.card || '')}">
        <h3 style="${String(styles.title || '')}">ÔÜí FTL Drive ÔÇö Faction Selection</h3>
        <p style="${String(styles.description || '')}">
          W├ñhle den FTL-Antrieb deiner Fraktion. Erste Wahl ist kostenlos. Wechsel kostet <strong>200 Ôùå Dark Matter</strong>.
        </p>
        <div id="set-ftl-current" style="${String(styles.current || '')}">Wird geladenÔÇª</div>
        <div id="set-ftl-drive-grid" style="${String(styles.grid || '')}">
          ${ftlDriveButtons}
        </div>
        <div id="set-ftl-result" style="${String(styles.result || '')}"></div>
      </div>`;
    }

    return {
      build,
    };
  }

  const api = {
    createSettingsFtlSectionTemplateBuilder,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsFtlSectionTemplate = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
