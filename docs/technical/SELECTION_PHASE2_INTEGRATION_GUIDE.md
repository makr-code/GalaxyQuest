/**
 * docs/technical/SELECTION_PHASE2_INTEGRATION_GUIDE.md
 *
 * Phase 2: Integration Guide for Persistent Selection Markers
 * and Unified Ownership Visuals
 *
 * This guide provides concrete patterns for integrating the selection marker system
 * into Galaxy, System, Approach, and Colony renderers.
 *
 * Status: Active Development
 * Targets: Phase 2–4 of Selection UX Implementation
 */

# Phase 2–4 Selection UX Integration Guide

## Overview

Phase 2–4 of the Selection System requires integrating three components:

1. **Persistent Selection Markers** (Phase 2)
   - Marker lifecycle management
   - Independent hover/selection state tracking
   - Animation and rendering coordination

2. **Ownership Visual Consistency** (Phase 4)
   - Faction color tokens applied uniformly
   - Symbol/pattern accessibility support
   - Ring/badge/halo visual system

3. **Group Selection** (Phase 3)
   - Cluster to generalized group selection
   - Faction-based multi-selection
   - Multi-select UX (Ctrl/Shift)

---

## Part 1: Marker Integration Pattern

### 1.1 Initialization in Renderer

Every renderer (Galaxy, System, Approach, Colony) should follow this pattern:

```javascript
class MyViewRenderer {
  constructor(container, options = {}) {
    this.container = container;
    this.canvas = null;
    this.ctx = null;

    // Selection marker components
    this.markerRenderer = null;
    this.animationPool = null;
    this.compositor = null;
    this.selectionState = null;

    this.initialize();
  }

  initialize() {
    // Create canvas for markers (overlay layer)
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'selection-marker-overlay';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Initialize marker rendering pipeline
    this.markerRenderer = window.GQPersistentSelectionMarkerRenderer
      .createMarkerRenderer(this.ctx, {
        baseRadius: 20,
        enableGlow: true,
        glowBlur: 8,
      });

    // Initialize animation pool
    this.animationPool = new (window.GQSelectionMarkerAnimationEngine?.AnimationManagerPool)();

    // Initialize compositor
    this.compositor = new (window.GQSelectionMarkerCompositor?.SelectionMarkerCompositor)(
      this.markerRenderer,
      this.animationPool,
      {
        enableCulling: true,
        cullingRadius: 1000,
      }
    );

    // Link to global selection state
    window.addEventListener('GQ:selection:state-changed', (evt) => {
      if (evt.detail?.state) {
        this.updateMarkersFromSelectionState(evt.detail.state);
      }
    });
  }

  updateMarkersFromSelectionState(selectionState) {
    if (!this.compositor || !selectionState) return;

    // Clear old markers
    this.markerRenderer.clear();

    // Update persistent selection marker
    if (selectionState.active) {
      const token = window.GQSelectionMarkerStyleTokens
        .getSelectionMarkerToken('selection');
      this.compositor.updateMarkerFromSelection(selectionState.active, 'active', token);
    }

    // Update hover marker (temporary)
    if (selectionState.hover) {
      const token = window.GQSelectionMarkerStyleTokens
        .getSelectionMarkerToken('hover');
      this.compositor.updateMarkerFromSelection(selectionState.hover, 'hover', token);
    }

    // Update group marker if applicable
    if (selectionState.group && selectionState.multiSelection?.length > 1) {
      const token = window.GQSelectionMarkerStyleTokens
        .getSelectionMarkerToken('group');
      // Render group boundary marker (optional, based on view)
    }
  }

  render(deltaTime) {
    // Update animations
    if (this.animationPool) {
      this.animationPool.updateAll(deltaTime);
    }

    // Render markers
    if (this.markerRenderer) {
      this.markerRenderer.render();
    }
  }
}
```

### 1.2 Event Handling

Renderers must properly distinguish between hover and selection events:

```javascript
class MyViewRenderer {
  setupEventHandlers() {
    this.canvas.addEventListener('mousemove', (evt) => {
      const target = this.pickObjectAtPoint(evt.clientX, evt.clientY);
      if (target) {
        const normalized = window.GQRuntimeSelectionState
          .normalizeRendererSelection(target, { x: evt.clientX, y: evt.clientY }, 'hover');
        window.GQRuntimeSelectionState.commitSelectionState('hover', target, { x: evt.clientX, y: evt.clientY }, 'hover');
      }
    });

    this.canvas.addEventListener('mouseout', (evt) => {
      // CRITICAL: Clear hover but preserve selection
      window.GQRuntimeSelectionState.commitSelectionState('hover', null, null, 'pointerout');
    });

    this.canvas.addEventListener('click', (evt) => {
      const target = this.pickObjectAtPoint(evt.clientX, evt.clientY);
      if (target) {
        window.GQRuntimeSelectionState.commitSelectionState('active', target, { x: evt.clientX, y: evt.clientY }, 'click');
        this.showSelectionDetails(target);
      }
    });
  }
}
```

---

## Part 2: Ownership Visual Consistency

### 2.1 Applying Faction Colors

Each renderer should apply faction tokens consistently:

```javascript
class StarRenderer {
  renderStarWithOwnership(star, position) {
    const factionId = star.faction?.id || star.faction_id;
    const token = window.GQSelectionMarkerStyleTokens
      .getFactionOwnershipToken(factionId);

    // Draw star base
    this.drawStar(position, star);

    // Apply ownership ring
    this.drawOwnershipRing(
      position,
      token.primaryColor,
      token.secondaryColor,
      token.linePattern,
      token.symbol
    );

    // Add accessibility patterns
    this.drawAccessibilityPattern(position, token.colorBlindPattern);
  }

  drawOwnershipRing(position, primaryColor, secondaryColor, linePattern, symbol) {
    const ctx = this.ctx;
    ctx.save();

    // Outer ring (primary color)
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(position.x, position.y, 40, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring (secondary color with pattern)
    const dashPattern = window.GQSelectionMarkerStyleTokens.getLinePattern(linePattern);
    ctx.setLineDash(dashPattern);
    ctx.strokeStyle = secondaryColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(position.x, position.y, 35, 0, Math.PI * 2);
    ctx.stroke();

    // Symbol (for color-blind accessibility)
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = primaryColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, position.x, position.y - 45);

    ctx.restore();
  }

  drawAccessibilityPattern(position, pattern) {
    // For color-blind users, add texture/pattern
    // Implementation depends on canvas capabilities
    // Options: hatching, stippling, geometric patterns
  }
}
```

### 2.2 Viewport-Specific Application

**Galaxy View:** Stars with small ownership rings
```javascript
// Small ring for galaxy scale
const GALAXY_OWNERSHIP_RING_RADIUS = 8;
```

**System View:** Planets and stations with medium ownership rings
```javascript
// Medium rings for system scale
const SYSTEM_OWNERSHIP_RING_RADIUS = 15;

// Add aura for colonies
if (planet.is_colonized) {
  this.drawColonyAura(position, factionToken.primaryColor);
}
```

**Approach View:** Planets with prominent ownership badges
```javascript
// Larger rings for approach scale
const APPROACH_OWNERSHIP_BADGE_RADIUS = 30;

// Add faction label
this.drawFactionLabel(position, factionToken.name, factionToken.primaryColor);
```

**Colony View:** Surface with ownership markers per slot
```javascript
// Per-slot ownership marker
for (const slot of colony.slots) {
  const slotPosition = this.getSlotScreenPosition(slot);
  const slotFaction = slot.owner_faction;
  const slotToken = window.GQSelectionMarkerStyleTokens
    .getFactionOwnershipToken(slotFaction);
  
  this.drawSlotOwnershipMarker(slotPosition, slotToken);
}
```

---

## Part 3: Group Selection Implementation

### 3.1 Basic Cluster Selection

```javascript
class SelectionGroupHandler {
  static resolveGroupFromSelection(selectionState) {
    if (!selectionState?.target) return null;

    const target = selectionState.target;
    if (target.__kind === 'cluster') {
      // Cluster is already a group
      return window.GQRuntimeSelectionState
        .resolveSelectionGroupMembers(selectionState);
    }

    return {
      members: selectionState.target ? [selectionState.target] : [],
      group: null,
    };
  }

  static highlightGroupMembers(members) {
    for (const member of members) {
      // Highlight each member in group
      this.applyGroupHighlightStyle(member);
    }
  }

  static applyGroupHighlightStyle(member) {
    const token = window.GQSelectionMarkerStyleTokens
      .getSelectionMarkerToken('group');

    // Apply group marker to this member
    // Implementation depends on renderer
  }
}
```

### 3.2 Faction-Based Selection (Future Phase 3)

```javascript
class FactionSelectionHandler {
  static selectAllSystemsForFaction(factionId, galaxyData) {
    const systems = galaxyData.filter(star => 
      star.faction?.id === factionId || star.faction_id === factionId
    );

    return {
      members: systems.map(s => window.GQRuntimeSelectionState
        .normalizeRendererSelection(s, null, 'click')),
      group: {
        type: 'faction',
        systems: systems.map(s => s.system_index),
        factionId,
        factionName: systems[0]?.faction?.name || '',
      },
    };
  }
}
```

---

## Part 4: Accessibility Implementation

### 4.1 ARIA Live Regions for Selection Changes

```javascript
class AccessibilityManager {
  constructor(container) {
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.className = 'sr-only';
    container.appendChild(this.liveRegion);

    window.addEventListener('GQ:selection:state-changed', (evt) => {
      this.announceSelectionChange(evt.detail?.state);
    });
  }

  announceSelectionChange(state) {
    if (state?.active) {
      const label = this.buildAccessibilityLabel(state.active);
      this.liveRegion.textContent = `Selected: ${label}`;
    } else if (state?.hover) {
      const label = this.buildAccessibilityLabel(state.hover);
      this.liveRegion.textContent = `Hovering over: ${label}`;
    } else {
      this.liveRegion.textContent = 'Selection cleared';
    }
  }

  buildAccessibilityLabel(selection) {
    const kind = selection.kind || 'unknown';
    const token = window.GQSelectionMarkerStyleTokens
      .getFactionOwnershipToken(selection.target?.faction_id);

    return `${kind} ${token?.name || 'object'}`;
  }
}
```

### 4.2 Keyboard Navigation

```javascript
class KeyboardSelectionHandler {
  constructor(renderer) {
    this.renderer = renderer;
    this.currentSelectionIndex = 0;
    this.selectableObjects = [];

    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'ArrowUp') {
        this.selectPrevious();
      } else if (evt.key === 'ArrowDown') {
        this.selectNext();
      } else if (evt.key === 'Enter') {
        this.activateCurrentSelection();
      }
    });
  }

  selectNext() {
    this.currentSelectionIndex = (this.currentSelectionIndex + 1) % this.selectableObjects.length;
    this.updateHoverToCurrentIndex();
  }

  selectPrevious() {
    this.currentSelectionIndex = (this.currentSelectionIndex - 1 + this.selectableObjects.length) % this.selectableObjects.length;
    this.updateHoverToCurrentIndex();
  }

  updateHoverToCurrentIndex() {
    const obj = this.selectableObjects[this.currentSelectionIndex];
    window.GQRuntimeSelectionState.commitSelectionState('hover', obj, null, 'keyboard');
  }

  activateCurrentSelection() {
    const obj = this.selectableObjects[this.currentSelectionIndex];
    window.GQRuntimeSelectionState.commitSelectionState('active', obj, null, 'keyboard');
  }
}
```

---

## Part 5: Testing Checklist

### Integration Tests

- [ ] Selection marker appears when object is clicked
- [ ] Hover marker appears on mousemove, disappears on mouseout
- [ ] Persistent selection remains visible when hovering other objects
- [ ] Ownership rings display correct faction colors
- [ ] Group selection highlights multiple members
- [ ] Keyboard navigation selects/hovers objects
- [ ] Screen reader announces selection changes
- [ ] Color-blind patterns are visible
- [ ] Markers render at 60 FPS
- [ ] Markers cull correctly outside viewport

### E2E Tests (Playwright)

```javascript
// Example test structure
test('Selection marker persists across hover changes', async ({ page }) => {
  // 1. Navigate to galaxy view
  // 2. Click on a star
  // 3. Verify golden selection marker appears
  // 4. Move mouse to different star
  // 5. Verify blue hover marker appears
  // 6. Verify golden selection marker still visible
  // 7. Move mouse away
  // 8. Verify hover marker disappears
  // 9. Verify selection marker persists
});
```

---

## Part 6: Performance Optimization

### Marker Culling

```javascript
compositor.setViewportBounds({
  minX: viewport.left,
  minY: viewport.top,
  maxX: viewport.right,
  maxY: viewport.bottom,
});
```

### Animation Frame Throttling

```javascript
class RenderLoop {
  constructor(fps = 60) {
    this.fps = fps;
    this.frameTime = 1000 / fps;
    this.lastFrame = 0;
  }

  run(callback) {
    const now = performance.now();
    const delta = now - this.lastFrame;

    if (delta >= this.frameTime) {
      callback(delta / 1000);
      this.lastFrame = now;
    }

    requestAnimationFrame(() => this.run(callback));
  }
}
```

### Marker Pool Reuse

```javascript
// Reuse marker objects instead of creating new ones
animationPool.acquire(key, config); // Get or create
animationPool.release(key);          // Return to pool
```

---

## Part 7: Migration Checklist

For each renderer (Galaxy, System, Approach, Colony):

- [ ] Add marker overlay canvas layer
- [ ] Initialize marker renderer + compositor
- [ ] Implement event handlers (hover, click, pointerout)
- [ ] Apply ownership tokens consistently
- [ ] Add accessibility labels (aria-live)
- [ ] Add keyboard navigation support
- [ ] Run integration tests
- [ ] Verify 60 FPS performance
- [ ] Deploy and monitor for regressions

---

## Part 8: FAQ & Troubleshooting

**Q: Why does my hover marker not disappear?**
A: Ensure `commitSelectionState('hover', null, ...)` is called on `mouseout`.

**Q: Selection and hover markers overlap visually?**
A: Check z-index values. Selection should be z-index 21, hover 20.

**Q: Color-blind users can't distinguish markers?**
A: Verify you're applying `linePattern` and `symbol` from faction tokens.

**Q: Markers render but don't animate?**
A: Ensure animation pool is updated each frame: `animationPool.updateAll(deltaTime)`.

**Q: Performance drops with many markers?**
A: Enable viewport culling: `enableCulling: true` in compositor options.

---

## References

- `js/engine/runtime/RuntimeSelectionState.js` — State management
- `js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js` — Visual tokens
- `js/engine/runtime/PersistentSelectionMarkerRenderer.js` — Rendering
- `js/engine/runtime/SelectionMarkerCompositor.js` — Lifecycle management
- `tests/js/selection-marker-separation.test.js` — Integration tests
- `docs/technical/SELECTION_UNIFICATION_TODO.md` — Phase roadmap
