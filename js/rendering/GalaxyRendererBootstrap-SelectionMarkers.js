/**
 * GalaxyRendererBootstrap-SelectionMarkers.js
 *
 * Bootstrap file that applies SelectionMarkerOverlay integration to the Galaxy renderer.
 * This file should be loaded AFTER:
 * 1. Galaxy3DRendererWebGPU.js
 * 2. SelectionMarkerOverlay.js
 * 3. Galaxy3DRendererWebGPU-SelectionMarkerIntegration.mixin.js
 * 4. All selection infrastructure (RuntimeSelectionState, etc.)
 *
 * Initialization order:
 * <script src="Galaxy3DRendererWebGPU.js"></script>
 * <script src="SelectionMarkerOverlay.js"></script>
 * <script src="Galaxy3DRendererWebGPU-SelectionMarkerIntegration.mixin.js"></script>
 * <script src="GalaxyRendererBootstrap-SelectionMarkers.js"></script>
 *
 * License: MIT
 */

(function() {
  'use strict';

  /**
   * Initialize selection marker integration for Galaxy renderers.
   * Called automatically when this script loads.
   */
  function initializeSelectionMarkerIntegration() {
    // Verify all dependencies are available
    const dependencies = {
      SelectionMarkerOverlay: window.GQSelectionMarkerOverlay,
      Galaxy3DRendererWebGPU: window.Galaxy3DRendererWebGPU || window.GQGalaxy3DRendererWebGPU,
      IntegrationMixin: window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration,
      RuntimeSelectionState: window.GQRuntimeSelectionState,
      SelectionMarkerStyleTokens: window.GQSelectionMarkerStyleTokens,
      PersistentSelectionMarkerRenderer: window.GQPersistentSelectionMarkerRenderer,
      SelectionMarkerCompositor: window.GQSelectionMarkerCompositor,
      SelectionMarkerAnimationEngine: window.GQSelectionMarkerAnimationEngine,
    };

    const missing = Object.entries(dependencies)
      .filter(([name, obj]) => !obj)
      .map(([name]) => name);

    if (missing.length > 0) {
      console.warn(
        '[GalaxyRendererBootstrap-SelectionMarkers] Missing dependencies:',
        missing.join(', '),
        '- selection markers will not be initialized'
      );
      return false;
    }

    // Patch the Galaxy3DRendererWebGPU constructor to auto-apply integration
    const OriginalGalaxy3DRendererWebGPU = window.Galaxy3DRendererWebGPU || window.GQGalaxy3DRendererWebGPU;

    if (!OriginalGalaxy3DRendererWebGPU) {
      console.error('[GalaxyRendererBootstrap-SelectionMarkers] Galaxy3DRendererWebGPU not found');
      return false;
    }

    // Store original constructor
    const OriginalConstructor = OriginalGalaxy3DRendererWebGPU;

    // Create wrapper constructor that applies integration
    const PatchedConstructor = function(container, opts) {
      // Call original constructor
      OriginalConstructor.call(this, container, opts);

      // Apply selection marker integration after construction
      const self = this;
      const applyIntegration = () => {
        const result = window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration.apply(self);
        if (result) {
          console.log('[GalaxyRendererBootstrap-SelectionMarkers] Integration applied successfully');
        } else {
          console.warn('[GalaxyRendererBootstrap-SelectionMarkers] Integration already applied or failed');
        }
      };

      // Apply immediately (synchronous)
      try {
        applyIntegration();
      } catch (err) {
        console.error('[GalaxyRendererBootstrap-SelectionMarkers] Error applying integration:', err);
      }
    };

    // Copy prototype and static members
    PatchedConstructor.prototype = OriginalConstructor.prototype;
    Object.setPrototypeOf(PatchedConstructor, OriginalConstructor);

    // Copy static properties
    for (const key of Object.getOwnPropertyNames(OriginalConstructor)) {
      if (key !== 'prototype' && key !== 'length' && key !== 'name') {
        try {
          PatchedConstructor[key] = OriginalConstructor[key];
        } catch (e) {
          // Some properties might be read-only
        }
      }
    }

    // Replace the global constructor
    window.Galaxy3DRendererWebGPU = PatchedConstructor;
    window.GQGalaxy3DRendererWebGPU = PatchedConstructor;

    // Also update Galaxy3DView if it points to the original
    if (window.Galaxy3DView === OriginalConstructor) {
      window.Galaxy3DView = PatchedConstructor;
    }

    console.log('[GalaxyRendererBootstrap-SelectionMarkers] Selection marker integration bootstrapped');
    return true;
  }

  /**
   * Register a hook to apply integration to renderers created after bootstrap.
   * This handles dynamic renderer creation.
   */
  function registerRenderCreationHook() {
    if (window.addEventListener) {
      window.addEventListener('GQ:renderer:created', function(evt) {
        if (!evt.detail?.renderer) return;

        const renderer = evt.detail.renderer;
        const rendererType = evt.detail.rendererType || 'unknown';

        // Apply integration to WebGPU renderers
        if (
          rendererType === 'galaxy-webgpu' ||
          rendererType === 'Galaxy3DRendererWebGPU' ||
          renderer instanceof window.Galaxy3DRendererWebGPU ||
          renderer.constructor.name === 'Galaxy3DRendererWebGPU'
        ) {
          try {
            if (window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration?.apply) {
              const result = window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration.apply(renderer);
              if (result) {
                console.log('[GalaxyRendererBootstrap] Selection markers applied to dynamically created renderer');
              }
            }
          } catch (err) {
            console.error('[GalaxyRendererBootstrap] Error applying selection markers to dynamic renderer:', err);
          }
        }
      });
    }
  }

  /**
   * Log bootstrap status for debugging.
   */
  function logBootstrapStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      selectionMarkerOverlay: !!window.GQSelectionMarkerOverlay,
      galaxy3DRendererWebGPU: !!(window.Galaxy3DRendererWebGPU || window.GQGalaxy3DRendererWebGPU),
      integrationMixin: !!window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration,
      runtimeSelectionState: !!window.GQRuntimeSelectionState,
      selectionMarkerStyleTokens: !!window.GQSelectionMarkerStyleTokens,
    };

    console.group('[GalaxyRendererBootstrap-SelectionMarkers] Bootstrap Status');
    console.table(status);
    console.groupEnd();
  }

  // Initialize on document ready or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      logBootstrapStatus();
      initializeSelectionMarkerIntegration();
      registerRenderCreationHook();
    });
  } else {
    // Already loaded
    logBootstrapStatus();
    initializeSelectionMarkerIntegration();
    registerRenderCreationHook();
  }

  // Expose functions globally for manual control
  window.GQGalaxyRendererBootstrapSelectionMarkers = {
    initialize: initializeSelectionMarkerIntegration,
    registerHook: registerRenderCreationHook,
    logStatus: logBootstrapStatus,
  };
})();
