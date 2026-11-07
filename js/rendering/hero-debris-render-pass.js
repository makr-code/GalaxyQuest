import { BoxGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { fleetVisualLod } from './fleet-visual-lod.js';
import { HERO_DESTRUCTION_PROFILES } from './hero-battle-models.js';

const MAX_BURSTS = 16;
const FRAGMENTS_PER_BURST = 12;
const MAX_INSTANCES = MAX_BURSTS * FRAGMENTS_PER_BURST;
const LIFETIME = 6;
const SHADER = `
struct Uniforms { viewProjection: mat4x4<f32> };
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) heat: f32,
};
fn rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
@vertex fn vs_main(@location(0) vertex: vec3<f32>, @location(1) normal: vec3<f32>,
  @location(2) positionFade: vec4<f32>, @location(3) rotation: vec4<f32>,
  @location(4) sizeHeat: vec4<f32>, @location(5) tint: vec4<f32>) -> Output {
  let point = rotate(rotation, vertex * sizeHeat.xyz) + positionFade.xyz;
  let clip = uniforms.viewProjection * vec4(point, 1.0);
  var output: Output;
  output.position = vec4(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
  output.normal = normalize(rotate(rotation, normal / sizeHeat.xyz));
  output.color = vec4(tint.rgb, positionFade.w);
  output.heat = sizeHeat.w;
  return output;
}
@fragment fn fs_main(input: Output) -> @location(0) vec4<f32> {
  // Screen-door fade keeps fragments in the opaque depth pass without alpha sorting.
  let pixel = vec2<u32>(input.position.xy);
  let threshold = f32((pixel.x * 3u + pixel.y * 5u) % 16u) / 16.0;
  if (input.color.a <= threshold) { discard; }
  let light = 0.28 + max(dot(normalize(input.normal), normalize(vec3(0.38, -0.5, 0.78))), 0.0) * 0.9;
  return vec4(input.color.rgb * light + vec3(1.8, 0.42, 0.05) * input.heat, 1.0);
}
`;

function randomSequence(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export class HeroDebrisRenderPass {
  constructor() {
    this.bursts = [];
    this.instances = new Float32Array(MAX_INSTANCES * 16);
    this.stats = { bursts: 0, instances: 0, culled: 0, drawCalls: 0, vertices: 0 };
    this.peakInstances = 0;
    this.evictedBursts = 0;
    this.disposed = false;
  }

  spawn(source, { time, seed, velocity = new Vector3(), shipClass = 'frigate' }) {
    if (this.disposed) throw new Error('Hero debris renderer is disposed');
    if (!source?.position?.isVector3 || !source.quaternion?.isQuaternion
      || !velocity?.isVector3 || !Number.isFinite(source.scale) || source.scale <= 0
      || ![...source.position.toArray(), ...source.quaternion.toArray(), ...velocity.toArray(), time].every(Number.isFinite)
      || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff
      || !Object.hasOwn(HERO_DESTRUCTION_PROFILES, shipClass)) {
      throw new TypeError('Invalid hero debris burst');
    }
    const random = randomSequence(seed);
    const majorCount = HERO_DESTRUCTION_PROFILES[shipClass].majorFragments;
    const fragments = Array.from({ length: FRAGMENTS_PER_BURST }, (_, index) => {
      const direction = new Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (direction.lengthSq() < 1e-10) direction.set(1, 0, 0);
      direction.normalize().applyQuaternion(source.quaternion);
      const axis = new Vector3(random() + 0.1, random() - 0.5, random() - 0.5).normalize();
      const size = source.scale * (0.1 + random() * 0.14);
      const major = index < majorCount;
      return {
        offset: new Vector3((random() - 0.5) * 0.65, (random() - 0.5) * 0.3,
          (random() - 0.5) * 0.15).multiplyScalar(source.scale).applyQuaternion(source.quaternion),
        velocity: velocity.clone().addScaledVector(direction, source.scale * (0.18 + random() * 0.42) * (major ? 0.35 : 1)),
        axis, spin: (0.7 + random() * 2.5) * (index % 2 ? -1 : 1) * (major ? 0.2 : 1),
        size: new Vector3(size, size * (0.3 + random() * 0.5), size * (0.15 + random() * 0.25))
          .multiplyScalar(major ? 3 : 1),
        major,
        tint: [0.32 + random() * 0.25, 0.38 + random() * 0.2, 0.45 + random() * 0.15],
      };
    });
    this.bursts = this.bursts.filter((burst) => time < burst.time + LIFETIME);
    if (this.bursts.length === MAX_BURSTS) { this.bursts.shift(); this.evictedBursts++; }
    const burst = { position: source.position.clone(), quaternion: source.quaternion.clone(), time, fragments, shipClass };
    this.bursts.push(burst);
    return burst;
  }

  sample(burst, time) {
    if (!Number.isFinite(time)) throw new TypeError('Invalid hero debris sample time');
    const age = time - burst.time;
    if (age < 0 || age >= LIFETIME) return [];
    return burst.fragments.map((fragment) => ({
      position: burst.position.clone().add(fragment.offset).addScaledVector(fragment.velocity, age),
      quaternion: new Quaternion().setFromAxisAngle(fragment.axis, fragment.spin * age).multiply(burst.quaternion),
      size: fragment.size, tint: fragment.tint, fade: Math.min(1, (LIFETIME - age) / 1.5),
      heat: Math.exp(-age * 1.4) * 0.8,
    }));
  }

  render(pass, device, format, camera, origin, time, height) {
    if (this.disposed) throw new Error('Hero debris renderer is disposed');
    if (!Number.isFinite(time) || !Number.isFinite(height) || height <= 0) {
      throw new TypeError('Invalid hero debris render time or viewport');
    }
    this.bursts = this.bursts.filter((burst) => time < burst.time + LIFETIME);
    const stats = this.stats = { bursts: this.bursts.length, instances: 0, culled: 0, drawCalls: 0, vertices: 0 };
    const visible = [];
    for (const burst of this.bursts) {
      for (const fragment of this.sample(burst, time)) {
        const lod = fleetVisualLod(fragment.position, Math.max(...fragment.size.toArray()),
          camera, origin, height);
        if (lod.tier === 'hidden') { stats.culled++; continue; }
        visible.push(fragment);
      }
    }
    if (!visible.length) return;
    this._initialize(device, format);
    for (const fragment of visible) {
      const relative = fragment.position.clone().sub(origin).sub(camera.position);
      this.instances.set([...relative.toArray(), fragment.fade, ...fragment.quaternion.toArray(),
        ...fragment.size.toArray(), fragment.heat, ...fragment.tint, 1], stats.instances * 16);
      stats.instances++;
    }
    const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix,
      camera.matrixWorldInverse.clone().setPosition(0, 0, 0));
    device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array(projection.elements));
    device.queue.writeBuffer(this.instanceBuffer, 0, this.instances.buffer, 0, stats.instances * 64);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setVertexBuffer(1, this.instanceBuffer);
    pass.draw(36, stats.instances);
    stats.drawCalls = 1;
    stats.vertices = stats.instances * 36;
    this.peakInstances = Math.max(this.peakInstances, stats.instances);
  }

  _initialize(device, format) {
    if (this.device === device && this.format === format && this.bindGroup) return;
    this._releaseGpu();
    this.device = device;
    this.format = format;
    const shader = device.createShaderModule({ code: SHADER, label: 'hero-debris-mesh' });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main', buffers: [
        { arrayStride: 24, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ] },
        { arrayStride: 64, stepMode: 'instance', attributes: [2, 3, 4, 5].map((shaderLocation, index) => ({
          shaderLocation, offset: index * 16, format: 'float32x4',
        })) },
      ] },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less-equal' },
    });
    const indexed = new BoxGeometry(1, 1, 1);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    const position = geometry.getAttribute('position');
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
      position.setXYZ(index, x + y * 0.18, y * (x > 0 ? 0.7 : 1), z + x * 0.12);
    }
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal');
    const vertices = new Float32Array(position.count * 6);
    for (let index = 0; index < position.count; index++) {
      vertices.set([position.getX(index), position.getY(index), position.getZ(index),
        normal.getX(index), normal.getY(index), normal.getZ(index)], index * 6);
    }
    geometry.dispose();
    this.vertexBuffer = device.createBuffer({ size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
    this.instanceBuffer = device.createBuffer({ size: this.instances.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }] });
  }

  snapshot() {
    return { ...this.stats, bursts: this.bursts.length, peakInstances: this.peakInstances, evictedBursts: this.evictedBursts,
      limits: { bursts: MAX_BURSTS, instances: MAX_INSTANCES, lifetimeSeconds: LIFETIME } };
  }

  _releaseGpu() {
    const errors = [];
    for (const name of ['vertexBuffer', 'instanceBuffer', 'uniformBuffer']) {
      const buffer = this[name];
      this[name] = null;
      try { buffer?.destroy(); } catch (error) { errors.push(error); }
    }
    this.pipeline = null;
    this.bindGroup = null;
    this.device = null;
    if (errors.length) throw new AggregateError(errors, 'Hero debris GPU cleanup failed');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.bursts.length = 0;
    this._releaseGpu();
  }
}
