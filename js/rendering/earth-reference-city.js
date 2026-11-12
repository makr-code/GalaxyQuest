import { EARTH_REFERENCE, geographicVector } from './earth-reference-geography.js';
import { inspectReliefMesh } from './earth-reference-relief.js';

const RADIUS_METERS = EARTH_REFERENCE.radiusKm * 1000;

export function metricCityLots(seed, population, profile) {
  if (!Number.isInteger(seed) || !Number.isFinite(population) || population < 0
    || !['residential', 'mixed', 'agriculture', 'industry', 'trade', 'science'].includes(profile)) {
    throw new RangeError('Invalid metric city snapshot');
  }
  const random = index => {
    let h = Math.imul(index ^ seed, 1597334677);
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  const lots = [];
  const pressure = Math.min(1, population / 1000000);
  for (let z = -12; z < 12; z++) for (let x = -12; x < 12; x++) {
    const id = (z + 12) * 24 + x + 12;
    if (random(id * 4) > pressure * (profile === 'agriculture' ? 0.45 : 0.9)) continue;
    const industrial = profile === 'industry' || (profile === 'mixed' && random(id * 4 + 1) < 0.3);
    lots.push({ id, eastMeters: (x + 0.5) * 60, northMeters: (z + 0.5) * 60,
      widthMeters: industrial ? 42 : 18 + random(id * 4 + 1) * 16,
      depthMeters: industrial ? 40 : 18 + random(id * 4 + 2) * 16,
      heightMeters: industrial ? 9 + random(id * 4 + 3) * 9
        : 9 + Math.floor(random(id * 4 + 3) * (profile === 'trade' ? 30 : 12)) * 3,
      color: industrial ? [0.42, 0.46, 0.49] : profile === 'science' ? [0.68, 0.71, 0.72] : [0.48, 0.53, 0.57] });
  }
  return lots;
}

export function metricCityGeometry(lots, longitude, latitude, vertices, relief, settings) {
  const up = geographicVector(longitude, latitude);
  const east = geographicVector(longitude + 90, 0);
  const north = [up[1] * east[2], up[2] * east[0] - up[0] * east[2], -up[1] * east[0]];
  // Only nearby triangles can intersect radial foundation rays.
  const nearby = [];
  for (let i = 0; i < vertices.length; i += 36) {
    let maximum = -Infinity;
    for (let j = 0; j < 36; j += 12) {
      const p = Array.from(vertices.subarray(i + j, i + j + 3));
      maximum = Math.max(maximum, p.reduce((sum, n, axis) => sum + n * up[axis], 0) / Math.hypot(...p));
    }
    if (maximum > 0.97) nearby.push(...vertices.subarray(i, i + 36));
  }
  const mesh = new Float32Array(nearby);
  const sample = (e, n) => {
    const p = up.map((v, i) => v + (east[i] * e + north[i] * n) / RADIUS_METERS);
    const length = Math.hypot(...p), direction = p.map(v => v / length);
    const hit = inspectReliefMesh(mesh, direction.map(v => v * 2), direction.map(v => -v), relief, settings);
    if (!hit || hit.water) return null;
    return { direction, radius: 1 + hit.meshElevation * settings.exaggeration / RADIUS_METERS };
  };
  const packed = [], buildings = [];
  for (const lot of lots) {
    const base = sample(lot.eastMeters, lot.northMeters);
    if (!base) continue;
    const corners = [-1, 1].flatMap(x => [-1, 1].map(z => sample(
      lot.eastMeters + x * lot.widthMeters / 2, lot.northMeters + z * lot.depthMeters / 2)));
    if (corners.some(p => !p)) continue;
    const min = Math.min(base.radius, ...corners.map(p => p.radius)) - 1 / RADIUS_METERS;
    const max = Math.max(base.radius, ...corners.map(p => p.radius));
    const height = lot.heightMeters / RADIUS_METERS + max - min;
    const position = base.direction.map(v => v * (min + height / 2));
    packed.push(...position, lot.widthMeters / RADIUS_METERS, ...east, lot.depthMeters / RADIUS_METERS,
      ...north, height, ...base.direction, 0, ...lot.color, 1);
    buildings.push({ ...lot, position, foundationRadius: max });
  }
  return { instances: new Float32Array(packed), buildings, radiusMeters: RADIUS_METERS };
}

export function createMetricCity(device, format) {
  const module = device.createShaderModule({ label: 'earth_metric_city', code: `
struct Frame { projection: mat4x4<f32>, x: vec4<f32>, y: vec4<f32>, z: vec4<f32>, light: vec4<f32> };
struct Building { position: vec4<f32>, east: vec4<f32>, north: vec4<f32>, up: vec4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage,read> buildings: array<Building>;
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec3<f32>,
  @location(1) local: vec3<f32>, @location(2) @interpolate(flat) face: u32 };
@vertex fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Out {
  let corners = array<vec3<f32>,8>(vec3<f32>(-1,-1,-1),vec3<f32>(1,-1,-1),
    vec3<f32>(1,1,-1),vec3<f32>(-1,1,-1),vec3<f32>(-1,-1,1),vec3<f32>(1,-1,1),
    vec3<f32>(1,1,1),vec3<f32>(-1,1,1));
  let indices = array<u32,36>(0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,
    3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5);
  let normals = array<vec3<f32>,6>(vec3<f32>(0,0,-1),vec3<f32>(0,0,1),
    vec3<f32>(0,-1,0),vec3<f32>(0,1,0),vec3<f32>(-1,0,0),vec3<f32>(1,0,0));
  let b = buildings[index];
  let axes = mat3x3<f32>(b.east.xyz,b.up.xyz,b.north.xyz);
  let orientation = mat3x3<f32>(frame.x.xyz,frame.y.xyz,frame.z.xyz);
  let p = b.position.xyz + axes * (corners[indices[vertex]] * vec3<f32>(b.position.w,b.north.w,b.east.w) * 0.5);
  let n = normalize(orientation * axes * normals[vertex / 6u]);
  let daylight = mix(1.0,max(0.0,dot(n,normalize(frame.light.xyz))),frame.light.w);
  var out: Out;
  out.position = frame.projection * vec4<f32>(orientation * p,1);
  out.color = b.color.rgb * (0.12 + daylight * 0.88);
  out.local = corners[indices[vertex]] * vec3<f32>(b.position.w,b.north.w,b.east.w) * 0.5 * ${RADIUS_METERS};
  out.face = vertex / 6u;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let horizontal = select(in.local.x,in.local.z,in.face >= 4u);
  let pixel = max(fwidth(horizontal),fwidth(in.local.y));
  let detail = 1.0 - smoothstep(0.8,2.0,pixel);
  let window = step(0.25,fract(horizontal / 4.0)) * step(fract(horizontal / 4.0),0.7)
    * step(0.3,fract(in.local.y / 3.0)) * step(fract(in.local.y / 3.0),0.75)
    * select(1.0,0.0,in.face == 2u || in.face == 3u);
  return vec4<f32>(in.color * (1.0 - window * detail * 0.45),1);
}
` });
  const pipeline = device.createRenderPipeline({ layout: 'auto',
    vertex: { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
  const uniform = device.createBuffer({ label: 'earth_metric_city_frame', size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let buffer = null, bindings = null, count = 0, centre = [0, 0, 0], maximumHeight = 0;
  return {
    update(geometry) {
      buffer?.destroy();
      count = geometry.buildings.length;
      centre = count ? geometry.buildings[0].position : [0, 0, 0];
      maximumHeight = Math.max(0, ...geometry.buildings.map(b => b.heightMeters));
      buffer = device.createBuffer({ label: 'earth_metric_city_buildings', size: Math.max(80, geometry.instances.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      if (count) device.queue.writeBuffer(buffer, 0, geometry.instances);
      bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer } },
      ] });
    },
    draw(pass, frame, pixelHeight, lighting) {
      if (!count) return;
      const u = frame.uniforms;
      const world = centre.map((_, axis) => u[36 + axis] * centre[0]
        + u[40 + axis] * centre[1] + u[44 + axis] * centre[2]);
      const distance = Math.hypot(...world.map((n, i) => n - u[32 + i]));
      const projectionScale = Math.hypot(u[1], u[5], u[9]);
      if (maximumHeight / RADIUS_METERS * projectionScale * pixelHeight / (2 * distance) < 0.75) return;
      const data = new Float32Array(32);
      data.set(frame.uniforms.subarray(0, 16));
      data.set(frame.uniforms.subarray(36, 48), 16);
      data.set(frame.uniforms.subarray(48, 52), 28);
      data[31] = lighting ? 1 : 0;
      device.queue.writeBuffer(uniform, 0, data);
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(36, count);
    },
    dispose() { buffer?.destroy(); uniform.destroy(); },
  };
}
