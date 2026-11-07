import { describe, expect, it, vi } from 'vitest';
import { FleetController, FleetCalculations } from '../../js/engine/runtime/domains/fleet/FleetController.js';
import FleetUI from '../../js/engine/runtime/domains/fleet/FleetUI.js';

describe('Legacy Fleet domain status handling', () => {
  it('does not assign a made-up health value to newly added ships', () => {
    const controller = new FleetController({ eventBus: { emit: vi.fn() } });
    const fleetId = controller.createFleet({ name: 'Test', colonyId: 'colony-1' });
    controller.addShip(fleetId, { type: 'Fighter', class: 'fighter' });

    expect(controller.getFleet(fleetId).ships[0].health).toBeUndefined();
  });

  it('does not invent a health penalty when calculating strength without a measurement', () => {
    const calculations = new FleetCalculations();
    expect(calculations.calculateFleetStrength({
      ships: [{ class: 'fighter' }, { class: 'corvette', health: null }],
    })).toBe(35);
  });

  it('applies explicit zero health and ignores out-of-range values', () => {
    const calculations = new FleetCalculations();
    expect(calculations.calculateFleetStrength({
      ships: [
        { class: 'fighter', health: 0 },
        { class: 'corvette', health: 120 },
      ],
    })).toBe(25);
  });

  it('renders a health bar only for an explicitly supplied valid measurement', () => {
    const controller = {
      onStateChange: vi.fn(),
      onError: vi.fn(),
      getState: () => ({ fleets: {} }),
      getFleet: () => ({
        id: 'fleet-1',
        name: 'Test Fleet',
        ships: [
          { id: 'ship-1', type: 'Unknown', class: 'fighter', status: 'active' },
          { id: 'ship-2', type: 'Damaged', class: 'corvette', status: 'active', health: 0 },
          { id: 'ship-3', type: 'Invalid', class: 'cruiser', status: 'active', health: 130 },
        ],
      }),
    };
    const ui = new FleetUI(controller, document.createElement('div'));
    ui.selectedFleetId = 'fleet-1';
    const root = document.createElement('div');
    root.innerHTML = ui._buildShipsSection();

    expect(root.querySelectorAll('.health-bar')).toHaveLength(1);
    expect(root.querySelector('.health-bar').getAttribute('aria-valuenow')).toBe('0');
    expect(root.querySelector('.health-fill').style.width).toBe('0%');
    expect(root.querySelectorAll('.text-muted')).toHaveLength(2);
  });
});
