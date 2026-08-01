/**
 * Colonization Domain Tests
 * Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ColonizationController, ColonizationCalculations } from '../js/engine/runtime/domains/colonization/ColonizationController.js';
import { initializeColonizationDomain } from '../js/engine/runtime/domains/colonization/colonization__exports.js';

describe('ColonizationController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
    };

    controller = new ColonizationController({
      eventBus: mockEventBus,
      repository: null,
      logger: console,
    });
  });

  describe('colonize', () => {
    it('should colonize a new planet', () => {
      controller.colonize('planet_1', 1000);

      const colonies = controller.getAllColonies();
      expect(colonies.length).toBe(1);
      expect(colonies[0].population).toBe(1000);
    });

    it('should emit colonization event', () => {
      controller.colonize('planet_1', 500);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'colonization:colonized',
        expect.objectContaining({
          planetId: 'planet_1',
          populationCount: 500,
        })
      );
    });

    it('should throw error if planet already colonized', () => {
      controller.colonize('planet_1', 1000);

      expect(() => {
        controller.colonize('planet_1', 500);
      }).toThrow('already colonized');
    });

    it('should throw error if system is locked', () => {
      controller.lock();

      expect(() => {
        controller.colonize('planet_1', 1000);
      }).toThrow('locked');
    });

    it('should set proper population cap', () => {
      controller.colonize('planet_1', 1000);

      const colony = controller.getAllColonies()[0];
      expect(colony.populationCap).toBe(2000); // 2x initial
    });
  });

  describe('addBuilding', () => {
    beforeEach(() => {
      controller.colonize('planet_1', 5000);
    });

    it('should add building to colony', () => {
      const colony = controller.getAllColonies()[0];
      controller.addBuilding(colony.id, 'farm', 1);

      const updated = controller.getColony(colony.id);
      expect(updated.buildings.farm.count).toBe(1);
    });

    it('should deduct resources', () => {
      const colony = controller.getAllColonies()[0];
      const initialCredits = colony.resources.credits;

      controller.addBuilding(colony.id, 'farm', 1);

      const updated = controller.getColony(colony.id);
      expect(updated.resources.credits).toBeLessThan(initialCredits);
    });

    it('should emit building-constructed event', () => {
      const colony = controller.getAllColonies()[0];
      controller.addBuilding(colony.id, 'factory', 1);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'colonization:building-constructed',
        expect.objectContaining({
          buildingType: 'factory',
          count: 1,
        })
      );
    });

    it('should throw error for insufficient credits', () => {
      const colony = controller.getAllColonies()[0];
      colony.resources.credits = 10; // Not enough
      const colonies = controller.state.get('colonies');
      colonies[colony.id] = colony;
      controller.state.set('colonies', colonies);

      expect(() => {
        controller.addBuilding(colony.id, 'factory', 1);
      }).toThrow('Insufficient credits');
    });
  });

  describe('processPopulationGrowth', () => {
    beforeEach(() => {
      controller.colonize('planet_1', 1000);
    });

    it('should increase population', () => {
      const initial = controller.state.get('totalPopulation');
      controller.processPopulationGrowth();
      const updated = controller.state.get('totalPopulation');

      expect(updated).toBeGreaterThanOrEqual(initial);
    });

    it('should respect population cap', () => {
      const colony = controller.getAllColonies()[0];
      colony.population = colony.populationCap * 0.99;
      const colonies = controller.state.get('colonies');
      colonies[colony.id] = colony;
      controller.state.set('colonies', colonies);

      for (let i = 0; i < 10; i++) {
        controller.processPopulationGrowth();
      }

      const updated = controller.getColony(colony.id);
      expect(updated.population).toBeLessThanOrEqual(updated.populationCap);
    });

    it('should update colony status', () => {
      controller.processPopulationGrowth();

      const colony = controller.getColony(controller.getAllColonies()[0].id);
      expect(['growing', 'stable', 'struggling']).toContain(colony.status);
    });
  });

  describe('processResourceProduction', () => {
    beforeEach(() => {
      controller.colonize('planet_1', 1000);
      const colony = controller.getAllColonies()[0];
      controller.addBuilding(colony.id, 'farm', 2);
    });

    it('should produce resources', () => {
      const colony = controller.getAllColonies()[0];
      const initialFood = colony.resources.food;

      controller.processResourceProduction();

      const updated = controller.getColony(colony.id);
      expect(updated.resources.food).toBeGreaterThan(initialFood);
    });
  });

  describe('lock/unlock', () => {
    it('should prevent colonization when locked', () => {
      controller.lock();

      expect(() => {
        controller.colonize('planet_1', 1000);
      }).toThrow('locked');
    });

    it('should emit locked/unlocked events', () => {
      controller.lock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('colonization:locked', {});

      controller.unlock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('colonization:unlocked', {});
    });
  });
});

describe('ColonizationCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new ColonizationCalculations();
  });

  describe('calculatePopulationGrowth', () => {
    it('should grow population towards cap', () => {
      const grown = calc.calculatePopulationGrowth(1000, 10000, 0.05);
      expect(grown).toBeGreaterThan(1000);
    });

    it('should stop at population cap', () => {
      const grown = calc.calculatePopulationGrowth(9900, 10000, 0.05);
      expect(grown).toBeLessThanOrEqual(10000);
    });
  });

  describe('calculateHappiness', () => {
    it('should return value 0-100', () => {
      const happiness = calc.calculateHappiness(1000, 100, 50, 20);
      expect(happiness).toBeGreaterThanOrEqual(0);
      expect(happiness).toBeLessThanOrEqual(100);
    });

    it('should increase with resources', () => {
      const low = calc.calculateHappiness(1000, 10, 5, 5);
      const high = calc.calculateHappiness(1000, 100, 50, 20);

      expect(high).toBeGreaterThan(low);
    });
  });

  describe('calculateProductionModifier', () => {
    it('should return 1.0 at 50% happiness', () => {
      const modifier = calc.calculateProductionModifier(50);
      expect(modifier).toBeCloseTo(1.0, 1);
    });

    it('should increase with happiness', () => {
      const low = calc.calculateProductionModifier(0);
      const high = calc.calculateProductionModifier(100);

      expect(high).toBeGreaterThan(low);
    });
  });
});

describe('Colonization Domain Integration', () => {
  it('should initialize colonization domain', async () => {
    const domain = await initializeColonizationDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    expect(domain.name).toBe('colonization');
    expect(typeof domain.colonize).toBe('function');
    expect(typeof domain.addBuilding).toBe('function');
  });

  it('should manage colony workflow', async () => {
    const domain = await initializeColonizationDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    // Colonize
    domain.colonize('planet_1', 2000);
    expect(domain.getAllColonies().length).toBe(1);

    // Add building
    const colony = domain.getAllColonies()[0];
    domain.addBuilding(colony.id, 'farm', 1);

    // Process turn
    domain.processPopulationGrowth();
    domain.processResourceProduction();

    const updated = domain.getColony(colony.id);
    expect(updated.population).toBeGreaterThanOrEqual(2000);
  });
});
