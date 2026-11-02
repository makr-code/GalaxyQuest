import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ColonySurfaceLevelWebGPU, normalizeCitySlots, buildCityGeometry,
  cityCameraMatrix, projectCityPoint, mapColonySurfacePoint, projectColonySurfacePoint,
  resolveBodySurface, cityPedestrians, cityEconomyStatus,
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

describe('Isometric camera and shared WebGPU rendering', () => {
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
    expect(fetch).toHaveBeenCalledOnce();
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
