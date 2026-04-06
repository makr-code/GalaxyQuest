/**
 * StarLoadingHelpers.js
 *
 * Shared helper logic for galaxy star render application, probes and initial framing.
 */

'use strict';

(function () {
  const state = {
    getGalaxy3d: null,
    setGalaxy3d: null,
    getGalaxyStars: null,
    getUiState: null,
    getGalaxyAutoFramedOnce: null,
    setGalaxyAutoFramedOnce: null,
    uiConsolePush: null,
    inspectGalaxyCanvasLayering: null,
    pushGalaxyDebugError: null,
    getDisplayedGalaxyStars: null,
    getDisplayedGalaxyClusterSummary: null,
    getZoomTransitionContext: null,
    getPreferredLevelSharedRenderer: null,
    attachRendererCallbacks: null,
    getLevelRendererOptions: null,
    applyGalaxyOwnerHighlightToRenderer: null,
    resolveClusterColorPalette: null,
    getGalaxyFleets: null,
    getFtlMap: null,
    gameLog: null,
  };

  function configureGalaxyStarLoadingHelpersRuntime(opts = {}) {
    state.getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;
    state.setGalaxy3d = typeof opts.setGalaxy3d === 'function' ? opts.setGalaxy3d : null;
    state.getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : null;
    state.getUiState = typeof opts.getUiState === 'function' ? opts.getUiState : null;
    state.getGalaxyAutoFramedOnce = typeof opts.getGalaxyAutoFramedOnce === 'function' ? opts.getGalaxyAutoFramedOnce : null;
    state.setGalaxyAutoFramedOnce = typeof opts.setGalaxyAutoFramedOnce === 'function' ? opts.setGalaxyAutoFramedOnce : null;
    state.uiConsolePush = typeof opts.uiConsolePush === 'function' ? opts.uiConsolePush : null;
    state.inspectGalaxyCanvasLayering = typeof opts.inspectGalaxyCanvasLayering === 'function' ? opts.inspectGalaxyCanvasLayering : null;
    state.pushGalaxyDebugError = typeof opts.pushGalaxyDebugError === 'function' ? opts.pushGalaxyDebugError : null;
    state.getDisplayedGalaxyStars = typeof opts.getDisplayedGalaxyStars === 'function' ? opts.getDisplayedGalaxyStars : null;
    state.getDisplayedGalaxyClusterSummary = typeof opts.getDisplayedGalaxyClusterSummary === 'function' ? opts.getDisplayedGalaxyClusterSummary : null;
    state.getZoomTransitionContext = typeof opts.getZoomTransitionContext === 'function' ? opts.getZoomTransitionContext : null;
    state.getPreferredLevelSharedRenderer = typeof opts.getPreferredLevelSharedRenderer === 'function' ? opts.getPreferredLevelSharedRenderer : null;
    state.attachRendererCallbacks = typeof opts.attachRendererCallbacks === 'function' ? opts.attachRendererCallbacks : null;
    state.getLevelRendererOptions = typeof opts.getLevelRendererOptions === 'function' ? opts.getLevelRendererOptions : null;
    state.applyGalaxyOwnerHighlightToRenderer = typeof opts.applyGalaxyOwnerHighlightToRenderer === 'function' ? opts.applyGalaxyOwnerHighlightToRenderer : null;
    state.resolveClusterColorPalette = typeof opts.resolveClusterColorPalette === 'function' ? opts.resolveClusterColorPalette : null;
    state.getGalaxyFleets = typeof opts.getGalaxyFleets === 'function' ? opts.getGalaxyFleets : null;
    state.getFtlMap = typeof opts.getFtlMap === 'function' ? opts.getFtlMap : null;
    state.gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : null;
  }

  function getGalaxy3d() {
    return typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
  }

  function applyStarsToRenderer(opts = {}) {
    const stars = Array.isArray(opts.stars) ? opts.stars : [];
    const clusterSummary = Array.isArray(opts.clusterSummary) ? opts.clusterSummary : [];
    const contextLabel = String(opts.contextLabel || 'render');
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const galaxyMeta = opts.galaxyMeta || null;

    try {
      let galaxy3d = getGalaxy3d();
      const curGalaxy = galaxy3d?.stars?.length > 0 ? Number(galaxy3d.stars[0]?.galaxy_index || 0) : 0;
      const preserveView = curGalaxy > 0 && curGalaxy === galaxyIndex;
      const filteredStars = state.getDisplayedGalaxyStars ? state.getDisplayedGalaxyStars(stars) : stars;
      const displayedStars = (Array.isArray(filteredStars) && filteredStars.length === 0 && Array.isArray(stars) && stars.length > 0)
        ? stars
        : filteredStars;
      if (Array.isArray(filteredStars) && filteredStars.length === 0 && Array.isArray(stars) && stars.length > 0) {
        state.uiConsolePush?.('[galaxy] filter produced 0 stars; fallback to raw star payload.');
      }
      const displayedClusterSummary = state.getDisplayedGalaxyClusterSummary
        ? state.getDisplayedGalaxyClusterSummary(clusterSummary, displayedStars)
        : clusterSummary;

      const ftlMap = state.getFtlMap ? state.getFtlMap() : null;
      const ctx = state.getZoomTransitionContext ? state.getZoomTransitionContext() : {};
      const orchestrator = ctx.orchestrator;
      const galaxyLevel = ctx.ZOOM_LEVEL?.GALAXY;
      if (orchestrator && Number.isFinite(Number(galaxyLevel)) && typeof orchestrator.setSceneData === 'function') {
        Promise.resolve(orchestrator.setSceneData(galaxyLevel, {
          stars: displayedStars,
          clusterAuras: displayedClusterSummary || [],
          ftlInfrastructure: {
            gates: ftlMap?.gates || [],
            resonance_nodes: ftlMap?.resonance_nodes || [],
          },
          fleets: state.getGalaxyFleets ? state.getGalaxyFleets() : [],
          galaxyMetadata: galaxyMeta || null,
        })).catch(() => {});
        const sharedLevelRenderer = state.getPreferredLevelSharedRenderer ? state.getPreferredLevelSharedRenderer() : null;
        if (sharedLevelRenderer && galaxy3d !== sharedLevelRenderer) {
          galaxy3d = sharedLevelRenderer;
          state.setGalaxy3d?.(sharedLevelRenderer);
          state.attachRendererCallbacks?.(sharedLevelRenderer, state.getLevelRendererOptions ? state.getLevelRendererOptions() : {});
        }
      }

      if (!galaxy3d) return true;

      if (galaxyMeta && typeof galaxy3d.setGalaxyMetadata === 'function') {
        galaxy3d.setGalaxyMetadata(galaxyMeta);
      }
      galaxy3d.setStars(displayedStars, { preserveView });
      if (typeof galaxy3d.setGalaxyFleets === 'function') {
        galaxy3d.setGalaxyFleets(state.getGalaxyFleets ? state.getGalaxyFleets() : []);
      }
      if (typeof galaxy3d.setFtlInfrastructure === 'function') {
        galaxy3d.setFtlInfrastructure(ftlMap?.gates || [], ftlMap?.resonance_nodes || []);
      }
      if (typeof galaxy3d.setClusterColorPalette === 'function') {
        const uiState = state.getUiState ? state.getUiState() : {};
        galaxy3d.setClusterColorPalette(state.resolveClusterColorPalette ? state.resolveClusterColorPalette(uiState.territory) : null);
      }
      if (typeof galaxy3d.setClusterAuras === 'function') {
        galaxy3d.setClusterAuras(displayedClusterSummary || []);
      }
      state.applyGalaxyOwnerHighlightToRenderer?.(displayedStars);
      return true;
    } catch (err) {
      const msg = String(err?.message || err || 'renderer error');
      console.error('[GQ] Galaxy renderer failed', { context: contextLabel, error: err });
      state.pushGalaxyDebugError?.('galaxy-render', msg, contextLabel);
      return false;
    }
  }

  function emitRenderProbe(opts = {}) {
    const sourceLabel = String(opts.sourceLabel || 'unknown');
    const meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : {};
    const galaxyStars = state.getGalaxyStars ? state.getGalaxyStars() : [];
    const rawStars = Array.isArray(galaxyStars) ? galaxyStars.length : 0;
    const displayedStars = state.getDisplayedGalaxyStars ? state.getDisplayedGalaxyStars(galaxyStars) : galaxyStars;
    const filteredStars = Array.isArray(displayedStars) ? displayedStars.length : 0;
    const galaxy3d = getGalaxy3d();
    const stats = (galaxy3d && typeof galaxy3d.getRenderStats === 'function')
      ? galaxy3d.getRenderStats()
      : null;
    const visibleStars = Number(stats?.visibleStars || 0);
    const targetPoints = Number(stats?.targetPoints || 0);
    const densityMode = String(stats?.densityMode || 'n/a');
    const instanceId = String(stats?.instanceId || galaxy3d?.instanceId || 'n/a');
    const viewMode = stats?.systemMode ? 'system' : 'galaxy';
    state.uiConsolePush?.(`[galaxy] probe src=${sourceLabel} inst=${instanceId} raw=${rawStars} filtered=${filteredStars} visible=${visibleStars} target=${targetPoints} mode=${densityMode} view=${viewMode}`);

    if (meta && Object.keys(meta).length) {
      const extras = Object.entries(meta)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
      state.uiConsolePush?.(`[galaxy] meta ${extras}`);
    }

    if (filteredStars > 0 && visibleStars <= 0) {
      const diag = state.inspectGalaxyCanvasLayering ? state.inspectGalaxyCanvasLayering() : {};
      const topInfo = (diag.topElementsAtCanvas || [])
        .map((p) => `${p.x},${p.y}->${p.topTag}${p.topId ? '#' + p.topId : ''}`)
        .join(' | ');
      state.uiConsolePush?.(`[galaxy][warn] stars loaded but not visible. top=${topInfo || 'n/a'}`);
      state.pushGalaxyDebugError?.('galaxy-visible-zero', `raw=${rawStars} filtered=${filteredStars} visible=${visibleStars}`, sourceLabel);
    }
  }

  function ensureInitialGalaxyFrame() {
    if (state.getGalaxyAutoFramedOnce && state.getGalaxyAutoFramedOnce()) return;
    const galaxy3d = getGalaxy3d();
    if (!galaxy3d || typeof galaxy3d.fitCameraToStars !== 'function') return;
    const galaxyStars = state.getGalaxyStars ? state.getGalaxyStars() : [];
    if (!Array.isArray(galaxyStars) || galaxyStars.length === 0) return;
    state.setGalaxyAutoFramedOnce?.(true);
    setTimeout(() => {
      try {
        galaxy3d.fitCameraToStars(true, true);
      } catch (err) {
        state.gameLog?.('info', 'Galaxy3D fitCameraToStars fehlgeschlagen', err);
      }
    }, 30);
  }

  const api = {
    configureGalaxyStarLoadingHelpersRuntime,
    applyStarsToRenderer,
    emitRenderProbe,
    ensureInitialGalaxyFrame,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarLoadingHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
