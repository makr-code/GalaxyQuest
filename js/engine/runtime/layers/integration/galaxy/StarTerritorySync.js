/**
 * RuntimeGalaxyStarTerritorySync.js
 *
 * Encapsulates galaxy metadata loading and territory/theme synchronization.
 */

'use strict';

(function () {
  const state = {
    apiGalaxyMeta: null,
    apiFactions: null,
    getGalaxy3d: null,
    mapTerritoryFactionsForPlayer: null,
    warmFactionThemeCacheFromTerritory: null,
    applyUiTheme: null,
    refreshThemeSettingsUi: null,
    savePortableUiSettings: null,
    getSettingsState: null,
  };

  function configureGalaxyStarTerritorySyncRuntime(opts = {}) {
    state.apiGalaxyMeta = typeof opts.apiGalaxyMeta === 'function' ? opts.apiGalaxyMeta : null;
    state.apiFactions = typeof opts.apiFactions === 'function' ? opts.apiFactions : null;
    state.getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;
    state.mapTerritoryFactionsForPlayer = typeof opts.mapTerritoryFactionsForPlayer === 'function' ? opts.mapTerritoryFactionsForPlayer : null;
    state.warmFactionThemeCacheFromTerritory = typeof opts.warmFactionThemeCacheFromTerritory === 'function' ? opts.warmFactionThemeCacheFromTerritory : null;
    state.applyUiTheme = typeof opts.applyUiTheme === 'function' ? opts.applyUiTheme : null;
    state.refreshThemeSettingsUi = typeof opts.refreshThemeSettingsUi === 'function' ? opts.refreshThemeSettingsUi : null;
    state.savePortableUiSettings = typeof opts.savePortableUiSettings === 'function' ? opts.savePortableUiSettings : null;
    state.getSettingsState = typeof opts.getSettingsState === 'function' ? opts.getSettingsState : null;
  }

  async function loadGalaxyMetadata(galaxyIndex) {
    if (typeof state.apiGalaxyMeta !== 'function') return null;
    try {
      const metaPayload = await state.apiGalaxyMeta(galaxyIndex);
      if (!(metaPayload && metaPayload.success === true && metaPayload.metadata && typeof metaPayload.metadata === 'object')) {
        return null;
      }
      const galaxyMeta = metaPayload.metadata;
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      if (galaxy3d && typeof galaxy3d.setGalaxyMetadata === 'function') {
        galaxy3d.setGalaxyMetadata(galaxyMeta);
      }
      return galaxyMeta;
    } catch (metaErr) {
      console.warn('[GQ] loadGalaxyStars3D: metadata request failed', metaErr);
      return null;
    }
  }

  async function syncTerritoryForGalaxy(galaxyIndex) {
    if (typeof state.apiFactions !== 'function' || typeof state.mapTerritoryFactionsForPlayer !== 'function') {
      return [];
    }

    const territoryData = await state.apiFactions().catch(() => null);
    const territory = territoryData?.success
      ? state.mapTerritoryFactionsForPlayer((territoryData.factions || []).filter((f) => {
          const min = Number(f.home_galaxy_min || 1);
          const max = Number(f.home_galaxy_max || 0);
          return galaxyIndex >= min && galaxyIndex <= max;
        }))
      : [];

    const themeCacheChanged = typeof state.warmFactionThemeCacheFromTerritory === 'function'
      ? !!state.warmFactionThemeCacheFromTerritory(territory)
      : false;

    state.applyUiTheme?.('territory-update');
    state.refreshThemeSettingsUi?.();

    if (themeCacheChanged && typeof state.savePortableUiSettings === 'function') {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (settingsState) {
        state.savePortableUiSettings(settingsState);
      }
    }

    return territory;
  }

  const api = {
    configureGalaxyStarTerritorySyncRuntime,
    loadGalaxyMetadata,
    syncTerritoryForGalaxy,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarTerritorySync = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();