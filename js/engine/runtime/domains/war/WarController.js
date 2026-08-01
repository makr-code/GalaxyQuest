/**
 * WarController - Manages war, diplomacy, and conflict resolution
 * Responsible for: conflict declarations, peace treaties, objectives, and battle outcome calculations
 * Uses: EventBus for communication, State.js for management, FleetController/EconomyController data
 * 
 * Architecture:
 * - Business Logic Only (no UI rendering)
 * - Pure Calculations in nested WarCalculations class
 * - Dependency Injection for repository, eventBus, logger
 * - State is immutable, changes via State.js
 */

import State from '../shared/State.js';

export class WarController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;
    
    // State schema with validation
    this.state = new State({
      conflicts: {}, // { conflictId: { id, factionA, factionB, startDate, status } }
      activeConflicts: [], // Array of active conflict IDs
      peaceTreaties: {}, // { treatyId: { id, factions, startDate, duration, terms } }
      warGoals: {}, // { goalId: { id, conflictId, type, target, progress, reward } }
      diplomacyRecords: {}, // History of diplomatic actions
      casualtiesByFaction: {}, // { factionId: { ships, ground, economy } }
      tributeRate: 0, // War-enforced tribute (0-100%)
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      tributeRate: { type: 'number', min: 0, max: 100 },
      isLocked: { type: 'boolean' },
    });
    
    this.calculations = new WarCalculations();
    this.onStateChange = null; // UI callback
    this.onError = null; // Error callback
  }

  /**
   * Declare war between two factions
   */
  declareWar(factionA, factionB, reason = 'unknown') {
    if (this.state.get('isLocked')) {
      throw new Error('War system is locked');
    }

    const conflictId = `conflict_${factionA}_${factionB}_${Date.now()}`;
    const conflict = {
      id: conflictId,
      factionA,
      factionB,
      startDate: Date.now(),
      status: 'active', // 'active', 'paused', 'concluded'
      reason,
      victoryCondition: null,
      victor: null,
    };

    // Add to conflicts
    const conflicts = this.state.get('conflicts');
    conflicts[conflictId] = conflict;
    this.state.set('conflicts', conflicts);

    // Add to active conflicts
    const activeConflicts = this.state.get('activeConflicts');
    activeConflicts.push(conflictId);
    this.state.set('activeConflicts', activeConflicts);

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('war:conflict-declared', {
        conflictId,
        factionA,
        factionB,
        reason,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'conflict-declared', conflict });
  }

  /**
   * Sign peace treaty between two factions
   */
  signPeaceTreaty(factionA, factionB, duration = 30) {
    if (this.state.get('isLocked')) {
      throw new Error('War system is locked');
    }

    // Find active conflict
    const conflicts = this.state.get('conflicts');
    const activeConflict = Object.values(conflicts).find(
      c => c.status === 'active' && 
           ((c.factionA === factionA && c.factionB === factionB) ||
            (c.factionA === factionB && c.factionB === factionA))
    );

    if (!activeConflict) {
      throw new Error('No active conflict between these factions');
    }

    const treatyId = `treaty_${factionA}_${factionB}_${Date.now()}`;
    const treaty = {
      id: treatyId,
      factions: [factionA, factionB],
      startDate: Date.now(),
      duration, // days
      status: 'active',
      terms: {
        reparations: 0,
        tribute: 0,
        territories: [],
      },
    };

    // Add treaty
    const peaceTreaties = this.state.get('peaceTreaties');
    peaceTreaties[treatyId] = treaty;
    this.state.set('peaceTreaties', peaceTreaties);

    // Mark conflict as concluded
    activeConflict.status = 'concluded';
    activeConflict.victor = null;
    conflicts[activeConflict.id] = activeConflict;
    this.state.set('conflicts', conflicts);

    // Remove from active conflicts
    const activeConflicts = this.state.get('activeConflicts');
    const idx = activeConflicts.indexOf(activeConflict.id);
    if (idx !== -1) activeConflicts.splice(idx, 1);
    this.state.set('activeConflicts', activeConflicts);

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('war:peace-signed', {
        treatyId,
        factions: [factionA, factionB],
        duration,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'peace-signed', treaty });
  }

  /**
   * Add war goal to conflict
   */
  addWarGoal(conflictId, type, target, reward = 1000) {
    if (this.state.get('isLocked')) {
      throw new Error('War system is locked');
    }

    const goal = {
      id: `goal_${conflictId}_${Date.now()}`,
      conflictId,
      type, // 'capture_territory', 'destroy_fleet', 'economic_damage', 'blockade'
      target, // territory_id, fleet_id, etc.
      progress: 0, // 0-100%
      reward,
      status: 'active',
    };

    const warGoals = this.state.get('warGoals');
    warGoals[goal.id] = goal;
    this.state.set('warGoals', warGoals);

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('war:goal-added', {
        goalId: goal.id,
        conflictId,
        type,
        reward,
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'war-goal-added', goal });
  }

  /**
   * Simulate battle between two fleets (returns outcome data)
   * Called by BattleController, uses FleetCalculations data
   */
  simulateBattle(attackerFleetData, defenderFleetData) {
    const outcome = this.calculations.calculateBattleOutcome(
      attackerFleetData,
      defenderFleetData
    );

    // Record casualties
    const casualties = this.state.get('casualtiesByFaction');
    if (!casualties[attackerFleetData.factionId]) {
      casualties[attackerFleetData.factionId] = { ships: 0, ground: 0, economy: 0 };
    }
    if (!casualties[defenderFleetData.factionId]) {
      casualties[defenderFleetData.factionId] = { ships: 0, ground: 0, economy: 0 };
    }

    casualties[attackerFleetData.factionId].ships += outcome.attackerCasualties.ships;
    casualties[defenderFleetData.factionId].ships += outcome.defenderCasualties.ships;

    this.state.set('casualtiesByFaction', casualties);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('war:battle-concluded', {
        attacker: attackerFleetData.factionId,
        defender: defenderFleetData.factionId,
        victor: outcome.victor,
        attackerCasualties: outcome.attackerCasualties.ships,
        defenderCasualties: outcome.defenderCasualties.ships,
      });
    }

    return outcome;
  }

  /**
   * Get conflict details
   */
  getConflict(conflictId) {
    return this.state.get('conflicts')?.[conflictId] || null;
  }

  /**
   * Get all conflicts (active and concluded)
   */
  getAllConflicts() {
    return Object.values(this.state.get('conflicts') || {});
  }

  /**
   * Get active conflicts only
   */
  getActiveConflicts() {
    const activeIds = this.state.get('activeConflicts') || [];
    const conflicts = this.state.get('conflicts') || {};
    return activeIds.map(id => conflicts[id]).filter(Boolean);
  }

  /**
   * Get faction relations (diplomatic stance)
   */
  getFactionRelations(factionId) {
    const relations = {};
    const conflicts = this.state.get('conflicts') || {};
    const peaceTreaties = this.state.get('peaceTreaties') || {};

    Object.values(conflicts).forEach(conflict => {
      if (conflict.factionA === factionId) {
        relations[conflict.factionB] = conflict.status === 'active' ? 'war' : 'peace';
      } else if (conflict.factionB === factionId) {
        relations[conflict.factionA] = conflict.status === 'active' ? 'war' : 'peace';
      }
    });

    Object.values(peaceTreaties).forEach(treaty => {
      if (treaty.factions.includes(factionId)) {
        const other = treaty.factions.find(f => f !== factionId);
        relations[other] = 'peace_treaty';
      }
    });

    return relations;
  }

  /**
   * Get casualties for faction
   */
  getCasualties(factionId) {
    return this.state.get('casualtiesByFaction')?.[factionId] || {
      ships: 0,
      ground: 0,
      economy: 0,
    };
  }

  /**
   * Lock/unlock the war system (prevent changes during critical operations)
   */
  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('war:locked', {});
    if (this.onStateChange) this.onStateChange({ type: 'locked' });
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('war:unlocked', {});
    if (this.onStateChange) this.onStateChange({ type: 'unlocked' });
  }

  /**
   * Save war state to repository
   */
  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('war-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('war:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  /**
   * Load war state from repository
   */
  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('war-state');
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
 * WarCalculations - Pure math for war mechanics
 * No side effects, fully testable
 */
class WarCalculations {
  /**
   * Calculate battle outcome between two fleets
   * Returns: { victor, attackerCasualties, defenderCasualties, victor_damage_pct }
   */
  calculateBattleOutcome(attackerFleet, defenderFleet) {
    const attackerStrength = attackerFleet.strength || this.calculateFleetStrength(attackerFleet);
    const defenderStrength = defenderFleet.strength || this.calculateFleetStrength(defenderFleet);

    const totalStrength = attackerStrength + defenderStrength;
    const attackerAdvantage = attackerStrength / totalStrength;

    // Attacker has ~55% advantage in offensive position
    const attackerWinChance = Math.min(0.95, Math.max(0.05, attackerAdvantage + 0.05));
    const isAttackerVictory = Math.random() < attackerWinChance;

    if (isAttackerVictory) {
      const victoryMargin = attackerAdvantage - 0.5; // How much stronger attacker was
      const defenderLoss = Math.floor(defenderFleet.shipCount * (0.4 + victoryMargin * 0.5));
      const attackerLoss = Math.floor(attackerFleet.shipCount * (0.1 + Math.random() * 0.2));

      return {
        victor: 'attacker',
        attackerCasualties: { ships: attackerLoss, ground: 0, economy: 0 },
        defenderCasualties: { ships: defenderLoss, ground: 0, economy: 0 },
        victoryMarginPercent: (attackerAdvantage - 0.5) * 100,
      };
    } else {
      const victoryMargin = (1 - attackerAdvantage) - 0.5;
      const attackerLoss = Math.floor(attackerFleet.shipCount * (0.4 + victoryMargin * 0.5));
      const defenderLoss = Math.floor(defenderFleet.shipCount * (0.1 + Math.random() * 0.2));

      return {
        victor: 'defender',
        attackerCasualties: { ships: attackerLoss, ground: 0, economy: 0 },
        defenderCasualties: { ships: defenderLoss, ground: 0, economy: 0 },
        victoryMarginPercent: (attackerAdvantage - 0.5) * 100,
      };
    }
  }

  /**
   * Calculate fleet strength from ship data
   * Ship classes: fighter (10), corvette (25), destroyer (50), cruiser (100), etc.
   */
  calculateFleetStrength(fleet) {
    const shipScores = {
      fighter: 10,
      corvette: 25,
      destroyer: 50,
      cruiser: 100,
      battlecruiser: 200,
      battleship: 400,
      dreadnought: 800,
    };

    let strength = 0;
    const ships = fleet.ships || [];
    ships.forEach(ship => {
      const score = shipScores[ship.class] || 10;
      strength += score;
    });

    return strength;
  }

  /**
   * Calculate war reparations based on victor strength and loser economy
   */
  calculateReparations(victorFleetStrength, loserEconomyData) {
    const baseReparation = loserEconomyData.totalIncome || 1000;
    const damageMultiplier = Math.min(2.0, victorFleetStrength / 1000); // Scale by fleet power
    return Math.floor(baseReparation * damageMultiplier);
  }

  /**
   * Calculate forced tribute (% of income loser must pay victor)
   */
  calculateTributePct(victorStrength, loserStrength) {
    const ratio = victorStrength / (loserStrength || 1);
    return Math.min(50, Math.floor(ratio * 10)); // 0-50% tribute
  }

  /**
   * Calculate war weariness (how tired a faction is of war)
   * Based on: duration, casualty count, economic loss
   */
  calculateWarWeariness(conflictData, casualtyData, economicLoss) {
    const durationDays = (Date.now() - conflictData.startDate) / (1000 * 60 * 60 * 24);
    const casualtyCount = casualtyData.ships + casualtyData.ground;
    
    let weariness = 0;
    weariness += durationDays * 0.5; // +0.5 per day
    weariness += casualtyCount * 2; // +2 per casualty
    weariness += (economicLoss / 1000) * 1; // +1 per 1000 economic loss

    return Math.min(100, weariness);
  }
}

export { WarCalculations };
