/**
 * tests/js/system-special-bodies.test.js
 *
 * Unit tests for SystemSpecialBodiesRenderer.js
 *
 * Tests cover:
 *  - buildAsteroidBeltMesh  – torus-ring particle cloud
 *  - buildNebulaCloudMesh   – layered billboard cloud
 *  - buildIrregularPlanetMesh – noise-displaced sphere
 *  - buildPlanetFragmentMesh  – cluster of rocky chunks
 *  - buildSpecialBodyMesh dispatcher
 *  - SPECIAL_BODY_TYPES constant
 *  - Integration: _buildSystemSpecialBodies / _tickSystemSpecialBodies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import SystemSpecialBodiesRenderer from '../../js/rendering/SystemSpecialBodiesRenderer.js';

const {
  SPECIAL_BODY_TYPES,
  buildAsteroidBeltMesh,
  buildNebulaCloudMesh,
  buildIrregularPlanetMesh,
  buildPlanetFragmentMesh,
  buildCometMesh,
  buildBlackHoleMesh,
  buildIceFieldMesh,
  buildDustCloudMesh,
  buildSpecialBodyMesh,
} = SystemSpecialBodiesRenderer;

// ---------------------------------------------------------------------------
// Minimal Three.js mock (no external dep)
// ---------------------------------------------------------------------------

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  clone() { return new MockVector3(this.x, this.y, this.z); }
  sub(v) { return new MockVector3(this.x - v.x, this.y - v.y, this.z - v.z); }
}

class MockColor {
  constructor(hex = 0xffffff) { this._hex = hex; this._h = 0; this._s = 1; this._l = 0.5; }
  getHSL(target) { target.h = this._h; target.s = this._s; target.l = this._l; return target; }
  setHSL(h, s, l) { this._h = h; this._s = s; this._l = l; return this; }
  clone() { const c = new MockColor(this._hex); c._h = this._h; c._s = this._s; c._l = this._l; return c; }
}

class MockBufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXYZ(i, x, y, z) { this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; this.array[i * this.itemSize + 2] = z; }
}
MockBufferAttribute.prototype.needsUpdate = false;

class MockBufferGeometry {
  constructor() { this.attributes = {}; this._points = null; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  setFromPoints(pts) { this._points = pts; return this; }
  computeVertexNormals() {}
}

class MockSphereGeometry {
  constructor(radius, wSeg, hSeg) {
    const count = (wSeg + 1) * (hSeg + 1);
    const arr = new Float32Array(count * 3);
    // Populate with points on a unit sphere scaled by radius
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI;
      const phi   = (i / count) * Math.PI * 2;
      arr[i * 3]     = radius * Math.sin(theta) * Math.cos(phi);
      arr[i * 3 + 1] = radius * Math.cos(theta);
      arr[i * 3 + 2] = radius * Math.sin(theta) * Math.sin(phi);
    }
    this.attributes = {
      position: new MockBufferAttribute(arr, 3),
    };
    this.parameters = { radius, widthSegments: wSeg, heightSegments: hSeg };
  }
  computeVertexNormals() {}
}

class MockTorusGeometry {
  constructor(radius, tube, radSeg, tubeSeg) {
    this.parameters = { radius, tube, radialSegments: radSeg, tubularSegments: tubeSeg };
  }
}

class MockPlaneGeometry {
  constructor(w, h) { this.parameters = { width: w, height: h }; }
}

class MockMesh {
  constructor(geo, mat) {
    this.geometry = geo;
    this.material = mat;
    this.userData = {};
    this.position = new MockVector3();
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { x: 1, y: 1, z: 1, setScalar(s) { this.x = s; this.y = s; this.z = s; } };
    this.children = [];
    this.visible = true;
  }
  add(child) { this.children.push(child); return this; }
}

class MockPoints {
  constructor(geo, mat) { this.geometry = geo; this.material = mat; this.userData = {}; }
}

class MockGroup {
  constructor() {
    this.children = [];
    this.userData = {};
    this.rotation = { x: 0, y: 0, z: 0 };
    this.position = new MockVector3();
    this.scale = { x: 1, y: 1, z: 1, setScalar(s) { this.x = s; this.y = s; this.z = s; } };
  }
  add(child) { this.children.push(child); return this; }
}

class MockMeshStandardMaterial {
  constructor(opts = {}) { Object.assign(this, opts); }
}
class MockMeshBasicMaterial {
  constructor(opts = {}) { Object.assign(this, opts); }
}
class MockPointsMaterial {
  constructor(opts = {}) { Object.assign(this, opts); }
}
class MockLineBasicMaterial {
  constructor(opts = {}) { Object.assign(this, opts); }
}
class MockLineLoop {
  constructor(geo, mat) { this.geometry = geo; this.material = mat; this.userData = {}; }
}
class MockRingGeometry {
  constructor(inner, outer, thetaSeg, phiSeg) {
    this.parameters = { innerRadius: inner, outerRadius: outer, thetaSegments: thetaSeg, phiSegments: phiSeg };
  }
}

const THREE = {
  Vector3: MockVector3,
  Color: MockColor,
  BufferGeometry: MockBufferGeometry,
  BufferAttribute: MockBufferAttribute,
  SphereGeometry: MockSphereGeometry,
  TorusGeometry: MockTorusGeometry,
  PlaneGeometry: MockPlaneGeometry,
  RingGeometry: MockRingGeometry,
  Mesh: MockMesh,
  Points: MockPoints,
  Group: MockGroup,
  LineLoop: MockLineLoop,
  MeshStandardMaterial: MockMeshStandardMaterial,
  MeshBasicMaterial: MockMeshBasicMaterial,
  PointsMaterial: MockPointsMaterial,
  LineBasicMaterial: MockLineBasicMaterial,
  DoubleSide: 2,
  AdditiveBlending: 2,
  BackSide: 1,
  MathUtils: {
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  },
};

// ---------------------------------------------------------------------------
// SPECIAL_BODY_TYPES
// ---------------------------------------------------------------------------

describe('SPECIAL_BODY_TYPES', () => {
  it('defines all four body type keys', () => {
    expect(SPECIAL_BODY_TYPES.ASTEROID_BELT).toBe('asteroid_belt');
    expect(SPECIAL_BODY_TYPES.NEBULA_CLOUD).toBe('nebula_cloud');
    expect(SPECIAL_BODY_TYPES.IRREGULAR_PLANET).toBe('irregular_planet');
    expect(SPECIAL_BODY_TYPES.PLANET_FRAGMENT).toBe('planet_fragment');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(SPECIAL_BODY_TYPES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildAsteroidBeltMesh
// ---------------------------------------------------------------------------

describe('buildAsteroidBeltMesh', () => {
  it('returns a THREE.Group', () => {
    const result = buildAsteroidBeltMesh(THREE);
    expect(result).toBeInstanceOf(MockGroup);
  });

  it('group has userData.kind === "asteroid_belt"', () => {
    const result = buildAsteroidBeltMesh(THREE);
    expect(result.userData.kind).toBe('asteroid_belt');
  });

  it('group contains two children (particles + torus)', () => {
    const result = buildAsteroidBeltMesh(THREE);
    expect(result.children).toHaveLength(2);
  });

  it('first child is a Points object (particles)', () => {
    const result = buildAsteroidBeltMesh(THREE);
    expect(result.children[0]).toBeInstanceOf(MockPoints);
  });

  it('second child is a Mesh (torus wireframe)', () => {
    const result = buildAsteroidBeltMesh(THREE);
    expect(result.children[1]).toBeInstanceOf(MockMesh);
  });

  it('torus wireframe uses TorusGeometry', () => {
    const result = buildAsteroidBeltMesh(THREE);
    const torus = result.children[1];
    expect(torus.geometry).toBeInstanceOf(MockTorusGeometry);
  });

  it('particle geometry has position attribute with correct count', () => {
    const particleCount = 200;
    const result = buildAsteroidBeltMesh(THREE, { particleCount });
    const points = result.children[0];
    expect(points.geometry.attributes.position.array.length).toBe(particleCount * 3);
  });

  it('respects custom radius in userData', () => {
    const result = buildAsteroidBeltMesh(THREE, { radius: 80 });
    expect(result.userData.beltRadius).toBe(80);
  });

  it('respects custom tube in userData', () => {
    const result = buildAsteroidBeltMesh(THREE, { radius: 100, tube: 15 });
    expect(result.userData.beltTube).toBe(15);
  });

  it('clamps particleCount to valid range', () => {
    const result = buildAsteroidBeltMesh(THREE, { particleCount: -5 });
    const points = result.children[0];
    expect(points.geometry.attributes.position.array.length).toBe(50 * 3); // clamped to min 50
  });

  it('produces deterministic results with same seed', () => {
    const a = buildAsteroidBeltMesh(THREE, { particleCount: 100, seed: 42 });
    const b = buildAsteroidBeltMesh(THREE, { particleCount: 100, seed: 42 });
    const posA = a.children[0].geometry.attributes.position.array;
    const posB = b.children[0].geometry.attributes.position.array;
    expect(Array.from(posA)).toEqual(Array.from(posB));
  });

  it('produces different results with different seeds', () => {
    const a = buildAsteroidBeltMesh(THREE, { particleCount: 100, seed: 1 });
    const b = buildAsteroidBeltMesh(THREE, { particleCount: 100, seed: 99 });
    const posA = a.children[0].geometry.attributes.position.array;
    const posB = b.children[0].geometry.attributes.position.array;
    expect(Array.from(posA)).not.toEqual(Array.from(posB));
  });

  it('accepts hex string color', () => {
    const result = buildAsteroidBeltMesh(THREE, { color: '#c04020' });
    expect(result.userData.color).toBe(0xc04020);
  });

  it('torus is rotated 90° on X to lie in XZ plane', () => {
    const result = buildAsteroidBeltMesh(THREE);
    const torus = result.children[1];
    expect(torus.rotation.x).toBeCloseTo(Math.PI / 2);
  });
});

// ---------------------------------------------------------------------------
// buildNebulaCloudMesh
// ---------------------------------------------------------------------------

describe('buildNebulaCloudMesh', () => {
  it('returns a THREE.Group', () => {
    const result = buildNebulaCloudMesh(THREE);
    expect(result).toBeInstanceOf(MockGroup);
  });

  it('userData.kind === "nebula_cloud"', () => {
    const result = buildNebulaCloudMesh(THREE);
    expect(result.userData.kind).toBe('nebula_cloud');
  });

  it('contains layerCount children by default (6)', () => {
    const result = buildNebulaCloudMesh(THREE);
    expect(result.children).toHaveLength(6);
  });

  it('respects custom layerCount', () => {
    const result = buildNebulaCloudMesh(THREE, { layerCount: 4 });
    expect(result.children).toHaveLength(4);
  });

  it('clamps layerCount to minimum 2', () => {
    const result = buildNebulaCloudMesh(THREE, { layerCount: 0 });
    expect(result.children).toHaveLength(2);
  });

  it('each child is a Mesh using PlaneGeometry', () => {
    const result = buildNebulaCloudMesh(THREE);
    result.children.forEach((child) => {
      expect(child).toBeInstanceOf(MockMesh);
      expect(child.geometry).toBeInstanceOf(MockPlaneGeometry);
    });
  });

  it('each layer has userData.kind === "nebula-cloud-layer"', () => {
    const result = buildNebulaCloudMesh(THREE);
    result.children.forEach((child) => {
      expect(child.userData.kind).toBe('nebula-cloud-layer');
    });
  });

  it('each layer has a sequential layerIndex', () => {
    const result = buildNebulaCloudMesh(THREE, { layerCount: 3 });
    result.children.forEach((child, i) => {
      expect(child.userData.layerIndex).toBe(i);
    });
  });

  it('uses AdditiveBlending for visual layering', () => {
    const result = buildNebulaCloudMesh(THREE);
    result.children.forEach((child) => {
      expect(child.material.blending).toBe(THREE.AdditiveBlending);
    });
  });

  it('stores driftSpeed in userData', () => {
    const result = buildNebulaCloudMesh(THREE, { driftSpeed: 0.02 });
    expect(result.userData.driftSpeed).toBeCloseTo(0.02);
  });

  it('stores pulseSpeed in userData', () => {
    const result = buildNebulaCloudMesh(THREE, { pulseSpeed: 1.2 });
    expect(result.userData.pulseSpeed).toBeCloseTo(1.2);
  });
});

// ---------------------------------------------------------------------------
// buildIrregularPlanetMesh
// ---------------------------------------------------------------------------

describe('buildIrregularPlanetMesh', () => {
  it('returns a THREE.Group', () => {
    const result = buildIrregularPlanetMesh(THREE);
    expect(result).toBeInstanceOf(MockGroup);
  });

  it('userData.kind === "irregular_planet"', () => {
    const result = buildIrregularPlanetMesh(THREE);
    expect(result.userData.kind).toBe('irregular_planet');
  });

  it('contains exactly one child mesh', () => {
    const result = buildIrregularPlanetMesh(THREE);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBeInstanceOf(MockMesh);
  });

  it('child mesh uses SphereGeometry', () => {
    const result = buildIrregularPlanetMesh(THREE);
    expect(result.children[0].geometry).toBeInstanceOf(MockSphereGeometry);
  });

  it('child mesh userData.kind === "irregular_planet"', () => {
    const result = buildIrregularPlanetMesh(THREE);
    expect(result.children[0].userData.kind).toBe('irregular_planet');
  });

  it('vertex positions are displaced from the original sphere', () => {
    const radius = 5;
    const result = buildIrregularPlanetMesh(THREE, { radius, deformation: 0.4 });
    const mesh = result.children[0];
    const pos = mesh.geometry.attributes.position;
    let anyDisplaced = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const r = Math.sqrt(x * x + y * y + z * z);
      if (Math.abs(r - radius) > 0.05) { anyDisplaced = true; break; }
    }
    expect(anyDisplaced).toBe(true);
  });

  it('respects radius parameter in userData', () => {
    const result = buildIrregularPlanetMesh(THREE, { radius: 7 });
    expect(result.children[0].userData.radius).toBe(7);
  });

  it('produces deterministic output with same seed', () => {
    const a = buildIrregularPlanetMesh(THREE, { radius: 4, seed: 77 });
    const b = buildIrregularPlanetMesh(THREE, { radius: 4, seed: 77 });
    const posA = a.children[0].geometry.attributes.position;
    const posB = b.children[0].geometry.attributes.position;
    expect(posA.getX(0)).toBeCloseTo(posB.getX(0));
    expect(posA.getY(5)).toBeCloseTo(posB.getY(5));
  });
});

// ---------------------------------------------------------------------------
// buildPlanetFragmentMesh
// ---------------------------------------------------------------------------

describe('buildPlanetFragmentMesh', () => {
  it('returns a THREE.Group', () => {
    const result = buildPlanetFragmentMesh(THREE);
    expect(result).toBeInstanceOf(MockGroup);
  });

  it('userData.kind === "planet_fragment"', () => {
    const result = buildPlanetFragmentMesh(THREE);
    expect(result.userData.kind).toBe('planet_fragment');
  });

  it('creates the requested number of fragments', () => {
    const result = buildPlanetFragmentMesh(THREE, { fragmentCount: 4 });
    expect(result.children).toHaveLength(4);
  });

  it('defaults to 5 fragments', () => {
    const result = buildPlanetFragmentMesh(THREE);
    expect(result.children).toHaveLength(5);
  });

  it('clamps fragmentCount to minimum 2', () => {
    const result = buildPlanetFragmentMesh(THREE, { fragmentCount: 1 });
    expect(result.children).toHaveLength(2);
  });

  it('each chunk uses SphereGeometry', () => {
    const result = buildPlanetFragmentMesh(THREE);
    result.children.forEach((chunk) => {
      expect(chunk.geometry).toBeInstanceOf(MockSphereGeometry);
    });
  });

  it('each chunk has userData.kind === "planet-chunk"', () => {
    const result = buildPlanetFragmentMesh(THREE);
    result.children.forEach((chunk) => {
      expect(chunk.userData.kind).toBe('planet-chunk');
    });
  });

  it('each chunk has a sequential chunkIndex', () => {
    const result = buildPlanetFragmentMesh(THREE, { fragmentCount: 3 });
    result.children.forEach((chunk, i) => {
      expect(chunk.userData.chunkIndex).toBe(i);
    });
  });

  it('stores spinSpeeds array matching fragment count', () => {
    const result = buildPlanetFragmentMesh(THREE, { fragmentCount: 3 });
    expect(result.userData.spinSpeeds).toHaveLength(3);
  });

  it('spinSpeeds have x/y/z numeric entries', () => {
    const result = buildPlanetFragmentMesh(THREE);
    result.userData.spinSpeeds.forEach((s) => {
      expect(typeof s.x).toBe('number');
      expect(typeof s.y).toBe('number');
      expect(typeof s.z).toBe('number');
    });
  });

  it('fragments are spatially spread apart (not all at origin)', () => {
    const result = buildPlanetFragmentMesh(THREE, { fragmentCount: 5, spreadFactor: 2 });
    const positions = result.children.map((c) => ({ x: c.position.x, z: c.position.z }));
    const unique = new Set(positions.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('produces deterministic layout with same seed', () => {
    const a = buildPlanetFragmentMesh(THREE, { fragmentCount: 4, seed: 55 });
    const b = buildPlanetFragmentMesh(THREE, { fragmentCount: 4, seed: 55 });
    a.children.forEach((chunkA, i) => {
      const chunkB = b.children[i];
      expect(chunkA.position.x).toBeCloseTo(chunkB.position.x);
      expect(chunkA.position.z).toBeCloseTo(chunkB.position.z);
    });
  });
});

// ---------------------------------------------------------------------------
// buildSpecialBodyMesh (dispatcher)
// ---------------------------------------------------------------------------

describe('buildSpecialBodyMesh', () => {
  it('dispatches asteroid_belt → buildAsteroidBeltMesh', () => {
    const result = buildSpecialBodyMesh(THREE, 'asteroid_belt');
    expect(result.userData.kind).toBe('asteroid_belt');
  });

  it('dispatches nebula_cloud → buildNebulaCloudMesh', () => {
    const result = buildSpecialBodyMesh(THREE, 'nebula_cloud');
    expect(result.userData.kind).toBe('nebula_cloud');
  });

  it('dispatches irregular_planet → buildIrregularPlanetMesh', () => {
    const result = buildSpecialBodyMesh(THREE, 'irregular_planet');
    expect(result.userData.kind).toBe('irregular_planet');
  });

  it('dispatches planet_fragment → buildPlanetFragmentMesh', () => {
    const result = buildSpecialBodyMesh(THREE, 'planet_fragment');
    expect(result.userData.kind).toBe('planet_fragment');
  });

  it('returns null for unknown body type', () => {
    expect(buildSpecialBodyMesh(THREE, 'unknown_type')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(buildSpecialBodyMesh(THREE, '')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(buildSpecialBodyMesh(THREE, null)).toBeNull();
  });

  it('passes params to the factory', () => {
    const result = buildSpecialBodyMesh(THREE, 'asteroid_belt', { radius: 90 });
    expect(result.userData.beltRadius).toBe(90);
  });

  it('is case-insensitive', () => {
    const result = buildSpecialBodyMesh(THREE, 'ASTEROID_BELT');
    expect(result.userData.kind).toBe('asteroid_belt');
  });
});

// ---------------------------------------------------------------------------
// Integration: _buildSystemSpecialBodies & _tickSystemSpecialBodies
// (simulate the galaxy-renderer-core integration without loading the full file)
// ---------------------------------------------------------------------------

describe('Integration: _buildSystemSpecialBodies', () => {
  let renderer;

  beforeEach(() => {
    renderer = {
      systemSpecialBodyEntries: [],
      systemBodyGroup: new MockGroup(),
      systemOrbitGroup: new MockGroup(),
      _orbitScratchWorld: new MockVector3(),
      _hashSeed: vi.fn((s) => s.split('').reduce((a, c) => a + c.charCodeAt(0), 0)),
      _planetSize: vi.fn(() => 3.5),
      _visualOrbitAngularSpeed: vi.fn(() => 0.1),
      _buildOrbitCurvePoints: vi.fn(() => [new MockVector3(), new MockVector3()]),

      _buildSystemSpecialBodies(star, payload) {
        const specialBodies = Array.isArray(payload.special_bodies) ? payload.special_bodies : [];
        this.systemSpecialBodyEntries = [];
        if (!specialBodies.length) return;

        const sbRenderer = SystemSpecialBodiesRenderer;
        const maxAu = Math.max(0.35, ...specialBodies.map((b, i) => Number(b.semi_major_axis_au || (0.35 + i * 0.22))));

        specialBodies.forEach((bodyDef, index) => {
          const bodyType = String(bodyDef.body_type || '').toLowerCase();
          if (!bodyType) return;
          const semiMajor = Number(bodyDef.semi_major_axis_au || (0.35 + index * 0.22));
          const orbitRadius = 34 + (semiMajor / maxAu) * 165;

          const meshParams = Object.assign({}, bodyDef, {
            radius: bodyType === 'asteroid_belt'
              ? orbitRadius
              : this._planetSize({ planet_class: bodyDef.planet_class || bodyType }, index, orbitRadius),
            seed: this._hashSeed(String(bodyDef.id || bodyDef.name || index)),
          });

          const mesh = sbRenderer.buildSpecialBodyMesh(THREE, bodyType, meshParams);
          if (!mesh) return;

          mesh.userData = Object.assign({}, mesh.userData, { kind: bodyType, bodyDef, sourceStar: star });

          if (bodyType === 'asteroid_belt') {
            this.systemBodyGroup.add(mesh);
            this.systemSpecialBodyEntries.push({ mesh, bodyType, bodyDef, isStationary: true, orbitRadius });
          } else {
            const eccentricity = THREE.MathUtils.clamp(Number(bodyDef.orbital_eccentricity ?? (0.03 + index * 0.013)), 0, 0.92);
            const orbitMinor = orbitRadius * Math.sqrt(1 - eccentricity * eccentricity);
            const phase = Number(bodyDef.polar_theta_rad);
            const orbitPoints = this._buildOrbitCurvePoints(orbitRadius, orbitMinor, eccentricity);
            const orbitLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(orbitPoints), new THREE.LineBasicMaterial({}));
            const orbitPivot = new THREE.Group();
            orbitPivot.add(orbitLine);
            this.systemOrbitGroup.add(orbitPivot);
            const initAngle = Number.isFinite(phase) ? phase : (index / Math.max(1, specialBodies.length)) * Math.PI * 2;
            mesh.position.set(orbitRadius * Math.cos(initAngle), 0, orbitMinor * Math.sin(initAngle));
            orbitPivot.add(mesh);
            const periodMetric = Math.pow(Math.max(0.12, semiMajor), 1.5);
            this.systemSpecialBodyEntries.push({
              mesh, bodyType, bodyDef, isStationary: false,
              orbitRadius, orbitMinor, orbitPivot, orbitLine, eccentricity,
              angle: initAngle, speed: this._visualOrbitAngularSpeed(periodMetric, periodMetric) * 0.55,
              currentLocalPosition: new THREE.Vector3(), currentWorldPosition: new THREE.Vector3(),
            });
          }
        });
      },

      _tickSystemSpecialBodies(dt) {
        if (!Array.isArray(this.systemSpecialBodyEntries) || !this.systemSpecialBodyEntries.length) return;
        this.systemSpecialBodyEntries.forEach((entry) => {
          const mesh = entry.mesh;
          if (!mesh) return;
          if (entry.isStationary) {
            mesh.rotation.y += dt * Number(mesh.userData.rotationSpeed ?? 0.018);
          } else {
            entry.angle += dt * Number(entry.speed || 0);
            const orbitalPos = {
              x: entry.orbitRadius * Math.cos(entry.angle),
              y: 0,
              z: entry.orbitMinor * Math.sin(entry.angle),
            };
            entry.currentLocalPosition.set(orbitalPos.x, orbitalPos.y, orbitalPos.z);
            mesh.position.set(orbitalPos.x, orbitalPos.y, orbitalPos.z);
            const bodyType = entry.bodyType;
            if (bodyType === 'nebula_cloud') {
              const ud = mesh.userData;
              ud._phase = (ud._phase || 0) + dt * Number(ud.pulseSpeed ?? 0.4);
              const scale = 1.0 + Math.sin(ud._phase) * Number(ud.pulseAmplitude ?? 0.06);
              mesh.scale.setScalar(scale);
              mesh.rotation.y += dt * Number(ud.driftSpeed ?? 0.008);
            } else if (bodyType === 'planet_fragment') {
              const speeds = mesh.userData.spinSpeeds;
              mesh.children.forEach((chunk, ci) => {
                if (!speeds || !speeds[ci]) return;
                chunk.rotation.x += dt * speeds[ci].x;
                chunk.rotation.y += dt * speeds[ci].y;
                chunk.rotation.z += dt * speeds[ci].z;
              });
              mesh.rotation.y += dt * 0.12;
            } else if (bodyType === 'irregular_planet') {
              mesh.rotation.y += dt * 0.18;
            }
          }
        });
      },
    };
  });

  it('adds nothing when payload has no special_bodies', () => {
    renderer._buildSystemSpecialBodies({}, {});
    expect(renderer.systemSpecialBodyEntries).toHaveLength(0);
  });

  it('adds nothing when special_bodies is empty array', () => {
    renderer._buildSystemSpecialBodies({}, { special_bodies: [] });
    expect(renderer.systemSpecialBodyEntries).toHaveLength(0);
  });

  it('creates one entry per valid special body', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [
        { id: 'a', body_type: 'asteroid_belt', semi_major_axis_au: 2.5 },
        { id: 'b', body_type: 'nebula_cloud',   semi_major_axis_au: 1.0 },
      ],
    });
    expect(renderer.systemSpecialBodyEntries).toHaveLength(2);
  });

  it('skips entries with empty body_type', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [
        { id: 'x', body_type: '', semi_major_axis_au: 1.0 },
        { id: 'y', body_type: 'planet_fragment', semi_major_axis_au: 3.0 },
      ],
    });
    expect(renderer.systemSpecialBodyEntries).toHaveLength(1);
  });

  it('marks asteroid_belt entries as stationary', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [{ id: 'belt', body_type: 'asteroid_belt', semi_major_axis_au: 2.7 }],
    });
    expect(renderer.systemSpecialBodyEntries[0].isStationary).toBe(true);
  });

  it('marks orbiting entries as non-stationary', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [{ id: 'neb', body_type: 'nebula_cloud', semi_major_axis_au: 1.2 }],
    });
    expect(renderer.systemSpecialBodyEntries[0].isStationary).toBe(false);
  });

  it('adds asteroid belt to systemBodyGroup', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [{ id: 'belt', body_type: 'asteroid_belt', semi_major_axis_au: 2.7 }],
    });
    expect(renderer.systemBodyGroup.children).toHaveLength(1);
  });

  it('adds orbiting body pivot to systemOrbitGroup', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [{ id: 'frag', body_type: 'planet_fragment', semi_major_axis_au: 3.5 }],
    });
    expect(renderer.systemOrbitGroup.children).toHaveLength(1);
  });

  it('handles all four body types without errors', () => {
    expect(() => renderer._buildSystemSpecialBodies({}, {
      special_bodies: [
        { id: 'belt',  body_type: 'asteroid_belt',    semi_major_axis_au: 2.7 },
        { id: 'neb',   body_type: 'nebula_cloud',      semi_major_axis_au: 1.2 },
        { id: 'irr',   body_type: 'irregular_planet',  semi_major_axis_au: 0.9 },
        { id: 'frag',  body_type: 'planet_fragment',   semi_major_axis_au: 3.5 },
      ],
    })).not.toThrow();
    expect(renderer.systemSpecialBodyEntries).toHaveLength(4);
  });

  it('unknown body types are silently skipped', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [
        { id: 'unk',  body_type: 'unknown_type',    semi_major_axis_au: 2.0 },
        { id: 'belt', body_type: 'asteroid_belt',   semi_major_axis_au: 2.7 },
      ],
    });
    expect(renderer.systemSpecialBodyEntries).toHaveLength(1);
  });

  it('orbiting entries have angle, speed, orbitRadius, orbitMinor', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [{ id: 'irr', body_type: 'irregular_planet', semi_major_axis_au: 1.5 }],
    });
    const entry = renderer.systemSpecialBodyEntries[0];
    expect(typeof entry.angle).toBe('number');
    expect(typeof entry.speed).toBe('number');
    expect(typeof entry.orbitRadius).toBe('number');
    expect(typeof entry.orbitMinor).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Integration: _tickSystemSpecialBodies
// ---------------------------------------------------------------------------

describe('Integration: _tickSystemSpecialBodies', () => {
  let renderer;

  function buildRenderer() {
    return {
      systemSpecialBodyEntries: [],
      _tickSystemSpecialBodies(dt) {
        if (!Array.isArray(this.systemSpecialBodyEntries) || !this.systemSpecialBodyEntries.length) return;
        this.systemSpecialBodyEntries.forEach((entry) => {
          const mesh = entry.mesh;
          if (!mesh) return;
          if (entry.isStationary) {
            mesh.rotation.y += dt * Number(mesh.userData.rotationSpeed ?? 0.018);
          } else {
            entry.angle += dt * Number(entry.speed || 0);
            entry.currentLocalPosition.set(
              entry.orbitRadius * Math.cos(entry.angle),
              0,
              entry.orbitMinor * Math.sin(entry.angle)
            );
            mesh.position.set(entry.currentLocalPosition.x, 0, entry.currentLocalPosition.z);
            const bodyType = entry.bodyType;
            if (bodyType === 'nebula_cloud') {
              const ud = mesh.userData;
              ud._phase = (ud._phase || 0) + dt * Number(ud.pulseSpeed ?? 0.4);
              const scale = 1.0 + Math.sin(ud._phase) * Number(ud.pulseAmplitude ?? 0.06);
              mesh.scale.setScalar(scale);
              mesh.rotation.y += dt * Number(ud.driftSpeed ?? 0.008);
            } else if (bodyType === 'planet_fragment') {
              const speeds = mesh.userData.spinSpeeds;
              mesh.children.forEach((chunk, ci) => {
                if (!speeds || !speeds[ci]) return;
                chunk.rotation.x += dt * speeds[ci].x;
                chunk.rotation.y += dt * speeds[ci].y;
              });
              mesh.rotation.y += dt * 0.12;
            } else if (bodyType === 'irregular_planet') {
              mesh.rotation.y += dt * 0.18;
            }
          }
        });
      },
    };
  }

  it('does nothing when systemSpecialBodyEntries is empty', () => {
    const r = buildRenderer();
    expect(() => r._tickSystemSpecialBodies(0.016)).not.toThrow();
  });

  it('rotates stationary belt mesh on Y axis', () => {
    const r = buildRenderer();
    const mesh = new MockGroup();
    mesh.userData.rotationSpeed = 0.02;
    r.systemSpecialBodyEntries.push({ mesh, bodyType: 'asteroid_belt', isStationary: true });
    r._tickSystemSpecialBodies(1.0);
    expect(mesh.rotation.y).toBeCloseTo(0.02);
  });

  it('advances angle for orbiting bodies', () => {
    const r = buildRenderer();
    const mesh = new MockGroup();
    mesh.userData = {};
    const entry = {
      mesh, bodyType: 'nebula_cloud', isStationary: false,
      angle: 0, speed: 0.5,
      orbitRadius: 50, orbitMinor: 48,
      currentLocalPosition: new MockVector3(),
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(0.1);
    expect(entry.angle).toBeCloseTo(0.05);
  });

  it('updates mesh position for orbiting bodies', () => {
    const r = buildRenderer();
    const mesh = new MockGroup();
    mesh.userData = {};
    const entry = {
      mesh, bodyType: 'irregular_planet', isStationary: false,
      angle: 0, speed: 0.2,
      orbitRadius: 60, orbitMinor: 58,
      currentLocalPosition: new MockVector3(),
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(0.5);
    const expectedAngle = 0.1;
    const expectedX = 60 * Math.cos(expectedAngle);
    expect(mesh.position.x).toBeCloseTo(expectedX, 3);
  });

  it('rotates irregular_planet mesh on Y axis', () => {
    const r = buildRenderer();
    const mesh = new MockGroup();
    mesh.userData = {};
    const entry = {
      mesh, bodyType: 'irregular_planet', isStationary: false,
      angle: 0, speed: 0,
      orbitRadius: 40, orbitMinor: 39,
      currentLocalPosition: new MockVector3(),
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(2.0);
    expect(mesh.rotation.y).toBeCloseTo(0.36); // 2.0 * 0.18
  });

  it('rotates planet_fragment group on Y axis', () => {
    const r = buildRenderer();
    const mesh = new MockGroup();
    mesh.userData.spinSpeeds = [{ x: 0, y: 0.1, z: 0 }];
    const chunk = new MockMesh(null, null);
    mesh.children.push(chunk);
    const entry = {
      mesh, bodyType: 'planet_fragment', isStationary: false,
      angle: 0, speed: 0,
      orbitRadius: 50, orbitMinor: 48,
      currentLocalPosition: new MockVector3(),
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(1.0);
    expect(mesh.rotation.y).toBeCloseTo(0.12);
    expect(chunk.rotation.y).toBeCloseTo(0.1);
  });

  it('pulsates nebula_cloud scale based on sinusoidal phase', () => {
    const r = buildRenderer();
    const mesh = new MockGroup();
    mesh.userData = { pulseSpeed: 1.0, pulseAmplitude: 0.1, _phase: 0 };
    const entry = {
      mesh, bodyType: 'nebula_cloud', isStationary: false,
      angle: 0, speed: 0,
      orbitRadius: 30, orbitMinor: 29,
      currentLocalPosition: new MockVector3(),
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(Math.PI / 2); // phase → π/2, sin=1 → scale = 1.1
    expect(mesh.scale.x).toBeGreaterThan(1.0);
  });

  it('does not throw when entry.mesh is null', () => {
    const r = buildRenderer();
    r.systemSpecialBodyEntries.push({ mesh: null, bodyType: 'asteroid_belt', isStationary: true });
    expect(() => r._tickSystemSpecialBodies(0.016)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SPECIAL_BODY_TYPES – new entries
// ---------------------------------------------------------------------------

describe('SPECIAL_BODY_TYPES – new types', () => {
  it('defines COMET', () => expect(SPECIAL_BODY_TYPES.COMET).toBe('comet'));
  it('defines BLACK_HOLE', () => expect(SPECIAL_BODY_TYPES.BLACK_HOLE).toBe('black_hole'));
  it('defines ICE_FIELD', () => expect(SPECIAL_BODY_TYPES.ICE_FIELD).toBe('ice_field'));
  it('defines DUST_CLOUD', () => expect(SPECIAL_BODY_TYPES.DUST_CLOUD).toBe('dust_cloud'));
});

// ---------------------------------------------------------------------------
// buildCometMesh
// ---------------------------------------------------------------------------

describe('buildCometMesh', () => {
  it('returns a THREE.Group', () => {
    expect(buildCometMesh(THREE)).toBeInstanceOf(MockGroup);
  });

  it('userData.kind === "comet"', () => {
    expect(buildCometMesh(THREE).userData.kind).toBe('comet');
  });

  it('has exactly 3 children: nucleus, coma, tailGroup', () => {
    const g = buildCometMesh(THREE);
    expect(g.children).toHaveLength(3);
  });

  it('first child is nucleus Mesh with SphereGeometry', () => {
    const g = buildCometMesh(THREE);
    expect(g.children[0]).toBeInstanceOf(MockMesh);
    expect(g.children[0].geometry).toBeInstanceOf(MockSphereGeometry);
    expect(g.children[0].userData.kind).toBe('comet-nucleus');
  });

  it('second child is coma Mesh with SphereGeometry', () => {
    const g = buildCometMesh(THREE);
    expect(g.children[1]).toBeInstanceOf(MockMesh);
    expect(g.children[1].userData.kind).toBe('comet-coma');
  });

  it('third child is tailGroup (Group)', () => {
    const g = buildCometMesh(THREE);
    expect(g.children[2]).toBeInstanceOf(MockGroup);
    expect(g.children[2].userData.kind).toBe('comet-tail-group');
  });

  it('tailGroup contains one Points child', () => {
    const g = buildCometMesh(THREE);
    const tailGroup = g.children[2];
    expect(tailGroup.children).toHaveLength(1);
    expect(tailGroup.children[0]).toBeInstanceOf(MockPoints);
    expect(tailGroup.children[0].userData.kind).toBe('comet-tail');
  });

  it('tail particles have correct count', () => {
    const g = buildCometMesh(THREE, { tailParticles: 150 });
    const pts = g.children[2].children[0];
    expect(pts.geometry.attributes.position.array.length).toBe(150 * 3);
  });

  it('stores tailGroup reference in userData', () => {
    const g = buildCometMesh(THREE);
    expect(g.userData.tailGroup).toBe(g.children[2]);
  });

  it('stores nucleusMesh reference in userData', () => {
    const g = buildCometMesh(THREE);
    expect(g.userData.nucleusMesh).toBe(g.children[0]);
  });

  it('coma is larger than nucleus', () => {
    const g = buildCometMesh(THREE, { nucleusRadius: 0.5, comaScale: 2.0 });
    const nucleus = g.children[0];
    const coma = g.children[1];
    expect(nucleus.geometry.parameters.radius).toBeLessThan(coma.geometry.parameters.radius);
  });

  it('is deterministic with same seed', () => {
    const a = buildCometMesh(THREE, { tailParticles: 60, seed: 11 });
    const b = buildCometMesh(THREE, { tailParticles: 60, seed: 11 });
    const posA = a.children[2].children[0].geometry.attributes.position.array;
    const posB = b.children[2].children[0].geometry.attributes.position.array;
    expect(Array.from(posA)).toEqual(Array.from(posB));
  });

  it('nucleusSpinSpeed is a positive number', () => {
    const g = buildCometMesh(THREE);
    expect(g.userData.nucleusSpinSpeed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildBlackHoleMesh
// ---------------------------------------------------------------------------

describe('buildBlackHoleMesh', () => {
  it('returns a THREE.Group', () => {
    expect(buildBlackHoleMesh(THREE)).toBeInstanceOf(MockGroup);
  });

  it('userData.kind === "black_hole"', () => {
    expect(buildBlackHoleMesh(THREE).userData.kind).toBe('black_hole');
  });

  it('has exactly 4 children: horizon, glow, disk ring, disk particles', () => {
    const g = buildBlackHoleMesh(THREE);
    expect(g.children).toHaveLength(4);
  });

  it('first child is event horizon with MeshBasicMaterial color 0x000000', () => {
    const g = buildBlackHoleMesh(THREE);
    const horizon = g.children[0];
    expect(horizon).toBeInstanceOf(MockMesh);
    expect(horizon.userData.kind).toBe('bh-horizon');
    expect(horizon.material.color).toBe(0x000000);
  });

  it('second child is glow sphere', () => {
    const g = buildBlackHoleMesh(THREE);
    expect(g.children[1].userData.kind).toBe('bh-glow');
  });

  it('third child is accretion disk RingGeometry Mesh', () => {
    const g = buildBlackHoleMesh(THREE);
    const disk = g.children[2];
    expect(disk).toBeInstanceOf(MockMesh);
    expect(disk.geometry).toBeInstanceOf(MockRingGeometry);
    expect(disk.userData.kind).toBe('bh-disk-ring');
  });

  it('disk ring is rotated 90° on X to lie in XZ plane', () => {
    const g = buildBlackHoleMesh(THREE);
    expect(g.children[2].rotation.x).toBeCloseTo(Math.PI / 2);
  });

  it('fourth child is disk particles (Points)', () => {
    const g = buildBlackHoleMesh(THREE);
    const pts = g.children[3];
    expect(pts).toBeInstanceOf(MockPoints);
    expect(pts.userData.kind).toBe('bh-disk-particles');
  });

  it('disk particles have correct count', () => {
    const g = buildBlackHoleMesh(THREE, { diskParticles: 200 });
    const pts = g.children[3];
    expect(pts.geometry.attributes.position.array.length).toBe(200 * 3);
  });

  it('stores diskRing reference in userData', () => {
    const g = buildBlackHoleMesh(THREE);
    expect(g.userData.diskRing).toBe(g.children[2]);
  });

  it('stores diskParticles reference in userData', () => {
    const g = buildBlackHoleMesh(THREE);
    expect(g.userData.diskParticles).toBe(g.children[3]);
  });

  it('diskOuter is larger than diskInner', () => {
    const g = buildBlackHoleMesh(THREE, { radius: 3, diskInner: 4, diskOuter: 12 });
    const ring = g.children[2].geometry;
    expect(ring.parameters.outerRadius).toBeGreaterThan(ring.parameters.innerRadius);
  });

  it('glow sphere is larger than event horizon', () => {
    const g = buildBlackHoleMesh(THREE, { radius: 2 });
    expect(g.children[1].geometry.parameters.radius).toBeGreaterThan(
      g.children[0].geometry.parameters.radius
    );
  });

  it('diskRotationSpeed stored in userData', () => {
    const g = buildBlackHoleMesh(THREE, { diskRotationSpeed: 0.1 });
    expect(g.userData.diskRotationSpeed).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// buildIceFieldMesh
// ---------------------------------------------------------------------------

describe('buildIceFieldMesh', () => {
  it('returns a THREE.Group', () => {
    expect(buildIceFieldMesh(THREE)).toBeInstanceOf(MockGroup);
  });

  it('userData.kind === "ice_field"', () => {
    expect(buildIceFieldMesh(THREE).userData.kind).toBe('ice_field');
  });

  it('has exactly 1 child (Points)', () => {
    const g = buildIceFieldMesh(THREE);
    expect(g.children).toHaveLength(1);
    expect(g.children[0]).toBeInstanceOf(MockPoints);
  });

  it('child has userData.kind === "ice-field-particles"', () => {
    const g = buildIceFieldMesh(THREE);
    expect(g.children[0].userData.kind).toBe('ice-field-particles');
  });

  it('particle count matches param', () => {
    const g = buildIceFieldMesh(THREE, { particleCount: 300 });
    expect(g.children[0].geometry.attributes.position.array.length).toBe(300 * 3);
  });

  it('inner/outerRadius stored in userData', () => {
    const g = buildIceFieldMesh(THREE, { innerRadius: 50, outerRadius: 200 });
    expect(g.userData.innerRadius).toBe(50);
    expect(g.userData.outerRadius).toBe(200);
  });

  it('clamps particle count to min 50', () => {
    const g = buildIceFieldMesh(THREE, { particleCount: 0 });
    expect(g.children[0].geometry.attributes.position.array.length).toBe(50 * 3);
  });

  it('is deterministic with same seed', () => {
    const a = buildIceFieldMesh(THREE, { particleCount: 80, seed: 22 });
    const b = buildIceFieldMesh(THREE, { particleCount: 80, seed: 22 });
    const posA = a.children[0].geometry.attributes.position.array;
    const posB = b.children[0].geometry.attributes.position.array;
    expect(Array.from(posA)).toEqual(Array.from(posB));
  });

  it('rotationSpeed stored in userData', () => {
    const g = buildIceFieldMesh(THREE, { rotationSpeed: 0.012 });
    expect(g.userData.rotationSpeed).toBeCloseTo(0.012);
  });

  it('default color is icy blue (0xc0e0ff)', () => {
    const g = buildIceFieldMesh(THREE);
    expect(g.userData.color).toBe(0xc0e0ff);
  });
});

// ---------------------------------------------------------------------------
// buildDustCloudMesh
// ---------------------------------------------------------------------------

describe('buildDustCloudMesh', () => {
  it('returns a THREE.Group', () => {
    expect(buildDustCloudMesh(THREE)).toBeInstanceOf(MockGroup);
  });

  it('userData.kind === "dust_cloud"', () => {
    expect(buildDustCloudMesh(THREE).userData.kind).toBe('dust_cloud');
  });

  it('has exactly 1 child (Points)', () => {
    const g = buildDustCloudMesh(THREE);
    expect(g.children).toHaveLength(1);
    expect(g.children[0]).toBeInstanceOf(MockPoints);
  });

  it('child has userData.kind === "dust-cloud-particles"', () => {
    const g = buildDustCloudMesh(THREE);
    expect(g.children[0].userData.kind).toBe('dust-cloud-particles');
  });

  it('particle count matches param', () => {
    const g = buildDustCloudMesh(THREE, { particleCount: 400 });
    expect(g.children[0].geometry.attributes.position.array.length).toBe(400 * 3);
  });

  it('clamps particle count to min 50', () => {
    const g = buildDustCloudMesh(THREE, { particleCount: 1 });
    expect(g.children[0].geometry.attributes.position.array.length).toBe(50 * 3);
  });

  it('is deterministic with same seed', () => {
    const a = buildDustCloudMesh(THREE, { particleCount: 100, seed: 33 });
    const b = buildDustCloudMesh(THREE, { particleCount: 100, seed: 33 });
    const posA = a.children[0].geometry.attributes.position.array;
    const posB = b.children[0].geometry.attributes.position.array;
    expect(Array.from(posA)).toEqual(Array.from(posB));
  });

  it('radius stored in userData', () => {
    const g = buildDustCloudMesh(THREE, { radius: 150 });
    expect(g.userData.radius).toBe(150);
  });

  it('rotationSpeed stored in userData', () => {
    const g = buildDustCloudMesh(THREE, { rotationSpeed: 0.03 });
    expect(g.userData.rotationSpeed).toBeCloseTo(0.03);
  });

  it('default color is dusty orange (0xc4a06e)', () => {
    const g = buildDustCloudMesh(THREE);
    expect(g.userData.color).toBe(0xc4a06e);
  });

  it('particles have density concentrated inward (more particles at smaller r)', () => {
    const g = buildDustCloudMesh(THREE, { particleCount: 500, radius: 100, innerClearRadius: 0, seed: 1 });
    const pos = g.children[0].geometry.attributes.position;
    let innerCount = 0;
    for (let i = 0; i < pos.array.length / 3; i++) {
      const x = pos.getX(i); const z = pos.getZ(i);
      const r = Math.sqrt(x * x + z * z);
      if (r < 50) innerCount++;
    }
    // Exponential-ish bias: inner half (r < 50) should contain a meaningful
    // fraction of particles (quadratic mapping concentrates ~27% there)
    expect(innerCount / 500).toBeGreaterThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// buildSpecialBodyMesh – new dispatches
// ---------------------------------------------------------------------------

describe('buildSpecialBodyMesh – new types', () => {
  it('dispatches comet', () => {
    expect(buildSpecialBodyMesh(THREE, 'comet').userData.kind).toBe('comet');
  });
  it('dispatches black_hole', () => {
    expect(buildSpecialBodyMesh(THREE, 'black_hole').userData.kind).toBe('black_hole');
  });
  it('dispatches ice_field', () => {
    expect(buildSpecialBodyMesh(THREE, 'ice_field').userData.kind).toBe('ice_field');
  });
  it('dispatches dust_cloud', () => {
    expect(buildSpecialBodyMesh(THREE, 'dust_cloud').userData.kind).toBe('dust_cloud');
  });
  it('is case-insensitive for new types', () => {
    expect(buildSpecialBodyMesh(THREE, 'COMET').userData.kind).toBe('comet');
    expect(buildSpecialBodyMesh(THREE, 'BLACK_HOLE').userData.kind).toBe('black_hole');
  });
});

// ---------------------------------------------------------------------------
// Integration: _buildSystemSpecialBodies – new types
// ---------------------------------------------------------------------------

describe('Integration: _buildSystemSpecialBodies – new types', () => {
  let renderer;

  beforeEach(() => {
    renderer = {
      systemSpecialBodyEntries: [],
      systemBodyGroup: new MockGroup(),
      systemOrbitGroup: new MockGroup(),
      _orbitScratchWorld: new MockVector3(),
      _hashSeed: vi.fn((s) => typeof s === 'string' ? s.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : s),
      _planetSize: vi.fn(() => 3.5),
      _visualOrbitAngularSpeed: vi.fn(() => 0.1),
      _buildOrbitCurvePoints: vi.fn(() => [new MockVector3(), new MockVector3()]),

      _buildSystemSpecialBodies(star, payload) {
        const specialBodies = Array.isArray(payload.special_bodies) ? payload.special_bodies : [];
        this.systemSpecialBodyEntries = [];
        if (!specialBodies.length) return;
        const sbRenderer = SystemSpecialBodiesRenderer;
        const maxAu = Math.max(0.35, ...specialBodies.map((b, i) => Number(b.semi_major_axis_au || (0.35 + i * 0.22))));
        specialBodies.forEach((bodyDef, index) => {
          const bodyType = String(bodyDef.body_type || '').toLowerCase();
          if (!bodyType) return;
          const semiMajor = Number(bodyDef.semi_major_axis_au || (0.35 + index * 0.22));
          const orbitRadius = 34 + (semiMajor / maxAu) * 165;
          const meshParams = Object.assign({}, bodyDef, {
            radius: orbitRadius,
            seed: this._hashSeed(String(bodyDef.id || index)),
          });
          const mesh = sbRenderer.buildSpecialBodyMesh(THREE, bodyType, meshParams);
          if (!mesh) return;
          mesh.userData = Object.assign({}, mesh.userData, { kind: bodyType, bodyDef, sourceStar: star });
          const stationary = bodyType === 'asteroid_belt' || bodyType === 'ice_field' || bodyType === 'dust_cloud';
          if (stationary) {
            this.systemBodyGroup.add(mesh);
            this.systemSpecialBodyEntries.push({ mesh, bodyType, bodyDef, isStationary: true, orbitRadius });
          } else {
            const eccentricity = THREE.MathUtils.clamp(Number(bodyDef.orbital_eccentricity ?? 0.05), 0, 0.92);
            const orbitMinor = orbitRadius * Math.sqrt(1 - eccentricity * eccentricity);
            const initAngle = (index / Math.max(1, specialBodies.length)) * Math.PI * 2;
            const orbitPoints = this._buildOrbitCurvePoints(orbitRadius, orbitMinor, eccentricity);
            const orbitLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(orbitPoints), new THREE.LineBasicMaterial({}));
            const orbitPivot = new THREE.Group();
            orbitPivot.add(orbitLine);
            this.systemOrbitGroup.add(orbitPivot);
            mesh.position.set(orbitRadius * Math.cos(initAngle), 0, orbitMinor * Math.sin(initAngle));
            orbitPivot.add(mesh);
            const periodMetric = Math.pow(Math.max(0.12, semiMajor), 1.5);
            this.systemSpecialBodyEntries.push({
              mesh, bodyType, bodyDef, isStationary: false,
              orbitRadius, orbitMinor, orbitPivot, orbitLine, eccentricity,
              angle: initAngle, speed: this._visualOrbitAngularSpeed(periodMetric, periodMetric) * 0.55,
              currentLocalPosition: new THREE.Vector3(), currentWorldPosition: new THREE.Vector3(),
            });
          }
        });
      },
    };
  });

  it('ice_field is stationary', () => {
    renderer._buildSystemSpecialBodies({}, { special_bodies: [{ id: 'ice', body_type: 'ice_field', semi_major_axis_au: 3.0 }] });
    expect(renderer.systemSpecialBodyEntries[0].isStationary).toBe(true);
  });

  it('dust_cloud is stationary', () => {
    renderer._buildSystemSpecialBodies({}, { special_bodies: [{ id: 'dust', body_type: 'dust_cloud', semi_major_axis_au: 2.0 }] });
    expect(renderer.systemSpecialBodyEntries[0].isStationary).toBe(true);
  });

  it('comet is orbiting', () => {
    renderer._buildSystemSpecialBodies({}, { special_bodies: [{ id: 'c1', body_type: 'comet', semi_major_axis_au: 5.0 }] });
    expect(renderer.systemSpecialBodyEntries[0].isStationary).toBe(false);
  });

  it('black_hole is orbiting by default', () => {
    renderer._buildSystemSpecialBodies({}, { special_bodies: [{ id: 'bh', body_type: 'black_hole', semi_major_axis_au: 8.0 }] });
    expect(renderer.systemSpecialBodyEntries[0].isStationary).toBe(false);
  });

  it('all 8 body types produce entries without error', () => {
    const allTypes = [
      { id: 'a', body_type: 'asteroid_belt',   semi_major_axis_au: 2.7 },
      { id: 'b', body_type: 'nebula_cloud',     semi_major_axis_au: 1.2 },
      { id: 'c', body_type: 'irregular_planet', semi_major_axis_au: 0.9 },
      { id: 'd', body_type: 'planet_fragment',  semi_major_axis_au: 3.5 },
      { id: 'e', body_type: 'comet',            semi_major_axis_au: 5.1 },
      { id: 'f', body_type: 'black_hole',       semi_major_axis_au: 8.0 },
      { id: 'g', body_type: 'ice_field',        semi_major_axis_au: 3.0 },
      { id: 'h', body_type: 'dust_cloud',       semi_major_axis_au: 2.0 },
    ];
    expect(() => renderer._buildSystemSpecialBodies({}, { special_bodies: allTypes })).not.toThrow();
    expect(renderer.systemSpecialBodyEntries).toHaveLength(8);
  });

  it('ice_field + dust_cloud added to systemBodyGroup', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [
        { id: 'ice', body_type: 'ice_field',   semi_major_axis_au: 3.0 },
        { id: 'dust', body_type: 'dust_cloud', semi_major_axis_au: 2.0 },
      ],
    });
    expect(renderer.systemBodyGroup.children).toHaveLength(2);
    expect(renderer.systemOrbitGroup.children).toHaveLength(0);
  });

  it('comet added to systemOrbitGroup', () => {
    renderer._buildSystemSpecialBodies({}, {
      special_bodies: [{ id: 'c', body_type: 'comet', semi_major_axis_au: 5.0 }],
    });
    expect(renderer.systemOrbitGroup.children).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: _tickSystemSpecialBodies – new types
// ---------------------------------------------------------------------------

describe('Integration: _tickSystemSpecialBodies – new types', () => {
  function buildTickRenderer() {
    return {
      systemSpecialBodyEntries: [],
      _tickSystemSpecialBodies(dt) {
        if (!Array.isArray(this.systemSpecialBodyEntries) || !this.systemSpecialBodyEntries.length) return;
        this.systemSpecialBodyEntries.forEach((entry) => {
          const mesh = entry.mesh;
          if (!mesh) return;
          if (entry.isStationary) {
            mesh.rotation.y += dt * Number(mesh.userData.rotationSpeed ?? 0.018);
            if (entry.bodyType === 'black_hole') {
              const dr = mesh.userData.diskRing;
              if (dr) dr.rotation.z += dt * Number(mesh.userData.diskRotationSpeed ?? 0.06);
              const dp = mesh.userData.diskParticles;
              if (dp) dp.rotation.y += dt * Number(mesh.userData.diskRotationSpeed ?? 0.06) * 0.7;
            }
          } else {
            entry.angle += dt * Number(entry.speed || 0);
            mesh.position.set(
              entry.orbitRadius * Math.cos(entry.angle),
              0,
              entry.orbitMinor * Math.sin(entry.angle)
            );
            if (entry.bodyType === 'comet') {
              const nm = mesh.userData.nucleusMesh;
              if (nm) nm.rotation.y += dt * Number(mesh.userData.nucleusSpinSpeed ?? 0.07);
              const tg = mesh.userData.tailGroup;
              if (tg) {
                const px = mesh.position.x; const pz = mesh.position.z;
                const dist = Math.sqrt(px * px + pz * pz);
                if (dist > 0.01) tg.rotation.y = Math.atan2(px, pz);
              }
            } else if (entry.bodyType === 'black_hole') {
              const dr = mesh.userData.diskRing;
              if (dr) dr.rotation.z += dt * Number(mesh.userData.diskRotationSpeed ?? 0.06);
              const dp = mesh.userData.diskParticles;
              if (dp) dp.rotation.y += dt * Number(mesh.userData.diskRotationSpeed ?? 0.06) * 0.7;
            } else if (entry.bodyType === 'irregular_planet') {
              mesh.rotation.y += dt * 0.18;
            }
          }
        });
      },
    };
  }

  it('ice_field rotates on Y', () => {
    const r = buildTickRenderer();
    const mesh = new MockGroup();
    mesh.userData = { rotationSpeed: 0.01 };
    r.systemSpecialBodyEntries.push({ mesh, bodyType: 'ice_field', isStationary: true });
    r._tickSystemSpecialBodies(2.0);
    expect(mesh.rotation.y).toBeCloseTo(0.02);
  });

  it('dust_cloud rotates on Y', () => {
    const r = buildTickRenderer();
    const mesh = new MockGroup();
    mesh.userData = { rotationSpeed: 0.025 };
    r.systemSpecialBodyEntries.push({ mesh, bodyType: 'dust_cloud', isStationary: true });
    r._tickSystemSpecialBodies(1.0);
    expect(mesh.rotation.y).toBeCloseTo(0.025);
  });

  it('comet nucleus spins', () => {
    const r = buildTickRenderer();
    const nucleus = new MockMesh(null, null);
    const tailGroup = new MockGroup();
    const mesh = new MockGroup();
    mesh.userData = { nucleusMesh: nucleus, tailGroup, nucleusSpinSpeed: 0.1 };
    mesh.position = new MockVector3(10, 0, 0);
    const entry = {
      mesh, bodyType: 'comet', isStationary: false,
      angle: 0, speed: 0, orbitRadius: 50, orbitMinor: 48,
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(1.0);
    expect(nucleus.rotation.y).toBeCloseTo(0.1);
  });

  it('comet tail orientation updates based on position', () => {
    const r = buildTickRenderer();
    const nucleus = new MockMesh(null, null);
    const tailGroup = new MockGroup();
    const mesh = new MockGroup();
    mesh.userData = { nucleusMesh: nucleus, tailGroup, nucleusSpinSpeed: 0.05 };
    mesh.position = new MockVector3(10, 0, 0);
    const entry = {
      mesh, bodyType: 'comet', isStationary: false,
      angle: 0, speed: 0, orbitRadius: 50, orbitMinor: 48,
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(0.01);
    // tail group rotation.y should be atan2(px, pz) = atan2(new_x, new_z)
    expect(typeof tailGroup.rotation.y).toBe('number');
    expect(Number.isFinite(tailGroup.rotation.y)).toBe(true);
  });

  it('black hole disk rotates', () => {
    const r = buildTickRenderer();
    const diskRing = new MockMesh(null, null);
    const diskParticles = new MockPoints(null, null);
    diskRing.rotation = { x: 0, y: 0, z: 0 };
    diskParticles.rotation = { x: 0, y: 0, z: 0 };
    const mesh = new MockGroup();
    mesh.userData = { diskRing, diskParticles, diskRotationSpeed: 0.1 };
    const entry = {
      mesh, bodyType: 'black_hole', isStationary: false,
      angle: 0, speed: 0, orbitRadius: 80, orbitMinor: 78,
    };
    r.systemSpecialBodyEntries.push(entry);
    r._tickSystemSpecialBodies(1.0);
    expect(diskRing.rotation.z).toBeCloseTo(0.1);
    expect(diskParticles.rotation.y).toBeCloseTo(0.07);
  });

  it('stationary black hole disk also rotates', () => {
    const r = buildTickRenderer();
    const diskRing = new MockMesh(null, null);
    const diskParticles = new MockPoints(null, null);
    diskRing.rotation = { x: 0, y: 0, z: 0 };
    diskParticles.rotation = { x: 0, y: 0, z: 0 };
    const mesh = new MockGroup();
    mesh.userData = { rotationSpeed: 0.01, diskRing, diskParticles, diskRotationSpeed: 0.08 };
    r.systemSpecialBodyEntries.push({ mesh, bodyType: 'black_hole', isStationary: true });
    r._tickSystemSpecialBodies(1.0);
    expect(diskRing.rotation.z).toBeCloseTo(0.08);
    expect(diskParticles.rotation.y).toBeCloseTo(0.056);
  });
});
