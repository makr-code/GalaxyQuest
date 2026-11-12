(function () {
  'use strict';

  const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  function meshSample(vertices, direction) {
    let nearest = null;
    for (let i = 0; i < vertices.length; i += 36) {
      const a = Array.from(vertices.subarray(i, i + 3));
      const b = Array.from(vertices.subarray(i + 12, i + 15), (v, j) => v - a[j]);
      const c = Array.from(vertices.subarray(i + 24, i + 27), (v, j) => v - a[j]);
      const ray = direction.map(v => -v), p = cross(ray, c), determinant = dot(b, p);
      if (Math.abs(determinant) < 1e-14) continue;
      const t = direction.map((v, j) => v * 2 - a[j]), u = dot(t, p) / determinant;
      if (u < -1e-7 || u > 1 + 1e-7) continue;
      const q = cross(t, b), v = dot(ray, q) / determinant;
      if (v < -1e-7 || u + v > 1 + 1e-7) continue;
      const distance = dot(c, q) / determinant;
      if (distance < 0 || distance > 2 || (nearest && distance >= nearest.distance)) continue;
      const material = vertices[i + 7] * (1 - u - v) + vertices[i + 19] * u + vertices[i + 31] * v;
      const region = vertices[i + 6] * (1 - u - v) + vertices[i + 18] * u + vertices[i + 30] * v;
      const normal = cross(b, c), length = Math.hypot(...normal);
      const slopeCosine = Math.abs(dot(normal, direction)) / Math.max(1e-14, length);
      nearest = { distance, radius: 2 - distance,
        blocked: (material > 0.5 && material < 1.5) || material > 2.5 || region > 0.5 || slopeCosine < 0.99 };
    }
    return nearest && !nearest.blocked ? nearest.radius : null;
  }

  function facilityGeometry(facilities, vertices, available = () => true) {
    if (!(vertices instanceof Float32Array) || vertices.length % 36 !== 0 || !vertices.every(Number.isFinite)) {
      throw new TypeError('Facility foundations require finite 48-byte mesh triangles');
    }
    const instances = [], parts = [];
    for (const facility of facilities) {
      const { direction, east, north, radiusMeters } = facility;
      const nearby = [];
      for (let i = 0; i < vertices.length; i += 36) {
        if ([0, 12, 24].some(offset => {
          const p = Array.from(vertices.subarray(i + offset, i + offset + 3));
          return dot(p, direction) / Math.hypot(...p) > 0.97;
        })) nearby.push(...vertices.subarray(i, i + 36));
      }
      const mesh = new Float32Array(nearby);
      const sample = (e, n) => {
        const p = direction.map((v, i) => v + (east[i] * e + north[i] * n) / radiusMeters);
        const length = Math.hypot(...p), up = p.map(v => v / length);
        if (!available(up)) return null;
        const radius = meshSample(mesh, up);
        return radius === null ? null : { up, radius };
      };
      for (const part of facility.parts) {
        // Fields and access roads already follow the exact terrain in the shared surface shader.
        if (part.shape === 4 || part.shape === 5) continue;
        const base = sample(part.eastMeters, part.northMeters);
        const corners = [-1, 1].flatMap(x => [-1, 1].map(z => sample(
          part.eastMeters + x * part.widthMeters / 2, part.northMeters + z * part.depthMeters / 2)));
        if (!base || corners.some(p => !p)) continue;
        const min = Math.min(base.radius, ...corners.map(p => p.radius)) - 0.5 / radiusMeters;
        const max = Math.max(base.radius, ...corners.map(p => p.radius));
        const height = part.heightMeters / radiusMeters + max - min;
        const position = base.up.map(v => v * (min + part.bottomMeters / radiusMeters + height / 2));
        instances.push(...position, part.widthMeters / radiusMeters, ...east, part.depthMeters / radiusMeters,
          ...north, height, ...base.up, part.shape, ...part.color, part.roughness,
          part.lamp * facility.activity, radiusMeters, 0, 0);
        parts.push({ ...part, facilityId: facility.id, kind: facility.kind, position, foundationRadius: max });
      }
    }
    return { instances: new Float32Array(instances), parts };
  }

  function createFacilityRenderer(device, format, patterns, label = 'colony_metric_facilities') {
    const module = device.createShaderModule({ label, code: `
struct Frame { projection: mat4x4<f32>, x: vec4<f32>, y: vec4<f32>, z: vec4<f32>, light: vec4<f32> };
struct Part { position: vec4<f32>, east: vec4<f32>, north: vec4<f32>, up: vec4<f32>, color: vec4<f32>, detail: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage,read> parts: array<Part>;
${patterns}
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec3<f32>,
  @location(1) local: vec2<f32>, @location(2) @interpolate(flat) size: vec2<f32>,
  @location(3) @interpolate(flat) shape: f32, @location(4) @interpolate(flat) lamp: f32 };
@vertex fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Out {
  let part = parts[index];
  let corners = array<vec3<f32>,10>(vec3<f32>(-1,-1,-1),vec3<f32>(1,-1,-1),
    vec3<f32>(1,0.6,-1),vec3<f32>(-1,0.6,-1),vec3<f32>(-1,-1,1),vec3<f32>(1,-1,1),
    vec3<f32>(1,0.6,1),vec3<f32>(-1,0.6,1),vec3<f32>(0,1,-1),vec3<f32>(0,1,1));
  let indices = array<u32,48>(0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,
    3,7,9,3,9,8,8,9,6,8,6,2,0,4,7,0,7,3,1,2,6,1,6,5,3,8,2,7,6,9);
  var a = vec3<f32>(0.0);
  var b = a; var c = a;
  if (part.up.w == 1.0) {
    let segment = vertex / 12u;
    let rim = array<vec2<f32>,12>(vec2<f32>(1,0),vec2<f32>(0.866025403784,0.5),
      vec2<f32>(0.5,0.866025403784),vec2<f32>(0,1),vec2<f32>(-0.5,0.866025403784),
      vec2<f32>(-0.866025403784,0.5),vec2<f32>(-1,0),vec2<f32>(-0.866025403784,-0.5),
      vec2<f32>(-0.5,-0.866025403784),vec2<f32>(0,-1),vec2<f32>(0.5,-0.866025403784),vec2<f32>(0.866025403784,-0.5));
    let first = rim[segment];
    let next = rim[(segment + 1u) % 12u];
    let ring = array<vec3<f32>,6>(vec3<f32>(first.x,-1,first.y),vec3<f32>(next.x,-1,next.y),
      vec3<f32>(first.x,1,first.y),vec3<f32>(next.x,1,next.y),vec3<f32>(0,1,0),vec3<f32>(0,-1,0));
    let faces = array<u32,12>(0,1,2,2,1,3,2,3,4,1,0,5);
    let triangle = vertex % 12u / 3u * 3u;
    a = ring[faces[triangle]]; b = ring[faces[triangle + 1u]]; c = ring[faces[triangle + 2u]];
  } else if (vertex < 48u) {
    let triangle = vertex / 3u * 3u;
    a = corners[indices[triangle]]; b = corners[indices[triangle + 1u]]; c = corners[indices[triangle + 2u]];
    if (part.up.w != 2.0) {
      a.y = select(-1.0,1.0,a.y > 0.0); b.y = select(-1.0,1.0,b.y > 0.0); c.y = select(-1.0,1.0,c.y > 0.0);
    }
    if (part.up.w == 3.0) {
      a.y = select(a.y,a.z * 0.8,a.y > 0.0); b.y = select(b.y,b.z * 0.8,b.y > 0.0); c.y = select(c.y,c.z * 0.8,c.y > 0.0);
    }
  }
  let dimensions = vec3<f32>(part.position.w,part.north.w,part.east.w) * 0.5;
  let local = select(select(a,b,vertex % 3u == 1u),c,vertex % 3u == 2u);
  let axes = mat3x3<f32>(part.east.xyz,part.up.xyz,part.north.xyz);
  let orientation = mat3x3<f32>(frame.x.xyz,frame.y.xyz,frame.z.xyz);
  let faceNormal = cross((b - a) * dimensions,(c - a) * dimensions);
  let outward = select(-faceNormal,faceNormal,dot(faceNormal,(a + b + c) * dimensions) >= 0.0);
  let n = orientation * axes * (outward / max(length(outward),1e-20));
  let light = normalize(frame.light.xyz);
  let daylight = mix(1.0,max(0.0,dot(n,light)),frame.light.w);
  let night = 1.0 - smoothstep(-0.15,0.2,dot(orientation * part.up.xyz,light));
  var out: Out;
  out.position = frame.projection * vec4<f32>(orientation * (part.position.xyz + axes * (local * dimensions)),1);
  out.color = part.color.rgb * (0.12 + daylight * 0.88);
  out.local = local.xz * dimensions.xz * part.detail.y;
  out.size = dimensions.xz * 2.0 * part.detail.y;
  out.shape = part.up.w;
  out.lamp = part.detail.x * night * frame.light.w;
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> {
  let footprint = max(length(dpdx(in.local)),length(dpdy(in.local)));
  let color = gqFacilityColor(in.color,in.local,in.shape,footprint);
  let lamp = gqFacilityLamp(in.local,in.size,in.shape,footprint) * in.lamp;
  return vec4<f32>(color + vec3<f32>(1.0,0.70,0.36) * lamp,1);
}
` });
    const pipeline = device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
    const uniform = device.createBuffer({ label: label + '_frame', size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    let buffer = null, bindings = null, count = 0, disposed = false;
    return {
      update(geometry) {
        if (disposed) throw new Error('Cannot update disposed facility geometry');
        count = geometry.parts.length;
        if (!buffer || buffer.size < Math.max(96, geometry.instances.byteLength)) {
          buffer?.destroy();
          buffer = device.createBuffer({ label: label + '_parts', size: Math.max(96, geometry.instances.byteLength),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
          bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer } },
          ] });
        }
        if (count) device.queue.writeBuffer(buffer, 0, geometry.instances);
      },
      draw(pass, uniforms, lighting) {
        if (disposed || !count) return;
        const data = new Float32Array(32);
        data.set(uniforms.subarray(0, 16));
        data.set(uniforms.subarray(36, 48), 16);
        data.set([...uniforms.subarray(48, 51), lighting ? 1 : 0], 28);
        device.queue.writeBuffer(uniform, 0, data);
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(144, count);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        buffer?.destroy(); uniform.destroy();
      },
    };
  }

  function resolved(facilities, uniforms, pixelHeight) {
    return facilities.some(facility => {
      const p = facility.direction;
      const world = [0, 1, 2].map(axis => uniforms[36 + axis] * p[0]
        + uniforms[40 + axis] * p[1] + uniforms[44 + axis] * p[2]);
      const distance = Math.hypot(...world.map((n, i) => n - uniforms[32 + i]));
      const height = Math.max(0, ...facility.parts.map(part => part.heightMeters + part.bottomMeters));
      return height / facility.radiusMeters * Math.hypot(uniforms[1], uniforms[5], uniforms[9])
        * pixelHeight / (2 * Math.max(distance, 1e-8)) >= 0.75;
    });
  }

  const api = { facilityGeometry, createFacilityRenderer, resolved };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GQColonyFacilityGeometry = api;
})();
