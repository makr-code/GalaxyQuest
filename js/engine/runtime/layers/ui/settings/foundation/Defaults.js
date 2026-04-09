'use strict';

(function () {
  const UI_THEME_MODE_VALUES = ['auto', 'faction', 'custom'];
  const UI_THEME_DEFAULT_ACCENT = '#3aa0ff';
  const UI_THEME_DYNAMIC_VARS = [
    '--accent-blue',
    '--accent-cyan',
    '--accent-purple',
    '--border-lit',
    '--theme-accent',
    '--theme-accent-soft',
    '--theme-accent-strong',
    '--theme-complement',
    '--theme-complement-soft',
  ];

  const UI_SETTINGS_STORAGE_KEY = 'gq_ui_settings';
  const UI_SETTINGS_SESSION_KEY = 'gq_ui_settings_session';
  const UI_SETTINGS_COOKIE_KEY = 'gq_ui_settings';
  const UI_SETTINGS_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 180;

  const DEFAULT_SCENE_TRACKS = {
    galaxy: '',
    system: '',
    battle: '',
    ui: '',
  };

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

  function createDefaultSettingsState() {
    return {
      transitionPreset: 'balanced',
      orbitSimulationMode: 'auto',
      systemOrbitPathsVisible: true,
      systemOrbitMarkersVisible: true,
      systemOrbitFocusOnly: false,
      autoTransitions: true,
      renderQualityProfile: 'webgpu',
      clusterDensityMode: 'max',
      galaxyColonyFilterMode: 'all',
      galaxyColoniesOnly: false,
      galaxyOwnerFocusUserId: 0,
      galaxyOwnerFocusName: '',
      clusterBoundsVisible: true,
      clusterHeatmapEnabled: true,
      galaxyFleetVectorsVisible: true,
      galacticCoreFxAuto: true,
      galacticCoreFxEnabled: true,
      magnetPreset: 'balanced',
      hoverMagnetEnabled: true,
      clickMagnetEnabled: true,
      hoverMagnetStarPx: 24,
      hoverMagnetPlanetPx: 30,
      hoverMagnetClusterPx: 28,
      persistentHoverDistance: 220,
      transitionStableMinMs: 160,
      systemViewLegacyFallback: false,
      homeEnterSystem: false,
      introFlightMode: 'cinematic',
      masterVolume: 0.8,
      musicVolume: 0.55,
      sfxVolume: 0.8,
      ttsVolume: 0.95,
      masterMuted: false,
      musicMuted: false,
      sfxMuted: false,
      ttsMuted: false,
      ttsAutoVoice: true,
      musicTransitionMode: 'fade',
      musicUrl: '',
      autoSceneMusic: true,
      sceneTracks: { ...DEFAULT_SCENE_TRACKS },
      sfxMap: { ...DEFAULT_SFX_MAP },
      uiThemeMode: 'auto',
      uiThemeCustomAccent: UI_THEME_DEFAULT_ACCENT,
      uiThemeFactionId: 0,
      factionThemeCache: {},
    };
  }

  function createUiThemeModeValues() {
    return new Set(UI_THEME_MODE_VALUES);
  }

  const api = {
    createDefaultSettingsState,
    createUiThemeModeValues,
    UI_THEME_DEFAULT_ACCENT,
    UI_THEME_DYNAMIC_VARS,
    UI_SETTINGS_STORAGE_KEY,
    UI_SETTINGS_SESSION_KEY,
    UI_SETTINGS_COOKIE_KEY,
    UI_SETTINGS_COOKIE_MAX_AGE_SEC,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeSettingsDefaults = api;
  }
})();
