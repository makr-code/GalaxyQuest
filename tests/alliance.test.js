/**
 * Alliance Domain Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AllianceController, AllianceCalculations } from '../js/engine/runtime/domains/alliance/AllianceController.js';

describe('AllianceController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn() };
    controller = new AllianceController({ eventBus: mockEventBus, repository: null, logger: console });
  });

  describe('createAlliance', () => {
    it('should create new alliance', () => {
      controller.createAlliance('Galactic Union', 'faction_1');

      const alliances = controller.getAllAlliances();
      expect(alliances.length).toBe(1);
      expect(alliances[0].name).toBe('Galactic Union');
    });

    it('should emit alliance-created event', () => {
      controller.createAlliance('Test Alliance', 'faction_1');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'alliance:created',
        expect.objectContaining({ allianceName: 'Test Alliance' })
      );
    });
  });

  describe('inviteMember', () => {
    beforeEach(() => {
      controller.createAlliance('Test', 'faction_1');
    });

    it('should invite member', () => {
      const alliance = controller.getAllAlliances()[0];
      controller.inviteMember(alliance.id, 'faction_2');

      const updated = controller.getAlliance(alliance.id);
      expect(updated.members.length).toBe(2);
    });

    it('should throw error if already member', () => {
      const alliance = controller.getAllAlliances()[0];

      expect(() => {
        controller.inviteMember(alliance.id, 'faction_1');
      }).toThrow('already in alliance');
    });
  });

  describe('contributeToTreasury', () => {
    beforeEach(() => {
      controller.createAlliance('Test', 'faction_1');
    });

    it('should add resources to treasury', () => {
      const alliance = controller.getAllAlliances()[0];
      const initialCredits = alliance.treasury.credits;

      controller.contributeToTreasury(alliance.id, 'faction_1', 500);

      const updated = controller.getAlliance(alliance.id);
      expect(updated.treasury.credits).toBeGreaterThan(initialCredits);
    });

    it('should emit contributed event', () => {
      const alliance = controller.getAllAlliances()[0];
      controller.contributeToTreasury(alliance.id, 'faction_1', 100, 50, 25);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'alliance:contributed',
        expect.any(Object)
      );
    });
  });

  describe('proposeVote', () => {
    beforeEach(() => {
      controller.createAlliance('Test', 'faction_1');
    });

    it('should create vote', () => {
      const alliance = controller.getAllAlliances()[0];
      controller.proposeVote(alliance.id, 'war-declaration', 'Declare war on enemy');

      expect(mockEventBus.emit).toHaveBeenCalledWith('alliance:vote-proposed', expect.any(Object));
    });
  });

  describe('lock/unlock', () => {
    it('should prevent operations when locked', () => {
      controller.lock();

      expect(() => {
        controller.createAlliance('Test', 'faction');
      }).toThrow('locked');
    });
  });
});

describe('AllianceCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new AllianceCalculations();
  });

  describe('calculateAlliancePower', () => {
    it('should calculate power score', () => {
      const power = calc.calculateAlliancePower(5, { credits: 1000, minerals: 500, energy: 200 });
      expect(power).toBeGreaterThan(0);
    });
  });

  describe('calculateVoteOutcome', () => {
    it('should pass vote at threshold', () => {
      const outcome = calc.calculateVoteOutcome(60, 40, 50);
      expect(outcome).toBe('passed');
    });

    it('should fail vote below threshold', () => {
      const outcome = calc.calculateVoteOutcome(40, 60, 50);
      expect(outcome).toBe('failed');
    });
  });
});
