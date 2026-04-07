/**
 * passes/LensFlarePass.js
 *
 * Sprite-based lens flare post-processing pass.
 *
 * Composites multi-element lens flare artefacts for up to MAX_SOURCES bright
 * points (e.g. selected star, galactic core, NPC capital system).  Each
 * active source produces:
 *
 *   • A central starburst (4-spike cross with Gaussian falloff)
 *   • A soft central glow disc
 *   • 1–4 ghost discs reflected along the lens axis (screen-centre direction)
 *   • A subtle horizontal streak/halo
 *
 * Sources are registered with `addSource()` and removed with `removeSource()`
 * or `clearSources()`.  Typically the game calls `addSource()` on star hover/
 * selection and `clearSources()` on deselect.
 *
 * WGSL shader: lensflare.wgsl (fs_main entry point)
 *
 * Usage:
 *   const flare = new LensFlarePass({ ghostCount: 3, globalScale: 1.0 });
 *   composer.addPass(flare);
 *   // On star hover / selection:
 *   const id = flare.addSource(-0.3, 0.5, 1.4, 0xffeebb);
 *   // On deselect:
 *   flare.removeSource(id);
 *
 * References:
 *   Lengyel (2004) "Mathematics for 3D Game Programming" — Lens Flare
 *   Three.js Lensflare (MIT) — https://github.com/mrdoob/three.js
 *   Star Citizen lens flare system (Cloud Imperium Games)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Maximum number of simultaneously visible flare sources. */
const MAX_FLARE_SOURCES = 8;

/** Floats per FlareSource entry in the uniform block. */
const FLOATS_PER_SOURCE = 8; // posX, posY, intensity, r, g, b, active, _pad

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class LensFlarePass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.globalScale=1.0]   Master size multiplier for all flare elements
   * @param {number} [opts.ghostCount=3]      Ghost disc count per source (1–4)
   * @param {number} [opts.aspect=1.0]        Viewport aspect ratio (w/h); update each frame
   */
  constructor(opts = {}) {
    this.enabled     = true;
    this.globalScale = opts.globalScale ?? 1.0;
    this.ghostCount  = Math.min(4, Math.max(1, Math.floor(opts.ghostCount ?? 3)));
    this.aspect      = opts.aspect      ?? 1.0;

    /** Elapsed time in seconds (advance via update()). */
    this._time = 0;

    /** @type {Map<number, FlareSourceRecord>} Active flare sources keyed by ID. */
    this._sources = new Map();
    this._nextId  = 1;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Source management
  // =========================================================================

  /**
   * Register a new flare source.
   *
   * @param {number} ndcX      - Screen-space NDC X position [-1, 1]
   * @param {number} ndcY      - Screen-space NDC Y position [-1, 1]
   * @param {number} [intensity=1.0] - Brightness multiplier for this source
   * @param {number} [colorHex=0xffeebb] - Source colour tint (hex)
   * @returns {number} Source ID (pass to removeSource() to clean up)
   */
  addSource(ndcX, ndcY, intensity = 1.0, colorHex = 0xffeebb) {
    const id = this._nextId++;
    this._sources.set(id, {
      id,
      x:         Number(ndcX)      || 0,
      y:         Number(ndcY)      || 0,
      intensity: Number(intensity) || 1.0,
      r: ((colorHex >> 16) & 0xff) / 255,
      g: ((colorHex >>  8) & 0xff) / 255,
      b: ( colorHex        & 0xff) / 255,
    });
    return id;
  }

  /**
   * Update the NDC position of an existing source.
   * Useful when tracking a star as the camera pans.
   *
   * @param {number} id   - Source ID returned by addSource()
   * @param {number} ndcX - New NDC X
   * @param {number} ndcY - New NDC Y
   */
  updateSourcePosition(id, ndcX, ndcY) {
    const src = this._sources.get(id);
    if (!src) return;
    src.x = Number(ndcX) || 0;
    src.y = Number(ndcY) || 0;
  }

  /**
   * Remove a flare source by ID.
   * @param {number} id
   */
  removeSource(id) {
    this._sources.delete(id);
  }

  /** Remove all active flare sources. */
  clearSources() {
    this._sources.clear();
  }

  /** @returns {number} Count of currently active sources. */
  get sourceCount() { return this._sources.size; }

  // =========================================================================
  // Per-frame update
  // =========================================================================

  /**
   * Advance internal time and update aspect ratio.
   * Call once per frame before render().
   *
   * @param {number} dt          - Frame delta in seconds
   * @param {number} [aspect]    - Current viewport aspect ratio
   */
  update(dt, aspect) {
    this._time += Number(dt) || 0;
    if (aspect != null) this.aspect = Number(aspect) || this.aspect;
  }

  // =========================================================================
  // Uniform buffer builder (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array that maps to LensFlareParams in lensflare.wgsl.
   *
   * Layout (floats):
   *   [0 … (MAX_FLARE_SOURCES × FLOATS_PER_SOURCE) − 1]
   *       FlareSource[0..7]: posX, posY, intensity, r, g, b, active, _pad
   *   [+0] globalScale
   *   [+1] ghostCount
   *   [+2] aspect
   *   [+3] time
   *
   * Total: MAX_FLARE_SOURCES*8 + 4 = 68 floats
   *
   * @returns {Float32Array} 68 floats (272 bytes)
   */
  buildParamBlock() {
    const TOTAL = MAX_FLARE_SOURCES * FLOATS_PER_SOURCE + 4;
    const out = new Float32Array(TOTAL);

    const srcArray = Array.from(this._sources.values()).slice(0, MAX_FLARE_SOURCES);

    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      const base = i * FLOATS_PER_SOURCE;
      const src  = srcArray[i];
      if (src) {
        out[base]     = src.x;
        out[base + 1] = src.y;
        out[base + 2] = src.intensity;
        out[base + 3] = src.r;
        out[base + 4] = src.g;
        out[base + 5] = src.b;
        out[base + 6] = 1.0; // active
        out[base + 7] = 0;   // pad
      } else {
        // Fill with zeros, active = 0
        for (let k = 0; k < FLOATS_PER_SOURCE; k++) out[base + k] = 0;
      }
    }

    const tail = MAX_FLARE_SOURCES * FLOATS_PER_SOURCE;
    out[tail]     = this.globalScale;
    out[tail + 1] = this.ghostCount;
    out[tail + 2] = this.aspect;
    out[tail + 3] = this._time;

    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the lens-flare compositing fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runLensFlarePass === 'function') {
      renderer.runLensFlarePass(this, srcTex, dstTex);
    }
  }

  dispose() {
    this._pipeline = null;
    this._sources.clear();
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LensFlarePass, MAX_FLARE_SOURCES };
} else {
  window.GQLensFlarePass = { LensFlarePass, MAX_FLARE_SOURCES };
}
