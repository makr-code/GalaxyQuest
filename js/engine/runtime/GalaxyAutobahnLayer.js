/**
 * GalaxyAutobahnLayer.js
 *
 * Computes and renders "Autobahn" (frequently-used hyperlane highway) overlays
 * on the galaxy minimap from trade route data.
 *
 * Route tiers (matching RuntimeTradeRoutesController classification):
 *   Autobahn      – interval ≤  6 h  – thick orange glow
 *   Schnelltrasse – interval ≤ 12 h  – yellow
 *   Haupttrasse   – interval ≤ 24 h  – green
 *   Nebenroute    – interval ≤ 48 h  – light blue
 */
'use strict';

(function () {
  /**
   * Build a canonical edge key from two system coords so A→B and B→A share
   * the same slot.
   */
  function edgeKey(gA, sA, gB, sB) {
    const a = `${gA}:${sA}`;
    const b = `${gB}:${sB}`;
    return a <= b ? `${a}|${b}` : `${b}|${a}`;
  }

  /**
   * Classify a route tier from interval_hours, returning display metadata.
   * @param {number} intervalHours
   * @param {boolean} isActive
   * @returns {{ laneLabel: string, laneColor: string, lineWidth: number, glowWidth: number, glowAlpha: number }}
   */
  function classifyLaneTier(intervalHours, isActive) {
    if (!isActive) {
      return { laneLabel: 'Pausiert',      laneColor: '#6a7480', lineWidth: 0.8, glowWidth: 0,   glowAlpha: 0 };
    }
    if (intervalHours <= 6) {
      return { laneLabel: 'Autobahn',      laneColor: '#ffb347', lineWidth: 2.2, glowWidth: 6,   glowAlpha: 0.45 };
    }
    if (intervalHours <= 12) {
      return { laneLabel: 'Schnelltrasse', laneColor: '#ffd166', lineWidth: 1.6, glowWidth: 4,   glowAlpha: 0.35 };
    }
    if (intervalHours <= 24) {
      return { laneLabel: 'Haupttrasse',   laneColor: '#8dd3a8', lineWidth: 1.2, glowWidth: 3,   glowAlpha: 0.28 };
    }
    return   { laneLabel: 'Nebenroute',   laneColor: '#7cc8ff', lineWidth: 0.9, glowWidth: 2,   glowAlpha: 0.20 };
  }

  /**
   * Aggregate raw trade routes into a map of unique galaxy-system edges,
   * keeping the most-aggressive tier found across parallel routes.
   *
   * @param {Array<Object>} routes – items from API.tradeRoutes(), each with
   *   { origin: { galaxy, system }, target: { galaxy, system },
   *     interval_hours, is_active, is_due, last_dispatch }
   * @returns {Array<{ gA, sA, gB, sB, intervalHours, isActive, isDue, useCount, tier }>}
   */
  function buildAutobahnEdges(routes) {
    if (!Array.isArray(routes) || !routes.length) return [];

    const edgeMap = new Map();

    for (const route of routes) {
      const og = Number(route?.origin?.galaxy || 0);
      const os = Number(route?.origin?.system || 0);
      const tg = Number(route?.target?.galaxy || 0);
      const ts = Number(route?.target?.system || 0);
      if (!og || !os || !tg || !ts) continue;

      const key = edgeKey(og, os, tg, ts);
      const intervalHours = Math.max(1, Number(route.interval_hours || 24));
      const isActive = !!route.is_active;
      const isDue = !!route.is_due;

      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          gA: og, sA: os,
          gB: tg, sB: ts,
          intervalHours,
          isActive,
          isDue,
          useCount: 1,
        });
      } else {
        const existing = edgeMap.get(key);
        existing.useCount += 1;
        // Keep the most aggressive tier (lower interval = higher tier)
        if (intervalHours < existing.intervalHours) {
          existing.intervalHours = intervalHours;
        }
        if (isActive) existing.isActive = true;
        if (isDue) existing.isDue = true;
      }
    }

    return Array.from(edgeMap.values()).map((edge) => {
      const tier = classifyLaneTier(edge.intervalHours, edge.isActive);
      return Object.assign({}, edge, { tier });
    });
  }

  /**
   * Draw autobahn edges on a 2D canvas context.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} edges – from buildAutobahnEdges()
   * @param {Object} minimapState – canvas state: { minX, minY, scale, offX, offY }
   * @param {Function} projectPoint – (state, x_ly, y_ly) => { x, y }
   * @param {Array} stars – raw star data with { system_index, galaxy_index, x_ly, y_ly }
   */
  function drawAutobahnEdges(ctx, edges, minimapState, projectPoint, stars) {
    if (!ctx || !edges || !edges.length || !minimapState) return;
    if (!Array.isArray(stars) || !stars.length) return;

    // Build system_index → star lookup for fast coordinate resolution
    // Keyed by `${galaxy_index}:${system_index}`
    const starIndex = new Map();
    for (const star of stars) {
      const gi = Number(star.galaxy_index || 1);
      const si = Number(star.system_index || 0);
      if (!si) continue;
      starIndex.set(`${gi}:${si}`, star);
    }

    ctx.save();

    for (const edge of edges) {
      const starA = starIndex.get(`${edge.gA}:${edge.sA}`);
      const starB = starIndex.get(`${edge.gB}:${edge.sB}`);
      if (!starA || !starB) continue;

      const pA = projectPoint(minimapState, Number(starA.x_ly), Number(starA.y_ly));
      const pB = projectPoint(minimapState, Number(starB.x_ly), Number(starB.y_ly));

      const { laneColor, lineWidth, glowWidth, glowAlpha } = edge.tier;

      // Draw glow layer first (wider, semi-transparent)
      if (glowWidth > 0 && glowAlpha > 0) {
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.strokeStyle = laneColor;
        ctx.lineWidth = glowWidth * (1 + (edge.useCount - 1) * 0.15);
        ctx.globalAlpha = glowAlpha;
        ctx.stroke();
      }

      // Draw the solid lane line
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.strokeStyle = laneColor;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = edge.isActive ? 0.85 : 0.35;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Return the set of system indices (as `${galaxy}:${system}` strings) that
   * appear as Autobahn or Schnelltrasse hubs (both endpoints of a high-tier edge).
   *
   * @param {Array} edges – from buildAutobahnEdges()
   * @returns {Set<string>}
   */
  function buildHighwayHubSet(edges) {
    const hubs = new Set();
    for (const edge of edges) {
      if (!edge.isActive) continue;
      if (edge.intervalHours <= 12) {
        hubs.add(`${edge.gA}:${edge.sA}`);
        hubs.add(`${edge.gB}:${edge.sB}`);
      }
    }
    return hubs;
  }

  const api = {
    buildAutobahnEdges,
    drawAutobahnEdges,
    buildHighwayHubSet,
    classifyLaneTier,
    /** @internal – exported for tests */
    _edgeKey: edgeKey,
  };

  if (typeof window !== 'undefined') {
    window.GQGalaxyAutobahnLayer = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
