/**
 * War Domain Initialization
 * Factory function for creating and initializing the War domain
 * 
 * Returns domain interface with all public APIs
 */

import { WarController } from './WarController.js';
import { WarUI } from './WarUI.js';

/**
 * Initialize War domain
 * @param {Object} config - Configuration object
 * @param {Object} config.eventBus - Centralized event bus (EventRegistry)
 * @param {Object} config.repository - Data persistence layer
 * @param {Object} config.logger - Logger instance
 * @param {HTMLElement} config.domTarget - DOM element for UI rendering
 * @returns {Promise<Object>} Domain interface with public APIs
 */
export async function initializeWarDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  // Create controller with dependency injection
  const controller = new WarController({
    eventBus,
    repository,
    logger,
  });

  // Load initial state from repository
  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load war state:', error.message);
    }
  }

  // Create UI if DOM target provided
  let ui = null;
  if (domTarget) {
    ui = new WarUI(controller, domTarget);
  }

  // Return public domain interface
  return {
    name: 'war',
    controller,
    ui,

    // Public methods (facade)
    declareWar: (factionA, factionB, reason) => controller.declareWar(factionA, factionB, reason),
    signPeaceTreaty: (factionA, factionB, duration) => controller.signPeaceTreaty(factionA, factionB, duration),
    addWarGoal: (conflictId, type, target, reward) => controller.addWarGoal(conflictId, type, target, reward),
    simulateBattle: (attackerFleet, defenderFleet) => controller.simulateBattle(attackerFleet, defenderFleet),
    getConflict: (conflictId) => controller.getConflict(conflictId),
    getAllConflicts: () => controller.getAllConflicts(),
    getActiveConflicts: () => controller.getActiveConflicts(),
    getFactionRelations: (factionId) => controller.getFactionRelations(factionId),
    getCasualties: (factionId) => controller.getCasualties(factionId),
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
