/**
 * RuntimeGalaxyStarFlowOrchestrator.js
 *
 * Applies cache-hit and network-success flow segments for galaxy star loading.
 */

'use strict';

(function () {
  function applyCacheHit(opts = {}) {
    const root = opts.root || null;
    const details = opts.details || null;
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const fromSystem = Number(opts.fromSystem || 0);
    const toSystem = Number(opts.toSystem || 0);
    const fullRangeInModel = !!opts.fullRangeInModel;
    const cachedStars = Array.isArray(opts.cachedStars) ? opts.cachedStars : [];
    let galaxyStars = Array.isArray(opts.galaxyStars) ? opts.galaxyStars : [];
    const uiState = opts.uiState && typeof opts.uiState === 'object' ? opts.uiState : {};

    const mergeGalaxyStarsBySystem = typeof opts.mergeGalaxyStarsBySystem === 'function' ? opts.mergeGalaxyStarsBySystem : null;
    const assignClusterFactions = typeof opts.assignClusterFactions === 'function' ? opts.assignClusterFactions : null;
    const applyStarsToRenderer = typeof opts.applyStarsToRenderer === 'function' ? opts.applyStarsToRenderer : null;
    const renderGalaxyFallbackList = typeof opts.renderGalaxyFallbackList === 'function' ? opts.renderGalaxyFallbackList : null;
    const renderGalaxyColonySummary = typeof opts.renderGalaxyColonySummary === 'function' ? opts.renderGalaxyColonySummary : null;
    const setCacheStatus = typeof opts.setCacheStatus === 'function' ? opts.setCacheStatus : null;
    const refreshGalaxyDensityMetrics = typeof opts.refreshGalaxyDensityMetrics === 'function' ? opts.refreshGalaxyDensityMetrics : null;
    const emitRenderProbe = typeof opts.emitRenderProbe === 'function' ? opts.emitRenderProbe : null;
    const ensureInitialGalaxyFrame = typeof opts.ensureInitialGalaxyFrame === 'function' ? opts.ensureInitialGalaxyFrame : null;
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;

    if (!cachedStars.length) {
      return { galaxyStars, cacheApplied: false };
    }

    galaxyStars = mergeGalaxyStarsBySystem ? mergeGalaxyStarsBySystem(galaxyStars, cachedStars, galaxyIndex) : cachedStars;
    uiState.clusterSummary = assignClusterFactions
      ? assignClusterFactions(uiState.rawClusters || [], uiState.territory)
      : (uiState.clusterSummary || []);
    const rendered = applyStarsToRenderer ? !!applyStarsToRenderer(galaxyStars, uiState.clusterSummary, 'cache') : false;

    if (!rendered) {
      renderGalaxyFallbackList?.(root, galaxyStars, fromSystem, toSystem, '3D renderer unavailable (cache fallback)');
    } else {
      const galaxy3d = getGalaxy3d ? getGalaxy3d() : null;
      if (!galaxy3d?.systemMode) {
        renderGalaxyColonySummary?.(root?.querySelector?.('#galaxy-planets-panel') || null, galaxyStars, { from: fromSystem, to: toSystem });
      }
    }

    setCacheStatus?.(details, galaxyStars.length, fullRangeInModel);
    refreshGalaxyDensityMetrics?.(root);
    emitRenderProbe?.('cache', {
      fullRange: fullRangeInModel,
      from: fromSystem,
      to: toSystem,
    });
    ensureInitialGalaxyFrame?.();

    return { galaxyStars, cacheApplied: true };
  }

  async function applyNetworkSuccess(opts = {}) {
    const root = opts.root || null;
    const details = opts.details || null;
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const fromSystem = Number(opts.fromSystem || 0);
    const toSystem = Number(opts.toSystem || 0);
    const data = opts.data && typeof opts.data === 'object' ? opts.data : {};
    const mergedNetwork = opts.mergedNetwork && typeof opts.mergedNetwork === 'object' ? opts.mergedNetwork : {};
    let galaxyStars = Array.isArray(opts.galaxyStars) ? opts.galaxyStars : [];
    let galaxySystemMax = Number(opts.galaxySystemMax || 0);
    const uiState = opts.uiState && typeof opts.uiState === 'object' ? opts.uiState : {};

    const syncTerritoryForGalaxy = typeof opts.syncTerritoryForGalaxy === 'function' ? opts.syncTerritoryForGalaxy : null;
    const assignClusterFactions = typeof opts.assignClusterFactions === 'function' ? opts.assignClusterFactions : null;
    const persistNetworkStars = typeof opts.persistNetworkStars === 'function' ? opts.persistNetworkStars : null;
    const applyStarsToRenderer = typeof opts.applyStarsToRenderer === 'function' ? opts.applyStarsToRenderer : null;
    const renderGalaxyFallbackList = typeof opts.renderGalaxyFallbackList === 'function' ? opts.renderGalaxyFallbackList : null;
    const renderGalaxyColonySummary = typeof opts.renderGalaxyColonySummary === 'function' ? opts.renderGalaxyColonySummary : null;
    const setLoadedStatus = typeof opts.setLoadedStatus === 'function' ? opts.setLoadedStatus : null;
    const setRangeInputMax = typeof opts.setRangeInputMax === 'function' ? opts.setRangeInputMax : null;
    const refreshGalaxyDensityMetrics = typeof opts.refreshGalaxyDensityMetrics === 'function' ? opts.refreshGalaxyDensityMetrics : null;
    const emitRenderProbe = typeof opts.emitRenderProbe === 'function' ? opts.emitRenderProbe : null;
    const ensureInitialGalaxyFrame = typeof opts.ensureInitialGalaxyFrame === 'function' ? opts.ensureInitialGalaxyFrame : null;
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;
    const isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : null;
    const fallbackReason = String(opts.fallbackReason || 'renderer unavailable');

    galaxyStars = Array.isArray(mergedNetwork.stars) ? mergedNetwork.stars : galaxyStars;
    const reportedSystemMax = Number(mergedNetwork.reportedSystemMax || 0);
    if (reportedSystemMax > 0) {
      galaxySystemMax = Math.max(galaxySystemMax, reportedSystemMax);
    }

    uiState.territory = syncTerritoryForGalaxy
      ? await syncTerritoryForGalaxy(galaxyIndex)
      : (uiState.territory || []);
    uiState.rawClusters = Array.isArray(data.clusters) ? data.clusters : [];
    uiState.clusterSummary = assignClusterFactions
      ? assignClusterFactions(uiState.rawClusters, uiState.territory)
      : (uiState.clusterSummary || []);

    persistNetworkStars?.({
      galaxyIndex,
      fromSystem,
      toSystem,
      data,
      galaxyStars,
    });

    const rendered = applyStarsToRenderer
      ? !!applyStarsToRenderer(galaxyStars, uiState.clusterSummary, 'network')
      : false;
    if (!rendered || !(getGalaxy3d && getGalaxy3d())) {
      renderGalaxyFallbackList?.(root, galaxyStars, fromSystem, toSystem, fallbackReason);
    } else if (!(isSystemModeActive && isSystemModeActive())) {
      renderGalaxyColonySummary?.(root?.querySelector?.('#galaxy-planets-panel') || null, galaxyStars, { from: fromSystem, to: toSystem });
    }

    setLoadedStatus?.(details, galaxyStars.length, fromSystem, toSystem, data.stride);
    setRangeInputMax?.(root, galaxySystemMax);
    refreshGalaxyDensityMetrics?.(root);
    emitRenderProbe?.('network', {
      from: fromSystem,
      to: toSystem,
      stride: data.stride,
      count: data.count,
      cacheMode: data.cache_mode || 'n/a',
    });
    ensureInitialGalaxyFrame?.();

    return {
      galaxyStars,
      galaxySystemMax,
    };
  }

  const api = {
    applyCacheHit,
    applyNetworkSuccess,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarFlowOrchestrator = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();