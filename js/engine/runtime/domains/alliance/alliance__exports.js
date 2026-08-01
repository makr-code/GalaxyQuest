/**
 * Alliance Domain Initialization
 */

import { AllianceController } from './AllianceController.js';
import { AllianceUI } from './AllianceUI.js';

export async function initializeAllianceDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  const controller = new AllianceController({ eventBus, repository, logger });

  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load alliance state:', error.message);
    }
  }

  let ui = null;
  if (domTarget) {
    ui = new AllianceUI(controller, domTarget);
  }

  return {
    name: 'alliance',
    controller,
    ui,
    createAlliance: (name, leader) => controller.createAlliance(name, leader),
    inviteMember: (id, faction) => controller.inviteMember(id, faction),
    contributeToTreasury: (id, faction, c, m, e) => controller.contributeToTreasury(id, faction, c, m, e),
    proposeVote: (id, topic, desc) => controller.proposeVote(id, topic, desc),
    castVote: (voteId, faction, yes) => controller.castVote(voteId, faction, yes),
    getAlliance: (id) => controller.getAlliance(id),
    getAllAlliances: () => controller.getAllAlliances(),
    getMember: (id) => controller.getMember(id),
    getTreasury: (id) => controller.getTreasury(id),
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
