/**
 * volumetricscatter.test.js — Unit tests for VolumetricScatter (Phase FX-7).
 *
 * Tests cover:
 *   • Construction: default properties, medium preset application
 *   • ScatterMedium enum values
 *   • setMedium(): coefficient update, unknown-medium warning
 *   • setLight(): direction normalisation, colour update
 *   • setShadowMap(): stores reference and matrix
 *   • setCamera(): stores matrices
 *   • buildParamBlock(): size, matrix identity fallback, coefficient packing,
 *                        numSteps placement, light colour + intensity
 *   • render(): no-op when disabled, returns without error when enabled
 *   • dispose(): clears references
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { VolumetricScatter, ScatterMedium } =
  require(path.join(root, 'js/engine/fx/VolumetricScatter.js'));

// ---------------------------------------------------------------------------
// ScatterMedium enum
// ---------------------------------------------------------------------------

describe('ScatterMedium enum', () => {
  it('has 6 entries', () => {
    expect(Object.keys(ScatterMedium).length).toBe(6);
  });

  it('contains NEBULA, PLASMA, DUST, ATMOSPHERE, DEEP_SPACE, CUSTOM', () => {
    expect(ScatterMedium.NEBULA).toBe('nebula');
    expect(ScatterMedium.PLASMA).toBe('plasma');
    expect(ScatterMedium.DUST).toBe('dust');
    expect(ScatterMedium.ATMOSPHERE).toBe('atmosphere');
    expect(ScatterMedium.DEEP_SPACE).toBe('deep_space');
    expect(ScatterMedium.CUSTOM).toBe('custom');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(ScatterMedium)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('VolumetricScatter — construction', () => {
  it('defaults to NEBULA medium', () => {
    const vs = new VolumetricScatter();
    expect(vs.medium).toBe(ScatterMedium.NEBULA);
  });

  it('applies NEBULA preset coefficients', () => {
    const vs = new VolumetricScatter();
    expect(vs.scatterCoeff).toBeCloseTo(0.08, 6);
    expect(vs.extinction).toBeCloseTo(0.10, 6);
    expect(vs.anisotropy).toBeCloseTo(0.00, 6);
  });

  it('applies PLASMA preset coefficients', () => {
    const vs = new VolumetricScatter({ medium: ScatterMedium.PLASMA });
    expect(vs.scatterCoeff).toBeCloseTo(0.20, 6);
    expect(vs.extinction).toBeCloseTo(0.25, 6);
    expect(vs.anisotropy).toBeCloseTo(0.30, 6);
  });

  it('applies DUST preset with negative anisotropy (back-scatter)', () => {
    const vs = new VolumetricScatter({ medium: ScatterMedium.DUST });
    expect(vs.anisotropy).toBeLessThan(0);
  });

  it('respects opt overrides (CUSTOM medium)', () => {
    const vs = new VolumetricScatter({
      medium: ScatterMedium.CUSTOM,
      scatterCoeff: 0.42,
      extinction:   0.99,
      anisotropy:  -0.5,
    });
    expect(vs.scatterCoeff).toBeCloseTo(0.42, 6);
    expect(vs.extinction).toBeCloseTo(0.99, 6);
    expect(vs.anisotropy).toBeCloseTo(-0.5, 6);
  });

  it('defaults: enabled=true, numSteps=32, shadowBias=0.005', () => {
    const vs = new VolumetricScatter();
    expect(vs.enabled).toBe(true);
    expect(vs.numSteps).toBe(32);
    expect(vs.shadowBias).toBeCloseTo(0.005, 6);
  });

  it('matrices are null until set', () => {
    const vs = new VolumetricScatter();
    expect(vs.invProjMat).toBeNull();
    expect(vs.invViewMat).toBeNull();
    expect(vs.lightVPMat).toBeNull();
    expect(vs.shadowMap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setMedium()
// ---------------------------------------------------------------------------

describe('VolumetricScatter — setMedium', () => {
  it('switches coefficients to the new preset', () => {
    const vs = new VolumetricScatter();
    vs.setMedium(ScatterMedium.ATMOSPHERE);
    expect(vs.scatterCoeff).toBeCloseTo(0.05, 6);
    expect(vs.extinction).toBeCloseTo(0.06, 6);
    expect(vs.anisotropy).toBeCloseTo(0.50, 6);
  });

  it('warns on unknown medium key', () => {
    const warns = [];
    const orig  = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    const vs = new VolumetricScatter();
    vs.setMedium('unknown_medium');
    console.warn = orig;
    expect(warns.length).toBeGreaterThan(0);
  });

  it('leaves coefficients unchanged on unknown medium', () => {
    const vs = new VolumetricScatter({ medium: ScatterMedium.PLASMA });
    const before = vs.scatterCoeff;
    console.warn = () => {}; // suppress
    vs.setMedium('bad_key');
    expect(vs.scatterCoeff).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// setLight()
// ---------------------------------------------------------------------------

describe('VolumetricScatter — setLight', () => {
  it('normalises the direction vector', () => {
    const vs = new VolumetricScatter();
    vs.setLight({ x: 0, y: -3, z: 0 }, 0xffffff);
    const [lx, ly, lz] = vs.lightDirView;
    const len = Math.sqrt(lx ** 2 + ly ** 2 + lz ** 2);
    expect(len).toBeCloseTo(1.0, 5);
    expect(ly).toBeCloseTo(-1.0, 5);
  });

  it('stores the light colour from hex', () => {
    const vs = new VolumetricScatter();
    vs.setLight({ x: 0, y: -1, z: 0 }, 0xff0000);
    expect(vs.lightColor[0]).toBeCloseTo(1.0, 5);  // R
    expect(vs.lightColor[1]).toBeCloseTo(0.0, 5);  // G
    expect(vs.lightColor[2]).toBeCloseTo(0.0, 5);  // B
  });

  it('stores intensity', () => {
    const vs = new VolumetricScatter();
    vs.setLight({ x: 1, y: 0, z: 0 }, 0xffffff, 2.5);
    expect(vs.lightIntensity).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// setShadowMap() / setCamera()
// ---------------------------------------------------------------------------

describe('VolumetricScatter — setShadowMap / setCamera', () => {
  it('setShadowMap stores the texture and matrix references', () => {
    const vs  = new VolumetricScatter();
    const tex = { type: 'shadowMap' };
    const mat = new Float32Array(16).fill(1);
    vs.setShadowMap(tex, mat);
    expect(vs.shadowMap).toBe(tex);
    expect(vs.lightVPMat).toBe(mat);
  });

  it('setCamera stores projection matrices', () => {
    const vs = new VolumetricScatter();
    const p  = new Float32Array(16).fill(2);
    const ip = new Float32Array(16).fill(3);
    vs.setCamera(p, ip);
    expect(vs.invProjMat).toBe(p);   // first arg → invProjMat
    expect(vs.invViewMat).toBe(ip);  // second arg → invViewMat
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('VolumetricScatter — buildParamBlock', () => {
  it('returns a Float32Array of 68 floats', () => {
    const vs  = new VolumetricScatter();
    const blk = vs.buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(68);
  });

  it('uses identity matrices when none are set', () => {
    const vs  = new VolumetricScatter();
    const blk = vs.buildParamBlock();
    // identity diagonal: indices 0,5,10,15 of first mat4 = 1
    expect(blk[0]).toBeCloseTo(1, 5);
    expect(blk[5]).toBeCloseTo(1, 5);
    expect(blk[10]).toBeCloseTo(1, 5);
    expect(blk[15]).toBeCloseTo(1, 5);
  });

  it('packs lightColor and intensity at correct offsets', () => {
    const vs = new VolumetricScatter({ lightColorHex: 0x00ff00, lightIntensity: 3.0 });
    const blk = vs.buildParamBlock();
    expect(blk[52]).toBeCloseTo(0, 5);   // R
    expect(blk[53]).toBeCloseTo(1, 5);   // G
    expect(blk[54]).toBeCloseTo(0, 5);   // B
    expect(blk[55]).toBeCloseTo(3.0, 5); // intensity
  });

  it('packs scatterColor and coefficient at correct offsets', () => {
    const vs = new VolumetricScatter({ scatterColorHex: 0x0000ff, scatterCoeff: 0.7 });
    const blk = vs.buildParamBlock();
    expect(blk[56]).toBeCloseTo(0, 5);   // R
    expect(blk[57]).toBeCloseTo(0, 5);   // G
    expect(blk[58]).toBeCloseTo(1, 5);   // B
    expect(blk[59]).toBeCloseTo(0.7, 5); // scatterCoeff
  });

  it('packs extinction, anisotropy, numSteps, shadowBias at offsets 60-63', () => {
    const vs = new VolumetricScatter({
      extinction: 0.3, anisotropy: 0.5, numSteps: 48, shadowBias: 0.01,
    });
    const blk = vs.buildParamBlock();
    expect(blk[60]).toBeCloseTo(0.3, 5);
    expect(blk[61]).toBeCloseTo(0.5, 5);
    expect(blk[62]).toBeCloseTo(48, 5);
    expect(blk[63]).toBeCloseTo(0.01, 5);
  });

  it('packs nearPlane and farPlane at offsets 64-65', () => {
    const vs = new VolumetricScatter({ nearPlane: 1.0, farPlane: 5000 });
    const blk = vs.buildParamBlock();
    expect(blk[64]).toBeCloseTo(1.0, 5);
    expect(blk[65]).toBeCloseTo(5000, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('VolumetricScatter — render', () => {
  it('does not throw when called without GPU resources', () => {
    const vs = new VolumetricScatter();
    expect(() => vs.render(null, null, null)).not.toThrow();
  });

  it('is a no-op when enabled=false', () => {
    const vs = new VolumetricScatter();
    vs.enabled = false;
    let called = false;
    // Even if renderer were real, the guard prevents dispatch
    expect(() => vs.render(null, null, { runVolScatterPass: () => { called = true; } })).not.toThrow();
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('VolumetricScatter — dispose', () => {
  it('clears all GPU/matrix references', () => {
    const vs  = new VolumetricScatter();
    const mat = new Float32Array(16);
    vs.setShadowMap({ type: 'tex' }, mat);
    vs.setCamera(mat, mat);
    vs.dispose();
    expect(vs.shadowMap).toBeNull();
    expect(vs.invProjMat).toBeNull();
    expect(vs.invViewMat).toBeNull();
    expect(vs.lightVPMat).toBeNull();
  });
});
