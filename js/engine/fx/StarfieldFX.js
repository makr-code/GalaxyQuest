/**
 * StarfieldFX.js — Engine-native starfield FX layer.
 *
 * Integrates the background starfield simulation into the GameEngine FX
 * pipeline so it can be composed with combat and environmental effects.
 *
 * Provides three independent render layers that can be stacked:
 *
 *   BACKGROUND   — deep-space star field (dense, static, barely parallaxed)
 *   PARALLAX     — mid-distance stars (moderate parallax, slight twinkle)
 *   DEEP_FIELD   — nearby bright stars / sparse foreground layer
 *
 * Warp-streak mode: when `warpFactor` > 0 all active layers switch to radial
 * streak rendering, producing the classic hyperspace look.  The factor should
 * be driven by the WarpFX engage/travel/disengage lifecycle.
 *
 * Shader: js/engine/fx/shaders/starfield.wgsl
 *
 * Each StarfieldLayer is a renderer-agnostic data record that the host
 * renderer maps to the appropriate GPU draw call.
 *
 * References:
 *   Elite Dangerous: Horizons starfield (Frontier Developments)
 *   Star Citizen background star field (Cloud Imperium Games)
 *   No Man's Sky parallax starfield (Hello Games)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Starfield layer type — controls parallax weight, star density and
 * brightness for each depth level.
 * @enum {string}
 */
const StarfieldLayerType = Object.freeze({
  /** Dense, static deep-space background. Minimal parallax (weight ≈ 0). */
  BACKGROUND: 'background',
  /** Mid-distance parallax layer. Moderate twinkle + gentle drift. */
  PARALLAX:   'parallax',
  /** Sparse bright foreground stars. Strong parallax (weight ≈ 1). */
  DEEP_FIELD: 'deep_field',
});

// ---------------------------------------------------------------------------
// Layer presets  { parallaxWeight, density, baseSizeScale, twinkleAmt, brightness }
// ---------------------------------------------------------------------------

/** @private */
const _LAYER_PRESETS = {
  [StarfieldLayerType.BACKGROUND]: {
    parallaxWeight: 0.02,
    density:        3000,
    baseSizeScale:  0.6,
    twinkleAmt:     0.05,
    brightness:     0.55,
  },
  [StarfieldLayerType.PARALLAX]: {
    parallaxWeight: 0.15,
    density:        800,
    baseSizeScale:  1.0,
    twinkleAmt:     0.25,
    brightness:     0.80,
  },
  [StarfieldLayerType.DEEP_FIELD]: {
    parallaxWeight: 0.55,
    density:        150,
    baseSizeScale:  1.6,
    twinkleAmt:     0.45,
    brightness:     1.0,
  },
};

// ---------------------------------------------------------------------------
// Record-ID counter (shared with EnvironmentFX namespace in same process)
// ---------------------------------------------------------------------------

let _sfxRecId = 2000;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class StarfieldFX {
  /**
   * @param {object} [opts]
   * @param {number} [opts.defaultStarCount=4500]  - Total stars spread across default layers.
   * @param {number} [opts.seed=0]                 - PRNG seed for reproducible star placement.
   * @param {number} [opts.fieldRadius=5000]        - World-space radius of the star sphere.
   */
  constructor(opts = {}) {
    this._defaultStarCount = opts.defaultStarCount ?? 4500;
    this._seed             = opts.seed             ?? 0;
    this._fieldRadius      = opts.fieldRadius      ?? 5000;

    /** @type {StarfieldLayerRecord[]} */
    this._layers = [];

    /** Global warp factor [0,1].  Set by WarpFX or game code. */
    this.warpFactor = 0;

    /** Global elapsed time, advanced by update(). */
    this._time = 0;
  }

  // =========================================================================
  // Layer management
  // =========================================================================

  /**
   * Spawn a starfield layer.
   *
   * @param {string} [type=StarfieldLayerType.BACKGROUND] - Layer type preset.
   * @param {object} [opts]
   * @param {number} [opts.starCount]          - Override star count for this layer.
   * @param {number} [opts.parallaxWeight]     - Override parallax weight [0,1].
   * @param {number} [opts.baseSizeScale]      - Override point-sprite size multiplier.
   * @param {number} [opts.twinkleAmt]         - Override twinkle amplitude [0,1].
   * @param {number} [opts.brightness]         - Override master brightness [0,1].
   * @param {number} [opts.colorHex=0xffffff]  - Base star colour tint.
   * @param {number} [opts.colorVariance=0.3]  - Per-star colour variance [0,1].
   * @returns {StarfieldLayerRecord}
   */
  spawnLayer(type = StarfieldLayerType.BACKGROUND, opts = {}) {
    const preset = _LAYER_PRESETS[type] ?? _LAYER_PRESETS[StarfieldLayerType.BACKGROUND];
    const count  = opts.starCount ?? Math.round(this._defaultStarCount * preset.density / 3000);

    const rec = {
      id:             _sfxRecId++,
      type,
      active:         true,
      starCount:      count,
      parallaxWeight: opts.parallaxWeight ?? preset.parallaxWeight,
      baseSizeScale:  opts.baseSizeScale  ?? preset.baseSizeScale,
      twinkleAmt:     opts.twinkleAmt     ?? preset.twinkleAmt,
      brightness:     opts.brightness     ?? preset.brightness,
      colorHex:       opts.colorHex       ?? 0xffffff,
      colorVariance:  opts.colorVariance  ?? 0.3,
      fieldRadius:    this._fieldRadius,
      seed:           this._seed + _sfxRecId,
      // State updated each frame
      warpFactor:     0,
      time:           0,
      // Cached star instances (Float32Array with x,y,z,color,size,layer per star)
      instances:      _generateStarInstances(count, this._fieldRadius, preset.parallaxWeight, opts),
    };

    this._layers.push(rec);
    return rec;
  }

  /**
   * Convenience: spawn all three default layers at once.
   * @returns {StarfieldLayerRecord[]}
   */
  spawnDefaultLayers() {
    return [
      this.spawnLayer(StarfieldLayerType.BACKGROUND),
      this.spawnLayer(StarfieldLayerType.PARALLAX),
      this.spawnLayer(StarfieldLayerType.DEEP_FIELD),
    ];
  }

  /**
   * Remove a specific layer by record or ID.
   * @param {StarfieldLayerRecord|number} layerOrId
   */
  removeLayer(layerOrId) {
    const id = typeof layerOrId === 'number' ? layerOrId : layerOrId?.id;
    const idx = this._layers.findIndex(l => l.id === id);
    if (idx !== -1) { this._layers.splice(idx, 1); }
  }

  // =========================================================================
  // Warp-streak mode
  // =========================================================================

  /**
   * Set the global warp factor.  At 0 stars are rendered as points/soft
   * circles.  At 1 they are fully stretched into radial streaks.
   * This is typically driven by WarpFX.
   *
   * @param {number} factor - [0, 1]
   */
  setWarpFactor(factor) {
    this.warpFactor = Math.max(0, Math.min(1, Number(factor) || 0));
    for (const layer of this._layers) {
      if (layer.active) layer.warpFactor = this.warpFactor;
    }
  }

  // =========================================================================
  // Update — call once per frame
  // =========================================================================

  /**
   * Advance all layer state by `dt` seconds.
   * @param {number} dt
   */
  update(dt) {
    this._time += dt;
    for (const layer of this._layers) {
      if (!layer.active) continue;
      layer.time       = this._time;
      layer.warpFactor = this.warpFactor;
    }
  }

  // =========================================================================
  // Read-only accessors (for renderer)
  // =========================================================================

  /** @returns {StarfieldLayerRecord[]} All active layers. */
  get layers() { return this._layers.filter(l => l.active); }

  /** @returns {number} Elapsed seconds since construction. */
  get time() { return this._time; }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Remove inactive layers to reclaim memory.
   */
  prune() {
    this._layers = this._layers.filter(l => l.active);
  }

  /**
   * Dispose all layers and release instance buffers.
   */
  dispose() {
    for (const layer of this._layers) {
      layer.active    = false;
      layer.instances = null;
    }
    this._layers.length = 0;
    this._time          = 0;
    this.warpFactor     = 0;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Generate per-star instance data as a flat Float32Array.
 * Layout per star (8 floats): px, py, pz, colorPacked(as float bits), size, layer, pad0, pad1
 *
 * @param {number} count
 * @param {number} radius
 * @param {number} layerWeight
 * @param {object} opts
 * @returns {Float32Array}
 * @private
 */
function _generateStarInstances(count, radius, layerWeight, opts = {}) {
  const FLOATS_PER_STAR = 8;
  const out = new Float32Array(count * FLOATS_PER_STAR);

  const baseColor     = opts.colorHex       ?? 0xffffff;
  const colorVariance = opts.colorVariance  ?? 0.3;

  for (let i = 0; i < count; i++) {
    // Uniform sphere distribution (Marsaglia method)
    let x1, x2, s;
    do {
      x1 = Math.random() * 2 - 1;
      x2 = Math.random() * 2 - 1;
      s  = x1 * x1 + x2 * x2;
    } while (s >= 1);
    const sq = Math.sqrt(1 - s);
    const px = 2 * x1 * sq * radius;
    const py = 2 * x2 * sq * radius;
    const pz = (1 - 2 * s)  * radius;

    // Colour with variance
    const vr = 1 - colorVariance * Math.random();
    const vg = 1 - colorVariance * Math.random();
    const vb = 1 - colorVariance * Math.random();
    const br = ((baseColor >> 16) & 0xff) / 255;
    const bg = ((baseColor >>  8) & 0xff) / 255;
    const bb = ( baseColor        & 0xff) / 255;
    const cr = Math.min(1, br * vr);
    const cg = Math.min(1, bg * vg);
    const cb = Math.min(1, bb * vb);

    // Pack R8G8B8A8 into a 32-bit uint, then reinterpret as float32 bits
    const packed = (((cr * 255) & 0xff) << 24) |
                   (((cg * 255) & 0xff) << 16) |
                   (((cb * 255) & 0xff) <<  8) |
                   0xff;
    // Store packed colour as float bits via DataView trick
    const tmpBuf = new ArrayBuffer(4);
    const dv     = new DataView(tmpBuf);
    dv.setUint32(0, packed >>> 0, false);
    const colorAsFloat = dv.getFloat32(0, false);

    // Per-star size variation
    const size  = 0.5 + Math.random();

    const base = i * FLOATS_PER_STAR;
    out[base + 0] = px;
    out[base + 1] = py;
    out[base + 2] = pz;
    out[base + 3] = colorAsFloat;
    out[base + 4] = size;
    out[base + 5] = layerWeight;
    out[base + 6] = 0; // pad0
    out[base + 7] = 0; // pad1
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StarfieldFX, StarfieldLayerType };
} else {
  window.GQStarfieldFX = { StarfieldFX, StarfieldLayerType };
}
