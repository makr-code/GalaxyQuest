import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

function load(file) {
  // eslint-disable-next-line no-eval
  window.eval(fs.readFileSync(file, 'utf8'));
}

beforeEach(() => {
  load('js/telemetry/performance-budget.js');
  load('js/engine/utils/WebGPUProfiler.js');
});

describe('honest rolling render budgets', () => {
  it('keeps unknown durations and memory null, exposing Three memory counts separately', () => {
    const monitor = window.GQPerformanceBudget.createMonitor({
      info: { memory: { geometries: 100, textures: 200 } },
    });
    expect(monitor.getStatus().summary).toBe('UNKNOWN');
    monitor.update({ timestampMs: 0 });
    expect(monitor.getMetrics()).toMatchObject({
      fps: null, frameTimeAvgMs: null, cpuSubmissionAvgMs: null, gpuTimeAvgMs: null,
      memoryAvgMB: null, memoryMaxMB: null, geometryCount: 100, textureCount: 200,
    });
  });

  it('measures frame intervals independently of the telemetry storage interval', () => {
    const monitor = window.GQPerformanceBudget.createMonitor(null, { sampleIntervalMs: 100 });
    for (let timestampMs = 0; timestampMs <= 200; timestampMs += 10) monitor.update({ timestampMs });
    expect(monitor.getMetrics()).toMatchObject({ fps: 100, frameTimeAvgMs: 10, sampleCount: 3 });
  });

  it('uses rolling min/max, separate CPU/GPU samples, scopes and configurable budgets', () => {
    const monitor = window.GQPerformanceBudget.createMonitor(null, {
      windowSize: 2, scope: 'test-pass', thresholds: { gpuTimeMaxMs: 1 },
    });
    monitor.update({ timestampMs: 0, cpuSubmissionMs: 100, gpuMs: 100 });
    monitor.update({ timestampMs: 10, cpuSubmissionMs: 2, gpuMs: null });
    monitor.update({ timestampMs: 20, cpuSubmissionMs: 4, gpuMs: 2, memoryBytes: 1048576 });
    expect(monitor.getMetrics()).toMatchObject({
      scope: 'test-pass', cpuSubmissionAvgMs: 3, cpuSubmissionMaxMs: 4,
      gpuTimeAvgMs: 2, gpuTimeMaxMs: 2, frameTimeMaxMs: 10, memoryMaxMB: 1,
    });
    expect(monitor.getStatus().violations).toEqual(['gpuTimeAvgMs']);
    monitor.reset();
    expect(monitor.getMetrics().gpuTimeAvgMs).toBeNull();
  });

  it('deduplicates continuing violations and bounds regression history', () => {
    const monitor = window.GQPerformanceBudget.createMonitor(null, { windowSize: 1 });
    for (let i = 0; i < 10; i++) monitor.update({ timestampMs: i, drawCalls: 9000 });
    expect(monitor.getRegressions()).toHaveLength(1);
    for (let i = 10; i < 250; i++) monitor.update({ timestampMs: i, drawCalls: i % 2 ? 9000 : 1 });
    expect(monitor.getRegressions()).toHaveLength(100);
  });

  it('gates measured owned buffers separately from unknown total VRAM', () => {
    const monitor = window.GQPerformanceBudget.createMonitor(null, {
      thresholds: { ownedBufferMaxBytes: 1024 },
    });
    monitor.update({ ownedBufferBytes: 2048 });
    expect(monitor.getMetrics().memoryMaxMB).toBeNull();
    expect(monitor.getStatus().violations).toEqual(['ownedBufferBytes']);
  });
});

describe('standard pass GPU timestamp profiler', () => {
  function device(enabled = true) {
    const buffers = [];
    return {
      features: new Set(enabled ? ['timestamp-query'] : []),
      buffers,
      createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
      createBuffer: vi.fn(() => {
        const buffer = {
          destroy: vi.fn(), unmap: vi.fn(), mapAsync: vi.fn(async () => {}),
          getMappedRange: () => new BigUint64Array([1000000n, 3500000n]).buffer,
        };
        buffers.push(buffer);
        return buffer;
      }),
    };
  }

  it('does not trust adapter capabilities or substitute CPU time for unavailable GPU time', async () => {
    const gpu = device(false);
    const profiler = new window.GQWebGPUProfiler.WebGPUProfiler(gpu, { timestampQuery: true });
    expect(profiler.begin('render')).toBeNull();
    expect(await profiler.end('render')).toBeNull();
    expect(profiler.report()).toEqual({});
    expect(gpu.createQuerySet).not.toHaveBeenCalled();
  });

  it('returns timestampWrites, resolves before submission, reads only when end is called', async () => {
    const gpu = device();
    const profiler = new window.GQWebGPUProfiler.WebGPUProfiler(gpu);
    const writes = profiler.begin('render');
    expect(writes).toMatchObject({ beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    expect(profiler.begin('other')).toBeNull();
    const encoder = { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() };
    profiler.resolve('render', encoder);
    expect(encoder.resolveQuerySet).toHaveBeenCalledOnce();
    expect(gpu.buffers[1].mapAsync).not.toHaveBeenCalled();
    expect(await profiler.end('render')).toBe(2.5);
    expect(profiler.report().render).toMatchObject({ avgMs: 2.5, samples: 1 });
    gpu.buffers.forEach(buffer => expect(buffer.destroy).toHaveBeenCalledOnce());
  });

  it('cleans up after readback failure without failing the render loop', async () => {
    const gpu = device();
    const profiler = new window.GQWebGPUProfiler.WebGPUProfiler(gpu);
    profiler.begin('render');
    profiler.resolve('render', { resolveQuerySet() {}, copyBufferToBuffer() {} });
    gpu.buffers[1].mapAsync.mockRejectedValue(new Error('device lost'));
    expect(await profiler.end('render')).toBeNull();
    expect(profiler.report()).toEqual({});
    gpu.buffers.forEach(buffer => expect(buffer.destroy).toHaveBeenCalledOnce());
    expect(profiler.begin('next')).toBeNull();
  });

  it('disposes an in-flight readback once and discards late results', async () => {
    const gpu = device();
    const profiler = new window.GQWebGPUProfiler.WebGPUProfiler(gpu);
    profiler.begin('render');
    profiler.resolve('render', { resolveQuerySet() {}, copyBufferToBuffer() {} });
    let finish;
    gpu.buffers[1].mapAsync.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = profiler.end('render');
    profiler.dispose();
    finish();
    expect(await result).toBeNull();
    gpu.buffers.forEach(buffer => expect(buffer.destroy).toHaveBeenCalledOnce());
    expect(profiler.report()).toEqual({});
  });
});
