// GalaxyQuest Engine — bloom.wgsl
// WebGPU Post-Processing: Two-pass Gaussian Bloom
//
// Pass 1 (threshold): extract bright pixels above threshold into a texture.
// Pass 2 (blur):      separable Gaussian — this file covers the horizontal
//                     pass; call again with uHorizontal=0 for vertical.
//
// Adapted from techniques described in:
//   Babylon.js BloomEffect (Apache 2.0) — https://github.com/BabylonJS/Babylon.js
//   Three.js UnrealBloomPass (MIT)       — https://github.com/mrdoob/three.js
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : BloomParams;

struct BloomParams {
  threshold  : f32,
  strength   : f32,
  radius     : f32,
  horizontal : f32,   // 1.0 = horizontal pass, 0.0 = vertical pass
}

// -------------------------------------------------------------------------
// Full-screen vertex shader (positions from vertex index — no VBO needed)
// -------------------------------------------------------------------------
struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  // Two triangles covering NDC [-1,1]
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

// -------------------------------------------------------------------------
// Threshold pass — bright-pass extract
// -------------------------------------------------------------------------
@fragment
fn fs_threshold(in: VSOut) -> @location(0) vec4<f32> {
  let col  = textureSample(inputTex, inputSmp, in.uv).rgb;
  let lum  = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  let keep = max(lum - params.threshold, 0.0) / max(lum, 0.0001);
  return vec4<f32>(col * keep * params.strength, 1.0);
}

// -------------------------------------------------------------------------
// Blur pass — 9-tap Gaussian, separable
// -------------------------------------------------------------------------
const WEIGHTS: array<f32, 5> = array<f32, 5>(0.2270270, 0.1945946, 0.1216216, 0.0540540, 0.0162162);

@fragment
fn fs_blur(in: VSOut) -> @location(0) vec4<f32> {
  let texSize = vec2<f32>(textureDimensions(inputTex, 0));
  let texel   = 1.0 / texSize;

  var col = textureSample(inputTex, inputSmp, in.uv).rgb * WEIGHTS[0];

  let dir = select(vec2<f32>(0.0, params.radius * texel.y),
                   vec2<f32>(params.radius * texel.x, 0.0),
                   params.horizontal > 0.5);

  for (var i: i32 = 1; i < 5; i++) {
    let offset = dir * f32(i);
    col += textureSample(inputTex, inputSmp, in.uv + offset).rgb * WEIGHTS[i];
    col += textureSample(inputTex, inputSmp, in.uv - offset).rgb * WEIGHTS[i];
  }

  return vec4<f32>(col, 1.0);
}
