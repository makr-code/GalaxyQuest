// GalaxyQuest Engine — nebula.wgsl
// WGSL fragment shader: volumetric nebula / plasma cloud rendering.
//
// Uses layered fractional Brownian motion (fBm) noise to produce convincing
// volumetric gas cloud appearances without full raymarching.  The shader is
// applied as a full-screen quad pass that composites the nebula volume over
// the scene using additive or alpha blending.
//
// Technique summary:
//   1. Transform the fragment UV into a 3D "view ray" through the cloud volume.
//   2. Step along the ray (NUM_STEPS short marches).
//   3. Sample a domain-warped value noise at each step position.
//   4. Accumulate colour and opacity (front-to-back compositing).
//   5. Output the accumulated colour with premultiplied alpha.
//
// Bind-group 0:
//   binding 0 → uniform buffer  — NebulaParams
//   binding 1 → sampler         — linear/clamp sampler
//   binding 2 → texture_2d<f32> — optional tiling noise texture (fallback: procedural)
//   binding 3 → texture_2d<f32> — depth/scene texture (for depth-fade at solid objects)
//
// Inspired by:
//   Inigo Quilez "Rendering Clouds" (MIT) — https://www.shadertoy.com/view/XslGRr
//   Babylon.js VolumetricLightScattering (Apache 2.0) — https://github.com/BabylonJS
//   Nebula shader by Duke (CC0) — https://www.shadertoy.com/view/4djSRW
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct NebulaParams {
  // Volume centre in view space (x, y, z, radius)
  centerAndRadius : vec4<f32>,

  // Inner colour (dense regions) + density scale (w)
  colorInner    : vec4<f32>,

  // Outer colour (sparse edges) + turbulence amount (w)
  colorOuter    : vec4<f32>,

  // Camera / projection helpers
  invProjMat    : mat4x4<f32>,    // inverse projection matrix
  viewMat       : mat4x4<f32>,    // view matrix

  // Misc
  time          : f32,   // elapsed time (seconds) — used for slow drift animation
  opacity       : f32,   // master opacity [0, 1]
  steps         : f32,   // ray-march step count (cast to u32 inside shader)
  emissive      : f32,   // [0, 1] — how much colour is self-illuminated vs. absorbed
}

@group(0) @binding(0) var<uniform> params   : NebulaParams;
@group(0) @binding(1) var          smpl     : sampler;
@group(0) @binding(2) var          noiseTex : texture_2d<f32>;

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
// Procedural value noise helpers
// ---------------------------------------------------------------------------

fn hash3(p: vec3<f32>) -> f32 {
  var q = p;
  q = fract(q * vec3<f32>(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn valueNoise(p: vec3<f32>) -> f32 {
  let ip  = floor(p);
  let fp  = fract(p);
  let u   = fp * fp * (3.0 - 2.0 * fp);   // smoothstep

  return mix(
    mix(mix(hash3(ip + vec3(0.0, 0.0, 0.0)), hash3(ip + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash3(ip + vec3(0.0, 1.0, 0.0)), hash3(ip + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash3(ip + vec3(0.0, 0.0, 1.0)), hash3(ip + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash3(ip + vec3(0.0, 1.0, 1.0)), hash3(ip + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z,
  );
}

// 4-octave fractional Brownian motion
fn fbm(p: vec3<f32>) -> f32 {
  var v   = 0.0;
  var amp = 0.5;
  var q   = p;
  for (var i: i32 = 0; i < 4; i++) {
    v   += amp * valueNoise(q);
    q   *= 2.1;
    amp *= 0.5;
  }
  return v;
}

// Domain-warped fBm — makes clouds look more natural
fn warpedFbm(p: vec3<f32>) -> f32 {
  let turb  = params.colorOuter.w;
  let warp  = vec3<f32>(
    fbm(p + vec3(1.7, 9.2, 1.3)),
    fbm(p + vec3(8.3, 2.8, 4.6)),
    fbm(p + vec3(3.1, 5.4, 7.9)),
  );
  return fbm(p + turb * warp);
}

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let center = params.centerAndRadius.xyz;
  let radius = params.centerAndRadius.w;

  // Reconstruct view-space ray from UV
  let ndc       = vec3<f32>(in.uv * 2.0 - 1.0, 1.0);
  let rayDir    = normalize((params.invProjMat * vec4<f32>(ndc, 1.0)).xyz);

  // Simple sphere-intersection test for bounding volume
  let oc   = -center;   // ray origin is at view-origin (0,0,0)
  let b    = dot(oc, rayDir);
  let c    = dot(oc, oc) - radius * radius;
  let disc = b * b - c;

  if (disc < 0.0) {
    return vec4<f32>(0.0); // no intersection — fully transparent
  }

  let sqrtD  = sqrt(disc);
  let tMin   = max(0.0, -b - sqrtD);
  let tMax   = -b + sqrtD;
  let tRange = tMax - tMin;

  let numSteps = max(1u, u32(params.steps));
  let stepSize = tRange / f32(numSteps);

  var accumColor   = vec3<f32>(0.0);
  var accumAlpha   = 0.0;
  let slowDrift    = params.time * 0.03;

  for (var i: u32 = 0u; i < numSteps; i++) {
    if (accumAlpha >= 0.99) { break; }

    let t       = tMin + (f32(i) + 0.5) * stepSize;
    let sampleP = rayDir * t;  // view-space sample position

    // Scale into noise space (normalise by radius, add drift)
    let noiseP  = sampleP / radius * 2.0 + vec3<f32>(slowDrift, 0.0, slowDrift);

    let density = warpedFbm(noiseP);

    // Radial fade so edges dissolve naturally
    let distFromCentre = length(sampleP - center) / radius;
    let radFade        = 1.0 - smoothstep(0.6, 1.0, distFromCentre);
    let d              = density * radFade * params.colorInner.w;  // colorInner.w = density scale

    if (d < 0.01) { continue; }

    // Colour: blend inner/outer by density
    let col = mix(params.colorOuter.rgb, params.colorInner.rgb, density);

    // Front-to-back compositing
    let stepAlpha   = 1.0 - exp(-d * stepSize * 2.0);
    let weight      = stepAlpha * (1.0 - accumAlpha);
    accumColor     += col * weight;
    accumAlpha     += weight;
  }

  let finalAlpha = accumAlpha * params.opacity;
  // Mix emissive (additive) with absorptive output
  let emissiveMix = mix(accumColor * finalAlpha, accumColor, params.emissive);
  return vec4<f32>(emissiveMix, finalAlpha);
}
