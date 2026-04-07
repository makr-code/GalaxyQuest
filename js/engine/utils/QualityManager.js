/**
 * QualityManager.js
 *
 * Centralised quality-tier management for the WebGPU engine.
 *
 * Translates a WebGPUCapabilities tier ('high' | 'medium' | 'low') into a
 * concrete set of quality switches that are applied consistently across all
 * engine subsystems — post-effects, physics workload, particle counts, etc.
 *
 * Usage:
 *   const qm = new QualityManager(engine);
 *   qm.apply();          // auto-detect tier from renderer capabilities
 *   qm.apply('medium');  // force a specific tier
 *   qm.currentTier;      // → 'medium'
 *
 *   // Override a single switch without changing the tier:
 *   qm.set('ssaoEnabled', false);
 *
 * Quality presets
 * ---------------
 * high   — SSAO on, all bloom passes, max particles, GPU physics
 * medium — No SSAO, reduced bloom levels, reduced particles, GPU physics
 * low    — Minimal post-fx, CPU physics, lowest particle count
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** @typedef {'high'|'medium'|'low'} QualityTier */

/**
 * Preset quality configurations per tier.
 * Consumers should treat values here as recommended defaults; individual
 * switches can always be overridden via `qm.set(key, value)`.
 *
 * @type {Record<QualityTier, Object>}
 */
const QUALITY_PRESETS = {
  high: {
    ssaoEnabled:       true,
    bloomEnabled:      true,
    bloomMipLevels:    4,
    vignetteEnabled:   true,
    chromaticEnabled:  true,
    maxParticles:      8192,
    physicsBackend:    'gpu',    // prefer GPU physics
    postFxEnabled:     true,
    shadowsEnabled:    true,
    anisotropy:        16,
  },
  medium: {
    ssaoEnabled:       false,
    bloomEnabled:      true,
    bloomMipLevels:    2,
    vignetteEnabled:   true,
    chromaticEnabled:  false,
    maxParticles:      2048,
    physicsBackend:    'gpu',
    postFxEnabled:     true,
    shadowsEnabled:    false,
    anisotropy:        4,
  },
  low: {
    ssaoEnabled:       false,
    bloomEnabled:      false,
    bloomMipLevels:    1,
    vignetteEnabled:   false,
    chromaticEnabled:  false,
    maxParticles:      512,
    physicsBackend:    'cpu',
    postFxEnabled:     false,
    shadowsEnabled:    false,
    anisotropy:        1,
  },
};

class QualityManager {
  /**
   * @param {import('../GameEngine').GameEngine} engine
   */
  constructor(engine) {
    this._engine      = engine;
    /** @type {QualityTier} */
    this._tier        = 'medium';
    /** @type {Object} Merged preset + any per-key overrides */
    this._settings    = { ...QUALITY_PRESETS.medium };
    /** @type {Set<string>} Keys that were explicitly overridden via set() */
    this._overrides   = new Set();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Detect the quality tier from the renderer capabilities and apply the
   * matching preset to all connected engine subsystems.
   *
   * @param {QualityTier} [forceTier]  Override auto-detection.
   * @returns {QualityTier}  The tier that was applied.
   */
  apply(forceTier) {
    const tier = forceTier ?? this._detectTier();
    this._tier     = tier;
    this._settings = { ...QUALITY_PRESETS[tier] };
    this._overrides.clear();

    this._applyToEngine();

    const engine = this._engine;
    if (engine?.events) {
      engine.events.emit('quality:changed', { tier, settings: { ...this._settings } });
    }

    return tier;
  }

  /**
   * Override a single quality setting without changing the overall tier.
   * Useful for runtime tweaks ("I want medium but with SSAO off").
   *
   * @param {string} key    Setting key (see QUALITY_PRESETS)
   * @param {*}      value
   */
  set(key, value) {
    this._settings[key] = value;
    this._overrides.add(key);
    this._applyOneSetting(key, value);

    const engine = this._engine;
    if (engine?.events) {
      engine.events.emit('quality:overridden', { key, value, tier: this._tier });
    }
  }

  /** @returns {QualityTier} */
  get currentTier() { return this._tier; }

  /** @returns {Readonly<Object>} Current settings snapshot */
  get settings()    { return Object.freeze({ ...this._settings }); }

  /**
   * Return the preset for a given tier without applying it.
   * @param {QualityTier} tier
   * @returns {Readonly<Object>}
   */
  static presetFor(tier) {
    return Object.freeze({ ...(QUALITY_PRESETS[tier] ?? QUALITY_PRESETS.medium) });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Determine the appropriate tier based on the renderer capabilities.
   * @returns {QualityTier}
   * @private
   */
  _detectTier() {
    const caps = this._engine?.renderer?.getCapabilities?.() ?? {};

    if (!caps.webgpu) return 'low';

    // Explicit tier from WebGPUCapabilities (e.g. set by WebGPUCapabilities.js)
    if (caps.tier === 'high')   return 'high';
    if (caps.tier === 'medium') return 'medium';
    if (caps.tier === 'low')    return 'low';

    // Fallback heuristic: large texture size + float32 textures → high
    if (caps.maxTextureSize >= 8192 && caps.float32Textures) return 'high';
    if (caps.maxTextureSize >= 4096) return 'medium';
    return 'low';
  }

  /**
   * Push all current settings to the engine subsystems.
   * @private
   */
  _applyToEngine() {
    for (const [key, value] of Object.entries(this._settings)) {
      this._applyOneSetting(key, value);
    }
  }

  /**
   * Apply a single setting to the relevant engine subsystem.
   * @param {string} key
   * @param {*}      value
   * @private
   */
  _applyOneSetting(key, value) {
    const engine = this._engine;
    if (!engine) return;

    switch (key) {
      case 'ssaoEnabled':
        if (engine._ssaoPass)      engine._ssaoPass.enabled      = value;
        break;
      case 'bloomEnabled':
        if (engine._bloomPass)     engine._bloomPass.enabled     = value;
        break;
      case 'bloomMipLevels':
        if (engine._bloomPass)     engine._bloomPass.mipLevels   = value;
        break;
      case 'vignetteEnabled':
        if (engine._vignettePass)  engine._vignettePass.enabled  = value;
        break;
      case 'chromaticEnabled':
        if (engine._chromaticPass) engine._chromaticPass.enabled = value;
        break;
      case 'postFxEnabled':
        // Enable/disable the whole EffectComposer by toggling every pass
        if (engine.postFx) {
          for (const pass of engine.postFx.passes) {
            if (typeof pass.enabled !== 'undefined') pass.enabled = value;
          }
        }
        break;
      case 'physicsBackend':
        // Only switch to GPU if the engine already has gpuPhysics initialised
        if (value === 'gpu' && engine.gpuPhysics) {
          engine.physicsBackend = 'gpu';
        } else {
          engine.physicsBackend = 'cpu';
        }
        break;
      // maxParticles, shadowsEnabled, anisotropy — reserved for future subsystems
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QualityManager, QUALITY_PRESETS };
} else {
  window.GQQualityManager = { QualityManager, QUALITY_PRESETS };
}
