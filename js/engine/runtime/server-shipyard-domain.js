import { createServerColonyDomain } from './server-colony-domain.js';
import { parseShipInventory } from './server-fleet-launch-domain.js';

function integer(value, min = 0) {
  return ['number', 'string'].includes(typeof value) && value !== ''
    && Number.isSafeInteger(Number(value)) && Number(value) >= min;
}

export function createShipyardDomain({ api, session }) {
  let stale = true;
  let inventoryRevision = 0;
  const unsubscribe = session.events.on('colony:mutation-accepted', (event) => {
    if (['shipyard', 'fleet-launch', 'fleets'].includes(event.domain)
      && (event.allColonies || Number(event.colonyId) === Number(session.getColony()?.id))) {
      inventoryRevision++;
      stale = true;
    }
  });
  const domain = createServerColonyDomain({
    api, session, name: 'shipyard',
    async read(colonyId, signal) {
      stale = true;
      const version = inventoryRevision;
      const data = await api.get(`api/shipyard.php?action=list&colony_id=${colonyId}`, { signal });
      const ships = parseShipInventory(data);
      if (ships.some((ship) => !ship.cost || typeof ship.cost !== 'object'
        || (Array.isArray(ship.cost) && ship.cost.length !== 0)
        || Object.values(ship.cost).some((amount) => !['number', 'string'].includes(typeof amount)
          || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0))
        || data.blueprints.some((ship) => !integer(ship.id, 1))
        || !Array.isArray(data.queue)
        || data.queue.some((order) => !order || !integer(order.id, 1)
          || typeof order.ship_type !== 'string' || !order.ship_type
          || !integer(order.quantity, 1) || !integer(order.position, 1)
          || !['queued', 'running'].includes(order.status)
          || (order.label != null && typeof order.label !== 'string')
          || (order.eta != null && typeof order.eta !== 'string'))
        || new Set(data.queue.map((order) => Number(order.id))).size !== data.queue.length) {
        throw new Error('Ungültige Werftdaten vom Server.');
      }
      if (!signal.aborted && version === inventoryRevision
        && Number(session.getColony()?.id) === Number(colonyId)) stale = false;
      return { ships, queue: data.queue };
    },
    prepareCommand(action, value, state) {
      if (!['build', 'finish'].includes(action)) throw new Error('Unbekannter Werftbefehl.');
      if (stale || state.loading || !state.data) throw new Error('Bitte zuerst die Werft aktualisieren.');
      const body = { colony_id: Number(state.colonyId) };
      if (action === 'build') {
        const ship = state.data.ships.find((entry) => entry.type === value?.type);
        if (!ship || !integer(value?.count, 1)) throw new Error('Verfügbaren Schiffstyp und eine positive ganze Menge auswählen.');
        body.type = ship.type;
        body.count = Number(value.count);
        if (ship.id != null) body.blueprint_id = Number(ship.id);
      }
      return { endpoint: `api/shipyard.php?action=${action}`, body };
    },
  });
  return { ...domain,
    getState: () => ({ ...domain.getState(), stale }),
    load: () => domain.getState().mutating ? Promise.resolve(false) : domain.load(),
    refresh: () => domain.getState().mutating ? Promise.resolve(false) : domain.refresh(),
    shutdown() { unsubscribe(); domain.shutdown(); },
  };
}
