/**
 * Diplomacy Domain Initialization
 */

import { DiplomacyController } from './DiplomacyController.js';
import { DiplomacyUI } from './DiplomacyUI.js';

export async function initializeDiplomacyDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  const controller = new DiplomacyController({ eventBus, repository, logger });

  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load diplomacy state:', error.message);
    }
  }

  let ui = null;
  if (domTarget) {
    ui = new DiplomacyUI(controller, domTarget);
  }

  return {
    name: 'diplomacy',
    controller,
    ui,
    modifyRelation: (fA, fB, delta) => controller.modifyRelation(fA, fB, delta),
    signTreaty: (fA, fB, type, duration) => controller.signTreaty(fA, fB, type, duration),
    reportIncident: (fA, fB, type, sev) => controller.reportIncident(fA, fB, type, sev),
    establishTradeRoute: (fA, fB, m, e, c) => controller.establishTradeRoute(fA, fB, m, e, c),
    getRelation: (fA, fB) => controller.getRelation(fA, fB),
    getAllRelations: () => controller.getAllRelations(),
    getFactionTreaties: (fId) => controller.getFactionTreaties(fId),
    getIncidents: () => controller.getIncidents(),
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
