/**
 * post-effects.test.js — Unit tests for the post-processing pipeline.
 *
 * Tests cover:
 *   BloomPass, VignettePass, ChromaticPass, MotionBlurPass, ToneMappingPass,
 *   LensFlarePass, DepthOfFieldPass, VolumetricDustPass, CoronaPass,
 *   StarScintillationPass, and EffectComposer.
 *
 * Phase 3-5 Additions:
 *   DepthOfFieldPass
 *     • Construction: default params, custom params
 *     • buildCoCParamBlock(): Circle of Confusion parameters
 *     • buildBlurParamBlock(): Blur radius parameters
 *     • setFocusDistance(), setBlurAmount(), setAperture()
 *     • render(): dispatches to renderer when enabled
 *
 *   VolumetricDustPass
 *     • Construction: layer initialization with defaults
 *     • buildParamBlock(): layer color/opacity packing
 *     • buildPropertyBlock(): layer scale/speed packing
 *     • setLayerColor(), setLayerOpacity(), setLayerScale()
 *     • update(): time advancement for animation
 *
 *   CoronaPass
 *     • Construction: position and pulse parameters
 *     • buildParamBlock(): corona parameters (position, radius, timing)
 *     • buildRingParamBlock(): ring configuration
 *     • setCoreScreenPos(), setPulseAmplitude(), setColorCycleSpeed()
 *     • update(): time advancement for animation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { BloomPass, MAX_BLOOM_LEVELS } =
  require(path.join(root, 'js/engine/post-effects/passes/BloomPass.js'));
const { VignettePass } =
  require(path.join(root, 'js/engine/post-effects/passes/VignettePass.js'));
const { ChromaticPass } =
  require(path.join(root, 'js/engine/post-effects/passes/ChromaticPass.js'));
const { MotionBlurPass } =
  require(path.join(root, 'js/engine/post-effects/passes/MotionBlurPass.js'));
const { ToneMappingPass, ToneMappingMode } =
  require(path.join(root, 'js/engine/post-effects/passes/ToneMappingPass.js'));
const { LensFlarePass, MAX_FLARE_SOURCES } =
  require(path.join(root, 'js/engine/post-effects/passes/LensFlarePass.js'));
const { DepthOfFieldPass, MAX_BLUR_RADIUS } =
  require(path.join(root, 'js/engine/post-effects/passes/DepthOfFieldPass.js'));
const { VolumetricDustPass, MAX_DUST_LAYERS, DEFAULT_DUST_LAYERS } =
  require(path.join(root, 'js/engine/post-effects/passes/VolumetricDustPass.js'));
const { CoronaPass, MAX_CORONA_RINGS } =
  require(path.join(root, 'js/engine/post-effects/passes/CoronaPass.js'));
const { StarScintillationPass } =
  require(path.join(root, 'js/engine/post-effects/passes/StarScintillationPass.js'));
const { EffectComposer } =
  require(path.join(root, 'js/engine/post-effects/EffectComposer.js'));

// ---------------------------------------------------------------------------
// Mock renderer (no real GPU device required)
// ---------------------------------------------------------------------------

function makeMockRenderer() {
  let texCounter = 0;
  return {
    createTexture: vi.fn(opts => ({ _id: ++texCounter, ...opts })),
    runBloomPass:    vi.fn(),
    runVignettePass: vi.fn(),
    runChromaticPass: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// BloomPass — constants
// ---------------------------------------------------------------------------

describe('BloomPass — constants', () => {
  it('MAX_BLOOM_LEVELS is 8', () => {
    expect(MAX_BLOOM_LEVELS).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// BloomPass — construction
// ---------------------------------------------------------------------------

describe('BloomPass — construction', () => {
  it('has correct defaults', () => {
    const p = new BloomPass();
    expect(p.enabled).toBe(true);
    expect(p.threshold).toBeCloseTo(0.8, 6);
    expect(p.strength).toBeCloseTo(1.2, 6);
    expect(p.radius).toBeCloseTo(0.6, 6);
    expect(p.mipLevels).toBe(4);
  });

  it('accepts custom parameters', () => {
    const p = new BloomPass({ threshold: 0.5, strength: 2.0, radius: 1.0, mipLevels: 6 });
    expect(p.threshold).toBeCloseTo(0.5, 6);
    expect(p.strength).toBeCloseTo(2.0, 6);
    expect(p.radius).toBeCloseTo(1.0, 6);
    expect(p.mipLevels).toBe(6);
  });

  it('clamps mipLevels to [1, MAX_BLOOM_LEVELS]', () => {
    expect(new BloomPass({ mipLevels: 0   }).mipLevels).toBe(1);
    expect(new BloomPass({ mipLevels: 100 }).mipLevels).toBe(MAX_BLOOM_LEVELS);
  });

  it('starts enabled', () => {
    expect(new BloomPass().enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BloomPass — buildThresholdParamBlock
// ---------------------------------------------------------------------------

describe('BloomPass — buildThresholdParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new BloomPass().buildThresholdParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('packs threshold at [0]', () => {
    const p   = new BloomPass({ threshold: 0.65 });
    const blk = p.buildThresholdParamBlock();
    expect(blk[0]).toBeCloseTo(0.65, 6);
  });

  it('packs strength at [1]', () => {
    const p   = new BloomPass({ strength: 2.5 });
    const blk = p.buildThresholdParamBlock();
    expect(blk[1]).toBeCloseTo(2.5, 6);
  });

  it('reflects runtime threshold changes', () => {
    const p   = new BloomPass({ threshold: 0.8 });
    p.threshold = 0.3;
    expect(p.buildThresholdParamBlock()[0]).toBeCloseTo(0.3, 6);
  });
});

// ---------------------------------------------------------------------------
// BloomPass — buildBlurParamBlock
// ---------------------------------------------------------------------------

describe('BloomPass — buildBlurParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new BloomPass().buildBlurParamBlock(true, 1.0);
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('horizontal=true → blk[3]=1.0', () => {
    const blk = new BloomPass().buildBlurParamBlock(true, 1.0);
    expect(blk[3]).toBeCloseTo(1.0, 6);
  });

  it('horizontal=false → blk[3]=0.0', () => {
    const blk = new BloomPass().buildBlurParamBlock(false, 1.0);
    expect(blk[3]).toBe(0.0);
  });

  it('packs levelRadius at [2]', () => {
    const blk = new BloomPass().buildBlurParamBlock(true, 3.5);
    expect(blk[2]).toBeCloseTo(3.5, 6);
  });

  it('uses this.radius as default levelRadius when omitted', () => {
    const p   = new BloomPass({ radius: 0.9 });
    const blk = p.buildBlurParamBlock(false);
    expect(blk[2]).toBeCloseTo(0.9, 6);
  });

  it('packs threshold at [0] and strength at [1]', () => {
    const p   = new BloomPass({ threshold: 0.4, strength: 1.7 });
    const blk = p.buildBlurParamBlock(true, 1.0);
    expect(blk[0]).toBeCloseTo(0.4, 6);
    expect(blk[1]).toBeCloseTo(1.7, 6);
  });
});

// ---------------------------------------------------------------------------
// BloomPass — buildCompositeParamBlock
// ---------------------------------------------------------------------------

describe('BloomPass — buildCompositeParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new BloomPass().buildCompositeParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('packs strength at [0]', () => {
    const p   = new BloomPass({ strength: 1.8 });
    const blk = p.buildCompositeParamBlock();
    expect(blk[0]).toBeCloseTo(1.8, 6);
  });

  it('reflects runtime strength changes', () => {
    const p   = new BloomPass({ strength: 1.2 });
    p.strength = 3.0;
    expect(p.buildCompositeParamBlock()[0]).toBeCloseTo(3.0, 6);
  });
});

// ---------------------------------------------------------------------------
// BloomPass — levelRadius
// ---------------------------------------------------------------------------

describe('BloomPass — levelRadius', () => {
  it('level 0 returns base radius', () => {
    const p = new BloomPass({ radius: 0.6 });
    expect(p.levelRadius(0)).toBeCloseTo(0.6, 6);
  });

  it('level 1 doubles the radius', () => {
    const p = new BloomPass({ radius: 0.6 });
    expect(p.levelRadius(1)).toBeCloseTo(1.2, 6);
  });

  it('level 2 quadruples the radius', () => {
    const p = new BloomPass({ radius: 1.0 });
    expect(p.levelRadius(2)).toBeCloseTo(4.0, 6);
  });

  it('level 3 multiplies radius by 8', () => {
    const p = new BloomPass({ radius: 0.5 });
    expect(p.levelRadius(3)).toBeCloseTo(4.0, 6);
  });
});

// ---------------------------------------------------------------------------
// BloomPass — render
// ---------------------------------------------------------------------------

describe('BloomPass — render', () => {
  it('does not throw when called without GPU resources', () => {
    const p = new BloomPass();
    expect(() => p.render(null, null, null)).not.toThrow();
  });

  it('is a no-op when disabled', () => {
    const p   = new BloomPass();
    p.enabled = false;
    let called = false;
    const renderer = { runBloomPass: () => { called = true; } };
    p.render(null, null, renderer);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BloomPass — dispose
// ---------------------------------------------------------------------------

describe('BloomPass — dispose', () => {
  it('does not throw', () => {
    expect(() => new BloomPass().dispose()).not.toThrow();
  });
});

// ===========================================================================
// VignettePass
// ===========================================================================

// ---------------------------------------------------------------------------
// VignettePass — construction
// ---------------------------------------------------------------------------

describe('VignettePass — construction', () => {
  it('has correct defaults', () => {
    const p = new VignettePass();
    expect(p.enabled).toBe(true);
    expect(p.darkness).toBeCloseTo(0.5, 6);
    expect(p.falloff).toBeCloseTo(2.0, 6);
  });

  it('centre defaults to (0.5, 0.5)', () => {
    const p = new VignettePass();
    expect(p.centre.x).toBeCloseTo(0.5, 6);
    expect(p.centre.y).toBeCloseTo(0.5, 6);
  });

  it('accepts custom parameters', () => {
    const p = new VignettePass({ darkness: 0.9, falloff: 1.5, centre: { x: 0.3, y: 0.7 } });
    expect(p.darkness).toBeCloseTo(0.9, 6);
    expect(p.falloff).toBeCloseTo(1.5, 6);
    expect(p.centre.x).toBeCloseTo(0.3, 6);
    expect(p.centre.y).toBeCloseTo(0.7, 6);
  });

  it('accepts partial centre (only x)', () => {
    const p = new VignettePass({ centre: { x: 0.4 } });
    expect(p.centre.x).toBeCloseTo(0.4, 6);
    expect(p.centre.y).toBeCloseTo(0.5, 6);
  });
});

// ---------------------------------------------------------------------------
// VignettePass — buildParamBlock
// ---------------------------------------------------------------------------

describe('VignettePass — buildParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new VignettePass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('packs darkness at [0]', () => {
    const p = new VignettePass({ darkness: 0.7 });
    expect(p.buildParamBlock()[0]).toBeCloseTo(0.7, 6);
  });

  it('packs falloff at [1]', () => {
    const p = new VignettePass({ falloff: 3.0 });
    expect(p.buildParamBlock()[1]).toBeCloseTo(3.0, 6);
  });

  it('packs centreX at [2]', () => {
    const p = new VignettePass({ centre: { x: 0.3, y: 0.5 } });
    expect(p.buildParamBlock()[2]).toBeCloseTo(0.3, 6);
  });

  it('packs centreY at [3]', () => {
    const p = new VignettePass({ centre: { x: 0.5, y: 0.8 } });
    expect(p.buildParamBlock()[3]).toBeCloseTo(0.8, 6);
  });

  it('reflects runtime centre changes', () => {
    const p      = new VignettePass();
    p.centre.x   = 0.6;
    p.centre.y   = 0.2;
    const blk    = p.buildParamBlock();
    expect(blk[2]).toBeCloseTo(0.6, 6);
    expect(blk[3]).toBeCloseTo(0.2, 6);
  });
});

// ---------------------------------------------------------------------------
// VignettePass — render
// ---------------------------------------------------------------------------

describe('VignettePass — render', () => {
  it('does not throw when called without GPU resources', () => {
    expect(() => new VignettePass().render(null, null, null)).not.toThrow();
  });

  it('is a no-op when disabled', () => {
    const p   = new VignettePass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runVignettePass: () => { called = true; } });
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VignettePass — dispose
// ---------------------------------------------------------------------------

describe('VignettePass — dispose', () => {
  it('does not throw', () => {
    expect(() => new VignettePass().dispose()).not.toThrow();
  });
});

// ===========================================================================
// ChromaticPass
// ===========================================================================

// ---------------------------------------------------------------------------
// ChromaticPass — construction
// ---------------------------------------------------------------------------

describe('ChromaticPass — construction', () => {
  it('has correct defaults', () => {
    const p = new ChromaticPass();
    expect(p.enabled).toBe(true);
    expect(p.power).toBeCloseTo(0.005, 6);
    expect(p.angle).toBeCloseTo(0, 6);
    expect(p.barrelStrength).toBe(0.0);
  });

  it('accepts custom parameters including barrelStrength', () => {
    const p = new ChromaticPass({ power: 0.012, angle: Math.PI / 4, barrelStrength: 0.15 });
    expect(p.power).toBeCloseTo(0.012, 6);
    expect(p.angle).toBeCloseTo(Math.PI / 4, 6);
    expect(p.barrelStrength).toBeCloseTo(0.15, 6);
  });

  it('barrelStrength defaults to 0 (no distortion)', () => {
    expect(new ChromaticPass().barrelStrength).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// ChromaticPass — buildParamBlock
// ---------------------------------------------------------------------------

describe('ChromaticPass — buildParamBlock', () => {
  it('returns a Float32Array of 4 floats', () => {
    const blk = new ChromaticPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(4);
  });

  it('packs power at [0]', () => {
    const p = new ChromaticPass({ power: 0.01 });
    expect(p.buildParamBlock()[0]).toBeCloseTo(0.01, 6);
  });

  it('packs angle at [1]', () => {
    const p = new ChromaticPass({ angle: 1.57 });
    expect(p.buildParamBlock()[1]).toBeCloseTo(1.57, 6);
  });

  it('packs barrelStrength at [2]', () => {
    const p = new ChromaticPass({ barrelStrength: 0.2 });
    expect(p.buildParamBlock()[2]).toBeCloseTo(0.2, 6);
  });

  it('[3] is reserved/zero by default', () => {
    expect(new ChromaticPass().buildParamBlock()[3]).toBe(0);
  });

  it('reflects runtime barrelStrength changes', () => {
    const p         = new ChromaticPass();
    p.barrelStrength = 0.5;
    expect(p.buildParamBlock()[2]).toBeCloseTo(0.5, 6);
  });
});

// ---------------------------------------------------------------------------
// ChromaticPass — render
// ---------------------------------------------------------------------------

describe('ChromaticPass — render', () => {
  it('does not throw when called without GPU resources', () => {
    expect(() => new ChromaticPass().render(null, null, null)).not.toThrow();
  });

  it('is a no-op when disabled', () => {
    const p   = new ChromaticPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runChromaticPass: () => { called = true; } });
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChromaticPass — dispose
// ---------------------------------------------------------------------------

describe('ChromaticPass — dispose', () => {
  it('does not throw', () => {
    expect(() => new ChromaticPass().dispose()).not.toThrow();
  });
});

// ===========================================================================
// EffectComposer (MockRenderer — no real GPU device)
// ===========================================================================

describe('EffectComposer — construction', () => {
  it('calls createTexture twice to create ping-pong RTs', () => {
    const r = makeMockRenderer();
    new EffectComposer(r, 1920, 1080);
    expect(r.createTexture).toHaveBeenCalledTimes(2);
  });

  it('passes correct dimensions and format to createTexture', () => {
    const r = makeMockRenderer();
    new EffectComposer(r, 800, 600);
    expect(r.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600, format: 'rgba8unorm', renderTarget: true }),
    );
  });

  it('starts with an empty pass list', () => {
    const r = makeMockRenderer();
    const c = new EffectComposer(r, 1920, 1080);
    expect(c.passes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EffectComposer — pass management
// ---------------------------------------------------------------------------

describe('EffectComposer — addPass / removePass', () => {
  let composer;
  beforeEach(() => {
    composer = new EffectComposer(makeMockRenderer(), 1920, 1080);
  });

  it('addPass appends a pass', () => {
    const p = { enabled: true, render: vi.fn() };
    composer.addPass(p);
    expect(composer.passes).toContain(p);
  });

  it('addPass returns the composer for chaining', () => {
    const p = { enabled: true, render: vi.fn() };
    expect(composer.addPass(p)).toBe(composer);
  });

  it('addPass preserves insertion order', () => {
    const p1 = { enabled: true, render: vi.fn() };
    const p2 = { enabled: true, render: vi.fn() };
    const p3 = { enabled: true, render: vi.fn() };
    composer.addPass(p1).addPass(p2).addPass(p3);
    expect(composer.passes[0]).toBe(p1);
    expect(composer.passes[1]).toBe(p2);
    expect(composer.passes[2]).toBe(p3);
  });

  it('removePass removes the pass', () => {
    const p = { enabled: true, render: vi.fn() };
    composer.addPass(p);
    composer.removePass(p);
    expect(composer.passes).not.toContain(p);
  });

  it('removePass returns the composer for chaining', () => {
    const p = { enabled: true, render: vi.fn() };
    composer.addPass(p);
    expect(composer.removePass(p)).toBe(composer);
  });

  it('removePass is a no-op for an unknown pass', () => {
    const p = { enabled: true, render: vi.fn() };
    expect(() => composer.removePass(p)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EffectComposer — passes getter
// ---------------------------------------------------------------------------

describe('EffectComposer — passes getter', () => {
  it('returns the list of added passes', () => {
    const c  = new EffectComposer(makeMockRenderer(), 1280, 720);
    const p1 = { enabled: true, render: vi.fn() };
    const p2 = { enabled: true, render: vi.fn() };
    c.addPass(p1).addPass(p2);
    expect(c.passes).toEqual([p1, p2]);
  });
});

// ---------------------------------------------------------------------------
// EffectComposer — render order and ping-pong
// ---------------------------------------------------------------------------

describe('EffectComposer — render', () => {
  it('does not throw with an empty chain', () => {
    const c = new EffectComposer(makeMockRenderer(), 1920, 1080);
    expect(() => c.render()).not.toThrow();
  });

  it('calls each enabled pass render() once', () => {
    const c  = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const p1 = { enabled: true, render: vi.fn() };
    const p2 = { enabled: true, render: vi.fn() };
    c.addPass(p1).addPass(p2);
    c.render();
    expect(p1.render).toHaveBeenCalledTimes(1);
    expect(p2.render).toHaveBeenCalledTimes(1);
  });

  it('calls passes in insertion order', () => {
    const order = [];
    const c     = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const p1    = { enabled: true, render: vi.fn(() => order.push(1)) };
    const p2    = { enabled: true, render: vi.fn(() => order.push(2)) };
    const p3    = { enabled: true, render: vi.fn(() => order.push(3)) };
    c.addPass(p1).addPass(p2).addPass(p3);
    c.render();
    expect(order).toEqual([1, 2, 3]);
  });

  it('skips disabled passes', () => {
    const c  = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const p1 = { enabled: true,  render: vi.fn() };
    const p2 = { enabled: false, render: vi.fn() };
    const p3 = { enabled: true,  render: vi.fn() };
    c.addPass(p1).addPass(p2).addPass(p3);
    c.render();
    expect(p1.render).toHaveBeenCalledTimes(1);
    expect(p2.render).not.toHaveBeenCalled();
    expect(p3.render).toHaveBeenCalledTimes(1);
  });

  it('last enabled pass receives mainTarget as dstTex', () => {
    const c         = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const mainTgt   = { _id: 'screen' };
    const p1        = { enabled: true, render: vi.fn() };
    const p2        = { enabled: true, render: vi.fn() };
    c.addPass(p1).addPass(p2);
    c.render(null, mainTgt);
    const [, dst]   = p2.render.mock.calls[0];
    expect(dst).toBe(mainTgt);
  });

  it('last enabled pass is correct even when trailing passes are disabled', () => {
    const c         = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const mainTgt   = { _id: 'screen' };
    const p1        = { enabled: true,  render: vi.fn() };
    const p2        = { enabled: true,  render: vi.fn() };
    const p3        = { enabled: false, render: vi.fn() };
    c.addPass(p1).addPass(p2).addPass(p3);
    c.render(null, mainTgt);
    const [, dst]   = p2.render.mock.calls[0];
    expect(dst).toBe(mainTgt);
  });

  it('intermediate passes receive a render target as dstTex (not mainTarget)', () => {
    const c         = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const mainTgt   = { _id: 'screen' };
    const p1        = { enabled: true, render: vi.fn() };
    const p2        = { enabled: true, render: vi.fn() };
    c.addPass(p1).addPass(p2);
    c.render(null, mainTgt);
    const [, dst]   = p1.render.mock.calls[0];
    expect(dst).not.toBe(mainTgt);
    expect(dst).toBeDefined();
  });

  it('accepts an explicit inputTexture that is passed as srcTex to the first pass', () => {
    const c         = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const inputTex  = { _id: 'input' };
    const p1        = { enabled: true, render: vi.fn() };
    c.addPass(p1);
    c.render(inputTex, null);
    const [src]     = p1.render.mock.calls[0];
    expect(src).toBe(inputTex);
  });

  it('single enabled pass receives mainTarget as dstTex', () => {
    const c       = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const mainTgt = { _id: 'screen' };
    const p       = { enabled: true, render: vi.fn() };
    c.addPass(p);
    c.render(null, mainTgt);
    const [, dst] = p.render.mock.calls[0];
    expect(dst).toBe(mainTgt);
  });

  it('passes receive the renderer as third argument', () => {
    const r  = makeMockRenderer();
    const c  = new EffectComposer(r, 1920, 1080);
    const p  = { enabled: true, render: vi.fn() };
    c.addPass(p);
    c.render();
    const [,, receivedRenderer] = p.render.mock.calls[0];
    expect(receivedRenderer).toBe(r);
  });

  it('all passes disabled — none are called', () => {
    const c  = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const p1 = { enabled: false, render: vi.fn() };
    const p2 = { enabled: false, render: vi.fn() };
    c.addPass(p1).addPass(p2);
    expect(() => c.render()).not.toThrow();
    expect(p1.render).not.toHaveBeenCalled();
    expect(p2.render).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EffectComposer — resize
// ---------------------------------------------------------------------------

describe('EffectComposer — resize', () => {
  it('calls createTexture again with new dimensions', () => {
    const r = makeMockRenderer();
    const c = new EffectComposer(r, 1920, 1080);
    r.createTexture.mockClear();
    c.resize(2560, 1440);
    expect(r.createTexture).toHaveBeenCalledTimes(2);
    expect(r.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2560, height: 1440 }),
    );
  });
});

// ---------------------------------------------------------------------------
// EffectComposer — dispose
// ---------------------------------------------------------------------------

describe('EffectComposer — dispose', () => {
  it('calls dispose() on each pass that has one', () => {
    const c  = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const p1 = { enabled: true, render: vi.fn(), dispose: vi.fn() };
    const p2 = { enabled: true, render: vi.fn(), dispose: vi.fn() };
    c.addPass(p1).addPass(p2);
    c.dispose();
    expect(p1.dispose).toHaveBeenCalledTimes(1);
    expect(p2.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not throw for passes without dispose()', () => {
    const c = new EffectComposer(makeMockRenderer(), 1920, 1080);
    const p = { enabled: true, render: vi.fn() };
    c.addPass(p);
    expect(() => c.dispose()).not.toThrow();
  });

  it('empties the pass list', () => {
    const c = new EffectComposer(makeMockRenderer(), 1920, 1080);
    c.addPass({ enabled: true, render: vi.fn(), dispose: vi.fn() });
    c.dispose();
    expect(c.passes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration — BloomPass + VignettePass in EffectComposer
// ---------------------------------------------------------------------------

describe('EffectComposer — integration: Bloom + Vignette chain', () => {
  it('runs a Bloom → Vignette chain without throwing', () => {
    const r       = makeMockRenderer();
    const c       = new EffectComposer(r, 1920, 1080);
    const bloom   = new BloomPass({ threshold: 0.7, strength: 1.5 });
    const vignette = new VignettePass({ darkness: 0.4 });
    c.addPass(bloom).addPass(vignette);
    expect(() => c.render()).not.toThrow();
  });

  it('BloomPass buildThresholdParamBlock fits into Bloom → Vignette → Chromatic chain', () => {
    const bloom   = new BloomPass({ threshold: 0.6, strength: 1.3, mipLevels: 3 });
    const vignette = new VignettePass({ darkness: 0.6 });
    const chroma  = new ChromaticPass({ power: 0.008, barrelStrength: 0.1 });

    const tBlk = bloom.buildThresholdParamBlock();
    const vBlk = vignette.buildParamBlock();
    const cBlk = chroma.buildParamBlock();

    // All are valid uniform buffers
    expect(tBlk).toBeInstanceOf(Float32Array);
    expect(vBlk).toBeInstanceOf(Float32Array);
    expect(cBlk).toBeInstanceOf(Float32Array);

    // Values are in expected ranges
    expect(tBlk[0]).toBeCloseTo(0.6, 6);   // bloom threshold
    expect(vBlk[0]).toBeCloseTo(0.6, 6);   // vignette darkness
    expect(cBlk[2]).toBeCloseTo(0.1, 6);   // barrel strength
  });

  it('mipLevels determines number of blur passes — levelRadius grows correctly', () => {
    const bloom  = new BloomPass({ radius: 1.0, mipLevels: 4 });
    const radii  = Array.from({ length: bloom.mipLevels }, (_, i) => bloom.levelRadius(i));
    expect(radii).toEqual([1, 2, 4, 8]);
  });
});

// ===========================================================================
// Pass render() — renderer dispatch (Phase 3)
// ===========================================================================

describe('BloomPass — render dispatches to renderer when enabled', () => {
  it('calls renderer.runBloomPass(pass, srcTex, dstTex) when enabled', () => {
    const p   = new BloomPass();
    let capturedArgs = null;
    const renderer = { runBloomPass: (...args) => { capturedArgs = args; } };
    p.render('src', 'dst', renderer);
    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs[0]).toBe(p);
    expect(capturedArgs[1]).toBe('src');
    expect(capturedArgs[2]).toBe('dst');
  });

  it('is a no-op when renderer has no runBloomPass method', () => {
    const p = new BloomPass();
    expect(() => p.render('src', 'dst', {})).not.toThrow();
  });

  it('is a no-op when renderer is null', () => {
    const p = new BloomPass();
    expect(() => p.render('src', 'dst', null)).not.toThrow();
  });
});

describe('VignettePass — render dispatches to renderer when enabled', () => {
  it('calls renderer.runVignettePass(pass, srcTex, dstTex) when enabled', () => {
    const p   = new VignettePass();
    let capturedArgs = null;
    const renderer = { runVignettePass: (...args) => { capturedArgs = args; } };
    p.render('src', 'dst', renderer);
    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs[0]).toBe(p);
    expect(capturedArgs[1]).toBe('src');
    expect(capturedArgs[2]).toBe('dst');
  });

  it('is a no-op when renderer has no runVignettePass method', () => {
    const p = new VignettePass();
    expect(() => p.render('src', 'dst', {})).not.toThrow();
  });
});

describe('ChromaticPass — render dispatches to renderer when enabled', () => {
  it('calls renderer.runChromaticPass(pass, srcTex, dstTex) when enabled', () => {
    const p   = new ChromaticPass();
    let capturedArgs = null;
    const renderer = { runChromaticPass: (...args) => { capturedArgs = args; } };
    p.render('src', 'dst', renderer);
    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs[0]).toBe(p);
    expect(capturedArgs[1]).toBe('src');
    expect(capturedArgs[2]).toBe('dst');
  });

  it('is a no-op when renderer has no runChromaticPass method', () => {
    const p = new ChromaticPass();
    expect(() => p.render('src', 'dst', {})).not.toThrow();
  });
});

// =====================================================================
// DepthOfFieldPass — Phase 3a
// =====================================================================

describe('DepthOfFieldPass — constants', () => {
  it('MAX_BLUR_RADIUS is 16', () => {
    expect(MAX_BLUR_RADIUS).toBe(16);
  });
});

describe('DepthOfFieldPass — construction', () => {
  it('creates with default parameters', () => {
    const dof = new DepthOfFieldPass();
    expect(dof.enabled).toBe(true);
    expect(dof.focusDistance).toBe(500.0);
    expect(dof.focusRange).toBe(300.0);
    expect(dof.nearBlurAmount).toBe(2.0);
    expect(dof.farBlurAmount).toBe(4.0);
    expect(dof.aperture).toBe(1.0);
  });

  it('creates with custom parameters', () => {
    const dof = new DepthOfFieldPass({
      focusDistance: 350.0,
      focusRange: 200.0,
      nearBlurAmount: 3.0,
      farBlurAmount: 6.0,
      aperture: 2.0,
    });
    expect(dof.focusDistance).toBe(350.0);
    expect(dof.focusRange).toBe(200.0);
    expect(dof.nearBlurAmount).toBe(3.0);
    expect(dof.farBlurAmount).toBe(6.0);
    expect(dof.aperture).toBe(2.0);
  });

  it('clamps blur amounts to [0, MAX_BLUR_RADIUS]', () => {
    const dof = new DepthOfFieldPass({
      nearBlurAmount: -5.0,
      farBlurAmount: 100.0,
    });
    expect(dof.nearBlurAmount).toBe(0);
    expect(dof.farBlurAmount).toBe(MAX_BLUR_RADIUS);
  });
});

describe('DepthOfFieldPass — buildCoCParamBlock', () => {
  it('returns Float32Array of length 4', () => {
    const dof = new DepthOfFieldPass();
    const params = dof.buildCoCParamBlock();
    expect(params).toBeInstanceOf(Float32Array);
    expect(params.length).toBe(4);
  });

  it('packs focusDistance, focusRange, aperture correctly', () => {
    const dof = new DepthOfFieldPass({
      focusDistance: 400.0,
      focusRange: 250.0,
      aperture: 1.5,
    });
    const params = dof.buildCoCParamBlock();
    expect(params[0]).toBe(400.0);
    expect(params[1]).toBe(250.0);
    expect(params[2]).toBe(1.5);
  });
});

describe('DepthOfFieldPass — buildBlurParamBlock', () => {
  it('returns Float32Array of length 4', () => {
    const dof = new DepthOfFieldPass();
    const params = dof.buildBlurParamBlock(3.0);
    expect(params).toBeInstanceOf(Float32Array);
    expect(params.length).toBe(4);
  });

  it('packs blur radius correctly', () => {
    const dof = new DepthOfFieldPass();
    const params = dof.buildBlurParamBlock(5.5);
    expect(params[0]).toBe(6); // Ceiled
  });
});

describe('DepthOfFieldPass — API methods', () => {
  it('setFocusDistance updates focusDistance', () => {
    const dof = new DepthOfFieldPass();
    dof.setFocusDistance(600.0);
    expect(dof.focusDistance).toBe(600.0);
  });

  it('setFocusRange updates focusRange', () => {
    const dof = new DepthOfFieldPass();
    dof.setFocusRange(150.0);
    expect(dof.focusRange).toBe(150.0);
  });

  it('setBlurAmount updates both blur amounts', () => {
    const dof = new DepthOfFieldPass();
    dof.setBlurAmount(5.0, 8.0);
    expect(dof.nearBlurAmount).toBe(5.0);
    expect(dof.farBlurAmount).toBe(8.0);
  });

  it('setAperture updates aperture', () => {
    const dof = new DepthOfFieldPass();
    dof.setAperture(2.5);
    expect(dof.aperture).toBe(2.5);
  });
});

describe('DepthOfFieldPass — render dispatches to renderer when enabled', () => {
  it('calls renderer.runDepthOfFieldPass when enabled', () => {
    const dof = new DepthOfFieldPass();
    let capturedArgs = null;
    const renderer = { 
      runDepthOfFieldPass: (...args) => { capturedArgs = args; } 
    };
    dof.render('src', 'dst', renderer);
    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs[0]).toBe(dof);
  });

  it('is a no-op when disabled', () => {
    const dof = new DepthOfFieldPass();
    dof.enabled = false;
    let called = false;
    const renderer = { 
      runDepthOfFieldPass: () => { called = true; } 
    };
    dof.render('src', 'dst', renderer);
    expect(called).toBe(false);
  });
});

// =====================================================================
// VolumetricDustPass — Phase 3b
// =====================================================================

describe('VolumetricDustPass — constants', () => {
  it('MAX_DUST_LAYERS is 8', () => {
    expect(MAX_DUST_LAYERS).toBe(8);
  });

  it('DEFAULT_DUST_LAYERS has 3 entries', () => {
    expect(DEFAULT_DUST_LAYERS.length).toBe(3);
  });

  it('default layers have correct structure', () => {
    DEFAULT_DUST_LAYERS.forEach(layer => {
      expect(Array.isArray(layer.color)).toBe(true);
      expect(layer.color.length).toBe(3);
      expect(typeof layer.opacity).toBe('number');
      expect(typeof layer.scale).toBe('number');
      expect(typeof layer.speed).toBe('number');
    });
  });
});

describe('VolumetricDustPass — construction', () => {
  it('creates with default 3 layers', () => {
    const dust = new VolumetricDustPass();
    expect(dust.layers.length).toBe(3);
    expect(dust.enabled).toBe(true);
  });

  it('creates with custom layer count', () => {
    const dust = new VolumetricDustPass({ layerCount: 5 });
    expect(dust.layers.length).toBe(5);
  });

  it('clamps layer count to [1, MAX_DUST_LAYERS]', () => {
    let dust = new VolumetricDustPass({ layerCount: -1 });
    expect(dust.layers.length).toBe(1);
    dust = new VolumetricDustPass({ layerCount: 100 });
    expect(dust.layers.length).toBe(MAX_DUST_LAYERS);
  });
});

describe('VolumetricDustPass — buildParamBlock', () => {
  it('returns Float32Array with correct size', () => {
    const dust = new VolumetricDustPass({ layerCount: 3 });
    const params = dust.buildParamBlock();
    expect(params).toBeInstanceOf(Float32Array);
    expect(params.length).toBe(3 * 4 + 4); // 3 layers (4 floats each) + 4 global
  });

  it('packs layer colors and opacities correctly', () => {
    const dust = new VolumetricDustPass({ layerCount: 1 });
    dust.setLayerColor(0, 1.0, 0.5, 0.0);
    dust.setLayerOpacity(0, 0.8);
    const params = dust.buildParamBlock();
    expect(params[0]).toBe(1.0);
    expect(params[1]).toBe(0.5);
    expect(params[2]).toBe(0.0);
    expect(params[3]).toBeCloseTo(0.8, 5);
  });
});

describe('VolumetricDustPass — update and animation', () => {
  it('advances time via update()', () => {
    const dust = new VolumetricDustPass();
    expect(dust._time).toBe(0);
    dust.update(0.016); // ~60 FPS
    expect(dust._time).toBeCloseTo(0.016, 5);
    dust.update(0.016);
    expect(dust._time).toBeCloseTo(0.032, 5);
  });
});

describe('VolumetricDustPass — layer management', () => {
  it('setLayerColor updates layer color', () => {
    const dust = new VolumetricDustPass();
    dust.setLayerColor(0, 0.2, 0.3, 0.4);
    expect(dust.layers[0].color[0]).toBe(0.2);
    expect(dust.layers[0].color[1]).toBe(0.3);
    expect(dust.layers[0].color[2]).toBe(0.4);
  });

  it('setLayerOpacity updates layer opacity', () => {
    const dust = new VolumetricDustPass();
    dust.setLayerOpacity(0, 0.5);
    expect(dust.layers[0].opacity).toBe(0.5);
  });

  it('setLayerCount adjusts layer array', () => {
    const dust = new VolumetricDustPass({ layerCount: 3 });
    dust.setLayerCount(5);
    expect(dust.layers.length).toBe(5);
    dust.setLayerCount(2);
    expect(dust.layers.length).toBe(2);
  });
});

// =====================================================================
// CoronaPass — Phase 4c
// =====================================================================

describe('CoronaPass — constants', () => {
  it('MAX_CORONA_RINGS is 8', () => {
    expect(MAX_CORONA_RINGS).toBe(8);
  });
});

describe('CoronaPass — construction', () => {
  it('creates with default parameters', () => {
    const corona = new CoronaPass();
    expect(corona.enabled).toBe(true);
    expect(corona.centerX).toBe(0.5);
    expect(corona.centerY).toBe(0.5);
    expect(corona.baseRadius).toBe(200);
    expect(corona.pulseAmplitude).toBe(3.0);
    expect(corona.pulseFrequency).toBe(0.1);
    expect(corona.colorCycleSpeed).toBe(0.05);
    expect(corona.intensity).toBe(1.0);
    expect(corona.ringCount).toBe(4);
  });

  it('creates with custom parameters', () => {
    const corona = new CoronaPass({
      centerX: 0.3,
      centerY: 0.7,
      baseRadius: 300,
      pulseAmplitude: 5.0,
      colorCycleSpeed: 0.1,
      intensity: 1.5,
      ringCount: 6,
    });
    expect(corona.centerX).toBe(0.3);
    expect(corona.centerY).toBe(0.7);
    expect(corona.baseRadius).toBe(300);
    expect(corona.pulseAmplitude).toBe(5.0);
    expect(corona.colorCycleSpeed).toBe(0.1);
    expect(corona.intensity).toBe(1.5);
    expect(corona.ringCount).toBe(6);
  });

  it('clamps intensity to [0, 2]', () => {
    let corona = new CoronaPass({ intensity: -1.0 });
    expect(corona.intensity).toBe(0);
    corona = new CoronaPass({ intensity: 3.0 });
    expect(corona.intensity).toBe(2);
  });
});

describe('CoronaPass — buildParamBlock', () => {
  it('returns Float32Array of length 8', () => {
    const corona = new CoronaPass();
    const params = corona.buildParamBlock();
    expect(params).toBeInstanceOf(Float32Array);
    expect(params.length).toBe(8);
  });

  it('packs parameters correctly', () => {
    const corona = new CoronaPass({
      centerX: 0.4,
      centerY: 0.6,
      baseRadius: 250,
      pulseAmplitude: 4.0,
      pulseFrequency: 0.2,
      colorCycleSpeed: 0.08,
      intensity: 1.2,
    });
    const params = corona.buildParamBlock();
    expect(params[0]).toBeCloseTo(0.4, 5);
    expect(params[1]).toBeCloseTo(0.6, 5);
    expect(params[2]).toBe(250);
    expect(params[3]).toBeCloseTo(4.0, 5);
    expect(params[4]).toBeCloseTo(0.2, 5);
    expect(params[5]).toBeCloseTo(0.08, 5);
    expect(params[6]).toBeCloseTo(1.2, 5);
  });
});

describe('CoronaPass — API methods', () => {
  it('setCoreScreenPos updates center coordinates', () => {
    const corona = new CoronaPass();
    corona.setCoreScreenPos(0.3, 0.4);
    expect(corona.centerX).toBe(0.3);
    expect(corona.centerY).toBe(0.4);
  });

  it('setPulseAmplitude updates amplitude', () => {
    const corona = new CoronaPass();
    corona.setPulseAmplitude(8.0);
    expect(corona.pulseAmplitude).toBe(8.0);
  });

  it('setColorCycleSpeed updates speed', () => {
    const corona = new CoronaPass();
    corona.setColorCycleSpeed(0.15);
    expect(corona.colorCycleSpeed).toBe(0.15);
  });

  it('setIntensity clamps value', () => {
    const corona = new CoronaPass();
    corona.setIntensity(2.5);
    expect(corona.intensity).toBe(2);
    corona.setIntensity(-0.5);
    expect(corona.intensity).toBe(0);
  });
});

describe('CoronaPass — update and animation', () => {
  it('advances time via update()', () => {
    const corona = new CoronaPass();
    expect(corona._time).toBe(0);
    corona.update(0.016);
    expect(corona._time).toBeCloseTo(0.016, 5);
  });
});

describe('CoronaPass — render dispatches to renderer when enabled', () => {
  it('calls renderer.runCoronaPass when enabled', () => {
    const corona = new CoronaPass();
    let capturedArgs = null;
    const renderer = { 
      runCoronaPass: (...args) => { capturedArgs = args; } 
    };
    corona.render('src', 'dst', renderer);
    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs[0]).toBe(corona);
  });

  it('is a no-op when disabled', () => {
    const corona = new CoronaPass();
    corona.enabled = false;
    let called = false;
    const renderer = { 
      runCoronaPass: () => { called = true; } 
    };
    corona.render('src', 'dst', renderer);
    expect(called).toBe(false);
  });
});

// =====================================================================
// MotionBlurPass verification (Phase 3c)
// =====================================================================

describe('MotionBlurPass — verify implementation', () => {
  it('can set velocity', () => {
    const blur = new MotionBlurPass();
    blur.setVelocity(0.02, 0.01);
    expect(blur.velX).toBe(0.02);
    expect(blur.velY).toBe(0.01);
  });

  it('buildParamBlock returns correct size', () => {
    const blur = new MotionBlurPass();
    const params = blur.buildParamBlock();
    expect(params).toBeInstanceOf(Float32Array);
    expect(params.length).toBe(8);
  });
});

// =====================================================================
// ToneMappingPass verification (Phase 4a)
// =====================================================================

describe('ToneMappingPass — verify implementation', () => {
  it('supports REINHARD and ACES modes', () => {
    const tm1 = new ToneMappingPass({ mode: ToneMappingMode.REINHARD });
    expect(tm1.mode).toBe(ToneMappingMode.REINHARD);
    const tm2 = new ToneMappingPass({ mode: ToneMappingMode.ACES });
    expect(tm2.mode).toBe(ToneMappingMode.ACES);
  });

  it('buildParamBlock returns correct size', () => {
    const tm = new ToneMappingPass();
    const params = tm.buildParamBlock();
    expect(params).toBeInstanceOf(Float32Array);
    expect(params.length).toBe(4);
  });
});

// =====================================================================
// LensFlarePass verification (Phase 4b)
// =====================================================================

describe('LensFlarePass — verify implementation', () => {
  it('can add and remove flare sources', () => {
    const flare = new LensFlarePass();
    const id = flare.addSource(0.2, 0.5, 1.0, 0xffffff);
    expect(typeof id).toBe('number');
    flare.removeSource(id);
  });

  it('buildParamBlock returns correct size', () => {
    const flare = new LensFlarePass();
    flare.addSource(0.5, 0.5, 1.0, 0xffffff);
    const params = flare.buildParamBlock();
    expect(params).toBeInstanceOf(Float32Array);
  });
});

// =====================================================================
// StarScintillationPass verification (Phase 5)
// =====================================================================

describe('StarScintillationPass — verify implementation', () => {
  it('has configurable threshold and amplitude', () => {
    const sci = new StarScintillationPass({ threshold: 0.9, amplitude: 0.2 });
    expect(sci.threshold).toBe(0.9);
    expect(sci.amplitude).toBe(0.2);
  });

  it('buildParamBlock returns correct size', () => {
    const sci = new StarScintillationPass();
    const params = sci.buildParamBlock();
    expect(params).toBeInstanceOf(Float32Array);
    expect(params.length).toBe(4);
  });
});
