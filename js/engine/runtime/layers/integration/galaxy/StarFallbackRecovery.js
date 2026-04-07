/**
 * StarFallbackRecovery.js
 *
 * Encapsulates local fallback star recovery for loadStars3D error paths.
 */

'use strict';

(function () {
  const state = {
    getGalaxyModel: null,
    getGalaxyDb: null,
    isCurrentUserAdmin: null,
    normalizeStarListVisibility: null,
    gameLog: null,
  };

  function configureGalaxyStarFallbackRecoveryRuntime(opts = {}) {
    state.getGalaxyModel = typeof opts.getGalaxyModel === 'function' ? opts.getGalaxyModel : null;
    state.getGalaxyDb = typeof opts.getGalaxyDb === 'function' ? opts.getGalaxyDb : null;
    state.isCurrentUserAdmin = typeof opts.isCurrentUserAdmin === 'function' ? opts.isCurrentUserAdmin : null;
    state.normalizeStarListVisibility = typeof opts.normalizeStarListVisibility === 'function' ? opts.normalizeStarListVisibility : null;
    state.gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : null;
  }

  async function recoverFallbackStars(opts = {}) {
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const galaxySystemMax = Number(opts.galaxySystemMax || 0);
    const cachedStars = Array.isArray(opts.cachedStars) ? opts.cachedStars : [];
    const currentStars = Array.isArray(opts.currentStars) ? opts.currentStars : [];

    const galaxyModel = typeof state.getGalaxyModel === 'function' ? state.getGalaxyModel() : null;
    const galaxyDb = typeof state.getGalaxyDb === 'function' ? state.getGalaxyDb() : null;
    const isAdmin = typeof state.isCurrentUserAdmin === 'function' ? !!state.isCurrentUserAdmin() : false;

    let fallbackStars = cachedStars.slice();

    if (!fallbackStars.length) {
      const scopedInMemory = currentStars
        .filter((star) => Number(star?.galaxy_index || 0) === galaxyIndex);
      if (scopedInMemory.length) fallbackStars = scopedInMemory;
    }

    if (!fallbackStars.length && galaxyModel) {
      try {
        fallbackStars = galaxyModel.listStars(galaxyIndex, 1, galaxySystemMax) || [];
      } catch (err) {
        state.gameLog?.('info', 'Fallback listStars aus galaxyModel fehlgeschlagen', err);
      }
    }

    if (!fallbackStars.length && galaxyDb && !isAdmin) {
      try {
        fallbackStars = await galaxyDb.getStars(galaxyIndex, 1, galaxySystemMax, { maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
        if (fallbackStars.length && galaxyModel) {
          galaxyModel.upsertStarBatch(galaxyIndex, fallbackStars);
        }
      } catch (err) {
        state.gameLog?.('info', 'Fallback listStars aus galaxyDB fehlgeschlagen', err);
      }
    }

    if (typeof state.normalizeStarListVisibility === 'function') {
      fallbackStars = state.normalizeStarListVisibility(fallbackStars);
    }

    return Array.isArray(fallbackStars) ? fallbackStars : [];
  }

  const api = {
    configureGalaxyStarFallbackRecoveryRuntime,
    recoverFallbackStars,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarFallbackRecovery = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();