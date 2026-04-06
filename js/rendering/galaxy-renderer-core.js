/*
 * Galaxy Renderer Core
 * Shared Three.js render engine for auth background and in-game galaxy/system views.
 */
(function () {
  function emitRenderTelemetry(type, payload) {
    const detail = Object.assign({
      type,
      ts: Date.now(),
      source: 'galaxy-renderer-core',
    }, payload || {});
    try {
      if (!Array.isArray(window.__GQ_RENDER_TELEMETRY)) {
        window.__GQ_RENDER_TELEMETRY = [];
      }
      window.__GQ_RENDER_TELEMETRY.push(detail);
      if (window.__GQ_RENDER_TELEMETRY.length > 300) {
        window.__GQ_RENDER_TELEMETRY.splice(0, window.__GQ_RENDER_TELEMETRY.length - 300);
      }
      window.dispatchEvent(new CustomEvent('gq:render-telemetry', { detail }));
    } catch (_) {}
  }

  function ensureGalaxyEngineBridge() {
    const existing = window.GQGalaxyEngineBridge;
    if (existing
      && typeof existing.registerAdapter === 'function'
      && typeof existing.getAdapter === 'function') {
      return existing;
    }

    const adapters = new Map();
    const bridge = {
      registerAdapter(name, adapter) {
        const key = String(name || '').trim().toLowerCase();
        if (!key || !adapter || typeof adapter !== 'object') return false;
        adapters.set(key, adapter);
        return true;
      },
      getAdapter(name) {
        const key = String(name || '').trim().toLowerCase();
        return key ? (adapters.get(key) || null) : null;
      },
      listAdapters() {
        return Array.from(adapters.keys());
      },
    };
    window.GQGalaxyEngineBridge = bridge;
    return bridge;
  }

  ensureGalaxyEngineBridge();

  function resolveThreeRuntime(win) {
    const three = win?.THREE || null;
    const hasCoreCtors = (obj) => !!obj
      && (typeof obj === 'object' || typeof obj === 'function')
      && typeof obj.Vector3 === 'function'
      && typeof obj.Scene === 'function';

    const candidates = [];
    const push = (value) => {
      if (!value) return;
      if (candidates.includes(value)) return;
      candidates.push(value);
    };

    push(three);
    if (three && (typeof three === 'object' || typeof three === 'function')) {
      push(three.THREE);
      push(three.default);
      push(three.module);
      push(three.namespace);
    }
    push(win?.__GQ_THREE_RUNTIME || null);
    push(win?.__THREE__ || null);
    push(win?.THREE_NS || null);

    try {
      const names = Object.getOwnPropertyNames(win || {});
      for (const name of names) {
        if (!/three/i.test(String(name || ''))) continue;
        push(win[name]);
      }
    } catch (_) {}

    for (const candidate of candidates) {
      if (!hasCoreCtors(candidate)) continue;
      try {
        win.THREE = candidate;
        win.__GQ_THREE_RUNTIME = candidate;
      } catch (_) {}
      return candidate;
    }

    return null;
  }

  function ensureThreeMathUtils(win) {
    const three = resolveThreeRuntime(win);
    if (!three || (typeof three !== 'object' && typeof three !== 'function')) return false;

    const existing = (three.MathUtils && typeof three.MathUtils === 'object') ? three.MathUtils : {};
    const fallback = {
      clamp(value, min, max) {
        const v = Number(value);
        const lo = Number(min);
        const hi = Number(max);
        if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi)) return lo;
        return Math.min(hi, Math.max(lo, v));
      },
      lerp(a, b, t) {
        const ta = Number(a);
        const tb = Number(b);
        const tt = Number(t);
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
        const k = Number.isFinite(tt) ? Math.min(1, Math.max(0, tt)) : 0;
        return ta + (tb - ta) * k;
      },
      degToRad(deg) {
        const d = Number(deg);
        if (!Number.isFinite(d)) return 0;
        return d * (Math.PI / 180);
      },
    };

    try {
      three.MathUtils = Object.assign({}, fallback, existing);
    } catch (_) {
      return false;
    }
    return typeof three.MathUtils?.clamp === 'function';
  }

  function getThreeMathUtils(win) {
    const math = win?.THREE?.MathUtils;
    if (math && typeof math.clamp === 'function') return math;
    if (ensureThreeMathUtils(win) && win?.THREE?.MathUtils && typeof win.THREE.MathUtils.clamp === 'function') {
      return win.THREE.MathUtils;
    }
    return {
      clamp(value, min, max) {
        const v = Number(value);
        const lo = Number(min);
        const hi = Number(max);
        if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi)) return lo;
        return Math.min(hi, Math.max(lo, v));
      },
      lerp(a, b, t) {
        const ta = Number(a);
        const tb = Number(b);
        const tt = Number(t);
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
        const k = Number.isFinite(tt) ? Math.min(1, Math.max(0, tt)) : 0;
        return ta + (tb - ta) * k;
      },
      degToRad(deg) {
        const d = Number(deg);
        if (!Number.isFinite(d)) return 0;
        return d * (Math.PI / 180);
      },
    };
  }

  function createFallbackRendererConfig() {
    return {
      getOptionDefaults() {
        return {
          onHover: null,
          onClick: null,
          onDoubleClick: null,
          interactive: true,
        };
      },
      getRuntimeTuning() {
        return {
          zoomThresholds: {
            galaxyEnterSystem: 145,
            galaxyResetSystem: 210,
            systemEnterPlanet: 50,
            systemResetPlanet: 86,
            planetExitToSystem: 108,
            planetResetExit: 66,
            systemExitToGalaxy: 330,
            systemResetExit: 230,
          },
          focusDamping: {
            galaxy: 1.65,
            system: 2.1,
            planet: 2.65,
          },
        };
      },
      applyControlTuning(controls) {
        if (!controls || typeof controls !== 'object') return;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 40;
        controls.maxDistance = 2400;
      },
    };
  }

  function resolveRendererConfig() {
    return window.GQGalaxyRendererConfig || createFallbackRendererConfig();
  }

  function resolveRendererEvents() {
    const events = window.GQGalaxyRendererEvents || window.GQGalaxyRendererEventBindingShared;
    if (events && typeof events.bindEvents === 'function' && typeof events.unbindEvents === 'function') {
      return events;
    }
    return {
      bindEvents() {},
      unbindEvents() {},
    };
  }

  function summarizeSystemRenderPayloadMeta(star, payload) {
    const sourceStar = (star && typeof star === 'object') ? star : {};
    const input = (payload && typeof payload === 'object') ? payload : {};
    const planets = Array.isArray(input.planets) ? input.planets : [];
    const bodies = Array.isArray(input.bodies) ? input.bodies : [];
    const freeComets = Array.isArray(input.free_comets) ? input.free_comets : [];
    const roguePlanets = Array.isArray(input.rogue_planets) ? input.rogue_planets : [];
    const starInstallations = Array.isArray(input.star_installations) ? input.star_installations : [];
    const fleets = Array.isArray(input.fleets_in_system) ? input.fleets_in_system : [];
    const generatedPlanets = planets.filter((planet) => !!planet?.generated_planet).length;
    const playerPlanets = planets.filter((planet) => !!planet?.player_planet).length;
    const moonCount = planets.reduce((sum, planet) => {
        const generatedMoons = Array.isArray(planet?.generated_planet?.moons) ? planet.generated_planet.moons.length : 0;
        const playerMoons = Array.isArray(planet?.player_planet?.moons) ? planet.player_planet.moons.length : 0;
      return sum + generatedMoons + playerMoons;
    }, 0);
    return {
      galaxy: Number(input.galaxy || input.star_system?.galaxy_index || sourceStar.galaxy_index || 0),
      system: Number(input.system || input.star_system?.system_index || sourceStar.system_index || 0),
      starName: String(input.star_system?.name || sourceStar.name || sourceStar.catalog_name || ''),
      planets: planets.length,
      generatedPlanets,
      playerPlanets,
      moons: moonCount,
      bodies: bodies.length,
      freeComets: freeComets.length,
      roguePlanets: roguePlanets.length,
      starInstallations: starInstallations.length,
      fleets: fleets.length,
    };
  }

  function traceSystemRender(stage, meta = {}) {
    try {
      if (!(window.GQLog && typeof window.GQLog.traceEnabled === 'function' && window.GQLog.traceEnabled())) {
        return;
      }
      if (typeof window.GQLog.info === 'function') {
        window.GQLog.info(`[system-render] ${stage}`, meta);
      } else {
        console.info('[GQ][system-render]', stage, meta);
      }
    } catch (_) {}
  }

  function logEnterSystemDebug(stage, meta = {}, level = 'info') {
    try {
      const payload = Object.assign({ stage: String(stage || ''), ts: Date.now() }, meta || {});
      const sink = window.GQLog && typeof window.GQLog[level] === 'function'
        ? window.GQLog[level].bind(window.GQLog)
        : null;
      if (sink) {
        sink(`[enter-system] ${stage}`, payload);
      } else {
        const method = (level === 'warn' || level === 'error' || level === 'info') ? level : 'log';
        console[method]('[GQ][enter-system]', stage, payload);
      }
    } catch (_) {}
  }

  class BasicOrbitControls {
    constructor(camera) {
      this.camera = camera;
      this.target = new THREE.Vector3(0, 0, 0);
      this.enableDamping = false;
      this.dampingFactor = 0.08;
      this.minDistance = 40;
      this.maxDistance = 2400;
      this.dragging = false;
    }

    update() {
      const dir = this.camera.position.clone().sub(this.target);
      const dist = dir.length();
      if (dist > this.maxDistance) {
        dir.setLength(this.maxDistance);
        this.camera.position.copy(this.target.clone().add(dir));
      } else if (dist < this.minDistance) {
        dir.setLength(this.minDistance);
        this.camera.position.copy(this.target.clone().add(dir));
      }
      this.camera.lookAt(this.target);
    }

    dispose() {}
  }

  class Galaxy3DRenderer {
    constructor(container, opts = {}) {
      if (!container) throw new Error('Galaxy3DRenderer: missing container');
      const threeRuntime = resolveThreeRuntime(window);
      if (!threeRuntime) throw new Error('Galaxy3DRenderer: THREE runtime invalid (Vector3/Scene missing)');
      if (!ensureThreeMathUtils(window)) {
        throw new Error('Galaxy3DRenderer: THREE.MathUtils unavailable');
      }

      this.container = container;
      window.__GQ_RENDERER_INSTANCE_SEQ = Number(window.__GQ_RENDERER_INSTANCE_SEQ || 0) + 1;
      this.instanceId = `g3d-${window.__GQ_RENDERER_INSTANCE_SEQ}`;
      this.rendererConfig = resolveRendererConfig();
      this.rendererEvents = resolveRendererEvents();
      const optionDefaults = typeof this.rendererConfig.getOptionDefaults === 'function'
        ? this.rendererConfig.getOptionDefaults()
        : {};
      this.opts = Object.assign({}, optionDefaults, opts);
      this.qualityProfile = typeof this.rendererConfig.resolveQualityProfile === 'function'
        ? this.rendererConfig.resolveQualityProfile({ requestedProfile: this.opts.qualityProfile || 'auto' })
        : {
            name: 'medium',
            label: 'Medium',
            reason: 'Fallback: renderer quality config unavailable.',
            renderer: { antialias: true, maxPixelRatio: 2 },
            textures: { planetTextureSize: 256, planetMaxEntries: 128, proceduralMaxEntries: 128 },
            geometry: { vesselMaxEntries: 96, instancingUseThreshold: 4 },
            features: { dynamicClusterLod: true, galacticCoreFx: true, postEffects: false },
            clusterDensityMode: 'auto',
          };
      this.interactive = this.opts.interactive !== false;
      const hasExternalCanvas = typeof HTMLCanvasElement !== 'undefined'
        && this.opts.externalCanvas instanceof HTMLCanvasElement;
      this.externalCanvas = hasExternalCanvas ? this.opts.externalCanvas : null;
      this.ownsRendererCanvas = !this.externalCanvas;
      this.debugEnabled = false;
      this.debugThrottleMs = 420;
      this._debugLastByKey = new Map();
      try {
        const persistedDebug = window.localStorage?.getItem('gq:debug:galaxy3d') === '1';
        this.debugEnabled = !!(this.opts.debug || window.GQ_DEBUG_GALAXY3D || persistedDebug);
      } catch (_) {
        this.debugEnabled = !!(this.opts.debug || window.GQ_DEBUG_GALAXY3D);
      }

      this.scene = new THREE.Scene();
      this.useAlphaCanvas = this.opts.alpha === true;
      this.scene.background = this.useAlphaCanvas ? null : new THREE.Color(0x050a1a);
      this.renderFrames = {
        world: new THREE.Group(),
        galaxy: new THREE.Group(),
        system: new THREE.Group(),
      };
      this.scene.add(this.renderFrames.world);
      this.renderFrames.world.add(this.renderFrames.galaxy);
      this.renderFrames.world.add(this.renderFrames.system);

      const w = Math.max(320, container.clientWidth);
      const h = Math.max(220, container.clientHeight);

      this.camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 5000);
      this.camera.position.set(238, 240, 341);

      const _GQWebGLRenderer = (typeof window !== 'undefined' && window.GQWebGLRenderer) || null;
      const _threeOpts = {
        antialias: this.qualityProfile?.renderer?.antialias !== false,
        alpha: this.useAlphaCanvas,
        canvas: this.externalCanvas || undefined,
      };
      this.rendererBackend = 'three-webgl';
      if (_GQWebGLRenderer) {
        try {
          this.renderer = new _GQWebGLRenderer(Object.assign({}, _threeOpts, { debug: this.debugEnabled }));
          this.rendererBackend = 'engine-webgl';
          emitRenderTelemetry('backend-active', { backend: this.rendererBackend });
        } catch (err) {
          console.warn('[Galaxy3DRenderer] GQWebGLRenderer init failed; falling back to THREE.WebGLRenderer:', err?.message || err);
          emitRenderTelemetry('fallback', {
            from: 'engine-webgl',
            to: 'three-webgl',
            reason: String(err?.message || err || 'engine-webgl-init-failed'),
          });
          this.renderer = new THREE.WebGLRenderer(_threeOpts);
        }
      } else {
        this.renderer = new THREE.WebGLRenderer(_threeOpts);
        emitRenderTelemetry('backend-active', { backend: 'three-webgl' });
      }
      window.__GQ_ACTIVE_RENDERER_BACKEND = this.rendererBackend;
      this.renderer.setPixelRatio(Math.min(
        window.devicePixelRatio || 1,
        Math.max(1, Number(this.qualityProfile?.renderer?.maxPixelRatio || 2))
      ));
      this.renderer.setSize(w, h);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      if (this.useAlphaCanvas && typeof this.renderer.setClearColor === 'function') {
        this.renderer.setClearColor(0x000000, 0);
      }
      this.renderer.domElement.style.pointerEvents = this.interactive ? 'auto' : 'none';
      if (this.ownsRendererCanvas) {
        container.appendChild(this.renderer.domElement);
      } else if (this.renderer.domElement) {
        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.pointerEvents = 'auto';
        canvas.style.zIndex = '2';
      }
      this.textureManager = window.GQTextureManager
        ? new window.GQTextureManager({
            three: THREE,
            planetTextureSize: Number(this.qualityProfile?.textures?.planetTextureSize || 256),
            planetMaxEntries: Number(this.qualityProfile?.textures?.planetMaxEntries || 128),
            proceduralMaxEntries: Number(this.qualityProfile?.textures?.proceduralMaxEntries || 128),
            serverTexturesEnabled: this.opts.serverTexturesEnabled !== false,
            serverTextureEndpoint: String(this.opts.serverTextureEndpoint || 'api/textures.php'),
            serverTextureAlgoVersion: String(this.opts.serverTextureAlgoVersion || 'v1'),
          })
        : null;
      this.geometryManager = window.GQGeometryManager
        ? new window.GQGeometryManager({
            three: THREE,
            vesselMaxEntries: Number(this.qualityProfile?.geometry?.vesselMaxEntries || 96),
            instancingUseThreshold: Number(this.qualityProfile?.geometry?.instancingUseThreshold || 4),
          })
        : null;
      this.materialFactory = window.GQMaterialFactory
        ? new window.GQMaterialFactory({ three: THREE })
        : null;
      this.lightRigManager = window.GQLightRigManager
        ? new window.GQLightRigManager({ three: THREE, scene: this.scene })
        : null;
      this.activeLightRig = 'galaxy';
      this.vesselGeometryCache = new Map();

      const hasOrbitControls = typeof THREE.OrbitControls === 'function';
      this.hasExternalOrbitControls = hasOrbitControls;
      this.controls = hasOrbitControls
        ? new THREE.OrbitControls(this.camera, this.renderer.domElement)
        : new BasicOrbitControls(this.camera);
      if (typeof this.rendererConfig.applyControlTuning === 'function') {
        this.rendererConfig.applyControlTuning(this.controls);
      }
      this.controls.target.set(0, 0, 0);

      // ── Post-Processing Effects ────────────────────────────────────────────
      if (typeof PostEffectsManager !== 'undefined' && this.qualityProfile?.features?.postEffects !== false) {
        this.postEffects = new PostEffectsManager(this.renderer, this.scene, this.camera);
      } else {
        this.postEffects = null;
      }

      this.raycaster = new THREE.Raycaster();
      this.raycaster.params.Points.threshold = 8;
      this.pointer = new THREE.Vector2();
      this.pointerPx = new THREE.Vector2();
      this.prevPointerPx = new THREE.Vector2();
      this.lodProfile = this._detectLodProfile();
      this.dynamicClusterLod = this.qualityProfile?.features?.dynamicClusterLod !== false;
      this.clusterDensityMode = String(this.opts.clusterDensityMode || this.qualityProfile?.clusterDensityMode || 'auto');
      this._lastLodReclusterMs = 0;
      this._appliedClusterTargetPoints = 6500;
      this._lastZoomInputMs = 0;
      this.transitionSelectionMinMs = 220;
      this._selectionTouchedMs = 0;

      this.clock = new THREE.Clock();
      
      // ── Galaxy metadata (from API: galaxy_meta endpoint) ─────────────────────
      // These drive the spiral shader parameters and visualization physics
      this.galaxyMetadata = {
        armCount: 4,
        pitchTangent: 0.249328,        // tan(14°)
        rotationDirectionCcw: 1,       // 1 = counter-clockwise from north pole, 0 = clockwise
        escapeVelocityCenterKms: 8000.0,
        escapeVelocitySunKms: 500.0,
        orbitalVelocityKms: 220.0,
      };
      
      this.stars = [];
      this.visibleStars = [];
      this.visibleToRawIndex = [];
      this.starPoints = null;
      this.selectedIndex = -1;
      this.hoverIndex = -1;
      this.focusTarget = null;
      this.systemMode = false;
      this.systemSourceStar = null;
      this.systemOrigin = new THREE.Vector3(0, 0, 0);
      this.systemPlanetEntries = [];
      this.systemMoonEntries = [];
      this.systemFacilityEntries = [];
      this.systemFleetEntries = [];
      this.systemInstallationWeaponFxEntries = [];
      this.systemInstallationBurstFxEntries = [];
      this.pendingInstallationWeaponFire = [];
      this.beamEffect = null;  // Instanced beam pool (Phase FX-3)
      this.debrisManager = null;  // Debris state machine & registry (Phase FX-5)
      this._warnedMissingDebrisManager = false;
      this.galaxyFleetEntries = [];
      this.systemAtmosphereEntries = [];
      this.systemCloudEntries = [];
      this.clusterAuraEntries = [];
      this.clusterSummaryData = [];
      this.clusterColorPalette = {
        player: '#5de0a0',
        pve: '#ff7b72',
        neutral: '#6a8cc9',
      };
      this.clusterBoundsVisible = true;
      this.clusterHeatmapEnabled = true;
      this.hoverClusterIndex = -1;
      this.selectedClusterIndex = -1;
      this.empireHeartbeatFactionId = null;
      this.empireHeartbeatSystems = new Set();
      this.heartbeatPhase = 0;
      this.systemHoverEntry = null;
      this.systemSelectedEntry = null;
      this.systemHoverObject = null;
      this.systemSelectedObject = null;
      this.galaxyHoverObject = null;
      this.galaxySelectedObject = null;
      this.galaxyFtlEntries = [];
      this.systemRefinementQueue = [];
      this.systemRefinementInProgress = false;
      this.systemRefinementTimeoutId = null;
      this.systemOrbitSimulationBuffer = null;
      this.systemOrbitSimulationStride = 5;
      this._orbitScratchLocal = new THREE.Vector3();
      this._orbitScratchWorld = new THREE.Vector3();
      this.galaxyFleetVectorsVisible = true;
      this.autoTransitionCooldownUntil = 0;
      this.transitionsEnabled = true;
      this.orbitSimulationMode = 'auto';
      this.activeOrbitSimulationMode = 'complex';
      this.activeGpuOrbitVisuals = false;
      this.persistentHoverDistance = 220;
      this._persistentHoverCacheUntil = 0;
      this._persistentHoverIndex = -1;
      this.hoverMagnetEnabled = true;
      this.clickMagnetEnabled = true;
      this.hoverMagnetStarPx = 24;
      this.hoverMagnetPlanetPx = 30;
      this.hoverMagnetClusterPx = 28;
      this._pointerSpeedPxPerMs = 0;
      this._lastPointerEventTs = performance.now();
      try {
        const rawHoverMagnet = window.localStorage?.getItem('gq:hover:magnet');
        if (rawHoverMagnet) {
          const cfg = JSON.parse(rawHoverMagnet);
          if (typeof cfg?.enabled === 'boolean') this.hoverMagnetEnabled = cfg.enabled;
          if (typeof cfg?.clickEnabled === 'boolean') this.clickMagnetEnabled = cfg.clickEnabled;
          if (Number.isFinite(Number(cfg?.starPx))) this.hoverMagnetStarPx = THREE.MathUtils.clamp(Number(cfg.starPx), 8, 64);
          if (Number.isFinite(Number(cfg?.planetPx))) this.hoverMagnetPlanetPx = THREE.MathUtils.clamp(Number(cfg.planetPx), 8, 72);
          if (Number.isFinite(Number(cfg?.clusterPx))) this.hoverMagnetClusterPx = THREE.MathUtils.clamp(Number(cfg.clusterPx), 8, 72);
        }
      } catch (_) {}
      this.transitionStableSpeed = 22;
      this.transitionStableMinMs = 160;
      this._cameraStableSinceMs = performance.now();
      this.cameraMotionSpeed = 0;
      this.systemEntryFov = 50;
      this.minVisualOrbitPeriodSeconds = Math.max(20, Number(this.opts.minVisualOrbitPeriodSeconds || 60));
      this.visualOrbitTimeScale = THREE.MathUtils.clamp(Number(this.opts.visualOrbitTimeScale ?? 1.0), 0.01, 1);
      this.visualPlanetSpinScale = THREE.MathUtils.clamp(Number(this.opts.visualPlanetSpinScale ?? 0.2), 0.03, 1);
      this.visualMoonSpinScale = THREE.MathUtils.clamp(Number(this.opts.visualMoonSpinScale ?? 0.16), 0.03, 1);
      this.useScientificScale = false;
      this.scientificScaleZoomFactor = 0.76; // FOV adjustment when enabling scientific mode
      this._lastZoomOutInputMs = 0;
      this._preSystemFov = Number(this.camera?.fov || 58);
      const runtimeTuning = typeof this.rendererConfig.getRuntimeTuning === 'function'
        ? this.rendererConfig.getRuntimeTuning()
        : {};
      this.zoomThresholds = Object.assign({
        galaxyEnterSystem: 145,
        galaxyResetSystem: 210,
        systemEnterPlanet: 50,
        systemResetPlanet: 86,
        planetExitToSystem: 108,
        planetResetExit: 66,
        systemExitToGalaxy: 330,
        systemResetExit: 230,
      }, runtimeTuning.zoomThresholds || {});
      this.autoTransitionArmed = {
        galaxyEnterSystem: true,
        systemEnterPlanet: true,
        planetExitToSystem: true,
        systemExitToGalaxy: true,
      };
      this.followSelectionEnabled = true;
      this.galacticCoreFxEnabled = this.qualityProfile?.features?.galacticCoreFx !== false;
      this.focusDamping = Object.assign({
        galaxy: 1.65,
        system: 2.1,
        planet: 2.65,
      }, runtimeTuning.focusDamping || {});
      this.destroyed = false;
      this._inputContextOverride = '';
      this.prevCamPos = this.camera.position.clone();
      this.cameraVelocity = new THREE.Vector3();
      this.autoFrameEnabled = true;
      // Kamera-Driver-Verwaltung an GalaxyCameraController delegiert.
      this.cameraCtrl = window.GalaxyCameraController
        ? new window.GalaxyCameraController(this.camera, this.controls)
        : null;
        if (!this.cameraCtrl) {
          const log = window.GQLog || console;
          log.warn('[renderer] GalaxyCameraController nicht geladen — Driver-Funktionalität nicht verfügbar');
        }
        this._kbdMove = { forward: false, back: false, left: false, right: false, up: false, down: false, panL: false, panR: false, panU: false, panD: false };
      this._inputDragState = {
        active: false,
        button: -1,
        mode: '',
        startTarget: null,
        startPosition: null,
        startSpherical: null,
      };

      this._ensureModelRegistryVfxBridge();
      this._registerCombatFxBridge();

      this._setupScene();
      this._bindEvents();
      this._bindCombatEventHooks();
      this._onResize();
      this._debugLog('renderer-init', {
        lodProfile: this.lodProfile,
        qualityProfile: this.qualityProfile?.name || 'medium',
        densityMode: this.clusterDensityMode,
        dynamicClusterLod: this.dynamicClusterLod,
      });
      this._initDebugOverlay();
      this._animate();
      logEnterSystemDebug('renderer-init', {
        instanceId: this.instanceId,
        interactive: !!this.interactive,
        hostId: String(this.container?.id || ''),
        canvasId: String(this.renderer?.domElement?.id || this.externalCanvas?.id || ''),
        backend: String(this.rendererBackend || 'unknown'),
      });

    }

    _initDebugOverlay() {
      this._dbgFrameTimes = [];
      this._dbgLastFrame = performance.now();
      this._dbgOverlayEl = null;
      this._dbgOverlayVisible = !!(window.GQ_DEBUG_OVERLAY || window.GQ_DEBUG_GALAXY3D);

      const existing = document.getElementById('gq-engine-debug-overlay');
      if (existing) {
        this._dbgOverlayEl = existing;
      } else {
        const el = document.createElement('div');
        el.id = 'gq-engine-debug-overlay';
        el.style.cssText = [
          'position:fixed', 'top:50px', 'left:8px', 'z-index:999999',
          'background:rgba(4,14,36,0.88)', 'color:#9fd0ff',
          'font:11px/1.5 Consolas,Menlo,Monaco,monospace',
          'padding:6px 10px', 'border:1px solid rgba(79,151,255,0.35)',
          'border-radius:6px', 'pointer-events:none', 'white-space:pre',
          'display:none',
        ].join(';');
        document.body.appendChild(el);
        this._dbgOverlayEl = el;
      }

      if (this._dbgOverlayVisible && this._dbgOverlayEl) {
        this._dbgOverlayEl.style.display = 'block';
      }

      // Public toggle API: window.GQEngineDebug.toggle(), .show(), .hide()
      window.GQEngineDebug = {
        show: () => {
          this._dbgOverlayVisible = true;
          if (this._dbgOverlayEl) this._dbgOverlayEl.style.display = 'block';
        },
        hide: () => {
          this._dbgOverlayVisible = false;
          if (this._dbgOverlayEl) this._dbgOverlayEl.style.display = 'none';
        },
        toggle: () => {
          if (this._dbgOverlayVisible) { window.GQEngineDebug.hide(); }
          else { window.GQEngineDebug.show(); }
        },
        isVisible: () => this._dbgOverlayVisible,
      };
    }

    _tickDebugOverlay() {
      if (!this._dbgOverlayVisible || !this._dbgOverlayEl || this.destroyed) return;
      const now = performance.now();
      const frameMs = now - this._dbgLastFrame;
      this._dbgLastFrame = now;

      this._dbgFrameTimes.push(frameMs);
      if (this._dbgFrameTimes.length > 60) this._dbgFrameTimes.shift();

      const avgMs = this._dbgFrameTimes.reduce((s, v) => s + v, 0) / this._dbgFrameTimes.length;
      const fps = avgMs > 0 ? (1000 / avgMs).toFixed(1) : '?';

      const info = this.renderer?.info;
      const drawCalls = info?.render?.calls ?? '?';
      const triangles = info?.render?.triangles ?? '?';
      const mem = info?.memory;
      const textures = mem?.textures ?? '?';
      const geometries = mem?.geometries ?? '?';

      const mode = this.systemMode ? 'system' : 'galaxy';
      const stars = this.stars?.length ?? 0;
      const driver = this.cameraCtrl?.hasDriver() ? 'ext' : 'int';
      const camDist = this._cameraDistance ? this._cameraDistance().toFixed(0) : '?';
      const quality = String(this.qualityProfile?.name || 'medium');
      const pxRatio = this.renderer?.getPixelRatio?.() || 1;

      this._dbgOverlayEl.textContent = [
        `[GQ Engine Debug]`,
        `fps:   ${fps.toString().padStart(6)}   frame: ${avgMs.toFixed(1).padStart(6)} ms`,
        `draws: ${String(drawCalls).padStart(6)}   tris:  ${String(triangles).padStart(8)}`,
        `tex:   ${String(textures).padStart(6)}   geo:   ${String(geometries).padStart(6)}`,
        `mode:  ${mode.padEnd(7)}   stars: ${String(stars).padStart(6)}`,
        `cam:   dist=${camDist}  driver=${driver}`,
        `qual:  ${quality.padEnd(7)} px=${Number(pxRatio).toFixed(2)} coreFx=${this.galacticCoreFxEnabled ? 'on' : 'off'}`,
      ].join('\n');
    }

    setCameraDriver(driver, opts = {}) {
      if (this.cameraCtrl) {
        return this.cameraCtrl.setDriver(driver, opts, this);
      }
        const log = window.GQLog || console;
        log.error('[renderer] setCameraDriver: GalaxyCameraController nicht verfügbar');
        return false;
    }

    clearCameraDriver() {
      if (this.cameraCtrl) {
        this.cameraCtrl.clearDriver(this);
        return;
      }
        const log = window.GQLog || console;
        log.error('[renderer] clearCameraDriver: GalaxyCameraController nicht verfügbar');
    }

    hasCameraDriver() {
      return this.cameraCtrl ? this.cameraCtrl.hasDriver() : false;
    }

    getCameraPose() {
      if (this.cameraCtrl) return this.cameraCtrl.getPose();
      return {
        position: this.camera.position.clone(),
        target: this.controls?.target?.clone?.() || new THREE.Vector3(0, 0, 0),
      };
    }

    applyCameraPose(pose = {}, opts = {}) {
      if (this.cameraCtrl) return this.cameraCtrl.applyPose(pose, opts);
        const log = window.GQLog || console;
        log.error('[renderer] applyCameraPose: GalaxyCameraController nicht verfügbar');
        return false;
    }

    _updateCameraDriver(dt, nowMs) {
      if (this.cameraCtrl) return this.cameraCtrl.tick(dt, nowMs, this);
      return false;
    }

    _setupScene() {
      this.setLightRig(this.systemMode ? 'system' : 'galaxy');

      this.clusterAuraGroup = new THREE.Group();
      this.renderFrames.galaxy.add(this.clusterAuraGroup);

      this.systemSkyGroup = new THREE.Group();
      this.systemSkyGroup.visible = false;
      this.renderFrames.system.add(this.systemSkyGroup);

      this.systemBackdrop = new THREE.Group();
      this.systemBackdrop.visible = false;
      this.renderFrames.system.add(this.systemBackdrop);

      this.systemOrbitGroup = new THREE.Group();
      this.systemOrbitGroup.visible = false;
      this.systemOrbitPathsVisible = true;
      this.systemOrbitMarkersVisible = true;
      this.systemOrbitFocusOnly = false;
      this.renderFrames.system.add(this.systemOrbitGroup);

      this.systemBodyGroup = new THREE.Group();
      this.systemBodyGroup.visible = false;
      this.renderFrames.system.add(this.systemBodyGroup);

      this.systemFacilityGroup = new THREE.Group();
      this.systemFacilityGroup.visible = false;
      this.renderFrames.system.add(this.systemFacilityGroup);

      this.systemFleetGroup = new THREE.Group();
      this.systemFleetGroup.visible = false;
      this.renderFrames.system.add(this.systemFleetGroup);

      this.galaxyFleetGroup = new THREE.Group();
      this.galaxyFleetGroup.visible = true;
      this.renderFrames.galaxy.add(this.galaxyFleetGroup);

      // FTL infrastructure overlay (gates = colored lines, nodes = glowing dots)
      this.galaxyFtlGroup = new THREE.Group();
      this.galaxyFtlGroup.visible = true;
      this.renderFrames.galaxy.add(this.galaxyFtlGroup);

      this.systemStarInstallationGroup = new THREE.Group();
      this.systemStarInstallationGroup.visible = false;
      this.renderFrames.system.add(this.systemStarInstallationGroup);

      this.systemInstallationWeaponFxGroup = new THREE.Group();
      this.systemInstallationWeaponFxGroup.visible = false;
      this.renderFrames.system.add(this.systemInstallationWeaponFxGroup);

      this.systemInstallationBurstFxGroup = new THREE.Group();
      this.systemInstallationBurstFxGroup.visible = false;
      this.renderFrames.system.add(this.systemInstallationBurstFxGroup);

      this.systemTrafficGroup = new THREE.Group();
      this.systemTrafficGroup.visible = false;
      this.renderFrames.system.add(this.systemTrafficGroup);

      this._buildGalaxyCoreStars();
      this._buildGalacticCore();
      this._buildGalaxyBackgroundGlow();
      this._buildHoverMarker();
      this._buildSelectionMarker();
    }

    _registerCombatFxBridge() {
      const bridge = window.GQGalaxyEngineBridge;
      if (!bridge || typeof bridge.registerAdapter !== 'function') return;

      const adapter = {
        emitWeaponFire: (payload) => this._queueInstallationWeaponFire(payload),
        emitWeaponFireBatch: (events) => {
          if (!Array.isArray(events)) return 0;
          let accepted = 0;
          events.forEach((payload) => {
            if (this._queueInstallationWeaponFire(payload)) accepted += 1;
          });
          return accepted;
        },
        getRendererInstanceId: () => this.instanceId,
      };

      bridge.registerAdapter('system-combat-fx', adapter);
      bridge.registerAdapter('galaxy-renderer', adapter);
    }

    _bindCombatEventHooks() {
      this._onCombatWeaponFireEvent = (ev) => {
        const payload = ev?.detail ?? ev?.payload ?? null;
        this._queueInstallationWeaponFire(payload);
      };
      window.addEventListener('gq:combat:weapon-fire', this._onCombatWeaponFireEvent);
      window.addEventListener('gq:weapon-fire', this._onCombatWeaponFireEvent);
    }

    _queueInstallationWeaponFire(payload) {
      if (!payload || typeof payload !== 'object') return false;

      const sourcePosition = Number(payload.sourcePosition ?? payload.origin_position ?? payload.position ?? 0);
      const sourceOwner = String(payload.sourceOwner ?? payload.owner ?? '').trim();
      const sourceType = String(payload.sourceType ?? payload.installType ?? payload.type ?? '').trim().toLowerCase();
      const weaponKind = String(payload.weaponKind ?? payload.kind ?? '').trim().toLowerCase();

      if (!sourcePosition && !sourceOwner && !sourceType && !weaponKind) return false;

      this.pendingInstallationWeaponFire.push({
        sourcePosition,
        sourceOwner,
        sourceType,
        weaponKind,
        ts: performance.now(),
      });
      if (this.pendingInstallationWeaponFire.length > 180) {
        this.pendingInstallationWeaponFire.splice(0, this.pendingInstallationWeaponFire.length - 180);
      }
      return true;
    }

    /**
     * Public API: Enqueue a weapon-fire event for installations/entities in this system.
     * 
     * Event fields (all optional):
     * - sourceType: 'installation' | 'ship' | 'debris' | 'wormhole' (null = broadcast all)
     * - sourceOwner: faction/owner name to filter (null = all)
     * - sourcePosition: [reserved] target position index
     * - weaponKind: 'laser' | 'beam' | ... to filter (null = all)
     * - targetPos: [x,y,z] impact point [unused, for future particles]
     * - energy: energy/power display [unused, for future HUD]
     * 
     * @param {object} event - Weapon-fire event payload
     * @returns {boolean} - True if queued, false if invalid
     */
    enqueueInstallationWeaponFire(event) {
      return this._queueInstallationWeaponFire(event);
    }

    _ensureModelRegistryVfxBridge() {
      const registry = window.__GQ_ModelRegistry;
      if (!registry || typeof registry.setVfxBridge !== 'function') return;
      if (registry.__gqRendererVfxBridgeInstalled) return;

      registry.setVfxBridge((instance, payload) => {
        if (!instance?.userData) return;
        const emitters = Array.isArray(payload?.emitters) ? payload.emitters : [];
        const weapons = Array.isArray(payload?.weapons) ? payload.weapons : [];
        instance.userData.gqResolvedVfx = {
          emitters,
          weapons,
          counts: {
            emitters: emitters.length,
            weapons: weapons.length,
          },
        };
      });

      registry.__gqRendererVfxBridgeInstalled = true;
    }

    _syncSystemSkyDome(dt = 0) {
      if (!this.systemMode || !this.systemSkyGroup) return;
      this.systemSkyGroup.position.copy(this.camera.position);
      const distance = this._cameraDistance();
      const profile = this._systemSkyProfile(this.systemSelectedEntry || this.systemHoverEntry || null);
      const scale = THREE.MathUtils.clamp(distance * 4.8, 760, 1850);
      this.systemSkyGroup.scale.setScalar(scale / 1180);
      this.systemSkyGroup.quaternion.slerp(this.camera.quaternion, THREE.MathUtils.clamp(0.05 + dt * 1.8, 0.05, 0.16));
      this.systemSkyGroup.children.forEach((child) => {
        const uniforms = child.material?.uniforms;
        if (uniforms?.uTime) uniforms.uTime.value = this.clock.elapsedTime;
        if (String(child.userData?.kind || '').startsWith('system-sky-nebula') && uniforms) {
          const accentMix = child.userData.kind === 'system-sky-nebula-blue'
            ? 0.38
            : child.userData.kind === 'system-sky-nebula-red'
              ? 0.12
              : 0.18;
          uniforms.uColorA.value.copy(child.userData.colorA).lerp(profile.starColor, 0.10);
          uniforms.uColorB.value.copy(child.userData.colorB).lerp(profile.accent, accentMix);
          uniforms.uOpacity.value = THREE.MathUtils.clamp(
            child.userData.baseOpacity + (profile.cloudOpacity - 0.22) * (child.userData.kind === 'system-sky-nebula-blue' ? 0.45 : 0.28),
            0.04,
            0.24
          );
        }
        const drift = child.userData?.drift;
        if (drift) {
          child.rotation.x += drift.x * Math.max(0.18, distance / 520);
          child.rotation.y += drift.y * Math.max(0.18, distance / 520);
          child.rotation.z += drift.z * Math.max(0.18, distance / 520);
        }
        const align = Number(child.userData?.align || 0);
        if (align > 0) {
          child.quaternion.slerp(this.camera.quaternion, align * 0.05);
        }
      });
    }

    // Galactic center structure: black hole, lensing glow, accretion disk and jets.
    _buildGalacticCore() {
      this.galacticCoreGroup = new THREE.Group();
      this.galacticCoreGroup.frustumCulled = false;
      this.renderFrames.galaxy.add(this.galacticCoreGroup);

            // ── Event horizon (perfect black sphere) ────────────────────────────────
      const bhMesh = new THREE.Mesh(
        new THREE.SphereGeometry(4.2, 28, 28),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
      );
      bhMesh.userData.kind = 'black-hole';
      this.galacticCoreGroup.add(bhMesh);

            // ── Photon sphere / gravitational lensing glow ───────────────────────────
      const lensMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(0xff8822) },
        },
        vertexShader: `
                varying vec3 vNormal;
                void main() {
                  vNormal = normalize(normalMatrix * normal);
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
        fragmentShader: `
                uniform vec3  uColor;
                uniform float uTime;
                varying vec3  vNormal;
                void main() {
                  float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                  rim = pow(rim, 3.2);
                  float flicker = 0.88 + 0.12 * sin(uTime * 1.7 + vNormal.x * 4.2);
                  gl_FragColor = vec4(uColor * flicker, rim * 0.72);
                }`,
      });
      const lensGlow = new THREE.Mesh(new THREE.SphereGeometry(5.6, 22, 22), lensMat);
      lensGlow.userData.kind = 'bh-lens';
      this.galacticCoreGroup.add(lensGlow);

      // ── Accretion disk (animated hot/cool ring) ─────────────────────────────────
      const diskMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uInner: { value: 6.2 },
          uOuter: { value: 26.0 },
          uHotColor: { value: new THREE.Color(1.0, 0.72, 0.28) },
          uCoolColor: { value: new THREE.Color(0.42, 0.70, 1.0) },
        },
        vertexShader: `
                varying vec3 vPos;
                void main() {
                  vPos = position;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
        fragmentShader: `
                uniform float uTime;
                uniform float uInner;
                uniform float uOuter;
                uniform vec3  uHotColor;
                uniform vec3  uCoolColor;
                varying vec3  vPos;

                void main() {
                  vec2  p = vPos.xz;
                  float r = length(p);
                  float ringIn  = smoothstep(uInner, uInner + 2.2, r);
                  float ringOut = 1.0 - smoothstep(uOuter - 3.4, uOuter, r);
                  float ring = ringIn * ringOut;
                  if (ring < 0.001) discard;

                  float ang   = atan(p.y, p.x);
                  float swirl = 0.55 + 0.45 * sin(ang * 18.0 - uTime * 3.3 + r * 0.28);
                  float heat  = exp(-(r - uInner) * 0.16);
                  vec3  col   = mix(uCoolColor, uHotColor, clamp(heat, 0.0, 1.0));
                  float alpha = ring * (0.16 + 0.50 * swirl) * (0.35 + 0.65 * heat);
                  gl_FragColor = vec4(col, alpha);
                }`,
      });
      const accretionDisk = new THREE.Mesh(new THREE.RingGeometry(6.2, 26.0, 96, 1), diskMat);
      accretionDisk.rotation.x = Math.PI / 2;
      accretionDisk.userData.kind = 'bh-accretion-disk';
      this.galacticCoreGroup.add(accretionDisk);

      // ── Hawking flare (core pulse sprite) ───────────────────────────────────────
      const flareCanvas = document.createElement('canvas');
      flareCanvas.width = 128;
      flareCanvas.height = 128;
      const flareCtx = flareCanvas.getContext('2d');
      const flareCenter = flareCanvas.width / 2;
      const flareGrad = flareCtx.createRadialGradient(flareCenter, flareCenter, 0, flareCenter, flareCenter, flareCenter);
      flareGrad.addColorStop(0.0, 'rgba(255,252,228,0.95)');
      flareGrad.addColorStop(0.22, 'rgba(255,206,120,0.72)');
      flareGrad.addColorStop(0.55, 'rgba(255,130,46,0.22)');
      flareGrad.addColorStop(1.0, 'rgba(255,130,46,0.00)');
      flareCtx.fillStyle = flareGrad;
      flareCtx.fillRect(0, 0, flareCanvas.width, flareCanvas.height);
      const flareTexture = new THREE.CanvasTexture(flareCanvas);
      const flareMat = new THREE.SpriteMaterial({
        map: flareTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.66,
      });
      const flareSprite = new THREE.Sprite(flareMat);
      flareSprite.scale.setScalar(26);
      flareSprite.userData.kind = 'hawking-flare';
      flareSprite.userData.baseScale = 26;
      flareSprite.userData.phase = Math.random() * Math.PI * 2;
      this.galacticCoreGroup.add(flareSprite);

      // ── Relativistic jets ─────────────────────────────────────────────────────────
      this._buildJet(1);
      this._buildJet(-1);

            // ── Central point-source label (for information overlay) ─────────────────
      this.galacticCoreGroup.userData.isCoreGroup = true;
    }

    /**
     * Build the galaxy background glow: a large horizontal disk with a
     * 4-arm logarithmic spiral shader (matching the PHP generator)
     * plus multi-layer centre-bulge sprites that simulate the warm overexposure 
     * seen in long-exposure Milky Way photographs.
     * 
     * Uses spiral parameters from this.galaxyMetadata (armCount, pitchTangent,
     * rotationDirectionCcw) to correctly orient the arms and rotation direction.
     */
    _buildGalaxyBackgroundGlow() {
      this.galaxyGlowGroup = new THREE.Group();
      this.galaxyGlowGroup.frustumCulled = false;
      this.renderFrames.galaxy.add(this.galaxyGlowGroup);

      // ── 1. Spiral-disk glow plane ──────────────────────────────────────────
      // A large circle in the XZ plane (rotated -90° on X) whose fragment
      // shader evaluates the logarithmic spiral and bulge functions.
      
      // Get metadata with fallback to defaults
      const meta = this.galaxyMetadata || {};
      const armCount = meta.armCount ?? 4;
      const pitchTangent = meta.pitchTangent ?? 0.249328;  // tan(14°)
      const rotationCcwSign = (meta.rotationDirectionCcw ?? 1) ? 1.0 : -1.0;
      
      const diskGlowMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uArmCount: { value: armCount },
          uPitchTangent: { value: pitchTangent },
          uRotationCcwSign: { value: rotationCcwSign },
        },
        vertexShader: `
          varying vec2 vUV;
          void main() {
            vUV = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uArmCount;
          uniform float uPitchTangent;
          uniform float uRotationCcwSign;
          varying vec2  vUV;
          void main() {
            // Map UV [0,1]^2 → centred [-1,1]^2; r = 0 (centre) … 1 (edge)
            vec2  uv    = vUV * 2.0 - 1.0;
            float r     = length(uv);
            if (r > 1.0) discard;
            float theta = atan(uv.y, uv.x);   // -pi … +pi

            // ── N-arm log spiral with variable pitch and rotation direction ─
            // Phase = N·(θ − ln(r)/b) where b = tan(pitch_angle)
            // rotationCcwSign: +1 for counter-clockwise, -1 for clockwise
            float b        = uPitchTangent;
            float logTerm  = log(max(r, 0.001)) / b;
            // Rotation direction controlled by rotationCcwSign
            float armPhase = uRotationCcwSign * uArmCount * (theta - logTerm);
            float armNear  = pow(max(0.0, 0.5 + 0.5 * cos(armPhase)), 7.0);
            // Arms only visible in the disk region (not bulge, not outer edge)
            float armMask  = smoothstep(0.06, 0.15, r) * smoothstep(0.97, 0.52, r);
            float armGlow  = armNear * armMask;

            // ── Galactic bulge (warm overexposed nucleus) ───────────────────
            float bulgeCore = exp(-r * 9.0);          // tight inner core
            float bulgeWide = exp(-r * 3.0) * 0.48;   // extended warm haze
            float bulge     = bulgeCore + bulgeWide;

            // ── Faint outer disk haze ───────────────────────────────────────
            float diskHaze  = smoothstep(1.0, 0.25, r) * 0.05;

            // ── Colour palette ──────────────────────────────────────────────
            vec3 cBulge = vec3(1.00, 0.72, 0.33);  // warm orange-yellow
            vec3 cArm   = vec3(0.45, 0.66, 1.00);  // blue-white OB stars
            vec3 cDisk  = vec3(0.20, 0.28, 0.58);  // faint interarm blue

            vec3 color  = mix(cDisk, cArm, armGlow * 0.92);
            color       = mix(color, cBulge, clamp(bulge * 1.5, 0.0, 1.0));

            float intensity = bulge * 0.68 + armGlow * (1.0 - bulgeCore) * 0.44 + diskHaze;
            float alpha     = clamp(intensity * 0.50, 0.0, 0.60);
            if (alpha < 0.002) discard;

            gl_FragColor = vec4(color * intensity, alpha);
          }
        `,
      });

      const diskGeo  = new THREE.CircleGeometry(1390.0, 192);
      const diskMesh = new THREE.Mesh(diskGeo, diskGlowMat);
      diskMesh.rotation.x    = -Math.PI / 2;
      diskMesh.renderOrder   = -2;
      diskMesh.userData.kind = 'galaxy-disk-glow';
      diskMesh.frustumCulled = false;
      this.galaxyGlowGroup.add(diskMesh);
      this.galaxyDiskGlow = diskMesh;

      // ── 2. Centre-bulge sprites (multi-layer soft glow) ───────────────────
      // Layered canvas-texture sprites that simulate the warm diffraction glow
      // of the galactic nucleus in long-exposure astrophotography.
      const glowLayers = [
        { sceneRadius: 590, rgb: [255, 228, 142], peakA: 0.09 },  // wide warm halo
        { sceneRadius: 295, rgb: [255, 242, 182], peakA: 0.18 },  // mid glow
        { sceneRadius: 122, rgb: [255, 252, 222], peakA: 0.35 },  // bright core
        { sceneRadius:  38, rgb: [255, 255, 252], peakA: 0.64 },  // stellar nucleus
      ];
      this.galaxyCenterGlowSprites = [];
      glowLayers.forEach((layer) => {
        const sz  = 256;
        const cvs = document.createElement('canvas');
        cvs.width = sz; cvs.height = sz;
        const ctx = cvs.getContext('2d');
        const cx  = sz / 2;
        const [r, g, b] = layer.rgb;
        const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
        grad.addColorStop(0,    `rgba(${r},${g},${b},${layer.peakA.toFixed(3)})`);
        grad.addColorStop(0.30, `rgba(${r},${g},${b},${(layer.peakA * 0.36).toFixed(3)})`);
        grad.addColorStop(0.65, `rgba(${r},${g},${b},${(layer.peakA * 0.07).toFixed(3)})`);
        grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, sz, sz);
        const tex = new THREE.CanvasTexture(cvs);
        const mat = new THREE.SpriteMaterial({
          map: tex, transparent: true,
          depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.setScalar(layer.sceneRadius);
        sprite.renderOrder   = -1;
        sprite.frustumCulled = false;
        sprite.userData.kind = 'galaxy-center-glow';
        this.galaxyGlowGroup.add(sprite);
        this.galaxyCenterGlowSprites.push(sprite);
      });
    }

    /**
     * Build one relativistic jet (direction: ±1 along Y).
     * Particles accelerate outward in a narrow cone, fading with distance.
     * @param {number} dir +1 for north jet, -1 for south jet
     */
    _buildJet(dir) {
      const JET_PARTICLES = 1800;
      const JET_LENGTH = 300;   // max extent in sceneUnits (≈ 300 ly-scale)
      const JET_HALF_ANGLE = 0.11; // cone half-angle in radians (~6.3°)

      const positions = new Float32Array(JET_PARTICLES * 3);
      const colors = new Float32Array(JET_PARTICLES * 3);
      const sizes = new Float32Array(JET_PARTICLES);
      const phases = new Float32Array(JET_PARTICLES);  // offset for animation

      for (let i = 0; i < JET_PARTICLES; i++) {
        // Uniform distribution along jet axis, squared to make inner region denser.
        const t = Math.pow(Math.random(), 0.72);             // 0..1 → biased toward base
        const yt = t * JET_LENGTH;
        // Cone spread widens linearly.
        const spread = yt * JET_HALF_ANGLE;
        const phi = Math.random() * Math.PI * 2;
        const rho = Math.random() * spread;

        const p = i * 3;
        positions[p + 0] = Math.cos(phi) * rho;
        positions[p + 1] = dir * yt;
        positions[p + 2] = Math.sin(phi) * rho;

        // Colour: electric blue-white at base, fading cyan toward tip.
        const heat = 1.0 - t * 0.82;
        colors[p + 0] = heat * 0.50;
        colors[p + 1] = heat * 0.80 + (1.0 - heat) * 0.40;
        colors[p + 2] = 1.0;

        sizes[i] = 1.8 + (1.0 - t) * 2.6;
        phases[i] = Math.random();
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uDir: { value: dir },
          uJetLength: { value: JET_LENGTH },
          uPointScale: { value: this.renderer.getPixelRatio() * 55.0 },
        },
        vertexShader: `
                attribute vec3  aColor;
                attribute float aSize;
                attribute float aPhase;
                varying   vec3  vColor;
                varying   float vAlpha;
                uniform   float uTime;
                uniform   float uDir;
                uniform   float uJetLength;
                uniform   float uPointScale;

                void main() {
                  // Animate particles flowing outward; wrap via fract so they loop.
                  float flow  = fract(aPhase + uTime * 0.055 * uDir);
                  float dist  = flow * uJetLength;
                  vec3  pos   = vec3(position.x, uDir * dist, position.z);

                  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                  float d = max(1.0, -mvPosition.z);
                  gl_PointSize = max(0.8, aSize * uPointScale / d);
                  gl_Position  = projectionMatrix * mvPosition;

                  // Fade out toward tip
                  float fade = 1.0 - flow * 0.88;
                  vColor = aColor * fade;
                  vAlpha = fade * 0.62;
                }`,
        fragmentShader: `
                varying vec3  vColor;
                varying float vAlpha;
                void main() {
                  vec2  uv = gl_PointCoord - vec2(0.5);
                  float r2 = dot(uv, uv);
                  if (r2 > 0.25) discard;
                  float core = smoothstep(0.25, 0.0, r2);
                  gl_FragColor = vec4(vColor, vAlpha * core);
                }`,
      });

      const jet = new THREE.Points(geo, mat);
      jet.frustumCulled = false;
      jet.userData.kind = 'jet';
      jet.userData.jetDir = dir;
      this.galacticCoreGroup.add(jet);
    }

    _buildGalaxyCoreStars() {

      const count = 3200;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const sizes = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const p = i * 3;

        const a = Math.random() * Math.PI * 2;
        const b = Math.acos((Math.random() * 2) - 1);
        const coreWeighted = i < Math.floor(count * 0.82);
        const r = coreWeighted
          ? Math.pow(Math.random(), 2.4) * 44
          : (20 + Math.pow(Math.random(), 1.15) * 68);

        const sx = Math.sin(b) * Math.cos(a);
        const sy = Math.cos(b);
        const sz = Math.sin(b) * Math.sin(a);

        positions[p + 0] = sx * r;
        positions[p + 1] = sy * r * (coreWeighted ? 0.42 : 0.56);
        positions[p + 2] = sz * r;

        const warm = 0.82 + Math.random() * 0.18;
        colors[p + 0] = 1.0;
        colors[p + 1] = 0.76 * warm;
        colors[p + 2] = 0.44 * warm;

        sizes[i] = coreWeighted
          ? (2.7 + Math.random() * 3.7)
          : (1.3 + Math.random() * 2.2);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uPointScale: { value: this.renderer.getPixelRatio() * 64.0 },
        },
        vertexShader: `
          attribute vec3 aColor;
          attribute float aSize;
          varying vec3 vColor;
          varying float vAlpha;
          uniform float uPointScale;
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            float dist = max(1.0, -mvPosition.z);
            gl_PointSize = max(1.4, aSize * uPointScale / dist);
            gl_Position = projectionMatrix * mvPosition;
            vColor = aColor;
            vAlpha = clamp(0.30 + aSize * 0.055, 0.28, 0.74);
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec2  uv   = gl_PointCoord - vec2(0.5);
            float r2   = dot(uv, uv);
            if (r2 > 0.25) discard;
            float r    = sqrt(r2);
            float core = smoothstep(0.24, 0.0, r2);
            // Soft diffraction halo (simulates long-exposure star bloom)
            float halo = exp(-r * 7.5) * 0.32;
            gl_FragColor = vec4(vColor * (0.52 + core * 0.68 + halo * 0.45), vAlpha * (core + halo * 0.42));
          }
        `,
      });

      this.coreStars = new THREE.Points(geo, mat);
      this.coreStars.frustumCulled = false;
      this.renderFrames.galaxy.add(this.coreStars);
    }

    _buildMarkerSprite(options = {}) {
      const size = 96;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const center = size / 2;
      const outerRadius = Number(options.outerRadius || (size * 0.29));
      const innerRadius = Number(options.innerRadius || (size * 0.14));
      const outerStroke = String(options.outerStroke || 'rgba(122, 194, 255, 0.72)');
      const innerStroke = String(options.innerStroke || 'rgba(214, 238, 255, 0.52)');
      const outerWidth = Number(options.outerWidth || 3);
      const innerWidth = Number(options.innerWidth || 1.5);
      ctx.clearRect(0, 0, size, size);

      ctx.beginPath();
      ctx.arc(center, center, outerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = outerStroke;
      ctx.lineWidth = outerWidth;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = innerStroke;
      ctx.lineWidth = innerWidth;
      ctx.stroke();

      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        color: 0xffffff,
      });

      const marker = new THREE.Sprite(material);
      marker.visible = false;
      marker.renderOrder = Number(options.renderOrder || 20);
      return marker;
    }

    _buildHoverMarker() {
      this.hoverMarker = this._buildMarkerSprite({
        outerStroke: 'rgba(122, 194, 255, 0.72)',
        innerStroke: 'rgba(214, 238, 255, 0.52)',
        outerWidth: 3,
        innerWidth: 1.5,
        renderOrder: 20,
      });
      if (!this.hoverMarker) return;
      this.scene.add(this.hoverMarker);
    }

    _buildSelectionMarker() {
      this.selectionMarker = this._buildMarkerSprite({
        outerRadius: 32,
        innerRadius: 10,
        outerStroke: 'rgba(255, 217, 122, 0.88)',
        innerStroke: 'rgba(255, 246, 214, 0.76)',
        outerWidth: 4,
        innerWidth: 2,
        renderOrder: 21,
      });
      if (!this.selectionMarker) return;
      this.scene.add(this.selectionMarker);
    }

    _spectralColorHex(spectralClass) {
      const cls = String(spectralClass || '').toUpperCase();
      const colors = {
        O: 0x9bb0ff,
        B: 0xaabfff,
        A: 0xcad7ff,
        F: 0xf8f7ff,
        G: 0xfff4ea,
        K: 0xffd2a1,
        M: 0xffcc6f,
      };
      return colors[cls] || 0xd8e6ff;
    }

    _clearGroup(group) {
      if (!group) return;
      while (group.children.length) {
        const child = group.children.pop();
        group.remove(child);
        if (child.geometry && !child.geometry.userData?.sharedGeometry) child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => {
            if (!m) return;
            if (!m.userData?.sharedTexture) {
              m.map?.dispose?.();
              m.bumpMap?.dispose?.();
              m.emissiveMap?.dispose?.();
              m.cityMap?.dispose?.();
              m.normalMap?.dispose?.();
              m.alphaMap?.dispose?.();
            }
            m.dispose?.();
          });
        }
        else if (child.material) {
          if (!child.material.userData?.sharedTexture) {
            child.material.map?.dispose?.();
            child.material.bumpMap?.dispose?.();
            child.material.emissiveMap?.dispose?.();
            child.material.cityMap?.dispose?.();
            child.material.normalMap?.dispose?.();
            child.material.alphaMap?.dispose?.();
          }
          child.material.dispose?.();
        }
      }
    }

    _planetTextureDescriptor(payload, slot, body, index) {
      const manifest = payload?.planet_texture_manifest?.planets;
      const position = String(slot?.position || body?.position || (index + 1));
      if (manifest && typeof manifest === 'object' && manifest[position]) {
        return Object.assign({ version: payload?.planet_texture_manifest?.version || 1 }, manifest[position]);
      }
      return null;
    }

    _hashSeed(input) {
      const key = String(input || '0');
      let hash = 2166136261;
      for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    _objectTextureDescriptor(objectType, source, fallbackColor, seedOverride = null, overrides = null) {
      const type = String(objectType || 'generic').toLowerCase();
      const baseColor = new THREE.Color(fallbackColor || 0x9aa7b8);
      const secondary = baseColor.clone().multiplyScalar(0.74);
      const accent = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.24);
      const ice = baseColor.clone().lerp(new THREE.Color(0xdfeeff), 0.55);
      const baseKey = `${type}:${source?.id || source?.name || source?.slug || source?.type || source?.position || source?.index || ''}`;
      const seed = Number.isFinite(seedOverride)
        ? (seedOverride >>> 0)
        : this._hashSeed(baseKey || JSON.stringify(source || {}));

      const defaults = {
        version: 1,
        seed,
        variant: type === 'star' || type === 'sun' ? 'lava' : 'rocky',
        palette: {
          base: `#${baseColor.getHexString()}`,
          secondary: `#${secondary.getHexString()}`,
          accent: `#${accent.getHexString()}`,
          ice: `#${ice.getHexString()}`,
        },
        banding: type === 'star' || type === 'sun' ? 0.32 : 0.12,
        clouds: type === 'moon' || type === 'ship' || type === 'fleet' || type === 'building' ? 0 : 0.08,
        craters: type === 'moon' ? 0.24 : 0.08,
        ice_caps: type === 'moon' ? 0.08 : 0,
        glow: type === 'star' || type === 'sun' ? 0.82 : 0.14,
        roughness: type === 'ship' || type === 'fleet' || type === 'building' ? 0.42 : 0.78,
        metalness: type === 'ship' || type === 'fleet' || type === 'building' ? 0.56 : 0.08,
      };
      return Object.assign(defaults, overrides || {});
    }

    _objectTextureBundle(objectType, descriptor, fallbackColor) {
      if (!this.textureManager || !descriptor) return null;
      return this.textureManager.getObjectTextureBundle(objectType, descriptor, fallbackColor);
    }

    _planetMaterial(payload, slot, body, index) {
      const fallbackColor = this._planetColor(body?.planet_class);
      const descriptor = this._planetTextureDescriptor(payload, slot, body, index);
      if (!this.textureManager || !descriptor) {
        if (this.materialFactory) {
          return this.materialFactory.createPlanetFallbackMaterial(fallbackColor);
        }
        return new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.82, metalness: 0.04 });
      }
      return this.textureManager.getPlanetMaterial(body, descriptor, fallbackColor);
    }

    _planetAtmosphereShell(payload, slot, body, index, radius) {
      const descriptor = this._planetTextureDescriptor(payload, slot, body, index);
      if (!this.textureManager || !descriptor) return null;
      const config = this.textureManager.getAtmosphereConfig(descriptor);
      if (!config) return null;

      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(radius * config.scale, 18, 18),
        new THREE.MeshBasicMaterial({
          color: config.color,
          transparent: true,
          opacity: config.opacity,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          depthWrite: false,
        })
      );
      shell.userData = { kind: 'planet-atmosphere' };
      return shell;
    }

    _planetCloudShell(payload, slot, body, index, radius) {
      const descriptor = this._planetTextureDescriptor(payload, slot, body, index);
      if (!this.textureManager || !descriptor) return null;
      const config = this.textureManager.getCloudLayerConfig(descriptor, this._planetColor(body?.planet_class));
      if (!config) return null;

      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(radius * config.scale, 18, 18),
        new THREE.MeshStandardMaterial({
          color: config.color,
          alphaMap: config.alphaMap,
          transparent: true,
          opacity: config.opacity,
          roughness: 0.94,
          metalness: 0,
          depthWrite: false,
        })
      );
      shell.userData = {
        kind: 'planet-clouds',
        baseOpacity: config.opacity,
        rotationSpeed: config.rotationSpeed,
      };
      return shell;
    }

    _buildRingAlphaMap(seed = 0) {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const center = size / 2;
      const maxR = center - 2;
      const rand = (n) => {
        const x = Math.sin((seed + n * 13.137) * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };

      ctx.clearRect(0, 0, size, size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = x - center;
          const dy = y - center;
          const r = Math.sqrt(dx * dx + dy * dy) / maxR;
          const band = 0.52 + 0.48 * Math.sin((r * 160.0) + rand(r * 31.0) * 3.0);
          const noise = 0.72 + rand((x + y) * 0.17) * 0.28;
          const alpha = Math.max(0, Math.min(1, band * noise));
          const a = Math.floor(alpha * 255);
          ctx.fillStyle = `rgba(255,255,255,${a / 255})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipMapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    }

    _planetRingMesh(body, planetRadius, index = 0) {
      const ring = body?.ring_system || body?.rings || null;
      if (!ring || typeof ring !== 'object') return null;

      const innerFactor = THREE.MathUtils.clamp(Number(ring.inner_radius_planet_r || 1.6), 1.1, 6.5);
      const outerFactor = THREE.MathUtils.clamp(Number(ring.outer_radius_planet_r || (innerFactor + 0.9)), innerFactor + 0.15, 8.5);
      const opticalDepth = THREE.MathUtils.clamp(Number(ring.optical_depth || 0.35), 0.08, 0.95);
      const tiltDeg = Number(ring.tilt_deg || 0);

      const composition = String(ring.composition || 'mixed_ice_dust').toLowerCase();
      const ringColor = composition.includes('water_ice')
        ? 0xd5e7ff
        : composition.includes('silicate')
          ? 0xc7b28b
          : 0xd9d2bf;
      const alphaMap = this._buildRingAlphaMap((index + 1) * 97);

      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(planetRadius * innerFactor, planetRadius * outerFactor, 96),
        new THREE.MeshStandardMaterial({
          color: ringColor,
          alphaMap,
          transparent: true,
          opacity: THREE.MathUtils.clamp(0.18 + opticalDepth * 0.42, 0.18, 0.7),
          roughness: 0.92,
          metalness: 0.01,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );

      mesh.rotation.x = Math.PI / 2 + THREE.MathUtils.degToRad(tiltDeg);
      mesh.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.06;
      mesh.userData = {
        kind: 'planet-ring',
        rotationSpeed: 0.012 + index * 0.0018,
        precessionSpeed: 0.0012 + index * 0.0002,
      };
      return mesh;
    }

    _buildStarAtmosphereShells(colorHex, radius) {
      const shells = [];
      const outerShell = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.18, 28, 28),
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          depthWrite: false,
        })
      );
      outerShell.userData = {
        kind: 'star-atmosphere',
        baseOpacity: 0.22,
        pulseAmplitude: 0.08,
        pulseSpeed: 1.45,
        scaleAmplitude: 0.028,
        phase: 0.4,
      };
      shells.push(outerShell);

      const coronaShell = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.36, 24, 24),
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.10,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          depthWrite: false,
        })
      );
      coronaShell.userData = {
        kind: 'star-atmosphere',
        baseOpacity: 0.10,
        pulseAmplitude: 0.05,
        pulseSpeed: 0.95,
        scaleAmplitude: 0.045,
        phase: 1.2,
      };
      shells.push(coronaShell);
      return shells;
    }

    _buildStarCoronaShader(colorHex, radius) {
      const uniforms = {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(colorHex) },
        uOpacity: { value: 0.22 },
      };
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms,
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vWorldPos;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec3 vNormal;
          varying vec3 vWorldPos;
          float hash(vec3 p) {
            return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
          }
          void main() {
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float rim = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.8);
            float flicker = 0.55 + 0.45 * sin(uTime * 2.3 + vWorldPos.y * 0.06 + hash(vWorldPos) * 6.2831);
            float band = 0.55 + 0.45 * sin(uTime * 1.3 + vWorldPos.x * 0.03 + vWorldPos.z * 0.04);
            float alpha = rim * (0.45 + flicker * 0.35 + band * 0.2) * uOpacity;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.52, 28, 28), material);
      mesh.userData = {
        kind: 'star-corona',
        baseOpacity: 0.22,
        pulseAmplitude: 0.07,
        pulseSpeed: 1.2,
        scaleAmplitude: 0.035,
        phase: 0.8,
      };
      return mesh;
    }

    _registerAnimatedAtmosphere(mesh, opts = {}) {
      if (!mesh) return null;
      const uniforms = mesh.material?.uniforms || null;
      const entry = {
        mesh,
        baseScale: mesh.scale.clone(),
        baseOpacity: Number(opts.baseOpacity ?? mesh.material?.opacity ?? 0.1),
        pulseAmplitude: Number(opts.pulseAmplitude ?? 0.04),
        pulseSpeed: Number(opts.pulseSpeed ?? 1),
        scaleAmplitude: Number(opts.scaleAmplitude ?? 0.02),
        phase: Number(opts.phase ?? 0),
        uniforms,
      };
      this.systemAtmosphereEntries.push(entry);
      return entry;
    }

    _registerAnimatedCloud(mesh, opts = {}) {
      if (!mesh) return null;
      const entry = {
        mesh,
        baseOpacity: Number(opts.baseOpacity ?? mesh.material?.opacity ?? 0.18),
        rotationSpeed: Number(opts.rotationSpeed ?? 0.06),
        phase: Number(opts.phase ?? 0),
      };
      this.systemCloudEntries.push(entry);
      return entry;
    }

    _planetColor(planetClass) {
      const cls = String(planetClass || '').toLowerCase();
      if (cls.includes('gas')) return 0xd6a56f;
      if (cls.includes('ice giant')) return 0x7fc7d9;
      if (cls.includes('ice') || cls.includes('frozen')) return 0x9bc7e8;
      if (cls.includes('lava') || cls.includes('volcan')) return 0xd86d46;
      if (cls.includes('desert')) return 0xc9ad6a;
      if (cls.includes('ocean')) return 0x4aa0d8;
      if (cls.includes('toxic')) return 0x8db255;
      if (cls.includes('barren') || cls.includes('rocky')) return 0x8f8173;
      if (cls.includes('terra') || cls.includes('hab')) return 0x6ebf72;
      return 0x9aa7b8;
    }

    _systemSkyProfile(activeEntry = null) {
      const starColor = new THREE.Color(this._spectralColorHex(this.systemSourceStar?.spectral_class));
      const body = activeEntry?.body || null;
      const cls = String(body?.planet_class || '').toLowerCase();
      const atmosphere = Number(body?.surface_pressure_bar || 0);
      const waterState = String(body?.water_state || '').toLowerCase();
      let accent = starColor.clone().lerp(new THREE.Color(0x8bb8ff), 0.42);
      let cloudBoost = 0.18;
      let plasmaBoost = 0.12;
      let starBoost = 1.0;

      if (cls.includes('lava') || cls.includes('volcan')) {
        accent = new THREE.Color(0xff784b);
        plasmaBoost = 0.28;
        cloudBoost = 0.08;
        starBoost = 1.08;
      } else if (cls.includes('ocean') || waterState === 'liquid') {
        accent = new THREE.Color(0x78d6ff);
        cloudBoost = 0.24;
      } else if (cls.includes('ice') || cls.includes('frozen')) {
        accent = new THREE.Color(0xc9ecff);
        cloudBoost = 0.20;
        plasmaBoost = 0.06;
      } else if (cls.includes('gas')) {
        accent = new THREE.Color(0xffd59a);
        cloudBoost = 0.30;
        plasmaBoost = 0.08;
        starBoost = 1.06;
      } else if (cls.includes('desert')) {
        accent = new THREE.Color(0xf2bf72);
        plasmaBoost = 0.16;
      } else if (cls.includes('toxic')) {
        accent = new THREE.Color(0x9fda72);
        cloudBoost = 0.22;
        plasmaBoost = 0.18;
      } else if (cls.includes('terra') || cls.includes('hab')) {
        accent = new THREE.Color(0x87d99d);
        cloudBoost = 0.20;
      }

      const focusStrength = activeEntry ? (this.systemSelectedEntry ? 1 : 0.55) : 0;
      const atmoBoost = THREE.MathUtils.clamp(atmosphere / 8, 0, 0.18);
      const zoomDistance = this._cameraDistance();
      const zoomT = THREE.MathUtils.clamp((260 - zoomDistance) / 180, 0, 1);

      return {
        starColor,
        accent,
        plasmaOpacity: 0.26 + plasmaBoost + focusStrength * 0.08 + zoomT * 0.06,
        cloudOpacity: 0.12 + cloudBoost + atmoBoost + focusStrength * 0.05,
        starBrightness: starBoost + focusStrength * 0.16 + zoomT * 0.08,
      };
    }

    _planetSize(body, fallbackIndex, orbitRadius = 0) {
      const diameter = Number(body?.diameter || 0);
      const cls = String(body?.planet_class || '').toLowerCase();
      let baseSize = 0;
      if (diameter > 0) {
        const scale = cls.includes('gas') ? 9500 : 14500;
        const min = cls.includes('gas') ? 3.0 : 1.8;
        const max = cls.includes('gas') ? 8.8 : 5.8;
        baseSize = THREE.MathUtils.clamp(min + diameter / scale, min, max);
      } else {
        if (cls.includes('gas')) baseSize = 5.9 + (fallbackIndex % 3) * 0.65;
        else if (cls.includes('ice')) baseSize = 3.1 + (fallbackIndex % 2) * 0.38;
        else baseSize = 2.1 + (fallbackIndex % 4) * 0.42;
      }
      // Scientific scaling: Scale planet size proportionally to orbital distance
      if (this.useScientificScale && orbitRadius > 0) {
        const referenceOrbit = 50; // Base orbit where game-scale applies
        const orbitFactor = Math.max(0.55, Math.min(1.25, orbitRadius / referenceOrbit));
        baseSize *= orbitFactor;
      }
      return baseSize;
    }

    _facilityColor(category) {
      const key = String(category || '').toLowerCase();
      if (key.includes('defense')) return 0xff8f70;
      if (key.includes('energy')) return 0x8fd9ff;
      if (key.includes('industry')) return 0xd5b06c;
      return 0xa6c3ff;
    }

    _fleetColor(mission) {
      const key = String(mission || '').toLowerCase();
      if (key === 'attack') return 0xff7a66;
      if (key === 'spy') return 0x7fd0ff;
      if (key === 'transport') return 0xb7d98c;
      if (key === 'colonize') return 0x8fe7b4;
      return 0xd9d4a8;
    }

    _fleetDirectionColor(mission) {
      const key = String(mission || '').toLowerCase();
      if (key === 'attack') return 0xff4d3d;
      if (key === 'spy') return 0x41d1ff;
      if (key === 'transport') return 0x86ff66;
      if (key === 'colonize') return 0x5cf2a5;
      if (key === 'harvest') return 0xffd15c;
      return 0xd9d4a8;
    }

    _clusterAuraColor(cluster) {
      const parseHexColor = (input, fallback) => {
        const text = String(input || '').trim();
        if (!text) return fallback;
        const clean = text.startsWith('#') ? text.slice(1) : text;
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
        const value = Number.parseInt(clean, 16);
        return Number.isFinite(value) ? value : fallback;
      };
      const palette = this.clusterColorPalette || {};
      const neutralColor = parseHexColor(palette.neutral, 0x6a8cc9);
      const playerColor = parseHexColor(palette.player, neutralColor);
      const pveColor = parseHexColor(palette.pve, 0xff7b72);
      const faction = cluster?.faction || null;
      const isPlayerFaction = !!(faction && (
        faction.__isPlayer
        || faction.is_player
        || faction.isPlayer
        || faction.player_controlled
        || faction.controlled_by_player
        || String(faction.role || '').toLowerCase() === 'player'
      ));

      if (isPlayerFaction) {
        return parseHexColor(faction?.color, playerColor);
      }
      if (faction) {
        return pveColor;
      }
      return neutralColor;
    }

    _toHexColor(colorValue, fallback = '#6a8cc9') {
      const n = Number(colorValue);
      if (!Number.isFinite(n)) return fallback;
      return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
    }

    _sanitizeHexColor(colorValue) {
      const text = String(colorValue || '').trim();
      if (!text) return '';
      const clean = text.startsWith('#') ? text.slice(1) : text;
      if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '';
      return `#${clean.toLowerCase()}`;
    }

    _hexColorToRgb01(colorValue, fallback = [0.62, 0.75, 1.0]) {
      const hex = this._sanitizeHexColor(colorValue);
      if (!hex) return fallback.slice();
      const value = Number.parseInt(hex.slice(1), 16);
      if (!Number.isFinite(value)) return fallback.slice();
      return [
        ((value >> 16) & 0xff) / 255,
        ((value >> 8) & 0xff) / 255,
        (value & 0xff) / 255,
      ];
    }

    _clusterGroupHeat(entry) {
      if (!entry || typeof entry !== 'object') return 0;
      const systems = Array.isArray(entry.systems)
        ? entry.systems.map((n) => Number(n || 0)).filter((n) => Number.isFinite(n) && n > 0)
        : [];
      let systemHeat = 0;
      if (systems.length && this.empireHeartbeatSystems instanceof Set && this.empireHeartbeatSystems.size) {
        let hits = 0;
        for (let i = 0; i < systems.length; i++) {
          if (this.empireHeartbeatSystems.has(systems[i])) hits += 1;
        }
        systemHeat = hits > 0 ? (hits / systems.length) : 0;
      }

      const clusterFactionId = Number(entry?.cluster?.faction?.id || entry?.cluster?.faction?.faction_id || 0);
      const heartbeatFactionId = Number(this.empireHeartbeatFactionId || 0);
      const factionHeat = (heartbeatFactionId > 0 && clusterFactionId > 0 && heartbeatFactionId === clusterFactionId) ? 1 : 0;
      return THREE.MathUtils.clamp(Math.max(systemHeat, factionHeat), 0, 1);
    }

    _starEventSeverity(star) {
      const row = (star && typeof star === 'object') ? star : {};
      const threatRaw = Number(
        row.event_severity
        ?? row.threat_level
        ?? row.alert_level
        ?? row.threat
        ?? 0
      );
      let threatScore = 0;
      if (Number.isFinite(threatRaw) && threatRaw > 0) {
        if (threatRaw <= 1) threatScore = threatRaw;
        else if (threatRaw <= 5) threatScore = threatRaw / 5;
        else if (threatRaw <= 10) threatScore = threatRaw / 10;
        else threatScore = threatRaw / 100;
      }
      const activeEvents = Array.isArray(row.active_events) ? row.active_events.length : 0;
      const eventCount =
        Number(row.event_count || 0)
        + Number(row.events_count || 0)
        + Number(row.situations_count || 0)
        + Number(row.alert_count || 0)
        + Number(row.anomaly_count || 0)
        + activeEvents;
      const eventScore = eventCount > 0
        ? THREE.MathUtils.clamp(Math.log2(eventCount + 1) / 4.8, 0, 1)
        : 0;
      const criticalSignals = [
        row.under_attack,
        row.combat_active,
        row.emergency,
        row.anomaly_active,
      ].filter(Boolean).length;
      const criticalBoost = THREE.MathUtils.clamp(criticalSignals * 0.18, 0, 0.42);
      return THREE.MathUtils.clamp(Math.max(threatScore, eventScore) + criticalBoost, 0, 1);
    }

    setClusterColorPalette(palette = {}) {
      this.clusterColorPalette = Object.assign({}, this.clusterColorPalette || {}, palette || {});
      if (Array.isArray(this.clusterSummaryData) && this.clusterSummaryData.length) {
        this._rebuildClusterAuras();
        this.setClusterBoundsVisible(this.clusterBoundsVisible);
      }
      return Object.assign({}, this.clusterColorPalette);
    }

    setClusterAuras(clusters) {
      this.clusterSummaryData = Array.isArray(clusters) ? clusters.slice() : [];
      this._rebuildClusterAuras();
      this.setClusterBoundsVisible(this.clusterBoundsVisible);
      this._applyEmpireHeartbeatMask();
    }

    setEmpireHeartbeatFaction(factionId) {
      const next = Number(factionId || 0);
      this.empireHeartbeatFactionId = next > 0 ? next : null;
      this._applyEmpireHeartbeatMask();
    }

    setEmpireHeartbeatSystems(systems = []) {
      this.empireHeartbeatFactionId = null;
      this.empireHeartbeatSystems = new Set(
        (Array.isArray(systems) ? systems : [])
          .map((n) => Number(n || 0))
          .filter((n) => Number.isFinite(n) && n > 0)
      );

      const attr = this.starPoints?.geometry?.getAttribute('aEmpire');
      const proximityAttr = this.starPoints?.geometry?.getAttribute('aProximityFactor');
      
      if (attr && Array.isArray(this.visibleStars)) {
        // Get camera position in world space (camera is at scaled/positioned location)
        const camPos = this.camera?.position || new THREE.Vector3(0, 0, 100);
        const scale = 0.028; // Same scale as in setStars()
        
        for (let i = 0; i < attr.count; i++) {
          const systemIndex = Number(this.visibleStars[i]?.system_index || 0);
          const isEmpire = this.empireHeartbeatSystems.has(systemIndex) ? 1 : 0;
          attr.setX(i, isEmpire);
          
          // Calculate proximity factor for this star if it's an empire system
          if (proximityAttr && isEmpire) {
            const star = this.visibleStars[i];
            const starWorldPos = new THREE.Vector3(
              (Number(star.x_ly) || 0) * scale,
              (Number(star.z_ly) || 0) * scale * 0.42,
              (Number(star.y_ly) || 0) * scale
            );
            const distToCam = camPos.distanceTo(starWorldPos);
            // Normalize distance: 0 = very close (max intensity), 1 = far (min intensity)
            // Range: 0-250 units maps to 1-0 proximity factor
            const proximityRange = 250;
            const proximityFactor = Math.max(0, 1 - distToCam / proximityRange);
            proximityAttr.setX(i, proximityFactor);
          } else if (proximityAttr) {
            proximityAttr.setX(i, 0);
          }
        }
        attr.needsUpdate = true;
        if (proximityAttr) proximityAttr.needsUpdate = true;
      }
      
      if (this.starPoints?.material?.uniforms?.uHeartbeatStrength) {
        this.starPoints.material.uniforms.uHeartbeatStrength.value = this.empireHeartbeatSystems.size ? 1 : 0;
      }
      
      // Update camera position uniform for shader access
      if (this.starPoints?.material?.uniforms?.uCameraPos && this.camera?.position) {
        this.starPoints.material.uniforms.uCameraPos.value.copy(this.camera.position);
      }
    }

    _updateHeartbeatProximity() {
      const proximityAttr = this.starPoints?.geometry?.getAttribute('aProximityFactor');
      if (!proximityAttr || !Array.isArray(this.visibleStars) || this.empireHeartbeatSystems.size === 0) {
        return;
      }

      const camPos = this.camera?.position || new THREE.Vector3(0, 0, 100);
      const scale = 0.028;
      let hasChanges = false;

      for (let i = 0; i < proximityAttr.count; i++) {
        const systemIndex = Number(this.visibleStars[i]?.system_index || 0);
        if (!this.empireHeartbeatSystems.has(systemIndex)) {
          proximityAttr.setX(i, 0);
          continue;
        }

        const star = this.visibleStars[i];
        const starWorldPos = new THREE.Vector3(
          (Number(star.x_ly) || 0) * scale,
          (Number(star.z_ly) || 0) * scale * 0.42,
          (Number(star.y_ly) || 0) * scale
        );
        const distToCam = camPos.distanceTo(starWorldPos);
        const proximityRange = this.starPoints.material.uniforms.uProximityRange?.value || 250;
        const proximityFactor = Math.max(0, 1 - distToCam / proximityRange);
        
        const oldValue = proximityAttr.getX(i);
        if (Math.abs(oldValue - proximityFactor) > 0.01) {
          proximityAttr.setX(i, proximityFactor);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        proximityAttr.needsUpdate = true;
      }

      // Update camera position uniform
      if (this.starPoints?.material?.uniforms?.uCameraPos && this.camera?.position) {
        this.starPoints.material.uniforms.uCameraPos.value.copy(this.camera.position);
      }
    }

    _applyEmpireHeartbeatMask() {
      this.empireHeartbeatSystems = new Set();
      const factionId = Number(this.empireHeartbeatFactionId || 0);
      if (!factionId || !Array.isArray(this.clusterSummaryData)) {
        const attr = this.starPoints?.geometry?.getAttribute('aEmpire');
        if (attr) {
          for (let i = 0; i < attr.count; i++) attr.setX(i, 0);
          attr.needsUpdate = true;
        }
        if (this.starPoints?.material?.uniforms?.uHeartbeatStrength) {
          this.starPoints.material.uniforms.uHeartbeatStrength.value = 0;
        }
        return;
      }

      this.clusterSummaryData.forEach((cluster) => {
        if (Number(cluster?.faction?.id || 0) !== factionId) return;
        const systems = Array.isArray(cluster?.systems)
          ? cluster.systems.map((n) => Number(n || 0)).filter((n) => Number.isFinite(n) && n > 0)
          : [];
        if (systems.length) {
          systems.forEach((systemIndex) => this.empireHeartbeatSystems.add(systemIndex));
          return;
        }
        const from = Math.max(1, Number(cluster?.from || 0));
        const to = Math.max(from, Number(cluster?.to || from));
        for (let systemIndex = from; systemIndex <= to; systemIndex++) {
          this.empireHeartbeatSystems.add(systemIndex);
        }
      });

      const attr = this.starPoints?.geometry?.getAttribute('aEmpire');
      if (attr && Array.isArray(this.visibleStars)) {
        for (let i = 0; i < attr.count; i++) {
          const systemIndex = Number(this.visibleStars[i]?.system_index || 0);
          attr.setX(i, this.empireHeartbeatSystems.has(systemIndex) ? 1 : 0);
        }
        attr.needsUpdate = true;
      }
      if (this.starPoints?.material?.uniforms?.uHeartbeatStrength) {
        this.starPoints.material.uniforms.uHeartbeatStrength.value = this.empireHeartbeatSystems.size ? 1 : 0;
      }
    }

    _syncClusterAuraTransform() {
      if (!this.clusterAuraGroup) return;
      if (!this.starPoints) {
        this.clusterAuraGroup.visible = false;
        return;
      }
      // Both clusterAuraGroup and starPoints are siblings under renderFrames.galaxy;
      // their local transforms are already in the same coordinate space.
      this.clusterAuraGroup.visible = !!this.starPoints.visible;
    }

    _annotateSelectionPayload(payload, meta = {}) {
      if (!payload || typeof payload !== 'object') return null;
      const kind = String(meta.kind || payload.__kind || 'star');
      const scope = String(meta.scope || payload.__selectionScope || (this.systemMode ? 'system' : 'galaxy'));
      const mode = String(meta.mode || payload.__selectionMode || (this.systemMode ? 'system' : 'galaxy'));
      const sourceView = String(meta.sourceView || payload.__selectionSourceView || 'renderer');
      let selectionKey = String(meta.selectionKey || payload.__selectionKey || '').trim();
      if (!selectionKey) {
        if (kind === 'cluster') {
          selectionKey = `cluster:${Number(payload.__clusterIndex || -1)}`;
        } else if (kind === 'planet') {
          selectionKey = `planet:${Number(payload.__sourceStar?.galaxy_index || payload.galaxy_index || 0)}:${Number(payload.__sourceStar?.system_index || payload.system || 0)}:${Number(payload.id || payload.planet_id || payload.__slot?.position || payload.position || 0)}`;
        } else if (kind === 'system_fleet' || kind === 'galaxy_fleet') {
          selectionKey = `${kind}:${Number(payload.id || payload.fleet_id || 0)}`;
        } else if (kind === 'orbital_facility') {
          selectionKey = `orbital_facility:${Number(payload.__slot?.player_planet?.colony_id || payload.colony_id || 0)}:${Number(payload.__slot?.position || 0)}`;
        } else if (kind === 'star_installation') {
          selectionKey = `star_installation:${Number(payload.id || payload.installation_id || 0)}`;
        } else if (kind === 'system_traffic') {
          selectionKey = `system_traffic:${Number(payload.orbitRadius || 0)}:${Number(payload.orbitSpeed || 0)}`;
        } else if (kind === 'ftl_node') {
          selectionKey = `ftl_node:${Number(payload.id || payload.node_id || 0)}`;
        } else if (kind === 'ftl_gate') {
          selectionKey = `ftl_gate:${Number(payload.id || payload.gate_id || 0)}:${String(payload.__endpoint || '')}`;
        } else {
          selectionKey = `star:${Number(payload.galaxy_index || 0)}:${Number(payload.system_index || 0)}`;
        }
      }
      return Object.assign({}, payload, {
        __kind: kind,
        __selectionKey: selectionKey,
        __selectionScope: scope,
        __selectionMode: mode,
        __selectionSourceView: sourceView,
      });
    }

    _starPayload(star) {
      return this._annotateSelectionPayload(star || null, {
        kind: 'star',
        scope: 'galaxy',
        mode: 'galaxy',
      });
    }

    _clusterPayload(entry, index) {
      if (!entry) return null;
      const cluster = entry.cluster || {};
      const resolvedColor = this._clusterAuraColor(cluster);
      return this._annotateSelectionPayload(Object.assign({}, cluster, {
        __kind: 'cluster',
        __clusterIndex: index,
        __clusterColor: this._toHexColor(resolvedColor, '#6a8cc9'),
        __clusterCenter: {
          x: Number(entry.center?.x || 0),
          y: Number(entry.center?.y || 0),
          z: Number(entry.center?.z || 0),
        },
        __clusterSize: {
          x: Number(entry.size?.x || 0),
          y: Number(entry.size?.y || 0),
          z: Number(entry.size?.z || 0),
        },
        __clusterSystems: Array.isArray(entry.systems) ? entry.systems.slice() : [],
        __clusterBoundsVisible: !!this.clusterBoundsVisible,
      }), {
        kind: 'cluster',
        scope: 'cluster',
        mode: 'galaxy',
        selectionKey: `cluster:${Number(index || -1)}`,
      });
    }

    _clusterWorldScreenPosition(entry) {
      if (!entry?.group) return null;
      return this.getWorldScreenPosition(entry.group.getWorldPosition(new THREE.Vector3()));
    }

    _pickClusterBox() {
      if (this.systemMode || !this.clusterBoundsVisible || !Array.isArray(this.clusterAuraEntries) || !this.clusterAuraEntries.length) return -1;
      const targets = this.clusterAuraEntries
        .flatMap((entry) => Array.isArray(entry?.wireMeshes)
          ? entry.wireMeshes
          : (entry?.wireMesh ? [entry.wireMesh] : []))
        .filter(Boolean);
      if (!targets.length) return -1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      // Edge-only picking: raise Line threshold so only the wireframe edges register hits
      const prevLineThreshold = this.raycaster.params.Line?.threshold ?? 1;
      if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = 2.4;
      const hits = this.raycaster.intersectObjects(targets, false);
      if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = prevLineThreshold;
      if (hits.length) {
        let best = -1;
        let bestD2 = Number.POSITIVE_INFINITY;
        for (const hit of hits.slice(0, 16)) {
          const hitObject = hit.object;
          let idx = Number(hitObject?.userData?.clusterIndex);
          if (!Number.isFinite(idx) || idx < 0) {
            idx = this.clusterAuraEntries.findIndex((entry) => {
              if (entry?.wireMesh === hitObject) return true;
              return Array.isArray(entry?.wireMeshes) && entry.wireMeshes.includes(hitObject);
            });
          }
          if (idx < 0) continue;
          const entry = this.clusterAuraEntries[idx] || null;
          const screenPos = this._clusterWorldScreenPosition(entry);
          const radiusPx = this._clusterPickRadiusPx(entry);
          if (!screenPos || !this._isWithinPickRadius(screenPos, radiusPx)) continue;
          const d2 = this._pixelDistanceSq(screenPos, this.pointerPx);
          if (d2 < bestD2) {
            bestD2 = d2;
            best = idx;
          }
        }
        if (best >= 0) return best;
      }

      // Fallback: pure screen-space proximity to cluster centers when edge rays miss.
      let fallbackIdx = -1;
      let fallbackD2 = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.clusterAuraEntries.length; i++) {
        const entry = this.clusterAuraEntries[i] || null;
        const screenPos = this._clusterWorldScreenPosition(entry);
        const radiusPx = this._clusterPickRadiusPx(entry);
        if (!screenPos || !this._isWithinPickRadius(screenPos, radiusPx)) continue;
        const d2 = this._pixelDistanceSq(screenPos, this.pointerPx);
        if (d2 < fallbackD2) {
          fallbackD2 = d2;
          fallbackIdx = i;
        }
      }
      return fallbackIdx;
    }

    _rebuildClusterAuras() {
      this.clusterAuraEntries = [];
      this.hoverClusterIndex = -1;
      this.selectedClusterIndex = -1;
      this._clearGroup(this.clusterAuraGroup);
      if (!Array.isArray(this.stars) || !this.stars.length) return;
      if (!Array.isArray(this.clusterSummaryData) || !this.clusterSummaryData.length) return;

      const scale = 0.028;
      const bySystem = new Map();
      this.stars.forEach((star) => {
        const systemIndex = Number(star.system_index || 0);
        if (!Number.isFinite(systemIndex) || systemIndex <= 0) return;
        if (!bySystem.has(systemIndex)) bySystem.set(systemIndex, []);
        bySystem.get(systemIndex).push(star);
      });
      this.clusterSummaryData.forEach((cluster, index) => {
        const systems = Array.isArray(cluster?.systems)
          ? cluster.systems.map((n) => Number(n || 0)).filter((n) => Number.isFinite(n) && n > 0)
          : [];
        let starsInRange = [];
        if (systems.length) {
          systems.forEach((systemIndex) => {
            starsInRange.push(...(bySystem.get(systemIndex) || []));
          });
        } else {
          const from = Number(cluster?.from || 0);
          const to = Number(cluster?.to || 0);
          if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return;
          starsInRange = this.stars.filter((star) => {
            const systemIndex = Number(star.system_index || 0);
            return systemIndex >= from && systemIndex <= to;
          });
        }
        if (!starsInRange.length) return;
        const color = this._clusterAuraColor(cluster);

        // Echte Cluster-Netzstruktur: Nodes pro Sternsystem + Nachbarschaftssegmente.
        // Stride-Sampling statt einfachem Slice: Gleichmäßig über die gesamte
        // system_index-Reihenfolge (≈ radiale Ausdehnung) verteilt, damit Nodes
        // den ganzen Cluster abdecken und nicht nur den inneren Teil.
        const maxNodes = 140;
        const nodeStars = starsInRange.length <= maxNodes
          ? starsInRange
          : (() => {
              const stride = Math.ceil(starsInRange.length / maxNodes);
              return starsInRange.filter((_, i) => i % stride === 0);
            })();
        const nodes = nodeStars.map((star) => ({
          position: new THREE.Vector3(
            (Number(star.x_ly) || 0) * scale,
            (Number(star.z_ly) || 0) * scale * 0.42,
            (Number(star.y_ly) || 0) * scale
          ),
        }));
        if (!nodes.length) return;

        let spread = 0;
        const centroid = nodes.reduce((acc, node) => {
          acc.x += node.position.x;
          acc.y += node.position.y;
          acc.z += node.position.z;
          return acc;
        }, new THREE.Vector3(0, 0, 0)).multiplyScalar(1 / nodes.length);
        nodes.forEach((node) => {
          spread = Math.max(spread, node.position.distanceTo(centroid));
        });
        const linkDistance = Math.max(10, spread * 0.42);
        const maxNeighbors = 2;

        const edgeSet = new Set();
        const edgeList = [];
        for (let i = 0; i < nodes.length; i++) {
          const distances = [];
          for (let j = 0; j < nodes.length; j++) {
            if (i === j) continue;
            const dist = nodes[i].position.distanceTo(nodes[j].position);
            if (dist <= linkDistance) distances.push({ j, dist });
          }
          distances.sort((a, b) => a.dist - b.dist);
          distances.slice(0, maxNeighbors).forEach(({ j }) => {
            const a = Math.min(i, j);
            const b = Math.max(i, j);
            const key = `${a}:${b}`;
            if (edgeSet.has(key)) return;
            edgeSet.add(key);
            edgeList.push({ a, b, dist: nodes[a].position.distanceTo(nodes[b].position) });
          });
        }

        // Falls ein Cluster sehr dispergiert ist und keine Kanten entstanden sind, mindestens Kette bauen.
        if (!edgeList.length && nodes.length > 1) {
          const ordered = nodes
            .map((node, nodeIndex) => ({ node, nodeIndex, d: node.position.distanceTo(centroid) }))
            .sort((a, b) => a.d - b.d);
          for (let i = 1; i < ordered.length; i++) {
            const a = ordered[i - 1].nodeIndex;
            const b = ordered[i].nodeIndex;
            edgeList.push({ a: Math.min(a, b), b: Math.max(a, b), dist: ordered[i].d });
          }
        }

        edgeList.sort((a, b) => a.dist - b.dist);
        const edgeCap = Math.max(16, Math.min(420, nodes.length * 4));
        const clippedEdges = edgeList.slice(0, edgeCap);
        const lines = [];
        clippedEdges.forEach((edge) => {
          const p1 = nodes[edge.a].position;
          const p2 = nodes[edge.b].position;
          lines.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        });

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        const segmentCount = Math.floor(lines.length / 6);
        lineGeo.setDrawRange(0, segmentCount * 2);
        const lineMat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.17,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const lineMesh = new THREE.LineSegments(lineGeo, lineMat);

        const nodeMeshes = [];
        const clusterGroup = new THREE.Group();
        this.clusterAuraGroup.add(clusterGroup);
        nodes.forEach((node) => {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.72, 10, 8),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.42,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            })
          );
          mesh.position.copy(node.position);
          clusterGroup.add(mesh);
          nodeMeshes.push(mesh);
        });

        clusterGroup.add(lineMesh);

        const bounds = new THREE.Box3();
        nodes.forEach((node) => bounds.expandByPoint(node.position));
        const pad = THREE.MathUtils.clamp(spread * 0.12, 1.6, 10);
        bounds.min.addScalar(-pad);
        bounds.max.addScalar(pad);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        // Voxel stack: many smaller wire boxes (default 1x1x1 ly cells) instead of one large box.
        const voxelLy = 1;
        const voxelSize = new THREE.Vector3(
          scale * voxelLy,
          scale * voxelLy * 0.42,
          scale * voxelLy
        );
        const voxelMap = new Map();
        let centroidXly = 0;
        let centroidYly = 0;
        let centroidZly = 0;
        starsInRange.forEach((star) => {
          const xLy = Number(star.x_ly || 0);
          const yLy = Number(star.y_ly || 0);
          const zLy = Number(star.z_ly || 0);
          centroidXly += xLy;
          centroidYly += yLy;
          centroidZly += zLy;
          const vx = Math.round(xLy / voxelLy);
          const vy = Math.round(yLy / voxelLy);
          const vz = Math.round(zLy / voxelLy);
          const key = `${vx}|${vy}|${vz}`;
          const slot = voxelMap.get(key) || { vx, vy, vz, count: 0 };
          slot.count += 1;
          voxelMap.set(key, slot);
        });
        const starCount = Math.max(1, starsInRange.length);
        centroidXly /= starCount;
        centroidYly /= starCount;
        centroidZly /= starCount;
        const voxelCells = [...voxelMap.values()]
          .map((cell) => Object.assign(cell, {
            d2: ((cell.vx - centroidXly) ** 2) + ((cell.vy - centroidYly) ** 2) + ((cell.vz - centroidZly) ** 2),
          }))
          .sort((a, b) => b.count - a.count || a.d2 - b.d2);
        const maxVoxelBoxes = 560;
        const clippedCells = voxelCells.slice(0, maxVoxelBoxes);
        const boxGeo = new THREE.BoxGeometry(voxelSize.x, voxelSize.y, voxelSize.z);
        const wireGeo = new THREE.EdgesGeometry(boxGeo);
        const wireMat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: this.clusterBoundsVisible ? 0.26 : 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const wireMeshes = clippedCells.map((cell) => {
          const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
          wireMesh.position.set(
            cell.vx * scale,
            cell.vz * scale * 0.42,
            cell.vy * scale
          );
          wireMesh.visible = !!this.clusterBoundsVisible;
          wireMesh.userData = Object.assign({}, wireMesh.userData, { clusterIndex: index });
          clusterGroup.add(wireMesh);
          return wireMesh;
        });
        const wireMesh = wireMeshes[0] || null;

        const systemsForCluster = systems.length
          ? systems.slice()
          : Array.from(new Set(starsInRange.map((star) => Number(star.system_index || 0)).filter((n) => Number.isFinite(n) && n > 0)));

        this.clusterAuraEntries.push({
          cluster,
          group: clusterGroup,
          nodeMeshes,
          lineMat,
          lineGeo,
          segmentCount,
          phase: index * 0.7,
          wireMesh,
          wireMeshes,
          wireMat,
          wireGeo,
          center,
          size,
          systems: systemsForCluster,
          baseColor: new THREE.Color(color),
          heatColor: new THREE.Color(0xff8a54),
        });
      });
    }

    _buildOrbitalFacilityEntry(entry, index) {
      const facilities = Array.isArray(entry.slot?.player_planet?.orbital_facilities)
        ? entry.slot.player_planet.orbital_facilities
        : [];
      if (!facilities.length) return null;

      const radius = Math.max(5.8, (entry.mesh.geometry?.parameters?.radius || 4) + 3.5);
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.16, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0x6ea4d8, transparent: true, opacity: 0.55 })
      );
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      facilities.slice(0, 8).forEach((facility, facilityIndex) => {
        const angle = (facilityIndex / Math.max(1, facilities.length)) * Math.PI * 2;
        const fColor = this._facilityColor(facility.category);
        const textureSeed = (index * 31 + facilityIndex * 17) >>> 0;
        const descriptor = this._objectTextureDescriptor('building', facility, fColor, textureSeed, {
          variant: 'desert',
          roughness: 0.54,
          metalness: 0.44,
          glow: 0.18,
          clouds: 0,
          ice_caps: 0,
        });
        const bundle = this._objectTextureBundle('building', descriptor, fColor);
        const fTex = bundle?.map || this._fleetHullTexture(fColor, textureSeed);
        const fMaterial = this.materialFactory
          ? this.materialFactory.createFleetHullMaterial(fColor, bundle || fTex)
          : new THREE.MeshStandardMaterial({
              color: fColor,
              map: fTex,
              bumpMap: bundle?.bumpMap || null,
              bumpScale: bundle?.bumpMap ? 0.05 : 0,
              emissive: fColor,
              emissiveMap: bundle?.emissiveMap || fTex,
              emissiveIntensity: 0.2,
              roughness: 0.56,
              metalness: 0.38,
            });
        const module = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.8, 1.4),
          fMaterial
        );
        module.material.userData = Object.assign({}, module.material.userData, { sharedTexture: true });
        module.position.set(Math.cos(angle) * radius, (facilityIndex % 2 === 0 ? 0.55 : -0.55), Math.sin(angle) * radius);
        module.lookAt(new THREE.Vector3(0, 0, 0));
        group.add(module);
      });

      const hostMesh = entry.renderMesh || entry.mesh;
      hostMesh.add(group);
      this._prepareGpuOrbitMaterials(group);
      this._setEntryGpuOrbitVisualState(entry, this.activeGpuOrbitVisuals === true);
      return {
        group,
        ring,
        entry,
        spin: 0.22 + index * 0.02,
      };
    }

    // ── Faction aura ──────────────────────────────────────────────────────────

    /**
     * Build a pulsating faction-color aura ring around a colonised planet mesh.
     * @param {object} entry    systemPlanetEntry (must have .mesh and .body)
     * @param {string} colorHex  "#rrggbb" owner empire color
     */
    _buildPlanetFactionAura(entry, colorHex) {
      if (!entry?.mesh || !colorHex) return;
      const hostMesh = entry.renderMesh || entry.mesh;
      const planetRadius = entry.mesh.geometry?.parameters?.radius ?? 4;
      const ringRadius = planetRadius * 1.55;
      const tubeRadius = Math.max(0.16, planetRadius * 0.085);
      const color        = new THREE.Color(colorHex);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const auraMesh = new THREE.Mesh(
        new THREE.TorusGeometry(ringRadius, tubeRadius, 14, 64),
        mat,
      );
      auraMesh.rotation.x = Math.PI / 2;
      auraMesh.rotation.z = Math.PI * 0.14;
      auraMesh.userData = { kind: 'faction-aura-ring', color };
      hostMesh.add(auraMesh);
      this._prepareGpuOrbitMaterials(auraMesh);
      this._setEntryGpuOrbitVisualState(entry, this.activeGpuOrbitVisuals === true);

      this.systemAtmosphereEntries.push({
        mesh: auraMesh,
        uniforms: null,
        baseOpacity: 0.34,
        pulseSpeed: 1.6,
        pulseAmplitude: 0.10,
        phase: Math.random() * Math.PI * 2,
        baseScale: new THREE.Vector3(1, 1, 1),
        scaleAmplitude: 0.04,
      });
    }

    // ── Star-orbit installations ───────────────────────────────────────────────

    /**
     * Build visual nodes for star-orbit installations (stargates, relay stations, …).
     * Each installation gets its own elliptical orbit around the star.
     * @param {object} star     Star descriptor
     * @param {object} payload  System payload (payload.star_installations)
     */
    _buildStarInstallations(star, payload) {
      const installs = Array.isArray(payload.star_installations) ? payload.star_installations : [];
      if (!installs.length) return;

      // Assign evenly-spaced orbital radii so installations don't overlap
      const baseOrbitRadius = 290;
      const radiusStep      = 38;

      installs.forEach((install, index) => {
        const type       = String(install.type || 'relay_station');
        const level      = Math.max(1, Number(install.level || 1));
        const colorHex   = String(install.owner_color || '#4af9ff');
        const orbitRadius = baseOrbitRadius + index * radiusStep;
        const orbitMinor  = orbitRadius * 0.88;
        const initAngle   = (index / Math.max(1, installs.length)) * Math.PI * 2;
        const orbitSpeed  = 0.035 / Math.sqrt(orbitRadius / 290);
        const animState   = this._modelAnimStateForType(type, level);

        const mesh = this._buildInstallationMesh(type, level, colorHex, animState);
        if (!mesh) return;
        mesh.userData = Object.assign(mesh.userData || {}, {
          kind:        'star-installation',
          installType: type,
          level,
          colorHex,
          animState,
          orbitRadius,
          orbitMinor,
        });
        const installParticles = this._createInstallationParticleField(
          colorHex,
          type,
          level,
          mesh.userData?.gqResolvedVfx || mesh.userData?.resolvedVfx || null,
        );
        if (installParticles) {
          mesh.add(installParticles);
        }
        this.systemStarInstallationGroup.add(mesh);

        // Build a faint orbit ring for the installation
        const orbitCurve = new THREE.EllipseCurve(0, 0, orbitRadius, orbitMinor, 0, Math.PI * 2, false, 0);
        const orbitPoints = orbitCurve.getPoints(96).map((p) => new THREE.Vector3(p.x, 0, p.y));
        const orbitLine = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(orbitPoints),
          new THREE.LineBasicMaterial({ color: new THREE.Color(colorHex), transparent: true, opacity: 0.22 }),
        );
        this.systemStarInstallationGroup.add(orbitLine);

        this.systemStarInstallationEntries.push({
          mesh,
          orbitRadius,
          orbitMinor,
          angle:       initAngle,
          speed:       orbitSpeed,
          install,
          position:    Number(install.position || 0),
          owner:       String(install.owner || ''),
          animState,
          installParticles,
          modelAnims:  this._extractModelAnimations(type),
          elapsed:     0,
        });

        this._initInstallationWeaponFxEntry(this.systemStarInstallationEntries[this.systemStarInstallationEntries.length - 1]);
        this._initInstallationBurstFxEntry(this.systemStarInstallationEntries[this.systemStarInstallationEntries.length - 1]);
      });
    }

    _initInstallationWeaponFxEntry(entry) {
      if (!entry?.mesh || !this.systemInstallationWeaponFxGroup) return;
      const resolved = entry.mesh.userData?.gqResolvedVfx || entry.mesh.userData?.resolvedVfx || null;
      const weapons = Array.isArray(resolved?.weapons) ? resolved.weapons : [];
      if (!weapons.length) return;

      weapons.forEach((weapon, idx) => {
        const kind = String(weapon?.kind || '').toLowerCase();
        if (kind !== 'beam' && kind !== 'plasma' && kind !== 'rail' && kind !== 'missile') return;
        const sourceNode = typeof weapon.fromResolvedUuid === 'string'
          ? entry.mesh.getObjectByProperty('uuid', weapon.fromResolvedUuid)
          : null;
        const coreColor = Number.isInteger(weapon?.coreColor) ? weapon.coreColor : 0x66ccff;
        const glowColor = Number.isInteger(weapon?.glowColor) ? weapon.glowColor : coreColor;
        const alpha = THREE.MathUtils.clamp(Number(weapon?.alpha || 0.8), 0.08, 1);

        const profile = this._installationWeaponFxProfile(kind);

        const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: profile.lineUsesGlow ? glowColor : coreColor,
          transparent: true,
          opacity: alpha,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const line = new THREE.Line(geometry, material);
        line.visible = false;
        line.userData = Object.assign({}, line.userData, {
          kind: 'installation-weapon-beam',
          beamId: String(weapon.id || `beam_${idx}`),
          weaponKind: kind,
          baseAlpha: alpha,
          profile,
          pulseOffset: Math.random() * Math.PI * 2,
        });
        this.systemInstallationWeaponFxGroup.add(line);

        let headMesh = null;
        if (profile.useHeadMesh) {
          headMesh = new THREE.Mesh(
            new THREE.SphereGeometry(profile.headRadius, 8, 8),
            new THREE.MeshBasicMaterial({
              color: glowColor,
              transparent: true,
              opacity: THREE.MathUtils.clamp(alpha * 0.95, 0.08, 1),
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          headMesh.visible = false;
          this.systemInstallationWeaponFxGroup.add(headMesh);
        }

        this.systemInstallationWeaponFxEntries.push({
          installEntry: entry,
          weapon,
          kind,
          profile,
          sourceNode,
          line,
          headMesh,
          nextFireAt: 0,
          fireUntil: 0,
        });
      });
    }

    _installationWeaponFxProfile(kind) {
      switch (String(kind || '').toLowerCase()) {
        case 'plasma':
          return {
            lineUsesGlow: true,
            useHeadMesh: true,
            headRadius: 0.11,
            pulseFreq: 8.2,
            pulseMin: 0.36,
            pulseMax: 0.96,
            travelSpeed: 0.72,
            drawsTrailToSource: true,
            strobe: false,
          };
        case 'rail':
          return {
            lineUsesGlow: false,
            useHeadMesh: false,
            headRadius: 0,
            pulseFreq: 17.5,
            pulseMin: 0.12,
            pulseMax: 1.0,
            travelSpeed: 1.35,
            drawsTrailToSource: false,
            strobe: true,
          };
        case 'missile':
          return {
            lineUsesGlow: true,
            useHeadMesh: true,
            headRadius: 0.15,
            pulseFreq: 5.8,
            pulseMin: 0.32,
            pulseMax: 0.9,
            travelSpeed: 0.48,
            drawsTrailToSource: true,
            strobe: false,
          };
        case 'beam':
        default:
          return {
            lineUsesGlow: false,
            useHeadMesh: false,
            headRadius: 0,
            pulseFreq: 11.0,
            pulseMin: 0.38,
            pulseMax: 1.0,
            travelSpeed: 0,
            drawsTrailToSource: false,
            strobe: false,
          };
      }
    }

    _installationWeaponFxCadence(kind, state) {
      const s = String(state || 'idle').toLowerCase();
      const alert = s === 'alert';
      switch (String(kind || '').toLowerCase()) {
        case 'plasma': return alert ? 0.75 : 1.15;
        case 'rail': return alert ? 0.42 : 0.8;
        case 'missile': return alert ? 1.35 : 2.1;
        case 'beam':
        default:
          return alert ? 0.28 : 0.5;
      }
    }

    _installationWeaponFxShotDuration(kind, state) {
      const s = String(state || 'idle').toLowerCase();
      const alert = s === 'alert';
      switch (String(kind || '').toLowerCase()) {
        case 'plasma': return alert ? 0.52 : 0.36;
        case 'rail': return alert ? 0.1 : 0.08;
        case 'missile': return alert ? 0.72 : 0.55;
        case 'beam':
        default:
          return alert ? 0.34 : 0.22;
      }
    }

    _triggerInstallationWeaponFire(fxEntry, elapsed, activeState, cadenceScale = 1) {
      const cadence = this._installationWeaponFxCadence(fxEntry.kind, activeState) * Math.max(0.1, Number(cadenceScale) || 1);
      const shotDuration = this._installationWeaponFxShotDuration(fxEntry.kind, activeState);
      fxEntry.fireUntil = Math.max(Number(fxEntry.fireUntil || 0), elapsed + shotDuration);
      fxEntry.nextFireAt = elapsed + cadence;

      // Add to BeamEffect pool (Phase FX-3 instanced rendering)
      if (this.beamEffect && fxEntry.worldFrom && fxEntry.worldTo) {
        const beamRecord = {
          id: String(fxEntry?.weapon?.id || `beam_${fxEntry?.kind}_${Date.now()}`),
          from: fxEntry.worldFrom,
          to: fxEntry.worldTo,
          coreColor: Number(fxEntry?.weapon?.coreColor ?? 0x66ccff),
          color: Number(fxEntry?.weapon?.glowColor ?? fxEntry?.weapon?.coreColor ?? 0x66ccff),
          glowRadius: 0.4,
          duration: shotDuration,
        };
        this.beamEffect.addBeam(beamRecord);
      }

      const installEntry = fxEntry.installEntry;
      if (installEntry && elapsed >= Number(installEntry.burstCooldownUntil || 0)) {
        this._spawnInstallationBurstFx(installEntry, elapsed);
      }
    }

    _applyPendingInstallationWeaponFire(elapsed) {
      if (!Array.isArray(this.pendingInstallationWeaponFire) || !this.pendingInstallationWeaponFire.length) return;

      const events = this.pendingInstallationWeaponFire.splice(0, this.pendingInstallationWeaponFire.length);
      
      events.forEach((ev) => {
        const eventSourceType = String(ev?.sourceType || '').toLowerCase();
        
        // Phase 2: Multi-entity routing
        switch (eventSourceType) {
          case 'ship':
            this._applyWeaponFireToShips(ev, elapsed);
            break;
          case 'debris':
            this._applyWeaponFireToDebris(ev, elapsed);
            break;
          case 'wormhole':
          case 'gate':
          case 'beacon':
            this._applyWeaponFireToWormholes(ev, elapsed);
            break;
          case 'installation':
          case '': // null/empty defaults to installation broadcast
          case null:
          default:
            this._applyWeaponFireToInstallations(ev, elapsed);
        }
      });
    }

    /**
     * Apply a weapon-fire event to stations/installations in this system.
     * @param {object} ev - Event payload
     * @param {number} elapsed - Frame elapsed time
     * @private
     */
    _applyWeaponFireToInstallations(ev, elapsed) {
      if (!Array.isArray(this.systemInstallationWeaponFxEntries) || !this.systemInstallationWeaponFxEntries.length) return;

      this.systemInstallationWeaponFxEntries.forEach((fxEntry) => {
        const installEntry = fxEntry?.installEntry;
        if (!installEntry?.mesh) return;

        // Filter by weapon kind
        if (ev.weaponKind && ev.weaponKind !== String(fxEntry.kind || '').toLowerCase()) return;
        
        // Filter by source owner (null = all)
        if (ev.sourceOwner && ev.sourceOwner !== String(installEntry.owner || '').trim()) return;
        
        // Fire!
        const state = String(installEntry.animState || installEntry.mesh.userData?.animState || 'active');
        this._triggerInstallationWeaponFire(fxEntry, elapsed, state, 0.7);
      });
    }

    // ============================================================================
    // Phase 2 Stubs: Ship/Debris/Wormhole Weapon Fire (Future Implementation)
    // ============================================================================

    /**
     * Apply weapon-fire event to ships/vessels in this system.
     * 
     * Matches ships by:
     * - sourceOwner: faction/player name
     * - weaponKind: laser, beam, missile, etc.
     * 
     * Triggers beams from ship hardpoints to closest enemy beacon/installation.
     * 
     * @param {object} ev - Event payload with sourceType='ship'
     * @param {number} elapsed - Frame elapsed time
     * @private
     */
    _applyWeaponFireToShips(ev, elapsed) {
      if (!Array.isArray(this.systemFleetEntries) || !this.systemFleetEntries.length) return;

      this.systemFleetEntries.forEach((fleetEntry) => {
        if (!fleetEntry?.mesh || !fleetEntry?.fleet) return;

        // Filter by source owner (null = all)
        if (ev.sourceOwner && ev.sourceOwner !== String(fleetEntry.fleet.owner || '').trim()) return;
        
        // Filter by weapon kind if specified
        if (ev.weaponKind) {
          const ship = fleetEntry.fleet;
          const hasWeapon = String(ship?.armament || ship?.weapons || '').toLowerCase().includes(ev.weaponKind);
          if (!hasWeapon) return;
        }

        // Fire ship weapon
        const state = String(fleetEntry.mesh.userData?.animState || 'active');
        this._triggerShipWeaponFire(fleetEntry, ev, elapsed, state);
      });
    }

    /**
     * Trigger weapon fire from a ship.
     * Creates beams from ship position to nearby enemy installations.
     * 
     * @param {object} fleetEntry - Ship entry with mesh and fleet data
     * @param {object} ev - Event payload
     * @param {number} elapsed - Frame elapsed time
     * @param {string} state - Animation state (active, damaged, etc)
     * @private
     */
    _triggerShipWeaponFire(fleetEntry, ev, elapsed, state = 'active') {
      if (!fleetEntry?.mesh || !this.beamEffect) return;

      // Get ship position
      const shipWorldPos = new THREE.Vector3();
      fleetEntry.mesh.getWorldPosition(shipWorldPos);

      // Find closest enemy installation as target
      let closestInstall = null;
      let closestDist = Number.MAX_VALUE;

      if (Array.isArray(this.systemInstallationWeaponFxEntries)) {
        this.systemInstallationWeaponFxEntries.forEach((fxEntry) => {
          const install = fxEntry?.installEntry;
          if (!install?.mesh) return;
          
          // Skip friendly installations
          const installOwner = String(install.owner || '').trim();
          const shipOwner = String(fleetEntry.fleet?.owner || '').trim();
          if (installOwner === shipOwner) return;

          // Check distance
          const installWorldPos = new THREE.Vector3();
          install.mesh.getWorldPosition(installWorldPos);
          const dist = shipWorldPos.distanceTo(installWorldPos);

          if (dist < closestDist) {
            closestDist = dist;
            closestInstall = { fxEntry, world: installWorldPos };
          }
        });
      }

      // Create beam to target
      if (closestInstall && closestDist < 200) { // Range limit
        const cadence = this._installationWeaponFxCadence(ev.weaponKind || 'laser', state);
        const shotDuration = this._installationWeaponFxShotDuration(ev.weaponKind || 'laser', state);

        const beamRecord = {
          id: `ship_beam_${fleetEntry.fleet?.id}_${Date.now()}`,
          from: shipWorldPos.toArray(),
          to: closestInstall.world.toArray(),
          coreColor: Number(ev.coreColor ?? 0x00ff88),
          color: Number(ev.color ?? 0x00ff88),
          glowRadius: 0.35,
          duration: shotDuration,
        };

        this.beamEffect.addBeam(beamRecord);
        
        // Set up next fire interval
        if (!fleetEntry._nextShipFire) fleetEntry._nextShipFire = {};
        fleetEntry._nextShipFire[ev.weaponKind || 'default'] = elapsed + cadence;
      }
    }

    /**
     * Apply weapon-fire event to debris/wreckage in this system.
     * 
     * PHASE 3 COMPLETE:
     * - Damage accumulation via DebrisManager state machine
     * - State transitions (intact → damaged → critical → destroyed)
     * - Progressive fragment spawning based on damage level
     * - Material damage visualization
     * - Destruction callback with explosion effects
     * 
     * @param {object} ev - Event payload with sourceType='debris'
     * @param {number} elapsed - Frame elapsed time
     * @private
     */
    _applyWeaponFireToDebris(ev, elapsed) {
      if (!this.debrisManager) {
        // Fallback: simple impact burst (Phase 2)
        this._spawnDebrisImpactBurst(ev, elapsed);
        return;
      }

      // TODO: Match debris by position/ID from targetPos
      // For now: apply damage to all debris in system (or use sourcePosition as ID)
      if (!ev.targetPos) return;

      const targetPos = ev.targetPos;
      const damageAmount = Number(ev.damage ?? 25);

      // Find nearest debris object within range
      const nearestDebris = this._findNearestDebrisToPosition(targetPos, 50);
      if (!nearestDebris) {
        // No debris found, spawn impact burst
        this._spawnDebrisImpactBurst(ev, elapsed);
        return;
      }

      // Apply damage via DebrisManager (triggers state machine)
      this.debrisManager.applyDamage(nearestDebris.id, damageAmount, {
        attacker: String(ev.sourceOwner || 'unknown'),
        weaponKind: String(ev.weaponKind || 'impact'),
        timestamp: elapsed,
      });

      // Spawn fragments based on new state
      const debris = this.debrisManager.get(nearestDebris.id);
      this._spawnDebrisFragmentsByState(debris, targetPos, elapsed);
    }

    /**
     * Simple debris impact burst (fallback from Phase 2)
     * Spawns particles at impact location
     * @private
     */
    _spawnDebrisImpactBurst(ev, elapsed) {
      if (!ev.targetPos || !Array.isArray(ev.targetPos) || !this.systemInstallationBurstFxGroup) return;

      const impactPos = new THREE.Vector3(...ev.targetPos);
      
      const count = 12;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const angle = (i / count) * Math.PI * 2;
        const r = 0.3;
        positions[idx] = Math.cos(angle) * r;
        positions[idx + 1] = (Math.random() - 0.5) * 0.2;
        positions[idx + 2] = Math.sin(angle) * r;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0xffaa44,
        size: 0.08,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      
      const burst = new THREE.Points(geometry, material);
      burst.position.copy(impactPos);
      burst.userData = {
        kind: 'debris-impact',
        age: 0,
        duration: 0.4,
      };

      this.systemInstallationBurstFxGroup.add(burst);
    }

    /**
     * Find nearest debris object to world position
     * @param {[number, number, number]} worldPos - World coordinates
     * @param {number} maxDistance - Search radius
     * @returns {object|null} Debris entry with metadata or null
     * @private
     */
    _findNearestDebrisToPosition(worldPos, maxDistance = 50) {
      if (!this.debrisManager) return null;

      const targetVec = new THREE.Vector3(...worldPos);
      let nearest = null;
      let nearestDist = maxDistance;

      this.debrisManager.getAll().forEach((debris) => {
        const debrisVec = new THREE.Vector3(...debris.position);
        const dist = targetVec.distanceTo(debrisVec);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = debris;
        }
      });

      return nearest;
    }

    /**
     * Spawn debris fragments based on cumulative damage state
     * Progressive emission: damaged→critical→destroyed
     * 
     * @param {object} debris - Debris object from manager
     * @param {[number, number, number]} impactPos - Impact location
     * @param {number} elapsed - Frame time
     * @private
     */
    _spawnDebrisFragmentsByState(debris, impactPos, elapsed) {
      if (!debris || !this.systemInstallationBurstFxGroup) return;

      let fragmentCount = 0;
      let spreadAngle = 0.2 * Math.PI;
      let fragmentColor = 0xffaa44;

      // Determine emission intensity by state
      switch (debris.state) {
        case 'damaged':
          fragmentCount = 6;
          spreadAngle = 0.3 * Math.PI;
          fragmentColor = 0xffaa44;  // Orange
          break;
        case 'critical':
          fragmentCount = 12;
          spreadAngle = 0.4 * Math.PI;
          fragmentColor = 0xff6622;  // Darker orange/red
          break;
        case 'destroyed':
          fragmentCount = 24;
          spreadAngle = 0.5 * Math.PI;
          fragmentColor = 0xff2200;  // Red
          break;
        default:
          return;
      }

      // Spawn fragments
      const positions = new Float32Array(fragmentCount * 3);
      for (let i = 0; i < fragmentCount; i++) {
        const idx = i * 3;
        const angle = (i / fragmentCount) * Math.PI * 2 + (Math.random() - 0.5) * spreadAngle;
        const r = 0.2 + Math.random() * 0.5;
        positions[idx] = Math.cos(angle) * r;
        positions[idx + 1] = (Math.random() - 0.5) * 0.3;
        positions[idx + 2] = Math.sin(angle) * r;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: fragmentColor,
        size: 0.05 + Math.random() * 0.08,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const burst = new THREE.Points(geometry, material);
      burst.position.set(...impactPos);
      burst.userData = {
        kind: 'debris-fragments',
        age: 0,
        duration: 0.8 + Math.random() * 0.4,
        state: debris.state,
      };

      this.systemInstallationBurstFxGroup.add(burst);

      // Update debris material
      this._updateDebrisMaterialByState(debris, elapsed);
    }

    /**
     * Update debris mesh material based on damage state
     * Progressive darkening and color shift toward red
     * 
     * @param {object} debris - Debris from manager
     * @param {number} elapsed - Frame time
     * @private
     */
    _updateDebrisMaterialByState(debris, elapsed) {
      if (!debris.mesh || !debris.mesh.material) return;

      const material = debris.mesh.material;
      const dmg = debris.damageLevel;

      // Color progression: white → orange → red
      const targetColor = new THREE.Color(1, 0.3, 0.2);  // Red/orange
      const blend = Math.min(1.0, dmg * 1.5);  // Exaggerate color shift

      if (material.color) {
        material.color.lerp(targetColor, blend * 0.4);
      }

      if (material.emissive) {
        material.emissive.lerp(targetColor, blend * 0.6);
      }

      if ('emissiveIntensity' in material) {
        material.emissiveIntensity = blend * 0.7;
      }

      // Optional: darken material
      if ('opacity' in material) {
        material.opacity = 1.0 - blend * 0.15;  // Slight transparency as damage increases
      }
    }

    /**
     * Callback when debris is destroyed
     * Triggers final explosion effects
     * 
     * @param {object} debris - Destroyed debris object
     * @private
     */
    _onDebrisDestroyed(debris) {
      if (!debris || !this.systemInstallationBurstFxGroup) return;

      // Final explosion burst
      const count = 24;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        const r = 0.4 + Math.random() * 0.6;
        positions[idx] = Math.cos(angle) * r;
        positions[idx + 1] = (Math.random() - 0.5) * 0.5;
        positions[idx + 2] = Math.sin(angle) * r;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0xff4400,
        size: 0.12,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const explosion = new THREE.Points(geometry, material);
      explosion.position.set(...debris.position);
      explosion.userData = {
        kind: 'debris-explosion',
        age: 0,
        duration: 1.0,
      };

      this.systemInstallationBurstFxGroup.add(explosion);

      // Dispatch destruction event
      window.dispatchEvent(new CustomEvent('gq:debris:destroyed', {
        detail: {
          debrisId: debris.id,
          position: debris.position,
          state: debris.state,
          damageLevel: debris.damageLevel,
        },
      }));
    }

    /**
     * Apply weapon-fire event to wormholes/gateways/beacons in this system.
     * 
     * PHASE 2 PLANNING:
     * - Locate active wormhole/gateway meshes
     * - Animate destabilization shader/colors
     * - Trigger rupture sequence when energy threshold hit
     * - Cascade effects to linked wormholes
     * 
     * Currently: Creates pulsing beam discharge effect.
     * 
     * @param {object} ev - Event payload with sourceType='wormhole|gate|beacon'
     * @param {number} elapsed - Frame elapsed time
     * @private
     */
    _applyWeaponFireToWormholes(ev, elapsed) {
      // TODO: Full wormhole destabilization system in future Phase
      // For now: Generic energy discharge effect
      if (!this.beamEffect) return;

      // Look for wormhole/gate/beacon in installation registry
      if (!Array.isArray(this.systemInstallationWeaponFxEntries)) return;

      this.systemInstallationWeaponFxEntries.forEach((fxEntry) => {
        const install = fxEntry?.installEntry;
        if (!install?.mesh) return;

        // Match wormholes/gates/beacons by type
        const installType = String(install.type || install.kind || '').toLowerCase();
        if (!installType.includes('wormhole') && 
            !installType.includes('gate') && 
            !installType.includes('beacon')) return;

        // Filter by owner if specified
        if (ev.sourceOwner && ev.sourceOwner !== String(install.owner || '').trim()) return;

        // Create discharge beam pattern (spiral around entity)
        const installWorldPos = new THREE.Vector3();
        install.mesh.getWorldPosition(installWorldPos);

        // Create radial discharge beams
        const numBeams = 3;
        for (let i = 0; i < numBeams; i++) {
          const angle = (i / numBeams) * Math.PI * 2 + elapsed;
          const offset = new THREE.Vector3(
            Math.cos(angle) * 3,
            Math.sin(angle) * 2,
            Math.cos(angle + 1) * 2
          );

          const beamRecord = {
            id: `wormhole_discharge_${install.id}_${i}_${Date.now()}`,
            from: installWorldPos.toArray(),
            to: installWorldPos.clone().add(offset).toArray(),
            coreColor: 0x6600ff,
            color: 0x9933ff,
            glowRadius: 0.5,
            duration: 0.08,
          };

          this.beamEffect.addBeam(beamRecord);
        }
      });
    }

    _initInstallationBurstFxEntry(entry) {
      if (!entry?.mesh) return;
      const resolved = entry.mesh.userData?.gqResolvedVfx || entry.mesh.userData?.resolvedVfx || null;
      const emitters = Array.isArray(resolved?.emitters) ? resolved.emitters : [];
      entry.burstEmitters = emitters.filter((emitter) => {
        const mode = String(emitter?.mode || '').toLowerCase();
        const kind = String(emitter?.kind || '').toLowerCase();
        if (mode !== 'burst') return false;
        return kind === 'muzzle' || kind === 'impact' || kind === 'debris' || kind === 'trail';
      });
      entry.burstCooldownUntil = 0;
    }

    _spawnInstallationBurstFx(entry, elapsed = 0) {
      if (!entry?.mesh || !Array.isArray(entry.burstEmitters) || !entry.burstEmitters.length) return;
      if (!this.systemInstallationBurstFxGroup) return;

      const localPosition = new THREE.Vector3();
      const worldPosition = new THREE.Vector3();

      entry.burstEmitters.forEach((emitter, emitterIdx) => {
        const sourceNode = typeof emitter?.attachResolvedUuid === 'string'
          ? entry.mesh.getObjectByProperty('uuid', emitter.attachResolvedUuid)
          : null;
        const count = THREE.MathUtils.clamp(Number(emitter?.count || 12), 8, 40);
        const duration = THREE.MathUtils.clamp(Number(emitter?.lifetime || 0.22), 0.08, 1.1);
        const spread = THREE.MathUtils.clamp(Number(emitter?.spread || 0.18), 0.02, Math.PI);
        const sizeStart = THREE.MathUtils.clamp(Number(emitter?.sizeStart || 0.1), 0.02, 0.35);
        const colorStart = Number.isInteger(emitter?.colorStart) ? Number(emitter.colorStart) : 0xffbb66;

        if (sourceNode?.isObject3D) {
          sourceNode.getWorldPosition(worldPosition);
        } else {
          entry.mesh.getWorldPosition(worldPosition);
        }
        this.systemInstallationBurstFxGroup.worldToLocal(localPosition.copy(worldPosition));

        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
          const idx = i * 3;
          const a = (Math.random() - 0.5) * spread + emitterIdx * 0.2;
          const r = (0.08 + Math.random() * 0.34) * (1 + spread * 0.35);
          const y = (Math.random() - 0.5) * 0.3;
          positions[idx] = Math.cos(a) * r;
          positions[idx + 1] = y;
          positions[idx + 2] = Math.sin(a) * r;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
          color: new THREE.Color(colorStart),
          size: sizeStart,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        });
        const burst = new THREE.Points(geometry, material);
        burst.position.copy(localPosition);
        burst.userData = Object.assign({}, burst.userData, {
          kind: 'installation-burst-fx',
          age: 0,
          duration,
          fadeBase: material.opacity,
          growRate: 1.6 + Math.random() * 1.4,
        });

        this.systemInstallationBurstFxGroup.add(burst);
        this.systemInstallationBurstFxEntries.push(burst);
      });

      entry.burstCooldownUntil = elapsed + (0.7 + Math.random() * 0.5);
    }

    /**
     * Build a Three.js Group for a given installation type using the JSON model
     * descriptor (synchronously from the registry cache, falling back to a
     * procedural primitive when the descriptor is not yet loaded).
     * @param  {string} type       Model type key
     * @param  {number} level      Building level (influences scale)
     * @param  {string} colorHex   Owner faction color for tinting
     * @returns {THREE.Group}
     */
    _buildInstallationMesh(type, level, colorHex, animState = 'idle') {
      const registry = window.__GQ_ModelRegistry;
      if (registry?.hasCached(type)) {
        const group = registry.instantiate(type, colorHex, animState);
        const s = 1 + (level - 1) * 0.12;
        group.scale.setScalar(s);
        return group;
      }
      // Fallback: procedural primitive until the model is loaded
      return this._buildInstallationMeshProcedural(type, level, colorHex);
    }

    _buildInstallationMeshProcedural(type, level, colorHex) {
      const color = new THREE.Color(colorHex);
      const group = new THREE.Group();
      const scale = 1 + (level - 1) * 0.12;
      const installSeed = this._hashSeed(`${type}:${level}:${colorHex}`);
      const installDescriptor = this._objectTextureDescriptor('building', { type, level, colorHex }, color.getHex(), installSeed, {
        variant: 'desert',
        roughness: 0.5,
        metalness: 0.6,
        glow: 0.22,
        clouds: 0,
      });
      const installBundle = this._objectTextureBundle('building', installDescriptor, color.getHex());

      if (type === 'stargate') {
        const ringMat = this.materialFactory
          ? this.materialFactory.createHotGlowMaterial(color, color, installBundle)
          : new THREE.MeshStandardMaterial({
              color: installBundle?.map ? 0xffffff : color,
              map: installBundle?.map || null,
              emissive: color,
              emissiveMap: installBundle?.emissiveMap || null,
              emissiveIntensity: 0.7,
              roughness: 0.25,
              metalness: 0.75,
            });
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(3.2, 0.22, 14, 60),
          ringMat,
        );
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        const coreMat = this.materialFactory
          ? this.materialFactory.createHotGlowMaterial(color, color, installBundle)
          : new THREE.MeshStandardMaterial({
              color: installBundle?.map ? 0xffffff : color,
              map: installBundle?.map || null,
              emissive: color,
              emissiveMap: installBundle?.emissiveMap || null,
              emissiveIntensity: 1.4,
              roughness: 0.1,
              metalness: 0.85,
            });
        const core = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.55),
          coreMat,
        );
        group.add(core);
      } else if (type === 'relay_station') {
        const hubMat = this.materialFactory
          ? this.materialFactory.createStationBodyMaterial(color, installBundle)
          : new THREE.MeshStandardMaterial({
              color: installBundle?.map ? 0xffffff : color,
              map: installBundle?.map || null,
              emissive: color,
              emissiveMap: installBundle?.emissiveMap || null,
              emissiveIntensity: 0.28,
              roughness: 0.55,
              metalness: 0.5,
            });
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.6, 0.6, 1.6, 10),
          hubMat,
        );
        group.add(hub);
        const panelMat = this.materialFactory
          ? this.materialFactory.createStationPanelMaterial(color, 0.88, installBundle)
          : new THREE.MeshStandardMaterial({
              color: installBundle?.map ? 0xffffff : color,
              map: installBundle?.map || null,
              emissive: color,
              emissiveMap: installBundle?.emissiveMap || null,
              emissiveIntensity: 0.35,
              roughness: 0.3,
              metalness: 0.65,
              transparent: true,
              opacity: 0.88,
            });
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 0.12, 0.55),
          panelMat,
        );
        group.add(panel);
      } else if (type === 'jump_inhibitor') {
        const inhibitorCoreColor = new THREE.Color(0xaa2222);
        const inhibitorRingColor = new THREE.Color(0xff3333);
        const inhibitorCoreDescriptor = this._objectTextureDescriptor('building', { type, level, phase: 'core' }, inhibitorCoreColor.getHex(), installSeed + 1, {
          variant: 'lava',
          glow: 0.76,
          roughness: 0.34,
          metalness: 0.66,
          clouds: 0,
          craters: 0.04,
        });
        const inhibitorRingDescriptor = this._objectTextureDescriptor('building', { type, level, phase: 'ring' }, inhibitorRingColor.getHex(), installSeed + 2, {
          variant: 'lava',
          glow: 0.9,
          roughness: 0.22,
          metalness: 0.72,
          clouds: 0,
          craters: 0.02,
        });
        const inhibitorCoreBundle = this._objectTextureBundle('building', inhibitorCoreDescriptor, inhibitorCoreColor.getHex());
        const inhibitorRingBundle = this._objectTextureBundle('building', inhibitorRingDescriptor, inhibitorRingColor.getHex());
        const core = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.0),
          this.materialFactory
            ? this.materialFactory.createHotGlowMaterial(inhibitorCoreColor, 0x880000, inhibitorCoreBundle)
            : new THREE.MeshStandardMaterial({
                color: inhibitorCoreBundle?.map ? 0xffffff : 0xaa2222,
                map: inhibitorCoreBundle?.map || null,
                bumpMap: inhibitorCoreBundle?.bumpMap || null,
                bumpScale: inhibitorCoreBundle?.bumpMap ? 0.03 : 0,
                emissive: 0x880000,
                emissiveMap: inhibitorCoreBundle?.emissiveMap || null,
                emissiveIntensity: 0.55,
                roughness: 0.4,
                metalness: 0.65,
              }),
        );
        group.add(core);
        [0, Math.PI / 2, Math.PI / 4].forEach((rotY) => {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(2.0, 0.14, 10, 40),
            this.materialFactory
              ? this.materialFactory.createHotGlowMaterial(inhibitorRingColor, 0xcc0000, inhibitorRingBundle)
              : new THREE.MeshStandardMaterial({
                  color: inhibitorRingBundle?.map ? 0xffffff : 0xff3333,
                  map: inhibitorRingBundle?.map || null,
                  bumpMap: inhibitorRingBundle?.bumpMap || null,
                  bumpScale: inhibitorRingBundle?.bumpMap ? 0.02 : 0,
                  emissive: 0xcc0000,
                  emissiveMap: inhibitorRingBundle?.emissiveMap || null,
                  emissiveIntensity: 0.9,
                  roughness: 0.2,
                  metalness: 0.7,
                  transparent: true,
                  opacity: 0.82,
                }),
          );
          ring.rotation.y = rotY;
          group.add(ring);
        });
      } else if (type === 'deep_space_radar') {
        const radarDescriptor = this._objectTextureDescriptor('building', { type, level, colorHex }, color.getHex(), installSeed + 3, {
          variant: 'desert',
          roughness: 0.58,
          metalness: 0.52,
          glow: 0.24,
          clouds: 0,
        });
        const radarBundle = this._objectTextureBundle('building', radarDescriptor, color.getHex());
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.45, 1.8, 8),
          this.materialFactory
            ? this.materialFactory.createStationBodyMaterial(color, radarBundle)
            : new THREE.MeshStandardMaterial({
                color: radarBundle?.map ? 0xffffff : color,
                map: radarBundle?.map || null,
                bumpMap: radarBundle?.bumpMap || null,
                bumpScale: radarBundle?.bumpMap ? 0.04 : 0,
                emissive: color,
                emissiveMap: radarBundle?.emissiveMap || null,
                emissiveIntensity: 0.2,
                roughness: 0.6,
                metalness: 0.5,
              }),
        );
        group.add(base);
        const dish = new THREE.Mesh(
          new THREE.RingGeometry(1.4, 1.8, 28),
          this.materialFactory
            ? this.materialFactory.createStationPanelMaterial(color, 0.88, radarBundle)
            : new THREE.MeshStandardMaterial({
                color: radarBundle?.map ? 0xffffff : color,
                map: radarBundle?.map || null,
                bumpMap: radarBundle?.bumpMap || null,
                bumpScale: radarBundle?.bumpMap ? 0.03 : 0,
                emissive: color,
                emissiveMap: radarBundle?.emissiveMap || null,
                emissiveIntensity: 0.65,
                roughness: 0.25,
                metalness: 0.65,
                transparent: true,
                opacity: 0.88,
              }),
        );
        dish.position.set(0, 2.8, 0);
        dish.rotation.x = Math.PI / 2;
        group.add(dish);
      } else {
        // Generic fallback: wireframe octahedron
        const genericDescriptor = this._objectTextureDescriptor('building', { type, level, colorHex }, color.getHex(), installSeed + 4, {
          variant: 'rocky',
          roughness: 0.48,
          metalness: 0.56,
          glow: 0.2,
          clouds: 0,
        });
        const genericBundle = this._objectTextureBundle('building', genericDescriptor, color.getHex());
        group.add(new THREE.Mesh(
          new THREE.OctahedronGeometry(1.5, 1),
          new THREE.MeshStandardMaterial({
            color: genericBundle?.map ? 0xffffff : color,
            map: genericBundle?.map || null,
            bumpMap: genericBundle?.bumpMap || null,
            bumpScale: genericBundle?.bumpMap ? 0.04 : 0,
            emissive: color,
            emissiveMap: genericBundle?.emissiveMap || null,
            emissiveIntensity: 0.4,
            roughness: 0.45,
            metalness: 0.55,
            wireframe: true,
          }),
        ));
      }

      group.scale.setScalar(scale);
      return group;
    }

    _createInstallationParticleField(colorHex, type, level, resolvedVfx = null) {
      if (!THREE?.BufferGeometry || !THREE?.PointsMaterial || !THREE?.Points) return null;
      const installType = String(type || '').toLowerCase();
      if (installType === 'jump_inhibitor') return null;

      const emitterHint = this._deriveInstallationEmitterHint(resolvedVfx);

      const safeLevel = Math.max(1, Number(level || 1));
      const particleCount = Math.min(180, Math.max(12, Number(emitterHint?.count) || (28 + safeLevel * 10)));
      const radius = 1.4 + safeLevel * 0.18;
      const positions = new Float32Array(particleCount * 3);
      const color = emitterHint?.colorStart
        ? new THREE.Color(Number(emitterHint.colorStart))
        : new THREE.Color(colorHex || '#4af9ff');

      for (let i = 0; i < particleCount; i += 1) {
        const idx = i * 3;
        const spread = THREE.MathUtils.clamp(Number(emitterHint?.spread), 0.04, Math.PI);
        const baseDir = Math.atan2(Number(emitterHint?.direction?.z || -1), Number(emitterHint?.direction?.x || 0));
        const a = baseDir + (Math.random() - 0.5) * spread;
        const ring = radius * (0.55 + Math.random() * 0.75);
        const yJitter = (Math.random() - 0.5) * (0.5 + safeLevel * 0.08);
        positions[idx] = Math.cos(a) * ring;
        positions[idx + 1] = yJitter;
        positions[idx + 2] = Math.sin(a) * ring;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color,
        size: Math.min(0.26, Math.max(0.05, Number(emitterHint?.sizeStart) || (0.08 + safeLevel * 0.012))),
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geo, mat);
      points.userData = Object.assign({}, points.userData, {
        kind: 'installation-particles',
        pulsePhase: Math.random() * Math.PI * 2,
        spinRate: THREE.MathUtils.clamp(0.08 + (Number(emitterHint?.speed) || 5) * 0.02, 0.12, 0.52),
        vfxEmitterId: String(emitterHint?.id || ''),
      });
      if (Array.isArray(emitterHint?.position) && emitterHint.position.length === 3) {
        points.position.set(
          Number(emitterHint.position[0]) || 0,
          Number(emitterHint.position[1]) || 0,
          Number(emitterHint.position[2]) || 0,
        );
      }
      return points;
    }

    _deriveInstallationEmitterHint(resolvedVfx) {
      const emitters = Array.isArray(resolvedVfx?.emitters) ? resolvedVfx.emitters : [];
      if (!emitters.length) return null;

      const preferred = emitters.find((e) => String(e?.kind || '').toLowerCase() === 'thruster')
        || emitters.find((e) => String(e?.kind || '').toLowerCase() === 'trail')
        || emitters[0];
      if (!preferred || typeof preferred !== 'object') return null;

      const direction = Array.isArray(preferred.direction) ? preferred.direction : [0, 0, -1];
      const position = Array.isArray(preferred.position) ? preferred.position : [0, 0, 0];
      return {
        id: preferred.id,
        kind: preferred.kind,
        count: Number(preferred.count),
        speed: Number(preferred.speed),
        spread: Number(preferred.spread),
        sizeStart: Number(preferred.sizeStart),
        colorStart: Number(preferred.colorStart),
        direction,
        position,
      };
    }

    _extractModelAnimations(type) {
      const registry = window.__GQ_ModelRegistry;
      if (!registry?.hasCached(type) || typeof registry.getAnimations !== 'function') {
        return [];
      }
      return registry.getAnimations(type);
    }

    _modelAnimStateForType(type, level) {
      const t = String(type || '').toLowerCase();
      const l = Math.max(1, Number(level || 1));

      if (t === 'jump_inhibitor') return 'alert';
      if (t === 'deep_space_radar' || t === 'relay_station') return 'active';
      if (t === 'stargate' || t === 'space_station') return l >= 3 ? 'active' : 'idle';
      return 'idle';
    }

    _installationDynamicAnimState(entry) {
      const baseState = this._modelAnimStateForType(entry?.install?.type, entry?.install?.level);
      const sensitivity = this._installationThreatSensitivity(entry);
      const threat = this._installationThreatProfile(entry, sensitivity);
      if (threat.score >= sensitivity.alertThreshold) return 'alert';
      if (threat.score >= sensitivity.activeThreshold && baseState !== 'alert') return 'active';

      const hasTraffic = this._installationHasTraffic(entry);
      if (hasTraffic && baseState === 'idle') return 'active';

      return baseState;
    }

    _installationThreatSensitivity(entry) {
      const type = String(entry?.install?.type || entry?.mesh?.userData?.installType || '').toLowerCase();
      switch (type) {
        case 'jump_inhibitor':
          return {
            activeThreshold: 1,
            alertThreshold: 2,
            attackWeight: 3,
            spyWeight: 1,
            colonizeWeight: 0,
            attackPackBonus: 2,
            reconPackBonus: 1,
          };
        case 'deep_space_radar':
          return {
            activeThreshold: 1,
            alertThreshold: 3,
            attackWeight: 3,
            spyWeight: 1,
            colonizeWeight: 1,
            attackPackBonus: 1,
            reconPackBonus: 1,
          };
        case 'space_station':
          return {
            activeThreshold: 2,
            alertThreshold: 3,
            attackWeight: 3,
            spyWeight: 1,
            colonizeWeight: 1,
            attackPackBonus: 1,
            reconPackBonus: 1,
          };
        case 'relay_station':
          return {
            activeThreshold: 2,
            alertThreshold: 4,
            attackWeight: 3,
            spyWeight: 1,
            colonizeWeight: 1,
            attackPackBonus: 1,
            reconPackBonus: 1,
          };
        case 'stargate':
          return {
            activeThreshold: 2,
            alertThreshold: 4,
            attackWeight: 3,
            spyWeight: 1,
            colonizeWeight: 1,
            attackPackBonus: 1,
            reconPackBonus: 1,
          };
        default:
          return {
            activeThreshold: 1,
            alertThreshold: 3,
            attackWeight: 3,
            spyWeight: 1,
            colonizeWeight: 1,
            attackPackBonus: 1,
            reconPackBonus: 1,
          };
      }
    }

    _installationHasTraffic(entry) {
      const pos = Number(entry?.position || entry?.install?.position || 0);
      if (!pos) return false;
      return this.systemFleetEntries.some((fleetEntry) => {
        const fleet = fleetEntry?.fleet || {};
        const origin = Number(fleet.origin_position || 0);
        const target = Number(fleet.target_position || 0);
        return origin === pos || target === pos;
      });
    }

    _installationThreatProfile(entry, sensitivity = null) {
      const owner = String(entry?.owner || entry?.install?.owner || '');
      const pos = Number(entry?.position || entry?.install?.position || 0);
      const s = sensitivity || this._installationThreatSensitivity(entry);
      let score = 0;
      let attackCount = 0;
      let reconCount = 0;

      this.systemFleetEntries.forEach((fleetEntry) => {
        const fleet = fleetEntry?.fleet || {};
        const mission = String(fleet.mission || '').toLowerCase();
        const missionWeight = this._fleetThreatWeight(mission, s);
        if (missionWeight <= 0) return;

        const fleetOwner = String(fleet.owner || '');
        if (owner && fleetOwner && fleetOwner === owner) return;

        const target = Number(fleet.target_position || 0);
        const origin = Number(fleet.origin_position || 0);
        const touchesInstallation = (pos > 0 && target > 0 && target === pos)
          || (pos > 0 && origin > 0 && origin === pos);
        if (!touchesInstallation && pos > 0) return;

        if (mission === 'attack') attackCount += 1;
        if (mission === 'spy') reconCount += 1;

        score += missionWeight;
      });

      if (attackCount >= 2) score += Number(s.attackPackBonus || 0);
      if (reconCount >= 2) score += Number(s.reconPackBonus || 0);

      return { score, attackCount, reconCount };
    }

    _fleetThreatWeight(mission, sensitivity = null) {
      const s = sensitivity || {};
      const m = String(mission || '').toLowerCase();
      if (m === 'attack') return Number(s.attackWeight ?? 3);
      if (m === 'spy') return Number(s.spyWeight ?? 1);
      if (m === 'colonize') return Number(s.colonizeWeight ?? 1);
      return 0;
    }

    _syncInstallationAnimationStates(elapsed = 0) {
      const registry = window.__GQ_ModelRegistry;
      if (!registry || typeof registry.setAnimationState !== 'function') return;

      this.systemStarInstallationEntries.forEach((entry) => {
        if (!entry?.mesh) return;
        const nextState = this._installationDynamicAnimState(entry);
        const currentState = String(entry.animState || entry.mesh.userData?.animState || '');
        if (nextState === currentState) {
          if (nextState === 'alert' && elapsed >= Number(entry.burstCooldownUntil || 0)) {
            this._spawnInstallationBurstFx(entry, elapsed);
          }
          return;
        }

        registry.setAnimationState(entry.mesh, nextState);
        entry.animState = nextState;

        const particleMat = entry.installParticles?.material;
        if (!particleMat) return;
        if (nextState === 'alert') {
          particleMat.opacity = 0.5;
          particleMat.size = Math.max(0.12, Number(particleMat.size || 0.1) * 1.12);
        } else if (nextState === 'active') {
          particleMat.opacity = 0.34;
          particleMat.size = Math.max(0.1, Number(particleMat.size || 0.1) * 1.04);
        } else {
          particleMat.opacity = 0.22;
          particleMat.size = Math.max(0.08, Number(particleMat.size || 0.1) * 0.96);
        }

        if (nextState === 'alert') {
          this._spawnInstallationBurstFx(entry, elapsed);
        }
      });
    }

    _resolveInstallationThreatTarget(entry, out = null) {
      const target = out || new THREE.Vector3();
      if (!entry?.mesh || !Array.isArray(this.systemFleetEntries) || !this.systemFleetEntries.length) return null;

      const owner = String(entry.owner || entry.install?.owner || '');
      const installPos = new THREE.Vector3();
      entry.mesh.getWorldPosition(installPos);

      let best = null;
      let bestDist2 = Infinity;

      this.systemFleetEntries.forEach((fleetEntry) => {
        const fleet = fleetEntry?.fleet || {};
        const fleetOwner = String(fleet.owner || '');
        if (owner && fleetOwner && owner === fleetOwner) return;

        const mission = String(fleet.mission || '').toLowerCase();
        if (mission !== 'attack' && mission !== 'spy') return;
        if (!fleetEntry?.group) return;

        const fleetPos = new THREE.Vector3();
        fleetEntry.group.getWorldPosition(fleetPos);
        const dist2 = installPos.distanceToSquared(fleetPos);
        if (dist2 < bestDist2) {
          bestDist2 = dist2;
          best = fleetPos;
        }
      });

      if (!best) return null;
      target.copy(best);
      return target;
    }

    _syncInstallationWeaponFx(elapsed) {
      if (!Array.isArray(this.systemInstallationWeaponFxEntries) || !this.systemInstallationWeaponFxEntries.length) return;
      if (!this.systemInstallationWeaponFxGroup) return;

      // Update BeamEffect pool (Phase FX-3)
      if (this.beamEffect) {
        this.beamEffect.update(elapsed);
      }

      const localFrom = new THREE.Vector3();
      const localTo = new THREE.Vector3();
      const worldFrom = new THREE.Vector3();
      const worldTo = new THREE.Vector3();

      this.systemInstallationWeaponFxEntries.forEach((fxEntry, index) => {
        const installEntry = fxEntry?.installEntry;
        if (!installEntry?.mesh) return;

        const activeState = String(installEntry.animState || installEntry.mesh.userData?.animState || 'idle');
        const threat = this._resolveInstallationThreatTarget(installEntry, worldTo);
        const canFire = !!threat && activeState !== 'idle';
        
        // Cache world positions for potential BeamEffect usage
        if (fxEntry.sourceNode?.isObject3D) {
          fxEntry.sourceNode.getWorldPosition(worldFrom);
        } else {
          installEntry.mesh.getWorldPosition(worldFrom);
        }
        fxEntry.worldFrom = worldFrom.clone();
        fxEntry.worldTo = worldTo.clone();

        if (canFire && elapsed >= Number(fxEntry.nextFireAt || 0)) {
          this._triggerInstallationWeaponFire(fxEntry, elapsed, activeState);
        }

        const shouldRender = canFire && elapsed <= Number(fxEntry.fireUntil || 0);
        
        // Fallback: update THREE.Line if BeamEffect is unavailable
        const line = fxEntry?.line;
        const headMesh = fxEntry?.headMesh;
        const profile = fxEntry?.profile || this._installationWeaponFxProfile(fxEntry?.kind);
        
        if (line && line.geometry && line.material) {
          if (!shouldRender) {
            line.visible = false;
            if (headMesh) headMesh.visible = false;
            return;
          }

          this.systemInstallationWeaponFxGroup.worldToLocal(localFrom.copy(worldFrom));
          this.systemInstallationWeaponFxGroup.worldToLocal(localTo.copy(worldTo));

          const travelSpeed = Number(profile?.travelSpeed || 0);
          const travelT = travelSpeed > 0
            ? ((elapsed * travelSpeed) + index * 0.173) % 1
            : 1;
          const headPos = localFrom.clone().lerp(localTo, travelT);

          const posAttr = line.geometry.getAttribute('position');
          if (posAttr && posAttr.count >= 2) {
            const drawTo = profile?.drawsTrailToSource ? headPos : localTo;
            posAttr.setXYZ(0, localFrom.x, localFrom.y, localFrom.z);
            posAttr.setXYZ(1, drawTo.x, drawTo.y, drawTo.z);
            posAttr.needsUpdate = true;
            line.geometry.computeBoundingSphere();
          }

          const baseAlpha = Number(line.userData?.baseAlpha || 0.8);
          const pulseOffset = Number(line.userData?.pulseOffset || 0);
          const pulseFreq = Number(profile?.pulseFreq || 11);
          const pulseMin = Number(profile?.pulseMin || 0.35);
          const pulseMax = Number(profile?.pulseMax || 1.0);
          const pulse = pulseMin + (pulseMax - pulseMin) * (0.5 + 0.5 * Math.sin(elapsed * pulseFreq + pulseOffset + index * 0.31));
          const strobe = !!profile?.strobe;
          const strobeOn = strobe ? (Math.sin(elapsed * pulseFreq + pulseOffset) > -0.08) : true;
          line.material.opacity = THREE.MathUtils.clamp(baseAlpha * pulse, 0.08, 1);
          line.visible = strobe ? strobeOn : true;

          if (headMesh) {
            headMesh.position.copy(headPos);
            if (headMesh.material) {
              headMesh.material.opacity = THREE.MathUtils.clamp(baseAlpha * (0.65 + pulse * 0.45), 0.08, 1);
            }
            headMesh.visible = line.visible;
          }
        }
      });
    }

    _tickInstallationParticleFields(elapsed, dt) {
      (this.systemStarInstallationEntries || []).forEach((entry, index) => {
        const particles = entry?.installParticles;
        const mat = particles?.material;
        if (!particles || !mat) return;
        const phase = Number(particles.userData?.pulsePhase || 0);
        const spinRate = Number(particles.userData?.spinRate || 0.24);
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * (1.25 + index * 0.03) + phase);
        particles.rotation.y += dt * spinRate;
        particles.rotation.z = Math.sin(elapsed * 0.32 + phase) * 0.1;
        const base = entry?.animState === 'alert' ? 0.34 : (entry?.animState === 'active' ? 0.24 : 0.16);
        mat.opacity = THREE.MathUtils.clamp(base + pulse * 0.22, 0.12, 0.62);
      });
    }

    _tickInstallationBurstFx(_elapsed, dt) {
      if (!Array.isArray(this.systemInstallationBurstFxEntries) || !this.systemInstallationBurstFxEntries.length) return;
      for (let i = this.systemInstallationBurstFxEntries.length - 1; i >= 0; i -= 1) {
        const burst = this.systemInstallationBurstFxEntries[i];
        const material = burst?.material;
        if (!burst || !material) {
          this.systemInstallationBurstFxEntries.splice(i, 1);
          continue;
        }

        burst.userData.age = Number(burst.userData.age || 0) + dt;
        const duration = Math.max(0.01, Number(burst.userData.duration || 0.2));
        const t = THREE.MathUtils.clamp(burst.userData.age / duration, 0, 1);
        const fadeBase = Number(burst.userData.fadeBase || 0.9);
        material.opacity = THREE.MathUtils.clamp((1 - t) * fadeBase, 0, 1);
        const growRate = Number(burst.userData.growRate || 2);
        const s = 1 + t * growRate;
        burst.scale.setScalar(s);

        if (t >= 1) {
          if (burst.parent) burst.parent.remove(burst);
          burst.geometry?.dispose?.();
          burst.material?.dispose?.();
          this.systemInstallationBurstFxEntries.splice(i, 1);
        }
      }
    }

    // ── Ambient traffic ────────────────────────────────────────────────────────

    /**
     * Spawn ambient transport shuttles for colonies with a shipyard (level ≥ 2).
     * Shuttles circle their home planet in a loose orbit.
     */
    _buildAmbientTraffic(payload) {
      this.systemTrafficEntries = [];
      const planets = Array.isArray(payload?.planets) ? payload.planets : [];

      planets.forEach((slot) => {
        const pp = slot.player_planet;
        if (!pp) return;
        const facilities = Array.isArray(pp.orbital_facilities) ? pp.orbital_facilities : [];
        const shipyard   = facilities.find((f) => f.type === 'shipyard');
        if (!shipyard || shipyard.level < 2) return;

        const homeEntry = this.systemPlanetEntries.find((e) => Number(e.slot?.position) === Number(slot.position));
        if (!homeEntry) return;

        const numShuttles = Math.min(3, shipyard.level);
        const colorHex    = String(pp.owner_color || '#b7d98c');
        const color        = new THREE.Color(colorHex);

        for (let i = 0; i < numShuttles; i++) {
          const shuttleSeed = this._hashSeed(`${slot?.position || 0}:${shipyard.level}:${i}:${colorHex}`);
          const shuttleDescriptor = this._objectTextureDescriptor('ship', { ship_type: 'shuttle', owner: pp?.owner, idx: i }, color.getHex(), shuttleSeed, {
            variant: 'desert',
            roughness: 0.42,
            metalness: 0.58,
            glow: 0.22,
            clouds: 0,
            ice_caps: 0,
          });
          const shuttleBundle = this._objectTextureBundle('ship', shuttleDescriptor, color.getHex());
          const shuttle = new THREE.Group();
          const hull = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.45, 1.1, 7),
            this.materialFactory
              ? this.materialFactory.createFleetHullMaterial(color, shuttleBundle)
              : new THREE.MeshStandardMaterial({
                  color: shuttleBundle?.map ? 0xffffff : color,
                  map: shuttleBundle?.map || null,
                  bumpMap: shuttleBundle?.bumpMap || null,
                  bumpScale: shuttleBundle?.bumpMap ? 0.05 : 0,
                  emissive: color,
                  emissiveMap: shuttleBundle?.emissiveMap || null,
                  emissiveIntensity: 0.22,
                  roughness: 0.45,
                  metalness: 0.55,
                }),
          );
          hull.rotation.z = Math.PI / 2;
          shuttle.add(hull);
          const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.14, 6, 5),
            new THREE.MeshStandardMaterial({ color: 0xff9900, emissive: 0xff7700, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.6 }),
          );
          glow.position.set(-0.7, 0, 0);
          shuttle.add(glow);
          this.systemTrafficGroup.add(shuttle);

          this.systemTrafficEntries.push({
            mesh:      shuttle,
            homeEntry,
            orbitPhase:  (i / numShuttles) * Math.PI * 2,
            orbitRadius: (homeEntry.mesh.geometry?.parameters?.radius ?? 4) * 2.2 + i * 1.4,
            orbitSpeed:  0.45 + i * 0.08,
            tiltY:       (i % 2 === 0 ? 1 : -1) * (0.18 + i * 0.06),
          });
        }
      });
    }

    _buildFleetFormationEntry(fleet, index) {
      const group = new THREE.Group();
      const vessels = Array.isArray(fleet.vessels) ? fleet.vessels : [];
      const color = this._fleetColor(fleet.mission);
      let cursor = 0;
      vessels.slice(0, 5).forEach((vessel) => {
        const vesselType = String(vessel.ship_type || vessel.type || vessel.name || 'frigate');
        const sample = Math.max(1, Number(vessel.sample_count || Math.min(4, vessel.count || 1)));
        for (let i = 0; i < sample; i++) {
          const seed = this._vesselSeed(fleet, vesselType, index, cursor, i);
          const geometry = this._proceduralVesselGeometry(vesselType, seed);
          const descriptor = this._objectTextureDescriptor('ship', vessel, color, seed, {
            variant: 'desert',
            roughness: 0.38,
            metalness: 0.62,
            glow: 0.16,
            clouds: 0,
            ice_caps: 0,
          });
          const hullBundle = this._objectTextureBundle('ship', descriptor, color);
          const hullTex = hullBundle?.map || this._fleetHullTexture(color, seed);
          const hullMat = this.materialFactory
            ? this.materialFactory.createFleetHullMaterial(color, hullBundle || hullTex)
            : new THREE.MeshStandardMaterial({
                color,
                map: hullTex,
                bumpMap: hullBundle?.bumpMap || null,
                bumpScale: hullBundle?.bumpMap ? 0.06 : 0,
                emissive: color,
                emissiveMap: hullBundle?.emissiveMap || hullTex,
                emissiveIntensity: 0.18,
                roughness: 0.36,
                metalness: 0.48,
              });
          const mesh = new THREE.Mesh(
            geometry,
            hullMat
          );
          mesh.material.userData = Object.assign({}, mesh.material.userData, { sharedTexture: true });
          const row = Math.floor(cursor / 3);
          const col = cursor % 3;
          mesh.rotation.x = Math.PI / 2;
          mesh.rotation.z = ((seed % 17) - 8) * 0.006;
          mesh.position.set((col - 1) * 1.2, row * 0.45, (row % 2 === 0 ? 1 : -1) * 0.7);
          group.add(mesh);
          cursor += 1;
        }
      });
      if (!group.children.length) {
        const fallback = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 10, 10),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 })
        );
        group.add(fallback);
      }

      const headingMarker = new THREE.Group();
      headingMarker.visible = !!this.galaxyFleetVectorsVisible;
      const directionColor = this._fleetDirectionColor(fleet.mission);
      const headingColor = new THREE.Color(directionColor);
      const headingMat = new THREE.MeshStandardMaterial({
        color: directionColor,
        emissive: headingColor.clone().multiplyScalar(0.45),
        emissiveIntensity: 0.2,
        roughness: 0.42,
        metalness: 0.52,
      });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.9, 14), headingMat);
      cone.rotation.z = -Math.PI / 2;
      cone.position.x = 0.95;
      headingMarker.add(cone);

      const headingLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]);
      const headingLineMat = new THREE.LineBasicMaterial({
        color: directionColor,
        transparent: true,
        opacity: 0.9,
      });
      const headingLine = new THREE.Line(headingLineGeo, headingLineMat);
      headingLine.scale.x = 10;
      headingMarker.add(headingLine);
      group.add(headingMarker);

      this.systemFleetGroup.add(group);
      return {
        group,
        fleet,
        phase: index * 0.7,
        headingMarker,
        headingLine,
      };
    }

    _buildGalaxyFleetEntry(fleet, index) {
      if (!fleet || !this.galaxyFleetGroup) return null;
      const color = this._fleetColor(fleet.mission);
      const directionColor = this._fleetDirectionColor(fleet.mission);
      const pos = fleet.current_pos || {};
      const scale = 0.028;

      const current = new THREE.Vector3(
        (Number(pos.x) || 0) * scale,
        (Number(pos.z) || 0) * scale * 0.42,
        (Number(pos.y) || 0) * scale
      );
      const origin = new THREE.Vector3(
        (Number(fleet.origin_x_ly) || 0) * scale,
        (Number(fleet.origin_z_ly) || 0) * scale * 0.42,
        (Number(fleet.origin_y_ly) || 0) * scale
      );
      const target = new THREE.Vector3(
        (Number(fleet.target_x_ly) || 0) * scale,
        (Number(fleet.target_z_ly) || 0) * scale * 0.42,
        (Number(fleet.target_y_ly) || 0) * scale
      );

      const group = new THREE.Group();
      group.position.copy(current);

      const marker = new THREE.Group();
      marker.visible = !!this.galaxyFleetVectorsVisible;
      const coneMat = new THREE.MeshStandardMaterial({
        color: directionColor,
        emissive: new THREE.Color(directionColor).multiplyScalar(0.48),
        emissiveIntensity: 0.24,
        roughness: 0.35,
        metalness: 0.58,
      });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.55, 12), coneMat);
      cone.rotation.z = -Math.PI / 2;
      cone.position.x = 0.78;
      marker.add(cone);

      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: directionColor,
        transparent: true,
        opacity: 0.82,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.scale.x = 12;
      marker.add(line);

      group.add(marker);
      this.galaxyFleetGroup.add(group);

      return {
        group,
        fleet,
        phase: index * 0.51,
        headingMarker: marker,
        headingLine: line,
        origin,
        target,
      };
    }

    setGalaxyFleets(fleets = []) {
      if (!this.galaxyFleetGroup) return;
      this._clearGroup(this.galaxyFleetGroup);
      const source = Array.isArray(fleets) ? fleets : [];
      this.galaxyFleetEntries = source
        .map((fleet, index) => this._buildGalaxyFleetEntry(fleet, index))
        .filter(Boolean);
    }

    /**
     * Render FTL infrastructure overlays on the galaxy map.
     * Gates: rendered as colored line segments (cyan) between endpoint systems.
     * Resonance nodes: rendered as small glowing spheres (magenta).
     * @param {Array} gates    - Array of gate objects from API.ftlMap()
     * @param {Array} nodes    - Array of resonance node objects from API.ftlMap()
     */
    setFtlInfrastructure(gates = [], nodes = []) {
      if (!this.galaxyFtlGroup) return;
      this._clearGroup(this.galaxyFtlGroup);
      this.galaxyFtlEntries = [];

      // ── Gate lines ─────────────────────────────────────────────────────────
      // Shared geometry/material for gate endpoint markers (no clone duplication)
      const gateMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, opacity: 0.75, transparent: true });
      const gateMarkerGeo = new THREE.SphereGeometry(1.2, 8, 8);
      const gateMarkerMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
      for (const gate of (Array.isArray(gates) ? gates : [])) {
        const a = gate?.a;
        const b = gate?.b;
        if (!a || !b) continue;
        const pts = [
          new THREE.Vector3(Number(a.x) || 0, Number(a.y) || 0, Number(a.z) || 0),
          new THREE.Vector3(Number(b.x) || 0, Number(b.y) || 0, Number(b.z) || 0),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, gateMat);
        line.userData = { ftlType: 'gate', id: gate.id };
        this.galaxyFtlGroup.add(line);
        this.galaxyFtlEntries.push({
          kind: 'ftl-gate',
          object: line,
          gate,
          center: new THREE.Vector3(
            ((Number(a.x) || 0) + (Number(b.x) || 0)) * 0.5,
            ((Number(a.y) || 0) + (Number(b.y) || 0)) * 0.5,
            ((Number(a.z) || 0) + (Number(b.z) || 0)) * 0.5
          ),
        });

        // Small endpoint markers (shared geometry + material, individual positions)
        const mA = new THREE.Mesh(gateMarkerGeo, gateMarkerMat);
        mA.position.set(Number(a.x) || 0, Number(a.y) || 0, Number(a.z) || 0);
        mA.userData = Object.assign({}, mA.userData, { ftlType: 'gate-endpoint', id: gate.id, endpoint: 'a' });
        const mB = new THREE.Mesh(gateMarkerGeo, gateMarkerMat);
        mB.position.set(Number(b.x) || 0, Number(b.y) || 0, Number(b.z) || 0);
        mB.userData = Object.assign({}, mB.userData, { ftlType: 'gate-endpoint', id: gate.id, endpoint: 'b' });
        this.galaxyFtlGroup.add(mA, mB);
        this.galaxyFtlEntries.push(
          { kind: 'ftl-gate-endpoint', object: mA, gate, endpoint: 'a' },
          { kind: 'ftl-gate-endpoint', object: mB, gate, endpoint: 'b' }
        );
      }

      // ── Resonance nodes ───────────────────────────────────────────────────
      const nodeMat = new THREE.MeshBasicMaterial({ color: 0xff00cc });
      for (const node of (Array.isArray(nodes) ? nodes : [])) {
        const p = node?.pos;
        if (!p) continue;
        const geo = new THREE.SphereGeometry(1.5, 8, 8);
        const mesh = new THREE.Mesh(geo, nodeMat);
        mesh.position.set(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
        mesh.userData = { ftlType: 'node', id: node.id, cooldown: node.cooldown_remaining_s || 0 };
        this.galaxyFtlGroup.add(mesh);
        this.galaxyFtlEntries.push({ kind: 'ftl-node', object: mesh, node });
      }
    }

    setGalaxyFleetVectorsVisible(enabled) {
      this.galaxyFleetVectorsVisible = enabled !== false;
      if (this.galaxyFleetGroup) {
        this.galaxyFleetGroup.visible = this.galaxyFleetVectorsVisible;
      }
      if (Array.isArray(this.galaxyFleetEntries)) {
        this.galaxyFleetEntries.forEach((entry) => {
          if (entry?.headingMarker) entry.headingMarker.visible = this.galaxyFleetVectorsVisible;
        });
      }
      if (Array.isArray(this.systemFleetEntries)) {
        this.systemFleetEntries.forEach((entry) => {
          if (entry?.headingMarker) entry.headingMarker.visible = this.galaxyFleetVectorsVisible;
        });
      }
      return this.galaxyFleetVectorsVisible;
    }

    setSystemOrbitPathsVisible(enabled) {
      this.systemOrbitPathsVisible = enabled !== false;
      if (this.systemOrbitGroup && this.systemMode) {
        this.systemOrbitGroup.visible = this.systemOrbitPathsVisible;
      }
      this._updateSystemOrbitLineStates();
      return this.systemOrbitPathsVisible;
    }

    setSystemOrbitMarkersVisible(enabled) {
      this.systemOrbitMarkersVisible = enabled !== false;
      this._updateSystemOrbitLineStates();
      return this.systemOrbitMarkersVisible;
    }

    setSystemOrbitFocusOnly(enabled) {
      this.systemOrbitFocusOnly = enabled === true;
      this._updateSystemOrbitLineStates();
      return this.systemOrbitFocusOnly;
    }

    _vesselSeed(fleet, vesselType, fleetIndex, cursor, sampleIndex) {
      const base = String(fleet?.id || `${fleet?.origin_position || 0}-${fleet?.target_position || 0}`);
      const key = `${base}|${vesselType}|${fleetIndex}|${cursor}|${sampleIndex}`;
      let hash = 2166136261;
      for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    _proceduralVesselGeometry(vesselType, seed) {
      const familyRaw = String(vesselType || 'frigate').toLowerCase();
      const family = familyRaw.includes('destroyer') || familyRaw.includes('cruiser')
        ? 'heavy'
        : familyRaw.includes('fighter') || familyRaw.includes('interceptor')
          ? 'light'
          : familyRaw.includes('transport') || familyRaw.includes('cargo')
            ? 'cargo'
            : 'frigate';
      const k = `${family}:${seed % 11}`;
      const buildGeometry = () => {
        const noseLen = 0.58 + ((seed >>> 3) % 8) * 0.045;
        const midLen = 0.52 + ((seed >>> 7) % 7) * 0.04;
        const rearLen = 0.34 + ((seed >>> 12) % 6) * 0.03;
        const widthBase = family === 'heavy' ? 0.42 : family === 'cargo' ? 0.5 : family === 'light' ? 0.28 : 0.34;
        const heightBase = family === 'cargo' ? 0.34 : 0.24;
        const width = widthBase + ((seed >>> 17) % 6) * 0.028;
        const height = heightBase + ((seed >>> 21) % 5) * 0.02;

        const points = [];
        const x0 = 0;
        const x1 = noseLen;
        const x2 = noseLen + midLen;
        const x3 = noseLen + midLen + rearLen;
        points.push(new THREE.Vector3(x0, 0, 0));
        points.push(new THREE.Vector3(x1, height * 0.5, width * 0.55));
        points.push(new THREE.Vector3(x2, height, width));
        points.push(new THREE.Vector3(x3, height * 0.72, width * 0.78));
        points.push(new THREE.Vector3(x3 + 0.12, 0, 0));

        const hull = new THREE.LatheGeometry(points, 8);
        hull.rotateZ(Math.PI / 2);
        hull.scale(0.62, 0.62, 0.62);

        const geo = hull.toNonIndexed();
        const pos = geo.getAttribute('position');
        const arr = pos.array;
        const wingAmp = family === 'light' ? 0.18 : family === 'heavy' ? 0.12 : 0.08;
        for (let i = 0; i < arr.length; i += 3) {
          const x = arr[i];
          const y = arr[i + 1];
          const z = arr[i + 2];
          const taper = THREE.MathUtils.clamp((x + 0.3) / 1.8, 0, 1);
          arr[i + 2] = z + Math.sin((x * 5.4) + (seed % 31)) * wingAmp * taper * (Math.abs(y) > 0.12 ? 1 : 0.35);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        geo.userData = Object.assign({}, geo.userData, { sharedGeometry: true });
        return geo;
      };

      if (this.geometryManager) {
        return this.geometryManager.getVesselGeometry(k, buildGeometry, { family });
      }

      const cached = this.vesselGeometryCache.get(k);
      if (cached) return cached;
      const geo = buildGeometry();
      this.vesselGeometryCache.set(k, geo);
      if (this.vesselGeometryCache.size > 96) {
        const firstKey = this.vesselGeometryCache.keys().next().value;
        const firstGeo = this.vesselGeometryCache.get(firstKey);
        firstGeo?.dispose?.();
        this.vesselGeometryCache.delete(firstKey);
      }
      return geo;
    }

    _starSeed(star) {
      const key = `${star?.galaxy_index || 0}:${star?.system_index || 0}:${star?.spectral_class || 'G'}`;
      let hash = 2166136261;
      for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    _getProceduralTexture(key, size, drawFn) {
      if (!this.textureManager) return null;
      return this.textureManager.getProceduralTexture(key, size, drawFn);
    }

    _starSurfaceTexture(spectralClass, seed) {
      const cls = String(spectralClass || 'G').toUpperCase();
      const s = seed >>> 0;
      return this._getProceduralTexture(`star:${cls}:${s % 17}`, 192, (ctx, size) => {
        const c = new THREE.Color(this._spectralColorHex(cls));
        const warm = new THREE.Color(0xffc96a);
        const cool = new THREE.Color(0x8fb5ff);
        const mix = THREE.MathUtils.clamp(((s % 13) / 12), 0, 1);
        const a = c.clone().lerp(warm, 0.25 + mix * 0.25);
        const b = c.clone().lerp(cool, 0.18 + (1 - mix) * 0.22);

        const grad = ctx.createRadialGradient(size * 0.34, size * 0.30, size * 0.06, size * 0.5, size * 0.5, size * 0.66);
        grad.addColorStop(0, `rgb(${Math.round(a.r * 255)}, ${Math.round(a.g * 255)}, ${Math.round(a.b * 255)})`);
        grad.addColorStop(0.48, `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`);
        grad.addColorStop(1, `rgb(${Math.round(b.r * 255)}, ${Math.round(b.g * 255)}, ${Math.round(b.b * 255)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        ctx.globalAlpha = 0.16;
        for (let y = 0; y < size; y += 4) {
          const wave = Math.sin((y / size) * Math.PI * (4 + (s % 5))) * 0.5 + 0.5;
          ctx.fillStyle = `rgba(255, 240, 210, ${0.06 + wave * 0.14})`;
          ctx.fillRect(0, y, size, 2);
        }

        ctx.globalAlpha = 0.2;
        for (let i = 0; i < 180; i++) {
          const x = ((i * 73 + s) % size);
          const y = ((i * 37 + (s >>> 3)) % size);
          const r = 0.7 + ((i + (s % 9)) % 3);
          ctx.fillStyle = `rgba(255, ${210 + ((i + s) % 40)}, 120, ${0.08 + ((i % 7) * 0.015)})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
    }

    _fleetHullTexture(colorHex, seed) {
      const color = new THREE.Color(colorHex || 0x8fc4ff);
      const s = seed >>> 0;
      return this._getProceduralTexture(`fleet:${Math.round(color.r * 255)}:${Math.round(color.g * 255)}:${Math.round(color.b * 255)}:${s % 23}`, 128, (ctx, size) => {
        const dark = color.clone().multiplyScalar(0.35);
        const bright = color.clone().lerp(new THREE.Color(0xffffff), 0.55);
        const grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, `rgb(${Math.round(dark.r * 255)}, ${Math.round(dark.g * 255)}, ${Math.round(dark.b * 255)})`);
        grad.addColorStop(0.5, `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`);
        grad.addColorStop(1, `rgb(${Math.round(bright.r * 255)}, ${Math.round(bright.g * 255)}, ${Math.round(bright.b * 255)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Panel-like striping to break up smooth hull shading.
        ctx.globalAlpha = 0.25;
        for (let x = 0; x < size; x += 8) {
          const w = (x / 8 + (s % 5)) % 3 === 0 ? 2 : 1;
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.fillRect(x, 0, w, size);
        }
        ctx.globalAlpha = 0.2;
        for (let i = 0; i < 80; i++) {
          const y = ((i * 19 + s) % size);
          const h = ((i + s) % 2) + 1;
          ctx.fillStyle = 'rgba(16, 24, 36, 0.3)';
          ctx.fillRect(0, y, size, h);
        }
        ctx.globalAlpha = 1;
      });
    }

    _buildSystemSkyDome(star) {
      this._clearGroup(this.systemSkyGroup);
      this._clearGroup(this.systemBackdrop);
      this._buildSystemBackdrop(star);

      const starColor = new THREE.Color(this._spectralColorHex(star?.spectral_class));

      const nebulaVert = `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      const nebulaFrag = `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uOpacity;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        float noise3(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n = i.x + i.y * 157.0 + 113.0 * i.z;
          return mix(
            mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+157.0),hash(n+158.0),f.x),f.y),
            mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+270.0),hash(n+271.0),f.x),f.y),
            f.z);
        }
        void main() {
          vec3 d = normalize(vWorldPos);
          float t = uTime * 0.018;
          float n1 = noise3(d * 2.4 + vec3(t, t * 0.72, t * 0.53));
          float n2 = noise3(d * 5.1 + vec3(-t * 0.43, t * 0.91, t * 0.27));
          float n3 = noise3(d * 11.3 + vec3(t * 0.67, -t * 0.38, t * 0.88));
          float cloud = n1 * 0.50 + n2 * 0.32 + n3 * 0.18;
          cloud = smoothstep(0.32, 0.75, cloud);
          float rim = 1.0 - abs(dot(d, normalize(vNormal)));
          float alpha = cloud * (0.55 + rim * 0.45) * uOpacity;
          gl_FragColor = vec4(mix(uColorA, uColorB, cloud), alpha);
        }
      `;

      const layers = [
        {
          kind: 'system-sky-nebula-blue',
          colorA: starColor.clone().lerp(new THREE.Color(0x1a3a7c), 0.62),
          colorB: new THREE.Color(0x6ea8e8),
          baseOpacity: 0.13,
          rotY: 0,
          drift: { x: 0.00004, y: 0.00007, z: 0.000025 },
        },
        {
          kind: 'system-sky-nebula-red',
          colorA: new THREE.Color(0x5c1a0e),
          colorB: starColor.clone().lerp(new THREE.Color(0xff4a1a), 0.55),
          baseOpacity: 0.08,
          rotY: Math.PI * 0.61,
          drift: { x: -0.00003, y: 0.00005, z: -0.00002 },
        },
        {
          kind: 'system-sky-nebula-mid',
          colorA: new THREE.Color(0x0d1830),
          colorB: starColor.clone().lerp(new THREE.Color(0xc8e0ff), 0.30),
          baseOpacity: 0.09,
          rotY: Math.PI * 1.22,
          drift: { x: 0.00002, y: -0.000035, z: 0.00004 },
        },
      ];

      layers.forEach((desc) => {
        const uniforms = {
          uTime: { value: 0 },
          uColorA: { value: desc.colorA.clone() },
          uColorB: { value: desc.colorB.clone() },
          uOpacity: { value: desc.baseOpacity },
        };
        const mat = new THREE.ShaderMaterial({
          uniforms,
          vertexShader: nebulaVert,
          fragmentShader: nebulaFrag,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
        mesh.rotation.y = desc.rotY;
        mesh.frustumCulled = false;
        mesh.userData = {
          kind: desc.kind,
          colorA: desc.colorA.clone(),
          colorB: desc.colorB.clone(),
          baseOpacity: desc.baseOpacity,
          drift: desc.drift,
          align: 0,
        };
        this.systemSkyGroup.add(mesh);
      });
    }

    _buildSystemBackdrop(star) {
      if (!Array.isArray(this.stars) || !this.stars.length) return;
      const sx = Number(star.x_ly || 0);
      const sy = Number(star.y_ly || 0);
      const sz = Number(star.z_ly || 0);
      const nearby = this.stars
        .filter((candidate) => !(Number(candidate.galaxy_index || 0) === Number(star.galaxy_index || 0) && Number(candidate.system_index || 0) === Number(star.system_index || 0)))
        .map((candidate) => {
          const dx = Number(candidate.x_ly || 0) - sx;
          const dy = Number(candidate.y_ly || 0) - sy;
          const dz = Number(candidate.z_ly || 0) - sz;
          return { candidate, dx, dy, dz, dist2: dx * dx + dy * dy + dz * dz };
        })
        .sort((a, b) => a.dist2 - b.dist2)
        .slice(0, 80);

      if (!nearby.length) return;

      const positions = new Float32Array(nearby.length * 3);
      const colors = new Float32Array(nearby.length * 3);
      for (let i = 0; i < nearby.length; i++) {
        const item = nearby[i];
        const distance = Math.max(1, Math.sqrt(item.dist2));
        const dir = new THREE.Vector3(item.dx, item.dz * 0.42, item.dy).normalize();
        const radius = 230 + Math.sqrt(distance) * 20;
        const p = i * 3;
        positions[p + 0] = dir.x * radius;
        positions[p + 1] = dir.y * radius * 0.72;
        positions[p + 2] = dir.z * radius;
        const color = new THREE.Color(this._spectralColorHex(item.candidate.spectral_class));
        colors[p + 0] = color.r;
        colors[p + 1] = color.g;
        colors[p + 2] = color.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: 3.6,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.systemBackdrop.add(new THREE.Points(geo, mat));
    }

    exitSystemView(restoreGalaxy = true) {
      // Cancel pending refinement tasks
      if (this.systemRefinementTimeoutId) {
        clearTimeout(this.systemRefinementTimeoutId);
        this.systemRefinementTimeoutId = null;
      }
      this.systemRefinementQueue = [];
      this.systemRefinementInProgress = false;

      this.systemMode = false;
      this._syncInputContext();
      this.setLightRig('galaxy');
      this.systemSourceStar = null;
      this.systemPlanetEntries = [];
      this.systemMoonEntries = [];
      this.systemFacilityEntries = [];
      this.systemFleetEntries = [];
      this.systemStarInstallationEntries = [];
      this.systemInstallationWeaponFxEntries = [];
      this.systemInstallationBurstFxEntries = [];
      this.systemTrafficEntries = [];
      this.systemAtmosphereEntries = [];
      this.systemCloudEntries = [];
      this.systemHoverEntry = null;
      this.systemSelectedEntry = null;
      this.systemHoverObject = null;
      this.systemSelectedObject = null;
      this.systemOrbitSimulationBuffer = null;
      this.activeGpuOrbitVisuals = false;
      
      // Cleanup Phase 3: DebrisManager
      if (this.debrisManager) {
        this.debrisManager.clear();
        this.debrisManager = null;
      }
      
      // Cleanup Phase 3: BeamEffect pool
      if (this.beamEffect) {
        this.beamEffect.dispose?.();
        this.beamEffect = null;
      }
      
      if (this.renderFrames?.galaxy) this.renderFrames.galaxy.visible = true;
      if (this.renderFrames?.system) {
        this.renderFrames.system.visible = false;
        this.renderFrames.system.position.set(0, 0, 0);
      }
      if (this.systemOrigin) this.systemOrigin.set(0, 0, 0);
      if (this.systemGroup) this.systemGroup.visible = false;
      if (this.systemSkyGroup) this.systemSkyGroup.visible = false;
      if (this.systemBackdrop) this.systemBackdrop.visible = false;
      if (this.systemOrbitGroup) this.systemOrbitGroup.visible = false;
      if (this.systemBodyGroup) this.systemBodyGroup.visible = false;
      if (this.systemFacilityGroup) this.systemFacilityGroup.visible = false;
      if (this.systemFleetGroup) this.systemFleetGroup.visible = false;
      if (this.systemStarInstallationGroup) this.systemStarInstallationGroup.visible = false;
      if (this.systemInstallationWeaponFxGroup) this.systemInstallationWeaponFxGroup.visible = false;
      if (this.systemInstallationBurstFxGroup) this.systemInstallationBurstFxGroup.visible = false;
      if (this.systemTrafficGroup) this.systemTrafficGroup.visible = false;
      // Dispose of BeamEffect pool
      if (this.beamEffect) {
        this.beamEffect.dispose();
        this.beamEffect = null;
      }
      this._clearGroup(this.systemSkyGroup);
      this._clearGroup(this.systemBackdrop);
      this._clearGroup(this.systemOrbitGroup);
      this._clearGroup(this.systemBodyGroup);
      this._clearGroup(this.systemFacilityGroup);
      this._clearGroup(this.systemFleetGroup);
      this._clearGroup(this.systemStarInstallationGroup);
      this._clearGroup(this.systemInstallationWeaponFxGroup);
      this._clearGroup(this.systemInstallationBurstFxGroup);
      this._clearGroup(this.systemTrafficGroup);
      if (this.starPoints) this.starPoints.visible = true;
      if (this.coreStars) this.coreStars.visible = true;
      if (this.galacticCoreGroup) this.galacticCoreGroup.visible = true;
      if (this.halo) this.halo.visible = true;
      if (this.galaxyGlowGroup) this.galaxyGlowGroup.visible = true;
      if (this.grid) this.grid.visible = true;
      if (this.hoverMarker) this.hoverMarker.visible = false;
      if (this.selectionMarker) this.selectionMarker.visible = false;
      this._syncClusterAuraTransform();
      if (restoreGalaxy && this.starPoints) {
        this.autoFrameEnabled = true;
        this.camera.up.set(0, 1, 0);
        if (this.selectedIndex >= 0 && this.selectedIndex < this.visibleStars.length) {
          this.focusOnStar(this.visibleStars[this.selectedIndex], true);
        } else {
          this.fitCameraToStars(true, true);
        }
        const restoreFov = THREE.MathUtils.clamp(Number(this._preSystemFov || 58), 25, 100);
        this.camera.fov = restoreFov;
        this.camera.updateProjectionMatrix();
      }
    }

    enterSystemView(star, payload) {
      if (!star || !payload) {
        logEnterSystemDebug('enterSystemView:skip', {
          instanceId: this.instanceId,
          hasStar: !!star,
          hasPayload: !!payload,
        }, 'warn');
        return;
      }
      traceSystemRender('enterSystemView:input', summarizeSystemRenderPayloadMeta(star, payload));
      logEnterSystemDebug('enterSystemView:input', Object.assign({
        instanceId: this.instanceId,
        systemModeBefore: !!this.systemMode,
        selectedIndex: Number(this.selectedIndex || -1),
        visibleStars: Array.isArray(this.visibleStars) ? this.visibleStars.length : 0,
      }, summarizeSystemRenderPayloadMeta(star, payload)));
      const wasSystemMode = !!this.systemMode;
      this.exitSystemView(false);
      this.systemMode = true;
      // Initialize BeamEffect pool for instanced beam rendering (Phase FX-3)
      if (window.GQBeamEffect && typeof window.GQBeamEffect.BeamEffect === 'function') {
        this.beamEffect = new window.GQBeamEffect.BeamEffect({ maxBeams: 128 });
      } else {
        console.warn('[Galaxy3DRenderer] BeamEffect not available; beam rendering via THREE.Line');
        this.beamEffect = null;
      }
      
      // Initialize DebrisManager for advanced debris system (Phase FX-5)
      if (typeof DebrisManager === 'function' || window.DebrisManager) {
        const DebrisManagerClass = window.DebrisManager || DebrisManager;
        this.debrisManager = new DebrisManagerClass({
          debugLogging: false,
          damageDampenFactor: 1.0,
        });
        
        // Listen for debris destruction events
        this.debrisManager.on('state-changed', (debris, data) => {
          if (data.to === 'destroyed') {
            this._onDebrisDestroyed(debris);
          }
        });
      } else {
        if (!this._warnedMissingDebrisManager) {
          console.warn('[Galaxy3DRenderer] DebrisManager not available');
          this._warnedMissingDebrisManager = true;
        }
        this.debrisManager = null;
      }
      this._syncInputContext();
      this.systemSourceStar = star;
      if (this.renderFrames?.galaxy) this.renderFrames.galaxy.visible = true;
      if (this.renderFrames?.system) this.renderFrames.system.visible = true;
      if (this.systemGroup) this.systemGroup.visible = true;
      if (this.systemSkyGroup) this.systemSkyGroup.visible = true;
      if (this.systemBackdrop) this.systemBackdrop.visible = true;
      if (this.systemOrbitGroup) this.systemOrbitGroup.visible = this.systemOrbitPathsVisible !== false;
      if (this.systemBodyGroup) this.systemBodyGroup.visible = true;
      if (this.systemFacilityGroup) this.systemFacilityGroup.visible = true;
      if (this.systemFleetGroup) this.systemFleetGroup.visible = true;
      if (this.systemStarInstallationGroup) this.systemStarInstallationGroup.visible = true;
      if (this.systemInstallationWeaponFxGroup) this.systemInstallationWeaponFxGroup.visible = true;
      if (this.systemInstallationBurstFxGroup) this.systemInstallationBurstFxGroup.visible = true;
      if (this.systemTrafficGroup) this.systemTrafficGroup.visible = true;
      this.autoFrameEnabled = false;
      if (this.starPoints) this.starPoints.visible = true;
      if (this.coreStars) this.coreStars.visible = true;
      if (this.galacticCoreGroup) this.galacticCoreGroup.visible = true;
      if (this.halo) this.halo.visible = true;
      if (this.galaxyGlowGroup) this.galaxyGlowGroup.visible = true;
      if (this.grid) this.grid.visible = true;
      if (this.hoverMarker) this.hoverMarker.visible = false;
      if (this.selectionMarker) this.selectionMarker.visible = false;
      this._syncClusterAuraTransform();
      if (typeof this._buildSystemSkyDome === 'function') {
        this._buildSystemSkyDome(star);
      } else {
        console.warn('[GQ] _buildSystemSkyDome unavailable; continuing without sky dome');
      }

      // Phase 0: Fast baseline (orbits + star + flat-color planets + fleets)
      this._buildSystemPhase0(star, payload);

      // Queue Phases 1-3: Progressive texture & visual refinement (per-planet)
      this._queueSystemRefinement(star, payload);

      // Anchor the system frame at the star's current galaxy-rotated world position.
      // This decouples system-view objects from any ongoing galaxy-frame rotation.
      const systemOrigin = new THREE.Vector3();
      const starIdx = this.visibleStars ? this.visibleStars.indexOf(star) : -1;
      if (starIdx >= 0 && this._getStarWorldPosition) {
        this._getStarWorldPosition(starIdx, systemOrigin);
      } else {
        const scale = 0.028;
        const localFallback = new THREE.Vector3(
          (Number(star.x_ly) || 0) * scale,
          (Number(star.z_ly) || 0) * scale * 0.42,
          (Number(star.y_ly) || 0) * scale,
        );
        if (this.renderFrames?.galaxy) {
          systemOrigin.copy(this.renderFrames.galaxy.localToWorld(localFallback));
        } else {
          systemOrigin.copy(localFallback);
        }
      }
      if (this.renderFrames?.system) {
        this.renderFrames.system.position.copy(systemOrigin);
      }
      if (this.systemOrigin) this.systemOrigin.copy(systemOrigin);
      this.setLightRig('system', { star, systemOrigin });

      if (!wasSystemMode) {
        this._preSystemFov = Number(this.camera?.fov || this._preSystemFov || 58);
      }

      const fromTarget = this.controls.target.clone();
      const fromPos = this.camera.position.clone();
      const fromUp = this.camera.up.clone();
      const entryPose = this._buildSystemEntryCameraPose(systemOrigin, payload, fromTarget, fromPos);

      // Camera-only handoff: keep world stable and smoothly reframe the viewer.
      this.focusTarget = {
        fromTarget,
        toTarget: entryPose.toTarget,
        fromPos,
        toPos: entryPose.toPos,
        fromUp,
        toUp: entryPose.toUp,
        fromFov: Number(this.camera?.fov || 58),
        toFov: Number(entryPose.toFov),
        t: 0,
      };
      logEnterSystemDebug('enterSystemView:armed', {
        instanceId: this.instanceId,
        systemModeAfter: !!this.systemMode,
        focusTargetActive: !!this.focusTarget,
        systemOrigin: {
          x: Number(systemOrigin.x.toFixed(2)),
          y: Number(systemOrigin.y.toFixed(2)),
          z: Number(systemOrigin.z.toFixed(2)),
        },
        planetsBuilt: Array.isArray(this.systemPlanetEntries) ? this.systemPlanetEntries.length : 0,
        moonsBuilt: Array.isArray(this.systemMoonEntries) ? this.systemMoonEntries.length : 0,
        fleetsBuilt: Array.isArray(this.systemFleetEntries) ? this.systemFleetEntries.length : 0,
      });
    }

    _buildSystemEntryCameraPose(systemOrigin, payload, fromTarget, fromPos) {
      const target = systemOrigin.clone();
      const fromOffset = fromPos.clone().sub(fromTarget);
      const fromDistance = Math.max(1, fromOffset.length());
      const maxOrbitRadius = Math.max(46, ...((this.systemPlanetEntries || []).map((entry) => Number(entry?.orbitRadius || 0))));
      const desiredDistance = THREE.MathUtils.clamp(maxOrbitRadius * 1.55, 130, 390);
      const blendedDistance = THREE.MathUtils.clamp((fromDistance * 0.4) + (desiredDistance * 0.6), 120, 420);

      const planeNormal = this._estimateSystemPlaneNormal();
      if (planeNormal.dot(this.camera?.up || new THREE.Vector3(0, 1, 0)) < 0) planeNormal.multiplyScalar(-1);
      const fallbackForward = new THREE.Vector3(0.73, 0, 0.68).normalize();
      const currentForward = fromOffset.lengthSq() > 1e-6
        ? fromOffset.clone().normalize()
        : fallbackForward.clone();
      let planarForward = currentForward.clone().projectOnPlane(planeNormal);
      if (planarForward.lengthSq() < 1e-6) {
        planarForward = fallbackForward.clone().projectOnPlane(planeNormal);
      }
      planarForward.normalize();

      const verticalBias = THREE.MathUtils.clamp(0.3 + Math.min(0.18, maxOrbitRadius / 520), 0.28, 0.5);
      const toOffset = planarForward
        .multiplyScalar(blendedDistance)
        .add(planeNormal.clone().multiplyScalar(blendedDistance * verticalBias));

      const toTarget = target.clone();
      const toPos = target.clone().add(toOffset);
      const payloadPlanets = Array.isArray(payload?.planets) ? payload.planets.length : 0;
      const targetFov = THREE.MathUtils.clamp(
        this.systemEntryFov + Math.min(8, payloadPlanets * 0.22),
        42,
        64,
      );

      return {
        toTarget,
        toPos,
        toUp: planeNormal,
        toFov: targetFov,
      };
    }

    _estimateSystemPlaneNormal() {
      const fallback = new THREE.Vector3(0, 1, 0);
      if (!Array.isArray(this.systemPlanetEntries) || !this.systemPlanetEntries.length) return fallback;
      const normal = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const samples = Math.min(6, this.systemPlanetEntries.length);
      for (let i = 0; i < samples; i += 1) {
        const pivot = this.systemPlanetEntries[i]?.orbitPivot;
        if (!pivot || typeof pivot.getWorldQuaternion !== 'function') continue;
        pivot.getWorldQuaternion(q);
        normal.add(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
      }
      if (normal.lengthSq() < 1e-6) return fallback;
      return normal.normalize();
    }

    _visualOrbitAngularSpeed(periodMetric, minMetric) {
      const safePeriodMetric = Math.max(0.01, Number(periodMetric || minMetric || 1));
      const safeMinMetric = Math.max(0.01, Number(minMetric || 1));
      const relativePeriod = Math.max(1, safePeriodMetric / safeMinMetric);
      const minPeriodSeconds = Math.max(20, Number(this.minVisualOrbitPeriodSeconds || 60));
      const innerAngularSpeed = (Math.PI * 2) / minPeriodSeconds;
      return THREE.MathUtils.clamp(innerAngularSpeed / relativePeriod, 0.004, innerAngularSpeed);
    }

    _buildSystemPhase0(star, payload) {
      const starRadius = {
        O: 34, B: 30, A: 26, F: 22, G: 18, K: 15, M: 12,
      }[String(star.spectral_class || 'G').toUpperCase()] || 18;
      const starColor = this._spectralColorHex(star.spectral_class);
      const starSeed = this._starSeed(star);
      const starMap = this._starSurfaceTexture(star.spectral_class, starSeed);
      const starDescriptor = this._objectTextureDescriptor('star', star, starColor, starSeed, {
        variant: 'lava',
        glow: 0.9,
        banding: 0.36,
        clouds: 0,
        craters: 0.04,
        roughness: 0.36,
        metalness: 0.04,
      });
      const starBundle = this._objectTextureBundle('star', starDescriptor, starColor) || { map: starMap, emissiveMap: starMap };
      const starMaterial = this.materialFactory
        ? this.materialFactory.createStarMaterial(starColor, starBundle)
        : new THREE.MeshStandardMaterial({
            color: starBundle?.map ? 0xffffff : starColor,
            map: starBundle?.map || starMap,
            bumpMap: starBundle?.bumpMap || null,
            bumpScale: starBundle?.bumpMap ? 0.02 : 0,
            emissive: starColor,
            emissiveMap: starBundle?.emissiveMap || starMap,
            emissiveIntensity: 0.85,
            roughness: 0.4,
            metalness: 0.02,
          });
      const starMesh = new THREE.Mesh(
        new THREE.SphereGeometry(starRadius, 28, 28),
        starMaterial
      );
      starMesh.material.userData = Object.assign({}, starMesh.material.userData, { sharedTexture: true });
      const starCorona = this._buildStarCoronaShader(starColor, starRadius);
      starMesh.add(starCorona);
      this._registerAnimatedAtmosphere(starCorona, starCorona.userData || {});
      this._buildStarAtmosphereShells(starColor, starRadius).forEach((shell) => {
        starMesh.add(shell);
        this._registerAnimatedAtmosphere(shell, shell.userData || {});
      });
      this.systemBodyGroup.add(starMesh);

      const bodies = (payload.planets || [])
        .map((slot) => ({
          slot,
          body: slot.player_planet || slot.generated_planet || null,
        }))
        .filter((entry) => entry.body);
      const orbitBodies = bodies.slice().sort((a, b) => Number(a.body.semi_major_axis_au || 0) - Number(b.body.semi_major_axis_au || 0));
      traceSystemRender('buildSystemPhase0:orbitBodies', {
        starName: String(star?.name || star?.catalog_name || ''),
        payloadPlanets: Array.isArray(payload?.planets) ? payload.planets.length : 0,
        orbitBodies: orbitBodies.length,
      });
      const maxAu = Math.max(0.35, ...orbitBodies.map((entry, index) => Number(entry.body.semi_major_axis_au || (0.35 + index * 0.22))));
      const periodMetrics = orbitBodies.map((entry, index) => {
        const body = entry.body || {};
        const semiMajor = Number(body.semi_major_axis_au || (0.35 + index * 0.22));
        const periodDays = Number(body.orbital_period_days || 0);
        return periodDays > 0 ? periodDays : Math.pow(Math.max(0.12, semiMajor), 1.5);
      });
      const minPeriodMetric = Math.max(0.01, Math.min(...periodMetrics));

      this.systemPlanetEntries = orbitBodies.map((entry, index) => {
        const body = entry.body;
        const slot = entry.slot;
        const semiMajor = Number(body.semi_major_axis_au || (0.35 + index * 0.22));
        const orbitRadius = 34 + (semiMajor / maxAu) * 165;
        const eccentricity = THREE.MathUtils.clamp(Number(body.orbital_eccentricity ?? (0.03 + index * 0.012)), 0.0, 0.92);
        const orbitMinor = orbitRadius * Math.sqrt(1 - eccentricity * eccentricity);
        const phase = Number(body.polar_theta_rad);
        const periodMetric = Number(periodMetrics[index] || semiMajor || 1);
        const orbitPoints = this._buildOrbitCurvePoints(orbitRadius, orbitMinor, eccentricity);
        const orbitLine = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(orbitPoints),
          new THREE.LineBasicMaterial({ color: 0x31567c, transparent: true, opacity: 0.5 })
        );
        const orbitLeadMarker = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.9, 1.2 + index * 0.04), 10, 10),
          new THREE.MeshBasicMaterial({ color: 0x7ab8ee, transparent: true, opacity: 0.7 })
        );
        const orbitPivot = new THREE.Group();
        orbitPivot.rotation.x = Math.PI / 2 + ((index % 2 === 0 ? 1 : -1) * (0.05 + index * 0.012));
        orbitPivot.rotation.z = (index % 3 - 1) * (0.08 + index * 0.01);
        orbitPivot.rotation.y = index * 0.34;
        orbitPivot.add(orbitLine);
        orbitPivot.add(orbitLeadMarker);
        this.systemOrbitGroup.add(orbitPivot);

        const planetSize = this._planetSize(body, index, orbitRadius);
        const planetGeometry = new THREE.SphereGeometry(planetSize, 18, 18);
        const proxyMaterial = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        proxyMaterial.colorWrite = false;
        const mesh = new THREE.Mesh(planetGeometry, proxyMaterial);
        this.systemBodyGroup.add(mesh);

        const renderRoot = new THREE.Group();
        orbitPivot.add(renderRoot);

        // Phase 0: Use flat-color base material (no texture yet)
        const baseMaterial = new THREE.MeshStandardMaterial({
          color: this._planetColor(body?.planet_class),
          roughness: 0.82,
          metalness: 0.04,
        });
        const renderMesh = new THREE.Mesh(planetGeometry, baseMaterial);
        renderRoot.add(renderMesh);
        mesh.userData = {
          kind: 'planet',
          sourceStar: star,
          slot,
          body,
          orbitRadius,
          orbitMinor,
          payload,
          index,
          refinementPhase: 0, // Track which phase this planet is at
        };

        const ringMesh = this._planetRingMesh(body, planetSize, index);
        if (ringMesh) {
          renderMesh.add(ringMesh);
        }

        this._prepareGpuOrbitMaterials(renderMesh);

        return {
          mesh,
          renderMesh,
          renderRoot,
          slot,
          body,
          orbitIndex: index,
          orbitRadius,
          orbitMinor,
          orbitPivot,
          orbitLine,
          orbitLeadMarker,
          eccentricity,
          currentLocalPosition: new THREE.Vector3(),
          currentWorldPosition: new THREE.Vector3(),
          angle: Number.isFinite(phase) ? phase : (index / Math.max(1, orbitBodies.length)) * Math.PI * 2,
          speed: this._visualOrbitAngularSpeed(periodMetric, minPeriodMetric),
        };
      });

      this.systemMoonEntries = this._buildSystemMoonEntries();
      traceSystemRender('buildSystemPhase0:complete', {
        planetsBuilt: Array.isArray(this.systemPlanetEntries) ? this.systemPlanetEntries.length : 0,
        moonsBuilt: Array.isArray(this.systemMoonEntries) ? this.systemMoonEntries.length : 0,
        facilitiesBuilt: Array.isArray(this.systemFacilityEntries) ? this.systemFacilityEntries.length : 0,
        fleetsBuilt: Array.isArray(payload?.fleets_in_system) ? payload.fleets_in_system.length : 0,
      });

      this._rebuildOrbitSimulationBuffer();
      this._updateSystemOrbitTransforms(0);
      this.activeOrbitSimulationMode = this._resolveOrbitSimulationMode();

      // Phase 0: Add fleets now (not deferred)
      this.systemFacilityEntries = this.systemPlanetEntries
        .map((entry, index) => this._buildOrbitalFacilityEntry(entry, index))
        .filter(Boolean);

      this.systemFleetEntries = (Array.isArray(payload.fleets_in_system) ? payload.fleets_in_system : [])
        .map((fleet, index) => this._buildFleetFormationEntry(fleet, index));

      // Faction auras for colonised planets
      this.systemPlanetEntries.forEach((entry) => {
        const ownerColor = entry.body?.owner_color ?? entry.slot?.player_planet?.owner_color ?? null;
        if (ownerColor) this._buildPlanetFactionAura(entry, ownerColor);
      });

      // Initial orbit-line tinting (faction colour applied where available)
      this._updateSystemOrbitLineStates();

      // Star-orbit installations (stargates, relay stations, etc.)
      this._buildStarInstallations(star, payload);

      // Ambient shuttle traffic
      this._buildAmbientTraffic(payload);

      this._buildSystemBackdrop(star);
      this._syncSystemSkyDome(0);
    }

    _buildSystemMoonEntries() {
      if (!Array.isArray(this.systemPlanetEntries) || !this.systemPlanetEntries.length) return [];

      const moonEntries = [];
      this.systemPlanetEntries.forEach((parentEntry, planetIndex) => {
        const moons = Array.isArray(parentEntry.body?.moons) ? parentEntry.body.moons.filter(Boolean) : [];
        if (!moons.length) return;

        const parentRadius = Number(
          parentEntry.renderMesh?.geometry?.parameters?.radius
          || parentEntry.mesh?.geometry?.parameters?.radius
          || this._planetSize(parentEntry.body, planetIndex)
        );

        const moonPeriodMetrics = moons.map((moon, moonIndex) => {
          const periodDays = Number(moon?.orbital_period_days || 0);
          const axisParentR = Math.max(0.8, Number(moon?.semi_major_axis_parent_r || moon?.semi_major_axis || (2 + moonIndex * 1.35)));
          return periodDays > 0 ? periodDays : Math.pow(axisParentR, 1.5);
        });
        const minMoonPeriodMetric = Math.max(0.01, Math.min(...moonPeriodMetrics));

        moons.forEach((moon, moonIndex) => {
          const moonDiameter = Number(moon?.diameter || 0);
          const moonSize = moonDiameter > 0
            ? THREE.MathUtils.clamp(0.48 + moonDiameter / 6200, 0.52, Math.max(1.25, parentRadius * 0.32))
            : THREE.MathUtils.clamp(parentRadius * (0.13 + moonIndex * 0.025), 0.55, Math.max(1.15, parentRadius * 0.28));
          const axisParentR = Math.max(0.8, Number(moon?.semi_major_axis_parent_r || moon?.semi_major_axis || (2 + moonIndex * 1.35)));
          const orbitRadius = THREE.MathUtils.clamp(
            parentRadius * (1.7 + axisParentR * 0.36),
            parentRadius * 1.8 + moonSize * 1.8,
            Math.max(parentRadius * 6.8, parentRadius * 2.4 + 12)
          );
          const eccentricity = THREE.MathUtils.clamp(Number(moon?.orbital_eccentricity ?? (0.02 + moonIndex * 0.01)), 0, 0.92);
          const orbitMinor = orbitRadius * Math.sqrt(1 - eccentricity * eccentricity);
          const phase = Number(moon?.polar_theta_rad);
          const periodMetric = Number(moonPeriodMetrics[moonIndex] || 1);
          const orbitPoints = this._buildOrbitCurvePoints(orbitRadius, orbitMinor, eccentricity);
          const orbitLine = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(orbitPoints),
            new THREE.LineBasicMaterial({ color: 0x6f87aa, transparent: true, opacity: 0.32 })
          );
          const orbitLeadMarker = new THREE.Mesh(
            new THREE.SphereGeometry(Math.max(0.35, moonSize * 0.18), 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.58 })
          );
          const orbitPivot = new THREE.Group();
          orbitPivot.rotation.x = Math.PI / 2;
          orbitPivot.rotation.z = (moonIndex % 3 - 1) * 0.12;
          orbitPivot.rotation.y = planetIndex * 0.22 + moonIndex * 0.68;
          orbitPivot.add(orbitLine);
          orbitPivot.add(orbitLeadMarker);
          this.systemBodyGroup.add(orbitPivot);

          const moonGeometry = new THREE.SphereGeometry(moonSize, 14, 14);
          const moonColor = this._planetColor(moon?.planet_class || moon?.body_type || 'moon');
          const moonSeed = this._hashSeed(`${planetIndex}:${moonIndex}:${moon?.name || moon?.id || moon?.position || ''}`);
          const moonDescriptor = this._objectTextureDescriptor('moon', moon, moonColor, moonSeed, {
            variant: 'rocky',
            craters: 0.28,
            clouds: 0,
            glow: 0.05,
            roughness: 0.9,
            metalness: 0.02,
          });
          const moonBundle = this._objectTextureBundle('moon', moonDescriptor, moonColor);
          const moonMaterial = this.materialFactory
            ? this.materialFactory.createMoonMaterial(moonColor, moonBundle)
            : new THREE.MeshStandardMaterial({
                color: moonBundle?.map ? 0xffffff : moonColor,
                map: moonBundle?.map || null,
                bumpMap: moonBundle?.bumpMap || null,
                bumpScale: moonBundle?.bumpMap ? 0.06 : 0,
                emissiveMap: moonBundle?.emissiveMap || null,
                roughness: 0.88,
                metalness: 0.03,
              });
          const mesh = new THREE.Mesh(moonGeometry, moonMaterial);
          mesh.userData = {
            kind: 'moon',
            body: moon,
            parentEntry,
            moonIndex,
          };
          orbitPivot.add(mesh);

          moonEntries.push({
            mesh,
            renderMesh: mesh,
            body: moon,
            parentEntry,
            orbitPivot,
            orbitLine,
            orbitLeadMarker,
            orbitRadius,
            orbitMinor,
            eccentricity,
            currentLocalPosition: new THREE.Vector3(),
            currentWorldPosition: new THREE.Vector3(),
            angle: Number.isFinite(phase) ? phase : (moonIndex / Math.max(1, moons.length)) * Math.PI * 2,
            speed: this._visualOrbitAngularSpeed(periodMetric, minMoonPeriodMetric),
          });
        });
      });

      traceSystemRender('buildSystemMoonEntries:complete', {
        parentPlanets: this.systemPlanetEntries.length,
        moonsBuilt: moonEntries.length,
      });
      return moonEntries;
    }

    _queueSystemRefinement(star, payload) {
      if (!Array.isArray(this.systemPlanetEntries) || !this.systemPlanetEntries.length) return;

      // Queue one texture-gen task per planet
      this.systemRefinementQueue = this.systemPlanetEntries.map((entry, index) => ({
        phase: 1, // Texture generation
        entryIndex: index,
        entry,
        star,
        payload,
        slot: entry.slot,
        body: entry.body,
        mesh: entry.renderMesh || entry.mesh,
        delayMs: index * 50, // Stagger: planet 0 @ 0ms, planet 1 @ 50ms, etc.
      }));

      // Start processing
      this._processSystemRefinementQueue();
    }

    _processSystemRefinementQueue() {
      if (this.systemRefinementInProgress || !this.systemRefinementQueue.length) return;

      const task = this.systemRefinementQueue.shift();
      if (!task) return;

      this.systemRefinementInProgress = true;

      const runTask = () => {
        try {
          // Phase 1: Generate planet texture and apply
          const descriptor = this._planetTextureDescriptor(task.payload, task.slot, task.body, task.entryIndex);
          if (descriptor && this.textureManager) {
            const fallbackColor = this._planetColor(task.body?.planet_class);
            const material = this.textureManager.getPlanetMaterial(task.body, descriptor, fallbackColor);
            if (task.mesh && material) {
              task.mesh.material = material;
              this._prepareGpuOrbitMaterials(task.mesh);
              task.mesh.userData.refinementPhase = 1;
            }
          }

          // Phase 2: Add atmosphere shell
          const planetSize = this._planetSize(task.body, task.entryIndex);
          const atmosphereShell = this._planetAtmosphereShell(task.payload, task.slot, task.body, task.entryIndex, planetSize);
          if (atmosphereShell && task.mesh) {
            task.mesh.add(atmosphereShell);
            this._prepareGpuOrbitMaterials(atmosphereShell);
            this._registerAnimatedAtmosphere(atmosphereShell, {
              baseOpacity: atmosphereShell.material?.opacity ?? 0.12,
              pulseAmplitude: 0.02,
              pulseSpeed: 0.65 + task.entryIndex * 0.08,
              scaleAmplitude: 0.008,
              phase: task.entryIndex * 0.7,
            });
            task.mesh.userData.refinementPhase = 2;
          }

          // Phase 3: Add cloud shell
          const cloudShell = this._planetCloudShell(task.payload, task.slot, task.body, task.entryIndex, planetSize);
          if (cloudShell && task.mesh) {
            task.mesh.add(cloudShell);
            this._prepareGpuOrbitMaterials(cloudShell);
            this._registerAnimatedCloud(cloudShell, {
              baseOpacity: cloudShell.userData?.baseOpacity ?? cloudShell.material?.opacity ?? 0.18,
              rotationSpeed: cloudShell.userData?.rotationSpeed ?? (0.03 + task.entryIndex * 0.01),
              phase: task.entryIndex * 0.91,
            });
            task.mesh.userData.refinementPhase = 3;
          }

          this._setEntryGpuOrbitVisualState(task.entry, this.activeGpuOrbitVisuals === true);

          this.systemRefinementInProgress = false;

          // Process next task
          if (this.systemRefinementQueue.length) {
            const nextTask = this.systemRefinementQueue[0];
            this.systemRefinementTimeoutId = setTimeout(runTask, Math.max(0, nextTask.delayMs));
          }
        } catch (err) {
          console.error('[GQ] systemRefinement task failed:', err);
          this.systemRefinementInProgress = false;
          // Skip this task and continue
          if (this.systemRefinementQueue.length) {
            this.systemRefinementTimeoutId = setTimeout(runTask, 100);
          }
        }
      };

      this.systemRefinementTimeoutId = setTimeout(runTask, task.delayMs);
    }


    focusOnSystemPlanet(planetLike, smooth = true) {
      if (!this.systemMode || !planetLike) return;
      const targetPos = Number(planetLike.__slot?.position || planetLike.position || 0);
      const entry = this.systemPlanetEntries.find((item) => Number(item.slot?.position || item.body?.position || 0) === targetPos);
      if (!entry) return;

      this.systemSelectedEntry = entry;
      this._touchSelection('focus-system-planet');
      this._updateHoverMarker();

      const worldPos = this._getSystemPlanetWorldPosition(entry, new THREE.Vector3());
      const radius = Math.max(4, entry.mesh.geometry?.parameters?.radius || 4);
      const offset = new THREE.Vector3(radius * 3.2, radius * 1.6, radius * 4.6);

      if (!smooth) {
        this.controls.target.copy(worldPos);
        this.camera.position.copy(worldPos.clone().add(offset));
        this.controls.update();
        return;
      }

      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: worldPos.clone(),
        fromPos: this.camera.position.clone(),
        toPos: worldPos.clone().add(offset),
        t: 0,
      };
    }

    _bindEvents() {
      let boundByExternal = false;
      if (typeof this.rendererEvents?.bindEvents === 'function') {
        this.rendererEvents.bindEvents(this);
        boundByExternal = !!(this._onResizeBound || this._onMouseMove || this._onClick || this._onWheel);
      }
      if (!boundByExternal) {
        this._bindEventsFallback();
      }
    }

    _bindEventsFallback() {
      if (window.GQCanvasInputController && this.renderer?.domElement) {
        const supportsSemanticInput = typeof this._resolveInputActions === 'function'
          && typeof this._handleInputAction === 'function';
        const actionResolverProfiles = supportsSemanticInput
          ? {
              galaxy: (ctx, phase) => this._resolveInputActions(ctx, phase, 'galaxy'),
              system: (ctx, phase) => this._resolveInputActions(ctx, phase, 'system'),
              planetApproach: (ctx, phase) => this._resolveInputActions(ctx, phase, 'planetApproach'),
              colonySurface: (ctx, phase) => this._resolveInputActions(ctx, phase, 'colonySurface'),
              objectApproach: (ctx, phase) => this._resolveInputActions(ctx, phase, 'objectApproach'),
            }
          : null;
        this._inputController = new window.GQCanvasInputController({
          surface: this.renderer.domElement,
          container: this.container,
          keyboardTarget: window,
          windowTarget: window,
          context: this._getInputContext(),
          captureWheel: true,
          enabled: this.interactive !== false,
          resolveActionsByContext: actionResolverProfiles,
          resolveActions: supportsSemanticInput ? ((ctx, phase, contextName) => this._resolveInputActions(ctx, phase, contextName)) : null,
          onAction: supportsSemanticInput ? ((action, ctx) => this._handleInputAction(action, ctx)) : null,
          onResize: () => this._onResize(),
          onPointerMove: (ctx) => this._handlePointerMove(ctx.nativeEvent, ctx),
          onPointerDown: supportsSemanticInput ? null : ((ctx) => this._handleMouseDown(ctx.nativeEvent, ctx)),
          onPointerUp: supportsSemanticInput ? null : ((ctx) => this._handleMouseUp(ctx.nativeEvent, ctx)),
          onPointerCancel: supportsSemanticInput ? null : ((ctx) => this._handleMouseUp(ctx.nativeEvent, ctx)),
          onClick: (ctx) => this._handleClick(ctx.nativeEvent, ctx),
          onDoubleClick: (ctx) => this._handleDoubleClick(ctx.nativeEvent, ctx),
          onWheel: supportsSemanticInput ? null : ((ctx) => this._handleWheel(ctx.nativeEvent, ctx)),
          onContextMenu: (ctx) => this._handleContextMenu ? this._handleContextMenu(ctx.nativeEvent, ctx) : false,
          onKeyDown: supportsSemanticInput ? null : ((ctx) => this._handleKeyDown(ctx.nativeEvent, ctx)),
          onKeyUp: supportsSemanticInput ? null : ((ctx) => this._handleKeyUp(ctx.nativeEvent, ctx)),
        });
        this._inputController.bind();
        if (!this.interactive) {
          this.renderer.domElement.style.pointerEvents = 'none';
        }
        return;
      }

      this._onResizeBound = this._onResizeBound || (() => this._onResize());
      window.addEventListener('resize', this._onResizeBound);

      if (this.interactive) {
        this._onMouseMove = this._onMouseMove || ((e) => this._handlePointerMove(e));
        this._onClick = this._onClick || ((e) => this._handleClick(e));
        this._onDoubleClick = this._onDoubleClick || ((e) => this._handleDoubleClick(e));
        this._onMouseDown = this._onMouseDown || ((e) => this._handleMouseDown(e));
        this._onMouseUp = this._onMouseUp || (() => this._handleMouseUp());
        this._onContextMenu = this._onContextMenu || ((e) => { if (this._handleContextMenu) this._handleContextMenu(e); });
        this._onWheel = this._onWheel || ((e) => this._handleWheel(e));
        this._onKeyDown = this._onKeyDown || ((e) => this._handleKeyDown(e));
        this._onKeyUp = this._onKeyUp || ((e) => this._handleKeyUp(e));

        this.renderer.domElement.addEventListener('mousemove', this._onMouseMove);
        this.renderer.domElement.addEventListener('click', this._onClick);
        this.renderer.domElement.addEventListener('dblclick', this._onDoubleClick);
        this.renderer.domElement.addEventListener('mousedown', this._onMouseDown);
        this.renderer.domElement.addEventListener('contextmenu', this._onContextMenu, { capture: true });
        window.addEventListener('mouseup', this._onMouseUp);
        this.renderer.domElement.addEventListener('wheel', this._onWheel, { passive: false });
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
      } else {
        this.renderer.domElement.style.pointerEvents = 'none';
      }

      if (typeof ResizeObserver !== 'undefined' && !this._containerResizeObserver) {
        try {
          this._containerResizeObserver = new ResizeObserver(() => {
            this._onResize();
          });
          this._containerResizeObserver.observe(this.container);
        } catch (_) {
          this._containerResizeObserver = null;
        }
      }
    }

    _computeAutoInputContext() {
      if (!this.systemMode) return 'galaxy';
      const dist = Number(this._cameraDistance?.() || 0);
      const planetThreshold = Math.max(18, Number(this.zoomThresholds?.systemEnterPlanet || 50));
      const colonyThreshold = Math.max(12, planetThreshold * 0.52);
      if (Number.isFinite(dist) && dist > 0) {
        if (dist <= colonyThreshold) return 'colonySurface';
        if (dist <= planetThreshold) return 'planetApproach';
      }
      return 'system';
    }

    _getInputContext() {
      return String(this._inputContextOverride || this._computeAutoInputContext());
    }

    _syncInputContext() {
      if (!this._inputController || typeof this._inputController.setContext !== 'function') return;
      this._inputController.setContext(this._getInputContext());
    }

    setInputContext(name) {
      const raw = String(name || '').trim();
      const normalized = raw
        .replace(/[\s_-]+/g, '')
        .toLowerCase();
      const mapping = {
        '': '',
        default: '',
        auto: '',
        galaxy: 'galaxy',
        system: 'system',
        planetapproach: 'planetApproach',
        colonysurface: 'colonySurface',
        objectapproach: 'objectApproach',
      };
      const next = Object.prototype.hasOwnProperty.call(mapping, normalized)
        ? mapping[normalized]
        : '';
      this._inputContextOverride = next;
      this._syncInputContext();
      return this._getInputContext();
    }

    _resolveInputActions(ctx, phase, inputContextHint = '') {
      const moduleApi = window.GQCoreInputContexts;
      if (moduleApi && typeof moduleApi.resolve === 'function') {
        return moduleApi.resolve(this, ctx, phase, inputContextHint);
      }
      const inputContext = String(inputContextHint || ctx?.inputContext || this._getInputContext());
      if (inputContext === 'system') {
        return this._resolveSystemInputActions(ctx, phase);
      }
      if (inputContext === 'planetApproach' || inputContext === 'colonySurface' || inputContext === 'objectApproach') {
        return this._resolveSystemInputActions(ctx, phase);
      }
      return this._resolveGalaxyInputActions(ctx, phase);
    }

    _resolveGalaxyInputActions(ctx, phase) {
      return this._resolveInputActionsCommon(ctx, phase, { allowSystemExit: false });
    }

    _resolveSystemInputActions(ctx, phase) {
      return this._resolveInputActionsCommon(ctx, phase, { allowSystemExit: true });
    }

    _resolveInputActionsCommon(ctx, phase, opts = {}) {
      const actions = [];
      const allowSystemExit = opts.allowSystemExit === true;
      const key = String(ctx?.key || '').toLowerCase();
      const active = phase === 'keydown';
      const dragButton = Number(ctx?.state?.drag?.button ?? -1);
      const keyTarget = ctx?.nativeEvent?.target || null;
      const tag = String(keyTarget?.tagName || '').toLowerCase();

      if ((phase === 'keydown' || phase === 'keyup') && (tag === 'input' || tag === 'textarea' || keyTarget?.isContentEditable)) {
        return actions;
      }

      if (phase === 'pointerdown') {
        if (ctx.button === 0) {
          actions.push({ type: 'camera.drag.begin', mode: this.hasExternalOrbitControls ? 'orbit-passive' : 'orbit', button: 0 });
        } else if (ctx.button === 1 || ctx.button === 2) {
          actions.push({ type: 'camera.drag.begin', mode: 'pan', button: ctx.button });
        }
      }

      if (phase === 'pointermove' && ctx?.state?.drag?.active) {
        if (dragButton === 1 || dragButton === 2) {
          actions.push({ type: 'camera.drag.move', mode: 'pan', button: dragButton });
        } else if (dragButton === 0 && !this.hasExternalOrbitControls) {
          actions.push({ type: 'camera.drag.move', mode: 'orbit', button: 0 });
        }
      }

      if ((phase === 'pointerup' || phase === 'pointercancel') && this._inputDragState?.active) {
        actions.push({
          type: 'camera.drag.end',
          mode: this._inputDragState.mode,
          button: this._inputDragState.button,
        });
      }

      if (phase === 'wheel') {
        actions.push({
          type: 'camera.zoom.step',
          direction: ctx.deltaY < 0 ? 'in' : 'out',
          factor: ctx.deltaY < 0 ? 0.88 : 1.14,
        });
      }

      if (phase === 'keydown' || phase === 'keyup') {
        if (key === 'escape' && active && allowSystemExit) actions.push({ type: 'ui.system.exit' });
        if (key === 'f' && active) actions.push({ type: 'camera.frame.fit' });
        if (key === 'r' && active) actions.push({ type: 'camera.frame.reset' });
        if (key === '+' || key === '=' || key === 'w') actions.push({ type: 'camera.zoom.hold', direction: 'in', active });
        if (key === '-' || key === 's') actions.push({ type: 'camera.zoom.hold', direction: 'out', active });
        if (key === 'a') actions.push({ type: 'camera.orbit.hold', direction: 'left', active });
        if (key === 'd') actions.push({ type: 'camera.orbit.hold', direction: 'right', active });
        if (key === 'e') actions.push({ type: 'camera.orbit.hold', direction: 'up', active });
        if (key === 'q') actions.push({ type: 'camera.orbit.hold', direction: 'down', active });
        if (key === 'arrowleft') actions.push({ type: 'camera.pan.hold', direction: 'left', active });
        if (key === 'arrowright') actions.push({ type: 'camera.pan.hold', direction: 'right', active });
        if (key === 'arrowup') actions.push({ type: 'camera.pan.hold', direction: 'up', active });
        if (key === 'arrowdown') actions.push({ type: 'camera.pan.hold', direction: 'down', active });
      }

      return actions;
    }

    _handleInputAction(action, ctx) {
      const moduleApi = window.GQCoreInputContexts;
      if (moduleApi && typeof moduleApi.handle === 'function') {
        moduleApi.handle(this, action, ctx);
        return;
      }
      if (!action || !action.type) return;

      switch (action.type) {
        case 'camera.drag.begin': {
          this.autoFrameEnabled = false;
          this.controls.dragging = true;
          this._inputDragState.active = true;
          this._inputDragState.button = Number(action.button ?? -1);
          this._inputDragState.mode = String(action.mode || '');
          this._inputDragState.startTarget = this.controls.target.clone();
          this._inputDragState.startPosition = this.camera.position.clone();
          this._inputDragState.startSpherical = new THREE.Spherical().setFromVector3(
            this.camera.position.clone().sub(this.controls.target)
          );
          break;
        }
        case 'camera.drag.move': {
          if (!this._inputDragState.active) return;
          this.autoFrameEnabled = false;
          if (action.mode === 'pan') {
            const width = Math.max(220, Number(this.renderer?.domElement?.clientWidth || 0));
            const panScale = Math.max(0.025, this._cameraDistance() / width);
            const startTarget = this._inputDragState.startTarget || this.controls.target.clone();
            const startPosition = this._inputDragState.startPosition || this.camera.position.clone();
            const dx = Number(ctx?.state?.drag?.deltaClientX || 0);
            const dy = Number(ctx?.state?.drag?.deltaClientY || 0);
            const nextTargetX = Number(startTarget.x || 0) - dx * panScale;
            const nextTargetZ = Number(startTarget.z || 0) + dy * panScale;
            const deltaX = nextTargetX - Number(this.controls.target.x || 0);
            const deltaZ = nextTargetZ - Number(this.controls.target.z || 0);
            this.controls.target.x = nextTargetX;
            this.controls.target.z = nextTargetZ;
            this.camera.position.x = Number(startPosition.x || 0) + (nextTargetX - Number(startTarget.x || 0));
            this.camera.position.z = Number(startPosition.z || 0) + (nextTargetZ - Number(startTarget.z || 0));
            if (typeof this.controls.update === 'function' && (Math.abs(deltaX) > 1e-6 || Math.abs(deltaZ) > 1e-6)) {
              this.controls.update();
            }
            break;
          }
          if (action.mode === 'orbit' && !this.hasExternalOrbitControls) {
            const startTarget = this._inputDragState.startTarget || this.controls.target.clone();
            const startSpherical = this._inputDragState.startSpherical || new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
            const dx = Number(ctx?.state?.drag?.deltaClientX || 0);
            const dy = Number(ctx?.state?.drag?.deltaClientY || 0);
            const spherical = new THREE.Spherical(startSpherical.radius, startSpherical.phi, startSpherical.theta);
            spherical.theta -= dx * 0.01;
            spherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15, spherical.phi + dy * 0.008));
            const offset = new THREE.Vector3().setFromSpherical(spherical);
            this.controls.target.copy(startTarget);
            this.camera.position.copy(startTarget.clone().add(offset));
            if (typeof this.controls.update === 'function') {
              this.controls.update();
            }
          }
          break;
        }
        case 'camera.drag.end': {
          this.controls.dragging = false;
          this._inputDragState.active = false;
          this._inputDragState.button = -1;
          this._inputDragState.mode = '';
          this._inputDragState.startTarget = null;
          this._inputDragState.startPosition = null;
          this._inputDragState.startSpherical = null;
          break;
        }
        case 'camera.zoom.step': {
          if (this.hasExternalOrbitControls) return;
          ctx?.nativeEvent?.preventDefault?.();
          this.autoFrameEnabled = false;
          this._lastZoomInputMs = performance.now();
          if (action.direction !== 'in') this._lastZoomOutInputMs = this._lastZoomInputMs;
          this._zoomTowardsTarget(Number(action.factor || 1));
          break;
        }
        case 'ui.system.exit': {
          const tag = String(ctx?.nativeEvent?.target?.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || ctx?.nativeEvent?.target?.isContentEditable) return;
          if (this.systemMode) {
            ctx?.nativeEvent?.preventDefault?.();
            this.exitSystemView(true);
          }
          break;
        }
        case 'camera.frame.fit': {
          ctx?.nativeEvent?.preventDefault?.();
          if (this.systemMode) this.exitSystemView(false);
          this.autoFrameEnabled = true;
          this.fitCameraToStars(true);
          break;
        }
        case 'camera.frame.reset': {
          ctx?.nativeEvent?.preventDefault?.();
          if (this.systemMode) this.exitSystemView(false);
          this.autoFrameEnabled = true;
          this.fitCameraToStars(false, true);
          break;
        }
        case 'camera.zoom.hold': {
          if (action.direction === 'in') this._kbdMove.forward = !!action.active;
          if (action.direction === 'out') this._kbdMove.back = !!action.active;
          break;
        }
        case 'camera.orbit.hold': {
          if (action.direction === 'left') this._kbdMove.left = !!action.active;
          if (action.direction === 'right') this._kbdMove.right = !!action.active;
          if (action.direction === 'up') this._kbdMove.up = !!action.active;
          if (action.direction === 'down') this._kbdMove.down = !!action.active;
          break;
        }
        case 'camera.pan.hold': {
          if (action.direction === 'left') this._kbdMove.panL = !!action.active;
          if (action.direction === 'right') this._kbdMove.panR = !!action.active;
          if (action.direction === 'up') this._kbdMove.panU = !!action.active;
          if (action.direction === 'down') this._kbdMove.panD = !!action.active;
          if (String(action.direction || '').startsWith('arrow')) {
            ctx?.nativeEvent?.preventDefault?.();
          }
          break;
        }
        default:
          break;
      }
    }

    _handleMouseDown(e) {
      this.autoFrameEnabled = false;
      this.controls.dragging = true;
    }

    _handleMouseUp() {
      this.controls.dragging = false;
    }

    _handleWheel(e) {
      if (this.hasExternalOrbitControls) return;
      e.preventDefault();
      this.autoFrameEnabled = false;
      this._lastZoomInputMs = performance.now();
      const zoomIn = e.deltaY < 0;
      if (!zoomIn) this._lastZoomOutInputMs = this._lastZoomInputMs;
      this._zoomTowardsTarget(zoomIn ? 0.88 : 1.14);
    }

    _handleKeyDown(e) {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      const k = String(e.key || '').toLowerCase();
      if (k === 'escape' && this.systemMode) {
        e.preventDefault();
        this.exitSystemView(true);
        return;
      }
      if (k === 'f') {
        e.preventDefault();
        if (this.systemMode) this.exitSystemView(false);
        this.autoFrameEnabled = true;
        this.fitCameraToStars(true);
        return;
      }
      if (k === 'r') {
        e.preventDefault();
        if (this.systemMode) this.exitSystemView(false);
        this.autoFrameEnabled = true;
        this.fitCameraToStars(false, true);
        return;
      }
      if (k === '+' || k === '=') { e.preventDefault(); this._kbdMove.forward = true; }
      if (k === '-') { e.preventDefault(); this._kbdMove.back = true; }
      if (k === 'w') this._kbdMove.forward = true;
      if (k === 's') this._kbdMove.back = true;
      if (k === 'a') this._kbdMove.left = true;
      if (k === 'd') this._kbdMove.right = true;
      if (k === 'q') this._kbdMove.down = true;
      if (k === 'e') this._kbdMove.up = true;
      if (k === 'arrowleft') { e.preventDefault(); this._kbdMove.panL = true; }
      if (k === 'arrowright') { e.preventDefault(); this._kbdMove.panR = true; }
      if (k === 'arrowup') { e.preventDefault(); this._kbdMove.panU = true; }
      if (k === 'arrowdown') { e.preventDefault(); this._kbdMove.panD = true; }
    }

    _handleKeyUp(e) {
      const k = String(e.key || '').toLowerCase();
      if (k === '+' || k === '=') this._kbdMove.forward = false;
      if (k === '-') this._kbdMove.back = false;
      if (k === 'w') this._kbdMove.forward = false;
      if (k === 's') this._kbdMove.back = false;
      if (k === 'a') this._kbdMove.left = false;
      if (k === 'd') this._kbdMove.right = false;
      if (k === 'q') this._kbdMove.down = false;
      if (k === 'e') this._kbdMove.up = false;
      if (k === 'arrowleft') this._kbdMove.panL = false;
      if (k === 'arrowright') this._kbdMove.panR = false;
      if (k === 'arrowup') this._kbdMove.panU = false;
      if (k === 'arrowdown') this._kbdMove.panD = false;
    }

    _orbitAroundTarget(yawDelta, pitchDelta) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += yawDelta;
      spherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15, spherical.phi + pitchDelta));
      offset.setFromSpherical(spherical);
      this.camera.position.copy(this.controls.target.clone().add(offset));
    }

    _zoomTowardsTarget(factor) {
      this._lastZoomInputMs = performance.now();
      if (Number(factor || 1) > 1.001) this._lastZoomOutInputMs = this._lastZoomInputMs;
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
      const dist = offset.length();
      if (dist < this.controls.minDistance) offset.setLength(this.controls.minDistance);
      if (dist > this.controls.maxDistance) offset.setLength(this.controls.maxDistance);
      this.camera.position.copy(this.controls.target.clone().add(offset));
    }

    nudgeZoom(direction = 'in') {
      this.autoFrameEnabled = false;
      this._zoomTowardsTarget(direction === 'out' ? 1.14 : 0.88);
      this.controls.update();
    }

    nudgeOrbit(direction = 'left') {
      this.autoFrameEnabled = false;
      if (direction === 'left') this._orbitAroundTarget(-0.055, 0);
      if (direction === 'right') this._orbitAroundTarget(0.055, 0);
      if (direction === 'up') this._orbitAroundTarget(0, -0.045);
      if (direction === 'down') this._orbitAroundTarget(0, 0.045);
      this.controls.update();
    }

    nudgePan(direction = 'left') {
      this.autoFrameEnabled = false;
      const amount = 6;
      const moveX = direction.includes('left') ? -amount : direction.includes('right') ? amount : 0;
      const moveZ = direction.includes('up') ? -amount : direction.includes('down') ? amount : 0;
      if (moveX !== 0) {
        this.controls.target.x += moveX;
        this.camera.position.x += moveX;
      }
      if (moveZ !== 0) {
        this.controls.target.z += moveZ;
        this.camera.position.z += moveZ;
      }
      this.controls.update();
    }

    nudgeRoll(direction = 'cw', stepRad = 0.05) {
      if (!this.camera || !this.controls) return;
      this.autoFrameEnabled = false;
      const viewDir = this.controls.target.clone().sub(this.camera.position);
      if (viewDir.lengthSq() < 1e-6) return;
      viewDir.normalize();
      const step = Math.max(0.005, Math.min(0.35, Number(stepRad || 0.05)));
      const delta = direction === 'ccw' ? -step : step;
      this.camera.up.applyAxisAngle(viewDir, delta).normalize();
      this.controls.update();
    }

    getZoomNorm() {
      if (!this.camera || !this.controls) return 0;
      const minD = Math.max(1, Number(this.controls.minDistance || 1));
      const maxD = Math.max(minD + 1, Number(this.controls.maxDistance || (minD + 1)));
      const dist = this.camera.position.distanceTo(this.controls.target);
      const t = (maxD - dist) / (maxD - minD);
      return THREE.MathUtils.clamp(t, 0, 1);
    }

    setZoomNorm(value) {
      if (!this.camera || !this.controls) return;
      this.autoFrameEnabled = false;
      const t = THREE.MathUtils.clamp(Number(value || 0), 0, 1);
      const minD = Math.max(1, Number(this.controls.minDistance || 1));
      const maxD = Math.max(minD + 1, Number(this.controls.maxDistance || (minD + 1)));
      const targetDist = maxD - t * (maxD - minD);
      const offset = this.camera.position.clone().sub(this.controls.target);
      if (offset.lengthSq() < 1e-6) {
        offset.set(0, targetDist * 0.5, targetDist);
      } else {
        offset.setLength(targetDist);
      }
      this.camera.position.copy(this.controls.target.clone().add(offset));
      this.controls.update();
    }

    getFov() {
      return Number(this.camera?.fov || 60);
    }

    setFov(degrees) {
      if (!this.camera) return;
      this.autoFrameEnabled = false;
      const next = THREE.MathUtils.clamp(Number(degrees || 60), 25, 100);
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
      this.controls?.update?.();
    }

    resetNavigationView() {
      this.autoFrameEnabled = true;
      if (this.systemMode) this.exitSystemView(false);
      this.fitCameraToStars(false, true);
      this.controls.update();
    }

    focusCurrentSelection() {
      this.autoFrameEnabled = false;
      if (this.systemMode && this.systemSelectedEntry) {
        this.focusOnSystemPlanet(this._planetPayload(this.systemSelectedEntry), true);
        return;
      }
      if (!this.systemMode && this.selectedClusterIndex >= 0) {
        this.focusOnCluster(this.selectedClusterIndex, true, { close: true });
        return;
      }
      if (!this.systemMode && this.selectedIndex >= 0) {
        this.focusOnStar(this.visibleStars[this.selectedIndex], true);
      }
    }

    fitCameraToStars(smooth = false, resetDirection = false) {
      if (this.systemMode) this.exitSystemView(false);
      if (!this.starPoints?.geometry?.boundingSphere) return;
      const bs = this.starPoints.geometry.boundingSphere;
      const center = bs.center.clone();
      // Transform galaxy-local bounding sphere center to world space.
      this.starPoints.localToWorld(center);
      const radius = Math.max(35, bs.radius);
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const hFov = 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect);
      const distV = radius / Math.tan(fov / 2);
      const distH = radius / Math.tan(hFov / 2);
      // resetDirection (initial view): tighter zoom to center; free pan: keep full coverage
      const distanceMult = resetDirection ? 0.72 : 1.22;
      const distance = Math.max(distV, distH) * distanceMult;

      const dir = this.camera.position.clone().sub(this.controls.target);
      // defaultViewDir: 30° elevation above the galactic plane, slight azimuth offset
      // elevation=30° → y=sin30°=0.5, xz-factor=cos30°≈0.866; azimuth≈35° in XZ
      const defaultViewDir = new THREE.Vector3(0.497, 0.500, 0.710).normalize();
      const n = resetDirection
        ? defaultViewDir
        : (dir.length() > 0.001 ? dir.normalize() : defaultViewDir);
      const targetPos = center.clone().add(n.multiplyScalar(distance));

      if (!smooth) {
        this.controls.target.copy(center);
        this.camera.position.copy(targetPos);
        this.controls.update();
        return;
      }

      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: center.clone(),
        fromPos: this.camera.position.clone(),
        toPos: targetPos,
        t: 0,
      };
    }

    _eventToNdc(e) {
      const now = performance.now();
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.prevPointerPx.copy(this.pointerPx);
      this.pointerPx.x = (e.clientX - rect.left);
      this.pointerPx.y = (e.clientY - rect.top);
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const dt = Math.max(1, now - Number(this._lastPointerEventTs || now));
      const dx = this.pointerPx.x - this.prevPointerPx.x;
      const dy = this.pointerPx.y - this.prevPointerPx.y;
      const speed = Math.sqrt(dx * dx + dy * dy) / dt;
      this._pointerSpeedPxPerMs = (this._pointerSpeedPxPerMs * 0.65) + (speed * 0.35);
      this._lastPointerEventTs = now;
    }

    _pointerIsSlow() {
      return Number(this._pointerSpeedPxPerMs || 0) <= 0.48;
    }

    _applyMagneticStarHover(currentIdx) {
      if (!this.hoverMagnetEnabled || this.systemMode) return currentIdx;
      if (this.selectedIndex < 0 || this.selectedIndex >= this.visibleStars.length) return currentIdx;
      if (!this._pointerIsSlow()) return currentIdx;

      const selectedScreen = this.getScreenPosition(this.selectedIndex);
      if (!selectedScreen) return currentIdx;
      const selectedRadius = this._starPickRadiusPx(this.selectedIndex) + this.hoverMagnetStarPx;
      if (!this._isWithinPickRadius(selectedScreen, selectedRadius)) return currentIdx;
      if (currentIdx < 0 || currentIdx === this.selectedIndex) return this.selectedIndex;

      const currentScreen = this.getScreenPosition(currentIdx);
      if (!currentScreen) return this.selectedIndex;
      const dSel2 = this._pixelDistanceSq(selectedScreen, this.pointerPx);
      const dCur2 = this._pixelDistanceSq(currentScreen, this.pointerPx);
      return dSel2 <= (dCur2 * 1.15) ? this.selectedIndex : currentIdx;
    }

    _applyMagneticSystemHover(currentEntry) {
      if (!this.hoverMagnetEnabled || !this.systemMode) return currentEntry;
      if (!this.systemSelectedEntry || !this._pointerIsSlow()) return currentEntry;

      const selectedWorld = this._getSystemPlanetWorldPosition(this.systemSelectedEntry, new THREE.Vector3());
      const selectedScreen = selectedWorld ? this.getWorldScreenPosition(selectedWorld) : null;
      if (!selectedScreen) return currentEntry;
      const selectedRadius = this._planetPickRadiusPx(this.systemSelectedEntry) + this.hoverMagnetPlanetPx;
      if (!this._isWithinPickRadius(selectedScreen, selectedRadius)) return currentEntry;
      if (!currentEntry || currentEntry === this.systemSelectedEntry) return this.systemSelectedEntry;

      const currentWorld = this._getSystemPlanetWorldPosition(currentEntry, new THREE.Vector3());
      const currentScreen = currentWorld ? this.getWorldScreenPosition(currentWorld) : null;
      if (!currentScreen) return this.systemSelectedEntry;

      const dSel2 = this._pixelDistanceSq(selectedScreen, this.pointerPx);
      const dCur2 = this._pixelDistanceSq(currentScreen, this.pointerPx);
      return dSel2 <= (dCur2 * 1.18) ? this.systemSelectedEntry : currentEntry;
    }

    _applyMagneticClusterHover(currentIdx) {
      if (!this.hoverMagnetEnabled || this.systemMode) return currentIdx;
      if (!this.clusterBoundsVisible) return currentIdx;
      if (this.selectedClusterIndex < 0 || !this._pointerIsSlow()) return currentIdx;

      const selectedEntry = this.clusterAuraEntries?.[this.selectedClusterIndex] || null;
      const selectedScreen = this._clusterWorldScreenPosition(selectedEntry);
      if (!selectedScreen) return currentIdx;
      const selectedRadius = this._clusterPickRadiusPx(selectedEntry) + this.hoverMagnetClusterPx;
      if (!this._isWithinPickRadius(selectedScreen, selectedRadius)) return currentIdx;
      if (currentIdx < 0 || currentIdx === this.selectedClusterIndex) return this.selectedClusterIndex;

      const currentEntry = this.clusterAuraEntries?.[currentIdx] || null;
      const currentScreen = this._clusterWorldScreenPosition(currentEntry);
      if (!currentScreen) return this.selectedClusterIndex;
      const dSel2 = this._pixelDistanceSq(selectedScreen, this.pointerPx);
      const dCur2 = this._pixelDistanceSq(currentScreen, this.pointerPx);
      return dSel2 <= (dCur2 * 1.16) ? this.selectedClusterIndex : currentIdx;
    }

    _resolveEntryByAnchor(entries, anchor, key = 'group') {
      if (!Array.isArray(entries) || !anchor) return null;
      let current = anchor;
      while (current) {
        const found = entries.find((entry) => entry && entry[key] === current);
        if (found) return found;
        current = current.parent || null;
      }
      return null;
    }

    _getSelectionWorldPosition(selection, out = new THREE.Vector3()) {
      if (!selection?.kind) return null;
      if (selection.kind === 'system-fleet') return selection.entry?.group?.getWorldPosition?.(out) || null;
      if (selection.kind === 'orbital-facility') return selection.entry?.group?.getWorldPosition?.(out) || null;
      if (selection.kind === 'star-installation') return selection.entry?.mesh?.getWorldPosition?.(out) || null;
      if (selection.kind === 'system-traffic') return selection.entry?.mesh?.getWorldPosition?.(out) || null;
      if (selection.kind === 'galaxy-fleet') return selection.entry?.group?.getWorldPosition?.(out) || null;
      if (selection.kind === 'ftl-node' || selection.kind === 'ftl-gate-endpoint') {
        return selection.entry?.object?.getWorldPosition?.(out) || null;
      }
      if (selection.kind === 'ftl-gate') {
        if (selection.entry?.center && this.galaxyFtlGroup?.localToWorld) {
          return this.galaxyFtlGroup.localToWorld(out.copy(selection.entry.center));
        }
      }
      return null;
    }

    _selectionPayload(selection) {
      if (!selection?.kind) return null;
      if (selection.kind === 'system-fleet') {
        return this._annotateSelectionPayload(Object.assign({ __kind: 'system_fleet' }, selection.entry?.fleet || {}), {
          kind: 'system_fleet',
          scope: 'system',
          mode: 'system',
        });
      }
      if (selection.kind === 'orbital-facility') {
        const slot = selection.entry?.entry?.slot || null;
        return this._annotateSelectionPayload({
          __kind: 'orbital_facility',
          __slot: slot,
          __sourceStar: this.systemSourceStar,
          count: Number(selection.entry?.entry?.slot?.player_planet?.orbital_facilities?.length || 0),
        }, {
          kind: 'orbital_facility',
          scope: 'system',
          mode: 'system',
        });
      }
      if (selection.kind === 'star-installation') {
        const install = selection.entry?.install || {};
        return this._annotateSelectionPayload(Object.assign({ __kind: 'star_installation' }, install), {
          kind: 'star_installation',
          scope: 'system',
          mode: 'system',
        });
      }
      if (selection.kind === 'system-traffic') {
        return this._annotateSelectionPayload({
          __kind: 'system_traffic',
          orbitRadius: Number(selection.entry?.orbitRadius || 0),
          orbitSpeed: Number(selection.entry?.orbitSpeed || 0),
        }, {
          kind: 'system_traffic',
          scope: 'system',
          mode: 'system',
        });
      }
      if (selection.kind === 'galaxy-fleet') {
        return this._annotateSelectionPayload(Object.assign({ __kind: 'galaxy_fleet' }, selection.entry?.fleet || {}), {
          kind: 'galaxy_fleet',
          scope: 'galaxy',
          mode: 'galaxy',
        });
      }
      if (selection.kind === 'ftl-node') {
        return this._annotateSelectionPayload(Object.assign({ __kind: 'ftl_node' }, selection.entry?.node || {}), {
          kind: 'ftl_node',
          scope: 'galaxy',
          mode: 'galaxy',
        });
      }
      if (selection.kind === 'ftl-gate' || selection.kind === 'ftl-gate-endpoint') {
        return this._annotateSelectionPayload(Object.assign({ __kind: 'ftl_gate', __endpoint: selection.entry?.endpoint || '' }, selection.entry?.gate || {}), {
          kind: 'ftl_gate',
          scope: 'galaxy',
          mode: 'galaxy',
        });
      }
      return null;
    }

    _selectionPickRadiusPx(selection) {
      if (!selection?.kind) return 16;
      if (selection.kind === 'system-fleet' || selection.kind === 'galaxy-fleet') return 24;
      if (selection.kind === 'orbital-facility' || selection.kind === 'star-installation') return 22;
      if (selection.kind === 'system-traffic') return 18;
      if (selection.kind === 'ftl-node' || selection.kind === 'ftl-gate-endpoint') return 20;
      if (selection.kind === 'ftl-gate') return 16;
      return 16;
    }

    _selectionScreenPosition(selection) {
      const worldPos = this._getSelectionWorldPosition(selection, new THREE.Vector3());
      if (!worldPos) return null;
      return this.getWorldScreenPosition(worldPos);
    }

    _pickSystemDynamicObject() {
      if (!this.systemMode) return null;
      const targets = [];
      (this.systemFleetEntries || []).forEach((entry) => {
        if (entry?.group) targets.push(entry.group);
      });
      (this.systemFacilityEntries || []).forEach((entry) => {
        if (entry?.group) targets.push(entry.group);
      });
      (this.systemStarInstallationEntries || []).forEach((entry) => {
        if (entry?.mesh) targets.push(entry.mesh);
      });
      (this.systemTrafficEntries || []).forEach((entry) => {
        if (entry?.mesh) targets.push(entry.mesh);
      });
      if (!targets.length) return null;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(targets, true);
      let best = null;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (const hit of hits.slice(0, 32)) {
        const obj = hit?.object;
        if (!obj) continue;
        const fleetEntry = this._resolveEntryByAnchor(this.systemFleetEntries, obj, 'group');
        const facilityEntry = fleetEntry ? null : this._resolveEntryByAnchor(this.systemFacilityEntries, obj, 'group');
        const installEntry = (fleetEntry || facilityEntry) ? null : this._resolveEntryByAnchor(this.systemStarInstallationEntries, obj, 'mesh');
        const trafficEntry = (fleetEntry || facilityEntry || installEntry) ? null : this._resolveEntryByAnchor(this.systemTrafficEntries, obj, 'mesh');
        const selection = fleetEntry
          ? { kind: 'system-fleet', scope: 'system', entry: fleetEntry }
          : facilityEntry
            ? { kind: 'orbital-facility', scope: 'system', entry: facilityEntry }
            : installEntry
              ? { kind: 'star-installation', scope: 'system', entry: installEntry }
              : trafficEntry
                ? { kind: 'system-traffic', scope: 'system', entry: trafficEntry }
              : null;
        if (!selection) continue;
        const screenPos = this._selectionScreenPosition(selection);
        const radiusPx = this._selectionPickRadiusPx(selection);
        if (!screenPos || !this._isWithinPickRadius(screenPos, radiusPx)) continue;
        const d2 = this._pixelDistanceSq(screenPos, this.pointerPx);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = selection;
        }
      }
      return best;
    }

    _pickGalaxyDynamicObject() {
      if (this.systemMode) return null;
      const targets = [];
      (this.galaxyFleetEntries || []).forEach((entry) => {
        if (entry?.group) targets.push(entry.group);
      });
      (this.galaxyFtlEntries || []).forEach((entry) => {
        if (entry?.object) targets.push(entry.object);
      });
      if (!targets.length) return null;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const prevLineThreshold = this.raycaster.params.Line?.threshold ?? 1;
      if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = 2.4;
      const hits = this.raycaster.intersectObjects(targets, true);
      if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = prevLineThreshold;

      let best = null;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (const hit of hits.slice(0, 32)) {
        const obj = hit?.object;
        if (!obj) continue;
        const fleetEntry = this._resolveEntryByAnchor(this.galaxyFleetEntries, obj, 'group');
        const ftlEntry = fleetEntry ? null : this._resolveEntryByAnchor(this.galaxyFtlEntries, obj, 'object');
        const selection = fleetEntry
          ? { kind: 'galaxy-fleet', scope: 'galaxy', entry: fleetEntry }
          : ftlEntry
            ? { kind: String(ftlEntry.kind || 'ftl-node'), scope: 'galaxy', entry: ftlEntry }
            : null;
        if (!selection) continue;
        const screenPos = this._selectionScreenPosition(selection);
        const radiusPx = this._selectionPickRadiusPx(selection);
        if (!screenPos || !this._isWithinPickRadius(screenPos, radiusPx)) continue;
        const d2 = this._pixelDistanceSq(screenPos, this.pointerPx);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = selection;
        }
      }
      return best;
    }

    _applyMagneticSystemObjectHover(currentSelection) {
      if (!this.hoverMagnetEnabled || !this.systemMode) return currentSelection;
      if (!this.systemSelectedObject || !this._pointerIsSlow()) return currentSelection;
      const selected = this.systemSelectedObject;
      const selectedScreen = this._selectionScreenPosition(selected);
      const selectedRadius = this._selectionPickRadiusPx(selected) + this.hoverMagnetPlanetPx;
      if (!selectedScreen || !this._isWithinPickRadius(selectedScreen, selectedRadius)) return currentSelection;
      if (!currentSelection) return selected;
      const currentScreen = this._selectionScreenPosition(currentSelection);
      if (!currentScreen) return selected;
      const dSel2 = this._pixelDistanceSq(selectedScreen, this.pointerPx);
      const dCur2 = this._pixelDistanceSq(currentScreen, this.pointerPx);
      return dSel2 <= (dCur2 * 1.16) ? selected : currentSelection;
    }

    _applyMagneticGalaxyObjectHover(currentSelection) {
      if (!this.hoverMagnetEnabled || this.systemMode) return currentSelection;
      if (!this.galaxySelectedObject || !this._pointerIsSlow()) return currentSelection;
      const selected = this.galaxySelectedObject;
      const selectedScreen = this._selectionScreenPosition(selected);
      const selectedRadius = this._selectionPickRadiusPx(selected) + this.hoverMagnetStarPx;
      if (!selectedScreen || !this._isWithinPickRadius(selectedScreen, selectedRadius)) return currentSelection;
      if (!currentSelection) return selected;
      const currentScreen = this._selectionScreenPosition(currentSelection);
      if (!currentScreen) return selected;
      const dSel2 = this._pixelDistanceSq(selectedScreen, this.pointerPx);
      const dCur2 = this._pixelDistanceSq(currentScreen, this.pointerPx);
      return dSel2 <= (dCur2 * 1.15) ? selected : currentSelection;
    }

    _pixelDistanceSq(a, b) {
      const dx = (a.x || 0) - (b.x || 0);
      const dy = (a.y || 0) - (b.y || 0);
      return dx * dx + dy * dy;
    }

    _isWithinPickRadius(screenPos, radiusPx) {
      if (!screenPos) return false;
      const d2 = this._pixelDistanceSq(screenPos, this.pointerPx);
      return d2 <= (radiusPx * radiusPx);
    }

    _starPickRadiusPx(index) {
      if (!this.starPoints || index < 0) return 10;
      const sizeAttr = this.starPoints.geometry?.getAttribute('aSize');
      const local = new THREE.Vector3();
      this._getStarWorldPosition(index, local);
      const dist = Math.max(1, this.camera.position.distanceTo(local));
      const baseSize = sizeAttr ? Number(sizeAttr.getX(index) || 0) : 6;
      const pointScale = (this.renderer?.getPixelRatio?.() || 1) * 92.0;
      const px = Math.max(2, (baseSize * pointScale) / dist);
      return THREE.MathUtils.clamp((px * 0.9) + 7, 7, 26);
    }

    _planetPickRadiusPx(entry) {
      if (!entry?.mesh) return 12;
      const radius = Math.max(3, Number(entry.mesh.geometry?.parameters?.radius || 4));
      const world = this._getSystemPlanetWorldPosition(entry, new THREE.Vector3());
      const dist = Math.max(1, this.camera.position.distanceTo(world));
      const px = (radius * (this.renderer?.getPixelRatio?.() || 1) * 170) / dist;
      return THREE.MathUtils.clamp(px + 10, 10, 34);
    }

    _getSystemPlanetScreenPosition(entry) {
      if (!entry) return null;
      return this.getWorldScreenPosition(this._getSystemPlanetWorldPosition(entry, new THREE.Vector3()));
    }

    _clusterPickRadiusPx(entry) {
      if (!entry?.group) return 18;
      const centerWorld = entry.group.getWorldPosition(new THREE.Vector3());
      const dist = Math.max(1, this.camera.position.distanceTo(centerWorld));
      const sizeLen = Math.max(8, Number(entry.size?.length?.() || 18));
      const px = (sizeLen * (this.renderer?.getPixelRatio?.() || 1) * 68) / dist;
      return THREE.MathUtils.clamp(px + 14, 14, 64);
    }

    _pickStar() {
      if (this.systemMode) return -1;
      if (!this.starPoints) return -1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const prevThreshold = this.raycaster.params.Points?.threshold ?? 8;
      const adaptiveThreshold = THREE.MathUtils.clamp(this._cameraDistance() * 0.018, 6, 32);
      if (this.raycaster.params.Points) this.raycaster.params.Points.threshold = adaptiveThreshold;
      const hits = this.raycaster.intersectObject(this.starPoints);
      if (this.raycaster.params.Points) this.raycaster.params.Points.threshold = prevThreshold;
      if (!hits.length) return -1;

      let bestIdx = -1;
      let bestD2 = Number.POSITIVE_INFINITY;
      const maxHits = Math.min(32, hits.length);
      for (let i = 0; i < maxHits; i++) {
        const idx = Number(hits[i]?.index ?? -1);
        if (idx < 0 || idx >= this.visibleStars.length) continue;
        const sp = this.getScreenPosition(idx);
        if (!sp) continue;
        const d2 = this._pixelDistanceSq(sp, this.pointerPx);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIdx = idx;
        }
      }
      if (bestIdx < 0) return -1;

      const starScreen = this.getScreenPosition(bestIdx);
      const radiusPx = this._starPickRadiusPx(bestIdx);
      return this._isWithinPickRadius(starScreen, radiusPx) ? bestIdx : -1;
    }

    _pickSystemPlanet() {
      if (!this.systemMode || !this.systemPlanetEntries.length) return null;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.systemPlanetEntries.map((entry) => entry.mesh), true);
      if (hits.length) {
        let bestEntry = null;
        let bestD2 = Number.POSITIVE_INFINITY;
        for (const hit of hits.slice(0, 24)) {
          const entry = this._resolveSystemPlanetEntryFromObject(hit.object);
          if (!entry) continue;
          const screenPos = this._getSystemPlanetScreenPosition(entry);
          if (!screenPos) continue;
          const d2 = this._pixelDistanceSq(screenPos, this.pointerPx);
          if (d2 < bestD2) {
            bestD2 = d2;
            bestEntry = entry;
          }
        }
        if (bestEntry) {
          const screenPos = this._getSystemPlanetScreenPosition(bestEntry);
          const radiusPx = this._planetPickRadiusPx(bestEntry);
          if (this._isWithinPickRadius(screenPos, radiusPx)) return bestEntry;
        }
      }

      // Fallback: pure projection selection for very small/edge-on bodies.
      let bestEntry = null;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (const entry of this.systemPlanetEntries) {
        const screenPos = this._getSystemPlanetScreenPosition(entry);
        if (!screenPos) continue;
        const d2 = this._pixelDistanceSq(screenPos, this.pointerPx);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestEntry = entry;
        }
      }
      if (!bestEntry) return null;
      const bestScreen = this._getSystemPlanetScreenPosition(bestEntry);
      const bestRadius = this._planetPickRadiusPx(bestEntry);
      return this._isWithinPickRadius(bestScreen, bestRadius) ? bestEntry : null;
    }

    _resolveSystemPlanetEntryFromObject(obj) {
      if (!obj || !this.systemPlanetEntries?.length) return null;
      let current = obj;
      while (current) {
        const found = this.systemPlanetEntries.find((entry) => entry.mesh === current);
        if (found) return found;
        current = current.parent || null;
      }
      return null;
    }

    _focusOnSelection(selection, smooth = true) {
      const worldPos = this._getSelectionWorldPosition(selection, new THREE.Vector3());
      if (!worldPos) return;
      const baseDist = this.systemMode ? 34 : 78;
      const dirRaw = this.camera.position.clone().sub(this.controls.target);
      const dir = dirRaw.lengthSq() > 1e-6 ? dirRaw.normalize() : new THREE.Vector3(0.7, 0.45, 1).normalize();
      const targetPos = worldPos.clone().add(dir.multiplyScalar(baseDist));

      if (!smooth) {
        this.controls.target.copy(worldPos);
        this.camera.position.copy(targetPos);
        this.controls.update();
        return;
      }

      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: worldPos.clone(),
        fromPos: this.camera.position.clone(),
        toPos: targetPos,
        t: 0,
      };
    }

    _handlePointerMove(e) {
      this._eventToNdc(e);
      if (this.systemMode) {
        const entry = this._applyMagneticSystemHover(this._pickSystemPlanet());
        if (entry) {
          this.systemHoverObject = null;
          if (entry === this.systemHoverEntry) return;
          this.systemHoverEntry = entry;
          this._updateHoverMarker();
          if (typeof this.opts.onHover === 'function') {
            this.opts.onHover(entry ? this._planetPayload(entry) : null, entry ? this._getSystemPlanetScreenPosition(entry) : null);
          }
          return;
        }
        const dyn = this._applyMagneticSystemObjectHover(this._pickSystemDynamicObject());
        if (dyn?.entry || this.systemHoverObject) {
          this.systemHoverEntry = null;
          this.systemHoverObject = dyn || null;
          this._updateHoverMarker();
          if (typeof this.opts.onHover === 'function') {
            this.opts.onHover(dyn ? this._selectionPayload(dyn) : null, dyn ? this._selectionScreenPosition(dyn) : null);
          }
          return;
        }
        if (!this.systemHoverEntry && !this.systemHoverObject) return;
        this.systemHoverEntry = null;
        this.systemHoverObject = null;
        this._updateHoverMarker();
        if (typeof this.opts.onHover === 'function') {
          this.opts.onHover(null, null);
        }
        return;
      }
      const idx = this._applyMagneticStarHover(this._pickStar());
      if (idx >= 0) {
        this.galaxyHoverObject = null;
        this.hoverClusterIndex = -1;
        if (idx === this.hoverIndex) return;
        this.hoverIndex = idx;
        this._updateHoverMarker();
        if (typeof this.opts.onHover === 'function') {
          this.opts.onHover(this._starPayload(this.visibleStars[idx]), this.getScreenPosition(idx));
        }
        this._updateStarVisualState();
        return;
      }
      const dynamicSelection = this._applyMagneticGalaxyObjectHover(this._pickGalaxyDynamicObject());
      if (dynamicSelection) {
        this.hoverClusterIndex = -1;
        this.hoverIndex = -1;
        this.galaxyHoverObject = dynamicSelection;
        this._updateHoverMarker();
        this._updateStarVisualState();
        if (typeof this.opts.onHover === 'function') {
          this.opts.onHover(this._selectionPayload(dynamicSelection), this._selectionScreenPosition(dynamicSelection));
        }
        return;
      }
      const clusterIdx = this._applyMagneticClusterHover(this._pickClusterBox());
      if (clusterIdx >= 0) {
        this.galaxyHoverObject = null;
        this.hoverClusterIndex = clusterIdx;
        this.hoverIndex = -1;
        this._updateHoverMarker();
        this._updateStarVisualState();
        if (typeof this.opts.onHover === 'function') {
          const entry = this.clusterAuraEntries[clusterIdx] || null;
          this.opts.onHover(this._clusterPayload(entry, clusterIdx), this._clusterWorldScreenPosition(entry));
        }
        return;
      }
      const hadHover = this.hoverIndex >= 0 || this.hoverClusterIndex >= 0 || !!this.galaxyHoverObject;
      this.hoverClusterIndex = -1;
      this.galaxyHoverObject = null;
      if (!hadHover) return;
      this.hoverIndex = -1;
      this._updateHoverMarker();
      if (typeof this.opts.onHover === 'function') {
        this.opts.onHover(null, null);
      }
      this._updateStarVisualState();
    }

    _handleClick(e) {
      this._eventToNdc(e);
      if (this.systemMode) {
        const entry = this.clickMagnetEnabled
          ? this._applyMagneticSystemHover(this._pickSystemPlanet())
          : this._pickSystemPlanet();
        if (entry) {
          this.systemHoverObject = null;
          this.systemSelectedObject = null;
          this.systemSelectedEntry = entry;
          this._touchSelection('click-planet');
          this._updateHoverMarker();
          this.focusOnSystemPlanet(this._planetPayload(entry), true);
          if (typeof this.opts.onClick === 'function') {
            this.opts.onClick(this._planetPayload(entry), this._getSystemPlanetScreenPosition(entry));
          }
          return;
        }
        const dyn = this.clickMagnetEnabled
          ? this._applyMagneticSystemObjectHover(this._pickSystemDynamicObject())
          : this._pickSystemDynamicObject();
        if (dyn) {
          this.systemSelectedEntry = null;
          this.systemHoverEntry = null;
          this.systemSelectedObject = dyn;
          this.systemHoverObject = dyn;
          this._touchSelection(`click-${dyn.kind}`);
          this._updateHoverMarker();
          this._focusOnSelection(dyn, true);
          if (typeof this.opts.onClick === 'function') {
            this.opts.onClick(this._selectionPayload(dyn), this._selectionScreenPosition(dyn));
          }
          return;
        }
        this.systemSelectedEntry = null;
        this.systemSelectedObject = null;
        this.systemHoverEntry = null;
        this.systemHoverObject = null;
        this._updateHoverMarker();
        if (typeof this.opts.onHover === 'function') this.opts.onHover(null, null);
        return;
      }
      let idx = this.clickMagnetEnabled
        ? this._applyMagneticStarHover(this._pickStar())
        : this._pickStar();
      if (idx < 0) {
        const fallbackStarIdx = this._pickStarByScreenProximity(34);
        if (fallbackStarIdx >= 0) {
          idx = fallbackStarIdx;
        }
      }
      if (idx < 0) {
        const dynamicSelection = this.clickMagnetEnabled
          ? this._applyMagneticGalaxyObjectHover(this._pickGalaxyDynamicObject())
          : this._pickGalaxyDynamicObject();
        if (dynamicSelection) {
          this.selectedClusterIndex = -1;
          this.hoverClusterIndex = -1;
          this.selectedIndex = -1;
          this.galaxySelectedObject = dynamicSelection;
          this.galaxyHoverObject = dynamicSelection;
          this._touchSelection(`click-${dynamicSelection.kind}`);
          this._updateHoverMarker();
          this._updateStarVisualState();
          this._focusOnSelection(dynamicSelection, true);
          if (typeof this.opts.onClick === 'function') {
            this.opts.onClick(this._selectionPayload(dynamicSelection), this._selectionScreenPosition(dynamicSelection));
          }
          return;
        }
        const clusterIdx = this.clickMagnetEnabled
          ? this._applyMagneticClusterHover(this._pickClusterBox())
          : this._pickClusterBox();
        if (clusterIdx >= 0) {
          this.galaxySelectedObject = null;
          this.galaxyHoverObject = null;
          const entry = this.clusterAuraEntries[clusterIdx] || null;
          this.selectedClusterIndex = clusterIdx;
          this.selectedIndex = -1;
          this.hoverClusterIndex = clusterIdx;
          this._touchSelection('click-cluster');
          this._updateHoverMarker();
          this.focusOnCluster(clusterIdx, true);
          this._updateStarVisualState();
          if (typeof this.opts.onClick === 'function') {
            this.opts.onClick(this._clusterPayload(entry, clusterIdx), this._clusterWorldScreenPosition(entry));
          }
        } else {
          this.galaxySelectedObject = null;
          this.selectedIndex = -1;
          this.selectedClusterIndex = -1;
          this.hoverClusterIndex = -1;
          this._updateHoverMarker();
          this._updateStarVisualState();
          if (typeof this.opts.onHover === 'function') this.opts.onHover(null, null);
        }
        return;
      }
      this.galaxySelectedObject = null;
      this.galaxyHoverObject = null;
      this.selectedClusterIndex = -1;
      this.hoverClusterIndex = -1;
      this.selectedIndex = idx;
      this._touchSelection('click-star');
      logEnterSystemDebug('click-star', {
        instanceId: this.instanceId,
        index: idx,
        galaxy: Number(this.visibleStars[idx]?.galaxy_index || 0),
        system: Number(this.visibleStars[idx]?.system_index || 0),
        starName: String(this.visibleStars[idx]?.name || this.visibleStars[idx]?.catalog_name || ''),
        cameraDistance: Number(this._cameraDistance().toFixed(2)),
        visibleStars: Array.isArray(this.visibleStars) ? this.visibleStars.length : 0,
      });
      this._updateHoverMarker();
      this.focusOnStar(this.visibleStars[idx], true);
      this._updateStarVisualState();
      if (typeof this.opts.onClick === 'function') {
        this.opts.onClick(this._starPayload(this.visibleStars[idx]), this.getScreenPosition(idx));
      }
    }

    _handleDoubleClick(e) {
      this._eventToNdc(e);
      logEnterSystemDebug('doubleclick:received', {
        instanceId: this.instanceId,
        systemMode: !!this.systemMode,
        selectedIndex: Number(this.selectedIndex || -1),
        hoverIndex: Number(this.hoverIndex || -1),
        visibleStars: Array.isArray(this.visibleStars) ? this.visibleStars.length : 0,
        pointerPx: {
          x: Number(this.pointerPx?.x || 0),
          y: Number(this.pointerPx?.y || 0),
        },
      });
      if (this.systemMode) {
        const entry = this.clickMagnetEnabled
          ? this._applyMagneticSystemHover(this._pickSystemPlanet())
          : this._pickSystemPlanet();
        if (entry) {
          this.systemHoverObject = null;
          this.systemSelectedObject = null;
          this.systemSelectedEntry = entry;
          this._touchSelection('doubleclick-planet');
          this._updateHoverMarker();
          if (typeof this.opts.onDoubleClick === 'function') {
            logEnterSystemDebug('doubleclick:planet-hit', {
              instanceId: this.instanceId,
              slot: Number(entry?.slot?.position || 0),
              sourceSystem: Number(this.systemSourceStar?.system_index || 0),
            });
            this.opts.onDoubleClick(this._planetPayload(entry), this._getSystemPlanetScreenPosition(entry));
          }
          return;
        }
        const dyn = this.clickMagnetEnabled
          ? this._applyMagneticSystemObjectHover(this._pickSystemDynamicObject())
          : this._pickSystemDynamicObject();
        if (!dyn) return;
        this.systemSelectedEntry = null;
        this.systemHoverEntry = null;
        this.systemSelectedObject = dyn;
        this.systemHoverObject = dyn;
        this._touchSelection(`doubleclick-${dyn.kind}`);
        this._updateHoverMarker();
        this._focusOnSelection(dyn, true);
        if (typeof this.opts.onDoubleClick === 'function') {
          logEnterSystemDebug('doubleclick:system-object-hit', {
            instanceId: this.instanceId,
            kind: String(dyn.kind || ''),
          });
          this.opts.onDoubleClick(this._selectionPayload(dyn), this._selectionScreenPosition(dyn));
        }
        return;
      }
      const idx = this.clickMagnetEnabled
        ? this._applyMagneticStarHover(this._pickStar())
        : this._pickStar();
      if (idx < 0) {
        const dynamicSelection = this.clickMagnetEnabled
          ? this._applyMagneticGalaxyObjectHover(this._pickGalaxyDynamicObject())
          : this._pickGalaxyDynamicObject();
        if (dynamicSelection) {
          this.selectedClusterIndex = -1;
          this.selectedIndex = -1;
          this.galaxySelectedObject = dynamicSelection;
          this.galaxyHoverObject = dynamicSelection;
          this._touchSelection(`doubleclick-${dynamicSelection.kind}`);
          this._updateHoverMarker();
          this._updateStarVisualState();
          this._focusOnSelection(dynamicSelection, true);
          if (typeof this.opts.onDoubleClick === 'function') {
            logEnterSystemDebug('doubleclick:galaxy-object-hit', {
              instanceId: this.instanceId,
              kind: String(dynamicSelection.kind || ''),
            });
            this.opts.onDoubleClick(this._selectionPayload(dynamicSelection), this._selectionScreenPosition(dynamicSelection));
          }
          return;
        }
        const clusterIdx = this.clickMagnetEnabled
          ? this._applyMagneticClusterHover(this._pickClusterBox())
          : this._pickClusterBox();
        if (clusterIdx >= 0) {
          this.galaxySelectedObject = null;
          this.galaxyHoverObject = null;
          const entry = this.clusterAuraEntries[clusterIdx] || null;
          this.selectedClusterIndex = clusterIdx;
          this.selectedIndex = -1;
          this.hoverClusterIndex = clusterIdx;
          this._touchSelection('doubleclick-cluster');
          this._updateHoverMarker();
          this.focusOnCluster(clusterIdx, true, { close: true });
          this._updateStarVisualState();
          if (typeof this.opts.onDoubleClick === 'function') {
            logEnterSystemDebug('doubleclick:cluster-hit', {
              instanceId: this.instanceId,
              clusterIndex: clusterIdx,
            });
            this.opts.onDoubleClick(this._clusterPayload(entry, clusterIdx), this._clusterWorldScreenPosition(entry));
          }
        }
        logEnterSystemDebug('doubleclick:miss', {
          instanceId: this.instanceId,
          reason: 'no-star-cluster-or-dynamic-selection',
          selectedIndex: Number(this.selectedIndex || -1),
          hoverIndex: Number(this.hoverIndex || -1),
          cameraDistance: Number(this._cameraDistance().toFixed(2)),
        }, 'warn');
        return;
      }
      this.galaxySelectedObject = null;
      this.galaxyHoverObject = null;
      this.selectedClusterIndex = -1;
      this.hoverClusterIndex = -1;
      this.selectedIndex = idx;
      this._touchSelection('doubleclick-star');
      logEnterSystemDebug('doubleclick:star-hit', {
        instanceId: this.instanceId,
        index: idx,
        galaxy: Number(this.visibleStars[idx]?.galaxy_index || 0),
        system: Number(this.visibleStars[idx]?.system_index || 0),
        starName: String(this.visibleStars[idx]?.name || this.visibleStars[idx]?.catalog_name || ''),
        cameraDistance: Number(this._cameraDistance().toFixed(2)),
      });
      this._updateHoverMarker();
      this.focusOnStar(this.visibleStars[idx], true);
      this._updateStarVisualState();
      if (typeof this.opts.onDoubleClick === 'function') {
        this.opts.onDoubleClick(this._starPayload(this.visibleStars[idx]), this.getScreenPosition(idx));
      }
    }

    _pickStarByScreenProximity(maxDistancePx = 34) {
      if (this.systemMode || !Array.isArray(this.visibleStars) || !this.visibleStars.length) return -1;
      const maxD2 = Math.max(8, Number(maxDistancePx || 34));
      const threshold2 = maxD2 * maxD2;
      let bestIdx = -1;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.visibleStars.length; i++) {
        const sp = this.getScreenPosition(i);
        if (!sp) continue;
        const d2 = this._pixelDistanceSq(sp, this.pointerPx);
        if (d2 <= threshold2 && d2 < bestD2) {
          bestD2 = d2;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    _onResize() {
      if (!this.container || this.destroyed) return;
      const w = Math.max(320, this.container.clientWidth);
      const h = Math.max(220, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      if (this.postEffects) {
        this.postEffects.resize(w, h);
      }
      if (this.autoFrameEnabled && this.starPoints) {
        this.fitCameraToStars(false);
      }
    }

    resize() {
      this._onResize();
    }

    _clusterStars(stars, targetPoints = 6000) {
      if (!Array.isArray(stars) || stars.length <= targetPoints) {
        return { stars: stars || [], map: (stars || []).map((_, i) => i) };
      }

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const s of stars) {
        const x = Number(s.x_ly || 0);
        const y = Number(s.y_ly || 0);
        const z = Number(s.z_ly || 0);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }

      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      const spanZ = Math.max(1, maxZ - minZ);
      const binsPerAxis = Math.max(8, Math.ceil(Math.cbrt(targetPoints)));
      const resolveStarColonyColor = (star) => this._sanitizeHexColor(
        star?.colony_owner_color
          || star?.owner_color
          || star?.faction_color
          || ''
      );

      const bins = new Map();
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const nx = (Number(s.x_ly || 0) - minX) / spanX;
        const ny = (Number(s.y_ly || 0) - minY) / spanY;
        const nz = (Number(s.z_ly || 0) - minZ) / spanZ;
        const ix = Math.max(0, Math.min(binsPerAxis - 1, Math.floor(nx * binsPerAxis)));
        const iy = Math.max(0, Math.min(binsPerAxis - 1, Math.floor(ny * binsPerAxis)));
        const iz = Math.max(0, Math.min(binsPerAxis - 1, Math.floor(nz * binsPerAxis)));
        const key = `${ix}|${iy}|${iz}`;

        if (!bins.has(key)) {
          bins.set(key, {
            count: 0,
            sx: 0, sy: 0, sz: 0,
            rep: s,
            repIndex: i,
            hottest: Number(s.temperature_k || 0),
            classVotes: {},
            colonyCount: 0,
            colonyPopulation: 0,
            colonyColorScores: {},
            ownColonyWeight: 0,
            foreignColonyWeight: 0,
            eventScoreTotal: 0,
            eventScorePeak: 0,
          });
        }

        const b = bins.get(key);
        b.count++;
        b.sx += Number(s.x_ly || 0);
        b.sy += Number(s.y_ly || 0);
        b.sz += Number(s.z_ly || 0);
        const cls = String(s.spectral_class || 'G');
        b.classVotes[cls] = (b.classVotes[cls] || 0) + 1;
        const t = Number(s.temperature_k || 0);
        if (t > b.hottest) {
          b.hottest = t;
          b.rep = s;
          b.repIndex = i;
        }

        const starColonyCount = Math.max(0, Number(s.colony_count || 0));
        const starColonyPopulation = Math.max(0, Number(s.colony_population || 0));
        b.colonyCount += starColonyCount;
        b.colonyPopulation += starColonyPopulation;
        const colonyColorHex = resolveStarColonyColor(s);
        if (starColonyCount > 0 && colonyColorHex) {
          const weight = starColonyPopulation > 0 ? starColonyPopulation : starColonyCount;
          b.colonyColorScores[colonyColorHex] = (b.colonyColorScores[colonyColorHex] || 0) + weight;
          if (Number(s.colony_is_player || 0) === 1) b.ownColonyWeight += weight;
          else b.foreignColonyWeight += weight;
        }

        const eventScore = this._starEventSeverity(s);
        b.eventScoreTotal += eventScore;
        if (eventScore > b.eventScorePeak) b.eventScorePeak = eventScore;
      }

      const out = [];
      const map = [];
      bins.forEach((b) => {
        let bestClass = 'G';
        let bestVotes = -1;
        Object.keys(b.classVotes).forEach((k) => {
          if (b.classVotes[k] > bestVotes) {
            bestVotes = b.classVotes[k];
            bestClass = k;
          }
        });

        let dominantColonyColor = '';
        let dominantScore = -1;
        Object.keys(b.colonyColorScores).forEach((hex) => {
          const score = Number(b.colonyColorScores[hex] || 0);
          if (score > dominantScore) {
            dominantScore = score;
            dominantColonyColor = hex;
          }
        });
        if (!dominantColonyColor) {
          dominantColonyColor = resolveStarColonyColor(b.rep);
        }

        out.push(Object.assign({}, b.rep, {
          x_ly: b.sx / b.count,
          y_ly: b.sy / b.count,
          z_ly: b.sz / b.count,
          spectral_class: bestClass,
          cluster_size: b.count,
          colony_count: Math.max(0, Number(b.colonyCount || 0)),
          colony_population: Math.max(0, Number(b.colonyPopulation || 0)),
          colony_owner_color: dominantColonyColor,
          colony_is_player: Number(b.ownColonyWeight || 0) > Number(b.foreignColonyWeight || 0) ? 1 : 0,
          event_severity: THREE.MathUtils.clamp(((b.eventScoreTotal / Math.max(1, b.count)) * 0.62) + (b.eventScorePeak * 0.38), 0, 1),
        }));
        map.push(b.repIndex);
      });

      return { stars: out, map };
    }

    _detectLodProfile() {
      try {
        const cores = Number(navigator?.hardwareConcurrency || 0);
        const mem = Number(navigator?.deviceMemory || 0);
        if (cores >= 12 || mem >= 16) return 'ultra';
        if (cores >= 8 || mem >= 8) return 'high';
        if (cores >= 4 || mem >= 4) return 'medium';
      } catch (_) {}
      return 'low';
    }

    _adaptiveClusterTargetPoints() {
      const baseByProfile = {
        low: 5200,
        medium: 7000,
        high: 9000,
        ultra: 11000,
      };
      const boostByProfile = {
        low: 1.0,
        medium: 1.3,
        high: 1.8,
        ultra: 2.2,
      };
      const base = Number(baseByProfile[this.lodProfile] || 6500);
      const boost = Number(boostByProfile[this.lodProfile] || 1.0);
      const distance = this._cameraDistance();
      const zoomNear = 90;
      const zoomFar = 900;
      const math = getThreeMathUtils(window);
      const zoomT = math.clamp((zoomFar - distance) / (zoomFar - zoomNear), 0, 1);
      const mode = String(this.clusterDensityMode || 'auto');
      if (mode === 'max') {
        const maxTarget = Math.round((base * 2.25) * (1 + zoomT * 0.85));
        return math.clamp(maxTarget, 13000, 42000);
      }
      if (mode === 'high') {
        const highTarget = Math.round((base * 1.55) * (1 + zoomT * 0.62));
        return math.clamp(highTarget, 8200, 30000);
      }
      const target = Math.round(base * (1 + zoomT * boost));
      return math.clamp(target, 3500, 26000);
    }

    setClusterDensityMode(mode, opts = {}) {
      const normalized = ['auto', 'high', 'max'].includes(String(mode || '').toLowerCase())
        ? String(mode || '').toLowerCase()
        : 'auto';
      this.clusterDensityMode = normalized;
      const shouldRecluster = opts.recluster !== false;
      const preserveView = opts.preserveView !== false;
      if (shouldRecluster && Array.isArray(this.stars) && this.stars.length && !this.systemMode) {
        this.setStars(this.stars, { preserveView });
      }
      return this.clusterDensityMode;
    }

    getClusterDensityMode() {
      return String(this.clusterDensityMode || 'auto');
    }

    setLightRig(profile, opts = null) {
      if (this.lightRigManager) {
        const lightOptions = this._buildLightRigOptions(profile, opts);
        const resolved = this.lightRigManager.setProfile(profile, this.scene, lightOptions);
        this.activeLightRig = String(resolved || 'galaxy');
        return this.activeLightRig;
      }
      this.activeLightRig = String(profile || 'galaxy');
      return this.activeLightRig;
    }

    _buildLightRigOptions(profile, opts = null) {
      const normalized = String(profile || 'galaxy').toLowerCase();
      if (normalized !== 'system') return null;
      const star = opts?.star || this.systemSourceStar || null;
      const systemOrigin = opts?.systemOrigin || this.systemOrigin || this.renderFrames?.system?.position || null;
      const starColor = this._spectralColorHex(star?.spectral_class);
      const intensity = ({ O: 3.2, B: 2.9, A: 2.7, F: 2.45, G: 2.3, K: 2.1, M: 1.85 })[String(star?.spectral_class || 'G').toUpperCase().charAt(0)] || 2.3;
      return {
        starColor,
        starIntensity: intensity,
        starPosition: systemOrigin
          ? [Number(systemOrigin.x || 0), Number(systemOrigin.y || 0), Number(systemOrigin.z || 0)]
          : [0, 0, 0],
      };
    }

    _syncSystemLightState() {
      if (!this.systemMode || !this.lightRigManager || typeof this.lightRigManager.setProfile !== 'function') return;
      const lightOptions = this._buildLightRigOptions('system');
      if (!lightOptions) return;
      this.lightRigManager.setProfile('system', this.scene, lightOptions);
      this.systemPlanetEntries.forEach((entry) => {
        const materials = entry?.renderMesh?.material
          ? (Array.isArray(entry.renderMesh.material) ? entry.renderMesh.material : [entry.renderMesh.material])
          : [];
        materials.forEach((material) => {
          const shader = material?.userData?.nightEmission?.shader;
          if (shader?.uniforms?.gqLightWorldPos?.value) {
            shader.uniforms.gqLightWorldPos.value.set(
              Number(lightOptions.starPosition?.[0] || 0),
              Number(lightOptions.starPosition?.[1] || 0),
              Number(lightOptions.starPosition?.[2] || 0)
            );
          }
          if (shader?.uniforms?.gqNightEmissionStrength) {
            shader.uniforms.gqNightEmissionStrength.value = Number(material?.userData?.nightEmission?.strength || 0);
          }
        });
      });
    }

    getLightRig() {
      if (this.lightRigManager) return this.lightRigManager.getActiveProfile();
      return String(this.activeLightRig || 'galaxy');
    }

    getRenderStats() {
      const raw = Array.isArray(this.stars) ? this.stars.length : 0;
      const visible = Array.isArray(this.visibleStars) ? this.visibleStars.length : 0;
      const ratio = raw > 0 ? (visible / raw) : 0;
      const instancingCandidates = this.geometryManager
        ? this.geometryManager.getInstancingCandidates(4).length
        : 0;
      return {
        instanceId: String(this.instanceId || ''),
        rawStars: raw,
        visibleStars: visible,
        clusterCount: Array.isArray(this.clusterAuraEntries) ? this.clusterAuraEntries.length : 0,
        clusterBoundsVisible: !!this.clusterBoundsVisible,
        clusterHeatmapEnabled: this.clusterHeatmapEnabled !== false,
        densityRatio: ratio,
        targetPoints: Number(this._appliedClusterTargetPoints || 0),
        densityMode: String(this.clusterDensityMode || 'auto'),
        orbitSimulationMode: String(this.orbitSimulationMode || 'auto'),
        activeOrbitSimulationMode: String(this.activeOrbitSimulationMode || 'complex'),
        activeGpuOrbitVisuals: !!this.activeGpuOrbitVisuals,
        orbitPathVisibilityFactor: Number(this._systemOrbitVisibilityFactor?.() || 0),
        lodProfile: String(this.lodProfile || 'medium'),
        qualityProfile: String(this.qualityProfile?.name || 'medium'),
        qualityReason: String(this.qualityProfile?.reason || ''),
        pixelRatio: Number(this.renderer?.getPixelRatio?.() || 1),
        cameraDistance: Number(this._cameraDistance() || 0),
        instancingCandidates,
        lightRig: this.getLightRig(),
        systemMode: !!this.systemMode,
        selectedIndex: Number(this.selectedIndex || -1),
        hoverIndex: Number(this.hoverIndex || -1),
        domAttached: !!this.renderer?.domElement?.isConnected,
        canvasId: String(this.renderer?.domElement?.id || this.externalCanvas?.id || ''),
        scientificScaleEnabled: !!this.useScientificScale,
      };
    }

    toggleScientificScale() {
      if (!this.systemMode) {
        console.warn('[GQ] Scientific scale toggle only available in system view');
        return false;
      }
      this.useScientificScale = !this.useScientificScale;
      
      // Rescale all planet meshes
      if (Array.isArray(this.systemPlanetEntries)) {
        this.systemPlanetEntries.forEach((entry) => {
          if (entry.renderMesh && entry.orbitRadius) {
            const currentScale = entry.renderMesh.scale.x;
            const baseSize = this._planetSize(entry.body, entry.orbitIndex);
            const scientificSize = this._planetSize(entry.body, entry.orbitIndex, entry.orbitRadius);
            const newScale = scientificSize / baseSize;
            entry.renderMesh.scale.set(newScale, newScale, newScale);
            
            // Update proxy mesh scale too
            if (entry.mesh) {
              entry.mesh.scale.copy(entry.renderMesh.scale);
            }
          }
        });
      }
      
      // Rescale all moon meshes
      if (Array.isArray(this.systemMoonEntries)) {
        this.systemMoonEntries.forEach((entry) => {
          if (entry.mesh && entry.parentEntry) {
            const parentRadius = entry.parentEntry.renderMesh?.geometry?.parameters?.radius || 4;
            const moonDiameter = Number(entry.body?.diameter || 0);
            const baseMoonSize = moonDiameter > 0
              ? THREE.MathUtils.clamp(0.75 + moonDiameter / 4200, 0.85, Math.max(1.9, parentRadius * 0.55))
              : THREE.MathUtils.clamp(parentRadius * (0.24 + entry.orbitIndex * 0.04), 0.9, Math.max(1.8, parentRadius * 0.5));
            const scaleFactor = this.useScientificScale ? 
              (entry.parentEntry.renderMesh.scale.x > 1 ? entry.parentEntry.renderMesh.scale.x * 0.6 : 1) : 1;
            entry.mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
          }
        });
      }
      
      // Adjust camera FOV to accommodate new scale
      const targetFov = this.useScientificScale 
        ? Math.max(20, Number(this.camera?.fov || 50) * this.scientificScaleZoomFactor)
        : (this.focusTarget?.toFov || this.systemEntryFov || 50);
      
      if (this.camera && this.focusTarget) {
        this.focusTarget.toFov = targetFov;
      } else if (this.camera) {
        this.camera.fov = targetFov;
        this.camera.updateProjectionMatrix();
      }
      
      return this.useScientificScale;
    }

    getQualityProfileState() {
      return Object.assign({}, this.qualityProfile || {}, {
        pixelRatio: Number(this.renderer?.getPixelRatio?.() || 1),
        galacticCoreFxEnabled: !!this.galacticCoreFxEnabled,
        dynamicClusterLod: !!this.dynamicClusterLod,
      });
    }

    setGalaxyMetadata(rawMeta = {}) {
      const source = (rawMeta && typeof rawMeta === 'object' && rawMeta.metadata && typeof rawMeta.metadata === 'object')
        ? rawMeta.metadata
        : (rawMeta && typeof rawMeta === 'object' ? rawMeta : {});
      const armCount = Number(source.arm_count ?? source.armCount);
      const pitchTangent = Number(source.pitch_tangent ?? source.pitchTangent);
      const rotationDirectionCcw = Number(source.rotation_direction_ccw ?? source.rotationDirectionCcw);
      const escapeVelocityCenterKms = Number(source.escape_velocity_center_kms ?? source.escapeVelocityCenterKms);
      const escapeVelocitySunKms = Number(source.escape_velocity_sun_kms ?? source.escapeVelocitySunKms);
      const orbitalVelocityKms = Number(source.orbital_velocity_kms ?? source.orbitalVelocityKms);

      this.galaxyMetadata = Object.assign({}, this.galaxyMetadata || {}, {
        armCount: Number.isFinite(armCount) && armCount > 0 ? armCount : Number(this.galaxyMetadata?.armCount || 4),
        pitchTangent: Number.isFinite(pitchTangent) && pitchTangent > 0 ? pitchTangent : Number(this.galaxyMetadata?.pitchTangent || 0.249328),
        rotationDirectionCcw: Number.isFinite(rotationDirectionCcw) ? (rotationDirectionCcw ? 1 : 0) : Number(this.galaxyMetadata?.rotationDirectionCcw ?? 1),
        escapeVelocityCenterKms: Number.isFinite(escapeVelocityCenterKms) ? escapeVelocityCenterKms : Number(this.galaxyMetadata?.escapeVelocityCenterKms || 8000),
        escapeVelocitySunKms: Number.isFinite(escapeVelocitySunKms) ? escapeVelocitySunKms : Number(this.galaxyMetadata?.escapeVelocitySunKms || 500),
        orbitalVelocityKms: Number.isFinite(orbitalVelocityKms) ? orbitalVelocityKms : Number(this.galaxyMetadata?.orbitalVelocityKms || 220),
      });

      const uniforms = this.galaxyDiskGlow?.material?.uniforms;
      if (uniforms) {
        if (uniforms.uArmCount) uniforms.uArmCount.value = Number(this.galaxyMetadata.armCount || 4);
        if (uniforms.uPitchTangent) uniforms.uPitchTangent.value = Number(this.galaxyMetadata.pitchTangent || 0.249328);
        if (uniforms.uRotationCcwSign) uniforms.uRotationCcwSign.value = this.galaxyMetadata.rotationDirectionCcw ? 1.0 : -1.0;
      }

      return Object.assign({}, this.galaxyMetadata);
    }

    setStars(stars, opts = {}) {
      if (this.systemMode) this.exitSystemView(false);
      const preserveView = !!opts.preserveView;
      const prevRawSelected = (this.selectedIndex >= 0 && this.visibleToRawIndex[this.selectedIndex] != null)
        ? Number(this.visibleToRawIndex[this.selectedIndex])
        : -1;
      const prevRawHover = (this.hoverIndex >= 0 && this.visibleToRawIndex[this.hoverIndex] != null)
        ? Number(this.visibleToRawIndex[this.hoverIndex])
        : -1;
      this.stars = Array.isArray(stars) ? stars.slice() : [];
      this.visibleStars = [];
      this.visibleToRawIndex = [];
      this.hoverIndex = -1;
      this.selectedIndex = -1;
      logEnterSystemDebug('setStars:reset', {
        instanceId: this.instanceId,
        rawStarsIncoming: this.stars.length,
        preserveView,
      });

      if (this.starPoints) {
        if (this.renderFrames?.galaxy) {
          this.renderFrames.galaxy.remove(this.starPoints);
        } else {
          this.scene.remove(this.starPoints);
        }
        this.starPoints.geometry.dispose();
        this.starPoints.material.dispose();
        this.starPoints = null;
      }

      if (!this.stars.length) {
        this._rebuildClusterAuras();
        this._syncClusterAuraTransform();
        return;
      }

      const targetPoints = this.dynamicClusterLod
        ? this._adaptiveClusterTargetPoints()
        : 6500;
      const clustered = this._clusterStars(this.stars, targetPoints);
      this._appliedClusterTargetPoints = targetPoints;
      this.visibleStars = clustered.stars;
      this.visibleToRawIndex = clustered.map;
      this._debugLog('set-stars', {
        rawStars: this.stars.length,
        visibleStars: this.visibleStars.length,
        targetPoints,
        preserveView,
      });
      logEnterSystemDebug('setStars:applied', {
        instanceId: this.instanceId,
        rawStars: this.stars.length,
        visibleStars: this.visibleStars.length,
        targetPoints,
        preserveView,
      });

      if (prevRawSelected >= 0) {
        const mapped = this.visibleToRawIndex.indexOf(prevRawSelected);
        if (mapped >= 0) this.selectedIndex = mapped;
        else this.selectedIndex = this._findClosestStarToTargetIndex();
        if (preserveView && this.selectedIndex >= 0) this._touchSelection('recluster-remap-selection');
      }
      if (prevRawHover >= 0) {
        const mapped = this.visibleToRawIndex.indexOf(prevRawHover);
        if (mapped >= 0) this.hoverIndex = mapped;
        else this.hoverIndex = this._findClosestStarToTargetIndex();
      }

      if (!this.visibleStars.length) return;

      const positions = new Float32Array(this.visibleStars.length * 3);
      const colors = new Float32Array(this.visibleStars.length * 3);
      const sizes = new Float32Array(this.visibleStars.length);
      const colonyFlags = new Float32Array(this.visibleStars.length);
      const colonyStrength = new Float32Array(this.visibleStars.length);
      const colonyOwnership = new Float32Array(this.visibleStars.length);
      const colonyColors = new Float32Array(this.visibleStars.length * 3);
      const classColor = {
        O: [0.61, 0.69, 1.0],
        B: [0.67, 0.75, 1.0],
        A: [0.79, 0.84, 1.0],
        F: [0.95, 0.96, 1.0],
        G: [1.0, 0.95, 0.86],
        K: [1.0, 0.85, 0.63],
        M: [1.0, 0.8, 0.45],
      };

      const scale = 0.028;
      for (let i = 0; i < this.visibleStars.length; i++) {
        const s = this.visibleStars[i];
        const p = i * 3;
        positions[p + 0] = (Number(s.x_ly) || 0) * scale;
        positions[p + 1] = (Number(s.z_ly) || 0) * scale * 0.42;
        positions[p + 2] = (Number(s.y_ly) || 0) * scale;

        const c = classColor[s.spectral_class] || [0.85, 0.88, 1.0];
        // Fog of War: keep unknown/stale systems visibly present in the galactic map.
        const fowLevel = String(s.visibility_level || 'unknown');
        let fowMul = 0.62;
        if (fowLevel === 'own' || fowLevel === 'active') fowMul = 1.0;
        else if (fowLevel === 'stale') fowMul = 0.78;

        const ambient = 0.16;
        colors[p + 0] = Math.min(1, c[0] * fowMul + ambient);
        colors[p + 1] = Math.min(1, c[1] * fowMul + ambient);
        colors[p + 2] = Math.min(1, c[2] * fowMul + ambient * 1.08);

        const relClass = { O: 2.4, B: 1.9, A: 1.5, F: 1.2, G: 1.0, K: 0.85, M: 0.72 };
        const clusterBoost = Math.min(2.2, 1 + Math.log2(Math.max(1, Number(s.cluster_size || 1))) * 0.24);
        const eventSeverity = this._starEventSeverity(s);
        const baseSize = (3.1 * (relClass[s.spectral_class] || 1.0)) * clusterBoost * (1 + eventSeverity * 0.42);
        const alertColor = [1.0, 0.45, 0.22];
        const alertMix = THREE.MathUtils.clamp(eventSeverity * 0.58, 0, 0.58);
        colors[p + 0] = THREE.MathUtils.lerp(colors[p + 0], alertColor[0], alertMix);
        colors[p + 1] = THREE.MathUtils.lerp(colors[p + 1], alertColor[1], alertMix);
        colors[p + 2] = THREE.MathUtils.lerp(colors[p + 2], alertColor[2], alertMix * 0.9);
        if (fowLevel === 'unknown') {
          sizes[i] = Math.max(4.4, baseSize);
        } else if (fowLevel === 'stale') {
          sizes[i] = Math.max(3.8, baseSize);
        } else {
          sizes[i] = Math.max(3.2, baseSize);
        }

        const colonyCount = Math.max(0, Number(s.colony_count || 0));
        const colonyPopulation = Math.max(0, Number(s.colony_population || 0));
        const colonyColorSource = s.colony_owner_color || s.owner_color || s.faction_color || '';
        const colonyRgb = this._hexColorToRgb01(colonyColorSource, [0.62, 0.75, 1.0]);
        const cp = i * 3;
        s.__eventSeverity = eventSeverity;
        colonyFlags[i] = colonyCount > 0 ? 1 : 0;
        colonyOwnership[i] = Number(s.colony_is_player || 0) === 1 ? 1 : 0;
        const countStrength = colonyCount > 0
          ? THREE.MathUtils.clamp((Math.log2(colonyCount + 1) - 0.3) / 3.2, 0.18, 1)
          : 0;
        const popStrength = colonyPopulation > 0
          ? THREE.MathUtils.clamp((Math.log10(colonyPopulation + 1) - 2.2) / 3.0, 0.16, 1)
          : 0;
        colonyStrength[i] = colonyCount > 0 ? Math.max(countStrength, popStrength) : 0;
        colonyColors[cp + 0] = colonyRgb[0];
        colonyColors[cp + 1] = colonyRgb[1];
        colonyColors[cp + 2] = colonyRgb[2];
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geo.setAttribute('aColony', new THREE.BufferAttribute(colonyFlags, 1));
      geo.setAttribute('aColonyStrength', new THREE.BufferAttribute(colonyStrength, 1));
      geo.setAttribute('aColonyOwnership', new THREE.BufferAttribute(colonyOwnership, 1));
      geo.setAttribute('aColonyColor', new THREE.BufferAttribute(colonyColors, 3));
      geo.setAttribute('aEmpire', new THREE.BufferAttribute(new Float32Array(this.visibleStars.length), 1));
      geo.setAttribute('aProximityFactor', new THREE.BufferAttribute(new Float32Array(this.visibleStars.length), 1));

      geo.computeBoundingSphere();

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uPointScale: { value: this.renderer.getPixelRatio() * 92.0 },
          uCameraVel: { value: new THREE.Vector3(0, 0, 0) },
          uDopplerStrength: { value: 0.11 },
          uHeartbeatPhase: { value: 0 },
          uHeartbeatStrength: { value: 0 },
          uCameraPos: { value: new THREE.Vector3(0, 0, 0) },
          uProximityRange: { value: 250 },
        },
        vertexShader: `
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aColony;
          attribute float aColonyStrength;
          attribute float aColonyOwnership;
          attribute vec3 aColonyColor;
          attribute float aEmpire;
          attribute float aProximityFactor;
          varying vec3 vColor;
          varying float vColony;
          varying float vColonyStrength;
          varying float vColonyOwnership;
          varying vec3 vColonyColor;
          varying float vAlpha;
          varying float vEmpire;
          varying float vProximityFactor;
          uniform float uPointScale;
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            float dist = max(1.0, -mvPosition.z);
            // Stars closer to galactic centre render slightly larger/brighter,
            // mimicking the luminosity-density gradient of the bulge region.
            float rScene      = length(position.xz);
            float centerBoost = 1.0 + 0.85 * exp(-rScene * 0.016);
            gl_PointSize = max(2.2, aSize * centerBoost * uPointScale / dist);
            gl_Position = projectionMatrix * mvPosition;
            vColor = aColor;
            vColony = aColony;
            vColonyStrength = aColonyStrength;
            vColonyOwnership = aColonyOwnership;
            vColonyColor = aColonyColor;
            vAlpha = clamp((0.40 + (aSize / 10.0)) * (0.85 + centerBoost * 0.20), 0.32, 0.95);
            vEmpire = aEmpire;
            vProximityFactor = aProximityFactor;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vColony;
          varying float vColonyStrength;
          varying float vColonyOwnership;
          varying vec3 vColonyColor;
          varying float vAlpha;
          varying float vEmpire;
          varying float vProximityFactor;
          uniform vec3 uCameraVel;
          uniform float uDopplerStrength;
          uniform float uHeartbeatPhase;
          uniform float uHeartbeatStrength;
          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float r2 = dot(uv, uv);
            if (r2 > 0.25) discard;

            float core = smoothstep(0.26, 0.0, r2);
            vec3 dir = normalize(vec3(uv.x, uv.y, 1.0));
            float radial = clamp(dot(normalize(uCameraVel + vec3(1e-6)), dir), -1.0, 1.0);
            float shift = radial * uDopplerStrength;
            vec3 redShift = vec3(vColor.r * 1.08, vColor.g * 0.88, vColor.b * 0.72);
            vec3 blueShift = vec3(vColor.r * 0.78, vColor.g * 0.93, min(1.0, vColor.b * 1.25));
            vec3 shifted = mix(vColor, shift >= 0.0 ? blueShift : redShift, abs(shift));
            float beat = 0.5 + 0.5 * sin(uHeartbeatPhase);
            
            // Proximity-basierte Pulsintensität: Nahe Systeme pulsieren intensiver
            float proximityBoost = 0.3 + 0.7 * vProximityFactor;
            float empirePulse = vEmpire * uHeartbeatStrength * proximityBoost;
            
            vec3 pulseColor = mix(shifted, vec3(0.86, 0.95, 1.0), empirePulse * (0.35 + beat * 0.55));
            // Soft bloom halo around each star (astrophoto diffraction ring)
            float halo = exp(-sqrt(r2) * 9.0) * 0.24;
            float pulseAlpha = vAlpha * (core + halo * 0.55) + empirePulse * (0.10 + beat * 0.15);

            float r = length(uv);
            float strength = clamp(vColonyStrength, 0.0, 1.0);
            float ringOuter = 0.49;
            float ringThickness = mix(0.045, 0.17, strength);
            float ringInner = ringOuter - ringThickness;
            float edgeSoftness = mix(0.018, 0.036, strength);
            float ring = smoothstep(ringInner, ringInner + edgeSoftness, r)
              * (1.0 - smoothstep(ringOuter - edgeSoftness, ringOuter, r));
            float colonyRing = ring * vColony;
            float ownColony = clamp(vColonyOwnership, 0.0, 1.0);
            float innerOwnRing = smoothstep(0.22, 0.25, r) * (1.0 - smoothstep(0.28, 0.31, r)) * ownColony * (0.35 + strength * 0.65);
            vec3 ownAccent = mix(vColonyColor, vec3(0.82, 1.0, 0.90), 0.65);
            vec3 colonyDisplayColor = mix(vColonyColor, ownAccent, ownColony);

            vec3 finalColor = mix(pulseColor, colonyDisplayColor, colonyRing * 0.92);
            finalColor = mix(finalColor, ownAccent, innerOwnRing * 0.95);
            float finalAlpha = pulseAlpha + colonyRing * (0.16 + strength * 0.18 + beat * 0.22) + innerOwnRing * 0.22;

            gl_FragColor = vec4(finalColor * (0.50 + core * 0.52 + halo * 0.28 + colonyRing * (0.20 + strength * 0.26) + innerOwnRing * 0.28), finalAlpha);
          }
        `,
      });

      this.starPoints = new THREE.Points(geo, material);
      try {
        this.renderer.compile(this.starPoints, this.renderFrames.galaxy);
      } catch (shaderErr) {
        // Fallback: replace with simple PointsMaterial if shader compilation fails
        console.error('[galaxy] shader compilation error:', shaderErr);
        try {
          material.dispose();
        } catch (_) {}
        
        // Create per-vertex colors from the geometry attributes if available
        let vertexColors = undefined;
        if (geo && geo.attributes && geo.attributes.aColor) {
          try {
            geo.setAttribute('color', geo.getAttribute('aColor'));
            vertexColors = true;
          } catch (_) {}
        }
        
        const fallbackMaterial = new THREE.PointsMaterial({
          color: vertexColors ? 0xffffff : 0xffffff,
          size: 5.2,
          sizeAttenuation: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          vertexColors: vertexColors || false,
          opacity: 1.0,
          fog: false,
        });
        this.starPoints.material = fallbackMaterial;
        try {
          if (window.GQLog && typeof window.GQLog.warn === 'function') {
            window.GQLog.warn('[galaxy] star shader compilation failed, using fallback PointsMaterial', {
              shaderError: shaderErr?.message || String(shaderErr || 'unknown'),
              vertexColors: !!vertexColors,
              materialSize: 4.5,
              materialOpacity: 0.95,
            });
          }
        } catch (_) {}
      }
      this.starPoints.frustumCulled = false;
      this.starPoints.renderOrder = 6;
      
      // Debug: check if starPoints is already in the scene
      const beforeAdd = this.renderFrames.galaxy.children.includes(this.starPoints);
      this.renderFrames.galaxy.add(this.starPoints);
      const afterAdd = this.renderFrames.galaxy.children.includes(this.starPoints);

      const visibleCount = Array.isArray(this.visibleStars) ? this.visibleStars.length : 0;
      try {
        if (window.GQLog && typeof window.GQLog.info === 'function') {
          window.GQLog.info(`[galaxy] stars rendered: ${visibleCount} visible points (${this.starPoints.material.constructor.name}) visible=${this.starPoints.visible} sceneHas=${afterAdd}`);
        }
      } catch (_) {}
      
      // Force visibility on starPoints
      try {
        this.starPoints.visible = true;
        if (this.starPoints.material) {
          this.starPoints.material.visible = true;
          if (this.starPoints.material.uniforms) {
            Object.values(this.starPoints.material.uniforms).forEach(u => {
              if (u && typeof u === 'object') {
                u.needsUpdate = true;
              }
            });
          }
        }
        this.renderFrames.galaxy.visible = true;
      } catch (_) {}

      if (!preserveView) {
        const bs = geo.boundingSphere;
        if (bs && Number.isFinite(bs.radius) && bs.radius > 0) {
          const center = bs.center.clone();
          const radius = Math.max(80, bs.radius);
          const distance = radius * 1.55;
          this.controls.target.copy(center);
          this.camera.position.set(center.x + distance * 0.42, center.y + distance * 0.22, center.z + distance);
        } else {
          this.controls.target.set(0, 0, 0);
        }
        this.controls.update();
        this.fitCameraToStars(true, true);
      } else {
        this.controls.update();
      }
      this._rebuildClusterAuras();
      this._applyEmpireHeartbeatMask();
      this._syncClusterAuraTransform();
      this._updateHoverMarker();
    }

    _updateStarVisualState() {
      if (!this.starPoints) return;
      const sizeAttr = this.starPoints.geometry.getAttribute('aSize');
      if (!sizeAttr) return;
      for (let i = 0; i < sizeAttr.count; i++) {
        const s = this.visibleStars[i] || {};
        const relClass = { O: 2.4, B: 1.9, A: 1.5, F: 1.2, G: 1.0, K: 0.85, M: 0.72 };
        const clusterBoost = Math.min(2.2, 1 + Math.log2(Math.max(1, Number(s.cluster_size || 1))) * 0.24);
        const eventSeverity = THREE.MathUtils.clamp(Number(s.__eventSeverity ?? this._starEventSeverity(s) ?? 0), 0, 1);
        let base = (3.1 * (relClass[s.spectral_class] || 1.0)) * clusterBoost * (1 + eventSeverity * 0.42);
        if (i === this.hoverIndex) base *= 1.5;
        if (i === this.selectedIndex) base *= 1.9;
        sizeAttr.setX(i, base);
      }
      sizeAttr.needsUpdate = true;
    }

    _markerTarget(kind, value) {
      return value == null ? null : { kind, value };
    }

    _getHoverMarkerTarget() {
      if (this.systemMode) {
        if (this.systemHoverEntry) return this._markerTarget('system-planet', this.systemHoverEntry);
        if (this.systemHoverObject) return this._markerTarget('selection', this.systemHoverObject);
        return null;
      }
      if (this.galaxyHoverObject) return this._markerTarget('selection', this.galaxyHoverObject);
      if (this.hoverClusterIndex >= 0) return this._markerTarget('cluster', this.hoverClusterIndex);
      if (this.hoverIndex >= 0) return this._markerTarget('star', this.hoverIndex);
      return null;
    }

    _getSelectionMarkerTarget() {
      if (this.systemMode) {
        if (this.systemSelectedEntry) return this._markerTarget('system-planet', this.systemSelectedEntry);
        if (this.systemSelectedObject) return this._markerTarget('selection', this.systemSelectedObject);
        return null;
      }
      if (this.galaxySelectedObject) return this._markerTarget('selection', this.galaxySelectedObject);
      if (this.selectedClusterIndex >= 0) return this._markerTarget('cluster', this.selectedClusterIndex);
      if (this.selectedIndex >= 0) return this._markerTarget('star', this.selectedIndex);
      return null;
    }

    _sameMarkerTarget(a, b) {
      if (!a || !b) return false;
      return a.kind === b.kind && a.value === b.value;
    }

    _applyMarkerTarget(marker, target, variant = 'hover') {
      if (!marker) return false;
      if (!target) {
        marker.visible = false;
        return false;
      }
      if (target.kind === 'system-planet') {
        const entry = target.value;
        const worldPos = this._getSystemPlanetWorldPosition(entry, new THREE.Vector3());
        const baseSize = Math.max(4.5, entry?.mesh?.geometry?.parameters?.radius || 4.5);
        marker.position.copy(worldPos);
        marker.scale.setScalar(baseSize * (variant === 'selection' ? 3.4 : 2.6));
        marker.visible = true;
        return true;
      }
      if (target.kind === 'selection') {
        const worldPos = this._getSelectionWorldPosition(target.value, new THREE.Vector3());
        if (!worldPos) {
          marker.visible = false;
          return false;
        }
        marker.position.copy(worldPos);
        marker.scale.setScalar(this._selectionPickRadiusPx(target.value) * (variant === 'selection' ? 0.23 : 0.17));
        marker.visible = true;
        return true;
      }
      if (target.kind === 'cluster') {
        const clusterEntry = this.clusterAuraEntries?.[target.value] || null;
        if (!clusterEntry?.center || !clusterEntry?.size) {
          marker.visible = false;
          return false;
        }
        const worldPos = this.clusterAuraGroup.localToWorld(clusterEntry.center.clone());
        const baseSize = Math.max(10, clusterEntry.size.length() * 0.18);
        marker.position.copy(worldPos);
        marker.scale.setScalar(baseSize * (variant === 'selection' ? 1.95 : 1.55));
        marker.visible = !!this.clusterBoundsVisible;
        return marker.visible;
      }
      if (target.kind === 'star') {
        if (!this.starPoints || target.value < 0 || target.value >= this.visibleStars.length) {
          marker.visible = false;
          return false;
        }
        const posAttr = this.starPoints.geometry.getAttribute('position');
        const sizeAttr = this.starPoints.geometry.getAttribute('aSize');
        const localPos = new THREE.Vector3(
          posAttr.getX(target.value),
          posAttr.getY(target.value),
          posAttr.getZ(target.value)
        );
        const worldPos = this.starPoints.localToWorld(localPos.clone());
        const baseSize = sizeAttr ? sizeAttr.getX(target.value) : 6;
        marker.position.copy(worldPos);
        marker.scale.setScalar(Math.max(7, baseSize * (variant === 'selection' ? 2.55 : 1.95)));
        marker.visible = true;
        return true;
      }
      marker.visible = false;
      return false;
    }

    _updateHoverMarker() {
      if (!this.hoverMarker && !this.selectionMarker) return;
      const selectionTarget = this._getSelectionMarkerTarget();
      const hoverTarget = this._getHoverMarkerTarget();
      const uniqueHoverTarget = this._sameMarkerTarget(hoverTarget, selectionTarget) ? null : hoverTarget;
      this._applyMarkerTarget(this.selectionMarker, selectionTarget, 'selection');
      this._applyMarkerTarget(this.hoverMarker, uniqueHoverTarget, 'hover');
      if (this.systemMode) {
        this._updateSystemOrbitLineStates();
      }
    }

    getWorldScreenPosition(worldVec) {
      if (!worldVec) return null;
      const projected = worldVec.clone().project(this.camera);
      const rect = this.renderer.domElement.getBoundingClientRect();
      return {
        x: ((projected.x + 1) * 0.5) * rect.width,
        y: ((1 - projected.y) * 0.5) * rect.height,
      };
    }

    _getStarWorldPosition(index, out = new THREE.Vector3()) {
      if (!this.starPoints || index == null || index < 0 || index >= this.visibleStars.length) return null;
      const posAttr = this.starPoints.geometry.getAttribute('position');
      out.set(
        posAttr.getX(index),
        posAttr.getY(index),
        posAttr.getZ(index)
      );
      return this.starPoints.localToWorld(out);
    }

    _getTrackedSelectionWorldPosition() {
      if (this.systemMode && this.systemSelectedEntry?.mesh) {
        return this._getSystemPlanetWorldPosition(this.systemSelectedEntry, new THREE.Vector3());
      }
      if (this.systemMode && this.systemSelectedObject) {
        return this._getSelectionWorldPosition(this.systemSelectedObject, new THREE.Vector3());
      }
      if (!this.systemMode && this.selectedIndex >= 0) {
        return this._getStarWorldPosition(this.selectedIndex, new THREE.Vector3());
      }
      if (!this.systemMode && this.galaxySelectedObject) {
        return this._getSelectionWorldPosition(this.galaxySelectedObject, new THREE.Vector3());
      }
      return null;
    }

    _followTrackedSelection() {
      if (!this.followSelectionEnabled) return;
      const trackedWorldPos = this._getTrackedSelectionWorldPosition();
      this._rebasePivotToWorldTarget(trackedWorldPos);
    }

    _applyPivotDelta(delta) {
      if (!delta || delta.lengthSq() <= 1e-8) return;
      this.controls.target.add(delta);
      this.camera.position.add(delta);

      if (this.focusTarget) {
        this.focusTarget.fromTarget.add(delta);
        this.focusTarget.toTarget.add(delta);
        this.focusTarget.fromPos.add(delta);
        this.focusTarget.toPos.add(delta);
      }
    }

    _rebasePivotToWorldTarget(nextWorldTarget) {
      if (!nextWorldTarget) return;
      const delta = nextWorldTarget.clone().sub(this.controls.target);
      this._applyPivotDelta(delta);
    }

    setFollowSelectionEnabled(enabled) {
      this.followSelectionEnabled = !!enabled;
    }

    toggleFollowSelection() {
      this.followSelectionEnabled = !this.followSelectionEnabled;
      return this.followSelectionEnabled;
    }

    isFollowingSelection() {
      return !!this.followSelectionEnabled;
    }

    setTransitionsEnabled(enabled) {
      this.transitionsEnabled = !!enabled;
      return this.transitionsEnabled;
    }

    _ensureGpuOrbitMaterial(material) {
      if (!material || material.userData?.gqOrbitGpuPatched) return material;

      const orbitUniforms = {
        gqOrbitGpuEnabled: { value: 0 },
        gqOrbitRadius: { value: 0 },
        gqOrbitMinor: { value: 0 },
        gqOrbitAngle: { value: 0 },
        gqOrbitPivotMatrixWorld: { value: new THREE.Matrix4() },
        gqOrbitUseDirectOffset: { value: 0 },
        gqOrbitDirectOffset: { value: new THREE.Vector3() },
      };
      const prevOnBeforeCompile = material.onBeforeCompile;
      const prevCacheKey = typeof material.customProgramCacheKey === 'function'
        ? material.customProgramCacheKey.bind(material)
        : null;

      material.userData = Object.assign({}, material.userData, {
        gqOrbitGpuPatched: true,
        gqOrbitGpuUniforms: orbitUniforms,
      });

      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, orbitUniforms);
        shader.vertexShader = `
uniform float gqOrbitGpuEnabled;
uniform float gqOrbitRadius;
uniform float gqOrbitMinor;
uniform float gqOrbitAngle;
uniform mat4 gqOrbitPivotMatrixWorld;
uniform float gqOrbitUseDirectOffset;
uniform vec3 gqOrbitDirectOffset;
${shader.vertexShader}`;
        shader.vertexShader = shader.vertexShader.replace(
          'mvPosition = modelViewMatrix * mvPosition;',
          `mvPosition = modelViewMatrix * mvPosition;
          if (gqOrbitGpuEnabled > 0.5) {
            vec3 gqParamOffset = vec3(cos(gqOrbitAngle) * gqOrbitRadius, 0.0, sin(gqOrbitAngle) * gqOrbitMinor);
            vec3 gqOrbitLocalOffset = mix(gqParamOffset, gqOrbitDirectOffset, gqOrbitUseDirectOffset);
            mvPosition.xyz += (viewMatrix * gqOrbitPivotMatrixWorld * vec4(gqOrbitLocalOffset, 0.0)).xyz;
          }`
        );
        if (typeof prevOnBeforeCompile === 'function') prevOnBeforeCompile(shader);
      };
      material.customProgramCacheKey = () => `${prevCacheKey ? prevCacheKey() : 'base'}|gq-orbit-gpu-v2`;
      material.needsUpdate = true;
      return material;
    }

    _prepareGpuOrbitMaterials(root) {
      if (!root) return;
      const visit = (obj) => {
        if (obj?.isMesh) {
          obj.frustumCulled = false;
          if (Array.isArray(obj.material)) obj.material.forEach((material) => this._ensureGpuOrbitMaterial(material));
          else this._ensureGpuOrbitMaterial(obj.material);
        }
        if (Array.isArray(obj?.children)) obj.children.forEach((child) => visit(child));
      };
      visit(root);
    }

    _syncGpuOrbitMaterial(material, entry, enabled, useDirectOffset = false) {
      if (!material) return;
      const uniforms = material.userData?.gqOrbitGpuUniforms || null;
      if (!uniforms) return;
      entry?.orbitPivot?.updateWorldMatrix?.(true, false);
      uniforms.gqOrbitGpuEnabled.value = enabled ? 1 : 0;
      uniforms.gqOrbitRadius.value = Number(entry?.orbitRadius || 0);
      uniforms.gqOrbitMinor.value = Number(entry?.orbitMinor || 0);
      uniforms.gqOrbitAngle.value = Number(entry?.angle || 0);
      if (entry?.orbitPivot?.matrixWorld) uniforms.gqOrbitPivotMatrixWorld.value.copy(entry.orbitPivot.matrixWorld);
      if (uniforms.gqOrbitUseDirectOffset) uniforms.gqOrbitUseDirectOffset.value = useDirectOffset ? 1 : 0;
      if (uniforms.gqOrbitDirectOffset && useDirectOffset && entry?.currentLocalPosition) {
        uniforms.gqOrbitDirectOffset.value.copy(entry.currentLocalPosition);
      }
    }

    _setEntryGpuOrbitVisualState(entry, enabled, useDirectOffset = false) {
      if (!entry?.renderMesh) return;
      const visit = (obj) => {
        if (obj?.isMesh) {
          if (Array.isArray(obj.material)) obj.material.forEach((material) => this._syncGpuOrbitMaterial(material, entry, enabled, useDirectOffset));
          else this._syncGpuOrbitMaterial(obj.material, entry, enabled, useDirectOffset);
        }
        if (Array.isArray(obj?.children)) obj.children.forEach((child) => visit(child));
      };
      visit(entry.renderMesh);
    }

    _allSystemOrbitEntries() {
      const planets = Array.isArray(this.systemPlanetEntries) ? this.systemPlanetEntries : [];
      const moons = Array.isArray(this.systemMoonEntries) ? this.systemMoonEntries : [];
      return moons.length ? planets.concat(moons) : planets;
    }

    _systemOrbitVisibilityFactor() {
      if (!this.systemMode || this.systemOrbitPathsVisible === false) return 0;
      const distance = Number(this._cameraDistance?.() || 0);
      const fadeStart = 230;
      const fadeEnd = 410;
      const t = THREE.MathUtils.clamp((distance - fadeStart) / Math.max(1, fadeEnd - fadeStart), 0, 1);
      return 1 - t;
    }

    _updateSystemOrbitLineStates() {
      const orbitEntries = this._allSystemOrbitEntries();
      if (!orbitEntries.length) return;
      const hover = this.systemHoverEntry;
      const sel = this.systemSelectedEntry;
      const focusOnly = this.systemOrbitFocusOnly === true;
      const hasFocusTarget = !!(hover || sel);
      const zoomVisibility = this._systemOrbitVisibilityFactor();
      orbitEntries.forEach((entry) => {
        const mat = entry.orbitLine?.material;
        const markerMat = entry.orbitLeadMarker?.material;
        if (!mat && !markerMat) return;
        const rawColor = entry.body?.owner_color ?? entry.slot?.player_planet?.owner_color ?? null;
        let baseColor = new THREE.Color(0x31567c);
        if (rawColor) {
          try { baseColor = new THREE.Color(rawColor); } catch (_) {}
        }

        let orbitColor = baseColor.clone();
        let orbitOpacity = sel ? 0.18 : 0.35;
        let markerOpacity = 0.35;
        let markerScale = 1.0;
        let visible = this.systemOrbitPathsVisible !== false;
        const isFocused = entry === hover || entry === sel;

        if (focusOnly && hasFocusTarget && entry !== hover && entry !== sel) {
          visible = false;
        }

        if (entry === sel) {
          orbitColor = baseColor.clone();
          if (!rawColor) orbitColor.setHex(0x5de0c0);
          orbitOpacity = 0.95;
          markerOpacity = 0.95;
          markerScale = 1.55;
        } else if (entry === hover) {
          orbitColor = rawColor ? baseColor.clone().offsetHSL(0, 0, 0.22) : new THREE.Color(0x7ab8ee);
          orbitOpacity = 0.75;
          markerOpacity = 0.82;
          markerScale = 1.3;
        }

        if (!isFocused) {
          orbitOpacity *= zoomVisibility;
          markerOpacity *= Math.max(0.15, zoomVisibility);
          if (zoomVisibility <= 0.04) visible = false;
        }

        if (mat) {
          entry.orbitLine.visible = visible;
          mat.color.copy(orbitColor);
          mat.opacity = orbitOpacity;
          mat.needsUpdate = true;
        }
        const markerVisible = visible && this.systemOrbitMarkersVisible !== false;
        if (markerMat) {
          markerMat.color.copy(orbitColor);
          markerMat.opacity = orbitOpacity > 0.2 ? markerOpacity : 0.18;
          markerMat.needsUpdate = true;
        }
        if (entry.orbitLeadMarker) {
          entry.orbitLeadMarker.scale.setScalar(markerScale);
          entry.orbitLeadMarker.visible = markerVisible;
        }
      });
    }

    _normalizeOrbitSimulationMode(mode) {
      const normalized = String(mode || 'auto').trim().toLowerCase();
      return ['auto', 'simple', 'complex'].includes(normalized) ? normalized : 'auto';
    }

    _rebuildOrbitSimulationBuffer() {
      if (!Array.isArray(this.systemPlanetEntries) || !this.systemPlanetEntries.length) {
        this.systemOrbitSimulationBuffer = null;
        return null;
      }

      const stride = Number(this.systemOrbitSimulationStride || 5);
      const buffer = new Float32Array(this.systemPlanetEntries.length * stride);
      this.systemPlanetEntries.forEach((entry, index) => {
        const offset = index * stride;
        buffer[offset + 0] = Number(entry.orbitRadius || 0);
        buffer[offset + 1] = Number(entry.orbitMinor || 0);
        buffer[offset + 2] = Number(entry.eccentricity || 0);
        buffer[offset + 3] = Number(entry.angle || 0);
        buffer[offset + 4] = Number(entry.speed || 0);
        entry.orbitIndex = index;
      });
      this.systemOrbitSimulationBuffer = buffer;
      return buffer;
    }

    setOrbitSimulationMode(mode) {
      this.orbitSimulationMode = this._normalizeOrbitSimulationMode(mode);
      this.activeOrbitSimulationMode = this._resolveOrbitSimulationMode();
      return this.orbitSimulationMode;
    }

    _resolveOrbitSimulationMode() {
      const requestedMode = this._normalizeOrbitSimulationMode(this.orbitSimulationMode);
      if (requestedMode !== 'auto') return requestedMode;
      const bodyCount = this._allSystemOrbitEntries().length;
      return bodyCount > 14 ? 'simple' : 'complex';
    }

    _solveEccentricAnomaly(meanAnomaly, eccentricity) {
      const e = THREE.MathUtils.clamp(Number(eccentricity || 0), 0, 0.92);
      let anomaly = Number.isFinite(meanAnomaly) ? meanAnomaly : 0;
      for (let i = 0; i < 5; i += 1) {
        const f = anomaly - e * Math.sin(anomaly) - meanAnomaly;
        const fp = 1 - e * Math.cos(anomaly);
        if (Math.abs(fp) < 1e-6) break;
        anomaly -= f / fp;
      }
      return anomaly;
    }

    _computeSimpleOrbitPosition(entry, target = null) {
      const out = target || new THREE.Vector3();
      out.set(
        Math.cos(entry.angle) * entry.orbitRadius,
        0,
        Math.sin(entry.angle) * entry.orbitMinor
      );
      return out;
    }

    _computeComplexOrbitPosition(entry, target = null) {
      const out = target || new THREE.Vector3();
      const eccentricity = THREE.MathUtils.clamp(Number(entry.eccentricity || 0), 0, 0.92);
      const eccentricAnomaly = this._solveEccentricAnomaly(entry.angle, eccentricity);
      out.set(
        entry.orbitRadius * (Math.cos(eccentricAnomaly) - eccentricity),
        0,
        entry.orbitMinor * Math.sin(eccentricAnomaly)
      );
      return out;
    }

    _computeOrbitPosition(entry, mode, target = null) {
      if (!entry) return (target || new THREE.Vector3()).set(0, 0, 0);
      return mode === 'complex'
        ? this._computeComplexOrbitPosition(entry, target)
        : this._computeSimpleOrbitPosition(entry, target);
    }

    _readOrbitSimulationEntry(entry) {
      const stride = Number(this.systemOrbitSimulationStride || 5);
      const idx = Number(entry?.orbitIndex ?? -1);
      const buffer = this.systemOrbitSimulationBuffer;
      if (!buffer || idx < 0) return entry;
      const offset = idx * stride;
      entry.orbitRadius = Number(buffer[offset + 0] || 0);
      entry.orbitMinor = Number(buffer[offset + 1] || 0);
      entry.eccentricity = Number(buffer[offset + 2] || 0);
      entry.angle = Number(buffer[offset + 3] || 0);
      entry.speed = Number(buffer[offset + 4] || 0);
      return entry;
    }

    _stepOrbitSimulationBuffer(dt) {
      const stride = Number(this.systemOrbitSimulationStride || 5);
      const buffer = this.systemOrbitSimulationBuffer;
      if (!buffer || !Number.isFinite(dt) || dt === 0) return;
      for (let offset = 0; offset < buffer.length; offset += stride) {
        buffer[offset + 3] += dt * buffer[offset + 4];
      }
    }

    _getSystemPlanetWorldPosition(entry, target = null) {
      const out = target || new THREE.Vector3();
      if (entry?.currentWorldPosition) return out.copy(entry.currentWorldPosition);
      if (entry?.mesh?.getWorldPosition) return entry.mesh.getWorldPosition(out);
      return out.set(0, 0, 0);
    }

    _updateSystemOrbitTransforms(dt) {
      if (!Array.isArray(this.systemPlanetEntries) || !this.systemPlanetEntries.length) return;
      const orbitDt = dt * Number(this.visualOrbitTimeScale || 1);
      const planetSpinDt = dt * Number(this.visualPlanetSpinScale || 1);
      const moonSpinDt = dt * Number(this.visualMoonSpinScale || 1);
      const orbitMode = this._resolveOrbitSimulationMode();
      // GPU visuals are active for all orbit modes.
      // simple → parametric angle; complex → CPU-solved position passed as direct offset.
      const useDirectOffset = orbitMode === 'complex';
      this.activeOrbitSimulationMode = orbitMode;
      this.activeGpuOrbitVisuals = true;
      this._stepOrbitSimulationBuffer(orbitDt);
      this.systemPlanetEntries.forEach((entry, index) => {
        this._readOrbitSimulationEntry(entry);
        const orbitalPos = this._computeOrbitPosition(entry, orbitMode, this._orbitScratchLocal);
        entry.currentLocalPosition.copy(orbitalPos);
        if (entry.orbitLeadMarker) {
          const leadAngle = Number(entry.angle || 0) + Math.max(0.08, Math.min(0.4, Math.abs(Number(entry.speed || 0)) * 0.14));
          const leadEntry = Object.assign({}, entry, { angle: leadAngle });
          const leadPos = this._computeOrbitPosition(leadEntry, orbitMode, this._orbitScratchWorld);
          entry.orbitLeadMarker.position.copy(leadPos);
          entry.orbitLeadMarker.visible = this.systemOrbitPathsVisible !== false && this.systemOrbitMarkersVisible !== false;
        }
        const orbitWorldPos = entry.orbitPivot.localToWorld(this._orbitScratchWorld.copy(orbitalPos));
        entry.currentWorldPosition.copy(orbitWorldPos);
        entry.mesh.position.copy(this.systemBodyGroup.worldToLocal(orbitWorldPos.clone()));
        if (entry.renderRoot) {
          // renderRoot always at origin — GPU shader applies the orbital offset.
          entry.renderRoot.position.set(0, 0, 0);
        }
        this._setEntryGpuOrbitVisualState(entry, true, useDirectOffset);
        const visibleMesh = entry.renderMesh || entry.mesh;
        visibleMesh.rotation.y += planetSpinDt * (0.25 + index * 0.03);
        visibleMesh.children.forEach((child) => {
          if (!child || child.userData?.kind !== 'planet-ring') return;
          child.rotation.z += planetSpinDt * Number(child.userData?.rotationSpeed || 0.01);
          child.rotation.y += planetSpinDt * Number(child.userData?.precessionSpeed || 0.001);
        });
      });

      if (Array.isArray(this.systemMoonEntries) && this.systemMoonEntries.length) {
        this.systemMoonEntries.forEach((entry, index) => {
          const parentMesh = entry.parentEntry?.mesh;
          if (!parentMesh) return;
          entry.orbitPivot.position.copy(parentMesh.position);
          entry.angle += orbitDt * Number(entry.speed || 0);
          const orbitalPos = this._computeOrbitPosition(entry, orbitMode, this._orbitScratchLocal);
          entry.currentLocalPosition.copy(orbitalPos);
          entry.mesh.position.copy(orbitalPos);
          if (entry.orbitLeadMarker) {
            const leadAngle = Number(entry.angle || 0) + Math.max(0.08, Math.min(0.38, Math.abs(Number(entry.speed || 0)) * 0.12));
            const leadEntry = Object.assign({}, entry, { angle: leadAngle });
            const leadPos = this._computeOrbitPosition(leadEntry, orbitMode, this._orbitScratchWorld);
            entry.orbitLeadMarker.position.copy(leadPos);
            entry.orbitLeadMarker.visible = this.systemOrbitPathsVisible !== false && this.systemOrbitMarkersVisible !== false;
          }
          entry.mesh.getWorldPosition(entry.currentWorldPosition);
          entry.renderMesh.rotation.y += moonSpinDt * (0.32 + index * 0.025);
        });
      }

      this._updateSystemOrbitLineStates();
    }

    _buildOrbitCurvePoints(orbitRadius, orbitMinor, eccentricity) {
      const points = [];
      const e = THREE.MathUtils.clamp(Number(eccentricity || 0), 0, 0.92);
      for (let i = 0; i <= 96; i += 1) {
        const t = (i / 96) * Math.PI * 2;
        points.push(new THREE.Vector3(
          orbitRadius * (Math.cos(t) - e),
          0,
          orbitMinor * Math.sin(t)
        ));
      }
      return points;
    }

    _updateDoppler(dt) {
      if (!this.starPoints || !this.starPoints.material?.uniforms) return;
      const delta = this.camera.position.clone().sub(this.prevCamPos);
      this.prevCamPos.copy(this.camera.position);
      const invDt = dt > 0 ? (1 / dt) : 0;
      const speed = delta.length() * invDt;
      this.cameraMotionSpeed = speed;
      const now = performance.now();
      if (speed <= this.transitionStableSpeed) {
        if (!this._cameraStableSinceMs) this._cameraStableSinceMs = now;
      } else {
        this._cameraStableSinceMs = 0;
      }
      if (speed <= 1e-5) {
        this.cameraVelocity.set(0, 0, 0);
      } else {
        this.cameraVelocity.copy(delta.normalize().multiplyScalar(Math.min(1.0, speed / 120.0)));
      }
      this.starPoints.material.uniforms.uCameraVel.value.copy(this.cameraVelocity);
    }

    _isTransitionMotionStable() {
      if (!this._cameraStableSinceMs) return false;
      return (performance.now() - this._cameraStableSinceMs) >= this.transitionStableMinMs;
    }

    _debugLog(event, data = null, level = 'debug') {
      if (!this.debugEnabled) return;
      const logger = (console && typeof console[level] === 'function') ? console[level] : console.log;
      if (data == null) logger.call(console, `[Galaxy3D] ${event}`);
      else logger.call(console, `[Galaxy3D] ${event}`, data);
    }

    _debugLogThrottled(key, event, data = null, minIntervalMs = this.debugThrottleMs) {
      if (!this.debugEnabled) return;
      const now = performance.now();
      const last = Number(this._debugLastByKey.get(key) || 0);
      if ((now - last) < minIntervalMs) return;
      this._debugLastByKey.set(key, now);
      this._debugLog(event, data);
    }

    _touchSelection(reason = 'unspecified') {
      this._selectionTouchedMs = performance.now();
      this._debugLog('selection-touch', {
        reason,
        selectedIndex: this.selectedIndex,
        hoverIndex: this.hoverIndex,
        systemMode: this.systemMode,
      });
    }

    _selectionIsSettled() {
      if (!this._selectionTouchedMs) return true;
      return (performance.now() - this._selectionTouchedMs) >= this.transitionSelectionMinMs;
    }

    focusOnStar(star, smooth) {
      if (!star) return;
      const scale = 0.028;
      const localPos = new THREE.Vector3(
        (Number(star.x_ly) || 0) * scale,
        (Number(star.z_ly) || 0) * scale * 0.42,
        (Number(star.y_ly) || 0) * scale,
      );
      // Transform galaxy-local star position to world space (accounts for galaxy frame rotation).
      const worldPos = this.renderFrames?.galaxy
        ? this.renderFrames.galaxy.localToWorld(localPos.clone())
        : localPos.clone();
      const { x: tx, y: ty, z: tz } = worldPos;

      if (!smooth) {
        this.controls.target.set(tx, ty, tz);
        this.camera.position.set(tx + 70, ty + 46, tz + 95);
        this.controls.update();
        return;
      }

      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: new THREE.Vector3(tx, ty, tz),
        fromPos: this.camera.position.clone(),
        toPos: new THREE.Vector3(tx + 70, ty + 46, tz + 95),
        t: 0,
      };
    }

    focusOnCluster(clusterIndex, smooth = true, opts = {}) {
      const entry = this.clusterAuraEntries?.[clusterIndex] || null;
      if (!entry?.center || !entry?.size) return;
      // Transform cluster center from clusterAuraGroup-local space to world space.
      const center = this.clusterAuraGroup
        ? this.clusterAuraGroup.localToWorld(entry.center.clone())
        : entry.center.clone();
      const radius = Math.max(18, entry.size.length() * 0.75);
      const distance = (opts.close ? 1.35 : 1.75) * radius;
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      const viewDir = dir.lengthSq() > 1e-5 ? dir : new THREE.Vector3(0.72, 0.48, 1).normalize();
      const targetPos = center.clone().add(viewDir.multiplyScalar(distance));
      if (!smooth) {
        this.controls.target.copy(center);
        this.camera.position.copy(targetPos);
        this.controls.update();
        return;
      }
      this.focusTarget = {
        fromTarget: this.controls.target.clone(),
        toTarget: center.clone(),
        fromPos: this.camera.position.clone(),
        toPos: targetPos,
        t: 0,
      };
    }

    setClusterBoundsVisible(enabled) {
      this.clusterBoundsVisible = !!enabled;
      (this.clusterAuraEntries || []).forEach((entry) => {
        const wireMeshes = Array.isArray(entry?.wireMeshes)
          ? entry.wireMeshes
          : (entry?.wireMesh ? [entry.wireMesh] : []);
        wireMeshes.forEach((mesh) => {
          if (mesh) mesh.visible = this.clusterBoundsVisible;
        });
        if (entry?.wireMat) entry.wireMat.opacity = this.clusterBoundsVisible ? Math.max(0.12, entry.wireMat.opacity || 0.26) : 0;
      });
      if (!this.clusterBoundsVisible) {
        this.hoverClusterIndex = -1;
        if (this.selectedClusterIndex >= 0) this.selectedClusterIndex = -1;
      }
      return this.clusterBoundsVisible;
    }

    toggleClusterBounds() {
      return this.setClusterBoundsVisible(!this.clusterBoundsVisible);
    }

    areClusterBoundsVisible() {
      return !!this.clusterBoundsVisible;
    }

    setClusterHeatmapEnabled(enabled) {
      this.clusterHeatmapEnabled = enabled !== false;
      return this.clusterHeatmapEnabled;
    }

    toggleClusterHeatmap() {
      return this.setClusterHeatmapEnabled(!(this.clusterHeatmapEnabled !== false));
    }

    areClusterHeatmapEnabled() {
      return this.clusterHeatmapEnabled !== false;
    }

    setGalacticCoreFxEnabled(enabled) {
      this.galacticCoreFxEnabled = !!enabled;
      if (!this.galacticCoreGroup) return this.galacticCoreFxEnabled;
      this.galacticCoreGroup.traverse((child) => {
        const kind = String(child.userData?.kind || '');
        if (kind === 'bh-accretion-disk' || kind === 'hawking-flare' || kind === 'jet' || kind === 'bh-lens') {
          child.visible = this.galacticCoreFxEnabled;
        }
      });
      return this.galacticCoreFxEnabled;
    }

    areGalacticCoreFxEnabled() {
      return !!this.galacticCoreFxEnabled;
    }

    enableMagneticHover(enabled) {
      this.hoverMagnetEnabled = !!enabled;
      this.persistHoverMagnetConfig();
      return this.hoverMagnetEnabled;
    }

    enableMagneticClick(enabled) {
      this.clickMagnetEnabled = !!enabled;
      this.persistHoverMagnetConfig();
      return this.clickMagnetEnabled;
    }

    setHoverMagnetConfig(cfg = {}) {
      if (typeof cfg.enabled === 'boolean') this.hoverMagnetEnabled = cfg.enabled;
      if (typeof cfg.clickEnabled === 'boolean') this.clickMagnetEnabled = cfg.clickEnabled;
      if (cfg.starPx != null) {
        const starPx = Number(cfg.starPx);
        if (Number.isFinite(starPx)) this.hoverMagnetStarPx = THREE.MathUtils.clamp(starPx, 8, 64);
      }
      if (cfg.planetPx != null) {
        const planetPx = Number(cfg.planetPx);
        if (Number.isFinite(planetPx)) this.hoverMagnetPlanetPx = THREE.MathUtils.clamp(planetPx, 8, 72);
      }
      if (cfg.clusterPx != null) {
        const clusterPx = Number(cfg.clusterPx);
        if (Number.isFinite(clusterPx)) this.hoverMagnetClusterPx = THREE.MathUtils.clamp(clusterPx, 8, 72);
      }
      this.persistHoverMagnetConfig();
      return this.getHoverMagnetConfig();
    }

    getHoverMagnetConfig() {
      return {
        enabled: !!this.hoverMagnetEnabled,
        clickEnabled: !!this.clickMagnetEnabled,
        starPx: Number(this.hoverMagnetStarPx || 0),
        planetPx: Number(this.hoverMagnetPlanetPx || 0),
        clusterPx: Number(this.hoverMagnetClusterPx || 0),
      };
    }

    persistHoverMagnetConfig() {
      try {
        window.localStorage?.setItem('gq:hover:magnet', JSON.stringify(this.getHoverMagnetConfig()));
      } catch (_) {}
    }

    // Explicit matrix chain for UI overlay projection: P * V * M * p
    getScreenPosition(index) {
      if (index == null || index < 0 || index >= this.visibleStars.length || !this.starPoints) return null;

      const posAttr = this.starPoints.geometry.getAttribute('position');
      const x = posAttr.getX(index);
      const y = posAttr.getY(index);
      const z = posAttr.getZ(index);

      const p = [x, y, z, 1];
      const m = this.starPoints.matrixWorld.elements;
      const v = this.camera.matrixWorldInverse.elements;
      const pr = this.camera.projectionMatrix.elements;

      const mp = this._mulMat4Vec4(m, p);
      const vp = this._mulMat4Vec4(v, mp);
      const cp = this._mulMat4Vec4(pr, vp);
      if (cp[3] === 0) return null;

      const ndcX = cp[0] / cp[3];
      const ndcY = cp[1] / cp[3];
      const rect = this.renderer.domElement.getBoundingClientRect();
      return {
        x: ((ndcX + 1) * 0.5) * rect.width,
        y: ((1 - ndcY) * 0.5) * rect.height,
      };
    }

    _mulMat4Vec4(m, v) {
      return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
      ];
    }

    _tickFocus(dt) {
      if (!this.focusTarget) return;
      const speed = this.systemMode
        ? (this.systemSelectedEntry ? this.focusDamping.planet : this.focusDamping.system)
        : this.focusDamping.galaxy;
      this.focusTarget.t = Math.min(1, this.focusTarget.t + dt * speed);
      const t = this.focusTarget.t;
      const k = 1 - Math.pow(1 - t, 3);

      this.controls.target.lerpVectors(this.focusTarget.fromTarget, this.focusTarget.toTarget, k);
      this.camera.position.lerpVectors(this.focusTarget.fromPos, this.focusTarget.toPos, k);
      const fromUp = this.focusTarget.fromUp;
      const toUp = this.focusTarget.toUp;
      if (fromUp?.isVector3 && toUp?.isVector3) {
        this.camera.up.lerpVectors(fromUp, toUp, k).normalize();
      }
      const fromFov = Number(this.focusTarget.fromFov);
      const toFov = Number(this.focusTarget.toFov);
      if (Number.isFinite(fromFov) && Number.isFinite(toFov)) {
        this.camera.fov = THREE.MathUtils.lerp(fromFov, toFov, k);
        this.camera.updateProjectionMatrix();
      }
      if (t >= 1) this.focusTarget = null;
    }

    _cameraDistance() {
      return this.camera.position.distanceTo(this.controls.target);
    }

    _galaxySpinSpeeds() {
      const distance = this._cameraDistance();
      const t = THREE.MathUtils.clamp((distance - 95) / (860 - 95), 0, 1);
      // Negative for CCW (counter-clockwise from north pole) to match wound spiral arms.
      // Direction driven by galaxy metadata so CW galaxies flip sign automatically.
      const ccwSign = (this.galaxyMetadata?.rotationDirectionCcw ?? 1) ? -1 : 1;
      const outer = ccwSign * THREE.MathUtils.lerp(0.009, 0.021, t);
      return {
        outer,
        core: outer * 1.55,
        halo: outer * 1.22,
      };
    }

    _findClosestStarToTargetIndex() {
      if (!this.starPoints || !Array.isArray(this.visibleStars) || !this.visibleStars.length) return -1;
      const posAttr = this.starPoints.geometry?.getAttribute('position');
      if (!posAttr) return -1;

      const localTarget = this.starPoints.worldToLocal(this.controls.target.clone());
      let best = -1;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (let i = 0; i < posAttr.count; i++) {
        const dx = posAttr.getX(i) - localTarget.x;
        const dy = posAttr.getY(i) - localTarget.y;
        const dz = posAttr.getZ(i) - localTarget.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
      return best;
    }

    _persistentHoverIndexForDistance(distance) {
      if (distance > this.persistentHoverDistance) return -1;
      if (this.hoverClusterIndex >= 0 || this.selectedClusterIndex >= 0) return -1;
      if (this.hoverIndex >= 0) return this.hoverIndex;
      if (this.selectedIndex >= 0) return this.selectedIndex;

      const now = performance.now();
      if (now < this._persistentHoverCacheUntil && this._persistentHoverIndex >= 0) {
        return this._persistentHoverIndex;
      }
      this._persistentHoverIndex = this._findClosestStarToTargetIndex();
      this._persistentHoverCacheUntil = now + 170;
      return this._persistentHoverIndex;
    }

    _planetPayload(entry) {
      return this._annotateSelectionPayload(Object.assign({ __kind: 'planet' }, entry.body, { __slot: entry.slot, __sourceStar: this.systemSourceStar }), {
        kind: 'planet',
        scope: 'system',
        mode: 'system',
      });
    }

    _triggerAutoTransition(kind, payload, screenPos = null) {
      this.autoTransitionCooldownUntil = performance.now() + 900;
      this._debugLog('auto-transition', {
        kind,
        distance: Number(this._cameraDistance().toFixed(2)),
        selectedIndex: this.selectedIndex,
        hasSystemSelection: !!this.systemSelectedEntry,
      });
      logEnterSystemDebug('auto-transition', {
        instanceId: this.instanceId,
        kind,
        distance: Number(this._cameraDistance().toFixed(2)),
        selectedIndex: Number(this.selectedIndex || -1),
        hoverIndex: Number(this.hoverIndex || -1),
        hasSystemSelection: !!this.systemSelectedEntry,
        payloadSystem: Number(payload?.system_index || payload?.system || payload?.__sourceStar?.system_index || 0),
        payloadKind: String(payload?.__kind || 'star'),
      });
      if (kind === 'enter-system') {
        this.autoTransitionArmed.galaxyEnterSystem = false;
        if (typeof this.opts.onDoubleClick === 'function') {
          this.opts.onDoubleClick(payload, screenPos);
        }
        return;
      }
      if (kind === 'enter-planet') {
        this.autoTransitionArmed.systemEnterPlanet = false;
        if (typeof this.opts.onDoubleClick === 'function') {
          this.opts.onDoubleClick(payload, screenPos);
        }
        return;
      }
      if (kind === 'exit-planet') {
        this.autoTransitionArmed.planetExitToSystem = false;
        this.systemSelectedEntry = null;
        const systemTarget = (this.systemOrigin && this.systemOrigin.isVector3)
          ? this.systemOrigin.clone()
          : new THREE.Vector3(0, 0, 0);
        this.focusTarget = {
          fromTarget: this.controls.target.clone(),
          toTarget: systemTarget.clone(),
          fromPos: this.camera.position.clone(),
          toPos: systemTarget.clone().add(new THREE.Vector3(0, 132, 214)),
          t: 0,
        };
        if (typeof this.opts.onPlanetZoomOut === 'function') {
          this.opts.onPlanetZoomOut(this.systemSourceStar);
        }
        return;
      }
      if (kind === 'exit-system') {
        this.autoTransitionArmed.systemExitToGalaxy = false;
        if (typeof this.opts.onSystemZoomOut === 'function') {
          this.opts.onSystemZoomOut(this.systemSourceStar);
        } else {
          this.exitSystemView(true);
        }
      }
    }

    _handleZoomThresholdTransitions() {
      if (!this.transitionsEnabled) return;
      if (performance.now() < this.autoTransitionCooldownUntil || this.focusTarget || this.controls.dragging) return;
      const motionStable = this._isTransitionMotionStable();
      const selectionSettled = this._selectionIsSettled();
      const distance = this._cameraDistance();

      if (!this.systemMode) {
        const idx = this.selectedIndex >= 0 ? this.selectedIndex : this.hoverIndex;
        const allowSelection = this.selectedIndex < 0 || selectionSettled;
        const allowGalaxyEnter = motionStable || distance <= this.zoomThresholds.galaxyEnterSystem * 0.86;
        if (idx >= 0 && distance <= this.zoomThresholds.galaxyEnterSystem * 1.05 && !allowSelection) {
          this._debugLogThrottled('guard-galaxy-enter-selection', 'transition-guarded', {
            kind: 'enter-system',
            reason: 'selection-not-settled',
            distance: Number(distance.toFixed(2)),
            settleMsLeft: Math.max(0, Math.ceil(this.transitionSelectionMinMs - (performance.now() - this._selectionTouchedMs))),
          });
        }
        if (idx >= 0 && allowSelection && allowGalaxyEnter && distance <= this.zoomThresholds.galaxyEnterSystem && this.autoTransitionArmed.galaxyEnterSystem) {
          this.selectedIndex = idx;
          this._triggerAutoTransition('enter-system', this.visibleStars[idx], this.getScreenPosition(idx));
          return;
        }
        if (distance >= this.zoomThresholds.galaxyResetSystem) {
          this.autoTransitionArmed.galaxyEnterSystem = true;
        }
        return;
      }

      const activeEntry = this.systemSelectedEntry || this.systemHoverEntry;
      const allowSelection = !this.systemSelectedEntry || selectionSettled;
      const allowPlanetEnter = motionStable || distance <= this.zoomThresholds.systemEnterPlanet * 0.84;
      if (activeEntry && distance <= this.zoomThresholds.systemEnterPlanet * 1.08 && !allowSelection) {
        this._debugLogThrottled('guard-planet-enter-selection', 'transition-guarded', {
          kind: 'enter-planet',
          reason: 'selection-not-settled',
          distance: Number(distance.toFixed(2)),
          settleMsLeft: Math.max(0, Math.ceil(this.transitionSelectionMinMs - (performance.now() - this._selectionTouchedMs))),
        });
      }
      if (activeEntry && allowSelection && allowPlanetEnter && distance <= this.zoomThresholds.systemEnterPlanet && this.autoTransitionArmed.systemEnterPlanet) {
        this.systemSelectedEntry = activeEntry;
        this._triggerAutoTransition('enter-planet', this._planetPayload(activeEntry), this._getSystemPlanetScreenPosition(activeEntry));
        return;
      }
      if (distance >= this.zoomThresholds.systemResetPlanet) {
        this.autoTransitionArmed.systemEnterPlanet = true;
      }

      const allowPlanetExit = motionStable || distance >= this.zoomThresholds.planetExitToSystem * 1.08;
      if (this.systemSelectedEntry && allowPlanetExit && distance >= this.zoomThresholds.planetExitToSystem && this.autoTransitionArmed.planetExitToSystem) {
        this._triggerAutoTransition('exit-planet');
        return;
      }
      if (distance <= this.zoomThresholds.planetResetExit) {
        this.autoTransitionArmed.planetExitToSystem = true;
      }

      const allowSystemExit = motionStable || distance >= this.zoomThresholds.systemExitToGalaxy * 1.08;
      const zoomOutIntentRecent = (performance.now() - Number(this._lastZoomOutInputMs || 0)) <= 1400;
      if (!this.systemSelectedEntry && allowSystemExit && distance >= this.zoomThresholds.systemExitToGalaxy && this.autoTransitionArmed.systemExitToGalaxy && zoomOutIntentRecent) {
        this._triggerAutoTransition('exit-system');
        return;
      }
      if (!zoomOutIntentRecent && distance >= this.zoomThresholds.systemExitToGalaxy && this.autoTransitionArmed.systemExitToGalaxy) {
        this._debugLogThrottled('guard-system-exit-intent', 'transition-guarded', {
          kind: 'exit-system',
          reason: 'missing-zoom-out-intent',
          distance: Number(distance.toFixed(2)),
        });
      }
      if (distance <= this.zoomThresholds.systemResetExit) {
        this.autoTransitionArmed.systemExitToGalaxy = true;
      }
    }

    _animate() {
      if (this.destroyed) return;
      requestAnimationFrame(() => this._animate());
      if (!resolveThreeRuntime(window)) return;
      ensureThreeMathUtils(window);
      const dt = this.clock.getDelta();

      if (!this.systemMode) {
        if (this.dynamicClusterLod && this.stars.length > 2800) {
          const now = performance.now();
          const desired = this._adaptiveClusterTargetPoints();
          const current = Math.max(1, Number(this._appliedClusterTargetPoints || 6500));
          const drift = Math.abs(desired - current) / current;
          const distance = this._cameraDistance();
          const transitionSensitiveZoom = distance <= (this.zoomThresholds.galaxyResetSystem * 1.08);
          const recentZoomInput = (now - this._lastZoomInputMs) < 1400;
          if (drift >= 0.22
            && (now - this._lastLodReclusterMs) >= 1100
            && !this.focusTarget
            && !this.controls.dragging
            && !transitionSensitiveZoom
            && !recentZoomInput) {
            this._lastLodReclusterMs = now;
            this._debugLog('lod-recluster', {
              desired,
              current,
              drift: Number(drift.toFixed(3)),
              distance: Number(distance.toFixed(2)),
              recentZoomInput,
            });
            this.setStars(this.stars, { preserveView: true });
          }
        }
        const spin = this._galaxySpinSpeeds();
        if (this.renderFrames?.galaxy) this.renderFrames.galaxy.rotation.y += dt * spin.outer;
        if (this.coreStars) this.coreStars.rotation.y += dt * Math.max(0, (spin.core - spin.outer));
                // Animate: black hole accretion disk + jets
                if (this.galacticCoreGroup) {
                  this.galacticCoreGroup.traverse((child) => {
                    if (child.material?.uniforms?.uTime !== undefined) {
                      child.material.uniforms.uTime.value += dt;
                    }
                    if (child.userData?.kind === 'hawking-flare' && child.material) {
                      const phase = Number(child.userData.phase || 0);
                      const baseScale = Number(child.userData.baseScale || 26);
                      const pulse = 0.78 + 0.22 * Math.sin(this.clock.elapsedTime * 2.7 + phase);
                      child.scale.setScalar(baseScale * pulse);
                      child.material.opacity = 0.48 + 0.34 * pulse;
                    }
                  });
                }
        if (this.halo) this.halo.rotation.z += dt * spin.halo;
        // Animate spiral-disk glow shader (slow drift for nebula effect)
        if (this.galaxyDiskGlow?.material?.uniforms?.uTime) {
          this.galaxyDiskGlow.material.uniforms.uTime.value = this.clock.elapsedTime;
        }
        this.heartbeatPhase += dt * 4.2;
        if (this.starPoints?.material?.uniforms?.uHeartbeatPhase) {
          this.starPoints.material.uniforms.uHeartbeatPhase.value = this.heartbeatPhase;
        }
        // Update proximity factors for near heartbeat stars during camera movement
        this._updateHeartbeatProximity();
        this.clusterAuraEntries.forEach((entry, index) => {
          const beat = 0.5 + 0.5 * Math.sin((this.clock.elapsedTime * 0.9) + entry.phase);
          const camDist = Math.max(1, this._cameraDistance());
          const zoomNear = 95;
          const zoomFar = 760;
          const zoomT = THREE.MathUtils.clamp((zoomFar - camDist) / (zoomFar - zoomNear), 0, 1);
          const visibleSegments = Math.max(8, Math.floor(THREE.MathUtils.lerp(24, entry.segmentCount || 24, zoomT)));
          const heat = this.clusterHeatmapEnabled !== false ? this._clusterGroupHeat(entry) : 0;
          const heatPulse = heat * (0.55 + beat * 0.45);
          const isSelected = index === this.selectedClusterIndex;
          const isHovered = index === this.hoverClusterIndex;
          const colorMix = THREE.MathUtils.clamp((heat * 0.72) + (isSelected ? 0.22 : isHovered ? 0.12 : 0), 0, 0.92);
          const baseColor = entry.baseColor || new THREE.Color(this._clusterAuraColor(entry.cluster));
          const heatColor = entry.heatColor || new THREE.Color(0xff8a54);
          const mixedColor = baseColor.clone().lerp(heatColor, colorMix);
          if (entry.lineGeo && typeof entry.lineGeo.setDrawRange === 'function') {
            entry.lineGeo.setDrawRange(0, visibleSegments * 2);
          }
          (entry.nodeMeshes || []).forEach((nodeMesh) => {
            if (!nodeMesh?.material) return;
            if (nodeMesh.material.color) nodeMesh.material.color.copy(mixedColor);
            nodeMesh.material.opacity = THREE.MathUtils.lerp(0.18, 0.42, zoomT) + beat * 0.12 + heatPulse * 0.18;
            nodeMesh.scale.setScalar(THREE.MathUtils.lerp(0.68, 1.08, zoomT) + beat * 0.18);
          });
          if (entry.lineMat) {
            if (entry.lineMat.color) entry.lineMat.color.copy(mixedColor);
            entry.lineMat.opacity = THREE.MathUtils.lerp(0.04, 0.20, zoomT) + beat * 0.08 + heatPulse * 0.22;
          }
          if (entry.group) {
            entry.group.rotation.y += dt * (0.018 + index * 0.0008);
          }
          if (entry.wireMat) {
            if (entry.wireMat.color) entry.wireMat.color.copy(mixedColor);
            const baseOpacity = this.clusterBoundsVisible ? THREE.MathUtils.lerp(0.14, 0.28, zoomT) : 0;
            const accentOpacity = isSelected ? 0.52 : isHovered ? 0.34 : 0;
            entry.wireMat.opacity = this.clusterBoundsVisible
              ? THREE.MathUtils.clamp(baseOpacity + accentOpacity + beat * 0.08 + heatPulse * 0.28, 0, 0.92)
              : 0;
          }
          const scale = index === this.selectedClusterIndex
            ? 1.05 + beat * 0.035
            : index === this.hoverClusterIndex
              ? 1.025 + beat * 0.02
              : 1;
          const wireMeshes = Array.isArray(entry?.wireMeshes)
            ? entry.wireMeshes
            : (entry?.wireMesh ? [entry.wireMesh] : []);
          wireMeshes.forEach((mesh) => {
            if (!mesh) return;
            mesh.scale.setScalar(scale);
            mesh.visible = !!this.clusterBoundsVisible;
          });
        });

        this.galaxyFleetEntries.forEach((fleetEntry, index) => {
          if (!fleetEntry?.group || !fleetEntry?.fleet) return;
          const fleet = fleetEntry.fleet;
          const pos = fleet.current_pos || {};
          const scale = 0.028;
          const current = new THREE.Vector3(
            (Number(pos.x) || 0) * scale,
            (Number(pos.z) || 0) * scale * 0.42,
            (Number(pos.y) || 0) * scale
          );
          fleetEntry.group.position.copy(current);

          const destination = fleet.returning ? fleetEntry.origin : fleetEntry.target;
          const dir = destination.clone().sub(current);
          if (dir.lengthSq() < 1e-6) {
            dir.set(1, 0, 0);
          } else {
            dir.normalize();
          }
          if (fleetEntry.headingMarker) {
            fleetEntry.headingMarker.quaternion.setFromUnitVectors(
              new THREE.Vector3(1, 0, 0),
              dir
            );
            fleetEntry.headingMarker.rotation.x += Math.sin(this.clock.elapsedTime * 2.3 + fleetEntry.phase) * 0.01;
          }

          if (fleetEntry.headingLine) {
            const dist = current.distanceTo(destination);
            const pulse = 0.9 + 0.2 * Math.sin(this.clock.elapsedTime * 3.1 + fleetEntry.phase);
            fleetEntry.headingLine.scale.x = THREE.MathUtils.clamp(4 + dist * 0.08, 4, 22) * pulse;
            fleetEntry.headingLine.material.opacity = 0.52 + 0.38 * pulse;
          }

          const bob = Math.sin(this.clock.elapsedTime * 1.8 + index + fleetEntry.phase) * 0.22;
          fleetEntry.group.position.y += bob;
        });

        this._syncClusterAuraTransform();
      } else {
        const elapsed = this.clock.elapsedTime;
        this._syncSystemLightState();
        this._syncSystemSkyDome(dt);
        this._updateSystemOrbitTransforms(dt);
        this.systemFacilityEntries.forEach((facility, index) => {
          if (!facility?.group) return;
          facility.group.rotation.y += dt * facility.spin;
          facility.group.rotation.z += dt * (0.08 + index * 0.01);
        });
        this.systemFleetEntries.forEach((fleetEntry, index) => {
          if (!fleetEntry?.group) return;
          const fleet = fleetEntry.fleet || {};
          const originEntry = this.systemPlanetEntries.find((entry) => Number(entry.slot?.position || 0) === Number(fleet.origin_position || 0)) || null;
          const targetEntry = this.systemPlanetEntries.find((entry) => Number(entry.slot?.position || 0) === Number(fleet.target_position || 0)) || null;
          const fromWorld = this._getSystemPlanetWorldPosition(originEntry, new THREE.Vector3());
          const toWorld = this._getSystemPlanetWorldPosition(targetEntry, new THREE.Vector3());
          const tRaw = Number(fleet.current_pos?.progress || 0.5);
          const t = fleet.returning ? 1 - THREE.MathUtils.clamp(tRaw, 0, 1) : THREE.MathUtils.clamp(tRaw, 0, 1);
          const localFrom = this.systemFleetGroup.worldToLocal(fromWorld.clone());
          const localTo = this.systemFleetGroup.worldToLocal(toWorld.clone());
          const pos = localFrom.clone().lerp(localTo, t);
          const drift = new THREE.Vector3(Math.cos(fleetEntry.phase + dt + index), Math.sin(fleetEntry.phase + dt * 0.7) * 0.6, Math.sin(fleetEntry.phase + dt + index));
          pos.add(drift.multiplyScalar(2.8 + index * 0.15));
          fleetEntry.group.position.copy(pos);

          const direction = localTo.clone().sub(localFrom);
          if (direction.lengthSq() < 1e-6) {
            direction.set(1, 0, 0);
          } else {
            direction.normalize();
          }
          if (fleetEntry.headingMarker) {
            fleetEntry.headingMarker.quaternion.setFromUnitVectors(
              new THREE.Vector3(1, 0, 0),
              direction
            );
            fleetEntry.headingMarker.rotation.x += Math.sin(elapsed * 2.4 + fleetEntry.phase) * 0.013;
          }
          if (fleetEntry.headingLine) {
            const legDist = localFrom.distanceTo(localTo);
            const pulse = 0.84 + 0.2 * Math.sin(elapsed * 3 + fleetEntry.phase);
            fleetEntry.headingLine.scale.x = THREE.MathUtils.clamp(3 + legDist * 0.055, 3, 24) * pulse;
            fleetEntry.headingLine.material.opacity = 0.58 + 0.3 * pulse;
          }
        });
        this._syncInstallationAnimationStates(elapsed);
        this._applyPendingInstallationWeaponFire(elapsed);
        this._syncInstallationWeaponFx(elapsed);
        this._tickInstallationParticleFields(elapsed, dt);
        this._tickInstallationBurstFx(elapsed, dt);
        // Upload BeamEffect pool to GPU (Phase FX-3)
        if (this.beamEffect && typeof this.beamEffect.uploadToGPU === 'function') {
          this.beamEffect.uploadToGPU();
        }
        const registry = window.__GQ_ModelRegistry;
        if (registry && typeof registry.tickAnimations === 'function') {
          registry.tickAnimations(this.systemStarInstallationEntries, elapsed, dt);
        }
        this.systemAtmosphereEntries.forEach((entry) => {
          const material = entry.mesh?.material;
          if (!entry.mesh || !material) return;
          const beat = 0.5 + 0.5 * Math.sin(elapsed * entry.pulseSpeed + entry.phase);
          const opacity = entry.baseOpacity + beat * entry.pulseAmplitude;
          if (entry.uniforms?.uTime) entry.uniforms.uTime.value = elapsed;
          if (entry.uniforms?.uOpacity) entry.uniforms.uOpacity.value = THREE.MathUtils.clamp(opacity, 0.02, 0.42);
          else material.opacity = THREE.MathUtils.clamp(opacity, 0.02, 0.42);
          const scaleMul = 1 + ((beat - 0.5) * 2 * entry.scaleAmplitude);
          entry.mesh.scale.copy(entry.baseScale).multiplyScalar(scaleMul);
        });
        this.systemCloudEntries.forEach((entry, index) => {
          const mesh = entry.mesh;
          const material = mesh?.material;
          if (!mesh || !material) return;
          mesh.rotation.y += dt * entry.rotationSpeed;
          mesh.rotation.z = Math.sin(elapsed * (0.22 + index * 0.03) + entry.phase) * 0.03;
          material.opacity = THREE.MathUtils.clamp(entry.baseOpacity + Math.sin(elapsed * 0.7 + entry.phase) * 0.03, 0.05, 0.42);
        });
        if (this.systemBackdrop) this.systemBackdrop.rotation.y += dt * 0.01;
      }

      if (this._kbdMove.forward) { this._zoomTowardsTarget(0.97); this.autoFrameEnabled = false; }
      if (this._kbdMove.back) { this._zoomTowardsTarget(1.03); this.autoFrameEnabled = false; }
      if (this._kbdMove.left) { this._orbitAroundTarget(-0.018, 0); this.autoFrameEnabled = false; }
      if (this._kbdMove.right) { this._orbitAroundTarget(0.018, 0); this.autoFrameEnabled = false; }
      if (this._kbdMove.up) { this._orbitAroundTarget(0, -0.014); this.autoFrameEnabled = false; }
      if (this._kbdMove.down) { this._orbitAroundTarget(0, 0.014); this.autoFrameEnabled = false; }
      if (this._kbdMove.panL) { this.controls.target.x -= 0.85; this.camera.position.x -= 0.85; this.autoFrameEnabled = false; }
      if (this._kbdMove.panR) { this.controls.target.x += 0.85; this.camera.position.x += 0.85; this.autoFrameEnabled = false; }
      if (this._kbdMove.panU) { this.controls.target.z -= 0.85; this.camera.position.z -= 0.85; this.autoFrameEnabled = false; }
      if (this._kbdMove.panD) { this.controls.target.z += 0.85; this.camera.position.z += 0.85; this.autoFrameEnabled = false; }

      const cameraDriverConsumed = this._updateCameraDriver(dt, performance.now());
      if (!cameraDriverConsumed) {
        this._tickFocus(dt);
        this._followTrackedSelection();
        this._updateDoppler(dt);
        this._handleZoomThresholdTransitions();
        this._updateHoverMarker();
        this.controls.update();
      } else {
        this._updateHoverMarker();
        const updCtrl = this.cameraCtrl ? this.cameraCtrl.getDriverUpdateControls() : true;
        if (updCtrl) {
          this.controls.update();
        }
        const roll = this.cameraCtrl ? this.cameraCtrl.getRoll() : 0;
        if (Math.abs(roll) > 1e-6) {
          this.camera.rotation.z += roll;
        }
      }
      
      if (this.postEffects) {
        this.postEffects.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }

      this._tickDebugOverlay();

      if (!this.systemMode && typeof this.opts.onHover === 'function') {
        const activeClusterIndex = this.hoverClusterIndex >= 0 ? this.hoverClusterIndex : this.selectedClusterIndex;
        if (activeClusterIndex >= 0) {
          const activeCluster = this.clusterAuraEntries?.[activeClusterIndex] || null;
          this.opts.onHover(this._clusterPayload(activeCluster, activeClusterIndex), this._clusterWorldScreenPosition(activeCluster));
          return;
        }
        const displayIndex = this._persistentHoverIndexForDistance(this._cameraDistance());
        if (displayIndex >= 0) {
          this.opts.onHover(this.visibleStars[displayIndex], this.getScreenPosition(displayIndex));
        } else {
          this.opts.onHover(null, null);
        }
      }
    }

    destroy() {
      this.destroyed = true;
      this.clearCameraDriver();
      if (this._dbgOverlayEl) {
        this._dbgOverlayEl.style.display = 'none';
        this._dbgOverlayEl = null;
      }
      if (window.GQEngineDebug) {
        delete window.GQEngineDebug;
      }
      if (typeof this.rendererEvents?.unbindEvents === 'function') {
        this.rendererEvents.unbindEvents(this);
      }
      if (this._onResizeBound) window.removeEventListener('resize', this._onResizeBound);
      if (this._onMouseMove) this.renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
      if (this._onClick) this.renderer.domElement.removeEventListener('click', this._onClick);
      if (this._onDoubleClick) this.renderer.domElement.removeEventListener('dblclick', this._onDoubleClick);
      if (this._onMouseDown) this.renderer.domElement.removeEventListener('mousedown', this._onMouseDown);
      if (this._onContextMenu) this.renderer.domElement.removeEventListener('contextmenu', this._onContextMenu, { capture: true });
      if (this._onWheel) this.renderer.domElement.removeEventListener('wheel', this._onWheel);
      if (this._onMouseUp) window.removeEventListener('mouseup', this._onMouseUp);
      if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
      if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp);
      if (this._onCombatWeaponFireEvent) {
        window.removeEventListener('gq:combat:weapon-fire', this._onCombatWeaponFireEvent);
        window.removeEventListener('gq:weapon-fire', this._onCombatWeaponFireEvent);
      }
      if (this._containerResizeObserver) {
        try {
          this._containerResizeObserver.disconnect();
        } catch (_) {}
        this._containerResizeObserver = null;
      }
      this.controls.dispose();
      this.renderer.dispose();
      if (this.coreStars) {
        this.coreStars.geometry.dispose();
        this.coreStars.material.dispose();
      }
      this._clearGroup(this.clusterAuraGroup);
      this._clearGroup(this.galaxyFleetGroup);
      this._clearGroup(this.systemSkyGroup);
      this._clearGroup(this.systemBackdrop);
      this._clearGroup(this.systemOrbitGroup);
      this._clearGroup(this.systemBodyGroup);
      this._clearGroup(this.systemFacilityGroup);
      this._clearGroup(this.systemFleetGroup);
      this.textureManager?.dispose?.();
      this.geometryManager?.dispose?.();
      this.materialFactory?.dispose?.();
      this.lightRigManager?.dispose?.();
      for (const geo of this.vesselGeometryCache.values()) geo?.dispose?.();
      this.vesselGeometryCache.clear();
      this._debugLastByKey.clear();
      if (this.starPoints) {
        this.starPoints.geometry.dispose();
        this.starPoints.material.dispose();
      }
      if (this.hoverMarker) {
        this.hoverMarker.material.map?.dispose();
        this.hoverMarker.material.dispose();
      }
      if (this.selectionMarker) {
        this.selectionMarker.material.map?.dispose();
        this.selectionMarker.material.dispose();
      }
      if (this.ownsRendererCanvas && this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }

    getSystemPlanetsById() {
      if (!this.systemMode) return {};
      const result = {};
      if (!Array.isArray(this.systemPlanetEntries)) return result;

      this.systemPlanetEntries.forEach((entry) => {
        const positionId = Number(entry?.slot?.position || entry?.body?.position || 0);
        if (!Number.isFinite(positionId) || positionId <= 0) return;

        result[positionId] = {
          position: positionId,
          body: entry.body || {},
          slot: entry.slot || {},
          mesh: entry.renderMesh || entry.mesh,
          mesh_visible: entry.renderMesh ? entry.renderMesh.visible : !!entry.mesh,
          refinement_phase: Number((entry.renderMesh || entry.mesh)?.userData?.refinementPhase || 0),
          planet_class: String(entry.body?.planet_class || ''),
          has_player_colony: !!(entry.body?.owner_color || entry.slot?.player_planet?.owner_color),
          owner_color: entry.body?.owner_color || entry.slot?.player_planet?.owner_color || '',
        };
      });

      return result;
    }
  }

  window.Galaxy3DRenderer = Galaxy3DRenderer;
  window.GalaxyRendererCore = Galaxy3DRenderer;
  if (!window.Galaxy3DView) {
    window.Galaxy3DView = Galaxy3DRenderer;
  }
})();
