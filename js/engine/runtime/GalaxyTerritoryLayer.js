/**
 * GalaxyTerritoryLayer.js
 *
 * Renders territorial expansion visualization on the galaxy minimap.
 *
 * Each empire/faction that owns at least one colony gets a soft radial glow
 * ("territory blob") drawn around every one of its colonised star systems.
 * Adjacent same-owner blobs merge into a single painted region, giving a
 * Stellaris-style territory overview.
 *
 * Algorithm (canvas 2D, no external deps):
 *   1. Group stars that have colony_count > 0 by owner key
 *      (colony_owner_user_id or, as fallback, colony_owner_color).
 *   2. For each owner group draw filled radial-gradient circles with
 *      source-over compositing so overlapping blobs of the same colour blend.
 *   3. Draw a slightly opaque border stroke over each blob to mark territory
 *      edges.
 *
 * The territory radius per system scales with colony_count and colony_population
 * so larger empires feel more expansive.
 *
 * Public API (window.GQGalaxyTerritoryLayer):
 *   buildTerritoryGroups(stars)       → Map<ownerKey, TerritoryGroup>
 *   drawTerritoryLayer(ctx, groups, minimapState, projectPoint)
 *   drawTerritoryBorders(ctx, groups, minimapState, projectPoint)
 */
'use strict';

(function () {
  /** Minimum territory circle radius in canvas pixels */
  const BASE_RADIUS = 9;
  /** Max extra radius added by colony count */
  const COUNT_RADIUS_SCALE = 2.5;
  /** Max extra radius added by population (log scale) */
  const POP_RADIUS_SCALE = 3;
  /** Blob fill alpha */
  const FILL_ALPHA = 0.13;
  /** Border alpha */
  const BORDER_ALPHA = 0.55;
  /** Border line width */
  const BORDER_LINE_WIDTH = 1.2;

  /**
   * Derive a stable hex color string from an input (pass-through if valid,
   * otherwise generate from a hash of the key).
   * @param {string} rawColor
   * @param {string} key  fallback seed for generated color
   * @returns {string} '#rrggbb'
   */
  function resolveColor(rawColor, key) {
    const trimmed = String(rawColor || '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    // Generate a deterministic color from the key string
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
    }
    const hue = ((h >>> 0) % 360);
    return hslToHex(hue, 65, 55);
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  /**
   * Compute the territory radius (in canvas pixels) for one system.
   * @param {number} colonyCount
   * @param {number} colonyPopulation
   * @param {number} mapScale  minimap pixels-per-ly
   * @returns {number}
   */
  function systemRadius(colonyCount, colonyPopulation, mapScale) {
    const countBonus = Math.min(COUNT_RADIUS_SCALE * Math.log2(Math.max(1, colonyCount) + 1), COUNT_RADIUS_SCALE * 4);
    const popBonus = colonyPopulation > 0
      ? Math.min(POP_RADIUS_SCALE * Math.log10(colonyPopulation + 1) / 4, POP_RADIUS_SCALE * 2)
      : 0;
    // Scale radius slightly with map zoom but clamp so it stays usable
    const scaleBonus = Math.min(Math.max(mapScale * 8, 0), 4);
    return BASE_RADIUS + countBonus + popBonus + scaleBonus;
  }

  /**
   * @typedef {{ ownerKey: string, color: string, isPlayer: boolean, systems: Array<{cx,cy,r}> }} TerritoryGroup
   */

  /**
   * Build territory groups from star data.
   * @param {Array<Object>} stars  raw star objects from galaxy API
   * @param {Object} minimapState  { scale, offX, offY, minX, minY }
   * @param {Function} projectPoint  (state, x_ly, y_ly) => { x, y }
   * @returns {Map<string, TerritoryGroup>}
   */
  function buildTerritoryGroups(stars, minimapState, projectPoint) {
    /** @type {Map<string, TerritoryGroup>} */
    const groups = new Map();
    if (!Array.isArray(stars) || !stars.length || !minimapState) return groups;

    const scale = Number(minimapState.scale || 1);

    for (const star of stars) {
      const colonyCount = Number(star.colony_count || 0);
      if (colonyCount <= 0) continue;

      const ownerUserId = Number(star.colony_owner_user_id || 0);
      const rawColor = String(star.colony_owner_color || star.faction_color || '');
      const ownerName = String(star.colony_owner_name || star.owner || '');
      const isPlayer = Number(star.colony_is_player || 0) === 1;

      // Prefer user id as key (stable), fall back to color string
      const ownerKey = ownerUserId > 0 ? `uid:${ownerUserId}` : (rawColor || ownerName || 'unknown');
      const color = resolveColor(rawColor, ownerKey);

      const point = projectPoint(minimapState, Number(star.x_ly), Number(star.y_ly));
      const r = systemRadius(colonyCount, Number(star.colony_population || 0), scale);

      if (!groups.has(ownerKey)) {
        groups.set(ownerKey, {
          ownerKey,
          color,
          isPlayer,
          ownerName,
          systems: [],
        });
      }
      groups.get(ownerKey).systems.push({ cx: point.x, cy: point.y, r });
    }

    return groups;
  }

  /**
   * Draw filled territory blobs for all owner groups.
   * Call this BEFORE drawing stars so blobs sit underneath.
   */
  function drawTerritoryLayer(ctx, groups, minimapState) {
    if (!ctx || !groups || !groups.size || !minimapState) return;

    ctx.save();

    for (const group of groups.values()) {
      const hexColor = group.color;
      // Parse hex to rgb for gradient stops
      const rgb = hexToRgb(hexColor);
      if (!rgb) continue;

      for (const sys of group.systems) {
        const gradient = ctx.createRadialGradient(sys.cx, sys.cy, 0, sys.cx, sys.cy, sys.r);
        gradient.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},${FILL_ALPHA * 2})`);
        gradient.addColorStop(0.55, `rgba(${rgb.r},${rgb.g},${rgb.b},${FILL_ALPHA})`);
        gradient.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);

        ctx.beginPath();
        ctx.arc(sys.cx, sys.cy, sys.r, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Draw territory border rings (slightly brighter strokes) around each system.
   * Call this AFTER the fill pass but still BEFORE drawing stars.
   */
  function drawTerritoryBorders(ctx, groups, minimapState) {
    if (!ctx || !groups || !groups.size || !minimapState) return;

    ctx.save();

    for (const group of groups.values()) {
      const hexColor = group.color;
      const rgb = hexToRgb(hexColor);
      if (!rgb) continue;

      const strokeColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${BORDER_ALPHA})`;

      // Player territory gets a thicker, brighter border
      const lineWidth = group.isPlayer ? BORDER_LINE_WIDTH * 1.6 : BORDER_LINE_WIDTH;
      const borderR = group.isPlayer ? 1.05 : 1.0;

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;

      for (const sys of group.systems) {
        ctx.beginPath();
        ctx.arc(sys.cx, sys.cy, sys.r * borderR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Draw a compact territory legend in a corner of the minimap canvas.
   * Shows each empire's color swatch + owner name (player first).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Map} groups
   * @param {number} canvasW
   * @param {number} canvasH
   */
  function drawTerritoryLegend(ctx, groups, canvasW, canvasH) {
    if (!ctx || !groups || !groups.size) return;
    // Max 6 entries to avoid overflow
    const entries = Array.from(groups.values())
      .sort((a, b) => (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0))
      .slice(0, 6);
    if (!entries.length) return;

    ctx.save();
    ctx.font = '8px Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const lineH = 11;
    const pad = 4;
    const swatchW = 7;
    const startX = canvasW - 80;
    const startY = canvasH - lineH * entries.length - pad;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const y = startY + i * lineH;
      // Swatch
      ctx.fillStyle = e.color + 'bb';
      ctx.fillRect(startX, y + 1, swatchW, lineH - 3);
      // Label
      const label = e.isPlayer ? 'Du' : (e.ownerName || e.ownerKey).slice(0, 10);
      ctx.fillStyle = 'rgba(200,220,240,0.75)';
      ctx.fillText(label, startX + swatchW + 3, y + lineH / 2);
    }

    ctx.restore();
  }

  /** @param {string} hex */
  function hexToRgb(hex) {
    const m = String(hex || '').replace('#', '').trim();
    if (m.length === 3 && /^[0-9a-fA-F]{3}$/.test(m)) {
      return { r: parseInt(m[0] + m[0], 16), g: parseInt(m[1] + m[1], 16), b: parseInt(m[2] + m[2], 16) };
    }
    if (m.length === 6 && /^[0-9a-fA-F]{6}$/.test(m)) {
      return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
    }
    return null;
  }

  const api = {
    buildTerritoryGroups,
    drawTerritoryLayer,
    drawTerritoryBorders,
    drawTerritoryLegend,
    /** @internal exposed for tests */
    _resolveColor: resolveColor,
    _systemRadius: systemRadius,
    _hexToRgb: hexToRgb,
  };

  if (typeof window !== 'undefined') {
    window.GQGalaxyTerritoryLayer = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
