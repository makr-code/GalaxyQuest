/**
 * RuntimeGalaxyControllerActions.js
 *
 * Extracted GalaxyController action dispatcher.
 */

'use strict';

(function () {
  function createGalaxyControllerActions(opts = {}) {
    const wm = opts.wm;
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const init3D = typeof opts.init3D === 'function' ? opts.init3D : (() => {});
    const loadStars3D = typeof opts.loadStars3D === 'function' ? opts.loadStars3D : (async () => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const getAudioManager = typeof opts.getAudioManager === 'function' ? opts.getAudioManager : (() => null);
    const runRendererNavAction = typeof opts.runRendererNavAction === 'function' ? opts.runRendererNavAction : (() => false);
    const settingsState = opts.settingsState || {};
    const settingsController = opts.settingsController || {};
    const updateGalaxyFollowUi = typeof opts.updateGalaxyFollowUi === 'function' ? opts.updateGalaxyFollowUi : (() => {});
    const refreshGalaxyDensityMetrics = typeof opts.refreshGalaxyDensityMetrics === 'function' ? opts.refreshGalaxyDensityMetrics : (() => {});
    const callRendererMethod = typeof opts.callRendererMethod === 'function' ? opts.callRendererMethod : (() => false);
    const focusHomeSystem = typeof opts.focusHomeSystem === 'function' ? opts.focusHomeSystem : (async () => {});
    const getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : (() => null);
    const uiState = opts.uiState || {};
    const toggleGalaxyOverlay = typeof opts.toggleGalaxyOverlay === 'function' ? opts.toggleGalaxyOverlay : (() => {});
    const renderGalaxySystemDetails = typeof opts.renderGalaxySystemDetails === 'function' ? opts.renderGalaxySystemDetails : (() => {});
    const loadStarSystemPlanets = typeof opts.loadStarSystemPlanets === 'function' ? opts.loadStarSystemPlanets : (async () => {});
    const isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : (() => false);
    const transitionOutOfSystemView = typeof opts.transitionOutOfSystemView === 'function' ? opts.transitionOutOfSystemView : (() => {});

    function triggerNavAction(action, rootRef = null) {
      const root = rootRef || wm.body('galaxy');
      const galaxy3dInitial = getGalaxy3d();
      if (!galaxy3dInitial && root) {
        init3D(root);
        const galaxy3dAfterInit = getGalaxy3d();
        if (galaxy3dAfterInit) {
          loadStars3D(root).catch((err) => {
            gameLog('warn', 'Galaxy 3D Sterneladen fehlgeschlagen', err);
          });
        }
      }
      if (!getGalaxy3d()) {
        showToast('3D-Renderer ist noch nicht bereit.', 'warning');
        return;
      }
      const normalized = String(action || '');
      const audioManager = getAudioManager();
      if (audioManager) audioManager.playUiClick();
      if (runRendererNavAction(normalized)) {
        return;
      }

      if (normalized === 'toggle-vectors') {
        settingsState.galaxyFleetVectorsVisible = !(settingsState.galaxyFleetVectorsVisible !== false);
        if (typeof settingsController.applyRuntimeSettings === 'function') {
          settingsController.applyRuntimeSettings();
        }
        if (root) updateGalaxyFollowUi(root);
        return;
      }

      if (normalized === 'optimize-view' && root) {
        settingsState.clusterDensityMode = 'auto';
        settingsState.renderQualityProfile = 'auto';
        if (typeof settingsController.applyRuntimeSettings === 'function') {
          settingsController.applyRuntimeSettings();
        }
        refreshGalaxyDensityMetrics(root);
        showToast('Darstellung optimiert (Auto-Profil).', 'info');
        return;
      }

      if (normalized === 'reset') {
        callRendererMethod('resetNavigationView');
        return;
      }
      if (normalized === 'focus') {
        callRendererMethod('focusCurrentSelection');
        return;
      }
      if (normalized === 'home' && root) {
        focusHomeSystem(root).catch(() => {});
        return;
      }
      if (normalized === 'enter-system') {
        const activeStar = getPinnedStar() || uiState.activeStar || null;
        if (activeStar && root) {
          toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
          renderGalaxySystemDetails(root, activeStar, true);
          loadStarSystemPlanets(root, activeStar);
        }
        return;
      }
      if (normalized === 'exit-system') {
        const activeStar = getPinnedStar() || uiState.activeStar || null;
        if (isSystemModeActive()) {
          transitionOutOfSystemView(activeStar, 'triggerNavAction:exit-system');
        }
        if (root) {
          renderGalaxySystemDetails(root, activeStar, false);
        }
      }
    }

    return {
      triggerNavAction,
    };
  }

  const api = {
    createGalaxyControllerActions,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerActions = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
