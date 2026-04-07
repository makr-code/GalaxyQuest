'use strict';

(function () {
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInlineTemplate(template, data = {}, options = {}) {
    const tpl = String(template || '');
    const windowRef = options.windowRef || window;
    if (windowRef.Mustache && typeof windowRef.Mustache.render === 'function') {
      return windowRef.Mustache.render(tpl, data);
    }
    return tpl.replace(/\{\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}\}/g, (_, key) => {
      const value = data[key];
      if (value === null || value === undefined) return '';
      return String(value);
    });
  }

  function renderInlineTemplateList(template, rows, options = {}) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => renderInlineTemplate(template, row, options)).join('');
  }

  function uiKitTemplateHTML(templateId, options = {}) {
    const windowRef = options.windowRef || window;
    const documentRef = options.documentRef || document;
    try {
      if (!(windowRef.GQUIKit && typeof windowRef.GQUIKit.cloneTemplate === 'function')) return '';
      const frag = windowRef.GQUIKit.cloneTemplate(templateId);
      if (!frag) return '';
      const wrap = documentRef.createElement('div');
      wrap.appendChild(frag);
      return wrap.innerHTML;
    } catch (_) {
      return '';
    }
  }

  function uiKitEmptyStateHTML(title, text, options = {}) {
    const fromTemplate = uiKitTemplateHTML('tpl-ui-empty-state', options);
    if (fromTemplate) return fromTemplate;
    return `
      <section class="ui-empty-state">
        <div class="ui-empty-icon">i</div>
        <h4 class="ui-empty-title">${esc(title || 'No data available')}</h4>
        <p class="ui-empty-text">${esc(text || 'Content will appear here soon.')}</p>
      </section>`;
  }

  function uiKitSkeletonHTML(options = {}) {
    return uiKitTemplateHTML('tpl-ui-skeleton-list', options) || '<p class="text-muted">Loading...</p>';
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  const api = {
    esc,
    renderInlineTemplate,
    renderInlineTemplateList,
    uiKitTemplateHTML,
    uiKitEmptyStateHTML,
    uiKitSkeletonHTML,
    waitMs,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeUiTemplateHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
