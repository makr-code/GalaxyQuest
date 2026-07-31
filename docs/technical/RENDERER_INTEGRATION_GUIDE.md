/**
 * RENDERER_INTEGRATION_GUIDE.md
 *
 * Complete guide for integrating SelectionMarkerOverlay into Galaxy and related renderers.
 * This document covers the Galaxy WebGPU pilot implementation and provides patterns
 * for rolling out to other renderers (Galaxy Three.js, System, Approach, Colony).
 *
 * Status: Phase Renderer Integration - Pilot (Galaxy WebGPU)
 * Created: 2026-07-31
 */

# Renderer Integration Guide: Selection Markers (Phase 3)

## Overview

This guide provides step-by-step instructions for integrating the SelectionMarkerOverlay
into all renderers. The Galaxy WebGPU renderer is the pilot, and the patterns shown here
should be replicated for Three.js and other views.

## Architecture

```
Galaxy3DRendererWebGPU (or other renderer)
    ↓
_overlayCanvas (2D canvas layer)
    ↓
SelectionMarkerOverlay (wrapper)
    ├── PersistentSelectionMarkerRenderer (draws markers)
    ├── SelectionMarkerAnimationEngine (coordinates animations)
    └── SelectionMarkerCompositor (manages lifecycle & state)
    ↓
RuntimeSelectionState (global event dispatcher)
```

## File Structure

New files created:
- `js/engine/runtime/SelectionMarkerOverlay.js` - Main integration wrapper
- `js/rendering/Galaxy3DRendererWebGPU-SelectionMarkerIntegration.mixin.js` - Renderer mixin
- `js/rendering/GalaxyRendererBootstrap-SelectionMarkers.js` - Bootstrap/initialization
- `tests/js/galaxy-renderer-selection-marker-integration.test.js` - Integration tests

Existing infrastructure (pre-created, ready to use):
- `js/engine/runtime/RuntimeSelectionState.js`
- `js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js`
- `js/engine/runtime/PersistentSelectionMarkerRenderer.js`
- `js/engine/runtime/SelectionMarkerAnimationEngine.js`
- `js/engine/runtime/SelectionMarkerCompositor.js`

## Integration Steps

### Step 1: Include Required Scripts

Add to your HTML in this order:

```html
<!-- Core renderer -->
<script src="js/rendering/Galaxy3DRendererWebGPU.js"></script>

<!-- Selection marker infrastructure (pre-existing) -->
<script src="js/engine/runtime/RuntimeSelectionState.js"></script>
<script src="js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js"></script>
<script src="js/engine/runtime/PersistentSelectionMarkerRenderer.js"></script>
<script src="js/engine/runtime/SelectionMarkerAnimationEngine.js"></script>
<script src="js/engine/runtime/SelectionMarkerCompositor.js"></script>

<!-- New integration layer -->
<script src="js/engine/runtime/SelectionMarkerOverlay.js"></script>
<script src="js/rendering/Galaxy3DRendererWebGPU-SelectionMarkerIntegration.mixin.js"></script>

<!-- Bootstrap (applies integration automatically) -->
<script src="js/rendering/GalaxyRendererBootstrap-SelectionMarkers.js"></script>
```

### Step 2: Verify Dependencies (for Non-Bootstrap Initialization)

If you're not using the bootstrap, manually verify dependencies:

```javascript
// Check all required modules are loaded
const requiredModules = {
  'SelectionMarkerOverlay': window.GQSelectionMarkerOverlay,
  'RuntimeSelectionState': window.GQRuntimeSelectionState,
  'SelectionMarkerStyleTokens': window.GQSelectionMarkerStyleTokens,
  'PersistentSelectionMarkerRenderer': window.GQPersistentSelectionMarkerRenderer,
  'SelectionMarkerCompositor': window.GQSelectionMarkerCompositor,
  'SelectionMarkerAnimationEngine': window.GQSelectionMarkerAnimationEngine,
};

for (const [name, module] of Object.entries(requiredModules)) {
  if (!module) {
    console.error(`Missing required module: ${name}`);
    throw new Error(`Selection marker integration failed: ${name} not available`);
  }
}
```

### Step 3: Instantiate and Integrate (Manual Path)

If not using bootstrap:

```javascript
// Create renderer
const renderer = new Galaxy3DRendererWebGPU(container, {
  onHover: (star, position) => {
    // Handle hover...
  },
  onClick: (payload, position) => {
    // Handle selection...
  },
});

// Apply integration mixin
window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration.apply(renderer);

// Initialize renderer
await renderer.init();

// Selection markers are now active!
```

### Step 4: Bootstrap Path (Recommended)

The bootstrap file automatically applies integration:

```javascript
// After all scripts load, this happens automatically:
// 1. Galaxy3DRendererWebGPU constructor is patched
// 2. New instances automatically get integration applied
// 3. Event listeners registered for dynamic creation

const renderer = new Galaxy3DRendererWebGPU(container, options);
// Integration is already applied!
await renderer.init();
```

## How It Works

### Initialization Flow

```
1. Galaxy3DRendererWebGPU constructor
   ↓
2. Integration mixin wraps methods
   - _initializeSelectionMarkers() at init()
   - _setupSelectionMarkerEventHandlers() at _attachInteraction()
   - _renderSelectionMarkers() at _renderGalaxyOverlay2D()
   - _disposeSelectionMarkers() at dispose()
   ↓
3. SelectionMarkerOverlay created
   - PersistentSelectionMarkerRenderer
   - AnimationManagerPool
   - SelectionMarkerCompositor
   ↓
4. Event listeners registered
   - GQ:selection:state-changed
   - mouseout on canvas
   ↓
5. Ready to render!
```

### Event Flow

```
User Action (hover/click)
    ↓
Renderer's input handler (onPointerMove/onClick)
    ↓
SelectionMarkerOverlay.handleHover/Click/PointerOut()
    ↓
window.GQRuntimeSelectionState.commitSelectionState()
    ↓
Dispatch GQ:selection:state-changed event
    ↓
SelectionMarkerOverlay listens and updates
    ↓
PersistentSelectionMarkerRenderer renders markers
    ↓
Animation pool updates animations each frame
```

### Rendering Loop

```
renderer._renderGalaxyOverlay2D()
    ├── Original overlay rendering (trajectories, highlights, labels, etc.)
    └── SelectionMarkerOverlay.render(deltaTime)
        ├── animationPool.updateAll(deltaTime)
        └── markerRenderer.render()
```

## Configuration Options

### SelectionMarkerOverlay Constructor

```javascript
const overlay = new SelectionMarkerOverlay(canvas, {
  // Visual parameters
  baseRadius: 20,              // Base marker radius in pixels
  enableGlow: true,            // Enable glow effect
  glowBlur: 8,                 // Glow blur radius

  // Performance parameters
  enableCulling: true,         // Enable viewport culling
  cullingRadius: 1000,         // Culling search radius (pixels)
  viewMatrix: viewMatrix,      // View transformation for culling

  // Future extension points
  enableAnimations: true,      // Enable marker animations
  enableAccessibility: true,   // Enable accessibility patterns
});
```

### Per-Renderer Configuration

**Galaxy WebGPU:**
```javascript
baseRadius: 20,
enableGlow: true,
glowBlur: 8,
enableCulling: true,
cullingRadius: 1000,
```

**Galaxy Three.js:**
```javascript
baseRadius: 20,
enableGlow: true,
glowBlur: 8,
enableCulling: true,
cullingRadius: 1500,  // Larger for 3D view
```

**System View:**
```javascript
baseRadius: 25,      // Larger for closer view
enableGlow: true,
glowBlur: 10,
enableCulling: true,
cullingRadius: 2000,
```

**Approach View:**
```javascript
baseRadius: 30,      // Even larger for close-up
enableGlow: true,
glowBlur: 12,
enableCulling: false, // No culling at this scale
```

**Colony View:**
```javascript
baseRadius: 35,      // Largest for surface detail
enableGlow: false,   // Disable glow for clarity
glowBlur: 0,
enableCulling: false,
```

## Testing

### Unit Tests

Run the integration tests:

```bash
npm run test:unit:js -- galaxy-renderer-selection-marker-integration.test.js
```

Tests verify:
- ✅ Overlay initialization with valid canvas
- ✅ Component creation (renderer, pool, compositor)
- ✅ Event handling (hover, click, pointerout)
- ✅ Selection state updates
- ✅ Marker rendering
- ✅ Lifecycle (initialization, disposal)
- ✅ Integration mixin application

### E2E Tests (Future)

```bash
npm run test:e2e:renderer-selection-markers -- \
  --project=chromium \
  --reporter=line
```

Should verify:
- [ ] Markers appear on hover
- [ ] Markers change on click
- [ ] Markers disappear on pointerout
- [ ] Performance: 60+ FPS with markers enabled
- [ ] No visual artifacts

### Manual Testing

1. Open Galaxy view
2. Hover over a star → Blue marker appears
3. Click on a star → Marker becomes golden
4. Move away → Marker disappears
5. Open DevTools (F12) → Console shows no errors

## Performance Targets

- **60 FPS minimum** with all markers enabled
- **<10ms overhead** per frame for marker rendering
- **Viewport culling** when >500 objects visible
- **Memory usage** <20MB for overlay infrastructure

## Troubleshooting

### Markers not appearing

```javascript
// Check overlay is initialized
console.log(renderer._selectionMarkerOverlay?.isInitialized);

// Check context is valid
console.log(renderer._overlayCanvas?.getContext('2d'));

// Check components exist
console.log(renderer._selectionMarkerOverlay?.markerRenderer);
```

### Event handlers not firing

```javascript
// Listen for selection state changes
window.addEventListener('GQ:selection:state-changed', (evt) => {
  console.log('Selection changed:', evt.detail.state);
});

// Manually trigger event
window.GQRuntimeSelectionState.commitSelectionState('hover', {id: 'test'}, {x: 100, y: 100}, 'manual-test');
```

### Performance issues

1. Increase `cullingRadius` to reduce render load
2. Disable `enableGlow` for performance
3. Reduce `baseRadius` for simpler geometry
4. Check for memory leaks: `renderer._selectionMarkerOverlay?.dispose()`

## Rollout Plan for Other Renderers

### Galaxy Three.js (`galaxy-renderer-core.js`)

1. Create mixin: `Galaxy3DRendererThreeJS-SelectionMarkerIntegration.mixin.js`
2. Adapt for Three.js rendering context
3. Apply same pattern: wrap init/render/dispose
4. Create integration tests
5. Bootstrap file (optional)

### System View (`system-view.js`)

1. Identify rendering context
2. Create mixin with same pattern
3. Integrate with existing event handlers
4. Test with 50+ planets
5. Validate performance

### Approach View (`approach-view.js`)

1. Similar to System View
2. Larger base radius (30+)
3. Test with planet rendering
4. Validate keyboard navigation prep

### Colony View (`colony-view.js`)

1. Adapt for surface slot rendering
2. Test with all building types
3. Validate accessibility patterns
4. Test touch interactions (44x44px targets)

## Next Steps (Phase 3+)

After Galaxy WebGPU pilot validation:

1. **Phase 3**: Group Selection
   - Extend `resolveSelectionGroupMembers()`
   - Ctrl/Shift multi-select UX
   - Group boundary markers

2. **Phase 4**: Ownership Visuals
   - Apply faction tokens
   - Stars with faction rings
   - Planets with badges

3. **Phase 5**: Accessibility
   - Keyboard navigation
   - Screen reader integration
   - Color-blind patterns

## Support & References

- Integration Guide: This document
- API Reference: `SelectionMarkerOverlay.js` (JSDoc)
- Test Examples: `galaxy-renderer-selection-marker-integration.test.js`
- Infrastructure Docs: `docs/technical/SELECTION_PHASE2_INTEGRATION_GUIDE.md`

## License

MIT - makr-code/GalaxyQuest
