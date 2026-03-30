// GalaxyQuest Engine — chromatic.wgsl
// WebGPU Post-Processing: Chromatic Aberration
//
// Separates RGB channels by a small offset, simulating lens fringing.
//
// Inspired by Three.js RGBShiftShader (MIT) — https://github.com/mrdoob/three.js
//
// License: MIT — makr-code/GalaxyQuest

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var inputSmp : sampler;
@group(0) @binding(2) var<uniform> params : ChromaticParams;

struct ChromaticParams {
  power   : f32,   // shift magnitude (e.g. 0.005 – 0.02)
  angle   : f32,   // shift direction in radians (default 0 = horizontal)
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

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dir    = vec2<f32>(cos(params.angle), sin(params.angle));
  let shift  = dir * params.power;

  let r = textureSample(inputTex, inputSmp, in.uv + shift).r;
  let g = textureSample(inputTex, inputSmp, in.uv).g;
  let b = textureSample(inputTex, inputSmp, in.uv - shift).b;
  let a = textureSample(inputTex, inputSmp, in.uv).a;

  return vec4<f32>(r, g, b, a);
}
