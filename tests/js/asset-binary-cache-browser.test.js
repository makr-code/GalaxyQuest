// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const executablePath = [process.env.GQ_CHROMIUM_PATH, '/usr/bin/chromium', chromium.executablePath()]
  .find((path) => path && existsSync(path));
const artifacts = resolve(`.idb-${process.pid}`);
const browserHookTimeout = 30_000;
let browser;
let originalTemp;

describe.skipIf(!executablePath)('native browser IndexedDB public asset cache', () => {
  beforeAll(async () => {
    await mkdir(artifacts, { recursive: true });
    originalTemp = process.env.TMPDIR;
    process.env.TMPDIR = artifacts;
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  }, browserHookTimeout);
  afterAll(async () => {
    await browser?.close();
    if (originalTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTemp;
    await rm(artifacts, { recursive: true, force: true });
  }, browserHookTimeout);

  async function run(check) {
    const source = await readFile('js/engine/assets/AssetBinaryCache.js', 'utf8');
    const context = await browser.newContext();
    try {
      await context.route('http://127.0.0.1:8137/**', (route) => route.fulfill({
        contentType: route.request().url().endsWith('/cache.js') ? 'text/javascript' : 'text/html',
        body: route.request().url().endsWith('/cache.js') ? source
          : '<!doctype html><title>Asset cache</title><script type="module">import {AssetBinaryCache} from "/cache.js"; window.AssetBinaryCache = AssetBinaryCache;</script>',
      }));
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:8137/');
      await page.waitForFunction(() => window.AssetBinaryCache);
      return await check(page);
    } finally { await context.close(); }
  }

  it('survives an actual page reload with byte-bound persistent LRU and schema invalidation', async () => {
    await run(async (page) => {
      await page.evaluate(async () => {
        const { AssetBinaryCache } = window;
        const cache = new AssetBinaryCache({ name: 'reload', maxBytes: 4 });
        const d = (seed) => ({ scope: 'public', version: 1, seed, lod: 0, generatorHash: 'test' });
        await cache.put(d(1), new Uint8Array([1, 1]).buffer);
        await cache.put(d(2), new Uint8Array([2, 2]).buffer);
        await cache.get(d(1));
        await cache.put(d(3), new Uint8Array([3, 3]).buffer);
        cache.close();
      });
      await page.reload();
      await page.waitForFunction(() => window.AssetBinaryCache);
      const result = await page.evaluate(async () => {
        const { AssetBinaryCache } = window;
        const cache = new AssetBinaryCache({ name: 'reload', maxBytes: 4 });
        const d = (seed) => ({ scope: 'public', version: 1, seed, lod: 0, generatorHash: 'test' });
        const restored = await cache.get(d(1));
        const evicted = await cache.get(d(2));
        const rows = await cache._transaction('readonly', (store, result) => {
          store.getAll().onsuccess = (event) => result(event.target.result);
        });
        cache.close();
        const upgraded = new AssetBinaryCache({ name: 'reload', version: 2, maxBytes: 4 });
        const invalidated = await upgraded.get(d(1));
        upgraded.close();
        return {
          restored: [...new Uint8Array(restored)], evicted, invalidated,
          bytes: rows.reduce((sum, row) => sum + row.size, 0), count: rows.length,
        };
      });
      expect(result).toEqual({ restored: [1, 1], evicted: null, invalidated: null, bytes: 4, count: 2 });
    });
  });

  it('detects corrupted persisted bytes and reloads them exactly once', async () => {
    const result = await run((page) => page.evaluate(async () => {
      const { AssetBinaryCache } = window;
      const d = { scope: 'public', version: 1, seed: 0, lod: 0, generatorHash: 'test' };
      const cache = new AssetBinaryCache({ name: 'integrity' });
      await cache.put(d, new Uint8Array([1, 2]).buffer);
      await cache._transaction('readwrite', (store) => {
        store.get(cache.key(d)).onsuccess = (event) => {
          const record = event.target.result;
          new Uint8Array(record.bytes)[0] = 99;
          store.put(record);
        };
      });

      cache.close();
      const fresh = new AssetBinaryCache({ name: 'integrity' });
      let loads = 0;
      const value = await fresh.getOrLoad(d, async () => {
        loads++;
        return new Uint8Array([7, 7]).buffer;
      });
      fresh.close();
      return { value: [...new Uint8Array(value)], loads };
    }));
    expect(result).toEqual({ value: [7, 7], loads: 1 });
  });

  it('reserves incoming bytes even when another tab has a newer access clock', async () => {
    const result = await run((page) => page.evaluate(async () => {
      const { AssetBinaryCache } = window;
      const cache = new AssetBinaryCache({ name: 'clock-skew', maxBytes: 4 });
      const d = (seed) => ({ scope: 'public', version: 1, seed, lod: 0, generatorHash: 'test' });
      await cache.put(d(1), new Uint8Array([1, 1, 1, 1]).buffer);
      await cache._transaction('readwrite', (store) => {
        store.get(cache.key(d(1))).onsuccess = (event) => {
          store.put({ ...event.target.result, accessed: Date.now() + 1000000000 });
        };
      });
      await cache.put(d(2), new Uint8Array([2, 2, 2, 2]).buffer);
      const rows = await cache._transaction('readonly', (store, result) => {
        store.getAll().onsuccess = (event) => result(event.target.result);
      });
      const incomingKey = cache.key(d(2));
      cache.close();
      return {
        bytes: rows.reduce((sum, row) => sum + row.size, 0), count: rows.length,
        incomingRetained: rows.some((row) => row.key === incomingKey),
      };
    }));
    expect(result).toEqual({ bytes: 4, count: 1, incomingRetained: true });
  });

  it('deletes malformed stored records instead of throwing in the pruning callback', async () => {
    const result = await run((page) => page.evaluate(async () => {
      const { AssetBinaryCache } = window;
      const cache = new AssetBinaryCache({ name: 'malformed', maxBytes: 4 });
      await cache._transaction('readwrite', (store) => {
        store.put({ key: 42, size: -1 });
        store.put({ key: 'bad-metadata', size: NaN, accessed: null });
      });
      const d = { scope: 'public', version: 1, seed: 0, lod: 0, generatorHash: 'test' };
      await cache.put(d, new Uint8Array([1]).buffer);
      const rows = await cache._transaction('readonly', (store, result) => {
        store.getAll().onsuccess = (event) => result(event.target.result);
      });
      const value = await cache.get(d);
      cache.close();
      return { count: rows.length, bytes: [...new Uint8Array(value)] };
    }));
    expect(result).toEqual({ count: 1, bytes: [1] });
  });

  it('aborts quota-failed writes atomically while retaining the verified memory fallback', async () => {
    const result = await run((page) => page.evaluate(async () => {
      const { AssetBinaryCache } = window;
      const cache = new AssetBinaryCache({ name: 'quota', maxBytes: 4 });
      const d = (seed) => ({ scope: 'public', version: 1, seed, lod: 0, generatorHash: 'test' });
      await cache.put(d(1), new Uint8Array([1, 1]).buffer);
      await cache.put(d(2), new Uint8Array([2, 2]).buffer);
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Full', 'QuotaExceededError'); };
      try { await cache.put(d(3), new Uint8Array([3, 3]).buffer); }
      finally { IDBObjectStore.prototype.put = original; }
      const fallback = await cache.get(d(3));
      cache.close();
      const fresh = new AssetBinaryCache({ name: 'quota', maxBytes: 4 });
      const first = await fresh.get(d(1));
      const second = await fresh.get(d(2));
      const third = await fresh.get(d(3));
      fresh.close();
      return { fallback: [...new Uint8Array(fallback)], first: !!first, second: !!second, third };
    }));
    expect(result).toEqual({ fallback: [3, 3], first: true, second: true, third: null });
  });

  it('aborts queued writes if transaction setup throws', async () => {
    const result = await run((page) => page.evaluate(async () => {
      const { AssetBinaryCache } = window;
      const cache = new AssetBinaryCache({ name: 'abort' });
      await cache._transaction('readwrite', (store) => {
        store.put({ key: 'must-not-commit' });
        throw new Error('transaction setup failed');
      });
      cache.close();
      const fresh = new AssetBinaryCache({ name: 'abort' });
      const rows = await fresh._transaction('readonly', (store, result) => {
        store.getAll().onsuccess = (event) => result(event.target.result);
      });
      fresh.close();
      return rows.length;
    }));
    expect(result).toBe(0);
  });

  it('cancels a pending blocked upgrade on close without a late database resource', async () => {
    const result = await run((page) => page.evaluate(async () => {
      const { AssetBinaryCache } = window;
      const holder = await new Promise((resolve, reject) => {
        const request = indexedDB.open('blocked', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = reject;
      });
      holder.onversionchange = () => {};
      const pending = new AssetBinaryCache({ name: 'blocked', version: 2, timeoutMs: 200 });
      const opening = pending._open();
      pending.close();
      holder.close();
      await opening;
      // The late upgrade must abort, allowing a new opener to use schema 1.
      const version = await new Promise((resolve, reject) => {
        const request = indexedDB.open('blocked');
        request.onsuccess = () => { const database = request.result; resolve(database.version); database.close(); };
        request.onerror = reject;
      });
      return { version, closed: pending._database === null };
    }));
    expect(result).toEqual({ version: 1, closed: true });
  });
});
