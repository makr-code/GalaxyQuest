import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { SPACE_WEAPON_PROFILES, SpaceWeaponRenderPass, resolveWeaponMuzzle } from '../../js/rendering/space-weapon-render-pass.js';

afterEach(() => vi.unstubAllGlobals());

describe('SpaceWeaponRenderPass', () => {
  it('supports bounded class-specific size/duration and detached carrier motion without changing defaults', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1 };
    const velocity = new Vector3(1, 2, 3);
    const base = fx.firePresentation('explosion', source, { time: 0 });
    const large = fx.firePresentation('explosion', source, { time: 0, velocity, size: 1.6, duration: 0.9 });
    velocity.set(100, 100, 100);
    expect(base.lifetime).toBe(1.8);
    expect(fx.sample(large, 0.2)[0].width / fx.sample(base, 0.2)[0].width).toBeCloseTo(1.6);
    expect(fx.sample(large, 0.2)[0].from.toArray()).toEqual([0.2, 0.4, -4.4]);
    expect(fx.sample(large, 0.9)).toEqual([]);
    for (const options of [{ size: 0 }, { size: NaN }, { size: 5 }, { duration: 0 }, { duration: 7 }]) {
      expect(() => fx.firePresentation('explosion', source, { time: 0, ...options })).toThrow(TypeError);
    }
  });
  it('anchors persistent fire but snapshots drifting debris and bounds all damage primitives', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1 };
    const fire = fx.firePresentation('fire', source, { time: 0 });
    const velocity = new Vector3(1, 0, 0);
    const debris = fx.firePresentation('debris', source, { time: 0, velocity });
    const explosion = fx.firePresentation('explosion', source, { time: 0 });
    velocity.x = 100;
    source.position.x = 10;
    expect(fx.sample(fire, 0.2)[0].from.x).toBe(10);
    expect(fx.sample(explosion, 0.2)[0].from.x).toBe(0);
    expect(debris.velocity.x).toBe(1);
    const sample = fx.sample(debris, 1);
    expect(sample.filter(p => p.shape >= 4)).toHaveLength(6);
    expect(sample.filter(p => p.shape === 3)).toHaveLength(5);
    expect(sample[0].from.x).toBeCloseTo(1.3);
    for (const effect of [fire, debris, explosion]) {
      expect(fx.sample(effect, 0.2).length).toBeLessThanOrEqual(12);
      expect(fx.sample(effect, effect.lifetime)).toEqual([]);
    }
    expect(() => fx.firePresentation('damage', source, { time: 0 })).toThrow(TypeError);
  });
  it('uses an explicit local impact anchor instead of adding predicted target travel twice', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(), quaternion: new Quaternion(), scale: 2 };
    const target = { position: new Vector3(10, 0, 0), quaternion: new Quaternion(), scale: 2 };
    const offset = new Vector3(0.5, 0, 0);
    const shot = fx.fireWeapon('photon', source, new Vector3(11, 8, 0), {
      time: 0, target, impact: true, impactKind: 'shield', impactOffset: offset,
    });
    offset.y = 100;
    target.position.y = 8;
    target.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    expect(shot.targetOffset.toArray()).toEqual([0.5, 0, 0]);
    const impact = fx.sample(shot, shot.flightSeconds + 0.1)[0];
    expect(impact.from.x).toBeCloseTo(10);
    expect(impact.from.y).toBeCloseTo(9);
  });
  it('keeps charge-up on a moving hardpoint and grows its width and intensity', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(), quaternion: new Quaternion(), scale: 2 };
    const charge = fx.fire(new Vector3(), new Vector3(), {
      time: 0, lifetime: 0.2, charge: true, flash: true, source, width: 10,
    });
    const early = fx.sample(charge, 0.05)[0];
    source.position.y = 4;
    source.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const late = fx.sample(charge, 0.15)[0];
    expect(late.from.y).toBeCloseTo(5);
    expect(late.to.equals(late.from)).toBe(true);
    expect(late.width).toBeGreaterThan(early.width);
    expect(late.alpha).toBeGreaterThan(early.alpha);
    expect(fx.sample(charge, 0.2)).toEqual([]);
  });
  it('keeps ordinary wall-clock effects separate from replay-local effects', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, VERTEX: 2, COPY_DST: 4 });
    const device = { createShaderModule: () => ({}),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBuffer: () => ({ destroy() {} }), createBindGroup: () => ({}), queue: { writeBuffer() {} } };
    const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw: vi.fn() };
    const camera = new PerspectiveCamera(60, 2, 0.1, 100);
    camera.updateMatrixWorld(true);
    const fx = new SpaceWeaponRenderPass();
    const point = new Vector3(0, 0, -5);
    fx.fire(point, point, { time: 100, flash: true });
    const replay = fx.fire(point, point, { time: 0, flash: true });
    replay.replay = true;
    fx.render(pass, device, 'rgba16float', camera, new Vector3(), 100.1, 800, 400, false, 0.1);
    expect(fx.effects).toHaveLength(2);
    expect(fx.drawnEffects).toBe(2);
    fx.render(pass, device, 'rgba16float', camera, new Vector3(), 100.2, 800, 400, false, 0.4);
    expect(fx.effects).toHaveLength(1);
    expect(fx.effects).not.toContain(replay);
    fx.dispose();
  });
  it('validates and copies world-space endpoints and enforces the 64-effect budget', () => {
    const fx = new SpaceWeaponRenderPass();
    const from = new Vector3(1, 2, 3);
    const to = new Vector3(4, 5, 6);
    const effect = fx.fire(from, to, { time: 0 });
    from.set(0, 0, 0);
    expect(effect.from.toArray()).toEqual([1, 2, 3]);
    expect(() => fx.fire(from, to, { time: NaN })).toThrow(TypeError);
    expect(() => fx.fire(from, to, { time: 0, lifetime: 3 })).toThrow(TypeError);
    for (let index = 0; index < 100; index++) fx.fire(from, to, { time: 0 });
    expect(fx.effects).toHaveLength(64);
    expect(fx.effects).not.toContain(effect);
    const retained = fx.effects[0];
    fx.remove(new Set([fx.effects[1]]));
    expect(fx.effects).toHaveLength(63);
    expect(fx.effects).toContain(retained);
  });

  it('draws one instanced batch, culls near-plane crossings, expires and releases buffers', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, VERTEX: 2, COPY_DST: 4 });
    const buffers = [];
    const device = {
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
      createBuffer: vi.fn(() => { const buffer = { destroy: vi.fn() }; buffers.push(buffer); return buffer; }),
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() },
    };
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn() };
    const camera = new PerspectiveCamera(60, 2, 0.1, 100);
    camera.updateMatrixWorld(true);
    const origin = new Vector3(1000, 0, 0);
    const from = new Vector3(999, 0, -5);
    const to = new Vector3(1001, 0, -5);
    const fx = new SpaceWeaponRenderPass();
    fx.fire(from, to, { time: 0 });
    fx.fire(to, to, { time: 0, flash: true });
    fx.fire(from, new Vector3(1000, 0, 1), { time: 0 });
    fx.render(pass, device, 'rgba16float', camera, origin, 0.1, 800, 400);
    expect(pass.draw).toHaveBeenCalledWith(6, 2);
    expect(fx.instances[0]).toBe(-1);
    expect(fx.instances[2]).toBe(-5);
    expect(fx.instances[15]).toBe(1);
    expect(device.createRenderPipeline.mock.calls[0][0].fragment.targets[0].format).toBe('rgba16float');
    fx.render(pass, device, 'rgba16float', camera, origin, 0.2, 800, 400);
    expect(device.createRenderPipeline).toHaveBeenCalledOnce();
    fx.render(pass, device, 'rgba16float', camera, origin, 1, 800, 400);
    expect(fx.effects).toHaveLength(0);
    expect(fx.drawnEffects).toBe(0);
    const source = { position: from.clone(), quaternion: new Quaternion(), scale: 0.01 };
    for (let index = 0; index < 100; index++) {
      fx.fireWeapon('missile', source, to, { time: 1, impact: true });
    }
    fx.render(pass, device, 'rgba16float', camera, origin, 1.05, 800, 400);
    expect(fx.effects).toHaveLength(64);
    expect(fx.drawnEffects).toBe(640);
    expect(pass.draw).toHaveBeenLastCalledWith(6, 640);
    expect(fx.instances.length).toBeGreaterThanOrEqual(fx.drawnEffects * 12);
    fx.dispose();
    fx.dispose();
    expect(buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('transforms a local hardpoint with scale, rotation and translation in light-year coordinates', () => {
    const source = { position: new Vector3(1e-7, 2e-7, 3e-7), scale: 1e-9,
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2) };
    const offset = new Vector3(0.5, 0, 0);
    const muzzle = resolveWeaponMuzzle(source, offset);
    expect(muzzle.x).toBeCloseTo(1e-7, 18);
    expect(muzzle.y).toBeCloseTo(2e-7 + 0.5e-9, 18);
    expect(offset.toArray()).toEqual([0.5, 0, 0]);
    expect(() => resolveWeaponMuzzle({}, offset)).toThrow(TypeError);
  });

  it('keeps beams attached to moving source and explicit target, but freezes ballistic launch points', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(), quaternion: new Quaternion(), scale: 2 };
    const target = { position: new Vector3(10, 0, 0), quaternion: new Quaternion(), scale: 2 };
    const beam = fx.fireWeapon('laser', source, target.position, { time: 0, target, impact: true });
    const slug = fx.fireWeapon('ballistic', source, target.position, { time: 0 });
    const launch = slug.from.clone();
    const end = slug.to.clone();
    source.position.y = 2;
    target.position.y = 4;
    const beamSample = fx.sample(beam, 0.13);
    expect(beamSample[0].from.toArray()).toEqual([1, 2, 0]);
    expect(beamSample[0].to.toArray()).toEqual([10, 4, 0]);
    expect(slug.from.equals(launch)).toBe(true);
    expect(slug.to.equals(end)).toBe(true);
    const midpoint = fx.sample(slug, slug.flightSeconds / 2).find((primitive) => primitive.shape === 1);
    expect(midpoint.from.toArray()).toEqual([5.5, 0, 0]);
    expect(fx.sample(slug, -0.1)).toEqual([]);
  });

  it.each(Object.keys(SPACE_WEAPON_PROFILES))('%s uses bounded geometry and only explicitly requested impact cues', (kind) => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(), quaternion: new Quaternion(), scale: 1 };
    const to = new Vector3(10, 2, 0);
    const shot = fx.fireWeapon(kind, source, to, { time: 0, impact: true });
    to.set(100, 100, 100);
    const inFlight = fx.sample(shot, shot.flightSeconds ? shot.flightSeconds * 0.5 : 0.05);
    expect(inFlight.length).toBeLessThanOrEqual(12);
    expect(inFlight.every((primitive) => [...primitive.from.toArray(), ...primitive.to.toArray(),
      primitive.alpha, primitive.width].every(Number.isFinite))).toBe(true);
    if (shot.flightSeconds) {
      const impact = fx.sample(shot, shot.flightSeconds + 0.05);
      expect(impact[0].from.toArray()).toEqual([10, 2, 0]);
      const miss = fx.fireWeapon(kind, source, new Vector3(10, 2, 0), { time: 0 });
      expect(fx.sample(miss, miss.flightSeconds + 0.05)).toEqual([]);
    }
    expect(fx.sample(shot, shot.lifetime)).toEqual([]);
  });

  it('missile paths preserve launch heading and inherited velocity, reach the supplied endpoint and leave a curved trail', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(), quaternion: new Quaternion(), scale: 1 };
    const aim = new Vector3(10, 0, 0);
    const normal = fx.fireWeapon('missile', source, aim, { time: 0 });
    const moving = fx.fireWeapon('missile', source, aim, { time: 0, sourceVelocity: new Vector3(0, 3, 0), impact: true });
    expect(moving.controlA.y).toBeGreaterThan(normal.controlA.y);
    const midway = fx.sample(moving, 1);
    expect(midway).toHaveLength(9);
    expect(midway[8].from.y).toBeGreaterThan(0);
    expect(fx.sample(moving, 2)[0].from.equals(aim)).toBe(true);
    expect(fx.sample(moving, 0.05).length).toBeLessThanOrEqual(12);
  });

  it('hides future shots and distinguishes photon halos, missile trails and delayed misses', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(), quaternion: new Quaternion(), scale: 1 };
    const aim = new Vector3(10, 0, 0);
    const photon = fx.fireWeapon('photon', source, aim, { time: 10 });
    const slug = fx.fireWeapon('ballistic', source, aim, { time: 10 });
    const missile = fx.fireWeapon('missile', source, aim, { time: 10 });
    expect(fx.sample(photon, 9)).toEqual([]);
    expect(fx.sample(photon, 10.2).some((primitive) => primitive.shape === 2)).toBe(true);
    expect(fx.sample(slug, 10.2).some((primitive) => primitive.shape === 2)).toBe(false);
    expect(fx.sample(missile, 10.2).filter((primitive) => primitive.shape === 0)).toHaveLength(9);
    expect(fx.sample(missile, 12.1)).toEqual([]);
  });

  it('rejects unknown styles, invalid speeds, malformed motion and synthetic impact flags', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(), quaternion: new Quaternion(), scale: 1 };
    const aim = new Vector3(10, 0, 0);
    expect(() => fx.fireWeapon('unknown', source, aim)).toThrow(TypeError);
    expect(() => fx.fireWeapon('missile', source, aim, { flightSeconds: 10 })).toThrow(RangeError);
    expect(() => fx.fireWeapon('laser', source, aim, { flightSeconds: 1 })).toThrow(RangeError);
    expect(() => fx.fireWeapon('photon', source, aim, { sourceVelocity: new Vector3(NaN, 0, 0) })).toThrow(TypeError);
    expect(() => fx.fireWeapon('plasma', source, aim, { impact: 'yes' })).toThrow(TypeError);
    expect(() => fx.sample(fx.fireWeapon('photon', source, aim), NaN)).toThrow(TypeError);
  });
});
