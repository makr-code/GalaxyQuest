/**
 * Research Domain Initialization
 * Factory function for creating and initializing the Research domain
 */

import { ResearchController } from './ResearchController.js';
import { ResearchUI } from './ResearchUI.js';

/**
 * Initialize Research domain
 * @param {Object} config - Configuration object
 * @param {Object} config.eventBus - Centralized event bus
 * @param {Object} config.repository - Data persistence layer
 * @param {Object} config.logger - Logger instance
 * @param {HTMLElement} config.domTarget - DOM element for UI rendering
 * @returns {Promise<Object>} Domain interface with public APIs
 */
export async function initializeResearchDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  // Create controller with dependency injection
  const controller = new ResearchController({
    eventBus,
    repository,
    logger,
  });

  // Load initial state from repository
  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load research state:', error.message);
    }
  }

  // Create UI if DOM target provided
  let ui = null;
  if (domTarget) {
    ui = new ResearchUI(controller, domTarget);
  }

  // Return public domain interface
  return {
    name: 'research',
    controller,
    ui,

    // Public methods (facade)
    startResearch: (techId) => controller.startResearch(techId),
    cancelResearch: () => controller.cancelResearch(),
    addResearchPoints: (amount) => controller.addResearchPoints(amount),
    getTechnology: (techId) => controller.getTechnology(techId),
    getTechesByCategory: (category) => controller.getTechesByCategory(category),
    getAllTechnologies: () => controller.getAllTechnologies(),
    getResearchProgress: () => controller.getResearchProgress(),
    getState: () => controller.getState(),
    save: () => controller.save(),
    load: () => controller.load(),

    // Lifecycle methods
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
