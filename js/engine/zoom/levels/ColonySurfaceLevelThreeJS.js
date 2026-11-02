/**
 * ColonySurfaceLevelThreeJS.js
 *
 * IZoomLevelRenderer — Colony Surface zoom level (Level 3), Three.js fallback.
 *
 * Uses THREE.InstancedMesh + THREE.LOD for buildings, as described in
 * COLONY_BUILDING_SYSTEM_DESIGN.md.
 *
 * In headless / test environments (no THREE) all calls are safe no-ops.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

/** @returns {typeof THREE | null} */
function getThree() {
  return (typeof window !== 'undefined' && window.THREE) || null;
}

function parseHexColor(hex, fallback) {
  const normalized = String(hex || '').trim();
  return /^#?[0-9a-f]{6}$/i.test(normalized)
    ? `#${normalized.replace(/^#/, '')}`
    : fallback;
}

function slotActivity(slot) {
  if (slot?.active === false || slot?.powered === false || slot?.vfx_enabled === false) return 0;
  const appearance = slot?.appearance?.effects?.state;
  const state = slot?.effects?.state;
  if (appearance?.activity === 0 || state?.activity === 0) return 0;
  const activity = appearance?.activity ?? state?.activity;
  const damage = appearance?.damage ?? state?.damage;
  return (Number.isFinite(activity) ? Math.max(0, Math.min(1, activity)) : 1)
    * (1 - (Number.isFinite(damage) ? Math.max(0, Math.min(1, damage)) : 0));
}

/** Maximum buildings rendered at once. */
const MAX_BUILDINGS = 512;

class ColonySurfaceLevelThreeJS extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas    = null;
    this._backend   = null;
    this._sceneData = null;
    this._unloaded = false;
    this._scene     = null;
    this._camera    = null;
    this._renderer  = null;
    this._ground    = null;
    this._lod       = null;          // THREE.LOD root node
    this._instanced = null;          // THREE.InstancedMesh for buildings
    this._instancedLo = null;
    this._ownershipRing = null;
    this._buildingVfxGroup = null;
    this._buildingVfxEmitters = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'threejs',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
    this._slotCount = 0;
    this._ownedTextures = new Set();
    this._materialSets = null;
    this._materialEpoch = 0;
    this._materialRefresh = null;
    this._visualPalette = {
      ownerColor: '#7db7ee',
      isOwned: false,
      isPlayer: false,
      groundColor: '#223311',
      buildingColor: '#446688',
      ringColor: '#ffd47a',
      clearColor: '#090d07',
    };
  }

  async initialize(canvas, backend) {
    this._unloaded = false;
    this._canvas  = canvas;
    this._backend = backend;
    if (this._renderer) return;

    const T = getThree();
    if (!T) return;
    if (typeof require !== 'undefined') {
      this._materials = require('../../assets/CoherentMaterialGenerator.js');
    } else {
      await import('../../assets/WorldAssetDescriptor.js');
      await import('../../assets/CoherentMaterialGenerator.js');
      this._materials = window.CoherentMaterialGenerator;
    }
    if (this._unloaded || this._canvas !== canvas) return;
    this._prepareMaterialSets();

    this._renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600);

    this._scene  = new T.Scene();
    this._camera = new T.PerspectiveCamera(55, (canvas.clientWidth || 800) / (canvas.clientHeight || 600), 0.1, 1000);
    this._camera.position.set(0, 12, 30);
    this._camera.lookAt(0, 0, 0);

    this._buildScene(T);
  }

  setSceneData(data) {
    this._sceneData = data || null;
    this._applySceneDataVisuals(data);
    if (this._unloaded) return;
    this._updateInstances(Array.isArray(data?.slots) ? data.slots : []);
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    if (this._unloaded || !this._renderer || !this._scene || !this._camera) return;
    this._tickBuildingVfx(Number(dt) || 0.016);
    if (cameraState && cameraState.position) {
      this._camera.position.set(
        cameraState.position.x || 0,
        cameraState.position.y || 12,
        cameraState.position.z || 30,
      );
    }
    this._renderer.render(this._scene, this._camera);
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    this._unloaded = false;
    this._prepareMaterialSets();
    const T = getThree();
    if (!this._scene && T && this._renderer) {
      this._scene = new T.Scene();
      this._buildScene(T);
    }
    this.setSceneData({ ...this._sceneData, ...transitionPayload });
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    this._unloaded = true;
    // Retain CPU game-state data and the renderer/camera, never recreate the
    // canvas context on re-entry. All owned scene GPU resources are evicted.
    this._releaseScene();
  }

  _releaseScene() {
    this._materialEpoch++;
    this._materialSets = null;
    this._materialRefresh = null;
    const geometries = new Set();
    const materials = new Set();
    this._scene?.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      objectMaterials.forEach((material) => { if (material) materials.add(material); });
      // InstancedMesh owns instance-matrix/color GPU buffers beyond geometry.
      if (object.isInstancedMesh) object.dispose?.();
    });
    geometries.forEach((geometry) => geometry.dispose?.());
    materials.forEach((material) => material.dispose?.());
    this._ownedTextures.forEach((texture) => texture.dispose());
    this._ownedTextures.clear();
    this._scene?.clear();
    this._scene = null;
    this._instanced = null;
    this._instancedLo = null;
    this._lod       = null;
    this._ground    = null;
    this._ownershipRing = null;
    this._buildingVfxGroup = null;
    this._buildingVfxEmitters = [];
    this._slotCount = 0;
    this._buildingVfxStats = {
      backend: 'threejs',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
  }

  dispose() {
    this._unloaded = true;
    this._releaseScene();
    if (this._renderer) {
      try { this._renderer.dispose(); } catch (_) {}
      this._renderer = null;
    }
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._sceneData = null;
    this._camera    = null;
    this._canvas    = null;
    this._backend   = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _buildScene(T) {
    // Ground plane
    const ground = new T.Mesh(
      new T.PlaneGeometry(100, 100),
      new T.MeshStandardMaterial({ color: this._visualPalette.groundColor, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this._scene.add(ground);
    this._ground = ground;

    const ownershipRing = new T.Mesh(
      new T.RingGeometry(16, 21, 80),
      new T.MeshBasicMaterial({
        color: this._visualPalette.ringColor,
        transparent: true,
        opacity: 0.32,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    ownershipRing.rotation.x = -Math.PI / 2;
    ownershipRing.position.y = 0.08;
    ownershipRing.visible = false;
    this._scene.add(ownershipRing);
    this._ownershipRing = ownershipRing;

    this._buildingVfxGroup = new T.Group();
    this._scene.add(this._buildingVfxGroup);

    // LOD root for buildings
    this._lod = new T.LOD();
    this._scene.add(this._lod);

    // High-detail instanced mesh
    const hiGeo = new T.BoxGeometry(1, 2, 1);
    const variants = new Float32Array(MAX_BUILDINGS);
    hiGeo.setAttribute('materialVariant', new T.InstancedBufferAttribute(variants, 1));
    hiGeo.setAttribute('emissiveActivity', new T.InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS).fill(1), 1));
    const coherentMaps = this._createCoherentMaps(T);
    const hiMat = new T.MeshStandardMaterial({
      color: '#ffffff', vertexColors: true, roughness: 1, metalness: 1,
      emissive: '#ffffff', emissiveIntensity: 1.2, ...coherentMaps,
    });
    this._configureMaterialAtlas(hiMat);
    this._instanced = new T.InstancedMesh(hiGeo, hiMat, MAX_BUILDINGS);
    this._instanced.count = 0;
    this._lod.addLevel(this._instanced, 0);

    // Low-detail placeholder (same mesh, lower poly in a real impl)
    const loGeo = new T.BoxGeometry(1, 2, 1);
    loGeo.setAttribute('materialVariant', new T.InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS), 1));
    loGeo.setAttribute('emissiveActivity', new T.InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS).fill(1), 1));
    const loMat = new T.MeshStandardMaterial({
      color: '#ffffff', vertexColors: true, roughness: 1, metalness: 1,
      emissive: '#ffffff', emissiveIntensity: 1.2, ...coherentMaps,
    });
    this._configureMaterialAtlas(loMat);
    const loMesh = new T.InstancedMesh(loGeo, loMat, MAX_BUILDINGS);
    loMesh.count = 0;
    this._lod.addLevel(loMesh, 50);
    this._instancedLo = loMesh;

    // Lighting
    this._scene.add(new T.AmbientLight(0x334455, 0.7));
    const sun = new T.DirectionalLight(0xfff0cc, 1.2);
    sun.position.set(30, 60, 40);
    this._scene.add(sun);
  }

  _createCoherentMaps(T) {
    if (!this._materials || !T.DataTexture) return {};
    const sets = this._materialSets;
    if (!sets) return {};
    const maps = {};
    const names = { albedo: 'map', normal: 'normalMap', roughness: 'roughnessMap',
      metalness: 'metalnessMap', emissive: 'emissiveMap', ao: 'aoMap' };
    for (const [name, property] of Object.entries(names)) {
      const source = sets[0].maps[name];
      if (!source) continue;
      const width = source.width * sets.length;
      const data = new Uint8Array(width * source.height * 4);
      sets.forEach((set, index) => {
        for (let row = 0; row < source.height; row++) {
          data.set(set.maps[name].data.subarray(row * source.width * 4, (row + 1) * source.width * 4),
            (row * width + index * source.width) * 4);
        }
      });
      const texture = new T.DataTexture(data, width, source.height, T.RGBAFormat);
      texture.userData.coherentMap = name;
      texture.colorSpace = name === 'albedo' || name === 'emissive' ? T.SRGBColorSpace : T.NoColorSpace;
      texture.magFilter = T.LinearFilter;
      texture.minFilter = T.LinearFilter;
      texture.wrapS = T.RepeatWrapping;
      texture.wrapT = T.RepeatWrapping;
      texture.needsUpdate = true;
      this._ownedTextures.add(texture);
      maps[property] = texture;
    }
    return maps;
  }

  _prepareMaterialSets() {
    if (this._unloaded || this._materialSets || !this._materials) return;
    const epoch = this._materialEpoch;
    const generator = this._materials;
    const descriptors = ['painted-metal', 'painted-metal', 'emissive', 'glass']
      .map((materialFamily, index) => ({
        seed: 420 + index, materialFamily, age: [0.1, 0.9, 0.25, 0.35][index],
        color: [[0.8, 0.85, 0.9], [0.86, 0.58, 0.3], [0.2, 0.65, 0.95], [0.4, 0.8, 0.65]][index],
      }));
    this._materialSets = descriptors.map((descriptor) => generator.generate(descriptor, { size: 64 }));
    if (typeof generator.generateCached !== 'function') return;
    this._materialRefresh = Promise.all(descriptors.map((descriptor, index) =>
      generator.generateCached(descriptor, { size: 64, fallback: this._materialSets[index] })))
      .then((sets) => {
        if (this._unloaded || epoch !== this._materialEpoch) return;
        this._materialSets = sets;
        this._ownedTextures.forEach((texture) => {
          const name = texture.userData.coherentMap;
          if (!name) return;
          sets.forEach((set, index) => {
            const source = set.maps[name];
            for (let row = 0; row < source.height; row++) {
              texture.image.data.set(source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4),
                (row * texture.image.width + index * source.width) * 4);
            }
          });
          texture.needsUpdate = true;
        });
      })
      .catch(() => { /* Keep the visible synchronous fallback when optional persistence fails. */ });
  }

  _configureMaterialAtlas(material) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float materialVariant;\nattribute float emissiveActivity;\nvarying float vEmissiveActivity;\n${shader.vertexShader}`;
      shader.fragmentShader = `varying float vEmissiveActivity;\n${shader.fragmentShader}`;
      const transforms = [
        ['USE_MAP', 'vMapUv'], ['USE_NORMALMAP', 'vNormalMapUv'],
        ['USE_ROUGHNESSMAP', 'vRoughnessMapUv'], ['USE_METALNESSMAP', 'vMetalnessMapUv'],
        ['USE_EMISSIVEMAP', 'vEmissiveMapUv'], ['USE_AOMAP', 'vAoMapUv'],
      ].map(([define, uv]) => `\n#ifdef ${define}\n${uv}.x = (${uv}.x * 0.98 + 0.01 + materialVariant) / 4.0;\n#endif`).join('');
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\nvEmissiveActivity = emissiveActivity;${transforms}`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vEmissiveActivity;');
    };
    material.customProgramCacheKey = () => 'colony-coherent-atlas-v1';
  }

  _updateInstances(slots) {
    if (!this._instanced) return;
    const T = getThree();
    if (!T) return;

    const count = Math.min(slots.length, MAX_BUILDINGS);
    const mat   = new T.Matrix4();
    const color = new T.Color();

    for (let i = 0; i < count; i++) {
      const s = slots[i] || {};
      mat.makeTranslation(Number(s.x || 0), Number(s.y || 0) + 1, Number(s.z || 0));
      this._instanced.setMatrixAt(i, mat);
      color.set(parseHexColor(s.owner_color || s.colony_owner_color || s.faction_color || '', this._visualPalette.buildingColor));
      this._instanced.setColorAt(i, color);
      const text = String(s.type || s.building_type || s.category || '');
      const variant = /mine|factory|refinery|industry/i.test(text) ? 1
        : /power|reactor|energy/i.test(text) ? 2 : /lab|research|science/i.test(text) ? 3 : 0;
      this._instanced.geometry.getAttribute('materialVariant').setX(i, variant);
      this._instancedLo?.geometry.getAttribute('materialVariant').setX(i, variant);
      this._instanced.geometry.getAttribute('emissiveActivity').setX(i, slotActivity(s));
      this._instancedLo?.geometry.getAttribute('emissiveActivity').setX(i, slotActivity(s));
    }
    this._instanced.count = count;
    this._instanced.instanceMatrix.needsUpdate = true;
    this._instanced.geometry.getAttribute('materialVariant').needsUpdate = true;
    if (this._instancedLo) this._instancedLo.geometry.getAttribute('materialVariant').needsUpdate = true;
    this._instanced.geometry.getAttribute('emissiveActivity').needsUpdate = true;
    if (this._instancedLo) this._instancedLo.geometry.getAttribute('emissiveActivity').needsUpdate = true;
    if (this._instanced.instanceColor) this._instanced.instanceColor.needsUpdate = true;
    this._slotCount = count;
    this._rebuildBuildingVfx(slots);

    // Sync low-detail LOD level as well.
    const lo = this._instancedLo;
    if (lo) {
      for (let i = 0; i < count; i++) {
        const s = slots[i] || {};
        lo.setMatrixAt(i, this._instanced.instanceMatrix.array
          ? (() => { const m = new T.Matrix4(); m.fromArray(this._instanced.instanceMatrix.array, i * 16); return m; })()
          : mat);
        color.set(parseHexColor(s.owner_color || s.colony_owner_color || s.faction_color || '', this._visualPalette.buildingColor));
        lo.setColorAt(i, color);
      }
      lo.count = count;
      lo.instanceMatrix.needsUpdate = true;
      if (lo.instanceColor) lo.instanceColor.needsUpdate = true;
    }
  }

  _resolveBuildingVfxQuality(slotCount) {
    const requested = String(this._sceneData?.vfx_quality || this._sceneData?.quality || '').toLowerCase();
    if (requested === 'low' || requested === 'medium' || requested === 'high') return requested;
    if (slotCount > 280) return 'low';
    if (slotCount > 120) return 'medium';
    return 'high';
  }

  _slotVfxProfile(slot) {
    const explicitProfile = String(slot?.vfx_profile || slot?.fx_profile
      || slot?.appearance?.effects?.profile || slot?.effects?.profile || '').toLowerCase();
    const explicitIntensity = Math.max(0.4, Math.min(2.2, Number(slot?.vfx_intensity || slot?.fx_intensity || 1) || 1));
    if (explicitProfile) {
      if (explicitProfile === 'construction' || explicitProfile === 'upgrade') {
        return {
          profileName: 'construction',
          particleMul: 1.35 * explicitIntensity,
          sizeMul: 1.12,
          opacityAdd: 0.12,
          heightMul: 1.25,
          driftMul: 1.25,
          colorHex: '#ffb36b',
        };
      }
      if (explicitProfile === 'industry' || explicitProfile === 'industrial' || explicitProfile === 'smelter' || explicitProfile === 'refinery') {
        return {
          profileName: 'industry',
          particleMul: 1.2 * explicitIntensity,
          sizeMul: 1.06,
          opacityAdd: 0.08,
          heightMul: 1.12,
          driftMul: 1.16,
          colorHex: '#ffc978',
        };
      }
      if (explicitProfile === 'power' || explicitProfile === 'energy' || explicitProfile === 'reactor') {
        return {
          profileName: 'power',
          particleMul: 1.05 * explicitIntensity,
          sizeMul: 1,
          opacityAdd: 0.06,
          heightMul: 1,
          driftMul: 1.08,
          colorHex: '#8ad5ff',
        };
      }
      if (explicitProfile === 'research' || explicitProfile === 'science') {
        return {
          profileName: 'research',
          particleMul: 0.95 * explicitIntensity,
          sizeMul: 0.92,
          opacityAdd: 0.05,
          heightMul: 0.92,
          driftMul: 0.92,
          colorHex: '#9fd0ff',
        };
      }
      if (explicitProfile === 'quiet' || explicitProfile === 'minimal') {
        return {
          profileName: 'quiet',
          particleMul: 0.6 * explicitIntensity,
          sizeMul: 0.82,
          opacityAdd: -0.05,
          heightMul: 0.78,
          driftMul: 0.7,
          colorHex: '',
        };
      }
    }

    const text = [
      slot?.type,
      slot?.building_type,
      slot?.category,
      slot?.state,
      slot?.status,
      slot?.activity,
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    const busy = !!slot?.upgrade_end
      || /construction|building|upgrade|running|queued|active/.test(text);
    const industrial = /mine|factory|refinery|smelter|forge|industry/.test(text);
    const research = /lab|research|science/.test(text);
    const power = /power|reactor|fusion|energy/.test(text);

    if (busy) {
      return {
        profileName: 'construction',
        particleMul: 1.35 * explicitIntensity,
        sizeMul: 1.12,
        opacityAdd: 0.12,
        heightMul: 1.25,
        driftMul: 1.25,
        colorHex: '#ffb36b',
      };
    }
    if (industrial) {
      return {
        profileName: 'industry',
        particleMul: 1.2 * explicitIntensity,
        sizeMul: 1.06,
        opacityAdd: 0.08,
        heightMul: 1.12,
        driftMul: 1.16,
        colorHex: '#ffc978',
      };
    }
    if (power) {
      return {
        profileName: 'power',
        particleMul: 1.05 * explicitIntensity,
        sizeMul: 1.0,
        opacityAdd: 0.06,
        heightMul: 1.0,
        driftMul: 1.08,
        colorHex: '#8ad5ff',
      };
    }
    if (research) {
      return {
        profileName: 'research',
        particleMul: 0.95 * explicitIntensity,
        sizeMul: 0.92,
        opacityAdd: 0.05,
        heightMul: 0.92,
        driftMul: 0.92,
        colorHex: '#9fd0ff',
      };
    }
    return {
      profileName: 'auto',
      particleMul: 1 * explicitIntensity,
      sizeMul: 1,
      opacityAdd: 0,
      heightMul: 1,
      driftMul: 1,
      colorHex: '',
    };
  }

  _clearBuildingVfx(disposeMaterials) {
    const T = getThree();
    if (!this._buildingVfxGroup || !T) return;
    while (this._buildingVfxGroup.children.length) {
      const child = this._buildingVfxGroup.children[0];
      this._buildingVfxGroup.remove(child);
      if (!disposeMaterials) continue;
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    this._buildingVfxEmitters = [];
  }

  _slotKey(slot, index) {
    const sx = Number(slot?.x || 0).toFixed(2);
    const sz = Number(slot?.z || 0).toFixed(2);
    const type = String(slot?.type || slot?.building_type || slot?.category || 'generic');
    return `${index}:${sx}:${sz}:${type}`;
  }

  _ingestUpgradeTransitions(slots) {
    const source = Array.isArray(slots) ? slots : [];
    const next = new Map();
    let detectedTransition = false;
    for (let i = 0; i < source.length; i += 1) {
      const slot = source[i] || {};
      const key = this._slotKey(slot, i);
      const active = !!slot?.upgrade_end;
      next.set(key, active);
      const previous = this._slotUpgradeState.get(key);
      if (typeof previous === 'boolean' && previous !== active) {
        detectedTransition = true;
      }
    }
    this._slotUpgradeState = next;
    if (detectedTransition) {
      this._buildingVfxBurstUntil = Math.max(this._buildingVfxBurstUntil, this._buildingVfxTime + 1.6);
    }
  }

  _rebuildBuildingVfx(slots) {
    const T = getThree();
    if (!T || !this._buildingVfxGroup) return;
    this._clearBuildingVfx(true);
    const reduced = this._sceneData?.reduced_motion
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const disabled = this._sceneData?.vfx_enabled === false || this._sceneData?.vfx_quality === 'off'
      || this._sceneData?.visible === false || reduced;
    const catalog = Array.isArray(slots) ? slots.slice(0, MAX_BUILDINGS) : [];
    this._ingestUpgradeTransitions(catalog);
    const source = disabled ? [] : catalog.filter((slot) => slot?.visible !== false && slotActivity(slot) > 0);
    if (!source.length) {
      this._buildingVfxStats = {
        backend: 'threejs', quality: this._resolveBuildingVfxQuality(0),
        emitters: 0, particles: 0, profileCounts: {}, burstActive: false,
      };
      return;
    }

    const quality = this._resolveBuildingVfxQuality(source.length);
    const qualityMap = {
      low: { emitters: 10, particlesPerEmitter: 8, size: 0.18, opacity: 0.18 },
      medium: { emitters: 20, particlesPerEmitter: 10, size: 0.2, opacity: 0.22 },
      high: { emitters: 36, particlesPerEmitter: 14, size: 0.22, opacity: 0.28 },
    };
    const cfg = qualityMap[quality] || qualityMap.medium;
    const profileCounts = {};
    const maxParticles = 900;
    const maxEmittersByCap = Math.max(1, Math.floor(maxParticles / Math.max(1, cfg.particlesPerEmitter)));
    const emitterCount = Math.min(source.length, cfg.emitters, maxEmittersByCap);
    const stride = Math.max(1, Math.floor(source.length / emitterCount));
    let remainingParticles = maxParticles;

    for (let e = 0; e < emitterCount; e += 1) {
      if (remainingParticles <= 0) break;
      const slot = source[Math.min(source.length - 1, e * stride)] || {};
      const profile = this._slotVfxProfile(slot);
      const profileName = String(profile.profileName || 'auto');
      profileCounts[profileName] = (profileCounts[profileName] || 0) + 1;
      const particleCount = Math.max(3, Math.min(remainingParticles, Math.round(cfg.particlesPerEmitter * profile.particleMul * slotActivity(slot))));
      const positions = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i += 1) {
        const idx = i * 3;
        const a = Math.random() * Math.PI * 2;
        const r = 0.12 + Math.random() * 0.82;
        positions[idx] = Math.cos(a) * r;
        positions[idx + 1] = (0.45 + Math.random() * 1.65) * profile.heightMul;
        positions[idx + 2] = Math.sin(a) * r;
      }

      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      const color = parseHexColor(
        profile.colorHex || slot.owner_color || slot.colony_owner_color || slot.faction_color || '',
        this._visualPalette.buildingColor
      );
      const material = new T.PointsMaterial({
        color: profileName === 'industry' ? '#7d8996' : color,
        size: cfg.size * profile.sizeMul,
        transparent: true,
        opacity: Math.max(0.08, Math.min(0.58, cfg.opacity + profile.opacityAdd)),
        blending: profileName === 'industry' ? T.NormalBlending : T.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new T.Points(geometry, material);
      points.position.set(Number(slot.x || 0), Number(slot.y || 0), Number(slot.z || 0));
      points.userData = Object.assign({}, points.userData, {
        pulsePhase: Math.random() * Math.PI * 2,
        drift: (0.18 + Math.random() * 0.22) * profile.driftMul,
        baseOpacity: Math.max(0.08, Math.min(0.58, cfg.opacity + profile.opacityAdd)),
      });
      this._buildingVfxGroup.add(points);
      this._buildingVfxEmitters.push(points);
      remainingParticles -= particleCount;
    }
    this._buildingVfxStats = {
      backend: 'threejs',
      quality,
      emitters: this._buildingVfxEmitters.length,
      particles: this._buildingVfxEmitters.reduce((sum, emitter) => {
        const count = Number(emitter?.geometry?.getAttribute?.('position')?.count || 0);
        return sum + count;
      }, 0),
      profileCounts,
      burstActive: this._buildingVfxBurstUntil > this._buildingVfxTime,
    };
  }

  _tickBuildingVfx(dt) {
    if (!this._buildingVfxEmitters.length) return;
    this._buildingVfxTime += Math.max(0, Number(dt) || 0.016);
    const t = this._buildingVfxTime;
    const burstT = this._sceneData?.reduced_flash !== true && this._buildingVfxBurstUntil > t
      ? Math.max(0, Math.min(1, (this._buildingVfxBurstUntil - t) / 1.6))
      : 0;
    this._buildingVfxEmitters.forEach((points, index) => {
      const mat = points?.material;
      if (!mat) return;
      const phase = Number(points.userData?.pulsePhase || 0);
      const drift = Number(points.userData?.drift || 0.2);
      const baseOpacity = Number(points.userData?.baseOpacity || 0.2);
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.1 + index * 0.02) + phase);
      points.rotation.y += dt * drift;
      points.rotation.z = Math.sin(t * 0.45 + phase) * 0.06;
      mat.opacity = Math.max(0.08, Math.min(0.72, baseOpacity + pulse * 0.16 + burstT * 0.22));
      points.scale.setScalar(1 + burstT * 0.18);
    });
    if (this._buildingVfxStats) {
      this._buildingVfxStats.burstActive = burstT > 0.001;
    }
    if (typeof window !== 'undefined') {
      window.__GQ_COLONY_VFX_STATS = Object.assign({}, this._buildingVfxStats || {}, {
        ts: Date.now(),
      });
    }
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.colony && typeof data.colony === 'object') return data.colony;
    if (Array.isArray(data.slots) && data.slots.length) return data.slots[0];
    return data;
  }

  _applySceneDataVisuals(data) {
    const T = getThree();
    const source = this._resolveVisualSource(data);
    const ownerColor = parseHexColor(
      source?.colony_owner_color || source?.owner_color || source?.faction_color || '',
      '#7db7ee'
    );
    const isOwned = !!String(source?.colony_owner_color || source?.owner_color || source?.faction_color || '').trim();
    const isPlayer = Number(source?.colony_is_player || source?.is_player || 0) === 1;
    this._visualPalette = {
      ownerColor,
      isOwned,
      isPlayer,
      groundColor: isOwned ? '#16211a' : '#223311',
      buildingColor: isOwned ? ownerColor : '#446688',
      ringColor: isPlayer ? '#7dffb2' : ownerColor,
      clearColor: isOwned ? '#0b120d' : '#090d07',
    };
    if (!T) return;
    if (this._scene?.background) {
      this._scene.background.set(this._visualPalette.clearColor);
    } else if (this._scene) {
      this._scene.background = new T.Color(this._visualPalette.clearColor);
    }
    if (this._ground?.material?.color) {
      this._ground.material.color.set(this._visualPalette.groundColor);
    }
    if (this._instanced?.material?.color) {
      this._instanced.material.color.set('#ffffff');
    }
    if (this._instancedLo?.material?.color) {
      this._instancedLo.material.color.set('#ffffff');
    }
    if (this._ownershipRing?.material?.color) {
      this._ownershipRing.material.color.set(this._visualPalette.ringColor);
      this._ownershipRing.material.opacity = isPlayer ? 0.42 : 0.32;
      this._ownershipRing.visible = isOwned;
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ColonySurfaceLevelThreeJS };
} else {
  window.GQColonySurfaceLevelThreeJS = { ColonySurfaceLevelThreeJS };
}
