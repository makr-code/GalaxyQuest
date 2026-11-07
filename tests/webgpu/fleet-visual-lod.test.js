import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { fleetVisualLod, simplifyWeaponPrimitives, visibleWeaponPrimitive } from '../../js/rendering/fleet-visual-lod.js';
import { SpaceWeaponRenderPass } from '../../js/rendering/space-weapon-render-pass.js';
import { SpaceVesselRenderPass } from '../../js/rendering/space-vessel-render-pass.js';

afterEach(() => vi.unstubAllGlobals());

function gpuFixture() {
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, VERTEX: 2, COPY_DST: 4 });
  const device = { createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createBindGroup: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() } };
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn() };
  const camera = new PerspectiveCamera(60, 1, 0.1, 10000);
  camera.updateMatrixWorld(true);
  return { device, pass, camera };
}

describe('screen-space fleet LOD', () => {
  it('uses measurable backing-pixel tiers and hysteresis rather than absolute world distance', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 10000);
    for (const [z, tier] of [[-50, 'near'], [-150, 'middle'], [-500, 'far'], [-3000, 'hidden']]) {
      expect(fleetVisualLod(new Vector3(0, 0, z), 1, camera, new Vector3(), 1000).tier).toBe(tier);
    }
    const point = new Vector3(0, 0, -Math.sqrt(3) * 1000 / 22);
    expect(fleetVisualLod(point, 1, camera, new Vector3(), 1000).tier).toBe('middle');
    expect(fleetVisualLod(point, 1, camera, new Vector3(), 1000, 'near').tier).toBe('near');
    expect(fleetVisualLod(new Vector3(1e6, 0, -50), 1, camera, new Vector3(), 1000).tier).toBe('hidden');
    expect(fleetVisualLod(new Vector3(0, 0, 50), 1, camera, new Vector3(), 1000).tier).toBe('hidden');
    const origin = new Vector3(15000, 9000, 90);
    expect(fleetVisualLod(origin.clone().add(new Vector3(0, 0, -50)), 1, camera, origin, 1000).tier).toBe('near');
  });

  it('preserves a beam crossing the viewport even when both endpoints are offscreen', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    const beam = { from: new Vector3(-10, 0, -5), to: new Vector3(10, 0, -5), width: 2 };
    expect(visibleWeaponPrimitive(beam, camera, new Vector3(), 1000, 1000)).toBe(true);
    beam.from.y = beam.to.y = 10;
    expect(visibleWeaponPrimitive(beam, camera, new Vector3(), 1000, 1000)).toBe(false);
    beam.from.z = 1;
    expect(visibleWeaponPrimitive(beam, camera, new Vector3(), 1000, 1000)).toBe(false);
  });

  it('reduces missile trails without changing their endpoints or inventing hits', () => {
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1 };
    const shot = fx.fireWeapon('missile', source, new Vector3(4, 0, -5), { time: 0 });
    const full = fx.sample(shot, 1);
    const middle = simplifyWeaponPrimitives(shot, full, 'middle');
    const far = simplifyWeaponPrimitives(shot, full, 'far');
    expect(full).toHaveLength(9);
    expect(middle).toHaveLength(2);
    expect(middle[0].from.equals(full[7].from)).toBe(true);
    expect(middle[0].to.equals(full[0].to)).toBe(true);
    expect(far).toEqual([full[8]]);
    expect(simplifyWeaponPrimitives(shot, fx.sample(shot, 2.1), 'far')).toEqual([]);
    expect(simplifyWeaponPrimitives({ charge: true }, full, 'middle')).toEqual([]);
  });
});

describe('fleet effect budgets', () => {
  it('keeps priority effects under queue pressure while preserving FIFO for equal priorities', () => {
    const fx = new SpaceWeaponRenderPass();
    const point = new Vector3(0, 0, -5);
    const important = fx.fire(point, point, { time: 0, priority: 2 });
    for (let index = 0; index < 100; index++) fx.fire(point, point, { time: 0 });
    expect(fx.effects).toHaveLength(64);
    expect(fx.effects).toContain(important);
    expect(fx.evictedEffects).toBe(37);
    fx.clear();
    for (let index = 0; index < 64; index++) fx.fire(point, point, { time: 0, priority: 2 });
    const rejected = fx.fire(point, point, { time: 0, priority: 0 });
    expect(fx.effects).not.toContain(rejected);
    expect(fx.rejectedEffects).toBe(1);
    expect(() => fx.fire(point, point, { priority: 3 })).toThrow(TypeError);
  });

  it('enforces the exact primitive cap and draws high-priority cues before closer low-priority cues', () => {
    const { device, pass, camera } = gpuFixture();
    const fx = new SpaceWeaponRenderPass();
    const near = { position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1 };
    const distant = { position: new Vector3(0, 0, -50), quaternion: new Quaternion(), scale: 1 };
    const low = fx.fireWeapon('laser', near, new Vector3(1, 0, -5), { time: 0 });
    const high = fx.fireWeapon('laser', distant, new Vector3(1, 0, -50), { time: 0, priority: 2 });
    fx.render(pass, device, 'rgba16float', camera, new Vector3(), 0.13, 1000, 1000, false, null, 1);
    expect(pass.draw).toHaveBeenCalledWith(6, 1);
    expect(fx.instances[2]).toBe(-50);
    expect(fx.frameStats.budgetDropped).toBe(1);
    expect(fx.effects).toContain(low);
    expect(fx.effects).toContain(high);
    expect(() => fx.render(pass, device, 'rgba16float', camera, new Vector3(),
      0.13, 1000, 1000, false, null, 769)).toThrow(RangeError);
    fx.dispose();
  });

  it('reduces a full retained salvo without exceeding the requested cap or adding draw calls', () => {
    const { device, pass, camera } = gpuFixture();
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1 };
    for (let index = 0; index < 64; index++) {
      fx.fireWeapon('missile', source, new Vector3(1, 0, -5), { time: 0 });
    }
    fx.render(pass, device, 'rgba16float', camera, new Vector3(), 0.05, 1000, 1000, false, null, 60);
    expect(fx.drawnEffects).toBe(60);
    expect(fx.frameStats.budgetDropped).toBe(58);
    expect(pass.draw).toHaveBeenCalledOnce();
    expect(fx.effects).toHaveLength(64);
    fx.dispose();
  });

  it('degrades an important missile to one nose cue rather than replacing it with a cheap low-priority shot', () => {
    const { device, pass, camera } = gpuFixture();
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(0, 0, -5), quaternion: new Quaternion(), scale: 1 };
    fx.fireWeapon('laser', source, new Vector3(1, 0, -5), { time: 0 });
    const missile = fx.fireWeapon('missile', source, new Vector3(1, 0, -5), { time: 0, priority: 2 });
    const nose = fx.sample(missile, 0.1)[8];
    fx.render(pass, device, 'rgba16float', camera, new Vector3(), 0.1, 1000, 1000, false, null, 1);
    expect(fx.drawnEffects).toBe(1);
    expect(fx.instances[0]).toBeCloseTo(nose.from.x);
    expect(fx.frameStats.budgetReduced).toBe(1);
    expect(fx.frameStats.budgetDropped).toBe(1);
    fx.dispose();
  });

  it('culls offscreen shots but does not erase their retained lifecycle', () => {
    const { device, pass, camera } = gpuFixture();
    const fx = new SpaceWeaponRenderPass();
    const source = { position: new Vector3(100, 0, -5), quaternion: new Quaternion(), scale: 1 };
    fx.fireWeapon('laser', source, new Vector3(110, 0, -5), { time: 0 });
    fx.render(pass, device, 'rgba16float', camera, new Vector3(), 0.13, 1000, 1000, false, null, 256);
    expect(pass.draw).not.toHaveBeenCalled();
    expect(fx.frameStats.culled).toBe(1);
    expect(fx.effects).toHaveLength(1);
    fx.render(pass, device, 'rgba16float', camera, new Vector3(), 1, 1000, 1000, false, null, 256);
    expect(fx.effects).toHaveLength(0);
    fx.dispose();
  });
});

describe('vessel geometry LOD', () => {
  it('renders a strength-driven blue shield without a hit at near/middle LOD and suppresses depleted/far shields', async () => {
    const { device, pass, camera } = gpuFixture();
    const renderer = new SpaceVesselRenderPass();
    const ship = { id: 'shield-qa', kind: 'vessel', modelUrl: 'procedural:hero-carrier',
      position: new Vector3(0, 0, -50), quaternion: new Quaternion(), scale: 1,
      color: [1, 1, 1, 1], engineEffects: false, heroStatus: { shield: 1 }, heroLight: { shield: 0 } };
    await renderer.load(ship);
    renderer.initialize(device, 'rgba16float');
    renderer.render(pass, [ship], camera, new Vector3(), 0, true, 1000);
    expect(renderer.frameStats.shields).toBe(1);
    expect(renderer.resources.get(ship.id).visualTier).toBe('near');
    const uploaded = device.queue.writeBuffer.mock.calls.filter(call => call[2] instanceof Float32Array).at(-1)[2];
    expect(uploaded.length).toBe(56);
    expect(uploaded[45]).toBe(0);
    expect(uploaded[47]).toBe(1);
    expect(uploaded[52]).toBe(1);
    const pipeline = device.createRenderPipeline.mock.calls.find(([descriptor]) => descriptor.depthStencil?.depthWriteEnabled === false)[0];
    expect(pipeline.fragment.targets[0].blend.color.dstFactor).toBe('one');
    const shader = device.createShaderModule.mock.calls.find(([descriptor]) => descriptor.label === 'space-vessel-mesh')[0].code;
    expect(shader).toContain('uniforms.shield.x');
    ship.position.z = -150;
    ship.heroStatus.shield = 0.5;
    renderer.render(pass, [ship], camera, new Vector3(), 1, true, 1000);
    expect(renderer.frameStats.middle).toBe(1);
    expect(renderer.frameStats.shields).toBe(1);
    ship.heroStatus.shield = 0;
    ship.heroLight.shield = 0.6;
    renderer.render(pass, [ship], camera, new Vector3(), 2, true, 1000);
    expect(renderer.frameStats.shields).toBe(0);
    ship.heroStatus.shield = 1;
    ship.position.z = -500;
    renderer.render(pass, [ship], camera, new Vector3(), 3, true, 1000);
    expect(renderer.frameStats.far).toBe(1);
    expect(renderer.frameStats.shields).toBe(0);
    ship.position.z = -50;
    renderer.render(pass, [ship], camera, new Vector3(), 4, false, 1000);
    expect(renderer.frameStats.shields).toBe(0);
    renderer.dispose();
  });
  it('renders full, hull-only and 12-triangle proxy tiers and releases their shared buffers', async () => {
    const { device, pass, camera } = gpuFixture();
    const renderer = new SpaceVesselRenderPass();
    renderer.initialize(device, 'rgba16float');
    const vessel = { id: 'qa', modelUrl: 'procedural:hero-frigate', kind: 'vessel', engineEffects: false,
      position: new Vector3(0, 0, -50), quaternion: new Quaternion(), turretQuaternion: new Quaternion(),
      scale: 1, color: [1, 1, 1, 1] };
    const resource = await renderer.load(vessel);
    renderer.render(pass, [vessel], camera, new Vector3(), 0, true, 1000);
    expect(renderer.frameStats.near).toBe(1);
    expect(renderer.frameStats.drawCalls).toBe(2);
    vessel.position.z = -150;
    renderer.render(pass, [vessel], camera, new Vector3(), 0, true, 1000);
    expect(renderer.frameStats.middle).toBe(1);
    expect(renderer.frameStats.drawCalls).toBe(1);
    vessel.position.z = -500;
    renderer.render(pass, [vessel], camera, new Vector3(), 0, true, 1000);
    expect(renderer.frameStats.far).toBe(1);
    expect(renderer.frameStats.vertices).toBe(36);
    expect(resource.asset.lodBuffer).toBeTruthy();
    vessel.position.z = -3000;
    renderer.render(pass, [vessel], camera, new Vector3(), 0, true, 1000);
    expect(renderer.frameStats.hidden).toBe(1);
    expect(renderer.frameStats.drawCalls).toBe(0);
    renderer.dispose();
    expect(device.createBuffer.mock.results.every(({ value }) => value.destroy.mock.calls.length === 1)).toBe(true);
  });
});
