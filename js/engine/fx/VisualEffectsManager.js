/**
 * VisualEffectsManager.js — Central coordinator for particle and visual effect systems.
 *
 * Integrates:
 *   • ThrusterFX — spaceship propulsion visual effects
 *   • SunAnimator — stellar body glow and pulsation
 *   • EngineMaterialAnimator — engine nozzle emissive effects
 *   • PostEffectsManager — bloom and post-processing passes
 *
 * Usage:
 *   const vfxManager = new VisualEffectsManager({
 *     particleSystem: particleSystem,
 *     renderer: renderer,
 *     scene: scene,
 *     camera: camera,
 *   });
 *   
 *   // In game loop:
 *   vfxManager.update(deltaTime, gameState);
 *   vfxManager.attachShip(shipId, shipModel, engines, propulsionType);
 *   vfxManager.attachSun(starId, sunMesh, sunLight, animConfig);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { ThrusterFX } = typeof require !== 'undefined'
  ? require('./ThrusterFX.js')
  : { ThrusterFX: window.GQThrusterFX?.ThrusterFX };

const { SunAnimator } = typeof require !== 'undefined'
  ? require('./SunAnimator.js')
  : { SunAnimator: window.GQSunAnimator?.SunAnimator };

const { EngineMaterialAnimator } = typeof require !== 'undefined'
  ? require('./EngineMaterialAnimator.js')
  : { EngineMaterialAnimator: window.GQEngineMaterialAnimator?.EngineMaterialAnimator };

const { AsteroidBeltAnimator } = typeof require !== 'undefined'
  ? require('./AsteroidBeltAnimator.js')
  : { AsteroidBeltAnimator: window.GQAsteroidBeltAnimator?.AsteroidBeltAnimator };

const { NebulaAnimator } = typeof require !== 'undefined'
  ? require('./NebulaAnimator.js')
  : { NebulaAnimator: window.GQNebulaAnimator?.NebulaAnimator };

const { StellarExplosionFX } = typeof require !== 'undefined'
  ? require('./StellarExplosionFX.js')
  : { StellarExplosionFX: window.GQStellarExplosionFX?.StellarExplosionFX };

class VisualEffectsManager {
  /**
   * @param {object} opts
   * @param {ParticleSystem} opts.particleSystem - Shared particle system
   * @param {THREE.WebGLRenderer} [opts.renderer] - Three.js renderer
   * @param {THREE.Scene} [opts.scene] - Three.js scene
   * @param {THREE.Camera} [opts.camera] - Three.js camera
   */
  constructor(opts = {}) {
    this._particleSystem = opts.particleSystem;
    this._renderer = opts.renderer ?? null;
    this._scene = opts.scene ?? null;
    this._camera = opts.camera ?? null;

    // Sub-managers
    this._thrusterFX = ThrusterFX ? new ThrusterFX(this._particleSystem) : null;
    this._sunAnimator = SunAnimator ? new SunAnimator() : null;
    this._engineMaterialAnimator = EngineMaterialAnimator ? new EngineMaterialAnimator() : null;
    this._asteroidBeltAnimator = AsteroidBeltAnimator ? new AsteroidBeltAnimator() : null;
    this._nebulaAnimator = NebulaAnimator ? new NebulaAnimator() : null;
    this._stellarExplosionFX = StellarExplosionFX ? new StellarExplosionFX(this._particleSystem) : null;

    // Post-effects reference
    this._postEffects = null;

    // State tracking
    this._shipStates = new Map();  // { shipId: { velocity, acceleration, position } }
    this._globalTime = 0;
    this._enabled = true;
  }

  // -------------------------------------------------------------------------
  // Initialization & Configuration
  // -------------------------------------------------------------------------

  /**
   * Set the post-effects manager reference for coordination.
   * @param {PostEffectsManager} postEffects
   */
  setPostEffects(postEffects) {
    this._postEffects = postEffects;
    if (this._sunAnimator && postEffects?.passes?.bloom) {
      this._sunAnimator.setBloomPass(postEffects.passes.bloom);
    }
  }

  /**
   * Enable/disable all visual effects.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
    if (this._thrusterFX) this._thrusterFX.setEnabled(enabled);
  }

  // -------------------------------------------------------------------------
  // Thruster/Engine Effects
  // -------------------------------------------------------------------------

  /**
   * Attach thruster effects to a ship.
   *
   * @param {string} shipId - Unique ship identifier
   * @param {object} shipModel - Model metadata containing engines array
   * @param {PropulsionType} [propulsionType] - Override propulsion type
   * @returns {object} Thruster slot handle
   */
  attachShip(shipId, shipModel, propulsionType = null) {
    if (!this._thrusterFX) return null;

    const engines = shipModel?.engines ?? [];
    if (engines.length === 0) {
      console.warn(`[VisualEffectsManager] Ship ${shipId} has no engine definitions`);
      return null;
    }

    propulsionType = propulsionType ?? engines[0]?.propulsionType ?? 'chemical';

    const slot = this._thrusterFX.attachToShip(shipId, engines, propulsionType);
    if (slot) {
      this._shipStates.set(shipId, {
        velocity: { x: 0, y: 0, z: 0 },
        acceleration: { x: 0, y: 0, z: 0 },
        position: { x: 0, y: 0, z: 0 },
      });
    }
    return slot;
  }

  /**
   * Detach thruster effects from a ship.
   * @param {string} shipId
   */
  detachShip(shipId) {
    if (this._thrusterFX) {
      this._thrusterFX.detachFromShip(shipId);
    }
    this._shipStates.delete(shipId);
  }

  /**
   * Update ship state (velocity, acceleration, position).
   * @param {string} shipId
   * @param {{x,y,z}} position
   * @param {{x,y,z}} velocity
   * @param {{x,y,z}} [acceleration]
   */
  updateShipState(shipId, position, velocity, acceleration = null) {
    let state = this._shipStates.get(shipId);
    if (!state) {
      state = { velocity: { x: 0, y: 0, z: 0 }, acceleration: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } };
      this._shipStates.set(shipId, state);
    }

    state.position = { ...position };
    state.velocity = { ...velocity };
    if (acceleration) {
      state.acceleration = { ...acceleration };
    }
  }

  // -------------------------------------------------------------------------
  // Sun/Star Effects
  // -------------------------------------------------------------------------

  /**
   * Attach animated sun effects to a stellar body.
   *
   * @param {string} sunId - Unique star identifier
   * @param {THREE.Mesh} mesh - Star mesh
   * @param {THREE.PointLight} [light] - Optional dynamic light
   * @param {object} [config] - Animation config (see SunAnimator.addSun)
   */
  attachSun(sunId, mesh, light = null, config = null) {
    if (!this._sunAnimator) return;
    this._sunAnimator.addSun(sunId, mesh, light, config ?? {});
  }

  /**
   * Detach sun effects.
   * @param {string} sunId
   */
  detachSun(sunId) {
    if (this._sunAnimator) {
      this._sunAnimator.removeSun(sunId);
    }
  }

  // -------------------------------------------------------------------------
  // Engine Material Effects
  // -------------------------------------------------------------------------

  /**
   * Animate an engine nozzle material.
   *
   * @param {string} materialId - Unique material identifier
   * @param {THREE.MeshStandardMaterial} material - Engine nozzle material
   * @param {object} [config] - Animation config (see EngineMaterialAnimator.addMaterial)
   */
  attachEngineMaterial(materialId, material, config = null) {
    if (!this._engineMaterialAnimator) return;
    this._engineMaterialAnimator.addMaterial(materialId, material, config ?? {});
  }

  /**
   * Detach engine material animation.
   * @param {string} materialId
   */
  detachEngineMaterial(materialId) {
    if (this._engineMaterialAnimator) {
      this._engineMaterialAnimator.removeMaterial(materialId);
    }
  }

  // -------------------------------------------------------------------------
  // Scene Effects (Asteroid Belts, Nebulae, etc.)
  // -------------------------------------------------------------------------

  /**
   * Attach an animated asteroid belt.
   *
   * @param {string} beltId - Unique identifier
   * @param {THREE.Group|THREE.Mesh} beltMesh - Belt geometry
   * @param {object} [config] - Animation config (see AsteroidBeltAnimator.addBelt)
   */
  attachAsteroidBelt(beltId, beltMesh, config = null) {
    if (!this._asteroidBeltAnimator) return;
    this._asteroidBeltAnimator.addBelt(beltId, beltMesh, config ?? {});
  }

  /**
   * Detach an asteroid belt.
   * @param {string} beltId
   */
  detachAsteroidBelt(beltId) {
    if (this._asteroidBeltAnimator) {
      this._asteroidBeltAnimator.removeBelt(beltId);
    }
  }

  /**
   * Attach an animated nebula cloud.
   *
   * @param {string} nebulaId - Unique identifier
   * @param {THREE.Mesh|THREE.Group} nebulaMesh - Nebula geometry
   * @param {object} [config] - Animation config (see NebulaAnimator.addNebula)
   */
  attachNebula(nebulaId, nebulaMesh, config = null) {
    if (!this._nebulaAnimator) return;
    this._nebulaAnimator.addNebula(nebulaId, nebulaMesh, config ?? {});
  }

  /**
   * Detach a nebula.
   * @param {string} nebulaId
   */
  detachNebula(nebulaId) {
    if (this._nebulaAnimator) {
      this._nebulaAnimator.removeNebula(nebulaId);
    }
  }

  /**
   * Trigger a stellar explosion (nova, supernova, etc.).
   *
   * @param {string} type - StellarExplosionType value
   * @param {{x,y,z}} position - World position
   * @param {object} [opts] - Optional overrides
   * @returns {object} Explosion handle
   */
  spawnStellarExplosion(type, position, opts = null) {
    if (!this._stellarExplosionFX) return null;
    return this._stellarExplosionFX.spawn(type, position, opts ?? {});
  }

  // -------------------------------------------------------------------------

  /**
   * Update all visual effects. Call once per frame from the game loop.
   *
   * @param {number} dt - Delta-time (seconds)
   * @param {object} [opts] - Optional state updates
   * @param {Map<string, {x,y,z}>} [opts.velocities] - Ship velocities
   * @param {Map<string, {x,y,z}>} [opts.accelerations] - Ship accelerations
   * @param {Map<string, {x,y,z}>} [opts.positions] - Ship positions
   */
  update(dt, opts = {}) {
    if (!this._enabled) return;

    this._globalTime += dt;

    // Prepare state maps for thruster system
    const velocities = opts.velocities ?? this._extractVelocities();
    const accelerations = opts.accelerations ?? this._extractAccelerations();
    const positions = opts.positions ?? this._extractPositions();

    // Update thruster effects
    if (this._thrusterFX) {
      this._thrusterFX.update(dt, velocities, accelerations, positions);
    }

    // Update sun animations
    if (this._sunAnimator) {
      this._sunAnimator.update(dt);
    }

    // Update engine material animations
    if (this._engineMaterialAnimator) {
      this._engineMaterialAnimator.update(dt);
    }

    // Update asteroid belt animations
    if (this._asteroidBeltAnimator) {
      this._asteroidBeltAnimator.update(dt, opts.cameraPos);
    }

    // Update nebula animations
    if (this._nebulaAnimator) {
      this._nebulaAnimator.update(dt, opts.cameraPos);
    }
  }

  /**
   * Adjust particle density for LOD.
   * @param {number} scale - 0 = none, 1 = full
   */
  setParticleDensityScale(scale) {
    if (this._thrusterFX) {
      this._thrusterFX.setDensityScale(scale);
    }
  }

  /**
   * Adjust stellar glow intensity.
   * @param {number} scale - 0 = none, 1 = full
   */
  setSunIntensityScale(scale) {
    if (this._sunAnimator) {
      this._sunAnimator.setIntensityScale(scale);
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** @private */
  _extractVelocities() {
    const map = new Map();
    for (const [shipId, state] of this._shipStates.entries()) {
      map.set(shipId, state.velocity);
    }
    return map;
  }

  /** @private */
  _extractAccelerations() {
    const map = new Map();
    for (const [shipId, state] of this._shipStates.entries()) {
      map.set(shipId, state.acceleration);
    }
    return map;
  }

  /** @private */
  _extractPositions() {
    const map = new Map();
    for (const [shipId, state] of this._shipStates.entries()) {
      map.set(shipId, state.position);
    }
    return map;
  }

  /**
   * Clean up all resources.
   */
  dispose() {
    if (this._thrusterFX) this._thrusterFX = null;
    if (this._sunAnimator) this._sunAnimator.clear();
    if (this._engineMaterialAnimator) this._engineMaterialAnimator.clear();
    if (this._asteroidBeltAnimator) this._asteroidBeltAnimator.clear();
    if (this._nebulaAnimator) this._nebulaAnimator.clear();
    this._shipStates.clear();
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VisualEffectsManager };
}

if (typeof window !== 'undefined') {
  window.GQVisualEffectsManager = { VisualEffectsManager };
}
