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
    registry.configureAssetLoaders({ gltfLoader: loader });
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

  it('rejects external GLB resources before parsing or persistence', async () => {
    fetch.mockResolvedValue({
      ok: true, arrayBuffer: async () => glb({
        asset: { version: '2.0' }, buffers: [{ uri: '/api/private-buffer' }],
      }),
    });
    await expect(registry._buildFromDescriptor({ model_url: '/assets/models/hull.glb?v=1' }))
      .rejects.toThrow('embedded resources');
    expect(loader.parseAsync).not.toHaveBeenCalled();
    expect(cache._memory.size).toBe(0);
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
});
