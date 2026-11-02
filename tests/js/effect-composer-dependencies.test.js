import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EffectComposer } = require('../../js/engine/post-effects/EffectComposer.js');
const { BloomPass } = require('../../js/engine/post-effects/passes/BloomPass.js');
const { VignettePass } = require('../../js/engine/post-effects/passes/VignettePass.js');
const { WebGPUResourcePool } = require('../../js/engine/webgpu/WebGPUResourcePool.js');

function renderer() {
  return { createTexture: vi.fn(() => ({ destroy: vi.fn() })) };
}

function pass(metadata = {}) {
  return { enabled: true, render: vi.fn(), dispose: vi.fn(), ...metadata };
}

function expectNoDispatch(passes) {
  for (const p of passes) expect(p.render).not.toHaveBeenCalled();
}

describe('EffectComposer explicit dependency contract', () => {
  it('keeps legacy insertion order and truthy enabled semantics without inferred IDs', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const order = [];
    const passes = [
      pass({ name: 'same', render: vi.fn(() => order.push(0)) }),
      pass({ name: 'same', enabled: 1, render: vi.fn(() => order.push(1)) }),
      pass({ enabled: undefined }),
      pass({ enabled: false }),
      pass({ enabled: 0 }),
      pass({ render: vi.fn(() => order.push(5)) }),
    ];
    passes.forEach(p => composer.addPass(p));
    composer.render();
    expect(order).toEqual([0, 1, 5]);
    expectNoDispatch(passes.slice(2, 5));
  });

  it('stably orders ready passes and routes textures in execution, not insertion, order', () => {
    const r = renderer();
    const composer = new EffectComposer(r, 800, 600);
    const order = [];
    const consumer = pass({ id: 'consumer', after: ['provider'], render: vi.fn(() => order.push('consumer')) });
    const independent = pass({ id: 'independent', render: vi.fn(() => order.push('independent')) });
    const provider = pass({ id: 'provider', render: vi.fn(() => order.push('provider')) });
    composer.addPass(consumer).addPass(independent).addPass(provider);
    const input = {};
    const output = {};
    composer.render(input, output);
    expect(order).toEqual(['independent', 'provider', 'consumer']);
    expect(composer.passes).toEqual([consumer, independent, provider]);
    expect(independent.render.mock.calls[0][0]).toBe(input);
    expect(provider.render.mock.calls[0][0]).toBe(independent.render.mock.calls[0][1]);
    expect(consumer.render.mock.calls[0]).toEqual([provider.render.mock.calls[0][1], output, r]);
  });

  it('orders a diamond of hard and ordering-only dependencies once despite duplicate edges', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const order = [];
    const a = pass({ id: 'a', after: ['b', 'c', 'b'], requires: ['b'], render: () => order.push('a') });
    const b = pass({ id: 'b', requires: ['d'], render: () => order.push('b') });
    const c = pass({ id: 'c', after: ['d'], render: () => order.push('c') });
    const d = pass({ id: 'd', render: () => order.push('d') });
    [a, b, c, d].forEach(p => composer.addPass(p));
    composer.render();
    expect(order).toEqual(['d', 'b', 'c', 'a']);
  });

  it.each(['after', 'requires'])('rejects missing %s providers before any pass runs', field => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const passes = [pass(), pass({ [field]: ['missing'] })];
    passes.forEach(p => composer.addPass(p));
    expect(() => composer.render()).toThrow(/missing.*provider "missing"/);
    expectNoDispatch(passes);
    expect(composer._pingIdx).toBe(0);
  });

  it('requires an enabled provider even if the consumer comes first', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const consumer = pass({ requires: ['source'] });
    const provider = pass({ id: 'source', enabled: false });
    composer.addPass(consumer).addPass(provider);
    expect(() => composer.render()).toThrow(/required provider "source" is disabled/);
    expectNoDispatch([consumer, provider]);
    provider.enabled = true;
    composer.render();
    expect(provider.render.mock.invocationCallOrder[0]).toBeLessThan(consumer.render.mock.invocationCallOrder[0]);
  });

  it('ignores a disabled ordering-only provider and disabled consumer requirements', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const consumer = pass({ after: ['source'] });
    const provider = pass({ id: 'source', enabled: false, requires: ['missing'] });
    composer.addPass(consumer).addPass(provider);
    composer.render();
    expect(consumer.render).toHaveBeenCalledOnce();
    expect(provider.render).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: 'a', after: ['a'] }],
    [{ id: 'a', after: ['b'] }, { id: 'b', requires: ['a'] }],
    [{ id: 'a', requires: ['b'] }, { id: 'b', after: ['c'] }, { id: 'c', after: ['a'] }],
  ])('rejects enabled cycles without partially executing independent passes: %j', (...metadata) => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const passes = [pass(), ...metadata.map(m => pass(m))];
    passes.forEach(p => composer.addPass(p));
    expect(() => composer.render()).toThrow(/dependency cycle/);
    expectNoDispatch(passes);
  });

  it('does not reject cycles entirely within disabled passes', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    composer.addPass(pass({ id: 'a', enabled: false, requires: ['b'] }))
      .addPass(pass({ id: 'b', enabled: false, requires: ['a'] }));
    expect(() => composer.render()).not.toThrow();
  });

  it('rejects ambiguous duplicate IDs, including disabled providers', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const passes = [pass({ id: 'duplicate' }), pass({ id: 'duplicate', enabled: false })];
    passes.forEach(p => composer.addPass(p));
    expect(() => composer.render()).toThrow(/duplicate pass ID "duplicate"/);
    expectNoDispatch(passes);
  });

  it.each([
    { id: '' }, { id: '  ' }, { id: 1 }, { id: null },
    { after: 'a' }, { requires: null }, { after: [null] }, { requires: [''] },
    { requires: [1] }, { after: ['  '] },
  ])('rejects malformed metadata before dispatch: %j', metadata => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const first = pass();
    composer.addPass(first).addPass(pass(metadata));
    expect(() => composer.render()).toThrow(TypeError);
    expect(first.render).not.toHaveBeenCalled();
  });

  it('validates render methods before dispatch', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const first = pass();
    composer.addPass(first).addPass({ enabled: true });
    expect(() => composer.render()).toThrow(/needs render/);
    expect(first.render).not.toHaveBeenCalled();
  });

  it('revalidates removal, re-addition and metadata mutations on the next render', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const a = pass({ id: 'a' });
    const b = pass({ id: 'b', requires: ['a'] });
    composer.addPass(b).addPass(a);
    composer.render();
    composer.removePass(a);
    expect(() => composer.render()).toThrow(/missing/);
    composer.addPass(a);
    b.requires = [];
    a.after = ['b'];
    composer.render();
    expect(b.render.mock.invocationCallOrder[1]).toBeLessThan(a.render.mock.invocationCallOrder[1]);
  });

  it('works on existing effect passes without requiring new constructors or a separate scheduler', () => {
    const r = renderer();
    const order = [];
    r.runBloomPass = vi.fn(() => order.push('bloom'));
    r.runVignettePass = vi.fn(() => order.push('vignette'));
    const bloom = Object.assign(new BloomPass(), { id: 'bloom' });
    const vignette = Object.assign(new VignettePass(), { requires: ['bloom'] });
    const composer = new EffectComposer(r, 800, 600);
    composer.addPass(vignette).addPass(bloom).render();
    expect(order).toEqual(['bloom', 'vignette']);
    expect(r.runVignettePass.mock.calls[0][1]).toBe(r.runBloomPass.mock.calls[0][2]);
    expect(r.runVignettePass.mock.calls[0][2]).toBeNull();
  });
});

describe('EffectComposer target ownership and failures', () => {
  it('destroys direct targets once on resize and dispose, never caller textures', () => {
    const r = renderer();
    const composer = new EffectComposer(r, 800, 600);
    const old = [composer._rtA, composer._rtB];
    const input = { destroy: vi.fn() };
    const output = { destroy: vi.fn() };
    composer.addPass(pass()).render(input, output);
    composer.resize(320, 240);
    const current = [composer._rtA, composer._rtB];
    old.forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
    current.forEach(t => expect(t.destroy).not.toHaveBeenCalled());
    composer.dispose();
    composer.dispose();
    [...old, ...current].forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
    expect(input.destroy).not.toHaveBeenCalled();
    expect(output.destroy).not.toHaveBeenCalled();
    expect(composer._rtA).toBeNull();
    expect(composer._rtB).toBeNull();
    expect(() => composer.render()).toThrow(/disposed/);
    expect(() => composer.resize(1, 1)).toThrow(/disposed/);
    expect(() => composer.addPass(pass())).toThrow(/disposed/);
    expect(r.createTexture).toHaveBeenCalledTimes(4);
  });

  it('supports direct WebGL targets with dispose rather than destroy', () => {
    const r = { createTexture: vi.fn(() => ({ dispose: vi.fn() })) };
    const composer = new EffectComposer(r, 800, 600);
    const targets = [composer._rtA, composer._rtB];
    composer.dispose();
    composer.dispose();
    targets.forEach(t => expect(t.dispose).toHaveBeenCalledOnce());
  });

  it('releases to the original pool with original dimensions and matching sampleable usage', () => {
    const pool = {
      acquireTexture: vi.fn(() => ({ destroy: vi.fn() })),
      releaseTexture: vi.fn(),
    };
    const r = { resourcePool: pool };
    const composer = new EffectComposer(r, 800, 600);
    const old = [composer._rtA, composer._rtB];
    composer.resize(320, 240);
    const current = [composer._rtA, composer._rtB];
    old.forEach(t => expect(pool.releaseTexture).toHaveBeenCalledWith(t, 'rgba8unorm', 800, 600, 0x1c));
    expect(pool.acquireTexture).toHaveBeenCalledWith('rgba8unorm', 320, 240, 0x1c);
    // Changing the renderer's pool must not transfer ownership of existing RTs.
    r.resourcePool = { releaseTexture: vi.fn() };
    composer.dispose();
    composer.dispose();
    current.forEach(t => expect(pool.releaseTexture).toHaveBeenCalledWith(t, 'rgba8unorm', 320, 240, 0x1c));
    expect(pool.releaseTexture).toHaveBeenCalledTimes(4);
    expect(r.resourcePool.releaseTexture).not.toHaveBeenCalled();
    [...old, ...current].forEach(t => expect(t.destroy).not.toHaveBeenCalled());
  });

  it('integrates with the real resource pool without poisoning dimension keys or double destruction', () => {
    const device = { createTexture: vi.fn(() => ({ destroy: vi.fn() })) };
    const pool = new WebGPUResourcePool(device);
    const composer = new EffectComposer({ resourcePool: pool }, 800, 600);
    const old = [composer._rtA, composer._rtB];
    composer.resize(320, 240);
    expect(pool.acquireTexture('rgba8unorm', 800, 600, 0x1c)).toBe(old[1]);
    pool.releaseTexture(old[1], 'rgba8unorm', 800, 600, 0x1c);
    const current = [composer._rtA, composer._rtB];
    composer.dispose();
    composer.dispose();
    pool.dispose();
    [...old, ...current].forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
  });

  it('does not return direct targets to a pool added after acquisition', () => {
    const r = renderer();
    const composer = new EffectComposer(r, 800, 600);
    const targets = [composer._rtA, composer._rtB];
    r.resourcePool = { releaseTexture: vi.fn() };
    composer.dispose();
    expect(r.resourcePool.releaseTexture).not.toHaveBeenCalled();
    targets.forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
  });

  it('uses direct allocation when a pool cannot release its acquisitions', () => {
    const r = renderer();
    r.resourcePool = { acquireTexture: vi.fn() };
    const composer = new EffectComposer(r, 800, 600);
    expect(r.resourcePool.acquireTexture).not.toHaveBeenCalled();
    expect(r.createTexture).toHaveBeenCalledTimes(2);
    composer.dispose();
  });

  it('cleans up partial constructor allocation', () => {
    const first = { destroy: vi.fn() };
    const r = { createTexture: vi.fn().mockReturnValueOnce(first).mockImplementationOnce(() => { throw new Error('allocation'); }) };
    expect(() => new EffectComposer(r, 800, 600)).toThrow('allocation');
    expect(first.destroy).toHaveBeenCalledOnce();
  });

  it.each([1, 2])('keeps old targets, dimensions and ping state on resize allocation failure %i', failedAllocation => {
    const r = renderer();
    const composer = new EffectComposer(r, 800, 600);
    composer.addPass(pass()).addPass(pass()).render();
    const old = [composer._rtA, composer._rtB];
    const ping = composer._pingIdx;
    const partial = { destroy: vi.fn() };
    if (failedAllocation === 2) r.createTexture.mockReturnValueOnce(partial);
    r.createTexture.mockImplementationOnce(() => { throw new Error('resize allocation'); });
    expect(() => composer.resize(320, 240)).toThrow('resize allocation');
    expect([composer._rtA, composer._rtB]).toEqual(old);
    expect([composer._width, composer._height, composer._pingIdx]).toEqual([800, 600, ping]);
    old.forEach(t => expect(t.destroy).not.toHaveBeenCalled());
    expect(partial.destroy).toHaveBeenCalledTimes(failedAllocation - 1);
    expect(() => composer.render()).not.toThrow();
    composer.dispose();
    old.forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
  });

  it('returns partial pooled allocation using its requested size after failed resize', () => {
    const pool = { acquireTexture: vi.fn(() => ({})), releaseTexture: vi.fn() };
    const composer = new EffectComposer({ resourcePool: pool }, 800, 600);
    const partial = {};
    pool.acquireTexture.mockReturnValueOnce(partial).mockImplementationOnce(() => { throw new Error('pool allocation'); });
    expect(() => composer.resize(320, 240)).toThrow('pool allocation');
    expect(pool.releaseTexture).toHaveBeenCalledExactlyOnceWith(partial, 'rgba8unorm', 320, 240, 0x1c);
    composer.dispose();
    expect(pool.releaseTexture).toHaveBeenCalledTimes(3);
  });

  it('attempts all cleanup even when a pass and one target fail disposal', () => {
    const r = renderer();
    const composer = new EffectComposer(r, 800, 600);
    const targets = [composer._rtA, composer._rtB];
    targets[0].destroy.mockImplementation(() => { throw new Error('destroy'); });
    const broken = pass({ dispose: vi.fn(() => { throw new Error('pass'); }) });
    const other = pass();
    composer.addPass(broken).addPass(other).addPass(other);
    expect(() => composer.dispose()).toThrow(AggregateError);
    expect(broken.dispose).toHaveBeenCalledOnce();
    expect(other.dispose).toHaveBeenCalledOnce();
    targets.forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
    expect(composer.passes).toEqual([]);
    expect(() => composer.dispose()).not.toThrow();
    targets.forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
  });

  it('attempts both pool releases even if the first fails, with no retry on dispose', () => {
    const pool = {
      acquireTexture: vi.fn(() => ({})),
      releaseTexture: vi.fn().mockImplementationOnce(() => { throw new Error('release'); }),
    };
    const composer = new EffectComposer({ resourcePool: pool }, 800, 600);
    expect(() => composer.dispose()).toThrow(AggregateError);
    expect(pool.releaseTexture).toHaveBeenCalledTimes(2);
    composer.dispose();
    expect(pool.releaseTexture).toHaveBeenCalledTimes(2);
  });

  it('retains the successfully allocated replacement pair if releasing an old target fails', () => {
    const r = renderer();
    const composer = new EffectComposer(r, 800, 600);
    const old = [composer._rtA, composer._rtB];
    old[0].destroy.mockImplementation(() => { throw new Error('release'); });
    expect(() => composer.resize(320, 240)).toThrow(AggregateError);
    old.forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
    const current = [composer._rtA, composer._rtB];
    expect(current).not.toEqual(old);
    expect([composer._width, composer._height, composer._pingIdx]).toEqual([320, 240, 0]);
    composer.addPass(pass()).render();
    composer.dispose();
    [...old, ...current].forEach(t => expect(t.destroy).toHaveBeenCalledOnce());
  });
});

describe('EffectComposer feedback protection and render failures', () => {
  it.each(['direct', 'gpu', 'webgl'])('avoids first-pass feedback when explicit input aliases the normal destination (%s)', kind => {
    const r = renderer();
    if (kind === 'gpu') r.createTexture.mockImplementation(() => ({ gpuTexture: {}, destroy: vi.fn() }));
    if (kind === 'webgl') r.createTexture.mockImplementation(() => ({ texture: {}, dispose: vi.fn() }));
    const composer = new EffectComposer(r, 800, 600);
    const first = pass();
    const last = pass();
    const input = kind === 'gpu' ? composer._rtB.gpuTexture
      : kind === 'webgl' ? composer._rtB.texture : composer._rtB;
    composer.addPass(first).addPass(last).render(input);
    expect(first.render.mock.calls[0][0]).toBe(input);
    expect(first.render.mock.calls[0][1]).toBe(composer._rtA);
    expect(last.render.mock.calls[0][0]).toBe(composer._rtA);
  });

  it('rejects a final-target feedback hazard before any pass executes', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const passes = [pass(), pass()];
    passes.forEach(p => composer.addPass(p));
    expect(() => composer.render({}, composer._rtB)).toThrow(/textures alias/);
    expectNoDispatch(passes);
    expect(composer._pingIdx).toBe(0);
  });

  it('rejects identical external input/output and wrapped GPU aliases', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const p = pass();
    composer.addPass(p);
    const texture = {};
    expect(() => composer.render(texture, texture)).toThrow(/textures alias/);
    expect(() => composer.render({ gpuTexture: texture }, texture)).toThrow(/textures alias/);
    expect(p.render).not.toHaveBeenCalled();
  });

  it('does not advance ping state or dispatch later passes on a rendering exception', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const first = pass();
    const broken = pass({ render: vi.fn(() => { throw new Error('render failed'); }) });
    const last = pass();
    composer.addPass(first).addPass(broken).addPass(last);
    expect(() => composer.render()).toThrow('render failed');
    expect(composer._pingIdx).toBe(0);
    expect(last.render).not.toHaveBeenCalled();
    broken.render.mockImplementation(() => {});
    composer.render();
    expect(first.render.mock.calls[1][0]).toBe(first.render.mock.calls[0][0]);
    expect(last.render).toHaveBeenCalledOnce();
    composer.dispose();
  });

  it('resets ping state after successful resize', () => {
    const composer = new EffectComposer(renderer(), 800, 600);
    const first = pass();
    composer.addPass(first).addPass(pass()).render();
    expect(composer._pingIdx).toBe(1);
    composer.resize(320, 240);
    composer.render();
    expect(first.render.mock.calls[1][0]).toBe(composer._rtA);
    expect(first.render.mock.calls[1][1]).toBe(composer._rtB);
  });
});
