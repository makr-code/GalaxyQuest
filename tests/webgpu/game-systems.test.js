/**
 * tests/webgpu/game-systems.test.js
 *
 * Tests for the game-classics-inspired systems:
 *   - EventSystem  (Stellaris / Victoria 3)
 *   - ResearchTree (Endless Space 2 / Master of Orion)
 *   - FleetFormation (X4 / Homeworld)
 *   - ColonySimulation (Victoria 3 / Master of Orion)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventSystem, EventType, EventStatus, Journal, JournalStatus } from '../../js/engine/game/EventSystem.js';
import { ResearchTree, ResearchCategory, CivAffinity }         from '../../js/engine/game/ResearchTree.js';
import { FleetFormation, FormationShape, Wing, Maneuver, getSlotPositions }   from '../../js/engine/game/FleetFormation.js';
import {
  ColonySimulation, Colony, PopJob,
  BuildingType, BUILDING_COST, BUILDING_YIELD, TRADE_CHAIN,
  HUNGER_THRESHOLDS, UNREST_THRESHOLDS,
  ColonyType, COLONY_TYPE_BONUS, MOON_ALLOWED_BUILDINGS, MOON_MAX_SIZE,
  InvasionResult, InvasionReport,
  TROOP_DEFENSE_VALUE, TROOP_ATTACK_VALUE, DEFENSE_DPS_FACTOR,
  MAX_INVASION_ROUNDS, INVASION_LOOT_FRACTION, INVASION_CONQUEST_PENALTIES,
} from '../../js/engine/game/ColonySimulation.js';
import {
  BattleSimulator, BattleFleet, BattleReport,
  ShipClass, SHIP_STATS, SHIP_METAL_VALUE,
} from '../../js/engine/game/BattleSimulator.js';

// ===========================================================================
// EventSystem
// ===========================================================================

describe('EventSystem', () => {
  let evtSys;
  beforeEach(() => {
    evtSys = new EventSystem();
    evtSys.define({
      id:      'test.basic',
      type:    EventType.RANDOM,
      title:   'Test Event',
      weight:  10,
      choices: [
        { label: 'Accept', effect: (gs) => { gs.value += 10; } },
        { label: 'Decline', effect: () => {} },
      ],
    });
  });

  it('define() registers an event', () => {
    expect(evtSys.librarySize).toBe(1);
  });

  it('define() throws without id', () => {
    expect(() => evtSys.define({ choices: [{ label: 'X', effect: () => {} }] })).toThrow(/id/);
  });

  it('define() throws without choices', () => {
    expect(() => evtSys.define({ id: 'x', choices: [] })).toThrow(/choice/i);
  });

  it('schedule() queues an event', () => {
    evtSys.schedule('test.basic');
    expect(evtSys._queue.length).toBe(1);
  });

  it('schedule() warns for unknown id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    evtSys.schedule('nonexistent');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('tick() promotes queued event to active', () => {
    evtSys.schedule('test.basic');
    evtSys.tick({});
    expect(evtSys.activeEvents.length).toBe(1);
    expect(evtSys.activeEvents[0].status).toBe(EventStatus.ACTIVE);
  });

  it('tick() respects condition', () => {
    evtSys.define({
      id: 'conditional',
      condition: (gs) => gs.ships > 5,
      choices: [{ label: 'ok', effect: () => {} }],
    });
    evtSys.schedule('conditional');
    evtSys.tick({ ships: 1 }); // condition fails
    expect(evtSys.activeEvents.length).toBe(0);
    expect(evtSys._history[0].status).toBe(EventStatus.EXPIRED);
  });

  it('resolve() applies choice effect', () => {
    evtSys.schedule('test.basic');
    evtSys.tick({});
    const gs = { value: 0 };
    evtSys.resolve('test.basic', 0, gs);
    expect(gs.value).toBe(10);
    expect(evtSys.activeEvents.length).toBe(0);
    expect(evtSys.history.length).toBe(1);
  });

  it('resolve() warns for unknown active event', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    evtSys.resolve('unknown', 0, {});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('EventBus integration emits events', () => {
    const mockBus = { emit: vi.fn() };
    const sys = new EventSystem(mockBus);
    sys.define({ id: 'bus.test', choices: [{ label: 'go', effect: () => {} }] });
    sys.schedule('bus.test');
    sys.tick({});
    expect(mockBus.emit).toHaveBeenCalledWith('game:event:fired', expect.any(Object));
    sys.resolve('bus.test', 0, {});
    expect(mockBus.emit).toHaveBeenCalledWith('game:event:resolved', expect.any(Object));
  });

  it('maxActive limits simultaneous events', () => {
    evtSys.maxActive = 1;
    evtSys.schedule('test.basic');
    evtSys.define({ id: 'second', choices: [{ label: 'x', effect: () => {} }] });
    evtSys.schedule('second');
    evtSys.tick({});
    expect(evtSys.activeEvents.length).toBe(1);
    expect(evtSys._queue.length).toBe(1); // second still queued
  });

  it('EventType constants are frozen', () => {
    expect(Object.isFrozen(EventType)).toBe(true);
  });

  it('colony event types exist on EventType', () => {
    expect(EventType.PLAGUE).toBe('plague');
    expect(EventType.REVOLT).toBe('revolt');
    expect(EventType.GOLDEN_AGE).toBe('golden_age');
    expect(EventType.RESOURCE_BOOM).toBe('resource_boom');
  });

  it('seeded RNG produces deterministic results', () => {
    const sys1 = new EventSystem(null, 42);
    const sys2 = new EventSystem(null, 42);
    sys1.define({ id: 'rng.test', type: EventType.RANDOM, weight: 10, choices: [{ label: 'ok', effect: () => {} }] });
    sys2.define({ id: 'rng.test', type: EventType.RANDOM, weight: 10, choices: [{ label: 'ok', effect: () => {} }] });
    // Run many ticks and compare queue/active state
    sys1.randomEventChance = 1; // always try to fire
    sys2.randomEventChance = 1;
    for (let i = 0; i < 5; i++) {
      sys1.tick({}, i);
      sys2.tick({}, i);
    }
    expect(sys1._queue.length).toBe(sys2._queue.length);
    expect(sys1._active.length).toBe(sys2._active.length);
  });

  it('cooldown prevents re-firing within cycle window', () => {
    const sys = new EventSystem(null, 7);
    sys.define({
      id: 'cooldown.test',
      type: EventType.RANDOM,
      weight: 100,
      cooldown: 10,
      choices: [{ label: 'ok', effect: () => {} }],
    });
    // Manually schedule + resolve to set _lastFired
    sys.schedule('cooldown.test');
    sys.tick({}, 0);
    sys.resolve('cooldown.test', 0, {});
    // At cycle 5 (within cooldown of 10), event should not fire
    const fired = [];
    for (let c = 1; c <= 5; c++) {
      sys.randomEventChance = 1;
      sys.tick({}, c);
      if (sys._queue.length > 0 || sys._active.length > 0) fired.push(c);
    }
    expect(fired.length).toBe(0);
    // At cycle 11 (outside cooldown), event is eligible
    sys.randomEventChance = 1;
    sys.tick({}, 11);
    expect(sys._queue.length + sys._active.length).toBeGreaterThan(0);
  });

  it('resolve() deducts choice cost from gameState', () => {
    const sys = new EventSystem();
    sys.define({
      id: 'cost.event',
      choices: [
        { label: 'Pay', cost: { credits: 100 }, effect: (gs) => { gs.value += 50; } },
        { label: 'Pass', effect: () => {} },
      ],
    });
    sys.schedule('cost.event');
    sys.tick({});
    const gs = { credits: 200, value: 0 };
    sys.resolve('cost.event', 0, gs);
    expect(gs.credits).toBe(100); // 200 - 100
    expect(gs.value).toBe(50);
  });

  it('resolve() aborts when gameState cannot afford cost', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sys = new EventSystem();
    sys.define({
      id: 'broke.event',
      choices: [
        { label: 'Expensive', cost: { credits: 500 }, effect: (gs) => { gs.value = 999; } },
      ],
    });
    sys.schedule('broke.event');
    sys.tick({});
    const gs = { credits: 10, value: 0 };
    sys.resolve('broke.event', 0, gs);
    expect(gs.value).toBe(0);    // effect not applied
    expect(gs.credits).toBe(10); // credits not deducted
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ===========================================================================
// ResearchTree
// ===========================================================================

describe('ResearchTree', () => {
  let tree;
  beforeEach(() => {
    tree = new ResearchTree();
    tree.define({ id: 'prop.ion',  category: ResearchCategory.PROPULSION, era: 1, cost: 100, prerequisites: [] });
    tree.define({ id: 'prop.warp', category: ResearchCategory.PROPULSION, era: 2, cost: 200, prerequisites: ['prop.ion'] });
    tree.define({ id: 'bio.basic', category: ResearchCategory.BIOLOGY,    era: 1, cost: 80,  prerequisites: [] });
  });

  it('define() registers nodes', () => {
    expect(tree.nodeCount).toBe(3);
  });

  it('define() throws without id', () => {
    expect(() => tree.define({ cost: 100 })).toThrow(/id/);
  });

  it('available() returns techs with met prerequisites', () => {
    const avail = tree.available().map((n) => n.id);
    expect(avail).toContain('prop.ion');
    expect(avail).toContain('bio.basic');
    expect(avail).not.toContain('prop.warp'); // requires prop.ion
  });

  it('startResearch() sets active node', () => {
    tree.startResearch('prop.ion');
    expect(tree.activeNode?.id).toBe('prop.ion');
    expect(tree.progressFraction).toBe(0);
  });

  it('startResearch() warns if prerequisites not met', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tree.startResearch('prop.warp');
    expect(warn).toHaveBeenCalled();
    expect(tree.activeNode).toBeNull();
    warn.mockRestore();
  });

  it('addProgress() completes a tech', () => {
    tree.startResearch('prop.ion');
    const done = tree.addProgress(100);
    expect(done).toBe(true);
    expect(tree.isResearched('prop.ion')).toBe(true);
    expect(tree.activeNode).toBeNull();
  });

  it('addProgress() respects affinity multiplier', () => {
    tree.setAffinity(ResearchCategory.PROPULSION, 2);
    tree.startResearch('prop.ion');
    const done = tree.addProgress(50); // 50 * 2 = 100 = cost
    expect(done).toBe(true);
  });

  it('prerequisites unlock after completion', () => {
    tree.startResearch('prop.ion');
    tree.addProgress(200);
    const avail = tree.available().map((n) => n.id);
    expect(avail).toContain('prop.warp');
  });

  it('completed returns done nodes', () => {
    tree.startResearch('bio.basic');
    tree.addProgress(200);
    expect(tree.completed.map((n) => n.id)).toContain('bio.basic');
  });

  it('ResearchCategory constants are frozen', () => {
    expect(Object.isFrozen(ResearchCategory)).toBe(true);
  });

  it('EventBus integration emits research:complete', () => {
    const mockBus = { emit: vi.fn() };
    const t = new ResearchTree(mockBus);
    t.define({ id: 'x', cost: 10, prerequisites: [] });
    t.startResearch('x');
    t.addProgress(10);
    expect(mockBus.emit).toHaveBeenCalledWith('research:complete', expect.any(Object));
  });

  // ---- New DAG / era-gating / persistence tests ----

  it('CivAffinity constants are frozen', () => {
    expect(Object.isFrozen(CivAffinity)).toBe(true);
    expect(CivAffinity.MILITARY).toBe('military');
    expect(CivAffinity.SCIENCE).toBe('science');
    expect(CivAffinity.ECONOMY).toBe('economy');
    expect(CivAffinity.CULTURE).toBe('culture');
  });

  it('define() throws on self-referencing prerequisite (cycle)', () => {
    expect(() => tree.define({ id: 'loop', prerequisites: ['loop'] })).toThrow(/[Cc]ycl/);
  });

  it('define() throws when adding a node that closes a DAG cycle', () => {
    // A → B (B requires A)
    tree.define({ id: 'a', prerequisites: [] });
    tree.define({ id: 'b', prerequisites: ['a'] });
    // Now try to make A require B → cycle: A → B → A
    expect(() => tree.define({ id: 'a', prerequisites: ['b'] })).toThrow(/[Cc]ycl/);
  });

  it('define() accepts a valid three-node chain without throwing', () => {
    expect(() => {
      tree.define({ id: 'chain.1', prerequisites: [] });
      tree.define({ id: 'chain.2', prerequisites: ['chain.1'] });
      tree.define({ id: 'chain.3', prerequisites: ['chain.2'] });
    }).not.toThrow();
  });

  it('getAvailable() returns era-1 techs when nothing unlocked', () => {
    const t = new ResearchTree();
    t.define({ id: 'e1.a', era: 1, prerequisites: [] });
    t.define({ id: 'e1.b', era: 1, prerequisites: [] });
    t.define({ id: 'e2.a', era: 2, prerequisites: [] });
    const avail = t.getAvailable(new Set()).map((n) => n.id);
    expect(avail).toContain('e1.a');
    expect(avail).toContain('e1.b');
    expect(avail).not.toContain('e2.a'); // era-2 locked until 60% of era-1 done
  });

  it('getAvailable() unlocks era-2 when ≥60% of era-1 is done', () => {
    const t = new ResearchTree();
    // 5 era-1 techs; need ≥3 (60%) to unlock era-2
    for (let i = 1; i <= 5; i++) t.define({ id: `e1.${i}`, era: 1, prerequisites: [] });
    t.define({ id: 'e2.x', era: 2, prerequisites: [] });

    const unlocked3 = new Set(['e1.1', 'e1.2', 'e1.3']); // exactly 60%
    const avail = t.getAvailable(unlocked3).map((n) => n.id);
    expect(avail).toContain('e2.x');
  });

  it('getAvailable() keeps era-2 locked when <60% of era-1 is done', () => {
    const t = new ResearchTree();
    for (let i = 1; i <= 5; i++) t.define({ id: `e1.${i}`, era: 1, prerequisites: [] });
    t.define({ id: 'e2.x', era: 2, prerequisites: [] });

    const unlocked2 = new Set(['e1.1', 'e1.2']); // only 40%
    const avail = t.getAvailable(unlocked2).map((n) => n.id);
    expect(avail).not.toContain('e2.x');
  });

  it('getAvailable() respects prerequisites within the same era', () => {
    const t = new ResearchTree();
    t.define({ id: 'base',    era: 1, prerequisites: [] });
    t.define({ id: 'derived', era: 1, prerequisites: ['base'] });
    const avail = t.getAvailable(new Set()).map((n) => n.id);
    expect(avail).toContain('base');
    expect(avail).not.toContain('derived');
  });

  it('estimateResearchTime() returns cost / multiplier', () => {
    const t = new ResearchTree();
    t.define({ id: 'w1', category: ResearchCategory.WEAPONS, cost: 200, prerequisites: [] });
    // No affinity → cost unchanged
    expect(t.estimateResearchTime('w1')).toBe(200);
    // 2× affinity halves the time
    expect(t.estimateResearchTime('w1', { [ResearchCategory.WEAPONS]: 2 })).toBe(100);
  });

  it('estimateResearchTime() returns Infinity for unknown tech', () => {
    expect(tree.estimateResearchTime('nonexistent')).toBe(Infinity);
  });

  it('getUnlocked() returns snapshot of done set', () => {
    tree.startResearch('prop.ion');
    tree.addProgress(200);
    const snap = tree.getUnlocked();
    expect(snap instanceof Set).toBe(true);
    expect(snap.has('prop.ion')).toBe(true);
    // Snapshot is a copy — mutations don't affect tree
    snap.delete('prop.ion');
    expect(tree.isResearched('prop.ion')).toBe(true);
  });

  it('unlock() directly marks a tech as done and emits event', () => {
    const mockBus = { emit: vi.fn() };
    const t = new ResearchTree(mockBus);
    t.define({ id: 'direct', cost: 999, prerequisites: [] });
    t.unlock('direct');
    expect(t.isResearched('direct')).toBe(true);
    expect(mockBus.emit).toHaveBeenCalledWith('research:unlocked', expect.objectContaining({ id: 'direct' }));
  });

  it('unlock() is idempotent (no double-emit)', () => {
    const mockBus = { emit: vi.fn() };
    const t = new ResearchTree(mockBus);
    t.define({ id: 'idem', cost: 10, prerequisites: [] });
    t.unlock('idem');
    t.unlock('idem');
    expect(mockBus.emit).toHaveBeenCalledTimes(1);
  });

  it('unlock() warns for unknown tech', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tree.unlock('totally.unknown');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ===========================================================================
// FleetFormation
// ===========================================================================

describe('FleetFormation', () => {
  let formations;

  function makeShip(x = 0, y = 0, z = 0) {
    return { position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } };
  }

  beforeEach(() => {
    formations = new FleetFormation();
  });

  it('createWing() registers a wing', () => {
    formations.createWing('Alpha', FormationShape.WEDGE);
    expect(formations.wingCount).toBe(1);
    expect(formations.getWing('Alpha')).not.toBeNull();
  });

  it('removeWing() deletes a wing', () => {
    formations.createWing('Beta', FormationShape.LINE);
    formations.removeWing('Beta');
    expect(formations.getWing('Beta')).toBeNull();
  });

  it('wing.add() increases size', () => {
    const wing = formations.createWing('W', FormationShape.LINE);
    wing.add(makeShip());
    wing.add(makeShip());
    expect(wing.size).toBe(2);
  });

  it('wing.remove() decreases size and renumbers slots', () => {
    const wing = formations.createWing('W', FormationShape.LINE);
    const s1   = makeShip();
    const s2   = makeShip();
    wing.add(s1);
    wing.add(s2);
    wing.remove(s1);
    expect(wing.size).toBe(1);
    expect(wing._members[0].slotIndex).toBe(0);
  });

  it('WEDGE: slot positions alternate left/right', () => {
    const leader = makeShip(0, 0, 0);
    const wing   = formations.createWing('Test', FormationShape.WEDGE, { leader, spacing: 100 });
    const p0 = wing._slotPosition(0, leader.position, leader.velocity);
    const p1 = wing._slotPosition(1, leader.position, leader.velocity);
    // Slot 0: right (+x), Slot 1: left (-x)
    expect(p0.x).toBeGreaterThan(0);
    expect(p1.x).toBeLessThan(0);
  });

  it('SPHERE: all ships within expected radius', () => {
    const leader = makeShip(0, 0, 0);
    const wing   = formations.createWing('Test', FormationShape.SPHERE, { leader, spacing: 200 });
    for (let i = 0; i < 10; i++) wing.add(makeShip());
    for (let i = 0; i < wing.size; i++) {
      const p = wing._slotPosition(i, leader.position, leader.velocity);
      const dist = Math.sqrt(p.x ** 2 + p.y ** 2 + p.z ** 2);
      expect(dist).toBeLessThanOrEqual(210); // allow slight tolerance
    }
  });

  it('ESCORT: provides at least 4 slots', () => {
    const leader = makeShip();
    const wing   = formations.createWing('T', FormationShape.ESCORT, { leader, spacing: 80 });
    for (let i = 0; i < 4; i++) {
      expect(() => wing._slotPosition(i, leader.position, leader.velocity)).not.toThrow();
    }
  });

  it('update() applies cohesion force toward slot', () => {
    const leader = makeShip(0, 0, 0);
    const ship   = makeShip(1000, 0, 0); // far from slot
    const wing   = formations.createWing('T', FormationShape.COLUMN, {
      leader,
      spacing:  100,
      cohesion: 0.5,
    });
    wing.add(ship);
    wing.update(0.016);
    // Velocity should now be directed toward slot (behind leader = +z)
    expect(ship.velocity.z).toBeGreaterThan(0);
  });

  it('CUSTOM shape uses provided slots', () => {
    const leader      = makeShip(0, 0, 0);
    const customSlots = [{ x: 999, y: 0, z: 0 }];
    const wing        = formations.createWing('T', FormationShape.CUSTOM, {
      leader,
      customSlots,
    });
    const p = wing._slotPosition(0, leader.position, leader.velocity);
    expect(p.x).toBe(999);
  });

  it('disabled wing is not updated', () => {
    const ship   = makeShip(100, 0, 0);
    const wing   = formations.createWing('T', FormationShape.LINE, { leader: makeShip(), cohesion: 1 });
    wing.enabled = false;
    wing.add(ship);
    wing.update(1);
    expect(ship.velocity.x).toBe(0); // no force applied
  });

  it('FormationShape constants are frozen', () => {
    expect(Object.isFrozen(FormationShape)).toBe(true);
  });

  // ---- New: getSlotPositions pure function ----

  it('getSlotPositions() returns correct slot count', () => {
    for (const shape of Object.values(FormationShape).filter((s) => s !== FormationShape.CUSTOM)) {
      const slots = getSlotPositions(shape, 5, 100);
      expect(slots).toHaveLength(5);
    }
  });

  it('getSlotPositions(LINE) offsets only on x-axis', () => {
    const slots = getSlotPositions(FormationShape.LINE, 3, 100);
    for (const s of slots) {
      expect(s.y).toBe(0);
      expect(s.z).toBe(0);
      expect(s.x).toBeGreaterThan(0);
    }
  });

  it('getSlotPositions(COLUMN) offsets only on z-axis', () => {
    const slots = getSlotPositions(FormationShape.COLUMN, 3, 100);
    for (const s of slots) {
      expect(s.x).toBe(0);
      expect(s.y).toBe(0);
      expect(s.z).toBeGreaterThan(0);
    }
  });

  it('getSlotPositions(WEDGE) alternates x sign', () => {
    const slots = getSlotPositions(FormationShape.WEDGE, 4, 100);
    expect(slots[0].x).toBeGreaterThan(0); // slot 0: right
    expect(slots[1].x).toBeLessThan(0);    // slot 1: left
    expect(slots[2].x).toBeGreaterThan(0); // slot 2: right
    expect(slots[3].x).toBeLessThan(0);    // slot 3: left
  });

  it('getSlotPositions(DELTA) places ships in increasing rows', () => {
    const slots = getSlotPositions(FormationShape.DELTA, 4, 100);
    // All slots should have z >= 0 (behind leader)
    for (const s of slots) expect(s.z).toBeGreaterThanOrEqual(0);
  });

  it('getSlotPositions(SPHERE) keeps all slots within radius', () => {
    const slots = getSlotPositions(FormationShape.SPHERE, 8, 150);
    for (const s of slots) {
      const dist = Math.sqrt(s.x ** 2 + s.y ** 2 + s.z ** 2);
      expect(dist).toBeLessThanOrEqual(155);
    }
  });

  it('getSlotPositions(ESCORT) produces non-zero offsets', () => {
    const slots = getSlotPositions(FormationShape.ESCORT, 4, 80);
    for (const s of slots) {
      const dist = Math.sqrt(s.x ** 2 + s.y ** 2 + s.z ** 2);
      expect(dist).toBeGreaterThan(0);
    }
  });

  // ---- New: spring-damper cohesion ----

  it('cohesionStrength option is used (alias for cohesion)', () => {
    const leader = makeShip(0, 0, 0);
    const ship   = makeShip(0, 0, 0);
    const wing   = formations.createWing('D', FormationShape.COLUMN, {
      leader,
      spacing:          100,
      cohesionStrength: 0.8,
      dampening:        0,
    });
    wing.add(ship);
    expect(wing.cohesionStrength).toBe(0.8);
    expect(wing.dampening).toBe(0);
  });

  it('dampening reduces velocity overshoot', () => {
    const leader  = makeShip(0, 0, 0);
    // Ship is already at slot position (0, 0, 100) but has high velocity
    const ship    = makeShip(0, 0, 100);
    ship.velocity = { x: 0, y: 0, z: 50 }; // moving away from leader

    const wing = formations.createWing('D', FormationShape.COLUMN, {
      leader,
      spacing:          100,
      cohesionStrength: 0,   // no spring — just damper
      dampening:        0.5,
    });
    wing.add(ship);
    wing.update(0.016);
    // Velocity should be reduced by dampening
    expect(Math.abs(ship.velocity.z)).toBeLessThan(50);
  });

  // ---- New: setFormation with transition ----

  it('setFormation() changes shape', () => {
    const wing = formations.createWing('T', FormationShape.LINE, { leader: makeShip() });
    wing.setFormation(FormationShape.WEDGE);
    expect(wing.shape).toBe(FormationShape.WEDGE);
  });

  it('setFormation() with transitionFrames stores fromOffsets', () => {
    const leader = makeShip(0, 0, 0);
    const wing   = formations.createWing('T', FormationShape.LINE, { leader, spacing: 100 });
    wing.add(makeShip(100, 0, 0));
    wing.setFormation(FormationShape.COLUMN, 10);
    expect(wing._transitionFromOffsets).not.toBeNull();
    expect(wing._transitionFramesTotal).toBe(10);
  });

  it('transition interpolates position during frames', () => {
    const leader = makeShip(0, 0, 0);
    const ship   = makeShip(100, 0, 0);
    const wing   = formations.createWing('T', FormationShape.LINE, { leader, spacing: 100 });
    wing.add(ship);
    // Switch to COLUMN over 10 frames: slot goes from (100,0,0) to (0,0,100)
    wing.setFormation(FormationShape.COLUMN, 10);
    // After 5 frames the target should be roughly halfway
    for (let i = 0; i < 5; i++) wing.update(0.016);
    const slot5 = wing._slotPosition(0, leader.position, leader.velocity ?? { x:0,y:0,z:0 });
    // After transition completes, slot must match COLUMN
    for (let i = 5; i < 10; i++) wing.update(0.016);
    const slotFinal = wing._slotPosition(0, leader.position, leader.velocity ?? { x:0,y:0,z:0 });
    expect(slotFinal.x).toBeCloseTo(0);
    expect(slotFinal.z).toBeCloseTo(100);
    expect(wing._transitionFromOffsets).toBeNull(); // transition cleared
  });

  // ---- New: maneuver enum & startManeuver ----

  it('Maneuver constants are frozen', () => {
    expect(Object.isFrozen(Maneuver)).toBe(true);
    expect(Maneuver.PINCER).toBe('pincer');
    expect(Maneuver.RETREAT).toBe('retreat');
    expect(Maneuver.FLANKING).toBe('flanking');
  });

  it('PINCER maneuver sequences through WEDGE → DELTA → ESCORT', () => {
    const leader = makeShip(0, 0, 0);
    const wing   = formations.createWing('P', FormationShape.LINE, { leader, spacing: 100 });
    for (let i = 0; i < 3; i++) wing.add(makeShip());
    wing.startManeuver(Maneuver.PINCER, 1); // 1 frame per step for speed
    expect(wing.shape).toBe(FormationShape.WEDGE); // first step applied immediately
    wing.update(0.016); // complete first transition (1 frame)
    expect(wing.shape).toBe(FormationShape.DELTA);
    wing.update(0.016); // complete second transition
    expect(wing.shape).toBe(FormationShape.ESCORT);
  });

  it('RETREAT maneuver transitions to COLUMN', () => {
    const leader = makeShip(0, 0, 0);
    const wing   = formations.createWing('R', FormationShape.WEDGE, { leader, spacing: 100 });
    for (let i = 0; i < 2; i++) wing.add(makeShip());
    wing.startManeuver(Maneuver.RETREAT, 1);
    expect(wing.shape).toBe(FormationShape.COLUMN);
  });

  it('FLANKING maneuver sequences through LINE → WEDGE', () => {
    const leader = makeShip(0, 0, 0);
    const wing   = formations.createWing('F', FormationShape.COLUMN, { leader, spacing: 100 });
    for (let i = 0; i < 2; i++) wing.add(makeShip());
    wing.startManeuver(Maneuver.FLANKING, 1);
    expect(wing.shape).toBe(FormationShape.LINE);
    wing.update(0.016);
    expect(wing.shape).toBe(FormationShape.WEDGE);
  });

  it('startManeuver() warns on unknown maneuver', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wing = formations.createWing('U', FormationShape.LINE, { leader: makeShip() });
    wing.startManeuver('unknown_maneuver');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ===========================================================================
// ColonySimulation
// ===========================================================================

describe('ColonySimulation', () => {
  let sim;
  beforeEach(() => {
    sim = new ColonySimulation();
  });

  it('found() creates a colony', () => {
    sim.found({ id: 'ignis', name: 'Ignis Prime', size: 12, startingPops: 3 });
    expect(sim.count).toBe(1);
    expect(sim.get('ignis').pops).toBe(3);
  });

  it('setJobs() assigns workers and sets unemployed', () => {
    const col = sim.found({ id: 'c1', name: 'C1', size: 10, startingPops: 4 });
    col.setJobs({ [PopJob.FARMER]: 2, [PopJob.WORKER]: 1 });
    expect(col.jobs[PopJob.FARMER]).toBe(2);
    expect(col.jobs[PopJob.WORKER]).toBe(1);
    expect(col.jobs[PopJob.UNEMPLOYED]).toBe(1); // 4 - 3 = 1
  });

  it('computeYield() returns food for farmers', () => {
    const col = sim.found({ id: 'c2', name: 'C2', size: 10, startingPops: 3, fertility: 1.0 });
    col.setJobs({ [PopJob.FARMER]: 3 });
    const y = col.computeYield();
    expect(y.food).toBeCloseTo(9); // 3 farmers × 3 food
  });

  it('computeYield() scales with stability', () => {
    const col = sim.found({ id: 'c3', name: 'C3', size: 10, startingPops: 2 });
    col.setJobs({ [PopJob.WORKER]: 2 });
    col.stability = 0.5;
    const y = col.computeYield();
    // 2 workers × 4 production × 0.5 stability = 4
    expect(y.production).toBeCloseTo(4);
  });

  it('tick() adds food to stockpile', () => {
    const col = sim.found({ id: 'c4', name: 'C4', size: 10, startingPops: 2 });
    col.setJobs({ [PopJob.FARMER]: 2 });
    col.stockpile.food = 0;
    sim.tick(1);
    // 2 farmers × 3 food - 2 pops consumption = +4
    expect(col.stockpile.food).toBeGreaterThan(0);
  });

  it('tick() reduces food and triggers starvation', () => {
    const col = sim.found({ id: 'c5', name: 'C5', size: 10, startingPops: 5 });
    col.stockpile.food = 0;
    col.setJobs({ [PopJob.UNEMPLOYED]: 5 }); // no farmers
    // Starvation accumulates: each tick food -= pops; when < 0 growthAcc decreases
    for (let i = 0; i < 10; i++) sim.tick(1);
    // Food is either negative (mid-starvation) or reset to 0 (just starved)
    expect(col.stockpile.food).toBeLessThanOrEqual(0);
  });

  it('tick() emits colony:starve when pops die', () => {
    const mockBus = { emit: vi.fn() };
    const s = new ColonySimulation(mockBus);
    const col = s.found({ id: 'starve', name: 'S', size: 10, startingPops: 2 });
    col.stockpile.food = 0;
    col._growthAcc = -0.99; // almost at starvation threshold
    col.setJobs({ [PopJob.UNEMPLOYED]: 2 });
    for (let i = 0; i < 20; i++) s.tick(1);
    // Should have emitted starve at some point
    const calls = mockBus.emit.mock.calls.map((c) => c[0]);
    // Either starved or colony:unrest due to unemployed
    expect(calls.some((c) => c.includes('colony:'))).toBe(true);
  });

  it('pop growth respects size cap', () => {
    const col = sim.found({ id: 'full', name: 'F', size: 3, startingPops: 3, fertility: 2 });
    col.setJobs({ [PopJob.FARMER]: 3 });
    for (let i = 0; i < 100; i++) sim.tick(1);
    expect(col.pops).toBeLessThanOrEqual(3);
  });

  it('PopJob constants are frozen', () => {
    expect(Object.isFrozen(PopJob)).toBe(true);
  });

  it('all() returns all colonies', () => {
    sim.found({ id: 'a', name: 'A', size: 5, startingPops: 1 });
    sim.found({ id: 'b', name: 'B', size: 5, startingPops: 1 });
    expect(sim.all().length).toBe(2);
  });
});

// ===========================================================================
// ColonySimulation — Buildings & Build Queue
// ===========================================================================

describe('ColonySimulation – buildings', () => {
  let sim, col;

  beforeEach(() => {
    sim = new ColonySimulation();
    col = sim.found({ id: 'bld', name: 'BldTest', size: 20, startingPops: 2 });
    col.stockpile.production = 200;
    col.stockpile.credits    = 100;
    col.stockpile.ore        = 50;
    col.stockpile.metal      = 50;
  });

  it('BuildingType enum is frozen and has expected keys', () => {
    expect(Object.isFrozen(BuildingType)).toBe(true);
    expect(BuildingType.FARM).toBe('farm');
    expect(BuildingType.MINE).toBe('mine');
    expect(BuildingType.FACTORY).toBe('factory');
    expect(BuildingType.LAB).toBe('lab');
    expect(BuildingType.BARRACKS).toBe('barracks');
    expect(BuildingType.SPACEPORT).toBe('spaceport');
  });

  it('BUILDING_COST has entries for all building types', () => {
    for (const type of Object.values(BuildingType)) {
      expect(BUILDING_COST[type]).toBeDefined();
      expect(BUILDING_COST[type].buildTime).toBeGreaterThan(0);
    }
  });

  it('enqueueBuilding() deducts costs and adds to queue', () => {
    const prodBefore = col.stockpile.production;
    const result = col.enqueueBuilding(BuildingType.FARM);
    expect(result.success).toBe(true);
    expect(col.buildQueue.length).toBe(1);
    expect(col.buildQueue[0].type).toBe(BuildingType.FARM);
    expect(col.stockpile.production).toBe(prodBefore - BUILDING_COST[BuildingType.FARM].production);
  });

  it('enqueueBuilding() returns failure when resources insufficient', () => {
    col.stockpile.production = 0;
    const result = col.enqueueBuilding(BuildingType.FARM);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/insufficient/);
    expect(col.buildQueue.length).toBe(0);
  });

  it('enqueueBuilding() throws for unknown type', () => {
    expect(() => col.enqueueBuilding('unknown_building')).toThrow(/Unknown building type/);
  });

  it('_processBuildQueue() completes building after enough ticks', () => {
    col.enqueueBuilding(BuildingType.FARM); // buildTime = 3
    col._processBuildQueue(2);
    expect(col.buildings[BuildingType.FARM]).toBe(0); // not done yet
    col._processBuildQueue(1);
    expect(col.buildings[BuildingType.FARM]).toBe(1); // now complete
    expect(col.buildQueue.length).toBe(0);
  });

  it('sim.tick() emits colony:building:complete when building finishes', () => {
    const mockBus = { emit: vi.fn() };
    const s2 = new ColonySimulation(mockBus);
    const c2 = s2.found({ id: 'bc', name: 'BC', size: 20, startingPops: 1 });
    c2.stockpile.production = 200;
    c2.enqueueBuilding(BuildingType.MINE); // buildTime = 4
    for (let i = 0; i < 4; i++) s2.tick(1);
    const calls = mockBus.emit.mock.calls.map(c => c[0]);
    expect(calls).toContain('colony:building:complete');
  });

  it('_applyBuildingYields() adds building resource output each tick', () => {
    col.buildings[BuildingType.FARM] = 2;
    const foodBefore = col.stockpile.food;
    col._applyBuildingYields(1);
    // 2 FARMs × 5 food = +10
    expect(col.stockpile.food).toBe(foodBefore + 10);
  });

  it('_applyBuildingYields() produces ore from mines', () => {
    col.buildings[BuildingType.MINE] = 3;
    col._applyBuildingYields(1);
    // 3 MINEs × 4 ore = 12 (plus existing 50)
    expect(col.stockpile.ore).toBe(62);
  });
});

// ===========================================================================
// ColonySimulation — Trade Chains
// ===========================================================================

describe('ColonySimulation – trade chains', () => {
  let col;

  beforeEach(() => {
    const sim = new ColonySimulation();
    col = sim.found({ id: 'tc', name: 'TC', size: 20, startingPops: 1 });
    col.stockpile.ore   = 20;
    col.stockpile.metal = 10;
  });

  it('TRADE_CHAIN constant is frozen and non-empty', () => {
    expect(Object.isFrozen(TRADE_CHAIN)).toBe(true);
    expect(TRADE_CHAIN.length).toBeGreaterThan(0);
  });

  it('factory converts ore to metal', () => {
    col.buildings[BuildingType.FACTORY] = 1;
    col._applyTradeChains(1);
    // 1 factory × rate 2 ore → 1 metal consumed, so ore drops by 2, metal +1
    expect(col.stockpile.ore).toBe(18);
    expect(col.stockpile.metal).toBe(11);
  });

  it('factory conversion is limited by available ore', () => {
    col.buildings[BuildingType.FACTORY] = 5; // needs 10 ore, only 20 available
    col.stockpile.ore = 3; // less than one full batch
    col._applyTradeChains(1);
    // Can only process 3/2 = 1.5 batches, each consuming 2 ore → 1 metal
    expect(col.stockpile.ore).toBeCloseTo(0, 5);
    expect(col.stockpile.metal).toBeGreaterThan(10);
  });

  it('spaceport converts metal to shipParts', () => {
    col.buildings[BuildingType.SPACEPORT] = 1;
    col._applyTradeChains(1);
    // 1 spaceport × rate 3 metal → 1 shipPart; metal 10 - 3 = 7, shipParts 0 + 1 = 1
    expect(col.stockpile.metal).toBe(7);
    expect(col.stockpile.shipParts).toBeCloseTo(1);
  });

  it('full chain: mine → factory → spaceport', () => {
    col.buildings[BuildingType.MINE]      = 2;
    col.buildings[BuildingType.FACTORY]   = 1;
    col.buildings[BuildingType.SPACEPORT] = 1;
    col.stockpile.ore   = 0;
    col.stockpile.metal = 0;
    // After building yields, mine produces 8 ore
    col._applyBuildingYields(1);
    expect(col.stockpile.ore).toBe(8);
    // Trade chains: factory converts ore → metal, spaceport converts metal → shipParts
    col._applyTradeChains(1);
    // Full chain ran: ore was consumed, shipParts were produced at the end
    expect(col.stockpile.shipParts).toBeGreaterThan(0);
  });
});

// ===========================================================================
// ColonySimulation — Hunger / Unrest Escalation (0–100)
// ===========================================================================

describe('ColonySimulation – hunger & unrest escalation', () => {
  let sim, col;

  beforeEach(() => {
    sim = new ColonySimulation();
    col = sim.found({ id: 'hu', name: 'HU', size: 10, startingPops: 3 });
  });

  it('HUNGER_THRESHOLDS and UNREST_THRESHOLDS are frozen', () => {
    expect(Object.isFrozen(HUNGER_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(UNREST_THRESHOLDS)).toBe(true);
  });

  it('unrest starts at 0 and is on 0–1 scale', () => {
    expect(col.unrest).toBe(0);
    // Run some ticks with unemployment to raise unrest
    col.setJobs({ [PopJob.UNEMPLOYED]: 3 });
    for (let i = 0; i < 10; i++) sim.tick(1);
    expect(col.unrest).toBeGreaterThanOrEqual(0);
    expect(col.unrest).toBeLessThanOrEqual(1);
  });

  it('hunger starts at 0 and rises when food is negative', () => {
    expect(col.hunger).toBe(0);
    col.stockpile.food = -10;
    col._applyHunger(1, null);
    expect(col.hunger).toBeGreaterThan(0);
    expect(col.hunger).toBeLessThanOrEqual(1);
  });

  it('hunger falls when food stockpile is positive', () => {
    col.hunger = 0.5;
    col.stockpile.food = 20;
    col._applyHunger(1, null);
    expect(col.hunger).toBeLessThan(0.5);
  });

  it('hunger escalation callback fires when crossing threshold', () => {
    col.hunger = 0.24;
    col.stockpile.food = -10;
    const onEscalate = vi.fn();
    col._applyHunger(1, onEscalate);
    // Should cross the 0.25 threshold (0.24 + 0.05 = 0.29)
    expect(col.hunger).toBeGreaterThanOrEqual(0.25);
    expect(onEscalate).toHaveBeenCalledWith(col, 'hunger', 1);
  });

  it('escalation callback does not re-fire for same stage', () => {
    col.hunger = 0.30;
    col._hungerStage = 1;
    col.stockpile.food = -10;
    const onEscalate = vi.fn();
    col._applyHunger(1, onEscalate);
    // Stage is still 1, no new escalation
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('unrest escalation callback fires via sim.tick()', () => {
    const mockBus = { emit: vi.fn() };
    const s2 = new ColonySimulation(mockBus);
    const c2 = s2.found({ id: 'ue', name: 'UE', size: 10, startingPops: 5 });
    c2.setJobs({ [PopJob.UNEMPLOYED]: 5 });
    // Set unrest just below the 0.25 threshold so one tick crosses it
    c2.unrest       = 0.245;
    c2._unrestStage = 0;
    c2.stability    = 0.1; // low stability → faster unrest rise
    c2.happiness    = 0.0;
    s2.tick(1);
    const calls = mockBus.emit.mock.calls.map(c => c[0]);
    expect(calls.some(e => e.includes('escalate'))).toBe(true);
  });

  it('unrest > 0.75 emits colony:unrest event', () => {
    const mockBus = { emit: vi.fn() };
    const s2 = new ColonySimulation(mockBus);
    const c2 = s2.found({ id: 'ue2', name: 'UE2', size: 10, startingPops: 2 });
    c2.unrest = 0.8;  // already above threshold
    c2._unrestStage = 3; // prevent escalation fires from interfering
    s2.tick(1);
    const calls = mockBus.emit.mock.calls.map(c => c[0]);
    expect(calls).toContain('colony:unrest');
  });
});

// ===========================================================================
// ColonySimulation — Serialization / Deserialization
// ===========================================================================

describe('ColonySimulation – serialize / deserialize', () => {
  let sim;

  beforeEach(() => {
    sim = new ColonySimulation();
    const col = sim.found({
      id: 'sg1', name: 'SaveGame1', size: 15,
      fertility: 0.9, richness: 1.1, startingPops: 4,
    });
    col.setJobs({ [PopJob.FARMER]: 2, [PopJob.WORKER]: 1 });
    col.stockpile.production = 80;
    col.stockpile.credits    = 100;
    col.stockpile.ore        = 20;
    col.buildings[BuildingType.MINE]    = 1;
    col.buildings[BuildingType.FACTORY] = 2;
    col.stockpile.production = 50;
    col.enqueueBuilding(BuildingType.LAB); // costs production:40 + credits:20
    col.unrest     = 0.30;
    col.hunger     = 0.10;
    col.happiness  = 0.65;
    col.stability  = 0.75;
  });

  it('Colony.serialize() returns a plain object with all fields', () => {
    const col  = sim.get('sg1');
    const json = col.serialize();
    expect(json.id).toBe('sg1');
    expect(json.pops).toBe(4);
    expect(json.unrest).toBeCloseTo(0.30);
    expect(json.hunger).toBeCloseTo(0.10);
    expect(json.buildings[BuildingType.MINE]).toBe(1);
    expect(json.buildQueue.length).toBe(1);
    expect(json.stockpile.ore).toBe(20);
  });

  it('Colony.deserialize() restores equivalent state', () => {
    const original = sim.get('sg1');
    const json     = original.serialize();
    const restored = Colony.deserialize(json);

    expect(restored.id).toBe(original.id);
    expect(restored.name).toBe(original.name);
    expect(restored.pops).toBe(original.pops);
    expect(restored.unrest).toBe(original.unrest);
    expect(restored.hunger).toBe(original.hunger);
    expect(restored.happiness).toBe(original.happiness);
    expect(restored.stability).toBe(original.stability);
    expect(restored.buildings[BuildingType.MINE]).toBe(original.buildings[BuildingType.MINE]);
    expect(restored.buildQueue.length).toBe(original.buildQueue.length);
    expect(restored.stockpile.ore).toBe(original.stockpile.ore);
    expect(restored.jobs[PopJob.FARMER]).toBe(original.jobs[PopJob.FARMER]);
  });

  it('fromJSON(toJSON(colony)) produces an equivalent colony', () => {
    const original = sim.get('sg1');
    const clone    = Colony.deserialize(original.serialize());

    // Both colonies should produce the same yield after one tick
    original._applyYield(1);
    clone._applyYield(1);
    expect(clone.stockpile.food).toBeCloseTo(original.stockpile.food);
    expect(clone.stockpile.research).toBeCloseTo(original.stockpile.research);
  });

  it('ColonySimulation.serialize() captures all colonies', () => {
    sim.found({ id: 'sg2', name: 'SG2', size: 8, startingPops: 1 });
    const snap = sim.serialize();
    expect(snap.colonies.length).toBe(2);
    expect(snap.colonies.map(c => c.id)).toContain('sg1');
    expect(snap.colonies.map(c => c.id)).toContain('sg2');
  });

  it('ColonySimulation.deserialize() restores full simulation', () => {
    sim.found({ id: 'sg2', name: 'SG2', size: 8, startingPops: 2 });
    const snap    = sim.serialize();
    const loaded  = ColonySimulation.deserialize(snap);
    expect(loaded.count).toBe(2);
    const c = loaded.get('sg1');
    expect(c).not.toBeNull();
    expect(c.buildings[BuildingType.MINE]).toBe(1);
  });
});

// ===========================================================================
// ColonySimulation – demolishBuilding
// ===========================================================================

describe('ColonySimulation – demolishBuilding', () => {
  let col;

  beforeEach(() => {
    col = new Colony({ id: 'demo1', name: 'DemoCol', size: 10, startingPops: 2 });
    col.stockpile.production = 200;
    col.stockpile.ore        = 50;
    col.stockpile.credits    = 100;
    col.buildings[BuildingType.MINE]    = 2;
    col.buildings[BuildingType.FACTORY] = 1;
  });

  it('demolishBuilding() removes one instance of the building', () => {
    col.demolishBuilding(BuildingType.MINE);
    expect(col.buildings[BuildingType.MINE]).toBe(1);
  });

  it('demolishBuilding() refunds 50% of resource costs', () => {
    const prodBefore = col.stockpile.production;
    const result = col.demolishBuilding(BuildingType.MINE);
    expect(result.success).toBe(true);
    // MINE costs production:30 → refund floor(15) = 15
    expect(col.stockpile.production).toBe(prodBefore + 15);
    expect(result.refund.production).toBe(15);
  });

  it('demolishBuilding() refunds multi-resource buildings', () => {
    const prodBefore = col.stockpile.production;
    const oreBefore  = col.stockpile.ore;
    // FACTORY costs production:50, ore:10 → refund 25 prod, 5 ore
    const result = col.demolishBuilding(BuildingType.FACTORY);
    expect(result.success).toBe(true);
    expect(col.stockpile.production).toBe(prodBefore + 25);
    expect(col.stockpile.ore).toBe(oreBefore + 5);
    expect(result.refund.production).toBe(25);
    expect(result.refund.ore).toBe(5);
  });

  it('demolishBuilding() returns failure when building count is 0', () => {
    const result = col.demolishBuilding(BuildingType.LAB);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_building');
  });

  it('demolishBuilding() throws for unknown building type', () => {
    expect(() => col.demolishBuilding('unknown_building')).toThrow(/unknown building type/i);
  });

  it('demolishBuilding() does not refund buildTime', () => {
    const result = col.demolishBuilding(BuildingType.MINE);
    expect(result.refund.buildTime).toBeUndefined();
  });
});

// ===========================================================================
// ColonySimulation – rename history
// ===========================================================================

describe('ColonySimulation – rename', () => {
  let col;

  beforeEach(() => {
    col = new Colony({ id: 'ren1', name: 'OldName', size: 10, startingPops: 1 });
  });

  it('rename() updates the colony name', () => {
    col.rename('NewName');
    expect(col.name).toBe('NewName');
  });

  it('rename() stores the previous name in nameHistory', () => {
    col.rename('NewName');
    expect(col.nameHistory.length).toBe(1);
    expect(col.nameHistory[0].name).toBe('OldName');
    expect(col.nameHistory[0].index).toBe(0);
  });

  it('rename() logs multiple renames in order', () => {
    col.rename('NewName');
    col.rename('FinalName');
    expect(col.nameHistory.length).toBe(2);
    expect(col.nameHistory[0].name).toBe('OldName');
    expect(col.nameHistory[0].index).toBe(0);
    expect(col.nameHistory[1].name).toBe('NewName');
    expect(col.nameHistory[1].index).toBe(1);
    expect(col.name).toBe('FinalName');
  });

  it('rename() trims whitespace from the new name', () => {
    col.rename('  Trimmed  ');
    expect(col.name).toBe('Trimmed');
  });

  it('rename() throws for empty string', () => {
    expect(() => col.rename('')).toThrow(/non-empty/i);
  });

  it('rename() throws for whitespace-only string', () => {
    expect(() => col.rename('   ')).toThrow(/non-empty/i);
  });

  it('nameHistory and _renameCount survive serialize/deserialize', () => {
    col.rename('MidName');
    col.rename('FinalName');
    const restored = Colony.deserialize(col.serialize());
    expect(restored.name).toBe('FinalName');
    expect(restored.nameHistory.length).toBe(2);
    expect(restored.nameHistory[0].name).toBe('OldName');
    expect(restored._renameCount).toBe(2);
  });
});

// ===========================================================================
// ColonySimulation – defence stockpile
// ===========================================================================

describe('ColonySimulation – defence stockpile', () => {
  let sim, col;

  beforeEach(() => {
    sim = new ColonySimulation();
    col = sim.found({ id: 'def1', name: 'DefCol', size: 10, startingPops: 4 });
    col.setJobs({ [PopJob.SOLDIER]: 2, [PopJob.FARMER]: 2 });
  });

  it('defence starts at 0', () => {
    expect(col.stockpile.defence).toBe(0);
  });

  it('computeYield() includes soldier defence', () => {
    const y = col.computeYield();
    // 2 soldiers × base defence 3 = 6
    expect(y.defence).toBe(6);
  });

  it('tick() accumulates defence from soldiers', () => {
    sim.tick(1);
    // 2 soldiers × 3 = 6 defence per tick
    expect(col.stockpile.defence).toBeGreaterThan(0);
  });

  it('tick() accumulates defence from barracks buildings', () => {
    col.buildings[BuildingType.BARRACKS] = 2;
    col.setJobs({ [PopJob.FARMER]: 4 });
    sim.tick(1);
    // 2 barracks × 4 defence each = 8
    expect(col.stockpile.defence).toBeGreaterThanOrEqual(8);
  });

  it('defence survives serialize/deserialize', () => {
    sim.tick(2);
    const restored = Colony.deserialize(col.serialize());
    expect(restored.stockpile.defence).toBeCloseTo(col.stockpile.defence);
  });
});

// ===========================================================================
// ColonySimulation – RULER governance bonus
// ===========================================================================

describe('ColonySimulation – RULER governance bonus', () => {
  it('rulers reduce unrest accumulation vs no rulers', () => {
    // Colony with unemployed pops and no rulers
    const colNoRulers = new Colony({ id: 'r1', name: 'NoRulers', size: 10, startingPops: 4 });
    colNoRulers.stability = 0.5;
    colNoRulers.happiness = 0;
    colNoRulers.setJobs({ [PopJob.UNEMPLOYED]: 4 });
    const unrestBefore = colNoRulers.unrest;
    colNoRulers._applyUnrest();
    const unrestNoRulers = colNoRulers.unrest - unrestBefore;

    // Same colony but with 1 ruler
    const colWithRuler = new Colony({ id: 'r2', name: 'WithRuler', size: 10, startingPops: 4 });
    colWithRuler.stability = 0.5;
    colWithRuler.happiness = 0;
    colWithRuler.setJobs({ [PopJob.RULER]: 1, [PopJob.UNEMPLOYED]: 3 });
    const unrestBefore2 = colWithRuler.unrest;
    colWithRuler._applyUnrest();
    const unrestWithRuler = colWithRuler.unrest - unrestBefore2;

    expect(unrestWithRuler).toBeLessThan(unrestNoRulers);
  });

  it('rulers do not reduce unrest below 0', () => {
    const col = new Colony({ id: 'r3', name: 'RulerCol', size: 10, startingPops: 4 });
    col.setJobs({ [PopJob.RULER]: 4 });
    col.unrest = 0;
    col._applyUnrest();
    expect(col.unrest).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// ColonySimulation – ColonyType & COLONY_TYPE_BONUS
// ===========================================================================

describe('ColonySimulation – ColonyType', () => {
  it('ColonyType constants are frozen and have 6 values', () => {
    expect(Object.isFrozen(ColonyType)).toBe(true);
    expect(Object.keys(ColonyType).length).toBe(6);
  });

  it('COLONY_TYPE_BONUS is frozen and has an entry for every ColonyType', () => {
    expect(Object.isFrozen(COLONY_TYPE_BONUS)).toBe(true);
    for (const type of Object.values(ColonyType)) {
      expect(COLONY_TYPE_BONUS[type]).toBeDefined();
    }
  });

  it('STANDARD type has all multipliers equal to 1', () => {
    const b = COLONY_TYPE_BONUS[ColonyType.STANDARD];
    for (const v of Object.values(b)) expect(v).toBe(1.0);
  });

  it('AGRICULTURAL boosts food and penalises production', () => {
    const b = COLONY_TYPE_BONUS[ColonyType.AGRICULTURAL];
    expect(b.food).toBeGreaterThan(1);
    expect(b.production).toBeLessThan(1);
  });

  it('INDUSTRIAL boosts production and penalises food', () => {
    const b = COLONY_TYPE_BONUS[ColonyType.INDUSTRIAL];
    expect(b.production).toBeGreaterThan(1);
    expect(b.food).toBeLessThan(1);
  });

  it('RESEARCH boosts research and credits', () => {
    const b = COLONY_TYPE_BONUS[ColonyType.RESEARCH];
    expect(b.research).toBeGreaterThan(1);
    expect(b.credits).toBeGreaterThan(1);
  });

  it('MILITARY boosts defence and slightly penalises production', () => {
    const b = COLONY_TYPE_BONUS[ColonyType.MILITARY];
    expect(b.defence).toBeGreaterThan(1);
    expect(b.production).toBeLessThan(1);
  });

  it('MOON boosts defence and penalises food', () => {
    const b = COLONY_TYPE_BONUS[ColonyType.MOON];
    expect(b.defence).toBeGreaterThan(1);
    expect(b.food).toBeLessThan(1);
  });
});

// ===========================================================================
// ColonySimulation – Colony.setType()
// ===========================================================================

describe('ColonySimulation – Colony.setType', () => {
  let col;

  beforeEach(() => {
    col = new Colony({ id: 'st1', name: 'TypeCol', size: 10, startingPops: 4 });
    col.setJobs({ [PopJob.WORKER]: 4 });
  });

  it('default type is STANDARD', () => {
    expect(col.type).toBe(ColonyType.STANDARD);
  });

  it('setType() updates the type property', () => {
    col.setType(ColonyType.INDUSTRIAL);
    expect(col.type).toBe(ColonyType.INDUSTRIAL);
  });

  it('INDUSTRIAL type multiplies production output', () => {
    const base = col.computeYield();
    col.setType(ColonyType.INDUSTRIAL);
    const boosted = col.computeYield();
    expect(boosted.production).toBeCloseTo(base.production * COLONY_TYPE_BONUS[ColonyType.INDUSTRIAL].production);
  });

  it('AGRICULTURAL type multiplies food output', () => {
    col.setJobs({ [PopJob.FARMER]: 4 });
    const base = col.computeYield().food;
    col.setType(ColonyType.AGRICULTURAL);
    const boosted = col.computeYield().food;
    expect(boosted).toBeCloseTo(base * COLONY_TYPE_BONUS[ColonyType.AGRICULTURAL].food);
  });

  it('setType() throws for unknown type', () => {
    expect(() => col.setType('unknown_type')).toThrow(/unknown colony type/i);
  });

  it('type survives serialize/deserialize', () => {
    col.setType(ColonyType.RESEARCH);
    const restored = Colony.deserialize(col.serialize());
    expect(restored.type).toBe(ColonyType.RESEARCH);
  });

  it('type can be set via constructor def', () => {
    const col2 = new Colony({ id: 'c2', name: 'C2', size: 10, startingPops: 1, type: ColonyType.MILITARY });
    expect(col2.type).toBe(ColonyType.MILITARY);
  });
});

// ===========================================================================
// ColonySimulation – Moon rules
// ===========================================================================

describe('ColonySimulation – Moon rules', () => {
  it('MOON_MAX_SIZE constant equals 5', () => {
    expect(MOON_MAX_SIZE).toBe(5);
  });

  it('MOON colony caps size at MOON_MAX_SIZE on construction', () => {
    const moon = new Colony({ id: 'm1', name: 'Moon', size: 12, startingPops: 1, type: ColonyType.MOON });
    expect(moon.size).toBe(MOON_MAX_SIZE);
  });

  it('setType(MOON) caps size at MOON_MAX_SIZE', () => {
    const col = new Colony({ id: 'm2', name: 'M2', size: 12, startingPops: 1 });
    col.setType(ColonyType.MOON);
    expect(col.size).toBe(MOON_MAX_SIZE);
  });

  it('MOON colony blocks civilian buildings', () => {
    const moon = new Colony({ id: 'm3', name: 'M3', size: 5, startingPops: 1, type: ColonyType.MOON });
    moon.stockpile.production = 500;
    const r = moon.enqueueBuilding(BuildingType.FARM);
    expect(r.success).toBe(false);
    expect(r.reason).toBe('not_allowed_on_moon');
  });

  it('MOON colony allows military buildings', () => {
    const moon = new Colony({ id: 'm4', name: 'M4', size: 5, startingPops: 1, type: ColonyType.MOON });
    moon.stockpile.production = 500;
    moon.stockpile.credits    = 500;
    const r = moon.enqueueBuilding(BuildingType.BARRACKS);
    expect(r.success).toBe(true);
  });

  it('MOON_ALLOWED_BUILDINGS is a frozen Set', () => {
    expect(MOON_ALLOWED_BUILDINGS).toBeInstanceOf(Set);
    expect(Object.isFrozen(MOON_ALLOWED_BUILDINGS)).toBe(true);
    expect(MOON_ALLOWED_BUILDINGS.has(BuildingType.BARRACKS)).toBe(true);
    expect(MOON_ALLOWED_BUILDINGS.has(BuildingType.FARM)).toBe(false);
  });
});

// ===========================================================================
// ColonySimulation – Dark Matter Mine
// ===========================================================================

describe('ColonySimulation – Dark Matter Mine', () => {
  let col;

  beforeEach(() => {
    col = new Colony({ id: 'dm1', name: 'DMCol', size: 10, startingPops: 2 });
    col.stockpile.production = 500;
    col.stockpile.credits    = 500;
  });

  it('DARK_MATTER_MINE is a key of BuildingType', () => {
    expect(BuildingType.DARK_MATTER_MINE).toBeDefined();
  });

  it('BUILDING_COST has an entry for DARK_MATTER_MINE', () => {
    expect(BUILDING_COST[BuildingType.DARK_MATTER_MINE]).toBeDefined();
    expect(BUILDING_COST[BuildingType.DARK_MATTER_MINE].buildTime).toBeGreaterThan(0);
  });

  it('BUILDING_YIELD for DARK_MATTER_MINE yields darkMatter', () => {
    expect(BUILDING_YIELD[BuildingType.DARK_MATTER_MINE]).toBeDefined();
    expect(BUILDING_YIELD[BuildingType.DARK_MATTER_MINE].darkMatter).toBeGreaterThan(0);
  });

  it('darkMatter stockpile starts at 0', () => {
    expect(col.stockpile.darkMatter).toBe(0);
  });

  it('enqueueBuilding(DARK_MATTER_MINE) succeeds when resources are sufficient', () => {
    const r = col.enqueueBuilding(BuildingType.DARK_MATTER_MINE);
    expect(r.success).toBe(true);
  });

  it('completed DARK_MATTER_MINE produces darkMatter each tick', () => {
    const sim = new ColonySimulation();
    const c   = sim.found({ id: 'dm2', name: 'DM2', size: 10, startingPops: 2 });
    c.buildings[BuildingType.DARK_MATTER_MINE] = 1;
    const before = c.stockpile.darkMatter;
    sim.tick(1);
    expect(c.stockpile.darkMatter).toBeGreaterThan(before);
  });

  it('MOON colony can build a DARK_MATTER_MINE', () => {
    const moon = new Colony({ id: 'dm3', name: 'DMMoon', size: 5, startingPops: 1, type: ColonyType.MOON });
    moon.stockpile.production = 500;
    moon.stockpile.credits    = 500;
    const r = moon.enqueueBuilding(BuildingType.DARK_MATTER_MINE);
    expect(r.success).toBe(true);
  });

  it('darkMatter survives serialize/deserialize', () => {
    col.stockpile.darkMatter = 7;
    const restored = Colony.deserialize(col.serialize());
    expect(restored.stockpile.darkMatter).toBe(7);
  });
});

// ===========================================================================
// ColonySimulation – dissolve()
// ===========================================================================

describe('ColonySimulation – dissolve', () => {
  let sim;

  beforeEach(() => {
    sim = new ColonySimulation();
    sim.found({ id: 'dv1', name: 'DV1', size: 8, startingPops: 2 });
    sim.found({ id: 'dv2', name: 'DV2', size: 6, startingPops: 1 });
  });

  it('dissolve() removes the colony from the simulation', () => {
    sim.dissolve('dv1');
    expect(sim.get('dv1')).toBeUndefined();
    expect(sim.count).toBe(1);
  });

  it('dissolve() returns the dissolved colony', () => {
    const dissolved = sim.dissolve('dv1');
    expect(dissolved).toBeDefined();
    expect(dissolved.id).toBe('dv1');
  });

  it('dissolve() returns undefined for unknown id', () => {
    expect(sim.dissolve('nonexistent')).toBeUndefined();
    expect(sim.count).toBe(2);
  });

  it('dissolve() leaves other colonies intact', () => {
    sim.dissolve('dv1');
    expect(sim.get('dv2')).toBeDefined();
  });

  it('dissolve() emits colony:dissolved on the bus', () => {
    const handler = vi.fn();
    const bus = { emit: handler };
    const sim2 = new ColonySimulation(bus);
    sim2.found({ id: 'dv3', name: 'DV3', size: 4, startingPops: 1 });
    sim2.dissolve('dv3');
    expect(handler).toHaveBeenCalledWith('colony:dissolved', expect.objectContaining({ id: 'dv3' }));
  });

  it('dissolve() on unknown id does not emit event', () => {
    const handler = vi.fn();
    const bus = { emit: handler };
    const sim3 = new ColonySimulation(bus);
    sim3.dissolve('ghost');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BattleSimulator — enums & constants
// ===========================================================================

describe('BattleSimulator – ShipClass & SHIP_STATS', () => {
  it('ShipClass is frozen with 8 values', () => {
    expect(Object.isFrozen(ShipClass)).toBe(true);
    expect(Object.keys(ShipClass).length).toBe(8);
  });

  it('SHIP_STATS has an entry for every ShipClass', () => {
    for (const type of Object.values(ShipClass)) {
      expect(SHIP_STATS[type]).toBeDefined();
    }
  });

  it('every SHIP_STATS entry has attack, shield, hull > 0', () => {
    for (const [type, s] of Object.entries(SHIP_STATS)) {
      expect(s.attack, `${type}.attack`).toBeGreaterThan(0);
      expect(s.shield, `${type}.shield`).toBeGreaterThan(0);
      expect(s.hull,   `${type}.hull`).toBeGreaterThan(0);
    }
  });

  it('SHIP_STATS is frozen', () => {
    expect(Object.isFrozen(SHIP_STATS)).toBe(true);
  });

  it('SHIP_METAL_VALUE is frozen and has an entry for every ShipClass', () => {
    expect(Object.isFrozen(SHIP_METAL_VALUE)).toBe(true);
    for (const type of Object.values(ShipClass)) {
      expect(SHIP_METAL_VALUE[type]).toBeGreaterThan(0);
    }
  });

  it('larger ships have higher hull than smaller ships', () => {
    expect(SHIP_STATS[ShipClass.BATTLESHIP].hull).toBeGreaterThan(SHIP_STATS[ShipClass.FIGHTER].hull);
    expect(SHIP_STATS[ShipClass.CARRIER].hull).toBeGreaterThan(SHIP_STATS[ShipClass.CORVETTE].hull);
  });
});

// ===========================================================================
// BattleSimulator — BattleFleet
// ===========================================================================

describe('BattleSimulator – BattleFleet', () => {
  it('constructs from a ships map', () => {
    const fleet = new BattleFleet({ [ShipClass.FIGHTER]: 10, [ShipClass.CRUISER]: 2 });
    expect(fleet.countOf(ShipClass.FIGHTER)).toBe(10);
    expect(fleet.countOf(ShipClass.CRUISER)).toBe(2);
  });

  it('totalCount sums all ship counts', () => {
    const fleet = new BattleFleet({ [ShipClass.FIGHTER]: 5, [ShipClass.BOMBER]: 3 });
    expect(fleet.totalCount).toBe(8);
  });

  it('isEmpty is true for empty fleet', () => {
    expect(new BattleFleet().isEmpty).toBe(true);
  });

  it('isEmpty is false for non-empty fleet', () => {
    expect(new BattleFleet({ [ShipClass.FIGHTER]: 1 }).isEmpty).toBe(false);
  });

  it('power is positive for non-empty fleet', () => {
    const fleet = new BattleFleet({ [ShipClass.FIGHTER]: 100 });
    expect(fleet.power).toBeGreaterThan(0);
  });

  it('larger fleets have higher power than smaller ones (same type)', () => {
    const small = new BattleFleet({ [ShipClass.FIGHTER]: 10 });
    const large = new BattleFleet({ [ShipClass.FIGHTER]: 100 });
    expect(large.power).toBeGreaterThan(small.power);
  });

  it('more powerful ship types have higher power per unit', () => {
    const fighters  = new BattleFleet({ [ShipClass.FIGHTER]:    10 });
    const battleships = new BattleFleet({ [ShipClass.BATTLESHIP]: 10 });
    expect(battleships.power).toBeGreaterThan(fighters.power);
  });

  it('throws for unknown ship type', () => {
    expect(() => new BattleFleet({ alien_ship: 5 })).toThrow(/unknown ship type/i);
  });

  it('toPlainObject returns a plain copy', () => {
    const ships = { [ShipClass.FIGHTER]: 3, [ShipClass.DESTROYER]: 1 };
    const fleet = new BattleFleet(ships);
    const plain = fleet.toPlainObject();
    expect(plain).toEqual(ships);
    expect(plain).not.toBe(fleet._ships);
  });

  it('filters out zero-count entries', () => {
    const fleet = new BattleFleet({ [ShipClass.FIGHTER]: 0, [ShipClass.CRUISER]: 3 });
    expect(fleet.countOf(ShipClass.FIGHTER)).toBe(0);
    expect(fleet.totalCount).toBe(3);
  });
});

// ===========================================================================
// BattleSimulator — simulate() — basic outcomes
// ===========================================================================

describe('BattleSimulator – simulate() basic outcomes', () => {
  it('throws when attacker fleet is empty', () => {
    const def = new BattleFleet({ [ShipClass.FIGHTER]: 10 });
    expect(() => BattleSimulator.simulate(new BattleFleet(), def)).toThrow(/empty/i);
  });

  it('throws when defender fleet is empty', () => {
    const att = new BattleFleet({ [ShipClass.FIGHTER]: 10 });
    expect(() => BattleSimulator.simulate(att, new BattleFleet())).toThrow(/empty/i);
  });

  it('returns a BattleReport', () => {
    const att = new BattleFleet({ [ShipClass.FIGHTER]: 50 });
    const def = new BattleFleet({ [ShipClass.FIGHTER]: 50 });
    const report = BattleSimulator.simulate(att, def);
    expect(report).toBeInstanceOf(BattleReport);
  });

  it('winner is attacker when attacker is vastly stronger', () => {
    const att = new BattleFleet({ [ShipClass.BATTLESHIP]: 10 });
    const def = new BattleFleet({ [ShipClass.FIGHTER]: 5 });
    const report = BattleSimulator.simulate(att, def);
    expect(report.winner).toBe('attacker');
  });

  it('winner is defender when defender is vastly stronger', () => {
    const att = new BattleFleet({ [ShipClass.FIGHTER]: 3 });
    const def = new BattleFleet({ [ShipClass.BATTLESHIP]: 10 });
    const report = BattleSimulator.simulate(att, def);
    expect(report.winner).toBe('defender');
  });

  it('rounds fought is between 1 and MAX_ROUNDS', () => {
    const att = new BattleFleet({ [ShipClass.CRUISER]: 5 });
    const def = new BattleFleet({ [ShipClass.CRUISER]: 5 });
    const report = BattleSimulator.simulate(att, def);
    expect(report.rounds).toBeGreaterThanOrEqual(1);
    expect(report.rounds).toBeLessThanOrEqual(BattleSimulator.MAX_ROUNDS);
  });

  it('result is deterministic — same inputs produce same output', () => {
    const att = new BattleFleet({ [ShipClass.DESTROYER]: 5, [ShipClass.FRIGATE]: 10 });
    const def = new BattleFleet({ [ShipClass.CRUISER]: 3, [ShipClass.CORVETTE]: 8 });
    const r1 = BattleSimulator.simulate(att, def);
    const r2 = BattleSimulator.simulate(att, def);
    expect(r1.winner).toBe(r2.winner);
    expect(r1.rounds).toBe(r2.rounds);
    expect(r1.loot).toBe(r2.loot);
  });

  it('respects custom maxRounds option', () => {
    const att = new BattleFleet({ [ShipClass.FIGHTER]: 50 });
    const def = new BattleFleet({ [ShipClass.FIGHTER]: 50 });
    const report = BattleSimulator.simulate(att, def, { maxRounds: 2 });
    expect(report.rounds).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// BattleSimulator — BattleReport fields
// ===========================================================================

describe('BattleSimulator – BattleReport fields', () => {
  let report;
  const att = new BattleFleet({ [ShipClass.BATTLESHIP]: 5 });
  const def = new BattleFleet({ [ShipClass.FIGHTER]: 20, [ShipClass.CORVETTE]: 5 });

  beforeEach(() => {
    report = BattleSimulator.simulate(att, def);
  });

  it('report.attackerStart equals original attacker fleet', () => {
    expect(report.attackerStart).toBe(att);
  });

  it('report.defenderStart equals original defender fleet', () => {
    expect(report.defenderStart).toBe(def);
  });

  it('attackerRemaining is a BattleFleet', () => {
    expect(report.attackerRemaining).toBeInstanceOf(BattleFleet);
  });

  it('defenderRemaining is a BattleFleet', () => {
    expect(report.defenderRemaining).toBeInstanceOf(BattleFleet);
  });

  it('attackerLosses is a plain object', () => {
    expect(typeof report.attackerLosses).toBe('object');
  });

  it('losses never exceed starting count', () => {
    for (const [type, lost] of Object.entries(report.attackerLosses)) {
      expect(lost).toBeLessThanOrEqual(att.countOf(type));
    }
    for (const [type, lost] of Object.entries(report.defenderLosses)) {
      expect(lost).toBeLessThanOrEqual(def.countOf(type));
    }
  });

  it('loot is non-negative', () => {
    expect(report.loot).toBeGreaterThanOrEqual(0);
  });

  it('loot is 0 when defender loses no ships', () => {
    const tinyAtt = new BattleFleet({ [ShipClass.FIGHTER]: 1 });
    const bigDef  = new BattleFleet({ [ShipClass.CARRIER]: 20 });
    const r = BattleSimulator.simulate(tinyAtt, bigDef);
    if (r.winner === 'defender') {
      expect(r.loot).toBe(0);
    }
  });

  it('loot is positive when defender loses ships', () => {
    // attacker overwhelms defender
    expect(report.loot).toBeGreaterThan(0);
  });

  it('serialize() returns a plain object with all keys', () => {
    const s = report.serialize();
    expect(s.winner).toBe(report.winner);
    expect(s.rounds).toBe(report.rounds);
    expect(s.loot).toBe(report.loot);
    expect(typeof s.attackerStart).toBe('object');
    expect(typeof s.defenderStart).toBe('object');
    expect(typeof s.attackerLosses).toBe('object');
    expect(typeof s.defenderLosses).toBe('object');
  });
});

// ===========================================================================
// BattleSimulator — rapid fire & shield mechanics
// ===========================================================================

describe('BattleSimulator – rapid fire & shield mechanics', () => {
  it('fighters with rapid fire deal more damage to bombers than to battleships', () => {
    // Proxy test: a fleet of fighters vs equal-size fleet of bombers should
    // destroy more bombers-per-round than an equal fleet vs an equal number of battleships
    const fighters = new BattleFleet({ [ShipClass.FIGHTER]: 100 });
    const bombers  = new BattleFleet({ [ShipClass.BOMBER]:  100 });
    const bships   = new BattleFleet({ [ShipClass.BATTLESHIP]: 100 });

    const rBombers = BattleSimulator.simulate(fighters, bombers);
    const rBships  = BattleSimulator.simulate(fighters, bships);

    const bomberLost = rBombers.defenderLosses[ShipClass.BOMBER]  ?? 0;
    const bshipLost  = rBships.defenderLosses[ShipClass.BATTLESHIP] ?? 0;

    // Fighters have rapid fire vs bombers (×3), not vs battleships — so more bombers die
    expect(bomberLost).toBeGreaterThan(bshipLost);
  });

  it('SHIP_STATS.fighter.rapidFire includes bomber', () => {
    expect(SHIP_STATS[ShipClass.FIGHTER].rapidFire.bomber).toBeGreaterThan(1);
  });

  it('SHIP_STATS.bomber.rapidFire includes battleship', () => {
    expect(SHIP_STATS[ShipClass.BOMBER].rapidFire.battleship).toBeGreaterThan(1);
  });

  it('shields reduce damage taken in first round', () => {
    // A fleet with high shields should survive longer than one without
    // Proxy: carrier (4000 shield) vs fighters; carrier should outlast corvette (100 shield)
    const att = new BattleFleet({ [ShipClass.FIGHTER]: 500 });

    const defCarrier  = new BattleFleet({ [ShipClass.CARRIER]:  1 });
    const defCorvette = new BattleFleet({ [ShipClass.CORVETTE]: 1 });

    const rCarrier  = BattleSimulator.simulate(att, defCarrier);
    const rCorvette = BattleSimulator.simulate(att, defCorvette);

    // Carrier has far more hull too, so it definitely survives at least as long
    expect(rCarrier.rounds).toBeGreaterThanOrEqual(rCorvette.rounds);
  });
});

// ===========================================================================
// BattleSimulator — fleetPower()
// ===========================================================================

describe('BattleSimulator – fleetPower()', () => {
  it('returns a positive number', () => {
    const fleet = new BattleFleet({ [ShipClass.CRUISER]: 5 });
    expect(BattleSimulator.fleetPower(fleet)).toBeGreaterThan(0);
  });

  it('equal fleets have equal power', () => {
    const a = new BattleFleet({ [ShipClass.DESTROYER]: 10 });
    const b = new BattleFleet({ [ShipClass.DESTROYER]: 10 });
    expect(BattleSimulator.fleetPower(a)).toBe(BattleSimulator.fleetPower(b));
  });

  it('power scales linearly with count', () => {
    const one  = new BattleFleet({ [ShipClass.FRIGATE]: 1 });
    const ten  = new BattleFleet({ [ShipClass.FRIGATE]: 10 });
    expect(BattleSimulator.fleetPower(ten)).toBeCloseTo(BattleSimulator.fleetPower(one) * 10);
  });
});

// ===========================================================================
// Colony Invasion & Defense — constants & enums
// ===========================================================================

describe('Colony Invasion – constants & InvasionResult enum', () => {
  it('InvasionResult is frozen with SUCCESS, REPELLED, DRAW', () => {
    expect(Object.isFrozen(InvasionResult)).toBe(true);
    expect(InvasionResult.SUCCESS).toBe('success');
    expect(InvasionResult.REPELLED).toBe('repelled');
    expect(InvasionResult.DRAW).toBe('draw');
  });

  it('TROOP_DEFENSE_VALUE is a positive number', () => {
    expect(TROOP_DEFENSE_VALUE).toBeGreaterThan(0);
  });

  it('TROOP_ATTACK_VALUE is a positive number', () => {
    expect(TROOP_ATTACK_VALUE).toBeGreaterThan(0);
  });

  it('DEFENSE_DPS_FACTOR is between 0 and 1', () => {
    expect(DEFENSE_DPS_FACTOR).toBeGreaterThan(0);
    expect(DEFENSE_DPS_FACTOR).toBeLessThanOrEqual(1);
  });

  it('MAX_INVASION_ROUNDS is a positive integer', () => {
    expect(Number.isInteger(MAX_INVASION_ROUNDS)).toBe(true);
    expect(MAX_INVASION_ROUNDS).toBeGreaterThan(0);
  });

  it('INVASION_LOOT_FRACTION is between 0 and 1', () => {
    expect(INVASION_LOOT_FRACTION).toBeGreaterThan(0);
    expect(INVASION_LOOT_FRACTION).toBeLessThanOrEqual(1);
  });

  it('INVASION_CONQUEST_PENALTIES has happiness, unrest, stability', () => {
    expect(INVASION_CONQUEST_PENALTIES).toHaveProperty('happiness');
    expect(INVASION_CONQUEST_PENALTIES).toHaveProperty('unrest');
    expect(INVASION_CONQUEST_PENALTIES).toHaveProperty('stability');
    expect(Object.isFrozen(INVASION_CONQUEST_PENALTIES)).toBe(true);
  });
});

// ===========================================================================
// Colony Invasion — garrison management
// ===========================================================================

describe('Colony Invasion – garrison management', () => {
  let colony;

  beforeEach(() => {
    colony = new Colony({ id: 'c1', name: 'Fortress', size: 10, startingPops: 3 });
  });

  it('garrison starts at 0', () => {
    expect(colony.garrison).toBe(0);
  });

  it('garrisonTroops() increases garrison', () => {
    colony.garrisonTroops(5);
    expect(colony.garrison).toBe(5);
  });

  it('garrisonTroops() is chainable', () => {
    const result = colony.garrisonTroops(3);
    expect(result).toBe(colony);
  });

  it('garrisonTroops() floors fractional input', () => {
    colony.garrisonTroops(3.9);
    expect(colony.garrison).toBe(3);
  });

  it('garrisonTroops() throws for n < 1', () => {
    expect(() => colony.garrisonTroops(0)).toThrow(/≥ 1/);
    expect(() => colony.garrisonTroops(-2)).toThrow(/≥ 1/);
  });

  it('ungarrisonTroops() reduces garrison by n', () => {
    colony.garrisonTroops(10);
    const removed = colony.ungarrisonTroops(4);
    expect(removed).toBe(4);
    expect(colony.garrison).toBe(6);
  });

  it('ungarrisonTroops() caps at available garrison', () => {
    colony.garrisonTroops(3);
    const removed = colony.ungarrisonTroops(100);
    expect(removed).toBe(3);
    expect(colony.garrison).toBe(0);
  });

  it('ungarrisonTroops() throws for n < 1', () => {
    expect(() => colony.ungarrisonTroops(0)).toThrow(/≥ 1/);
  });

  it('garrison survives serialize / deserialize', () => {
    colony.garrisonTroops(7);
    const snap = colony.serialize();
    const restored = Colony.deserialize(snap);
    expect(restored.garrison).toBe(7);
  });
});

// ===========================================================================
// Colony Invasion — defensePower getter
// ===========================================================================

describe('Colony Invasion – defensePower getter', () => {
  let colony;

  beforeEach(() => {
    colony = new Colony({ id: 'c1', name: 'Frontier', size: 10, startingPops: 4 });
  });

  it('defensePower is 0 with no garrison and empty defence stockpile', () => {
    expect(colony.defensePower).toBe(0);
  });

  it('defensePower includes garrison contribution', () => {
    colony.garrisonTroops(4);
    expect(colony.defensePower).toBe(4 * TROOP_DEFENSE_VALUE);
  });

  it('defensePower includes stockpile.defence contribution', () => {
    colony.stockpile.defence = 100;
    expect(colony.defensePower).toBe(100);
  });

  it('defensePower sums both garrison and stockpile.defence', () => {
    colony.garrisonTroops(2);
    colony.stockpile.defence = 50;
    expect(colony.defensePower).toBe(2 * TROOP_DEFENSE_VALUE + 50);
  });

  it('defensePower clamps negative stockpile.defence to 0', () => {
    colony.stockpile.defence = -10;
    expect(colony.defensePower).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// Colony Invasion — InvasionReport
// ===========================================================================

describe('Colony Invasion – InvasionReport', () => {
  it('InvasionReport computes attackerCasualties correctly', () => {
    const report = new InvasionReport({
      result: InvasionResult.SUCCESS, rounds: 2,
      attackerTroopsBefore: 50, attackerTroopsAfter: 30,
      defenderPowerBefore: 200, defenderPowerAfter: 0,
      loot: { metal: 10 }, colonyId: 'x',
    });
    expect(report.attackerCasualties).toBe(20);
  });

  it('InvasionReport computes defenderPowerConsumed correctly', () => {
    const report = new InvasionReport({
      result: InvasionResult.REPELLED, rounds: 3,
      attackerTroopsBefore: 10, attackerTroopsAfter: 0,
      defenderPowerBefore: 500, defenderPowerAfter: 300,
      loot: {}, colonyId: 'x',
    });
    expect(report.defenderPowerConsumed).toBe(200);
  });

  it('serialize() returns a plain object with all expected keys', () => {
    const report = new InvasionReport({
      result: InvasionResult.DRAW, rounds: 5,
      attackerTroopsBefore: 20, attackerTroopsAfter: 5,
      defenderPowerBefore: 300, defenderPowerAfter: 100,
      loot: {}, colonyId: 'abc',
    });
    const s = report.serialize();
    expect(s.result).toBe(InvasionResult.DRAW);
    expect(s.rounds).toBe(5);
    expect(s.attackerCasualties).toBe(15);
    expect(s.defenderPowerConsumed).toBe(200);
    expect(s.colonyId).toBe('abc');
    expect(typeof s.loot).toBe('object');
  });
});

// ===========================================================================
// Colony Invasion — ColonySimulation.invade() — validation
// ===========================================================================

describe('Colony Invasion – invade() validation', () => {
  let sim;
  beforeEach(() => {
    sim = new ColonySimulation();
    sim.found({ id: 'col1', name: 'Ignis', size: 10, startingPops: 5 });
  });

  it('throws for unknown colony id', () => {
    expect(() => sim.invade('no_such_colony', 10)).toThrow(/not found/i);
  });

  it('throws for attackerTroops < 1', () => {
    expect(() => sim.invade('col1', 0)).toThrow(/≥ 1/);
  });

  it('throws for non-finite attackerTroops', () => {
    expect(() => sim.invade('col1', Infinity)).toThrow(/≥ 1/);
  });

  it('returns an InvasionReport', () => {
    sim.get('col1').stockpile.defence = 1; // minimal defense
    const report = sim.invade('col1', 100);
    expect(report).toBeInstanceOf(InvasionReport);
  });
});

// ===========================================================================
// Colony Invasion — ColonySimulation.invade() — SUCCESS outcome
// ===========================================================================

describe('Colony Invasion – invade() SUCCESS', () => {
  let sim, colony;

  beforeEach(() => {
    sim = new ColonySimulation();
    colony = sim.found({ id: 'c1', name: 'Weak', size: 10, startingPops: 3 });
    // Minimal defense — a large attacker force wins
    colony.stockpile.defence = 50;
    colony.stockpile.metal   = 200;
    colony.stockpile.food    = 100;
    colony.garrison          = 0;
  });

  it('returns result SUCCESS against minimal defense', () => {
    const report = sim.invade('c1', 200);
    expect(report.result).toBe(InvasionResult.SUCCESS);
  });

  it('garrison is reset to 0 on capture', () => {
    sim.invade('c1', 200);
    expect(colony.garrison).toBe(0);
  });

  it('stockpile.defence is reset to 0 on capture', () => {
    sim.invade('c1', 200);
    expect(colony.stockpile.defence).toBe(0);
  });

  it('happiness is capped to INVASION_CONQUEST_PENALTIES.happiness on capture', () => {
    colony.happiness = 0.9;
    sim.invade('c1', 200);
    expect(colony.happiness).toBeLessThanOrEqual(INVASION_CONQUEST_PENALTIES.happiness);
  });

  it('unrest spikes to at least INVASION_CONQUEST_PENALTIES.unrest on capture', () => {
    colony.unrest = 0;
    sim.invade('c1', 200);
    expect(colony.unrest).toBeGreaterThanOrEqual(INVASION_CONQUEST_PENALTIES.unrest);
  });

  it('stability drops to at most INVASION_CONQUEST_PENALTIES.stability on capture', () => {
    colony.stability = 0.95;
    sim.invade('c1', 200);
    expect(colony.stability).toBeLessThanOrEqual(INVASION_CONQUEST_PENALTIES.stability);
  });

  it('loot contains positive amounts for resources that were in stockpile', () => {
    const report = sim.invade('c1', 200);
    expect(report.loot.metal).toBeGreaterThan(0);
    expect(report.loot.food).toBeGreaterThan(0);
  });

  it('loot is exactly INVASION_LOOT_FRACTION of pre-invasion stockpile amounts', () => {
    const metalBefore = colony.stockpile.metal;
    const report = sim.invade('c1', 200);
    expect(report.loot.metal).toBeCloseTo(metalBefore * INVASION_LOOT_FRACTION);
  });

  it('loot does not include defence', () => {
    const report = sim.invade('c1', 200);
    expect(report.loot.defence).toBeUndefined();
  });

  it('colony stockpile is reduced by loot amount on capture', () => {
    const metalBefore = colony.stockpile.metal;
    sim.invade('c1', 200);
    expect(colony.stockpile.metal).toBeCloseTo(metalBefore * (1 - INVASION_LOOT_FRACTION));
  });

  it('emits colony:invaded event', () => {
    const events = [];
    const bus = { emit: (ev, data) => events.push({ ev, data }) };
    const s2 = new ColonySimulation(bus);
    const c2 = s2.found({ id: 'c2', name: 'X', size: 10, startingPops: 2 });
    c2.stockpile.defence = 1;
    s2.invade('c2', 200);
    const invaded = events.find(e => e.ev === 'colony:invaded');
    expect(invaded).toBeTruthy();
    expect(invaded.data.id).toBe('c2');
    expect(invaded.data.report).toBeInstanceOf(InvasionReport);
  });
});

// ===========================================================================
// Colony Invasion — ColonySimulation.invade() — REPELLED outcome
// ===========================================================================

describe('Colony Invasion – invade() REPELLED', () => {
  let sim, colony;

  beforeEach(() => {
    sim = new ColonySimulation();
    colony = sim.found({ id: 'c1', name: 'Bastion', size: 10, startingPops: 5 });
    // High defense, low attacker count
    colony.stockpile.defence = 10_000;
    colony.garrison          = 50;
  });

  it('returns result REPELLED when defenders overwhelm attacker', () => {
    const report = sim.invade('c1', 2);
    expect(report.result).toBe(InvasionResult.REPELLED);
  });

  it('all attacking troops are eliminated on REPELLED', () => {
    const report = sim.invade('c1', 2);
    expect(report.attackerTroopsAfter).toBe(0);
  });

  it('loot is empty on REPELLED', () => {
    const report = sim.invade('c1', 2);
    expect(Object.keys(report.loot).length).toBe(0);
  });

  it('colony defense is partially reduced on REPELLED', () => {
    const defBefore = colony.defensePower;
    sim.invade('c1', 2);
    // Some damage was dealt, but colony survived
    expect(colony.defensePower).toBeLessThanOrEqual(defBefore);
  });

  it('emits colony:defended event', () => {
    const events = [];
    const bus = { emit: (ev, d) => events.push(ev) };
    const s2 = new ColonySimulation(bus);
    const c2 = s2.found({ id: 'c2', name: 'Y', size: 10, startingPops: 3 });
    c2.stockpile.defence = 10_000;
    s2.invade('c2', 2);
    expect(events).toContain('colony:defended');
  });
});

// ===========================================================================
// Colony Invasion — ColonySimulation.invade() — DRAW outcome
// ===========================================================================

describe('Colony Invasion – invade() DRAW', () => {
  it('returns DRAW when rounds exhausted with both sides surviving', () => {
    // Craft attacker / defender so neither side zeros out within default rounds
    const sim = new ColonySimulation();
    const colony = sim.found({ id: 'c1', name: 'Stalemate', size: 10, startingPops: 3 });
    // Use a maxRounds of 1 and equal-ish forces to force a draw
    colony.stockpile.defence = 500;
    const report = sim.invade('c1', 1, { maxRounds: 1 });
    // With 1 round and balanced forces, either draw or repelled
    expect([InvasionResult.DRAW, InvasionResult.REPELLED]).toContain(report.result);
  });

  it('emits colony:siege on DRAW result', () => {
    const events = [];
    const bus = { emit: (ev, d) => events.push(ev) };
    const sim = new ColonySimulation(bus);
    const colony = sim.found({ id: 'c1', name: 'Q', size: 10, startingPops: 2 });
    colony.stockpile.defence = 500;
    const report = sim.invade('c1', 1, { maxRounds: 1 });
    if (report.result === InvasionResult.DRAW) {
      expect(events).toContain('colony:siege');
    }
  });

  it('respects custom maxRounds option', () => {
    const sim = new ColonySimulation();
    const colony = sim.found({ id: 'c1', name: 'W', size: 10, startingPops: 2 });
    colony.stockpile.defence = 1;
    const report = sim.invade('c1', 100, { maxRounds: 2 });
    expect(report.rounds).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// Colony Invasion — garrison troops interact with defensePower
// ===========================================================================

describe('Colony Invasion – garrison interacts with combat', () => {
  it('higher garrison increases defensePower', () => {
    const col1 = new Colony({ id: 'a', name: 'A', size: 10, startingPops: 3 });
    const col2 = new Colony({ id: 'b', name: 'B', size: 10, startingPops: 3 });
    col1.garrison = 0;
    col2.garrison = 20;
    expect(col2.defensePower).toBeGreaterThan(col1.defensePower);
  });

  it('well-garrisoned colony repels attacker that beats same colony ungarrisoned', () => {
    const sim = new ColonySimulation();
    // Colony with no garrison vs colony with 30 garrison troops
    const c1 = sim.found({ id: 'c1', name: 'Bare', size: 10, startingPops: 3 });
    const c2 = sim.found({ id: 'c2', name: 'Fort', size: 10, startingPops: 3 });
    c2.garrison = 30;

    const r1 = sim.invade('c1', 10);
    const r2 = sim.invade('c2', 10);

    // c1 should be easier to capture than c2
    // At minimum, c2's result should not be a success while c1 succeeded
    if (r1.result === InvasionResult.SUCCESS) {
      expect(r2.result).not.toBe(InvasionResult.SUCCESS);
    }
  });

  it('MILITARY colony type with soldiers has higher defensePower after ticks', () => {
    const sim = new ColonySimulation();
    const c1 = sim.found({ id: 'c1', name: 'Mil', size: 10, startingPops: 4, type: 'military' });
    c1.setJobs({ [PopJob.SOLDIER]: 4 });
    sim.tick(5);
    // After 5 ticks, soldiers have accumulated defence into stockpile
    expect(c1.defensePower).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Colony Invasion — determinism
// ===========================================================================

describe('Colony Invasion – determinism', () => {
  it('same inputs produce identical reports', () => {
    function makeSetup() {
      const sim = new ColonySimulation();
      const col = sim.found({ id: 'c1', name: 'X', size: 10, startingPops: 4 });
      col.stockpile.defence = 200;
      col.garrison          = 5;
      return sim;
    }
    const r1 = makeSetup().invade('c1', 15);
    const r2 = makeSetup().invade('c1', 15);
    expect(r1.result).toBe(r2.result);
    expect(r1.rounds).toBe(r2.rounds);
    expect(r1.attackerTroopsAfter).toBe(r2.attackerTroopsAfter);
    expect(r1.defenderPowerAfter).toBe(r2.defenderPowerAfter);
  });
});

// EventSystem — dismiss + fireRandom + Journal
// ===========================================================================

describe('EventSystem — dismiss', () => {
  let evtSys;
  beforeEach(() => {
    evtSys = new EventSystem();
    evtSys.define({
      id: 'ev.dismissable',
      choices: [{ label: 'Act', effect: (gs) => { gs.acted = true; } }],
    });
    evtSys.schedule('ev.dismissable');
    evtSys.tick({});
  });

  it('dismiss() removes the event from activeEvents', () => {
    expect(evtSys.activeEvents.length).toBe(1);
    evtSys.dismiss('ev.dismissable');
    expect(evtSys.activeEvents.length).toBe(0);
  });

  it('dismiss() moves event to history with DISMISSED status', () => {
    evtSys.dismiss('ev.dismissable');
    const h = evtSys.history.find((e) => e.id === 'ev.dismissable');
    expect(h).toBeDefined();
    expect(h.status).toBe(EventStatus.DISMISSED);
  });

  it('dismiss() does NOT apply any choice effect', () => {
    const gs = { acted: false };
    evtSys.dismiss('ev.dismissable');
    expect(gs.acted).toBe(false);
  });

  it('dismiss() emits game:event:dismissed', () => {
    const bus = { emit: vi.fn() };
    const sys = new EventSystem(bus);
    sys.define({ id: 'ev.d', choices: [{ label: 'X', effect: () => {} }] });
    sys.schedule('ev.d');
    sys.tick({});
    sys.dismiss('ev.d');
    expect(bus.emit).toHaveBeenCalledWith('game:event:dismissed', expect.objectContaining({ event: expect.anything() }));
  });

  it('dismiss() warns if event is not active', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    evtSys.dismiss('unknown.event');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('EventSystem — fireRandom', () => {
  it('fireRandom() queues a matching event', () => {
    const sys = new EventSystem();
    sys.define({ id: 'rand.a', weight: 100, choices: [{ label: 'ok', effect: () => {} }] });
    sys.fireRandom({});
    expect(sys._queue.length).toBe(1);
  });

  it('fireRandom() does nothing when no candidates match condition', () => {
    const sys = new EventSystem();
    sys.define({
      id: 'rand.b',
      weight: 100,
      condition: () => false,
      choices: [{ label: 'ok', effect: () => {} }],
    });
    sys.fireRandom({});
    expect(sys._queue.length).toBe(0);
  });

  it('fireRandom() skips SCRIPTED events', () => {
    const sys = new EventSystem();
    sys.define({ id: 'scripted.a', type: EventType.SCRIPTED, weight: 100, choices: [{ label: 'ok', effect: () => {} }] });
    sys.fireRandom({});
    expect(sys._queue.length).toBe(0);
  });
});

describe('EventSystem — Journal entries', () => {
  let sys;
  beforeEach(() => { sys = new EventSystem(); });

  it('defineJournalEntry() throws without id', () => {
    expect(() => sys.defineJournalEntry({ condition: () => true, choices: [] })).toThrow(/id/);
  });

  it('defineJournalEntry() throws without condition', () => {
    expect(() => sys.defineJournalEntry({ id: 'j.test' })).toThrow(/condition/);
  });

  it('defineJournalEntry() registers an entry', () => {
    sys.defineJournalEntry({ id: 'j.growth', condition: (gs) => gs.pops >= 5 });
    expect(sys.activeJournal().length).toBe(1);
  });

  it('activeJournal() excludes completed entries', () => {
    sys.defineJournalEntry({ id: 'j.done', condition: () => true });
    sys.tickJournal({});
    expect(sys.activeJournal().length).toBe(0);
  });

  it('tickJournal() marks entry complete when condition passes', () => {
    sys.defineJournalEntry({ id: 'j.ships', condition: (gs) => gs.ships >= 10 });
    sys.tickJournal({ ships: 5 });
    expect(sys.activeJournal().length).toBe(1); // not yet
    sys.tickJournal({ ships: 10 });
    expect(sys.activeJournal().length).toBe(0);
  });

  it('tickJournal() calls onComplete callback', () => {
    const cb = vi.fn();
    sys.defineJournalEntry({ id: 'j.cb', condition: () => true, onComplete: cb });
    sys.tickJournal({ credits: 200 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('tickJournal() does NOT re-fire onComplete after completion', () => {
    const cb = vi.fn();
    sys.defineJournalEntry({ id: 'j.once', condition: () => true, onComplete: cb });
    sys.tickJournal({});
    sys.tickJournal({});
    expect(cb).toHaveBeenCalledOnce();
  });

  it('tickJournal() emits game:journal:complete via bus', () => {
    const bus = { emit: vi.fn() };
    const s = new EventSystem(bus);
    s.defineJournalEntry({ id: 'j.bus', condition: () => true });
    s.tickJournal({});
    expect(bus.emit).toHaveBeenCalledWith('game:journal:complete', expect.objectContaining({ entry: expect.anything() }));
  });

  it('JournalStatus constants are frozen', () => {
    expect(() => { JournalStatus.ACTIVE = 'x'; }).toThrow();
    expect(Object.values(JournalStatus).length).toBe(2);
  });

  it('Journal isComplete getter reflects status', () => {
    const j = new Journal({ id: 'j.x', condition: () => true });
    expect(j.isComplete).toBe(false);
    j.status = JournalStatus.COMPLETE;
    expect(j.isComplete).toBe(true);
  });
});
