/**
 * jetlightingpass.test.js — Unit tests for JetLightingPass.
 *
 * Tests cover:
 *   • MAX_JET_SOURCES constant
 *   • Construction: defaults, custom params
 *   • addJet(): returns unique IDs, stores jet data, respects cap
 *   • updateJet(): modifies existing jet, no-op for unknown ID
 *   • removeJet(): removes by ID
 *   • clearJets(): empties jet set
 *   • jetCount getter
 *   • update(): advances _time
 *   • buildParamBlock(): layout, active packing, tail params
 *   • render(): no-op when disabled, dispatches otherwise
 *   • dispose(): clears pipeline and jets
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { JetLightingPass, MAX_JET_SOURCES } =
  require(path.join(root, 'js/engine/post-effects/passes/JetLightingPass.js'));

const FLOATS_PER_JET = 8;
const TOTAL_FLOATS   = MAX_JET_SOURCES * FLOATS_PER_JET + 4;

// ---------------------------------------------------------------------------
// Constant
// ---------------------------------------------------------------------------

describe('MAX_JET_SOURCES', () => {
  it('equals 4', () => {
    expect(MAX_JET_SOURCES).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('JetLightingPass — construction', () => {
  it('defaults: enabled, globalIntensity=1.0, spread=0.18', () => {
    const p = new JetLightingPass();
    expect(p.enabled).toBe(true);
    expect(p.globalIntensity).toBeCloseTo(1.0, 5);
    expect(p.spread).toBeCloseTo(0.18, 4);
  });

  it('accepts custom options', () => {
    const p = new JetLightingPass({ globalIntensity: 2.0, spread: 0.3 });
    expect(p.globalIntensity).toBeCloseTo(2.0, 5);
    expect(p.spread).toBeCloseTo(0.3, 5);
  });

  it('starts with 0 jets', () => {
    expect(new JetLightingPass().jetCount).toBe(0);
  });

  it('_time starts at 0', () => {
    expect(new JetLightingPass()._time).toBe(0);
  });

  it('_pipeline starts as null', () => {
    expect(new JetLightingPass()._pipeline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addJet()
// ---------------------------------------------------------------------------

describe('JetLightingPass — addJet', () => {
  it('returns a unique numeric ID', () => {
    const p  = new JetLightingPass();
    const id1 = p.addJet(0, 0);
    const id2 = p.addJet(0.1, 0.1);
    expect(typeof id1).toBe('number');
    expect(id2).not.toBe(id1);
  });

  it('increments jetCount', () => {
    const p = new JetLightingPass();
    p.addJet(0, 0);
    expect(p.jetCount).toBe(1);
    p.addJet(0, -0.1);
    expect(p.jetCount).toBe(2);
  });

  it('returns -1 when at capacity', () => {
    const p = new JetLightingPass();
    for (let i = 0; i < MAX_JET_SOURCES; i++) p.addJet(0, 0);
    expect(p.addJet(0, 0)).toBe(-1);
    expect(p.jetCount).toBe(MAX_JET_SOURCES);
  });

  it('stores position, direction, colour and intensity', () => {
    const p  = new JetLightingPass();
    const id = p.addJet(0.2, -0.1, 0.0, 1.0, 0xff8800, 1.5);
    const jet = p._jets.get(id);
    expect(jet.x).toBeCloseTo(0.2, 5);
    expect(jet.y).toBeCloseTo(-0.1, 5);
    expect(jet.dirX).toBeCloseTo(0.0, 5);
    expect(jet.dirY).toBeCloseTo(1.0, 5);
    expect(jet.r).toBeCloseTo(1.0, 5);
    expect(jet.g).toBeCloseTo(0x88 / 255, 4);
    expect(jet.b).toBeCloseTo(0, 5);
    expect(jet.intensity).toBeCloseTo(1.5, 5);
  });

  it('defaults intensity=1 and colour=0x88bbff', () => {
    const p   = new JetLightingPass();
    const id  = p.addJet(0, 0);
    const jet = p._jets.get(id);
    expect(jet.intensity).toBeCloseTo(1.0, 5);
    expect(jet.r).toBeCloseTo(0x88 / 255, 4);
    expect(jet.g).toBeCloseTo(0xbb / 255, 4);
    expect(jet.b).toBeCloseTo(0xff / 255, 4);
  });

  it('uses instance spread by default', () => {
    const p  = new JetLightingPass({ spread: 0.25 });
    const id = p.addJet(0, 0);
    expect(p._jets.get(id).spread).toBeCloseTo(0.25, 5);
  });

  it('allows custom spread per jet', () => {
    const p  = new JetLightingPass({ spread: 0.25 });
    const id = p.addJet(0, 0, 0, 1, 0xffffff, 1.0, 0.1);
    expect(p._jets.get(id).spread).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// updateJet()
// ---------------------------------------------------------------------------

describe('JetLightingPass — updateJet', () => {
  it('updates x and y', () => {
    const p  = new JetLightingPass();
    const id = p.addJet(0, 0);
    p.updateJet(id, { x: 0.5, y: -0.3 });
    const jet = p._jets.get(id);
    expect(jet.x).toBeCloseTo(0.5, 5);
    expect(jet.y).toBeCloseTo(-0.3, 5);
  });

  it('updates intensity', () => {
    const p  = new JetLightingPass();
    const id = p.addJet(0, 0);
    p.updateJet(id, { intensity: 2.5 });
    expect(p._jets.get(id).intensity).toBeCloseTo(2.5, 5);
  });

  it('updates colorHex via decoded RGB', () => {
    const p  = new JetLightingPass();
    const id = p.addJet(0, 0);
    p.updateJet(id, { colorHex: 0x0044ff });
    const jet = p._jets.get(id);
    expect(jet.r).toBeCloseTo(0, 5);
    expect(jet.g).toBeCloseTo(0x44 / 255, 4);
    expect(jet.b).toBeCloseTo(1.0, 5);
  });

  it('is a no-op for unknown ID', () => {
    expect(() => new JetLightingPass().updateJet(999, { x: 1 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// removeJet() / clearJets()
// ---------------------------------------------------------------------------

describe('JetLightingPass — removeJet', () => {
  it('removes the jet by ID', () => {
    const p  = new JetLightingPass();
    const id = p.addJet(0, 0);
    p.removeJet(id);
    expect(p.jetCount).toBe(0);
  });

  it('is a no-op for unknown ID', () => {
    const p = new JetLightingPass();
    p.addJet(0, 0);
    p.removeJet(9999);
    expect(p.jetCount).toBe(1);
  });
});

describe('JetLightingPass — clearJets', () => {
  it('removes all jets', () => {
    const p = new JetLightingPass();
    p.addJet(0, 0);
    p.addJet(0.1, 0.1);
    p.clearJets();
    expect(p.jetCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('JetLightingPass — update', () => {
  it('advances _time by dt', () => {
    const p = new JetLightingPass();
    p.update(0.016);
    expect(p._time).toBeCloseTo(0.016, 5);
    p.update(1.0);
    expect(p._time).toBeCloseTo(1.016, 5);
  });
});

// ---------------------------------------------------------------------------
// buildParamBlock()
// ---------------------------------------------------------------------------

describe('JetLightingPass — buildParamBlock', () => {
  it(`returns Float32Array of ${TOTAL_FLOATS} floats`, () => {
    const blk = new JetLightingPass().buildParamBlock();
    expect(blk).toBeInstanceOf(Float32Array);
    expect(blk.length).toBe(TOTAL_FLOATS);
  });

  it('first jet packed at slot 0', () => {
    const p  = new JetLightingPass();
    p.addJet(0.3, -0.4, 0.0, 1.0, 0x0080ff, 1.8);
    const blk = p.buildParamBlock();
    expect(blk[0]).toBeCloseTo(0.3, 5);   // posX
    expect(blk[1]).toBeCloseTo(-0.4, 5);  // posY
    expect(blk[2]).toBeCloseTo(0.0, 5);   // dirX
    expect(blk[3]).toBeCloseTo(1.0, 5);   // dirY
    expect(blk[4]).toBeCloseTo(0, 5);     // r
    expect(blk[5]).toBeCloseTo(0x80 / 255, 3); // g
    expect(blk[6]).toBeCloseTo(1.0, 5);   // b
    expect(blk[7]).toBeCloseTo(1.8, 5);   // intensity
  });

  it('second jet packed at slot 8', () => {
    const p = new JetLightingPass();
    p.addJet(0, 0);
    p.addJet(0.5, 0.5, 1.0, 0.0, 0xffffff, 2.0);
    const blk = p.buildParamBlock();
    expect(blk[8]).toBeCloseTo(0.5, 5);
    expect(blk[9]).toBeCloseTo(0.5, 5);
    expect(blk[15]).toBeCloseTo(2.0, 5);
  });

  it('tail [N*8+0] = time', () => {
    const p = new JetLightingPass();
    p.update(4.2);
    const blk  = p.buildParamBlock();
    const tail = MAX_JET_SOURCES * FLOATS_PER_JET;
    expect(blk[tail]).toBeCloseTo(4.2, 4);
  });

  it('tail [N*8+1] = globalIntensity', () => {
    const p = new JetLightingPass({ globalIntensity: 1.5 });
    const blk  = p.buildParamBlock();
    const tail = MAX_JET_SOURCES * FLOATS_PER_JET;
    expect(blk[tail + 1]).toBeCloseTo(1.5, 5);
  });

  it('tail [N*8+2] = spread', () => {
    const p = new JetLightingPass({ spread: 0.3 });
    const blk  = p.buildParamBlock();
    const tail = MAX_JET_SOURCES * FLOATS_PER_JET;
    expect(blk[tail + 2]).toBeCloseTo(0.3, 5);
  });

  it('tail [N*8+3] = activeCount (0 when no jets)', () => {
    const blk  = new JetLightingPass().buildParamBlock();
    const tail = MAX_JET_SOURCES * FLOATS_PER_JET;
    expect(blk[tail + 3]).toBeCloseTo(0, 5);
  });

  it('tail [N*8+3] = activeCount (2 when 2 jets)', () => {
    const p = new JetLightingPass();
    p.addJet(0, 0);
    p.addJet(0, 0);
    const blk  = p.buildParamBlock();
    const tail = MAX_JET_SOURCES * FLOATS_PER_JET;
    expect(blk[tail + 3]).toBeCloseTo(2, 5);
  });
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe('JetLightingPass — render', () => {
  it('does not throw without GPU resources', () => {
    expect(() => new JetLightingPass().render(null, null, null)).not.toThrow();
  });

  it('calls renderer.runJetLightingPass when enabled', () => {
    const p = new JetLightingPass();
    let called = false;
    p.render(null, null, { runJetLightingPass: () => { called = true; } });
    expect(called).toBe(true);
  });

  it('is a no-op when disabled', () => {
    const p = new JetLightingPass();
    p.enabled = false;
    let called = false;
    p.render(null, null, { runJetLightingPass: () => { called = true; } });
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('JetLightingPass — dispose', () => {
  it('clears _pipeline to null', () => {
    const p = new JetLightingPass();
    p._pipeline = {};
    p.dispose();
    expect(p._pipeline).toBeNull();
  });

  it('clears all jets', () => {
    const p = new JetLightingPass();
    p.addJet(0, 0);
    p.dispose();
    expect(p.jetCount).toBe(0);
  });

  it('does not throw', () => {
    expect(() => new JetLightingPass().dispose()).not.toThrow();
  });
});
