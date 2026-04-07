/**
 * colorgradigpass.test.js — Unit tests for ColorGradingPass.
 *
 * Tests cover:
 *   • Construction: defaults, custom params
 *   • buildParamBlock(): layout, values
 *   • render(): no-op when disabled, dispatches to renderer otherwise
 *   • dispose(): clears pipeline reference
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { ColorGradingPass } =
  require(path.join(root, 'js/engine/post-effects/passes/ColorGradingPass.js'));

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('ColorGradingPass — construction', () => {
  it('defaults: enabled, brightness=0, contrast=1, saturation=1, hueShift=0', () => {
    const p = new ColorGradingPass();
    expect(p.enabled).toBe(true);
    expect(p.brightness).toBeCloseTo(0.0, 5);
    expect(p.contrast).toBeCloseTo(1.0, 5);
    expect(p.saturation).toBeCloseTo(1.0, 5);
    expect(p.hueShift).toBeCloseTo(0.0, 5);
  });

  it('accepts custom options', () => {
    const p = new ColorGradingPass({ brightness: 0.1, contrast: 1.2, saturation: 1.4, hueShift: 0.3 });
    expect(p.brightness).toBeCloseTo(0.1, 5);
    expect(p.contrast).toBeCloseTo(1.2, 5);
    expect(p.saturation).toBeCloseTo(1.4, 5);
    expect(p.hueShift).toBeCloseTo(0.3, 5);
  });

  it('allows negative brightness (darken)', () => {
    const p = new ColorGradingPass({ brightness: -0.2 });
    expect(p.brightness).toBeCloseTo(-0.2, 5);
  });

  it('_pipeline starts as null', () => {
    expect(new ColorGradingPass()._pipeline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('ColorGradingPass — buildParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new ColorGradingPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('[0] = brightness', () => {
    expect(new ColorGradingPass({ brightness: 0.15 }).buildParamBlock()[0]).toBeCloseTo(0.15, 5);
  });

  it('[1] = contrast', () => {
    expect(new ColorGradingPass({ contrast: 1.3 }).buildParamBlock()[1]).toBeCloseTo(1.3, 5);
  });

  it('[2] = saturation', () => {
    expect(new ColorGradingPass({ saturation: 1.5 }).buildParamBlock()[2]).toBeCloseTo(1.5, 5);
  });

  it('[3] = hueShift', () => {
    expect(new ColorGradingPass({ hueShift: Math.PI }).buildParamBlock()[3]).toBeCloseTo(Math.PI, 5);
  });

  it('default block = [0, 1, 1, 0]', () => {
    const blk = new ColorGradingPass().buildParamBlock();
    expect(blk[0]).toBeCloseTo(0.0, 5);
    expect(blk[1]).toBeCloseTo(1.0, 5);
    expect(blk[2]).toBeCloseTo(1.0, 5);
    expect(blk[3]).toBeCloseTo(0.0, 5);
  });

  it('reflects runtime mutations', () => {
    const p = new ColorGradingPass();
    p.brightness = -0.1;
    p.contrast   = 0.8;
    p.saturation = 0.5;
    p.hueShift   = 1.2;
    const blk = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(-0.1, 5);
    expect(blk[1]).toBeCloseTo(0.8, 5);
    expect(blk[2]).toBeCloseTo(0.5, 5);
    expect(blk[3]).toBeCloseTo(1.2, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('ColorGradingPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new ColorGradingPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runColorGradingPass when enabled', () => {
    const p = new ColorGradingPass();
    let called = false;
    p.render(null, null, { runColorGradingPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new ColorGradingPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runColorGradingPass: () => { called = true; } });
    expect(called).toBe(false);
  });

  it('passes self, srcTex, dstTex to renderer', () => {
    const p = new ColorGradingPass();
    const src = {};
    const dst = {};
    let args;
    p.render(src, dst, { runColorGradingPass: (...a) => { args = a; } });
    expect(args[0]).toBe(p);
    expect(args[1]).toBe(src);
    expect(args[2]).toBe(dst);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('ColorGradingPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new ColorGradingPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('does not throw', () => {
    expect(() => new ColorGradingPass().dispose()).not.toThrow();
  });
});
