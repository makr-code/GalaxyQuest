/**
 * tests/webgpu/galaxy-webgpu-renderer.test.js
 *
 * Unit tests for Galaxy3DRendererWebGPU — the interactive WebGPU galaxy renderer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Load Galaxy3DRendererWebGPU into a mock window context
// ---------------------------------------------------------------------------

function loadRenderer() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'js/rendering/Galaxy3DRendererWebGPU.js'),
    'utf8',
  );
  // Evaluate in the global context (jsdom window)
  // eslint-disable-next-line no-eval
  window.eval(src);
  return window.Galaxy3DRendererWebGPU;
}

// Minimal mock HTMLElement container
function makeContainer() {
  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '600px';
  Object.defineProperty(el, 'clientWidth',  { value: 800, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  document.body.appendChild(el);
  return el;
}

// Sample star data
const SAMPLE_STARS = [
  { x_ly: 100,  y_ly:  50,  name: 'Sol',     spectral_class: 'G' },
  { x_ly: -80,  y_ly: -40,  name: 'Alpha',   spectral_class: 'A' },
  { x_ly:  30,  y_ly: 200,  name: 'Proxima', spectral_class: 'M' },
];

// ---------------------------------------------------------------------------

describe('Galaxy3DRendererWebGPU — constructor', () => {
  let Ctor;
  let container;

  beforeEach(() => {
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.Galaxy3DView;
    Ctor = loadRenderer();
    container = makeContainer();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is exposed on window', () => {
    expect(Ctor).toBeDefined();
    expect(typeof Ctor).toBe('function');
  });

  it('throws when container is missing', () => {
    expect(() => new Ctor(null)).toThrow(/missing container/i);
  });

  it('constructs without throwing when container is valid', () => {
    expect(() => new Ctor(container, {})).not.toThrow();
  });

  it('is not ready before init()', () => {
    const r = new Ctor(container, {});
    expect(r.ready).toBe(false);
  });

  it('initialises stars / starPoints to empty arrays', () => {
    const r = new Ctor(container, {});
    expect(Array.isArray(r.stars)).toBe(true);
    expect(Array.isArray(r.starPoints)).toBe(true);
    expect(r.stars.length).toBe(0);
  });

  it('sets window.GQGalaxy3DRendererWebGPU', () => {
    expect(window.GQGalaxy3DRendererWebGPU).toBe(Ctor);
  });
});

// ---------------------------------------------------------------------------

describe('Galaxy3DRendererWebGPU — WebGL2 fallback path', () => {
  let Ctor;
  let container;

  beforeEach(() => {
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.Galaxy3DView;

    // Ensure navigator.gpu is absent → forces WebGL2 fallback
    const nav = Object.create(navigator);
    delete nav.gpu;
    vi.stubGlobal('navigator', nav);

    // Provide a mock Three.js renderer
    window.Galaxy3DRenderer = vi.fn(function (cont, opts) {
      this.container = cont;
      this.opts      = opts;
      this.ready     = false;
      this.stars     = [];
      this.starPoints = [];
      this.backendType = 'webgl2';
      this.setStars     = vi.fn();
      this.setEmpires   = vi.fn();
      this.setGalaxyMetadata = vi.fn();
      this.setGalaxyFleets = vi.fn();
      this.setFtlInfrastructure = vi.fn();
      this.setClusterAuras = vi.fn();
      this.setClusterColorPalette = vi.fn();
      this.setCameraTarget = vi.fn();
      this.focusOnStar = vi.fn();
      this.resize = vi.fn();
      this.destroy = vi.fn();
      this.dispose = vi.fn();
      this.getRenderStats = vi.fn(() => ({ backend: 'webgl2' }));
      this.getQualityProfileState = vi.fn(() => ({ name: 'medium' }));
    });

    Ctor = loadRenderer();
    container = makeContainer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.Galaxy3DRenderer;
    document.body.innerHTML = '';
  });

  it('init() falls back to Three.js when WebGPU unavailable', async () => {
    const r = new Ctor(container, { interactive: true });
    await r.init();
    expect(r.ready).toBe(true);
    expect(r._backend).toBe('webgl2');
    expect(r._delegate).toBeTruthy();
  });

  it('delegates setStars to the Three.js renderer', async () => {
    const r = new Ctor(container, { interactive: true });
    await r.init();
    r.setStars(SAMPLE_STARS);
    expect(r._delegate.setStars).toHaveBeenCalledWith(SAMPLE_STARS, undefined);
  });

  it('delegates getRenderStats to the Three.js renderer', async () => {
    const r = new Ctor(container, { interactive: true });
    await r.init();
    const stats = r.getRenderStats();
    expect(r._delegate.getRenderStats).toHaveBeenCalled();
    expect(stats.backend).toBe('webgl2');
  });

  it('delegates getQualityProfileState to the Three.js renderer', async () => {
    const r = new Ctor(container, { interactive: true });
    await r.init();
    const state = r.getQualityProfileState();
    expect(state.name).toBe('medium');
  });

  it('delegates destroy to the Three.js renderer', async () => {
    const r = new Ctor(container, { interactive: true });
    await r.init();
    const delegate = r._delegate;
    r.destroy();
    expect(delegate.destroy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('Galaxy3DRendererWebGPU — native WebGPU path (mocked GPU)', () => {
  let Ctor;
  let container;
  let mockDevice;
  let mockQueue;
  let mockBuffer;
  let mockContext;
  let mockPipeline;
  let mockBindGroup;
  let mockAdapter;

  beforeEach(() => {
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.Galaxy3DView;

    mockBuffer = {
      destroy: vi.fn(),
    };
    mockQueue = {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
    };
    mockBindGroup = {};
    mockPipeline = {
      getBindGroupLayout: vi.fn(() => ({})),
    };
    mockContext = {
      configure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({
        createView: vi.fn(() => ({})),
      })),
    };
    mockAdapter = {
      requestDevice: vi.fn(async () => mockDevice),
    };
    mockDevice = {
      queue:                mockQueue,
      lost:                 new Promise(() => {}), // never resolves
      createBuffer:         vi.fn(() => mockBuffer),
      createShaderModule:   vi.fn(() => ({})),
      createBindGroupLayout:vi.fn(() => ({})),
      createBindGroup:      vi.fn(() => mockBindGroup),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => mockPipeline),
      createCommandEncoder: vi.fn(() => ({
        beginRenderPass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          setVertexBuffer: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        })),
        finish: vi.fn(() => ({})),
      })),
      destroy: vi.fn(),
    };

    // Stub navigator.gpu
    const mockGpu = {
      requestAdapter:         vi.fn(async () => mockAdapter),
      getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    };
    vi.stubGlobal('navigator', { ...globalThis.navigator, gpu: mockGpu });

    // Stub canvas.getContext to return webgpu context
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (type) {
      if (type === 'webgpu') return mockContext;
      return null;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800, height: 600, left: 0, top: 0,
    });

    Ctor = loadRenderer();
    container = makeContainer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('init() initialises WebGPU backend', async () => {
    const r = new Ctor(container, {});
    await r.init();
    expect(r.ready).toBe(true);
    expect(r._backend).toBe('webgpu');
    expect(r._device).toBeTruthy();
  });

  it('setStars uploads vertex buffer to GPU', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars(SAMPLE_STARS);
    expect(r._starCount).toBe(3);
    expect(mockDevice.createBuffer).toHaveBeenCalled();
    expect(mockQueue.writeBuffer).toHaveBeenCalled();
  });

  it('resize calls _configureContext', async () => {
    const r = new Ctor(container, {});
    await r.init();
    const spy = vi.spyOn(r, '_configureContext');
    r.resize();
    expect(spy).toHaveBeenCalled();
  });

  it('dispose stops render loop and destroys GPU resources', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars(SAMPLE_STARS);
    r.dispose();
    expect(r.ready).toBe(false);
    expect(mockDevice.destroy).toHaveBeenCalled();
  });

  it('getRenderStats returns backend=webgpu', async () => {
    const r = new Ctor(container, {});
    await r.init();
    const stats = r.getRenderStats();
    expect(stats.backend).toBe('webgpu');
  });

  it('getQualityProfileState returns webgpu-native profile', async () => {
    const r = new Ctor(container, {});
    await r.init();
    const state = r.getQualityProfileState();
    expect(state.name).toBe('webgpu-native');
  });

  it('creates a dedicated overlay canvas in native WebGPU mode', async () => {
    const r = new Ctor(container, {});
    await r.init();
    expect(r._overlayCanvas).toBeTruthy();
    expect(r._overlayCanvas.className).toContain('gq-webgpu-overlay-canvas');
    expect(container.contains(r._overlayCanvas)).toBe(true);
  });

  it('stores overlay datasets from fleet/ftl/cluster API setters', async () => {
    const r = new Ctor(container, {});
    await r.init();

    const fleets = [{ pos: { x: 10, y: 20 }, target: { x: 40, y: 60 } }];
    const gates = [{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }];
    const nodes = [{ pos: { x: -25, y: 15 } }];
    const clusters = [{ x: 12, y: 8, radius: 28, color: '#88aaff' }];

    r.setGalaxyFleets(fleets);
    r.setFtlInfrastructure(gates, nodes);
    r.setClusterAuras(clusters);

    expect(r._overlayData.fleets).toEqual(fleets);
    expect(r._overlayData.gates).toEqual(gates);
    expect(r._overlayData.nodes).toEqual(nodes);
    expect(r._overlayData.clusters).toEqual(clusters);
  });

  it('resolves overlay point references via galaxy/system star keys', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars([
      { x_ly: 100, y_ly: 50, galaxy_index: 1, system_index: 2, name: 'RefStar' },
    ]);

    const p = r._resolvePoint2({ galaxy_index: 1, system_index: 2 });
    expect(p).toEqual({ x: 100, y: 50 });
  });

  it('renders overlay frame with gate markers and fleet vectors without throwing', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars(SAMPLE_STARS);
    r.setFtlInfrastructure([{ a: { x: 100, y: 50 }, b: { x: -80, y: -40 } }], []);
    r.setGalaxyFleets([{ pos: { x: 100, y: 50 }, target: { x: 30, y: 200 } }]);

    expect(() => r._renderGalaxyOverlay2D()).not.toThrow();
  });

  it('renders overlay frame across low/high zoom values without throwing', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars(SAMPLE_STARS);
    r.setFtlInfrastructure([{ a: { x: 100, y: 50 }, b: { x: -80, y: -40 } }], [{ pos: { x: 30, y: 200 } }]);
    r.setGalaxyFleets([{ pos: { x: -80, y: -40 }, target: { x: 100, y: 50 } }]);

    r._view.zoom = 0.55;
    expect(() => r._renderGalaxyOverlay2D()).not.toThrow();

    r._view.zoom = 5.4;
    expect(() => r._renderGalaxyOverlay2D()).not.toThrow();
  });

  it('updates overlay fleet vector visibility flag', async () => {
    const r = new Ctor(container, {});
    await r.init();
    expect(r._overlayFleetVectorsVisible).toBe(true);
    r.setGalaxyFleetVectorsVisible(false);
    expect(r._overlayFleetVectorsVisible).toBe(false);
    r.setGalaxyFleetVectorsVisible(true);
    expect(r._overlayFleetVectorsVisible).toBe(true);
  });

  it('clears overlay datasets on resetNavigationView()', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setGalaxyFleets([{ pos: { x: 1, y: 2 } }]);
    r.setFtlInfrastructure([{ a: { x: 0, y: 0 }, b: { x: 2, y: 2 } }], [{ pos: { x: 3, y: 4 } }]);
    r.setClusterAuras([{ x: 9, y: 9, radius: 12 }]);

    r.resetNavigationView();

    expect(r._overlayData.fleets).toEqual([]);
    expect(r._overlayData.gates).toEqual([]);
    expect(r._overlayData.nodes).toEqual([]);
    expect(r._overlayData.clusters).toEqual([]);
  });

  it('removes overlay canvas on dispose()', async () => {
    const r = new Ctor(container, {});
    await r.init();
    const overlay = r._overlayCanvas;
    expect(overlay).toBeTruthy();
    expect(container.contains(overlay)).toBe(true);

    r.dispose();

    expect(container.contains(overlay)).toBe(false);
    expect(r._overlayCanvas).toBeNull();
  });

  it('dispose detaches interaction listeners', async () => {
    const removeCanvasSpy = vi.spyOn(HTMLCanvasElement.prototype, 'removeEventListener');
    const removeWindowSpy = vi.spyOn(window, 'removeEventListener');
    const r = new Ctor(container, {});
    await r.init();
    r.dispose();
    expect(removeCanvasSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeCanvasSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(removeCanvasSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(removeCanvasSpy).toHaveBeenCalledWith('click', expect.any(Function));
    expect(removeCanvasSpy).toHaveBeenCalledWith('dblclick', expect.any(Function));
    expect(removeWindowSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });
});

// ---------------------------------------------------------------------------

describe('Galaxy3DRendererWebGPU — camera / navigation API', () => {
  let Ctor;
  let container;

  beforeEach(() => {
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.Galaxy3DView;
    const nav = Object.create(navigator);
    delete nav.gpu;
    vi.stubGlobal('navigator', nav);
    // Provide stub Three.js fallback
    window.Galaxy3DRenderer = vi.fn(function () {
      this.ready = false;
      this.setTransitionsEnabled = vi.fn();
      this.setHoverMagnetConfig  = vi.fn();
      this.setClusterBoundsVisible = vi.fn();
      this.areClusterBoundsVisible = vi.fn(() => false);
      this.setGalacticCoreFxEnabled = vi.fn();
      this.areGalacticCoreFxEnabled = vi.fn(() => false);
      this.nudgeZoom   = vi.fn();
      this.nudgeOrbit  = vi.fn();
      this.nudgePan    = vi.fn();
      this.nudgeRoll   = vi.fn();
      this.fitCameraToStars = vi.fn();
      this.focusCurrentSelection = vi.fn();
      this.resetNavigationView = vi.fn();
      this.toggleFollowSelection = vi.fn(() => true);
      this.isFollowingSelection = vi.fn(() => true);
      this.enterSystemView = vi.fn();
      this.exitSystemView  = vi.fn();
      this.setCameraDriver = vi.fn();
      this.clearCameraDriver = vi.fn();
      this.focusOnStar = vi.fn();
      this.focusOnSystemPlanet = vi.fn();
      this.setOrbitSimulationMode = vi.fn();
      this.setSystemOrbitPathsVisible = vi.fn();
      this.setSystemOrbitMarkersVisible = vi.fn();
      this.setSystemOrbitFocusOnly = vi.fn();
      this.setClusterDensityMode = vi.fn();
      this.setGalaxyFleetVectorsVisible = vi.fn();
      this.setEmpireHeartbeatSystems = vi.fn();
      this.toggleScientificScale = vi.fn(() => false);
      this.getRenderStats = vi.fn(() => ({ backend: 'webgl2' }));
      this.getQualityProfileState = vi.fn(() => ({ name: 'medium' }));
      this.destroy = vi.fn();
      this.dispose = vi.fn();
      this.resize  = vi.fn();
    });
    Ctor = loadRenderer();
    container = makeContainer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.Galaxy3DRenderer;
    document.body.innerHTML = '';
  });

  async function makeReady() {
    const r = new Ctor(container, { interactive: true });
    await r.init();
    return r;
  }

  it('nudgeZoom delegates to Three.js', async () => {
    const r = await makeReady();
    r.nudgeZoom('in');
    expect(r._delegate.nudgeZoom).toHaveBeenCalledWith('in');
  });

  it('nudgeOrbit delegates to Three.js', async () => {
    const r = await makeReady();
    r.nudgeOrbit('left');
    expect(r._delegate.nudgeOrbit).toHaveBeenCalledWith('left');
  });

  it('nudgePan delegates to Three.js', async () => {
    const r = await makeReady();
    r.nudgePan('up');
    expect(r._delegate.nudgePan).toHaveBeenCalledWith('up');
  });

  it('nudgeRoll delegates to Three.js', async () => {
    const r = await makeReady();
    r.nudgeRoll('cw', 0.05);
    expect(r._delegate.nudgeRoll).toHaveBeenCalledWith('cw', 0.05);
  });

  it('resetNavigationView delegates', async () => {
    const r = await makeReady();
    r.resetNavigationView();
    expect(r._delegate.resetNavigationView).toHaveBeenCalled();
  });

  it('toggleFollowSelection delegates', async () => {
    const r = await makeReady();
    const result = r.toggleFollowSelection();
    expect(r._delegate.toggleFollowSelection).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('isFollowingSelection delegates', async () => {
    const r = await makeReady();
    const result = r.isFollowingSelection();
    expect(result).toBe(true);
  });

  it('enterSystemView delegates', async () => {
    const r = await makeReady();
    r.enterSystemView(SAMPLE_STARS[0], {});
    expect(r._delegate.enterSystemView).toHaveBeenCalledWith(SAMPLE_STARS[0], {});
  });

  it('exitSystemView delegates', async () => {
    const r = await makeReady();
    r.exitSystemView(true);
    expect(r._delegate.exitSystemView).toHaveBeenCalledWith(true);
  });

  it('toggleScientificScale delegates', async () => {
    const r = await makeReady();
    r.toggleScientificScale();
    expect(r._delegate.toggleScientificScale).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('Galaxy3DRendererWebGPU — native camera (no delegate)', () => {
  let Ctor;
  let container;

  beforeEach(() => {
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;

    // Stub GPU to fail so we test the "no delegate, no GPU" code paths
    const nav = Object.create(navigator);
    delete nav.gpu;
    vi.stubGlobal('navigator', nav);
    Ctor = loadRenderer();
    container = makeContainer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('init() sets backend=none when neither WebGPU nor Three.js available', async () => {
    const r = new Ctor(container, {});
    await r.init();
    expect(r.ready).toBe(true);
    expect(r._backend).toBe('none');
  });

  it('nudgeZoom adjusts targetZoom without delegate', async () => {
    const r = new Ctor(container, {});
    await r.init();
    const before = r._view.targetZoom;
    r.nudgeZoom('in');
    expect(r._view.targetZoom).toBeGreaterThan(before);
  });

  it('nudgeZoom-out reduces targetZoom', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r._view.targetZoom = 2;
    r.nudgeZoom('out');
    expect(r._view.targetZoom).toBeLessThan(2);
  });

  it('nudgePan moves pan target', async () => {
    const r = new Ctor(container, {});
    await r.init();
    const beforeX = r._view.targetPanX;
    r.nudgePan('right');
    expect(r._view.targetPanX).toBeGreaterThan(beforeX);
  });

  it('resetNavigationView resets view state', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r._view.targetPanX = 0.5;
    r._view.targetPanY = 0.5;
    r._view.targetZoom = 3;
    r.resetNavigationView();
    expect(r._view.targetPanX).toBe(0);
    expect(r._view.targetPanY).toBe(0);
    expect(r._view.targetZoom).toBe(1);
  });

  it('fitCameraToStars resets pan and sets zoom to 1 in galaxy mode', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r._view.targetPanX = 1;
    r._view.targetPanY = 1;
    r.fitCameraToStars(true, true);
    expect(r._view.targetPanX).toBe(0);
    expect(r._view.targetPanY).toBe(0);
    expect(r._view.targetZoom).toBe(1);
  });

  it('enterSystemView sets systemMode and increases zoom', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.enterSystemView(SAMPLE_STARS[0]);
    expect(r.systemMode).toBe(true);
    expect(r._view.targetZoom).toBeGreaterThanOrEqual(2.25);
  });

  it('exitSystemView clears systemMode', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.systemMode = true;
    r._view.targetZoom = 3;
    r.exitSystemView(true);
    expect(r.systemMode).toBe(false);
    expect(r._view.targetZoom).toBeLessThanOrEqual(1.2);
  });

  it('setClusterBoundsVisible toggles flag', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setClusterBoundsVisible(true);
    expect(r.areClusterBoundsVisible()).toBe(true);
    r.setClusterBoundsVisible(false);
    expect(r.areClusterBoundsVisible()).toBe(false);
  });

  it('setGalacticCoreFxEnabled toggles flag', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setGalacticCoreFxEnabled(true);
    expect(r.areGalacticCoreFxEnabled()).toBe(true);
  });

  it('toggleScientificScale flips the flag', async () => {
    const r = new Ctor(container, {});
    await r.init();
    expect(r.toggleScientificScale()).toBe(true);
    expect(r.toggleScientificScale()).toBe(false);
  });

  it('setCameraDriver + clearCameraDriver', async () => {
    const r = new Ctor(container, {});
    await r.init();
    const driver = { update: vi.fn() };
    r.setCameraDriver(driver, {});
    expect(r._cameraDriver).toBe(driver);
    r.clearCameraDriver();
    expect(r._cameraDriver).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('Galaxy3DRendererWebGPU — star data and color', () => {
  let Ctor;
  let container;

  beforeEach(() => {
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    const nav = Object.create(navigator);
    delete nav.gpu;
    vi.stubGlobal('navigator', nav);
    Ctor = loadRenderer();
    container = makeContainer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('setStars populates stars and starPoints', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars(SAMPLE_STARS);
    expect(r.stars.length).toBe(3);
    expect(r.starPoints.length).toBe(3);
  });

  it('setStars with empty array clears stars', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars(SAMPLE_STARS);
    r.setStars([]);
    expect(r.stars.length).toBe(0);
  });

  it('getRenderStats reports rawStars count', async () => {
    const r = new Ctor(container, {});
    await r.init();
    r.setStars(SAMPLE_STARS);
    const stats = r.getRenderStats();
    expect(stats.rawStars).toBe(3);
  });
});
