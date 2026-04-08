/**
 * RuntimeMinimapFacade.js
 *
 * Composes all minimap runtime modules behind a small facade.
 */

'use strict';

(function () {
  function createMinimapFacade(opts = {}) {
    const requireApi = typeof opts.requireRuntimeApi === 'function'
      ? opts.requireRuntimeApi
      : (() => { throw new Error('RuntimeMinimapFacade: requireRuntimeApi is required'); });

    const minimapPad = Number(opts.minimapPad || 14) || 14;
    const minimapGridDivs = Number(opts.minimapGridDivs || 5) || 5;
    const minimapClickRadius = Number(opts.minimapClickRadius || 18) || 18;
    const minimapDragThreshold = Number(opts.minimapDragThreshold || 4) || 4;
    const minimapWorldScale = Number(opts.minimapWorldScale || 0.028) || 0.028;

    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const getMinimapCamera = typeof opts.getMinimapCamera === 'function' ? opts.getMinimapCamera : (() => ({}));
    const getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : (() => []);
    const getColonies = typeof opts.getColonies === 'function' ? opts.getColonies : (() => []);
    const getCurrentColony = typeof opts.getCurrentColony === 'function' ? opts.getCurrentColony : (() => null);
    const getUiState = typeof opts.getUiState === 'function' ? opts.getUiState : (() => ({}));
    const getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : (() => null);
    const setPinnedStar = typeof opts.setPinnedStar === 'function' ? opts.setPinnedStar : (() => {});
    const setActiveStar = typeof opts.setActiveStar === 'function' ? opts.setActiveStar : (() => {});
    const getStarClassColor = typeof opts.getStarClassColor === 'function' ? opts.getStarClassColor : (() => '#fff');
    const openWindow = typeof opts.openWindow === 'function' ? opts.openWindow : (() => {});
    const isWindowOpen = typeof opts.isWindowOpen === 'function' ? opts.isWindowOpen : (() => false);
    const getGalaxyBody = typeof opts.getGalaxyBody === 'function' ? opts.getGalaxyBody : (() => null);
    const renderGalaxyDetails = typeof opts.renderGalaxyDetails === 'function' ? opts.renderGalaxyDetails : (() => {});
    const isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : (() => false);
    const getTradeRoutes = typeof opts.getTradeRoutes === 'function' ? opts.getTradeRoutes : (() => []);
    const requestFrame = typeof opts.requestFrame === 'function'
      ? opts.requestFrame
      : (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : ((fn) => setTimeout(fn, 16)));

    const helpersApi = requireApi('GQRuntimeMinimapHelpers', ['createMinimapHelpers']);
    const cameraControlsApi = requireApi('GQRuntimeMinimapCameraControls', ['createMinimapCameraControls']);
    const overlayApi = requireApi('GQRuntimeMinimapOverlay', ['createMinimapOverlay']);
    const rendererApi = requireApi('GQRuntimeMinimapRenderer', ['createMinimapRenderer']);
    const interactionsApi = requireApi('GQRuntimeMinimapInteractions', ['createMinimapInteractions']);
    const loopApi = requireApi('GQRuntimeMinimapLoop', ['createMinimapLoop']);
    const seedApi = requireApi('GQRuntimeMinimapSeed', ['createMinimapSeed']);
    const domScaffoldApi = requireApi('GQRuntimeMinimapDomScaffold', ['createMinimapDomScaffold']);
    const navigationBindingApi = requireApi('GQRuntimeMinimapNavigationBinding', ['createMinimapNavigationBinding']);
    const renderOrchestratorApi = requireApi('GQRuntimeMinimapRenderOrchestrator', ['createMinimapRenderOrchestrator']);

    const minimapHelpers = helpersApi.createMinimapHelpers({
      worldScale: minimapWorldScale,
      minimapPad,
      getGalaxy3d,
      getMinimapCamera,
    });

    const minimapCameraControls = cameraControlsApi.createMinimapCameraControls({
      worldScale: minimapWorldScale,
      getGalaxy3d,
      getMinimapCamera,
      wm: {
        open: openWindow,
      },
    });

    function minimapProjectPoint(state, x, y) {
      return minimapHelpers.projectPoint(state, x, y);
    }

    function minimapClampCanvasPoint(state, point) {
      return minimapHelpers.clampCanvasPoint(state, point);
    }

    function minimapUnprojectPoint(state, px, py) {
      return minimapHelpers.unprojectPoint(state, px, py);
    }

    function resolveMinimapRendererPose() {
      return minimapHelpers.resolveRendererPose();
    }

    function setMinimapCameraTarget(targetX, targetY, immediate) {
      return minimapCameraControls.setTarget(targetX, targetY, immediate);
    }

    function zoomMinimapCamera(deltaY) {
      return minimapCameraControls.zoom(deltaY);
    }

    function queueMinimapCameraTarget(targetX, targetY, immediate) {
      minimapCameraControls.queueTarget(targetX, targetY, immediate);
    }

    const minimapOverlay = overlayApi.createMinimapOverlay({
      projectPoint: (state, x, y) => minimapProjectPoint(state, x, y),
      clampCanvasPoint: (state, point) => minimapClampCanvasPoint(state, point),
    });

    function drawMinimapCameraOverlay(ctx, state, pose) {
      minimapOverlay.drawCameraOverlay(ctx, state, pose);
    }

    const minimapRenderer = rendererApi.createMinimapRenderer({
      minimapPad,
      minimapGridDivs,
      getGalaxyStars,
      getColonies,
      getCurrentColony,
      getUiState,
      getPinnedStar,
      resolvePose: () => resolveMinimapRendererPose(),
      projectPoint: (state, x, y) => minimapProjectPoint(state, x, y),
      drawCameraOverlay: (ctx, state, pose) => drawMinimapCameraOverlay(ctx, state, pose),
      getStarClassColor,
      getTradeRoutes,
    });

    function drawMinimap(root, wrap, canvas, hud) {
      minimapRenderer.draw(root, wrap, canvas, hud);
    }

    const minimapInteractions = interactionsApi.createMinimapInteractions({
      dragThreshold: minimapDragThreshold,
      clickRadius: minimapClickRadius,
      resolvePose: () => resolveMinimapRendererPose(),
      unprojectPoint: (state, x, y) => minimapUnprojectPoint(state, x, y),
      projectPoint: (state, x, y) => minimapProjectPoint(state, x, y),
      setTarget: (targetX, targetY, immediate) => setMinimapCameraTarget(targetX, targetY, immediate),
      queueTarget: (targetX, targetY, immediate) => queueMinimapCameraTarget(targetX, targetY, immediate),
      zoom: (deltaY) => zoomMinimapCamera(deltaY),
      openGalaxyWindow: () => openWindow('galaxy'),
      dispatchNavigate: (detail) => {
        window.dispatchEvent(new CustomEvent('gq:minimap-navigate', { detail }));
      },
      getActiveGalaxy: () => Number(getUiState().activeGalaxy || 1),
    });

    function bindMinimapInteractions(root, canvas) {
      minimapInteractions.bind(root, canvas);
    }

    const minimapLoop = loopApi.createMinimapLoop({
      draw: (root, wrap, canvas, hud) => drawMinimap(root, wrap, canvas, hud),
      isMinimapOpen: () => isWindowOpen('minimap'),
      requestFrame,
    });

    function ensureMinimapLoop(root, wrap, canvas, hud) {
      minimapLoop.ensureLoop(root, wrap, canvas, hud);
    }

    const minimapSeed = seedApi.createMinimapSeed({
      getMinimapCamera,
      getActiveStar: () => getUiState().activeStar,
      getPinnedStar,
    });

    const minimapDomScaffold = domScaffoldApi.createMinimapDomScaffold();

    const minimapNavigationBinding = navigationBindingApi.createMinimapNavigationBinding({
      boundFlagKey: '__gqMinimapNavBound',
      eventName: 'gq:minimap-navigate',
      getGalaxyBody,
      getGalaxyStars,
      getGalaxy3d,
      setPinnedStar,
      setActiveStar,
      renderGalaxyDetails,
      isSystemModeActive,
    });

    const minimapRenderOrchestrator = renderOrchestratorApi.createMinimapRenderOrchestrator({
      seedIfNeeded: () => minimapSeed.seedIfNeeded(),
      ensureDom: (root) => minimapDomScaffold.ensure(root),
      bindInteractions: (root, canvas) => bindMinimapInteractions(root, canvas),
      draw: (root, wrap, canvas, hud) => drawMinimap(root, wrap, canvas, hud),
      ensureLoop: (root, wrap, canvas, hud) => ensureMinimapLoop(root, wrap, canvas, hud),
    });

    function render(root) {
      minimapRenderOrchestrator.render(root);
    }

    function bindNavigationOnce() {
      minimapNavigationBinding.bindOnce();
    }

    return {
      render,
      bindNavigationOnce,
    };
  }

  const api = {
    createMinimapFacade,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapFacade = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
