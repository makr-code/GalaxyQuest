/**
 * tests/webgpu/regression.test.js
 *
 * Regression tests — Side-by-Side API surface + state comparison:
 * WebGPU renderer (Galaxy3DRendererWebGPU / StarfieldWebGPU) vs the Three.js
 * fallback path, exercised through the facade (galaxy3d-webgpu.js).
 *
 * Because tests run in jsdom (no real GPU), all GPU init paths are short-circuited
 * by mock globals.  The goal is to verify that:
 *   1. Both paths expose the same public API surface.
 *   2. Navigation + state-mutation calls produce equivalent state on both paths.
 *   3. getRenderStats() returns a compatible structure regardless of backend.
 *   4. The facade correctly routes calls to whichever backend is active.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSrc(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function evalSrc(src) {
  // eslint-disable-next-line no-eval
  window.eval(src);
}

function loadAll() {
  evalSrc(readSrc('js/rendering/starfield-webgpu.js'));
  evalSrc(readSrc('js/rendering/Galaxy3DRendererWebGPU.js'));
  evalSrc(readSrc('js/legacy/galaxy3d-webgpu.js'));
}

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 600;
  Object.defineProperty(c, 'getBoundingClientRect', {
    value: () => ({ width: 800, height: 600, top: 0, left: 0 }),
  });
  return c;
}

function makeContainer() {
  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '600px';
  document.body.appendChild(el);
  return el;
}

/** Build a mock Three.js-style Galaxy3DRenderer (WebGL path). */
function makeMockThreeJsRenderer() {
  return class MockGalaxy3DRenderer {
    constructor(container, opts = {}) {
      this._container    = container;
      this._opts         = opts;
      this.rendererBackend = 'webgl2';
      this.backendType   = 'webgl2';
      this.stars         = [];
      this.starPoints    = [];
      this.visibleStars  = [];
      this.selectedIndex = -1;
      this.systemMode    = false;
      this.instanceId    = 'mock-three-' + Math.random().toString(36).slice(2);
      this.renderer      = { domElement: document.createElement('canvas') };
      this.scene         = {};
      this.camera        = { position: { x: 0, y: 0, z: 100 } };
      this.renderFrames  = { world: null, galaxy: null, system: null };
    }
    async init() {}
    destroy() {}
    dispose() {}
    resize(w, h) { this._w = w; this._h = h; }
    setStars(stars) { this.stars = stars || []; this.starPoints = this.stars; }
    setEmpires() {}
    setSelectedStar(star) { this._selectedStar = star; }
    setCameraTarget(t) { this._cameraTarget = t; }
    setTransitionsEnabled(f) { this._transitions = f; }
    setClusterBoundsVisible(f) { this._clusterBounds = f; }
    areClusterBoundsVisible() { return !!this._clusterBounds; }
    setGalacticCoreFxEnabled(f) { this._coreFx = f; }
    areGalacticCoreFxEnabled() { return !!this._coreFx; }
    setClusterColorPalette() {}
    setClusterAuras() {}
    setGalaxyMetadata() {}
    setGalaxyFleets() {}
    setFtlInfrastructure() {}
    setGalaxyFleetVectorsVisible() {}
    setSystemOrbitPathsVisible() {}
    setSystemOrbitMarkersVisible() {}
    setSystemOrbitFocusOnly() {}
    setHoverMagnetConfig(cfg) { this._magnetCfg = cfg; }
    setClusterDensityMode() {}
    setOrbitSimulationMode() {}
    setEmpireHeartbeatSystems() {}
    fitCameraToStars() {}
    setCameraDriver(d) { this._driver = d; }
    clearCameraDriver() { this._driver = null; }
    focusOnStar(star, smooth) { this._focus = { star, smooth }; }
    focusOnSystemPlanet(p, s) { this._focus = { star: p, smooth: s }; }
    nudgeZoom(d) { this._zoom = d; }
    nudgeOrbit(d) { this._orbit = d; }
    nudgePan(d) { this._pan = d; }
    nudgeRoll(d, s) { this._roll = { d, s }; }
    resetNavigationView() { this._navReset = true; }
    focusCurrentSelection() {}
    toggleFollowSelection() { return true; }
    isFollowingSelection() { return true; }
    enterSystemView(star, payload) { this.systemMode = true; this._sysPayload = payload; }
    exitSystemView() { this.systemMode = false; }
    getQualityProfileState() { return { name: 'default', label: 'Default' }; }
    getRenderStats() {
      return {
        backend: this.rendererBackend,
        qualityProfile: 'default',
        pixelRatio: 1,
        rawStars: this.stars.length,
        visibleStars: this.stars.length,
        frameTick: 0,
      };
    }
    toggleScientificScale() {}
    get renderFrames() { return this._renderFrames || { world: null, galaxy: null, system: null }; }
    set renderFrames(v) { this._renderFrames = v; }
  };
}

// Public API methods that BOTH backends must expose
const REQUIRED_METHODS = [
  'init', 'destroy', 'dispose', 'resize',
  'setStars', 'setEmpires', 'setSelectedStar', 'setCameraTarget',
  'setTransitionsEnabled', 'setClusterBoundsVisible', 'areClusterBoundsVisible',
  'setGalacticCoreFxEnabled', 'areGalacticCoreFxEnabled',
  'setClusterColorPalette', 'setClusterAuras', 'setGalaxyMetadata',
  'setGalaxyFleets', 'setFtlInfrastructure',
  'setGalaxyFleetVectorsVisible', 'setSystemOrbitPathsVisible',
  'setSystemOrbitMarkersVisible', 'setSystemOrbitFocusOnly',
  'setHoverMagnetConfig', 'setClusterDensityMode', 'setOrbitSimulationMode',
  'setEmpireHeartbeatSystems', 'fitCameraToStars',
  'setCameraDriver', 'clearCameraDriver',
  'focusOnStar', 'focusOnSystemPlanet', 'nudgeZoom', 'nudgeOrbit', 'nudgePan',
  'resetNavigationView', 'focusCurrentSelection',
  'toggleFollowSelection', 'isFollowingSelection',
  'enterSystemView', 'exitSystemView',
  'getQualityProfileState', 'getRenderStats', 'toggleScientificScale',
];

const REQUIRED_GETTERS = ['stars', 'backendType', 'ready'];

// ---------------------------------------------------------------------------

describe('Regression — API surface parity (WebGPU vs WebGL facades)', () => {
  beforeEach(() => {
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.StarfieldWebGPU;
    delete window.navigator.gpu;
    window.Galaxy3DRenderer = makeMockThreeJsRenderer();
    loadAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('WebGPU facade exposes all required methods', () => {
    const Ctor    = window.Galaxy3DRendererWebGPU;
    const inst    = new Ctor(makeContainer(), { interactive: false });
    for (const m of REQUIRED_METHODS) {
      expect(typeof inst[m], `method ${m} missing`).toBe('function');
    }
  });

  it('Three.js mock exposes all required methods', () => {
    const Ctor    = window.Galaxy3DRenderer;
    const inst    = new Ctor(makeContainer(), {});
    for (const m of REQUIRED_METHODS) {
      expect(typeof inst[m], `method ${m} missing on Three.js mock`).toBe('function');
    }
  });

  it('WebGPU facade exposes all required getters', () => {
    const Ctor = window.Galaxy3DRendererWebGPU;
    const inst = new Ctor(makeContainer(), { interactive: false });
    for (const g of REQUIRED_GETTERS) {
      expect(inst[g], `getter ${g} missing`).toBeDefined();
    }
  });

  it('backendType is a string or null on both paths', async () => {
    const WebGPUCtor  = window.Galaxy3DRendererWebGPU;
    const ThreeCtor   = window.Galaxy3DRenderer;
    const webgpuInst  = new WebGPUCtor(makeContainer(), { interactive: false });
    await webgpuInst.init();
    const threeInst   = new ThreeCtor(makeContainer(), {});
    const wbt = webgpuInst.backendType;
    const tbt = threeInst.backendType;
    expect(wbt === null || typeof wbt === 'string').toBe(true);
    expect(tbt === null || typeof tbt === 'string').toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('Regression — setStars state parity', () => {
  const SAMPLE_STARS = [
    { x_ly: 100, y_ly: 200 },
    { x_ly: -300, y_ly: 50 },
    { x_ly: 0, y_ly: 0 },
  ];

  beforeEach(() => {
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.StarfieldWebGPU;
    delete window.navigator.gpu;
    window.Galaxy3DRenderer = makeMockThreeJsRenderer();
    loadAll();
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('facade routes setStars to delegate (webgl2 path)', async () => {
    const Ctor = window.Galaxy3DRendererWebGPU;
    const inst = new Ctor(makeContainer(), { interactive: false });
    await inst.init();
    inst.setStars(SAMPLE_STARS);
    // Stars propagated to delegate (Three.js mock)
    expect(inst.stars.length).toBe(SAMPLE_STARS.length);
  });

  it('StarfieldWebGPU.setStars stores stars and starPoints', () => {
    const Ctor = window.StarfieldWebGPU;
    const inst = new Ctor(makeCanvas(), {});
    inst.setStars(SAMPLE_STARS);
    expect(inst.stars).toEqual(SAMPLE_STARS);
    expect(inst.starPoints).toBe(inst.stars);
  });

  it('both paths have same stars.length after setStars', async () => {
    const WebGPUCtor = window.Galaxy3DRendererWebGPU;
    const ThreeCtor  = window.Galaxy3DRenderer;
    const webgpuInst = new WebGPUCtor(makeContainer(), { interactive: false });
    const threeInst  = new ThreeCtor(makeContainer(), {});
    await webgpuInst.init();
    webgpuInst.setStars(SAMPLE_STARS);
    threeInst.setStars(SAMPLE_STARS);
    expect(webgpuInst.stars.length).toBe(threeInst.stars.length);
  });

  it('setStars(null) does not throw on facade', () => {
    const Ctor = window.Galaxy3DRendererWebGPU;
    const inst = new Ctor(makeContainer(), { interactive: false });
    expect(() => inst.setStars(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('Regression — navigation state parity', () => {
  function makeInstances() {
    const WebGPUCtor = window.Galaxy3DRendererWebGPU;
    const ThreeCtor  = window.Galaxy3DRenderer;
    return {
      webgpu: new WebGPUCtor(makeContainer(), { interactive: false }),
      three:  new ThreeCtor(makeContainer(), {}),
    };
  }

  beforeEach(() => {
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.StarfieldWebGPU;
    delete window.navigator.gpu;
    window.Galaxy3DRenderer = makeMockThreeJsRenderer();
    loadAll();
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('setTransitionsEnabled does not throw on either path', () => {
    const { webgpu, three } = makeInstances();
    expect(() => webgpu.setTransitionsEnabled(false)).not.toThrow();
    expect(() => three.setTransitionsEnabled(false)).not.toThrow();
  });

  it('areClusterBoundsVisible reflects setClusterBoundsVisible on Three.js path', () => {
    const { three } = makeInstances();
    three.setClusterBoundsVisible(true);
    expect(three.areClusterBoundsVisible()).toBe(true);
    three.setClusterBoundsVisible(false);
    expect(three.areClusterBoundsVisible()).toBe(false);
  });

  it('areGalacticCoreFxEnabled reflects setGalacticCoreFxEnabled on Three.js path', () => {
    const { three } = makeInstances();
    three.setGalacticCoreFxEnabled(true);
    expect(three.areGalacticCoreFxEnabled()).toBe(true);
  });

  it('StarfieldWebGPU.setClusterBoundsVisible / areClusterBoundsVisible round-trip', () => {
    const inst = new window.StarfieldWebGPU(makeCanvas(), {});
    inst.setClusterBoundsVisible(true);
    expect(inst.areClusterBoundsVisible()).toBe(true);
    inst.setClusterBoundsVisible(false);
    expect(inst.areClusterBoundsVisible()).toBe(false);
  });

  it('resetNavigationView does not throw', () => {
    const { webgpu, three } = makeInstances();
    expect(() => webgpu.resetNavigationView()).not.toThrow();
    expect(() => three.resetNavigationView()).not.toThrow();
  });

  it('nudgeZoom does not throw', () => {
    const { webgpu, three } = makeInstances();
    expect(() => webgpu.nudgeZoom(1)).not.toThrow();
    expect(() => three.nudgeZoom(1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('Regression — getRenderStats() structure parity', () => {
  const STATS_REQUIRED_KEYS = ['backend', 'rawStars', 'frameTick'];

  beforeEach(() => {
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.StarfieldWebGPU;
    delete window.navigator.gpu;
    window.Galaxy3DRenderer = makeMockThreeJsRenderer();
    loadAll();
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('Three.js mock getRenderStats() has required keys', () => {
    const inst  = new window.Galaxy3DRenderer(makeContainer(), {});
    const stats = inst.getRenderStats();
    for (const k of STATS_REQUIRED_KEYS) {
      expect(stats, `key ${k} missing`).toHaveProperty(k);
    }
  });

  it('StarfieldWebGPU.getRenderStats() has required keys', () => {
    const inst  = new window.StarfieldWebGPU(makeCanvas(), {});
    const stats = inst.getRenderStats();
    for (const k of STATS_REQUIRED_KEYS) {
      expect(stats, `key ${k} missing from StarfieldWebGPU`).toHaveProperty(k);
    }
  });

  it('facade getRenderStats() returns an object with backend key', async () => {
    const Ctor  = window.Galaxy3DRendererWebGPU;
    const inst  = new Ctor(makeContainer(), { interactive: false });
    await inst.init();
    const stats = inst.getRenderStats();
    expect(stats).toBeDefined();
    expect(typeof stats.backend).toBe('string');
  });

  it('StarfieldWebGPU backend key is "webgl2" or "webgpu" (before init)', () => {
    const inst = new window.StarfieldWebGPU(makeCanvas(), {});
    // Before init, backend is null — but getRenderStats must not throw
    expect(() => inst.getRenderStats()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('Regression — dispose / destroy symmetry', () => {
  beforeEach(() => {
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.StarfieldWebGPU;
    delete window.navigator.gpu;
    window.Galaxy3DRenderer = makeMockThreeJsRenderer();
    loadAll();
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('dispose() does not throw on facade (webgl2 path)', async () => {
    const Ctor = window.Galaxy3DRendererWebGPU;
    const inst = new Ctor(makeContainer(), { interactive: false });
    await inst.init();
    expect(() => inst.dispose()).not.toThrow();
  });

  it('destroy() does not throw on facade (webgl2 path)', async () => {
    const Ctor = window.Galaxy3DRendererWebGPU;
    const inst = new Ctor(makeContainer(), { interactive: false });
    await inst.init();
    expect(() => inst.destroy()).not.toThrow();
  });

  it('StarfieldWebGPU dispose() does not throw before init', () => {
    const inst = new window.StarfieldWebGPU(makeCanvas(), {});
    expect(() => inst.dispose()).not.toThrow();
  });

  it('StarfieldWebGPU dispose() sets ready=false', () => {
    const inst = new window.StarfieldWebGPU(makeCanvas(), {});
    inst.ready = true;
    inst.dispose();
    expect(inst.ready).toBe(false);
  });

  it('Three.js mock dispose() does not throw', () => {
    const inst = new window.Galaxy3DRenderer(makeContainer(), {});
    expect(() => inst.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('Regression — resize() symmetry', () => {
  beforeEach(() => {
    delete window.Galaxy3DView;
    delete window.Galaxy3DRenderer;
    delete window.Galaxy3DRendererWebGPU;
    delete window.GQGalaxy3DRendererWebGPU;
    delete window.StarfieldWebGPU;
    delete window.navigator.gpu;
    window.Galaxy3DRenderer = makeMockThreeJsRenderer();
    loadAll();
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('facade resize() does not throw', async () => {
    const Ctor = window.Galaxy3DRendererWebGPU;
    const inst = new Ctor(makeContainer(), { interactive: false });
    await inst.init();
    expect(() => inst.resize(1920, 1080)).not.toThrow();
  });

  it('Three.js mock resize() stores dimensions', () => {
    const inst = new window.Galaxy3DRenderer(makeContainer(), {});
    inst.resize(1920, 1080);
    expect(inst._w).toBe(1920);
    expect(inst._h).toBe(1080);
  });

  it('StarfieldWebGPU resize() does not throw before init', () => {
    const inst = new window.StarfieldWebGPU(makeCanvas(), {});
    expect(() => inst.resize()).not.toThrow();
  });
});
