/**
 * RuntimeGalaxyStarLoaderFacade.js
 *
 * High-level orchestration facade for galaxy star loading.
 */

'use strict';

(function () {
  async function loadGalaxyStars3D(opts = {}) {
    const root = opts.root || null;
    if (!root) return;

    const details = root.querySelector('#galaxy-system-details');

    if (opts.isPolicyModeAuto?.()) {
      opts.applyPolicyMode?.('auto');
      opts.refreshPolicyUi?.(root);
    }

    const g = parseInt(root.querySelector('#gal-galaxy')?.value, 10) || 1;
    const from = Math.max(1, parseInt(root.querySelector('#gal-from')?.value, 10) || 1);
    let to = Math.max(from, parseInt(root.querySelector('#gal-to')?.value, 10) || from);

    let galaxyStars = Array.isArray(opts.getGalaxyStars?.()) ? opts.getGalaxyStars() : [];
    if (galaxyStars.length && Number(galaxyStars[0]?.galaxy_index || 0) !== g) {
      galaxyStars = [];
      opts.setGalaxyStars?.(galaxyStars);
    }

    const uiState = opts.getUiState?.() || {};
    uiState.activeRange = { from, to };
    opts.setGalaxyContext?.(g, uiState.activeSystem || from, uiState.activeStar);

    const starsPolicy = opts.getStarsPolicy?.() || { cacheMaxAgeMs: 0, maxPoints: 1500, alwaysRefreshNetwork: false };
    let requestMaxPoints = Number(starsPolicy.maxPoints || 1500);
    let galaxyMeta = null;
    const settingsState = opts.getSettingsState?.() || {};
    const densityMode = String(settingsState.clusterDensityMode || 'auto').toLowerCase();
    const clusterPreset = densityMode === 'max'
      ? 'ultra'
      : (densityMode === 'high' ? 'high' : 'auto');

    const renderDataAdapter = opts.getRenderDataAdapter?.() || null;
    const expectedAssetsManifestVersion = Number(opts.getExpectedAssetsManifestVersion?.() || 1);
    let galaxySystemMax = Number(opts.getGalaxySystemMax?.() || 0);

    const statusApi = opts.runtimeGalaxyStarUiStatusApi;
    const preflightApi = opts.runtimeGalaxyStarBootstrapPreflightApi;
    const loadingHelpersApi = opts.runtimeGalaxyStarLoadingHelpersApi;
    const territorySyncApi = opts.runtimeGalaxyStarTerritorySyncApi;
    const cacheReadApi = opts.runtimeGalaxyStarCacheReadApi;
    const flowOrchestratorApi = opts.runtimeGalaxyStarFlowOrchestratorApi;
    const networkFlowApi = opts.runtimeGalaxyStarNetworkFlowApi;
    const persistenceApi = opts.runtimeGalaxyStarPersistenceApi;
    const fallbackRecoveryApi = opts.runtimeGalaxyStarFallbackRecoveryApi;
    const errorUiApi = opts.runtimeGalaxyStarErrorUiApi;

    statusApi?.setLoadingStatus?.(details);

    const preflight = await preflightApi.runBootstrapPreflight({
      root,
      details,
      galaxyIndex: g,
      fromSystem: from,
      toSystem: to,
      requestMaxPoints,
      galaxySystemMax,
      assetsManifestVersion: Number(uiState.assetsManifestVersion || 0),
      expectedAssetsManifestVersion,
      renderDataAdapter,
    });
    to = Number(preflight.toSystem || to);
    requestMaxPoints = Number(preflight.requestMaxPoints || requestMaxPoints);
    galaxySystemMax = Number(preflight.galaxySystemMax || galaxySystemMax);
    if (Number(preflight.assetsManifestVersion || 0) > 0) {
      uiState.assetsManifestVersion = Number(preflight.assetsManifestVersion);
    }
    if (preflight.rangeChanged) {
      uiState.activeRange = { from, to };
    }
    opts.setGalaxySystemMax?.(galaxySystemMax);

    const applyStarsToRenderer = (stars, clusterSummary, contextLabel = 'render') => loadingHelpersApi.applyStarsToRenderer({
      stars,
      clusterSummary,
      contextLabel,
      galaxyIndex: g,
      galaxyMeta,
    });

    galaxyMeta = await territorySyncApi.loadGalaxyMetadata(g);

    const emitRenderProbe = (sourceLabel, meta = {}) => loadingHelpersApi.emitRenderProbe({
      sourceLabel,
      meta,
    });

    const ensureInitialGalaxyFrame = () => loadingHelpersApi.ensureInitialGalaxyFrame();

    const cacheSnapshot = await cacheReadApi.loadCachedStarRange({
      galaxyIndex: g,
      fromSystem: from,
      toSystem: to,
      cacheMaxAgeMs: starsPolicy.cacheMaxAgeMs,
    });
    let cachedStars = cacheSnapshot.cachedStars;
    const fullRangeInModel = !!cacheSnapshot.fullRangeInModel;

    const cacheResult = flowOrchestratorApi.applyCacheHit({
      root,
      details,
      galaxyIndex: g,
      fromSystem: from,
      toSystem: to,
      fullRangeInModel,
      cachedStars,
      galaxyStars,
      uiState,
      mergeGalaxyStarsBySystem: opts.mergeGalaxyStarsBySystem,
      assignClusterFactions: opts.assignClusterFactions,
      applyStarsToRenderer,
      renderGalaxyFallbackList: opts.renderGalaxyFallbackList,
      renderGalaxyColonySummary: opts.renderGalaxyColonySummary,
      setCacheStatus: (d, count, full) => statusApi.setCacheStatus(d, count, full),
      refreshGalaxyDensityMetrics: opts.refreshGalaxyDensityMetrics,
      emitRenderProbe,
      ensureInitialGalaxyFrame,
      getGalaxy3d: opts.getGalaxy3d,
    });
    galaxyStars = cacheResult.galaxyStars;
    opts.setGalaxyStars?.(galaxyStars);

    const shouldRefreshNetwork = !!opts.isCurrentUserAdmin?.() || !!starsPolicy.alwaysRefreshNetwork || !fullRangeInModel;
    if (!shouldRefreshNetwork && cachedStars && cachedStars.length) {
      statusApi.setPolicySkipStatus(details, from, to);
      opts.hydrateGalaxyRangeInBackground?.(root, g, 1, galaxySystemMax).catch((err) => {
        opts.gameLog?.('info', 'Background-Hydration (initial) fehlgeschlagen', err);
      });
      return;
    }

    try {
      const networkResult = await networkFlowApi.fetchAdaptedGalaxyStars({
        galaxyIndex: g,
        fromSystem: from,
        toSystem: to,
        requestMaxPoints,
        clusterPreset,
        systemMax: galaxySystemMax,
        assetsManifestVersion: uiState.assetsManifestVersion,
        renderDataAdapter,
      });
      if (!networkResult?.ok) {
        const cls = networkResult?.cls || { type: 'schema' };
        statusApi.setNetworkErrorStatus(details, cls.type);
        if (cls.type === 'schema') {
          const issueList = Array.isArray(networkResult?.adapted?.issues)
            ? networkResult.adapted.issues.join(', ')
            : 'invalid payload';
          console.warn('[GQ] loadGalaxyStars3D: stars schema mismatch', issueList);
        }
        return;
      }

      const data = networkResult.data;
      if (data.stale) {
        statusApi.setStaleStatus(details);
      }

      const mergedNetwork = networkFlowApi.mergeNetworkPayloadIntoStars({
        galaxyIndex: g,
        currentStars: galaxyStars,
        data,
      });

      const networkApplyResult = await flowOrchestratorApi.applyNetworkSuccess({
        root,
        details,
        galaxyIndex: g,
        fromSystem: from,
        toSystem: to,
        data,
        mergedNetwork,
        galaxyStars,
        galaxySystemMax,
        uiState,
        syncTerritoryForGalaxy: (galaxyIndex) => territorySyncApi.syncTerritoryForGalaxy(galaxyIndex),
        assignClusterFactions: opts.assignClusterFactions,
        persistNetworkStars: (payload) => persistenceApi.persistNetworkStars(payload),
        applyStarsToRenderer,
        renderGalaxyFallbackList: opts.renderGalaxyFallbackList,
        renderGalaxyColonySummary: opts.renderGalaxyColonySummary,
        setLoadedStatus: (d, count, fromSystem, toSystem, stride) => statusApi.setLoadedStatus(d, count, fromSystem, toSystem, stride),
        setRangeInputMax: (r, max) => statusApi.setRangeInputMax(r, max),
        refreshGalaxyDensityMetrics: opts.refreshGalaxyDensityMetrics,
        emitRenderProbe,
        ensureInitialGalaxyFrame,
        getGalaxy3d: opts.getGalaxy3d,
        isSystemModeActive: opts.isSystemModeActive,
        fallbackReason: (opts.getGalaxy3dInitReason?.() || 'renderer unavailable'),
      });

      galaxyStars = networkApplyResult.galaxyStars;
      galaxySystemMax = networkApplyResult.galaxySystemMax;
      opts.setGalaxyStars?.(galaxyStars);
      opts.setGalaxySystemMax?.(galaxySystemMax);

      opts.hydrateGalaxyRangeInBackground?.(root, g, 1, galaxySystemMax).catch((err) => {
        opts.gameLog?.('info', 'Background-Hydration (post-load) fehlgeschlagen', err);
      });
    } catch (err) {
      const errMsg = String(err?.message || err || 'unknown error');
      opts.pushGalaxyDebugError?.('galaxy-stars', errMsg, `${from}..${to}`);

      const fallbackStars = await fallbackRecoveryApi.recoverFallbackStars({
        galaxyIndex: g,
        galaxySystemMax,
        cachedStars,
        currentStars: galaxyStars,
      });

      const fallbackUiResult = errorUiApi.applyRecoveredFallback({
        root,
        details,
        from,
        to,
        galaxyIndex: g,
        errMsg,
        fallbackStars,
        galaxyStars,
        uiState,
        applyStarsToRenderer,
        emitRenderProbe,
        ensureInitialGalaxyFrame,
      });
      galaxyStars = fallbackUiResult.galaxyStars;
      opts.setGalaxyStars?.(galaxyStars);
      if (fallbackUiResult.handled) {
        return;
      }

      errorUiApi.renderTerminalFailure({
        root,
        details,
        from,
        to,
        errMsg,
        galaxyStars,
      });
    }
  }

  const api = {
    loadGalaxyStars3D,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarLoaderFacade = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();