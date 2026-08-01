/**
 * GalaxyQuest Main Entry Point (ES6 Modules)
 * 
 * Responsibilities:
 * - Import all domain initialization functions
 * - Bootstrap all 12 game domains
 * - Export to window for debugging/access
 * - Handle boot errors
 */

import { API } from './api.js';

// Import all domain initialization functions
import { initializeEconomyDomain } from './engine/runtime/domains/economy/__exports.js';
import { initializeFleetDomain } from './engine/runtime/domains/fleet/__exports.js';
import { initializeWarDomain } from './engine/runtime/domains/war/war__exports.js';
import { initializeResearchDomain } from './engine/runtime/domains/research/research__exports.js';
import { initializeColonizationDomain } from './engine/runtime/domains/colonization/colonization__exports.js';
import { initializeGalaxyDomain } from './engine/runtime/domains/galaxy/galaxy__exports.js';
import { initializeAllianceDomain } from './engine/runtime/domains/alliance/alliance__exports.js';
import { initializeDiplomacyDomain } from './engine/runtime/domains/diplomacy/diplomacy__exports.js';
import { initializeMarketDomain } from './engine/runtime/domains/market/market__exports.js';
import { initializeEspionageDomain } from './engine/runtime/domains/espionage/espionage__exports.js';
import { initializeNPCDomain } from './engine/runtime/domains/npc/npc__exports.js';
import { initializeEventDomain } from './engine/runtime/domains/event/event__exports.js';

// Make API globally available
window.API = API;

// Game State
const game = {
  domains: {},      // All initialized domains
  config: {
    eventBus: null,   // Will be set if available
    repository: null, // Will be set if available
    logger: console,
  }
};

/**
 * Bootstrap all 12 game domains
 */
async function boot() {
  console.log('🚀 GalaxyQuest Booting...');

  try {
    // If legacy EventBus exists, use it for backward compatibility
    if (window.EventBus) {
      game.config.eventBus = new window.EventBus();
      console.log('✅ EventBus detected');
    } else {
      // Fallback EventBus stub
      console.warn('⚠️ EventBus not found, creating fallback');
      game.config.eventBus = {
        emit: (event, data) => console.log(`[EventBus] ${event}`, data),
        on: (event, callback) => console.log(`[EventBus] Listener registered for ${event}`),
        off: (event, callback) => console.log(`[EventBus] Listener removed for ${event}`),
        once: (event, callback) => console.log(`[EventBus] Once listener for ${event}`)
      };
    }

    // If legacy Repository exists, use it
    if (window.Repository) {
      game.config.repository = new window.Repository();
      console.log('✅ Repository detected');
    } else {
      // Fallback Repository stub with all domain-specific methods
      console.warn('⚠️ Repository not found, creating fallback');
      game.config.repository = {
        // Generic methods
        get: async (key) => null,
        set: async (key, value) => true,
        delete: async (key) => true,
        keys: async () => [],
        clear: async () => true,
        load: async (key) => null,
        // Domain-specific methods (all return default/empty state)
        loadEconomyState: async () => ({ taxRate: 0, subsidyRate: 0, tributeRate: 0, colonies: [], demands: {}, isLocked: false, isDirty: false }),
        saveEconomyState: async (state) => true,
        loadFleetState: async () => ({ fleets: [], ships: [], formations: {}, isLocked: false, isDirty: false }),
        saveFleetState: async (state) => true,
        loadWarState: async () => ({ wars: [], offers: [], conflicts: {}, isLocked: false, isDirty: false }),
        saveWarState: async (state) => true,
        loadResearchState: async () => ({ techs: {}, progress: {}, queue: [], isLocked: false, isDirty: false }),
        saveResearchState: async (state) => true,
        loadColonizationState: async () => ({ colonies: [], explorations: {}, isLocked: false, isDirty: false }),
        saveColonizationState: async (state) => true,
        loadGalaxyState: async () => ({ systems: {}, stars: {}, entities: {}, isLocked: false, isDirty: false }),
        saveGalaxyState: async (state) => true,
        loadAllianceState: async () => ({ alliances: {}, members: {}, diplomacy: {}, isLocked: false, isDirty: false }),
        saveAllianceState: async (state) => true,
        loadDiplomacyState: async () => ({ relations: {}, treaties: {}, proposals: {}, isLocked: false, isDirty: false }),
        saveDiplomacyState: async (state) => true,
        loadMarketState: async () => ({ orders: {}, prices: {}, trades: {}, isLocked: false, isDirty: false }),
        saveMarketState: async (state) => true,
        loadEspionageState: async () => ({ operations: {}, intelligence: {}, spies: {}, isLocked: false, isDirty: false }),
        saveEspionageState: async (state) => true,
        loadNPCState: async () => ({ npcs: {}, quests: {}, factions: {}, isLocked: false, isDirty: false }),
        saveNPCState: async (state) => true,
        loadEventState: async () => ({ events: [], log: [], triggers: {}, isLocked: false, isDirty: false }),
        saveEventState: async (state) => true
      };
    }

    // Find DOM targets (if they exist)
    const domTargets = {
      economy: document.getElementById('economy-panel'),
      fleet: document.getElementById('fleet-panel'),
      war: document.getElementById('war-panel'),
      research: document.getElementById('research-panel'),
      colonization: document.getElementById('colonization-panel'),
      galaxy: document.getElementById('galaxy-panel'),
      alliance: document.getElementById('alliance-panel'),
      diplomacy: document.getElementById('diplomacy-panel'),
      market: document.getElementById('market-panel'),
      espionage: document.getElementById('espionage-panel'),
      npc: document.getElementById('npc-panel'),
      event: document.getElementById('event-panel'),
    };

    // Initialize all domains
    console.log('📦 Initializing all 12 domains...');
    
    const initializers = [
      { name: 'economy', fn: initializeEconomyDomain },
      { name: 'fleet', fn: initializeFleetDomain },
      { name: 'war', fn: initializeWarDomain },
      { name: 'research', fn: initializeResearchDomain },
      { name: 'colonization', fn: initializeColonizationDomain },
      { name: 'galaxy', fn: initializeGalaxyDomain },
      { name: 'alliance', fn: initializeAllianceDomain },
      { name: 'diplomacy', fn: initializeDiplomacyDomain },
      { name: 'market', fn: initializeMarketDomain },
      { name: 'espionage', fn: initializeEspionageDomain },
      { name: 'npc', fn: initializeNPCDomain },
      { name: 'event', fn: initializeEventDomain },
    ];

    // Initialize in sequence (some may have dependencies)
    for (const { name, fn } of initializers) {
      const config = {
        eventBus: game.config.eventBus,
        repository: game.config.repository,
        logger: game.config.logger,
        domTarget: domTargets[name],  // Pass DOM target if available
      };

      try {
        const domain = await fn(config);
        game.domains[name] = domain;
        console.log(`  ✅ ${name}`);
      } catch (error) {
        console.error(`  ❌ ${name} failed:`, error);
        // Continue with other domains, but log error
      }
    }

    console.log('✅ All domains initialized');

    // Export to window for debugging and access
    window.GQGame = {
      api: API,
      config: game.config,
      domains: game.domains,

      // Shortcuts for common operations (from domain public APIs)
      getEconomyState() {
        return game.domains.economy?.controller?.getState();
      },
      getTaxRate() {
        return game.domains.economy?.getTaxRate?.();
      },
      async setTaxRate(rate) {
        return game.domains.economy?.setTaxRate?.(rate);
      },

      // Multi-domain operations
      async save() {
        console.log('💾 Saving all domains...');
        try {
          const promises = Object.values(game.domains)
            .map(domain => domain.controller?.save?.())
            .filter(Boolean);
          
          await Promise.all(promises);
          console.log('✅ All domains saved');
        } catch (error) {
          console.error('❌ Save failed:', error);
          throw error;
        }
      },

      async load() {
        console.log('📂 Loading all domains...');
        try {
          const promises = Object.values(game.domains)
            .map(domain => domain.controller?.load?.())
            .filter(Boolean);
          
          await Promise.all(promises);
          console.log('✅ All domains loaded');
        } catch (error) {
          console.error('❌ Load failed:', error);
          throw error;
        }
      },

      async shutdown() {
        console.log('🛑 Shutting down...');
        try {
          await window.GQGame.save();
          console.log('✅ Shutdown complete');
        } catch (error) {
          console.error('❌ Shutdown failed:', error);
          throw error;
        }
      },
    };

    console.log('✅ GalaxyQuest Ready!');
    console.log('   Access via: window.GQGame');
    console.log('   Domains: window.GQGame.domains.economy, window.GQGame.domains.fleet, ...');
    console.log('   API: window.API.get(), window.API.post(), ...');
    console.log('   Save: window.GQGame.save()');
    console.log('   Load: window.GQGame.load()');

  } catch (error) {
    console.error('❌ Boot failed:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Start the boot sequence when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  // DOM already loaded (e.g., defer on script)
  boot().catch(error => {
    console.error('❌ Unhandled boot error:', error);
    // Optionally: display error UI
  });
}
