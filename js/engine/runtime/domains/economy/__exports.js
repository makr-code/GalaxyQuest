/**
 * Economy Domain Exports
 * Registers EconomyController with window.GQGame facade
 * 
 * This file initializes and connects the economy domain to the main game instance
 */

import { EconomyController, EconomyCalculations } from './EconomyController.js';
import EconomyUI from './EconomyUI.js';

// Initialize economy domain
export async function initializeEconomyDomain(config) {
  // Validate dependencies
  if (!config.eventBus) {
    throw new Error('EconomyDomain requires eventBus in config');
  }

  // Create controller
  const controller = new EconomyController({
    eventBus: config.eventBus,
    repository: config.repository,
    logger: config.logger
  });

  // Load initial state from repository
  if (config.repository) {
    try {
      await controller.load();
    } catch (error) {
      console.warn('[EconomyDomain] Failed to load initial state:', error);
    }
  }

  // Create UI if DOM target provided
  let ui = null;
  if (config.domTarget) {
    ui = new EconomyUI(controller, config.domTarget);
  }

  // Return domain interface
  return {
    name: 'economy',
    controller,
    ui,
    calculations: new EconomyCalculations(),

    // Public API methods
    getTaxRate: () => controller.state.get('taxRate'),
    setTaxRate: (rate) => controller.setTaxRate(rate),
    
    getSubsidyRate: () => controller.state.get('subsidyRate'),
    setSubsidyRate: (rate) => controller.setSubsidyRate(rate),
    
    calculateDemands: (colonies) => controller.calculateDemands(colonies),
    calculateRevenue: (income, taxRate) => controller.calculateRevenue(income, taxRate),
    
    getState: () => controller.getState(),
    save: () => controller.save(),
    load: () => controller.load(),
    
    // Lifecycle
    shutdown: async () => {
      await controller.save();
      ui = null;
    }
  };
}

export { EconomyController, EconomyUI, EconomyCalculations };
