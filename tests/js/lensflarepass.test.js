/**
 * lensflarepass.test.js — Unit tests for LensFlarePass.
 *
 * Tests cover:
 *   • MAX_FLARE_SOURCES constant
 *   • Construction: defaults, custom params
 *   • addSource(): returns unique IDs, stores source data
 *   • updateSourcePosition(): moves existing sources
 *   • removeSource(): removes by ID
 *   • clearSources(): empties source set
 *   • sourceCount getter
 *   • update(): advances _time, updates aspect
 *   • buildParamBlock(): layout, active flags, tail params
 *   • render(): no-op when disabled, dispatches otherwise
 *   • dispose(): clears pipeline, clears sources
 */

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { LensFlarePass, MAX_FLARE_SOURCES } =
  require(path.join(root, 'js/engine/post-effects/passes/LensFlarePass.js'));

const FLOATS_PER_SOURCE = 8;
const TAIL_FLOATS       = 4;
const TOTAL_FLOATS      = MAX_FLARE_SOURCES * FLOATS_PER_SOURCE + TAIL_FLOATS;

// ---------------------------------------------------------------------------
// Constant
// ---------------------------------------------------------------------------

describe('MAX_FLARE_SOURCES', () => {
  it('equals 8', () => {
    expect(MAX_FLARE_SOURCES).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('LensFlarePass — construction', () => {
  it('defaults: enabled, globalScale=1, ghostCount=3, aspect=1', () => {
    const p = new LensFlarePass();
    expect(p.enabled).toBe(true);
    expect(p.globalScale).toBeCloseTo(1.0, 6);
    expect(p.ghostCount).toBe(3);
    expect(p.aspect).toBeCloseTo(1.0, 6);
  });

  it('accepts custom options', () => {
    const p = new LensFlarePass({ globalScale: 2.0, ghostCount: 4, aspect: 1.78 });
    expect(p.globalScale).toBeCloseTo(2.0, 6);
    expect(p.ghostCount).toBe(4);
    expect(p.aspect).toBeCloseTo(1.78, 5);
  });

  it('clamps ghostCount to [1, 4]', () => {
    expect(new LensFlarePass({ ghostCount: 0 }).ghostCount).toBe(1);
    expect(new LensFlarePass({ ghostCount: 10 }).ghostCount).toBe(4);
  });

  it('starts with 0 sources', () => {
    expect(new LensFlarePass().sourceCount).toBe(0);
  });

  it('_time starts at 0', () => {
    expect(new LensFlarePass()._time).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Source management
// ---------------------------------------------------------------------------

describe('LensFlarePass — addSource', () => {
  it('returns a unique numeric ID', () => {
    const p  = new LensFlarePass();
    const id1 = p.addSource(0.1, 0.2);
    const id2 = p.addSource(-0.3, 0.4);
    expect(typeof id1).toBe('number');
    expect(id2).not.toBe(id1);
  });

  it('increments sourceCount', () => {
    const p = new LensFlarePass();
    p.addSource(0, 0);
    expect(p.sourceCount).toBe(1);
    p.addSource(0.1, 0.1);
    expect(p.sourceCount).toBe(2);
  });

  it('stores position, intensity and colour', () => {
    const p  = new LensFlarePass();
    const id = p.addSource(0.5, -0.3, 2.0, 0xff8800);
    const src = p._sources.get(id);
    expect(src.x).toBeCloseTo(0.5, 5);
    expect(src.y).toBeCloseTo(-0.3, 5);
    expect(src.intensity).toBeCloseTo(2.0, 5);
    expect(src.r).toBeCloseTo(1.0, 5);    // 0xff / 255
    expect(src.g).toBeCloseTo(0x88 / 255, 4);
    expect(src.b).toBeCloseTo(0, 5);
  });

  it('defaults intensity=1 and colour=0xffeebb', () => {
    const p   = new LensFlarePass();
    const id  = p.addSource(0, 0);
    const src = p._sources.get(id);
    expect(src.intensity).toBeCloseTo(1.0, 5);
    expect(src.r).toBeCloseTo(0xff / 255, 4);
    expect(src.g).toBeCloseTo(0xee / 255, 4);
    expect(src.b).toBeCloseTo(0xbb / 255, 4);
  });
});

describe('LensFlarePass — updateSourcePosition', () => {
  it('updates x and y', () => {
    const p  = new LensFlarePass();
    const id = p.addSource(0, 0);
    p.updateSourcePosition(id, 0.7, -0.4);
    const src = p._sources.get(id);
    expect(src.x).toBeCloseTo(0.7, 5);
    expect(src.y).toBeCloseTo(-0.4, 5);
  });

  it('is a no-op for unknown ID', () => {
    expect(() => new LensFlarePass().updateSourcePosition(999, 0, 0)).not.toThrow();
  });
});

describe('LensFlarePass — removeSource', () => {
  it('removes the source by ID', () => {
    const p  = new LensFlarePass();
    const id = p.addSource(0, 0);
    p.removeSource(id);
    expect(p.sourceCount).toBe(0);
  });

  it('is a no-op for unknown ID', () => {
    const p = new LensFlarePass();
    p.addSource(0, 0);
    p.removeSource(999);
    expect(p.sourceCount).toBe(1);
  });
});

describe('LensFlarePass — clearSources', () => {
  it('removes all sources', () => {
    const p = new LensFlarePass();
    p.addSource(0, 0);
    p.addSource(0.5, 0.5);
    p.clearSources();
    expect(p.sourceCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('LensFlarePass — update', () => {
  it('advances _time by dt', () => {
    const p = new LensFlarePass();
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.016, 5);
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.032, 5);
  });

  it('updates aspect when provided', () => {
    const p = new LensFlarePass();
    p.update(0.016, 1.78);
    expect(p.aspect).toBeCloseTo(1.78, 4);
  });

  it('does not change aspect when omitted', () => {
    const p = new LensFlarePass({ aspect: 2.0 });
    p.update(0.016);
    expect(p.aspect).toBeCloseTo(2.0, 5);
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('LensFlarePass — buildParamBlock', () => {
  it(`returns Float32Array of ${TOTAL_FLOATS} floats`, () => {
    const blk = new LensFlarePass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(TOTAL_FLOATS);
  });

  it('all sources inactive when no sources registered', () => {
    const blk = new LensFlarePass().buildParamBlock();
    for (let i = 0; i < MAX_FLARE_SOURCES; i++) {
      const base = i * FLOATS_PER_SOURCE;
      expect(blk[base + 6]).toBe(0); // active = 0
    }
  });

  it('first source packed correctly when one source added', () => {
    const p  = new LensFlarePass();
    p.addSource(0.3, -0.6, 1.5, 0x0080ff);
    const blk = p.buildParamBlock();

    expect(blk[0]).toBeCloseTo(0.3, 5);   // posX
    expect(blk[1]).toBeCloseTo(-0.6, 5);  // posY
    expect(blk[2]).toBeCloseTo(1.5, 5);   // intensity
    expect(blk[3]).toBeCloseTo(0, 5);     // r = 0
    expect(blk[4]).toBeCloseTo(0x80 / 255, 3); // g
    expect(blk[5]).toBeCloseTo(1.0, 5);   // b = 255
    expect(blk[6]).toBeCloseTo(1.0, 5);   // active = 1
  });

  it('second source slot remains inactive when only one source added', () => {
    const p = new LensFlarePass();
    p.addSource(0, 0);
    const blk = p.buildParamBlock();
    expect(blk[FLOATS_PER_SOURCE + 6]).toBe(0); // second source active = 0
  });

  it('tail: [N*8] = globalScale', () => {
    const p   = new LensFlarePass({ globalScale: 1.5 });
    const blk = p.buildParamBlock();
    const tail = MAX_FLARE_SOURCES * FLOATS_PER_SOURCE;
    expect(blk[tail]).toBeCloseTo(1.5, 5);
  });

  it('tail: [N*8+1] = ghostCount', () => {
    const p   = new LensFlarePass({ ghostCount: 2 });
    const blk = p.buildParamBlock();
    const tail = MAX_FLARE_SOURCES * FLOATS_PER_SOURCE;
    expect(blk[tail + 1]).toBeCloseTo(2, 5);
  });

  it('tail: [N*8+2] = aspect', () => {
    const p = new LensFlarePass({ aspect: 1.78 });
    const blk = p.buildParamBlock();
    const tail = MAX_FLARE_SOURCES * FLOATS_PER_SOURCE;
    expect(blk[tail + 2]).toBeCloseTo(1.78, 3);
  });

  it('tail: [N*8+3] = time', () => {
    const p = new LensFlarePass();
    p.update(3.14);
    const blk = p.buildParamBlock();
    const tail = MAX_FLARE_SOURCES * FLOATS_PER_SOURCE;
    expect(blk[tail + 3]).toBeCloseTo(3.14, 4);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('LensFlarePass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new LensFlarePass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runLensFlarePass when enabled', () => {
    const p = new LensFlarePass();
    let called = false;
    p.render(null, null, { runLensFlarePass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new LensFlarePass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runLensFlarePass: () => { called = true; } });
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('LensFlarePass — dispose', () => {
  it('executes projected solar flares additively and releases its GPU resources', async () => {
    const pass = new LensFlarePass();
    const buffer = { destroy: vi.fn() };
    const device = { createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
      createBuffer: vi.fn(() => buffer), createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() } };
    const renderPass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() };
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    try {
      await pass.initialize(device, 'bgra8unorm', 'shader fixture');
      pass.setProjectedSources([{ x: 0.3, y: -0.2, intensity: 0.5, colorHex: 0xff8800 },
        { x: 0, y: 0, intensity: 0 }]);
      expect(pass.sourceCount).toBe(1);
      pass.renderOverlay(renderPass, device, { aspect: 16 / 9, time: 2 });
      expect(renderPass.draw).toHaveBeenCalledWith(6);
      expect(device.createRenderPipeline.mock.calls[0][0].fragment.entryPoint).toBe('fs_overlay');
      expect(device.createRenderPipeline.mock.calls[0][0].fragment.targets[0].blend.color.dstFactor).toBe('one');
      expect(device.queue.writeBuffer.mock.calls[0][2][0]).toBeCloseTo(0.3);
      expect(device.queue.writeBuffer.mock.calls[0][2][67]).toBe(2);
      pass.setProjectedSources([]);
      pass.renderOverlay(renderPass, device, { aspect: 1 });
      expect(renderPass.draw).toHaveBeenCalledOnce();
      pass.dispose();
      expect(buffer.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('clears _pipeline', () => {
    const p = new LensFlarePass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('clears all sources', () => {
    const p = new LensFlarePass();
    p.addSource(0, 0);
    p.dispose();
    expect(p.sourceCount).toBe(0);
  });
});
