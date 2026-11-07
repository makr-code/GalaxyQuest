import { Group, Matrix4, Object3D, PerspectiveCamera, Quaternion, Ray, Sphere, Vector3 } from 'three';
import '../engine/post-effects/passes/LensFlarePass.js';
import { SpatialLabelRenderer } from './spatial-label-renderer.js';
import { createSpaceEntity, normalizeSpaceEntityKind, resolveSpaceEntityModelUrl } from './space-entity.js';
import { SpaceVessel } from './space-vessel.js';
import { SpaceVesselRenderPass } from './space-vessel-render-pass.js';
import { SpaceWeaponRenderPass } from './space-weapon-render-pass.js';
import { createSpatialStarIndex, resolveSpatialLabels } from './spatial-label-layout.js';
import { AU_LY, SystemVisualizationLayer } from './system-visualization-layer.js';

export { AU_LY } from './system-visualization-layer.js';
export const KM_LY = 1 / 9460730472580.8;
const THREE_DEG_TO_RAD = Math.PI / 180;
const ASTEROID_BELT_MAX_COUNT = 2;
const ASTEROID_BELT_PARTICLE_BUDGET = 512;

const SPECTRAL_COLORS = {
  O: [0.68, 0.81, 1], B: [0.75, 0.88, 1], A: [0.9, 0.93, 1], F: [1, 1, 0.95],
  G: [1, 0.96, 0.82], K: [1, 0.85, 0.55], M: [1, 0.6, 0.4],
};
const LOCAL_ARTIFICIAL_MODELS = new Set([
  'deep_space_radar', 'jump_inhibitor', 'relay_station', 'space_station', 'stargate',
]);

function stableSurfaceSeed(star, type, body) {
  const manifestSeed = Number(body?.texture?.seed);
  if (Number.isFinite(manifestSeed)) return Math.abs(Math.trunc(manifestSeed)) % 10000;
  const key = `${star?.galaxy_index || 0}:${star?.system_index || 0}:${type}:${body?.position ?? body?.moon_index ?? 0}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 10000;
}

function surfaceProfile(type, body) {
  if (type === 'moon') return 4;
  const kind = String(body?.texture?.variant || body?.planet_class || body?.class || '').toLowerCase();
  if (kind.includes('gas')) return 1;
  if (kind.includes('ocean')) return 2;
  if (kind.includes('lava')) return 3;
  if (kind.includes('ice')) return 4;
  return 0;
}

function surfaceColor(body, fallback) {
  const value = String(body?.texture?.palette?.base || '').trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  if (!match) return fallback;
  const hex = Number.parseInt(match[1], 16);
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function layerStrength(body, key, fallback) {
  const value = Number(body?.texture?.[key]);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function seededUnit(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createAsteroidBeltParticles(data, count) {
  const random = seededUnit(data.seed);
  const innerRadius = Number(data.inner_radius_au);
  const outerRadius = Number(data.outer_radius_au);
  const inclination = THREE_DEG_TO_RAD * Math.max(-15, Math.min(15, Number(data.inclination_deg) || 0));
  const node = THREE_DEG_TO_RAD * (Number(data.ascending_node_deg) || 0);
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const innerSquared = innerRadius ** 2;
  const radialSpan = outerRadius ** 2 - innerSquared;
  const particles = [];

  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(innerSquared + random() * radialSpan);
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const position = new Vector3(
      x * cosNode - y * cosInclination * sinNode,
      x * sinNode + y * cosInclination * cosNode,
      y * sinInclination,
    ).multiplyScalar(AU_LY);
    particles.push({
      position,
      radius: Math.max(1e-15, radius * AU_LY * (0.0005 + random() * 0.001)),
      seed: random() * 10000,
      opacity: 0.32 + random() * 0.4,
    });
  }
  return particles;
}

function cameraFrameDistance(camera, radius, screenFraction) {
  const focal = 1 / Math.tan(camera.fov * THREE_DEG_TO_RAD * 0.5);
  return radius * Math.sqrt(1 + (focal / screenFraction) ** 2);
}

function collisionFreeWaypoints(start, destination, obstacles) {
  const waypoints = [destination.clone()];
  const maximumDetours = obstacles.length * 2;
  for (let detour = 0; detour < maximumDetours; detour += 1) {
    let collision = null;
    for (let segmentIndex = 0; segmentIndex < waypoints.length; segmentIndex += 1) {
      const segmentStart = segmentIndex === 0 ? start : waypoints[segmentIndex - 1];
      const segmentEnd = waypoints[segmentIndex];
      const direction = segmentEnd.clone().sub(segmentStart);
      const lengthSquared = direction.lengthSq();
      if (lengthSquared < 1e-30) continue;
      for (const obstacle of obstacles) {
        const projection = obstacle.center.clone().sub(segmentStart).dot(direction) / lengthSquared;
        if (projection <= 0.015 || projection >= 0.985) continue;
        const closest = segmentStart.clone().addScaledVector(direction, projection);
        const clearance = obstacle.radius * 1.08;
        if (closest.distanceToSquared(obstacle.center) >= clearance * clearance) continue;
        const order = segmentIndex + projection;
        if (!collision || order < collision.order) {
          collision = { segmentIndex, projection, order, obstacle, closest, direction };
        }
      }
    }
    if (!collision) break;

    const { obstacle, closest, direction } = collision;
    direction.normalize();
    const lateral = closest.sub(obstacle.center);
    if (lateral.lengthSq() < 1e-24) {
      lateral.crossVectors(direction, new Vector3(0, 0, 1));
      if (lateral.lengthSq() < 1e-24) lateral.crossVectors(direction, new Vector3(0, 1, 0));
    }
    lateral.normalize();
    const bypassDistance = obstacle.radius * 1.5;
    const sideDistance = obstacle.radius * 1.45;
    const before = obstacle.center.clone()
      .addScaledVector(direction, -bypassDistance).addScaledVector(lateral, sideDistance);
    const after = obstacle.center.clone()
      .addScaledVector(direction, bypassDistance).addScaledVector(lateral, sideDistance);
    waypoints.splice(collision.segmentIndex, 0, before, after);
  }
  return waypoints;
}

const SPACE_SHADER = `
struct CameraBasis { right: vec4<f32>, up: vec4<f32>, backward: vec4<f32>, effects: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: CameraBasis;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) material: vec4<f32>,
  @location(3) light: vec4<f32>,
  @location(4) motion: vec4<f32>,
};
@vertex fn vs_main(@builtin(vertex_index) vertex: u32,
  @location(0) center: vec4<f32>, @location(1) color: vec4<f32>,
  @location(2) material: vec4<f32>, @location(3) motion: vec4<f32>,
  @location(4) light: vec4<f32>) -> Output {
  let corners = array<vec2<f32>, 4>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
  let uv = corners[vertex];
  let trail = motion.xy * max(0.0, -uv.y);
  var output: Output;
  output.position = vec4(center.xy + uv * center.zw - trail, 0.0, 1.0);
  output.uv = uv;
  output.color = color;
  output.material = material;
  output.light = light;
  output.motion = motion;
  return output;
}
fn solarHash(point: vec3<f32>) -> f32 {
  var sample = fract(point * vec3(0.1031, 0.1030, 0.0973));
  sample += dot(sample, sample.yxz + 33.33);
  return fract((sample.x + sample.y) * sample.z);
}
fn solarNoise(point: vec3<f32>) -> f32 {
  let cell = floor(point);
  let fraction = fract(point);
  let weight = fraction * fraction * (3.0 - 2.0 * fraction);
  return mix(
    mix(mix(solarHash(cell), solarHash(cell + vec3(1.0, 0.0, 0.0)), weight.x),
        mix(solarHash(cell + vec3(0.0, 1.0, 0.0)), solarHash(cell + vec3(1.0, 1.0, 0.0)), weight.x), weight.y),
    mix(mix(solarHash(cell + vec3(0.0, 0.0, 1.0)), solarHash(cell + vec3(1.0, 0.0, 1.0)), weight.x),
        mix(solarHash(cell + vec3(0.0, 1.0, 1.0)), solarHash(cell + vec3(1.0, 1.0, 1.0)), weight.x), weight.y), weight.z);
}
fn surfaceFbm(point: vec3<f32>) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var samplePoint = point;
  for (var octave = 0; octave < 4; octave++) {
    value += solarNoise(samplePoint) * amplitude;
    samplePoint *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}
@fragment fn fs_main(input: Output) -> @location(0) vec4<f32> {
  let kind = input.material.x;
  if (kind > 7.5 && kind < 8.5) {
    let planeNormal = normalize(input.light.xyz);
    var majorAxis = vec2(-planeNormal.y, planeNormal.x);
    if (dot(majorAxis, majorAxis) < 0.0001) { majorAxis = vec2(1.0, 0.0); }
    majorAxis = normalize(majorAxis);
    let minorAxis = vec2(-majorAxis.y, majorAxis.x);
    let projectedThickness = max(abs(planeNormal.z), 0.025);
    let planePoint = vec2(dot(input.uv, majorAxis),
      dot(input.uv, minorAxis) / projectedThickness);
    let ringRadius = length(planePoint);
    if (ringRadius > 1.0 || ringRadius < input.material.y || length(input.uv) < input.material.z) {
      discard;
    }
    let grooves = 0.64 + 0.36 * (0.5 + 0.5 * sin(ringRadius * 190.0 + input.material.w * 31.0));
    let ringAlpha = clamp(input.motion.z, 0.08, 0.95) * grooves * input.color.a;
    return vec4(input.color.rgb * (0.62 + 0.38 * abs(planeNormal.z)), ringAlpha);
  }
  let radius = length(input.uv);
  if (radius > 1.0) { discard; }
  if (kind > 3.5 && kind < 4.5) {
    let limb = radius * 2.6;
    let direction = normalize(camera.right.xyz * input.uv.x + camera.up.xyz * input.uv.y + camera.backward.xyz * 0.001);
    let plasma = 0.5 + 0.5 * sin(dot(direction, vec3(20.0, 16.0, 12.0))
      + solarNoise(direction * 7.0) * 3.0 + camera.effects.x * 1.15);
    let halo = exp(-max(0.0, limb - 1.0) * 3.8);
    let edge = 1.0 - smoothstep(0.82, 1.0, radius);
    let alpha = halo * edge * (0.18 + plasma * 0.3) * input.color.a;
    return vec4(input.color.rgb * (0.55 + plasma * 0.7), alpha);
  }
  if (kind > 4.5 && kind < 5.5) {
    let rimStart = 0.79;
    let outerFade = 1.0 - smoothstep(0.96, 1.0, radius);
    let rim = smoothstep(rimStart, 0.94, radius) * outerFade;
    let shellNormal = vec3(input.uv, sqrt(max(0.0, 1.0 - radius * radius)));
    let lightFacing = max(dot(shellNormal, normalize(input.light.xyz)), 0.0);
    let atmosphere = clamp(input.motion.z, 0.0, 1.0);
    let alpha = rim * atmosphere * (0.12 + lightFacing * 0.48) * input.color.a;
    return vec4(input.color.rgb * (0.42 + lightFacing * 0.85), alpha);
  }
  if (kind > 5.5 && kind < 6.5) {
    let ring = 1.0 - smoothstep(0.045, 0.105, abs(radius - 0.86));
    let pulse = 0.86 + 0.14 * sin(camera.effects.x * 2.4);
    return vec4(input.color.rgb, ring * pulse * input.color.a);
  }
  if (kind > 6.5 && kind < 7.5) {
    let ring = 1.0 - smoothstep(0.04, 0.09, abs(radius - 0.86));
    let dash = step(0.34, fract((input.uv.x + input.uv.y * 1.7) * 18.0));
    return vec4(input.color.rgb, ring * dash * input.color.a);
  }
  if (kind > 8.5 && kind < 9.5) {
    if (radius > 1.0) { discard; }
    let grain = 0.72 + fract(sin(input.material.y * 12.9898) * 43758.5453) * 0.28;
    let edge = 1.0 - smoothstep(0.48, 1.0, radius);
    return vec4(input.color.rgb * grain, edge * input.color.a);
  }
  if (kind < 0.5) {
    let glow = exp(-radius * radius * 4.5);
    return vec4(input.color.rgb, glow * input.color.a);
  }
  let normal = vec3(input.uv, sqrt(max(0.0, 1.0 - radius * radius)));
  let worldNormal = normalize(camera.right.xyz * normal.x + camera.up.xyz * normal.y + camera.backward.xyz * normal.z);
  if (kind < 1.5) {
    let drift = vec3(camera.effects.x * 0.04, 0.0, 0.0);
    let plasma = solarNoise(worldNormal * 8.0 + drift);
    let granulation = solarNoise(worldNormal * 90.0 + drift * 3.0);
    let limbDarkening = 0.65 + 0.35 * normal.z;
    return vec4(input.color.rgb * limbDarkening * (1.15 + plasma * 0.15 + granulation * 0.15),
      smoothstep(0.0, 0.025, 1.0 - radius) * input.color.a);
  }
  let light = max(0.035, dot(normal, normalize(input.light.xyz)));
  let longitude = atan2(worldNormal.x, worldNormal.y);
  let latitude = asin(worldNormal.z);
  let seed = input.material.y;
  let seedOffset = vec3(seed * 0.013, seed * 0.037, seed * 0.071);
  let macroLayer = surfaceFbm(worldNormal * 3.2 + seedOffset);
  let regionLayer = surfaceFbm(worldNormal * 13.0 + seedOffset * 2.1);
  let detailLayer = surfaceFbm(worldNormal * 57.0 + seedOffset * 4.3);
  let profile = input.material.z;
  var surface = input.color.rgb * (0.58 + macroLayer * 0.28 + regionLayer * 0.22 + detailLayer * 0.08);
  if (profile < 0.5) {
    let landMask = smoothstep(0.43, 0.53, macroLayer * 0.72 + regionLayer * 0.28);
    let ocean = vec3(0.012, 0.055, 0.105) * (0.7 + detailLayer * 0.35);
    let land = input.color.rgb * (0.58 + regionLayer * 0.48 + detailLayer * 0.1);
    surface = mix(ocean, land, landMask);
  } else if (profile < 1.5) {
    let bands = 0.5 + 0.5 * sin(latitude * 22.0 + (macroLayer - 0.5) * 7.0 + seed);
    surface *= 0.58 + bands * 0.72;
  } else if (profile < 2.5) {
    let oceanDepth = 0.5 + macroLayer * 0.38 + regionLayer * 0.12;
    surface *= 0.28 + oceanDepth * 0.74;
  } else if (profile < 3.5) {
    let fissures = smoothstep(0.68, 0.88, detailLayer);
    surface = mix(surface * 0.5, vec3(1.0, 0.22, 0.035), fissures * 0.9);
  } else {
    let frost = smoothstep(0.55, 0.8, macroLayer + abs(worldNormal.z) * 0.18);
    surface = mix(surface * 0.72, vec3(0.72, 0.84, 0.96), frost * 0.8);
  }

  let cloudiness = clamp(input.motion.w, 0.0, 1.0);
  let cloudDrift = vec3(camera.effects.x * 0.012, camera.effects.x * -0.006, 0.0);
  let cloudField = surfaceFbm(worldNormal * 8.5 + seedOffset * 2.7 + cloudDrift);
  let cloudCoverage = smoothstep(0.72 - cloudiness * 0.28, 0.9, cloudField) * cloudiness;
  surface = mix(surface, vec3(0.72, 0.82, 0.91), cloudCoverage * 0.72);

  let dayFacing = dot(normal, normalize(input.light.xyz));
  let daylight = smoothstep(-0.16, 0.2, dayFacing);
  let directLight = max(dayFacing, 0.0);
  let illumination = 0.035 + daylight * 0.12 + directLight * 0.88;
  let cityCluster = smoothstep(0.54, 0.72, surfaceFbm(worldNormal * 9.0 + seedOffset * 3.0));
  let cityGrid = smoothstep(0.72, 0.9, surfaceFbm(worldNormal * 92.0 + seedOffset * 5.0));
  let cityEmission = select(0.0, cityCluster * cityGrid, input.material.w > 0.5)
    * (1.0 - smoothstep(-0.18, 0.16, dayFacing));
  let rim = pow(1.0 - normal.z, 3.0) * select(0.12, 0.25, kind < 2.5);
  let nightLights = vec3(1.0, 0.47, 0.16) * cityEmission * 2.2;
  return vec4(surface * illumination + nightLights + vec3(0.16, 0.42, 0.65) * rim,
    smoothstep(0.0, 0.025, 1.0 - radius) * input.color.a);
}`;

export class PerspectiveSpaceFlight {
  constructor({ radius = 50000, aspect = 1, lensFlare = null, bloom = null,
    labelRenderer = new SpatialLabelRenderer(), vesselLoaderFactory, canvas = null } = {}) {
    this.camera = new PerspectiveCamera(58, aspect, 1e-14, radius * 20);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(radius * 0.35, -radius * 1.1, radius * 0.75);
    this.camera.lookAt(0, 0, 0);
    this.origin = new Vector3();
    this.root = new Group();
    this.bodies = [];
    this.asteroidBelts = [];
    this.systemVisualizations = new SystemVisualizationLayer();
    this.velocity = new Vector3();
    this.acceleration = new Vector3();
    this.turnSpeed = 0;
    this.effectTime = 0;
    this.lensFlare = lensFlare;
    this.bloom = bloom;
    this.labelRenderer = labelRenderer;
    if (canvas) this.labelRenderer?.attachCanvas(canvas);
    this.vesselRenderPass = new SpaceVesselRenderPass({ loaderFactory: vesselLoaderFactory });
    this.weaponRenderPass = new SpaceWeaponRenderPass();
    this.device = null;
    this.spaceEntities = new Map();
    this.spaceVessels = this.spaceEntities;
    this.systemManagedEntityIds = new Set();
    this.cameraFollowEntity = null;
    this.vesselCameraPose = null;
    this.vesselDurationSeconds = 7;
    this.galaxyLabelIndex = createSpatialStarIndex([]);
    this.currentLabels = [];
    this.labelDiagnostics = { sourceStars: 0, queriedStars: 0, visibleCandidates: 0 };
    this.labelIndexBuildMs = 0;
    this.renderProfileSamples = [];
    this.lastRenderStart = 0;
    this.flight = null;
    this.telemetry = { phase: 'idle', speed: 0, speedNorm: 0, angularSpeed: 0, arrived: true };
  }

  setGalaxyFleets(fleets = []) {
    const vessels = (Array.isArray(fleets) ? fleets : []).filter((fleet) =>
      fleet?.registration_vessel === true || fleet?.space_entity === 'vessel' || fleet?.kind === 'vessel');
    if (!vessels.length) {
      for (const [id, entity] of this.spaceEntities) {
        if (!this.systemManagedEntityIds.has(id)) this._removeSpaceEntity(entity);
      }
      return true;
    }
    return this.setSpaceEntities(vessels, { preserveSystem: true });
  }

  setSpaceVessels(vessels = []) {
    return this.setSpaceEntities(vessels);
  }

  setSpaceEntities(entities = [], { preserveSystem = false } = {}) {
    const descriptors = (Array.isArray(entities) ? entities : []).filter((entity) => {
      return entity?.id;
    });
    const desiredIds = new Set(descriptors.map((entity) => String(entity.id)));
    for (const [id, entity] of this.spaceEntities) {
      if (!desiredIds.has(id) && !(preserveSystem && this.systemManagedEntityIds.has(id))) this._removeSpaceEntity(entity);
    }
    const primary = descriptors.find((entity) => entity.follow_camera || entity.registration_vessel) || null;
    this.cameraFollowEntity = primary ? this.spaceEntities.get(String(primary.id)) || null : null;
    return Promise.all(descriptors.map((entity) => this.registerSpaceEntity(entity)))
      .then((results) => results.every(Boolean));
  }

  async registerSpaceEntity(descriptor) {
    const kind = normalizeSpaceEntityKind(descriptor || {});
    const modelUrl = resolveSpaceEntityModelUrl(descriptor, kind);
    const id = String(descriptor?.id || '');
    let entity = this.spaceEntities.get(id);
    const sameAsset = entity?.modelUrl === modelUrl && entity.kind === kind;
    const route = Array.isArray(descriptor?.route) ? descriptor.route
      : descriptor?.position || descriptor?.local_position || descriptor?.anchor_body || descriptor?.body_anchor
        || descriptor?.parent_entity_id || descriptor?.parent_id
        ? [descriptor.position || descriptor.local_position || [0, 0, 0]] : [];
    const points = route.map((point) => new Vector3(
      Number(point?.x_ly ?? point?.x ?? point?.[0]),
      Number(point?.y_ly ?? point?.y ?? point?.[1]),
      Number(point?.z_ly ?? point?.z ?? point?.[2]),
    ));
    if (points.length === 1 && normalizeSpaceEntityKind(descriptor) !== 'vessel') {
      points.push(points[0].clone());
    }
    const minimumRoutePoints = sameAsset && descriptor?.continue_from_current === true ? 1 : 2;
    if (!id || !modelUrl || points.length < minimumRoutePoints
      || points.some((point) => !point.toArray().every(Number.isFinite))) return false;

    if (entity && !sameAsset) this._removeSpaceEntity(entity);
    entity = this.spaceEntities.get(id);
    if (!entity) {
      const followsCamera = descriptor.follow_camera === true || descriptor.registration_vessel === true;
      if (followsCamera && !this.cameraFollowEntity) {
        this.vesselCameraPose = {
          position: this.camera.position.clone(),
          quaternion: this.camera.quaternion.clone(),
        };
      }
      entity = createSpaceEntity(descriptor, points, this.camera, this.vesselDurationSeconds);
      this.spaceEntities.set(id, entity);
      if (entity.followCamera) this.cameraFollowEntity = entity;
    } else {
      entity.setRoute(descriptor, points, { defaultDuration: this.vesselDurationSeconds });
    }
    if (entity === this.cameraFollowEntity) this._followVessel(entity, entity.reducedMotion ? 1 : 0);

    if (!this.vesselRenderPass.resources.has(entity.id) && !entity.assetLoadPromise) {
      const currentEntity = entity;
      currentEntity.assetLoadPromise = this.vesselRenderPass.load(currentEntity).catch((error) => {
        if (this.spaceEntities.get(id) === currentEntity) this._removeSpaceEntity(currentEntity);
        throw error;
      }).finally(() => {
        currentEntity.assetLoadPromise = null;
      });
    }
    if (entity.assetLoadPromise) await entity.assetLoadPromise;
    return this.spaceEntities.get(id) === entity && this.vesselRenderPass.resources.has(id);
  }

  async registerSpaceVessel(fleet) {
    return this.registerSpaceEntity({ ...fleet, space_entity: 'vessel' });
  }

  registerVessel(fleet) {
    return this.registerSpaceVessel(fleet);
  }

  _removeSpaceEntity(entity) {
    this.vesselRenderPass.remove(entity.id);
    this.spaceEntities.delete(entity.id);
    this.systemManagedEntityIds.delete(entity.id);
    if (this.cameraFollowEntity === entity) {
      this.cameraFollowEntity = [...this.spaceEntities.values()]
        .find((candidate) => candidate.followCamera) || null;
    }
    if (this.spaceEntities.size === 0 && this.vesselCameraPose) {
      this.camera.position.copy(this.vesselCameraPose.position);
      this.camera.quaternion.copy(this.vesselCameraPose.quaternion);
      this.camera.updateMatrixWorld(true);
      this.vesselCameraPose = null;
    }
  }

  clearSpaceEntities() {
    for (const entity of this.spaceEntities.values()) this.vesselRenderPass.remove(entity.id);
    this.spaceEntities.clear();
    this.systemManagedEntityIds.clear();
    this.cameraFollowEntity = null;
    if (this.vesselCameraPose) {
      this.camera.position.copy(this.vesselCameraPose.position);
      this.camera.quaternion.copy(this.vesselCameraPose.quaternion);
      this.camera.updateMatrixWorld(true);
      this.vesselCameraPose = null;
    }
  }

  clearSpaceVessels() {
    this.clearSpaceEntities();
  }

  clearRegistrationVessel() {
    this.clearSpaceEntities();
  }

  get cameraFollowVessel() {
    return this.cameraFollowEntity?.kind === 'vessel' ? this.cameraFollowEntity : null;
  }

  get registrationVessel() {
    return this.cameraFollowEntity?.kind === 'vessel' ? this.cameraFollowEntity : null;
  }

  _followVessel(vessel, alpha) {
    if (!vessel) return;
    const direction = vessel.getForwardDirection();
    vessel.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), direction);
    const localPosition = vessel.position.clone().sub(this.origin);
    const lookAt = localPosition.clone().addScaledVector(direction, vessel.scale * 0.55);
    const cameraTarget = localPosition.clone()
      .addScaledVector(direction, -vessel.scale * 5)
      .add(new Vector3(0, 0, vessel.scale * 1.8));
    const previousQuaternion = this.camera.quaternion.clone();
    this.camera.position.lerp(cameraTarget, alpha);
    this.camera.lookAt(lookAt);
    const targetQuaternion = this.camera.quaternion.clone();
    if (!vessel.reducedMotion && vessel.cameraTransitionElapsed <= vessel.cameraTransitionDuration) {
      const progress = Math.min(1, vessel.cameraTransitionElapsed / vessel.cameraTransitionDuration);
      const eased = progress * progress * (3 - 2 * progress);
      this.camera.position.copy(vessel.cameraStartPosition).lerp(cameraTarget, eased);
      this.camera.quaternion.copy(vessel.cameraStartQuaternion).slerp(targetQuaternion, eased);
    } else {
      this.camera.quaternion.copy(previousQuaternion).slerp(targetQuaternion, alpha);
    }
    this.camera.updateMatrixWorld(true);
  }

  _updateSpaceEntities(dt) {
    for (const entity of this.spaceEntities.values()) {
      const moved = entity.update(dt);
      if (moved && entity === this.cameraFollowEntity) {
        this._followVessel(entity, 1 - Math.exp(-dt * 2.8));
      }
    }
    this._syncSpaceEntityAnchors();
  }

  _syncSpaceEntityAnchors() {
    for (const entity of this.spaceEntities.values()) {
      const anchor = entity.parentBodyAnchor;
      if (!anchor) continue;
      const bodyKind = String(anchor.kind || anchor.type || 'planet');
      const body = this.bodies.find((candidate) => candidate.userData.type === bodyKind
        && Number(candidate.userData.data.position) === Number(anchor.position)
        && (anchor.parentPosition === undefined
          || Number(candidate.userData.parentPosition) === Number(anchor.parentPosition)));
      if (!body) continue;
      const latitude = THREE_DEG_TO_RAD * entity.surfaceLatitude;
      const longitude = THREE_DEG_TO_RAD * entity.surfaceLongitude;
      const normal = new Vector3(Math.cos(latitude) * Math.cos(longitude),
        Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude));
      normal.applyQuaternion(body.getWorldQuaternion(new Quaternion())).normalize();
      entity.position.copy(body.getWorldPosition(new Vector3()).add(this.origin))
        .addScaledVector(normal, body.userData.radius + entity.surfaceHeight);
      entity.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    }

    const resolving = new Set();
    const resolved = new Set();
    const resolveParent = (entity) => {
      if (resolved.has(entity.id) || !entity.parentEntityId) return;
      if (resolving.has(entity.id)) return;
      const parent = this.spaceEntities.get(entity.parentEntityId);
      if (!parent) return;
      resolving.add(entity.id);
      resolveParent(parent);
      entity.position.copy(entity.localPosition).applyQuaternion(parent.quaternion).add(parent.position);
      entity.quaternion.copy(parent.quaternion).multiply(entity.localQuaternion);
      resolving.delete(entity.id);
      resolved.add(entity.id);
    };
    for (const entity of this.spaceEntities.values()) resolveParent(entity);
  }

  _registerSystemSpaceEntity(descriptor) {
    this.systemManagedEntityIds.add(String(descriptor.id));
    void this.registerSpaceEntity(descriptor).catch((error) => {
      this.systemManagedEntityIds.delete(String(descriptor.id));
      window.GQLog?.warn?.('[space-entity]', String(error?.message || error));
    });
  }

  clearSystem() {
    this.weaponRenderPass.clear();
    for (const id of this.systemManagedEntityIds) {
      const entity = this.spaceEntities.get(id);
      if (entity) this._removeSpaceEntity(entity);
    }
    this.systemManagedEntityIds.clear();
    this.lensFlare?.clearSources();
    this.root.clear();
    this.bodies = [];
    this.asteroidBelts = [];
    this.systemVisualizations.clear();
    this.previousView = null;
  }

  setSystemSelection(selection) {
    if (selection?.kind === 'planet') this.systemVisualizations.selectPlanet(selection.position);
    else this.systemVisualizations.selectPlanet(null);
    return true;
  }

  setSystemHover(hover) {
    if (hover?.kind === 'planet') this.systemVisualizations.hoverPlanet(hover.position);
    else this.systemVisualizations.hoverPlanet(null);
    return true;
  }

  setSystemVisualizationOptions(options) {
    this.systemVisualizations.configure(options);
    return true;
  }

  setSystem(scene) {
    const system = scene?.sceneGraph?.children?.find((node) => node.type === 'system');
    if (!system?.data) return false;
    const star = system.data;
    const origin = new Vector3(Number(star.x_ly), Number(star.y_ly), Number(star.z_ly));
    if (!origin.toArray().every(Number.isFinite)) return false;
    const shift = this.origin.clone().sub(origin);
    this.camera.position.add(shift);
    if (this.flight) {
      this.flight.destination.add(shift);
      this.flight.finalDestination?.add(shift);
      this.flight.focus.add(shift);
      this.flight.waypoints?.forEach((waypoint) => waypoint.add(shift));
      if (this.flight.orbit) this.flight.orbit.center.add(shift);
    }
    this.origin.copy(origin);
    this.clearSystem();
    const systemId = `${Number(star.galaxy_index) || 0}:${Number(star.system_index) || 0}`;
    const addBody = (parent, type, data, position, radius) => {
      const body = new Object3D();
      body.position.copy(position);
      body.userData = {
        type, data, radius: Math.max(1e-15, radius),
        surfaceSeed: stableSurfaceSeed(star, type, data),
        surfaceProfile: surfaceProfile(type, data),
        inhabited: type === 'planet' && (data?.inhabited === true || Number(data?.colony_count) > 0),
        atmosphere: type === 'planet' ? layerStrength(data, 'atmosphere', 0.18) : 0,
        cloudiness: type === 'planet' ? layerStrength(data, 'clouds', 0.08) : 0,
      };
      parent.add(body);
      this.bodies.push(body);
      return body;
    };
    addBody(this.root, 'star', star, new Vector3(), (Number(star.radius_solar) || 1) * 695700 * KM_LY);
    const systemChildren = Array.isArray(system.children) ? system.children : [];
    const beltNodes = systemChildren
      .filter((node) => node?.type === 'asteroid_belt' && node.data
        && Number.isFinite(Number(node.data.inner_radius_au))
        && Number.isFinite(Number(node.data.outer_radius_au))
        && Number(node.data.inner_radius_au) > 0
        && Number(node.data.outer_radius_au) <= 1000
        && Number(node.data.outer_radius_au) > Number(node.data.inner_radius_au))
      .sort((left, right) => {
        const leftId = String(left.data.id || '');
        const rightId = String(right.data.id || '');
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      })
      .slice(0, ASTEROID_BELT_MAX_COUNT);
    const beltParticleCount = Math.floor(ASTEROID_BELT_PARTICLE_BUDGET / Math.max(1, beltNodes.length));
    this.asteroidBelts = beltNodes.map((node) => ({
      id: String(node.data.id || ''),
      innerRadiusAu: Number(node.data.inner_radius_au),
      outerRadiusAu: Number(node.data.outer_radius_au),
      particles: createAsteroidBeltParticles(node.data, beltParticleCount),
    }));
    const planetNodes = systemChildren.filter((node) => node.type === 'planet' && node.data);
    this.systemVisualizations.setSystem(star, planetNodes.map((node) => node.data));
    for (const node of systemChildren) {
      if (node.type === 'ship' && scene.flightTour === true && node.data?.preview_only === true) {
        this._registerSystemSpaceEntity({ ...node.data, space_entity: 'vessel' });
        continue;
      }
      if (node.type === 'comet' || node.type === 'rogue_planet' || node.type === 'asteroid') {
        const data = node.data || {};
        const position = new Vector3(Number(data.local_x) || 0, Number(data.local_y) || 0,
          Number(data.local_z) || 0).multiplyScalar(AU_LY);
        const radius = Math.max(1e-15, (Number(data.diameter_km) || 6000) * 0.5 * KM_LY);
        addBody(this.root, node.type, data, position, radius);
        continue;
      }
      if (node.type === 'star-installation') {
        const data = node.data || {};
        const orbit = Math.max(0.1, Number(data.preview_orbit_radius_au) || 2) * AU_LY;
        const angle = (Number(data.position) || this.bodies.length) * 2.399963229728653;
        addBody(this.root, 'star-installation', data,
          new Vector3(Math.cos(angle) * orbit, Math.sin(angle) * orbit, 0), Math.max(orbit * 0.025, 1e-15));
        continue;
      }
      if (node.type !== 'planet') continue;
      const data = node.data;
      const orbit = this.systemVisualizations.orbits.find((item) => item.position === Number(data.position));
      const position = new Vector3(...(orbit?.bodyPosition || [0, 0, 0]));
      const radius = (Number(data.diameter_km) || 12000) * 0.5 * KM_LY;
      const planet = addBody(this.root, 'planet', data, position, radius);
      const ringSystem = data.ring_system || data.rings;
      if (ringSystem && typeof ringSystem === 'object') {
        const innerRadius = Number(ringSystem.inner_radius_planet_r);
        const outerRadius = Number(ringSystem.outer_radius_planet_r);
        if (Number.isFinite(innerRadius) && Number.isFinite(outerRadius)
          && innerRadius >= 1.1 && outerRadius > innerRadius) {
          const opticalDepth = Number(ringSystem.optical_depth);
          const tiltDeg = Number(ringSystem.tilt_deg);
          planet.userData.ringSystem = {
            innerRadius,
            outerRadius,
            opticalDepth: Number.isFinite(opticalDepth) ? Math.max(0, Math.min(1, opticalDepth)) : 0.35,
            tiltRad: (Number.isFinite(tiltDeg) ? tiltDeg : 0) * THREE_DEG_TO_RAD,
            composition: String(ringSystem.composition || 'mixed_ice_dust').toLowerCase(),
          };
        }
      }
      const colonyId = `colony:${systemId}:${Number(data.position)}`;
      const registerColony = (suffix, seed, latitude, longitude) => {
        this._registerSystemSpaceEntity({
          id: `${colonyId}:${suffix}`,
          space_entity: 'colony',
          route: [[0, 0, 0], [0, 0, 0]],
          anchor_body: { kind: 'planet', position: Number(data.position) },
          surface_latitude_deg: latitude,
          surface_longitude_deg: longitude,
          surface_height_ly: radius * 0.002,
          visual_scale_ly: radius * 0.035,
          color: [0.38, 0.78, 0.62, 1],
          model_url: data.colony_model_url || 'procedural:colony',
          seed,
        });
      };
      const hasColony = data?.inhabited === true || Number(data?.colony_count) > 0;
      if (hasColony) {
        const seed = stableSurfaceSeed(star, 'colony', data);
        registerColony('settlement', seed, ((seed % 1200) / 10) - 60,
          ((seed * 2.399963229728653) % 360) - 180);
      }
      for (const [childIndex, child] of (node.children || []).entries()) {
        if (child.type === 'moon') {
          const moon = child.data;
          const distance = Math.max(2, Number(moon.semi_major_axis_parent_r) || 6) * radius;
          const phase = Number(moon.position ?? moon.moon_index) * 2.399963229728653;
          const body = addBody(planet, 'moon', moon,
            new Vector3(Math.cos(phase) * distance, Math.sin(phase) * distance, distance * 0.06),
            (Number(moon.diameter_km) || 2500) * 0.5 * KM_LY);
          body.userData.parentPosition = Number(data.position);
        } else if (child.type === 'colony-site') {
          const site = addBody(planet, 'colony-site', { previewOnly: true, position: data.position },
            new Vector3(0.25, -0.75, 0.612372).normalize().multiplyScalar(radius * 1.002), radius * 0.002);
          site.userData.parentPosition = Number(data.position);
          if (!hasColony) {
            registerColony('preview', stableSurfaceSeed(star, 'colony-site', data),
              37.76, -71.57);
          }
        } else if (child.type === 'facility' || child.type === 'building') {
          const facility = child.data || {};
          const zone = String(facility.zone || 'surface');
          const seed = (stableSurfaceSeed(star, child.type, facility) + childIndex * 1379) % 10000;
          const angle = seed * 2.399963229728653;
          const orbit = zone === 'orbital' ? radius * 1.28 : radius * 1.003;
          const body = addBody(planet, 'facility', facility,
            new Vector3(Math.cos(angle) * orbit, Math.sin(angle) * orbit, radius * 0.08),
            Math.max(radius * 0.008, 1e-15));
          body.userData.parentPosition = Number(data.position);
          const modelType = String(facility.model_id || facility.modelId || facility.type || '').toLowerCase();
          this._registerSystemSpaceEntity({
            id: `building:${systemId}:${Number(data.position)}:${String(facility.id || facility.facility_id || `${modelType || 'facility'}-${childIndex}`)}`,
            space_entity: 'building',
            route: [[0, 0, 0], [0, 0, 0]],
            ...(hasColony && zone !== 'orbital'
              ? {
                parent_entity_id: `${colonyId}:settlement`,
                local_position: [Math.cos(angle) * radius * 0.22,
                  Math.sin(angle) * radius * 0.22, radius * 0.035],
              }
              : {
                anchor_body: { kind: 'planet', position: Number(data.position) },
                surface_latitude_deg: ((seed % 1200) / 10) - 60,
                surface_longitude_deg: ((seed * 2.399963229728653) % 360) - 180,
                surface_height_ly: zone === 'orbital' ? radius * 0.28 : radius * 0.004,
              }),
            visual_scale_ly: radius * (zone === 'orbital' ? 0.055 : 0.028),
            color: Array.isArray(facility.color) ? facility.color : [0.68, 0.74, 0.82, 1],
            ...(facility.model_url ? { model_url: facility.model_url }
              : LOCAL_ARTIFICIAL_MODELS.has(modelType) ? { model_url: `/models/${modelType}.json` } : {}),
          });
        }
      }
    }
    this.root.updateMatrixWorld(true);
    this._syncSpaceEntityAnchors();
    return true;
  }

  _asteroidBeltLodCount(belt) {
    const ratio = this.camera.position.length() / (belt.outerRadiusAu * AU_LY);
    const count = belt.particles.length;
    if (ratio > 120) return Math.max(12, Math.floor(count * 0.0625));
    if (ratio > 40) return Math.max(24, Math.floor(count * 0.125));
    if (ratio > 12) return Math.max(48, Math.floor(count * 0.25));
    return count;
  }

  resolveTarget(target, { safeFraming = false } = {}) {
    const kind = target.kind || 'point';
    if (kind === 'point') {
      const point = new Vector3(Number(target.x_ly), Number(target.y_ly), Number(target.z_ly));
      if (!point.toArray().every(Number.isFinite)) return null;
      point.sub(this.origin);
      const direction = point.clone().sub(this.camera.position).normalize();
      if (!direction.lengthSq()) this.camera.getWorldDirection(direction);
      return { destination: point, focus: point.clone().add(direction), tolerance: 1e-12 };
    }
    if (kind === 'ship') {
      const ship = this.spaceEntities.get(String(target.id || ''));
      if (!ship || ship.kind !== 'vessel') return null;
      const focus = ship.position.clone().sub(this.origin);
      const radius = ship.scale;
      const direction = this.camera.position.clone().sub(focus).normalize();
      if (!direction.lengthSq()) direction.set(0, -0.8, 0.6);
      const passDistance = safeFraming ? cameraFrameDistance(this.camera, radius, 0.24) : radius * 10;
      const destination = focus.clone().addScaledVector(direction, passDistance);
      if (target.flyby === true) {
        const side = direction.clone().cross(new Vector3(0, 0, 1));
        if (side.lengthSq() < 1e-12) side.set(0, 1, 0);
        destination.copy(focus).addScaledVector(direction, safeFraming ? -passDistance * 1.6 : -radius * 8)
          .addScaledVector(side.normalize(), safeFraming ? passDistance * 0.7 : radius * 3.5);
      }
      return {
        destination,
        focus,
        tolerance: Math.max(1e-14, radius * 0.004),
        collisionEntity: ship,
      };
    }
    const type = kind === 'system' ? 'star' : kind === 'surface' ? 'planet' : kind;
    const body = this.bodies.find((candidate) => candidate.userData.type === type
      && (type === 'star'
        || (target.bodyId && String(candidate.userData.data.body_id) === String(target.bodyId))
        || Number(candidate.userData.data.position) === Number(target.position))
      && (type !== 'moon' || candidate.userData.parentPosition === Number(target.parentPosition)));
    if (!body) return null;
    const focus = body.getWorldPosition(new Vector3());
    const radius = body.userData.radius;
    const screenFraction = kind === 'surface' ? 0.3 : 0.24;
    let distance = safeFraming
      ? cameraFrameDistance(this.camera, radius * (type === 'star' ? 2.6 : 1.12), screenFraction)
      : radius * (kind === 'surface' ? 1.12 : 3.2);
    if (kind === 'system') {
      if (safeFraming) {
        const systemExtent = Math.max(...this.bodies.map((candidate) => {
          const position = candidate.getWorldPosition(new Vector3()).sub(focus);
          const visualRadius = candidate.userData.radius
            * (candidate.userData.type === 'star' ? 2.6 : 1.12);
          return position.length() + visualRadius;
        }));
        distance = Math.max(radius * 12, cameraFrameDistance(this.camera, systemExtent, 0.48));
      } else {
        distance = Math.max(radius * 12, ...this.bodies
          .filter((candidate) => candidate.userData.type === 'planet')
          .map((candidate) => candidate.position.length() * 2.4));
      }
    }
    const direction = this.camera.position.clone().sub(focus).normalize();
    if (direction.lengthSq() === 0) direction.set(0, -0.8, 0.6);
    const destination = focus.clone().addScaledVector(direction, distance);
    if (target.flyby === true) {
      const side = direction.clone().cross(new Vector3(0, 0, 1));
      if (side.lengthSq() < 1e-12) side.set(0, 1, 0);
      const passDistance = safeFraming
        ? cameraFrameDistance(this.camera, radius * (type === 'star' ? 2.6 : 1.12), 0.24)
        : radius * 8;
      destination.copy(focus).addScaledVector(direction, safeFraming ? -passDistance * 1.6 : -passDistance)
        .addScaledVector(side.normalize(), safeFraming ? passDistance * 0.7 : radius * 3.5);
    }
    return {
      destination,
      focus,
      tolerance: Math.max(1e-14, radius * 0.004),
      collisionBody: body,
    };
  }

  navigate(target, { durationSec = 18, orbitDurationSec = 0, orbitRevolutions = 0.65, signal } = {}) {
    const destination = this.resolveTarget(target, { safeFraming: true });
    if (!destination || signal?.aborted) return false;
    this.stop();
    const obstacles = [
      ...this.bodies
        .filter((body) => target.flyby === true || body !== destination.collisionBody)
        .map((body) => ({
          center: body.getWorldPosition(new Vector3()),
          radius: body.userData.radius * (body.userData.type === 'star' ? 2.6 : 1.08),
        })),
      ...[...this.spaceEntities.values()]
        .filter((entity) => entity.kind === 'vessel' && entity !== destination.collisionEntity)
        .map((entity) => ({ center: entity.position.clone().sub(this.origin), radius: entity.scale })),
    ];
    const waypoints = collisionFreeWaypoints(this.camera.position, destination.destination, obstacles);
    const firstDestination = waypoints[0] || destination.destination;
    const distance = this.camera.position.distanceTo(firstDestination);
    const ratio = Math.max(2, distance / destination.tolerance);
    const omega = (Math.log(ratio) + Math.log(Math.max(2, Math.log(ratio))) + 2) / Math.max(2, durationSec);
    return new Promise((resolve) => {
      const abort = () => this.stop();
      signal?.addEventListener('abort', abort, { once: true });
      this.flight = {
        ...destination,
        destination: firstDestination.clone(),
        finalDestination: destination.destination.clone(),
        waypoints,
        waypointIndex: 0,
        omega,
        peakSpeed: Math.max(1e-15, distance * omega / Math.E),
        orbitDurationSec: Math.max(0, Number(orbitDurationSec) || 0),
        orbitRevolutions: Math.max(0, Number(orbitRevolutions) || 0),
        orbit: null,
        finish: (arrived) => { signal?.removeEventListener('abort', abort); resolve(arrived); } };
      this.telemetry.arrived = false;
    });
  }

  getFlightCoordinates() {
    const current = this.camera.position.clone().add(this.origin).toArray();
    const destination = this.flight?.orbit
      ? this.flight.destination
      : this.flight?.finalDestination || this.flight?.destination;
    return {
      start: current,
      destination: destination?.clone().add(this.origin).toArray() || current.slice(),
    };
  }

  restoreFlightCoordinates(coordinates) {
    const validTriple = (value) => Array.isArray(value) && value.length === 3
      && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
    if (!validTriple(coordinates?.start) || !validTriple(coordinates?.destination)) return false;
    this.stop();
    const start = new Vector3(...coordinates.start).sub(this.origin);
    const destination = new Vector3(...coordinates.destination).sub(this.origin);
    this.camera.position.copy(start);
    if (start.distanceToSquared(destination) > 1e-24) this.camera.lookAt(destination);
    this.camera.updateMatrixWorld(true);
    this.previousView = null;
    return true;
  }

  async initialize(device, format) {
    this.device = device;
    this.vesselRenderPass.initialize(device, this.bloom?.sceneFormat || format);
    await this.labelRenderer?.initialize(device, format);
  }

  setGalaxyLabelStars(stars) {
    const started = performance.now();
    this.galaxyLabelIndex = createSpatialStarIndex(stars);
    this.labelIndexBuildMs = performance.now() - started;
    return this.galaxyLabelIndex.size;
  }

  setSpatialLabelMode(mode) {
    return this.labelRenderer?.setMode(mode) ?? false;
  }

  setSpatialLabelCallbacks(callbacks) {
    this.labelRenderer?.setCallbacks(callbacks);
  }

  getRenderBenchmark() {
    const samples = this.renderProfileSamples;
    const average = (key) => samples.length
      ? samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length
      : 0;
    const percentile = (key, fraction) => {
      if (!samples.length) return 0;
      const sorted = samples.map((sample) => sample[key]).sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
    };
    const last = samples.at(-1) || null;
    return {
      sampleCount: samples.length,
      databaseIndexStars: this.galaxyLabelIndex?.size || 0,
      labelIndexBuildMs: this.labelIndexBuildMs,
      inputStars: last?.inputStars || 0,
      renderedStars: last?.renderedStars || 0,
      queriedLabelStars: last?.queriedLabelStars || 0,
      visibleLabelCandidates: last?.visibleLabelCandidates || 0,
      labelsDrawn: last?.labelsDrawn || 0,
      averageFrameCpuMs: average('frameCpuMs'),
      p95FrameCpuMs: percentile('frameCpuMs', 0.95),
      averageStarProjectionMs: average('starProjectionMs'),
      averageBodyProjectionMs: average('bodyProjectionMs'),
      averageLabelLayoutMs: average('labelLayoutMs'),
      averageLabelRenderMs: average('labelRenderMs'),
    };
  }

  update(deltaSeconds) {
    const dt = Math.max(0, Math.min(0.05, Number(deltaSeconds) || 0));
    this.effectTime += dt;
    this._updateSpaceEntities(dt);
    const flight = this.flight;
    if (this.heroBattle || !flight || !dt) return;
    const previousOrientation = this.camera.quaternion.clone();
    const previousVelocity = this.velocity.clone();
    const aim = flight.focus.clone().sub(this.camera.position).normalize();
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const bank = Math.max(-0.2, Math.min(0.2, -right.dot(aim) * 0.25));
    const orientation = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(
      this.camera.position, flight.focus, this.camera.up));
    orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank));
    const angularDistance = this.camera.quaternion.angleTo(orientation);
    const desiredTurnSpeed = Math.min(0.8, Math.sqrt(2.4 * angularDistance), angularDistance * 4);
    this.turnSpeed += Math.max(-1.2 * dt, Math.min(1.2 * dt, desiredTurnSpeed - this.turnSpeed));
    this.camera.quaternion.rotateTowards(orientation, dt * this.turnSpeed);
    if (flight.orbit) {
      const orbit = flight.orbit;
      orbit.elapsed = Math.min(orbit.duration, orbit.elapsed + dt);
      const progress = orbit.elapsed / orbit.duration;
      const eased = progress * progress * (3 - 2 * progress);
      const angle = Math.PI * 2 * flight.orbitRevolutions * eased;
      const position = orbit.radial.clone().applyAxisAngle(orbit.axis, angle)
        .multiplyScalar(orbit.radius).add(orbit.center);
      this.velocity.copy(position).sub(this.camera.position).divideScalar(dt);
      this.acceleration.copy(this.velocity).sub(previousVelocity).divideScalar(dt);
      this.camera.position.copy(position);
      flight.destination.copy(position);
      const speed = this.velocity.length();
      this.telemetry = {
        phase: 'orbit',
        speed,
        speedNorm: Math.min(1, speed / flight.peakSpeed),
        acceleration: this.acceleration.length(),
        angularSpeed: previousOrientation.angleTo(this.camera.quaternion) / dt,
        distance: position.distanceTo(orbit.center),
        arrived: false,
      };
      this.camera.updateMatrixWorld(true);
      if (progress >= 1) this.stop(true);
      return;
    }
    if (flight.waypointIndex < flight.waypoints.length - 1
      && this.camera.position.distanceTo(flight.destination) <= flight.tolerance
      && this.velocity.length() <= flight.tolerance * flight.omega * 2) {
      flight.waypointIndex += 1;
      flight.destination.copy(flight.waypoints[flight.waypointIndex]);
    }
    const forward = this.camera.getWorldDirection(new Vector3());
    const alignment = Math.max(0.08, forward.dot(aim));
    const step = dt * alignment;
    const offset = this.camera.position.clone().sub(flight.destination);
    const damping = this.velocity.clone().addScaledVector(offset, flight.omega);
    const decay = Math.exp(-flight.omega * step);
    this.camera.position.copy(flight.destination).add(offset.addScaledVector(damping, step).multiplyScalar(decay));
    this.velocity.addScaledVector(damping, -flight.omega * step).multiplyScalar(decay);
    this.acceleration.copy(this.velocity).sub(previousVelocity).divideScalar(dt);
    const speed = this.velocity.length();
    const distance = this.camera.position.distanceTo(flight.destination);
    const phase = speed < flight.peakSpeed * 0.03 && distance > flight.tolerance * 10 ? 'accelerate'
      : this.velocity.dot(this.acceleration) < 0 ? 'brake' : 'cruise';
    this.telemetry = { phase, speed, speedNorm: Math.min(1, speed / flight.peakSpeed),
      acceleration: this.acceleration.length(), angularSpeed: previousOrientation.angleTo(this.camera.quaternion) / dt,
      distance, arrived: false };
    this.camera.updateMatrixWorld(true);
    if (distance <= flight.tolerance && speed <= flight.tolerance * flight.omega * 2
      && this.camera.quaternion.angleTo(orientation) < 0.01) {
      if (flight.orbitDurationSec > 0 && flight.orbitRevolutions > 0) {
        const radial = this.camera.position.clone().sub(flight.focus);
        const radius = radial.length();
        if (radius > 0) {
          radial.normalize();
          const axis = radial.clone().cross(new Vector3(0, 0, 1));
          if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
          else axis.normalize();
          flight.orbit = {
            elapsed: 0,
            duration: flight.orbitDurationSec,
            center: flight.focus.clone(),
            radial,
            axis,
            radius,
          };
          this.velocity.set(0, 0, 0);
        } else {
          this.stop(true);
        }
      } else {
        this.stop(true);
      }
    }
  }

  stop(arrived = false) {
    const flight = this.flight;
    this.flight = null;
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.turnSpeed = 0;
    this.telemetry = { phase: 'idle', speed: 0, speedNorm: 0, angularSpeed: 0, arrived };
    flight?.finish(arrived);
  }

  getLensFlareSources() {
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    const bodies = this.bodies.filter((body) => !['colony-site', 'facility'].includes(body.userData.type))
      .map((body) => ({ type: body.userData.type, data: body.userData.data,
        sphere: new Sphere(body.getWorldPosition(new Vector3()), body.userData.radius) }));
    const occluders = bodies.filter((body) => body.type !== 'star');
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const ray = new Ray();
    const sourceHit = new Vector3();
    const blockerHit = new Vector3();
    const sources = [];
    for (const body of bodies) {
      if (body.type !== 'star') continue;
      const local = body.sphere.center.clone().applyMatrix4(this.camera.matrixWorldInverse);
      if (local.z >= 0) continue;
      const projected = body.sphere.center.clone().project(this.camera);
      const edgeFade = Math.max(0, Math.min(1, (1 - Math.max(Math.abs(projected.x), Math.abs(projected.y))) / 0.18));
      if (!edgeFade) continue;
      let visible = 0;
      for (let sample = 0; sample < 17; sample++) {
        const radius = sample === 0 ? 0 : Math.sqrt((sample - 0.5) / 16) * body.sphere.radius * 0.95;
        const angle = sample * 2.399963229728653;
        const target = body.sphere.center.clone().addScaledVector(right, Math.cos(angle) * radius)
          .addScaledVector(up, Math.sin(angle) * radius);
        ray.set(this.camera.position, target.sub(this.camera.position).normalize());
        if (!ray.intersectSphere(body.sphere, sourceHit)) continue;
        const sourceDistance = sourceHit.distanceToSquared(this.camera.position);
        const blocked = occluders.some((occluder) => occluder.sphere.containsPoint(this.camera.position)
          || (ray.intersectSphere(occluder.sphere, blockerHit)
            && blockerHit.distanceToSquared(this.camera.position) < sourceDistance));
        if (!blocked) visible++;
      }
      const angularRadius = body.sphere.radius / body.sphere.center.distanceTo(this.camera.position);
      const intensity = 0.65 * edgeFade * Math.min(1, angularRadius / 0.008) * visible / 17;
      const spectralClass = String(body.data.spectral_class || 'G').charAt(0).toUpperCase();
      const color = SPECTRAL_COLORS[spectralClass] || SPECTRAL_COLORS.G;
      const colorHex = (Math.round(color[0] * 255) << 16) | (Math.round(color[1] * 255) << 8) | Math.round(color[2] * 255);
      if (intensity > 0) sources.push({ x: projected.x, y: projected.y, intensity, colorHex });
    }
    return sources;
  }

  renderFrame(device, context, stars, width, height, nebulaField, pixelRatio = 1) {
    const frameStarted = performance.now();
    const sceneFormat = this.bloom?.sceneFormat || navigator.gpu.getPreferredCanvasFormat();
    if (this.pipeline && this.pipelineFormat !== sceneFormat) {
      this.pipeline = null;
      this.cameraBuffer?.destroy();
    }
    this.pipelineFormat = sceneFormat;
    if (!this.pipeline) {
      const shader = device.createShaderModule({ code: SPACE_SHADER, label: 'perspective-space-world' });
      this.pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vs_main', buffers: [{
          arrayStride: 80, stepMode: 'instance', attributes: Array.from({ length: 5 }, (_, index) => ({
            shaderLocation: index, offset: index * 16, format: 'float32x4',
          })),
        }] },
        fragment: { module: shader, entryPoint: 'fs_main', targets: [{
          format: sceneFormat,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }] },
        primitive: { topology: 'triangle-strip' },
      });
      this.cameraBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.cameraBindGroup = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }] });
    }
    this.device = device;
    this.vesselRenderPass.initialize(device,
      this.bloom?.sceneFormat || navigator.gpu.getPreferredCanvasFormat());
    const selected = this.systemVisualizations.getSelectedPlanet();
    const selectedOrbit = this.systemVisualizations.getSelectedOrbit();
    const phaseArcPointCount = this.systemVisualizations.phaseArcVisible
      ? selectedOrbit?.phaseArcPoints.length || 0
      : 0;
    const orbitPointCount = this.systemVisualizations.orbitsVisible
      ? this.systemVisualizations.orbits.reduce((count, orbit) => count + orbit.points.length, 0)
      : 0;
    const planeGuidePointCount = this.systemVisualizations.planesVisible
      ? this.systemVisualizations.orbits.reduce((count, orbit) => count + orbit.planeGuides.length, 0)
      : 0;
    const distanceLinePointCount = this.systemVisualizations.distanceLineVisible ? 48 : 0;
    const apsisMarkerPointCount = this.systemVisualizations.apsidesVisible && selected ? 2 : 0;
    const asteroidBeltParticleCount = this.asteroidBelts.reduce((total, belt) => total + belt.particles.length, 0);
    const capacity = (stars.length + this.bodies.length * 2 + asteroidBeltParticleCount + orbitPointCount
      + planeGuidePointCount + distanceLinePointCount + apsisMarkerPointCount
      + phaseArcPointCount + 8) * 20;
    if (!this.instances || this.instances.length < capacity) {
      this.instanceBuffer?.destroy();
      this.instances = new Float32Array(capacity);
      this.instanceBuffer = device.createBuffer({ size: this.instances.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    const world = this.camera.matrixWorld.elements;
    const basis = new Float32Array([world[0], world[1], world[2], 0,
      world[4], world[5], world[6], 0, world[8], world[9], world[10], 0,
      this.effectTime, 0, 0, 0]);
    device.queue.writeBuffer(this.cameraBuffer, 0, basis);
    const view = this.camera.matrixWorldInverse.elements;
    const focal = this.camera.projectionMatrix.elements[5];
    const aspect = this.camera.aspect;
    let count = 0;
    const starProjectionStarted = performance.now();
    const append = (position, radius, color, kind, seed = 0, opacity = 1, light = [0, 0, 1], profile = 0,
      inhabited = false, atmosphere = 0, cloudiness = 0) => {
      const x = view[0] * position.x + view[4] * position.y + view[8] * position.z + view[12];
      const y = view[1] * position.x + view[5] * position.y + view[9] * position.z + view[13];
      const depth = -(view[2] * position.x + view[6] * position.y + view[10] * position.z + view[14]);
      if (depth <= Math.max(1e-15, radius * 0.01)) return;
      const cx = x * focal / (depth * aspect);
      const cy = y * focal / depth;
      const angularRadius = radius * focal / Math.sqrt(Math.max(1e-30, depth * depth - radius * radius));
      const ry = kind === 0 ? Math.max(angularRadius, 2.2 / height)
        : kind === 9 ? Math.max(angularRadius, 0.8 / height)
        : kind === 6 || kind === 7 ? Math.max(angularRadius, 12 / height)
          : angularRadius * (kind === 4 ? 2.6 : 1);
      const rx = ry / aspect;
      if (Math.abs(cx) > 1.1 + rx || Math.abs(cy) > 1.1 + ry || ry * height < 0.2) return;
      let trailX = 0;
      let trailY = 0;
      if (kind === 0 && this.previousView) {
        const previous = this.previousView;
        const pz = -(previous[2] * position.x + previous[6] * position.y + previous[10] * position.z + previous[14]);
        if (pz > 1e-12) {
          const px = (previous[0] * position.x + previous[4] * position.y + previous[8] * position.z + previous[12]) * focal / (pz * aspect);
          const py = (previous[1] * position.x + previous[5] * position.y + previous[9] * position.z + previous[13]) * focal / pz;
          trailX = Math.max(-0.15, Math.min(0.15, (cx - px) * 0.75));
          trailY = Math.max(-0.15, Math.min(0.15, (cy - py) * 0.75));
        }
      }
      this.instances.set([cx, cy, rx, ry, ...color, opacity,
        kind, seed, profile, inhabited ? 1 : 0, trailX, trailY, atmosphere, cloudiness, ...light, 0], count * 20);
      count++;
    };
    const position = new Vector3();
    for (const star of stars) {
      position.set(Number(star.x_ly ?? star.x) || 0, Number(star.y_ly ?? star.y) || 0, Number(star.z_ly ?? star.z) || 0).sub(this.origin);
      append(position, 0, star.display_color || [0.8, 0.86, 1], 0, 0,
        Math.min(0.85, 0.35 + (Number(star.display_opacity) || 0.15) * 2));
    }
    if (this.systemVisualizations.distanceLineVisible && selected) {
      const starBody = this.bodies.find((body) => body.userData.type === 'star');
      const targetBody = this.bodies.find((body) => body.userData.type === 'planet'
        && Number(body.userData.data.position) === selected.position);
      if (starBody && targetBody) {
        const starPosition = starBody.getWorldPosition(new Vector3());
        const targetPosition = targetBody.getWorldPosition(new Vector3());
        for (let index = 1; index < 49; index += 1) {
          position.lerpVectors(starPosition, targetPosition, index / 49);
          append(position, 0, [0.75, 0.9, 1], 0, 0, 0.52);
        }
      }
    }
    for (const orbit of this.systemVisualizations.orbits) {
      if (this.systemVisualizations.planesVisible) {
        for (const point of orbit.planeGuides) {
          position.fromArray(point);
          append(position, 0, [0.2, 0.46, 0.68], 0, 0, 0.14);
        }
      }
      if (this.systemVisualizations.orbitsVisible) {
        const isSelectedOrbit = orbit.position === selected?.position;
        const color = isSelectedOrbit ? [0.3, 0.86, 1] : [0.28, 0.58, 0.82];
        const opacity = isSelectedOrbit ? 0.78 : 0.34;
        for (const point of orbit.points) {
          position.fromArray(point);
          append(position, 0, color, 0, 0, opacity);
        }
      }
    }
    if (this.systemVisualizations.apsidesVisible && selectedOrbit) {
      position.fromArray(selectedOrbit.periapsisPoint);
      append(position, 0, [0.35, 0.9, 0.62], 6, 0, 0.9);
      position.fromArray(selectedOrbit.apoapsisPoint);
      append(position, 0, [1, 0.55, 0.25], 7, 0, 0.9);
    }
    if (this.systemVisualizations.phaseArcVisible && selectedOrbit) {
      for (const point of selectedOrbit.phaseArcPoints) {
        position.fromArray(point);
        append(position, 0, [0.62, 0.82, 1], 0, 0, 0.82);
      }
    }
    for (const belt of this.asteroidBelts) {
      const lodCount = this._asteroidBeltLodCount(belt);
      const stride = Math.max(1, Math.floor(belt.particles.length / lodCount));
      let emitted = 0;
      for (let index = 0; index < belt.particles.length && emitted < lodCount; index += stride) {
        const particle = belt.particles[index];
        append(particle.position, particle.radius, [0.78, 0.7, 0.55], 9,
          particle.seed, particle.opacity);
        emitted += 1;
      }
    }
    const starProjectionMs = performance.now() - starProjectionStarted;
    const bodyProjectionStarted = performance.now();
    const hovered = this.systemVisualizations.getHoveredPlanet();
    const sortedBodies = this.bodies.map((body) => ({ body, position: body.getWorldPosition(new Vector3()) }))
      .sort((left, right) => right.position.distanceToSquared(this.camera.position) - left.position.distanceToSquared(this.camera.position));
    for (const item of sortedBodies) {
      const { type, data, radius } = item.body.userData;
      if (type === 'colony-site' || type === 'facility') continue;
      const kind = type === 'star' ? 1 : type === 'moon' ? 3 : 2;
      const planetClass = String(data.class || data.planet_class || 'rocky');
      const fallbackColor = planetClass.includes('ice') ? [0.65, 0.78, 0.86]
        : planetClass.includes('gas') ? [0.72, 0.56, 0.38]
          : planetClass.includes('ocean') ? [0.17, 0.42, 0.58]
            : planetClass === 'lava' ? [0.8, 0.2, 0.06] : [0.38, 0.48, 0.28];
      const color = type === 'star' ? SPECTRAL_COLORS[String(data.spectral_class || 'G').charAt(0).toUpperCase()] || SPECTRAL_COLORS.G
        : surfaceColor(data, fallbackColor);
      const light = item.position.clone().negate().transformDirection(this.camera.matrixWorldInverse);
      if (type === 'star') {
        const corona = [Math.min(1, color[0] * 1.15 + 0.12),
          Math.min(1, color[1] * 1.08 + 0.1), Math.min(1, color[2] * 1.05 + 0.08)];
        append(item.position, radius, corona, 4);
      }
      if (type === 'planet' && item.body.userData.ringSystem) {
        const ring = item.body.userData.ringSystem;
        const azimuth = (item.body.userData.surfaceSeed / 10000) * Math.PI * 2;
        const ringNormal = new Vector3(
          Math.sin(ring.tiltRad) * Math.cos(azimuth),
          Math.sin(ring.tiltRad) * Math.sin(azimuth),
          Math.cos(ring.tiltRad),
        ).transformDirection(this.camera.matrixWorldInverse);
        const ringColor = ring.composition.includes('water_ice') ? [0.83, 0.9, 1]
          : ring.composition.includes('silicate') ? [0.78, 0.67, 0.49] : [0.82, 0.79, 0.7];
        const outerRadius = radius * ring.outerRadius;
        append(item.position, outerRadius, ringColor, 8,
          ring.innerRadius / ring.outerRadius,
          Math.min(0.82, 0.22 + ring.opticalDepth * 0.6),
          ringNormal.toArray(),
          radius / outerRadius,
          false,
          ring.opticalDepth);
      }
      if (type === 'planet' && item.body.userData.atmosphere > 0.04) {
        const tint = surfaceColor({ texture: { palette: { base: data.texture?.palette?.accent } } }, [0.38, 0.68, 0.92]);
        append(item.position, radius * (1.035 + item.body.userData.atmosphere * 0.08), tint, 5,
          item.body.userData.surfaceSeed, 1, light.toArray(), item.body.userData.surfaceProfile,
          false, item.body.userData.atmosphere);
      }
      append(item.position, radius, color, kind, item.body.userData.surfaceSeed, 1, light.toArray(),
        item.body.userData.surfaceProfile, item.body.userData.inhabited,
        item.body.userData.atmosphere, item.body.userData.cloudiness);
      if (type === 'planet' && selected?.position === Number(data.position)) {
        append(item.position, radius * 1.6, [0.42, 0.88, 1], 6, 0, 0.92);
      }
      if (type === 'planet' && hovered?.position === Number(data.position)
        && hovered.position !== selected?.position) {
        append(item.position, radius * 1.9, [1, 0.68, 0.22], 7, 0, 0.88);
      }
    }
    const bodyProjectionMs = performance.now() - bodyProjectionStarted;
    if (count) device.queue.writeBuffer(this.instanceBuffer, 0, this.instances.buffer, 0, count * 80);
    const encoder = device.createCommandEncoder();
    this.bloom?.resize(width, height);
    const sceneView = this.bloom
      ? this.bloom.sceneTexture.createView()
      : context.getCurrentTexture().createView();
    let pass = encoder.beginRenderPass({ colorAttachments: [{
      view: sceneView, clearValue: { r: 0.001, g: 0.002, b: 0.004, a: 1 },
      loadOp: 'clear', storeOp: 'store',
    }] });
    if (nebulaField) {
      nebulaField.render(pass, device, nebulaField.perspectiveProjection(this.camera, this.origin), {
        width, height, time: this.effectTime, format: this.bloom?.sceneFormat,
      });
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.cameraBindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    pass.draw(4, count, 0, 0);
    if (this.heroBattle) {
      pass.end();
      const depthView = this.heroBattle.depth.prepare(device, sceneFormat, width, height);
      const timestampWrites = this.heroBattle.metrics.begin(device);
      pass = encoder.beginRenderPass({ colorAttachments: [{
        view: sceneView, loadOp: 'load', storeOp: 'store',
      }], depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      ...(timestampWrites ? { timestampWrites } : {}) });
      this.heroBattle.depth.render(pass, this.bodies, this.camera);
    }
    this.vesselRenderPass.render(pass, [...this.spaceVessels.values()], this.camera,
      this.origin, this.effectTime, !!this.heroBattle, this.heroBattle?.fleetLod ? height : null);
    if (this.heroBattle?.cinematic) {
      this.heroBattle.debrisPass.render(pass, device, sceneFormat, this.camera, this.origin,
        this.heroBattle.time, height);
    }
    this.weaponRenderPass.render(pass, device, this.bloom?.sceneFormat || navigator.gpu.getPreferredCanvasFormat(),
      this.camera, this.origin, performance.now() / 1000, width, height, !!this.heroBattle, this.heroBattle?.time ?? null,
      this.heroBattle?.fleetLod ? this.heroBattle.primitiveBudget : null);
    this.heroBattle?.renderPresentation(pass, device, sceneFormat, width, height);
    this.heroBattle?.recordRenderStats();
    if (this.heroBattle) {
      pass.end();
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: sceneView, loadOp: 'load', storeOp: 'store' }] });
    }
    if (this.lensFlare) {
      this.lensFlare.setProjectedSources(this.getLensFlareSources());
      this.lensFlare.renderOverlay(pass, device, { aspect, time: this.effectTime });
    }
    const labelLayoutStarted = performance.now();
    const labelLayout = resolveSpatialLabels(this, this.galaxyLabelIndex, { width, height, pixelRatio });
    const labelLayoutMs = performance.now() - labelLayoutStarted;
    this.currentLabels = labelLayout.labels;
    this.labelDiagnostics = labelLayout;
    const labelRenderStarted = performance.now();
    this.labelRenderer?.render(pass, device, this.currentLabels, { width, height });
    const labelRenderMs = performance.now() - labelRenderStarted;
    pass.end();
    if (this.bloom) this.bloom.encode(encoder, context.getCurrentTexture().createView());
    this.heroBattle?.metrics.encode(encoder);
    device.queue.submit([encoder.finish()]);
    this.heroBattle?.metrics.submitted();
    this.previousView = view.slice();
    this.renderedInstances = count;
    this.renderProfileSamples.push({
      frameCpuMs: performance.now() - frameStarted,
      starProjectionMs,
      bodyProjectionMs,
      labelLayoutMs,
      labelRenderMs,
      inputStars: stars.length,
      renderedStars: count,
      queriedLabelStars: labelLayout.queriedStars || 0,
      visibleLabelCandidates: labelLayout.visibleCandidates || 0,
      labelsDrawn: this.currentLabels.length,
    });
    if (this.renderProfileSamples.length > 120) this.renderProfileSamples.shift();
  }

  dispose() {
    this.stop();
    this.clearSpaceVessels();
    this.vesselRenderPass.dispose();
    this.weaponRenderPass.clear();
    this.weaponRenderPass.dispose();
    this.lensFlare?.clearSources();
    this.labelRenderer?.dispose();
    this.instanceBuffer?.destroy();
    this.cameraBuffer?.destroy();
    this.instanceBuffer = null;
    this.pipeline = null;
    this.device = null;
    this.root.clear();
  }
}

if (typeof window !== 'undefined') window.GQPerspectiveSpaceFlight = PerspectiveSpaceFlight;