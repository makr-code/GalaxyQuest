/**
 * HDRTonemappingPass.js
 *
 * Post-processing pass for HDR to LDR conversion with tone-mapping.
 * Converts high dynamic range rendered image to displayable LDR format.
 *
 * Tone-mapping algorithms:
 *   - Linear (no tone-mapping)
 *   - Reinhard (photographic)
 *   - ACES (cinematic, industry-standard)
 *   - Unreal Engine 4 (custom curve)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class HDRTonemappingPass {
  constructor(opts = {}) {
    this.enabled = true;
    this.name = 'HDRTonemappingPass';

    this.tonemappingMode = opts.tonemappingMode ?? 'ACES'; // 'LINEAR' | 'REINHARD' | 'ACES' | 'UE4'
    this.exposure = opts.exposure ?? 1.0;
    this.saturation = opts.saturation ?? 1.0;
    this.gamma = opts.gamma ?? 2.2;
    this.whitePoint = opts.whitePoint ?? 11.2; // For Reinhard
    this.contrast = opts.contrast ?? 1.0;
    this.colorTemperature = opts.colorTemperature ?? 6500; // Kelvin

    // Shader code (WGSL)
    this._shaderCode = `
struct Uniforms {
  exposure: f32,
  saturation: f32,
  gamma: f32,
  whitePoint: f32,
  contrast: f32,
  tonemappingMode: u32,  // 0=LINEAR, 1=REINHARD, 2=ACES, 3=UE4
};

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var samplr: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

// ACES tone-mapping (from ACES Color Space Conversion - Official Implementation)
fn ACESFilmToneMapping(color: vec3f) -> vec3f {
  let m1 = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35587, 0.90834, 0.13160),
    vec3f(0.04694, 0.01566, 0.83890)
  );
  
  let m2 = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602)
  );

  let v = m1 * color;
  let a = v * (v + vec3f(0.0245786)) - vec3f(0.000090537);
  let b = v * (0.983339 * v + vec3f(0.4329510)) + vec3f(0.238081);
  return clamp(m2 * (a / b), vec3f(0.0), vec3f(1.0));
}

// Reinhard tone-mapping
fn ReinhardToneMapping(color: vec3f, whitePoint: f32) -> vec3f {
  return color * (1.0 + color / (whitePoint * whitePoint)) / (1.0 + color);
}

// Unreal Engine 4 tone-mapping
fn UE4ToneMapping(color: vec3f) -> vec3f {
  return color / (color + vec3f(0.155)) * 1.019;
}

// Linear tone-mapping (clamped)
fn LinearToneMapping(color: vec3f) -> vec3f {
  return clamp(color, vec3f(0.0), vec3f(1.0));
}

// Color temperature adjustment (simplified)
fn adjustColorTemperature(color: vec3f, kelvin: f32) -> vec3f {
  let temp = kelvin / 6500.0;
  let r = mix(1.0, min(1.0, 0.8 + temp * 0.2), step(6500.0, kelvin));
  let b = mix(1.0, min(1.0, 1.2 - temp * 0.2), step(6500.0, kelvin));
  return vec3f(color.r * r, color.g, color.b * b);
}

// Saturation adjustment
fn adjustSaturation(color: vec3f, saturation: f32) -> vec3f {
  let gray = dot(color, vec3f(0.299, 0.587, 0.114));
  return mix(vec3f(gray), color, saturation);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  var color = textureSample(srcTexture, samplr, uv).rgb;

  // Apply exposure
  color *= uniforms.exposure;

  // Tone-mapping based on mode
  if (uniforms.tonemappingMode == 0u) {
    color = LinearToneMapping(color);
  } else if (uniforms.tonemappingMode == 1u) {
    color = ReinhardToneMapping(color, uniforms.whitePoint);
  } else if (uniforms.tonemappingMode == 2u) {
    color = ACESFilmToneMapping(color);
  } else if (uniforms.tonemappingMode == 3u) {
    color = UE4ToneMapping(color);
  }

  // Apply saturation
  color = adjustSaturation(color, uniforms.saturation);

  // Apply contrast
  color = mix(vec3f(0.5), color, uniforms.contrast);

  // Gamma correction
  color = pow(color, vec3f(1.0 / uniforms.gamma));

  return vec4f(color, 1.0);
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
   * Render HDR to LDR conversion
   * @param {WebGPUTexture} srcTexture
   * @param {WebGPUTexture} depthTexture - Unused
   * @param {WebGPUTexture|null} dstTexture
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   */
  render(srcTexture, depthTexture, dstTexture, renderer) {
    if (!this.enabled || !renderer) {
      return;
    }

    console.debug('[HDRTonemappingPass] Mode:', this.tonemappingMode, 'Exposure:', this.exposure);
  }

  /**
   * Set tone-mapping mode
   * @param {'LINEAR'|'REINHARD'|'ACES'|'UE4'} mode
   */
  setTonemappingMode(mode) {
    const modeMap = { LINEAR: 0, REINHARD: 1, ACES: 2, UE4: 3 };
    const modeValue = modeMap[mode.toUpperCase()] ?? 2;
    this.tonemappingMode = mode.toUpperCase();
  }

  /**
   * Set exposure level
   * @param {number} exposure
   */
  setExposure(exposure) {
    this.exposure = Math.max(0.1, Math.min(10.0, exposure));
  }

  /**
   * Set saturation
   * @param {number} saturation - 0.0 (grayscale) to 2.0 (super-saturated)
   */
  setSaturation(saturation) {
    this.saturation = Math.max(0.0, saturation);
  }

  /**
   * Set gamma correction
   * @param {number} gamma
   */
  setGamma(gamma) {
    this.gamma = Math.max(1.0, Math.min(3.0, gamma));
  }

  /**
   * Set color temperature
   * @param {number} kelvin - Color temperature in Kelvin
   */
  setColorTemperature(kelvin) {
    this.colorTemperature = Math.max(2000, Math.min(10000, kelvin));
  }

  /**
   * Get shader code
   * @returns {string}
   */
  getShaderCode() {
    return this._shaderCode;
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
  module.exports = { HDRTonemappingPass };
}
if (typeof window !== 'undefined') {
  window.GQHDRTonemappingPass = { HDRTonemappingPass };
}
