/**
 * SelectionMarkerCompositor.js
 *
 * Compositing layer for selection markers.
 * Manages lifecycle, batching, and integration with selection state and animation engine.
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  /**
   * Manages marker lifecycle and coordination
   */
  class SelectionMarkerCompositor {
    constructor(renderer, animationPool, options = {}) {
      this.renderer = renderer;
      this.animationPool = animationPool;
      this.markerMap = new Map(); // key → { marker, animationManager }
      this.selectionState = null;
      this.lastFrameTime = Date.now();
      this.deltaTime = 0;
      this.enableCulling = options.enableCulling !== false;
      this.enableBatching = options.enableBatching !== false;
      this.cullingRadius = options.cullingRadius || 1000;
      this.viewportBounds = {
        minX: -1000,
        minY: -1000,
        maxX: 1000,
        maxY: 1000,
      };
    }

    /**
     * Set selection state to monitor
     */
    setSelectionState(selectionState) {
      this.selectionState = selectionState;
    }

    /**
     * Set viewport bounds for culling
     */
    setViewportBounds(bounds) {
      this.viewportBounds = { ...bounds };
    }

    /**
     * Check if position is within viewport
     */
    isInViewport(position) {
      return (
        position.x >= this.viewportBounds.minX &&
        position.x <= this.viewportBounds.maxX &&
        position.y >= this.viewportBounds.minY &&
        position.y <= this.viewportBounds.maxY
      );
    }

    /**
     * Update marker from selection state
     */
    updateMarkerFromSelection(selection, markerType = 'active') {
      if (!selection || !this.renderer) return null;

      const key = selection.key || `${markerType}:${Date.now()}`;
      const position = selection.position || { x: 0, y: 0 };

      // Determine if marker should be visible
      const isVisible = this.enableCulling ? this.isInViewport(position) : true;

      // Get or create marker
      let entry = this.markerMap.get(key);
      if (!entry) {
        // Create new marker
        const token = this.getTokenForMarkerType(markerType);
        const animConfig = this.getAnimationConfigForToken(token);
        
        const marker = this.renderer.addMarker(
          key,
          selection.kind,
          position,
          token,
          animConfig
        );

        const animManager = this.animationPool?.acquire(key, animConfig) || null;

        entry = { marker, animManager, markerType, createdAt: Date.now() };
        this.markerMap.set(key, entry);
      } else {
        // Update existing marker
        entry.marker.updatePosition(position.x, position.y);
        entry.marker.updateVisibility(isVisible);
      }

      return entry;
    }

    /**
     * Remove marker by key
     */
    removeMarker(key) {
      const entry = this.markerMap.get(key);
      if (entry) {
        this.renderer.removeMarker(key);
        if (entry.animManager) {
          this.animationPool?.release(key);
        }
        this.markerMap.delete(key);
        return true;
      }
      return false;
    }

    /**
     * Get token for marker type
     */
    getTokenForMarkerType(markerType) {
      // This would be coordinated with SelectionMarkerStyleTokens
      const tokenMap = {
        active: {
          color: 'rgba(255, 217, 122, 0.88)',
          outerStroke: 'rgba(255, 217, 122, 0.88)',
          innerStroke: 'rgba(255, 246, 214, 0.76)',
          outerWidth: 4,
          innerWidth: 2,
          outerRadius: 0.33,
          innerRadius: 0.11,
          linePattern: 'solid',
          animation: 'pulse',
          zIndex: 21,
        },
        hover: {
          color: 'rgba(122, 194, 255, 0.72)',
          outerStroke: 'rgba(122, 194, 255, 0.72)',
          innerStroke: 'rgba(214, 238, 255, 0.52)',
          outerWidth: 3,
          innerWidth: 1.5,
          outerRadius: 0.29,
          innerRadius: 0.14,
          linePattern: 'solid',
          animation: 'none',
          zIndex: 20,
        },
        group: {
          color: 'rgba(200, 255, 100, 0.65)',
          outerStroke: 'rgba(200, 255, 100, 0.65)',
          innerStroke: 'rgba(220, 255, 150, 0.50)',
          outerWidth: 3.5,
          innerWidth: 2,
          outerRadius: 0.35,
          innerRadius: 0.15,
          linePattern: 'dashed',
          animation: 'subtle-pulse',
          zIndex: 19,
        },
      };

      return tokenMap[markerType] || tokenMap.hover;
    }

    /**
     * Get animation config for token
     */
    getAnimationConfigForToken(token) {
      const animMap = {
        'pulse': {
          type: 'scale',
          duration: 2.0,
          minScale: 0.95,
          maxScale: 1.15,
          easing: 'sine-wave',
        },
        'subtle-pulse': {
          type: 'scale',
          duration: 3.0,
          minScale: 0.98,
          maxScale: 1.08,
          easing: 'sine-wave',
        },
        'none': {
          type: 'none',
        },
      };

      return animMap[token.animation] || animMap.none;
    }

    /**
     * Update from selection state (internal use)
     */
    update() {
      const now = Date.now();
      this.deltaTime = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      if (!this.selectionState) return;

      // Clear old markers that are no longer in selection state
      const activeKeys = new Set();

      // Update active selection
      if (this.selectionState.active) {
        const entry = this.updateMarkerFromSelection(this.selectionState.active, 'active');
        if (entry) activeKeys.add(entry.marker.key);
      }

      // Update hover selection
      if (this.selectionState.hover) {
        const entry = this.updateMarkerFromSelection(this.selectionState.hover, 'hover');
        if (entry) activeKeys.add(entry.marker.key);
      }

      // Update group selection markers
      if (Array.isArray(this.selectionState.multiSelection) && this.selectionState.multiSelection.length > 1) {
        for (const member of this.selectionState.multiSelection) {
          const entry = this.updateMarkerFromSelection(member, 'group');
          if (entry) activeKeys.add(entry.marker.key);
        }
      }

      // Remove markers that are no longer active
      const keysToRemove = [];
      for (const [key, entry] of this.markerMap) {
        if (!activeKeys.has(key)) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        this.removeMarker(key);
      }

      // Update animation states
      this.updateAnimations();
    }

    /**
     * Update all animations
     */
    updateAnimations() {
      if (!this.animationPool) return;

      this.animationPool.updateAll(this.deltaTime);

      for (const [key, entry] of this.markerMap) {
        if (entry.animManager) {
          const props = entry.animManager.getFrameProperties();
          entry.marker.updateTransform(props.scale, props.opacity, props.rotation);
        }
      }
    }

    /**
     * Render all markers
     */
    render() {
      if (!this.renderer) return;

      // Optional culling
      if (this.enableCulling) {
        for (const [key, entry] of this.markerMap) {
          const isInView = this.isInViewport(entry.marker.position);
          entry.marker.updateVisibility(isInView);
        }
      }

      this.renderer.render();
    }

    /**
     * Clear all markers
     */
    clear() {
      for (const key of this.markerMap.keys()) {
        this.removeMarker(key);
      }
    }

    /**
     * Get statistics
     */
    getStatistics() {
      return {
        markerCount: this.markerMap.size,
        deltaTime: this.deltaTime,
        rendererStats: this.renderer?.getStatistics() || {},
        animationPoolStats: this.animationPool?.getStatistics() || {},
      };
    }
  }

  // Export for CommonJS environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SelectionMarkerCompositor,
    };
  } else {
    // Export for browser
    window.GQSelectionMarkerCompositor = {
      SelectionMarkerCompositor,
    };
  }
})();
