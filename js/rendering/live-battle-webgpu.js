import { Vector3 } from 'three';
import { startLiveBattlePresentation } from './live-battle-presentation.js';

const MAX_GROUPS_PER_SIDE = 12;
const MAX_EFFECTS = 24;
const activeSpaces = new WeakSet();

/**
 * Explicit experimental view: body is supplied by the caller, not inferred from the journal.
 */
export function startLiveBattleWebGpu(renderer, api, journalId, { body, onError } = {}) {
  const space = renderer.getSpaceView();
  if (!space || !body || !space.bodies.includes(body) || !space.weaponRenderPass
    || !Number.isFinite(body.userData?.radius) || body.userData.radius <= 0
    || typeof onError !== 'function' || document.visibilityState === 'hidden') {
    throw new Error('A visible system, explicit body and error handler are required for live battle presentation.');
  }
  if (activeSpaces.has(space)) throw new Error('A live battle presentation is already active.');
  const root = space.root;
  const origin = space.origin.clone();
  const center = body.getWorldPosition(new Vector3()).add(origin);
  const scale = body.userData.radius;
  const proxies = new Map();
  const effects = new Set();
  const listeners = new AbortController();
  const overlay = document.createElement('section');
  overlay.dataset.liveBattleJournal = String(journalId);
  overlay.setAttribute('role', 'status');
  overlay.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:30;'
    + 'max-width:min(760px,calc(100vw - 32px));max-height:40vh;overflow:auto;padding:16px;'
    + 'background:#08121eed;color:#eef7ff;border:1px solid #6c8499;border-radius:8px;font:14px sans-serif';
  const title = document.createElement('h2');
  title.textContent = 'Experimentelle Live-Schlacht';
  const description = document.createElement('p');
  description.textContent = 'Gruppen-Proxies (max. 12 je Seite) und aggregierter Schaden; '
    + 'keine einzelnen Schüsse oder Treffer.';
  const summary = document.createElement('p');
  const close = document.createElement('button');
  close.textContent = 'Schließen';
  overlay.append(title, description, summary, close);
  let stopped = false;
  let presentation = null;
  let detach = null;
  let resolveFinished;
  let rejectFinished;
  const finished = new Promise((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  function stop(failure = null) {
    if (stopped) return;
    stopped = true;
    activeSpaces.delete(space);
    const errors = [];
    const attempt = (fn) => { try { fn(); } catch (error) { errors.push(error); } };
    attempt(() => presentation?.stop());
    attempt(() => listeners.abort());
    attempt(() => detach?.());
    attempt(() => space.weaponRenderPass.remove(effects));
    effects.clear();
    for (const { entity } of proxies.values()) {
      attempt(() => {
        if (space.spaceEntities.get(entity.id) === entity) space._removeSpaceEntity(entity);
      });
    }
    proxies.clear();
    attempt(() => overlay.remove());
    if (failure && errors.length) rejectFinished(new AggregateError([failure, ...errors], 'Live battle cleanup failed.'));
    else if (failure) rejectFinished(failure);
    else if (errors.length) rejectFinished(new AggregateError(errors, 'Live battle cleanup failed.'));
    else resolveFinished({ journalId, cleaned: true });
  }

  function key(side, type) {
    return JSON.stringify([side, type]);
  }

  async function update(snapshot) {
    if (stopped) return;
    const wanted = new Map();
    for (const side of ['attacker', 'defender']) {
      const groups = snapshot.groups.filter((group) => group.side === side && group.count > 0)
        .sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
        .slice(0, MAX_GROUPS_PER_SIDE);
      groups.forEach((group) => wanted.set(key(side, group.type), group));
    }
    for (const [id, { entity }] of proxies) {
      if (!wanted.has(id)) {
        if (space.spaceEntities.get(entity.id) === entity) space._removeSpaceEntity(entity);
        proxies.delete(id);
      }
    }
    for (const [id, group] of wanted) {
      if (proxies.has(id) || stopped) continue;
      const sign = group.side === 'attacker' ? -1 : 1;
      const occupied = new Set([...proxies.values()].filter((proxy) => proxy.side === group.side)
        .map((proxy) => proxy.index));
      let index = 0;
      while (occupied.has(index)) index++;
      const position = center.clone().add(new Vector3(sign * scale * 4, (index - 5.5) * scale, 0));
      const entityId = `live-battle-${crypto.randomUUID()}`;
      const loading = space.registerSpaceVessel({
        id: entityId, model_url: 'procedural:hero-frigate',
        route: [position.toArray(), position.toArray()], visual_scale_ly: scale,
        reduced_motion: true, engine_effects: false,
        color: sign < 0 ? [0.3, 0.85, 1, 1] : [1, 0.45, 0.2, 1],
        display_name: 'Gruppen-Projektion',
      });
      const entity = space.spaceEntities.get(entityId);
      if (entity) proxies.set(id, { entity, index, side: group.side });
      const loaded = await loading;
      if (stopped) return;
      if (!loaded || !entity) throw new Error('Live battle group proxy could not be loaded.');
    }
    const counts = snapshot.groups.map((group) => `${group.side} ${group.type}: ${group.count}`).join(' · ');
    summary.textContent = `Tick ${snapshot.tick} · ${snapshot.status}${snapshot.outcome ? ` (${snapshot.outcome})` : ''} · ${counts}`;
  }

  async function tick({ snapshot, cues }, { isCatchUp }) {
    if (!isCatchUp) {
      for (const cue of cues) {
        const target = proxies.get(key(cue.targetSide, cue.targetGroup))?.entity;
        if (!target || effects.size >= MAX_EFFECTS) continue;
        const source = center.clone().add(new Vector3(cue.sourceSide === 'attacker' ? -scale * 2 : scale * 2, 0, 0));
        const effect = space.weaponRenderPass.fire(source, target.position.clone(), {
          time: performance.now() / 1000, lifetime: 0.65, width: 3,
          color: cue.sourceSide === 'attacker' ? [0.25, 0.8, 1] : [1, 0.38, 0.18], priority: 2,
        });
        if (effect) effects.add(effect);
      }
    }
    await update(snapshot);
  }

  activeSpaces.add(space);
  try {
    document.body.append(overlay);
    close.addEventListener('click', () => stop(), { signal: listeners.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stop();
    }, { signal: listeners.signal });
    detach = renderer.getSharedZoomBackend().addFrameHook(() => {
      if (stopped) return;
      try {
        if (renderer.getSpaceView() !== space || space.root !== root || !space.origin.equals(origin)
          || !space.bodies.includes(body)) {
          stop();
          return;
        }
        const now = performance.now() / 1000;
        const expired = new Set([...effects].filter((effect) => now >= effect.time + effect.lifetime));
        if (expired.size) {
          space.weaponRenderPass.remove(expired);
          for (const effect of expired) effects.delete(effect);
        }
      } catch (error) {
        stop(error);
      }
    });
    presentation = startLiveBattlePresentation(api, journalId, {
      snapshot: update,
      tick,
      error: onError,
    });
    presentation.finished.catch((error) => stop(error));
  } catch (error) {
    stop(error);
  }
  return { stop: () => stop(), finished };
}
