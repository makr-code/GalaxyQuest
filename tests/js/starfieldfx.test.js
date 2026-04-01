/**
 * starfieldfx.test.js — Unit tests for the StarfieldFX subsystem.
 *
 * Tests cover:
 *   • StarfieldLayerType enum completeness
 *   • spawnLayer():         record properties, star instances, preset values
 *   • spawnDefaultLayers(): three layers spawned with correct types
 *   • removeLayer():        layer removal by record and by ID
 *   • setWarpFactor():      clamps [0,1], propagates to all active layers
 *   • update():             advances time, pushes warpFactor to layers
 *   • layers accessor:      filters inactive layers
 *   • prune():              removes inactive layers
 *   • dispose():            clears all state
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { StarfieldFX, StarfieldLayerType } =
  require(path.join(root, 'js/engine/fx/StarfieldFX.js'));

// ---------------------------------------------------------------------------
// Enum completeness
// ---------------------------------------------------------------------------

describe('StarfieldFX — StarfieldLayerType enum', () => {
  it('has exactly 3 values', () => {
    expect(Object.keys(StarfieldLayerType).length).toBe(3);
  });

  it('contains BACKGROUND, PARALLAX, DEEP_FIELD', () => {
    expect(StarfieldLayerType.BACKGROUND).toBeDefined();
    expect(StarfieldLayerType.PARALLAX).toBeDefined();
    expect(StarfieldLayerType.DEEP_FIELD).toBeDefined();
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(StarfieldLayerType)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spawnLayer()
// ---------------------------------------------------------------------------

describe('StarfieldFX — spawnLayer()', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('returns a record with active=true', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    expect(rec.active).toBe(true);
  });

  it('sets the correct layer type', () => {
    const types = [StarfieldLayerType.BACKGROUND, StarfieldLayerType.PARALLAX, StarfieldLayerType.DEEP_FIELD];
    for (const t of types) {
      const rec = sfx.spawnLayer(t);
      expect(rec.type).toBe(t);
    }
  });

  it('assigns a numeric id', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.PARALLAX);
    expect(typeof rec.id).toBe('number');
  });

  it('populates instances Float32Array with 8 floats per star', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    expect(rec.instances).toBeInstanceOf(Float32Array);
    expect(rec.instances.length).toBe(rec.starCount * 8);
  });

  it('BACKGROUND layer has lower parallaxWeight than DEEP_FIELD', () => {
    const bg = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    const df = sfx.spawnLayer(StarfieldLayerType.DEEP_FIELD);
    expect(bg.parallaxWeight).toBeLessThan(df.parallaxWeight);
  });

  it('custom colorHex propagates to options', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.PARALLAX, { colorHex: 0xff4400 });
    expect(rec.colorHex).toBe(0xff4400);
  });

  it('custom starCount overrides preset', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.PARALLAX, { starCount: 77 });
    expect(rec.starCount).toBe(77);
    expect(rec.instances.length).toBe(77 * 8);
  });

  it('defaults brightness from preset', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.DEEP_FIELD);
    expect(rec.brightness).toBeGreaterThan(0);
    expect(rec.brightness).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// spawnDefaultLayers()
// ---------------------------------------------------------------------------

describe('StarfieldFX — spawnDefaultLayers()', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('spawns exactly 3 layers', () => {
    const layers = sfx.spawnDefaultLayers();
    expect(layers.length).toBe(3);
  });

  it('spawns BACKGROUND, PARALLAX, DEEP_FIELD in order', () => {
    const [bg, par, df] = sfx.spawnDefaultLayers();
    expect(bg.type).toBe(StarfieldLayerType.BACKGROUND);
    expect(par.type).toBe(StarfieldLayerType.PARALLAX);
    expect(df.type).toBe(StarfieldLayerType.DEEP_FIELD);
  });

  it('all layers are active', () => {
    const layers = sfx.spawnDefaultLayers();
    expect(layers.every(l => l.active)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeLayer()
// ---------------------------------------------------------------------------

describe('StarfieldFX — removeLayer()', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('removes a layer by record', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.PARALLAX);
    sfx.removeLayer(rec);
    expect(sfx.layers.some(l => l.id === rec.id)).toBe(false);
  });

  it('removes a layer by ID', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    sfx.removeLayer(rec.id);
    expect(sfx.layers.some(l => l.id === rec.id)).toBe(false);
  });

  it('does not remove other layers', () => {
    const a = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    const b = sfx.spawnLayer(StarfieldLayerType.PARALLAX);
    sfx.removeLayer(a);
    expect(sfx.layers.some(l => l.id === b.id)).toBe(true);
  });

  it('no-ops on unknown ID without throwing', () => {
    sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    expect(() => sfx.removeLayer(99999)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setWarpFactor()
// ---------------------------------------------------------------------------

describe('StarfieldFX — setWarpFactor()', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('sets warpFactor on the instance', () => {
    sfx.spawnDefaultLayers();
    sfx.setWarpFactor(0.6);
    expect(sfx.warpFactor).toBeCloseTo(0.6);
  });

  it('propagates to all active layers', () => {
    const layers = sfx.spawnDefaultLayers();
    sfx.setWarpFactor(0.8);
    for (const l of layers) {
      expect(l.warpFactor).toBeCloseTo(0.8);
    }
  });

  it('clamps values above 1 to 1', () => {
    sfx.setWarpFactor(3.5);
    expect(sfx.warpFactor).toBe(1);
  });

  it('clamps values below 0 to 0', () => {
    sfx.setWarpFactor(-2);
    expect(sfx.warpFactor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('StarfieldFX — update()', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('advances time', () => {
    sfx.update(0.016);
    expect(sfx.time).toBeCloseTo(0.016);
  });

  it('pushes time to active layers', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    sfx.update(0.5);
    expect(rec.time).toBeCloseTo(0.5);
  });

  it('pushes warpFactor to active layers each frame', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.PARALLAX);
    sfx.setWarpFactor(0.4);
    sfx.update(0.016);
    expect(rec.warpFactor).toBeCloseTo(0.4);
  });

  it('does not update inactive layers', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    rec.active = false;
    const prevTime = rec.time;
    sfx.update(1.0);
    expect(rec.time).toBe(prevTime);
  });
});

// ---------------------------------------------------------------------------
// layers accessor
// ---------------------------------------------------------------------------

describe('StarfieldFX — layers accessor', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('returns only active layers', () => {
    const a = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    const b = sfx.spawnLayer(StarfieldLayerType.PARALLAX);
    b.active = false;
    expect(sfx.layers).toContain(a);
    expect(sfx.layers).not.toContain(b);
  });

  it('returns empty array when no layers', () => {
    expect(sfx.layers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// prune()
// ---------------------------------------------------------------------------

describe('StarfieldFX — prune()', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('removes inactive layers', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.PARALLAX);
    rec.active = false;
    sfx.prune();
    expect(sfx.layers.length).toBe(0);
  });

  it('keeps active layers', () => {
    sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    sfx.prune();
    expect(sfx.layers.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('StarfieldFX — dispose()', () => {
  let sfx;
  beforeEach(() => { sfx = new StarfieldFX(); });

  it('clears all layers', () => {
    sfx.spawnDefaultLayers();
    sfx.dispose();
    expect(sfx.layers.length).toBe(0);
  });

  it('resets time to 0', () => {
    sfx.update(10);
    sfx.dispose();
    expect(sfx.time).toBe(0);
  });

  it('resets warpFactor to 0', () => {
    sfx.setWarpFactor(0.9);
    sfx.dispose();
    expect(sfx.warpFactor).toBe(0);
  });

  it('releases instances (sets to null)', () => {
    const rec = sfx.spawnLayer(StarfieldLayerType.BACKGROUND);
    sfx.dispose();
    expect(rec.instances).toBeNull();
  });
});
