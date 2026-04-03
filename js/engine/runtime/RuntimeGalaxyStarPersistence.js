/**
 * RuntimeGalaxyStarPersistence.js
 *
 * Persists network-loaded galaxy stars into model and DB caches.
 */

'use strict';

(function () {
  const state = {
    getGalaxyModel: null,
    getGalaxyDb: null,
    hasDenseSystemCoverage: null,
    gameLog: null,
  };

  function configureGalaxyStarPersistenceRuntime(opts = {}) {
    state.getGalaxyModel = typeof opts.getGalaxyModel === 'function' ? opts.getGalaxyModel : null;
    state.getGalaxyDb = typeof opts.getGalaxyDb === 'function' ? opts.getGalaxyDb : null;
    state.hasDenseSystemCoverage = typeof opts.hasDenseSystemCoverage === 'function' ? opts.hasDenseSystemCoverage : null;
    state.gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : null;
  }

  function persistNetworkStars(opts = {}) {
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const fromSystem = Number(opts.fromSystem || 0);
    const toSystem = Number(opts.toSystem || 0);
    const data = opts.data && typeof opts.data === 'object' ? opts.data : {};
    const galaxyStars = Array.isArray(opts.galaxyStars) ? opts.galaxyStars : [];

    const responseTs = Number(data.server_ts_ms || Date.now());
    const galaxyModel = typeof state.getGalaxyModel === 'function' ? state.getGalaxyModel() : null;
    const galaxyDb = typeof state.getGalaxyDb === 'function' ? state.getGalaxyDb() : null;

    if (galaxyModel) {
      galaxyModel.upsertStarBatch(galaxyIndex, galaxyStars);
      const stride = Number(data.stride || 1);
      const isDense = typeof state.hasDenseSystemCoverage === 'function'
        ? state.hasDenseSystemCoverage(data.stars || galaxyStars, galaxyIndex, fromSystem, toSystem)
        : false;
      if (stride <= 1 && isDense) {
        galaxyModel.addLoadedStarRange(galaxyIndex, fromSystem, toSystem, responseTs);
      }
    }

    if (galaxyDb) {
      galaxyDb.upsertStars(galaxyStars, responseTs).catch((err) => {
        state.gameLog?.('info', 'DB upsertStars fehlgeschlagen', err);
      });
    }

    return responseTs;
  }

  const api = {
    configureGalaxyStarPersistenceRuntime,
    persistNetworkStars,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarPersistence = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();