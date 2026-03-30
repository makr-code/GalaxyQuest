// GalaxyQuest Engine — volscatter.wgsl
// WGSL fragment shader: shadow-map-aware volumetric light scattering (Phase FX-7).
//
// Technique: single-pass ray-march from the fragment through a participating
// medium, querying a shadow map at each step to determine whether the sample
// point is in light or shadow.  Accumulated in-scattered radiance is blended
// additively over the opaque scene.
//
// Method summary:
//   1. Reconstruct the view-space ray for this fragment from the depth buffer
//      and inverse projection matrix.
//   2. March from the camera toward the fragment in NUM_STEPS equal steps.
//   3. At each step, transform the sample position into the light's clip space
//      and compare against the shadow map depth.
//   4. Accumulate the in-scattering contribution (light colour × phase func ×
//      extinction × shadow term).
//   5. Blend accumulated radiance back over the scene colour additively.
//
// Phase function: Henyey-Greenstein (anisotropy g ∈ [-1, 1]).
//   g=0  → isotropic (fog, nebula)
//   g>0  → forward scatter (thin atmosphere, plasma streams)
//   g<0  → back scatter (dusty/smoky media)
//
// Bind-group 0:
//   binding 0 → texture_2d<f32>        — scene colour (HDR)
//   binding 1 → texture_depth_2d       — scene depth  (0…1, reversed-Z optional)
//   binding 2 → texture_depth_2d       — shadow map from the key light
//   binding 3 → sampler                — linear/clamp sampler for colour+depth
//   binding 4 → sampler_comparison     — shadow comparison sampler
//   binding 5 → uniform buffer         — VolScatterParams
//
// Inspired by:
//   Wronski (2014) "Volumetric Fog" — GDC 2014 (Ubisoft)
//   Hillaire (2020) "A Scalable and Production Ready Sky and Atmosphere" — Epic/Siggraph
//   Hoobler (2016) "Rendering the Alternate History of The Order: 1886" — SigGraph
//   Three.js VolumetricFog example (MIT) — https://github.com/mrdoob/three.js
//   Babylon.js VolumetricLightScattering (Apache 2.0)
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct VolScatterParams {
  // Matrices
  invProjMat    : mat4x4<f32>,   // NDC → view space
  invViewMat    : mat4x4<f32>,   // view → world space
  lightVPMat    : mat4x4<f32>,   // world → light clip space (for shadow lookup)

  // Light
  lightDirView  : vec4<f32>,     // light direction in view space (xyz), w unused
  lightColor    : vec4<f32>,     // light colour (rgb), w = intensity

  // Scattering medium properties
  scatterColor  : vec4<f32>,     // medium tint (rgb), w = scatter coefficient σ_s
  extinction    : f32,           // extinction coefficient σ_t (scatter + absorb)
  anisotropy    : f32,           // Henyey-Greenstein g factor
  numSteps      : f32,           // ray-march steps (cast to u32)
  shadowBias    : f32,           // shadow acne bias

  // Near/far plane distances for depth linearisation
  nearPlane     : f32,
  farPlane      : f32,
  _pad0         : f32,
  _pad1         : f32,
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

@group(0) @binding(0) var sceneTex    : texture_2d<f32>;
@group(0) @binding(1) var sceneDepth  : texture_depth_2d;
@group(0) @binding(2) var shadowMap   : texture_depth_2d;
@group(0) @binding(3) var smpl        : sampler;
@group(0) @binding(4) var shadowSmpl  : sampler_comparison;
@group(0) @binding(5) var<uniform>    params : VolScatterParams;

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
// Helpers
// ---------------------------------------------------------------------------

/** Henyey-Greenstein phase function. */
fn phaseHG(cosTheta: f32, g: f32) -> f32 {
  let g2  = g * g;
  let denom = max(0.0001, 1.0 + g2 - 2.0 * g * cosTheta);
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
}

/** Sample the shadow map with PCF 2×2 kernel. */
fn shadowPCF(shadowUV: vec3<f32>) -> f32 {
  let uv   = shadowUV.xy;
  let refD = shadowUV.z - params.shadowBias;
  // 2×2 tap PCF
  let s00 = textureSampleCompare(shadowMap, shadowSmpl, uv + vec2(-0.5, -0.5) * 0.001, refD);
  let s10 = textureSampleCompare(shadowMap, shadowSmpl, uv + vec2( 0.5, -0.5) * 0.001, refD);
  let s01 = textureSampleCompare(shadowMap, shadowSmpl, uv + vec2(-0.5,  0.5) * 0.001, refD);
  let s11 = textureSampleCompare(shadowMap, shadowSmpl, uv + vec2( 0.5,  0.5) * 0.001, refD);
  return (s00 + s10 + s01 + s11) * 0.25;
}

/** Reconstruct view-space position from screen UV and raw depth. */
fn viewPosFromDepth(uv: vec2<f32>, rawDepth: f32) -> vec3<f32> {
  let ndc       = vec3<f32>(uv * 2.0 - 1.0, rawDepth);
  let clipPos   = vec4<f32>(ndc, 1.0);
  let viewPos4  = params.invProjMat * clipPos;
  return viewPos4.xyz / viewPos4.w;
}

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let sceneColor  = textureSample(sceneTex, smpl, in.uv).rgb;

  // Reconstruct view-space end point from depth
  let rawDepth    = textureSample(sceneDepth, smpl, in.uv);
  let fragViewPos = viewPosFromDepth(in.uv, rawDepth);

  // Ray from camera (origin) to fragment surface in view space
  let rayLen    = length(fragViewPos);
  let rayDir    = fragViewPos / max(0.0001, rayLen);

  let numSteps  = max(1u, u32(params.numSteps));
  let stepSize  = rayLen / f32(numSteps);

  var scatterAcc = vec3<f32>(0.0);

  // View-space to world-space transform (needed for shadow-map lookup)
  let invView = params.invViewMat;

  for (var i: u32 = 0u; i < numSteps; i++) {
    // Sample in view space, step forward by (i + 0.5) steps
    let t           = (f32(i) + 0.5) * stepSize;
    let sampleView  = rayDir * t;

    // World-space position for shadow map projection
    let sampleWorld = (invView * vec4<f32>(sampleView, 1.0)).xyz;

    // Project into light clip space
    let lightClip   = params.lightVPMat * vec4<f32>(sampleWorld, 1.0);
    var shadowUV    = lightClip.xyz / lightClip.w;
    shadowUV.x      =  shadowUV.x * 0.5 + 0.5;
    shadowUV.y      = -shadowUV.y * 0.5 + 0.5;   // Y flip (WebGPU NDC)

    // Skip samples outside shadow frustum
    if (any(shadowUV.xy < vec2<f32>(0.0)) || any(shadowUV.xy > vec2<f32>(1.0))) {
      continue;
    }

    let shadow      = shadowPCF(shadowUV);

    // Angle between ray direction and light direction (for phase function)
    let cosTheta    = dot(rayDir, -params.lightDirView.xyz);
    let phase       = phaseHG(cosTheta, params.anisotropy);

    // Beer-Lambert extinction along the step
    let transmit    = exp(-params.extinction * stepSize);

    // In-scattering radiance at this sample
    let inScatter   = params.lightColor.rgb * params.lightColor.w
                    * params.scatterColor.rgb * params.scatterColor.w
                    * phase * shadow * (1.0 - transmit);

    scatterAcc     += inScatter;
  }

  // Additive blend: volumetric radiance on top of scene
  return vec4<f32>(sceneColor + scatterAcc, 1.0);
}
