/**
 * ssaopass.test.js — Unit tests for SSAOPass (Phase FX-8).
 *
 * Tests cover:
 *   • Construction: default parameters, clamped kernelSize
 *   • MAX_KERNEL_SIZE constant
 *   • setCamera(): matrix storage
 *   • regenerateKernel(): rebuilds kernel, updates kernelSize
 *   • _generateKernel (via public kernel inspection): size, values in range
 *   • noiseData + noiseTileSize: Float32Array, RGBA layout, normalised vectors
 *   • buildAOParamBlock(): size (300 floats), identity fallback, kernel packing,
 *                          resolution, noiseScale, radius/bias/power/kernelSize,
 *                          nearPlane/farPlane
 *   • buildBlurParamBlock(): size (8 floats), horizontal flag, blurRadius, depthThresh
 *   • render(): no-op when disabled, does not throw otherwise
 *   • dispose(): clears pipeline and matrices
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { SSAOPass, MAX_KERNEL_SIZE } =
  require(path.join(root, 'js/engine/post-effects/passes/SSAOPass.js'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('SSAOPass — constants', () => {
  it('MAX_KERNEL_SIZE is 64', () => {
    expect(MAX_KERNEL_SIZE).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('SSAOPass — construction', () => {
  it('defaults: enabled, radius, bias, power, kernelSize, blurRadius', () => {
    const p = new SSAOPass();
    expect(p.enabled).toBe(true);
    expect(p.radius).toBeCloseTo(0.5, 6);
    expect(p.bias).toBeCloseTo(0.025, 6);
    expect(p.power).toBeCloseTo(2.0, 6);
    expect(p.kernelSize).toBe(32);
    expect(p.blurRadius).toBe(2);
  });

  it('accepts custom parameters', () => {
    const p = new SSAOPass({ radius: 1.2, bias: 0.01, power: 3, kernelSize: 16, blurRadius: 4 });
    expect(p.radius).toBeCloseTo(1.2, 6);
    expect(p.bias).toBeCloseTo(0.01, 6);
    expect(p.power).toBeCloseTo(3, 6);
    expect(p.kernelSize).toBe(16);
    expect(p.blurRadius).toBe(4);
  });

  it('clamps kernelSize to [1, 64]', () => {
    expect(new SSAOPass({ kernelSize: 0   }).kernelSize).toBe(1);
    expect(new SSAOPass({ kernelSize: 200 }).kernelSize).toBe(64);
  });

  it('matrices start as null', () => {
    const p = new SSAOPass();
    expect(p.projMat).toBeNull();
    expect(p.invProjMat).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setCamera()
// ---------------------------------------------------------------------------

describe('SSAOPass — setCamera', () => {
  it('stores both matrices', () => {
    const p    = new SSAOPass();
    const proj = new Float32Array(16).fill(1);
    const inv  = new Float32Array(16).fill(2);
    p.setCamera(proj, inv);
    expect(p.projMat).toBe(proj);
    expect(p.invProjMat).toBe(inv);
  });
});

// ---------------------------------------------------------------------------
// regenerateKernel()
// ---------------------------------------------------------------------------

describe('SSAOPass — regenerateKernel', () => {
  it('updates kernelSize', () => {
    const p = new SSAOPass({ kernelSize: 16 });
    p.regenerateKernel(48);
    expect(p.kernelSize).toBe(48);
  });

  it('clamps to MAX_KERNEL_SIZE', () => {
    const p = new SSAOPass();
    p.regenerateKernel(200);
    expect(p.kernelSize).toBe(MAX_KERNEL_SIZE);
  });

  it('clamps to minimum of 1', () => {
    const p = new SSAOPass();
    p.regenerateKernel(0);
    expect(p.kernelSize).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Kernel data properties
// ---------------------------------------------------------------------------

describe('SSAOPass — internal kernel', () => {
  it('kernel has correct length', () => {
    const p = new SSAOPass({ kernelSize: 16 });
    expect(p._kernel.length).toBe(16);
  });

  it('each sample is a 3-element array', () => {
    const p = new SSAOPass({ kernelSize: 8 });
    for (const s of p._kernel) {
      expect(s.length).toBe(3);
    }
  });

  it('kernel samples have z > 0 (hemisphere in +z)', () => {
    const p = new SSAOPass({ kernelSize: 32 });
    for (const [, , z] of p._kernel) {
      expect(z).toBeGreaterThan(0);
    }
  });

  it('sample magnitudes are in (0, 1]', () => {
    const p = new SSAOPass({ kernelSize: 32 });
    for (const [x, y, z] of p._kernel) {
      const mag = Math.sqrt(x * x + y * y + z * z);
      expect(mag).toBeGreaterThan(0);
      expect(mag).toBeLessThanOrEqual(1.0 + 1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// Noise tile
// ---------------------------------------------------------------------------

describe('SSAOPass — noise tile', () => {
  it('noiseTileSize matches opts.noiseSize', () => {
    const p = new SSAOPass({ noiseSize: 8 });
    expect(p.noiseTileSize).toBe(8);
  });

  it('noiseData is a Float32Array of size × size × 4 floats', () => {
    const p = new SSAOPass({ noiseSize: 4 });
    expect(p.noiseData).toBeInstanceOf(Float32Array);
    expect(p.noiseData.length).toBe(4 * 4 * 4);
  });

  it('noise alpha channel is 1.0', () => {
    const p = new SSAOPass({ noiseSize: 4 });
    const d = p.noiseData;
    for (let i = 3; i < d.length; i += 4) {
      expect(d[i]).toBe(1);
    }
  });

  it('noise z channel is 0 (rotation in tangent plane)', () => {
    const p = new SSAOPass({ noiseSize: 4 });
    const d = p.noiseData;
    for (let i = 2; i < d.length; i += 4) {
      expect(d[i]).toBe(0);
    }
  });

  it('noise xy vectors are normalised (magnitude ≈ 1)', () => {
    const p = new SSAOPass({ noiseSize: 4 });
    const d = p.noiseData;
    for (let i = 0; i < d.length; i += 4) {
      const mag = Math.sqrt(d[i] ** 2 + d[i + 1] ** 2);
      expect(mag).toBeCloseTo(1.0, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// buildAOParamBlock()
// ---------------------------------------------------------------------------

describe('SSAOPass — buildAOParamBlock', () => {
  it('returns a Float32Array of 300 floats', () => {
    const p   = new SSAOPass();
    const blk = p.buildAOParamBlock(1920, 1080);
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(300);
  });

  it('uses identity matrix when projMat is null', () => {
    const p   = new SSAOPass();
    const blk = p.buildAOParamBlock(1920, 1080);
    // First mat4 identity diagonal: offsets 0,5,10,15
    expect(blk[0]).toBeCloseTo(1, 5);
    expect(blk[5]).toBeCloseTo(1, 5);
    expect(blk[10]).toBeCloseTo(1, 5);
    expect(blk[15]).toBeCloseTo(1, 5);
  });

  it('packs resolution at offset 288-289', () => {
    const p   = new SSAOPass();
    const blk = p.buildAOParamBlock(800, 600);
    expect(blk[288]).toBe(800);
    expect(blk[289]).toBe(600);
  });

  it('packs noiseScale as viewport / noiseTileSize', () => {
    const p   = new SSAOPass({ noiseSize: 4 });
    const blk = p.buildAOParamBlock(800, 600);
    expect(blk[290]).toBeCloseTo(800 / 4, 5);
    expect(blk[291]).toBeCloseTo(600 / 4, 5);
  });

  it('packs radius, bias, power, kernelSize at offsets 292-295', () => {
    const p   = new SSAOPass({ radius: 0.7, bias: 0.03, power: 1.5, kernelSize: 24 });
    const blk = p.buildAOParamBlock(1920, 1080);
    expect(blk[292]).toBeCloseTo(0.7, 5);
    expect(blk[293]).toBeCloseTo(0.03, 5);
    expect(blk[294]).toBeCloseTo(1.5, 5);
    expect(blk[295]).toBeCloseTo(24, 5);
  });

  it('packs nearPlane and farPlane at offsets 296-297', () => {
    const p = new SSAOPass();
    p.nearPlane = 0.5;
    p.farPlane  = 2000;
    const blk   = p.buildAOParamBlock(1920, 1080);
    expect(blk[296]).toBeCloseTo(0.5, 5);
    expect(blk[297]).toBeCloseTo(2000, 5);
  });

  it('packs kernel samples at offsets 32–287 (64 × vec4)', () => {
    const p   = new SSAOPass({ kernelSize: 4 });
    const blk = p.buildAOParamBlock(1920, 1080);
    // First kernel sample x/y/z should match _kernel[0]
    expect(blk[32]).toBeCloseTo(p._kernel[0][0], 5);
    expect(blk[33]).toBeCloseTo(p._kernel[0][1], 5);
    expect(blk[34]).toBeCloseTo(p._kernel[0][2], 5);
    expect(blk[35]).toBe(0); // w = 0
  });
});

// ---------------------------------------------------------------------------
// buildBlurParamBlock()
// ---------------------------------------------------------------------------

describe('SSAOPass — buildBlurParamBlock', () => {
  it('returns a Float32Array of 8 floats', () => {
    const p   = new SSAOPass();
    const blk = p.buildBlurParamBlock(1920, 1080, true);
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(8);
  });

  it('packs resolution at 0-1', () => {
    const p   = new SSAOPass();
    const blk = p.buildBlurParamBlock(640, 480, true);
    expect(blk[0]).toBe(640);
    expect(blk[1]).toBe(480);
  });

  it('horizontal=true → blk[2]=1.0', () => {
    const p   = new SSAOPass();
    expect(p.buildBlurParamBlock(1920, 1080, true)[2]).toBeCloseTo(1.0, 5);
  });

  it('horizontal=false → blk[2]=0.0', () => {
    const p   = new SSAOPass();
    expect(p.buildBlurParamBlock(1920, 1080, false)[2]).toBeCloseTo(0.0, 5);
  });

  it('packs blurRadius and depthThresh at 3-4', () => {
    const p   = new SSAOPass({ blurRadius: 5, blurDepthThresh: 0.1 });
    const blk = p.buildBlurParamBlock(1920, 1080, true);
    expect(blk[3]).toBeCloseTo(5, 5);
    expect(blk[4]).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// render() contract
// ---------------------------------------------------------------------------

describe('SSAOPass — render', () => {
  it('does not throw when called without GPU resources', () => {
    const p = new SSAOPass();
    expect(() => p.render(null, null, null)).not.toThrow();
  });

  it('is a no-op (does not call renderer) when disabled', () => {
    const p = new SSAOPass();
    p.enabled = false;
    let called = false;
    expect(() => p.render(null, null, { runSSAOPass: () => { called = true; } })).not.toThrow();
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('SSAOPass — dispose', () => {
  it('clears projMat and invProjMat', () => {
    const p   = new SSAOPass();
    const mat = new Float32Array(16);
    p.setCamera(mat, mat);
    p.dispose();
    expect(p.projMat).toBeNull();
    expect(p.invProjMat).toBeNull();
  });
});
