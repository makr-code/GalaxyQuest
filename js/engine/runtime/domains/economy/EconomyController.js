/**
 * EconomyController - Main facade for economy domain
 * Handles business logic without UI concerns
 * 
 * Responsibility: Game rules, validation, state management
 * Not responsible for: DOM rendering, API calls
 */

import State from '../shared/State.js';

class EconomyController {
  constructor(config = {}) {
    // Injected dependencies
    this.config = {
      repository: config.repository,  // For persistence
      eventBus: config.eventBus,      // For notifications
      logger: config.logger || console,
      ...config
    };

    // State with schema validation
    this.state = new State(
      {
        taxRate: 0,
        subsidyRate: 0,
        tributeRate: 0,
        colonies: {},
        demands: {},
        isLocked: false,
        lastModified: null,
        isDirty: false
      },
      {
        taxRate: { type: 'number', min: 0, max: 100 },
        subsidyRate: { type: 'number', min: 0, max: 100 },
        tributeRate: { type: 'number', min: 0, max: 100 }
      }
    );

    // UI callbacks
    this.callbacks = {
      onStateChange: null,
      onError: null
    };

    // Calculations helper
    this.calculations = new EconomyCalculations();

    // Setup state observer
    this.state.subscribe((path, newValue, oldValue) => {
      this._onStateChanged(path, newValue, oldValue);
    });
  }

  /**
   * Set tax rate with validation
   * @param {number} rate - Tax rate 0-100
   * @throws {Error} If invalid or locked
   */
  setTaxRate(rate) {
    this._ensureNotLocked();
    
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new Error(`Invalid tax rate: ${rate} (must be 0-100)`);
    }

    this.state.set('taxRate', rate);
    this.state.set('lastModified', new Date().toISOString());
    this.state.set('isDirty', true);

    // Emit event for cross-domain subscribers
    this.config.eventBus?.emit('economy:tax-rate-changed', {
      taxRate: rate,
      timestamp: Date.now()
    });
  }

  /**
   * Set subsidy rate
   * @param {number} rate - Subsidy rate 0-100
   */
  setSubsidyRate(rate) {
    this._ensureNotLocked();
    
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new Error(`Invalid subsidy rate: ${rate}`);
    }

    this.state.set('subsidyRate', rate);
    this.state.set('lastModified', new Date().toISOString());
    this.state.set('isDirty', true);

    this.config.eventBus?.emit('economy:subsidy-rate-changed', {
      subsidyRate: rate,
      timestamp: Date.now()
    });
  }

  /**
   * Calculate demand for all colonies
   * @param {Array} colonies - Colony data
   * @returns {Object} Demands by resource
   */
  calculateDemands(colonies) {
    if (!Array.isArray(colonies)) {
      throw new Error('Colonies must be an array');
    }

    const demands = this.calculations.calculateGlobalDemands(
      colonies,
      this.state.get('taxRate'),
      this.state.get('subsidyRate')
    );

    this.state.set('demands', demands);
    return demands;
  }

  /**
   * Calculate revenue for given parameters
   * @param {number} baseIncome - Base income
   * @param {number} taxRate - Optional override tax rate
   * @returns {number} Revenue amount
   */
  calculateRevenue(baseIncome, taxRate) {
    if (!Number.isFinite(baseIncome)) {
      throw new Error('Base income must be a number');
    }

    const rate = taxRate !== undefined ? taxRate : this.state.get('taxRate');
    return this.calculations.calculateRevenue(baseIncome, rate);
  }

  /**
   * Get current economy state
   * @returns {Object} Cloned state object
   */
  getState() {
    return this.state.clone();
  }

  /**
   * Register UI callback for state changes
   * @param {Function} callback - (path, newValue) => void
   */
  onStateChange(callback) {
    this.callbacks.onStateChange = callback;
  }

  /**
   * Register UI callback for errors
   * @param {Function} callback - (error) => void
   */
  onError(callback) {
    this.callbacks.onError = callback;
  }

  /**
   * Lock economy (admin/maintenance mode)
   */
  lock() {
    this.state.set('isLocked', true);
    this.config.eventBus?.emit('economy:locked');
  }

  /**
   * Unlock economy
   */
  unlock() {
    this.state.set('isLocked', false);
    this.config.eventBus?.emit('economy:unlocked');
  }

  /**
   * Persist state to repository
   * @returns {Promise<void>}
   */
  async save() {
    if (!this.state.get('isDirty')) {
      return; // No changes
    }

    if (!this.config.repository) {
      throw new Error('No repository configured for persistence');
    }

    try {
      await this.config.repository.saveEconomyState(this.getState());
      this.state.set('isDirty', false);
      this.config.eventBus?.emit('economy:saved');
    } catch (error) {
      this.config.logger.error('[Economy] Save failed:', error);
      throw error;
    }
  }

  /**
   * Load state from repository
   * @returns {Promise<void>}
   */
  async load() {
    if (!this.config.repository) {
      throw new Error('No repository configured for loading');
    }

    try {
      const saved = await this.config.repository.loadEconomyState();
      if (saved) {
        this.state.batch(saved);
        this.state.set('isDirty', false);
      }
    } catch (error) {
      this.config.logger.error('[Economy] Load failed:', error);
      throw error;
    }
  }

  /**
   * Get change history
   * @returns {Array} History entries
   */
  getHistory(limit = 50) {
    return this.state.getHistory(limit);
  }

  // Private methods

  /**
   * Ensure economy is not locked
   * @private
   */
  _ensureNotLocked() {
    if (this.state.get('isLocked')) {
      throw new Error('Economy is locked, cannot make changes');
    }
  }

  /**
   * Handle state changes (notify UI)
   * @private
   */
  _onStateChanged(path, newValue, oldValue) {
    this.callbacks.onStateChange?.({
      path,
      newValue,
      oldValue,
      timestamp: Date.now()
    });
  }
}

/**
 * Pure calculations (no state, testable, deterministic)
 */
class EconomyCalculations {
  /**
   * Calculate global demands based on colonies
   * @param {Array} colonies - Colony data
   * @param {number} taxRate - Current tax rate
   * @param {number} subsidyRate - Current subsidy rate
   * @returns {Object} Demands object
   */
  calculateGlobalDemands(colonies, taxRate, subsidyRate) {
    const totalDemands = {
      food: 0,
      minerals: 0,
      energy: 0,
      credit: 0
    };

    for (const colony of colonies) {
      const colonlyDemands = this.calculateColonyDemand(colony, taxRate, subsidyRate);
      
      for (const [resource, amount] of Object.entries(colonlyDemands)) {
        totalDemands[resource] += amount;
      }
    }

    return totalDemands;
  }

  /**
   * Calculate demand for single colony
   * @param {Object} colony - Colony data
   * @param {number} taxRate - Tax rate
   * @param {number} subsidyRate - Subsidy rate
   * @returns {Object} Demands { food, minerals, energy, credit }
   */
  calculateColonyDemand(colony, taxRate, subsidyRate) {
    const basePopulation = colony.population || 0;
    const buildings = colony.buildings?.length || 0;

    return {
      food: Math.ceil(basePopulation * 0.5),              // 0.5 per pop
      minerals: Math.ceil(buildings * 10),                 // 10 per building
      energy: Math.ceil((basePopulation + buildings) * 0.3), // 0.3 per pop+building
      credit: Math.ceil(basePopulation * (taxRate / 100)) // Based on tax
    };
  }

  /**
   * Calculate revenue from income
   * @param {number} baseIncome - Base income
   * @param {number} taxRate - Tax rate 0-100
   * @returns {number} Revenue
   */
  calculateRevenue(baseIncome, taxRate) {
    if (baseIncome <= 0) return 0;
    return Math.round(baseIncome * (taxRate / 100) * 100) / 100;
  }

  /**
   * Calculate subsidy costs
   * @param {number} basePopulation - Total population
   * @param {number} subsidyRate - Subsidy rate 0-100
   * @returns {number} Total subsidy cost
   */
  calculateSubsidyCost(basePopulation, subsidyRate) {
    if (basePopulation <= 0) return 0;
    return Math.round(basePopulation * (subsidyRate / 100) * 100) / 100;
  }

  /**
   * Calculate balance (income - expenses)
   * @param {Object} data - { income, population, taxRate, subsidyRate }
   * @returns {Object} { revenue, cost, balance }
   */
  calculateBalance(data) {
    const revenue = this.calculateRevenue(data.income, data.taxRate);
    const cost = this.calculateSubsidyCost(data.population, data.subsidyRate);
    
    return {
      revenue,
      cost,
      balance: revenue - cost
    };
  }
}

export { EconomyController, EconomyCalculations };
