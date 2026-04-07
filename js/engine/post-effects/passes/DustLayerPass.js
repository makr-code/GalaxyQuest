/**
 * passes/DustLayerPass.js
 *
 * Volumetric dust / nebula layer post-processing pass.
 *
 * Renders 2–3 semi-transparent procedural animated layers between the
 * galaxy disc background and the star foreground.  Each layer is driven by
 * FBM (Fractional Brownian Motion) noise sampled at a different scale and
 * scroll speed to create a convincing parallax depth effect.
 *
 * Layer presets (inner, mid, outer) are provided and can be overridden at
 * construction time or updated at runtime.
 *
 * WGSL shader: dustlayer.wgsl (fs_main entry point)
 *
 * Usage:
 *   const dust = new DustLayerPass({ masterOpacity: 0.25 });
 *   composer.addPass(dust);
 *   // Advance time each frame:
 *   dust.update(dt);
 *   // Adjust at runtime:
 *   dust.masterOpacity = 0.35;
 *   dust.layers[0].colorHex = 0x6688bb;
 *
 * Industry references:
 *   Elite Dangerous supercruise dust (Frontier Developments)
 *   No Man's Sky nebula layers (Hello Games)
 *   EVE Online nebula background planes (CCP Games)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Number of dust layers (must match NUM_LAYERS in dustlayer.wgsl). */
const DUST_LAYER_COUNT = 3;

/** Floats per DustLayer entry in the uniform block. */
const FLOATS_PER_LAYER = 8; // scrollX, scrollY, scale, opacity, r, g, b, _pad

// ---------------------------------------------------------------------------
// Layer presets
// ---------------------------------------------------------------------------

/**
 * Default presets for the three depth layers.
 * Inner layer scrolls fastest (close to viewer), outer slowest.
 * @private
 */
const _DEFAULT_LAYER_PRESETS = [
  // Layer 0 — foreground (inner nebula wisps, fast parallax)
  { scrollX: 0.018, scrollY: 0.007,  scale: 3.2, opacity: 0.12, colorHex: 0x8899cc },
  // Layer 1 — mid-distance (main dust cloud body)
  { scrollX: 0.007, scrollY: 0.004,  scale: 1.8, opacity: 0.16, colorHex: 0x6677aa },
  // Layer 2 — background (deep-space wisps, barely moving)
  { scrollX: 0.002, scrollY: 0.001,  scale: 0.9, opacity: 0.10, colorHex: 0x445577 },
];

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class DustLayerPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.masterOpacity=0.22]  Global opacity multiplier [0,1]
   * @param {Array}  [opts.layers]              Override preset layers (array of layer opts)
   */
  constructor(opts = {}) {
    this.enabled       = true;
    this.masterOpacity = opts.masterOpacity ?? 0.22;

    /** @type {DustLayerRecord[]} */
    this.layers = [];

    const layerSrc = Array.isArray(opts.layers) && opts.layers.length >= DUST_LAYER_COUNT
      ? opts.layers.slice(0, DUST_LAYER_COUNT)
      : _DEFAULT_LAYER_PRESETS;

    for (let i = 0; i < DUST_LAYER_COUNT; i++) {
      const preset = layerSrc[i] ?? _DEFAULT_LAYER_PRESETS[i];
      this.layers.push({
        scrollX:  preset.scrollX  ?? 0.01,
        scrollY:  preset.scrollY  ?? 0.005,
        scale:    preset.scale    ?? 2.0,
        opacity:  preset.opacity  ?? 0.12,
        colorHex: preset.colorHex ?? 0x7788aa,
      });
    }

    /** Elapsed time in seconds. */
    this._time = 0;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Per-frame update
  // =========================================================================

  /**
   * Advance internal time. Call once per frame before render().
   * @param {number} dt - Frame delta in seconds
   */
  update(dt) {
    this._time += Number(dt) || 0;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to DustLayerParams in dustlayer.wgsl.
   *
   * Layout (floats):
   *   For each of the 3 layers (8 floats each):
   *     [0] scrollX, [1] scrollY, [2] scale, [3] opacity,
   *     [4] r, [5] g, [6] b, [7] _pad
   *   Then 4 tail floats:
   *     [24] time, [25] masterOpacity, [26] _pad0, [27] _pad1
   *
   * Total: 3 × 8 + 4 = 28 floats (112 bytes)
   *
   * @returns {Float32Array} 28 floats
   */
  buildParamBlock() {
    const TOTAL = DUST_LAYER_COUNT * FLOATS_PER_LAYER + 4;
    const out = new Float32Array(TOTAL);

    for (let i = 0; i < DUST_LAYER_COUNT; i++) {
      const layer = this.layers[i];
      const base  = i * FLOATS_PER_LAYER;
      const hex   = layer.colorHex ?? 0x7788aa;

      out[base]     = layer.scrollX;
      out[base + 1] = layer.scrollY;
      out[base + 2] = layer.scale;
      out[base + 3] = layer.opacity;
      out[base + 4] = ((hex >> 16) & 0xff) / 255;
      out[base + 5] = ((hex >>  8) & 0xff) / 255;
      out[base + 6] = ( hex        & 0xff) / 255;
      out[base + 7] = 0; // pad
    }

    const tail = DUST_LAYER_COUNT * FLOATS_PER_LAYER;
    out[tail]     = this._time;
    out[tail + 1] = this.masterOpacity;
    // [tail+2], [tail+3] reserved

    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the dust-layer fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runDustLayerPass === 'function') {
      renderer.runDustLayerPass(this, srcTex, dstTex);
    }
  }

  dispose() {
    this._pipeline = null;
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DustLayerPass, DUST_LAYER_COUNT };
} else {
  window.GQDustLayerPass = { DustLayerPass, DUST_LAYER_COUNT };
}
