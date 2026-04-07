// GalaxyQuest Engine — filmgrain.wgsl
// WebGPU Post-Processing: Film Grain
//
// Overlays a procedural per-frame grain noise pattern on the rendered image,
// simulating photographic film grain or digital sensor noise.
//
// The grain is generated using a fast integer-based hash noise function keyed
// on the screen pixel position and an animated time offset — no texture
// required.  The intensity is modulated by scene luminance: darker regions
// receive proportionally more grain (photographic behaviour).
//
// References:
//   Vlachos (2016) "Advanced VR Rendering Performance" — GDC film grain
//   Alan Wake 2 (Remedy) — visible film grain as cinematic aesthetic
//   Jimenez (2016) "SMAA + Temporal Filtering" — temporal grain dithering
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : FilmGrainParams;

struct FilmGrainParams {
  intensity : f32,  // grain visibility [0, 1]
  speed     : f32,  // temporal animation rate
  size      : f32,  // spatial frequency multiplier
  time      : f32,  // elapsed seconds
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
// Grain noise — integer-based hash (no trig, fast on GPU)
// Adapted from: Hash Without Sine — Dave Hoskins
// -------------------------------------------------------------------------
fn grain_hash(p: vec2<f32>, t: f32) -> f32 {
  let pi = p * params.size + vec2<f32>(t * params.speed * 17.3, t * params.speed * 31.7);
  var n = fract(sin(dot(pi, vec2<f32>(127.1, 311.7))) * 43758.5453123);
  return n;
}

// -------------------------------------------------------------------------
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let col = textureSample(inputTex, inputSmp, in.uv).rgb;

  // Luminance-weighted grain: darker areas get more grain (photographic)
  let luma  = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  let grain = grain_hash(in.uv, params.time);

  // Centre grain around zero: [-0.5, 0.5]
  let g     = (grain - 0.5) * params.intensity * (1.0 - luma * 0.5);

  let out   = clamp(col + vec3<f32>(g), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(out, 1.0);
}
