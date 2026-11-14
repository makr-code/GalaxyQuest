/**
 * starfield-webgpu.js
 *
 * WebGPU compatibility layer for the Starfield renderer.
 *
 * Mirrors the existing starfield.js API so auth and game screens need no
 * code changes.  Routes to the WebGPU path when available, Three.js otherwise.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

(function () {
  'use strict';

  function emitRenderTelemetry(type, payload) {
    const detail = Object.assign({
      type,
      ts: Date.now(),
      source: 'starfield-webgpu',
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

  function generateFallbackStars(count) {
    const c = Math.max(200, Number(count || 1400));
    const stars = [];
    for (let i = 0; i < c; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.8) * 4200;
      stars.push({
        x_ly: Math.cos(a) * r,
        y_ly: Math.sin(a) * r,
      });
    }
    return stars;
  }

  function normalizeStars(stars, menuGalaxy, fixedScale) {
    const list = Array.isArray(stars) && stars.length ? stars : generateFallbackStars(1400);
    let maxAbs = 1;
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i] || {};
      const x = Number(s.x_ly || s.x || 0);
      const y = Number(s.y_ly || s.y || 0);
      maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    }
    const scale = fixedScale || (maxAbs > 0 ? 1 / maxAbs : 1);
    const out = new Float32Array(list.length * 7);
    const spectralColors = {
      O: [0.58, 0.68, 1.0],
      B: [0.68, 0.77, 1.0],
      A: [0.83, 0.87, 1.0],
      F: [1.0, 0.95, 0.82],
      G: [1.0, 0.83, 0.62],
      K: [1.0, 0.66, 0.42],
      M: [1.0, 0.43, 0.28],
      WD: [0.75, 0.84, 1.0],
    };
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i] || {};
      const spectralClass = String(s.spectral_class || '').toUpperCase().slice(0, 1);
      const color = menuGalaxy && Array.isArray(s.display_color)
        ? s.display_color
        : menuGalaxy ? (spectralColors[spectralClass] || [0.76, 0.82, 0.92]) : [0.82, 0.9, 1];
      const luminosityScale = menuGalaxy && Number.isFinite(Number(s.luminosity_solar))
        ? Math.max(0.55, Math.min(1.2, 0.75 + Math.log10(Math.max(0.05, Number(s.luminosity_solar))) * 0.08))
        : 1;
      out.set([
        Number(s.x_ly || s.x || 0) * scale,
        Number(s.y_ly || s.y || 0) * scale,
        ...color,
        menuGalaxy ? (s.display_opacity ?? 0.12) : 1,
        menuGalaxy ? (s.display_size ?? 0.55) * luminosityScale : 1.5,
      ], i * 7);
    }
    return { positions: out, scale, stars: list };
  }

  const MAX_FLIGHT_STARS = 6000;
  const MAX_FLIGHT_VISUAL_STARS = 4500;
  const MAX_FLIGHT_CATALOG_STARS = MAX_FLIGHT_STARS - MAX_FLIGHT_VISUAL_STARS;

  function toStarPosition(star) {
    if (!star || typeof star !== 'object') return null;
    if (star.position && typeof star.position === 'object') {
      return {
        x: Number(star.position.x || 0),
        y: Number(star.position.y || 0),
      };
    }
    return {
      x: Number(star.x_ly || star.x || 0),
      y: Number(star.y_ly || star.y || 0),
    };
  }

  const STARFIELD_SHADER_WGSL = `
    struct ViewUniform {
      pan : vec2<f32>,
      zoom : f32,
      rotation : f32,
      pixelSize : vec2<f32>,
      aspect : f32,
      menuGalaxy : f32,
      horizontalOffset : f32,
    };
    @group(0) @binding(0) var<uniform> uView : ViewUniform;

    struct VSOut {
      @builtin(position) pos : vec4<f32>,
      @location(0) localPos : vec2<f32>,
      @location(1) color : vec4<f32>,
    };

    @vertex
    fn vs_main(
      @builtin(vertex_index) vertexIndex : u32,
      @location(0) inPos : vec2<f32>,
      @location(1) color : vec4<f32>,
      @location(2) size : f32
    ) -> VSOut {
      let corners = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0),
      );
      let corner = corners[vertexIndex];
      var out : VSOut;
      var p = (inPos + uView.pan) * uView.zoom;
      if (uView.menuGalaxy > 0.5) {
        let c = cos(uView.rotation);
        let s = sin(uView.rotation);
        let rotated = vec2<f32>(inPos.x * c - inPos.y * s, inPos.x * s + inPos.y * c);
        p = vec2<f32>(
          (rotated.x + uView.pan.x) * uView.zoom * 1.6 / max(uView.aspect, 0.1) + uView.horizontalOffset,
          (rotated.y + uView.pan.y) * uView.zoom * 0.85
        );
      }
      out.pos = vec4<f32>(p + corner * uView.pixelSize * size, 0.0, 1.0);
      out.localPos = corner;
      out.color = color;
      return out;
    }

    @fragment
    fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
      let radius = length(input.localPos);
      if (radius > 1.0) {
        discard;
      }
      var alpha = 1.0 - smoothstep(0.25, 1.0, radius);
      if (uView.menuGalaxy > 0.5) {
        alpha = (exp(-5.0 * radius * radius) - exp(-5.0)) / (1.0 - exp(-5.0));
      }
      return vec4<f32>(input.color.rgb, alpha * input.color.a);
    }
  `;

  const REGISTRATION_SCENE_WGSL = `
    struct Scene {
      view: vec4<f32>,
      planet: vec4<f32>,
      color: vec4<f32>,
      orbits: array<vec4<f32>, 16>,
    };
    @group(0) @binding(0) var<uniform> scene: Scene;
    struct Output {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
    };
    @vertex fn vs_main(@builtin(vertex_index) index: u32) -> Output {
      let positions = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
      var out: Output;
      out.position = vec4(positions[index], 0.0, 1.0);
      out.uv = positions[index];
      return out;
    }
    fn terrain(p: vec3<f32>) -> f32 {
      let q = p * 3.8 + vec3(scene.planet.z);
      return sin(q.x + sin(q.z * 1.7)) * cos(q.y * 1.5 + sin(q.x))
        + 0.22 * sin(q.x * 4.7 + q.y * 3.2) * sin(q.z * 5.3);
    }
    fn sphereColor(uv: vec2<f32>, progress: f32) -> vec3<f32> {
      let descent = smoothstep(1.0, 2.0, progress);
      let orbitalDistance = mix(30.0, 3.4, smoothstep(0.0, 1.0, progress));
      let distance = mix(orbitalDistance, 1.018, descent);
      let tilt = descent * 1.10;
      let origin = vec3<f32>(0.0, 0.0, distance);
      let forward = vec3<f32>(0.0, sin(tilt), -cos(tilt));
      let up = vec3<f32>(0.0, cos(tilt), sin(tilt));
      let ray = normalize(forward + uv.x * vec3(1.0, 0.0, 0.0) * 0.68 + uv.y * up * 0.68);
      let b = dot(origin, ray);
      let discriminant = b * b - dot(origin, origin) + 1.0;
      if (discriminant < 0.0 || b > 0.0) {
        let glow = exp(-abs(discriminant) * 9.0) * 0.24;
        return scene.color.rgb * glow;
      }
      let hit = origin + ray * (-b - sqrt(discriminant));
      let normal = normalize(hit);
      let height = terrain(normal);
      let ocean = smoothstep(-0.2, 0.05, height);
      let base = mix(vec3(0.018, 0.08, 0.14), scene.color.rgb * (0.32 + height * 0.16), ocean);
      let detail = 0.88 + 0.12 * sin(hit.x * 470.0) * sin(hit.y * 360.0 + hit.z * 250.0);
      let light = max(0.12, dot(normal, normalize(vec3(-0.6, 0.8, 1.4))));
      let clouds = smoothstep(0.72, 1.04, terrain(normal * 1.75 + vec3(scene.view.z * 0.003, 0.0, 0.0)));
      let rim = pow(1.0 - max(0.0, dot(normal, -ray)), 3.0);
      return mix(base * detail, vec3(0.72, 0.78, 0.8), clouds * 0.6) * light
        + scene.color.rgb * rim * 0.35;
    }
    @fragment fn fs_main(input: Output) -> @location(0) vec4<f32> {
      let stage = scene.view.x;
      if (stage < 0.001) { return vec4(0.0); }
      let horizontalOffset = select(0.0, 0.4, scene.view.y > 1.3);
      let uv = vec2(input.uv.x * scene.view.y - horizontalOffset, input.uv.y);
      let approach = smoothstep(0.0, 1.0, stage - 1.0);
      var selectedCenter = vec2<f32>(0.0);
      for (var i = 0u; i < 16u; i++) {
        if (i >= u32(scene.planet.x)) { break; }
        let orbit = scene.orbits[i];
        if (orbit.w > 0.5) {
          selectedCenter = vec2(-0.48 + cos(orbit.y) * orbit.x, 0.1 + sin(orbit.y) * orbit.x * 0.42);
        }
      }
      let systemUv = uv / (1.0 + approach * 16.0) + selectedCenter * approach;
      var system = vec3<f32>(0.0);
      let starDistance = length(systemUv - vec2(-0.48, 0.1));
      let starTint = mix(vec3(1.0, 0.46, 0.18), vec3(0.65, 0.8, 1.0), clamp(scene.view.w, 0.0, 1.0));
      let starSize = clamp(scene.planet.w, 0.4, 2.0);
      system += starTint * (exp(-starDistance * 40.0 / starSize) + exp(-starDistance * 7.0) * 0.12);
      let count = u32(scene.planet.x);
      for (var i = 0u; i < 16u; i++) {
        if (i >= count) { break; }
        let orbit = scene.orbits[i];
        let projected = vec2(systemUv.x + 0.48, (systemUv.y - 0.1) / 0.42);
        let ring = 1.0 - smoothstep(0.001, 0.004, abs(length(projected) - orbit.x));
        system += vec3(0.12, 0.24, 0.3) * ring * 0.25;
        let angle = orbit.y;
        let center = vec2(-0.48 + cos(angle) * orbit.x, 0.1 + sin(angle) * orbit.x * 0.42);
        let radius = orbit.z;
        let delta = (systemUv - center) / radius;
        let disk = 1.0 - smoothstep(0.85, 1.0, length(delta));
        let color = mix(vec3(0.35, 0.4, 0.45), scene.color.rgb, orbit.w);
        system += color * disk * (0.45 + 0.55 * max(0.0, 1.0 - length(delta)));
        if (orbit.w > 0.5) {
          system += scene.color.rgb * (1.0 - smoothstep(0.002, 0.007, abs(length(systemUv - center) - radius * 1.6)));
        }
      }
      let planet = sphereColor(uv, stage - 1.0);
      let opacity = smoothstep(0.0, 1.0, stage);
      return vec4(mix(system, planet, smoothstep(0.2, 0.95, approach)), opacity);
    }
  `;

  class StarfieldWebGPU {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} [opts]
     */
    constructor(canvas, opts = {}) {
      this._canvas  = canvas;
      this._opts    = opts;
      this._backend = null;
      this._delegate = null;
      this._adapter = null;
      this._device = null;
      this._context = null;
      this._pipeline = null;
      this._viewUniformBuffer = null;
      this._viewBindGroup = null;
      this._starBuffer = null;
      this._starCount = 0;
      this._starScale = 1;
      this._rafId = 0;
      this._frameTick = 0;
      this._lastRenderTs = 0;
      this._lastCameraDriverTime = 0;
      this._galaxyRotation = 0;
      this._galaxyHorizontalOffset = 0.4;
      this._registrationScene = null;
      this._flightInitialization = null;
      this._sceneStage = 0;
      this._sceneTarget = 0;
      this._sceneTime = 0;
      this._scenePipeline = null;
      this._sceneBuffer = null;
      this._sceneBindGroup = null;
      const motionPreference = document.body.dataset.startReducedMotion;
      this._reducedMotion = motionPreference !== undefined
        ? motionPreference === 'true'
        : window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      this._onMotionChange = (event) => { this._reducedMotion = event.detail.reduced; };
      window.addEventListener('gq:start-motion', this._onMotionChange);
      this._running = false;
      this._currentTarget = null;
      this._cameraDriver = null;
      this._bloom = null;
      this._flightMotion = null;
      this._followSelection = true;
      this._clusterBoundsVisible = false;
      this._galacticCoreFxEnabled = false;
      this._magnetCfg = {
        hoverMagnetEnabled: true,
        clickMagnetEnabled: true,
        hoverMagnetStarPx: 24,
        hoverMagnetPlanetPx: 30,
        hoverMagnetClusterPx: 28,
        persistentHoverDistance: 16,
      };
      this.systemMode = false;
      this.transitionsEnabled = true;
      this.transitionStableMinMs = 220;
      this._viewState = {
        panX: 0,
        panY: 0,
        zoom: 1,
        targetPanX: 0,
        targetPanY: 0,
        targetZoom: 1,
      };
      this.starPoints = [];
      this.stars = [];
      this._flightStars = [];
      this._spatialLabelStars = [];
      this.renderFrames = {
        world: null,
        galaxy: null,
        system: null,
      };
      this.camera = {
        position: { x: 0, y: 0, z: 1 },
      };
      this.renderer = {
        domElement: canvas,
        clear() {},
      };
      this.ready    = false;
      this._disposed = false;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
      const gpuAvailable = await _probeWebGPU();
      if (this._disposed) return;

      if (gpuAvailable) {
        try {
          await this._initWebGPU();
          if (this._disposed) return;
          this._backend = 'webgpu';
          this.ready = true;
          this.start();
          emitRenderTelemetry('backend-active', { backend: 'webgpu' });
          return;
        } catch (err) {
          if (this._disposed) return;
          if (this._opts.menuGalaxy) throw err;
          emitRenderTelemetry('fallback', {
            from: 'webgpu',
            to: 'webgl2',
            reason: String(err?.message || err || 'webgpu-init-failed'),
          });
        }
      }

      if (this._opts.menuGalaxy) {
        throw new Error('WebGPU is unavailable. Use a WebGPU-capable browser to display the galaxy.');
      }
      this._backend = 'webgl2';
      this.ready    = true;
      emitRenderTelemetry('backend-active', { backend: 'webgl2' });
    }

    /** @returns {'webgpu'|'webgl2'|null} */
    get backendType() { return this._backend; }

    setStars(stars, options = {}) {
      this.stars = Array.isArray(stars) ? stars.slice() : [];
      this.starPoints = this.stars;
      if (this._backend !== 'webgpu' || !this._device) {
        this._prepareFlightStars(this.stars);
        return;
      }
      this._uploadStars(stars, options.preserveScale ? this._starScale : null);
    }

    _sampleFlightGroup(stars, limit) {
      if (stars.length <= limit) return stars.slice();
      const sample = [];
      const stride = (stars.length - 1) / Math.max(1, limit - 1);
      for (let index = 0; index < limit; index += 1) sample.push(stars[Math.round(index * stride)]);
      return sample;
    }

    _prepareFlightStars(stars) {
      const visual = [];
      const catalog = [];
      for (const star of Array.isArray(stars) ? stars : []) {
        (star?.visual_only === true ? visual : catalog).push(star);
      }
      const selected = [
        ...this._sampleFlightGroup(visual, MAX_FLIGHT_VISUAL_STARS),
        ...this._sampleFlightGroup(catalog, MAX_FLIGHT_CATALOG_STARS),
      ].slice(0, MAX_FLIGHT_STARS);
      const target = this._currentTarget || this._regionPreviewTarget;
      if (target && target.visual_only !== true
        && !selected.some((star) => Number(star?.galaxy_index) === Number(target.galaxy_index)
          && Number(star?.system_index) === Number(target.system_index))) {
        const targetStar = catalog.find((star) => Number(star?.galaxy_index) === Number(target.galaxy_index)
          && Number(star?.system_index) === Number(target.system_index));
        if (targetStar && selected.length) selected[selected.length - 1] = targetStar;
      }
      this._flightStars = selected;
      return selected.length;
    }

    setSpatialLabelStars(stars) {
      this._spatialLabelStars = Array.isArray(stars) ? stars.slice() : [];
      this._perspectiveFlight?.setGalaxyLabelStars(this._spatialLabelStars);
      return this._spatialLabelStars.length;
    }

    setNebulaConfiguration(options) {
      this._nebulaField?.configure({ radiusLy: this._opts.galaxyRadiusLy || 50000, ...options });
      return true;
    }

    setCameraTarget(target) {
      this._currentTarget = target || null;
      this.focusOnStar(target, false);
    }
    setRegionPreview(target) {
      this._regionPreviewTarget = target || null;
      if (!target) {
        this.fitCameraToStars();
        return true;
      }
      const position = toStarPosition(target);
      if (!position) return false;
      const x = position.x * this._starScale;
      const y = position.y * this._starScale;
      const c = Math.cos(this._galaxyRotation);
      const s = Math.sin(this._galaxyRotation);
      this._viewState.targetPanX = -(x * c - y * s);
      this._viewState.targetPanY = -(x * s + y * c);
      this._viewState.targetZoom = 4.5;
      if (this._reducedMotion) {
        this._viewState.panX = this._viewState.targetPanX;
        this._viewState.panY = this._viewState.targetPanY;
        this._viewState.zoom = this._viewState.targetZoom;
      }
      return true;
    }
    setRegistrationScene(scene) {
      this._cancelRegistrationTransition();
      const stage = scene?.stage || (scene ? 'region' : 'galaxy');
      const stages = { galaxy: 0, region: 0, system: 1, planet: 2, moon: 2.5, surface: 3 };
      if (!(stage in stages)) return false;
      if (stages[stage] > 0 && (!scene?.draft?.planets?.length
        || !scene.draft.planets.some((planet) => planet.position === scene.draft.position?.position))) return false;
      if ((!scene || (!scene.flightTour && scene.stage !== 'galaxy')) && this._perspectiveFlight) {
        this._perspectiveFlight.dispose();
        if (this._flightInitialization?.flight === this._perspectiveFlight) this._flightInitialization = null;
        this._perspectiveFlight = null;
        this._flightSceneGraph = null;
        this.camera = { position: { x: 0, y: 0, z: 1 } };
      }
      this._registrationScene = scene;
      if (scene?.draft) this._lastSceneDraft = scene.draft;
      this._sceneTarget = stages[stage];
      if (stages[stage] > 0) this._viewState.targetZoom = 6;
      if (this._reducedMotion) {
        this._sceneStage = this._sceneTarget;
        this._viewState.zoom = this._viewState.targetZoom;
      }
      return true;
    }
    _initializePerspectiveFlight(flight) {
      if (!this._device || !flight) return Promise.resolve(false);
      if (this._flightInitialization?.flight === flight) return this._flightInitialization.promise;
      const promise = Promise.resolve(flight.initialize(
        this._device, this._sceneFormat || navigator.gpu.getPreferredCanvasFormat(),
      )).then(() => true).catch((error) => {
        emitRenderTelemetry('spatial-label-init-error', {
          message: String(error?.message || error),
        });
        throw error;
      });
      this._flightInitialization = { flight, promise };
      promise.catch(() => {});
      return promise;
    }
    setFlightScene(scene, { preserveRegistrationTransition = false } = {}) {
      if (!preserveRegistrationTransition) this._cancelRegistrationTransition();
      if (window.GQPerspectiveSpaceFlight) {
        if (scene?.target) {
          this._currentTarget = scene.target;
          this._prepareFlightStars(this.stars);
        }
        if (!this._perspectiveFlight && scene) {
          this._perspectiveFlight = new window.GQPerspectiveSpaceFlight({
            radius: 1 / this._starScale, lensFlare: this._lensFlare, bloom: this._bloom,
            canvas: this._canvas,
          });
          this._perspectiveFlight.setGalaxyLabelStars(this._spatialLabelStars || []);
          this.camera = this._perspectiveFlight.camera;
        }
        if (!scene) {
          this._perspectiveFlight?.stop();
          return true;
        }
        if (this._device) void this._initializePerspectiveFlight(this._perspectiveFlight).catch(() => {});
        if (scene.sceneGraph && scene.sceneGraph !== this._flightSceneGraph) {
          if (!this._perspectiveFlight.setSystem(scene)) return false;
          this._flightSceneGraph = scene.sceneGraph;
        }
        if (this._perspectiveFlight && this._spatialLabelStars.length) {
          this._perspectiveFlight.setGalaxyLabelStars(this._spatialLabelStars);
        }
        return true;
      }
      this._flightSceneGraph = scene?.sceneGraph || null;
      return this.setRegistrationScene(scene);
    }
    setFlightSelection(selection) {
      return this._perspectiveFlight?.setSystemSelection(selection) ?? false;
    }
    setFlightHover(hover) {
      return this._perspectiveFlight?.setSystemHover(hover) ?? false;
    }
    setSystemVisualizationOptions(options) {
      return this._perspectiveFlight?.setSystemVisualizationOptions(options) ?? false;
    }
    setSpatialLabelMode(mode) {
      return this._perspectiveFlight?.setSpatialLabelMode(mode) ?? false;
    }
    setSpatialLabelCallbacks(callbacks) {
      this._perspectiveFlight?.setSpatialLabelCallbacks(callbacks);
    }
    navigateTo(target, options = {}) {
      if (this._registrationTransition) return false;
      if (!this._perspectiveFlight) return false;
      return this._perspectiveFlight.navigate(target, {
        durationSec: (Number(options.durationMs) || 18000) / 1000,
        orbitDurationSec: Math.max(0, Number(options.orbitDurationMs) || 0) / 1000,
        orbitRevolutions: Number(options.orbitRevolutions) || 0.65,
        signal: options.signal,
      });
    }
    async playRegistrationShot(shot) {
      this.cancelRegistrationShot();
      if (this._disposed || !this.ready || !this._device || this._registrationTransition) return false;
      const state = this._registrationCameraShot = { paused: false, finish: this._reducedMotion };
      const snapshot = !this._perspectiveFlight ? this.captureRegistrationView() : null;
      if (!this.setFlightScene({ stage: 'galaxy', flightTour: true })) return false;
      const flight = this._perspectiveFlight;
      const cancelled = new Promise((resolve, reject) => {
        state.cancel = () => resolve(false);
        state.timer = setTimeout(() => reject(new Error('Die 3D-Kamera konnte nicht rechtzeitig vorbereitet werden.')), 10000);
      });
      let ready;
      try {
        ready = await Promise.race([this._initializePerspectiveFlight(flight), cancelled]);
      } finally {
        clearTimeout(state.timer);
        state.cancel = null;
      }
      if (!ready) return false;
      if (this._disposed || this._registrationCameraShot !== state || this._perspectiveFlight !== flight) return false;
      if (snapshot) this._setSpatialCameraFromGalaxyView(snapshot, flight);
      if (shot.kind === 'comet' || shot.kind === 'comet-world') {
        let entity = flight.spaceEntities.get('onboarding-comet');
        if (!entity) {
          const radius = flight.radius;
          const loaded = flight.registerSpaceEntity({
            id: 'onboarding-comet', space_entity: 'comet', model_url: 'procedural:comet',
            route: [[-0.4 * radius, -0.55 * radius, 0.18 * radius], [0.25 * radius, 0.25 * radius, 0.04 * radius]],
            visual_scale_ly: radius * 0.003, segment_duration_seconds: 60,
          });
          entity = flight.spaceEntities.get('onboarding-comet');
          if (!await loaded) return false;
        } else if (entity.assetLoadPromise) await entity.assetLoadPromise;
        if (this._registrationCameraShot !== state) return false;
        if (shot.kind === 'comet') shot = { ...shot, kind: 'follow', target: { kind: 'comet', id: entity.id } };
      }
      if (shot.kind === 'comet-world') {
        flight.cancelCameraShot();
        flight.cameraShot = { kind: shot.kind, paused: state.paused, finishRequested: state.finish };
        return flight.beginRegistrationCometTour({ ...shot, reducedMotion: state.finish });
      }
      if (shot.kind === 'journey' || shot.kind === 'landing') {
        flight.cancelCameraShot();
        flight.cameraShot = { kind: shot.kind, paused: state.paused };
        return flight.beginRegistrationVoyage({ ...shot, landing: shot.kind === 'landing', reducedMotion: state.finish });
      }
      if (shot.kind === 'galaxy') {
        flight.clearSystem();
        this._flightSceneGraph = null;
      }
      if (!flight.setCameraShot(shot, { reducedMotion: state.finish })) return false;
      flight.setCameraShotPaused(state.paused);
      return true;
    }
    pauseRegistrationShot(paused) {
      if (!this._registrationCameraShot) return false;
      this._registrationCameraShot.paused = paused;
      this._perspectiveFlight?.setCameraShotPaused(paused);
      return true;
    }
    finishRegistrationShot() {
      if (!this._registrationCameraShot) return false;
      this._registrationCameraShot.finish = true;
      this._perspectiveFlight?.finishCameraShot();
      return true;
    }
    cancelRegistrationShot() {
      if (!this._registrationCameraShot) return;
      this._registrationCameraShot.cancel?.();
      clearTimeout(this._registrationCameraShot.timer);
      this._registrationCameraShot = null;
      this._perspectiveFlight?.cancelCameraShot();
    }
    fitCameraToStars() {
      this._viewState.targetPanX = 0;
      this._viewState.targetPanY = 0;
      this._viewState.targetZoom = this.systemMode ? 2.25 : 1;
      if (this._reducedMotion) {
        this._viewState.panX = 0;
        this._viewState.panY = 0;
        this._viewState.zoom = this._viewState.targetZoom;
      }
    }
    setTransitionsEnabled(flag) { this.transitionsEnabled = !!flag; }
    setClusterBoundsVisible(flag) { this._clusterBoundsVisible = !!flag; }
    setGalacticCoreFxEnabled(flag) { this._galacticCoreFxEnabled = !!flag; }
    setEmpireHeartbeatSystems() {}
    setCameraDriver(driver) {
      if (!this._registrationTransition) this._cameraDriver = driver || null;
    }
    clearCameraDriver() { this._cameraDriver = null; }
    flyToStar(target, durationMs = 6000) {
      if (this._registrationTransition) return false;
      const position = toStarPosition(target);
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
      const c = Math.cos(this._galaxyRotation);
      const s = Math.sin(this._galaxyRotation);
      const x = position.x * c - position.y * s;
      const y = position.x * s + position.y * c;
      this._flightMotion = {
        targetPanX: Math.max(-1.8, Math.min(1.8, -x * this._starScale)),
        targetPanY: Math.max(-1.8, Math.min(1.8, -y * this._starScale)),
        velocityX: 0,
        velocityY: 0,
        elapsed: 0,
        duration: Math.max(1000, Number(durationMs) || 6000) / 1000,
        speed: 0,
        active: true,
      };
      this._regionPreviewTarget = target;
      this._viewState.targetPanX = this._flightMotion.targetPanX;
      this._viewState.targetPanY = this._flightMotion.targetPanY;
      this._viewState.targetZoom = 4.5;
      return true;
    }
    cancelCameraFlight() {
      this._perspectiveFlight?.stop();
      this._flightMotion = null;
    }
    captureRegistrationView() {
      if (this._disposed) return null;
      const flight = this._perspectiveFlight;
      return {
        renderer: this,
        viewState: { ...this._viewState },
        rotation: this._galaxyRotation,
        horizontalOffset: this._galaxyHorizontalOffset,
        regionTarget: this._regionPreviewTarget,
        currentTarget: this._currentTarget,
        sceneStage: this._sceneStage,
        sceneTarget: this._sceneTarget,
        sceneTime: this._sceneTime,
        registrationScene: this._registrationScene,
        lastSceneDraft: this._lastSceneDraft,
        sceneGraph: this._flightSceneGraph || null,
        stars: this.stars,
        starScale: this._starScale,
        labelStars: this._spatialLabelStars,
        flight,
        entityIds: flight ? new Set(flight.spaceEntities.keys()) : null,
        spatial: flight ? {
          position: flight.camera.position.toArray(),
          quaternion: flight.camera.quaternion.toArray(),
          up: flight.camera.up.toArray(),
          fov: flight.camera.fov,
          origin: flight.origin.toArray(),
        } : null,
      };
    }
    restoreRegistrationView(snapshot, { preserveVessel = false } = {}) {
      if (this._disposed || !snapshot || snapshot.renderer !== this) return false;
      this.cancelRegistrationShot();
      this._cancelRegistrationTransition();
      if (!preserveVessel) {
        this._clearRegistrationTransfer();
        this._registrationArrivalFallback = false;
      }
      this.cancelCameraFlight();
      this._cameraDriver = null;
      this._currentTarget = snapshot.currentTarget;
      this._regionPreviewTarget = snapshot.regionTarget;
      if (this.stars !== snapshot.stars || this._starScale !== snapshot.starScale) {
        this._starScale = snapshot.starScale;
        this.setStars(snapshot.stars, { preserveScale: true });
      } else {
        this._prepareFlightStars(this.stars);
      }
      if (this._spatialLabelStars !== snapshot.labelStars) this.setSpatialLabelStars(snapshot.labelStars);
      if (snapshot.spatial) {
        if (!this._perspectiveFlight && !this.setFlightScene({ flightTour: true, stage: 'galaxy' })) return false;
        const flight = this._perspectiveFlight;
        if (!flight) return false;
        if (!preserveVessel) {
          const vessel = flight.spaceEntities.get('registration-transfer');
          if (vessel && !snapshot.entityIds?.has(vessel.id)) flight._removeSpaceEntity(vessel);
        }
        flight.cameraFollowEntity = null;
        flight.vesselCameraPose = null;
        if (snapshot.sceneGraph) {
          if (snapshot.sceneGraph !== this._flightSceneGraph
            && !flight.setSystem({ flightTour: true, sceneGraph: snapshot.sceneGraph })) return false;
        } else if (this._flightSceneGraph) {
          flight.clearSystem();
        }
        this._flightSceneGraph = snapshot.sceneGraph || null;
        flight.origin.fromArray(snapshot.spatial.origin);
        flight.camera.position.fromArray(snapshot.spatial.position);
        flight.camera.quaternion.fromArray(snapshot.spatial.quaternion);
        flight.camera.up.fromArray(snapshot.spatial.up);
        flight.camera.fov = snapshot.spatial.fov;
        flight.camera.updateProjectionMatrix();
        flight.camera.updateMatrixWorld(true);
        flight.previousView = null;
      } else if (this._perspectiveFlight) {
        this._perspectiveFlight.dispose();
        if (this._flightInitialization?.flight === this._perspectiveFlight) this._flightInitialization = null;
        this._perspectiveFlight = null;
        this._flightSceneGraph = null;
        this.camera = { position: { x: 0, y: 0, z: 1 } };
      }
      this._viewState = { ...snapshot.viewState };
      this._galaxyRotation = snapshot.rotation;
      this._galaxyHorizontalOffset = snapshot.horizontalOffset;
      this._regionPreviewTarget = snapshot.regionTarget;
      this._currentTarget = snapshot.currentTarget;
      this._sceneStage = snapshot.sceneStage;
      this._sceneTarget = snapshot.sceneTarget;
      this._sceneTime = snapshot.sceneTime;
      this._registrationScene = snapshot.registrationScene;
      this._lastSceneDraft = snapshot.lastSceneDraft;
      return true;
    }
    beginRegistrationTransition({ snapshot, reducedMotion = false, onReady = () => {} } = {}) {
      this.cancelRegistrationShot();
      this._cancelRegistrationTransition();
      this._clearRegistrationTransfer();
      this._registrationArrivalFallback = true;
      if (!this.restoreRegistrationView(snapshot, { preserveVessel: true })) return Promise.resolve(false);
      this._viewState.targetPanX = this._viewState.panX;
      this._viewState.targetPanY = this._viewState.panY;
      this._viewState.targetZoom = this._viewState.zoom;
      return new Promise((resolve, reject) => {
        const transition = this._registrationTransition = {
          flight: null, resolve, reject, phase: 'initializing', elapsed: 0, duration: 2.8,
          onReady: typeof onReady === 'function' ? onReady : () => {}, snapshot,
        };
        transition.timer = setTimeout(() => {
          if (this._registrationTransition === transition) this._failRegistrationTransition(transition, snapshot);
        }, 10000);
        void this._startRegistrationArrival(transition, snapshot, reducedMotion || this._reducedMotion)
          .catch((error) => this._failRegistrationTransition(transition, snapshot, error, reject));
      });
    }
    async _startRegistrationArrival(transition, snapshot, reducedMotion) {
      if (!snapshot.spatial) {
        const sceneReady = this._device && this.setFlightScene(
          { flightTour: true, stage: 'galaxy', stars: snapshot.stars },
          { preserveRegistrationTransition: true },
        );
        if (!sceneReady) {
          this._failRegistrationTransition(transition, snapshot);
          return;
        }
        transition.flight = this._perspectiveFlight;
        if (!await this._initializePerspectiveFlight(transition.flight)) {
          this._failRegistrationTransition(transition, snapshot);
          return;
        }
        if (this._registrationTransition !== transition) {
          if (this._perspectiveFlight !== transition.flight) transition.flight.dispose();
          return;
        }
        this._setSpatialCameraFromGalaxyView(snapshot, transition.flight);
      } else {
        transition.flight = this._perspectiveFlight;
        if (!transition.flight) {
          this._failRegistrationTransition(transition, snapshot);
          return;
        }
      }

      if (this._registrationTransition !== transition) return;
      if (reducedMotion) {
        this._registrationArrivalFallback = false;
        transition.onReady();
        this._settleRegistrationTransition(transition, true);
        return;
      }

      const { flight } = transition;
      const camera = flight.camera;
      const direction = camera.getWorldDirection(camera.position.clone());
      const clearance = flight.bodies.reduce((nearest, body) => {
        const center = body.getWorldPosition(camera.position.clone());
        const radius = body.userData.radius * (body.userData.type === 'star' ? 2.6 : 1.08);
        return Math.min(nearest, center.distanceTo(camera.position) - radius);
      }, Infinity);
      const reference = Number.isFinite(clearance) ? clearance
        : Math.max(camera.position.length(), 1 / Math.max(this._starScale, 1e-30));
      const distance = reference * 0.04;
      const precision = Math.max(1, flight.origin.length(), camera.position.length()) * Number.EPSILON * 256;
      if (!Number.isFinite(distance) || distance <= Math.max(precision, camera.near * 100)) {
        this._failRegistrationTransition(transition, snapshot);
        return;
      }
      const scale = distance * Math.tan(camera.fov * Math.PI / 360) * 0.08;
      const anchor = camera.position.clone().addScaledVector(direction, distance).add(flight.origin);
      const id = `registration-transition-${(this._registrationTransferSerial = (this._registrationTransferSerial || 0) + 1)}`;
      const load = flight.registerSpaceEntity({
        id, space_entity: 'vessel',
        model_url: '/generated/trellis2/imported/ship/ship_generic_teaser_transfer_organic_lod0_dev.glb',
        route: [anchor.toArray(), anchor.clone().addScaledVector(direction, scale).toArray()],
        visual_scale_ly: scale, color: [0.62, 0.82, 0.98, 1],
      });
      const entity = flight.spaceEntities.get(id);
      this._registrationTransfer = { flight, entity, anchor, direction, scale };
      transition.phase = 'loading';
      let ready;
      try {
        ready = await load;
      } catch (error) {
        emitRenderTelemetry('registration-transition-asset-error', {
          message: String(error?.message || error),
        });
        this._failRegistrationTransition(transition, snapshot);
        return;
      }
      if (this._registrationTransition !== transition) return;
      if (!ready || flight.spaceEntities.get(id) !== entity) {
        this._failRegistrationTransition(transition, snapshot);
        return;
      }
      const target = flight.resolveTarget({ kind: 'ship', id }, { safeFraming: true });
      if (!target) {
        this._failRegistrationTransition(transition, snapshot);
        return;
      }
      const destinationCamera = camera.clone();
      destinationCamera.position.copy(target.destination);
      destinationCamera.lookAt(target.focus);
      Object.assign(transition, {
        phase: 'moving', elapsed: 0,
        position: camera.position.clone(), quaternion: camera.quaternion.clone(),
        destination: destinationCamera.position.clone(), orientation: destinationCamera.quaternion.clone(),
      });
      transition.onReady();
      clearTimeout(transition.timer);
      transition.timer = setTimeout(() => {
        if (this._registrationTransition === transition) this._advanceRegistrationTransition(0, true);
      }, 4000);
    }
    _setSpatialCameraFromGalaxyView(snapshot, flight) {
      const aspect = Math.max(0.1, this._canvas.clientWidth / Math.max(1, this._canvas.clientHeight));
      const zoom = Math.max(0.45, Number(snapshot.viewState.zoom) || 1);
      const scale = Math.max(1e-30, snapshot.starScale || 1);
      const rotation = Number(snapshot.rotation) || 0;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const rotatedX = -snapshot.viewState.panX / scale - (aspect * 0.25) / (zoom * 1.6 * scale);
      const rotatedY = -snapshot.viewState.panY / scale;
      const targetX = rotatedX * cos + rotatedY * sin;
      const targetY = -rotatedX * sin + rotatedY * cos;
      const camera = flight.camera;
      camera.aspect = aspect;
      const distance = 1 / (scale * zoom * 0.85 * Math.tan(camera.fov * Math.PI / 360));
      camera.up.set(-sin, cos, 0);
      camera.position.set(targetX, targetY, distance);
      camera.lookAt(targetX, targetY, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      flight.origin.set(0, 0, 0);
      flight.previousView = null;
    }
    _settleRegistrationTransition(transition, result) {
      if (this._registrationTransition !== transition) return false;
      this._registrationTransition = null;
      clearTimeout(transition.timer);
      transition.resolve(result);
      return true;
    }
    _failRegistrationTransition(transition, snapshot, error = null, reject = null) {
      if (this._registrationTransition !== transition) return false;
      this._registrationTransition = null;
      clearTimeout(transition.timer);
      this._clearRegistrationTransfer();
      if (error) emitRenderTelemetry('registration-transition-error', {
        message: String(error?.message || error),
      });
      try {
        this.restoreRegistrationView(snapshot);
      } catch (restoreError) {
        emitRenderTelemetry('registration-transition-restore-error', {
          message: String(restoreError?.message || restoreError),
        });
      }
      this._registrationArrivalFallback = true;
      if (reject && error) reject(error);
      else transition.resolve(false);
      return true;
    }
    _clearRegistrationTransfer() {
      const transfer = this._registrationTransfer;
      this._registrationTransfer = null;
      if (transfer?.entity && transfer.flight.spaceEntities.get(transfer.entity.id) === transfer.entity) {
        transfer.flight._removeSpaceEntity(transfer.entity);
      }
    }
    getRegistrationTransferInfo() {
      const transfer = this._registrationTransfer;
      if (!transfer?.entity || transfer.flight !== this._perspectiveFlight
        || transfer.flight.spaceEntities.get(transfer.entity.id) !== transfer.entity
        || !transfer.flight.vesselRenderPass.resources.has(transfer.entity.id)) return null;
      return { id: transfer.entity.id, anchor: transfer.anchor.toArray(),
        direction: transfer.direction.toArray(), scale: transfer.scale };
    }
    registrationArrivalFellBack() {
      return this._registrationArrivalFallback === true;
    }
    updateRegistrationTransfer(descriptor) {
      const info = this.getRegistrationTransferInfo();
      if (!info) return false;
      const flight = this._perspectiveFlight;
      flight.cameraFollowEntity = flight.spaceEntities.get(info.id);
      void flight.registerSpaceEntity({ ...descriptor, id: info.id, registration_vessel: true,
        follow_camera: true, smooth_camera_handoff: true }).catch((error) => {
        emitRenderTelemetry('space-entity-load-error', { message: String(error?.message || error) });
      });
      return true;
    }
    _advanceRegistrationTransition(dt, finish = false) {
      const transition = this._registrationTransition;
      if (!transition) return false;
      if (transition.phase === 'loading') {
        if (finish) this._cancelRegistrationTransition();
        return true;
      }
      try {
        transition.elapsed = finish ? transition.duration : Math.min(transition.duration, transition.elapsed + dt);
        const progress = transition.elapsed / transition.duration;
        const eased = progress * progress * (3 - 2 * progress);
        const camera = transition.flight.camera;
        camera.position.copy(transition.position).lerp(transition.destination, eased);
        camera.quaternion.copy(transition.quaternion).slerp(transition.orientation, eased);
        camera.updateMatrixWorld(true);
        if (progress !== 1) return true;
        this._registrationTransition = null;
        this._registrationArrivalFallback = false;
        clearTimeout(transition.timer);
        transition.resolve(true);
      } catch (error) {
        this._failRegistrationTransition(transition, transition.snapshot, error, transition.reject);
      }
      return true;
    }
    _cancelRegistrationTransition() {
      const transition = this._registrationTransition;
      if (!transition) return false;
      this._registrationTransition = null;
      clearTimeout(transition.timer);
      this._clearRegistrationTransfer();
      transition.resolve(false);
      return true;
    }
    skipRegistrationTransition() {
      return this._advanceRegistrationTransition(0, true);
    }
    getFlightTelemetry() {
      if (this._perspectiveFlight) return { ...this._perspectiveFlight.telemetry, spatial: true,
        position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray(),
        origin: this._perspectiveFlight.origin.toArray(), instances: this._perspectiveFlight.renderedInstances || 0,
        renderBenchmark: this._perspectiveFlight.getRenderBenchmark() };
      const flight = this._flightMotion;
      if (!flight) return { phase: 'idle', speedNorm: 0, speed: 0 };
      const progress = Math.min(1, flight.elapsed / flight.duration);
      const phase = progress < 0.2 ? 'acquire' : progress > 0.72 ? 'brake' : 'cruise';
      return { phase, speedNorm: Math.min(1, flight.speed), speed: flight.speed };
    }
    getSpatialLabels() {
      return this._perspectiveFlight?.currentLabels?.slice() || [];
    }
    getSpaceView() { return this._perspectiveFlight; }
    async startHeroBattlePreview(options = {}) {
      const { startHeroBattlePreview } = await import('./system-battle-preview.js');
      return startHeroBattlePreview(this, options);
    }
    async startBattleEncounterPresentation(encounter) {
      const { startBattleEncounterPresentation } = await import('./battle-encounter-presentation.js');
      return startBattleEncounterPresentation(this, encounter);
    }
    async startLiveBattleWebGpu(api, journalId, options) {
      const { startLiveBattleWebGpu } = await import('./live-battle-webgpu.js');
      return startLiveBattleWebGpu(this, api, journalId, options);
    }
    getSharedZoomBackend() {
      return {
        device: this._device, context: this._context, externalCameraControls: true,
        getCapabilities: () => ({ webgpu: true }),
        addFrameHook: (hook) => {
          this._gameFrameHooks ||= new Set();
          this._gameFrameHooks.add(hook);
          return () => this._gameFrameHooks.delete(hook);
        },
        setZoomSceneActive: (active) => { this._gameZoomSceneActive = active; },
      };
    }
    getFlightCoordinates() {
      return this._perspectiveFlight?.getFlightCoordinates?.() || null;
    }
    restoreFlightCoordinates(coordinates) {
      return this._perspectiveFlight?.restoreFlightCoordinates?.(coordinates) ?? false;
    }
    setClusterColorPalette() {}
    setClusterDensityMode() {}
    setClusterAuras() {}
    setSpaceEntities(entities = []) {
      this._cancelRegistrationTransition();
      if (!this._perspectiveFlight) return false;
      const result = this._perspectiveFlight.setSpaceEntities(entities);
      if (result && typeof result.then === 'function') {
        result.catch((error) => emitRenderTelemetry('space-entity-load-error', {
          message: String(error?.message || error),
        }));
      }
      return result !== false;
    }
    setSpaceVessels(vessels = []) { return this.setSpaceEntities(vessels); }
    setGalaxyFleets(fleets = []) {
      this._cancelRegistrationTransition();
      if (!this._perspectiveFlight) return false;
      const result = this._perspectiveFlight.setGalaxyFleets(fleets);
      if (result && typeof result.then === 'function') {
        result.catch((error) => emitRenderTelemetry('space-entity-load-error', {
          message: String(error?.message || error),
        }));
      }
      return result !== false;
    }
    setGalaxyFleetVectorsVisible() {}
    setFtlInfrastructure() {}
    focusCurrentSelection() {}
    focusOnStar(star, immediate = false) {
      this._currentTarget = star || null;
      const pos = toStarPosition(star);
      if (!pos) return;
      const tx = -pos.x * this._starScale;
      const ty = -pos.y * this._starScale;
      if (Number.isFinite(tx)) this._viewState.targetPanX = tx;
      if (Number.isFinite(ty)) this._viewState.targetPanY = ty;
      if (immediate) {
        this._viewState.panX = this._viewState.targetPanX;
        this._viewState.panY = this._viewState.targetPanY;
      }
    }
    focusOnSystemPlanet(target, immediate = false) {
      this.focusOnStar(target, immediate);
      this.enterSystemView();
    }
    enterSystemView() {
      this.systemMode = true;
      this._viewState.targetZoom = Math.max(this._viewState.targetZoom, 2.25);
    }
    exitSystemView() {
      this.systemMode = false;
      this._viewState.targetZoom = Math.min(this._viewState.targetZoom, 1.2);
    }
    resetNavigationView() {
      this.systemMode = false;
      this._currentTarget = null;
      this._viewState.targetPanX = 0;
      this._viewState.targetPanY = 0;
      this._viewState.targetZoom = 1;
    }
    toggleFollowSelection() { this._followSelection = !this._followSelection; return this._followSelection; }
    isFollowingSelection() { return !!this._followSelection; }
    setHoverMagnetConfig(cfg = {}) {
      this._magnetCfg = Object.assign({}, this._magnetCfg, cfg || {});
      this.hoverMagnetEnabled = !!this._magnetCfg.hoverMagnetEnabled;
      this.clickMagnetEnabled = !!this._magnetCfg.clickMagnetEnabled;
      this.hoverMagnetStarPx = Number(this._magnetCfg.hoverMagnetStarPx || 24);
      this.hoverMagnetPlanetPx = Number(this._magnetCfg.hoverMagnetPlanetPx || 30);
      this.hoverMagnetClusterPx = Number(this._magnetCfg.hoverMagnetClusterPx || 28);
      this.persistentHoverDistance = Number(this._magnetCfg.persistentHoverDistance || 16);
    }
    areClusterBoundsVisible() { return !!this._clusterBoundsVisible; }
    areGalacticCoreFxEnabled() { return !!this._galacticCoreFxEnabled; }
    nudgeOrbit(dir = 1) {
      const s = Number(dir || 1) >= 0 ? 1 : -1;
      this._viewState.targetPanX += 0.012 * s;
      this._viewState.targetPanY += 0.004 * s;
    }
    nudgePan(dx = 0, dy = 0) {
      this._viewState.targetPanX += Number(dx || 0) * 0.02;
      this._viewState.targetPanY += Number(dy || 0) * 0.02;
    }
    nudgeZoom(delta = 0) {
      const next = this._viewState.targetZoom + (Number(delta || 0) * 0.12);
      this._viewState.targetZoom = Math.max(0.45, Math.min(6, next));
    }
    getQualityProfileState() {
      return {
        name: 'webgpu-experimental',
        label: 'WebGPU Experimental',
      };
    }
    getRenderStats() {
      return {
        backend: this._backend || 'unknown',
        qualityProfile: 'webgpu-experimental',
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        cameraDistance: Number(1 / Math.max(0.0001, this._viewState.zoom || 1)),
        rawStars: this.stars.length,
        visibleStars: this._starCount,
        frameTick: this._frameTick,
      };
    }
    resize() {
      if (!this._canvas || !this._context || !this._device) return;
      this._configureContext();
    }

    start() {
      if (this._backend !== 'webgpu' || this._running) return;
      this._running = true;
      const tick = (timestamp) => {
        if (!this._running) return;
        this._rafId = requestAnimationFrame(tick);
        this._renderFrame(timestamp);
      };
      this._rafId = requestAnimationFrame(tick);
    }

    stop() {
      this._cancelRegistrationTransition();
      this._running = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
      }
      this._rafId = 0;
    }

    dispose() {
      this.cancelRegistrationShot();
      this._disposed = true;
      this.stop();
      this._perspectiveFlight?.dispose();
      this._flightInitialization = null;
      this._bloom?.dispose();
      this._bloom = null;
      this._lensFlare?.dispose();
      this._lensFlare = null;
      this._nebulaField?.dispose();
      this._nebulaField = null;
      window.removeEventListener('gq:start-motion', this._onMotionChange);
      try {
        if (this._starBuffer) {
          this._starBuffer.destroy();
          this._starBuffer = null;
        }
      } catch (_) {}
      this._pipeline = null;
      this._sceneBuffer?.destroy();
      this._sceneBuffer = null;
      this._scenePipeline = null;
      this._sceneBindGroup = null;
      this._viewUniformBuffer = null;
      this._viewBindGroup = null;
      this._context = null;
      this._adapter = null;
      this._device?.destroy?.();
      this._device = null;
      this._currentTarget = null;
      this._cameraDriver = null;
      this.ready = false;
    }

    destroy() {
      this.dispose();
    }

    async _initWebGPU() {
      if (!this._canvas) {
        throw new Error('missing canvas');
      }
      this._adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (this._disposed) return;
      if (!this._adapter) {
        throw new Error('no webgpu adapter');
      }
      const filterableFloat16 = this._adapter.features?.has('float16-filterable') === true;
      const device = await this._adapter.requestDevice({
        requiredFeatures: [
          ...(filterableFloat16 ? ['float16-filterable'] : []),
          ...(this._adapter.features?.has('timestamp-query') ? ['timestamp-query'] : []),
        ],
      });
      if (this._disposed) { device.destroy(); return; }
      this._device = device;
      // rgba16float is filterable in core WebGPU; float32 filtering is the optional feature.
      this._sceneFormat = 'rgba16float';
      this._context = this._canvas.getContext('webgpu');
      if (!this._context) {
        throw new Error('webgpu canvas context unavailable');
      }
      this._configureContext();

      const shader = this._device.createShaderModule({
        code: STARFIELD_SHADER_WGSL,
      });

      this._pipeline = this._device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shader,
          entryPoint: 'vs_main',
          buffers: [{
            arrayStride: 28,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x4' },
              { shaderLocation: 2, offset: 24, format: 'float32' },
            ],
          }],
        },
        fragment: {
          module: shader,
          entryPoint: 'fs_main',
          targets: [{
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: {
          topology: 'triangle-strip',
        },
      });

      this._viewUniformBuffer = this._device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this._viewBindGroup = this._device.createBindGroup({
        layout: this._pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this._viewUniformBuffer } }],
      });

      const sceneShader = this._device.createShaderModule({ code: REGISTRATION_SCENE_WGSL, label: 'registration-flight' });
      if (sceneShader.getCompilationInfo) {
        const info = await sceneShader.getCompilationInfo();
        if (this._disposed) return;
        const errors = info.messages.filter((message) => message.type === 'error');
        if (errors.length) throw new Error(`Registration shader: ${errors.map((error) => error.message).join('; ')}`);
      }
      this._scenePipeline = this._device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: sceneShader, entryPoint: 'vs_main' },
        fragment: {
          module: sceneShader, entryPoint: 'fs_main',
          targets: [{
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      });
      this._sceneBuffer = this._device.createBuffer({ size: 304, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this._sceneBindGroup = this._device.createBindGroup({
        layout: this._scenePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this._sceneBuffer } }],
      });
      this._uploadStars(this._opts?.stars || []);
      if (this._opts.menuGalaxy && window.GQGalaxyNebulaField) {
        this._nebulaField = new window.GQGalaxyNebulaField({
          radiusLy: this._opts.galaxyRadiusLy || 50000,
          armCount: this._opts.armCount,
          pitchAngleDeg: this._opts.pitchAngleDeg,
        });
        await this._nebulaField.init(this._device, navigator.gpu.getPreferredCanvasFormat(), null, this._sceneFormat);
        if (this._disposed) return;
      }
      if (this._opts.menuGalaxy && window.GQLensFlarePass?.LensFlarePass) {
        const response = await fetch(new URL('js/engine/post-effects/shaders/lensflare.wgsl', document.baseURI));
        if (this._disposed) return;
        if (!response.ok) throw new Error(`Lens flare shader: HTTP ${response.status}`);
        this._lensFlare = new window.GQLensFlarePass.LensFlarePass({ globalScale: 0.9 });
        const shaderSource = await response.text();
        if (this._disposed) return;
        await this._lensFlare.initialize(this._device, this._sceneFormat, shaderSource);
        if (this._disposed) return;
      }
      if (this._opts.menuGalaxy && window.GQPerspectiveBloom) {
        const [bloomResponse, compositeResponse] = await Promise.all([
          fetch(new URL('js/engine/post-effects/shaders/bloom.wgsl', document.baseURI)),
          fetch(new URL('js/engine/post-effects/shaders/bloom-composite.wgsl', document.baseURI)),
        ]);
        if (this._disposed) return;
        if (!bloomResponse.ok || !compositeResponse.ok) throw new Error('Bloom shaders could not be loaded');
        const [bloomSource, compositeSource] = await Promise.all([bloomResponse.text(), compositeResponse.text()]);
        if (this._disposed) return;
        this._bloom = new window.GQPerspectiveBloom();
        await this._bloom.initialize(this._device, navigator.gpu.getPreferredCanvasFormat(),
          bloomSource, compositeSource, this._sceneFormat);
      }
    }

    _configureContext() {
      const format = navigator.gpu.getPreferredCanvasFormat();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this._canvas.getBoundingClientRect();
      this._canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      this._canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      this._context.configure({
        device: this._device,
        format,
        alphaMode: 'premultiplied',
      });
    }

    _uploadStars(stars, fixedScale) {
      if (!this._device) return;
      const normalized = normalizeStars(stars, this._opts.menuGalaxy, fixedScale);
      this._starScale = Number(normalized.scale || 1);
      this.stars = Array.isArray(normalized.stars) ? normalized.stars.slice() : [];
      this.starPoints = this.stars;
      this._prepareFlightStars(this.stars);
      this._starCount = Math.floor(normalized.positions.length / 7);
      if (this._starBuffer) {
        this._starBuffer.destroy();
        this._starBuffer = null;
      }
      if (!this._starCount) {
        return;
      }
      this._starBuffer = this._device.createBuffer({
        size: normalized.positions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this._device.queue.writeBuffer(this._starBuffer, 0, normalized.positions.buffer, normalized.positions.byteOffset, normalized.positions.byteLength);
    }

    _renderFrame(timestamp = performance.now()) {
      if (!this._device || !this._context || !this._pipeline || !this._starBuffer || !this._viewUniformBuffer || !this._viewBindGroup || this._starCount <= 0) {
        return;
      }

      const now = Number.isFinite(Number(timestamp)) ? Number(timestamp) : performance.now();
      const dt = this._lastCameraDriverTime
        ? Math.max(0, Math.min(0.048, (now - this._lastCameraDriverTime) / 1000))
        : (1 / 60);
      this._lastCameraDriverTime = now;
      if (this._gameZoomSceneActive) {
        for (const hook of this._gameFrameHooks || []) hook(dt);
        this._frameTick++;
        return;
      }
      if (this._perspectiveFlight) {
        if (this._registrationTransition) this._advanceRegistrationTransition(dt);
        else if (!this._reducedMotion) this._perspectiveFlight.update(dt);
        this._perspectiveFlight?.renderFrame(this._device, this._context, this._flightStars,
          this._canvas.width, this._canvas.height, this._nebulaField,
          this._canvas.width / Math.max(1, this._canvas.clientWidth));
        this._frameTick++;
        for (const hook of this._gameFrameHooks || []) hook(dt);
        return;
      }
      if (this._opts.menuGalaxy && !this._reducedMotion && !this._regionPreviewTarget) {
        // The loading arms wind toward increasing angles, so rotation must be negative for trailing arms.
        this._galaxyRotation -= dt * 0.035;
      }

      if (this._cameraDriver && typeof this._cameraDriver.update === 'function') {
        try {
          const pose = this._cameraDriver.update({
            renderer: this,
            camera: this.camera,
            target: this._currentTarget,
            dt,
            now,
          });
          const position = pose?.position;
          if (position) {
            const x = Number(position.x);
            const y = Number(position.y);
            const z = Number(position.z);
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
              this.camera.position.x = x;
              this.camera.position.y = y;
              this.camera.position.z = z;
              this._viewState.targetPanX = Math.max(-1.8, Math.min(1.8, -x * this._starScale));
              this._viewState.targetPanY = Math.max(-1.8, Math.min(1.8, -y * this._starScale));
            }
          }
        } catch (error) {
          emitRenderTelemetry('camera-driver-error', {
            backend: this._backend,
            message: String(error?.message || error),
          });
        }
      }

      const smooth = this._reducedMotion ? 1 : 0.14;
      if (!this._flightMotion?.active) {
        this._viewState.panX += (this._viewState.targetPanX - this._viewState.panX) * smooth;
        this._viewState.panY += (this._viewState.targetPanY - this._viewState.panY) * smooth;
      }
      this._viewState.zoom += (this._viewState.targetZoom - this._viewState.zoom) * smooth;

      const flight = this._flightMotion;
      if (flight?.active && !this._reducedMotion) {
        flight.elapsed += dt;
        const remaining = Math.max(0.001, flight.duration - flight.elapsed);
        const stepAxis = (current, velocity, target) => {
          const distance = target - current;
          const direction = Math.sign(distance);
          const brakingSpeed = Math.sqrt(Math.max(0, 2 * 1.1 * Math.abs(distance)));
          const desiredSpeed = direction * Math.min(0.9, brakingSpeed, Math.abs(distance) / remaining);
          const nextVelocity = velocity + Math.max(-0.75 * dt, Math.min(0.75 * dt, desiredSpeed - velocity));
          return [current + nextVelocity * dt, nextVelocity];
        };
        [this._viewState.panX, flight.velocityX] = stepAxis(this._viewState.panX, flight.velocityX, flight.targetPanX);
        [this._viewState.panY, flight.velocityY] = stepAxis(this._viewState.panY, flight.velocityY, flight.targetPanY);
        flight.speed = Math.min(1, Math.hypot(flight.velocityX, flight.velocityY));
        const remainingDistance = Math.hypot(flight.targetPanX - this._viewState.panX, flight.targetPanY - this._viewState.panY);
        if (flight.elapsed >= flight.duration || remainingDistance < 0.002) {
          this._viewState.panX = flight.targetPanX;
          this._viewState.panY = flight.targetPanY;
          flight.velocityX = 0;
          flight.velocityY = 0;
          flight.speed = 0;
          flight.active = false;
        }
      }

      const panClamp = 1.8;
      this._viewState.panX = Math.max(-panClamp, Math.min(panClamp, this._viewState.panX));
      this._viewState.panY = Math.max(-panClamp, Math.min(panClamp, this._viewState.panY));
      this._viewState.zoom = Math.max(0.45, Math.min(6, this._viewState.zoom));
      // Move at a bounded speed across every intervening scale, including reverse flights.
      const difference = this._sceneTarget - this._sceneStage;
      this._sceneStage += this._reducedMotion ? difference : Math.sign(difference) * Math.min(Math.abs(difference), dt * 0.55);
      if (!this._reducedMotion) this._sceneTime += dt;

      const horizontalTarget = this._registrationScene && !this._registrationScene.flightTour ? 0 : 0.4;
      const horizontalDifference = horizontalTarget - this._galaxyHorizontalOffset;
      this._galaxyHorizontalOffset += this._reducedMotion || Math.abs(horizontalDifference) < 0.0001
        ? horizontalDifference : horizontalDifference * (1 - Math.exp(-dt * 6));
      const viewUniform = new Float32Array([
        this._viewState.panX,
        this._viewState.panY,
        this._viewState.zoom,
        this._galaxyRotation,
        2 / Math.max(1, this._canvas.width),
        2 / Math.max(1, this._canvas.height),
        this._canvas.width / Math.max(1, this._canvas.height),
        this._opts.menuGalaxy ? 1 : 0,
        this._galaxyHorizontalOffset, 0, 0, 0,
      ]);
      this._device.queue.writeBuffer(this._viewUniformBuffer, 0, viewUniform.buffer, 0, viewUniform.byteLength);

      const encoder = this._device.createCommandEncoder();
      const view = this._context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0, g: 0, b: 0, a: this._opts.menuGalaxy ? 1 : 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      if (this._nebulaField) {
        const projection = this._nebulaField.overviewProjection({
          scale: this._starScale, zoom: this._viewState.zoom, rotation: this._galaxyRotation,
          panX: this._viewState.panX, panY: this._viewState.panY,
          aspect: this._canvas.width / Math.max(1, this._canvas.height),
          horizontalOffset: this._galaxyHorizontalOffset,
        });
        this._nebulaField.render(pass, this._device, projection, {
          width: this._canvas.width, height: this._canvas.height, time: this._sceneTime,
        });
      }
      pass.setPipeline(this._pipeline);
      pass.setBindGroup(0, this._viewBindGroup);
      pass.setVertexBuffer(0, this._starBuffer);
      pass.draw(4, this._starCount, 0, 0);
      if (this._sceneStage > 0 && this._scenePipeline) {
        const draft = this._registrationScene?.draft;
        const sceneSystem = this._flightSceneGraph?.children?.find((node) => node.type === 'system');
        const scenePlanets = sceneSystem?.children?.filter((node) => node.type === 'planet') || [];
        const planets = draft?.planets?.length
          ? draft.planets
          : scenePlanets.length
            ? scenePlanets.map((node) => node.data).filter(Boolean)
            : this._lastSceneDraft?.planets || [];
        if (draft) this._lastSceneDraft = draft;
        const data = draft || this._lastSceneDraft;
        const selected = planets.find((planet) => planet.position === data?.position.position);
        const selectedPlanetNode = scenePlanets.find((node) => node.data?.position === selected?.position);
        const moonNode = selectedPlanetNode?.children?.find((node) => node.type === 'moon');
        const selectedMoon = this._registrationScene?.stage === 'moon'
          ? moonNode?.data || selected?.moons?.[0]
          : null;
        const body = selectedMoon || selected;
        const palette = body?.class?.startsWith('ice_') ? [0.55, 0.75, 0.85]
          : body?.class === 'lava' ? [0.72, 0.24, 0.08]
          : body?.class === 'ocean' ? [0.16, 0.4, 0.65] : [0.22, 0.52, 0.33];
        const uniforms = new Float32Array(76);
        uniforms.set([this._sceneStage, this._canvas.width / Math.max(1, this._canvas.height), this._sceneTime,
          ((data?.star?.temperature_k || 5778) - 2500) / 10000,
          Math.min(16, planets.length), selected?.position || 1,
          selectedMoon?.position || ((data?.position.galaxy || 1) * 131 + (data?.position.system || 1) * 17 + (selected?.position || 1)) % 997,
          data?.star?.radius_solar || 1, ...palette, 1]);
        const maxOrbit = Math.max(1, ...planets.map((planet) => planet.semi_major_axis_au || planet.position));
        planets.slice(0, 16).forEach((planet, index) => {
          uniforms.set([
            0.15 + 1.15 * Math.sqrt((planet.semi_major_axis_au || planet.position) / maxOrbit),
            planet.position * 2.39996, 0.012 + Math.min(0.025, (planet.diameter_km || 12000) / 1000000),
            planet.position === data?.position.position ? 1 : 0,
          ], 12 + index * 4);
        });
        this._device.queue.writeBuffer(this._sceneBuffer, 0, uniforms);
        pass.setPipeline(this._scenePipeline);
        pass.setBindGroup(0, this._sceneBindGroup);
        pass.draw(3);
      }
      pass.end();
      this._device.queue.submit([encoder.finish()]);

      this._frameTick += 1;
      if (!this._lastRenderTs || (now - this._lastRenderTs) > 5000) {
        this._lastRenderTs = now;
        emitRenderTelemetry('frame-heartbeat', {
          backend: 'webgpu',
          stars: this._starCount,
          frameTick: this._frameTick,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------

  async function _probeWebGPU() {
    if (window.__GQ_WEBGPU_ADAPTER_AVAILABLE && typeof window.__GQ_WEBGPU_ADAPTER_AVAILABLE.value === 'boolean') {
      return window.__GQ_WEBGPU_ADAPTER_AVAILABLE.value;
    }
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try {
      const value = (await navigator.gpu.requestAdapter()) !== null;
      window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value };
      return value;
    } catch {
      window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: false };
      return false;
    }
  }

  window.StarfieldWebGPU = StarfieldWebGPU;
})();
