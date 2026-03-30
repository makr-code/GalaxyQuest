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
import { ViewportManager }           from '../../js/engine/ViewportManager.js';
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
// ViewportManager (DOM-less unit tests using mocked container)
// ---------------------------------------------------------------------------

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
