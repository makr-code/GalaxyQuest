/**
 * filmgrainpass.test.js — Unit tests for FilmGrainPass.
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

const { FilmGrainPass } =
  require(path.join(root, 'js/engine/post-effects/passes/FilmGrainPass.js'));

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('FilmGrainPass — construction', () => {
  it('defaults: enabled, intensity=0.18, speed=3.0, size=1.0', () => {
    const p = new FilmGrainPass();
    expect(p.enabled).toBe(true);
    expect(p.intensity).toBeCloseTo(0.18, 5);
    expect(p.speed).toBeCloseTo(3.0, 5);
    expect(p.size).toBeCloseTo(1.0, 5);
  });

  it('accepts custom options', () => {
    const p = new FilmGrainPass({ intensity: 0.4, speed: 6.0, size: 2.0 });
    expect(p.intensity).toBeCloseTo(0.4, 5);
    expect(p.speed).toBeCloseTo(6.0, 5);
    expect(p.size).toBeCloseTo(2.0, 5);
  });

  it('_time starts at 0', () => {
    expect(new FilmGrainPass()._time).toBe(0);
  });

  it('_pipeline starts as null', () => {
    expect(new FilmGrainPass()._pipeline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('FilmGrainPass — update', () => {
  it('advances _time by dt', () => {
    const p = new FilmGrainPass();
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.016, 5);
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.032, 5);
  });

  it('coerces NaN to 0', () => {
    const p = new FilmGrainPass();
    p.update(NaN);
    expect(p._time).toBe(0);
  });

  it('accumulates over many frames', () => {
    const p = new FilmGrainPass();
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    expect(p._time).toBeCloseTo(1.0, 3);
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('FilmGrainPass — buildParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new FilmGrainPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('[0] = intensity', () => {
    expect(new FilmGrainPass({ intensity: 0.3 }).buildParamBlock()[0]).toBeCloseTo(0.3, 5);
  });

  it('[1] = speed', () => {
    expect(new FilmGrainPass({ speed: 5.0 }).buildParamBlock()[1]).toBeCloseTo(5.0, 5);
  });

  it('[2] = size', () => {
    expect(new FilmGrainPass({ size: 1.5 }).buildParamBlock()[2]).toBeCloseTo(1.5, 5);
  });

  it('[3] = time (initially 0)', () => {
    expect(new FilmGrainPass().buildParamBlock()[3]).toBe(0);
  });

  it('[3] = time after update', () => {
    const p = new FilmGrainPass();
    p.update(2.5);
    expect(p.buildParamBlock()[3]).toBeCloseTo(2.5, 5);
  });

  it('reflects runtime mutations', () => {
    const p = new FilmGrainPass();
    p.intensity = 0.9;
    p.speed = 8.0;
    p.size  = 2.5;
    const blk = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(0.9, 5);
    expect(blk[1]).toBeCloseTo(8.0, 5);
    expect(blk[2]).toBeCloseTo(2.5, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('FilmGrainPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new FilmGrainPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runFilmGrainPass when enabled', () => {
    const p = new FilmGrainPass();
    let called = false;
    p.render(null, null, { runFilmGrainPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new FilmGrainPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runFilmGrainPass: () => { called = true; } });
    expect(called).toBe(false);
  });

  it('passes self, srcTex, dstTex to renderer', () => {
    const p = new FilmGrainPass();
    const src = {};
    const dst = {};
    let args;
    p.render(src, dst, { runFilmGrainPass: (...a) => { args = a; } });
    expect(args[0]).toBe(p);
    expect(args[1]).toBe(src);
    expect(args[2]).toBe(dst);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('FilmGrainPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new FilmGrainPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('does not throw', () => {
    expect(() => new FilmGrainPass().dispose()).not.toThrow();
  });
});
