/**
 * MotionVectorPass.js
 *
 * Generates per-pixel motion vectors for advanced motion blur effects.
 * Tracks velocity between frames to create realistic motion trails.
 *
 * Inspired by:
 *   - Unreal Engine: Motion vectors for motion blur
 *   - Babylon.js: Motion blur implementation
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class MotionVectorPass {
  /**
   * @param {object} opts
   * @param {number} opts.blurScale - Motion blur intensity (default: 1.0)
   * @param {number} opts.sampleCount - Number of motion blur samples (default: 8)
   * @param {number} opts.maxMotionBlur - Maximum blur radius (default: 15)
   */
  constructor(opts = {}) {
    this.enabled = true;
    this.name = 'MotionVectorPass';

    this.blurScale = opts.blurScale ?? 1.0;
    this.sampleCount = opts.sampleCount ?? 8;
    this.maxMotionBlur = opts.maxMotionBlur ?? 15;

    this._prevViewMatrix = null;
    this._currentViewMatrix = null;
    this._prevProjMatrix = null;
    this._currentProjMatrix = null;

    // Motion vector texture
    this._motionVectorTexture = null;

    // Shader code (WGSL) for motion vector generation
    this._vectorGeneratorShader = `
struct Uniforms {
  prevViewProj: mat4x4f,
  currViewProj: mat4x4f,
  resolution: vec2f,
};

@group(0) @binding(0) var positionTexture: texture_2d<f32>;
@group(0) @binding(1) var normalTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let worldPos = textureSample(positionTexture, samplerLinear, uv).rgb;
  
  // Project world position to previous frame
  let prevClipPos = uniforms.prevViewProj * vec4f(worldPos, 1.0);
  let prevScreenPos = (prevClipPos.xy / prevClipPos.w) * 0.5 + 0.5;
  
  // Project world position to current frame
  let currClipPos = uniforms.currViewProj * vec4f(worldPos, 1.0);
  let currScreenPos = (currClipPos.xy / currClipPos.w) * 0.5 + 0.5;
  
  // Motion vector
  let motionVector = (currScreenPos - prevScreenPos) * uniforms.resolution;
  let motionMagnitude = length(motionVector);
  
  return vec4f(motionVector, motionMagnitude, 1.0);
}
`;

    // Shader for motion blur application
    this._motionBlurShader = `
struct Uniforms {
  resolution: vec2f,
  blurScale: f32,
  sampleCount: u32,
  maxMotionBlur: f32,
};

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var motionVectorTexture: texture_2d<f32>;
@group(0) @binding(2) var samplr: sampler;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let motionVec = textureSample(motionVectorTexture, samplr, uv).xy;
  let motionLength = length(motionVec);
  
  if (motionLength < 0.5) {
    return textureSample(colorTexture, samplr, uv);
  }
  
  let direction = normalize(motionVec);
  let blurRadius = min(motionLength * uniforms.blurScale, uniforms.maxMotionBlur);
  
  var color = vec3f(0.0);
  let samples = f32(uniforms.sampleCount);
  
  for (var i = 0u; i < uniforms.sampleCount; i++) {
    let offset = direction * (f32(i) - samples * 0.5) / samples * blurRadius / uniforms.resolution;
    let sampleUv = uv + offset;
    color += textureSample(colorTexture, samplr, sampleUv).rgb / samples;
  }
  
  return vec4f(color, 1.0);
}
`;
  }

  /**
   * Initialize motion vector resources
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   * @param {number} width
   * @param {number} height
   */
  async initialize(renderer, width, height) {
    this._renderer = renderer;
    this._width = width;
    this._height = height;
    // Motion vector texture would be created here
  }

  /**
   * Render motion blur pass
   * @param {WebGPUTexture} srcTexture - Input color
   * @param {WebGPUTexture} depthTexture - Depth texture (unused, kept for compatibility)
   * @param {WebGPUTexture|null} dstTexture - Output texture
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  render(srcTexture, depthTexture, dstTexture, renderer) {
    if (!this.enabled || !renderer) {
      return;
    }

    console.debug('[MotionVectorPass] Applying motion blur with scale:', this.blurScale);
    // GPU shader execution would happen here
  }

  /**
   * Update view/projection matrices for motion tracking
   * @param {THREE.Matrix4|Float32Array} prevViewProj
   * @param {THREE.Matrix4|Float32Array} currViewProj
   */
  setViewProjectionMatrices(prevViewProj, currViewProj) {
    this._prevViewMatrix = prevViewProj;
    this._currentViewMatrix = currViewProj;
  }

  /**
   * Set motion blur intensity
   * @param {number} scale - Blur multiplier (0.0 - 2.0)
   */
  setBlurScale(scale) {
    this.blurScale = Math.max(0, Math.min(2.0, scale));
  }

  /**
   * Get motion vector shader
   * @returns {string}
   */
  getMotionVectorShader() {
    return this._vectorGeneratorShader;
  }

  /**
   * Get motion blur shader
   * @returns {string}
   */
  getMotionBlurShader() {
    return this._motionBlurShader;
  }

  /**
   * Dispose resources
   */
  dispose() {
    this._motionVectorTexture = null;
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MotionVectorPass };
}
if (typeof window !== 'undefined') {
  window.GQMotionVectorPass = { MotionVectorPass };
}
