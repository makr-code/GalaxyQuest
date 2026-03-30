/**
 * tests/webgpu/webgl-renderer.test.js
 *
 * Unit tests for WebGLRenderer — the IGraphicsRenderer adapter that wraps
 * THREE.WebGLRenderer.
 *
 * THREE.WebGLRenderer is fully mocked so these tests run headlessly without
 * a real GPU or canvas context.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Build a complete THREE.WebGLRenderer mock before importing the module
// ---------------------------------------------------------------------------

function makeMockThreeRenderer() {
  return {
    domElement: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    outputColorSpace: '',
    capabilities: {
      isWebGL2: true,
      floatFragmentTextures: true,
      maxTextureSize: 8192,
      getMaxAnisotropy: vi.fn(() => 16),
    },
    setPixelRatio:    vi.fn(),
    getPixelRatio:    vi.fn(() => 2),
    setSize:          vi.fn(),
    setClearColor:    vi.fn(),
    compile:          vi.fn(),
    render:           vi.fn(),
    dispose:          vi.fn(),
  };
}

// Inject a minimal THREE global so the module can be loaded
let mockThreeRenderer;

beforeEach(() => {
  mockThreeRenderer = makeMockThreeRenderer();

  globalThis.THREE = {
    WebGLRenderer:       vi.fn(() => mockThreeRenderer),
    WebGLRenderTarget:   vi.fn(() => ({})),
    DataTexture:         vi.fn(() => ({ needsUpdate: false })),
    SRGBColorSpace:      'srgb',
    ACESFilmicToneMapping: 1,
    LinearFilter:        1,
    RGBAFormat:          1,
    UnsignedByteType:    1,
  };
});

afterEach(() => {
  delete globalThis.THREE;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: import a fresh WebGLRenderer instance
// ---------------------------------------------------------------------------

async function getWebGLRendererClass() {
  // Use dynamic import so the module picks up the mocked THREE global each time
  const mod = await import('../../js/engine/core/WebGLRenderer.js?t=' + Date.now());
  return mod.WebGLRenderer;
}

// ---------------------------------------------------------------------------
// IGraphicsRenderer interface compliance
// ---------------------------------------------------------------------------

describe('WebGLRenderer — IGraphicsRenderer compliance', () => {
  it('implements every IGraphicsRenderer method', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();

    await r.initialize({ /* fake canvas */ });
    expect(typeof r.getCapabilities).toBe('function');
    expect(typeof r.createBuffer).toBe('function');
    expect(typeof r.createTexture).toBe('function');
    expect(typeof r.createShader).toBe('function');
    expect(typeof r.createRenderPass).toBe('function');
    expect(typeof r.render).toBe('function');
    expect(typeof r.resize).toBe('function');
    expect(typeof r.dispose).toBe('function');
  });

  it('initialize() sets ready = true and creates _threeRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    expect(r.ready).toBe(false);

    await r.initialize({});
    expect(r.ready).toBe(true);
    expect(r._threeRenderer).toBe(mockThreeRenderer);
  });

  it('initialize() throws when THREE is not loaded', async () => {
    delete globalThis.THREE;
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await expect(r.initialize({})).rejects.toThrow(/Three\.js/);
    globalThis.THREE = {}; // restore minimal global for afterEach
  });
});

// ---------------------------------------------------------------------------
// Synchronous construction (Galaxy3DRenderer path)
// ---------------------------------------------------------------------------

describe('WebGLRenderer — synchronous construction', () => {
  it('accepts THREE options in constructor and is immediately ready', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const opts = { antialias: true, alpha: false };
    const r = new WebGLRenderer(opts);

    expect(r.ready).toBe(true);
    expect(r._threeRenderer).toBe(mockThreeRenderer);
    // THREE.WebGLRenderer called with the provided options
    expect(globalThis.THREE.WebGLRenderer).toHaveBeenCalledWith(opts);
  });

  it('constructor with null options is not ready until initialize()', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer(null);
    expect(r.ready).toBe(false);

    await r.initialize({});
    expect(r.ready).toBe(true);
  });

  it('constructor with no args is not ready until initialize()', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    expect(r.ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe('WebGLRenderer — getCapabilities()', () => {
  it('returns safe defaults before initialization', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    const caps = r.getCapabilities();
    expect(caps.webgpu).toBe(false);
    expect(caps.webgl2).toBe(false);
    expect(caps.maxTextureSize).toBe(0);
  });

  it('returns Three.js capability data after initialization', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});
    const caps = r.getCapabilities();
    expect(caps.webgpu).toBe(false);
    expect(caps.webgl2).toBe(true);
    expect(caps.computeShaders).toBe(false);
    expect(caps.float32Textures).toBe(true);
    expect(caps.depthTextures).toBe(true);
    expect(caps.maxTextureSize).toBe(8192);
    expect(caps.maxAnisotropy).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// render / resize / dispose
// ---------------------------------------------------------------------------

describe('WebGLRenderer — render / resize / dispose', () => {
  it('render() delegates to THREE.WebGLRenderer.render()', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    const scene  = {};
    const camera = {};
    r.render(scene, camera);
    expect(mockThreeRenderer.render).toHaveBeenCalledWith(scene, camera);
  });

  it('render() is a no-op before initialization', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    expect(() => r.render({}, {})).not.toThrow();
    expect(mockThreeRenderer.render).not.toHaveBeenCalled();
  });

  it('resize() delegates to THREE.WebGLRenderer.setSize()', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});
    r.resize(1280, 720);
    expect(mockThreeRenderer.setSize).toHaveBeenCalledWith(1280, 720, false);
  });

  it('dispose() disposes THREE.WebGLRenderer and resets state', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});
    r.dispose();
    expect(mockThreeRenderer.dispose).toHaveBeenCalled();
    expect(r._threeRenderer).toBeNull();
    expect(r.ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Three.js-compatible pass-through API
// ---------------------------------------------------------------------------

describe('WebGLRenderer — Three.js pass-through API', () => {
  it('domElement returns the canvas element', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});
    expect(r.domElement).toBe(mockThreeRenderer.domElement);
  });

  it('domElement returns null before initialization', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    expect(r.domElement).toBeNull();
  });

  it('outputColorSpace getter/setter delegates to _threeRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    r.outputColorSpace = 'srgb';
    expect(mockThreeRenderer.outputColorSpace).toBe('srgb');
    expect(r.outputColorSpace).toBe('srgb');
  });

  it('setPixelRatio() delegates to _threeRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    r.setPixelRatio(2);
    expect(mockThreeRenderer.setPixelRatio).toHaveBeenCalledWith(2);
  });

  it('getPixelRatio() delegates to _threeRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    const ratio = r.getPixelRatio();
    expect(mockThreeRenderer.getPixelRatio).toHaveBeenCalled();
    expect(ratio).toBe(2);
  });

  it('getPixelRatio() returns 1 before initialization', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    expect(r.getPixelRatio()).toBe(1);
  });

  it('setClearColor() delegates to _threeRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    r.setClearColor(0x000000, 0);
    expect(mockThreeRenderer.setClearColor).toHaveBeenCalledWith(0x000000, 0);
  });

  it('setSize() delegates to _threeRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    r.setSize(800, 600);
    expect(mockThreeRenderer.setSize).toHaveBeenCalledWith(800, 600, true);
  });

  it('setSize() passes updateStyle argument', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    r.setSize(800, 600, false);
    expect(mockThreeRenderer.setSize).toHaveBeenCalledWith(800, 600, false);
  });

  it('compile() delegates to _threeRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});

    const scene  = {};
    const camera = {};
    r.compile(scene, camera);
    expect(mockThreeRenderer.compile).toHaveBeenCalledWith(scene, camera);
  });

  it('pass-through methods are no-ops before initialization', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();

    expect(() => r.setPixelRatio(1)).not.toThrow();
    expect(() => r.setClearColor(0, 0)).not.toThrow();
    expect(() => r.setSize(1, 1)).not.toThrow();
    expect(() => r.compile({}, {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// threeRenderer accessor
// ---------------------------------------------------------------------------

describe('WebGLRenderer — threeRenderer accessor', () => {
  it('exposes the underlying THREE.WebGLRenderer', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});
    expect(r.threeRenderer).toBe(mockThreeRenderer);
  });

  it('returns null before initialization', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    expect(r.threeRenderer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createBuffer / createTexture / createShader / createRenderPass
// ---------------------------------------------------------------------------

describe('WebGLRenderer — resource creation', () => {
  it('createBuffer returns a WebGL buffer descriptor', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    const buf = r.createBuffer('vertex', new Float32Array([1, 2, 3]), 'static');
    expect(buf._backend).toBe('webgl');
    expect(buf.type).toBe('vertex');
  });

  it('createShader returns vertex/fragment sources', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    const sh = r.createShader('void main(){}', 'void main(){}');
    expect(sh._backend).toBe('webgl');
    expect(sh.vertexShader).toBe('void main(){}');
    expect(sh.fragmentShader).toBe('void main(){}');
  });

  it('createRenderPass returns a pass descriptor', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    const pass = r.createRenderPass({ clearColor: true });
    expect(pass._type).toBe('webgl-render-pass');
    expect(pass.clearColor).toBe(true);
  });

  it('createTexture (renderTarget) delegates to THREE.WebGLRenderTarget', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});
    const tex = r.createTexture({ width: 64, height: 64, renderTarget: true });
    expect(globalThis.THREE.WebGLRenderTarget).toHaveBeenCalled();
    expect(tex).toBeTruthy();
  });

  it('createTexture (plain) delegates to THREE.DataTexture', async () => {
    const WebGLRenderer = await getWebGLRendererClass();
    const r = new WebGLRenderer();
    await r.initialize({});
    const tex = r.createTexture({ width: 4, height: 4 });
    expect(globalThis.THREE.DataTexture).toHaveBeenCalled();
    expect(tex).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GameEngine.createWithRenderer integration
// ---------------------------------------------------------------------------

describe('WebGLRenderer — GameEngine.createWithRenderer integration', () => {
  it('can be used with GameEngine.createWithRenderer', async () => {
    const { GameEngine } = await import('../../js/engine/GameEngine.js');
    const WebGLRenderer = await getWebGLRendererClass();

    const renderer = new WebGLRenderer();
    await renderer.initialize({});

    const canvas = { width: 800, height: 600, parentElement: null };
    const engine  = await GameEngine.createWithRenderer(renderer, canvas, { postFx: false });

    expect(engine.renderer).toBe(renderer);
    expect(engine.initialized).toBe(true);
    const caps = engine.renderer.getCapabilities();
    expect(caps.webgl2).toBe(true);
    expect(caps.webgpu).toBe(false);
  });
});
