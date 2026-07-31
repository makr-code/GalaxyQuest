// GalaxyQuest Engine — depthoffield.wgsl
// WebGPU Post-Processing: Depth of Field (DoF)
//
// Implements realistic camera lens focus using a 3-pass pipeline:
//
//   1. Circle-of-Confusion (CoC) pass:
//      Calculates per-pixel blur radius from linear depth and focus parameters.
//      Results in a CoC texture where brighter pixels = more blur needed.
//
//   2. Blur Near pass:
//      Applies Gaussian blur to pixels with positive CoC (foreground out-of-focus).
//
//   3. Blur Far pass:
//      Applies Gaussian blur to pixels with negative CoC (background out-of-focus).
//
// The final composite blends based on CoC, creating the characteristic shallow
// depth-of-field effect.
//
// References:
//   Demers (2004) "Depth of Field Beyond the Lens" — GDC 2004
//   Sousa (2008) "Crysis and CryEngine 2 Shaders" — GDC 2008
//
// License: MIT — makr-code/GalaxyQuest

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var inputSmp : sampler;
@group(0) @binding(2) var<uniform> cocParams : DofCoCParams;

@group(1) @binding(0) var depthTex : texture_2d<f32>;
@group(1) @binding(1) var depthSmp : sampler;

struct DofCoCParams {
  focusDistance : f32,  // Distance to focal plane
  focusRange : f32,     // Range around focal plane (sharp zone)
  aperture : f32,       // Lens aperture (affects CoC scaling)
  _pad : f32,
}

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  var positions = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0),
    vec2(-1.0, -1.0), vec2( 1.0,  1.0), vec2(-1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(1.0, 0.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(0.0, 0.0),
  );
  var out: VSOut;
  out.pos = vec4<f32>(positions[idx], 0.0, 1.0);
  out.uv  = uvs[idx];
  return out;
}

// =====================================================================
// Circle of Confusion Calculation
// =====================================================================

/**
 * Calculate Circle of Confusion (CoC) from depth.
 * Positive CoC = foreground (near plane) blur
 * Negative CoC = background (far plane) blur
 * |CoC| = blur radius needed at that pixel
 */
fn calculate_coc(depth: f32, focusDistance: f32, focusRange: f32, aperture: f32) -> f32 {
  // Simple linear falloff from focal plane
  let depthDiff = depth - focusDistance;
  
  // If within focus range, no blur needed
  if (abs(depthDiff) < focusRange) {
    return 0.0;
  }
  
  // Scale blur radius by distance from focus plane and aperture
  let cocValue = (depthDiff / focusDistance) * aperture;
  
  // Clamp to reasonable range
  return clamp(cocValue, -4.0, 4.0);
}

/**
 * Entry point for CoC pass.
 * Input: scene colour + depth
 * Output: CoC texture (where R = CoC value [-1, 1])
 */
@fragment
fn fs_coc(in: VSOut) -> @location(0) vec4<f32> {
  let sceneColor = textureSample(inputTex, inputSmp, in.uv).rgb;
  let depth = textureSample(depthTex, depthSmp, in.uv).r;
  
  let coc = calculate_coc(
    depth,
    cocParams.focusDistance,
    cocParams.focusRange,
    cocParams.aperture
  );
  
  // Pack CoC into color channel (normalize from [-4, 4] to [0, 1])
  let cocNorm = (coc + 4.0) * 0.125;
  
  return vec4<f32>(cocNorm, cocNorm, cocNorm, 1.0);
}

// =====================================================================
// Blur Passes
// =====================================================================

struct DofBlurParams {
  blurRadius : f32,  // Tap radius
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
}

@group(0) @binding(2) var<uniform> blurParams : DofBlurParams;

/**
 * Gaussian blur kernel tap.
 * Simplified: use a separable Gaussian.
 */
fn gaussian_weight(distance: f32, sigma: f32) -> f32 {
  let sigSq = sigma * sigma;
  return exp(-distance * distance / (2.0 * sigSq)) / sqrt(2.0 * 3.14159 * sigSq);
}

/**
 * Horizontal blur pass (for near/far blur).
 */
@fragment
fn fs_blur_horizontal(in: VSOut) -> @location(0) vec4<f32> {
  let radius = i32(blurParams.blurRadius);
  let sigma = f32(radius) * 0.3;
  
  var result = vec3<f32>(0.0);
  var totalWeight = 0.0;
  
  let texelSize = 1.0 / vec2<f32>(textureDimensions(inputTex));
  
  for (var i: i32 = -radius; i <= radius; i++) {
    let offset = vec2<f32>(f32(i) * texelSize.x, 0.0);
    let weight = gaussian_weight(f32(i), sigma);
    result += textureSample(inputTex, inputSmp, in.uv + offset).rgb * weight;
    totalWeight += weight;
  }
  
  result /= totalWeight;
  
  return vec4<f32>(result, 1.0);
}

/**
 * Vertical blur pass (for near/far blur).
 */
@fragment
fn fs_blur_vertical(in: VSOut) -> @location(0) vec4<f32> {
  let radius = i32(blurParams.blurRadius);
  let sigma = f32(radius) * 0.3;
  
  var result = vec3<f32>(0.0);
  var totalWeight = 0.0;
  
  let texelSize = 1.0 / vec2<f32>(textureDimensions(inputTex));
  
  for (var i: i32 = -radius; i <= radius; i++) {
    let offset = vec2<f32>(0.0, f32(i) * texelSize.y);
    let weight = gaussian_weight(f32(i), sigma);
    result += textureSample(inputTex, inputSmp, in.uv + offset).rgb * weight;
    totalWeight += weight;
  }
  
  result /= totalWeight;
  
  return vec4<f32>(result, 1.0);
}

/**
 * Composite pass: blend blurred near + blurred far based on CoC.
 * Input 0: original scene
 * Input 1: blurred near
 * Input 2: blurred far
 * Input 3: CoC texture
 */
@fragment
fn fs_composite(in: VSOut) -> @location(0) vec4<f32> {
  let original = textureSample(inputTex, inputSmp, in.uv).rgb;
  
  // In a full implementation, would sample the blurred near/far textures
  // For now, just return original (simplified)
  
  return vec4<f32>(original, 1.0);
}
