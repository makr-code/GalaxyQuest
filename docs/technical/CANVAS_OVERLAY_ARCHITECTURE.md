# Canvas Overlay & Animation Framework Architecture

**Version:** 1.0  
**Date:** July 30, 2026  
**Status:** Phase 1-5 Complete (Foundation + Integration)

---

## Table of Contents

1. [Overview](#overview)
2. [Core Components](#core-components)
3. [Architecture](#architecture)
4. [Data Structures](#data-structures)
5. [Rendering Pipeline](#rendering-pipeline)
6. [Public API](#public-api)
7. [Performance Considerations](#performance-considerations)
8. [Future Enhancements](#future-enhancements)

---

## Overview

The Canvas Overlay & Animation Framework provides a modular, extensible system for rendering 2D overlays on top of the 3D WebGPU galaxy renderer. It supports:

- **Time-based Animations** — Easing functions, tweens, sequences, loops
- **Selection Overlays** — Pulsing rings, dashed boxes (marquee effect)
- **Trajectory Rendering** — Linear, Bézier curves, elliptical orbits (Kepler)
- **Impact Effects** — Shockwaves, explosions, pulse rings
- **Highlights** — Glow, spotlight, aura effects
- **Labels** — Persistent or auto-expiring text with animations
- **Particle Systems** — Extensible emitter-based particle effects

All rendering is performed on a dedicated 2D canvas overlay (`_overlayCanvas`) positioned absolutely above the 3D renderer, with pointer events disabled to avoid interference with interaction.

---

## Core Components

### 1. Animation Engine (`canvas-animation-engine.js`)

#### **CanvasAnimationController**
Central manager for all active animations. Maintains a map of animations, updates them per frame, and auto-removes completed ones.

```javascript
const controller = new CanvasAnimationEngine.CanvasAnimationController();
controller.addAnimation(tween);
controller.update(deltaMs);
controller.pauseAll();
controller.clear();
```

**Methods:**
- `addAnimation(animation)` — Register an animation
- `removeAnimation(id)` — Remove by ID
- `getAnimation(id)` — Fetch active animation
- `update(deltaMs)` — Update all animations
- `pauseAll()` / `resumeAll()` — Global playback control
- `clear()` — Reset all
- `size()` — Count active animations
- `destroy()` — Cleanup

#### **Animation Base Class**
Foundation for all animation types. Manages lifecycle, easing, and callbacks.

```javascript
new Animation({
  id: 'anim-1',
  duration: 500,
  easing: 'easeInOutCubic',  // or custom function
})
  .onComplete(() => console.log('done'))
  .start();
```

**Lifecycle:**
- `start()` — Begin animation from startTime
- `pause()` — Freeze progress
- `resume()` — Unpause
- `reset()` — Clear state, ready for restart
- `update()` — Called per frame (internal)
- `getProgress()` — Returns [0, 1]
- `getEasedProgress()` — Returns eased progress

#### **PropertyTween**
Interpolates numeric values on a target object.

```javascript
new PropertyTween({
  target: { opacity: 0 },
  to: { opacity: 1 },
  duration: 300,
  easing: 'easeOutQuad',
  snapToInteger: false,
}).start();
```

#### **SequenceAnimation**
Chains animations sequentially with optional delays.

```javascript
new SequenceAnimation({
  animations: [tween1, tween2, tween3],
  delayMs: 100,  // delay before sequence starts
}).start();
```

#### **ParallelAnimation**
Plays multiple animations simultaneously.

```javascript
new ParallelAnimation({
  animations: [fadeIn, slideIn, scaleIn],
}).start();
```

#### **LoopAnimation**
Repeats an animation N times or infinitely.

```javascript
new LoopAnimation({
  animation: breathingPulse,
  iterations: Infinity,
  reverse: true,  // go backward too
}).start();
```

#### **Easing Functions**
20+ built-in easings via `EASING_FUNCTIONS` object:
- `linear`
- `easeIn/Out/InOut` variants: `Quad`, `Cubic`, `Quart`, `Quint`, `Sine`, `Expo`, `Circ`
- `easeIn/Out/InOut` variants: `Elastic`, `Bounce`, `Back`

Custom easings can be passed as functions: `easing: (t) => t * t`

---

### 2. Trajectory Renderer (`trajectory-renderer.js`)

Renders animated flight paths and orbital mechanics on canvas.

```javascript
const renderer = new TrajectoryRenderer();
renderer.render(ctx, trajectory, progress, viewport);
```

#### **Interpolation Modes**
- **Linear** — Straight line between points
- **Quadratic-Bézier** — Smooth curve through 3-point groups
- **Cubic-Bézier** — Smooth curve through 4-point groups
- **Catmull-Rom** — Natural spline through all points
- **Ellipse** — Keplerian orbital mechanics

#### **Kepler Orbital Solver**
Computes true anomaly from mean anomaly using Newton-Raphson iteration. Supports:
- Semi-major axis (`a`)
- Eccentricity (`e` ∈ [0, 1))
- Mean anomaly start (`M0`)
- Inclination, argument of periapsis, longitude of ascending node (3D projection)

```javascript
// Realistic space trajectory
const trajectory = {
  type: 'ellipse',
  semiMajorAxis: 150,      // AU or pixels
  eccentricity: 0.2,
  meanAnomalyStart: 0,
  center: { x: 500, y: 300 },
  style: { trailColor: 'rgba(100, 200, 255, 0.6)' },
  showTrail: true,
  showHead: true,
  animated: true,
};
renderer.render(ctx, trajectory, 0.5);  // 50% along orbit
```

#### **Methods**
- `interpolatePosition(trajectory, progress)` — Get position at progress [0, 1]
- `drawTrajectory(ctx, trajectory, viewport)` — Full path
- `drawTrail(ctx, trajectory, progress, viewport)` — Partial path to current position
- `drawMovingHead(ctx, trajectory, progress, viewport)` — Animated marker
- `drawVelocityVector(ctx, trajectory, progress, scale, viewport)` — Velocity arrow
- `render(ctx, trajectory, progress, viewport)` — Complete render with all elements
- `clear()` / `destroy()` — Cleanup

---

## Architecture

### Render Pipeline Integration

The animation system integrates into `Galaxy3DRendererWebGPU._renderGalaxyOverlay2D()`:

```
_renderGalaxyOverlay2D()
  ├─ Clear overlay canvas
  ├─ Update animation controller (deltaMs)  ← NEW
  ├─ Return if systemMode
  ├─ Calculate visual scales
  ├─ Render existing overlays:
  │  ├─ Clusters
  │  ├─ Gates
  │  ├─ Trade routes
  │  ├─ Fleets
  │  └─ Nodes
  └─ Render new overlays:              ← NEW
     ├─ Trajectories
     ├─ Selection overlays
     ├─ Impact effects
     ├─ Highlights
     ├─ Labels
     └─ Particles
```

### Memory Model

- **Overlay Canvas:** Positioned absolutely over WebGPU canvas
- **Animation Controller:** Singleton per renderer, manages lifecycle
- **Trajectory Renderer:** Singleton per renderer, caches interpolation segments
- **Data Storage:** Flat arrays in `_overlayData` for easy JSON serialization

```javascript
_overlayData = {
  fleets: [],           // Existing
  gates: [],            // Existing
  nodes: [],            // Existing
  clusters: [],         // Existing
  tradeRoutes: [],      // Existing
  clusterPalette: null, // Existing
  selections: [],       // NEW
  trajectories: [],     // NEW
  impactEffects: [],    // NEW
  highlights: [],       // NEW
  labels: [],           // NEW
  particles: [],        // NEW
};
```

---

## Data Structures

### Selection Object

```javascript
{
  id: 'star-123',                          // Unique identifier
  type: 'star' | 'planet' | 'fleet' | 'region' | 'selection-box',
  
  // For circle selections
  pos: { x, y },                           // Screen coordinates
  radius: 30,
  color: 'rgba(100, 200, 255, 0.8)',
  
  // Styling & animation
  style: 'pulsing' | 'solid' | 'dashed',
  animated: true,
  animation: { type: 'pulse' | 'grow' | 'breathe', speed: 1.0 },
  
  // For box selections
  rect: { x1, y1, x2, y2 },
  style: 'rect' | 'rounded-rect' | 'marquee-dashed',
  cornerRadius: 5,
  lineWidth: 2,
}
```

### Trajectory Object

```javascript
{
  id: 'fleet-123-path',
  
  // Path definition
  points: [ {x, y}, {x, y}, ... ],        // Way-points or Bézier control points
  type: 'linear' | 'quadratic-bezier' | 'cubic-bezier' | 'catmull-rom' | 'ellipse',
  pathSegments: 50,                       // Quality control
  
  // For elliptical orbits
  semiMajorAxis: 100,
  eccentricity: 0.2,
  meanAnomalyStart: 0,
  inclination: 0,
  argumentOfPeriapsis: 0,
  longitudeOfNode: 0,
  center: { x, y },
  
  // Timing
  startTime: Date.now(),
  endTime: Date.now() + 5000,
  currentProgress: 0.5,                   // [0, 1]
  
  // Visualization
  style: {
    trailColor: 'rgba(...)',
    trailWidth: 2,
    headColor: 'rgba(...)',
    headRadius: 4,
    glowColor: 'rgba(...)',
    glowWidth: 6,
    velocityColor: 'rgba(...)',
  },
  
  // Controls
  animated: true,
  showTrail: true,
  showHead: true,
  showPath: false,
  showVelocity: false,
}
```

### Impact Effect Object

```javascript
{
  id: 'impact-123',
  pos: { x, y },
  type: 'shockwave' | 'explosion' | 'pulse',
  duration: 400,                          // ms
  startTime: Date.now(),
  radius: { start: 0, end: 60 },
  opacity: { start: 0.8, end: 0 },
  color: 'rgba(...)',
}
```

### Highlight Object

```javascript
{
  id: 'highlight-1',
  pos: { x, y },
  radius: 40,
  intensity: 0.8,
  type: 'glow' | 'spotlight' | 'aura',
  color: 'rgba(...)',
  animated: true,
}
```

### Label Object

```javascript
{
  id: 'label-star-1',
  text: 'Proxima Centauri',
  pos: { x, y },
  offsetX: 10,
  offsetY: -20,
  fontSize: 14,
  animated: true,
  timestamp: Date.now(),
  lifespan: 3000,                         // ms (auto-delete if exceeded)
  style: {
    fill: 'rgba(255, 255, 255, 0.9)',
    background: 'rgba(0, 0, 0, 0.3)',
    padding: 4,
    borderRadius: 4,
  },
}
```

---

## Rendering Pipeline

### Frame Update Cycle

```javascript
function renderFrame() {
  // WebGPU 3D render
  renderGalaxy3D();
  
  // 2D overlay render
  const deltaMs = Date.now() - lastFrameTime;
  animationController.update(deltaMs);           // Update all animations
  
  _overlayCtx.clearRect(...);                    // Clear canvas
  
  // Render each overlay type
  _renderClusters();
  _renderGates();
  _renderTradeRoutes();
  _renderFleets();
  _renderNodes();
  _renderTrajectories();                         // NEW
  _renderSelectionOverlay();                     // NEW
  _renderImpactEffects();                        // NEW
  _renderHighlights();                           // NEW
  _renderLabels();                               // NEW
  _renderParticles();                            // NEW
}
```

### Animation Update Flow

1. **Controller.update(deltaMs)**
   - For each animation in map:
     - Call animation.update()
     - Check if completed
     - If completed: remove from map, call onComplete callback

2. **Animation.update()**
   - Compute elapsed time since startTime
   - Calculate progress [0, 1]
   - Apply easing function
   - Call onUpdate callback with eased progress
   - Set completed flag if progress >= 1

3. **PropertyTween.update()** (extends Animation)
   - Get eased progress from parent
   - For each property in `to`:
     - Interpolate: `value = from + (to - from) * easedProgress`
     - Update target object

---

## Public API

### Selection API

```javascript
renderer.setSelection(selections)        // Replace all
renderer.addSelection(id, obj)           // Add/update one
renderer.removeSelection(id)             // Remove one
renderer.clearSelections()               // Remove all
```

### Trajectory API

```javascript
renderer.setTrajectories(trajectories)   // Replace all
renderer.addTrajectory(id, obj)          // Add/update one
renderer.removeTrajectory(id)            // Remove one
```

### Impact & Effect API

```javascript
renderer.setImpactEffects(effects)       // Replace all
renderer.addImpactEffect(id, obj)        // Add one (auto-adds startTime)
renderer.setHighlights(highlights)       // Replace all
renderer.addHighlight(id, obj)           // Add/update one
```

### Label API

```javascript
renderer.setLabels(labels)               // Replace all
renderer.addLabel(id, obj)               // Add one (auto-adds timestamp)
```

### Animation Controller Access

```javascript
const controller = renderer.getAnimationController();
const tween = new CanvasAnimationEngine.PropertyTween({...});
controller.addAnimation(tween);
```

### Trajectory Renderer Access

```javascript
const trajectoryRenderer = renderer.getTrajectoryRenderer();
const pos = trajectoryRenderer.interpolatePosition(trajectory, 0.5);
```

---

## Performance Considerations

### Current Optimizations (Phase 1-5)

1. **Animation Auto-Cleanup**
   - Completed animations removed from controller automatically
   - No manual garbage collection needed

2. **Canvas Pooling**
   - Single overlay canvas reused per frame
   - No canvas creation/destruction overhead

3. **Pointer Events Disabled**
   - `pointer-events: none` on overlay
   - All mouse events pass through to 3D renderer

4. **Segment Caching** (Trajectory)
   - Bézier curve points cached by ID
   - Recomputed only when trajectory config changes

### Recommended Optimizations (Phase 6-7)

1. **Canvas Layer Separation**
   - Separate layers for static vs. dynamic content
   - Render static once, reuse for multiple frames

2. **Bounding-Box Culling**
   - Check viewport bounds before rendering
   - Skip off-screen overlays

3. **Memory Pooling**
   - Pre-allocate animation objects in object pool
   - Reduce GC pressure

4. **WebWorker Support** (Future)
   - Offload trajectory interpolation to worker
   - Parallelize animation updates

---

## Future Enhancements

### Phase 6: Performance (Planned)

- [ ] Multi-layer canvas system (background, dynamic, UI)
- [ ] Viewport-aware culling
- [ ] Object pooling for animations
- [ ] WebWorker integration for trajectory math
- [ ] GPU-accelerated particle system

### Phase 7: Testing & Docs (Planned)

- [ ] Unit tests for easing functions ✓
- [ ] Integration tests for animation composition ✓
- [ ] Trajectory interpolation benchmarks
- [ ] E2E tests with Playwright
- [ ] Performance profiling & optimization guide
- [ ] Example usage gallery

### Phase 8+: Extended Features (Future)

- [ ] 3D billboard overlays (rendered in WebGPU)
- [ ] Bezier editor UI
- [ ] Animation timeline editor
- [ ] Export/import trajectory data
- [ ] Physics-based trajectory solver (drag, gravity)
- [ ] Audio sync for animations
- [ ] VFX compositor (blend modes, filters)

---

## Usage Examples

### Example 1: Pulsing Selection Ring

```javascript
renderer.addSelection('star-5', {
  type: 'star',
  pos: { x: 500, y: 300 },
  radius: 30,
  color: 'rgba(100, 200, 255, 0.8)',
  style: 'pulsing',
  animated: true,
  animation: { type: 'pulse', speed: 1.0 },
});
```

### Example 2: Fleet Trajectory Animation

```javascript
const trajectory = {
  points: [{ x: 100, y: 200 }, { x: 500, y: 300 }],
  type: 'linear',
  currentProgress: 0.3,  // 30% along path
  style: {
    trailColor: 'rgba(120, 255, 215, 0.6)',
    headColor: 'rgba(120, 255, 215, 1)',
    glowWidth: 8,
  },
  showTrail: true,
  showHead: true,
  animated: true,
};
renderer.addTrajectory('fleet-1-move', trajectory);
```

### Example 3: Animated Label

```javascript
renderer.addLabel('notification-1', {
  text: 'Fleet arrived!',
  pos: { x: 300, y: 200 },
  offsetY: -30,
  fontSize: 16,
  animated: true,
  lifespan: 3000,  // Auto-remove after 3 seconds
  style: {
    fill: 'rgba(255, 200, 100, 0.9)',
    background: 'rgba(0, 0, 0, 0.3)',
    padding: 6,
    borderRadius: 4,
  },
});
```

### Example 4: Custom Animation Sequence

```javascript
const controller = renderer.getAnimationController();

const fadeIn = new CanvasAnimationEngine.PropertyTween({
  target: { opacity: 0 },
  to: { opacity: 1 },
  duration: 300,
  easing: 'easeOutQuad',
});

const slideIn = new CanvasAnimationEngine.PropertyTween({
  target: { x: 0 },
  to: { x: 100 },
  duration: 300,
  easing: 'easeOutQuad',
});

const sequence = new CanvasAnimationEngine.SequenceAnimation({
  animations: [slideIn, fadeIn],
  delayMs: 100,
});

controller.addAnimation(sequence);
```

---

## References

- **Animation Timing:** https://drafts.csswg.org/web-animations/
- **Easing Functions:** https://easings.net/
- **Bézier Curves:** https://en.wikipedia.org/wiki/Bézier_curve
- **Orbital Mechanics:** https://en.wikipedia.org/wiki/Kepler%27s_laws_of_planetary_motion
- **Canvas 2D:** https://html.spec.whatwg.org/multipage/canvas.html

---

**Maintained by:** makr-code  
**License:** MIT  
