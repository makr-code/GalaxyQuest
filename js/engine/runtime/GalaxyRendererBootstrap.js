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

    const orchestrator = new SeamlessZoomOrchestrator(sharedCanvas, {
      rendererHint: settingsState.renderQualityProfile === 'webgpu' ? 'webgpu' : 'auto',
    });
    orchestrator.__gqBootstrapToken = bootstrapToken;

    if (typeof setOrchestrator === 'function') setOrchestrator(orchestrator);

    // Register WebGPU as the preferred path and keep Three.js as compatibility backend.
    orchestrator.register(ZOOM_LEVEL.GALAXY, {
      webgpu: levels.galaxyWebGPU,
      threejs: levels.galaxyThreeJS,
    });
    if (levels.systemThreeJS && levels.systemWebGPU) {
      orchestrator.register(ZOOM_LEVEL.SYSTEM, {
        webgpu: levels.systemWebGPU,
        threejs: levels.systemThreeJS,
      });
    }
    if (levels.planetThreeJS && levels.planetWebGPU) {
      orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, {
        webgpu: levels.planetWebGPU,
        threejs: levels.planetThreeJS,
      });
    }
    if (levels.colonyThreeJS && levels.colonyWebGPU) {
      orchestrator.register(ZOOM_LEVEL.COLONY_SURFACE, {
        webgpu: levels.colonyWebGPU,
        threejs: levels.colonyThreeJS,
      });
    }
    if (levels.objectThreeJS && levels.objectWebGPU) {
      orchestrator.register(ZOOM_LEVEL.OBJECT_APPROACH, {
        webgpu: levels.objectWebGPU,
        threejs: levels.objectThreeJS,
      });
    }
    const colonyBuildingThree = levels.colonyBuildingThreeJS || levels.objectThreeJS || null;
    const colonyBuildingWebGPU = levels.colonyBuildingWebGPU || levels.objectWebGPU || null;
    if (Number.isFinite(Number(ZOOM_LEVEL.COLONY_BUILDING)) && colonyBuildingThree && colonyBuildingWebGPU) {
      orchestrator.register(ZOOM_LEVEL.COLONY_BUILDING, {
        webgpu: colonyBuildingWebGPU,
        threejs: colonyBuildingThree,
      });
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
