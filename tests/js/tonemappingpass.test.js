/**
 * tonemappingpass.test.js — Unit tests for ToneMappingPass.
 *
 * Tests cover:
 *   • ToneMappingMode enum values
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

const { ToneMappingPass, ToneMappingMode } =
  require(path.join(root, 'js/engine/post-effects/passes/ToneMappingPass.js'));

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

describe('ToneMappingMode', () => {
  it('REINHARD === 0', () => {
    expect(ToneMappingMode.REINHARD).toBe(0);
  });

  it('ACES === 1', () => {
    expect(ToneMappingMode.ACES).toBe(1);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(ToneMappingMode)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('ToneMappingPass — construction', () => {
  it('defaults: enabled, mode=ACES, exposure=1.0', () => {
    const p = new ToneMappingPass();
    expect(p.enabled).toBe(true);
    expect(p.mode).toBe(ToneMappingMode.ACES);
    expect(p.exposure).toBeCloseTo(1.0, 6);
  });

  it('accepts custom mode and exposure', () => {
    const p = new ToneMappingPass({ mode: ToneMappingMode.REINHARD, exposure: 1.5 });
    expect(p.mode).toBe(ToneMappingMode.REINHARD);
    expect(p.exposure).toBeCloseTo(1.5, 6);
  });

  it('_pipeline starts as null', () => {
    expect(new ToneMappingPass()._pipeline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('ToneMappingPass — buildParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new ToneMappingPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('[0] = mode (ACES = 1)', () => {
    const p = new ToneMappingPass({ mode: ToneMappingMode.ACES });
    expect(p.buildParamBlock()[0]).toBeCloseTo(1.0, 5);
  });

  it('[0] = mode (REINHARD = 0)', () => {
    const p = new ToneMappingPass({ mode: ToneMappingMode.REINHARD });
    expect(p.buildParamBlock()[0]).toBeCloseTo(0.0, 5);
  });

  it('[1] = exposure', () => {
    const p = new ToneMappingPass({ exposure: 2.4 });
    expect(p.buildParamBlock()[1]).toBeCloseTo(2.4, 5);
  });

  it('[2] and [3] are reserved (zero by default)', () => {
    const blk = new ToneMappingPass().buildParamBlock();
    expect(blk[2]).toBe(0);
    expect(blk[3]).toBe(0);
  });

  it('reflects runtime mutations', () => {
    const p = new ToneMappingPass();
    p.mode     = ToneMappingMode.REINHARD;
    p.exposure = 0.7;
    const blk = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(0.0, 5);
    expect(blk[1]).toBeCloseTo(0.7, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('ToneMappingPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new ToneMappingPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runToneMappingPass when enabled', () => {
    const p = new ToneMappingPass();
    let called = false;
    p.render(null, null, { runToneMappingPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new ToneMappingPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runToneMappingPass: () => { called = true; } });
    expect(called).toBe(false);
  });

  it('passes self, srcTex, dstTex to renderer', () => {
    const p   = new ToneMappingPass();
    const src = {};
    const dst = {};
    let args;
    p.render(src, dst, { runToneMappingPass: (...a) => { args = a; } });
    expect(args[0]).toBe(p);
    expect(args[1]).toBe(src);
    expect(args[2]).toBe(dst);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('ToneMappingPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new ToneMappingPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('does not throw', () => {
    expect(() => new ToneMappingPass().dispose()).not.toThrow();
  });
});
