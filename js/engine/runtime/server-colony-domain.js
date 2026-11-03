export function createServerColonyDomain({ api, session, name, read, prepareCommand }) {
  let state = { colonyId: null, data: null, loading: false, mutating: false, error: '', message: '' };
  let request = null;
  let mutationRequest = null;
  let revision = 0;
  let disposed = false;
  const listeners = new Set();
  const getState = () => structuredClone(state);
  const publish = () => {
    for (const listener of listeners) listener(getState());
  };
  const report = (error) => {
    window.GQLog?.error?.(`[${name}]`, error.message);
    window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
  };
  function changeColony() {
    const id = session.getColony()?.id ?? null;
    if (Number(id) === Number(state.colonyId)) return;
    revision++;
    request?.abort();
    request = null;
    state = { ...state, colonyId: id, data: null, loading: false, error: '', message: '' };
    publish();
  }
  const unsubscribe = session.events.on('overview:updated', changeColony);
  changeColony();

  async function load() {
    if (disposed || !state.colonyId) return false;
    const version = ++revision;
    const colonyId = state.colonyId;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    state.loading = true;
    state.error = '';
    publish();
    try {
      const data = await read(colonyId, controller.signal);
      if (disposed || version !== revision) return;
      state.data = data;
      return true;
    } catch (error) {
      if (disposed || version !== revision) return;
      state.error = error.message;
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
  async function command(action, value) {
    if (disposed || state.mutating) return;
    if (!state.colonyId) throw new Error('Select a colony first.');
    const colonyId = state.colonyId;
    const version = revision;
    const { endpoint, body } = prepareCommand(action, value, getState());
    state.mutating = true;
    state.error = '';
    state.message = '';
    publish();
    const controller = new AbortController();
    mutationRequest = controller;
    let accepted = false;
    try {
      await api.post(endpoint, body, { signal: controller.signal });
      accepted = true;
      if (disposed) return;
      session.events.emit('colony:mutation-accepted', {
        colonyId: Number(colonyId), domain: name, allColonies: body.colony_id == null,
      });
      if (version === revision) state.message = 'Auftrag serverseitig bestätigt.';
      // Do not reuse an overview request that started before the mutation.
      await session.refreshAfterMutation();
      if (disposed) return;
      const loaded = await load();
      if (!disposed && !loaded && state.error) {
        state.error = `Auftrag bestätigt, Liste konnte nicht aktualisiert werden: ${state.error}. Nur aktualisieren, nicht erneut beauftragen.`;
      }
    } catch (error) {
      if (disposed) return;
      state.error = accepted
        ? `Auftrag bestätigt, Aktualisierung fehlgeschlagen: ${error.message}. Nur aktualisieren, nicht erneut beauftragen.`
        : error.message;
      if (state.colonyId !== colonyId) state.error = `Auftrag für Kolonie ${colonyId}: ${state.error}`;
      report(error);
    } finally {
      if (!disposed) {
        mutationRequest = null;
        state.mutating = false;
        publish();
      }
    }
  }
  async function refresh() {
    if (disposed) return;
    try {
      await session.refresh();
      if (!disposed) await load();
    } catch (error) {
      if (disposed) return;
      state.error = error.message;
      report(error);
      publish();
    }
  }
  return {
    getState, load, refresh, command,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    shutdown() {
      disposed = true;
      revision++;
      request?.abort();
      mutationRequest?.abort();
      unsubscribe();
      listeners.clear();
      state = { colonyId: null, data: null, loading: false, mutating: false, error: '', message: '' };
    },
  };
}
