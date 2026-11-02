/*
 * GQTextureManager
 * Zentraler Einstieg fuer planetare/prozedurale Texturen inkl. LRU-Cache.
 */
(function (root) {
  'use strict';

  const Descriptor = typeof module !== 'undefined' && module.exports
    ? require('../engine/assets/WorldAssetDescriptor.js') : null;
  const Generator = typeof module !== 'undefined' && module.exports
    ? require('../engine/assets/CoherentMaterialGenerator.js') : null;
  const bounded = (value, fallback, min, max) => Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;

  class GQTextureManager {
    constructor(opts = {}) {
      this.THREE = opts.three || root.THREE;
      this.planetPipeline = root.GQPlanetTexturePipeline
        ? new root.GQPlanetTexturePipeline({
            size: Math.max(128, Number(opts.planetTextureSize || 256)),
            maxEntries: Math.max(24, Number(opts.planetMaxEntries || 128)),
            serverTexturesEnabled: opts.serverTexturesEnabled !== false,
            serverTextureEndpoint: String(opts.serverTextureEndpoint || 'api/textures.php'),
            serverTextureAlgoVersion: String(opts.serverTextureAlgoVersion || 'v1'),
          })
        : null;
      this.proceduralMaxEntries = Math.max(24, Number(opts.proceduralMaxEntries || 128));
      this.proceduralTextureCache = new Map();
      this.coherentMaxEntries = bounded(opts.coherentMaxEntries, 24, 1, 64);
      this.coherentTextureCache = new Map();
      this._coherentGeneration = 0;
    }

    async getCoherentMaterialBundleAsync(input = {}, options = {}) {
      const Engine = Generator || root.CoherentMaterialGenerator;
      const Contract = Descriptor || root.WorldAssetDescriptor;
      if (!Engine || !Contract) return null;
      const descriptor = Contract.normalize(input);
      const size = Engine.resolveSize(descriptor, options);
      const key = `${JSON.stringify(Contract.publicParameters(descriptor))}|${size}`;
      const entry = this.coherentTextureCache.get(key);
      const generation = this._coherentGeneration;
      const generated = await Engine.generateCached(descriptor, { ...options, size, fallback: entry?.generated });
      if (generation !== this._coherentGeneration) return null;
      const current = this.coherentTextureCache.get(key);
      if (current) {
        current.generated = generated;
        for (const [name, texture] of Object.entries(current.textures)) {
          texture.image.data = generated.maps[name].data;
          texture.needsUpdate = true;
        }
      }
      return this._createCoherentMaterialBundle(descriptor, { size }, generated);
    }

    /**
     * Maps are borrowed; the material is created lazily on first access and is
     * caller-owned. Factories retain maps without allocating an unused material.
     * Access material or retain maps before another request can evict the bundle.
     * Dispose accessed materials to release their references.
     */
    getCoherentMaterialBundle(input = {}, options = {}) {
      return this._createCoherentMaterialBundle(input, options);
    }

    _createCoherentMaterialBundle(input, options, prepared = null) {
      const Contract = Descriptor || root.WorldAssetDescriptor;
      const Engine = Generator || root.CoherentMaterialGenerator;
      const THREE = this.THREE;
      if (!Contract || !Engine || !THREE?.DataTexture || !THREE?.MeshStandardMaterial) return null;
      const descriptor = Contract.normalize(input);
      const size = Engine.resolveSize(descriptor, options);
      const key = `${JSON.stringify(Contract.publicParameters(descriptor))}|${size}`;
      let entry = this.coherentTextureCache.get(key);
      if (!entry) {
        const generated = prepared || Engine.generate(descriptor, { size });
        const textures = {};
        for (const [name, map] of Object.entries(generated.maps)) {
          const texture = new THREE.DataTexture(map.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
          texture.colorSpace = map.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.needsUpdate = true;
          texture.userData = Object.assign({}, texture.userData, { sharedTexture: true, assetId: descriptor.id });
          textures[name] = texture;
        }
        entry = { generated, textures, references: 0, cached: true, disposed: false };
      }
      this.coherentTextureCache.delete(key);
      this.coherentTextureCache.set(key, entry);
      const textures = entry.textures;
      const slots = { map: textures.albedo, normalMap: textures.normal, roughnessMap: textures.roughness,
        metalnessMap: textures.metalness, emissiveMap: textures.emissive };
      const coherentMaterial = { ...entry.generated.material, emissiveIntensity: Engine.emissiveIntensity(descriptor) };
      let material = null;
      const getMaterial = () => {
        if (material) return material;
        if (entry.disposed) throw new Error('Cannot create a material from an evicted coherent texture bundle');
        material = new THREE.MeshStandardMaterial({
          ...coherentMaterial, ...slots, color: 0xffffff, emissive: 0xffffff,
        });
        material.userData = Object.assign({}, material.userData, { sharedTexture: true, assetId: descriptor.id });
        entry.references++;
        const release = () => {
          material.removeEventListener('dispose', release);
          entry.references--;
          this._releaseCoherentEntry(entry);
        };
        material.addEventListener('dispose', release);
        return material;
      };
      while (this.coherentTextureCache.size > this.coherentMaxEntries) {
        const oldestKey = this.coherentTextureCache.keys().next().value;
        const oldest = this.coherentTextureCache.get(oldestKey);
        this.coherentTextureCache.delete(oldestKey);
        oldest.cached = false;
        this._releaseCoherentEntry(oldest);
      }
      return { descriptor, get material() { return getMaterial(); },
        maps: entry.generated.maps, textures,
        ...slots, coherentMaterial,
        retainTextures: () => {
          if (entry.disposed) throw new Error('Cannot retain a disposed coherent texture bundle');
          entry.references++;
          let released = false;
          return () => {
            if (released) return;
            released = true;
            entry.references--;
            this._releaseCoherentEntry(entry);
          };
        } };
    }

    _releaseCoherentEntry(entry) {
      if (!entry.cached && entry.references === 0 && !entry.disposed) {
        entry.disposed = true;
        Object.values(entry.textures).forEach(texture => texture.dispose());
      }
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
      if (descriptor?.materialFamily) {
        const coherent = this.getCoherentMaterialBundle(descriptor);
        if (coherent) return coherent.material;
      }
      const bundle = this.getObjectTextureBundle(objectType, descriptor, fallbackColor);
      if (!bundle) return null;
      const material = new this.THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: bundle.map,
        bumpMap: bundle.normalMap ? null : bundle.bumpMap,
        bumpScale: bundle.normalMap ? 0 : Math.max(0.01, Math.min(0.16, Number(descriptor?.variant === 'gas' ? 0.02 : 0.075))),
        normalMap: bundle.normalMap || null,
        normalScale: new this.THREE.Vector2(0.5, 0.5),
        roughnessMap: bundle.roughnessMap || null,
        metalnessMap: bundle.metalnessMap || null,
        aoMap: bundle.aoMap || null,
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`High-res request failed: ${response.status}`);
        const data = await response.json();
        if (!data.success || data.phase !== 'high_res_ready' ||
            typeof data.high_res?.path !== 'string' || !data.high_res.path) {
          throw new Error(data.error || 'Invalid high-res texture response');
        }
        const texture = await new this.THREE.TextureLoader().loadAsync(data.high_res.path);
        texture.colorSpace = this.THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        // Dispatch event for UI to swap texture
        window.dispatchEvent(new CustomEvent('GQ:textureUpgrade', {
          detail: { url, texture }
        }));
      } catch (err) {
        console.warn('[Progressive] High-res load failed:', err.message);
      } finally {
        clearTimeout(timeoutId);
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
      this._coherentGeneration++;
      for (const entry of this.coherentTextureCache.values()) {
        entry.cached = false;
        this._releaseCoherentEntry(entry);
      }
      this.coherentTextureCache.clear();
      this.planetPipeline?.dispose?.();
      for (const texture of this.proceduralTextureCache.values()) {
        texture?.dispose?.();
      }
      this.proceduralTextureCache.clear();
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = GQTextureManager;
  root.GQTextureManager = GQTextureManager;
})(typeof window !== 'undefined' ? window : globalThis);
