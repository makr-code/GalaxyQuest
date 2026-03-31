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

  function getText(node, fallback) {
    return String(node || fallback || '').trim();
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
      buttons: 'tpl-ui-button-row',
      contextmenu: 'tpl-ui-contextmenu',
      empty: 'tpl-ui-empty-state',
      grid: 'tpl-ui-grid-demo',
      skeleton: 'tpl-ui-skeleton-list',
      tabs: 'tpl-ui-tabs-demo',
      kpi: 'tpl-ui-kpi-grid',
      timeline: 'tpl-ui-timeline',
    };
    const templateId = map[key];
    if (!templateId) return false;
    const ok = mountTemplate(templateId, getPreviewBody());
    if (ok) initTabs(getPreviewBody());
    return ok;
  }

  function activateTab(root, tabId) {
    const host = root && root.closest ? root.closest('[data-ui-tabs]') : null;
    if (!host) return false;
    const nextId = String(tabId || '');
    if (!nextId) return false;
    const previousId = getText(host.getAttribute('data-ui-active-tab'), '');

    host.querySelectorAll('[data-ui-tab-target]').forEach((btn) => {
      const active = String(btn.getAttribute('data-ui-tab-target') || '') === nextId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });
    host.querySelectorAll('[data-ui-tab-panel]').forEach((panel) => {
      const active = String(panel.getAttribute('data-ui-tab-panel') || '') === nextId;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    host.setAttribute('data-ui-active-tab', nextId);
    if (previousId !== nextId) {
      host.dispatchEvent(new CustomEvent('gq:ui-tab-change', {
        bubbles: true,
        detail: {
          host,
          previousTabId: previousId,
          tabId: nextId,
        },
      }));
    }
    return true;
  }

  function initTabs(scope) {
    const root = scope || document;
    root.querySelectorAll('[data-ui-tabs]').forEach((host) => {
      const active = getText(host.getAttribute('data-ui-active-tab'), '');
      const firstBtn = host.querySelector('[data-ui-tab-target]');
      const fallbackId = firstBtn ? firstBtn.getAttribute('data-ui-tab-target') : '';
      activateTab(host, active || fallbackId);
    });
  }

  function openDemoContextMenu(anchor) {
    if (!anchor || !window.WM || typeof window.WM.contextMenu !== 'function') return false;
    const rect = anchor.getBoundingClientRect();
    window.WM.contextMenu([
      { label: 'Open Panel', meta: 'Enter', onSelect: function () {} },
      { label: 'Pin Action', onSelect: function () {} },
      { type: 'separator' },
      { label: 'Quick Inspect', checked: true, onSelect: function () {} },
      { label: 'Danger Action', danger: true, onSelect: function () {} },
    ], {
      x: rect.left + Math.min(rect.width, 24),
      y: rect.bottom + 8,
      title: 'UI Context Menu',
    });
    return true;
  }

  function bindDemoButtons() {
    document.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-ui-kit-demo]') : null;
      if (btn) {
        const demo = btn.getAttribute('data-ui-kit-demo');
        const ok = renderDemo(demo);
        if (!ok && window.GQLog && typeof window.GQLog.warn === 'function') {
          window.GQLog.warn('[ui-kit] unknown demo:', demo);
        }
        return;
      }

      const tabBtn = ev.target && ev.target.closest ? ev.target.closest('[data-ui-tab-target]') : null;
      if (tabBtn) {
        const host = tabBtn.closest('[data-ui-tabs]');
        activateTab(host, tabBtn.getAttribute('data-ui-tab-target'));
        return;
      }

      const menuBtn = ev.target && ev.target.closest ? ev.target.closest('[data-ui-open-menu]') : null;
      if (menuBtn) {
        openDemoContextMenu(menuBtn);
      }
    });

    document.addEventListener('keydown', function (ev) {
      const tabBtn = ev.target && ev.target.closest ? ev.target.closest('[data-ui-tab-target]') : null;
      if (!tabBtn) return;
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft' && ev.key !== 'Home' && ev.key !== 'End') return;
      const host = tabBtn.closest('[data-ui-tabs]');
      if (!host) return;
      const buttons = Array.from(host.querySelectorAll('[data-ui-tab-target]'));
      if (!buttons.length) return;
      const currentIndex = buttons.indexOf(tabBtn);
      let nextIndex = currentIndex;
      if (ev.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
      if (ev.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (ev.key === 'Home') nextIndex = 0;
      if (ev.key === 'End') nextIndex = buttons.length - 1;
      ev.preventDefault();
      const nextBtn = buttons[nextIndex];
      activateTab(host, nextBtn.getAttribute('data-ui-tab-target'));
      nextBtn.focus();
    });
  }

  function initDefaultDemo() {
    // Keep panel immediately useful on load.
    renderDemo('empty');
  }

  window.GQUIKit = {
    activateTab,
    cloneTemplate,
    initTabs,
    mountTemplate,
    openDemoContextMenu,
    renderDemo,
    clearPreview: function () { clearNode(getPreviewBody()); },
  };

  bindDemoButtons();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initDefaultDemo();
      initTabs(document);
    }, { once: true });
  } else {
    initDefaultDemo();
    initTabs(document);
  }
})();
