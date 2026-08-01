/**
 * Fleet Domain Tests
 * 
 * Unit tests for FleetController and FleetUI
 * Run: npm run test -- fleet --coverage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FleetController, FleetCalculations } from '../js/engine/runtime/domains/fleet/FleetController.js';

describe('FleetController', () => {
  let controller;
  let eventBus;

  beforeEach(() => {
    eventBus = {
      emit: vi.fn()
    };

    controller = new FleetController({
      eventBus,
      logger: console
    });
  });

  it('initializes with empty state', () => {
    const state = controller.getState();
    expect(state.fleets).toEqual({});
    expect(state.totalShips).toBe(0);
  });

  it('creates fleet with ships', () => {
    const fleetId = controller.createFleet({
      name: 'Test Fleet',
      colonyId: 'colony_1',
      ships: [
        { type: 'Fighter', class: 'fighter' },
        { type: 'Corvette', class: 'corvette' }
      ]
    });

    expect(fleetId).toMatch(/^fleet_/);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'fleet:created',
      expect.objectContaining({ fleetId })
    );

    const fleet = controller.getFleet(fleetId);
    expect(fleet.ships).toHaveLength(2);
    expect(fleet.name).toBe('Test Fleet');
  });

  it('validates fleet creation', () => {
    expect(() => {
      controller.createFleet({ colonyId: 'colony_1' }); // Missing name
    }).toThrow(/name and colonyId required/i);
  });

  it('adds ship to fleet', () => {
    const fleetId = controller.createFleet({
      name: 'Test Fleet',
      colonyId: 'colony_1'
    });

    controller.addShip(fleetId, {
      type: 'Destroyer',
      class: 'destroyer'
    });

    const fleet = controller.getFleet(fleetId);
    expect(fleet.ships).toHaveLength(1);
    expect(fleet.ships[0].class).toBe('destroyer');

    expect(eventBus.emit).toHaveBeenCalledWith(
      'fleet:ship-added',
      expect.anything()
    );
  });

  it('removes ship from fleet', () => {
    const fleetId = controller.createFleet({
      name: 'Test Fleet',
      colonyId: 'colony_1',
      ships: [{ type: 'Fighter', class: 'fighter' }]
    });

    const fleet = controller.getFleet(fleetId);
    const shipId = fleet.ships[0].id;

    controller.removeShip(fleetId, shipId);

    expect(controller.getFleet(fleetId).ships).toHaveLength(0);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'fleet:ship-removed',
      expect.anything()
    );
  });

  it('sets formation with validation', () => {
    const fleetId = controller.createFleet({
      name: 'Test Fleet',
      colonyId: 'colony_1'
    });

    expect(() => {
      controller.setFormation(fleetId, 'invalid-formation');
    }).toThrow(/Invalid formation/);

    controller.setFormation(fleetId, 'wedge');
    expect(controller.getFleet(fleetId).formation).toBe('wedge');
  });

  it('calculates fleet strength', () => {
    const fleetId = controller.createFleet({
      name: 'Test Fleet',
      colonyId: 'colony_1',
      ships: [
        { type: 'Fighter', class: 'fighter' },    // 10 strength
        { type: 'Corvette', class: 'corvette' },  // 25 strength
        { type: 'Destroyer', class: 'destroyer' } // 50 strength
      ]
    });

    const strength = controller.calculateFleetStrength(fleetId);
    expect(strength).toBe(85); // 10 + 25 + 50
  });

  it('gets all fleets', () => {
    controller.createFleet({ name: 'Fleet 1', colonyId: 'colony_1' });
    controller.createFleet({ name: 'Fleet 2', colonyId: 'colony_2' });

    const fleets = controller.getAllFleets();
    expect(fleets).toHaveLength(2);
  });

  it('notifies UI callbacks on state change', () => {
    const callback = vi.fn();
    controller.onStateChange(callback);

    controller.createFleet({
      name: 'Test Fleet',
      colonyId: 'colony_1'
    });

    expect(callback).toHaveBeenCalled();
  });
});

describe('FleetCalculations', () => {
  const calc = new FleetCalculations();

  it('calculates fleet strength from ships', () => {
    const fleet = {
      ships: [
        { class: 'fighter', health: 100 },
        { class: 'corvette', health: 100 },
        { class: 'destroyer', health: 50 } // Half health
      ]
    };

    const strength = calc.calculateFleetStrength(fleet);
    expect(strength).toBe(10 + 25 + 25); // 25 * 0.5 = 12.5 (rounded)
  });

  it('calculates ETA between points', () => {
    const eta = calc.calculateETA(
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      10 // speed
    );

    expect(eta).toBe(10); // 100 / 10
  });

  it('gets formation modifier', () => {
    expect(calc.getFormationModifier('line')).toBe(1.2);
    expect(calc.getFormationModifier('wedge')).toBe(1.0);
    expect(calc.getFormationModifier('sphere')).toBe(0.9);
    expect(calc.getFormationModifier('scattered')).toBe(0.5);
  });

  it('calculates combat effectiveness', () => {
    const attacker = {
      ships: [
        { class: 'destroyer', health: 100 },
        { class: 'destroyer', health: 100 }
      ]
    };

    const defender = {
      ships: [
        { class: 'corvette', health: 100 }
      ]
    };

    const effectiveness = calc.calculateEffectiveness(attacker, defender);
    
    expect(effectiveness.attacker).toBeGreaterThan(50);
    expect(effectiveness.defender).toBeLessThan(50);
    expect(effectiveness.attacker + effectiveness.defender).toBe(100);
  });
});

export {};
