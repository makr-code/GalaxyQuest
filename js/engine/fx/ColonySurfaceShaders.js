'use strict';

// Shared projection for solid geometry and storage-buffer billboards.
const projection = `
struct Camera { centerScale: vec4f, aspectTime: vec4f };
@group(0) @binding(1) var<uniform> camera: Camera;
fn project(p: vec3f) -> vec4f {
  let q = p - camera.centerScale.xyz;
  return vec4f(q.x * camera.centerScale.w / camera.aspectTime.x,
    (q.y * 0.82 - q.z * 0.57) * camera.centerScale.w,
    clamp(0.5 - (q.y * 0.57 + q.z * 0.82) * 0.003, 0.01, 0.98), 1.0);
}`;

const buildingShader = `
struct Instance { color: vec4f, shape: vec4f, material: vec4f, position: vec4f };
@group(0) @binding(0) var<storage, read> instances: array<Instance>;
${projection}
@group(1) @binding(0) var surfaceSampler: sampler;
@group(1) @binding(1) var albedoMap: texture_2d_array<f32>;
@group(1) @binding(2) var normalMap: texture_2d_array<f32>;
@group(1) @binding(3) var roughnessMap: texture_2d_array<f32>;
@group(1) @binding(4) var metalnessMap: texture_2d_array<f32>;
@group(1) @binding(5) var emissiveMap: texture_2d_array<f32>;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f,
  @location(1) normal: vec3f, @location(2) tangent: vec3f,
  @location(3) color: vec3f, @location(4) @interpolate(flat) layer: i32 };
@vertex fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Out {
  let instance = instances[index];
  var normals = array<vec3f, 6>(vec3f(0,0,1), vec3f(0,0,-1), vec3f(1,0,0),
    vec3f(-1,0,0), vec3f(0,1,0), vec3f(0,-1,0));
  var tangents = array<vec3f, 6>(vec3f(1,0,0),vec3f(-1,0,0),vec3f(0,0,-1),
    vec3f(0,0,1),vec3f(1,0,0),vec3f(1,0,0));
  var corners = array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),
    vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let face = vertex / 6u;
  let uv = corners[vertex % 6u];
  let n = normals[face]; let t = tangents[face]; let b = cross(n,t);
  let local = n * 0.5 + t * (uv.x - 0.5) + b * (uv.y - 0.5);
  let world = (local + vec3f(0,0.5,0)) * instance.shape.xyz + instance.position.xyz;
  var out: Out; out.position = project(world); out.uv = uv;
  out.normal = n; out.tangent = t; out.color = instance.color.rgb;
  out.layer = i32(instance.material.x); return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4f {
  let base = textureSample(albedoMap, surfaceSampler, in.uv, in.layer).rgb * in.color;
  let sampledNormal = textureSample(normalMap, surfaceSampler, in.uv, in.layer).xyz * 2.0 - 1.0;
  let n = normalize(in.tangent * sampledNormal.x + cross(in.normal,in.tangent) * sampledNormal.y + in.normal * sampledNormal.z);
  let roughness = clamp(textureSample(roughnessMap, surfaceSampler, in.uv, in.layer).g, 0.06, 1.0);
  let metallic = textureSample(metalnessMap, surfaceSampler, in.uv, in.layer).b;
  let emissive = textureSample(emissiveMap, surfaceSampler, in.uv, in.layer).rgb;
  let light = normalize(vec3f(0.5,0.85,0.4)); let view = normalize(vec3f(0,0.57,0.82));
  let halfVector = normalize(light + view); let ndl = max(dot(n, light),0.0);
  let ndv = max(dot(n,view),0.001); let ndh = max(dot(n,halfVector),0.0);
  let vdh = max(dot(view,halfVector),0.0); let a2 = pow(roughness,4.0);
  let d = a2 / max(3.14159 * pow(ndh * ndh * (a2 - 1.0) + 1.0,2.0),0.0001);
  let k = pow(roughness + 1.0,2.0) / 8.0;
  let g = ndv / (ndv * (1.0-k)+k) * ndl / (ndl * (1.0-k)+k);
  let f0 = mix(vec3f(0.04),base,metallic); let f = f0 + (1.0-f0) * pow(1.0-vdh,5.0);
  let specular = d * g * f / max(4.0 * ndv * ndl,0.001);
  let diffuse = (1.0-f) * (1.0-metallic) * base / 3.14159;
  let color = base * 0.22 + (diffuse + specular) * ndl * 2.4 + emissive * 1.5;
  return vec4f(pow(color / (color + 1.0),vec3f(1.0/2.2)),1);
}`;

const particleShader = `
struct Particle { position: vec3f, lifetime: f32, velocity: vec3f, age: f32,
  color: vec3f, size: f32, alive: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
${projection}
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f,
  @location(1) color: vec4f };
@vertex fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Out {
  let p = particles[index];
  var corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
    vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let uv = corners[vertex]; var out: Out; out.position = project(p.position);
  out.position.x += uv.x * p.size * camera.centerScale.w / camera.aspectTime.x;
  out.position.y += uv.y * p.size * camera.centerScale.w;
  out.uv = uv; out.color = vec4f(p.color, p.alive * min(p.age * 4.0,1.0) * min(p.lifetime,1.0) * 0.5);
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4f {
  let radius = dot(in.uv,in.uv); if (radius > 1.0 || in.color.a <= 0.0) { discard; }
  return vec4f(in.color.rgb, in.color.a * pow(1.0-radius,2.0));
}`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildingShader, particleShader };
} else {
  window.GQColonySurfaceShaders = { buildingShader, particleShader };
}
