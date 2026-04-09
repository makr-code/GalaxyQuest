/**
 * tests/webgpu/fallback.test.js
 *
 * Tests the WebGPU → WebGL2 fallback detection logic in RendererFactory
 * and engine-compat.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// RendererFactory fallback tests
// ---------------------------------------------------------------------------

describe('RendererFactory fallback chain', () => {
  let RendererFactory;

  beforeEach(async () => {
    // Fresh import each time so vi.spyOn works cleanly
    ({ RendererFactory } = await import('../../js/engine/core/RendererFactory.js'));
  });

  it('isWebGPUAvailable returns false when navigator.gpu is absent', async () => {
    const origGpu = globalThis.navigator?.gpu;
    delete globalThis.navigator?.gpu;

    const result = await RendererFactory.isWebGPUAvailable();
    expect(result).toBe(false);

    if (origGpu !== undefined) globalThis.navigator.gpu = origGpu;
  });

  it('isWebGPUAvailable returns false when requestAdapter returns null', async () => {
    const fakeGpu = { requestAdapter: vi.fn(async () => null) };
    vi.stubGlobal('navigator', { ...globalThis.navigator, gpu: fakeGpu });

    const result = await RendererFactory.isWebGPUAvailable();
    expect(result).toBe(false);
  });

  it('isWebGPUAvailable returns false when requestAdapter throws', async () => {
    const fakeGpu = { requestAdapter: vi.fn(async () => { throw new Error('no gpu'); }) };
    vi.stubGlobal('navigator', { ...globalThis.navigator, gpu: fakeGpu });

    const result = await RendererFactory.isWebGPUAvailable();
    expect(result).toBe(false);
  });

  it('create() with hint=webgl2 never tries WebGPU', async () => {
    const spy    = vi.spyOn(RendererFactory, 'isWebGPUAvailable');
    const mockGL = { ready: true };
    vi.spyOn(RendererFactory, '_createWebGL').mockResolvedValue(mockGL);

    const r = await RendererFactory.create(null, { hint: 'webgl2' });
    expect(r).toBe(mockGL);
    expect(spy).not.toHaveBeenCalled();
  });

  it('create() with hint=webgpu falls back to WebGL when WebGPU not available', async () => {
    vi.spyOn(RendererFactory, 'isWebGPUAvailable').mockResolvedValue(false);
    const mockGL = { ready: true };
    vi.spyOn(RendererFactory, '_createWebGL').mockResolvedValue(mockGL);

    const r = await RendererFactory.create(null, { hint: 'webgpu' });
    expect(r).toBe(mockGL);
  });

  it('create() auto-hint falls back to WebGL when no WebGPU', async () => {
    vi.spyOn(RendererFactory, 'isWebGPUAvailable').mockResolvedValue(false);
    const mockGL = { ready: true };
    vi.spyOn(RendererFactory, '_createWebGL').mockResolvedValue(mockGL);

    const r = await RendererFactory.create(null, { hint: 'auto' });
    expect(r).toBe(mockGL);
  });
});

// ---------------------------------------------------------------------------
// engine-compat.js — GQEngineCompat
// ---------------------------------------------------------------------------

describe('GQEngineCompat', () => {
  beforeEach(() => {
    // Reset module state
    delete window.GQActiveRenderer;
    delete window.GQEngineCompat;
    // Reload script
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.resolve(process.cwd(), 'js/legacy/engine-compat.js'), 'utf8');
    window.eval(src); // eslint-disable-line no-eval
  });

  it('exposes GQEngineCompat on window', () => {
    expect(window.GQEngineCompat).toBeDefined();
    expect(typeof window.GQEngineCompat.getRenderer).toBe('function');
  });

  it('activeRenderer is null before initialization', () => {
    expect(window.GQEngineCompat.activeRenderer).toBeNull();
  });

  it('setHint stores value in localStorage', () => {
    window.GQEngineCompat.setHint('webgl2');
    expect(localStorage.getItem('gq:rendererHint')).toBe('webgl2');
  });
});
