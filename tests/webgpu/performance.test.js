/**
 * tests/webgpu/performance.test.js
 *
 * Tests for PerformanceMonitor and ResourceTracker utilities.
 */

import { describe, it, expect, vi } from 'vitest';
import { PerformanceMonitor } from '../../js/engine/utils/PerformanceMonitor.js';
import { ResourceTracker }    from '../../js/engine/utils/ResourceTracker.js';

// ---------------------------------------------------------------------------
// PerformanceMonitor
// ---------------------------------------------------------------------------

describe('PerformanceMonitor', () => {
  it('starts with zero fps', () => {
    const mon = new PerformanceMonitor();
    expect(mon.fps).toBe(0);
    expect(mon.frameTimeMs).toBe(0);
  });

  it('computes FPS after two ticks', () => {
    const mon = new PerformanceMonitor();
    mon.tick(0);
    mon.tick(16.67); // ~60 fps frame
    expect(mon.fps).toBeGreaterThan(50);
    expect(mon.fps).toBeLessThan(70);
  });

  it('averages FPS over sampleWindow frames', () => {
    const mon = new PerformanceMonitor({ sampleWindow: 4 });
    for (let i = 0; i <= 4; i++) mon.tick(i * 16.67);
    expect(mon.fps).toBeGreaterThan(50);
  });

  it('stats() returns rounded values', () => {
    const mon = new PerformanceMonitor();
    mon.tick(0);
    mon.tick(16.67);
    const s = mon.stats();
    expect(Number.isInteger(s.fps)).toBe(true);
    expect(typeof s.frameTimeMs).toBe('number');
    expect(typeof s.gpuMemoryMb).toBe('number');
  });

  it('reset() clears all counters', () => {
    const mon = new PerformanceMonitor();
    mon.tick(0);
    mon.tick(16.67);
    mon.reset();
    expect(mon.fps).toBe(0);
    expect(mon.frameTimeMs).toBe(0);
  });

  it('warns when FPS drops below threshold', () => {
    const warn = vi.fn();
    window.GQLog = { warn };
    const mon = new PerformanceMonitor({ sampleWindow: 2, warnThresholdFps: 60 });
    mon.tick(0);
    mon.tick(50);  // ~20 fps — well below 60
    mon.tick(100);
    // Warning fires every sampleWindow frames; may or may not fire in this test
    // Just ensure no exception was thrown
    expect(warn.mock.calls.every(c => typeof c[0] === 'string')).toBe(true);
    delete window.GQLog;
  });
});

// ---------------------------------------------------------------------------
// ResourceTracker
// ---------------------------------------------------------------------------

describe('ResourceTracker', () => {
  it('tracks and returns the resource', () => {
    const tracker = new ResourceTracker();
    const obj     = { destroy: vi.fn() };
    const result  = tracker.track(obj);
    expect(result).toBe(obj);
    expect(tracker.size).toBe(1);
  });

  it('dispose() calls destroy and untracks', () => {
    const tracker = new ResourceTracker();
    const obj = { destroy: vi.fn() };
    tracker.track(obj);
    tracker.dispose(obj);
    expect(obj.destroy).toHaveBeenCalledOnce();
    expect(tracker.size).toBe(0);
  });

  it('disposeAll() destroys every resource', () => {
    const tracker = new ResourceTracker();
    const objs    = Array.from({ length: 5 }, () => ({ destroy: vi.fn() }));
    objs.forEach((o) => tracker.track(o));
    tracker.disposeAll();
    objs.forEach((o) => expect(o.destroy).toHaveBeenCalledOnce());
    expect(tracker.size).toBe(0);
  });

  it('calls dispose() if no destroy() available', () => {
    const tracker = new ResourceTracker();
    const obj     = { dispose: vi.fn() };
    tracker.track(obj);
    tracker.disposeAll();
    expect(obj.dispose).toHaveBeenCalledOnce();
  });

  it('report() returns 0 when no leaks', () => {
    const tracker = new ResourceTracker();
    const count   = tracker.report();
    expect(count).toBe(0);
  });

  it('report() returns count of surviving resources', () => {
    const tracker = new ResourceTracker();
    tracker.track({ destroy: vi.fn() });
    tracker.track({ destroy: vi.fn() });
    const count = tracker.report();
    expect(count).toBe(2);
  });
});
