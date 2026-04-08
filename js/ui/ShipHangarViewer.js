'use strict';
/**
 * ShipHangarViewer
 *
 * Embeds a Three.js WebGL scene into a <canvas> element that shows a
 * ship hull rotating slowly in a dimly-lit shipyard hangar.
 *
 * Module visual effects (applied in real-time):
 *   weapon    → glowing cannon barrels on weapon hardpoints
 *   shield    → translucent hex-bubble sphere around the hull
 *   engine    → bright cyan/blue emissive engine-glow cones at thruster points
 *   utility   → yellow cargo-pod boxes on utility hardpoints
 *
 * Usage
 * -----
 *   const viewer = new ShipHangarViewer(canvas, { THREE, fetchModelDescriptor });
 *   await viewer.loadHull('corvette');
 *   viewer.applyModules({ weapon: 2, shield: 1, engine: 1, utility: 0 });
 *   // call viewer.dispose() when removing the canvas
 */

/* global THREE */
(function () {
  // ── Hull-class → model-id mapping ──────────────────────────────────────────
  const HULL_MODEL_MAP = {
    corvette:   'ship_corvette',
    frigate:    'ship_frigate',
    destroyer:  'ship_destroyer',
    cruiser:    'ship_cruiser',
  };

  // Fallback for unknown hull classes – use corvette silhouette
  const DEFAULT_HULL_MODEL = 'ship_corvette';

  // ── Module visual descriptors ──────────────────────────────────────────────
  const MODULE_VISUALS = {
    weapon: {
      color:     0xff3a0a,
      emissive:  0xff2200,
      emissiveIntensity: 1.4,
      metalness: 0.7,
      roughness: 0.25,
      geometry: { type: 'CylinderGeometry', radiusTop: 0.04, radiusBottom: 0.06, height: 0.55, radialSegments: 6 },
      rotation: [Math.PI / 2, 0, 0],
      // additional point-light per hardpoint
      light: { color: 0xff2200, intensity: 0.5, distance: 1.8 },
    },
    shield: {
      // Rendered as a single translucent sphere around the whole ship
      color:     0x22aaff,
      emissive:  0x0077cc,
      emissiveIntensity: 0.55,
      metalness: 0.0,
      roughness: 1.0,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: 'DoubleSide',
      wireframe: false,
      // size relative to hull bounding-sphere radius
      radiusScale: 1.35,
      light: { color: 0x2299ff, intensity: 0.3, distance: 6.0 },
    },
    engine: {
      color:     0x00cfff,
      emissive:  0x00aaff,
      emissiveIntensity: 2.2,
      metalness: 0.5,
      roughness: 0.15,
      transparent: true,
      opacity: 0.92,
      geometry: { type: 'ConeGeometry', radius: 0.22, height: 0.55, radialSegments: 8 },
      rotation: [Math.PI, 0, 0],
      light: { color: 0x00ccff, intensity: 0.8, distance: 2.5 },
    },
    utility: {
      color:     0xffcc22,
      emissive:  0xdd9900,
      emissiveIntensity: 0.5,
      metalness: 0.55,
      roughness: 0.45,
      geometry: { type: 'BoxGeometry', width: 0.28, height: 0.22, depth: 0.38 },
      rotation: [0, 0, 0],
      light: null,
    },
  };

  // ── ShipHangarViewer class ──────────────────────────────────────────────────

  class ShipHangarViewer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{
     *   THREE: object,
     *   fetchModelDescriptor: (modelId: string) => Promise<object>,
     *   autoRotate?: boolean,
     * }} opts
     */
    constructor(canvas, opts = {}) {
      if (!canvas || !opts.THREE) throw new Error('ShipHangarViewer: canvas and opts.THREE are required');

      this._canvas  = canvas;
      this._THREE   = opts.THREE;
      this._fetchFn = opts.fetchModelDescriptor || null;
      this._disposed = false;

      /** @type {THREE.Group|null} */
      this._shipGroup = null;
      /** @type {THREE.Group|null} */
      this._moduleGroup = null;
      /** @type {THREE.Mesh|null} */
      this._shieldBubble = null;
      /** @type {Array<THREE.Light>} */
      this._moduleLights = [];
      /** @type {THREE.AnimationMixer|null} */
      this._mixer = null;
      /** @type {number} */
      this._boundingSphereRadius = 2.0;

      this._moduleState = {};

      this._autoRotate = opts.autoRotate !== false;
      this._autoRotateSpeed = 0.28; // rad/s

      // Mouse drag orbit
      this._isDragging  = false;
      this._prevMouseX  = 0;
      this._prevMouseY  = 0;
      this._orbitAzimuth   = 0;
      this._orbitElevation = 0.22;

      this._rafId = null;
      this._clock = null;

      this._init();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Load a hull by class name (corvette | frigate | destroyer | cruiser | …)
     * Falls back to corvette if the class is unknown.
     * @param {string} hullClass
     * @returns {Promise<void>}
     */
    async loadHull(hullClass) {
      const modelId = HULL_MODEL_MAP[String(hullClass).toLowerCase()] || DEFAULT_HULL_MODEL;
      await this._loadModel(modelId);
    }

    /**
     * Apply module visual effects based on a slot-count map.
     * Only slots with count > 0 activate the corresponding effect.
     * @param {{ weapon?: number, shield?: number, engine?: number, utility?: number, [key: string]: number }} slots
     */
    applyModules(slots) {
      this._moduleState = Object.assign({}, slots || {});
      this._rebuildModuleVisuals();
    }

    /**
     * Manually set camera azimuth + elevation (radians).
     */
    setOrbit(azimuth, elevation) {
      this._orbitAzimuth   = azimuth;
      this._orbitElevation = elevation;
      this._updateCameraPosition();
    }

    /**
     * Call when the container is removed / viewer is no longer needed.
     */
    dispose() {
      this._disposed = true;
      if (this._rafId !== null) cancelAnimationFrame(this._rafId);
      this._rafId = null;

      this._canvas.removeEventListener('mousedown',  this._onMouseDown);
      this._canvas.removeEventListener('mousemove',  this._onMouseMove);
      this._canvas.removeEventListener('mouseup',    this._onMouseUp);
      this._canvas.removeEventListener('mouseleave', this._onMouseUp);
      this._canvas.removeEventListener('touchstart', this._onTouchStart);
      this._canvas.removeEventListener('touchmove',  this._onTouchMove);
      this._canvas.removeEventListener('touchend',   this._onMouseUp);

      if (this._renderer) {
        this._renderer.dispose();
        this._renderer = null;
      }
    }

    /**
     * Return the current hardpoints from the loaded hull (for testing).
     * @returns {{ weapon: Array, shield: Array, engine: Array, utility: Array }}
     */
    getHardpoints() {
      if (!this._shipGroup) return { weapon: [], shield: [], engine: [], utility: [] };
      const hp = this._shipGroup.userData?.gqHardpoints || {};
      return {
        weapon:  Array.isArray(hp.weapon)  ? hp.weapon  : [],
        shield:  Array.isArray(hp.shield)  ? hp.shield  : [],
        engine:  Array.isArray(hp.engine)  ? hp.engine  : [],
        utility: Array.isArray(hp.utility) ? hp.utility : [],
      };
    }

    /**
     * Return whether the shield bubble mesh is currently visible.
     * @returns {boolean}
     */
    isShieldActive() {
      return !!(this._shieldBubble && this._shieldBubble.visible);
    }

    // ── Private ─────────────────────────────────────────────────────────────

    _init() {
      const T = this._THREE;
      const w = this._canvas.offsetWidth  || this._canvas.width  || 400;
      const h = this._canvas.offsetHeight || this._canvas.height || 280;

      // Renderer
      this._renderer = new T.WebGLRenderer({
        canvas: this._canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      this._renderer.setSize(w, h, false);
      this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this._renderer.shadowMap.enabled = true;
      this._renderer.shadowMap.type = T.PCFSoftShadowMap;
      if (T.SRGBColorSpace) this._renderer.outputColorSpace = T.SRGBColorSpace;

      // Scene
      this._scene = new T.Scene();
      this._scene.background = new T.Color(0x050c18);
      this._scene.fog = new T.FogExp2(0x050c18, 0.065);

      // Camera
      this._camera = new T.PerspectiveCamera(45, w / h, 0.1, 100);
      this._camera.position.set(0, 1.2, 6);
      this._camera.lookAt(0, 0, 0);

      this._clock = new T.Clock();

      this._buildHangarEnvironment();
      this._buildModuleGroup();
      this._bindInputEvents();
      this._loop();
    }

    _buildHangarEnvironment() {
      const T = this._THREE;

      // Ambient – very dim
      const ambient = new T.AmbientLight(0x1a2a4a, 0.45);
      this._scene.add(ambient);

      // Key light – upper left blue-white (simulates hangar bay lighting)
      const key = new T.SpotLight(0xc0d8ff, 3.5, 22, Math.PI / 5, 0.3, 1.2);
      key.position.set(-4, 7, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(512, 512);
      this._scene.add(key);
      this._scene.add(key.target);

      // Fill light – right, warm
      const fill = new T.SpotLight(0xffd0a0, 1.2, 18, Math.PI / 4, 0.45, 1.5);
      fill.position.set(5, 3, 5);
      this._scene.add(fill);
      this._scene.add(fill.target);

      // Back rim light – cold blue
      const rim = new T.DirectionalLight(0x4466aa, 0.55);
      rim.position.set(0, -2, -6);
      this._scene.add(rim);

      // Hangar floor grid (subtle)
      const gridHelper = new T.GridHelper(20, 20, 0x102040, 0x0a1828);
      gridHelper.position.y = -2.6;
      this._scene.add(gridHelper);

      // Hangar floor reflective plane
      const floorGeo  = new T.PlaneGeometry(20, 20);
      const floorMat  = new T.MeshStandardMaterial({
        color:     0x0a1422,
        metalness: 0.82,
        roughness: 0.55,
        transparent: true,
        opacity: 0.72,
      });
      const floor = new T.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -2.65;
      floor.receiveShadow = true;
      this._scene.add(floor);
    }

    _buildModuleGroup() {
      this._moduleGroup = new this._THREE.Group();
      this._moduleGroup.name = 'module_effects';
      this._scene.add(this._moduleGroup);
    }

    async _loadModel(modelId) {
      const T = this._THREE;

      // Remove old ship
      if (this._shipGroup) {
        this._scene.remove(this._shipGroup);
        this._shipGroup = null;
      }
      if (this._mixer) {
        this._mixer.stopAllAction();
        this._mixer = null;
      }
      this._clearModuleVisuals();

      let descriptor;
      try {
        if (this._fetchFn) {
          descriptor = await this._fetchFn(modelId);
        } else {
          const res = await fetch(`/api/model_gen.php?type=${encodeURIComponent(modelId)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          descriptor = await res.json();
        }
      } catch (err) {
        this._loadFallback(modelId);
        return;
      }

      try {
        const group = await this._buildFromDescriptor(descriptor);
        this._shipGroup = group;
        this._shipGroup.castShadow = true;

        // Compute bounding sphere for shield bubble sizing
        const box = new T.Box3().setFromObject(this._shipGroup);
        const sphere = new T.Sphere();
        box.getBoundingSphere(sphere);
        this._boundingSphereRadius = sphere.radius || 2.0;

        this._scene.add(this._shipGroup);

        // Setup idle animation
        const clips = this._shipGroup.userData?.nativeClipMap?.idle || [];
        if (clips.length) {
          this._mixer = new T.AnimationMixer(this._shipGroup);
          clips.forEach((clip) => {
            const action = this._mixer.clipAction(clip);
            action.play();
          });
        }

        // Re-apply current module state
        this._rebuildModuleVisuals();
      } catch (err) {
        this._loadFallback(modelId);
      }
    }

    _loadFallback(modelId) {
      const T = this._THREE;
      const group = new T.Group();
      group.name = modelId + '_fallback';
      group.userData.gqHardpoints = {
        weapon:  [{ name: 'wp_l', position: [-0.6, 0, 0.3] }, { name: 'wp_r', position: [0.6, 0, 0.3] }],
        shield:  [{ name: 'shield_c', position: [0, 0, 0] }],
        engine:  [{ name: 'eng_main', position: [0, 0, -1.1] }],
        utility: [{ name: 'util_b', position: [0, -0.35, 0] }],
      };
      const mat = new T.MeshStandardMaterial({ color: 0x3a6080, roughness: 0.5, metalness: 0.7 });

      const fuselage = new T.Mesh(
        new T.CylinderGeometry(0.18, 0.52, 2.2, 8),
        mat,
      );
      group.add(fuselage);

      const wingMat = new T.MeshStandardMaterial({ color: 0x2a4860, roughness: 0.45, metalness: 0.65 });
      const wingGeo = new T.BoxGeometry(1.8, 0.08, 0.5);
      [-0.75, 0.75].forEach((x) => {
        const wing = new T.Mesh(wingGeo, wingMat);
        wing.position.set(x, 0, 0.1);
        group.add(wing);
      });

      this._shipGroup = group;
      this._boundingSphereRadius = 2.0;
      this._scene.add(group);
      this._rebuildModuleVisuals();
    }

    _buildFromDescriptor(descriptor) {
      const T = this._THREE;
      if (descriptor?.metadata?.type === 'Object' && descriptor?.object) {
        return new Promise((resolve, reject) => {
          try {
            const loader = new T.ObjectLoader();
            loader.setResourcePath('/');
            loader.parse(descriptor, (object3d) => {
              let group = object3d;
              if (!group?.isGroup) {
                const wrapped = new T.Group();
                if (group) wrapped.add(group);
                group = wrapped;
              }
              // Copy hardpoints from descriptor
              const hp = descriptor.object?.userData?.gqHardpoints;
              if (hp) group.userData.gqHardpoints = hp;

              // Parse animation clips for idle state
              const nativeClipMap = { idle: [], active: [], alert: [] };
              if (Array.isArray(descriptor.animations)) {
                descriptor.animations.forEach((clipDef) => {
                  if (!clipDef || !Array.isArray(clipDef.tracks)) return;
                  try {
                    const clip = T.AnimationClip.parse(clipDef);
                    const name = (clipDef.name || '').toLowerCase();
                    const state = name.startsWith('active') ? 'active'
                      : name.startsWith('alert') ? 'alert'
                      : 'idle';
                    nativeClipMap[state].push(clip);
                  } catch (_e) { /* ignore bad clips */ }
                });
              }
              group.userData.nativeClipMap = nativeClipMap;
              resolve(group);
            });
          } catch (err) {
            reject(err);
          }
        });
      }
      // Minimal fallback
      return Promise.resolve(new T.Group());
    }

    _rebuildModuleVisuals() {
      if (!this._shipGroup) return;
      this._clearModuleVisuals();

      const hp = this.getHardpoints();

      // ── Weapon modules ───────────────────────────────────────────────────
      const weaponCount = Number(this._moduleState.weapon || 0);
      if (weaponCount > 0) {
        const pts = hp.weapon.slice(0, weaponCount);
        pts.forEach((point) => this._addWeaponEffect(point));
      }

      // ── Shield bubble ────────────────────────────────────────────────────
      const shieldCount = Number(this._moduleState.shield || 0);
      if (shieldCount > 0) {
        this._addShieldBubble(shieldCount);
      }

      // ── Engine glow (accepts 'engine' or 'propulsion' group code) ────────
      const engineCount = Number(this._moduleState.engine || 0)
        + Number(this._moduleState.propulsion || 0);
      if (engineCount > 0) {
        const pts = hp.engine.slice(0, engineCount);
        pts.forEach((point) => this._addEngineEffect(point));
        this._activateEngineNozzles(true);
      } else {
        this._activateEngineNozzles(false);
      }

      // ── Utility / cargo pods ─────────────────────────────────────────────
      const utilCount = Number(this._moduleState.utility || 0);
      if (utilCount > 0) {
        const pts = hp.utility.slice(0, utilCount);
        pts.forEach((point) => this._addUtilityEffect(point));
      }
    }

    _clearModuleVisuals() {
      const T = this._THREE;

      // Remove module meshes
      while (this._moduleGroup.children.length > 0) {
        const child = this._moduleGroup.children[0];
        this._moduleGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      }

      // Remove module lights
      this._moduleLights.forEach((light) => this._scene.remove(light));
      this._moduleLights = [];

      // Remove shield bubble
      if (this._shieldBubble) {
        this._scene.remove(this._shieldBubble);
        if (this._shieldBubble.geometry) this._shieldBubble.geometry.dispose();
        if (this._shieldBubble.material) this._shieldBubble.material.dispose();
        this._shieldBubble = null;
      }

      // Reset engine nozzle materials
      this._activateEngineNozzles(false);
    }

    _addWeaponEffect(point) {
      const T   = this._THREE;
      const vis = MODULE_VISUALS.weapon;
      const geo = new T.CylinderGeometry(
        vis.geometry.radiusTop,
        vis.geometry.radiusBottom,
        vis.geometry.height,
        vis.geometry.radialSegments,
      );
      const mat = new T.MeshStandardMaterial({
        color:            new T.Color(vis.color),
        emissive:         new T.Color(vis.emissive),
        emissiveIntensity: vis.emissiveIntensity,
        metalness:        vis.metalness,
        roughness:        vis.roughness,
      });
      const mesh = new T.Mesh(geo, mat);
      mesh.name = `weapon_barrel_${point.name}`;
      const [rx, ry, rz] = vis.rotation;
      mesh.rotation.set(rx, ry, rz);
      const [px, py, pz] = point.position;
      mesh.position.set(px, py, pz);
      this._moduleGroup.add(mesh);

      if (vis.light) {
        const light = new T.PointLight(vis.light.color, vis.light.intensity, vis.light.distance);
        light.position.set(px, py, pz);
        this._scene.add(light);
        this._moduleLights.push(light);
      }
    }

    _addShieldBubble(count) {
      const T   = this._THREE;
      const vis = MODULE_VISUALS.shield;
      const radius = this._boundingSphereRadius * vis.radiusScale * (1 + (count - 1) * 0.06);

      const geo = new T.SphereGeometry(radius, 24, 18);
      const mat = new T.MeshStandardMaterial({
        color:            new T.Color(vis.color),
        emissive:         new T.Color(vis.emissive),
        emissiveIntensity: vis.emissiveIntensity,
        metalness:        vis.metalness,
        roughness:        vis.roughness,
        transparent:      true,
        opacity:          vis.opacity,
        depthWrite:       false,
        side:             T.DoubleSide,
      });
      const bubble = new T.Mesh(geo, mat);
      bubble.name = 'shield_bubble';
      // Position relative to ship group center
      if (this._shipGroup) {
        const box = new T.Box3().setFromObject(this._shipGroup);
        const center = new T.Vector3();
        box.getCenter(center);
        bubble.position.copy(center);
      }
      this._shieldBubble = bubble;
      this._scene.add(bubble);

      if (vis.light) {
        const light = new T.PointLight(vis.light.color, vis.light.intensity, vis.light.distance);
        light.position.copy(bubble.position);
        this._scene.add(light);
        this._moduleLights.push(light);
      }
    }

    _addEngineEffect(point) {
      const T   = this._THREE;
      const vis = MODULE_VISUALS.engine;
      const geo = new T.ConeGeometry(vis.geometry.radius, vis.geometry.height, vis.geometry.radialSegments);
      const mat = new T.MeshStandardMaterial({
        color:            new T.Color(vis.color),
        emissive:         new T.Color(vis.emissive),
        emissiveIntensity: vis.emissiveIntensity,
        metalness:        vis.metalness,
        roughness:        vis.roughness,
        transparent:      vis.transparent,
        opacity:          vis.opacity,
      });
      const mesh = new T.Mesh(geo, mat);
      mesh.name = `engine_glow_${point.name}`;
      const [rx, ry, rz] = vis.rotation;
      mesh.rotation.set(rx, ry, rz);
      const [px, py, pz] = point.position;
      mesh.position.set(px, py - 0.2, pz - 0.15);
      this._moduleGroup.add(mesh);

      if (vis.light) {
        const light = new T.PointLight(vis.light.color, vis.light.intensity, vis.light.distance);
        light.position.set(px, py, pz);
        this._scene.add(light);
        this._moduleLights.push(light);
      }
    }

    _addUtilityEffect(point) {
      const T   = this._THREE;
      const vis = MODULE_VISUALS.utility;
      const geo = new T.BoxGeometry(vis.geometry.width, vis.geometry.height, vis.geometry.depth);
      const mat = new T.MeshStandardMaterial({
        color:            new T.Color(vis.color),
        emissive:         new T.Color(vis.emissive),
        emissiveIntensity: vis.emissiveIntensity,
        metalness:        vis.metalness,
        roughness:        vis.roughness,
      });
      const mesh = new T.Mesh(geo, mat);
      mesh.name = `utility_pod_${point.name}`;
      const [px, py, pz] = point.position;
      mesh.position.set(px, py, pz);
      this._moduleGroup.add(mesh);
    }

    /**
     * Switches the engine-nozzle meshes in the hull model between an "off"
     * (dark) and "active" (glowing cyan) material state.
     */
    _activateEngineNozzles(active) {
      if (!this._shipGroup) return;
      const T = this._THREE;
      this._shipGroup.traverse((obj) => {
        if (!obj.isMesh) return;
        const name = (obj.name || '').toLowerCase();
        if (!name.includes('engine') && !name.includes('nozzle')) return;
        if (active) {
          if (!obj.userData._origEngMat) obj.userData._origEngMat = obj.material;
          obj.material = new T.MeshStandardMaterial({
            color:            new T.Color(0x00cfff),
            emissive:         new T.Color(0x00aaff),
            emissiveIntensity: 2.4,
            metalness:        0.5,
            roughness:        0.15,
          });
        } else {
          if (obj.userData._origEngMat) {
            obj.material = obj.userData._origEngMat;
            delete obj.userData._origEngMat;
          }
        }
      });
    }

    _updateCameraPosition() {
      const T    = this._THREE;
      const dist = 5.5 + this._boundingSphereRadius * 0.8;
      const elev = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this._orbitElevation));
      this._camera.position.set(
        Math.sin(this._orbitAzimuth) * Math.cos(elev) * dist,
        Math.sin(elev) * dist,
        Math.cos(this._orbitAzimuth) * Math.cos(elev) * dist,
      );
      this._camera.lookAt(0, 0, 0);
    }

    _loop() {
      if (this._disposed) return;
      this._rafId = requestAnimationFrame(() => this._loop());

      const dt = this._clock ? this._clock.getDelta() : 0.016;

      // Auto-rotate
      if (this._autoRotate && !this._isDragging && this._shipGroup) {
        this._orbitAzimuth += this._autoRotateSpeed * dt;
      }
      this._updateCameraPosition();

      // Shield pulse animation
      if (this._shieldBubble) {
        const elapsed = this._clock ? this._clock.elapsedTime : 0;
        const pulse   = 0.96 + 0.04 * Math.sin(elapsed * 1.8);
        this._shieldBubble.scale.setScalar(pulse);
        this._shieldBubble.material.opacity = 0.10 + 0.05 * Math.sin(elapsed * 2.4);
      }

      // Update animation mixer
      if (this._mixer) this._mixer.update(dt);

      if (this._renderer && this._scene && this._camera) {
        this._renderer.render(this._scene, this._camera);
      }
    }

    // ── Input (drag-to-orbit) ──────────────────────────────────────────────

    _bindInputEvents() {
      this._onMouseDown  = (e) => { this._isDragging = true; this._prevMouseX = e.clientX; this._prevMouseY = e.clientY; };
      this._onMouseMove  = (e) => {
        if (!this._isDragging) return;
        const dx = e.clientX - this._prevMouseX;
        const dy = e.clientY - this._prevMouseY;
        this._orbitAzimuth   -= dx * 0.006;
        this._orbitElevation -= dy * 0.006;
        this._prevMouseX = e.clientX;
        this._prevMouseY = e.clientY;
      };
      this._onMouseUp    = () => { this._isDragging = false; };
      this._onTouchStart = (e) => {
        if (e.touches.length !== 1) return;
        this._isDragging = true;
        this._prevMouseX = e.touches[0].clientX;
        this._prevMouseY = e.touches[0].clientY;
      };
      this._onTouchMove  = (e) => {
        if (!this._isDragging || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - this._prevMouseX;
        const dy = e.touches[0].clientY - this._prevMouseY;
        this._orbitAzimuth   -= dx * 0.006;
        this._orbitElevation -= dy * 0.006;
        this._prevMouseX = e.touches[0].clientX;
        this._prevMouseY = e.touches[0].clientY;
      };

      this._canvas.addEventListener('mousedown',  this._onMouseDown);
      this._canvas.addEventListener('mousemove',  this._onMouseMove);
      this._canvas.addEventListener('mouseup',    this._onMouseUp);
      this._canvas.addEventListener('mouseleave', this._onMouseUp);
      this._canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
      this._canvas.addEventListener('touchmove',  this._onTouchMove,  { passive: true });
      this._canvas.addEventListener('touchend',   this._onMouseUp);
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const _api = { ShipHangarViewer, HULL_MODEL_MAP, MODULE_VISUALS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _api;
  } else {
    window.GQShipHangarViewer = _api;
  }
})();
