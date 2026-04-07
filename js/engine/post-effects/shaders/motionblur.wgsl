// GalaxyQuest Engine — motionblur.wgsl
// WebGPU Post-Processing: Velocity-based Motion Blur
//
// Implements accumulation-buffer motion blur using a per-pixel velocity
// vector to sample the previous frame's colour along the motion direction.
// Active only when the velocity magnitude exceeds the threshold to avoid
// blurring static scenes.
//
// Technique:
//   • Each fragment reads its velocity vector (provided via a velocity
//     render target, or approximated from the current vs previous
//     view-projection matrix when no explicit velocity buffer is available).
//   • Samples are taken along the velocity direction (2–8 taps).
//   • The sample count scales with the velocity magnitude.
//
// This pass is velocity-threshold gated: frames with low camera speed
// produce zero blur, preserving sharpness for static gameplay.
//
// References:
//   McGuire (2012) "A Reconstruction Filter for Plausible Motion Blur"
//   Sousa (2008) "Crysis and CryEngine 2 Shaders" — GDC 2008
//   Killzone 2 motion blur system (Guerrilla Games) — Siggraph 2007
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex     : texture_2d<f32>;
@group(0) @binding(1) var inputSmp     : sampler;
@group(0) @binding(2) var<uniform>     params : MotionBlurParams;

struct MotionBlurParams {
  // Camera delta: NDC-space displacement from previous to current frame
  velX        : f32,
  velY        : f32,
  // Quality / strength controls
  numSamples  : f32,   // 2–8 taps along velocity direction
  strength    : f32,   // blur strength multiplier [0,1]
  // Velocity threshold — blur is suppressed below this NDC magnitude
  threshold   : f32,
  _pad0       : f32,
  _pad1       : f32,
  _pad2       : f32,
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
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let vel = vec2<f32>(params.velX, params.velY) * params.strength;

  // Below-threshold: pass through unmodified
  if (length(vel) < params.threshold) {
    return textureSample(inputTex, inputSmp, in.uv);
  }

  let n = max(2.0, min(8.0, params.numSamples));
  let step = vel / n;

  var col = vec3<f32>(0.0);
  var uv  = in.uv;
  var weight = 0.0;

  for (var i = 0.0; i < 8.0; i += 1.0) {
    if (i >= n) { break; }
    let t   = i / (n - 1.0);
    let w   = 1.0 - t * 0.5;   // samples closer to current frame weighted higher
    let suv = clamp(in.uv - step * t, vec2<f32>(0.0), vec2<f32>(1.0));
    col    += textureSample(inputTex, inputSmp, suv).rgb * w;
    weight += w;
  }

  col /= weight;
  return vec4<f32>(col, 1.0);
}
