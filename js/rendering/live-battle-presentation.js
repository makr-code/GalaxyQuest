import { LiveBattleJournalClient } from '../engine/game/LiveBattleJournalClient.js';
import { LiveBattleJournalPoller } from '../engine/game/LiveBattleJournalPoller.js';

const SIDES = ['attacker', 'defender'];
const RULE_VERSION = 'live-groups-experimental-v1';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function groupData(state) {
  if (!isRecord(state) || state.rule_version !== RULE_VERSION
    || !Number.isSafeInteger(state.tick) || state.tick < 0
    || !['active', 'resolved'].includes(state.status) || !isRecord(state.groups)) {
    throw new TypeError('Invalid live battle presentation state.');
  }
  const groups = [];
  for (const side of SIDES) {
    if (!isRecord(state.groups[side])) throw new TypeError('Invalid live battle presentation groups.');
    for (const [type, group] of Object.entries(state.groups[side])) {
      if (!type.trim() || !isRecord(group) || !Number.isSafeInteger(group.initial_count)
        || group.initial_count < 1 || !Number.isSafeInteger(group.count) || group.count < 0
        || group.count > group.initial_count || !Number.isFinite(group.shield) || group.shield < 0
        || !Number.isFinite(group.hull) || group.hull < 0) {
        throw new TypeError('Invalid live battle presentation group.');
      }
      groups.push({
        side, type, initialCount: group.initial_count, count: group.count,
        shield: group.shield, hull: group.hull,
      });
    }
  }
  return {
    tick: state.tick, status: state.status, outcome: state.outcome,
    groups,
  };
}

/** Project one server tick to aggregate visual cues, never individual shots or hits. */
export function projectLiveBattleTick(entry) {
  if (!isRecord(entry) || !Number.isSafeInteger(entry.tick) || !Array.isArray(entry.events)) {
    throw new TypeError('Invalid live battle presentation tick.');
  }
  const snapshot = groupData(entry.state);
  if (entry.tick !== snapshot.tick) throw new TypeError('Presentation tick and snapshot differ.');
  const cues = entry.events.map((event) => {
    if (!isRecord(event) || event.tick !== entry.tick || !SIDES.includes(event.source_side)
      || !SIDES.includes(event.target_side) || event.source_side === event.target_side
      || typeof event.target_group !== 'string'
      || !Object.hasOwn(entry.state.groups[event.target_side], event.target_group)
      || !Number.isFinite(event.shield_damage) || event.shield_damage < 0
      || !Number.isFinite(event.hull_damage) || event.hull_damage < 0
      || !Number.isSafeInteger(event.ships_lost) || event.ships_lost < 0) {
      throw new TypeError('Invalid live battle aggregate event.');
    }
    return {
      kind: 'aggregate-damage',
      tick: entry.tick,
      sourceSide: event.source_side,
      targetSide: event.target_side,
      targetGroup: event.target_group,
      shieldDamage: event.shield_damage,
      hullDamage: event.hull_damage,
      shipsLost: event.ships_lost,
    };
  });
  return { snapshot, cues };
}

/**
 * The caller supplies an explicit presentation sink. No gameplay or renderer is
 * activated automatically; group identities are side + server ship type.
 */
export function startLiveBattlePresentation(api, journalId, sink, options = {}) {
  if (!sink || typeof sink.snapshot !== 'function' || typeof sink.tick !== 'function'
    || typeof sink.error !== 'function') {
    throw new TypeError('Live battle presentation requires snapshot, tick and error handlers.');
  }
  let stopped = false;
  const client = new LiveBattleJournalClient(api, journalId);
  const poller = new LiveBattleJournalPoller(client, {
    ...options,
    onSnapshot: (state) => sink.snapshot(groupData(state)),
    onPage: async (page) => {
      for (const entry of page.ticks) {
        if (stopped) return;
        await sink.tick(projectLiveBattleTick(entry), {
          latestTick: page.latestTick,
          isCatchUp: entry.tick < page.latestTick,
        });
      }
    },
    onError: (error) => sink.error(error),
  });
  const finished = poller.run();
  return {
    finished,
    stop: () => {
      stopped = true;
      poller.stop();
    },
  };
}
