/**
 * tests/webgpu/postfx.test.js
 *
 * Tests for GameEngine post-effects integration:
 *   - configurePostFx() applies pass parameters
 *   - passes are created from opts.bloom / opts.vignette / opts.chromatic
 *   - opts.bloom=false skips BloomPass, etc.
 *   - postfx:configured event fires
 */

import { describe, it, expect, vi } from 'vitest';
import { GameEngine } from '../../js/engine/GameEngine.js';
import { BloomPass }  from '../../js/engine/post-effects/passes/BloomPass.js';
import { VignettePass } from '../../js/engine/post-effects/passes/VignettePass.js';
import { ChromaticPass } from '../../js/engine/post-effects/passes/ChromaticPass.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanvas(w = 800, h = 600) {
  return { width: w, height: h, parentElement: null };
}

function makeMockRenderer() {
  return {
    getCapabilities: () => ({ webgpu: false, webgl2: true, computeShaders: false, maxTextureSize: 4096 }),
    initialize:    vi.fn(async () => {}),
    createTexture: vi.fn(() => ({})),
    render:        vi.fn(),
    resize:        vi.fn(),
    dispose:       vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// GameEngine — post-effects pass creation
// ---------------------------------------------------------------------------

describe('GameEngine postFx pass creation', () => {
  it('creates all three passes by default when postFx is on', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    expect(engine._bloomPass).toBeInstanceOf(BloomPass);
    expect(engine._vignettePass).toBeInstanceOf(VignettePass);
    expect(engine._chromaticPass).toBeInstanceOf(ChromaticPass);
    engine.dispose();
  });

  it('skips BloomPass when opts.bloom=false', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { bloom: false });
    expect(engine._bloomPass).toBeUndefined();
    expect(engine._vignettePass).toBeInstanceOf(VignettePass);
    engine.dispose();
  });

  it('skips VignettePass when opts.vignette=false', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { vignette: false });
    expect(engine._vignettePass).toBeUndefined();
    engine.dispose();
  });

  it('skips ChromaticPass when opts.chromatic=false', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { chromatic: false });
    expect(engine._chromaticPass).toBeUndefined();
    engine.dispose();
  });

  it('applies custom bloom options from opts.bloom object', async () => {
    const engine = await GameEngine.createWithRenderer(
      makeMockRenderer(), makeCanvas(),
      { bloom: { threshold: 0.5, strength: 2.0, radius: 1.0 } }
    );
    expect(engine._bloomPass.threshold).toBe(0.5);
    expect(engine._bloomPass.strength).toBe(2.0);
    expect(engine._bloomPass.radius).toBe(1.0);
    engine.dispose();
  });

  it('applies custom vignette options from opts.vignette object', async () => {
    const engine = await GameEngine.createWithRenderer(
      makeMockRenderer(), makeCanvas(),
      { vignette: { darkness: 0.9, falloff: 3.0 } }
    );
    expect(engine._vignettePass.darkness).toBe(0.9);
    expect(engine._vignettePass.falloff).toBe(3.0);
    engine.dispose();
  });

  it('applies custom chromatic options from opts.chromatic object', async () => {
    const engine = await GameEngine.createWithRenderer(
      makeMockRenderer(), makeCanvas(),
      { chromatic: { power: 0.02, angle: 1.57 } }
    );
    expect(engine._chromaticPass.power).toBe(0.02);
    expect(engine._chromaticPass.angle).toBe(1.57);
    engine.dispose();
  });

  it('adds a RenderPass as first pass in EffectComposer', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    expect(engine.postFx._passes.length).toBeGreaterThanOrEqual(1);
    expect(engine.postFx._passes[0]).toBe(engine._renderPass);
    engine.dispose();
  });

  it('no passes added when postFx=false', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { postFx: false });
    expect(engine.postFx).toBeNull();
    expect(engine._bloomPass).toBeUndefined();
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// GameEngine.configurePostFx()
// ---------------------------------------------------------------------------

describe('GameEngine.configurePostFx', () => {
  it('updates bloom pass parameters', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    engine.configurePostFx({ bloom: { threshold: 0.3, strength: 1.8 } });
    expect(engine._bloomPass.threshold).toBe(0.3);
    expect(engine._bloomPass.strength).toBe(1.8);
    engine.dispose();
  });

  it('updates vignette pass parameters', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    engine.configurePostFx({ vignette: { darkness: 0.7, falloff: 4.0 } });
    expect(engine._vignettePass.darkness).toBe(0.7);
    expect(engine._vignettePass.falloff).toBe(4.0);
    engine.dispose();
  });

  it('updates chromatic pass parameters', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    engine.configurePostFx({ chromatic: { power: 0.015 } });
    expect(engine._chromaticPass.power).toBe(0.015);
    engine.dispose();
  });

  it('enables / disables bloom pass', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    engine.configurePostFx({ bloom: { enabled: false } });
    expect(engine._bloomPass.enabled).toBe(false);
    engine.configurePostFx({ bloom: { enabled: true } });
    expect(engine._bloomPass.enabled).toBe(true);
    engine.dispose();
  });

  it('emits postfx:configured event', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    const handler = vi.fn();
    engine.events.on('postfx:configured', handler);
    engine.configurePostFx({ bloom: { strength: 2.5 } });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].cfg.bloom.strength).toBe(2.5);
    engine.dispose();
  });

  it('is a no-op when postFx=false', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { postFx: false });
    expect(() => engine.configurePostFx({ bloom: { strength: 2.5 } })).not.toThrow();
    engine.dispose();
  });

  it('is a no-op when pass was disabled at init', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas(), { bloom: false });
    // Should not throw even though _bloomPass is undefined
    expect(() => engine.configurePostFx({ bloom: { strength: 2.5 } })).not.toThrow();
    engine.dispose();
  });

  it('partial update leaves other params unchanged', async () => {
    const engine = await GameEngine.createWithRenderer(
      makeMockRenderer(), makeCanvas(),
      { bloom: { threshold: 0.8, strength: 1.2, radius: 0.6 } }
    );
    engine.configurePostFx({ bloom: { strength: 2.0 } });
    expect(engine._bloomPass.threshold).toBe(0.8); // unchanged
    expect(engine._bloomPass.strength).toBe(2.0);  // updated
    expect(engine._bloomPass.radius).toBe(0.6);    // unchanged
    engine.dispose();
  });

  it('returns the engine for chaining', async () => {
    const engine = await GameEngine.createWithRenderer(makeMockRenderer(), makeCanvas());
    expect(engine.configurePostFx({ bloom: { strength: 1.5 } })).toBe(engine);
    engine.dispose();
  });
});
