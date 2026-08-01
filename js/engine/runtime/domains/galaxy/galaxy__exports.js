/**
 * Galaxy Domain Initialization
 */

import { GalaxyController } from './GalaxyController.js';
import { GalaxyUI } from './GalaxyUI.js';

/**
 * Initialize Galaxy domain
 */
export async function initializeGalaxyDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  // Create controller
  const controller = new GalaxyController({
    eventBus,
    repository,
    logger,
  });

  // Load initial state
  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load galaxy state:', error.message);
    }
  }

  // Create UI
  let ui = null;
  if (domTarget) {
    ui = new GalaxyUI(controller, domTarget);
  }

  // Return public interface
  return {
    name: 'galaxy',
    controller,
    ui,

    // Public methods
    selectStar: (starId) => controller.selectStar(starId),
    moveCamera: (x, y, z, lx, ly, lz, duration) => controller.moveCamera(x, y, z, lx, ly, lz, duration),
    setZoom: (level) => controller.setZoom(level),
    updateVisibleStars: (cameraPos, frustumSize) => controller.updateVisibleStars(cameraPos, frustumSize),
    planRoute: (fromId, toId, fleetId) => controller.planRoute(fromId, toId, fleetId),
    getStar: (starId) => controller.getStar(starId),
    getAllStars: () => controller.getAllStars(),
    getSector: (sectorId) => controller.getSector(sectorId),
    getAllSectors: () => controller.getAllSectors(),
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
