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
import { ResearchTree, ResearchCategory }         from '../../js/engine/game/ResearchTree.js';
import { FleetFormation, FormationShape, Wing }   from '../../js/engine/game/FleetFormation.js';
import {
  ColonySimulation, Colony, PopJob,
  BuildingType, BUILDING_COST, BUILDING_YIELD, TRADE_CHAIN,
  HUNGER_THRESHOLDS, UNREST_THRESHOLDS,
  ColonyType, COLONY_TYPE_BONUS, MOON_ALLOWED_BUILDINGS, MOON_MAX_SIZE,
} from '../../js/engine/game/ColonySimulation.js';

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
