import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { createGameGalaxyRenderer } from '../../js/rendering/game-galaxy-renderer.js';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { SpaceVesselRenderPass } from '../../js/rendering/space-vessel-render-pass.js';

const star = { galaxy_index: 1, system_index: 10, x_ly: 23000, y_ly: 14000, z_ly: 100 };
const payload = {
  galaxy: 1, system: 10, planets: [
    { position: 3, player_planet: { position: 3, name: 'Home', diameter_km: 12000, semi_major_axis_au: 1 } },
    { position: 5, generated_planet: { position: 5, diameter_km: 16000, semi_major_axis_au: 2 } },
  ],
};

describe('Shared galaxy camera controls', () => {
  let canvas;
  let space;
  let raw;
  let adapter;
  let options;
  let frameHooks;
  function advanceFlight() {
    for (let frame = 0; frame < 90; frame++) [...frameHooks].forEach((hook) => hook(1 / 60));
  }
  function pointer(type, x, y, extra = {}) {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    canvas.dispatchEvent(event);
    return event;
  }
  function drag(extra = {}) {
    pointer('pointerdown', 400, 300, extra);
    pointer('pointermove', 470, 340, extra);
    pointer('pointerup', 470, 340, extra);
  }
  function touch(type, id, x, y) {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    canvas.dispatchEvent(event);
    return event;
  }
  const state = () => adapter.getRenderStats().cameraControl;
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    frameHooks = new Set();
    document.body.innerHTML = '<div><canvas tabindex="0"></canvas></div>';
    canvas = document.querySelector('canvas');
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    space = new PerspectiveSpaceFlight({ aspect: 800 / 600 });
    raw = {
      renderer: { domElement: canvas }, getSpaceView: () => space,
      setFlightScene: vi.fn((scene) => scene.sceneGraph ? space.setSystem(scene) : true),
      setStars: vi.fn(), setSpatialLabelStars: vi.fn(), cancelCameraFlight: vi.fn(() => space.stop()),
      setGalaxyFleets: vi.fn((fleets) => space.setGalaxyFleets(fleets)), getRenderStats: () => ({ backend: 'webgpu' }),
      getSharedZoomBackend: () => ({ addFrameHook: (hook) => {
        frameHooks.add(hook);
        return () => frameHooks.delete(hook);
      } }),
    };
    window.GQAuthGalaxyBackgroundControl = { acquireGameView: async () => raw,
      getVisualStars: () => [], returnToMenu: vi.fn() };
    options = { onClick: vi.fn(), onDoubleClick: vi.fn(), onOverview: vi.fn(), onViewChange: vi.fn(), onError: vi.fn() };
    options.loadColonyData = vi.fn(async () => ({ colony: { id: 1 } }));
    options.createZoomRuntime = vi.fn(async ({ onLevel }) => ({
      approach: vi.fn(async () => onLevel('planet')),
      surface: vi.fn(async (load) => { await load(); onLevel('colony'); }),
      back: vi.fn(() => onLevel('planet')),
      returnTo: vi.fn(async (next) => { onLevel(next); return true; }),
      rotateView: vi.fn(), panView: vi.fn(), nudgeZoom: vi.fn(),
      zoomBy: vi.fn(), selectAt: vi.fn(),
      reset: vi.fn(), dispose: vi.fn(), getStats: () => ({ buildings: 2 }),
    }));
    adapter = await createGameGalaxyRenderer(canvas.parentElement, options);
    adapter.setStars([star]);
    adapter.fitCameraToStars();
  });
  afterEach(() => {
    adapter.destroy();
    space.dispose();
    delete window.GQAuthGalaxyBackgroundControl;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });
  it('rotates around the target, pans target and eye together, and never selects a dragged object', () => {
    const before = state();
    drag();
    expect(state().distance).toBeCloseTo(before.distance, 7);
    expect(state().target).toEqual(before.target);
    expect(state().quaternion).not.toEqual(before.quaternion);
    const rotated = state();
    drag({ button: 2 });
    const eyeShift = new Vector3(...state().position).sub(new Vector3(...rotated.position));
    const targetShift = new Vector3(...state().target).sub(new Vector3(...rotated.target));
    expect(eyeShift.distanceTo(targetShift)).toBeLessThan(1e-10);
    expect(state().distance).toBeCloseTo(rotated.distance, 7);
    expect(options.onClick).not.toHaveBeenCalled();
    expect(canvas.setPointerCapture).toHaveBeenCalledTimes(2);
    expect(canvas.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }))).toBe(false);
  });
  it('projects grouped canonical fleet endpoints on the shared camera without inventing unloaded systems', async () => {
    const mission = { id: 7, origin_galaxy: 1, origin_system: 10, origin_position: 3,
      target_galaxy: 2, target_system: 20, target_position: 4 };
    const onProjection = vi.fn();
    const stop = adapter.observeFleetEndpoints(() => [mission, { ...mission, id: 8 }], onProjection);
    expect(frameHooks.size).toBe(1);
    expect(onProjection.mock.lastCall[0]).toEqual([expect.objectContaining({
      key: '1:10:*', fleetIds: [7, 8], position: null, x: expect.any(Number), y: expect.any(Number),
    })]);
    adapter.enterSystemView(star, payload);
    advanceFlight();
    expect(onProjection.mock.lastCall[0]).toEqual([expect.objectContaining({
      key: '1:10:3', fleetIds: [7, 8], position: 3,
    })]);
    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const expected = body.getWorldPosition(new Vector3()).project(space.camera);
    expect(onProjection.mock.lastCall[0][0].x).toBeCloseTo((expected.x + 1) * 400);
    drag();
    advanceFlight();
    expect(onProjection.mock.lastCall[0][0].x).not.toBeCloseTo((expected.x + 1) * 400);
    adapter.focusPlanet(3);
    advanceFlight();
    expect(onProjection.mock.lastCall[0]).toEqual([]);
    stop();
    expect(frameHooks.size).toBe(0);
    adapter.observeFleetEndpoints(() => [mission], onProjection);
    adapter.destroy();
    expect(frameHooks.size).toBe(0);
  });
  it('orbits with one touch and pans/pinches with two without selecting on release', () => {
    const start = state();
    expect(touch('pointerdown', 1, 200, 300).defaultPrevented).toBe(true);
    touch('pointermove', 1, 230, 320);
    expect(state().quaternion).not.toEqual(start.quaternion);
    touch('pointerdown', 2, 400, 320);
    const before = state();
    touch('pointermove', 2, 450, 340);
    expect(state().distance).toBeLessThan(before.distance);
    expect(state().target).not.toEqual(before.target);
    touch('pointerup', 2, 450, 340);
    touch('pointerup', 1, 230, 320);
    expect(options.onClick).not.toHaveBeenCalled();
    expect(options.onDoubleClick).not.toHaveBeenCalled();
  });
  it('clears cancelled/capture-lost touches and removes gesture listeners on disposal', () => {
    touch('pointerdown', 1, 200, 300);
    touch('pointerdown', 2, 400, 300);
    touch('pointercancel', 1, 200, 300);
    touch('lostpointercapture', 2, 400, 300);
    const before = state();
    touch('pointermove', 1, 250, 330);
    touch('pointerup', 2, 400, 300);
    expect(state()).toEqual(before);
    expect(options.onClick).not.toHaveBeenCalled();
    adapter.destroy();
    expect(touch('pointerdown', 1, 200, 300).defaultPrevented).toBe(false);
    touch('pointermove', 1, 250, 330);
    expect(state()).toEqual(before);
  });
  it('delegates touch gestures and tap selection to the live surface instead of the parent scene', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    const before = state();
    touch('pointerdown', 1, 200, 300);
    touch('pointermove', 1, 240, 330);
    expect(runtime.rotateView).toHaveBeenCalledExactlyOnceWith(40, 30);
    touch('pointerdown', 2, 400, 330);
    touch('pointermove', 2, 440, 330);
    expect(runtime.panView).toHaveBeenCalledExactlyOnceWith(20, 0);
    expect(runtime.zoomBy).toHaveBeenCalledExactlyOnceWith(Math.log(200 / 160));
    touch('pointerup', 2, 440, 330);
    touch('pointerup', 1, 240, 330);
    expect(runtime.selectAt).not.toHaveBeenCalled();
    touch('pointerdown', 3, 300, 200);
    touch('pointerup', 3, 300, 200);
    expect(runtime.selectAt).toHaveBeenCalledExactlyOnceWith(300, 200);
    expect(state()).toEqual(before);
    expect(options.onClick).not.toHaveBeenCalled();
  });
  it('flies into systems without teleporting and restores the previous galaxy framing on return', () => {
    window.matchMedia.mockReturnValue({ matches: false });
    drag();
    drag({ button: 2 });
    const galaxy = state();
    const worldEye = space.camera.position.clone().add(space.origin);
    adapter.enterSystemView(star, payload);
    expect(space.camera.position.clone().add(space.origin).distanceTo(worldEye)).toBeLessThan(1e-8);
    expect(state().transitioning).toBe(true);
    expect(frameHooks.size).toBe(1);
    const initial = space.camera.position.clone();
    [...frameHooks].forEach((hook) => hook(0.3));
    expect(space.camera.position.equals(initial)).toBe(false);
    expect(state().position.every(Number.isFinite)).toBe(true);
    advanceFlight();
    expect(state().transitioning).toBe(false);
    expect(frameHooks.size).toBe(0);
    adapter.exitSystemView();
    adapter.fitCameraToStars();
    expect(state().transitioning).toBe(true);
    advanceFlight();
    expect(new Vector3(...state().position).add(space.origin).distanceTo(worldEye)).toBeLessThan(1e-8);
    const target = new Vector3(...state().target).add(space.origin);
    expect(target.distanceTo(new Vector3(...galaxy.target))).toBeLessThan(1e-8);
    expect(state().distance).toBeCloseTo(galaxy.distance, 7);
    expect(frameHooks.size).toBe(0);
  });
  it('restores a rotated and panned system framing after planet approach without losing local precision', async () => {
    adapter.enterSystemView(star, payload);
    drag();
    drag({ shiftKey: true });
    const systemView = state();
    adapter.focusPlanet(3);
    await vi.waitFor(() => expect(options.createZoomRuntime).toHaveBeenCalledOnce());
    window.matchMedia.mockReturnValue({ matches: false });
    adapter.back();
    expect(state().level).toBe('system');
    expect(state().transitioning).toBe(true);
    advanceFlight();
    expect(state().position).toEqual(systemView.position);
    expect(state().target).toEqual(systemView.target);
    expect(state().distance).toBe(systemView.distance);
  });
  it('cancels the shared flight immediately on input, subsequent navigation and disposal', () => {
    window.matchMedia.mockReturnValue({ matches: false });
    adapter.enterSystemView(star, payload);
    pointer('pointerdown', 400, 300);
    const interrupted = state();
    expect(interrupted.transitioning).toBe(false);
    advanceFlight();
    expect(state()).toEqual(interrupted);
    pointer('pointerup', 400, 300);
    adapter.resetView();
    expect(frameHooks.size).toBe(1);
    adapter.enterSystemView({ ...star, system_index: 11 }, { ...payload, system: 11 });
    expect(frameHooks.size).toBe(1);
    adapter.destroy();
    expect(frameHooks.size).toBe(0);
    const stopped = state();
    advanceFlight();
    expect(state()).toEqual(stopped);
  });
  it('zooms relative to an off-origin planet, clamps before its surface and maintains finite orbit poses', () => {
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    const before = state();
    adapter.nudgeZoom('in');
    expect(state().distance).toBeLessThan(before.distance);
    expect(state().distance).toBeGreaterThan(before.distance * 0.7);
    adapter.focusPlanet(5);
    for (let index = 0; index < 150; index++) adapter.nudgeZoom('in');
    expect(state().level).toBe('planet');
    expect(state().distance / state().minimum).toBeCloseTo(1, 7);
    for (let index = 0; index < 20; index++) drag();
    expect([...state().position, ...state().quaternion].every(Number.isFinite)).toBe(true);
    const body = space.bodies.find((entry) => entry.userData.data.position === 5);
    expect(space.camera.position.distanceTo(body.getWorldPosition(new Vector3())) / body.userData.radius)
      .toBeGreaterThanOrEqual(1.039999);
  });
  it('delegates real colonies to the existing surface stack, supports return levels, and refuses uncolonized data', async () => {
    adapter.enterSystemView(star, payload);
    adapter.setGalaxyFleets([]);
    expect(adapter.focusColony(5)).toBe(false);
    expect(options.onError).toHaveBeenCalledOnce();
    expect(adapter.focusColony(3)).toBe(true);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    expect(state()).toMatchObject({ level: 'colony', planetPosition: 3 });
    expect(state().distance / state().minimum).toBeGreaterThan(1);
    drag();
    drag({ shiftKey: true });
    expect(state().level).toBe('colony');
    expect(state().position.every(Number.isFinite)).toBe(true);
    adapter.back();
    expect(state().level).toBe('planet');
    adapter.back();
    expect(state().level).toBe('system');
    adapter.back();
    expect(options.onOverview).toHaveBeenCalledOnce();
    adapter.exitSystemView();
    adapter.fitCameraToStars();
    expect(state().level).toBe('galaxy');
  });
  it('enters the full colony renderer by inward zoom and delegates surface return controls', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    for (let index = 0; index < 4; index++) adapter.nudgeZoom('in');
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    adapter.back();
    expect(state().level).toBe('planet');
  });
  it('returns directly to ancestors through the existing surface transition before leaving the system', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    expect(await adapter.returnTo('building')).toBe(false);
    expect(await adapter.returnTo('bogus')).toBe(false);
    expect(await adapter.returnTo('system')).toBe(true);
    expect(runtime.returnTo).toHaveBeenCalledExactlyOnceWith('planet');
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(state().level).toBe('system');
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const nextRuntime = await options.createZoomRuntime.mock.results[1].value;
    options.onOverview.mockImplementationOnce(() => {
      adapter.exitSystemView();
      adapter.fitCameraToStars();
    });
    expect(await adapter.returnTo('galaxy')).toBe(true);
    expect(nextRuntime.returnTo).toHaveBeenCalledExactlyOnceWith('planet');
    expect(options.onOverview).toHaveBeenCalledOnce();
  });
  it('does not resume ancestor navigation when logout cancels an outstanding reverse transition', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    let finish;
    runtime.returnTo.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = adapter.returnTo('galaxy');
    adapter.destroy();
    finish(true);
    expect(await pending).toBe(false);
    expect(options.onOverview).not.toHaveBeenCalled();
  });
  it('does not report a galaxy return as successful if the server overview did not change the view', async () => {
    adapter.enterSystemView(star, payload);
    expect(await adapter.returnTo('galaxy')).toBe(false);
    expect(state().level).toBe('system');
    expect(options.onOverview).toHaveBeenCalledOnce();
  });
  it('disposes late zoom initialization when leaving a system before it completes', async () => {
    let complete;
    let entry;
    options.createZoomRuntime.mockImplementation((args) => {
      entry = args;
      return new Promise((resolve) => { complete = resolve; });
    });
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    adapter.exitSystemView();
    adapter.fitCameraToStars();
    const runtime = { dispose: vi.fn(), approach: vi.fn() };
    complete(runtime);
    await vi.waitFor(() => expect(runtime.dispose).toHaveBeenCalledOnce());
    entry.onLevel('colony');
    expect(state().level).toBe('galaxy');
    expect(runtime.approach).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
    expect(entry.signal.aborted).toBe(true);
  });
  it('cancels the old planet approach when another canonical planet is selected', async () => {
    let complete;
    options.createZoomRuntime.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    adapter.focusPlanet(5);
    const old = { dispose: vi.fn(), approach: vi.fn() };
    complete(old);
    await vi.waitFor(() => expect(old.dispose).toHaveBeenCalledOnce());
    const current = await options.createZoomRuntime.mock.results[1].value;
    await vi.waitFor(() => expect(current.approach).toHaveBeenCalledOnce());
    expect(current.approach.mock.calls[0][0].focusPlanet.position).toBe(5);
    expect(old.approach).not.toHaveBeenCalled();
    expect(state().planetPosition).toBe(5);
  });
  it('handles wheel delta modes, keyboard helpers, cancellation and listener teardown', () => {
    const before = state();
    const wheel = new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(state().distance).toBeLessThan(before.distance);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    expect(state().quaternion).not.toEqual(before.quaternion);
    pointer('pointerdown', 400, 300);
    pointer('pointercancel', 400, 300);
    const canceled = state();
    pointer('pointermove', 470, 340);
    expect(state()).toEqual(canceled);
    adapter.resetView();
    expect(state().position).toEqual(before.position);
    adapter.destroy();
    const stopped = state();
    drag();
    canvas.dispatchEvent(wheel);
    expect(state()).toEqual(stopped);
  });
  it('uses the selected authenticated star for wheel entry and does not issue duplicate requests', async () => {
    const projected = new Vector3(star.x_ly, star.y_ly, star.z_ly).project(space.camera);
    const x = (projected.x + 1) * 400;
    const y = (1 - projected.y) * 300;
    pointer('pointerdown', x, y);
    pointer('pointerup', x, y);
    expect(options.onClick).toHaveBeenCalledWith(star);
    for (let index = 0; index < 15; index++) {
      canvas.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: -800 }));
    }
    expect(options.onDoubleClick).toHaveBeenCalledOnce();
    expect(options.onDoubleClick).toHaveBeenCalledWith(star);
    await Promise.resolve();
  });
  it('uploads colony models relative to the camera before f32 conversion at close range', () => {
    const renderPass = new SpaceVesselRenderPass();
    const writeBuffer = vi.fn();
    renderPass.device = { queue: { writeBuffer } };
    renderPass._ensurePipelines = vi.fn();
    renderPass._ensureBindings = vi.fn();
    renderPass.resources.set('colony', { asset: { vertexBuffer: {}, vertexCount: 3,
      engineVertexCount: 0, particleCount: 0 }, uniformBuffer: {}, bindGroup: {} });
    space.camera.position.set(20000, 0, 0);
    space.camera.lookAt(20000, 1, 0);
    space.camera.updateMatrixWorld(true);
    const entity = { id: 'colony', position: new Vector3(20000 + 1e-8, 0, 0),
      quaternion: space.camera.quaternion.clone(), scale: 1e-9, color: [1, 1, 1, 1] };
    renderPass.render({ setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn() },
      [entity], space.camera, new Vector3(), 0);
    const uniforms = writeBuffer.mock.calls[0][2];
    expect(uniforms[28]).toBeCloseTo(entity.position.x - space.camera.position.x, 14);
    expect(uniforms[28]).not.toBe(0);
    expect([...uniforms.slice(40, 43)]).toEqual([0, 0, 0]);
    expect(Math.abs(uniforms[12]) + Math.abs(uniforms[13])).toBe(0);
  });
});
