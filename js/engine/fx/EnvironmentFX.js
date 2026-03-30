/**
 * EnvironmentFX.js — Environmental and atmospheric visual effects manager.
 *
 * Complements CombatFX with persistent, world-space environmental effects:
 *
 *   • Debris fields    — tumbling hull/asteroid/ice fragments with angular velocity
 *   • Debris clouds    — dense post-destruction particle clouds (uses ParticleSystem)
 *   • Plasma clouds    — ionised gas hazards / reactor leak effects
 *   • Nebula volumes   — large-scale volumetric gas clouds (rendered via nebula.wgsl)
 *   • Space dust       — ambient micro-particle field filling a region
 *   • God rays         — volumetric light shafts from stars/explosions (godray.wgsl)
 *   • Lens flares      — multi-element lens-flare sequence from bright sources
 *   • Heat distortion  — screen-space heat shimmer around hot objects
 *   • EMP pulses       — expanding electromagnetic disruption ring
 *   • Coronas          — glowing energy halos around stars and plasma sources
 *   • Plasma torrents  — flowing plasma streams between two points
 *   • Gravitational lensing — warped space visual near massive objects
 *   • Radiation zones  — tinted hazard-zone overlays (pulsing opacity)
 *
 * All records are renderer-agnostic data objects.  The active renderer (WebGPU
 * or WebGL) iterates each record type every frame and maps them to the
 * appropriate draw calls, post-process passes or particle batches.
 *
 * Shader files (see js/engine/fx/shaders/):
 *   nebula.wgsl  — raymarched noise volume for nebulae / plasma clouds
 *   godray.wgsl  — radial-blur screen-space god-ray scattering pass
 *
 * Game-industry reference effects implemented here:
 *   ✓ Debris fields         (FreeSpace 2, Homeworld, X4)
 *   ✓ Debris clouds         (FreeSpace 2, Wing Commander)
 *   ✓ Plasma / gas clouds   (Elite Dangerous, No Man's Sky)
 *   ✓ Nebulae               (Star Citizen, Elite Dangerous, EVE Online)
 *   ✓ Space dust            (Elite Dangerous: supercruise)
 *   ✓ Volumetric god rays   (Killzone 2 original, Star Citizen, many AAA titles)
 *   ✓ Lens flares           (J.J. Abrams Star Trek, Star Citizen, many 3D engines)
 *   ✓ Heat distortion/shimmer (Mass Effect, Star Wars Squadrons)
 *   ✓ EMP visual pulse      (Homeworld, FreeSpace 2)
 *   ✓ Corona / stellar halo (EVE Online, Star Citizen)
 *   ✓ Plasma torrent / beam (FreeSpace 2 beam weapon, Star Citizen)
 *   ✓ Gravitational lensing (Interstellar movie VFX, Star Citizen)
 *   ✓ Radiation zone hazard (X4: Foundations, Endless Space 2)
 *
 * Phase FX-2/5 (implemented): GPU compute particle simulation — see GPUParticleSystem.js / particles.wgsl
 * Phase FX-3 (implemented): instanced capsule beam renderer — see BeamEffect.js / beam.wgsl
 * Phase FX-4 (implemented): voxel-debris chunk geometry pool — see VoxelDebris.js
 * Phase FX-6 (implemented): GPU-driven debris simulation — see DebrisSimulator.js / debris.wgsl
 * Phase FX-7 (implemented): volumetric scattering — see VolumetricScatter.js / volscatter.wgsl
 * Phase FX-8 (implemented): SSAO post-process — see SSAOPass.js / ssao.wgsl
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
 * Type of debris chunk — controls the geometry preset and colour palette.
 * @enum {string}
 */
const DebrisType = Object.freeze({
  /** Metallic hull plating / superstructure fragment. */
  HULL_FRAGMENT:    'hull_fragment',
  /** Rock/mineral asteroid chunk. */
  ASTEROID_CHUNK:   'asteroid_chunk',
  /** Frozen water / methane ice shard. */
  ICE_CRYSTAL:      'ice_crystal',
  /** Large wreckage from a space station or capital ship. */
  STATION_WRECKAGE: 'station_wreckage',
});

/**
 * Type of volumetric cloud volume.
 * @enum {string}
 */
const CloudType = Object.freeze({
  /** Ionised plasma gas (glowing, hazardous). */
  PLASMA:       'plasma',
  /** Interstellar nebula cloud. */
  NEBULA:       'nebula',
  /** Ambient micro-particle space dust field. */
  SPACE_DUST:   'space_dust',
  /** Dense post-destruction debris & smoke cloud. */
  DEBRIS_CLOUD: 'debris_cloud',
  /** Radioactive emission zone (health hazard indicator). */
  RADIATION:    'radiation',
});

/**
 * Type of post-process or world-space lighting effect.
 * @enum {string}
 */
const LightingFXType = Object.freeze({
  /** Volumetric light shaft (god ray / crepuscular ray). */
  GOD_RAY:             'god_ray',
  /** Multi-element camera lens flare from a bright source. */
  LENS_FLARE:          'lens_flare',
  /** Screen-space heat shimmer / distortion around a heat source. */
  HEAT_DISTORTION:     'heat_distortion',
  /** Expanding electromagnetic pulse ring. */
  EMP_PULSE:           'emp_pulse',
  /** Radial energy halo around a star, reactor or power source. */
  CORONA:              'corona',
  /** Warped space visual effect near a massive body. */
  GRAV_LENSING:        'grav_lensing',
  /** Pulsing tinted overlay indicating an environmental hazard. */
  RADIATION_ZONE:      'radiation_zone',
});

// ---------------------------------------------------------------------------
// Record-ID counter
// ---------------------------------------------------------------------------

let _recId = 1;

// ---------------------------------------------------------------------------
// Debris-chunk tuning presets
// ---------------------------------------------------------------------------

/** @private */
const _DEBRIS_PRESETS = {
  [DebrisType.HULL_FRAGMENT]:    { colorHex: 0x445566, scaleRange: [0.5, 2.5],  tumbleFactor: 1.0, drag: 0.0005 },
  [DebrisType.ASTEROID_CHUNK]:   { colorHex: 0x887755, scaleRange: [1.0, 6.0],  tumbleFactor: 0.4, drag: 0.0001 },
  [DebrisType.ICE_CRYSTAL]:      { colorHex: 0xaaddff, scaleRange: [0.3, 2.0],  tumbleFactor: 1.5, drag: 0.0002 },
  [DebrisType.STATION_WRECKAGE]: { colorHex: 0x334455, scaleRange: [3.0, 12.0], tumbleFactor: 0.3, drag: 0.0001 },
};

// Cloud colour presets  (inner, outer, density, turbulence, emissive)
/** @private */
const _CLOUD_PRESETS = {
  [CloudType.PLASMA]:       { colorInner: 0x00ffcc, colorOuter: 0x003322, density: 1.2, turbulence: 0.8, emissive: 0.9, opacity: 0.7 },
  [CloudType.NEBULA]:       { colorInner: 0xcc44ff, colorOuter: 0x110022, density: 0.6, turbulence: 0.4, emissive: 0.4, opacity: 0.5 },
  [CloudType.SPACE_DUST]:   { colorInner: 0xaabbcc, colorOuter: 0x112233, density: 0.2, turbulence: 0.1, emissive: 0.0, opacity: 0.25 },
  [CloudType.DEBRIS_CLOUD]: { colorInner: 0x888888, colorOuter: 0x111111, density: 0.9, turbulence: 0.6, emissive: 0.0, opacity: 0.6 },
  [CloudType.RADIATION]:    { colorInner: 0xaaff00, colorOuter: 0x224400, density: 0.5, turbulence: 0.3, emissive: 0.7, opacity: 0.45 },
};

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class EnvironmentFX {
  /**
   * @param {object}         [opts]
   * @param {ParticleSystem} [opts.particleSystem] - Shared particle system; one is created if omitted.
   * @param {number}         [opts.maxParticles=4096]
   */
  constructor(opts = {}) {
    this._ps = opts.particleSystem ?? new ParticleSystem({ maxParticles: opts.maxParticles ?? 4096 });

    /** @type {DebrisChunk[]} */
    this._debrisChunks = [];

    /** @type {CloudVolumeRecord[]} */
    this._cloudVolumes = [];

    /** @type {GodRayRecord[]} */
    this._godRays = [];

    /** @type {LensFlareRecord[]} */
    this._lensFlares = [];

    /** @type {HeatDistortionRecord[]} */
    this._heatDistortions = [];

    /** @type {EmpPulseRecord[]} */
    this._empPulses = [];

    /** @type {CoronaRecord[]} */
    this._coronas = [];

    /** @type {PlasmaTorrentRecord[]} */
    this._plasmaTorrents = [];

    /** @type {GravLensingRecord[]} */
    this._gravLensing = [];

    /** @type {RadiationZoneRecord[]} */
    this._radiationZones = [];
  }

  // =========================================================================
  // Debris
  // =========================================================================

  /**
   * Spawn a field of tumbling debris chunks scattered around a centre point.
   *
   * @param {{x,y,z}}  center     - World-space field centre
   * @param {string}   type       - DebrisType value
   * @param {number}   [count=20] - Number of chunks to scatter
   * @param {number}   [radius=50]- Scatter radius
   * @param {object}   [opts]     - Optional overrides: `speed`, `lifetime`, `scale`
   * @returns {DebrisChunk[]}
   */
  spawnDebrisField(center, type, count = 20, radius = 50, opts = {}) {
    const preset = _DEBRIS_PRESETS[type];
    if (!preset) {
      console.warn(`[EnvironmentFX] Unknown DebrisType "${type}"`);
      return [];
    }

    const chunks = [];
    for (let i = 0; i < count; i++) {
      const chunk = _makeDebrisChunk(center, radius, preset, opts);
      this._debrisChunks.push(chunk);
      chunks.push(chunk);
    }
    return chunks;
  }

  /**
   * Spawn a dense particle-based debris cloud (smoke + fragments) at a position.
   * Uses the ParticleSystem for the particle portion.
   *
   * @param {{x,y,z}}  position
   * @param {number}   [radius=30]   - Cloud radius
   * @param {object}   [opts]        - Overrides: `colorStart`, `colorEnd`, `count`, `rate` (smoke particles/s), `lifetime`, `duration`
   * @returns {{emitters: ParticleEmitter[], cloud: CloudVolumeRecord}}
   */
  spawnDebrisCloud(position, radius = 30, opts = {}) {
    // Particle layer: dense burst of small dark fragments
    const emitters = [];
    emitters.push(this._ps.addEmitter(new ParticleEmitter({
      mode:             EmitterMode.BURST,
      position:         { ...position },
      count:            opts.count       ?? 80,
      lifetime:         opts.lifetime    ?? 4.0,
      lifetimeVariance: 1.0,
      speed:            opts.speed       ?? 6,
      speedVariance:    0.5,
      spread:           Math.PI,
      colorStart:       opts.colorStart  ?? 0x998877,
      colorEnd:         opts.colorEnd    ?? 0x111111,
      sizeStart:        0.8,
      sizeEnd:          2.0,    // expand as they drift
      drag:             0.02,
    })));

    // Sustained smoke/gas emission
    emitters.push(this._ps.addEmitter(new ParticleEmitter({
      mode:             EmitterMode.CONTINUOUS,
      position:         { ...position },
      count:            opts.rate  ?? 20,
      lifetime:         3.0,
      lifetimeVariance: 1.0,
      speed:            2,
      speedVariance:    0.6,
      spread:           Math.PI,
      colorStart:       0x777777,
      colorEnd:         0x000000,
      sizeStart:        1.2,
      sizeEnd:          3.0,
      drag:             0.015,
      duration:         opts.duration    ?? 5.0,
    })));

    // Volume record (for renderer's volumetric pass)
    const cloud = this._addCloudVolume(position, radius, CloudType.DEBRIS_CLOUD, opts);

    return { emitters, cloud };
  }

  // =========================================================================
  // Plasma cloud
  // =========================================================================

  /**
   * Spawn a glowing plasma cloud (reactor leak, ion storm, gas hazard).
   *
   * @param {{x,y,z}}  position
   * @param {number}   [radius=40]  - Cloud radius
   * @param {object}   [opts]
   * @returns {{emitters: ParticleEmitter[], cloud: CloudVolumeRecord, light: PointLight|null}}
   */
  spawnPlasmaCloud(position, radius = 40, opts = {}) {
    const preset = _CLOUD_PRESETS[CloudType.PLASMA];

    const emitters = [];
    emitters.push(this._ps.addEmitter(new ParticleEmitter({
      mode:             EmitterMode.CONTINUOUS,
      position:         { ...position },
      count:            opts.rate ?? 30,
      lifetime:         2.5,
      lifetimeVariance: 1.0,
      speed:            1.5,
      speedVariance:    0.6,
      spread:           Math.PI,
      colorStart:       opts.colorStart ?? preset.colorInner,
      colorEnd:         opts.colorEnd   ?? preset.colorOuter,
      sizeStart:        1.6,
      sizeEnd:          0.2,
      drag:             0.02,
      duration:         opts.duration   ?? 0,    // 0 = infinite
    })));

    const cloud = this._addCloudVolume(position, radius, CloudType.PLASMA, opts);

    // Plasma glows — emit a dim dynamic light
    let light = null;
    if (opts.emitLight !== false) {
      light = new PointLight(opts.lightColor ?? preset.colorInner, opts.lightIntensity ?? 1.5,
                             radius * 1.2, 2);
      light.position.x = position.x;
      light.position.y = position.y;
      light.position.z = position.z;
    }

    return { emitters, cloud, light };
  }

  // =========================================================================
  // Nebula volume
  // =========================================================================

  /**
   * Register a persistent nebula volume (rendered by nebula.wgsl each frame).
   *
   * @param {{x,y,z}}  position    - Centre of the nebula
   * @param {number}   [radius=300]
   * @param {object}   [opts]      - Overrides: `colorInner`, `colorOuter`, `density`,
   *                                 `turbulence`, `opacity`, `emissive`
   * @returns {CloudVolumeRecord}
   */
  spawnNebulaVolume(position, radius = 300, opts = {}) {
    return this._addCloudVolume(position, radius, CloudType.NEBULA, opts);
  }

  // =========================================================================
  // Space dust
  // =========================================================================

  /**
   * Spawn an ambient space-dust particle field (micro-debris / stellar dust).
   *
   * @param {{x,y,z}}  position    - Field centre
   * @param {number}   [radius=100]
   * @param {object}   [opts]
   * @returns {{emitters: ParticleEmitter[], cloud: CloudVolumeRecord}}
   */
  spawnSpaceDust(position, radius = 100, opts = {}) {
    const emitters = [];
    // Continuous slow drift of tiny particles
    emitters.push(this._ps.addEmitter(new ParticleEmitter({
      mode:             EmitterMode.CONTINUOUS,
      position:         { ...position },
      count:            opts.rate ?? 15,
      lifetime:         8.0,
      lifetimeVariance: 3.0,
      speed:            0.3,
      speedVariance:    0.8,
      spread:           Math.PI,
      colorStart:       opts.colorStart ?? 0xaabbcc,
      colorEnd:         opts.colorEnd   ?? 0x223344,
      sizeStart:        0.15,
      sizeEnd:          0.0,
      drag:             0.005,
      duration:         opts.duration   ?? 0,
    })));

    const cloud = this._addCloudVolume(position, radius, CloudType.SPACE_DUST, opts);
    return { emitters, cloud };
  }

  // =========================================================================
  // God rays
  // =========================================================================

  /**
   * Spawn a volumetric light shaft (rendered via godray.wgsl post-process pass).
   *
   * @param {{x,y,z}}    origin     - World-space position of the light source
   * @param {{x,y,z}}    direction  - Direction the shaft points (normalised)
   * @param {object}     [opts]
   * @param {number}     [opts.colorHex=0xffffff]
   * @param {number}     [opts.intensity=1.0]  - Master brightness multiplier
   * @param {number}     [opts.decay=0.97]     - Per-sample attenuation
   * @param {number}     [opts.density=0.6]    - Step-length scale
   * @param {number}     [opts.numSamples=64]  - Ray-march samples (16–128)
   * @param {number}     [opts.duration=0]     - 0 = persistent; > 0 = auto-expire (s)
   * @returns {GodRayRecord}
   */
  spawnGodRay(origin, direction, opts = {}) {
    const rec = {
      id:         _recId++,
      type:       LightingFXType.GOD_RAY,
      origin:     { ...origin },
      direction:  _normalize(direction),
      colorHex:   opts.colorHex    ?? 0xffffff,
      intensity:  opts.intensity   ?? 1.0,
      decay:      opts.decay       ?? 0.97,
      density:    opts.density     ?? 0.6,
      numSamples: opts.numSamples  ?? 64,
      duration:   opts.duration    ?? 0,
      elapsed:    0,
      active:     true,
    };
    this._godRays.push(rec);
    return rec;
  }

  // =========================================================================
  // Lens flare
  // =========================================================================

  /**
   * Spawn a multi-element lens flare from a bright source.
   *
   * Each flare element is a billboard sprite positioned along the line from
   * the light source through the screen centre.  The renderer maps this record
   * to instanced quads.
   *
   * @param {{x,y,z}}  sourcePosition - World-space position of the light
   * @param {object}   [opts]
   * @param {number}   [opts.colorHex=0xffffff]
   * @param {number}   [opts.intensity=1.0]
   * @param {number}   [opts.numElements=5]  - Number of flare quads
   * @param {number}   [opts.scale=1.0]      - Overall size scale
   * @param {number}   [opts.duration=0]     - 0 = persistent
   * @returns {LensFlareRecord}
   */
  spawnLensFlare(sourcePosition, opts = {}) {
    const numElem = opts.numElements ?? 5;
    // Generate flare elements at varying positions along the source→centre axis
    const elements = Array.from({ length: numElem }, (_, i) => ({
      offset:   (i / (numElem - 1)) * 2.0 - 1.0, // -1 … +1 along flare axis
      size:     opts.scale ? (0.08 + 0.12 * Math.random()) * opts.scale
                           : (0.08 + 0.12 * Math.random()),
      opacity:  0.4 + 0.6 * Math.random(),
      colorHex: _tintFlareElement(opts.colorHex ?? 0xffffff, i),
    }));

    const rec = {
      id:             _recId++,
      type:           LightingFXType.LENS_FLARE,
      sourcePosition: { ...sourcePosition },
      colorHex:       opts.colorHex    ?? 0xffffff,
      intensity:      opts.intensity   ?? 1.0,
      elements,
      duration:       opts.duration    ?? 0,
      elapsed:        0,
      active:         true,
    };
    this._lensFlares.push(rec);
    return rec;
  }

  // =========================================================================
  // Heat distortion
  // =========================================================================

  /**
   * Spawn a heat-shimmer / distortion zone around a heat source.
   * The renderer applies this as a screen-space displacement (UV perturbation)
   * using a noise-based distortion shader.
   *
   * @param {{x,y,z}}  position   - World-space centre of the heat source
   * @param {number}   [radius=5] - Distortion influence radius (world units)
   * @param {object}   [opts]
   * @param {number}   [opts.strength=0.02]  - UV distortion magnitude
   * @param {number}   [opts.speed=1.5]      - Shimmer animation speed
   * @param {number}   [opts.duration=0]     - 0 = persistent
   * @returns {HeatDistortionRecord}
   */
  spawnHeatDistortion(position, radius = 5, opts = {}) {
    const rec = {
      id:       _recId++,
      type:     LightingFXType.HEAT_DISTORTION,
      position: { ...position },
      radius,
      strength: opts.strength  ?? 0.02,
      speed:    opts.speed     ?? 1.5,
      duration: opts.duration  ?? 0,
      elapsed:  0,
      active:   true,
    };
    this._heatDistortions.push(rec);
    return rec;
  }

  // =========================================================================
  // EMP pulse
  // =========================================================================

  /**
   * Spawn an electromagnetic pulse — an expanding ring with a distortion front
   * and a flickering light flash.
   *
   * @param {{x,y,z}}  position
   * @param {object}   [opts]
   * @param {number}   [opts.colorHex=0x88aaff]
   * @param {number}   [opts.expandSpeed=80]   - Ring expansion speed (units/s)
   * @param {number}   [opts.maxRadius=200]    - Stop expanding at this radius
   * @param {number}   [opts.duration=1.0]
   * @param {number}   [opts.distortStrength=0.04] - UV distortion at the pulse front
   * @returns {{record: EmpPulseRecord, emitters: ParticleEmitter[]}}
   */
  spawnEmpPulse(position, opts = {}) {
    const duration = opts.duration ?? 1.0;

    const rec = {
      id:             _recId++,
      type:           LightingFXType.EMP_PULSE,
      position:       { ...position },
      radius:         0,
      maxRadius:      opts.maxRadius      ?? 200,
      colorHex:       opts.colorHex       ?? 0x88aaff,
      expandSpeed:    opts.expandSpeed    ?? 80,
      distortStrength:opts.distortStrength ?? 0.04,
      duration,
      elapsed:        0,
      active:         true,
    };
    this._empPulses.push(rec);

    // Particle layer: arcing blue sparks
    const emitters = [];
    emitters.push(this._ps.addEmitter(new ParticleEmitter({
      mode:             EmitterMode.BURST,
      position:         { ...position },
      count:            50,
      lifetime:         0.6,
      lifetimeVariance: 0.2,
      speed:            20,
      speedVariance:    0.5,
      spread:           Math.PI,
      colorStart:       opts.colorHex ?? 0x88aaff,
      colorEnd:         0x000022,
      sizeStart:        0.4,
      sizeEnd:          0.0,
      drag:             0.08,
    })));

    return { record: rec, emitters };
  }

  // =========================================================================
  // Corona
  // =========================================================================

  /**
   * Register a persistent corona / energy halo around a star or power source.
   *
   * @param {{x,y,z}}  position
   * @param {number}   [radius=50]
   * @param {object}   [opts]
   * @param {number}   [opts.colorHex=0xffdd88]
   * @param {number}   [opts.pulseFrequency=0.3]  - Flicker frequency (Hz)
   * @param {number}   [opts.pulseAmplitude=0.15] - Opacity variation amplitude
   * @param {number}   [opts.duration=0]          - 0 = persistent
   * @returns {CoronaRecord}
   */
  spawnCorona(position, radius = 50, opts = {}) {
    const rec = {
      id:              _recId++,
      type:            LightingFXType.CORONA,
      position:        { ...position },
      radius,
      colorHex:        opts.colorHex        ?? 0xffdd88,
      pulseFrequency:  opts.pulseFrequency  ?? 0.3,
      pulseAmplitude:  opts.pulseAmplitude  ?? 0.15,
      opacity:         1.0,
      duration:        opts.duration        ?? 0,
      elapsed:         0,
      active:          true,
    };
    this._coronas.push(rec);
    return rec;
  }

  // =========================================================================
  // Plasma torrent
  // =========================================================================

  /**
   * Create a flowing plasma stream between two world-space points.
   * Implemented as a continuous-emitter ribbon with bright glow.
   *
   * @param {{x,y,z}}  from
   * @param {{x,y,z}}  to
   * @param {object}   [opts]
   * @param {number}   [opts.colorHex=0x00ffcc]
   * @param {number}   [opts.width=1.5]
   * @param {number}   [opts.duration=0]        - 0 = persistent
   * @returns {{record: PlasmaTorrentRecord, emitters: ParticleEmitter[]}}
   */
  spawnPlasmaTorrent(from, to, opts = {}) {
    const mid = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      z: (from.z + to.z) / 2,
    };
    const dir = _normalize(_sub(to, from));
    const len = _dist(from, to);

    const rec = {
      id:       _recId++,
      type:     'plasma_torrent',
      from:     { ...from },
      to:       { ...to },
      colorHex: opts.colorHex ?? 0x00ffcc,
      width:    opts.width    ?? 1.5,
      duration: opts.duration ?? 0,
      elapsed:  0,
      active:   true,
    };
    this._plasmaTorrents.push(rec);

    // Particles drifting along the stream axis
    const emitters = [];
    emitters.push(this._ps.addEmitter(new ParticleEmitter({
      mode:             EmitterMode.CONTINUOUS,
      position:         { ...from },
      direction:        dir,
      count:            opts.rate ?? 40,
      lifetime:         len / (opts.speed ?? 20),
      lifetimeVariance: 0.1,
      speed:            opts.speed ?? 20,
      speedVariance:    0.05,
      spread:           0.1,
      colorStart:       opts.colorHex ?? 0x00ffcc,
      colorEnd:         opts.colorEnd ?? 0x003322,
      sizeStart:        opts.width ?? 1.5,
      sizeEnd:          0.2,
      drag:             0.0,
      duration:         opts.duration ?? 0,
    })));

    return { record: rec, emitters };
  }

  // =========================================================================
  // Gravitational lensing
  // =========================================================================

  /**
   * Register a gravitational lensing distortion around a massive object.
   * The renderer applies a radial UV warp around the screen-space projection
   * of the mass centre.
   *
   * @param {{x,y,z}}  position    - World-space position of the mass
   * @param {number}   [mass=1.0]  - Relative mass (scales distortion amount)
   * @param {number}   [radius=100]- Distortion influence radius (world units)
   * @param {object}   [opts]
   * @param {number}   [opts.duration=0]  - 0 = persistent
   * @returns {GravLensingRecord}
   */
  spawnGravLensing(position, mass = 1.0, radius = 100, opts = {}) {
    const rec = {
      id:       _recId++,
      type:     LightingFXType.GRAV_LENSING,
      position: { ...position },
      mass,
      radius,
      duration: opts.duration ?? 0,
      elapsed:  0,
      active:   true,
    };
    this._gravLensing.push(rec);
    return rec;
  }

  // =========================================================================
  // Radiation zone
  // =========================================================================

  /**
   * Register a pulsing coloured overlay zone that visually marks a radiation
   * or hazardous-energy field.
   *
   * @param {{x,y,z}}  position
   * @param {number}   [radius=80]
   * @param {object}   [opts]
   * @param {number}   [opts.colorHex=0xaaff00]
   * @param {number}   [opts.pulseFrequency=0.5]  - Blink frequency (Hz)
   * @param {number}   [opts.minOpacity=0.1]
   * @param {number}   [opts.maxOpacity=0.4]
   * @param {number}   [opts.duration=0]           - 0 = persistent
   * @returns {RadiationZoneRecord}
   */
  spawnRadiationZone(position, radius = 80, opts = {}) {
    const rec = {
      id:             _recId++,
      type:           LightingFXType.RADIATION_ZONE,
      position:       { ...position },
      radius,
      colorHex:       opts.colorHex       ?? 0xaaff00,
      pulseFrequency: opts.pulseFrequency ?? 0.5,
      minOpacity:     opts.minOpacity     ?? 0.1,
      maxOpacity:     opts.maxOpacity     ?? 0.4,
      opacity:        opts.minOpacity     ?? 0.1,
      duration:       opts.duration       ?? 0,
      elapsed:        0,
      active:         true,
    };
    this._radiationZones.push(rec);
    return rec;
  }

  // =========================================================================
  // Update — call once per frame
  // =========================================================================

  /**
   * Advance all environmental FX state by `dt` seconds.
   * @param {number} dt
   */
  update(dt) {
    this._ps.update(dt);

    // --- debris chunks (rigid-body tumble) ---
    for (const chunk of this._debrisChunks) {
      if (!chunk.active) continue;

      // Angular velocity → rotation update (Euler-angle simple approx)
      chunk.rotX += chunk.angVelX * dt;
      chunk.rotY += chunk.angVelY * dt;
      chunk.rotZ += chunk.angVelZ * dt;

      // Tiny drag on angular velocity (gyroscopic damping)
      const ad = 1 - chunk.drag * dt * 10;
      chunk.angVelX *= ad;
      chunk.angVelY *= ad;
      chunk.angVelZ *= ad;

      // Linear drift
      chunk.px += chunk.vx * dt;
      chunk.py += chunk.vy * dt;
      chunk.pz += chunk.vz * dt;

      // Optional lifetime
      if (chunk.lifetime > 0) {
        chunk.lifetime -= dt;
        if (chunk.lifetime <= 0) { chunk.active = false; }
      }
    }

    // --- god rays ---
    _advanceRecords(this._godRays, dt);

    // --- lens flares ---
    _advanceRecords(this._lensFlares, dt);

    // --- heat distortions ---
    _advanceRecords(this._heatDistortions, dt);

    // --- EMP pulses (expand ring, auto-expire) ---
    for (let i = this._empPulses.length - 1; i >= 0; i--) {
      const r = this._empPulses[i];
      r.elapsed += dt;
      r.radius  += r.expandSpeed * dt;
      if (r.radius >= r.maxRadius || r.elapsed >= r.duration) {
        r.active = false;
        this._empPulses.splice(i, 1);
      }
    }

    // --- coronas (pulse opacity) ---
    for (const r of this._coronas) {
      if (!r.active) continue;
      r.elapsed += dt;
      r.opacity  = Math.max(0, Math.min(1, 1.0 - r.pulseAmplitude * Math.sin(2 * Math.PI * r.pulseFrequency * r.elapsed)));
      if (r.duration > 0 && r.elapsed >= r.duration) { r.active = false; }
    }

    // --- plasma torrents ---
    _advanceRecords(this._plasmaTorrents, dt);

    // --- gravitational lensing ---
    _advanceRecords(this._gravLensing, dt);

    // --- radiation zones (pulse opacity) ---
    for (const r of this._radiationZones) {
      if (!r.active) continue;
      r.elapsed += dt;
      const t = Math.sin(2 * Math.PI * r.pulseFrequency * r.elapsed) * 0.5 + 0.5;
      r.opacity = r.minOpacity + (r.maxOpacity - r.minOpacity) * t;
      if (r.duration > 0 && r.elapsed >= r.duration) { r.active = false; }
    }

    // --- cloud volumes (no per-frame mutation needed; managed externally) ---
  }

  // =========================================================================
  // Read-only accessors (for renderer)
  // =========================================================================

  /** @returns {ParticleSystem} */
  get particleSystem() { return this._ps; }

  /** @returns {DebrisChunk[]} Active debris chunks */
  get debrisChunks() { return this._debrisChunks.filter(c => c.active); }

  /** @returns {CloudVolumeRecord[]} All cloud volume records */
  get cloudVolumes() { return this._cloudVolumes; }

  /** @returns {GodRayRecord[]} Active god-ray records */
  get godRays() { return this._godRays; }

  /** @returns {LensFlareRecord[]} Active lens flare records */
  get lensFlares() { return this._lensFlares; }

  /** @returns {HeatDistortionRecord[]} Active heat distortion records */
  get heatDistortions() { return this._heatDistortions; }

  /** @returns {EmpPulseRecord[]} Active EMP pulse records */
  get empPulses() { return this._empPulses; }

  /** @returns {CoronaRecord[]} Active corona records */
  get coronas() { return this._coronas; }

  /** @returns {PlasmaTorrentRecord[]} Active plasma torrent records */
  get plasmaTorrents() { return this._plasmaTorrents; }

  /** @returns {GravLensingRecord[]} Active gravitational lensing records */
  get gravLensing() { return this._gravLensing; }

  /** @returns {RadiationZoneRecord[]} Active radiation zone records */
  get radiationZones() { return this._radiationZones; }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Remove all inactive records to reclaim memory.  Call periodically.
   */
  prune() {
    this._debrisChunks    = this._debrisChunks.filter(c => c.active);
    this._cloudVolumes    = this._cloudVolumes.filter(c => c.active);
    this._godRays         = this._godRays.filter(r => r.active);
    this._lensFlares      = this._lensFlares.filter(r => r.active);
    this._heatDistortions = this._heatDistortions.filter(r => r.active);
    this._coronas         = this._coronas.filter(r => r.active);
    this._plasmaTorrents  = this._plasmaTorrents.filter(r => r.active);
    this._gravLensing     = this._gravLensing.filter(r => r.active);
    this._radiationZones  = this._radiationZones.filter(r => r.active);
  }

  dispose() {
    this._ps.dispose();
    this._debrisChunks.length    = 0;
    this._cloudVolumes.length    = 0;
    this._godRays.length         = 0;
    this._lensFlares.length      = 0;
    this._heatDistortions.length = 0;
    this._empPulses.length       = 0;
    this._coronas.length         = 0;
    this._plasmaTorrents.length  = 0;
    this._gravLensing.length     = 0;
    this._radiationZones.length  = 0;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /** @private */
  _addCloudVolume(position, radius, type, opts = {}) {
    const preset = _CLOUD_PRESETS[type] ?? _CLOUD_PRESETS[CloudType.NEBULA];
    const rec = {
      id:         _recId++,
      type,
      position:   { ...position },
      radius,
      colorInner: opts.colorInner  ?? preset.colorInner,
      colorOuter: opts.colorOuter  ?? preset.colorOuter,
      density:    opts.density     ?? preset.density,
      turbulence: opts.turbulence  ?? preset.turbulence,
      emissive:   opts.emissive    ?? preset.emissive,
      opacity:    opts.opacity     ?? preset.opacity,
      steps:      opts.steps       ?? 32,
      active:     true,
    };
    this._cloudVolumes.push(rec);
    return rec;
  }
}

// ---------------------------------------------------------------------------
// Module-private factories and helpers
// ---------------------------------------------------------------------------

function _makeDebrisChunk(center, radius, preset, opts) {
  const r = () => Math.random() * 2 - 1;

  // Random position inside sphere
  const theta = Math.acos(2 * Math.random() - 1);
  const phi   = Math.random() * 2 * Math.PI;
  const rr    = Math.cbrt(Math.random()) * radius;

  const [minS, maxS] = preset.scaleRange;
  const scale = opts.scale ?? (minS + Math.random() * (maxS - minS));

  const speed = opts.speed ?? (0.5 + Math.random() * 2);
  const tf    = preset.tumbleFactor;

  return {
    id:       _recId++,
    type:     'debris_chunk',
    active:   true,
    // position
    px: center.x + rr * Math.sin(theta) * Math.cos(phi),
    py: center.y + rr * Math.cos(theta),
    pz: center.z + rr * Math.sin(theta) * Math.sin(phi),
    // linear velocity (slow drift)
    vx: r() * speed,
    vy: r() * speed,
    vz: r() * speed,
    // angular velocity (tumbling)
    rotX: Math.random() * Math.PI * 2,
    rotY: Math.random() * Math.PI * 2,
    rotZ: Math.random() * Math.PI * 2,
    angVelX: r() * tf,
    angVelY: r() * tf,
    angVelZ: r() * tf,
    scale,
    colorHex:  preset.colorHex,
    drag:      preset.drag,
    lifetime:  opts.lifetime ?? 0,  // 0 = permanent
  };
}

function _advanceRecords(arr, dt) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const r = arr[i];
    if (!r.active) { arr.splice(i, 1); continue; }
    r.elapsed += dt;
    if (r.duration > 0 && r.elapsed >= r.duration) {
      r.active = false;
      arr.splice(i, 1);
    }
  }
}

function _normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function _sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function _dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Add a slight colour tint variation for individual flare elements. */
function _tintFlareElement(baseHex, index) {
  const r = ((baseHex >> 16) & 0xff);
  const g = ((baseHex >>  8) & 0xff);
  const b = ( baseHex        & 0xff);
  // Shift hue slightly per element index
  const shift = (index * 17) & 0xff;
  return ((Math.min(255, r + shift) << 16) |
          (Math.min(255, g)         <<  8) |
           Math.min(255, b + shift));
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EnvironmentFX,
    DebrisType,
    CloudType,
    LightingFXType,
  };
} else {
  window.GQEnvironmentFX = { EnvironmentFX, DebrisType, CloudType, LightingFXType };
}
