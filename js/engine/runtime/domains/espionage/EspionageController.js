/**
 * EspionageController - Manages faction intelligence and sabotage operations
 * Responsible for: spies, intelligence gathering, sabotage, security
 * Uses: EventBus for communication, State.js for management
 */

import State from '../shared/State.js';

export class EspionageController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;

    this.state = new State({
      spies: {}, // { spyId: { id, faction, name, target, status, skill, location } }
      intelligence: {}, // { intelId: { source, target, type, data, reliability, timestamp } }
      operations: {}, // { opId: { faction, type, target, duration, progress, risk } }
      security: {}, // { factionId: { spyCounter, counterIntel, alertLevel } }
      discovered: {}, // { spyId: true } - discovered spies
      totalSpies: 0,
      successfulOperations: 0,
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      totalSpies: { type: 'number', min: 0 },
      successfulOperations: { type: 'number', min: 0 },
      isLocked: { type: 'boolean' },
    });

    this.calculations = new EspionageCalculations();
    this._initializeSecurity();
    this.onStateChange = null;
    this.onError = null;
  }

  /**
   * Initialize security for factions
   */
  _initializeSecurity() {
    const security = {
      'player_faction': { spyCounter: 50, counterIntel: 30, alertLevel: 0 },
      'npc_1': { spyCounter: 30, counterIntel: 40, alertLevel: 0 },
      'npc_2': { spyCounter: 40, counterIntel: 35, alertLevel: 0 },
    };

    this.state.set('security', security);
  }

  /**
   * Deploy spy
   */
  deploySpy(factionId, targetFactionId, spyName) {
    if (this.state.get('isLocked')) {
      throw new Error('Espionage system is locked');
    }

    const spyId = `spy_${factionId}_${Date.now()}`;
    const spies = this.state.get('spies');

    spies[spyId] = {
      id: spyId,
      faction: factionId,
      targetFaction: targetFactionId,
      name: spyName,
      status: 'active', // 'active', 'compromised', 'dead'
      skill: Math.random() * 100, // 0-100 (higher is better at hiding)
      location: targetFactionId,
      deployedAt: Date.now(),
      intelGathered: 0,
    };

    this.state.set('spies', spies);
    this.state.set('totalSpies', this.state.get('totalSpies') + 1);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    // Increase target's alert level
    const security = this.state.get('security');
    security[targetFactionId].alertLevel += 5;
    this.state.set('security', security);

    if (this.eventBus) {
      this.eventBus.emit('espionage:spy-deployed', {
        spyId,
        faction: factionId,
        targetFaction: targetFactionId,
        spyName,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'spy-deployed' });
  }

  /**
   * Gather intelligence
   */
  gatherIntelligence(spyId, intelType) {
    if (this.state.get('isLocked')) {
      throw new Error('Espionage system is locked');
    }

    const spies = this.state.get('spies');
    const spy = spies[spyId];

    if (!spy || spy.status !== 'active') {
      throw new Error('Spy not available');
    }

    const intelId = `intel_${spyId}_${Date.now()}`;
    const intelligence = this.state.get('intelligence');

    // Determine if spy is discovered (based on spy skill vs counter-intel)
    const security = this.state.get('security');
    const targetSecurity = security[spy.targetFaction];
    const discoveryRisk = this.calculations.calculateDiscoveryRisk(spy.skill, targetSecurity.counterIntel);

    const discovered = Math.random() * 100 < discoveryRisk;

    intelligence[intelId] = {
      id: intelId,
      source: spyId,
      sourceFaction: spy.faction,
      target: spy.targetFaction,
      type: intelType, // 'military', 'economic', 'diplomatic', 'research'
      data: this._generateIntelData(intelType),
      reliability: Math.min(100, spy.skill + (100 - discoveryRisk)),
      discovered,
      timestamp: Date.now(),
    };

    this.state.set('intelligence', intelligence);

    if (discovered) {
      spy.status = 'compromised';
      const discovered_dict = this.state.get('discovered');
      discovered_dict[spyId] = true;
      this.state.set('discovered', discovered_dict);

      if (this.eventBus) {
        this.eventBus.emit('espionage:spy-discovered', {
          spyId,
          discoveredBy: spy.targetFaction,
          timestamp: Date.now(),
        });
      }
    } else {
      spy.intelGathered += 1;

      if (this.eventBus) {
        this.eventBus.emit('espionage:intelligence-gathered', {
          intelId,
          spyId,
          type: intelType,
          reliability: intelligence[intelId].reliability,
          timestamp: Date.now(),
        });
      }
    }

    this.state.set('spies', spies);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);
  }

  /**
   * Generate fake intelligence data
   */
  _generateIntelData(type) {
    const data = {
      'military': {
        fleetSize: Math.floor(Math.random() * 500 + 100),
        weaponType: ['laser', 'missile', 'projectile'][Math.floor(Math.random() * 3)],
        readiness: Math.random() * 100,
      },
      'economic': {
        treasury: Math.floor(Math.random() * 10000 + 1000),
        tradePartners: Math.floor(Math.random() * 10 + 1),
        income: Math.floor(Math.random() * 5000),
      },
      'diplomatic': {
        alliances: Math.floor(Math.random() * 5),
        enemies: Math.floor(Math.random() * 3),
        neutrals: Math.floor(Math.random() * 8),
      },
      'research': {
        techs: Math.floor(Math.random() * 20 + 5),
        focusArea: ['propulsion', 'weapons', 'defense'][Math.floor(Math.random() * 3)],
        progressPercent: Math.random() * 100,
      },
    };
    return data[type] || {};
  }

  /**
   * Launch sabotage operation
   */
  launchSabotage(factionId, targetFactionId, targetType, duration) {
    if (this.state.get('isLocked')) {
      throw new Error('Espionage system is locked');
    }

    const opId = `sabotage_${factionId}_${Date.now()}`;
    const operations = this.state.get('operations');

    operations[opId] = {
      id: opId,
      faction: factionId,
      target: targetFactionId,
      type: 'sabotage',
      targetType, // 'fleet', 'production', 'research'
      duration,
      progress: 0,
      risk: Math.random() * 100,
      impact: 0,
      status: 'active',
      startedAt: Date.now(),
    };

    this.state.set('operations', operations);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('espionage:sabotage-launched', {
        opId,
        faction: factionId,
        targetFaction: targetFactionId,
        targetType,
        duration,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Progress sabotage operation
   */
  progressSabotage(opId, progressAmount) {
    const operations = this.state.get('operations');
    const operation = operations[opId];

    if (!operation || operation.status !== 'active') {
      throw new Error('Operation not found');
    }

    operation.progress = Math.min(100, operation.progress + progressAmount);

    if (operation.progress >= 100) {
      operation.status = 'completed';
      operation.impact = Math.floor(Math.random() * 30 + 10); // 10-40% impact

      this.state.set('successfulOperations', this.state.get('successfulOperations') + 1);

      if (this.eventBus) {
        this.eventBus.emit('espionage:sabotage-succeeded', {
          opId,
          targetFaction: operation.target,
          impact: operation.impact,
          timestamp: Date.now(),
        });
      }
    }

    this.state.set('operations', operations);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);
  }

  /**
   * Get spy details
   */
  getSpy(spyId) {
    return this.state.get('spies')?.[spyId] || null;
  }

  /**
   * Get all spies for faction
   */
  getFactionSpies(factionId) {
    const spies = this.state.get('spies') || {};
    return Object.values(spies).filter(s => s.faction === factionId);
  }

  /**
   * Get intelligence for faction
   */
  getFactionIntelligence(factionId) {
    const intelligence = this.state.get('intelligence') || {};
    return Object.values(intelligence).filter(i => i.sourceFaction === factionId);
  }

  /**
   * Get operations
   */
  getOperations() {
    return Object.values(this.state.get('operations') || {});
  }

  /**
   * Get faction security
   */
  getSecurity(factionId) {
    return this.state.get('security')?.[factionId] || null;
  }

  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('espionage:locked', {});
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('espionage:unlocked', {});
  }

  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('espionage-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('espionage:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('espionage-state');
      if (data) this.state = new State(data, this.state.schema);
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
 * EspionageCalculations - Pure math
 */
class EspionageCalculations {
  /**
   * Calculate spy discovery risk
   */
  calculateDiscoveryRisk(spySkill, counterIntelLevel) {
    // Higher skill = lower risk, higher counter-intel = higher risk
    const baseRisk = 20;
    const skillModifier = (100 - spySkill) * 0.3; // 0-30
    const counterModifier = counterIntelLevel * 0.5; // 0-50
    return baseRisk + skillModifier + counterModifier;
  }

  /**
   * Calculate sabotage success chance
   */
  calculateSabotageSuccess(operationRisk, targetSecurity) {
    const successChance = 100 - operationRisk - (targetSecurity * 0.5);
    return Math.max(5, Math.min(95, successChance));
  }

  /**
   * Calculate intelligence value
   */
  calculateIntelValue(reliability, age) {
    // Newer intel is more valuable
    const ageHours = (Date.now() - age) / 3600000;
    const ageDecay = Math.exp(-ageHours / 24); // Decay over 24 hours
    return (reliability / 100) * 100 * ageDecay;
  }
}

export { EspionageCalculations };
