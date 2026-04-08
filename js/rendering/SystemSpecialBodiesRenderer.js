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
  // Natural bodies
  ASTEROID_BELT: 'asteroid_belt',
  NEBULA_CLOUD: 'nebula_cloud',
  IRREGULAR_PLANET: 'irregular_planet',
  PLANET_FRAGMENT: 'planet_fragment',
  COMET: 'comet',
  BLACK_HOLE: 'black_hole',
  ICE_FIELD: 'ice_field',
  DUST_CLOUD: 'dust_cloud',
  // Artificial / man-made structures
  SPACE_STATION: 'space_station',
  JUMP_GATE: 'jump_gate',
  DEBRIS_FIELD: 'debris_field',
  DYSON_SWARM: 'dyson_swarm',
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
// Factory: Comet
// ---------------------------------------------------------------------------

/**
 * Build a comet with a nucleus, coma, and directional particle tail.
 *
 * The tail particles are placed in a group aligned to +Z in local space.
 * The tick function rotates the tailGroup so that +Z points away from the
 * star (origin) based on the comet's current world position.
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.nucleusRadius=0.6]   - Radius of the icy nucleus
 * @param {number} [params.comaScale=2.2]        - Radius of the diffuse coma sphere
 * @param {number} [params.tailLength=18]        - Length of the particle tail
 * @param {number} [params.tailParticles=300]    - Number of tail particles
 * @param {number|string} [params.color=0xc8e8ff] - Base icy-blue color
 * @param {number} [params.seed=5]
 * @returns {THREE.Group}
 */
function buildCometMesh(THREE, params = {}) {
  const nucleusRadius = clamp(params.nucleusRadius ?? 0.6, 0.1, 6);
  const comaScale     = clamp(params.comaScale ?? 2.2, nucleusRadius * 1.4, 20);
  const tailLength    = clamp(params.tailLength ?? 18, 2, 120);
  const tailParticles = clamp(params.tailParticles ?? 300, 30, 3000);
  const color         = parseColorHex(params.color, 0xc8e8ff);
  const seed          = params.seed ?? 5;
  const rng           = makeRng(seed);

  const group = new THREE.Group();

  // --- Nucleus: small deformed icy sphere ---
  const nucleusGeo = new THREE.SphereGeometry(nucleusRadius, 10, 8);
  const nPos = nucleusGeo.attributes.position;
  const deformAmp = nucleusRadius * 0.28;
  for (let i = 0; i < nPos.count; i++) {
    const x = nPos.getX(i); const y = nPos.getY(i); const z = nPos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const d = (rng() - 0.5) * 2 * deformAmp;
    nPos.setXYZ(i, x + (x / len) * d, y + (y / len) * d, z + (z / len) * d);
  }
  nPos.needsUpdate = true;
  nucleusGeo.computeVertexNormals();
  const nucleus = new THREE.Mesh(
    nucleusGeo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.08 })
  );
  nucleus.userData = { kind: 'comet-nucleus' };
  group.add(nucleus);

  // --- Coma: large translucent glow sphere ---
  const coma = new THREE.Mesh(
    new THREE.SphereGeometry(comaScale, 12, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  coma.userData = { kind: 'comet-coma' };
  group.add(coma);

  // --- Tail: particle cone in +Z direction ---
  const tailPositions = new Float32Array(tailParticles * 3);
  for (let i = 0; i < tailParticles; i++) {
    // t ∈ [0,1] along the tail, 0 = nucleus, 1 = tip
    const t = rng();
    // Spread grows with distance from nucleus
    const spread = tailLength * t * (0.12 + rng() * 0.18);
    const angle  = rng() * Math.PI * 2;
    tailPositions[i * 3]     = Math.cos(angle) * spread;
    tailPositions[i * 3 + 1] = Math.sin(angle) * spread;
    tailPositions[i * 3 + 2] = t * tailLength;       // along +Z
  }
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3));
  const tailMat = new THREE.PointsMaterial({
    color,
    size: clamp(params.tailParticleSize ?? 0.35, 0.05, 2.0),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const tailPoints = new THREE.Points(tailGeo, tailMat);
  tailPoints.userData = { kind: 'comet-tail' };

  const tailGroup = new THREE.Group();
  tailGroup.add(tailPoints);
  tailGroup.userData = { kind: 'comet-tail-group' };
  group.add(tailGroup);

  group.userData = {
    kind: 'comet',
    color,
    tailGroup,
    nucleusSpinSpeed: 0.05 + rng() * 0.1,
    nucleusMesh: nucleus,
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Black Hole
// ---------------------------------------------------------------------------

/**
 * Build a stellar-mass black hole with an event horizon and accretion disk.
 *
 * No shaders are used (keeps it testable and runtime-independent).
 * The accretion disk is a flat ring of particles combined with a semi-
 * transparent RingGeometry plane.
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.radius=2.2]            - Event horizon radius
 * @param {number} [params.diskInner=2.8]         - Inner edge of accretion disk
 * @param {number} [params.diskOuter=9.0]         - Outer edge of accretion disk
 * @param {number} [params.diskParticles=500]     - Disk particle count
 * @param {number|string} [params.diskColor=0xff8822]
 * @param {number} [params.glowColor=0xff6600]
 * @param {number} [params.seed=6]
 * @returns {THREE.Group}
 */
function buildBlackHoleMesh(THREE, params = {}) {
  const radius       = clamp(params.radius ?? 2.2, 0.5, 20);
  const diskInner    = clamp(params.diskInner ?? radius * 1.3, radius * 1.1, radius * 4);
  const diskOuter    = clamp(params.diskOuter ?? radius * 4.1, diskInner * 1.2, radius * 20);
  const diskParticles = clamp(params.diskParticles ?? 500, 50, 5000);
  const diskColor    = parseColorHex(params.diskColor, 0xff8822);
  const glowColor    = parseColorHex(params.glowColor, 0xff6600);
  const seed         = params.seed ?? 6;
  const rng          = makeRng(seed);

  const group = new THREE.Group();

  // --- Event horizon: pure black sphere ---
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  horizon.userData = { kind: 'bh-horizon' };
  group.add(horizon);

  // --- Photon ring / gravitational lensing glow ---
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.28, 16, 12),
    new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  glow.userData = { kind: 'bh-glow' };
  group.add(glow);

  // --- Accretion disk: RingGeometry plane + particle layer ---
  const diskRing = new THREE.Mesh(
    new THREE.RingGeometry(diskInner, diskOuter, 64, 2),
    new THREE.MeshBasicMaterial({
      color: diskColor,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  diskRing.rotation.x = Math.PI / 2;
  diskRing.userData = { kind: 'bh-disk-ring' };
  group.add(diskRing);

  // --- Disk particles scattered in ring volume ---
  const diskPos = new Float32Array(diskParticles * 3);
  for (let i = 0; i < diskParticles; i++) {
    const r = diskInner + rng() * (diskOuter - diskInner);
    const theta = rng() * Math.PI * 2;
    const height = (rng() - 0.5) * radius * 0.3;
    diskPos[i * 3]     = r * Math.cos(theta);
    diskPos[i * 3 + 1] = height;
    diskPos[i * 3 + 2] = r * Math.sin(theta);
  }
  const diskGeo = new THREE.BufferGeometry();
  diskGeo.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
  const diskParticleMesh = new THREE.Points(
    diskGeo,
    new THREE.PointsMaterial({
      color: diskColor,
      size: 0.22,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  diskParticleMesh.userData = { kind: 'bh-disk-particles' };
  group.add(diskParticleMesh);

  group.userData = {
    kind: 'black_hole',
    diskColor,
    diskRotationSpeed: clamp(params.diskRotationSpeed ?? 0.06, 0, 1.0),
    // References for tick animation
    diskRing,
    diskParticles: diskParticleMesh,
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Ice Field
// ---------------------------------------------------------------------------

/**
 * Build a sparse icy particle field (like a cold, patchy asteroid belt).
 *
 * Unlike an asteroid belt the ice field has no torus structure – particles
 * are distributed irregularly across a wide flat disk with clumping.
 * It is always stationary (centred at star origin).
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.innerRadius=40]       - Inner clear zone radius
 * @param {number} [params.outerRadius=180]      - Outer boundary radius
 * @param {number} [params.particleCount=800]    - Number of ice particles
 * @param {number} [params.height=6]             - Vertical spread
 * @param {number|string} [params.color=0xc0e0ff]
 * @param {number} [params.opacity=0.65]
 * @param {number} [params.seed=7]
 * @returns {THREE.Group}
 */
function buildIceFieldMesh(THREE, params = {}) {
  const innerRadius   = clamp(params.innerRadius ?? 40, 0, 400);
  const outerRadius   = clamp(params.outerRadius ?? 180, innerRadius + 5, 800);
  const particleCount = clamp(params.particleCount ?? 800, 50, 8000);
  const height        = clamp(params.height ?? 6, 0.5, 40);
  const color         = parseColorHex(params.color, 0xc0e0ff);
  const opacity       = clamp(params.opacity ?? 0.65, 0.1, 1.0);
  const seed          = params.seed ?? 7;
  const rng           = makeRng(seed);

  // Place particles with clumping: group them in ~8 loose clusters
  const clusterCount  = 8;
  const clusterCenters = [];
  for (let c = 0; c < clusterCount; c++) {
    const ca = rng() * Math.PI * 2;
    const cr = innerRadius + rng() * (outerRadius - innerRadius);
    clusterCenters.push({ cx: cr * Math.cos(ca), cz: cr * Math.sin(ca) });
  }

  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    // 70% near a cluster, 30% uniform background
    let px, py, pz;
    if (rng() < 0.7) {
      const cc = clusterCenters[Math.floor(rng() * clusterCount)];
      const spread = (outerRadius - innerRadius) * 0.12;
      px = cc.cx + (rng() - 0.5) * spread * 2;
      pz = cc.cz + (rng() - 0.5) * spread * 2;
    } else {
      const r = innerRadius + rng() * (outerRadius - innerRadius);
      const a = rng() * Math.PI * 2;
      px = r * Math.cos(a);
      pz = r * Math.sin(a);
    }
    py = (rng() * 2 - 1) * height;
    positions[i * 3]     = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: clamp(params.particleSize ?? 0.48, 0.1, 3.0),
    transparent: true,
    opacity,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind: 'ice-field-particles' };

  const group = new THREE.Group();
  group.add(points);
  group.userData = {
    kind: 'ice_field',
    color,
    innerRadius,
    outerRadius,
    rotationSpeed: clamp(params.rotationSpeed ?? 0.008, 0, 0.3),
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Dust Cloud
// ---------------------------------------------------------------------------

/**
 * Build a flat protoplanetary dust disk of fine particles.
 *
 * Particles are concentrated in a thin plane (XZ) with exponential
 * radial density decay, simulating a young star's dust cloud or
 * circumstellar debris disk.
 * It is always stationary (centred at star origin).
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.radius=100]          - Outer edge radius
 * @param {number} [params.innerClearRadius=12] - Radius of clear zone around star
 * @param {number} [params.particleCount=1200]  - Number of dust particles
 * @param {number} [params.diskThickness=3]     - Vertical half-thickness
 * @param {number|string} [params.color=0xc4a06e] - Dusty orange-brown
 * @param {number} [params.opacity=0.45]
 * @param {number} [params.seed=8]
 * @returns {THREE.Group}
 */
function buildDustCloudMesh(THREE, params = {}) {
  const radius          = clamp(params.radius ?? 100, 10, 600);
  const innerClear      = clamp(params.innerClearRadius ?? 12, 0, radius * 0.5);
  const particleCount   = clamp(params.particleCount ?? 1200, 50, 10000);
  const diskThickness   = clamp(params.diskThickness ?? 3, 0.5, 30);
  const color           = parseColorHex(params.color, 0xc4a06e);
  const opacity         = clamp(params.opacity ?? 0.45, 0.05, 1.0);
  const seed            = params.seed ?? 8;
  const rng             = makeRng(seed);

  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    // Radial distribution biased toward inner disk (exponential-ish falloff)
    const u = rng();
    const r = innerClear + (radius - innerClear) * (1 - Math.pow(1 - u, 2));
    const a = rng() * Math.PI * 2;
    positions[i * 3]     = r * Math.cos(a);
    positions[i * 3 + 1] = (rng() * 2 - 1) * diskThickness;
    positions[i * 3 + 2] = r * Math.sin(a);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: clamp(params.particleSize ?? 0.28, 0.05, 2.0),
    transparent: true,
    opacity,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind: 'dust-cloud-particles' };

  const group = new THREE.Group();
  group.add(points);
  group.userData = {
    kind: 'dust_cloud',
    color,
    radius,
    rotationSpeed: clamp(params.rotationSpeed ?? 0.025, 0, 0.5),
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Space Station
// ---------------------------------------------------------------------------

/**
 * Build a rotating space station with a toroidal habitat ring and radial
 * docking arms connecting to a central hub sphere.
 *
 * The station spins around the Y-axis during tick updates.
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.ringRadius=4.0]      - Torus major radius (habitat ring)
 * @param {number} [params.ringTube=0.55]       - Torus minor radius (cross-section)
 * @param {number} [params.hubRadius=0.9]       - Central hub sphere radius
 * @param {number} [params.armCount=4]          - Number of radial docking arms
 * @param {number|string} [params.color=0x7a9ab8]   - Main hull colour
 * @param {number|string} [params.glowColor=0x88ddff] - Window/light accent colour
 * @param {number} [params.seed=9]
 * @returns {THREE.Group}
 */
function buildSpaceStationMesh(THREE, params = {}) {
  const ringRadius  = clamp(params.ringRadius ?? 4.0, 0.8, 40);
  const ringTube    = clamp(params.ringTube ?? 0.55, 0.1, ringRadius * 0.35);
  const hubRadius   = clamp(params.hubRadius ?? 0.9, 0.2, ringRadius * 0.5);
  const armCount    = clamp(Math.round(params.armCount ?? 4), 2, 12);
  const color       = parseColorHex(params.color, 0x7a9ab8);
  const glowColor   = parseColorHex(params.glowColor, 0x88ddff);
  const seed        = params.seed ?? 9;
  const rng         = makeRng(seed);

  const group = new THREE.Group();

  // --- Habitat ring (torus) ---
  const ringMesh = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, ringTube, 10, 48),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.7 })
  );
  ringMesh.userData = { kind: 'station-ring' };
  group.add(ringMesh);

  // --- Central hub sphere ---
  const hub = new THREE.Mesh(
    new THREE.SphereGeometry(hubRadius, 12, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.85 })
  );
  hub.userData = { kind: 'station-hub' };
  group.add(hub);

  // --- Docking arms: thin cylinders from hub to ring ---
  for (let i = 0; i < armCount; i++) {
    const angle = (i / armCount) * Math.PI * 2;
    const ax = Math.cos(angle) * ringRadius;
    const az = Math.sin(angle) * ringRadius;

    // Arm represented by a short cylinder mesh (approximated via a very flat
    // BoxGeometry to avoid needing CylinderGeometry in mock tests)
    const armLength = ringRadius - hubRadius;
    const armGeo = new THREE.SphereGeometry(ringTube * 0.25, 4, 2);
    // Scale to form a rod: X = thickness, Y = thickness, Z = arm length
    const arm = new THREE.Mesh(
      armGeo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.75 })
    );
    arm.scale.set(1, 1, armLength / (ringTube * 0.25));
    arm.position.set(ax * 0.5, 0, az * 0.5);
    arm.rotation.y = -angle;
    arm.userData = { kind: 'station-arm', armIndex: i };
    group.add(arm);

    // Tiny glow dot at the docking port on the ring
    const port = new THREE.Mesh(
      new THREE.SphereGeometry(ringTube * 0.38, 4, 3),
      new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.8 })
    );
    port.position.set(ax, 0, az);
    port.userData = { kind: 'station-port', armIndex: i };
    group.add(port);
  }

  group.userData = {
    kind: 'space_station',
    color,
    glowColor,
    spinSpeed:    clamp(params.spinSpeed ?? 0.22, 0, 2.0),
    _glowPhase:   rng() * Math.PI * 2,
    glowPulseSpeed: clamp(params.glowPulseSpeed ?? 1.2, 0, 8),
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Jump Gate
// ---------------------------------------------------------------------------

/**
 * Build a jump gate: a large structural ring frame with an energy particle
 * disk spanning its opening. The particle disk pulses and the frame slowly
 * counter-rotates against the disk.
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.gateRadius=6.0]      - Ring frame major radius
 * @param {number} [params.frameTube=0.6]       - Frame cross-section radius
 * @param {number} [params.particleCount=400]   - Energy field particles
 * @param {number|string} [params.frameColor=0x445566]
 * @param {number|string} [params.energyColor=0x44aaff]
 * @param {number} [params.seed=10]
 * @returns {THREE.Group}
 */
function buildJumpGateMesh(THREE, params = {}) {
  const gateRadius   = clamp(params.gateRadius ?? 6.0, 1, 60);
  const frameTube    = clamp(params.frameTube ?? 0.6, 0.1, gateRadius * 0.2);
  const particleCount = clamp(params.particleCount ?? 400, 30, 4000);
  const frameColor   = parseColorHex(params.frameColor, 0x445566);
  const energyColor  = parseColorHex(params.energyColor, 0x44aaff);
  const seed         = params.seed ?? 10;
  const rng          = makeRng(seed);

  const group = new THREE.Group();

  // --- Ring frame ---
  const frameMesh = new THREE.Mesh(
    new THREE.TorusGeometry(gateRadius, frameTube, 10, 56),
    new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.35, metalness: 0.9 })
  );
  frameMesh.userData = { kind: 'gate-frame' };
  group.add(frameMesh);

  // --- Energy field: filled disk of particles ---
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    // Uniform disk distribution (rejection-free)
    const r = gateRadius * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    positions[i * 3]     = r * Math.cos(a);
    positions[i * 3 + 1] = r * Math.sin(a);
    positions[i * 3 + 2] = (rng() - 0.5) * frameTube * 0.6;
  }
  const energyGeo = new THREE.BufferGeometry();
  energyGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const energyPoints = new THREE.Points(
    energyGeo,
    new THREE.PointsMaterial({
      color: energyColor,
      size: clamp(params.particleSize ?? 0.25, 0.05, 1.5),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  energyPoints.userData = { kind: 'gate-energy-field' };
  group.add(energyPoints);

  // --- Outer accent ring (slightly larger, lower opacity) ---
  const accentRing = new THREE.Mesh(
    new THREE.RingGeometry(gateRadius * 0.96, gateRadius * 1.04, 64, 1),
    new THREE.MeshBasicMaterial({
      color: energyColor,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  accentRing.userData = { kind: 'gate-accent-ring' };
  group.add(accentRing);

  group.userData = {
    kind: 'jump_gate',
    frameColor,
    energyColor,
    frameSpinSpeed:    clamp(params.frameSpinSpeed ?? 0.04, 0, 0.5),
    energySpinSpeed:   clamp(params.energySpinSpeed ?? -0.18, -1, 1),
    _energyPhase:      rng() * Math.PI * 2,
    pulseSpeed:        clamp(params.pulseSpeed ?? 1.6, 0, 8),
    pulseAmplitude:    clamp(params.pulseAmplitude ?? 0.12, 0, 0.5),
    frameMesh,
    energyPoints,
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Debris Field
// ---------------------------------------------------------------------------

/**
 * Build a man-made debris field: a cloud of metallic wreckage particles
 * spread loosely in 3D space (not just a flat disk).
 *
 * Unlike a natural asteroid belt the debris is spherically distributed and
 * includes colour variation (oxidised metal tones).
 * Debris fields are stationary (centred at star origin).
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.fieldRadius=55]      - Outer radius of the debris cloud
 * @param {number} [params.particleCount=700]   - Number of debris particles
 * @param {number} [params.verticalSpread=0.55] - Vertical-to-radial spread ratio
 * @param {number|string} [params.color=0x8a7060] - Base metallic-rust colour
 * @param {number} [params.opacity=0.7]
 * @param {number} [params.seed=11]
 * @returns {THREE.Group}
 */
function buildDebrisFieldMesh(THREE, params = {}) {
  const fieldRadius    = clamp(params.fieldRadius ?? 55, 5, 400);
  const particleCount  = clamp(params.particleCount ?? 700, 50, 8000);
  const verticalSpread = clamp(params.verticalSpread ?? 0.55, 0.05, 1.0);
  const color          = parseColorHex(params.color, 0x8a7060);
  const opacity        = clamp(params.opacity ?? 0.7, 0.1, 1.0);
  const seed           = params.seed ?? 11;
  const rng            = makeRng(seed);

  // Two layers: large sparse chunks + small fine particles
  const chunkCount = Math.round(particleCount * 0.3);
  const fineCount  = particleCount - chunkCount;

  const chunkPos = new Float32Array(chunkCount * 3);
  for (let i = 0; i < chunkCount; i++) {
    const r = fieldRadius * (0.2 + rng() * 0.8);
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * rng()); // uniform sphere
    chunkPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    chunkPos[i * 3 + 1] = r * Math.cos(phi) * verticalSpread;
    chunkPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const chunkGeo = new THREE.BufferGeometry();
  chunkGeo.setAttribute('position', new THREE.BufferAttribute(chunkPos, 3));
  const chunks = new THREE.Points(
    chunkGeo,
    new THREE.PointsMaterial({
      color,
      size: clamp(params.chunkSize ?? 0.9, 0.2, 5.0),
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  chunks.userData = { kind: 'debris-chunks' };

  const finePos = new Float32Array(fineCount * 3);
  for (let i = 0; i < fineCount; i++) {
    const r = fieldRadius * rng();
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * rng());
    finePos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    finePos[i * 3 + 1] = r * Math.cos(phi) * verticalSpread;
    finePos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const fineGeo = new THREE.BufferGeometry();
  fineGeo.setAttribute('position', new THREE.BufferAttribute(finePos, 3));
  // Slightly lighter oxidised tone for fine dust
  const fineColor = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  fineColor.getHSL(hsl);
  fineColor.setHSL(hsl.h, clamp(hsl.s * 0.6, 0, 1), clamp(hsl.l * 1.35, 0, 1));
  const fine = new THREE.Points(
    fineGeo,
    new THREE.PointsMaterial({
      color: fineColor,
      size: clamp(params.fineSize ?? 0.28, 0.05, 2.0),
      transparent: true,
      opacity: opacity * 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  fine.userData = { kind: 'debris-fine' };

  const group = new THREE.Group();
  group.add(chunks);
  group.add(fine);
  group.userData = {
    kind: 'debris_field',
    color,
    fieldRadius,
    driftSpeed: clamp(params.driftSpeed ?? 0.005, 0, 0.2),
  };
  return group;
}

// ---------------------------------------------------------------------------
// Factory: Dyson Swarm
// ---------------------------------------------------------------------------

/**
 * Build a partial Dyson swarm: a large number of tiny solar-collector quads
 * distributed on the surface of a sphere around the star.
 *
 * Each panel is represented as a Points particle (individual quad meshes
 * would be too expensive). The swarm group rotates slowly on multiple axes
 * to simulate independent orbits.
 * Dyson swarms are stationary (centred at the star).
 *
 * @param {object} THREE
 * @param {object} params
 * @param {number} [params.swarmRadius=90]       - Radius of the swarm shell
 * @param {number} [params.panelCount=1200]      - Number of collector panels
 * @param {number} [params.coverage=0.65]        - Fraction of sphere covered (0–1)
 * @param {number|string} [params.panelColor=0x2255aa] - Panel colour (deep blue PV)
 * @param {number|string} [params.glintColor=0xaaddff]  - Glint/reflection colour
 * @param {number} [params.seed=12]
 * @returns {THREE.Group}
 */
function buildDysonSwarmMesh(THREE, params = {}) {
  const swarmRadius = clamp(params.swarmRadius ?? 90, 10, 600);
  const panelCount  = clamp(params.panelCount ?? 1200, 50, 10000);
  const coverage    = clamp(params.coverage ?? 0.65, 0.1, 1.0);
  const panelColor  = parseColorHex(params.panelColor, 0x2255aa);
  const glintColor  = parseColorHex(params.glintColor, 0xaaddff);
  const seed        = params.seed ?? 12;
  const rng         = makeRng(seed);

  // --- Panel particles uniformly distributed on sphere, within coverage cap ---
  const positions = new Float32Array(panelCount * 3);
  // Coverage maps to a polar angle cap on both hemispheres
  const cosMax = 1 - 2 * coverage;
  for (let i = 0; i < panelCount; i++) {
    const theta = rng() * Math.PI * 2;
    const cosP  = cosMax + (1 - cosMax) * rng();           // biased toward equator
    const sinP  = Math.sqrt(Math.max(0, 1 - cosP * cosP));
    const r     = swarmRadius * (0.9 + rng() * 0.2);       // slight radial spread
    positions[i * 3]     = r * sinP * Math.cos(theta);
    positions[i * 3 + 1] = r * cosP;
    positions[i * 3 + 2] = r * sinP * Math.sin(theta);
  }
  const panelGeo = new THREE.BufferGeometry();
  panelGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const panelPoints = new THREE.Points(
    panelGeo,
    new THREE.PointsMaterial({
      color: panelColor,
      size: clamp(params.panelSize ?? 0.7, 0.1, 4.0),
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  panelPoints.userData = { kind: 'dyson-panels' };

  // --- Glint layer: sparser, brighter reflection highlights ---
  const glintCount = Math.round(panelCount * 0.15);
  const glintPos   = new Float32Array(glintCount * 3);
  for (let i = 0; i < glintCount; i++) {
    const theta = rng() * Math.PI * 2;
    const cosP  = cosMax + (1 - cosMax) * rng();
    const sinP  = Math.sqrt(Math.max(0, 1 - cosP * cosP));
    const r     = swarmRadius * (0.95 + rng() * 0.1);
    glintPos[i * 3]     = r * sinP * Math.cos(theta);
    glintPos[i * 3 + 1] = r * cosP;
    glintPos[i * 3 + 2] = r * sinP * Math.sin(theta);
  }
  const glintGeo = new THREE.BufferGeometry();
  glintGeo.setAttribute('position', new THREE.BufferAttribute(glintPos, 3));
  const glintPoints = new THREE.Points(
    glintGeo,
    new THREE.PointsMaterial({
      color: glintColor,
      size: 0.4,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  glintPoints.userData = { kind: 'dyson-glints' };

  const group = new THREE.Group();
  group.add(panelPoints);
  group.add(glintPoints);
  group.userData = {
    kind: 'dyson_swarm',
    panelColor,
    glintColor,
    swarmRadius,
    rotationSpeeds: {
      x: clamp(params.rotationSpeedX ?? 0.004, 0, 0.2),
      y: clamp(params.rotationSpeedY ?? 0.009, 0, 0.2),
      z: clamp(params.rotationSpeedZ ?? 0.002, 0, 0.2),
    },
  };
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
    case SPECIAL_BODY_TYPES.COMET:            return buildCometMesh(THREE, params);
    case SPECIAL_BODY_TYPES.BLACK_HOLE:       return buildBlackHoleMesh(THREE, params);
    case SPECIAL_BODY_TYPES.ICE_FIELD:        return buildIceFieldMesh(THREE, params);
    case SPECIAL_BODY_TYPES.DUST_CLOUD:       return buildDustCloudMesh(THREE, params);
    case SPECIAL_BODY_TYPES.SPACE_STATION:    return buildSpaceStationMesh(THREE, params);
    case SPECIAL_BODY_TYPES.JUMP_GATE:        return buildJumpGateMesh(THREE, params);
    case SPECIAL_BODY_TYPES.DEBRIS_FIELD:     return buildDebrisFieldMesh(THREE, params);
    case SPECIAL_BODY_TYPES.DYSON_SWARM:      return buildDysonSwarmMesh(THREE, params);
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
  buildCometMesh,
  buildBlackHoleMesh,
  buildIceFieldMesh,
  buildDustCloudMesh,
  buildSpaceStationMesh,
  buildJumpGateMesh,
  buildDebrisFieldMesh,
  buildDysonSwarmMesh,
  buildSpecialBodyMesh,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SystemSpecialBodiesRenderer;
} else if (typeof window !== 'undefined') {
  window.GQSystemSpecialBodiesRenderer = SystemSpecialBodiesRenderer;
}
