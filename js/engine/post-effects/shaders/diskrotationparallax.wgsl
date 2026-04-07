// GalaxyQuest Engine — diskrotationparallax.wgsl
// WebGPU Post-Processing: Galaxy Disc Rotation Parallax
//
// Simulates Keplerian differential rotation of a galaxy disc: inner regions
// orbit faster than outer regions, creating the characteristic trailing spiral
// arm pattern.
//
// The pass applies a UV-space rotation warp to the scene texture centred on
// the galaxy disc origin.  The rotation angle is interpolated from
// innerVelocity (at radius 0) to outerVelocity (at radius 1) using a
// smooth falloff curve, then multiplied by elapsed time.
//
// The warp is additive and centred — it displaces sample UVs by the rotation
// offset so the disc appears to have rotated since the previous frame.  The
// cumulative rotation over time produces a plausible approximation of
// galactic rotation without physically simulating N-body dynamics.
//
// References:
//   Kepler's Third Law — angular velocity ∝ r^(-3/2) for Keplerian orbits
//   Milky Way flat rotation curve — v(r) ≈ 220 km/s (post-turnover)
//   No Man's Sky Galaxy (Hello Games) — galactic rotation visual
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : DiskRotationParams;

struct DiskRotationParams {
  innerVelocity : f32,  // angular velocity at r=0 (rad/s)
  outerVelocity : f32,  // angular velocity at r=1 (rad/s)
  centerX       : f32,  // disc centre UV X [0, 1]
  centerY       : f32,  // disc centre UV Y [0, 1]
  time          : f32,  // elapsed seconds
  _pad0         : f32,
  _pad1         : f32,
  _pad2         : f32,
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
  let centre = vec2<f32>(params.centerX, params.centerY);
  let delta  = in.uv - centre;
  let radius = length(delta);

  // Smooth falloff: inner disc rotates faster than outer edge
  // Mix outerVelocity at r=0 to innerVelocity … actually:
  //   r→0 (inner) → innerVelocity
  //   r→1 (outer) → outerVelocity
  let t  = smoothstep(0.0, 1.0, radius * 1.5);  // remap radius to [0,1]
  let angVel = mix(params.innerVelocity, params.outerVelocity, t);
  let angle  = angVel * params.time;

  // Rotate the sample UV around the disc centre
  let cs = cos(angle);
  let sn = sin(angle);
  let rotated = vec2<f32>(
    delta.x * cs - delta.y * sn,
    delta.x * sn + delta.y * cs,
  );
  let warpedUV = clamp(centre + rotated, vec2<f32>(0.0), vec2<f32>(1.0));

  return textureSample(inputTex, inputSmp, warpedUV);
}
