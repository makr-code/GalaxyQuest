import { Vector3 } from 'three';
import { HERO_SHIP_PROFILES } from './hero-battle-models.js';

const activePresentations = new WeakSet();
const MAX_PROXIES_PER_SIDE = 12;
const PRESENTATION_DURATION_MS = 8500;
const MAX_ROUNDS = 6;

function assertCounts(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Battle encounter ${field} must be a ship-count map`);
  }
  const result = {};
  for (const [type, count] of Object.entries(value)) {
    if (!type.trim() || !Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Battle encounter ${field} contains an invalid ship count`);
    }
    result[type] = count;
  }
  return result;
}

function shipTotal(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function sameCounts(left, right) {
  const types = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...types].every((type) => (left[type] || 0) === (right[type] || 0));
}

export function normalizeBattleEncounter(encounter) {
  if (!encounter || encounter.schema_version !== 1 || encounter.rule_version !== 'legacy-v1'
    || encounter.status !== 'resolved'
    || !Number.isSafeInteger(encounter.id) || encounter.id <= 0
    || !Number.isSafeInteger(encounter.battle_report_id) || encounter.battle_report_id <= 0
    || !Array.isArray(encounter.participants) || encounter.participants.length !== 2
    || !Array.isArray(encounter.events)) {
    throw new TypeError('A resolved, version 1 battle encounter is required');
  }
  const participants = new Map();
  for (const participant of encounter.participants) {
    if (!participant || !['attacker', 'defender'].includes(participant.side)
      || participants.has(participant.side)) {
      throw new TypeError('Battle encounter participants are invalid');
    }
    participants.set(participant.side, {
      side: participant.side,
      ships: assertCounts(participant.initial_ships, `${participant.side} initial_ships`),
    });
  }
  if (!participants.has('attacker') || !participants.has('defender')) {
    throw new TypeError('Battle encounter requires attacker and defender participants');
  }

  const created = encounter.events.find((event) => event?.event_type === 'encounter_created');
  const target = created?.payload?.target;
  if (!target || !Number.isSafeInteger(target.galaxy) || target.galaxy < 1 || target.galaxy > 9
    || !Number.isSafeInteger(target.system) || target.system < 1
    || !Number.isSafeInteger(target.position) || target.position < 1) {
    throw new TypeError('Battle encounter target coordinates are invalid');
  }

  const outcome = encounter.outcome;
  const resolved = encounter.events.find((event) => event?.event_type === 'encounter_resolved');
  if (encounter.revision !== 2 || !outcome || outcome.version !== 1
    || resolved?.payload?.battle_report_id !== encounter.battle_report_id
    || resolved?.payload?.attacker_wins !== outcome.attacker_wins
    || resolved?.payload?.illustrative_rounds !== true
    || typeof outcome.attacker_wins !== 'boolean'
    || !Array.isArray(outcome.rounds) || outcome.rounds.length < 1
    || outcome.rounds.length > MAX_ROUNDS) {
    throw new TypeError('Battle encounter outcome is incomplete');
  }
  const attacker = participants.get('attacker');
  const defender = participants.get('defender');
  const attackerInitial = assertCounts(outcome.attacker_ships, 'attacker_ships');
  const defenderInitial = assertCounts(outcome.defender_ships, 'defender_ships');
  if (!sameCounts(attacker.ships, attackerInitial) || !sameCounts(defender.ships, defenderInitial)) {
    throw new TypeError('Battle encounter composition does not match its server outcome');
  }

  const attackerLost = assertCounts(outcome.attacker_lost, 'attacker_lost');
  const defenderLost = assertCounts(outcome.defender_lost, 'defender_lost');
  const attackerSurvivors = assertCounts(outcome.attacker_survivors, 'attacker_survivors');
  for (const [type, count] of Object.entries(attacker.ships)) {
    if ((attackerLost[type] || 0) + (attackerSurvivors[type] || 0) !== count) {
      throw new TypeError('Attacker battle outcome does not conserve ship counts');
    }
  }
  for (const type of Object.keys(attackerLost)) {
    if (!Object.hasOwn(attacker.ships, type)) throw new TypeError('Attacker losses include an unknown ship type');
  }
  for (const type of Object.keys(attackerSurvivors)) {
    if (!Object.hasOwn(attacker.ships, type)) throw new TypeError('Attacker survivors include an unknown ship type');
  }
  for (const [type, count] of Object.entries(defenderLost)) {
    if (!Object.hasOwn(defender.ships, type) || count > defender.ships[type]) {
      throw new TypeError('Defender losses exceed the recorded starting fleet');
    }
  }

  const rounds = outcome.rounds.map((round, index) => {
    if (!round || !Number.isSafeInteger(round.round) || round.round !== index + 1
      || !Number.isFinite(round.attacker_pressure) || round.attacker_pressure < 0
      || !Number.isFinite(round.defender_pressure) || round.defender_pressure < 0) {
      throw new TypeError(`Battle encounter round ${index + 1} is invalid`);
    }
    return {
      round: round.round,
      attackerPressure: round.attacker_pressure,
      defenderPressure: round.defender_pressure,
    };
  });

  return {
    id: encounter.id,
    reportId: encounter.battle_report_id,
    target,
    attacker,
    defender,
    attackerLost,
    defenderLost,
    attackerSurvivors,
    defenderSurvivors: Object.fromEntries(Object.entries(defender.ships)
      .map(([type, count]) => [type, count - (defenderLost[type] || 0)])),
    attackerWins: outcome.attacker_wins,
    rounds,
  };
}

function proxyTypes(counts) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const total = shipTotal(counts);
  const limit = Math.min(total, MAX_PROXIES_PER_SIDE);
  const proxies = entries.slice(0, limit).map(([type]) => type);
  while (proxies.length < limit) {
    for (const [type, count] of entries) {
      const alreadyRepresented = proxies.filter((entry) => entry === type).length;
      if (alreadyRepresented < count) proxies.push(type);
      if (proxies.length === limit) break;
    }
  }
  return proxies;
}

function createOverlay(encounter) {
  const root = document.createElement('section');
  root.dataset.battleEncounterPresentation = String(encounter.id);
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', `Schlachtbericht ${encounter.reportId}`);
  root.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:30;'
    + 'max-width:min(760px,calc(100vw - 32px));padding:16px 20px;border:1px solid #6c8499;'
    + 'border-radius:8px;background:#08121eed;color:#eef7ff;font:14px/1.45 sans-serif;'
    + 'box-shadow:0 8px 32px #0009;pointer-events:auto;max-height:min(44vh,calc(100vh - 32px));overflow:auto';
  const heading = document.createElement('h2');
  heading.textContent = `Schlachtbericht #${encounter.reportId} · ${encounter.attackerWins ? 'Angreifer siegt' : 'Verteidiger hält stand'}`;
  heading.style.cssText = 'margin:0 0 8px;font-size:18px';
  const disclaimer = document.createElement('p');
  disclaimer.textContent = 'Serverergebnis. Schiffsmodelle sind Flotten-Proxies; die Runden-Cues zeigen aggregierten Kampfdruck, keine einzelnen Schüsse oder Treffer.';
  disclaimer.style.cssText = 'margin:0 0 10px;color:#c5d5e4';
  const roundSummary = document.createElement('p');
  roundSummary.textContent = `Aggregierter Druck: ${encounter.rounds.map((round) =>
    `R${round.round} Angreifer ${round.attackerPressure} · Verteidiger ${round.defenderPressure}`).join(' | ')}`;
  roundSummary.style.cssText = 'margin:0 0 10px;color:#c5d5e4';
  const fleetSummary = document.createElement('p');
  fleetSummary.textContent = [
    `Angreifer ${shipTotal(encounter.attacker.ships)} → ${shipTotal(encounter.attackerSurvivors)} (${shipTotal(encounter.attackerLost)} verloren)`,
    `Verteidiger ${shipTotal(encounter.defender.ships)} → ${shipTotal(encounter.defenderSurvivors)} (${shipTotal(encounter.defenderLost)} verloren)`,
  ].join(' · ');
  fleetSummary.style.cssText = 'margin:0 0 8px;color:#d9e8f5';
  const fleetDetails = document.createElement('details');
  const fleetSummaryLabel = document.createElement('summary');
  fleetSummaryLabel.textContent = 'Schiffsverluste und Überlebende je Klasse';
  fleetSummaryLabel.style.cssText = 'cursor:pointer;margin-bottom:8px';
  const details = document.createElement('div');
  details.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:8px';
  for (const [side, label, losses, survivors] of [
    ['attacker', 'Angreifer', encounter.attackerLost, encounter.attackerSurvivors],
    ['defender', 'Verteidiger', encounter.defenderLost, encounter.defenderSurvivors],
  ]) {
    const section = document.createElement('section');
    const title = document.createElement('h3');
    title.textContent = label;
    title.style.cssText = 'margin:0 0 4px;font-size:14px';
    const list = document.createElement('ul');
    list.style.cssText = 'margin:0;padding-left:18px';
    for (const [type, count] of Object.entries(encounter[side].ships)) {
      const item = document.createElement('li');
      item.textContent = `${type.replaceAll('_', ' ')}: ${count} Start · ${losses[type] || 0} Verlust · ${survivors[type] || 0} verblieben`;
      list.append(item);
    }
    if (!list.children.length) {
      const item = document.createElement('li');
      item.textContent = 'Keine Schiffe im Encounter-Snapshot';
      list.append(item);
    }
    section.append(title, list);
    details.append(section);
  }
  fleetDetails.append(fleetSummaryLabel, details);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Replay schließen';
  close.style.cssText = 'margin-top:12px;padding:6px 12px;color:inherit;background:#203649;'
    + 'border:1px solid #7890a5;border-radius:4px;cursor:pointer';
  root.append(heading, disclaimer, roundSummary, fleetSummary, fleetDetails, close);
  document.body.append(root);
  return { root, close };
}

export async function startBattleEncounterPresentation(renderer, rawEncounter) {
  const encounter = normalizeBattleEncounter(rawEncounter);
  const space = renderer.getSpaceView();
  const targetBody = space?.bodies.find((body) => body.userData.type === 'planet'
    && Number(body.userData.data?.position) === encounter.target.position);
  if (!space || !targetBody || !space.weaponRenderPass) {
    throw new Error('Das Zielsystem muss gerendert sein, bevor das Schlachtreplay startet.');
  }
  if (space.cameraFollowEntity || document.visibilityState === 'hidden') {
    throw new Error('Das Schlachtreplay benötigt eine sichtbare Systemansicht ohne Kamera-Follow.');
  }
  if (activePresentations.has(space)) throw new Error('Ein Schlachtreplay läuft bereits.');

  const center = targetBody.getWorldPosition(new Vector3());
  const scale = targetBody.userData.radius;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Der Zielkörper hat keine gültige Darstellungsgröße.');
  const origin = space.origin.clone();
  const root = space.root;
  const camera = space.camera;
  const pose = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
  let ownedPose = null;
  const entities = [];
  const effects = new Set();
  const listeners = new AbortController();
  let detach = null;
  let timeout = null;
  let stopped = false;
  let cameraChanged = false;
  let overlay = null;
  let resolveFinished;
  let rejectFinished;
  const finished = new Promise((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  function stop(error = null) {
    if (stopped) return;
    stopped = true;
    activePresentations.delete(space);
    clearTimeout(timeout);
    listeners.abort();
    const errors = [];
    const attempt = (action) => {
      try { action(); } catch (cleanupError) { errors.push(cleanupError); }
    };
    attempt(() => detach?.());
    attempt(() => space.weaponRenderPass.remove(effects));
    effects.clear();
    for (const entity of entities) {
      attempt(() => {
        if (space.spaceEntities.get(entity.id) === entity) space._removeSpaceEntity(entity);
      });
    }
    attempt(() => overlay?.root.remove());
    attempt(() => {
      if (cameraChanged && ownedPose && camera.position.equals(ownedPose.position)
        && camera.quaternion.equals(ownedPose.quaternion)
        && space.root === root && space.origin.equals(origin) && space.bodies.includes(targetBody)) {
        camera.position.copy(pose.position);
        camera.quaternion.copy(pose.quaternion);
        camera.updateMatrixWorld(true);
      }
    });
    const failure = error && errors.length
      ? new AggregateError([error, ...errors], 'Battle replay and cleanup failed')
      : errors.length ? new AggregateError(errors, 'Battle replay cleanup failed') : error;
    if (failure) rejectFinished(failure);
    else resolveFinished({ encounterId: encounter.id, cleaned: true });
  }

  activePresentations.add(space);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop();
  }, { signal: listeners.signal });
  timeout = setTimeout(() => stop(), PRESENTATION_DURATION_MS);
  try {
    const classes = Object.keys(HERO_SHIP_PROFILES);
    const wing = (side, counts) => proxyTypes(counts).map((shipType, index) => {
      const sign = side === 'attacker' ? -1 : 1;
      const profile = HERO_SHIP_PROFILES[classes[index % classes.length]];
      const lane = index - Math.floor(MAX_PROXIES_PER_SIDE / 2);
      const position = center.clone().add(new Vector3(sign * scale * 4,
        -scale * 3 + lane * scale * 0.6, (index % 3 - 1) * scale * 0.8));
      const id = `battle-${encounter.id}-${side}-${index}-${crypto.randomUUID()}`;
      return {
        id,
        shipType,
        modelUrl: `procedural:hero-${classes[index % classes.length]}`,
        position,
        route: [position.clone().add(origin).toArray(), position.clone().add(origin).toArray()],
        visualScale: scale * (profile?.scale ?? 1),
      };
    });
    const proxies = [
      ...wing('attacker', encounter.attacker.ships),
      ...wing('defender', encounter.defender.ships),
    ];
    for (const proxy of proxies) {
      if (stopped) return { stop, finished };
      const loading = space.registerSpaceVessel({
        id: proxy.id,
        model_url: proxy.modelUrl,
        route: proxy.route,
        visual_scale_ly: proxy.visualScale,
        reduced_motion: true,
        engine_effects: false,
        color: proxy.id.includes('-attacker-') ? [0.3, 0.85, 1, 1] : [1, 0.45, 0.2, 1],
        display_name: 'Flotten-Projektion',
      });
      const entity = space.spaceEntities.get(proxy.id);
      if (entity) {
        entity.position.copy(proxy.position.clone().add(origin));
        entities.push(entity);
      }
      const loaded = await loading;
      if (stopped) return { stop, finished };
      if (!loaded || !entity) throw new Error(`Ein Flotten-Proxy konnte nicht geladen werden: ${proxy.shipType}`);
    }
    if (!space.bodies.includes(targetBody) || space.root !== root || !space.origin.equals(origin)) {
      throw new Error('Das Zielsystem hat sich während des Replay-Aufbaus geändert.');
    }

    overlay = createOverlay(encounter);
    overlay.close.addEventListener('click', () => stop(), { signal: listeners.signal });
    const sideEntities = {
      attacker: entities.filter((entity) => entity.id.includes('-attacker-')),
      defender: entities.filter((entity) => entity.id.includes('-defender-')),
    };
    const centerWorld = center.clone().add(origin);
    const start = performance.now() / 1000;
    encounter.rounds.forEach((round, index) => {
      const time = start + 0.9 + index * 1.15;
      for (const [side, pressure] of [
        ['attacker', round.attackerPressure],
        ['defender', round.defenderPressure],
      ]) {
        const source = sideEntities[side][index % Math.max(1, sideEntities[side].length)];
        if (pressure <= 0 || !source) continue;
        const sign = side === 'attacker' ? 1 : -1;
        const lane = (index % 3 - 1) * scale * 0.45;
        const destination = centerWorld.clone().add(new Vector3(sign * scale * 2, lane, 0));
        effects.add(space.weaponRenderPass.fire(source.position.clone(), destination, {
          time,
          lifetime: 0.65,
          width: 3,
          color: side === 'attacker' ? [0.25, 0.8, 1] : [1, 0.38, 0.18],
          priority: 2,
        }));
      }
    });

    cameraChanged = true;
    camera.position.copy(center).add(new Vector3(0, -scale * 18, scale * 7));
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    ownedPose = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    const frame = () => {
      if (stopped) return;
      try {
        if (!space.bodies.includes(targetBody) || space.root !== root || !space.origin.equals(origin)
          || entities.some((entity) => space.spaceEntities.get(entity.id) !== entity)
          || document.visibilityState === 'hidden') {
          stop();
          return;
        }
        const now = performance.now() / 1000;
        const elapsed = now - start;
        const expired = new Set();
        for (const effect of effects) {
          if (now >= effect.time + effect.lifetime) {
            expired.add(effect);
            effects.delete(effect);
          }
        }
        if (expired.size) space.weaponRenderPass.remove(expired);
        for (const entity of entities) {
          const side = entity.id.includes('-attacker-') ? -1 : 1;
          const sideEntitiesForLayout = side < 0 ? sideEntities.attacker : sideEntities.defender;
          const index = sideEntitiesForLayout.indexOf(entity);
          const lane = index - Math.floor(MAX_PROXIES_PER_SIDE / 2);
          entity.position.set(
            centerWorld.x + side * scale * 4,
            centerWorld.y - scale * 3 + lane * scale * 0.6 + Math.sin(elapsed + index) * scale * 0.08,
            centerWorld.z + (index % 3 - 1) * scale * 0.8,
          );
        }
      } catch (error) {
        stop(error);
      }
    };
    detach = renderer.getSharedZoomBackend().addFrameHook(frame);
    frame();
    return { stop, finished, encounter };
  } catch (error) {
    if (!stopped) stop(error);
    try { await finished; } catch (failure) { throw failure; }
    throw error;
  }
}
