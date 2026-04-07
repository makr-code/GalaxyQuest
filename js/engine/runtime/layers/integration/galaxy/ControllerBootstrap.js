/**
 * ControllerBootstrap.js
 *
 * Central bootstrap wiring for GalaxyController runtime modules.
 */

'use strict';

(function () {
  function createGalaxyControllerBootstrap(opts = {}) {
    const wm = opts.wm;

    const runtimeGalaxyControllerFacadeApi = opts.runtimeGalaxyControllerFacadeApi || {};
    const runtimeGalaxyControllerStarLoadingApi = opts.runtimeGalaxyControllerStarLoadingApi || {};
    const runtimeGalaxyControllerControlUiApi = opts.runtimeGalaxyControllerControlUiApi || {};
    const runtimeGalaxyControllerWindowApi = opts.runtimeGalaxyControllerWindowApi || {};
    const runtimeGalaxyControllerRenderWindowFlowApi = opts.runtimeGalaxyControllerRenderWindowFlowApi || {};
    const runtimeGalaxyControllerActionsApi = opts.runtimeGalaxyControllerActionsApi || {};
    const runtimeGalaxyControllerNavigationApi = opts.runtimeGalaxyControllerNavigationApi || {};

    const runtimeGalaxyInit3DFacadeApi = opts.runtimeGalaxyInit3DFacadeApi || {};
    const runtimeGalaxyStarLoaderFacadeApi = opts.runtimeGalaxyStarLoaderFacadeApi || {};
    const runtimeGalaxyControlUiApi = opts.runtimeGalaxyControlUiApi || {};
    const runtimeGalaxyWindowBindingsApi = opts.runtimeGalaxyWindowBindingsApi || {};

    let galaxyControllerNavigation = null;
    let galaxyControllerActions = null;
    let galaxyControllerWindow = null;
    let galaxyControllerRenderWindowFlow = null;
    let galaxyControllerControlUi = null;
    let galaxyControllerStarLoading = null;

    const galaxyController = runtimeGalaxyControllerFacadeApi.createGalaxyControllerFacade({
      wm,
      init3DImpl: (root) => runtimeGalaxyInit3DFacadeApi.initGalaxy3D(root),
      getActions: () => galaxyControllerActions,
      getNavigation: () => galaxyControllerNavigation,
      getWindow: () => galaxyControllerWindow,
      getRenderWindowFlow: () => galaxyControllerRenderWindowFlow,
      getStarLoading: () => galaxyControllerStarLoading,
      getControlUi: () => galaxyControllerControlUi,
      getDebugRenderer: () => opts.getGalaxy3d(),
    });

    galaxyControllerStarLoading = runtimeGalaxyControllerStarLoadingApi.createGalaxyControllerStarLoading({
      runtimeGalaxyStarLoaderFacadeApi,
      isPolicyModeAuto: opts.isPolicyModeAuto,
      applyPolicyMode: opts.applyPolicyMode,
      refreshPolicyUi: opts.refreshPolicyUi,
      getGalaxyStars: opts.getGalaxyStars,
      setGalaxyStars: opts.setGalaxyStars,
      getUiState: opts.getUiState,
      setGalaxyContext: opts.setGalaxyContext,
      getStarsPolicy: opts.getStarsPolicy,
      getSettingsState: opts.getSettingsState,
      getRenderDataAdapter: opts.getRenderDataAdapter,
      getExpectedAssetsManifestVersion: opts.getExpectedAssetsManifestVersion,
      getGalaxySystemMax: opts.getGalaxySystemMax,
      setGalaxySystemMax: opts.setGalaxySystemMax,
      isCurrentUserAdmin: opts.isCurrentUserAdmin,
      mergeGalaxyStarsBySystem: opts.mergeGalaxyStarsBySystem,
      assignClusterFactions: opts.assignClusterFactions,
      renderGalaxyFallbackList: opts.renderGalaxyFallbackList,
      renderGalaxyColonySummary: opts.renderGalaxyColonySummary,
      refreshGalaxyDensityMetrics: opts.refreshGalaxyDensityMetrics,
      getGalaxy3d: opts.getGalaxy3d,
      isSystemModeActive: opts.isSystemModeActive,
      hydrateGalaxyRangeInBackground: opts.hydrateGalaxyRangeInBackground,
      gameLog: opts.gameLog,
      pushGalaxyDebugError: opts.pushGalaxyDebugError,
      getGalaxy3dInitReason: opts.getGalaxy3dInitReason,
      runtimeGalaxyStarUiStatusApi: opts.runtimeGalaxyStarUiStatusApi,
      runtimeGalaxyStarBootstrapPreflightApi: opts.runtimeGalaxyStarBootstrapPreflightApi,
      runtimeGalaxyStarLoadingHelpersApi: opts.runtimeGalaxyStarLoadingHelpersApi,
      runtimeGalaxyStarTerritorySyncApi: opts.runtimeGalaxyStarTerritorySyncApi,
      runtimeGalaxyStarCacheReadApi: opts.runtimeGalaxyStarCacheReadApi,
      runtimeGalaxyStarFlowOrchestratorApi: opts.runtimeGalaxyStarFlowOrchestratorApi,
      runtimeGalaxyStarNetworkFlowApi: opts.runtimeGalaxyStarNetworkFlowApi,
      runtimeGalaxyStarPersistenceApi: opts.runtimeGalaxyStarPersistenceApi,
      runtimeGalaxyStarFallbackRecoveryApi: opts.runtimeGalaxyStarFallbackRecoveryApi,
      runtimeGalaxyStarErrorUiApi: opts.runtimeGalaxyStarErrorUiApi,
    });

    galaxyControllerControlUi = runtimeGalaxyControllerControlUiApi.createGalaxyControllerControlUi({
      controlUiApi: runtimeGalaxyControlUiApi,
    });

    galaxyControllerWindow = runtimeGalaxyControllerWindowApi.createGalaxyControllerWindow({
      wm,
      galaxySystemMax: opts.galaxySystemMax,
      getActivePolicyMode: opts.getActivePolicyMode,
      getActivePolicyProfile: opts.getActivePolicyProfile,
      policyProfiles: opts.policyProfiles,
      settingsState: opts.settingsState,
      bindGalaxyWindowControls: (root) => runtimeGalaxyWindowBindingsApi.bindGalaxyWindowControls(root),
    });

    galaxyControllerRenderWindowFlow = runtimeGalaxyControllerRenderWindowFlowApi.createGalaxyControllerRenderWindowFlow({
      getGalaxyHealthLastCheckMs: opts.getGalaxyHealthLastCheckMs,
      refreshGalaxyHealth: opts.refreshGalaxyHealth,
      bindGalaxyNavOrb: opts.bindGalaxyNavOrb,
      getGalaxy3d: opts.getGalaxy3d,
      documentRef: opts.documentRef,
      init3D: (root) => galaxyController.init3D(root),
      loadStars3D: (root) => galaxyController.loadStars3D(root),
      showGalaxyShortcutsHintOnce: opts.showGalaxyShortcutsHintOnce,
      scheduleFleetLegendHint: opts.scheduleFleetLegendHint,
      refreshGalaxyDensityMetrics: opts.refreshGalaxyDensityMetrics,
      updateGalaxyFollowUi: opts.updateGalaxyFollowUi,
      updateClusterBoundsUi: opts.updateClusterBoundsUi,
      updateClusterHeatmapUi: (root) => galaxyController.updateClusterHeatmapUi(root),
      updateGalaxyColonyFilterUi: opts.updateGalaxyColonyFilterUi,
      updateCoreFxUi: (root) => galaxyController.updateCoreFxUi(root),
      updateFleetVectorsUi: (root) => galaxyController.updateFleetVectorsUi(root),
      updateLegacyFallbackUi: (root) => galaxyController.updateLegacyFallbackUi(root),
      updateMagnetUi: (root) => galaxyController.updateMagnetUi(root),
    });

    galaxyControllerActions = runtimeGalaxyControllerActionsApi.createGalaxyControllerActions({
      wm,
      getGalaxy3d: opts.getGalaxy3d,
      init3D: (root) => galaxyController.init3D(root),
      loadStars3D: (root) => galaxyController.loadStars3D(root),
      showToast: opts.showToast,
      gameLog: opts.gameLog,
      getAudioManager: opts.getAudioManager,
      runRendererNavAction: opts.runRendererNavAction,
      settingsState: opts.settingsState,
      settingsController: opts.settingsController,
      updateGalaxyFollowUi: opts.updateGalaxyFollowUi,
      refreshGalaxyDensityMetrics: opts.refreshGalaxyDensityMetrics,
      callRendererMethod: opts.callRendererMethod,
      focusHomeSystem: (root) => galaxyController.focusHomeSystem(root),
      getPinnedStar: opts.getPinnedStar,
      uiState: opts.uiState,
      toggleGalaxyOverlay: opts.toggleGalaxyOverlay,
      renderGalaxySystemDetails: opts.renderGalaxySystemDetails,
      loadStarSystemPlanets: opts.loadStarSystemPlanets,
      isSystemModeActive: opts.isSystemModeActive,
      transitionOutOfSystemView: opts.transitionOutOfSystemView,
    });

    galaxyControllerNavigation = runtimeGalaxyControllerNavigationApi.createGalaxyControllerNavigation({
      closeTopbarSearchOverlay: opts.closeTopbarSearchOverlay,
      getTopbarSearchDom: opts.getTopbarSearchDom,
      wm,
      uiState: opts.uiState,
      loadGalaxyStars3D: opts.loadGalaxyStars3D,
      getGalaxyStars: opts.getGalaxyStars,
      getPinnedStar: opts.getPinnedStar,
      setPinnedStar: opts.setPinnedStar,
      setGalaxyContext: opts.setGalaxyContext,
      runPhysicsCinematicFlight: opts.runPhysicsCinematicFlight,
      getGalaxy3d: opts.getGalaxy3d,
      toggleGalaxyOverlay: opts.toggleGalaxyOverlay,
      renderGalaxySystemDetails: opts.renderGalaxySystemDetails,
      loadStarSystemPlanets: opts.loadStarSystemPlanets,
      showToast: opts.showToast,
      colonies: opts.colonies,
      getCurrentColony: opts.getCurrentColony,
      galaxySystemMax: opts.galaxySystemMax,
      settingsState: opts.settingsState,
      selectColonyById: opts.selectColonyById,
      gameLog: opts.gameLog,
      isSystemModeActive: opts.isSystemModeActive,
      waitMs: opts.waitMs,
      focusSystemPlanetInView: opts.focusSystemPlanetInView,
    });

    return {
      galaxyController,
      getNavigation: () => galaxyControllerNavigation,
      getActions: () => galaxyControllerActions,
    };
  }

  const api = {
    createGalaxyControllerBootstrap,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerBootstrap = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
