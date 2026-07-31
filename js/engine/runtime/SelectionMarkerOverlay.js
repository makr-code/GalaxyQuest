/**
 * SelectionMarkerOverlay.js
 *
 * Wraps SelectionMarkerCompositor and provides easy integration into any renderer
 * that has a canvas 2D context. Handles initialization, lifecycle, and event coordination.
 *
 * Usage:
 *   const overlay = new SelectionMarkerOverlay(canvasElement, {
 *     baseRadius: 20,
 *     enableGlow: true,
 *     enableCulling: true,
 *     cullingRadius: 1000,
 *   });
 *   overlay.initialize();
 *   overlay.updateFromSelectionState(selectionState);
 *   overlay.render(deltaTime);
 *   overlay.dispose();
 *
 * License: MIT
 */

class SelectionMarkerOverlay {
  /**
   * Create a selection marker overlay for a canvas element.
   * @param {HTMLCanvasElement} canvas - Canvas element to render markers on
   * @param {Object} options - Configuration
   * @param {number} options.baseRadius - Base radius for markers (default: 20)
   * @param {boolean} options.enableGlow - Enable glow effect (default: true)
   * @param {number} options.glowBlur - Glow blur radius (default: 8)
   * @param {boolean} options.enableCulling - Enable viewport culling (default: true)
   * @param {number} options.cullingRadius - Culling search radius in pixels (default: 1000)
   * @param {Object} options.viewMatrix - View matrix for culling calculations
   */
  constructor(canvas, options = {}) {
    if (!canvas) {
      throw new Error('SelectionMarkerOverlay requires a valid canvas element');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    if (!this.ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }

    // Configuration
    this.config = {
      baseRadius: options.baseRadius ?? 20,
      enableGlow: options.enableGlow ?? true,
      glowBlur: options.glowBlur ?? 8,
      enableCulling: options.enableCulling ?? true,
      cullingRadius: options.cullingRadius ?? 1000,
      viewMatrix: options.viewMatrix ?? null,
    };

    // Component refs
    this.markerRenderer = null;
    this.animationPool = null;
    this.compositor = null;

    // State tracking
    this.isInitialized = false;
    this.isDisposed = false;
    this.selectionState = null;

    // Event listeners registered (for cleanup)
    this._registeredListeners = [];
  }

  /**
   * Initialize overlay components.
   * @returns {boolean} true if successful
   */
  initialize() {
    if (this.isInitialized || this.isDisposed) {
      console.warn('SelectionMarkerOverlay: already initialized or disposed');
      return false;
    }

    try {
      // 1. Initialize marker renderer
      if (!window.GQPersistentSelectionMarkerRenderer) {
        console.error('SelectionMarkerOverlay: GQPersistentSelectionMarkerRenderer not available');
        return false;
      }

      this.markerRenderer = window.GQPersistentSelectionMarkerRenderer
        .createMarkerRenderer(this.ctx, {
          baseRadius: this.config.baseRadius,
          enableGlow: this.config.enableGlow,
          glowBlur: this.config.glowBlur,
        });

      if (!this.markerRenderer) {
        console.error('SelectionMarkerOverlay: Failed to create marker renderer');
        return false;
      }

      // 2. Initialize animation pool
      if (window.GQSelectionMarkerAnimationEngine?.AnimationManagerPool) {
        this.animationPool = new window.GQSelectionMarkerAnimationEngine.AnimationManagerPool();
      } else {
        console.warn('SelectionMarkerOverlay: AnimationManagerPool not available, using fallback');
        this.animationPool = { updateAll: () => {}, add: () => {} };
      }

      // 3. Initialize compositor
      if (!window.GQSelectionMarkerCompositor) {
        console.error('SelectionMarkerOverlay: GQSelectionMarkerCompositor not available');
        return false;
      }

      this.compositor = new window.GQSelectionMarkerCompositor.SelectionMarkerCompositor(
        this.markerRenderer,
        this.animationPool,
        {
          enableCulling: this.config.enableCulling,
          cullingRadius: this.config.cullingRadius,
          viewMatrix: this.config.viewMatrix,
        }
      );

      if (!this.compositor) {
        console.error('SelectionMarkerOverlay: Failed to create compositor');
        return false;
      }

      // 4. Register for global selection state changes
      this._registerEventListeners();

      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error('SelectionMarkerOverlay.initialize() error:', err);
      return false;
    }
  }

  /**
   * Register for selection state change events.
   * @private
   */
  _registerEventListeners() {
    const selectionStateChangedHandler = (evt) => {
      if (evt.detail?.state) {
        this.updateFromSelectionState(evt.detail.state);
      }
    };

    window.addEventListener('GQ:selection:state-changed', selectionStateChangedHandler);
    this._registeredListeners.push({
      type: 'GQ:selection:state-changed',
      handler: selectionStateChangedHandler,
    });
  }

  /**
   * Update markers from selection state.
   * @param {Object} selectionState - Selection state from RuntimeSelectionState
   */
  updateFromSelectionState(selectionState) {
    if (!this.isInitialized || this.isDisposed || !this.markerRenderer || !this.compositor) {
      return;
    }

    this.selectionState = selectionState;

    try {
      // Clear old markers
      this.markerRenderer.clear();

      // Update persistent selection marker
      if (selectionState.active) {
        const token = this._getSelectionMarkerToken('selection');
        this.compositor.updateMarkerFromSelection(
          selectionState.active,
          'active',
          token
        );
      }

      // Update hover marker (temporary)
      if (selectionState.hover) {
        const token = this._getSelectionMarkerToken('hover');
        this.compositor.updateMarkerFromSelection(
          selectionState.hover,
          'hover',
          token
        );
      }

      // Update group marker if applicable (for Phase 3)
      if (selectionState.group && selectionState.multiSelection?.length > 1) {
        const token = this._getSelectionMarkerToken('group');
        if (this.compositor.updateMarkerFromSelection) {
          this.compositor.updateMarkerFromSelection(
            selectionState.group,
            'group',
            token
          );
        }
      }
    } catch (err) {
      console.error('SelectionMarkerOverlay.updateFromSelectionState() error:', err);
    }
  }

  /**
   * Get a selection marker token for a given state type.
   * @private
   * @param {string} stateType - 'selection', 'hover', or 'group'
   * @returns {Object} Visual token
   */
  _getSelectionMarkerToken(stateType) {
    if (window.GQSelectionMarkerStyleTokens?.getSelectionMarkerToken) {
      return window.GQSelectionMarkerStyleTokens.getSelectionMarkerToken(stateType);
    }

    // Fallback tokens if style module not available
    const tokens = {
      selection: {
        primaryColor: '#FFD700',
        secondaryColor: '#FFA500',
        lineWidth: 4,
        linePattern: 'solid',
        animationType: 'pulse',
        glowIntensity: 1.0,
      },
      hover: {
        primaryColor: '#4A90E2',
        secondaryColor: '#357ABD',
        lineWidth: 3,
        linePattern: 'dotted',
        animationType: 'none',
        glowIntensity: 0.5,
      },
      group: {
        primaryColor: '#7ED321',
        secondaryColor: '#63BE1F',
        lineWidth: 2,
        linePattern: 'dashed',
        animationType: 'pulse',
        glowIntensity: 0.7,
      },
    };

    return tokens[stateType] || tokens.selection;
  }

  /**
   * Render the overlay (call in renderer's animation frame).
   * @param {number} deltaTime - Time since last frame in milliseconds
   */
  render(deltaTime = 0) {
    if (!this.isInitialized || this.isDisposed) {
      return;
    }

    try {
      // Update animations
      if (this.animationPool) {
        this.animationPool.updateAll(deltaTime);
      }

      // Render markers
      if (this.markerRenderer) {
        this.markerRenderer.render();
      }
    } catch (err) {
      console.error('SelectionMarkerOverlay.render() error:', err);
    }
  }

  /**
   * Handle object hover event.
   * @param {Object} target - The target object
   * @param {Object} position - Screen position {x, y}
   */
  handleHover(target, position) {
    if (!this.isInitialized || this.isDisposed || !window.GQRuntimeSelectionState) {
      return;
    }

    try {
      window.GQRuntimeSelectionState.commitSelectionState(
        'hover',
        target,
        position,
        'hover'
      );
    } catch (err) {
      console.error('SelectionMarkerOverlay.handleHover() error:', err);
    }
  }

  /**
   * Handle pointer out event (clear hover).
   */
  handlePointerOut() {
    if (!this.isInitialized || this.isDisposed || !window.GQRuntimeSelectionState) {
      return;
    }

    try {
      window.GQRuntimeSelectionState.commitSelectionState(
        'hover',
        null,
        null,
        'pointerout'
      );
    } catch (err) {
      console.error('SelectionMarkerOverlay.handlePointerOut() error:', err);
    }
  }

  /**
   * Handle click/selection event.
   * @param {Object} target - The target object
   * @param {Object} position - Screen position {x, y}
   */
  handleClick(target, position) {
    if (!this.isInitialized || this.isDisposed || !window.GQRuntimeSelectionState) {
      return;
    }

    try {
      window.GQRuntimeSelectionState.commitSelectionState(
        'active',
        target,
        position,
        'click'
      );
    } catch (err) {
      console.error('SelectionMarkerOverlay.handleClick() error:', err);
    }
  }

  /**
   * Set the view matrix for culling calculations.
   * @param {Object} viewMatrix - View transformation matrix
   */
  setViewMatrix(viewMatrix) {
    if (this.config && viewMatrix) {
      this.config.viewMatrix = viewMatrix;
      if (this.compositor?.setViewMatrix) {
        this.compositor.setViewMatrix(viewMatrix);
      }
    }
  }

  /**
   * Get current selection state.
   * @returns {Object|null}
   */
  getSelectionState() {
    return this.selectionState;
  }

  /**
   * Clear all markers.
   */
  clear() {
    if (this.markerRenderer) {
      this.markerRenderer.clear();
    }
  }

  /**
   * Dispose of overlay and clean up resources.
   */
  dispose() {
    if (this.isDisposed) return;

    try {
      // Clear all markers
      if (this.markerRenderer) {
        this.markerRenderer.clear();
      }

      // Unregister event listeners
      for (const listener of this._registeredListeners) {
        window.removeEventListener(listener.type, listener.handler);
      }
      this._registeredListeners = [];

      // Dispose components
      if (this.compositor?.dispose) {
        this.compositor.dispose();
      }
      if (this.animationPool?.dispose) {
        this.animationPool.dispose();
      }
      if (this.markerRenderer?.dispose) {
        this.markerRenderer.dispose();
      }

      // Clear refs
      this.markerRenderer = null;
      this.animationPool = null;
      this.compositor = null;
      this.ctx = null;
      this.canvas = null;
      this.selectionState = null;

      this.isDisposed = true;
    } catch (err) {
      console.error('SelectionMarkerOverlay.dispose() error:', err);
    }
  }
}

// Export for module systems
if (typeof window !== 'undefined') {
  window.GQSelectionMarkerOverlay = SelectionMarkerOverlay;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SelectionMarkerOverlay;
}
