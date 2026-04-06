/**
 * RuntimeGalaxyControllerStarLoading.js
 *
 * Extracted GalaxyController star-loading facade.
 */

'use strict';

(function () {
  function createGalaxyControllerStarLoading(opts = {}) {
    const runtimeGalaxyStarLoaderFacadeApi = opts.runtimeGalaxyStarLoaderFacadeApi || {};

    async function loadStars3D(root) {
      if (typeof runtimeGalaxyStarLoaderFacadeApi.loadGalaxyStars3D !== 'function') return;
      await runtimeGalaxyStarLoaderFacadeApi.loadGalaxyStars3D({
        root,
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
    }

    return {
      loadStars3D,
    };
  }

  const api = {
    createGalaxyControllerStarLoading,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerStarLoading = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
