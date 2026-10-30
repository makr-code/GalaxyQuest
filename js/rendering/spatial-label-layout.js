import { Ray, Sphere, Vector3 } from 'three';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const CLASS_NAMES = {
  gas_giant: 'Gas giant', ice_giant: 'Ice giant', hot_jupiter: 'Hot Jupiter',
  rocky: 'Rocky planet', super_earth: 'Super-Earth', ocean: 'Ocean world',
  ice_dwarf: 'Ice dwarf', lava: 'Lava world', comet_belt: 'Comet belt',
};

const OBJECT_NAMES = {
  stargate: 'Stargate', star_gate: 'Stargate', starbase: 'Starbase', star_base: 'Starbase',
  space_station: 'Space station', orbital_facility: 'Orbital facility',
  shipyard: 'Orbital shipyard', hydroponic_farm: 'Orbital farm', farm: 'Orbital farm',
};

const NUMBER_FORMATTERS = new Map();

function displayNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  if (!NUMBER_FORMATTERS.has(digits)) {
    NUMBER_FORMATTERS.set(digits, new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }));
  }
  return NUMBER_FORMATTERS.get(digits).format(number);
}

export function formatSpatialObjectDetails(data = {}, kind = 'object') {
  const values = [];
  if (kind === 'star' || kind === 'system') {
    const spectralClass = String(data.spectral_class || '').trim();
    if (spectralClass) {
      const subtype = data.subtype !== undefined && data.subtype !== null && data.subtype !== ''
        ? `${spectralClass}${displayNumber(data.subtype, 1)}` : spectralClass;
      values.push(subtype);
    }
    if (Number(data.temperature_k) > 0) values.push(`${displayNumber(data.temperature_k, 0)} K`);
    if (Number(data.mass_solar) > 0) values.push(`${displayNumber(data.mass_solar, 2)} M_sun`);
    return values.join(' | ');
  }

  const rawType = String(data.object_type || data.building_type || data.type || data.planet_class || '').toLowerCase();
  const className = CLASS_NAMES[rawType] || '';
  const objectName = OBJECT_NAMES[rawType] || '';
  if (objectName) values.push(objectName);
  else if (kind === 'comet') values.push('Comet');
  else if (kind === 'rogue_planet') values.push(`Rogue ${className || 'planet'}`);
  else if (className) values.push(kind === 'moon' ? `${className} moon` : className);
  else if (kind === 'moon') values.push('Moon');
  else if (rawType.includes('comet')) values.push('Comet');
  else if (kind !== 'planet') values.push(String(data.display_type || kind).replaceAll('_', ' '));

  const diameter = Number(data.diameter_km ?? data.diameter);
  if (diameter > 0) values.push(`${displayNumber(diameter, 0)} km`);
  if (kind === 'moon' && Number(data.semi_major_axis_parent_r) > 0) {
    values.push(`${displayNumber(data.semi_major_axis_parent_r, 1)} Rp`);
  } else if (Number(data.semi_major_axis_au) > 0) {
    values.push(`${displayNumber(data.semi_major_axis_au, 2)} AU`);
  } else if (Number(data.preview_orbit_radius_au) > 0) {
    values.push(`${displayNumber(data.preview_orbit_radius_au, 2)} AU orbit`);
  }
  if (kind === 'comet' && Number.isFinite(Number(data.orbital_eccentricity))) {
    values.push(`e ${displayNumber(data.orbital_eccentricity, 2)}`);
  }
  const level = Number(data.building_level ?? data.level ?? data.tier);
  if (level > 0) values.push(`Level ${displayNumber(level, 0)}`);
  if (data.status) values.push(String(data.status).replaceAll('_', ' '));
  if (kind === 'planet' && data.inhabited === true) values.push('Inhabited');
  return values.slice(0, 3).join(' | ');
}

function bodyName(body, kind, index) {
  const data = body.userData.data || {};
  if (data.name || data.catalog_name || data.label) return String(data.catalog_name || data.name || data.label);
  if (kind === 'star') return `System ${data.system_index || index + 1}`;
  if (kind === 'moon') return `Moon ${data.position || data.moon_index || index + 1}`;
  const objectType = String(data.object_type || data.building_type || data.type || kind).toLowerCase();
  if (OBJECT_NAMES[objectType]) return `${OBJECT_NAMES[objectType]} ${data.id || index + 1}`;
  return `Planet ${data.position || index + 1}`;
}

function isOccluded(camera, worldPosition, ownBody, bodies) {
  const direction = worldPosition.clone().sub(camera.position);
  const targetDistance = direction.length();
  if (targetDistance <= 0) return false;
  const ray = new Ray(camera.position, direction.divideScalar(targetDistance));
  const hit = new Vector3();
  return bodies.some((body) => {
    if (body === ownBody || body.userData.type === 'colony-site') return false;
    const center = body.getWorldPosition(new Vector3());
    const sphere = new Sphere(center, body.userData.radius);
    if (!ray.intersectSphere(sphere, hit)) return false;
    return hit.distanceTo(camera.position) < targetDistance - Math.max(body.userData.radius * 0.01, 1e-15);
  });
}

function intersects(bounds, previous) {
  return bounds.left < previous.right && bounds.right > previous.left
    && bounds.top < previous.bottom && bounds.bottom > previous.top;
}

export function createSpatialStarIndex(stars) {
  const points = (Array.isArray(stars) ? stars : []).flatMap((star) => {
    const coordinates = [Number(star?.x_ly), Number(star?.y_ly), Number(star?.z_ly)];
    return coordinates.every(Number.isFinite) ? [{ star, coordinates }] : [];
  });
  const build = (entries, depth = 0) => {
    if (!entries.length) return null;
    const axis = depth % 3;
    entries.sort((left, right) => left.coordinates[axis] - right.coordinates[axis]);
    const middle = Math.floor(entries.length / 2);
    return {
      point: entries[middle],
      axis,
      left: build(entries.slice(0, middle), depth + 1),
      right: build(entries.slice(middle + 1), depth + 1),
    };
  };
  return { root: build(points), size: points.length };
}

export function querySpatialStarIndex(index, center, limit = 48) {
  if (!index?.root || !center || ![center.x, center.y, center.z].every(Number.isFinite)) return [];
  const maximum = Math.max(1, Math.floor(limit));
  const target = [center.x, center.y, center.z];
  const heap = [];
  const siftDown = (start) => {
    let parent = start;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let largest = parent;
      if (left < heap.length && heap[left].distanceSquared > heap[largest].distanceSquared) largest = left;
      if (right < heap.length && heap[right].distanceSquared > heap[largest].distanceSquared) largest = right;
      if (largest === parent) break;
      [heap[parent], heap[largest]] = [heap[largest], heap[parent]];
      parent = largest;
    }
  };
  const offer = (entry) => {
    if (heap.length < maximum) {
      heap.push(entry);
      let child = heap.length - 1;
      while (child > 0) {
        const parent = Math.floor((child - 1) / 2);
        if (heap[parent].distanceSquared >= heap[child].distanceSquared) break;
        [heap[parent], heap[child]] = [heap[child], heap[parent]];
        child = parent;
      }
    } else if (entry.distanceSquared < heap[0].distanceSquared) {
      heap[0] = entry;
      siftDown(0);
    }
  };
  const visit = (node) => {
    if (!node) return;
    const point = node.point.coordinates;
    const dx = point[0] - target[0];
    const dy = point[1] - target[1];
    const dz = point[2] - target[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    offer({ star: node.point.star, distanceSquared });
    const delta = target[node.axis] - point[node.axis];
    visit(delta <= 0 ? node.left : node.right);
    const worstDistance = heap.length < maximum ? Infinity : heap[0].distanceSquared;
    if (delta * delta <= worstDistance) visit(delta <= 0 ? node.right : node.left);
  };
  visit(index.root);
  return heap.sort((left, right) => left.distanceSquared - right.distanceSquared).map((entry) => entry.star);
}

export function resolveSpatialLabels(flight, galaxyStars, { width, height, maxLabels = 6, pixelRatio = 1 } = {}) {
  if (!flight?.camera || width <= 0 || height <= 0) {
    return { level: 'galaxy', labels: [], sourceStars: 0, queriedStars: 0, visibleCandidates: 0 };
  }

  const camera = flight.camera;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const bodies = flight.bodies || [];
  const starBody = bodies.find((body) => body.userData.type === 'star');
  const planets = bodies.filter((body) => body.userData.type === 'planet');
  const moons = bodies.filter((body) => body.userData.type === 'moon');
  const systemExtent = Math.max(1e-14, ...planets.map((body) => body.position.length() + body.userData.radius));
  const starDistance = starBody
    ? starBody.getWorldPosition(new Vector3()).distanceTo(camera.position)
    : Infinity;
  const nearestPlanet = planets.slice().sort((left, right) => (
    left.getWorldPosition(new Vector3()).distanceTo(camera.position) - right.getWorldPosition(new Vector3()).distanceTo(camera.position)
  ))[0] || null;
  const nearestPlanetDistance = nearestPlanet
    ? Math.max(0, nearestPlanet.getWorldPosition(new Vector3()).distanceTo(camera.position) - nearestPlanet.userData.radius)
    : Infinity;
  const level = !starBody || starDistance > systemExtent * 80
    ? 'galaxy'
    : nearestPlanet && nearestPlanetDistance / nearestPlanet.userData.radius < 180
      ? 'planet'
      : 'system';

  const candidates = [];
  let sourceStars = 0;
  let queriedStars = 0;
  if (level === 'galaxy') {
    const origin = flight.origin || new Vector3();
    const starIndex = Array.isArray(galaxyStars) ? createSpatialStarIndex(galaxyStars) : galaxyStars;
    const nearbyStars = querySpatialStarIndex(starIndex, origin, 48);
    sourceStars = Number(starIndex?.size || 0);
    queriedStars = nearbyStars.length;
    for (let index = 0; index < nearbyStars.length; index++) {
      const star = nearbyStars[index];
      const worldPosition = new Vector3(Number(star.x_ly), Number(star.y_ly), Number(star.z_ly));
      if (!worldPosition.toArray().every(Number.isFinite)) continue;
      candidates.push({
        id: `system:${star.galaxy_index}:${star.system_index}`,
        kind: 'system',
        text: String(star.catalog_name || star.name || `System ${star.system_index}`),
        data: star,
        worldPosition,
        localPosition: worldPosition.clone().sub(origin),
        radius: 0,
        distance: worldPosition.clone().sub(origin).distanceTo(camera.position),
        priority: star.name || star.catalog_name ? 1 : 0,
      });
    }
  } else {
    const facilities = bodies.filter((body) => !['star', 'planet', 'moon', 'colony-site'].includes(body.userData.type));
    const visibleBodies = level === 'system' ? [starBody, ...planets, ...facilities] : [nearestPlanet,
      ...moons.filter((body) => body.userData.parentPosition === nearestPlanet?.userData.data?.position),
      ...facilities.filter((body) => body.userData.parentPosition === nearestPlanet?.userData.data?.position)];
    for (let index = 0; index < visibleBodies.length; index++) {
      const body = visibleBodies[index];
      if (!body) continue;
      const localPosition = body.getWorldPosition(new Vector3());
      const worldPosition = localPosition.clone().add(flight.origin || new Vector3());
      const data = body.userData.data || {};
      candidates.push({
        id: `${body.userData.type}:${body.userData.parentPosition || ''}:${data.position || data.moon_index || data.id || 0}`,
        kind: body.userData.type,
        text: bodyName(body, body.userData.type, index),
        data,
        worldPosition,
        localPosition,
        radius: body.userData.radius,
        distance: localPosition.distanceTo(camera.position),
        priority: body === nearestPlanet || body === starBody ? 3 : 2,
        body,
      });
    }
  }

  const focalPixels = Math.abs(camera.projectionMatrix.elements[5]) * height * 0.5;
  const visible = [];
  for (const candidate of candidates) {
    const cameraDepth = candidate.localPosition.clone().applyMatrix4(camera.matrixWorldInverse).z * -1;
    if (cameraDepth <= 0 || (candidate.body && isOccluded(camera, candidate.localPosition, candidate.body, bodies))) continue;
    const projected = candidate.localPosition.clone().project(camera);
    if (!Number.isFinite(projected.x) || projected.z < -1 || projected.z > 1
      || Math.abs(projected.x) > 0.97 || Math.abs(projected.y) > 0.97) continue;
    const ratio = clamp(Number(pixelRatio) || 1, 1, 3);
    const apparentRadiusPx = candidate.radius > 0 ? candidate.radius * focalPixels / cameraDepth : 0;
    const fontSize = clamp(18 + Math.sqrt(apparentRadiusPx / ratio) * 0.75, 18, 24) * ratio;
    const detailFontSize = candidate.detail ? 12 * ratio : 0;
    const titleWidth = candidate.text.length * fontSize * 0.58;
    const detailWidth = String(candidate.detail || '').length * detailFontSize * 0.56;
    const widthPx = clamp(Math.max(titleWidth, detailWidth) + 18 * ratio, 68 * ratio, 248);
    const heightPx = fontSize + detailFontSize + (candidate.detail ? 16 : 12) * ratio;
    const x = (projected.x + 1) * width * 0.5;
    const bodyOffset = Math.min(42 * ratio, apparentRadiusPx + heightPx * 0.65);
    const y = (1 - projected.y) * height * 0.5 - bodyOffset;
    visible.push({ ...candidate, x, y, width: widthPx, height: heightPx, fontSize, detailFontSize,
      apparentRadiusPx, level });
  }

  visible.sort((left, right) => right.priority - left.priority
    || left.distance - right.distance
    || Math.hypot(left.x - width * 0.5, left.y - height * 0.5) - Math.hypot(right.x - width * 0.5, right.y - height * 0.5));
  const selected = [];
  const occupied = [];
  const levelLimit = level === 'galaxy' ? Math.min(maxLabels, 5) : level === 'system' ? Math.min(maxLabels, 6) : Math.min(maxLabels, 4);
  for (const candidate of visible) {
    const bounds = { left: candidate.x - candidate.width / 2, right: candidate.x + candidate.width / 2,
      top: candidate.y - candidate.height / 2, bottom: candidate.y + candidate.height / 2 };
    if (occupied.some((previous) => intersects(bounds, previous))) continue;
    occupied.push(bounds);
    selected.push(candidate);
    if (selected.length >= levelLimit) break;
  }
  const labels = selected.map(({ data, ...label }) => ({
    ...label,
    detail: formatSpatialObjectDetails(data, label.kind),
  }));
  return { level, labels, sourceStars, queriedStars, visibleCandidates: visible.length };
}