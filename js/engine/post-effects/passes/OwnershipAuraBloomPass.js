/**
 * OwnershipAuraBloomPass.js
 *
 * Post-processing pass that applies bloom aura effects based on object ownership/faction.
 * Each faction has distinct color characteristics for visual identification across views.
 *
 * Features:
 * - Per-faction bloom color profiles
 * - Configurable intensity per ownership type
 * - Colorblind mode support
 * - Performance-aware rendering
 *
 * Usage:
 *   const auraBloom = new OwnershipAuraBloomPass({
 *     ownershipSystem: ownershipVisuals,
 *     renderer: renderer,
 *   });
 *   composer.addPass(auraBloom);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class OwnershipAuraBloomPass {
  /**
   * @param {object} [opts]
   * @param {OwnershipVisualsSystem} [opts.ownershipSystem] - Ownership visuals system
   * @param {import('../../core/GraphicsContext').IGraphicsRenderer} [opts.renderer] - Renderer
   * @param {number} [opts.baseIntensity=0.8] - Base bloom intensity for auras
   * @param {number} [opts.bloomThreshold=0.7] - Bloom threshold
   */
  constructor(opts = {}) {
    this.enabled = opts.enableOwnershipAura !== false;
    this.ownershipSystem = opts.ownershipSystem || null;
    this.renderer = opts.renderer || null;

    // Bloom parameters
    this.baseIntensity = opts.baseIntensity ?? 0.8;
    this.bloomThreshold = opts.bloomThreshold ?? 0.7;

    // Faction bloom intensity modifiers
    this._factionIntensities = {
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
    };

    // Color mode overrides for colorblind modes
    this._colorblindIntensities = {
      deuteranopia: 0.95,
      protanopia: 0.95,
      tritanopia: 0.9,
      achromatic: 0.7,
    };

    // Tracked objects with ownership auras
    this._auraObjects = new Map(); // objectId -> { faction, intensity }

    // Performance tracking
    this._lastUpdateTime = 0;
    this._updateThrottleMs = 32; // ~30 FPS for auras (less frequent than selection)
  }

  /**
   * Register an object for ownership aura bloom
   * @param {object} object - Game object with ownership
   * @param {string} factionId - Faction ID
   * @param {number} intensity - Optional intensity override [0, 2]
   */
  registerObjectAura(object, factionId, intensity = null) {
    const objectId = object.id || object.uuid;
    if (!objectId) return false;

    const baseIntensity = this._factionIntensities[factionId] || 0.8;
    const finalIntensity = intensity !== null ? intensity : baseIntensity * this.baseIntensity;

    this._auraObjects.set(objectId, {
      object,
      faction: factionId,
      intensity: Math.max(0, Math.min(2.0, finalIntensity)),
    });

    return true;
  }

  /**
   * Unregister an object for aura bloom
   * @param {object} object - Game object
   * @returns {boolean} Success
   */
  unregisterObjectAura(object) {
    const objectId = object.id || object.uuid;
    if (!objectId) return false;
    return this._auraObjects.delete(objectId);
  }

  /**
   * Clear all registered aura objects
   */
  clearAllAuras() {
    this._auraObjects.clear();
  }

  /**
   * Set colorblind mode for aura intensity compensation
   * @param {string} mode - Colorblind mode (normal|deuteranopia|protanopia|tritanopia|achromatic)
   */
  setColorblindMode(mode) {
    if (mode === 'normal' || !this._colorblindIntensities.hasOwnProperty(mode)) {
      this._colorblindIntensity = 1.0;
    } else {
      this._colorblindIntensity = this._colorblindIntensities[mode];
    }
  }

  /**
   * Render ownership aura bloom
   * @param {object} srcTexture - Source render target texture
   * @param {object} dstTexture - Destination render target texture
   * @param {import('../../core/GraphicsContext').IGraphicsRenderer} renderer - Renderer
   */
  render(srcTexture, dstTexture, renderer) {
    if (!this.enabled || this._auraObjects.size === 0) {
      return;
    }

    // Throttle updates to reduce performance impact
    const now = performance.now();
    if (now - this._lastUpdateTime < this._updateThrottleMs) {
      return;
    }
    this._lastUpdateTime = now;

    this._applyOwnershipAuraEffects(srcTexture, dstTexture, renderer);
  }

  /**
   * Apply ownership aura bloom effects
   * @private
   */
  _applyOwnershipAuraEffects(srcTexture, dstTexture, renderer) {
    // Group objects by faction for efficient batch rendering
    const objectsByFaction = new Map();

    for (const [objectId, auraData] of this._auraObjects.entries()) {
      const faction = auraData.faction;
      if (!objectsByFaction.has(faction)) {
        objectsByFaction.set(faction, []);
      }
      objectsByFaction.get(faction).push(auraData);
    }

    // Render aura effects for each faction
    for (const [factionId, auraList] of objectsByFaction.entries()) {
      this._renderFactionAuraGroup(
        factionId,
        auraList,
        srcTexture,
        dstTexture,
        renderer
      );
    }
  }

  /**
   * Render aura bloom for a group of objects from same faction
   * @private
   */
  _renderFactionAuraGroup(factionId, auraList, srcTexture, dstTexture, renderer) {
    // Get faction color from ownership system if available
    const factionColor = this.ownershipSystem?.getOwnershipColor(factionId);
    if (!factionColor) return;

    // Calculate combined intensity for this faction group
    const avgIntensity =
      auraList.reduce((sum, a) => sum + a.intensity, 0) / auraList.length;
    const colorblindModifier = this._colorblindIntensity || 1.0;
    const finalIntensity = avgIntensity * colorblindModifier;

    // Emit event for renderer to process (in a full implementation)
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(
        new CustomEvent('ownershipaura:render', {
          detail: {
            faction: factionId,
            objects: auraList.map((a) => a.object),
            color: factionColor.primary,
            intensity: finalIntensity,
            threshold: this.bloomThreshold,
          },
        })
      );
    }
  }

  /**
   * Get all registered aura objects
   * @returns {Map<string, object>}
   */
  getRegisteredAuras() {
    return new Map(this._auraObjects);
  }

  /**
   * Get aura data for object
   * @param {object} object - Game object
   * @returns {object|null}
   */
  getObjectAura(object) {
    const objectId = object.id || object.uuid;
    if (!objectId) return null;
    return this._auraObjects.get(objectId) || null;
  }

  /**
   * Get faction bloom intensity
   * @param {string} factionId - Faction ID
   * @returns {number}
   */
  getFactionIntensity(factionId) {
    return this._factionIntensities[factionId] || 0.8;
  }

  /**
   * Set faction bloom intensity
   * @param {string} factionId - Faction ID
   * @param {number} intensity - Intensity [0, 2]
   */
  setFactionIntensity(factionId, intensity) {
    this._factionIntensities[factionId] = Math.max(0, Math.min(2.0, intensity));
  }

  /**
   * Get bloom uniforms for current state
   * @returns {object}
   */
  getUniformData() {
    return {
      baseIntensity: this.baseIntensity,
      bloomThreshold: this.bloomThreshold,
      enableOwnershipAura: this.enabled ? 1.0 : 0.0,
      auraObjectCount: this._auraObjects.size,
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OwnershipAuraBloomPass };
}
if (typeof window !== 'undefined') {
  window.OwnershipAuraBloomPass = OwnershipAuraBloomPass;
}
