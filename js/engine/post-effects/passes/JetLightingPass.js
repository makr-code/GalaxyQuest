/**
 * passes/JetLightingPass.js
 *
 * Relativistic jet lighting post-processing pass.
 *
 * Adds dynamic, directional luminous halos representing the astrophysical jets
 * emitted from active galactic nuclei (AGN) or the galaxy's central black hole.
 * Each jet source emits light along a direction vector, creating a elongated
 * glow with a narrow bright core and a wide diffuse penumbra.
 *
 * Up to MAX_JET_SOURCES jets can be active simultaneously.  Jets are registered
 * with `addJet()` and removed with `removeJet()`.  Intensity, spread and colour
 * can be updated at runtime for pulsing or event-driven animation.
 *
 * WGSL shader: jetlighting.wgsl (fs_main entry point)
 *
 * Usage:
 *   const jets = new JetLightingPass({ globalIntensity: 1.0 });
 *   composer.addPass(jets);
 *   // Register jets (AGN — two opposing jets):
 *   jets.addJet(0.0, 0.05,  0.0, 1.0, 0x88bbff, 1.2, 0.18); // north jet
 *   jets.addJet(0.0, -0.05, 0.0, -1.0, 0x88bbff, 1.0, 0.18); // south jet
 *   // Advance each frame:
 *   jets.update(dt);
 *
 * References:
 *   Mirabel & Rodriguez (1999) "Sources of Relativistic Jets"
 *   Event Horizon Telescope (2019) — M87* jet morphology
 *   No Man's Sky black hole visualisation (Hello Games)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Maximum number of simultaneously active jet sources. */
const MAX_JET_SOURCES = 4;

/** Floats per jet entry in the uniform block. */
const FLOATS_PER_JET = 8; // posX, posY, dirX, dirY, r, g, b, intensity

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class JetLightingPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.globalIntensity=1.0]  Master intensity multiplier [0, 3]
   * @param {number} [opts.spread=0.18]          Default angular spread (cos angle) [0, 1]
   */
  constructor(opts = {}) {
    this.enabled         = true;
    this.globalIntensity = opts.globalIntensity ?? 1.0;
    this.spread          = opts.spread          ?? 0.18;

    /** Elapsed time in seconds. */
    this._time = 0;

    /** @type {Map<number, JetRecord>} Active jets keyed by ID. */
    this._jets   = new Map();
    this._nextId = 1;

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
  // Jet source management
  // =========================================================================

  /**
   * Register a new jet light source.
   *
   * @param {number} ndcX      - Screen-space NDC X position of the jet origin [-1, 1]
   * @param {number} ndcY      - Screen-space NDC Y position of the jet origin [-1, 1]
   * @param {number} dirX      - Normalised direction vector X component
   * @param {number} dirY      - Normalised direction vector Y component
   * @param {number} [colorHex=0x88bbff] - Jet colour as 24-bit hex (0xRRGGBB)
   * @param {number} [intensity=1.0]     - Jet brightness multiplier [0, 3]
   * @param {number} [spread]            - Angular half-width; defaults to this.spread
   * @returns {number} Unique jet ID for future updates/removal
   */
  addJet(ndcX, ndcY, dirX = 0, dirY = 1, colorHex = 0x88bbff, intensity = 1.0, spread) {
    if (this._jets.size >= MAX_JET_SOURCES) return -1;

    const id = this._nextId++;
    const hex = colorHex >>> 0;
    this._jets.set(id, {
      x:         ndcX,
      y:         ndcY,
      dirX:      dirX,
      dirY:      dirY,
      r:         ((hex >> 16) & 0xff) / 255,
      g:         ((hex >>  8) & 0xff) / 255,
      b:         ( hex        & 0xff) / 255,
      intensity: intensity,
      spread:    spread ?? this.spread,
    });
    return id;
  }

  /**
   * Update properties of an existing jet.
   * @param {number} id     - Jet ID returned by addJet()
   * @param {object} props  - Properties to update (any subset of jet fields)
   */
  updateJet(id, props = {}) {
    const jet = this._jets.get(id);
    if (!jet) return;
    if (props.x         !== undefined) jet.x         = props.x;
    if (props.y         !== undefined) jet.y         = props.y;
    if (props.dirX      !== undefined) jet.dirX      = props.dirX;
    if (props.dirY      !== undefined) jet.dirY      = props.dirY;
    if (props.intensity !== undefined) jet.intensity = props.intensity;
    if (props.spread    !== undefined) jet.spread    = props.spread;
    if (props.colorHex  !== undefined) {
      const hex = props.colorHex >>> 0;
      jet.r = ((hex >> 16) & 0xff) / 255;
      jet.g = ((hex >>  8) & 0xff) / 255;
      jet.b = ( hex        & 0xff) / 255;
    }
  }

  /**
   * Remove a jet by its ID.
   * @param {number} id
   */
  removeJet(id) {
    this._jets.delete(id);
  }

  /** Remove all active jets. */
  clearJets() {
    this._jets.clear();
  }

  /** Number of currently active jet sources. */
  get jetCount() {
    return this._jets.size;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to JetLightingParams in jetlighting.wgsl.
   *
   * Layout (floats):
   *   For each of MAX_JET_SOURCES slots (8 floats each):
   *     [0] posX, [1] posY, [2] dirX, [3] dirY,
   *     [4] r,    [5] g,    [6] b,    [7] intensity
   *   Then 4 tail floats:
   *     [N*8+0] time            — elapsed seconds
   *     [N*8+1] globalIntensity — master multiplier
   *     [N*8+2] spread          — global default spread
   *     [N*8+3] activeCount     — number of active jets [0, MAX_JET_SOURCES]
   *
   * Total: 4 × 8 + 4 = 36 floats (144 bytes)
   *
   * @returns {Float32Array} 36 floats
   */
  buildParamBlock() {
    const TOTAL = MAX_JET_SOURCES * FLOATS_PER_JET + 4;
    const out   = new Float32Array(TOTAL);

    let slot = 0;
    for (const jet of this._jets.values()) {
      if (slot >= MAX_JET_SOURCES) break;
      const base = slot * FLOATS_PER_JET;
      out[base]     = jet.x;
      out[base + 1] = jet.y;
      out[base + 2] = jet.dirX;
      out[base + 3] = jet.dirY;
      out[base + 4] = jet.r;
      out[base + 5] = jet.g;
      out[base + 6] = jet.b;
      out[base + 7] = jet.intensity;
      slot++;
    }

    const tail = MAX_JET_SOURCES * FLOATS_PER_JET;
    out[tail]     = this._time;
    out[tail + 1] = this.globalIntensity;
    out[tail + 2] = this.spread;
    out[tail + 3] = slot; // active jet count
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the jet-lighting fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runJetLightingPass === 'function') {
      renderer.runJetLightingPass(this, srcTex, dstTex);
    }
  }

  dispose() {
    this._pipeline = null;
    this.clearJets();
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JetLightingPass, MAX_JET_SOURCES };
} else {
  window.GQJetLightingPass = { JetLightingPass, MAX_JET_SOURCES };
}
