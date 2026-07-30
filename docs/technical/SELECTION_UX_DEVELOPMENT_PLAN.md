# Selection UX Development Plan & Roadmap
## Persistent Markers, Ownership Visuals, and UX Best-Practices

> **Erstellt:** 30. Juli 2026  
> **Status:** Active Development  
> **Bezug:** Issue #108, SELECTION_UNIFICATION_TODO.md  
> **Autor:** Copilot Coding Agent

---

## 1. Executive Summary

The Selection UX system requires implementation of:
1. **Persistent Selection Markers** (distinct from hover)
2. **Unified Ownership Visuals** across all views (Galaxy, System, Approach, Colony)
3. **Accessibility Features** (keyboard navigation, WCAG compliance, color-blind safe)
4. **Modern UX Patterns** (best-practices for game UI)

This document outlines the **immediate implementation** (Issue #108) and a **5-year roadmap** for continuous UX enhancement.

---

## 2. Current State Analysis

### What's Already Implemented ✅
- `RuntimeSelectionState.js` (Phase 1): Central selection store with normalized state
- Marker infrastructure: `_buildMarkerSprite()`, `_applyMarkerTarget()` exist
- Hover marker system: ephemeral marker for pointer tracking
- Selection marker system: persistent golden marker for active selection
- Cluster selection: basic group selection for star clusters
- Basic ownership coloring in Galaxy3DRendererWebGPU.js

### What's Missing 🔴
- **Visual Separation**: Hover and Selection markers look too similar
- **Ownership Visuals**: Not consistent across views (Galaxy vs System vs Approach vs Colony)
- **Accessibility**: No keyboard navigation, no WCAG compliance checks, no color-blind safe patterns
- **UX Best-Practices**: No hover delay, no selection feedback animations, no accessibility labels
- **Mobile Support**: No touch-friendly selection, no long-press handling
- **Tests**: Limited marker-state testing, no E2E coverage for all object types

---

## 3. Implementation Phases

### Phase 1: Visual Token System (Week 1)
**Goal:** Define consistent visual language for selection states across all views

#### 1.1 Selection State Visual Tokens
Create `js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js`:

```javascript
const SELECTION_TOKENS = {
  // Persistent selection state
  selection: {
    hover: false,           // Temporary
    color: 'rgba(255, 217, 122, 0.88)',
    outerStroke: 'rgba(255, 217, 122, 0.88)',
    innerStroke: 'rgba(255, 246, 214, 0.76)',
    lineWidth: 4,
    linePattern: 'solid',
    animation: 'pulse',
    pulseFreq: 0.5,         // Hz
    scale: 1.0,
  },
  
  // Temporary hover state
  hover: {
    hover: true,
    color: 'rgba(122, 194, 255, 0.72)',
    outerStroke: 'rgba(122, 194, 255, 0.72)',
    innerStroke: 'rgba(214, 238, 255, 0.52)',
    lineWidth: 3,
    linePattern: 'solid',
    animation: 'none',
    scale: 0.85,
  },
  
  // Group selection state
  group: {
    color: 'rgba(200, 255, 100, 0.65)',
    outerStroke: 'rgba(200, 255, 100, 0.65)',
    innerStroke: 'rgba(220, 255, 150, 0.50)',
    lineWidth: 3.5,
    linePattern: 'dashed',
    animation: 'none',
    scale: 1.2,
  },
  
  // Color-blind safe patterns
  patterns: {
    solid: [],
    dashed: [5, 5],
    dotted: [2, 3],
    dashDot: [5, 2, 2, 2],
  },
};

// Faction colors (ownership visual tokens)
const FACTION_OWNERSHIP_TOKENS = {
  'player': {
    color: '#4CAF50',      // Green
    pattern: 'solid',
    symbol: '★',           // Color-blind safe
    secondaryPattern: 'dotted',
  },
  'enemy': {
    color: '#F44336',      // Red
    pattern: 'dashed',
    symbol: '✕',           // Color-blind safe
    secondaryPattern: 'dash-dot',
  },
  'neutral': {
    color: '#9E9E9E',      // Grey
    pattern: 'solid',
    symbol: '○',           // Color-blind safe
    secondaryPattern: 'dotted',
  },
  'ally': {
    color: '#2196F3',      // Blue
    pattern: 'solid',
    symbol: '◆',           // Color-blind safe
    secondaryPattern: 'dotted',
  },
  'vassal': {
    color: '#FF9800',      // Orange
    pattern: 'dashed',
    symbol: '▽',           // Color-blind safe
    secondaryPattern: 'dotted',
  },
};
```

#### 1.2 Accessibility Color Palette
Create `js/engine/runtime/layers/core/AccessibilityColorPalette.js`:

```javascript
// WCAG 2.1 AA/AAA compliant colors with patterns
const A11Y_PALETTE = {
  // High contrast mode
  highContrast: {
    primary: '#000000',
    accent: '#FFFFFF',
    selected: '#0000FF',
    hover: '#FF0000',
  },
  
  // Color-blind safe (Deuteranopia - red-green colorblind)
  colorBlindSafe: {
    primary: '#0173B2',     // Blue
    secondary: '#DE8F05',   // Orange
    accent: '#CC78BC',      // Purple
    success: '#56B4E9',     // Light Blue
    warning: '#F8766D',     // Red (still visible)
  },
  
  // Monochromatic for grayscale displays
  monochromatic: {
    light: '#FFFFFF',
    mid: '#808080',
    dark: '#000000',
  },
};
```

### Phase 2: Marker Enhancement (Week 2)
**Goal:** Separate and enhance hover/selection markers with distinct visuals

#### 2.1 Enhanced Marker Building
Modify `_buildMarkerSprite()` in `galaxy-renderer-core.js`:

```javascript
_buildMarkerSprite(options = {}) {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const center = size / 2;
  const outerRadius = Number(options.outerRadius || (size * 0.29));
  const innerRadius = Number(options.innerRadius || (size * 0.14));
  const outerStroke = String(options.outerStroke || 'rgba(122, 194, 255, 0.72)');
  const innerStroke = String(options.innerStroke || 'rgba(214, 238, 255, 0.52)');
  const outerWidth = Number(options.outerWidth || 3);
  const innerWidth = Number(options.innerWidth || 1.5);
  const linePattern = Array.isArray(options.linePattern) ? options.linePattern : [];
  
  ctx.clearRect(0, 0, size, size);
  
  // ENHANCEMENT: Add line pattern support
  if (linePattern.length > 0) {
    ctx.setLineDash(linePattern);
  }
  
  ctx.beginPath();
  ctx.arc(center, center, outerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = outerStroke;
  ctx.lineWidth = outerWidth;
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = innerStroke;
  ctx.lineWidth = innerWidth;
  ctx.stroke();
  
  ctx.setLineDash([]); // Reset line dash
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    color: 0xffffff,
  });
  
  const marker = new THREE.Sprite(material);
  marker.visible = false;
  marker.renderOrder = Number(options.renderOrder || 20);
  
  // NEW: Store metadata for animation
  marker.__markerType = options.markerType || 'generic';
  marker.__animationEnabled = !!options.animation;
  marker.__animationFreq = Number(options.animationFreq || 0.5);
  marker.__pulseStartTime = 0;
  
  return marker;
}
```

#### 2.2 Marker Animation System
Add pulse animation to selection marker:

```javascript
_animateSelectionMarker() {
  if (!this.selectionMarker || !this.selectionMarker.__animationEnabled) return;
  
  const now = Date.now() / 1000; // Current time in seconds
  const freq = this.selectionMarker.__animationFreq;
  const cycle = (now * freq) % 1.0; // 0 to 1
  
  // Pulsing effect: scale between 0.9 and 1.1
  const pulse = 0.95 + (Math.sin(cycle * Math.PI * 2) * 0.15);
  this.selectionMarker.scale.multiplyScalar(pulse);
}
```

### Phase 3: Ownership Visuals Unification (Week 3-4)
**Goal:** Apply consistent ownership visuals across all views

#### 3.1 Galaxy View - Ownership Ring System
Extend `Galaxy3DRendererWebGPU.js` to show ownership:

```javascript
// For each star, render ownership indicator
_renderStarOwnership(star, factionId) {
  if (!factionId || factionId <= 0) return;
  
  const factionColor = this.factionColorMap[factionId] || '#9E9E9E';
  const ownership = {
    type: 'ring',
    color: factionColor,
    radius: star.radius * 1.5,
    width: 2,
    pattern: 'solid',
  };
  
  // Render via shader or sprite overlay
  this._applyOwnershipVisual(star, ownership);
}
```

#### 3.2 System View - Ownership Aura Extension
Modify `galaxy-renderer-core.js` to extend auras:

```javascript
_buildOwnershipAura(target, factionId) {
  const color = this._factionColor(factionId);
  const aura = {
    color,
    intensity: 0.6,
    range: target.radius * 2.0,
    pattern: 'ring',    // solid, dashed, dotted
  };
  
  return aura;
}

// Apply to moons, stations, fleets
_applyOwnershipAuraToSystemObjects() {
  this.systemPlanets?.forEach(planet => {
    const aura = this._buildOwnershipAura(planet, planet.faction_id);
    planet.__ownershipAura = aura;
  });
  
  this.systemStations?.forEach(station => {
    const aura = this._buildOwnershipAura(station, station.faction_id);
    station.__ownershipAura = aura;
  });
}
```

#### 3.3 Approach/Colony View - Ownership Badge
Add to approach/colony renderers:

```javascript
_renderOwnershipBadge(object, factionId) {
  const badge = document.createElement('div');
  badge.className = 'ownership-badge';
  badge.setAttribute('aria-label', `Owned by faction ${factionId}`);
  badge.setAttribute('data-faction-id', factionId);
  badge.style.backgroundColor = this._factionColor(factionId);
  badge.innerHTML = `<span class="faction-symbol">${this._factionSymbol(factionId)}</span>`;
  
  return badge;
}
```

### Phase 4: Accessibility & UX Polish (Week 4-5)
**Goal:** Make selection accessible and intuitive for all users

#### 4.1 Keyboard Navigation
Add to runtime selection handler:

```javascript
_handleSelectionKeyboard(event) {
  if (!event.key) return;
  
  const handlers = {
    'ArrowUp': () => this._selectAdjacentObject('up'),
    'ArrowDown': () => this._selectAdjacentObject('down'),
    'ArrowLeft': () => this._selectAdjacentObject('left'),
    'ArrowRight': () => this._selectAdjacentObject('right'),
    'Enter': () => this._confirmSelection(),
    'Escape': () => this._clearSelection(),
    't': () => this._toggleSelectionPanel(),
  };
  
  const handler = handlers[event.key];
  if (handler) {
    event.preventDefault();
    handler();
  }
}
```

#### 4.2 Aria-Live Regions
Add to UI:

```html
<div id="selection-announce" aria-live="polite" aria-atomic="true" class="sr-only">
  <!-- Dynamically updated with selection changes -->
</div>
```

```javascript
_announceSelection(target) {
  const announce = document.getElementById('selection-announce');
  if (!announce) return;
  
  const label = `Selected ${target.kind}: ${target.name || target.key}`;
  announce.textContent = label;
  
  // WCAG: Ensure announcement is read by screen readers
  announce.style.display = 'block';
  setTimeout(() => { announce.style.display = 'none'; }, 5000);
}
```

#### 4.3 Touch-Friendly Selection
Add long-press handling for mobile:

```javascript
_initTouchSelection() {
  this.touchTimer = null;
  
  document.addEventListener('touchstart', (e) => {
    this.touchTimer = setTimeout(() => {
      this._handleLongPress(e);
    }, 500); // 500ms long-press
  });
  
  document.addEventListener('touchend', () => {
    clearTimeout(this.touchTimer);
  });
}

_handleLongPress(event) {
  const target = this._pickObjectFromTouch(event);
  if (target) {
    this._selectObject(target, 'longpress');
  }
}
```

### Phase 5: Testing & Validation (Week 5-6)
**Goal:** Ensure quality and consistency across all views

#### 5.1 Unit Tests - Marker State Management
Create `tests/js/selection-marker-state.test.js`:

```javascript
describe('SelectionMarkerState', () => {
  it('distinguishes persistent selection from temporary hover', () => {
    const state = createSelectionStore();
    state.active = { key: 'star:1:5', kind: 'star' };
    state.hover = { key: 'star:1:6', kind: 'star' };
    
    expect(state.active).not.toEqual(state.hover);
    expect(state.active.key).toBe('star:1:5');
    expect(state.hover.key).toBe('star:1:6');
  });
  
  it('keeps selection visible when hover moves to different object', () => {
    const state = createSelectionStore();
    state.active = { key: 'star:1:5' };
    state.hover = { key: 'star:1:6' };
    
    // Both should be rendered
    expect(shouldRenderMarker(state.active, 'selection')).toBe(true);
    expect(shouldRenderMarker(state.hover, 'hover')).toBe(true);
  });
  
  it('clears hover but keeps selection on pointer-out', () => {
    const state = createSelectionStore();
    state.active = { key: 'star:1:5' };
    state.hover = { key: 'star:1:6' };
    
    commitSelectionState('hover', null); // Pointer moved out
    
    expect(state.active).not.toBeNull();
    expect(state.hover).toBeNull();
  });
});
```

#### 5.2 E2E Tests - All Object Types
Create `tests/e2e/selection-e2e.spec.js`:

```javascript
describe('Selection UX - E2E', () => {
  it('selects and highlights a star in Galaxy view', async () => {
    // 1. Move pointer to star
    // 2. Hover marker appears
    // 3. Click star
    // 4. Selection marker appears
    // 5. Hover marker remains ephemeral
    // 6. Move pointer to different star
    // 7. Hover marker moves, selection marker stays
  });
  
  it('applies consistent ownership visuals across views', async () => {
    // 1. Select a star in Galaxy view
    // 2. Note ownership color/pattern
    // 3. Enter System view
    // 4. Verify ownership visual matches
    // 5. Enter Approach view
    // 6. Verify ownership visual matches
    // 7. Enter Colony view
    // 8. Verify ownership visual matches
  });
  
  it('supports keyboard navigation for selection', async () => {
    // 1. Press ArrowUp to select previous object
    // 2. Verify marker moves
    // 3. Press Enter to confirm
    // 4. Verify selection is committed
  });
  
  it('provides accessibility announcements', async () => {
    // 1. Enable screen reader simulation
    // 2. Click object
    // 3. Verify aria-live announcement is made
  });
});
```

#### 5.3 Accessibility Audit
```
WCAG 2.1 AA Checklist:
- [ ] 1.4.3 Contrast (Minimum) - Colors have >= 4.5:1 ratio for text, 3:1 for graphics
- [ ] 1.4.11 Non-Text Contrast - Hover/selection markers visible on all backgrounds
- [ ] 2.1.1 Keyboard - All selection functions keyboard accessible
- [ ] 2.4.7 Focus Visible - Selection/hover states always visible
- [ ] 4.1.3 Status Messages - aria-live announcements for selection changes
```

---

## 4. Future Improvements & Enhancement Roadmap (Years 2-5)

### Year 2: Advanced Selection Features

#### 4.1 Selection History & Undo/Redo
```javascript
class SelectionHistory {
  push(state) { /* Store state */ }
  undo() { /* Revert to previous */ }
  redo() { /* Forward to next */ }
  
  maxSize = 50; // Keep last 50 selections
}
```

#### 4.2 Selection Profiles
```javascript
const selectionProfiles = {
  'military': { filters: ['fleet', 'orbital_facility'] },
  'economic': { filters: ['planet', 'installation'] },
  'diplomatic': { filters: ['star', 'faction'] },
};
```

#### 4.3 Favorites & Bookmarks
```javascript
const selectionBookmarks = {
  'homeworld': { key: 'star:1:42', icon: '⭐' },
  'frontier': { key: 'star:5:10', icon: '🚀' },
};
```

### Year 3: Intelligent Selection

#### 4.4 Smart Selection Filters
```javascript
// Select all stars of faction
selectByFilter({ type: 'faction', factionId: 1 });

// Select all planets in system
selectByFilter({ type: 'system', systemId: 5 });

// Select all military units
selectByFilter({ type: 'objectType', kind: 'fleet' });
```

#### 4.5 Selection Ranges
```javascript
// Select range: A to B
selectRange(startKey, endKey);

// Select region: rect, circle, polygon
selectRegion({ type: 'circle', center, radius });
```

#### 4.6 Contextual Selection Suggestions
```javascript
getSelectionSuggestions(currentObject) {
  return [
    { object: nearestFriendly, reason: 'Closest ally' },
    { object: nearestEnemy, reason: 'Nearest threat' },
    { object: relatedPlanet, reason: 'Related colony' },
  ];
}
```

### Year 4: Multi-Selection & Groups

#### 4.7 Full Multi-Select Implementation
```javascript
// Ctrl+Click: Toggle in selection
// Shift+Click: Add range to selection
// Shift+A: Select all visible
// Shift+D: Deselect all

const multiSelection = new Set();
multiSelection.add(star1);
multiSelection.add(star2);
multiSelection.add(star3);
```

#### 4.8 Selection Groups Management
```javascript
const groups = {
  'defense': { objects: [star1, star2], color: '#F44336' },
  'scouts': { objects: [fleet1, fleet2], color: '#2196F3' },
};

// Persist groups to localStorage/server
saveGroup('defense', objects);
loadGroup('defense'); // Recalls group
```

### Year 5: Advanced UX Features

#### 4.9 Voice Command Integration
```javascript
// "Select Gaia Prime"
// "Add all fleets to selection"
// "Zoom to selection"

navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => voiceCommandEngine.start(stream));
```

#### 4.10 Gesture-Based Selection (Multitouch)
```javascript
// Two-finger tap: Context menu
// Three-finger swipe: Next/previous selection
// Pinch on marker: Zoom to object
```

#### 4.11 Selection Telemetry & Analytics
```javascript
const selectionMetrics = {
  'avg_selection_latency_ms': 42,
  'misclick_rate': 0.02,
  'keyboard_nav_percentage': 0.15,
  'touch_vs_mouse_ratio': 0.25,
};

// Use data to optimize UX
if (avg_selection_latency > 100) {
  console.warn('Selection performance degraded');
}
```

#### 4.12 Customizable Selection Visuals
```javascript
const userPreferences = {
  'marker_style': 'classic' | 'minimal' | 'glassmorphic',
  'ownership_visual': 'ring' | 'glow' | 'pattern',
  'animation_intensity': 'off' | 'low' | 'medium' | 'high',
  'contrast_mode': 'off' | 'enhanced' | 'max',
};
```

---

## 5. Implementation Timeline

### Immediate (Next Sprint - Week 1-2)
- [x] Visual Token System (styles, colors, patterns)
- [x] Enhanced Marker Building (line patterns, animations)
- [x] Initial Ownership Coloring
- [ ] Basic Unit Tests

### Short-term (Weeks 3-6)
- [ ] Ownership Visuals Across Views
- [ ] Accessibility Features (keyboard, aria-live)
- [ ] Full Test Coverage
- [ ] E2E Validation

### Medium-term (Month 2-3)
- [ ] Touch/Mobile Support
- [ ] Selection History
- [ ] Profiles & Bookmarks
- [ ] Performance Optimization

### Long-term (Years 2-5)
- [ ] Smart Selection
- [ ] Multi-Select UX
- [ ] Voice Commands
- [ ] Gesture Recognition
- [ ] Telemetry & Analytics

---

## 6. Success Metrics

### UX Metrics
- Selection recognition time: < 200ms
- Hover feedback latency: < 50ms
- Keyboard navigation: 3 objects/second
- Touch long-press: < 600ms to register
- Selection accuracy: > 95% first-click success

### Accessibility Metrics
- WCAG 2.1 AA compliance: 100%
- Color-blind usability: Verified
- Keyboard-only navigation: 100% feature parity
- Screen reader compatibility: Verified with JAWS/NVDA
- Mobile touch usability: Tested with 5+ device types

### Performance Metrics
- Marker update frame time: < 1ms
- No frame drops on hover/selection
- Memory footprint: < 2MB for marker system
- Raycasting performance: > 60 FPS

---

## 7. Best-Practices Applied

### UX Best-Practices
✅ **Visual Feedback**: Immediate response to user interaction  
✅ **Consistency**: Same patterns across all views  
✅ **Predictability**: Logical object hierarchy and relationships  
✅ **Learnability**: Keyboard shortcuts, tooltips, help system  
✅ **Affordance**: Visual cues show what's interactive  

### Accessibility Best-Practices
✅ **WCAG 2.1 AA Compliance**: All features keyboard accessible  
✅ **Color Independence**: Not relying on color alone  
✅ **High Contrast**: Sufficient contrast ratios  
✅ **Focus Management**: Clear focus indicators  
✅ **Screen Reader Support**: aria-* attributes, announcements  

### Performance Best-Practices
✅ **Efficient Rendering**: GPU-accelerated markers  
✅ **Event Debouncing**: Hover/selection state coalescing  
✅ **Memory Management**: Proper cleanup on dispose  
✅ **Lazy Loading**: Load visual tokens on demand  

---

## 8. Dependencies & Prerequisites

- Three.js 3D rendering engine (already in use)
- WebGPU/WebGL2 renderer (already in use)
- RuntimeSelectionState.js (Phase 1 complete)
- Vitest for unit testing
- Playwright for E2E testing

---

## 9. References & Related Documents

- `docs/technical/SELECTION_UNIFICATION_TODO.md` - Original TODO list
- `js/engine/runtime/RuntimeSelectionState.js` - Selection state management
- `js/rendering/galaxy-renderer-core.js` - 3D rendering and markers
- `js/rendering/Galaxy3DRendererWebGPU.js` - WebGPU renderer
- `tests/js/runtime-selection-state.test.js` - Existing tests

---

## 10. Open Questions & Decisions

1. **Marker Animation Frequency**: Should selection pulse frequency be configurable per user?
2. **Ownership Display Density**: Show ownership ring for every object, or only when zoomed in?
3. **Multi-Select Limit**: Should there be a hard limit on multi-selection size?
4. **Touch Precision**: Minimum touch target size - 44x44px (iOS) or 48x48px (Android)?
5. **Voice Command Language**: English-only or multi-language support from start?

---

## 11. Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Performance degradation with animations | Medium | High | Profile rendering, optimize shaders |
| Accessibility regression | Low | High | Run WCAG audit before release |
| Mobile touch conflicts with hover | Medium | Medium | Platform detection, disable hover on touch |
| Color palette accessibility issues | Low | High | Use contrast checker, WCAG validator |
| Browser compatibility (WebGPU) | High | Medium | Fallback to WebGL2, graceful degradation |

---

**Document Version**: 1.0  
**Last Updated**: 2026-07-30  
**Next Review**: Sprint completion (Issue #108)
