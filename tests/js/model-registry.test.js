import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import '../../js/runtime/model_registry.js';

const Registry = window.__GQ_ModelRegistry.constructor;

function asset(material = new THREE.MeshStandardMaterial()) {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  return { scene, animations: [] };
}

describe('model registry asset/material integration', () => {
  let registry;
  let textureLoad;

  beforeEach(() => {
    vi.stubGlobal('THREE', THREE);
    registry = new Registry();
    textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation(() => new THREE.Texture());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('preloads only the supported installation catalog using the normal load path', async () => {
    const load = vi.spyOn(registry, 'load').mockResolvedValue();
    await registry.preload();
    expect(load.mock.calls.map(([type]) => type)).toEqual([
      'stargate', 'relay_station', 'jump_inhibitor',
      'deep_space_radar', 'space_station', 'transport_shuttle',
    ]);
  });

  it('keeps color/data cache entries separate even for the same URL', () => {
    const material = registry._buildMaterial({
      map: '/hull.png', emissiveMap: '/hull.png', roughnessMap: '/hull.png',
      normalMap: '/normal.png', metalnessMap: '/metal.png', aoMap: '/ao.png', alphaMap: '/alpha.png',
      envMapIntensity: 0,
    });
    expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.emissiveMap).toBe(material.map);
    expect(material.roughnessMap).not.toBe(material.map);
    for (const slot of ['roughnessMap', 'normalMap', 'metalnessMap', 'aoMap', 'alphaMap']) {
      expect(material[slot].colorSpace).toBe(THREE.NoColorSpace);
    }
    expect(material.envMapIntensity).toBe(0);
    expect(textureLoad).toHaveBeenCalledTimes(6);
  });

  it('uses only capability-ready configured KTX2 loaders and uncompressed fallback', () => {
    expect(() => registry.configureAssetLoaders({ ktx2Loader: { load: vi.fn() } }))
      .toThrow('transcoder path');
    const source = { url: '/hull.ktx2?v=1', fallback: '/hull.png' };
    expect(registry._loadTexture(source).colorSpace).toBe(THREE.SRGBColorSpace);
    expect(textureLoad).toHaveBeenCalledWith('/hull.png');
    expect(registry._loadTexture('/unconfigured.ktx2')).toBeNull();
    const ktx2Loader = {
      transcoderPath: '/basis/', workerConfig: { astcSupported: true },
      load: vi.fn(),
    };
    registry.configureAssetLoaders({ ktx2Loader });
    const material = registry._buildMaterial({ normalMap: '/normal.ktx2' });
    const second = registry._buildMaterial({ normalMap: '/normal.ktx2' });
    expect(ktx2Loader.load).toHaveBeenCalledOnce();
    expect(ktx2Loader.load.mock.calls[0][0]).toBe('/normal.ktx2');
    expect(material.normalMap).toBeNull();
    const loaded = new THREE.CompressedTexture([], 1, 1);
    loaded.colorSpace = THREE.SRGBColorSpace;
    ktx2Loader.load.mock.calls[0][1](loaded);
    expect(material.normalMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(second.normalMap).toBe(material.normalMap);
    expect(registry._loadTexture('/normal.ktx2', false)).toBe(material.normalMap);
    expect(loaded.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('loads API glTF descriptors through the configured shared loader and caches templates', async () => {
    const loaded = asset([
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee }),
    ]);
    loaded.animations.push(new THREE.AnimationClip('active_spin', 1, []));
    const gltfLoader = { loadAsync: vi.fn().mockResolvedValue(loaded), setKTX2Loader: vi.fn() };
    const ktx2Loader = { transcoderPath: '/basis/', workerConfig: {}, load: vi.fn() };
    registry.configureAssetLoaders({ gltfLoader, ktx2Loader });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        id: 'space_station', model_url: '/station.glb', scale: 2,
        rendering: { envMapIntensity: 0.6, castShadow: true, receiveShadow: true },
      }),
    }));
    const first = registry.load('space_station');
    expect(registry.load('space_station')).toBe(first);
    await first;
    expect(gltfLoader.loadAsync).toHaveBeenCalledExactlyOnceWith('/station.glb');
    expect(gltfLoader.setKTX2Loader).toHaveBeenCalledWith(ktx2Loader);
    expect(registry.hasCached('space_station')).toBe(true);
    const instance = registry.instantiate('space_station', '#ff0000', 'active');
    expect(instance.visible).toBe(true);
    expect(instance.scale.x).toBe(2);
    const mesh = instance.children[0].children[0];
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.material[0].envMapIntensity).toBe(0.6);
    expect(mesh.material[0]).not.toBe(loaded.scene.children[0].material[0]);
    expect(instance.userData.animState).toBe('active');
    expect(instance.userData.animActionsByState.active).toHaveLength(1);
    await registry.load('space_station');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('finishes compressed maps before caching and cloning legacy templates', async () => {
    const ktx2Loader = { transcoderPath: '/basis/', workerConfig: {}, load: vi.fn() };
    registry.configureAssetLoaders({ ktx2Loader });
    const descriptor = {
      id: 'space_station', geometry: { type: 'box', material: { map: '/hull.ktx2' } },
    };
    const pending = registry._buildFromDescriptor(descriptor);
    let completed = false;
    pending.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    ktx2Loader.load.mock.calls[0][1](new THREE.CompressedTexture([], 1, 1));
    const template = await pending;
    registry._cache.set('space_station', template);
    const instance = registry.instantiate('space_station', '#ffffff');
    expect(instance.children[0].material.map.isCompressedTexture).toBe(true);
    expect(instance.children[0].material.map.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('settles failed compressed loads without leaving a stuck template request', async () => {
    const ktx2Loader = { transcoderPath: '/basis/', workerConfig: {}, load: vi.fn() };
    registry.configureAssetLoaders({ ktx2Loader });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const descriptor = { geometry: { type: 'box', material: { map: '/missing.ktx2' } } };
    const pending = registry._buildFromDescriptor(descriptor);
    ktx2Loader.load.mock.calls[0][3](new Error('unavailable'));
    const template = await pending;
    expect(template.children[0].material.map).toBeNull();
    expect(registry._textureLoading.size).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('creates real Three.js LODs from validated prepared assets', async () => {
    const loader = { loadAsync: vi.fn().mockImplementation(async () => asset()) };
    registry.configureAssetLoaders({ gltfLoader: loader });
    const group = await registry._buildFromDescriptor({ lods: [
      { distance: 0, model_url: '/high.gltf' },
      { distance: 50, model_url: '/low.glb' },
    ] });
    expect(group.isLOD).toBe(true);
    expect(group.levels.map((level) => level.distance)).toEqual([0, 50]);
    group.update(new THREE.PerspectiveCamera());
    expect(group.levels[0].object.visible).toBe(true);
    const camera = new THREE.PerspectiveCamera();
    camera.position.z = 100;
    camera.updateMatrixWorld();
    group.update(camera);
    expect(group.levels[0].object.visible).toBe(false);
    expect(group.levels[1].object.visible).toBe(true);
  });

  it('waits for late acquired LODs and releases owned resources once on partial failure', async () => {
    const loaded = asset();
    const mesh = loaded.scene.children[0];
    mesh.material.map = new THREE.Texture();
    mesh.material.emissiveMap = mesh.material.map;
    loaded.scene.add(new THREE.Mesh(mesh.geometry, mesh.material));
    const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(mesh.material, 'dispose');
    const disposeTexture = vi.spyOn(mesh.material.map, 'dispose');
    let finish;
    const lateAsset = new Promise((resolve) => { finish = resolve; });
    const failure = new Error('LOD unavailable');
    registry.configureAssetLoaders({
      ownsGltfResources: true,
      gltfLoader: { loadAsync: (url) => url === '/high.glb' ? Promise.reject(failure) : lateAsset },
    });
    const pending = registry._buildFromDescriptor({ lods: [
      { distance: 0, model_url: '/high.glb' },
      { distance: 50, model_url: '/low.glb' },
    ] });
    await Promise.resolve();
    expect(disposeGeometry).not.toHaveBeenCalled();
    finish(loaded);
    await expect(pending).rejects.toBe(failure);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });

  it('cleans owned nondefault scenes when an acquired glTF has no default scene', async () => {
    const loaded = asset();
    const dispose = vi.spyOn(loaded.scene.children[0].geometry, 'dispose');
    registry.configureAssetLoaders({
      ownsGltfResources: true,
      gltfLoader: { loadAsync: async () => ({ scenes: [loaded.scene] }) },
    });
    await expect(registry._buildFromDescriptor({ model_url: '/invalid.glb' }))
      .rejects.toThrow('no default scene');
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not dispose borrowed glTF results on failure', async () => {
    const loaded = asset();
    const mesh = loaded.scene.children[0];
    mesh.material.map = new THREE.Texture();
    const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(mesh.material, 'dispose');
    const disposeTexture = vi.spyOn(mesh.material.map, 'dispose');
    registry.configureAssetLoaders({
      gltfLoader: { loadAsync: (url) => url === '/high.glb'
        ? Promise.resolve(loaded) : Promise.reject(new Error('missing')) },
    });
    await expect(registry._buildFromDescriptor({ lods: [
      { distance: 0, model_url: '/high.glb' },
      { distance: 50, model_url: '/low.glb' },
    ] })).rejects.toThrow('missing');
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(disposeTexture).not.toHaveBeenCalled();
  });

  it('honors shared texture ownership even for registry-owned glTF scene resources', async () => {
    const loaded = asset();
    const material = loaded.scene.children[0].material;
    material.userData.sharedTexture = true;
    material.map = new THREE.Texture();
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const disposeTexture = vi.spyOn(material.map, 'dispose');
    registry.configureAssetLoaders({
      ownsGltfResources: true,
      gltfLoader: { loadAsync: async () => ({ scenes: [loaded.scene] }) },
    });
    await expect(registry._buildFromDescriptor({ model_url: '/invalid.glb' }))
      .rejects.toThrow('no default scene');
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).not.toHaveBeenCalled();
  });

  it('cleans acquired owned scenes if skeleton clone support cannot load', async () => {
    const scene = new THREE.Group();
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    registry.configureAssetLoaders({
      ownsGltfResources: true, gltfLoader: { loadAsync: async () => ({ scene, animations: [] }) },
    });
    vi.doMock('three/addons/utils/SkeletonUtils.js', () => { throw new Error('clone module unavailable'); });
    try {
      await expect(registry._buildFromDescriptor({ model_url: '/skin.glb' })).rejects.toThrow();
      expect(dispose).toHaveBeenCalledOnce();
      expect(scene.parent).toBeNull();
    } finally {
      vi.doUnmock('three/addons/utils/SkeletonUtils.js');
    }
  });

  it('uses the installed glTF loader by default, not a separate asset format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'AuthoredHull' }],
    }), { headers: { 'Content-Type': 'model/gltf+json' } })));
    const group = await registry._buildFromDescriptor({
      model_url: 'https://assets.example.test/ship.gltf',
    });
    expect(group.getObjectByName('AuthoredHull')).toBeDefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('gives skinned glTF instances independent skeletons', async () => {
    const bone = new THREE.Bone();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    const scene = new THREE.Group();
    scene.add(mesh);
    registry.configureAssetLoaders({
      gltfLoader: { loadAsync: async () => ({ scene, animations: [] }) },
    });
    registry._cache.set('space_station', await registry._buildFromDescriptor({ model_url: '/skin.glb' }));
    const first = registry.instantiate('space_station');
    const second = registry.instantiate('space_station');
    const firstMesh = first.children[0].children[0];
    const secondMesh = second.children[0].children[0];
    expect(firstMesh.skeleton).not.toBe(secondMesh.skeleton);
    expect(firstMesh.skeleton.bones[0]).toBe(firstMesh.children[0]);
    firstMesh.skeleton.bones[0].position.x = 2;
    expect(secondMesh.skeleton.bones[0].position.x).toBe(0);
    expect(bone.position.x).toBe(0);
  });

  it.each([
    [], [{ distance: 1, model_url: '/high.glb' }],
    [{ distance: 0, model_url: '/bad.obj' }],
    [{ distance: 0, model_url: '/high.glb' }, { distance: 0, model_url: '/low.glb' }],
    [{ distance: 0, model_url: '/high.glb' }, { distance: Infinity, model_url: '/low.glb' }],
    [{ distance: 0, model_url: '/high.glb' }, null],
  ].map((lods) => ({ lods })))('rejects invalid prepared LOD metadata before loading %#', async ({ lods }) => {
    const loader = { loadAsync: vi.fn() };
    registry.configureAssetLoaders({ gltfLoader: loader });
    await expect(registry._buildFromDescriptor({ lods })).rejects.toThrow('Model LODs');
    expect(loader.loadAsync).not.toHaveBeenCalled();
  });

  it('keeps legacy assets and selective opt-in shadow settings', async () => {
    const group = await registry._buildFromDescriptor({
      id: 'legacy', rendering: { castShadow: true, envMapIntensity: 2 },
      geometry: { type: 'group', children: [
        { type: 'box', userData: { castShadow: false, receiveShadow: true } },
        { type: 'sphere' },
      ] },
    });
    expect(group.children[0].castShadow).toBe(false);
    expect(group.children[0].receiveShadow).toBe(true);
    expect(group.children[1].castShadow).toBe(true);
    expect(group.children[1].receiveShadow).toBe(false);
    expect(group.children[1].material.envMapIntensity).toBe(2);
  });

  it('preserves authored glTF material spaces and shadow defaults without overrides', async () => {
    const loaded = asset();
    loaded.scene.children[0].castShadow = true;
    loaded.scene.children[0].material.envMapIntensity = 3;
    registry.configureAssetLoaders({ gltfLoader: { loadAsync: async () => loaded } });
    const group = await registry._buildFromDescriptor({ model_url: '/authored.glb' });
    expect(group.children[0].children[0].castShadow).toBe(true);
    expect(group.children[0].children[0].material.envMapIntensity).toBe(3);
    expect(textureLoad).not.toHaveBeenCalled();
  });
});
