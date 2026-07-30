/**
 * DepthOfFieldPass.js
 *
 * Post-processing pass for Depth of Field effect.
 * Simulates camera focus with bokeh blur on out-of-focus areas.
 *
 * Inspired by:
 *   - Unreal Engine: Focal length DOF with customizable bokeh
 *   - Babylon.js: Depth of field implementation
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class DepthOfFieldPass {
  /**
   * @param {object} opts
   * @param {number} opts.focalDistance - Distance at which objects are in focus (default: 1000)
   * @param {number} opts.focalLength - Camera focal length in mm (default: 50)
   * @param {number} opts.aperture - F-number (lower = shallower DOF, default: 2.8)
   * @param {number} opts.maxBlur - Maximum blur radius in pixels (default: 20)
   */
  constructor(opts = {}) {
    this.enabled = true;
    this.name = 'DepthOfFieldPass';

    this.focalDistance = opts.focalDistance ?? 1000;
    this.focalLength = opts.focalLength ?? 50;
    this.aperture = opts.aperture ?? 2.8;
    this.maxBlur = opts.maxBlur ?? 20;
    this.bokehShape = opts.bokehShape ?? 'circular'; // 'circular' | 'hexagon' | 'octagon'

    // Shader code (WGSL)
    this._shaderCode = `
struct Uniforms {
  resolution: vec2f,
  focalDistance: f32,
  focalLength: f32,
  aperture: f32,
  maxBlur: f32,
  bokehShape: u32,
};

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var depthTexture: texture_2d<f32>;
@group(0) @binding(2) var samplr: sampler;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

fn getDepth(uv: vec2f) -> f32 {
  return textureSample(depthTexture, samplr, uv).r;
}

fn getCocRadius(depth: f32) -> f32 {
  let coc = abs(depth - uniforms.focalDistance) * uniforms.aperture / (uniforms.focalLength * depth);
  return clamp(coc * uniforms.maxBlur, 0.0, uniforms.maxBlur);
}

fn bokehFilter(color: vec3f, uv: vec2f, radius: f32) -> vec3f {
  let samples = 16;
  var result = color;
  let invSamples = 1.0 / f32(samples);

  for (var i = 0u; i < samples; i++) {
    let angle = 6.28318530718 * f32(i) / f32(samples);
    let offset = vec2f(cos(angle), sin(angle)) * radius / uniforms.resolution;
    let sampleUv = uv + offset;
    if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
      result += textureSample(srcTexture, samplr, sampleUv).rgb * invSamples;
    }
  }

  return result;
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let depth = getDepth(uv);
  let color = textureSample(srcTexture, samplr, uv).rgb;
  
  let cocRadius = getCocRadius(depth);

  var result = color;
  if (cocRadius > 0.5) {
    result = bokehFilter(color, uv, cocRadius);
  }

  return vec4f(result, 1.0);
}
`;

    this._computeShader = null;
    this._pipeline = null;
    this._bindGroup = null;
  }

  /**
   * Initialize WebGPU resources
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   * @param {number} width
   * @param {number} height
   */
  async initialize(renderer, width, height) {
    // This would be called when integrated into EffectComposer
    // For now, we define the interface but defer GPU resource creation
    this._renderer = renderer;
    this._width = width;
    this._height = height;
  }

  /**
   * Render pass
   * @param {WebGPUTexture} srcTexture - Input color texture
   * @param {WebGPUTexture} depthTexture - Depth texture
   * @param {WebGPUTexture|null} dstTexture - Output texture (null = screen)
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  render(srcTexture, depthTexture, dstTexture, renderer) {
    if (!this.enabled || !renderer) {
      return;
    }

    // Compute shader execution would happen here
    // This is a placeholder for the actual GPU implementation
    console.debug('[DepthOfFieldPass] Rendering DOF with focal distance:', this.focalDistance);
  }

  /**
   * Update focal parameters
   * @param {number} focalDistance
   * @param {number} focalLength
   * @param {number} aperture
   */
  setFocalParameters(focalDistance, focalLength, aperture) {
    this.focalDistance = focalDistance;
    this.focalLength = focalLength;
    this.aperture = aperture;
  }

  /**
   * Get shader code for this pass
   * @returns {string}
   */
  getShaderCode() {
    return this._shaderCode;
  }

  /**
   * Dispose GPU resources
   */
  dispose() {
    this._pipeline = null;
    this._bindGroup = null;
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DepthOfFieldPass };
}
if (typeof window !== 'undefined') {
  window.GQDepthOfFieldPass = { DepthOfFieldPass };
}
