/**
 * NPC Domain Initialization
 */

import { NPCController } from './NPCController.js';
import { NPCUI } from './NPCUI.js';

export async function initializeNPCDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  const controller = new NPCController({ eventBus, repository, logger });

  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load NPC state:', error.message);
    }
  }

  let ui = null;
  if (domTarget) {
    ui = new NPCUI(controller, domTarget);
  }

  return {
    name: 'npc',
    controller,
    ui,
    executeNPCTurn: (npcId) => controller.executeNPCTurn(npcId),
    generateQuest: (npcId, type) => controller.generateQuest(npcId, type),
    completeQuest: (questId) => controller.completeQuest(questId),
    getNPC: (id) => controller.getNPC(id),
    getAllNPCs: () => controller.getAllNPCs(),
    getNPCQuests: (id, status) => controller.getNPCQuests(id, status),
    getRelationship: (a, b) => controller.getRelationship(a, b),
    getActiveQuests: () => controller.getActiveQuests(),
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
