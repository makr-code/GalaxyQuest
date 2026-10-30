function waitForStep(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const finish = (completed) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function selectTarget(stars, previousKey, random) {
  const targets = stars.filter((star) => (
    Number.isFinite(Number(star?.galaxy_index))
    && Number.isFinite(Number(star?.system_index))
    && Number.isFinite(Number(star?.x_ly))
    && Number.isFinite(Number(star?.y_ly))
    && Number.isFinite(Number(star?.z_ly))
  ));
  if (!targets.length) return null;
  const alternatives = targets.filter((star) => `${star.galaxy_index}:${star.system_index}` !== previousKey);
  const pool = alternatives.length ? alternatives : targets;
  return pool[Math.floor(random() * pool.length)];
}

function createDemoDraft(data, random) {
  const planets = data.planets.map((planet) => {
    const position = Number(planet.position);
    return {
      ...planet,
      position,
      class: String(planet.planet_class || 'rocky'),
      semi_major_axis_au: Number(planet.semi_major_axis_au || 0),
      texture: data.planet_texture_manifest?.planets?.[String(position)] || null,
      moons: (Array.isArray(planet.moons) ? planet.moons : []).map((moon) => ({
        ...moon,
        position: Number(moon.moon_index),
        class: String(moon.planet_class || 'rocky'),
        semi_major_axis_au: Number(moon.semi_major_axis_parent_r || 0),
      })),
    };
  });
  const colonizable = planets.filter((planet) => planet.can_colonize);
  const withMoons = planets.filter((planet) => planet.moons.length);
  const colonizableWithMoons = colonizable.filter((planet) => planet.moons.length);
  const candidates = colonizableWithMoons.length
    ? colonizableWithMoons
    : withMoons.length ? withMoons : colonizable.length ? colonizable : planets;
  const selected = candidates[Math.floor(random() * candidates.length)];
  if (!selected) return null;
  return {
    star: data.system,
    planets,
    position: {
      galaxy: Number(data.system.galaxy_index),
      system: Number(data.system.system_index),
      position: selected.position,
    },
    preview_only: true,
  };
}

export function createStartFlightTour({
  getStars,
  showScene,
  navigateTo = () => false,
  readResumeState = () => null,
  restoreFlightCoordinates = () => false,
  getFlightCoordinates = () => null,
  writeFlightState = () => false,
  clearFlightState = () => {},
  onStatus = () => {},
  fetchImpl = globalThis.fetch,
  random = Math.random,
  flightDurationMs = 18000,
  planetDurationMs = 12000,
  surfaceDurationMs = 8000,
  retryDelayMs = 1200,
} = {}) {
  if (typeof getStars !== 'function' || typeof showScene !== 'function') {
    throw new TypeError('getStars and showScene callbacks are required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  let controller = null;
  let previousTargetKey = '';

  async function navigateAndPersist(target, durationMs, signal) {
    const navigation = navigateTo(target, { durationMs, signal });
    if (!navigation || typeof navigation.then !== 'function') return false;
    const initialState = getFlightCoordinates();
    if (initialState) writeFlightState(initialState);
    const persistTimer = setInterval(() => {
      const currentState = getFlightCoordinates();
      if (currentState) writeFlightState(currentState);
    }, 1000);
    try {
      const arrived = await navigation;
      if (arrived === true && initialState?.destination) {
        writeFlightState({ start: initialState.destination, destination: initialState.destination });
      }
      return arrived;
    } finally {
      clearInterval(persistTimer);
    }
  }

  async function run(signal) {
    const resumeState = readResumeState();
    if (resumeState && !signal.aborted) {
      onStatus('Resuming the previous galaxy flight.');
      let poseRestored = false;
      while (!signal.aborted && !poseRestored) {
        const sceneAccepted = showScene({ flightTour: true, stage: 'region', resume: true, stars: [] });
        poseRestored = sceneAccepted !== false && restoreFlightCoordinates(resumeState) === true;
        if (!poseRestored && !await waitForStep(retryDelayMs, signal)) break;
      }
      if (signal.aborted) return;
      if (poseRestored) {
        const [x_ly, y_ly, z_ly] = resumeState.destination;
        const arrived = await navigateAndPersist({ kind: 'point', x_ly, y_ly, z_ly }, flightDurationMs, signal);
        if (signal.aborted) return;
        if (arrived !== true) {
          clearFlightState();
          onStatus('Saved flight could not be resumed; starting a new route.');
        } else {
          onStatus('Previous flight destination reached. Continuing the galaxy tour.');
        }
      }
    }

    while (!signal.aborted) {
      const target = selectTarget(getStars(), previousTargetKey, random);
      if (!target) {
        onStatus('Waiting for the database galaxy sample.');
        if (!await waitForStep(retryDelayMs, signal)) break;
        continue;
      }

      previousTargetKey = `${target.galaxy_index}:${target.system_index}`;
      const sceneBase = {
        flightTour: true,
        target,
        stars: [target],
      };
      onStatus(`Travelling to ${target.catalog_name || target.name || `System ${target.system_index}`}.`);
      if (showScene({ ...sceneBase, stage: 'region' }) === false) {
        if (!await waitForStep(retryDelayMs, signal)) break;
        continue;
      }
      try {
        const url = `api/v1/galaxy.php?action=auth_flight_preview&galaxy=${encodeURIComponent(target.galaxy_index)}&system=${encodeURIComponent(target.system_index)}`;
        const response = await fetchImpl(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data?.success !== true || data.preview_only !== true || !data.system || !Array.isArray(data.planets)) {
          throw new Error('Invalid read-only system preview');
        }
        const draft = createDemoDraft(data, random);
        if (!draft) throw new Error('No planet is available for the visual preview');
        const planet = draft.planets.find((item) => item.position === draft.position.position);

        const sceneGraph = {
          type: 'galaxy',
          children: [{
            type: 'system',
            data: data.system,
            children: [
              ...draft.planets.map((body) => ({
                type: 'planet',
                data: body,
                children: [
                  ...body.moons.map((moon) => ({ type: 'moon', data: moon, children: [] })),
                  ...(body.facilities || []).map((facility) => ({ type: 'facility', data: facility, children: [] })),
                  ...(body.can_colonize ? [{ type: 'colony-site', previewOnly: true, children: [] }] : []),
                ],
              })),
              ...(data.free_comets || []).map((body) => ({ type: 'comet', data: body, children: [] })),
              ...(data.rogue_planets || []).map((body) => ({ type: 'rogue_planet', data: body, children: [] })),
              ...(data.star_installations || []).map((body, index) => ({
                type: 'star-installation',
                data: {
                  ...body,
                  preview_orbit_radius_au: Math.max(2, ...draft.planets.map((planet) => planet.semi_major_axis_au || 0))
                    * (1.15 + index * 0.06),
                  preview_only: true,
                },
                children: [],
              })),
            ],
          }],
        };
        const stages = [
          ['system', flightDurationMs, `Entering ${data.system.name}.`, { kind: 'system' }],
          ['planet', planetDurationMs, `Approaching ${planet.name || `planet ${planet.position}`}.`,
            { kind: 'planet', position: planet.position }],
          ...(planet.moons.length ? [['moon', planetDurationMs, `Passing ${planet.moons[0].name}.`,
            { kind: 'moon', position: planet.moons[0].position, parentPosition: planet.position }]] : []),
          ['surface', surfaceDurationMs, `Approaching the surface of ${planet.name || `planet ${planet.position}`}.`,
            { kind: 'surface', position: planet.position }],
        ];
        for (const [stage, duration, message, destination] of stages) {
          if (signal.aborted) break;
          onStatus(message);
          if (showScene({ ...sceneBase, stage, draft, sceneGraph }) === false) {
            throw new Error(`Renderer rejected the ${stage} preview stage`);
          }
          const arrived = await navigateAndPersist(destination, duration, signal);
          if (signal.aborted) break;
          if (arrived !== true) throw new Error('Spatial camera navigation is unavailable or interrupted');
        }
      } catch (error) {
        if (signal.aborted) break;
        onStatus(`Flight preview skipped: ${error.message}`);
        if (!await waitForStep(retryDelayMs, signal)) break;
      }

      if (signal.aborted) break;
      if (!await waitForStep(retryDelayMs, signal)) break;
    }
  }

  return {
    start() {
      if (controller) return true;
      controller = new AbortController();
      const current = controller;
      void run(current.signal).catch((error) => {
        if (!current.signal.aborted) onStatus(`Flight tour stopped: ${error.message}`);
      }).finally(() => {
        if (controller === current) controller = null;
      });
      return true;
    },
    stop() {
      if (!controller) return false;
      controller.abort();
      controller = null;
      clearFlightState();
      showScene(null);
      onStatus('Automatic galaxy flight stopped.');
      return true;
    },
    isRunning() {
      return controller !== null;
    },
  };
}