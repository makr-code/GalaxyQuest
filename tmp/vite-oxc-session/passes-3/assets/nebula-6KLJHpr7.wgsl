// GalaxyQuest Engine — nebula.wgsl
// WGSL fragment shader: volumetric nebula / plasma cloud rendering.
//
// Uses layered fractional Brownian motion (fBm) noise to produce convincing
// volumetric gas clouds with bounded raymarching. Each quad covers only its
// volume's projected bounds and uses normalized galactic coordinates.
//
// Technique summary:
//   1. Transform screen coordinates into a world-space ray through the volume.
//   2. Step along the ray (NUM_STEPS short marches).
//   3. Sample a domain-warped value noise at each step position.
//   4. Accumulate colour and opacity (front-to-back compositing).
//   5. Output straight-alpha colour for scene compositing.
//
// Bind-group 0:
//   binding 0 → uniform buffer  — NebulaParams
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
  // Volume centre and radius in normalized galactic coordinates.
  centerAndRadius : vec4<f32>,

  // Inner colour (dense regions) + density scale (w)
  colorInner    : vec4<f32>,

  // Outer colour (sparse edges) + turbulence amount (w)
  colorOuter    : vec4<f32>,

  // Camera / projection helpers
  invProjMat    : mat4x4<f32>,
  bounds        : vec4<f32>,

  // Misc
  time          : f32,   // elapsed time (seconds) — used for slow drift animation
  opacity       : f32,   // master opacity [0, 1]
  steps         : f32,   // ray-march step count (cast to u32 inside shader)
  emissive      : f32,   // [0, 1] — how much colour is self-illuminated vs. absorbed
}

@group(0) @binding(0) var<uniform> params   : NebulaParams;

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
  var out: VSOut;
  let clip = mix(params.bounds.xy, params.bounds.zw, positions[idx] * 0.5 + 0.5);
  out.pos = vec4<f32>(clip, 0.0, 1.0);
  out.uv  = clip;
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
    valueNoise(p + vec3(1.7, 9.2, 1.3)),
    valueNoise(p + vec3(8.3, 2.8, 4.6)),
    valueNoise(p + vec3(3.1, 5.4, 7.9)),
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

  let nearPoint = params.invProjMat * vec4<f32>(in.uv, -1.0, 1.0);
  let farPoint = params.invProjMat * vec4<f32>(in.uv, 1.0, 1.0);
  let rayOrigin = nearPoint.xyz / nearPoint.w;
  let rayDir = normalize(farPoint.xyz / farPoint.w - rayOrigin);

  // Simple sphere-intersection test for bounding volume
  let oc   = rayOrigin - center;
  let b    = dot(oc, rayDir);
  let c    = dot(oc, oc) - radius * radius;
  let disc = b * b - c;

  if (disc < 0.0) {
    return vec4<f32>(0.0); // no intersection — fully transparent
  }

  let sqrtD  = sqrt(disc);
  let tMin   = max(0.0, -b - sqrtD);
  let tMax   = -b + sqrtD;
  if (tMax <= tMin) { return vec4<f32>(0.0); }
  let tRange = tMax - tMin;

  let numSteps = clamp(u32(params.steps), 8u, 24u);
  let stepSize = tRange / f32(numSteps);

  var accumColor   = vec3<f32>(0.0);
  var accumAlpha   = 0.0;
  let slowDrift    = params.time * 0.03;

  for (var i: u32 = 0u; i < numSteps; i++) {
    if (accumAlpha >= 0.99) { break; }

    let t       = tMin + (f32(i) + 0.5) * stepSize;
    let sampleP = rayOrigin + rayDir * t;

    // Scale into noise space (normalise by radius, add drift)
    let noiseP  = (sampleP - center) / radius * 2.0 + center * 17.0 + vec3<f32>(slowDrift, 0.0, slowDrift);

    let density = max(0.0, warpedFbm(noiseP) - 0.3) * 2.2;

    // Radial fade so edges dissolve naturally
    let relative = (sampleP - center) / radius;
    let radial = normalize(vec3<f32>(center.xy, 0.0001));
    let tangent = normalize(vec3<f32>(-radial.y, radial.x, 0.0));
    let distFromCentre = length(vec3<f32>(dot(relative, tangent), dot(relative, radial) * 1.5, relative.z * 2.2));
    let boundary = 0.7 + valueNoise(noiseP * 1.3) * 0.28;
    let radFade        = 1.0 - smoothstep(boundary - 0.35, boundary, distFromCentre);
    let d              = density * radFade * params.colorInner.w;  // colorInner.w = density scale

    if (d < 0.01) { continue; }

    // Colour: blend inner/outer by density
    let col = mix(params.colorOuter.rgb, params.colorInner.rgb, density);

    // Front-to-back compositing
    let stepAlpha   = 1.0 - exp(-d * stepSize / radius * 1.6);
    let weight      = stepAlpha * (1.0 - accumAlpha);
    accumColor     += col * weight;
    accumAlpha     += weight;
  }

  let finalAlpha = accumAlpha * params.opacity;
  // Mix emissive (additive) with absorptive output
  let color = accumColor / max(accumAlpha, 0.0001);
  let emissiveMix = color * mix(0.65, 1.0, params.emissive);
  return vec4<f32>(emissiveMix, finalAlpha);
}
