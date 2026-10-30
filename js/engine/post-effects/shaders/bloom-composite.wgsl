struct CompositeParams {
  strength: f32,
  hdr: f32,
  pad1: f32,
  pad2: f32,
}
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var bloomTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> params: CompositeParams;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VSOut {
  let positions = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
    vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0),
  );
  let uvs = array<vec2<f32>, 6>(
    vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(1.0, 0.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(0.0, 0.0),
  );
  var output: VSOut;
  output.position = vec4(positions[index], 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}

fn aces(color: vec3<f32>) -> vec3<f32> {
  let numerator = color * (2.51 * color + 0.03);
  let denominator = color * (2.43 * color + 0.59) + 0.14;
  return clamp(numerator / denominator, vec3(0.0), vec3(1.0));
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let scene = textureSample(sceneTex, linearSampler, input.uv).rgb;
  let bloom = textureSample(bloomTex, linearSampler, input.uv).rgb * params.strength;
  let color = scene + bloom;
  let mapped = select(min(color, vec3(1.0)), aces(color), params.hdr > 0.5);
  return vec4(mapped, 1.0);
}
