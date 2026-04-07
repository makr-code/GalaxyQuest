/**
 * diskrotationparallaxpass.test.js — Unit tests for DiskRotationParallaxPass.
 *
 * Tests cover:
 *   • Construction: defaults, custom params
 *   • update(): advances _time
 *   • buildParamBlock(): layout, values, padding
 *   • render(): no-op when disabled, dispatches to renderer otherwise
 *   • dispose(): clears pipeline reference
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { DiskRotationParallaxPass } =
  require(path.join(root, 'js/engine/post-effects/passes/DiskRotationParallaxPass.js'));

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('DiskRotationParallaxPass — construction', () => {
  it('defaults: enabled, innerVelocity=0.15, outerVelocity=0.02, center=(0.5,0.5)', () => {
    const p = new DiskRotationParallaxPass();
    expect(p.enabled).toBe(true);
    expect(p.innerVelocity).toBeCloseTo(0.15, 5);
    expect(p.outerVelocity).toBeCloseTo(0.02, 5);
    expect(p.centerX).toBeCloseTo(0.5, 5);
    expect(p.centerY).toBeCloseTo(0.5, 5);
  });

  it('accepts custom options', () => {
    const p = new DiskRotationParallaxPass({
      innerVelocity: 0.3,
      outerVelocity: 0.01,
      centerX: 0.4,
      centerY: 0.6,
    });
    expect(p.innerVelocity).toBeCloseTo(0.3, 5);
    expect(p.outerVelocity).toBeCloseTo(0.01, 5);
    expect(p.centerX).toBeCloseTo(0.4, 5);
    expect(p.centerY).toBeCloseTo(0.6, 5);
  });

  it('_time starts at 0', () => {
    expect(new DiskRotationParallaxPass()._time).toBe(0);
  });

  it('_pipeline starts as null', () => {
    expect(new DiskRotationParallaxPass()._pipeline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('DiskRotationParallaxPass — update', () => {
  it('advances _time by dt', () => {
    const p = new DiskRotationParallaxPass();
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.016, 5);
  });

  it('accumulates over multiple calls', () => {
    const p = new DiskRotationParallaxPass();
    p.update(1.0);
    p.update(2.0);
    expect(p._time).toBeCloseTo(3.0, 5);
  });

  it('coerces NaN to 0', () => {
    const p = new DiskRotationParallaxPass();
    p.update(NaN);
    expect(p._time).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('DiskRotationParallaxPass — buildParamBlock', () => {
  it('returns a Float32Array of 8 floats', () => {
    const blk = new DiskRotationParallaxPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(8);
  });

  it('[0] = innerVelocity', () => {
    const p = new DiskRotationParallaxPass({ innerVelocity: 0.2 });
    expect(p.buildParamBlock()[0]).toBeCloseTo(0.2, 5);
  });

  it('[1] = outerVelocity', () => {
    const p = new DiskRotationParallaxPass({ outerVelocity: 0.05 });
    expect(p.buildParamBlock()[1]).toBeCloseTo(0.05, 5);
  });

  it('[2] = centerX', () => {
    const p = new DiskRotationParallaxPass({ centerX: 0.4 });
    expect(p.buildParamBlock()[2]).toBeCloseTo(0.4, 5);
  });

  it('[3] = centerY', () => {
    const p = new DiskRotationParallaxPass({ centerY: 0.6 });
    expect(p.buildParamBlock()[3]).toBeCloseTo(0.6, 5);
  });

  it('[4] = time (initially 0)', () => {
    expect(new DiskRotationParallaxPass().buildParamBlock()[4]).toBe(0);
  });

  it('[4] = time after update', () => {
    const p = new DiskRotationParallaxPass();
    p.update(7.5);
    expect(p.buildParamBlock()[4]).toBeCloseTo(7.5, 5);
  });

  it('[5..7] reserved (zero)', () => {
    const blk = new DiskRotationParallaxPass().buildParamBlock();
    expect(blk[5]).toBe(0);
    expect(blk[6]).toBe(0);
    expect(blk[7]).toBe(0);
  });

  it('reflects runtime mutations', () => {
    const p = new DiskRotationParallaxPass();
    p.innerVelocity = 0.5;
    p.outerVelocity = 0.08;
    p.centerX = 0.3;
    p.centerY = 0.7;
    const blk = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(0.5, 5);
    expect(blk[1]).toBeCloseTo(0.08, 5);
    expect(blk[2]).toBeCloseTo(0.3, 5);
    expect(blk[3]).toBeCloseTo(0.7, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('DiskRotationParallaxPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new DiskRotationParallaxPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runDiskRotationParallaxPass when enabled', () => {
    const p = new DiskRotationParallaxPass();
    let called = false;
    p.render(null, null, { runDiskRotationParallaxPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new DiskRotationParallaxPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runDiskRotationParallaxPass: () => { called = true; } });
    expect(called).toBe(false);
  });

  it('passes self, srcTex, dstTex to renderer', () => {
    const p = new DiskRotationParallaxPass();
    const src = {};
    const dst = {};
    let args;
    p.render(src, dst, { runDiskRotationParallaxPass: (...a) => { args = a; } });
    expect(args[0]).toBe(p);
    expect(args[1]).toBe(src);
    expect(args[2]).toBe(dst);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('DiskRotationParallaxPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new DiskRotationParallaxPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('does not throw', () => {
    expect(() => new DiskRotationParallaxPass().dispose()).not.toThrow();
  });
});
