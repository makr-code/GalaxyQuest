import { afterEach, describe, expect, it, vi } from 'vitest';
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { createHeroBattleModel, aimHeroTurret, HERO_SHIP_PROFILES, heroShipClassAt } from '../../js/rendering/hero-battle-models.js';
import { HeroBattleSession } from '../../js/rendering/hero-battle-session.js';
import { HeroBattleDepth } from '../../js/rendering/hero-battle-depth.js';
import { HeroBattleMetrics, summarizeSamples } from '../../js/rendering/hero-battle-metrics.js';
import { HeroBattleAudio } from '../../js/rendering/hero-battle-audio.js';
import { SPACE_WEAPON_PROFILES, resolveWeaponMuzzle } from '../../js/rendering/space-weapon-render-pass.js';
import { startHeroBattlePreview } from '../../js/rendering/system-battle-preview.js';
import { HeroBattleHud } from '../../js/rendering/hero-battle-hud.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function createSession(seed = 42, shipCount = 4, fleetLod = false, cinematic = false, formation = 'classic', tactics = false) {
  const space = new PerspectiveSpaceFlight();
  for (let index = 0; index < shipCount; index++) {
    await space.registerSpaceVessel({
      id: `qa-${index}`, model_url: `procedural:hero-${heroShipClassAt(index, shipCount, formation)}`,
      route: [[0, 0, 0], [0, 0, 0]], reduced_motion: true, engine_effects: false, visual_scale_ly: 0.1,
    });
  }
  const session = new HeroBattleSession(space, { seed, view: 'near', audio: false, fleetLod, cinematic, formation, tactics });
  await session.initialize([...space.spaceEntities.values()], new Vector3(), 1);
  return { space, session };
}

describe('hero model contract', () => {
  it('loads four distinct mixed-class silhouettes and mirrored fleet slots with normalized weapon rigs', async () => {
    const { space, session } = await createSession(42, 24, true, true, 'mixed');
    expect(space.vesselRenderPass.assets.size).toBe(4);
    const wing = session.entities.slice(0, 12).map(entity => entity.heroStatus.shipClass);
    expect(wing).toEqual(session.entities.slice(12).map(entity => entity.heroStatus.shipClass));
    expect(wing.filter(kind => kind === 'carrier')).toHaveLength(1);
    expect(wing.filter(kind => kind === 'battlecruiser')).toHaveLength(2);
    expect(wing.filter(kind => kind === 'corvette')).toHaveLength(3);
    expect(wing.filter(kind => kind === 'fighter')).toHaveLength(6);
    const silhouettes = [...space.vesselRenderPass.assets.values()].map(asset => asset.vertices.join(','));
    expect(new Set(silhouettes).size).toBe(4);
    for (const entity of session.entities) {
      expect(entity.weaponRig.muzzle.length()).toBeGreaterThan(0);
      expect(entity.weaponRig.vertices.every(Number.isFinite)).toBe(true);
      expect(entity.heroStatus.label).toBe(HERO_SHIP_PROFILES[entity.heroStatus.shipClass].label);
    }
    const hud = new HeroBattleHud();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const carrier = session.entities[0];
    carrier.position.set(0, 0, -5);
    hud.update([carrier], camera, new Vector3(), 800, 800);
    expect(hud.entries.get(carrier.id).label.textContent).toBe('Traeger 100%');
    hud.dispose();
    expect(() => heroShipClassAt(24, 24, 'mixed')).toThrow(TypeError);
    await session.dispose();
    space.dispose();
  });
  it('updates projected shield/hull bars and hides occluded/offscreen statuses', () => {
    const hud = new HeroBattleHud();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const entity = { id: 'qa', position: new Vector3(0, 0, -5), scale: 0.1,
      heroStatus: { role: 'hit-and-run', shield: 0.65, hull: 0.32, destroyed: false } };
    hud.update([entity], camera, new Vector3(), 800, 800);
    const entry = hud.entries.get('qa');
    expect(entry.node.hidden).toBe(false);
    expect(entry.bars[0].style.width).toBe('65%');
    expect(entry.bars[1].parentElement.getAttribute('aria-valuenow')).toBe('32');
    entity.heroStatus.hull = 0;
    entity.heroStatus.destroyed = true;
    hud.update([entity], camera, new Vector3(), 800, 800);
    expect(entry.label.textContent).toBe('WRACK · QA');
    expect(entry.bars[1].style.width).toBe('0%');
    const planet = new Object3D();
    planet.position.z = -3;
    planet.userData = { type: 'planet', radius: 1 };
    hud.update([entity], camera, new Vector3(), 800, 800, [planet]);
    expect(entry.node.hidden).toBe(true);
    entity.position.x = 100;
    hud.update([entity], camera, new Vector3(), 800, 800);
    expect(entry.node.hidden).toBe(true);
    hud.dispose();
    expect(document.querySelector('[data-hero-battle-hud]')).toBeNull();
  });
  it('has two distinct authored silhouettes and named turret/muzzle transforms', () => {
    const frigate = createHeroBattleModel('frigate');
    const cruiser = createHeroBattleModel('cruiser');
    expect(frigate.getObjectByName('turret_primary').getObjectByName('muzzle_primary')).toBeTruthy();
    expect(cruiser.children[0].geometry.parameters.width).toBe(4);
    expect(cruiser.children[0].geometry.parameters.height)
      .toBeGreaterThan(frigate.children[0].geometry.parameters.height);
    expect(() => createHeroBattleModel('invalid')).toThrow(TypeError);
    for (const root of [frigate, cruiser]) root.traverse((node) => {
      node.geometry?.dispose();
      node.material?.dispose();
    });
  });

  it('extracts model-derived rig geometry without baking the turret into the hull', async () => {
    const { space, session } = await createSession();
    const assets = [...space.vesselRenderPass.assets.values()];
    expect(assets).toHaveLength(2);
    for (const asset of assets) {
      expect(asset.rig.vertices.length).toBeGreaterThan(0);
      expect(asset.rig.pivot.toArray().every(Number.isFinite)).toBe(true);
      expect(asset.rig.muzzle.x).toBeCloseTo(1.05 / 4);
      expect(asset.shieldVertices.length).toBeGreaterThan(0);
    }
    await session.dispose();
    space.dispose();
  });

  it('limits turret turning speed and elevation and preserves hull orientation', () => {
    const entity = { position: new Vector3(1, 2, 3), quaternion: new Quaternion(), scale: 2,
      weaponRig: { pivot: new Vector3(0.1, 0, 0.2), muzzle: new Vector3(0.3, 0, 0) } };
    const hullPose = entity.quaternion.clone();
    aimHeroTurret(entity, new Vector3(-10, 2, 100), 0.01);
    expect(new Quaternion().angleTo(entity.turretQuaternion)).toBeLessThanOrEqual(0.01 * Math.PI * 2 + 1e-6);
    for (let index = 0; index < 100; index++) aimHeroTurret(entity, new Vector3(-10, 2, 100), 0.1);
    const direction = new Vector3(1, 0, 0).applyQuaternion(entity.turretQuaternion);
    expect(Math.abs(direction.z)).toBeLessThanOrEqual(Math.SQRT1_2 + 1e-6);
    expect(entity.quaternion.equals(hullPose)).toBe(true);
    const mount = aimHeroTurret(entity, new Vector3(-10, 2, 100), 0, 0.02);
    expect(mount.muzzleOffset.x).toBeCloseTo(0.28);
  });
});

describe('seeded hero replay', () => {
  it('repeats tactical decisions across cadences, varies seeds and preserves authored damage', async () => {
    const a = await createSession(42, 24, true, true, 'mixed', true);
    const b = await createSession(42, 24, true, true, 'mixed', true);
    const c = await createSession(43, 24, true, true, 'mixed', true);
    const kinds = Object.keys(SPACE_WEAPON_PROFILES);
    const authored = session => session.damageEvents.map(event => ({ at: event.at, shield: event.shield, hull: event.hull }));
    expect(authored(a.session)).toEqual(authored(c.session));
    const effects = new Set();
    for (let step = 0; step <= 1080; step++) a.session.update(step / 60, true, effects, kinds);
    for (let step = 0; step <= 360; step++) {
      b.session.positionAt(step % 24, step / 20 + 2, true);
      b.session.update(step / 20, true, new Set(), kinds);
    }
    c.session.update(18, true, new Set(), kinds);
    expect(a.session.log).toEqual(b.session.log);
    expect(a.session.decisions).toEqual(b.session.decisions);
    expect(a.session.outcomes).toEqual(b.session.outcomes);
    expect(a.session.decisions).not.toEqual(c.session.decisions);
    expect(a.session.log).not.toEqual(c.session.log);
    expect(a.session.debrisCount).toBe(6);
    expect(c.session.debrisCount).toBe(6);
    expect(new Set(a.session.decisions.map(entry => entry.strategy)).size).toBe(4);
    expect(a.session.decisions.length).toBeLessThanOrEqual(1152);
    expect(effects.size).toBeLessThanOrEqual(64);
    for (const entry of a.session.decisions) {
      if (entry.target < 0) continue;
      expect(entry.source < 12).not.toBe(entry.target < 12);
      const death = a.session.damageEvents.find(event => event.entity === a.session.entities[entry.target] && event.hull === 0);
      if (death) expect(entry.step / 60).toBeLessThan(death.at);
    }
    for (const entry of a.session.log.filter(shot => shot.strategy === 'withdraw')) {
      expect(entry.step / 60 - entry.phase * 4).toBeGreaterThanOrEqual(1.5);
    }
    const snapshot = a.session.snapshot();
    snapshot.tactics.decisions[0].target = -999;
    snapshot.tactics.plans[0].strategy = 'invalid';
    expect(a.session.snapshot().tactics.decisions[0].target).not.toBe(-999);
    expect(a.session.snapshot().tactics.plans[0].strategy).not.toBe('invalid');
    await a.session.dispose();
    await b.session.dispose();
    await c.session.dispose();
    a.space.dispose(); b.space.dispose(); c.space.dispose();
  });
  it('keeps tactical positions stationary under reduced motion and cancels plans without fast-forwarding', async () => {
    const { space, session } = await createSession(42, 128, true, true, 'mixed', true);
    session.update(30, false, new Set(), Object.keys(SPACE_WEAPON_PROFILES));
    for (const [index, entity] of session.entities.entries()) {
      expect(entity.position).toEqual(session.positionAt(index, 0, false));
    }
    expect(session.decisions.length).toBeLessThanOrEqual(1152);
    expect(space.weaponRenderPass.effects.length).toBeLessThanOrEqual(64);
    expect(session.damagePass.effects.length).toBeLessThanOrEqual(64);
    const step = session.step;
    await session.dispose();
    expect(session.step).toBe(step);
    expect(session.debrisPass.bursts).toHaveLength(0);
    expect(session.destructions).toHaveLength(0);
    space.dispose();
  });
  it('generates fresh seeds for mixed previews and accepts an explicit seed for reproducibility', async () => {
    const space = new PerspectiveSpaceFlight();
    const body = new Object3D();
    body.userData = { type: 'planet', radius: 1 };
    space.bodies.push(body);
    const renderer = { getSpaceView: () => space, getSharedZoomBackend: () => ({ addFrameHook: () => () => {} }) };
    let next = 100;
    const getRandomValues = vi.fn(values => { values[0] = next++; return values; });
    vi.stubGlobal('crypto', { randomUUID: () => `qa-${next}`, getRandomValues });
    for (const seed of [100, 101]) {
      const preview = await startHeroBattlePreview(renderer);
      expect(preview.getStats().hero.seed).toBe(seed);
      expect(preview.getStats().hero.tactics.enabled).toBe(true);
      preview.stop();
      expect((await preview.finished).cleaned).toBe(true);
    }
    const explicit = await startHeroBattlePreview(renderer, { seed: 77 });
    expect(explicit.getStats().hero.seed).toBe(77);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    explicit.stop();
    await explicit.finished;
    const fixed = await startHeroBattlePreview(renderer, { seed: 42, tactics: false });
    expect(fixed.getStats().hero.tactics.enabled).toBe(false);
    fixed.stop();
    await fixed.finished;
    const classic = await startHeroBattlePreview(renderer, { cinematic: false });
    expect(classic.getStats().hero.seed).toBe(42);
    expect(classic.getStats().hero.tactics.enabled).toBe(false);
    classic.stop();
    await classic.finished;
    space.dispose();
  });
  it('keeps mixed-class motion, weapon roles, shield timeline and outcomes deterministic', async () => {
    const a = await createSession(42, 24, true, true, 'mixed');
    const b = await createSession(42, 24, true, true, 'mixed');
    const kinds = Object.keys(SPACE_WEAPON_PROFILES);
    const paths = [0, 1, 2, 3].map(index => Array.from({ length: 240 }, (_, step) =>
      a.session.positionAt(index, step / 60, true)));
    const span = points => Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
    expect(span(paths[0])).toBeLessThan(0.3);
    expect(span(paths[1])).toBeLessThan(0.8);
    expect(span(paths[2])).toBeGreaterThan(4.8);
    expect(span(paths[3])).toBeGreaterThan(6.5);
    for (let index = 0; index < 24; index++) {
      expect(a.session.positionAt(index, 0, false)).toEqual(a.session.positionAt(index, 10, false));
      expect(a.session.positionAt(index, 0, false).x).toBe(-a.session.positionAt((index + 12) % 24, 0, false).x);
    }
    a.session.update(5, true, new Set(), kinds);
    expect(a.session.entities[0].heroStatus.shield).toBe(0.6);
    expect(a.session.entities[3].heroStatus.shield).toBe(0);
    a.session.update(6.8, true, new Set(), kinds);
    expect(new Set(a.session.log.map(entry => entry.kind)).size).toBe(6);
    for (const entry of a.session.log) {
      expect(HERO_SHIP_PROFILES[a.session.entities[entry.source].heroStatus.shipClass].weapons).toContain(entry.kind);
    }
    const lastShot = a.session.log.at(-1);
    expect(lastShot.from).not.toEqual(a.session.entities[lastShot.source].position.toArray());
    for (let step = 409; step <= 840; step++) a.session.update(step / 60, true, new Set(), kinds);
    for (let step = 0; step <= 280; step++) b.session.update(step / 20, true, new Set(), kinds);
    expect(a.session.log).toEqual(b.session.log);
    expect(a.session.outcomes).toEqual(b.session.outcomes);
    expect(a.session.debrisCount).toBe(6);
    expect(a.session.explosionCount).toBe(12);
    expect(a.session.entities[0].heroStatus.shield).toBe(0.25);
    expect(a.session.entities[1].heroDestroyed).toBe(true);
    expect(a.session.snapshot().formation).toBe('mixed');
    await a.session.dispose();
    await b.session.dispose();
    a.space.dispose();
    b.space.dispose();
  });
  it('defaults the public hero preview to 24 mixed ships while retaining opt-in classic presentation', async () => {
    const space = new PerspectiveSpaceFlight();
    const body = new Object3D();
    body.userData = { type: 'planet', radius: 1 };
    space.bodies.push(body);
    const renderer = { getSpaceView: () => space, getSharedZoomBackend: () => ({ addFrameHook: () => () => {} }) };
    const preview = await startHeroBattlePreview(renderer, { reducedMotion: false });
    expect(preview.getStats().ships).toBe(24);
    expect(preview.getStats().hero.formation).toBe('mixed');
    expect(new Set(preview.getStats().hero.presentation.ships.map(ship => ship.shipClass)).size).toBe(4);
    const scales = [...space.spaceEntities.values()].map(entity => entity.scale);
    expect(Math.max(...scales) / Math.min(...scales)).toBeGreaterThan(7);
    preview.stop();
    expect((await preview.finished).cleaned).toBe(true);
    const classic = await startHeroBattlePreview(renderer, { formation: 'classic' });
    expect(classic.getStats().ships).toBe(4);
    expect(classic.getStats().hero.formation).toBe('classic');
    classic.stop();
    expect((await classic.finished).cleaned).toBe(true);
    space.dispose();
  });
  it('keeps 128 mixed ships bounded and honors explicit weapon filters without moving reduced-motion ships', async () => {
    const { space, session } = await createSession(42, 128, true, true, 'mixed');
    const initial = session.entities.map((_, index) => session.positionAt(index, 0, false));
    const effects = new Set();
    session.update(13, false, effects, ['missile']);
    expect(new Set(session.log.map(entry => entry.kind))).toEqual(new Set(['missile']));
    for (const [index, entity] of session.entities.entries()) expect(entity.position).toEqual(initial[index]);
    expect(space.weaponRenderPass.effects.length).toBeLessThanOrEqual(64);
    expect(effects.size).toBeLessThanOrEqual(64);
    expect(session.damagePass.effects.length).toBeLessThanOrEqual(64);
    expect(session.destructions.length).toBeLessThanOrEqual(16);
    expect(session.debrisPass.bursts.length).toBeLessThanOrEqual(16);
    await session.dispose();
    expect(session.destructions).toHaveLength(0);
    space.dispose();
  });
  it('authors health changes, fires and destruction/debris independently of render cadence', async () => {
    const a = await createSession(42, 4, false, true);
    const b = await createSession(42, 4, false, true);
    const kinds = Object.keys(SPACE_WEAPON_PROFILES);
    a.session.attachHud();
    expect(document.querySelector('[data-hero-battle-hud]')).toBeTruthy();
    a.session.update(1, true, new Set(), kinds);
    expect(a.session.entities[0].heroStatus.hull).toBe(1);
    a.session.update(3, true, new Set(), kinds);
    expect(a.session.entities[0].heroStatus.hull).toBe(0.68);
    expect(a.session.fireCount).toBeGreaterThan(0);
    for (let step = 181; step <= 552; step++) a.session.update(step / 60, true, new Set(), kinds);
    for (let step = 0; step <= 184; step++) b.session.update(step / 20, true, new Set(), kinds);
    expect(a.session.log).toEqual(b.session.log);
    expect(a.session.entities[0].heroDestroyed).toBe(true);
    expect(a.session.entities[0].heroStatus.hull).toBe(0);
    expect(a.session.explosionCount).toBe(5);
    expect(a.session.debrisCount).toBe(2);
    expect(a.session.debrisPass.bursts).toHaveLength(2);
    expect(a.session.debrisPass.bursts).toEqual(b.session.debrisPass.bursts);
    expect(a.session.fireCount).toBe(b.session.fireCount);
    expect(a.session.debrisPass.sample(a.session.debrisPass.bursts[0], 8)).toHaveLength(12);
    const cloud = a.session.damagePass.effects.find(effect => effect.presentation === 'debris');
    expect(a.session.damagePass.sample(cloud, 8).every(primitive => primitive.shape === 3)).toBe(true);
    expect(a.session.log.filter(event => event.source === 0).every(event => event.step < 390)).toBe(true);
    expect(a.session.snapshot().presentation.ships[1].role).toBe('standoff');
    expect(a.session.damagePass.effects.length).toBeLessThanOrEqual(64);
    await a.session.dispose();
    await b.session.dispose();
    expect(document.querySelector('[data-hero-battle-hud]')).toBeNull();
    expect(a.session.damagePass.effects).toHaveLength(0);
    expect(a.session.debrisPass.bursts).toHaveLength(0);
    expect(a.session.destructions).toHaveLength(0);
    a.space.dispose();
    b.space.dispose();
  });
  it('stages cruiser detonations on the copied moving hull and attaches fire to major wreck fragments', async () => {
    const { space, session } = await createSession(42, 4, false, true);
    const kinds = Object.keys(SPACE_WEAPON_PROFILES);
    session.update(4.8, true, new Set(), kinds);
    const cruiser = session.entities[1];
    const localFires = session.damagePass.effects.filter(effect => effect.presentation === 'fire' && effect.source === cruiser);
    expect(new Set(localFires.map(effect => effect.muzzleOffset.toArray().join(','))).size).toBe(3);
    session.update(8, true, new Set(), kinds);
    const sequence = session.destructions.find(entry => entry.burst.shipClass === 'cruiser');
    expect(sequence.nextDetonation).toBe(1);
    const origin = sequence.burst.position.clone();
    const orientation = sequence.burst.quaternion.clone();
    const velocity = sequence.velocity.clone();
    expect(velocity.length()).toBeGreaterThan(0);
    cruiser.position.set(100, 200, 300);
    cruiser.quaternion.identity();
    session.update(8.3, true, new Set(), kinds);
    expect(sequence.nextDetonation).toBe(2);
    const explosion = session.damagePass.effects.filter(effect => effect.presentation === 'explosion').at(-1);
    const expected = new Vector3(0.28, 0.08, 0).multiplyScalar(cruiser.scale)
      .applyQuaternion(orientation).add(origin).addScaledVector(velocity, 0.3);
    expect(explosion.from.distanceTo(expected)).toBeLessThan(1e-12);
    expect(session.damagePass.sample(explosion, 8.5)[0].from.distanceTo(expected.addScaledVector(velocity, 0.2)))
      .toBeLessThan(1e-12);
    session.update(9, true, new Set(), kinds);
    expect(sequence.nextDetonation).toBe(4);
    expect(session.explosionCount).toBe(5);
    expect(session.damagePass.effects.filter(effect => effect.presentation === 'explosion' && effect.time >= 8)
      .map(effect => effect.time)).toEqual([8, 8.3, 8.65, 9]);
    const fragments = session.debrisPass.sample(sequence.burst, 9);
    expect(sequence.wreckSources).toHaveLength(2);
    for (const [index, wreck] of sequence.wreckSources.entries()) {
      expect(wreck.position.distanceTo(fragments[index].position)).toBeLessThan(1e-12);
      const fire = session.damagePass.effects.filter(effect => effect.presentation === 'fire' && effect.source === wreck).at(-1);
      expect(fire).toBeTruthy();
      expect(session.damagePass.sample(fire, 9)[0].from.distanceTo(resolveWeaponMuzzle(wreck, fire.muzzleOffset)))
        .toBeLessThan(1e-12);
      expect(fire.muzzleOffset.z * wreck.scale).toBeGreaterThan(fragments[index].size.z * 0.5);
    }
    session.update(14, true, new Set(), kinds);
    expect(session.destructions).toHaveLength(0);
    await session.dispose();
    space.dispose();
  });
  it('bounds concurrent staged destruction and cancels pending detonations on early disposal', async () => {
    const { space, session } = await createSession(42, 128, true, true);
    session.update(8, false, new Set(), Object.keys(SPACE_WEAPON_PROFILES));
    expect(session.debrisPass.bursts).toHaveLength(16);
    expect(session.destructions).toHaveLength(16);
    expect(session.destructions.every(sequence => sequence.burst.shipClass === 'cruiser')).toBe(true);
    expect(session.damagePass.effects.length).toBeLessThanOrEqual(64);
    const explosions = session.explosionCount;
    await session.dispose();
    expect(session.destructions).toHaveLength(0);
    expect(session.explosionCount).toBe(explosions);
    expect(session.damagePass.effects).toHaveLength(0);
    space.dispose();
  });
  it('moves frigates through attack/retreat runs while cruisers keep standoff range', async () => {
    const { space, session } = await createSession(42, 4, false, true);
    const small = [];
    const large = [];
    for (let step = 0; step < 252; step++) {
      small.push(session.positionAt(0, step / 60, true));
      large.push(session.positionAt(1, step / 60, true));
    }
    const span = points => Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
    expect(span(small)).toBeGreaterThan(5);
    expect(span(large)).toBeLessThan(0.5);
    expect(large.every(p => Math.abs(p.x) >= 6.75)).toBe(true);
    expect(session.positionAt(0, 0, false).equals(session.positionAt(0, 4, false))).toBe(true);
    await session.dispose();
    space.dispose();
  });
  it('does not report a previous session render as a new fleet budget violation', async () => {
    const { space, session } = await createSession(42, 4, true);
    space.weaponRenderPass.drawnEffects = 600;
    session.update(0, true, new Set(), Object.keys(SPACE_WEAPON_PROFILES));
    expect(session.snapshot().fleet.peakPrimitives).toBe(0);
    space.weaponRenderPass.drawnEffects = 32;
    space.weaponRenderPass.frameStats = { primitives: 32 };
    space.vesselRenderPass.frameStats = { drawCalls: 4 };
    session.recordRenderStats();
    expect(session.snapshot().fleet.peakPrimitives).toBe(32);
    expect(session.snapshot().fleet.peakShipDrawCalls).toBe(4);
    await session.dispose();
    space.dispose();
  });
  it('settles a timed replay at the exact requested presentation step despite late frame callbacks', async () => {
    vi.useFakeTimers();
    const space = new PerspectiveSpaceFlight();
    const body = new Object3D();
    body.userData = { type: 'planet', radius: 1 };
    space.bodies.push(body);
    const renderer = { getSpaceView: () => space, getSharedZoomBackend: () => ({
      addFrameHook: () => () => {},
    }) };
    const preview = await startHeroBattlePreview(renderer, { durationMs: 4000, reducedMotion: false, shipCount: 32 });
    await vi.advanceTimersByTimeAsync(4000);
    const result = await preview.finished;
    expect(result.hero.replayTime).toBe(4);
    expect(result.hero.shots).toBeGreaterThan(32);
    expect(result.hero.fleet.ships).toBe(32);
    expect(result.hero.fleet.enabled).toBe(true);
    expect(result.hero.limits.primitives).toBe(256);
    expect(result.cleaned).toBe(true);
    expect(space.weaponRenderPass.effects).toHaveLength(0);
    expect(space.vesselRenderPass.assets.size).toBe(0);
    space.dispose();
  });
  it('keeps a 128-ship stress replay bounded and identical across frame cadences', async () => {
    const a = await createSession(42, 128, true);
    const b = await createSession(42, 128, true);
    const effectsA = new Set();
    const effectsB = new Set();
    const kinds = Object.keys(SPACE_WEAPON_PROFILES);
    for (let step = 0; step <= 480; step++) {
      a.session.update(step / 60, true, effectsA, kinds);
      expect(a.space.weaponRenderPass.effects.length).toBeLessThanOrEqual(64);
      expect(effectsA.size).toBeLessThanOrEqual(64);
    }
    for (let step = 0; step <= 160; step++) b.session.update(step / 20, true, effectsB, kinds);
    expect(a.session.shots).toBeGreaterThan(500);
    expect(a.session.log).toHaveLength(256);
    expect(a.session.log).toEqual(b.session.log);
    expect(a.session.outcomes).toEqual(b.session.outcomes);
    expect(a.session.positionAt(0, 0, false).x).toBe(-4);
    expect(a.session.positionAt(64, 0, false).x).toBe(4);
    expect(a.space.weaponRenderPass.evictedEffects).toBeGreaterThan(0);
    expect(a.session.snapshot().fleet.peakRetainedEffects).toBeLessThanOrEqual(64);
    await a.session.dispose();
    await b.session.dispose();
    a.space.dispose();
    b.space.dispose();
  });
  it('pauses an existing camera flight while the diagnostic owns the camera', () => {
    const space = new PerspectiveSpaceFlight();
    const pose = space.camera.position.clone();
    const orientation = space.camera.quaternion.clone();
    space.flight = { focus: new Vector3(10, 0, 0) };
    space.heroBattle = {};
    space.update(0.05);
    expect(space.camera.position.equals(pose)).toBe(true);
    expect(space.camera.quaternion.equals(orientation)).toBe(true);
    expect(space.effectTime).toBe(0.05);
    space.heroBattle = null;
    space.flight = null;
    space.dispose();
  });
  it('cleans hero-owned entities and frame hooks, restores the camera and awaits measurement disposal', async () => {
    vi.useFakeTimers();
    const space = new PerspectiveSpaceFlight();
    const body = new Object3D();
    body.userData = { type: 'planet', radius: 1 };
    space.bodies.push(body);
    const pose = space.camera.position.clone();
    let callback;
    const detach = vi.fn();
    const renderer = { getSpaceView: () => space, getSharedZoomBackend: () => ({
      addFrameHook: (hook) => { callback = hook; return detach; },
    }) };
    const preview = await startHeroBattlePreview(renderer, { durationMs: 4000, reducedMotion: false, seed: 42 });
    await vi.advanceTimersByTimeAsync(1600);
    callback();
    expect(preview.getStats().hero.shots).toBeGreaterThan(0);
    expect(space.heroBattle).toBeTruthy();
    preview.stop();
    const result = await preview.finished;
    expect(result.cleaned).toBe(true);
    expect(result.hero.seed).toBe(42);
    expect(space.heroBattle).toBeNull();
    expect(space.camera.position.equals(pose)).toBe(true);
    expect(space.spaceEntities.size).toBe(0);
    expect(space.weaponRenderPass.effects).toHaveLength(0);
    expect(space.vesselRenderPass.resources.size).toBe(0);
    expect(space.vesselRenderPass.assets.size).toBe(0);
    expect(detach).toHaveBeenCalledOnce();
    space.dispose();
  });
  it('produces identical shot transforms and outcomes independent of presentation frame cadence', async () => {
    const a = await createSession();
    const b = await createSession();
    const effectsA = new Set();
    const effectsB = new Set();
    const kinds = Object.keys(SPACE_WEAPON_PROFILES);
    for (let step = 0; step <= 300; step++) a.session.update(step / 60, true, effectsA, kinds);
    for (let step = 0; step <= 100; step++) b.session.update(step / 20, true, effectsB, kinds);
    expect(a.session.log).toEqual(b.session.log);
    expect(a.session.outcomes).toEqual(b.session.outcomes);
    expect(Object.values(a.session.outcomes).every((count) => count > 0)).toBe(true);
    expect(new Set(a.session.log.map((event) => event.kind)).size).toBe(6);
    expect(a.session.log[0].step).toBe(60);
    expect(a.session.log[1].step).toBe(72);
    expect(a.session.entities[0].turretQuaternion.equals(a.session.entities[0].quaternion)).toBe(false);
    await a.session.dispose();
    await b.session.dispose();
    a.space.dispose();
    b.space.dispose();
  });

  it('uses explicit shield/hull outcomes with delayed, localized contact primitives', async () => {
    const { space, session } = await createSession();
    const effects = new Set();
    session.update(3, false, effects, Object.keys(SPACE_WEAPON_PROFILES));
    const shield = [...effects].find((effect) => effect.impactKind === 'shield' && effect.flightSeconds > 0);
    const hull = [...effects].find((effect) => effect.impactKind === 'hull' && effect.flightSeconds > 0);
    expect(shield).toBeTruthy();
    expect(hull).toBeTruthy();
    const contact = space.weaponRenderPass.sample(shield, shield.time + shield.flightSeconds + 0.05);
    expect(contact.some((primitive) => primitive.shape === 2)).toBe(true);
    expect(space.weaponRenderPass.sample(hull, hull.time + hull.flightSeconds + 0.05)
      .filter((primitive) => primitive.shape === 0)).toHaveLength(4);
    expect(space.weaponRenderPass.sample(hull, hull.time + hull.flightSeconds / 2)
      .filter((primitive) => primitive.shape === 0)).toHaveLength(1);
    await session.dispose();
    space.dispose();
  });
});

describe('hero measurement and depth lifecycle', () => {
  it('reports invalid timestamp samples and does not turn a failed GPU timer back into success', async () => {
    vi.stubGlobal('GPUBufferUsage', { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const warn = vi.fn();
    vi.stubGlobal('GQLog', { warn });
    const values = new BigUint64Array([2500000n, 1000000n]);
    const device = { features: new Set(['timestamp-query']),
      createQuerySet: () => ({ destroy() {} }),
      createBuffer: () => ({ destroy() {}, mapAsync: async () => {},
        getMappedRange: () => values.buffer, unmap() {} }) };
    const metrics = new HeroBattleMetrics();
    metrics.begin(device);
    metrics.submitted();
    await metrics.pending;
    expect(metrics.snapshot().gpuStatus).toBe('failed');
    expect(metrics.snapshot().gpuError).toBe('Invalid hero GPU timestamps');
    expect(metrics.snapshot().gpuScenePass.count).toBe(0);
    expect(metrics.begin(device)).toBeNull();
    expect(metrics.snapshot().gpuStatus).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
    await metrics.dispose();
  });
  it('reports real timing availability rather than inventing GPU values', async () => {
    const metrics = new HeroBattleMetrics();
    expect(metrics.begin({ features: new Set() })).toBeNull();
    expect(metrics.snapshot().gpuStatus).toBe('unsupported');
    expect(metrics.snapshot().gpuScenePass.averageMs).toBeNull();
    metrics.record(1, 0);
    metrics.record(2, 0.016);
    expect(metrics.snapshot().frameInterval.averageMs).toBe(16);
    expect(summarizeSamples([1, 2, 3, 4]).p95Ms).toBe(4);
    await metrics.dispose();
  });

  it('resolves asynchronous timestamp queries and disposes mapped resources', async () => {
    vi.stubGlobal('GPUBufferUsage', { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    const values = new BigUint64Array([1000000n, 2500000n]);
    const buffer = () => ({ destroy: vi.fn(), mapAsync: vi.fn(async () => {}),
      getMappedRange: () => values.buffer, unmap: vi.fn() });
    const device = { features: new Set(['timestamp-query']),
      createQuerySet: vi.fn(() => ({ destroy: vi.fn() })), createBuffer: vi.fn(buffer) };
    const metrics = new HeroBattleMetrics();
    expect(metrics.begin(device).beginningOfPassWriteIndex).toBe(0);
    const encoder = { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() };
    metrics.encode(encoder);
    metrics.submitted();
    await metrics.pending;
    expect(metrics.snapshot().gpuScenePass.averageMs).toBe(1.5);
    await metrics.dispose();
    expect(device.createBuffer.mock.results.every((result) => result.value.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('allocates depth32float, writes opaque depth only and resizes/disposes its resources', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, VERTEX: 2, COPY_DST: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1 });
    const device = {
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createTexture: vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})), queue: { writeBuffer: vi.fn() },
    };
    const depth = new HeroBattleDepth();
    depth.prepare(device, 'rgba16float', 800, 600);
    expect(device.createRenderPipeline.mock.calls[0][0].fragment.targets[0].writeMask).toBe(0);
    expect(device.createRenderPipeline.mock.calls[0][0].depthStencil.depthWriteEnabled).toBe(true);
    const body = new Object3D();
    body.userData = { type: 'planet', radius: 1 };
    const camera = new PerspectiveCamera();
    camera.position.z = 10;
    camera.updateMatrixWorld(true);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn() };
    depth.render(pass, [body], camera);
    expect(pass.draw).toHaveBeenCalledOnce();
    const old = device.createTexture.mock.results[0].value;
    depth.prepare(device, 'rgba16float', 1600, 1200);
    expect(old.destroy).toHaveBeenCalledOnce();
    depth.dispose();
    expect(device.createBuffer.mock.results.every((result) => result.value.destroy.mock.calls.length === 1)).toBe(true);
  });
});

describe('hero spatial audio', () => {
  it('disconnects partially allocated voices on setup failure', async () => {
    const oscillator = { disconnect: vi.fn() };
    const context = { state: 'running',
      createOscillator: () => oscillator,
      createGain: () => { throw new Error('gain allocation failed'); },
      close: vi.fn(async () => {}) };
    const audio = new HeroBattleAudio(context, { scale: 1 });
    expect(() => audio.play('laser', new Vector3(), new PerspectiveCamera(), new Vector3()))
      .toThrow('gain allocation failed');
    expect(oscillator.disconnect).toHaveBeenCalledOnce();
    expect(audio.voices.size).toBe(0);
    await audio.dispose();
  });
  it('gates settings, bounds voices and closes only its own context', async () => {
    const makeNode = () => Object.assign(new EventTarget(), { connect: vi.fn(), disconnect: vi.fn(),
      start: vi.fn(), stop: vi.fn(),
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      positionX: {}, positionY: {}, positionZ: {} });
    const context = { state: 'running', currentTime: 1, destination: {},
      createOscillator: vi.fn(makeNode), createGain: vi.fn(makeNode), createPanner: vi.fn(makeNode),
      close: vi.fn(async () => {}) };
    let muted = true;
    const audio = new HeroBattleAudio(context, { scale: 1, getSettings: () => ({ masterMuted: muted, masterVolume: 1, sfxVolume: 1 }) });
    const camera = new PerspectiveCamera();
    expect(audio.play('laser', new Vector3(5, 0, -10), camera, new Vector3())).toBe(false);
    muted = false;
    for (let index = 0; index < 10; index++) audio.play('laser', new Vector3(5, 0, -10), camera, new Vector3());
    expect(audio.voices.size).toBe(8);
    expect(audio.played).toBe(8);
    expect(context.createPanner.mock.results[0].value.positionX.value).toBe(5);
    await audio.dispose();
    expect(audio.voices.size).toBe(0);
    expect(context.close).toHaveBeenCalledOnce();
    await audio.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
