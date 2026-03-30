/**
 * AssetRegistry.js
 *
 * Central asset cache with type-aware loading.
 *
 * Delegates to the engine loaders (TextureLoader, GeometryLoader,
 * ShaderLoader) but wraps them in a unified API with:
 *   - Promise deduplication (a URL is only loaded once)
 *   - Preload queue + progress events
 *   - Asset disposal tracking
 *
 * Usage:
 *   const assets = new AssetRegistry(renderer);
 *
 *   // Queue assets for preloading
 *   assets.add('tex:planet',  'texture',  'gfx/planet.png');
 *   assets.add('geo:sphere',  'geometry', 'models/sphere.json');
 *   assets.add('sh:bloom',    'shader',   'js/engine/post-effects/shaders/bloom.wgsl');
 *   await assets.loadAll(onProgress);
 *
 *   // Retrieve later
 *   const tex = assets.get('tex:planet');
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Supported asset types */
const AssetType = Object.freeze({
  TEXTURE:  'texture',
  GEOMETRY: 'geometry',
  SHADER:   'shader',
  JSON:     'json',
  RAW:      'raw',
});

class AssetRegistry {
  /**
   * @param {import('./core/GraphicsContext').IGraphicsRenderer} renderer
   */
  constructor(renderer) {
    this._renderer = renderer;
    /** @type {Map<string, { type: string, url: string, promise: Promise|null, asset: any, error: Error|null }>} */
    this._assets   = new Map();
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register an asset for later loading.  Calling add() does NOT trigger a
   * network request — use load() or loadAll() for that.
   *
   * @param {string} key    Unique identifier (e.g. 'tex:earth', 'geo:star')
   * @param {string} type   One of AssetType.*
   * @param {string} url    URL / path to the resource
   */
  add(key, type, url) {
    if (this._assets.has(key)) return this; // idempotent
    this._assets.set(key, { type, url, promise: null, asset: null, error: null });
    return this;
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Load a single asset by key.  Returns the cached promise on repeated calls.
   * @param {string} key
   * @returns {Promise<*>}
   */
  load(key) {
    const entry = this._assets.get(key);
    if (!entry) return Promise.reject(new Error(`[AssetRegistry] Unknown asset key: '${key}'`));
    if (entry.promise) return entry.promise;

    entry.promise = this._loadEntry(entry)
      .then((asset) => { entry.asset = asset; return asset; })
      .catch((err)  => { entry.error = err; throw err; });

    return entry.promise;
  }

  /**
   * Load all registered assets and track progress.
   *
   * @param {Function} [onProgress]  (loaded, total) => void
   * @returns {Promise<void>}
   */
  async loadAll(onProgress) {
    const keys  = [...this._assets.keys()];
    const total  = keys.length;
    let loaded   = 0;

    await Promise.allSettled(keys.map(async (key) => {
      try {
        await this.load(key);
      } finally {
        loaded++;
        if (typeof onProgress === 'function') onProgress(loaded, total);
      }
    }));
  }

  // ---------------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Get a loaded asset synchronously.
   * @param {string} key
   * @returns {*}  The asset, or undefined if not yet loaded
   */
  get(key) {
    return this._assets.get(key)?.asset ?? undefined;
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  isLoaded(key) {
    const e = this._assets.get(key);
    return !!(e && e.asset !== null && e.error === null);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  hasFailed(key) {
    return !!(this._assets.get(key)?.error);
  }

  // ---------------------------------------------------------------------------
  // Summary / Dispose
  // ---------------------------------------------------------------------------

  /** Summary of all registered assets. */
  status() {
    const result = {};
    for (const [key, e] of this._assets) {
      result[key] = e.error ? 'error' : e.asset ? 'loaded' : e.promise ? 'loading' : 'pending';
    }
    return result;
  }

  /** Total number of registered assets. */
  get size() { return this._assets.size; }

  /** Remove an asset from the registry (does not destroy GPU resources). */
  remove(key) {
    this._assets.delete(key);
    return this;
  }

  /** Clear everything. */
  clear() {
    this._assets.clear();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Internal dispatcher
  // ---------------------------------------------------------------------------

  async _loadEntry(entry) {
    const { type, url } = entry;

    switch (type) {
      case AssetType.TEXTURE: {
        // Delegate to TextureLoader if renderer exposes createTexture
        const resp = await fetch(url);
        const blob = await resp.blob();
        const bmp  = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        const tex  = this._renderer.createTexture({ width: bmp.width, height: bmp.height, mipMaps: true });
        if (typeof tex.uploadImage === 'function') tex.uploadImage(bmp);
        return tex;
      }

      case AssetType.GEOMETRY: {
        const resp = await fetch(url);
        return await resp.json();
      }

      case AssetType.SHADER: {
        const resp = await fetch(url);
        return await resp.text();
      }

      case AssetType.JSON: {
        const resp = await fetch(url);
        return await resp.json();
      }

      case AssetType.RAW: {
        const resp = await fetch(url);
        return await resp.arrayBuffer();
      }

      default:
        throw new Error(`[AssetRegistry] Unknown asset type: '${type}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AssetRegistry, AssetType };
} else {
  window.GQAssetRegistry = { AssetRegistry, AssetType };
}
