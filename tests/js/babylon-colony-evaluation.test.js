import { afterEach, describe, expect, it, vi } from 'vitest';
import { BabylonColonyAdapter, colonyFixture } from '../../js/evaluation/BabylonColonyAdapter.js';
import { FrameCapture, captureLiveBaseline, quantile } from '../../js/evaluation/benchmark.js';
import { createNativeColony } from '../../js/evaluation/native-colony.js';

function runtime({ gpuFails = false } = {}) {
  const scenes = [], engines = [];
  class Engine {
    constructor(canvas) { this.canvas = canvas; this.dispose = vi.fn(); engines.push(this); }
    async initAsync() { if (gpuFails) throw new Error('device rejected'); }
    setSize(w, h) { this.canvas.width = w; this.canvas.height = h; }
    beginFrame = vi.fn();
    endFrame = vi.fn();
  }
  class Scene {
    constructor() {
      this.meshes = [];
      this.onPointerObservable = { add: fn => { this.pick = fn; } };
      this.dispose = vi.fn(); this.render = vi.fn();
      scenes.push(this);
    }
  }
  class Vector3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } static Zero() { return new Vector3(0, 0, 0); } }
  class Camera {
    attachControl = vi.fn();
    detachControl = vi.fn();
  }
  class Color { set = vi.fn(); }
  class Material { emissiveColor = new Color(); }
  const mesh = (_name, _opts, scene) => { const m = {}; scene.meshes.push(m); return m; };
  return {
    scenes, engines, Engine, WebGPUEngine: Engine, Scene, ArcRotateCamera: Camera,
    Vector3, HemisphericLight: class {}, DirectionalLight: class {},
    MeshBuilder: { CreateGround: mesh, CreateBox: mesh },
    StandardMaterial: Material, Color3: Color, Color4: Color, compilerOptions: [],
    PointerEventTypes: { POINTERPICK: 1 },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete navigator.gpu;
  document.body.replaceChildren();
});

describe('isolated Babylon colony lifecycle', () => {
  it('uses deterministic cloned plain data, ID-only selection and enter/exit', async () => {
    const B = runtime(), selected = vi.fn();
    const adapter = new BabylonColonyAdapter({ load: async () => B, onSelect: selected });
    const fixture = colonyFixture();
    adapter.setSceneData(fixture);
    fixture.slots[0].id = 'mutated';
    const canvas = document.createElement('canvas');
    await adapter.initialize(canvas);
    expect(adapter.backend).toBe('babylon-webgl-fallback');
    const scene = B.scenes.at(-1), building = scene.meshes[1];
    expect(building.metadata.slotId).toBe('slot-0');
    await adapter.enter();
    scene.pick({ type: 1, pickInfo: { pickedMesh: building } });
    expect(selected).toHaveBeenCalledWith('slot-0');
    adapter.render(0.016);
    expect(scene.render).toHaveBeenCalledOnce();
    expect(B.engines[0].endFrame).toHaveBeenCalledOnce();
    await adapter.exit();
    adapter.render(0.016);
    scene.pick({ type: 1, pickInfo: { pickedMesh: building } });
    expect(scene.render).toHaveBeenCalledOnce();
    expect(selected).toHaveBeenCalledOnce();
    adapter.dispose(); adapter.dispose();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(B.engines[0].dispose).toHaveBeenCalledOnce();
  });

  it('rejects shared canvas and borrowed game backend', async () => {
    const B = runtime(), canvas = document.createElement('canvas');
    const first = new BabylonColonyAdapter({ load: async () => B });
    await first.initialize(canvas);
    const second = new BabylonColonyAdapter({ load: async () => B });
    await expect(second.initialize(canvas)).rejects.toThrow('unshared');
    await expect(second.initialize(document.createElement('canvas'), {})).rejects.toThrow('unshared');
    first.dispose(); second.dispose();
  });

  it('falls back only on a fresh canvas after WebGPU initialization failure', async () => {
    navigator.gpu = {};
    const B = runtime({ gpuFails: true });
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const adapter = new BabylonColonyAdapter({ load: async () => B });
    await adapter.initialize(canvas);
    expect(adapter.canvas).not.toBe(canvas);
    expect(canvas.isConnected).toBe(false);
    expect(adapter.backend).toBe('babylon-webgl-fallback');
    expect(adapter.fallbackReason).toContain('device rejected');
    expect(B.engines[0].dispose).toHaveBeenCalledOnce();
    adapter.dispose();
  });

  it('keeps WebGPU success and forbids an unsafe fallback canvas', async () => {
    navigator.gpu = {};
    const B = runtime(), canvas = document.createElement('canvas');
    const adapter = new BabylonColonyAdapter({ load: async () => B });
    await adapter.initialize(canvas);
    expect(adapter.backend).toBe('babylon-webgpu');
    expect(B.engines).toHaveLength(1);
    adapter.dispose();
    const bad = new BabylonColonyAdapter({ load: async () => runtime({ gpuFails: true }), replaceCanvas: c => c });
    await expect(bad.initialize(canvas)).rejects.toThrow('fresh canvas');
  });

  it('cleans up scene-build failure and disposal during async initialization', async () => {
    const B = runtime();
    B.Scene = class { constructor() { throw new Error('scene failed'); } };
    const adapter = new BabylonColonyAdapter({ load: async () => B });
    await expect(adapter.initialize(document.createElement('canvas'))).rejects.toThrow('scene failed');
    expect(B.engines[0].dispose).toHaveBeenCalledOnce();
    let resolve;
    const pending = new BabylonColonyAdapter({ load: () => new Promise(r => { resolve = r; }) });
    const init = pending.initialize(document.createElement('canvas'));
    pending.dispose();
    resolve(runtime());
    await expect(init).rejects.toThrow('disposed');
  });

  it('rejects invalid scene metrics rather than uploading NaN', () => {
    const adapter = new BabylonColonyAdapter();
    expect(() => adapter.setSceneData({ slots: [{ id: 'x', x: NaN }] })).toThrow(TypeError);
    adapter.dispose();
  });

  it('disposes resources allocated after a pending WebGPU init was cancelled', async () => {
    navigator.gpu = {};
    const B = runtime();
    let finish;
    B.WebGPUEngine.prototype.initAsync = () => new Promise(resolve => { finish = resolve; });
    const adapter = new BabylonColonyAdapter({ load: async () => B });
    const init = adapter.initialize(document.createElement('canvas'));
    await Promise.resolve();
    adapter.dispose();
    finish();
    await expect(init).rejects.toThrow('disposed');
    expect(B.engines[0].dispose).toHaveBeenCalledTimes(2);
    expect(B.scenes).toHaveLength(0);
  });
});

describe('bounded benchmark validity', () => {
  it('excludes warmup, computes percentiles and never invents GPU timing', async () => {
    const capture = new FrameCapture({ warmup: 1, samples: 2, startupMs: 42 });
    capture.observe(10, 100);
    capture.observe(26, 2);
    capture.observe(46, 4);
    const result = await capture.promise;
    expect(result.frameIntervalMs).toEqual({ p50: 18, p95: 19.8 });
    expect(result.synchronousRenderCallMs.p95).toBe(3.9);
    expect(result.startupToFirstSubmissionMs).toBe(42);
    expect(result.gpuTimeMs).toBeNull();
    expect(result.memoryAfter.gpuBytes).toBeNull();
    expect(quantile([], 0.95)).toBeNull();
  });

  describe('actual native reference bridge', () => {
    function nativeDevice(error = null) {
      const device = Object.assign(new EventTarget(), {
        createShaderModule: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => ({})),
        pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => error),
        destroy: vi.fn(), lost: new Promise(() => {}),
      });
      navigator.gpu = {
        getPreferredCanvasFormat: () => 'bgra8unorm',
        requestAdapter: async () => ({ requestDevice: async () => device }),
      };
      const context = { configure: vi.fn(), unconfigure: vi.fn() };
      const canvas = document.createElement('canvas');
      canvas.getContext = vi.fn(() => context);
      return { canvas, context, device };
    }

    it('initializes the real legacy class and releases its exclusively owned device', async () => {
      const { canvas, context, device } = nativeDevice();
      const native = await createNativeColony(canvas);
      expect(native.backend).toBe('native-colony-webgpu');
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(3);
      expect(context.configure).toHaveBeenCalledOnce();
      const event = new Event('uncapturederror');
      event.error = { message: 'bad submission' };
      device.dispatchEvent(event);
      expect(() => native.render(0.016)).toThrow('bad submission');
      native.dispose(); native.dispose();
      expect(context.unconfigure).toHaveBeenCalledOnce();
      expect(device.destroy).toHaveBeenCalledOnce();
    });

    it('does not report a valid native baseline after pipeline validation failure', async () => {
      const { canvas, context, device } = nativeDevice({ message: 'bad shader' });
      await expect(createNativeColony(canvas)).rejects.toThrow('bad shader');
      expect(device.destroy).toHaveBeenCalledOnce();
      expect(context.unconfigure).toHaveBeenCalledOnce();
    });
  });

  it('rejects invalid windows, invalid timings and timeouts', async () => {
    expect(() => new FrameCapture({ samples: 5000 })).toThrow(RangeError);
    const capture = new FrameCapture({ warmup: 0, samples: 2 });
    capture.observe(0, NaN);
    await expect(capture.promise).rejects.toThrow('Invalid frame');
    vi.useFakeTimers();
    const slow = new FrameCapture({ timeoutMs: 10 });
    const rejection = expect(slow.promise).rejects.toThrow('timed out');
    vi.advanceTimersByTime(11);
    await rejection;
  });

  it('invalidates on hidden tabs and abort, cleaning listeners', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const capture = new FrameCapture();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await expect(capture.promise).rejects.toThrow('Tab hidden');
    hidden.mockReturnValue(false);
    const controller = new AbortController();
    const second = new FrameCapture({ signal: controller.signal });
    controller.abort();
    await expect(second.promise).rejects.toThrow('cancelled');
  });

  it('captures real live calls, preserves receiver/result and restores inherited methods', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => ++clock);
    const proto = { render() { expect(this.tag).toBe(7); return 42; } };
    const target = Object.assign(Object.create(proto), { tag: 7 });
    const baseline = captureLiveBaseline({
      target, canvas: document.createElement('canvas'), scene: 'galaxy', backend: 'native-webgpu',
      warmup: 1, samples: 2,
    });
    expect(target.render()).toBe(42); target.render(); target.render();
    const result = await baseline.promise;
    expect(result.metadata.source).toBe('live-game');
    expect(result.startupToFirstSubmissionMs).toBeNull();
    expect(Object.hasOwn(target, 'render')).toBe(false);
    expect(target.render).toBe(proto.render);
  });

  it('restores a live method on cancel/error and refuses double wrapping', async () => {
    const target = { render: vi.fn() }, original = target.render;
    const options = { target, canvas: document.createElement('canvas'), scene: 'dense-system', backend: 'webgl' };
    const live = captureLiveBaseline(options);
    expect(() => captureLiveBaseline(options)).toThrow('Already capturing');
    live.cancel();
    await expect(live.promise).rejects.toThrow('cancelled');
    expect(target.render).toBe(original);
    target.render = () => { throw new Error('broken'); };
    const failed = captureLiveBaseline(options);
    expect(() => target.render()).toThrow('broken');
    await expect(failed.promise).rejects.toThrow('Renderer failed');
    expect(target.render.evaluationCapture).toBeUndefined();
  });
});
