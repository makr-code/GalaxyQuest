/**
 * FleetController - Fleet Management Domain
 * 
 * Responsibility: Fleet composition, ship management, formations
 * Not responsible for: 3D rendering, UI display
 * 
 * Follows same pattern as EconomyController
 */

import State from '../shared/State.js';

class FleetController {
  constructor(config = {}) {
    this.config = {
      repository: config.repository,
      eventBus: config.eventBus,
      logger: config.logger || console,
      ...config
    };

    // State with schema
    this.state = new State(
      {
        fleets: {},           // { fleetId: { ships: [...], formation: {...} } }
        selectedFleetId: null,
        totalShips: 0,
        totalStrength: 0,
        isDirty: false,
        lastModified: null
      },
      {
        totalShips: { type: 'number', min: 0 },
        totalStrength: { type: 'number', min: 0 }
      }
    );

    // Callbacks
    this.callbacks = {
      onStateChange: null,
      onError: null
    };

    // Calculations helper
    this.calculations = new FleetCalculations();

    // State observer
    this.state.subscribe((path, newValue, oldValue) => {
      this._onStateChanged(path, newValue, oldValue);
    });
  }

  /**
   * Create new fleet with initial ships
   * @param {Object} fleetData - { name, colonyId, ships: [...] }
   * @returns {string} Fleet ID
   * @throws {Error} If validation fails
   */
  createFleet(fleetData) {
    if (!fleetData.name || !fleetData.colonyId) {
      throw new Error('Fleet name and colonyId required');
    }

    const fleetId = `fleet_${Date.now()}`;
    const fleets = this.state.get('fleets') || {};

    fleets[fleetId] = {
      id: fleetId,
      name: fleetData.name,
      colonyId: fleetData.colonyId,
      ships: fleetData.ships || [],
      formation: fleetData.formation || 'line',
      createdAt: new Date().toISOString(),
      isDirty: true
    };

    this.state.set('fleets', fleets);
    this._recalculateTotals();

    this.config.eventBus?.emit('fleet:created', {
      fleetId,
      fleet: fleets[fleetId],
      timestamp: Date.now()
    });

    return fleetId;
  }

  /**
   * Add ship to fleet
   * @param {string} fleetId - Fleet ID
   * @param {Object} ship - { type, class, status, health }
   * @throws {Error} If fleet not found
   */
  addShip(fleetId, ship) {
    const fleets = this.state.get('fleets') || {};
    if (!fleets[fleetId]) {
      throw new Error(`Fleet not found: ${fleetId}`);
    }

    if (!ship.type || !ship.class) {
      throw new Error('Ship type and class required');
    }

    const shipId = `ship_${Date.now()}`;
    ship.id = shipId;
    ship.status = ship.status || 'active';
    ship.health = ship.health || 100;

    fleets[fleetId].ships.push(ship);
    fleets[fleetId].isDirty = true;

    this.state.set('fleets', fleets);
    this._recalculateTotals();

    this.config.eventBus?.emit('fleet:ship-added', {
      fleetId,
      ship,
      timestamp: Date.now()
    });
  }

  /**
   * Remove ship from fleet
   * @param {string} fleetId - Fleet ID
   * @param {string} shipId - Ship ID
   */
  removeShip(fleetId, shipId) {
    const fleets = this.state.get('fleets') || {};
    if (!fleets[fleetId]) {
      throw new Error(`Fleet not found: ${fleetId}`);
    }

    fleets[fleetId].ships = fleets[fleetId].ships.filter(s => s.id !== shipId);
    fleets[fleetId].isDirty = true;

    this.state.set('fleets', fleets);
    this._recalculateTotals();

    this.config.eventBus?.emit('fleet:ship-removed', {
      fleetId,
      shipId,
      timestamp: Date.now()
    });
  }

  /**
   * Set formation (line, wedge, sphere, etc.)
   * @param {string} fleetId - Fleet ID
   * @param {string} formation - Formation type
   */
  setFormation(fleetId, formation) {
    const validFormations = ['line', 'wedge', 'sphere', 'box', 'scattered'];
    if (!validFormations.includes(formation)) {
      throw new Error(`Invalid formation: ${formation}`);
    }

    const fleets = this.state.get('fleets') || {};
    if (!fleets[fleetId]) {
      throw new Error(`Fleet not found: ${fleetId}`);
    }

    fleets[fleetId].formation = formation;
    fleets[fleetId].isDirty = true;

    this.state.set('fleets', fleets);

    this.config.eventBus?.emit('fleet:formation-changed', {
      fleetId,
      formation,
      timestamp: Date.now()
    });
  }

  /**
   * Get fleet details
   * @param {string} fleetId - Fleet ID
   * @returns {Object} Fleet data
   */
  getFleet(fleetId) {
    const fleets = this.state.get('fleets') || {};
    if (!fleets[fleetId]) {
      throw new Error(`Fleet not found: ${fleetId}`);
    }
    return fleets[fleetId];
  }

  /**
   * Get all fleets
   * @returns {Array} Fleet array
   */
  getAllFleets() {
    const fleets = this.state.get('fleets') || {};
    return Object.values(fleets);
  }

  /**
   * Calculate fleet power/strength
   * @param {string} fleetId - Fleet ID
   * @returns {number} Total strength
   */
  calculateFleetStrength(fleetId) {
    const fleets = this.state.get('fleets') || {};
    if (!fleets[fleetId]) {
      throw new Error(`Fleet not found: ${fleetId}`);
    }

    return this.calculations.calculateFleetStrength(fleets[fleetId]);
  }

  /**
   * Get current state
   * @returns {Object} Cloned state
   */
  getState() {
    return this.state.clone();
  }

  /**
   * Register callback for state changes
   * @param {Function} callback
   */
  onStateChange(callback) {
    this.callbacks.onStateChange = callback;
  }

  /**
   * Register callback for errors
   * @param {Function} callback
   */
  onError(callback) {
    this.callbacks.onError = callback;
  }

  /**
   * Save state
   * @returns {Promise<void>}
   */
  async save() {
    if (!this.config.repository) {
      throw new Error('No repository configured');
    }

    try {
      await this.config.repository.saveFleetState(this.getState());
      this.config.eventBus?.emit('fleet:saved');
    } catch (error) {
      this.config.logger.error('[Fleet] Save failed:', error);
      throw error;
    }
  }

  /**
   * Load state
   * @returns {Promise<void>}
   */
  async load() {
    if (!this.config.repository) {
      throw new Error('No repository configured');
    }

    try {
      const saved = await this.config.repository.loadFleetState();
      if (saved) {
        this.state.batch(saved);
      }
    } catch (error) {
      this.config.logger.error('[Fleet] Load failed:', error);
      throw error;
    }
  }

  // Private methods

  /**
   * Recalculate total ships and strength
   * @private
   */
  _recalculateTotals() {
    const fleets = this.state.get('fleets') || {};
    let totalShips = 0;
    let totalStrength = 0;

    for (const fleet of Object.values(fleets)) {
      totalShips += fleet.ships.length;
      totalStrength += this.calculations.calculateFleetStrength(fleet);
    }

    this.state.set('totalShips', totalShips);
    this.state.set('totalStrength', totalStrength);
  }

  /**
   * Handle state changes
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
 * Pure calculations for fleet domain
 */
class FleetCalculations {
  /**
   * Calculate fleet strength from ships
   * @param {Object} fleet - Fleet object
   * @returns {number} Total strength
   */
  calculateFleetStrength(fleet) {
    if (!fleet || !fleet.ships) return 0;

    return fleet.ships.reduce((total, ship) => {
      const baseStrength = this._getShipBaseStrength(ship.class);
      const healthFactor = (ship.health || 100) / 100;
      return total + (baseStrength * healthFactor);
    }, 0);
  }

  /**
   * Calculate ETA between two points
   * @param {Object} from - Coordinates
   * @param {Object} to - Coordinates
   * @param {number} speed - Average fleet speed
   * @returns {number} Hours
   */
  calculateETA(from, to, speed) {
    if (speed <= 0) throw new Error('Speed must be > 0');

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z || 0;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return distance / speed;
  }

  /**
   * Formation efficiency modifier
   * @param {string} formation - Formation type
   * @returns {number} Multiplier (0.5 - 1.5)
   */
  getFormationModifier(formation) {
    const modifiers = {
      'line': 1.2,      // Good for firepower
      'wedge': 1.0,     // Balanced
      'sphere': 0.9,    // Defensive
      'box': 1.1,       // Organized
      'scattered': 0.5  // Weak
    };

    return modifiers[formation] || 1.0;
  }

  /**
   * Calculate casualty effectiveness
   * @param {Object} attackerFleet - Fleet object
   * @param {Object} defenderFleet - Fleet object
   * @returns {Object} { attacker: %, defender: % }
   */
  calculateEffectiveness(attackerFleet, defenderFleet) {
    const attackerStrength = this.calculateFleetStrength(attackerFleet);
    const defenderStrength = this.calculateFleetStrength(defenderFleet);

    if (attackerStrength === 0 && defenderStrength === 0) {
      return { attacker: 50, defender: 50 };
    }

    const total = attackerStrength + defenderStrength;
    return {
      attacker: (attackerStrength / total) * 100,
      defender: (defenderStrength / total) * 100
    };
  }

  // Private helpers

  /**
   * Get base strength for ship class
   * @private
   */
  _getShipBaseStrength(shipClass) {
    const strengths = {
      'fighter': 10,
      'corvette': 25,
      'destroyer': 50,
      'cruiser': 100,
      'battlecruiser': 200,
      'battleship': 400,
      'dreadnought': 800
    };

    return strengths[shipClass] || 10;
  }
}

export { FleetController, FleetCalculations };
