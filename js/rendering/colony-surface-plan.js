(function () {
  'use strict';

  const VERSION = 1;
  const URBAN_VERSION = 1;
  const MAX_SETTLEMENTS = 12;
  const MAX_URBAN_CHILDREN = 7;
  const MAX_ROAD_SEGMENTS = 64;
  const SITE_FLOATS = 24 + MAX_URBAN_CHILDREN * 4;
  const ROAD_FLOATS = 16;
  const TRAFFIC_PERIOD = 120;
  const ROAD_OFFSET = 8 + MAX_SETTLEMENTS * SITE_FLOATS;
  const UNIFORM_BYTES = (ROAD_OFFSET + 4 + MAX_ROAD_SEGMENTS * ROAD_FLOATS) * 4;
  const dot = (a, b) => a.reduce((sum, n, axis) => sum + n * b[axis], 0);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  function hash(value) {
    let result = 2166136261;
    for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0;
    return result;
  }

  function source(data) {
    const selected = data?.focusPlanet || data?.planet || data?.target || data || {};
    const slot = selected.__slot || selected.slot || selected;
    return { ...(slot.player_planet || slot.generated_planet || slot.body || slot), ...selected, ...data?.colony };
  }

  function development(data) {
    const colony = source(data);
    const population = count(colony.population);
    const weights = [0, 0, 0];
    const civic = [0, 0];
    const buildings = Array.isArray(data?.buildings) ? data.buildings : [];
    for (const building of buildings) {
      if (building.meta?.zone === 'orbital') continue;
      const level = count(building.level);
      const type = `${building.type || building.building_type || ''} ${building.meta?.cat || building.category || ''}`.toLowerCase();
      if (/farm|agri|food|hydropon/.test(type)) weights[0] += level;
      else if (/mine|mining|quarry|extraction/.test(type)) weights[1] += level;
      else if (/factory|refinery|forge|smelt|industr/.test(type)) weights[2] += level;
      else if (/trade|market|commerc|logistic/.test(type)) civic[0] += level;
      else if (/research|science|university|laboratory/.test(type)) civic[1] += level;
    }
    const capacity = weights.reduce((sum, n) => sum + n, 0);
    const total = Math.max(1, capacity);
    const inhabited = population > 0 || buildings.some((building) => count(building.level) > 0)
      || (Array.isArray(data?.slots) && data.slots.some((slot) => count(slot?.level) > 0));
    const lights = colony.powered === false || colony.active === false ? 0
      : clamp(count(colony.activity ?? colony.effects?.state?.activity ?? 1), 0, 1)
        * (1 - clamp(count(colony.damage ?? colony.effects?.state?.damage), 0, 1));
    return {
      population, weights: weights.map((n) => n / total), capacity, lights,
      civic: civic.map(n => n / Math.max(1, capacity + civic[0] + civic[1])),
      count: inhabited ? clamp(1 + Math.floor(Math.log2(Math.max(1, population / 1000))), 1, MAX_SETTLEMENTS) : 0,
    };
  }

  function urbanCandidates(manifest, site, sample) {
    if (!Number.isSafeInteger(manifest?.seed) || !Number.isFinite(manifest.radius_km)
      || manifest.radius_km <= 0 || typeof sample !== 'function') {
      throw new TypeError('Invalid cosmetic urban geography');
    }
    const n = Math.hypot(site.direction[0], site.direction[2]);
    const east = n > 1e-8 ? [-site.direction[2] / n, 0, site.direction[0] / n] : [1, 0, 0];
    const north = [site.direction[1] * east[2] - site.direction[2] * east[1],
      site.direction[2] * east[0] - site.direction[0] * east[2],
      site.direction[0] * east[1] - site.direction[1] * east[0]];
    const result = [];
    for (let index = 0; index < MAX_URBAN_CHILDREN; index++) {
      const id = `${site.id}:urban-v${URBAN_VERSION}:${index}`;
      const random = key => hash(`${manifest.seed}:${id}:${key}`) / 4294967296;
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = random(`angle:${attempt}`) * Math.PI * 2;
        const distance = clamp((40 + index * 24 + random(`distance:${attempt}`) * 35) / manifest.radius_km, 0.006, 0.12);
        const direction = site.direction.map((value, axis) => value * Math.cos(distance)
          + (east[axis] * Math.cos(angle) + north[axis] * Math.sin(angle)) * Math.sin(distance));
        const terrain = sample(direction);
        if (!Number.isFinite(terrain.height) || !Number.isFinite(terrain.slope)) {
          throw new TypeError('Non-finite cosmetic urban terrain sample');
        }
        if (terrain.blocked || terrain.slope > 0.35
          || (['terran', 'ocean', 'lava'].includes(manifest.biome) && terrain.height <= (manifest.sea_level_km ?? 0))
          || result.some(other => dot(direction, other.direction) > Math.cos(0.003))) continue;
        result.push({ id, ordinal: index, direction, height: terrain.height, slope: terrain.slope,
          foundingPopulation: 500000 * 4 ** index * (0.85 + random('foundation') * 0.3) });
        break;
      }
    }
    return result;
  }

  function urbanAllocation(site, population, peakPopulation, state, manifest) {
    const ruralFraction = 0.12 + state.weights[0] * 0.33;
    const ruralPopulation = population * ruralFraction;
    const budget = population - ruralPopulation;
    const historicalBudget = peakPopulation * (1 - ruralFraction);
    const children = (site.urbanCandidates || []).filter(candidate => historicalBudget > candidate.foundingPopulation)
      .map(candidate => {
        const residents = Math.max(0, budget - candidate.foundingPopulation) * 0.06;
        const historical = Math.max(0, historicalBudget - candidate.foundingPopulation) * 0.06;
        const radius = Math.min(0.35, Math.sqrt(residents || historical) * 0.012 / manifest.radius_km);
        return { ...candidate, population: residents, radius, ruined: residents === 0 };
      });
    const residents = budget - children.reduce((sum, child) => sum + child.population, 0);
    const historical = historicalBudget
      - children.reduce((sum, child) => sum + Math.max(0, historicalBudget - child.foundingPopulation) * 0.06, 0);
    return { population: residents, ruralPopulation, historicalPopulation: historical, children };
  }

  function regionalPopulation(population, index, available) {
    const weights = Array.from({ length: available }, (_, i) =>
      (i === 0 ? 1.4 : 0.9) * Math.max(0, population - (i === 0 ? 0 : 1000 * 2 ** i)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return total > 0 ? population * weights[index] / total : 0;
  }

  // This list depends only on public geography, never on population, owner or camera.
  function candidates(manifest, sample) {
    if (!manifest || manifest.biome === 'gas') return [];
    if (!Number.isSafeInteger(manifest.seed) || !Number.isFinite(manifest.radius_km) || manifest.radius_km <= 0) {
      throw new TypeError('Invalid living surface geography');
    }
    if (typeof sample !== 'function') throw new TypeError('Living surface requires a terrain sampler');
    const rotation = hash(`${manifest.seed}:settlements:${VERSION}`) / 4294967296 * Math.PI * 2;
    const sites = [];
    const liquid = ['terran', 'ocean', 'lava'].includes(manifest.biome);
    for (let index = 0; index < 768; index++) {
      const y = 1 - 2 * (index + 0.5) / 768;
      const longitude = index * Math.PI * (3 - Math.sqrt(5)) + rotation;
      const radius = Math.sqrt(1 - y * y);
      const direction = [radius * Math.cos(longitude), y, radius * Math.sin(longitude)];
      const terrain = sample(direction);
      if (!Number.isFinite(terrain.height) || !Number.isFinite(terrain.slope)) {
        throw new TypeError('Non-finite living surface terrain sample');
      }
      if (terrain.blocked || terrain.slope > 0.35
          || (liquid && terrain.height <= (manifest.sea_level_km ?? 0))
          || (manifest.biome === 'terran' && (Math.abs(y) > 0.88 || terrain.height > manifest.amplitude_km * 0.55))) continue;
      sites.push({
        id: `surface-v${VERSION}-${index}`, direction, height: terrain.height, slope: terrain.slope,
        score: terrain.slope * 4 + Math.abs(y) * 0.12
          + hash(`${manifest.seed}:site:${index}`) / 4294967296 * 0.08,
      });
    }
    sites.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    const selected = [];
    if (manifest.settlement) {
      selected.push({ id: 'surface-persisted', direction: [...manifest.settlement.direction],
        height: manifest.settlement.floor_height_km, slope: 0 });
    }
    while (selected.length < MAX_SETTLEMENTS) {
      let next = null, bestScore = Infinity;
      for (const site of sites) {
        const proximity = selected.length ? Math.max(...selected.map((other) => dot(site.direction, other.direction))) : -1;
        if (proximity >= 0.88) continue;
        const score = site.score + proximity * 0.7;
        if (score < bestScore) { next = site; bestScore = score; }
      }
      if (!next) break;
      selected.push(next);
    }
    return selected.map(site => ({ ...site, urbanCandidates: urbanCandidates(manifest, site, sample) }));
  }

  function roadNetwork(manifest, sites, sample) {
    const network = { routes: [], disconnected: [], unsupported: !!manifest?.solid };
    if (!manifest || manifest.biome === 'gas' || manifest.solid || sites.length < 2) return network;
    if (sites.length > MAX_SETTLEMENTS || !Number.isSafeInteger(manifest.seed)
        || !Number.isFinite(manifest.radius_km) || manifest.radius_km <= 0 || typeof sample !== 'function') {
      throw new TypeError('Invalid regional road geography or sampler');
    }
    const liquid = ['terran', 'ocean', 'lava'].includes(manifest.biome);
    const passable = direction => {
      const terrain = sample(direction);
      if (!Number.isFinite(terrain.height) || !Number.isFinite(terrain.slope)) {
        throw new TypeError('Non-finite regional road terrain sample');
      }
      return !terrain.blocked && terrain.slope <= 0.35
        && (!liquid || terrain.height > (manifest.sea_level_km ?? 0));
    };
    const angle = (a, b) => Math.acos(clamp(dot(a, b), -1, 1));
    const segmentAllowed = (a, b) => {
      const arc = angle(a, b);
      if (arc < 1e-8 || arc > 1.4) return false;
      const steps = Math.ceil(arc / 0.012);
      const sine = Math.sin(arc);
      for (let index = 0; index <= steps; index++) {
        const t = index / steps;
        const direction = a.map((n, axis) => (n * Math.sin((1 - t) * arc) + b[axis] * Math.sin(t * arc)) / sine);
        if (!passable(direction)) return false;
      }
      return true;
    };
    // A public, seed-rotated equal-area graph permits land detours without camera-dependent routing.
    const rotation = hash(`${manifest.seed}:roads:1`) / 4294967296 * Math.PI * 2;
    const nodes = [];
    for (let index = 0; index < 192; index++) {
      const y = 1 - 2 * (index + 0.5) / 192;
      const longitude = index * Math.PI * (3 - Math.sqrt(5)) + rotation;
      const r = Math.sqrt(1 - y * y);
      const direction = [r * Math.cos(longitude), y, r * Math.sin(longitude)];
      if (passable(direction)) nodes.push(direction);
    }
    const gridCount = nodes.length;
    nodes.push(...sites.map(site => site.direction));
    const edges = nodes.map(() => []);
    const tested = new Set();
    const connect = (a, b) => {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (tested.has(key)) return;
      tested.add(key);
      if (!segmentAllowed(nodes[a], nodes[b])) return;
      const distance = angle(nodes[a], nodes[b]);
      edges[a].push({ node: b, distance });
      edges[b].push({ node: a, distance });
    };
    for (let index = 0; index < nodes.length; index++) {
      nodes.slice(0, gridCount).map((direction, node) => ({ node, distance: angle(nodes[index], direction) }))
        .filter(entry => entry.node !== index).sort((a, b) => a.distance - b.distance || a.node - b.node)
        .slice(0, 8).forEach(entry => connect(index, entry.node));
      if (index >= gridCount) {
        for (let earlier = gridCount; earlier < index; earlier++) connect(index, earlier);
      }
    }
    let segments = 0;
    for (let index = 1; index < sites.length; index++) {
      const start = gridCount + index;
      const distances = nodes.map(() => Infinity), previous = nodes.map(() => -1);
      const visited = new Set();
      distances[start] = 0;
      let end = -1;
      while (visited.size < nodes.length) {
        let next = -1;
        for (let node = 0; node < nodes.length; node++) {
          if (!visited.has(node) && (next < 0 || distances[node] < distances[next])) next = node;
        }
        if (next < 0 || !Number.isFinite(distances[next])) break;
        if (next >= gridCount && next < start) { end = next; break; }
        visited.add(next);
        for (const edge of edges[next]) {
          // Later settlements never influence an existing prefix's route.
          if (edge.node > start || visited.has(edge.node)) continue;
          const distance = distances[next] + edge.distance;
          if (distance < distances[edge.node]) {
            distances[edge.node] = distance;
            previous[edge.node] = next;
          }
        }
      }
      if (end < 0) { network.disconnected.push({ id: sites[index].id, reason: 'no-land-route' }); continue; }
      const path = [];
      for (let node = end; node !== -1; node = previous[node]) path.unshift(nodes[node]);
      const points = [path[0]];
      for (let from = 0; from < path.length - 1;) {
        let to = path.length - 1;
        while (to > from + 1 && !segmentAllowed(path[from], path[to])) to--;
        points.push(path[to]);
        from = to;
      }
      if (segments + points.length - 1 > MAX_ROAD_SEGMENTS) {
        network.disconnected.push({ id: sites[index].id, reason: 'segment-budget' });
        continue;
      }
      segments += points.length - 1;
      network.routes.push({
        id: `road-v1:${sites[index].id}:${sites[end - gridCount].id}`,
        from: sites[index].id, to: sites[end - gridCount].id, activation: index, points,
      });
    }
    return network;
  }

  function regionalEconomy(state, manifest, sites) {
    const suitability = sites.map(site => {
      const relief = clamp((site.height - (manifest.sea_level_km ?? 0)) / Math.max(0.001, manifest.amplitude_km ?? 1), 0, 1);
      const flat = 1 - clamp((site.slope ?? 0) / 0.35, 0, 1);
      const temperate = 1 - clamp(Math.abs(Math.abs(site.direction[1]) - 0.3) / 0.6, 0, 1);
      const outdoors = manifest.biome === 'terran' || manifest.biome === 'ocean';
      const primaryProximity = (1 + dot(site.direction, sites[0].direction)) / 2;
      return [
        outdoors ? 0.05 + flat ** 2 * temperate ** 2 * (1 - relief) ** 2 : 0.2 + flat,
        0.05 + relief ** 2 * 3 + (1 - flat) ** 2,
        0.1 + flat ** 2 * (0.25 + primaryProximity),
      ];
    });
    const totals = [0, 1, 2].map(sector => suitability.reduce((sum, values) => sum + values[sector], 0));
    return suitability.map(values => {
      const capacity = values.map((value, sector) => state.capacity * state.weights[sector] * value / totals[sector]);
      const total = capacity.reduce((sum, n) => sum + n, 0);
      return { capacity: total, sectorCapacity: capacity, weights: capacity.map(n => total > 0 ? n / total : 0) };
    });
  }

  function specializationLabel(site, german = false) {
    if (!site || site.ruined || !site.weights?.some(n => n > 0)) return '';
    const index = site.weights.indexOf(Math.max(...site.weights));
    if (site.weights[index] < 0.5) return german ? 'Mischwirtschaft' : 'Mixed economy';
    return (german ? ['Landwirtschaft', 'Bergbau', 'Industrie'] : ['Agriculture', 'Mining', 'Industry'])[index];
  }

  function plan(data, manifest, sites, network = null) {
    const state = development(data);
    const history = data?.body_development;
    if (history != null && (history.version !== VERSION || !Number.isSafeInteger(history.body_id)
        || history.body_id !== manifest?.body_id || !Number.isSafeInteger(history.founded_count)
        || history.founded_count < 1 || history.founded_count > MAX_SETTLEMENTS
        || !Number.isSafeInteger(history.peak_population) || history.peak_population < state.population
        || history.founded_count !== Math.max(1, development({ population: history.peak_population }).count))) {
      throw new TypeError('Invalid or stale body development history');
    }
    const founded = Math.max(state.count, history?.founded_count || 0);
    const outdoorAgriculture = manifest?.biome === 'terran' || manifest?.biome === 'ocean';
    const regions = regionalEconomy(state, manifest, sites.slice(0, state.count));
    const settlements = sites.slice(0, founded).map((site, index) => {
      const ruined = index >= state.count;
      const economy = regions[index] || { capacity: 0, sectorCapacity: [0, 0, 0], weights: [0, 0, 0] };
      const pressure = economy.capacity * regions.length;
      const activeCount = Math.min(state.count, sites.length);
      const foundedCount = Math.min(founded, sites.length);
      const population = ruined ? 0 : regionalPopulation(state.population, index, activeCount);
      const peak = Math.max(population, regionalPopulation(history?.peak_population || state.population, index, foundedCount));
      const allocation = urbanAllocation(site, population, peak, state, manifest);
      const share = allocation.population || allocation.historicalPopulation;
      const maximumRadius = 0.025 + 0.325 * clamp((share - 1000000000) / 10000000000, 0, 1);
      const radius = clamp(Math.sqrt(Math.max(1000, share)) * 0.012 / manifest.radius_km, 0.0015, maximumRadius)
        * Math.min(1, share / 1000);
      return {
        ...site, radius, ruined, ...allocation,
        parcelScale: clamp(12 / manifest.radius_km, 0.0002, 0.006),
        landRadius: Math.min(0.18, radius * (3 + Math.log2(1 + pressure))
          + Math.min(0.1, Math.sqrt(pressure) * 0.012)),
        ...economy,
      };
    });
    // Infill joins only already-nearby, active centres; this is not a traversable road route.
    for (const site of settlements) {
      const nearby = settlements.filter(other => other !== site && !other.ruined && !site.ruined)
        .map(other => ({ other, distance: Math.hypot(...site.direction.map((n, axis) => n - other.direction[axis])) }))
        .filter(({ distance }) => distance < 0.35)
        .sort((a, b) => a.distance - b.distance || a.other.id.localeCompare(b.other.id))[0];
      site.conurbation = nearby ? {
        direction: nearby.other.direction,
        width: Math.min(site.radius, nearby.other.radius) * 0.22
          * clamp(((site.radius + nearby.other.radius) / nearby.distance - 0.65) / 0.55, 0, 1),
      } : { direction: site.direction, width: 0 };
    }
    return {
      version: VERSION, urbanVersion: URBAN_VERSION, seed: manifest?.seed ?? 0, settlements, state,
      urbanSettlements: settlements.flatMap(site => [
        { id: site.id, direction: site.direction, population: site.population, radius: site.radius,
          ruined: site.ruined, foundingPopulation: 0 },
        ...site.children,
      ]),
      ruralPopulation: settlements.reduce((sum, site) => sum + site.ruralPopulation, 0),
      unallocatedPopulation: settlements.length ? 0 : state.population,
      outdoorAgriculture, unavailable: founded > 0 && settlements.length === 0,
      history: history || null,
      roads: network?.routes.filter(route => route.activation < settlements.length).map(route => {
        const from = settlements.find(site => site.id === route.from);
        const to = settlements.find(site => site.id === route.to);
        if (!from || !to) throw new RangeError('Regional road endpoint is not a founded settlement');
        const mix = from.weights.map((n, sector) => n + to.weights[sector]);
        return { ...route, ruined: from.ruined || to.ruined,
          trafficSector: mix.indexOf(Math.max(...mix)),
          freight: (from.weights[1] + from.weights[2] + to.weights[1] + to.weights[2]) / 2 };
      }) || [],
      roadStatus: {
        unsupported: network?.unsupported || false,
        disconnected: network?.disconnected.filter(site => settlements.some(active => active.id === site.id)) || [],
      },
    };
  }

  function roadSegments(route) {
    if (!Array.isArray(route.points) || route.points.length < 2) throw new TypeError('Invalid regional road points');
    if (route.points.length - 1 > MAX_ROAD_SEGMENTS) throw new RangeError('Regional road segment budget exceeded');
    return route.points.slice(1).map((b, index) => {
      const a = route.points[index];
      if (![a, b].every(point => Array.isArray(point) && point.length === 3
          && point.every(Number.isFinite) && Math.abs(Math.hypot(...point) - 1) < 1e-6)) {
        throw new TypeError('Invalid regional road direction');
      }
      const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const length = Math.hypot(...normal);
      const angle = Math.atan2(length, dot(a, b));
      if (length < 1e-8 || angle > 1.4) throw new TypeError('Invalid regional road segment');
      return { a, b, normal: normal.map(n => n / length), angle };
    });
  }

  function inspectSettlement(surfacePlan, settlementId, policy) {
    const index = surfacePlan?.settlements.findIndex(site => site.id === settlementId) ?? -1;
    if (index < 0) throw new RangeError('Cannot inspect an unknown settlement');
    const site = surfacePlan.settlements[index];
    const connections = surfacePlan.roads.filter(route => route.from === site.id || route.to === site.id).map(route => {
      const peerId = route.from === site.id ? route.to : route.from;
      const peerIndex = surfacePlan.settlements.findIndex(other => other.id === peerId);
      if (peerIndex < 0) throw new RangeError('Regional road endpoint is not a founded settlement');
      return { id: route.id, peerId, peerIndex, ruined: route.ruined };
    });
    const unavailable = surfacePlan.roadStatus.disconnected.find(other => other.id === site.id)?.reason;
    const transport = site.ruined ? 'ruins'
      : surfacePlan.roadStatus.unsupported ? 'unsupported'
        : !connections.some(route => !route.ruined) ? 'no-active-route'
          : surfacePlan.state.population <= 0 ? 'no-population'
            : surfacePlan.state.capacity <= 0 ? 'no-capacity'
              : surfacePlan.state.lights <= 0 ? 'inactive'
                : !policy?.visible ? 'hidden' : !policy.motion ? 'motion-disabled' : 'decorative';
    return {
      id: site.id, index, ruined: site.ruined, specialization: specializationLabel(site),
      weights: [...site.weights], activity: site.ruined ? 0 : surfacePlan.state.lights,
      cultivation: site.ruined || site.weights[0] <= 0 ? 'none' : surfacePlan.outdoorAgriculture ? 'outdoor' : 'protected',
      connections, routeStatus: surfacePlan.roadStatus.unsupported ? 'unsupported' : unavailable || 'available',
      transport,
    };
  }

  function trafficPosition(route, seed, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Invalid regional traffic time');
    const segments = roadSegments(route);
    const total = segments.reduce((sum, segment) => sum + segment.angle, 0);
    const phase = ((seconds % TRAFFIC_PERIOD) / TRAFFIC_PERIOD
      + hash(`${seed}:${route.id}:traffic-v1`) / 4294967296) % 1;
    const progress = 1 - Math.abs(phase * 2 - 1);
    let remaining = progress * total;
    for (const [index, segment] of segments.entries()) {
      if (remaining <= segment.angle || index === segments.length - 1) {
        const t = clamp(remaining / segment.angle, 0, 1);
        const direction = segment.a.map((n, axis) => (n * Math.sin(segment.angle * (1 - t))
          + segment.b[axis] * Math.sin(segment.angle * t)) / Math.sin(segment.angle));
        return { direction, progress };
      }
      remaining -= segment.angle;
    }
    throw new RangeError('Regional traffic position exceeds its route');
  }

  function uniforms(surfacePlan, seconds = 0, policy = null) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Invalid regional traffic time');
    const data = new Float32Array(UNIFORM_BYTES / 4);
    if (!surfacePlan) return data;
    data.set([surfacePlan.settlements.length, surfacePlan.state.lights, surfacePlan.outdoorAgriculture ? 1 : 0,
      hash(`${surfacePlan.seed}:land-use:${VERSION}`) / 4294967296], 0);
    data.set([...surfacePlan.state.weights, Math.min(1, surfacePlan.state.capacity / 10)], 4);
    surfacePlan.settlements.forEach((site, index) => {
      const offset = 8 + index * SITE_FLOATS;
      data.set([...site.direction, site.radius], offset);
      data.set([site.landRadius, site.height, site.ruined ? 1 : 0, site.parcelScale], offset + 4);
      const n = Math.hypot(site.direction[0], site.direction[2]);
      const parcelSeed = hash(`${surfacePlan.seed}:${site.id}:landscape-v1`) % 65536;
      data.set(n > 1e-8 ? [-site.direction[2] / n, 0, site.direction[0] / n, parcelSeed]
        : [1, 0, 0, parcelSeed], offset + 8);
      data.set([...site.weights, site.capacity], offset + 12);
      data.set([...(surfacePlan.state.civic || [0, 0]), site.weights[0], site.weights[1] + site.weights[2]], offset + 16);
      data.set([...site.conurbation.direction, site.conurbation.width], offset + 20);
      site.children.forEach(child => {
        data.set([...child.direction, child.radius * (child.ruined ? -1 : 1)], offset + 24 + child.ordinal * 4);
      });
    });
    const width = 0.00035 + Math.min(0.00065, Math.sqrt(surfacePlan.state.capacity) * 0.0001);
    const trafficEnabled = policy?.motion === true && policy.visible === true
      && surfacePlan.state.lights > 0 && surfacePlan.state.capacity > 0 && surfacePlan.state.population > 0;
    let segment = 0;
    for (const route of surfacePlan.roads || []) {
      const segments = roadSegments(route);
      const traffic = trafficEnabled && !route.ruined ? trafficPosition(route, surfacePlan.seed, seconds) : null;
      if (traffic && ![0, 1, 2].includes(route.trafficSector)) throw new TypeError('Invalid regional traffic sector');
      for (const { a, b, normal } of segments) {
        if (segment >= MAX_ROAD_SEGMENTS) throw new RangeError('Regional road segment budget exceeded');
        const offset = ROAD_OFFSET + 4 + segment * ROAD_FLOATS;
        data.set([...a, width], offset);
        data.set([...b, route.ruined ? 1 : 0], offset + 4);
        data.set([...normal, route.freight], offset + 8);
        if (traffic) data.set([...traffic.direction, route.trafficSector + 1], offset + 12);
        segment++;
      }
    }
    data[ROAD_OFFSET] = segment;
    return data;
  }

  function satelliteGeometry(surfacePlan, settlementId, biome) {
    const index = surfacePlan.settlements.findIndex(site => site.id === settlementId);
    if (index < 0 || (index === 0 && !surfacePlan.settlements[index].ruined)) {
      throw new RangeError('Decorative geometry requires an active satellite settlement or ruins');
    }
    const site = surfacePlan.settlements[index];
    const parts = [];
    const lots = [];
    const spacing = 3.1;
    const width = spacing * 8, depth = width;
    const add = (x, y, z, sx, sy, sz, color) => parts.push({ x, y, z, sx, sy, sz, color });
    const random = (key) => hash(`${surfacePlan.seed}:${site.id}:geometry-v${VERSION}:${key}`) / 4294967296;
    const residential = [0.42, 0.53, 0.57], roof = [0.58, 0.67, 0.69];
    const sealed = ['ice', 'rock', 'lava'].includes(biome);
    for (let row = -4; row <= 4; row++) {
      add(row * spacing, 0.07, 0, 0.45, 0.03, depth + 0.5, [0.16, 0.20, 0.24]);
      add(0, 0.07, row * spacing, width + 0.5, 0.03, 0.45, [0.16, 0.20, 0.24]);
    }
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const key = `${column}:${row}`;
        lots.push({
          key, x: (column - 3.5) * spacing, z: (row - 3.5) * spacing,
          distance: Math.hypot(column - 3.5, row - 3.5), order: random(`${key}:order`),
        });
      }
    }
    lots.sort((a, b) => a.distance - b.distance || a.order - b.order);
    const population = site.ruined ? surfacePlan.history.peak_population : surfacePlan.state.population;
    // Fixed lot coordinates and per-lot hashes keep existing architecture stable during growth.
    const occupied = clamp(12 + Math.floor(Math.log2(1 + population / 1000)) * 4, 12, lots.length);
    for (const [lotIndex, lot] of lots.slice(0, occupied).entries()) {
      const { x, z, key } = lot;
      const height = 0.9 + random(`${key}:height`) * 2.8;
      const economic = !site.ruined && lotIndex % 4 === 3 && site.capacity > 0;
      const sector = random(`${key}:sector`);
      const [agriculture, mining] = site.weights;
      add(x, 0.02, z, 2.45, 0.12, 2.45, [0.28, 0.34, 0.35]);
      if (!economic) {
        add(x, 0.15, z, 1.65, height, 1.7, residential);
        add(x, height + 0.15, z, 1.85, 0.15, 1.9, roof);
        for (let floor = 0; floor < 3; floor++) {
          add(x, 0.45 + floor * 0.25, z + 0.86, 1.3, 0.09, 0.025, [0.74, 0.87, 0.85]);
        }
      } else if (sector < agriculture) {
        for (let row = 0; row < 4; row++) {
          add(x - 0.8 + row * 0.53, 0.15, z, 0.35, sealed || !surfacePlan.outdoorAgriculture ? 0.6 : 0.16,
            1.9, sealed || !surfacePlan.outdoorAgriculture ? [0.42, 0.65, 0.66] : [0.30, 0.53, 0.18]);
        }
      } else if (sector < agriculture + mining) {
        add(x, 0.15, z, 1.85, 0.7, 1.8, [0.47, 0.40, 0.30]);
        add(x - 0.55, 0.85, z, 0.22, 1.3, 0.22, roof);
        add(x, 2.15, z, 1.3, 0.18, 0.22, roof);
      } else {
        add(x, 0.15, z, 2.1, 0.95, 1.8, [0.40, 0.46, 0.49]);
        add(x, 1.1, z, 2.25, 0.15, 1.95, roof);
        add(x - 0.6, 0.15, z - 0.4, 0.3, 2.4, 0.3, [0.47, 0.48, 0.49]);
      }
    }
    const visibleParts = site.ruined ? parts.filter(part => {
      const key = `${Math.round(part.x / spacing + 3.5)}:${Math.round(part.z / spacing + 3.5)}`;
      const ceiling = 0.5 + random(`ruin:${key}`) * 1.3;
      if (part.y >= ceiling) return false;
      part.sy = Math.min(part.sy, ceiling - part.y);
      part.color = part.color.map((n, axis) => n * 0.25 + [0.20, 0.18, 0.15][axis]);
      return true;
    }) : parts;
    return { parts: visibleParts, width, depth, decorative: true, occupiedLots: occupied, ruined: !!site.ruined };
  }

  const WGSL = `
struct GQLivingSite {
  center: vec4<f32>, land: vec4<f32>, east: vec4<f32>, economy: vec4<f32>,
  civic: vec4<f32>, connection: vec4<f32>, nuclei: array<vec4<f32>,7>,
};
struct GQLivingRoad { start: vec4<f32>, end: vec4<f32>, plane: vec4<f32>, traffic: vec4<f32> };
struct GQLivingSurface {
  state: vec4<f32>, economy: vec4<f32>, sites: array<GQLivingSite,12>,
  roadState: vec4<f32>, roads: array<GQLivingRoad,64>,
};
@group(0) @binding(3) var<uniform> gqLiving: GQLivingSurface;
struct GQEconomicLandscape {
  farm: vec3<f32>, quarry: vec3<f32>, industry: vec3<f32>, roughness: vec3<f32>,
};
fn gqEconomicLandscape(cells: vec2<f32>, pixelCells: f32, seed: u32) -> GQEconomicLandscape {
  let parcel = gqHash(vec2<i32>(floor(cells)),seed) * 0.5 + 0.5;
  let position = fract(cells);
  let edge = min(position,1.0 - position);
  let interior = smoothstep(0.025,0.09,min(edge.x,edge.y));
  let detail = 1.0 - smoothstep(0.25,1.0,pixelCells);
  let fineDetail = 1.0 - smoothstep(0.2,0.8,pixelCells * 8.0);
  let axis = select(position.x,position.y,parcel > 0.5);
  let cropRows = 0.5 + 0.5 * cos(axis * 50.26548246);
  let crop = mix(vec3<f32>(0.25,0.40,0.12),vec3<f32>(0.62,0.52,0.25),parcel);
  let farm = mix(vec3<f32>(0.19,0.29,0.10),
    crop * mix(0.88,mix(0.76,1.0,cropRows),fineDetail),interior);

  let quarryPoint = (position - vec2<f32>(0.5 + (parcel - 0.5) * 0.12,0.5))
    * vec2<f32>(1.0,1.15 + parcel * 0.3);
  let pitRadius = length(quarryPoint);
  let pit = 1.0 - smoothstep(0.32,0.48,pitRadius);
  let terraces = 0.5 + 0.5 * cos(pitRadius * 75.39822369);
  let benchDetail = 1.0 - smoothstep(0.2,0.8,pixelCells * 12.0);
  let benches = mix(0.5,terraces,benchDetail);
  let quarry = mix(vec3<f32>(0.46,0.40,0.32),
    mix(vec3<f32>(0.22,0.19,0.16),vec3<f32>(0.63,0.54,0.40),benches),pit);

  let hallPosition = abs(fract(cells * 2.0) - vec2<f32>(0.5));
  let hall = (1.0 - smoothstep(0.29,0.35,hallPosition.x))
    * (1.0 - smoothstep(0.19,0.25,hallPosition.y)) * interior;
  let loading = (1.0 - smoothstep(0.035,0.08,abs(position.y - 0.5))) * interior;
  let roof = mix(vec3<f32>(0.32,0.38,0.42),vec3<f32>(0.49,0.52,0.52),parcel);
  let industrial = mix(vec3<f32>(0.17,0.19,0.21),roof,hall);
  let industry = mix(industrial,vec3<f32>(0.54,0.46,0.26),loading * 0.6);
  var out: GQEconomicLandscape;
  // Fade fine structure before parcel structure, then converge to sector averages.
  out.farm = gqLinear(mix(vec3<f32>(0.40,0.43,0.19),farm,detail));
  out.quarry = gqLinear(mix(vec3<f32>(0.43,0.37,0.29),quarry,detail));
  out.industry = gqLinear(mix(vec3<f32>(0.25,0.29,0.31),industry,detail));
  out.roughness = mix(vec3<f32>(0.88,0.94,0.72),
    vec3<f32>(0.86 + (1.0 - interior) * 0.1,0.86 + pit * 0.12,0.91 - hall * 0.38),detail);
  return out;
}
fn gqWindLandscape(input: GQEconomicLandscape, cells: vec2<f32>, pixelCells: f32,
    seed: u32, seconds: f32, strength: f32) -> GQEconomicLandscape {
  let detail = 1.0 - smoothstep(0.2,0.8,pixelCells * 8.0);
  if (strength <= 0.0 || detail <= 0.0) { return input; }
  let identity = gqHash(vec2<i32>(0),seed) * 3.14159265359;
  let wind = vec2<f32>(cos(identity),sin(identity));
  let phase = seconds * (6.28318530718 / 120.0);
  let gust = 0.65 + 0.35 * sin(phase * 3.0 + identity);
  let wave = sin(dot(cells,wind) * 12.56637061436 - phase * 8.0 + identity);
  let edge = min(fract(cells),1.0 - fract(cells));
  let canopy = smoothstep(0.04,0.14,min(edge.x,edge.y));
  var out = input;
  out.farm *= 1.0 + wave * gust * canopy * detail * clamp(strength,0.0,1.0) * 0.08;
  return out;
}
fn gqUrbanNoise(point: vec2<f32>, seed: u32) -> f32 {
  let cell = vec2<i32>(floor(point));
  let f = fract(point);
  let blend = f * f * (3.0 - 2.0 * f);
  return mix(mix(gqHash(cell,seed),gqHash(cell + vec2<i32>(1,0),seed),blend.x),
    mix(gqHash(cell + vec2<i32>(0,1),seed),gqHash(cell + vec2<i32>(1,1),seed),blend.x),blend.y) * 0.5 + 0.5;
}
// Stable world-sized districts survive growth; only occupancy and the envelope change.
fn gqUrbanStructure(local: vec2<f32>, radius: f32, scale: f32,
    footprint: f32, seed: u32, civic: vec4<f32>, infill: f32) -> vec3<f32> {
  let angle = gqHash(vec2<i32>(0),seed) * 3.14159265;
  let p = vec2<f32>(dot(local,vec2<f32>(cos(angle),sin(angle))),
    dot(local,vec2<f32>(-sin(angle),cos(angle))));
  let districtScale = scale * 5.0;
  let noise = gqUrbanNoise(p / districtScale,seed);
  let broad = gqUrbanNoise(p / (districtScale * 3.0),seed + 17u);
  let axes = min(abs(p.x),min(abs(p.y),abs(p.x * 0.65 + p.y * 0.76)));
  let arms = 1.0 - smoothstep(radius * 0.08,radius * 0.26,axes);
  let reach = radius * (0.62 + broad * 0.48 + arms * 0.32);
  let envelope = 1.0 - smoothstep(reach * 0.72,reach,length(p));
  let core = 1.0 - smoothstep(0.0,max(radius * 0.6,0.00001),length(p));
  let density = clamp(0.23 + core * 0.5 + arms * 0.22 + civic.x * 0.2
    - civic.z * 0.18 + civic.w * 0.08,0.05,0.95);
  let occupancy = smoothstep(0.48,0.65,noise + density * 0.5);
  let blockScale = scale * mix(1.0,1.8,civic.w);
  let cells = p / blockScale;
  let cellEdge = min(fract(cells),1.0 - fract(cells));
  let lineDistance = min(cellEdge.x,cellEdge.y) * blockScale;
  let aa = max(footprint * 0.7,blockScale * 0.015);
  let streets = 1.0 - smoothstep(blockScale * 0.025,blockScale * 0.025 + aa,lineDistance);
  let resolved = 1.0 - smoothstep(0.3,1.2,footprint / blockScale);
  let lots = gqHash(vec2<i32>(floor(cells)),seed + 39u) * 0.5 + 0.5;
  let windows = smoothstep(0.24,0.65,lots) * (1.0 - streets);
  let districtEdge = min(fract(p / districtScale),1.0 - fract(p / districtScale));
  let arterialDistance = min(axes,min(districtEdge.x,districtEdge.y) * districtScale);
  let arterialWidth = scale * (0.06 + civic.x * 0.12);
  let arterialAA = max(footprint * 0.65,scale * 0.015);
  let arterial = (1.0 - smoothstep(arterialWidth,arterialWidth + arterialAA,arterialDistance))
    * min(1.0,arterialWidth / arterialAA);
  let detailedLight = streets * 0.32 + windows * (0.09 + core * 0.15);
  let filteredLight = mix(0.04 + density * 0.07,detailedLight,resolved);
  let extent = max(envelope,infill);
  let built = extent * max(occupancy,arterial * 0.8);
  let lamps = max(occupancy * filteredLight,arterial * (0.6 + civic.x * 0.4));
  return vec3<f32>(built,extent * lamps,built * core);
}
fn gqLivingSurface(input: GQSurface, bodyPoint: vec3<f32>, normal: vec3<f32>,
    light: vec3<f32>, material: f32, regionWeight: f32) -> GQSurface {
  var out = input;
  let direction = normalize(bodyPoint);
  let footprint = max(length(dpdx(direction)),length(dpdy(direction)));
  let night = 1.0 - smoothstep(-0.15,0.2,dot(normal,light));
  // Derivatives stay outside all non-uniform branches for WebGPU uniformity.
  let blocked = (material > 0.5 && material < 1.5) || material > 2.5 || regionWeight > 0.5;
  let eligible = select(smoothstep(0.94,0.99,dot(normal,direction)),0.0,blocked);
  var best = 0.0;
  var urbanMask = 0.0;
  var roadUrbanMask = 0.0;
  var urbanLight = vec3<f32>(0.0);
  var urbanColor = vec3<f32>(0.0);
  for (var i = 0u; i < u32(gqLiving.state.x); i++) {
    let site = gqLiving.sites[i];
    let siteActivity = 1.0 - site.land.z;
    let distance = length(direction - site.center.xyz);
    let land = (1.0 - smoothstep(site.land.x * 0.65,site.land.x,distance)) * eligible;
    let north = cross(site.center.xyz,site.east.xyz);
    let local = vec2<f32>(dot(direction,site.east.xyz),dot(direction,north));
    let fieldScale = max(site.land.w,0.000001);
    let segment = site.connection.xyz - site.center.xyz;
    let t = clamp(dot(direction - site.center.xyz,segment) / max(dot(segment,segment),0.000001),0.0,1.0);
    let connectionPoint = normalize(mix(site.center.xyz,site.connection.xyz,t));
    let corridorDistance = length(direction - connectionPoint);
    let infill = (1.0 - smoothstep(site.connection.w * 0.5,
      site.connection.w + max(footprint,0.000001),corridorDistance))
      * select(0.0,1.0,site.connection.w > 0.0);
    var structure = vec3<f32>(0.0);
    if (site.center.w > 0.0) {
      structure = gqUrbanStructure(local,site.center.w,
        fieldScale,footprint,u32(site.east.w),site.civic,infill);
    }
    for (var childIndex = 0u; childIndex < 7u; childIndex++) {
      let child = site.nuclei[childIndex];
      let radius = abs(child.w);
      // Uniform footprint is computed above; no derivatives in this spatial cull.
      if (radius > 0.0 && length(direction - child.xyz) < radius * 1.6) {
        let childLocal = vec2<f32>(dot(direction - child.xyz,site.east.xyz),
          dot(direction - child.xyz,north));
        var childStructure = gqUrbanStructure(childLocal,radius,fieldScale,footprint,
          u32(site.east.w) + (childIndex + 1u) * 101u,site.civic,0.0);
        childStructure.y *= select(0.0,1.0,child.w > 0.0);
        structure = max(structure,childStructure);
      }
    }
    let sameHemisphere = select(0.0,1.0,dot(direction,site.center.xyz) > 0.8);
    let urban = structure.x * eligible * sameHemisphere;
    let activeLight = structure.y * eligible * siteActivity * sameHemisphere;
    let lamp = mix(mix(vec3<f32>(1.0,0.60,0.24),vec3<f32>(1.0,0.38,0.12),site.civic.w),
      vec3<f32>(0.48,0.74,1.0),site.civic.y);
    urbanLight = max(urbanLight,lamp * activeLight);
    if (urban > urbanMask) {
      urbanColor = gqLinear(mix(vec3<f32>(0.27,0.30,0.31),vec3<f32>(0.39,0.42,0.44),structure.z))
        * mix(0.55,1.0,siteActivity);
    }
    urbanMask = max(urbanMask,urban);
    roadUrbanMask = max(roadUrbanMask,max(urban,
      (1.0 - smoothstep(site.center.w * 0.6,site.center.w,distance)) * eligible));
    let cells = local / fieldScale;
    let detailWeight = 1.0 - smoothstep(0.25,1.0,footprint / fieldScale);
    let parcel = gqHash(vec2<i32>(floor(cells)),u32(site.east.w));
    let sector = parcel * 0.5 + 0.5;
    let farmDistrict = select(0.0,1.0,sector < site.economy.x);
    let mineDistrict = select(0.0,1.0,sector >= site.economy.x && sector < site.economy.x + site.economy.y);
    let industryDistrict = select(0.0,1.0,sector >= site.economy.x + site.economy.y && site.economy.z > 0.0);
    let agricultural = land * (1.0 - urban) * mix(site.economy.x,farmDistrict,detailWeight) * gqLiving.state.z * siteActivity;
    let mining = land * (1.0 - urban) * mix(site.economy.y,mineDistrict,detailWeight) * siteActivity;
    let industry = land * (1.0 - urban * 0.5) * mix(site.economy.z,industryDistrict,detailWeight) * siteActivity;
    let influence = max(urban,max(agricultural,max(mining,industry)));
    if (influence > best) {
      best = influence;
      let landscape = gqWindLandscape(
        gqEconomicLandscape(cells,footprint / fieldScale,u32(site.east.w)),
        cells,footprint / fieldScale,u32(site.east.w),gqMaterial.anchor.w,
        select(0.0,gqLiving.state.z * siteActivity,gqMaterial.origin.w == 1));
      out.albedo = mix(input.albedo,landscape.farm,agricultural * 0.85);
      out.albedo = mix(out.albedo,landscape.quarry,mining * 0.85);
      out.albedo = mix(out.albedo,landscape.industry,industry * 0.8);
      var regionalRoughness = mix(input.roughness,landscape.roughness.x,agricultural * 0.85);
      regionalRoughness = mix(regionalRoughness,landscape.roughness.y,mining * 0.85);
      regionalRoughness = mix(regionalRoughness,landscape.roughness.z,industry * 0.8);
      out.roughness = regionalRoughness;
    }
  }
  out.albedo = mix(out.albedo,urbanColor,urbanMask * 0.95);
  out.roughness = mix(out.roughness,0.72,urbanMask);
  out.emission = input.emission + urbanLight * night * gqLiving.state.y * 0.9;
  var roadMask = 0.0;
  var activeRoadMask = 0.0;
  var freightMask = 0.0;
  var trafficMask = 0.0;
  var trafficColor = vec3<f32>(0.0);
  for (var i = 0u; i < u32(gqLiving.roadState.x); i++) {
    let road = gqLiving.roads[i];
    let onArc = dot(cross(road.start.xyz,direction),road.plane.xyz) >= 0.0
      && dot(cross(direction,road.end.xyz),road.plane.xyz) >= 0.0
      && dot(direction,road.start.xyz + road.end.xyz) > 0.0;
    let distance = select(min(length(direction - road.start.xyz),length(direction - road.end.xyz)),
      abs(dot(direction,road.plane.xyz)),onArc);
    let width = max(road.start.w,min(0.0015,footprint * 0.6));
    let coverage = (1.0 - smoothstep(width,width + max(footprint,0.00001),distance))
      * min(1.0,width / max(footprint,0.00001));
    roadMask = max(roadMask,coverage * eligible * (1.0 - roadUrbanMask));
    activeRoadMask = max(activeRoadMask,coverage * eligible * (1.0 - roadUrbanMask) * (1.0 - road.end.w));
    freightMask = max(freightMask,coverage * eligible * (1.0 - roadUrbanMask) * (1.0 - road.end.w) * road.plane.w);
    if (road.traffic.w > 0.0 && road.end.w < 0.5) {
      let radius = max(road.start.w * 2.0,min(0.0045,footprint * 1.1));
      let convoy = (1.0 - smoothstep(radius,radius + max(footprint,0.00001),
        length(direction - road.traffic.xyz))) * coverage * eligible * (1.0 - roadUrbanMask) * gqLiving.state.y;
      if (convoy > trafficMask) {
        trafficMask = convoy;
        trafficColor = select(vec3<f32>(0.48,0.85,0.28),vec3<f32>(1.0,0.63,0.22),road.traffic.w > 1.5);
        trafficColor = select(trafficColor,vec3<f32>(0.35,0.72,1.0),road.traffic.w > 2.5);
      }
    }
  }
  let corridor = gqLinear(mix(vec3<f32>(0.38,0.34,0.26),vec3<f32>(0.19,0.22,0.25),
    freightMask / max(roadMask,0.00001)));
  out.albedo = mix(out.albedo,corridor,roadMask * 0.9);
  out.roughness = mix(out.roughness,0.88,roadMask);
  out.emission += vec3<f32>(1.0,0.62,0.25) * activeRoadMask * night * gqLiving.state.y * 0.12;
  out.albedo = mix(out.albedo,gqLinear(trafficColor),trafficMask * 0.85);
  out.emission += trafficColor * trafficMask * night * 0.8;
  return out;
}
`;

  const api = {
    VERSION, URBAN_VERSION, MAX_SETTLEMENTS, MAX_URBAN_CHILDREN, MAX_ROAD_SEGMENTS, SITE_FLOATS, ROAD_FLOATS, ROAD_OFFSET, TRAFFIC_PERIOD,
    UNIFORM_BYTES, source, development, candidates, roadNetwork, plan, uniforms, trafficPosition,
    satelliteGeometry, specializationLabel, inspectSettlement, urbanCandidates, WGSL,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GQColonySurfacePlan = api;
})();
