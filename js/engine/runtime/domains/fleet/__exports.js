/**
 * Fleet Domain - Initialization & Public API
 */

import { FleetController, FleetCalculations } from './FleetController.js';
import FleetUI from './FleetUI.js';

export async function initializeFleetDomain(config) {
  if (!config.eventBus) {
    throw new Error('FleetDomain requires eventBus in config');
  }

  const controller = new FleetController({
    eventBus: config.eventBus,
    repository: config.repository,
    logger: config.logger
  });

  // Load initial state
  if (config.repository) {
    try {
      await controller.load();
    } catch (error) {
      console.warn('[FleetDomain] Failed to load initial state:', error);
    }
  }

  // Create UI if target provided
  let ui = null;
  if (config.domTarget) {
    ui = new FleetUI(controller, config.domTarget);
  }

  // Return domain interface
  return {
    name: 'fleet',
    controller,
    ui,
    calculations: new FleetCalculations(),

    // Public API
    createFleet: (fleetData) => controller.createFleet(fleetData),
    addShip: (fleetId, ship) => controller.addShip(fleetId, ship),
    removeShip: (fleetId, shipId) => controller.removeShip(fleetId, shipId),
    setFormation: (fleetId, formation) => controller.setFormation(fleetId, formation),
    
    getFleet: (fleetId) => controller.getFleet(fleetId),
    getAllFleets: () => controller.getAllFleets(),
    calculateFleetStrength: (fleetId) => controller.calculateFleetStrength(fleetId),
    
    getState: () => controller.getState(),
    save: () => controller.save(),
    load: () => controller.load(),
    
    shutdown: async () => {
      await controller.save();
      ui = null;
    }
  };
}

export { FleetController, FleetUI, FleetCalculations };
