// GalaxyQuest Engine — warp.wgsl
// WGSL shader: warp tunnel / plasma-flow effect.
//
// Renders the hyperspace "warp tunnel" as a full-screen post-process quad.
// The tunnel is composed of two layered effects:
//
//   1. Radial streak layer  — star points elongated toward a vanishing point,
//      giving the classic "entering warp" look (speed lines).
//   2. Plasma flow layer    — animated, coloured plasma channels spiralling
//      along the tunnel walls (represents Alcubierre-style plasma confinement).
//
// The two layers are blended with additive compositing so the warp tunnel
// sits on top of the scene without masking it.
//
// Bind-group 0:
//   binding 0 → uniform buffer — WarpParams
//
// Inspired by:
//   "Hyperspace Jump" — various demoscene and shader-toy demos (CC0)
//   Mass Effect warp / jump effect (BioWare)
//   Star Trek warp effect — radial streak + plasma channels
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct WarpParams {
  // Animation
  time          : f32,    // elapsed seconds
  phase         : f32,    // 0=engage ramp-up, 0.5=travel, 1=disengage ramp-down
  intensity     : f32,    // overall effect intensity [0,1]
  speed         : f32,    // tunnel scroll speed

  // Tunnel geometry
  vanishX       : f32,    // screen-space vanishing point X [0,1]
  vanishY       : f32,    // screen-space vanishing point Y [0,1]
  tunnelRadius  : f32,    // normalised tunnel radius [0,1]
  twistRate     : f32,    // plasma channel twist frequency

  // Colours
  streakColor   : vec4<f32>,  // star-streak RGBA
  plasmaColorA  : vec4<f32>,  // plasma channel colour A (inner)
  plasmaColorB  : vec4<f32>,  // plasma channel colour B (outer / turbulent)

  // Quality
  streakCount   : f32,    // number of radial streak samples
  plasmaLayers  : f32,    // plasma fBm octave count
  pad0          : f32,
  pad1          : f32,
}

@group(0) @binding(0) var<uniform> params : WarpParams;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Smooth hash — returns value in [0,1]
fn hash12(p: vec2<f32>) -> f32 {
  let k = vec2<f32>(127.1, 311.7);
  return fract(sin(dot(p, k)) * 43758.545);
}

fn hash13(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.545);
}

// Value noise 2D
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);  // smoothstep

  return mix(
    mix(hash12(i),              hash12(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// fBm (fractional Brownian motion) — layered noise
fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pp = p;
  for (var i = 0; i < octaves; i++) {
    v += a * vnoise(pp);
    pp *= 2.0;
    a  *= 0.5;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Vertex shader — full-screen triangle
// ---------------------------------------------------------------------------

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  // Full-screen triangle (clip space)
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let p = positions[vi];
  var out : VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv  = p * 0.5 + 0.5;
  return out;
}

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Shift UV so vanishing point is at centre of tunnel
  let vp  = vec2<f32>(params.vanishX, params.vanishY);
  let st  = uv - vp;
  let r   = length(st);
  let ang = atan2(st.y, st.x);

  // ---- 1. Radial star-streak layer ----------------------------------------
  // Compute radial "depth" based on distance from vanishing point
  let streakSamples = i32(params.streakCount);
  var streakAcc     = 0.0;
  for (var si = 0; si < streakSamples; si++) {
    let fi          = f32(si) / f32(streakSamples);
    // Each sample represents a star at a random angle
    let starAngle   = fi * 6.28318;
    let starR       = 0.3 + fi * 0.7;             // stars distributed at various depths
    let star2d      = vec2<f32>(cos(starAngle), sin(starAngle)) * starR * params.tunnelRadius;
    // Precompute normalised radial direction once to avoid redundant normalizations
    let starDir     = normalize(star2d + vec2<f32>(0.00001));
    let starDirPerp = vec2<f32>(-starDir.y, starDir.x);
    // Streak: project onto direction from VP
    let proj     = dot(st, starDir);
    let perp     = abs(dot(st, starDirPerp));
    // Streak glow — narrow perpendicular, long radial
    let streakW  = 0.003 * (1.0 + params.intensity);
    let falloff  = exp(-(perp / streakW) * (perp / streakW));
    // Fade near vanishing point and at screen edge
    let depthFade = smoothstep(0.0, 0.05, proj) * smoothstep(0.7, 0.3, r);
    // Scroll: animate scroll-in/out based on time
    let scroll   = fract(fi + params.time * params.speed * 0.3);
    streakAcc   += falloff * depthFade * scroll;
  }
  let streakVal = clamp(streakAcc / f32(streakSamples) * 25.0, 0.0, 1.0);
  let streakOut = params.streakColor * streakVal * params.intensity;

  // ---- 2. Plasma flow layer ------------------------------------------------
  // Cylindrical tunnel coordinates: angle around tunnel + depth (r from VP)
  let octaves    = i32(clamp(params.plasmaLayers, 1.0, 6.0));
  let depth      = r;

  // Spiral: twist angle proportional to depth and time
  let twist      = ang + params.twistRate * depth - params.time * 1.2;
  let plasmaUV   = vec2<f32>(twist * 0.5 / 3.14159, depth * 3.0 - params.time * params.speed);

  let plasmaVal  = fbm(plasmaUV * 3.0, octaves);

  // Plasma is visible only inside tunnel radius, with soft edge
  let tunnelMask = smoothstep(params.tunnelRadius, params.tunnelRadius * 0.5, depth);
  let plasmaOut  = mix(params.plasmaColorB, params.plasmaColorA, plasmaVal)
                   * plasmaVal * tunnelMask * params.intensity;

  // ---- 3. Engage/disengage envelope ----------------------------------------
  // Phase: 0=dark ramp-up, 0.5=full brightness, 1=fade out
  let envelope = sin(params.phase * 3.14159);   // sin(0)=0, sin(π/2)=1, sin(π)=0

  // ---- 4. Combine & output -------------------------------------------------
  let combined = (streakOut + plasmaOut) * envelope;
  return vec4<f32>(combined.rgb, clamp(combined.a, 0.0, 1.0));
}
