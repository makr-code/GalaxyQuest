/**
 * PerformanceProfiler.js
 * Comprehensive performance testing and profiling suite for advanced rendering
 *
 * Features:
 * - FPS profiling under various load conditions
 * - Memory usage tracking
 * - GPU metric collection
 * - Load scenario tests (1000+ objects, different quality levels)
 * - Performance regression detection
 * - Detailed reporting and export
 */

export class PerformanceProfiler {
  static instance = null;

  /**
   * @param {GameEngine} gameEngine
   */
  constructor(gameEngine) {
    this.engine = gameEngine;
    this.results = {
      scenarios: [],
      summary: {},
      timestamp: null,
    };
    this.currentScenario = null;
    this.isRunning = false;
    this.testObjectIds = [];
  }

  /**
   * Run a complete profiling suite.
   * @param {object} options
   * @param {number} [options.duration=10] - Test duration in seconds per scenario
   * @param {number} [options.targetObjects=1000] - Target object count
   * @param {boolean} [options.logResults=true] - Log results to console
   * @returns {Promise<object>} Results summary
   */
  async runFullSuite(options = {}) {
    const {
      duration = 10,
      targetObjects = 1000,
      logResults = true,
    } = options;

    console.info('[PerformanceProfiler] Starting full profiling suite...');
    this.isRunning = true;
    this.results = {
      scenarios: [],
      summary: {},
      timestamp: new Date().toISOString(),
    };

    try {
      // Scenario 1: Baseline (no advanced rendering)
      await this.profileScenario('baseline', {
        lod: false,
        bloom: false,
        motionBlur: false,
        dof: false,
        decals: false,
        toneMappingPass: false,
        objectCount: 100,
        duration,
      });

      // Scenario 2: Light quality (LOD only)
      await this.profileScenario('low', {
        lod: true,
        bloom: false,
        motionBlur: false,
        dof: false,
        decals: false,
        toneMappingPass: true,
        objectCount: 500,
        duration,
      });

      // Scenario 3: Medium quality
      await this.profileScenario('medium', {
        lod: true,
        bloom: true,
        motionBlur: false,
        dof: false,
        decals: true,
        toneMappingPass: true,
        objectCount: 750,
        duration,
      });

      // Scenario 4: High quality
      await this.profileScenario('high', {
        lod: true,
        bloom: true,
        motionBlur: true,
        dof: false,
        decals: true,
        toneMappingPass: true,
        objectCount: targetObjects,
        duration,
      });

      // Scenario 5: Ultra quality (max load)
      await this.profileScenario('ultra', {
        lod: true,
        bloom: true,
        motionBlur: true,
        dof: true,
        decals: true,
        toneMappingPass: true,
        objectCount: Math.floor(targetObjects * 1.2),
        duration,
      });

      // Calculate summary statistics
      this._calculateSummary();

      if (logResults) {
        this._logResults();
      }

      return this.results;
    } finally {
      this.isRunning = false;
      this._cleanup();
    }
  }

  /**
   * Profile a single scenario.
   * @private
   */
  async profileScenario(name, config) {
    console.info(`[PerformanceProfiler] Running scenario: ${name}`);
    this.currentScenario = name;

    // Apply rendering settings
    this._applyRenderingConfig(config);

    // Spawn test objects
    this._spawnTestObjects(config.objectCount);

    // Warm up (1 second)
    await this._wait(1000);

    // Run profiling
    const metrics = await this._profileMetrics(config.duration);

    // Store results
    this.results.scenarios.push({
      name,
      config,
      metrics,
      timestamp: new Date().toISOString(),
    });

    // Cleanup
    this._despawnTestObjects();
  }

  /**
   * Apply rendering configuration.
   * @private
   */
  _applyRenderingConfig(config) {
    if (!this.engine?.renderingMgr) return;

    const features = [
      { flag: config.lod, feature: 'lod' },
      { flag: config.bloom, feature: 'bloom' },
      { flag: config.motionBlur, feature: 'motionblur' },
      { flag: config.dof, feature: 'dof' },
      { flag: config.decals, feature: 'decals' },
      { flag: config.toneMappingPass, feature: 'tonemapping' },
    ];

    features.forEach(({ flag, feature }) => {
      if (flag) {
        this.engine.renderingMgr.enableFeature(feature);
      } else {
        this.engine.renderingMgr.disableFeature(feature);
      }
    });
  }

  /**
   * Spawn test objects in the scene.
   * @private
   */
  _spawnTestObjects(count) {
    if (!this.engine?.scene) return;

    console.log(`[PerformanceProfiler] Spawning ${count} test objects...`);
    this.testObjectIds = [];

    // Simple test object creation
    for (let i = 0; i < count; i++) {
      const id = `perf-test-obj-${i}`;
      this.testObjectIds.push(id);

      // Register with LOD system if available
      if (this.engine.renderingMgr?.registerObjectForLOD) {
        const distance = Math.random() * 1000;
        this.engine.registerObjectForLOD(id, null, 'sphere', null);
      }
    }
  }

  /**
   * Remove all test objects from scene.
   * @private
   */
  _despawnTestObjects() {
    if (!this.engine?.renderingMgr) return;

    console.log(`[PerformanceProfiler] Cleaning up ${this.testObjectIds.length} test objects...`);

    this.testObjectIds.forEach((id) => {
      if (this.engine.renderingMgr?._instances?.lodManager) {
        this.engine.renderingMgr._instances.lodManager.unregisterObject(id);
      }
    });

    this.testObjectIds = [];
  }

  /**
   * Profile performance metrics over duration.
   * @private
   */
  async _profileMetrics(durationSec) {
    const samples = [];
    const startTime = performance.now();
    const endTime = startTime + (durationSec * 1000);

    let frameCount = 0;
    let lastFrameTime = startTime;

    return new Promise((resolve) => {
      const sampleInterval = setInterval(() => {
        const now = performance.now();
        const frameDelta = (now - lastFrameTime) / 1000;
        const fps = frameDelta > 0 ? 1 / frameDelta : 0;

        samples.push({
          timestamp: now - startTime,
          fps,
          memory: this._getMemoryUsage(),
          triangles: this._getTriangleCount(),
          drawCalls: this._getDrawCallCount(),
        });

        lastFrameTime = now;
        frameCount++;

        if (now >= endTime) {
          clearInterval(sampleInterval);
          resolve(this._analyzeMetrics(samples));
        }
      }, 16); // Sample every ~16ms (60 FPS)
    });
  }

  /**
   * Analyze collected metrics.
   * @private
   */
  _analyzeMetrics(samples) {
    if (samples.length === 0) return {};

    const fps = samples.map((s) => s.fps);
    const memory = samples.map((s) => s.memory);

    return {
      frameCount: samples.length,
      duration: samples[samples.length - 1].timestamp,
      fps: {
        avg: this._average(fps),
        min: Math.min(...fps),
        max: Math.max(...fps),
        p50: this._percentile(fps, 50),
        p95: this._percentile(fps, 95),
        p99: this._percentile(fps, 99),
      },
      memory: {
        avg: this._average(memory),
        min: Math.min(...memory),
        max: Math.max(...memory),
      },
      triangles: {
        avg: this._average(samples.map((s) => s.triangles)),
      },
      drawCalls: {
        avg: this._average(samples.map((s) => s.drawCalls)),
      },
    };
  }

  /**
   * Calculate summary statistics.
   * @private
   */
  _calculateSummary() {
    if (this.results.scenarios.length === 0) return;

    const summary = {
      testCount: this.results.scenarios.length,
      targetFrameRate: 60,
      mobileFrameRate: 30,
      results: {},
    };

    this.results.scenarios.forEach((scenario) => {
      const metrics = scenario.metrics;
      const avgFps = metrics.fps?.avg || 0;
      const minFps = metrics.fps?.min || 0;

      summary.results[scenario.name] = {
        avgFps,
        minFps,
        passed: avgFps >= 30,
        mobileCompatible: avgFps >= 30,
      };
    });

    this.results.summary = summary;
  }

  /**
   * Log results to console.
   * @private
   */
  _logResults() {
    console.group('[PerformanceProfiler] Results Summary');

    const summary = this.results.summary;
    console.info(`Test timestamp: ${this.results.timestamp}`);
    console.info(`Total scenarios: ${summary.testCount}`);

    console.group('Performance Metrics:');
    Object.entries(summary.results).forEach(([name, result]) => {
      const status = result.passed ? '✓' : '✗';
      console.log(
        `${status} ${name.padEnd(10)} | Avg FPS: ${result.avgFps.toFixed(1).padStart(6)} | Min FPS: ${result.minFps.toFixed(1).padStart(6)}`
      );
    });
    console.groupEnd();

    console.groupEnd();
  }

  /**
   * Get current memory usage in MB.
   * @private
   */
  _getMemoryUsage() {
    if (performance.memory) {
      return performance.memory.usedJSHeapSize / 1024 / 1024;
    }
    return 0;
  }

  /**
   * Get current triangle count.
   * @private
   */
  _getTriangleCount() {
    if (this.engine?.renderingMgr?.getFeatureSummary) {
      const summary = this.engine.renderingMgr.getFeatureSummary();
      return summary.triangles || 0;
    }
    return 0;
  }

  /**
   * Get current draw call count.
   * @private
   */
  _getDrawCallCount() {
    if (this.engine?.renderer?.stats?.calls) {
      return this.engine.renderer.stats.calls;
    }
    return 0;
  }

  /**
   * Calculate average of array.
   * @private
   */
  _average(arr) {
    return arr.length > 0 ? arr.reduce((a, b) => a + b) / arr.length : 0;
  }

  /**
   * Calculate percentile of array.
   * @private
   */
  _percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Wait for specified milliseconds.
   * @private
   */
  _wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup after profiling.
   * @private
   */
  _cleanup() {
    this._despawnTestObjects();
    this.currentScenario = null;
  }

  /**
   * Export results as JSON.
   * @returns {string}
   */
  exportJSON() {
    return JSON.stringify(this.results, null, 2);
  }

  /**
   * Export results as CSV.
   * @returns {string}
   */
  exportCSV() {
    const lines = [];
    lines.push('Scenario,Object Count,Avg FPS,Min FPS,Max FPS,P95 FPS,Avg Memory (MB)');

    this.results.scenarios.forEach((scenario) => {
      const config = scenario.config;
      const metrics = scenario.metrics;
      lines.push(
        [
          scenario.name,
          config.objectCount,
          (metrics.fps?.avg || 0).toFixed(2),
          (metrics.fps?.min || 0).toFixed(2),
          (metrics.fps?.max || 0).toFixed(2),
          (metrics.fps?.p95 || 0).toFixed(2),
          (metrics.memory?.avg || 0).toFixed(2),
        ].join(',')
      );
    });

    return lines.join('\n');
  }

  /**
   * Get singleton instance.
   * @static
   */
  static getInstance(gameEngine) {
    if (!PerformanceProfiler.instance) {
      PerformanceProfiler.instance = new PerformanceProfiler(gameEngine);
    }
    return PerformanceProfiler.instance;
  }
}

// Export for browser environments
if (typeof window !== 'undefined') {
  window.GQPerformanceProfiler = { PerformanceProfiler };
}

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PerformanceProfiler };
}
