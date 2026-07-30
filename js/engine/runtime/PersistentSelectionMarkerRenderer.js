/**
 * PersistentSelectionMarkerRenderer.js
 *
 * Core renderer for persistent selection markers.
 * Renders circular/ring markers with visual tokens, animations, and proper layering.
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  /**
   * Selection marker visual representation
   */
  class SelectionMarker {
    constructor(markerId, key, kind, position, token, animationConfig) {
      this.markerId = markerId;
      this.key = key;
      this.kind = kind; // 'star', 'planet', 'fleet', etc.
      this.position = { x: position?.x || 0, y: position?.y || 0 };
      this.token = token || {};
      this.animationConfig = animationConfig || {};
      this.isVisible = true;
      this.opacity = 1.0;
      this.scale = 1.0;
      this.rotation = 0;
      this.createdAt = Date.now();
      this.lastUpdatedAt = Date.now();
    }

    updatePosition(x, y) {
      this.position.x = x;
      this.position.y = y;
      this.lastUpdatedAt = Date.now();
    }

    updateVisibility(isVisible) {
      this.isVisible = isVisible;
      this.lastUpdatedAt = Date.now();
    }

    updateTransform(scale, opacity, rotation) {
      this.scale = scale;
      this.opacity = opacity;
      this.rotation = rotation;
      this.lastUpdatedAt = Date.now();
    }

    getAge() {
      return (Date.now() - this.createdAt) / 1000;
    }
  }

  /**
   * Canvas-based marker renderer
   */
  class CanvasMarkerRenderer {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas?.getContext('2d');
      this.markers = new Map();
      this.nextMarkerId = 1;
      this.baseRadius = options.baseRadius || 20;
      this.enableGlow = options.enableGlow !== false;
      this.glowBlur = options.glowBlur || 8;
    }

    /**
     * Create and add a new marker
     */
    addMarker(key, kind, position, token, animationConfig) {
      if (this.markers.has(key)) {
        return this.markers.get(key);
      }

      const marker = new SelectionMarker(
        this.nextMarkerId++,
        key,
        kind,
        position,
        token,
        animationConfig
      );

      this.markers.set(key, marker);
      return marker;
    }

    /**
     * Remove a marker by key
     */
    removeMarker(key) {
      return this.markers.delete(key);
    }

    /**
     * Get marker by key
     */
    getMarker(key) {
      return this.markers.get(key);
    }

    /**
     * Update marker position
     */
    updateMarkerPosition(key, x, y) {
      const marker = this.markers.get(key);
      if (marker) {
        marker.updatePosition(x, y);
      }
    }

    /**
     * Update marker animation state
     */
    updateMarkerTransform(key, scale, opacity, rotation) {
      const marker = this.markers.get(key);
      if (marker) {
        marker.updateTransform(scale, opacity, rotation);
      }
    }

    /**
     * Draw outer ring with stroke
     */
    drawOuterRing(marker) {
      const token = marker.token;
      if (!token.outerStroke) return;

      this.ctx.save();
      this.ctx.globalAlpha = Math.min(1, token.outerStroke.match(/[\d.]+/g)?.[3] || 1) * marker.opacity;
      this.ctx.strokeStyle = token.outerStroke;
      this.ctx.lineWidth = token.outerWidth || 4;
      this.ctx.beginPath();

      const radius = this.baseRadius * (1 + token.outerRadius * marker.scale);
      this.ctx.arc(marker.position.x, marker.position.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.restore();
    }

    /**
     * Draw inner ring with stroke
     */
    drawInnerRing(marker) {
      const token = marker.token;
      if (!token.innerStroke) return;

      this.ctx.save();
      this.ctx.globalAlpha = Math.min(1, token.innerStroke.match(/[\d.]+/g)?.[3] || 1) * marker.opacity;
      this.ctx.strokeStyle = token.innerStroke;
      this.ctx.lineWidth = token.innerWidth || 2;

      const linePattern = this.getLinePattern(token.linePattern);
      if (Array.isArray(linePattern) && linePattern.length > 0) {
        this.ctx.setLineDash(linePattern);
      }

      this.ctx.beginPath();
      const radius = this.baseRadius * (1 + token.innerRadius * marker.scale);
      this.ctx.arc(marker.position.x, marker.position.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.restore();
    }

    /**
     * Draw glow effect
     */
    drawGlow(marker) {
      if (!this.enableGlow) return;

      const token = marker.token;
      this.ctx.save();

      this.ctx.globalAlpha = 0.3 * marker.opacity;
      this.ctx.fillStyle = token.color || 'rgba(255, 217, 122, 0.5)';
      this.ctx.filter = `blur(${this.glowBlur}px)`;

      this.ctx.beginPath();
      const glowRadius = this.baseRadius * marker.scale * 1.5;
      this.ctx.arc(marker.position.x, marker.position.y, glowRadius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }

    /**
     * Get line dash pattern from token
     */
    getLinePattern(patternName) {
      const patterns = {
        solid: [],
        dashed: [5, 5],
        dotted: [2, 3],
        'dot-dash': [2, 3, 5, 3],
        'dash-dash-dot': [5, 3, 5, 3, 2, 3],
        'long-dash': [10, 5],
      };
      return patterns[patternName] || [];
    }

    /**
     * Render a single marker
     */
    renderMarker(marker) {
      if (!marker.isVisible || marker.opacity < 0.01) return;

      this.ctx.save();
      this.ctx.globalAlpha = marker.opacity;

      // Apply rotation if any
      if (marker.rotation !== 0) {
        this.ctx.translate(marker.position.x, marker.position.y);
        this.ctx.rotate(marker.rotation);
        this.ctx.translate(-marker.position.x, -marker.position.y);
      }

      // Draw in order: glow → outer ring → inner ring
      this.drawGlow(marker);
      this.drawOuterRing(marker);
      this.drawInnerRing(marker);

      this.ctx.restore();
    }

    /**
     * Render all markers (sorted by z-order)
     */
    render() {
      if (!this.ctx) return;

      // Sort by z-index for proper layering
      const sortedMarkers = Array.from(this.markers.values()).sort(
        (a, b) => (a.token.zIndex || 0) - (b.token.zIndex || 0)
      );

      for (const marker of sortedMarkers) {
        this.renderMarker(marker);
      }
    }

    /**
     * Clear all markers
     */
    clear() {
      this.markers.clear();
    }

    /**
     * Get statistics
     */
    getStatistics() {
      return {
        markerCount: this.markers.size,
        visibleCount: Array.from(this.markers.values()).filter((m) => m.isVisible).length,
        nextMarkerId: this.nextMarkerId,
      };
    }
  }

  /**
   * WebGL-based marker renderer (for performance)
   */
  class WebGLMarkerRenderer {
    constructor(webglContext, options = {}) {
      this.gl = webglContext;
      this.markers = new Map();
      this.nextMarkerId = 1;
      this.baseRadius = options.baseRadius || 20;
      this.vertexBuffer = null;
      this.program = null;
      this.initializeWebGL();
    }

    initializeWebGL() {
      if (!this.gl) return;

      const vertexShader = `
        attribute vec2 position;
        attribute vec4 color;
        uniform mat4 projection;
        
        varying vec4 vColor;
        
        void main() {
          gl_Position = projection * vec4(position, 0.0, 1.0);
          vColor = color;
        }
      `;

      const fragmentShader = `
        precision mediump float;
        varying vec4 vColor;
        
        void main() {
          gl_FragColor = vColor;
        }
      `;

      // Compile shaders and create program
      // (WebGL setup would go here)
    }

    addMarker(key, kind, position, token, animationConfig) {
      if (this.markers.has(key)) {
        return this.markers.get(key);
      }

      const marker = new SelectionMarker(
        this.nextMarkerId++,
        key,
        kind,
        position,
        token,
        animationConfig
      );

      this.markers.set(key, marker);
      return marker;
    }

    removeMarker(key) {
      return this.markers.delete(key);
    }

    render() {
      // WebGL rendering would go here
    }

    clear() {
      this.markers.clear();
    }
  }

  /**
   * Factory to create appropriate renderer
   */
  function createMarkerRenderer(context, options = {}) {
    if (context instanceof CanvasRenderingContext2D) {
      return new CanvasMarkerRenderer(context.canvas, options);
    } else if (context instanceof WebGLRenderingContext || context instanceof WebGL2RenderingContext) {
      return new WebGLMarkerRenderer(context, options);
    }

    throw new Error('Unsupported rendering context');
  }

  // Export for CommonJS environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SelectionMarker,
      CanvasMarkerRenderer,
      WebGLMarkerRenderer,
      createMarkerRenderer,
    };
  } else {
    // Export for browser
    window.GQPersistentSelectionMarkerRenderer = {
      SelectionMarker,
      CanvasMarkerRenderer,
      WebGLMarkerRenderer,
      createMarkerRenderer,
    };
  }
})();
