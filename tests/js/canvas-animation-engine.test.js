/**
 * Animation Framework Tests
 *
 * Unit tests for canvas animation engine, easing functions, and animation composition.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CanvasAnimationController,
  Animation,
  PropertyTween,
  SequenceAnimation,
  ParallelAnimation,
  LoopAnimation,
  EASING_FUNCTIONS,
  getEasing,
} from '../js/rendering/canvas-animation-engine.js';

describe('Easing Functions', () => {
  it('should have linear easing that returns input', () => {
    const easing = EASING_FUNCTIONS.linear;
    expect(easing(0)).toBe(0);
    expect(easing(0.5)).toBe(0.5);
    expect(easing(1)).toBe(1);
  });

  it('should have easeInQuad that accelerates', () => {
    const easing = EASING_FUNCTIONS.easeInQuad;
    expect(easing(0)).toBe(0);
    expect(easing(0.5) < 0.5).toBe(true); // Slower at start
    expect(easing(1)).toBe(1);
  });

  it('should have easeOutQuad that decelerates', () => {
    const easing = EASING_FUNCTIONS.easeOutQuad;
    expect(easing(0)).toBe(0);
    expect(easing(0.5) > 0.5).toBe(true); // Faster at start
    expect(easing(1)).toBe(1);
  });

  it('should return linear easing for unknown names', () => {
    const easing = getEasing('unknown-easing-name');
    expect(easing(0.5)).toBe(0.5);
  });

  it('should accept functions as easing', () => {
    const customEasing = (t) => t * t;
    const easing = getEasing(customEasing);
    expect(easing(0.5)).toBe(0.25);
  });
});

describe('Animation Base Class', () => {
  it('should initialize with default values', () => {
    const anim = new Animation({ duration: 1000 });
    expect(anim.duration).toBe(1000);
    expect(anim.completed).toBe(false);
    expect(anim.getProgress()).toBe(0);
  });

  it('should start animation and track progress', (done) => {
    vi.useFakeTimers();
    const anim = new Animation({ duration: 1000 });
    
    expect(anim.getProgress()).toBe(0);
    
    anim.start();
    vi.advanceTimersByTime(500);
    
    expect(anim.getProgress()).toBeCloseTo(0.5, 1);
    
    vi.advanceTimersByTime(500);
    expect(anim.completed).toBe(true);
    expect(anim.getProgress()).toBe(1);
    
    vi.useRealTimers();
    done();
  });

  it('should support pause/resume', (done) => {
    vi.useFakeTimers();
    const anim = new Animation({ duration: 1000 });
    
    anim.start();
    vi.advanceTimersByTime(300);
    anim.pause();
    
    const pausedProgress = anim.getProgress();
    vi.advanceTimersByTime(200); // This time should not affect paused animation
    
    expect(anim.getProgress()).toBe(pausedProgress);
    
    anim.resume();
    vi.advanceTimersByTime(200);
    expect(anim.getProgress()).toBeGreaterThan(pausedProgress);
    
    vi.useRealTimers();
    done();
  });

  it('should call onComplete callback when finished', (done) => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const anim = new Animation({ duration: 100 });
    
    anim.onComplete(callback);
    anim.start();
    
    expect(callback).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(100);
    anim.update();
    
    expect(callback).toHaveBeenCalled();
    
    vi.useRealTimers();
    done();
  });

  it('should apply easing function', (done) => {
    vi.useFakeTimers();
    const anim = new Animation({ duration: 1000, easing: 'easeInQuad' });
    
    anim.start();
    vi.advanceTimersByTime(500);
    
    const easedProgress = anim.getEasedProgress();
    const linearProgress = anim.getProgress();
    
    // With easeInQuad, eased progress should be less than linear at 0.5
    expect(easedProgress).toBeLessThan(linearProgress);
    
    vi.useRealTimers();
    done();
  });
});

describe('PropertyTween', () => {
  it('should interpolate object properties', (done) => {
    vi.useFakeTimers();
    const target = { opacity: 0 };
    const tween = new PropertyTween({
      target,
      from: { opacity: 0 },
      to: { opacity: 1 },
      duration: 1000,
    });

    expect(target.opacity).toBe(0);

    vi.advanceTimersByTime(500);
    tween.update();
    expect(target.opacity).toBeCloseTo(0.5, 1);

    vi.advanceTimersByTime(500);
    tween.update();
    expect(target.opacity).toBe(1);

    vi.useRealTimers();
    done();
  });

  it('should snap to integer when specified', (done) => {
    vi.useFakeTimers();
    const target = { value: 0 };
    const tween = new PropertyTween({
      target,
      to: { value: 10 },
      duration: 1000,
      snapToInteger: true,
    });

    vi.advanceTimersByTime(250);
    tween.update();
    expect(Number.isInteger(target.value)).toBe(true);

    vi.useRealTimers();
    done();
  });

  it('should interpolate multiple properties', (done) => {
    vi.useFakeTimers();
    const target = { x: 0, y: 0 };
    const tween = new PropertyTween({
      target,
      to: { x: 100, y: 50 },
      duration: 1000,
    });

    vi.advanceTimersByTime(500);
    tween.update();
    expect(target.x).toBeCloseTo(50, 1);
    expect(target.y).toBeCloseTo(25, 1);

    vi.useRealTimers();
    done();
  });
});

describe('SequenceAnimation', () => {
  it('should play animations in sequence', (done) => {
    vi.useFakeTimers();
    const target = { value: 0 };
    const tween1 = new PropertyTween({ target, to: { value: 50 }, duration: 100 });
    const tween2 = new PropertyTween({ target, to: { value: 100 }, duration: 100 });

    const sequence = new SequenceAnimation({
      animations: [tween1, tween2],
    });

    vi.advanceTimersByTime(50);
    sequence.update();
    expect(target.value).toBeCloseTo(25, 0); // First animation at 50%

    vi.advanceTimersByTime(100);
    sequence.update();
    expect(target.value).toBeCloseTo(75, 0); // Second animation at 50%

    vi.useRealTimers();
    done();
  });
});

describe('ParallelAnimation', () => {
  it('should play animations in parallel', (done) => {
    vi.useFakeTimers();
    const target1 = { value: 0 };
    const target2 = { value: 0 };
    const tween1 = new PropertyTween({ target: target1, to: { value: 100 }, duration: 1000 });
    const tween2 = new PropertyTween({ target: target2, to: { value: 50 }, duration: 1000 });

    const parallel = new ParallelAnimation({
      animations: [tween1, tween2],
    });

    vi.advanceTimersByTime(500);
    parallel.update();
    expect(target1.value).toBeCloseTo(50, 1);
    expect(target2.value).toBeCloseTo(25, 1);

    vi.useRealTimers();
    done();
  });
});

describe('LoopAnimation', () => {
  it('should loop animation specified number of iterations', (done) => {
    vi.useFakeTimers();
    const target = { value: 0 };
    const tween = new PropertyTween({ target, to: { value: 100 }, duration: 100 });
    const loop = new LoopAnimation({ animation: tween, iterations: 2 });

    vi.advanceTimersByTime(100);
    loop.update();
    expect(target.value).toBe(100); // First iteration complete

    vi.advanceTimersByTime(100);
    loop.update();
    expect(loop.completed).toBe(true); // Two iterations done

    vi.useRealTimers();
    done();
  });
});

describe('CanvasAnimationController', () => {
  it('should add and remove animations', () => {
    const controller = new CanvasAnimationController();
    const anim = new Animation({ id: 'test', duration: 100 });

    expect(controller.addAnimation(anim)).toBe(true);
    expect(controller.size()).toBe(1);
    expect(controller.getAnimation('test')).toBe(anim);

    expect(controller.removeAnimation('test')).toBe(true);
    expect(controller.size()).toBe(0);
  });

  it('should auto-remove completed animations on update', (done) => {
    vi.useFakeTimers();
    const controller = new CanvasAnimationController();
    const anim = new Animation({ id: 'test', duration: 50 });

    controller.addAnimation(anim);
    expect(controller.size()).toBe(1);

    vi.advanceTimersByTime(50);
    controller.update();

    expect(controller.size()).toBe(0);

    vi.useRealTimers();
    done();
  });

  it('should pause and resume all animations', (done) => {
    vi.useFakeTimers();
    const controller = new CanvasAnimationController();
    const anim1 = new Animation({ id: 'a1', duration: 1000 });
    const anim2 = new Animation({ id: 'a2', duration: 1000 });

    controller.addAnimation(anim1);
    controller.addAnimation(anim2);

    vi.advanceTimersByTime(300);
    controller.pauseAll();

    const p1 = anim1.getProgress();
    const p2 = anim2.getProgress();

    vi.advanceTimersByTime(100);
    expect(anim1.getProgress()).toBe(p1);
    expect(anim2.getProgress()).toBe(p2);

    controller.resumeAll();
    vi.advanceTimersByTime(100);
    expect(anim1.getProgress()).toBeGreaterThan(p1);

    vi.useRealTimers();
    done();
  });

  it('should clear all animations', () => {
    const controller = new CanvasAnimationController();
    controller.addAnimation(new Animation({ id: 'a1', duration: 100 }));
    controller.addAnimation(new Animation({ id: 'a2', duration: 100 }));

    expect(controller.size()).toBe(2);
    controller.clear();
    expect(controller.size()).toBe(0);
  });
});
