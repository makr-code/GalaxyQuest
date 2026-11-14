import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { createSpaceEntity } from '../../js/rendering/space-entity.js';
import { RegistrationCometTour, RegistrationVoyage } from '../../js/rendering/registration-voyage.js';
import { COMET_PARTICLE_COUNT, COMET_ION_PARTICLE_COUNT, COMET_COMA_PARTICLE_COUNT, createCometTail,
  createCometIonTail, createCometComa, resolveCometTailAxes, sampleCometParticle, sampleCometIonParticle,
  sampleCometComaParticle } from '../../js/rendering/comet-tail.js';

function scene(x, position = 1) {
  return { type: 'galaxy', target: { position }, children: [{
    type: 'system', data: { x_ly: x, y_ly: 0, z_ly: 0, radius_solar: 1 },
    children: [{ type: 'planet', data: { position, diameter_km: 12000, semi_major_axis_au: 1 },
      children: [{ type: 'colony-site', children: [] }] }],
  }] };
}

function addComet(flight, position = new Vector3()) {
  const comet = createSpaceEntity({ id: 'onboarding-comet', space_entity: 'comet', visual_scale_ly: 1 },
    [position, position.clone().add(new Vector3(1, 0, 0))], flight.camera, 60);
  flight.spaceEntities.set(comet.id, comet);
  return comet;
}

describe('comet and shuttle cinematics', () => {
  it('creates a bounded, deterministic 3D wake that streams past the follow camera', () => {
    const tail = createCometTail();
    const flight = new PerspectiveSpaceFlight({ radius: 100 });
    const comet = createSpaceEntity({ id: 'onboarding-comet', space_entity: 'comet', visual_scale_ly: 1 },
      [new Vector3(), new Vector3(20, 0, 0)], flight.camera, 60);
    expect(tail).toHaveLength(COMET_PARTICLE_COUNT);
    expect(createCometTail()).toEqual(tail);
    const axes = resolveCometTailAxes(comet, null);
    const before = sampleCometParticle(tail[100], comet, 0, axes);
    const later = sampleCometParticle(tail[100], comet, 1, axes);
    expect(before.position.equals(later.position)).toBe(false);
    expect(before.position.x).toBeLessThan(-1);
    expect(before.position.toArray().every(Number.isFinite)).toBe(true);
    expect(before.opacity).toBeGreaterThan(0);
    const coma = createCometComa();
    expect(coma).toHaveLength(COMET_COMA_PARTICLE_COUNT);
    const dust = sampleCometComaParticle(coma[0], comet, 0);
    const movingDust = sampleCometComaParticle(coma[0], comet, 1);
    expect(dust.position.distanceTo(comet.position)).toBeGreaterThan(comet.scale * 0.6);
    expect(dust.position.distanceTo(comet.position)).toBeLessThan(comet.scale * 2.5);
    expect(dust.position.equals(movingDust.position)).toBe(false);
    expect(dust.opacity).toBeGreaterThan(0.1);
    const nucleus = flight.vesselRenderPass._createProceduralScene('comet');
    expect(nucleus.isMesh).toBe(true);
    const vertices = flight.vesselRenderPass._extractVertices(nucleus);
    expect(vertices.length).toBeGreaterThan(100);
    const reds = Array.from({ length: vertices.length / 10 }, (_, index) => vertices[index * 10 + 6]);
    expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(0.3);
    nucleus.geometry.dispose();
    nucleus.material.dispose();
    flight.dispose();
  });

  it('orients distinct dust and ion tails away from the actual nearby star, not the comet heading', () => {
    const flight = new PerspectiveSpaceFlight();
    const comet = createSpaceEntity({ id: 'comet', space_entity: 'comet', visual_scale_ly: 1e-8 },
      [new Vector3(0.0001, 0, 0), new Vector3(0.0001, 1, 0)], flight.camera, 60);
    const axes = resolveCometTailAxes(comet, new Vector3());
    expect(axes.nearStar).toBe(true);
    expect(axes.axis.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12);
    const dust = sampleCometParticle(createCometTail()[120], comet, 0, axes).position.sub(comet.position);
    const ionParticles = createCometIonTail();
    expect(ionParticles).toHaveLength(COMET_ION_PARTICLE_COUNT);
    const ion = sampleCometIonParticle(ionParticles[120], comet, 0, axes).position.sub(comet.position);
    expect(dust.dot(axes.axis)).toBeGreaterThan(0);
    expect(ion.dot(axes.axis)).toBeGreaterThan(0);
    expect(Math.abs(ion.y)).toBeLessThan(Math.abs(dust.y));
    const distant = resolveCometTailAxes(comet, new Vector3(10, 0, 0));
    expect(distant.nearStar).toBe(false);
    expect(distant.axis.dot(comet.getForwardDirection())).toBeCloseTo(-1);
    const edge = resolveCometTailAxes(comet, new Vector3(0.0001 - 100 / 63241.07708426628, 0, 0));
    expect(edge.axis.dot(distant.axis)).toBeCloseTo(1);
    flight.dispose();
  });

  it('flies the same comet to successive public homeworlds and preserves pause and cancellation', async () => {
    const flight = new PerspectiveSpaceFlight();
    const comet = addComet(flight, new Vector3(-300, 0, 0));
    const first = new RegistrationCometTour(flight, comet, scene(0), 1000);
    flight.registrationVoyage = first;
    flight.cameraShot = { kind: 'comet-world', paused: false };
    first.update(0.5);
    expect(comet.position.x).toBeGreaterThan(-300);
    flight.setCameraShotPaused(true);
    const position = comet.position.clone();
    flight.update(0.05);
    expect(comet.position.equals(position)).toBe(true);
    flight.setCameraShotPaused(false);
    first.update(0, true);
    expect(await first.finished).toBe(true);
    expect(flight.origin.x).toBe(0);
    const arrived = comet.position.clone();
    const cameraOffset = flight.camera.position.clone().sub(comet.position.clone().sub(flight.origin));
    first.update(0.05);
    expect(comet.position.equals(arrived)).toBe(false);
    const movedOffset = flight.camera.position.clone().sub(comet.position.clone().sub(flight.origin));
    expect(movedOffset.distanceTo(cameraOffset)).toBeLessThan(first.world.radius * 0.01);
    const next = new RegistrationCometTour(flight, comet, scene(300), 1000);
    const atDeparture = comet.position.clone();
    next.update(0);
    expect(comet.position.equals(atDeparture)).toBe(true);
    next.update(0.5);
    expect(comet.position.x).toBeGreaterThan(0);
    next.cancel();
    expect(await next.finished).toBe(false);
    expect(flight.spaceEntities.get('onboarding-comet')).toBe(comet);
    flight.dispose();
  });

  it('moves the camera with the comet during the initial framing transition', () => {
    const flight = new PerspectiveSpaceFlight();
    const comet = addComet(flight, new Vector3(-300, 0, 0));
    flight.camera.position.copy(comet.position).add(new Vector3(-5, 0, 2));
    const tour = new RegistrationCometTour(flight, comet, scene(300), 45000);
    const before = comet.position.clone();
    const cameraBefore = flight.camera.position.clone();
    const orientationBefore = flight.camera.quaternion.clone();
    tour.update(4);
    const cometMovement = comet.position.clone().sub(before);
    const cameraMovement = flight.camera.position.clone().sub(cameraBefore);
    expect(cometMovement.length()).toBeGreaterThan(10);
    expect(cameraMovement.distanceTo(cometMovement)).toBeLessThan(10);
    expect(flight.camera.quaternion.angleTo(orientationBefore)).toBeGreaterThan(0.1);
    tour.cancel();
    flight.dispose();
  });

  it('frames the planetary limb from outside the surface while following the comet', () => {
    const flight = new PerspectiveSpaceFlight();
    const comet = addComet(flight, new Vector3(-300, 0, 0));
    const tour = new RegistrationCometTour(flight, comet, scene(0), 45000);
    tour.update(0, true);
    const center = tour.world.center.clone().sub(flight.origin);
    const local = center.clone().applyMatrix4(flight.camera.matrixWorldInverse);
    const depth = -local.z;
    const denominator = depth * depth - tour.world.radius * tour.world.radius;
    const focal = flight.camera.projectionMatrix.elements[5];
    const top = focal * (local.y * depth + tour.world.radius * Math.sqrt(denominator + local.y * local.y))
      / denominator;
    expect(top).toBeGreaterThan(-0.4);
    expect(top).toBeLessThan(-0.2);
    expect(flight.camera.position.distanceTo(center)).toBeGreaterThan(tour.world.radius);
    expect(comet.position.distanceTo(tour.world.center)).toBeGreaterThan(tour.world.radius);
    expect(comet.position.clone().sub(flight.origin).project(flight.camera).x).toBeCloseTo(0, 3);
    tour.cancel();
    flight.dispose();
  });

  it('places preview surface and orbital structures in the near-side flyby view', () => {
    const flight = new PerspectiveSpaceFlight();
    vi.spyOn(flight, '_registerSystemSpaceEntity').mockImplementation((descriptor) => {
      const entity = createSpaceEntity(descriptor, [new Vector3(), new Vector3()], flight.camera);
      flight.spaceEntities.set(entity.id, entity);
    });
    const comet = addComet(flight, new Vector3(-300, 0, 0));
    const destination = scene(0);
    const planet = destination.children[0].children[0];
    planet.data.inhabited = true;
    planet.children.push(
      { type: 'facility', data: { type: 'colony_hq', zone: 'surface', preview_only: true } },
      { type: 'facility', data: { type: 'space_station', zone: 'orbital', preview_only: true } },
    );
    const tour = new RegistrationCometTour(flight, comet, destination, 45000);
    flight.registrationVoyage = tour;
    tour.update(0, true);
    const facilities = [...flight.spaceEntities.values()].filter((entity) => entity.id.startsWith('building:'));
    expect(facilities).toHaveLength(2);
    for (const entity of facilities) {
      const screen = entity.position.clone().sub(flight.origin).project(flight.camera);
      expect(Math.abs(screen.x)).toBeLessThan(0.8);
      expect(screen.y).toBeGreaterThan(-0.8);
      expect(screen.y).toBeLessThan(0);
    }
    flight.dispose();
  });

  it('crosses the shuttle path and transfers the camera without colliding or replacing the comet', () => {
    const flight = new PerspectiveSpaceFlight();
    const comet = addComet(flight, new Vector3(0, 0.000015, 0));
    const ship = createSpaceEntity({ id: 'onboarding-shuttle', space_entity: 'vessel', visual_scale_ly: 1e-10 },
      [new Vector3(), new Vector3()], flight.camera, 60);
    flight.spaceEntities.set(ship.id, ship);
    const voyage = new RegistrationVoyage(flight, ship, { origin: scene(0), destination: scene(300), duration_ms: 1000 });
    const before = comet.position.clone();
    voyage.update(0);
    expect(comet.position.equals(before)).toBe(true);
    voyage.update(0.1);
    const cameraBefore = flight.camera.position.clone();
    voyage.update(0.04);
    const gap = comet.position.distanceTo(ship.position);
    expect(gap).toBeGreaterThan(comet.scale + ship.scale);
    expect(gap).toBeLessThan(comet.scale * 3);
    expect(flight.camera.position.equals(cameraBefore)).toBe(false);
    expect(flight.spaceEntities.get('onboarding-comet')).toBe(comet);
    voyage.update(0.14);
    expect(flight.spaceEntities.has('onboarding-comet')).toBe(false);
    voyage.cancel();
    flight.dispose();
  });

  it('departs the actual homeland, loads the reserved destination, and lands only on a separate command', async () => {
    const flight = new PerspectiveSpaceFlight();
    const origin = scene(0);
    const destination = scene(300);
    flight.setSystem({ sceneGraph: origin });
    addComet(flight);
    const ship = createSpaceEntity({ id: 'onboarding-shuttle', space_entity: 'vessel', visual_scale_ly: 1e-10 },
      [new Vector3(), new Vector3()], flight.camera, 60);
    flight.spaceEntities.set(ship.id, ship);
    const journey = new RegistrationVoyage(flight, ship, { origin, destination, duration_ms: 1000 });
    journey.update(0);
    expect(ship.position.x).toBeLessThan(0.001);
    journey.update(0.5);
    expect(ship.position.x).toBeGreaterThan(100);
    expect(ship.position.x).toBeLessThan(200);
    journey.update(0, true);
    expect(await journey.finished).toBe(true);
    expect(flight.origin.x).toBe(300);
    const cameraDistance = flight.camera.position.distanceTo(ship.position.clone().sub(flight.origin));
    expect(cameraDistance).toBeGreaterThan(ship.scale * 4);
    expect(cameraDistance).toBeLessThan(ship.scale * 7);
    const orbitPosition = ship.position.clone();
    const landing = new RegistrationVoyage(flight, ship, {
      origin: destination, destination, duration_ms: 1000, landing: true,
    });
    const planet = flight.bodies.find((body) => body.userData.type === 'planet');
    const center = planet.getWorldPosition(new Vector3()).add(flight.origin);
    const colony = [...flight.spaceEntities.values()].find((body) => body.kind === 'colony');
    colony.position.copy(center).addScaledVector(landing.destination.normal, -planet.userData.radius * 1.02);
    landing.update(0);
    expect(ship.position.equals(orbitPosition)).toBe(true);
    for (let step = 0; step < 9; step++) {
      landing.update(0.1);
      expect(ship.position.distanceTo(center)).toBeGreaterThan(planet.userData.radius);
    }
    landing.update(0, true);
    expect(await landing.finished).toBe(true);
    expect(ship.position.distanceTo(center)).toBeGreaterThan(planet.userData.radius);
    expect(ship.position.distanceTo(center)).toBeLessThan(planet.userData.radius * 1.1);
    expect(ship.getForwardDirection().dot(landing.destination.normal)).toBeGreaterThan(0.99);
    const landed = ship.position.clone();
    ship.update(0.05);
    expect(ship.position.equals(landed)).toBe(true);
    flight.dispose();
  });

  it('pauses and cancels a voyage without later movement or a successful handoff', async () => {
    const flight = new PerspectiveSpaceFlight();
    const ship = createSpaceEntity({ id: 'shuttle', space_entity: 'vessel' },
      [new Vector3(), new Vector3()], flight.camera, 60);
    const voyage = new RegistrationVoyage(flight, ship, { origin: scene(0), destination: scene(300), duration_ms: 1000 });
    flight.spaceEntities.set(ship.id, ship);
    flight.registrationVoyage = voyage;
    flight.cameraShot = { kind: 'journey', paused: false };
    voyage.update(0.1);
    const before = ship.position.clone();
    flight.setCameraShotPaused(true);
    flight.update(0.05);
    expect(ship.position.equals(before)).toBe(true);
    expect(voyage.elapsed).toBe(0.1);
    flight.cancelCameraShot();
    flight.update(0.05);
    voyage.update(0, true);
    expect(await voyage.finished).toBe(false);
    expect(ship.position.equals(before)).toBe(true);
    flight.dispose();
  });

  it('honours Finish during model loading and reduced-motion landing', async () => {
    let release;
    const loading = new Promise((resolve) => { release = resolve; });
    const flight = new PerspectiveSpaceFlight({ vesselLoaderFactory: () => ({ loadAsync: () => loading }) });
    const origin = scene(0);
    const destination = scene(300);
    flight.setSystem({ sceneGraph: origin });
    addComet(flight);
    flight.cameraShot = { kind: 'journey', paused: false };
    const pending = flight.beginRegistrationVoyage({ origin, destination, duration_ms: 1000 });
    flight.finishCameraShot();
    release({ scene: new Mesh(new BoxGeometry(), new MeshBasicMaterial()) });
    expect(await pending).toBe(true);
    expect(flight.origin.x).toBe(300);
    flight.cameraShot = { kind: 'landing', paused: false };
    expect(await flight.beginRegistrationVoyage({
      origin: destination, destination, duration_ms: 1000, landing: true, reducedMotion: true,
    })).toBe(true);
    flight.dispose();
  });

  it('ignores a model that finishes loading after camera cancellation', async () => {
    let release;
    const loading = new Promise((resolve) => { release = resolve; });
    const flight = new PerspectiveSpaceFlight({ vesselLoaderFactory: () => ({ loadAsync: () => loading }) });
    const origin = scene(0);
    flight.setSystem({ sceneGraph: origin });
    addComet(flight);
    flight.cameraShot = { kind: 'journey', paused: false };
    const pending = flight.beginRegistrationVoyage({ origin, destination: scene(300), duration_ms: 1000 });
    flight.cancelCameraShot();
    release({ scene: new Mesh(new BoxGeometry(), new MeshBasicMaterial()) });
    expect(await pending).toBe(false);
    expect(flight.spaceEntities.has('onboarding-shuttle')).toBe(false);
    expect(flight.origin.x).toBe(0);
    flight.dispose();
  });
});
