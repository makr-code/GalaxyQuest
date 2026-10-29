/**
 * tests/webgpu/galaxy3d-webgpu-facade.test.js
 *
 * Regression tests for the facade init flow in js/legacy/galaxy3d-webgpu.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadFacade() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'js/legacy/galaxy3d-webgpu.js'),
    'utf8',
  );
  // eslint-disable-next-line no-eval
  window.eval(src);
  return window.Galaxy3DRendererWebGPU;
}

function makeContainer() {
  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '600px';
  document.body.appendChild(el);
  return el;
}

describe('galaxy3d-webgpu facade', () => {
  beforeEach(() => {
    localStorage.removeItem('gq:allowThreeFallback');
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    delete window.StarfieldWebGPU;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('calls delegate init() exactly once for interactive native renderer', async () => {
    const initSpy = vi.fn(async () => {});
    class MockNativeRenderer {
      constructor() {
        this.init = initSpy;
      }
    }

    window.GQGalaxy3DRendererWebGPU = MockNativeRenderer;

    const FacadeCtor = loadFacade();
    const facade = new FacadeCtor(makeContainer(), { interactive: true });

    await facade.init();
    await facade.init();

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(facade.ready).toBe(true);
  });

  it('exposes the native delegate device, context, capabilities and frame hook', async () => {
    const device = {};
    const context = {};
    const frameHook = vi.fn();
    const removeFrameHook = vi.fn();
    const addFrameHook = vi.fn(() => removeFrameHook);
    class MockNativeRenderer {
      constructor() {
        this.device = device;
        this.context = context;
        this.getCapabilities = () => ({ webgpu: true });
        this.addFrameHook = addFrameHook;
        this.createMesh = vi.fn(async (descriptor) => ({ descriptor }));
        this.setMeshRotation = vi.fn();
        this.renderMesh = vi.fn(() => true);
        this.destroyMesh = vi.fn(() => true);
      }

      async init() {}
    }

    window.GQGalaxy3DRendererWebGPU = MockNativeRenderer;

    const FacadeCtor = loadFacade();
    const facade = new FacadeCtor(makeContainer(), { interactive: true });
    await facade.init();

    expect(facade.device).toBe(device);
    expect(facade.context).toBe(context);
    expect(facade.getCapabilities()).toEqual({ webgpu: true });
    expect(facade.addFrameHook(frameHook)).toBe(removeFrameHook);
    expect(addFrameHook).toHaveBeenCalledWith(frameHook);
    const descriptor = { shape: 'torus' };
    const handle = await facade.createMesh(descriptor);
    facade.setMeshRotation(handle, { y: 1 });
    facade.renderMesh(handle);
    facade.destroyMesh(handle);
    expect(facade._delegate.createMesh).toHaveBeenCalledWith(descriptor);
    expect(facade._delegate.setMeshRotation).toHaveBeenCalledWith(handle, { y: 1 });
    expect(facade._delegate.renderMesh).toHaveBeenCalledWith(handle);
    expect(facade._delegate.destroyMesh).toHaveBeenCalledWith(handle);
  });

  it('never constructs a legacy renderer for the WebGPU start menu', async () => {
    vi.stubGlobal('__GQ_WEBGPU_ADAPTER_AVAILABLE', { value: false });
    window.Galaxy3DRenderer = vi.fn();
    const FacadeCtor = loadFacade();
    const facade = new FacadeCtor(makeContainer(), { interactive: false, menuGalaxy: true });
    await expect(facade.init()).rejects.toThrow('requires WebGPU');
    expect(window.Galaxy3DRenderer).not.toHaveBeenCalled();
    expect(facade.ready).toBe(false);
  });
});
