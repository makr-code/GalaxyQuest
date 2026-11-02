import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AssetBinaryCache } from '../../js/engine/assets/AssetBinaryCache.js';

const descriptor = (seed = 0, parameters = {}) => ({
  scope: 'public', version: 'v1', generatorHash: 'generator-v1', kind: 'geometry',
  seed, parameters, lod: 0,
});
const bytes = (...values) => new Uint8Array(values).buffer;
const memoryCache = (options = {}) => new AssetBinaryCache({
  indexedDB: null, crypto: webcrypto, maxBytes: 8, ...options,
});

describe('public binary asset cache', () => {
  it('normalizes parameter order and separates all generation identity fields', () => {
    const cache = memoryCache();
    const base = descriptor(0, { z: 2, a: { b: 1, a: 2 } });
    expect(cache.key(base)).toBe(cache.key(descriptor(0, { a: { a: 2, b: 1 }, z: 2 })));
    for (const [field, value] of Object.entries({
      version: 'v2', seed: 1, lod: 1, generatorHash: 'generator-v2', kind: 'texture',
    })) expect(cache.key({ ...base, [field]: value })).not.toBe(cache.key(base));
    expect(memoryCache({ version: 2 }).key(base)).not.toBe(cache.key(base));
    expect(() => cache.key({ ...base, scope: 'private' })).toThrow('public');
    expect(() => cache.key(descriptor(0, { invalid: NaN }))).toThrow('finite JSON');
  });

  it('copies borrowed buffers on insertion and retrieval and verifies SHA-256', async () => {
    const cache = memoryCache();
    const source = bytes(1, 2, 3);
    await cache.put(descriptor(), source);
    new Uint8Array(source)[0] = 9;
    const first = await cache.get(descriptor());
    expect([...new Uint8Array(first)]).toEqual([1, 2, 3]);
    new Uint8Array(first)[0] = 8;
    expect([...new Uint8Array(await cache.get(descriptor()))]).toEqual([1, 2, 3]);
    expect(cache._memory.values().next().value.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refetches corrupt bytes and never returns stale data across versions', async () => {
    const cache = memoryCache();
    await cache.put(descriptor(), bytes(1, 2));
    new Uint8Array(cache._memory.get(cache.key(descriptor())).bytes)[0] = 5;
    const load = vi.fn(async () => bytes(3, 4));
    expect([...new Uint8Array(await cache.getOrLoad(descriptor(), load))]).toEqual([3, 4]);
    expect(load).toHaveBeenCalledOnce();
    expect(await cache.get({ ...descriptor(), version: 'v2' })).toBeNull();
  });

  it('bounds memory by bytes with access-order LRU, including same-clock accesses', async () => {
    const cache = memoryCache({ maxBytes: 4 });
    await cache.put(descriptor(1), bytes(1, 1));
    await cache.put(descriptor(2), bytes(2, 2));
    await cache.get(descriptor(1));
    await cache.put(descriptor(3), bytes(3, 3));
    expect(await cache.get(descriptor(2))).toBeNull();
    expect(await cache.get(descriptor(1))).not.toBeNull();
    expect(cache._bytes).toBe(4);
    expect(await cache.put(descriptor(4), bytes(1, 2, 3, 4, 5))).toBe(false);
    cache.close();
    expect(cache._bytes).toBe(0);
  });

  it('deduplicates in-flight loads without sharing mutable result buffers', async () => {
    const cache = memoryCache();
    const load = vi.fn(async () => bytes(1, 2));
    const [a, b] = await Promise.all([
      cache.getOrLoad(descriptor(), load), cache.getOrLoad(descriptor(), load),
    ]);
    expect(load).toHaveBeenCalledOnce();
    expect(a).not.toBe(b);
  });

  it.each(['throw', 'error', 'blocked', 'timeout'])('falls back to memory when IndexedDB open %s', async (failure) => {
    const indexedDB = { open: vi.fn(() => {
      if (failure === 'throw') throw new Error('denied');
      const request = {};
      if (failure !== 'timeout') queueMicrotask(() => request[`on${failure}`]?.());
      return request;
    }) };
    const cache = memoryCache({ indexedDB, timeoutMs: 5 });
    await cache.put(descriptor(), bytes(1));
    expect([...new Uint8Array(await cache.get(descriptor()))]).toEqual([1]);
    expect(indexedDB.open).toHaveBeenCalledOnce();
  });

  it('returns network bytes without caching when integrity support is unavailable', async () => {
    const cache = memoryCache({ crypto: {} });
    const load = vi.fn(async () => bytes(7));
    await cache.getOrLoad(descriptor(), load);
    await cache.getOrLoad(descriptor(), load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache._bytes).toBe(0);
  });

  it('settles quota/aborted transactions and keeps the verified memory fallback', async () => {
    const close = vi.fn();
    const indexedDB = { open: () => {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close,
          transaction: () => {
            const transaction = {
              objectStore: () => ({ getAll: () => ({}) }),
            };
            queueMicrotask(() => transaction.onabort({ target: { error: { name: 'QuotaExceededError' } } }));
            return transaction;
          },
        };
        request.onsuccess();
      });
      return request;
    } };
    const cache = memoryCache({ indexedDB });
    expect(await cache.put(descriptor(), bytes(4))).toBe(true);
    expect([...new Uint8Array(await cache.get(descriptor()))]).toEqual([4]);
    expect(close).toHaveBeenCalledOnce();
  });
});
