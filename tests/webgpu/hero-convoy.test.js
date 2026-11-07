import { afterEach, describe, expect, it, vi } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { HeroBattleSession } from '../../js/rendering/hero-battle-session.js';
import { heroShipClassAt } from '../../js/rendering/hero-battle-models.js';
import { SPACE_WEAPON_PROFILES } from '../../js/rendering/space-weapon-render-pass.js';
import { startHeroBattlePreview } from '../../js/rendering/system-battle-preview.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const kinds = Object.keys(SPACE_WEAPON_PROFILES);

async function fixture(scenario = 'convoy', count = 24, reinforcements = false, durationSeconds = 30) {
  const space = new PerspectiveSpaceFlight();
  for (let index = 0; index < count; index++) {
    await space.registerSpaceVessel({ id: `qa-${index}`,
      model_url: `procedural:hero-${heroShipClassAt(index, count, 'mixed')}`,
      route: [[0, 0, 0], [0, 0, 0]], visual_scale_ly: 1, reduced_motion: true, engine_effects: false });
  }
  const session = new HeroBattleSession(space, { seed: 42, view: 'near', audio: false,
    cinematic: true, formation: 'mixed', tactics: true, fleetLod: true, scenario, reinforcements, durationSeconds });
  await session.initialize([...space.spaceEntities.values()], new Vector3(), 1);
  return { session, space, dispose: async () => { await session.dispose(); space.dispose(); } };
}

describe('interactive convoy QA', () => {
  it('runs one continuous five-minute engagement with scaled waves, damage and late commands', async () => {
    const qa = await fixture('convoy', 48, true, 300);
    const effects = new Set();
    qa.session.issueCommand({ group: 'escort', action: 'withdraw', step: 12600 });
    qa.session.update(79, true, effects, kinds);
    expect(qa.session.waves.snapshot().events).toHaveLength(0);
    qa.session.update(80, true, effects, kinds);
    expect(qa.session.waves.snapshot().events).toHaveLength(12);
    expect(qa.session.entities[12].heroStatus.hull).toBe(1);
    qa.session.update(160, true, effects, kinds);
    expect(qa.session.waves.snapshot().events).toHaveLength(24);
    qa.session.issueCommand({ group: 'reserve', action: 'deploy', step: 9900 });
    qa.session.update(300, true, effects, kinds);
    expect(qa.session.time).toBe(300);
    expect(qa.session.orders.snapshot().objective.phase).toBe('route-complete');
    expect(qa.session.orders.snapshot().commands.every(command => command.applied)).toBe(true);
    expect(qa.session.tactics.decision(24, 303).phase).toBe(75);
    expect(qa.session.log.some(shot => shot.step > 17400)).toBe(true);
    expect(qa.session.log.length).toBeLessThanOrEqual(256);
    expect(qa.session.decisions.length).toBeLessThanOrEqual(1152);
    expect(effects.size).toBeLessThanOrEqual(64);
    expect(qa.session.damagePass.effects.length).toBeLessThanOrEqual(64);
    expect(qa.session.orders.snapshot().reactions.length).toBeLessThanOrEqual(64);
    await qa.dispose();
  }, 30000);
  it('stages 48 ships at exact steps, excludes pending targets and blends opposite flank entries', async () => {
    const qa = await fixture('convoy', 48, true);
    const effects = new Set();
    qa.session.update(7.99, true, effects, kinds);
    expect(qa.session.waves.snapshot().waves.map(wave => wave.pending)).toEqual([0, 12, 12]);
    expect(qa.session.entities[12].heroStatus.hull).toBe(1);
    expect(qa.session.entities[12].heroPending).toBe(true);
    expect(() => qa.session.issueCommand({ group: 'line', action: 'priority', target: 36 })).toThrow('eingetroffen');
    expect(() => qa.session.issueCommand({ group: 'reserve', action: 'deploy' })).toThrow('eingetroffenen');
    expect(qa.session.log.every(shot => shot.source % 24 < 12 && shot.target % 24 < 12)).toBe(true);
    qa.session.update(8, true, effects, kinds);
    expect(qa.session.waves.snapshot().events).toHaveLength(12);
    expect(qa.session.waves.snapshot().events.every(event => event.step === 480)).toBe(true);
    expect(qa.session.entities[12].position.toArray()).toEqual([-13, -4, -9]);
    expect(qa.session.entities[36].position.toArray()).toEqual([13, -4, -9]);
    expect(qa.session.orders.canFire(36)).toBe(false);
    qa.session.update(10, true, effects, kinds);
    expect(qa.session.entities[12].position.distanceTo(new Vector3(-13, -4, -9))).toBeGreaterThan(1);
    expect(qa.session.entities[12].heroStatus.shield).toBe(0.85);
    qa.session.update(16, true, effects, kinds);
    expect(qa.session.waves.snapshot().events).toHaveLength(24);
    expect(qa.session.entities[18].position.toArray()).toEqual([-13, -4, 9]);
    qa.session.update(18.5, true, effects, kinds);
    qa.session.issueCommand({ group: 'reserve', action: 'deploy' });
    qa.session.update(21, true, effects, kinds);
    expect(qa.session.log.some(shot => shot.source >= 18 && shot.source < 24)).toBe(true);
    expect(qa.session.log.every(shot => shot.step >= (qa.session.entities[shot.source].heroStatus.arrival + 2) * 60
      || qa.session.entities[shot.source].heroStatus.arrival === 0)).toBe(true);
    await qa.dispose();
  });
  it('preserves wave timelines across cadences and commands, and never fast-forwards pending arrivals on stop', async () => {
    const a = await fixture('convoy', 48, true), b = await fixture('convoy', 48, true);
    for (const qa of [a, b]) qa.session.issueCommand({ group: 'line', action: 'withdraw', step: 120 });
    for (let step = 0; step <= 1200; step++) a.session.update(step / 60, true, new Set(), kinds);
    b.session.update(20, true, new Set(), kinds);
    expect(a.session.log).toEqual(b.session.log);
    expect(a.session.waves.snapshot()).toEqual(b.session.waves.snapshot());
    expect(a.session.entities.map(entity => entity.position)).toEqual(b.session.entities.map(entity => entity.position));
    const control = await fixture('convoy', 48, true);
    control.session.update(20, true, new Set(), kinds);
    expect(a.session.entities.map(entity => entity.heroStatus.hull)).toEqual(control.session.entities.map(entity => entity.heroStatus.hull));
    await a.dispose(); await b.dispose(); await control.dispose();
    const early = await fixture('convoy', 48, true);
    early.session.update(4, false, new Set(), kinds);
    await early.dispose();
    expect(early.session.waves.snapshot().events).toHaveLength(0);
    expect(early.session.waves.snapshot().waves.map(wave => wave.pending)).toEqual([0, 12, 12]);
  });
  it('shows the larger public preview, group overview and wave countdown while hiding pending health entries', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    const space = new PerspectiveSpaceFlight(), body = new Object3D();
    body.userData = { type: 'planet', radius: 1 };
    space.bodies.push(body);
    const preview = await startHeroBattlePreview({ getSpaceView: () => space,
      getSharedZoomBackend: () => ({ addFrameHook: () => () => {} }) },
    { scenario: 'convoy', reinforcements: true, seed: 42 });
    expect(preview.getStats().ships).toBe(48);
    expect(document.querySelector('[data-hero-battle-waves]').textContent).toContain('Welle 1 (Nord): 12 unterwegs');
    expect(document.querySelector('[data-hero-battle-groups]').textContent).toContain('Reserve: 0 aktiv / 6 unterwegs');
    const session = space.heroBattle;
    session.hud.update(session.entities, space.camera, space.origin, 1920, 1080);
    expect(session.hud.entries.has(session.entities[12].id)).toBe(false);
    session.update(16, true, new Set(), kinds);
    session.commandPanel.update();
    expect(document.querySelector('[data-hero-battle-waves]').textContent).not.toContain('unterwegs');
    preview.stop();
    expect((await preview.finished).cleaned).toBe(true);
    expect(document.querySelector('[data-hero-battle-waves]')).toBeNull();
    space.dispose();
  });
  it.each([8, 10])('releases small reduced-motion wave fleets without movement or mutable reports (%s ships)', async count => {
    const qa = await fixture('convoy', count, true);
    qa.session.update(16, false, new Set(), kinds);
    expect(qa.session.waves.snapshot().waves.every(wave => wave.pending === 0)).toBe(true);
    expect(qa.session.waves.snapshot().waves.reduce((total, wave) => total + wave.total, 0)).toBe(count);
    for (const [index, entity] of qa.session.entities.entries()) {
      if (!entity.heroDestroyed) expect(entity.position).toEqual(qa.session.positionAt(index, 0, false));
    }
    expect(qa.session.orders.snapshot().progress).toBe(0);
    const report = qa.session.waves.snapshot();
    report.events[0].step = -999;
    report.waves[0].total = -999;
    expect(qa.session.waves.snapshot().events[0].step).not.toBe(-999);
    expect(qa.session.waves.snapshot().waves[0].total).not.toBe(-999);
    await qa.dispose();
  });
  it('reacts to reserves and an exposed convoy with bounded, blended enemy decisions', async () => {
    const qa = await fixture();
    const effects = new Set();
    qa.session.update(2.5, true, effects, kinds);
    expect(qa.session.orders.snapshot().enemies.map(enemy => enemy.action)).toEqual(['flank-escort', 'pin-line']);
    qa.session.issueCommand({ group: 'reserve', action: 'deploy', step: 180 });
    qa.session.update(3, true, effects, kinds);
    const reactions = qa.session.orders.snapshot().enemies;
    expect(reactions.every(enemy => enemy.action === 'counter-reserve')).toBe(true);
    expect(reactions.every(enemy => qa.session.entities[enemy.target].heroStatus.group === 'reserve')).toBe(true);
    const before = qa.session.entities[17].position.clone();
    expect(qa.session.positionAt(17, 3, true)).toEqual(before);
    qa.session.update(4.5, true, effects, kinds);
    expect(qa.session.entities[17].position.distanceTo(before)).toBeGreaterThan(0.5);
    expect(qa.session.log.some(shot => shot.source >= 12 && shot.reaction === 'counter-reserve'
      && [9, 10, 11].includes(shot.target))).toBe(true);
    qa.session.issueCommand({ group: 'reserve', action: 'withdraw' });
    qa.session.issueCommand({ group: 'escort', action: 'withdraw' });
    qa.session.update(5, true, effects, kinds);
    expect(qa.session.orders.snapshot().enemies.every(enemy => enemy.action === 'counter-reserve')).toBe(true);
    qa.session.update(6, true, effects, kinds);
    const report = qa.session.orders.snapshot();
    expect(report.enemies.find(enemy => enemy.group === 'raiders')).toMatchObject({ action: 'intercept-convoy', target: 0 });
    expect(report.objective.attackers).toBe(9);
    expect(report.objective.threat).toBe('high');
    qa.session.update(6.9, true, effects, kinds);
    expect(qa.session.log.some(shot => shot.source >= 12 && shot.reaction === 'intercept-convoy' && shot.target === 0)).toBe(true);
    qa.session.issueCommand({ group: 'escort', action: 'auto' });
    qa.session.update(9, true, effects, kinds);
    expect(qa.session.orders.snapshot().enemies.find(enemy => enemy.group === 'raiders').action).toBe('flank-escort');
    expect(qa.session.orders.snapshot().objective.attackers).toBe(0);
    await qa.dispose();
  });
  it('retreats damaged enemy capitals without new fire and replaces destroyed reaction targets', async () => {
    const qa = await fixture();
    const effects = new Set();
    qa.session.issueCommand({ group: 'reserve', action: 'deploy', step: 420 });
    qa.session.issueCommand({ group: 'reserve', action: 'withdraw', step: 480 });
    qa.session.issueCommand({ group: 'escort', action: 'withdraw', step: 480 });
    qa.session.update(1, true, effects, kinds);
    const target = qa.session.orders.snapshot().enemies.find(enemy => enemy.group === 'raiders').target;
    qa.session.entities[target].heroDestroyed = true;
    qa.session.update(2, true, effects, kinds);
    expect(qa.session.orders.snapshot().enemies.find(enemy => enemy.group === 'raiders').target).not.toBe(target);
    qa.session.update(10, true, effects, kinds);
    expect(qa.session.orders.snapshot().enemies.find(enemy => enemy.group === 'screen').action).toBe('pin-line');
    qa.session.update(13, true, effects, kinds);
    expect(qa.session.orders.snapshot().enemies.find(enemy => enemy.group === 'screen').action).toBe('regroup');
    expect(qa.session.log.some(shot => [12, 13, 16].includes(shot.source) && shot.step >= 660)).toBe(false);
    expect(qa.session.entities[16].position.x).toBeCloseTo(12);
    expect(qa.session.log.filter(shot => shot.source >= 12).every(shot => shot.target < 12)).toBe(true);
    for (const entity of qa.session.entities.slice(0, 12)) entity.heroDestroyed = true;
    qa.session.update(16, true, effects, kinds);
    expect(qa.session.orders.snapshot().objective.phase).toBe('destroyed');
    expect(qa.session.orders.snapshot().objective.attackers).toBe(0);
    expect(qa.session.log.some(shot => shot.source >= 12 && shot.step >= 780)).toBe(false);
    await qa.dispose();
  });
  it('keeps reaction history copied and prediction sampling free of decision side effects', async () => {
    const qa = await fixture();
    qa.session.update(2, true, new Set(), kinds);
    const report = qa.session.orders.snapshot();
    for (let index = 12; index < 24; index++) qa.session.positionAt(index, 3.5, true);
    expect(qa.session.orders.snapshot()).toEqual(report);
    report.reactions[0].target = -999;
    report.enemies[0].action = 'invalid';
    expect(qa.session.orders.snapshot().reactions[0].target).not.toBe(-999);
    expect(qa.session.orders.snapshot().enemies[0].action).not.toBe('invalid');
    await qa.dispose();
    expect(qa.session.orders.reactions.size).toBe(0);
    expect(qa.session.orders.snapshot().reactions.length).toBeGreaterThan(0);
  });
  it('has three selectable groups, a moving non-firing convoy and a held reserve', async () => {
    const qa = await fixture();
    qa.session.update(3, true, new Set(), kinds);
    const groups = qa.session.orders.snapshot().groups;
    expect(groups.map(group => group.total)).toEqual([2, 6, 3]);
    expect(qa.session.entities[0].heroStatus.label).toBe('Konvoi · QA');
    expect(qa.session.positionAt(0, 0, true).x).toBe(-9);
    expect(qa.session.positionAt(0, 24, true).x).toBe(9);
    expect(qa.session.positionAt(9, 0, true)).toEqual(qa.session.positionAt(9, 3, true));
    expect(qa.session.log.some(shot => [0, 9, 10, 11].includes(shot.source))).toBe(false);
    expect(qa.session.orders.snapshot().progress).toBeCloseTo(3 / 24);
    await qa.dispose();
  });
  it('applies priority, deploy, escort and withdrawal at replay steps without changing authored damage', async () => {
    const qa = await fixture();
    const control = await fixture('battle');
    qa.session.update(2, true, new Set(), kinds);
    const before = qa.session.entities[9].position.clone();
    const command = qa.session.issueCommand({ group: 'reserve', action: 'deploy' });
    expect(command.step).toBe(121);
    expect(command.applied).toBe(false);
    qa.session.issueCommand({ group: 'line', action: 'priority', target: 12 });
    qa.session.update(3.5, true, new Set(), kinds);
    expect(qa.session.entities[9].position.distanceTo(before)).toBeGreaterThan(1);
    expect(qa.session.log.some(shot => shot.source === 9 && shot.order === 'deploy')).toBe(true);
    const focused = qa.session.log.filter(shot => [1, 4].includes(shot.source) && shot.step >= 121);
    expect(focused.length).toBeGreaterThan(0);
    expect(focused.every(shot => shot.target === 12)).toBe(true);
    qa.session.issueCommand({ group: 'reserve', action: 'escort' });
    qa.session.update(5, true, new Set(), kinds);
    const escort = qa.session.entities[9];
    expect(escort.position.distanceTo(qa.session.entities[0].position)).toBeLessThan(3);
    qa.session.issueCommand({ group: 'escort', action: 'withdraw' });
    const withdrawStep = qa.session.step;
    qa.session.update(7, true, new Set(), kinds);
    const escortSlots = qa.session.entities.map((entity, index) => entity.heroStatus.group === 'escort' ? index : -1);
    expect(qa.session.log.some(shot => escortSlots.includes(shot.source) && shot.step >= withdrawStep)).toBe(false);
    expect(qa.session.entities[5].position.x).toBeCloseTo(-12);
    qa.session.update(18, true, new Set(), kinds);
    control.session.update(18, true, new Set(), kinds);
    expect(qa.session.entities.map(entity => [entity.heroStatus.shield, entity.heroStatus.hull, entity.heroDestroyed]))
      .toEqual(control.session.entities.map(entity => [entity.heroStatus.shield, entity.heroStatus.hull, entity.heroDestroyed]));
    expect(qa.session.debrisCount).toBe(control.session.debrisCount);
    await qa.dispose(); await control.dispose();
  });
  it('blends new orders without teleporting, restores reserve defaults and rejects invalid or stale commands', async () => {
    const qa = await fixture();
    qa.session.update(2, true, new Set(), kinds);
    const before = qa.session.entities[9].position.clone();
    qa.session.issueCommand({ group: 'reserve', action: 'deploy' });
    qa.session.update(121 / 60, true, new Set(), kinds);
    expect(qa.session.entities[9].position).toEqual(before);
    qa.session.update(4, true, new Set(), kinds);
    qa.session.issueCommand({ group: 'reserve', action: 'auto' });
    qa.session.update(6, true, new Set(), kinds);
    expect(qa.session.entities[9].position.x).toBe(-10);
    expect(qa.session.orders.canFire(9)).toBe(false);
    for (const command of [
      { group: 'enemy', action: 'withdraw' }, { group: 'line', action: 'invalid' },
      { group: 'line', action: 'deploy' }, { group: 'line', action: 'priority', target: 0 },
      { group: 'line', action: 'priority', target: 99 }, { group: 'line', action: 'withdraw', step: 0 },
      { group: 'line', action: 'withdraw', target: 12 },
    ]) expect(() => qa.session.issueCommand(command)).toThrow();
    qa.session.update(9, true, new Set(), kinds);
    expect(() => qa.session.issueCommand({ group: 'line', action: 'priority', target: 14 })).toThrow('lebendes');
    await qa.dispose();
    expect(() => qa.session.issueCommand({ group: 'line', action: 'withdraw' })).toThrow('beendet');
  });
  it('replays scheduled command logs across cadences, retargets dead priorities and bounds command retention', async () => {
    const a = await fixture(), b = await fixture();
    const script = [
      { group: 'line', action: 'priority', target: 13, step: 60 },
      { group: 'reserve', action: 'deploy', step: 120 },
      { group: 'escort', action: 'withdraw', step: 240 },
      { group: 'reserve', action: 'escort', step: 360 },
    ];
    for (const qa of [a, b]) for (const command of script) qa.session.issueCommand(command);
    for (let step = 0; step <= 840; step++) a.session.update(step / 60, true, new Set(), kinds);
    for (let step = 0; step <= 280; step++) b.session.update(step / 20, true, new Set(), kinds);
    expect(a.session.log).toEqual(b.session.log);
    expect(a.session.orders.snapshot().reactions).toEqual(b.session.orders.snapshot().reactions);
    expect(a.session.entities.map(entity => entity.position)).toEqual(b.session.entities.map(entity => entity.position));
    expect(a.session.orders.snapshot().commands).toEqual(b.session.orders.snapshot().commands);
    expect(a.session.orders.snapshot().groups[0].status).toContain('Ersatz');
    expect(a.session.log.filter(shot => shot.step >= 720).every(shot => shot.target !== 13)).toBe(true);
    const report = a.session.orders.snapshot();
    report.commands[0].target = -999;
    expect(a.session.orders.snapshot().commands[0].target).toBe(13);
    for (let index = 4; index < 64; index++) a.session.issueCommand({ group: 'line', action: 'auto' });
    expect(() => a.session.issueCommand({ group: 'line', action: 'auto' })).toThrow('64');
    await a.dispose(); await b.dispose();
  });
  it('keeps reduced-motion ships and convoy progress stationary and preserves all three groups for small fleets', async () => {
    const qa = await fixture('convoy', 10);
    expect(qa.session.orders.snapshot().groups.every(group => group.total > 0)).toBe(true);
    qa.session.issueCommand({ group: 'reserve', action: 'deploy' });
    qa.session.update(5, false, new Set(), kinds);
    for (const [index, entity] of qa.session.entities.entries()) {
      expect(entity.position).toEqual(qa.session.positionAt(index, 0, false));
    }
    expect(qa.session.orders.snapshot().progress).toBe(0);
    await qa.dispose();
  });
  it('wires accessible controls, explicit errors, selection and owner-scoped stop cleanup through the public API', async () => {
    vi.useFakeTimers();
    const space = new PerspectiveSpaceFlight(), body = new Object3D();
    body.userData = { type: 'planet', radius: 1 };
    space.bodies.push(body);
    const pose = space.camera.position.clone();
    const preview = await startHeroBattlePreview({ getSpaceView: () => space,
      getSharedZoomBackend: () => ({ addFrameHook: () => () => {} }) }, { scenario: 'convoy', seed: 42 });
    const root = document.querySelector('[data-hero-battle-commands]');
    expect(root.textContent).toContain('Nur visuelle Befehle');
    expect(root.querySelector('[data-hero-battle-threat]').textContent).toContain('Bedrohung:');
    expect(document.querySelector('[data-hero-battle-destination]')).toBeTruthy();
    const selects = root.querySelectorAll('select');
    selects[0].value = 'reserve';
    selects[0].dispatchEvent(new Event('change'));
    expect(space.heroBattle.orders.selected).toBe('reserve');
    const deploy = [...root.querySelectorAll('button')].find(button => button.textContent === 'Reserve einsetzen');
    expect(deploy.disabled).toBe(false);
    const key = vi.fn();
    document.addEventListener('keydown', key);
    deploy.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    expect(key).not.toHaveBeenCalled();
    document.removeEventListener('keydown', key);
    deploy.click();
    expect(preview.getStats().hero.command.commands[0].action).toBe('deploy');
    selects[0].value = 'line';
    selects[0].dispatchEvent(new Event('change'));
    selects[1].value = '14';
    space.heroBattle.entities[14].heroDestroyed = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    [...root.querySelectorAll('button')].find(button => button.textContent === 'Zielprioritaet').click();
    expect(root.querySelector('[role=status]').textContent).toContain('lebendes');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    preview.issueCommand({ group: 'line', action: 'withdraw', step: 500 });
    [...root.querySelectorAll('button')].find(button => button.textContent === 'QA beenden').click();
    const report = await preview.finished;
    expect(report.cleaned).toBe(true);
    expect(report.hero.command.commands.every(command => command.cancelled)).toBe(true);
    expect(document.querySelector('[data-hero-battle-commands]')).toBeNull();
    expect(document.querySelector('[data-hero-battle-destination]')).toBeNull();
    expect(document.querySelector('[data-hero-battle-hud]')).toBeNull();
    expect(space.camera.position).toEqual(pose);
    expect(space.spaceEntities.size).toBe(0);
    expect(() => preview.issueCommand({ group: 'line', action: 'withdraw' })).toThrow('beendet');
    space.dispose();
  });
  it('keeps the ordinary Hero preview non-interactive and rejects convoy commands explicitly', async () => {
    const qa = await fixture('battle');
    qa.session.attachHud();
    expect(document.querySelector('[data-hero-battle-commands]')).toBeNull();
    expect(() => qa.session.issueCommand({ group: 'line', action: 'withdraw' })).toThrow('Konvoi');
    await qa.dispose();
  });
  it.each([false, true])('keeps a full 128-ship convoy replay within existing retention limits (waves=%s)', async reinforcements => {
    const qa = await fixture('convoy', 128, reinforcements);
    qa.session.issueCommand(reinforcements
      ? { group: 'line', action: 'withdraw', step: 60 }
      : { group: 'reserve', action: 'deploy', step: 60 });
    const effects = new Set();
    qa.session.update(30, true, effects, kinds);
    expect(qa.session.orders.snapshot().progress).toBe(1);
    expect(qa.session.entities[0].position.distanceTo(qa.session.positionAt(0, 24, true))).toBeLessThan(1e-12);
    expect(effects.size).toBeLessThanOrEqual(64);
    expect(qa.space.weaponRenderPass.effects.length).toBeLessThanOrEqual(64);
    expect(qa.session.damagePass.effects.length).toBeLessThanOrEqual(64);
    expect(qa.session.debrisPass.bursts.length).toBeLessThanOrEqual(16);
    expect(qa.session.orders.snapshot().commands).toHaveLength(1);
    expect(qa.session.orders.snapshot().reactions.length).toBeLessThanOrEqual(64);
    expect(qa.session.orders.snapshot().objective.phase).toBe('route-complete');
    await qa.dispose();
  });
});
