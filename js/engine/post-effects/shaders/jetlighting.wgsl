// GalaxyQuest Engine — jetlighting.wgsl
// WebGPU Post-Processing: Relativistic Jet Lighting
//
// Adds luminous, directional halos representing the astrophysical jets
// emitted from an active galactic nucleus (AGN) or central black hole.
//
// Each jet source defines:
//   • An NDC origin (where the jet appears to originate)
//   • A direction vector (normalised 2D screen direction of the jet beam)
//   • RGB colour tint and per-source intensity
//
// The jet contribution for each pixel is calculated as a falloff function
// of the distance from the pixel's position to the jet axis (line from
// origin along direction).  This produces the characteristic elongated,
// pencil-like glow of relativistic jets seen in radio galaxy imagery.
//
// An inner bright core (narrow Gaussian) plus outer diffuse penumbra (wide
// exponential) are blended for a physically plausible appearance.
//
// References:
//   Event Horizon Telescope (2019) — M87* jet morphology
//   Mirabel & Rodriguez (1999) "Sources of Relativistic Jets in the Galaxy"
//   No Man's Sky black hole visualisation (Hello Games)
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : JetLightingParams;

const MAX_JET_SOURCES : i32 = 4;

struct JetSource {
  posX      : f32,
  posY      : f32,
  dirX      : f32,
  dirY      : f32,
  colorR    : f32,
  colorG    : f32,
  colorB    : f32,
  intensity : f32,
}

struct JetLightingParams {
  jets          : array<JetSource, 4>,
  time          : f32,
  globalIntensity : f32,
  spread        : f32,
  activeCount   : f32,  // int encoded as float
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
// Single-jet contribution at screen UV (NDC is in [-1,+1])
// -------------------------------------------------------------------------
fn jet_contribution(jet: JetSource, uv_ndc: vec2<f32>) -> vec3<f32> {
  let p    = uv_ndc - vec2<f32>(jet.posX, jet.posY);
  let dir  = normalize(vec2<f32>(jet.dirX, jet.dirY));

  // Signed projection along the jet axis and perpendicular
  let along = dot(p, dir);
  let perp  = p - along * dir;
  let d_perp = length(perp);

  // Only light pixels in front of (along) the jet (along > 0 = beam side)
  let forward_mask = smoothstep(-0.05, 0.05, along);

  // Narrow core (Gaussian) + broad penumbra (exp falloff)
  let spread = params.spread + 0.01;
  let core   = exp(-d_perp * d_perp / (2.0 * spread * spread));
  let halo   = exp(-d_perp / (spread * 4.0));
  let profile = (core * 0.7 + halo * 0.3);

  // Fade off with distance along beam axis (finite jet length)
  let beam_fade = exp(-along * along * 0.8);

  let glow = profile * beam_fade * forward_mask * jet.intensity;
  return vec3<f32>(jet.colorR, jet.colorG, jet.colorB) * glow;
}

// -------------------------------------------------------------------------
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let col     = textureSample(inputTex, inputSmp, in.uv).rgb;
  let uv_ndc  = in.uv * 2.0 - vec2<f32>(1.0);

  var light = vec3<f32>(0.0);
  let count = i32(params.activeCount);
  for (var i = 0; i < MAX_JET_SOURCES; i++) {
    if (i >= count) { break; }
    light += jet_contribution(params.jets[i], uv_ndc);
  }

  let out = col + light * params.globalIntensity;
  return vec4<f32>(clamp(out, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
