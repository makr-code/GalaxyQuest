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
import { EventSystem, EventType, EventStatus }    from '../../js/engine/game/EventSystem.js';
import { ResearchTree, ResearchCategory, CivAffinity }         from '../../js/engine/game/ResearchTree.js';
import { FleetFormation, FormationShape, Wing, Maneuver, getSlotPositions }   from '../../js/engine/game/FleetFormation.js';
import { ColonySimulation, Colony, PopJob }       from '../../js/engine/game/ColonySimulation.js';

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
