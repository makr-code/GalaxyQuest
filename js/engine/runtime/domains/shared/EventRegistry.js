/**
 * Event Registry - Centralized event definitions for GalaxyQuest
 * 
 * All events are registered here with:
 * - Payload schema
 * - Emitter (which domain emits it)
 * - Subscribers (who listens)
 * 
 * Pattern: Registry + Validation
 */

const EVENT_REGISTRY = {
  // ==================== ECONOMY EVENTS ====================
  
  'economy:tax-rate-changed': {
    name: 'economy:tax-rate-changed',
    description: 'Emitted when tax rate changes',
    payload: {
      taxRate: { type: 'number', description: 'New tax rate 0-100' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EconomyController',
    subscribers: ['EconomyUI', 'GameEngine', 'Reporting']
  },

  'economy:subsidy-rate-changed': {
    name: 'economy:subsidy-rate-changed',
    description: 'Emitted when subsidy rate changes',
    payload: {
      subsidyRate: { type: 'number', description: 'New subsidy rate 0-100' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EconomyController',
    subscribers: ['EconomyUI', 'GameEngine']
  },

  'economy:demands-calculated': {
    name: 'economy:demands-calculated',
    description: 'Emitted after demand calculation',
    payload: {
      demands: { type: 'object', description: 'Demands by resource' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EconomyController',
    subscribers: ['EconomyUI', 'ResourceManager']
  },

  'economy:locked': {
    name: 'economy:locked',
    description: 'Emitted when economy is locked',
    payload: {
      reason: { type: 'string', description: 'Reason for lock' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EconomyController',
    subscribers: ['EconomyUI', 'GameEngine']
  },

  'economy:unlocked': {
    name: 'economy:unlocked',
    description: 'Emitted when economy is unlocked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EconomyController',
    subscribers: ['EconomyUI']
  },

  'economy:saved': {
    name: 'economy:saved',
    description: 'Emitted after economy state is saved',
    payload: {
      version: { type: 'number', description: 'State version' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EconomyController',
    subscribers: ['GameEngine']
  },

  // ==================== GALAXY EVENTS ====================

  'galaxy:stars-loaded': {
    name: 'galaxy:stars-loaded',
    description: 'Emitted when star data is loaded',
    payload: {
      stars: { type: 'array', description: 'Star array' },
      count: { type: 'number', description: 'Star count' }
    },
    emitter: 'GalaxyController',
    subscribers: ['Galaxy3DRenderer', 'GalaxyUI']
  },

  'galaxy:selection-changed': {
    name: 'galaxy:selection-changed',
    description: 'Emitted when selected systems change',
    payload: {
      selectedIds: { type: 'array', description: 'Array of selected system IDs' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['Galaxy3DRenderer', 'GalaxyUI', 'DetailsPanelUI']
  },

  'galaxy:camera-moved': {
    name: 'galaxy:camera-moved',
    description: 'Emitted when camera position changes',
    payload: {
      position: { type: 'object', description: 'Camera position {x, y, z}' },
      lookAt: { type: 'object', description: 'Look target {x, y, z}' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'Galaxy3DRenderer',
    subscribers: ['GalaxyController']
  },

  // ==================== FLEET EVENTS ====================

  'fleet:formation-changed': {
    name: 'fleet:formation-changed',
    description: 'Emitted when fleet formation changes',
    payload: {
      fleetId: { type: 'string', description: 'Fleet ID' },
      formation: { type: 'object', description: 'Formation object' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'FleetController',
    subscribers: ['FleetUI', 'Galaxy3DRenderer']
  },

  'fleet:ship-created': {
    name: 'fleet:ship-created',
    description: 'Emitted when ship is created',
    payload: {
      fleetId: { type: 'string', description: 'Fleet ID' },
      ship: { type: 'object', description: 'Ship object' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'FleetController',
    subscribers: ['FleetUI', 'GameEngine']
  },

  // ==================== FLEET EVENTS ====================

  'fleet:created': {
    name: 'fleet:created',
    description: 'Emitted when fleet is created',
    payload: {
      fleetId: { type: 'string', description: 'Fleet ID' },
      fleet: { type: 'object', description: 'Fleet object' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'FleetController',
    subscribers: ['FleetUI', 'GameEngine']
  },

  'fleet:formation-changed': {
    name: 'fleet:formation-changed',
    description: 'Emitted when fleet formation changes',
    payload: {
      fleetId: { type: 'string', description: 'Fleet ID' },
      formation: { type: 'string', description: 'New formation' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'FleetController',
    subscribers: ['FleetUI', 'Galaxy3DRenderer']
  },

  'fleet:ship-added': {
    name: 'fleet:ship-added',
    description: 'Emitted when ship is added to fleet',
    payload: {
      fleetId: { type: 'string', description: 'Fleet ID' },
      ship: { type: 'object', description: 'Ship object' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'FleetController',
    subscribers: ['FleetUI', 'GameEngine']
  },

  'fleet:ship-removed': {
    name: 'fleet:ship-removed',
    description: 'Emitted when ship is removed from fleet',
    payload: {
      fleetId: { type: 'string', description: 'Fleet ID' },
      shipId: { type: 'string', description: 'Ship ID' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'FleetController',
    subscribers: ['FleetUI']
  },

  'fleet:saved': {
    name: 'fleet:saved',
    description: 'Emitted after fleet state is saved',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'FleetController',
    subscribers: ['GameEngine']
  },

  // ==================== WAR EVENTS ====================

  'war:conflict-declared': {
    name: 'war:conflict-declared',
    description: 'Emitted when war is declared between factions',
    payload: {
      conflictId: { type: 'string', description: 'Conflict ID' },
      factionA: { type: 'string', description: 'Attacking faction' },
      factionB: { type: 'string', description: 'Defending faction' },
      reason: { type: 'string', description: 'War reason' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'WarController',
    subscribers: ['WarUI', 'GameEngine', 'Reporting']
  },

  'war:peace-signed': {
    name: 'war:peace-signed',
    description: 'Emitted when peace treaty is signed',
    payload: {
      treatyId: { type: 'string', description: 'Treaty ID' },
      factions: { type: 'array', description: 'Factions in treaty' },
      duration: { type: 'number', description: 'Duration in days' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'WarController',
    subscribers: ['WarUI', 'GameEngine']
  },

  'war:goal-added': {
    name: 'war:goal-added',
    description: 'Emitted when war goal is added',
    payload: {
      goalId: { type: 'string', description: 'Goal ID' },
      conflictId: { type: 'string', description: 'Conflict ID' },
      type: { type: 'string', description: 'Goal type' },
      reward: { type: 'number', description: 'Reward points' }
    },
    emitter: 'WarController',
    subscribers: ['WarUI', 'GameEngine']
  },

  'war:battle-concluded': {
    name: 'war:battle-concluded',
    description: 'Emitted after battle resolution',
    payload: {
      attacker: { type: 'string', description: 'Attacker faction' },
      defender: { type: 'string', description: 'Defender faction' },
      victor: { type: 'string', description: 'attacker|defender' },
      attackerCasualties: { type: 'number', description: 'Ships lost by attacker' },
      defenderCasualties: { type: 'number', description: 'Ships lost by defender' }
    },
    emitter: 'WarController',
    subscribers: ['WarUI', 'FleetController', 'GameEngine']
  },

  'war:locked': {
    name: 'war:locked',
    description: 'Emitted when war system is locked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'WarController',
    subscribers: ['WarUI']
  },

  'war:unlocked': {
    name: 'war:unlocked',
    description: 'Emitted when war system is unlocked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'WarController',
    subscribers: ['WarUI']
  },

  // ==================== RESEARCH EVENTS ====================

  'research:started': {
    name: 'research:started',
    description: 'Emitted when technology research begins',
    payload: {
      techId: { type: 'string', description: 'Technology ID' },
      techName: { type: 'string', description: 'Technology name' },
      cost: { type: 'number', description: 'Research point cost' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ResearchController',
    subscribers: ['ResearchUI', 'GameEngine']
  },

  'research:completed': {
    name: 'research:completed',
    description: 'Emitted when technology research completes',
    payload: {
      techId: { type: 'string', description: 'Technology ID' },
      techName: { type: 'string', description: 'Technology name' },
      benefit: { type: 'object', description: 'Technology benefit' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ResearchController',
    subscribers: ['ResearchUI', 'GameEngine', 'FleetController']
  },

  'research:cancelled': {
    name: 'research:cancelled',
    description: 'Emitted when technology research is cancelled',
    payload: {
      techId: { type: 'string', description: 'Technology ID' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ResearchController',
    subscribers: ['ResearchUI']
  },

  'research:points-added': {
    name: 'research:points-added',
    description: 'Emitted when research points are accumulated',
    payload: {
      amount: { type: 'number', description: 'Points added' },
      total: { type: 'number', description: 'Total points' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ResearchController',
    subscribers: ['ResearchUI', 'GameEngine']
  },

  'research:locked': {
    name: 'research:locked',
    description: 'Emitted when research system is locked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ResearchController',
    subscribers: ['ResearchUI']
  },

  'research:unlocked': {
    name: 'research:unlocked',
    description: 'Emitted when research system is unlocked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ResearchController',
    subscribers: ['ResearchUI']
  },

  'research:saved': {
    name: 'research:saved',
    description: 'Emitted after research state is saved',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ResearchController',
    subscribers: ['GameEngine']
  },

  // ==================== COLONIZATION EVENTS ====================

  'colonization:colonized': {
    name: 'colonization:colonized',
    description: 'Emitted when a new planet is colonized',
    payload: {
      colonyId: { type: 'string', description: 'Colony ID' },
      planetId: { type: 'string', description: 'Planet ID' },
      populationCount: { type: 'number', description: 'Initial population' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ColonizationController',
    subscribers: ['ColonizationUI', 'GameEngine']
  },

  'colonization:building-constructed': {
    name: 'colonization:building-constructed',
    description: 'Emitted when a building is constructed',
    payload: {
      colonyId: { type: 'string', description: 'Colony ID' },
      buildingType: { type: 'string', description: 'Building type' },
      count: { type: 'number', description: 'Number of buildings' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ColonizationController',
    subscribers: ['ColonizationUI', 'GameEngine']
  },

  'colonization:population-growth': {
    name: 'colonization:population-growth',
    description: 'Emitted when population grows',
    payload: {
      change: { type: 'number', description: 'Population change' },
      totalPopulation: { type: 'number', description: 'Total population' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ColonizationController',
    subscribers: ['ColonizationUI', 'GameEngine']
  },

  'colonization:production-processed': {
    name: 'colonization:production-processed',
    description: 'Emitted when colony production is processed',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ColonizationController',
    subscribers: ['GameEngine']
  },

  'colonization:locked': {
    name: 'colonization:locked',
    description: 'Emitted when colonization system is locked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ColonizationController',
    subscribers: ['ColonizationUI']
  },

  'colonization:unlocked': {
    name: 'colonization:unlocked',
    description: 'Emitted when colonization system is unlocked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ColonizationController',
    subscribers: ['ColonizationUI']
  },

  'colonization:saved': {
    name: 'colonization:saved',
    description: 'Emitted after colonization state is saved',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'ColonizationController',
    subscribers: ['GameEngine']
  },

  // ==================== GALAXY EVENTS ====================

  'galaxy:renderer-ready': {
    name: 'galaxy:renderer-ready',
    description: 'Emitted when Three.js renderer is initialized',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GameEngine']
  },

  'galaxy:star-selected': {
    name: 'galaxy:star-selected',
    description: 'Emitted when a star system is selected',
    payload: {
      starId: { type: 'string', description: 'Star ID' },
      starName: { type: 'string', description: 'Star name' },
      x: { type: 'number', description: 'X coordinate' },
      y: { type: 'number', description: 'Y coordinate' },
      z: { type: 'number', description: 'Z coordinate' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GalaxyUI', 'GameEngine']
  },

  'galaxy:camera-moved': {
    name: 'galaxy:camera-moved',
    description: 'Emitted when camera is moved',
    payload: {
      x: { type: 'number', description: 'Camera X' },
      y: { type: 'number', description: 'Camera Y' },
      z: { type: 'number', description: 'Camera Z' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GalaxyUI', 'GameEngine']
  },

  'galaxy:zoom-changed': {
    name: 'galaxy:zoom-changed',
    description: 'Emitted when zoom level changes',
    payload: {
      zoom: { type: 'number', description: 'Zoom level' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GalaxyUI', 'GameEngine']
  },

  'galaxy:route-planned': {
    name: 'galaxy:route-planned',
    description: 'Emitted when a fleet route is planned',
    payload: {
      routeId: { type: 'string', description: 'Route ID' },
      fleetId: { type: 'string', description: 'Fleet ID' },
      from: { type: 'string', description: 'From star ID' },
      to: { type: 'string', description: 'To star ID' },
      distance: { type: 'number', description: 'Distance' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GameEngine', 'FleetController']
  },

  'galaxy:locked': {
    name: 'galaxy:locked',
    description: 'Emitted when galaxy system is locked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GalaxyUI']
  },

  'galaxy:unlocked': {
    name: 'galaxy:unlocked',
    description: 'Emitted when galaxy system is unlocked',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GalaxyUI']
  },

  'galaxy:saved': {
    name: 'galaxy:saved',
    description: 'Emitted after galaxy state is saved',
    payload: {
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'GalaxyController',
    subscribers: ['GameEngine']
  },

  // ==================== ALLIANCE EVENTS ====================

  'alliance:created': {
    name: 'alliance:created',
    description: 'Emitted when alliance is created',
    payload: {
      allianceId: { type: 'string', description: 'Alliance ID' },
      allianceName: { type: 'string', description: 'Alliance name' },
      leader: { type: 'string', description: 'Leader faction' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:member-joined': {
    name: 'alliance:member-joined',
    description: 'Emitted when faction joins alliance',
    payload: {
      allianceId: { type: 'string', description: 'Alliance ID' },
      factionId: { type: 'string', description: 'Faction ID' },
      rank: { type: 'string', description: 'Member rank' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:contributed': {
    name: 'alliance:contributed',
    description: 'Emitted when faction contributes to treasury',
    payload: {
      allianceId: { type: 'string', description: 'Alliance ID' },
      factionId: { type: 'string', description: 'Faction ID' },
      credits: { type: 'number', description: 'Credits' },
      minerals: { type: 'number', description: 'Minerals' },
      energy: { type: 'number', description: 'Energy' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:vote-proposed': {
    name: 'alliance:vote-proposed',
    description: 'Emitted when alliance vote is proposed',
    payload: {
      voteId: { type: 'string', description: 'Vote ID' },
      allianceId: { type: 'string', description: 'Alliance ID' },
      topic: { type: 'string', description: 'Vote topic' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:vote-passed': {
    name: 'alliance:vote-passed',
    description: 'Emitted when alliance vote passes',
    payload: {
      voteId: { type: 'string', description: 'Vote ID' },
      topic: { type: 'string', description: 'Topic' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:vote-failed': {
    name: 'alliance:vote-failed',
    description: 'Emitted when alliance vote fails',
    payload: {
      voteId: { type: 'string', description: 'Vote ID' },
      topic: { type: 'string', description: 'Topic' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:locked': {
    name: 'alliance:locked',
    description: 'Emitted when alliance system is locked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:unlocked': {
    name: 'alliance:unlocked',
    description: 'Emitted when alliance system is unlocked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  'alliance:saved': {
    name: 'alliance:saved',
    description: 'Emitted after alliance state is saved',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'AllianceController',
    subscribers: ['GameEngine']
  },

  // ==================== DIPLOMACY EVENTS ====================

  'diplomacy:relation-changed': {
    name: 'diplomacy:relation-changed',
    description: 'Emitted when faction relation score changes',
    payload: {
      factionA: { type: 'string', description: 'Faction A' },
      factionB: { type: 'string', description: 'Faction B' },
      oldScore: { type: 'number', description: 'Old relation score' },
      newScore: { type: 'number', description: 'New relation score' },
      status: { type: 'string', description: 'Relation status' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'DiplomacyController',
    subscribers: ['GameEngine', 'WarController']
  },

  'diplomacy:treaty-signed': {
    name: 'diplomacy:treaty-signed',
    description: 'Emitted when treaty is signed',
    payload: {
      treatyId: { type: 'string', description: 'Treaty ID' },
      factionA: { type: 'string', description: 'Faction A' },
      factionB: { type: 'string', description: 'Faction B' },
      type: { type: 'string', description: 'Treaty type' },
      duration: { type: 'number', description: 'Duration' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'DiplomacyController',
    subscribers: ['GameEngine']
  },

  'diplomacy:incident-reported': {
    name: 'diplomacy:incident-reported',
    description: 'Emitted when diplomatic incident is reported',
    payload: {
      incidentId: { type: 'string', description: 'Incident ID' },
      factionA: { type: 'string', description: 'Faction A' },
      factionB: { type: 'string', description: 'Faction B' },
      type: { type: 'string', description: 'Incident type' },
      severity: { type: 'string', description: 'Severity' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'DiplomacyController',
    subscribers: ['GameEngine']
  },

  'diplomacy:trade-route-established': {
    name: 'diplomacy:trade-route-established',
    description: 'Emitted when trade route is established',
    payload: {
      routeId: { type: 'string', description: 'Route ID' },
      factionA: { type: 'string', description: 'Faction A' },
      factionB: { type: 'string', description: 'Faction B' },
      flow: { type: 'object', description: 'Resource flow' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'DiplomacyController',
    subscribers: ['GameEngine', 'EconomyController']
  },

  'diplomacy:locked': {
    name: 'diplomacy:locked',
    description: 'Emitted when diplomacy system is locked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'DiplomacyController',
    subscribers: ['GameEngine']
  },

  'diplomacy:unlocked': {
    name: 'diplomacy:unlocked',
    description: 'Emitted when diplomacy system is unlocked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'DiplomacyController',
    subscribers: ['GameEngine']
  },

  'diplomacy:saved': {
    name: 'diplomacy:saved',
    description: 'Emitted after diplomacy state is saved',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'DiplomacyController',
    subscribers: ['GameEngine']
  },

  // ==================== MARKET EVENTS ====================

  'market:prices-updated': {
    name: 'market:prices-updated',
    description: 'Emitted when commodity prices are updated',
    payload: {
      commodities: { type: 'object', description: 'Updated commodity prices' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'MarketController',
    subscribers: ['GameEngine']
  },

  'market:trade-executed': {
    name: 'market:trade-executed',
    description: 'Emitted when trade is executed',
    payload: {
      tradeId: { type: 'string', description: 'Trade ID' },
      buyer: { type: 'string', description: 'Buyer faction' },
      seller: { type: 'string', description: 'Seller faction' },
      commodity: { type: 'string', description: 'Commodity name' },
      quantity: { type: 'number', description: 'Quantity' },
      price: { type: 'number', description: 'Price per unit' },
      totalCost: { type: 'number', description: 'Total cost' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'MarketController',
    subscribers: ['GameEngine', 'EconomyController']
  },

  'market:locked': {
    name: 'market:locked',
    description: 'Emitted when market system is locked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'MarketController',
    subscribers: ['GameEngine']
  },

  'market:unlocked': {
    name: 'market:unlocked',
    description: 'Emitted when market system is unlocked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'MarketController',
    subscribers: ['GameEngine']
  },

  'market:saved': {
    name: 'market:saved',
    description: 'Emitted after market state is saved',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'MarketController',
    subscribers: ['GameEngine']
  },

  // ==================== ESPIONAGE EVENTS ====================

  'espionage:spy-deployed': {
    name: 'espionage:spy-deployed',
    description: 'Emitted when spy is deployed',
    payload: {
      spyId: { type: 'string', description: 'Spy ID' },
      faction: { type: 'string', description: 'Deploying faction' },
      targetFaction: { type: 'string', description: 'Target faction' },
      spyName: { type: 'string', description: 'Spy name' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  'espionage:intelligence-gathered': {
    name: 'espionage:intelligence-gathered',
    description: 'Emitted when intelligence is successfully gathered',
    payload: {
      intelId: { type: 'string', description: 'Intel ID' },
      spyId: { type: 'string', description: 'Spy ID' },
      type: { type: 'string', description: 'Intel type' },
      reliability: { type: 'number', description: 'Reliability %' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  'espionage:spy-discovered': {
    name: 'espionage:spy-discovered',
    description: 'Emitted when spy is discovered',
    payload: {
      spyId: { type: 'string', description: 'Spy ID' },
      discoveredBy: { type: 'string', description: 'Discovering faction' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  'espionage:sabotage-launched': {
    name: 'espionage:sabotage-launched',
    description: 'Emitted when sabotage operation is launched',
    payload: {
      opId: { type: 'string', description: 'Operation ID' },
      faction: { type: 'string', description: 'Attacking faction' },
      targetFaction: { type: 'string', description: 'Target faction' },
      targetType: { type: 'string', description: 'Target type' },
      duration: { type: 'number', description: 'Duration' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  'espionage:sabotage-succeeded': {
    name: 'espionage:sabotage-succeeded',
    description: 'Emitted when sabotage succeeds',
    payload: {
      opId: { type: 'string', description: 'Operation ID' },
      targetFaction: { type: 'string', description: 'Target faction' },
      impact: { type: 'number', description: 'Impact %' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  'espionage:locked': {
    name: 'espionage:locked',
    description: 'Emitted when espionage system is locked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  'espionage:unlocked': {
    name: 'espionage:unlocked',
    description: 'Emitted when espionage system is unlocked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  'espionage:saved': {
    name: 'espionage:saved',
    description: 'Emitted after espionage state is saved',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'EspionageController',
    subscribers: ['GameEngine']
  },

  // ==================== NPC EVENTS ====================

  'npc:decision-made': {
    name: 'npc:decision-made',
    description: 'Emitted when NPC makes a decision',
    payload: {
      npcId: { type: 'string', description: 'NPC faction ID' },
      decision: { type: 'object', description: 'Decision object' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'NPCController',
    subscribers: ['GameEngine']
  },

  'npc:quest-generated': {
    name: 'npc:quest-generated',
    description: 'Emitted when NPC generates quest',
    payload: {
      questId: { type: 'string', description: 'Quest ID' },
      owner: { type: 'string', description: 'NPC faction ID' },
      title: { type: 'string', description: 'Quest title' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'NPCController',
    subscribers: ['GameEngine']
  },

  'npc:quest-completed': {
    name: 'npc:quest-completed',
    description: 'Emitted when quest is completed',
    payload: {
      questId: { type: 'string', description: 'Quest ID' },
      reward: { type: 'object', description: 'Reward object' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'NPCController',
    subscribers: ['GameEngine']
  },

  'npc:locked': {
    name: 'npc:locked',
    description: 'Emitted when NPC system is locked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'NPCController',
    subscribers: ['GameEngine']
  },

  'npc:unlocked': {
    name: 'npc:unlocked',
    description: 'Emitted when NPC system is unlocked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'NPCController',
    subscribers: ['GameEngine']
  },

  'npc:saved': {
    name: 'npc:saved',
    description: 'Emitted after NPC state is saved',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'NPCController',
    subscribers: ['GameEngine']
  },

  // ==================== GAME EVENT EVENTS ====================

  'game-event:triggered': {
    name: 'game-event:triggered',
    description: 'Emitted when game event is triggered',
    payload: {
      eventId: { type: 'string', description: 'Event ID' },
      eventType: { type: 'string', description: 'Event type' },
      title: { type: 'string', description: 'Event title' },
      severity: { type: 'string', description: 'Event severity' },
      consequences: { type: 'array', description: 'Consequences' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EventController',
    subscribers: ['GameEngine', 'AllDomains']
  },

  'game-event:chain-created': {
    name: 'game-event:chain-created',
    description: 'Emitted when event chain is created',
    payload: {
      chainId: { type: 'string', description: 'Chain ID' },
      eventCount: { type: 'number', description: 'Number of events' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EventController',
    subscribers: ['GameEngine']
  },

  'game-event:chain-completed': {
    name: 'game-event:chain-completed',
    description: 'Emitted when event chain completes',
    payload: {
      chainId: { type: 'string', description: 'Chain ID' },
      totalEvents: { type: 'number', description: 'Total events' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'EventController',
    subscribers: ['GameEngine']
  },

  'game-event:locked': {
    name: 'game-event:locked',
    description: 'Emitted when event system is locked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'EventController',
    subscribers: ['GameEngine']
  },

  'game-event:unlocked': {
    name: 'game-event:unlocked',
    description: 'Emitted when event system is unlocked',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'EventController',
    subscribers: ['GameEngine']
  },

  'game-event:saved': {
    name: 'game-event:saved',
    description: 'Emitted after event state is saved',
    payload: { timestamp: { type: 'number', description: 'Timestamp' } },
    emitter: 'EventController',
    subscribers: ['GameEngine']
  },

  'render:frame': {
    name: 'render:frame',
    description: 'Fired every frame for rendering updates',
    payload: {
      dt: { type: 'number', description: 'Delta time in seconds' },
      alpha: { type: 'number', description: 'Interpolation factor 0-1' },
      frameCount: { type: 'number', description: 'Total frame count' }
    },
    emitter: 'GameLoop',
    subscribers: ['Galaxy3DRenderer', 'ParticleSystem', 'UIAnimator']
  },

  'render:ready': {
    name: 'render:ready',
    description: 'Emitted when renderer is ready',
    payload: {
      rendererType: { type: 'string', description: 'webgpu|webgl' },
      capabilities: { type: 'object', description: 'Renderer capabilities' }
    },
    emitter: 'Galaxy3DRenderer',
    subscribers: ['GameEngine']
  },

  // ==================== AUTH EVENTS ====================

  'auth:login': {
    name: 'auth:login',
    description: 'Emitted on successful login',
    payload: {
      userId: { type: 'string', description: 'User ID' },
      token: { type: 'string', description: 'Auth token' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AuthService',
    subscribers: ['GameEngine', 'APIManager']
  },

  'auth:logout': {
    name: 'auth:logout',
    description: 'Emitted on logout',
    payload: {
      reason: { type: 'string', description: 'logout|expired|error' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'AuthService',
    subscribers: ['GameEngine', 'UIManager']
  },

  'auth:unauthorized': {
    name: 'auth:unauthorized',
    description: 'Emitted on authorization failure',
    payload: {
      reason: { type: 'string', description: 'Reason for failure' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'APIManager',
    subscribers: ['GameEngine', 'ErrorHandler']
  },

  // ==================== ERROR EVENTS ====================

  'error:network': {
    name: 'error:network',
    description: 'Emitted on network error',
    payload: {
      error: { type: 'object', description: 'Error object' },
      endpoint: { type: 'string', description: 'Failed endpoint' },
      statusCode: { type: 'number', description: 'HTTP status code' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'APIManager',
    subscribers: ['ErrorHandler', 'Logger', 'UIManager']
  },

  'error:validation': {
    name: 'error:validation',
    description: 'Emitted on validation error',
    payload: {
      error: { type: 'object', description: 'Validation error details' },
      timestamp: { type: 'number', description: 'Timestamp' }
    },
    emitter: 'Validators',
    subscribers: ['ErrorHandler', 'UIManager']
  }
};

/**
 * Validated EventBus wrapper
 * Ensures all emitted events are registered and payload matches schema
 */
class ValidatedEventBus {
  constructor() {
    this._bus = new EventTarget();
    this._listeners = {};
  }

  /**
   * Emit event with validation
   * @param {string} eventName - Event name
   * @param {Object} payload - Event payload
   * @throws {Error} If event not registered or payload invalid
   */
  emit(eventName, payload = {}) {
    const schema = EVENT_REGISTRY[eventName];
    
    if (!schema) {
      console.warn(`[EventBus] Unregistered event: ${eventName}`);
      // Still emit, but warn
    } else {
      // Validate payload
      this._validatePayload(eventName, payload, schema.payload);
    }

    // Emit custom event
    const event = new CustomEvent(eventName, { detail: payload });
    this._bus.dispatchEvent(event);
  }

  /**
   * Listen to event
   * @param {string} eventName - Event name
   * @param {Function} callback - (payload) => void
   * @returns {Function} Unsubscribe function
   */
  on(eventName, callback) {
    if (!this._listeners[eventName]) {
      this._listeners[eventName] = [];
    }

    const listener = (event) => callback(event.detail);
    this._bus.addEventListener(eventName, listener);
    this._listeners[eventName].push(listener);

    // Return unsubscribe function
    return () => {
      this._bus.removeEventListener(eventName, listener);
      this._listeners[eventName] = this._listeners[eventName].filter(
        l => l !== listener
      );
    };
  }

  /**
   * Listen once then auto-unsubscribe
   * @param {string} eventName - Event name
   * @param {Function} callback - (payload) => void
   * @returns {Promise<any>} Resolves when event fires
   */
  once(eventName, callback) {
    return new Promise((resolve) => {
      const unsubscribe = this.on(eventName, (payload) => {
        callback?.(payload);
        unsubscribe();
        resolve(payload);
      });
    });
  }

  /**
   * Get registered events
   * @returns {Object} Event registry
   */
  getRegistry() {
    return EVENT_REGISTRY;
  }

  /**
   * Get listeners count for event
   * @param {string} eventName - Event name
   * @returns {number} Listener count
   */
  getListenerCount(eventName) {
    return this._listeners[eventName]?.length || 0;
  }

  // Private methods

  /**
   * Validate payload against schema
   * @private
   */
  _validatePayload(eventName, payload, schema) {
    if (!schema) return; // No schema defined

    for (const [field, fieldSchema] of Object.entries(schema)) {
      const value = payload[field];

      // Type check
      if (fieldSchema.type && typeof value !== fieldSchema.type) {
        console.error(
          `[EventBus] Invalid payload for ${eventName}.${field}: ` +
          `expected ${fieldSchema.type}, got ${typeof value}`
        );
      }
    }
  }
}

export { EVENT_REGISTRY, ValidatedEventBus };
