import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const facadePath = path.resolve(process.cwd(), 'js/legacy/galaxy3d-webgpu.js');

function loadFacadeScript() {
  const src = fs.readFileSync(facadePath, 'utf8');
  window.eval(src);
  return window.Galaxy3DRendererWebGPU;
}

describe('Galaxy3D WebGPU facade backend selection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    window.__GQ_WEBGPU_INTERACTIVE_EXPERIMENT = false;
    window.GQGalaxy3DRendererWebGPU = undefined;
    window.Galaxy3DRendererWebGPU = undefined;
    window.Galaxy3DRenderer = undefined;
    window.__GQ_ACTIVE_RENDERER_BACKEND = undefined;
    localStorage.removeItem('gq:allowThreeFallback');
  });

  it('uses native interactive WebGPU renderer by default when available', () => {
    const NativeCtor = vi.fn(function (_container, _opts) {
      this.init = vi.fn(async () => undefined);
      return this;
    });
    const ThreeCtor = vi.fn(function (_container, _opts) {
      this.init = vi.fn(async () => undefined);
      return this;
    });

    window.GQGalaxy3DRendererWebGPU = NativeCtor;
    window.Galaxy3DRenderer = ThreeCtor;

    const Galaxy3DRendererWebGPU = loadFacadeScript();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const renderer = new Galaxy3DRendererWebGPU(host, { interactive: true });

    expect(NativeCtor).toHaveBeenCalledTimes(1);
    expect(ThreeCtor).not.toHaveBeenCalled();
    expect(renderer.backendType).toBe('webgpu');
  });

  it('throws in interactive mode when native renderer is missing and fallback is not opted in', async () => {
    const ThreeCtor = vi.fn(function (_container, _opts) {
      this.init = vi.fn(async () => undefined);
      return this;
    });
    window.Galaxy3DRenderer = ThreeCtor;

    const Galaxy3DRendererWebGPU = loadFacadeScript();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const renderer = new Galaxy3DRendererWebGPU(host, { interactive: true });

    await expect(renderer.init()).rejects.toThrow('Interactive mode requires native WebGPU renderer');
    expect(ThreeCtor).not.toHaveBeenCalled();
  });

  it('allows interactive Three fallback only when explicitly opted in', async () => {
    const ThreeCtor = vi.fn(function (_container, _opts) {
      this.init = vi.fn(async () => undefined);
      this.rendererBackend = 'webgl2';
      return this;
    });

    localStorage.setItem('gq:allowThreeFallback', '1');
    window.Galaxy3DRenderer = ThreeCtor;

    const Galaxy3DRendererWebGPU = loadFacadeScript();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const renderer = new Galaxy3DRendererWebGPU(host, { interactive: true });

    await renderer.init();
    expect(ThreeCtor).toHaveBeenCalledTimes(1);
    expect(renderer.backendType).toBe('webgl2');
  });
});