/**
 * StarCacheRead.js
 *
 * Encapsulates cache read flow for galaxy star ranges (memory model + DB fallback).
 */

'use strict';

(function () {
  const state = {
    getGalaxyModel: null,
    getGalaxyDb: null,
    isCurrentUserAdmin: null,
    normalizeStarListVisibility: null,
    hasDenseSystemCoverage: null,
  };

  function configureGalaxyStarCacheReadRuntime(opts = {}) {
    state.getGalaxyModel = typeof opts.getGalaxyModel === 'function' ? opts.getGalaxyModel : null;
    state.getGalaxyDb = typeof opts.getGalaxyDb === 'function' ? opts.getGalaxyDb : null;
    state.isCurrentUserAdmin = typeof opts.isCurrentUserAdmin === 'function' ? opts.isCurrentUserAdmin : null;
    state.normalizeStarListVisibility = typeof opts.normalizeStarListVisibility === 'function' ? opts.normalizeStarListVisibility : null;
    state.hasDenseSystemCoverage = typeof opts.hasDenseSystemCoverage === 'function' ? opts.hasDenseSystemCoverage : null;
  }

  async function loadCachedStarRange(opts = {}) {
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const fromSystem = Number(opts.fromSystem || 0);
    const toSystem = Number(opts.toSystem || 0);
    const cacheMaxAgeMs = Number(opts.cacheMaxAgeMs || 0);

    const galaxyModel = typeof state.getGalaxyModel === 'function' ? state.getGalaxyModel() : null;
    const galaxyDb = typeof state.getGalaxyDb === 'function' ? state.getGalaxyDb() : null;
    const isAdmin = typeof state.isCurrentUserAdmin === 'function' ? !!state.isCurrentUserAdmin() : false;

    const normalize = (stars) => {
      if (typeof state.normalizeStarListVisibility === 'function') {
        return state.normalizeStarListVisibility(stars);
      }
      return Array.isArray(stars) ? stars : [];
    };

    let cachedStars = normalize(galaxyModel ? galaxyModel.listStars(galaxyIndex, fromSystem, toSystem) : []);
    const fullRangeInModel = galaxyModel
      ? galaxyModel.hasLoadedStarRange(galaxyIndex, fromSystem, toSystem, cacheMaxAgeMs)
      : false;

    if ((!cachedStars || cachedStars.length === 0) && galaxyDb && !isAdmin) {
      try {
        const dbStars = await galaxyDb.getStars(galaxyIndex, fromSystem, toSystem, { maxAgeMs: cacheMaxAgeMs });
        if (dbStars.length && galaxyModel) {
          cachedStars = normalize(galaxyModel.upsertStarBatch(galaxyIndex, dbStars));
          const hasDenseCoverage = typeof state.hasDenseSystemCoverage === 'function'
            ? state.hasDenseSystemCoverage(dbStars, galaxyIndex, fromSystem, toSystem)
            : false;
          if (hasDenseCoverage) {
            galaxyModel.addLoadedStarRange(galaxyIndex, fromSystem, toSystem, Date.now());
          }
        } else {
          cachedStars = normalize(dbStars);
        }
      } catch (dbErr) {
        console.warn('[GQ] loadGalaxyStars3D: DB cache read failed', dbErr);
      }
    }

    return {
      cachedStars: Array.isArray(cachedStars) ? cachedStars : [],
      fullRangeInModel: !!fullRangeInModel,
    };
  }

  const api = {
    configureGalaxyStarCacheReadRuntime,
    loadCachedStarRange,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarCacheRead = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();