/**
 * ViewRenderer.js
 *
 * Base class for all view-specific renderers (Galaxy, System, Approach, Colony).
 * Provides common infrastructure for canvas management, quality presets,
 * performance monitoring, and camera state.
 *
 * All view renderers should extend this class and implement the required
 * lifecycle methods (initialize, update, render, cleanup).
 *
 * Usage:
 *   class MyViewRenderer extends ViewRenderer {
 *     initialize() { ... }
 *     update(deltaTime) { ... }
 *     render() { ... }
 *     cleanup() { ... }
 *   }
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ViewRenderer {
  /**
   * @param {HTMLCanvasElement} canvas - Target canvas element
   * @param {object} options - Renderer options
   * @param {string} options.viewType - 'galaxy', 'system', 'approach', 'colony'
   * @param {AdvancedRenderingManager} options.renderingManager - Advanced rendering manager
   * @param {object} options.qualityPreset - Initial quality preset
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.viewType = options.viewType || 'unknown';
    this.renderingManager = options.renderingManager || null;
    
    // Performance monitoring
    this._metrics = {
      frameCount: 0,
      fps: 0,
      frameTime: 0,
      triangles: 0,
      drawCalls: 0,
      gpuMemoryMB: 0,
      lastFrameTime: performance.now(),
    };
    
    // Camera state
    this._camera = {
      position: [0, 0, 0],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 75,
      aspect: canvas?.clientWidth / canvas?.clientHeight || 1,
      near: 0.1,
      far: 1000,
    };
    
    // Quality settings
    this._qualityPreset = options.qualityPreset || {
      name: 'high',
      lodDistance: 1500,
      bloomStrength: 0.6,
      maxParticles: 5000,
      shadowQuality: 'high',
      postProcessing: true,
    };
    
    // Selection & interaction state
    this._selectionState = {
      active: null,
      hover: null,
      multiSelection: [],
      sourceView: this.viewType,
    };
    
    // Lifecycle state
    this._initialized = false;
    this._disposed = false;
    this._isVisible = true;
    
    // Event handlers
    this._eventHandlers = new Map();
  }

  /**
   * Initialize renderer (abstract - must be implemented by subclass)
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;
    this._initialized = true;
  }

  /**
   * Update renderer state (abstract - must be implemented by subclass)
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    // Update metrics
    const now = performance.now();
    const frameDuration = now - this._metrics.lastFrameTime;
    this._metrics.frameTime = frameDuration;
    this._metrics.fps = Math.round(1000 / frameDuration);
    this._metrics.lastFrameTime = now;
    this._metrics.frameCount++;
  }

  /**
   * Render frame (abstract - must be implemented by subclass)
   */
  render() {
    // Implement in subclass
  }

  /**
   * Clean up renderer resources (abstract - must be implemented by subclass)
   */
  async cleanup() {
    this._disposed = true;
  }

  /**
   * Apply quality preset
   * @param {string|object} preset - Preset name or configuration
   */
  applyQualityPreset(preset) {
    if (typeof preset === 'string') {
      const presets = {
        mobile: {
          name: 'mobile',
          lodDistance: 500,
          bloomStrength: 0.3,
          maxParticles: 500,
          shadowQuality: 'low',
          postProcessing: false,
        },
        low: {
          name: 'low',
          lodDistance: 800,
          bloomStrength: 0.4,
          maxParticles: 1000,
          shadowQuality: 'low',
          postProcessing: false,
        },
        medium: {
          name: 'medium',
          lodDistance: 1200,
          bloomStrength: 0.5,
          maxParticles: 2500,
          shadowQuality: 'medium',
          postProcessing: true,
        },
        high: {
          name: 'high',
          lodDistance: 1500,
          bloomStrength: 0.6,
          maxParticles: 5000,
          shadowQuality: 'high',
          postProcessing: true,
        },
        ultra: {
          name: 'ultra',
          lodDistance: 2000,
          bloomStrength: 0.8,
          maxParticles: 10000,
          shadowQuality: 'ultra',
          postProcessing: true,
        },
      };
      this._qualityPreset = presets[preset] || presets.high;
    } else if (typeof preset === 'object') {
      this._qualityPreset = { ...this._qualityPreset, ...preset };
    }
  }

  /**
   * Get current quality preset
   * @returns {object}
   */
  getQualityPreset() {
    return { ...this._qualityPreset };
  }

  /**
   * Get performance metrics
   * @returns {object}
   */
  getPerformanceMetrics() {
    return {
      frameCount: this._metrics.frameCount,
      fps: this._metrics.fps,
      frameTime: this._metrics.frameTime,
      triangles: this._metrics.triangles,
      drawCalls: this._metrics.drawCalls,
      gpuMemoryMB: this._metrics.gpuMemoryMB,
    };
  }

  /**
   * Get camera state
   * @returns {object}
   */
  getCameraState() {
    return {
      position: [...this._camera.position],
      target: [...this._camera.target],
      up: [...this._camera.up],
      fov: this._camera.fov,
      aspect: this._camera.aspect,
      near: this._camera.near,
      far: this._camera.far,
    };
  }

  /**
   * Set camera state
   * @param {object} state - Camera state
   */
  setCameraState(state) {
    if (state.position) this._camera.position = [...state.position];
    if (state.target) this._camera.target = [...state.target];
    if (state.up) this._camera.up = [...state.up];
    if (state.fov !== undefined) this._camera.fov = state.fov;
    if (state.near !== undefined) this._camera.near = state.near;
    if (state.far !== undefined) this._camera.far = state.far;
    if (state.aspect !== undefined) this._camera.aspect = state.aspect;
  }

  /**
   * Handle selection
   * @param {object} object - Selected object
   * @param {object} options - Selection options
   */
  onSelect(object, options = {}) {
    if (options.multiSelect) {
      if (!this._selectionState.multiSelection.includes(object)) {
        this._selectionState.multiSelection.push(object);
      }
    } else {
      this._selectionState.active = object;
      this._selectionState.multiSelection = [];
    }
    this._emit('selection-changed', { object, options });
  }

  /**
   * Handle deselection
   * @param {object} object - Deselected object
   */
  onDeselect(object) {
    if (this._selectionState.active === object) {
      this._selectionState.active = null;
    }
    const idx = this._selectionState.multiSelection.indexOf(object);
    if (idx >= 0) {
      this._selectionState.multiSelection.splice(idx, 1);
    }
    this._emit('selection-changed', { object, deselected: true });
  }

  /**
   * Handle hover
   * @param {object} object - Hovered object
   */
  onHover(object) {
    this._selectionState.hover = object;
    this._emit('hover-changed', { object });
  }

  /**
   * Clear hover
   */
  clearHover() {
    this._selectionState.hover = null;
    this._emit('hover-changed', { object: null });
  }

  /**
   * Get current selection state
   * @returns {object}
   */
  getSelectionState() {
    return {
      active: this._selectionState.active,
      hover: this._selectionState.hover,
      multiSelection: [...this._selectionState.multiSelection],
      sourceView: this._selectionState.sourceView,
    };
  }

  /**
   * Get object at pixel coordinates (abstract)
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @returns {object|null}
   */
  getObjectAtPixel(x, y) {
    return null; // Implement in subclass
  }

  /**
   * Resize canvas
   * @param {number} width - New width
   * @param {number} height - New height
   */
  resize(width, height) {
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
      this._camera.aspect = width / height;
    }
  }

  /**
   * Show/hide renderer
   * @param {boolean} visible - Visibility flag
   */
  setVisible(visible) {
    this._isVisible = visible;
    if (this.canvas) {
      this.canvas.style.display = visible ? 'block' : 'none';
    }
  }

  /**
   * Register event handler
   * @param {string} eventName - Event name
   * @param {Function} handler - Event handler
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
   * @param {Function} handler - Event handler
   */
  off(eventName, handler) {
    if (!this._eventHandlers.has(eventName)) return;
    const handlers = this._eventHandlers.get(eventName);
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  /**
   * Emit event
   * @protected
   * @param {string} eventName - Event name
   * @param {object} data - Event data
   */
  _emit(eventName, data) {
    if (!this._eventHandlers.has(eventName)) return;
    const handlers = this._eventHandlers.get(eventName);
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`Error in ${eventName} handler:`, err);
      }
    });
  }

  /**
   * Check if renderer is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * Check if renderer is disposed
   * @returns {boolean}
   */
  isDisposed() {
    return this._disposed;
  }

  /**
   * Check if renderer is visible
   * @returns {boolean}
   */
  isVisible() {
    return this._isVisible;
  }
}

// Export for use in browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ViewRenderer;
}
if (typeof window !== 'undefined') {
  window.ViewRenderer = ViewRenderer;
}
