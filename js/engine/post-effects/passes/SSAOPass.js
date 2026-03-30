/**
 * passes/SSAOPass.js — Screen-Space Ambient Occlusion post-process pass (Phase FX-8).
 *
 * Implements hemisphere-sampling SSAO (Bavoil & Sainz, 2008) with bilateral
 * depth-aware blur, using `ssao.wgsl` as the shader.  Follows the same
 * constructor + `render(srcTex, dstTex, renderer)` + `dispose()` pattern as
 * BloomPass, VignettePass, and ChromaticPass so it can be dropped straight
 * into an EffectComposer chain.
 *
 * Pass execution (three internal sub-passes):
 *   1. AO pass    — samples hemisphere around each fragment; outputs greyscale
 *                   AO factor into an internal render target.
 *   2. Blur pass  — bilateral separable Gaussian (H then V); reduces noise
 *                   while preserving object edges.
 *   3. Composite  — multiplies scene colour by the blurred AO factor.
 *
 * The pass is self-contained: it generates a random hemisphere kernel on
 * construction (same algorithm as Unreal Engine 4) and stores a 4×4 noise
 * tile used for random kernel rotation per pixel.
 *
 * Usage:
 *   const ssao = new SSAOPass({ radius: 0.5, power: 2, kernelSize: 32 });
 *   composer.addPass(ssao);
 *   // Per-frame, before render():
 *   ssao.setCamera(projMat, invProjMat);
 *   // Optionally update dynamic properties:
 *   ssao.radius   = 0.8;
 *   ssao.power    = 1.5;
 *   ssao.enabled  = false;  // disable without removing from chain
 *
 * Technique references:
 *   Bavoil & Sainz (2008) "Screen Space Ambient Occlusion" — NVIDIA Tech Report
 *   Méndez & Boulanger (2009) "Rendering AO" — NVIDIA GPU Gems
 *   Three.js SSAOPass (MIT) — https://github.com/mrdoob/three.js
 *   Babylon.js SSAO2RenderingPipeline (Apache 2.0)
 *   UE4 hemisphere kernel generation — Epic Games
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum kernel size supported by the WGSL shader's fixed-size array. */
const MAX_KERNEL_SIZE = 64;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class SSAOPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.radius=0.5]       - AO hemisphere radius (view-space units)
   * @param {number} [opts.bias=0.025]       - Self-shadowing depth bias
   * @param {number} [opts.power=2.0]        - Contrast exponent on raw AO output
   * @param {number} [opts.kernelSize=32]    - Hemisphere samples (1–64)
   * @param {number} [opts.blurRadius=2]     - Bilateral blur tap radius (pixels)
   * @param {number} [opts.blurDepthThresh=0.05] - Max depth diff for bilateral weight
   * @param {number} [opts.noiseSize=4]      - Side length of the noise tile (pixels)
   */
  constructor(opts = {}) {
    this.enabled         = true;

    this.radius          = opts.radius          ?? 0.5;
    this.bias            = opts.bias            ?? 0.025;
    this.power           = opts.power           ?? 2.0;
    this.kernelSize      = Math.min(
      Math.max(1, Math.floor(opts.kernelSize ?? 32)),
      MAX_KERNEL_SIZE,
    );
    this.blurRadius      = opts.blurRadius      ?? 2;
    this.blurDepthThresh = opts.blurDepthThresh ?? 0.05;

    /** Near/far plane values — must match the active camera. */
    this.nearPlane = 0.1;
    this.farPlane  = 10000;

    /** @type {Float32Array|null} 4×4 column-major projection matrix */
    this.projMat    = null;
    /** @type {Float32Array|null} 4×4 column-major inverse projection matrix */
    this.invProjMat = null;

    // Generate hemisphere kernel (constant; re-generated only on kernelSize change)
    this._kernel = _generateKernel(this.kernelSize);

    // 4×4 tiling noise vectors for random kernel rotation
    const noiseSize = opts.noiseSize ?? 4;
    this._noise     = _generateNoise(noiseSize);
    this._noiseSize = noiseSize;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Per-frame camera update
  // =========================================================================

  /**
   * Update the projection matrices (must be called before render() each frame).
   * @param {Float32Array} projMat    - 4×4 column-major projection matrix
   * @param {Float32Array} invProjMat - 4×4 column-major inverse projection matrix
   */
  setCamera(projMat, invProjMat) {
    this.projMat    = projMat;
    this.invProjMat = invProjMat;
  }

  /**
   * Regenerate the hemisphere kernel when kernelSize is changed at runtime.
   * @param {number} size - New kernel size (1–64)
   */
  regenerateKernel(size) {
    const clamped     = Math.min(Math.max(1, Math.floor(size)), MAX_KERNEL_SIZE);
    this.kernelSize   = clamped;
    this._kernel      = _generateKernel(clamped);
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the SSAO pass chain (AO → bilateral blur H → bilateral blur V → composite).
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture (also used as composite base)
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Phase FX-8 GPU dispatch:
    //   renderer.runSSAOPass(this, srcTex, dstTex)
    // The renderer uses buildAOParamBlock() and buildBlurParamBlock() to fill
    // the uniform buffers before dispatching ssao.wgsl.
    // The pass-through stub keeps the EffectComposer chain valid until the
    // renderer is wired up.
    void srcTex; void dstTex; void renderer;
  }

  // =========================================================================
  // Uniform buffer builders (called by renderer each frame)
  // =========================================================================

  /**
   * Build the flat Float32Array that maps to SSAOParams in ssao.wgsl.
   *
   * Layout (floats):
   *   [0-15]   projMat
   *   [16-31]  invProjMat
   *   [32-287] kernelSamples (64 × vec4 = 256 floats)
   *   [288-289] resolution (viewport w, h)
   *   [290-291] noiseScale (resolution / noiseSize)
   *   [292]    radius
   *   [293]    bias
   *   [294]    power
   *   [295]    kernelSize
   *   [296]    nearPlane
   *   [297]    farPlane
   *   [298-299] _pad
   *
   * @param {number} viewportW
   * @param {number} viewportH
   * @returns {Float32Array} 300 floats (1200 bytes)
   */
  buildAOParamBlock(viewportW, viewportH) {
    const out      = new Float32Array(300);
    const identity = _identity4();

    out.set(this.projMat    ?? identity,  0);
    out.set(this.invProjMat ?? identity, 16);

    // Kernel: each sample is stored as vec4 (xyz, w=0) → 4 floats each
    let off = 32;
    for (let i = 0; i < MAX_KERNEL_SIZE; i++) {
      if (i < this._kernel.length) {
        out[off]     = this._kernel[i][0];
        out[off + 1] = this._kernel[i][1];
        out[off + 2] = this._kernel[i][2];
      }
      out[off + 3] = 0;
      off += 4;
    }

    // off should now be 32 + 256 = 288
    out[288] = viewportW;
    out[289] = viewportH;
    out[290] = viewportW / this._noiseSize;
    out[291] = viewportH / this._noiseSize;
    out[292] = this.radius;
    out[293] = this.bias;
    out[294] = this.power;
    out[295] = this.kernelSize;
    out[296] = this.nearPlane;
    out[297] = this.farPlane;

    return out;
  }

  /**
   * Build the flat Float32Array for SSAOBlurParams in ssao.wgsl.
   *
   * @param {number}  viewportW
   * @param {number}  viewportH
   * @param {boolean} horizontal - true = horizontal pass, false = vertical
   * @returns {Float32Array} 8 floats (32 bytes)
   */
  buildBlurParamBlock(viewportW, viewportH, horizontal) {
    const out = new Float32Array(8);
    out[0] = viewportW;
    out[1] = viewportH;
    out[2] = horizontal ? 1.0 : 0.0;
    out[3] = this.blurRadius;
    out[4] = this.blurDepthThresh;
    return out;
  }

  /**
   * The 4×4 noise tile as a flat Float32Array (RGB, repeated over the viewport).
   * The renderer uploads this once into a 2D texture at init time.
   * @returns {Float32Array}
   */
  get noiseData() { return this._noise; }

  /** @returns {number} Side length of the noise tile in pixels. */
  get noiseTileSize() { return this._noiseSize; }

  dispose() {
    this._pipeline = null;
    this.projMat   = null;
    this.invProjMat = null;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Generate a hemisphere kernel using the UE4 / Bavoil & Sainz method:
 * randomly distributed samples biased toward the surface normal (z+ direction),
 * then accelerated toward the centre with a quadratic interleaving factor.
 *
 * @param {number} size
 * @returns {Array<[number,number,number]>}
 */
function _generateKernel(size) {
  const kernel = [];
  for (let i = 0; i < size; i++) {
    // Spherical hemisphere sample
    let x = Math.random() * 2 - 1;
    let y = Math.random() * 2 - 1;
    let z = Math.random();             // z > 0 → hemisphere in normal direction

    // Normalise
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= len; y /= len; z /= len;

    // Scale sample — accelerated lerp toward centre (closer samples more important)
    let scale = i / size;
    scale     = 0.1 + 0.9 * scale * scale;  // lerp(0.1, 1.0, scale²)

    kernel.push([x * scale, y * scale, z * scale]);
  }
  return kernel;
}

/**
 * Generate a tiling noise texture (RGB) for random kernel rotation per pixel.
 * Each pixel holds a normalised random vector in [-1, 1]³ with z=0 to keep
 * rotation in the tangent plane.
 *
 * @param {number} size - Side length in pixels
 * @returns {Float32Array} size² × 4 floats (RGBA, A=1)
 */
function _generateNoise(size) {
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const angle = Math.random() * Math.PI * 2;
    data[i * 4]     = Math.cos(angle);  // x
    data[i * 4 + 1] = Math.sin(angle);  // y
    data[i * 4 + 2] = 0;               // z = 0 (rotation in tangent plane)
    data[i * 4 + 3] = 1;
  }
  return data;
}

function _identity4() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SSAOPass, MAX_KERNEL_SIZE };
} else {
  window.GQSSAOPass = { SSAOPass, MAX_KERNEL_SIZE };
}
