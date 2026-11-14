import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Object3D, Vector3 } from 'three';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { createSpaceEntity } from '../../js/rendering/space-entity.js';
import content from '../../config/onboarding_prologue.json';

const openingShots = [
  { camera: { kind: 'galaxy', position: [0.1, -1.15, 1.05], lookAt: [0, 0, 0], fov: 58, duration_ms: 12000 } },
  { camera: { kind: 'galaxy', position: [0, -0.75, 1.35], lookAt: [0, 0, 0], fov: 52, duration_ms: 8500 } },
];

afterEach(() => vi.restoreAllMocks());

describe('registration camera direction', () => {
  it('moves the actual 3D camera between authored galaxy poses and freezes it on pause', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const shot = { ...openingShots[0].camera, duration_ms: 1000 };
    const before = flight.camera.position.clone();
    expect(flight.setCameraShot(shot)).toBe(true);
    expect(flight.camera.position.equals(before)).toBe(true);
    flight.update(0.05);
    expect(flight.camera.position.distanceTo(before)).toBeGreaterThan(0);
    const paused = flight.camera.position.clone();
    flight.setCameraShotPaused(true);
    for (let i = 0; i < 30; i++) flight.update(0.05);
    expect(flight.camera.position.equals(paused)).toBe(true);
    flight.setCameraShotPaused(false);
    for (let i = 0; i < 30; i++) flight.update(0.05);
    expect(flight.camera.position.toArray()).toEqual(shot.position.map((coordinate) => coordinate * 100));
    const core = new Vector3().project(flight.camera);
    expect(core.x).toBeCloseTo(0);
    expect(core.y).toBeCloseTo(0);
    expect(flight.camera.fov).toBe(shot.fov);
    expect(flight.setCameraShot(openingShots[1].camera, { reducedMotion: true })).toBe(true);
    expect(flight.camera.fov).toBe(52);
    const held = flight.camera.position.clone();
    flight.cancelCameraShot();
    flight.update(0.05);
    expect(flight.camera.position.equals(held)).toBe(true);
    flight.dispose();
  });

  it('tracks a real moving ship with shot framing and releases camera ownership on cancel', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const ship = createSpaceEntity({
      id: 'moving-ship', space_entity: 'vessel', visual_scale_ly: 1,
    }, [new Vector3(), new Vector3(20, 0, 0)], flight.camera, 7);
    flight.spaceEntities.set(ship.id, ship);
    const shot = { ...content.teaser[0].camera, target: { kind: 'ship', id: ship.id } };
    expect(flight.setCameraShot(shot)).toBe(true);
    const before = flight.camera.position.clone();
    for (let i = 0; i < 60; i++) flight.update(0.05);
    expect(ship.position.x).toBeGreaterThan(0);
    expect(flight.camera.position.distanceTo(before)).toBeGreaterThan(1);
    flight.setCameraShotPaused(true);
    const paused = flight.camera.position.clone();
    const pausedShip = ship.position.clone();
    flight.update(0.05);
    expect(flight.camera.position.equals(paused)).toBe(true);
    expect(ship.position.equals(pausedShip)).toBe(true);
    expect(flight.setCameraShot({ ...shot, target: { id: 'missing' } })).toBe(false);
    expect(flight.cameraFollowEntity).toBe(ship);
    flight.cancelCameraShot();
    for (let i = 0; i < 5; i++) flight.update(0.05);
    expect(ship.position.equals(pausedShip)).toBe(false);
    expect(flight.camera.position.equals(paused)).toBe(true);
    flight.dispose();
  });

  it('addresses existing asteroids and colony anchors without inventing target data', () => {
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const planet = new Object3D();
    planet.userData = { type: 'planet', data: { position: 3 }, radius: 10 };
    const asteroid = new Object3D();
    asteroid.position.set(40, 0, 0);
    asteroid.userData = { type: 'asteroid', data: { position: 8 }, radius: 0.1 };
    flight.root.add(planet, asteroid);
    flight.bodies = [planet, asteroid];
    flight.root.updateMatrixWorld(true);
    const colony = createSpaceEntity({
      id: 'colony:test:3:preview', space_entity: 'colony', visual_scale_ly: 0.35,
      anchor_body: { kind: 'planet', position: 3 }, surface_height_ly: 0.02,
    }, [new Vector3(), new Vector3()], flight.camera, 7);
    flight.spaceEntities.set(colony.id, colony);
    flight.update(0);
    expect(flight.setCameraShot({
      kind: 'target', target: { kind: 'asteroid', position: 8 }, duration_ms: 1000,
    })).toBe(true);
    expect(flight.flight.collisionBody).toBe(asteroid);
    expect(flight.setCameraShot({
      kind: 'target', target: { kind: 'colony', position: 3 }, duration_ms: 1000,
    }, { reducedMotion: true })).toBe(true);
    expect(flight.camera.position.length()).toBeGreaterThan(10.8);
    expect(flight.camera.position.length()).toBeLessThan(14);
    expect(flight.cameraShot.finished).toBe(true);
    expect(flight.setCameraShot({
      kind: 'target', target: { kind: 'colony', position: 99 }, duration_ms: 1000,
    })).toBe(false);
    flight.dispose();
  });

  it('ignores a late initialized shot and remembers pause/reduced-motion during preparation', async () => {
    window.eval(fs.readFileSync(path.resolve('js/rendering/starfield-webgpu.js'), 'utf8'));
    window.GQPerspectiveSpaceFlight = PerspectiveSpaceFlight;
    let finish;
    vi.spyOn(PerspectiveSpaceFlight.prototype, 'initialize').mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; }));
    const renderer = new window.StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    renderer.ready = true;
    renderer._device = {};
    renderer._sceneFormat = 'bgra8unorm';
    const first = renderer.playRegistrationShot(openingShots[0].camera);
    const next = renderer.playRegistrationShot(openingShots[1].camera);
    renderer.pauseRegistrationShot(true);
    renderer.finishRegistrationShot();
    finish();
    expect(await first).toBe(false);
    expect(await next).toBe(true);
    expect(renderer.getSpaceView().cameraShot.paused).toBe(true);
    expect(renderer.camera.fov).toBe(52);
    const position = renderer.camera.position.clone();
    renderer.cancelRegistrationShot();
    renderer.getSpaceView().update(0.05);
    expect(renderer.camera.position.equals(position)).toBe(true);
    renderer.dispose();
  });

  it('settles cancellation before initialization and cannot resurrect the camera after restoring the menu', async () => {
    window.eval(fs.readFileSync(path.resolve('js/rendering/starfield-webgpu.js'), 'utf8'));
    window.GQPerspectiveSpaceFlight = PerspectiveSpaceFlight;
    let finish;
    vi.spyOn(PerspectiveSpaceFlight.prototype, 'initialize').mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; }));
    const renderer = new window.StarfieldWebGPU(document.createElement('canvas'), { menuGalaxy: true });
    Object.assign(renderer, { ready: true, _device: {}, _sceneFormat: 'bgra8unorm' });
    const snapshot = renderer.captureRegistrationView();
    const pending = renderer.playRegistrationShot(openingShots[0].camera);
    expect(renderer.restoreRegistrationView(snapshot)).toBe(true);
    expect(await pending).toBe(false);
    finish();
    await Promise.resolve();
    expect(renderer.getSpaceView()).toBeNull();
    expect(renderer.camera.position).toEqual({ x: 0, y: 0, z: 1 });
    renderer.dispose();
  });
});
