/**
 * Colonization Domain Initialization
 * Factory function for creating and initializing the Colonization domain
 */

import { ColonizationController } from './ColonizationController.js';
import { ColonizationUI } from './ColonizationUI.js';

/**
 * Initialize Colonization domain
 */
export async function initializeColonizationDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  // Create controller
  const controller = new ColonizationController({
    eventBus,
    repository,
    logger,
  });

  // Load initial state
  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load colonization state:', error.message);
    }
  }

  // Create UI
  let ui = null;
  if (domTarget) {
    ui = new ColonizationUI(controller, domTarget);
  }

  // Return public interface
  return {
    name: 'colonization',
    controller,
    ui,

    // Public methods
    colonize: (planetId, count) => controller.colonize(planetId, count),
    addBuilding: (colonyId, buildingType, count) => controller.addBuilding(colonyId, buildingType, count),
    processPopulationGrowth: () => controller.processPopulationGrowth(),
    processResourceProduction: () => controller.processResourceProduction(),
    getColony: (colonyId) => controller.getColony(colonyId),
    getAllColonies: () => controller.getAllColonies(),
    getBuildingType: (buildingType) => controller.getBuildingType(buildingType),
    getState: () => controller.getState(),
    save: () => controller.save(),
    load: () => controller.load(),

    // Lifecycle
    lock: () => controller.lock(),
    unlock: () => controller.unlock(),
    shutdown: async () => {
      if (ui && ui.container) {
        ui.container.innerHTML = '';
      }
      await controller.save();
    },
  };
}
