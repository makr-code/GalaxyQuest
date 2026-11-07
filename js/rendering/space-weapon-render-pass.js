import { Matrix4, Vector3 } from 'three';
import { simplifyWeaponPrimitives, visibleWeaponPrimitive, weaponVisualLod } from './fleet-visual-lod.js';

const MAX_EFFECTS = 64;
const MAX_PRIMITIVES = MAX_EFFECTS * 12;

export const SPACE_WEAPON_PROFILES = Object.freeze(Object.fromEntries(Object.entries({
  laser: { mode: 'beam', color: [0.3, 0.8, 1], flightSeconds: 0, duration: 0.16, width: 2, trail: 0, head: 0, impact: 11 },
  ballistic: { mode: 'projectile', color: [1, 0.75, 0.3], flightSeconds: 0.7, duration: 0.3, width: 1.4, trail: 0.05, head: 2, impact: 8 },
  railgun: { mode: 'projectile', color: [0.8, 0.55, 1], flightSeconds: 0.25, duration: 0.25, width: 1, trail: 0.12, head: 2, impact: 13 },
  photon: { mode: 'projectile', color: [0.4, 0.9, 1], flightSeconds: 0.9, duration: 0.4, width: 2, trail: 0.09, head: 7, impact: 17 },
  plasma: { mode: 'projectile', color: [0.3, 1, 0.55], flightSeconds: 1.4, duration: 0.5, width: 3, trail: 0.18, head: 9, impact: 20 },
  missile: { mode: 'missile', color: [1, 0.4, 0.12], flightSeconds: 2, duration: 0.65, width: 2.5, trail: 0.3, head: 3, impact: 25 },
}).map(([kind, profile]) => [kind, Object.freeze({ ...profile, color: Object.freeze(profile.color) })])));

function validVector(vector) {
  return vector?.isVector3 && vector.toArray().every(Number.isFinite);
}

function validEntity(entity) {
  return validVector(entity?.position) && entity.quaternion?.isQuaternion
    && entity.quaternion.toArray().every(Number.isFinite)
    && Number.isFinite(entity.scale) && entity.scale > 0;
}

export function resolveWeaponMuzzle(source, muzzleOffset) {
  if (!validEntity(source) || !validVector(muzzleOffset)) throw new TypeError('Invalid weapon muzzle transform');
  return muzzleOffset.clone().multiplyScalar(source.scale).applyQuaternion(source.quaternion).add(source.position);
}

function projectilePosition(shot, progress) {
  const t = Math.max(0, Math.min(1, progress));
  if (shot.profile.mode !== 'missile') return shot.from.clone().lerp(shot.to, t);
  const u = 1 - t;
  return shot.from.clone().multiplyScalar(u ** 3)
    .addScaledVector(shot.controlA, 3 * u * u * t)
    .addScaledVector(shot.controlB, 3 * u * t * t)
    .addScaledVector(shot.to, t ** 3);
}
const SHADER = `
struct Uniforms { viewProjection: mat4x4<f32>, viewport: vec4<f32> };
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) flash: f32,
};
@vertex fn vs_main(@builtin(vertex_index) vertex: u32,
  @location(0) start: vec4<f32>, @location(1) end: vec4<f32>,
  @location(2) color: vec4<f32>) -> Output {
  let corners = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
  let uv = corners[vertex];
  let a = uniforms.viewProjection * vec4(start.xyz, 1.0);
  let b = uniforms.viewProjection * vec4(end.xyz, 1.0);
  let delta = (b.xy / b.w - a.xy / a.w) * uniforms.viewport.xy;
  let direction = delta / max(length(delta), 0.000001);
  let perpendicular = vec2(-direction.y, direction.x);
  var clip = mix(a, b, (uv.x + 1.0) * 0.5);
  var offset = perpendicular * uv.y * end.w;
  if (start.w > 0.5) {
    clip = a;
    offset = uv * end.w;
    if (start.w >= 4.0) {
      let angle = (start.w - 4.0) * 6.283185;
      offset = vec2(uv.x * cos(angle) - uv.y * sin(angle),
        uv.x * sin(angle) + uv.y * cos(angle)) * end.w;
    }
  }
  clip = vec4(clip.xy + offset / uniforms.viewport.xy * 2.0 * clip.w,
    (clip.z + clip.w) * 0.5, clip.w);
  var output: Output;
  output.position = clip;
  output.uv = uv;
  output.color = color;
  output.flash = start.w;
  return output;
}
@fragment fn fs_main(input: Output) -> @location(0) vec4<f32> {
  var intensity = pow(max(0.0, 1.0 - abs(input.uv.y)), 2.0);
  if (input.flash > 0.5) {
    intensity = pow(max(0.0, 1.0 - length(input.uv)), 2.0);
    if (input.flash > 1.5 && input.flash < 2.5) {
      intensity = exp(-pow((length(input.uv) - 0.72) * 9.0, 2.0));
    }
    if (input.flash > 2.5 && input.flash < 3.5) {
      intensity = exp(-length(input.uv) * length(input.uv) * 4.0) * 0.35;
    }
    if (input.flash > 3.5) {
      intensity = select(0.0, 1.0, abs(input.uv.x) * 0.6 + abs(input.uv.y) < 0.7);
    }
  }
  return vec4(input.color.rgb, input.color.a * intensity);
}
`;

export class SpaceWeaponRenderPass {
  constructor() {
    this.effects = [];
    this.instances = new Float32Array(MAX_PRIMITIVES * 12);
    this.matrix = new Matrix4();
    this.device = null;
    this.drawnEffects = 0;
    this.evictedEffects = 0;
    this.rejectedEffects = 0;
    this.frameStats = { primitives: 0, budgetDropped: 0, culled: 0, near: 0, middle: 0, far: 0 };
  }

  fire(from, to, { time = performance.now() / 1000, color = [0.3, 0.8, 1],
    lifetime = 0.35, flash = false, width = 3, charge = false,
    source = null, muzzleOffset = new Vector3(0.5, 0, 0), priority = 0 } = {}) {
    if (!from?.isVector3 || !to?.isVector3
      || ![...from.toArray(), ...to.toArray(), time, lifetime, width].every(Number.isFinite)
      || lifetime <= 0 || lifetime > 2 || width <= 0 || width > 64
      || typeof charge !== 'boolean'
      || !Number.isInteger(priority) || priority < 0 || priority > 2
      || (source !== null && (!charge || !validEntity(source) || !validVector(muzzleOffset)))
      || !Array.isArray(color) || color.length !== 3
      || !color.every((value) => Number.isFinite(value) && value >= 0 && value <= 4)) {
      throw new TypeError('Invalid space weapon effect');
    }
    const effect = { from: from.clone(), to: to.clone(), time, lifetime, color: [...color], flash, width, charge,
      source, muzzleOffset: muzzleOffset.clone(), priority };
    return this._retain(effect);
  }

  _retain(effect) {
    if (this.effects.length === MAX_EFFECTS) {
      let lowest = 0;
      for (let index = 1; index < this.effects.length; index++) {
        if (this.effects[index].priority < this.effects[lowest].priority) lowest = index;
      }
      if (effect.priority < this.effects[lowest].priority) {
        this.rejectedEffects++;
        return effect;
      }
      this.effects.splice(lowest, 1);
      this.evictedEffects++;
    }
    this.effects.push(effect);
    return effect;
  }

  fireWeapon(kind, source, aimPoint, {
    time = performance.now() / 1000, muzzleOffset = new Vector3(0.5, 0, 0),
    sourceVelocity = new Vector3(), flightSeconds, impact = false, target = null,
    impactKind = 'generic', impactNormal = new Vector3(0, 0, 1), impactOffset = null,
    priority = 0,
  } = {}) {
    const profile = Object.hasOwn(SPACE_WEAPON_PROFILES, kind) ? SPACE_WEAPON_PROFILES[kind] : null;
    if (!profile || !validVector(aimPoint) || !validVector(sourceVelocity)
      || !Number.isFinite(time) || typeof impact !== 'boolean'
      || !Number.isInteger(priority) || priority < 0 || priority > 2
      || !['generic', 'shield', 'hull'].includes(impactKind) || !validVector(impactNormal)
      || (impactOffset !== null && (!validVector(impactOffset) || !target))
      || (target !== null && !validEntity(target))) {
      throw new TypeError('Invalid weapon shot');
    }
    const from = resolveWeaponMuzzle(source, muzzleOffset);
    const duration = flightSeconds ?? profile.flightSeconds;
    if (!Number.isFinite(duration) || (profile.mode === 'beam' ? duration !== 0 : duration < 0.05 || duration > 5)) {
      throw new RangeError('Invalid visual weapon flight time');
    }
    const to = aimPoint.clone();
    const direction = new Vector3(1, 0, 0).applyQuaternion(source.quaternion);
    const distance = from.distanceTo(to);
    const controlA = from.clone().addScaledVector(direction, distance * 0.35)
      .addScaledVector(sourceVelocity, duration * 0.2);
    const controlB = to.clone().lerp(controlA, 0.25);
    const targetOffset = target
      ? impactOffset?.clone() || to.clone().sub(target.position).applyQuaternion(target.quaternion.clone().invert()).divideScalar(target.scale)
      : null;
    return this._retain({
      kind, profile, source, target, targetOffset, muzzleOffset: muzzleOffset.clone(),
      from, to, controlA, controlB, time, flightSeconds: duration,
      lifetime: duration + profile.duration, impact,
      impactKind, impactNormal: impactNormal.clone().normalize(), priority,
    });
  }

  firePresentation(kind, source, { time, offset = new Vector3(), priority = 1,
    velocity = new Vector3(), fragments = true, size = 1, duration = null } = {}) {
    if (!['fire', 'explosion', 'debris'].includes(kind) || !validEntity(source) || !validVector(offset)
      || !validVector(velocity)
      || typeof fragments !== 'boolean'
      || !Number.isFinite(size) || size <= 0 || size > 4
      || (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > 6))
      || !Number.isFinite(time) || !Number.isInteger(priority) || priority < 0 || priority > 2) {
      throw new TypeError('Invalid QA damage presentation');
    }
    const from = resolveWeaponMuzzle(source, offset);
    return this._retain({ presentation: kind, source, muzzleOffset: offset.clone(),
      from, to: from.clone(), scale: source.scale, velocity: velocity.clone(), time,
      lifetime: duration ?? (kind === 'fire' ? 0.8 : kind === 'debris' ? 6 : 1.8),
      priority, replay: true, fragments, size });
  }

  sample(effect, time) {
    if (!Number.isFinite(time)) throw new TypeError('Invalid weapon sample time');
    const age = time - effect.time;
    if (age < 0 || age >= effect.lifetime) return [];
    if (effect.presentation) {
      if (effect.presentation === 'debris') {
        const fade = (1 - age / effect.lifetime) ** 2;
        const center = effect.from.clone().addScaledVector(effect.velocity, age);
        const primitives = [];
        for (let index = 0; index < 6; index++) {
          const angle = index * 2.39996;
          const direction = new Vector3(Math.cos(angle), Math.sin(angle), Math.sin(angle * 1.7));
          const fragment = center.clone().addScaledVector(direction, effect.scale * effect.size * age * (0.3 + index * 0.07));
          if (effect.fragments !== false) {
            primitives.push({ from: fragment, to: fragment, shape: 4 + ((age * 0.3 + index * 0.12) % 1),
              width: (2 + index % 3) * (0.7 + 0.3 * Math.abs(Math.cos(age * 3 + index))) * effect.size,
              color: [0.65, 0.4, 0.22], alpha: fade });
          }
          if (index < 5) {
            const cloud = center.clone().addScaledVector(direction, effect.scale * effect.size * age * 0.18);
            primitives.push({ from: cloud, to: cloud, shape: 3, width: (8 + age * 8) * effect.size,
              color: [0.35, 0.28, 0.22], alpha: fade * 0.6 });
          }
        }
        return primitives;
      }
      const explosion = effect.presentation === 'explosion';
      const center = explosion ? effect.from.clone().addScaledVector(effect.velocity, age)
        : resolveWeaponMuzzle(effect.source, effect.muzzleOffset);
      const fade = 1 - age / effect.lifetime;
      const primitives = [{ from: center, to: center, shape: 1,
        width: (explosion ? 12 + age * 40 : 7 + Math.sin(age * 25) * 2) * effect.size,
        color: [3, explosion ? 1.3 : 0.65, 0.12], alpha: fade }];
      if (explosion) primitives.push({ from: center, to: center, shape: 2,
        width: (14 + age * 70) * effect.size, color: [2, 0.7, 0.2], alpha: fade * 0.7 });
      for (let index = 0; index < (explosion ? 8 : 4); index++) {
        const angle = index * 2.39996;
        const drift = new Vector3(Math.cos(angle), Math.sin(angle), Math.sin(angle * 1.7));
        const end = center.clone().addScaledVector(drift, effect.scale * effect.size * age * (explosion ? 2 : 0.35));
        if (!explosion) end.z += effect.scale * age * 0.7;
        primitives.push({ from: explosion ? center : end, to: end,
          shape: explosion ? 0 : 1, width: (explosion ? 2 : 4 + age * 4) * effect.size,
          color: explosion ? [2.5, 1, 0.2] : [1.3, 0.25, 0.04], alpha: fade * 0.7 });
      }
      return primitives;
    }
    if (!effect.profile) {
      const muzzle = effect.source ? resolveWeaponMuzzle(effect.source, effect.muzzleOffset) : null;
      return [{ from: muzzle || effect.from, to: muzzle || effect.to, shape: effect.flash ? 1 : 0,
        width: effect.width * (effect.charge ? 0.3 + 0.7 * age / effect.lifetime : 1),
        color: effect.color, alpha: effect.charge ? age / effect.lifetime : 1 - age / effect.lifetime }];
    }
    const { profile } = effect;
    const primitives = [];
    const add = (from, to, shape, width, alpha = 1, color = profile.color) => {
      primitives.push({ from, to, shape, width, alpha, color });
    };
    const muzzle = resolveWeaponMuzzle(effect.source, effect.muzzleOffset);
    if (profile.mode === 'beam') {
      const destination = effect.target ? resolveWeaponMuzzle(effect.target, effect.targetOffset) : effect.to;
      add(muzzle, destination, 0, profile.width, 1 - age / profile.duration);
      if (effect.impact && effect.impactKind === 'generic') add(destination, destination, 1, profile.impact, 1 - age / profile.duration);
    } else if (age < effect.flightSeconds) {
      const progress = age / effect.flightSeconds;
      const head = projectilePosition(effect, progress);
      const tail = projectilePosition(effect, progress - profile.trail);
      if (profile.mode === 'missile') {
        for (let index = 0; index < 8; index++) {
          const segmentEnd = progress - profile.trail * index / 8;
          const a = projectilePosition(effect, segmentEnd - profile.trail / 8);
          const b = projectilePosition(effect, segmentEnd);
          add(a, b, 0, profile.width * (1 + index * 0.15), (1 - index / 8) * 0.7);
        }
        const nose = projectilePosition(effect, progress + 0.012);
        add(head, nose, 0, profile.head, 1, [1, 0.9, 0.65]);
      } else {
        add(tail, head, 0, profile.width, 0.75);
        add(head, head, 1, profile.head);
        if (effect.kind === 'photon') add(head, head, 2, profile.head * 1.6, 0.5);
      }
    } else if (effect.impact && effect.impactKind === 'generic') {
      const fade = 1 - (age - effect.flightSeconds) / profile.duration;
      add(effect.to, effect.to, 1, profile.impact * (1.5 - fade * 0.5), fade);
      if (effect.kind === 'missile' || effect.kind === 'railgun' || effect.kind === 'photon') {
        add(effect.to, effect.to, 2, profile.impact * (2 - fade), fade * 0.7);
      }
    }
    if (effect.impact && effect.impactKind !== 'generic' && age >= effect.flightSeconds) {
      const impactAge = age - effect.flightSeconds;
      const fade = 1 - impactAge / profile.duration;
      const contact = effect.target
        ? resolveWeaponMuzzle(effect.target, effect.targetOffset) : effect.to;
      if (effect.impactKind === 'shield') {
        add(contact, contact, 1, 8, fade, [0.4, 1.1, 2.2]);
        add(contact, contact, 2, 10 + impactAge * 55, fade * 0.8, [0.2, 0.65, 1.5]);
      } else {
        add(contact, contact, 1, 7, fade, [2.2, 0.6, 0.12]);
        const normal = effect.impactNormal;
        const tangent = new Vector3(0, 0, 1).cross(normal);
        if (tangent.lengthSq() < 1e-12) tangent.set(1, 0, 0);
        tangent.normalize();
        for (let index = 0; index < 4; index++) {
          const spark = contact.clone().addScaledVector(normal, impactAge * effect.source.scale * 0.5)
            .addScaledVector(tangent, (index - 1.5) * impactAge * effect.source.scale * 0.3);
          add(contact, spark, 0, 1.2, fade, [2, 0.8, 0.15]);
        }
      }
    }
    if (age < 0.12) add(muzzle, muzzle, 1, 6, 1 - age / 0.12);
    return primitives;
  }

  remove(effects) {
    this.effects = this.effects.filter((effect) => !effects.has(effect));
  }

  clear() {
    this.effects.length = 0;
    this.drawnEffects = 0;
  }

  render(pass, device, format, camera, origin, time, width, height, depthEnabled = false, replayTime = null,
    visualBudget = null) {
    if (visualBudget !== null && (!Number.isInteger(visualBudget) || visualBudget < 1 || visualBudget > MAX_PRIMITIVES)) {
      throw new RangeError('Invalid fleet weapon primitive budget');
    }
    const clock = (effect) => effect.replay && replayTime !== null ? replayTime : time;
    this.effects = this.effects.filter((effect) => clock(effect) < effect.time + effect.lifetime);
    this.drawnEffects = 0;
    const stats = this.frameStats = { primitives: 0, budgetDropped: 0, budgetReduced: 0,
      culled: 0, near: 0, middle: 0, far: 0 };
    if (!this.effects.length) return;
    if (this.device !== device || this.format !== format || this.depthEnabled !== depthEnabled) {
      this.dispose();
      this.device = device;
      this.format = format;
      this.depthEnabled = depthEnabled;
      const module = device.createShaderModule({ code: SHADER, label: 'space-weapon-fire' });
      this.pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main', buffers: [{
          arrayStride: 48, stepMode: 'instance',
          attributes: [0, 1, 2].map((shaderLocation) => ({
            shaderLocation, offset: shaderLocation * 16, format: 'float32x4',
          })),
        }] },
        fragment: { module, entryPoint: 'fs_main', targets: [{
          format, blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
          },
        }] },
        primitive: { topology: 'triangle-list' },
        ...(depthEnabled ? { depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' } } : {}),
      });
      this.uniformBuffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.instanceBuffer = device.createBuffer({
        size: this.instances.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.bindGroup = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }] });
    }
    const rotation = camera.matrixWorldInverse.clone().setPosition(0, 0, 0);
    const candidates = this.effects.map((effect, order) => {
      let primitives = this.sample(effect, clock(effect));
      const lod = visualBudget === null ? { tier: 'near', pixels: 0 }
        : weaponVisualLod(effect, primitives, camera, origin, height);
      if (visualBudget !== null) {
        primitives = simplifyWeaponPrimitives(effect, primitives, lod.tier)
          .filter((primitive) => visibleWeaponPrimitive(primitive, camera, origin, width, height));
        if (!primitives.length) stats.culled++;
      }
      return { effect, order, primitives, ...lod };
    });
    if (visualBudget !== null) candidates.sort((a, b) => b.effect.priority - a.effect.priority
      || b.pixels - a.pixels || a.order - b.order);
    for (const candidate of candidates) {
      if (visualBudget !== null && this.drawnEffects + candidate.primitives.length > visualBudget) {
        const remaining = visualBudget - this.drawnEffects;
        const tier = remaining >= 2 ? 'middle' : 'far';
        const reduced = remaining > 0
          ? simplifyWeaponPrimitives(candidate.effect, candidate.primitives, tier) : [];
        if (!reduced.length || reduced.length > remaining) {
          stats.budgetDropped++;
          continue;
        }
        candidate.primitives = reduced;
        candidate.tier = tier;
        stats.budgetReduced++;
      }
      let drawn = false;
      for (const primitive of candidate.primitives) {
        const from = primitive.from.clone().sub(origin).sub(camera.position);
        const to = primitive.to.clone().sub(origin).sub(camera.position);
        // Skip near-plane crossings instead of dividing by zero in the ribbon shader.
        if (from.clone().applyMatrix4(rotation).z >= -camera.near
          || to.clone().applyMatrix4(rotation).z >= -camera.near) continue;
        this.instances.set([...from.toArray(), primitive.shape,
          ...to.toArray(), primitive.width, ...primitive.color, primitive.alpha], this.drawnEffects * 12);
        this.drawnEffects++;
        drawn = true;
      }
      if (drawn) stats[candidate.tier]++;
    }
    stats.primitives = this.drawnEffects;
    if (!this.drawnEffects) return;
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse.clone().setPosition(0, 0, 0));
    device.queue.writeBuffer(this.uniformBuffer, 0,
      new Float32Array([...this.matrix.elements, width, height, 0, 0]));
    device.queue.writeBuffer(this.instanceBuffer, 0, this.instances.buffer, 0, this.drawnEffects * 48);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    pass.draw(6, this.drawnEffects);
  }

  dispose() {
    this.uniformBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.uniformBuffer = null;
    this.instanceBuffer = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.device = null;
  }
}
