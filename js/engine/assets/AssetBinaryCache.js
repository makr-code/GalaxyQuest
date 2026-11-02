/**
 * Public, reproducible asset bytes only. Never pass API responses or player state.
 * IndexedDB is an optimization: all storage failures degrade to bounded memory.
 */
export class AssetBinaryCache {
  constructor({
    name = 'gq-public-assets', version = 1, maxBytes = 32 * 1024 * 1024,
    indexedDB, crypto = globalThis.crypto, timeoutMs = 1500,
  } = {}) {
    this.name = name;
    this.version = version;
    this.maxBytes = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 32 * 1024 * 1024;
    try { this._idb = indexedDB === undefined ? globalThis.indexedDB : indexedDB; }
    catch { this._idb = null; }
    this._crypto = crypto;
    this._timeoutMs = timeoutMs;
    this._memory = new Map();
    this._bytes = 0;
    this._pending = new Map();
    this._database = null;
    this._opening = null;
    this._disabled = false;
    this._clock = 0;
  }

  _now() {
    this._clock = Math.max(Date.now(), this._clock + 1);
    return this._clock;
  }

  key(descriptor) {
    if (descriptor?.scope !== 'public' || !descriptor.generatorHash
      || descriptor.version == null || descriptor.seed == null || descriptor.lod == null) {
      throw new TypeError('Only versioned public asset descriptors may be cached');
    }
    return JSON.stringify(normalize({
      schema: this.version, kind: descriptor.kind || 'binary',
      version: descriptor.version, seed: descriptor.seed,
      parameters: descriptor.parameters ?? {}, lod: descriptor.lod,
      generatorHash: descriptor.generatorHash,
    }));
  }

  async _digest(bytes) {
    const digest = await this._crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  _remember(record) {
    const old = this._memory.get(record.key);
    if (old) this._bytes -= old.bytes.byteLength;
    this._memory.delete(record.key);
    this._memory.set(record.key, record);
    this._bytes += record.bytes.byteLength;
    while (this._bytes > this.maxBytes && this._memory.size) {
      const key = this._memory.keys().next().value;
      this._bytes -= this._memory.get(key).bytes.byteLength;
      this._memory.delete(key);
    }
  }

  async _open() {
    if (this._disabled || !this._idb) return null;
    if (this._database) return this._database;
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve) => {
      let done = false;
      let request;
      const finish = (database) => {
        if (done) { database?.close(); return; }
        done = true;
        clearTimeout(timer);
        if (!database) this._disabled = true;
        this._database = database;
        resolve(database);
      };
      const timer = setTimeout(() => finish(null), this._timeoutMs);
      try {
        request = this._idb.open(this.name, this.version);
        request.onupgradeneeded = () => {
          if (done) {
            request.transaction?.abort();
            return;
          }
          const database = request.result;
          if (database.objectStoreNames.contains('assets')) database.deleteObjectStore('assets');
          database.createObjectStore('assets', { keyPath: 'key' });
        };
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            if (this._database === database) this._database = null;
          };
          finish(database);
        };
      } catch {
        finish(null);
      }
    });
    const database = await this._opening;
    this._opening = null;
    return database;
  }

  async _transaction(mode, action) {
    const database = await this._open();
    if (!database) return undefined;
    return new Promise((resolve) => {
      let transaction;
      let result;
      let done = false;
      const finish = (value, failed = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (failed) {
          this._disabled = true;
          database.close();
          this._database = null;
        }
        resolve(value);
      };
      const timer = setTimeout(() => {
        try { transaction?.abort(); } catch { /* Already completed. */ }
        finish(undefined, true);
      }, this._timeoutMs);
      try {
        transaction = database.transaction('assets', mode);
        transaction.oncomplete = () => finish(result);
        transaction.onerror = transaction.onabort = () => finish(undefined, true);
        action(transaction.objectStore('assets'), (value) => { result = value; });
      } catch {
        finish(undefined, true);
      }
    });
  }

  async get(descriptor) {
    const key = this.key(descriptor);
    let record = this._memory.get(key);
    if (!record) {
      record = await this._transaction('readonly', (store, result) => {
        store.get(key).onsuccess = (event) => result(event.target.result);
      });
    }
    if (!record) return null;
    try {
      if (record.key !== key || record.schema !== this.version
        || !(record.bytes instanceof ArrayBuffer) || !record.bytes.byteLength || record.bytes.byteLength > this.maxBytes
        || record.size !== record.bytes.byteLength
        || await this._digest(record.bytes) !== record.digest) {
        throw new Error('Invalid asset bytes');
      }
    } catch {
      await this.delete(descriptor);
      return null;
    }
    record = { ...record, accessed: this._now() };
    this._remember(record);
    await this._transaction('readwrite', (store) => {
      // Do not resurrect an entry evicted by another tab.
      store.get(key).onsuccess = (event) => {
        const current = event.target.result;
        if (current?.digest === record.digest) store.put({ ...current, accessed: record.accessed });
      };
    });
    return record.bytes.slice(0);
  }

  async put(descriptor, bytes) {
    const key = this.key(descriptor);
    if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > this.maxBytes) return false;
    const copy = bytes.slice(0);
    let digest;
    try { digest = await this._digest(copy); } catch { return false; }
    const record = {
      key, schema: this.version, bytes: copy, size: copy.byteLength, digest, accessed: this._now(),
    };
    this._remember(record);
    await this._transaction('readwrite', (store) => {
      store.getAll().onsuccess = (event) => {
        const records = event.target.result.filter((entry) => entry.key !== key);
        records.push(record);
        records.sort((a, b) => b.accessed - a.accessed || (a.key === key ? -1 : b.key === key ? 1 : a.key.localeCompare(b.key)));
        let total = 0;
        for (const entry of records) {
          if (!Number.isSafeInteger(entry.size) || entry.size < 0 || total + entry.size > this.maxBytes) {
            store.delete(entry.key);
          } else total += entry.size;
        }
        store.put(record);
      };
    });
    return true;
  }

  async delete(descriptor) {
    const key = this.key(descriptor);
    const record = this._memory.get(key);
    if (record) this._bytes -= record.bytes.byteLength;
    this._memory.delete(key);
    await this._transaction('readwrite', (store) => store.delete(key));
  }

  async getOrLoad(descriptor, load) {
    const key = this.key(descriptor);
    if (this._pending.has(key)) return (await this._pending.get(key)).slice(0);
    const pending = (async () => {
      const cached = await this.get(descriptor);
      if (cached) return cached;
      const bytes = await load();
      if (!(bytes instanceof ArrayBuffer)) throw new TypeError('Asset loader must return an ArrayBuffer');
      await this.put(descriptor, bytes);
      return bytes;
    })();
    this._pending.set(key, pending);
    try { return (await pending).slice(0); } finally { this._pending.delete(key); }
  }

  close() {
    this._database?.close();
    this._database = null;
    this._memory.clear();
    this._bytes = 0;
  }
}

function normalize(value, depth = 0) {
  if (depth > 20) throw new TypeError('Asset parameters exceed maximum nesting');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map((item) => normalize(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key], depth + 1)]));
  }
  throw new TypeError('Asset parameters must be finite JSON data');
}

export const publicAssetBinaryCache = new AssetBinaryCache();
