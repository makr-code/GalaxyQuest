/**
 * RuntimeSettingsFtlTemplateStyles.js
 *
 * Shared inline styles for FTL settings template fragments.
 */

'use strict';

(function () {
  const FTL_TEMPLATE_STYLES = {
    card: 'margin-top:1rem;',
    title: 'margin-top:0',
    description: 'font-size:0.82rem;color:var(--text-muted);margin:0 0 0.6rem;',
    current: 'margin-bottom:0.6rem;font-size:0.84rem;color:#88ccff;',
    grid: 'display:grid;grid-template-columns:1fr 1fr;gap:0.4rem 0.6rem;',
    result: 'margin-top:0.4rem;font-size:0.8rem;min-height:1rem;',
    button: 'text-align:left;padding:0.35rem 0.5rem;font-size:0.78rem;line-height:1.3;',
  };

  function getFtlTemplateStyles() {
    return Object.assign({}, FTL_TEMPLATE_STYLES);
  }

  const api = {
    getFtlTemplateStyles,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsFtlTemplateStyles = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
