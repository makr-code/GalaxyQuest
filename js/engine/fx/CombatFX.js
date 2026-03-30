/**
 * CombatFX.js — High-level combat visual effects manager.
 *
 * Provides a single API for spawning all combat-related FX:
 *   • Weapon fire  — laser beams, plasma bolts, railgun slugs, missiles
 *   • Explosions   — hit sparks, detonations, ship destruction, shockwaves
 *   • Shield impacts — energy hex-ripple, kinetic flash, null-void absorption
 *   • Dynamic lights — transient PointLights that flash and decay
 *
 * CombatFX is renderer-agnostic: it populates a ParticleSystem and a list of
 * DynamicLightHandle objects that the active renderer (WebGPU / WebGL) reads
 * each frame.  Beam / shockwave effects are represented as lightweight data
 * records that the renderer maps to instanced quads or procedural geometry.
 *
 * Phase FX-3 (implemented): instanced capsule beam renderer — see BeamEffect.js / beam.wgsl
 * Phase FX-4 (implemented): voxel-debris chunks for SHIP_DESTRUCTION — see VoxelDebris.js
 * Phase FX-5 (implemented): GPU compute path for particles — see GPUParticleSystem.js / particles.wgsl
 *
 * Inspired by:
 *   FreeSpace 2   (Volition, 1999)   — weapon bolt / beam / shockwave effects
 *   Homeworld     (Relic, 1999)      — shield bubble impact ripple
 *   Babylon.js    (Apache 2.0)       — particle presets library
 *   Three.js      (MIT)              — sprite/billboard particle rendering
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { ParticleEmitter, EmitterMode } = typeof require !== 'undefined'
  ? require('./ParticleEmitter.js')
  : { ParticleEmitter: window.GQParticleEmitter.ParticleEmitter,
      EmitterMode:     window.GQParticleEmitter.EmitterMode };

const { ParticleSystem } = typeof require !== 'undefined'
  ? require('./ParticleSystem.js')
  : { ParticleSystem: window.GQParticleSystem.ParticleSystem };

const { PointLight } = typeof require !== 'undefined'
  ? require('../scene/Light.js')
  : { PointLight: window.GQLight.PointLight };

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Weapon fire visual style.
 * @enum {string}
 */
const WeaponType = Object.freeze({
  /** Continuous energy beam — emits a glowing line with bloom + muzzle sparks. */
  LASER:   'laser',
  /** Slow energy projectile — glowing blob with particle trail. */
  PLASMA:  'plasma',
  /** Guided kinetic missile — exhaust smoke trail + warhead explosion on impact. */
  MISSILE: 'missile',
  /** Ultra-fast kinetic slug — electromagnetic flash + shockwave on impact. */
  RAILGUN: 'railgun',
});

/**
 * Explosion visual preset.
 * @enum {string}
 */
const ExplosionType = Object.freeze({
  /** Tiny sparks on a hull surface hit (low-damage or deflected shot). */
  HIT_SPARK:        'hit_spark',
  /** Medium fireball and debris fragments (direct hit, moderate damage). */
  DETONATION:       'detonation',
  /** Large multi-stage destruction sequence (ship or station destroyed). */
  SHIP_DESTRUCTION: 'ship_destruction',
  /** Expanding ring wave propagating outward from an impact centre. */
  SHOCKWAVE:        'shockwave',
});

/**
 * Shield impact visual style.
 * @enum {string}
 */
const ShieldImpactType = Object.freeze({
  /** Hexagonal ripple pattern spreading across an energy-shield bubble. */
  ENERGY:    'energy',
  /** Bright kinetic flash with outward particle scatter. */
  KINETIC:   'kinetic',
  /** Energy-absorption vortex — particles drawn inward toward impact point. */
  NULL_VOID: 'null_void',
});

// ---------------------------------------------------------------------------
// Presets — tuned per weapon / explosion / shield type
// ---------------------------------------------------------------------------

/** @private */
const _WEAPON_PRESETS = {
  [WeaponType.LASER]: {
    // Muzzle flash burst
    muzzle: {
      count: 12, lifetime: 0.15, lifetimeVariance: 0.05,
      speed: 12, speedVariance: 0.4, spread: 0.5,
      colorStart: 0x88ccff, colorEnd: 0x0044ff,
      sizeStart: 0.8, sizeEnd: 0.0, drag: 0.1,
    },
    // Hit spark burst
    impact: {
      count: 20, lifetime: 0.3, lifetimeVariance: 0.1,
      speed: 10, speedVariance: 0.5, spread: 1.2,
      colorStart: 0xffffff, colorEnd: 0x0022ff,
      sizeStart: 0.6, sizeEnd: 0.0, drag: 0.08,
    },
    // Beam record (rendered as a line/capsule by the renderer)
    beam: { color: 0x44aaff, coreColor: 0xffffff, glowRadius: 0.4, duration: 0.05 },
    // Flash light
    light: { color: 0x4488ff, intensity: 3.0, distance: 40, duration: 0.12 },
  },

  [WeaponType.PLASMA]: {
    // Trailing glow while in flight
    trail: {
      mode: EmitterMode.CONTINUOUS,
      count: 20,            // particles/second
      lifetime: 0.5, lifetimeVariance: 0.15,
      speed: 1.5, speedVariance: 0.5, spread: 0.15,
      colorStart: 0x00ff88, colorEnd: 0x003322,
      sizeStart: 1.4, sizeEnd: 0.0, drag: 0.06,
      duration: 0,          // controlled externally (stopped on impact)
    },
    impact: {
      count: 35, lifetime: 0.5, lifetimeVariance: 0.2,
      speed: 8, speedVariance: 0.4, spread: 1.4,
      colorStart: 0x88ffcc, colorEnd: 0x002211,
      sizeStart: 1.0, sizeEnd: 0.0, drag: 0.06,
    },
    light: { color: 0x00ff88, intensity: 2.5, distance: 35, duration: 0.3 },
  },

  [WeaponType.MISSILE]: {
    // Exhaust smoke while in flight
    exhaust: {
      mode: EmitterMode.CONTINUOUS,
      count: 30, lifetime: 0.8, lifetimeVariance: 0.2,
      speed: 2, speedVariance: 0.6, spread: 0.2,
      colorStart: 0xaaaaaa, colorEnd: 0x222222,
      sizeStart: 0.9, sizeEnd: 1.6, drag: 0.03,
      duration: 0,
    },
    // Warhead explosion (DETONATION preset is added automatically)
    light: { color: 0xff8822, intensity: 5.0, distance: 60, duration: 0.4 },
  },

  [WeaponType.RAILGUN]: {
    // Electromagnetic discharge at muzzle
    muzzle: {
      count: 18, lifetime: 0.12, lifetimeVariance: 0.04,
      speed: 20, speedVariance: 0.6, spread: 0.25,
      colorStart: 0xffffff, colorEnd: 0x4400aa,
      sizeStart: 1.0, sizeEnd: 0.0, drag: 0.12,
    },
    // Kinetic shockwave on impact (drives a SHOCKWAVE record)
    impact: {
      count: 40, lifetime: 0.25, lifetimeVariance: 0.08,
      speed: 18, speedVariance: 0.5, spread: 1.5,
      colorStart: 0xffffff, colorEnd: 0x440088,
      sizeStart: 0.7, sizeEnd: 0.0, drag: 0.1,
    },
    light: { color: 0xaa44ff, intensity: 6.0, distance: 50, duration: 0.08 },
  },
};

/** @private */
const _EXPLOSION_PRESETS = {
  [ExplosionType.HIT_SPARK]: {
    count: 15, lifetime: 0.25, lifetimeVariance: 0.1,
    speed: 7, speedVariance: 0.5, spread: 1.57,
    colorStart: 0xffdd66, colorEnd: 0x440000,
    sizeStart: 0.5, sizeEnd: 0.0, drag: 0.08,
    light: { color: 0xffaa33, intensity: 1.5, distance: 15, duration: 0.1 },
  },

  [ExplosionType.DETONATION]: {
    // Main fireball
    fireball: {
      count: 60, lifetime: 0.6, lifetimeVariance: 0.2,
      speed: 6, speedVariance: 0.5, spread: 1.57,
      colorStart: 0xffaa22, colorEnd: 0x220000,
      sizeStart: 2.0, sizeEnd: 0.0, drag: 0.05,
    },
    // Debris sparks
    sparks: {
      count: 40, lifetime: 0.8, lifetimeVariance: 0.3,
      speed: 14, speedVariance: 0.6, spread: 1.57,
      colorStart: 0xffffff, colorEnd: 0x553300,
      sizeStart: 0.6, sizeEnd: 0.0, drag: 0.04,
    },
    light: { color: 0xff6600, intensity: 8.0, distance: 80, duration: 0.5 },
  },

  [ExplosionType.SHIP_DESTRUCTION]: {
    // Phase 1: initial core flash
    core: {
      count: 80, lifetime: 1.2, lifetimeVariance: 0.4,
      speed: 10, speedVariance: 0.6, spread: 1.57,
      colorStart: 0xffffff, colorEnd: 0x440000,
      sizeStart: 3.0, sizeEnd: 0.0, drag: 0.04,
    },
    // Phase 2: sustained fireball cloud
    cloud: {
      mode: EmitterMode.CONTINUOUS,
      count: 40, lifetime: 1.8, lifetimeVariance: 0.5,
      speed: 3, speedVariance: 0.5, spread: 1.57,
      colorStart: 0xff6600, colorEnd: 0x110000,
      sizeStart: 4.0, sizeEnd: 0.0, drag: 0.03,
      duration: 1.5,
    },
    // Phase 3: debris shards (TODO FX-4: voxel chunks)
    debris: {
      count: 60, lifetime: 2.5, lifetimeVariance: 0.8,
      speed: 15, speedVariance: 0.7, spread: 1.57,
      colorStart: 0x888888, colorEnd: 0x111111,
      sizeStart: 0.8, sizeEnd: 0.3, drag: 0.01, gravity: 0,
    },
    light: { color: 0xff4400, intensity: 15.0, distance: 200, duration: 1.2 },
  },

  [ExplosionType.SHOCKWAVE]: {
    // Outward ring represented as a ShockwaveRecord (renderer maps to a ring mesh)
    ring: { color: 0xaaccff, opacity: 0.7, expandSpeed: 30, duration: 0.4 },
    // Accompanying particle haze
    haze: {
      count: 50, lifetime: 0.35, lifetimeVariance: 0.1,
      speed: 8, speedVariance: 0.3, spread: 1.57,
      colorStart: 0xaaccff, colorEnd: 0x000044,
      sizeStart: 0.8, sizeEnd: 0.0, drag: 0.06,
    },
    light: { color: 0x88aaff, intensity: 4.0, distance: 100, duration: 0.2 },
  },
};

/** @private */
const _SHIELD_PRESETS = {
  [ShieldImpactType.ENERGY]: {
    // Ripple record — renderer draws an animated hex grid overlay on the shield bubble
    ripple: { color: 0x00ccff, opacity: 0.8, expandSpeed: 20, duration: 0.5 },
    sparks: {
      count: 20, lifetime: 0.3, lifetimeVariance: 0.1,
      speed: 5, speedVariance: 0.4, spread: 0.6,
      colorStart: 0x88eeff, colorEnd: 0x001133,
      sizeStart: 0.6, sizeEnd: 0.0, drag: 0.1,
    },
    light: { color: 0x00aaff, intensity: 3.0, distance: 30, duration: 0.25 },
  },

  [ShieldImpactType.KINETIC]: {
    sparks: {
      count: 35, lifetime: 0.2, lifetimeVariance: 0.08,
      speed: 12, speedVariance: 0.5, spread: 1.0,
      colorStart: 0xffffff, colorEnd: 0x334455,
      sizeStart: 0.5, sizeEnd: 0.0, drag: 0.12,
    },
    light: { color: 0xffffff, intensity: 5.0, distance: 25, duration: 0.08 },
  },

  [ShieldImpactType.NULL_VOID]: {
    // Particles pulled inward — negative speed
    vortex: {
      count: 30, lifetime: 0.4, lifetimeVariance: 0.1,
      speed: -6, speedVariance: 0.3, spread: 1.57,
      colorStart: 0x9900ff, colorEnd: 0x110022,
      sizeStart: 0.7, sizeEnd: 0.0, drag: 0.05,
    },
    light: { color: 0x6600cc, intensity: 4.0, distance: 25, duration: 0.35 },
  },
};

// ---------------------------------------------------------------------------
// Record types (for renderer integration)
// ---------------------------------------------------------------------------

let _recId = 1;

/**
 * Represents a laser/beam segment.  Renderer maps this to a line or capsule mesh.
 * @typedef {object} BeamRecord
 * @property {number} id
 * @property {'beam'} type
 * @property {{x,y,z}} from
 * @property {{x,y,z}} to
 * @property {number} color
 * @property {number} coreColor
 * @property {number} glowRadius
 * @property {number} elapsed
 * @property {number} duration
 */

/**
 * Represents an expanding shockwave ring.
 * @typedef {object} ShockwaveRecord
 * @property {number} id
 * @property {'shockwave'} type
 * @property {{x,y,z}} position
 * @property {number} radius   Current radius (updated each tick)
 * @property {number} color
 * @property {number} opacity
 * @property {number} expandSpeed
 * @property {number} elapsed
 * @property {number} duration
 */

/**
 * Represents a shield impact ripple overlay.
 * @typedef {object} ShieldRippleRecord
 * @property {number} id
 * @property {'shield_ripple'} type
 * @property {{x,y,z}} position  Impact point (on the shield surface)
 * @property {{x,y,z}} normal    Surface normal at impact point
 * @property {ShieldImpactType} shieldType
 * @property {number} color
 * @property {number} opacity
 * @property {number} radius     Current ripple radius
 * @property {number} expandSpeed
 * @property {number} elapsed
 * @property {number} duration
 */

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class CombatFX {
  /**
   * @param {object}         [opts]
   * @param {ParticleSystem} [opts.particleSystem] - Shared ParticleSystem; one is created if omitted.
   * @param {number}         [opts.maxParticles=4096]
   */
  constructor(opts = {}) {
    this._ps = opts.particleSystem ?? new ParticleSystem({ maxParticles: opts.maxParticles ?? 4096 });

    /** @type {BeamRecord[]} */
    this._beams = [];
    /** @type {ShockwaveRecord[]} */
    this._shockwaves = [];
    /** @type {ShieldRippleRecord[]} */
    this._ripples = [];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Spawn weapon-fire effects (muzzle flash, in-flight trail/beam, impact burst).
   *
   * @param {string}    type         - WeaponType value
   * @param {{x,y,z}}  from         - Origin (muzzle position)
   * @param {{x,y,z}}  [to]         - Impact position (omit for in-flight only)
   * @param {object}   [overrides]  - Optional preset overrides
   * @returns {{emitters: ParticleEmitter[], lights: PointLight[], beams: BeamRecord[]}}
   */
  spawnWeaponFire(type, from, to, overrides = {}) {
    const preset  = _WEAPON_PRESETS[type];
    if (!preset) {
      console.warn(`[CombatFX] Unknown WeaponType "${type}"`);
      return { emitters: [], lights: [], beams: [] };
    }

    const emitters = [];
    const lights   = [];
    const beams    = [];

    // Direction from → to (or default upward if no target)
    const dir = to ? _normalize(_sub(to, from)) : { x: 0, y: 1, z: 0 };

    // Muzzle emitter
    if (preset.muzzle) {
      emitters.push(this._ps.addEmitter(new ParticleEmitter({
        ...preset.muzzle, ...overrides.muzzle,
        mode: EmitterMode.BURST, position: from, direction: dir,
      })));
    }

    // Continuous trail emitter (returned for caller to stop on impact)
    if (preset.trail) {
      emitters.push(this._ps.addEmitter(new ParticleEmitter({
        ...preset.trail, ...overrides.trail,
        mode: EmitterMode.CONTINUOUS, position: from, direction: _negate(dir),
      })));
    }

    // Exhaust emitter for missiles
    if (preset.exhaust) {
      emitters.push(this._ps.addEmitter(new ParticleEmitter({
        ...preset.exhaust, ...overrides.exhaust,
        mode: EmitterMode.CONTINUOUS, position: from, direction: _negate(dir),
      })));
    }

    // Impact emitters (only when target position is known)
    if (to && preset.impact) {
      emitters.push(this._ps.addEmitter(new ParticleEmitter({
        ...preset.impact, ...overrides.impact,
        mode: EmitterMode.BURST, position: to, direction: _negate(dir),
      })));
    }

    // Muzzle emitter for railgun
    // NOTE: The general muzzle + impact blocks above already handle railgun muzzle
    // and target sparks.  The shockwave is added below — no duplicate emitter needed.

    // Beam record (laser only)
    if (preset.beam && to) {
      const beam = {
        id: _recId++, type: 'beam',
        from: { ...from }, to: { ...to },
        ...preset.beam,
        elapsed: 0,
      };
      this._beams.push(beam);
      beams.push(beam);
    }

    // Shockwave on railgun impact
    if (type === WeaponType.RAILGUN && to) {
      const sw = this._spawnShockwaveRecord(to, _EXPLOSION_PRESETS[ExplosionType.SHOCKWAVE].ring);
      this._shockwaves.push(sw);
    }

    // Dynamic light
    if (preset.light) {
      const cfg  = { ...preset.light, ...(overrides.light ?? {}) };
      const pos  = to ?? from;
      const pl   = _makeLight(cfg, pos);
      lights.push(pl);
      this._ps.addDynamicLight(pl, cfg.duration);
    }

    return { emitters, lights, beams };
  }

  /**
   * Spawn explosion effects.
   *
   * @param {{x,y,z}}    position  - World-space centre of explosion
   * @param {string}     type      - ExplosionType value
   * @param {number}     [scale=1] - Scale multiplier for particle speeds and sizes
   * @param {object}     [overrides]
   * @returns {{emitters: ParticleEmitter[], lights: PointLight[], shockwaves: ShockwaveRecord[]}}
   */
  spawnExplosion(position, type, scale = 1, overrides = {}) {
    const preset = _EXPLOSION_PRESETS[type];
    if (!preset) {
      console.warn(`[CombatFX] Unknown ExplosionType "${type}"`);
      return { emitters: [], lights: [], shockwaves: [] };
    }

    const emitters   = [];
    const lights     = [];
    const shockwaves = [];

    const _addBurst = (cfg, cfgKey) => {
      if (!cfg) return;
      const ov = overrides[cfgKey] ?? {};
      emitters.push(this._ps.addEmitter(new ParticleEmitter({
        ...cfg, ...ov,
        mode:     cfg.mode ?? EmitterMode.BURST,
        position: { ...position },
        speed:    (cfg.speed ?? 1) * scale,
        sizeStart: (cfg.sizeStart ?? 1) * scale,
        sizeEnd:   (cfg.sizeEnd ?? 0) * scale,
      })));
    };

    if (type === ExplosionType.HIT_SPARK) {
      _addBurst(preset, null); // preset IS the emitter config
      const p = _makeLight({ ...preset.light }, position);
      lights.push(p);
      this._ps.addDynamicLight(p, preset.light.duration);

    } else if (type === ExplosionType.DETONATION) {
      _addBurst(preset.fireball, 'fireball');
      _addBurst(preset.sparks,   'sparks');
      const p = _makeLight({ ...preset.light, ...(overrides.light ?? {}) }, position);
      lights.push(p);
      this._ps.addDynamicLight(p, preset.light.duration * scale);

    } else if (type === ExplosionType.SHIP_DESTRUCTION) {
      _addBurst(preset.core,   'core');
      _addBurst(preset.cloud,  'cloud');
      _addBurst(preset.debris, 'debris');
      const p = _makeLight({ ...preset.light, ...(overrides.light ?? {}) }, position);
      p.intensity *= scale;
      p.distance  *= scale;
      lights.push(p);
      this._ps.addDynamicLight(p, preset.light.duration * scale);

    } else if (type === ExplosionType.SHOCKWAVE) {
      _addBurst(preset.haze, 'haze');
      const sw = this._spawnShockwaveRecord(position, {
        ...preset.ring, expandSpeed: preset.ring.expandSpeed * scale,
      });
      this._shockwaves.push(sw);
      shockwaves.push(sw);
      const p = _makeLight({ ...preset.light, ...(overrides.light ?? {}) }, position);
      lights.push(p);
      this._ps.addDynamicLight(p, preset.light.duration);
    }

    return { emitters, lights, shockwaves };
  }

  /**
   * Spawn shield impact effects.
   *
   * @param {{x,y,z}}  position    - Impact point on shield surface
   * @param {{x,y,z}}  normal      - Outward surface normal at impact
   * @param {string}   type        - ShieldImpactType value
   * @param {object}   [overrides]
   * @returns {{emitters: ParticleEmitter[], lights: PointLight[], ripples: ShieldRippleRecord[]}}
   */
  spawnShieldImpact(position, normal, type, overrides = {}) {
    const preset = _SHIELD_PRESETS[type];
    if (!preset) {
      console.warn(`[CombatFX] Unknown ShieldImpactType "${type}"`);
      return { emitters: [], lights: [], ripples: [] };
    }

    const emitters = [];
    const lights   = [];
    const ripples  = [];

    const normalised = _normalize(normal);

    const _addBurst = (cfg, key) => {
      if (!cfg) return;
      const ov = overrides[key] ?? {};
      emitters.push(this._ps.addEmitter(new ParticleEmitter({
        ...cfg, ...ov,
        mode:      EmitterMode.BURST,
        position:  { ...position },
        direction: type === ShieldImpactType.NULL_VOID ? _negate(normalised) : normalised,
      })));
    };

    _addBurst(preset.sparks, 'sparks');
    _addBurst(preset.vortex, 'vortex');

    // Shield ripple record
    if (preset.ripple) {
      const rip = {
        id: _recId++, type: 'shield_ripple',
        position:    { ...position },
        normal:      { ...normalised },
        shieldType:  type,
        color:       preset.ripple.color,
        opacity:     preset.ripple.opacity,
        radius:      0,
        expandSpeed: preset.ripple.expandSpeed,
        elapsed:     0,
        duration:    preset.ripple.duration,
      };
      this._ripples.push(rip);
      ripples.push(rip);
    }

    // Dynamic light
    if (preset.light) {
      const cfg = { ...preset.light, ...(overrides.light ?? {}) };
      const pl  = _makeLight(cfg, position);
      lights.push(pl);
      this._ps.addDynamicLight(pl, cfg.duration);
    }

    return { emitters, lights, ripples };
  }

  /**
   * Spawn a standalone dynamic point light (e.g. engine glow, nav beacon pulse).
   *
   * @param {{x,y,z}} position
   * @param {number}  colorHex
   * @param {number}  intensity
   * @param {number}  distance
   * @param {number}  duration  - Fade-out duration in seconds
   * @returns {PointLight}
   */
  spawnDynamicLight(position, colorHex, intensity, distance, duration) {
    const pl = _makeLight({ color: colorHex, intensity, distance }, position);
    this._ps.addDynamicLight(pl, duration);
    return pl;
  }

  // -------------------------------------------------------------------------
  // Update — call once per frame
  // -------------------------------------------------------------------------

  /**
   * Advance all FX state by `dt` seconds.
   * @param {number} dt
   */
  update(dt) {
    this._ps.update(dt);

    // Advance beam records
    for (let i = this._beams.length - 1; i >= 0; i--) {
      this._beams[i].elapsed += dt;
      if (this._beams[i].elapsed >= this._beams[i].duration) {
        this._beams.splice(i, 1);
      }
    }

    // Advance shockwave records
    for (let i = this._shockwaves.length - 1; i >= 0; i--) {
      const sw = this._shockwaves[i];
      sw.elapsed += dt;
      sw.radius  += sw.expandSpeed * dt;
      if (sw.elapsed >= sw.duration) {
        this._shockwaves.splice(i, 1);
      }
    }

    // Advance shield ripple records
    for (let i = this._ripples.length - 1; i >= 0; i--) {
      const rip = this._ripples[i];
      rip.elapsed += dt;
      rip.radius  += rip.expandSpeed * dt;
      // Fade opacity as the ripple expands
      rip.opacity = Math.max(0, 1 - rip.elapsed / rip.duration) * (
        _SHIELD_PRESETS[rip.shieldType]?.ripple?.opacity ?? 1
      );
      if (rip.elapsed >= rip.duration) {
        this._ripples.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Read-only accessors (for renderer)
  // -------------------------------------------------------------------------

  /** @returns {ParticleSystem} */
  get particleSystem() { return this._ps; }

  /** @returns {BeamRecord[]} */
  get beams() { return this._beams; }

  /** @returns {ShockwaveRecord[]} */
  get shockwaves() { return this._shockwaves; }

  /** @returns {ShieldRippleRecord[]} */
  get ripples() { return this._ripples; }

  /** @returns {Array} Live dynamic light entries from ParticleSystem */
  get dynamicLights() { return this._ps.dynamicLights; }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose() {
    this._ps.dispose();
    this._beams.length      = 0;
    this._shockwaves.length = 0;
    this._ripples.length    = 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** @private */
  _spawnShockwaveRecord(position, ringCfg) {
    return {
      id:          _recId++,
      type:        'shockwave',
      position:    { ...position },
      radius:      0,
      color:       ringCfg.color,
      opacity:     ringCfg.opacity,
      expandSpeed: ringCfg.expandSpeed,
      elapsed:     0,
      duration:    ringCfg.duration,
    };
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function _sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function _normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function _negate(v) {
  return { x: -v.x, y: -v.y, z: -v.z };
}

/** Create a PointLight and set its position from a preset config + world-pos. */
function _makeLight(cfg, position) {
  const pl       = new PointLight(cfg.color, cfg.intensity, cfg.distance ?? 50, 2);
  pl.position.x  = position.x;
  pl.position.y  = position.y;
  pl.position.z  = position.z;
  pl.visible     = true;
  return pl;
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CombatFX,
    WeaponType,
    ExplosionType,
    ShieldImpactType,
  };
} else {
  window.GQCombatFX = { CombatFX, WeaponType, ExplosionType, ShieldImpactType };
}
