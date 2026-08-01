/**
 * ColonizationController - Manages colonies, population, and colony infrastructure
 * Responsible for: colony creation, population growth, buildings, resource production
 * Uses: EventBus for communication, State.js for management
 * 
 * Architecture:
 * - Business Logic Only (no UI rendering)
 * - Pure Calculations in nested ColonizationCalculations class
 * - Dependency Injection for repository, eventBus, logger
 * - State is immutable, changes via State.js
 */

import State from '../shared/State.js';

export class ColonizationController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;
    
    // State schema with validation
    this.state = new State({
      colonies: {}, // { colonyId: { id, name, planetId, population, growth_rate, buildings, resources, defense } }
      buildingTypes: {}, // { buildingId: { type, name, cost, production, upkeep } }
      populationByColony: {}, // { colonyId: { citizens: 0, soldiers: 0, workers: 0 } }
      colonyResources: {}, // { colonyId: { credits: 0, minerals: 0, energy: 0, food: 0 } }
      totalPopulation: 0,
      totalColonies: 0,
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      totalPopulation: { type: 'number', min: 0 },
      totalColonies: { type: 'number', min: 0 },
      isLocked: { type: 'boolean' },
    });
    
    this.calculations = new ColonizationCalculations();
    this._initializeBuildingTypes(); // Setup default buildings
    this.onStateChange = null; // UI callback
    this.onError = null; // Error callback
  }

  /**
   * Initialize building types
   * @private
   */
  _initializeBuildingTypes() {
    const buildingTypes = {
      'factory': {
        id: 'factory',
        name: 'Factory',
        category: 'production',
        cost: { credits: 500, minerals: 200 },
        production: { credits: 50 }, // Per turn
        upkeep: { energy: 10 },
        description: 'Produces credits from resources',
      },
      'mine': {
        id: 'mine',
        name: 'Mineral Mine',
        category: 'production',
        cost: { credits: 400, minerals: 300 },
        production: { minerals: 100 },
        upkeep: { energy: 15 },
        description: 'Extracts minerals from planet',
      },
      'power_plant': {
        id: 'power_plant',
        name: 'Power Plant',
        category: 'infrastructure',
        cost: { credits: 300, minerals: 150 },
        production: { energy: 75 },
        upkeep: { credits: 10 },
        description: 'Generates energy for colony',
      },
      'farm': {
        id: 'farm',
        name: 'Agricultural Farm',
        category: 'production',
        cost: { credits: 200, minerals: 100 },
        production: { food: 80 },
        upkeep: { energy: 5 },
        description: 'Produces food to sustain population',
      },
      'defense_grid': {
        id: 'defense_grid',
        name: 'Defense Grid',
        category: 'defense',
        cost: { credits: 800, minerals: 400 },
        production: { defense: 50 },
        upkeep: { energy: 20, credits: 15 },
        description: 'Protects colony from attacks',
      },
      'housing': {
        id: 'housing',
        name: 'Housing Complex',
        category: 'infrastructure',
        cost: { credits: 300, minerals: 150 },
        production: { population_cap: 5000 },
        upkeep: { energy: 8 },
        description: 'Increases population capacity',
      },
    };

    this.state.set('buildingTypes', buildingTypes);
  }

  /**
   * Colonize a new planet
   */
  colonize(planetId, colonistCount = 1000) {
    if (this.state.get('isLocked')) {
      throw new Error('Colonization system is locked');
    }

    const colonies = this.state.get('colonies');
    if (colonies[planetId]) {
      throw new Error(`Planet ${planetId} is already colonized`);
    }

    const colonyId = `colony_${planetId}_${Date.now()}`;
    const colony = {
      id: colonyId,
      name: `Colony on ${planetId}`,
      planetId,
      population: colonistCount,
      growthRate: 0.05, // 5% per turn
      buildings: {}, // { buildingId: { type: 'farm', count: 3 } }
      resources: { credits: 1000, minerals: 500, energy: 100, food: 500 },
      defense: 0,
      status: 'active', // 'active', 'growing', 'struggling', 'abandoned'
      populationCap: colonistCount * 2, // Can grow to 2x initial
    };

    colonies[colonyId] = colony;
    this.state.set('colonies', colonies);

    // Initialize population distribution
    const populationByColony = this.state.get('populationByColony');
    populationByColony[colonyId] = {
      citizens: Math.floor(colonistCount * 0.7),
      workers: Math.floor(colonistCount * 0.25),
      soldiers: Math.floor(colonistCount * 0.05),
    };
    this.state.set('populationByColony', populationByColony);

    // Update totals
    const totalPopulation = this.state.get('totalPopulation');
    const totalColonies = this.state.get('totalColonies');
    this.state.set('totalPopulation', totalPopulation + colonistCount);
    this.state.set('totalColonies', totalColonies + 1);

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('colonization:colonized', {
        colonyId,
        planetId,
        populationCount: colonistCount,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'colonized', colony });
  }

  /**
   * Add building to colony
   */
  addBuilding(colonyId, buildingType, count = 1) {
    if (this.state.get('isLocked')) {
      throw new Error('Colonization system is locked');
    }

    const colonies = this.state.get('colonies');
    const colony = colonies[colonyId];

    if (!colony) {
      throw new Error(`Colony ${colonyId} not found`);
    }

    const buildingTypes = this.state.get('buildingTypes');
    const buildingDef = buildingTypes[buildingType];

    if (!buildingDef) {
      throw new Error(`Building type ${buildingType} not found`);
    }

    // Check resources
    const requiredCredits = buildingDef.cost.credits * count;
    if (colony.resources.credits < requiredCredits) {
      throw new Error('Insufficient credits for construction');
    }

    // Build
    if (!colony.buildings[buildingType]) {
      colony.buildings[buildingType] = { type: buildingType, count: 0 };
    }

    colony.buildings[buildingType].count += count;
    colony.resources.credits -= requiredCredits;

    // Deduct minerals if needed
    if (buildingDef.cost.minerals) {
      const requiredMinerals = buildingDef.cost.minerals * count;
      colony.resources.minerals -= requiredMinerals;
    }

    colonies[colonyId] = colony;
    this.state.set('colonies', colonies);

    // Update colony defense if defense grid added
    if (buildingType === 'defense_grid') {
      colony.defense += buildingDef.production.defense * count;
      colonies[colonyId] = colony;
      this.state.set('colonies', colonies);
    }

    // Update housing cap if housing added
    if (buildingType === 'housing') {
      colony.populationCap += buildingDef.production.population_cap * count;
      colonies[colonyId] = colony;
      this.state.set('colonies', colonies);
    }

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('colonization:building-constructed', {
        colonyId,
        buildingType,
        count,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'building-added', colony });
  }

  /**
   * Process population growth for all colonies (called once per turn)
   */
  processPopulationGrowth() {
    if (this.state.get('isLocked')) return;

    const colonies = this.state.get('colonies');
    let totalPopulationChange = 0;

    Object.values(colonies).forEach(colony => {
      const currentPop = colony.population;
      const maxPop = colony.populationCap;

      // Growth decelerates as population approaches cap
      const growthFactor = 1 - (currentPop / maxPop);
      const newPop = Math.floor(currentPop * (1 + colony.growthRate * growthFactor));

      const popChange = Math.min(newPop, maxPop) - currentPop;
      colony.population = Math.min(newPop, maxPop);

      // Update status
      if (colony.population >= maxPop) {
        colony.status = 'stable';
      } else if (colony.population < maxPop * 0.3) {
        colony.status = 'struggling';
      } else {
        colony.status = 'growing';
      }

      totalPopulationChange += popChange;
      colonies[colony.id] = colony;
    });

    this.state.set('colonies', colonies);
    const totalPopulation = this.state.get('totalPopulation');
    this.state.set('totalPopulation', totalPopulation + totalPopulationChange);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (totalPopulationChange !== 0 && this.eventBus) {
      this.eventBus.emit('colonization:population-growth', {
        change: totalPopulationChange,
        totalPopulation: this.state.get('totalPopulation'),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Process resource production for all colonies (called once per turn)
   */
  processResourceProduction() {
    if (this.state.get('isLocked')) return;

    const colonies = this.state.get('colonies');
    const buildingTypes = this.state.get('buildingTypes');

    Object.values(colonies).forEach(colony => {
      // Calculate production
      Object.entries(colony.buildings).forEach(([buildingType, building]) => {
        const buildingDef = buildingTypes[buildingType];
        if (!buildingDef) return;

        // Add production
        Object.entries(buildingDef.production).forEach(([resource, amount]) => {
          if (resource !== 'defense' && resource !== 'population_cap') {
            colony.resources[resource] = (colony.resources[resource] || 0) + (amount * building.count);
          }
        });

        // Deduct upkeep
        Object.entries(buildingDef.upkeep || {}).forEach(([resource, amount]) => {
          colony.resources[resource] = Math.max(0, (colony.resources[resource] || 0) - (amount * building.count));
        });
      });

      colonies[colony.id] = colony;
    });

    this.state.set('colonies', colonies);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('colonization:production-processed', {
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get colony details
   */
  getColony(colonyId) {
    return this.state.get('colonies')?.[colonyId] || null;
  }

  /**
   * Get all colonies
   */
  getAllColonies() {
    return Object.values(this.state.get('colonies') || {});
  }

  /**
   * Get building type details
   */
  getBuildingType(buildingType) {
    return this.state.get('buildingTypes')?.[buildingType] || null;
  }

  /**
   * Lock/unlock the colonization system
   */
  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('colonization:locked', {});
    if (this.onStateChange) this.onStateChange({ type: 'locked' });
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('colonization:unlocked', {});
    if (this.onStateChange) this.onStateChange({ type: 'unlocked' });
  }

  /**
   * Save colonization state to repository
   */
  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('colonization-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('colonization:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  /**
   * Load colonization state from repository
   */
  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('colonization-state');
      if (data) {
        this.state = new State(data, this.state.schema);
      }
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  getState() {
    return this.state.clone();
  }
}

/**
 * ColonizationCalculations - Pure math for colonization mechanics
 */
class ColonizationCalculations {
  /**
   * Calculate population growth for a colony
   */
  calculatePopulationGrowth(currentPopulation, maxPopulation, growthRate) {
    const growthFactor = 1 - (currentPopulation / maxPopulation);
    const growth = currentPopulation * growthRate * growthFactor;
    const newPopulation = Math.min(currentPopulation + growth, maxPopulation);
    return Math.floor(newPopulation);
  }

  /**
   * Calculate colony happiness (simplified model)
   */
  calculateHappiness(population, foodProduction, energyProduction, defense) {
    let happiness = 50; // Base 50%

    // Food impact: +/-10% per 100 food per capita
    const foodPerCapita = foodProduction / population;
    happiness += Math.min(10, foodPerCapita * 10);

    // Energy impact
    const energyPerCapita = energyProduction / population;
    happiness += Math.min(5, energyPerCapita * 2);

    // Defense morale
    const defenseBonus = Math.min(10, defense / 10);
    happiness += defenseBonus;

    return Math.max(0, Math.min(100, happiness));
  }

  /**
   * Calculate colony production rate (modified by happiness)
   */
  calculateProductionModifier(happiness) {
    // At 50% happiness: 1.0x, at 100% happiness: 1.3x, at 0%: 0.5x
    return 0.5 + (happiness / 100) * 0.8;
  }

  /**
   * Calculate building construction time (in turns)
   */
  calculateConstructionTime(buildingCost, workerCount) {
    const baseTime = buildingCost / 100; // Base time from cost
    const constructionBonus = workerCount / 100; // Bonus from workers
    return Math.ceil(baseTime / (1 + constructionBonus));
  }

  /**
   * Calculate colonization difficulty for a planet
   */
  calculateColonizationDifficulty(planetTier, distanceFromCapital) {
    const tierMultiplier = Math.pow(1.5, planetTier - 1); // Tier 1 = 1x, Tier 2 = 1.5x, etc.
    const distanceMultiplier = 1 + (distanceFromCapital / 1000) * 0.1; // +0.1% per 1000 distance
    return Math.floor(100 * tierMultiplier * distanceMultiplier);
  }
}

export { ColonizationCalculations };
