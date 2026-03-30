/**
 * GameEngine.js
 *
 * Top-level coordinator for the GalaxyQuest game engine.
 *
 * Sits above the RenderEngine layer and wires together:
 *   - RenderEngine   (WebGPURenderer | WebGLRenderer via RendererFactory)
 *   - SceneGraph     (spatial hierarchy)
 *   - Camera         (active viewing camera)
 *   - EffectComposer (post-processing pipeline)
 *   - PhysicsEngine  (CPU SpacePhysicsEngine + optional GPU WebGPUPhysics)
 *   - GameLoop       (fixed-step physics + variable render loop)
 *   - EventBus       (decoupled pub/sub events)
 *   - SystemRegistry (ordered update pipeline)
 *   - AssetRegistry  (asset cache + preloading)
 *   - PerformanceMonitor (FPS tracking)
 *   - ResourceTracker    (GPU leak detection)
 *
 * Architecture:
 *
 *   GameEngine
 *     ├── GameLoop          ← RAF, fixed-step accumulator
 *     │     ├── onFixedUpdate → PhysicsEngine.step()
 *     │     │                 → SystemRegistry.update(dt) [PHYSICS priority]
 *     │     ├── onUpdate    → SystemRegistry.update(dt) [non-physics]
 *     │     └── onRender    → SceneGraph.update()
 *     │                     → Renderer.render(scene, camera)
 *     │                     → EffectComposer.render()
 *     │                     → PerformanceMonitor.tick()
 *     ├── EventBus          ← 'engine:start', 'engine:stop', 'engine:resize'
 *     │                       'physics:step', 'render:frame', 'asset:loaded'
 *     └── AssetRegistry     ← preload + cache
 *
 * Usage:
 *   const engine = await GameEngine.create(canvas, {
 *     renderer: 'auto',         // 'webgpu' | 'webgl2' | 'auto'
 *     physics:  'auto',         // 'cpu' | 'gpu' | 'auto'
 *     fixedStep: 1/60,
 *   });
 *   engine.events.on('render:frame', ({ alpha }) => myHUD.update(alpha));
 *   engine.start();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Dependency loading (browser-global + CommonJS dual-mode)
// ---------------------------------------------------------------------------

function _req(modPath, globalName) {
  if (typeof require !== 'undefined') return require(modPath);
  const g = typeof window !== 'undefined' ? window : globalThis;
  const v = g[globalName];
  if (!v) throw new Error(`[GameEngine] missing global: ${globalName} (expected from ${modPath})`);
  return v;
}

const { RendererFactory }    = _req('./core/RendererFactory.js',          'GQRendererFactory');
const { SceneGraph, SceneNode } = _req('./scene/SceneGraph.js',           'GQSceneGraph');
const { PerspectiveCamera }  = _req('./scene/Camera.js',                  'GQCamera');
const { CameraManager }      = _req('./scene/CameraManager.js',           'GQCameraManager');
const { EffectComposer }     = _req('./post-effects/EffectComposer.js',   'GQEffectComposer');
const { RenderPass }         = _req('./post-effects/passes/RenderPass.js','GQRenderPass');
const { GameLoop }           = _req('./GameLoop.js',                      'GQGameLoop');
const { EventBus }           = _req('./EventBus.js',                      'GQEventBus');
const { SystemRegistry, SystemPriority } = _req('./SystemRegistry.js',   'GQSystemRegistry');
const { AssetRegistry }      = _req('./AssetRegistry.js',                 'GQAssetRegistry');
const { PerformanceMonitor } = _req('./utils/PerformanceMonitor.js',      'GQPerformanceMonitor');
const { ResourceTracker }    = _req('./utils/ResourceTracker.js',         'GQResourceTracker');
const { ViewportManager }    = _req('./ViewportManager.js',               'GQViewportManager');

// ---------------------------------------------------------------------------
// GameEngine
// ---------------------------------------------------------------------------

class GameEngine {
  // Private constructor — use GameEngine.create()
  constructor() {
    /** @type {import('./core/GraphicsContext').IGraphicsRenderer|null} */
    this.renderer         = null;
    /** @type {SceneGraph} */
    this.scene            = new SceneGraph();
    /** @type {import('./scene/Camera').Camera|null} */
    this.camera           = null;
    /** Multi-camera manager (primary + follow cameras) */
    this.cameras          = null;
    /** PiP viewport manager */
    this.viewports        = null;
    /** @type {EffectComposer|null} */
    this.postFx           = null;
    /** @type {GameLoop} */
    this.loop             = null;
    /** @type {EventBus} */
    this.events           = new EventBus();
    /** @type {SystemRegistry} */
    this.systems          = new SystemRegistry();
    /** @type {AssetRegistry|null} */
    this.assets           = null;
    /** @type {PerformanceMonitor} */
    this.perf             = new PerformanceMonitor();
    /** @type {ResourceTracker} */
    this.resources        = new ResourceTracker();

    /** CPU physics engine (SpacePhysicsEngine, always available) */
    this.physics          = null;
    /** GPU physics engine (WebGPUPhysics, optional) */
    this.gpuPhysics       = null;
    /** Active physics backend: 'cpu' | 'gpu' */
    this.physicsBackend   = 'cpu';

    /** @type {HTMLCanvasElement|null} */
    this.canvas           = null;
    /** Engine configuration snapshot */
    this.config           = {};
    /** True once init is complete and start() has not been called */
    this.initialized      = false;
    /** True while the loop is running */
    this.running          = false;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Create and fully initialise a GameEngine.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {Object}  [opts]
   * @param {string}  [opts.renderer='auto']     Renderer hint: 'webgpu'|'webgl2'|'auto'
   * @param {string}  [opts.physics='auto']      Physics backend: 'cpu'|'gpu'|'auto'
   * @param {number}  [opts.fixedStep=1/60]      Physics fixed step in seconds
   * @param {number}  [opts.maxDt=0.25]          Max frame delta (spiral-of-death guard)
   * @param {number}  [opts.fov=60]              Camera vertical FOV in degrees
   * @param {boolean} [opts.postFx=true]         Enable EffectComposer
   * @param {Object|boolean} [opts.bloom]        Bloom pass options (false = disabled)
   * @param {number}  [opts.bloom.threshold=0.8] Luminance threshold
   * @param {number}  [opts.bloom.strength=1.2]  Bloom intensity
   * @param {number}  [opts.bloom.radius=0.6]    Blur radius
   * @param {Object|boolean} [opts.vignette]     Vignette pass options (false = disabled)
   * @param {number}  [opts.vignette.darkness=0.5] Edge darkness (0–1)
   * @param {number}  [opts.vignette.falloff=2.0]  Falloff exponent
   * @param {Object|boolean} [opts.chromatic]    Chromatic-aberration pass options (false = disabled)
   * @param {number}  [opts.chromatic.power=0.005] Shift magnitude
   * @param {number}  [opts.chromatic.angle=0]     Shift direction (radians)
   * @param {boolean} [opts.debug=false]         Verbose logging
   * @returns {Promise<GameEngine>}
   */
  static async create(canvas, opts = {}) {
    const engine = new GameEngine();
    await engine._init(canvas, opts);
    return engine;
  }

  /**
   * Create a GameEngine using a pre-built renderer (useful in tests and
   * server-side rendering contexts where no real GPU is available).
   *
   * @param {import('./core/GraphicsContext').IGraphicsRenderer} renderer
   * @param {HTMLCanvasElement|{width:number,height:number}} canvas
   * @param {Object} [opts]  Same as create() except opts.renderer is ignored
   * @returns {Promise<GameEngine>}
   */
  static async createWithRenderer(renderer, canvas, opts = {}) {
    const engine = new GameEngine();
    await engine._init(canvas, { ...opts, _rendererOverride: renderer });
    return engine;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start the game loop. Emits 'engine:start'. */
  start() {
    if (this.running) return;
    this.running = true;
    this.loop.start();
    this.events.emit('engine:start', { engine: this });
  }

  /** Pause the loop — physics accumulator is frozen. */
  pause() {
    this.loop.pause();
    this.events.emit('engine:pause', { engine: this });
  }

  /** Resume after pause(). */
  resume() {
    this.loop.resume();
    this.events.emit('engine:resume', { engine: this });
  }

  /** Stop the loop. Emits 'engine:stop'. */
  stop() {
    if (!this.running) return;
    this.running = false;
    this.loop.stop();
    this.events.emit('engine:stop', { engine: this });
  }

  /**
   * Notify the engine that the canvas was resized.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this.renderer?.resize(width, height);
    this.postFx?.resize(width, height);
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.setAspect(width / height);
    }
    // Update aspect for all secondary follow-cameras too
    if (this.cameras) {
      for (const { camera } of this.cameras.secondaryCameras) {
        if (typeof camera.setAspect === 'function') {
          camera.setAspect(width / height);
        }
      }
    }
    this.events.emit('engine:resize', { width, height });
  }

  /**
   * Fully dispose all engine resources. The engine cannot be reused.
   */
  dispose() {
    this.stop();
    this.systems.list().forEach((s) => this.systems.remove(s.name));
    this.viewports?.detach();
    this.cameras?.dispose();
    this.postFx?.dispose();
    this.gpuPhysics?.dispose();
    this.resources.disposeAll();
    this.renderer?.dispose();
    this.events.clear();
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Convenience helpers
  // ---------------------------------------------------------------------------

  /**
   * Add a node to the scene.
   * @param {SceneNode} node
   */
  addToScene(node) {
    this.scene.add(node);
    return this;
  }

  /**
   * Register a game system.
   * @param {Object} system  Must have { name, update(dt, engine) }
   */
  addSystem(system) {
    this.systems.add(system);
    return this;
  }

  /**
   * Add a follow-camera PiP viewport.
   *
   * Creates a FollowCamera, registers it in CameraManager, and opens a PiP
   * window via ViewportManager — all in one call.
   *
   * @param {string}  name      Unique identifier (e.g. 'ship-alpha', 'colony-ignis')
   * @param {{ position:{x,y,z} }} target  Game object to follow
   * @param {Object}  [opts]
   * @param {string}  [opts.label]      Display label (defaults to name)
   * @param {string}  [opts.mode]       FollowMode — 'fixed_offset'|'orbit'|'free'
   * @param {number}  [opts.lag=0.1]    Smoothing lag [0=instant]
   * @param {number}  [opts.distance]   Orbit distance
   * @param {{x,y,z}} [opts.offset]    Fixed offset vector
   * @param {number}  [opts.fov=60]     Camera FOV
   * @param {number}  [opts.x]          PiP x position (px)
   * @param {number}  [opts.y]          PiP y position (px)
   * @param {number}  [opts.width=220]  PiP width (px)
   * @param {number}  [opts.height=150] PiP height (px)
   * @returns {this}
   */
  addFollowViewport(name, target, opts = {}) {
    const { FollowCamera } = typeof require !== 'undefined'
      ? require('./scene/FollowCamera.js')
      : (window.GQFollowCamera ?? {});

    if (!FollowCamera) {
      console.warn('[GameEngine] FollowCamera not loaded — cannot add follow viewport');
      return this;
    }

    const aspect = this.canvas.width > 0 && this.canvas.height > 0
      ? this.canvas.width / this.canvas.height : 1;
    const cam = new FollowCamera({ name: opts.label ?? name, fov: opts.fov ?? 60, aspect });
    cam.setTarget(target, {
      mode:     opts.mode,
      lag:      opts.lag,
      offset:   opts.offset,
      distance: opts.distance,
    });

    this.cameras.add(name, cam, { targetId: target?.name ?? name });

    if (this.viewports) {
      this.viewports.add(name, {
        label:  opts.label  ?? name,
        x:      opts.x,
        y:      opts.y,
        width:  opts.width  ?? 220,
        height: opts.height ?? 150,
      });
    }

    return this;
  }

  /** Shorthand: emit an event on the engine bus. */
  emit(event, payload) {
    this.events.emit(event, payload);
  }

  /**
   * Update post-processing pass parameters at runtime.
   *
   * Any key present in `cfg` overrides the corresponding pass property.
   * Pass a falsy value to keep the current setting unchanged.
   *
   * @param {Object} cfg
   * @param {Object} [cfg.bloom]       Bloom params: { enabled, threshold, strength, radius }
   * @param {Object} [cfg.vignette]    Vignette params: { enabled, darkness, falloff }
   * @param {Object} [cfg.chromatic]   Chromatic params: { enabled, power, angle }
   * @returns {this}
   */
  configurePostFx(cfg) {
    if (!this.postFx || !cfg) return this;

    const { bloom, vignette, chromatic } = cfg;

    if (bloom && this._bloomPass) {
      if (bloom.enabled  !== undefined) this._bloomPass.enabled   = !!bloom.enabled;
      if (bloom.threshold !== undefined) this._bloomPass.threshold = bloom.threshold;
      if (bloom.strength  !== undefined) this._bloomPass.strength  = bloom.strength;
      if (bloom.radius    !== undefined) this._bloomPass.radius    = bloom.radius;
    }
    if (vignette && this._vignettePass) {
      if (vignette.enabled  !== undefined) this._vignettePass.enabled  = !!vignette.enabled;
      if (vignette.darkness !== undefined) this._vignettePass.darkness = vignette.darkness;
      if (vignette.falloff  !== undefined) this._vignettePass.falloff  = vignette.falloff;
    }
    if (chromatic && this._chromaticPass) {
      if (chromatic.enabled !== undefined) this._chromaticPass.enabled = !!chromatic.enabled;
      if (chromatic.power   !== undefined) this._chromaticPass.power   = chromatic.power;
      if (chromatic.angle   !== undefined) this._chromaticPass.angle   = chromatic.angle;
    }

    this.events.emit('postfx:configured', { cfg });
    return this;
  }

  // ---------------------------------------------------------------------------
  // Private init
  // ---------------------------------------------------------------------------

  async _init(canvas, opts) {
    this.canvas = canvas;
    this.config = { ...opts };

    const debugLog = opts.debug
      ? (msg, ...a) => console.info('[GameEngine]', msg, ...a)
      : () => {};

    // 1. Renderer
    debugLog('Initialising renderer…');
    if (opts._rendererOverride) {
      this.renderer = opts._rendererOverride;
    } else {
      this.renderer = await RendererFactory.create(canvas, {
        hint: opts.renderer ?? 'auto',
        onFallback: (reason) => {
          debugLog('Renderer fallback:', reason);
          this.events.emit('engine:rendererFallback', { reason });
        },
      });
    }
    this.assets = new AssetRegistry(this.renderer);

    debugLog('Renderer ready — caps:', this.renderer.getCapabilities());

    // 2. Default camera
    const aspect = canvas.width > 0 && canvas.height > 0
      ? canvas.width / canvas.height
      : 1;
    this.camera  = new PerspectiveCamera(opts.fov ?? 60, aspect, 0.1, 10000);
    this.cameras = new CameraManager(this.camera);

    // 3. Viewport manager (PiP windows) — only in browser context
    if (typeof document !== 'undefined' && canvas.parentElement) {
      this.viewports = new ViewportManager(canvas, this.renderer, this.cameras);
    }

    // 4. Post-processing
    if (opts.postFx !== false) {
      this.postFx = new EffectComposer(
        this.renderer,
        canvas.width  || 800,
        canvas.height || 600,
      );

      // Always add the base RenderPass first
      const renderPass = new RenderPass(this.scene, this.cameras?.active ?? this.camera);
      this.postFx.addPass(renderPass);
      this._renderPass = renderPass;

      // Load the optional effect-pass constructors lazily via dynamic import()
      // so that both this runtime code and ESM `import` statements in test files
      // resolve to the same module instance (avoiding instanceof failures caused
      // by the CJS-require / ESM-import dual-module-cache split).
      const _g = typeof window !== 'undefined' ? window : globalThis;
      let BloomPass, VignettePass, ChromaticPass;
      if (typeof _g.GQBloomPass !== 'undefined') {
        // Browser plain-script context: globals were set by <script> tags.
        BloomPass    = _g.GQBloomPass;
        VignettePass = _g.GQVignettePass;
        ChromaticPass = _g.GQChromaticPass;
      } else {
        // Node.js / bundler / test context: dynamic import() shares the ESM
        // module registry with static `import` statements, guaranteeing
        // identical class constructors for `instanceof` checks.
        ([{ BloomPass }, { VignettePass }, { ChromaticPass }] = await Promise.all([
          import('./post-effects/passes/BloomPass.js'),
          import('./post-effects/passes/VignettePass.js'),
          import('./post-effects/passes/ChromaticPass.js'),
        ]));
      }

      // Optional effect passes — enabled by default when postFx is on,
      // unless explicitly set to false in opts
      if (opts.bloom !== false) {
        const bloomOpts = typeof opts.bloom === 'object' ? opts.bloom : {};
        this._bloomPass = new BloomPass(bloomOpts);
        this.postFx.addPass(this._bloomPass);
      }
      if (opts.vignette !== false) {
        const vignetteOpts = typeof opts.vignette === 'object' ? opts.vignette : {};
        this._vignettePass = new VignettePass(vignetteOpts);
        this.postFx.addPass(this._vignettePass);
      }
      if (opts.chromatic !== false) {
        const chromaticOpts = typeof opts.chromatic === 'object' ? opts.chromatic : {};
        this._chromaticPass = new ChromaticPass(chromaticOpts);
        this.postFx.addPass(this._chromaticPass);
      }
    }

    // 4. Physics
    await this._initPhysics(opts);

    // 5. Game loop
    this.loop = new GameLoop({
      fixedStep: opts.fixedStep ?? (1 / 60),
      maxDt:     opts.maxDt    ?? 0.25,

      onFixedUpdate: (dt) => this._onFixedUpdate(dt),
      onUpdate:      (dt, alpha) => this._onUpdate(dt, alpha),
      onRender:      (alpha) => this._onRender(alpha),
      onPanic:       () => this.events.emit('engine:panic', {}),
    });

    // 6. Built-in window resize wiring
    if (typeof window !== 'undefined' && canvas.parentElement) {
      this._resizeObserver = new (window.ResizeObserver ?? _NoopResizeObserver)(([entry]) => {
        const { width, height } = entry.contentRect;
        this.resize(Math.round(width), Math.round(height));
      });
      this._resizeObserver.observe(canvas.parentElement);
    }

    this.initialized = true;
    this.events.emit('engine:initialized', { engine: this });
    debugLog('Engine initialised.');
  }

  async _initPhysics(opts) {
    // CPU physics — always available via window.GQSpacePhysicsEngine
    const cpuPhysicsFactory =
      typeof require !== 'undefined'
        ? null   // loaded via game scripts at runtime in browser
        : (typeof window !== 'undefined' && window.GQSpacePhysicsEngine?.create);

    if (typeof window !== 'undefined' && window.GQSpacePhysicsEngine) {
      this.physics = window.GQSpacePhysicsEngine.create({
        gravitationalConstant: opts.gravitationalConstant,
        softening:             opts.softening,
        maxAcceleration:       opts.maxAcceleration,
      });
      this.physicsBackend = 'cpu';
    }

    // GPU physics — opt-in, requires WebGPU + compute shaders
    const wantGpu   = opts.physics === 'gpu' || opts.physics === 'auto';
    const caps      = this.renderer.getCapabilities();
    const canUseGpu = wantGpu && caps.webgpu && caps.computeShaders;

    if (canUseGpu) {
      try {
        const { WebGPUPhysics } = typeof require !== 'undefined'
          ? require('./webgpu/WebGPUPhysics.js')
          : window.GQWebGPUPhysics;

        this.gpuPhysics = new WebGPUPhysics(this.renderer.device, {
          gravitationalConstant: opts.gravitationalConstant,
          softening:             opts.softening,
          maxAcceleration:       opts.maxAcceleration,
        });
        this.gpuPhysics.init();
        this.physicsBackend = 'gpu';
      } catch (err) {
        console.warn('[GameEngine] GPU physics init failed, using CPU:', err.message);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Loop callbacks
  // ---------------------------------------------------------------------------

  _onFixedUpdate(dt) {
    // Run physics
    if (this.gpuPhysics && this.physics && this.physicsBackend === 'gpu') {
      this.gpuPhysics.uploadBodies(this.physics.bodies);
      this.gpuPhysics.step(dt);
      // Async readback — don't await to keep the loop non-blocking
      this.gpuPhysics.readback(this.physics.bodies).catch(console.error);
    } else if (this.physics) {
      // CPU: step each body individually
      for (const body of this.physics.bodies.values()) {
        this.physics.stepBody(body, dt);
      }
    }

    // Physics-priority systems
    this.systems.update(dt, this);
    this.events.emit('physics:step', { dt });
  }

  _onUpdate(dt, alpha) {
    // Update all cameras (primary + follow cameras) with smooth lag
    this.cameras ? this.cameras.update(dt) : this.camera?.update?.();
    this.scene.update();
    this.events.emit('engine:update', { dt, alpha });
  }

  _onRender(alpha) {
    this.perf.tick();

    if (!this.renderer) return;

    // Main render (primary camera)
    if (this.postFx && this.postFx._passes.length > 0) {
      this.postFx.render(null);
    } else {
      this.renderer.render(this.scene, this.cameras?.active ?? this.camera);
    }

    // Secondary PiP viewports
    this.viewports?.render(this.scene);

    this.events.emit('render:frame', {
      alpha,
      frame:       this.loop.frame,
      fps:         this.perf.fps,
      frameTimeMs: this.perf.frameTimeMs,
    });
  }
}

// ---------------------------------------------------------------------------
// Noop fallback for environments without ResizeObserver (Node.js / tests)
// ---------------------------------------------------------------------------

class _NoopResizeObserver {
  constructor() {}
  observe()   {}
  unobserve() {}
  disconnect(){}
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GameEngine };
} else {
  window.GQGameEngine = GameEngine;
}
