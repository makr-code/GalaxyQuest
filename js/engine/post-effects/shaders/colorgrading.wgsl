// GalaxyQuest Engine — colorgrading.wgsl
// WebGPU Post-Processing: Analytical Color Grading
//
// Applies Brightness / Contrast / Saturation / Hue-Shift corrections in
// linear light using the standard Lift–Gamma–Gain analytical model.
//
// Processing order:
//   1. Brightness  — additive offset applied to each RGB channel
//   2. Contrast    — pivot-at-grey (0.5) multiplier
//   3. Saturation  — luma-preserving chroma multiplier (BT.709 luma weights)
//   4. Hue shift   — rotation in the YCbCr colour space
//
// References:
//   Poynton (2003) "Digital Video and HDTV" — YCbCr colour space
//   DaVinci Resolve Color Manual — Lift/Gamma/Gain model
//   Unreal Engine 5 PostProcessVolume (Epic Games, MIT for reference)
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : ColorGradingParams;

struct ColorGradingParams {
  brightness : f32,   // additive offset per channel [-1, 1]
  contrast   : f32,   // multiplier around 0.5 [0, 3]
  saturation : f32,   // chroma multiplier [0, 3]
  hueShift   : f32,   // hue rotation in radians
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
// Hue rotation in YCbCr space (2D rotation of Cb, Cr components)
// -------------------------------------------------------------------------
fn hue_rotate(c: vec3<f32>, angle: f32) -> vec3<f32> {
  // BT.709 luma weights
  let luma  = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let cb    = c.b - luma;
  let cr    = c.r - luma;
  let cs    = sin(angle);
  let cc    = cos(angle);
  let new_cr = cr * cc - cb * cs;
  let new_cb = cr * cs + cb * cc;
  return vec3<f32>(
    clamp(luma + new_cr, 0.0, 1.0),
    clamp(luma - 0.1146 * new_cb - 0.3945 * new_cr, 0.0, 1.0),
    clamp(luma + new_cb, 0.0, 1.0),
  );
}

// -------------------------------------------------------------------------
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var col = textureSample(inputTex, inputSmp, in.uv).rgb;

  // 1. Brightness — additive exposure offset
  col = col + vec3<f32>(params.brightness);

  // 2. Contrast — pivot around mid-grey (0.5)
  col = (col - vec3<f32>(0.5)) * params.contrast + vec3<f32>(0.5);

  // 3. Saturation — mix toward luminance
  let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  col = mix(vec3<f32>(luma), col, params.saturation);

  // 4. Hue shift
  if (params.hueShift != 0.0) {
    col = hue_rotate(col, params.hueShift);
  }

  col = clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(col, 1.0);
}
