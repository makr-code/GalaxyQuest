// GalaxyQuest Engine — dustlayer.wgsl
// WebGPU Post-Processing: Volumetric Dust / Nebula Layers
//
// Renders 2–3 semi-transparent procedural dust/nebula layers between the
// galaxy disc background and the foreground stars.  Each layer is an
// animated full-screen quad driven by Perlin-like FBM noise, tinted and
// scrolled at different speeds to create a parallax depth effect.
//
// Technique overview:
//   • 3 independent noise layers (background/mid/foreground) with distinct
//     scroll speeds, scale, opacity and colour tint.
//   • FBM (Fractional Brownian Motion) with 4 octaves per layer sample.
//   • Additive blending: layer contributions are added to the scene colour
//     with opacity control per layer.
//
// This complements the existing nebula.wgsl (ray-marched 3D volume) by
// providing a cheaper, screen-space parallax layer suitable for the
// always-visible galaxy background.
//
// References:
//   Perlin (1985) "An Image Synthesizer" — noise basis function
//   Quilez (2013) "Inigo Quilez — FBM" — https://iquilezles.org/articles/fbm/
//   Elite Dangerous supercruise dust (Frontier Developments)
//   No Man's Sky nebula layers (Hello Games)
//
// License: MIT — makr-code/GalaxyQuest

// -------------------------------------------------------------------------
// Bind-group layout
// -------------------------------------------------------------------------
@group(0) @binding(0) var inputTex  : texture_2d<f32>;
@group(0) @binding(1) var inputSmp  : sampler;
@group(0) @binding(2) var<uniform>  params : DustLayerParams;

const NUM_LAYERS: i32 = 3;

struct DustLayer {
  scrollX  : f32,   // horizontal scroll per second
  scrollY  : f32,   // vertical scroll per second
  scale    : f32,   // noise frequency scale
  opacity  : f32,   // layer alpha contribution
  colorR   : f32,
  colorG   : f32,
  colorB   : f32,
  _pad     : f32,
}

struct DustLayerParams {
  layers      : array<DustLayer, 3>,
  time        : f32,   // elapsed seconds
  masterOpacity : f32, // global opacity multiplier [0,1]
  _pad0       : f32,
  _pad1       : f32,
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
// Value noise hash — fast integer-based hash (adapted from Quilez)
// -------------------------------------------------------------------------
fn hash2(p: vec2<f32>) -> f32 {
  var n = sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453;
  return fract(n);
}

// -------------------------------------------------------------------------
// Smooth value noise (bilinear interpolation)
// -------------------------------------------------------------------------
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);  // smoothstep curve

  let a = hash2(i);
  let b = hash2(i + vec2<f32>(1.0, 0.0));
  let c = hash2(i + vec2<f32>(0.0, 1.0));
  let d = hash2(i + vec2<f32>(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// -------------------------------------------------------------------------
// Fractional Brownian Motion — 4 octaves
// -------------------------------------------------------------------------
fn fbm(p: vec2<f32>) -> f32 {
  var v: f32 = 0.0;
  var amp: f32 = 0.5;
  var pp = p;
  for (var i = 0; i < 4; i++) {
    v   += amp * vnoise(pp);
    pp  *= 2.1;
    amp *= 0.48;
  }
  return v;
}

// -------------------------------------------------------------------------
// Fragment shader
// -------------------------------------------------------------------------
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var col = textureSample(inputTex, inputSmp, in.uv).rgb;

  for (var li = 0; li < NUM_LAYERS; li++) {
    let layer = params.layers[li];

    // Scrolled UV for this layer
    let scrolled_uv = in.uv + vec2<f32>(
      layer.scrollX * params.time * 0.001,
      layer.scrollY * params.time * 0.001,
    );

    // Evaluate FBM noise at this layer's scale
    let n = fbm(scrolled_uv * layer.scale);

    // Threshold + smooth: only show denser dust clouds
    let dust = smoothstep(0.42, 0.78, n);

    // Fade near screen edges (vignette mask so dust doesn't clip at borders)
    let edge_dist = min(
      min(in.uv.x, 1.0 - in.uv.x),
      min(in.uv.y, 1.0 - in.uv.y)
    );
    let edge_mask = smoothstep(0.0, 0.15, edge_dist);

    let layer_col = vec3<f32>(layer.colorR, layer.colorG, layer.colorB);
    let alpha = dust * layer.opacity * params.masterOpacity * edge_mask;

    // Additive compositing: dust adds luminance, simulating light scattering
    col = col + layer_col * alpha;
  }

  return vec4<f32>(col, 1.0);
}
