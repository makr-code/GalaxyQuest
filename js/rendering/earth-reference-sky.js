// Directional, seeded inspection sky. No measured star catalogue or scattering model.
const SKY_WGSL = `
struct Sky {
  inverseProjection: mat4x4<f32>,
  eye: vec4<f32>,
  light: vec4<f32>,
  options: vec4<f32>,
};
@group(0) @binding(0) var<uniform> sky: Sky;
struct SkyOut {
  @builtin(position) position: vec4<f32>,
  @location(0) farPoint: vec4<f32>,
};
@vertex fn vs_sky(@builtin(vertex_index) vertex: u32) -> SkyOut {
  let p = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3))[vertex];
  var out: SkyOut;
  out.position = vec4<f32>(p,0.99999,1);
  out.farPoint = sky.inverseProjection * vec4<f32>(p,1,1);
  return out;
}
fn starHash(cell: vec3<i32>) -> f32 {
  var n = (u32(cell.x) * 1597334677u) ^ (u32(cell.y) * 3812015801u) ^ (u32(cell.z) * 2798796415u);
  n = (n ^ (n >> 16u)) * 2246822519u;
  return f32(n ^ (n >> 13u)) / 4294967295.0;
}
@fragment fn fs_sky(in: SkyOut) -> @location(0) vec4<f32> {
  let direction = normalize(in.farPoint.xyz / in.farPoint.w - sky.eye.xyz);
  let point = direction * 360.0;
  let footprint = max(length(dpdx(point)),length(dpdy(point)));
  let cell = vec3<i32>(floor(point));
  let seed = starHash(cell);
  let center = vec3<f32>(starHash(cell + vec3<i32>(17,0,0)),
    starHash(cell + vec3<i32>(0,29,0)),starHash(cell + vec3<i32>(0,0,43)));
  let distance = length(fract(point) - center);
  let star = select(0.0,1.0,seed > 0.985)
    * (1.0 - smoothstep(0.04,0.12 + min(0.3,footprint * 0.4),distance))
    / (1.0 + footprint * footprint);
  let sun = pow(max(dot(direction,normalize(sky.light.xyz)),0.0),2048.0);
  var color = (vec3<f32>(0.001,0.002,0.006) + star * vec3<f32>(0.8,0.86,1)
    + sun * vec3<f32>(1,0.85,0.6)) * sky.options.x;
  let along = -dot(sky.eye.xyz,direction);
  let closest = sky.eye.xyz + direction * max(0.0,along);
  let radius = length(closest);
  let shell = smoothstep(0.995,1.004,radius) * (1.0 - smoothstep(1.004,1.035,radius))
    * select(0.0,1.0,along > 0.0);
  let day = smoothstep(-0.2,0.4,dot(closest / max(radius,0.00001),normalize(sky.light.xyz)));
  let solar = gqOrbitalAtmosphere(closest / max(radius,0.00001),normalize(sky.light.xyz));
  let halo = mix(vec3<f32>(0.08,0.3,0.62) * mix(0.04,1.0,day),solar.rgb * solar.a,sky.options.z);
  color += halo * shell * sky.options.y;
  return vec4<f32>(color,1);
}
`;

export function createEarthSky(device, format, atmosphereShader) {
  const module = device.createShaderModule({ label: 'earth_reference_sky', code: atmosphereShader + SKY_WGSL });
  const pipeline = device.createRenderPipeline({
    label: 'earth_reference_sky', layout: 'auto',
    vertex: { module, entryPoint: 'vs_sky' },
    fragment: { module, entryPoint: 'fs_sky', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const buffer = device.createBuffer({ label: 'earth_sky_uniforms', size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer } }] });
  return {
    update(inverseProjection, eye, enabled, atmosphere, light, solarAtmosphere) {
      const data = new Float32Array(28);
      data.set(inverseProjection, 0);
      data.set([eye.x, eye.y, eye.z, 0], 16);
      data.set([...light, 0], 20);
      data.set([enabled ? 1 : 0, atmosphere ? 1 : 0, solarAtmosphere ? 1 : 0, 0], 24);
      device.queue.writeBuffer(buffer, 0, data);
    },
    draw(pass) { pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); },
    dispose() { buffer.destroy(); },
  };
}
