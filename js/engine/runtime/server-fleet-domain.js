function positiveInt(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validFleet(fleet) {
  return fleet && ['id', 'origin_colony_id', 'origin_galaxy', 'origin_system', 'origin_position',
    'target_galaxy', 'target_system', 'target_position'].every((key) => positiveInt(fleet[key]))
    && Number(fleet.origin_galaxy) <= 9 && Number(fleet.target_galaxy) <= 9
    && typeof fleet.mission === 'string' && fleet.mission.length > 0
    && [0, 1, '0', '1'].includes(fleet.returning)
    && fleet.ships && typeof fleet.ships === 'object' && !Array.isArray(fleet.ships)
    && Object.values(fleet.ships).every((count) => Number.isSafeInteger(Number(count)) && Number(count) >= 0)
    && ['cargo_metal', 'cargo_crystal', 'cargo_deuterium'].every((key) =>
      fleet[key] !== null && fleet[key] !== '' && Number.isFinite(Number(fleet[key])) && Number(fleet[key]) >= 0)
    && ['departure_time', 'arrival_time'].every((key) => typeof fleet[key] === 'string' && fleet[key].length > 0)
    && (fleet.fleet_label == null || typeof fleet.fleet_label === 'string')
    && (fleet.target_system_name == null || typeof fleet.target_system_name === 'string');
}

export function createFleetDomain({ api, session }) {
  let state = { fleets: null, loading: false, mutating: false, stale: false, error: '', message: '' };
  let disposed = false;
  let revision = 0;
  let request = null;
  let mutation = null;
  const listeners = new Set();
  const getState = () => structuredClone(state);
  const publish = () => listeners.forEach((listener) => listener(getState()));
  function report(error) {
    state.error = error.message;
    window.GQLog?.error?.('[fleets]', error.message);
    window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
  }
  async function read() {
    const version = ++revision;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    state.loading = true;
    state.error = '';
    publish();
    try {
      const data = await api.get('api/fleet.php?action=list', { signal: controller.signal });
      if (disposed || version !== revision) return false;
      if (data?.success !== true || !Array.isArray(data.fleets) || !data.fleets.every(validFleet)
        || new Set(data.fleets.map((fleet) => Number(fleet.id))).size !== data.fleets.length) {
        throw new Error('Ungültige Flottendaten vom Server.');
      }
      state.fleets = structuredClone(data.fleets);
      state.stale = false;
      return true;
    } catch (error) {
      if (disposed || version !== revision) return false;
      state.stale = true;
      report(error);
      return false;
    } finally {
      if (!disposed && version === revision) {
        request = null;
        state.loading = false;
        publish();
      }
    }
  }
  async function load() {
    if (disposed || state.mutating) return false;
    return read();
  }
  async function refresh() {
    if (disposed || state.mutating) return;
    const loaded = await read();
    if (disposed || !loaded) return;
    const version = revision;
    try {
      await session.refresh();
      if (!disposed && version === revision) state.message = '';
    } catch (error) {
      if (!disposed && version === revision) report(error);
    } finally {
      if (!disposed && version === revision) publish();
    }
  }
  async function command(action, fleetId) {
    if (disposed || state.mutating) return;
    try {
      if (!['recall', 'check'].includes(action)) throw new Error('Unbekannter Flottenbefehl.');
      if (state.stale || state.fleets === null) throw new Error('Bitte zuerst die Flottenliste aktualisieren.');
      if (action === 'recall' && !state.fleets.some((fleet) =>
        positiveInt(fleetId) && Number(fleet.id) === Number(fleetId) && Number(fleet.returning) === 0)) {
        throw new Error('Die Flotte ist nicht verfügbar oder bereits auf dem Rückweg.');
      }
    } catch (error) {
      report(error);
      publish();
      return;
    }
    revision++;
    request?.abort();
    request = null;
    state.loading = false;
    state.mutating = true;
    state.error = '';
    state.message = '';
    publish();
    const controller = new AbortController();
    const colonyId = Number(session.getColony()?.id ?? 0);
    mutation = controller;
    let accepted = false;
    try {
      const result = await api.post(`api/fleet.php?action=${action}`,
        action === 'recall' ? { fleet_id: Number(fleetId) } : {}, { signal: controller.signal });
      if (disposed) return;
      if (result?.success !== true) throw new Error(result?.error || 'Ungültige Befehlsantwort vom Server.');
      accepted = true;
      state.stale = true;
      state.message = action === 'recall' ? 'Rückruf serverseitig bestätigt.' : 'Ankünfte serverseitig verarbeitet.';
      if (action === 'check') {
        session.events.emit('colony:mutation-accepted', { colonyId, domain: 'fleets', allColonies: true });
      }
      await session.refreshAfterMutation();
      if (disposed) return;
      if (!await read() && !disposed) {
        report(new Error(`Befehl bestätigt, Liste konnte nicht aktualisiert werden: ${state.error}. Nur aktualisieren, nicht erneut beauftragen.`));
      }
    } catch (error) {
      if (disposed) return;
      report(accepted ? new Error(`Befehl bestätigt, Aktualisierung fehlgeschlagen: ${error.message}. Nur aktualisieren, nicht erneut beauftragen.`) : error);
    } finally {
      if (!disposed) {
        mutation = null;
        state.mutating = false;
        publish();
      }
    }
  }
  return {
    getState, load, refresh, command,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    shutdown() {
      disposed = true;
      revision++;
      request?.abort();
      mutation?.abort();
      listeners.clear();
      state = { fleets: null, loading: false, mutating: false, stale: false, error: '', message: '' };
    },
  };
}
