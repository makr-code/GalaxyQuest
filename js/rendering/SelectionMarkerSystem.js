/**
 * SelectionMarkerSystem.js
 *
 * Unified selection visualization system across all game views.
 * Manages persistent selection markers (golden, pulsing), temporary hover markers
 * (blue, static), group selection highlighting, and faction-specific visual tokens.
 *
 * Architecture:
 * - Marker Pool: Pre-allocated markers for efficiency
 * - State Tracking: Maintains selection/hover state independently
 * - Visual Hierarchy: z-index layering for proper depth ordering
 * - Performance Optimization: Culling, instance rendering
 *
 * Usage:
 *   const markerSystem = new SelectionMarkerSystem(renderer, options);
 *   markerSystem.selectObject(object, { persistent: true });
 *   markerSystem.hoverObject(object);
 *   markerSystem.selectGroup(objects, 'fleet');
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class SelectionMarkerSystem {
  /**
   * @param {ViewRenderer|Galaxy3DRendererWebGPU} renderer - Parent renderer
   * @param {object} options - Configuration options
   * @param {number} options.maxMarkers - Maximum markers to pool (default: 1000)
   * @param {boolean} options.enablePulsing - Enable pulsing animation (default: true)
   * @param {boolean} options.enableGlow - Enable glow effect (default: true)
   */
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    
    this.maxMarkers = options.maxMarkers || 1000;
    this.enablePulsing = options.enablePulsing !== false;
    this.enableGlow = options.enableGlow !== false;
    
    // Marker pool and state
    this._markerPool = [];
    this._activeMarkers = new Map(); // objectId -> marker
    this._markerStates = new Map(); // objectId -> state object
    
    // Selection state
    this._selectedObjects = new Set();
    this._hoveredObject = null;
    this._groupSelection = new Map(); // groupId -> Set of objectIds
    
    // Marker styles
    this._markerStyles = {
      selection: {
        color: [1.0, 0.84, 0.0, 1.0], // Golden
        size: 1.2,
        zIndex: 21,
        pulsing: true,
        pulseSpeed: 2.0,
      },
      hover: {
        color: [0.2, 0.8, 1.0, 1.0], // Cyan
        size: 1.0,
        zIndex: 20,
        pulsing: false,
        pulseSpeed: 0.0,
      },
      group: {
        color: [0.5, 1.0, 0.5, 0.7], // Light green, semi-transparent
        size: 1.5,
        zIndex: 19,
        pulsing: true,
        pulseSpeed: 1.5,
      },
    };
    
    // Animation state
    this._time = 0;
    this._lastUpdateTime = performance.now();
    
    // Faction color mapping
    this._factionColors = {
      'helion_confederation': [0.2, 0.8, 1.0],
      'myr_keth': [0.9, 0.1, 0.4],
      'brut_der_ewigkeit': [0.8, 0.8, 0.8],
      'omniscienta': [1.0, 0.8, 0.2],
      'schattenkompakt': [0.3, 0.3, 0.3],
      'echos_der_leere': [0.5, 0.2, 0.8],
      'khar_morr_syndicate': [0.8, 0.2, 0.2],
      'genesis_kollektiv': [0.2, 0.8, 0.2],
      'architekten_des_lichts': [1.0, 1.0, 0.0],
      'ketzer_von_verath': [0.8, 0.3, 0.8],
      'aethernox': [0.1, 0.5, 1.0],
      'nomaden_des_rifts': [1.0, 0.5, 0.0],
      'iron_fleet': [0.7, 0.7, 0.7],
    };
  }

  /**
   * Select an object with optional persistence
   * @param {object} object - Object to select
   * @param {object} options - Selection options
   * @param {boolean} options.persistent - Whether to keep marker after interaction
   * @param {string} options.style - 'selection', 'hover', 'group'
   * @param {boolean} options.exclusive - Clear other selections
   */
  selectObject(object, options = {}) {
    const objectId = this._getObjectId(object);
    if (!objectId) return;
    
    const { persistent = true, style = 'selection', exclusive = true } = options;
    
    // Clear previous selection if exclusive
    if (exclusive && persistent) {
      this._selectedObjects.forEach(id => {
        if (id !== objectId) {
          this.deselectObject(this._getObjectById(id));
        }
      });
    }
    
    // Add to selection set
    this._selectedObjects.add(objectId);
    
    // Create marker
    const marker = this._createMarker(objectId, object, style);
    this._activeMarkers.set(objectId, marker);
    
    // Track marker state
    this._markerStates.set(objectId, {
      type: 'selection',
      persistent,
      style,
      createdAt: performance.now(),
    });
    
    // Emit event
    this._emit('marker-selected', { object, objectId, marker });
  }

  /**
   * Deselect an object
   * @param {object} object - Object to deselect
   */
  deselectObject(object) {
    const objectId = this._getObjectId(object);
    if (!objectId) return;
    
    this._selectedObjects.delete(objectId);
    const marker = this._activeMarkers.get(objectId);
    
    if (marker) {
      this._releaseMarker(marker);
      this._activeMarkers.delete(objectId);
      this._markerStates.delete(objectId);
    }
    
    this._emit('marker-deselected', { object, objectId });
  }

  /**
   * Hover over an object (temporary)
   * @param {object} object - Object to hover
   */
  hoverObject(object) {
    const objectId = this._getObjectId(object);
    if (!objectId) return;
    
    // Clear previous hover
    if (this._hoveredObject) {
      this.clearHover();
    }
    
    this._hoveredObject = objectId;
    
    // Don't create marker if already selected
    if (!this._selectedObjects.has(objectId)) {
      const marker = this._createMarker(objectId, object, 'hover');
      this._activeMarkers.set(objectId, marker);
      
      this._markerStates.set(objectId, {
        type: 'hover',
        persistent: false,
        style: 'hover',
        createdAt: performance.now(),
      });
    }
    
    this._emit('marker-hovered', { object, objectId });
  }

  /**
   * Clear hover state
   */
  clearHover() {
    if (!this._hoveredObject) return;
    
    const objectId = this._hoveredObject;
    const state = this._markerStates.get(objectId);
    
    // Only remove if this was a hover marker (not selected)
    if (state && state.type === 'hover') {
      const marker = this._activeMarkers.get(objectId);
      if (marker) {
        this._releaseMarker(marker);
        this._activeMarkers.delete(objectId);
      }
      this._markerStates.delete(objectId);
    }
    
    this._hoveredObject = null;
    this._emit('hover-cleared', {});
  }

  /**
   * Select multiple objects as a group
   * @param {object[]} objects - Objects to select
   * @param {string} groupType - Type of group ('fleet', 'fleet', 'colony_group', etc.)
   * @param {string} groupId - Optional group identifier
   * @returns {string} Group ID
   */
  selectGroup(objects, groupType, groupId = null) {
    groupId = groupId || `group_${Date.now()}_${Math.random()}`;
    
    const objectIds = new Set();
    objects.forEach(obj => {
      const id = this._getObjectId(obj);
      if (id) {
        objectIds.add(id);
        this.selectObject(obj, { exclusive: false, style: 'group' });
      }
    });
    
    this._groupSelection.set(groupId, objectIds);
    this._emit('group-selected', { groupId, groupType, count: objectIds.size });
    
    return groupId;
  }

  /**
   * Deselect a group
   * @param {string} groupId - Group identifier
   */
  deselectGroup(groupId) {
    const objectIds = this._groupSelection.get(groupId);
    if (!objectIds) return;
    
    objectIds.forEach(id => {
      this.deselectObject(this._getObjectById(id));
    });
    
    this._groupSelection.delete(groupId);
    this._emit('group-deselected', { groupId });
  }

  /**
   * Clear all selections
   */
  clearSelection() {
    this._selectedObjects.forEach(id => {
      this.deselectObject(this._getObjectById(id));
    });
    this._selectedObjects.clear();
    this._groupSelection.clear();
  }

  /**
   * Get all selected object IDs
   * @returns {string[]}
   */
  getSelectedObjectIds() {
    return Array.from(this._selectedObjects);
  }

  /**
   * Get group members
   * @param {string} groupId - Group identifier
   * @returns {string[]|null}
   */
  getGroupMembers(groupId) {
    const ids = this._groupSelection.get(groupId);
    return ids ? Array.from(ids) : null;
  }

  /**
   * Set marker visual style
   * @param {string} markerType - 'selection', 'hover', 'group'
   * @param {object} style - Style properties
   */
  setMarkerStyle(markerType, style) {
    if (this._markerStyles[markerType]) {
      this._markerStyles[markerType] = {
        ...this._markerStyles[markerType],
        ...style,
      };
    }
  }

  /**
   * Get marker visual style
   * @param {string} markerType - 'selection', 'hover', 'group'
   * @returns {object}
   */
  getMarkerStyle(markerType) {
    return { ...this._markerStyles[markerType] };
  }

  /**
   * Apply faction-specific marker color
   * @param {string} objectId - Object ID
   * @param {string} factionId - Faction ID
   */
  applyFactionMarkerColor(objectId, factionId) {
    const color = this._factionColors[factionId];
    if (!color) return;
    
    const marker = this._activeMarkers.get(objectId);
    if (marker) {
      marker.color = [...color, 1.0];
    }
  }

  /**
   * Update marker animations
   */
  update() {
    const now = performance.now();
    const deltaTime = (now - this._lastUpdateTime) / 1000;
    this._lastUpdateTime = now;
    this._time += deltaTime;
    
    // Update pulsing animations
    this._activeMarkers.forEach((marker, objectId) => {
      const state = this._markerStates.get(objectId);
      if (!state) return;
      
      const style = this._markerStyles[state.style];
      if (style && style.pulsing) {
        const pulse = Math.sin(this._time * style.pulseSpeed * Math.PI) * 0.3 + 0.7;
        marker.scale = style.size * pulse;
        marker.opacity = 0.7 + pulse * 0.3;
      }
    });
  }

  /**
   * Get marker at screen coordinates
   * @param {number} screenX - Screen X coordinate
   * @param {number} screenY - Screen Y coordinate
   * @returns {object|null} Marker or null
   */
  getMarkerAtScreenCoord(screenX, screenY) {
    for (const [objectId, marker] of this._activeMarkers) {
      if (this._isPointInMarker(screenX, screenY, marker)) {
        return marker;
      }
    }
    return null;
  }

  /**
   * Render all markers (abstract - subclass must implement)
   * @protected
   */
  render() {
    // Implement in subclass or call renderer's marker rendering
  }

  /**
   * Create a marker object
   * @private
   * @param {string} objectId - Object ID
   * @param {object} object - The actual object
   * @param {string} style - Marker style type
   * @returns {object} Marker object
   */
  _createMarker(objectId, object, style) {
    const markerStyle = this._markerStyles[style];
    return {
      objectId,
      object,
      style,
      color: [...markerStyle.color],
      size: markerStyle.size,
      scale: markerStyle.size,
      opacity: 0.8,
      zIndex: markerStyle.zIndex,
      createdAt: performance.now(),
    };
  }

  /**
   * Release marker back to pool
   * @private
   * @param {object} marker - Marker to release
   */
  _releaseMarker(marker) {
    // Could add marker back to pool for reuse
    // For now, just clear references
  }

  /**
   * Get object ID from object or string
   * @private
   * @param {object|string} objectOrId - Object or its ID
   * @returns {string|null}
   */
  _getObjectId(objectOrId) {
    if (typeof objectOrId === 'string') {
      return objectOrId;
    }
    if (objectOrId && objectOrId.id) {
      return objectOrId.id;
    }
    if (objectOrId && objectOrId.uuid) {
      return objectOrId.uuid;
    }
    return null;
  }

  /**
   * Get object by ID (for reverse lookups)
   * @private
   * @param {string} objectId - Object ID
   * @returns {object|null}
   */
  _getObjectById(objectId) {
    // This would need to be implemented based on game's object storage
    // For now, return a placeholder
    return { id: objectId };
  }

  /**
   * Check if point is inside marker
   * @private
   * @param {number} x - Screen X
   * @param {number} y - Screen Y
   * @param {object} marker - Marker object
   * @returns {boolean}
   */
  _isPointInMarker(x, y, marker) {
    // Implement based on marker geometry
    // This is a placeholder that could use marker.position and marker.radius
    return false;
  }

  /**
   * Emit event
   * @private
   * @param {string} eventName - Event name
   * @param {object} data - Event data
   */
  _emit(eventName, data) {
    if (this.renderer && this.renderer._emit) {
      this.renderer._emit(`marker:${eventName}`, data);
    }
  }
}

// Export for use in browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SelectionMarkerSystem;
}
if (typeof window !== 'undefined') {
  window.SelectionMarkerSystem = SelectionMarkerSystem;
}
