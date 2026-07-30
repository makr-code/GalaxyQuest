/**
 * SelectionMarkerIntegrationExample.js
 * 
 * Example integration of the persistent selection marker system with a game loop.
 * 
 * This file demonstrates best practices for integrating the marker system
 * with your game's rendering pipeline and event handling.
 * 
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

/**
 * Example marker system integration
 */
class GalaxyQuestSelectionMarkerManager {
  constructor(options = {}) {
    // Configuration
    this.config = {
      canvasSelector: options.canvasSelector || '#selection-markers',
      enableCulling: options.enableCulling !== false,
      enableAnimations: options.enableAnimations !== false,
      animationPoolSize: options.animationPoolSize || 100,
      glowEnabled: options.glowEnabled !== false,
      glowBlur: options.glowBlur || 8,
      baseRadius: options.baseRadius || 20,
    };

    // Component instances
    this.canvas = null;
    this.renderer = null;
    this.animationPool = null;
    this.compositor = null;
    this.selectionState = null;

    // Runtime state
    this.isInitialized = false;
    this.frameCount = 0;
    this.lastFrameTime = 0;
  }

  /**
   * Initialize the marker system
   */
  initialize() {
    // Step 1: Get canvas
    this.canvas = document.querySelector(this.config.canvasSelector);
    if (!this.canvas) {
      console.warn(`Selection marker canvas not found: ${this.config.canvasSelector}`);
      return false;
    }

    try {
      // Step 2: Create renderer
      if (window.GQPersistentSelectionMarkerRenderer) {
        this.renderer = new window.GQPersistentSelectionMarkerRenderer.CanvasMarkerRenderer(
          this.canvas,
          {
            baseRadius: this.config.baseRadius,
            enableGlow: this.config.glowEnabled,
            glowBlur: this.config.glowBlur,
          }
        );
      }

      // Step 3: Create animation pool
      if (window.GQSelectionMarkerAnimationEngine) {
        this.animationPool = new window.GQSelectionMarkerAnimationEngine.AnimationManagerPool(
          this.config.animationPoolSize
        );
      }

      // Step 4: Create compositor
      if (window.GQSelectionMarkerCompositor) {
        this.compositor = new window.GQSelectionMarkerCompositor.SelectionMarkerCompositor(
          this.renderer,
          this.animationPool,
          {
            enableCulling: this.config.enableCulling,
            enableBatching: true,
            cullingRadius: 1000,
          }
        );
      }

      // Step 5: Get or create selection state
      if (window.GQRuntimeSelectionState) {
        this.selectionState = window.GQRuntimeSelectionState.createSelectionStore();
        this.compositor?.setSelectionState(this.selectionState);
      }

      this.isInitialized = true;
      console.log('Selection marker system initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize selection marker system:', error);
      return false;
    }
  }

  /**
   * Update viewport bounds when camera changes
   */
  updateViewport(bounds) {
    if (!this.compositor) return;

    this.compositor.setViewportBounds({
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    });
  }

  /**
   * Handle pointer move event
   */
  handlePointerMove(x, y, rendererTarget) {
    if (!this.selectionState) return;

    // Normalize renderer target
    const normalized = this.normalizeTarget(rendererTarget, { x, y }, 'hover');

    // Commit to selection state
    if (window.GQRuntimeSelectionState) {
      window.GQRuntimeSelectionState.commitSelectionState('hover', rendererTarget, { x, y }, 'hover');
    }
  }

  /**
   * Handle pointer click event
   */
  handlePointerClick(x, y, rendererTarget) {
    if (!this.selectionState) return;

    // Commit to selection state
    if (window.GQRuntimeSelectionState) {
      window.GQRuntimeSelectionState.commitSelectionState(
        'active',
        rendererTarget,
        { x, y },
        'click'
      );
    }
  }

  /**
   * Handle pointer leave event
   */
  handlePointerLeave() {
    if (!this.selectionState) return;

    // Clear hover
    if (window.GQRuntimeSelectionState) {
      window.GQRuntimeSelectionState.commitSelectionState('hover', null, null, 'leave');
    }
  }

  /**
   * Main update loop (call once per frame)
   */
  update(deltaMs = 16) {
    if (!this.isInitialized || !this.compositor) return;

    this.frameCount++;
    this.lastFrameTime = deltaMs;

    // Update selection state from runtime (if coupled)
    if (this.config.enableAnimations) {
      this.compositor.update();
    }
  }

  /**
   * Main render loop (call once per frame after update)
   */
  render() {
    if (!this.isInitialized || !this.compositor || !this.renderer) return;

    // Clear canvas
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Render markers
    this.compositor.render();
  }

  /**
   * Normalize a renderer target to selection state format
   */
  normalizeTarget(target, position, eventType) {
    if (!target || typeof target !== 'object') {
      return null;
    }

    return {
      key: target.__selectionKey || `${target.__kind || 'unknown'}:${target.id || 0}`,
      kind: target.__kind || 'unknown',
      target: target,
      position: position || { x: 0, y: 0 },
      eventType: eventType || 'hover',
    };
  }

  /**
   * Clear all markers
   */
  clear() {
    if (this.compositor) {
      this.compositor.clear();
    }
  }

  /**
   * Get system statistics
   */
  getStats() {
    if (!this.compositor) return {};

    return {
      frameCount: this.frameCount,
      lastFrameTime: this.lastFrameTime,
      ...this.compositor.getStatistics(),
    };
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    if (this.compositor) {
      this.compositor.clear();
    }
    if (this.animationPool) {
      this.animationPool.releaseAll();
    }

    this.isInitialized = false;
    console.log('Selection marker system destroyed');
  }
}

/**
 * Example game loop integration
 */
class ExampleGameWithMarkers {
  constructor() {
    this.markerManager = new GalaxyQuestSelectionMarkerManager({
      canvasSelector: '#selection-markers',
      enableCulling: true,
      animationPoolSize: 100,
    });

    this.lastFrameTime = performance.now();
  }

  /**
   * Initialize the game
   */
  init() {
    // Initialize marker system
    if (!this.markerManager.initialize()) {
      console.warn('Marker system initialization failed, continuing without markers');
    }

    // Setup event listeners
    this.setupEventListeners();

    // Start game loop
    this.gameLoop();
  }

  /**
   * Setup input event listeners
   */
  setupEventListeners() {
    const canvas = this.markerManager.canvas;
    if (!canvas) return;

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Get object at point (you would implement this based on your renderer)
      const target = this.getObjectAtPoint(x, y);
      this.markerManager.handlePointerMove(x, y, target);
    });

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const target = this.getObjectAtPoint(x, y);
      this.markerManager.handlePointerClick(x, y, target);
    });

    canvas.addEventListener('pointerleave', () => {
      this.markerManager.handlePointerLeave();
    });

    // Update viewport on window resize
    window.addEventListener('resize', () => {
      const bounds = this.getViewportBounds();
      this.markerManager.updateViewport(bounds);
    });
  }

  /**
   * Get object at screen point (example implementation)
   */
  getObjectAtPoint(x, y) {
    // This would ray-cast or use your renderer's picking system
    // For example, if using Three.js:
    // raycaster.setFromCamera(screenPoint, camera);
    // const intersects = raycaster.intersectObjects(scene.children);
    // return intersects[0]?.object?.__gameObject || null;

    return null;
  }

  /**
   * Get current viewport bounds (example)
   */
  getViewportBounds() {
    const canvas = this.markerManager.canvas;
    if (!canvas) {
      return { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    }

    return {
      minX: -canvas.width / 2,
      minY: -canvas.height / 2,
      maxX: canvas.width / 2,
      maxY: canvas.height / 2,
    };
  }

  /**
   * Main game loop
   */
  gameLoop = () => {
    const now = performance.now();
    const deltaMs = Math.min(now - this.lastFrameTime, 33); // Cap at 33ms (~30 FPS)
    this.lastFrameTime = now;

    // Update game logic
    this.update(deltaMs / 1000); // Convert to seconds

    // Render
    this.render();

    // Schedule next frame
    requestAnimationFrame(this.gameLoop);
  };

  /**
   * Update game state
   */
  update(deltaSeconds) {
    // Update game logic
    // ...

    // Update marker system
    this.markerManager.update(deltaSeconds * 1000);
  }

  /**
   * Render the game
   */
  render() {
    // Render game content
    // ...

    // Render markers on top
    this.markerManager.render();

    // Log stats periodically
    if (Math.floor(Date.now() / 1000) % 5 === 0) {
      const stats = this.markerManager.getStats();
      console.debug('Marker stats:', stats);
    }
  }

  /**
   * Cleanup on game shutdown
   */
  shutdown() {
    this.markerManager.destroy();
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GalaxyQuestSelectionMarkerManager,
    ExampleGameWithMarkers,
  };
} else {
  window.GQSelectionMarkerIntegration = {
    GalaxyQuestSelectionMarkerManager,
    ExampleGameWithMarkers,
  };
}
