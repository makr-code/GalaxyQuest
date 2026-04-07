/**
 * SearchScoring.js
 *
 * Star search key/scoring helpers used by topbar search.
 */

'use strict';

(function () {
  const state = {
    getActiveGalaxy: null,
    getGalaxyStars: null,
  };

  function configureGalaxySearchScoringRuntime(opts = {}) {
    state.getActiveGalaxy = typeof opts.getActiveGalaxy === 'function' ? opts.getActiveGalaxy : (() => 1);
    state.getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : (() => []);
  }

  function starSearchKey(star) {
    if (!star) return '';
    const g = Number(star.galaxy_index || star.galaxy || 1);
    const s = Number(star.system_index || star.system || 0);
    return `${g}:${s}`;
  }

  function scoreStarSearchMatch(star, queryLower, systemExact) {
    const name = String(star?.name || '').toLowerCase();
    const catalog = String(star?.catalog_name || '').toLowerCase();
    const sys = Number(star?.system_index || 0);
    const sysText = String(sys);
    let score = -1;

    if (systemExact > 0 && sys === systemExact) score = Math.max(score, 120);
    if (sysText === queryLower) score = Math.max(score, 116);
    if (sysText.startsWith(queryLower)) score = Math.max(score, 100);
    if (name === queryLower) score = Math.max(score, 98);
    if (catalog === queryLower) score = Math.max(score, 96);
    if (name.startsWith(queryLower)) score = Math.max(score, 86);
    if (catalog.startsWith(queryLower)) score = Math.max(score, 84);
    if (name.includes(queryLower)) score = Math.max(score, 70);
    if (catalog.includes(queryLower)) score = Math.max(score, 66);

    if (score < 0) return -1;
    return score - Math.min(30, Math.floor(sys / 1000));
  }

  function collectLocalStarSearch(query, limit = 10) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const g = Number(state.getActiveGalaxy?.() || 1);
    const systemExact = /^\d+$/.test(q) ? Number(q) : -1;
    const rows = [];

    (Array.isArray(state.getGalaxyStars?.()) ? state.getGalaxyStars() : []).forEach((star) => {
      if (Number(star?.galaxy_index || 0) !== g) return;
      const score = scoreStarSearchMatch(star, q, systemExact);
      if (score < 0) return;
      rows.push({ score, star });
    });

    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, Math.max(1, Number(limit || 10))).map((row) => row.star);
  }

  const api = {
    configureGalaxySearchScoringRuntime,
    starSearchKey,
    scoreStarSearchMatch,
    collectLocalStarSearch,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxySearchScoring = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();