/**
 * motionblurpass.test.js — Unit tests for MotionBlurPass.
 *
 * Tests cover:
 *   • Construction: defaults, custom params
 *   • setVelocity(): stores velX/velY
 *   • buildParamBlock(): layout, values, clamping
 *   • render(): no-op when disabled, dispatches otherwise
 *   • dispose(): clears pipeline
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { MotionBlurPass } =
  require(path.join(root, 'js/engine/post-effects/passes/MotionBlurPass.js'));

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('MotionBlurPass — construction', () => {
  it('defaults: enabled, strength=0.8, maxSamples=6, threshold=0.001', () => {
    const p = new MotionBlurPass();
    expect(p.enabled).toBe(true);
    expect(p.strength).toBeCloseTo(0.8, 5);
    expect(p.maxSamples).toBe(6);
    expect(p.threshold).toBeCloseTo(0.001, 6);
  });

  it('accepts custom options', () => {
    const p = new MotionBlurPass({ strength: 0.5, maxSamples: 4, threshold: 0.005 });
    expect(p.strength).toBeCloseTo(0.5, 5);
    expect(p.maxSamples).toBe(4);
    expect(p.threshold).toBeCloseTo(0.005, 6);
  });

  it('clamps maxSamples to [2, 8]', () => {
    expect(new MotionBlurPass({ maxSamples: 0 }).maxSamples).toBe(2);
    expect(new MotionBlurPass({ maxSamples: 20 }).maxSamples).toBe(8);
  });

  it('velX and velY start at 0', () => {
    const p = new MotionBlurPass();
    expect(p.velX).toBe(0);
    expect(p.velY).toBe(0);
  });

  it('_pipeline starts as null', () => {
    expect(new MotionBlurPass()._pipeline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setVelocity()
// ---------------------------------------------------------------------------

describe('MotionBlurPass — setVelocity', () => {
  it('stores velX and velY', () => {
    const p = new MotionBlurPass();
    p.setVelocity(0.04, -0.02);
    expect(p.velX).toBeCloseTo(0.04, 5);
    expect(p.velY).toBeCloseTo(-0.02, 5);
  });

  it('resets to 0 when called with no args', () => {
    const p = new MotionBlurPass();
    p.velX = 0.1;
    p.velY = 0.1;
    p.setVelocity();
    expect(p.velX).toBe(0);
    expect(p.velY).toBe(0);
  });

  it('handles NaN gracefully (coerces to 0)', () => {
    const p = new MotionBlurPass();
    p.setVelocity(NaN, NaN);
    expect(p.velX).toBe(0);
    expect(p.velY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('MotionBlurPass — buildParamBlock', () => {
  it('returns a Float32Array of 8 floats', () => {
    const blk = new MotionBlurPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(8);
  });

  it('[0] = velX', () => {
    const p = new MotionBlurPass();
    p.setVelocity(0.03, 0);
    expect(p.buildParamBlock()[0]).toBeCloseTo(0.03, 5);
  });

  it('[1] = velY', () => {
    const p = new MotionBlurPass();
    p.setVelocity(0, -0.015);
    expect(p.buildParamBlock()[1]).toBeCloseTo(-0.015, 5);
  });

  it('[2] = maxSamples', () => {
    const p = new MotionBlurPass({ maxSamples: 4 });
    expect(p.buildParamBlock()[2]).toBeCloseTo(4, 5);
  });

  it('[3] = strength', () => {
    const p = new MotionBlurPass({ strength: 0.6 });
    expect(p.buildParamBlock()[3]).toBeCloseTo(0.6, 5);
  });

  it('[4] = threshold', () => {
    const p = new MotionBlurPass({ threshold: 0.005 });
    expect(p.buildParamBlock()[4]).toBeCloseTo(0.005, 6);
  });

  it('[5..7] reserved (zero)', () => {
    const blk = new MotionBlurPass().buildParamBlock();
    expect(blk[5]).toBe(0);
    expect(blk[6]).toBe(0);
    expect(blk[7]).toBe(0);
  });

  it('reflects runtime mutation of velX/velY', () => {
    const p = new MotionBlurPass();
    p.velX = 0.08;
    p.velY = 0.04;
    const blk = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(0.08, 5);
    expect(blk[1]).toBeCloseTo(0.04, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('MotionBlurPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new MotionBlurPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runMotionBlurPass when enabled', () => {
    const p = new MotionBlurPass();
    let called = false;
    p.render(null, null, { runMotionBlurPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new MotionBlurPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runMotionBlurPass: () => { called = true; } });
    expect(called).toBe(false);
  });

  it('passes self, srcTex, dstTex to renderer', () => {
    const p   = new MotionBlurPass();
    const src = {};
    const dst = {};
    let args;
    p.render(src, dst, { runMotionBlurPass: (...a) => { args = a; } });
    expect(args[0]).toBe(p);
    expect(args[1]).toBe(src);
    expect(args[2]).toBe(dst);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('MotionBlurPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new MotionBlurPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('does not throw', () => {
    expect(() => new MotionBlurPass().dispose()).not.toThrow();
  });
});
