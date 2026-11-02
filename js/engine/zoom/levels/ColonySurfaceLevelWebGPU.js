/**
 * ColonySurfaceLevelWebGPU.js
 *
 * IZoomLevelRenderer — Colony Surface zoom level (Level 3), WebGPU backend.
 *
 * Depth-tested instanced city geometry on the galaxy's device, canvas and loop.
 * Server snapshots are authoritative; pedestrians and particles are cosmetic.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

function parseHexColor(hex, fallback) {
  const normalized = String(hex || '').trim();
  return /^#?[0-9a-f]{6}$/i.test(normalized)
    ? `#${normalized.replace(/^#/, '')}`
    : fallback;
}

function hexToRgbFloat(hex) {
  const normalized = parseHexColor(hex, '#7db7ee').replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

/** Color, position, scale and reserved metadata: four vec4 values per cuboid. */
const BYTES_PER_SLOT = 64;
// Existing architectural units: a 0.41-unit pedestrian is 1.8 metres tall.
const COLONY_METERS_PER_UNIT = 1.8 / 0.41;
const TERRAIN_LODS = Object.freeze([
  { segments: 32, localRings: 16, distantRings: 16 },
  { segments: 64, localRings: 36, distantRings: 24 },
  { segments: 128, localRings: 72, distantRings: 32 },
  { segments: 192, localRings: 108, distantRings: 32 },
]);
const TERRAIN_CACHE_BYTES = 8 * 1024 * 1024;

const COLONY_CITY_WGSL = `
struct Camera {
  viewProjection: mat4x4<f32>, transition: vec4<f32>, surface: vec4<f32>,
  reserved: array<vec4<f32>, 6>, shape: vec4<f32>,
  east: vec4<f32>, pole: vec4<f32>, north: vec4<f32>, shelter: vec4<f32>,
  lobeCenters: array<vec4<f32>,4>, lobeAxes: array<vec4<f32>,4>,
  cuts: array<vec4<f32>,8>, solid: vec4<f32>,
};
struct Instance { color: vec4<f32>, position: vec4<f32>, scale: vec4<f32>, extra: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };
fn solidDistance(point: vec3<f32>) -> f32 {
  var distance = 100.0;
  for (var i = 0u; i < u32(camera.solid.x); i++) {
    let axes = camera.lobeAxes[i].xyz;
    let d = (length((point - camera.lobeCenters[i].xyz) / axes) - 1.0) * min(axes.x,min(axes.y,axes.z));
    let h = max(camera.solid.z - abs(distance - d),0.0) / camera.solid.z;
    distance = min(distance,d) - h * h * camera.solid.z * 0.25;
  }
  for (var i = 0u; i < u32(camera.solid.y); i++) {
    distance = max(distance,camera.cuts[i].w - length(point - camera.cuts[i].xyz));
  }
  return distance;
}
fn solidRadius(direction: vec3<f32>) -> f32 {
  var outer = camera.solid.w;
  // The conservative ellipsoid field permits safe outside-in sphere tracing.
  for (var iteration = 0u; iteration < 64u; iteration++) {
    let distance = solidDistance(direction * outer);
    if (distance <= 0.0000001) { return outer; }
    outer = outer - distance;
    if (outer < 0.0) { break; }
  }
  outer = camera.solid.w;
  for (var step = 1u; step <= 128u; step++) {
    let inner = camera.solid.w * (1.0 - f32(step) / 128.0);
    if (solidDistance(direction * inner) <= 0.0) {
      var a = inner;
      var b = outer;
      for (var i = 0u; i < 20u; i++) {
        let mid = (a + b) * 0.5;
        if (solidDistance(direction * mid) <= 0.0) { a = mid; } else { b = mid; }
      }
      return (a + b) * 0.5;
    }
    outer = inner;
  }
  return 0.0;
}
fn bodyGround(horizontal: vec2<f32>) -> vec3<f32> {
  let radius = max(camera.transition.y, 0.001);
  let distance = length(horizontal);
  let angle = distance / radius;
  var normal = vec3<f32>(0, 1, 0);
  if (distance > 0.0001) {
    let tangent = horizontal / distance;
    normal = vec3<f32>(tangent.x * sin(angle), cos(angle), tangent.y * sin(angle));
  }
  let global = camera.east.xyz * normal.x + camera.pole.xyz * normal.y + camera.north.xyz * normal.z;
  let axes = max(camera.shape.xyz,vec3<f32>(0.5));
  let wave = 0.6 * (global.x * global.x - global.y * global.y) + 0.4 * global.x * global.z;
  var factor = (1.0 + camera.shape.w * wave) / length(global / axes);
  if (camera.solid.x > 0.0) { factor = solidRadius(global); }
  let base = radius * factor;
  return vec3<f32>(normal.x * (base + camera.transition.z),
    -2.0 * sin(angle * 0.5) * sin(angle * 0.5) * base
      + (base - camera.surface.w) + normal.y * camera.transition.z,
    normal.z * (base + camera.transition.z));
}
fn surfacePoint(local: vec3<f32>) -> vec3<f32> {
  let ground = bodyGround(local.xz);
  let epsilon = max(camera.transition.y * 0.0001,0.001);
  let east = bodyGround(local.xz + vec2<f32>(epsilon,0)) - bodyGround(local.xz - vec2<f32>(epsilon,0));
  let north = bodyGround(local.xz + vec2<f32>(0,epsilon)) - bodyGround(local.xz - vec2<f32>(0,epsilon));
  let radial = normalize(ground + vec3<f32>(0,camera.surface.w,0));
  let product = cross(north,east);
  let candidate = product / max(length(product),0.00000001);
  let outward = select(-candidate,candidate,dot(candidate,radial) >= 0.0);
  let normal = select(radial,outward,length(product) > 0.00000001);
  return ground + normal * local.y;
}
@vertex fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Out {
  let corners = array<vec3<f32>, 8>(
    vec3<f32>(-0.5,0,-0.5), vec3<f32>(0.5,0,-0.5),
    vec3<f32>(0.5,0,0.5), vec3<f32>(-0.5,0,0.5),
    vec3<f32>(-0.5,1,-0.5), vec3<f32>(0.5,1,-0.5),
    vec3<f32>(0.5,1,0.5), vec3<f32>(-0.5,1,0.5));
  let indices = array<u32, 36>(
    0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6,
    3,0,4,3,4,7, 4,5,6,4,6,7, 0,3,2,0,2,1);
  let shade = array<f32, 6>(0.72,0.87,0.65,0.78,1.15,0.45);
  let instance = instances[index];
  let local = instance.position.xyz + corners[indices[vertex]] * instance.scale.xyz;
  let world = surfacePoint(local);
  var out: Out;
  out.position = camera.viewProjection * vec4<f32>(world,1);
  out.color = vec4<f32>(instance.color.rgb * shade[vertex / 6u], instance.color.a * camera.transition.x);
  return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> { return in.color; }
struct DomeOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex fn vs_dome(@builtin(vertex_index) vertex: u32) -> DomeOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0,0),vec2<f32>(1,0),vec2<f32>(0,1),
    vec2<f32>(0,1),vec2<f32>(1,0),vec2<f32>(1,1));
  let cell = vertex / 6u;
  let uv = (vec2<f32>(f32(cell % 64u),f32(cell / 64u)) + corners[vertex % 6u]) / vec2<f32>(64,24);
  let angle = uv.x * 6.28318530718;
  let latitude = uv.y * 1.57079632679;
  let local = vec3<f32>(
    cos(angle) * cos(latitude) * camera.shelter.x,
    sin(latitude) * camera.shelter.y - 0.12,
    sin(angle) * cos(latitude) * camera.shelter.x);
  var out: DomeOut;
  out.position = camera.viewProjection * vec4<f32>(surfacePoint(local),1);
  out.uv = uv;
  return out;
}
@fragment fn fs_dome(in: DomeOut) -> @location(0) vec4<f32> {
  let grid = in.uv * vec2<f32>(16,8);
  let edge = abs(fract(grid + 0.5) - 0.5);
  let line = vec2<f32>(1) - smoothstep(fwidth(grid),fwidth(grid) * 2.0,edge);
  let rib = max(line.x,line.y);
  let rim = pow(1.0 - in.uv.y,3.0);
  if (in.uv.y < 0.015) {
    return vec4<f32>(vec3<f32>(0.18,0.28,0.3),camera.transition.x);
  }
  return vec4<f32>(mix(vec3<f32>(0.3,0.65,0.78),vec3<f32>(0.6,0.85,0.9),rib),
    (0.07 + rim * 0.09 + rib * 0.45) * camera.transition.x);
}
`;

const COLONY_BODY_WGSL = `
struct Camera {
  viewProjection: mat4x4<f32>, transition: vec4<f32>, surface: vec4<f32>,
  eye: vec4<f32>, padding: array<vec4<f32>,5>, shape: vec4<f32>,
  east: vec4<f32>, pole: vec4<f32>, north: vec4<f32>,
  solidPadding: array<vec4<f32>,17>, solidParams: vec4<f32>,
};
@group(0) @binding(0) var<uniform> camera: Camera;
struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) material: f32,
};
@vertex fn vs_main(@location(0) world: vec3<f32>, @location(1) color: vec4<f32>, @location(2) material: f32) -> Out {
  var out: Out;
  out.position = camera.viewProjection * vec4<f32>(world,1);
  out.world = world;
  out.color = color;
  out.material = material;
  return out;
}
@fragment fn fs_main(in: Out, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let radial = normalize(in.world + vec3<f32>(0,camera.surface.w,0));
  let face = cross(dpdx(in.world),dpdy(in.world));
  let geometric = face / max(length(face),0.00001);
  let radialNormal = select(-geometric,geometric,dot(geometric,radial) >= 0.0);
  let normal = select(radialNormal,select(geometric,-geometric,front),camera.solidParams.x > 0.5);
  let frame = mat3x3<f32>(camera.east.xyz,camera.pole.xyz,camera.north.xyz);
  let bodyPoint = frame * (in.world + vec3<f32>(0,camera.surface.w,0)) / camera.transition.y;
  let meters = frame * in.world * (gqMaterial.scale.y / camera.transition.y);
  let canonicalNormal = frame * normal;
  var surface = gqSurface(bodyPoint,meters,canonicalNormal,in.material);
  surface.albedo = mix(surface.albedo,gqLinear(in.color.rgb),in.color.a);
  let lightDirection = normalize(vec3<f32>(-0.7,0.8,1.0));
  let color = surface.albedo * 0.3 + surface.emission
    + gqDirect(surface,frame * (camera.eye.xyz - in.world),frame * lightDirection,vec3<f32>(2.8));
  return vec4<f32>(gqFinish(color),camera.transition.x);
}
`;

const COLONY_VFX_WGSL = `
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs_main(@location(0) position: vec3<f32>, @location(1) color: vec4<f32>) -> Out {
  var out: Out; out.position = vec4<f32>(position,1); out.color = color; return out;
}
@fragment fn fs_main(in: Out) -> @location(0) vec4<f32> { return in.color; }
`;

const COLONY_SKY_WGSL = `
struct Camera {
  viewProjection: mat4x4<f32>, transition: vec4<f32>, surface: vec4<f32>,
  eye: vec4<f32>, right: vec4<f32>, up: vec4<f32>, back: vec4<f32>,
  sky: vec4<f32>, clouds: vec4<f32>,
  shape: vec4<f32>,
};
@group(0) @binding(0) var<uniform> camera: Camera;
struct Out { @builtin(position) position: vec4<f32>, @location(0) screen: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) vertex: u32) -> Out {
  let corners = array<vec2<f32>, 3>(vec2<f32>(-1,-1), vec2<f32>(3,-1), vec2<f32>(-1,3));
  var out: Out;
  out.screen = corners[vertex];
  out.position = vec4<f32>(out.screen,0,1);
  return out;
}
fn cloudNoise(point: vec3<f32>) -> f32 {
  let drift = camera.transition.w * 0.035;
  let p = point / max(camera.clouds.x * 0.35, 1.0) + vec3<f32>(drift,0,drift * 0.4);
  let broad = sin(p.x + sin(p.z * 1.3)) * cos(p.z * 0.8 + sin(p.y));
  let detail = sin(p.x * 3.1 + p.z * 1.7) * cos(p.z * 2.9 - p.y);
  return broad * 0.34 + detail * 0.16 + 0.5;
}
struct SkyOut { @location(0) color: vec4<f32>, @builtin(frag_depth) depth: f32 };
@fragment fn fs_sky(in: Out) -> SkyOut {
  let offset = camera.right.xyz * in.screen.x * camera.right.w
    + camera.up.xyz * in.screen.y * camera.up.w;
  let origin = camera.eye.xyz + offset * camera.clouds.w;
  let direction = normalize(-camera.back.xyz + offset * (1.0 - camera.clouds.w) / camera.back.w);
  let center = vec3<f32>(0,-camera.surface.w,0);
  let relative = origin - center;
  let radius = camera.transition.y * max(camera.shape.x,max(camera.shape.y,camera.shape.z))
    * (1.0 + camera.shape.w) + camera.clouds.x;
  let b = dot(relative,direction);
  let c = dot(relative,relative) - radius * radius;
  let discriminant = b * b - c;
  if (discriminant <= 0.0) { discard; }
  let root = sqrt(discriminant);
  let nearHit = -b - root;
  let distance = select(-b + root, nearHit, nearHit > 0.0);
  if (distance <= 0.0) { discard; }
  let point = origin + direction * distance;
  let clip = camera.viewProjection * vec4<f32>(point,1);
  if (clip.w <= 0.0 || clip.z < 0.0) { discard; }
  let normal = normalize(point - center);
  let cloud = smoothstep(1.0 - camera.clouds.z, 1.02, cloudNoise(point)) * min(1.0,camera.clouds.z * 4.0);
  let inside = c < 0.0;
  let light = 0.65 + 0.35 * max(0.0,dot(normal,normalize(vec3<f32>(-0.7,0.8,1))));
  let haze = pow(1.0 - abs(dot(direction,normal)),2.0);
  let color = mix(camera.sky.rgb,vec3<f32>(0.95,0.97,1.0) * light,cloud);
  let opacity = select(cloud * 0.82 + haze * 0.12, 0.12 + cloud * 0.28 + haze * 0.25, inside);
  var out: SkyOut;
  out.color = vec4<f32>(color,opacity * camera.sky.w * camera.transition.x);
  out.depth = min(clip.z / clip.w,0.999999);
  return out;
}
@fragment fn fs_veil(in: Out) -> @location(0) vec4<f32> {
  let billow = cloudNoise(vec3<f32>(in.screen * camera.clouds.x, camera.transition.w));
  let opacity = camera.eye.w * (0.8 + billow * 0.2) * camera.transition.x;
  return vec4<f32>(mix(camera.sky.rgb,vec3<f32>(0.94,0.97,1.0),0.8),opacity);
}
`;

const bounded = (value, min, max, fallback = min) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

function validateBodySolid(solid) {
  const vector = (value, min, max) => Array.isArray(value) && value.length === 3
    && value.every((n) => Number.isFinite(n) && n >= min && n <= max);
  if (solid?.version !== 1 || !Number.isFinite(solid.blend) || solid.blend < 0.01 || solid.blend > 0.4
      || !Array.isArray(solid.lobes) || solid.lobes.length < 1 || solid.lobes.length > 4
      || !solid.lobes.every((lobe) => vector(lobe.center, -2, 2) && vector(lobe.axes, 0.1, 2))
      || !Array.isArray(solid.cuts) || solid.cuts.length > 8
      || !solid.cuts.every((cut) => vector(cut.center, -2, 2)
        && Number.isFinite(cut.radius) && cut.radius >= 0.02 && cut.radius <= 0.8)) {
    throw new Error('Unsupported or invalid composite body solid');
  }
  return solid;
}

function bodySolidDistance(point, solid) {
  let distance = Infinity;
  for (const lobe of solid.lobes) {
    const d = (Math.hypot(...point.map((n, axis) => (n - lobe.center[axis]) / lobe.axes[axis])) - 1)
      * Math.min(...lobe.axes);
    const h = Math.max(solid.blend - Math.abs(distance - d), 0) / solid.blend;
    distance = Math.min(distance, d) - h * h * solid.blend / 4;
  }
  for (const cut of solid.cuts) {
    distance = Math.max(distance, cut.radius - Math.hypot(...point.map((n, axis) => n - cut.center[axis])));
  }
  return distance;
}

function bodySolidRadius(direction, solid) {
  const bound = bodySolidBound(solid);
  let outer = bound;
  for (let step = 1; step <= 128; step++) {
    const inner = bound * (1 - step / 128);
    if (bodySolidDistance(direction.map((n) => n * inner), solid) <= 0) {
      let a = inner, b = outer;
      for (let iteration = 0; iteration < 24; iteration++) {
        const mid = (a + b) / 2;
        if (bodySolidDistance(direction.map((n) => n * mid), solid) <= 0) a = mid;
        else b = mid;
      }
      return (a + b) / 2;
    }
    outer = inner;
  }
  throw new Error('Composite body has no surface in the requested direction');
}

function bodySolidBound(solid) {
  return Math.max(...solid.lobes.map((lobe) => {
    const max = Math.max(...lobe.axes), min = Math.min(...lobe.axes);
    return Math.hypot(...lobe.center) + max
      + solid.blend * Math.max(1, (solid.lobes.length - 1) * max / (4 * min));
  }));
}

function validateBodyGeology(geology) {
  if (geology?.version !== 1 || !Number.isFinite(geology.erosion) || geology.erosion < 0 || geology.erosion > 1
      || !Number.isFinite(geology.tectonics) || geology.tectonics < 0 || geology.tectonics > 1
      || !Array.isArray(geology.craters) || geology.craters.length > 64
      || !geology.craters.every((crater) => Array.isArray(crater.direction) && crater.direction.length === 3
        && crater.direction.every(Number.isFinite) && Math.abs(Math.hypot(...crater.direction) - 1) < 1e-6
        && Number.isFinite(crater.angular_radius) && crater.angular_radius >= 0.005 && crater.angular_radius <= 0.5
        && Number.isFinite(crater.depth_km) && crater.depth_km >= 0 && crater.depth_km <= 100)) {
    throw new Error('Unsupported or invalid body geology');
  }
  return geology;
}

function validateTerrainRegions(regions, radiusKm = Infinity) {
  if (regions?.type !== 'FeatureCollection' || !Array.isArray(regions.features) || regions.features.length > 8) {
    throw new Error('Unsupported or invalid terrain GeoJSON FeatureCollection');
  }
  let vertexCount = 0;
  const features = regions.features.map((feature) => {
    if (feature?.type !== 'Feature' || !feature.geometry || typeof feature.geometry !== 'object'
        || (feature.properties !== undefined && (!feature.properties || typeof feature.properties !== 'object'
          || Array.isArray(feature.properties)))) {
      throw new Error('Unsupported or invalid terrain GeoJSON feature');
    }
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' ? coordinates : null;
    if (!Array.isArray(polygons) || polygons.length < 1 || polygons.length > 8) {
      throw new Error('Terrain GeoJSON supports Polygon and MultiPolygon only');
    }
    const normalized = polygons.map((polygon) => {
      if (!Array.isArray(polygon) || polygon.length < 1 || polygon.length > 8) {
        throw new Error('Invalid terrain GeoJSON polygon rings');
      }
      return polygon.map((ring) => {
        if (!Array.isArray(ring) || ring.length < 4 || ring.length > 129) {
          throw new Error('Invalid terrain GeoJSON ring');
        }
        const points = ring.map((point) => {
          if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
              || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) {
            throw new Error('Invalid terrain GeoJSON longitude/latitude');
          }
          return [point[0], point[1]];
        });
        const first = points[0], last = points[points.length - 1];
        if (Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) {
          throw new Error('Terrain GeoJSON rings must be closed');
        }
        for (let index = 0; index < points.length - 1; index++) {
          const arc = angularDistance(geoVector(points[index]), geoVector(points[index + 1]));
          if (arc < 1e-12 || arc >= Math.PI - 1e-8) {
            throw new Error('Terrain GeoJSON ring has a degenerate or antipodal edge');
          }
        }
        vertexCount += points.length - 1;
        if (vertexCount > 256) throw new Error('Terrain GeoJSON exceeds the 256-vertex budget');
        return points;
      });
    });
    const properties = feature.properties || {};
    const material = properties.material ?? null;
    const color = properties.color ?? null;
    if ((material !== null && !['water', 'ice', 'rock', 'lava', 'custom'].includes(material))
        || (color !== null && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)))) {
      throw new Error('Invalid terrain region material or color');
    }
    if (material === 'custom' && color === null) throw new Error('Custom terrain regions require a color');
    return {
      type: 'Feature',
      properties: {
        height_offset_km: properties.height_offset_km ?? 0,
        transition_km: properties.transition_km ?? 0.25,
        material: material ?? (color === null ? null : 'custom'),
        color: color?.toUpperCase() ?? null,
      },
      geometry: { type, coordinates: type === 'Polygon' ? normalized[0] : normalized },
    };
  });
  let totalOffset = 0;
  for (const feature of features) {
    const { height_offset_km: offset, transition_km: transition } = feature.properties;
    if (!Number.isFinite(offset) || offset < -100 || offset > 100
        || !Number.isFinite(transition) || transition < 0 || transition > 2000) {
      throw new Error('Terrain region values must be finite and within bounds');
    }
    totalOffset += Math.abs(offset);
  }
  if (Number.isFinite(radiusKm) && totalOffset > Math.min(100, radiusKm * 0.05)) {
    throw new Error('Terrain GeoJSON height offsets exceed the body-scale budget');
  }
  return { type: 'FeatureCollection', features };
}

function geoVector(coordinate) {
  const longitude = coordinate[0] * Math.PI / 180, latitude = coordinate[1] * Math.PI / 180;
  const cosLatitude = Math.cos(latitude);
  return [cosLatitude * Math.cos(longitude), Math.sin(latitude), cosLatitude * Math.sin(longitude)];
}

function ringContains(ring, point) {
  let winding = 0;
  const vertices = ring.slice(0, -1).map(geoVector);
  const origin = vertices[0];
  const dot = (left, right) => left.reduce((sum, value, axis) => sum + value * right[axis], 0);
  let area = 0;
  for (let index = 1; index < vertices.length - 1; index++) {
    const a = vertices[index], b = vertices[index + 1];
    const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    area += 2 * Math.atan2(dot(origin, cross), 1 + dot(origin, a) + dot(a, b) + dot(b, origin));
  }
  for (let index = 0; index < ring.length - 1; index++) {
    const a = geoVector(ring[index]), b = geoVector(ring[index + 1]);
    const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    winding += Math.atan2(dot(point, cross), dot(a, b) - dot(point, a) * dot(point, b));
  }
  return Math.abs(winding) > Math.PI && winding * area > 0;
}

function angularDistance(a, b) {
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(...cross), a.reduce((sum, value, axis) => sum + value * b[axis], 0));
}

function ringDistance(ring, point) {
  let minimum = Math.PI;
  for (let index = 0; index < ring.length - 1; index++) {
    const a = geoVector(ring[index]), b = geoVector(ring[index + 1]);
    const arc = angularDistance(a, b);
    minimum = Math.min(minimum, angularDistance(point, a), angularDistance(point, b));
    const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const normalLength = Math.hypot(...normal);
    if (normalLength < 1e-12) continue;
    const unit = normal.map((value) => value / normalLength);
    const along = point.reduce((sum, value, axis) => sum + value * unit[axis], 0);
    const projection = point.map((value, axis) => value - unit[axis] * along);
    const length = Math.hypot(...projection);
    if (length < 1e-12) continue;
    const candidate = projection.map((value) => value / length);
    for (const projected of [candidate, candidate.map((value) => -value)]) {
      if (angularDistance(a, projected) + angularDistance(projected, b) <= arc + 1e-8) {
        minimum = Math.min(minimum, angularDistance(point, projected));
      }
    }
  }
  return minimum;
}

function terrainRegionCoverages(regions, direction, radiusKm) {
  if (!regions?.features?.length) return [];
  const length = Math.hypot(...direction);
  if (length < 1e-12 || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new Error('Terrain region sampling requires a direction and positive radius');
  }
  const point = direction.map((value) => value / length);
  return regions.features.map((feature) => {
    let best = 0;
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      let inside = ringContains(polygon[0], point);
      let distance = ringDistance(polygon[0], point);
      for (const hole of polygon.slice(1)) {
        if (ringContains(hole, point)) inside = false;
        distance = Math.min(distance, ringDistance(hole, point));
      }
      const signedDistance = (inside ? 1 : -1) * distance * radiusKm;
      const transition = feature.properties.transition_km;
      const t = transition > 0 ? bounded(signedDistance / transition + 0.5, 0, 1) : Number(inside);
      best = Math.max(best, t * t * (3 - 2 * t));
    }
    return best;
  });
}

function terrainRegionVisual(regions, direction, radiusKm) {
  if (!regions?.features?.length) return null;
  const coverages = terrainRegionCoverages(regions, direction, radiusKm);
  let selected = -1;
  for (let index = 0; index < coverages.length; index++) {
    if (regions.features[index].properties.material && coverages[index] > (selected < 0 ? 0 : coverages[selected])) {
      selected = index;
    }
  }
  if (selected < 0) return null;
  const { material, color } = regions.features[selected].properties;
  const palette = { water: '#12477D', ice: '#B8DAE5', rock: '#66635E', lava: '#F53D09' };
  const hex = color || palette[material];
  return {
    weight: coverages[selected],
    color: [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255),
  };
}

function bodyGeologicalHeight(manifest, direction) {
  if (manifest.biome === 'gas') return 0;
  const [x, y, z] = direction;
  const seed = manifest.seed % 100000 / 1000;
  const geology = manifest.geology;
  const erosion = geology?.erosion || 0;
  const broad = Math.sin(x * 19 + seed + Math.sin(z * 11)) * Math.cos(z * 17 - seed + y * 9);
  const ridge = (1 - Math.abs(Math.sin(x * 41 + z * 29 + y * 31 + seed))) ** 3;
  const detail = Math.sin(x * 173 + y * 97 + seed) * Math.cos(z * 157 - y * 79);
  let height = bounded(broad * 0.6 + ridge * 0.32 + detail * 0.06 * (1 - erosion)
    - (manifest.biome === 'ocean' ? 0.4 : 0.1), -1, 1) * manifest.amplitude_km;
  if (geology) {
    const plate = Math.sin(x * 5 + seed) * Math.cos(z * 4 - seed + y * 3);
    height += manifest.amplitude_km * geology.tectonics * 0.35 * ((1 - Math.abs(plate)) ** 8 - 0.15);
    for (const crater of geology.craters) {
      const q = Math.acos(bounded(direction.reduce((sum, n, axis) => sum + n * crater.direction[axis], 0), -1, 1))
        / crater.angular_radius;
      if (q < 1.6) {
        const bowl = -(Math.max(0, 1 - q * q) ** 2);
        const rim = 0.25 * Math.exp(-(((q - 1) / 0.16) ** 2));
        height += (bowl + rim) * crater.depth_km * (1 - erosion * 0.85);
      }
    }
  }
  for (const [index, coverage] of terrainRegionCoverages(manifest.regions, direction, manifest.radius_km).entries()) {
    height += manifest.regions.features[index].properties.height_offset_km * coverage;
  }
  return height;
}

function buildTerrainRegionSphereMesh(manifest, rows = 32, columns = 64) {
  if (!Number.isInteger(rows) || rows < 8 || rows > 128 || !Number.isInteger(columns) || columns < 16 || columns > 256) {
    throw new Error('Terrain region sphere resolution is outside supported bounds');
  }
  const grid = Array.from({ length: rows + 1 }, (_, row) => {
    const latitude = row / rows * Math.PI - Math.PI / 2;
    return Array.from({ length: columns + 1 }, (_, column) => {
      const longitude = column / columns * Math.PI * 2;
      const direction = [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
      const radius = bodyShapeFactor(direction, manifest.shape) + bodyGeologicalHeight(manifest, direction) / manifest.radius_km;
      const region = terrainRegionVisual(manifest.regions, direction, manifest.radius_km);
      return [
        ...direction.map((value) => value * radius),
        ...(region?.color || [0, 0, 0]),
        region?.weight || 0,
      ];
    });
  });
  const vertices = new Float32Array(rows * columns * 6 * 7);
  let offset = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const corners = [
        grid[row][column], grid[row + 1][column], grid[row][column + 1],
        grid[row][column + 1], grid[row + 1][column], grid[row + 1][column + 1],
      ];
      for (const point of corners) {
        vertices.set(point, offset);
        offset += 7;
      }
    }
  }
  return { vertices, vertexCount: vertices.length / 7 };
}

function compositeSurfaceDistance(point, manifest, terrain = null) {
  const length = Math.hypot(...point);
  const direction = length > 1e-10 ? point.map((n) => n / length) : [0, 1, 0];
  let height = bodyGeologicalHeight(manifest, direction);
  if (terrain) {
    const local = bodyFrameDirection(direction, terrain.shape?.frame, true);
    const angle = Math.acos(bounded(local[1], -1, 1));
    const horizontal = Math.hypot(local[0], local[2]);
    const x = horizontal > 1e-8 ? local[0] / horizontal * angle * terrain.radius : 0;
    const z = horizontal > 1e-8 ? local[2] / horizontal * angle * terrain.radius : 0;
    height = gradePersistentHeight(manifest, terrain, x, z, height) / terrain.radius * manifest.radius_km;
    const footprint = terrain.shelter?.radius || Math.hypot(terrain.width * 0.5 + 2, terrain.depth * 0.5 + 2);
    if (Math.hypot(x, z) < footprint * 1.4) {
      const t = bounded((Math.hypot(x, z) / footprint - 1) / 0.4, 0, 1);
      const blend = t * t * (3 - 2 * t);
      const radial = length - bodySolidRadius(direction, manifest.solid) - height / manifest.radius_km;
      return radial * (1 - blend) + (bodySolidDistance(point, manifest.solid) - height / manifest.radius_km) * blend;
    }
  }
  return bodySolidDistance(point, manifest.solid) - height / manifest.radius_km;
}

function buildCompositeBodyMesh(manifest, pixels = 300, terrain = null, focus = [0, 1, 0]) {
  validateBodySolid(manifest.solid);
  const bound = bodySolidBound(manifest.solid) + Math.max(Math.abs(manifest.height_min_km), Math.abs(manifest.height_max_km)) / manifest.radius_km;
  const tetrahedra = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];
  const vertices = [];
  const evaluate = (p) => compositeSurfaceDistance(p, manifest, terrain);
  const segments = pixels < 100 ? 24 : terrain ? 32 : 48;
  const side = segments + 1;
  const focalRadius = terrain ? bodySolidRadius(focus, manifest.solid) : 0;
  const power = terrain ? bounded(Math.log(Math.max(segments / 2, pixels)) / Math.log(segments / 2), 1, 4.5) : 1;
  // A shared warped grid concentrates samples near the colony without octree T-junctions.
  const axes = focus.map((component) => {
    const center = component * focalRadius;
    return Array.from({ length: side }, (_, index) => {
      const t = index / segments * 2 - 1;
      return center + Math.sign(t) * (t < 0 ? bound + center : bound - center) * Math.abs(t) ** power;
    });
  });
  const points = [], distances = new Float64Array(side ** 3);
  const address = (x, y, z) => (z * side + y) * side + x;
  for (let z = 0; z < side; z++) for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const index = address(x, y, z);
    points[index] = [axes[0][x], axes[1][y], axes[2][z]];
    distances[index] = evaluate(points[index]);
  }
  const intersections = new Map();
  const edge = (a, b) => {
    if (a > b) [a, b] = [b, a];
    const key = a * side ** 3 + b;
    if (intersections.has(key)) return intersections.get(key);
    let low = 0, high = 1;
    const negative = distances[a] <= 0;
    for (let iteration = 0; iteration < 16; iteration++) {
      const t = (low + high) / 2;
      const point = points[a].map((n, axis) => n + (points[b][axis] - n) * t);
      if ((evaluate(point) <= 0) === negative) low = t;
      else high = t;
    }
    const point = points[a].map((n, axis) => n + (points[b][axis] - n) * (low + high) / 2);
    intersections.set(key, point);
    return point;
  };
  const append = (points) => {
    const a = points[0], b = points[1], c = points[2];
    const ab = b.map((n, axis) => n - a[axis]), ac = c.map((n, axis) => n - a[axis]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...cross) === 0) return;
    const mid = a.map((n, axis) => (n + b[axis] + c[axis]) / 3);
    const epsilon = 0.00001;
    const gradient = [0, 1, 2].map((axis) => evaluate(mid.map((n, i) => n + (i === axis ? epsilon : 0)))
      - evaluate(mid.map((n, i) => n - (i === axis ? epsilon : 0))));
    if (cross.reduce((sum, n, axis) => sum + n * gradient[axis], 0) < 0) points = [a, c, b];
    for (const point of points) vertices.push(...point);
  };
  for (let z = 0; z < segments; z++) for (let y = 0; y < segments; y++) for (let x = 0; x < segments; x++) {
    const corners = Array.from({ length: 8 }, (_, index) => address(x + (index & 1), y + ((index >> 1) & 1), z + ((index >> 2) & 1)));
    if (corners.every((i) => distances[i] <= 0) || corners.every((i) => distances[i] > 0)) continue;
    for (const tetra of tetrahedra) {
      const indices = tetra.map((i) => corners[i]);
      const inside = indices.filter((i) => distances[i] <= 0), outside = indices.filter((i) => distances[i] > 0);
      if (inside.length === 1) append(outside.map((i) => edge(inside[0], i)));
      else if (inside.length === 3) append(inside.map((i) => edge(i, outside[0])));
      else if (inside.length === 2) {
        const [a, b] = inside, [c, d] = outside;
        const ac = edge(a, c), ad = edge(a, d), bc = edge(b, c), bd = edge(b, d);
        append([ac, ad, bc]); append([bc, ad, bd]);
      }
    }
  }
  if (!vertices.length) throw new Error('Composite body meshing produced no surface');
  if (vertices.length / 3 * 28 > 8 * 1024 * 1024) throw new Error('Composite body mesh exceeds geometry budget');
  return { vertices: new Float32Array(vertices), vertexCount: vertices.length / 3 };
}

function multiplyMatrix(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

function projectCityPoint(matrix, x, y, z) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [0, 1, 2].map((row) =>
    (matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row]) / w);
}

function validateBodyShape(shape) {
  if (!shape || shape.version !== 1 || !Array.isArray(shape.axes) || shape.axes.length !== 3
      || !shape.axes.every((axis) => Number.isFinite(axis) && axis >= 0.5 && axis <= 2)
      || !Number.isFinite(shape.deformation) || shape.deformation < 0 || shape.deformation > 0.35) {
    throw new Error('Unsupported or invalid body shape');
  }
  return shape;
}

function bodyShapeFactor(direction, shape) {
  if (!shape) return 1;
  direction = bodyFrameDirection(direction, shape.frame);
  if (shape.solid) return bodySolidRadius(direction, shape.solid);
  const [x, y, z] = direction;
  const wave = 0.6 * (x * x - y * y) + 0.4 * x * z;
  return (1 + shape.deformation * wave) / Math.hypot(...direction.map((n, axis) => n / shape.axes[axis]));
}

function bodyFrameDirection(direction, frame, inverse = false) {
  if (!frame) return direction;
  return inverse
    ? frame.map((axis) => axis.reduce((sum, value, index) => sum + value * direction[index], 0))
    : direction.map((_, index) => frame.reduce((sum, axis, component) => sum + axis[index] * direction[component], 0));
}

function settlementFrame(direction) {
  const length = Math.hypot(direction[1], direction[0]);
  const east = length > 1e-8 ? [direction[1] / length, -direction[0] / length, 0] : [1, 0, 0];
  const north = [
    east[1] * direction[2] - east[2] * direction[1],
    east[2] * direction[0] - east[0] * direction[2],
    east[0] * direction[1] - east[1] * direction[0],
  ];
  return [east, direction, north];
}

function applyTerrainSettlement(terrain, manifest) {
  const site = manifest.settlement;
  terrain.radius = manifest.radius_km * 1000 / COLONY_METERS_PER_UNIT;
  terrain.shape = { ...(manifest.shape || { version: 1, axes: [1, 1, 1], deformation: 0 }) };
  if (manifest.solid) terrain.shape.solid = manifest.solid;
  terrain.manifest = manifest;
  terrain.shelter = null;
  const pole = site?.direction || [0, 1, 0];
  const rawHeight = bodyGeologicalHeight(manifest, pole);
  const floor = site?.floor_height_km ?? rawHeight;
  terrain.groundHeight = (['terran', 'ocean', 'lava'].includes(manifest.biome) ? Math.max(0, floor) : floor)
    / manifest.radius_km * terrain.radius;
  if (site) {
    terrain.shape.frame = settlementFrame(site.direction);
    const radius = Math.hypot(terrain.width * 0.5 + 2, terrain.depth * 0.5 + 2);
    terrain.shelter = {
      radius, height: radius * site.dome_height_ratio,
      floor: terrain.groundHeight,
    };
  }
  terrain.collisionRelief = manifest.amplitude_km / manifest.radius_km * terrain.radius;
}

function colonyDomeHeight(shelter, parts) {
  if (!shelter) return 0;
  return Math.max(shelter.height, ...parts.map((part) => {
    const distance = Math.hypot(Math.abs(part.x) + part.sx * 0.5, Math.abs(part.z) + part.sz * 0.5);
    if (distance >= shelter.radius) throw new Error('Colony footprint exceeds the pressure dome');
    return (part.y + part.sy + 0.8) / Math.sqrt(1 - (distance / shelter.radius) ** 2);
  }));
}

function bodyGroundPoint(radius, x, z, shape) {
  const safeRadius = Math.max(0.001, Number(radius) || 0.001);
  const distance = Math.hypot(x, z);
  const angle = distance / safeRadius;
  const tangentScale = distance > 0.0001 ? Math.sin(angle) / distance : 0;
  const normal = [x * tangentScale, Math.cos(angle), z * tangentScale];
  const radial = safeRadius * bodyShapeFactor(normal, shape);
  return [normal[0] * radial,
    -2 * Math.sin(angle / 2) ** 2 * radial + radial - bodyCenterRadius(safeRadius, shape),
    normal[2] * radial];
}

function bodyCenterRadius(radius, shape) {
  return shape?.frame ? radius * bodyShapeFactor([0, 1, 0], shape) : radius;
}

function bodySurfaceNormal(radius, x, z, shape) {
  radius = Math.max(0.001, Number(radius) || 0.001);
  if (!shape || (shape.deformation === 0 && shape.axes.every((axis) => axis === 1))) {
    const point = bodyGroundPoint(radius, x, z);
    return [point[0] / radius, (point[1] + radius) / radius, point[2] / radius];
  }
  const epsilon = Math.max(radius * 0.0001, 0.001);
  const difference = (a, b) => a.map((value, axis) => value - b[axis]);
  const east = difference(bodyGroundPoint(radius, x + epsilon, z, shape), bodyGroundPoint(radius, x - epsilon, z, shape));
  const north = difference(bodyGroundPoint(radius, x, z + epsilon, shape), bodyGroundPoint(radius, x, z - epsilon, shape));
  let normal = [north[1] * east[2] - north[2] * east[1], north[2] * east[0] - north[0] * east[2], north[0] * east[1] - north[1] * east[0]];
  const length = Math.hypot(...normal);
  if (length < 1e-10) {
    const point = bodyGroundPoint(radius, x, z, shape);
    normal = [point[0], point[1] + bodyCenterRadius(radius, shape), point[2]];
  }
  const norm = Math.hypot(...normal);
  const ground = bodyGroundPoint(radius, x, z, shape);
  const radial = [ground[0], ground[1] + bodyCenterRadius(radius, shape), ground[2]];
  const sign = normal.reduce((sum, value, axis) => sum + value * radial[axis], 0) < 0 ? -1 : 1;
  return normal.map((value) => value / norm * sign);
}

function mapColonySurfacePoint(radius, x, y, z, terrain = null) {
  radius = Math.max(0.001, Number(radius) || 0.001);
  const point = bodyGroundPoint(radius, x, z, terrain?.shape);
  if (terrain) {
    const height = sampleColonyTerrain(terrain, x, z).height;
    const radial = [point[0], point[1] + bodyCenterRadius(radius, terrain.shape), point[2]];
    const length = Math.hypot(...radial);
    point.forEach((value, axis) => { point[axis] = value + radial[axis] / length * height; });
  }
  if (y === 0) return point;
  const normal = bodySurfaceNormal(radius, x, z, terrain?.shape);
  return point.map((value, axis) => value + normal[axis] * y);
}

function constrainBodyCamera(start, end, radius, terrain, clearance = 0.35) {
  const shape = terrain?.shape;
  if (!shape) return end;
  const relief = terrain.collisionRelief || 0;
  const centerRadius = bodyCenterRadius(radius, shape);
  const localRelief = (direction) => {
    const angle = Math.acos(bounded(direction[1], -1, 1));
    const horizontal = Math.hypot(direction[0], direction[2]);
    const x = horizontal > 1e-8 ? direction[0] / horizontal * angle * radius : 0;
    const z = horizontal > 1e-8 ? direction[2] / horizontal * angle * radius : 0;
    if (Math.hypot(x, z) <= (terrain.shelter?.radius || Math.min(terrain.width, terrain.depth) * 0.5)) {
      return terrain.groundHeight || 0;
    }
    return terrain.heightSampler?.(x, z) ?? relief;
  };
  const gap = (point) => {
    const radial = [point[0], point[1] + centerRadius, point[2]];
    if (shape.solid) {
      const global = bodyFrameDirection(radial.map((n) => n / radius), shape.frame);
      return compositeSurfaceDistance(global, terrain.manifest, terrain) * radius - clearance;
    }
    const length = Math.hypot(...radial);
    if (length < 1e-10) return -radius;
    const direction = radial.map((value) => value / length);
    return length - radius * bodyShapeFactor(direction, shape) - localRelief(direction) - clearance;
  };
  const project = (point) => {
    if (shape.solid) {
      let candidate = point.slice();
      for (let iteration = 0; iteration < 32; iteration++) {
        const distance = gap(candidate);
        if (distance >= 0.005) return candidate;
        const epsilon = 0.01;
        const gradient = [0, 1, 2].map((axis) => gap(candidate.map((n, i) => n + (i === axis ? epsilon : 0)))
          - gap(candidate.map((n, i) => n - (i === axis ? epsilon : 0))));
        const length = Math.hypot(...gradient);
        if (length < 1e-10) throw new Error('Cannot resolve composite body camera collision');
        candidate = candidate.map((n, axis) => n + gradient[axis] / length * (0.01 - distance));
      }
      throw new Error('Composite body camera collision did not converge');
    }
    const radial = [point[0], point[1] + centerRadius, point[2]];
    const length = Math.hypot(...radial);
    const direction = length > 1e-10 ? radial.map((value) => value / length) : [0, 1, 0];
    const limit = radius * bodyShapeFactor(direction, shape) + localRelief(direction) + clearance + 0.01;
    return direction.map((value, axis) => value * limit - (axis === 1 ? centerRadius : 0));
  };
  const destination = gap(end) < 0 ? project(end) : end;
  if (!start || gap(start) < 0) return destination;
  const delta = destination.map((value, axis) => value - start[axis]);
  const distance = Math.hypot(...delta);
  if (distance < 1e-8) return destination;
  let travel = 0;
  let point = start.slice();
  // The supported axis/deformation bounds permit a conservative radial-field step.
  for (let step = 0; step < 512 && travel < distance; step++) {
    const available = gap(point);
    if (available < 0.005) return point;
    travel = Math.min(distance, travel + Math.max(0.001, available / 16));
    point = start.map((value, axis) => value + delta[axis] * travel / distance);
  }
  return point;
}

function projectColonySurfacePoint(matrix, radius, x, y, z, terrain = null) {
  const point = mapColonySurfacePoint(radius, x, y, z, terrain);
  return projectCityPoint(matrix, point[0], point[1], point[2]);
}

function resolveBodySurface(data, cityWidth, cityDepth) {
  const colony = data?.colony || {};
  const body = { ...colony, ...(data?.focusPlanet || data?.planet || colony?.body || {}) };
  const layout = data?.layout || colony?.layout || {};
  const diameter = Number(
    body?.diameter_km ?? body?.diameter ?? body?.planet_diameter
      ?? layout?.planet_scale?.diameter ?? 0
  );
  const citySpan = Math.max(cityWidth, cityDepth, 1);
  const kind = String(body?.planet_class || body?.planet_type || body?.body_type || '').toLowerCase();
  const estimatedRadius = !Number.isFinite(diameter) || diameter <= 0;
  const fallbackDiameter = /comet|asteroid/.test(`${body?.body_type || ''} ${kind}`) ? 12
    : /moon/.test(`${body?.body_type || ''} ${kind}`) ? 3474 : 3000;
  const radius = Number.isFinite(diameter) && diameter > 0
    ? diameter * 500 / COLONY_METERS_PER_UNIT : fallbackDiameter * 500 / COLONY_METERS_PER_UNIT;
  const tint = /ice|frost|tundra/.test(kind) ? [0.35, 0.58, 0.72]
    : /lava|volcan|molten/.test(kind) ? [0.66, 0.29, 0.18]
      : /desert|arid|barren/.test(kind) ? [0.64, 0.48, 0.29]
        : /gas|jovian/.test(kind) ? [0.43, 0.42, 0.66]
          : /moon|comet|asteroid/.test(kind) ? [0.48, 0.51, 0.49]
            : [0.25, 0.42, 0.29];
  const atmosphereType = String(body?.atmosphere_type ?? colony?.atmosphere_type ?? '').toLowerCase();
  const hasAtmosphere = body?.has_atmosphere ?? colony?.has_atmosphere;
  const explicitAbsence = hasAtmosphere === false || hasAtmosphere === 0 || hasAtmosphere === '0'
    || /^(none|vacuum|airless)$/.test(atmosphereType);
  const airlessFallback = !atmosphereType && hasAtmosphere == null
    && /moon|comet|asteroid|barren/.test(`${body?.body_type || ''} ${kind}`);
  const atmosphere = {
    strength: explicitAbsence || airlessFallback ? 0 : /thin|trace/.test(atmosphereType) ? 0.4 : 1,
    coverage: bounded(body?.cloud_coverage ?? colony?.cloud_coverage, 0, 1, 0.65),
    color: /lava|volcan|molten|desert|arid/.test(kind) ? [0.65, 0.47, 0.34] : [0.4, 0.65, 0.9],
  };
  const identity = body?.terrain_seed ?? body?.seed ?? body?.body_id ?? body?.planet_id ?? body?.id ?? colony?.id ?? kind;
  let seed = 2166136261;
  for (const character of String(identity)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const biome = /gas|jovian|jupiter|ice_giant/.test(kind) ? 'gas'
    : /ice|frost|tundra|comet/.test(kind) ? 'ice'
      : /lava|volcan|molten/.test(kind) ? 'lava'
        : /desert|arid/.test(kind) ? 'desert'
          : /ocean|water/.test(kind) ? 'ocean'
            : /moon|asteroid|barren|rock/.test(kind) ? 'rock' : 'terran';
  const terrain = {
    seed: seed / 4294967296 * 100,
    biome, radius, width: cityWidth, depth: cityDepth,
    scale: Math.max(12, citySpan * 1.8),
    amplitude: Math.min(radius * 0.08, Math.max(2, citySpan * 0.4)),
  };
  return { radius, estimatedRadius, kind: kind || 'planet', tint, atmosphere, terrain };
}

function sampleColonyTerrain(terrain, x, z) {
  if (terrain.heightSampler) {
    const height = terrain.heightSampler(x, z);
    if (height != null) return { height, elevation: height, material: 0, color: [0.24, 0.42, 0.21] };
  }
  if (terrain.shelter && Math.hypot(x, z) <= terrain.shelter.radius) {
    return { height: terrain.shelter.floor, elevation: terrain.shelter.floor, material: 2, color: [0.72, 0.85, 0.91] };
  }
  if (terrain.groundHeight != null
      && Math.abs(x) <= terrain.width * 0.5 + 2 && Math.abs(z) <= terrain.depth * 0.5 + 2) {
    return { height: terrain.groundHeight, elevation: terrain.groundHeight, material: 0, color: [0.4, 0.39, 0.37] };
  }
  if (terrain.biome === 'gas') {
    const band = Math.sin(z / terrain.scale * 14 + terrain.seed) * 0.1;
    return { height: 0, elevation: 0, material: 0, color: [0.48 + band, 0.42 + band, 0.58 + band] };
  }
  const p = x / terrain.scale;
  const q = z / terrain.scale;
  const seed = terrain.seed;
  const broad = Math.sin(p * 2.7 + seed + Math.sin(q * 1.8))
    * Math.cos(q * 2.3 - seed * 0.7 + Math.sin(p * 1.2));
  const ridge = (1 - Math.abs(Math.sin(p * 5.1 + q * 2.8 + seed))) ** 3;
  const fine = Math.sin(p * 19.7 + seed) * Math.cos(q * 17.1 - seed);
  const raw = broad * 0.65 + ridge * 0.45 + fine * 0.06
    - (terrain.biome === 'ocean' ? 0.42 : 0.12);
  const edge = Math.max(Math.abs(x) - terrain.width * 0.5 - 2, Math.abs(z) - terrain.depth * 0.5 - 2);
  const blend = bounded(edge / (terrain.scale * 0.2), 0, 1);
  const grading = blend * blend * (3 - 2 * blend);
  const elevation = raw * terrain.amplitude * grading;
  const liquid = ['terran', 'ocean', 'lava'].includes(terrain.biome);
  const wet = liquid && elevation < -0.5;
  const frozen = terrain.biome === 'ice' || (terrain.biome === 'terran' && elevation > terrain.amplitude * 0.55);
  const material = wet ? terrain.biome === 'lava' ? 3 : 1 : frozen ? 2 : 0;
  const base = material === 1 ? [0.07, 0.28, 0.44]
    : material === 2 ? [0.72, 0.85, 0.91]
      : material === 3 ? [0.96, 0.24, 0.035]
        : terrain.biome === 'desert' ? [0.67, 0.46, 0.24]
          : terrain.biome === 'lava' ? [0.24, 0.19, 0.18]
            : terrain.biome === 'rock' ? [0.4, 0.39, 0.37]
              : [0.24, 0.42, 0.21];
  const rock = material === 0 ? bounded(elevation / terrain.amplitude, 0, 1) * 0.6 : 0;
  return {
    height: wet ? -0.5 : elevation,
    elevation, material,
    color: base.map((value, axis) => value * (1 - rock) + [0.48, 0.46, 0.42][axis] * rock),
  };
}

function selectColonyTerrainLod(projectedScale, previous = null) {
  const thresholds = [120, 400, 1400];
  if (!Number.isFinite(projectedScale) || projectedScale <= 0) return 0;
  if (previous == null) return thresholds.filter((threshold) => projectedScale >= threshold).length;
  let lod = bounded(previous, 0, TERRAIN_LODS.length - 1);
  while (lod < thresholds.length && projectedScale >= thresholds[lod] * 1.15) lod++;
  while (lod > 0 && projectedScale < thresholds[lod - 1] * 0.85) lod--;
  return lod;
}

function buildColonyTerrainMesh(terrain, lod = 2, focus = { x: 0, z: 0 }) {
  const { segments, localRings, distantRings } = TERRAIN_LODS[lod];
  const capAngle = Math.min(1.2, terrain.scale * 3 / terrain.radius);
  const rings = Array.from({ length: localRings + distantRings + 1 }, (_, index) =>
    index <= localRings ? capAngle * index / localRings
      : capAngle + (Math.PI - capAngle) * (index - localRings) / distantRings);
  const vertices = new Float32Array((rings.length - 1) * segments * 6 * 8);
  let offset = 0;
  const focusPoint = mapColonySurfacePoint(terrain.radius, focus.x, 0, focus.z);
  const normal = [focusPoint[0] / terrain.radius, (focusPoint[1] + terrain.radius) / terrain.radius, focusPoint[2] / terrain.radius];
  const eastLength = Math.hypot(normal[1], normal[0]);
  const east = eastLength > 1e-8 ? [normal[1] / eastLength, -normal[0] / eastLength, 0] : [1, 0, 0];
  const north = [
    east[1] * normal[2] - east[2] * normal[1],
    east[2] * normal[0] - east[0] * normal[2],
    east[0] * normal[1] - east[1] * normal[0],
  ];
  const point = (angle, longitude) => {
    const radial = normal.map((value, axis) => value * Math.cos(angle)
      + (east[axis] * Math.cos(longitude) + north[axis] * Math.sin(longitude)) * Math.sin(angle));
    const globalAngle = Math.acos(bounded(radial[1], -1, 1));
    const horizontal = Math.hypot(radial[0], radial[2]);
    const x = horizontal > 1e-8 ? radial[0] / horizontal * globalAngle * terrain.radius : 0;
    const z = horizontal > 1e-8 ? radial[2] / horizontal * globalAngle * terrain.radius : 0;
    const sample = sampleColonyTerrain(terrain, x, z);
    const position = mapColonySurfacePoint(terrain.radius, x, sample.height, z);
    return [...position, ...sample.color, 0, sample.material];
  };
  let previous = Array.from({ length: segments + 1 }, (_, segment) => point(0, segment / segments * Math.PI * 2));
  for (let ring = 1; ring < rings.length; ring++) {
    const next = Array.from({ length: segments + 1 }, (_, segment) =>
      point(rings[ring], segment / segments * Math.PI * 2));
    for (let segment = 0; segment < segments; segment++) {
      for (const vertex of [previous[segment], next[segment], previous[segment + 1],
        previous[segment + 1], next[segment], next[segment + 1]]) {
        vertices.set(vertex, offset);
        offset += 8;
      }
    }
    previous = next;
  }
  return { vertices, vertexCount: vertices.length / 8 };
}

function cubeSphereDirection(face, u, v) {
  const point = [
    [1, v, -u], [-1, v, u], [u, 1, -v],
    [u, -1, v], [u, v, 1], [-u, v, -1],
  ][face];
  if (!point) throw new Error('Invalid terrain cube face');
  const length = Math.hypot(...point);
  return point.map((value) => value / length);
}

const terrainTileKey = (tile) => `${tile.face}/${tile.lod}/${tile.x}/${tile.y}`;
const terrainRoots = () => Array.from({ length: 6 }, (_, face) => ({ face, lod: 0, x: 0, y: 0 }));
const terrainChildren = (tile) => [0, 1, 2, 3].map((index) => ({
  face: tile.face, lod: tile.lod + 1, x: tile.x * 2 + index % 2, y: tile.y * 2 + Math.floor(index / 2),
}));

function planCubeSphereTiles(manifest, radiusPixels, focus) {
  const leaves = terrainRoots();
  while (leaves.length <= 93) {
    let best = -1, bestScore = 0;
    for (let index = 0; index < leaves.length; index++) {
      const tile = leaves[index];
      const size = 2 ** tile.lod;
      const center = cubeSphereDirection(tile.face, (tile.x + 0.5) / size * 2 - 1, (tile.y + 0.5) / size * 2 - 1);
      const separation = Math.acos(bounded(center.reduce((sum, value, axis) => sum + value * focus[axis], 0), -1, 1));
      const angularSize = 2 / size;
      const near = separation < angularSize * 1.6 + Math.min(Math.PI, 800 / Math.max(1, radiusPixels));
      const score = radiusPixels * angularSize / (1 + Math.max(0, separation - angularSize) * radiusPixels / 800);
      if (tile.lod < manifest.max_lod && radiusPixels * angularSize > 384 && near && score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    if (best < 0) break;
    leaves.splice(best, 1, ...terrainChildren(leaves[best]));
  }
  return leaves;
}

function validateTerrainManifest(manifest) {
  if (manifest?.projection !== 'cube-sphere' || manifest.generator_version !== 1
      || manifest.resolution !== 17 || manifest.tile_encoding !== 'uint16-json'
      || !Number.isSafeInteger(manifest.body_id) || manifest.body_id < 1
      || !Number.isSafeInteger(manifest.seed) || manifest.seed < 0
      || !Number.isInteger(manifest.max_lod) || manifest.max_lod < 0 || manifest.max_lod > 16
      || !Number.isFinite(manifest.radius_km) || manifest.radius_km <= 0
      || !Number.isFinite(manifest.height_min_km) || !Number.isFinite(manifest.height_max_km)
      || manifest.height_min_km >= manifest.height_max_km
      || !Number.isFinite(manifest.amplitude_km) || manifest.amplitude_km <= 0
      || !['terran', 'ocean', 'ice', 'desert', 'lava', 'rock', 'gas'].includes(manifest.biome)) {
    throw new Error('Unsupported or invalid terrain manifest');
  }
  if (manifest.shape) validateBodyShape(manifest.shape);
  if (manifest.solid) validateBodySolid(manifest.solid);
  if (manifest.geology) validateBodyGeology(manifest.geology);
  if (manifest.regions) {
    validateTerrainRegions(manifest.regions, manifest.radius_km);
    if (manifest.biome === 'gas' && manifest.regions.features.length) {
      throw new Error('Gas bodies cannot have terrain GeoJSON regions');
    }
  }
  if (manifest.settlement) {
    const site = manifest.settlement;
    if (site.version !== 1 || site.kind !== 'valley-dome'
        || !Array.isArray(site.direction) || site.direction.length !== 3
        || !site.direction.every(Number.isFinite) || Math.abs(Math.hypot(...site.direction) - 1) > 1e-6
        || !Number.isFinite(site.floor_height_km)
        || site.floor_height_km < manifest.height_min_km || site.floor_height_km > manifest.height_max_km
        || !Number.isFinite(site.dome_height_ratio) || site.dome_height_ratio < 0.3 || site.dome_height_ratio > 1) {
      throw new Error('Unsupported or invalid valley settlement');
    }
  }
  return manifest;
}

class CubeSphereTerrainStream {
  constructor(colonyId, onChange) {
    this.colonyId = colonyId;
    this.onChange = onChange;
    this.manifest = null;
    this.tiles = new Map();
    this.surfaceTiles = new Map();
    this.request = null;
    this.failed = false;
    this.disposed = false;
    this.wanted = terrainRoots();
    this.plan = null;
    this.needed = new Map();
  }

  async load() {
    if (this.disposed || this.request || this.manifest || this.failed) return;
    const request = new AbortController();
    this.request = request;
    this.onChange('Persistent terrain loading; procedural preview');
    try {
      const response = await fetch(`api/terrain.php?action=manifest&colony_id=${this.colonyId}`, {
        credentials: 'same-origin', signal: request.signal, cache: 'no-cache',
      });
      if (!response.ok) throw new Error(`Terrain manifest HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Terrain manifest unavailable');
      if (this.disposed) return;
      this.manifest = validateTerrainManifest(data.manifest);
      this.onChange(this.manifest.solid ? 'Persistent composite terrain ready' : 'Persistent terrain loading');
    } catch (error) {
      if (error.name !== 'AbortError' && !this.disposed) {
        this.failed = true;
        this.onChange(`Terrain unavailable: ${error.message}; procedural preview`);
      }
    } finally {
      if (this.request === request) this.request = null;
    }
  }

  sample(x, z, terrain) {
    if (!this.manifest) return null;
    const point = mapColonySurfacePoint(terrain.radius, x, 0, z);
    const [nx, ny, nz] = bodyFrameDirection([point[0], point[1] + terrain.radius, point[2]], terrain.shape?.frame);
    const max = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    let face, u, v;
    if (Math.abs(nx) === max) { face = nx > 0 ? 0 : 1; u = nx > 0 ? -nz / max : nz / max; v = ny / max; }
    else if (Math.abs(ny) === max) { face = ny > 0 ? 2 : 3; u = nx / max; v = ny > 0 ? -nz / max : nz / max; }
    else { face = nz > 0 ? 4 : 5; u = nz > 0 ? nx / max : -nx / max; v = ny / max; }
    for (let lod = this.manifest.max_lod; lod >= 0; lod--) {
      const size = 2 ** lod;
      const gx = bounded((u + 1) * 0.5 * size, 0, size - 1e-10);
      const gy = bounded((v + 1) * 0.5 * size, 0, size - 1e-10);
      const tile = this.surfaceTiles.get(terrainTileKey({ face, lod, x: Math.floor(gx), y: Math.floor(gy) }));
      if (!tile) continue;
      const sx = (gx - Math.floor(gx)) * 16, sy = (gy - Math.floor(gy)) * 16;
      const col = Math.min(15, Math.floor(sx)), row = Math.min(15, Math.floor(sy));
      const dx = sx - col, dy = sy - row;
      const vertexHeight = (cx, cy) => {
        const vertex = persistedTerrainSample(this.manifest, tile, cx, cy, terrain);
        const direction = cubeSphereDirection(tile.face, (tile.x + cx / 16) / size * 2 - 1, (tile.y + cy / 16) / size * 2 - 1);
        return Math.hypot(vertex[0], vertex[1] + bodyCenterRadius(terrain.radius, terrain.shape), vertex[2])
          - terrain.radius * bodyShapeFactor(direction, this.manifest.shape);
      };
      const a = vertexHeight(col, row), b = vertexHeight(col + 1, row);
      const c = vertexHeight(col, row + 1), d = vertexHeight(col + 1, row + 1);
      return dx + dy <= 1 ? a + (b - a) * dx + (c - a) * dy
        : d + (c - d) * (1 - dx) + (b - d) * (1 - dy);
    }
    return null;
  }

  update(radiusPixels, focus) {
    if (!this.manifest || this.disposed) return [];
    const drift = this.plan ? Math.hypot(...focus.map((value, axis) => value - this.plan.focus[axis])) : Infinity;
    if (!this.plan || radiusPixels > this.plan.radiusPixels * 1.15 || radiusPixels < this.plan.radiusPixels * 0.85
        || drift > Math.min(0.25, 800 / Math.max(1, radiusPixels)) * 0.25) {
      this.wanted = planCubeSphereTiles(this.manifest, radiusPixels, focus);
      this.plan = { radiusPixels, focus: focus.slice() };
    }
    const needed = new Map();
    for (const leaf of this.wanted) {
      let tile = leaf;
      while (true) {
        needed.set(terrainTileKey(tile), tile);
        if (!tile.lod) break;
        tile = { face: tile.face, lod: tile.lod - 1, x: Math.floor(tile.x / 2), y: Math.floor(tile.y / 2) };
      }
    }
    const missing = [...needed.values()].filter((tile) => !this.tiles.has(terrainTileKey(tile)))
      .sort((a, b) => a.lod - b.lod).slice(0, 16);
    if (!this.request && !this.failed && missing.length) this._fetchTiles(missing);
    const desired = new Set(this.wanted.map(terrainTileKey));
    const selected = [];
    const visit = (tile) => {
      if (!this.tiles.has(terrainTileKey(tile))) return;
      const children = terrainChildren(tile);
      if (!desired.has(terrainTileKey(tile)) && needed.has(terrainTileKey(tile))
          && children.every((child) => this.tiles.has(terrainTileKey(child)))) {
        children.forEach(visit);
      } else selected.push(this.tiles.get(terrainTileKey(tile)));
    };
    const roots = terrainRoots();
    if (roots.every((tile) => this.tiles.has(terrainTileKey(tile)))) roots.forEach(visit);
    this.surfaceTiles = new Map(selected.map((tile) => [terrainTileKey(tile), tile]));
    this.needed = needed;
    this._trimCache();
    return selected;
  }

  _trimCache() {
    for (const [key] of this.tiles) {
      if (this.tiles.size <= 256) break;
      if (!this.needed.has(key) && !this.surfaceTiles.has(key)) this.tiles.delete(key);
    }
  }

  async _fetchTiles(addresses) {
    const request = new AbortController();
    this.request = request;
    try {
      const response = await fetch(`api/terrain.php?action=tiles&colony_id=${this.colonyId}&tiles=${encodeURIComponent(JSON.stringify(addresses))}`, {
        credentials: 'same-origin', signal: request.signal, cache: 'no-cache',
      });
      if (!response.ok) throw new Error(`Terrain tiles HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success || !Array.isArray(data.tiles) || data.tiles.length !== addresses.length) {
        throw new Error('Incomplete terrain tile response');
      }
      if (this.disposed) return;
      const expected = new Set(addresses.map(terrainTileKey));
      for (const tile of data.tiles) {
        const key = terrainTileKey(tile);
        if (!expected.delete(key) || !['face', 'lod', 'x', 'y'].every((field) => Number.isInteger(tile[field]))
            || tile.body_id !== this.manifest.body_id
            || tile.generator_version !== this.manifest.generator_version || tile.resolution !== 17
            || !Array.isArray(tile.heights) || tile.heights.length !== 289
            || !tile.heights.every((value) => Number.isInteger(value) && value >= 0 && value <= 65535)) {
          throw new Error('Invalid persisted terrain tile');
        }
      }
      for (const tile of data.tiles) this.tiles.set(terrainTileKey(tile), tile);
      this._trimCache();
      this.onChange('Persistent terrain');
    } catch (error) {
      if (error.name !== 'AbortError' && !this.disposed) {
        this.failed = true;
        const retained = this.surfaceTiles.size ? 'retaining last confirmed surface' : 'procedural preview';
        this.onChange(`Terrain tiles unavailable: ${error.message}; ${retained}`);
      }
    } finally {
      if (this.request === request) this.request = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.request?.abort();
    this.request = null;
    this.tiles.clear();
    this.surfaceTiles.clear();
    this.needed.clear();
  }
}

function gradePersistentHeight(manifest, terrain, x, z, physicalHeight) {
  if (terrain.shelter) {
    const t = bounded((Math.hypot(x, z) / terrain.shelter.radius - 1) / 0.4, 0, 1);
    const grade = t * t * (3 - 2 * t);
    return terrain.shelter.floor * (1 - grade) + physicalHeight / manifest.radius_km * terrain.radius * grade;
  }
  const edge = Math.max(Math.abs(x) - terrain.width * 0.5 - 2, Math.abs(z) - terrain.depth * 0.5 - 2);
  const t = bounded(edge / (terrain.scale * 0.2), 0, 1);
  const grade = t * t * (3 - 2 * t);
  const height = (terrain.groundHeight || 0) * (1 - grade) + physicalHeight / manifest.radius_km * terrain.radius * grade;
  return ['terran', 'ocean', 'lava'].includes(manifest.biome) ? Math.max(0, height) : height;
}

function persistedTerrainSample(manifest, tile, col, row, terrain) {
  const size = 2 ** tile.lod;
  const global = cubeSphereDirection(tile.face, (tile.x + col / 16) / size * 2 - 1, (tile.y + row / 16) / size * 2 - 1);
  const direction = bodyFrameDirection(global, terrain.shape?.frame, true);
  const angle = Math.acos(bounded(direction[1], -1, 1));
  const horizontal = Math.hypot(direction[0], direction[2]);
  const x = horizontal > 1e-8 ? direction[0] / horizontal * angle * terrain.radius : angle * terrain.radius;
  const z = horizontal > 1e-8 ? direction[2] / horizontal * angle * terrain.radius : 0;
  const physicalHeight = manifest.biome === 'gas' ? 0 : manifest.height_min_km + tile.heights[row * 17 + col] / 65535
    * (manifest.height_max_km - manifest.height_min_km);
  const edge = Math.max(Math.abs(x) - terrain.width * 0.5 - 2, Math.abs(z) - terrain.depth * 0.5 - 2);
  const t = bounded(edge / (terrain.scale * 0.2), 0, 1);
  const grade = t * t * (3 - 2 * t);
  const height = physicalHeight / manifest.radius_km * terrain.radius * grade;
  const wet = ['terran', 'ocean', 'lava'].includes(manifest.biome) && height < -0.00001;
  const frozen = manifest.biome === 'ice' || (manifest.biome === 'terran' && physicalHeight > manifest.amplitude_km * 0.55);
  const material = wet ? manifest.biome === 'lava' ? 3 : 1 : frozen ? 2 : 0;
  const band = manifest.biome === 'gas' ? Math.sin(direction[1] * 40 + manifest.seed % 100) * 0.1 : 0;
  let color = material === 1 ? [0.07, 0.28, 0.44] : material === 2 ? [0.72, 0.85, 0.91]
    : material === 3 ? [0.96, 0.24, 0.035] : manifest.biome === 'gas' ? [0.48 + band, 0.42 + band, 0.58 + band]
      : manifest.biome === 'desert' ? [0.67, 0.46, 0.24] : manifest.biome === 'lava' ? [0.24, 0.19, 0.18]
        : manifest.biome === 'rock' ? [0.4, 0.39, 0.37] : [0.24, 0.42, 0.21];
  let regionWeight = 0;
  const region = terrainRegionVisual(manifest.regions, global, manifest.radius_km);
  if (region) {
    color = region.color;
    regionWeight = region.weight;
  }
  const elevation = gradePersistentHeight(manifest, terrain, x, z, physicalHeight);
  return [...direction.map((value, axis) => value * (terrain.radius * bodyShapeFactor(global, manifest.shape) + elevation)
    - (axis === 1 ? bodyCenterRadius(terrain.radius, terrain.shape) : 0)), ...color, regionWeight, material];
}

function buildPersistedTerrainMesh(manifest, tiles, terrain) {
  const vertices = new Float32Array(tiles.length * (16 * 16 * 6 + 16 * 4 * 6) * 8);
  let offset = 0;
  const append = (point) => { vertices.set(point, offset); offset += 8; };
  for (const tile of tiles) {
    const points = Array.from({ length: 17 * 17 }, (_, index) =>
      persistedTerrainSample(manifest, tile, index % 17, Math.floor(index / 17), terrain));
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 16; col++) {
        const a = row * 17 + col, b = a + 1, c = a + 17, d = c + 1;
        [a, c, b, b, c, d].forEach((index) => append(points[index]));
      }
    }
    // Radial skirts cover cracks between independently refined neighbors.
    const skirt = Math.max(0.02 / COLONY_METERS_PER_UNIT, terrain.radius / (2 ** tile.lod) * 0.02);
    const lower = (point) => {
      const direction = [point[0], point[1] + bodyCenterRadius(terrain.radius, terrain.shape), point[2]];
      const length = Math.hypot(...direction);
      return [...point.slice(0, 3).map((value, axis) => value - direction[axis] / length * skirt), ...point.slice(3)];
    };
    for (let index = 0; index < 16; index++) {
      for (const [a, b] of [[index, index + 1], [272 + index, 273 + index], [index * 17, (index + 1) * 17], [index * 17 + 16, (index + 1) * 17 + 16]]) {
        const p = points[a], q = points[b], lowP = lower(p), lowQ = lower(q);
        [p, lowP, q, q, lowP, lowQ].forEach(append);
      }
    }
  }
  return { vertices, vertexCount: vertices.length / 8 };
}

function cityCameraPose(span, progress = 1, target = { x: 0, z: 0 }, surfaceRadius = 0, terrain = null, previousEye = null) {
  const t = bounded(progress, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const yaw = Math.PI / 4;
  const pitch = (65 + (35.264 - 65) * eased) * Math.PI / 180;
  let distance = span * (2.6 - eased * 0.6);
  let right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  let back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  let up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
  const tx = Number(target.x) || 0;
  const tz = Number(target.z) || 0;
  let targetPosition = [tx, 0, tz];
  if (surfaceRadius > 0) {
    targetPosition = mapColonySurfacePoint(surfaceRadius, tx, 0, tz, terrain);
    const normal = bodySurfaceNormal(surfaceRadius, tx, tz, terrain?.shape);
    let east = [1 - normal[0] * normal[0], -normal[0] * normal[1], -normal[0] * normal[2]];
    const eastLength = Math.hypot(...east);
    if (eastLength < 1e-8) east = [0, 0, 1];
    else east = east.map((value) => value / eastLength);
    let north = [
      east[1] * normal[2] - east[2] * normal[1],
      east[2] * normal[0] - east[0] * normal[2],
      east[0] * normal[1] - east[1] * normal[0],
    ];
    const northLength = Math.hypot(...north);
    north = north.map((value) => value / Math.max(1e-8, northLength));
    const orient = (vector) => [
      east[0] * vector[0] + normal[0] * vector[1] + north[0] * vector[2],
      east[1] * vector[0] + normal[1] * vector[1] + north[1] * vector[2],
      east[2] * vector[0] + normal[2] * vector[1] + north[2] * vector[2],
    ];
    right = orient(right);
    up = orient(up);
    back = orient(back);
  }
  let eye = targetPosition.map((value, axis) => value + back[axis] * distance);
  if (surfaceRadius > 0 && terrain?.shape) {
    eye = constrainBodyCamera(previousEye, eye, surfaceRadius, terrain);
    const delta = eye.map((value, axis) => value - targetPosition[axis]);
    distance = Math.hypot(...delta);
    back = delta.map((value) => value / Math.max(distance, 1e-8));
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    right = cross(up, back);
    const length = Math.hypot(...right);
    right = right.map((value) => value / Math.max(length, 1e-8));
    up = cross(back, right);
  }
  return {
    right, up, back, target: targetPosition, distance, eased,
    eye,
  };
}

function cityCameraMatrix(aspect, span, progress = 1, target = { x: 0, z: 0 }, surfaceRadius = 0, terrain = null, pose = null) {
  const { right, up, back, target: targetPosition, distance } = pose || cityCameraPose(span, progress, target, surfaceRadius, terrain);
  const view = new Float32Array([
    right[0], up[0], back[0], 0, right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -right.reduce((sum, value, axis) => sum + value * targetPosition[axis], 0),
    -up.reduce((sum, value, axis) => sum + value * targetPosition[axis], 0),
    -distance - back.reduce((sum, value, axis) => sum + value * targetPosition[axis], 0),
    1,
  ]);
  const near = 0.1;
  const far = span * 10;
  const half = span * 0.5;
  // Homogeneous scaling keeps the target-plane framing stable during landing.
  const perspective = new Float32Array([
    1 / (half * aspect), 0, 0, 0, 0, 1 / half, 0, 0,
    0, 0, far / ((near - far) * distance), -1 / distance,
    0, 0, far * near / ((near - far) * distance), 0,
  ]);
  return multiplyMatrix(perspective, view);
}

function colonyAtmosphereState(body, citySpan, pose) {
  const radius = body.radius;
  const finalDistance = citySpan * 2;
  const finalAltitude = Math.hypot(radius + finalDistance * Math.sin(35.264 * Math.PI / 180),
    finalDistance * Math.cos(35.264 * Math.PI / 180)) - radius;
  const cloudAltitude = Math.max(12, finalAltitude * 1.8);
  const thickness = cloudAltitude * 0.3;
  const shape = body.terrain?.shape;
  const envelope = radius * Math.max(...(shape?.axes || [1, 1, 1])) * (1 + (shape?.deformation || 0));
  const altitude = Math.hypot(pose.eye[0], pose.eye[1] + bodyCenterRadius(radius, body.terrain?.shape), pose.eye[2]) - envelope;
  const density = Math.exp(-(((altitude - cloudAltitude) / thickness) ** 2));
  const clearing = bounded((altitude / cloudAltitude - 0.6) / 0.25, 0, 1);
  const atmosphere = body.atmosphere;
  return {
    altitude, cloudAltitude, thickness,
    fogOpacity: density * clearing * clearing * (3 - 2 * clearing)
      * (atmosphere?.strength || 0) * (atmosphere?.coverage || 0) * 0.92,
    belowClouds: altitude < cloudAltitude,
  };
}

function normalizeCitySlots(data) {
  const buildings = Array.isArray(data?.buildings) ? data.buildings : [];
  const saved = Array.isArray(data?.slots) ? data.slots.filter(Boolean).slice(0, 256) : [];
  const cols = bounded(data?.layout?.grid?.cols, 1, 32, 6);
  const rows = bounded(data?.layout?.grid?.rows, 1, 32, 4);
  const source = saved.length ? saved : buildings.filter((entry) => (Number(entry.level) > 0 || entry.upgrade_end) && entry.meta?.zone !== 'orbital')
    .slice(0, 256).map((entry, index) => ({ ...entry, slot_x: index % cols, slot_y: Math.floor(index / cols) }));
  const persisted = source.some((slot) => slot.slot_x != null);
  const centerX = (Math.min(0, ...source.map((s) => bounded(s.slot_x, -31, 31))) + Math.max(cols - 1, ...source.map((s) => bounded(s.slot_x, -31, 31)))) / 2;
  const centerZ = (Math.min(0, ...source.map((s) => bounded(s.slot_y, -31, 31))) + Math.max(rows - 1, ...source.map((s) => bounded(s.slot_y, -31, 31)))) / 2;
  return source.slice(0, 256).map((slot, index) => {
    const type = String(slot.type || slot.building_type || '');
    const building = buildings.find((entry) => entry.type === type);
    return {
      ...building, ...slot, type,
      owner_color: slot.owner_color || data?.colony?.owner_color || data?.colony?.colony_owner_color || data?.colony?.faction_color || '',
      level: bounded(slot.level ?? building?.level, 0, 100, 1),
      x: persisted ? (bounded(slot.slot_x, -31, 31) - centerX) * 3.1 : bounded(slot.x, -100, 100),
      z: persisted ? (bounded(slot.slot_y, -31, 31) - centerZ) * 3.1 : bounded(slot.z, -100, 100),
      key: `${type}:${slot.slot_x ?? slot.x ?? index}:${slot.slot_y ?? slot.z ?? 0}`,
    };
  }).filter((slot) => slot.type && (slot.level > 0 || slot.upgrade_end));
}

function cityEconomyStatus(data) {
  const economy = data?.economy;
  if (!economy) return { text: 'Economy unavailable — building snapshot only', warning: false };
  const energy = Number(economy.energy_balance ?? economy.energy?.balance ?? economy.energy?.net);
  const bottlenecks = Array.isArray(economy.shortages) ? economy.shortages
    : Object.entries(economy.shortages || {}).filter(([, value]) => Number(value) > 0).map(([key]) => key);
  const warning = (Number.isFinite(energy) && energy < 0) || bottlenecks.length > 0;
  return {
    warning,
    text: bottlenecks.length ? `Colony shortage: ${bottlenecks.map((b) => typeof b === 'string' ? b : b.resource || b.type || 'production').join(', ')}`
      : Number.isFinite(energy) ? `Energy balance: ${energy.toFixed(1)}${energy < 0 ? ' — production constrained' : ''}`
        : 'Authoritative economy snapshot loaded',
  };
}

function buildCityGeometry(slots, data) {
  const parts = [];
  const add = (x, y, z, sx, sy, sz, color) => {
    if (parts.length < 8192) parts.push({ x, y, z, sx, sy, sz, color });
  };
  const width = Math.max(bounded(data?.layout?.grid?.cols, 1, 32, 6) * 3.1, ...slots.map((s) => Math.abs(s.x) * 2 + 3.1));
  const depth = Math.max(bounded(data?.layout?.grid?.rows, 1, 32, 4) * 3.1, ...slots.map((s) => Math.abs(s.z) * 2 + 3.1));
  const cols = Math.round(width / 3.1);
  const rows = Math.round(depth / 3.1);
  // Roads lie between plots, so cosmetic traffic never walks through buildings.
  const radius = resolveBodySurface(data, width, depth).radius;
  const roadLength = Math.sqrt(radius * 0.1);
  const depthSegments = Math.ceil(depth / roadLength);
  const widthSegments = Math.ceil(width / roadLength);
  for (let x = -cols / 2; x <= cols / 2; x++) {
    for (let segment = 0; segment < depthSegments; segment++) {
      add(x * 3.1, 0.07, (segment + 0.5) * depth / depthSegments - depth / 2,
        0.52, 0.03, depth / depthSegments, [0.16, 0.20, 0.24]);
    }
  }
  for (let z = -rows / 2; z <= rows / 2; z++) {
    for (let segment = 0; segment < widthSegments; segment++) {
      add((segment + 0.5) * width / widthSegments - width / 2, 0.07, z * 3.1,
        width / widthSegments, 0.03, 0.52, [0.16, 0.20, 0.24]);
    }
  }
  const status = cityEconomyStatus(data);
  slots.forEach((s) => {
    const text = `${s.type} ${s.category || ''}`.toLowerCase();
    const height = 0.8 + Math.min(7, s.level) * 0.22;
    const warning = status.warning || /blocked|paused|shortage/.test(String(s.status || ''));
    const color = s.upgrade_end ? [0.9, 0.57, 0.22] : warning ? [0.65, 0.32, 0.27] : hexToRgbFloat(s.owner_color || '#74aebc');
    add(s.x, 0.02, s.z, 2.45, 0.12, 2.45, warning ? [0.68, 0.30, 0.16] : [0.28, 0.36, 0.37]);
    if (/farm|agri|food|hydropon/.test(text)) {
      for (let i = 0; i < 4; i++) add(s.x - 0.8 + i * 0.53, 0.15, s.z, 0.35, 0.32, 1.9, [0.24, 0.62, 0.34]);
    } else if (/power|reactor|fusion|energy|solar/.test(text)) {
      add(s.x, 0.15, s.z, 1.1, height, 1.1, color);
      add(s.x, height + 0.15, s.z, 1.55, 0.18, 1.55, [0.3, 0.85, 0.92]);
      add(s.x + 0.85, 0.3, s.z, 0.4, 0.08, 1.9, [0.12, 0.31, 0.68]);
    } else if (/mine|factory|refinery|forge|smelt|storage/.test(text)) {
      add(s.x, 0.15, s.z, 2, height * 0.65, 1.7, color);
      for (let i = 0; i < 2; i++) add(s.x - 0.6 + i * 1.2, 0.15, s.z - 0.5, 0.35, height + 0.6, 0.35, [0.45, 0.49, 0.5]);
      add(s.x, height * 0.65 + 0.15, s.z + 0.15, 2.1, 0.16, 1.6, [0.52, 0.57, 0.6]);
    } else {
      const science = /lab|research|science|academy/.test(text);
      add(s.x, 0.15, s.z, science ? 1.35 : 1.8, height, science ? 1.35 : 1.8, color);
      add(s.x, height + 0.15, s.z, science ? 0.7 : 1.9, science ? 0.65 : 0.12, science ? 0.7 : 1.9, [0.57, 0.76, 0.83]);
      for (let floor = 0; floor < Math.min(4, s.level + 1); floor++) {
        add(s.x, 0.4 + floor * 0.22, s.z + 0.91, 1.4, 0.09, 0.025, warning ? [0.7, 0.4, 0.16] : [0.76, 0.95, 0.92]);
      }
    }
    // A visible status beacon distinguishes construction and economic stress.
    add(s.x + 0.95, 0.16, s.z + 0.95, 0.16, 0.45, 0.16, s.upgrade_end ? [1, 0.76, 0.18] : warning ? [1, 0.24, 0.12] : [0.25, 0.95, 0.6]);
  });
  return { parts, width, depth };
}

function cityPedestrians(population, slots, popClasses = {}) {
  const count = slots.length ? Math.min(96, Math.floor(Math.sqrt(bounded(population, 0, 1e12)) / 2)) : 0;
  const classes = Object.entries(popClasses || {}).filter(([, value]) => Number(value) > 0).sort(([a], [b]) => a.localeCompare(b));
  const total = classes.reduce((sum, [, value]) => sum + Number(value), 0);
  return Array.from({ length: count }, (_, index) => {
    const home = slots[index % slots.length];
    let remaining = (index + 0.5) / count * total;
    const role = classes.find(([, value]) => { remaining -= Number(value); return remaining <= 0; })?.[0] || 'colonist';
    return { x: home.x, z: home.z + 1.55, role, phase: ((index * 0.61803398875) % 1) * 4, speed: 0.2 + (index % 5) * 0.025 };
  });
}

class ColonySurfaceLevelWebGPU extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas         = null;
    this._backend        = null;
    this._sceneData      = null;
    this._device         = null;
    this._context        = null;
    this._meshPipeline   = null;
    this._bodyPipeline   = null;
    this._bodyBindGroup  = null;
    this._terrainBuffer = null;
    this._terrainVertexCount = 0;
    this._terrainKey = '';
    this._terrainCache = new Map();
    this._terrainCacheBytes = 0;
    this._terrainLod = null;
    this._terrainFocus = null;
    this._terrainStream = null;
    this._terrainState = '';
    this._cameraEye = null;
    this._cameraEye = null;
    this._persistentMeshKey = '';
    this._skyPipeline = null;
    this._cloudVeilPipeline = null;
    this._skyBindGroup = null;
    this._cloudVeilBindGroup = null;
    this._atmosphereState = null;
    this._vfxPipeline    = null;
    this._instanceBuffer = null;
    this._instanceBindGroup = null;
    this._buildingVfxBuffer = null;
    this._buildingVfxVertexCount = 0;
    this._buildingVfxParticles = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
    this._slotCount      = 0;
    this._slots = [];
    this._city = null;
    this._bodySurface = { radius: 150, kind: 'planet', tint: [0.25, 0.42, 0.29] };
    this._citySpan = 25;
    this._entrySpan = 100;
    this._minCameraSpan = 3.5;
    this._zoomMultiplier = 1;
    this._people = [];
    this._cameraBuffer = null;
    this._depthTexture = null;
    this._camera = { span: 25, target: { x: 0, z: 0 }, progress: 0 };
    this._cameraFocus = null;
    this._buildingView = null;
    this._viewProjection = cityCameraMatrix(1, 25);
    this._elapsed = 0;
    this._active = false;
    this._inputCleanups = [];
    this._requestGeneration = 0;
    this._request = null;
    this._hud = null;
    this._selected = null;
    this._visualPalette  = {
      owner: [0.49, 0.72, 0.93],
      clear: [0.05, 0.06, 0.04],
    };
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    this._device = backend?.device || null;
    this._context = backend?.context || null;
    if (!this._device || !this._context) {
      throw new Error('ColonySurfaceLevelWebGPU requires the shared WebGPU device and canvas context');
    }
    await this._buildPipelines();
    if (this._sceneData) this.setSceneData(this._sceneData);
  }

  setSceneData(data) {
    this._cameraFocus = null;
    const detail = this._buildingView;
    if (Number(this._sceneData?.colony?.id || 0) !== Number(data?.colony?.id || 0)) {
      this._terrainStream?.dispose();
      this._terrainStream = null;
      this._terrainState = '';
      this._buildingView = null;
      this._requestGeneration++;
      this._request?.abort();
      this._request = null;
      this._snapshotLoaded = false;
      this._snapshotState = '';
      this._camera.target = { x: 0, z: 0 };
    }
    this._sceneData = data || null;
    this._applySceneDataVisuals(data);
    this._slots = normalizeCitySlots(data);
    this._city = buildCityGeometry(this._slots, data);
    this._citySpan = Math.max(this._city.width, this._city.depth) * 1.35;
    this._bodySurface = resolveBodySurface(data, this._city.width, this._city.depth);
    if (this._terrainStream?.manifest) {
      applyTerrainSettlement(this._bodySurface.terrain, this._terrainStream.manifest);
      this._bodySurface.radius = this._bodySurface.terrain.radius;
      this._bodySurface.estimatedRadius = false;
    }
    const terrainKey = JSON.stringify(this._bodySurface.terrain);
    if (terrainKey !== this._terrainKey) {
      this._releaseTerrain();
      this._terrainKey = terrainKey;
    }
    if (this._active && !this._terrainStream && Number.isSafeInteger(Number(data?.colony?.id))
        && Number(data?.colony?.id) > 0) {
      this._terrainStream = new CubeSphereTerrainStream(Number(data.colony.id), (status) => {
        this._terrainState = status;
        this._updateHud();
      });
    }
    this._entrySpan = Math.max(this._citySpan * 4, this._bodySurface.radius * 3);
    const tallestPart = Math.max(0, ...this._city.parts.map((part) => part.y + part.sy));
    this._minCameraSpan = Math.max(3.5, (tallestPart + 0.35) / (2 * Math.sin(35.264 * Math.PI / 180)));
    this._zoomMultiplier = 1;
    this._people = cityPedestrians(data?.colony?.population, this._slots, data?.pop_classes);
    this._camera.span = this._entrySpan;
    this._selected = this._buildingView
      ? this._slots.find((slot) => slot.key === this._buildingView.key) || null
      : null;
    if (detail && !this._selected) {
      this._buildingView = null;
      this._navigation?.surface?.();
    }
    this._uploadSlots();
    this._rebuildBuildingVfx(this._slots);
    this._updateHud();
  }

  render(dt) {
    if (!this._active || !this._device || !this._context || globalThis.document?.hidden) return;
    const viewport = this._canvas.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0 || viewport.bottom <= 0 || viewport.right <= 0
        || viewport.top >= globalThis.innerHeight || viewport.left >= globalThis.innerWidth) return;
    const seconds = bounded(Number(dt) > 1 ? Number(dt) / 1000 : dt, 0, 0.1, 0.016);
    this._elapsed += seconds;
    this._camera.progress = Math.min(1, this._camera.progress + seconds / 1.2);
    this._setCameraSpan(this._transitionBaseSpan() * this._zoomMultiplier);
    this._advanceCameraFocus(seconds);
    this._uploadTerrain();
    const aspect = Math.max(0.1, this._canvas.width / Math.max(1, this._canvas.height));
    const cameraSpan = this._camera.span / Math.min(1, aspect);
    const pose = cityCameraPose(cameraSpan, this._camera.progress, this._camera.target,
      this._bodySurface.radius, this._bodySurface.terrain, this._cameraEye);
    this._cameraEye = pose.eye;
    this._viewProjection = cityCameraMatrix(
      aspect, this._camera.span / Math.min(1, aspect), this._camera.progress,
      this._camera.target, this._bodySurface.radius, this._bodySurface.terrain, pose
    );
    this._backdropRendered = this._camera.progress < 1
      && !!this._planetBackdrop?.renderBackdrop(seconds, this._backdropPose, 1 - this._camera.progress);
    this._atmosphereState = colonyAtmosphereState(this._bodySurface, this._citySpan, pose);
    const uniforms = new Float32Array(136);
    uniforms.set(this._viewProjection);
    uniforms[16] = this._backdropRendered ? this._camera.progress : 1;
    uniforms[17] = this._bodySurface.radius;
    uniforms[18] = this._bodySurface.terrain.groundHeight || 0;
    uniforms[19] = this._elapsed;
    uniforms.set([...this._bodySurface.tint, bodyCenterRadius(this._bodySurface.radius, this._bodySurface.terrain.shape)], 20);
    uniforms.set([...pose.eye, this._atmosphereState.fogOpacity], 24);
    uniforms.set([...pose.right, cameraSpan * aspect * 0.5], 28);
    uniforms.set([...pose.up, cameraSpan * 0.5], 32);
    uniforms.set([...pose.back, pose.distance], 36);
    uniforms.set([...this._bodySurface.atmosphere.color, this._bodySurface.atmosphere.strength], 40);
    uniforms.set([this._atmosphereState.cloudAltitude, this._atmosphereState.thickness,
      this._bodySurface.atmosphere.coverage, 0], 44);
    const shape = this._bodySurface.terrain.shape;
    uniforms.set([...(shape?.axes || [1, 1, 1]), shape?.deformation || 0], 48);
    const frame = shape?.frame || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    frame.forEach((axis, index) => uniforms.set([...axis, 0], 52 + index * 4));
    const shelter = this._bodySurface.terrain.shelter;
    if (shelter) uniforms.set([shelter.radius, colonyDomeHeight(shelter, this._city.parts), 0, 0], 64);
    if (shape?.solid) {
      shape.solid.lobes.forEach((lobe, index) => {
        uniforms.set([...lobe.center, 0], 68 + index * 4);
        uniforms.set([...lobe.axes, 0], 84 + index * 4);
      });
      shape.solid.cuts.forEach((cut, index) => uniforms.set([...cut.center, cut.radius], 100 + index * 4));
      uniforms.set([shape.solid.lobes.length, shape.solid.cuts.length, shape.solid.blend, bodySolidBound(shape.solid)], 132);
    }
    this._device.queue.writeBuffer(this._cameraBuffer, 0, uniforms);
    const materialModel = typeof require !== 'undefined'
      ? require('../../../rendering/body-material.js') : window.GQBodyMaterial;
    const source = this._sceneData?.focusPlanet || this._sceneData?.planet || this._sceneData?.colony || this._sceneData || {};
    const material = materialModel.resolveBodyMaterial(
      { ...source, biome: this._bodySurface.terrain.biome,
        diameter_km: this._bodySurface.radius * COLONY_METERS_PER_UNIT / 500 },
      this._terrainStream?.manifest
    );
    const anchor = frame[1].map((n) => n * bodyCenterRadius(this._bodySurface.radius, shape) * COLONY_METERS_PER_UNIT);
    this._materialState = material;
    this._materialPixels = this._bodySurface.radius * this._canvas.height * 1.73 / Math.max(pose.distance, 0.001);
    this._device.queue.writeBuffer(this._materialBuffer, 0, materialModel.materialUniforms(material, this._materialPixels, anchor));
    this._uploadPeople();
    this._updateBuildingVfxBuffer(seconds);
    this._drawFrame();
  }

  async enter(prevLevel, transitionPayload) {
    if (this._active) await this.exit();
    this._active = true;
    this._camera.progress = 0;
    this._camera.target = { x: 0, z: 0 };
    let data = transitionPayload || this._sceneData;
    const planetColony = transitionPayload?.__slot?.player_planet || transitionPayload?.planet?.__slot?.player_planet || transitionPayload?.planet || transitionPayload;
    if (!transitionPayload?.colony && Number(planetColony?.colony_id) > 0) {
      data = {
        colony: { ...planetColony, id: Number(planetColony.colony_id) },
        focusPlanet: transitionPayload?.focusPlanet || transitionPayload?.planet || transitionPayload,
        slots: [],
      };
    }
    this._snapshotState = '';
    this._snapshotLoaded = false;
    this.setSceneData(data);
    this._mountControls();
    this._loadSnapshot();
  }

  async exit() {
    this._active = false;
    this._cameraEye = null;
    this._cameraFocus = null;
    this._buildingView = null;
    this._atmosphereState = null;
    this._terrainStream?.dispose();
    this._terrainStream = null;
    this._terrainState = '';
    this._requestGeneration++;
    this._request?.abort();
    this._request = null;
    this._inputCleanups.splice(0).forEach((cleanup) => cleanup());
    this._hud?.remove();
    this._hud = null;
    this._selected = null;
    this._people = [];
    this._buildingVfxParticles = [];
    this._buildingVfxVertexCount = 0;
    this._instanceBuffer?.destroy();
    this._instanceBuffer = null;
    this._instanceBindGroup = null;
    this._buildingVfxBuffer?.destroy();
    this._buildingVfxBuffer = null;
    this._slotCount = 0;
    this._planetBackdrop = null;
    this._backdropPose = null;
    this._depthTexture?.destroy();
    this._depthTexture = null;
    this._releaseTerrain();
  }

  dispose() {
    this.exit();
    this._cameraBuffer?.destroy();
    this._cameraBuffer = null;
    this._materialBuffer?.destroy();
    this._materialBuffer = null;
    if (this._instanceBuffer) {
      try { this._instanceBuffer.destroy(); } catch (_) {}
      this._instanceBuffer = null;
    }
    if (this._buildingVfxBuffer) {
      try { this._buildingVfxBuffer.destroy(); } catch (_) {}
      this._buildingVfxBuffer = null;
    }
    this._meshPipeline = null;
    this._domePipeline = null;
    this._domeBindGroup = null;
    this._bodyPipeline = null;
    this._bodyBindGroup = null;
    this._skyPipeline = null;
    this._cloudVeilPipeline = null;
    this._skyBindGroup = null;
    this._cloudVeilBindGroup = null;
    this._vfxPipeline = null;
    this._instanceBindGroup = null;
    this._buildingVfxVertexCount = 0;
    this._buildingVfxParticles = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
    this._device = null;
    this._context = null;
    this._canvas  = null;
    this._backend = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _buildPipelines() {
    if (!this._device) return;
    const format = (globalThis.navigator?.gpu?.getPreferredCanvasFormat)
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'bgra8unorm';
    const meshShader = this._device.createShaderModule({ label: 'colony_city', code: COLONY_CITY_WGSL });
    this._meshPipeline = this._device.createRenderPipeline({
      label: 'colony_city',
      layout: 'auto',
      vertex: { module: meshShader, entryPoint: 'vs_main' },
      fragment: { module: meshShader, entryPoint: 'fs_main', targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const materialModel = typeof require !== 'undefined'
      ? require('../../../rendering/body-material.js') : window.GQBodyMaterial;
    if (!materialModel) throw new Error('Shared body material module is required');
    const bodyShader = this._device.createShaderModule({ label: 'colony_body_surface', code: materialModel.shader(COLONY_BODY_WGSL) });
    this._materialBuffer = this._device.createBuffer({
      label: 'colony_body_material', size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._bodyPipeline = this._device.createRenderPipeline({
      label: 'colony_body_surface',
      layout: 'auto',
      vertex: { module: bodyShader, entryPoint: 'vs_main', buffers: [{
        arrayStride: 32,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x4' },
          { shaderLocation: 2, offset: 28, format: 'float32' },
        ],
      }] },
      fragment: { module: bodyShader, entryPoint: 'fs_main', targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this._cameraBuffer = this._device.createBuffer({
      size: 544, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._domePipeline = this._device.createRenderPipeline({
      label: 'colony_pressure_dome', layout: 'auto',
      vertex: { module: meshShader, entryPoint: 'vs_dome' },
      fragment: { module: meshShader, entryPoint: 'fs_dome', targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });
    this._domeBindGroup = this._device.createBindGroup({
      layout: this._domePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._cameraBuffer } }],
    });
    const skyShader = this._device.createShaderModule({ label: 'colony_cloud_sky', code: COLONY_SKY_WGSL });
    for (const [entryPoint, property, depthCompare] of [
      ['fs_sky', '_skyPipeline', 'less-equal'],
      ['fs_veil', '_cloudVeilPipeline', 'always'],
    ]) {
      this[property] = this._device.createRenderPipeline({
        label: entryPoint === 'fs_sky' ? 'colony_sky_dome' : 'colony_cloud_crossing',
        layout: 'auto',
        vertex: { module: skyShader, entryPoint: 'vs_main' },
        fragment: { module: skyShader, entryPoint, targets: [{ format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        } }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare },
      });
    }
    this._skyBindGroup = this._device.createBindGroup({
      layout: this._skyPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._cameraBuffer } }],
    });
    this._cloudVeilBindGroup = this._device.createBindGroup({
      layout: this._cloudVeilPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._cameraBuffer } }],
    });
    const vfxShader = this._device.createShaderModule({ label: 'colony_vfx', code: COLONY_VFX_WGSL });
    this._vfxPipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: vfxShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 28,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x4' },
          ],
        }],
      },
      fragment: { module: vfxShader, entryPoint: 'fs_main', targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });
  }

  _packPart(data, index, part) {
    const base = index * 16;
    data.set([...part.color, 1, part.x, part.y, part.z, 1, part.sx, part.sy, part.sz, 0, 0, 0, 0, 0], base);
  }

  _releaseTerrain() {
    for (const entry of this._terrainCache.values()) entry.buffer.destroy();
    this._terrainCache.clear();
    this._terrainCacheBytes = 0;
    this._terrainBuffer = null;
    this._terrainVertexCount = 0;
    this._terrainLod = null;
    this._terrainFocus = null;
    this._terrainKey = '';
    this._persistentMeshKey = '';
  }

  _uploadTerrain() {
    const terrain = this._bodySurface.terrain;
    const aspect = Math.max(0.1, this._canvas.width / Math.max(1, this._canvas.height));
    const span = this._camera.span / Math.min(1, aspect);
    const stream = this._terrainStream;
    if (stream && !stream.manifest && !stream.request && !stream.failed) stream.load();
    if (stream?.manifest) {
      applyTerrainSettlement(terrain, stream.manifest);
      if (this._publishedTerrainManifest !== stream.manifest) {
        this._backend?.setBodyTerrainManifest?.(stream.manifest);
        this._publishedTerrainManifest = stream.manifest;
      }
      this._bodySurface.radius = terrain.radius;
      this._bodySurface.estimatedRadius = false;
      this._entrySpan = Math.max(this._citySpan * 4, terrain.radius * 3);
      const point = mapColonySurfacePoint(terrain.radius, this._camera.target.x, 0, this._camera.target.z);
      const focus = bodyFrameDirection(
        [point[0] / terrain.radius, (point[1] + terrain.radius) / terrain.radius, point[2] / terrain.radius],
        terrain.shape.frame
      );
      if (stream.manifest.solid) {
        terrain.heightSampler = (x, z) => {
          const point = bodyGroundPoint(terrain.radius, x, z);
          const direction = bodyFrameDirection([point[0] / terrain.radius, (point[1] + terrain.radius) / terrain.radius, point[2] / terrain.radius], terrain.shape.frame);
          return gradePersistentHeight(stream.manifest, terrain, x, z, bodyGeologicalHeight(stream.manifest, direction));
        };
        const pixels = terrain.radius * this._canvas.height / span;
        const lod = Math.min(13, Math.max(4, Math.ceil(Math.log2(Math.max(32, pixels) / 2))));
        const key = `solid:${this._terrainKey}:${lod}:${focus.map((n) => Math.round(n * 16)).join(',')}`;
        if (key !== this._persistentMeshKey) {
          const raw = buildCompositeBodyMesh(stream.manifest, pixels, terrain, focus);
          const vertices = new Float32Array(raw.vertexCount * 8);
          const baseColor = stream.manifest.biome === 'ice' ? [0.72, 0.85, 0.91] : [0.4, 0.39, 0.37];
          const centerRadius = bodyCenterRadius(terrain.radius, terrain.shape);
          for (let index = 0; index < raw.vertexCount; index++) {
            const bodyPoint = Array.from(raw.vertices.subarray(index * 3, index * 3 + 3));
            const region = terrainRegionVisual(stream.manifest.regions,
              bodyPoint.map((value) => value / Math.max(1e-10, Math.hypot(...bodyPoint))), stream.manifest.radius_km);
            const point = bodyFrameDirection(bodyPoint, terrain.shape.frame, true);
            vertices.set([
              point[0] * terrain.radius, point[1] * terrain.radius - centerRadius,
              point[2] * terrain.radius, ...(region?.color || baseColor), region?.weight || 0,
              stream.manifest.biome === 'ice' ? 2 : 0,
            ], index * 8);
          }
          this._releaseTerrain();
          this._terrainKey = JSON.stringify(terrain);
          const buffer = this._device.createBuffer({
            label: 'colony_composite_solid', size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          this._device.queue.writeBuffer(buffer, 0, vertices);
          this._terrainCache.set('solid', { buffer, bytes: vertices.byteLength, vertexCount: raw.vertexCount });
          this._terrainCacheBytes = vertices.byteLength;
          this._terrainBuffer = buffer;
          this._terrainVertexCount = raw.vertexCount;
          this._persistentMeshKey = key;
        }
        return;
      }
      const tiles = stream.update(terrain.radius * this._canvas.height / span, focus);
      if (tiles.length) {
        terrain.heightSampler = (x, z) => stream.sample(x, z, terrain);
        const key = `${this._terrainKey}:${tiles.map(terrainTileKey).join(',')}`;
        if (key !== this._persistentMeshKey) {
          const mesh = buildPersistedTerrainMesh(stream.manifest, tiles, terrain);
          this._releaseTerrain();
          this._terrainKey = JSON.stringify(terrain);
          const buffer = this._device.createBuffer({
            label: 'colony_persisted_cube_tiles', size: mesh.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          this._device.queue.writeBuffer(buffer, 0, mesh.vertices);
          this._terrainCache.set('persistent', { buffer, bytes: mesh.vertices.byteLength, vertexCount: mesh.vertexCount });
          this._terrainCacheBytes = mesh.vertices.byteLength;
          this._terrainBuffer = buffer;
          this._terrainVertexCount = mesh.vertexCount;
          this._persistentMeshKey = key;
        }
        return;
      }
    }
    const projectedScale = terrain.scale * this._canvas.height / span;
    const lod = selectColonyTerrainLod(projectedScale, this._terrainLod);
    const step = terrain.scale * 0.5;
    let focus = {
      x: Math.round(this._camera.target.x / step) * step,
      z: Math.round(this._camera.target.z / step) * step,
    };
    if (this._terrainFocus
        && Math.abs(this._camera.target.x - this._terrainFocus.x) < step * 0.75
        && Math.abs(this._camera.target.z - this._terrainFocus.z) < step * 0.75) {
      focus = this._terrainFocus;
    }
    const key = `${lod}:${focus.x}:${focus.z}`;
    let entry = this._terrainCache.get(key);
    if (!entry) {
      const mesh = buildColonyTerrainMesh(terrain, lod, focus);
      while (this._terrainCache.size && this._terrainCacheBytes + mesh.vertices.byteLength > TERRAIN_CACHE_BYTES) {
        const oldest = this._terrainCache.keys().next().value;
        const evicted = this._terrainCache.get(oldest);
        evicted.buffer.destroy();
        this._terrainCacheBytes -= evicted.bytes;
        this._terrainCache.delete(oldest);
      }
      const buffer = this._device.createBuffer({
        label: `colony_terrain_lod_${lod}`, size: mesh.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this._device.queue.writeBuffer(buffer, 0, mesh.vertices);
      entry = { buffer, bytes: mesh.vertices.byteLength, vertexCount: mesh.vertexCount };
      this._terrainCacheBytes += entry.bytes;
    }
    this._terrainCache.delete(key);
    this._terrainCache.set(key, entry);
    this._terrainBuffer = entry.buffer;
    this._terrainVertexCount = entry.vertexCount;
    this._terrainLod = lod;
    this._terrainFocus = focus;
  }

  _uploadSlots() {
    if (!this._device) return;
    const count = (this._city?.parts.length || 0) + this._people.length * 2 + 1;
    const size   = count * BYTES_PER_SLOT;
    this._instanceBuffer?.destroy();
    this._instanceBuffer = this._device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const data = new Float32Array(count * 16);
    this._city?.parts.forEach((part, i) => this._packPart(data, i, part));
    this._device.queue.writeBuffer(this._instanceBuffer, 0, data.buffer, 0, data.byteLength);
    this._instanceBindGroup = this._device.createBindGroup({
      layout: this._meshPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._cameraBuffer } },
        { binding: 1, resource: { buffer: this._instanceBuffer } },
      ],
    });
    this._bodyBindGroup = this._device.createBindGroup({
      layout: this._bodyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this._cameraBuffer } },
        { binding: 2, resource: { buffer: this._materialBuffer } },
      ],
    });
    this._slotCount = count;
  }

  _uploadPeople() {
    if (!this._instanceBuffer || !this._city) return;
    const data = new Float32Array((this._people.length * 2 + 1) * 16);
    this._people.forEach((person, i) => {
      // Deterministic triangular wave along a road; time is bounded and has no economic effect.
      const phase = (this._elapsed * person.speed + person.phase) % 4;
      const x = person.x + (phase < 2 ? phase : 4 - phase) - 1;
      const color = /scient|research/.test(person.role) ? [0.45,0.78,1] : /soldier|military/.test(person.role) ? [0.35,0.6,0.38] : [0.85,0.57 + (i % 3) * 0.12,0.3];
      this._packPart(data, i * 2, { x, y: 0.08, z: person.z, sx: 0.12, sy: 0.28, sz: 0.12, color });
      this._packPart(data, i * 2 + 1, { x, y: 0.36, z: person.z, sx: 0.13, sy: 0.13, sz: 0.13, color: [0.9, 0.77, 0.65] });
    });
    const slot = this._selected;
    this._packPart(data, this._people.length * 2, {
      x: slot?.x || 0, y: 0.155, z: slot?.z || 0,
      sx: slot ? 2.6 : 0, sy: 0.035, sz: slot ? 2.6 : 0, color: [0.2, 0.87, 1],
    });
    this._device.queue.writeBuffer(this._instanceBuffer, this._city.parts.length * BYTES_PER_SLOT, data);
  }

  setNavigationHandlers(handlers) {
    this._navigation = handlers;
  }

  setTransitionSource(source, pose) {
    this._planetBackdrop = typeof source?.renderBackdrop === 'function' ? source : null;
    this._backdropPose = pose;
  }

  _transitionBaseSpan() {
    const t = bounded(this._camera.progress, 0, 1);
    const eased = 1 - (1 - t) ** 3;
    return this._entrySpan * Math.pow(this._citySpan / this._entrySpan, eased);
  }

  _setCameraSpan(span) {
    const terrain = this._bodySurface.terrain;
    const outsideCity = terrain && (Math.abs(this._camera.target.x) > terrain.width * 0.5
      || Math.abs(this._camera.target.z) > terrain.depth * 0.5);
    const manifest = this._terrainStream?.manifest;
    const amplitude = manifest ? manifest.amplitude_km / manifest.radius_km * terrain.radius : terrain?.amplitude;
    const clearance = outsideCity && !manifest ? (amplitude * 2 + 0.35) / (2 * Math.sin(35.264 * Math.PI / 180)) : 0;
    span = bounded(span, Math.max(this._minCameraSpan, clearance), this._entrySpan, this._citySpan);
    this._zoomMultiplier = span / Math.max(0.001, this._transitionBaseSpan());
    this._camera.span = span;
  }

  _focusBuilding(slot = this._selected) {
    if (!slot) return;
    this._cameraFocus = {
      fromTarget: { ...this._camera.target },
      toTarget: { x: slot.x, z: slot.z },
      fromSpan: this._camera.span,
      toSpan: Math.max(9, this._minCameraSpan),
      elapsed: 0,
      duration: Math.max(0.65, (1 - this._camera.progress) * 1.2),
    };
  }

  enterBuilding(payload) {
    const requested = payload?.target || payload?.building || payload;
    const colonyId = requested?.colonyId ?? requested?.colony_id ?? payload?.colonyId ?? payload?.colony?.id;
    if (colonyId != null && Number(colonyId) !== Number(this._sceneData?.colony?.id)) {
      throw new Error('Building detail belongs to another colony');
    }
    const slot = requested == null ? this._selected : this._slots.find((entry) =>
      requested.key != null ? entry.key === requested.key
        : requested.slot_x != null && requested.slot_y != null
          ? entry.slot_x === requested.slot_x && entry.slot_y === requested.slot_y
          : requested.x != null && requested.z != null
            ? entry.x === requested.x && entry.z === requested.z
            : requested.id != null && entry.id != null && entry.id === requested.id);
    if (!slot) throw new Error('Building detail requires an existing colony building');
    if (!this._buildingView) {
      this._buildingView = {
        target: { ...this._camera.target },
        span: this._camera.span,
        key: slot.key,
      };
    } else this._buildingView.key = slot.key;
    this._selected = slot;
    this._focusBuilding(slot);
    this._updateHud();
  }

  leaveBuilding() {
    const previous = this._buildingView;
    this._buildingView = null;
    if (previous) {
      this._cameraFocus = {
        fromTarget: { ...this._camera.target },
        toTarget: previous.target,
        fromSpan: this._camera.span,
        toSpan: previous.span,
        elapsed: 0,
        duration: 0.65,
      };
    }
    this._updateHud();
  }

  _openBuilding() {
    if (!this._selected) return;
    if (this._navigation?.building) {
      this._navigation.building({ ...this._selected, colonyId: this._sceneData?.colony?.id });
    } else this._focusBuilding();
  }

  _zoomCamera(direction) {
    const nextSpan = this._camera.span * Math.exp(bounded(direction, -150, 150) * 0.002);
    if (this._buildingView && direction > 0
        && nextSpan >= Math.max(9, this._buildingView.span) * 0.98) {
      this._navigation?.back?.();
    } else if (direction > 0 && nextSpan >= this._entrySpan * 0.98) {
      this._navigation?.back?.();
    } else if (!this._buildingView && this._selected && direction < 0
        && nextSpan <= Math.max(9, this._minCameraSpan) && this._navigation?.building) {
      this._openBuilding();
    } else this._setCameraSpan(nextSpan);
  }

  _advanceCameraFocus(seconds) {
    const focus = this._cameraFocus;
    if (!focus) return;
    focus.elapsed += seconds;
    const t = Math.min(1, focus.elapsed / focus.duration);
    const eased = t * t * (3 - 2 * t);
    this._camera.target = {
      x: focus.fromTarget.x + (focus.toTarget.x - focus.fromTarget.x) * eased,
      z: focus.fromTarget.z + (focus.toTarget.z - focus.fromTarget.z) * eased,
    };
    this._setCameraSpan(focus.fromSpan + (focus.toSpan - focus.fromSpan) * eased);
    if (t === 1) this._cameraFocus = null;
  }

  async _loadSnapshot() {
    if (!this._active || globalThis.document?.hidden) return;
    const id = Number(this._sceneData?.colony?.id || 0);
    if (!Number.isSafeInteger(id) || id < 1) return;
    this._request?.abort();
    const request = new AbortController();
    this._request = request;
    const generation = ++this._requestGeneration;
    this._snapshotState = 'Loading authoritative economy…';
    this._updateHud();
    try {
      const response = await fetch(`api/colony_economy.php?action=snapshot&colony_id=${id}`, {
        credentials: 'same-origin', cache: 'no-store', signal: request.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json();
      if (!snapshot.success || !snapshot.economy || Number(snapshot.colony?.id) !== id) {
        throw new Error(snapshot.error || 'Economy rollout not enabled');
      }
      if (!this._active || generation !== this._requestGeneration) return;
      this._snapshotState = `Server snapshot · ${snapshot.economy.settled_at || 'just loaded'}`;
      const target = { ...this._camera.target };
      const span = this._camera.span;
      const preserveCamera = this._snapshotLoaded;
      this._snapshotLoaded = true;
      this.setSceneData({ ...this._sceneData, ...snapshot, colony: { ...this._sceneData.colony, ...snapshot.colony } });
      if (preserveCamera) {
        this._camera.target = target;
        this._setCameraSpan(span);
      }
    } catch (error) {
      if (!this._active || generation !== this._requestGeneration || error.name === 'AbortError') return;
      this._snapshotState = 'Economy unavailable (requires on-demand rollout); showing saved buildings';
      // Older deployments can still supply real building levels via the existing endpoint.
      if (!this._slots.length && globalThis.window?.API?.buildings) {
        try {
          const buildings = await window.API.buildings(id);
          if (!this._active || generation !== this._requestGeneration) return;
          const mapped = window.GQRuntimeColonySurfaceSlotMapping?.buildColonySurfaceVfxSlots(this._sceneData.colony, buildings);
          if (buildings.success && mapped) this.setSceneData({ ...this._sceneData, layout: buildings.layout, slots: mapped.slots });
        } catch (_) { /* Preserve the last confirmed scene when offline. */ }
      }
    } finally {
      if (generation === this._requestGeneration) {
        this._request = null;
        this._updateHud();
      }
    }
  }

  _mountControls() {
    const canvas = this._canvas;
    if (!canvas?.addEventListener) return;
    const listen = (target, name, fn, options) => {
      target.addEventListener(name, fn, options);
      this._inputCleanups.push(() => target.removeEventListener(name, fn, options));
    };
    const capture = { capture: true };
    let drag = null;
    const stop = (event) => { event.stopImmediatePropagation(); };
    listen(canvas, 'pointerdown', (event) => {
      stop(event);
      if (event.button !== 0) return;
      event.preventDefault();
      this._cameraFocus = null;
      drag = { x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture?.(event.pointerId);
    }, capture);
    listen(canvas, 'pointermove', (event) => {
      stop(event);
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3 || drag.moved) {
        drag.moved = true;
        const scale = this._camera.span / Math.max(100, canvas.getBoundingClientRect().height);
        this._camera.target.x -= (dx + dy * 1.4) * scale * 0.707;
        this._camera.target.z += (dx - dy * 1.4) * scale * 0.707;
        this._camera.target.x = bounded(this._camera.target.x, -100, 100);
        this._camera.target.z = bounded(this._camera.target.z, -100, 100);
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
    }, capture);
    listen(canvas, 'pointerup', (event) => {
      stop(event);
      if (drag && !drag.moved) this._selectAt(event.clientX, event.clientY);
      drag = null;
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }, capture);
    listen(canvas, 'pointercancel', () => { drag = null; }, capture);
    listen(canvas, 'click', stop, capture);
    for (const name of ['mousedown', 'mousemove', 'mouseup']) listen(canvas, name, stop, capture);
    listen(canvas, 'dblclick', (event) => {
      stop(event);
      this._openBuilding();
    }, capture);
    listen(canvas, 'wheel', (event) => {
      event.preventDefault();
      stop(event);
      this._cameraFocus = null;
      this._zoomCamera(event.deltaY);
    }, { capture: true, passive: false });
    listen(window, 'keydown', (event) => {
      if (/input|textarea|select/i.test(event.target?.tagName) || event.target?.isContentEditable) return;
      const key = event.key;
      if (!['Escape', '+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
      stop(event);
      event.preventDefault();
      this._cameraFocus = null;
      if (key === 'Escape') this._navigation?.back?.();
      if (key === '+' || key === '=') {
        this._zoomCamera(Math.log(0.9) / 0.002);
      }
      if (key === '-') {
        this._zoomCamera(Math.log(1.1) / 0.002);
      }
      if (key === 'ArrowLeft') this._camera.target.x -= 0.8;
      if (key === 'ArrowRight') this._camera.target.x += 0.8;
      if (key === 'ArrowUp') this._camera.target.z -= 0.8;
      if (key === 'ArrowDown') this._camera.target.z += 0.8;
    }, capture);
    if (!canvas.parentElement) return;
    const hud = document.createElement('section');
    hud.setAttribute('aria-label', 'Colony surface simulation');
    Object.assign(hud.style, {
      position: 'absolute', top: '72px', left: '12px', zIndex: '20', maxWidth: '360px',
      background: 'rgba(7,20,30,.93)', color: '#d9f3ff', padding: '12px',
      border: '1px solid #4b7f96', borderRadius: '8px', pointerEvents: 'auto', font: '13px sans-serif',
    });
    const summary = document.createElement('div');
    summary.dataset.citySummary = '';
    hud.appendChild(summary);
    const selection = document.createElement('p');
    selection.dataset.citySelection = '';
    hud.appendChild(selection);
    const hint = document.createElement('p');
    hint.textContent = 'Drag to pan · Wheel / + − to zoom · Double-click building to focus · Esc to leave. Green: online · Amber: construction · Red: colony shortage. People are cosmetic.';
    hud.appendChild(hint);
    for (const [label, action] of [
      ['Back to orbit', () => this._navigation?.back?.()],
      ['Refresh snapshot', () => this._loadSnapshot()],
      [typeof this._sceneData?.onOpenBuildings === 'function' ? 'Buildings' : 'Focus building', () => {
        this._navigation?.slotClick?.(this._selected);
        if (typeof this._sceneData?.onOpenBuildings === 'function') this._sceneData.onOpenBuildings(this._selected);
        else this._openBuilding();
      }],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-sm';
      button.textContent = label;
      if (label === 'Back to orbit') button.dataset.cityBack = '';
      listen(button, 'click', action);
      hud.appendChild(button);
    }
    canvas.parentElement.appendChild(hud);
    this._hud = hud;
    this._updateHud();
  }

  _updateHud() {
    if (!this._hud) return;
    this._hud.querySelector('[data-city-back]').textContent = this._buildingView ? 'Back to colony' : 'Back to orbit';
    const colony = this._sceneData?.colony || {};
    const status = cityEconomyStatus(this._sceneData);
    const population = Number(colony.population);
    const happiness = Number(colony.happiness);
    const classes = Object.entries(this._sceneData?.pop_classes || {}).map(([key, count]) => `${key}: ${Number(count) || 0}`).join(' · ');
    const rates = ['production','consumption'].map((kind) => {
      const values = Object.entries(this._sceneData?.economy?.[kind] || {})
        .filter(([, value]) => Number.isFinite(Number(value))).slice(0,6)
        .map(([resource, value]) => `${resource} ${Number(value).toFixed(1)}`).join(', ');
      return values ? `${kind}: ${values}` : '';
    }).filter(Boolean).join(' · ');
    this._hud.querySelector('[data-city-summary]').textContent = [
      colony.name || 'Colony surface', `${this._slots.length} buildings`,
      Number.isFinite(population) ? `Population ${population.toLocaleString()}` : 'Population unavailable',
      Number.isFinite(happiness) ? `Happiness ${happiness.toFixed(0)}%` : '',
      classes, status.text, rates, this._snapshotState || 'Saved building state', this._terrainState,
      this._bodySurface.estimatedRadius ? 'Body diameter unavailable; estimated physical scale' : '',
    ].filter(Boolean).join(' · ');
    this._hud.querySelector('[data-city-selection]').textContent = this._selected
      ? `${this._selected.type.replace(/_/g, ' ')} · Level ${this._selected.level}${this._selected.upgrade_end ? ' · Construction in progress' : ''}`
      : 'Click a building to inspect its saved level.';
  }

  _selectAt(clientX, clientY) {
    const rect = this._canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / Math.max(1, rect.width) * 2 - 1;
    const py = 1 - (clientY - rect.top) / Math.max(1, rect.height) * 2;
    let selected = null;
    let nearest = Infinity;
    const triangles = [0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7,4,5,6,4,6,7];
    this._slots.forEach((slot) => {
      const height = 1.6 + Math.min(7, slot.level) * 0.22;
      const corners = [
        [-1.22,0,-1.22], [1.22,0,-1.22], [1.22,0,1.22], [-1.22,0,1.22],
        [-1.22,height,-1.22], [1.22,height,-1.22], [1.22,height,1.22], [-1.22,height,1.22],
      ].map(([x,y,z]) => projectColonySurfacePoint(
        this._viewProjection, this._bodySurface.radius, slot.x + x, y + 0.13, slot.z + z, this._bodySurface.terrain
      ));
      for (let i = 0; i < triangles.length; i += 3) {
        const [a,b,c] = triangles.slice(i, i + 3).map((idx) => corners[idx]);
        const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(det) < 1e-10) continue;
        const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det;
        const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det;
        const w = 1 - u - v;
        const depth = u * a[2] + v * b[2] + w * c[2];
        if (u >= 0 && v >= 0 && w >= 0 && depth >= 0 && depth <= 1 && depth < nearest) {
          nearest = depth;
          selected = slot;
        }
      }
    });
    this._selected = selected;
    this._updateHud();
    if (selected) this._navigation?.slotClick?.({ ...selected, colonyId: this._sceneData?.colony?.id });
    return selected;
  }

  _resolveBuildingVfxQuality(slotCount) {
    const requested = String(this._sceneData?.vfx_quality || this._sceneData?.quality || '').toLowerCase();
    if (requested === 'low' || requested === 'medium' || requested === 'high') return requested;
    if (slotCount > 280) return 'low';
    if (slotCount > 120) return 'medium';
    return 'high';
  }

  _slotKey(slot, index) {
    const sx = Number(slot?.x || 0).toFixed(2);
    const sz = Number(slot?.z || 0).toFixed(2);
    const type = String(slot?.type || slot?.building_type || slot?.category || 'generic');
    return `${index}:${sx}:${sz}:${type}`;
  }

  _ingestUpgradeTransitions(slots) {
    const source = Array.isArray(slots) ? slots : [];
    const next = new Map();
    let detectedTransition = false;
    for (let i = 0; i < source.length; i += 1) {
      const slot = source[i] || {};
      const key = this._slotKey(slot, i);
      const active = !!slot?.upgrade_end;
      next.set(key, active);
      const previous = this._slotUpgradeState.get(key);
      if (typeof previous === 'boolean' && previous !== active) {
        detectedTransition = true;
      }
    }
    this._slotUpgradeState = next;
    if (detectedTransition) {
      this._buildingVfxBurstUntil = Math.max(this._buildingVfxBurstUntil, this._buildingVfxTime + 1.6);
    }
  }

  _slotVfxProfile(slot) {
    const explicitProfile = String(slot?.vfx_profile || slot?.fx_profile || '').toLowerCase();
    const explicitIntensity = Math.max(0.4, Math.min(2.2, Number(slot?.vfx_intensity || slot?.fx_intensity || 1) || 1));
    if (explicitProfile) {
      if (explicitProfile === 'construction' || explicitProfile === 'upgrade') {
        return { profileName: 'construction', particleMul: 1.35 * explicitIntensity, sizeMul: 1.12, opacityAdd: 0.12, driftMul: 1.25, tint: [1.0, 0.70, 0.42] };
      }
      if (explicitProfile === 'industry' || explicitProfile === 'smelter' || explicitProfile === 'refinery') {
        return { profileName: 'industry', particleMul: 1.2 * explicitIntensity, sizeMul: 1.06, opacityAdd: 0.08, driftMul: 1.16, tint: [1.0, 0.79, 0.47] };
      }
      if (explicitProfile === 'power' || explicitProfile === 'reactor') {
        return { profileName: 'power', particleMul: 1.05 * explicitIntensity, sizeMul: 1.0, opacityAdd: 0.06, driftMul: 1.08, tint: [0.54, 0.84, 1.0] };
      }
      if (explicitProfile === 'research' || explicitProfile === 'science') {
        return { profileName: 'research', particleMul: 0.95 * explicitIntensity, sizeMul: 0.92, opacityAdd: 0.05, driftMul: 0.92, tint: [0.62, 0.82, 1.0] };
      }
      if (explicitProfile === 'quiet' || explicitProfile === 'minimal') {
        return { profileName: 'quiet', particleMul: 0.6 * explicitIntensity, sizeMul: 0.82, opacityAdd: -0.05, driftMul: 0.7, tint: null };
      }
    }

    const text = [
      slot?.type,
      slot?.building_type,
      slot?.category,
      slot?.state,
      slot?.status,
      slot?.activity,
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    const busy = !!slot?.upgrade_end
      || /construction|building|upgrade|running|queued|active/.test(text);
    const industrial = /mine|factory|refinery|smelter|forge|industry/.test(text);
    const research = /lab|research|science/.test(text);
    const power = /power|reactor|fusion|energy/.test(text);

    if (busy) {
      return { profileName: 'construction', particleMul: 1.35 * explicitIntensity, sizeMul: 1.12, opacityAdd: 0.12, driftMul: 1.25, tint: [1.0, 0.70, 0.42] };
    }
    if (industrial) {
      return { profileName: 'industry', particleMul: 1.2 * explicitIntensity, sizeMul: 1.06, opacityAdd: 0.08, driftMul: 1.16, tint: [1.0, 0.79, 0.47] };
    }
    if (power) {
      return { profileName: 'power', particleMul: 1.05 * explicitIntensity, sizeMul: 1.0, opacityAdd: 0.06, driftMul: 1.08, tint: [0.54, 0.84, 1.0] };
    }
    if (research) {
      return { profileName: 'research', particleMul: 0.95 * explicitIntensity, sizeMul: 0.92, opacityAdd: 0.05, driftMul: 0.92, tint: [0.62, 0.82, 1.0] };
    }
    return { profileName: 'auto', particleMul: 1 * explicitIntensity, sizeMul: 1, opacityAdd: 0, driftMul: 1, tint: null };
  }

  _rebuildBuildingVfx(slots) {
    const source = Array.isArray(slots) ? slots : [];
    this._ingestUpgradeTransitions(source);
    this._buildingVfxParticles = [];
    this._buildingVfxVertexCount = 0;
    if (!source.length) return;

    const quality = this._resolveBuildingVfxQuality(source.length);
    const qualityMap = {
      low: { emitters: 10, particlesPerEmitter: 8, size: 0.11, opacity: 0.16 },
      medium: { emitters: 20, particlesPerEmitter: 10, size: 0.12, opacity: 0.2 },
      high: { emitters: 36, particlesPerEmitter: 14, size: 0.14, opacity: 0.24 },
    };
    const cfg = qualityMap[quality] || qualityMap.medium;
    const profileCounts = {};
    const maxParticles = 900;
    const maxEmittersByCap = Math.max(1, Math.floor(maxParticles / Math.max(1, cfg.particlesPerEmitter)));
    const emitterCount = Math.min(source.length, cfg.emitters, maxEmittersByCap);
    const stride = Math.max(1, Math.floor(source.length / emitterCount));
    let remainingParticles = maxParticles;

    for (let e = 0; e < emitterCount; e += 1) {
      if (remainingParticles <= 0) break;
      const slot = source[Math.min(source.length - 1, e * stride)] || {};
      const profile = this._slotVfxProfile(slot);
      const profileName = String(profile.profileName || 'auto');
      profileCounts[profileName] = (profileCounts[profileName] || 0) + 1;
      const rgb = hexToRgbFloat(slot.owner_color || slot.colony_owner_color || slot.faction_color || '');
      const particleCount = Math.max(3, Math.min(remainingParticles, Math.round(cfg.particlesPerEmitter * profile.particleMul)));
      for (let i = 0; i < particleCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.1 + Math.random() * 0.85;
        const tint = profile.tint || rgb;
        this._buildingVfxParticles.push({
          x: Number(slot.x || 0) + Math.cos(angle) * radius,
          y: 1.1 + Math.min(7, Number(slot.level) || 1) * 0.22 + Math.random() * 1.7,
          z: Number(slot.z || 0) + Math.sin(angle) * radius,
          size: cfg.size * profile.sizeMul * (0.8 + Math.random() * 0.6),
          r: tint[0],
          g: tint[1],
          b: tint[2],
          baseOpacity: Math.max(0.05, Math.min(0.6, cfg.opacity + profile.opacityAdd)),
          pulsePhase: Math.random() * Math.PI * 2,
          drift: (0.14 + Math.random() * 0.22) * profile.driftMul,
        });
      }
      remainingParticles -= particleCount;
    }

    this._buildingVfxVertexCount = this._buildingVfxParticles.length * 6;
    this._ensureBuildingVfxBufferCapacity(this._buildingVfxVertexCount);
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality,
      emitters: emitterCount,
      particles: this._buildingVfxParticles.length,
      profileCounts,
      burstActive: this._buildingVfxBurstUntil > this._buildingVfxTime,
    };
  }

  _ensureBuildingVfxBufferCapacity(vertexCount) {
    if (!this._device) return;
    const bytesNeeded = Math.max(0, Number(vertexCount || 0)) * 28;
    if (!bytesNeeded) return;
    const existing = this._buildingVfxBuffer?.size || 0;
    if (existing >= bytesNeeded) return;
    if (this._buildingVfxBuffer) {
      try { this._buildingVfxBuffer.destroy(); } catch (_) {}
      this._buildingVfxBuffer = null;
    }
    this._buildingVfxBuffer = this._device.createBuffer({
      size: bytesNeeded,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _updateBuildingVfxBuffer(dt) {
    if (!this._device || !this._buildingVfxVertexCount || !this._buildingVfxBuffer) return;
    const particles = this._buildingVfxParticles;
    if (!particles.length) return;
    this._buildingVfxTime += Math.max(0, Number(dt) || 0.016);
    const t = this._buildingVfxTime;
    const burstT = this._buildingVfxBurstUntil > t
      ? Math.max(0, Math.min(1, (this._buildingVfxBurstUntil - t) / 1.6))
      : 0;
    const out = new Float32Array(this._buildingVfxVertexCount * 7);
    let vp = 0;
    particles.forEach((p, index) => {
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.15 + index * 0.001) + p.pulsePhase);
      const driftY = Math.sin(t * p.drift + p.pulsePhase) * 0.22;
      const center = projectColonySurfacePoint(
        this._viewProjection, this._bodySurface.radius, p.x, p.y + driftY, p.z, this._bodySurface.terrain
      );
      const cx = center[0];
      const cy = center[1];
      const hs = Math.max(0.001, p.size / this._camera.span * (1 + burstT * 0.18));
      const aspect = Math.max(0.1, this._canvas.width / Math.max(1, this._canvas.height));
      const a = Math.max(0.05, Math.min(0.78, p.baseOpacity + pulse * 0.16 + burstT * 0.22));
      const verts = [
        [cx - hs / aspect, cy - hs], [cx + hs / aspect, cy - hs], [cx - hs / aspect, cy + hs],
        [cx - hs / aspect, cy + hs], [cx + hs / aspect, cy - hs], [cx + hs / aspect, cy + hs],
      ];
      for (let i = 0; i < 6; i += 1) {
        out[vp + 0] = verts[i][0];
        out[vp + 1] = verts[i][1];
        out[vp + 2] = center[2];
        out[vp + 3] = p.r;
        out[vp + 4] = p.g;
        out[vp + 5] = p.b;
        out[vp + 6] = a;
        vp += 7;
      }
    });
    this._device.queue.writeBuffer(this._buildingVfxBuffer, 0, out.buffer, 0, out.byteLength);
    if (this._buildingVfxStats) {
      this._buildingVfxStats.burstActive = burstT > 0.001;
    }
    if (typeof window !== 'undefined') {
      window.__GQ_COLONY_VFX_STATS = Object.assign({}, this._buildingVfxStats || {}, {
        ts: Date.now(),
      });
    }
  }

  _drawFrame() {
    if (!this._device || !this._context || !this._meshPipeline) return;
    const width = Math.max(1, this._canvas.width);
    const height = Math.max(1, this._canvas.height);
    if (!this._depthTexture || this._depthTexture.width !== width || this._depthTexture.height !== height) {
      this._depthTexture?.destroy();
      this._depthTexture = this._device.createTexture({
        label: 'colony_depth', size: [width, height], format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const encoder = this._device.createCommandEncoder();
    const view = this._context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: this._visualPalette.clear[0], g: this._visualPalette.clear[1], b: this._visualPalette.clear[2], a: 1 },
        loadOp: this._backdropRendered ? 'load' : 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._depthTexture.createView(), depthClearValue: 1,
        depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    if (this._bodyPipeline && this._bodyBindGroup && this._terrainBuffer) {
      pass.setPipeline(this._bodyPipeline);
      pass.setBindGroup(0, this._bodyBindGroup);
      pass.setVertexBuffer(0, this._terrainBuffer);
      pass.draw(this._terrainVertexCount, 1, 0, 0);
    }
    if (this._instanceBindGroup && this._slotCount > 0) {
      pass.setPipeline(this._meshPipeline);
      pass.setBindGroup(0, this._instanceBindGroup);
      pass.draw(36, this._slotCount, 0, 0);
    }
    if (this._vfxPipeline && this._buildingVfxBuffer && this._buildingVfxVertexCount > 0) {
      pass.setPipeline(this._vfxPipeline);
      pass.setVertexBuffer(0, this._buildingVfxBuffer);
      pass.draw(this._buildingVfxVertexCount, 1, 0, 0);
    }
    if (this._bodySurface.terrain.shelter && this._persistentMeshKey && this._domePipeline) {
      pass.setPipeline(this._domePipeline);
      pass.setBindGroup(0, this._domeBindGroup);
      pass.draw(64 * 24 * 6, 1, 0, 0);
    }
    if (this._bodySurface.atmosphere?.strength > 0 && this._skyPipeline) {
      pass.setPipeline(this._skyPipeline);
      pass.setBindGroup(0, this._skyBindGroup);
      pass.draw(3, 1, 0, 0);
      if (this._atmosphereState?.fogOpacity > 0.001) {
        pass.setPipeline(this._cloudVeilPipeline);
        pass.setBindGroup(0, this._cloudVeilBindGroup);
        pass.draw(3, 1, 0, 0);
      }
    }
    pass.end();
    this._device.queue.submit([encoder.finish()]);
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.colony && typeof data.colony === 'object') return data.colony;
    if (Array.isArray(data.slots) && data.slots.length) return data.slots[0];
    return data;
  }

  _applySceneDataVisuals(data) {
    const source = this._resolveVisualSource(data);
    const ownerColor = parseHexColor(
      source?.colony_owner_color || source?.owner_color || source?.faction_color || '',
      '#7db7ee'
    );
    const isOwned = !!String(source?.colony_owner_color || source?.owner_color || source?.faction_color || '').trim();
    this._visualPalette = {
      owner: hexToRgbFloat(ownerColor),
      clear: isOwned ? [0.04, 0.07, 0.05] : [0.05, 0.06, 0.04],
    };
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateBodySolid, bodySolidDistance, bodySolidRadius, bodySolidBound,
    validateBodyGeology, validateTerrainRegions, terrainRegionCoverages, terrainRegionVisual,
    bodyGeologicalHeight, buildTerrainRegionSphereMesh, compositeSurfaceDistance, buildCompositeBodyMesh,
    COLONY_METERS_PER_UNIT, bodyCenterRadius,
    bodyFrameDirection, settlementFrame, applyTerrainSettlement, colonyDomeHeight, gradePersistentHeight,
    ColonySurfaceLevelWebGPU, COLONY_CITY_WGSL, COLONY_BODY_WGSL, COLONY_VFX_WGSL, COLONY_SKY_WGSL,
    normalizeCitySlots, buildCityGeometry, cityCameraMatrix, cityCameraPose, colonyAtmosphereState, projectCityPoint,
    mapColonySurfacePoint, projectColonySurfacePoint, resolveBodySurface,
    sampleColonyTerrain, buildColonyTerrainMesh, selectColonyTerrainLod, TERRAIN_LODS, TERRAIN_CACHE_BYTES,
    cubeSphereDirection, planCubeSphereTiles, validateTerrainManifest, CubeSphereTerrainStream, buildPersistedTerrainMesh,
    validateBodyShape, bodyShapeFactor, bodyGroundPoint, bodySurfaceNormal, constrainBodyCamera,
    cityPedestrians, cityEconomyStatus,
  };
} else {
  window.GQColonySurfaceLevelWebGPU = {
    ColonySurfaceLevelWebGPU, CubeSphereTerrainStream, bodyCenterRadius, COLONY_METERS_PER_UNIT,
    validateBodySolid, bodySolidDistance, bodySolidRadius, bodySolidBound,
    validateBodyGeology, validateTerrainRegions, terrainRegionCoverages, terrainRegionVisual,
    bodyGeologicalHeight, buildTerrainRegionSphereMesh, compositeSurfaceDistance, buildCompositeBodyMesh,
  };
}
