/**
 * StellarExplosionFX.js — Specialized explosion effects for stellar bodies.
 *
 * Extends base explosion system with stellar-scale effects:
 *   • Nova explosion (star brightening + ejection)
 *   • Black hole tidal disruption
 *   • Supernova cascade (multi-stage)
 *   • Stellar flare
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * Stellar explosion types.
 * @enum {string}
 */
const StellarExplosionType = Object.freeze({
  /** Bright stellar flare — temporary intensity spike */
  FLARE:      'flare',
  /** Nova explosion — star brightening and debris ejection */
  NOVA:       'nova',
  /** Supernova — massive multi-stage explosion */
  SUPERNOVA:  'supernova',
  /** Tidal disruption — black hole spaghettification effects */
  TIDAL_DISRUPTION: 'tidal_disruption',
});

/**
 * Stellar explosion presets — tuned for stellar-scale objects.
 * @private
 */
const _STELLAR_PRESETS = {
  [StellarExplosionType.FLARE]: {
    // Sudden brightness spike
    flare: {
      count: 0,                     // Mostly light-based
      duration: 0.2,
    },
    light: {
      color: 0xffffff,
      intensity: 8.0,               // Peak intensity
      distance: 1000,               // Star-scale distance
      duration: 0.3,
    },
  },

  [StellarExplosionType.NOVA]: {
    // Core eruption
    core: {
      count: 120, lifetime: 1.2, lifetimeVariance: 0.4,
      speed: 8, speedVariance: 0.6, spread: 1.57,
      colorStart: 0xffffff, colorEnd: 0xff6600,
      sizeStart: 4.0, sizeEnd: 0.0, drag: 0.05, gravity: 0,
    },
    // Debris cloud (large scale)
    debris: {
      count: 80, lifetime: 1.8, lifetimeVariance: 0.5,
      speed: 12, speedVariance: 0.7, spread: 1.57,
      colorStart: 0xffaa22, colorEnd: 0x330000,
      sizeStart: 2.0, sizeEnd: 0.0, drag: 0.03, gravity: 0,
    },
    // Shock wave ring
    shockwave: {
      color: 0xffaaaa, opacity: 0.8, expandSpeed: 50, duration: 1.0,
    },
    light: {
      color: 0xff8844, intensity: 12.0, distance: 1500, duration: 1.5,
    },
  },

  [StellarExplosionType.SUPERNOVA]: {
    // Phase 1: Rapid core brightening (0-0.5s)
    brightness: {
      count: 0, duration: 0.5,
    },
    // Phase 2: Outer shell ejection (0.5-1.5s)
    shellEjection: {
      count: 200, lifetime: 1.5, lifetimeVariance: 0.5,
      speed: 20, speedVariance: 0.8, spread: 1.57,
      colorStart: 0xffffff, colorEnd: 0xff2200,
      sizeStart: 6.0, sizeEnd: 0.0, drag: 0.02, gravity: 0,
    },
    // Phase 3: Debris cascade (sustained)
    debrisCascade: {
      count: 150, lifetime: 2.5, lifetimeVariance: 0.8,
      speed: 15, speedVariance: 1.0, spread: 1.57,
      colorStart: 0xff6600, colorEnd: 0x110000,
      sizeStart: 3.0, sizeEnd: 0.0, drag: 0.02, gravity: 0,
    },
    // Concentric shock waves
    shockWaves: [
      { expandSpeed: 100, duration: 0.8, color: 0xffffff },
      { expandSpeed: 60, duration: 1.2, color: 0xff8800, delay: 0.3 },
      { expandSpeed: 40, duration: 1.5, color: 0xff0000, delay: 0.6 },
    ],
    light: {
      color: 0xff4400, intensity: 20.0, distance: 2000, duration: 2.0,
    },
  },

  [StellarExplosionType.TIDAL_DISRUPTION]: {
    // Spaghettification streams — vertical stretching
    stream: {
      count: 100, lifetime: 2.0, lifetimeVariance: 0.6,
      speed: 10, speedVariance: 0.4, spread: 0.2,
      colorStart: 0xffaaff, colorEnd: 0x330033,
      sizeStart: 2.5, sizeEnd: 0.0, drag: 0.02, gravity: 0,
    },
    // Accretion flares
    accretion: {
      count: 80, lifetime: 1.5, lifetimeVariance: 0.4,
      speed: 25, speedVariance: 1.0, spread: 1.57,
      colorStart: 0xffff44, colorEnd: 0x553300,
      sizeStart: 1.8, sizeEnd: 0.0, drag: 0.04, gravity: 0,
    },
    // Accretion disk intensity pulse
    light: {
      color: 0xffaa00, intensity: 10.0, distance: 800, duration: 1.2,
    },
  },
};

class StellarExplosionFX {
  /**
   * @param {ParticleSystem} particleSystem - Shared particle system
   */
  constructor(particleSystem) {
    this._particleSystem = particleSystem;
    this._densityScale = 1.0;  // LOD scale (0..1)
  }

  /**
   * Trigger a stellar explosion at a position.
   *
   * @param {string} type - StellarExplosionType value
   * @param {{x,y,z}} position - World position
   * @param {object} [opts] - Optional overrides
   * @param {THREE.PointLight} [opts.light] - Pre-created light (optional)
   * @returns {object} Explosion handle with duration
   */
  spawn(type, position, opts = {}) {
    const preset = _STELLAR_PRESETS[type];
    if (!preset) {
      console.warn(`[StellarExplosionFX] Unknown type: ${type}`);
      return null;
    }

    const handle = {
      type,
      position,
      startTime: 0,
      duration: preset.light?.duration ?? 1.0,
      lights: [],
      emitters: [],
    };

    // Spawn light
    if (preset.light && this._particleSystem) {
      const light = opts.light ?? this._createLight(preset.light);
      if (light) {
        handle.lights.push(light);
        this._particleSystem.addDynamicLight(light, preset.light.duration);
      }
    }

    // Spawn particle emitters for each sub-effect
    if (this._particleSystem) {
      for (const [effectName, config] of Object.entries(preset)) {
        if (effectName === 'light' || effectName === 'shockWaves' || !config.count) continue;

        // Apply density scale to particle count
        const scaledConfig = {
          ...config,
          count: Math.max(1, Math.floor((config.count ?? 50) * this._densityScale))
        };

        const emitter = this._createEmitter(position, scaledConfig);
        if (emitter) {
          handle.emitters.push(emitter);
          this._particleSystem.addEmitter(emitter);
        }
      }
    }

    return handle;
  }

  /**
   * Trigger a nova explosion (stellar brightening).
   * @param {{x,y,z}} position
   * @param {number} [brightness=1.0] - Intensity multiplier
   * @returns {object} Explosion handle
   */
  nova(position, brightness = 1.0) {
    return this.spawn(StellarExplosionType.NOVA, position, { brightness });
  }

  /**
   * Trigger a supernova (massive multi-stage explosion).
   * @param {{x,y,z}} position
   * @param {number} [scale=1.0] - Size multiplier
   * @returns {object} Explosion handle
   */
  supernova(position, scale = 1.0) {
    return this.spawn(StellarExplosionType.SUPERNOVA, position, { scale });
  }

  /**
   * Trigger a tidal disruption (black hole effect).
   * @param {{x,y,z}} position
   * @returns {object} Explosion handle
   */
  tidalDisruption(position) {
    return this.spawn(StellarExplosionType.TIDAL_DISRUPTION, position);
  }

  /**
   * Trigger a stellar flare (brief brightening).
   * @param {{x,y,z}} position
   * @returns {object} Explosion handle
   */
  flare(position) {
    return this.spawn(StellarExplosionType.FLARE, position);
  }

  /**
   * Set particle density scale (LOD).
   * @param {number} scale - 0 (off) to 1 (full)
   */
  setDensityScale(scale) {
    this._densityScale = Math.max(0, Math.min(1, scale));
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** @private */
  _createLight(config) {
    if (typeof THREE === 'undefined') return null;
    const light = new THREE.PointLight(config.color, config.intensity, config.distance);
    return light;
  }

  /** @private */
  _createEmitter(position, config) {
    const { ParticleEmitter, EmitterMode } = typeof require !== 'undefined'
      ? require('./ParticleEmitter.js')
      : { ParticleEmitter: window.GQParticleEmitter.ParticleEmitter,
          EmitterMode:     window.GQParticleEmitter.EmitterMode };

    return new ParticleEmitter({
      mode: config.mode ?? EmitterMode.BURST,
      position,
      direction: config.direction ?? { x: 0, y: 1, z: 0 },
      spread: config.spread ?? 1.57,
      count: config.count ?? 50,
      lifetime: config.lifetime ?? 1.0,
      lifetimeVariance: config.lifetimeVariance ?? 0.2,
      speed: config.speed ?? 10,
      speedVariance: config.speedVariance ?? 0.5,
      colorStart: config.colorStart ?? 0xff6600,
      colorEnd: config.colorEnd ?? 0x000000,
      sizeStart: config.sizeStart ?? 2.0,
      sizeEnd: config.sizeEnd ?? 0.0,
      gravity: config.gravity ?? 0,
      drag: config.drag ?? 0.05,
      duration: config.duration ?? 0,
    });
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StellarExplosionFX, StellarExplosionType };
}

if (typeof window !== 'undefined') {
  window.GQStellarExplosionFX = { StellarExplosionFX, StellarExplosionType };
}
