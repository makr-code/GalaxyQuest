/**
 * GroupHighlightBloomPass.js
 *
 * Post-processing pass that applies selective bloom highlighting to multi-unit groups.
 * Renders groups with bloom effects to provide visual feedback for selection grouping.
 *
 * Features:
 * - Dynamic intensity based on group size
 * - Faction/template-based color tinting
 * - Efficient group boundary rendering
 * - Performance-aware fallback modes
 *
 * Usage:
 *   const groupBloom = new GroupHighlightBloomPass({
 *     groupSelectionController: groupCtrl,
 *     renderer: renderer,
 *   });
 *   composer.addPass(groupBloom);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class GroupHighlightBloomPass {
  /**
   * @param {object} [opts]
   * @param {GroupSelectionController} [opts.groupSelectionController] - Selection controller
   * @param {import('../../core/GraphicsContext').IGraphicsRenderer} [opts.renderer] - Renderer
   * @param {number} [opts.bloomThreshold=0.6] - Threshold for bloom extraction
   * @param {number} [opts.bloomStrength=1.5] - Base bloom strength multiplier
   * @param {number} [opts.groupBoundaryWidth=2] - Width of group boundary outline
   */
  constructor(opts = {}) {
    this.enabled = true;
    this.groupSelectionController = opts.groupSelectionController || null;
    this.renderer = opts.renderer || null;

    // Bloom parameters
    this.bloomThreshold = opts.bloomThreshold ?? 0.6;
    this.bloomStrength = opts.bloomStrength ?? 1.5;
    this.groupBoundaryWidth = opts.groupBoundaryWidth ?? 2;

    // Rendering state
    this._groupMeshes = new Map(); // groupId -> Three.js mesh/WebGPU buffer
    this._groupBoundaries = new Map(); // groupId -> boundary geometry
    this._pipeline = null;

    // Performance tracking
    this._lastUpdateTime = 0;
    this._updateThrottleMs = 16; // ~60 FPS
  }

  /**
   * Check if this pass should apply bloom for multi-selection
   * @returns {boolean}
   */
  shouldApplyMultiSelectionBloom() {
    if (!this.groupSelectionController) return false;
    return this.groupSelectionController.isMultiSelectionBloomEnabled();
  }

  /**
   * Get multi-selection bloom parameters
   * @returns {object}
   */
  getMultiSelectionBloomParams() {
    if (!this.groupSelectionController) {
      return { enabled: false, intensity: 1.0, color: [1.0, 1.0, 1.0] };
    }

    return {
      enabled: this.groupSelectionController.isMultiSelectionBloomEnabled(),
      intensity: this.groupSelectionController.getMultiSelectionBloomIntensity(),
      color: [1.0, 1.0, 0.5], // Default greenish-yellow for multi-selection
    };
  }

  /**
   * Get all active group bloom states
   * @returns {Map<string, object>}
   */
  getActiveGroupBlooms() {
    if (!this.groupSelectionController) return new Map();
    return this.groupSelectionController.getAllBloomStates();
  }

  /**
   * Render group highlights with bloom
   * @param {object} srcTexture - Source render target texture
   * @param {object} dstTexture - Destination render target texture
   * @param {import('../../core/GraphicsContext').IGraphicsRenderer} renderer - Renderer
   */
  render(srcTexture, dstTexture, renderer) {
    if (!this.enabled) return;

    // Throttle updates to avoid excessive processing
    const now = performance.now();
    if (now - this._lastUpdateTime < this._updateThrottleMs) {
      return;
    }
    this._lastUpdateTime = now;

    // Check if we have any bloom effects to apply
    const multiSelectBloom = this.getMultiSelectionBloomParams();
    const groupBlooms = this.getActiveGroupBlooms();

    if (!multiSelectBloom.enabled && groupBlooms.size === 0) {
      // No bloom effects to apply - just pass through
      return;
    }

    // Apply bloom effects
    this._applyGroupBloomEffects(srcTexture, dstTexture, renderer);
  }

  /**
   * Apply bloom effects to groups
   * @private
   */
  _applyGroupBloomEffects(srcTexture, dstTexture, renderer) {
    const multiSelectBloom = this.getMultiSelectionBloomParams();
    const groupBlooms = this.getActiveGroupBlooms();

    // Build render queue for all active blooms
    const bloomQueue = [];

    // Add multi-selection bloom
    if (multiSelectBloom.enabled) {
      const selectedUnits = this.groupSelectionController.getSelectedUnits();
      if (selectedUnits.length > 0) {
        bloomQueue.push({
          type: 'multi-selection',
          units: selectedUnits,
          intensity: multiSelectBloom.intensity,
          color: multiSelectBloom.color,
          threshold: this.bloomThreshold * (1.0 - multiSelectBloom.intensity * 0.2),
        });
      }
    }

    // Add individual group blooms
    for (const [groupId, bloomState] of groupBlooms.entries()) {
      if (!bloomState.enabled) continue;

      const group = this.groupSelectionController.getGroup(groupId);
      if (!group) continue;

      bloomQueue.push({
        type: 'group',
        groupId,
        group,
        intensity: bloomState.intensity,
        color: bloomState.color,
        threshold: this.bloomThreshold * (1.0 - bloomState.intensity * 0.2),
      });
    }

    // Process bloom queue (in practice, renderer would batch these)
    bloomQueue.forEach((bloomJob) => {
      this._renderBloomJob(bloomJob, srcTexture, dstTexture, renderer);
    });
  }

  /**
   * Render a single bloom job
   * @private
   */
  _renderBloomJob(job, srcTexture, dstTexture, renderer) {
    // In a full implementation, this would:
    // 1. Create a render target for the bloom source
    // 2. Render selected units with high-brightness materials
    // 3. Apply Gaussian blur to the bloom texture
    // 4. Composite the blurred bloom onto the destination with the specified intensity

    // For now, we emit an event that the renderer can subscribe to
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(
        new CustomEvent('groupbloom:render', {
          detail: {
            job,
            srcTexture,
            dstTexture,
          },
        })
      );
    }
  }

  /**
   * Update group mesh for boundary rendering
   * @param {string} groupId - Group ID
   * @param {object} boundary - Boundary geometry/mesh
   */
  updateGroupBoundary(groupId, boundary) {
    this._groupBoundaries.set(groupId, boundary);
  }

  /**
   * Clear group boundary
   * @param {string} groupId - Group ID
   */
  clearGroupBoundary(groupId) {
    this._groupBoundaries.delete(groupId);
    this._groupMeshes.delete(groupId);
  }

  /**
   * Clear all group boundaries
   */
  clearAllBoundaries() {
    this._groupBoundaries.clear();
    this._groupMeshes.clear();
  }

  /**
   * Get bloom uniforms for current state
   * @returns {object}
   */
  getUniformData() {
    const multiSelectBloom = this.getMultiSelectionBloomParams();

    return {
      bloomThreshold: this.bloomThreshold,
      bloomStrength: this.bloomStrength * multiSelectBloom.intensity,
      groupBoundaryWidth: this.groupBoundaryWidth,
      enableGroupBloom: multiSelectBloom.enabled ? 1.0 : 0.0,
      bloomColor: [...multiSelectBloom.color, multiSelectBloom.intensity],
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GroupHighlightBloomPass };
}
if (typeof window !== 'undefined') {
  window.GroupHighlightBloomPass = GroupHighlightBloomPass;
}
