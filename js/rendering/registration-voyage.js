import { Quaternion, Vector3 } from 'three';
import { SystemVisualizationLayer } from './system-visualization-layer.js';

const KM_LY = 1 / 9460730472580.8;
const ease = (value) => value * value * (3 - 2 * value);

export const COMET_WORLD_DURATION_MS = 45000;

export function registrationWorldPose(scene) {
  const system = scene?.children?.find((node) => node.type === 'system');
  const planets = system?.children?.filter((node) => node.type === 'planet').map((node) => node.data) || [];
  const planet = planets.find((body) => Number(body.position) === Number(scene.target?.position));
  if (!planet) throw new Error('Das bestätigte Flugziel fehlt im Szenengraph.');
  const layout = new SystemVisualizationLayer();
  layout.setSystem(system.data, planets);
  const orbit = layout.orbits.find((body) => body.position === Number(planet.position));
  const center = new Vector3(Number(system.data.x_ly), Number(system.data.y_ly), Number(system.data.z_ly))
    .add(new Vector3(...orbit.bodyPosition));
  const radius = Number(planet.diameter_km) * 0.5 * KM_LY;
  const normal = new Vector3(...orbit.bodyPosition).negate();
  if (!center.toArray().every(Number.isFinite) || !Number.isFinite(radius) || radius <= 0 || normal.lengthSq() === 0) {
    throw new Error('Die Flugwelt besitzt keine gültige Position oder Größe.');
  }
  return { center, radius, normal: normal.normalize() };
}

export class RegistrationCometTour {
  constructor(flight, comet, scene, duration_ms) {
    this.flight = flight;
    this.comet = comet;
    this.scene = scene;
    this.world = registrationWorldPose(scene);
    this.duration = duration_ms / 1000;
    this.elapsed = 0;
    this.start = comet.position.clone();
    this.startScale = comet.scale;
    this.loaded = false;
    this.arrived = false;
    this.flybyTime = 0;
    this.tangent = this.world.normal.clone().cross(new Vector3(0, 0, 1)).normalize();
    this.up = this.world.normal.clone().cross(this.tangent).normalize();
    this.cameraStartUp = flight.camera.up.clone();
    this.finished = new Promise((resolve) => { this.resolve = resolve; });
    comet.elapsed = comet.duration;
    this.cameraStartOffset = flight.camera.position.clone().sub(comet.position.clone().sub(flight.origin));
    this.cameraStartQuaternion = flight.camera.quaternion.clone();
    this.cameraTransitionElapsed = 0;
    comet.cameraTransitionElapsed = comet.cameraTransitionDuration + 1;
  }

  update(dt, finish = false) {
    if (this.arrived) {
      this.flybyTime += dt;
      this.showFlyby(1 + this.flybyTime / this.duration);
      return;
    }
    this.elapsed = finish ? this.duration : Math.min(this.duration, this.elapsed + dt);
    const progress = this.elapsed / this.duration;
    const { flight, comet, world } = this;
    const endpoint = this.flybyPose(0).comet;
    comet.position.lerpVectors(this.start, endpoint, ease(Math.min(progress / 0.8, 1)));
    const scale = world.radius * 0.045;
    comet.scale = Math.exp(Math.log(this.startScale) * (1 - ease(progress)) + Math.log(scale) * ease(progress));
    if (progress >= 0.8 && !this.loaded) {
      if (!flight.setSystem({ sceneGraph: this.scene, flightTour: true })) {
        throw new Error('Die Heimatwelt konnte nicht geladen werden.');
      }
      this.loaded = true;
    }
    const direction = endpoint.clone().sub(this.start).normalize();
    if (progress >= 0.8 || direction.lengthSq() === 0) direction.copy(this.tangent);
    comet.from.copy(comet.position);
    comet.to.copy(comet.position).addScaledVector(direction, comet.scale * 10);
    this.cameraTransitionElapsed = finish ? comet.cameraTransitionDuration
      : Math.min(comet.cameraTransitionDuration, this.cameraTransitionElapsed + dt);
    flight._followVessel(comet, 1);
    if (this.cameraTransitionElapsed < comet.cameraTransitionDuration) {
      const localComet = comet.position.clone().sub(flight.origin);
      const offset = flight.camera.position.clone().sub(localComet);
      const targetQuaternion = flight.camera.quaternion.clone();
      const blend = ease(this.cameraTransitionElapsed / comet.cameraTransitionDuration);
      flight.camera.position.copy(localComet).add(this.cameraStartOffset.clone().lerp(offset, blend));
      flight.camera.quaternion.copy(this.cameraStartQuaternion).slerp(targetQuaternion, blend);
      flight.camera.updateMatrixWorld(true);
    }
    if (progress >= 0.8) this.showFlyby((progress - 0.8) / 0.2, ease((progress - 0.8) / 0.2));
    if (progress === 1) {
      this.arrived = true;
      this.resolve(true);
    }
  }

  flybyPose(progress) {
    const { world, tangent, up } = this;
    const side = (-0.5 + Math.min(progress, 2) * 0.5) * world.radius;
    const camera = world.center.clone().addScaledVector(world.normal, world.radius * 2.15)
      .addScaledVector(tangent, side);
    const focus = world.center.clone().addScaledVector(up, world.radius * 1.65)
      .addScaledVector(tangent, side);
    const direction = focus.clone().sub(camera).normalize();
    return { camera, focus, comet: camera.clone().addScaledVector(direction, world.radius * 0.45) };
  }

  showFlyby(progress, blend = 1) {
    const { flight, comet, world, tangent } = this;
    const pose = this.flybyPose(progress);
    comet.position.lerp(pose.comet, blend);
    comet.from.copy(comet.position);
    comet.to.copy(comet.position).addScaledVector(tangent, world.radius);
    comet.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
    flight.camera.position.lerp(pose.camera.clone().sub(flight.origin), blend);
    flight.camera.up.copy(this.cameraStartUp).lerp(this.up, blend).normalize();
    const previousQuaternion = flight.camera.quaternion.clone();
    flight.camera.lookAt(pose.focus.clone().sub(flight.origin));
    const targetQuaternion = flight.camera.quaternion.clone();
    flight.camera.quaternion.copy(previousQuaternion).slerp(targetQuaternion, blend);
    flight.camera.updateMatrixWorld(true);
  }

  cancel() {
    this.flight.camera.up.copy(this.cameraStartUp);
    if (!this.arrived) { this.arrived = true; this.resolve(false); }
  }
}

export class RegistrationVoyage {
  constructor(flight, entity, { origin, destination, duration_ms, landing = false }) {
    this.flight = flight;
    this.entity = entity;
    this.origin = registrationWorldPose(origin);
    this.destination = registrationWorldPose(destination);
    this.destinationScene = destination;
    this.duration = duration_ms / 1000;
    this.landing = landing;
    this.elapsed = 0;
    this.arrived = false;
    this.loadedDestination = false;
    this.start = entity.position.clone();
    this.comet = landing ? null : flight.spaceEntities.get('onboarding-comet');
    this.cometStart = this.comet?.position.clone();
    this.cometStartScale = this.comet?.scale;
    if (this.comet) this.comet.elapsed = this.comet.duration;
    entity.elapsed = entity.duration;
    entity.cameraStartPosition.copy(flight.camera.position);
    entity.cameraStartQuaternion.copy(flight.camera.quaternion);
    entity.cameraTransitionElapsed = 0;
    this.finished = new Promise((resolve) => { this.resolve = resolve; });
  }

  update(dt, finish = false) {
    if (this.arrived) return;
    this.elapsed = finish ? this.duration : Math.min(this.duration, this.elapsed + dt);
    this.entity.cameraTransitionElapsed = finish ? this.entity.cameraTransitionDuration
      : Math.min(this.entity.cameraTransitionDuration, this.entity.cameraTransitionElapsed + dt);
    const progress = this.elapsed / this.duration;
    const { entity, flight, destination, origin } = this;
    let landingNormal;
    if (this.landing) {
      const colony = [...flight.spaceEntities.values()].find((body) => body.kind === 'colony'
        && Number(body.parentBodyAnchor?.position) === Number(this.destinationScene.target.position));
      if (!colony) throw new Error('Der private Landeplatz ist nicht verfügbar.');
      landingNormal = colony.position.clone().sub(destination.center).normalize();
      const end = colony.position.clone().addScaledVector(landingNormal, destination.radius * 0.045);
      const radial = this.start.clone().sub(destination.center);
      if (progress < 0.4) {
        const turn = new Quaternion().setFromUnitVectors(radial.clone().normalize(), landingNormal);
        radial.applyQuaternion(new Quaternion().slerp(turn, ease(progress / 0.4)));
        entity.position.copy(destination.center).add(radial);
      } else {
        const approach = destination.center.clone().addScaledVector(landingNormal, radial.length());
        entity.position.lerpVectors(approach, end, ease((progress - 0.4) / 0.6));
      }
      entity.scale = destination.radius * 0.035;
    } else if (progress < 0.28) {
      entity.position.copy(origin.center).addScaledVector(origin.normal,
        origin.radius * (1.15 + 10 * ease(progress / 0.28)));
      entity.scale = origin.radius * 0.035;
    } else if (progress < 0.82) {
      const cruise = (progress - 0.28) / 0.54;
      const from = origin.center.clone().addScaledVector(origin.normal, origin.radius * 11.15);
      const to = destination.center.clone().addScaledVector(destination.normal, destination.radius * 11.15);
      entity.position.lerpVectors(from, to, ease(cruise));
      entity.scale = Math.max(origin.radius, destination.radius) * 0.035
        + from.distanceTo(to) * 0.0003 * Math.sin(Math.PI * cruise) ** 2;
    } else {
      if (!this.loadedDestination) {
        if (!flight.setSystem({ sceneGraph: this.destinationScene, flightTour: true })) {
          throw new Error('Das private Zielsystem konnte nicht geladen werden.');
        }
        this.loadedDestination = true;
      }
      entity.position.copy(destination.center).addScaledVector(destination.normal,
        destination.radius * (11.15 - 8 * ease((progress - 0.82) / 0.18)));
      entity.scale = destination.radius * 0.035;
    }
    const direction = this.landing ? landingNormal.clone().negate()
      : destination.center.clone().sub(origin.center).normalize();
    if (direction.lengthSq() === 0) direction.copy(destination.normal);
    entity.from.copy(entity.position);
    entity.to.copy(entity.position).addScaledVector(direction, entity.scale * 10);
    if (this.comet && progress < 0.28) {
      const tangent = origin.normal.clone().cross(new Vector3(0, 0, 1)).normalize();
      const separation = origin.normal.clone().cross(tangent).normalize();
      this.comet.scale = this.cometStartScale
        + (origin.radius * 0.15 - this.cometStartScale) * ease(Math.min(progress / 0.14, 1));
      const crossing = origin.center.clone().addScaledVector(origin.normal,
        origin.radius * (1.15 + 10 * ease(0.14 / 0.28)))
        .addScaledVector(separation, origin.radius * 0.25);
      if (progress < 0.14) this.comet.position.lerpVectors(this.cometStart, crossing, ease(progress / 0.14));
      else this.comet.position.copy(crossing).addScaledVector(tangent, -origin.radius * (progress - 0.14) * 15);
      this.comet.from.copy(this.comet.position);
      this.comet.to.copy(this.comet.position).addScaledVector(tangent, -origin.radius);
      this.comet.cameraTransitionElapsed = this.comet.cameraTransitionDuration;
      flight._followVessel(this.comet, 1);
      const cameraPosition = flight.camera.position.clone();
      flight._followVessel(entity, 1);
      const transfer = ease(Math.max(0, Math.min(1, (progress - 0.10) / 0.08)));
      flight.camera.position.lerpVectors(cameraPosition, flight.camera.position.clone(), transfer);
      const focus = this.comet.position.clone().lerp(entity.position, transfer).sub(flight.origin);
      flight.camera.lookAt(focus);
      flight.camera.updateMatrixWorld(true);
    } else {
      if (this.comet) {
        flight._removeSpaceEntity(this.comet);
        this.comet = null;
      }
      flight._followVessel(entity, 1);
    }
    if (progress === 1) {
      this.arrived = true;
      this.resolve(true);
    }
  }

  cancel() {
    this.arrived = true;
    this.resolve(false);
  }
}
