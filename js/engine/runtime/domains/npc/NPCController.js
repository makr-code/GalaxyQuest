/**
 * NPCController - Manages NPC factions and AI behavior
 * Responsible for: AI decision-making, faction goals, behavior trees, quest systems
 * Uses: EventBus for communication, State.js for management
 */

import State from '../shared/State.js';

export class NPCController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;

    this.state = new State({
      npcs: {}, // { factionId: { id, name, personality, goals, behavior, relationships } }
      quests: {}, // { questId: { id, owner, title, objectives, reward, progress, status } }
      behaviors: {}, // { behaviorId: { type, target, priority, status } }
      relationships: {}, // { 'faction1-faction2': { feeling: 0-100, trust, history } }
      totalNPCs: 0,
      completedQuests: 0,
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      totalNPCs: { type: 'number', min: 0 },
      completedQuests: { type: 'number', min: 0 },
      isLocked: { type: 'boolean' },
    });

    this.calculations = new NPCCalculations();
    this._initializeNPCs();
    this.onStateChange = null;
    this.onError = null;
  }

  /**
   * Initialize default NPC factions
   */
  _initializeNPCs() {
    const npcs = {
      'npc_1': {
        id: 'npc_1',
        name: 'Zora Collective',
        personality: 'aggressive', // 'aggressive', 'diplomatic', 'peaceful', 'neutral'
        alignment: 'neutral', // 'evil', 'neutral', 'good'
        goals: ['expand', 'gather_resources', 'build_alliances'],
        behavior: 'expansionist',
        relationships: {},
        treasury: 5000,
        military: 200,
        technology: 45,
        culture: 30,
      },
      'npc_2': {
        id: 'npc_2',
        name: 'Vex Syndicate',
        personality: 'diplomatic',
        alignment: 'good',
        goals: ['trade', 'research', 'peacekeeping'],
        behavior: 'trader',
        relationships: {},
        treasury: 3000,
        military: 150,
        technology: 80,
        culture: 60,
      },
      'npc_3': {
        id: 'npc_3',
        name: 'Void Corsairs',
        personality: 'aggressive',
        alignment: 'evil',
        goals: ['raid', 'dominate', 'accumulate_wealth'],
        behavior: 'raider',
        relationships: {},
        treasury: 2000,
        military: 300,
        technology: 30,
        culture: 10,
      },
    };

    this.state.set('npcs', npcs);
    this.state.set('totalNPCs', Object.keys(npcs).length);

    // Initialize relationships between NPCs
    const relationships = {};
    const npcIds = Object.keys(npcs);
    for (let i = 0; i < npcIds.length; i++) {
      for (let j = i + 1; j < npcIds.length; j++) {
        const key = [npcIds[i], npcIds[j]].sort().join('-');
        relationships[key] = {
          feeling: 50 + Math.random() * 30 - 15, // 35-65 (neutral start)
          trust: Math.random() * 50,
          history: [],
        };
      }
    }
    this.state.set('relationships', relationships);
  }

  /**
   * Execute NPC turn (update behavior, execute actions)
   */
  executeNPCTurn(npcFactionId) {
    if (this.state.get('isLocked')) {
      throw new Error('NPC system is locked');
    }

    const npcs = this.state.get('npcs');
    const npc = npcs[npcFactionId];

    if (!npc) {
      throw new Error(`NPC faction ${npcFactionId} not found`);
    }

    // Decide next action based on personality and goals
    const decision = this._decideBehavior(npc);

    if (this.eventBus) {
      this.eventBus.emit('npc:decision-made', {
        npcId: npcFactionId,
        decision,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'npc-turn' });
  }

  /**
   * Decide NPC behavior based on personality and state
   */
  _decideBehavior(npc) {
    const behaviors = {
      'expansionist': () => ({
        type: 'expand',
        target: 'unclaimed_systems',
        priority: 'high',
      }),
      'trader': () => ({
        type: 'trade',
        target: 'nearest_faction',
        priority: 'medium',
      }),
      'raider': () => ({
        type: 'raid',
        target: 'weakest_faction',
        priority: 'high',
      }),
      'peacekeeper': () => ({
        type: 'diplomacy',
        target: 'conflicting_factions',
        priority: 'medium',
      }),
    };

    const behavior = behaviors[npc.behavior] || behaviors['trader'];
    return behavior();
  }

  /**
   * Generate quest from NPC faction
   */
  generateQuest(npcFactionId, questType = 'standard') {
    if (this.state.get('isLocked')) {
      throw new Error('NPC system is locked');
    }

    const npc = this.state.get('npcs')?.[npcFactionId];
    if (!npc) throw new Error('NPC not found');

    const questId = `quest_${npcFactionId}_${Date.now()}`;
    const quests = this.state.get('quests');

    // Generate quest based on NPC personality
    const questTemplates = {
      'aggressive': {
        title: 'Sabotage the rival station',
        objectives: ['Infiltrate facility', 'Place charges', 'Escape'],
        reward: { credits: 500, reputation: 50 },
      },
      'diplomatic': {
        title: 'Negotiate peace treaty',
        objectives: ['Meet faction A', 'Meet faction B', 'Broker deal'],
        reward: { credits: 300, reputation: 100 },
      },
      'peaceful': {
        title: 'Deliver humanitarian aid',
        objectives: ['Collect resources', 'Transport to colony', 'Verify delivery'],
        reward: { credits: 200, reputation: 75 },
      },
    };

    const template = questTemplates[npc.personality] || questTemplates['diplomatic'];

    quests[questId] = {
      id: questId,
      owner: npcFactionId,
      title: template.title,
      description: `Quest from ${npc.name}: ${template.title}`,
      objectives: template.objectives,
      reward: template.reward,
      progress: 0,
      status: 'active', // 'active', 'completed', 'failed'
      createdAt: Date.now(),
      dueDate: Date.now() + 86400000 * 7, // 7 days
    };

    this.state.set('quests', quests);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('npc:quest-generated', {
        questId,
        owner: npcFactionId,
        title: template.title,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'quest-generated' });
  }

  /**
   * Complete quest
   */
  completeQuest(questId) {
    if (this.state.get('isLocked')) {
      throw new Error('NPC system is locked');
    }

    const quests = this.state.get('quests');
    const quest = quests[questId];

    if (!quest || quest.status === 'completed') {
      throw new Error('Quest not available');
    }

    quest.status = 'completed';
    quest.completedAt = Date.now();

    this.state.set('quests', quests);
    this.state.set('completedQuests', this.state.get('completedQuests') + 1);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('npc:quest-completed', {
        questId,
        reward: quest.reward,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'quest-completed' });
  }

  /**
   * Get NPC faction
   */
  getNPC(npcId) {
    return this.state.get('npcs')?.[npcId] || null;
  }

  /**
   * Get all NPCs
   */
  getAllNPCs() {
    return Object.values(this.state.get('npcs') || {});
  }

  /**
   * Get NPC quests
   */
  getNPCQuests(npcFactionId, status = null) {
    const quests = this.state.get('quests') || {};
    const npcQuests = Object.values(quests).filter(q => q.owner === npcFactionId);
    return status ? npcQuests.filter(q => q.status === status) : npcQuests;
  }

  /**
   * Get relationship between NPCs
   */
  getRelationship(npc1Id, npc2Id) {
    const key = [npc1Id, npc2Id].sort().join('-');
    return this.state.get('relationships')?.[key] || null;
  }

  /**
   * Get all active quests
   */
  getActiveQuests() {
    const quests = this.state.get('quests') || {};
    return Object.values(quests).filter(q => q.status === 'active');
  }

  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('npc:locked', {});
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('npc:unlocked', {});
  }

  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('npc-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('npc:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('npc-state');
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
 * NPCCalculations - Pure math
 */
class NPCCalculations {
  /**
   * Calculate NPC power level
   */
  calculatePowerLevel(npc) {
    const militaryWeight = npc.military * 0.4;
    const techWeight = npc.technology * 0.3;
    const treasuryWeight = (npc.treasury / 10000) * 100 * 0.3;
    return militaryWeight + techWeight + treasuryWeight;
  }

  /**
   * Calculate relationship decay
   */
  calculateRelationshipDecay(lastInteraction) {
    const daysSinceInteraction = (Date.now() - lastInteraction) / 86400000;
    const decayFactor = Math.max(0.5, 1 - (daysSinceInteraction * 0.01));
    return decayFactor;
  }

  /**
   * Predict NPC action likelihood
   */
  predictActionLikelihood(npc, action) {
    const actionProbability = {
      'expand': npc.personality === 'aggressive' ? 0.8 : 0.3,
      'trade': npc.personality === 'diplomatic' ? 0.8 : 0.2,
      'raid': npc.personality === 'aggressive' ? 0.7 : 0.1,
      'ally': npc.personality === 'diplomatic' ? 0.6 : 0.3,
    };
    return actionProbability[action] || 0.5;
  }
}

export { NPCCalculations };
