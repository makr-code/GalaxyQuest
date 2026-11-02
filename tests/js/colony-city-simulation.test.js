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
  const resolve = vi.spyOn(orchestrator._registry, 'resolve').mockImplementation((depth) => {
    if (depth !== ZOOM_LEVEL.COLONY_SURFACE) throw new Error('Building must reuse the live surface');
    return level;
  });
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
    const terrain = terrainFor('terran');
    const mesh = buildColonyTerrainMesh(terrain);
    expect(mesh.vertexCount).toBe(104 * 128 * 6);
    expect(mesh.vertices.byteLength).toBeLessThan(2.5 * 1024 * 1024);
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    const radialHeights = [];
    for (let i = 0; i < mesh.vertices.length; i += 7) {
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
    const city = buildCityGeometry(normalizeCitySlots(scene()), scene());
    const radius = resolveBodySurface(scene(), city.width, city.depth).radius;
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
    expect(level._terrainBuffer.size).toBe(172032);
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

  it('filters procedural grain, strata and waves using their actual pixel footprint', () => {
    expect(COLONY_BODY_WGSL).toContain('fwidth(grainPhase.x)');
    expect(COLONY_BODY_WGSL).toContain('fwidth(strataPhase)');
    expect(COLONY_BODY_WGSL).toContain('fwidth(ripplePhase.x)');
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
    orchestrator._registry.resolve = (level) => level === 3 ? surface : galaxy;
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
      initialize: vi.fn(), enter: vi.fn(), exit: vi.fn(), render: vi.fn(),
    };
    orchestrator._registry.resolve = () => incoming;
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
      setNavigationHandlers: vi.fn((handlers) => { capture(handlers); }),
    });
    const renderers = {
      [ZOOM_LEVEL.SYSTEM]: makeRenderer(() => {}),
      [ZOOM_LEVEL.PLANET_APPROACH]: makeRenderer((handlers) => { planetNavigation = handlers; }),
      [ZOOM_LEVEL.COLONY_SURFACE]: makeRenderer((handlers) => { colonyNavigation = handlers; }),
    };
    orchestrator._registry.resolve = (level) => renderers[level];

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
    const { level, orchestrator, resolve } = await makeCityOrchestrator();
    let planetNavigation;
    const planet = {
      _initialised: true, enter: vi.fn(), exit: vi.fn(),
      setNavigationHandlers: (handlers) => { planetNavigation = handlers; },
    };
    const system = { _initialised: true, enter: vi.fn(), exit: vi.fn() };
    resolve.mockImplementation((depth) => ({ 1: system, 2: planet, 3: level })[depth]);
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
