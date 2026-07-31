/**
 * SelectionMarkerAnimationEngine.js
 *
 * Time-based animation system for selection markers.
 * Manages pulse, glow, rotation, and custom easing animations.
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  /**
   * Easing functions for smooth animation curves
   */
  const EASING_FUNCTIONS = {
    'linear': (t) => t,
    'sine-wave': (t) => Math.sin(t * Math.PI * 2) * 0.5 + 0.5,
    'ease-out-bounce': (t) => {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    'ease-in-quad': (t) => t * t,
    'ease-out-quad': (t) => 1 - (1 - t) * (1 - t),
    'ease-in-out-quad': (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  };

  /**
   * Animation state tracker
   */
  class MarkerAnimationState {
    constructor(animationConfig) {
      this.config = animationConfig || {};
      this.elapsedTime = 0;
      this.isPlaying = true;
      this.currentValue = 0;
    }

    update(deltaTime) {
      if (!this.isPlaying || !this.config.duration) return;

      this.elapsedTime += deltaTime;
      const normalizedTime = (this.elapsedTime % this.config.duration) / this.config.duration;
      this.currentValue = normalizedTime;
    }

    getValue() {
      return this.currentValue;
    }

    reset() {
      this.elapsedTime = 0;
      this.currentValue = 0;
    }

    stop() {
      this.isPlaying = false;
    }

    resume() {
      this.isPlaying = true;
    }
  }

  /**
   * Scale animation (pulse effect)
   */
  function computeScaleAnimation(animState, minScale, maxScale, easing = 'sine-wave') {
    if (!animState || !animState.config) return 1.0;

    const easingFn = EASING_FUNCTIONS[easing] || EASING_FUNCTIONS['linear'];
    const normalizedValue = easingFn(animState.getValue());
    return minScale + (maxScale - minScale) * normalizedValue;
  }

  /**
   * Opacity animation (glow effect)
   */
  function computeOpacityAnimation(animState, minOpacity, maxOpacity, easing = 'sine-wave') {
    if (!animState || !animState.config) return maxOpacity;

    const easingFn = EASING_FUNCTIONS[easing] || EASING_FUNCTIONS['linear'];
    const normalizedValue = easingFn(animState.getValue());
    return minOpacity + (maxOpacity - minOpacity) * normalizedValue;
  }

  /**
   * Rotation animation
   */
  function computeRotationAnimation(animState, minRotation, maxRotation, easing = 'linear') {
    if (!animState || !animState.config) return minRotation;

    const easingFn = EASING_FUNCTIONS[easing] || EASING_FUNCTIONS['linear'];
    const normalizedValue = easingFn(animState.getValue());
    return minRotation + (maxRotation - minRotation) * normalizedValue;
  }

  /**
   * Position offset animation (bounce effect)
   */
  function computePositionOffsetAnimation(animState, amplitude, easing = 'ease-out-bounce') {
    if (!animState || !animState.config) return 0;

    const easingFn = EASING_FUNCTIONS[easing] || EASING_FUNCTIONS['ease-out-bounce'];
    const normalizedValue = easingFn(animState.getValue());
    return amplitude * normalizedValue;
  }

  /**
   * Compute animation frame properties based on config
   */
  function getAnimationFrameProperties(animConfig, animState, baseScale = 1.0) {
    if (!animConfig || animConfig.type === 'none') {
      return {
        scale: baseScale,
        opacity: 1.0,
        rotation: 0,
        positionOffset: { x: 0, y: 0 },
      };
    }

    const properties = {
      scale: baseScale,
      opacity: 1.0,
      rotation: 0,
      positionOffset: { x: 0, y: 0 },
    };

    switch (animConfig.type) {
      case 'scale': {
        properties.scale = computeScaleAnimation(
          animState,
          animConfig.minScale || 0.95,
          animConfig.maxScale || 1.15,
          animConfig.easing
        );
        break;
      }
      case 'opacity': {
        properties.opacity = computeOpacityAnimation(
          animState,
          animConfig.minOpacity || 0.6,
          animConfig.maxOpacity || 1.0,
          animConfig.easing
        );
        break;
      }
      case 'rotation': {
        properties.rotation = computeRotationAnimation(
          animState,
          animConfig.minRotation || 0,
          animConfig.maxRotation || Math.PI * 2,
          animConfig.easing
        );
        break;
      }
      case 'position-y-offset': {
        const offset = computePositionOffsetAnimation(
          animState,
          animConfig.amplitude || 2,
          animConfig.easing
        );
        properties.positionOffset.y = offset;
        break;
      }
    }

    return properties;
  }

  /**
   * Animation manager for a single marker
   */
  class MarkerAnimationManager {
    constructor(markerKey, animationConfig) {
      this.markerKey = markerKey;
      this.animationConfig = animationConfig || {};
      this.animState = new MarkerAnimationState(animationConfig);
      this.frameProperties = {
        scale: 1.0,
        opacity: 1.0,
        rotation: 0,
        positionOffset: { x: 0, y: 0 },
      };
    }

    update(deltaSeconds) {
      if (!this.animationConfig || this.animationConfig.type === 'none') {
        return;
      }

      // Convert seconds to milliseconds for animation state
      this.animState.update(deltaSeconds * 1000);
      this.frameProperties = getAnimationFrameProperties(
        this.animationConfig,
        this.animState,
        1.0
      );
    }

    getFrameProperties() {
      return { ...this.frameProperties };
    }

    reset() {
      this.animState.reset();
    }

    stop() {
      this.animState.stop();
    }

    resume() {
      this.animState.resume();
    }
  }

  /**
   * Pool of animation managers for efficiency
   */
  class AnimationManagerPool {
    constructor(initialSize = 50) {
      this.pool = [];
      this.activeManagers = new Map();

      for (let i = 0; i < initialSize; i++) {
        this.pool.push(new MarkerAnimationManager(null, null));
      }
    }

    acquire(markerKey, animationConfig) {
      let manager = this.pool.pop();
      if (!manager) {
        manager = new MarkerAnimationManager(markerKey, animationConfig);
      } else {
        manager.markerKey = markerKey;
        manager.animationConfig = animationConfig || {};
        manager.animState = new MarkerAnimationState(animationConfig);
        manager.reset();
      }

      this.activeManagers.set(markerKey, manager);
      return manager;
    }

    release(markerKey) {
      const manager = this.activeManagers.get(markerKey);
      if (manager) {
        manager.reset();
        this.pool.push(manager);
        this.activeManagers.delete(markerKey);
      }
    }

    get(markerKey) {
      return this.activeManagers.get(markerKey);
    }

    updateAll(deltaSeconds) {
      for (const manager of this.activeManagers.values()) {
        manager.update(deltaSeconds);
      }
    }

    releaseAll() {
      for (const manager of this.activeManagers.values()) {
        manager.reset();
        this.pool.push(manager);
      }
      this.activeManagers.clear();
    }

    getStatistics() {
      return {
        activeCount: this.activeManagers.size,
        pooledCount: this.pool.length,
        totalCapacity: this.pool.length + this.activeManagers.size,
      };
    }
  }

  // Export for CommonJS environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      EASING_FUNCTIONS,
      MarkerAnimationState,
      MarkerAnimationManager,
      AnimationManagerPool,
      computeScaleAnimation,
      computeOpacityAnimation,
      computeRotationAnimation,
      computePositionOffsetAnimation,
      getAnimationFrameProperties,
    };
  } else {
    // Export for browser
    window.GQSelectionMarkerAnimationEngine = {
      EASING_FUNCTIONS,
      MarkerAnimationState,
      MarkerAnimationManager,
      AnimationManagerPool,
      computeScaleAnimation,
      computeOpacityAnimation,
      computeRotationAnimation,
      computePositionOffsetAnimation,
      getAnimationFrameProperties,
    };
  }
})();
