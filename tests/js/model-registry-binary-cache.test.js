import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AssetBinaryCache } from '../../js/engine/assets/AssetBinaryCache.js';
import '../../js/runtime/model_registry.js';

const Registry = window.__GQ_ModelRegistry.constructor;

function glb(json = { asset: { version: '2.0' }, scene: 0, scenes: [{}] }) {
  const text = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
  const bytes = new ArrayBuffer(20 + jsonBytes.length);
  const header = new DataView(bytes);
  [0x46546c67, 2, bytes.byteLength, jsonBytes.length, 0x4e4f534a]
    .forEach((value, i) => header.setUint32(i * 4, value, true));
  new Uint8Array(bytes, 20).set(jsonBytes);
  return bytes;
}

describe('registry public standalone GLB binary path', () => {
  let registry;
  let loader;
  let cache;
  beforeEach(() => {
    vi.stubGlobal('THREE', THREE);
    registry = new Registry();
    loader = {
      loadAsync: vi.fn(async () => ({ scene: new THREE.Group(), animations: [] })),
      parseAsync: vi.fn(async () => ({ scene: new THREE.Group(), animations: [] })),
    };
    registry.configureAssetLoaders({ gltfLoader: loader, cachePublicAssets: true });
    cache = new AssetBinaryCache({ indexedDB: null, crypto: webcrypto });
    registry._binaryCache = cache;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, headers: new Headers({ 'Cache-Control': 'public, max-age=31536000' }),
      arrayBuffer: async () => glb(),
    })));
  });
  afterEach(() => {
    cache.close();
    vi.unstubAllGlobals();
  });

  it('fetches public bytes without credentials and parses cached copies on later templates', async () => {
    const descriptor = { model_url: '/assets/models/station.glb?v=42' };
    await registry._buildFromDescriptor(descriptor);
    await registry._buildFromDescriptor(descriptor);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      `${location.origin}/assets/models/station.glb?v=42`,
      expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store' }),
    );
    expect(loader.parseAsync).toHaveBeenCalledTimes(2);
    expect(loader.parseAsync.mock.calls[0][0]).not.toBe(loader.parseAsync.mock.calls[1][0]);
    expect(loader.loadAsync).not.toHaveBeenCalled();
    await registry._buildFromDescriptor({ model_url: '/assets/models/station.glb?v=43' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves injected loader URL/auth/header/manager behavior unless explicitly opted in', async () => {
    registry.configureAssetLoaders({ gltfLoader: loader });
    loader.requestHeader = { Authorization: 'test-only-private-request-policy' };
    loader.manager = new THREE.LoadingManager();
    loader.manager.setURLModifier((url) => `/resolved${url}`);
    await registry._buildFromDescriptor({ model_url: '/assets/models/station.glb?v=42' });
    expect(registry._gltfLoaderInjected).toBe(true);
    expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith('/assets/models/station.glb?v=42');
    expect(loader.parseAsync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(cache._memory.size).toBe(0);
  });

  it.each([
    '/api/private.glb?v=1', '/assets/models/unversioned.glb',
    '/assets/models/hull.glb?v=1&token=secret',
    'https://other.invalid/assets/models/hull.glb?v=1',
    '/assets/models/%2e%2e/private.glb?v=1',
    '/assets/models/hull.gltf?v=1',
  ])('does not persist unsafe/nonpublic/nonstandalone candidate %s', async (url) => {
    await registry._buildFromDescriptor({ model_url: url });
    expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith(url);
    expect(fetch).not.toHaveBeenCalled();
    expect(cache._memory.size).toBe(0);
  });

  it.each(['private', 'no-store'])('honors response cache policy %s', async (policy) => {
    fetch.mockResolvedValue({
      ok: true, headers: new Headers({ 'Cache-Control': policy }), arrayBuffer: async () => glb(),
    });
    const descriptor = { model_url: '/assets/models/hull.glb?v=1' };
    await registry._buildFromDescriptor(descriptor);
    await registry._buildFromDescriptor(descriptor);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache._memory.size).toBe(0);
  });

  it('also caches versioned checked-in TRELLIS2 public imports', async () => {
    await registry._buildFromDescriptor({
      model_url: '/generated/trellis2/imported/ship/hull.glb', version: 'release-2',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(loader.loadAsync).not.toHaveBeenCalled();
    expect(cache._memory.size).toBe(1);
  });

  it('preserves ordinary loading of external GLB resources without persistence', async () => {
    fetch.mockResolvedValue({
      ok: true, arrayBuffer: async () => glb({
        asset: { version: '2.0' }, buffers: [{ uri: '/api/private-buffer' }],
      }),
    });
    await registry._buildFromDescriptor({ model_url: '/assets/models/hull.glb?v=1' });
    expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith('/assets/models/hull.glb?v=1');
    expect(loader.parseAsync).not.toHaveBeenCalled();
    expect(cache._memory.size).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, '', '  ', 'a'.repeat(129)])(
    'leaves invalid asset version %s on the uncached loader path', async (version) => {
      await registry._buildFromDescriptor({ model_url: '/assets/models/hull.glb', version });
      expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith('/assets/models/hull.glb');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['get', 'put', 'delete'])('falls back to the original loader if cache %s fails', async (method) => {
    vi.spyOn(cache, method).mockRejectedValue(new Error('Storage unavailable'));
    if (method === 'delete') loader.parseAsync.mockRejectedValueOnce(new Error('Bad GLB'));
    await registry._buildFromDescriptor({ model_url: '/assets/models/hull.glb?v=1' });
    expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith('/assets/models/hull.glb?v=1');
  });

  it('keeps ordinary model loading available when the cache module cannot import', async () => {
    vi.doMock('../../js/engine/assets/AssetBinaryCache.js', () => { throw new Error('Module unavailable'); });
    try {
      await registry._buildFromDescriptor({ model_url: '/assets/models/hull.glb?v=1' });
      expect(loader.loadAsync).toHaveBeenCalledExactlyOnceWith('/assets/models/hull.glb?v=1');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('../../js/engine/assets/AssetBinaryCache.js');
    }
  });

  it('refetches integrity-corrupt cached bytes before parsing', async () => {
    const descriptor = { model_url: '/assets/models/hull.glb?v=1' };
    await registry._buildFromDescriptor(descriptor);
    new Uint8Array(cache._memory.values().next().value.bytes)[0] = 0;
    await registry._buildFromDescriptor(descriptor);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loader.parseAsync).toHaveBeenCalledTimes(2);
  });

  it('evicts cache entries rejected by the parser and retries network once', async () => {
    const descriptor = { model_url: '/assets/models/hull.glb?v=1' };
    await registry._buildFromDescriptor(descriptor);
    loader.parseAsync.mockRejectedValueOnce(new Error('stale GLB'));
    await registry._buildFromDescriptor(descriptor);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loader.parseAsync).toHaveBeenCalledTimes(3);
  });

  it('uses the real GLTFLoader parser for a versioned embedded GLB', async () => {
    registry.configureAssetLoaders();
    const group = await registry._buildFromDescriptor({ model_url: '/assets/models/empty.glb?v=1' });
    expect(group.isGroup).toBe(true);
    expect(group.children).toHaveLength(1);
    expect(cache._memory.size).toBe(1);
  });

  it('retains the successfully reparsed asset if the retry cache write fails', async () => {
    const descriptor = { model_url: '/assets/models/hull.glb?v=1' };
    await registry._buildFromDescriptor(descriptor);
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    loader.parseAsync.mockRejectedValueOnce(new Error('Cached parse rejected'))
      .mockResolvedValueOnce({ scene, animations: [] });
    vi.spyOn(cache, 'put').mockRejectedValue(new Error('Optional persistence write failed'));
    const group = await registry._buildFromDescriptor(descriptor);
    expect(group.children[0]).toBe(scene);
    expect(loader.loadAsync).not.toHaveBeenCalled();
    expect(loader.parseAsync).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(dispose).not.toHaveBeenCalled();
  });
});
