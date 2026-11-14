const id = (value) => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value)))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const point = (value) => Array.isArray(value) && value.length === 3
  && value.every((part) => typeof part === 'number' && Number.isFinite(part));

export function createTradeTransports({ api, session }) {
  let state = { transports: [], offset: 0 };
  let generation = 0;
  let controller = null;
  let disposed = false;
  const listeners = new Set();
  async function refresh() {
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    try {
      const data = await api.get('api/market.php?action=get_transports', { signal: controller.signal });
      if (disposed || version !== generation) return false;
      if (data?.success !== true || !id(data.now_unix) || !Array.isArray(data.transports)
        || data.transports.some((t) => !id(t.route_id) || !id(t.fleet_id) || !id(t.source_colony_id)
          || !id(t.target_colony_id) || !id(t.departure_unix) || !id(t.arrival_unix)
          || Number(t.arrival_unix) <= Number(t.departure_unix) || !point(t.origin) || !point(t.target)
          || !['outbound', 'return'].includes(t.phase)
          || (t.phase === 'outbound'
            ? typeof t.good_type !== 'string' || !t.good_type || !Number.isFinite(t.quantity) || t.quantity <= 0
            : t.good_type !== null || t.quantity !== 0))
        || new Set(data.transports.map((t) => Number(t.fleet_id))).size !== data.transports.length
        || new Set(data.transports.map((t) => Number(t.route_id))).size !== data.transports.length) {
        throw new Error('Ungültige Transportdaten vom Server.');
      }
      state = { transports: data.transports, offset: Number(data.now_unix) * 1000 - Date.now() };
      listeners.forEach((listener) => listener(state));
      return true;
    } catch (error) {
      if (error.name !== 'AbortError' && !disposed && version === generation) {
        session.events.emit('game:data-error', { error });
      }
      return false;
    }
  }
  const unsubscribe = session.events.on('colony:mutation-accepted', () => { void refresh(); });
  const unsubscribeOverview = session.events.on('overview:updated', () => { void refresh(); });
  return {
    refresh,
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    shutdown() { disposed = true; generation++; controller?.abort(); unsubscribe(); unsubscribeOverview(); listeners.clear(); },
  };
}

export function transportVessel(route, offset) {
  return {
    id: `trade-transport:${route.fleet_id}`, space_entity: 'vessel',
    model_url: 'procedural:transport', display_name: `Transportschiff ${route.route_id}${route.phase === 'return' ? ' · Rückflug' : ''}`,
    route: [route.origin, route.target], visual_scale_ly: 1e-12,
    trade_clock: { departure: Number(route.departure_unix) * 1000,
      arrival: Number(route.arrival_unix) * 1000, offset },
  };
}
