/**
 * SystemSpecialBodiesRenderer.js
 *
 * Mesh factories for non-spherical star-system bodies:
 *   - asteroid_belt   : torus-shaped particle ring around the star
 *   - nebula_cloud    : layered billboard cloud at a system position
 *   - irregular_planet: noise-displaced sphere (unförmiger Planet)
 *   - planet_fragment : cluster of rocky chunks (zerbrochener Planet)
 *
 * Each factory is a pure function:
 *   buildXxxMesh(THREE, params) → THREE.Group | THREE.Mesh
 *
 * The module also exports `SPECIAL_BODY_TYPES` and `buildSpecialBodyMesh`
 * as a dispatcher.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPECIAL_BODY_TYPES = Object.freeze({
  ASTEROID_BELT: 'asteroid_belt',
  NEBULA_CLOUD: 'nebula_cloud',
  IRREGULAR_PLANET: 'irregular_planet',
  PLANET_FRAGMENT: 'planet_fragment',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a number to [min, max].
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Parse a CSS/hex color string or numeric color to a Three.js hex integer.
 * Falls back to `fallback` when the input is invalid.
 * @param {*} raw
 * @param {number} fallback
 * @returns {number}
 */
function parseColorHex(raw, fallback = 0x9aa7b8) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/^#/, '');
    const parsed = parseInt(cleaned, 16);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * @param {number} seed
 * @returns {() => number} function returning floats in [0, 1)
 */
function makeRng(seed) {
  let s = (seed >>> 0) || 0xdeadbeef;
  return function () {
    s |= 0;
    s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Factory: Asteroid Belt
// ---------------------------------------------------------------------------

/**
 * Build a torus-shaped asteroid-belt render object.
 *
 * The belt is centred at the origin (star position) and lies in the XZ plane.
 * Callers should add it directly to `systemBodyGroup` (not to an orbit pivot).
 *
 * @param {object} THREE - Three.js namespace
 * @param {object} params
 * @param {number} [params.radius=120]          - Ring radius in scene units
 * @param {number} [params.tube=10]             - Half-width of the belt cross-section
 * @param {number} [params.height=4]            - Vertical spread of the belt
 * @param {number} [params.particleCount=600]   - Number of particle points
 * @param {number|string} [params.color=0x8f8173]
 * @param {number} [params.opacity=0.72]
 * @param {number} [params.seed=1]              - Randomisation seed
 * @returns {THREE.Group}
 */
function buildAsteroidBeltMesh(THREE, params = {}) {
  const radius = clamp(params.radius ?? 120, 10, 800);
  const tube = clamp(params.tube ?? 10, 1, radius * 0.4);
  const height = clamp(params.height ?? 4, 0.5, tube * 1.5);
  const particleCount = clamp(params.particleCount ?? 600, 50, 8000);
  const color = parseColorHex(params.color, 0x8f8173);
  const opacity = clamp(params.opacity ?? 0.72, 0.1, 1.0);
  const seed = params.seed ?? 1;

  const rng = makeRng(seed);

  // --- Particle positions scattered in a torus volume ---
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    // Angle around the ring
    const theta = rng() * Math.PI * 2;
    // Radial offset within tube (Gaussian-ish via sum of two uniforms)
    const rOffset = (rng() + rng() - 1.0) * tube;
    const px = (radius + rOffset) * Math.cos(theta);
    const pz = (radius + rOffset) * Math.sin(theta);
    const py = (rng() * 2 - 1) * height;
    positions[i * 3]     = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color,
    size: clamp(params.particleSize ?? 0.55, 0.1, 4.0),
    transparent: true,
    opacity,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind: 'asteroid-belt-particles' };

  // --- Torus wireframe for orientation reference ---
  const torusGeo = new THREE.TorusGeometry(radius, tube, 6, 64);
  const torusMat = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: opacity * 0.18,
    depthWrite: false,
  });
  const torusMesh = new THREE.Mesh(torusGeo, torusMat);
  torusMesh.rotation.x = Math.PI / 2; // Lie flat in XZ plane
  torusMesh.userData = { kind: 'asteroid-belt-torus' };

  const group = new THREE.Group();
  group.add(points);
  group.add(torusMesh);
  group.userData = {
    kind: 'asteroid_belt',
    color,
    beltRadius: radius,
    beltTube: tube,
    rotationSpeed: clamp(params.rotationSpeed ?? 0.018, 0, 0.5),
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Nebula Cloud
// ---------------------------------------------------------------------------

/**
 * Build a layered billboard cloud cluster.
 *
 * The cloud uses several overlapping billboard planes (facing camera in shader
 * is not available here, so we use multiple slightly-rotated flat planes that
 * together look volumetric from most angles).
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.scale=8]             - Overall cloud radius
 * @param {number|string} [params.color=0x7fc7d9]
 * @param {number} [params.opacity=0.32]
 * @param {number} [params.layerCount=6]        - Number of billboard layers
 * @param {number} [params.seed=2]
 * @returns {THREE.Group}
 */
function buildNebulaCloudMesh(THREE, params = {}) {
  const scale = clamp(params.scale ?? 8, 1, 80);
  const color = parseColorHex(params.color, 0x7fc7d9);
  const opacity = clamp(params.opacity ?? 0.32, 0.05, 0.9);
  const layerCount = clamp(Math.round(params.layerCount ?? 6), 2, 16);
  const seed = params.seed ?? 2;
  const rng = makeRng(seed);

  const group = new THREE.Group();
  group.userData = {
    kind: 'nebula_cloud',
    color,
    driftSpeed: clamp(params.driftSpeed ?? 0.008, 0, 0.1),
    pulseSpeed: clamp(params.pulseSpeed ?? 0.4, 0, 4),
    pulseAmplitude: clamp(params.pulseAmplitude ?? 0.06, 0, 0.3),
    _phase: rng() * Math.PI * 2,
  };

  for (let i = 0; i < layerCount; i++) {
    const layerScale = scale * (0.55 + rng() * 0.9);
    const geo = new THREE.PlaneGeometry(layerScale * 2, layerScale * 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opacity * (0.4 + rng() * 0.6),
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const plane = new THREE.Mesh(geo, mat);
    // Distribute layers in slightly random orientations
    plane.rotation.x = (rng() - 0.5) * Math.PI;
    plane.rotation.y = (rng() - 0.5) * Math.PI;
    plane.rotation.z = (rng() - 0.5) * Math.PI;
    plane.position.set(
      (rng() - 0.5) * scale * 0.5,
      (rng() - 0.5) * scale * 0.3,
      (rng() - 0.5) * scale * 0.5
    );
    plane.userData = { kind: 'nebula-cloud-layer', layerIndex: i };
    group.add(plane);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Factory: Irregular Planet
// ---------------------------------------------------------------------------

/**
 * Build an irregular (deformed) planet mesh.
 *
 * Displaces a SphereGeometry vertex-by-vertex using layered noise to create
 * a lumpy, non-spherical appearance.
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.radius=3]
 * @param {number} [params.deformation=0.38]  - Max vertex displacement as fraction of radius
 * @param {number|string} [params.color=0x8a7a6a]
 * @param {number} [params.seed=3]
 * @returns {THREE.Group}
 */
function buildIrregularPlanetMesh(THREE, params = {}) {
  const radius = clamp(params.radius ?? 3, 0.5, 30);
  const deformation = clamp(params.deformation ?? 0.38, 0.05, 0.85);
  const color = parseColorHex(params.color, 0x8a7a6a);
  const seed = params.seed ?? 3;
  const rng = makeRng(seed);

  // Use a higher-resolution sphere so displacement looks smooth
  const geo = new THREE.SphereGeometry(radius, 24, 18);
  const positions = geo.attributes.position;

  // Simple layered value-noise displacement
  const freqA = 2.5 + rng() * 1.5;
  const freqB = 5.0 + rng() * 3.0;
  const ampA  = radius * deformation * 0.65;
  const ampB  = radius * deformation * 0.35;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // Normalise to unit sphere direction
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    // Pseudo-noise via sine product (gives bumpy but coherent displacement)
    const noiseA = Math.sin(nx * freqA * Math.PI + seed * 0.31)
      * Math.cos(ny * freqA * Math.PI + seed * 0.17)
      * Math.sin(nz * freqA * Math.PI + seed * 0.53);
    const noiseB = Math.sin(nx * freqB * Math.PI + seed * 0.71)
      * Math.cos(ny * freqB * Math.PI + seed * 0.47)
      * Math.cos(nz * freqB * Math.PI + seed * 0.29);

    const displacement = ampA * noiseA + ampB * noiseB;
    const newR = Math.max(radius * 0.25, len + displacement);
    positions.setXYZ(i, nx * newR, ny * newR, nz * newR);
  }
  positions.needsUpdate = true;
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: clamp(params.roughness ?? 0.88, 0, 1),
    metalness: clamp(params.metalness ?? 0.06, 0, 1),
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = { kind: 'irregular_planet', color, radius };

  const group = new THREE.Group();
  group.add(mesh);
  group.userData = { kind: 'irregular_planet', renderMesh: mesh };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Planet Fragment
// ---------------------------------------------------------------------------

/**
 * Build a planet-fragment cluster (broken planet / Trümmerwelt).
 *
 * Creates several rocky chunks with randomised sizes and orientations scattered
 * within a loose sphere of influence.
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.radius=3.5]          - Radius of the largest fragment
 * @param {number} [params.fragmentCount=5]     - Number of major fragments
 * @param {number|string} [params.color=0xb05535]
 * @param {number} [params.spreadFactor=1.8]    - How spread out the fragments are
 * @param {number} [params.seed=4]
 * @returns {THREE.Group}
 */
function buildPlanetFragmentMesh(THREE, params = {}) {
  const radius = clamp(params.radius ?? 3.5, 0.5, 30);
  const fragmentCount = clamp(Math.round(params.fragmentCount ?? 5), 2, 24);
  const color = parseColorHex(params.color, 0xb05535);
  const spreadFactor = clamp(params.spreadFactor ?? 1.8, 1.0, 6.0);
  const seed = params.seed ?? 4;
  const rng = makeRng(seed);

  const group = new THREE.Group();
  group.userData = {
    kind: 'planet_fragment',
    color,
    spinSpeeds: [],
  };

  for (let i = 0; i < fragmentCount; i++) {
    // Largest fragment gets the lion's share of the radius
    const sizeFraction = i === 0
      ? 0.55 + rng() * 0.2
      : 0.12 + rng() * 0.35;
    const fRadius = radius * sizeFraction;

    // Irregular chunk via deformed sphere
    const geoSeed = seed + i * 17;
    const rngF = makeRng(geoSeed);
    const geo = new THREE.SphereGeometry(fRadius, 10, 8);
    const pos = geo.attributes.position;
    const deform = fRadius * (0.2 + rngF() * 0.3);
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v);
      const vy = pos.getY(v);
      const vz = pos.getZ(v);
      const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      const d = (rngF() - 0.5) * 2 * deform;
      pos.setXYZ(v, vx + (vx / vLen) * d, vy + (vy / vLen) * d, vz + (vz / vLen) * d);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // Slightly vary colour per fragment
    const hueShift = (rng() - 0.5) * 0.06;
    const fragColor = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    fragColor.getHSL(hsl);
    fragColor.setHSL(
      (hsl.h + hueShift + 1) % 1,
      clamp(hsl.s * (0.8 + rng() * 0.4), 0, 1),
      clamp(hsl.l * (0.7 + rng() * 0.6), 0, 1)
    );

    const mat = new THREE.MeshStandardMaterial({
      color: fragColor,
      roughness: 0.82 + rng() * 0.12,
      metalness: 0.05 + rng() * 0.08,
    });

    const chunk = new THREE.Mesh(geo, mat);
    // Scatter around origin
    const spread = radius * spreadFactor;
    chunk.position.set(
      (rng() - 0.5) * spread,
      (rng() - 0.5) * spread * 0.4,
      (rng() - 0.5) * spread
    );
    // Random initial rotation
    chunk.rotation.x = rng() * Math.PI * 2;
    chunk.rotation.y = rng() * Math.PI * 2;
    chunk.rotation.z = rng() * Math.PI * 2;
    chunk.userData = { kind: 'planet-chunk', chunkIndex: i };

    group.userData.spinSpeeds.push({
      x: (rng() - 0.5) * 0.04,
      y: (rng() - 0.5) * 0.06,
      z: (rng() - 0.5) * 0.02,
    });

    group.add(chunk);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Build the appropriate mesh for a special body.
 *
 * @param {object} THREE
 * @param {string} bodyType  - One of SPECIAL_BODY_TYPES values
 * @param {object} params
 * @returns {THREE.Group | THREE.Mesh | null}
 */
function buildSpecialBodyMesh(THREE, bodyType, params = {}) {
  switch (String(bodyType || '').toLowerCase()) {
    case SPECIAL_BODY_TYPES.ASTEROID_BELT:    return buildAsteroidBeltMesh(THREE, params);
    case SPECIAL_BODY_TYPES.NEBULA_CLOUD:     return buildNebulaCloudMesh(THREE, params);
    case SPECIAL_BODY_TYPES.IRREGULAR_PLANET: return buildIrregularPlanetMesh(THREE, params);
    case SPECIAL_BODY_TYPES.PLANET_FRAGMENT:  return buildPlanetFragmentMesh(THREE, params);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const SystemSpecialBodiesRenderer = {
  SPECIAL_BODY_TYPES,
  buildAsteroidBeltMesh,
  buildNebulaCloudMesh,
  buildIrregularPlanetMesh,
  buildPlanetFragmentMesh,
  buildSpecialBodyMesh,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SystemSpecialBodiesRenderer;
} else if (typeof window !== 'undefined') {
  window.GQSystemSpecialBodiesRenderer = SystemSpecialBodiesRenderer;
}
