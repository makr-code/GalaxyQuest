// GalaxyQuest Engine — ssao.wgsl
// WGSL post-process fragment shader: Screen-Space Ambient Occlusion (Phase FX-8).
//
// Implements the Alchemy AO / hemisphere-sampling SSAO technique:
//   1. Reconstruct view-space position + normal from the depth buffer
//      and a packed normal texture.
//   2. Sample a hemisphere of kernel taps (oriented along the surface normal)
//      using a per-fragment random rotation to break up banding artefacts.
//   3. For each tap, project back to screen space and compare the tap's
//      reconstructed view-Z against the scene depth at that UV.
//   4. Count how many taps are occluded; output the occlusion factor.
//
// A separate bilateral-blur entry point (fs_blur) smooths the raw AO output
// using a depth-aware separable Gaussian.
//
// Bind-group 0 (AO pass):
//   binding 0 → texture_depth_2d       — scene depth buffer
//   binding 1 → texture_2d<f32>        — packed view-space normal (rgb = xyz, a unused)
//   binding 2 → texture_2d<f32>        — 4×4 tiling noise texture (random rotation per pixel)
//   binding 3 → sampler                — point/clamp sampler (for depth + normal lookup)
//   binding 4 → sampler                — repeat sampler (for noise texture)
//   binding 5 → uniform buffer         — SSAOParams
//
// Bind-group 0 (blur pass — same layout minus noise / normal):
//   binding 0 → texture_2d<f32>        — raw AO output from the first pass
//   binding 1 → texture_depth_2d       — scene depth  (used for bilateral weight)
//   binding 2 → sampler                — linear/clamp
//   binding 3 → uniform buffer         — SSAOBlurParams
//
// Inspired by:
//   Méndez & Boulanger (2009) "Rendering Ambient Occlusion" — NVIDIA SDK
//   Bavoil & Sainz (2008) "Screen Space Ambient Occlusion" — NVIDIA
//   Three.js SSAOPass (MIT)        — https://github.com/mrdoob/three.js
//   Babylon.js SSAO2RenderingPipeline (Apache 2.0)
//   Unreal Engine 4 SSAO (Epic)   — hemisphere kernel generation
//
// License: MIT — makr-code/GalaxyQuest

// ===========================================================================
// SHARED: full-screen vertex shader
// ===========================================================================

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

// ===========================================================================
// AO PASS
// ===========================================================================

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct SSAOParams {
  projMat       : mat4x4<f32>,    // projection matrix (view → clip)
  invProjMat    : mat4x4<f32>,    // inverse projection (clip → view)

  kernelSamples : array<vec4<f32>, 64>,  // hemisphere kernel (xyz = direction, w unused)

  resolution    : vec2<f32>,  // viewport size in pixels
  noiseScale    : vec2<f32>,  // viewport / noiseTexSize (tiling factor)

  radius        : f32,   // AO sample hemisphere radius (view units)
  bias          : f32,   // depth comparison bias to avoid self-shadowing
  power         : f32,   // contrast exponent applied to raw occlusion
  kernelSize    : f32,   // number of kernel samples to use (max 64)

  nearPlane     : f32,
  farPlane      : f32,
  _pad0         : f32,
  _pad1         : f32,
}

// ---------------------------------------------------------------------------
// Bindings (AO pass)
// ---------------------------------------------------------------------------

@group(0) @binding(0) var depthTex    : texture_depth_2d;
@group(0) @binding(1) var normalTex   : texture_2d<f32>;
@group(0) @binding(2) var noiseTex    : texture_2d<f32>;
@group(0) @binding(3) var ptSmpl      : sampler;
@group(0) @binding(4) var noiseSmpl   : sampler;
@group(0) @binding(5) var<uniform>    aoParams : SSAOParams;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reconstruct view-space position from UV and raw depth sample. */
fn viewPosFromUVDepth(uv: vec2<f32>, rawD: f32) -> vec3<f32> {
  let ndc  = vec4<f32>(uv * 2.0 - 1.0, rawD, 1.0);
  let vp4  = aoParams.invProjMat * ndc;
  return vp4.xyz / vp4.w;
}

/** Build a TBN matrix to orient the hemisphere around a surface normal. */
fn buildTBN(n: vec3<f32>, randomVec: vec3<f32>) -> mat3x3<f32> {
  let t   = normalize(randomVec - n * dot(randomVec, n));
  let b   = cross(n, t);
  return mat3x3<f32>(t, b, n);
}

// ---------------------------------------------------------------------------
// Fragment (AO pass)
// ---------------------------------------------------------------------------

@fragment
fn fs_ao(in: VSOut) -> @location(0) vec4<f32> {
  // Sample raw depth and reconstruct view-space position
  let rawD    = textureSample(depthTex, ptSmpl, in.uv);
  let fragPos = viewPosFromUVDepth(in.uv, rawD);

  // View-space normal (packed in [0,1] → decode to [-1,1])
  let normalSample = textureSample(normalTex, ptSmpl, in.uv).rgb;
  let normal       = normalize(normalSample * 2.0 - 1.0);

  // Random rotation vector from tiling noise texture
  let noiseUV  = in.uv * aoParams.noiseScale;
  let randVec  = normalize(textureSample(noiseTex, noiseSmpl, noiseUV).rgb * 2.0 - 1.0);
  let tbn      = buildTBN(normal, randVec);

  let kernelN  = u32(aoParams.kernelSize);
  var occlusion = 0.0;

  for (var i: u32 = 0u; i < kernelN; i++) {
    // Orient kernel sample from tangent to view space
    let kSample  = tbn * aoParams.kernelSamples[i].xyz;
    let samplePos = fragPos + kSample * aoParams.radius;

    // Project sample into clip space → screen UV
    let clipPos  = aoParams.projMat * vec4<f32>(samplePos, 1.0);
    var screenUV = clipPos.xy / clipPos.w;
    screenUV     = screenUV * 0.5 + 0.5;
    screenUV.y   = 1.0 - screenUV.y;   // Y flip

    // Read scene depth at sample UV
    let sceneD   = textureSample(depthTex, ptSmpl, screenUV);
    let scenePos = viewPosFromUVDepth(screenUV, sceneD);

    // Range check: only count samples within the AO radius
    let rangeCheck = smoothstep(0.0, 1.0, aoParams.radius / abs(fragPos.z - scenePos.z));

    // Occlusion: sample is closer to camera (behind geometry)
    let occluded   = select(0.0, 1.0, scenePos.z >= samplePos.z + aoParams.bias);
    occlusion     += occluded * rangeCheck;
  }

  occlusion = 1.0 - (occlusion / f32(kernelN));
  let ao    = pow(occlusion, aoParams.power);

  return vec4<f32>(ao, ao, ao, 1.0);
}

// ===========================================================================
// BILATERAL BLUR PASS
// ===========================================================================

struct SSAOBlurParams {
  resolution  : vec2<f32>,
  horizontal  : f32,    // 1.0 = horizontal, 0.0 = vertical
  blurRadius  : f32,    // sample radius (pixels)
  depthThresh : f32,    // max depth difference for bilateral weight
  _pad0       : f32,
  _pad1       : f32,
  _pad2       : f32,
}

@group(0) @binding(0) var aoTex      : texture_2d<f32>;
@group(0) @binding(1) var blurDepth  : texture_depth_2d;
@group(0) @binding(2) var blurSmpl   : sampler;
@group(0) @binding(3) var<uniform>   blurParams : SSAOBlurParams;

@fragment
fn fs_blur(in: VSOut) -> @location(0) vec4<f32> {
  let texel   = 1.0 / blurParams.resolution;
  let centreD = textureSample(blurDepth, blurSmpl, in.uv);
  let radius  = i32(blurParams.blurRadius);

  var aoAcc   = 0.0;
  var weightSum = 0.0;

  let dir = select(vec2<f32>(0.0, texel.y), vec2<f32>(texel.x, 0.0), blurParams.horizontal > 0.5);

  for (var i: i32 = -radius; i <= radius; i++) {
    let offset  = dir * f32(i);
    let sUV     = in.uv + offset;
    let sDepth  = textureSample(blurDepth, blurSmpl, sUV);
    let sAO     = textureSample(aoTex, blurSmpl, sUV).r;

    // Bilateral weight: down-weight samples with very different depths
    let depthDiff = abs(sDepth - centreD);
    let weight    = exp(-depthDiff / blurParams.depthThresh);

    aoAcc     += sAO * weight;
    weightSum += weight;
  }

  let blurred = aoAcc / max(weightSum, 0.0001);
  return vec4<f32>(blurred, blurred, blurred, 1.0);
}

// ===========================================================================
// COMPOSITE PASS
// ===========================================================================

// Multiplies scene colour by AO factor (final combination step).

@group(0) @binding(0) var compSceneTex  : texture_2d<f32>;
@group(0) @binding(1) var compAOTex     : texture_2d<f32>;
@group(0) @binding(2) var compSmpl      : sampler;

@fragment
fn fs_composite(in: VSOut) -> @location(0) vec4<f32> {
  let scene = textureSample(compSceneTex, compSmpl, in.uv).rgb;
  let ao    = textureSample(compAOTex,    compSmpl, in.uv).r;
  return vec4<f32>(scene * ao, 1.0);
}
