/**
 * EventController - Manages game-wide events and consequences
 * Responsible for: event triggers, consequences, event log, event chains
 * Uses: EventBus for communication, State.js for management
 */

import State from '../shared/State.js';

export class EventController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;

    this.state = new State({
      gameEvents: {}, // { eventId: { id, type, title, description, consequences, triggered, resolvedAt } }
      eventLog: [], // [{ eventId, timestamp, action, result }]
      triggers: {}, // { triggerId: { condition, consequence, active } }
      eventChains: {}, // { chainId: { events: [], progress, active } }
      totalEvents: 0,
      totalConsequences: 0,
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      totalEvents: { type: 'number', min: 0 },
      totalConsequences: { type: 'number', min: 0 },
      isLocked: { type: 'boolean' },
    });

    this.calculations = new EventCalculations();
    this._initializeEventTemplates();
    this.onStateChange = null;
    this.onError = null;
  }

  /**
   * Initialize event templates
   */
  _initializeEventTemplates() {
    const eventTemplates = {
      'supernova': {
        id: 'evt_supernova_1',
        type: 'supernova',
        title: 'Supernova Event',
        description: 'A nearby star has gone supernova, affecting the sector',
        severity: 'critical',
        consequences: [
          { type: 'damage_planets', amount: 500 },
          { type: 'destroy_ships', percent: 20 },
          { type: 'trigger_evacuation' }
        ],
        triggered: false,
      },
      'famine': {
        id: 'evt_famine_1',
        type: 'famine',
        title: 'Agricultural Crisis',
        description: 'Famine strikes agricultural colonies',
        severity: 'major',
        consequences: [
          { type: 'reduce_population', percent: 30 },
          { type: 'increase_unrest', amount: 50 }
        ],
        triggered: false,
      },
      'plague': {
        id: 'evt_plague_1',
        type: 'plague',
        title: 'Epidemic Outbreak',
        description: 'A plague spreads through the fleet',
        severity: 'major',
        consequences: [
          { type: 'reduce_population', percent: 25 },
          { type: 'reduce_production', percent: 40 }
        ],
        triggered: false,
      },
      'treasure': {
        id: 'evt_treasure_1',
        type: 'treasure',
        title: 'Ancient Artifact Discovery',
        description: 'Exploration team discovers valuable ancient technology',
        severity: 'positive',
        consequences: [
          { type: 'grant_credits', amount: 1000 },
          { type: 'unlock_tech', tech: 'ancient_engineering' }
        ],
        triggered: false,
      },
      'alliance_opportunity': {
        id: 'evt_alliance_1',
        type: 'alliance_opportunity',
        title: 'Alliance Proposal',
        description: 'A powerful faction offers alliance',
        severity: 'positive',
        consequences: [
          { type: 'diplomatic_bonus', amount: 30 },
          { type: 'trade_agreement' }
        ],
        triggered: false,
      },
      'invasion': {
        id: 'evt_invasion_1',
        type: 'invasion',
        title: 'External Invasion',
        description: 'Unknown hostile force invades the galaxy',
        severity: 'critical',
        consequences: [
          { type: 'destroy_ships', percent: 50 },
          { type: 'trigger_war', with: 'invaders' }
        ],
        triggered: false,
      },
    };

    this.state.set('gameEvents', eventTemplates);
    this.state.set('totalEvents', Object.keys(eventTemplates).length);
  }

  /**
   * Trigger game event
   */
  triggerEvent(eventType) {
    if (this.state.get('isLocked')) {
      throw new Error('Event system is locked');
    }

    const gameEvents = this.state.get('gameEvents');
    const event = Object.values(gameEvents).find(e => e.type === eventType);

    if (!event) {
      throw new Error(`Event type ${eventType} not found`);
    }

    if (event.triggered) {
      throw new Error(`Event ${eventType} already triggered`);
    }

    event.triggered = true;
    event.triggeredAt = Date.now();

    const consequences = this._executeConsequences(event);
    this.state.set('totalConsequences', this.state.get('totalConsequences') + consequences.length);

    // Add to event log
    const eventLog = this.state.get('eventLog');
    eventLog.push({
      eventId: event.id,
      eventType: event.type,
      title: event.title,
      timestamp: Date.now(),
      consequences: consequences.map(c => c.type),
      severity: event.severity,
    });
    this.state.set('eventLog', eventLog);

    this.state.set('gameEvents', gameEvents);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('game-event:triggered', {
        eventId: event.id,
        eventType: event.type,
        title: event.title,
        severity: event.severity,
        consequences: consequences.map(c => c.type),
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'event-triggered' });

    return consequences;
  }

  /**
   * Execute event consequences
   */
  _executeConsequences(event) {
    return (event.consequences || []).map(consequence => {
      let result = {};

      switch (consequence.type) {
        case 'grant_credits':
          result = { type: 'grant_credits', amount: consequence.amount, status: 'executed' };
          break;
        case 'damage_planets':
          result = { type: 'damage_planets', damage: consequence.amount, status: 'executed' };
          break;
        case 'destroy_ships':
          result = { type: 'destroy_ships', percent: consequence.percent, status: 'executed' };
          break;
        case 'reduce_population':
          result = { type: 'reduce_population', percent: consequence.percent, status: 'executed' };
          break;
        case 'reduce_production':
          result = { type: 'reduce_production', percent: consequence.percent, status: 'executed' };
          break;
        case 'unlock_tech':
          result = { type: 'unlock_tech', tech: consequence.tech, status: 'executed' };
          break;
        case 'trigger_war':
          result = { type: 'trigger_war', opponent: consequence.with, status: 'executed' };
          break;
        default:
          result = { type: consequence.type, status: 'pending' };
      }

      return result;
    });
  }

  /**
   * Create event chain (sequence of events)
   */
  createEventChain(chainId, eventTypes) {
    if (this.state.get('isLocked')) {
      throw new Error('Event system is locked');
    }

    const eventChains = this.state.get('eventChains');

    eventChains[chainId] = {
      id: chainId,
      events: eventTypes,
      progress: 0,
      active: true,
      createdAt: Date.now(),
    };

    this.state.set('eventChains', eventChains);

    if (this.eventBus) {
      this.eventBus.emit('game-event:chain-created', {
        chainId,
        eventCount: eventTypes.length,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Progress event chain
   */
  progressEventChain(chainId) {
    const eventChains = this.state.get('eventChains');
    const chain = eventChains[chainId];

    if (!chain || !chain.active) {
      throw new Error('Event chain not found or inactive');
    }

    if (chain.progress < chain.events.length) {
      const nextEventType = chain.events[chain.progress];
      const consequences = this.triggerEvent(nextEventType);

      chain.progress += 1;

      if (chain.progress >= chain.events.length) {
        chain.active = false;
        chain.completedAt = Date.now();

        if (this.eventBus) {
          this.eventBus.emit('game-event:chain-completed', {
            chainId,
            totalEvents: chain.events.length,
            timestamp: Date.now(),
          });
        }
      }

      this.state.set('eventChains', eventChains);
    }
  }

  /**
   * Get event
   */
  getEvent(eventType) {
    const gameEvents = this.state.get('gameEvents');
    return Object.values(gameEvents).find(e => e.type === eventType) || null;
  }

  /**
   * Get all events
   */
  getAllEvents() {
    return Object.values(this.state.get('gameEvents') || {});
  }

  /**
   * Get triggered events
   */
  getTriggeredEvents() {
    return this.getAllEvents().filter(e => e.triggered);
  }

  /**
   * Get event log
   */
  getEventLog(limit = 50) {
    const log = this.state.get('eventLog') || [];
    return log.slice(-limit).reverse();
  }

  /**
   * Get event chains
   */
  getEventChains() {
    return Object.values(this.state.get('eventChains') || {});
  }

  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('game-event:locked', {});
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('game-event:unlocked', {});
  }

  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('event-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('game-event:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('event-state');
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
 * EventCalculations - Pure math
 */
class EventCalculations {
  /**
   * Calculate event impact
   */
  calculateEventImpact(severity) {
    const severityMap = {
      'critical': 100,
      'major': 60,
      'moderate': 30,
      'minor': 10,
      'positive': 50,
    };
    return severityMap[severity] || 0;
  }

  /**
   * Calculate consequence chain probability
   */
  calculateChainProbability(eventCount) {
    // Probability decreases as chain gets longer
    return Math.max(0.1, 1 - (eventCount * 0.15));
  }

  /**
   * Predict next event based on patterns
   */
  predictNextEventType(recentEvents) {
    if (recentEvents.length < 2) return 'random';
    
    // Simple pattern: if recent events are negative, next is likely positive (balancing)
    const avgSeverity = recentEvents.reduce((sum, e) => {
      const severityMap = { critical: 3, major: 2, moderate: 1, positive: -1 };
      return sum + (severityMap[e.severity] || 0);
    }, 0) / recentEvents.length;

    return avgSeverity > 1.5 ? 'positive' : 'random';
  }
}

export { EventCalculations };
