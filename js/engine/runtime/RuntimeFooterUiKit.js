/**
 * RuntimeFooterUiKit.js
 *
 * Footer quick actions and UI kit preview panel bootstrap bindings.
 */

'use strict';

(function () {
  function initFooterUiKit(opts = {}) {
    const {
      wm = null,
      updateFooterQuickNavBadge = () => {},
      documentRef = (typeof document !== 'undefined' ? document : null),
      windowRef = (typeof window !== 'undefined' ? window : null),
      storage = (typeof localStorage !== 'undefined' ? localStorage : null),
    } = opts;

    updateFooterQuickNavBadge();

    documentRef?.getElementById('footer-quicknav-btn')?.addEventListener('click', () => {
      if (!wm) return;
      if (wm.isOpen('quicknav')) wm.close('quicknav');
      else wm.open('quicknav');
      documentRef.getElementById('footer-quicknav-btn')?.classList.toggle('active', wm.isOpen('quicknav'));
    });

    documentRef?.getElementById('footer-overview-btn')?.addEventListener('click', () => {
      if (!wm) return;
      if (wm.isOpen('overview')) wm.close('overview');
      else wm.open('overview');
      documentRef.getElementById('footer-overview-btn')?.classList.toggle('active', wm.isOpen('overview'));
    });

    documentRef?.getElementById('footer-minimap-btn')?.addEventListener('click', () => {
      if (!wm) return;
      if (wm.isOpen('minimap')) wm.close('minimap');
      else wm.open('minimap');
      documentRef.getElementById('footer-minimap-btn')?.classList.toggle('active', wm.isOpen('minimap'));
    });

    const uiKitPanelModeKey = 'gq.uiKitPreview.mode';
    const uiKitPanel = documentRef?.getElementById('ui-kit-preview-panel');
    const uiKitToggleBtn = documentRef?.getElementById('ui-kit-preview-expand-btn');
    const uiKitFooterBtn = documentRef?.getElementById('footer-uikit-btn');

    const setUiKitPanelVisible = (visible) => {
      if (!uiKitPanel) return;
      uiKitPanel.hidden = !visible;
      uiKitFooterBtn?.classList.toggle('active', !!visible);
      uiKitFooterBtn?.setAttribute('aria-expanded', String(!!visible));
    };

    const readUiKitPanelCompactMode = () => {
      try {
        return storage?.getItem(uiKitPanelModeKey) !== 'expanded';
      } catch (_) {
        return true;
      }
    };

    const writeUiKitPanelCompactMode = (isCompact) => {
      try {
        storage?.setItem(uiKitPanelModeKey, isCompact ? 'compact' : 'expanded');
      } catch (_) {
        // Non-blocking when storage is unavailable.
      }
    };

    const applyUiKitPanelCompactMode = (isCompact) => {
      if (!uiKitPanel || !uiKitToggleBtn) return;
      uiKitPanel.classList.toggle('is-compact', !!isCompact);
      uiKitToggleBtn.setAttribute('aria-expanded', String(!isCompact));
      uiKitToggleBtn.textContent = isCompact ? 'Mehr' : 'Weniger';
      uiKitToggleBtn.title = isCompact ? 'Panel erweitern' : 'Panel reduzieren';
    };

    applyUiKitPanelCompactMode(readUiKitPanelCompactMode());
    uiKitToggleBtn?.addEventListener('click', () => {
      const isCompact = !(uiKitPanel && uiKitPanel.classList.contains('is-compact'));
      applyUiKitPanelCompactMode(isCompact);
      writeUiKitPanelCompactMode(isCompact);
    });

    uiKitFooterBtn?.addEventListener('click', () => {
      const isNowVisible = !!(uiKitPanel && !uiKitPanel.hidden);
      const nextVisible = !isNowVisible;
      setUiKitPanelVisible(nextVisible);
      if (nextVisible) {
        const previewBody = documentRef?.getElementById('ui-kit-preview-body');
        const isEmpty = !previewBody || previewBody.childElementCount === 0;
        if (isEmpty && windowRef?.GQUIKit && typeof windowRef.GQUIKit.renderDemo === 'function') {
          windowRef.GQUIKit.renderDemo('buttons');
        }
      }
    });

    documentRef?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (uiKitPanel && !uiKitPanel.hidden) {
        setUiKitPanelVisible(false);
      }
    });

    documentRef?.addEventListener('click', (event) => {
      if (!uiKitPanel || uiKitPanel.hidden) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (uiKitPanel.contains(target)) return;
      if (uiKitFooterBtn && uiKitFooterBtn.contains(target)) return;
      setUiKitPanelVisible(false);
    });

    setUiKitPanelVisible(false);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initFooterUiKit };
  } else {
    window.GQRuntimeFooterUiKit = { initFooterUiKit };
  }
})();