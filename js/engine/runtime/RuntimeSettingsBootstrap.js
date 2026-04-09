'use strict';

(function () {
  function requireApi(windowRef, globalName, requiredMethods = []) {
    const api = windowRef?.[globalName] || null;
    if (!api) {
      throw new Error(`[runtime/settings-bootstrap] ${globalName} is required but not available.`);
    }
    for (const methodName of requiredMethods) {
      if (typeof api[methodName] !== 'function') {
        throw new Error(`[runtime/settings-bootstrap] ${globalName}.${methodName} is required but not available.`);
      }
    }
    return api;
  }

  function createSettingsBootstrap(opts = {}) {
    const windowRef = opts.windowRef || (typeof window !== 'undefined' ? window : null);
    const documentRef = opts.documentRef || (typeof document !== 'undefined' ? document : null);
    const getCurrentUser = typeof opts.getCurrentUser === 'function' ? opts.getCurrentUser : (() => null);
    const getUiState = typeof opts.getUiState === 'function' ? opts.getUiState : (() => null);
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const showToastWithAction = typeof opts.showToastWithAction === 'function' ? opts.showToastWithAction : (() => {});
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});

    const defaultsApi = opts.runtimeSettingsDefaultsApi || requireApi(windowRef, 'GQRuntimeSettingsDefaults', [
      'createDefaultSettingsState',
      'createUiThemeModeValues',
    ]);
    const themeApi = opts.runtimeThemePaletteApi || requireApi(windowRef, 'GQRuntimeThemePalette', ['applyUiTheme']);
    const hintsApi = opts.runtimeHintsApi || requireApi(windowRef, 'GQRuntimeHints', ['scheduleFleetLegendHint']);
    const settingsStorageApi = opts.runtimeSettingsStorageApi
      || requireApi(windowRef, 'GQRuntimeSettingsStorage', ['loadPortableUiSettings', 'savePortableUiSettings']);

    const settingsState = (opts.settingsState && typeof opts.settingsState === 'object')
      ? opts.settingsState
      : defaultsApi.createDefaultSettingsState();
    const uiThemeModeValues = defaultsApi.createUiThemeModeValues();
    const uiThemeDefaultAccent = defaultsApi.UI_THEME_DEFAULT_ACCENT;
    const uiThemeDynamicVars = Array.isArray(defaultsApi.UI_THEME_DYNAMIC_VARS)
      ? defaultsApi.UI_THEME_DYNAMIC_VARS.slice()
      : [];
    const storageBaseOptions = {
      storageKey: defaultsApi.UI_SETTINGS_STORAGE_KEY,
      sessionKey: defaultsApi.UI_SETTINGS_SESSION_KEY,
      cookieKey: defaultsApi.UI_SETTINGS_COOKIE_KEY,
      logger: gameLog,
    };

    themeApi.configureThemeRuntime({
      uiThemeDefaultAccent,
      uiThemeModeValues,
      uiThemeDynamicVars,
      getCurrentUser,
      getUiState,
      getSettingsState: () => settingsState,
      showToast,
      documentRef,
    });

    hintsApi.configureHintsRuntime({
      galaxyFleetHintKey: 'gq_hint_galaxy_fleet_colors_v1',
      orbitBadgeHintSessionKey: 'gq_hint_orbit_badge_v1',
      galaxyFleetHintCookieDays: 365,
      showToast,
      showToastWithAction,
      gameLog,
      documentRef,
      windowRef,
    });

    return {
      settingsState,
      uiThemeModeValues,
      uiThemeDefaultAccent,
      uiThemeDynamicVars,
      uiSettingsStorageKey: defaultsApi.UI_SETTINGS_STORAGE_KEY,
      uiSettingsSessionKey: defaultsApi.UI_SETTINGS_SESSION_KEY,
      uiSettingsCookieKey: defaultsApi.UI_SETTINGS_COOKIE_KEY,
      uiSettingsCookieMaxAgeSec: defaultsApi.UI_SETTINGS_COOKIE_MAX_AGE_SEC,
      normalizeHexColor: themeApi.normalizeHexColor,
      createThemePaletteFromAccent: themeApi.createThemePaletteFromAccent,
      resolvePlayerFactionThemeSeed: themeApi.resolvePlayerFactionThemeSeed,
      ensureFactionThemeCacheEntry: themeApi.ensureFactionThemeCacheEntry,
      warmFactionThemeCacheFromTerritory: themeApi.warmFactionThemeCacheFromTerritory,
      resolveThemePaletteForSelection: themeApi.resolveThemePaletteForSelection,
      applyUiTheme: themeApi.applyUiTheme,
      showOrbitModeHintOnce: hintsApi.showOrbitModeHintOnce,
      showGalaxyShortcutsHintOnce: hintsApi.showGalaxyShortcutsHintOnce,
      scheduleFleetLegendHint: hintsApi.scheduleFleetLegendHint,
      loadPortableUiSettings() {
        return settingsStorageApi.loadPortableUiSettings(storageBaseOptions);
      },
      savePortableUiSettings(data) {
        settingsStorageApi.savePortableUiSettings(data, {
          ...storageBaseOptions,
          cookieMaxAgeSec: defaultsApi.UI_SETTINGS_COOKIE_MAX_AGE_SEC,
        });
      },
    };
  }

  const api = { createSettingsBootstrap };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeSettingsBootstrap = api;
  }
})();