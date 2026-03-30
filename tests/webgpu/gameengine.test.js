/**
 * tests/webgpu/gameengine.test.js
 *
 * Tests for the GameEngine coordination layer:
 *   - EventBus
 *   - GameLoop (fixed-step accumulator)
 *   - SystemRegistry (ordered pipeline)
 *   - AssetRegistry (cache + status)
 *   - GameEngine.create() integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus }                     from '../../js/engine/EventBus.js';
import { GameLoop }                     from '../../js/engine/GameLoop.js';
import { SystemRegistry, SystemPriority } from '../../js/engine/SystemRegistry.js';
import { AssetRegistry, AssetType }     from '../../js/engine/AssetRegistry.js';
import { GameEngine }                   from '../../js/engine/GameEngine.js';

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

describe('EventBus', () => {
  let bus;
  beforeEach(() => { bus = new EventBus(); });

  it('fires a listener', () => {
    const fn = vi.fn();
    bus.on('test', fn);
    bus.emit('test', { value: 42 });
    expect(fn).toHaveBeenCalledWith({ value: 42 });
  });

  it('supports once()', () => {
    const fn = vi.fn();
    bus.once('ping', fn);
    bus.emit('ping');
    bus.emit('ping');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('unsubscribes via returned off()', () => {
    const fn  = vi.fn();
    const off = bus.on('tick', fn);
    bus.emit('tick');
    off();
    bus.emit('tick');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('respects priority order', () => {
    const order = [];
    bus.on('e', () => order.push('low'),  { priority: 0   });
    bus.on('e', () => order.push('high'), { priority: 100 });
    bus.emit('e');
    expect(order).toEqual(['high', 'low']);
  });

  it('clear() removes all listeners', () => {
    const fn = vi.fn();
    bus.on('x', fn);
    bus.clear();
    bus.emit('x');
    expect(fn).not.toHaveBeenCalled();
    expect(bus.listenerCount).toBe(0);
  });

  it('does not throw when no listeners exist', () => {
    expect(() => bus.emit('nonexistent')).not.toThrow();
  });

  it('isolates errors in one listener from others', () => {
    const good = vi.fn();
    bus.on('bad', () => { throw new Error('boom'); });
    bus.on('bad', good);
    expect(() => bus.emit('bad')).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it('listenerCount tracks correctly', () => {
    bus.on('a', vi.fn());
    bus.on('a', vi.fn());
    bus.on('b', vi.fn());
    expect(bus.listenerCount).toBe(3);
    bus.clear('a');
    expect(bus.listenerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GameLoop
// ---------------------------------------------------------------------------

describe('GameLoop', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('starts and stops without error', () => {
    const loop = new GameLoop({ onRender: vi.fn() });
    expect(() => loop.start()).not.toThrow();
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });

  it('is idempotent — double start is safe', () => {
    const loop = new GameLoop({});
    loop.start();
    loop.start(); // should not double-schedule
    expect(loop.running).toBe(true);
    loop.stop();
  });

  it('pause / resume', () => {
    const loop = new GameLoop({});
    loop.start();
    loop.pause();
    expect(loop.paused).toBe(true);
    loop.resume();
    expect(loop.paused).toBe(false);
    loop.stop();
  });

  it('calls onFixedUpdate the correct number of times for a given dt', () => {
    vi.useFakeTimers();
    const fixedUpdates = vi.fn();
    const loop = new GameLoop({
      fixedStep:     1 / 60,
      onFixedUpdate: fixedUpdates,
    });

    // Manually call _tick with controlled timestamps (ms)
    // First tick establishes baseline
    loop._running = true;
    loop._tick(0);                // baseline — no output
    loop._tick(3 * (1000 / 60)); // 3 fixed steps worth of time
    loop._running = false;

    expect(fixedUpdates).toHaveBeenCalledTimes(3);
  });

  it('alpha is in [0, 1)', () => {
    const loop = new GameLoop({ fixedStep: 1 / 60 });
    loop._running = true;
    loop._tick(0);
    loop._tick(8); // 8 ms — less than one fixed step (16.7 ms)
    loop._running = false;

    expect(loop.alpha).toBeGreaterThanOrEqual(0);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('clamps large dt to maxDt', () => {
    const panic = vi.fn();
    const loop  = new GameLoop({ maxDt: 0.1, onPanic: panic });
    loop._running = true;
    loop._tick(0);
    loop._tick(500); // 500 ms >> maxDt of 100 ms
    loop._running = false;
    expect(panic).toHaveBeenCalled();
  });

  it('increments frame counter', () => {
    const loop = new GameLoop({});
    loop._running = true;
    loop._tick(0);
    loop._tick(16);
    loop._tick(32);
    loop._running = false;
    expect(loop.frame).toBe(2); // first tick sets baseline, 2 + 3 calls render
  });
});

// ---------------------------------------------------------------------------
// SystemRegistry
// ---------------------------------------------------------------------------

describe('SystemRegistry', () => {
  let reg;
  beforeEach(() => { reg = new SystemRegistry(); });

  it('adds a system and calls update', () => {
    const update = vi.fn();
    reg.add({ name: 'test', update });
    reg.update(0.016, {});
    expect(update).toHaveBeenCalledWith(0.016, {});
  });

  it('executes systems in priority order', () => {
    const order = [];
    reg.add({ name: 'hi',  priority: 100, update: () => order.push('hi')  });
    reg.add({ name: 'low', priority: 500, update: () => order.push('low') });
    reg.add({ name: 'mid', priority: 300, update: () => order.push('mid') });
    reg.update(0.016, {});
    expect(order).toEqual(['hi', 'mid', 'low']);
  });

  it('replace system with same name', () => {
    const first  = vi.fn();
    const second = vi.fn();
    reg.add({ name: 'sys', update: first  });
    reg.add({ name: 'sys', update: second });
    reg.update(0.016, {});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('setEnabled disables a system', () => {
    const fn = vi.fn();
    reg.add({ name: 'ai', update: fn });
    reg.setEnabled('ai', false);
    reg.update(0.016, {});
    expect(fn).not.toHaveBeenCalled();
  });

  it('remove() calls onRemove', () => {
    const onRemove = vi.fn();
    reg.add({ name: 'x', update: vi.fn(), onRemove });
    reg.remove('x');
    expect(onRemove).toHaveBeenCalled();
    expect(reg.has('x')).toBe(false);
  });

  it('throws if system has no update()', () => {
    expect(() => reg.add({ name: 'bad' })).toThrow(/update/);
  });

  it('SystemPriority constants are correct', () => {
    expect(SystemPriority.PHYSICS).toBeLessThan(SystemPriority.RENDER);
    expect(SystemPriority.RENDER).toBeLessThan(SystemPriority.CLEANUP);
  });

  it('list() returns ordered snapshot', () => {
    reg.add({ name: 'b', priority: 200, update: vi.fn() });
    reg.add({ name: 'a', priority: 100, update: vi.fn() });
    const names = reg.list().map((s) => s.name);
    expect(names).toEqual(['a', 'b']);
  });

  it('error in one system does not stop others', () => {
    const safe = vi.fn();
    reg.add({ name: 'bad',  priority: 100, update: () => { throw new Error('crash'); } });
    reg.add({ name: 'safe', priority: 200, update: safe });
    expect(() => reg.update(0.016, {})).not.toThrow();
    expect(safe).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AssetRegistry
// ---------------------------------------------------------------------------

describe('AssetRegistry', () => {
  let reg;
  const mockRenderer = {
    createTexture: vi.fn(() => ({ uploadImage: vi.fn() })),
  };

  beforeEach(() => {
    reg = new AssetRegistry(mockRenderer);
    // Mock fetch globally
    global.fetch = vi.fn();
    global.createImageBitmap = vi.fn(async () => ({ width: 64, height: 64 }));
  });

  it('add() is idempotent', () => {
    reg.add('k', AssetType.JSON, '/a.json');
    reg.add('k', AssetType.JSON, '/b.json'); // second call ignored
    expect(reg.size).toBe(1);
  });

  it('isLoaded returns false before load()', () => {
    reg.add('json:test', AssetType.JSON, '/test.json');
    expect(reg.isLoaded('json:test')).toBe(false);
  });

  it('load() returns promise and resolves asset', async () => {
    reg.add('j', AssetType.JSON, '/data.json');
    global.fetch.mockResolvedValue({ json: async () => ({ hello: 'world' }) });

    const result = await reg.load('j');
    expect(result).toEqual({ hello: 'world' });
    expect(reg.isLoaded('j')).toBe(true);
    expect(reg.get('j')).toEqual({ hello: 'world' });
  });

  it('load() deduplicates — same promise returned', () => {
    reg.add('dup', AssetType.JSON, '/dup.json');
    global.fetch.mockResolvedValue({ json: async () => ({}) });
    const p1 = reg.load('dup');
    const p2 = reg.load('dup');
    expect(p1).toBe(p2);
  });

  it('load() rejects and marks hasFailed', async () => {
    reg.add('fail', AssetType.JSON, '/fail.json');
    global.fetch.mockRejectedValue(new Error('network error'));
    await expect(reg.load('fail')).rejects.toThrow('network error');
    expect(reg.hasFailed('fail')).toBe(true);
  });

  it('load() throws for unknown key', async () => {
    await expect(reg.load('nonexistent')).rejects.toThrow(/unknown asset key/i);
  });

  it('loadAll() tracks progress', async () => {
    reg.add('a', AssetType.JSON, '/a.json');
    reg.add('b', AssetType.JSON, '/b.json');
    global.fetch.mockResolvedValue({ json: async () => ({}) });

    const progress = [];
    await reg.loadAll((loaded, total) => progress.push({ loaded, total }));

    expect(progress.length).toBe(2);
    expect(progress[1]).toEqual({ loaded: 2, total: 2 });
  });

  it('status() reflects asset states', async () => {
    reg.add('x', AssetType.JSON, '/x.json');
    expect(reg.status()['x']).toBe('pending');
    global.fetch.mockResolvedValue({ json: async () => ({}) });
    await reg.load('x');
    expect(reg.status()['x']).toBe('loaded');
  });

  it('remove() deletes from registry', () => {
    reg.add('del', AssetType.JSON, '/del.json');
    reg.remove('del');
    expect(reg.size).toBe(0);
  });

  it('AssetType constants are frozen', () => {
    expect(Object.isFrozen(AssetType)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GameEngine integration
// ---------------------------------------------------------------------------

describe('GameEngine integration', () => {
  function makeCanvas(w = 800, h = 600) {
    return { width: w, height: h, parentElement: null };
  }

  function makeMockRenderer() {
    return {
      getCapabilities: () => ({ webgpu: false, webgl2: true, computeShaders: false, maxTextureSize: 4096 }),
      initialize:    vi.fn(async () => {}),
      createTexture: vi.fn(() => ({})),
      render:        vi.fn(),
      resize:        vi.fn(),
      dispose:       vi.fn(),
    };
  }

  it('create() resolves to a GameEngine instance', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { postFx: false });
    expect(engine).toBeInstanceOf(GameEngine);
    expect(engine.initialized).toBe(true);
    expect(engine.camera).toBeDefined();
    expect(engine.scene).toBeDefined();
    expect(engine.systems).toBeDefined();
    expect(engine.events).toBeDefined();
    expect(engine.assets).toBeDefined();
  });

  it('start() / stop() toggle running state and emit events', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { postFx: false });
    const startEvt = vi.fn();
    const stopEvt  = vi.fn();
    engine.events.on('engine:start', startEvt);
    engine.events.on('engine:stop',  stopEvt);

    engine.start();
    expect(engine.running).toBe(true);
    expect(startEvt).toHaveBeenCalled();

    engine.stop();
    expect(engine.running).toBe(false);
    expect(stopEvt).toHaveBeenCalled();
  });

  it('addSystem() registers a system', async () => {
    const engine   = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { postFx: false });
    const updateFn = vi.fn();
    engine.addSystem({ name: 'test', priority: 300, update: updateFn });
    expect(engine.systems.has('test')).toBe(true);
  });

  it('emit() fires events on the engine bus', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { postFx: false });
    const fn = vi.fn();
    engine.events.on('custom:event', fn);
    engine.emit('custom:event', { data: 1 });
    expect(fn).toHaveBeenCalledWith({ data: 1 });
  });

  it('resize() calls renderer.resize', async () => {
    const renderer = makeMockRenderer();
    const engine   = await GameEngine.createWithRenderer(renderer, makeCanvas(), { postFx: false });
    engine.resize(1280, 720);
    expect(renderer.resize).toHaveBeenCalledWith(1280, 720);
  });

  it('dispose() cleans up without error', async () => {
    const renderer = makeMockRenderer();
    const engine   = await GameEngine.createWithRenderer(renderer, makeCanvas(), { postFx: false });
    expect(() => engine.dispose()).not.toThrow();
    expect(engine.initialized).toBe(false);
    expect(renderer.dispose).toHaveBeenCalled();
  });

  it('engine:initialized event fires after create', async () => {
    const initFn = vi.fn();
    // Wire up listener before engine is ready — use the instance's bus
    const engine = new GameEngine();
    engine.events.on('engine:initialized', initFn);
    await engine._init(makeCanvas(), { _rendererOverride: makeMockRenderer(), postFx: false });
    expect(initFn).toHaveBeenCalled();
  });

  it('createWithRenderer passes capabilities from the supplied renderer', async () => {
    const renderer = makeMockRenderer();
    const engine   = await GameEngine.createWithRenderer(renderer, makeCanvas(), { postFx: false });
    const caps     = engine.renderer.getCapabilities();
    expect(caps.webgl2).toBe(true);
    expect(caps.webgpu).toBe(false);
  });
});
