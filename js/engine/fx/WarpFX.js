/**
 * WarpFX.js — Warp-drive / FTL visual effects system.
 *
 * Derives FTL travel effects from the starfield and plasma-flow building blocks
 * already present in the engine.  Manages the full warp lifecycle:
 *
 *   ENGAGE      → star streaks begin, plasma channels power up, shockwave emitted
 *   TRAVEL      → sustained warp tunnel with plasma flow streams and ion trail
 *   DISENGAGE   → reverse shockwave, stars snap back to points, plasma dissipates
 *
 * Effect inventory:
 *
 *   • Warp tunnel         — full-screen tunnel (driven by warp.wgsl)
 *   • Plasma flow         — animated plasma torrent channels inside the tunnel
 *   • Jump flash          — bright-white flash at engage and disengage moments
 *   • Warp shockwave      — expanding ring emitted at engage/disengage
 *   • Ion trail           — fading exhaust ribbon left behind the ship
 *   • Engine glow corona  — engine port corona that intensifies with warp factor
 *
 * Dependencies:
 *   EnvironmentFX — borrows spawnPlasmaTorrent and spawnEmpPulse/spawnCorona
 *   StarfieldFX   — drives warpFactor on active starfield layers
 *
 * Shader: js/engine/fx/shaders/warp.wgsl
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

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Warp phase — represents which stage of the FTL jump the ship is in.
 * @enum {string}
 */
const WarpPhase = Object.freeze({
  /** Idle — warp systems powered down. */
  IDLE:       'idle',
  /** Engage — warp bubble forming; star-streaks ramping up (≈ 0.5 s). */
  ENGAGE:     'engage',
  /** Travel — sustained FTL travel; full warp tunnel active. */
  TRAVEL:     'travel',
  /** Disengage — warp bubble collapsing; effects fading out (≈ 0.5 s). */
  DISENGAGE:  'disengage',
});

/**
 * Plasma flow channel type — each maps to a different colour preset and
 * turbulence level inside the warp tunnel.
 * @enum {string}
 */
const PlasmaFlowType = Object.freeze({
  /** Primary warp plasma stream (cyan-blue, high energy). */
  WARP_STREAM:    'warp_stream',
  /** Ionised exhaust trail left in the ship's wake (blue-violet). */
  ION_TRAIL:      'ion_trail',
  /** Alcubierre-metric plasma confinement ring (white-gold). */
  TUNNEL_RING:    'tunnel_ring',
  /** Jump shockwave plasma burst (orange-white, short-lived). */
  JUMP_SHOCKWAVE: 'jump_shockwave',
});

// ---------------------------------------------------------------------------
// Colour / parameter presets
// ---------------------------------------------------------------------------

/** @private */
const _PLASMA_PRESETS = {
  [PlasmaFlowType.WARP_STREAM]:    { colorHex: 0x00ccff, colorEnd: 0x001133, speed: 120, width: 2.5, rate: 60 },
  [PlasmaFlowType.ION_TRAIL]:      { colorHex: 0x6633ff, colorEnd: 0x110022, speed:  60, width: 1.5, rate: 40 },
  [PlasmaFlowType.TUNNEL_RING]:    { colorHex: 0xffeebb, colorEnd: 0x332200, speed:  80, width: 3.0, rate: 50 },
  [PlasmaFlowType.JUMP_SHOCKWAVE]: { colorHex: 0xff9933, colorEnd: 0x110000, speed: 200, width: 4.0, rate: 80 },
};

/** @private */
const _ENGAGE_DURATION    = 0.55;   // seconds for engage ramp
/** @private */
const _DISENGAGE_DURATION = 0.55;   // seconds for disengage ramp

/** @private */
let _wfxRecId = 3000;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class WarpFX {
  /**
   * @param {object} [opts]
   * @param {ParticleSystem} [opts.particleSystem] - Shared PS; one created if omitted.
   * @param {number}         [opts.maxParticles=2048]
   * @param {object}         [opts.starfieldFX]    - StarfieldFX instance to drive.
   */
  constructor(opts = {}) {
    this._ps = opts.particleSystem ?? new ParticleSystem({ maxParticles: opts.maxParticles ?? 2048 });

    /** Optional StarfieldFX reference — warp factor is pushed to it automatically. */
    this._sfx = opts.starfieldFX ?? null;

    /** @type {WarpTunnelRecord[]} */
    this._tunnels = [];

    /** @type {PlasmaFlowRecord[]} */
    this._plasmaFlows = [];

    /** @type {JumpFlashRecord[]} */
    this._jumpFlashes = [];

    /** @type {WarpShockwaveRecord[]} */
    this._shockwaves = [];

    /** @type {IonTrailRecord[]} */
    this._ionTrails = [];

    /** @type {EngineGlowRecord[]} */
    this._engineGlows = [];

    /** Currently active WarpPhase across all tunnels. */
    this._phase = WarpPhase.IDLE;

    /** Time accumulator used during engage/disengage transitions. */
    this._transitionElapsed = 0;
  }

  // =========================================================================
  // Lifecycle sequencer
  // =========================================================================

  /**
   * Begin a warp jump from an origin position.
   *
   * Spawns a warp tunnel, plasma flows, jump flash and shockwave then
   * automatically transitions through ENGAGE → TRAVEL.
   *
   * @param {{x,y,z}} shipPos  - Ship world-space position.
   * @param {{x,y,z}} heading  - Normalised travel direction.
   * @param {object}  [opts]
   * @param {number}  [opts.travelDuration=5]   - Seconds to stay in TRAVEL phase (0 = manual).
   * @param {number}  [opts.tunnelIntensity=1.0]
   * @param {number}  [opts.plasmaChannels=3]   - Number of parallel plasma channels.
   * @returns {{tunnel: WarpTunnelRecord, flashes: JumpFlashRecord[], flows: PlasmaFlowRecord[]}}
   */
  engage(shipPos, heading, opts = {}) {
    this._phase             = WarpPhase.ENGAGE;
    this._transitionElapsed = 0;

    const tunnel  = this.spawnWarpTunnel(shipPos, heading, opts);
    const flashes = [this.spawnJumpFlash(shipPos, { intensity: opts.tunnelIntensity ?? 1.0 })];
    const flows   = [];

    const channels = Math.max(1, Math.round(opts.plasmaChannels ?? 3));
    for (let i = 0; i < channels; i++) {
      flows.push(this.spawnPlasmaFlow(shipPos, heading, PlasmaFlowType.WARP_STREAM, {
        duration: (opts.travelDuration ?? 5) + _ENGAGE_DURATION,
        offset:   i,
      }));
    }

    this.spawnWarpShockwave(shipPos, { colorHex: 0x00ccff });

    if ((opts.travelDuration ?? 5) > 0) {
      tunnel._autoDisengageAt = _ENGAGE_DURATION + (opts.travelDuration ?? 5);
    }

    return { tunnel, flashes, flows };
  }

  /**
   * Manually trigger warp disengage — transitions TRAVEL → DISENGAGE → IDLE.
   * @param {{x,y,z}} shipPos
   * @param {object}  [opts]
   */
  disengage(shipPos, opts = {}) {
    if (this._phase !== WarpPhase.TRAVEL) return;
    this._phase             = WarpPhase.DISENGAGE;
    this._transitionElapsed = 0;

    this.spawnJumpFlash(shipPos, { intensity: opts.intensity ?? 0.6, colorHex: 0xffeebb });
    this.spawnWarpShockwave(shipPos, { colorHex: 0xffeebb, maxRadius: 300 });
  }

  // =========================================================================
  // Warp tunnel
  // =========================================================================

  /**
   * Spawn a warp tunnel data record.  The record drives the warp.wgsl pass.
   *
   * @param {{x,y,z}} shipPos
   * @param {{x,y,z}} heading        - Normalised travel direction.
   * @param {object}  [opts]
   * @param {number}  [opts.intensity=1.0]
   * @param {number}  [opts.speed=1.0]        - Tunnel scroll speed multiplier.
   * @param {number}  [opts.twistRate=2.5]    - Plasma channel twist rate.
   * @param {number}  [opts.tunnelRadius=0.45]- Normalised tunnel radius [0,1].
   * @param {number}  [opts.duration=0]       - 0 = manual stop via disengage().
   * @returns {WarpTunnelRecord}
   */
  spawnWarpTunnel(shipPos, heading, opts = {}) {
    const rec = {
      id:            _wfxRecId++,
      type:          'warp_tunnel',
      active:        true,
      phase:         WarpPhase.ENGAGE,
      shipPos:       { ...shipPos },
      heading:       _normVec(heading),
      intensity:     opts.intensity    ?? 1.0,
      speed:         opts.speed        ?? 1.0,
      twistRate:     opts.twistRate    ?? 2.5,
      tunnelRadius:  opts.tunnelRadius ?? 0.45,
      vanishX:       opts.vanishX      ?? 0.5,
      vanishY:       opts.vanishY      ?? 0.5,
      streakCount:   opts.streakCount  ?? 12,
      plasmaLayers:  opts.plasmaLayers ?? 4,
      duration:      opts.duration     ?? 0,
      elapsed:       0,
      warpFactor:    0,             // ramps 0→1 during engage
      _autoDisengageAt: 0,
    };
    this._tunnels.push(rec);
    return rec;
  }

  // =========================================================================
  // Plasma flow
  // =========================================================================

  /**
   * Spawn a plasma flow channel — derived from EnvironmentFX.PlasmaTorrent but
   * tuned specifically for warp propulsion.
   *
   * @param {{x,y,z}} origin
   * @param {{x,y,z}} direction  - Normalised flow direction (usually ship heading).
   * @param {string}  [flowType=PlasmaFlowType.WARP_STREAM]
   * @param {object}  [opts]
   * @param {number}  [opts.length=200]   - Channel length (world units).
   * @param {number}  [opts.duration=0]   - 0 = persistent.
   * @param {number}  [opts.offset=0]     - Angular offset for multi-channel layouts (0..N).
   * @returns {{record: PlasmaFlowRecord, emitter: ParticleEmitter}}
   */
  spawnPlasmaFlow(origin, direction, flowType = PlasmaFlowType.WARP_STREAM, opts = {}) {
    const preset = _PLASMA_PRESETS[flowType] ?? _PLASMA_PRESETS[PlasmaFlowType.WARP_STREAM];
    const dir    = _normVec(direction);
    const length = opts.length ?? 200;

    // Angular offset: rotate direction slightly for multi-channel spread
    const angle  = (opts.offset ?? 0) * (Math.PI / 6);
    const rotDir = _rotateAroundY(dir, angle);

    const to = {
      x: origin.x + rotDir.x * length,
      y: origin.y + rotDir.y * length,
      z: origin.z + rotDir.z * length,
    };

    const rec = {
      id:        _wfxRecId++,
      type:      'plasma_flow',
      flowType,
      active:    true,
      origin:    { ...origin },
      direction: rotDir,
      to,
      length,
      colorHex:  opts.colorHex  ?? preset.colorHex,
      colorEnd:  opts.colorEnd  ?? preset.colorEnd,
      width:     opts.width     ?? preset.width,
      speed:     opts.speed     ?? preset.speed,
      duration:  opts.duration  ?? 0,
      elapsed:   0,
    };
    this._plasmaFlows.push(rec);

    const emitter = this._ps.addEmitter(new ParticleEmitter({
      mode:             EmitterMode.CONTINUOUS,
      position:         { ...origin },
      direction:        rotDir,
      count:            opts.rate ?? preset.rate,
      lifetime:         length / (opts.speed ?? preset.speed),
      lifetimeVariance: 0.08,
      speed:            opts.speed ?? preset.speed,
      speedVariance:    0.04,
      spread:           0.07,
      colorStart:       opts.colorHex  ?? preset.colorHex,
      colorEnd:         opts.colorEnd  ?? preset.colorEnd,
      sizeStart:        opts.width     ?? preset.width,
      sizeEnd:          0.3,
      drag:             0.0,
      duration:         opts.duration  ?? 0,
    }));

    return { record: rec, emitter };
  }

  // =========================================================================
  // Jump flash
  // =========================================================================

  /**
   * Spawn a bright jump-flash overlay (engage/disengage moment).
   *
   * @param {{x,y,z}} position
   * @param {object}  [opts]
   * @param {number}  [opts.intensity=1.0]     - Peak brightness [0,1].
   * @param {number}  [opts.duration=0.35]     - Flash duration (seconds).
   * @param {number}  [opts.colorHex=0xffffff] - Flash colour.
   * @returns {JumpFlashRecord}
   */
  spawnJumpFlash(position, opts = {}) {
    const rec = {
      id:        _wfxRecId++,
      type:      'jump_flash',
      active:    true,
      position:  { ...position },
      intensity: opts.intensity ?? 1.0,
      duration:  opts.duration  ?? 0.35,
      colorHex:  opts.colorHex  ?? 0xffffff,
      elapsed:   0,
      alpha:     0,   // computed in update()
    };
    this._jumpFlashes.push(rec);
    return rec;
  }

  // =========================================================================
  // Warp shockwave
  // =========================================================================

  /**
   * Spawn an expanding ring shockwave at the warp engage/disengage point.
   *
   * @param {{x,y,z}} position
   * @param {object}  [opts]
   * @param {number}  [opts.colorHex=0x00ccff]
   * @param {number}  [opts.maxRadius=200]
   * @param {number}  [opts.expandSpeed=320]  - Ring expansion speed (units/s).
   * @param {number}  [opts.width=8]          - Ring width (world units).
   * @returns {WarpShockwaveRecord}
   */
  spawnWarpShockwave(position, opts = {}) {
    const rec = {
      id:          _wfxRecId++,
      type:        'warp_shockwave',
      active:      true,
      position:    { ...position },
      colorHex:    opts.colorHex    ?? 0x00ccff,
      maxRadius:   opts.maxRadius   ?? 200,
      expandSpeed: opts.expandSpeed ?? 320,
      width:       opts.width       ?? 8,
      radius:      0,
      elapsed:     0,
      opacity:     1,
    };
    this._shockwaves.push(rec);
    return rec;
  }

  // =========================================================================
  // Ion trail
  // =========================================================================

  /**
   * Spawn an ion exhaust trail in the ship's wake.
   *
   * @param {{x,y,z}} from     - Trail start (ship position at warp-out).
   * @param {{x,y,z}} to       - Trail end (previous position).
   * @param {object}  [opts]
   * @param {number}  [opts.duration=3.0]   - How long the trail persists.
   * @param {number}  [opts.width=2.5]
   * @returns {{record: IonTrailRecord, emitter: ParticleEmitter}}
   */
  spawnIonTrail(from, to, opts = {}) {
    return this.spawnPlasmaFlow(from, _normVec(_subVec(to, from)), PlasmaFlowType.ION_TRAIL, {
      length:   _vecLen(_subVec(to, from)) || 50,
      duration: opts.duration ?? 3.0,
      width:    opts.width    ?? 2.5,
    });
  }

  // =========================================================================
  // Engine glow corona
  // =========================================================================

  /**
   * Register an engine-port corona that pulses with the warp factor.
   *
   * @param {{x,y,z}} enginePos  - Engine port world-space position.
   * @param {object}  [opts]
   * @param {number}  [opts.baseRadius=4]    - Corona radius at idle.
   * @param {number}  [opts.warpRadiusMult=4] - Radius multiplier at warp factor 1.
   * @param {number}  [opts.colorHex=0x00aaff]
   * @returns {EngineGlowRecord}
   */
  spawnEngineGlow(enginePos, opts = {}) {
    const rec = {
      id:             _wfxRecId++,
      type:           'engine_glow',
      active:         true,
      position:       { ...enginePos },
      baseRadius:     opts.baseRadius     ?? 4,
      warpRadiusMult: opts.warpRadiusMult ?? 4,
      colorHex:       opts.colorHex       ?? 0x00aaff,
      radius:         opts.baseRadius     ?? 4,
      warpFactor:     0,
      elapsed:        0,
    };
    this._engineGlows.push(rec);
    return rec;
  }

  // =========================================================================
  // Update — call once per frame
  // =========================================================================

  /**
   * Advance all WarpFX state by `dt` seconds.
   * @param {number} dt
   */
  update(dt) {
    this._ps.update(dt);

    // --- Phase state machine ---
    if (this._phase === WarpPhase.ENGAGE || this._phase === WarpPhase.DISENGAGE) {
      this._transitionElapsed += dt;
      const progress = Math.min(1, this._transitionElapsed /
        (this._phase === WarpPhase.ENGAGE ? _ENGAGE_DURATION : _DISENGAGE_DURATION));

      const wf = this._phase === WarpPhase.ENGAGE ? progress : 1 - progress;
      this.setWarpFactor(wf);

      if (progress >= 1) {
        this._phase = this._phase === WarpPhase.ENGAGE ? WarpPhase.TRAVEL : WarpPhase.IDLE;
        this._transitionElapsed = 0;
      }
    }

    // --- Tunnels ---
    for (const rec of this._tunnels) {
      if (!rec.active) continue;
      rec.elapsed    += dt;
      rec.warpFactor  = this.warpFactor;
      rec.phase       = this._phase;
      if (rec.duration > 0 && rec.elapsed >= rec.duration) { rec.active = false; continue; }
      if (rec._autoDisengageAt > 0 && rec.elapsed >= rec._autoDisengageAt) {
        this.disengage(rec.shipPos);
        rec._autoDisengageAt = 0;
      }
    }

    // --- Plasma flows ---
    for (let i = this._plasmaFlows.length - 1; i >= 0; i--) {
      const r = this._plasmaFlows[i];
      if (!r.active) { this._plasmaFlows.splice(i, 1); continue; }
      r.elapsed += dt;
      if (r.duration > 0 && r.elapsed >= r.duration) {
        r.active = false;
        this._plasmaFlows.splice(i, 1);
      }
    }

    // --- Jump flashes (bell-curve alpha: ramp up then down) ---
    for (let i = this._jumpFlashes.length - 1; i >= 0; i--) {
      const r = this._jumpFlashes[i];
      if (!r.active) { this._jumpFlashes.splice(i, 1); continue; }
      r.elapsed += dt;
      const t  = r.elapsed / r.duration;
      r.alpha  = r.intensity * Math.sin(Math.min(1, t) * Math.PI);
      if (r.elapsed >= r.duration) {
        r.active = false;
        this._jumpFlashes.splice(i, 1);
      }
    }

    // --- Warp shockwaves ---
    for (let i = this._shockwaves.length - 1; i >= 0; i--) {
      const r = this._shockwaves[i];
      r.elapsed += dt;
      r.radius  += r.expandSpeed * dt;
      r.opacity  = 1 - r.radius / r.maxRadius;
      if (r.radius >= r.maxRadius) {
        r.active = false;
        this._shockwaves.splice(i, 1);
      }
    }

    // --- Engine glows ---
    for (const r of this._engineGlows) {
      if (!r.active) continue;
      r.elapsed   += dt;
      r.warpFactor = this.warpFactor;
      r.radius     = r.baseRadius * (1 + r.warpFactor * (r.warpRadiusMult - 1));
    }
  }

  // =========================================================================
  // Warp-factor driver
  // =========================================================================

  /**
   * Set the current warp factor and push it to the linked StarfieldFX instance.
   * @param {number} factor [0,1]
   */
  setWarpFactor(factor) {
    this.warpFactor = _clampWarpFactor(factor);
    if (this._sfx && typeof this._sfx.setWarpFactor === 'function') {
      this._sfx.setWarpFactor(this.warpFactor);
    }
    for (const t of this._tunnels) {
      if (t.active) t.warpFactor = this.warpFactor;
    }
    for (const g of this._engineGlows) {
      if (g.active) {
        g.warpFactor = this.warpFactor;
        g.radius     = g.baseRadius * (1 + g.warpFactor * (g.warpRadiusMult - 1));
      }
    }
  }

  // =========================================================================
  // Read-only accessors (for renderer)
  // =========================================================================

  /** @returns {string} Current warp phase. */
  get phase() { return this._phase; }

  /** @returns {number} Current warp factor [0,1]. */
  get warpFactor() { return this._warpFactor ?? 0; }

  set warpFactor(v) { this._warpFactor = _clampWarpFactor(v); }

  /** @returns {WarpTunnelRecord[]} Active warp tunnel records. */
  get tunnels() { return this._tunnels.filter(r => r.active); }

  /** @returns {PlasmaFlowRecord[]} Active plasma flow records. */
  get plasmaFlows() { return this._plasmaFlows.filter(r => r.active); }

  /** @returns {JumpFlashRecord[]} Active jump flash records. */
  get jumpFlashes() { return this._jumpFlashes.filter(r => r.active); }

  /** @returns {WarpShockwaveRecord[]} Active warp shockwave records. */
  get shockwaves() { return this._shockwaves.filter(r => r.active); }

  /** @returns {EngineGlowRecord[]} Active engine glow records. */
  get engineGlows() { return this._engineGlows.filter(r => r.active); }

  /** @returns {ParticleSystem} */
  get particleSystem() { return this._ps; }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Remove inactive records.
   */
  prune() {
    this._tunnels     = this._tunnels.filter(r => r.active);
    this._plasmaFlows = this._plasmaFlows.filter(r => r.active);
    this._engineGlows = this._engineGlows.filter(r => r.active);
  }

  /**
   * Dispose all effects and release resources.
   */
  dispose() {
    this._ps.dispose();
    this._tunnels.length     = 0;
    this._plasmaFlows.length = 0;
    this._jumpFlashes.length = 0;
    this._shockwaves.length  = 0;
    this._ionTrails.length   = 0;
    this._engineGlows.length = 0;
    this._phase              = WarpPhase.IDLE;
    this._warpFactor         = 0;
    this._transitionElapsed  = 0;
  }
}

// ---------------------------------------------------------------------------
// Private math helpers
// ---------------------------------------------------------------------------

function _normVec(v) {
  if (!v) return { x: 0, y: 0, z: 1 };
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function _subVec(a, b) {
  return { x: (a.x||0) - (b.x||0), y: (a.y||0) - (b.y||0), z: (a.z||0) - (b.z||0) };
}

function _vecLen(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Rotate vector around Y axis by `angle` radians. */
function _rotateAroundY(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Clamp a warp factor value to [0, 1]. */
function _clampWarpFactor(factor) {
  return Math.max(0, Math.min(1, Number(factor) || 0));
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WarpFX, WarpPhase, PlasmaFlowType };
} else {
  window.GQWarpFX = { WarpFX, WarpPhase, PlasmaFlowType };
}
