/**
 * tests/webgpu/quality-manager.test.js
 *
 * Tests for QualityManager:
 *   - apply() forces a tier and configures pass.enabled flags
 *   - set() overrides individual settings without changing tier
 *   - _detectTier() heuristic from renderer capabilities
 *   - presetFor() static helper
 *   - quality:changed and quality:overridden events fire
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QualityManager, QUALITY_PRESETS } from '../../js/engine/utils/QualityManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePass(enabled = true) {
  return { enabled };
}

function makeEngine(caps = {}) {
  const events = {
    _emitted: [],
    emit: vi.fn(function (ev, payload) { this._emitted.push({ ev, payload }); }),
  };
  return {
    renderer: {
      getCapabilities: () => ({
        webgpu:          caps.webgpu          ?? true,
        tier:            caps.tier            ?? 'medium',
        maxTextureSize:  caps.maxTextureSize  ?? 4096,
        float32Textures: caps.float32Textures ?? false,
      }),
    },
    events,
    gpuPhysics:     caps.hasGpuPhysics ? { label: 'fake-gpu-physics' } : null,
    physicsBackend: 'cpu',
    _bloomPass:     makePass(true),
    _vignettePass:  makePass(true),
    _chromaticPass: makePass(true),
    _ssaoPass:      makePass(false),
    postFx: {
      passes: [],
    },
  };
}

// ---------------------------------------------------------------------------
// QUALITY_PRESETS
// ---------------------------------------------------------------------------

describe('QUALITY_PRESETS', () => {
  it('defines high, medium, low tiers', () => {
    expect(QUALITY_PRESETS).toHaveProperty('high');
    expect(QUALITY_PRESETS).toHaveProperty('medium');
    expect(QUALITY_PRESETS).toHaveProperty('low');
  });

  it('high tier has ssaoEnabled=true', () => {
    expect(QUALITY_PRESETS.high.ssaoEnabled).toBe(true);
  });

  it('low tier has postFxEnabled=false and physicsBackend=cpu', () => {
    expect(QUALITY_PRESETS.low.postFxEnabled).toBe(false);
    expect(QUALITY_PRESETS.low.physicsBackend).toBe('cpu');
  });
});

// ---------------------------------------------------------------------------
// QualityManager.presetFor()
// ---------------------------------------------------------------------------

describe('QualityManager.presetFor()', () => {
  it('returns a frozen copy of the preset', () => {
    const p = QualityManager.presetFor('high');
    expect(p.ssaoEnabled).toBe(true);
    expect(() => { p.ssaoEnabled = false; }).toThrow(); // frozen
  });

  it('falls back to medium for unknown tier', () => {
    const p = QualityManager.presetFor('ultra');
    expect(p.bloomEnabled).toBe(QUALITY_PRESETS.medium.bloomEnabled);
  });
});

// ---------------------------------------------------------------------------
// QualityManager.apply()
// ---------------------------------------------------------------------------

describe('QualityManager.apply()', () => {
  it('sets currentTier', () => {
    const engine = makeEngine();
    const qm = new QualityManager(engine);
    qm.apply('high');
    expect(qm.currentTier).toBe('high');
  });

  it('enables bloom pass for high tier', () => {
    const engine = makeEngine();
    engine._bloomPass.enabled = false;
    const qm = new QualityManager(engine);
    qm.apply('high');
    expect(engine._bloomPass.enabled).toBe(true);
  });

  it('disables ssao pass for medium tier', () => {
    const engine = makeEngine();
    engine._ssaoPass.enabled = true;
    const qm = new QualityManager(engine);
    qm.apply('medium');
    expect(engine._ssaoPass.enabled).toBe(false);
  });

  it('enables ssao pass for high tier', () => {
    const engine = makeEngine();
    engine._ssaoPass.enabled = false;
    const qm = new QualityManager(engine);
    qm.apply('high');
    expect(engine._ssaoPass.enabled).toBe(true);
  });

  it('emits quality:changed event with tier and settings', () => {
    const engine = makeEngine();
    const qm = new QualityManager(engine);
    qm.apply('low');
    const emitted = engine.events._emitted.find(e => e.ev === 'quality:changed');
    expect(emitted).toBeDefined();
    expect(emitted.payload.tier).toBe('low');
    expect(emitted.payload.settings).toBeDefined();
  });

  it('clears overrides when apply() is called again', () => {
    const engine = makeEngine();
    const qm = new QualityManager(engine);
    qm.apply('high');
    qm.set('bloomEnabled', false);
    expect(qm._overrides.size).toBe(1);
    qm.apply('medium');
    expect(qm._overrides.size).toBe(0);
  });

  it('sets physicsBackend=gpu when gpuPhysics present on high tier', () => {
    const engine = makeEngine({ hasGpuPhysics: true });
    const qm = new QualityManager(engine);
    qm.apply('high');
    expect(engine.physicsBackend).toBe('gpu');
  });

  it('keeps physicsBackend=cpu on low tier even with gpuPhysics', () => {
    const engine = makeEngine({ hasGpuPhysics: true });
    const qm = new QualityManager(engine);
    qm.apply('low');
    expect(engine.physicsBackend).toBe('cpu');
  });
});

// ---------------------------------------------------------------------------
// QualityManager.set()
// ---------------------------------------------------------------------------

describe('QualityManager.set()', () => {
  it('overrides a single setting without changing tier', () => {
    const engine = makeEngine();
    const qm = new QualityManager(engine);
    qm.apply('high');
    qm.set('bloomEnabled', false);
    expect(qm.currentTier).toBe('high');
    expect(engine._bloomPass.enabled).toBe(false);
  });

  it('tracks override keys', () => {
    const engine = makeEngine();
    const qm = new QualityManager(engine);
    qm.apply('medium');
    qm.set('vignetteEnabled', false);
    expect(qm._overrides.has('vignetteEnabled')).toBe(true);
  });

  it('emits quality:overridden event', () => {
    const engine = makeEngine();
    const qm = new QualityManager(engine);
    qm.apply('medium');
    qm.set('chromaticEnabled', false);
    const emitted = engine.events._emitted.find(e => e.ev === 'quality:overridden');
    expect(emitted).toBeDefined();
    expect(emitted.payload.key).toBe('chromaticEnabled');
    expect(emitted.payload.value).toBe(false);
  });

  it('settings getter reflects overrides', () => {
    const engine = makeEngine();
    const qm = new QualityManager(engine);
    qm.apply('medium');
    qm.set('maxParticles', 9999);
    expect(qm.settings.maxParticles).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// Tier auto-detection
// ---------------------------------------------------------------------------

describe('QualityManager._detectTier()', () => {
  it('detects "high" from caps.tier=high', () => {
    const engine = makeEngine({ tier: 'high' });
    const qm = new QualityManager(engine);
    const tier = qm.apply(); // no forceTier — auto-detect
    expect(tier).toBe('high');
  });

  it('detects "low" when caps.webgpu=false', () => {
    const engine = makeEngine({ webgpu: false });
    const qm = new QualityManager(engine);
    expect(qm.apply()).toBe('low');
  });

  it('detects "medium" when caps.tier=medium', () => {
    const engine = makeEngine({ tier: 'medium' });
    const qm = new QualityManager(engine);
    expect(qm.apply()).toBe('medium');
  });
});
