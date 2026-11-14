import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';

vi.mock('../../js/runtime/runtime-module-loader.js', () => ({
  loadRuntimeModule: () => new Promise(() => {}),
}));

it('exposes the onboarding contract on the real auth background adapter', async () => {
  document.body.innerHTML = '<div id="start-menu"></div><div id="galaxy-host-wrapper"><canvas id="starfield"></canvas></div>';
  delete window.Galaxy3DView;
  delete window.GQGalaxy3DRendererWebGPU;
  delete window.Galaxy3DRendererWebGPU;
  await import('../../js/rendering/starfield.js');
  const control = window.GQAuthGalaxyBackgroundControl;
  const runtime = window.__GQ_AUTH_GALAXY_BG_RUNTIME;
  expect(control.captureRegistrationView()).toBeNull();
  expect(await control.beginRegistrationTransition({})).toBe(false);
  const snapshot = {};
  const native = {
    ready: true,
    setFlightScene: vi.fn(),
    navigateTo: vi.fn(),
    captureRegistrationView: vi.fn(() => snapshot),
    beginRegistrationTransition: vi.fn(async () => true),
    skipRegistrationTransition: vi.fn(() => true),
    restoreRegistrationView: vi.fn(() => true),
    playRegistrationShot: vi.fn(() => true),
    pauseRegistrationShot: vi.fn(() => true),
    finishRegistrationShot: vi.fn(() => true),
    cancelRegistrationShot: vi.fn(),
  };
  runtime.renderer = { _native: native };
  runtime.flightTourController.stop = vi.fn();
  expect(control.captureRegistrationView()).toBe(snapshot);
  expect(await control.beginRegistrationTransition({ snapshot, reducedMotion: true })).toBe(true);
  expect(runtime.flightTourController.stop).toHaveBeenCalledOnce();
  expect(native.beginRegistrationTransition).toHaveBeenCalledWith({ snapshot, reducedMotion: true });
  const onReady = vi.fn();
  await control.beginRegistrationTransition({ snapshot, onReady });
  expect(native.beginRegistrationTransition).toHaveBeenLastCalledWith({ snapshot, reducedMotion: false, onReady });
  const shot = { kind: 'target', target: { kind: 'planet', position: 3 }, duration_ms: 4500 };
  expect(control.playRegistrationShot(shot)).toBe(true);
  expect(native.playRegistrationShot).toHaveBeenCalledWith(shot);
  const world = { scene_key: 'homeworld:1:2', system_name: 'Public', target: {
    galaxy_index: 1, system_index: 2, position: 3, x_ly: 1, y_ly: 2, z_ly: 3,
  }, position: { galaxy: 1, system: 2, position: 3 }, star: {},
  planets: [{ position: 3, class: 'rocky', inhabited: true, diameter_km: 12000 }] };
  expect(control.playRegistrationShot({ kind: 'comet-world', destination: world, duration_ms: 45000 })).toBe(true);
  const graph = native.playRegistrationShot.mock.calls.at(-1)[0].destination;
  const facilities = graph.children[0].children[0].children.filter((child) => child.type === 'facility');
  expect(facilities.map((child) => child.data.zone)).toEqual(['surface', 'orbital']);
  expect(facilities.every((child) => child.data.preview_only)).toBe(true);
  const privateWorld = { ...world, scene_key: undefined, prolog_token: 'private' };
  expect(control.playRegistrationShot({ kind: 'comet-world', destination: privateWorld, duration_ms: 45000 })).toBe(true);
  const privateGraph = native.playRegistrationShot.mock.calls.at(-1)[0].destination;
  expect(privateGraph.children[0].children[0].children.some((child) => child.type === 'facility')).toBe(false);
  expect(control.pauseRegistrationShot(true)).toBe(true);
  expect(native.pauseRegistrationShot).toHaveBeenCalledWith(true);
  expect(control.finishRegistrationShot()).toBe(true);
  control.cancelRegistrationShot();
  expect(native.cancelRegistrationShot).toHaveBeenCalledOnce();
  expect(control.skipRegistrationTransition()).toBe(true);
  expect(control.restoreRegistrationView(snapshot)).toBe(true);

  window.eval(fs.readFileSync(path.resolve('js/rendering/starfield-webgpu.js'), 'utf8'));
  window.GQPerspectiveSpaceFlight = PerspectiveSpaceFlight;
  const renderer = new window.StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
  renderer.ready = true;
  renderer.setFlightScene({ stage: 'galaxy', flightTour: true });
  const flight = renderer.getSpaceView();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const scene = new Group();
  scene.add(new Mesh(geometry, new MeshBasicMaterial()));
  flight.vesselRenderPass.loaderFactory = () => ({ loadAsync: async () => ({ scene }) });
  runtime.renderer = {
    _native: renderer,
    setRegionPreview: (...args) => renderer.setRegionPreview(...args),
    setRegistrationScene: (...args) => renderer.setRegistrationScene(...args),
  };
  runtime.stars = [{ x_ly: 10000, y_ly: 20000, z_ly: 30000 }];
  runtime.registrationPreview = null;
  const captured = control.captureRegistrationView();
  const transition = control.beginRegistrationTransition({ snapshot: captured });
  for (let i = 0; i < 30 && renderer._registrationTransition?.phase === 'loading'; i++) await Promise.resolve();
  expect(renderer._registrationTransition?.phase).toBe('moving');
  expect(control.skipRegistrationTransition()).toBe(true);
  expect(await transition).toBe(true);
  const transfer = renderer.getRegistrationTransferInfo();
  const entity = flight.spaceEntities.get(transfer.id);
  const arrived = renderer.camera.position.clone();
  expect(control.setRegistrationPreview({ stage: 'galaxy', beat: 'teaser-distance' })).toBe(true);
  expect(renderer.getSpaceView()).toBe(flight);
  expect(flight.spaceEntities.get(transfer.id)).toBe(entity);
  expect(renderer.camera.position.toArray()).toEqual(arrived.toArray());
  expect(entity.to.distanceTo(new Vector3(...transfer.anchor))).toBeLessThan(transfer.scale * 20);
  expect(entity.to.distanceTo(new Vector3(10000, 20000, 30000))).toBeGreaterThan(1000);
  renderer.dispose();

  const skipped = new window.StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
  skipped.ready = true;
  skipped.setFlightScene({ stage: 'galaxy', flightTour: true });
  const skippedFlight = skipped.getSpaceView();
  let finishLoad;
  skippedFlight.vesselRenderPass.loaderFactory = () => ({
    loadAsync: () => new Promise((resolve) => { finishLoad = resolve; }),
  });
  runtime.renderer = {
    _native: skipped,
    setRegionPreview: (...args) => skipped.setRegionPreview(...args),
    setRegistrationScene: (...args) => skipped.setRegistrationScene(...args),
  };
  runtime.registrationPreview = null;
  const skippedSnapshot = control.captureRegistrationView();
  const skippedArrival = control.beginRegistrationTransition({ snapshot: skippedSnapshot });
  expect(control.skipRegistrationTransition()).toBe(true);
  expect(await skippedArrival).toBe(false);
  expect(control.setRegistrationPreview({ stage: 'galaxy', beat: 'teaser-distance' })).toBe(true);
  finishLoad({ scene });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(skipped.getSpaceView()).toBe(skippedFlight);
  expect(skippedFlight.spaceEntities.size).toBe(0);
  expect(skippedFlight.vesselRenderPass.resources.size).toBe(0);
  skipped.dispose();

  const menu = new window.StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
  menu.ready = true;
  menu._viewState.zoom = 2;
  runtime.renderer = {
    _native: menu,
    setRegionPreview: (...args) => menu.setRegionPreview(...args),
    setRegistrationScene: (...args) => menu.setRegistrationScene(...args),
  };
  runtime.registrationPreview = null;
  const menuSnapshot = control.captureRegistrationView();
  expect(control.setRegistrationPreview({ stage: 'opening', beat: 'opening-galaxy' })).toBe(true);
  expect(menu.getSpaceView()).toBeFalsy();
  expect(menu._viewState.targetPanX).toBe(0);
  expect(menu._viewState.targetPanY).toBe(0);
  expect(menu._viewState.targetZoom).toBe(1);
  const setStars = vi.fn();
  runtime.renderer.setStars = setStars;
  const setFlightScene = vi.spyOn(menu, 'setFlightScene');
  const destination = { x_ly: 20, y_ly: 30, z_ly: 0, galaxy_index: 1, system_index: 2 };
  expect(control.setRegistrationPreview({ stage: 'planet', cometTour: true, stars: [destination],
    draft: { scene_key: 'homeworld:test' } })).toBe(true);
  expect(setStars).toHaveBeenCalledOnce();
  expect(setFlightScene).not.toHaveBeenCalled();
  expect(menu.getSpaceView()).toBeFalsy();
  expect(control.restoreRegistrationView(menuSnapshot)).toBe(true);
  expect(menu._viewState.zoom).toBe(2);
  expect(await control.beginRegistrationTransition({ snapshot: menuSnapshot })).toBe(false);
  expect(control.setRegistrationPreview({ stage: 'galaxy', beat: 'teaser-distance' })).toBe(true);
  expect(menu.getSpaceView()).toBeFalsy();
  expect(menu._viewState.zoom).toBe(2);
  menu.dispose();

  runtime.released = true;
  expect(control.restoreRegistrationView(snapshot)).toBe(false);
});
