/**
 * GroupSelectionController.js
 *
 * Advanced multi-unit selection system with group management.
 * Handles creation, manipulation, and visualization of unit groups across all views.
 *
 * Features:
 * - Multi-unit selection (Ctrl+Click, Shift+Click, Ctrl+A)
 * - Group creation and management
 * - Selection persistence across view transitions
 * - Group statistics and metrics
 * - Keyboard shortcuts and UI integration
 *
 * Usage:
 *   const groupCtrl = new GroupSelectionController(selectionMarkerSystem);
 *   groupCtrl.toggleUnitSelection(unit, { multiSelect: true });
 *   groupCtrl.createGroup([unit1, unit2, unit3], 'fleet');
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class GroupSelectionController {
  /**
   * @param {SelectionMarkerSystem} markerSystem - Selection marker system
   * @param {object} options - Configuration options
   */
  constructor(markerSystem, options = {}) {
    this.markerSystem = markerSystem;
    
    // Selection management
    this._activeSelection = new Map(); // unitId -> unit
    this._activeGroups = new Map(); // groupId -> group
    this._selectionMode = 'single'; // 'single', 'multi', 'group'
    
    // Group metadata
    this._groupStats = new Map(); // groupId -> stats
    
    // Bloom effect state for visual feedback
    this._bloomStates = new Map(); // groupId -> { enabled, intensity, color }
    this._multiSelectionBloomEnabled = false;
    this._multiSelectionBloomIntensity = 1.0;
    this._ownershipAuraBloomEnabled = options.enableOwnershipAura !== false;
    
    // Selection history for undo/redo
    this._selectionHistory = [];
    this._historyIndex = -1;
    this._maxHistorySize = 50;
    
    // Keyboard state
    this._keyState = {
      ctrl: false,
      shift: false,
      alt: false,
    };
    
    // Event handlers
    this._eventHandlers = new Map();
    
    // Group templates
    this._groupTemplates = {
      fleet: {
        name: 'Fleet Group',
        maxSize: 100,
        icon: '⚓',
        color: [0.2, 0.8, 1.0],
      },
      squadron: {
        name: 'Fighter Squadron',
        maxSize: 12,
        icon: '✈',
        color: [1.0, 0.5, 0.0],
      },
      colony_group: {
        name: 'Colony Group',
        maxSize: 50,
        icon: '⚙',
        color: [0.2, 0.8, 0.2],
      },
      defense_group: {
        name: 'Defense Group',
        maxSize: 30,
        icon: '🛡',
        color: [0.8, 0.2, 0.2],
      },
      exploration: {
        name: 'Exploration Team',
        maxSize: 20,
        icon: '🔭',
        color: [0.8, 0.2, 0.8],
      },
    };
  }

  /**
   * Toggle unit selection with modifier key support
   * @param {object} unit - Unit to toggle
   * @param {object} options - Selection options
   * @param {boolean} options.multiSelect - Ctrl key pressed
   * @param {boolean} options.range - Shift key pressed
   * @param {boolean} options.exclusive - Deselect others (default true for single)
   */
  toggleUnitSelection(unit, options = {}) {
    const { multiSelect = false, range = false, exclusive = true } = options;
    const unitId = this._getUnitId(unit);
    
    if (!unitId) return;
    
    // Save to history before changing selection
    this._saveToHistory();
    
    if (this._activeSelection.has(unitId)) {
      // Deselect unit
      this._activeSelection.delete(unitId);
      this.markerSystem.deselectObject(unit);
      this._emit('unit-deselected', { unit, unitId });
    } else {
      // Clear previous selection if not multiselect
      if (exclusive && !multiSelect && !range) {
        this.clearSelection();
      }
      
      // Select unit
      this._activeSelection.set(unitId, unit);
      this.markerSystem.selectObject(unit, { exclusive: false });
      this._emit('unit-selected', { unit, unitId });
    }
    
    this._updateSelectionMode();
    this._updateMultiSelectionBloom();
  }

  /**
   * Select all units of a type
   * @param {string} unitType - Type of units to select
   * @param {object} container - Container with unit list (e.g., system or colony)
   */
  selectAllOfType(unitType, container) {
    this._saveToHistory();
    this.clearSelection();
    
    if (!container || !container.units) return;
    
    container.units.forEach((unit) => {
      if (unit.type === unitType) {
        this._activeSelection.set(this._getUnitId(unit), unit);
        this.markerSystem.selectObject(unit, { exclusive: false });
      }
    });
    
    this._updateSelectionMode();
    this._emit('selection-changed', { count: this._activeSelection.size });
  }

  /**
   * Create a named group from current selection
   * @param {string} groupName - Name for the group
   * @param {string} templateType - Template type for group
   * @returns {string} Group ID
   */
  createGroupFromSelection(groupName, templateType = 'fleet') {
    if (this._activeSelection.size === 0) return null;
    
    const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const template = this._groupTemplates[templateType] || this._groupTemplates.fleet;
    
    const units = Array.from(this._activeSelection.values());
    
    // Create group
    const group = {
      id: groupId,
      name: groupName || template.name,
      type: templateType,
      units,
      createdAt: performance.now(),
      template,
    };
    
    this._activeGroups.set(groupId, group);
    
    // Update marker system with group
    this.markerSystem.selectGroup(units, templateType, groupId);
    
    // Calculate and cache statistics
    this._updateGroupStats(groupId, group);
    
    // Apply bloom effect to group
    const bloomColor = template.color;
    this.setGroupBloom(groupId, true, 1.2, bloomColor);
    
    this._emit('group-created', { group, groupId });
    
    return groupId;
  }

  /**
   * Add units to existing group
   * @param {string} groupId - Group ID
   * @param {object[]} units - Units to add
   * @returns {boolean} Success
   */
  addUnitsToGroup(groupId, units) {
    const group = this._activeGroups.get(groupId);
    if (!group) return false;
    
    const template = this._groupTemplates[group.type];
    const maxSize = template?.maxSize || 100;
    
    if (group.units.length + units.length > maxSize) {
      console.warn(`Cannot add units - group would exceed max size of ${maxSize}`);
      return false;
    }
    
    units.forEach((unit) => {
      const unitId = this._getUnitId(unit);
      if (!group.units.find(u => this._getUnitId(u) === unitId)) {
        group.units.push(unit);
      }
    });
    
    this._updateGroupStats(groupId, group);
    this._emit('group-modified', { group, groupId });
    
    return true;
  }

  /**
   * Remove units from group
   * @param {string} groupId - Group ID
   * @param {object[]} units - Units to remove
   * @returns {boolean} Success
   */
  removeUnitsFromGroup(groupId, units) {
    const group = this._activeGroups.get(groupId);
    if (!group) return false;
    
    units.forEach((unit) => {
      const unitId = this._getUnitId(unit);
      group.units = group.units.filter(u => this._getUnitId(u) !== unitId);
    });
    
    this._updateGroupStats(groupId, group);
    this._emit('group-modified', { group, groupId });
    
    return true;
  }

  /**
   * Dissolve a group (remove from management)
   * @param {string} groupId - Group ID
   */
  dissolveGroup(groupId) {
    const group = this._activeGroups.get(groupId);
    if (!group) return;
    
    this.markerSystem.deselectGroup(groupId);
    this._activeGroups.delete(groupId);
    this._groupStats.delete(groupId);
    this._bloomStates.delete(groupId);
    
    this._emit('group-dissolved', { groupId });
  }

  /**
   * Clear all selections
   */
  clearSelection() {
    this._saveToHistory();
    this.markerSystem.clearSelection();
    this._activeSelection.clear();
    this._updateSelectionMode();
    this.disableMultiSelectionBloom();
    this._emit('selection-cleared', {});
  }

  /**
   * Get current selection as array
   * @returns {object[]}
   */
  getSelectedUnits() {
    return Array.from(this._activeSelection.values());
  }

  /**
   * Get unit count in selection
   * @returns {number}
   */
  getSelectionCount() {
    return this._activeSelection.size;
  }

  /**
   * Check if unit is selected
   * @param {object} unit - Unit to check
   * @returns {boolean}
   */
  isUnitSelected(unit) {
    return this._activeSelection.has(this._getUnitId(unit));
  }

  /**
   * Get group by ID
   * @param {string} groupId - Group ID
   * @returns {object|null}
   */
  getGroup(groupId) {
    return this._activeGroups.get(groupId) || null;
  }

  /**
   * Get all groups
   * @returns {object[]}
   */
  getAllGroups() {
    return Array.from(this._activeGroups.values());
  }

  /**
   * Get statistics for group
   * @param {string} groupId - Group ID
   * @returns {object|null}
   */
  getGroupStats(groupId) {
    return this._groupStats.get(groupId) || null;
  }

  /**
   * Select group
   * @param {string} groupId - Group ID
   * @param {boolean} exclusive - Clear other selections
   */
  selectGroup(groupId, exclusive = true) {
    const group = this._activeGroups.get(groupId);
    if (!group) return;
    
    this._saveToHistory();
    
    if (exclusive) {
      this.clearSelection();
    }
    
    group.units.forEach((unit) => {
      this._activeSelection.set(this._getUnitId(unit), unit);
      this.markerSystem.selectObject(unit, { exclusive: false });
    });
    
    this._updateSelectionMode();
    this._emit('group-selected', { group, groupId });
  }

  /**
   * Undo last selection
   * @returns {boolean} Success
   */
  undo() {
    if (this._historyIndex > 0) {
      this._historyIndex--;
      this._restoreFromHistory();
      return true;
    }
    return false;
  }

  /**
   * Redo last undone selection
   * @returns {boolean} Success
   */
  redo() {
    if (this._historyIndex < this._selectionHistory.length - 1) {
      this._historyIndex++;
      this._restoreFromHistory();
      return true;
    }
    return false;
  }

  /**
   * Handle keyboard events
   * @param {KeyboardEvent} event - Keyboard event
   */
  handleKeyboardEvent(event) {
    if (event.type === 'keydown') {
      this._keyState.ctrl = event.ctrlKey || event.metaKey;
      this._keyState.shift = event.shiftKey;
      this._keyState.alt = event.altKey;
      
      // Handle shortcuts
      if (this._keyState.ctrl && event.key === 'a') {
        event.preventDefault();
        this._emit('select-all', {}); // Let caller handle based on context
      }
      
      if (this._keyState.ctrl && event.key === 'z') {
        event.preventDefault();
        this.undo();
      }
      
      if ((this._keyState.ctrl && event.key === 'y') || 
          (this._keyState.ctrl && this._keyState.shift && event.key === 'z')) {
        event.preventDefault();
        this.redo();
      }
    } else if (event.type === 'keyup') {
      this._keyState.ctrl = event.ctrlKey || event.metaKey;
      this._keyState.shift = event.shiftKey;
      this._keyState.alt = event.altKey;
    }
  }

  /**
   * Get current key modifiers
   * @returns {object}
   */
  getKeyModifiers() {
    return { ...this._keyState };
  }

  /**
   * Register event handler
   * @param {string} eventName - Event name
   * @param {Function} handler - Handler function
   */
  on(eventName, handler) {
    if (!this._eventHandlers.has(eventName)) {
      this._eventHandlers.set(eventName, []);
    }
    this._eventHandlers.get(eventName).push(handler);
  }

  /**
   * Unregister event handler
   * @param {string} eventName - Event name
   * @param {Function} handler - Handler function
   */
  off(eventName, handler) {
    if (!this._eventHandlers.has(eventName)) return;
    const handlers = this._eventHandlers.get(eventName);
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  /**
   * Update selection mode based on current state
   * @private
   */
  _updateSelectionMode() {
    if (this._activeSelection.size === 0) {
      this._selectionMode = 'single';
    } else if (this._activeSelection.size === 1) {
      this._selectionMode = 'single';
    } else {
      this._selectionMode = 'multi';
    }
  }

  /**
   * Update multi-selection bloom based on selection count
   * @private
   */
  _updateMultiSelectionBloom() {
    if (this._activeSelection.size > 1) {
      // Enable bloom for multi-selection with intensity based on count
      const intensity = Math.min(2.0, 0.8 + (this._activeSelection.size * 0.1));
      this.enableMultiSelectionBloom(intensity);
    } else {
      this.disableMultiSelectionBloom();
    }
  }

  /**
   * Calculate statistics for group
   * @private
   * @param {string} groupId - Group ID
   * @param {object} group - Group object
   */
  _updateGroupStats(groupId, group) {
    const stats = {
      unitCount: group.units.length,
      totalFirepower: 0,
      totalHealth: 0,
      averageLevel: 0,
      types: {},
    };
    
    group.units.forEach((unit) => {
      stats.totalFirepower += unit.firepower || 0;
      stats.totalHealth += unit.health || 0;
      
      const type = unit.type || 'unknown';
      stats.types[type] = (stats.types[type] || 0) + 1;
    });
    
    if (group.units.length > 0) {
      stats.averageLevel = group.units.reduce((sum, u) => sum + (u.level || 0), 0) / group.units.length;
    }
    
    this._groupStats.set(groupId, stats);
  }

  /**
   * Save current selection to history
   * @private
   */
  _saveToHistory() {
    // Remove any future history if we're not at the end
    if (this._historyIndex < this._selectionHistory.length - 1) {
      this._selectionHistory = this._selectionHistory.slice(0, this._historyIndex + 1);
    }
    
    // Add current state
    this._selectionHistory.push({
      units: new Map(this._activeSelection),
      groups: new Map(this._activeGroups),
      timestamp: performance.now(),
    });
    
    // Limit history size
    if (this._selectionHistory.length > this._maxHistorySize) {
      this._selectionHistory.shift();
    } else {
      this._historyIndex++;
    }
  }

  /**
   * Restore selection from history
   * @private
   */
  _restoreFromHistory() {
    if (this._historyIndex < 0 || this._historyIndex >= this._selectionHistory.length) {
      return;
    }
    
    const state = this._selectionHistory[this._historyIndex];
    this._activeSelection = new Map(state.units);
    this._activeGroups = new Map(state.groups);
    
    this._updateSelectionMode();
    this._emit('selection-restored', { state });
  }

  /**
   * Get unit ID from unit or string
   * @private
   * @param {object|string} unitOrId - Unit or its ID
   * @returns {string|null}
   */
  _getUnitId(unitOrId) {
    if (typeof unitOrId === 'string') return unitOrId;
    if (unitOrId && unitOrId.id) return unitOrId.id;
    if (unitOrId && unitOrId.uuid) return unitOrId.uuid;
    return null;
  }

  /**
   * Emit event
   * @private
   * @param {string} eventName - Event name
   * @param {object} data - Event data
   */
  _emit(eventName, data) {
    if (!this._eventHandlers.has(eventName)) return;
    const handlers = this._eventHandlers.get(eventName);
    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`Error in ${eventName} handler:`, err);
      }
    });
  }

  // =========================================================================
  // Bloom Effect Management
  // =========================================================================

  /**
   * Set bloom effect state for a group
   * @param {string} groupId - Group ID
   * @param {boolean} enabled - Enable/disable bloom
   * @param {number} intensity - Bloom intensity [0, 2]
   * @param {number[]} color - RGB color [r, g, b] for bloom tint
   */
  setGroupBloom(groupId, enabled, intensity = 1.0, color = null) {
    const group = this._activeGroups.get(groupId);
    if (!group) return;

    this._bloomStates.set(groupId, {
      enabled,
      intensity: Math.max(0, Math.min(2, intensity)),
      color: color || this._groupTemplates[group.type]?.color || [1.0, 1.0, 1.0],
      groupId,
    });

    this._emit('bloom-updated', {
      groupId,
      enabled,
      intensity,
      color: this._bloomStates.get(groupId).color,
    });
  }

  /**
   * Enable multi-selection bloom feedback
   * @param {number} intensity - Bloom intensity for multi-selection [0, 2]
   */
  enableMultiSelectionBloom(intensity = 1.0) {
    this._multiSelectionBloomEnabled = true;
    this._multiSelectionBloomIntensity = Math.max(0, Math.min(2, intensity));
    this._emit('multi-selection-bloom', {
      enabled: true,
      intensity: this._multiSelectionBloomIntensity,
      unitCount: this._activeSelection.size,
    });
  }

  /**
   * Disable multi-selection bloom feedback
   */
  disableMultiSelectionBloom() {
    this._multiSelectionBloomEnabled = false;
    this._emit('multi-selection-bloom', {
      enabled: false,
      unitCount: this._activeSelection.size,
    });
  }

  /**
   * Check if multi-selection bloom is enabled
   * @returns {boolean}
   */
  isMultiSelectionBloomEnabled() {
    return this._multiSelectionBloomEnabled;
  }

  /**
   * Get multi-selection bloom intensity
   * @returns {number}
   */
  getMultiSelectionBloomIntensity() {
    return this._multiSelectionBloomIntensity;
  }

  /**
   * Get bloom state for group
   * @param {string} groupId - Group ID
   * @returns {object|null}
   */
  getGroupBloom(groupId) {
    return this._bloomStates.get(groupId) || null;
  }

  /**
   * Get all bloom states
   * @returns {Map<string, object>}
   */
  getAllBloomStates() {
    return new Map(this._bloomStates);
  }

  /**
   * Enable/disable ownership aura bloom
   * @param {boolean} enabled - Enable/disable
   */
  setOwnershipAuraBloom(enabled) {
    this._ownershipAuraBloomEnabled = enabled;
    this._emit('ownership-aura-bloom', { enabled });
  }

  /**
   * Check if ownership aura bloom is enabled
   * @returns {boolean}
   */
  isOwnershipAuraBloomEnabled() {
    return this._ownershipAuraBloomEnabled;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GroupSelectionController;
}
if (typeof window !== 'undefined') {
  window.GroupSelectionController = GroupSelectionController;
}
