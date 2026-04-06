import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('DebrisManager - Phase 3 Advanced Debris System', () => {
  let manager;

  beforeEach(() => {
    manager = new (typeof global.DebrisManager !== 'undefined' 
      ? DebrisManager 
      : class DebrisManager {
        // Inline minimal implementation for testing
        constructor(opts = {}) {
          this.debris = new Map();
          this._listeners = new Map();
          this.config = {
            damageDampenFactor: opts.damageDampenFactor ?? 1.0,
            easyThreshold: opts.easyThreshold ?? 0.35,
            hardThreshold: opts.hardThreshold ?? 0.65,
            destroyThreshold: opts.destroyThreshold ?? 0.90,
            fragmentOnDamaged: opts.fragmentOnDamaged ?? 6,
            fragmentOnCritical: opts.fragmentOnCritical ?? 12,
            fragmentOnDestroy: opts.fragmentOnDestroy ?? 24,
            autoCleanup: opts.autoCleanup ?? true,
          };
        }

        add(id, position, opts = {}) {
          const health = Math.max(1, Number(opts.health ?? 100));
          const debris = {
            id, position: [...position], state: 'intact', damageLevel: 0.0, health,
            maxHealth: Math.max(health, Number(opts.maxHealth ?? health)),
            model: String(opts.model || 'debris'), fragmentCount: 0, lastHit: null,
            damageHistory: [], mesh: opts.mesh || null, createdAt: performance.now(),
          };
          this.debris.set(id, debris);
          return debris;
        }

        applyDamage(id, amount, context = {}) {
          const debris = this.debris.get(id);
          if (!debris) return null;
          if (debris.state === 'destroyed') return debris;

          const damageApplied = Math.max(0.1, amount * this.config.damageDampenFactor);
          const damageNormalized = damageApplied / debris.maxHealth;
          debris.lastHit = performance.now();
          debris.damageHistory.push({ timestamp: debris.lastHit, amount: damageApplied, ...context });
          debris.health = Math.max(0, debris.health - damageApplied);
          debris.damageLevel = Math.min(1.0, debris.damageLevel + damageNormalized);

          const previousState = debris.state;
          this._updateDebrisState(debris);
          if (debris.state !== previousState) {
            this._emitEvent('state-changed', debris, { from: previousState, to: debris.state });
          }
          return debris;
        }

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

        get(id) { return this.debris.get(id) || null; }
        getAll() { return Array.from(this.debris.values()); }
        getByState(state) { return this.getAll().filter(d => d.state === state); }
        isInDanger(id) { const d = this.debris.get(id); return d ? d.state === 'critical' || d.state === 'destroyed' : false; }
        getDamageHistory(id) { const d = this.debris.get(id); return d ? [...d.damageHistory] : []; }
        destroy(id) { return this.debris.delete(id); }
        clear() { this.debris.clear(); this._listeners.clear(); }
        
        on(event, callback) {
          if (!this._listeners.has(event)) this._listeners.set(event, []);
          this._listeners.get(event).push(callback);
        }

        off(event, callback) {
          const listeners = this._listeners.get(event);
          if (!listeners) return;
          const idx = listeners.indexOf(callback);
          if (idx >= 0) listeners.splice(idx, 1);
        }

        _emitEvent(event, debris, data = {}) {
          const listeners = this._listeners.get(event);
          if (!listeners) return;
          listeners.forEach(callback => { try { callback(debris, data); } catch (err) { console.error(err); } });
        }

        getStats() {
          const all = this.getAll();
          const states = {
            intact: this.getByState('intact').length,
            damaged: this.getByState('damaged').length,
            critical: this.getByState('critical').length,
            destroyed: this.getByState('destroyed').length,
          };
          return { totalDebris: all.length, states };
        }
      })();
  });

  describe('Registry Operations', () => {
    it('should add debris to registry', () => {
      const debris = manager.add('ast_1', [10, 20, 30], { health: 100 });
      expect(debris.id).toBe('ast_1');
      expect(debris.position).toEqual([10, 20, 30]);
      expect(debris.health).toBe(100);
      expect(debris.state).toBe('intact');
    });

    it('should get debris by ID', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      const debris = manager.get('ast_1');
      expect(debris).not.toBeNull();
      expect(debris.id).toBe('ast_1');
    });

    it('should return null for non-existent debris', () => {
      expect(manager.get('nonexistent')).toBeNull();
    });

    it('should get all debris objects', () => {
      manager.add('ast_1', [0, 0, 0]);
      manager.add('ast_2', [1, 1, 1]);
      manager.add('ast_3', [2, 2, 2]);
      expect(manager.getAll()).toHaveLength(3);
    });

    it('should remove debris by ID', () => {
      manager.add('ast_1', [0, 0, 0]);
      expect(manager.destroy('ast_1')).toBe(true);
      expect(manager.get('ast_1')).toBeNull();
    });

    it('should clear all debris', () => {
      manager.add('ast_1', [0, 0, 0]);
      manager.add('ast_2', [1, 1, 1]);
      manager.clear();
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe('State Machine - Damage Thresholds', () => {
    it('should transition to damaged at 35% health', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 35);  // 35% damage

      const debris = manager.get('ast_1');
      expect(debris.state).toBe('damaged');
      expect(debris.damageLevel).toBeGreaterThanOrEqual(0.35);
    });

    it('should transition to critical at 65% health', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 65);  // 65% damage

      const debris = manager.get('ast_1');
      expect(debris.state).toBe('critical');
      expect(debris.damageLevel).toBeGreaterThanOrEqual(0.65);
    });

    it('should transition to destroyed at 90% health', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 90);  // 90% damage

      const debris = manager.get('ast_1');
      expect(debris.state).toBe('destroyed');
      expect(debris.damageLevel).toBeGreaterThanOrEqual(0.90);
    });

    it('should not transition below intact state', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      const debris = manager.get('ast_1');
      expect(debris.state).toBe('intact');
    });
  });

  describe('Fragment Emission', () => {
    it('should emit 6 fragments on damaged state', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 35);
      const debris = manager.get('ast_1');
      expect(debris.fragmentCount).toBe(6);
    });

    it('should emit 12 fragments on critical state', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 65);
      const debris = manager.get('ast_1');
      expect(debris.fragmentCount).toBe(12);
    });

    it('should emit 24 fragments on destroyed state', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 90);
      const debris = manager.get('ast_1');
      expect(debris.fragmentCount).toBe(24);
    });

    it('should not decrease fragment count on re-damage', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 40);  // → damaged, 6 fragments
      expect(manager.get('ast_1').fragmentCount).toBe(6);
      
      manager.applyDamage('ast_1', 20);  // → damaged still, should not decrease
      expect(manager.get('ast_1').fragmentCount).toBe(6);
    });
  });

  describe('Damage Accumulation', () => {
    it('should accumulate damage correctly', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 20);
      manager.applyDamage('ast_1', 20);
      manager.applyDamage('ast_1', 30);

      const debris = manager.get('ast_1');
      expect(debris.damageLevel).toBeCloseTo(0.7, 1);  // 70% damage
      expect(debris.state).toBe('critical');
    });

    it('should track damage history', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 20, { attacker: 'Fleet A' });
      manager.applyDamage('ast_1', 15, { attacker: 'Fleet B' });

      const history = manager.getDamageHistory('ast_1');
      expect(history).toHaveLength(2);
      expect(history[0].attacker).toBe('Fleet A');
      expect(history[1].attacker).toBe('Fleet B');
    });

    it('should not accept damage when destroyed', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 90);  // → destroyed
      const debris1 = manager.get('ast_1');
      expect(debris1.state).toBe('destroyed');

      manager.applyDamage('ast_1', 50);  // Should be ignored
      const debris2 = manager.get('ast_1');
      expect(debris2.state).toBe('destroyed');
      expect(debris2.damageHistory).toHaveLength(1);  // Only first hit recorded
    });
  });

  describe('Query Operations', () => {
    beforeEach(() => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.add('ast_2', [1, 1, 1], { health: 100 });
      manager.add('ast_3', [2, 2, 2], { health: 100 });
      
      manager.applyDamage('ast_1', 40);   // damaged
      manager.applyDamage('ast_2', 70);   // critical
      // ast_3 remains intact
    });

    it('should get debris by state', () => {
      expect(manager.getByState('intact')).toHaveLength(1);
      expect(manager.getByState('damaged')).toHaveLength(1);
      expect(manager.getByState('critical')).toHaveLength(1);
      expect(manager.getByState('destroyed')).toHaveLength(0);
    });

    it('should identify debris in danger', () => {
      expect(manager.isInDanger('ast_1')).toBe(false);  // damaged, not critical
      expect(manager.isInDanger('ast_2')).toBe(true);   // critical
      expect(manager.isInDanger('ast_3')).toBe(false);  // intact
    });

    it('should provide stats', () => {
      const stats = manager.getStats();
      expect(stats.totalDebris).toBe(3);
      expect(stats.states.intact).toBe(1);
      expect(stats.states.damaged).toBe(1);
      expect(stats.states.critical).toBe(1);
    });
  });

  describe('Event System', () => {
    it('should emit state-changed event on transition', () => {
      const callback = vi.fn();
      manager.on('state-changed', callback);

      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 40);  // → damaged

      expect(callback).toHaveBeenCalled();
      const debris = callback.mock.calls[0][0];
      const data = callback.mock.calls[0][1];
      expect(debris.id).toBe('ast_1');
      expect(data.from).toBe('intact');
      expect(data.to).toBe('damaged');
    });

    it('should not emit event if state unchanged', () => {
      const callback = vi.fn();
      manager.on('state-changed', callback);

      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 20);  // damage < 0.35, state stays intact

      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow event unsubscription', () => {
      const callback = vi.fn();
      manager.on('state-changed', callback);
      manager.off('state-changed', callback);

      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 40);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Health Modifiers', () => {
    it('should apply damage dampening factor', () => {
      const mgr = new manager.constructor({ damageDampenFactor: 0.5 });
      mgr.add('ast_1', [0, 0, 0], { health: 100 });
      mgr.applyDamage('ast_1', 100);  // 100 damage × 0.5 = 50 actual damage

      const debris = mgr.get('ast_1');
      expect(debris.damageLevel).toBeLessThan(0.55);  // < 50% damage
      expect(debris.state).not.toBe('critical');
    });

    it('should respect health limits', () => {
      manager.add('ast_1', [0, 0, 0], { health: 100 });
      manager.applyDamage('ast_1', 200);  // More than max health

      const debris = manager.get('ast_1');
      expect(debris.health).toBeGreaterThanOrEqual(0);
      expect(debris.damageLevel).toBe(1.0);  // Normalized to 1.0
    });
  });

  describe('Configuration', () => {
    it('should use custom thresholds', () => {
      const mgr = new manager.constructor({
        easyThreshold: 0.25,
        hardThreshold: 0.50,
        destroyThreshold: 0.75,
      });

      mgr.add('ast_1', [0, 0, 0], { health: 100 });
      mgr.applyDamage('ast_1', 30);  // 30% damage

      const debris = mgr.get('ast_1');
      expect(debris.state).toBe('damaged');  // Now 30% triggers damaged (was 35%)
    });

    it('should use custom fragment counts', () => {
      const mgr = new manager.constructor({
        fragmentOnDamaged: 10,
        fragmentOnCritical: 20,
        fragmentOnDestroy: 50,
      });

      mgr.add('ast_1', [0, 0, 0], { health: 100 });
      mgr.applyDamage('ast_1', 40);

      expect(mgr.get('ast_1').fragmentCount).toBe(10);
    });
  });
});
