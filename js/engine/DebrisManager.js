/**
 * DebrisManager.js - Advanced debris system with state machine & damage tracking
 * 
 * Manages destruction progression of debris/asteroids/wreckage:
 * - Registry of active debris objects
 * - State transitions (intact → damaged → critical → destroyed)
 * - Cumulative damage tracking
 * - Fragment emission calculations
 * - Lifecycle management
 * 
 * Part of VFX Phase 3: Advanced Weapon Effects
 * 
 * Usage:
 *   const mgr = new DebrisManager();
 *   mgr.add('ast_1', [0,0,0], { health: 100 });
 *   mgr.applyDamage('ast_1', 35);  // state → 'damaged'
 *   mgr.on('state-changed', (debris) => {...});
 */

class DebrisManager {
  constructor(opts = {}) {
    /**
     * Active debris objects by ID
     * @type {Map<string, DebrisObject>}
     */
    this.debris = new Map();

    /**
     * Event listeners
     * @type {Map<string, Function[]>}
     */
    this._listeners = new Map();

    // Configuration (tunable for gameplay balance)
    this.config = {
      damageDampenFactor: opts.damageDampenFactor ?? 1.0,      // Multiply all damage
      easyThreshold: opts.easyThreshold ?? 0.35,                // → 'damaged'
      hardThreshold: opts.hardThreshold ?? 0.65,                // → 'critical'
      destroyThreshold: opts.destroyThreshold ?? 0.90,          // → 'destroyed'
      fragmentOnDamaged: opts.fragmentOnDamaged ?? 6,           // Particles at damaged
      fragmentOnCritical: opts.fragmentOnCritical ?? 12,        // Particles at critical
      fragmentOnDestroy: opts.fragmentOnDestroy ?? 24,          // Particles on destruction
      autoCleanup: opts.autoCleanup ?? true,                    // Remove on destroyed
      debugLogging: opts.debugLogging ?? false,
    };

    if (this.config.debugLogging) {
      console.log('[DebrisManager] Init with config:', this.config);
    }
  }

  /**
   * Register a new debris object
   * @param {string} id - Unique identifier
   * @param {[number, number, number]} position - World position
   * @param {object} opts - Debris options
   *   - health: {number} Starting health (default: 100)
   *   - maxHealth: {number} Max health (default: same as health)
   *   - model: {string} Model type for visual reference
   * @returns {object} Created debris object
   */
  add(id, position, opts = {}) {
    if (this.debris.has(id)) {
      console.warn(`[DebrisManager] Debris '${id}' already exists, replacing`);
    }

    const health = Math.max(1, Number(opts.health ?? 100));
    const debris = {
      id,
      position: Array.isArray(position) ? [...position] : [0, 0, 0],
      state: 'intact',                      // intact|damaged|critical|destroyed
      damageLevel: 0.0,                     // Normalized 0..1
      health,
      maxHealth: Math.max(health, Number(opts.maxHealth ?? health)),
      model: String(opts.model || 'debris'),
      fragmentCount: 0,                     // Total fragments emitted
      lastHit: null,                        // Timestamp of last damage
      damageHistory: [],                    // Array of damage events
      mesh: opts.mesh || null,              // THREE.js mesh reference (optional)
      createdAt: performance.now(),
    };

    this.debris.set(id, debris);

    if (this.config.debugLogging) {
      console.log(`[DebrisManager] Added debris '${id}' at`, position);
    }

    return debris;
  }

  /**
   * Apply damage to debris and handle state transitions
   * @param {string} id - Debris ID
   * @param {number} amount - Damage amount
   * @param {object} context - Damage context (optional)
   *   - attacker: {string} Faction that dealt damage
   *   - weaponKind: {string} Type of weapon
   *   - timestamp: {number} Hit time
   * @returns {object} Updated debris object or null if not found
   */
  applyDamage(id, amount, context = {}) {
    const debris = this.debris.get(id);
    if (!debris) {
      console.warn(`[DebrisManager] Debris '${id}' not found`);
      return null;
    }

    if (debris.state === 'destroyed') {
      // Already destroyed, ignore further damage
      return debris;
    }

    // Apply damage dampening
    const damageApplied = Math.max(0.1, amount * this.config.damageDampenFactor);
    const damageNormalized = damageApplied / debris.maxHealth;

    // Track damage
    debris.lastHit = performance.now();
    debris.damageHistory.push({
      timestamp: debris.lastHit,
      amount: damageApplied,
      attacker: String(context.attacker || 'unknown'),
      weaponKind: String(context.weaponKind || 'unknown'),
    });

    // Update health & damage level
    debris.health = Math.max(0, debris.health - damageApplied);
    debris.damageLevel = Math.min(1.0, debris.damageLevel + damageNormalized);

    // State transition
    const previousState = debris.state;
    this._updateDebrisState(debris);

    if (debris.state !== previousState) {
      this._emitEvent('state-changed', debris, { from: previousState, to: debris.state });

      if (this.config.debugLogging) {
        console.log(
          `[DebrisManager] Debris '${id}' state: ${previousState} → ${debris.state}`,
          `(damage: ${debris.damageLevel.toFixed(2)}, health: ${debris.health.toFixed(1)}/${debris.maxHealth})`
        );
      }
    }

    if (debris.state === 'destroyed' && this.config.autoCleanup) {
      window.setTimeout(() => this.destroy(id), 100);
    }

    return debris;
  }

  /**
   * Update debris state based on damage level
   * Triggers fragment emission calculations
   * @param {object} debris - Debris object
   * @private
   */
  _updateDebrisState(debris) {
    const dmg = debris.damageLevel;

    if (dmg >= this.config.destroyThreshold) {
      debris.state = 'destroyed';
      debris.fragmentCount = Math.max(debris.fragmentCount, this.config.fragmentOnDestroy);
    } else if (dmg >= this.config.hardThreshold) {
      debris.state = 'critical';
      debris.fragmentCount = Math.max(debris.fragmentCount, this.config.fragmentOnCritical);
    } else if (dmg >= this.config.easyThreshold) {
      debris.state = 'damaged';
      debris.fragmentCount = Math.max(debris.fragmentCount, this.config.fragmentOnDamaged);
    }
  }

  /**
   * Get debris by ID
   * @param {string} id - Debris ID
   * @returns {object|null} Debris object or null
   */
  get(id) {
    return this.debris.get(id) || null;
  }

  /**
   * Get all debris objects
   * @returns {array} Array of all debris
   */
  getAll() {
    return Array.from(this.debris.values());
  }

  /**
   * Get debris by state
   * @param {string} state - State filter (intact|damaged|critical|destroyed)
   * @returns {array} Array of debris matching state
   */
  getByState(state) {
    return Array.from(this.debris.values()).filter((d) => d.state === state);
  }

  /**
   * Get debris radius (for proximity queries)
   * @param {string} id - Debris ID
   * @param {number} defaultRadius - Default if not specified
   * @returns {number} Effective radius
   */
  getRadius(id, defaultRadius = 10) {
    const debris = this.debris.get(id);
    if (!debris) return defaultRadius;
    
    // Radius depends on state (broken pieces are smaller)
    if (debris.state === 'destroyed') return defaultRadius * 0.5;
    if (debris.state === 'critical') return defaultRadius * 0.8;
    return defaultRadius;
  }

  /**
   * Check if debris is in danger zone (critical/destroyed)
   * @param {string} id - Debris ID
   * @returns {boolean}
   */
  isInDanger(id) {
    const debris = this.debris.get(id);
    return debris ? debris.state === 'critical' || debris.state === 'destroyed' : false;
  }

  /**
   * Get damage history for debris
   * @param {string} id - Debris ID
   * @returns {array} Damage history
   */
  getDamageHistory(id) {
    const debris = this.debris.get(id);
    return debris ? [...debris.damageHistory] : [];
  }

  /**
   * Get cooperative damage info
   * @param {string} id - Debris ID
   * @returns {object} { totalDamage, attackers: Map<faction> }
   */
  getCooperativeInfo(id) {
    const debris = this.debris.get(id);
    if (!debris) return null;

    const attackers = new Map();
    let totalDamage = 0;

    debris.damageHistory.forEach((hit) => {
      totalDamage += hit.amount;
      const current = attackers.get(hit.attacker) || 0;
      attackers.set(hit.attacker, current + hit.amount);
    });

    return {
      totalDamage,
      attackerCount: attackers.size,
      attackers,
      isCooperative: attackers.size > 1,
    };
  }

  /**
   * Restore debris to intact state
   * @param {string} id - Debris ID
   */
  repair(id) {
    const debris = this.debris.get(id);
    if (!debris) return;

    const previousState = debris.state;
    debris.state = 'intact';
    debris.damageLevel = 0;
    debris.health = debris.maxHealth;
    debris.damageHistory = [];

    this._emitEvent('state-changed', debris, { from: previousState, to: 'intact' });
  }

  /**
   * Remove debris from registry
   * @param {string} id - Debris ID
   * @returns {boolean} True if debris existed
   */
  destroy(id) {
    if (this.config.debugLogging) {
      console.log(`[DebrisManager] Destroyed debris '${id}'`);
    }
    return this.debris.delete(id);
  }

  /**
   * Clear all debris
   */
  clear() {
    this.debris.clear();
    this._listeners.clear();
  }

  /**
   * Register event listener
   * @param {string} event - Event name (state-changed, etc)
   * @param {Function} callback - (debris, data) => {}
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  /**
   * Unregister event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback to remove
   */
  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;

    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  }

  /**
   * Emit event to listeners
   * @param {string} event - Event name
   * @param {object} debris - Debris object
   * @param {object} data - Event data
   * @private
   */
  _emitEvent(event, debris, data = {}) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;

    listeners.forEach((callback) => {
      try {
        callback(debris, data);
      } catch (err) {
        console.error(`[DebrisManager] Error in event '${event}':`, err);
      }
    });
  }

  /**
   * Get statistics for debugging
   * @returns {object} Stats object
   */
  getStats() {
    const all = this.getAll();
    const states = {
      intact: this.getByState('intact').length,
      damaged: this.getByState('damaged').length,
      critical: this.getByState('critical').length,
      destroyed: this.getByState('destroyed').length,
    };

    let totalDamageReceived = 0;
    let cooperativeHits = 0;

    all.forEach((debris) => {
      debris.damageHistory.forEach((hit) => {
        totalDamageReceived += hit.amount;
      });
      if (debris.damageHistory.length > 1) cooperativeHits++;
    });

    return {
      totalDebris: all.length,
      states,
      totalDamageReceived,
      cooperativeDebris: cooperativeHits,
      memoryUsage: all.length * 150, // Approximate bytes
    };
  }
}

// Export for use in galaxy renderer
if (typeof window !== 'undefined') {
  window.DebrisManager = DebrisManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DebrisManager;
}
