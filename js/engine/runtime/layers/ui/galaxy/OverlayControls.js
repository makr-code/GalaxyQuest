/**
 * OverlayControls.js
 *
 * Galaxy overlay controls (toggle, draggable overlays, hotkeys, nav action trigger).
 */

'use strict';

(function () {
  const state = {
    windowRef: null,
    documentRef: null,
    wmIsOpen: null,
    wmBody: null,
    wmOpen: null,
    wmClose: null,
    showToast: null,
    getGalaxy3d: null,
    updateGalaxyFollowUi: null,
    getSettingsState: null,
    applyRuntimeSettings: null,
    updateFleetVectorsUi: null,
    saveUiSettings: null,
    renderGalaxySystemDetails: null,
    getPinnedStar: null,
    getActiveStar: null,
    isSystemModeActive: null,
    getHotkeysBound: null,
    setHotkeysBound: null,
    triggerNavAction: null,
  };

  function configureGalaxyOverlayControlsRuntime(opts = {}) {
    state.windowRef = opts.windowRef || window;
    state.documentRef = opts.documentRef || document;
    state.wmIsOpen = typeof opts.wmIsOpen === 'function' ? opts.wmIsOpen : null;
    state.wmBody = typeof opts.wmBody === 'function' ? opts.wmBody : null;
    state.wmOpen = typeof opts.wmOpen === 'function' ? opts.wmOpen : null;
    state.wmClose = typeof opts.wmClose === 'function' ? opts.wmClose : null;
    state.showToast = typeof opts.showToast === 'function' ? opts.showToast : null;
    state.getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;
    state.updateGalaxyFollowUi = typeof opts.updateGalaxyFollowUi === 'function' ? opts.updateGalaxyFollowUi : null;
    state.getSettingsState = typeof opts.getSettingsState === 'function' ? opts.getSettingsState : null;
    state.applyRuntimeSettings = typeof opts.applyRuntimeSettings === 'function' ? opts.applyRuntimeSettings : null;
    state.updateFleetVectorsUi = typeof opts.updateFleetVectorsUi === 'function' ? opts.updateFleetVectorsUi : null;
    state.saveUiSettings = typeof opts.saveUiSettings === 'function' ? opts.saveUiSettings : null;
    state.renderGalaxySystemDetails = typeof opts.renderGalaxySystemDetails === 'function' ? opts.renderGalaxySystemDetails : null;
    state.getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : null;
    state.getActiveStar = typeof opts.getActiveStar === 'function' ? opts.getActiveStar : null;
    state.isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : null;
    state.getHotkeysBound = typeof opts.getHotkeysBound === 'function' ? opts.getHotkeysBound : null;
    state.setHotkeysBound = typeof opts.setHotkeysBound === 'function' ? opts.setHotkeysBound : null;
    state.triggerNavAction = typeof opts.triggerNavAction === 'function' ? opts.triggerNavAction : null;
  }

  function toggleGalaxyOverlay(root, selector, forceVisible) {
    if (selector === '#galaxy-info-overlay') {
      const isOpen = typeof state.wmIsOpen === 'function' ? !!state.wmIsOpen('galaxy-info') : false;
      if (forceVisible === false) {
        state.wmClose?.('galaxy-info');
        return false;
      }
      return isOpen;
    }
    if (!root) return false;
    const el = root.querySelector(selector);
    if (!el) return false;
    const nextVisible = typeof forceVisible === 'boolean'
      ? forceVisible
      : el.classList.contains('hidden');
    el.classList.toggle('hidden', !nextVisible);
    return nextVisible;
  }

  function makeGalaxyOverlayDraggable(root, selector) {
    const overlay = root?.querySelector(selector);
    const head = overlay?.querySelector('.galaxy-overlay-head');
    const stage = root?.querySelector('.galaxy-3d-stage');
    if (!overlay || !head || !stage || overlay.dataset.dragBound === '1') return;
    overlay.dataset.dragBound = '1';

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const getStageRect = () => stage.getBoundingClientRect();
    const startDrag = (clientX, clientY) => {
      const rect = overlay.getBoundingClientRect();
      dragging = true;
      offsetX = clientX - rect.left;
      offsetY = clientY - rect.top;
    };

    const doDrag = (clientX, clientY) => {
      if (!dragging) return;
      const stageRect = getStageRect();
      const maxLeft = Math.max(0, stage.clientWidth - overlay.offsetWidth);
      const maxTop = Math.max(0, stage.clientHeight - overlay.offsetHeight);
      const left = Math.max(0, Math.min(clientX - stageRect.left - offsetX, maxLeft));
      const top = Math.max(0, Math.min(clientY - stageRect.top - offsetY, maxTop));
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
    };

    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      startDrag(e.clientX, e.clientY);
      e.preventDefault();
    });

    state.windowRef.addEventListener('mousemove', (e) => doDrag(e.clientX, e.clientY));
    state.windowRef.addEventListener('mouseup', () => { dragging = false; });

    head.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });

    state.windowRef.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!t) return;
      doDrag(t.clientX, t.clientY);
    }, { passive: true });
    state.windowRef.addEventListener('touchend', () => { dragging = false; });
  }

  function bindGalaxyOverlayHotkeys() {
    const alreadyBound = typeof state.getHotkeysBound === 'function' ? !!state.getHotkeysBound() : false;
    if (alreadyBound) return;
    if (typeof state.setHotkeysBound === 'function') {
      state.setHotkeysBound(true);
    }

    state.windowRef.addEventListener('keydown', (e) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (!(typeof state.wmIsOpen === 'function' && state.wmIsOpen('galaxy'))) return;

      const root = typeof state.wmBody === 'function' ? state.wmBody('galaxy') : null;
      if (!root) return;

      const k = String(e.key || '').toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        const opened = toggleGalaxyOverlay(root, '#galaxy-controls-overlay');
        if (opened && typeof state.showToast === 'function') state.showToast('Galaxy controls overlay opened (O to toggle).', 'info');
      } else if (k === 'i') {
        e.preventDefault();
        if (typeof state.showToast === 'function') {
          state.showToast('Galaxy Intel wird nur ueber den Taskleisten-Button ein-/ausgeblendet.', 'info');
        }
      } else if (k === 'escape') {
        toggleGalaxyOverlay(root, '#galaxy-controls-overlay', false);
        toggleGalaxyOverlay(root, '#galaxy-info-overlay', false);
        const card = state.documentRef.getElementById('galaxy-hover-card');
        if (card) card.classList.add('hidden');
      } else if (k === 'l') {
        e.preventDefault();
        const renderer = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
        const enabled = renderer && typeof renderer.toggleFollowSelection === 'function'
          ? renderer.toggleFollowSelection()
          : false;
        if (typeof state.updateGalaxyFollowUi === 'function') {
          state.updateGalaxyFollowUi(root);
        }
        if (typeof state.showToast === 'function') {
          state.showToast(`Selection follow ${enabled ? 'enabled' : 'disabled'} (L to toggle).`, 'info');
        }
      } else if (k === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
        if (!settingsState) return;
        settingsState.galaxyFleetVectorsVisible = !(settingsState.galaxyFleetVectorsVisible !== false);
        if (typeof state.applyRuntimeSettings === 'function') {
          state.applyRuntimeSettings();
        }
        if (typeof state.updateFleetVectorsUi === 'function') {
          state.updateFleetVectorsUi(root);
        }
        if (root?.querySelector('#galaxy-system-details') && typeof state.renderGalaxySystemDetails === 'function') {
          const pinnedStar = typeof state.getPinnedStar === 'function' ? state.getPinnedStar() : null;
          const activeStar = typeof state.getActiveStar === 'function' ? state.getActiveStar() : null;
          const isSystemMode = typeof state.isSystemModeActive === 'function' ? state.isSystemModeActive() : false;
          state.renderGalaxySystemDetails(root, pinnedStar || activeStar || null, isSystemMode);
        }
        if (typeof state.saveUiSettings === 'function') {
          state.saveUiSettings();
        }
        if (typeof state.showToast === 'function') {
          state.showToast(`Fleet-Vektoren: ${settingsState.galaxyFleetVectorsVisible ? 'an' : 'aus'} (V zum Umschalten).`, 'info');
        }
      }
    });
  }

  function triggerGalaxyNavAction(action, rootRef = null) {
    if (typeof state.triggerNavAction === 'function') {
      state.triggerNavAction(action, rootRef);
    }
  }

  const api = {
    configureGalaxyOverlayControlsRuntime,
    toggleGalaxyOverlay,
    makeGalaxyOverlayDraggable,
    bindGalaxyOverlayHotkeys,
    triggerGalaxyNavAction,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyOverlayControls = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
