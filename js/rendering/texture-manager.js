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

    /**
     * Request AI-generated texture from ComfyUI backend
     * Supports spaceship hulls, planet surfaces, atmospheric effects, and detail maps
     * Falls back to procedural generation if AI service unavailable
     */
    requestAITexture(descriptor = {}, options = {}) {
      const textureType = String(options.textureType || 'albedo').trim();
      const objectType = String(options.objectType || 'spaceship').toLowerCase();
      const size = Math.max(128, Math.min(1024, Number(options.size || 512)));
      
      // Build API URL based on object type
      let action = 'spaceship_texture';
      let params = {
        texture_type: textureType,
        size,
      };

      if (objectType === 'planet') {
        action = 'planet_texture';
        params.biome = String(descriptor.variant || 'rocky');
      } else if (objectType === 'atmosphere') {
        action = 'atmosphere_texture';
        params.style = String(descriptor.variant || 'earth_like');
      } else if (objectType === 'detail') {
        action = 'detail_texture';
        params.intensity = Number(descriptor.intensity || 0.5);
      } else {
        // Spaceship defaults
        params.faction = String(descriptor.faction || 'generic');
        params.condition = String(descriptor.condition || 'new');
        params.style = String(descriptor.style || 'scifi');
      }

      // Add seed for reproducibility
      if (descriptor.seed !== undefined) {
        params.seed = Number(descriptor.seed);
      }

      const url = new URL('api/textures-ai.php', window.location.href);
      url.searchParams.set('action', action);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      return fetch(url.href, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      })
        .then(response => {
          clearTimeout(timeoutId);
          if (!response.ok) throw new Error(`AI texture request failed: ${response.status}`);
          return response.json();
        })
        .then(data => {
          if (!data.success && data.fallback_required) {
            // Service error but fallback enabled - return null to use procedural
            console.warn('[AI Texture] Generation failed, using procedural fallback:', data.error);
            return null;
          }
          if (!data.success) {
            throw new Error(data.error || 'AI texture generation failed');
          }
          return data;
        })
        .catch(err => {
          clearTimeout(timeoutId);
          console.warn('[AI Texture] Request error:', err.message);
          // Return null to trigger fallback to procedural
          return null;
        });
    }

    /**
     * Request batch PBR texture set (all maps at once with visual consistency)
     * Includes Albedo, Normal, Specular, Roughness
     */
    async requestBatchPBRTextures(descriptor = {}, options = {}) {
      const faction = String(descriptor.faction || 'generic');
      const condition = String(descriptor.condition || 'new');
      const size = Math.max(128, Math.min(1024, Number(options.size || 512)));
      const useControlNet = options.useControlNet === true ? 1 : 0;

      const url = new URL('api/textures-ai.php', window.location.href);
      url.searchParams.set('action', 'batch_pbr');
      url.searchParams.set('faction', faction);
      url.searchParams.set('condition', condition);
      url.searchParams.set('size', size);
      url.searchParams.set('controlnet', useControlNet);

      if (descriptor.seed !== undefined) {
        url.searchParams.set('seed', Number(descriptor.seed));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

      try {
        const response = await fetch(url.href, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Batch PBR request failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
          console.warn('[Batch PBR] Generation failed:', data.error);
          return null;
        }

        // Convert paths to textures
        const texturePromises = {};
        for (const [mapType, mapData] of Object.entries(data.maps || {})) {
          if (mapData.success && mapData.path) {
            texturePromises[mapType] = new this.THREE.TextureLoader().loadAsync(mapData.path);
          }
        }

        const textures = {};
        for (const [mapType, promise] of Object.entries(texturePromises)) {
          try {
            textures[mapType] = await promise;
            textures[mapType].colorSpace = this.THREE.SRGBColorSpace;
            textures[mapType].needsUpdate = true;
          } catch (err) {
            console.warn(`[Batch PBR] Failed to load ${mapType}:`, err);
          }
        }

        return { success: true, textures, metadata: data };
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('[Batch PBR] Request error:', err.message);
        return null;
      }
    }

    /**
     * Progressive texture loading (low-res first for quick display, then high-res)
     * Improves perceived performance in loading scenarios
     */
    async requestProgressiveTexture(descriptor = {}, options = {}) {
      const textureType = String(options.textureType || 'albedo');
      const objectType = String(options.objectType || 'spaceship');
      const targetSize = Math.max(128, Math.min(1024, Number(options.size || 512)));
      const faction = String(descriptor.faction || 'generic');

      const url = new URL('api/textures-ai.php', window.location.href);
      url.searchParams.set('action', 'progressive');
      url.searchParams.set('texture_type', textureType);
      url.searchParams.set('object_type', objectType);
      url.searchParams.set('target_size', targetSize);
      url.searchParams.set('faction', faction);

      if (descriptor.seed !== undefined) {
        url.searchParams.set('seed', Number(descriptor.seed));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(url.href, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Progressive request failed: ${response.status}`);

        const data = await response.json();
        if (!data.success) {
          console.warn('[Progressive] Phase 1 failed:', data.error);
          return null;
        }

        // Load low-res immediately for UI
        const lowResTexture = data.low_res?.path 
          ? await new this.THREE.TextureLoader().loadAsync(data.low_res.path)
          : null;

        if (lowResTexture) {
          lowResTexture.colorSpace = this.THREE.SRGBColorSpace;
          lowResTexture.needsUpdate = true;
        }

        // Async load high-res in background
        if (data.high_res_url) {
          this._loadHighResProgressiveTextureAsync(data.high_res_url);
        }

        return { success: true, lowResTexture, highResUrl: data.high_res_url };
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('[Progressive] Request error:', err.message);
        return null;
      }
    }

    /**
     * Internal: Load high-res texture asynchronously
     */
    async _loadHighResProgressiveTextureAsync(url) {
      try {
        const texture = await new this.THREE.TextureLoader().loadAsync(url);
        texture.colorSpace = this.THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        // Dispatch event for UI to swap texture
        window.dispatchEvent(new CustomEvent('GQ:textureUpgrade', {
          detail: { url, texture }
        }));
      } catch (err) {
        console.warn('[Progressive] High-res load failed:', err.message);
      }
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
