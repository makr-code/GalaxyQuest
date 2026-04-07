// GalaxyQuest Engine — starscintillation.wgsl
// WebGPU Post-Processing: Star Scintillation (Twinkle)
//
// Simulates atmospheric scintillation — the apparent twinkling of stars
// caused by refractive-index fluctuations in the atmosphere.
//
// Only high-luminance pixels (above threshold) are affected; the darker
// background and nebula layers are untouched.  The effect uses a hash noise
// function that varies both spatially (per pixel neighbourhood) and
// temporally (per frame via time), ensuring different stars twinkle
// independently and asynchronously.
//
// Algorithm:
//   1. Compute BT.709 luminance for each pixel
//   2. If luma > threshold, compute a per-pixel hash varying with time
//   3. Modulate RGB by 1 + amplitude * (hash - 0.5) * 2 (centred ±amplitude)
//   4. Smooth the mask boundary to avoid hard edges at the threshold
//
// References:
//   Dravins et al. (1997) "Atmospheric Intensity Scintillation of Stars"
//   Elite Dangerous star approach (Frontier Developments)
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : ScintillationParams;

struct ScintillationParams {
  threshold : f32,  // min luminance to apply effect [0, 1]
  amplitude : f32,  // max brightness variation [0, 1]
  speed     : f32,  // temporal noise frequency
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
// Per-pixel temporal hash (each bright pixel gets its own noise phase)
// -------------------------------------------------------------------------
fn scintillation_hash(uv: vec2<f32>, t: f32) -> f32 {
  // Coarsen UV to simulate the coherence patch of atmospheric turbulence
  let coarse = floor(uv * 120.0) / 120.0;
  return fract(
    sin(dot(coarse, vec2<f32>(127.1, 311.7)) + t * params.speed)
    * 43758.5453
  );
}

// -------------------------------------------------------------------------
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let col  = textureSample(inputTex, inputSmp, in.uv).rgb;
  let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));

  // Smooth mask: pixels well below threshold → unaffected; well above → full effect
  let mask = smoothstep(params.threshold - 0.05, params.threshold + 0.05, luma);

  // Centred [-1, +1] noise flicker
  let flicker = (scintillation_hash(in.uv, params.time) * 2.0 - 1.0) * params.amplitude;

  let out = col * (1.0 + flicker * mask);
  return vec4<f32>(clamp(out, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
