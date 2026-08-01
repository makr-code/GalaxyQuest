/**
 * War Domain Tests
 * Tests for WarController, WarUI, and WarCalculations
 * Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarController, WarCalculations } from '../js/engine/runtime/domains/war/WarController.js';
import { WarUI } from '../js/engine/runtime/domains/war/WarUI.js';
import { initializeWarDomain } from '../js/engine/runtime/domains/war/war__exports.js';

describe('WarController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
    };

    controller = new WarController({
      eventBus: mockEventBus,
      repository: null,
      logger: console,
    });
  });

  describe('declareWar', () => {
    it('should declare war between two factions', () => {
      controller.declareWar('PlayerFaction', 'NPCFaction', 'Territorial dispute');

      const conflicts = controller.getAllConflicts();
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].factionA).toBe('PlayerFaction');
      expect(conflicts[0].factionB).toBe('NPCFaction');
      expect(conflicts[0].status).toBe('active');
    });

    it('should emit conflict-declared event', () => {
      controller.declareWar('PlayerFaction', 'NPCFaction');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'war:conflict-declared',
        expect.objectContaining({
          factionA: 'PlayerFaction',
          factionB: 'NPCFaction',
        })
      );
    });

    it('should throw error if war system is locked', () => {
      controller.lock();

      expect(() => {
        controller.declareWar('PlayerFaction', 'NPCFaction');
      }).toThrow('War system is locked');
    });

    it('should add to active conflicts list', () => {
      controller.declareWar('Faction A', 'Faction B');

      const activeConflicts = controller.getActiveConflicts();
      expect(activeConflicts.length).toBe(1);
      expect(activeConflicts[0].status).toBe('active');
    });
  });

  describe('signPeaceTreaty', () => {
    beforeEach(() => {
      controller.declareWar('PlayerFaction', 'NPCFaction');
    });

    it('should sign peace treaty between conflicting factions', () => {
      controller.signPeaceTreaty('PlayerFaction', 'NPCFaction', 30);

      const state = controller.getState();
      expect(Object.keys(state.peaceTreaties).length).toBe(1);
    });

    it('should conclude conflict when peace is signed', () => {
      controller.signPeaceTreaty('PlayerFaction', 'NPCFaction');

      const activeConflicts = controller.getActiveConflicts();
      expect(activeConflicts.length).toBe(0);
    });

    it('should emit peace-signed event', () => {
      controller.signPeaceTreaty('PlayerFaction', 'NPCFaction', 30);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'war:peace-signed',
        expect.objectContaining({
          factions: ['PlayerFaction', 'NPCFaction'],
          duration: 30,
        })
      );
    });

    it('should throw error if no active conflict exists', () => {
      expect(() => {
        controller.signPeaceTreaty('FactionX', 'FactionY');
      }).toThrow('No active conflict between these factions');
    });
  });

  describe('addWarGoal', () => {
    beforeEach(() => {
      controller.declareWar('PlayerFaction', 'NPCFaction');
    });

    it('should add war goal to conflict', () => {
      const conflicts = controller.getAllConflicts();
      const conflictId = conflicts[0].id;

      controller.addWarGoal(conflictId, 'capture_territory', 'territory_1', 5000);

      const state = controller.getState();
      const goals = Object.values(state.warGoals);
      expect(goals.length).toBe(1);
      expect(goals[0].type).toBe('capture_territory');
      expect(goals[0].reward).toBe(5000);
    });

    it('should emit goal-added event', () => {
      const conflicts = controller.getAllConflicts();
      const conflictId = conflicts[0].id;

      controller.addWarGoal(conflictId, 'destroy_fleet', 'fleet_1', 2000);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'war:goal-added',
        expect.objectContaining({
          type: 'destroy_fleet',
          reward: 2000,
        })
      );
    });
  });

  describe('simulateBattle', () => {
    it('should simulate battle outcome', () => {
      const attacker = {
        factionId: 'PlayerFaction',
        strength: 500,
        shipCount: 20,
        ships: Array(20).fill({ class: 'cruiser' }),
      };

      const defender = {
        factionId: 'NPCFaction',
        strength: 300,
        shipCount: 15,
        ships: Array(15).fill({ class: 'destroyer' }),
      };

      const outcome = controller.simulateBattle(attacker, defender);

      expect(outcome).toHaveProperty('victor');
      expect(['attacker', 'defender']).toContain(outcome.victor);
      expect(outcome.attackerCasualties.ships).toBeGreaterThanOrEqual(0);
      expect(outcome.defenderCasualties.ships).toBeGreaterThanOrEqual(0);
    });

    it('should record casualties in faction data', () => {
      const attacker = {
        factionId: 'PlayerFaction',
        strength: 500,
        shipCount: 20,
        ships: Array(20).fill({ class: 'cruiser' }),
      };

      const defender = {
        factionId: 'NPCFaction',
        strength: 300,
        shipCount: 15,
        ships: Array(15).fill({ class: 'destroyer' }),
      };

      controller.simulateBattle(attacker, defender);

      const casualties = controller.getCasualties('PlayerFaction');
      expect(casualties.ships).toBeGreaterThanOrEqual(0);
    });

    it('should emit battle-concluded event', () => {
      const attacker = { factionId: 'A', strength: 500, shipCount: 20, ships: [] };
      const defender = { factionId: 'B', strength: 300, shipCount: 15, ships: [] };

      controller.simulateBattle(attacker, defender);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'war:battle-concluded',
        expect.objectContaining({
          attacker: 'A',
          defender: 'B',
        })
      );
    });
  });

  describe('getFactionRelations', () => {
    it('should return relations for faction', () => {
      controller.declareWar('Faction A', 'Faction B');

      const relations = controller.getFactionRelations('Faction A');
      expect(relations['Faction B']).toBe('war');
    });

    it('should distinguish between war and peace status', () => {
      controller.declareWar('Faction A', 'Faction B');
      controller.signPeaceTreaty('Faction A', 'Faction B');

      const relations = controller.getFactionRelations('Faction A');
      expect(relations['Faction B']).toBe('peace_treaty');
    });
  });

  describe('lock/unlock', () => {
    it('should prevent changes when locked', () => {
      controller.lock();

      expect(() => {
        controller.declareWar('A', 'B');
      }).toThrow('War system is locked');
    });

    it('should allow changes when unlocked', () => {
      controller.lock();
      controller.unlock();

      expect(() => {
        controller.declareWar('A', 'B');
      }).not.toThrow();
    });

    it('should emit locked/unlocked events', () => {
      controller.lock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('war:locked', {});

      controller.unlock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('war:unlocked', {});
    });
  });
});

describe('WarCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new WarCalculations();
  });

  describe('calculateBattleOutcome', () => {
    it('should return victor, casualties, and margin', () => {
      const attacker = { strength: 500, shipCount: 20 };
      const defender = { strength: 300, shipCount: 15 };

      const outcome = calc.calculateBattleOutcome(attacker, defender);

      expect(outcome).toHaveProperty('victor');
      expect(outcome).toHaveProperty('attackerCasualties');
      expect(outcome).toHaveProperty('defenderCasualties');
      expect(outcome).toHaveProperty('victoryMarginPercent');
    });

    it('should favor stronger attacker', () => {
      const attacker = { strength: 1000, shipCount: 50 };
      const defender = { strength: 100, shipCount: 5 };

      // Run multiple times to check probability
      let attackerVictories = 0;
      for (let i = 0; i < 10; i++) {
        const outcome = calc.calculateBattleOutcome(attacker, defender);
        if (outcome.victor === 'attacker') attackerVictories++;
      }

      expect(attackerVictories).toBeGreaterThan(5); // Should win most
    });
  });

  describe('calculateFleetStrength', () => {
    it('should calculate strength from ship classes', () => {
      const fleet = {
        ships: [
          { class: 'fighter' },
          { class: 'cruiser' },
          { class: 'battleship' },
        ],
      };

      const strength = calc.calculateFleetStrength(fleet);
      expect(strength).toBe(10 + 100 + 400); // 510
    });

    it('should return 0 for empty fleet', () => {
      const fleet = { ships: [] };

      const strength = calc.calculateFleetStrength(fleet);
      expect(strength).toBe(0);
    });
  });

  describe('calculateReparations', () => {
    it('should scale reparations by victor strength', () => {
      const baseIncome = 1000;

      const lowVictory = calc.calculateReparations(100, { totalIncome: baseIncome });
      const highVictory = calc.calculateReparations(2000, { totalIncome: baseIncome });

      expect(highVictory).toBeGreaterThan(lowVictory);
    });
  });

  describe('calculateTributePct', () => {
    it('should cap tribute at 50%', () => {
      const tribute = calc.calculateTributePct(10000, 1);
      expect(tribute).toBeLessThanOrEqual(50);
    });

    it('should scale with strength ratio', () => {
      const lowRatio = calc.calculateTributePct(100, 100);
      const highRatio = calc.calculateTributePct(1000, 100);

      expect(highRatio).toBeGreaterThanOrEqual(lowRatio);
    });
  });
});

describe('War Domain Integration', () => {
  it('should initialize war domain with all methods', async () => {
    const domain = await initializeWarDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    expect(domain.name).toBe('war');
    expect(typeof domain.declareWar).toBe('function');
    expect(typeof domain.signPeaceTreaty).toBe('function');
    expect(typeof domain.simulateBattle).toBe('function');
    expect(typeof domain.getState).toBe('function');
  });

  it('should manage complete war workflow', async () => {
    const domain = await initializeWarDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    // Declare war
    domain.declareWar('PlayerFaction', 'NPCFaction', 'Power grab');
    expect(domain.getActiveConflicts().length).toBe(1);

    // Add war goal
    const conflict = domain.getActiveConflicts()[0];
    domain.addWarGoal(conflict.id, 'destroy_fleet', 'fleet_123', 5000);

    // Simulate battle
    const outcome = domain.simulateBattle(
      { factionId: 'PlayerFaction', strength: 500, shipCount: 20, ships: [] },
      { factionId: 'NPCFaction', strength: 300, shipCount: 15, ships: [] }
    );
    expect(['attacker', 'defender']).toContain(outcome.victor);

    // Sign peace
    domain.signPeaceTreaty('PlayerFaction', 'NPCFaction');
    expect(domain.getActiveConflicts().length).toBe(0);
  });
});
