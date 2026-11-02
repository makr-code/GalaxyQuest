import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

let renderer;
const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'];
const fleet = (extra = {}) => ({
  id: 'private-fleet-17', owner: 'private-owner', mission: 'attack', color: 0x829bad,
  vessels: [{ id: 'private-vessel-31', ship_type: 'frigate', sample_count: 1 }],
  ...extra,
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeAll(async () => {
  window.THREE = THREE;
  await import('../../js/engine/assets/WorldAssetDescriptor.js');
  await import('../../js/engine/assets/CoherentMaterialGenerator.js');
  await import('../../js/rendering/texture-manager.js');
  await import('../../js/rendering/material-factory.js');
  await import('../../js/engine/procedural/ProceduralMeshGenerator.js');
  await import('../../js/rendering/SystemSpecialBodiesRenderer.js');
  await import('../../js/rendering/galaxy-renderer-core.js');
});

beforeEach(() => {
  renderer = Object.create(window.GalaxyRendererCore.prototype);
  Object.assign(renderer, {
    textureManager: new window.GQTextureManager({ three: THREE }),
    materialFactory: new window.GQMaterialFactory({ three: THREE }),
    vesselGeometryCache: new Map(),
    systemFleetGroup: new THREE.Group(),
    systemTrafficGroup: new THREE.Group(),
    qualityProfile: { name: 'low' },
    opts: {},
  });
  vi.spyOn(renderer.textureManager, 'getCoherentMaterialBundleAsync').mockResolvedValue(null);
});

afterEach(() => {
  renderer._clearGroup(renderer.systemFleetGroup);
  renderer._clearGroup(renderer.systemTrafficGroup);
  renderer._clearGroup(renderer.systemBodyGroup);
  renderer.textureManager?.dispose();
  renderer.materialFactory?.dispose();
  for (const geometry of renderer.vesselGeometryCache.values()) geometry.dispose();
  vi.restoreAllMocks();
});

describe('active living-world fleet hulls', () => {
  it('builds painted metal with all five real maps and usable UVs, without lazy material allocation', () => {
    const request = vi.spyOn(renderer.textureManager, 'getCoherentMaterialBundle');
    const entry = renderer._buildFleetFormationEntry(fleet(), 0);
    const hull = entry.ships[0].mesh;
    expect(entry.mesh).toBe(entry.group);
    for (const name of maps) expect(hull.material[name]?.isDataTexture, name).toBe(true);
    expect(hull.geometry.getAttribute('uv').count).toBe(hull.geometry.getAttribute('position').count);
    expect(Array.from(hull.geometry.getAttribute('uv').array).every(Number.isFinite)).toBe(true);
    const descriptor = request.mock.calls[0][0];
    expect(descriptor.materialFamily).toBe('painted-metal');
    expect(JSON.stringify(descriptor)).not.toMatch(/private|owner|mission|damage|activity/);
    expect(hull.material.color.getHex()).toBe(0xffffff);
    expect(hull.material.bumpMap).toBeNull();
    expect([...renderer.textureManager.coherentTextureCache.values()][0].references).toBe(1);
  });

  it('keeps shape and maps stable across fleet order, vessel order, mission changes and reentry', () => {
    const source = fleet({ vessels: [
      { id: 'a', ship_type: 'fighter', sample_count: 1 },
      { id: 'b', ship_type: 'cargo', sample_count: 1 },
    ] });
    const first = renderer._buildFleetFormationEntry(source, 0);
    const signature = first.ships.map(({ mesh }) => ({
      positions: Array.from(mesh.geometry.getAttribute('position').array),
      pixels: Array.from(mesh.material.map.image.data),
    }));
    renderer._clearGroup(renderer.systemFleetGroup);
    const second = renderer._buildFleetFormationEntry({
      ...source, mission: 'transport', vessels: [...source.vessels].reverse(),
    }, 99);
    second.ships.reverse().forEach(({ mesh }, index) => {
      expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(signature[index].positions);
      expect(Array.from(mesh.material.map.image.data)).toEqual(signature[index].pixels);
    });
    const descriptors = new Set(Array.from({ length: 300 }, (_, id) =>
      JSON.stringify(renderer._shipMaterialDescriptor('cargo', renderer._vesselSeed({ id }, 'cargo'), 0x829bad))));
    expect(descriptors.size).toBeLessThanOrEqual(12);
  });

  it.each([[Infinity, 5], [NaN, 5], [-2, 0], [0, 0], [3.9, 15], [100000, 20]])('bounds untrusted sample counts (%s) at twenty hulls', (sample_count, expected) => {
    const entry = renderer._buildFleetFormationEntry(fleet({
      vessels: Array.from({ length: 8 }, () => ({ ship_type: 'frigate', sample_count })),
    }), 0);
    expect(entry.ships).toHaveLength(expected);
  });

  it('uses the same bounded geometry template even when different identities populate a cold cache first', () => {
    const first = renderer._proceduralVesselGeometry('cargo', 1);
    const positions = first.getAttribute('position').array.slice();
    renderer.vesselGeometryCache.clear();
    first.dispose();
    const next = renderer._proceduralVesselGeometry('cargo', 12);
    expect(next.getAttribute('position').array).toEqual(positions);
  });

  it('disposes nested materials once, preserves cached geometry/maps and releases retained bundles', () => {
    const entry = renderer._buildFleetFormationEntry(fleet(), 0);
    const hull = entry.ships[0].mesh;
    const materialDisposed = vi.fn();
    const geometryDisposed = vi.spyOn(hull.geometry, 'dispose');
    hull.material.addEventListener('dispose', materialDisposed);
    const retained = [...renderer.textureManager.coherentTextureCache.values()][0];
    renderer._clearGroup(renderer.systemFleetGroup);
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(geometryDisposed).not.toHaveBeenCalled();
    expect(retained.references).toBe(0);
    expect(renderer._buildFleetFormationEntry(fleet(), 1).ships[0].mesh.material.map.isDataTexture).toBe(true);
  });

  it('clears nested ownership once across duplicate meshes, materials and every PBR map slot', () => {
    const root = new THREE.Group();
    const nested = new THREE.Group();
    root.add(nested);
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const shared = new THREE.Texture();
    const sharedGeometry = new THREE.BoxGeometry();
    sharedGeometry.userData.sharedGeometry = true;
    const material = new THREE.MeshStandardMaterial();
    for (const slot of [...maps, 'bumpMap', 'aoMap', 'alphaMap']) material[slot] = texture;
    const sharedMaterial = new THREE.MeshStandardMaterial({ map: shared });
    sharedMaterial.userData.sharedTexture = true;
    const first = new THREE.Mesh(geometry, [material, material]);
    nested.add(first, new THREE.Mesh(geometry, material), new THREE.Mesh(sharedGeometry, sharedMaterial));
    const released = [geometry, texture, material, sharedMaterial].map(resource => vi.spyOn(resource, 'dispose'));
    const borrowed = [shared, sharedGeometry].map(resource => vi.spyOn(resource, 'dispose'));
    renderer._clearGroup(root);
    renderer._clearGroup(root);
    expect(root.children).toHaveLength(0);
    expect(nested.children).toHaveLength(0);
    expect(first.parent).toBeNull();
    released.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
    borrowed.forEach(dispose => expect(dispose).not.toHaveBeenCalled());
    shared.dispose();
    sharedGeometry.dispose();
  });

  it('releases distinct coherent material references exactly once when reused across nested meshes', () => {
    const descriptor = renderer._shipMaterialDescriptor('cargo', 8, 0x829bad);
    const bundle = renderer.textureManager.getCoherentMaterialBundle(descriptor);
    const first = renderer.materialFactory.createFleetHullMaterial(0x829bad, bundle);
    const second = renderer.materialFactory.createFleetHullMaterial(0x829bad, bundle);
    const cacheEntry = [...renderer.textureManager.coherentTextureCache.values()][0];
    expect(cacheEntry.references).toBe(2);
    const nested = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    nested.add(new THREE.Mesh(geometry, [first, second]), new THREE.Mesh(geometry, first));
    renderer.systemFleetGroup.add(nested);
    const textureDisposed = vi.spyOn(bundle.map, 'dispose');
    renderer._clearGroup(renderer.systemFleetGroup);
    renderer._clearGroup(renderer.systemFleetGroup);
    expect(cacheEntry.references).toBe(0);
    expect(textureDisposed).not.toHaveBeenCalled();
  });

  it('uses deterministic synchronous fallback with minimal managers and no factory', () => {
    renderer.textureManager.dispose();
    renderer.textureManager = null;
    renderer.materialFactory.dispose();
    renderer.materialFactory = null;
    const first = renderer._buildFleetFormationEntry(fleet(), 0);
    expect(first.ships[0].mesh.material.isMeshStandardMaterial).toBe(true);
    const positions = first.ships[0].mesh.geometry.getAttribute('position').array.slice();
    renderer._clearGroup(renderer.systemFleetGroup);
    const next = renderer._buildFleetFormationEntry(fleet(), 2);
    expect(next.ships[0].mesh.geometry.getAttribute('position').array).toEqual(positions);
  });

  it('refreshes persistence without replacing a cleared fleet or allocating a stale material', async () => {
    let resolve;
    renderer.textureManager.getCoherentMaterialBundleAsync.mockImplementation(() => new Promise(done => { resolve = done; }));
    const create = vi.spyOn(renderer.materialFactory, 'createFleetHullMaterial');
    const old = renderer._buildFleetFormationEntry(fleet(), 0);
    await flush();
    const oldMaterial = old.ships[0].mesh.material;
    const refreshed = renderer.textureManager.getCoherentMaterialBundle(renderer._shipMaterialDescriptor('frigate', 0, 0x829bad));
    const lazy = vi.fn();
    Object.defineProperty(refreshed, 'material', { get: lazy });
    renderer._clearGroup(renderer.systemFleetGroup);
    resolve(refreshed);
    await flush();
    expect(old.ships[0].mesh.material).toBe(oldMaterial);
    expect(create).toHaveBeenCalledOnce();
    expect(lazy).not.toHaveBeenCalled();
  });

  it('applies successful async refresh once and releases the previous material', async () => {
    const descriptor = renderer._shipMaterialDescriptor('frigate', 3, 0x829bad);
    const refreshed = renderer.textureManager.getCoherentMaterialBundle(descriptor);
    renderer.textureManager.getCoherentMaterialBundleAsync.mockResolvedValue(refreshed);
    const entry = renderer._buildFleetFormationEntry(fleet(), 0);
    const material = entry.ships[0].mesh.material;
    const disposed = vi.fn();
    material.addEventListener('dispose', disposed);
    await flush();
    expect(entry.ships[0].mesh.material).not.toBe(material);
    expect(disposed).toHaveBeenCalledOnce();
    for (const name of maps) expect(entry.ships[0].mesh.material[name]).toBe(refreshed[name]);
  });

  it('follows explicit engine/navigation/trail state only and honors disabled, hidden, quality and reduced motion', () => {
    renderer.qualityProfile.name = 'high';
    const source = fleet();
    const entry = renderer._buildFleetFormationEntry(source, 0);
    const { lights } = entry.ships[0];
    expect(lights.engine.visible).toBe(false);
    expect(lights.navigation.visible).toBe(false);
    source.state = { engine_power: 0.6, navigation_lights: true, trail: true };
    renderer._syncFleetShipVisuals(entry);
    expect(lights.engine.material.emissiveIntensity).toBeCloseTo(1.08);
    expect(lights.navigation.visible).toBe(true);
    expect(lights.trail.visible).toBe(true);
    source.vessels[0].state = { engine_active: false };
    renderer._syncFleetShipVisuals(entry);
    expect(lights.engine.visible).toBe(false);
    source.vessels[0].state = {};
    renderer.qualityProfile.name = 'low';
    renderer._syncFleetShipVisuals(entry);
    expect(lights.trail.visible).toBe(false);
    renderer.qualityProfile.name = 'high';
    renderer.opts.reducedMotion = true;
    renderer._syncFleetShipVisuals(entry);
    expect(lights.trail.visible).toBe(false);
    source.disabled = true;
    renderer._syncFleetShipVisuals(entry);
    expect(lights.engine.visible).toBe(false);
    expect(lights.navigation.visible).toBe(false);
    source.hidden = true;
    renderer._syncFleetShipVisuals(entry);
    expect(entry.group.visible).toBe(false);
    source.hidden = false;
    source.disabled = false;
    renderer.qualityProfile.features = { shipEffects: false };
    renderer._syncFleetShipVisuals(entry);
    expect(lights.engine.visible).toBe(false);
  });

  it('activates coherent ambient shuttles with supplied traffic state rather than shipyard economy', () => {
    renderer.systemPlanetEntries = [{ slot: { position: 1 }, mesh: new THREE.Mesh(new THREE.SphereGeometry(4)) }];
    renderer._buildAmbientTraffic({ planets: [{
      position: 1, player_planet: {
        owner: 'private', orbital_facilities: [{ type: 'shipyard', level: 2 }],
        traffic_state: { engine_active: true, navigation_lights: true },
      },
    }] });
    expect(renderer.systemTrafficEntries).toHaveLength(2);
    for (const entry of renderer.systemTrafficEntries) {
      for (const name of maps) expect(entry.mesh.children[0].material[name]?.isDataTexture).toBe(true);
      expect(entry.lights.engine.visible).toBe(true);
    }
    renderer._tickAmbientTraffic(2);
    expect(renderer.systemTrafficEntries[0].mesh.position.length()).toBeGreaterThan(0);
    renderer.systemTrafficEntries[0].shipState.engine_active = false;
    renderer._tickAmbientTraffic(3);
    expect(renderer.systemTrafficEntries[0].lights.engine.visible).toBe(false);
    renderer.systemPlanetEntries[0].mesh.geometry.dispose();
    renderer.systemPlanetEntries[0].mesh.material.dispose();
  });

  it('keeps ambient positions continuous across stopping, throttle changes and reduced-motion toggles', () => {
    const home = new THREE.Mesh(new THREE.SphereGeometry(4));
    renderer.systemPlanetEntries = [{ slot: { position: 1 }, mesh: home }];
    renderer._buildAmbientTraffic({ planets: [{
      position: 1, player_planet: {
        orbital_facilities: [{ type: 'shipyard', level: 2 }],
        traffic_state: { engine_power: 1 },
      },
    }] });
    const entry = renderer.systemTrafficEntries[0];
    renderer._tickAmbientTraffic(0.1);
    const moving = entry.mesh.position.clone();
    entry.shipState.engine_power = 0;
    renderer._tickAmbientTraffic(0.1);
    expect(entry.mesh.position.equals(moving)).toBe(true);
    entry.shipState.engine_power = 0.3;
    renderer._tickAmbientTraffic(0);
    expect(entry.mesh.position.equals(moving)).toBe(true);
    renderer._tickAmbientTraffic(0.1);
    expect(entry.mesh.position.distanceTo(moving)).toBeLessThan(0.2);
    expect(entry.mesh.position.equals(moving)).toBe(false);
    const throttled = entry.mesh.position.clone();
    renderer.opts.reducedMotion = true;
    renderer._tickAmbientTraffic(100);
    expect(entry.mesh.position.equals(throttled)).toBe(true);
    renderer.opts.reducedMotion = false;
    for (const delta of [0, -1, Infinity, NaN]) {
      renderer._tickAmbientTraffic(delta);
      expect(entry.mesh.position.equals(throttled)).toBe(true);
    }
    renderer._tickAmbientTraffic(100);
    expect(entry.mesh.position.distanceTo(throttled)).toBeLessThan(0.2);
    home.geometry.dispose();
    home.material.dispose();
  });

  it.each(['powered', 'active', 'vfx_enabled'])('suppresses running lights when explicit %s is false', (flag) => {
    renderer.qualityProfile.name = 'high';
    const source = fleet({ state: {
      engine_power: 1, navigation_lights: true, trail: true, [flag]: false,
    } });
    const { lights } = renderer._buildFleetFormationEntry(source).ships[0];
    expect(lights.engine.visible).toBe(false);
    expect(lights.navigation.visible).toBe(false);
    expect(lights.trail.visible).toBe(false);
  });

  it('passes active renderer managers into special bodies and releases nested instance GPU buffers', () => {
    renderer.systemBodyGroup = new THREE.Group();
    renderer._buildSystemSpecialBodies({}, { special_bodies: [{
      id: 'public-belt', body_type: 'asteroid_belt', semi_major_axis_au: 2,
    }] });
    const belt = renderer.systemSpecialBodyEntries[0].mesh;
    let rocks;
    let lod;
    belt.traverse(object => {
      if (object.isInstancedMesh) rocks = object;
      if (object.isLOD) lod = object;
    });
    expect(rocks.count).toBe(32);
    for (const name of maps) expect(rocks.material[name]?.isDataTexture, name).toBe(true);
    expect(lod.autoUpdate).toBe(true);
    const dispose = vi.spyOn(rocks, 'dispose');
    renderer._clearGroup(renderer.systemBodyGroup);
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.systemBodyGroup.children).toHaveLength(0);
  });
});
