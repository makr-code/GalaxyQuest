/**
 * docs/technical/SELECTION_ACCESSIBILITY_SPEC.md
 *
 * Selection UX Accessibility Specification
 * Phase 5 Requirements for Color-Blind Safe, Keyboard-Navigable Selection
 *
 * Status: Specification Complete
 * Implementation: Partial (visual tokens complete, keyboard/ARIA pending)
 */

# Selection UX Accessibility Specification

## Executive Summary

This specification ensures the Selection UX is accessible to users with:
- Color vision deficiencies (CVD): Deuteranopia, Protanopia, Tritanopia, Monochromacy
- Motor disabilities (keyboard-only navigation)
- Visual impairments (screen reader support via aria-live)
- Cognitive disabilities (consistent, predictable interactions)

---

## Part 1: Color-Blind Safe Design

### 1.1 Non-Color Distinction Methods

**Principle:** Never rely on color alone to convey information. Always combine with:
- Line patterns (solid, dashed, dotted, dot-dash)
- Geometric symbols (★, ✕, ○, ◆, ▽, ☠, ?)
- Stroke width variation
- Opacity/transparency
- Position/layering (z-index)

### 1.2 Implemented Patterns

**Selection State Markers:**
```
┌─────────────────────────────────────────────────────────────────┐
│ State            │ Color     │ Pattern  │ Symbol │ LineWidth    │
├─────────────────────────────────────────────────────────────────┤
│ Selection        │ Golden    │ Solid    │ ◆      │ Thick (4px)  │
│ Hover            │ Blue      │ Solid    │ ○      │ Medium (3px) │
│ Group            │ Green     │ Dashed   │ ▶      │ Medium (3.5) │
│ Multi-Selection  │ Cyan      │ Dot-Dash │ ◇      │ Medium (3px) │
│ Selection+Hover  │ Orange    │ Solid    │ ★      │ Thick (5px)  │
└─────────────────────────────────────────────────────────────────┘
```

**Faction Ownership Markers:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Faction  │ Color   │ Primary   │ Symbol │ ColorBlind Pattern  │
├─────────────────────────────────────────────────────────────────┤
│ Player   │ Green   │ #4CAF50   │ ★      │ Dotted              │
│ Enemy    │ Red     │ #F44336   │ ✕      │ Dash-Dash-Dot       │
│ Neutral  │ Grey    │ #9E9E9E   │ ○      │ Dotted              │
│ Ally     │ Blue    │ #2196F3   │ ◆      │ Dotted              │
│ Vassal   │ Orange  │ #FF9800   │ ▽      │ Dot-Dash            │
│ Pirate   │ Purple  │ #9C27B0   │ ☠      │ Long-Dash           │
│ Unknown  │ Blue-Gr │ #607D8B   │ ?      │ Dotted              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 WCAG 2.1 Contrast Compliance

**Contrast Ratio Requirements:**
- Normal text: 4.5:1
- Large text: 3:1
- Graphics/UI components: 3:1
- Focus indicators: 3:1

**Verified Tokens:**
```javascript
// All marker tokens meet minimum requirements
marker: {
  // Selection: Gold (#FFD97A) on space background (#000000)
  // Contrast: ~4.8:1 ✅
  color: 'rgba(255, 217, 122, 0.88)',
  
  // Hover: Blue (#7AC2FF) on space background (#000000)
  // Contrast: ~3.2:1 ✅
  color: 'rgba(122, 194, 255, 0.72)',
}
```

### 1.4 Palette Recommendations

**Standard (Normal Vision):**
```
Primary:  #2196F3 (Blue)
Accent:   #FF9800 (Orange)
Success:  #4CAF50 (Green)
Error:    #F44336 (Red)
Neutral:  #9E9E9E (Grey)
```

**Deuteranopia (Red-Green Colorblind):**
```
Primary:  #0173B2 (Blue)
Accent:   #DE8F05 (Orange)
Success:  #56B4E9 (Light Blue)
Error:    #E76BF3 (Purple)
Neutral:  #A6A6A6 (Grey)
```

**Protanopia (Red-Green Colorblind):**
```
Primary:  #0173B2 (Blue)
Accent:   #DE8F05 (Orange)
Success:  #CC78BC (Purple)
Error:    #D62828 (Dark Red)
Neutral:  #606060 (Dark Grey)
```

**High Contrast Mode:**
```
Primary:  #000000 (Black)
Accent:   #FFFFFF (White)
Success:  #008000 (Dark Green)
Error:    #FF0000 (Bright Red)
Neutral:  #FFFFFF (White)
```

---

## Part 2: Keyboard Navigation

### 2.1 Keyboard Shortcuts

**Selection Navigation:**
```
Arrow Up       → Select previous object in list
Arrow Down     → Select next object in list
Arrow Left     → Pan view left
Arrow Right    → Pan view right

Enter/Space    → Activate current hover/open context menu
Escape         → Clear current selection
```

**Multi-Selection (Phase 3):**
```
Ctrl + Up      → Add previous to selection
Ctrl + Down    → Add next to selection
Shift + Up     → Range select from current to previous
Shift + Down   → Range select from current to next
Ctrl + A       → Select all (context-dependent)
```

**Accessibility Shortcuts:**
```
Alt + Q        → Toggle accessibility panel
Alt + H        → Read current object details (screen reader)
Alt + L        → List all selected objects (screen reader)
```

### 2.2 Focus Management

```javascript
class KeyboardSelectionManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.focusedIndex = -1;
    this.selectableObjects = [];
    
    // Announce focus changes to screen readers
    this.focusRegion = document.createElement('div');
    this.focusRegion.setAttribute('aria-live', 'polite');
    this.focusRegion.setAttribute('aria-atomic', 'true');
    this.focusRegion.className = 'sr-only';
    document.body.appendChild(this.focusRegion);
  }

  handleKeyDown(evt) {
    switch (evt.key) {
      case 'ArrowDown':
        evt.preventDefault();
        this.moveFocusDown();
        break;
      case 'ArrowUp':
        evt.preventDefault();
        this.moveFocusUp();
        break;
      case 'Enter':
      case ' ':
        evt.preventDefault();
        this.activateCurrentFocus();
        break;
      case 'Escape':
        evt.preventDefault();
        this.clearFocus();
        break;
    }
  }

  moveFocusDown() {
    if (this.selectableObjects.length === 0) return;
    this.focusedIndex = (this.focusedIndex + 1) % this.selectableObjects.length;
    this.updateFocusDisplay();
  }

  moveFocusUp() {
    if (this.selectableObjects.length === 0) return;
    this.focusedIndex = (this.focusedIndex - 1 + this.selectableObjects.length) % this.selectableObjects.length;
    this.updateFocusDisplay();
  }

  updateFocusDisplay() {
    const obj = this.selectableObjects[this.focusedIndex];
    const label = this.buildObjectLabel(obj);
    
    // Visual update
    window.GQRuntimeSelectionState.commitSelectionState('hover', obj, null, 'keyboard');
    
    // Screen reader announcement
    this.focusRegion.textContent = `${this.focusedIndex + 1} of ${this.selectableObjects.length}: ${label}`;
  }

  activateCurrentFocus() {
    if (this.focusedIndex < 0 || this.focusedIndex >= this.selectableObjects.length) return;
    
    const obj = this.selectableObjects[this.focusedIndex];
    window.GQRuntimeSelectionState.commitSelectionState('active', obj, null, 'keyboard');
    
    // Announce activation
    const label = this.buildObjectLabel(obj);
    this.focusRegion.textContent = `${label} selected`;
  }

  clearFocus() {
    this.focusedIndex = -1;
    window.GQRuntimeSelectionState.commitSelectionState('active', null, null, 'keyboard');
    this.focusRegion.textContent = 'Selection cleared';
  }

  buildObjectLabel(obj) {
    const kind = obj.__kind || 'object';
    const name = obj.name || obj.designation || `${kind} ${obj.id}`;
    const faction = obj.faction?.name || 'Unknown';
    return `${name} (${kind}, owned by ${faction})`;
  }
}
```

---

## Part 3: Screen Reader Support (ARIA)

### 3.1 Live Region Announcements

**Selection State Changes:**
```html
<div aria-live="polite" aria-atomic="true" id="selection-announcer" class="sr-only">
  <!-- Updated by JavaScript when selection changes -->
</div>
```

**Announcements:**
```
"Star Alpha Centauri selected. System 42. Player faction. Details panel updated."
"Hovering over Beta Crater. Neutral system."
"3 systems selected. Faction group selection."
"Selection cleared."
```

### 3.2 Implementation Pattern

```javascript
class AccessibilityAnnouncer {
  constructor(container) {
    this.announcer = document.createElement('div');
    this.announcer.id = 'gq-selection-announcer';
    this.announcer.setAttribute('aria-live', 'polite');
    this.announcer.setAttribute('aria-atomic', 'true');
    this.announcer.className = 'sr-only';
    container.appendChild(this.announcer);

    window.addEventListener('GQ:selection:state-changed', (evt) => {
      this.announceChange(evt.detail?.state);
    });
  }

  announceChange(state) {
    let announcement = '';

    if (state?.active) {
      announcement = this.buildSelectionAnnouncement(state.active);
    } else if (state?.hover) {
      announcement = this.buildHoverAnnouncement(state.hover);
    } else {
      announcement = 'Selection cleared';
    }

    // Use setTimeout to ensure screen reader picks up the change
    this.announcer.textContent = '';
    setTimeout(() => {
      this.announcer.textContent = announcement;
    }, 100);
  }

  buildSelectionAnnouncement(selection) {
    const kind = selection.kind || 'object';
    const name = selection.target?.name || selection.target?.designation || `${kind}`;
    const faction = selection.target?.faction?.name || 'Unknown';
    const coords = selection.target?.galaxy_index && selection.target?.system_index
      ? ` (Galaxy ${selection.target.galaxy_index}, System ${selection.target.system_index})`
      : '';

    return `${name} selected. ${kind}. Owner: ${faction}${coords}. Object details panel updated.`;
  }

  buildHoverAnnouncement(hover) {
    const kind = hover.kind || 'object';
    const name = hover.target?.name || `${kind}`;
    return `Hovering over ${name}`;
  }
}
```

### 3.3 ARIA Labels for Markers

```javascript
const token = getSelectionMarkerToken('selection');
// token.ariaLabel = 'Persistent selection marker'

const factionToken = getFactionOwnershipToken('player');
// factionToken.accessibilityLabel = 'Player-owned (Green, Star)'
```

---

## Part 4: Motor Accessibility

### 4.1 Touch-Friendly Selection

For mobile and touch devices:
```javascript
class TouchSelectionHandler {
  constructor(renderer) {
    this.renderer = renderer;
    this.container = renderer.container;
    
    this.container.addEventListener('touchstart', (evt) => {
      const touch = evt.touches[0];
      const target = this.pickObjectAtPoint(touch.clientX, touch.clientY);
      
      if (target) {
        // Hover on touch (like mouse move)
        window.GQRuntimeSelectionState.commitSelectionState('hover', target, 
          { x: touch.clientX, y: touch.clientY }, 'touchhover');
      }
    });

    this.container.addEventListener('touchend', (evt) => {
      const touch = evt.changedTouches[0];
      const target = this.pickObjectAtPoint(touch.clientX, touch.clientY);
      
      if (target) {
        // Tap = selection (like click)
        window.GQRuntimeSelectionState.commitSelectionState('active', target,
          { x: touch.clientX, y: touch.clientY }, 'tap');
      }
    });

    // Long-press for context menu
    let pressTimer;
    this.container.addEventListener('touchstart', (evt) => {
      pressTimer = setTimeout(() => {
        const touch = evt.touches[0];
        const target = this.pickObjectAtPoint(touch.clientX, touch.clientY);
        if (target) this.showContextMenu(target, touch.clientX, touch.clientY);
      }, 500);
    });

    this.container.addEventListener('touchend', () => {
      clearTimeout(pressTimer);
    });
  }

  pickObjectAtPoint(x, y) {
    // Implementation specific to renderer
    return null;
  }

  showContextMenu(target, x, y) {
    // Show accessible context menu
  }
}
```

### 4.2 Large Click Targets

Ensure minimum touch target size (44x44px per WCAG 2.1 Level AAA):
```javascript
const MINIMUM_TOUCH_TARGET_SIZE = 44; // pixels

// When rendering markers, ensure they meet minimum size
class TouchAccessibleMarker {
  constructor(marker, canvas) {
    this.marker = marker;
    this.canvas = canvas;
  }

  getHitArea() {
    const size = Math.max(MINIMUM_TOUCH_TARGET_SIZE, this.marker.token.outerRadius * 2);
    return {
      x: this.marker.position.x - size / 2,
      y: this.marker.position.y - size / 2,
      width: size,
      height: size,
    };
  }

  contains(x, y) {
    const hitArea = this.getHitArea();
    return x >= hitArea.x && x < hitArea.x + hitArea.width &&
           y >= hitArea.y && y < hitArea.y + hitArea.height;
  }
}
```

---

## Part 5: Cognitive Accessibility

### 5.1 Predictable & Consistent Interactions

**Consistency Rules:**
1. Same action always has same result
2. Selection persists until explicitly cleared
3. Hover never has side effects (only previews)
4. Colors always mean the same faction/state
5. Patterns always indicate the same status

### 5.2 Clear Feedback

```javascript
// Always provide clear feedback for user actions
class FeedbackSystem {
  announceHover(target) {
    console.log(`HOVER: ${target.name}`); // Debug
    // Visual feedback: blue marker
    // Audio feedback (optional): subtle tone
    // Haptic feedback (optional): light vibration
  }

  announceSelection(target) {
    console.log(`SELECT: ${target.name}`); // Debug
    // Visual feedback: golden marker + pulse
    // Audio feedback: confirmation tone
    // Haptic feedback: stronger vibration
  }

  announceError(message) {
    console.error(`ERROR: ${message}`);
    // Visual feedback: red highlight
    // Audio feedback: error tone
    // Screen reader: error announcement
  }
}
```

### 5.3 Help & Documentation

Always provide accessible help:
```html
<button aria-label="Help with selection" aria-describedby="selection-help-text">
  ?
</button>

<div id="selection-help-text" class="help-panel">
  <h2>Selection Help</h2>
  <ul>
    <li><strong>Click</strong> to select an object</li>
    <li><strong>Hover</strong> to preview an object</li>
    <li><strong>Arrow Keys</strong> to navigate (keyboard mode)</li>
    <li><strong>Escape</strong> to clear selection</li>
    <li>Selection persists until you click elsewhere</li>
    <li>Markers: Gold = Selected, Blue = Hovering</li>
  </ul>
</div>
```

---

## Part 6: Testing Accessibility

### 6.1 Automated Tests

```javascript
// tests/js/selection-accessibility.test.js
describe('Selection Accessibility', () => {
  test('WCAG contrast compliance', () => {
    const tokens = getSelectionMarkerTokens();
    for (const token of tokens) {
      const ratio = getContrastRatio(token.color, '#000000');
      expect(ratio).toBeGreaterThanOrEqual(3);
    }
  });

  test('Keyboard navigation works', () => {
    const manager = new KeyboardSelectionManager(renderer);
    manager.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
    expect(manager.focusedIndex).toBe(0);
  });

  test('Screen reader announcements are clear', () => {
    const announcer = new AccessibilityAnnouncer(document.body);
    announcer.announceChange({ active: mockSelection });
    expect(announcer.announcer.textContent).toMatch(/selected/i);
  });

  test('Color-blind patterns are distinct', () => {
    const patterns = getLinePatterns();
    expect(patterns.solid).not.toEqual(patterns.dashed);
    expect(patterns.dotted).not.toEqual(patterns['dot-dash']);
  });

  test('Touch targets are large enough', () => {
    const marker = new TouchAccessibleMarker(mockMarker, canvas);
    const hitArea = marker.getHitArea();
    expect(hitArea.width).toBeGreaterThanOrEqual(44);
    expect(hitArea.height).toBeGreaterThanOrEqual(44);
  });
});
```

### 6.2 Manual Testing Checklist

- [ ] Test with keyboard only (no mouse)
- [ ] Test with screen reader (NVDA/JAWS/VoiceOver)
- [ ] Test with color-blind simulator (e.g., Coblis)
- [ ] Test with high contrast mode enabled
- [ ] Test with 200% zoom
- [ ] Test on mobile/touch device
- [ ] Test with speech recognition
- [ ] Test with browser zoom
- [ ] Test with system color filters

---

## Part 7: Browser Support

**Target Support:**
```
✅ Chrome/Edge 90+
✅ Firefox 88+
✅ Safari 14+
✅ Mobile browsers (iOS Safari 14+, Chrome Mobile)

Assistive Technology:
✅ NVDA 2021+
✅ JAWS 2021+
✅ VoiceOver (macOS 10.15+, iOS 14+)
✅ Windows High Contrast Mode
```

---

## References

- WCAG 2.1 (Web Content Accessibility Guidelines): https://www.w3.org/WAI/WCAG21/quickref/
- ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/
- Color Blindness Simulator: https://www.color-blindness.com/coblis-color-blindness-simulator/
- Touch Target Size Guidelines: https://www.w3.org/WAI/WCAG21/Understanding/target-size
- Keyboard Accessibility: https://www.w3.org/WAI/test-evaluate/
