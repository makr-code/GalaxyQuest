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
   * @param {TechNode} def
   */
  define(def) {
    if (!def.id) throw new TypeError('[ResearchTree] TechNode must have an id');
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
  module.exports = { ResearchTree, ResearchCategory };
} else {
  window.GQResearchTree = { ResearchTree, ResearchCategory };
}
