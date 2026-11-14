import { API } from '../../api.js';
import { ValidatedEventBus } from './domains/shared/EventRegistry.js';
import { mountGameOverview } from '../../ui/game-overview.js';
import { createDevelopmentDomain } from './server-development-domain.js';
import { mountDevelopmentWindows } from '../../ui/game-development.js';
import { createEconomyDomain } from './server-economy-domain.js';
import { mountEconomyWindow } from '../../ui/game-economy.js';
import { createGalaxyDomain } from './server-galaxy-domain.js';
import { mountGameGalaxy } from '../../ui/game-galaxy.js';
import { mountGameOverlayShell } from '../../ui/game-overlay-shell.js';
import { createFleetDomain } from './server-fleet-domain.js';
import { createTradeTransports } from './trade-transports.js';
import { mountFleetWindow } from '../../ui/game-fleets.js';
import { createFleetLaunchDomain } from './server-fleet-launch-domain.js';
import { mountFleetCommandOverlay } from '../../ui/game-fleet-launch.js';
import { createShipyardDomain } from './server-shipyard-domain.js';
import { mountShipyardWindow } from '../../ui/game-shipyard.js';
import { createMarketDomain } from './server-market-domain.js';
import { mountMarketWindow } from '../../ui/game-market.js';
import { mountPopulationWindow } from '../../ui/game-population.js';

export function createServerGameSession(api) {
  const events = new ValidatedEventBus();
  let state = null;
  let selectedColonyId = null;
  let pending = null;
  let activeRequest = null;
  let generation = 0;

  function getState() {
    return state === null ? null : structuredClone(state);
  }
  function getColony() {
    return state?.colonies.find((colony) => Number(colony.id) === selectedColonyId) ?? null;
  }
  function publish() {
    events.emit('overview:updated', { state: getState(), colonyId: selectedColonyId });
  }
  function selectColony(id) {
    if (!state?.colonies.some((colony) => Number(colony.id) === Number(id))) {
      throw new Error('Colony is not part of the current account.');
    }
    selectedColonyId = Number(id);
    publish();
  }
  function refresh() {
    if (pending) return pending;
    const epoch = generation;
    const controller = new AbortController();
    activeRequest = controller;
    const job = (async () => {
      const data = await api.get('api/game.php?action=overview', { signal: controller.signal });
      if (epoch !== generation) throw new DOMException('Session changed.', 'AbortError');
      if (data?.success !== true || !Array.isArray(data.colonies) || !data.user_meta || !Array.isArray(data.fleets)
          || data.colonies.some((colony) => !Number.isInteger(Number(colony.id)) || Number(colony.id) <= 0)) {
        throw new Error('Invalid server overview. No local simulation was substituted.');
      }
      state = structuredClone(data);
      if (!getColony()) selectedColonyId = Number(data.colonies[0]?.id) || null;
      publish();
      return getState();
    })();
    pending = job.finally(() => {
      if (epoch === generation) {
        pending = null;
        activeRequest = null;
      }
    });
    return pending;
  }
  function shutdown() {
    generation++;
    activeRequest?.abort();
    activeRequest = null;
    pending = null;
    state = null;
    selectedColonyId = null;
    publish();
  }
  return {
    events, refresh, selectColony, getState,
    async refreshAfterMutation() {
      const epoch = generation;
      if (pending) await pending;
      if (epoch !== generation) throw new DOMException('Session changed.', 'AbortError');
      return refresh();
    },
    getColony: () => {
      const colony = getColony();
      return colony ? structuredClone(colony) : null;
    },
    shutdown,
  };
}

const session = createServerGameSession(API);
let bootPromise = null;
let unmount = null;
let generation = 0;
let developmentDomains = null;
let unmountDevelopment = null;
let economyDomain = null;
let unmountEconomy = null;
let galaxyDomain = null;
let unmountGalaxy = null;
let unmountOverlayShell = null;
let fleetDomain = null;
let unmountFleets = null;
let fleetLaunchDomain = null;
let unmountFleetLaunch = null;
let shipyardDomain = null;
let unmountShipyard = null;
let marketDomain = null;
let unmountMarket = null;
let tradeTransports = null;
let unmountPopulation = null;

export function startAuthenticatedGame() {
  if (bootPromise) return bootPromise;
  const epoch = generation;
  bootPromise = (async () => {
    window.APISession.resetSessionState();
    const me = await API.get('api/auth.php?action=me&quiet=1');
    if (epoch !== generation) throw new DOMException('Session changed.', 'AbortError');
    if (!me.user) throw new Error('Your session expired. Please sign in again.');
    unmount = mountGameOverview(session, me.user);
    await session.refresh();
    if (epoch !== generation) throw new DOMException('Session changed.', 'AbortError');
    developmentDomains = Object.fromEntries(['buildings', 'research'].map((kind) =>
      [kind, createDevelopmentDomain(kind, { api: API, session })]));
    unmountDevelopment = mountDevelopmentWindows({ session, domains: developmentDomains, wm: window.WM });
    economyDomain = createEconomyDomain({ api: API, session });
    unmountEconomy = mountEconomyWindow({ session, domain: economyDomain, wm: window.WM });
    unmountPopulation = mountPopulationWindow({ session, domain: economyDomain, wm: window.WM });
    galaxyDomain = createGalaxyDomain({ api: API, session });
    fleetDomain = createFleetDomain({ api: API, session });
    tradeTransports = createTradeTransports({ api: API, session });
    unmountGalaxy = mountGameGalaxy({ session, domain: galaxyDomain, fleets: fleetDomain, tradeTransports });
    void tradeTransports.refresh();
    unmountFleets = mountFleetWindow({ domain: fleetDomain, galaxy: galaxyDomain, wm: window.WM });
    fleetLaunchDomain = createFleetLaunchDomain({ api: API, session });
    unmountFleetLaunch = mountFleetCommandOverlay({ domain: fleetLaunchDomain, fleets: fleetDomain, session });
    shipyardDomain = createShipyardDomain({ api: API, session });
    unmountShipyard = mountShipyardWindow({ session, domain: shipyardDomain, wm: window.WM });
    marketDomain = createMarketDomain({ api: API, session });
    unmountMarket = mountMarketWindow({ session, domain: marketDomain, wm: window.WM, tradeTransports });
    unmountOverlayShell = mountGameOverlayShell({ session, galaxy: galaxyDomain });
    window.GQGame = {
      api: API,
      events: session.events,
      domains: { overview: session, ...developmentDomains, economy: economyDomain, galaxy: galaxyDomain,
        fleets: fleetDomain, fleetLaunch: fleetLaunchDomain, shipyard: shipyardDomain, market: marketDomain },
      getState: session.getState,
      load: session.refresh,
      shutdown: shutdownAuthenticatedGame,
    };
  })().catch((error) => {
    if (epoch === generation) shutdownAuthenticatedGame();
    throw error;
  });
  return bootPromise;
}

export function shutdownAuthenticatedGame() {
  generation++;
  unmountOverlayShell?.();
  unmountOverlayShell = null;
  unmountMarket?.();
  unmountMarket = null;
  marketDomain?.shutdown();
  marketDomain = null;
  unmountPopulation?.();
  unmountPopulation = null;
  unmountShipyard?.();
  unmountShipyard = null;
  shipyardDomain?.shutdown();
  shipyardDomain = null;
  unmountFleetLaunch?.();
  unmountFleetLaunch = null;
  fleetLaunchDomain?.shutdown();
  fleetLaunchDomain = null;
  unmountFleets?.();
  unmountFleets = null;
  fleetDomain?.shutdown();
  fleetDomain = null;
  unmountGalaxy?.();
  unmountGalaxy = null;
  tradeTransports?.shutdown();
  tradeTransports = null;
  galaxyDomain?.shutdown();
  galaxyDomain = null;
  unmountEconomy?.();
  unmountEconomy = null;
  economyDomain?.shutdown();
  economyDomain = null;
  unmountDevelopment?.();
  unmountDevelopment = null;
  if (developmentDomains) Object.values(developmentDomains).forEach((domain) => domain.shutdown());
  developmentDomains = null;
  unmount?.();
  unmount = null;
  session.shutdown();
  bootPromise = null;
  delete window.GQGame;
}
