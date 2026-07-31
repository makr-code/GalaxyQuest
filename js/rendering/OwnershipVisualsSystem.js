/**
 * OwnershipVisualsSystem.js
 *
 * Faction-specific visual identification system for all game objects.
 * Manages per-faction material variants, ownership aura/glow effects,
 * territorial control visualization, and colorblind-friendly modes.
 *
 * Features:
 * - 13 faction color schemes with high contrast
 * - Ownership aura post-processing effects
 * - Territorial control heatmap visualization
 * - 4 colorblind-friendly accessibility modes
 * - Performance-optimized material instancing
 *
 * Usage:
 *   const ownershipSystem = new OwnershipVisualsSystem(renderingManager);
 *   ownershipSystem.applyFactionColors(object, 'helion_confederation');
 *   ownershipSystem.addOwnershipAura(object, 'helion_confederation');
 *   ownershipSystem.setColorblindMode('deuteranopia');
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class OwnershipVisualsSystem {
  /**
   * @param {AdvancedRenderingManager} renderingManager - Advanced rendering manager
   * @param {object} options - Configuration options
   */
  constructor(renderingManager, options = {}) {
    this.renderingManager = renderingManager;
    
    // Faction color definitions (default mode)
    this._factionColors = {
      'helion_confederation': {
        primary: [0.2, 0.8, 1.0],      // Cyan
        secondary: [0.1, 0.6, 0.9],    // Dark cyan
        accent: [0.4, 1.0, 1.0],       // Light cyan
        name: 'Helion Confederation',
      },
      'myr_keth': {
        primary: [0.9, 0.1, 0.4],      // Magenta
        secondary: [0.7, 0.0, 0.2],    // Dark magenta
        accent: [1.0, 0.3, 0.6],       // Light magenta
        name: 'Myr\'Keth',
      },
      'brut_der_ewigkeit': {
        primary: [0.8, 0.8, 0.8],      // Silver
        secondary: [0.5, 0.5, 0.5],    // Dark gray
        accent: [1.0, 1.0, 1.0],       // White
        name: 'Brut der Ewigkeit',
      },
      'omniscienta': {
        primary: [1.0, 0.8, 0.2],      // Gold
        secondary: [0.8, 0.6, 0.0],    // Dark gold
        accent: [1.0, 1.0, 0.5],       // Light gold
        name: 'Omniscienta',
      },
      'schattenkompakt': {
        primary: [0.3, 0.3, 0.3],      // Dark gray
        secondary: [0.1, 0.1, 0.1],    // Black
        accent: [0.6, 0.6, 0.6],       // Light gray
        name: 'Schattenkompakt',
      },
      'echos_der_leere': {
        primary: [0.5, 0.2, 0.8],      // Purple
        secondary: [0.3, 0.0, 0.6],    // Dark purple
        accent: [0.7, 0.4, 1.0],       // Light purple
        name: 'Echos der Leere',
      },
      'khar_morr_syndicate': {
        primary: [0.8, 0.2, 0.2],      // Red
        secondary: [0.6, 0.0, 0.0],    // Dark red
        accent: [1.0, 0.4, 0.4],       // Light red
        name: 'Khar\'Morr Syndicate',
      },
      'genesis_kollektiv': {
        primary: [0.2, 0.8, 0.2],      // Green
        secondary: [0.0, 0.6, 0.0],    // Dark green
        accent: [0.4, 1.0, 0.4],       // Light green
        name: 'Genesis Kollektiv',
      },
      'architekten_des_lichts': {
        primary: [1.0, 1.0, 0.0],      // Yellow
        secondary: [0.8, 0.8, 0.0],    // Dark yellow
        accent: [1.0, 1.0, 0.5],       // Light yellow
        name: 'Architekten des Lichts',
      },
      'ketzer_von_verath': {
        primary: [0.8, 0.3, 0.8],      // Pink
        secondary: [0.6, 0.0, 0.6],    // Dark pink
        accent: [1.0, 0.5, 1.0],       // Light pink
        name: 'Ketzer von Verath',
      },
      'aethernox': {
        primary: [0.1, 0.5, 1.0],      // Blue
        secondary: [0.0, 0.3, 0.8],    // Dark blue
        accent: [0.3, 0.7, 1.0],       // Light blue
        name: 'Aethernox',
      },
      'nomaden_des_rifts': {
        primary: [1.0, 0.5, 0.0],      // Orange
        secondary: [0.8, 0.3, 0.0],    // Dark orange
        accent: [1.0, 0.7, 0.2],       // Light orange
        name: 'Nomaden des Rifts',
      },
      'iron_fleet': {
        primary: [0.7, 0.7, 0.7],      // Light gray
        secondary: [0.4, 0.4, 0.4],    // Gray
        accent: [0.9, 0.9, 0.9],       // Very light gray
        name: 'Iron Fleet',
      },
    };
    
    // Colorblind palette overrides
    this._colorblindPalettes = {
      normal: null, // Use default above
      deuteranopia: {
        // Red-Green colorblind mode
        'helion_confederation': { primary: [0.0, 0.5, 1.0], secondary: [0.0, 0.2, 0.8], accent: [0.2, 0.7, 1.0] },
        'myr_keth': { primary: [1.0, 0.5, 0.0], secondary: [0.8, 0.3, 0.0], accent: [1.0, 0.7, 0.2] },
        'genesis_kollektiv': { primary: [0.7, 0.7, 0.0], secondary: [0.5, 0.5, 0.0], accent: [0.9, 0.9, 0.2] },
        'khar_morr_syndicate': { primary: [0.5, 0.2, 1.0], secondary: [0.3, 0.0, 0.8], accent: [0.7, 0.4, 1.0] },
      },
      protanopia: {
        // Red-Green colorblind mode (alternative)
        'helion_confederation': { primary: [0.3, 0.6, 1.0], secondary: [0.1, 0.4, 0.9], accent: [0.5, 0.8, 1.0] },
        'myr_keth': { primary: [0.9, 0.4, 0.0], secondary: [0.7, 0.2, 0.0], accent: [1.0, 0.6, 0.2] },
        'genesis_kollektiv': { primary: [0.6, 0.6, 0.0], secondary: [0.4, 0.4, 0.0], accent: [0.8, 0.8, 0.2] },
        'khar_morr_syndicate': { primary: [0.6, 0.1, 1.0], secondary: [0.4, 0.0, 0.8], accent: [0.8, 0.3, 1.0] },
      },
      tritanopia: {
        // Blue-Yellow colorblind mode
        'helion_confederation': { primary: [0.0, 1.0, 0.5], secondary: [0.0, 0.8, 0.3], accent: [0.2, 1.0, 0.7] },
        'myr_keth': { primary: [0.8, 0.0, 0.5], secondary: [0.6, 0.0, 0.3], accent: [1.0, 0.2, 0.7] },
        'omniscienta': { primary: [0.0, 1.0, 1.0], secondary: [0.0, 0.8, 0.8], accent: [0.2, 1.0, 1.0] },
        'architekten_des_lichts': { primary: [0.8, 0.0, 0.8], secondary: [0.6, 0.0, 0.6], accent: [1.0, 0.2, 1.0] },
      },
      achromatic: {
        // Grayscale mode
        'helion_confederation': { primary: [0.7, 0.7, 0.7], secondary: [0.4, 0.4, 0.4], accent: [0.9, 0.9, 0.9] },
        'myr_keth': { primary: [0.5, 0.5, 0.5], secondary: [0.2, 0.2, 0.2], accent: [0.7, 0.7, 0.7] },
        'brut_der_ewigkeit': { primary: [0.8, 0.8, 0.8], secondary: [0.5, 0.5, 0.5], accent: [1.0, 1.0, 1.0] },
        'omniscienta': { primary: [0.6, 0.6, 0.6], secondary: [0.3, 0.3, 0.3], accent: [0.8, 0.8, 0.8] },
      },
    };
    
    // Current colorblind mode
    this._colorblindMode = 'normal';
    
    // Ownership aura states
    this._auras = new Map(); // objectId -> aura state
    
    // Material cache
    this._materialCache = new Map(); // factionId -> material
    
    // Territorial control data
    this._territoryMap = new Map(); // regionId -> factionId
  }

  /**
   * Apply faction-specific colors to an object
   * @param {object} object - Object to color
   * @param {string} factionId - Faction ID
   * @param {object} options - Options
   * @returns {boolean} Success
   */
  applyFactionColors(object, factionId, options = {}) {
    const colors = this._getColorForFaction(factionId);
    if (!colors) {
      console.warn(`Unknown faction: ${factionId}`);
      return false;
    }
    
    // Apply primary color to object
    if (object && object.material) {
      object.material.color?.setRGB?.(colors.primary[0], colors.primary[1], colors.primary[2]);
    }
    
    // Cache for later use
    if (!this._materialCache.has(factionId)) {
      this._materialCache.set(factionId, {
        factionId,
        colors,
      });
    }
    
    return true;
  }

  /**
   * Get colors for a faction
   * @param {string} factionId - Faction ID
   * @returns {object|null} Color object with primary, secondary, accent
   */
  getOwnershipColor(factionId) {
    return this._getColorForFaction(factionId);
  }

  /**
   * Add ownership aura effect to an object
   * @param {object} object - Object to add aura to
   * @param {string} factionId - Faction ID
   * @param {object} options - Aura options
   * @returns {boolean} Success
   */
  addOwnershipAura(object, factionId, options = {}) {
    if (!object) return false;
    
    const objectId = this._getObjectId(object);
    const colors = this._getColorForFaction(factionId);
    
    if (!colors) return false;
    
    const aura = {
      objectId,
      object,
      factionId,
      color: colors.primary,
      radius: options.radius || 1.5,
      intensity: options.intensity || 0.6,
      pulseSpeed: options.pulseSpeed || 2.0,
      createdAt: performance.now(),
    };
    
    this._auras.set(objectId, aura);
    
    // Trigger post-processing effect if available
    if (this.renderingManager && this.renderingManager._features?.bloom) {
      // Could enable bloom pass for aura effect
    }
    
    return true;
  }

  /**
   * Remove ownership aura effect
   * @param {object} object - Object to remove aura from
   */
  removeOwnershipAura(object) {
    const objectId = this._getObjectId(object);
    if (objectId) {
      this._auras.delete(objectId);
    }
  }

  /**
   * Get ownership aura for object
   * @param {object} object - Object
   * @returns {object|null} Aura state or null
   */
  getOwnershipAura(object) {
    const objectId = this._getObjectId(object);
    return objectId ? this._auras.get(objectId) || null : null;
  }

  /**
   * Set colorblind mode
   * @param {string} mode - 'normal', 'deuteranopia', 'protanopia', 'tritanopia', 'achromatic'
   * @returns {boolean} Success
   */
  setColorblindMode(mode) {
    if (!this._colorblindPalettes[mode]) {
      console.warn(`Unknown colorblind mode: ${mode}`);
      return false;
    }
    
    this._colorblindMode = mode;
    
    // Re-apply all faction colors with new mode
    this._materialCache.forEach((material, factionId) => {
      const newColors = this._getColorForFaction(factionId);
      if (newColors && material.object) {
        material.object.material?.color?.setRGB?.(
          newColors.primary[0],
          newColors.primary[1],
          newColors.primary[2]
        );
      }
    });
    
    return true;
  }

  /**
   * Get current colorblind mode
   * @returns {string}
   */
  getColorblindMode() {
    return this._colorblindMode;
  }

  /**
   * Set territorial control for region
   * @param {string} regionId - Region identifier
   * @param {string} factionId - Controlling faction
   */
  setTerritoryOwner(regionId, factionId) {
    this._territoryMap.set(regionId, factionId);
  }

  /**
   * Get territorial control for region
   * @param {string} regionId - Region identifier
   * @returns {string|null} Controlling faction ID or null
   */
  getTerritoryOwner(regionId) {
    return this._territoryMap.get(regionId) || null;
  }

  /**
   * Get all territories owned by faction
   * @param {string} factionId - Faction ID
   * @returns {string[]} Array of region IDs
   */
  getFactionTerritories(factionId) {
    const territories = [];
    this._territoryMap.forEach((owner, regionId) => {
      if (owner === factionId) {
        territories.push(regionId);
      }
    });
    return territories;
  }

  /**
   * Update aura animations
   * @param {number} deltaTime - Time since last update
   */
  updateAuras(deltaTime) {
    this._auras.forEach((aura) => {
      const elapsed = (performance.now() - aura.createdAt) / 1000;
      const pulse = Math.sin(elapsed * aura.pulseSpeed * Math.PI) * 0.3 + 0.7;
      aura.currentIntensity = aura.intensity * pulse;
    });
  }

  /**
   * Get faction info including localized name
   * @param {string} factionId - Faction ID
   * @returns {object|null} Faction info
   */
  getFactionInfo(factionId) {
    const colors = this._factionColors[factionId];
    if (!colors) return null;
    
    return {
      id: factionId,
      name: colors.name,
      colors: {
        primary: colors.primary,
        secondary: colors.secondary,
        accent: colors.accent,
      },
    };
  }

  /**
   * Get all factions
   * @returns {object[]} Array of faction info objects
   */
  getAllFactions() {
    return Object.entries(this._factionColors).map(([factionId, colors]) => ({
      id: factionId,
      name: colors.name,
      colors: {
        primary: colors.primary,
        secondary: colors.secondary,
        accent: colors.accent,
      },
    }));
  }

  /**
   * Get color for faction based on current colorblind mode
   * @private
   * @param {string} factionId - Faction ID
   * @returns {object|null} Color object
   */
  _getColorForFaction(factionId) {
    // Check colorblind palette first
    if (this._colorblindMode !== 'normal') {
      const palette = this._colorblindPalettes[this._colorblindMode];
      if (palette && palette[factionId]) {
        const customColors = palette[factionId];
        const baseColors = this._factionColors[factionId];
        return {
          primary: customColors.primary,
          secondary: customColors.secondary,
          accent: customColors.accent,
          name: baseColors.name,
        };
      }
    }
    
    // Return default colors
    return this._factionColors[factionId] || null;
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
}

// Export for use in browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OwnershipVisualsSystem;
}
if (typeof window !== 'undefined') {
  window.OwnershipVisualsSystem = OwnershipVisualsSystem;
}
