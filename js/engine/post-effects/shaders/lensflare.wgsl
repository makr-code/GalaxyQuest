// GalaxyQuest Engine — lensflare.wgsl
// WebGPU Post-Processing: Sprite-based Lens Flare
//
// Composites multi-element lens flare artefacts onto the scene.
// Each flare source (e.g. selected/hovered star, galactic core) contributes
// up to MAX_FLARES independent screen-space flare elements composed of:
//   • A central starburst (bright spike cross)
//   • 1–4 circular ghost disks at varying positions along the lens axis
//   • A subtle streak halo
//
// Flare elements are placed along the line from the source position to the
// screen centre (the classical lens-axis reflection technique used in film
// optics and popularised by J.J. Abrams' Star Trek lens work).
//
// References:
//   Lengyel (2004) "Mathematics for 3D Game Programming" — Lens Flare chapter
//   Hecht & Zajac "Optics" — ghost reflection geometry
//   Star Citizen CIG lens flare system (Cloud Imperium Games)
//   Three.js Lensflare (MIT) — https://github.com/mrdoob/three.js
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : LensFlareParams;

const MAX_FLARES: u32 = 8u;

struct FlareSource {
  pos       : vec2<f32>,   // NDC position [-1,1]
  intensity : f32,
  colorR    : f32,
  colorG    : f32,
  colorB    : f32,
  active    : f32,         // 1.0 = visible, 0.0 = skip
  _pad      : f32,
}

struct LensFlareParams {
  flares      : array<FlareSource, 8>,
  globalScale : f32,   // master size multiplier
  ghostCount  : f32,   // number of ghost discs per source (1–4)
  aspect      : f32,   // viewport width / height
  time        : f32,   // elapsed time for subtle animation
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
// Helper: soft circular disc SDF contribution at a UV coordinate
// centre — NDC centre of the disc, radius — NDC radius, softness [0,1]
// -------------------------------------------------------------------------
fn disc_contribution(uv_ndc: vec2<f32>, centre: vec2<f32>, radius: f32, softness: f32) -> f32 {
  let d = length((uv_ndc - centre) * vec2<f32>(params.aspect, 1.0));
  return 1.0 - smoothstep(radius * (1.0 - softness), radius, d);
}

// -------------------------------------------------------------------------
// Helper: starburst contribution — 4-spike cross pattern
// -------------------------------------------------------------------------
fn starburst(uv_ndc: vec2<f32>, centre: vec2<f32>, radius: f32, intensity: f32) -> f32 {
  let d  = (uv_ndc - centre) * vec2<f32>(params.aspect, 1.0);
  let r  = length(d);
  if (r > radius * 3.0) { return 0.0; }

  // Radial falloff
  let falloff = max(0.0, 1.0 - r / (radius * 3.0));

  // Angular spikes: max(|cos(2θ)|, |sin(2θ)|)
  let angle  = atan2(d.y, d.x);
  let spikes = max(abs(cos(2.0 * angle)), abs(sin(2.0 * angle)));
  // Blend spikes with smooth radial glow near centre
  let spike_blend = mix(0.0, spikes, smoothstep(0.0, radius, r));

  return falloff * falloff * (0.35 + 0.65 * spike_blend) * intensity;
}

// -------------------------------------------------------------------------
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Convert UV [0,1] → NDC [-1,1]
  let ndc = in.uv * vec2<f32>(2.0) - vec2<f32>(1.0);
  // Y is flipped between UV and NDC
  let uv_ndc = vec2<f32>(ndc.x, -ndc.y);

  // Start with scene colour
  var col = textureSample(inputTex, inputSmp, in.uv).rgb;

  var flare_add = vec3<f32>(0.0);

  for (var fi: u32 = 0u; fi < MAX_FLARES; fi++) {
    let src = params.flares[fi];
    if (src.active < 0.5) { continue; }

    let src_ndc = src.pos;
    let src_col = vec3<f32>(src.colorR, src.colorG, src.colorB) * src.intensity;

    // --- Starburst at source ---
    let sb = starburst(uv_ndc, src_ndc, 0.018 * params.globalScale, 1.0);
    flare_add += src_col * sb;

    // --- Central glow disc ---
    let glow = disc_contribution(uv_ndc, src_ndc, 0.04 * params.globalScale, 0.6);
    flare_add += src_col * glow * 0.5;

    // --- Ghost discs along lens axis ---
    // Direction from source toward screen centre (standard lens ghost geometry)
    let axis = -src_ndc; // vector from source to screen centre
    let ghost_count = clamp(i32(params.ghostCount), 1, 4);

    for (var gi: i32 = 1; gi <= ghost_count; gi++) {
      let t = f32(gi) / f32(ghost_count + 1);
      // Each ghost is reflected at a different fraction along the lens axis
      let ghost_pos = src_ndc + axis * (t * 1.8 + 0.2);
      let ghost_r   = (0.02 + t * 0.035) * params.globalScale;
      let ghost_a   = disc_contribution(uv_ndc, ghost_pos, ghost_r, 0.5);
      // Ghosts are tinted with complementary/shifted hue
      let hue_shift = f32(gi) * 0.13;
      let ghost_col = vec3<f32>(
        src_col.r * (1.0 - hue_shift) + hue_shift * src_col.g,
        src_col.g * (1.0 - hue_shift) + hue_shift * src_col.b,
        src_col.b,
      );
      flare_add += ghost_col * ghost_a * 0.25 * src.intensity;
    }

    // --- Streak halo (horizontal / diagonal) ---
    let streak_h = max(0.0, 1.0 - abs((uv_ndc.y - src_ndc.y) * 80.0 * params.aspect));
    let streak_len = max(0.0, 1.0 - abs(uv_ndc.x - src_ndc.x) / 0.4);
    flare_add += src_col * streak_h * streak_len * streak_len * 0.08;
  }

  return vec4<f32>(col + flare_add, 1.0);
}
