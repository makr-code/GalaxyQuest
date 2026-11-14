import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';

function renderer() {
  window.eval(fs.readFileSync(path.resolve('js/rendering/starfield-webgpu.js'), 'utf8'));
  window.GQPerspectiveSpaceFlight = PerspectiveSpaceFlight;
  return new window.StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
}

function installVesselLoader(flight, load) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const scene = new Group();
  scene.add(new Mesh(geometry, new MeshBasicMaterial()));
  flight.vesselRenderPass.loaderFactory = () => ({ loadAsync: load || (async () => ({ scene })) });
  return scene;
}

async function waitForAsset(r) {
  for (let i = 0; i < 100
    && ['initializing', 'loading'].includes(r._registrationTransition?.phase); i++) await Promise.resolve();
  expect(r._registrationTransition?.phase).toBe('moving');
}

describe('registration camera transition', () => {
  it('creates the spatial view from the captured default 2D galaxy and completes a ship arrival', async () => {
    const r = renderer();
    Object.assign(r, { _device: {}, _sceneFormat: 'bgra8unorm' });
    const scene = installVesselLoader({ vesselRenderPass: { loaderFactory: null } });
    const initialize = vi.spyOn(PerspectiveSpaceFlight.prototype, 'initialize').mockResolvedValue(undefined);
    const resolveTarget = vi.spyOn(PerspectiveSpaceFlight.prototype, 'resolveTarget').mockImplementation(function () {
      return {
        destination: this.camera.position.clone().add(new Vector3(0, -20, 8)),
        focus: this.camera.position.clone().add(new Vector3(0, -12, 4)),
      };
    });
    const snapshot = r.captureRegistrationView();
    Object.assign(snapshot.viewState, { panX: 0.1, panY: -0.08, zoom: 1.4 });
    snapshot.rotation = 0.35;
    r._viewState = { ...snapshot.viewState };
    r._galaxyRotation = snapshot.rotation;
    const originalSetFlightScene = r.setFlightScene.bind(r);
    r.setFlightScene = (...args) => {
      const result = originalSetFlightScene(...args);
      const activeFlight = r.getSpaceView();
      if (activeFlight) activeFlight.vesselRenderPass.loaderFactory = () => ({ loadAsync: async () => ({ scene }) });
      return result;
    };

    const onReady = vi.fn();
    const transition = r.beginRegistrationTransition({ snapshot, onReady });
    await waitForAsset(r);
    const spatialFlight = r.getSpaceView();
    expect(initialize).toHaveBeenCalledOnce();
    expect(resolveTarget).toHaveBeenCalledWith(
      { kind: 'ship', id: expect.stringMatching(/^registration-transition-/) },
      { safeFraming: true },
    );
    expect(onReady).toHaveBeenCalledOnce();
    expect(spatialFlight.camera.position.toArray()).not.toEqual([0, 0, 1]);
    Object.assign(r, {
      _context: {}, _pipeline: {}, _starBuffer: {}, _viewUniformBuffer: {}, _viewBindGroup: {}, _starCount: 1,
    });
    spatialFlight.renderFrame = vi.fn();
    for (let frame = 1; frame <= 65; frame++) r._renderFrame(frame * 50);
    expect(await transition).toBe(true);
    expect(r.registrationArrivalFellBack()).toBe(false);
    r.dispose();
    vi.restoreAllMocks();
  });

  it('restores a cancelled default 2D view if spatial initialization finishes late', async () => {
    const r = renderer();
    Object.assign(r, { _device: {}, _sceneFormat: 'bgra8unorm' });
    let finishInitialization;
    const initialize = vi.spyOn(PerspectiveSpaceFlight.prototype, 'initialize')
      .mockImplementation(() => new Promise((resolve) => { finishInitialization = resolve; }));
    const snapshot = r.captureRegistrationView();
    const transition = r.beginRegistrationTransition({ snapshot });
    await vi.waitFor(() => expect(finishInitialization).toBeTypeOf('function'));
    expect(r.getSpaceView()).not.toBeNull();
    expect(r.restoreRegistrationView(snapshot)).toBe(true);
    expect(await transition).toBe(false);
    finishInitialization();
    await Promise.resolve();
    expect(r.getSpaceView()).toBeNull();
    expect(r.camera.position).toEqual({ x: 0, y: 0, z: 1 });
    expect(initialize).toHaveBeenCalledOnce();
    r.dispose();
    vi.restoreAllMocks();
  });

  it('discards a late transfer-ship load when the default 2D arrival is skipped', async () => {
    const r = renderer();
    Object.assign(r, { _device: {}, _sceneFormat: 'bgra8unorm' });
    vi.spyOn(PerspectiveSpaceFlight.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(PerspectiveSpaceFlight.prototype, 'resolveTarget').mockImplementation(function () {
      return {
        destination: this.camera.position.clone().add(new Vector3(0, -20, 8)),
        focus: this.camera.position.clone().add(new Vector3(0, -12, 4)),
      };
    });
    let finishLoad;
    const scene = new Group();
    const originalSetFlightScene = r.setFlightScene.bind(r);
    r.setFlightScene = (...args) => {
      const result = originalSetFlightScene(...args);
      r.getSpaceView().vesselRenderPass.loaderFactory = () => ({
        loadAsync: () => new Promise((resolve) => { finishLoad = resolve; }),
      });
      return result;
    };
    const snapshot = r.captureRegistrationView();
    const onReady = vi.fn();
    const pending = r.beginRegistrationTransition({ snapshot, onReady });
    await vi.waitFor(() => expect(finishLoad).toBeTypeOf('function'));
    const flight = r.getSpaceView();
    const id = [...flight.spaceEntities.keys()][0];
    const initialCameraPosition = flight.camera.position.toArray();
    expect(r.skipRegistrationTransition()).toBe(true);
    expect(await pending).toBe(false);
    finishLoad({ scene });
    for (let index = 0; index < 30; index++) await Promise.resolve();
    expect(flight.spaceEntities.has(id)).toBe(false);
    expect(flight.vesselRenderPass.resources.has(id)).toBe(false);
    expect(flight.camera.position.toArray()).toEqual(initialCameraPosition);
    expect(r.getRegistrationTransferInfo()).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    r.dispose();
    vi.restoreAllMocks();
  });

  it('captures and restores the 2D galaxy without inventing a spatial target', async () => {
    const r = renderer();
    Object.assign(r._viewState, { panX: 0.3, panY: -0.2, zoom: 2, targetZoom: 3 });
    r._galaxyRotation = 0.7;
    const snapshot = r.captureRegistrationView();
    r.setStars([{ x_ly: 20, y_ly: 10, z_ly: 0 }]);
    r.setRegionPreview({ x_ly: 1, y_ly: 2 });
    expect(await r.beginRegistrationTransition({ snapshot })).toBe(false);
    expect(r._perspectiveFlight).toBeFalsy();
    expect(r._viewState.zoom).toBe(2);
    r._galaxyRotation = 2;
    expect(r.restoreRegistrationView(snapshot)).toBe(true);
    expect(r._galaxyRotation).toBe(0.7);
    expect(r._viewState.targetZoom).toBe(3);
    expect(r.stars).toEqual([]);
    r.dispose();
    expect(r.captureRegistrationView()).toBeNull();
    expect(await r.beginRegistrationTransition({ snapshot })).toBe(false);
  });

  it('starts at the captured flight camera, cancels navigation and finishes on the render loop', async () => {
    const r = renderer();
    r.setFlightScene({ stage: 'galaxy', flightTour: true });
    const flight = r.getSpaceView();
    installVesselLoader(flight);
    flight.camera.position.set(0, -30, 12);
    flight.camera.lookAt(0, 0, 0);
    const snapshot = r.captureRegistrationView();
    const nav = r.navigateTo({ kind: 'point', x_ly: 1, y_ly: 2, z_ly: 3 });
    const transition = r.beginRegistrationTransition({ snapshot });
    expect(await nav).toBe(false);
    expect(flight.camera.position.toArray()).toEqual(snapshot.spatial.position);
    expect(r.navigateTo({ kind: 'point', x_ly: 1, y_ly: 2, z_ly: 3 })).toBe(false);
    await waitForAsset(r);
    const vessel = flight.spaceEntities.get(r.getRegistrationTransferInfo().id);
    const forward = flight.camera.getWorldDirection(flight.camera.position.clone());
    expect(vessel.position.clone().sub(flight.origin).sub(flight.camera.position).dot(forward)).toBeGreaterThan(0);
    const start = flight.camera.position.clone();
    Object.assign(r, { _device: {}, _context: {}, _pipeline: {}, _starBuffer: {},
      _viewUniformBuffer: {}, _viewBindGroup: {}, _starCount: 1 });
    flight.renderFrame = vi.fn();
    for (let frame = 1; frame <= 65; frame++) r._renderFrame(frame * 50);
    expect(await transition).toBe(true);
    expect(flight.camera.position.distanceTo(start)).toBeGreaterThan(vessel.scale);
    expect(flight.renderFrame).toHaveBeenCalled();
    r.dispose();
  });

  it('reports an asset failure without moving or leaving a temporary vessel', async () => {
    const r = renderer();
    r.setFlightScene({ stage: 'galaxy', flightTour: true });
    installVesselLoader(r.getSpaceView(), async () => { throw new Error('missing asset'); });
    const snapshot = r.captureRegistrationView();
    const nav = r.navigateTo({ kind: 'point', x_ly: 4, y_ly: 5, z_ly: 6 });
    expect(await r.beginRegistrationTransition({ snapshot })).toBe(false);
    expect(await nav).toBe(false);
    expect(r.camera.position.toArray()).toEqual(snapshot.spatial.position);
    expect(r.camera.quaternion.toArray()).toEqual(snapshot.spatial.quaternion);
    expect(r.getSpaceView().spaceEntities.size).toBe(0);
    r.dispose();
  });

  it('skips promptly, restores after a scene reset and preserves the exact camera pose', async () => {
    const r = renderer();
    const graph = { type: 'galaxy', children: [{ type: 'system',
      data: { x_ly: 10, y_ly: 20, z_ly: 30 }, children: [] }] };
    r.setFlightScene({ stage: 'system', flightTour: true, sceneGraph: graph });
    const flight = r.getSpaceView();
    installVesselLoader(flight);
    flight.camera.position.set(4, 5, 6);
    flight.camera.up.set(0, 1, 0);
    flight.camera.lookAt(1, 2, 3);
    flight.camera.fov = 43;
    const snapshot = r.captureRegistrationView();
    const pending = r.beginRegistrationTransition({ snapshot });
    await waitForAsset(r);
    expect(r.skipRegistrationTransition()).toBe(true);
    expect(await pending).toBe(true);
    expect(r.skipRegistrationTransition()).toBe(false);
    r.setRegistrationScene(null);
    expect(r.restoreRegistrationView(snapshot)).toBe(true);
    const restored = r.getSpaceView();
    expect(restored).not.toBe(flight);
    expect(restored.origin.toArray()).toEqual(snapshot.spatial.origin);
    expect(restored.camera.position.toArray()).toEqual(snapshot.spatial.position);
    expect(restored.camera.quaternion.toArray()).toEqual(snapshot.spatial.quaternion);
    expect(restored.camera.up.toArray()).toEqual(snapshot.spatial.up);
    expect(restored.camera.fov).toBe(43);
    expect(restored.bodies.length).toBeGreaterThan(0);
    r.dispose();
  });

  it('returns immediately without loading or moving for reduced motion', async () => {
    const r = renderer();
    r.setFlightScene({ stage: 'galaxy', flightTour: true });
    const loader = vi.fn(async () => { throw new Error('must not load for reduced motion'); });
    installVesselLoader(r.getSpaceView(), loader);
    const snapshot = r.captureRegistrationView();
    expect(await r.beginRegistrationTransition({ snapshot, reducedMotion: true })).toBe(true);
    expect(loader).not.toHaveBeenCalled();
    expect(r.getSpaceView().camera.position.toArray()).toEqual(snapshot.spatial.position);
    expect(r.skipRegistrationTransition()).toBe(false);
    r.dispose();
  });

  it('cancels stale work when the scene changes or the renderer stops', async () => {
    const r = renderer();
    r.setFlightScene({ stage: 'galaxy', flightTour: true });
    installVesselLoader(r.getSpaceView());
    const snapshot = r.captureRegistrationView();
    const first = r.beginRegistrationTransition({ snapshot });
    r.setFlightScene(null);
    expect(await first).toBe(false);
    const second = r.beginRegistrationTransition({ snapshot });
    r.stop();
    expect(await second).toBe(false);
    expect(r.skipRegistrationTransition()).toBe(false);
    r.dispose();
  });

  it('settles when rendering stalls and cancels its fallback after restore', async () => {
    vi.useFakeTimers();
    try {
      const r = renderer();
      r.setFlightScene({ stage: 'galaxy', flightTour: true });
      installVesselLoader(r.getSpaceView());
      const snapshot = r.captureRegistrationView();
      const transition = r.beginRegistrationTransition({ snapshot });
      await waitForAsset(r);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await transition).toBe(true);
      const second = r.beginRegistrationTransition({ snapshot });
      r.restoreRegistrationView(snapshot);
      expect(await second).toBe(false);
      await vi.advanceTimersByTimeAsync(4000);
      expect(r.getSpaceView().camera.position.toArray()).toEqual(snapshot.spatial.position);
      r.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects genuine camera errors and clears ownership', async () => {
    const r = renderer();
    r.setFlightScene({ stage: 'galaxy', flightTour: true });
    installVesselLoader(r.getSpaceView());
    const pending = r.beginRegistrationTransition({ snapshot: r.captureRegistrationView() });
    await waitForAsset(r);
    vi.spyOn(r.camera, 'updateMatrixWorld').mockImplementation(() => { throw new Error('camera failed'); });
    r.skipRegistrationTransition();
    await expect(pending).rejects.toThrow('camera failed');
    expect(r.skipRegistrationTransition()).toBe(false);
    vi.restoreAllMocks();
    r.dispose();
  });

  it.each(['skip', 'restore'])('discards late asset loads after %s while loading', async (action) => {
    const r = renderer();
    r.setFlightScene({ stage: 'galaxy', flightTour: true });
    const flight = r.getSpaceView();
    let finishLoad;
    const scene = installVesselLoader(flight, () => new Promise((resolve) => { finishLoad = resolve; }));
    const snapshot = r.captureRegistrationView();
    const pending = r.beginRegistrationTransition({ snapshot });
    const id = [...flight.spaceEntities.keys()][0];
    expect(id).toBeTruthy();
    if (action === 'skip') expect(r.skipRegistrationTransition()).toBe(true);
    else expect(r.restoreRegistrationView(snapshot)).toBe(true);
    expect(await pending).toBe(false);
    finishLoad({ scene });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(flight.spaceEntities.has(id)).toBe(false);
    expect(flight.vesselRenderPass.resources.has(id)).toBe(false);
    expect(r.camera.position.toArray()).toEqual(snapshot.spatial.position);
    expect(r.getRegistrationTransferInfo()).toBeNull();
    r.dispose();
  });
});
