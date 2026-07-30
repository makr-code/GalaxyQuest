/**
 * SELECTION_MARKER_QUICK_START.md
 * 
 * Quick start guide for the persistent selection marker system
 * 
 * License: MIT - makr-code/GalaxyQuest
 */

# Selection Marker System - Quick Start

## 30-Second Setup

```javascript
// 1. Create components
const renderer = new GQPersistentSelectionMarkerRenderer.CanvasMarkerRenderer(canvas);
const animPool = new GQSelectionMarkerAnimationEngine.AnimationManagerPool(50);
const compositor = new GQSelectionMarkerCompositor.SelectionMarkerCompositor(renderer, animPool);

// 2. Setup selection state
const selectionState = GQRuntimeSelectionState.createSelectionStore();
compositor.setSelectionState(selectionState);

// 3. Each frame
compositor.update();      // Process animations
compositor.render();      // Draw markers

// 4. On user interaction
GQRuntimeSelectionState.commitSelectionState('active', target, position, 'click');
```

## Common Tasks

### Add a Persistent Selection Marker

```javascript
// User clicks on a star
const star = { __kind: 'star', galaxy_index: 1, system_index: 5 };
const position = { x: 100, y: 200 };

GQRuntimeSelectionState.commitSelectionState('active', star, position, 'click');
// Marker automatically appears at (100, 200) with golden color and pulse animation
```

### Show Hover Effect

```javascript
// User moves mouse over a planet
const planet = { __kind: 'planet', id: 3, __sourceStar: { galaxy_index: 1, system_index: 5 } };
const position = { x: 150, y: 180 };

GQRuntimeSelectionState.commitSelectionState('hover', planet, position, 'hover');
// Blue marker appears, disappears when mouse leaves
```

### Multi-Selection (Fleet Selection)

```javascript
// User selects multiple stars (cluster)
const cluster = {
  __kind: 'cluster',
  __clusterIndex: 2,
  __clusterSystems: [3, 5, 7],
  faction: { id: 1 }
};

GQRuntimeSelectionState.commitSelectionState('active', cluster, position, 'click');
// System automatically creates 3 green dashed group markers for each star
```

### Clear Selection

```javascript
// User clicks empty space
GQRuntimeSelectionState.commitSelectionState('active', null, null, 'click');
// All selection markers disappear
```

### Customize Marker Appearance

```javascript
// Get token for selection marker
const token = GQSelectionMarkerStyleTokens.getSelectionMarkerToken('selection');

// Customize
const customToken = {
  ...token,
  outerWidth: 6,      // Thicker stroke
  color: 'rgba(0, 255, 0, 0.9)',  // Green instead of gold
  animation: 'none',  // No pulse
};

// Use it when creating marker
compositor.renderer.addMarker('marker-1', 'star', position, customToken, {});
```

### Set Viewport for Culling

```javascript
// Called when camera pans/zooms
compositor.setViewportBounds({
  minX: camera.left,
  minY: camera.top,
  maxX: camera.right,
  maxY: camera.bottom,
});
// Markers outside bounds are hidden (performance optimization)
```

### Monitor Performance

```javascript
// In debug panel
setInterval(() => {
  const stats = compositor.getStatistics();
  console.log(`
    Active Markers: ${stats.markerCount}
    Animated: ${stats.animationPoolStats.activeCount}
    Frame Time: ${stats.deltaTime.toFixed(2)}ms
  `);
}, 1000);
```

## Visual States

| State | Color | Animation | Use Case |
|-------|-------|-----------|----------|
| **selection** | Golden | Pulse | Active selection |
| **hover** | Blue | None | Mouse over |
| **group** | Green | Subtle pulse | Multi-selection |
| **multiSelection** | Light blue | Pulse | Multiple objects |
| **selectionWithHover** | Orange | Fast pulse | Selection + hover |

## Animation Types

| Animation | Effect | Duration | Use Case |
|-----------|--------|----------|----------|
| **pulse** | Scale oscillation | 2.0s | Selection highlight |
| **subtle-pulse** | Gentle pulse | 3.0s | Group selection |
| **glow** | Opacity oscillation | 1.5s | Emphasis |
| **bounce** | Vertical bounce | 0.5s | Popup effect |
| **rotate** | Continuous spin | 4.0s | Loading state |
| **none** | No animation | — | Hover (temporary) |

## Accessibility

### Color-Blind Safe Rendering

```javascript
// System automatically uses patterns when colors aren't enough
const token = GQSelectionMarkerStyleTokens.getSelectionMarkerToken('group');
// linePattern: 'dashed' ← helps color-blind users

// Supported patterns:
// 'solid', 'dashed', 'dotted', 'dot-dash', 'dash-dash-dot', 'long-dash'
```

### High Contrast Mode

```javascript
// Switch to high-contrast palette for low-vision users
const palette = GQSelectionMarkerStyleTokens.getAccessibilityPalette('highContrast');
// Uses pure black/white for maximum contrast
```

## Easing Functions

```javascript
// Used in animations, selectable per marker
const easingOptions = {
  'linear': linear progression,
  'sine-wave': smooth oscillation (default),
  'ease-out-bounce': bouncy deceleration,
  'ease-in-quad': accelerating start,
  'ease-out-quad': decelerating end,
};
```

## Event Flow

```
User Action
    ↓
Pointer Event
    ↓
commitSelectionState()
    ↓
Selection State Updated
    ↓
Compositor.update()  ← detects state change
    ↓
Create/Remove Markers + Update Animations
    ↓
Compositor.render()
    ↓
Markers drawn to canvas
```

## Debugging

### Enable Debug Logging

```javascript
// Monkey-patch to log state changes
const original = GQRuntimeSelectionState.commitSelectionState;
GQRuntimeSelectionState.commitSelectionState = function(...args) {
  console.log('Selection changed:', args);
  return original.apply(this, args);
};
```

### Visualize Marker Info

```javascript
// In your debug panel
const marker = renderer.getMarker('star:1:5');
console.log({
  key: marker.key,
  position: marker.position,
  opacity: marker.opacity,
  scale: marker.scale,
  isVisible: marker.isVisible,
});
```

### Check WCAG Compliance

```javascript
const token = GQSelectionMarkerStyleTokens.getSelectionMarkerToken('selection');
const isCompliant = GQSelectionMarkerStyleTokens.isWCAGCompliant(
  token.outerStroke,  // foreground
  '#000000',          // background
  'graphics'          // level
);
console.log('WCAG Compliant:', isCompliant);
```

## Performance Tips

1. **Use viewport culling** - Hide markers outside visible area
2. **Reuse animation pool** - Pre-allocate enough managers
3. **Disable glow for many markers** - Reduces fill operations
4. **Batch similar markers** - Group by token for efficient rendering
5. **Monitor FPS** - Use `compositor.getStatistics()` to track

## Troubleshooting

### Markers not visible
- Check canvas is in DOM and has size
- Verify `compositor.setViewportBounds()` includes marker positions
- Check `enableCulling` flag

### Animations not smooth
- Check `deltaTime` passed to `update()`
- Verify animation pool has enough capacity
- Reduce animation complexity

### Performance issues
- Monitor marker count with `getStatistics()`
- Disable culling if AABB checks are expensive
- Use WebGL renderer (when available) for 1000+ markers

## API Reference

### Core Classes

```
SelectionMarkerCompositor {
  setSelectionState(state)
  setViewportBounds(bounds)
  update()
  render()
  clear()
  getStatistics()
}

CanvasMarkerRenderer {
  addMarker(key, kind, position, token, config)
  removeMarker(key)
  getMarker(key)
  updateMarkerPosition(key, x, y)
  updateMarkerTransform(key, scale, opacity, rotation)
  render()
}

AnimationManagerPool {
  acquire(key, config)
  release(key)
  updateAll(deltaMs)
  getStatistics()
}
```

### Selection State

```javascript
{
  active: Selection | null,           // Currently selected
  hover: Selection | null,            // Under mouse
  multiSelection: Selection[],        // Group selection
  group: { type, systems, ... },      // Group metadata
  mode: 'galaxy' | 'system',          // Current mode
  sourceView: 'renderer' | 'ui',      // Who made change
  updatedAt: timestamp,               // Last update
}
```

## Next Steps

1. See `SELECTION_MARKER_ARCHITECTURE.md` for detailed design
2. Check `SelectionMarkerIntegrationExample.js` for complete example
3. Run tests: `npm run test:unit:js -- tests/js/selection-marker*.test.js`
4. Review existing selection state in `RuntimeSelectionState.js`
