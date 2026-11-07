import { Vector3 } from 'three';
import { SPACE_WEAPON_PROFILES } from './space-weapon-render-pass.js';
import { HeroBattleSession } from './hero-battle-session.js';
import { HERO_SHIP_PROFILES, heroShipClassAt } from './hero-battle-models.js';

const activePreviews = new WeakSet();

export function startHeroBattlePreview(renderer, options = {}) {
  return startSystemBattlePreview(renderer, { ...options, hero: true });
}

// Explicit QA entry point; not part of the gameplay event stream.
export async function startSystemBattlePreview(renderer, {
  weaponKinds = Object.keys(SPACE_WEAPON_PROFILES),
  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  hero = false, seed, audio = false, view = 'near',
  cinematic = hero, formation = cinematic ? 'mixed' : 'classic',
  tactics = formation === 'mixed',
  scenario = 'battle', durationMs = scenario === 'convoy' ? 30000 : formation === 'mixed' ? 18000 : 12000,
  reinforcements = false,
  shipCount = reinforcements ? 48 : formation === 'mixed' ? 24 : 4, fleetLod = shipCount > 4, primitiveBudget = 256,
  getAudioSettings = () => {
    const manager = window.__GQ_AUDIO_MANAGER;
    if (!manager?.snapshot) throw new Error('The game audio settings are unavailable');
    return manager.snapshot();
  },
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > (scenario === 'convoy' ? 300000 : 30000)) {
    throw new RangeError('Battle preview duration must be 1000-30000 ms, or up to 300000 ms for convoy QA');
  }
  if (!Array.isArray(weaponKinds) || !weaponKinds.length || weaponKinds.length > 6
    || !weaponKinds.every((kind) => Object.hasOwn(SPACE_WEAPON_PROFILES, kind))
    || typeof reducedMotion !== 'boolean' || typeof hero !== 'boolean'
    || typeof getAudioSettings !== 'function') throw new TypeError('Invalid battle preview weapon or motion options');
  if (!Number.isInteger(shipCount) || shipCount < 4 || shipCount > 128 || shipCount % 2
    || (!hero && shipCount !== 4) || typeof fleetLod !== 'boolean'
    || (!hero && fleetLod) || typeof cinematic !== 'boolean' || (!hero && cinematic)
    || !['classic', 'mixed'].includes(formation) || (formation === 'mixed' && (!cinematic || shipCount < 8))
    || typeof tactics !== 'boolean' || (tactics && formation !== 'mixed')
    || !['battle', 'convoy'].includes(scenario) || (scenario === 'convoy' && (!hero || formation !== 'mixed'))
    || typeof reinforcements !== 'boolean' || (reinforcements && scenario !== 'convoy')
    || !Number.isInteger(primitiveBudget) || primitiveBudget < 1 || primitiveBudget > 768) {
    throw new RangeError('Invalid fleet preview size, LOD or primitive budget');
  }
  if (seed === undefined) seed = hero && formation === 'mixed'
    ? crypto.getRandomValues(new Uint32Array(1))[0] : 42;
  const space = renderer.getSpaceView();
  const body = space?.bodies.find((entry) => entry.userData.type === 'planet');
  if (!body || !space.weaponRenderPass) throw new Error('Enter a rendered system before starting a battle preview');
  if (space.cameraFollowEntity) throw new Error('Stop camera-follow before starting a battle preview');
  if (activePreviews.has(space)) throw new Error('A battle preview is already running');
  if (document.visibilityState === 'hidden') throw new Error('Battle preview requires a visible page');
  const camera = space.camera;
  const pose = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
  const origin = space.origin.clone();
  const root = space.root;
  const center = body.getWorldPosition(new Vector3());
  const scale = body.userData.radius;
  const prefix = `visual-battle-${crypto.randomUUID()}`;
  const entities = [];
  const effects = new Set();
  let detach = null;
  let timeout = null;
  let stopped = false;
  let volleys = 0;
  let shots = 0;
  const firedKinds = new Set();
  let cameraChanged = false;
  const listeners = new AbortController();
  let complete;
  const heroSession = hero ? new HeroBattleSession(space, {
    seed, audio, view, getAudioSettings, fleetLod, primitiveBudget, cinematic, formation, tactics, scenario, reinforcements,
    durationSeconds: durationMs / 1000,
  }) : null;
  const finished = new Promise((resolve) => { complete = resolve; });
  const getStats = () => ({
    volleys, ships: entities.length, activeEffects: effects.size,
    drawnEffects: space.weaponRenderPass.drawnEffects, shots: heroSession?.shots ?? shots,
    weaponKinds: heroSession ? [...new Set(heroSession.log.map((entry) => entry.kind))] : [...firedKinds],
    reducedMotion, stopped, ...(heroSession ? { hero: heroSession.snapshot() } : {}),
  });
  const issueCommand = (command) => {
    if (stopped) throw new Error('Die QA-Schlacht ist beendet');
    if (!heroSession) throw new Error('Dieses Preview unterstuetzt keine QA-Befehle');
    return heroSession.issueCommand(command);
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    activePreviews.delete(space);
    const errors = [];
    const attempt = (action) => { try { action(); } catch (error) { errors.push(error); } };
    attempt(() => detach?.());
    clearTimeout(timeout);
    listeners.abort();
    attempt(() => space.weaponRenderPass.remove(effects));
    effects.clear();
    for (const entity of entities) attempt(() => {
      if (space.spaceEntities.get(entity.id) === entity) space._removeSpaceEntity(entity);
    });
    attempt(() => {
      if (cameraChanged && space.origin.equals(origin) && space.bodies.includes(body)) {
        camera.position.copy(pose.position);
        camera.quaternion.copy(pose.quaternion);
        camera.updateMatrixWorld(true);
      }
    });
    if (space.heroBattle === heroSession) space.heroBattle = null;
    if (heroSession) {
      void heroSession.dispose().then(() => {
        complete({ volleys, cleaned: errors.length === 0, hero: heroSession.snapshot() });
      }).catch((error) => {
        complete({ volleys, cleaned: false, error: String(error), hero: heroSession.snapshot() });
        console.error('[hero-battle-cleanup]', error);
      });
    } else complete({ volleys, cleaned: errors.length === 0 });
    if (errors.length) throw new AggregateError(errors, 'Battle preview cleanup failed');
  }
  activePreviews.add(space);
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stop();
    }, { signal: listeners.signal });
    timeout = setTimeout(stop, durationMs);
    for (let index = 0; index < shipCount; index++) {
      if (stopped) break;
      const side = index < shipCount / 2 ? -1 : 1;
      const position = center.clone().add(new Vector3(side * scale * 4, -scale * 3, (index % 2 - 0.5) * scale * 3));
      const id = `${prefix}-${index}`;
      const shipClass = heroShipClassAt(index, shipCount, formation);
      const profile = HERO_SHIP_PROFILES[shipClass];
      const loading = space.registerSpaceVessel({ id,
        ...(hero ? { model_url: `procedural:hero-${shipClass}` } : {}),
        route: [position.clone().add(origin).toArray(), position.clone().add(origin).toArray()],
        visual_scale_ly: scale * (profile?.scale ?? (cinematic && index % 2 === 0 ? 0.85 : 1.2)),
        reduced_motion: true, engine_effects: false,
        color: side < 0 ? [0.3, 0.85, 1, 1] : [1, 0.45, 0.2, 1],
        display_name: hero ? `QA ${profile?.label ?? (index % 2 ? 'Kreuzer' : 'Fregatte')}`
          : side < 0 ? 'QA Blau' : 'QA Rot',
      });
      const entity = space.spaceEntities.get(id);
      if (entity) {
        if (reinforcements) entity.heroPending = index % (shipCount / 2) >= Math.ceil(shipCount / 4);
        entities.push(entity);
      }
      const loaded = await loading;
      if (stopped) break;
      if (!loaded) throw new Error(`Preview ship could not be loaded: ${id}`);
    }
    if (stopped) return { stop, finished, getStats, issueCommand };
    if (!space.bodies.includes(body) || !space.origin.equals(origin)) {
      throw new Error('System changed while loading the battle preview');
    }
    if (heroSession) {
      await heroSession.initialize(entities, center, scale);
      if (stopped) return { stop, finished, getStats, issueCommand };
      space.heroBattle = heroSession;
      heroSession.attachHud(stop);
    }
    cameraChanged = true;
    const distance = hero ? ({ near: 20, middle: 45, system: 120 }[view]) : 20;
    camera.position.copy(center).add(new Vector3(0, -scale * distance, scale * distance * 0.45));
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    const started = performance.now() / 1000;
    let nextVolley = started;
    function positionAt(index, elapsed) {
      const side = index < 2 ? -1 : 1;
      const phase = elapsed * 0.65 + index * Math.PI * 0.5;
      return center.clone().add(origin).add(new Vector3(
        side * scale * 4 + (reducedMotion ? 0 : Math.sin(phase) * scale),
        -scale * 3 + (reducedMotion ? 0 : Math.cos(phase) * scale * 0.8),
        (index % 2 - 0.5) * scale * 3 + (reducedMotion ? 0 : Math.sin(phase * 0.8) * scale),
      ));
    }
    function velocityAt(index, elapsed) {
      if (reducedMotion) return new Vector3();
      const phase = elapsed * 0.65 + index * Math.PI * 0.5;
      return new Vector3(Math.cos(phase) * scale * 0.65,
        -Math.sin(phase) * scale * 0.52, Math.cos(phase * 0.8) * scale * 0.52);
    }
    const frame = () => {
      if (stopped) return;
      if (!space.bodies.includes(body) || space.root !== root || !space.origin.equals(origin)
        || entities.some((entity) => space.spaceEntities.get(entity.id) !== entity)
        || document.visibilityState === 'hidden') { stop(); return; }
      const time = performance.now() / 1000;
      const elapsed = time - started;
      if (heroSession) {
        heroSession.update(Math.min(elapsed, durationMs / 1000), !reducedMotion, effects, weaponKinds);
        const expired = new Set();
        for (const effect of effects) {
          if (heroSession.time >= effect.time + effect.lifetime) { expired.add(effect); effects.delete(effect); }
        }
        if (expired.size) space.weaponRenderPass.remove(expired);
        return;
      }
      for (let index = 0; index < entities.length; index++) {
        const entity = entities[index];
        entity.position.copy(positionAt(index, elapsed));
        const heading = reducedMotion
          ? entities[(index + 2) % entities.length].position.clone().sub(entity.position)
          : velocityAt(index, elapsed);
        entity.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), heading.normalize());
      }
      const expired = new Set();
      for (const effect of effects) {
        if (time >= effect.time + effect.lifetime) { expired.add(effect); effects.delete(effect); }
      }
      if (expired.size) space.weaponRenderPass.remove(expired);
      if (time < nextVolley) return;
      nextVolley = time + 0.6;
      volleys++;
      for (let index = 0; index < entities.length; index++) {
        const source = entities[index];
        const targetIndex = (index + 2) % entities.length;
        const target = entities[targetIndex];
        if ((volleys % 2 === 1) !== (index < 2)) continue;
        const kind = weaponKinds[((volleys - 1) * 2 + index % 2) % weaponKinds.length];
        const flightSeconds = SPACE_WEAPON_PROFILES[kind].flightSeconds;
        // This QA fixture explicitly supplies illustrative hit/miss outcomes and aim points.
        const impact = (volleys + index) % 4 !== 0;
        const aim = positionAt(targetIndex, elapsed + flightSeconds);
        if (!impact) aim.z += scale * 2;
        const muzzleOffset = new Vector3(0.42, (index % 2 ? -1 : 1) * 0.18, 0.08);
        effects.add(space.weaponRenderPass.fireWeapon(kind, source, aim, {
          time, muzzleOffset, sourceVelocity: velocityAt(index, elapsed), impact,
          target: kind === 'laser' && impact ? target : null,
        }));
        shots++;
        firedKinds.add(kind);
      }
    };
    detach = renderer.getSharedZoomBackend().addFrameHook(frame);
    frame();
    if (heroSession && !stopped) {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        frame();
        if (stopped) return;
        heroSession.update(durationMs / 1000, !reducedMotion, effects, weaponKinds);
        stop();
      }, durationMs);
    }
    return { stop, finished, getStats, issueCommand };
  } catch (error) {
    try { stop(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Battle preview setup and cleanup failed');
    }
    throw error;
  }
}
