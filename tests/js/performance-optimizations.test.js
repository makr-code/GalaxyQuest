/**
 * tests/js/performance-optimizations.test.js
 *
 * Unit tests for Performance Optimization & WebWorker Integration systems.
 * Tests core functionality without requiring actual WebWorker execution.
 *
 * Run with: npm run test:unit:js -- performance-optimizations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import modules under test
const { ObjectPool, PoolManager } = require('../../js/engine/utils/ObjectPool.js');
const { WorkerMetrics } = require('../../js/telemetry/worker-metrics.js');
const { TextureCompressionManager } = require('../../js/rendering/TextureCompressionManager.js');
const { GeometryInstancingOptimizer } = require('../../js/rendering/GeometryInstancingOptimizer.js');
const { DynamicQualityScaler } = require('../../js/rendering/DynamicQualityScaler.js');
const { StreamingPrefetcher } = require('../../js/engine/utils/streaming-prefetch.js');

describe('Performance Optimizations', () => {
  describe('ObjectPool', () => {
    let pool;

    beforeEach(() => {
      pool = new ObjectPool({
        factory: () => ({ x: 0, y: 0, z: 0 }),
        reset: (obj) => { obj.x = 0; obj.y = 0; obj.z = 0; },
        initialSize: 5,
      });
    });

    it('should create pool with initial objects', () => {
      const status = pool.getStatus();
      expect(status.available).toBe(5);
      expect(status.inUse).toBe(0);
    });

    it('should acquire and release objects', () => {
      const obj1 = pool.acquire();
      expect(obj1).toBeDefined();
      expect(pool.getStatus().inUse).toBe(1);

      obj1.x = 10;
      pool.release(obj1);

      expect(pool.getStatus().inUse).toBe(0);
      expect(obj1.x).toBe(0); // Should be reset
    });

    it('should allocate new objects when pool exhausted', () => {
      const objs = [];
      for (let i = 0; i < 10; i++) {
        objs.push(pool.acquire());
      }
      expect(pool.getStatus().inUse).toBe(10);
      expect(pool.getMetrics().totalCreated).toBeGreaterThan(5);
    });

    it('should handle multiple acquisitions', () => {
      const objs = pool.acquireMultiple(3);
      expect(objs.length).toBe(3);
      expect(pool.getStatus().inUse).toBe(3);

      pool.releaseMultiple(objs);
      expect(pool.getStatus().inUse).toBe(0);
    });
  });

  describe('PoolManager', () => {
    let manager;

    beforeEach(() => {
      manager = new PoolManager();
    });

    it('should create and manage multiple pools', () => {
      manager.createPool('vec3', {
        factory: () => ({ x: 0, y: 0, z: 0 }),
      });
      manager.createPool('quat', {
        factory: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      });

      expect(manager.listPools().length).toBe(2);
      expect(manager.getPool('vec3')).toBeDefined();
      expect(manager.getPool('quat')).toBeDefined();
    });

    it('should get status for all pools', () => {
      manager.createPool('p1', { factory: () => ({}) });
      manager.createPool('p2', { factory: () => ({}) });

      const status = manager.getAllStatus();
      expect(status.p1).toBeDefined();
      expect(status.p2).toBeDefined();
    });

    it('should remove pools', () => {
      manager.createPool('temp', { factory: () => ({}) });
      expect(manager.getPool('temp')).toBeDefined();

      manager.removePool('temp');
      expect(manager.getPool('temp')).toBeNull();
    });
  });

  describe('WorkerMetrics', () => {
    let metrics;

    beforeEach(() => {
      metrics = new WorkerMetrics();
    });

    it('should track task lifecycle', () => {
      metrics.recordTaskStart('computeLOD', 1);
      expect(metrics._activeTasks.has(1)).toBe(true);

      metrics.recordTaskComplete('computeLOD', 1, 12.5);
      expect(metrics._activeTasks.has(1)).toBe(false);

      const m = metrics.getTaskMetrics('computeLOD');
      expect(m.count).toBe(1);
      expect(m.avgMs).toBe(12.5);
    });

    it('should calculate percentiles', () => {
      metrics.recordTaskStart('task', 1);
      metrics.recordTaskComplete('task', 1, 10);

      for (let i = 2; i <= 100; i++) {
        metrics.recordTaskStart('task', i);
        metrics.recordTaskComplete('task', i, 10 + i);
      }

      const m = metrics.getTaskMetrics('task');
      expect(m.count).toBe(100);
      expect(m.p50Ms).toBeGreaterThan(0);
      expect(m.p95Ms).toBeGreaterThan(m.p50Ms);
      expect(m.p99Ms).toBeGreaterThan(m.p95Ms);
    });

    it('should track errors', () => {
      metrics.recordTaskStart('task', 1);
      metrics.recordTaskError('task', 1);

      const m = metrics.getTaskMetrics('task');
      expect(m.failureCount).toBe(1);
      expect(m.successCount).toBe(0);
    });

    it('should generate report', () => {
      metrics.recordTaskStart('task1', 1);
      metrics.recordTaskComplete('task1', 1, 15);

      const report = metrics.report();
      expect(report).toContain('Worker Metrics Report');
      expect(report).toContain('task1');
    });
  });

  describe('TextureCompressionManager', () => {
    let manager;

    beforeEach(() => {
      manager = new TextureCompressionManager();
    });

    it('should detect supported formats', () => {
      const formats = manager.getSupportedFormats();
      expect(Array.isArray(formats)).toBe(true);
    });

    it('should estimate compressed size', () => {
      const original = 100; // MB
      const astcSize = manager.estimateCompressedSize(original, 'astc');
      const bc7Size = manager.estimateCompressedSize(original, 'bc7');

      expect(astcSize).toBeLessThan(original);
      expect(bc7Size).toBeLessThan(original);
      expect(astcSize).toBeLessThan(bc7Size); // ASTC better compression
    });

    it('should get best format', () => {
      const best = manager.getBestFormat();
      expect(best === null || typeof best === 'string').toBe(true);
    });

    it('should generate report', () => {
      const report = manager.report();
      expect(report).toContain('TextureCompressionManager');
      expect(report).toContain('Supported Formats');
    });
  });

  describe('GeometryInstancingOptimizer', () => {
    let optimizer;

    beforeEach(() => {
      optimizer = new GeometryInstancingOptimizer({
        minInstanceCount: 2,
      });
    });

    it('should analyze instancing candidates', () => {
      const mockGeometry = { attributes: { position: { count: 100 } }, index: { count: 150 } };
      const mesh1 = { geometry: mockGeometry };
      const mesh2 = { geometry: mockGeometry };
      const mesh3 = { geometry: { attributes: { position: { count: 50 } } } };

      const { candidates, independent } = optimizer.analyzeInstancingCandidates([mesh1, mesh2, mesh3]);
      expect(candidates.size).toBeGreaterThan(0);
    });

    it('should handle null geometries', () => {
      const mesh1 = { geometry: null };
      const mesh2 = {};

      const { candidates, independent } = optimizer.analyzeInstancingCandidates([mesh1, mesh2]);
      expect(independent.length).toBe(2);
    });

    it('should generate report', () => {
      const report = optimizer.report();
      expect(report).toContain('GeometryInstancingOptimizer');
    });
  });

  describe('DynamicQualityScaler', () => {
    let scaler;

    beforeEach(() => {
      scaler = new DynamicQualityScaler({
        targetFps: 60,
        adjustInterval: 100, // Fast adjustment for testing
      });
    });

    it('should start at max quality level', () => {
      expect(scaler.getQualityLevel()).toBe(4);
      expect(scaler.getQualityLevelName()).toBe('Ultra');
    });

    it('should provide quality settings', () => {
      const settings = scaler.getQualitySettings();
      expect(settings.label).toBe('Ultra');
      expect(settings.resolutionScale).toBe(1.5);
      expect(settings.postProcessing).toBe(true);
    });

    it('should track frame times', () => {
      scaler.update(16.67);
      scaler.update(16.5);
      scaler.update(17.0);

      const avg = scaler.getAverageFrameTime();
      expect(avg).toBeGreaterThan(16);
      expect(avg).toBeLessThan(18);
    });

    it('should calculate percentiles', () => {
      for (let i = 0; i < 50; i++) {
        scaler.update(16.67 + Math.random() * 5);
      }

      const pct = scaler.getFrameTimePercentiles();
      expect(pct.p50).toBeGreaterThan(0);
      expect(pct.p95).toBeGreaterThanOrEqual(pct.p50);
      expect(pct.p99).toBeGreaterThanOrEqual(pct.p95);
    });

    it('should allow forcing quality level', () => {
      scaler.forceQualityLevel(2);
      expect(scaler.getQualityLevel()).toBe(2);
      expect(scaler.getQualityLevelName()).toBe('Medium');
    });

    it('should generate report', () => {
      scaler.update(20); // Over threshold
      const report = scaler.report();
      expect(report).toContain('DynamicQualityScaler');
      expect(report).toContain('Quality Level');
    });

    it('should clamp quality levels', () => {
      scaler.forceQualityLevel(-1);
      expect(scaler.getQualityLevel()).toBe(0);

      scaler.forceQualityLevel(10);
      expect(scaler.getQualityLevel()).toBe(4);
    });
  });

  describe('StreamingPrefetcher', () => {
    let prefetcher;
    let mockWorkerManager;

    beforeEach(() => {
      mockWorkerManager = {
        executeTask: vi.fn().mockResolvedValue({}),
      };

      prefetcher = new StreamingPrefetcher({
        workerManager: mockWorkerManager,
        chunkSize: 100,
        lookaheadDistance: 200,
      });
    });

    it('should require workerManager', () => {
      expect(() => new StreamingPrefetcher({})).toThrow();
    });

    it('should update viewport', () => {
      prefetcher.updateViewport({ x: 10, y: 20, z: 30 });
      expect(prefetcher._currentViewport.x).toBe(10);
    });

    it('should track loaded chunks', async () => {
      prefetcher.updateViewport({ x: 0, y: 0, z: 0 });
      expect(prefetcher.getLoadedChunkCount()).toBe(0);
    });

    it('should generate report', () => {
      const report = prefetcher.report();
      expect(report).toContain('StreamingPrefetcher');
    });
  });

  describe('Integration Tests', () => {
    it('should work together without conflicts', () => {
      // Create all systems
      const pool = new ObjectPool({ factory: () => ({}) });
      const metrics = new WorkerMetrics();
      const compression = new TextureCompressionManager();
      const instancer = new GeometryInstancingOptimizer();
      const scaler = new DynamicQualityScaler();

      // Use simultaneously
      const obj = pool.acquire();
      metrics.recordTaskStart('test', 1);
      const formats = compression.getSupportedFormats();
      const settings = scaler.getQualitySettings();

      // Cleanup
      pool.release(obj);
      metrics.recordTaskComplete('test', 1, 10);

      expect(obj).toBeDefined();
      expect(formats).toBeInstanceOf(Array);
      expect(settings).toBeInstanceOf(Object);
    });
  });
});
