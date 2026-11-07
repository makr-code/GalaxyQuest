import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { HeroDebrisRenderPass } from '../../js/rendering/hero-debris-render-pass.js';

afterEach(() => vi.unstubAllGlobals());

function source() {
  return { position: new Vector3(0, 0, -10), quaternion: new Quaternion(), scale: 1 };
}

function fixture() {
  vi.stubGlobal('GPUBufferUsage', { VERTEX: 1, UNIFORM: 2, COPY_DST: 4 });
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createBindGroup: vi.fn(() => ({})), queue: { writeBuffer: vi.fn() },
  };
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn() };
  const camera = new PerspectiveCamera(60, 1, 0.1, 10000);
  camera.updateMatrixWorld(true);
  return { device, pass, camera };
}

describe('hero mesh debris', () => {
  it('uses three larger, slower cruiser wreck sections without increasing the instance budget', () => {
    const renderer = new HeroDebrisRenderPass();
    const ship = source();
    const velocity = new Vector3(2, 3, 4);
    const frigate = renderer.spawn(ship, { time: 0, seed: 42, velocity });
    const cruiser = renderer.spawn(ship, { time: 0, seed: 42, velocity, shipClass: 'cruiser' });
    expect(cruiser.fragments).toHaveLength(12);
    expect(cruiser.fragments.filter(fragment => fragment.major)).toHaveLength(3);
    for (let index = 0; index < 12; index++) {
      const a = frigate.fragments[index], b = cruiser.fragments[index];
      expect(b.size.x / a.size.x).toBeCloseTo(index < 3 ? 3 : 1);
      expect(b.spin / a.spin).toBeCloseTo(index < 3 ? 0.2 : 1);
      expect(b.velocity.clone().sub(velocity).length() / a.velocity.clone().sub(velocity).length())
        .toBeCloseTo(index < 3 ? 0.35 : 1);
    }
    expect(() => renderer.spawn(ship, { time: 0, seed: 42, shipClass: 'invalid' })).toThrow(TypeError);
    renderer.dispose();
  });
  it('snapshots hull pose and carrier velocity with seeded ballistic dispersal and analytic rotation', () => {
    const renderer = new HeroDebrisRenderPass();
    const ship = source();
    ship.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 3);
    const velocity = new Vector3(1, 2, 3);
    const burst = renderer.spawn(ship, { time: 4, seed: 42, velocity });
    const twin = new HeroDebrisRenderPass();
    const identical = twin.spawn(ship, { time: 4, seed: 42, velocity });
    expect(burst).toEqual(identical);
    const zero = renderer.sample(burst, 4);
    const later = renderer.sample(burst, 5);
    expect(later).toHaveLength(12);
    expect(later[0].position.clone().sub(zero[0].position).distanceTo(burst.fragments[0].velocity)).toBeLessThan(1e-12);
    expect(later[0].quaternion.angleTo(zero[0].quaternion)).toBeGreaterThan(0.6);
    expect(later[0].heat).toBeLessThan(zero[0].heat);
    const saved = renderer.sample(burst, 5);
    ship.position.set(1000, 1000, 1000);
    ship.quaternion.identity();
    ship.scale = 100;
    velocity.set(100, 100, 100);
    expect(renderer.sample(burst, 5)).toEqual(saved);
    expect(renderer.sample(burst, 3.99)).toEqual([]);
    expect(renderer.sample(burst, 10)).toEqual([]);
    expect(renderer.sample(burst, 9.5)[0].fade).toBeCloseTo(1 / 3);
    expect(() => renderer.sample(burst, NaN)).toThrow(TypeError);
    renderer.dispose();
    twin.dispose();
  });

  it('keeps at most 16 bursts, evicts oldest under pressure and purges expired bursts at spawn', () => {
    const renderer = new HeroDebrisRenderPass();
    const first = renderer.spawn(source(), { time: 0, seed: 0 });
    for (let seed = 1; seed < 40; seed++) renderer.spawn(source(), { time: 0, seed });
    expect(renderer.bursts).toHaveLength(16);
    expect(renderer.bursts).not.toContain(first);
    expect(renderer.evictedBursts).toBe(24);
    renderer.spawn(source(), { time: 6, seed: 42 });
    expect(renderer.bursts).toHaveLength(1);
    expect(() => renderer.spawn(source(), { time: 0, seed: -1 })).toThrow(TypeError);
    expect(() => renderer.spawn({ ...source(), scale: 0 }, { time: 0, seed: 0 })).toThrow(TypeError);
    renderer.dispose();
    expect(() => renderer.spawn(source(), { time: 0, seed: 0 })).toThrow('disposed');
  });

  it('draws 192 actual mesh instances in one opaque depth-writing batch and releases all resources', () => {
    const { device, pass, camera } = fixture();
    const renderer = new HeroDebrisRenderPass();
    for (let seed = 0; seed < 16; seed++) renderer.spawn(source(), { time: 0, seed });
    renderer.render(pass, device, 'rgba16float', camera, new Vector3(), 0.1, 1080);
    expect(renderer.stats.instances).toBe(192);
    expect(renderer.stats.vertices).toBe(6912);
    expect(renderer.stats.drawCalls).toBe(1);
    expect(pass.draw).toHaveBeenCalledWith(36, 192);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(1, renderer.instanceBuffer);
    const pipeline = device.createRenderPipeline.mock.calls[0][0];
    expect(pipeline.depthStencil.depthWriteEnabled).toBe(true);
    expect(pipeline.depthStencil.depthCompare).toBe('less-equal');
    expect(pipeline.fragment.targets[0].blend).toBeUndefined();
    expect(pipeline.vertex.buffers[1].stepMode).toBe('instance');
    expect(device.queue.writeBuffer.mock.calls.at(-1)[4]).toBe(192 * 64);
    expect(renderer.instances.every(Number.isFinite)).toBe(true);
    renderer.render(pass, device, 'rgba16float', camera, new Vector3(), 6, 1080);
    expect(renderer.stats.instances).toBe(0);
    expect(renderer.bursts).toHaveLength(0);
    expect(renderer.peakInstances).toBe(192);
    renderer.dispose();
    renderer.dispose();
    expect(device.createBuffer.mock.results.every(({ value }) => value.destroy.mock.calls.length === 1)).toBe(true);
    expect(() => renderer.render(pass, device, 'rgba16float', camera, new Vector3(), 6, 1080)).toThrow('disposed');
  });

  it('culls subpixel and offscreen fragments without allocating GPU buffers', () => {
    const { device, pass, camera } = fixture();
    const renderer = new HeroDebrisRenderPass();
    renderer.spawn({ ...source(), position: new Vector3(100, 0, -10) }, { time: 0, seed: 42 });
    renderer.spawn({ ...source(), scale: 1e-5 }, { time: 0, seed: 42 });
    renderer.render(pass, device, 'rgba16float', camera, new Vector3(), 0.1, 1080);
    expect(renderer.stats.culled).toBe(24);
    expect(renderer.stats.instances).toBe(0);
    expect(device.createBuffer).not.toHaveBeenCalled();
    expect(renderer.bursts).toHaveLength(2);
    renderer.dispose();
  });

  it('retries partial GPU initialization without leaking previously allocated buffers', () => {
    const { device, pass, camera } = fixture();
    const renderer = new HeroDebrisRenderPass();
    renderer.spawn(source(), { time: 0, seed: 42 });
    const allocation = device.createBuffer.getMockImplementation();
    device.createBuffer.mockImplementationOnce(allocation).mockImplementationOnce(() => { throw new Error('allocation failed'); });
    expect(() => renderer.render(pass, device, 'rgba16float', camera, new Vector3(), 0.1, 1080))
      .toThrow('allocation failed');
    const first = device.createBuffer.mock.results[0].value;
    renderer.render(pass, device, 'rgba16float', camera, new Vector3(), 0.1, 1080);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(renderer.stats.instances).toBe(12);
    renderer.dispose();
    expect(device.createBuffer.mock.results.filter(result => result.type === 'return')
      .every(({ value }) => value.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('attempts every buffer cleanup and surfaces failures explicitly', () => {
    const { device, pass, camera } = fixture();
    const renderer = new HeroDebrisRenderPass();
    renderer.spawn(source(), { time: 0, seed: 42 });
    renderer.render(pass, device, 'rgba16float', camera, new Vector3(), 0.1, 1080);
    device.createBuffer.mock.results[0].value.destroy.mockImplementation(() => { throw new Error('destroy failed'); });
    expect(() => renderer.dispose()).toThrow(AggregateError);
    expect(device.createBuffer.mock.results.every(({ value }) => value.destroy.mock.calls.length === 1)).toBe(true);
    expect(renderer.bursts).toHaveLength(0);
    renderer.dispose();
  });

  it('subtracts origin/camera in doubles before upload and preserves bursts across GPU format changes', () => {
    const { device, pass, camera } = fixture();
    const renderer = new HeroDebrisRenderPass();
    const origin = new Vector3(15000, 9000, 90);
    const ship = { position: origin.clone().add(new Vector3(0, 0, -1e-6)), quaternion: new Quaternion(), scale: 1e-7 };
    camera.near = 1e-9;
    camera.updateProjectionMatrix();
    const burst = renderer.spawn(ship, { time: 0, seed: 42 });
    renderer.render(pass, device, 'rgba16float', camera, origin, 0, 1080);
    const expected = renderer.sample(burst, 0)[0].position.sub(origin);
    expect(renderer.instances[0]).toBeCloseTo(expected.x, 12);
    expect(renderer.instances[2]).toBeCloseTo(expected.z, 12);
    const oldBuffers = device.createBuffer.mock.results.map(({ value }) => value);
    renderer.render(pass, device, 'rgba8unorm', camera, origin, 0, 1080);
    expect(renderer.bursts).toContain(burst);
    expect(oldBuffers.every(buffer => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(2);
    renderer.dispose();
    expect(device.createBuffer.mock.results.every(({ value }) => value.destroy.mock.calls.length === 1)).toBe(true);
  });
});
