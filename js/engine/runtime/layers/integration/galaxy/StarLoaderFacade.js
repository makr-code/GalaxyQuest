/**
 * StarLoaderFacade.js
 *
 * High-level orchestration facade for galaxy star loading.
 */

'use strict';

(function () {
  function loaderLog(opts, level, message, meta = null) {
    try {
      opts?.gameLog?.(level, `[galaxy-stars] ${message}`, meta || null);
    } catch (_) {}
    try {
      const fn = window.GQLog && typeof window.GQLog[level] === 'function' ? window.GQLog[level] : null;
      if (fn) fn('[galaxy-stars]', message, meta || {});
    } catch (_) {}
  }

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
    settingsState.clusterDensityMode = 'max';
    const clusterPreset = 'ultra';

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
    const hydrationUpperBound = Math.max(1, Number(galaxySystemMax || 0), Number(to || 0), Number(from || 0));
    loaderLog(opts, 'info', 'load:start', {
      g,
      from,
      to,
      cachedStars: cachedStars.length,
      fullRangeInModel,
      shouldRefreshNetwork,
      hydrationUpperBound,
    });
    if (!shouldRefreshNetwork && cachedStars && cachedStars.length) {
      statusApi.setPolicySkipStatus(details, from, to);
      // Always hydrate the currently visible range first so chunk updates become
      // visible immediately, then optionally backfill full range.
      opts.hydrateGalaxyRangeInBackground?.(root, g, from, to).catch((err) => {
        opts.gameLog?.('warn', 'Background-Hydration (initial-range) fehlgeschlagen', String(err?.message || err || 'unknown error'));
      });
      if (hydrationUpperBound > to) {
        window.setTimeout(() => {
          opts.hydrateGalaxyRangeInBackground?.(root, g, 1, hydrationUpperBound).catch((err) => {
            opts.gameLog?.('warn', 'Background-Hydration (initial-full) fehlgeschlagen', String(err?.message || err || 'unknown error'));
          });
        }, 220);
      }
      loaderLog(opts, 'info', 'load:cache-skip-network', { g, from, to, hydrationUpperBound });
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
        loaderLog(opts, 'warn', 'load:network-not-ok', {
          g,
          from,
          to,
          cls: cls.type,
        });
        statusApi.setNetworkErrorStatus(details, cls.type);
        if (cls.type === 'schema') {
          const issueList = Array.isArray(networkResult?.adapted?.issues)
            ? networkResult.adapted.issues.join(', ')
            : 'invalid payload';
          console.warn('[GQ] loadGalaxyStars3D: stars schema mismatch', issueList);
        }
        // Even when the direct request fails, try background hydration for the
        // current visible range so the view can recover from partial cache/API drift.
        opts.hydrateGalaxyRangeInBackground?.(root, g, from, to).catch((err) => {
          opts.gameLog?.('warn', 'Background-Hydration (network-not-ok) fehlgeschlagen', String(err?.message || err || 'unknown error'));
        });
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

      const hydrationUpperBoundAfterLoad = Math.max(1, Number(galaxySystemMax || 0), Number(to || 0), Number(from || 0));
      opts.hydrateGalaxyRangeInBackground?.(root, g, from, to).catch((err) => {
        opts.gameLog?.('warn', 'Background-Hydration (post-load-range) fehlgeschlagen', String(err?.message || err || 'unknown error'));
      });
      if (hydrationUpperBoundAfterLoad > to) {
        window.setTimeout(() => {
          opts.hydrateGalaxyRangeInBackground?.(root, g, 1, hydrationUpperBoundAfterLoad).catch((err) => {
            opts.gameLog?.('warn', 'Background-Hydration (post-load-full) fehlgeschlagen', String(err?.message || err || 'unknown error'));
          });
        }, 220);
      }
      loaderLog(opts, 'info', 'load:network-success', {
        g,
        from,
        to,
        stars: galaxyStars.length,
        systemMax: galaxySystemMax,
      });
    } catch (err) {
      const errMsg = String(err?.message || err || 'unknown error');
      loaderLog(opts, 'error', 'load:exception', {
        g,
        from,
        to,
        error: errMsg,
      });
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
        opts.hydrateGalaxyRangeInBackground?.(root, g, from, to).catch((hydrateErr) => {
          opts.gameLog?.('warn', 'Background-Hydration (fallback-handled) fehlgeschlagen', String(hydrateErr?.message || hydrateErr || 'unknown error'));
        });
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