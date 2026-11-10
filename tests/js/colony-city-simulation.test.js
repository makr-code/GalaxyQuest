import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ColonySurfaceLevelWebGPU, normalizeCitySlots, buildCityGeometry,
  cityCameraMatrix, cityCameraPose, colonyAtmosphereState, projectCityPoint, mapColonySurfacePoint, projectColonySurfacePoint,
  resolveBodySurface, sampleColonyTerrain, buildColonyTerrainMesh, selectColonyTerrainLod,
  TERRAIN_LODS, TERRAIN_CACHE_BYTES, COLONY_BODY_WGSL, cityPedestrians, cityEconomyStatus,
} = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
const { SeamlessZoomOrchestrator, ZOOM_LEVEL } = require('../../js/engine/zoom/SeamlessZoomOrchestrator.js');
const { planetViewProjection } = require('../../js/engine/zoom/levels/PlanetApproachLevelWebGPU.js');
const mapping = require('../../js/engine/runtime/RuntimeColonySurfaceSlotMapping.js');

const scene = (overrides = {}) => ({
  colony: { id: 7, name: 'New Dawn', population: 10000, happiness: 72 },
  slots: [{ x: 0, z: 0, type: 'habitat', level: 2 }],
  ...overrides,
});

describe('Navigable decorative satellite cities', () => {
  const manifest = {
    body_id: 12, generator_version: 1, projection: 'cube-sphere', seed: 35, biome: 'terran',
    radius_km: 6371, amplitude_km: 8, height_min_km: -16, height_max_km: 16, sea_level_km: 0,
    max_lod: 14, resolution: 17, tile_encoding: 'uint16-json',
  };
  const data = (overrides = {}) => scene({
    colony: { id: 7, name: 'Satellite test', population: 40000, diameter_km: 12742 },
    bodyTerrainManifest: manifest, reduced_motion: true,
    buildings: [{ type: 'farm', level: 8 }, { type: 'mine', level: 4 }, { type: 'factory', level: 2 }],
    slots: [], ...overrides,
  });

  describe('Local industrial smoke', () => {
    it('seeds smoke deterministically, animates upward without GPU allocation and freezes live motion policy', async () => {
      let reducedMotion = false;
      vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
      const { level, backend } = await makeLevel();
      const data = scene({ slots: [{ x: 0, z: 0, type: 'factory', level: 2 }],
        vfx_quality: 'high' });
      await level.enter(2, data);
      const particles = structuredClone(level._buildingVfxParticles);
      expect(particles.length).toBeGreaterThan(0);
      expect(particles.every(p => p.smoke)).toBe(true);
      expect(level._smokeVertexCount).toBe(particles.length * 6);
      level._rebuildBuildingVfx(level._slots);
      expect(level._buildingVfxParticles).toEqual(particles);
      const uploaded = () => {
        const call = backend.device.queue.writeBuffer.mock.calls.filter(([buffer]) => buffer === level._buildingVfxBuffer).at(-1);
        return new Float32Array(call[2]).slice();
      };
      level._updateBuildingVfxBuffer(0.1);
      const first = uploaded();
      const puff = level._buildingVfxParticles[0];
      const age = (0.1 / 8 + puff.pulsePhase / (Math.PI * 2)) % 1;
      const expected = projectColonySurfacePoint(level._viewProjection, level._bodySurface.radius,
        puff.x + age * 0.9, puff.y + age * 3.2, puff.z + Math.sin(age * Math.PI) * 0.3,
        level._bodySurface.terrain);
      expect((first[0] + first[10]) / 2).toBeCloseTo(expected[0], 5);
      expect((first[1] + first[21]) / 2).toBeCloseTo(expected[1], 5);
      expect(first[6]).toBeCloseTo(puff.baseOpacity * Math.sin(age * Math.PI) ** 2, 6);
      const allocations = backend.device.createBuffer.mock.calls.length;
      level._updateBuildingVfxBuffer(0.1);
      expect(uploaded()).not.toEqual(first);
      expect(backend.device.createBuffer).toHaveBeenCalledTimes(allocations);
      const second = uploaded();
      reducedMotion = true;
      level._updateBuildingVfxBuffer(0.1);
      expect(uploaded()).toEqual(second);
      reducedMotion = false;
      level._updateBuildingVfxBuffer(0.1);
      expect(uploaded()).not.toEqual(second);
      for (let i = 0; i < first.length; i += 10) {
        expect(first[i + 6]).toBeGreaterThanOrEqual(0);
        expect(first[i + 6]).toBeLessThanOrEqual(0.6);
        expect(first[i + 9]).toBe(1);
      }
      const time = level._buildingVfxTime;
      level._sceneData.visible = false;
      level._updateBuildingVfxBuffer(0.1);
      expect(level._buildingVfxTime).toBe(time);
      expect(uploaded().filter((_v, i) => i % 10 === 6).every(a => a === 0)).toBe(true);
      level._sceneData.visible = true;
      level._sceneData.vfx_enabled = false;
      level._updateBuildingVfxBuffer(0.1);
      expect(uploaded().filter((_v, i) => i % 10 === 6).every(a => a === 0)).toBe(true);
      level._sceneData.vfx_enabled = true;
      puff.pulsePhase = 0;
      level._buildingVfxTime = 0;
      level._updateBuildingVfxBuffer(0);
      const birth = uploaded()[6];
      level._buildingVfxTime = 7.999;
      level._updateBuildingVfxBuffer(0);
      expect(uploaded()[6]).toBeLessThan(0.001);
      expect(birth).toBeLessThan(0.001);
      level.dispose();
    });

    it('preserves activity gates through runtime slot mapping and excludes disabled emitters', async () => {
      const buildings = [
        { type: 'factory', level: 2, powered: false },
        { type: 'refinery', level: 2, effects: { state: { activity: 0 } } },
        { type: 'mine', level: 2, active: false },
      ];
      const mapped = mapping.buildColonySurfaceVfxSlots({}, { buildings });
      expect(mapped.slots).toHaveLength(3);
      expect(mapped.slots[0].powered).toBe(false);
      expect(mapped.slots[1].effects.state.activity).toBe(0);
      const { level } = await makeLevel();
      await level.enter(2, scene({ slots: mapped.slots }));
      expect(level._smokeVertexCount).toBe(0);
      expect(level._buildingVfxVertexCount).toBe(0);
      level.setSceneData(scene({ slots: [{ type: 'factory', level: 2, upgrade_end: 'pending' }] }));
      expect(level._buildingVfxParticles.every(p => !p.smoke)).toBe(true);
      level.dispose();
    });

    it('keeps bounded smoke and additive particles in separate draw ranges of one owned buffer', async () => {
      const { level, backend } = await makeLevel();
      await level.enter(2, scene({ slots: [
        { type: 'factory', level: 2, x: -3 }, { type: 'research_lab', level: 2, x: 3 },
      ] }));
      expect(level._smokeVertexCount).toBeGreaterThan(0);
      expect(level._buildingVfxVertexCount).toBeGreaterThan(level._smokeVertexCount);
      const descriptors = backend.device.createRenderPipeline.mock.calls.map(([descriptor]) => descriptor);
      expect(descriptors.find(p => p.label === 'colony_industrial_smoke')
        .fragment.targets[0].blend.color.dstFactor).toBe('one-minus-src-alpha');
      expect(descriptors.find(p => p.label === 'colony_building_vfx')
        .fragment.targets[0].blend.color.dstFactor).toBe('one');
      level._updateBuildingVfxBuffer(0.1);
      backend.pass.draw.mockClear();
      level._drawFrame();
      expect(backend.pass.draw).toHaveBeenCalledWith(level._smokeVertexCount, 1, 0, 0);
      expect(backend.pass.draw).toHaveBeenCalledWith(level._buildingVfxVertexCount - level._smokeVertexCount,
        1, level._smokeVertexCount, 0);
      expect(level._buildingVfxBuffer.size).toBe(level._buildingVfxVertexCount * 40);
      for (const [quality, cap] of [['low',100],['medium',240],['high',612]]) {
        level.setSceneData(scene({ vfx_quality: quality,
          slots: Array.from({ length: 256 }, (_, x) => ({ type: 'factory', level: 2, x })) }));
        expect(level._buildingVfxParticles.length).toBeLessThanOrEqual(cap);
        expect(level._buildingVfxParticles.length).toBeLessThanOrEqual(900);
      }
      const buffer = level._buildingVfxBuffer;
      await level.exit();
      expect(buffer.destroy).toHaveBeenCalledOnce();
      expect(level._buildingVfxVertexCount).toBe(0);
    });
  });

  it('keeps a selected satellite as visitable ruins after decline and reactivates it on recovery', async () => {
    const { level, host } = await makeLevel();
    const body_development = { body_id: 12, version: 1, founded_count: 6, peak_population: 40000 };
    await level.enter(2, data({ body_development }));
    const satellite = level._surfacePlan.settlements[4];
    level.selectSettlement(satellite.id);
    level.setSceneData({ ...level._sceneData, colony: { ...level._sceneData.colony, population: 1000 } });
    expect(level._activeSettlement.id).toBe(satellite.id);
    expect(level._activeSettlement.ruined).toBe(true);
    expect(level._city.ruined).toBe(true);
    expect(level._slots).toEqual([]);
    expect(level._people).toEqual([]);
    expect(host.querySelector('[data-city-settlement]').selectedOptions[0].textContent).toContain('(ruins)');
    expect(host.textContent).toContain('Abandoned settlement ruins');
    level.setSceneData({ ...level._sceneData, colony: { ...level._sceneData.colony, population: 40000 } });
    expect(level._activeSettlement.id).toBe(satellite.id);
    expect(level._activeSettlement.ruined).toBe(false);
    expect(level._city.ruined).toBe(false);
    expect(host.querySelector('[data-city-settlement]').selectedOptions[0].textContent).not.toContain('ruins');
  });

  it('renders primary ruins as decorative geometry when no living population or buildings remain', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, data({ colony: { id: 7, population: 0 }, buildings: [],
      body_development: { body_id: 12, version: 1, founded_count: 6, peak_population: 40000 } }));
    expect(level._activeSettlement).toBe(level._surfacePlan.settlements[0]);
    expect(level._city.ruined).toBe(true);
    expect(level._slots).toEqual([]);
    expect(host.textContent).toContain('Abandoned settlement ruins');
    expect(host.querySelector('[data-city-focus]').disabled).toBe(true);
  });

  it('keeps the original persisted valley floor for a ruined primary settlement', async () => {
    const { level } = await makeLevel();
    const valley = { ...manifest, biome: 'ice', settlement: {
      version: 1, kind: 'valley-dome', direction: [1, 0, 0], floor_height_km: -2, dome_height_ratio: 0.55,
    } };
    await level.enter(2, data({ bodyTerrainManifest: valley, colony: { id: 7, population: 0 }, buildings: [],
      body_development: { body_id: 12, version: 1, founded_count: 6, peak_population: 40000 } }));
    level.render(0.016);
    const terrain = level._bodySurface.terrain;
    expect(level._city.ruined).toBe(true);
    expect(terrain.shape.frame[1]).toEqual([1, 0, 0]);
    expect(terrain.groundHeight / terrain.radius * valley.radius_km).toBeCloseTo(-2);
    expect(terrain.shelter).not.toBeNull();
  });

  it('reuses geography-only regional roads across site changes and economic snapshots', async () => {
    const { level, host } = await makeLevel();
    const land = { ...manifest, sea_level_km: -8 };
    await level.enter(2, data({ bodyTerrainManifest: land }));
    const roads = level._surfaceRoads;
    expect(level._surfacePlan.roads.length).toBeGreaterThan(0);
    expect(host.textContent).toContain('visual regional connections');
    level.selectSettlement(level._surfacePlan.settlements[1].id);
    expect(level._surfaceRoads).toBe(roads);
    level.setSceneData({ ...level._sceneData, colony: { ...level._sceneData.colony, population: 1000 },
      buildings: [{ type: 'factory', level: 8 }] });
    expect(level._surfaceRoads).toBe(roads);
    expect(level._surfacePlan.roads).toEqual([]);
    level.setSceneData({ ...level._sceneData, bodyTerrainManifest: { ...land, seed: 36 } });
    expect(level._surfaceRoads).not.toBe(roads);
    level.dispose();
    expect(level._surfaceRoads).toBeNull();
  });

  it('reports absent land routes for an island world instead of drawing ocean crossings', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, data());
    expect(level._surfacePlan.roadStatus.disconnected.length).toBeGreaterThan(0);
    expect(host.textContent).toContain('regions without a visual land route');
  });

  it('refreshes regional HUD labels and geometry after economic snapshots without moving the selected site', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, data({ buildings: [{ type: 'farm', level: 8 }] }));
    const satellite = level._surfacePlan.settlements[1];
    level.selectSettlement(satellite.id);
    const farm = structuredClone(level._city.parts);
    expect(host.querySelector('[data-city-settlement]').selectedOptions[0].textContent).toContain('Agriculture');
    expect(host.textContent).toContain('Visual region: Agriculture; colony-wide production unchanged');
    level.setSceneData({ ...level._sceneData, buildings: [{ type: 'mine', level: 8 }] });
    expect(level._activeSettlement.id).toBe(satellite.id);
    expect(level._activeSettlement.direction).toEqual(satellite.direction);
    expect(host.querySelector('[data-city-settlement]').selectedOptions[0].textContent).toContain('Mining');
    expect(host.textContent).toContain('Visual region: Mining; colony-wide production unchanged');
    expect(level._city.parts).not.toEqual(farm);
    expect(level._slots).toEqual([]);
    level.dispose();
  });

  it('inspects selected regions, refreshes snapshots and live motion policy, and removes the panel on exit', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, data({ bodyTerrainManifest: { ...manifest, sea_level_km: -8 },
      buildings: [{ type: 'farm', level: 8 }] }));
    const satellite = level._surfacePlan.settlements[1];
    level.selectSettlement(satellite.id);
    const panel = host.querySelector('[aria-label="Selected settlement region"]');
    expect(panel.textContent).toContain('Satellite 1 — regional inspection');
    expect(panel.textContent).toContain('Agriculture 100.0%');
    expect(panel.textContent).toContain('Primary settlement');
    expect(panel.textContent).toContain('Disabled by reduced-motion or VFX settings');
    expect(panel.textContent).toContain('no regional totals are simulated');
    const content = panel.firstChild;
    level.render(0.016);
    expect(panel.firstChild).toBe(content);
    level.setSceneData({ ...level._sceneData, reduced_motion: false, buildings: [{ type: 'mine', level: 8 }] });
    expect(panel.textContent).toContain('Mining 100.0%');
    expect(panel.textContent).not.toContain('Agriculture 100.0%');
    const priorMatchMedia = window.matchMedia;
    try {
      window.matchMedia = () => ({ matches: true });
      level.render(0.016);
      expect(panel.textContent).toContain('Disabled by reduced-motion or VFX settings');
      window.matchMedia = () => ({ matches: false });
      level.render(0.016);
      expect(panel.textContent).toContain('Decorative convoy markers only');
    } finally { window.matchMedia = priorMatchMedia; }
    level.setSceneData({ ...level._sceneData, colony: { ...level._sceneData.colony, population: 1000 },
      body_development: { body_id: 12, version: 1, founded_count: 6, peak_population: 40000 } });
    expect(panel.textContent).toContain('Ruins — no inhabitants or production');
    expect(panel.textContent).toContain('(abandoned route)');
    expect(panel.textContent).toContain('No active economic land use');
    expect(panel.textContent).not.toContain('Mining 100.0%');
    await level.exit();
    expect(host.querySelector('[data-city-region]')).toBeNull();
    level.dispose();
  });

  it('reports the selected isolated region without implying all sites have no routes', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, data());
    const isolated = level._surfacePlan.roadStatus.disconnected[0];
    level.selectSettlement(isolated.id);
    const panel = host.querySelector('[data-city-region]');
    expect(panel.textContent).toContain('No land route to an earlier site found');
    expect(panel.textContent).toContain('coarse routing may miss narrow connections');
    level.dispose();
  });

  it('selects a seeded satellite through the HUD without duplicating buildings, effects or production', async () => {
    const { level, backend, host } = await makeLevel();
    await level.enter(2, data());
    const primary = level._activeSettlement;
    const satellite = level._surfacePlan.settlements[1];
    const keys = level._slots.map(slot => slot.key);
    const originalBuildings = level._sceneData.buildings;
    const buffer = level._instanceBuffer;
    const allocationCount = backend.device.createRenderPipeline.mock.calls.length;
    const select = host.querySelector('[data-city-settlement]');
    expect(select.options).toHaveLength(6);
    expect(select.disabled).toBe(false);
    select.value = satellite.id;
    select.dispatchEvent(new Event('change'));
    expect(level._activeSettlement.id).toBe(satellite.id);
    expect(level._sceneData.settlement_id).toBe(satellite.id);
    expect(level._satelliteView).toBe(true);
    expect(level._city.decorative).toBe(true);
    expect(level._city.parts.length).toBeGreaterThan(100);
    expect(level._slots).toEqual([]);
    expect(level._people).toEqual([]);
    expect(level._buildingVfxStats.emitters).toBe(0);
    expect(level._sceneData.buildings).toBe(originalBuildings);
    expect(level._bodySurface.terrain.shape.frame[1]).toEqual(satellite.direction);
    expect(level._camera.progress).toBe(1);
    expect(level._camera.span).toBeCloseTo(level._citySpan);
    expect(buffer.destroy).toHaveBeenCalledOnce();
    expect(backend.device.createRenderPipeline).toHaveBeenCalledTimes(allocationCount);
    expect(host.textContent).toContain('no additional production');
    expect(host.querySelector('[data-city-focus]').disabled).toBe(true);
    expect(() => level.validateBuilding({ type: 'farm', slot_x: 0, slot_y: 0 })).toThrow('existing colony building');
    level.selectSettlement(primary.id);
    expect(level._slots.map(slot => slot.key)).toEqual(keys);
    expect(level._satelliteView).toBe(false);
    expect(level._sceneData.buildings).toBe(originalBuildings);
    expect(level._bodySurface.terrain.shape.frame[1]).toEqual(primary.direction);
  });

  it('preserves selection through growth and resolves a deactivated satellite explicitly to primary', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, data());
    const satellite = level._surfacePlan.settlements[4];
    level.selectSettlement(satellite.id);
    level.setSceneData({ ...level._sceneData, colony: { ...level._sceneData.colony, population: 1000000 } });
    expect(level._activeSettlement.id).toBe(satellite.id);
    expect(level._satelliteView).toBe(true);
    expect(level._surfacePlan.settlements.length).toBeGreaterThan(6);
    level.setSceneData({ ...level._sceneData, colony: { ...level._sceneData.colony, population: 1000 } });
    expect(level._activeSettlement.id).toBe(level._surfacePlan.settlements[0].id);
    expect(level._sceneData.settlement_id).toBe(level._activeSettlement.id);
    expect(level._satelliteView).toBe(false);
    expect(level._slots).toHaveLength(3);
    expect(host.textContent).toContain('Settlement no longer active');
    expect(host.querySelector('[data-city-settlement]').disabled).toBe(true);
  });

  it('does not accept stale site IDs or switch during building focus and releases retained site state', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, data());
    expect(() => level.selectSettlement('invalid')).toThrow('not active');
    const site = level._surfacePlan.settlements[1];
    level.enterBuilding(level._slots[0]);
    expect(host.querySelector('[data-city-settlement]').disabled).toBe(true);
    expect(() => level.selectSettlement(site.id)).toThrow('Leave the building');
    level.leaveBuilding();
    expect(host.querySelector('[data-city-settlement]').disabled).toBe(false);
    level.selectSettlement(site.id);
    level.dispose();
    expect(level._activeSettlement).toBeNull();
    expect(level._surfacePlan).toBeNull();
    expect(() => level.selectSettlement(site.id)).toThrow('disposed');
  });

  it('rebuilds the selected satellite after late terrain arrival without losing the requested site', async () => {
    const { level } = await makeLevel();
    const module = require('../../js/rendering/colony-surface-plan.js');
    const { livingSurfaceCandidates } = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
    const site = livingSurfaceCandidates(manifest, module)[1];
    const input = data({ bodyTerrainManifest: undefined, settlement_id: site.id });
    await level.enter(2, input);
    expect(level._surfacePlan).toBeNull();
    expect(level._sceneData.settlement_id).toBe(site.id);
    level._terrainStream.manifest = manifest;
    level.render(0.016);
    expect(level._activeSettlement.id).toBe(site.id);
    expect(level._satelliteView).toBe(true);
    expect(level._bodySurface.terrain.shape.frame[1]).toEqual(site.direction);
    expect(level._slots).toEqual([]);
  });

  it('retains the selected satellite through authorized snapshots, exit and re-entry', async () => {
    const { level } = await makeLevel();
    const initial = data();
    const loadSnapshot = vi.fn(async () => ({
      success: true, colony: { ...initial.colony, population: 1000000 }, economy: {},
      buildings: initial.buildings,
    }));
    await level.enter(2, { ...initial, loadSnapshot });
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    const site = level._surfacePlan.settlements[1];
    level.selectSettlement(site.id);
    level._camera.target = { x: 2, z: 3 };
    level._setCameraSpan(40);
    await level.refreshSnapshot(7);
    expect(level._activeSettlement.id).toBe(site.id);
    expect(level._camera.target).toEqual({ x: 2, z: 3 });
    expect(level._camera.span).toBeCloseTo(40);
    expect(level._slots).toEqual([]);
    await level.exit(2);
    await level.enter(2, { colony: initial.colony });
    expect(level._activeSettlement.id).toBe(site.id);
    expect(level._satelliteView).toBe(true);
    loadSnapshot.mockResolvedValueOnce({
      success: true, colony: { ...initial.colony, population: 1000 }, economy: {}, buildings: initial.buildings,
    });
    await level.refreshSnapshot(7);
    expect(level._satelliteView).toBe(false);
    expect(level._slots).toHaveLength(3);
    expect(level._camera.target).toEqual({ x: 0, z: 0 });
    expect(level._camera.span).toBeCloseTo(level._citySpan);
  });
});

function gpu() {
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const encoder = { beginRenderPass: vi.fn(() => pass), finish: vi.fn(() => ({})) };
  const device = {
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    createShaderModule: vi.fn((desc) => desc),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBuffer: vi.fn((desc) => ({ ...desc, destroy: vi.fn() })),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn((desc) => ({ width: desc.size[0], height: desc.size[1], createView: () => ({}), destroy: vi.fn() })),
    createCommandEncoder: vi.fn(() => encoder),
    destroy: vi.fn(),
  };
  const context = { configure: vi.fn(), getCurrentTexture: vi.fn(() => ({ createView: () => ({}) })) };
  return { device, context, pass, encoder };
}

const levels = [];
async function makeLevel() {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 700;
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 700 });
  host.appendChild(canvas);
  document.body.appendChild(host);
  const backend = gpu();
  const level = new ColonySurfaceLevelWebGPU();
  levels.push(level);
  await level.initialize(canvas, backend);
  return { level, canvas, backend, host };
}

async function makeCityOrchestrator(data = scene()) {
  const setup = await makeLevel();
  const { level, canvas, backend } = setup;
  const orchestrator = new SeamlessZoomOrchestrator(canvas);
  orchestrator._backend = backend;
  level._initialised = true;
  orchestrator.register(ZOOM_LEVEL.COLONY_SURFACE, { threejs: class { constructor() { return level; } } });
  const resolve = vi.spyOn(orchestrator._registry, 'resolve');
  await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_SURFACE, data);
  for (let frame = 0; frame < 80; frame++) orchestrator.tick(0.016);
  return { ...setup, orchestrator, resolve };
}

beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
});
afterEach(() => {
  levels.splice(0).forEach((level) => level.dispose());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.API;
  delete window.__GQ_ZOOM_ORCHESTRATOR;
  delete window.GQSeamlessZoomOrchestrator;
  delete window.GQRuntimeColonySurfaceSlotMapping;
});

describe('Authoritative city scene mapping', () => {
  it('offers distinct selected-building focus and management actions without issuing game commands', async () => {
    const { level, backend } = await makeLevel();
    backend.externalCameraControls = true;
    const onOpenBuildings = vi.fn();
    const building = vi.fn();
    level.setNavigationHandlers({ building });
    await level.enter(2, scene({ onOpenBuildings }));
    const focus = [...level._hud.querySelectorAll('button')].find((button) => button.textContent === 'Focus building');
    const manage = [...level._hud.querySelectorAll('button')].find((button) => button.textContent === 'Buildings');
    expect(focus.disabled).toBe(true);
    manage.click();
    expect(onOpenBuildings).toHaveBeenCalledWith(null);
    level._selected = level._slots[0];
    level._updateHud();
    expect(focus.disabled).toBe(false);
    focus.click();
    expect(building).toHaveBeenCalledWith(expect.objectContaining({ type: 'habitat', colonyId: 7 }));
    expect(onOpenBuildings).toHaveBeenCalledOnce();
    manage.click();
    expect(onOpenBuildings).toHaveBeenLastCalledWith(level._slots[0]);
    level.enterBuilding(level._slots[0]);
    expect(focus.disabled).toBe(true);
    level.leaveBuilding();
    expect(focus.disabled).toBe(false);
  });
  it('reverses the shared planet backdrop transition before releasing the live surface', async () => {
    const { level, backend } = await makeLevel();
    backend.externalCameraControls = true;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const backdrop = { renderBackdrop: vi.fn(() => true) };
    level.setTransitionSource(backdrop, { position: { x: 0, y: 0, z: 3 } });
    await level.enter(2, scene());
    for (let frame = 0; frame < 90; frame++) level.render(1 / 60);
    level.rotateView(60, 30);
    level.panView(20, 10);
    const buffer = level._instanceBuffer;
    const startSpan = level._camera.span;
    const exit = level.exit(2);
    expect(level._active).toBe(true);
    expect(buffer.destroy).not.toHaveBeenCalled();
    level.render(0.1);
    expect(level._camera.progress).toBeGreaterThan(0);
    expect(level._camera.progress).toBeLessThan(1);
    expect(level._camera.span).toBeGreaterThan(startSpan);
    expect(backdrop.renderBackdrop).toHaveBeenLastCalledWith(0.1, expect.any(Object), expect.any(Number));
    for (let frame = 0; frame < 90; frame++) level.render(1 / 60);
    await exit;
    expect(level._camera.progress).toBe(0);
    expect(level._camera.target.x).toBeCloseTo(0);
    expect(level._camera.target.z).toBeCloseTo(0);
    expect(level._active).toBe(false);
    expect(buffer.destroy).toHaveBeenCalledOnce();
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it('settles an interrupted surface departure immediately on disposal without another frame', async () => {
    const { level, backend } = await makeLevel();
    backend.externalCameraControls = true;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    level.setTransitionSource({ renderBackdrop: () => true }, {});
    await level.enter(2, scene());
    level._camera.progress = 1;
    const exit = level.exit(2);
    expect(level._departure).toBeTruthy();
    level.dispose();
    await exit;
    expect(level._active).toBe(false);
    expect(level._departure).toBeNull();
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it('skips surface arrival and departure motion when reduced motion is requested', async () => {
    const { level, backend } = await makeLevel();
    backend.externalCameraControls = true;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    level.setTransitionSource({ renderBackdrop: () => true }, {});
    await level.enter(2, scene());
    level.render(0.016);
    expect(level._camera.progress).toBe(1);
    await level.exit(2);
    expect(level._departure).toBeFalsy();
    expect(level._active).toBe(false);
  });
  it('uses the shared UI orbit, pan, zoom and reset controls without moving the parent scene', async () => {
    const { level, canvas, backend } = await makeLevel();
    backend.externalCameraControls = true;
    await level.enter(2, scene({ colony: { name: 'Camera fixture' } }));
    level.render(1.3);
    const initialPose = [...level._viewProjection];
    const event = (type, x, y, button = 0) => {
      const pointer = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
      canvas.dispatchEvent(pointer);
    };
    event('pointerdown', 500, 300);
    event('pointermove', 550, 330);
    event('pointerup', 550, 330);
    expect(level._orbit.yaw).not.toBe(0);
    expect(level._camera.target).toEqual({ x: 0, z: 0 });
    level.render(0.1);
    expect([...level._viewProjection]).not.toEqual(initialPose);
    event('pointerdown', 550, 330, 2);
    event('pointermove', 590, 350, 2);
    event('pointerup', 590, 350, 2);
    expect(level._camera.target).not.toEqual({ x: 0, z: 0 });
    const span = level._camera.span;
    level.nudgeZoom('in');
    expect(level._camera.span).toBeLessThan(span);
    const pinchedSpan = level._camera.span;
    level.zoomBy(Math.log(1.25));
    expect(level._camera.span).toBeCloseTo(pinchedSpan / 1.25, 6);
    level.zoomBy(-Math.log(1.25));
    expect(level._camera.span).toBeCloseTo(pinchedSpan, 6);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }));
    expect(level._camera.target).toEqual({ x: 0, z: 0 });
    expect(level._orbit).toEqual({ yaw: 0, pitch: 0 });
    expect(level._camera.span).toBe(level._citySpan);
    expect(backend.context.configure).not.toHaveBeenCalled();
    expect(backend.device.destroy).not.toHaveBeenCalled();
    expect(level._hud.tagName).toBe('DETAILS');
    expect(level._hud.open).toBe(false);
    const overlayButton = document.createElement('button');
    document.body.append(overlayButton);
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    overlayButton.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(level._orbit).toEqual({ yaw: 0, pitch: 0 });
  });

  it('uses an injected authoritative snapshot and explicitly reports errors without legacy fallback', async () => {
    const { level } = await makeLevel();
    const onError = vi.fn();
    const loadSnapshot = vi.fn(async () => { throw new Error('Session expired'); });
    window.API = { buildings: vi.fn() };
    await level.enter(2, scene({ loadSnapshot, onError }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(loadSnapshot).toHaveBeenCalledWith(7, expect.any(AbortSignal));
    expect(level._snapshotState).toContain('Session expired');
    expect(window.API.buildings).not.toHaveBeenCalled();
    expect(level._slots[0].level).toBe(2);
  });
  it('preserves slot coordinates, levels, upgrade state and omits empty plots', () => {
    const slots = normalizeCitySlots({
      slots: [
        { slot_x: -1, slot_y: 1, building_type: 'factory', level: 4 },
        { slot_x: 3, slot_y: 1, building_type: 'habitat', level: 0 },
      ],
      buildings: [{ type: 'factory', level: 2, upgrade_end: '2026-11-03' }],
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ type: 'factory', level: 4, slot_x: -1, upgrade_end: '2026-11-03' });
    expect(slots[0].x).toBeCloseTo(-9.3);
    expect(slots[0].z).toBeCloseTo(-1.55);
  });

  it('uses deterministic visual placement when legacy buildings have no saved slots', () => {
    const data = { buildings: [{ type: 'habitat', level: 3 }, { type: 'mine', level: 0 }] };
    expect(normalizeCitySlots(data)).toEqual(normalizeCitySlots(data));
    expect(normalizeCitySlots(data)).toHaveLength(1);
    expect(normalizeCitySlots({ slots: Array.from({ length: 500 }, () => ({ x: 0, z: 0, type: 'lab', level: 1 })) })).toHaveLength(256);
  });

  it('carries real levels and coordinates through the existing runtime mapper', () => {
    const mapped = mapping.buildColonySurfaceVfxSlots({ id: 7 }, {
      buildings: [{ type: 'metal_mine', level: 5, upgrade_end: 'tomorrow', meta: { zone: 'surface', class_key: 'industrial' } }],
    });
    expect(mapped.slots[0]).toMatchObject({ type: 'metal_mine', level: 5, slot_x: 0, slot_y: 0, upgrade_end: 'tomorrow' });
    const catalog = Array.from({ length: 40 }, (_, index) => ({ type: `unbuilt_${index}`, level: 0 }));
    catalog.push({ type: 'habitat', level: 3 });
    expect(mapping.buildColonySurfaceVfxSlots({}, { buildings: catalog }).slots).toHaveLength(1);
  });

  it('builds different 3D silhouettes for farms, industry, power, research and housing', () => {
    const shapes = ['farm', 'factory', 'fusion_reactor', 'research_lab', 'habitat'].map((type) =>
      buildCityGeometry([{ x: 0, z: 0, type, level: 3 }], scene()).parts);
    expect(new Set(shapes.map((parts) => JSON.stringify(parts))).size).toBe(5);
    shapes.forEach((parts) => {
      expect(parts[0].sy).toBeGreaterThan(0);
      expect(parts.some((part) => part.sy > 0.3)).toBe(true);
      expect(parts.length).toBeLessThan(8192);
    });
    const low = buildCityGeometry([{ x: 0, z: 0, type: 'habitat', level: 1 }], scene()).parts;
    const high = buildCityGeometry([{ x: 0, z: 0, type: 'habitat', level: 7 }], scene()).parts;
    expect(Math.max(...high.map((p) => p.y + p.sy))).toBeGreaterThan(Math.max(...low.map((p) => p.y + p.sy)));
  });

  it('visualizes only server-reported shortages, with no economic tick in the client', () => {
    expect(cityEconomyStatus(scene()).warning).toBe(false);
    const data = scene({ economy: { shortages: { food: 12, energy: 0 }, settled_at: 'server-time' } });
    expect(cityEconomyStatus(data)).toEqual({ warning: true, text: 'Colony shortage: food' });
    const before = JSON.stringify(data);
    buildCityGeometry(normalizeCitySlots(data), data);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('maps colony ground to a spherical surface and scales the body for planets, moons and small bodies', () => {
    const point = mapColonySurfacePoint(200, 12, 0, -8);
    expect(Math.hypot(point[0], point[1] + 200, point[2])).toBeCloseTo(200);
    expect(point[1]).toBeLessThan(0);
    expect(mapColonySurfacePoint(200, 0, 0.5, 0)).toEqual([0, 0.5, 0]);

    const earth = resolveBodySurface({ colony: { diameter: 12742, planet_class: 'terran' } }, 24, 18);
    const moon = resolveBodySurface({ colony: { diameter: 3474, planet_type: 'moon' } }, 24, 18);
    const comet = resolveBodySurface({ colony: { body_type: 'comet' } }, 24, 18);
    expect(earth.radius).toBeGreaterThan(moon.radius);
    expect(moon.radius).toBeGreaterThan(comet.radius);
    expect(comet.kind).toBe('comet');

    const matrix = cityCameraMatrix(1, 25);
    expect(projectColonySurfacePoint(matrix, 200, 0, 0.5, 0))
      .toEqual(projectCityPoint(matrix, 0, 0.5, 0));
  });

  it('creates bounded deterministic cosmetic people only for populated built colonies', () => {
    const slots = normalizeCitySlots(scene());
    expect(cityPedestrians(1e9, slots)).toHaveLength(96);
    expect(cityPedestrians(100, slots)).toEqual(cityPedestrians(100, slots));
    expect(cityPedestrians(0, slots)).toHaveLength(0);
    expect(cityPedestrians(100, [])).toHaveLength(0);
    expect(cityPedestrians(100, slots)[0].z).toBe(1.55);
    const people = cityPedestrians(1e9, slots, { colonist: 75, scientist: 25 });
    expect(people.filter((person) => person.role === 'scientist')).toHaveLength(24);
  });
});

describe('Detailed body terrain', () => {
  const terrainFor = (kind, id = 7) => resolveBodySurface({
    colony: { id, planet_class: kind },
  }, 24, 18).terrain;

  it.each([
    ['terran', [0, 1, 2]], ['ocean', [0, 1]], ['ice_dwarf', [2]],
    ['desert', [0]], ['volcanic', [0, 3]], ['moon', [0]], ['comet', [2]],
  ])('generates deterministic %s relief with the correct surface materials', (kind, expectedMaterials) => {
    const terrain = terrainFor(kind);
    const materials = new Set();
    const heights = [];
    for (let x = -100; x <= 100; x += 4) {
      for (let z = -100; z <= 100; z += 4) {
        const sample = sampleColonyTerrain(terrain, x, z);
        expect(sample).toEqual(sampleColonyTerrain(terrainFor(kind), x, z));
        expect([...sample.color, sample.height].every(Number.isFinite)).toBe(true);
        materials.add(sample.material);
        heights.push(sample.height);
        if (sample.material === 1 || sample.material === 3) expect(sample.height).toBe(-0.5);
      }
    }
    expect([...materials].sort()).toEqual(expectedMaterials);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(4);
  });

  it('keeps colony foundations and roads dry and graded, with a continuous transition to relief', () => {
    for (const kind of ['terran', 'ocean', 'ice_dwarf', 'desert', 'volcanic']) {
      const terrain = terrainFor(kind);
      for (let x = -14; x <= 14; x += 1) {
        for (let z = -11; z <= 11; z += 1) {
          expect(sampleColonyTerrain(terrain, x, z).height).toBeCloseTo(0);
        }
      }
      const edge = sampleColonyTerrain(terrain, 14 + 0.0001, 0);
      expect(Math.abs(edge.height)).toBeLessThan(0.0001);
      const ground = mapColonySurfacePoint(terrain.radius, 4, 0, 3, terrain);
      const foundation = mapColonySurfacePoint(terrain.radius, 4, 0.15, 3, terrain);
      expect(Math.hypot(...foundation.map((value, axis) => value - ground[axis]))).toBeCloseTo(0.15);
    }
    expect(sampleColonyTerrain(terrainFor('terran', 7), 45, 28).elevation)
      .not.toBe(sampleColonyTerrain(terrainFor('terran', 8), 45, 28).elevation);
  });

  it('builds a bounded, non-rotating displaced sphere with finite geometry and matching height samples', () => {
    const terrain = resolveBodySurface({ colony: { id: 7, planet_class: 'terran', diameter_km: 3 } }, 24, 18).terrain;
    const mesh = buildColonyTerrainMesh(terrain);
    expect(mesh.vertexCount).toBe(104 * 128 * 6);
    expect(mesh.vertices.byteLength).toBeLessThan(3.75 * 1024 * 1024);
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    const radialHeights = [];
    for (let i = 0; i < mesh.vertices.length; i += 12) {
      radialHeights.push(Math.hypot(mesh.vertices[i], mesh.vertices[i + 1] + terrain.radius, mesh.vertices[i + 2]) - terrain.radius);
    }
    expect(Math.max(...radialHeights)).toBeGreaterThan(2);
    expect(Math.min(...radialHeights)).toBeCloseTo(-0.5, 3);
    const x = 35, z = 25;
    const point = mapColonySurfacePoint(terrain.radius, x, 0, z, terrain);
    expect(Math.hypot(point[0], point[1] + terrain.radius, point[2]) - terrain.radius)
      .toBeCloseTo(sampleColonyTerrain(terrain, x, z).height);
    const pose = cityCameraPose(25, 1, { x, z }, terrain.radius, terrain);
    pose.target.forEach((value, axis) => expect(value).toBeCloseTo(point[axis]));
    const matrix = cityCameraMatrix(1.5, 25, 1, { x, z }, terrain.radius, terrain);
    expect(projectColonySurfacePoint(matrix, terrain.radius, x, 0, z, terrain)[0]).toBeCloseTo(0);
    expect(projectColonySurfacePoint(matrix, terrain.radius, x, 0, z, terrain)[1]).toBeCloseTo(0);
  });

  it('preserves explicit dry foundations and frozen shelter floors independently of their elevation', () => {
    for (const height of [-10, 10]) {
      const terrain = { ...terrainFor('terran'), groundHeight: height };
      expect(sampleColonyTerrain(terrain, 0, 0).boundaries).toEqual([1, -1, 0, 0]);
      terrain.heightSampler = () => height;
      const mesh = buildColonyTerrainMesh(terrain, 0);
      for (let offset = 0; offset < mesh.vertices.length; offset += 12) {
        expect(Array.from(mesh.vertices.subarray(offset + 8, offset + 12))).toEqual([1, -1, 0, 0]);
      }
    }
    const terrain = { ...terrainFor('ice_dwarf'), shelter: { radius: 5, floor: -10 } };
    expect(sampleColonyTerrain(terrain, 0, 0).boundaries).toEqual([1, 1, 0, 1]);
  });

  it('does not invent mountains or liquid surfaces on a gas giant', () => {
    const terrain = terrainFor('gas_giant');
    for (const [x, z] of [[0, 0], [30, 40], [-100, 50]]) {
      expect(sampleColonyTerrain(terrain, x, z)).toMatchObject({ height: 0, material: 0 });
    }
  });

  it('reuses uploaded terrain across snapshots and releases it on body changes and exit', async () => {
    const { level, backend } = await makeLevel();
    await level.enter(2, scene());
    level.render(0.016);
    const terrain = level._terrainBuffer;
    level.setSceneData(scene({ economy: { shortages: {} } }));
    expect(level._terrainBuffer).toBe(terrain);
    level.render(0.016);
    expect(backend.pass.setVertexBuffer).toHaveBeenCalledWith(0, terrain);
    expect(backend.pass.draw).toHaveBeenCalledWith(level._terrainVertexCount, 1, 0, 0);
    level.setSceneData(scene({ colony: { id: 7, planet_class: 'ice_dwarf' } }));
    expect(terrain.destroy).toHaveBeenCalledOnce();
    expect(level._terrainBuffer).toBeNull();
    level.render(0.016);
    const ice = level._terrainBuffer;
    await level.exit();
    expect(ice.destroy).toHaveBeenCalledOnce();
    expect(level._terrainBuffer).toBeNull();
    expect(level._terrainVertexCount).toBe(0);
  });

  it('subdivides roads to keep their middle above the curved terrain', () => {
    const data = scene({ colony: { id: 7, body_type: 'asteroid', diameter_km: 0.2 } });
    const city = buildCityGeometry(normalizeCitySlots(data), data);
    const radius = resolveBodySurface(data, city.width, city.depth).radius;
    const roads = city.parts.filter((part) => part.sy === 0.03);
    expect(roads.length).toBeGreaterThan(20);
    for (const road of roads) {
      const half = Math.max(road.sx, road.sz) / 2;
      const chordSag = radius - Math.sqrt(radius * radius - half * half);
      expect(chordSag).toBeLessThan(road.y);
    }
    expect(city.parts.length).toBeLessThan(8192);
    expect(city.parts.some((part) => part.sx > 3 && part.sz > 3)).toBe(false);
  });

  it('raises camera clearance outside graded colony land and follows the terrain target', async () => {
    const { level } = await makeLevel();
    await level.enter(2, scene());
    level._camera.progress = 1;
    level._camera.target = { x: 45, z: 28 };
    level._setCameraSpan(1);
    level.render(0);
    const terrain = level._bodySurface.terrain;
    const pose = cityCameraPose(level._camera.span, 1, level._camera.target, terrain.radius, terrain);
    const altitude = Math.hypot(pose.eye[0], pose.eye[1] + terrain.radius, pose.eye[2]) - terrain.radius;
    expect(altitude).toBeGreaterThan(terrain.amplitude * 1.1 + 0.35);
    const projected = projectColonySurfacePoint(level._viewProjection, terrain.radius, 45, 0, 28, terrain);
    expect(projected[0]).toBeCloseTo(0);
    expect(projected[1]).toBeCloseTo(0);
  });
});

describe('Demand-driven terrain detail', () => {
  it('selects increasing LOD from projected feature size with a stable hysteresis band', () => {
    expect([50, 200, 800, 2000].map((pixels) => selectColonyTerrainLod(pixels))).toEqual([0, 1, 2, 3]);
    expect(selectColonyTerrainLod(125, 0)).toBe(0);
    expect(selectColonyTerrainLod(140, 0)).toBe(1);
    expect(selectColonyTerrainLod(110, 1)).toBe(1);
    expect(selectColonyTerrainLod(100, 1)).toBe(0);
    expect(selectColonyTerrainLod(0, 3)).toBe(0);
  });

  it('generates increasingly dense bounded meshes around the current target', () => {
    const terrain = resolveBodySurface(scene(), 24, 18).terrain;
    let previous = 0;
    for (let lod = 0; lod < TERRAIN_LODS.length; lod++) {
      const { vertices, vertexCount } = buildColonyTerrainMesh(terrain, lod, { x: 45, z: 28 });
      expect(vertexCount).toBeGreaterThan(previous);
      expect(vertices.byteLength).toBeLessThan(TERRAIN_CACHE_BYTES);
      const expected = mapColonySurfacePoint(terrain.radius, 45, 0, 28, terrain);
      expected.forEach((value, axis) => expect(vertices[axis]).toBeCloseTo(value, 4));
      expect([...vertices].every(Number.isFinite)).toBe(true);
      previous = vertexCount;
    }
    expect(previous).toBe(161280);
  });

  it('does not generate or upload terrain for prepared, inactive, hidden or zero-size views', async () => {
    const { level, backend, canvas } = await makeLevel();
    level.setSceneData(scene());
    level.render(0.016);
    expect(level._terrainBuffer).toBeNull();
    expect(backend.device.createBuffer.mock.calls.some(([buffer]) => buffer.label?.startsWith('colony_terrain_'))).toBe(false);
    await level.enter(2, scene());
    expect(level._terrainBuffer).toBeNull();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    level.render(0.016);
    expect(level._terrainBuffer).toBeNull();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const rect = canvas.getBoundingClientRect;
    canvas.getBoundingClientRect = () => ({ width: 0, height: 0 });
    level.render(0.016);
    expect(level._terrainBuffer).toBeNull();
    canvas.getBoundingClientRect = () => ({ width: 1000, height: 700, left: 0, top: window.innerHeight + 1 });
    level.render(0.016);
    expect(level._terrainBuffer).toBeNull();
    canvas.getBoundingClientRect = rect;
    level.render(0.016);
    expect(level._terrainLod).toBe(0);
    expect(level._terrainBuffer.size).toBe(294912);
  });

  it('refines on zoom and viewport resolution, and reuses previously generated levels', async () => {
    const { level, canvas } = await makeLevel();
    await level.enter(2, scene());
    level.render(0);
    const coarse = level._terrainBuffer;
    level._camera.progress = 1;
    level._setCameraSpan(level._citySpan);
    level.render(0);
    expect(level._terrainLod).toBe(2);
    const detailed = level._terrainBuffer;
    level._setCameraSpan(9);
    level.render(0);
    expect(level._terrainLod).toBe(3);
    expect(level._terrainBuffer.size).toBeGreaterThan(detailed.size);
    level._setCameraSpan(level._entrySpan);
    level.render(0);
    expect(level._terrainBuffer).toBe(coarse);
    level._setCameraSpan(level._citySpan);
    level.render(0);
    expect(level._terrainBuffer).toBe(detailed);
    canvas.width *= 2;
    canvas.height *= 2;
    level.render(0);
    expect(level._terrainLod).toBe(3);
    expect(level._terrainCacheBytes).toBeLessThanOrEqual(TERRAIN_CACHE_BYTES);
  });

  it('moves refinement with panning, avoids focus-boundary churn, and evicts old buffers within budget', async () => {
    const { level } = await makeLevel();
    await level.enter(2, scene());
    level._camera.progress = 1;
    level._setCameraSpan(9);
    level.render(0);
    const step = level._bodySurface.terrain.scale * 0.5;
    const original = level._terrainBuffer;
    level._camera.target.x = step * 0.6;
    level.render(0);
    expect(level._terrainBuffer).toBe(original);
    const buffers = [];
    for (let i = 1; i < 10; i++) {
      level._camera.target.x = step * i;
      level.render(0);
      buffers.push(level._terrainBuffer);
      expect(level._terrainCacheBytes).toBeLessThanOrEqual(TERRAIN_CACHE_BYTES);
      expect(level._terrainFocus.x).toBeCloseTo(step * i);
    }
    expect(original.destroy).toHaveBeenCalledOnce();
    expect(buffers.some((buffer) => buffer.destroy.mock.calls.length)).toBe(true);
    await level.exit();
    expect(level._terrainCache.size).toBe(0);
    expect(level._terrainCacheBytes).toBe(0);
    buffers.forEach((buffer) => expect(buffer.destroy).toHaveBeenCalledOnce());
  });

  it('uses shared footprint-filtered physical material details', () => {
    const { WGSL } = require('../../js/rendering/body-material.js');
    expect(COLONY_BODY_WGSL).toContain('gqTerrainMasks(in.boundaries)');
    expect(COLONY_BODY_WGSL).toContain('gqSurface(bodyPoint,meters,canonicalNormal,0.0)');
    expect(WGSL).toContain('length(dpdx(meters))');
    expect(WGSL).toContain('footprint / period');
  });
});

describe('Isometric camera and shared WebGPU rendering', () => {
  it('crosses a physical cloud altitude with visible fog, then clears the near colony view', async () => {
    const { level, backend } = await makeLevel();
    await level.enter(2, scene({ colony: { id: 7, diameter_km: 12742, atmosphere_type: 'nitrogen_oxygen' } }));
    const states = [];
    for (let frame = 0; frame < 80; frame++) {
      level.render(0.016);
      states.push({ ...level._atmosphereState });
    }
    expect(states[0].belowClouds).toBe(false);
    expect(states[0].fogOpacity).toBeLessThan(0.01);
    expect(Math.max(...states.map((state) => state.fogOpacity))).toBeGreaterThan(0.5);
    expect(states.filter((state) => state.fogOpacity > 0.2).length).toBeGreaterThanOrEqual(8);
    expect(states.at(-1).belowClouds).toBe(true);
    expect(states.at(-1).fogOpacity).toBeLessThan(0.05);
    expect(backend.pass.setPipeline).toHaveBeenCalledWith(level._skyPipeline);
    expect(backend.pass.setPipeline).toHaveBeenCalledWith(level._cloudVeilPipeline);
    const pipelines = backend.device.createRenderPipeline.mock.calls.map(([pipeline]) => pipeline);
    expect(pipelines.find((pipeline) => pipeline.label === 'colony_sky_dome').depthStencil)
      .toMatchObject({ depthWriteEnabled: false, depthCompare: 'less-equal' });
    expect(pipelines.find((pipeline) => pipeline.label === 'colony_cloud_crossing').depthStencil)
      .toMatchObject({ depthWriteEnabled: false, depthCompare: 'always' });
    level._setCameraSpan(level._entrySpan);
    level.render(0);
    expect(level._atmosphereState.belowClouds).toBe(false);
    expect(level._atmosphereState.fogOpacity).toBeLessThan(0.01);
  });

  it.each([
    { atmosphere_type: 'none' },
    { has_atmosphere: false },
    { has_atmosphere: 0 },
    { body_type: 'comet' },
    { body_type: 'comet', planet_class: 'ice' },
    { body_type: 'asteroid' },
    { planet_type: 'moon' },
  ])('does not render a cloudy atmosphere on an airless body: %j', async (metadata) => {
    const { level, backend } = await makeLevel();
    await level.enter(2, scene({ colony: { id: 7, ...metadata } }));
    for (let frame = 0; frame < 80; frame++) level.render(0.016);
    expect(level._bodySurface.atmosphere.strength).toBe(0);
    expect(level._atmosphereState.fogOpacity).toBe(0);
    expect(backend.pass.setPipeline).not.toHaveBeenCalledWith(level._skyPipeline);
    expect(backend.pass.setPipeline).not.toHaveBeenCalledWith(level._cloudVeilPipeline);
  });

  it('uses explicit atmosphere and cloud metadata rather than body kind alone', () => {
    const body = resolveBodySurface({ colony: { planet_type: 'moon', atmosphere_type: 'thin', cloud_coverage: 0 } }, 24, 18);
    expect(body.atmosphere.strength).toBe(0.4);
    const pose = cityCameraPose(40, 1, { x: 7, z: -9 }, body.radius);
    const state = colonyAtmosphereState(body, 32, pose);
    expect(state.fogOpacity).toBe(0);
    expect(Number.isFinite(state.altitude)).toBe(true);
    expect(Math.hypot(pose.eye[0] - pose.target[0], pose.eye[1] - pose.target[1], pose.eye[2] - pose.target[2]))
      .toBeCloseTo(pose.distance);
    const matrix = cityCameraMatrix(1.5, 40, 1, { x: 7, z: -9 }, body.radius);
    const center = projectCityPoint(matrix, ...pose.target);
    expect(center[0]).toBeCloseTo(0);
    expect(center[1]).toBeCloseTo(0);
    const inherited = resolveBodySurface({
      focusPlanet: { id: 8 },
      colony: { body_type: 'comet', diameter_km: 300, atmosphere_type: 'none' },
    }, 24, 18);
    expect(inherited.kind).toBe('comet');
    expect(inherited.atmosphere.strength).toBe(0);
  });

  it('interpolates real projection matrices and keeps the target centered at all aspects', () => {
    for (const aspect of [0.5, 1, 2]) {
      for (const t of [0, 0.4, 1]) {
        const matrix = cityCameraMatrix(aspect, 25, t, { x: 3, z: 7 });
        const center = projectCityPoint(matrix, 3, 0, 7);
        expect(center[0]).toBeCloseTo(0);
        expect(center[1]).toBeCloseTo(0);
        expect(center[2]).toBeGreaterThan(0);
        expect(center[2]).toBeLessThan(1);
        expect([...matrix].every(Number.isFinite)).toBe(true);
      }
    }
    expect(cityCameraMatrix(1, 25, 0)).not.toEqual(cityCameraMatrix(1, 25, 1));
    const iso = cityCameraMatrix(1, 25);
    const x = projectCityPoint(iso, 1, 0, 0);
    const z = projectCityPoint(iso, 0, 0, 1);
    expect(x[0]).toBeCloseTo(-z[0]);
    expect(x[1]).toBeCloseTo(z[1]);
  });

  it('keeps an explicit camera target centered while changing the approach direction', () => {
    const target = { x: 2, y: -1, z: 3 };
    const north = planetViewProjection({
      position: { x: 2, y: -1, z: 13 }, target,
    }, 1.5, 3.2);
    const east = planetViewProjection({
      position: { x: 12, y: -1, z: 3 }, target,
    }, 1.5, 3.2);
    projectCityPoint(north, target.x, target.y, target.z).slice(0, 2).forEach((value) => expect(value).toBeCloseTo(0));
    projectCityPoint(east, target.x, target.y, target.z).slice(0, 2).forEach((value) => expect(value).toBeCloseTo(0));
    expect([...north]).not.toEqual([...east]);
  });

  it('draws depth-tested 36-vertex instances on the borrowed context and resizes owned depth only', async () => {
    const { level, canvas, backend } = await makeLevel();
    await level.enter(2, scene());
    level.render(0.016);
    expect(backend.context.configure).not.toHaveBeenCalled();
    expect(backend.pass.draw).toHaveBeenCalledWith(36, level._slotCount, 0, 0);
    expect(backend.encoder.beginRenderPass.mock.calls[0][0].depthStencilAttachment.depthClearValue).toBe(1);
    const depth = level._depthTexture;
    canvas.width = 1200;
    level.render(0.016);
    expect(depth.destroy).toHaveBeenCalledOnce();
    const color = backend.device.createRenderPipeline.mock.calls[0][0];
    expect(color.depthStencil).toMatchObject({ depthWriteEnabled: true, depthCompare: 'less' });
    level.dispose();
    expect(backend.device.destroy).not.toHaveBeenCalled();
  });

  it('picks the nearest projected building and cleans input/HUD on exit', async () => {
    const { level, canvas, host } = await makeLevel();
    const slotClick = vi.fn();
    level.setNavigationHandlers({ slotClick });
    await level.enter(2, scene());
    for (let i = 0; i < 80; i++) level.render(0.016);
    const pos = projectCityPoint(level._viewProjection, 0, 0.7, 0);
    const selected = level._selectAt(10 + (pos[0] + 1) * 500, 20 + (1 - pos[1]) * 350);
    expect(selected.type).toBe('habitat');
    expect(slotClick).toHaveBeenCalledWith(expect.objectContaining({ type: 'habitat', colonyId: 7 }));
    expect(host.querySelector('[aria-label="Colony surface simulation"]')).not.toBeNull();
    const oldSpan = level._camera.span;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    expect(level._camera.span).toBeGreaterThan(oldSpan);
    await level.exit(1);
    const span = level._camera.span;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    expect(level._camera.span).toBe(span);
    expect(host.querySelector('section')).toBeNull();
    expect(level._people).toHaveLength(0);
    expect(level._inputCleanups).toHaveLength(0);
  });

  it('smoothly focuses a building through the shared render loop without a pose jump', async () => {
    const { level, canvas } = await makeLevel();
    await level.enter(2, scene({ slots: [{ x: 5, z: -4, type: 'research_lab', level: 7 }] }));
    for (let i = 0; i < 80; i++) level.render(0.016);
    level._selected = level._slots[0];
    const start = { ...level._camera, target: { ...level._camera.target } };
    canvas.dispatchEvent(new MouseEvent('dblclick'));
    expect(level._camera).toEqual(start);
    level.render(0.1);
    expect(level._camera.target.x).toBeGreaterThan(0);
    expect(level._camera.target.x).toBeLessThan(5);
    expect(level._camera.span).toBeGreaterThan(9);
    expect(level._camera.span).toBeLessThan(start.span);
    for (let i = 0; i < 7; i++) level.render(0.1);
    expect(level._cameraFocus).toBeNull();
    expect(level._camera.target).toEqual({ x: 5, z: -4 });
    expect(level._camera.span).toBeCloseTo(9);
    const center = projectColonySurfacePoint(level._viewProjection, level._bodySurface.radius, 5, 0, -4);
    expect(center[0]).toBeCloseTo(0);
    expect(center[1]).toBeCloseTo(0);
    level.render(0.1);
    expect(level._camera.span).toBeCloseTo(9);
  });

  it('focuses during entry without skipping the planet-to-colony projection transition', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, scene({ slots: [{ x: 5, z: -4, type: 'habitat', level: 2 }] }));
    level.render(0.1);
    level._selected = level._slots[0];
    const progress = level._camera.progress;
    level._updateHud();
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Focus building').click();
    expect(level._camera.progress).toBe(progress);
    expect(level._camera.target).toEqual({ x: 0, z: 0 });
    for (let i = 0; i < 13; i++) level.render(0.1);
    expect(level._camera.progress).toBe(1);
    expect(level._cameraFocus).toBeNull();
    expect(level._camera.target).toEqual({ x: 5, z: -4 });
    expect(level._camera.span).toBeCloseTo(9);
  });

  it.each(['wheel', 'keydown', 'pointerdown'])('cancels focus immediately on direct %s input', async (input) => {
    const { level, canvas } = await makeLevel();
    await level.enter(2, scene({ slots: [{ x: 5, z: -4, type: 'habitat', level: 2 }] }));
    for (let i = 0; i < 80; i++) level.render(0.016);
    level._selected = level._slots[0];
    level._focusBuilding();
    level.render(0.1);
    if (input === 'wheel') canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, cancelable: true }));
    if (input === 'keydown') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    if (input === 'pointerdown') canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, cancelable: true }));
    const target = { ...level._camera.target };
    const span = level._camera.span;
    expect(level._cameraFocus).toBeNull();
    for (let i = 0; i < 10; i++) level.render(0.1);
    expect(level._camera.target).toEqual(target);
    expect(level._camera.span).toBeCloseTo(span);
  });

  it('enforces safe zoom for focus and clears pending movement on scene replacement and exit', async () => {
    const { level } = await makeLevel();
    await level.enter(2, scene());
    level._minCameraSpan = 12;
    level._setCameraSpan(1);
    expect(level._camera.span).toBe(12);
    level._focusBuilding(level._slots[0]);
    expect(level._cameraFocus.toSpan).toBe(12);
    for (let i = 0; i < 13; i++) level.render(0.1);
    expect(level._camera.span).toBeCloseTo(12);
    level._focusBuilding(level._slots[0]);
    level.setSceneData(scene({ colony: { id: 8 } }));
    expect(level._cameraFocus).toBeNull();
    level._focusBuilding(level._slots[0]);
    await level.exit();
    expect(level._cameraFocus).toBeNull();
  });

  it('retains the clearance limit when entry continues after a manual close zoom', async () => {
    const { level } = await makeLevel();
    await level.enter(2, scene());
    level.render(0.1);
    level._setCameraSpan(level._minCameraSpan);
    for (let i = 0; i < 13; i++) {
      level.render(0.1);
      expect(level._camera.span).toBeGreaterThanOrEqual(level._minCameraSpan);
    }
    expect(level._camera.span).toBeCloseTo(level._minCameraSpan);
  });

  it('replaces populated scenes with an empty colony without ghost instances or emitters', async () => {
    const { level } = await makeLevel();
    await level.enter(2, scene());
    level.setSceneData(scene());
    const count = level._slotCount;
    level.setSceneData(scene({ slots: [] }));
    expect(level._slots).toHaveLength(0);
    expect(level._people).toHaveLength(0);
    expect(level._slotCount).toBeLessThan(count);
    expect(level._buildingVfxVertexCount).toBe(0);
  });

  it('uses the existing frame hook, owns no RAF and restores galaxy rendering on exit/disposal', async () => {
    const { canvas, backend } = await makeLevel();
    let tick;
    const remove = vi.fn();
    Object.assign(backend, {
      backendType: 'webgpu',
      addFrameHook: vi.fn((hook) => { tick = hook; return remove; }),
      setZoomSceneActive: vi.fn(),
    });
    const orchestrator = new SeamlessZoomOrchestrator(canvas, { backend, requireSharedBackend: true });
    const surface = new ColonySurfaceLevelWebGPU();
    levels.push(surface);
    const galaxy = { initialize: vi.fn(), enter: vi.fn(), exit: vi.fn(), render: vi.fn(), dispose: vi.fn() };
    orchestrator.register(3, { threejs: class { constructor() { return surface; } } });
    orchestrator.register(0, { threejs: class { constructor() { return galaxy; } } });
    await orchestrator.initialize();
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_SURFACE, scene());
    expect(orchestrator._rafId).toBe(0);
    tick(0.016);
    expect(backend.device.queue.submit).toHaveBeenCalled();
    expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(true);
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null);
    expect(backend.setZoomSceneActive).toHaveBeenLastCalledWith(false);
    expect(surface._active).toBe(false);
    orchestrator.dispose();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('renders the incoming planet during flight and retains the final camera pose', async () => {
    const canvas = document.createElement('canvas');
    const orchestrator = new SeamlessZoomOrchestrator(canvas);
    orchestrator._backend = {};
    const incoming = {
      initialize: vi.fn(), enter: vi.fn(), exit: vi.fn(), render: vi.fn(), dispose: vi.fn(),
    };
    orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { threejs: class { constructor() { return incoming; } } });
    const promise = orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, { flyDuration: 100 });
    await vi.waitFor(() => expect(orchestrator._active).toBe(incoming));
    orchestrator.tick(0.05);
    expect(incoming.render.mock.calls[0][1].t).toBeGreaterThan(0);
    orchestrator.tick(0.05);
    await promise;
    orchestrator.tick(0.016);
    expect(incoming.render.mock.lastCall[1]).toMatchObject({ t: 1, position: { z: 15 } });
  });

  it('returns from a colony to its planet, then from the planet to its system', async () => {
    const orchestrator = new SeamlessZoomOrchestrator(document.createElement('canvas'));
    orchestrator._backend = {};
    vi.spyOn(SeamlessZoomOrchestrator, '_requiresCameraFlight')
      .mockImplementation((level) => level === ZOOM_LEVEL.PLANET_APPROACH);
    const flyTo = vi.spyOn(orchestrator._flight, 'flyTo').mockResolvedValue(undefined);
    let planetNavigation;
    let colonyNavigation;
    const makeRenderer = (capture) => ({
      _initialised: true,
      initialize: vi.fn(),
      enter: vi.fn(),
      exit: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
      setNavigationHandlers: vi.fn((handlers) => { capture(handlers); }),
    });
    const renderers = {
      [ZOOM_LEVEL.SYSTEM]: makeRenderer(() => {}),
      [ZOOM_LEVEL.PLANET_APPROACH]: makeRenderer((handlers) => { planetNavigation = handlers; }),
      [ZOOM_LEVEL.COLONY_SURFACE]: makeRenderer((handlers) => { colonyNavigation = handlers; }),
    };
    for (const [depth, renderer] of Object.entries(renderers)) {
      orchestrator.register(Number(depth), { threejs: class { constructor() { return renderer; } } });
    }

    await orchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, null);
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, { id: 'planet' });
    await orchestrator.zoomTo(ZOOM_LEVEL.COLONY_SURFACE, { colony: { id: 7 } });
    colonyNavigation.back();
    await vi.waitFor(() => expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.PLANET_APPROACH));
    planetNavigation.back();
    await vi.waitFor(() => expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.SYSTEM));
    expect(flyTo).toHaveBeenCalledOnce();
    orchestrator.dispose();
  });
});

describe('Integrated colony building depth', () => {
  it('enters and leaves building depth without exiting, rebuilding or requesting another snapshot', async () => {
    const { level, orchestrator, resolve, host } = await makeCityOrchestrator();
    const exit = vi.spyOn(level, 'exit');
    const enter = vi.spyOn(level, 'enter');
    const events = [];
    orchestrator.on('exitLevel', (depth) => events.push(['exit', depth]));
    orchestrator.on('enterLevel', (depth) => events.push(['enter', depth]));
    const buffers = [level._instanceBuffer, level._cameraBuffer, level._depthTexture];
    const original = { target: { ...level._camera.target }, span: level._camera.span };
    const requests = fetch.mock.calls.length;
    await orchestrator.zoomToTarget({ ...level._slots[0], spatialDepth: ZOOM_LEVEL.COLONY_BUILDING });
    expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.COLONY_BUILDING);
    expect(orchestrator._active).toBe(level);
    expect(level._cameraFocus).not.toBeNull();
    expect(host.textContent).toContain('Back to colony');
    for (let frame = 0; frame < 50; frame++) orchestrator.tick(0.016);
    expect(level._camera.span).toBeCloseTo(9);
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Back to colony').click();
    expect(orchestrator._activeLevel).toBe(ZOOM_LEVEL.COLONY_SURFACE);
    for (let frame = 0; frame < 50; frame++) orchestrator.tick(0.016);
    expect(level._camera.target).toEqual(original.target);
    expect(level._camera.span).toBeCloseTo(original.span);
    expect([level._instanceBuffer, level._cameraBuffer, level._depthTexture]).toEqual(buffers);
    expect(resolve).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(events).toEqual([['exit', 3], ['enter', 5], ['exit', 5], ['enter', 3]]);
  });

  it('keeps the original colony pose when switching between building targets', async () => {
    const { level, orchestrator } = await makeCityOrchestrator(scene({
      slots: [{ x: 5, z: 2, type: 'habitat', level: 2 }, { x: -5, z: -2, type: 'factory', level: 3 }],
    }));
    level._camera.target = { x: 2, z: 3 };
    level._setCameraSpan(32);
    await orchestrator.zoomTo(5, { building: level._slots[0], colonyId: 7 });
    for (let frame = 0; frame < 50; frame++) orchestrator.tick(0.016);
    await orchestrator.zoomTo(5, { target: level._slots[1] });
    for (let frame = 0; frame < 50; frame++) orchestrator.tick(0.016);
    expect(level._camera.target).toEqual({ x: -5, z: -2 });
    await orchestrator.zoomTo(3);
    for (let frame = 0; frame < 50; frame++) orchestrator.tick(0.016);
    expect(level._camera.target).toEqual({ x: 2, z: 3 });
    expect(level._camera.span).toBeCloseTo(32);
  });

  it.each(['double-click', 'wheel', 'keyboard'])('opens the selected building through %s and returns to colony first', async (input) => {
    const { level, orchestrator, canvas } = await makeCityOrchestrator();
    level._selected = level._slots[0];
    level._setCameraSpan(10);
    if (input === 'double-click') canvas.dispatchEvent(new MouseEvent('dblclick'));
    if (input === 'wheel') canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -150, cancelable: true }));
    if (input === 'keyboard') window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', cancelable: true }));
    expect(orchestrator._activeLevel).toBe(5);
    for (let frame = 0; frame < 50; frame++) orchestrator.tick(0.016);
    if (input === 'wheel') canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 150, cancelable: true }));
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(orchestrator._activeLevel).toBe(3);
    expect(level._active).toBe(true);
  });

  it('rejects unknown and foreign buildings without changing level or camera', async () => {
    const { level, orchestrator } = await makeCityOrchestrator();
    for (const payload of [
      { key: 'unknown' },
      { ...level._slots[0], colonyId: 8 },
      { target: { ...level._slots[0], colony_id: 8 } },
      { building: level._slots[0], colony: { id: 8 } },
    ]) {
      await expect(orchestrator.zoomTo(5, payload)).rejects.toThrow(/building|colony/i);
      expect(orchestrator._activeLevel).toBe(3);
      expect(orchestrator._transition).toBe(false);
      expect(level._buildingView).toBeNull();
    }
  });

  it('refreshes authoritative building levels in place and leaves detail if the building disappears', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => scene({ success: true, economy: {} }) });
    const { level, orchestrator, resolve } = await makeCityOrchestrator();
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    await orchestrator.zoomTo(5, level._slots[0]);
    for (let frame = 0; frame < 50; frame++) orchestrator.tick(0.016);
    fetch.mockResolvedValue({ ok: true, json: async () => scene({
      success: true, economy: {}, slots: [{ x: 0, z: 0, type: 'habitat', level: 6 }],
    }) });
    await level._loadSnapshot();
    expect(orchestrator._activeLevel).toBe(5);
    expect(level._selected.level).toBe(6);
    expect(level._camera.span).toBeCloseTo(9);
    fetch.mockResolvedValue({ ok: true, json: async () => scene({ success: true, economy: {}, slots: [] }) });
    await level._loadSnapshot();
    expect(orchestrator._activeLevel).toBe(3);
    expect(level._buildingView).toBeNull();
    expect(level._selected).toBeNull();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('routes runtime surface updates to the active detail scene instead of resolving a second renderer', async () => {
    const { level, orchestrator, resolve } = await makeCityOrchestrator();
    await orchestrator.zoomTo(5, level._slots[0]);
    await orchestrator.setSceneData(3, scene({ colony: { id: 8 }, slots: [] }));
    expect(orchestrator._activeLevel).toBe(3);
    expect(level._sceneData.colony.id).toBe(8);
    expect(level._buildingView).toBeNull();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('unwinds building, colony, planet and system without overwriting the surface parent', async () => {
    const { level, orchestrator } = await makeCityOrchestrator();
    let planetNavigation;
    const planet = {
      _initialised: true, enter: vi.fn(), exit: vi.fn(), dispose: vi.fn(),
      setNavigationHandlers: (handlers) => { planetNavigation = handlers; },
    };
    const system = { _initialised: true, enter: vi.fn(), exit: vi.fn(), dispose: vi.fn() };
    orchestrator.register(1, { threejs: class { constructor() { return system; } } });
    orchestrator.register(2, { threejs: class { constructor() { return planet; } } });
    await orchestrator.zoomTo(5, level._slots[0]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(orchestrator._activeLevel).toBe(3);
    expect(orchestrator._surfaceReturnLevel).toBe(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect(orchestrator._activeLevel).toBe(2));
    expect(level._active).toBe(false);
    planetNavigation.back();
    await vi.waitFor(() => expect(orchestrator._activeLevel).toBe(1));
  });
});

describe('Colony window integration', () => {
  it('opens the city from real building data and routes building management back to the same colony', async () => {
    const { createColonyViewController } = require('../../js/engine/runtime/RuntimeColonyViewController.js');
    const root = document.createElement('div');
    root.innerHTML = '<button id="colony-open-surface-btn">3D city</button>';
    const zoomTo = vi.fn();
    window.__GQ_ZOOM_ORCHESTRATOR = { _backend: { backendType: 'webgpu' }, zoomTo };
    window.GQSeamlessZoomOrchestrator = { ZOOM_LEVEL };
    window.GQRuntimeColonySurfaceSlotMapping = mapping;
    const selectColonyById = vi.fn();
    const wm = { open: vi.fn() };
    const api = { buildings: vi.fn(async () => ({ success: true, buildings: [{ type: 'factory', level: 4 }] })) };
    const controller = createColonyViewController({
      wm, api, getCurrentColony: () => ({ id: 7, name: 'New Dawn' }), selectColonyById,
    });
    controller.bindActions(root);
    root.querySelector('button').click();
    await vi.waitFor(() => expect(zoomTo).toHaveBeenCalledOnce());
    const [level, payload] = zoomTo.mock.calls[0];
    expect(level).toBe(ZOOM_LEVEL.COLONY_SURFACE);
    expect(payload.slots[0]).toMatchObject({ type: 'factory', level: 4 });
    payload.onOpenBuildings();
    expect(selectColonyById).toHaveBeenCalledWith(7, { openWindows: false });
    expect(wm.open).toHaveBeenLastCalledWith('buildings');
  });
});

describe('On-demand authoritative snapshot lifecycle', () => {
  it('does not decode an obsolete HTTP snapshot after a newer refresh has completed', async () => {
    const { level } = await makeLevel();
    await level.enter(2, scene({ loadSnapshot: async () => scene({ success: true, economy: {} }) }));
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    delete level._sceneData.loadSnapshot;
    let finish;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = level.refreshSnapshot(7);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => scene({ success: true, economy: {},
      slots: [{ x: 0, z: 0, type: 'habitat', level: 6 }] }) });
    await level.refreshSnapshot(7);
    const decode = vi.fn(async () => scene({ success: true, economy: {}, slots: [] }));
    finish({ ok: true, json: decode });
    await old;
    expect(decode).not.toHaveBeenCalled();
    expect(level._slots[0].level).toBe(6);
  });

  it('reports a failed legacy building fallback while retaining confirmed scene data', async () => {
    const { level, host } = await makeLevel();
    const failure = new Error('Building snapshot offline');
    const onError = vi.fn();
    window.API = { buildings: vi.fn(async () => { throw failure; }) };
    try {
      await level.enter(2, scene({ slots: [], onError }));
      await vi.waitFor(() => expect(window.API.buildings).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(level._request).toBeNull());
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
      expect(host.textContent).toContain('Building snapshot offline');
      expect(level._slots).toEqual([]);
    } finally { delete window.API; }
  });

  it('ignores a failed legacy fallback after exit and re-entry', async () => {
    const { level } = await makeLevel();
    let reject;
    const onError = vi.fn();
    window.API = { buildings: vi.fn(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; })) };
    try {
      await level.enter(2, scene({ slots: [], onError }));
      await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
      await level.exit();
      await level.enter(2, scene({ loadSnapshot: async () => scene({ success: true, economy: {},
        slots: [{ x: 0, z: 0, type: 'habitat', level: 8 }] }), onError }));
      await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
      reject(new Error('Obsolete fallback failed'));
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(onError).not.toHaveBeenCalled();
      expect(level._slots[0].level).toBe(8);
      expect(level._snapshotState).toContain('Server snapshot');
    } finally { delete window.API; }
  });

  it('reports an unsuccessful legacy response instead of silently accepting it', async () => {
    const { level, host } = await makeLevel();
    const onError = vi.fn();
    window.API = { buildings: vi.fn(async () => ({ success: false, error: 'Building access denied' })) };
    try {
      await level.enter(2, scene({ slots: [], onError }));
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
      expect(onError.mock.calls[0][0].message).toBe('Building access denied');
      expect(host.textContent).toContain('Building access denied');
      expect(level._slots).toEqual([]);
    } finally { delete window.API; }
  });

  it('discards a snapshot body decoded after disposal without callbacks or fallback requests', async () => {
    const { level } = await makeLevel();
    let decode;
    fetch.mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { decode = resolve; }) });
    const onError = vi.fn();
    const onSnapshotLoaded = vi.fn();
    window.API = { buildings: vi.fn() };
    try {
      await level.enter(2, scene({ onError, onSnapshotLoaded }));
      await vi.waitFor(() => expect(decode).toBeTypeOf('function'));
      level.dispose();
      const apply = vi.spyOn(level, 'setSceneData');
      decode(scene({ success: true, economy: {} }));
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(apply).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(onSnapshotLoaded).not.toHaveBeenCalled();
      expect(window.API.buildings).not.toHaveBeenCalled();
      expect(level._request).toBeNull();
      expect(level._hud).toBeNull();
    } finally { delete window.API; }
  });

  it('refreshes only the matching active colony and preserves camera, selection and terrain residency', async () => {
    let response = scene({ success: true, economy: {} });
    const loadSnapshot = vi.fn(async () => response);
    const { level } = await makeLevel();
    await level.enter(2, scene({ loadSnapshot }));
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    for (let frame = 0; frame < 90; frame++) level.render(1 / 60);
    level._selected = level._slots[0];
    level.panView(20, 10);
    level.rotateView(35, 18);
    level._setCameraSpan(32);
    const camera = structuredClone(level._camera);
    const orbit = { ...level._orbit };
    const terrain = level._terrainBuffer;
    await level.refreshSnapshot(8);
    expect(loadSnapshot).toHaveBeenCalledOnce();
    response = scene({ success: true, economy: {}, slots: [
      { x: 0, z: 0, type: 'habitat', level: 4, upgrade_end: 'tomorrow' },
    ] });
    await level.refreshSnapshot(7);
    expect(level._camera).toEqual(camera);
    expect(level._orbit).toEqual(orbit);
    expect(level._selected).toMatchObject({ type: 'habitat', level: 4, upgrade_end: 'tomorrow' });
    expect(level._terrainBuffer).toBe(terrain);
    expect(level._hud.textContent).toContain('Construction in progress');
    await level.exit();
    await level.refreshSnapshot(7);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it('preserves a user-adjusted pose when the initial snapshot arrives late', async () => {
    let finish;
    const { level } = await makeLevel();
    await level.enter(2, scene({ loadSnapshot: () => new Promise((resolve) => { finish = resolve; }) }));
    level.render(0.1);
    level.panView(15, 20);
    level.rotateView(40, 0);
    level._setCameraSpan(35);
    const camera = structuredClone(level._camera);
    finish(scene({ success: true, economy: {}, slots: [{ x: 0, z: 0, type: 'habitat', level: 5 }] }));
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    expect(level._camera).toEqual(camera);
    expect(level._slots[0].level).toBe(5);
  });

  it('replaces pending reads after another accepted change and ignores late superseded results', async () => {
    const loadSnapshot = vi.fn(async () => scene({ success: true, economy: {} }));
    const { level } = await makeLevel();
    await level.enter(2, scene({ loadSnapshot }));
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    let finish;
    loadSnapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const old = level.refreshSnapshot(7);
    const signal = loadSnapshot.mock.calls.at(-1)[1];
    loadSnapshot.mockResolvedValueOnce(scene({ success: true, economy: {},
      slots: [{ x: 0, z: 0, type: 'habitat', level: 6 }] }));
    await level.refreshSnapshot(7);
    expect(signal.aborted).toBe(true);
    finish(scene({ success: true, economy: {}, slots: [] }));
    await old;
    expect(level._slots[0].level).toBe(6);
  });

  it('defers hidden-tab invalidation until visibility returns without polling', async () => {
    const loadSnapshot = vi.fn(async () => scene({ success: true, economy: {} }));
    const { level } = await makeLevel();
    await level.enter(2, scene({ loadSnapshot }));
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await level.refreshSnapshot(7);
    await level.refreshSnapshot(7);
    expect(loadSnapshot).toHaveBeenCalledOnce();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(2));
    document.dispatchEvent(new Event('visibilitychange'));
    for (let frame = 0; frame < 90; frame++) level.render(1 / 60);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });
  it('preserves the current pose on refresh during entry and cancels stale building focus', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => scene({ success: true, economy: {} }) });
    const { level } = await makeLevel();
    await level.enter(2, scene());
    await vi.waitFor(() => expect(level._snapshotLoaded).toBe(true));
    level.render(0.1);
    level._camera.target = { x: 2, z: 3 };
    level._setCameraSpan(40);
    level._focusBuilding(level._slots[0]);
    await level._loadSnapshot();
    expect(level._cameraFocus).toBeNull();
    level.render(0);
    expect(level._camera.target).toEqual({ x: 2, z: 3 });
    expect(level._camera.span).toBeCloseTo(40);
    expect(fetch.mock.calls.filter(([url]) => url.includes('colony_economy.php'))).toHaveLength(2);
  });

  it('loads once on entry, updates buildings/economy/people and never polls during rendering', async () => {
    const snapshot = scene({
      success: true, economy: { shortages: { food: 5 }, settled_at: 'server-time' },
      slots: [{ slot_x: 1, slot_y: 2, building_type: 'factory', level: 6 }],
    });
    fetch.mockResolvedValue({ ok: true, json: async () => snapshot });
    const { level, host } = await makeLevel();
    await level.enter(2, scene());
    await vi.waitFor(() => expect(level._slots[0].level).toBe(6));
    expect(fetch).toHaveBeenCalledWith('api/colony_economy.php?action=snapshot&colony_id=7', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    for (let i = 0; i < 100; i++) level.render(0.016);
    expect(fetch.mock.calls.filter(([url]) => url.includes('colony_economy.php'))).toHaveLength(1);
    expect(host.textContent).toContain('Colony shortage: food');
    expect(level._people.length).toBeGreaterThan(0);
    expect(snapshot.colony.population).toBe(10000);
  });

  it('makes rollout failure explicit and preserves the last building state', async () => {
    const { level, host } = await makeLevel();
    await level.enter(2, scene());
    await vi.waitFor(() => expect(host.textContent).toContain('requires on-demand rollout'));
    expect(level._slots[0].level).toBe(2);
    expect(level._sceneData.economy).toBeUndefined();
  });

  it('aborts on exit and ignores stale responses after a colony switch', async () => {
    let resolve;
    fetch.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { level } = await makeLevel();
    await level.enter(2, scene());
    const signal = fetch.mock.calls[0][1].signal;
    await level.exit();
    expect(signal.aborted).toBe(true);
    level.setSceneData(scene({ colony: { id: 9 }, slots: [] }));
    resolve({ ok: true, json: async () => scene({ success: true, economy: {}, slots: [{ type: 'stale_factory', level: 8 }] }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(level._sceneData.colony.id).toBe(9);
    expect(level._slots).toHaveLength(0);
  });

  it('does not request snapshots when the document is hidden', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { level } = await makeLevel();
    await level.enter(2, scene());
    await level._loadSnapshot();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('invalidates pending snapshots when runtime scene data changes colony without an exit', async () => {
    let resolve;
    fetch.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { level } = await makeLevel();
    await level.enter(2, scene());
    const signal = fetch.mock.calls[0][1].signal;
    level.setSceneData(scene({ colony: { id: 9 }, slots: [] }));
    expect(signal.aborted).toBe(true);
    resolve({ ok: true, json: async () => scene({ success: true, economy: {} }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(level._sceneData.colony.id).toBe(9);
  });
});
