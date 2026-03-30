// GalaxyQuest Engine — vignette.wgsl
// WebGPU Post-Processing: Vignette Effect
//
// Darkens screen edges using a smooth radial falloff.
//
// Inspired by Three.js VignetteShader (MIT) — https://github.com/mrdoob/three.js
//
// License: MIT — makr-code/GalaxyQuest

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var inputSmp : sampler;
@group(0) @binding(2) var<uniform> params : VignetteParams;

struct VignetteParams {
  darkness : f32,
  falloff  : f32,
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
  let col    = textureSample(inputTex, inputSmp, in.uv).rgb;

  // Distance from centre in [0,1] space
  let coord  = in.uv * 2.0 - vec2<f32>(1.0);
  let dist   = length(coord);
  let factor = smoothstep(1.0 - params.falloff, 1.0, dist) * params.darkness;

  return vec4<f32>(col * (1.0 - factor), 1.0);
}
