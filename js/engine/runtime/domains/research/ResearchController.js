/**
 * ResearchController - Manages technology trees and research progression
 * Responsible for: tech trees, research progress, unlock logic, prerequisites
 * Uses: EventBus for communication, State.js for management
 * 
 * Architecture:
 * - Business Logic Only (no UI rendering)
 * - Pure Calculations in nested ResearchCalculations class
 * - Dependency Injection for repository, eventBus, logger
 * - State is immutable, changes via State.js
 */

import State from '../shared/State.js';

export class ResearchController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;
    
    // State schema with validation
    this.state = new State({
      technologies: {}, // { techId: { id, name, category, tier, cost, progress, status, prerequisites } }
      researchPoints: 0, // Total research points accumulated
      pointsPerTurn: 10, // Research points generated per turn
      categories: {}, // { category: { completed: 0, total: 0 } }
      activeResearch: null, // Currently researching tech ID
      completedTechs: [], // Array of completed tech IDs
      lockedTechs: [], // Tech IDs that cannot be researched
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      researchPoints: { type: 'number', min: 0 },
      pointsPerTurn: { type: 'number', min: 1 },
      isLocked: { type: 'boolean' },
    });
    
    this.calculations = new ResearchCalculations();
    this._initializeTechTree(); // Setup default tech tree
    this.onStateChange = null; // UI callback
    this.onError = null; // Error callback
  }

  /**
   * Initialize default technology tree
   * @private
   */
  _initializeTechTree() {
    const technologies = {
      // Tier 1: Basic Technologies
      'tech_basic_engines': {
        id: 'tech_basic_engines',
        name: 'Basic Engines',
        description: 'Improves ship speed by 10%',
        category: 'propulsion',
        tier: 1,
        cost: 100,
        progress: 0,
        status: 'available', // 'available', 'researching', 'completed', 'locked'
        prerequisites: [],
        benefit: { shipSpeed: 1.1 },
      },
      'tech_basic_armor': {
        id: 'tech_basic_armor',
        name: 'Basic Armor',
        description: 'Increases ship health by 15%',
        category: 'defense',
        tier: 1,
        cost: 120,
        progress: 0,
        status: 'available',
        prerequisites: [],
        benefit: { shipHealth: 1.15 },
      },
      'tech_basic_weapons': {
        id: 'tech_basic_weapons',
        name: 'Basic Weapons',
        description: 'Increases weapon damage by 12%',
        category: 'offense',
        tier: 1,
        cost: 110,
        progress: 0,
        status: 'available',
        prerequisites: [],
        benefit: { weaponDamage: 1.12 },
      },

      // Tier 2: Advanced Technologies
      'tech_advanced_engines': {
        id: 'tech_advanced_engines',
        name: 'Advanced Engines',
        description: 'Improves ship speed by 25%',
        category: 'propulsion',
        tier: 2,
        cost: 300,
        progress: 0,
        status: 'locked',
        prerequisites: ['tech_basic_engines'],
        benefit: { shipSpeed: 1.25 },
      },
      'tech_shielding': {
        id: 'tech_shielding',
        name: 'Shield Technology',
        description: 'Adds shield layer, absorbs 100 damage',
        category: 'defense',
        tier: 2,
        cost: 350,
        progress: 0,
        status: 'locked',
        prerequisites: ['tech_basic_armor'],
        benefit: { shipShield: 100 },
      },
      'tech_heavy_weapons': {
        id: 'tech_heavy_weapons',
        name: 'Heavy Weapons',
        description: 'Increases weapon damage by 30%',
        category: 'offense',
        tier: 2,
        cost: 320,
        progress: 0,
        status: 'locked',
        prerequisites: ['tech_basic_weapons'],
        benefit: { weaponDamage: 1.3 },
      },

      // Tier 3: Elite Technologies
      'tech_quantum_engines': {
        id: 'tech_quantum_engines',
        name: 'Quantum Engines',
        description: 'Improves ship speed by 50%',
        category: 'propulsion',
        tier: 3,
        cost: 800,
        progress: 0,
        status: 'locked',
        prerequisites: ['tech_advanced_engines'],
        benefit: { shipSpeed: 1.5 },
      },
      'tech_adaptive_armor': {
        id: 'tech_adaptive_armor',
        name: 'Adaptive Armor',
        description: 'Armor repairs 5% health per turn',
        category: 'defense',
        tier: 3,
        cost: 900,
        progress: 0,
        status: 'locked',
        prerequisites: ['tech_shielding'],
        benefit: { armorRegen: 0.05 },
      },
    };

    this.state.set('technologies', technologies);
    this._updateCategories();
  }

  /**
   * Update category statistics
   * @private
   */
  _updateCategories() {
    const techs = this.state.get('technologies');
    const categories = {};

    Object.values(techs).forEach(tech => {
      if (!categories[tech.category]) {
        categories[tech.category] = { completed: 0, total: 0 };
      }
      categories[tech.category].total++;
      if (tech.status === 'completed') {
        categories[tech.category].completed++;
      }
    });

    this.state.set('categories', categories);
  }

  /**
   * Start researching a technology
   */
  startResearch(techId) {
    if (this.state.get('isLocked')) {
      throw new Error('Research system is locked');
    }

    const technologies = this.state.get('technologies');
    const tech = technologies[techId];

    if (!tech) {
      throw new Error(`Technology ${techId} not found`);
    }

    if (tech.status === 'completed') {
      throw new Error(`Technology ${techId} already completed`);
    }

    if (tech.status === 'locked') {
      throw new Error(`Technology ${techId} is locked (prerequisites not met)`);
    }

    // Check prerequisites
    const canResearch = this._checkPrerequisites(tech);
    if (!canResearch) {
      throw new Error(`Prerequisites not met for ${techId}`);
    }

    const activeResearch = this.state.get('activeResearch');
    if (activeResearch) {
      throw new Error('Already researching a technology');
    }

    // Set as active research
    tech.status = 'researching';
    technologies[techId] = tech;
    this.state.set('technologies', technologies);
    this.state.set('activeResearch', techId);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('research:started', {
        techId,
        techName: tech.name,
        cost: tech.cost,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'research-started', tech });
  }

  /**
   * Add research points (from gameplay)
   */
  addResearchPoints(amount) {
    if (this.state.get('isLocked')) return;

    const currentPoints = this.state.get('researchPoints');
    const newPoints = currentPoints + amount;
    this.state.set('researchPoints', newPoints);

    // Check if active research is complete
    const activeResearch = this.state.get('activeResearch');
    if (activeResearch) {
      const technologies = this.state.get('technologies');
      const tech = technologies[activeResearch];

      if (tech) {
        tech.progress = Math.min(100, (newPoints / tech.cost) * 100);

        if (newPoints >= tech.cost) {
          this._completeResearch(activeResearch);
        } else {
          technologies[activeResearch] = tech;
          this.state.set('technologies', technologies);
        }
      }
    }

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.onStateChange) this.onStateChange({ type: 'points-added', amount, total: newPoints });
  }

  /**
   * Complete research for a technology
   * @private
   */
  _completeResearch(techId) {
    const technologies = this.state.get('technologies');
    const tech = technologies[techId];

    if (!tech) return;

    tech.status = 'completed';
    tech.progress = 100;
    technologies[techId] = tech;
    this.state.set('technologies', technologies);

    // Deduct cost from research points
    const currentPoints = this.state.get('researchPoints');
    this.state.set('researchPoints', currentPoints - tech.cost);

    // Add to completed list
    const completedTechs = this.state.get('completedTechs');
    completedTechs.push(techId);
    this.state.set('completedTechs', completedTechs);

    // Clear active research
    this.state.set('activeResearch', null);

    // Unlock dependent technologies
    this._unlockDependentTechs(techId);

    // Update categories
    this._updateCategories();

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('research:completed', {
        techId,
        techName: tech.name,
        benefit: tech.benefit,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'research-completed', tech });
  }

  /**
   * Unlock technologies that depend on completed tech
   * @private
   */
  _unlockDependentTechs(completedTechId) {
    const technologies = this.state.get('technologies');

    Object.values(technologies).forEach(tech => {
      if (tech.status === 'locked' && tech.prerequisites.includes(completedTechId)) {
        const allPrerequisitesMet = this._checkPrerequisites(tech);
        if (allPrerequisitesMet) {
          tech.status = 'available';
          technologies[tech.id] = tech;
        }
      }
    });

    this.state.set('technologies', technologies);
  }

  /**
   * Check if all prerequisites are met for a technology
   * @private
   */
  _checkPrerequisites(tech) {
    const completedTechs = this.state.get('completedTechs');

    if (tech.prerequisites.length === 0) return true;

    return tech.prerequisites.every(prereq => completedTechs.includes(prereq));
  }

  /**
   * Cancel current research
   */
  cancelResearch() {
    if (this.state.get('isLocked')) {
      throw new Error('Research system is locked');
    }

    const activeResearch = this.state.get('activeResearch');
    if (!activeResearch) {
      throw new Error('No active research to cancel');
    }

    const technologies = this.state.get('technologies');
    const tech = technologies[activeResearch];

    tech.status = 'available';
    tech.progress = 0;
    technologies[activeResearch] = tech;
    this.state.set('technologies', technologies);
    this.state.set('activeResearch', null);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('research:cancelled', {
        techId: activeResearch,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'research-cancelled', tech });
  }

  /**
   * Get technology details
   */
  getTechnology(techId) {
    return this.state.get('technologies')?.[techId] || null;
  }

  /**
   * Get technologies by category
   */
  getTechesByCategory(category) {
    const techs = this.state.get('technologies');
    return Object.values(techs).filter(t => t.category === category);
  }

  /**
   * Get all technologies
   */
  getAllTechnologies() {
    return Object.values(this.state.get('technologies') || {});
  }

  /**
   * Get research progress (0-100%)
   */
  getResearchProgress() {
    const activeResearch = this.state.get('activeResearch');
    if (!activeResearch) return 0;

    const tech = this.getTechnology(activeResearch);
    return tech ? tech.progress : 0;
  }

  /**
   * Lock/unlock the research system
   */
  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('research:locked', {});
    if (this.onStateChange) this.onStateChange({ type: 'locked' });
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('research:unlocked', {});
    if (this.onStateChange) this.onStateChange({ type: 'unlocked' });
  }

  /**
   * Save research state to repository
   */
  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('research-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('research:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  /**
   * Load research state from repository
   */
  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('research-state');
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
 * ResearchCalculations - Pure math for research mechanics
 */
class ResearchCalculations {
  /**
   * Calculate research points per turn based on factors
   */
  calculatePointsPerTurn(basePoints, bonusMultiplier = 1.0) {
    return Math.floor(basePoints * bonusMultiplier);
  }

  /**
   * Calculate time to complete research (in turns)
   */
  calculateCompletionTime(techCost, pointsPerTurn) {
    return Math.ceil(techCost / pointsPerTurn);
  }

  /**
   * Calculate technology value for economy/trade
   */
  calculateTechValue(tier, category) {
    const tierMultiplier = Math.pow(2, tier - 1); // 1x, 2x, 4x per tier
    const categoryValue = category === 'propulsion' ? 1.0 : category === 'offense' ? 1.2 : 1.1;
    return Math.floor(100 * tierMultiplier * categoryValue);
  }

  /**
   * Predict research progression (ETA)
   */
  predictProgressionETA(techs, currentPoints, pointsPerTurn) {
    let totalCost = 0;
    techs.forEach(tech => {
      if (tech.status !== 'completed') {
        totalCost += tech.cost;
      }
    });

    const remainingCost = totalCost - currentPoints;
    return Math.ceil(remainingCost / pointsPerTurn);
  }
}

export { ResearchCalculations };
