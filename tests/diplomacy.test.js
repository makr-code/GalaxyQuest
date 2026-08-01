/**
 * Diplomacy Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiplomacyController, DiplomacyCalculations } from '../js/engine/runtime/domains/diplomacy/DiplomacyController.js';

describe('DiplomacyController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn() };
    controller = new DiplomacyController({ eventBus: mockEventBus, repository: null });
  });

  describe('modifyRelation', () => {
    it('should modify relation score', () => {
      controller.modifyRelation('faction_1', 'faction_2', 10);

      const relation = controller.getRelation('faction_1', 'faction_2');
      expect(relation.score).toBe(60); // Started at 50, +10
    });

    it('should update status', () => {
      controller.modifyRelation('faction_1', 'faction_2', 30);

      const relation = controller.getRelation('faction_1', 'faction_2');
      expect(relation.status).toBe('ally'); // Score >= 75
    });

    it('should emit event', () => {
      controller.modifyRelation('faction_1', 'faction_2', 5);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'diplomacy:relation-changed',
        expect.any(Object)
      );
    });
  });

  describe('signTreaty', () => {
    it('should sign treaty', () => {
      controller.signTreaty('faction_1', 'faction_2', 'trade', 100);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'diplomacy:treaty-signed',
        expect.any(Object)
      );
    });

    it('should improve relations', () => {
      const before = controller.getRelation('faction_1', 'faction_2')?.score || 50;
      controller.signTreaty('faction_1', 'faction_2', 'alliance', 100);
      const after = controller.getRelation('faction_1', 'faction_2').score;

      expect(after).toBeGreaterThan(before);
    });
  });

  describe('reportIncident', () => {
    it('should report incident', () => {
      controller.reportIncident('faction_1', 'faction_2', 'espionage', 'severe');

      const incidents = controller.getIncidents();
      expect(incidents.length).toBe(1);
    });

    it('should degrade relations', () => {
      const before = controller.getRelation('faction_1', 'faction_2')?.score || 50;
      controller.reportIncident('faction_1', 'faction_2', 'border-violation', 'medium');
      const after = controller.getRelation('faction_1', 'faction_2').score;

      expect(after).toBeLessThan(before);
    });
  });

  describe('establishTradeRoute', () => {
    it('should create trade route', () => {
      controller.establishTradeRoute('faction_1', 'faction_2', 100, 50, 200);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'diplomacy:trade-route-established',
        expect.any(Object)
      );
    });
  });
});

describe('DiplomacyCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new DiplomacyCalculations();
  });

  describe('calculateTreatyViability', () => {
    it('should check if treaty is viable', () => {
      const viable1 = calc.calculateTreatyViability(75, 'alliance');
      const viable2 = calc.calculateTreatyViability(30, 'alliance');

      expect(viable1).toBe(true);
      expect(viable2).toBe(false);
    });
  });
});
