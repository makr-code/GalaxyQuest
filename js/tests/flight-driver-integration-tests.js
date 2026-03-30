/*
 * Flight Driver Integration Tests
 * Comprehensive test suite for Camera Driver lifecycle, takeover, telemetry consistency,
 * and state machine validation.
 *
 * Usage:
 *   const runner = window.GQFlightDriverTests.createRunner();
 *   const results = runner.runAll();
 *   console.log(results.summary());
 */

const GQFlightDriverTests = {
  VERSION: '1.0.0',

  /**
   * Creates a test runner with lazy-loaded dependencies.
   * @returns {Object} runner with runAll(), runTest(name), getResults()
   */
  createRunner() {
    const results = new Map(); // testName → {ok, errors: string[], duration: ms}
    const metrics = {
      total: 0,
      passed: 0,
      failed: 0,
      durationMs: 0,
    };

    const tests = {
      // ─── Device/Schema Setup ─────────────────────────────────────────────
      'schema-load': () => {
        const schema = window.GQSpaceFlightTelemetrySchema;
        if (!schema) throw new Error('GQSpaceFlightTelemetrySchema not loaded');
        if (typeof schema.createEmpty !== 'function') throw new Error('createEmpty not a function');
        if (typeof schema.normalize !== 'function') throw new Error('normalize not a function');
        if (typeof schema.validate !== 'function') throw new Error('validate not a function');
      },

      'driver-load': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        if (!factory) throw new Error('GQSpaceCameraFlightDriver not loaded');
        if (typeof factory.create !== 'function') throw new Error('create not a function');
      },

      'controller-load': () => {
        if (!window.GalaxyCameraController) throw new Error('GalaxyCameraController not loaded');
        if (typeof window.GalaxyCameraController.validateDriver !== 'function') {
          throw new Error('validateDriver not a function');
        }
      },

      // ─── Driver Creation & Validation ────────────────────────────────────
      'driver-create': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        if (!driver) throw new Error('Driver creation returned null');
        if (typeof driver.update !== 'function') throw new Error('update not a function');
        if (typeof driver.getTelemetry !== 'function') throw new Error('getTelemetry not a function');
        if (typeof driver.setTarget !== 'function') throw new Error('setTarget not a function');
      },

      'driver-interface-valid': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        const validation = window.GalaxyCameraController.validateDriver(driver);
        if (!validation.valid) {
          throw new Error(`Invalid driver interface: ${validation.missing.join(', ')}`);
        }
      },

      'telemetry-init-valid': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        const telem = driver.getTelemetry();
        
        const schema = window.GQSpaceFlightTelemetrySchema;
        const validation = schema.validate(telem);
        if (!validation.ok) {
          throw new Error(`Initial telemetry invalid: ${validation.errors.join('; ')}`);
        }
      },

      // ─── Navigation State Machine ───────────────────────────────────────
      'navigation-state-idle': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        const state = driver.getNavigationState();
        if (state !== 'idle') throw new Error(`Expected 'idle', got '${state}'`);
      },

      'navigation-state-acquire': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        const target = { id: 1, x_ly: 100, y_ly: 50, z_ly: 200, label: 'TEST-STAR' };
        const success = driver.setTarget(target);
        if (!success) throw new Error('setTarget returned false');
        
        const state = driver.getNavigationState();
        if (state !== 'acquire') throw new Error(`Expected 'acquire', got '${state}'`);
        
        const telem = driver.getTelemetry();
        if (telem.phase !== 'acquire') throw new Error(`Telemetry phase not updated`);
      },

      'telemetry-target-fields': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        const target = { id: 42, x_ly: 100, y_ly: 50, z_ly: 200, label: 'ALPHA-CENT' };
        driver.setTarget(target);
        
        const telem = driver.getTelemetry();
        if (telem.targetId !== 42) throw new Error(`targetId mismatch: ${telem.targetId} != 42`);
        if (telem.targetLabel !== 'ALPHA-CENT') throw new Error(`targetLabel mismatch: ${telem.targetLabel}`);
      },

      // ─── Flight Lifecycle ───────────────────────────────────────────────
      'flight-update-without-target': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        
        // Mock renderer
        const renderer = {
          camera: { position: new window.THREE.Vector3(0, 0, 0) },
        };
        
        const result = driver.update({
          renderer,
          dt: 0.016,
          now: performance.now(),
        });
        
        // Should auto-pick a random target or return null safely
        if (result === undefined) throw new Error('update should return boolean or pose object');
      },

      'telemetry-speed-tracking': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        
        const telem1 = driver.getTelemetry();
        const initialSpeed = telem1.speed;
        
        // After update cycles, speed should be >= 0
        const renderer = {
          camera: { position: new window.THREE.Vector3(0, 0, 0) },
        };
        
        for (let i = 0; i < 5; i++) {
          driver.update({
            renderer,
            dt: 0.016,
            now: performance.now() + i * 16,
          });
        }
        
        const telem2 = driver.getTelemetry();
        if (typeof telem2.speed !== 'number' || telem2.speed < 0) {
          throw new Error(`Speed unexpected: ${telem2.speed}`);
        }
      },

      // ─── Telemetry Schema Compliance ────────────────────────────────────
      'telemetry-schema-all-fields': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        const telem = driver.getTelemetry();
        
        const requiredFields = ['phase', 'targetId', 'targetLabel', 'progress', 'distance', 'eta', 'speed'];
        for (const field of requiredFields) {
          if (!(field in telem)) {
            throw new Error(`Missing field: ${field}`);
          }
        }
      },

      'telemetry-progress-bounds': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        driver.setTarget({ id: 1, x_ly: 100, y_ly: 0, z_ly: 100, label: 'TEST' });
        
        const telem = driver.getTelemetry();
        if (telem.progress < 0 || telem.progress > 1) {
          throw new Error(`Progress out of bounds: ${telem.progress}`);
        }
      },

      'telemetry-distance-nonneg': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        driver.setTarget({ id: 1, x_ly: 100, y_ly: 0, z_ly: 100, label: 'TEST' });
        
        const telem = driver.getTelemetry();
        if (telem.distance < 0) {
          throw new Error(`Distance negative: ${telem.distance}`);
        }
      },

      'telemetry-eta-nonneg': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        driver.setTarget({ id: 1, x_ly: 100, y_ly: 0, z_ly: 100, label: 'TEST' });
        
        const telem = driver.getTelemetry();
        if (telem.eta < 0) {
          throw new Error(`ETA negative: ${telem.eta}`);
        }
      },

      // ─── Contract Validation ────────────────────────────────────────────
      'contracts-flight-telemetry': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        driver.setTarget({ id: 1, x_ly: 100, y_ly: 0, z_ly: 100, label: 'TEST' });
        
        const telem = driver.getTelemetry();
        const contracts = window.GQAPIContracts;
        const validation = contracts.validateFlightTelemetry(telem);
        
        if (!validation.ok) {
          throw new Error(`Contract violation: ${validation.errors.join('; ')}`);
        }
      },

      // ─── Error Handling ─────────────────────────────────────────────────
      'driver-setTarget-invalid-input': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        
        const result1 = driver.setTarget(null);
        if (result1 !== false) throw new Error('setTarget(null) should return false');
        
        const result2 = driver.setTarget({ id: 1, x_ly: NaN, z_ly: 100 });
        if (result2 !== false) throw new Error('setTarget with NaN should return false');
      },

      'driver-setRandomTarget-without-stars': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        
        // No stars set
        const result = driver.setRandomTarget();
        if (result !== false) throw new Error('setRandomTarget with no stars should return false');
      },

      'driver-setRandomTarget-with-stars': () => {
        const factory = window.GQSpaceCameraFlightDriver;
        const driver = factory.create({ three: window.THREE });
        
        const stars = [
          { id: 1, x_ly: 10, y_ly: 0, z_ly: 10, system_index: 1 },
          { id: 2, x_ly: 20, y_ly: 0, z_ly: 20, system_index: 2 },
        ];
        driver.setRandomStars(stars);
        
        const result = driver.setRandomTarget();
        if (result !== true) throw new Error('setRandomTarget should succeed with stars');
        
        const telem = driver.getTelemetry();
        if (telem.targetId === 0) throw new Error('targetId should be set');
      },

      // ─── Graceful Degradation ───────────────────────────────────────────
      'missing-physics-engine': () => {
        // Temporarily hide physics
        const saved = window.GQSpacePhysicsEngine;
        window.GQSpacePhysicsEngine = null;
        
        try {
          const factory = window.GQSpaceCameraFlightDriver;
          const driver = factory.create({ three: window.THREE });
          
          // Should still work (fallback to legacy)
          const renderer = {
            camera: { position: new window.THREE.Vector3(0, 0, 0) },
          };
          
          const result = driver.update({
            renderer,
            dt: 0.016,
            now: performance.now(),
          });
          
          // If we got here, graceful degradation worked
          if (result === undefined) {
            throw new Error('update should handle missing physics');
          }
        } finally {
          window.GQSpacePhysicsEngine = saved;
        }
      },

      'missing-schema-fallback': () => {
        const saved = window.GQSpaceFlightTelemetrySchema;
        window.GQSpaceFlightTelemetrySchema = null;
        
        try {
          const factory = window.GQSpaceCameraFlightDriver;
          const driver = factory.create({ three: window.THREE });
          
          // Should still create with fallback telemetry
          const telem = driver.getTelemetry();
          if (!telem.phase) throw new Error('Telemetry missing phase field');
        } finally {
          window.GQSpaceFlightTelemetrySchema = saved;
        }
      },
    };

    return {
      /**
       * Runs a single test by name.
       * @param {string} testName
       * @returns {Object} {ok, errors, duration}
       */
      runTest(testName) {
        if (!tests[testName]) {
          return { ok: false, errors: [`Unknown test: ${testName}`], duration: 0 };
        }

        const start = performance.now();
        const errors = [];

        try {
          tests[testName]();
        } catch (err) {
          errors.push(String(err?.message || err));
        }

        const duration = Math.round(performance.now() - start);
        const result = { ok: errors.length === 0, errors, duration };
        results.set(testName, result);
        return result;
      },

      /**
       * Runs all tests.
       * @returns {Object} with summary()
       */
      runAll() {
        const start = performance.now();
        results.clear();
        metrics.total = Object.keys(tests).length;
        metrics.passed = 0;
        metrics.failed = 0;

        for (const testName of Object.keys(tests)) {
          const result = this.runTest(testName);
          if (result.ok) {
            metrics.passed++;
          } else {
            metrics.failed++;
          }
        }

        metrics.durationMs = Math.round(performance.now() - start);

        return {
          results: new Map(results),
          metrics,
          summary: () => {
            const lines = [
              `=== Flight Driver Integration Test Summary ===`,
              `Total: ${metrics.total}  Passed: ${metrics.passed}  Failed: ${metrics.failed}`,
              `Duration: ${metrics.durationMs}ms`,
              ``,
            ];

            if (metrics.failed > 0) {
              lines.push(`FAILED TESTS:`);
              for (const [name, result] of results) {
                if (!result.ok) {
                  lines.push(`  ✗ ${name}`);
                  for (const error of result.errors) {
                    lines.push(`    • ${error}`);
                  }
                }
              }
            } else {
              lines.push(`✓ ALL TESTS PASSED`);
            }

            return lines.join('\n');
          },
          toJSON: () => ({
            schema_version: GQFlightDriverTests.VERSION,
            timestamp: Date.now(),
            metrics,
            tests: Array.from(results).map(([name, result]) => ({
              name,
              ok: result.ok,
              errorCount: result.errors.length,
              errors: result.errors,
              durationMs: result.duration,
            })),
          }),
        };
      },

      /**
       * Gets the raw results map.
       * @returns {Map}
       */
      getResults() {
        return new Map(results);
      },

      /**
       * Lists all available test names.
       * @returns {Array<string>}
       */
      listTests() {
        return Object.keys(tests);
      },
    };
  },

  /**
   * Serializes test results for backend logging.
   * @param {Object} testResults - from runner.runAll()
   * @returns {Object}
   */
  serialize(testResults) {
    return {
      timestamp: Date.now(),
      version: GQFlightDriverTests.VERSION,
      summary: {
        total: testResults.metrics.total,
        passed: testResults.metrics.passed,
        failed: testResults.metrics.failed,
        durationMs: testResults.metrics.durationMs,
      },
      details: testResults.toJSON().tests,
    };
  },
};

// Export to global namespace
if (typeof window !== 'undefined') {
  window.GQFlightDriverTests = GQFlightDriverTests;
}

// Export as module if in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GQFlightDriverTests;
}
