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

    getObjectTextureBundle(objectType, descriptor, fallbackColor = 0x9aa7b8) {
      if (!this.planetPipeline || !descriptor) return null;
      return this.planetPipeline.getObjectTextureBundle(objectType, descriptor, fallbackColor);
    }

    getObjectMaterial(descriptor, fallbackColor = 0x9aa7b8, objectType = 'generic') {
      const bundle = this.getObjectTextureBundle(objectType, descriptor, fallbackColor);
      if (!bundle) return null;
      const material = new this.THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: bundle.map,
        bumpMap: bundle.bumpMap,
        bumpScale: Math.max(0.01, Math.min(0.16, Number(descriptor?.variant === 'gas' ? 0.02 : 0.075))),
        normalMap: bundle.normalMap || null,
        normalScale: new this.THREE.Vector2(0.5, 0.5),
        emissiveMap: bundle.emissiveMap,
        emissive: new this.THREE.Color(Number(descriptor?.variant === 'lava' ? 0xff7d4d : fallbackColor)),
        emissiveIntensity: Math.max(0, Math.min(0.9, Number(descriptor?.glow || 0) * 0.75 + 0.16)),
        roughness: Math.max(0.08, Math.min(0.98, Number(descriptor?.roughness ?? 0.62))),
        metalness: Math.max(0, Math.min(0.88, Number(descriptor?.metalness ?? 0.35))),
      });
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
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
