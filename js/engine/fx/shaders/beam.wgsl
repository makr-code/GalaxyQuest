// GalaxyQuest Engine — beam.wgsl
// WGSL vertex + fragment shader: instanced glowing capsule beams (Phase FX-3).
//
// Each beam instance is drawn as a screen-aligned billboard quad that blends
// from a bright core colour to a transparent glow edge (soft-particle style).
//
// Bind-group 0:
//   binding 0 → uniform buffer   — BeamParams (camera + viewport)
//   binding 1 → storage buffer   — BeamInstance array (read)
//
// Vertex inputs (per-instance from BeamInstance storage buffer):
//   fromX, fromY, fromZ  — beam start (world space)
//   toX, toY, toZ        — beam end   (world space)
//   coreR, coreG, coreB  — core colour (HDR; typically ≥ 1.0)
//   glowR, glowG, glowB  — glow colour
//   glowRadius           — half-width of the glow fringe (world units)
//   alpha                — fade [0-1]; driven by elapsed/duration on CPU
//
// The quad is expanded along the screen-projected beam axis so the capsule
// shape is consistent from any view angle.
//
// Inspired by:
//   FreeSpace 2 (1999, Volition)  — beam weapon visual style
//   Elite Dangerous (Frontier)    — laser bolt / beam glow
//   Three.js Line2 (MIT)          — screenspace line expansion
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/** Per-frame camera + viewport parameters. */
struct BeamParams {
  viewProj       : mat4x4<f32>,   // combined view-projection matrix
  cameraPos      : vec3<f32>,     // world-space camera position
  _pad0          : f32,
  viewportWidth  : f32,
  viewportHeight : f32,
  _pad1          : f32,
  _pad2          : f32,
}

/** One beam instance in the storage buffer. */
struct BeamInstance {
  fromX     : f32,
  fromY     : f32,
  fromZ     : f32,
  toX       : f32,

  toY       : f32,
  toZ       : f32,
  coreR     : f32,
  coreG     : f32,

  coreB     : f32,
  glowR     : f32,
  glowG     : f32,
  glowB     : f32,

  glowRadius : f32,
  alpha      : f32,   // fade factor [0, 1]
  _pad0      : f32,
  _pad1      : f32,
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<uniform>            params  : BeamParams;
@group(0) @binding(1) var<storage, read>      beams   : array<BeamInstance>;

// ---------------------------------------------------------------------------
// Vertex shader
// ---------------------------------------------------------------------------

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       uv       : vec2<f32>,   // [-1, 1] across capsule width
  @location(1)       color    : vec4<f32>,   // core colour × alpha
  @location(2)       glow     : vec4<f32>,   // glow colour × alpha
}

// Quad vertices: 4 corners of the beam billboard.
// Corner index (vertex_index % 4):
//   0: (−1, 0)  1: (1, 0)  2: (1, 1)  3: (−1, 1)
// where x = ±half-width, y = along-beam fraction [0, 1].
const QUAD_CORNERS = array<vec2<f32>, 4>(
  vec2<f32>(-1.0, 0.0),
  vec2<f32>( 1.0, 0.0),
  vec2<f32>( 1.0, 1.0),
  vec2<f32>(-1.0, 1.0),
);

// Two triangles: 0,1,2 + 0,2,3
const QUAD_INDICES = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);

@vertex
fn vs_main(
  @builtin(vertex_index)   vi  : u32,
  @builtin(instance_index) idx : u32,
) -> VertexOut {
  let b       = beams[idx];
  let quadIdx = QUAD_INDICES[vi];
  let corner  = QUAD_CORNERS[quadIdx];   // (side [-1,1], t [0,1])

  let from = vec3<f32>(b.fromX, b.fromY, b.fromZ);
  let to   = vec3<f32>(b.toX,   b.toY,   b.toZ);

  // World-space point along the beam axis
  let worldPos = mix(from, to, corner.y);

  // Project both endpoints to clip space to derive screen-space direction
  let clipFrom = params.viewProj * vec4<f32>(from, 1.0);
  let clipTo   = params.viewProj * vec4<f32>(to,   1.0);

  // Screen-space beam direction (NDC)
  let ndcFrom = clipFrom.xy / clipFrom.w;
  let ndcTo   = clipTo.xy   / clipTo.w;

  var screenDir = ndcTo - ndcFrom;
  let lenSq = dot(screenDir, screenDir);
  if (lenSq < 1e-8) {
    screenDir = vec2<f32>(1.0, 0.0);
  } else {
    screenDir = normalize(screenDir);
  }

  // Perpendicular in screen space
  let perp = vec2<f32>(-screenDir.y, screenDir.x);

  // Clip-space width at this beam endpoint (aspect-corrected)
  let clip   = params.viewProj * vec4<f32>(worldPos, 1.0);
  let aspect = params.viewportWidth / params.viewportHeight;
  let ndcRadius = (b.glowRadius * 2.0) / params.viewportHeight;  // approx

  // Expand billboard perpendicular to beam axis in screen space
  let offset = perp * (corner.x * ndcRadius) * vec2<f32>(aspect, 1.0);

  let finalClip = vec4<f32>(clip.xy + offset * clip.w, clip.zw);

  var out : VertexOut;
  out.position = finalClip;
  out.uv       = vec2<f32>(corner.x, corner.y * 2.0 - 1.0); // remap y to [-1,1]
  out.color    = vec4<f32>(b.coreR, b.coreG, b.coreB, b.alpha);
  out.glow     = vec4<f32>(b.glowR, b.glowG, b.glowB, b.alpha);
  return out;
}

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
  // Soft capsule profile: 1 at centre (u=0), 0 at edge (|u|=1)
  let d    = abs(in.uv.x);         // 0 = beam axis, 1 = edge
  let core = smoothstep(0.6, 0.0, d);
  let glow = smoothstep(1.0, 0.1, d);

  // Blend core over glow
  let coreContrib = in.color.rgb * core;
  let glowContrib = in.glow.rgb  * (glow - core);
  let rgb  = coreContrib + glowContrib;
  let a    = (glow * in.glow.a);

  return vec4<f32>(rgb * a, a);
}
