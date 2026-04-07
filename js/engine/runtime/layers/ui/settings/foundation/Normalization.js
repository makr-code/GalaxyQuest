/**
 * Normalization.js
 *
 * Normalizes persisted runtime/UI settings after load.
 */

'use strict';

(function () {
  const DEFAULT_SFX_MAP = {
    uiClick: 'sfx/mixkit-video-game-retro-click-237.wav',
    uiConfirm: 'sfx/mixkit-quick-positive-video-game-notification-interface-265.wav',
    uiError: 'sfx/mixkit-negative-game-notification-249.wav',
    uiNotify: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
    navigation: 'sfx/mixkit-sci-fi-warp-slide-3113.wav',
    pvpToggle: 'sfx/mixkit-horn-suspense-transition-3112.wav',
    researchStart: 'sfx/mixkit-unlock-new-item-game-notification-254.wav',
    researchComplete: 'sfx/mixkit-casino-bling-achievement-2067.wav',
    fleetRecall: 'sfx/mixkit-space-shot-whoosh-3001.wav',
    messageSend: 'sfx/mixkit-space-coin-win-notification-271.wav',
    messageRead: 'sfx/mixkit-sci-fi-positive-notification-266.wav',
    messageDelete: 'sfx/mixkit-falling-hit-757.wav',
    fleetAttack: 'sfx/mixkit-laser-gun-shot-3110.wav',
    fleetTransport: 'sfx/mixkit-space-deploy-whizz-3003.wav',
    fleetSpy: 'sfx/mixkit-night-vision-starting-2476.wav',
    fleetColonize: 'sfx/mixkit-medieval-show-fanfare-announcement-226.wav',
    fleetHarvest: 'sfx/mixkit-space-plasma-shot-3002.wav',
    buildComplete: 'sfx/mixkit-bonus-earned-in-video-game-2058.wav',
    fleetLaunch: 'sfx/mixkit-space-deploy-whizz-3003.wav',
  };

  function normalizeLoadedUiSettings(settingsState, opts = {}) {
    const {
      persisted = null,
      applyTransitionPreset = null,
      normalizeHexColor = (value, fallback) => String(value || fallback || ''),
      uiThemeModeValues = ['auto', 'faction', 'custom'],
      uiThemeDefaultAccent = '#3aa0ff',
      galaxyFiltersEnabled = true,
    } = opts;

    if (!settingsState || typeof settingsState !== 'object') return settingsState;

    if (typeof applyTransitionPreset === 'function') {
      applyTransitionPreset(settingsState.transitionPreset);
    }

    settingsState.magnetPreset = ['precise', 'balanced', 'sticky', 'custom'].includes(String(settingsState.magnetPreset || 'balanced'))
      ? String(settingsState.magnetPreset)
      : 'balanced';
    settingsState.renderQualityProfile = ['auto', 'low', 'medium', 'high', 'ultra'].includes(String(settingsState.renderQualityProfile || 'auto').toLowerCase())
      ? String(settingsState.renderQualityProfile || 'auto').toLowerCase()
      : 'auto';
    settingsState.orbitSimulationMode = ['auto', 'simple', 'complex'].includes(String(settingsState.orbitSimulationMode || 'auto').toLowerCase())
      ? String(settingsState.orbitSimulationMode || 'auto').toLowerCase()
      : 'auto';
    settingsState.hoverMagnetEnabled = settingsState.hoverMagnetEnabled !== false;
    settingsState.clickMagnetEnabled = settingsState.clickMagnetEnabled !== false;
    settingsState.clusterHeatmapEnabled = settingsState.clusterHeatmapEnabled !== false;
    settingsState.galacticCoreFxAuto = persisted && typeof persisted === 'object' && Object.prototype.hasOwnProperty.call(persisted, 'galacticCoreFxAuto')
      ? persisted.galacticCoreFxAuto !== false
      : !(persisted && typeof persisted === 'object' && Object.prototype.hasOwnProperty.call(persisted, 'galacticCoreFxEnabled'));
    settingsState.galacticCoreFxEnabled = settingsState.galacticCoreFxEnabled !== false;
    settingsState.galaxyFleetVectorsVisible = settingsState.galaxyFleetVectorsVisible !== false;
    settingsState.systemOrbitPathsVisible = settingsState.systemOrbitPathsVisible !== false;
    settingsState.systemOrbitMarkersVisible = settingsState.systemOrbitMarkersVisible !== false;
    settingsState.systemOrbitFocusOnly = settingsState.systemOrbitFocusOnly === true;
    settingsState.systemViewLegacyFallback = settingsState.systemViewLegacyFallback === true;
    settingsState.introFlightMode = ['off', 'fast', 'cinematic'].includes(String(settingsState.introFlightMode || 'cinematic').toLowerCase())
      ? String(settingsState.introFlightMode || 'cinematic').toLowerCase()
      : 'cinematic';
    settingsState.hoverMagnetStarPx = Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)));
    settingsState.hoverMagnetPlanetPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)));
    settingsState.hoverMagnetClusterPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)));
    settingsState.galaxyOwnerFocusUserId = Math.max(0, Number(settingsState.galaxyOwnerFocusUserId || 0));
    settingsState.galaxyOwnerFocusName = String(settingsState.galaxyOwnerFocusName || '').trim();

    if (!galaxyFiltersEnabled) {
      settingsState.galaxyColonyFilterMode = 'all';
      settingsState.galaxyColoniesOnly = false;
      settingsState.galaxyOwnerFocusUserId = 0;
      settingsState.galaxyOwnerFocusName = '';
    }

    const uiThemeSet = uiThemeModeValues instanceof Set
      ? uiThemeModeValues
      : new Set(Array.isArray(uiThemeModeValues) ? uiThemeModeValues : ['auto', 'faction', 'custom']);
    settingsState.uiThemeMode = uiThemeSet.has(String(settingsState.uiThemeMode || '').toLowerCase())
      ? String(settingsState.uiThemeMode || '').toLowerCase()
      : 'auto';
    settingsState.uiThemeCustomAccent = normalizeHexColor(settingsState.uiThemeCustomAccent || uiThemeDefaultAccent, uiThemeDefaultAccent);
    settingsState.uiThemeFactionId = Math.max(0, Number(settingsState.uiThemeFactionId || 0));

    if (!settingsState.factionThemeCache || typeof settingsState.factionThemeCache !== 'object') {
      settingsState.factionThemeCache = {};
    }
    if (!settingsState.sceneTracks || typeof settingsState.sceneTracks !== 'object') {
      settingsState.sceneTracks = { galaxy: '', system: '', battle: '', ui: '' };
    }
    if (!settingsState.sfxMap || typeof settingsState.sfxMap !== 'object') {
      settingsState.sfxMap = Object.assign({}, DEFAULT_SFX_MAP);
    }

    return settingsState;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeLoadedUiSettings };
  } else {
    window.GQRuntimeSettingsNormalization = { normalizeLoadedUiSettings };
  }
})();
