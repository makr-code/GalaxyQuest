/**
 * RuntimeGalaxyStarErrorUi.js
 *
 * Encapsulates catch-path fallback rendering for galaxy star loading.
 */

'use strict';

(function () {
  const state = {
    mergeGalaxyStarsBySystem: null,
    assignClusterFactions: null,
    applyStarsToRenderer: null,
    renderGalaxyFallbackList: null,
    renderGalaxyColonySummary: null,
    refreshGalaxyDensityMetrics: null,
    emitRenderProbe: null,
    ensureInitialGalaxyFrame: null,
    getGalaxy3d: null,
    esc: null,
  };

  function configureGalaxyStarErrorUiRuntime(opts = {}) {
    state.mergeGalaxyStarsBySystem = typeof opts.mergeGalaxyStarsBySystem === 'function' ? opts.mergeGalaxyStarsBySystem : null;
    state.assignClusterFactions = typeof opts.assignClusterFactions === 'function' ? opts.assignClusterFactions : null;
    state.applyStarsToRenderer = typeof opts.applyStarsToRenderer === 'function' ? opts.applyStarsToRenderer : null;
    state.renderGalaxyFallbackList = typeof opts.renderGalaxyFallbackList === 'function' ? opts.renderGalaxyFallbackList : null;
    state.renderGalaxyColonySummary = typeof opts.renderGalaxyColonySummary === 'function' ? opts.renderGalaxyColonySummary : null;
    state.refreshGalaxyDensityMetrics = typeof opts.refreshGalaxyDensityMetrics === 'function' ? opts.refreshGalaxyDensityMetrics : null;
    state.emitRenderProbe = typeof opts.emitRenderProbe === 'function' ? opts.emitRenderProbe : null;
    state.ensureInitialGalaxyFrame = typeof opts.ensureInitialGalaxyFrame === 'function' ? opts.ensureInitialGalaxyFrame : null;
    state.getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;
    state.esc = typeof opts.esc === 'function' ? opts.esc : null;
  }

  function applyRecoveredFallback(opts = {}) {
    const root = opts.root || null;
    const details = opts.details || null;
    const from = Number(opts.from || 0);
    const to = Number(opts.to || 0);
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const errMsg = String(opts.errMsg || 'unknown error');
    const fallbackStars = Array.isArray(opts.fallbackStars) ? opts.fallbackStars : [];
    const currentGalaxyStars = Array.isArray(opts.galaxyStars) ? opts.galaxyStars : [];
    const uiState = opts.uiState && typeof opts.uiState === 'object' ? opts.uiState : {};

    if (!fallbackStars.length) {
      return { handled: false, galaxyStars: currentGalaxyStars };
    }

    const mergeGalaxyStarsBySystemFn = typeof opts.mergeGalaxyStarsBySystem === 'function'
      ? opts.mergeGalaxyStarsBySystem
      : state.mergeGalaxyStarsBySystem;
    const assignClusterFactionsFn = typeof opts.assignClusterFactions === 'function'
      ? opts.assignClusterFactions
      : state.assignClusterFactions;
    const applyStarsToRendererFn = typeof opts.applyStarsToRenderer === 'function'
      ? opts.applyStarsToRenderer
      : state.applyStarsToRenderer;
    const renderGalaxyFallbackListFn = typeof opts.renderGalaxyFallbackList === 'function'
      ? opts.renderGalaxyFallbackList
      : state.renderGalaxyFallbackList;
    const renderGalaxyColonySummaryFn = typeof opts.renderGalaxyColonySummary === 'function'
      ? opts.renderGalaxyColonySummary
      : state.renderGalaxyColonySummary;
    const refreshGalaxyDensityMetricsFn = typeof opts.refreshGalaxyDensityMetrics === 'function'
      ? opts.refreshGalaxyDensityMetrics
      : state.refreshGalaxyDensityMetrics;
    const emitRenderProbeFn = typeof opts.emitRenderProbe === 'function'
      ? opts.emitRenderProbe
      : state.emitRenderProbe;
    const ensureInitialGalaxyFrameFn = typeof opts.ensureInitialGalaxyFrame === 'function'
      ? opts.ensureInitialGalaxyFrame
      : state.ensureInitialGalaxyFrame;

    const mergedStars = mergeGalaxyStarsBySystemFn
      ? mergeGalaxyStarsBySystemFn(currentGalaxyStars, fallbackStars, galaxyIndex)
      : fallbackStars;
    const clusterSummary = assignClusterFactionsFn
      ? assignClusterFactionsFn(uiState.rawClusters || [], uiState.territory)
      : (uiState.clusterSummary || []);
    uiState.clusterSummary = clusterSummary;

    const rendered = applyStarsToRendererFn
      ? !!applyStarsToRendererFn(mergedStars, clusterSummary, 'error-fallback')
      : false;

    if (!rendered) {
      renderGalaxyFallbackListFn?.(root, mergedStars, from, to, `network error (fallback): ${errMsg}`);
    } else {
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      if (!galaxy3d?.systemMode) {
        renderGalaxyColonySummaryFn?.(root?.querySelector?.('#galaxy-planets-panel') || null, mergedStars, { from, to });
      }
    }

    if (details) {
      details.innerHTML = `<span class="text-yellow">Netzwerkfehler bei ${from}..${to}; nutze lokalen Fallback mit ${mergedStars.length} Sternen.</span>`;
    }

    refreshGalaxyDensityMetricsFn?.(root);
    emitRenderProbeFn?.('error-fallback', {
      from,
      to,
      fallbackCount: fallbackStars.length,
    });
    ensureInitialGalaxyFrameFn?.();

    return { handled: true, galaxyStars: mergedStars };
  }

  function renderTerminalFailure(opts = {}) {
    const root = opts.root || null;
    const details = opts.details || null;
    const from = Number(opts.from || 0);
    const to = Number(opts.to || 0);
    const errMsg = String(opts.errMsg || 'unknown error');
    const galaxyStars = Array.isArray(opts.galaxyStars) ? opts.galaxyStars : [];

    if (details) {
      const safeErr = state.esc ? state.esc(errMsg) : errMsg;
      details.innerHTML = `<span class="text-red">Failed to load stars: ${safeErr}</span>`;
    }
    state.renderGalaxyFallbackList?.(root, galaxyStars, from, to, errMsg);
  }

  const api = {
    configureGalaxyStarErrorUiRuntime,
    applyRecoveredFallback,
    renderTerminalFailure,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarErrorUi = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();