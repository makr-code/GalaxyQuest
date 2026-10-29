/**
 * GalaxyRendererBootstrap.js
 *
 * Dedicated orchestration bootstrap for the galaxy seamless zoom stack.
 * Keeps heavy registration/init logic out of runtime/game.js.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function bootstrapSeamlessZoomOrchestrator(opts = {}) {
    const {
      currentOrchestrator = null,
      setOrchestrator = null,
      getCurrentOrchestrator = null,
      sharedCanvas = null,
      settingsState = {},
      rendererCtor = null,
      rendererContainer = null,
      rendererOptions = {},
      SeamlessZoomOrchestrator = null,
      ZOOM_LEVEL = null,
      levels = {},
      adoptSharedRendererIfAvailable = null,
      initDirectRendererFallback = null,
      onDisposeError = null,
      onInitFailed = null,
    } = opts;

    if (!(sharedCanvas instanceof HTMLCanvasElement)) return currentOrchestrator;
    if (!SeamlessZoomOrchestrator || !ZOOM_LEVEL) return currentOrchestrator;

    const bootstrapToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sharedCanvas.__gqOrchestratorBootstrapToken = bootstrapToken;

    function isCurrentBootstrap(candidate) {
      if (sharedCanvas.__gqOrchestratorBootstrapToken !== bootstrapToken) {
        return false;
      }
      if (typeof getCurrentOrchestrator === 'function') {
        try {
          return getCurrentOrchestrator() === candidate;
        } catch (_) {
          return false;
        }
      }
      return true;
    }

    if (currentOrchestrator) {
      try {
        currentOrchestrator.dispose();
      } catch (err) {
        if (typeof onDisposeError === 'function') onDisposeError(err);
      }
    }

    const sharedRenderer = typeof rendererCtor === 'function'
      ? new rendererCtor(rendererContainer || sharedCanvas.parentElement, {
          ...rendererOptions,
          externalCanvas: sharedCanvas,
          interactive: true,
        })
      : null;
    const orchestrator = new SeamlessZoomOrchestrator(sharedCanvas, {
      rendererHint: 'webgpu',
      backend: sharedRenderer,
      requireSharedBackend: true,
    });
    orchestrator.__gqBootstrapToken = bootstrapToken;

    if (typeof setOrchestrator === 'function') setOrchestrator(orchestrator);

    // WebGPU implementations can now ship independently of their legacy fallback.
    const registerLevel = (level, webgpu, threejs) => {
      if (webgpu || threejs) {
        orchestrator.register(level, { webgpu, threejs });
      }
    };
    registerLevel(ZOOM_LEVEL.GALAXY, levels.galaxyWebGPU, levels.galaxyThreeJS);
    registerLevel(ZOOM_LEVEL.SYSTEM, levels.systemWebGPU, levels.systemThreeJS);
    registerLevel(ZOOM_LEVEL.PLANET_APPROACH, levels.planetWebGPU, levels.planetThreeJS);
    registerLevel(ZOOM_LEVEL.COLONY_SURFACE, levels.colonyWebGPU, levels.colonyThreeJS);
    registerLevel(ZOOM_LEVEL.OBJECT_APPROACH, levels.objectWebGPU, levels.objectThreeJS);
    const colonyBuildingThree = levels.colonyBuildingThreeJS || levels.objectThreeJS || null;
    const colonyBuildingWebGPU = levels.colonyBuildingWebGPU || levels.objectWebGPU || null;
    if (Number.isFinite(Number(ZOOM_LEVEL.COLONY_BUILDING))) {
      registerLevel(ZOOM_LEVEL.COLONY_BUILDING, colonyBuildingWebGPU, colonyBuildingThree);
    }

    orchestrator.initialize()
      .then(() => {
        if (!isCurrentBootstrap(orchestrator)) {
          return;
        }
        try {
          orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null)
            .then(() => {
              if (!isCurrentBootstrap(orchestrator)) {
                return;
              }
              if (typeof adoptSharedRendererIfAvailable === 'function') {
                adoptSharedRendererIfAvailable();
              }
            })
            .catch((err) => {
              if (!isCurrentBootstrap(orchestrator)) {
                return;
              }
              if (typeof onInitFailed === 'function') {
                onInitFailed(err || new Error('SeamlessZoomOrchestrator zoomTo(GALAXY) failed'));
              }
              if (typeof initDirectRendererFallback === 'function') {
                initDirectRendererFallback();
              }
            });
        } catch (err) {
          if (typeof onInitFailed === 'function') {
            onInitFailed(err || new Error('SeamlessZoomOrchestrator zoomTo(GALAXY) threw'));
          }
          if (typeof initDirectRendererFallback === 'function') {
            initDirectRendererFallback();
          }
        }
      })
      .catch((err) => {
        if (!isCurrentBootstrap(orchestrator)) {
          return;
        }
        if (typeof setOrchestrator === 'function') setOrchestrator(null);
        if (typeof onInitFailed === 'function') onInitFailed(err);
        if (typeof initDirectRendererFallback === 'function') initDirectRendererFallback();
      });

    return orchestrator;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bootstrapSeamlessZoomOrchestrator };
  } else {
    window.GQGalaxyRendererBootstrap = { bootstrapSeamlessZoomOrchestrator };
  }
})();
