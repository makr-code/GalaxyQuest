/**
 * Galaxy Domain Tests
 * Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GalaxyController, GalaxyCalculations } from '../js/engine/runtime/domains/galaxy/GalaxyController.js';
import { initializeGalaxyDomain } from '../js/engine/runtime/domains/galaxy/galaxy__exports.js';

describe('GalaxyController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
    };

    controller = new GalaxyController({
      eventBus: mockEventBus,
      repository: null,
      logger: console,
    });
  });

  describe('initialization', () => {
    it('should initialize with default star systems', () => {
      const stars = controller.getAllStars();
      expect(stars.length).toBeGreaterThan(0);
    });

    it('should initialize with sectors', () => {
      const sectors = controller.getAllSectors();
      expect(sectors.length).toBeGreaterThan(0);
    });

    it('should have Sol as starting position', () => {
      const sol = controller.getStar('sol');
      expect(sol).toBeDefined();
      expect(sol.name).toBe('Sol System');
    });
  });

  describe('selectStar', () => {
    it('should select a star system', () => {
      controller.selectStar('sirius');
      expect(controller.state.get('selectedStarId')).toBe('sirius');
    });

    it('should emit star-selected event', () => {
      controller.selectStar('alpha-centauri');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'galaxy:star-selected',
        expect.objectContaining({
          starId: 'alpha-centauri',
        })
      );
    });

    it('should throw error if star not found', () => {
      expect(() => {
        controller.selectStar('nonexistent');
      }).toThrow('not found');
    });

    it('should throw error if locked', () => {
      controller.lock();

      expect(() => {
        controller.selectStar('sol');
      }).toThrow('locked');
    });
  });

  describe('moveCamera', () => {
    it('should update camera position', (done) => {
      controller.moveCamera(10, 10, 10, 0, 0, 0, 100);

      setTimeout(() => {
        const pos = controller.state.get('cameraPosition');
        expect(pos.x).toBeCloseTo(10, 1);
        expect(pos.y).toBeCloseTo(10, 1);
        expect(pos.z).toBeCloseTo(10, 1);
        done();
      }, 150);
    });

    it('should emit camera-moved event after animation', (done) => {
      controller.moveCamera(5, 5, 5, 0, 0, 0, 50);

      setTimeout(() => {
        expect(mockEventBus.emit).toHaveBeenCalledWith(
          'galaxy:camera-moved',
          expect.any(Object)
        );
        done();
      }, 100);
    });
  });

  describe('setZoom', () => {
    it('should set zoom level', () => {
      controller.setZoom(2.0);
      expect(controller.state.get('zoom')).toBe(2.0);
    });

    it('should clamp zoom to valid range', () => {
      controller.setZoom(20); // Too high
      expect(controller.state.get('zoom')).toBeLessThanOrEqual(10.0);

      controller.setZoom(0.01); // Too low
      expect(controller.state.get('zoom')).toBeGreaterThanOrEqual(0.1);
    });

    it('should emit zoom-changed event', () => {
      controller.setZoom(1.5);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'galaxy:zoom-changed',
        expect.objectContaining({
          zoom: 1.5,
        })
      );
    });
  });

  describe('planRoute', () => {
    it('should plan route between stars', () => {
      controller.planRoute('sol', 'sirius', 'fleet_1');

      const routes = controller.state.get('routes');
      expect(Object.keys(routes).length).toBe(1);
    });

    it('should calculate distance correctly', () => {
      controller.planRoute('sol', 'alpha-centauri', 'fleet_1');

      const routes = controller.state.get('routes');
      const route = Object.values(routes)[0];
      expect(route.distance).toBeGreaterThan(0);
    });

    it('should emit route-planned event', () => {
      controller.planRoute('sol', 'vega', 'fleet_2');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'galaxy:route-planned',
        expect.any(Object)
      );
    });

    it('should throw error if star not found', () => {
      expect(() => {
        controller.planRoute('nonexistent', 'sol', 'fleet_1');
      }).toThrow('not found');
    });
  });

  describe('lock/unlock', () => {
    it('should prevent selection when locked', () => {
      controller.lock();

      expect(() => {
        controller.selectStar('sol');
      }).toThrow('locked');
    });

    it('should emit locked/unlocked events', () => {
      controller.lock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('galaxy:locked', {});

      controller.unlock();
      expect(mockEventBus.emit).toHaveBeenCalledWith('galaxy:unlocked', {});
    });
  });
});

describe('GalaxyCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new GalaxyCalculations();
  });

  describe('calculateDistance', () => {
    it('should calculate 3D distance', () => {
      const dist = calc.calculateDistance(0, 0, 0, 3, 4, 0);
      expect(dist).toBe(5); // 3-4-5 triangle
    });

    it('should handle same point', () => {
      const dist = calc.calculateDistance(5, 5, 5, 5, 5, 5);
      expect(dist).toBe(0);
    });
  });

  describe('calculateTravelTime', () => {
    it('should calculate travel time', () => {
      const time = calc.calculateTravelTime(100, 10);
      expect(time).toBe(10);
    });

    it('should round up', () => {
      const time = calc.calculateTravelTime(105, 10);
      expect(time).toBe(11);
    });
  });

  describe('calculateStarVisibility', () => {
    it('should determine visibility by tier', () => {
      const tier1Visible = calc.calculateStarVisibility(1, 5);
      const tier5Visible = calc.calculateStarVisibility(5, 5);

      expect(tier1Visible).toBe(true);
      expect(tier5Visible).toBe(true);
    });

    it('should hide low-tier stars at far zoom', () => {
      const visible = calc.calculateStarVisibility(1, 1);
      expect(visible).toBe(false);
    });
  });

  describe('calculateOptimalCameraDistance', () => {
    it('should calculate camera distance', () => {
      const distance = calc.calculateOptimalCameraDistance(50, 75);
      expect(distance).toBeGreaterThan(0);
    });
  });

  describe('calculateSectorForPoint', () => {
    it('should calculate sector', () => {
      const sector = calc.calculateSectorForPoint(0, 0, 0);
      expect(sector.sx).toBe(0);
      expect(sector.sy).toBe(0);
      expect(sector.sz).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const sector = calc.calculateSectorForPoint(-150, -50, 0);
      expect(sector.sx).toBe(-2);
      expect(sector.sy).toBeLessThan(0);
    });
  });

  describe('interpolatePosition', () => {
    it('should interpolate position', () => {
      const from = { x: 0, y: 0, z: 0 };
      const to = { x: 10, y: 10, z: 10 };
      const mid = calc.interpolatePosition(from, to, 0.5);

      expect(mid.x).toBe(5);
      expect(mid.y).toBe(5);
      expect(mid.z).toBe(5);
    });

    it('should handle endpoints', () => {
      const from = { x: 0, y: 0, z: 0 };
      const to = { x: 10, y: 10, z: 10 };

      const start = calc.interpolatePosition(from, to, 0);
      expect(start).toEqual(from);

      const end = calc.interpolatePosition(from, to, 1);
      expect(end).toEqual(to);
    });
  });
});

describe('Galaxy Domain Integration', () => {
  it('should initialize galaxy domain', async () => {
    const domain = await initializeGalaxyDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    expect(domain.name).toBe('galaxy');
    expect(typeof domain.selectStar).toBe('function');
    expect(typeof domain.moveCamera).toBe('function');
  });

  it('should manage galaxy workflow', async () => {
    const domain = await initializeGalaxyDomain({
      eventBus: { emit: vi.fn(), on: vi.fn() },
      repository: null,
    });

    // Select star
    domain.selectStar('sirius');
    expect(domain.controller.state.get('selectedStarId')).toBe('sirius');

    // Plan route
    domain.planRoute('sol', 'sirius', 'fleet_1');
    const routes = domain.controller.state.get('routes');
    expect(Object.keys(routes).length).toBe(1);

    // Zoom
    domain.setZoom(2.0);
    expect(domain.controller.state.get('zoom')).toBe(2.0);
  });
});
