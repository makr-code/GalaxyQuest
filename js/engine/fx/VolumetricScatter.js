/**
 * VolumetricScatter.js — Shadow-map-aware volumetric light scattering (Phase FX-7).
 *
 * Manages the configuration and pass execution for volumetric in-scattering.
 * The actual GPU shading is performed by `volscatter.wgsl`, which ray-marches
 * through a participating medium and samples the shadow map at each step to
 * determine whether the point receives direct light.
 *
 * This class is renderer-agnostic: it holds all the parameter data needed by
 * the shader and exposes a `render(srcTex, dstTex, renderer)` method that
 * follows the same pattern as BloomPass / VignettePass so it can be inserted
 * into an EffectComposer chain.
 *
 * Physics/rendering references:
 *   Wronski (2014) "Volumetric Fog" — GDC 2014, Ubisoft Montreal
 *   Hillaire (2020) "A Scalable and Production Ready Sky and Atmosphere" — Epic
 *   Three.js VolumetricFog example (MIT) — https://github.com/mrdoob/three.js
 *   Babylon.js VolumetricLightScatteringPostProcess (Apache 2.0)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

/**
 * Participating medium preset — controls scatter/extinction coefficients and
 * Henyey-Greenstein anisotropy factor.
 *
 * Industry reference values:
 *   NEBULA      — thin, isotropic gas (EVE Online, Elite Dangerous)
 *   PLASMA      — glowing ionised medium, slight forward scatter (Star Citizen)
 *   DUST        — dusty/smoky, back-scatter dominant (X4: Foundations)
 *   ATMOSPHERE  — planet-bound thin atmosphere, forward scatter (No Man's Sky)
 *   DEEP_SPACE  — nearly vacuum; very weak scatter (Star Citizen deep space)
 * @enum {string}
 */
const ScatterMedium = Object.freeze({
  NEBULA:     'nebula',
  PLASMA:     'plasma',
  DUST:       'dust',
  ATMOSPHERE: 'atmosphere',
  DEEP_SPACE: 'deep_space',
  CUSTOM:     'custom',
});

// ---------------------------------------------------------------------------
// Medium presets  { scatterCoeff, extinction, anisotropy }
// ---------------------------------------------------------------------------

/** @private */
const _MEDIUM_PRESETS = {
  [ScatterMedium.NEBULA]:     { scatterCoeff: 0.08, extinction: 0.10, anisotropy:  0.00 },
  [ScatterMedium.PLASMA]:     { scatterCoeff: 0.20, extinction: 0.25, anisotropy:  0.30 },
  [ScatterMedium.DUST]:       { scatterCoeff: 0.15, extinction: 0.40, anisotropy: -0.20 },
  [ScatterMedium.ATMOSPHERE]: { scatterCoeff: 0.05, extinction: 0.06, anisotropy:  0.50 },
  [ScatterMedium.DEEP_SPACE]: { scatterCoeff: 0.01, extinction: 0.01, anisotropy:  0.00 },
  [ScatterMedium.CUSTOM]:     { scatterCoeff: 0.10, extinction: 0.15, anisotropy:  0.00 },
};

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class VolumetricScatter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.medium='nebula']       - ScatterMedium preset key
   * @param {number} [opts.numSteps=32]           - Ray-march steps (quality vs. performance)
   * @param {number} [opts.shadowBias=0.005]      - Shadow acne bias
   * @param {number} [opts.lightIntensity=1.0]    - Key-light intensity multiplier
   * @param {number} [opts.lightColorHex=0xffffff]- Key-light colour
   * @param {number} [opts.scatterColorHex=0xffffff] - Medium tint colour
   * @param {number} [opts.scatterCoeff]          - Override scatter σ_s (CUSTOM medium)
   * @param {number} [opts.extinction]            - Override extinction σ_t (CUSTOM medium)
   * @param {number} [opts.anisotropy]            - Override HG anisotropy g (CUSTOM medium)
   * @param {number} [opts.nearPlane=0.1]
   * @param {number} [opts.farPlane=10000]
   */
  constructor(opts = {}) {
    this.enabled = true;

    const mediumKey = opts.medium ?? ScatterMedium.NEBULA;
    const preset    = _MEDIUM_PRESETS[mediumKey] ?? _MEDIUM_PRESETS[ScatterMedium.NEBULA];

    this.medium         = mediumKey;
    this.numSteps       = opts.numSteps       ?? 32;
    this.shadowBias     = opts.shadowBias     ?? 0.005;
    this.lightIntensity = opts.lightIntensity ?? 1.0;
    this.nearPlane      = opts.nearPlane      ?? 0.1;
    this.farPlane       = opts.farPlane       ?? 10000;

    // Scatter medium coefficients
    this.scatterCoeff   = opts.scatterCoeff ?? preset.scatterCoeff;
    this.extinction     = opts.extinction   ?? preset.extinction;
    this.anisotropy     = opts.anisotropy   ?? preset.anisotropy;

    // Colours (stored as RGB triplets)
    this.lightColor   = _hexToRgb(opts.lightColorHex   ?? 0xffffff);
    this.scatterColor = _hexToRgb(opts.scatterColorHex ?? 0xffffff);

    // Camera matrices (caller must keep these up-to-date each frame)
    /** @type {Float32Array|null} 4×4 column-major inverse projection matrix */
    this.invProjMat  = null;
    /** @type {Float32Array|null} 4×4 column-major inverse view matrix */
    this.invViewMat  = null;
    /** @type {Float32Array|null} 4×4 column-major light view-projection matrix */
    this.lightVPMat  = null;

    // Light direction in view space (xyz, w unused)
    /** @type {[number,number,number]} */
    this.lightDirView = [0, -1, 0];

    // Shadow map texture handle (set by caller after shadow pass)
    /** @type {*} Renderer-specific shadow map texture reference */
    this.shadowMap = null;

    /** @private — GPU pipeline reference (set by renderer after compile) */
    this._pipeline = null;
  }

  // =========================================================================
  // Configuration helpers
  // =========================================================================

  /**
   * Switch to a different medium preset and reset coefficients accordingly.
   * @param {string} mediumKey - ScatterMedium value
   */
  setMedium(mediumKey) {
    const preset = _MEDIUM_PRESETS[mediumKey];
    if (!preset) {
      console.warn(`[VolumetricScatter] Unknown medium "${mediumKey}"`);
      return;
    }
    this.medium       = mediumKey;
    this.scatterCoeff = preset.scatterCoeff;
    this.extinction   = preset.extinction;
    this.anisotropy   = preset.anisotropy;
  }

  /**
   * Update the key-light direction (view space) and colour.
   * @param {{x,y,z}} dirView   - Normalised light direction in view space
   * @param {number}  colorHex  - Light colour hex
   * @param {number}  intensity - Intensity multiplier
   */
  setLight(dirView, colorHex, intensity = 1.0) {
    const len = Math.sqrt(dirView.x ** 2 + dirView.y ** 2 + dirView.z ** 2) || 1;
    this.lightDirView   = [dirView.x / len, dirView.y / len, dirView.z / len];
    this.lightColor     = _hexToRgb(colorHex);
    this.lightIntensity = intensity;
  }

  /**
   * Provide the shadow map texture and the light's view-projection matrix.
   * @param {*}            shadowMapTex - Renderer shadow map texture
   * @param {Float32Array} lightVPMat   - 4×4 column-major light VP matrix
   */
  setShadowMap(shadowMapTex, lightVPMat) {
    this.shadowMap  = shadowMapTex;
    this.lightVPMat = lightVPMat;
  }

  /**
   * Update per-frame camera matrices (must be called before render each frame).
   * @param {Float32Array} invProjMat - 4×4 inverse projection
   * @param {Float32Array} invViewMat - 4×4 inverse view
   */
  setCamera(invProjMat, invViewMat) {
    this.invProjMat = invProjMat;
    this.invViewMat = invViewMat;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the volumetric scatter pass.
   * Follows the same render(srcTex, dstTex, renderer) contract as BloomPass.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (or null for screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    // Phase FX-7 GPU dispatch: renderer is expected to call
    //   renderer.runVolScatterPass(this, srcTex, dstTex)
    // with the full parameter block supplied by buildParamBlock().
    // The pass-through stub below keeps EffectComposer chains valid until
    // the renderer is wired up.
    void srcTex; void dstTex; void renderer;
  }

  /**
   * Build the flat parameter array that maps 1:1 to the VolScatterParams
   * WGSL uniform buffer.  The renderer writes this into the param buffer
   * before dispatching the shader.
   *
   * Layout (floats):
   *   [0-15]  invProjMat (mat4 column-major)
   *   [16-31] invViewMat
   *   [32-47] lightVPMat
   *   [48-51] lightDirView (xyz, w=0)
   *   [52-55] lightColor (rgb, w=intensity)
   *   [56-59] scatterColor (rgb, w=scatterCoeff)
   *   [60]    extinction
   *   [61]    anisotropy
   *   [62]    numSteps
   *   [63]    shadowBias
   *   [64]    nearPlane
   *   [65]    farPlane
   *   [66-67] _pad
   *
   * @returns {Float32Array} 68 floats (272 bytes)
   */
  buildParamBlock() {
    const out      = new Float32Array(68);
    const identity = _identity4();
    const invProj  = this.invProjMat  ?? identity;
    const invView  = this.invViewMat  ?? identity;
    const lightVP  = this.lightVPMat  ?? identity;

    out.set(invProj,  0);
    out.set(invView, 16);
    out.set(lightVP, 32);

    // lightDirView
    out[48] = this.lightDirView[0];
    out[49] = this.lightDirView[1];
    out[50] = this.lightDirView[2];
    out[51] = 0;

    // lightColor + intensity
    out[52] = this.lightColor[0];
    out[53] = this.lightColor[1];
    out[54] = this.lightColor[2];
    out[55] = this.lightIntensity;

    // scatterColor + scatterCoeff
    out[56] = this.scatterColor[0];
    out[57] = this.scatterColor[1];
    out[58] = this.scatterColor[2];
    out[59] = this.scatterCoeff;

    out[60] = this.extinction;
    out[61] = this.anisotropy;
    out[62] = this.numSteps;
    out[63] = this.shadowBias;
    out[64] = this.nearPlane;
    out[65] = this.farPlane;

    return out;
  }

  dispose() {
    this._pipeline  = null;
    this.shadowMap  = null;
    this.invProjMat = null;
    this.invViewMat = null;
    this.lightVPMat = null;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function _hexToRgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >>  8) & 0xff) / 255,
    ( hex        & 0xff) / 255,
  ];
}

function _identity4() {
  // Column-major identity mat4
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
  module.exports = { VolumetricScatter, ScatterMedium };
} else {
  window.GQVolumetricScatter = { VolumetricScatter, ScatterMedium };
}
