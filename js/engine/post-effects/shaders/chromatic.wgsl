// GalaxyQuest Engine — chromatic.wgsl
// WebGPU Post-Processing: Chromatic Aberration + Barrel Distortion
//
// Separates RGB channels by a small offset, simulating lens fringing.
// An optional barrel-distortion pre-warp ensures the shift follows realistic
// lens geometry: the shift magnitude grows toward screen edges.
//
// Inspired by Three.js RGBShiftShader (MIT) — https://github.com/mrdoob/three.js
//
// License: MIT — makr-code/GalaxyQuest

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var inputSmp : sampler;
@group(0) @binding(2) var<uniform> params : ChromaticParams;

struct ChromaticParams {
  power          : f32,   // shift magnitude (e.g. 0.005 – 0.02)
  angle          : f32,   // shift direction in radians (default 0 = horizontal)
  barrelStrength : f32,   // barrel-distortion warp factor (0 = off, 1 = strong)
  _pad           : f32,   // reserved (std140 alignment)
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

// Apply barrel distortion to a UV coordinate.
// Maps the UV through a radial warp centred at (0.5, 0.5).
fn barrelDistort(uv: vec2<f32>, strength: f32) -> vec2<f32> {
  let centred = uv - vec2<f32>(0.5);
  let r2      = dot(centred, centred);
  let warp    = 1.0 + strength * r2;
  return centred * warp + vec2<f32>(0.5);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Apply barrel distortion pre-warp when barrelStrength > 0
  let uv     = select(in.uv, barrelDistort(in.uv, params.barrelStrength),
                      params.barrelStrength > 0.0);

  // Edge-distance-scaled shift: aberration grows toward screen edges
  let centre  = uv - vec2<f32>(0.5);
  let edgeDist = length(centre);
  let scaledPower = params.power * (1.0 + edgeDist);

  let dir    = vec2<f32>(cos(params.angle), sin(params.angle));
  let shift  = dir * scaledPower;

  let r = textureSample(inputTex, inputSmp, uv + shift).r;
  let g = textureSample(inputTex, inputSmp, uv).g;
  let b = textureSample(inputTex, inputSmp, uv - shift).b;
  let a = textureSample(inputTex, inputSmp, uv).a;

  return vec4<f32>(r, g, b, a);
}
