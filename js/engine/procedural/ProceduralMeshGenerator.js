/**
 * ProceduralMeshGenerator.js
 *
 * Procedural generation of 3D meshes for asteroids, debris, and space objects.
 * Uses noise functions and recursive subdivision to create natural-looking geometry.
 *
 * Algorithms:
 *   - Perlin/Simplex noise for base shape
 *   - Voronoi fracture for asteroid fractures
 *   - Recursive subdivision for detail
 *   - Mesh optimization (vertex deduplication, culling)
 *
 * Inspired by:
 *   - Unreal Engine: Procedural mesh generation
 *   - No Man's Sky: Procedural planet/asteroid generation
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * Procedural mesh configuration
 * @typedef {object} MeshConfig
 * @property {string} type - 'asteroid' | 'debris' | 'wreck' | 'asteroid_cluster'
 * @property {number} scale - Mesh size scale
 * @property {number} seed - Random seed for reproducibility
 * @property {number} complexity - Detail level (1-5)
 * @property {boolean} fracture - Apply fracture patterns
 */

class ProceduralMeshGenerator {
  constructor({ maxCacheBytes = 16 * 1024 * 1024, maxCacheSize = 128 } = {}) {
    this._noiseCache = new Map();
    this._meshCache = new Map();
    this._maxCacheSize = Number.isFinite(maxCacheSize) ? Math.max(0, Math.floor(maxCacheSize)) : 128;
    this._maxCacheBytes = Number.isFinite(maxCacheBytes) ? Math.max(0, Math.floor(maxCacheBytes)) : 16 * 1024 * 1024;
    this._cacheBytes = 0;
  }

  /**
   * Generate a procedural asteroid mesh
   * @param {MeshConfig} config
   * @returns {THREE.BufferGeometry}
   */
  generateAsteroid(config = {}) {
    const seed = this._seed(config.seed ?? 0);
    const scale = this._bounded(config.scale, 100, 0.001, 1000000);
    const lod = Math.floor(this._bounded(config.lod, 0, 0, 4));
    const complexity = Math.max(1, Math.floor(this._bounded(config.complexity, 2, 1, 5)) - lod);
    const fracture = Boolean(config.fracture ?? true);

    // Check cache first
    const cacheKey = `asteroid_${seed}_${scale}_${complexity}_${fracture}`;
    if (this._meshCache.has(cacheKey)) {
      const cached = this._meshCache.get(cacheKey);
      this._meshCache.delete(cacheKey);
      this._meshCache.set(cacheKey, cached);
      return cached.clone();
    }

    // Generate base icosahedron
    const geometry = this._createIcosphere(complexity - 1);

    // Apply Perlin noise displacement
    this._displaceMesh(geometry, seed, scale, complexity);

    // Apply fracture patterns if requested
    if (fracture) {
      this._applyFractureMask(geometry, seed);
    }

    // Optimize mesh
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Cache if space available
    const bytes = this._geometryBytes(geometry);
    if (this._maxCacheSize > 0 && bytes <= this._maxCacheBytes) {
      while (this._meshCache.size >= this._maxCacheSize || this._cacheBytes + bytes > this._maxCacheBytes) {
        const key = this._meshCache.keys().next().value;
        const cached = this._meshCache.get(key);
        this._cacheBytes -= this._geometryBytes(cached);
        cached.dispose();
        this._meshCache.delete(key);
      }
      this._meshCache.set(cacheKey, geometry.clone());
      this._cacheBytes += bytes;
    }

    return geometry;
  }

  /** Persist CPU arrays, not GPU buffers. Every call returns caller-owned geometry. */
  async generateAsteroidAsync(config = {}, binaryCache = null) {
    const parameters = {
      scale: this._bounded(config.scale, 100, 0.001, 1000000),
      complexity: Math.floor(this._bounded(config.complexity, 2, 1, 5)),
      fracture: Boolean(config.fracture ?? true),
    };
    const lod = Math.floor(this._bounded(config.lod, 0, 0, 4));
    const generate = () => this.generateAsteroid({ ...parameters, seed: config.seed ?? 0, lod });
    const descriptor = {
      scope: 'public', kind: 'asteroid-arrays', version: 2,
      generatorHash: 'gq-icosphere-value-noise-v3', seed: this._seed(config.seed ?? 0), parameters, lod,
    };
    let cache;
    let bytes;
    try {
      cache = binaryCache || (await import('../assets/AssetBinaryCache.js')).publicAssetBinaryCache;
      bytes = await cache.get(descriptor);
    } catch {
      return generate();
    }
    if (bytes) {
      let geometry;
      try {
        const view = new DataView(bytes);
        const count = view.getUint32(0, true);
        const hasColors = view.getUint32(4, true);
        const hasUv = view.getUint32(8, true);
        const format = view.getUint32(12, true);
        if (!count || count > 1800 || count % 3 || hasColors > 1 || hasUv > 1 || format !== 2
          || bytes.byteLength !== 16 + count * 4 * (6 + hasColors * 3 + hasUv * 2)) {
          throw new Error('Invalid procedural geometry arrays');
        }
        geometry = new THREE.BufferGeometry();
        const names = ['position', 'normal', ...(hasColors ? ['color'] : []), ...(hasUv ? ['uv'] : [])];
        let offset = 16;
        for (const name of names) {
          const itemSize = name === 'uv' ? 2 : 3;
          const length = count * itemSize * 4;
          const array = new Float32Array(bytes.slice(offset, offset + length));
          if (!array.every(Number.isFinite)) throw new Error('Nonfinite procedural geometry');
          geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
          offset += length;
        }
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
      } catch {
        geometry?.dispose();
        try { await cache.delete(descriptor); } catch { /* Optional storage is unavailable. */ }
      }
    }
    const geometry = generate();
    try {
      const hasColors = geometry.hasAttribute('color');
      const hasUv = geometry.hasAttribute('uv');
      const names = ['position', 'normal', ...(hasColors ? ['color'] : []), ...(hasUv ? ['uv'] : [])];
      const count = geometry.attributes.position.count;
      const buffer = new ArrayBuffer(16 + count * 4 * (6 + Number(hasColors) * 3 + Number(hasUv) * 2));
      const view = new DataView(buffer);
      view.setUint32(0, count, true);
      view.setUint32(4, Number(hasColors), true);
      view.setUint32(8, Number(hasUv), true);
      view.setUint32(12, 2, true);
      let offset = 16;
      for (const name of names) {
        const array = geometry.attributes[name].array;
        new Float32Array(buffer, offset, array.length).set(array);
        offset += array.byteLength;
      }
      await cache.put(descriptor, buffer);
    } catch { /* Return the owned generated geometry even if persistence fails. */ }
    return geometry;
  }

  /**
   * Generate debris field (multiple fragments)
   * @param {object} config
   * @param {number} config.count - Number of debris pieces
   * @param {number} config.scale - Fragment scale
   * @param {number} config.seed
   * @returns {object[]} Array of geometry objects with transforms
   */
  generateDebrisField(config = {}) {
    const count = Math.floor(this._bounded(config.count, 10, 0, 256));
    const scale = this._bounded(config.scale, 50, 0.001, 1000000);
    const seed = this._seed(config.seed ?? 0);
    const random = this._random(seed);

    const debris = [];
    for (let i = 0; i < count; i++) {
      const fragmentSeed = `${seed}:${i}`;
      const fragmentScale = scale * (0.5 + random() * 0.5);

      const geometry = this.generateAsteroid({
        seed: fragmentSeed,
        scale: fragmentScale,
        complexity: 1 + Math.floor(random() * 2),
        fracture: random() > 0.5,
      });

      debris.push({
        geometry,
        position: {
          x: (random() - 0.5) * scale * 3,
          y: (random() - 0.5) * scale * 3,
          z: (random() - 0.5) * scale * 3,
        },
        rotation: {
          x: random() * Math.PI * 2,
          y: random() * Math.PI * 2,
          z: random() * Math.PI * 2,
        },
      });
    }

    return debris;
  }

  /** Caller owns every returned geometry, including all prepared LOD levels. */
  generateAsteroidLODs(config = {}) {
    const scale = this._bounded(config.scale, 100, 0.001, 1000000);
    return [5, 3, 1].map((complexity, index) => ({
      distance: [0, scale * 8, scale * 24][index],
      geometry: this.generateAsteroid({ ...config, complexity, lod: 0 }),
    }));
  }

  generateWreck(config = {}) {
    const geometry = this.generateAsteroid({ ...config, fracture: true });
    const random = this._random(this._seed(config.seed ?? 0));
    geometry.scale(1.5 + random(), 0.2 + random() * 0.3, 0.5 + random() * 0.5);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  _bounded(value, fallback, min, max) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  _seed(value) {
    const text = String(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
  }

  _random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ state >>> 15, 1 | state);
      value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  _geometryBytes(geometry) {
    return Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
      + (geometry.index?.array.byteLength || 0);
  }

  /**
   * Create base icosphere
   * @private
   * @param {number} subdivisions - Recursion level
   * @returns {THREE.BufferGeometry}
   */
  _createIcosphere(subdivisions = 2) {
    if (typeof THREE === 'undefined') {
      throw new Error('ProceduralMeshGenerator requires THREE');
    }

    const geometry = new THREE.IcosahedronGeometry(1, subdivisions);
    return geometry;
  }

  /**
   * Displace mesh vertices using Perlin noise
   * @private
   * @param {THREE.BufferGeometry} geometry
   * @param {number} seed
   * @param {number} scale
   * @param {number} complexity
   */
  _displaceMesh(geometry, seed, scale, complexity) {
    const positions = geometry.getAttribute('position');
    if (!positions) return;

    const posArray = positions.array;
    const frequency = 1.0 + complexity * 0.5;

    for (let i = 0; i < posArray.length; i += 3) {
      const x = posArray[i];
      const y = posArray[i + 1];
      const z = posArray[i + 2];

      // Use 3D Perlin-like noise
      const noise = this._perlinNoise3D(x * frequency, y * frequency, z * frequency, seed);

      // Displace along normal (simplified - assumes unit sphere)
      const length = Math.sqrt(x * x + y * y + z * z);
      const factor = scale * (1.0 + noise * 0.3) / Math.max(length, 0.000001);

      posArray[i] = x * factor;
      posArray[i + 1] = y * factor;
      posArray[i + 2] = z * factor;
    }

    positions.needsUpdate = true;
  }

  /**
   * Apply fracture mask/coloring to geometry
   * @private
   * @param {THREE.BufferGeometry} geometry
   * @param {number} seed
   */
  _applyFractureMask(geometry, seed) {
    // This would add colors or materials indicating fracture lines
    // For now, this is a placeholder
    const colors = new Float32Array(geometry.getAttribute('position').array.length);

    for (let i = 0; i < colors.length; i += 3) {
      const noise = this._perlinNoise3D(i, seed * 100, seed * 200, 1.0);
      const brightness = 0.7 + noise * 0.3;
      colors[i] = brightness;
      colors[i + 1] = brightness * 0.9;
      colors[i + 2] = brightness * 0.8;
    }

    if (typeof THREE !== 'undefined') {
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
  }

  /**
   * Simple 3D Perlin-like noise function
   * (Simplified version - production would use a proper Perlin implementation)
   * @private
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} seed
   * @returns {number} Value in range [-1, 1]
   */
  _perlinNoise3D(x, y, z, seed) {
    // Hash function
    const hash = (px, py, pz) => {
      let h = seed;
      h ^= ((h << 5) + h) ^ px;
      h ^= ((h << 5) + h) ^ py;
      h ^= ((h << 5) + h) ^ pz;
      const value = Math.sin(h) * 43758.5453;
      return (value - Math.floor(value)) * 2 - 1;
    };

    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);

    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;

    // Smoothstep
    const u = xf * xf * (3.0 - 2.0 * xf);
    const v = yf * yf * (3.0 - 2.0 * yf);
    const w = zf * zf * (3.0 - 2.0 * zf);

    // Gradient values
    const n000 = hash(xi, yi, zi);
    const n100 = hash(xi + 1, yi, zi);
    const n010 = hash(xi, yi + 1, zi);
    const n110 = hash(xi + 1, yi + 1, zi);
    const n001 = hash(xi, yi, zi + 1);
    const n101 = hash(xi + 1, yi, zi + 1);
    const n011 = hash(xi, yi + 1, zi + 1);
    const n111 = hash(xi + 1, yi + 1, zi + 1);

    // Interpolate
    const nx00 = n000 * (1.0 - u) + n100 * u;
    const nx10 = n010 * (1.0 - u) + n110 * u;
    const nx0 = nx00 * (1.0 - v) + nx10 * v;

    const nx01 = n001 * (1.0 - u) + n101 * u;
    const nx11 = n011 * (1.0 - u) + n111 * u;
    const nx1 = nx01 * (1.0 - v) + nx11 * v;

    return (nx0 * (1.0 - w) + nx1 * w) % 1.0;
  }

  /**
   * Clear mesh cache
   */
  clearCache() {
    for (const geometry of this._meshCache.values()) geometry.dispose();
    this._meshCache.clear();
    this._noiseCache.clear();
    this._cacheBytes = 0;
  }

  dispose() {
    this.clearCache();
  }

  /**
   * Get cache stats
   * @returns {object}
   */
  getCacheStats() {
    return {
      meshCount: this._meshCache.size,
      noiseCount: this._noiseCache.size,
      maxSize: this._maxCacheSize,
      bytes: this._cacheBytes,
      maxBytes: this._maxCacheBytes,
    };
  }
}

// Export for both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProceduralMeshGenerator };
}
if (typeof window !== 'undefined') {
  window.GQProceduralMeshGenerator = { ProceduralMeshGenerator };
}
