import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { createGameGalaxyRenderer } from '../../js/rendering/game-galaxy-renderer.js';
import { AU_LY, PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { SpaceVesselRenderPass } from '../../js/rendering/space-vessel-render-pass.js';

const star = { galaxy_index: 1, system_index: 10, x_ly: 23000, y_ly: 14000, z_ly: 100 };
const payload = {
  galaxy: 1, system: 10, planets: [
    { position: 3, player_planet: { position: 3, name: 'Home', diameter_km: 12000, semi_major_axis_au: 1 } },
    { position: 5, generated_planet: { position: 5, diameter_km: 16000, semi_major_axis_au: 2,
      ring_system: { inner_radius_planet_r: 1.7, outer_radius_planet_r: 3.9,
        optical_depth: 0.62, tilt_deg: 11, composition: 'water_ice' } } },
  ],
  special_bodies: [{
    id: 'g1-s10-asteroid-belt-3-5',
    body_type: 'asteroid_belt',
    seed: 725341,
    inner_radius_au: 1.3,
    outer_radius_au: 1.8,
    semi_major_axis_au: 1.55,
    inclination_deg: 2,
    ascending_node_deg: 35,
  }],
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
      setFlightSelection: vi.fn(),
      setFlightHover: vi.fn(),
      setSystemVisualizationOptions: vi.fn(() => true),
      setSpatialLabelMode: vi.fn((mode) => mode === 'dom' || mode === 'webgpu'),
      setSpatialLabelCallbacks: vi.fn(),
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

  it('returns to usable system controls when zoom runtime initialization fails', async () => {
    adapter.enterSystemView(star, payload);
    const failure = new Error('Zoom initialization failed');
    options.createZoomRuntime.mockRejectedValueOnce(failure);
    adapter.focusPlanet(3);
    await vi.waitFor(() => expect(options.onError).toHaveBeenCalledWith(failure));
    expect(state().level).toBe('system');
    drag();
    expect(state().level).toBe('system');
  });

  it('returns to system and permits a fresh colony runtime after a failed entry', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    await vi.waitFor(() => expect(options.createZoomRuntime).toHaveBeenCalledOnce());
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    const failure = new Error('Colony entry failed');
    runtime.getStats = () => ({ level: null });
    runtime.surface.mockRejectedValueOnce(failure);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(options.onError).toHaveBeenCalledWith(failure));
    expect(state().level).toBe('system');
    expect(runtime.dispose).toHaveBeenCalledOnce();
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    expect(options.createZoomRuntime).toHaveBeenCalledTimes(2);
  });

  it('keeps a usable planet view when colony data loading fails before transition', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    await vi.waitFor(() => expect(options.createZoomRuntime).toHaveBeenCalledOnce());
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    runtime.getStats = () => ({ level: 2 });
    const failure = new Error('Colony snapshot unavailable');
    options.loadColonyData.mockRejectedValueOnce(failure);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(options.onError).toHaveBeenCalledWith(failure));
    expect(state().level).toBe('planet');
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it('restores system controls even if recovery disposal fails and reports both errors', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    await vi.waitFor(() => expect(options.createZoomRuntime).toHaveBeenCalledOnce());
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    const failure = new Error('Colony entry failed');
    const cleanupFailure = new Error('Zoom cleanup failed');
    runtime.getStats = () => ({ level: null });
    runtime.surface.mockRejectedValueOnce(failure);
    runtime.dispose.mockImplementationOnce(() => { throw cleanupFailure; });
    adapter.focusColony(3);
    await vi.waitFor(() => expect(options.onError).toHaveBeenCalledOnce());
    expect(options.onError.mock.calls[0][0]).toMatchObject({ errors: [failure, cleanupFailure] });
    expect(state().level).toBe('system');
  });

  it('restores system after rejected ancestor navigation without hiding the caller error', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    const failure = new Error('Return transition failed');
    runtime.getStats = () => ({ level: null });
    runtime.returnTo.mockRejectedValueOnce(failure);
    await expect(adapter.returnTo('planet')).rejects.toBe(failure);
    expect(state().level).toBe('system');
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('does not reset a newer planet when an obsolete ancestor navigation rejects', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    let reject;
    runtime.returnTo.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const pending = adapter.returnTo('planet');
    adapter.focusPlanet(5);
    const failure = new Error('Obsolete return failed');
    reject(failure);
    await expect(pending).rejects.toBe(failure);
    expect(state()).toMatchObject({ level: 'planet', planetPosition: 5 });
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('restores system controls for navigation errors reported by the current zoom runtime', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    runtime.getStats = () => ({ level: null });
    const failure = new Error('Surface back navigation failed');
    options.createZoomRuntime.mock.calls[0][0].onError(failure);
    expect(state().level).toBe('system');
    expect(options.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  describe('spatial tour camera maneuvers', () => {
    let space;

    beforeEach(() => {
      space = new PerspectiveSpaceFlight();
    });

    afterEach(() => {
      space.dispose();
    });

    function addBody(type, position, radius, data = {}) {
      const body = new Object3D();
      body.position.copy(position);
      body.userData = { type, data, radius };
      space.root.add(body);
      space.bodies.push(body);
      return body;
    }

    it('completes a damped approach before circling the target', async () => {
      const focus = new Vector3();
      addBody('planet', focus, 1e-5, { position: 1 });
      space.camera.position.set(0.002, -0.001, 0.0007);
      space.camera.lookAt(focus);
      space.camera.updateMatrixWorld(true);

      const navigation = space.navigate({ kind: 'planet', position: 1 },
        { durationSec: 4, orbitDurationSec: 1 });
      let sawOrbit = false;
      let orbitStart = null;
      let orbitEnd = null;
      for (let frame = 0; frame < 10000 && space.flight; frame += 1) {
        space.update(0.05);
        if (space.telemetry.phase === 'orbit') {
          sawOrbit = true;
          const position = space.camera.position.clone();
          orbitStart ||= position;
          orbitEnd = position;
        }
      }

      await expect(navigation).resolves.toBe(true);
      expect(sawOrbit).toBe(true);
      expect(orbitStart.distanceTo(orbitEnd)).toBeGreaterThan(1e-5);
      expect(space.telemetry.arrived).toBe(true);
      const persisted = space.getFlightCoordinates();
      expect(persisted.destination).toEqual(persisted.start);
      expect(persisted.start).toEqual(space.camera.position.clone().add(space.origin).toArray());

      const positionBeforeNextFlight = space.camera.position.clone();
      const absoluteTarget = positionBeforeNextFlight.clone().add(space.origin).add(new Vector3(1e-4, 0, 0));
      const nextFlight = space.navigate({
        kind: 'point',
        x_ly: absoluteTarget.x,
        y_ly: absoluteTarget.y,
        z_ly: absoluteTarget.z,
      }, { durationSec: 4 });
      expect(space.camera.position.equals(positionBeforeNextFlight)).toBe(true);
      space.stop();
      await expect(nextFlight).resolves.toBe(false);
    });

    it('sets asteroid fly-bys on a lateral pass beyond the body instead of a stationary orbit', () => {
      const body = addBody('asteroid', new Vector3(), 1e-8, { body_id: 'preview-asteroid' });
      space.camera.position.set(1e-4, 0, 0);
      const direct = space.resolveTarget({ kind: 'asteroid', bodyId: 'preview-asteroid' });
      const flyby = space.resolveTarget({ kind: 'asteroid', bodyId: 'preview-asteroid', flyby: true });

      expect(direct).not.toBeNull();
      expect(flyby).not.toBeNull();
      expect(flyby.destination.distanceTo(body.position)).toBeGreaterThan(direct.destination.distanceTo(body.position));
      expect(Math.abs(flyby.destination.y)).toBeGreaterThan(0);
    });

    it('frames large bodies with a bounded apparent size', () => {
      const body = addBody('planet', new Vector3(), 100, { position: 1 });
      space.camera.position.set(0, -1000, 400);
      const target = space.resolveTarget({ kind: 'planet', position: 1 }, { safeFraming: true });
      const apparentRadius = (body.userData.radius * 1.12)
        / Math.sqrt(target.destination.distanceToSquared(body.position) - body.userData.radius ** 2)
        / Math.tan(space.camera.fov * Math.PI / 360);

      expect(apparentRadius).toBeLessThanOrEqual(0.241);
      expect(target.destination.distanceTo(body.position)).toBeGreaterThan(body.userData.radius * 3);
    });

    it('routes point flights around bodies on the direct path', () => {
      const obstacles = [
        addBody('asteroid', new Vector3(-2, 0, 0), 0.8),
        addBody('planet', new Vector3(3, 0, 0), 1),
      ];
      space.camera.position.set(-10, 0, 0);
      const navigation = space.navigate({ kind: 'point', x_ly: 10, y_ly: 0, z_ly: 0 });
      const waypoints = [space.camera.position.clone(), ...space.flight.waypoints];

      expect(waypoints.length).toBeGreaterThan(2);
      for (let segment = 0; segment < waypoints.length - 1; segment += 1) {
        for (let sample = 0; sample <= 20; sample += 1) {
          const point = waypoints[segment].clone().lerp(waypoints[segment + 1], sample / 20);
          for (const obstacle of obstacles) {
            expect(point.distanceTo(obstacle.position)).toBeGreaterThanOrEqual(obstacle.userData.radius * 1.08);
          }
        }
      }

      space.stop();
      return expect(navigation).resolves.toBe(false);
    });

    it('loads tour-only asteroids and resolves the explicitly previewed ship as a target', () => {
      const position = { x_ly: 20.25, y_ly: 4.5, z_ly: -2 };
      vi.spyOn(space, 'registerSpaceEntity').mockImplementation(async (descriptor) => {
        const [x, y, z] = descriptor.route[0].map(Number);
        space.spaceEntities.set(descriptor.id, {
          id: descriptor.id,
          kind: 'vessel',
          position: new Vector3(x, y, z),
          scale: descriptor.visual_scale_ly,
        });
        return true;
      });
      const ship = {
        id: 'tour-ship:1:42',
        preview_only: true,
        route: [[position.x_ly, position.y_ly, position.z_ly], [position.x_ly, position.y_ly, position.z_ly]],
        visual_scale_ly: 1e-8,
      };
      const scene = {
        flightTour: true,
        sceneGraph: { children: [{
          type: 'system',
          data: { galaxy_index: 1, system_index: 42, ...position },
          children: [
            { type: 'asteroid', data: { body_id: 'tour-asteroid', diameter_km: 10, local_x: 3 }, children: [] },
            { type: 'ship', data: ship, children: [] },
          ],
        }] },
      };

      expect(space.setSystem(scene)).toBe(true);
      expect(space.bodies.some((body) => body.userData.type === 'asteroid')).toBe(true);
      expect(space.resolveTarget({ kind: 'ship', id: ship.id, flyby: true })).not.toBeNull();
    });

    it('loads valid generated ring parameters into the active WebGPU system scene', () => {
      space.setSystem({
        sceneGraph: { children: [{
          type: 'system',
          data: { galaxy_index: 1, system_index: 4, x_ly: 0, y_ly: 0, z_ly: 0, radius_solar: 1 },
          children: [{
            type: 'planet',
            data: {
              position: 2,
              diameter_km: 12000,
              semi_major_axis_au: 2,
              ring_system: {
                inner_radius_planet_r: 1.7,
                outer_radius_planet_r: 3.9,
                optical_depth: 0.62,
                tilt_deg: 11,
                composition: 'water_ice',
              },
            },
            children: [],
          }],
        }] },
      });

      const planet = space.bodies.find((body) => body.userData.type === 'planet');
      expect(planet.userData.ringSystem).toMatchObject({
        innerRadius: 1.7,
        outerRadius: 3.9,
        opticalDepth: 0.62,
        composition: 'water_ice',
      });
      expect(planet.userData.ringSystem.tiltRad).toBeCloseTo(11 * Math.PI / 180);
    });
  });
  afterEach(() => {
    adapter.destroy();
    space.dispose();
    delete window.GQAuthGalaxyBackgroundControl;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });
  it.each(['Escape', 'Backspace', 'Home', '+', '-', 'ArrowLeft'])('ignores composing and already-handled %s camera keys', (key) => {
    adapter.enterSystemView(star, payload);
    advanceFlight();
    const before = state();
    const view = adapter.getRenderStats().viewLevel;
    options.onViewChange.mockClear();
    options.onOverview.mockClear();
    for (const composing of [true, false]) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, isComposing: composing });
      if (!composing) event.preventDefault();
      canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(!composing);
      expect(state()).toEqual(before);
      expect(adapter.getRenderStats().viewLevel).toBe(view);
      expect(options.onViewChange).not.toHaveBeenCalled();
      expect(options.onOverview).not.toHaveBeenCalled();
    }
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
    [...frameHooks].forEach((hook) => hook(1 / 60));
    expect(onProjection.mock.lastCall[0]).toEqual([expect.objectContaining({
      key: '1:10:3', fleetIds: [7, 8], position: 3,
    })]);
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
  it('invalidates captured endpoint projections after remove fails', () => {
    const failure = new Error('Endpoint hook removal failed');
    let attempts = 0;
    raw.getSharedZoomBackend = () => ({
      addFrameHook(hook) {
        frameHooks.add(hook);
        return () => {
          attempts++;
          if (attempts === 1) throw failure;
          frameHooks.delete(hook);
        };
      },
    });
    const onProjection = vi.fn();
    const remove = adapter.observeFleetEndpoints(() => [{ id: 1 }], onProjection);
    const frame = [...frameHooks][0];
    onProjection.mockClear();
    expect(() => remove()).toThrow(failure);
    expect(frameHooks.has(frame)).toBe(true);
    frame();
    expect(onProjection).not.toHaveBeenCalled();
    expect(() => remove()).not.toThrow();
    expect(frameHooks.has(frame)).toBe(false);
    expect(attempts).toBe(2);
  });
  it('invalidates all captured endpoint callbacks before destroy cleanup', () => {
    const onProjection = vi.fn();
    adapter.observeFleetEndpoints(() => [{ id: 1 }], onProjection);
    const frame = [...frameHooks][0];
    onProjection.mockClear();
    adapter.destroy();
    frame();
    expect(onProjection).not.toHaveBeenCalled();
  });
  it('releases endpoint frame hooks when the initial projection callback throws', () => {
    const failure = new Error('Initial endpoint callback failed');
    const onProjection = vi.fn(() => { throw failure; });
    expect(() => adapter.observeFleetEndpoints(() => [], onProjection)).toThrow(failure);
    expect(frameHooks.size).toBe(0);
    adapter.destroy();
  });
  it('retries failed observer cleanup on repeated destroy without reviving callbacks', () => {
    let attempts = 0;
    raw.getSharedZoomBackend = () => ({
      addFrameHook(hook) {
        frameHooks.add(hook);
        return () => {
          if (++attempts === 1) throw new Error('Temporary hook removal failure');
          frameHooks.delete(hook);
        };
      },
    });
    const projection = vi.fn();
    adapter.observeFleetEndpoints(() => [], projection);
    const frame = [...frameHooks][0];
    projection.mockClear();
    expect(() => adapter.destroy()).toThrow(AggregateError);
    expect(frameHooks.has(frame)).toBe(true);
    frame();
    expect(projection).not.toHaveBeenCalled();
    expect(() => adapter.destroy()).not.toThrow();
    expect(frameHooks.has(frame)).toBe(false);
    expect(attempts).toBe(2);
  });
  it('disables a failing per-frame projection and reports it only once', () => {
    const failure = new Error('Endpoint projection failed');
    let removes = 0;
    let fail = false;
    const onProjection = vi.fn(() => { if (fail) throw failure; });
    raw.getSharedZoomBackend = () => ({
      addFrameHook(hook) {
        frameHooks.add(hook);
        return () => { removes++; frameHooks.delete(hook); };
      },
    });
    const remove = adapter.observeFleetEndpoints(() => [], onProjection);
    onProjection.mockClear();
    const frame = [...frameHooks][0];
    fail = true;
    frame();
    frame();
    expect(onProjection).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledWith(failure);
    expect(removes).toBe(1);
    expect(frameHooks.size).toBe(0);
    expect(() => remove()).not.toThrow();
    adapter.destroy();
  });
  it('does not publish an initial projection when hook installation disposes the adapter', () => {
    const onProjection = vi.fn();
    raw.getSharedZoomBackend = () => ({
      addFrameHook(hook) { adapter.destroy(); return () => frameHooks.delete(hook); },
    });
    expect(() => adapter.observeFleetEndpoints(() => [], onProjection)).not.toThrow();
    expect(onProjection).not.toHaveBeenCalled();
    expect(frameHooks.size).toBe(0);
  });
  it('switches spatial labels and routes HTML badge activation through existing galaxy actions', () => {
    expect(adapter.setSpatialLabelMode('dom')).toBe(true);
    expect(raw.setSpatialLabelMode).toHaveBeenCalledWith('dom');
    const callbacks = raw.setSpatialLabelCallbacks.mock.calls[0][0];
    callbacks.onActivate({ kind: 'system', data: star });
    expect(options.onClick).toHaveBeenCalledExactlyOnceWith(star);
    callbacks.onDoubleActivate({ kind: 'system', data: star });
    expect(options.onDoubleClick).toHaveBeenCalledExactlyOnceWith(star);

    adapter.enterSystemView(star, payload);
    callbacks.onActivate({ kind: 'planet', data: { position: 3, name: 'Home' } });
    expect(options.onClick).toHaveBeenLastCalledWith({ position: 3, name: 'Home', __kind: 'planet' });
  });
  it('opens a system badge even while another system payload is still loaded', () => {
    adapter.enterSystemView(star, payload);
    const callbacks = raw.setSpatialLabelCallbacks.mock.calls[0][0];
    const nextStar = { ...star, system_index: 20 };
    callbacks.onDoubleActivate({ kind: 'system', data: nextStar });
    expect(options.onDoubleClick).toHaveBeenCalledExactlyOnceWith(nextStar);
  });
  it.each([0, 1, 2])('normalizes badge wheel mode %s like the canvas and zooms toward the labelled star', (deltaMode) => {
    const callbacks = raw.setSpatialLabelCallbacks.mock.calls[0][0];
    const before = state();
    const deltaY = deltaMode === 0 ? -48 : deltaMode === 1 ? -3 : -0.08;
    const event = new WheelEvent('wheel', { deltaY, deltaMode, cancelable: true });
    callbacks.onWheel({ kind: 'system', data: star }, event);
    expect(event.defaultPrevented).toBe(true);
    expect(state().distance / before.distance).toBeCloseTo(Math.exp(-48 * 0.0022));
    expect(state().target).toEqual([star.x_ly, star.y_ly, star.z_ly]);
    expect(options.onClick).not.toHaveBeenCalled();
  });
  it('uses the badge planet rather than screen picking and zooms through to its colony', async () => {
    adapter.enterSystemView(star, payload);
    const callbacks = raw.setSpatialLabelCallbacks.mock.calls[0][0];
    const label = { kind: 'planet', data: { position: 3 } };
    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const event = new WheelEvent('wheel', { deltaY: -800, clientX: -5000, clientY: -5000, cancelable: true });
    callbacks.onWheel(label, event);
    expect(state().planetPosition).toBe(3);
    expect(state().target).toEqual(body.getWorldPosition(new Vector3()).toArray());
    for (let index = 0; index < 30 && state().level !== 'colony'; index++) {
      callbacks.onWheel(label, event);
      await Promise.resolve();
    }
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    expect(options.loadColonyData).toHaveBeenCalledOnce();
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    callbacks.onWheel(label, new WheelEvent('wheel', { deltaY: 100 }));
    expect(runtime.nudgeZoom).toHaveBeenLastCalledWith('out');
    adapter.destroy();
    runtime.nudgeZoom.mockClear();
    callbacks.onWheel(label, event);
    expect(runtime.nudgeZoom).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });
  it('does not zoom for a horizontal-only wheel event on a badge', () => {
    const before = state();
    raw.setSpatialLabelCallbacks.mock.calls[0][0].onWheel({ kind: 'system', data: star },
      new WheelEvent('wheel', { deltaX: 100 }));
    expect(state()).toEqual(before);
  });
  it('routes badge hover to loaded system planets only and clears it on leave', () => {
    const callbacks = raw.setSpatialLabelCallbacks.mock.calls[0][0];
    callbacks.onHover({ kind: 'planet', data: { position: 3 } });
    expect(raw.setFlightHover).toHaveBeenLastCalledWith(null);
    adapter.enterSystemView(star, payload);
    callbacks.onHover({ kind: 'planet', data: { position: 3 } });
    expect(raw.setFlightHover).toHaveBeenLastCalledWith({ kind: 'planet', position: 3 });
    callbacks.onHover(null);
    expect(raw.setFlightHover).toHaveBeenLastCalledWith(null);
    callbacks.onHover({ kind: 'system', data: star });
    expect(raw.setFlightHover).toHaveBeenLastCalledWith(null);
    callbacks.onHover({ kind: 'planet', data: { position: 99 } });
    expect(raw.setFlightHover).toHaveBeenLastCalledWith(null);
    adapter.focusPlanet(3);
    callbacks.onHover({ kind: 'planet', data: { position: 3 } });
    expect(raw.setFlightHover).toHaveBeenLastCalledWith(null);
    adapter.destroy();
    raw.setFlightHover.mockClear();
    callbacks.onHover(null);
    expect(raw.setFlightHover).not.toHaveBeenCalled();
  });
  it('uses the loaded planet habitation state for repeated badge navigation into a colony', async () => {
    adapter.enterSystemView(star, payload);
    const callbacks = raw.setSpatialLabelCallbacks.mock.calls[0][0];
    const label = { kind: 'planet', data: { position: 3, name: 'Home' } };
    callbacks.onDoubleActivate(label);
    await vi.waitFor(() => expect(state().level).toBe('planet'));
    callbacks.onDoubleActivate(label);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    expect(options.loadColonyData).toHaveBeenCalledOnce();
    expect(options.onError).not.toHaveBeenCalled();
  });
  it('passes generated ring profiles from the in-game system payload to the active WebGPU scene', () => {
    adapter.enterSystemView(star, payload);

    const scene = raw.setFlightScene.mock.calls
      .map(([value]) => value)
      .find((value) => value.stage === 'system');
    const systemNode = scene.sceneGraph.children[0];
    const planetNode = systemNode.children.find((node) => node.type === 'planet' && node.data.position === 5);
    const planetBody = space.bodies.find((body) => body.userData.type === 'planet'
      && body.userData.data.position === 5);

    expect(planetNode.data.ring_system).toEqual(payload.planets[1].generated_planet.ring_system);
    expect(planetBody.userData.ringSystem).toMatchObject({
      innerRadius: 1.7,
      outerRadius: 3.9,
      opticalDepth: 0.62,
      tiltRad: expect.closeTo(11 * Math.PI / 180),
      composition: 'water_ice',
    });
  });
  it('passes deterministically generated asteroid belts through the in-game WebGPU scene with a bounded particle budget', () => {
    adapter.enterSystemView(star, payload);

    const scene = raw.setFlightScene.mock.calls
      .map(([value]) => value)
      .find((value) => value.stage === 'system');
    const beltNode = scene.sceneGraph.children[0].children.find((node) => node.type === 'asteroid_belt');
    const [belt] = space.asteroidBelts;
    const firstParticlePositions = belt.particles.map((particle) => particle.position.toArray());

    expect(beltNode.data).toEqual(payload.special_bodies[0]);
    expect(belt.particles).toHaveLength(512);
    expect(space.asteroidBelts.reduce((total, entry) => total + entry.particles.length, 0)).toBeLessThanOrEqual(512);
    for (const particle of belt.particles) {
      const radiusAu = particle.position.length() / AU_LY;
      expect(radiusAu).toBeGreaterThanOrEqual(payload.special_bodies[0].inner_radius_au);
      expect(radiusAu).toBeLessThanOrEqual(payload.special_bodies[0].outer_radius_au);
    }

    space.setSystem(scene);
    expect(space.asteroidBelts[0].particles.map((particle) => particle.position.toArray()))
      .toEqual(firstParticlePositions);
    expect(space._asteroidBeltLodCount(belt)).toBe(512);

    space.camera.position.set(80 * AU_LY, 0, 0);
    expect(space._asteroidBeltLodCount(belt)).toBeLessThan(512);

    const overBudgetScene = structuredClone(scene);
    overBudgetScene.sceneGraph.children[0].children.push(...[2, 3, 4].map((index) => ({
      type: 'asteroid_belt',
      data: { ...payload.special_bodies[0], id: `extra-belt-${index}`, seed: index },
    })));
    space.setSystem(overBudgetScene);
    expect(space.asteroidBelts).toHaveLength(2);
    expect(space.asteroidBelts.reduce((total, entry) => total + entry.particles.length, 0)).toBe(512);
  });
  it('sets and clears the system planet selection marker from canvas clicks', () => {
    adapter.enterSystemView(star, payload);
    advanceFlight();

    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const projected = body.getWorldPosition(new Vector3()).project(space.camera);
    const x = (projected.x + 1) * 400;
    const y = (1 - projected.y) * 300;
    pointer('pointerdown', x, y);
    pointer('pointerup', x, y);
    expect(raw.setFlightSelection).toHaveBeenLastCalledWith({ kind: 'planet', position: 3 });

    pointer('pointerdown', 0, 0);
    pointer('pointerup', 0, 0);
    expect(raw.setFlightSelection).toHaveBeenLastCalledWith(null);
  });
  it('navigates from system to an owned colony using only double-clicks', async () => {
    adapter.enterSystemView(star, payload);
    advanceFlight();
    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const doubleClickPlanet = () => {
      const projected = body.getWorldPosition(new Vector3()).project(space.camera);
      canvas.dispatchEvent(new MouseEvent('dblclick', {
        clientX: (projected.x + 1) * 400,
        clientY: (1 - projected.y) * 300,
        button: 0,
        bubbles: true,
      }));
    };

    doubleClickPlanet();
    expect(state()).toMatchObject({ level: 'planet', planetPosition: 3 });
    await vi.waitFor(() => expect(state().level).toBe('planet'));

    doubleClickPlanet();
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    expect(options.loadColonyData).toHaveBeenCalledOnce();
    expect(options.loadColonyData).toHaveBeenCalledWith(
      3, expect.objectContaining({ systemPayload: expect.any(Object) }), expect.any(AbortSignal),
    );
  });
  it('shows a hover marker over system planets and clears it on leave or click', () => {
    adapter.enterSystemView(star, payload);
    advanceFlight();

    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const projected = body.getWorldPosition(new Vector3()).project(space.camera);
    const x = (projected.x + 1) * 400;
    const y = (1 - projected.y) * 300;
    pointer('pointermove', x, y);
    expect(raw.setFlightHover).toHaveBeenLastCalledWith({ kind: 'planet', position: 3 });

    canvas.dispatchEvent(new Event('pointerleave'));
    expect(raw.setFlightHover).toHaveBeenLastCalledWith(null);
    pointer('pointermove', x, y);
    pointer('pointerdown', x, y);
    pointer('pointerup', x, y);
    expect(raw.setFlightHover).toHaveBeenLastCalledWith(null);
  });
  it('forwards visualization options to the shared renderer', () => {
    expect(adapter.setSystemVisualizationOptions({ orbits: false, selection: true })).toBe(true);
    expect(raw.setSystemVisualizationOptions).toHaveBeenCalledWith({ orbits: false, selection: true });
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
  it('invalidates captured camera frames when navigation supersedes them', () => {
    window.matchMedia.mockReturnValue({ matches: false });
    adapter.enterSystemView(star, payload);
    const retiredFrame = [...frameHooks][0];
    expect(retiredFrame).toBeTypeOf('function');
    adapter.enterSystemView({ ...star, system_index: 11 }, { ...payload, system: 11 });
    const afterReplacement = state();
    retiredFrame(0.5);
    expect(state()).toEqual(afterReplacement);
    expect(frameHooks.size).toBe(1);
    adapter.destroy();
  });
  it('invalidates a camera frame even when its remover throws during destroy', () => {
    window.matchMedia.mockReturnValue({ matches: false });
    const failure = new Error('Camera hook removal failed');
    raw.getSharedZoomBackend = () => ({
      addFrameHook(hook) { frameHooks.add(hook); return () => { throw failure; }; },
    });
    adapter.enterSystemView(star, payload);
    const retiredFrame = [...frameHooks][0];
    const before = state();
    expect(() => adapter.destroy()).toThrow(AggregateError);
    expect(state().transitioning).toBe(false);
    retiredFrame(0.5);
    expect(state()).toEqual({ ...before, transitioning: false });
  });
  it('removes a failed camera frame and reports its error before continuing', () => {
    window.matchMedia.mockReturnValue({ matches: false });
    const failure = new Error('Camera pose callback failed');
    let fail = false;
    options.onViewChange.mockImplementation(() => { if (fail) throw failure; });
    adapter.enterSystemView(star, payload);
    const frame = [...frameHooks][0];
    fail = true;
    frame(0.1);
    expect(frameHooks.size).toBe(0);
    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledWith(failure);
    const afterFailure = state();
    frame(0.1);
    expect(state()).toEqual(afterFailure);
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
  it('returns to the system and disposes a removed focused planet instead of retaining a stale approach', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    await vi.waitFor(() => expect(options.createZoomRuntime).toHaveBeenCalledOnce());
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    adapter.enterSystemView(star, { ...payload, planets: [payload.planets[1]] });
    expect(state()).toMatchObject({ level: 'system', planetPosition: null });
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(state().position.every(Number.isFinite)).toBe(true);
    expect(adapter.focusPlanet(3)).toBe(false);
    expect(options.onOverview).not.toHaveBeenCalled();
  });
  it('leaves a removed visible colony but retains valid focused planets on canonical refresh', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusColony(3);
    await vi.waitFor(() => expect(state().level).toBe('colony'));
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    adapter.enterSystemView(star, { ...payload, planets: structuredClone(payload.planets) });
    expect(state().level).toBe('colony');
    expect(runtime.dispose).not.toHaveBeenCalled();
    adapter.enterSystemView(star, { ...payload, planets: [
      { position: 3, generated_planet: { position: 3, name: 'No visible colony', diameter_km: 12000, semi_major_axis_au: 1 } },
      payload.planets[1],
    ] });
    expect(state()).toMatchObject({ level: 'system', planetPosition: null });
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(options.onError).not.toHaveBeenCalled();
  });
  it('cancels a pending colony entry when its planet disappears during the server read', async () => {
    adapter.enterSystemView(star, payload);
    let finish;
    options.loadColonyData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    adapter.focusColony(3);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const signal = options.loadColonyData.mock.calls[0][2];
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    adapter.enterSystemView(star, { ...payload, planets: [] });
    expect(signal.aborted).toBe(true);
    expect(runtime.dispose).toHaveBeenCalledOnce();
    finish({ colony: { id: 1 } });
    await Promise.resolve();
    await Promise.resolve();
    expect(state()).toMatchObject({ level: 'system', planetPosition: null });
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
  it('attempts every view cleanup after observer and zoom failures and releases mouse capture', async () => {
    adapter.enterSystemView(star, payload);
    adapter.focusPlanet(3);
    await vi.waitFor(() => expect(options.createZoomRuntime).toHaveBeenCalledOnce());
    const runtime = await options.createZoomRuntime.mock.results[0].value;
    await vi.waitFor(() => expect(runtime.approach).toHaveBeenCalledOnce());
    const zoomFailure = new Error('Zoom cleanup failed');
    const observerFailure = new Error('Observer cleanup failed');
    let removeAttempts = 0;
    runtime.dispose.mockImplementation(() => { throw zoomFailure; });
    raw.getSharedZoomBackend = () => ({
      addFrameHook: (hook) => {
        frameHooks.add(hook);
        return () => {
          if (++removeAttempts === 1) throw observerFailure;
          frameHooks.delete(hook);
        };
      },
    });
    const remove = adapter.observeFleetEndpoints(() => [], vi.fn());
    pointer('pointerdown', 400, 300);
    canvas.hasPointerCapture = vi.fn(() => true);

    let failure;
    try { adapter.destroy(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([observerFailure, zoomFailure]);
    expect(raw.setSpatialLabelCallbacks).toHaveBeenLastCalledWith(null);
    expect(canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    expect(window.GQAuthGalaxyBackgroundControl.returnToMenu).toHaveBeenCalledOnce();
    expect(raw.setGalaxyFleets).toHaveBeenLastCalledWith([]);
    expect(() => remove()).not.toThrow();
    expect(frameHooks.size).toBe(0);
    expect(() => adapter.destroy()).not.toThrow();
    expect(runtime.dispose).toHaveBeenCalledOnce();
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
