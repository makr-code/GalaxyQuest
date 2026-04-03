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

    if (typeof setOrchestrator === 'function') setOrchestrator(orchestrator);

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

    orchestrator.initialize()
      .then(() => {
        try {
          orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null)
            .then(() => {
              if (typeof adoptSharedRendererIfAvailable === 'function') {
                adoptSharedRendererIfAvailable();
              }
            })
            .catch(() => {});
        } catch (_) {}
      })
      .catch((err) => {
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
