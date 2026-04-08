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
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
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

const THREE = {
  Vector3: MockVector3,
  Color: MockColor,
  BufferGeometry: MockBufferGeometry,
  BufferAttribute: MockBufferAttribute,
  SphereGeometry: MockSphereGeometry,
  TorusGeometry: MockTorusGeometry,
  PlaneGeometry: MockPlaneGeometry,
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
