/**
 * RuntimeGalaxyControllerFacade.js
 *
 * Creates the thin GalaxyController facade object.
 */

'use strict';

(function () {
  function facadeLog(level, message, meta = null) {
    try {
      const fn = window.GQLog && typeof window.GQLog[level] === 'function' ? window.GQLog[level] : null;
      if (fn) {
        fn('[galaxy-controller]', message, meta || {});
      } else {
        const method = (level === 'warn' || level === 'error' || level === 'info') ? level : 'log';
        console[method]('[GQ][galaxy-controller]', message, meta || {});
      }
    } catch (_) {}
  }

  function createGalaxyControllerFacade(opts = {}) {
    const wm = opts.wm;
    const init3DImpl = typeof opts.init3DImpl === 'function' ? opts.init3DImpl : (() => {});
    const getActions = typeof opts.getActions === 'function' ? opts.getActions : (() => null);
    const getNavigation = typeof opts.getNavigation === 'function' ? opts.getNavigation : (() => null);
    const getWindow = typeof opts.getWindow === 'function' ? opts.getWindow : (() => null);
    const getRenderWindowFlow = typeof opts.getRenderWindowFlow === 'function' ? opts.getRenderWindowFlow : (() => null);
    const getStarLoading = typeof opts.getStarLoading === 'function' ? opts.getStarLoading : (() => null);
    const getControlUi = typeof opts.getControlUi === 'function' ? opts.getControlUi : (() => null);
    const getDebugRenderer = typeof opts.getDebugRenderer === 'function' ? opts.getDebugRenderer : (() => null);

    const facade = {
      triggerNavAction(action, rootRef = null) {
        const actions = getActions();
        if (!actions || typeof actions.triggerNavAction !== 'function') return;
        actions.triggerNavAction(action, rootRef);
      },

      async jumpToSearchStar(star) {
        const navigation = getNavigation();
        if (!navigation || typeof navigation.jumpToSearchStar !== 'function') return;
        await navigation.jumpToSearchStar(star);
      },

      async focusHomeSystem(root, opts2 = {}) {
        const navigation = getNavigation();
        if (!navigation || typeof navigation.focusHomeSystem !== 'function') return;
        await navigation.focusHomeSystem(root, opts2);
      },

      init3D(root) {
        init3DImpl(root);
      },

      renderWindow() {
        const root = wm?.body?.('galaxy');
        if (!root) {
          facadeLog('warn', 'renderWindow:missing-root', {
            wmReady: !!wm,
            galaxyOpen: !!wm?.isOpen?.('galaxy'),
          });
          return;
        }

        const windowFacade = getWindow();
        if (windowFacade && typeof windowFacade.renderWindowShell === 'function') {
          windowFacade.renderWindowShell(root);
        }

        const renderWindowFlow = getRenderWindowFlow();
        if (renderWindowFlow && typeof renderWindowFlow.run === 'function') {
          renderWindowFlow.run(root);
        } else {
          facadeLog('warn', 'renderWindow:missing-flow', {
            hasWindowFlow: !!renderWindowFlow,
          });
        }
      },

      async loadStars3D(root) {
        const starLoading = getStarLoading();
        if (!starLoading || typeof starLoading.loadStars3D !== 'function') return;
        await starLoading.loadStars3D(root);
      },

      refreshDensityMetrics(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.refreshDensityMetrics !== 'function') return;
        controlUi.refreshDensityMetrics(root);
      },

      updateClusterBoundsUi(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.updateClusterBoundsUi !== 'function') return;
        controlUi.updateClusterBoundsUi(root);
      },

      updateClusterHeatmapUi(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.updateClusterHeatmapUi !== 'function') return;
        controlUi.updateClusterHeatmapUi(root);
      },

      updateCoreFxUi(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.updateCoreFxUi !== 'function') return;
        controlUi.updateCoreFxUi(root);
      },

      updateFleetVectorsUi(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.updateFleetVectorsUi !== 'function') return;
        controlUi.updateFleetVectorsUi(root);
      },

      updateLegacyFallbackUi(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.updateLegacyFallbackUi !== 'function') return;
        controlUi.updateLegacyFallbackUi(root);
      },

      updateFollowUi(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.updateFollowUi !== 'function') return;
        controlUi.updateFollowUi(root);
      },

      applyMagnetPreset(presetName, root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.applyMagnetPreset !== 'function') return;
        controlUi.applyMagnetPreset(presetName, root);
      },

      updateMagnetUi(root) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.updateMagnetUi !== 'function') return;
        controlUi.updateMagnetUi(root);
      },

      async refreshHealth(root, force) {
        const controlUi = getControlUi();
        if (!controlUi || typeof controlUi.refreshHealth !== 'function') return;
        await controlUi.refreshHealth(root, force);
      },

      get _debugRenderer() {
        return getDebugRenderer();
      },
    };

    return facade;
  }

  const api = {
    createGalaxyControllerFacade,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerFacade = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();