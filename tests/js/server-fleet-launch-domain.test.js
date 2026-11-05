import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFleetLaunchDomain } from '../../js/engine/runtime/server-fleet-launch-domain.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { mountFleetCommandOverlay } from '../../js/ui/game-fleet-launch.js';

const inventory = () => ({ success: true, ships: [{ type: 'small_cargo', count: 4 }],
  blueprints: [{ type: 'bp_7', name: '<img src=x>', count: '2' }] });
const transit = (type = 'aereth') => ({ success: true, ftl_drive_type: type,
  ftl_ready: true, ftl_cooldown_remaining_s: 0, gates: [], resonance_nodes: [] });
const overview = () => ({ success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home', galaxy: 1, system: 10, position: 3 },
    { id: 2, name: 'Other', galaxy: 2, system: 20, position: 4 }] });
const order = () => ({ mission: 'transport', target_galaxy: '2', target_system: '2000', target_position: '4',
  ships: { small_cargo: '2', bp_7: 1 }, cargo: { metal: '12.5', crystal: 0, deuterium: 0 } });
describe('Canonical fleet composition and launch', () => {
  let api;
  let session;
  let domain;
  let cleanup;
  beforeEach(async () => {
    api = { get: vi.fn(async (url) => url.includes('overview') ? overview()
      : url.includes('ftl_status') ? transit() : inventory()),
      post: vi.fn(async () => ({ success: true, arrival_time: '2026-11-03 20:00:00' })) };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createFleetLaunchDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  it('only reads owned-colony canonical inventory and combines standard ships and blueprints', async () => {
    await domain.load();
    expect(api.get).toHaveBeenCalledWith('api/shipyard.php?action=list&colony_id=1', { signal: expect.any(AbortSignal) });
    expect(api.get).toHaveBeenCalledWith('api/fleet.php?action=ftl_status', { signal: expect.any(AbortSignal) });
    expect(domain.getState().data.ships).toHaveLength(2);
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each(['vor_tak', 'syl_nar', 'vel_ar', 'zhareen', 'aereth', 'kryl_tha'])('uses server-selected %s transit without overriding dispatch mechanics', async (type) => {
    api.get.mockImplementation(async (url) => url.includes('overview') ? overview()
      : url.includes('ftl_status') ? transit(type) : inventory());
    await domain.load();
    expect(domain.getState().data.transit.ftl_drive_type).toBe(type);
    await domain.command('send', order());
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('ftl_drive_type');
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('use_wormhole');
  });
  it.each([null, { ...transit(), ftl_drive_type: 'unknown' },
    { ...transit(), ftl_ready: 'true' }, { ...transit(), ftl_cooldown_remaining_s: -1 }])('refuses invalid transit status without substituting a generic drive: %j', async (status) => {
    api.get.mockImplementation(async (url) => url.includes('ftl_status') ? status : inventory());
    await domain.load();
    expect(domain.getState()).toMatchObject({ data: null, stale: true, error: 'Ungültiger Transitstatus vom Server.' });
    await expect(domain.command('send', order())).rejects.toThrow('aktualisieren');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('sends exact captured origin, mission, ship counts and decimal cargo without a local simulation', async () => {
    const changed = vi.fn();
    session.events.on('colony:mutation-accepted', changed);
    await domain.load();
    await domain.command('send', order());
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=send', {
      origin_colony_id: 1, mission: 'transport', target_galaxy: 2, target_system: 2000, target_position: 4,
      ships: { small_cargo: 2, bp_7: 1 }, cargo: { metal: 12.5, crystal: 0, deuterium: 0 },
    }, { signal: expect.any(AbortSignal) });
    expect(changed).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'fleet-launch', allColonies: true });
    expect(domain.getState()).toMatchObject({ stale: false, error: '', mutating: false });
  });
  it.each([
    { mission: 'unknown' }, { target_galaxy: 10 }, { target_system: 1.5 }, { target_position: 0 },
    { ships: {} }, { ships: { unknown: 1 } }, { ships: { small_cargo: 5 } },
    { ships: { small_cargo: 1.5 } }, { ships: { small_cargo: -1 } },
    { cargo: { metal: -1, crystal: 0, deuterium: 0 } },
    { cargo: { metal: '', crystal: 0, deuterium: 0 } },
  ])('rejects invalid launch data before POST: %j', async (invalid) => {
    await domain.load();
    await expect(domain.command('send', { ...order(), ...invalid })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('blocks stale inventory after failed read and after accepted launch with failed overview refresh', async () => {
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Inventory unavailable'));
    await domain.load();
    expect(domain.getState().stale).toBe(true);
    await expect(domain.command('send', order())).rejects.toThrow('aktualisieren');
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Overview unavailable'));
    await domain.command('send', order());
    expect(domain.getState()).toMatchObject({ stale: true, mutating: false });
    expect(domain.getState().error).toContain('Auftrag bestätigt');
    await expect(domain.command('send', order())).rejects.toThrow('aktualisieren');
    expect(api.post).toHaveBeenCalledOnce();
    await domain.refresh();
    expect(domain.getState().stale).toBe(false);
    expect(api.post).toHaveBeenCalledOnce();
  });
  it('aborts obsolete inventory on colony switch and ignores late replies', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.load();
    const signal = api.get.mock.calls[0][1].signal;
    session.selectColony(2);
    await domain.load();
    finish({ success: true, ships: [], blueprints: [] });
    await pending;
    expect(signal.aborted).toBe(true);
    expect(domain.getState()).toMatchObject({ colonyId: 2, stale: false });
    expect(domain.getState().data.ships).toHaveLength(2);
  });
  it('prevents duplicate launch and preserves the captured origin during a colony switch', async () => {
    await domain.load();
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.command('send', order());
    session.selectColony(2);
    await domain.command('send', order());
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post.mock.calls[0][1].origin_colony_id).toBe(1);
    finish({ success: true });
    await pending;
    expect(domain.getState()).toMatchObject({ colonyId: 2, mutating: false, stale: false });
  });
  it.each(['read', 'send'])('aborts outstanding %s on logout without publishing a late success', async (kind) => {
    await domain.load();
    let finish;
    const method = kind === 'read' ? 'get' : 'post';
    api[method].mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = kind === 'read' ? domain.load() : domain.command('send', order());
    const signal = api[method].mock.calls.at(-1).at(-1).signal;
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    domain.shutdown();
    expect(signal.aborted).toBe(true);
    finish(kind === 'read' ? inventory() : { success: true });
    await pending;
    expect(domain.getState()).toMatchObject({ data: null, mutating: false });
    expect(accepted).not.toHaveBeenCalled();
  });
  it.each([{ ships: null }, { ships: [{ type: 'bad', count: -1 }] },
    { blueprints: [{ type: 'small_cargo', count: 1 }] }])('reports malformed inventory: %j', async (invalid) => {
    api.get.mockResolvedValueOnce({ ...inventory(), ...invalid });
    await domain.load();
    expect(domain.getState().error).toContain('Ungültiger Schiffsbestand');
    expect(domain.getState().data).toBeNull();
  });
  it.each(['accepted', 'rejected', 'refresh'])('keeps pending map handoffs from changing the captured order (%s)', async (phase) => {
    const accepted = phase !== 'rejected';
    document.body.innerHTML = '<section id="wm-galaxy-section"></section><canvas id="starfield" tabindex="0"></canvas><button data-game-fleet-launch>Flotte</button>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 2000, position: 4 });
    const root = document.getElementById('game-fleet-command');
    await vi.waitFor(() => expect(root.textContent).toContain('small cargo'));
    const input = root.querySelector('[aria-label="small cargo (4 verfügbar)"]');
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    let finish;
    let reject;
    api[phase === 'refresh' ? 'get' : 'post'].mockImplementationOnce(() => new Promise((resolve, fail) => {
      finish = resolve;
      reject = fail;
    }));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(domain.getState().mutating).toBe(true);
    api.get.mockClear();
    session.events.emit('fleet:target-requested', { galaxy: 9, system: 99, position: 9 });
    session.events.emit('fleet:origin-requested', { colonyId: 2 });
    document.querySelector('[data-game-fleet-launch]').click();
    expect(root.querySelector('[role="alert"]').textContent).toContain('erst danach geändert');
    expect(session.getColony().id).toBe(1);
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('2000');
    expect(root.querySelector('[aria-label="small cargo (4 verfügbar)"]').value).toBe(phase === 'refresh' ? '0' : '2');
    expect(document.activeElement).toBe(root);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post.mock.calls[0][1]).toMatchObject({ origin_colony_id: 1, target_system: 2000, ships: { small_cargo: 2 } });
    if (accepted) finish(phase === 'refresh' ? overview() : { success: true });
    else reject(new Error('Send rejected'));
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(false));
    expect(root.textContent).not.toContain('erst danach geändert');
    expect(root.querySelector('[aria-label="small cargo (4 verfügbar)"]').value).toBe(accepted ? '0' : '2');
    if (!accepted) expect(root.querySelector('[role="alert"]').textContent).toContain('Send rejected');
    session.events.emit('fleet:target-requested', { galaxy: 9, system: 99, position: 9 });
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('99');
    session.events.emit('fleet:origin-requested', { colonyId: 2 });
    expect(session.getColony().id).toBe(2);
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
  });
  it('prefills target without changing origin, preserves rejected draft and clears accepted composition even if refresh fails', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section><canvas id="starfield" tabindex="0"></canvas>';
    const fleets = { load: vi.fn() };
    cleanup = mountFleetCommandOverlay({ domain, fleets, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 2000, position: 4 });
    await vi.waitFor(() => expect(root.textContent).toContain('small cargo'));
    expect(document.activeElement).toBe(root);
    expect(session.getColony().id).toBe(1);
    expect(root.querySelector('img')).toBeNull();
    const input = (label) => root.querySelector(`[aria-label="${label}"]`);
    const fill = (label, value) => {
      input(label).value = value;
      input(label).dispatchEvent(new Event('input'));
    };
    expect(input('Zielsystem').value).toBe('2000');
    expect(root.textContent).toContain('Aereth · Alcubierre-Warp');
    expect(root.querySelector('details').open).toBe(false);
    const picking = vi.fn();
    const unsubscribePicking = session.events.on('fleet:target-picking', picking);
    const pickButton = () => [...root.querySelectorAll('button')].find((item) => item.textContent === 'Ziel im Spielfeld wählen');
    pickButton().click();
    expect(root.querySelector('form')).toBeNull();
    expect(picking).toHaveBeenLastCalledWith({ active: true });
    document.getElementById('starfield').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picking).toHaveBeenLastCalledWith({ active: false });
    expect(document.activeElement).toBe(root);
    expect(input('Zielsystem').value).toBe('2000');
    expect(root.querySelector('form')).not.toBeNull();
    unsubscribePicking();
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Mindestens ein verfügbares Schiff'));
    expect(api.post).not.toHaveBeenCalled();
    fill('small cargo (4 verfügbar)', '2');
    fill('Fracht Metall', '25');
    api.post.mockRejectedValueOnce(new Error('Not enough fuel'));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Not enough fuel'));
    expect(input('small cargo (4 verfügbar)').value).toBe('2');
    expect(input('Fracht Metall').value).toBe('25');
    api.get.mockRejectedValueOnce(new Error('Overview unavailable'));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Auftrag bestätigt'));
    expect(input('small cargo (4 verfügbar)').value).toBe('0');
    expect(input('Fracht Metall').value).toBe('0');
    expect(input('Zielsystem').value).toBe('2000');
    expect(fleets.load).toHaveBeenCalledOnce();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('starfield'));
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 2000, position: 4 });
    expect(root.hidden).toBe(false);
    expect(document.activeElement).toBe(root);
    session.selectColony(2);
    await vi.waitFor(() => expect(root.textContent).toContain('Herkunft: Other'));
    expect(input('Zielsystem').value).toBe('');
    cleanup();
    cleanup = null;
    expect(document.getElementById('game-fleet-command')).toBeNull();
    session.events.emit('fleet:target-requested', { galaxy: 1, system: 10, position: 3 });
    expect(document.getElementById('game-fleet-command')).toBeNull();
  });
});
