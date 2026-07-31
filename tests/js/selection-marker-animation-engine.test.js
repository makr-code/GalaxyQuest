/**
 * tests/js/selection-marker-animation-engine.test.js
 *
 * Unit tests for SelectionMarkerAnimationEngine.js
 * Covers: MarkerAnimationState, MarkerAnimationManager, AnimationManagerPool, easing functions
 */

import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(
  process.cwd(),
  'js/engine/runtime/SelectionMarkerAnimationEngine.js'
);

function loadModule() {
  delete window.GQSelectionMarkerAnimationEngine;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQSelectionMarkerAnimationEngine;
}

describe('SelectionMarkerAnimationEngine', () => {
  let mod;

  beforeEach(() => {
    mod = loadModule();
  });

  // ─── Easing Functions ─────────────────────────────────────────
  describe('EASING_FUNCTIONS', () => {
    it('linear easing returns identity', () => {
      expect(mod.EASING_FUNCTIONS.linear(0)).toBe(0);
      expect(mod.EASING_FUNCTIONS.linear(0.5)).toBe(0.5);
      expect(mod.EASING_FUNCTIONS.linear(1)).toBe(1);
    });

    it('sine-wave oscillates between 0 and 1', () => {
      const sine = mod.EASING_FUNCTIONS['sine-wave'];
      const values = [sine(0), sine(0.25), sine(0.5), sine(0.75), sine(1)];
      
      values.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
    });

    it('ease-out-bounce completes at 1', () => {
      const bounce = mod.EASING_FUNCTIONS['ease-out-bounce'];
      expect(bounce(1)).toBeCloseTo(1, 1);
    });

    it('ease-in-quad starts slow', () => {
      const easeIn = mod.EASING_FUNCTIONS['ease-in-quad'];
      expect(easeIn(0.25)).toBeLessThan(0.25);
      expect(easeIn(0.75)).toBeGreaterThan(0.25);
    });
  });

  // ─── MarkerAnimationState ─────────────────────────────────────
  describe('MarkerAnimationState', () => {
    it('initializes with zero elapsed time', () => {
      const config = { type: 'scale', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      expect(state.elapsedTime).toBe(0);
      expect(state.currentValue).toBe(0);
      expect(state.isPlaying).toBe(true);
    });

    it('updates elapsed time on update()', () => {
      const config = { type: 'scale', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(1000); // 1 second in ms
      expect(state.elapsedTime).toBe(1000);
    });

    it('normalizes time to duration', () => {
      const config = { type: 'scale', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(4000); // 4 seconds, but duration is 2
      const normalized = state.getValue();
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThanOrEqual(1);
    });

    it('cycles after duration', () => {
      const config = { type: 'scale', duration: 1.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(2500); // 2.5 seconds, should cycle
      const value = state.getValue();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    it('can be paused and resumed', () => {
      const config = { type: 'scale', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(500);
      const pausedValue = state.getValue();
      
      state.stop();
      state.update(500);
      expect(state.getValue()).toBe(pausedValue);
      
      state.resume();
      state.update(500);
      // After resume and another update, value should have changed
      // (but might be close to same if timing is identical, so we check it updated)
      expect(state.elapsedTime).toBeGreaterThan(500);
    });

    it('can be reset', () => {
      const config = { type: 'scale', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(1000);
      expect(state.elapsedTime).toBeGreaterThan(0);
      
      state.reset();
      expect(state.elapsedTime).toBe(0);
      expect(state.currentValue).toBe(0);
    });
  });

  // ─── Easing Computation Functions ──────────────────────────────
  describe('Easing Computation Functions', () => {
    it('computeScaleAnimation returns scale between min and max', () => {
      const config = { type: 'scale', duration: 2.0, easing: 'linear' };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(1000); // Half way through
      const scale = mod.computeScaleAnimation(state, 0.95, 1.15, 'linear');
      
      expect(scale).toBeGreaterThanOrEqual(0.95);
      expect(scale).toBeLessThanOrEqual(1.15);
    });

    it('computeOpacityAnimation returns opacity between min and max', () => {
      const config = { type: 'opacity', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(500);
      const opacity = mod.computeOpacityAnimation(state, 0.6, 1.0, 'linear');
      
      expect(opacity).toBeGreaterThanOrEqual(0.6);
      expect(opacity).toBeLessThanOrEqual(1.0);
    });

    it('computeRotationAnimation returns rotation between min and max', () => {
      const config = { type: 'rotation', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(500);
      const rotation = mod.computeRotationAnimation(state, 0, Math.PI * 2, 'linear');
      
      expect(rotation).toBeGreaterThanOrEqual(0);
      expect(rotation).toBeLessThanOrEqual(Math.PI * 2);
    });

    it('computePositionOffsetAnimation returns amplitude-scaled offset', () => {
      const config = { type: 'position-y-offset', duration: 2.0 };
      const state = new mod.MarkerAnimationState(config);
      
      state.update(500);
      const offset = mod.computePositionOffsetAnimation(state, 5, 'ease-out-bounce');
      
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(5);
    });
  });

  // ─── Animation Frame Properties ────────────────────────────────
  describe('getAnimationFrameProperties', () => {
    it('returns identity properties for none animation', () => {
      const props = mod.getAnimationFrameProperties({ type: 'none' }, null, 1.0);
      
      expect(props.scale).toBe(1.0);
      expect(props.opacity).toBe(1.0);
      expect(props.rotation).toBe(0);
      expect(props.positionOffset.x).toBe(0);
      expect(props.positionOffset.y).toBe(0);
    });

    it('computes scale animation properties', () => {
      const config = { type: 'scale', duration: 2.0, minScale: 0.95, maxScale: 1.15 };
      const state = new mod.MarkerAnimationState(config);
      state.update(1000);
      
      const props = mod.getAnimationFrameProperties(config, state, 1.0);
      
      expect(props.scale).not.toBe(1.0);
      expect(props.scale).toBeGreaterThanOrEqual(0.95);
      expect(props.scale).toBeLessThanOrEqual(1.15);
    });

    it('handles null animation state', () => {
      const config = { type: 'scale', duration: 2.0 };
      const props = mod.getAnimationFrameProperties(config, null, 1.0);
      
      expect(props).toBeDefined();
      expect(props.scale).toBe(1.0);
    });
  });

  // ─── MarkerAnimationManager ───────────────────────────────────
  describe('MarkerAnimationManager', () => {
    it('initializes with marker key and animation config', () => {
      const config = { type: 'scale', duration: 2.0 };
      const manager = new mod.MarkerAnimationManager('marker-1', config);
      
      expect(manager.markerKey).toBe('marker-1');
      expect(manager.animationConfig).toEqual(config);
    });

    it('updates frame properties on update()', () => {
      const config = { type: 'scale', duration: 2.0, minScale: 0.95, maxScale: 1.15 };
      const manager = new mod.MarkerAnimationManager('marker-1', config);
      
      manager.update(0.5); // 0.5 seconds
      const props = manager.getFrameProperties();
      
      expect(props.scale).not.toBe(1.0);
    });

    it('can be paused and resumed', () => {
      const config = { type: 'scale', duration: 2.0 };
      const manager = new mod.MarkerAnimationManager('marker-1', config);
      
      manager.update(0.25);
      const pausedProps = manager.getFrameProperties();
      
      manager.stop();
      manager.update(0.25);
      const stoppedProps = manager.getFrameProperties();
      expect(stoppedProps).toEqual(pausedProps);
      
      manager.resume();
      manager.update(0.25);
      const resumedProps = manager.getFrameProperties();
      // After resume and update, animation time should have progressed
      expect(manager.animState.elapsedTime).toBeGreaterThan(250);
    });

    it('can be reset', () => {
      const config = { type: 'scale', duration: 2.0, minScale: 0.95, maxScale: 1.15 };
      const manager = new mod.MarkerAnimationManager('marker-1', config);
      
      manager.update(0.5);
      const propsBeforeReset = manager.getFrameProperties();
      
      manager.reset();
      
      // After reset, the animation state should be reset and frame properties recomputed
      // Since elapsedTime is reset to 0, normalized time becomes 0, which should give ~0.5 with sine-wave
      const propsAfterReset = manager.getFrameProperties();
      // Both should be computed from animation, not identity (scale should not be 1.0)
      expect(propsAfterReset.scale).not.toBe(1.0);
      expect(propsAfterReset.scale).toBeGreaterThanOrEqual(0.95);
      expect(propsAfterReset.scale).toBeLessThanOrEqual(1.15);
    });
  });

  // ─── AnimationManagerPool ─────────────────────────────────────
  describe('AnimationManagerPool', () => {
    it('acquires manager from pool', () => {
      const pool = new mod.AnimationManagerPool(10);
      const config = { type: 'scale', duration: 2.0 };
      
      const manager = pool.acquire('marker-1', config);
      
      expect(manager).toBeDefined();
      expect(manager.markerKey).toBe('marker-1');
    });

    it('releases manager back to pool', () => {
      const pool = new mod.AnimationManagerPool(10);
      const config = { type: 'scale', duration: 2.0 };
      
      pool.acquire('marker-1', config);
      expect(pool.getStatistics().activeCount).toBe(1);
      
      pool.release('marker-1');
      expect(pool.getStatistics().activeCount).toBe(0);
    });

    it('reuses managers from pool', () => {
      const pool = new mod.AnimationManagerPool(5);
      const config = { type: 'scale', duration: 2.0 };
      
      const m1 = pool.acquire('marker-1', config);
      pool.release('marker-1');
      
      const m2 = pool.acquire('marker-2', config);
      
      expect(m1).toBe(m2);
    });

    it('can get active manager', () => {
      const pool = new mod.AnimationManagerPool(10);
      const config = { type: 'scale', duration: 2.0 };
      
      const acquired = pool.acquire('marker-1', config);
      const retrieved = pool.get('marker-1');
      
      expect(acquired).toBe(retrieved);
    });

    it('updates all active managers', () => {
      const pool = new mod.AnimationManagerPool(10);
      const config = { type: 'scale', duration: 2.0 };
      
      const m1 = pool.acquire('marker-1', config);
      const m2 = pool.acquire('marker-2', config);
      
      pool.updateAll(0.5);
      
      const props1 = m1.getFrameProperties();
      const props2 = m2.getFrameProperties();
      
      expect(props1.scale).not.toBe(1.0);
      expect(props2.scale).not.toBe(1.0);
    });

    it('provides statistics', () => {
      const pool = new mod.AnimationManagerPool(10);
      const config = { type: 'scale', duration: 2.0 };
      
      pool.acquire('marker-1', config);
      pool.acquire('marker-2', config);
      
      const stats = pool.getStatistics();
      
      expect(stats.activeCount).toBe(2);
      expect(stats.pooledCount).toBeGreaterThanOrEqual(0);
      expect(stats.totalCapacity).toBeGreaterThanOrEqual(2);
    });

    it('releases all managers', () => {
      const pool = new mod.AnimationManagerPool(10);
      const config = { type: 'scale', duration: 2.0 };
      
      pool.acquire('marker-1', config);
      pool.acquire('marker-2', config);
      
      pool.releaseAll();
      
      const stats = pool.getStatistics();
      expect(stats.activeCount).toBe(0);
    });
  });

  // ─── Integration ──────────────────────────────────────────────
  describe('Integration', () => {
    it('animation manager works with pool', () => {
      const pool = new mod.AnimationManagerPool(10);
      const config = { type: 'scale', duration: 2.0 };
      
      const manager = pool.acquire('marker-1', config);
      manager.update(0.5);
      
      const props = manager.getFrameProperties();
      expect(props.scale).not.toBe(1.0);
      
      pool.release('marker-1');
    });

    it('multiple animations can run independently', () => {
      const pool = new mod.AnimationManagerPool(10);
      
      const scaleConfig = { type: 'scale', duration: 2.0 };
      const rotationConfig = { type: 'rotation', duration: 3.0 };
      
      const m1 = pool.acquire('marker-1', scaleConfig);
      const m2 = pool.acquire('marker-2', rotationConfig);
      
      m1.update(0.5);
      m2.update(0.5);
      
      const props1 = m1.getFrameProperties();
      const props2 = m2.getFrameProperties();
      
      // Different animations should produce different results
      expect(props1.scale).not.toBe(1.0);
      expect(props2.rotation).not.toBe(0);
    });
  });
});
