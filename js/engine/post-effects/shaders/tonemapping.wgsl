// GalaxyQuest Engine — tonemapping.wgsl
// WebGPU Post-Processing: HDR Tone Mapping
//
// Converts HDR scene colours into displayable LDR output.
// Supports two industry-standard operators:
//   mode 0 — Reinhard (Reinhard et al., 2002)
//   mode 1 — ACES Filmic (narkowicz2015, Academy Color Encoding System approximation)
//
// Both operators preserve spatial colour relationships and prevent
// highlights from clipping to flat white.
//
// References:
//   Reinhard et al. (2002) "Photographic Tone Reproduction for Digital Images"
//   Narkowicz (2015) "ACES Filmic Tone Mapping Curve" — blog post
//   Babylon.js ImageProcessingPostProcess (Apache 2.0) — https://github.com/BabylonJS/Babylon.js
//   Three.js ACESFilmicToneMapping (MIT) — https://github.com/mrdoob/three.js
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : ToneMappingParams;

struct ToneMappingParams {
  mode     : f32,   // 0 = Reinhard, 1 = ACES
  exposure : f32,   // pre-exposure multiplier
  _pad0    : f32,
  _pad1    : f32,
}

// -------------------------------------------------------------------------
// Full-screen vertex shader
// -------------------------------------------------------------------------
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

// -------------------------------------------------------------------------
// Reinhard tone mapping operator
// Ref: Reinhard et al. (2002), Equation 3
// Maps [0,∞) → [0,1) without hard clipping.
// -------------------------------------------------------------------------
fn reinhard(c: vec3<f32>) -> vec3<f32> {
  return c / (c + vec3<f32>(1.0));
}

// -------------------------------------------------------------------------
// ACES Filmic approximation
// Ref: Narkowicz (2015) — fast piecewise polynomial approximation of the
// full ACES tone-map curve used in Unreal Engine 4.
// -------------------------------------------------------------------------
fn aces_filmic(c: vec3<f32>) -> vec3<f32> {
  let a: f32 = 2.51;
  let b: f32 = 0.03;
  let d: f32 = 2.43;
  let e: f32 = 0.59;
  let f: f32 = 0.14;
  return clamp((c * (a * c + b)) / (c * (d * c + e) + f), vec3<f32>(0.0), vec3<f32>(1.0));
}

// -------------------------------------------------------------------------
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var col = textureSample(inputTex, inputSmp, in.uv).rgb;

  // Apply exposure
  col *= params.exposure;

  // Select tone mapping operator
  var mapped: vec3<f32>;
  if (params.mode >= 0.5) {
    mapped = aces_filmic(col);
  } else {
    mapped = reinhard(col);
  }

  // Gamma correction (linear → sRGB approximation: x^(1/2.2))
  mapped = pow(max(mapped, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));

  return vec4<f32>(mapped, 1.0);
}
