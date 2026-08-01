/**
 * Espionage Domain Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EspionageController, EspionageCalculations } from '../js/engine/runtime/domains/espionage/EspionageController.js';

describe('EspionageController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn() };
    controller = new EspionageController({ eventBus: mockEventBus, repository: null });
  });

  describe('deploySpy', () => {
    it('should deploy spy', () => {
      controller.deploySpy('faction_1', 'faction_2', 'Agent Smith');

      const spies = controller.getFactionSpies('faction_1');
      expect(spies.length).toBe(1);
    });

    it('should emit spy-deployed event', () => {
      controller.deploySpy('faction_1', 'faction_2', 'Agent X');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'espionage:spy-deployed',
        expect.any(Object)
      );
    });
  });

  describe('gatherIntelligence', () => {
    beforeEach(() => {
      controller.deploySpy('faction_1', 'faction_2', 'Spy');
    });

    it('should gather intelligence', () => {
      const spies = controller.getFactionSpies('faction_1');
      controller.gatherIntelligence(spies[0].id, 'military');

      const intel = controller.getFactionIntelligence('faction_1');
      expect(intel.length).toBeGreaterThan(0);
    });

    it('should emit event', () => {
      const spies = controller.getFactionSpies('faction_1');
      controller.gatherIntelligence(spies[0].id, 'economic');

      // Either spy-discovered or intelligence-gathered
      expect(mockEventBus.emit.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('launchSabotage', () => {
    it('should launch sabotage', () => {
      controller.launchSabotage('faction_1', 'faction_2', 'fleet', 100);

      const operations = controller.getOperations();
      expect(operations.length).toBe(1);
    });

    it('should emit sabotage-launched event', () => {
      controller.launchSabotage('faction_1', 'faction_2', 'production', 50);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'espionage:sabotage-launched',
        expect.any(Object)
      );
    });
  });

  describe('progressSabotage', () => {
    beforeEach(() => {
      controller.launchSabotage('faction_1', 'faction_2', 'research', 100);
    });

    it('should progress sabotage', () => {
      const operations = controller.getOperations();
      controller.progressSabotage(operations[0].id, 50);

      const updated = controller.getOperations()[0];
      expect(updated.progress).toBe(50);
    });

    it('should complete sabotage at 100%', () => {
      const operations = controller.getOperations();
      controller.progressSabotage(operations[0].id, 100);

      const updated = controller.getOperations()[0];
      expect(updated.status).toBe('completed');
    });
  });
});

describe('EspionageCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new EspionageCalculations();
  });

  describe('calculateDiscoveryRisk', () => {
    it('should calculate higher risk with low skill', () => {
      const risk1 = calc.calculateDiscoveryRisk(10, 50);
      const risk2 = calc.calculateDiscoveryRisk(90, 50);

      expect(risk1).toBeGreaterThan(risk2);
    });
  });

  describe('calculateSabotageSuccess', () => {
    it('should calculate success chance', () => {
      const success = calc.calculateSabotageSuccess(50, 30);
      expect(success).toBeGreaterThan(0);
      expect(success).toBeLessThan(100);
    });
  });
});
