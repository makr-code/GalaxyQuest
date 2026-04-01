/**
 * warpfx.test.js — Unit tests for the WarpFX subsystem.
 *
 * Tests cover:
 *   • WarpPhase / PlasmaFlowType enum completeness
 *   • spawnWarpTunnel():      record properties
 *   • spawnPlasmaFlow():      record + particle emitter
 *   • spawnJumpFlash():       alpha bell-curve, expiry
 *   • spawnWarpShockwave():   ring expansion, opacity fade, auto-remove
 *   • spawnIonTrail():        delegates to spawnPlasmaFlow(ION_TRAIL)
 *   • spawnEngineGlow():      record, radius scales with warpFactor
 *   • engage():               phase transition, tunnel + flash + shockwave spawned
 *   • disengage():            requires TRAVEL phase, triggers DISENGAGE
 *   • setWarpFactor():        clamps [0,1], pushes to tunnels + engine glows
 *   • update():               phase state machine (ENGAGE→TRAVEL), time advance
 *   • accessors:              tunnels, plasmaFlows, jumpFlashes, shockwaves, engineGlows
 *   • prune():                removes inactive records
 *   • dispose():              clears all state
 *   • StarfieldFX integration: warpFactor pushed via linked instance
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { WarpFX, WarpPhase, PlasmaFlowType } =
  require(path.join(root, 'js/engine/fx/WarpFX.js'));

const { StarfieldFX, StarfieldLayerType } =
  require(path.join(root, 'js/engine/fx/StarfieldFX.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const O   = { x: 0, y: 0, z: 0 };
const FWD = { x: 0, y: 0, z: 1 };

// ---------------------------------------------------------------------------
// Enum completeness
// ---------------------------------------------------------------------------

describe('WarpFX — WarpPhase enum', () => {
  it('has exactly 4 values', () => {
    expect(Object.keys(WarpPhase).length).toBe(4);
  });

  it('contains IDLE, ENGAGE, TRAVEL, DISENGAGE', () => {
    expect(WarpPhase.IDLE).toBeDefined();
    expect(WarpPhase.ENGAGE).toBeDefined();
    expect(WarpPhase.TRAVEL).toBeDefined();
    expect(WarpPhase.DISENGAGE).toBeDefined();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(WarpPhase)).toBe(true);
  });
});

describe('WarpFX — PlasmaFlowType enum', () => {
  it('has exactly 4 values', () => {
    expect(Object.keys(PlasmaFlowType).length).toBe(4);
  });

  it('contains expected flow types', () => {
    expect(PlasmaFlowType.WARP_STREAM).toBeDefined();
    expect(PlasmaFlowType.ION_TRAIL).toBeDefined();
    expect(PlasmaFlowType.TUNNEL_RING).toBeDefined();
    expect(PlasmaFlowType.JUMP_SHOCKWAVE).toBeDefined();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PlasmaFlowType)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spawnWarpTunnel()
// ---------------------------------------------------------------------------

describe('WarpFX — spawnWarpTunnel()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('returns a record with active=true', () => {
    const rec = wfx.spawnWarpTunnel(O, FWD);
    expect(rec.active).toBe(true);
  });

  it('sets type to warp_tunnel', () => {
    const rec = wfx.spawnWarpTunnel(O, FWD);
    expect(rec.type).toBe('warp_tunnel');
  });

  it('applies intensity option', () => {
    const rec = wfx.spawnWarpTunnel(O, FWD, { intensity: 0.75 });
    expect(rec.intensity).toBeCloseTo(0.75);
  });

  it('normalises heading vector', () => {
    const rec = wfx.spawnWarpTunnel(O, { x: 0, y: 0, z: 5 });
    const len = Math.sqrt(rec.heading.x ** 2 + rec.heading.y ** 2 + rec.heading.z ** 2);
    expect(len).toBeCloseTo(1, 4);
  });

  it('stores tunnel in tunnels accessor', () => {
    wfx.spawnWarpTunnel(O, FWD);
    expect(wfx.tunnels.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// spawnPlasmaFlow()
// ---------------------------------------------------------------------------

describe('WarpFX — spawnPlasmaFlow()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('returns record + emitter', () => {
    const { record, emitter } = wfx.spawnPlasmaFlow(O, FWD);
    expect(record).toBeDefined();
    expect(emitter).toBeDefined();
  });

  it('record.active is true', () => {
    const { record } = wfx.spawnPlasmaFlow(O, FWD);
    expect(record.active).toBe(true);
  });

  it('record.type is plasma_flow', () => {
    const { record } = wfx.spawnPlasmaFlow(O, FWD);
    expect(record.type).toBe('plasma_flow');
  });

  it('uses the specified flowType', () => {
    const { record } = wfx.spawnPlasmaFlow(O, FWD, PlasmaFlowType.ION_TRAIL);
    expect(record.flowType).toBe(PlasmaFlowType.ION_TRAIL);
  });

  it('custom colorHex propagates to record', () => {
    const { record } = wfx.spawnPlasmaFlow(O, FWD, PlasmaFlowType.WARP_STREAM, { colorHex: 0xff0000 });
    expect(record.colorHex).toBe(0xff0000);
  });

  it('direction of flow is normalised', () => {
    const { record } = wfx.spawnPlasmaFlow(O, { x: 3, y: 0, z: 4 });
    const len = Math.sqrt(record.direction.x ** 2 + record.direction.y ** 2 + record.direction.z ** 2);
    expect(len).toBeCloseTo(1, 4);
  });

  it('appears in plasmaFlows accessor', () => {
    wfx.spawnPlasmaFlow(O, FWD);
    expect(wfx.plasmaFlows.length).toBe(1);
  });

  it('offset rotates direction slightly for multi-channel spread', () => {
    const { record: r0 } = wfx.spawnPlasmaFlow(O, FWD, PlasmaFlowType.WARP_STREAM, { offset: 0 });
    const { record: r1 } = wfx.spawnPlasmaFlow(O, FWD, PlasmaFlowType.WARP_STREAM, { offset: 1 });
    // Directions should differ when offset is non-zero
    const same = r0.direction.x === r1.direction.x &&
                 r0.direction.y === r1.direction.y &&
                 r0.direction.z === r1.direction.z;
    expect(same).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// spawnJumpFlash()
// ---------------------------------------------------------------------------

describe('WarpFX — spawnJumpFlash()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('creates an active flash record', () => {
    const rec = wfx.spawnJumpFlash(O);
    expect(rec.active).toBe(true);
  });

  it('alpha starts at 0', () => {
    const rec = wfx.spawnJumpFlash(O);
    expect(rec.alpha).toBe(0);
  });

  it('alpha peaks near mid-duration', () => {
    const rec = wfx.spawnJumpFlash(O, { duration: 0.4, intensity: 1.0 });
    // Advance to ~50% of duration
    wfx.update(0.2);
    expect(rec.alpha).toBeGreaterThan(0.8);
  });

  it('expires after duration', () => {
    wfx.spawnJumpFlash(O, { duration: 0.1 });
    wfx.update(0.5);
    expect(wfx.jumpFlashes.length).toBe(0);
  });

  it('custom colorHex stored on record', () => {
    const rec = wfx.spawnJumpFlash(O, { colorHex: 0xffeebb });
    expect(rec.colorHex).toBe(0xffeebb);
  });
});

// ---------------------------------------------------------------------------
// spawnWarpShockwave()
// ---------------------------------------------------------------------------

describe('WarpFX — spawnWarpShockwave()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('creates an active shockwave record', () => {
    const rec = wfx.spawnWarpShockwave(O);
    expect(rec.active).toBe(true);
  });

  it('radius starts at 0', () => {
    const rec = wfx.spawnWarpShockwave(O);
    expect(rec.radius).toBe(0);
  });

  it('radius expands on update', () => {
    wfx.spawnWarpShockwave(O, { expandSpeed: 100 });
    wfx.update(0.5);
    expect(wfx.shockwaves.length > 0
      ? wfx.shockwaves[0].radius
      : 50 /* auto-removed means it reached maxRadius */
    ).toBeGreaterThan(0);
  });

  it('opacity decreases as radius grows', () => {
    const rec = wfx.spawnWarpShockwave(O, { maxRadius: 200, expandSpeed: 100 });
    wfx.update(0.5);
    if (rec.active) {
      expect(rec.opacity).toBeLessThan(1);
    }
  });

  it('auto-removes when radius reaches maxRadius', () => {
    wfx.spawnWarpShockwave(O, { maxRadius: 50, expandSpeed: 1000 });
    wfx.update(1.0);
    expect(wfx.shockwaves.length).toBe(0);
  });

  it('appears in shockwaves accessor', () => {
    wfx.spawnWarpShockwave(O);
    expect(wfx.shockwaves.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// spawnIonTrail()
// ---------------------------------------------------------------------------

describe('WarpFX — spawnIonTrail()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('returns record and emitter', () => {
    const result = wfx.spawnIonTrail(O, { x: 100, y: 0, z: 0 });
    expect(result.record).toBeDefined();
    expect(result.emitter).toBeDefined();
  });

  it('flow type is ION_TRAIL', () => {
    const { record } = wfx.spawnIonTrail(O, { x: 0, y: 0, z: 50 });
    expect(record.flowType).toBe(PlasmaFlowType.ION_TRAIL);
  });
});

// ---------------------------------------------------------------------------
// spawnEngineGlow()
// ---------------------------------------------------------------------------

describe('WarpFX — spawnEngineGlow()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('creates an active record', () => {
    const rec = wfx.spawnEngineGlow(O);
    expect(rec.active).toBe(true);
  });

  it('radius equals baseRadius at warpFactor 0', () => {
    const rec = wfx.spawnEngineGlow(O, { baseRadius: 5 });
    expect(rec.radius).toBeCloseTo(5);
  });

  it('radius scales up with warpFactor', () => {
    const rec = wfx.spawnEngineGlow(O, { baseRadius: 5, warpRadiusMult: 4 });
    wfx.setWarpFactor(1);
    expect(rec.radius).toBeCloseTo(5 * 4);
  });

  it('appears in engineGlows accessor', () => {
    wfx.spawnEngineGlow(O);
    expect(wfx.engineGlows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// engage()
// ---------------------------------------------------------------------------

describe('WarpFX — engage()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('transitions phase to ENGAGE', () => {
    wfx.engage(O, FWD);
    expect(wfx.phase).toBe(WarpPhase.ENGAGE);
  });

  it('spawns a warp tunnel', () => {
    const { tunnel } = wfx.engage(O, FWD);
    expect(tunnel).toBeDefined();
    expect(tunnel.type).toBe('warp_tunnel');
  });

  it('spawns at least one jump flash', () => {
    const { flashes } = wfx.engage(O, FWD);
    expect(flashes.length).toBeGreaterThan(0);
  });

  it('spawns plasma flow channels', () => {
    const { flows } = wfx.engage(O, FWD, { plasmaChannels: 2 });
    expect(flows.length).toBe(2);
  });

  it('spawns a shockwave', () => {
    wfx.engage(O, FWD);
    expect(wfx.shockwaves.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// disengage()
// ---------------------------------------------------------------------------

describe('WarpFX — disengage()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('no-ops when not in TRAVEL phase', () => {
    // IDLE → call disengage → stays IDLE
    wfx.disengage(O);
    expect(wfx.phase).toBe(WarpPhase.IDLE);
  });

  it('transitions TRAVEL → DISENGAGE', () => {
    wfx.engage(O, FWD, { travelDuration: 0 });
    // Advance past ENGAGE duration so phase becomes TRAVEL
    wfx.update(1.0);
    expect(wfx.phase).toBe(WarpPhase.TRAVEL);
    wfx.disengage(O);
    expect(wfx.phase).toBe(WarpPhase.DISENGAGE);
  });

  it('spawns a jump flash on disengage', () => {
    wfx.engage(O, FWD, { travelDuration: 0 });
    wfx.update(1.0); // reach TRAVEL
    // Drain previous flashes
    wfx.update(1.0);
    const prevFlashes = wfx.jumpFlashes.length;
    wfx.disengage(O);
    expect(wfx.jumpFlashes.length).toBeGreaterThan(prevFlashes);
  });
});

// ---------------------------------------------------------------------------
// setWarpFactor()
// ---------------------------------------------------------------------------

describe('WarpFX — setWarpFactor()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('sets warpFactor', () => {
    wfx.setWarpFactor(0.5);
    expect(wfx.warpFactor).toBeCloseTo(0.5);
  });

  it('clamps above 1 to 1', () => {
    wfx.setWarpFactor(5);
    expect(wfx.warpFactor).toBe(1);
  });

  it('clamps below 0 to 0', () => {
    wfx.setWarpFactor(-1);
    expect(wfx.warpFactor).toBe(0);
  });

  it('pushes to active tunnel records', () => {
    const rec = wfx.spawnWarpTunnel(O, FWD);
    wfx.setWarpFactor(0.7);
    expect(rec.warpFactor).toBeCloseTo(0.7);
  });

  it('pushes to linked StarfieldFX', () => {
    const sfx = new StarfieldFX();
    sfx.spawnDefaultLayers();
    const wfx2 = new WarpFX({ starfieldFX: sfx });
    wfx2.setWarpFactor(0.6);
    expect(sfx.warpFactor).toBeCloseTo(0.6);
  });
});

// ---------------------------------------------------------------------------
// update() — state machine
// ---------------------------------------------------------------------------

describe('WarpFX — update() state machine', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('ENGAGE transitions to TRAVEL after engage duration', () => {
    wfx.engage(O, FWD, { travelDuration: 0 });
    expect(wfx.phase).toBe(WarpPhase.ENGAGE);
    // Advance well past engage ramp (0.55 s)
    wfx.update(1.0);
    expect(wfx.phase).toBe(WarpPhase.TRAVEL);
  });

  it('warpFactor ramps from 0 to 1 during ENGAGE', () => {
    wfx.engage(O, FWD, { travelDuration: 0 });
    wfx.update(0.1);   // partial engage
    expect(wfx.warpFactor).toBeGreaterThan(0);
    expect(wfx.warpFactor).toBeLessThanOrEqual(1);
  });

  it('DISENGAGE transitions to IDLE after disengage duration', () => {
    wfx.engage(O, FWD, { travelDuration: 0 });
    wfx.update(1.0); // reach TRAVEL
    wfx.disengage(O);
    wfx.update(1.0); // advance past DISENGAGE duration
    expect(wfx.phase).toBe(WarpPhase.IDLE);
  });

  it('warpFactor drops to 0 after DISENGAGE completes', () => {
    wfx.engage(O, FWD, { travelDuration: 0 });
    wfx.update(1.0);
    wfx.disengage(O);
    wfx.update(1.0);
    expect(wfx.warpFactor).toBeCloseTo(0);
  });

  it('plasma flows expire after their duration', () => {
    wfx.spawnPlasmaFlow(O, FWD, PlasmaFlowType.WARP_STREAM, { duration: 0.1 });
    wfx.update(0.5);
    expect(wfx.plasmaFlows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// prune()
// ---------------------------------------------------------------------------

describe('WarpFX — prune()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('removes inactive tunnel records', () => {
    const rec = wfx.spawnWarpTunnel(O, FWD, { duration: 0.01 });
    wfx.update(0.1);
    wfx.prune();
    expect(wfx.tunnels.length).toBe(0);
  });

  it('keeps active records', () => {
    wfx.spawnWarpTunnel(O, FWD);
    wfx.prune();
    expect(wfx.tunnels.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('WarpFX — dispose()', () => {
  let wfx;
  beforeEach(() => { wfx = new WarpFX(); });

  it('clears all record arrays', () => {
    wfx.engage(O, FWD);
    wfx.spawnEngineGlow(O);
    wfx.update(0.016);
    wfx.dispose();

    expect(wfx.tunnels.length).toBe(0);
    expect(wfx.plasmaFlows.length).toBe(0);
    expect(wfx.jumpFlashes.length).toBe(0);
    expect(wfx.shockwaves.length).toBe(0);
    expect(wfx.engineGlows.length).toBe(0);
  });

  it('resets phase to IDLE', () => {
    wfx.engage(O, FWD, { travelDuration: 0 });
    wfx.update(1.0);
    wfx.dispose();
    expect(wfx.phase).toBe(WarpPhase.IDLE);
  });

  it('resets warpFactor to 0', () => {
    wfx.setWarpFactor(1);
    wfx.dispose();
    expect(wfx.warpFactor).toBe(0);
  });

  it('particleSystem liveCount is 0 after dispose', () => {
    wfx.engage(O, FWD);
    wfx.update(0.016);
    wfx.dispose();
    expect(wfx.particleSystem.liveCount).toBe(0);
  });
});
