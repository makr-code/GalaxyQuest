/**
 * Canvas Animation Engine
 *
 * Core animation framework for canvas-based 2D overlays in GalaxyQuest.
 * Provides timing, easing, interpolation, and animation composition primitives.
 *
 * Usage:
 *   const controller = new CanvasAnimationController();
 *   const tween = new PropertyTween({
 *     id: 'fade-in',
 *     target: { opacity: 0 },
 *     to: { opacity: 1 },
 *     duration: 500,
 *     easing: 'easeInOutCubic'
 *   });
 *   controller.addAnimation(tween);
 *   // Call controller.update(deltaMs) in render loop
 */

(function () {
  'use strict';

  // ── Easing Functions ───────────────────────────────────────────────────────

  const EASING_FUNCTIONS = {
    linear: (t) => t,

    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => t * (2 - t),
    easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => (--t) * t * t + 1,
    easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * (t - 2)) * (2 * (t - 2)) + 1,

    easeInQuart: (t) => t * t * t * t,
    easeOutQuart: (t) => 1 - (--t) * t * t * t,
    easeInOutQuart: (t) => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,

    easeInQuint: (t) => t * t * t * t * t,
    easeOutQuint: (t) => 1 + (--t) * t * t * t * t,
    easeInOutQuint: (t) => t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t,

    easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

    easeInExpo: (t) => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
    easeOutExpo: (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    easeInOutExpo: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,

    easeInCirc: (t) => 1 - Math.sqrt(1 - Math.pow(t, 2)),
    easeOutCirc: (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
    easeInOutCirc: (t) => t < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,

    easeInElastic: (t) => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
    },
    easeOutElastic: (t) => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    easeInOutElastic: (t) => {
      const c5 = (2 * Math.PI) / 4.5;
      return t === 0 ? 0 : t === 1 ? 1 : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
    },

    easeInBounce: (t) => 1 - EASING_FUNCTIONS.easeOutBounce(1 - t),
    easeOutBounce: (t) => {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    easeInOutBounce: (t) => t < 0.5
      ? (1 - EASING_FUNCTIONS.easeOutBounce(1 - 2 * t)) / 2
      : (1 + EASING_FUNCTIONS.easeOutBounce(2 * t - 1)) / 2,

    easeInBack: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return c3 * t * t * t - c1 * t * t;
    },
    easeOutBack: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    easeInOutBack: (t) => {
      const c1 = 1.70158;
      const c2 = c1 * 1.525;
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    },
  };

  function getEasing(name) {
    if (typeof name === 'function') return name;
    const easing = EASING_FUNCTIONS[String(name || '').trim()];
    return (typeof easing === 'function') ? easing : EASING_FUNCTIONS.linear;
  }

  // ── Base Animation Class ───────────────────────────────────────────────────

  class Animation {
    constructor(opts) {
      this.id = String(opts?.id || `anim-${Date.now()}-${Math.random()}`);
      this.duration = Math.max(0, Number(opts?.duration || 0));
      this.easing = getEasing(opts?.easing);
      this.startTime = null;
      this.pausedTime = 0;
      this.paused = false;
      this.completed = false;
      this._completeCallback = null;
      this._updateCallback = null;
    }

    onComplete(callback) {
      this._completeCallback = (typeof callback === 'function') ? callback : null;
      return this;
    }

    onUpdate(callback) {
      this._updateCallback = (typeof callback === 'function') ? callback : null;
      return this;
    }

    start() {
      if (this.startTime === null && !this.paused) {
        this.startTime = Date.now();
      }
      this.paused = false;
      return this;
    }

    pause() {
      this.paused = true;
      return this;
    }

    resume() {
      if (this.paused && this.startTime !== null) {
        this.pausedTime += Date.now() - this.pauseStartTime;
      }
      this.paused = false;
      return this;
    }

    update() {
      if (this.completed || this.paused || this.startTime === null) {
        return this.getProgress();
      }

      const elapsed = Date.now() - this.startTime - this.pausedTime;
      const progress = this.duration === 0 ? 1 : Math.min(1, elapsed / this.duration);

      if (typeof this._updateCallback === 'function') {
        this._updateCallback(progress, elapsed);
      }

      if (progress >= 1) {
        this.completed = true;
        if (typeof this._completeCallback === 'function') {
          this._completeCallback();
        }
      }

      return progress;
    }

    getProgress() {
      if (this.completed) return 1;
      if (this.startTime === null) return 0;
      const elapsed = Date.now() - this.startTime - this.pausedTime;
      return this.duration === 0 ? 1 : Math.min(1, elapsed / this.duration);
    }

    getEasedProgress() {
      return this.easing(this.getProgress());
    }

    reset() {
      this.startTime = null;
      this.pausedTime = 0;
      this.paused = false;
      this.completed = false;
      return this;
    }

    destroy() {
      this._completeCallback = null;
      this._updateCallback = null;
    }
  }

  // ── PropertyTween ─────────────────────────────────────────────────────────

  class PropertyTween extends Animation {
    constructor(opts) {
      super(opts);
      this.target = opts?.target || {};
      this.from = opts?.from ? Object.assign({}, opts.from) : Object.assign({}, this.target);
      this.to = opts?.to || {};
      this._snapToInteger = opts?.snapToInteger !== false;
      this.start();
    }

    update() {
      const progress = super.update();
      const eased = this.easing(progress);

      for (const key in this.to) {
        if (!this.to.hasOwnProperty(key)) continue;
        const fromVal = Number(this.from[key] ?? 0);
        const toVal = Number(this.to[key] ?? 0);
        const delta = toVal - fromVal;
        const value = fromVal + delta * eased;
        this.target[key] = this._snapToInteger ? Math.round(value) : value;
      }

      return progress;
    }
  }

  // ── SequenceAnimation ──────────────────────────────────────────────────────

  class SequenceAnimation extends Animation {
    constructor(opts) {
      super(opts);
      this.animations = Array.isArray(opts?.animations) ? opts.animations.slice() : [];
      this.currentIndex = 0;
      this.delayMs = Math.max(0, Number(opts?.delayMs || 0));
      this.delayStart = null;

      // Compute total duration
      let total = 0;
      for (const anim of this.animations) {
        total += (Number(anim.duration || 0) + Number(anim.delayMs || 0));
      }
      this.duration = total;
      this.start();
    }

    update() {
      if (this.completed || this.paused) return this.getProgress();

      // Handle initial delay
      if (this.delayStart === null) {
        this.delayStart = Date.now();
      }
      const delayElapsed = Date.now() - this.delayStart - this.pausedTime;
      if (delayElapsed < this.delayMs) {
        return 0;
      }

      if (this.startTime === null) {
        this.startTime = Date.now() - (delayElapsed - this.delayMs);
      }

      // Update current animation
      let accumulatedTime = 0;
      for (let i = 0; i < this.animations.length; i++) {
        const anim = this.animations[i];
        const animDelay = Math.max(0, Number(anim.delayMs || 0));
        const animDuration = Number(anim.duration || 0);
        const animTotal = animDelay + animDuration;

        const elapsed = delayElapsed - this.delayMs;

        if (elapsed < accumulatedTime) break;
        if (elapsed >= accumulatedTime + animTotal) {
          if (!anim.completed) {
            anim.update();
          }
          accumulatedTime += animTotal;
          continue;
        }

        // This is the active animation
        this.currentIndex = i;
        const relativeElapsed = elapsed - accumulatedTime - animDelay;
        if (relativeElapsed > 0) {
          anim.update();
        }
        accumulatedTime += animTotal;
        break;
      }

      const progress = this.duration === 0 ? 1 : Math.min(1, delayElapsed / (this.delayMs + this.duration));
      if (progress >= 1) {
        this.completed = true;
        if (typeof this._completeCallback === 'function') {
          this._completeCallback();
        }
      }

      return progress;
    }

    destroy() {
      super.destroy();
      for (const anim of this.animations) {
        if (typeof anim.destroy === 'function') {
          anim.destroy();
        }
      }
    }
  }

  // ── ParallelAnimation ──────────────────────────────────────────────────────

  class ParallelAnimation extends Animation {
    constructor(opts) {
      super(opts);
      this.animations = Array.isArray(opts?.animations) ? opts.animations.slice() : [];

      // Compute max duration
      let maxDuration = 0;
      for (const anim of this.animations) {
        maxDuration = Math.max(maxDuration, Number(anim.duration || 0));
      }
      this.duration = maxDuration;
      this.start();
    }

    update() {
      if (this.completed || this.paused) return this.getProgress();

      if (this.startTime === null) {
        this.startTime = Date.now();
      }

      const elapsed = Date.now() - this.startTime - this.pausedTime;
      const progress = this.duration === 0 ? 1 : Math.min(1, elapsed / this.duration);

      // Update all animations in parallel
      for (const anim of this.animations) {
        if (!anim.completed) {
          anim.update();
        }
      }

      if (typeof this._updateCallback === 'function') {
        this._updateCallback(progress, elapsed);
      }

      if (progress >= 1) {
        this.completed = true;
        if (typeof this._completeCallback === 'function') {
          this._completeCallback();
        }
      }

      return progress;
    }

    destroy() {
      super.destroy();
      for (const anim of this.animations) {
        if (typeof anim.destroy === 'function') {
          anim.destroy();
        }
      }
    }
  }

  // ── LoopAnimation ──────────────────────────────────────────────────────────

  class LoopAnimation extends Animation {
    constructor(opts) {
      super(opts);
      this.animation = opts?.animation || new Animation();
      this.iterations = Math.max(1, Number(opts?.iterations || Infinity));
      this.currentIteration = 0;
      this.reverse = opts?.reverse === true;
      this.reversing = false;

      this.duration = this.iterations === Infinity ? Infinity : (this.animation.duration * this.iterations);
      this.start();
    }

    update() {
      if (this.paused) return this.getProgress();

      if (this.startTime === null) {
        this.startTime = Date.now();
      }

      const elapsed = Date.now() - this.startTime - this.pausedTime;

      if (this.animation.duration === 0) {
        if (!this.completed && this.iterations !== Infinity) {
          this.completed = true;
          if (typeof this._completeCallback === 'function') {
            this._completeCallback();
          }
        }
        return 1;
      }

      const cycleTime = elapsed % (this.animation.duration * (this.reverse ? 2 : 1));
      let progress = cycleTime / this.animation.duration;

      if (this.reverse && progress > 1) {
        progress = 2 - progress;
        this.reversing = true;
      } else {
        this.reversing = false;
      }

      this.currentIteration = Math.floor(elapsed / (this.animation.duration * (this.reverse ? 2 : 1)));

      this.animation.update();

      if (typeof this._updateCallback === 'function') {
        this._updateCallback(progress, elapsed);
      }

      if (this.iterations !== Infinity && this.currentIteration >= this.iterations) {
        this.completed = true;
        if (typeof this._completeCallback === 'function') {
          this._completeCallback();
        }
      }

      return Math.min(1, this.iterations === Infinity ? progress : (elapsed / (this.animation.duration * this.iterations)));
    }

    destroy() {
      super.destroy();
      if (typeof this.animation.destroy === 'function') {
        this.animation.destroy();
      }
    }
  }

  // ── CanvasAnimationController ──────────────────────────────────────────────

  class CanvasAnimationController {
    constructor() {
      this.animations = new Map();
      this.lastUpdateTime = Date.now();
    }

    addAnimation(animation) {
      if (!animation || !animation.id) return false;
      this.animations.set(animation.id, animation);
      if (typeof animation.start === 'function') {
        animation.start();
      }
      return true;
    }

    removeAnimation(id) {
      const animation = this.animations.get(id);
      if (animation && typeof animation.destroy === 'function') {
        animation.destroy();
      }
      return this.animations.delete(id);
    }

    getAnimation(id) {
      return this.animations.get(id) || null;
    }

    update(deltaMs) {
      const now = Date.now();
      const delta = deltaMs ?? (now - this.lastUpdateTime);
      this.lastUpdateTime = now;

      const completed = [];
      for (const [id, animation] of this.animations) {
        if (animation.completed) {
          completed.push(id);
        } else {
          animation.update();
          if (animation.completed) {
            completed.push(id);
          }
        }
      }

      // Remove completed animations
      for (const id of completed) {
        this.removeAnimation(id);
      }

      return completed.length;
    }

    pauseAll() {
      for (const animation of this.animations.values()) {
        if (typeof animation.pause === 'function') {
          animation.pause();
        }
      }
    }

    resumeAll() {
      for (const animation of this.animations.values()) {
        if (typeof animation.resume === 'function') {
          animation.resume();
        }
      }
    }

    clear() {
      for (const [id] of this.animations) {
        this.removeAnimation(id);
      }
      this.animations.clear();
    }

    size() {
      return this.animations.size;
    }

    destroy() {
      this.clear();
      this.animations = null;
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.CanvasAnimationEngine = window.CanvasAnimationEngine || {};
    Object.assign(window.CanvasAnimationEngine, {
      CanvasAnimationController,
      Animation,
      PropertyTween,
      SequenceAnimation,
      ParallelAnimation,
      LoopAnimation,
      EASING_FUNCTIONS,
      getEasing,
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CanvasAnimationController,
      Animation,
      PropertyTween,
      SequenceAnimation,
      ParallelAnimation,
      LoopAnimation,
      EASING_FUNCTIONS,
      getEasing,
    };
  }
})();
