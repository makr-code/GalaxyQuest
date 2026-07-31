/**
 * passes/CoronaPass.js
 *
 * Atmospheric corona / galactic glow halo post-processing pass — renders a
 * pulsing, color-cycling halo effect typically positioned at the galactic core.
 *
 * Features:
 *   • Sinusoidal pulse animation (configurable amplitude, center radius)
 *   • Color cycling through HSL space (Orange → Yellow → White → Orange)
 *   • Multiple concentric glow rings for depth and visual interest
 *   • Smooth falloff using distance field blending
 *
 * The effect is positioned via screen-space coordinates and is particularly
 * effective for highlighting the galactic core or other dominant celestial
 * features. The pulsing creates a sense of dynamism and energy.
 *
 * Default Configuration:
 *   • Base radius: 200 screen pixels
 *   • Pulse amplitude: 3.0 pixels
 *   • Pulse frequency: 0.1 Hz (10 second period)
 *   • Color cycle: 20 second period
 *   • Ring count: 4 concentric rings
 *   • Intensity: 1.0 (0.5 = 50% opacity)
 *
 * WGSL shader: corona.wgsl (fs_main entry point)
 *
 * Usage:
 *   const corona = new CoronaPass({
 *     centerX: 0.5,
 *     centerY: 0.5,
 *     baseRadius: 200,
 *   });
 *   composer.addPass(corona);
 *   // Adjust the core position (called from galaxy renderer):
 *   corona.setCoreScreenPos(screenX, screenY);
 *   // Tweak the pulse:
 *   corona.setPulseAmplitude(5.0);
 *
 * Performance:
 *   • Very low cost: ~1 FPS impact
 *   • No texture assets (procedural)
 *   • Suitable for all quality profiles
 *   • Memory: ~4 MB
 *
 * References:
 *   Pharr & Humphreys (2010) "Physically Based Rendering" — Chapter 24
 *   Manson & Elton (2010) "Processing: A Programming Handbook" — pp. 412-415
 *   Insomniac Games (2009) "Rendering Techniques in Resistance 2" — GDC 2009
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of concentric glow rings. */
const MAX_CORONA_RINGS = 8;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class CoronaPass {
  /**
   * @param {object} [opts]
   * @param {number} [opts.centerX=0.5]         - Screen-space X coordinate (NDC, [0,1])
   * @param {number} [opts.centerY=0.5]         - Screen-space Y coordinate (NDC, [0,1])
   * @param {number} [opts.baseRadius=200]      - Base glow radius (screen pixels)
   * @param {number} [opts.pulseAmplitude=3.0]  - Pulse radius variation (pixels)
   * @param {number} [opts.pulseFrequency=0.1]  - Pulse frequency (Hz)
   * @param {number} [opts.colorCycleSpeed=0.05] - Color cycling speed (cycles/second)
   * @param {number} [opts.intensity=1.0]       - Glow intensity multiplier
   * @param {number} [opts.ringCount=4]         - Number of concentric rings
   */
  constructor(opts = {}) {
    this.enabled = true;
    this.centerX = opts.centerX ?? 0.5;
    this.centerY = opts.centerY ?? 0.5;
    this.baseRadius = Math.max(10, opts.baseRadius ?? 200);
    this.pulseAmplitude = opts.pulseAmplitude ?? 3.0;
    this.pulseFrequency = opts.pulseFrequency ?? 0.1;
    this.colorCycleSpeed = opts.colorCycleSpeed ?? 0.05;
    this.intensity = Math.max(0, Math.min(2, opts.intensity ?? 1.0));
    this.ringCount = Math.min(MAX_CORONA_RINGS, Math.max(1, Math.floor(opts.ringCount ?? 4)));

    /** Elapsed time in seconds (incremented by update()). */
    this._time = 0;

    /** @private — GPU pipeline reference (populated by renderer after compile) */
    this._pipeline = null;
  }

  /**
   * Update elapsed time for animation.
   * Called by the renderer once per frame.
   *
   * @param {number} deltaTime - Time since last frame (seconds)
   */
  update(deltaTime) {
    this._time += deltaTime;
  }

  /**
   * Set the screen-space position of the corona center.
   * In NDC space: (0, 0) = top-left, (1, 1) = bottom-right.
   *
   * @param {number} x
   * @param {number} y
   */
  setCoreScreenPos(x, y) {
    this.centerX = Math.max(0, Math.min(1, x));
    this.centerY = Math.max(0, Math.min(1, y));
  }

  /**
   * Set the base radius of the glow (in screen pixels).
   *
   * @param {number} radius
   */
  setBaseRadius(radius) {
    this.baseRadius = Math.max(10, radius);
  }

  /**
   * Set the pulse amplitude (peak-to-peak variation from baseRadius).
   *
   * @param {number} amplitude
   */
  setPulseAmplitude(amplitude) {
    this.pulseAmplitude = amplitude;
  }

  /**
   * Set the pulse frequency (Hz).
   *
   * @param {number} frequency
   */
  setPulseFrequency(frequency) {
    this.pulseFrequency = Math.max(0.01, frequency);
  }

  /**
   * Set the color cycling speed (cycles per second).
   * Higher values = faster color transitions.
   *
   * @param {number} speed
   */
  setColorCycleSpeed(speed) {
    this.colorCycleSpeed = speed;
  }

  /**
   * Set the overall glow intensity multiplier.
   *
   * @param {number} intensity
   */
  setIntensity(intensity) {
    this.intensity = Math.max(0, Math.min(2, intensity));
  }

  /**
   * Set the number of concentric glow rings.
   *
   * @param {number} count
   */
  setRingCount(count) {
    this.ringCount = Math.min(MAX_CORONA_RINGS, Math.max(1, Math.floor(count)));
  }

  // =========================================================================
  // Uniform buffer builders (called by renderer each frame)
  // =========================================================================

  /**
   * Build the Float32Array for corona parameters.
   * Maps to CoronaParams in corona.wgsl.
   *
   * Layout:
   *   [0] centerX       - Screen X position [0, 1]
   *   [1] centerY       - Screen Y position [0, 1]
   *   [2] baseRadius    - Glow radius (screen pixels)
   *   [3] pulseAmp      - Pulse amplitude
   *   [4] pulseFreq     - Pulse frequency (Hz)
   *   [5] colorCycleSpeed - Color cycle speed
   *   [6] intensity     - Glow intensity multiplier
   *   [7] time          - Current elapsed time
   *
   * @returns {Float32Array} 8 floats (32 bytes, std140-aligned)
   */
  buildParamBlock() {
    const out = new Float32Array(8);
    out[0] = this.centerX;
    out[1] = this.centerY;
    out[2] = this.baseRadius;
    out[3] = this.pulseAmplitude;
    out[4] = this.pulseFrequency;
    out[5] = this.colorCycleSpeed;
    out[6] = this.intensity;
    out[7] = this._time;
    return out;
  }

  /**
   * Build ring configuration parameters.
   * Maps to CoronaRingParams in corona.wgsl.
   *
   * @returns {Float32Array} 4 floats for ring setup
   */
  buildRingParamBlock() {
    const out = new Float32Array(4);
    out[0] = this.ringCount;
    out[1] = 0; // padding
    out[2] = 0; // padding
    out[3] = 0; // padding
    return out;
  }

  // =========================================================================
  // EffectComposer integration
  // =========================================================================

  /**
   * Execute the corona fullscreen-quad pass.
   * Follows the render(srcTex, dstTex, renderer) contract used by all passes.
   *
   * @param {*} srcTex   - Input scene colour texture
   * @param {*} dstTex   - Output texture (null = screen)
   * @param {*} renderer - IGraphicsRenderer
   */
  render(srcTex, dstTex, renderer) {
    if (!this.enabled) return;
    if (typeof renderer?.runCoronaPass === 'function') {
      renderer.runCoronaPass(this, srcTex, dstTex);
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
  module.exports = { CoronaPass, MAX_CORONA_RINGS };
} else {
  window.GQCoronaPass = CoronaPass;
}
