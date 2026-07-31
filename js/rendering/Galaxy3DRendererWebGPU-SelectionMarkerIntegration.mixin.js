/**
 * Galaxy3DRendererWebGPU-SelectionMarkerIntegration.mixin.js
 *
 * Mixin to add SelectionMarkerOverlay integration to Galaxy3DRendererWebGPU.
 * This mixin is applied at renderer initialization to add marker support without
 * modifying the core renderer code.
 *
 * Usage:
 *   const renderer = new Galaxy3DRendererWebGPU(container, options);
 *   Galaxy3DRendererWebGPUSelectionMarkerIntegration.apply(renderer);
 *   await renderer.init();
 *
 * License: MIT
 */

const Galaxy3DRendererWebGPUSelectionMarkerIntegration = {
  /**
   * Apply selection marker integration to a Galaxy3DRendererWebGPU instance.
   * @param {Galaxy3DRendererWebGPU} renderer - The renderer instance
   * @returns {boolean} true if successfully applied
   */
  apply(renderer) {
    if (!renderer || renderer._selectionMarkerIntegrationApplied) {
      return false;
    }

    // Mark as applied to prevent double-application
    renderer._selectionMarkerIntegrationApplied = true;

    // 1. Add selection marker overlay property
    renderer._selectionMarkerOverlay = null;

    // 2. Store original init method and wrap it
    const originalInit = renderer.init.bind(renderer);
    renderer.init = async function() {
      const result = await originalInit();
      if (result && this.ready) {
        Galaxy3DRendererWebGPUSelectionMarkerIntegration._initializeSelectionMarkers.call(this);
      }
      return result;
    };

    // 3. Store original render method and wrap it
    const originalRender = renderer._renderGalaxyOverlay2D.bind(renderer);
    renderer._renderGalaxyOverlay2D = function() {
      originalRender();
      // Render selection markers after other overlays
      if (this._selectionMarkerOverlay) {
        this._selectionMarkerOverlay.render(16.67); // Assume ~60 FPS = 16.67ms per frame
      }
    };

    // 4. Store original event handler setup and wrap it
    const originalAttachInteraction = renderer._attachInteraction.bind(renderer);
    renderer._attachInteraction = function(canvas) {
      originalAttachInteraction(canvas);
      Galaxy3DRendererWebGPUSelectionMarkerIntegration._setupSelectionMarkerEventHandlers.call(this, canvas);
    };

    // 5. Store original dispose method and wrap it
    const originalDispose = renderer.dispose.bind(renderer);
    renderer.dispose = function() {
      Galaxy3DRendererWebGPUSelectionMarkerIntegration._disposeSelectionMarkers.call(this);
      originalDispose();
    };

    return true;
  },

  /**
   * Initialize selection marker overlay.
   * @private
   */
  _initializeSelectionMarkers() {
    if (this._selectionMarkerOverlay || !this._overlayCanvas) {
      return;
    }

    try {
      if (!window.GQSelectionMarkerOverlay) {
        console.warn('Galaxy3DRendererWebGPU: SelectionMarkerOverlay not available');
        return;
      }

      // Create overlay instance with canvas context
      this._selectionMarkerOverlay = new window.GQSelectionMarkerOverlay(
        this._overlayCanvas,
        {
          baseRadius: 20,
          enableGlow: true,
          glowBlur: 8,
          enableCulling: true,
          cullingRadius: 1000,
          viewMatrix: this._view,
        }
      );

      // Initialize overlay
      if (!this._selectionMarkerOverlay.initialize()) {
        console.error('Galaxy3DRendererWebGPU: Failed to initialize SelectionMarkerOverlay');
        this._selectionMarkerOverlay = null;
        return;
      }

      console.log('Galaxy3DRendererWebGPU: SelectionMarkerOverlay initialized successfully');
    } catch (err) {
      console.error('Galaxy3DRendererWebGPU: Error initializing SelectionMarkerOverlay:', err);
      this._selectionMarkerOverlay = null;
    }
  },

  /**
   * Setup selection marker event handlers.
   * @private
   */
  _setupSelectionMarkerEventHandlers(canvas) {
    if (!this._selectionMarkerOverlay) {
      return;
    }

    const self = this;

    // Wrap onHover callback to also update selection markers
    const originalOnHover = this._opts.onHover;
    this._opts.onHover = function(star, position) {
      if (originalOnHover) originalOnHover.call(this, star, position);
      if (self._selectionMarkerOverlay) {
        self._selectionMarkerOverlay.handleHover(star, position);
      }
    };

    // Wrap onClick callback to also update selection markers
    const originalOnClick = this._opts.onClick;
    this._opts.onClick = function(payload, position) {
      if (originalOnClick) originalOnClick.call(this, payload, position);
      if (self._selectionMarkerOverlay && payload) {
        self._selectionMarkerOverlay.handleClick(payload, position);
      }
    };

    // Wrap onPointerOut if it exists, otherwise add it
    const originalOnPointerOut = this._opts.onPointerOut;
    this._opts.onPointerOut = function() {
      if (originalOnPointerOut) originalOnPointerOut.call(this);
      if (self._selectionMarkerOverlay) {
        self._selectionMarkerOverlay.handlePointerOut();
      }
    };

    // Add mouseout event to canvas to clear hover markers
    const onMouseOut = () => {
      if (self._selectionMarkerOverlay) {
        self._selectionMarkerOverlay.handlePointerOut();
      }
    };

    if (!this._eventHandlers) {
      this._eventHandlers = {};
    }

    canvas.addEventListener('mouseout', onMouseOut);
    this._eventHandlers._selectionMarkerMouseOut = onMouseOut;

    console.log('Galaxy3DRendererWebGPU: SelectionMarkerOverlay event handlers attached');
  },

  /**
   * Dispose selection marker overlay.
   * @private
   */
  _disposeSelectionMarkers() {
    if (this._selectionMarkerOverlay) {
      this._selectionMarkerOverlay.dispose();
      this._selectionMarkerOverlay = null;
    }

    // Clean up event listener
    if (this._eventHandlers?._selectionMarkerMouseOut && this._canvas) {
      this._canvas.removeEventListener('mouseout', this._eventHandlers._selectionMarkerMouseOut);
      delete this._eventHandlers._selectionMarkerMouseOut;
    }
  },
};

// Export for module systems
if (typeof window !== 'undefined') {
  window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration = Galaxy3DRendererWebGPUSelectionMarkerIntegration;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Galaxy3DRendererWebGPUSelectionMarkerIntegration;
}
