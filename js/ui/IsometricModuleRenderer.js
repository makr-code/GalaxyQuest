/**
 * IsometricModuleRenderer.js — Unified 3D isometric module visualization system
 *
 * Renders equipment modules (reactors, weapons, shields, armor, etc.) in
 * isometric projection on a 2D canvas. Each module type has a standardized
 * visual signature with glow, damage states, and upgrade tiers.
 *
 * Module Types:
 *   • ENERGY    — reactors, capacitors, power distribution
 *   • WEAPON    — lasers, beams, missiles, railguns
 *   • SHIELD    — energy barriers, kinetic shields
 *   • ARMOR     — hull plating, reinforcement
 *   • PROPULSION — thrusters, ion drives, jump engines
 *   • COMMAND   — bridge, AI core, tactical computers
 *   • AUXILIARY — sensors, comms, repair bays
 *   • HULL      — structure, landing gear
 *
 * Isometric Projection:
 *   Cabinet: x: -0.5, y: 1.0 (45° depth)
 *   Dimetric: x: -0.47, y: 0.94 (30°/60° angles)
 *   Military: x: -0.5, y: 0.866 (pure geometric isometric)
 *
 * Usage:
 *   const renderer = new IsometricModuleRenderer(canvasElement, { scale: 2.0 });
 *   renderer.render({
 *     moduleType: 'ENERGY',
 *     tier: 2,
 *     damaged: false,
 *     upgraded: true,
 *     highlighted: false,
 *   });
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Module Type Definitions
// ---------------------------------------------------------------------------

const ModuleType = Object.freeze({
  ENERGY:     'ENERGY',
  WEAPON:     'WEAPON',
  SHIELD:     'SHIELD',
  ARMOR:      'ARMOR',
  PROPULSION: 'PROPULSION',
  COMMAND:    'COMMAND',
  AUXILIARY:  'AUXILIARY',
  HULL:       'HULL',
});

// Per-type visual configuration
const MODULE_CONFIG = {
  [ModuleType.ENERGY]: {
    label: 'Power',
    baseColor: '#ffaa22',
    glowColor: 'rgba(255, 170, 34, 0.6)',
    icon: '⚡',
    shape: 'cylinder',
    height: 1.2,
    width: 0.8,
  },
  [ModuleType.WEAPON]: {
    label: 'Weapon',
    baseColor: '#ff3333',
    glowColor: 'rgba(255, 51, 51, 0.6)',
    icon: '⚔',
    shape: 'prism',
    height: 1.0,
    width: 0.6,
  },
  [ModuleType.SHIELD]: {
    label: 'Shield',
    baseColor: '#3399ff',
    glowColor: 'rgba(51, 153, 255, 0.6)',
    icon: '◆',
    shape: 'octahedron',
    height: 1.4,
    width: 0.9,
  },
  [ModuleType.ARMOR]: {
    label: 'Armor',
    baseColor: '#999999',
    glowColor: 'rgba(153, 153, 153, 0.4)',
    icon: '⬛',
    shape: 'cube',
    height: 0.9,
    width: 0.8,
  },
  [ModuleType.PROPULSION]: {
    label: 'Drive',
    baseColor: '#00dd88',
    glowColor: 'rgba(0, 221, 136, 0.6)',
    icon: '→',
    shape: 'cone',
    height: 1.1,
    width: 0.7,
  },
  [ModuleType.COMMAND]: {
    label: 'Command',
    baseColor: '#dd44ff',
    glowColor: 'rgba(221, 68, 255, 0.5)',
    icon: '◉',
    shape: 'sphere',
    height: 1.0,
    width: 0.8,
  },
  [ModuleType.AUXILIARY]: {
    label: 'Auxiliary',
    baseColor: '#ffdd44',
    glowColor: 'rgba(255, 221, 68, 0.5)',
    icon: '⚙',
    shape: 'gear',
    height: 0.95,
    width: 0.75,
  },
  [ModuleType.HULL]: {
    label: 'Hull',
    baseColor: '#666666',
    glowColor: 'rgba(102, 102, 102, 0.3)',
    icon: '□',
    shape: 'cube',
    height: 1.3,
    width: 1.0,
  },
};

// Tier colors (applied as overlay/tint)
const TIER_COLORS = {
  1: { base: '#cccccc', bright: '#ffffff' },
  2: { base: '#4488ff', bright: '#88ccff' },
  3: { base: '#44ff88', bright: '#88ffcc' },
  4: { base: '#ff8844', bright: '#ffaa66' },
  5: { base: '#ff44ff', bright: '#ff88ff' },
};

// Damage state colors
const DAMAGE_COLORS = {
  intact:    { alpha: 1.0, saturation: 1.0 },
  damaged:   { alpha: 0.8, saturation: 0.7, hueShift: -20 },
  critical:  { alpha: 0.6, saturation: 0.5, hueShift: -40 },
  destroyed: { alpha: 0.3, saturation: 0.2, hueShift: -60 },
};

// ---------------------------------------------------------------------------
// Isometric Helpers
// ---------------------------------------------------------------------------

function projectIsometric(x, y, z) {
  // Military isometric: 30°/60° angles
  const isoX = x - z * 0.5;
  const isoY = y + (x + z) * 0.866 * 0.5;
  return { x: isoX, y: isoY };
}

function projectCabinet(x, y, z) {
  // Cabinet projection: 45° with depth scaling
  const isoX = x - z * 0.5;
  const isoY = y + z * 0.5;
  return { x: isoX, y: isoY };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h, s, v) {
  h = h % 360; if (h < 0) h += 360;
  s /= 100; v /= 100;
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let rr = 0, gg = 0, bb = 0;
  if (hh < 1) { rr = c; gg = x; } else if (hh < 2) { rr = x; gg = c; }
  else if (hh < 3) { gg = c; bb = x; } else if (hh < 4) { gg = x; bb = c; }
  else if (hh < 5) { rr = x; bb = c; } else { rr = c; bb = x; }
  const m = v - c;
  return {
    r: Math.round((rr + m) * 255),
    g: Math.round((gg + m) * 255),
    b: Math.round((bb + m) * 255),
  };
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : { r: 200, g: 200, b: 200 };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toUpperCase();
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class IsometricModuleRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {number} [opts.scale=1.0] — multiplier for all dimensions
   * @param {string} [opts.projection='military'] — 'military'|'cabinet'|'dimetric'
   * @param {boolean} [opts.antialias=true]
   */
  constructor(canvas, opts = {}) {
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('IsometricModuleRenderer: canvas element required');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { antialias: opts.antialias !== false });
    this.scale = opts.scale ?? 1.0;
    this.projection = opts.projection ?? 'military';
    this.debugMode = opts.debug ?? false;

    // Ensure DPI awareness for retina displays
    this._setupDPIAwareness();
  }

  _setupDPIAwareness() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
  }

  /**
   * Render a module within the canvas.
   *
   * @param {object} opts
   * @param {string}  [opts.moduleType='ENERGY'] — ModuleType key
   * @param {number}  [opts.tier=1] — 1-5 (1=basic, 5=exotic)
   * @param {string}  [opts.damageState='intact'] — intact|damaged|critical|destroyed
   * @param {boolean} [opts.upgraded=false] — if true, add upgrade badge
   * @param {boolean} [opts.highlighted=false] — if true, add selection highlight
   * @param {number}  [opts.rotation=0] — rotation angle in degrees
   * @param {number}  [opts.x] — custom x (default: center)
   * @param {number}  [opts.y] — custom y (default: center)
   * @returns {boolean} success
   */
  render(opts = {}) {
    const moduleType = opts.moduleType ?? ModuleType.ENERGY;
    const tier = Math.max(1, Math.min(5, opts.tier ?? 1));
    const damageState = opts.damageState ?? 'intact';
    const upgraded = opts.upgraded ?? false;
    const highlighted = opts.highlighted ?? false;
    const rotation = opts.rotation ?? 0;

    const config = MODULE_CONFIG[moduleType];
    if (!config) {
      if (this.debugMode) console.warn('[IsometricModuleRenderer] Unknown module type:', moduleType);
      return false;
    }

    const x = opts.x ?? this.displayWidth / 2;
    const y = opts.y ?? this.displayHeight / 2;

    this.ctx.save();

    // Clear background
    this.ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

    // Translate to center + apply rotation
    this.ctx.translate(x, y);
    this.ctx.rotate((rotation * Math.PI) / 180);

    // Draw module based on shape
    this._drawModuleShape(config, tier, damageState);

    // Draw upgrades/status
    if (upgraded) this._drawUpgradeBadge(config);
    if (highlighted) this._drawHighlight(config);

    this.ctx.restore();
    return true;
  }

  /**
   * Render multiple modules in a grid (for slot preview).
   * @param {Array<object>} modules — array of module configs
   * @param {number} [cols=3] — columns in grid
   * @returns {boolean} success
   */
  renderGrid(modules, cols = 3) {
    if (!Array.isArray(modules) || !modules.length) return false;

    this.ctx.fillStyle = 'rgba(10, 16, 28, 0.8)';
    this.ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);

    const cellWidth = this.displayWidth / cols;
    const rows = Math.ceil(modules.length / cols);
    const cellHeight = this.displayHeight / rows;

    modules.forEach((mod, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cellX = col * cellWidth + cellWidth / 2;
      const cellY = row * cellHeight + cellHeight / 2;

      this.ctx.save();
      this.ctx.translate(cellX, cellY);

      const config = MODULE_CONFIG[mod.moduleType || ModuleType.ENERGY];
      if (config) {
        this._drawModuleShape(config, mod.tier ?? 1, mod.damageState ?? 'intact', cellHeight * 0.35);
      }

      this.ctx.restore();
    });

    return true;
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  _drawModuleShape(config, tier, damageState, radiusOverride) {
    const baseRadius = (radiusOverride ?? 20) * this.scale;
    const damage = DAMAGE_COLORS[damageState] || DAMAGE_COLORS['intact'];
    const tierColor = TIER_COLORS[tier] || TIER_COLORS[1];

    // Get base color
    let rgb = hexToRgb(config.baseColor);
    let hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

    // Apply damage hue shift
    if (damage.hueShift) hsv.h += damage.hueShift;

    // Apply damage saturation
    hsv.s *= damage.saturation ?? 1.0;

    const damageColor = rgbToHex(
      hsvToRgb(hsv.h, hsv.s, hsv.v).r,
      hsvToRgb(hsv.h, hsv.s, hsv.v).g,
      hsvToRgb(hsv.h, hsv.s, hsv.v).b
    );

    // Draw based on shape
    switch (config.shape) {
      case 'cylinder':
        this._drawCylinderIso(baseRadius, config.height * baseRadius / 20, damageColor, tierColor, damage.alpha);
        break;
      case 'cube':
        this._drawCubeIso(baseRadius, damageColor, tierColor, damage.alpha);
        break;
      case 'sphere':
        this._drawSphereIso(baseRadius, damageColor, tierColor, damage.alpha);
        break;
      case 'cone':
        this._drawConeIso(baseRadius, config.height * baseRadius / 20, damageColor, tierColor, damage.alpha);
        break;
      case 'prism':
        this._drawPrismIso(baseRadius, config.height * baseRadius / 20, damageColor, tierColor, damage.alpha);
        break;
      case 'octahedron':
        this._drawOctahedronIso(baseRadius, damageColor, tierColor, damage.alpha);
        break;
      case 'gear':
        this._drawGearIso(baseRadius, damageColor, tierColor, damage.alpha);
        break;
      default:
        this._drawCubeIso(baseRadius, damageColor, tierColor, damage.alpha);
    }

    // Add glow
    this._drawGlow(baseRadius, config.glowColor, damage.alpha);
  }

  _drawCylinderIso(radius, height, color, tierColor, alpha) {
    // Front face
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, radius, radius * 0.4, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // Side faces
    this.ctx.strokeStyle = tierColor.base;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(-radius, 0);
    this.ctx.lineTo(-radius, height);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.moveTo(radius, 0);
    this.ctx.lineTo(radius, height);
    this.ctx.stroke();

    // Top
    this.ctx.fillStyle = tierColor.bright;
    this.ctx.globalAlpha = alpha * 0.8;
    this.ctx.beginPath();
    this.ctx.ellipse(0, -height * 0.5, radius, radius * 0.4, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _drawCubeIso(radius, color, tierColor, alpha) {
    const r = radius;
    const d = r * 0.6; // depth

    // Top face
    this.ctx.fillStyle = tierColor.bright;
    this.ctx.globalAlpha = alpha * 0.9;
    this.ctx.beginPath();
    this.ctx.moveTo(-r, -d);
    this.ctx.lineTo(0, -r - d);
    this.ctx.lineTo(r, -d);
    this.ctx.lineTo(0, r - d);
    this.ctx.closePath();
    this.ctx.fill();

    // Left face
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha * 0.7;
    this.ctx.beginPath();
    this.ctx.moveTo(-r, -d);
    this.ctx.lineTo(-r, d);
    this.ctx.lineTo(0, r + d);
    this.ctx.lineTo(0, r - d);
    this.ctx.closePath();
    this.ctx.fill();

    // Right face
    this.ctx.fillStyle = tierColor.base;
    this.ctx.globalAlpha = alpha * 0.85;
    this.ctx.beginPath();
    this.ctx.moveTo(r, -d);
    this.ctx.lineTo(r, d);
    this.ctx.lineTo(0, r + d);
    this.ctx.lineTo(0, r - d);
    this.ctx.closePath();
    this.ctx.fill();

    // Outline
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = alpha * 0.5;
    this.ctx.stroke();
  }

  _drawSphereIso(radius, color, tierColor, alpha) {
    // Simplified sphere with shading
    this.ctx.fillStyle = tierColor.bright;
    this.ctx.globalAlpha = alpha * 0.9;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
    this.ctx.fill();

    // Shadow on bottom
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha * 0.5;
    this.ctx.beginPath();
    this.ctx.ellipse(0, radius * 0.3, radius * 0.8, radius * 0.3, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // Highlight spot
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    this.ctx.globalAlpha = alpha * 0.8;
    this.ctx.beginPath();
    this.ctx.arc(-radius * 0.35, -radius * 0.35, radius * 0.25, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _drawConeIso(radius, height, color, tierColor, alpha) {
    // Cone pointing right
    this.ctx.fillStyle = tierColor.bright;
    this.ctx.globalAlpha = alpha * 0.9;
    this.ctx.beginPath();
    this.ctx.moveTo(-height, 0);
    this.ctx.lineTo(height * 0.5, -radius);
    this.ctx.lineTo(height * 0.5, radius);
    this.ctx.closePath();
    this.ctx.fill();

    // Base
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha * 0.7;
    this.ctx.beginPath();
    this.ctx.ellipse(-height, 0, radius * 0.4, radius, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _drawPrismIso(radius, height, color, tierColor, alpha) {
    const w = radius;
    const h = height;

    // Front face
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha * 0.8;
    this.ctx.beginPath();
    this.ctx.moveTo(-w, 0);
    this.ctx.lineTo(0, -h);
    this.ctx.lineTo(w, 0);
    this.ctx.lineTo(w, h);
    this.ctx.lineTo(0, h + h * 0.3);
    this.ctx.lineTo(-w, h);
    this.ctx.closePath();
    this.ctx.fill();

    // Highlight edge
    this.ctx.strokeStyle = tierColor.bright;
    this.ctx.lineWidth = 2;
    this.ctx.globalAlpha = alpha * 0.6;
    this.ctx.beginPath();
    this.ctx.moveTo(0, -h);
    this.ctx.lineTo(0, h + h * 0.3);
    this.ctx.stroke();
  }

  _drawOctahedronIso(radius, color, tierColor, alpha) {
    const r = radius;
    const d = r * 0.7;

    // Top pyramid
    this.ctx.fillStyle = tierColor.bright;
    this.ctx.globalAlpha = alpha * 0.9;
    this.ctx.beginPath();
    this.ctx.moveTo(0, -d * 1.5);
    this.ctx.lineTo(r, 0);
    this.ctx.lineTo(0, d * 0.5);
    this.ctx.lineTo(-r, 0);
    this.ctx.closePath();
    this.ctx.fill();

    // Bottom pyramid
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = alpha * 0.7;
    this.ctx.beginPath();
    this.ctx.moveTo(0, d * 1.5);
    this.ctx.lineTo(r, 0);
    this.ctx.lineTo(0, d * 0.5);
    this.ctx.lineTo(-r, 0);
    this.ctx.closePath();
    this.ctx.fill();
  }

  _drawGearIso(radius, color, tierColor, alpha) {
    const teeth = 8;
    const toothHeight = radius * 0.3;
    const centerRadius = radius * 0.5;

    this.ctx.fillStyle = tierColor.base;
    this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();

    for (let i = 0; i < teeth * 2; i++) {
      const angle = (i / (teeth * 2)) * Math.PI * 2;
      const outerR = i % 2 === 0 ? radius : centerRadius;
      const x = Math.cos(angle) * outerR;
      const y = Math.sin(angle) * outerR;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    this.ctx.fill();

    // Center hole
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.beginPath();
    this.ctx.arc(0, 0, centerRadius * 0.4, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _drawGlow(radius, glowColor, alpha) {
    const gradient = this.ctx.createRadialGradient(0, 0, radius, 0, 0, radius * 1.5);
    gradient.addColorStop(0, glowColor);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    this.ctx.fillStyle = gradient;
    this.ctx.globalAlpha = alpha * 0.4;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius * 1.5, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _drawUpgradeBadge(config) {
    const badgeRadius = 12;
    this.ctx.save();
    this.ctx.translate(15, -15);

    // Badge background
    this.ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
    this.ctx.beginPath();
    this.ctx.arc(0, 0, badgeRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Badge text
    this.ctx.fillStyle = '#000';
    this.ctx.font = 'bold 10px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('✦', 0, 0);

    this.ctx.restore();
  }

  _drawHighlight(config) {
    this.ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
    this.ctx.lineWidth = 3;
    this.ctx.globalAlpha = 0.7;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, 50, 0, Math.PI * 2);
    this.ctx.stroke();
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IsometricModuleRenderer, ModuleType, MODULE_CONFIG };
} else {
  window.GQIsometricModuleRenderer = { IsometricModuleRenderer, ModuleType, MODULE_CONFIG };
}
