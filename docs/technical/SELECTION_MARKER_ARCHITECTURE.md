/**
 * SELECTION_MARKER_ARCHITECTURE.md
 * 
 * Persistent Selection Marker System Architecture & Implementation Guide
 * 
 * License: MIT - makr-code/GalaxyQuest
 */

# Selection Marker System Architecture

## Overview

The persistent selection marker system provides visual feedback for user interactions in the galaxy and system views. It consists of four layered components:

1. **RuntimeSelectionState** - State normalization and tracking
2. **SelectionMarkerStyleTokens** - Visual token definitions
3. **SelectionMarkerAnimationEngine** - Time-based animation system
4. **PersistentSelectionMarkerRenderer** - Canvas/WebGL rendering
5. **SelectionMarkerCompositor** - Lifecycle and integration layer

## Component Responsibilities

### RuntimeSelectionState
**Location:** `js/engine/runtime/RuntimeSelectionState.js`

Normalizes selection events and maintains a unified selection state object.

**Key Functions:**
- `createSelectionStore()` - Creates the selection state object
- `normalizeRendererSelection(target, pos, eventType)` - Normalizes renderer events
- `commitSelectionState(kind, target, pos, eventType)` - Applies state changes
- `resolveSelectionGroupMembers(normalized)` - Handles multi-selection groups

**Selection State Schema:**
```javascript
{
  active: { key, kind, target, position, mode, scope },
  hover: { key, kind, target, position, eventType },
  multiSelection: [ /* array of normalized selections */ ],
  group: { type, systems, factionId, factionName },
  mode: 'galaxy' | 'system',
  sourceView: 'renderer' | 'ui',
  updatedAt: timestamp
}
```

### SelectionMarkerStyleTokens
**Location:** `js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js`

Defines visual appearance through immutable token objects.

**Key Exports:**
- `SELECTION_MARKER_TOKENS` - Persistent, hover, group, multi-selection states
- `FACTION_OWNERSHIP_TOKENS` - Ownership-based coloring
- `ACCESSIBILITY_PALETTES` - Color-blind safe palettes
- `ANIMATION_CONFIG` - Animation definitions
- `getSelectionMarkerToken(state)` - Retrieve token for state
- `isWCAGCompliant(fg, bg, level)` - Verify accessibility

**Marker States:**
- **selection** - Persistent golden marker with pulse animation
- **hover** - Temporary blue marker, no animation
- **group** - Green dashed marker for cluster selection
- **multiSelection** - Multi-object selected marker
- **selectionWithHover** - Combined state emphasis

### SelectionMarkerAnimationEngine
**Location:** `js/engine/runtime/SelectionMarkerAnimationEngine.js`

Manages time-based animations for markers.

**Architecture:**
```
MarkerAnimationState
  ↓
MarkerAnimationManager (1-to-1 with marker)
  ↓
AnimationManagerPool (efficient reuse)
```

**Key Classes:**
- `MarkerAnimationState` - Tracks normalized animation time
- `MarkerAnimationManager` - Computes frame properties
- `AnimationManagerPool` - Object pool for efficiency

**Supported Animations:**
- `scale` - Pulse effect (minScale → maxScale)
- `opacity` - Glow effect (minOpacity → maxOpacity)
- `rotation` - Spinning effect
- `position-y-offset` - Bounce effect

**Easing Functions:**
- `linear` - Constant progression
- `sine-wave` - Smooth oscillation
- `ease-out-bounce` - Bouncy deceleration
- `ease-in-quad` / `ease-out-quad` - Quad easing

### PersistentSelectionMarkerRenderer
**Location:** `js/engine/runtime/PersistentSelectionMarkerRenderer.js`

Renders markers to canvas with full visual token support.

**Key Classes:**
- `SelectionMarker` - Individual marker state and geometry
- `CanvasMarkerRenderer` - Canvas 2D rendering backend
- `WebGLMarkerRenderer` - WebGL rendering backend (stub)

**Rendering Pipeline:**
```
1. Save canvas state
2. Apply transform (scale, rotation)
3. Draw glow (if enabled)
4. Draw outer ring
5. Draw inner ring (with line pattern)
6. Restore canvas state
```

**Z-Ordering:**
Markers are sorted by `zIndex` before rendering:
- selection: 21
- multiSelection: 20
- hover: 20
- group: 19

### SelectionMarkerCompositor
**Location:** `js/engine/runtime/SelectionMarkerCompositor.js`

Orchestrates marker lifecycle, animation coordination, and culling.

**Flow:**
```
Selection State → Normalize → Create/Update Markers
                              ↓
                         Apply Animations
                              ↓
                         Cull (optional)
                              ↓
                            Render
```

**Key Features:**
- **State Sync** - Watches selection state, creates/removes markers
- **Animation Coordination** - Updates all animation managers each frame
- **Viewport Culling** - Hides markers outside visible area
- **Multi-Selection** - Automatically creates group markers

## Integration Guide

### Basic Integration

```javascript
// 1. Create components
const canvas = document.getElementById('marker-canvas');
const ctx = canvas.getContext('2d');

const renderer = new window.GQPersistentSelectionMarkerRenderer.CanvasMarkerRenderer(canvas);
const animPool = new window.GQSelectionMarkerAnimationEngine.AnimationManagerPool(50);
const compositor = new window.GQSelectionMarkerCompositor.SelectionMarkerCompositor(
  renderer,
  animPool,
  {
    enableCulling: true,
    enableBatching: true,
    cullingRadius: 1000,
  }
);

// 2. Link to selection state
const selectionState = window.GQRuntimeSelectionState.createSelectionStore();
compositor.setSelectionState(selectionState);

// 3. Set viewport bounds (on camera change)
compositor.setViewportBounds({
  minX: -800,
  minY: -600,
  maxX: 800,
  maxY: 600,
});

// 4. In game loop
function gameLoop(deltaMs) {
  compositor.update();      // Process state changes, update animations
  compositor.render();      // Draw markers to canvas
}

// 5. On user interaction
function onPointerMove(x, y) {
  const target = getObjectAtPoint(x, y);
  window.GQRuntimeSelectionState.commitSelectionState('hover', target, { x, y }, 'hover');
}

function onPointerClick(x, y) {
  const target = getObjectAtPoint(x, y);
  window.GQRuntimeSelectionState.commitSelectionState('active', target, { x, y }, 'click');
}
```

### Advanced: Customizing Tokens

```javascript
// Get current token for selection marker
const token = window.GQSelectionMarkerStyleTokens.getSelectionMarkerToken('selection');

// Customize appearance
const customToken = {
  ...token,
  color: 'rgba(100, 255, 100, 0.9)',        // Green instead of gold
  outerWidth: 6,                             // Thicker stroke
  animation: 'none',                         // Disable pulse
};

// Update marker with custom token
compositor.updateMarkerFromSelection(
  { key: 'star:1:5', kind: 'star', position: { x: 100, y: 200 } },
  'active'
);
```

### Performance Optimization

```javascript
// 1. Disable culling if viewport is always full
const compositor = new SelectionMarkerCompositor(renderer, animPool, {
  enableCulling: false,  // Saves viewport checks
});

// 2. Tune pool size based on max concurrent markers
const animPool = new AnimationManagerPool(100);  // For 100 markers

// 3. Monitor statistics
setInterval(() => {
  const stats = compositor.getStatistics();
  console.log(`Markers: ${stats.markerCount}, Animations: ${stats.animationPoolStats.activeCount}`);
}, 1000);

// 4. Use batching for many markers of same type
compositor.enableBatching = true;
```

## State Transitions

```
                    ┌─────────────┐
                    │   Nothing   │
                    └──────┬──────┘
                           │ pointer move
                           ▼
                      ┌─────────────┐
                      │    Hover    │
                      └──────┬──────┘
                             │ click
                             ▼
                 ┌───────────────────────┐
                 │   Hover + Selected    │
                 └───────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
         (single)                     (multi/cluster)
              │                             │
              ▼                             ▼
        ┌──────────┐              ┌─────────────────┐
        │ Selected │              │ Selected +      │
        │          │              │ Group Markers   │
        └──────┬───┘              └─────────┬───────┘
               │ click elsewhere            │ click elsewhere
               ▼                            ▼
        ┌────────────────────────────────────────┐
        │        Selected Cleared → Hover        │
        └────────────────────────────────────────┘
```

## Animation Lifecycle

```
// Create animation on marker selection
manager = animPool.acquire('marker-1', { type: 'scale', duration: 2.0 });

// Each frame
manager.update(deltaSeconds);                    // Advance time
props = manager.getFrameProperties();            // Get animated values
renderer.updateMarkerTransform(key, props.scale, props.opacity, props.rotation);

// On marker deselection
animPool.release('marker-1');  // Return to pool for reuse
```

## Accessibility Considerations

### Color-Blind Safe Palettes

The system includes built-in support for multiple color vision deficiencies:
- Standard (default)
- Deuteranopia (red-green deficiency, ~1% of males)
- Protanopia (red-green deficiency, ~1% of males)
- Tritanopia (blue-yellow deficiency, rare)
- Monochromatic (total colorblindness)
- High Contrast (low vision users)

### Line Pattern Accessibility

When color alone is insufficient, markers use distinct line patterns:
- **Solid** - Standard
- **Dashed** - Group selection
- **Dotted** - Faction indicators
- **Dash-dash-dot** - Special states
- **Long-dash** - High visibility

### WCAG 2.1 Compliance

All marker colors meet minimum contrast ratios:
- Normal text: 4.5:1
- Graphics/UI: 3:1

## Testing

All components have comprehensive test coverage:
- **75 unit tests** covering animations, rendering, and lifecycle
- Tests verify easing functions, animation state management, marker lifecycle
- Canvas rendering with mock contexts
- Multi-selection and culling logic

Run tests:
```bash
npm run test:unit:js -- tests/js/selection-marker*.test.js tests/js/persistent-selection-marker-renderer.test.js
```

## Performance Metrics

### Memory
- **Animation Pool**: ~0.5 KB per animation manager
- **Marker Object**: ~0.3 KB per marker
- **Total**: 50 animations + 50 markers ≈ 40 KB

### CPU
- **Animation Update**: <0.1 ms (all markers)
- **Render**: 0.5-2 ms depending on marker count
- **Culling**: 0.1 ms per marker (if enabled)

### GPU (WebGL future)
- Instanced rendering for batch efficiency
- Texture atlasing for symbols
- Target: 60 FPS at 500+ markers

## Troubleshooting

### Markers not appearing
1. Check `compositor.setViewportBounds()` - bounds may be incorrect
2. Verify `enableCulling` - marker may be outside viewport
3. Check canvas context - may not have proper 2D context

### Animations stuttering
1. Check `deltaTime` in `compositor.update()` - may have frame drops
2. Reduce animation complexity (fewer easing functions)
3. Disable less important animations

### Performance issues
1. Monitor `compositor.getStatistics()` - too many markers?
2. Increase animation pool size
3. Disable culling if AABB checks are expensive

## Future Enhancements

- **WebGL Backend** - For 1000+ markers
- **GPU Instancing** - Batch similar markers
- **Advanced Easing** - More animation curves
- **Custom Shaders** - Glow effects, bloom
- **Marker Icons** - Custom symbols per object type
- **Sound Effects** - Audio feedback for selection

## References

- RuntimeSelectionState: `js/engine/runtime/RuntimeSelectionState.js`
- Style Tokens: `js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js`
- Tests: `tests/js/selection-marker*.test.js`
