import { createServerColonyDomain } from './server-colony-domain.js';

const number = (value) => ['number', 'string'].includes(typeof value) && value !== ''
  && Number.isFinite(Number(value)) && Number(value) >= 0;
const positiveInt = (value) => number(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function createMarketDomain({ api, session }) {
  let stale = true;
  let revision = 0;
  let requestClock = Date.now() / 1000;
  let requestReadAt = Date.now();
  const requestNow = () => requestClock + (Date.now() - requestReadAt) / 1000;
  const unsubscribe = session.events.on('colony:mutation-accepted', () => { stale = true; revision++; });
  const commandApi = {
    async post(endpoint, body, options) {
      try {
        return await api.post(endpoint, body, options);
      } catch (error) {
        if (endpoint.includes('_request')) stale = true;
        throw error;
      }
    },
  };
  const domain = createServerColonyDomain({
    api: commandApi, session, name: 'market',
    async read(colonyId, signal) {
      stale = true;
      const version = revision;
      const prices = await api.get(`api/market.php?action=get_prices&colony_id=${colonyId}`, { signal });
      const [snapshot, history, orders] = await Promise.all([
        api.get(`api/colony_economy.php?action=snapshot&colony_id=${colonyId}`, { signal }),
        api.get('api/market.php?action=get_history&limit=20', { signal }),
        api.get(`api/market.php?action=list_orders&colony_id=${colonyId}`, { signal }),
      ]);
      const requests = orders?.requests ?? [];
      if (prices?.success !== true || !Array.isArray(prices.prices) || !prices.prices.length
        || prices.prices.some((entry) => !entry || typeof entry.good_type !== 'string' || !entry.good_type
          || !['base_price', 'price', 'supply', 'demand'].every((key) => number(entry[key])))
        || new Set(prices.prices.map((entry) => entry.good_type)).size !== prices.prices.length
        || snapshot?.success !== true || Number(snapshot.colony?.id) !== Number(colonyId)
        || !snapshot.economy?.stock || typeof snapshot.economy.stock !== 'object'
        || (Array.isArray(snapshot.economy.stock) && snapshot.economy.stock.length !== 0)
        || !Object.values(snapshot.economy.stock).every(number)
        || history?.success !== true || !Array.isArray(history.transactions)
        || history.transactions.some((entry) => !entry || !positiveInt(entry.id) || !positiveInt(entry.colony_id)
          || typeof entry.good_type !== 'string' || !entry.good_type || !['buy', 'sell'].includes(entry.direction)
          || !['quantity', 'price_per_unit', 'total_credits', 'trade_tax_rate', 'net_credits'].every((key) => number(entry[key]))
          || typeof entry.transacted_at !== 'string' || !entry.transacted_at)
        || new Set(history.transactions.map((entry) => Number(entry.id))).size !== history.transactions.length
        || orders?.success !== true || !Array.isArray(orders.orders)
        || orders.orders.some((entry) => !entry || !positiveInt(entry.id)
          || Number(entry.colony_id) !== Number(colonyId) || !['buy', 'sell'].includes(entry.side)
          || !['active', 'cancelled', 'filled'].includes(entry.status)
          || typeof entry.good_type !== 'string' || !entry.good_type
          || !positiveInt(entry.quantity_initial) || !positiveInt(entry.limit_price_cents)
          || !['quantity_remaining', 'escrow_cents'].every((key) => number(entry[key]) && Number.isSafeInteger(Number(entry[key]))))
        || new Set(orders.orders.map((entry) => Number(entry.id))).size !== orders.orders.length
        || !Array.isArray(requests) || requests.some((entry) => !entry || !positiveInt(entry.id)
          || Number(entry.colony_id) !== Number(colonyId) || !['supply', 'purchase'].includes(entry.type)
          || typeof entry.good_type !== 'string' || !entry.good_type
          || !positiveInt(entry.quantity) || Number(entry.quantity) > 100
          || !positiveInt(entry.price_cents) || !positiveInt(entry.expires_at)
          || Number(entry.total_cents) !== Number(entry.quantity) * Number(entry.price_cents)
          || !['pending', 'accepted', 'declined', 'expired', 'unavailable'].includes(entry.status)
          || (entry.status === 'accepted' && (!positiveInt(entry.player_order?.id)
            || Number(entry.player_order.colony_id) !== Number(colonyId))))
        || new Set(requests.map((entry) => Number(entry.id))).size !== requests.length) {
        throw new Error('Ungültige Marktdaten vom Server.');
      }
      requestClock = positiveInt(orders.now_unix) ? Number(orders.now_unix) : Date.now() / 1000;
      requestReadAt = Date.now();
      if (!signal.aborted && version === revision && Number(session.getColony()?.id) === Number(colonyId)) stale = false;
      const events = Array.isArray(prices.world_events)
        ? prices.world_events.filter((entry) => entry && typeof entry.label === 'string' && number(entry.ends_at))
        : [];
      return { prices: prices.prices, stock: snapshot.economy.stock, transactions: history.transactions, events, orders: orders.orders, requests };
    },
    prepareCommand(action, value, state) {
      if (action === 'buy' || action === 'sell') throw new Error('Soforthandel wurde eingestellt. Bitte einen Auftrag erstellen.');
      if (!['create_order', 'cancel_order', 'accept_request', 'decline_request'].includes(action)) throw new Error('Unbekannter Marktbefehl.');
      if (stale || state.loading || !state.data) throw new Error('Bitte zuerst den Markt aktualisieren.');
      if (action === 'accept_request' || action === 'decline_request') {
        const request = state.data.requests.find((entry) => Number(entry.id) === Number(value?.request_id));
        if (!positiveInt(value?.request_id) || !request || request.status !== 'pending'
          || requestNow() >= Number(request.expires_at)) {
          throw new Error('Anfrage nicht mehr verfügbar oder abgelaufen. Bitte Markt aktualisieren.');
        }
        return { endpoint: `api/market.php?action=${action}`, body: { request_id: Number(request.id) } };
      }
      if (action === 'cancel_order') {
        if (!positiveInt(value?.order_id)
          || !state.data.orders.some((entry) => Number(entry.id) === Number(value.order_id) && entry.status === 'active')) {
          throw new Error('Aktiven eigenen Auftrag auswählen.');
        }
        return { endpoint: 'api/market.php?action=cancel_order', body: { order_id: Number(value.order_id) } };
      }
      if (!state.data.prices.some((entry) => entry.good_type === value?.good_type)
        || !number(value?.quantity) || Number(value.quantity) <= 0) {
        throw new Error('Verfügbares Gut und eine positive Menge auswählen.');
      }
      const body = {
        colony_id: Number(state.colonyId), good_type: value.good_type, quantity: Number(value.quantity),
      };
      if (action === 'create_order') {
        const price = String(value.limit_price ?? '');
        if (!['buy', 'sell'].includes(value.side) || !positiveInt(value.quantity) || Number(value.quantity) > 1000000
          || !/^\d+(\.\d{1,2})?$/.test(price) || Number(price) <= 0 || Number(price) > 1000000
          || Number(value.quantity) * Number(price) > 10000000000) {
          throw new Error('Ganze Menge (1–1000000) und positiven Limitpreis mit höchstens zwei Nachkommastellen eingeben.');
        }
        body.side = value.side;
        body.limit_price = price;
      }
      return { endpoint: `api/market.php?action=${action}`, body };
    },
  });
  return { ...domain,
    getState: () => ({ ...domain.getState(), stale, requestNow: requestNow() }),
    load: () => domain.getState().mutating ? Promise.resolve(false) : domain.load(),
    refresh: () => domain.getState().mutating ? Promise.resolve(false) : domain.refresh(),
    shutdown() { unsubscribe(); domain.shutdown(); },
  };
}
