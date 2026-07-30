# Advanced Rendering: Testing & Profiling Guide

## Overview

The Phase 3 integration includes a comprehensive testing and profiling suite to validate all advanced 3D rendering features and measure performance improvements.

## Test Suite Components

### 1. Unit Tests (AdvancedRenderingTests.js)

Validates all integrated features:

- **LOD System Tests**
  - Manager initialization
  - Object registration/unregistration
  - Update method availability

- **Post-Processing Pipeline Tests**
  - Composer existence
  - Individual pass availability (bloom, motion blur, tone mapping, DOF)
  - Feature toggle functionality

- **Decal System Tests**
  - Decal manager initialization
  - CombatFX integration
  - Decal addition methods

- **Cinematic Camera Tests**
  - Method availability
  - Mode enable/disable
  - State tracking

- **Procedural Mesh Tests**
  - Asteroid generation
  - Debris field generation
  - Cache clearing

### 2. Performance Profiler (PerformanceProfiler.js)

Measures performance across five test scenarios:

| Scenario | Features | Object Count | Purpose |
|----------|----------|--------------|---------|
| baseline | None | 100 | Control measurement |
| low | LOD + Tone Mapping | 500 | Mobile baseline |
| medium | LOD + Bloom + Decals + Tone | 750 | Balanced profile |
| high | LOD + Bloom + Motion + Decals + Tone | 1000 | Desktop standard |
| ultra | All features | 1200 | High-end RTX |

**Metrics collected per scenario:**
- FPS (average, min, max, P95, P99)
- Memory usage (average, min, max)
- Triangle count
- Draw call count

**Pass criteria:**
- Desktop: ≥30 FPS average
- Mobile: ≥30 FPS average
- High-end: ≥60 FPS average

### 3. Test Runner (AdvancedRenderingTestRunner.js)

Orchestrates all tests and generates comprehensive reports.

## Running Tests

### Browser Environment

```javascript
// In browser console or loaded script
const runner = new window.GQAdvancedRenderingTestRunner.AdvancedRenderingTestRunner(gameEngine);

// Run all tests (takes 2-3 minutes with profiling)
await runner.runAll({ logResults: true });

// Run only unit tests (fast, ~30 seconds)
await runner.runAll({ skipPerformance: true });
```

### Programmatic Usage

```javascript
import { AdvancedRenderingTestRunner } from './AdvancedRenderingTestRunner.js';

const runner = new AdvancedRenderingTestRunner(gameEngine);
const results = await runner.runAll({ skipPerformance: false });

// Export results
const jsonReport = runner.exportJSON();
const markdownReport = runner.exportMarkdown();
```

## Expected Performance Results

### Desktop Target (High-end GPU)

```
✓ baseline     Avg: 120.0 FPS | Min:  95.0 FPS
✓ low          Avg: 100.0 FPS | Min:  80.0 FPS
✓ medium       Avg:  85.0 FPS | Min:  65.0 FPS
✓ high         Avg:  65.0 FPS | Min:  45.0 FPS (target: ≥30)
✓ ultra        Avg:  55.0 FPS | Min:  40.0 FPS (target: ≥30)
```

### Mobile Target (Mid-range GPU)

```
✓ baseline     Avg:  60.0 FPS | Min:  45.0 FPS
✓ low          Avg:  45.0 FPS | Min:  30.0 FPS (target: ≥30)
✗ medium       Avg:  25.0 FPS | Min:  15.0 FPS (FAIL - use Low preset)
✗ high         Avg:  18.0 FPS | Min:   8.0 FPS (FAIL - use Low preset)
✗ ultra        Avg:  12.0 FPS | Min:   5.0 FPS (FAIL - use Low preset)
```

**Recommendation**: On mobile, automatically select "Low" or "Mobile" preset.

## Graphics Settings UI Integration

All features can be toggled in the Settings > Graphics panel:

1. **Quality Preset Selector**
   - Automatically enables/disables features based on selection
   - Saves to localStorage
   - Updates UI state accordingly

2. **Individual Feature Toggles**
   - Override preset selections
   - LOD, Bloom, Motion Blur, DOF, Decals, Tone Mapping
   - Real-time updates

3. **Performance Monitor**
   - Display FPS, Memory, Triangles, Draw Calls
   - Updates every 500ms
   - Toggle visibility

## Optimization Strategies

### For Low FPS (<30 on target device):

1. **Disable expensive features in order**:
   - DOF (most expensive post-processing)
   - Motion Blur (second expensive)
   - Bloom (moderate cost)
   - Decals (small impact)
   - LOD (keep enabled for far objects)

2. **Reduce object complexity**:
   - Lower LOD thresholds
   - Simplify procedural meshes
   - Reduce decal lifetime

3. **Profile bottlenecks**:
   - Check GPU memory (run `.perf.exportStats()`)
   - Measure draw calls
   - Analyze triangle count

### For High-end Devices (60+ FPS):

1. **Enable all features** for best visual quality
2. **Increase object count** to fully utilize GPU
3. **Use Ultra preset** for cinematic quality
4. **Enable performance monitoring** for validation

## Performance Monitoring

### Real-time Metrics (in-game)

Check the Performance Monitor display in Settings > Graphics:

- **FPS**: Target ≥60 (desktop) or ≥30 (mobile)
- **Memory**: Should remain stable (no leaks)
- **Triangles**: Increases with object count
- **Draw Calls**: Should be ≤200 (optimized renderer)

### Profiling Tools

```javascript
// Get feature summary
const summary = gameEngine.renderingMgr.getFeatureSummary();
console.log(summary);

// Export rendering configuration
const config = gameEngine.renderingMgr.exportConfiguration();
console.log(config);

// Get procedural mesh statistics
const procStats = gameEngine.renderingMgr.getProceduralStats();
console.log(procStats);
```

## Test Results Interpretation

### All tests pass ✓

```
✓ Unit Tests: PASSED
✓ Performance: GOOD
```

**Status**: Ready for production
**Action**: No changes needed

### Unit tests fail ✗

```
✗ Unit Tests: FAILED
  • Review failed unit tests and fix issues
```

**Status**: Integration incomplete
**Action**: Fix failing features before deployment

### Performance tests fail ✗

```
✗ Performance: NEEDS IMPROVEMENT
  • Consider disabling post-processing on lower-end devices
  • Test with different LOD thresholds
  • Profile GPU memory usage
```

**Status**: Optimization needed
**Action**: Adjust presets or disable features on affected devices

## Desktop Performance Testing

### Hardware Requirements

- **CPU**: 4+ cores (Intel i5/AMD Ryzen 5 or better)
- **GPU**: 4GB+ VRAM (GTX 1060 / RTX 3050 or equivalent)
- **RAM**: 8GB+ available
- **Browser**: Chrome/Firefox with WebGL 2.0 support

### Test Procedure

1. Open developer tools (F12)
2. Run test suite:
   ```javascript
   const runner = new GQAdvancedRenderingTestRunner.AdvancedRenderingTestRunner(gameEngine);
   await runner.runAll();
   ```
3. Monitor:
   - Console output for FPS readings
   - GPU usage in Task Manager/Activity Monitor
   - Memory in Performance tab
4. Record results for comparison

## Mobile Performance Testing

### Supported Devices

- **Minimum**: iPad Air 2 (2014), iPhone SE (2020)
- **Target**: iPad Pro (2017), iPhone 12
- **High-end**: iPad Pro M2, iPhone 14 Pro

### Test Procedure

1. Deploy to test server
2. Open on target device
3. Enable Performance Monitor in Settings > Graphics
4. Run profiling:
   ```javascript
   await runner.runAll({ skipPerformance: true }); // Fast unit tests only
   ```
5. Watch FPS and Memory for 30 seconds
6. Record findings

### Expected Mobile Results

- **Low preset**: 30-45 FPS on mid-range devices
- **Medium preset**: Not recommended for mobile
- **Memory**: <200MB JS heap

## CI/CD Integration

Tests can be integrated into automated pipelines:

```bash
# Run unit tests only (no performance profiling)
npm test -- --unit-only --no-perf

# Run full suite (long duration)
npm test -- --performance --duration=10

# Export results as JSON
npm test -- --export-json=perf-results.json

# Export results as markdown
npm test -- --export-markdown=perf-results.md
```

## Troubleshooting

### Tests timeout

- Reduce test duration: `duration: 5` (default is 10)
- Skip performance tests: `skipPerformance: true`
- Check browser console for errors

### FPS erratic or very low

- Check GPU utilization in browser DevTools
- Disable other browser tabs/extensions
- Verify WebGL/WebGPU availability
- Test with lower object count

### Memory keeps increasing

- Indicates possible leak
- Check decal pooling (limits lifetime)
- Verify procedural mesh cache clearing
- Profile with Chrome DevTools Memory tab

## Next Steps

1. **Run unit tests** to verify all features are integrated
2. **Profile desktop** performance on your target GPU
3. **Profile mobile** performance on your target device
4. **Adjust presets** based on actual device performance
5. **Deploy** with appropriate quality defaults per platform

---

**Last Updated**: 2026-07-30
**Phase**: 3 Integration Complete
**Status**: Ready for Testing
