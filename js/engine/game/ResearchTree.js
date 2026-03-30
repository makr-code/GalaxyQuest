/**
 * ResearchTree.js  — Technology Research Tree
 *
 * Inspired by:
 *   Master of Orion   (SimTex, 1993) — linear tech tree per category
 *   Endless Space 2   (Amplitude, 2017) — era-gated tech web with affinities
 *   Stellaris         (Paradox, 2016) — randomised card draw from weighted pool
 *   X4: Foundations   (Egosoft, 2018) — engineer research queues
 *
 * Provides:
 *   - A DAG (directed acyclic graph) of TechNodes
 *   - Each node has: id, era, cost, prerequisites, category, effects[]
 *   - Research queue with progress tracking
 *   - Affinity system: some factions research faster in certain categories
 *   - EventBus integration: emits 'research:complete', 'research:started'
 *
 * Usage:
 *   const tree = new ResearchTree(engine.events);
 *
 *   tree.define({
 *     id:   'propulsion.warp_drive',
 *     name: 'Warp Drive',
 *     category: ResearchCategory.PROPULSION,
 *     era: 1,
 *     cost: 200,
 *     prerequisites: ['propulsion.ion_engine'],
 *     effects: [{ type: 'fleet_speed', value: 2 }],
 *   });
 *
 *   tree.startResearch('propulsion.warp_drive');
 *   tree.addProgress(50);   // called each turn with research points
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** @enum {string} */
const ResearchCategory = Object.freeze({
  PROPULSION:  'propulsion',   // Travel speed, jump range  (X4 / MoO)
  WEAPONS:     'weapons',      // Ship combat power          (MoO / ES2)
  SHIELDS:     'shields',      // Defence                    (MoO / ES2)
  INDUSTRY:    'industry',     // Production / colony build  (Victoria 3)
  BIOLOGY:     'biology',      // Pop growth, planet adapt   (Stellaris)
  COMPUTING:   'computing',    // Fleet AI, spy ops          (ES2 / Stellaris)
  ENERGY:      'energy',       // Power, shields, lasers     (X4)
  DIPLOMACY:   'diplomacy',    // Treaties, influence        (Victoria 3)
  EXPLORATION: 'exploration',  // Survey range, anomalies    (Stellaris)
});

/**
 * Civilization-level affinity buckets (Endless Space 2 — faction affinities).
 * Maps a civ's strategic focus to a research speed bonus.
 * @enum {string}
 */
const CivAffinity = Object.freeze({
  MILITARY: 'military',  // Bonus to WEAPONS, SHIELDS
  SCIENCE:  'science',   // Bonus to COMPUTING, ENERGY
  ECONOMY:  'economy',   // Bonus to INDUSTRY, EXPLORATION
  CULTURE:  'culture',   // Bonus to DIPLOMACY, BIOLOGY
});

// ---------------------------------------------------------------------------
// ResearchTree
// ---------------------------------------------------------------------------

class ResearchTree {
  /**
   * @param {import('../EventBus').EventBus} [bus]
   */
  constructor(bus) {
    this._bus    = bus ?? null;
    /** @type {Map<string, TechNode>} */
    this._nodes  = new Map();
    /** @type {Set<string>}  ids of completed techs */
    this._done   = new Set();
    /** @type {string|null}  currently active research */
    this._active = null;
    /** @type {number} accumulated research points toward active tech */
    this._progress = 0;
    /** Category speed multipliers (affinity system — Endless Space 2) */
    this._affinity = {};
  }

  // ---------------------------------------------------------------------------
  // Tree building
  // ---------------------------------------------------------------------------

  /**
   * Define a technology node.
   * Throws if the definition would introduce a cycle in the DAG.
   * @param {TechNode} def
   */
  define(def) {
    if (!def.id) throw new TypeError('[ResearchTree] TechNode must have an id');

    // Cycle detection: for each prerequisite, check if def.id is already
    // reachable from that prerequisite via the existing graph.  If so,
    // adding this node would close a cycle.
    for (const prereq of def.prerequisites ?? []) {
      if (prereq === def.id) {
        throw new Error(`[ResearchTree] Cyclic dependency: '${def.id}' lists itself as a prerequisite`);
      }
      if (this._isReachable(prereq, def.id)) {
        throw new Error(`[ResearchTree] Cyclic dependency detected: adding '${def.id}' would create a cycle via '${prereq}'`);
      }
    }

    this._nodes.set(def.id, {
      era:           def.era           ?? 1,
      category:      def.category      ?? ResearchCategory.COMPUTING,
      cost:          def.cost          ?? 100,
      prerequisites: def.prerequisites ?? [],
      effects:       def.effects       ?? [],
      name:          def.name          ?? def.id,
      description:   def.description   ?? '',
      ...def,
    });
    return this;
  }

  /**
   * Check whether `targetId` is reachable from `startId` by following
   * prerequisite edges in the current graph.
   *
   * @param {string} startId
   * @param {string} targetId
   * @param {Set<string>} [visited]
   * @returns {boolean}
   */
  _isReachable(startId, targetId, visited = new Set()) {
    if (startId === targetId) return true;
    if (visited.has(startId)) return false;
    visited.add(startId);
    const node = this._nodes.get(startId);
    if (!node) return false;
    for (const prereq of node.prerequisites) {
      if (this._isReachable(prereq, targetId, visited)) return true;
    }
    return false;
  }

  /**
   * Set a faction affinity multiplier for a research category.
   * E.g. setAffinity(ResearchCategory.PROPULSION, 1.5) = 50% faster propulsion research.
   *
   * @param {string} category
   * @param {number} multiplier  > 1 = faster, < 1 = slower
   */
  setAffinity(category, multiplier) {
    this._affinity[category] = multiplier;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Research queue
  // ---------------------------------------------------------------------------

  /**
   * Start researching a tech.  Prerequisites must be completed first.
   * @param {string} id
   */
  startResearch(id) {
    const node = this._nodes.get(id);
    if (!node)             { console.warn(`[ResearchTree] Unknown tech: '${id}'`); return this; }
    if (this._done.has(id)){ console.warn(`[ResearchTree] Already researched: '${id}'`); return this; }

    const missing = node.prerequisites.filter((p) => !this._done.has(p));
    if (missing.length > 0) {
      console.warn(`[ResearchTree] Prerequisites missing for '${id}': ${missing.join(', ')}`);
      return this;
    }

    this._active   = id;
    this._progress = 0;
    this._bus?.emit('research:started', { id, node });
    return this;
  }

  /**
   * Add research points toward the active technology.
   * Call once per game turn with the faction's research output.
   *
   * @param {number} points
   * @returns {boolean}  true if the active tech was just completed
   */
  addProgress(points) {
    if (!this._active) return false;
    const node       = this._nodes.get(this._active);
    if (!node) return false;
    const multiplier = this._affinity[node.category] ?? 1;
    this._progress  += points * multiplier;

    if (this._progress >= node.cost) {
      this._complete(this._active);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** @returns {boolean} */
  isResearched(id) { return this._done.has(id); }

  /**
   * All techs available to research right now (prerequisites met, not done).
   * Uses the internal `_done` set.
   * @returns {TechNode[]}
   */
  available() {
    const result = [];
    for (const [id, node] of this._nodes) {
      if (this._done.has(id)) continue;
      if (node.prerequisites.every((p) => this._done.has(p))) {
        result.push(node);
      }
    }
    return result;
  }

  /**
   * DAG traversal with era-gating.
   * A tech is available when:
   *   1. Its prerequisites are all in `unlockedSet`.
   *   2. If it belongs to era N+1, at least 60% of era-N techs are in `unlockedSet`.
   *
   * @param {Set<string>} unlockedSet  Set of already-unlocked tech IDs
   * @returns {TechNode[]}
   */
  getAvailable(unlockedSet) {
    // Tally per-era totals and unlocked counts
    const eraTotal = new Map();
    const eraDone  = new Map();
    for (const [id, node] of this._nodes) {
      const era = node.era;
      eraTotal.set(era, (eraTotal.get(era) ?? 0) + 1);
      if (unlockedSet.has(id)) {
        eraDone.set(era, (eraDone.get(era) ?? 0) + 1);
      }
    }

    const result = [];
    for (const [id, node] of this._nodes) {
      if (unlockedSet.has(id)) continue;
      if (!node.prerequisites.every((p) => unlockedSet.has(p))) continue;

      // Era-gating: tech of era N requires ≥60 % of era-(N-1) to be unlocked
      const era = node.era;
      if (era > 1) {
        const prevEra  = era - 1;
        const total    = eraTotal.get(prevEra) ?? 0;
        const done     = eraDone.get(prevEra)  ?? 0;
        if (total > 0 && done / total < 0.6) continue;
      }

      result.push(node);
    }
    return result;
  }

  /**
   * Estimate how many research-points are needed to complete a tech,
   * accounting for an affinity map.
   *
   * @param {string} techId
   * @param {Object<string,number>} [affinityMap]  category → multiplier
   * @returns {number}  Effective research-point cost (Infinity if unknown tech)
   */
  estimateResearchTime(techId, affinityMap = {}) {
    const node = this._nodes.get(techId);
    if (!node) return Infinity;
    const multiplier = affinityMap[node.category] ?? this._affinity[node.category] ?? 1;
    return node.cost / multiplier;
  }

  /**
   * Return a snapshot of all currently unlocked tech IDs.
   * @returns {Set<string>}
   */
  getUnlocked() {
    return new Set(this._done);
  }

  /**
   * Directly unlock a tech (persistence / save-load helper).
   * Emits 'research:unlocked'.  No-ops if already unlocked or unknown.
   *
   * @param {string} id
   * @returns {this}
   */
  unlock(id) {
    const node = this._nodes.get(id);
    if (!node) { console.warn(`[ResearchTree] Unknown tech: '${id}'`); return this; }
    if (this._done.has(id)) return this;
    this._done.add(id);
    this._bus?.emit('research:unlocked', { id, node });
    return this;
  }

  /** All completed TechNodes in completion order. */
  get completed() {
    return [...this._done].map((id) => this._nodes.get(id)).filter(Boolean);
  }

  /** Current research progress [0, 1]. */
  get progressFraction() {
    if (!this._active) return 0;
    const node = this._nodes.get(this._active);
    return node ? Math.min(1, this._progress / node.cost) : 0;
  }

  /** The TechNode currently being researched (or null). */
  get activeNode() {
    return this._active ? (this._nodes.get(this._active) ?? null) : null;
  }

  get nodeCount() { return this._nodes.size; }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _complete(id) {
    this._done.add(id);
    const node     = this._nodes.get(id);
    this._active   = null;
    this._progress = 0;
    this._bus?.emit('research:complete', { id, node, effects: node.effects });
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ResearchTree, ResearchCategory, CivAffinity };
} else {
  window.GQResearchTree = { ResearchTree, ResearchCategory, CivAffinity };
}
