/**
 * GalaxyQuest Main Game Facade
 * 
 * Single entry point for all game functionality
 * Coordinates all domains, systems, and infrastructure
 * 
 * Usage: window.GQGame.domains.economy.setTaxRate(15)
 */

import { ValidatedEventBus, EVENT_REGISTRY } from './runtime/domains/shared/EventRegistry.js';
import { initializeEconomyDomain } from './runtime/domains/economy/__exports.js';
import { initializeFleetDomain } from './runtime/domains/fleet/__exports.js';
import { initializeWarDomain } from './runtime/domains/war/war__exports.js';
import { initializeResearchDomain } from './runtime/domains/research/research__exports.js';
import { initializeColonizationDomain } from './runtime/domains/colonization/colonization__exports.js';
import { initializeGalaxyDomain } from './runtime/domains/galaxy/galaxy__exports.js';
import { initializeAllianceDomain } from './runtime/domains/alliance/alliance__exports.js';
import { initializeDiplomacyDomain } from './runtime/domains/diplomacy/diplomacy__exports.js';
import { initializeMarketDomain } from './runtime/domains/market/market__exports.js';
import { initializeEspionageDomain } from './runtime/domains/espionage/espionage__exports.js';
import { initializeNPCDomain } from './runtime/domains/npc/npc__exports.js';
import { initializeEventDomain } from './runtime/domains/event/event__exports.js';

class GalaxyQuestGame {
  constructor() {
    this.version = '1.0.0';
    this.build = '20260801p1';
    this.environment = 'development';
    
    // Infrastructure
    this.events = new ValidatedEventBus();
    this.isInitialized = false;
    this.isRunning = false;
    
    // Domain instances
    this.domains = {};
    this.systems = {};
    this.infrastructure = {};
    
    // Configuration
    this.config = {};
  }

  /**
   * Initialize the game
   * @param {Object} config - Configuration object
   * @param {string} config.environment - 'development' | 'staging' | 'production'
   * @param {Object} config.api - API facade (window.API)
   * @param {Object} config.repository - Data repository
   * @param {Object} config.renderer - 3D renderer
   * @param {Object} config.logger - Logger instance
   * @returns {Promise<void>}
   */
  async initialize(config = {}) {
    if (this.isInitialized) {
      console.warn('[Game] Already initialized');
      return;
    }

    console.log(`[Game] Initializing GalaxyQuest v${this.version} (build: ${this.build})`);

    this.config = {
      environment: config.environment || 'development',
      api: config.api,
      repository: config.repository,
      renderer: config.renderer,
      logger: config.logger || console,
      ...config
    };

    try {
      // Initialize infrastructure
      await this._initializeInfrastructure();
      
      // Initialize domains (order matters!)
      await this._initializeDomains();
      
      // Initialize systems
      await this._initializeSystems();
      
      // Setup event forwarding from renderer
      if (this.infrastructure.renderer) {
        this._setupRenderingEvents();
      }

      this.isInitialized = true;
      this.events.emit('game:initialized', {
        version: this.version,
        timestamp: Date.now()
      });

      console.log('[Game] ✓ Initialized successfully');
    } catch (error) {
      console.error('[Game] ✗ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Start the game loop
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.isInitialized) {
      throw new Error('Game not initialized. Call initialize() first.');
    }

    if (this.isRunning) {
      console.warn('[Game] Already running');
      return;
    }

    console.log('[Game] Starting game loop...');
    this.isRunning = true;

    this.events.emit('game:started', {
      timestamp: Date.now()
    });
  }

  /**
   * Stop the game loop
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[Game] Stopping game loop...');
    this.isRunning = false;

    this.events.emit('game:stopped', {
      timestamp: Date.now()
    });
  }

  /**
   * Shutdown game and cleanup resources
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('[Game] Shutting down...');

    await this.stop();

    // Shutdown domains (reverse order)
    for (const [name, domain] of Object.entries(this.domains)) {
      try {
        await domain.shutdown?.();
      } catch (error) {
        console.error(`[Game] Error shutting down domain ${name}:`, error);
      }
    }

    // Shutdown systems
    for (const [name, system] of Object.entries(this.systems)) {
      try {
        await system.shutdown?.();
      } catch (error) {
        console.error(`[Game] Error shutting down system ${name}:`, error);
      }
    }

    this.isInitialized = false;
    this.isRunning = false;

    this.events.emit('game:shutdown', {
      timestamp: Date.now()
    });

    console.log('[Game] ✓ Shutdown complete');
  }

  /**
   * Get current game state
   * @returns {Object} Aggregated state from all domains
   */
  getState() {
    const state = {};

    for (const [name, domain] of Object.entries(this.domains)) {
      if (domain.getState) {
        state[name] = domain.getState();
      }
    }

    return state;
  }

  /**
   * Save all state to repository
   * @returns {Promise<void>}
   */
  async saveAll() {
    console.log('[Game] Saving all domains...');

    for (const [name, domain] of Object.entries(this.domains)) {
      try {
        await domain.save?.();
      } catch (error) {
        console.error(`[Game] Error saving domain ${name}:`, error);
      }
    }

    console.log('[Game] ✓ All domains saved');
  }

  /**
   * Load all state from repository
   * @returns {Promise<void>}
   */
  async loadAll() {
    console.log('[Game] Loading all domains...');

    for (const [name, domain] of Object.entries(this.domains)) {
      try {
        await domain.load?.();
      } catch (error) {
        console.error(`[Game] Error loading domain ${name}:`, error);
      }
    }

    console.log('[Game] ✓ All domains loaded');
  }

  /**
   * Get event registry
   * @returns {Object} EVENT_REGISTRY
   */
  getEventRegistry() {
    return EVENT_REGISTRY;
  }

  /**
   * Get game metrics/diagnostics
   * @returns {Object} Metrics
   */
  getMetrics() {
    const metrics = {
      version: this.version,
      build: this.build,
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      domains: Object.keys(this.domains),
      systems: Object.keys(this.systems),
      eventListeners: {}
    };

    // Count event listeners
    for (const eventName of Object.keys(EVENT_REGISTRY)) {
      metrics.eventListeners[eventName] = this.events.getListenerCount(eventName);
    }

    return metrics;
  }

  // Private methods

  /**
   * Initialize infrastructure (API, repository, renderer, etc.)
   * @private
   */
  async _initializeInfrastructure() {
    console.log('[Game] Initializing infrastructure...');

    this.infrastructure = {
      api: this.config.api || window.API,
      repository: this.config.repository,
      renderer: this.config.renderer,
      logger: this.config.logger,
      eventBus: this.events
    };

    // Verify critical dependencies
    if (!this.infrastructure.api) {
      console.warn('[Game] No API configured');
    }
  }

  /**
   * Initialize all domains
   * @private
   */
  async _initializeDomains() {
    console.log('[Game] Initializing domains...');

    // Economy domain
    this.domains.economy = await initializeEconomyDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="economy"]')
    });

    // Fleet domain
    this.domains.fleet = await initializeFleetDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="fleet"]')
    });

    // War domain
    this.domains.war = await initializeWarDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="war"]')
    });

    // Research domain
    this.domains.research = await initializeResearchDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="research"]')
    });

    // Colonization domain
    this.domains.colonization = await initializeColonizationDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="colonization"]')
    });

    // Galaxy domain
    this.domains.galaxy = await initializeGalaxyDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="galaxy"]')
    });

    // Alliance domain
    this.domains.alliance = await initializeAllianceDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="alliance"]')
    });

    // Diplomacy domain
    this.domains.diplomacy = await initializeDiplomacyDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="diplomacy"]')
    });

    // Market domain
    this.domains.market = await initializeMarketDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="market"]')
    });

    // Espionage domain
    this.domains.espionage = await initializeEspionageDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="espionage"]')
    });

    // NPC domain
    this.domains.npc = await initializeNPCDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="npc"]')
    });

    // Event domain
    this.domains.event = await initializeEventDomain({
      eventBus: this.events,
      repository: this.infrastructure.repository,
      logger: this.infrastructure.logger,
      domTarget: document.querySelector('[data-domain="event"]')
    });

    // TODO: Initialize other domains
    // this.domains.galaxy = await initializeGalaxyDomain({ ... });
    // this.domains.research = await initializeResearchDomain({ ... });
    // ... etc

    console.log(`[Game] ✓ ${Object.keys(this.domains).length} domains initialized`);
  }

  /**
   * Initialize game systems
   * @private
   */
  async _initializeSystems() {
    console.log('[Game] Initializing systems...');

    // TODO: Initialize systems
    // this.systems.npc = new NPCDialogueSystem({ eventBus: this.events });
    // this.systems.guide = new GameGuideSystem({ eventBus: this.events });
    // ... etc

    console.log(`[Game] ✓ ${Object.keys(this.systems).length} systems initialized`);
  }

  /**
   * Setup event forwarding from renderer
   * @private
   */
  _setupRenderingEvents() {
    // Forward rendering events to main event bus
    if (this.infrastructure.renderer?.onFrame) {
      this.infrastructure.renderer.onFrame((frameData) => {
        this.events.emit('render:frame', frameData);
      });
    }
  }
}

// Create singleton instance
const GQGame = new GalaxyQuestGame();

// Export for use
export default GQGame;
export { GalaxyQuestGame };
