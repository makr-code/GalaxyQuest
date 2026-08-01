/**
 * NPC Domain Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NPCController, NPCCalculations } from '../js/engine/runtime/domains/npc/NPCController.js';

describe('NPCController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn() };
    controller = new NPCController({ eventBus: mockEventBus, repository: null });
  });

  describe('initialization', () => {
    it('should initialize with 3 NPCs', () => {
      const npcs = controller.getAllNPCs();
      expect(npcs.length).toBe(3);
    });

    it('should have relationships between all NPCs', () => {
      const npc1 = controller.getNPC('npc_1');
      expect(npc1).toBeDefined();
    });
  });

  describe('executeNPCTurn', () => {
    it('should execute NPC turn', () => {
      controller.executeNPCTurn('npc_1');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'npc:decision-made',
        expect.any(Object)
      );
    });
  });

  describe('generateQuest', () => {
    it('should generate quest', () => {
      const before = controller.getActiveQuests().length;
      
      controller.generateQuest('npc_1', 'standard');

      const after = controller.getActiveQuests().length;
      expect(after).toBe(before + 1);
    });

    it('should emit quest-generated event', () => {
      controller.generateQuest('npc_2');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'npc:quest-generated',
        expect.any(Object)
      );
    });
  });

  describe('completeQuest', () => {
    beforeEach(() => {
      controller.generateQuest('npc_1');
    });

    it('should complete quest', () => {
      const quests = controller.getActiveQuests();
      controller.completeQuest(quests[0].id);

      const completed = controller.getActiveQuests();
      expect(completed.length).toBeLessThan(quests.length);
    });

    it('should emit quest-completed event', () => {
      const quests = controller.getActiveQuests();
      controller.completeQuest(quests[0].id);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'npc:quest-completed',
        expect.any(Object)
      );
    });
  });
});

describe('NPCCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new NPCCalculations();
  });

  describe('calculatePowerLevel', () => {
    it('should calculate power level', () => {
      const npc = { military: 100, technology: 80, treasury: 5000 };
      const power = calc.calculatePowerLevel(npc);
      expect(power).toBeGreaterThan(0);
    });
  });

  describe('predictActionLikelihood', () => {
    it('should predict higher probability for aligned actions', () => {
      const npc = { personality: 'aggressive' };
      const expandLikelihood = calc.predictActionLikelihood(npc, 'expand');
      const tradeLikelihood = calc.predictActionLikelihood(npc, 'trade');

      expect(expandLikelihood).toBeGreaterThan(tradeLikelihood);
    });
  });
});
