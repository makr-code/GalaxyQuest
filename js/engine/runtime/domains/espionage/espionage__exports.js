/**
 * Espionage Domain Initialization
 */

import { EspionageController } from './EspionageController.js';
import { EspionageUI } from './EspionageUI.js';

export async function initializeEspionageDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  const controller = new EspionageController({ eventBus, repository, logger });

  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load espionage state:', error.message);
    }
  }

  let ui = null;
  if (domTarget) {
    ui = new EspionageUI(controller, domTarget);
  }

  return {
    name: 'espionage',
    controller,
    ui,
    deploySpy: (faction, target, name) => controller.deploySpy(faction, target, name),
    gatherIntelligence: (spyId, type) => controller.gatherIntelligence(spyId, type),
    launchSabotage: (faction, target, type, duration) => controller.launchSabotage(faction, target, type, duration),
    progressSabotage: (opId, amount) => controller.progressSabotage(opId, amount),
    getSpy: (id) => controller.getSpy(id),
    getFactionSpies: (id) => controller.getFactionSpies(id),
    getFactionIntelligence: (id) => controller.getFactionIntelligence(id),
    getOperations: () => controller.getOperations(),
    getSecurity: (id) => controller.getSecurity(id),
    getState: () => controller.getState(),
    save: () => controller.save(),
    load: () => controller.load(),
    lock: () => controller.lock(),
    unlock: () => controller.unlock(),
    shutdown: async () => {
      if (ui?.container) ui.container.innerHTML = '';
      await controller.save();
    },
  };
}
