/**
 * DiplomacyController - Manages faction relations and treaties
 */

import State from '../shared/State.js';

export class DiplomacyController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;

    this.state = new State({
      relations: {}, // { 'faction1-faction2': { score: 0-100, status: 'neutral', history: [] } }
      treaties: {}, // { treatyId: { parties, type, terms, duration } }
      incidents: {}, // { incidentId: { between, type, severity, impact } }
      tradeRoutes: {}, // { routeId: { from, to, flow: {} } }
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      isLocked: { type: 'boolean' },
    });

    this.calculations = new DiplomacyCalculations();
    this.onStateChange = null;
    this.onError = null;
  }

  /**
   * Get or create faction relation
   */
  _getOrCreateRelation(factionA, factionB) {
    const key = [factionA, factionB].sort().join('-');
    const relations = this.state.get('relations');

    if (!relations[key]) {
      relations[key] = {
        factions: [factionA, factionB],
        score: 50, // Neutral (0-100)
        status: 'neutral', // 'ally', 'neutral', 'enemy'
        history: [],
        treatyId: null,
      };
      this.state.set('relations', relations);
    }

    return relations[key];
  }

  /**
   * Modify relation between factions
   */
  modifyRelation(factionA, factionB, delta) {
    if (this.state.get('isLocked')) {
      throw new Error('Diplomacy system is locked');
    }

    const relation = this._getOrCreateRelation(factionA, factionB);
    const oldScore = relation.score;
    const newScore = Math.max(0, Math.min(100, relation.score + delta));

    relation.score = newScore;
    relation.history.push({ delta, oldScore, newScore, timestamp: Date.now() });

    // Update status
    if (newScore >= 75) {
      relation.status = 'ally';
    } else if (newScore <= 25) {
      relation.status = 'enemy';
    } else {
      relation.status = 'neutral';
    }

    const relations = this.state.get('relations');
    const key = [factionA, factionB].sort().join('-');
    relations[key] = relation;
    this.state.set('relations', relations);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('diplomacy:relation-changed', {
        factionA, factionB,
        oldScore, newScore,
        status: relation.status,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'relation-changed' });
  }

  /**
   * Sign treaty
   */
  signTreaty(factionA, factionB, type, duration) {
    if (this.state.get('isLocked')) {
      throw new Error('Diplomacy system is locked');
    }

    const treatyId = `treaty_${factionA}_${factionB}_${type}_${Date.now()}`;

    const treaties = this.state.get('treaties');
    treaties[treatyId] = {
      id: treatyId,
      parties: [factionA, factionB],
      type, // 'trade', 'non-aggression', 'alliance', 'research-share'
      duration,
      startDate: Date.now(),
      terms: this._generateTreatyTerms(type),
    };
    this.state.set('treaties', treaties);

    // Improve relations based on treaty type
    const bonus = type === 'alliance' ? 20 : type === 'trade' ? 10 : 5;
    this.modifyRelation(factionA, factionB, bonus);

    if (this.eventBus) {
      this.eventBus.emit('diplomacy:treaty-signed', {
        treatyId,
        factionA, factionB,
        type, duration,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'treaty-signed' });
  }

  /**
   * Generate treaty terms based on type
   */
  _generateTreatyTerms(type) {
    const termsMap = {
      'trade': { minerals: 50, energy: 30, embargo: false },
      'non-aggression': { duration: 200, violationPenalty: -50 },
      'alliance': { shared_defense: true, tribute: 0 },
      'research-share': { tech_access: ['propulsion', 'defense'], cost: 500 },
    };
    return termsMap[type] || {};
  }

  /**
   * Report diplomatic incident
   */
  reportIncident(factionA, factionB, type, severity = 'medium') {
    if (this.state.get('isLocked')) {
      throw new Error('Diplomacy system is locked');
    }

    const incidentId = `incident_${Date.now()}`;
    const incidents = this.state.get('incidents');

    incidents[incidentId] = {
      id: incidentId,
      between: [factionA, factionB],
      type, // 'border-violation', 'espionage', 'atrocity', 'trade-violation'
      severity, // 'minor', 'medium', 'severe'
      impact: this._calculateIncidentImpact(type, severity),
      reportedAt: Date.now(),
      resolved: false,
    };
    this.state.set('incidents', incidents);

    // Degrade relations
    const impact = incidents[incidentId].impact;
    this.modifyRelation(factionA, factionB, -impact);

    if (this.eventBus) {
      this.eventBus.emit('diplomacy:incident-reported', {
        incidentId,
        factionA, factionB,
        type, severity,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'incident-reported' });
  }

  /**
   * Calculate relation impact
   */
  _calculateIncidentImpact(type, severity) {
    const severityMap = { minor: 5, medium: 15, severe: 30 };
    const typeMap = {
      'border-violation': 10,
      'espionage': 20,
      'atrocity': 40,
      'trade-violation': 8,
    };
    return (typeMap[type] || 10) * (severityMap[severity] || 15) / 10;
  }

  /**
   * Establish trade route
   */
  establishTradeRoute(factionA, factionB, minerals = 0, energy = 0, credits = 0) {
    if (this.state.get('isLocked')) {
      throw new Error('Diplomacy system is locked');
    }

    const routeId = `route_${factionA}_${factionB}_${Date.now()}`;
    const routes = this.state.get('tradeRoutes');

    routes[routeId] = {
      id: routeId,
      from: factionA,
      to: factionB,
      flow: { minerals, energy, credits },
      active: true,
      established: Date.now(),
    };
    this.state.set('tradeRoutes', routes);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    // Improve relations via trade
    this.modifyRelation(factionA, factionB, 8);

    if (this.eventBus) {
      this.eventBus.emit('diplomacy:trade-route-established', {
        routeId,
        factionA, factionB,
        flow: { minerals, energy, credits },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get relation score
   */
  getRelation(factionA, factionB) {
    const key = [factionA, factionB].sort().join('-');
    return this.state.get('relations')?.[key] || null;
  }

  /**
   * Get all relations
   */
  getAllRelations() {
    return Object.values(this.state.get('relations') || {});
  }

  /**
   * Get treaties for faction
   */
  getFactionTreaties(factionId) {
    const treaties = this.state.get('treaties') || {};
    return Object.values(treaties).filter(t => t.parties.includes(factionId));
  }

  /**
   * Get incidents
   */
  getIncidents() {
    return Object.values(this.state.get('incidents') || {});
  }

  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('diplomacy:locked', {});
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('diplomacy:unlocked', {});
  }

  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('diplomacy-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('diplomacy:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('diplomacy-state');
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
 * DiplomacyCalculations - Pure math
 */
class DiplomacyCalculations {
  /**
   * Calculate diplomatic victory/defeat
   */
  calculateDiplomaticScore(relations) {
    const scores = relations.map(r => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(avg);
  }

  /**
   * Predict relation trajectory
   */
  predictRelationChange(currentScore, incidentsPerTurn, tradePerTurn) {
    // Simple model: incidents harm, trade helps
    const change = (tradePerTurn * 0.5) - (incidentsPerTurn * 2);
    return Math.max(-10, Math.min(10, change));
  }

  /**
   * Calculate treaty viability
   */
  calculateTreatyViability(relationScore, treatyType) {
    const typeThreshold = {
      'alliance': 70,
      'trade': 40,
      'non-aggression': 30,
      'research-share': 50,
    };
    const threshold = typeThreshold[treatyType] || 50;
    return relationScore >= threshold;
  }
}

export { DiplomacyCalculations };
