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
});
