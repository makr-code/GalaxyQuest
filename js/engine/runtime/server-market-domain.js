import { createServerColonyDomain } from './server-colony-domain.js';

const number = (value) => ['number', 'string'].includes(typeof value) && value !== ''
  && Number.isFinite(Number(value)) && Number(value) >= 0;
const positiveInt = (value) => number(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function createMarketDomain({ api, session }) {
  let stale = true;
  let revision = 0;
  const unsubscribe = session.events.on('colony:mutation-accepted', () => { stale = true; revision++; });
  const domain = createServerColonyDomain({
    api, session, name: 'market',
    async read(colonyId, signal) {
      stale = true;
      const version = revision;
      const prices = await api.get(`api/market.php?action=get_prices&colony_id=${colonyId}`, { signal });
      const [snapshot, history] = await Promise.all([
        api.get(`api/colony_economy.php?action=snapshot&colony_id=${colonyId}`, { signal }),
        api.get('api/market.php?action=get_history&limit=20', { signal }),
      ]);
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
        || new Set(history.transactions.map((entry) => Number(entry.id))).size !== history.transactions.length) {
        throw new Error('Ungültige Marktdaten vom Server.');
      }
      if (!signal.aborted && version === revision && Number(session.getColony()?.id) === Number(colonyId)) stale = false;
      return { prices: prices.prices, stock: snapshot.economy.stock, transactions: history.transactions };
    },
    prepareCommand(action, value, state) {
      if (!['buy', 'sell'].includes(action)) throw new Error('Unbekannter Marktbefehl.');
      if (stale || state.loading || !state.data) throw new Error('Bitte zuerst den Markt aktualisieren.');
      if (!state.data.prices.some((entry) => entry.good_type === value?.good_type)
        || !number(value?.quantity) || Number(value.quantity) <= 0) {
        throw new Error('Verfügbares Gut und eine positive Menge auswählen.');
      }
      return { endpoint: `api/market.php?action=${action}`, body: {
        colony_id: Number(state.colonyId), good_type: value.good_type, quantity: Number(value.quantity),
      } };
    },
  });
  return { ...domain,
    getState: () => ({ ...domain.getState(), stale }),
    load: () => domain.getState().mutating ? Promise.resolve(false) : domain.load(),
    refresh: () => domain.getState().mutating ? Promise.resolve(false) : domain.refresh(),
    shutdown() { unsubscribe(); domain.shutdown(); },
  };
}
