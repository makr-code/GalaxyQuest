/**
 * dustlayerpass.test.js — Unit tests for DustLayerPass.
 *
 * Tests cover:
 *   • DUST_LAYER_COUNT constant
 *   • Construction: defaults, custom masterOpacity, custom layers
 *   • Layer record structure and count
 *   • update(): advances _time
 *   • buildParamBlock(): layout, layer packing, tail params
 *   • render(): no-op when disabled, dispatches otherwise
 *   • dispose(): clears pipeline
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { DustLayerPass, DUST_LAYER_COUNT } =
  require(path.join(root, 'js/engine/post-effects/passes/DustLayerPass.js'));

const FLOATS_PER_LAYER = 8;
const TOTAL_FLOATS     = DUST_LAYER_COUNT * FLOATS_PER_LAYER + 4;

// ---------------------------------------------------------------------------
// Constant
// ---------------------------------------------------------------------------

describe('DUST_LAYER_COUNT', () => {
  it('equals 3', () => {
    expect(DUST_LAYER_COUNT).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('DustLayerPass — construction', () => {
  it('defaults: enabled, masterOpacity=0.22', () => {
    const p = new DustLayerPass();
    expect(p.enabled).toBe(true);
    expect(p.masterOpacity).toBeCloseTo(0.22, 5);
  });

  it('accepts custom masterOpacity', () => {
    const p = new DustLayerPass({ masterOpacity: 0.5 });
    expect(p.masterOpacity).toBeCloseTo(0.5, 5);
  });

  it(`has exactly ${DUST_LAYER_COUNT} layers`, () => {
    expect(new DustLayerPass().layers.length).toBe(DUST_LAYER_COUNT);
  });

  it('each layer has scrollX, scrollY, scale, opacity, colorHex', () => {
    const p = new DustLayerPass();
    for (const layer of p.layers) {
      expect(typeof layer.scrollX).toBe('number');
      expect(typeof layer.scrollY).toBe('number');
      expect(typeof layer.scale).toBe('number');
      expect(typeof layer.opacity).toBe('number');
      expect(typeof layer.colorHex).toBe('number');
    }
  });

  it('_time starts at 0', () => {
    expect(new DustLayerPass()._time).toBe(0);
  });

  it('_pipeline starts as null', () => {
    expect(new DustLayerPass()._pipeline).toBeNull();
  });

  it('accepts custom layer presets', () => {
    const customLayers = [
      { scrollX: 0.1, scrollY: 0.05, scale: 4.0, opacity: 0.2, colorHex: 0xff0000 },
      { scrollX: 0.05, scrollY: 0.02, scale: 2.0, opacity: 0.15, colorHex: 0x00ff00 },
      { scrollX: 0.01, scrollY: 0.005, scale: 1.0, opacity: 0.1, colorHex: 0x0000ff },
    ];
    const p = new DustLayerPass({ layers: customLayers });
    expect(p.layers[0].scrollX).toBeCloseTo(0.1, 5);
    expect(p.layers[2].colorHex).toBe(0x0000ff);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('DustLayerPass — update', () => {
  it('advances _time by dt', () => {
    const p = new DustLayerPass();
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.016, 5);
    p.update(1.0);
    expect(p._time).toBeCloseTo(1.016, 5);
  });

  it('does not throw with NaN dt', () => {
    expect(() => new DustLayerPass().update(NaN)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('DustLayerPass — buildParamBlock', () => {
  it(`returns Float32Array of ${TOTAL_FLOATS} floats`, () => {
    const blk = new DustLayerPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(TOTAL_FLOATS);
  });

  it('layer 0 scrollX at offset 0', () => {
    const p = new DustLayerPass();
    const blk = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(p.layers[0].scrollX, 5);
  });

  it('layer 0 scrollY at offset 1', () => {
    const p = new DustLayerPass();
    const blk = p.buildParamBlock();
    expect(blk[1]).toBeCloseTo(p.layers[0].scrollY, 5);
  });

  it('layer 0 scale at offset 2', () => {
    const p = new DustLayerPass();
    const blk = p.buildParamBlock();
    expect(blk[2]).toBeCloseTo(p.layers[0].scale, 5);
  });

  it('layer 0 opacity at offset 3', () => {
    const p = new DustLayerPass();
    const blk = p.buildParamBlock();
    expect(blk[3]).toBeCloseTo(p.layers[0].opacity, 5);
  });

  it('layer 0 colour decoded from colorHex', () => {
    const p = new DustLayerPass({ layers: [
      { scrollX: 0, scrollY: 0, scale: 1, opacity: 0.1, colorHex: 0xff8000 },
      { scrollX: 0, scrollY: 0, scale: 1, opacity: 0.1, colorHex: 0x000000 },
      { scrollX: 0, scrollY: 0, scale: 1, opacity: 0.1, colorHex: 0x000000 },
    ]});
    const blk = p.buildParamBlock();
    expect(blk[4]).toBeCloseTo(1.0, 5);            // r = 0xff/255
    expect(blk[5]).toBeCloseTo(0x80 / 255, 3);     // g = 0x80/255
    expect(blk[6]).toBeCloseTo(0, 5);              // b = 0
  });

  it('layer 1 starts at offset 8', () => {
    const p = new DustLayerPass();
    const blk = p.buildParamBlock();
    expect(blk[8]).toBeCloseTo(p.layers[1].scrollX, 5);
  });

  it('layer 2 starts at offset 16', () => {
    const p = new DustLayerPass();
    const blk = p.buildParamBlock();
    expect(blk[16]).toBeCloseTo(p.layers[2].scrollX, 5);
  });

  it('tail [24] = time', () => {
    const p = new DustLayerPass();
    p.update(5.5);
    const blk = p.buildParamBlock();
    expect(blk[24]).toBeCloseTo(5.5, 4);
  });

  it('tail [25] = masterOpacity', () => {
    const p = new DustLayerPass({ masterOpacity: 0.4 });
    const blk = p.buildParamBlock();
    expect(blk[25]).toBeCloseTo(0.4, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('DustLayerPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new DustLayerPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runDustLayerPass when enabled', () => {
    const p = new DustLayerPass();
    let called = false;
    p.render(null, null, { runDustLayerPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new DustLayerPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runDustLayerPass: () => { called = true; } });
    expect(called).toBe(false);
  });

  it('passes self, srcTex, dstTex to renderer', () => {
    const p   = new DustLayerPass();
    const src = {};
    const dst = {};
    let args;
    p.render(src, dst, { runDustLayerPass: (...a) => { args = a; } });
    expect(args[0]).toBe(p);
    expect(args[1]).toBe(src);
    expect(args[2]).toBe(dst);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('DustLayerPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new DustLayerPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('does not throw', () => {
    expect(() => new DustLayerPass().dispose()).not.toThrow();
  });
});
