# Phase 4: Visual Effects Performance Optimization

## Overview

The **VisualEffectsPerformanceOptimizer** provides adaptive Level-of-Detail (LOD) management for all visual effects in GalaxyQuest, automatically scaling particle density and visual intensity based on frame rate performance.

## Features

### 1. Adaptive LOD System
- **Automatic Degradation**: Reduces particle density when FPS drops below threshold (default: 45 FPS)
- **Graceful Recovery**: Increases LOD when FPS recovers above recovery threshold (default: 50 FPS)
- **Smooth Transitions**: Lerp-based smooth LOD changes over multiple frames
- **Per-Frame Budget**: Monitors consecutive slow/fast frames to avoid oscillation

### 2. Performance Monitoring
- **FPS Tracking**: Continuous frame rate monitoring with configurable check intervals
- **Performance Reports**: Real-time stats on current FPS, LOD level, particle density, and sun intensity
- **Debug Output**: Console logging of LOD transitions with FPS values

### 3. Adaptive Subsystems
- **Particle Density Scaling** (ThrusterFX + StellarExplosionFX)
  - Scales particle count from 0% to 100% based on LOD
  - Minimum 1 particle per emitter to maintain visual feedback
  
- **Sun Intensity Scaling** (SunAnimator)
  - Maintains visible glow at all LOD levels (minimum 30% intensity)
  - Reduces bloom overhead at lower LOD

## Integration Points

### VisualEffectsManager API

```javascript
// Get performance optimizer (lazily loaded)
const optimizer = manager.getPerformanceOptimizer();

// Control LOD scaling
manager.setParticleDensityScale(0.5);  // 50% density
manager.setSunIntensityScale(0.8);     // 80% sun glow

// Update each frame (called automatically by optimizer)
optimizer.update(deltaTime, currentFPS);

// Force specific LOD for testing
optimizer.forceLOD(0.5);

// Get performance report
const report = optimizer.getReport();
console.log(report);
// { fps: 55, lod: 0.75, particleDensity: 0.75, sunIntensity: 0.75, degraded: false }

// Enable/disable automatic optimization
optimizer.setEnabled(false);  // Manual LOD control
optimizer.setEnabled(true);   // Resume automatic optimization
```

### GameEngine Integration Pattern

```javascript
// In GameEngine._onUpdate(dt, alpha):
const fpsEstimate = 1 / dt;  // or use actual frame timing
visualEffectsManager.update(dt, {
  velocities: shipVelocities,
  accelerations: shipAccelerations,
  positions: shipPositions,
});

// Optionally update performance monitor
const perfOptimizer = visualEffectsManager.getPerformanceOptimizer();
if (perfOptimizer) {
  perfOptimizer.update(dt, fpsEstimate);
}
```

## Configuration Options

```javascript
const optimizer = new VisualEffectsPerformanceOptimizer(vfxManager, {
  targetFPS: 60,              // Target frame rate (default: 60)
  fpsThreshold: 45,           // FPS to trigger degradation (default: 45)
  recoveryThreshold: 50,      // FPS to trigger recovery (default: 50)
  checkInterval: 1.0,         // Seconds between perf checks (default: 1.0)
});
```

## LOD Scale Behavior

### Particle Density (0.0 → 1.0)
| LOD   | Particle Count | Visual Effect |
|-------|---|---|
| 1.0   | 100% | Full thruster trails, explosions |
| 0.75  | 75%  | Slightly reduced trails |
| 0.5   | 50%  | Noticeably sparse trails |
| 0.25  | 25%  | Minimal visual feedback |
| 0.0   | 0%   | All particle effects disabled |

### Sun Intensity (0.3 → 1.0)
| LOD   | Glow Intensity | Visual Effect |
|-------|---|---|
| 1.0   | 100% | Full bloom and pulsation |
| 0.75  | 75%  | Reduced bloom radius |
| 0.5   | 50%  | Subtle glow only |
| 0.3   | 30%  | Minimal star visibility (floor) |

*Note: Sun intensity never goes below 30% to maintain stellar visibility.*

## Performance Impact

### Degradation Triggers
- FPS < degradation threshold (45 FPS) for 2+ consecutive checks
- Each degradation step: LOD -= 0.25 (can be tuned)

### Recovery Triggers
- FPS > recovery threshold (50 FPS) for 3+ consecutive checks
- Each recovery step: LOD += 0.15 (can be tuned)

### Expected Results
- **Low-End Devices**: LOD stabilizes around 0.25-0.5 with smooth 45-60 FPS
- **Mid-Range Devices**: LOD stays at 0.75-1.0 with 55-60 FPS
- **High-End Devices**: LOD maintains 1.0 at 60+ FPS

## Advanced Features

### Manual LOD Control
For specific scenarios (e.g., ultra-detail mode for cinematic shots):

```javascript
const optimizer = manager.getPerformanceOptimizer();

// Force maximum quality
optimizer.forceLOD(1.0);
optimizer.setEnabled(false);  // Disable automatic adjustment

// Later, restore automatic optimization
optimizer.setEnabled(true);
```

### Per-Scene LOD Tuning
Adjust thresholds based on scene complexity:

```javascript
// Space station (high detail required):
optimizer = new VisualEffectsPerformanceOptimizer(manager, {
  fpsThreshold: 50,    // More aggressive degradation
  recoveryThreshold: 55,
  checkInterval: 0.5,  // More frequent checks
});

// Deep space (lower detail):
optimizer = new VisualEffectsPerformanceOptimizer(manager, {
  fpsThreshold: 40,    // Less aggressive
  recoveryThreshold: 45,
  checkInterval: 2.0,  // Less frequent checks
});
```

## Debugging & Profiling

### Console Output
When LOD transitions occur:
```
[VFXPerf] Degrading LOD to 0.50 @ FPS 43.2
[VFXPerf] Improving LOD to 0.65 @ FPS 52.8
```

### Performance Report
```javascript
const report = optimizer.getReport();
if (report.degraded) {
  console.warn(`Performance degraded: ${report.fps} FPS, LOD: ${report.lod}`);
}
```

### Runtime Profiling
Monitor particle count and bloom overhead:
```javascript
// Disable post-effects to isolate particle cost
manager._postEffects = null;
console.time('Particle CPU cost');
manager.update(dt, state);
console.timeEnd('Particle CPU cost');

// Re-enable
manager.setPostEffects(postEffects);
```

## Best Practices

1. **Call optimizer.update() every frame** for continuous monitoring
2. **Provide FPS estimate** from actual frame timing, not delta-time estimate
3. **Don't set very tight thresholds** (e.g., degradeThreshold=50) to avoid oscillation
4. **Monitor multiple scenes** to tune thresholds per scenario
5. **Test on target hardware** to validate LOD settings

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Particles never degrade | Optimizer not updated | Call `optimizer.update(dt, fps)` each frame |
| LOD oscillates rapidly | Thresholds too tight | Increase gap: `fpsThreshold=40, recoveryThreshold=50` |
| Sun glow disappears completely | LOD goes to 0 | Ensure sun intensity floor (0.3) is maintained |
| Effects still laggy | LOD not low enough | Reduce checkInterval for faster response, or increase degradation step |

## Related Systems

- **ThrusterFX**: Responds to particle density scale
- **SunAnimator**: Responds to intensity scale
- **StellarExplosionFX**: Responds to particle density scale
- **VisualEffectsManager**: Central coordinator

## Files

- `VisualEffectsPerformanceOptimizer.js` — Core optimizer class
- `VisualEffectsManager.js` — Integration points (setParticleDensityScale, setSunIntensityScale, getPerformanceOptimizer)

## Future Enhancements

- [ ] GPU utilization monitoring (WebGPU compute shader cost)
- [ ] Memory budget tracking (particle buffer utilization)
- [ ] Per-effect LOD curves (custom scaling for specific effects)
- [ ] Heuristic scene complexity estimation (auto-tune thresholds)
