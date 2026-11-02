/**
 * GalaxyQuest – ModelRegistry
 *
 * Asynchronously fetches JSON model descriptors from /api/model_gen.php and
 * assembles them into Three.js Group templates that can be cheaply cloned.
 *
 * Usage
 * -----
 *   // Check + instantiate (galaxy3d.js _buildInstallationMesh)
 *   const registry = window.__GQ_ModelRegistry;
 *   if (registry.hasCached('stargate')) {
 *     const mesh = registry.instantiate('stargate', '#4af9ff');
 *   }
 *
 *   // Async pre-load (optional, e.g. on system enter)
 *   registry.load('stargate').then(() => { ... });
 *
 *   // Per-frame tick (called from galaxy3d.js render loop)
 *   registry.tickAnimations(entries, elapsed, dt);
 */

/* global THREE */

class GQModelRegistry {
  constructor({ gltfLoader = null, ktx2Loader = null, ownsGltfResources = !gltfLoader } = {}) {
    /** @type {Map<string, THREE.Group>} cached template groups (do NOT add to scene) */
    this._cache     = new Map();
    /** @type {Map<string, Promise<void>>} in-flight requests */
    this._loading   = new Map();
    /** Allowed model types (must match api/model_gen.php allowlist) */
    this._allowList = new Set([
      'stargate', 'relay_station', 'jump_inhibitor',
      'deep_space_radar', 'space_station', 'transport_shuttle',
    ]);

    this._textureCache = new Map();
    this._textureLoading = new Map();
    this._binaryCache = null;
    this.configureAssetLoaders({ gltfLoader, ktx2Loader, ownsGltfResources });
    /** @type {((instance: THREE.Group, payload: object) => void)|null} */
    this._vfxBridge = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  hasCached(type) {
    return this._cache.has(String(type));
  }

  /** Warm the small installation catalog without blocking renderer startup. */
  preload() {
    return Promise.all(Array.from(this._allowList, (type) => this.load(type)));
  }

  /**
   * Inject existing Three.js loaders. KTX2 requires setTranscoderPath() and
   * detectSupport(renderer) beforehand; this registry never guesses GPU formats.
   * Injected glTF results are borrowed unless ownsGltfResources is explicitly true.
   */
  configureAssetLoaders({ gltfLoader = null, ktx2Loader = null, ownsGltfResources = !gltfLoader } = {}) {
    if (ktx2Loader && (!ktx2Loader.transcoderPath || !ktx2Loader.workerConfig
      || typeof ktx2Loader.load !== 'function')) {
      throw new Error('KTX2 loader requires a transcoder path and detected renderer support');
    }
    this._gltfLoader = gltfLoader;
    this._ktx2Loader = ktx2Loader;
    this._ownsGltfResources = ownsGltfResources;
  }

  getAnimations(type) {
    const template = this._cache.get(String(type));
    const anims = template?.userData?.rawAnims;
    if (!Array.isArray(anims)) return [];
    return anims.map((anim) => ({ ...anim }));
  }

  /**
   * Register an optional callback that receives each instantiated model with
   * resolved VFX metadata (emitters + weapon FX). Useful for runtime FX wiring.
   * @param {((instance: THREE.Group, payload: object) => void)|null} bridge
   */
  setVfxBridge(bridge) {
    this._vfxBridge = typeof bridge === 'function' ? bridge : null;
  }

  /**
   * Set the active native animation state for a model instance.
   * Known states: idle, active, alert
   * @param {THREE.Group} instance
   * @param {string} state
   */
  setAnimationState(instance, state) {
    const mesh = instance;
    if (!mesh?.userData) return;

    const actionsByState = mesh.userData.animActionsByState;
    if (!actionsByState || typeof actionsByState !== 'object') return;

    const normalized = this._normalizeAnimState(state);
    const targetActions = actionsByState[normalized]
      || actionsByState.idle
      || actionsByState.active
      || actionsByState.alert
      || actionsByState.__all
      || [];

    Object.values(actionsByState).forEach((actions) => {
      if (!Array.isArray(actions)) return;
      actions.forEach((action) => {
        if (!action) return;
        action.enabled = false;
        action.stop();
      });
    });

    targetActions.forEach((action) => {
      if (!action) return;
      action.enabled = true;
      action.reset();
      action.play();
    });

    mesh.userData.animState = normalized;
  }

  /**
   * Load a model descriptor and cache the resulting template group.
   * Calling multiple times is safe – returns the existing Promise if in-flight.
   * @param {string} type
   * @returns {Promise<void>}
   */
  load(type) {
    if (!this._allowList.has(type)) {
      return Promise.reject(new Error(`GQModelRegistry: unknown type "${type}"`));
    }
    if (this._cache.has(type)) return Promise.resolve();
    if (this._loading.has(type)) return this._loading.get(type);

    const promise = fetch(`/api/model_gen.php?type=${encodeURIComponent(type)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`model_gen HTTP ${r.status} for type "${type}"`);
        return r.json();
      })
      .then((descriptor) => this._buildFromDescriptor(descriptor))
      .then((template) => {
        template.visible = false; // Templates are never rendered directly
        this._cache.set(type, template);
      })
      .catch((err) => {
        console.warn('[ModelRegistry] load failed:', err);
      })
      .finally(() => {
        this._loading.delete(type);
      });

    this._loading.set(type, promise);
    return promise;
  }

  /**
   * Clone the cached template and apply an empire tint color.
   * Falls back silently to null if not yet cached.
   * @param {string} type
   * @param {string} tintHex  CSS hex color string like '#4af9ff'
   * @param {string} initialAnimState
   * @returns {THREE.Group|null}
   */
  instantiate(type, tintHex, initialAnimState = 'idle') {
    const template = this._cache.get(String(type));
    if (!template) return null;

    const clone = template.userData?.hasSkinnedMeshes
      ? this._cloneSkinned(template) : template.clone(true);
    clone.visible = true;

    if (tintHex) {
      const tint = new THREE.Color(tintHex);
      clone.traverse((node) => {
        if (node.isMesh && node.material) {
          const tintMaterial = (source) => {
            const mat = source.clone();
            if (node.userData?.tintable !== false && mat.color) {
              mat.color.multiply(tint);
              if (mat.emissive) mat.emissive.copy(mat.color).multiplyScalar(0.7);
            }
            return mat;
          };
          node.material = Array.isArray(node.material)
            ? node.material.map(tintMaterial) : tintMaterial(node.material);
        }
      });
    }

    const nativeClipMap = template.userData?.nativeClipMap;
    const hasNativeClipMap = nativeClipMap && typeof nativeClipMap === 'object';
    if (hasNativeClipMap) {
      const mixer = new THREE.AnimationMixer(clone);
      const actionsByState = {
        idle: [],
        active: [],
        alert: [],
        __all: [],
      };

      Object.entries(nativeClipMap).forEach(([state, clips]) => {
        const normalizedState = this._normalizeAnimState(state);
        const list = Array.isArray(clips) ? clips : [];
        list.forEach((clip) => {
          try {
            const action = mixer.clipAction(clip);
            actionsByState[normalizedState].push(action);
            actionsByState.__all.push(action);
          } catch (_err) {
            // Ignore invalid clips so model loading remains resilient.
          }
        });
      });

      clone.userData.animMixer = mixer;
      clone.userData.animActionsByState = actionsByState;
      this.setAnimationState(clone, initialAnimState);
    }

    clone.userData.resolvedVfx = this._resolveVfxPayload(clone);
    this._notifyVfxBridge(clone);

    return clone;
  }

  /**
   * Per-frame animation tick.  Call from the render loop of galaxy3d.js.
   * @param {Array<{mesh: THREE.Group, modelAnims: Array, elapsed: number}>} entries
   * @param {number} elapsed  total time in seconds
   * @param {number} dt       delta time since last frame
   */
  tickAnimations(entries, elapsed, dt) {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => {
      const mesh = entry.mesh;
      if (!mesh) return;

      if (mesh.userData?.animMixer) {
        mesh.userData.animMixer.update(dt);
      }

      const anims = entry.modelAnims;
      if (!Array.isArray(anims) || !anims.length) return;

      anims.forEach((anim) => {
        const target = this._resolveAnimTarget(mesh, anim.target);
        if (!target) return;

        if (anim.type === 'linear') {
          const axis = anim.property; // e.g. 'rotation.y'
          const [obj, prop] = axis.split('.');
          if (target[obj] !== undefined && prop !== undefined) {
            target[obj][prop] += (anim.speed || 0.5) * dt;
          }
        } else if (anim.type === 'sine') {
          const axis = anim.property;
          const [obj, prop] = axis.split('.');
          if (target[obj] !== undefined && prop !== undefined) {
            const amp   = anim.amplitude ?? 0.4;
            const freq  = anim.frequency ?? 1.0;
            const base  = anim.base      ?? 0;
            target[obj][prop] = base + Math.sin(elapsed * freq * Math.PI * 2) * amp;
          }
        }
      });
    });
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Build a Three.js Group from a model descriptor JSON.
   * @param {object} descriptor
   * @returns {THREE.Group}
   */
  _buildFromDescriptor(descriptor) {
    if (descriptor?.model_url || descriptor?.lods) {
      return this._buildFromGltfDescriptor(descriptor);
    }
    // Three.js Object/Scene JSON format (preferred)
    if (descriptor?.metadata?.type === 'Object' && descriptor?.object) {
      return this._buildFromThreeObjectJson(descriptor)
        .then((group) => this._applyRenderSettings(group, descriptor.rendering));
    }

    // Legacy primitive descriptor fallback
    const group = this._buildFromLegacyDescriptor(descriptor);
    return Promise.all(Array.from(this._textureLoading.values(), (entry) => entry.promise))
      .then(() => this._applyRenderSettings(group, descriptor.rendering));
  }

  /**
   * Accept model_url or prepared lods: [{ model_url, distance }].
   * All prepared LODs load up front; selection is not per-level asset streaming.
   */
  async _buildFromGltfDescriptor(descriptor) {
    const levels = descriptor.lods || [{ distance: 0, model_url: descriptor.model_url }];
    if (!Array.isArray(levels) || !levels.length || levels.some((level, index) => (
      !level || typeof level.model_url !== 'string'
      || !/\.(?:glb|gltf)(?:[?#]|$)/i.test(level.model_url)
      || !Number.isFinite(level.distance) || level.distance < 0
      || (index === 0 ? level.distance !== 0 : level.distance <= levels[index - 1].distance)
    ))) {
      throw new Error('Model LODs require glTF/GLB URLs and increasing distances starting at zero');
    }
    if (!this._gltfLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._gltfLoader = new GLTFLoader();
    }
    const loader = this._gltfLoader;
    if (this._ktx2Loader) loader.setKTX2Loader(this._ktx2Loader);
    const ownsResources = this._ownsGltfResources;
    const results = await Promise.allSettled(levels.map((level, index) => (
      Promise.resolve().then(() => this._loadPublicGltf(loader, level, descriptor, index))
    )));
    const assets = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    try {
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
      if (assets.some((asset) => !asset?.scene)) throw new Error('glTF asset has no default scene');
      let hasSkinnedMeshes = false;
      for (const asset of assets) {
        asset.scene.traverse((node) => { if (node.isSkinnedMesh) hasSkinnedMeshes = true; });
      }
      if (hasSkinnedMeshes) {
        const { clone } = await import('three/addons/utils/SkeletonUtils.js');
        this._cloneSkinned = clone;
      }
      const group = levels.length > 1 ? new THREE.LOD() : new THREE.Group();
      assets.forEach((asset, index) => {
        if (group.isLOD) group.addLevel(asset.scene, levels[index].distance);
        else group.add(asset.scene);
      });
      group.userData.hasSkinnedMeshes = hasSkinnedMeshes;
      group.userData.modelType = descriptor.modelId || descriptor.id || 'unknown';
      group.userData.modelVersion = descriptor.version || 1;
      group.userData.rawAnims = [];
      group.userData.nativeClipMap = { idle: [], active: [], alert: [] };
      for (const asset of assets) {
        for (const clip of asset.animations || []) {
          group.userData.nativeClipMap[this._deriveAnimStateFromClipName(clip.name)].push(clip);
        }
      }
      const scale = Number(descriptor.scale ?? 1);
      if (Number.isFinite(scale) && scale > 0) group.scale.setScalar(scale);
      return this._applyRenderSettings(group, descriptor.rendering);
    } catch (error) {
      if (ownsResources) this._disposeGltfAssets(assets);
      throw error;
    }
  }

  async _loadPublicGltf(loader, level, descriptor, lod) {
    const url = new URL(level.model_url, globalThis.location?.href || 'http://localhost/');
    const version = url.searchParams.get('v') || url.searchParams.get('version') || descriptor.version;
    const eligible = typeof loader.parseAsync === 'function'
      && url.origin === globalThis.location?.origin
      && /^\/(?:assets\/models|generated\/trellis2\/imported)\/[a-z0-9_./-]+\.glb$/i.test(url.pathname)
      && !/%|\\/.test(level.model_url) && !url.username && !url.password && !url.hash
      && [...url.searchParams.keys()].every((key) => key === 'v' || key === 'version')
      && (typeof version === 'string' || typeof version === 'number') && String(version).length > 0;
    if (!eligible) return loader.loadAsync(level.model_url);

    const { publicAssetBinaryCache } = await import('../engine/assets/AssetBinaryCache.js');
    const cache = this._binaryCache || publicAssetBinaryCache;
    const key = {
      scope: 'public', kind: 'standalone-glb', version, seed: 0, lod,
      generatorHash: 'gq-glb-loader-v1', parameters: { url: url.href },
    };
    const load = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url.href, {
          credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Public GLB HTTP ${response.status}`);
        const policy = response.headers?.get('cache-control') || '';
        const bytes = await response.arrayBuffer();
        this._validateStandaloneGlb(bytes);
        // A server can override the public-path convention with an explicit policy.
        return { bytes, cacheable: !/\b(private|no-store)\b/i.test(policy) };
      } finally {
        clearTimeout(timer);
      }
    };
    let bytes = await cache.get(key);
    let fromCache = !!bytes;
    if (!bytes) {
      const result = await load();
      bytes = result.bytes;
      if (result.cacheable) await cache.put(key, bytes);
    }
    try {
      this._validateStandaloneGlb(bytes);
      return await loader.parseAsync(bytes, new URL('.', url).href);
    } catch (error) {
      await cache.delete(key);
      if (!fromCache) throw error;
      // Parsing failure (including old/corrupt formats) gets one network retry.
      fromCache = false;
      const result = await load();
      const asset = await loader.parseAsync(result.bytes, new URL('.', url).href);
      if (result.cacheable) await cache.put(key, result.bytes);
      return asset;
    }
  }

  _validateStandaloneGlb(bytes) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 20) throw new Error('Invalid public GLB');
    const view = new DataView(bytes);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
      || view.getUint32(8, true) !== bytes.byteLength
      || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Invalid public GLB header');
    const length = view.getUint32(12, true);
    if (length % 4 || length > bytes.byteLength - 20) throw new Error('Invalid public GLB JSON');
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
    if ([...(json.buffers || []), ...(json.images || [])].some((entry) => entry.uri != null)) {
      throw new Error('Public GLB cache requires embedded resources');
    }
  }

  _disposeGltfAssets(assets) {
    const resources = new Set();
    for (const asset of assets) {
      const scenes = new Set([asset?.scene, ...(asset?.scenes || [])]);
      for (const scene of scenes) {
        scene?.traverse?.((node) => {
          if (node.geometry) resources.add(node.geometry);
          if (node.skeleton) resources.add(node.skeleton);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (!material) continue;
            resources.add(material);
            if (material.userData?.sharedTexture) continue;
            for (const value of Object.values(material)) {
              if (value?.isTexture) resources.add(value);
            }
          }
        });
      }
    }
    for (const resource of resources) {
      try {
        resource.dispose?.();
      } catch (error) {
        console.warn('[ModelRegistry] glTF resource cleanup failed:', error);
      }
    }
  }

  _applyRenderSettings(group, settings = {}) {
    group.traverse((node) => {
      if (!node.isMesh) return;
      for (const key of ['castShadow', 'receiveShadow']) {
        const value = node.userData?.[key] ?? settings?.[key];
        if (typeof value === 'boolean') node[key] = value;
      }
      if (Number.isFinite(settings?.envMapIntensity) && settings.envMapIntensity >= 0) {
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material && 'envMapIntensity' in material) {
            material.envMapIntensity = settings.envMapIntensity;
          }
        }
      }
    });
    return group;
  }

  _buildFromThreeObjectJson(descriptor) {
    return new Promise((resolve, reject) => {
      try {
        const loader = new THREE.ObjectLoader();
        loader.setResourcePath('/');
        loader.parse(descriptor, (object3d) => {
          let group = object3d;
          if (!group?.isGroup) {
            const wrapped = new THREE.Group();
            if (group) wrapped.add(group);
            group = wrapped;
          }

          const objectAnims = descriptor?.object?.userData?.gqAnimations;
          const objectVfxEmitters = descriptor?.object?.userData?.gqVfxEmitters;
          const objectWeaponFx = descriptor?.object?.userData?.gqWeaponFx;
          group.userData.modelType = descriptor.modelId || descriptor.id || group.name || 'unknown';
          group.userData.modelVersion = descriptor.version || descriptor?.metadata?.version || 1;
          group.userData.rawAnims = Array.isArray(descriptor.animations)
            ? descriptor.animations
            : (Array.isArray(objectAnims) ? objectAnims : []);
          group.userData.rawVfxEmitters = Array.isArray(objectVfxEmitters)
            ? objectVfxEmitters.map((e) => ({ ...e }))
            : [];
          group.userData.rawWeaponFx = Array.isArray(objectWeaponFx)
            ? objectWeaponFx.map((w) => ({ ...w }))
            : [];

          const nativeClipMap = {
            idle: [],
            active: [],
            alert: [],
          };
          if (Array.isArray(descriptor.animations)) {
            descriptor.animations.forEach((clipDef) => {
              if (!clipDef || !Array.isArray(clipDef.tracks)) return;
              try {
                const clip = THREE.AnimationClip.parse(clipDef);
                const state = this._deriveAnimStateFromClipName(clipDef.name);
                nativeClipMap[state].push(clip);
              } catch (_err) {
                // Ignore malformed clip definitions to keep model load stable.
              }
            });
          }
          if (!nativeClipMap.idle.length && !nativeClipMap.active.length && !nativeClipMap.alert.length) {
            nativeClipMap.idle = [];
          }
          group.userData.nativeClipMap = nativeClipMap;

          const scale = Number(descriptor.scale ?? descriptor?.object?.userData?.gqScale ?? 1);
          if (Number.isFinite(scale) && scale !== 1) {
            group.scale.multiplyScalar(scale);
          }

          resolve(group);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  _buildFromLegacyDescriptor(descriptor) {
    const group = new THREE.Group();
    group.userData.modelType    = descriptor.id || 'unknown';
    group.userData.modelVersion = descriptor.version || 1;
    group.userData.rawAnims     = descriptor.animations || [];

    const scale = descriptor.scale && descriptor.scale !== 1.0 ? descriptor.scale : 1.0;
    group.scale.setScalar(scale);

    const geomData = descriptor.geometry;
    if (geomData?.type === 'group' && Array.isArray(geomData.children)) {
      geomData.children.forEach((child, idx) => {
        const mesh = this._buildMeshNode(child);
        if (mesh) {
          mesh.userData._childIndex = idx;
          group.add(mesh);
        }
      });
    } else if (geomData) {
      const mesh = this._buildMeshNode(geomData);
      if (mesh) group.add(mesh);
    }

    return group;
  }

  /**
   * Build a single Three.js Mesh/Group from a geometry node descriptor.
   * @param {object} node
   * @returns {THREE.Mesh|THREE.Group|null}
   */
  _buildMeshNode(node) {
    if (!node?.type) return null;

    let geometry = null;
    const p = node.params || {};

    switch (node.type) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(
          p.radius ?? 1, p.widthSegments ?? 16, p.heightSegments ?? 16,
        );
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(
          p.radius ?? 1, p.tube ?? 0.2, p.radialSegments ?? 12, p.tubularSegments ?? 48,
        );
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(
          p.radiusTop ?? 1, p.radiusBottom ?? 1, p.height ?? 2,
          p.segments ?? 10, p.heightSegments ?? 1,
        );
        break;
      case 'box':
        geometry = new THREE.BoxGeometry(p.width ?? 1, p.height ?? 1, p.depth ?? 1);
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(p.radius ?? 1, p.height ?? 2, p.segments ?? 10);
        break;
      case 'octahedron':
        geometry = new THREE.OctahedronGeometry(p.radius ?? 1, p.detail ?? 0);
        break;
      case 'ring':
        geometry = new THREE.RingGeometry(
          p.innerRadius ?? 0.8, p.outerRadius ?? 1.2, p.thetaSegments ?? 32,
        );
        break;
      default:
        console.warn('[ModelRegistry] Unknown geometry type:', node.type);
        return null;
    }

    const mat = this._buildMaterial(node.material || {});
    mat.userData = Object.assign(mat.userData || {}, node.material || {});

    const mesh = new THREE.Mesh(geometry, mat);
    mesh.userData = Object.assign({}, node.userData || {});

    // Apply transform
    const t = node.transform || {};
    if (t.position) mesh.position.set(...t.position);
    if (t.rotation) mesh.rotation.set(...t.rotation); // Euler [x, y, z]
    if (Array.isArray(t.scale) && t.scale.length >= 3) {
      mesh.scale.set(Number(t.scale[0]) || 1, Number(t.scale[1]) || 1, Number(t.scale[2]) || 1);
    } else if (t.scale !== undefined) {
      mesh.scale.setScalar(Number(t.scale) || 1);
    }

    return mesh;
  }

  /**
   * Build a MeshStandardMaterial from descriptor properties.
   * @param {object} def
   * @returns {THREE.MeshStandardMaterial}
   */
  _buildMaterial(def) {
    const opts = {
      roughness:         def.roughness         ?? 0.5,
      metalness:         def.metalness         ?? 0.3,
      emissiveIntensity: def.emissiveIntensity ?? 0.0,
    };
    if (def.color)     opts.color     = new THREE.Color(def.color);
    if (def.emissive)  opts.emissive  = new THREE.Color(def.emissive);
    if (Number.isFinite(def.envMapIntensity) && def.envMapIntensity >= 0) opts.envMapIntensity = def.envMapIntensity;
    if (def.transparent) { opts.transparent = true; opts.opacity = def.opacity ?? 1.0; }
    const material = new THREE.MeshStandardMaterial(opts);
    for (const slot of ['map', 'emissiveMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) {
      if (!def[slot]) continue;
      material[slot] = this._loadTexture(def[slot], slot === 'map' || slot === 'emissiveMap', (texture) => {
        material[slot] = texture;
        material.needsUpdate = true;
      });
    }
    return material;
  }

  _loadTexture(source, isColor = true, onLoad = null) {
    let url = typeof source === 'string' ? source : source?.url;
    if (typeof url !== 'string' || !url) return null;
    let compressed = /\.ktx2(?:[?#]|$)/i.test(url);
    if (compressed && !this._ktx2Loader) {
      url = typeof source?.fallback === 'string' ? source.fallback : '';
      if (!url || /\.ktx2(?:[?#]|$)/i.test(url)) return null;
      compressed = false;
    }
    const key = `${isColor ? 'color' : 'data'}:${url}`;
    if (this._textureCache.has(key)) return this._textureCache.get(key);
    if (compressed) {
      if (this._textureLoading.has(key)) {
        if (onLoad) this._textureLoading.get(key).callbacks.push(onLoad);
        return null;
      }
      const callbacks = onLoad ? [onLoad] : [];
      let finish;
      const promise = new Promise((resolve) => { finish = resolve; });
      this._textureLoading.set(key, { callbacks, promise });
      // Unlike TextureLoader, KTX2Loader.load() does not return a placeholder.
      this._ktx2Loader.load(url, (loaded) => {
        const texture = loaded.clone();
        texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.needsUpdate = true;
        this._textureCache.set(key, texture);
        this._textureLoading.delete(key);
        callbacks.forEach((callback) => callback(texture));
        finish();
      }, undefined, (error) => {
        this._textureLoading.delete(key);
        console.warn('[ModelRegistry] compressed texture load failed:', error);
        finish();
      });
      return null;
    }
    const texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    this._textureCache.set(key, texture);
    return texture;
  }

  /**
   * Resolve an animation target specifier to the corresponding Object3D.
   * Specifier formats: 'root', 'child:0', 'child:3'
   * @param {THREE.Group} group
   * @param {string} targetSpec
   * @returns {THREE.Object3D|null}
   */
  _resolveAnimTarget(group, targetSpec) {
    if (!targetSpec || targetSpec === 'root') return group;
    if (targetSpec.startsWith('child:')) {
      const idx = parseInt(targetSpec.slice(6), 10);
      const children = group.children;
      return isNaN(idx) || idx >= children.length ? null : children[idx];
    }
    return null;
  }

  _normalizeAnimState(state) {
    const key = String(state || 'idle').trim().toLowerCase();
    if (key === 'active' || key === 'alert') return key;
    return 'idle';
  }

  _deriveAnimStateFromClipName(name) {
    const clipName = String(name || '').trim().toLowerCase();
    if (clipName.startsWith('active_') || clipName.startsWith('active.')) return 'active';
    if (clipName.startsWith('alert_') || clipName.startsWith('alert.')) return 'alert';
    if (clipName.startsWith('idle_') || clipName.startsWith('idle.')) return 'idle';
    return 'idle';
  }

  _resolveNodeByNameOrUuid(group, nameOrUuid) {
    const key = String(nameOrUuid || '').trim();
    if (!key) return null;

    let found = null;
    group.traverse((node) => {
      if (found) return;
      if (node?.name === key || node?.uuid === key) {
        found = node;
      }
    });
    return found;
  }

  _resolveVfxPayload(group) {
    const rawEmitters = Array.isArray(group?.userData?.rawVfxEmitters)
      ? group.userData.rawVfxEmitters
      : [];
    const rawWeaponFx = Array.isArray(group?.userData?.rawWeaponFx)
      ? group.userData.rawWeaponFx
      : [];

    const emitters = rawEmitters.map((emitter) => {
      const attachNode = this._resolveNodeByNameOrUuid(group, emitter.attachTo);
      return {
        ...emitter,
        attachResolved: !!attachNode,
        attachResolvedName: attachNode?.name || 'root',
        attachResolvedUuid: attachNode?.uuid || group.uuid,
      };
    });

    const weapons = rawWeaponFx.map((weapon) => {
      const fromNode = this._resolveNodeByNameOrUuid(group, weapon.from);
      const toNode = weapon.to === 'target' ? null : this._resolveNodeByNameOrUuid(group, weapon.to);
      return {
        ...weapon,
        fromResolved: !!fromNode,
        fromResolvedName: fromNode?.name || null,
        fromResolvedUuid: fromNode?.uuid || null,
        toResolved: weapon.to === 'target' ? true : !!toNode,
        toResolvedName: weapon.to === 'target' ? 'target' : (toNode?.name || null),
        toResolvedUuid: weapon.to === 'target' ? 'target' : (toNode?.uuid || null),
      };
    });

    return {
      emitters,
      weapons,
      counts: {
        emitters: emitters.length,
        weapons: weapons.length,
      },
    };
  }

  _notifyVfxBridge(instance) {
    if (!this._vfxBridge) return;
    try {
      this._vfxBridge(instance, instance?.userData?.resolvedVfx || { emitters: [], weapons: [], counts: { emitters: 0, weapons: 0 } });
    } catch (err) {
      console.warn('[ModelRegistry] VFX bridge callback failed:', err);
    }
  }
}

// Singleton — created once, reused across all galaxy3d.js instances
if (!window.__GQ_ModelRegistry) {
  window.__GQ_ModelRegistry = new GQModelRegistry();
}
