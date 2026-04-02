/*
 * GQTextureManager
 * Zentraler Einstieg fuer planetare/prozedurale Texturen inkl. LRU-Cache.
 */
(function () {
  'use strict';

  class GQTextureManager {
    constructor(opts = {}) {
      this.THREE = opts.three || window.THREE;
      this.planetPipeline = window.GQPlanetTexturePipeline
        ? new window.GQPlanetTexturePipeline({
            size: Math.max(128, Number(opts.planetTextureSize || 256)),
            maxEntries: Math.max(24, Number(opts.planetMaxEntries || 128)),
            serverTexturesEnabled: opts.serverTexturesEnabled !== false,
            serverTextureEndpoint: String(opts.serverTextureEndpoint || 'api/textures.php'),
            serverTextureAlgoVersion: String(opts.serverTextureAlgoVersion || 'v1'),
          })
        : null;
      this.proceduralMaxEntries = Math.max(24, Number(opts.proceduralMaxEntries || 128));
      this.proceduralTextureCache = new Map();
    }

    getPlanetMaterial(body, descriptor, fallbackColor = 0x9aa7b8) {
      if (!this.planetPipeline || !descriptor) return null;
      return this.planetPipeline.getPlanetMaterial(body, descriptor, fallbackColor);
    }

    getAtmosphereConfig(descriptor) {
      if (!this.planetPipeline || !descriptor) return null;
      return this.planetPipeline.getAtmosphereConfig(descriptor);
    }

    getCloudLayerConfig(descriptor, fallbackColor = 0x9aa7b8) {
      if (!this.planetPipeline || !descriptor) return null;
      return this.planetPipeline.getCloudLayerConfig(descriptor, fallbackColor);
    }

    getProceduralTexture(key, size, drawFn) {
      const THREE = this.THREE;
      if (!THREE || typeof drawFn !== 'function') return null;

      const cacheKey = `${String(key || 'tex')}|${Math.max(8, Number(size || 64))}`;
      const hit = this.proceduralTextureCache.get(cacheKey);
      if (hit) {
        // LRU refresh
        this.proceduralTextureCache.delete(cacheKey);
        this.proceduralTextureCache.set(cacheKey, hit);
        return hit;
      }

      const texSize = Math.max(8, Number(size || 64));
      const canvas = document.createElement('canvas');
      canvas.width = texSize;
      canvas.height = texSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      drawFn(ctx, texSize);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      texture.userData = Object.assign({}, texture.userData, { sharedTexture: true });

      this.proceduralTextureCache.set(cacheKey, texture);
      this._evictProceduralIfNeeded();
      return texture;
    }

    _evictProceduralIfNeeded() {
      while (this.proceduralTextureCache.size > this.proceduralMaxEntries) {
        const firstKey = this.proceduralTextureCache.keys().next().value;
        const firstTexture = this.proceduralTextureCache.get(firstKey);
        firstTexture?.dispose?.();
        this.proceduralTextureCache.delete(firstKey);
      }
    }

    dispose() {
      this.planetPipeline?.dispose?.();
      for (const texture of this.proceduralTextureCache.values()) {
        texture?.dispose?.();
      }
      this.proceduralTextureCache.clear();
    }
  }

  window.GQTextureManager = GQTextureManager;
})();
