/**
 * AdvancedRenderingTestRunner.js
 * Orchestrates performance profiling and comprehensive testing
 *
 * Usage:
 *   const runner = new AdvancedRenderingTestRunner(gameEngine);
 *   await runner.runAll();
 */

export class AdvancedRenderingTestRunner {
  /**
   * @param {GameEngine} gameEngine
   */
  constructor(gameEngine) {
    this.engine = gameEngine;
    this.allResults = {
      timestamp: new Date().toISOString(),
      unitTests: null,
      performanceSuite: null,
      summary: {},
    };
  }

  /**
   * Run all tests and profiling.
   * @param {object} options
   * @param {boolean} [options.skipPerformance=false] - Skip performance profiling (faster)
   * @param {boolean} [options.logResults=true] - Log results to console
   * @returns {Promise<object>} Complete test results
   */
  async runAll(options = {}) {
    const { skipPerformance = false, logResults = true } = options;

    console.group('[AdvancedRenderingTestRunner] Starting comprehensive test suite');
    console.info(`Environment: ${typeof window !== 'undefined' ? 'Browser' : 'Node.js'}`);
    console.info(`GameEngine ready: ${!!this.engine}`);

    try {
      // Step 1: Run unit tests
      console.info('');
      console.info('Step 1/2: Running unit tests...');
      const unitResults = await this._runUnitTests();
      this.allResults.unitTests = unitResults;
      this._printTestSummary(unitResults);

      // Step 2: Run performance profiling (optional)
      if (!skipPerformance) {
        console.info('');
        console.info('Step 2/2: Running performance profiling...');
        const perfResults = await this._runPerformanceProfiling();
        this.allResults.performanceSuite = perfResults;
        this._printPerfSummary(perfResults);
      } else {
        console.info('Step 2/2: Skipped performance profiling');
      }

      // Calculate overall summary
      this._calculateSummary();

      if (logResults) {
        this._printFinalReport();
      }

      console.groupEnd();
      return this.allResults;
    } catch (err) {
      console.error('[AdvancedRenderingTestRunner] Error:', err);
      console.groupEnd();
      throw err;
    }
  }

  /**
   * Run unit tests.
   * @private
   */
  async _runUnitTests() {
    // Dynamically import test module
    let AdvancedRenderingTests;
    try {
      if (typeof window !== 'undefined' && window.GQAdvancedRenderingTests) {
        AdvancedRenderingTests = window.GQAdvancedRenderingTests.AdvancedRenderingTests;
      } else {
        const mod = await import('./AdvancedRenderingTests.js');
        AdvancedRenderingTests = mod.AdvancedRenderingTests;
      }
    } catch (err) {
      console.warn('[AdvancedRenderingTestRunner] Could not import AdvancedRenderingTests:', err);
      return null;
    }

    if (!AdvancedRenderingTests) return null;
    return AdvancedRenderingTests.runAllTests(this.engine);
  }

  /**
   * Run performance profiling.
   * @private
   */
  async _runPerformanceProfiling() {
    // Dynamically import profiler module
    let PerformanceProfiler;
    try {
      if (typeof window !== 'undefined' && window.GQPerformanceProfiler) {
        PerformanceProfiler = window.GQPerformanceProfiler.PerformanceProfiler;
      } else {
        const mod = await import('./PerformanceProfiler.js');
        PerformanceProfiler = mod.PerformanceProfiler;
      }
    } catch (err) {
      console.warn('[AdvancedRenderingTestRunner] Could not import PerformanceProfiler:', err);
      return null;
    }

    if (!PerformanceProfiler) return null;

    const profiler = PerformanceProfiler.getInstance(this.engine);
    return profiler.runFullSuite({
      duration: 5,
      targetObjects: 1000,
      logResults: false,
    });
  }

  /**
   * Print unit test summary.
   * @private
   */
  _printTestSummary(results) {
    if (!results) {
      console.log('  (Tests skipped)');
      return;
    }

    const { summary, tests } = results;
    console.log(`  Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}`);

    if (summary.failed > 0) {
      console.group('  Failed tests:');
      tests
        .filter((t) => t.status === 'failed')
        .forEach((t) => {
          console.warn(`    ✗ ${t.name} (${t.category})`);
          if (t.error) console.warn(`      Error: ${t.error}`);
        });
      console.groupEnd();
    }
  }

  /**
   * Print performance summary.
   * @private
   */
  _printPerfSummary(results) {
    if (!results || !results.summary) {
      console.log('  (Performance profiling skipped)');
      return;
    }

    const summary = results.summary;
    console.group('  Performance Results:');
    console.log(`  Target Frame Rate (Desktop): ${summary.targetFrameRate} FPS`);
    console.log(`  Target Frame Rate (Mobile): ${summary.mobileFrameRate} FPS`);

    Object.entries(summary.results).forEach(([scenario, result]) => {
      const status = result.passed ? '✓' : '✗';
      console.log(
        `  ${status} ${scenario.padEnd(12)} Avg: ${result.avgFps.toFixed(1).padStart(5)} FPS | Min: ${result.minFps.toFixed(1).padStart(5)} FPS`
      );
    });
    console.groupEnd();
  }

  /**
   * Calculate overall summary.
   * @private
   */
  _calculateSummary() {
    const summary = {
      allTestsPassed: false,
      performanceGood: false,
      details: {},
    };

    // Check unit tests
    if (this.allResults.unitTests) {
      const testSummary = this.allResults.unitTests.summary;
      summary.details.unitTests = {
        passed: testSummary.passed,
        failed: testSummary.failed,
        skipped: testSummary.skipped,
      };
      summary.allTestsPassed = testSummary.failed === 0;
    }

    // Check performance
    if (this.allResults.performanceSuite) {
      const perfSummary = this.allResults.performanceSuite.summary;
      const allPassed = Object.values(perfSummary.results).every((r) => r.passed);
      summary.performanceGood = allPassed;
      summary.details.performance = Object.keys(perfSummary.results).length + ' scenarios tested';
    }

    this.allResults.summary = summary;
  }

  /**
   * Print final comprehensive report.
   * @private
   */
  _printFinalReport() {
    console.group('[AdvancedRenderingTestRunner] Final Report');
    console.info(`Timestamp: ${this.allResults.timestamp}`);

    const summary = this.allResults.summary;
    const passed = summary.allTestsPassed ? '✓' : '✗';
    const perfOk = summary.performanceGood ? '✓' : '✗';

    console.log(`${passed} Unit Tests: ${summary.allTestsPassed ? 'PASSED' : 'FAILED'}`);
    console.log(`${perfOk} Performance: ${summary.performanceGood ? 'GOOD' : 'NEEDS IMPROVEMENT'}`);

    // Recommendations
    if (!summary.allTestsPassed || !summary.performanceGood) {
      console.group('Recommendations:');
      if (!summary.allTestsPassed) {
        console.warn('  • Review failed unit tests and fix issues');
      }
      if (!summary.performanceGood) {
        console.warn('  • Consider disabling post-processing on lower-end devices');
        console.warn('  • Test with different LOD thresholds');
        console.warn('  • Profile GPU memory usage');
      }
      console.groupEnd();
    }

    console.groupEnd();
  }

  /**
   * Export all results as JSON.
   * @returns {string}
   */
  exportJSON() {
    return JSON.stringify(this.allResults, null, 2);
  }

  /**
   * Export results as markdown report.
   * @returns {string}
   */
  exportMarkdown() {
    const lines = [];
    lines.push('# Advanced Rendering Test Report');
    lines.push(`**Date**: ${this.allResults.timestamp}`);
    lines.push('');

    // Unit tests section
    if (this.allResults.unitTests) {
      lines.push('## Unit Tests');
      const summary = this.allResults.unitTests.summary;
      lines.push(`- Passed: ${summary.passed}`);
      lines.push(`- Failed: ${summary.failed}`);
      lines.push(`- Skipped: ${summary.skipped}`);
      lines.push('');

      if (summary.failed > 0) {
        lines.push('### Failed Tests');
        this.allResults.unitTests.tests
          .filter((t) => t.status === 'failed')
          .forEach((t) => {
            lines.push(`- **${t.name}** (${t.category})`);
            if (t.error) lines.push(`  - Error: ${t.error}`);
          });
        lines.push('');
      }
    }

    // Performance section
    if (this.allResults.performanceSuite) {
      lines.push('## Performance Results');
      const perfSummary = this.allResults.performanceSuite.summary;

      lines.push('| Scenario | Avg FPS | Min FPS | Status |');
      lines.push('|----------|---------|---------|--------|');
      Object.entries(perfSummary.results).forEach(([name, result]) => {
        const status = result.passed ? '✓ Pass' : '✗ Fail';
        lines.push(
          `| ${name} | ${result.avgFps.toFixed(1)} | ${result.minFps.toFixed(1)} | ${status} |`
        );
      });
      lines.push('');
    }

    // Summary
    lines.push('## Summary');
    const summary = this.allResults.summary;
    lines.push(
      `**Overall Status**: ${summary.allTestsPassed && summary.performanceGood ? '✓ PASS' : '✗ FAIL'}`
    );

    return lines.join('\n');
  }
}

// Export for browser environments
if (typeof window !== 'undefined') {
  window.GQAdvancedRenderingTestRunner = { AdvancedRenderingTestRunner };
}

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AdvancedRenderingTestRunner };
}
