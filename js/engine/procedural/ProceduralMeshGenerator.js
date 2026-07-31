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
  constructor() {
    this._noiseCache = new Map();
    this._meshCache = new Map();
    this._maxCacheSize = 1000;
  }

  /**
   * Generate a procedural asteroid mesh
   * @param {MeshConfig} config
   * @returns {THREE.BufferGeometry}
   */
  generateAsteroid(config = {}) {
    const seed = config.seed ?? Math.random();
    const scale = config.scale ?? 100;
    const complexity = Math.max(1, Math.min(5, config.complexity ?? 2));
    const fracture = config.fracture ?? true;

    // Check cache first
    const cacheKey = `asteroid_${seed}_${scale}_${complexity}_${fracture}`;
    if (this._meshCache.has(cacheKey)) {
      return this._meshCache.get(cacheKey).clone();
    }

    // Generate base icosahedron
    const geometry = this._createIcosphere(4 - complexity); // More subdivisions for higher complexity

    // Apply Perlin noise displacement
    this._displaceMesh(geometry, seed, scale, complexity);

    // Apply fracture patterns if requested
    if (fracture) {
      this._applyFractureMask(geometry, seed);
    }

    // Optimize mesh
    geometry.computeVertexNormals();
    geometry.mergeVertices?.();

    // Cache if space available
    if (this._meshCache.size < this._maxCacheSize) {
      this._meshCache.set(cacheKey, geometry.clone());
    }

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
    const count = config.count ?? 10;
    const scale = config.scale ?? 50;
    const seed = config.seed ?? Math.random();

    const debris = [];
    for (let i = 0; i < count; i++) {
      const fragmentSeed = seed + i / count;
      const fragmentScale = scale * (0.5 + Math.random() * 0.5);

      const geometry = this.generateAsteroid({
        seed: fragmentSeed,
        scale: fragmentScale,
        complexity: 1 + Math.floor(Math.random() * 2),
        fracture: Math.random() > 0.5,
      });

      debris.push({
        geometry,
        position: {
          x: (Math.random() - 0.5) * scale * 3,
          y: (Math.random() - 0.5) * scale * 3,
          z: (Math.random() - 0.5) * scale * 3,
        },
        rotation: {
          x: Math.random() * Math.PI * 2,
          y: Math.random() * Math.PI * 2,
          z: Math.random() * Math.PI * 2,
        },
      });
    }

    return debris;
  }

  /**
   * Create base icosphere
   * @private
   * @param {number} subdivisions - Recursion level
   * @returns {THREE.BufferGeometry}
   */
  _createIcosphere(subdivisions = 2) {
    if (typeof THREE === 'undefined') {
      // Fallback for non-Three.js environment
      return { vertices: [], indices: [] };
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
    const amplitude = scale * 0.3;
    const frequency = 1.0 + complexity * 0.5;

    for (let i = 0; i < posArray.length; i += 3) {
      const x = posArray[i];
      const y = posArray[i + 1];
      const z = posArray[i + 2];

      // Use 3D Perlin-like noise
      const noise = this._perlinNoise3D(x * frequency, y * frequency, z * frequency, seed);

      // Displace along normal (simplified - assumes unit sphere)
      const length = Math.sqrt(x * x + y * y + z * z);
      const factor = 1.0 + noise * amplitude / length;

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
      return Math.sin(h) * 43758.5453;
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
    this._meshCache.clear();
    this._noiseCache.clear();
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
