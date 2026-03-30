/**
 * tests/webgpu/multicamera.test.js
 *
 * Tests for the multi-camera & PiP viewport system:
 *   - FollowCamera (modes, lag, orbit)
 *   - CameraManager (registry, follow-target, active)
 *   - ViewportManager (add/remove/visible — DOM-free via mock)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FollowCamera, FollowMode }  from '../../js/engine/scene/FollowCamera.js';
import { CameraManager }             from '../../js/engine/scene/CameraManager.js';
import { ViewportManager, PIP_DEFAULTS } from '../../js/engine/ViewportManager.js';
import { PerspectiveCamera }         from '../../js/engine/scene/Camera.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTarget(x = 0, y = 0, z = 0, name = 'target') {
  return { position: { x, y, z }, name };
}

function makeMockRenderer() {
  return {
    getCapabilities: () => ({ webgpu: false, webgl2: true }),
    createTexture: vi.fn(() => ({})),
  };
}

/** Minimal DOM mock for ViewportManager (no jsdom needed for most tests) */
function makeDomlessCameraManager() {
  const main = new PerspectiveCamera(60, 1, 0.1, 10000);
  return new CameraManager(main);
}

// ---------------------------------------------------------------------------
// FollowCamera
// ---------------------------------------------------------------------------

describe('FollowCamera', () => {
  it('constructs with defaults', () => {
    const cam = new FollowCamera();
    expect(cam.name).toBe('');
    expect(cam.fov).toBe(60);
    expect(cam._mode).toBe(FollowMode.FIXED_OFFSET);
    expect(cam._lag).toBeCloseTo(0.1);
  });

  it('setTarget() binds a follow target', () => {
    const cam    = new FollowCamera();
    const target = makeTarget(100, 0, 0);
    cam.setTarget(target);
    expect(cam._target).toBe(target);
    // Snap on first bind — smoothPos should equal target pos
    expect(cam._smoothPos.x).toBeCloseTo(100);
  });

  it('clearTarget() removes the target', () => {
    const cam = new FollowCamera();
    cam.setTarget(makeTarget());
    cam.clearTarget();
    expect(cam._target).toBeNull();
  });

  it('update() in FIXED_OFFSET mode places camera at offset from target', () => {
    const cam    = new FollowCamera({ name: 'test' });
    const target = makeTarget(0, 0, 0);
    cam.setTarget(target, {
      mode:   FollowMode.FIXED_OFFSET,
      lag:    0,               // instant follow
      offset: { x: 0, y: 50, z: 150 },
    });
    cam.update(0.016);
    expect(cam.position.y).toBeCloseTo(50);
    expect(cam.position.z).toBeCloseTo(150);
  });

  it('update() in ORBIT mode places camera on orbit sphere', () => {
    const cam    = new FollowCamera();
    const target = makeTarget(0, 0, 0);
    cam.setTarget(target, {
      mode:      FollowMode.ORBIT,
      lag:       0,
      distance:  200,
      azimuth:   0,
      elevation: 0,
    });
    cam.update(0.016);
    const dist = Math.sqrt(
      cam.position.x ** 2 + cam.position.y ** 2 + cam.position.z ** 2
    );
    expect(dist).toBeCloseTo(200, 0);
  });

  it('orbitZoom() adjusts orbit distance', () => {
    const cam = new FollowCamera();
    cam._orbitDist = 200;
    cam.orbitZoom(2);
    expect(cam._orbitDist).toBe(400);
    cam.orbitZoom(0.5);
    expect(cam._orbitDist).toBe(200);
  });

  it('orbitTilt() clamps elevation', () => {
    const cam = new FollowCamera();
    cam.orbitTilt(Math.PI); // way beyond max
    expect(cam._orbitEl).toBeLessThan(Math.PI / 2);
    cam.orbitTilt(-Math.PI * 2); // way below min
    expect(cam._orbitEl).toBeGreaterThan(-Math.PI / 2);
  });

  it('lag of 0 = instant follow', () => {
    const cam    = new FollowCamera();
    const target = makeTarget(1000, 0, 0);
    cam.setTarget(target, { mode: FollowMode.FIXED_OFFSET, lag: 0, offset: { x: 0, y: 0, z: 0 } });
    cam.update(1);
    expect(cam._smoothPos.x).toBeCloseTo(1000);
  });

  it('lag of 0.99 = very slow follow', () => {
    const cam    = new FollowCamera();
    const target = makeTarget(1000, 0, 0);
    cam._initialized = true; // skip snap
    cam._smoothPos.x = 0;
    cam.setTarget(target, { mode: FollowMode.FREE, lag: 0.99 });
    cam.update(0.016);
    // After one frame, should barely move
    expect(cam._smoothPos.x).toBeLessThan(50);
  });

  it('update() with no target calls super.update()', () => {
    const cam = new FollowCamera();
    expect(() => cam.update(0.016)).not.toThrow();
  });

  it('setTarget() respects name in opts', () => {
    const cam = new FollowCamera({ name: 'fleet cam' });
    expect(cam.name).toBe('fleet cam');
  });
});

// ---------------------------------------------------------------------------
// CameraManager
// ---------------------------------------------------------------------------

describe('CameraManager', () => {
  let mgr;
  beforeEach(() => {
    mgr = makeDomlessCameraManager();
  });

  it('registers "main" from primary camera', () => {
    expect(mgr.has('main')).toBe(true);
    expect(mgr.count).toBe(1);
    expect(mgr.active).toBeDefined();
  });

  it('add() registers a named camera', () => {
    const cam = new FollowCamera({ name: 'fleet' });
    mgr.add('fleet', cam);
    expect(mgr.has('fleet')).toBe(true);
    expect(mgr.count).toBe(2);
  });

  it('get() returns the camera', () => {
    const cam = new FollowCamera();
    mgr.add('x', cam);
    expect(mgr.get('x')).toBe(cam);
  });

  it('remove() deletes a camera', () => {
    mgr.add('del', new FollowCamera());
    mgr.remove('del');
    expect(mgr.has('del')).toBe(false);
  });

  it('cannot remove "main"', () => {
    mgr.remove('main');
    expect(mgr.has('main')).toBe(true);
  });

  it('setActive() changes activeName', () => {
    mgr.add('secondary', new FollowCamera());
    mgr.setActive('secondary');
    expect(mgr.activeName).toBe('secondary');
    expect(mgr.active).toBeDefined();
  });

  it('setActive() warns on unknown name', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mgr.setActive('nonexistent');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('setFollowTarget() binds target to a FollowCamera', () => {
    const cam    = new FollowCamera({ name: 'ship' });
    const target = makeTarget(50, 0, 50);
    mgr.add('ship', cam);
    mgr.setFollowTarget('ship', target, { mode: FollowMode.ORBIT });
    expect(cam._target).toBe(target);
  });

  it('setFollowTarget() warns if camera has no setTarget()', () => {
    const plain = new PerspectiveCamera();
    mgr.add('plain', plain);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mgr.setFollowTarget('plain', makeTarget());
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('secondaryCameras excludes main', () => {
    mgr.add('sec1', new FollowCamera());
    mgr.add('sec2', new FollowCamera());
    const names = mgr.secondaryCameras.map((e) => e.name);
    expect(names).not.toContain('main');
    expect(names).toContain('sec1');
    expect(names).toContain('sec2');
  });

  it('setEnabled(false) excludes camera from secondaryCameras', () => {
    mgr.add('hidden', new FollowCamera());
    mgr.setEnabled('hidden', false);
    const names = mgr.secondaryCameras.map((e) => e.name);
    expect(names).not.toContain('hidden');
  });

  it('update() calls camera.update for all enabled cameras', () => {
    const cam = new FollowCamera();
    const spy = vi.spyOn(cam, 'update');
    mgr.add('upd', cam);
    mgr.update(0.016);
    expect(spy).toHaveBeenCalledWith(0.016);
  });

  it('clearFollowTarget() removes target', () => {
    const cam = new FollowCamera();
    mgr.add('c', cam);
    mgr.setFollowTarget('c', makeTarget());
    mgr.clearFollowTarget('c');
    expect(cam._target).toBeNull();
  });

  it('dispose() clears all cameras', () => {
    mgr.add('a', new FollowCamera());
    mgr.dispose();
    expect(mgr.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ViewportManager — GPU sub-pass rendering
// ---------------------------------------------------------------------------

describe('ViewportManager — GPU subpass', () => {
  const HEADER_H = PIP_DEFAULTS.headerHeight;

  /** Build a minimal mock WebGPU renderer with spy-able GPU objects. */
  function makeWebGPURenderer(canvasW = 800, canvasH = 600) {
    const pass = {
      setViewport:    vi.fn(),
      setScissorRect: vi.fn(),
      setPipeline:    vi.fn(),
      setVertexBuffer: vi.fn(),
      setIndexBuffer:  vi.fn(),
      draw:            vi.fn(),
      drawIndexed:     vi.fn(),
      end:             vi.fn(),
    };
    const encoder = {
      beginRenderPass: vi.fn(() => pass),
      finish:          vi.fn(() => ({})),
    };
    const texture = { createView: vi.fn(() => ({})) };
    const queue   = { submit: vi.fn() };

    return {
      device:   { createCommandEncoder: vi.fn(() => encoder), queue },
      ready:    true,
      context:  { getCurrentTexture: vi.fn(() => texture) },
      _depthTexture: null,
      canvas:   { width: canvasW, height: canvasH },
      uploadMesh:           vi.fn(),
      createRenderPipeline: vi.fn(),
      getCapabilities:      () => ({ webgpu: true }),
      // Expose internals for assertion
      _mockPass:    pass,
      _mockEncoder: encoder,
    };
  }

  function makeVPMgpu(canvasW = 800, canvasH = 600) {
    const mainCanvas = { width: canvasW, height: canvasH, parentElement: null };
    const renderer   = makeWebGPURenderer(canvasW, canvasH);
    const cameras    = makeDomlessCameraManager();
    const vpm        = new ViewportManager(mainCanvas, renderer, cameras);
    vpm._container = { appendChild: vi.fn(), remove: vi.fn() };
    vpm._attached  = true;
    cameras.add('gpu-cam', new FollowCamera({ name: 'GPU Test' }));
    return { vpm, cameras, renderer };
  }

  function makeEntry(overrides = {}) {
    return {
      x: 10, y: 10, w: 200, h: 150,
      enabled: true,
      name: 'gpu-cam',
      camera: null,
      root: { classList: { contains: () => false, add: vi.fn() } },
      canvas: {},
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // _isWebGPUReady
  // -------------------------------------------------------------------------

  it('_isWebGPUReady() returns true when renderer has device+ready+context', () => {
    const { vpm } = makeVPMgpu();
    expect(vpm._isWebGPUReady()).toBe(true);
  });

  it('_isWebGPUReady() returns false for a plain non-WebGPU mock renderer', () => {
    const mainCanvas = { width: 800, height: 600, parentElement: null };
    const vpm = new ViewportManager(mainCanvas, makeMockRenderer(), makeDomlessCameraManager());
    expect(vpm._isWebGPUReady()).toBe(false);
  });

  it('_isWebGPUReady() returns false when renderer.ready is false', () => {
    const { vpm, renderer } = makeVPMgpu();
    renderer.ready = false;
    expect(vpm._isWebGPUReady()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // _toDeviceRect
  // -------------------------------------------------------------------------

  it('_toDeviceRect() converts CSS px to device px (dpr=1, no clamp)', () => {
    const { vpm } = makeVPMgpu(800, 600);
    const entry = { x: 10, y: 10, w: 200, h: 150 };
    const rect  = vpm._toDeviceRect(entry);
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(10 + HEADER_H);
    expect(rect.w).toBe(200);
    expect(rect.h).toBe(150 - HEADER_H);
    expect(rect.valid).toBe(true);
  });

  it('_toDeviceRect() clamps width when viewport overflows canvas right edge', () => {
    const { vpm } = makeVPMgpu(100, 100);
    const entry = { x: 80, y: 0, w: 200, h: 100 };
    const rect  = vpm._toDeviceRect(entry);
    expect(rect.w).toBeLessThanOrEqual(100 - 80);
    expect(rect.valid).toBe(true);
  });

  it('_toDeviceRect() returns valid=false when viewport is fully outside canvas', () => {
    const { vpm } = makeVPMgpu(100, 100);
    const entry = { x: 200, y: 200, w: 100, h: 60 };
    const rect  = vpm._toDeviceRect(entry);
    expect(rect.valid).toBe(false);
  });

  it('_toDeviceRect() returns valid=false when content height is zero (entry.h === HEADER_H)', () => {
    const { vpm } = makeVPMgpu(800, 600);
    const entry = { x: 0, y: 0, w: 100, h: HEADER_H };
    const rect  = vpm._toDeviceRect(entry);
    expect(rect.valid).toBe(false);
  });

  // -------------------------------------------------------------------------
  // _renderPip dispatch
  // -------------------------------------------------------------------------

  it('_renderPip() calls _renderPipGPU when WebGPU is ready', () => {
    const { vpm } = makeVPMgpu();
    const gpuSpy    = vi.spyOn(vpm, '_renderPipGPU').mockImplementation(() => {});
    const canvasSpy = vi.spyOn(vpm, '_renderPipCanvas').mockImplementation(() => {});
    vpm._renderPip(makeEntry(), null);
    expect(gpuSpy).toHaveBeenCalledOnce();
    expect(canvasSpy).not.toHaveBeenCalled();
  });

  it('_renderPip() falls back to _renderPipCanvas when no GPU', () => {
    const mainCanvas = { width: 800, height: 600, parentElement: null };
    const vpm = new ViewportManager(mainCanvas, makeMockRenderer(), makeDomlessCameraManager());
    const canvasSpy = vi.spyOn(vpm, '_renderPipCanvas').mockImplementation(() => {});
    vpm._renderPip(makeEntry(), null);
    expect(canvasSpy).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // _renderPipGPU
  // -------------------------------------------------------------------------

  it('_renderPipGPU() creates a command encoder and submits to the GPU queue', () => {
    const { vpm, renderer } = makeVPMgpu(800, 600);
    const mockScene = { update: vi.fn(() => []) };
    vpm._renderPipGPU(makeEntry(), mockScene);
    expect(renderer.device.createCommandEncoder).toHaveBeenCalled();
    expect(renderer.device.queue.submit).toHaveBeenCalled();
  });

  it('_renderPipGPU() sets viewport and scissorRect on the render-pass encoder', () => {
    const { vpm, renderer } = makeVPMgpu(800, 600);
    const mockScene = { update: vi.fn(() => []) };
    vpm._renderPipGPU(makeEntry(), mockScene);
    expect(renderer._mockPass.setViewport).toHaveBeenCalled();
    expect(renderer._mockPass.setScissorRect).toHaveBeenCalled();
  });

  it('_renderPipGPU() uses loadOp:"load" to preserve main-scene content', () => {
    const { vpm, renderer } = makeVPMgpu(800, 600);
    const mockScene = { update: vi.fn(() => []) };
    vpm._renderPipGPU(makeEntry(), mockScene);
    const passDesc = renderer._mockEncoder.beginRenderPass.mock.calls[0][0];
    expect(passDesc.colorAttachments[0].loadOp).toBe('load');
  });

  it('_renderPipGPU() adds gq-viewport--gpu-render class to the root element', () => {
    const { vpm } = makeVPMgpu(800, 600);
    const addClass = vi.fn();
    const entry = makeEntry({
      root: { classList: { contains: () => false, add: addClass } },
    });
    vpm._renderPipGPU(entry, { update: () => [] });
    expect(addClass).toHaveBeenCalledWith('gq-viewport--gpu-render');
  });

  it('_renderPipGPU() does not re-add the CSS class when already present', () => {
    const { vpm } = makeVPMgpu(800, 600);
    const addClass = vi.fn();
    const entry = makeEntry({
      root: { classList: { contains: () => true, add: addClass } },
    });
    vpm._renderPipGPU(entry, { update: () => [] });
    expect(addClass).not.toHaveBeenCalled();
  });

  it('_renderPipGPU() skips rendering when rect is invalid (out of canvas)', () => {
    const { vpm, renderer } = makeVPMgpu(100, 100);
    // Position far outside the 100×100 canvas
    const entry = makeEntry({ x: 500, y: 500, w: 200, h: 150 });
    vpm._renderPipGPU(entry, { update: () => [] });
    expect(renderer.device.createCommandEncoder).not.toHaveBeenCalled();
  });

  it('_renderPipGPU() renders mesh nodes present in the scene', () => {
    const { vpm, renderer } = makeVPMgpu(800, 600);

    const geometry = {
      positions:   new Float32Array([0, 1, 0]),
      _gpuBuffers: { positions: {}, normals: null, uvs: null, indices: null },
    };
    const material = { _pipeline: {}, needsUpdate: false };
    const node = { data: { geometry, material } };
    const mockScene = { update: vi.fn(() => [node]) };

    vpm._renderPipGPU(makeEntry(), mockScene);

    expect(renderer._mockPass.setPipeline).toHaveBeenCalledWith(material._pipeline);
    expect(renderer._mockPass.setVertexBuffer).toHaveBeenCalledWith(0, geometry._gpuBuffers.positions);
    expect(renderer._mockPass.draw).toHaveBeenCalled();
  });

  it('_renderPipGPU() uses drawIndexed when geometry has an index buffer', () => {
    const { vpm, renderer } = makeVPMgpu(800, 600);

    const geometry = {
      positions:   new Float32Array([0, 1, 0]),
      indices:     new Uint16Array([0, 1, 2]),
      _gpuBuffers: { positions: {}, normals: null, uvs: null, indices: {} },
    };
    const material = { _pipeline: {}, needsUpdate: false };
    const node = { data: { geometry, material } };

    vpm._renderPipGPU(makeEntry(), { update: () => [node] });

    expect(renderer._mockPass.setIndexBuffer).toHaveBeenCalled();
    expect(renderer._mockPass.drawIndexed).toHaveBeenCalledWith(geometry.indices.length);
  });

  it('_renderPipGPU() attaches depth stencil when _depthTexture is present', () => {
    const { vpm, renderer } = makeVPMgpu(800, 600);
    renderer._depthTexture = { createView: vi.fn(() => ({})) };
    const mockScene = { update: vi.fn(() => []) };
    vpm._renderPipGPU(makeEntry(), mockScene);
    const passDesc = renderer._mockEncoder.beginRenderPass.mock.calls[0][0];
    expect(passDesc.depthStencilAttachment).toBeDefined();
  });
});

describe('ViewportManager (headless)', () => {
  function makeMockContainer() {
    const children = [];
    return {
      appendChild: vi.fn((el) => children.push(el)),
      remove: vi.fn(),
      _children: children,
    };
  }

  function makeVPM() {
    const mainCanvas = { width: 800, height: 600, parentElement: null };
    const renderer   = makeMockRenderer();
    const cameras    = makeDomlessCameraManager();
    const vpm        = new ViewportManager(mainCanvas, renderer, cameras);
    // Inject a mock container to avoid DOM dependency
    vpm._container = makeMockContainer();
    vpm._attached  = true;
    // Register a camera so add() can find it
    cameras.add('test-cam', new FollowCamera({ name: 'Test' }));
    return { vpm, cameras };
  }

  it('add() registers a viewport', () => {
    const { vpm } = makeVPM();
    // Mock document.createElement
    const mockRoot   = { style: {}, dataset: {}, appendChild: vi.fn(), remove: vi.fn() };
    const mockHeader = { style: {}, appendChild: vi.fn(), addEventListener: vi.fn() };
    const mockCanvas = { getContext: vi.fn(() => null), style: {}, width: 0, height: 0 };
    const mockClose  = { className: '', textContent: '', title: '', addEventListener: vi.fn() };
    const mockLabel  = { className: '', textContent: '' };
    let callCount = 0;
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        callCount++;
        if (callCount === 1) return mockRoot;
        if (callCount === 2) return mockHeader;
        if (callCount === 3) return mockLabel;
        if (callCount === 4) return mockClose;
        if (callCount === 5) return mockCanvas;
        const el = { style: {}, appendChild: vi.fn(), addEventListener: vi.fn() };
        return el;
      }),
      body: {},
    });
    vi.stubGlobal('getComputedStyle', () => ({ position: 'relative' }));

    vpm.add('test-cam', { label: 'Test Cam', width: 200, height: 150 });
    expect(vpm.has('test-cam')).toBe(true);
    expect(vpm.count).toBe(1);

    vi.unstubAllGlobals();
  });

  it('remove() deletes a viewport', () => {
    const { vpm } = makeVPM();
    // Manually inject a fake entry
    vpm._viewports.set('fake', {
      name: 'fake', enabled: true,
      root: { remove: vi.fn() }, canvas: {}, x: 0, y: 0, w: 200, h: 150,
    });
    vpm.remove('fake');
    expect(vpm.has('fake')).toBe(false);
    expect(vpm.count).toBe(0);
  });

  it('setVisible(false) disables a viewport', () => {
    const { vpm } = makeVPM();
    const root = { style: { display: '' }, remove: vi.fn() };
    vpm._viewports.set('v1', { name: 'v1', enabled: true, root, canvas: {}, x: 0, y: 0, w: 200, h: 150 });
    vpm.setVisible('v1', false);
    expect(vpm._viewports.get('v1').enabled).toBe(false);
    expect(root.style.display).toBe('none');
  });

  it('move() updates position', () => {
    const { vpm } = makeVPM();
    const root = { style: { left: '', top: '' }, remove: vi.fn() };
    vpm._viewports.set('m1', { name: 'm1', enabled: true, root, canvas: {}, x: 0, y: 0, w: 200, h: 150 });
    vpm.move('m1', 300, 200);
    expect(root.style.left).toBe('300px');
    expect(root.style.top).toBe('200px');
    expect(vpm._viewports.get('m1').x).toBe(300);
  });

  it('names() lists registered viewport names', () => {
    const { vpm } = makeVPM();
    vpm._viewports.set('a', { root: { remove: vi.fn() } });
    vpm._viewports.set('b', { root: { remove: vi.fn() } });
    expect(vpm.names()).toContain('a');
    expect(vpm.names()).toContain('b');
  });
});
