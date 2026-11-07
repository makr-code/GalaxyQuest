import { Euler, Quaternion, Vector3 } from 'three';

function parseVector(value, fallback = [0, 0, 0]) {
  if (Array.isArray(value) && value.length === 3) return new Vector3(...value.map(Number));
  if (value && typeof value === 'object') {
    return new Vector3(Number(value.x_ly ?? value.x), Number(value.y_ly ?? value.y), Number(value.z_ly ?? value.z));
  }
  return new Vector3(...fallback);
}

function parseOrbit(descriptor) {
  const center = Array.isArray(descriptor?.orbit_center) ? descriptor.orbit_center.map(Number) : [];
  const radius = Number(descriptor?.orbit_radius_ly);
  if (center.length !== 3 || !center.every(Number.isFinite) || !Number.isFinite(radius) || radius <= 0) return null;
  return {
    center: new Vector3(...center),
    radius,
    startAngle: Number(descriptor.orbit_start_angle) || 0,
    angularSpeed: Math.max(0, Number(descriptor.orbit_angular_speed) || 0.1),
  };
}

export class SpaceEntity {
  constructor(descriptor, route, cameraPose, defaultDuration = 7, kind = 'artificial') {
    this.id = String(descriptor.id);
    this.kind = kind;
    this.modelUrl = resolveSpaceEntityModelUrl(descriptor, kind);
    this.registration = kind === 'vessel' && descriptor.registration_vessel === true;
    this.followCamera = descriptor.follow_camera === true || this.registration;
    this.route = route;
    this.position = route[0].clone();
    this.from = route[0].clone();
    this.to = route[1].clone();
    this.quaternion = new Quaternion();
    this.scale = Math.max(1e-15, Number(descriptor.visual_scale_ly) || 18);
    this.elapsed = 0;
    this.duration = Math.max(1, Number(descriptor.segment_duration_seconds) || defaultDuration);
    this.cameraTransitionElapsed = 0;
    this.cameraTransitionDuration = 1.6;
    this.cameraStartPosition = cameraPose.position.clone();
    this.cameraStartQuaternion = cameraPose.quaternion.clone();
    this.reducedMotion = descriptor.reduced_motion === true;
    this.orbit = null;
    this.orbitElapsed = 0;
    this.color = Array.isArray(descriptor.color) ? descriptor.color.slice(0, 4) : [0.53, 0.75, 0.82, 1];
    this.parentEntityId = String(descriptor.parent_entity_id || descriptor.parent_id || '');
    this.parentBodyAnchor = descriptor.anchor_body || descriptor.body_anchor || null;
    this.localPosition = parseVector(descriptor.local_position || descriptor.position);
    this.localQuaternion = Array.isArray(descriptor.local_rotation)
      ? new Quaternion().setFromEuler(new Euler(...descriptor.local_rotation))
      : new Quaternion();
    this.surfaceHeight = Math.max(0, Number(descriptor.surface_height_ly) || 0);
    this.surfaceLatitude = Number(descriptor.surface_latitude_deg) || 0;
    this.surfaceLongitude = Number(descriptor.surface_longitude_deg) || 0;
    this.setRoute(descriptor, route, { initial: true, defaultDuration });
  }

  setRoute(descriptor, points, { initial = false, defaultDuration = 7 } = {}) {
    this.displayName = String(descriptor.display_name || descriptor.name || descriptor.fleet_label
      || (this.kind === 'vessel' ? 'Raumschiff' : ''));
    this.combatStatus = descriptor.combat_status || null;
    this.reducedMotion = descriptor.reduced_motion === true;
    this.scale = Math.max(1e-15, Number(descriptor.visual_scale_ly) || this.scale);
    this.followCamera = descriptor.follow_camera === true || this.registration || this.followCamera;
    this.parentEntityId = String(descriptor.parent_entity_id || descriptor.parent_id || '');
    this.parentBodyAnchor = descriptor.anchor_body || descriptor.body_anchor || null;
    this.localPosition = parseVector(descriptor.local_position || descriptor.position);
    this.localQuaternion = Array.isArray(descriptor.local_rotation)
      ? new Quaternion().setFromEuler(new Euler(...descriptor.local_rotation))
      : new Quaternion();
    this.surfaceHeight = Math.max(0, Number(descriptor.surface_height_ly) || 0);
    this.surfaceLatitude = Number(descriptor.surface_latitude_deg) || 0;
    this.surfaceLongitude = Number(descriptor.surface_longitude_deg) || 0;
    if (Array.isArray(descriptor.color)) this.color = descriptor.color.slice(0, 4);
    if (descriptor.continue_from_current === true) {
      this.route = [this.position.clone(), points[points.length - 1].clone()];
      this.cameraTransitionElapsed = this.cameraTransitionDuration;
      this.orbitElapsed = 0;
      this.orbit = parseOrbit(descriptor);
    } else {
      this.route = points;
      if (initial) this.position.copy(points[0]);
    }
    const segment = Math.max(0, Math.min(this.route.length - 2,
      Math.trunc(Number(descriptor.chapter_index ?? descriptor.beat_index) || 0)));
    this.from = this.position.clone();
    this.to = this.route[segment + 1].clone();
    this.elapsed = 0;
    this.duration = Math.max(1, Number(descriptor.segment_duration_seconds) || defaultDuration);
    if (this.reducedMotion) {
      this.position.copy(this.to);
      this.from.copy(this.to);
    }
  }

  update(deltaSeconds) {
    const dt = Math.max(0, Math.min(0.05, Number(deltaSeconds) || 0));
    if (!dt || this.reducedMotion) return false;
    if (this.elapsed < this.duration) {
      this.elapsed = Math.min(this.duration, this.elapsed + dt);
      const progress = this.elapsed / this.duration;
      const eased = progress * progress * (3 - 2 * progress);
      this.position.lerpVectors(this.from, this.to, eased);
    } else if (this.orbit) {
      this.orbitElapsed += dt;
      const angle = this.orbit.startAngle + this.orbitElapsed * this.orbit.angularSpeed;
      this.position.set(
        this.orbit.center.x + Math.cos(angle) * this.orbit.radius,
        this.orbit.center.y + Math.sin(angle) * this.orbit.radius,
        this.orbit.center.z + Math.sin(angle * 0.5) * this.orbit.radius * 0.18,
      );
      const tangent = new Vector3(-Math.sin(angle), Math.cos(angle), Math.cos(angle * 0.5) * 0.09).normalize();
      this.from.copy(this.position);
      this.to.copy(this.position).addScaledVector(tangent, Math.max(this.scale, this.orbit.radius * 0.1));
    } else {
      return false;
    }
    this.cameraTransitionElapsed = Math.min(this.cameraTransitionDuration,
      this.cameraTransitionElapsed + dt);
    return true;
  }

  getForwardDirection() {
    const direction = this.to.clone().sub(this.from);
    if (direction.lengthSq() < 1e-12) direction.set(1, 0, 0);
    return direction.normalize();
  }
}

export class SpaceVessel extends SpaceEntity {
  constructor(descriptor, route, cameraPose, defaultDuration = 7) {
    super(descriptor, route, cameraPose, defaultDuration, 'vessel');
    this.engineEffects = descriptor.engine_effects !== false;
  }
}

export class SpaceStation extends SpaceEntity {
  constructor(descriptor, route, cameraPose, defaultDuration = 7) {
    super(descriptor, route, cameraPose, defaultDuration, 'station');
  }
}

export class ArtificialSpaceObject extends SpaceEntity {
  constructor(descriptor, route, cameraPose, defaultDuration = 7) {
    super(descriptor, route, cameraPose, defaultDuration, 'artificial');
  }
}

export class ColonyEntity extends SpaceEntity {
  constructor(descriptor, route, cameraPose, defaultDuration = 7) {
    super(descriptor, route, cameraPose, defaultDuration, 'colony');
  }
}

export class BuildingEntity extends SpaceEntity {
  constructor(descriptor, route, cameraPose, defaultDuration = 7) {
    super(descriptor, route, cameraPose, defaultDuration, 'building');
  }
}

export function normalizeSpaceEntityKind(descriptor) {
  if (descriptor.registration_vessel === true) return 'vessel';
  const requestedKind = String(descriptor.space_entity || descriptor.kind || descriptor.type || 'artificial')
    .toLowerCase();
  if (requestedKind === 'vessel' || requestedKind === 'ship') return 'vessel';
  if (requestedKind === 'station' || requestedKind === 'space_station') return 'station';
  if (requestedKind === 'colony' || requestedKind === 'settlement') return 'colony';
  if (requestedKind === 'building' || requestedKind === 'facility') return 'building';
  return 'artificial';
}

export function resolveSpaceEntityModelUrl(descriptor, kind = normalizeSpaceEntityKind(descriptor || {})) {
  const supplied = String(descriptor?.model_url || descriptor?.modelUrl || '').trim();
  if (supplied) return supplied;
  const defaults = {
    vessel: '/generated/trellis2/imported/ship/ship_generic_teaser_transfer_organic_lod0_dev.glb',
    station: '/models/space_station.json',
    colony: 'procedural:colony',
    building: 'procedural:building',
    artificial: 'procedural:artificial',
  };
  return defaults[kind] || defaults.artificial;
}

export function createSpaceEntity(descriptor, route, cameraPose, defaultDuration = 7) {
  const kind = normalizeSpaceEntityKind(descriptor);
  if (kind === 'vessel') {
    return new SpaceVessel(descriptor, route, cameraPose, defaultDuration);
  }
  if (kind === 'station') {
    return new SpaceStation(descriptor, route, cameraPose, defaultDuration);
  }
  if (kind === 'colony') return new ColonyEntity(descriptor, route, cameraPose, defaultDuration);
  if (kind === 'building') return new BuildingEntity(descriptor, route, cameraPose, defaultDuration);
  return new ArtificialSpaceObject(descriptor, route, cameraPose, defaultDuration);
}