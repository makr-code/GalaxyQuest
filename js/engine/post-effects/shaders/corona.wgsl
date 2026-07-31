// GalaxyQuest Engine — corona.wgsl
// WebGPU Post-Processing: Atmospheric Corona / Galactic Glow Halo
//
// Renders a pulsing, color-cycling halo effect with multiple concentric rings.
// Commonly used to highlight galactic cores or dominant celestial features.
//
// The corona combines:
//   • Radial distance field from the center point
//   • Sinusoidal pulse modulation (pulsing radius)
//   • HSL color cycling (Orange → Yellow → White)
//   • Multiple glow rings for depth
//
// License: MIT — makr-code/GalaxyQuest

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var inputSmp : sampler;
@group(0) @binding(2) var<uniform> params : CoronaParams;

struct CoronaParams {
  centerX : f32,           // Screen X position [0, 1]
  centerY : f32,           // Screen Y position [0, 1]
  baseRadius : f32,        // Glow radius (screen pixels)
  pulseAmp : f32,          // Pulse amplitude
  pulseFreq : f32,         // Pulse frequency (Hz)
  colorCycleSpeed : f32,   // Color cycle speed (cycles/sec)
  intensity : f32,         // Glow intensity multiplier
  time : f32,              // Elapsed time (seconds)
}

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

// =====================================================================
// Color Utilities
// =====================================================================

/**
 * Convert HSL (Hue, Saturation, Lightness) to RGB.
 * Hue is in [0, 1], S and L in [0, 1].
 */
fn hsl_to_rgb(h: f32, s: f32, l: f32) -> vec3<f32> {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = h * 6.0;
  let x = c * (1.0 - abs((hp % 2.0) - 1.0));
  
  let rgb = select(
    select(
      select(
        vec3<f32>(0.0, c, x),           // 0-60° (cyan-blue)
        vec3<f32>(x, c, 0.0),           // 120-180° (green-yellow)
        hp >= 2.0
      ),
      vec3<f32>(c, 0.0, x),             // 60-120° (magenta-cyan)
      hp >= 1.0
    ),
    select(
      vec3<f32>(x, 0.0, c),             // 180-240° (blue-magenta)
      select(
        vec3<f32>(c, x, 0.0),           // 240-300° (blue-red)
        vec3<f32>(0.0, x, c),           // 300-360° (red-magenta)
        hp >= 4.0
      ),
      hp >= 3.0
    ),
    hp >= 5.0
  );
  
  let m = l - c * 0.5;
  return rgb + vec3<f32>(m);
}

// =====================================================================
// Glow Calculation
// =====================================================================

/**
 * Calculate glow contribution at a given distance from center.
 * Uses smooth polynomial falloff and Gaussian-like shape.
 */
fn glow_at_distance(dist: f32, radius: f32, intensity: f32) -> f32 {
  let falloff = 1.0 - smoothstep(0.0, radius * 1.5, dist);
  let brightness = exp(-pow((dist - radius) / (radius * 0.3), 2.0));
  return (falloff * 0.5 + brightness * 0.5) * intensity;
}

/**
 * Calculate glow from a single concentric ring.
 */
fn ring_glow(dist: f32, radius: f32, width: f32, intensity: f32) -> f32 {
  let diff = abs(dist - radius);
  return exp(-pow(diff / width, 2.0)) * intensity;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let col = textureSample(inputTex, inputSmp, in.uv).rgb;
  
  // Corona center in screen space (0,0 = top-left, 1,1 = bottom-right)
  let center = vec2<f32>(params.centerX, params.centerY);
  
  // Distance from center (normalized to viewport aspect)
  let offset = in.uv - center;
  let dist = length(offset) * 1000.0;  // Convert to "pixel-like" scale
  
  // Pulse animation: vary radius over time
  let pulse = sin(params.time * params.pulseFreq * 2.0 * 3.14159) * params.pulseAmp;
  let activeRadius = params.baseRadius + pulse;
  
  // Color cycling: hue changes over time
  let huePhase = fract(params.time * params.colorCycleSpeed);
  // Orange (0°) → Yellow (60°) → White-ish (120°) → back to Orange
  let hue = fract(huePhase * 0.4);  // Map to 0-0.4 for orange-yellow-white range
  let saturation = 0.8 - huePhase * 0.3;  // Desaturate as it cycles
  let lightness = 0.4 + huePhase * 0.1;
  let coronaColor = hsl_to_rgb(hue, saturation, lightness);
  
  // Calculate total glow from multiple rings
  var totalGlow = 0.0;
  let ringRadius = activeRadius;
  for (var i: u32 = 0u; i < 5u; i++) {
    let ringDist = ringRadius + f32(i) * activeRadius * 0.15;
    let ringWidth = activeRadius * 0.05;
    let ringIntensity = 1.0 / (1.0 + f32(i) * 0.3);  // Fade outer rings
    totalGlow += ring_glow(dist, ringDist, ringWidth, ringIntensity);
  }
  
  // Main glow falloff
  totalGlow += glow_at_distance(dist, activeRadius, params.intensity * 0.8);
  
  // Clamp and apply
  totalGlow = min(1.0, totalGlow * params.intensity);
  
  // Composite: additive blend of corona over original
  let result = col + coronaColor * totalGlow * 0.5;
  
  return vec4<f32>(result, 1.0);
}
