/**
 * Market Domain Initialization
 */

import { MarketController } from './MarketController.js';
import { MarketUI } from './MarketUI.js';

export async function initializeMarketDomain(config = {}) {
  const { eventBus, repository, logger, domTarget } = config;

  const controller = new MarketController({ eventBus, repository, logger });

  if (repository) {
    try {
      await controller.load();
    } catch (error) {
      if (logger) logger.warn('Failed to load market state:', error.message);
    }
  }

  let ui = null;
  if (domTarget) {
    ui = new MarketUI(controller, domTarget);
  }

  return {
    name: 'market',
    controller,
    ui,
    updatePrices: () => controller.updatePrices(),
    executeTrade: (buyer, seller, commodity, qty) => controller.executeTrade(buyer, seller, commodity, qty),
    getCommodity: (name) => controller.getCommodity(name),
    getAllCommodities: () => controller.getAllCommodities(),
    getInventory: (factionId) => controller.getInventory(factionId),
    getRecentTrades: (limit) => controller.getRecentTrades(limit),
    getPriceHistory: (name, limit) => controller.getPriceHistory(name, limit),
    getMarketTrend: (name) => controller.getMarketTrend(name),
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
