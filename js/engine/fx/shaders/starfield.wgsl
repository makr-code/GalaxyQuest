// GalaxyQuest Engine — starfield.wgsl
// WGSL shader: engine-native starfield with warp-streak mode.
//
// Renders a field of procedural stars as instanced point sprites.  A warp
// parameter (0 → 1) stretches each star into a radial streak pointing toward
// the screen centre, replicating the classic hyperspace / jump-to-warp look.
//
// Bind-group 0:
//   binding 0 → uniform buffer — StarfieldParams
//   binding 1 → storage buffer (read) — StarInstance[]
//
// Each StarInstance encodes: position (x,y,z), base colour (packed u32),
// base size (f32), and a parallax layer weight (0..1).
//
// Technique references:
//   "Warp Speed Effect" — various demoscene implementations
//   Elite Dangerous hyperspace tunnel (Frontier Developments)
//   No Man's Sky warp effect (Hello Games)
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

struct StarfieldParams {
  // Camera / view
  viewProjMat   : mat4x4<f32>,
  cameraPos     : vec4<f32>,    // w unused

  // Starfield tuning
  time          : f32,          // elapsed seconds (for twinkle animation)
  warpFactor    : f32,          // 0 = normal, 1 = full warp stretch
  warpSpeed     : f32,          // forward velocity during warp (affects streak length)
  layerDepth    : f32,          // parallax layer depth scale

  // Display
  baseSize      : f32,          // point sprite base radius (pixels)
  brightness    : f32,          // master brightness multiplier [0,1]
  twinkleAmt    : f32,          // twinkle amplitude [0,1]
  pad           : f32,
}

struct StarInstance {
  pos        : vec3<f32>,
  colorPacked: u32,     // R8G8B8A8 packed star colour
  size       : f32,     // per-star radius scale
  layer      : f32,     // parallax weight [0,1]; 0=background, 1=close
  pad0       : f32,
  pad1       : f32,
}

@group(0) @binding(0) var<uniform>         params : StarfieldParams;
@group(0) @binding(1) var<storage, read>   stars  : array<StarInstance>;

// ---------------------------------------------------------------------------
// Vertex shader
// ---------------------------------------------------------------------------

struct VSOut {
  @builtin(position) pos      : vec4<f32>,
  @location(0)       color    : vec4<f32>,
  @location(1)       pointSize: f32,     // passed to fragment for soft-circle
  @location(2)       uv       : vec2<f32>,// [-1,1] quad coordinates
}

@vertex
fn vs_main(
  @builtin(instance_index) instIdx : u32,
  @location(0)             quadUV  : vec2<f32>,   // unit quad [-0.5, 0.5]
) -> VSOut {
  let star = stars[instIdx];

  // Unpack colour
  let r = f32((star.colorPacked >> 24u) & 0xffu) / 255.0;
  let g = f32((star.colorPacked >> 16u) & 0xffu) / 255.0;
  let b = f32((star.colorPacked >>  8u) & 0xffu) / 255.0;
  let a = f32( star.colorPacked         & 0xffu) / 255.0;

  // Twinkle: sine-based flicker, per-star phase derived from position
  let phase = dot(star.pos, vec3<f32>(1.0, 2.3, 0.7));
  let twinkle = 1.0 - params.twinkleAmt * (sin(params.time * 3.0 + phase) * 0.5 + 0.5);

  // Parallax: offset star position by layer depth (simulates depth)
  var worldPos = star.pos + params.cameraPos.xyz * ((star.layer - 1.0) * params.layerDepth);

  // Warp: compute streak vector pointing from star toward screen-space origin.
  // In warp mode we expand the quad along the radial direction.
  let toCamera      = normalize(params.cameraPos.xyz - worldPos);
  let stretchFactor = 1.0 + params.warpFactor * params.warpSpeed * 6.0;

  // Apply quad offset — along radial for warp, uniform for normal
  let radial      = toCamera;
  let tangent     = normalize(cross(radial, vec3<f32>(0.0, 1.0, 0.001)));
  let quadOffset  = tangent * quadUV.x + radial * (quadUV.y * stretchFactor);

  let pixelSize = params.baseSize * star.size * (1.0 + star.layer * 0.5);
  worldPos += quadOffset * pixelSize * 0.01;   // scale to world-space pixel size

  var out : VSOut;
  out.pos       = params.viewProjMat * vec4<f32>(worldPos, 1.0);
  out.color     = vec4<f32>(r * twinkle, g * twinkle, b * twinkle, a) * params.brightness;
  out.pointSize = pixelSize;
  out.uv        = quadUV * 2.0;
  return out;
}

// ---------------------------------------------------------------------------
// Fragment shader — soft circular sprite with warp-elongation alpha
// ---------------------------------------------------------------------------

@fragment
fn fs_main(
  @location(0) color     : vec4<f32>,
  @location(1) pointSize : f32,
  @location(2) uv        : vec2<f32>,
) -> @location(0) vec4<f32> {
  // Soft circle: SDF from UV centre
  let d = length(uv);
  if (d > 1.0) { discard; }

  // Gaussian falloff for star glow
  let alpha = exp(-d * d * 2.5);

  return vec4<f32>(color.rgb, color.a * alpha);
}
