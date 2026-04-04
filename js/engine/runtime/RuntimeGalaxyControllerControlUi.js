/**
 * RuntimeGalaxyControllerControlUi.js
 *
 * Extracted GalaxyController control-ui method delegates.
 */

'use strict';

(function () {
  function createGalaxyControllerControlUi(opts = {}) {
    const controlUiApi = opts.controlUiApi || {};

    function refreshDensityMetrics(root) {
      if (typeof controlUiApi.refreshDensityMetrics === 'function') {
        controlUiApi.refreshDensityMetrics(root);
      }
    }

    function updateClusterBoundsUi(root) {
      if (typeof controlUiApi.updateClusterBoundsUi === 'function') {
        controlUiApi.updateClusterBoundsUi(root);
      }
    }

    function updateClusterHeatmapUi(root) {
      if (typeof controlUiApi.updateClusterHeatmapUi === 'function') {
        controlUiApi.updateClusterHeatmapUi(root);
      }
    }

    function updateCoreFxUi(root) {
      if (typeof controlUiApi.updateCoreFxUi === 'function') {
        controlUiApi.updateCoreFxUi(root);
      }
    }

    function updateFleetVectorsUi(root) {
      if (typeof controlUiApi.updateFleetVectorsUi === 'function') {
        controlUiApi.updateFleetVectorsUi(root);
      }
    }

    function updateLegacyFallbackUi(root) {
      if (typeof controlUiApi.updateLegacyFallbackUi === 'function') {
        controlUiApi.updateLegacyFallbackUi(root);
      }
    }

    function updateFollowUi(root) {
      if (typeof controlUiApi.updateFollowUi === 'function') {
        controlUiApi.updateFollowUi(root);
      }
    }

    function applyMagnetPreset(presetName, root) {
      if (typeof controlUiApi.applyMagnetPreset === 'function') {
        controlUiApi.applyMagnetPreset(presetName, root);
      }
    }

    function updateMagnetUi(root) {
      if (typeof controlUiApi.updateMagnetUi === 'function') {
        controlUiApi.updateMagnetUi(root);
      }
    }

    async function refreshHealth(root, force) {
      if (typeof controlUiApi.refreshHealth === 'function') {
        await controlUiApi.refreshHealth(root, force);
      }
    }

    return {
      refreshDensityMetrics,
      updateClusterBoundsUi,
      updateClusterHeatmapUi,
      updateCoreFxUi,
      updateFleetVectorsUi,
      updateLegacyFallbackUi,
      updateFollowUi,
      applyMagnetPreset,
      updateMagnetUi,
      refreshHealth,
    };
  }

  const api = {
    createGalaxyControllerControlUi,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerControlUi = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
