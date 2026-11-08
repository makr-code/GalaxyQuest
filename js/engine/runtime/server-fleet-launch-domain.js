import { createServerColonyDomain } from './server-colony-domain.js';

export const FLEET_MISSIONS = {
  transport: 'Transport', attack: 'Angriff', spy: 'Spionage',
  colonize: 'Kolonisieren', harvest: 'Rohstoffe sammeln', survey: 'System erkunden',
};

export const FLEET_MISSION_DESCRIPTIONS = {
  transport: 'Bringt die ausgewählte Metall-, Kristall- und Deuteriumfracht zu einer Kolonie am Ziel.',
  attack: 'Löst bei Ankunft einen Kampf aus. PvP-Modus und Schutzregeln prüft der Server.',
  spy: 'Erstellt bei Ankunft einen Spionagebericht. Der Bericht hängt von Ziel und Spionagetechnik ab.',
  colonize: 'Versucht, am Ziel eine neue Kolonie zu gründen. Belegung und Reservierungen prüft der Server bei Ankunft.',
  harvest: 'Sammelt Rohstoffe von einem unbewohnten Planeten. Die Frachtmenge ist durch die Schiffskapazität begrenzt.',
  survey: 'Erkundet das Zielsystem. Das Ergebnis ist spezies-/fraktionsabhängig und kann FTL-Routeninfrastruktur freischalten.',
};

export const FLEET_TRANSITS = {
  vor_tak: ["Vor'Tak · K-F-Sprungantrieb", 'Reichweitenbegrenzter Sprung mit Wiederaufladung.'],
  syl_nar: ["Syl'Nar · Resonanz-Tornetz", 'Transit benötigt ein aktives Tor auf der gewählten Route.'],
  vel_ar: ["Vel'Ar · Quantensprung", 'Ankunft kann vom gewählten Ziel abweichen; temporäre Tarnung nach dem Sprung.'],
  zhareen: ['Zhareen · Kristallresonanz', 'Transit benötigt einen kartierten, bereiten Resonanzknoten am Ziel.'],
  aereth: ['Aereth · Alcubierre-Warp', 'Reisezeit hängt von Entfernung, Flotte und galaktischer Dichte ab.'],
  kryl_tha: ["Kryl'Tha · Schwarmtunnel", 'Flottengröße begrenzt den Transit; Sprünge verursachen Hüllenschäden.'],
};

function integer(value, minimum = 0) {
  return (typeof value === 'number' || typeof value === 'string') && value !== ''
    && Number.isSafeInteger(Number(value)) && Number(value) >= minimum;
}

export function parseShipInventory(data) {
  if (data?.success !== true || !Array.isArray(data.ships) || !Array.isArray(data.blueprints)) {
    throw new Error('Ungültiger Schiffsbestand vom Server.');
  }
  const ships = [...data.ships, ...data.blueprints];
  if (ships.some((ship) => !ship || typeof ship.type !== 'string' || !ship.type
    || !integer(ship.count) || (ship.name != null && typeof ship.name !== 'string'))
    || new Set(ships.map((ship) => ship.type)).size !== ships.length) {
    throw new Error('Ungültiger Schiffsbestand vom Server.');
  }
  return ships;
}

export function createFleetLaunchDomain({ api, session }) {
  let stale = false;
  let inventoryRevision = 0;
  const pendingOrders = new Map();
  let submittedOrder = null;
  const unsubscribe = session.events.on('colony:mutation-accepted', (event) => {
    if (event.domain === 'fleet-launch' && submittedOrder !== null) {
      pendingOrders.delete(submittedOrder);
      submittedOrder = null;
    }
    if (event.domain === 'fleet-launch' || (['shipyard', 'fleets'].includes(event.domain)
      && (event.allColonies || Number(event.colonyId) === Number(session.getColony()?.id)))) {
      inventoryRevision++;
      stale = true;
    }
  });
  const domain = createServerColonyDomain({
    api, session, name: 'fleet-launch',
    async read(colonyId, signal) {
      stale = true;
      const version = inventoryRevision;
      const [data, transit] = await Promise.all([
        api.get(`api/shipyard.php?action=list&colony_id=${colonyId}`, { signal }),
        api.get('api/fleet.php?action=ftl_status', { signal }),
      ]);
      const ships = parseShipInventory(data);
      if (transit?.success !== true || !Object.hasOwn(FLEET_TRANSITS, transit.ftl_drive_type)
        || typeof transit.ftl_ready !== 'boolean'
        || !integer(transit.ftl_cooldown_remaining_s)
        || !Array.isArray(transit.gates) || !Array.isArray(transit.resonance_nodes)) {
        throw new Error('Ungültiger Transitstatus vom Server.');
      }
      if (!signal.aborted && version === inventoryRevision
        && Number(session.getColony()?.id) === Number(colonyId)) stale = false;
      return { ships: ships.filter((ship) => Number(ship.count) > 0), transit };
    },
    prepareCommand(action, value, state) {
      if (action !== 'send') throw new Error('Unbekannter Flottenbefehl.');
      if (!value || !Object.hasOwn(FLEET_MISSIONS, value.mission)
        || !integer(value.target_galaxy, 1) || Number(value.target_galaxy) > 9
        || !integer(value.target_system, 1) || !integer(value.target_position, 1)) {
        throw new Error('Mission und positive Zielkoordinaten sind erforderlich.');
      }
      if (!value.ships || Array.isArray(value.ships) || typeof value.ships !== 'object'
        || !Object.keys(value.ships).length || Object.entries(value.ships).some(([type, count]) =>
          !integer(count, 1))) {
        throw new Error('Mindestens ein verfügbares Schiff auswählen; Mengen müssen ganze Zahlen sein.');
      }
      const cargo = {};
      for (const key of ['metal', 'crystal', 'deuterium']) {
        const amount = value.cargo?.[key];
        if (!['number', 'string'].includes(typeof amount) || amount === ''
          || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
          throw new Error('Fracht muss aus nichtnegativen Zahlen bestehen.');
        }
        cargo[key] = Number(amount);
      }
      const body = {
        origin_colony_id: Number(state.colonyId), mission: value.mission,
        target_galaxy: Number(value.target_galaxy), target_system: Number(value.target_system),
        target_position: Number(value.target_position),
        ships: Object.fromEntries(Object.entries(value.ships).sort(([a], [b]) => a.localeCompare(b))
          .map(([type, count]) => [type, Number(count)])),
        cargo,
      };
      const signature = JSON.stringify(body);
      let requestId = pendingOrders.get(signature);
      if (!requestId) {
        if (stale || state.loading || !state.data) throw new Error('Bitte zuerst den Schiffsbestand aktualisieren.');
        if (Object.entries(body.ships).some(([type, count]) =>
          !state.data.ships.some((ship) => ship.type === type && Number(ship.count) >= count))) {
          throw new Error('Mindestens ein verfügbares Schiff auswählen; Mengen müssen ganze Zahlen sein.');
        }
        requestId = crypto.randomUUID();
        pendingOrders.set(signature, requestId);
      }
      submittedOrder = signature;
      return { endpoint: 'api/fleet.php?action=send', body: { ...body, request_id: requestId } };
    },
  });
  return { ...domain, getState: () => ({ ...domain.getState(), stale }),
    shutdown() { unsubscribe(); pendingOrders.clear(); domain.shutdown(); } };
}
