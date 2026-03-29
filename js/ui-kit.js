/*
 * GalaxyQuest UI Kit helper
 * Provides reusable template rendering + demo preview bindings.
 */
(function () {
  if (window.GQUIKit) return;

  function byId(id) {
    return document.getElementById(String(id || ''));
  }

  function cloneTemplate(templateId) {
    const tpl = byId(templateId);
    if (!tpl || tpl.tagName !== 'TEMPLATE') return null;
    return tpl.content ? tpl.content.cloneNode(true) : null;
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function getPreviewBody() {
    return byId('ui-kit-preview-body');
  }

  function mountTemplate(templateId, target) {
    const parent = target || getPreviewBody();
    if (!parent) return false;
    const frag = cloneTemplate(templateId);
    if (!frag) return false;
    clearNode(parent);
    parent.appendChild(frag);
    return true;
  }

  function renderDemo(name) {
    const key = String(name || '').toLowerCase();
    if (key === 'clear') {
      clearNode(getPreviewBody());
      return true;
    }
    const map = {
      empty: 'tpl-ui-empty-state',
      skeleton: 'tpl-ui-skeleton-list',
      kpi: 'tpl-ui-kpi-grid',
      timeline: 'tpl-ui-timeline',
    };
    const templateId = map[key];
    if (!templateId) return false;
    return mountTemplate(templateId, getPreviewBody());
  }

  function bindDemoButtons() {
    document.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-ui-kit-demo]') : null;
      if (!btn) return;
      const demo = btn.getAttribute('data-ui-kit-demo');
      const ok = renderDemo(demo);
      if (!ok && window.GQLog && typeof window.GQLog.warn === 'function') {
        window.GQLog.warn('[ui-kit] unknown demo:', demo);
      }
    });
  }

  function initDefaultDemo() {
    // Keep panel immediately useful on load.
    renderDemo('empty');
  }

  window.GQUIKit = {
    cloneTemplate,
    mountTemplate,
    renderDemo,
    clearPreview: function () { clearNode(getPreviewBody()); },
  };

  bindDemoButtons();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDefaultDemo, { once: true });
  } else {
    initDefaultDemo();
  }
})();
