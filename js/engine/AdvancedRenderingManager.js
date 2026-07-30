/**
 * AdvancedRenderingManager.js
 *
 * Central manager for all advanced rendering features.
 * Provides unified API for enabling/disabling features and monitoring performance.
 *
 * Usage:
 *   const renderMgr = new AdvancedRenderingManager(gameEngine);
 *   renderMgr.enableFeature('lod', { targetFPS: 60 });
 *   renderMgr.enableFeature('bloom', { strength: 0.6 });
 *   renderMgr.getPerformanceReport();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class AdvancedRenderingManager {
  /**
   * @param {GameEngine} gameEngine - Reference to game engine
   */
  constructor(gameEngine) {
    this._gameEngine = gameEngine;

    // Feature states
    this._features = {
      lod: false,
      bloom: false,
      motionBlur: false,
      dof: false,
      toneMapping: false,
      decals: false,
      cinematicCamera: false,
      proceduralMeshes: false,
    };

    // Feature instances
    this._instances = {
      lodManager: null,
      dynamicBloomPass: null,
      motionVectorPass: null,
      dofPass: null,
      tonemappingPass: null,
      decalManager: null,
      cinematicCamera: null,
      proceduralMeshGenerator: null,
    };

    // Performance monitoring
    this._performanceMonitor = {
      frameCount: 0,
      fps: 0,
      triangles: 0,
      drawCalls: 0,
      gpuTime: 0,
      cpuTime: 0,
      memoryMB: 0,
    };

    this._lastUpdateTime = performance.now();
    this._frameStartTime = performance.now();
  }

  /**
   * Enable a specific rendering feature
   * @param {string} featureName - Feature key
   * @param {object} options - Feature-specific options
   * @returns {boolean} Success
   */
  enableFeature(featureName, options = {}) {
    const lowercased = featureName.toLowerCase();

    try {
      switch (lowercased) {
        case 'lod':
          return this._enableLOD(options);
        case 'bloom':
          return this._enableBloom(options);
        case 'motionblur':
          return this._enableMotionBlur(options);
        case 'dof':
          return this._enableDOF(options);
        case 'tonemapping':
          return this._enableToneMapping(options);
        case 'decals':
          return this._enableDecals(options);
        case 'cinematiccamera':
          return this._enableCinematicCamera(options);
        case 'proceduralmeshes':
          return this._enableProceduralMeshes(options);
        default:
          console.warn(`Unknown feature: ${featureName}`);
          return false;
      }
    } catch (err) {
      console.error(`Failed to enable feature ${featureName}:`, err);
      return false;
    }
  }

  /**
   * Disable a specific rendering feature
   * @param {string} featureName
   * @returns {boolean} Success
   */
  disableFeature(featureName) {
    const lowercased = featureName.toLowerCase();
    this._features[lowercased] = false;

    switch (lowercased) {
      case 'lod':
        if (this._instances.lodManager) {
          this._instances.lodManager.setEnabled(false);
        }
        break;
      case 'bloom':
        if (this._instances.dynamicBloomPass) {
          this._instances.dynamicBloomPass.enabled = false;
        }
        break;
      case 'motionblur':
        if (this._instances.motionVectorPass) {
          this._instances.motionVectorPass.enabled = false;
        }
        break;
      case 'dof':
        if (this._instances.dofPass) {
          this._instances.dofPass.enabled = false;
        }
        break;
      case 'tonemapping':
        if (this._instances.tonemappingPass) {
          this._instances.tonemappingPass.enabled = false;
        }
        break;
    }

    return true;
  }

  /**
   * Check if feature is enabled
   * @param {string} featureName
   * @returns {boolean}
   */
  isFeatureEnabled(featureName) {
    return this._features[featureName.toLowerCase()] ?? false;
  }

  /**
   * Get a feature instance (e.g., for external systems)
   * @param {string} featureName - Feature to retrieve
   * @returns {Object|null} Feature instance or null
   */
  getFeature(featureName) {
    const key = featureName.toLowerCase();
    if (key === 'decals') {
      return this._instances.decalManager;
    } else if (key === 'lod') {
      return this._instances.lodManager;
    }
    return this._instances[`${key}Pass`] ?? this._instances[`${key}Manager`] ?? null;
  }

  /**
   * Enable LOD system
   * @private
   */
  _enableLOD(options) {
    const { LODConfig } = require('./lod/LODConfig.js');
    const { LODManager } = require('./lod/LODManager.js');

    const config = new LODConfig();
    if (options.targetFPS) {
      config.globalSettings.targetFPS = options.targetFPS;
    }
    if (options.minFPS) {
      config.globalSettings.minFPS = options.minFPS;
    }

    this._instances.lodManager = new LODManager(config);
    this._features.lod = true;
    return true;
  }

  /**
   * Enable bloom pass
   * @private
   */
  _enableBloom(options) {
    const { DynamicBloomPass } = require('./post-effects/passes/DynamicBloomPass.js');

    const pass = new DynamicBloomPass({
      threshold: options.threshold ?? 0.85,
      strength: options.strength ?? 0.6,
      radius: options.radius ?? 1.5,
      adaptiveThreshold: options.adaptiveThreshold ?? true,
    });

    // Add to effect composer if available
    if (this._gameEngine.postFx) {
      this._gameEngine.postFx.addPass(pass);
    }

    this._instances.dynamicBloomPass = pass;
    this._features.bloom = true;
    return true;
  }

  /**
   * Enable motion blur
   * @private
   */
  _enableMotionBlur(options) {
    const { MotionVectorPass } = require('./post-effects/passes/MotionVectorPass.js');

    const pass = new MotionVectorPass({
      blurScale: options.blurScale ?? 1.0,
      sampleCount: options.sampleCount ?? 12,
      maxMotionBlur: options.maxMotionBlur ?? 20,
    });

    if (this._gameEngine.postFx) {
      this._gameEngine.postFx.addPass(pass);
    }

    this._instances.motionVectorPass = pass;
    this._features.motionblur = true;
    return true;
  }

  /**
   * Enable depth of field
   * @private
   */
  _enableDOF(options) {
    const { DepthOfFieldPass } = require('./post-effects/passes/DepthOfFieldPass.js');

    const pass = new DepthOfFieldPass({
      focalDistance: options.focalDistance ?? 1000,
      focalLength: options.focalLength ?? 50,
      aperture: options.aperture ?? 2.8,
      maxBlur: options.maxBlur ?? 25,
    });

    if (this._gameEngine.postFx) {
      this._gameEngine.postFx.addPass(pass);
    }

    this._instances.dofPass = pass;
    this._features.dof = true;
    return true;
  }

  /**
   * Enable HDR tone-mapping
   * @private
   */
  _enableToneMapping(options) {
    const { HDRTonemappingPass } = require('./post-effects/passes/HDRTonemappingPass.js');

    const pass = new HDRTonemappingPass({
      tonemappingMode: options.mode ?? 'ACES',
      exposure: options.exposure ?? 1.0,
      saturation: options.saturation ?? 1.0,
      gamma: options.gamma ?? 2.2,
    });

    if (this._gameEngine.postFx) {
      this._gameEngine.postFx.addPass(pass);
    }

    this._instances.tonemappingPass = pass;
    this._features.tonemapping = true;
    return true;
  }

  /**
   * Enable impact decals
   * @private
   */
  _enableDecals(options) {
    const { ImpactDecalManager } = require('./fx/ImpactDecalManager.js');

    const manager = new ImpactDecalManager({
      scene: this._gameEngine.scene?._threeScene,
      maxDecals: options.maxDecals ?? 500,
    });

    this._instances.decalManager = manager;
    this._features.decals = true;
    return true;
  }

  /**
   * Enable cinematic camera
   * @private
   */
  _enableCinematicCamera(options) {
    const { CinematicCamera } = require('./scene/CinematicCamera.js');

    const camera = new CinematicCamera(this._gameEngine.camera, {
      defaultSpeed: options.speed ?? 1.0,
    });

    this._instances.cinematicCamera = camera;
    this._features.cinematiccamera = true;
    return true;
  }

  /**
   * Enable procedural mesh generation
   * @private
   */
  _enableProceduralMeshes(options) {
    const { ProceduralMeshGenerator } = require('./procedural/ProceduralMeshGenerator.js');

    const generator = new ProceduralMeshGenerator();
    this._instances.proceduralMeshGenerator = generator;
    this._features.proceduralmeshes = true;
    return true;
  }

  /**
   * Update performance monitoring
   * @param {number} deltaTime
   */
  updateMetrics(deltaTime) {
    this._performanceMonitor.frameCount++;

    // Calculate FPS
    const now = performance.now();
    const elapsed = now - this._lastUpdateTime;
    if (elapsed >= 1000) {
      this._performanceMonitor.fps = this._performanceMonitor.frameCount;
      this._performanceMonitor.frameCount = 0;
      this._lastUpdateTime = now;
    }

    // Collect LOD metrics
    if (this._instances.lodManager) {
      const lodMetrics = this._instances.lodManager.getMetrics();
      this._performanceMonitor.triangles = lodMetrics.trianglesRendered;
    }

    // Collect memory metrics
    if (performance.memory) {
      this._performanceMonitor.memoryMB = performance.memory.usedJSHeapSize / 1024 / 1024;
    }
  }

  /**
   * Get comprehensive performance report
   * @returns {object}
   */
  getPerformanceReport() {
    const decalStats = this._instances.decalManager?.getStats?.() || {};

    return {
      timestamp: new Date().toISOString(),
      rendering: {
        fps: this._performanceMonitor.fps,
        triangles: this._performanceMonitor.triangles,
        memoryMB: this._performanceMonitor.memoryMB.toFixed(2),
      },
      features: {
        lod: {
          enabled: this._features.lod,
          objects: this._instances.lodManager?.getObjects()?.size ?? 0,
          triangles: this._instances.lodManager?.getMetrics()?.trianglesRendered ?? 0,
        },
        bloom: {
          enabled: this._features.bloom,
        },
        motionBlur: {
          enabled: this._features.motionblur,
        },
        decals: {
          enabled: this._features.decals,
          active: decalStats.activeDecals ?? 0,
          pooled: decalStats.pooledDecals ?? 0,
        },
      },
    };
  }

  /**
   * Get feature summary
   * @returns {object}
   */
  getFeatureSummary() {
    const summary = {};
    for (const [name, enabled] of Object.entries(this._features)) {
      summary[name] = enabled;
    }
    return summary;
  }

  /**
   * Load preset configuration
   * @param {string} preset - 'ultra' | 'high' | 'medium' | 'low' | 'mobile'
   */
  applyPreset(preset) {
    const presets = {
      ultra: {
        lod: { targetFPS: 60, minFPS: 45 },
        bloom: { strength: 1.0, radius: 2.0 },
        motionblur: { blurScale: 1.5, sampleCount: 16 },
        dof: { enabled: true },
        tonemapping: { mode: 'ACES' },
        decals: { maxDecals: 500 },
      },
      high: {
        lod: { targetFPS: 60, minFPS: 40 },
        bloom: { strength: 0.8, radius: 1.5 },
        motionblur: { blurScale: 1.0, sampleCount: 12 },
        dof: { enabled: false },
        tonemapping: { mode: 'ACES' },
        decals: { maxDecals: 400 },
      },
      medium: {
        lod: { targetFPS: 60, minFPS: 35 },
        bloom: { strength: 0.5, radius: 1.0 },
        motionblur: { blurScale: 0.7, sampleCount: 8 },
        dof: { enabled: false },
        tonemapping: { mode: 'UE4' },
        decals: { maxDecals: 250 },
      },
      low: {
        lod: { targetFPS: 30, minFPS: 25 },
        bloom: { strength: 0.3, radius: 0.8 },
        motionblur: { enabled: false },
        dof: { enabled: false },
        tonemapping: { mode: 'LINEAR' },
        decals: { maxDecals: 100 },
      },
      mobile: {
        lod: { targetFPS: 30, minFPS: 20 },
        bloom: { enabled: false },
        motionblur: { enabled: false },
        dof: { enabled: false },
        tonemapping: { enabled: false },
        decals: { maxDecals: 50 },
      },
    };

    const config = presets[preset];
    if (!config) {
      console.warn(`Unknown preset: ${preset}`);
      return false;
    }

    for (const [feature, options] of Object.entries(config)) {
      if (options.enabled === false) {
        this.disableFeature(feature);
      } else {
        this.enableFeature(feature, options);
      }
    }

    // Ensure passes are in correct execution order
    this._ensurePassOrder();

    return true;
  }

  /**
   * Ensure post-processing passes are in optimal execution order.
   * Order matters for correctness: bloom before tone mapping, motion vectors before motion blur.
   * @private
   */
  _ensurePassOrder() {
    const composer = this._gameEngine.postFx;
    if (!composer || !composer._passes) return;

    // Expected pass order (after RenderPass which is at index 0)
    const desiredOrder = [
      this._instances.dynamicBloomPass,      // 1. Extract bright areas
      this._instances.motionVectorPass,      // 2. Compute motion vectors
      this._instances.tonemappingPass,       // 3. Color grading / tone mapping
      this._instances.dofPass,               // 4. Depth of field (optional, usually last)
    ];

    // Collect all enabled passes in desired order
    const passesToAdd = desiredOrder.filter(p => p && p !== undefined);
    if (passesToAdd.length === 0) return;

    // Remove all passes except RenderPass (index 0)
    while (composer._passes.length > 1) {
      composer._passes.pop();
    }

    // Re-add in correct order
    passesToAdd.forEach(pass => {
      composer.addPass(pass);
    });

    this._log('[AdvancedRenderingManager] Post-processing passes reordered');
  }

  /**
   * Emit a debug log message
   * @private
   */
  _log(msg, ...args) {
    if (console) {
      console.debug(msg, ...args);
    }
  }

  /**
   * Export current configuration
   * @returns {object}
   */
  exportConfiguration() {
    return {
      timestamp: new Date().toISOString(),
      features: this.getFeatureSummary(),
      settings: {
        lod: this._instances.lodManager?._config?.globalSettings,
        bloom: {
          threshold: this._instances.dynamicBloomPass?.threshold,
          strength: this._instances.dynamicBloomPass?.strength,
        },
        motionblur: {
          blurScale: this._instances.motionVectorPass?.blurScale,
          sampleCount: this._instances.motionVectorPass?.sampleCount,
        },
      },
    };
  }

  /**
   * Update rendering features each frame
   * @param {number} deltaTime - Time since last frame in seconds
   * @param {import('./scene/Camera').Camera} camera - Active camera for distance calculations
   */
  update(deltaTime, camera) {
    // Update LOD manager if enabled
    if (this._features.lod && this._instances.lodManager && camera) {
      const cameraPos = camera.position;
      const fps = this._performanceMonitor.fps || 60;
      this._instances.lodManager.update(deltaTime, cameraPos, fps);
    }

    // Update metrics collection
    this.updateMetrics(deltaTime);
  }

  /**
   * Dispose all resources
   */
  dispose() {
    this._instances.lodManager?.dispose?.();
    this._instances.decalManager?.dispose?.();
    this._instances.proceduralMeshGenerator?.clearCache?.();
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AdvancedRenderingManager };
}
if (typeof window !== 'undefined') {
  window.GQAdvancedRenderingManager = { AdvancedRenderingManager };
}
