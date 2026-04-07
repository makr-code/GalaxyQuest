/**
 * starscintillationpass.test.js — Unit tests for StarScintillationPass.
 *
 * Tests cover:
 *   • Construction: defaults, custom params
 *   • update(): advances _time
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

const { StarScintillationPass } =
  require(path.join(root, 'js/engine/post-effects/passes/StarScintillationPass.js'));

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('StarScintillationPass — construction', () => {
  it('defaults: enabled, threshold=0.8, amplitude=0.3, speed=2.0', () => {
    const p = new StarScintillationPass();
    expect(p.enabled).toBe(true);
    expect(p.threshold).toBeCloseTo(0.8, 5);
    expect(p.amplitude).toBeCloseTo(0.3, 5);
    expect(p.speed).toBeCloseTo(2.0, 5);
  });

  it('accepts custom options', () => {
    const p = new StarScintillationPass({ threshold: 0.6, amplitude: 0.5, speed: 4.0 });
    expect(p.threshold).toBeCloseTo(0.6, 5);
    expect(p.amplitude).toBeCloseTo(0.5, 5);
    expect(p.speed).toBeCloseTo(4.0, 5);
  });

  it('_time starts at 0', () => {
    expect(new StarScintillationPass()._time).toBe(0);
  });

  it('_pipeline starts as null', () => {
    expect(new StarScintillationPass()._pipeline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('StarScintillationPass — update', () => {
  it('advances _time by dt', () => {
    const p = new StarScintillationPass();
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.016, 5);
  });

  it('accumulates over multiple calls', () => {
    const p = new StarScintillationPass();
    p.update(1.0);
    p.update(0.5);
    expect(p._time).toBeCloseTo(1.5, 5);
  });

  it('coerces NaN to 0', () => {
    const p = new StarScintillationPass();
    p.update(NaN);
    expect(p._time).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('StarScintillationPass — buildParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new StarScintillationPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('[0] = threshold', () => {
    expect(new StarScintillationPass({ threshold: 0.75 }).buildParamBlock()[0]).toBeCloseTo(0.75, 5);
  });

  it('[1] = amplitude', () => {
    expect(new StarScintillationPass({ amplitude: 0.4 }).buildParamBlock()[1]).toBeCloseTo(0.4, 5);
  });

  it('[2] = speed', () => {
    expect(new StarScintillationPass({ speed: 5.0 }).buildParamBlock()[2]).toBeCloseTo(5.0, 5);
  });

  it('[3] = time (initially 0)', () => {
    expect(new StarScintillationPass().buildParamBlock()[3]).toBe(0);
  });

  it('[3] = time after update', () => {
    const p = new StarScintillationPass();
    p.update(3.14);
    expect(p.buildParamBlock()[3]).toBeCloseTo(3.14, 4);
  });

  it('reflects runtime mutations', () => {
    const p = new StarScintillationPass();
    p.threshold = 0.9;
    p.amplitude = 0.2;
    p.speed     = 1.5;
    const blk   = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(0.9, 5);
    expect(blk[1]).toBeCloseTo(0.2, 5);
    expect(blk[2]).toBeCloseTo(1.5, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('StarScintillationPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new StarScintillationPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runStarScintillationPass when enabled', () => {
    const p = new StarScintillationPass();
    let called = false;
    p.render(null, null, { runStarScintillationPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new StarScintillationPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runStarScintillationPass: () => { called = true; } });
    expect(called).toBe(false);
  });

  it('passes self, srcTex, dstTex to renderer', () => {
    const p = new StarScintillationPass();
    const src = {};
    const dst = {};
    let args;
    p.render(src, dst, { runStarScintillationPass: (...a) => { args = a; } });
    expect(args[0]).toBe(p);
    expect(args[1]).toBe(src);
    expect(args[2]).toBe(dst);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('StarScintillationPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new StarScintillationPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('does not throw', () => {
    expect(() => new StarScintillationPass().dispose()).not.toThrow();
  });
});
