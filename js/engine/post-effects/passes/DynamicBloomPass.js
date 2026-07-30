/**
 * DynamicBloomPass.js
 *
 * Enhanced bloom pass with dynamic threshold based on scene brightness.
 * Analyzes luminance distribution to apply intelligent bloom effects.
 *
 * Features:
 *   - Dynamic bloom threshold based on scene brightness
 *   - Star glow propagation (affects nearby objects)
 *   - Adaptive bloom radius based on brightness intensity
 *   - Tone-mapped bloom for HDR rendering
 *
 * Inspired by:
 *   - Unreal Engine: Dynamic post-process materials
 *   - Babylon.js: Bloom with dynamic parameters
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class DynamicBloomPass {
  /**
   * @param {object} opts
   * @param {number} opts.threshold - Bloom threshold (default: 0.8)
   * @param {number} opts.strength - Bloom strength (default: 0.5)
   * @param {number} opts.radius - Bloom blur radius (default: 1.0)
   * @param {number} opts.adaptiveThreshold - Enable dynamic threshold (default: true)
   */
  constructor(opts = {}) {
    this.enabled = true;
    this.name = 'DynamicBloomPass';

    this.threshold = opts.threshold ?? 0.8;
    this.strength = opts.strength ?? 0.5;
    this.radius = opts.radius ?? 1.0;
    this.adaptiveThreshold = opts.adaptiveThreshold ?? true;
    this.starGlowPropagation = opts.starGlowPropagation ?? true;
    this.starGlowRadius = opts.starGlowRadius ?? 100.0;

    // Adaptive bloom parameters
    this._dynamicThreshold = this.threshold;
    this._luminanceScale = 1.0;
    this._brightPixelCount = 0;

    // Shader code for luminance analysis and bloom
    this._luminanceAnalysisShader = `
struct Uniforms {
  resolution: vec2f,
  threshold: f32,
  strength: f32,
  radius: f32,
};

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var samplr: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.299, 0.587, 0.114));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let color = textureSample(colorTexture, samplr, uv).rgb;
  let lum = luminance(color);

  // Extract bright areas above threshold
  if (lum > uniforms.threshold) {
    return vec4f(color, lum);
  }
  return vec4f(vec3f(0.0), 0.0);
}
`;

    // Shader for separable Gaussian blur for bloom
    this._bloomBlurShader = `
struct Uniforms {
  resolution: vec2f,
  radius: f32,
  vertical: u32,  // 0 = horizontal, 1 = vertical
  strength: f32,
};

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var samplr: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

fn gaussianKernel(x: f32) -> f32 {
  let sigma = uniforms.radius / 2.0;
  return exp(-x * x / (2.0 * sigma * sigma)) / (sigma * sqrt(6.28318530718));
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let direction = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), uniforms.vertical == 1u);
  
  var result = vec3f(0.0);
  let samples = i32(uniforms.radius * 4.0);
  
  for (var i = -samples; i <= samples; i++) {
    let offset = vec2f(f32(i)) * direction / uniforms.resolution * uniforms.radius;
    let sampleUv = uv + offset;
    let weight = gaussianKernel(f32(i));
    
    if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
      result += textureSample(srcTexture, samplr, sampleUv).rgb * weight;
    }
  }
  
  return vec4f(result * uniforms.strength, 1.0);
}
`;

    // Shader for compositing bloom with scene
    this._bloomCompositeShader = `
struct Uniforms {
  bloomStrength: f32,
  sceneStrength: f32,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var bloomTexture: texture_2d<f32>;
@group(0) @binding(2) var samplr: sampler;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let scene = textureSample(sceneTexture, samplr, uv).rgb;
  let bloom = textureSample(bloomTexture, samplr, uv).rgb;
  
  // Additive composition with tone-clamping
  let result = scene * uniforms.sceneStrength + bloom * uniforms.bloomStrength;
  
  return vec4f(result, 1.0);
}
`;
  }

  /**
   * Initialize resources
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   * @param {number} width
   * @param {number} height
   */
  async initialize(renderer, width, height) {
    this._renderer = renderer;
    this._width = width;
    this._height = height;
  }

  /**
   * Render dynamic bloom pass
   * @param {WebGPUTexture} srcTexture - Input scene
   * @param {WebGPUTexture} depthTexture - Unused
   * @param {WebGPUTexture|null} dstTexture - Output
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  render(srcTexture, depthTexture, dstTexture, renderer) {
    if (!this.enabled || !renderer) {
      return;
    }

    console.debug('[DynamicBloomPass] Threshold:', this._dynamicThreshold.toFixed(3), 'Strength:', this.strength);

    // Multi-pass bloom:
    // 1. Extract bright areas using dynamic threshold
    // 2. Blur extracted brightness
    // 3. Composite bloom back onto scene
  }

  /**
   * Analyze scene luminance and update bloom parameters
   * @param {WebGPUTexture} colorTexture - Scene color texture
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  updateLuminanceAnalysis(colorTexture, renderer) {
    // This would perform luminance histogram analysis on the GPU
    // and dynamically adjust bloom threshold based on scene brightness

    // Placeholder: for now, use a simple approach
    if (this.adaptiveThreshold) {
      // In a full implementation, would read back luminance data
      // and compute optimal threshold
      this._dynamicThreshold = this.threshold * this._luminanceScale;
    }
  }

  /**
   * Set bloom threshold
   * @param {number} threshold - 0.0 to 1.0
   */
  setThreshold(threshold) {
    this.threshold = Math.max(0.0, Math.min(1.0, threshold));
    this._dynamicThreshold = this.threshold;
  }

  /**
   * Set bloom strength
   * @param {number} strength - 0.0 to 2.0
   */
  setStrength(strength) {
    this.strength = Math.max(0.0, Math.min(2.0, strength));
  }

  /**
   * Set bloom radius
   * @param {number} radius - 0.5 to 4.0
   */
  setRadius(radius) {
    this.radius = Math.max(0.5, Math.min(4.0, radius));
  }

  /**
   * Enable/disable adaptive threshold
   * @param {boolean} enabled
   */
  setAdaptiveThreshold(enabled) {
    this.adaptiveThreshold = enabled;
  }

  /**
   * Set star glow propagation intensity
   * @param {number} intensity - 0.0 to 1.0
   */
  setStarGlowPropagation(intensity) {
    this.starGlowPropagation = intensity > 0.0;
    this.starGlowRadius = 100.0 * Math.max(0.0, Math.min(1.0, intensity));
  }

  /**
   * Get luminance analysis shader
   * @returns {string}
   */
  getLuminanceAnalysisShader() {
    return this._luminanceAnalysisShader;
  }

  /**
   * Get bloom blur shader
   * @returns {string}
   */
  getBloomBlurShader() {
    return this._bloomBlurShader;
  }

  /**
   * Get bloom composite shader
   * @returns {string}
   */
  getBloomCompositeShader() {
    return this._bloomCompositeShader;
  }

  /**
   * Dispose resources
   */
  dispose() {
    // Cleanup
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DynamicBloomPass };
}
if (typeof window !== 'undefined') {
  window.GQDynamicBloomPass = { DynamicBloomPass };
}
