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

    documentRef.getElementById('footer-nav-orb-btn')?.classList.toggle('active', !!wm?.isOpen?.('nav-orb'));
    documentRef?.getElementById('footer-nav-orb-btn')?.addEventListener('click', () => {
      if (!wm) return;
      if (wm.isOpen('nav-orb')) wm.close('nav-orb');
      else wm.open('nav-orb');
      documentRef.getElementById('footer-nav-orb-btn')?.classList.toggle('active', wm.isOpen('nav-orb'));
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

    // ── System Bodies Card Window context-menu button ─────────────────
    const systemCardBtn = documentRef?.getElementById('footer-system-cards-btn');
    if (systemCardBtn && wm && typeof wm.contextMenu === 'function') {
      systemCardBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = systemCardBtn.getBoundingClientRect();
        wm.contextMenu(
          [
            {
              label: 'System Bodies — Card View',
              onSelect: () => {
                if (typeof wm.open === 'function') wm.open('system-bodies-cards');
              },
            },
            {
              label: 'Stellaris System Overview',
              onSelect: () => {
                const sso = documentRef?.getElementById('stellaris-system-overview');
                if (sso) sso.classList.toggle('sso-visible');
              },
            },
          ],
          {
            title: 'System Views',
            x: Math.max(8, Number(rect.left || 0)),
            y: Math.max(8, Number(rect.top  || 0) - 4),
          }
        );
        systemCardBtn.classList.add('active');
      });
    }

    // ── WM Statusbar widget (optional, requires WM.widgets) ──────────────
    const statusBarSlot = documentRef?.getElementById('footer-wm-statusbar');
    if (statusBarSlot && wm && typeof wm.widgets?.statusBar === 'function') {
      const wmStatusBar = wm.widgets.statusBar(statusBarSlot, {
        items: [
          { id: 'wm-sb-focused', text: '—', title: 'Aktives Fenster' },
          { id: 'wm-sb-open-count', text: '', title: 'Geöffnete Fenster' },
        ],
      });

      const updateStatusBar = () => {
        try {
          // Active window: look for the focused task button
          const focusedTaskBtn = documentRef?.querySelector('.wm-task-btn.wm-task-active .wm-task-label');
          const focusedLabel = focusedTaskBtn ? String(focusedTaskBtn.textContent || '').trim() : '—';
          wmStatusBar?.setItemText?.('wm-sb-focused', focusedLabel || '—');

          // Open windows count
          const taskBtns = documentRef?.querySelectorAll('.wm-task-btn');
          const openCount = taskBtns ? taskBtns.length : 0;
          wmStatusBar?.setItemText?.('wm-sb-open-count', openCount > 0 ? `${openCount} offen` : '');
        } catch (_) {}
      };

      // Update on WM focus changes (taskbar mutation) and periodically
      const taskbar = documentRef?.getElementById('wm-taskbar');
      if (taskbar && typeof MutationObserver !== 'undefined') {
        new MutationObserver(updateStatusBar).observe(taskbar, {
          childList: true, subtree: true, attributes: true,
          attributeFilter: ['class'],
        });
      } else {
        windowRef?.setInterval?.(updateStatusBar, 2000);
      }

      updateStatusBar();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initFooterUiKit };
  } else {
    window.GQRuntimeFooterUiKit = { initFooterUiKit };
  }
})();