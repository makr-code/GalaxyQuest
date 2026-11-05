function positiveInt(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function validStar(star) {
  return star && positiveInt(star.galaxy_index) && positiveInt(star.system_index)
    && ['x_ly', 'y_ly', 'z_ly'].every((key) => Number.isFinite(star[key]));
}

export function createGalaxyDomain({ api, session }) {
  let state = { galaxy: null, stars: [], selected: null, system: null, loading: false, error: '' };
  let controller = null;
  let revision = 0;
  let disposed = false;
  const listeners = new Set();
  const getState = () => structuredClone(state);
  const publish = () => listeners.forEach((listener) => listener(getState()));
  function report(error) {
    state.error = error.message;
    window.GQLog?.error?.('[galaxy]', error.message);
    window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
  }
  async function navigate(galaxy, system = null, reload = false) {
    if (disposed) return;
    if (!positiveInt(galaxy) || Number(galaxy) > 9 || (system !== null && !positiveInt(system))) {
      report(new Error('Ungültige Galaxie- oder Systemkoordinaten.'));
      publish();
      return;
    }
    const version = ++revision;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    state.loading = true;
    state.error = '';
    publish();
    try {
      let stars = state.stars;
      if (reload || state.galaxy !== Number(galaxy) || !stars.length) {
        const data = await api.get(`api/galaxy.php?action=stars&galaxy=${Number(galaxy)}&from=1&max_points=9000`, { signal });
        if (disposed || version !== revision) return;
        if (data?.success !== true || Number(data.galaxy) !== Number(galaxy)
            || !Array.isArray(data.stars) || data.stars.some((star) => !validStar(star)
              || Number(star.galaxy_index) !== Number(galaxy))) {
          throw new Error('Ungültige Galaxiedaten vom Server.');
        }
        stars = data.stars;
      }
      let payload = null;
      let selected = null;
      if (system !== null) {
        payload = await api.get(`api/galaxy.php?action=system&galaxy=${Number(galaxy)}&system=${Number(system)}&format=json`, { signal });
        if (disposed || version !== revision) return;
        if (payload?.success !== true || Number(payload.galaxy) !== Number(galaxy)
            || Number(payload.system) !== Number(system) || !payload.star_system || !Array.isArray(payload.planets)) {
          throw new Error('Ungültige Systemdaten vom Server.');
        }
        const catalogStar = stars.find((star) => Number(star.system_index) === Number(system));
        selected = { ...payload.star_system, galaxy_index: Number(galaxy), system_index: Number(system) };
        if (!validStar(selected)) throw new Error('Systemposition fehlt in den Serverdaten.');
        selected = { ...catalogStar, ...selected };
        stars = catalogStar
          ? stars.map((star) => star === catalogStar ? selected : star)
          : [...stars, selected];
      }
      if (disposed || version !== revision) return;
      state = { galaxy: Number(galaxy), stars, selected, system: payload, loading: false, error: '' };
    } catch (error) {
      if (disposed || version !== revision) return;
      report(error);
    } finally {
      if (!disposed && version === revision) {
        state.loading = false;
        publish();
      }
    }
  }
  function select(star) {
    if (disposed) return;
    const owned = state.stars.find((candidate) => Number(candidate.galaxy_index) === Number(star?.galaxy_index)
      && Number(candidate.system_index) === Number(star?.system_index));
    if (!owned) return;
    revision++;
    controller?.abort();
    state.selected = owned;
    state.system = null;
    state.loading = false;
    state.error = '';
    publish();
  }
  function home() {
    const colony = session.getColony();
    if (colony) return navigate(colony.galaxy, colony.system);
    return navigate(1);
  }
  let lastColonyId = session.getColony()?.id ?? null;
  const unsubscribe = session.events.on('overview:updated', () => {
    const colony = session.getColony();
    if ((colony?.id ?? null) === lastColonyId) return;
    lastColonyId = colony?.id ?? null;
    if (colony) void home();
  });
  return {
    getState, navigate, select, home,
    overview() { return navigate(state.galaxy ?? session.getColony()?.galaxy ?? 1); },
    refresh() {
      const galaxy = state.galaxy ?? session.getColony()?.galaxy ?? 1;
      const system = state.system?.system ?? null;
      return navigate(galaxy, system, true);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    shutdown() {
      disposed = true;
      revision++;
      controller?.abort();
      unsubscribe();
      listeners.clear();
      state = { galaxy: null, stars: [], selected: null, system: null, loading: false, error: '' };
    },
  };
}
