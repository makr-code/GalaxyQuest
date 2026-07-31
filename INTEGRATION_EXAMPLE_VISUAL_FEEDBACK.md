/**
 * INTEGRATION_EXAMPLE_VISUAL_FEEDBACK.md
 *
 * Complete practical example of integrating the Visual Feedback System
 * into a GalaxyQuest game application
 *
 * This example shows:
 * - Initializing GameEngine with visual feedback features
 * - Handling user input for multi-unit selection
 * - Creating and managing unit groups with bloom effects
 * - Applying ownership auras to game objects
 * - Implementing colorblind mode accessibility
 * - Using multi-view (PiP) viewports with visual feedback
 */

# Visual Feedback System Integration Example

## 1. Initialize GameEngine with Visual Feedback

```javascript
// app.js - Main application entry point
import { GameEngine } from './js/engine/GameEngine.js';

async function initializeGame() {
  const canvas = document.getElementById('game-canvas');
  
  // Create GameEngine with visual feedback features enabled
  const engine = await GameEngine.create(canvas, {
    renderer: 'auto',                // Use best available (WebGPU or WebGL2)
    physics: 'cpu',                  // CPU physics engine
    postFx: true,                    // Enable post-processing
    
    // Bloom effect configuration
    bloom: {
      threshold: 0.8,                // Bloom extraction threshold
      strength: 1.2,                 // Base bloom intensity
      radius: 0.6,                   // Blur radius
      mipLevels: 4,                  // Blur pyramid depth
    },
    
    // Group selection bloom configuration
    groupBloom: {
      bloomThreshold: 0.6,           // Threshold for group highlights
      bloomStrength: 1.5,            // Intensity multiplier for groups
      groupBoundaryWidth: 2,         // Outline width in pixels
    },
    
    // Ownership aura bloom configuration
    ownershipAura: {
      baseIntensity: 0.8,            // Base intensity for faction auras
      bloomThreshold: 0.7,           // Bloom extraction threshold
      enableOwnershipAura: true,      // Enable ownership auras by default
    },
    
    // Advanced rendering features
    advancedRendering: true,
    advancedRenderingPreset: 'high', // Quality preset (low/medium/high/ultra)
  });
  
  // Store engine globally for easier access in event handlers
  window.gameEngine = engine;
  
  // Initialize the game scene
  await initializeGameScene(engine);
  
  // Set up UI event handlers
  setupUIEventHandlers(engine);
  
  // Start the game loop
  engine.start();
  
  return engine;
}

// Initialize game scene with objects
async function initializeGameScene(engine) {
  const { scene, groupSelection, ownershipSystem, ownershipAuraBloom } = engine;
  
  // Example: Load a star system
  const starSystem = await loadStarSystem('alpha-centauri');
  
  // Register stars for ownership aura bloom
  for (const star of starSystem.stars) {
    const ownerFaction = getStarOwner(star);
    if (ownerFaction) {
      // Register the star object for ownership aura bloom
      ownershipAuraBloom.registerObjectAura(
        star.mesh,
        ownerFaction.id,
        1.0 // default intensity
      );
    }
  }
  
  // Register planets for ownership aura bloom
  for (const planet of starSystem.planets) {
    const ownerFaction = getPlanetOwner(planet);
    if (ownerFaction) {
      ownershipAuraBloom.registerObjectAura(
        planet.mesh,
        ownerFaction.id
      );
    }
  }
  
  // Add objects to scene
  scene.add(...starSystem.objects);
}
```

---

## 2. Handle Multi-Unit Selection with Keyboard and Mouse

```javascript
// selection-handler.js - Handle user selection input
function setupUIEventHandlers(engine) {
  const { groupSelection, viewports } = engine;
  
  // Track keyboard state for modifier keys
  document.addEventListener('keydown', (evt) => {
    groupSelection.handleKeyboardEvent(evt);
  });
  
  document.addEventListener('keyup', (evt) => {
    groupSelection.handleKeyboardEvent(evt);
  });
  
  // Handle unit click/selection
  document.addEventListener('click', (evt) => {
    const clickedUnit = getUnitAtScreenPoint(evt.clientX, evt.clientY);
    if (!clickedUnit) return;
    
    // Get keyboard modifiers
    const modifiers = groupSelection.getKeyModifiers();
    
    // Toggle unit selection with modifier support
    groupSelection.toggleUnitSelection(clickedUnit, {
      multiSelect: modifiers.ctrl,    // Ctrl: add to selection
      range: modifiers.shift,         // Shift: range select
      exclusive: true,                // Default: replace selection
    });
    
    // Apply visual feedback to viewports
    viewports?.applySelectionMarkersToViewports();
  });
  
  // Ctrl+A: Select all units of current type
  document.addEventListener('keydown', (evt) => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key === 'a') {
      evt.preventDefault();
      
      const currentView = getCurrentGameView(); // 'galaxy' | 'system' | 'colony'
      const container = getViewContainer(currentView);
      
      // Get unit type from selection
      const selectedUnit = groupSelection.getSelectedUnits()[0];
      if (selectedUnit) {
        groupSelection.selectAllOfType(selectedUnit.type, container);
        viewports?.applySelectionMarkersToViewports();
      }
    }
  });
  
  // Escape: Clear selection
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      groupSelection.clearSelection();
      viewports?.applySelectionMarkersToViewports();
    }
  });
  
  // Undo/Redo
  document.addEventListener('keydown', (evt) => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key === 'z') {
      evt.preventDefault();
      groupSelection.undo();
      viewports?.applySelectionMarkersToViewports();
    }
    
    if (((evt.ctrlKey || evt.metaKey) && evt.key === 'y') ||
        ((evt.ctrlKey || evt.metaKey) && evt.shiftKey && evt.key === 'z')) {
      evt.preventDefault();
      groupSelection.redo();
      viewports?.applySelectionMarkersToViewports();
    }
  });
  
  // Listen to selection change events
  groupSelection.on('unit-selected', ({ unit, unitId }) => {
    console.log('Unit selected:', unitId, unit);
    updateUnitDetailsPanel(unit);
  });
  
  groupSelection.on('multi-selection-bloom', ({ enabled, intensity, unitCount }) => {
    console.log(`Multi-selection: ${unitCount} units, bloom ${enabled ? 'enabled' : 'disabled'}`);
  });
}
```

---

## 3. Create and Manage Unit Groups

```javascript
// group-management.js - Handle group operations
function setupGroupUI(engine) {
  const { groupSelection, ownershipSystem } = engine;
  
  // Create group button
  document.getElementById('btn-create-group').addEventListener('click', () => {
    if (groupSelection.getSelectionCount() === 0) {
      alert('Please select units first');
      return;
    }
    
    // Show dialog for group name and type
    const groupName = prompt('Group name (e.g., "Alpha Squadron"):');
    if (!groupName) return;
    
    const groupType = showGroupTypeDialog(); // 'fleet', 'squadron', 'colony_group', etc.
    
    // Create the group
    const groupId = groupSelection.createGroupFromSelection(groupName, groupType);
    
    // Customize bloom color if desired
    const template = groupSelection._groupTemplates[groupType];
    groupSelection.setGroupBloom(groupId, true, 1.5, template.color);
    
    console.log(`Group created: ${groupName} (${groupId})`);
    updateGroupsList();
  });
  
  // Add units to group
  document.getElementById('btn-add-to-group').addEventListener('click', () => {
    const groupId = getSelectedGroupId();
    const selectedUnits = groupSelection.getSelectedUnits();
    
    if (!groupId || selectedUnits.length === 0) return;
    
    if (groupSelection.addUnitsToGroup(groupId, selectedUnits)) {
      console.log(`Added ${selectedUnits.length} units to group`);
      updateGroupsList();
    } else {
      alert('Could not add units to group (max size exceeded?)');
    }
  });
  
  // Select group
  document.getElementById('group-list').addEventListener('click', (evt) => {
    const groupId = evt.target.dataset.groupId;
    if (!groupId) return;
    
    groupSelection.selectGroup(groupId, true); // true = exclusive selection
    console.log(`Group selected: ${groupId}`);
    updateUnitDetailsPanel();
  });
  
  // Delete group
  document.getElementById('btn-delete-group').addEventListener('click', () => {
    const groupId = getSelectedGroupId();
    if (!groupId) return;
    
    groupSelection.dissolveGroup(groupId);
    console.log(`Group dissolved: ${groupId}`);
    updateGroupsList();
  });
}

function updateGroupsList() {
  const groupList = document.getElementById('group-list');
  const { groupSelection } = window.gameEngine;
  
  groupList.innerHTML = '';
  
  for (const group of groupSelection.getAllGroups()) {
    const item = document.createElement('div');
    item.className = 'group-item';
    item.dataset.groupId = group.id;
    
    const stats = groupSelection.getGroupStats(group.id);
    
    item.innerHTML = `
      <div class="group-icon">${group.template.icon}</div>
      <div class="group-info">
        <div class="group-name">${group.name}</div>
        <div class="group-stats">
          Units: ${stats.unitCount} | 
          Firepower: ${stats.totalFirepower} | 
          Health: ${stats.totalHealth.toFixed(0)}
        </div>
      </div>
    `;
    
    groupList.appendChild(item);
  }
}
```

---

## 4. Handle Colorblind Mode

```javascript
// accessibility.js - Handle colorblind mode
function setupAccessibilityUI(engine) {
  const { ownershipSystem, ownershipAuraBloom } = engine;
  
  const colorblindSelect = document.getElementById('adv-rendering-colorblind');
  
  // Initialize colorblind mode selector
  colorblindSelect.addEventListener('change', (evt) => {
    const mode = evt.target.value;
    
    console.log(`Colorblind mode changed to: ${mode}`);
    
    // The AdvancedRenderingUI automatically applies this to the systems,
    // but we can also do it manually:
    ownershipSystem?.setColorblindMode(mode);
    ownershipAuraBloom?.setColorblindMode(mode);
    
    // Save preference
    localStorage.setItem('adv-rendering-colorblind', mode);
  });
  
  // Restore saved colorblind mode preference
  const savedMode = localStorage.getItem('adv-rendering-colorblind') || 'normal';
  colorblindSelect.value = savedMode;
}

// Listen for colorblind mode changes from UI
window.addEventListener('colorblind-mode-changed', (evt) => {
  console.log(`UI changed colorblind mode to: ${evt.detail.mode}`);
});
```

---

## 5. Work with Multi-View (PiP) Viewports

```javascript
// viewport-management.js - Handle viewports
function setupViewportManagement(engine) {
  const { viewports, groupSelection, ownershipSystem } = engine;
  
  // Create Picture-in-Picture viewport for ship follower camera
  viewports.add('shipFollower', {
    label: 'Ship Follower',
    badge: 'ship',
    width: 250,
    height: 180,
    draggable: true,
    resizable: true,
  });
  
  // Create viewport for base camera
  viewports.add('baseCamera', {
    label: 'Base View',
    badge: 'base',
    width: 250,
    height: 180,
    draggable: true,
    resizable: true,
  });
  
  // When selection changes in main view, update viewports
  groupSelection.on('unit-selected', () => {
    // Apply selection markers to all viewports
    viewports.applySelectionMarkersToViewports();
  });
  
  groupSelection.on('multi-selection-bloom', () => {
    // Update viewport visual feedback
    viewports.applySelectionMarkersToViewports();
  });
  
  // When ownership system is updated, refresh viewports
  window.addEventListener('colorblind-mode-changed', () => {
    viewports.applyOwnershipAurasToViewports();
  });
}
```

---

## 6. Monitor Selection and Bloom Effects

```javascript
// debug-panel.js - Show debug information
function setupDebugPanel(engine) {
  const debugPanel = document.getElementById('debug-panel');
  
  if (!debugPanel) return;
  
  const updateDebugInfo = () => {
    const { groupSelection, _bloomPass } = engine;
    
    const selectedCount = groupSelection.getSelectionCount();
    const bloomEnabled = groupSelection.isMultiSelectionBloomEnabled();
    const bloomIntensity = bloomEnabled ? groupSelection.getMultiSelectionBloomIntensity() : 0;
    const groupCount = groupSelection.getAllGroups().length;
    
    // Get effective bloom parameters
    const effectiveThreshold = _bloomPass?.getEffectiveThreshold() ?? 0;
    const effectiveStrength = _bloomPass?.getEffectiveStrength() ?? 0;
    
    debugPanel.innerHTML = `
      <h3>Selection Debug Info</h3>
      <div>Selected Units: ${selectedCount}</div>
      <div>Bloom Enabled: ${bloomEnabled ? 'YES' : 'NO'}</div>
      <div>Bloom Intensity: ${bloomIntensity.toFixed(2)}</div>
      <div>Active Groups: ${groupCount}</div>
      <div style="margin-top: 10px;">
        <h4>Bloom Pass Parameters</h4>
        <div>Effective Threshold: ${effectiveThreshold.toFixed(3)}</div>
        <div>Effective Strength: ${effectiveStrength.toFixed(3)}</div>
      </div>
    `;
  };
  
  // Update debug panel every 100ms
  setInterval(updateDebugInfo, 100);
}
```

---

## 7. Complete Initialization Flow

```javascript
// main.js - Complete application initialization
async function main() {
  try {
    // Initialize game
    const engine = await initializeGame();
    console.log('Game initialized');
    
    // Set up event handlers
    setupUIEventHandlers(engine);
    setupGroupUI(engine);
    setupAccessibilityUI(engine);
    setupViewportManagement(engine);
    setupDebugPanel(engine);
    
    // Log system status
    console.log('Visual Feedback System Status:');
    console.log('- GroupSelectionController:', engine.groupSelection ? 'Ready' : 'Not available');
    console.log('- OwnershipVisualsSystem:', engine.ownershipSystem ? 'Ready' : 'Not available');
    console.log('- GroupHighlightBloomPass:', engine.groupBloom ? 'Ready' : 'Not available');
    console.log('- OwnershipAuraBloomPass:', engine.ownershipAuraBloom ? 'Ready' : 'Not available');
    console.log('- BloomPass dynamic parameters:', engine._bloomPass ? 'Enabled' : 'Disabled');
    console.log('- ViewportManager:', engine.viewports ? 'Ready' : 'Not available');
    
    // Game is ready
    document.getElementById('loading-screen')?.remove();
    document.getElementById('game-ui').style.display = 'block';
    
  } catch (err) {
    console.error('Failed to initialize game:', err);
    alert('Failed to initialize game. Check console for details.');
  }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
```

---

## 8. HTML Structure Required

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GalaxyQuest</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="loading-screen">Loading...</div>
  
  <div id="game-ui" style="display: none;">
    <!-- Main game canvas -->
    <canvas id="game-canvas"></canvas>
    
    <!-- UI Controls -->
    <div id="ui-panel">
      <!-- Colorblind mode selector -->
      <select id="adv-rendering-colorblind">
        <option value="normal">Normal Vision</option>
        <option value="deuteranopia">Red-Green Colorblind</option>
        <option value="protanopia">Red-Green Colorblind (alt)</option>
        <option value="tritanopia">Blue-Yellow Colorblind</option>
        <option value="achromatic">Monochrome</option>
      </select>
      
      <!-- Group management buttons -->
      <button id="btn-create-group">Create Group</button>
      <button id="btn-add-to-group">Add to Group</button>
      <button id="btn-delete-group">Delete Group</button>
      
      <!-- Group list -->
      <div id="group-list" class="group-list"></div>
      
      <!-- Unit details -->
      <div id="unit-details" class="unit-details"></div>
      
      <!-- Debug panel -->
      <div id="debug-panel" class="debug-panel"></div>
    </div>
  </div>
  
  <!-- Scripts -->
  <script type="module" src="main.js"></script>
</body>
</html>
```

---

## Complete Feature Usage Summary

### Multi-Unit Selection
- Single click: Select one unit
- Ctrl+Click: Add/remove unit from selection
- Shift+Click: Range select between units
- Ctrl+A: Select all units of same type
- Esc: Clear selection
- Ctrl+Z/Y: Undo/Redo selection

### Visual Feedback
- 1 unit: No bloom effect
- 2+ units: Automatic bloom highlighting with intensity scaling
- Bloom intensity: 0.8 + (unit_count * 0.1), capped at 2.0

### Group Management
- Create: Select units, click "Create Group", name it
- Add: Select units, click "Add to Group"
- Delete: Select group in list, click "Delete Group"
- Each group has custom bloom color and intensity

### Accessibility
- Choose colorblind mode from dropdown
- Automatically adjusts all faction colors
- Compensates bloom intensity for visibility
- Saves preference to localStorage

### Ownership Auras
- Star systems show faction colors via bloom
- Planets display owner faction auras
- Colorblind mode adjusts colors and intensity
- Works across all viewports (main + PiP windows)

---

## License

MIT © 2026 makr-code/GalaxyQuest
