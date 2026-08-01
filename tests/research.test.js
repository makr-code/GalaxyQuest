/**
 * Research Domain Tests
 * Tests for ResearchController, ResearchUI, and ResearchCalculations
 * Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResearchController, ResearchCalculations } from '../js/engine/runtime/domains/research/ResearchController.js';
import { ResearchUI } from '../js/engine/runtime/domains/research/ResearchUI.js';
import { initializeResearchDomain } from '../js/engine/runtime/domains/research/research__exports.js';

describe('ResearchController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
    };

    controller = new ResearchController({
      eventBus: mockEventBus,
      repository: null,
      logger: console,
    });
  });

  describe('startResearch', () => {
    it('should start research on available technology', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      const activeResearch = controller.state.get('activeResearch');
      expect(activeResearch).toBe(tech.id);
    });

    it('should emit research-started event', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'research:started',
        expect.objectContaining({
          techId: tech.id,
          techName: tech.name,
        })
      );
    });

    it('should throw error if already researching', () => {
      const tech1 = controller.getAllTechnologies()[0];
      controller.startResearch(tech1.id);

      const tech2 = controller.getAllTechnologies()[1];
      expect(() => {
        controller.startResearch(tech2.id);
      }).toThrow('Already researching a technology');
    });

    it('should throw error for locked technology', () => {
      const techs = controller.getAllTechnologies();
      const lockedTech = techs.find(t => t.status === 'locked');

      if (lockedTech) {
        expect(() => {
          controller.startResearch(lockedTech.id);
        }).toThrow('is locked');
      }
    });

    it('should throw error if system is locked', () => {
      controller.lock();

      expect(() => {
        const tech = controller.getAllTechnologies()[0];
        controller.startResearch(tech.id);
      }).toThrow('Research system is locked');
    });
  });

  describe('addResearchPoints', () => {
    it('should accumulate research points', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      controller.addResearchPoints(50);
      expect(controller.state.get('researchPoints')).toBe(50);

      controller.addResearchPoints(50);
      expect(controller.state.get('researchPoints')).toBe(100);
    });

    it('should update progress of active research', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      controller.addResearchPoints(50);
      const updatedTech = controller.getTechnology(tech.id);
      expect(updatedTech.progress).toBeGreaterThan(0);
    });

    it('should complete research when cost is reached', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      controller.addResearchPoints(tech.cost);
      const completed = controller.getTechnology(tech.id);
      expect(completed.status).toBe('completed');
      expect(completed.progress).toBe(100);
    });

    it('should emit research-completed event when done', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      controller.addResearchPoints(tech.cost);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'research:completed',
        expect.objectContaining({
          techId: tech.id,
        })
      );
    });
  });

  describe('cancelResearch', () => {
    it('should cancel active research', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      controller.cancelResearch();
      expect(controller.state.get('activeResearch')).toBeNull();
    });

    it('should reset tech to available status', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      controller.addResearchPoints(25);
      controller.cancelResearch();

      const cancelled = controller.getTechnology(tech.id);
      expect(cancelled.status).toBe('available');
      expect(cancelled.progress).toBe(0);
    });

    it('should emit research-cancelled event', () => {
      const tech = controller.getAllTechnologies()[0];
      controller.startResearch(tech.id);

      controller.cancelResearch();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'research:cancelled',
        expect.objectContaining({
          techId: tech.id,
        })
      );
    });

    it('should throw error if no active research', () => {
      expect(() => {
        controller.cancelResearch();
      }).toThrow('No active research to cancel');
    });
  });

  describe('getTechesByCategory', () => {
    it('should return techs for specified category', () => {
      const propulsion = controller.getTechesByCategory('propulsion');
      expect(propulsion.length).toBeGreaterThan(0);
      expect(propulsion.every(t => t.category === 'propulsion')).toBe(true);
    });
  });

  describe('lock/unlock', () => {
    it('should prevent research when locked', () => {
      controller.lock();

      expect(() => {
        const tech = controller.getAllTechnologies()[0];
        controller.startResearch(tech.id);
      }).toThrow('locked');
    });

    it('should emit locked/unlocked events', () => {
      controller.lock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('research:locked', {});

      controller.unlock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('research:unlocked', {});
    });
  });

  describe('prerequisites', () => {
    it('should lock techs with unmet prerequisites', () => {
      const advancedEngines = controller.getTechnology('tech_advanced_engines');
      expect(advancedEngines.status).toBe('locked');
    });

    it('should unlock techs when prerequisites are met', () => {
      const basicEngines = controller.getTechnology('tech_basic_engines');
      controller.startResearch(basicEngines.id);
      controller.addResearchPoints(basicEngines.cost);

      const advancedEngines = controller.getTechnology('tech_advanced_engines');
      expect(advancedEngines.status).toBe('available');
    });
  });
});

describe('ResearchCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new ResearchCalculations();
  });

  describe('calculatePointsPerTurn', () => {
    it('should apply multiplier to base points', () => {
      const points = calc.calculatePointsPerTurn(10, 1.5);
      expect(points).toBe(15);
    });
  });

  describe('calculateCompletionTime', () => {
    it('should calculate turns needed', () => {
      const turns = calc.calculateCompletionTime(100, 10);
      expect(turns).toBe(10);
    });

    it('should round up fractional turns', () => {
      const turns = calc.calculateCompletionTime(105, 10);
      expect(turns).toBe(11);
    });
  });

  describe('calculateTechValue', () => {
    it('should scale value by tier', () => {
      const tier1 = calc.calculateTechValue(1, 'offense');
      const tier2 = calc.calculateTechValue(2, 'offense');
      const tier3 = calc.calculateTechValue(3, 'offense');

      expect(tier2).toBe(tier1 * 2);
      expect(tier3).toBe(tier1 * 4);
    });

    it('should adjust by category', () => {
      const propulsion = calc.calculateTechValue(1, 'propulsion');
      const offense = calc.calculateTechValue(1, 'offense');
      const defense = calc.calculateTechValue(1, 'defense');

      expect(offense).toBeGreaterThan(propulsion);
      expect(defense).toBeGreaterThan(propulsion);
    });
  });

  describe('predictProgressionETA', () => {
    it('should predict time to complete all techs', () => {
      const techs = [
        { cost: 100, status: 'available' },
        { cost: 100, status: 'available' },
      ];

      const eta = calc.predictProgressionETA(techs, 50, 10);
      expect(eta).toBe(15); // 200 - 50 = 150, 150 / 10 = 15
    });
  });
});

describe('Research Domain Integration', () => {
  it('should initialize research domain', async () => {
    const domain = await initializeResearchDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    expect(domain.name).toBe('research');
    expect(typeof domain.startResearch).toBe('function');
    expect(typeof domain.addResearchPoints).toBe('function');
    expect(typeof domain.getTechnology).toBe('function');
  });

  it('should manage complete research workflow', async () => {
    const domain = await initializeResearchDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    const allTechs = domain.getAllTechnologies();
    const tech = allTechs[0];

    // Start research
    domain.startResearch(tech.id);
    expect(domain.getResearchProgress()).toBe(0);

    // Add points
    domain.addResearchPoints(tech.cost / 2);
    expect(domain.getResearchProgress()).toBeGreaterThan(0);

    // Complete research
    domain.addResearchPoints(tech.cost / 2);
    const completed = domain.getTechnology(tech.id);
    expect(completed.status).toBe('completed');
  });
});
