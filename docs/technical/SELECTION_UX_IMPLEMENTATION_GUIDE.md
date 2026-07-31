# Selection UX Implementation Guide
## Best-Practices für Persistent Markers, Ownership Visuals & Accessibility

> **Version:** 1.0  
> **Status:** Active Development  
> **Zielgruppe:** Frontend-Entwickler, UX-Designer, QA-Engineer  
> **Referenz:** Issue #108, SELECTION_UNIFICATION_TODO.md

---

## Table of Contents
1. [UX Best-Practices Overview](#ux-best-practices-overview)
2. [Persistent Marker Implementation](#persistent-marker-implementation)
3. [Ownership Visuals Unification](#ownership-visuals-unification)
4. [Accessibility Implementation](#accessibility-implementation)
5. [Testing & Validation](#testing--validation)
6. [Performance Optimization](#performance-optimization)
7. [Mobile & Touch Support](#mobile--touch-support)
8. [Troubleshooting](#troubleshooting)

---

## UX Best-Practices Overview

### Principle 1: Immediate Visual Feedback
**What:** User action → instant visual response  
**Why:** Reduces perceived latency, increases confidence in interaction  
**How:** Marker appears within 50ms of hover/selection

```
Timeline:
0ms   - User hovers over object
20ms  - Raycast detection
50ms  - Marker visible ✅
100ms - Total latency acceptable
```

### Principle 2: Consistency Across Views
**What:** Same object looks same in all views (Galaxy, System, Approach, Colony)  
**Why:** User mental model remains consistent, no learning curve for each view  
**How:** Use `SelectionMarkerStyleTokens.js` tokens in all renderers

```
Galaxy View    → Star with ownership ring
↓
System View    → Same star with same ownership aura
↓
Approach View  → Planets with same ownership badge
↓
Colony View    → Surface with same ownership marker
```

### Principle 3: Clear State Distinction
**What:** Visual difference between persistent selection and temporary hover  
**Why:** User knows what will stay selected vs what's just a preview  
**How:** Different colors, stroke weights, animations

```
Hover (temporary):    Blue, thin stroke, no animation → Disappears on pointer-out
Selection (persistent): Gold, thick stroke, pulsing → Stays until clicked elsewhere
```

### Principle 4: Accessibility First
**What:** All UX works for users with disabilities  
**Why:** Expands user base, required by law in many jurisdictions  
**How:** Color-blind safe, keyboard navigation, screen reader support

```
✓ Not relying on color alone (use patterns)
✓ Sufficient contrast ratios (WCAG AA/AAA)
✓ Keyboard shortcuts for all actions
✓ aria-live announcements for changes
```

### Principle 5: Performance & Responsiveness
**What:** 60 FPS even with many objects  
**Why:** Smooth interaction feels professional, reduces CLS (Cumulative Layout Shift)  
**How:** GPU-accelerated rendering, efficient state updates

```
Frame Budget:
- Marker update: < 1ms
- Raycasting: < 5ms
- Render: < 16ms
- Total: < 16ms (60 FPS)
```

---

## Persistent Marker Implementation

### Step 1: Enhanced Marker Sprites

The marker rendering should support both **persistent** and **temporary** states:

```javascript
// In galaxy-renderer-core.js _buildMarkerSprite()

_buildMarkerSprite(options = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Apply line pattern for accessibility
  if (options.linePattern) {
    ctx.setLineDash(options.linePattern);
  }
  
  // Draw outer circle (visible stroke indicates state)
  ctx.beginPath();
  ctx.arc(center, center, outerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = options.outerStroke;
  ctx.lineWidth = options.outerWidth;
  ctx.stroke();
  
  // Draw inner circle (accent)
  ctx.beginPath();
  ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = options.innerStroke;
  ctx.lineWidth = options.innerWidth;
  ctx.stroke();
  
  ctx.setLineDash([]); // Reset
  
  // Create texture and sprite
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  
  const marker = new THREE.Sprite(material);
  marker.visible = false;
  marker.renderOrder = options.renderOrder || 20;
  
  // Store animation metadata
  marker.__markerType = options.markerType || 'generic';
  marker.__animationEnabled = !!options.animation;
  marker.__animationFreq = Number(options.animationFreq || 0.5);
  
  return marker;
}
```

### Step 2: Separate Hover and Selection Markers

```javascript
// Build two independent markers
_buildHoverMarker() {
  const token = mod.getSelectionMarkerToken('hover');
  this.hoverMarker = this._buildMarkerSprite({
    outerStroke: token.outerStroke,
    innerStroke: token.innerStroke,
    outerWidth: token.outerWidth,
    innerWidth: token.innerWidth,
    linePattern: mod.getLinePattern(token.linePattern),
    animation: token.animation,
    markerType: 'hover',
    renderOrder: token.renderOrder,
  });
  this.scene.add(this.hoverMarker);
}

_buildSelectionMarker() {
  const token = mod.getSelectionMarkerToken('selection');
  this.selectionMarker = this._buildMarkerSprite({
    outerRadius: token.outerRadius * 96,
    innerRadius: token.innerRadius * 96,
    outerStroke: token.outerStroke,
    innerStroke: token.innerStroke,
    outerWidth: token.outerWidth,
    innerWidth: token.innerWidth,
    linePattern: mod.getLinePattern(token.linePattern),
    animation: token.animation,
    animationFreq: token.pulseFrequency,
    markerType: 'selection',
    renderOrder: token.renderOrder,
  });
  this.scene.add(this.selectionMarker);
}
```

### Step 3: Independent Marker Updates

```javascript
// Ensure hover doesn't hide selection and vice versa
_updateHoverMarker() {
  if (!this.hoverMarker && !this.selectionMarker) return;
  
  const selectionTarget = this._getSelectionMarkerTarget();
  const hoverTarget = this._getHoverMarkerTarget();
  
  // IMPORTANT: Show hover only if different from selection
  const uniqueHoverTarget = this._sameMarkerTarget(hoverTarget, selectionTarget) 
    ? null 
    : hoverTarget;
  
  // Update BOTH independently
  this._applyMarkerTarget(this.selectionMarker, selectionTarget, 'selection');
  this._applyMarkerTarget(this.hoverMarker, uniqueHoverTarget, 'hover');
  
  // Animate selection marker
  if (this.selectionMarker?.visible) {
    this._animateSelectionMarker();
  }
}

_sameMarkerTarget(target1, target2) {
  if (!target1 || !target2) return false;
  return (
    target1.kind === target2.kind &&
    target1.value === target2.value
  );
}
```

### Step 4: Animation Loop Integration

```javascript
// In render loop
_updateAnimations() {
  // Animate selection marker with pulse
  if (this.selectionMarker?.__animationEnabled) {
    this._applyMarkerAnimation(this.selectionMarker, Date.now());
  }
}

_applyMarkerAnimation(marker, currentTimeMs) {
  if (!marker.__animationEnabled) return;
  
  const freq = marker.__animationFreq || 0.5;
  const now = currentTimeMs / 1000; // Convert to seconds
  const cycle = (now * freq) % 1.0; // 0 to 1 (periodic)
  
  // Pulsing effect: 0.95 to 1.15 scale
  const pulse = 0.95 + (Math.sin(cycle * Math.PI * 2) * 0.15);
  
  // Apply pulse to base scale
  const baseScale = marker.__baseScale || 1.0;
  marker.scale.setScalar(baseScale * pulse);
}
```

---

## Ownership Visuals Unification

### Step 1: Define Visual Tokens

```javascript
// Use SelectionMarkerStyleTokens.js for consistent ownership visuals
const ownershipToken = mod.getFactionOwnershipToken(factionId);

// Result: 
{
  primaryColor: '#4CAF50',           // Green for player
  secondaryColor: '#66BB6A',
  linePattern: 'solid',
  colorBlindPattern: 'dotted',
  symbol: '★',                      // Distinctive shape
  accessibilityLabel: 'Player-owned (Green, Star)',
}
```

### Step 2: Apply in Galaxy View

```javascript
// js/rendering/Galaxy3DRendererWebGPU.js
_renderStarOwnership(star, factionId) {
  if (!factionId || factionId <= 0) return;
  
  const token = mod.getFactionOwnershipToken(factionId);
  
  // Apply color tint to star
  star.material.color.setStyle(token.primaryColor);
  
  // Add ownership ring via shader or sprite overlay
  this._addOwnershipRing(star, {
    color: token.primaryColor,
    linePattern: token.linePattern,
    width: 2,
  });
}

_addOwnershipRing(object, options) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(object.radius * 1.5, 1, 16, 100),
    new THREE.MeshBasicMaterial({
      color: options.color,
      transparent: true,
      wireframe: true,
    })
  );
  
  object.add(ring);
  object.__ownershipRing = ring;
}
```

### Step 3: Apply in System View

```javascript
// js/rendering/galaxy-renderer-core.js
_applyOwnershipAuraToSystemObjects() {
  // Planets
  this.systemPlanets?.forEach(planet => {
    const token = mod.getFactionOwnershipToken(planet.faction_id);
    planet.__ownershipAura = {
      color: token.primaryColor,
      pattern: token.linePattern,
      intensity: 0.6,
      range: planet.radius * 2.0,
    };
    this._renderOwnershipAura(planet, planet.__ownershipAura);
  });
  
  // Stations
  this.systemStations?.forEach(station => {
    const token = mod.getFactionOwnershipToken(station.faction_id);
    station.__ownershipAura = {
      color: token.primaryColor,
      pattern: token.linePattern,
    };
    this._renderOwnershipAura(station, station.__ownershipAura);
  });
}

_renderOwnershipAura(object, aura) {
  // Create glow/aura effect using post-processing
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: aura.color,
    transparent: true,
    opacity: aura.intensity,
    side: THREE.BackSide,
  });
  
  const glowMesh = new THREE.Mesh(object.geometry, glowMaterial);
  glowMesh.scale.multiplyScalar(aura.range / object.radius);
  object.add(glowMesh);
}
```

### Step 4: Apply in Approach/Colony View

```javascript
// HTML: Add ownership badge
_renderOwnershipBadge(object, factionId) {
  const token = mod.getFactionOwnershipToken(factionId);
  
  const badge = document.createElement('div');
  badge.className = 'ownership-badge';
  badge.setAttribute('aria-label', token.accessibilityLabel);
  badge.setAttribute('data-faction-id', factionId);
  badge.style.backgroundColor = token.primaryColor;
  badge.style.color = this._contrastColor(token.primaryColor);
  badge.innerHTML = `
    <span class="faction-symbol">${token.symbol}</span>
    <span class="faction-name">${token.name}</span>
  `;
  
  return badge;
}

_contrastColor(bgColor) {
  // Use white text for dark background, black for light
  const luminance = mod.getRelativeLuminance(bgColor);
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}
```

---

## Accessibility Implementation

### Step 1: Keyboard Navigation

```javascript
// Add to RuntimeSelectionState.js or runtime/game.js
_initKeyboardSelection() {
  document.addEventListener('keydown', (e) => {
    const handlers = {
      'ArrowUp': () => this._selectAdjacentObject('up'),
      'ArrowDown': () => this._selectAdjacentObject('down'),
      'ArrowLeft': () => this._selectAdjacentObject('left'),
      'ArrowRight': () => this._selectAdjacentObject('right'),
      'Enter': () => this._confirmSelection(),
      'Escape': () => this._clearSelection(),
      'Tab': () => this._cycleSelectionMode(),
    };
    
    const handler = handlers[e.key];
    if (handler) {
      e.preventDefault();
      handler();
    }
  });
}

_selectAdjacentObject(direction) {
  const current = this.selectionState.active;
  const candidates = this._getVisibleObjectsInDirection(current, direction);
  
  if (candidates.length > 0) {
    const next = candidates[0]; // Nearest in direction
    this._selectObject(next, 'keyboard-navigation');
  }
}
```

### Step 2: Aria-Live Announcements

```html
<!-- In main UI template -->
<div id="selection-announce" 
     aria-live="polite" 
     aria-atomic="true" 
     class="sr-only">
  <!-- Announcements go here -->
</div>
```

```javascript
// When selection changes
_announceSelection(target) {
  const announce = document.getElementById('selection-announce');
  if (!announce) return;
  
  const label = this._getObjectLabel(target);
  announce.textContent = `Selected: ${label}`;
  
  // Screen reader reads this announcement
  // Don't show visually (sr-only class)
}

_getObjectLabel(target) {
  switch (target.kind) {
    case 'star':
      return `Star ${target.name || target.system} in sector ${target.galaxy}`;
    case 'planet':
      return `Planet ${target.name} in system ${target.system}`;
    case 'fleet':
      return `Fleet "${target.name}" with ${target.ship_count} ships`;
    case 'cluster':
      return `Cluster with ${target.__clusterSystems?.length || 0} systems`;
    default:
      return target.name || target.key;
  }
}
```

### Step 3: Color-Blind Safe Patterns

```javascript
// Use line patterns in addition to colors
_buildAccessibleMarker(options) {
  const a11yMode = this.userPreferences.a11yMode || 'standard';
  const palette = mod.getAccessibilityPalette(a11yMode);
  
  // If user is color-blind, add pattern to marker
  if (a11yMode !== 'standard') {
    options.linePattern = options.colorBlindPattern || 'dotted';
  }
  
  return this._buildMarkerSprite(options);
}

// In CSS: Add pattern backgrounds for additional distinction
.marker-selection {
  background: repeating-linear-gradient(
    45deg,
    var(--color-selection),
    var(--color-selection) 10px,
    rgba(255, 255, 255, 0.1) 10px,
    rgba(255, 255, 255, 0.1) 20px
  );
}
```

### Step 4: High Contrast Mode

```javascript
// Detect system preference
const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
const highContrast = window.matchMedia('(prefers-contrast: more)').matches;

if (highContrast) {
  const palette = mod.getAccessibilityPalette('highContrast');
  // Apply high contrast colors to UI
  document.documentElement.style.setProperty('--color-text', palette.primary);
  document.documentElement.style.setProperty('--color-bg', palette.accent);
}
```

---

## Testing & Validation

### Unit Tests (Vitest)

```bash
npm run test:unit:js -- tests/js/runtime-selection-state.test.js
npm run test:unit:js -- tests/js/selection-marker-style-tokens.test.js
```

### E2E Tests (Playwright)

```javascript
// tests/e2e/selection-e2e.spec.js
test('selection marker persists while hover moves', async ({ page }) => {
  // 1. Click star A
  await page.click('[data-object-id="star-1"]');
  await expect(page.locator('.marker-selection')).toBeVisible();
  
  // 2. Move hover to star B
  await page.hover('[data-object-id="star-2"]');
  
  // 3. Verify selection marker still on star A
  const markerA = page.locator('[data-marker-target="star-1"]');
  await expect(markerA).toBeVisible();
  
  // 4. Verify hover marker is on star B
  const markerB = page.locator('[data-marker-target="star-2"]');
  await expect(markerB).toBeVisible();
});
```

### Accessibility Audit

```bash
# WCAG 2.1 AA compliance check
axe-core scan: Select objects with colors and verify contrast ratios

# Color-blind simulation
Use tools like Color Blind Simulator (Chrome extension) to verify visibility

# Screen reader testing
- JAWS (Windows)
- NVDA (Windows, open-source)
- VoiceOver (macOS)
- TalkBack (Android)
```

### Performance Testing

```javascript
// Measure marker latency
const start = performance.now();
this._selectObject(target);
const end = performance.now();
console.log(`Selection latency: ${end - start}ms`); // Goal: < 50ms
```

---

## Performance Optimization

### GPU Acceleration
- Use Three.js `Sprite` (GPU-accelerated billboard)
- Avoid DOM updates in hot loop
- Batch marker updates

### Event Debouncing
```javascript
_debounceHoverUpdate = this._debounce(
  () => this._updateHoverMarker(),
  16 // 60 FPS frame time
);

_onHover(event) {
  this._debounceHoverUpdate();
}
```

### Memory Management
```javascript
dispose() {
  if (this.hoverMarker) {
    this.hoverMarker.material.map?.dispose();
    this.hoverMarker.material.dispose();
    this.scene.remove(this.hoverMarker);
  }
  if (this.selectionMarker) {
    this.selectionMarker.material.map?.dispose();
    this.selectionMarker.material.dispose();
    this.scene.remove(this.selectionMarker);
  }
}
```

---

## Mobile & Touch Support

### Long-Press for Selection
```javascript
_initTouchSelection() {
  let touchTimer = null;
  
  document.addEventListener('touchstart', (e) => {
    touchTimer = setTimeout(() => {
      this._handleLongPress(e);
    }, 500); // 500ms long-press threshold
  });
  
  document.addEventListener('touchend', () => {
    clearTimeout(touchTimer);
  });
}

_handleLongPress(event) {
  const touch = event.touches[0];
  const target = this._pickObjectFromScreenCoord(touch.clientX, touch.clientY);
  if (target) {
    this._selectObject(target, 'longpress');
  }
}
```

### Touch Target Size (48x48px minimum)
```css
.marker-selection {
  width: 48px;  /* WCAG minimum for touch */
  height: 48px;
  min-width: 48px;
  min-height: 48px;
}
```

---

## Troubleshooting

### Issue: Selection marker disappears when hovering

**Cause:** Hover and selection use same marker  
**Fix:** Use separate `hoverMarker` and `selectionMarker` instances

### Issue: Ownership colors not visible in different lighting

**Cause:** Colors chosen without considering background variations  
**Fix:** Verify WCAG AA contrast on all backgrounds, use patterns + colors

### Issue: Keyboard navigation not working

**Cause:** Event listeners not attached, event.preventDefault() missing  
**Fix:** Attach listeners in `_initKeyboardSelection()`, call `e.preventDefault()`

### Issue: Screen reader doesn't announce selections

**Cause:** aria-live element not in DOM or textContent not updating  
**Fix:** Ensure element exists, update textContent not innerHTML

### Issue: Mobile touch targeting imprecise

**Cause:** Touch target too small or raycasting not pixel-perfect  
**Fix:** Increase touch target to 48x48px minimum, use tolerance in raycasting

---

**Last Updated:** 2026-07-30  
**Next Review:** After Phase 1 implementation (Week 2)
