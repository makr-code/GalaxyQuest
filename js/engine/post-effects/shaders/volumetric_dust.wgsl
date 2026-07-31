// GalaxyQuest Engine — volumetric_dust.wgsl
// WebGPU Post-Processing: Volumetric Dust and Nebula Layers
//
// Renders multiple procedurally-animated dust/nebula layers using 2D Perlin noise.
// Each layer has independent color, opacity, parallax scale, and animation speed.
//
// The Perlin noise is procedurally generated (no texture assets) using classic
// permutation-based 2D Perlin implementation. Layers are composited with
// multiplicative blending for organic appearance.
//
// License: MIT — makr-code/GalaxyQuest

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var inputSmp : sampler;
@group(0) @binding(2) var<uniform> params : DustParams;

struct DustParams {
  // Color and opacity for up to 8 layers (RGBA packed)
  // layers[0].rgb + layers[0].a (opacity)
  // layers[1].rgb + layers[1].a (opacity)
  // ... up to 8 layers
  // Followed by global params: time, baseOpacity, layerCount, _pad
  data : array<vec4<f32>, 9>,  // 8 layers + 1 global
}

struct DustLayerProps {
  scale : f32,
  speed : f32,
  _pad0 : f32,
  _pad1 : f32,
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
// Perlin Noise (2D)
// =====================================================================

/**
 * Pseudo-random permutation table (classic Perlin).
 * Used to generate pseudo-random gradients.
 */
fn permute(x: f32) -> f32 {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

/**
 * Interpolation function (Perlin's fade curve).
 * Smooth cubic easing with zero first derivative at endpoints.
 */
fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/**
 * Linear interpolation.
 */
fn lerp(t: f32, a: f32, b: f32) -> f32 {
  return a + t * (b - a);
}

/**
 * Simple 2D Perlin noise.
 * Returns value in approximately [-1, 1].
 */
fn perlin_noise_2d(p: vec2<f32>) -> f32 {
  // Grid cell coordinates
  let i = floor(p);
  let f = fract(p);
  
  // Fade curve
  let u = fade(f.x);
  let v = fade(f.y);
  
  // Hash the grid cell corners
  let ii = i.x;
  let jj = i.y;
  
  let a = permute(ii + permute(jj));
  let aa = permute(a);
  let ab = permute(a + 1.0);
  let b = permute(ii + 1.0 + permute(jj));
  let ba = permute(b);
  let bb = permute(b + 1.0);
  
  // Pseudo-random gradients for each corner
  // Simplified: just use permuted values directly
  let g00 = 2.0 * fract(aa / 7.0) - 1.0;
  let g10 = 2.0 * fract(ab / 7.0) - 1.0;
  let g01 = 2.0 * fract(ba / 7.0) - 1.0;
  let g11 = 2.0 * fract(bb / 7.0) - 1.0;
  
  // Distance vectors and dot products
  let d00 = g00 * f.x + g00 * f.y;
  let d10 = g10 * (f.x - 1.0) + g10 * f.y;
  let d01 = g01 * f.x + g01 * (f.y - 1.0);
  let d11 = g11 * (f.x - 1.0) + g11 * (f.y - 1.0);
  
  // Interpolate
  let sx = lerp(u, d00, d10);
  let sy = lerp(u, d01, d11);
  let result = lerp(v, sx, sy);
  
  return result;
}

/**
 * Fractional Brownian Motion (layered Perlin noise).
 * Combines multiple octaves for richer detail.
 */
fn fbm(p: vec2<f32>, octaves: u32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var max_value = 0.0;
  
  for (var i: u32 = 0u; i < octaves; i++) {
    value += amplitude * perlin_noise_2d(p * frequency);
    max_value += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  
  return value / max_value;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let sceneColor = textureSample(inputTex, inputSmp, in.uv).rgb;
  
  // Extract global parameters from params.data[8]
  let globalParams = params.data[8];
  let time = globalParams.x;
  let baseOpacity = globalParams.y;
  let layerCount = u32(globalParams.z);
  
  var dustColor = vec3<f32>(0.0);
  
  // Render each layer
  for (var i: u32 = 0u; i < layerCount && i < 8u; i++) {
    let layerData = params.data[i];
    let layerColor = layerData.rgb;
    let layerOpacity = layerData.a;
    
    // Layer-specific parameters (simplified; normally would come from separate buffer)
    // For now, use derived scales
    let layerScale = 2.0 + f32(i) * 2.0;        // Increasing scale per layer
    let layerSpeed = 0.001 * (1.0 + f32(i) * 0.5);  // Varying speeds
    
    // Parallax offset: layer position depends on scale (closer = more motion)
    let parallaxOffset = vec2<f32>(
      in.uv.x * layerScale - time * layerSpeed,
      in.uv.y * layerScale - time * layerSpeed * 0.7
    );
    
    // Sample noise
    let noiseVal = fbm(parallaxOffset, 3u);
    
    // Remap noise from [-1, 1] to [0, 1]
    let noiseSampled = noiseVal * 0.5 + 0.5;
    
    // Apply layer color with opacity
    let layerContribution = layerColor * noiseSampled * layerOpacity;
    
    // Additive blending for layers
    dustColor += layerContribution;
  }
  
  // Blend dust onto scene
  let finalColor = mix(sceneColor, sceneColor + dustColor, baseOpacity * 0.3);
  
  return vec4<f32>(finalColor, 1.0);
}
