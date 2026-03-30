// GalaxyQuest Engine — godray.wgsl
// WGSL post-process fragment shader: volumetric light shafts (god rays / crepuscular rays).
//
// Implements the screen-space radial-blur technique by Kenny Mitchell (2007)
// "Volumetric Light Scattering as a Post-Process":
//   1. Find the 2D screen-space projection of the light source.
//   2. Sample the scene texture NUM_SAMPLES times along a ray from the
//      fragment UV toward the light's screen position, attenuating each
//      sample by an exponential decay factor.
//   3. Blend the accumulated scattered light back over the scene additively.
//
// Bind-group 0:
//   binding 0 → texture_2d<f32>  — scene colour (hdr or ldr)
//   binding 1 → texture_2d<f32>  — occlusion mask (black where geometry blocks light)
//   binding 2 → sampler          — linear/clamp
//   binding 3 → uniform buffer   — GodRayParams
//
// Inspired by:
//   Kenny Mitchell, "Volumetric Light Scattering as a Post-Process", GDC 2007
//   Three.js GodRaysFakeSunShader (MIT) — https://github.com/mrdoob/three.js
//   Babylon.js VolumetricLightScatteringPostProcess (Apache 2.0)
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct GodRayParams {
  // 2-D screen-space position of the light source, in [0,1] UV space.
  // Positions outside [0,1] are allowed (light off-screen or behind camera);
  // the radial march will simply step away from the viewport edge.
  // Host code should pass a clamped or estimated UV for lights behind the camera.
  lightScreenPos : vec2<f32>,

  // Quality / appearance controls
  exposure    : f32,   // final intensity scale
  decay       : f32,   // per-sample attenuation (≈ 0.96–0.99)
  density     : f32,   // initial step length scale (≈ 0.2–1.0)
  weight      : f32,   // per-sample colour weight (≈ 0.01–0.05)
  numSamples  : f32,   // cast to u32 inside the loop (32–128 typical)
  _pad        : f32,

  // Tint of the light shafts
  lightColor  : vec4<f32>,
}

@group(0) @binding(0) var sceneTex    : texture_2d<f32>;
@group(0) @binding(1) var occluMask   : texture_2d<f32>;
@group(0) @binding(2) var smpl        : sampler;
@group(0) @binding(3) var<uniform>  params : GodRayParams;

// ---------------------------------------------------------------------------
// Vertex shader (full-screen triangle, no VBO)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fragment shader — radial blur accumulation
// ---------------------------------------------------------------------------

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let numSamples = max(1u, u32(params.numSamples));

  // Direction from this fragment toward the light source in UV space
  var uv        = in.uv;
  let lightUV   = params.lightScreenPos;
  let delta     = (lightUV - uv) * (params.density / f32(numSamples));

  var illuminationDecay = 1.0;
  var scattered         = vec3<f32>(0.0);

  for (var i: u32 = 0u; i < numSamples; i++) {
    uv += delta;

    // Sample the occlusion mask — 0 = occluded, 1 = clear sky
    let occl   = textureSample(occluMask, smpl, uv).r;
    let sample = textureSample(sceneTex,  smpl, uv).rgb;

    // Accumulate scattered light; occluded pixels contribute nothing
    scattered += sample * occl * illuminationDecay * params.weight;
    illuminationDecay *= params.decay;
  }

  // Tint and scale the result
  let godRay     = scattered * params.exposure * params.lightColor.rgb;
  let sceneColor = textureSample(sceneTex, smpl, in.uv).rgb;

  // Additive blend: god-ray over scene
  return vec4<f32>(sceneColor + godRay, 1.0);
}
