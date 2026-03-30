/**
 * tests/webgpu/renderer.test.js
 *
 * Tests for RendererFactory capability detection and interface compliance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Load modules under test
// ---------------------------------------------------------------------------

function loadModule(relPath) {
  const src = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
  // Strip "use strict" and module.exports for eval
  const wrapped = `(function(module, require){ ${src} })`;
  return wrapped;
}

// Minimal mock for IGraphicsRenderer
class MockRenderer {
  async initialize() { this.ready = true; }
  getCapabilities() { return { webgpu: false, webgl2: true, computeShaders: false, maxTextureSize: 4096 }; }
  createBuffer()    { return {}; }
  createTexture()   { return {}; }
  createShader()    { return {}; }
  createRenderPass(){ return {}; }
  render()          {}
  resize()          {}
  dispose()         { this.ready = false; }
}

// ---------------------------------------------------------------------------

describe('IGraphicsRenderer interface', () => {
  it('throws on every unimplemented method', async () => {
    const { IGraphicsRenderer } = await import('../../js/engine/core/GraphicsContext.js');
    const r = new IGraphicsRenderer();
    await expect(r.initialize(null)).rejects.toThrow(/not implemented/);
    expect(() => r.getCapabilities()).toThrow(/not implemented/);
    expect(() => r.createBuffer()).toThrow(/not implemented/);
    expect(() => r.createTexture()).toThrow(/not implemented/);
    expect(() => r.createShader()).toThrow(/not implemented/);
    expect(() => r.createRenderPass()).toThrow(/not implemented/);
    expect(() => r.render()).toThrow(/not implemented/);
    expect(() => r.resize()).toThrow(/not implemented/);
    expect(() => r.dispose()).toThrow(/not implemented/);
  });
});

describe('MockRenderer — interface compliance', () => {
  it('implements all required IGraphicsRenderer methods', async () => {
    const r = new MockRenderer();
    await r.initialize(null);
    expect(r.ready).toBe(true);
    expect(r.getCapabilities().webgl2).toBe(true);
    expect(r.createBuffer('vertex', new Float32Array([1, 2, 3]))).toBeTruthy();
    expect(r.createTexture({ width: 4, height: 4 })).toBeTruthy();
    r.render({}, {});
    r.resize(800, 600);
    r.dispose();
    expect(r.ready).toBe(false);
  });
});

describe('RendererFactory.isWebGPUAvailable', () => {
  beforeEach(() => {
    // navigator.gpu is not present in jsdom — factory must handle this
    delete globalThis.navigator?.gpu;
  });

  it('returns false when navigator.gpu is absent', async () => {
    const { RendererFactory } = await import('../../js/engine/core/RendererFactory.js');
    const available = await RendererFactory.isWebGPUAvailable();
    expect(available).toBe(false);
  });

  it('falls back to WebGL2 when WebGPU probe fails', async () => {
    const { RendererFactory } = await import('../../js/engine/core/RendererFactory.js');

    // Stub _createWebGL to return a mock renderer
    const mockGL = new MockRenderer();
    vi.spyOn(RendererFactory, '_createWebGL').mockResolvedValue(mockGL);

    const r = await RendererFactory.create(null, { hint: 'auto' });
    expect(r).toBe(mockGL);
  });
});
