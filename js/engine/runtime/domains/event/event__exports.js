/**
 * Event Domain Initialization
 */

import { EventController } from './EventController.js';
import { EventUI } from './EventUI.js';

export async function initializeEventDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  const controller = new EventController({ eventBus, repository, logger });

  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load event state:', error.message);
    }
  }

  let ui = null;
  if (domTarget) {
    ui = new EventUI(controller, domTarget);
  }

  return {
    name: 'event',
    controller,
    ui,
    triggerEvent: (type) => controller.triggerEvent(type),
    createEventChain: (id, types) => controller.createEventChain(id, types),
    progressEventChain: (id) => controller.progressEventChain(id),
    getEvent: (type) => controller.getEvent(type),
    getAllEvents: () => controller.getAllEvents(),
    getTriggeredEvents: () => controller.getTriggeredEvents(),
    getEventLog: (limit) => controller.getEventLog(limit),
    getEventChains: () => controller.getEventChains(),
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
