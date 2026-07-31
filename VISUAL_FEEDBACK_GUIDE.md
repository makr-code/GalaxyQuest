/**
 * VISUAL_FEEDBACK_GUIDE.md
 *
 * Complete guide to the GalaxyQuest Visual Feedback System for Multi-Unit Selection
 * and Ownership Auras with Post-Processing Effects Integration
 *
 * Features implemented:
 * - Dynamic multi-unit selection highlighting with bloom effects
 * - Group-based bloom auras with customizable colors and intensity
 * - Ownership/faction-based aura bloom effects
 * - Colorblind-accessible mode toggle with UI integration
 * - Full GameEngine and ViewportManager integration
 *
 * Status: Phase 3-5 Implementation Complete
 * Date: 2026-07-31
 */

# GalaxyQuest Visual Feedback System Guide

## Overview

The GalaxyQuest Visual Feedback System provides comprehensive visual feedback for:
1. **Multi-Unit Selection** - When 2+ units are selected, dynamic bloom effects highlight the group
2. **Group Highlighting** - Named groups receive persistent visual auras with customizable colors
3. **Ownership Auras** - Faction-owned objects display bloom effects in their faction colors
4. **Colorblind Accessibility** - Full UI toggle for colorblind-friendly visual modes

---

## Architecture

### Core Components

#### 1. GroupSelectionController
**File:** `js/engine/selection/GroupSelectionController.js`

Manages multi-unit selection with integrated bloom effect state tracking.

**Key Features:**
- Multi-selection with Ctrl/Shift modifier support
- Group creation, manipulation, and dissolution
- Selection history with undo/redo
- Dynamic bloom state tracking per group
- Multi-selection bloom based on selection count

**Example Usage:**
```javascript
const groupCtrl = new GroupSelectionController(markerSystem);

// Select multiple units
groupCtrl.toggleUnitSelection(unit1, { multiSelect: true });
groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });

// Create a named group from selection
const groupId = groupCtrl.createGroupFromSelection('Fighter Squadron', 'squadron');

// Enable bloom feedback for the group
groupCtrl.setGroupBloom(groupId, true, 1.5, [1.0, 0.5, 0.0]); // Orange bloom

// Multi-selection automatically enables bloom when 2+ units selected
// Intensity scales with unit count (0.8 + count * 0.1, max 2.0)
```

**Bloom State Events:**
- `'multi-selection-bloom'` - Emitted when multi-selection bloom state changes
- `'bloom-updated'` - Emitted when a group's bloom state changes
- `'ownership-aura-bloom'` - Emitted when ownership aura bloom is toggled

---

#### 2. GroupHighlightBloomPass
**File:** `js/engine/post-effects/passes/GroupHighlightBloomPass.js`

Post-processing pass that applies selective bloom highlighting to selected groups.

**Key Features:**
- Per-group bloom rendering with customizable intensity
- Multi-selection highlighting with dynamic threshold adjustment
- Group boundary visualization
- Performance-aware throttling (16ms update cycle)

**Parameters:**
```javascript
{
  groupSelectionController: GroupSelectionController,  // Required for state
  renderer: IGraphicsRenderer,                         // WebGL/WebGPU renderer
  bloomThreshold: 0.6,                                 // Extraction threshold [0,1]
  bloomStrength: 1.5,                                  // Base intensity multiplier
  groupBoundaryWidth: 2,                               // Outline width in pixels
}
```

**Integration:**
```javascript
const groupBloom = new GroupHighlightBloomPass({
  groupSelectionController: engine.groupSelection,
  renderer: engine.renderer,
});
engine.postFx.addPass(groupBloom);
```

---

#### 3. OwnershipAuraBloomPass
**File:** `js/engine/post-effects/passes/OwnershipAuraBloomPass.js`

Post-processing pass that applies faction-specific bloom auras to owned objects.

**Key Features:**
- Per-faction bloom color profiles
- Configurable intensity per ownership type
- Colorblind mode support with intensity compensation
- Batch rendering optimization by faction
- Performance-aware throttling (32ms update cycle)

**Faction Intensity Multipliers:**
```javascript
{
  helion_confederation: 0.9,
  myr_keth: 1.0,
  brut_der_ewigkeit: 0.7,
  omniscienta: 1.1,
  schattenkompakt: 0.6,
  echos_der_leere: 1.0,
  khar_morr_syndicate: 0.95,
  genesis_kollektiv: 0.85,
  architekten_des_lichts: 1.05,
  ketzer_von_verath: 0.9,
  aethernox: 0.95,
  nomaden_des_rifts: 1.0,
  iron_fleet: 0.75,
}
```

**Colorblind Intensity Adjustments:**
```javascript
{
  deuteranopia: 0.95,      // Red-Green colorblind
  protanopia: 0.95,        // Red-Green colorblind (alternative)
  tritanopia: 0.9,         // Blue-Yellow colorblind
  achromatic: 0.7,         // Grayscale/monochrome
}
```

**Integration:**
```javascript
const auraBloom = new OwnershipAuraBloomPass({
  ownershipSystem: engine.ownershipSystem,
  renderer: engine.renderer,
  baseIntensity: 0.8,
});
engine.postFx.addPass(auraBloom);

// Register objects for aura bloom
auraBloom.registerObjectAura(starObject, 'helion_confederation');
auraBloom.registerObjectAura(planetObject, 'genesis_kollektiv', 1.2); // Custom intensity
```

---

#### 4. Enhanced BloomPass (Dynamic Parameters)
**File:** `js/engine/post-effects/passes/BloomPass.js`

Extended with dynamic parameter adjustment based on selection state.

**New Methods:**
```javascript
pass.updateDynamicParameters();           // Update based on selection state
pass.setDynamicParameters(threshold, str); // Manual parameter override
pass.getEffectiveThreshold();             // Get current threshold
pass.getEffectiveStrength();              // Get current strength
```

**Dynamic Adjustment Logic:**
- When multi-selection bloom is enabled:
  - Threshold reduced by (intensity * 0.15) for more bloom on selected units
  - Strength increased by (intensity * 0.3) for enhanced visual feedback
- Called automatically in render() each frame

---

#### 5. AdvancedRenderingUI (Colorblind Toggle)
**File:** `js/engine/AdvancedRenderingUI.js`

Enhanced UI manager with colorblind mode selector.

**New Features:**
- Colorblind mode dropdown selector (normal, deuteranopia, protanopia, tritanopia, achromatic)
- localStorage persistence (`adv-rendering-colorblind`)
- Automatic propagation to OwnershipVisualsSystem and OwnershipAuraBloomPass
- Custom event dispatch for other systems

**Usage:**
```html
<!-- HTML structure for colorblind selector -->
<select id="adv-rendering-colorblind">
  <option value="normal">Normal Vision</option>
  <option value="deuteranopia">Red-Green Colorblind (Deuteranopia)</option>
  <option value="protanopia">Red-Green Colorblind (Protanopia)</option>
  <option value="tritanopia">Blue-Yellow Colorblind (Tritanopia)</option>
  <option value="achromatic">Monochrome (Achromatic)</option>
</select>
```

**Event Listening:**
```javascript
window.addEventListener('colorblind-mode-changed', (evt) => {
  const { mode } = evt.detail;
  console.log('Colorblind mode changed to:', mode);
  // Update custom systems as needed
});
```

---

#### 6. GameEngine Integration
**File:** `js/engine/GameEngine.js`

Full integration of all visual feedback systems into the core engine.

**New Properties:**
```javascript
engine.groupSelection         // GroupSelectionController instance
engine.ownershipSystem        // OwnershipVisualsSystem instance
engine.groupBloom             // GroupHighlightBloomPass instance
engine.ownershipAuraBloom     // OwnershipAuraBloomPass instance
```

**Automatic Wiring:**
1. GroupSelectionController created with optional SelectionMarkerSystem
2. OwnershipVisualsSystem created with AdvancedRenderingManager
3. Bloom passes automatically connected to selection controller
4. ViewportManager receives references for multi-view consistency

**Initialization Options:**
```javascript
const engine = await GameEngine.create(canvas, {
  groupBloom: {              // Group selection bloom config
    bloomThreshold: 0.6,
    bloomStrength: 1.5,
  },
  ownershipAura: {           // Ownership aura bloom config
    baseIntensity: 0.8,
    bloomThreshold: 0.7,
  },
  groupSelection: {          // Group selection config
    enableOwnershipAura: true,
  },
});
```

---

#### 7. ViewportManager Integration
**File:** `js/engine/ViewportManager.js`

Multi-view (Picture-in-Picture) viewport consistency with visual feedback.

**New Methods:**
```javascript
viewport.setGroupSelection(controller);      // Wire selection controller
viewport.setOwnershipSystem(system);         // Wire ownership system
viewport.applySelectionMarkersToViewports(); // Apply to all PiP windows
viewport.applyOwnershipAurasToViewports();   // Apply ownership to all PiP windows
```

**Event Broadcasting:**
- `'viewport:selection-changed'` - Selection state changes
- `'viewport:apply-selection-markers'` - Apply selection to viewport
- `'viewport:apply-ownership-auras'` - Apply ownership to viewport

**Usage:**
```javascript
// ViewportManager automatically receives systems from GameEngine
// No manual wiring needed in normal cases

// Manual propagation when needed
engine.viewports.applySelectionMarkersToViewports();
engine.viewports.applyOwnershipAurasToViewports();
```

---

## Usage Examples

### Example 1: Enable Multi-Selection Bloom Feedback

```javascript
// When user selects multiple units (e.g., Ctrl+Click)
scene.addEventListener('unit-selected', ({ unit, modifiers }) => {
  engine.groupSelection.toggleUnitSelection(unit, {
    multiSelect: modifiers.ctrl,
    range: modifiers.shift,
  });
  
  // Multi-selection bloom is automatically enabled when 2+ units are selected
  // Intensity scales: 0.8 + (count * 0.1), max 2.0
});
```

### Example 2: Create a Named Group with Custom Bloom

```javascript
// User creates a "fighter squadron" from selected units
const groupId = engine.groupSelection.createGroupFromSelection(
  'Alpha Squadron',
  'squadron'
);

// Customize the bloom color and intensity
const squadronColor = [1.0, 0.5, 0.0]; // Orange
engine.groupSelection.setGroupBloom(groupId, true, 1.8, squadronColor);
```

### Example 3: Apply Ownership Auras

```javascript
// When rendering a star system, register objects for ownership aura bloom
function renderStarSystem(system) {
  for (const star of system.stars) {
    const faction = getFactionOwner(star);
    engine.ownershipAuraBloom.registerObjectAura(
      star.mesh,
      faction,
      1.0 // default intensity
    );
  }
  
  for (const planet of system.planets) {
    const faction = getFactionOwner(planet);
    engine.ownershipAuraBloom.registerObjectAura(
      planet.mesh,
      faction
    );
  }
}
```

### Example 4: Switch to Colorblind Mode

```javascript
// User selects colorblind mode from settings
document.getElementById('adv-rendering-colorblind').value = 'deuteranopia';

// This automatically:
// 1. Updates OwnershipVisualsSystem color palettes
// 2. Adjusts OwnershipAuraBloomPass intensity
// 3. Saves preference to localStorage
// 4. Emits 'colorblind-mode-changed' event

// Listen for changes
window.addEventListener('colorblind-mode-changed', ({ detail }) => {
  console.log('Colorblind mode:', detail.mode);
});
```

### Example 5: Dynamic Bloom Adjustment

```javascript
// The BloomPass automatically adjusts based on selection state
// But you can also manually override

const bloomPass = engine._bloomPass;

// Get current effective parameters (may be dynamic)
const threshold = bloomPass.getEffectiveThreshold();
const strength = bloomPass.getEffectiveStrength();

// Manually override (skips dynamic adjustment)
bloomPass.setDynamicParameters(0.5, 2.0);

// Or update the base parameters (used when no selection)
bloomPass.threshold = 0.6;
bloomPass.strength = 1.2;
```

---

## Performance Considerations

### Throttling
- **GroupHighlightBloomPass:** 16ms update throttle (~60 FPS)
- **OwnershipAuraBloomPass:** 32ms update throttle (~30 FPS)
- **BloomPass:** Dynamic parameters updated each frame but with efficiency checks

### Optimization Tips

1. **Limit multi-selection groups**
   - Large selections (100+ units) may impact performance
   - Consider capping visual bloom for very large selections

2. **Register only visible objects for ownership auras**
   ```javascript
   // DON'T do this:
   allStarsInGalaxy.forEach(star => {
     auraBloom.registerObjectAura(star, star.faction);
   });
   
   // DO this:
   visibleStars.forEach(star => {
     auraBloom.registerObjectAura(star, star.faction);
   });
   ```

3. **Use colorblind mode sparingly**
   - Colorblind modes apply palette remapping to all factions
   - Only switch modes when user settings change, not every frame

4. **Monitor FPS for post-processing**
   - GameEngine disables post-FX if FPS drops below POST_FX_MIN_FPS (45 FPS)
   - Bloom effects are first to be suspended to maintain frame rate

### Memory Usage

- **GroupSelectionController:** ~1-2 KB base + ~0.1 KB per selected unit
- **GroupHighlightBloomPass:** ~5 KB base + minimal per-group overhead
- **OwnershipAuraBloomPass:** ~8 KB base + ~0.5 KB per registered object

---

## Testing

### Unit Tests
```bash
npm test -- tests/js/selection-visual-feedback.test.js
```

Tests cover:
- Multi-selection bloom enabling/disabling
- Group bloom state tracking
- Colorblind mode application
- Ownership aura registration
- ViewportManager propagation

### Integration Tests
```bash
npm test -- tests/e2e/visual-feedback.e2e.js
```

Tests cover:
- Full GameEngine initialization with visual systems
- Multi-view consistency (main + PiP viewports)
- Real-time bloom effect updates
- Performance under load

### Manual Testing

1. **Multi-Selection Bloom:**
   - Open game, select 1 unit → no bloom
   - Ctrl+Click to select 2+ units → bloom appears with increasing intensity
   - Clear selection → bloom disappears

2. **Group Bloom:**
   - Create named group → receives bloom in group template color
   - Modify group → bloom updates accordingly
   - Dissolve group → bloom removed

3. **Ownership Auras:**
   - Switch between factions in system view
   - Verify faction colors appear as bloom auras
   - Switch colorblind mode → verify palette changes

4. **Colorblind Mode:**
   - Select each colorblind mode from UI
   - Verify colors remain distinct and readable
   - Check that selection appears in localStorage
   - Refresh page and verify mode persists

---

## Troubleshooting

### Bloom Effects Not Appearing

**Cause:** Post-processing disabled or FPS too low
```javascript
// Check if post-FX is enabled
console.log(engine.postFx);           // Should not be null
console.log(engine.perf.fps);         // Should be >= POST_FX_MIN_FPS (45)
```

**Solution:** 
- Ensure `opts.postFx !== false` when creating engine
- Reduce visual quality settings if FPS is low

### Colorblind Mode Not Applied

**Cause:** UI element missing or wrong ID
```html
<!-- Verify this element exists -->
<select id="adv-rendering-colorblind">...</select>
```

**Solution:**
- Check browser console for errors
- Verify element ID is exactly `adv-rendering-colorblind`
- Initialize AdvancedRenderingUI after DOM is ready

### Multi-Selection Bloom Not Scaling

**Cause:** Selection controller not wired to bloom pass
```javascript
// Verify wiring
console.log(engine._bloomPass.selectionController === engine.groupSelection);
```

**Solution:**
- Use `GameEngine.create()` for automatic wiring
- Or manually wire: `bloomPass.selectionController = engine.groupSelection;`

### ViewportManager Not Updating

**Cause:** ViewportManager created before selection systems
```javascript
// This is handled automatically by GameEngine.create()
// If using manual initialization, ensure correct order:
// 1. Create ViewportManager
// 2. Initialize selection systems
// 3. Call viewports.setGroupSelection() and setOwnershipSystem()
```

**Solution:**
- Use `GameEngine.create()` for correct initialization order
- Or manually wire after all systems are created

---

## Integration Checklist

- [x] GroupSelectionController with bloom state tracking
- [x] GroupHighlightBloomPass post-processing integration
- [x] OwnershipAuraBloomPass post-processing integration
- [x] BloomPass dynamic parameter adjustment
- [x] AdvancedRenderingUI colorblind mode toggle
- [x] GameEngine integration and wiring
- [x] ViewportManager multi-view consistency
- [x] Unit tests for all components
- [x] Event system for inter-component communication
- [x] Documentation and examples

---

## Future Enhancements

- [ ] Selection group persistence (save/load named groups)
- [ ] Advanced group manipulation (merge groups, move units between groups)
- [ ] Selection audio feedback (beep/sound for multi-select)
- [ ] Keyboard shortcut customization
- [ ] Group priority/layering in bloom effects
- [ ] Per-viewport selection state (independent selections in PiP windows)
- [ ] Selection heatmap for large unit counts

---

## License

MIT © 2026 makr-code/GalaxyQuest
