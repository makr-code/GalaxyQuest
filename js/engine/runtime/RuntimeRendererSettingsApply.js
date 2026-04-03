/**
 * RuntimeRendererSettingsApply.js
 *
 * Applies runtime settings to the active galaxy renderer.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function applyRendererRuntimeSettings(opts = {}) {
    const {
      renderer = null,
      settingsState = {},
      galaxy3dQualityState = null,
      callRendererMethod = () => false,
      hasRendererMethod = () => false,
    } = opts;

    if (!renderer) return;

    if (!callRendererMethod('setTransitionsEnabled', !!settingsState.autoTransitions)) {
      renderer.transitionsEnabled = !!settingsState.autoTransitions;
    }

    if (!callRendererMethod('setHoverMagnetConfig', {
      enabled: !!settingsState.hoverMagnetEnabled,
      clickEnabled: !!settingsState.clickMagnetEnabled,
      starPx: Number(settingsState.hoverMagnetStarPx || 24),
      planetPx: Number(settingsState.hoverMagnetPlanetPx || 30),
      clusterPx: Number(settingsState.hoverMagnetClusterPx || 28),
    })) {
      renderer.hoverMagnetEnabled = !!settingsState.hoverMagnetEnabled;
      renderer.clickMagnetEnabled = !!settingsState.clickMagnetEnabled;
      renderer.hoverMagnetStarPx = Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)));
      renderer.hoverMagnetPlanetPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)));
      renderer.hoverMagnetClusterPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)));
    }

    renderer.persistentHoverDistance = Math.max(120, Number(settingsState.persistentHoverDistance || 220));
    renderer.transitionStableMinMs = Math.max(60, Number(settingsState.transitionStableMinMs || 160));

    callRendererMethod('setClusterDensityMode', settingsState.clusterDensityMode || 'auto', {
      recluster: true,
      preserveView: true,
    });
    callRendererMethod('setOrbitSimulationMode', settingsState.orbitSimulationMode || 'auto');
    callRendererMethod('setClusterBoundsVisible', settingsState.clusterBoundsVisible !== false);
    callRendererMethod('setClusterHeatmapEnabled', settingsState.clusterHeatmapEnabled !== false);
    callRendererMethod('setGalaxyFleetVectorsVisible', settingsState.galaxyFleetVectorsVisible !== false);
    callRendererMethod('setSystemOrbitPathsVisible', settingsState.systemOrbitPathsVisible !== false);
    callRendererMethod('setSystemOrbitMarkersVisible', settingsState.systemOrbitMarkersVisible !== false);
    callRendererMethod('setSystemOrbitFocusOnly', settingsState.systemOrbitFocusOnly === true);

    if (hasRendererMethod('setGalacticCoreFxEnabled')) {
      const autoCoreFx = settingsState.galacticCoreFxAuto !== false;
      const recommendedCoreFx = galaxy3dQualityState?.features?.galacticCoreFx;
      const shouldEnableCoreFx = autoCoreFx && recommendedCoreFx === false
        ? false
        : (settingsState.galacticCoreFxEnabled !== false);
      callRendererMethod('setGalacticCoreFxEnabled', shouldEnableCoreFx);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { applyRendererRuntimeSettings };
  } else {
    window.GQRuntimeRendererSettingsApply = { applyRendererRuntimeSettings };
  }
})();
