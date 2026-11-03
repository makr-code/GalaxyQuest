import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFleetDomain } from '../../js/engine/runtime/server-fleet-domain.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { mountFleetWindow } from '../../js/ui/game-fleets.js';

const fleet = () => ({
  id: '7', mission: 'transport', origin_colony_id: '1',
  origin_galaxy: '1', origin_system: '10', origin_position: '3',
  target_galaxy: '2', target_system: '20', target_position: '4',
  fleet_label: '<img src=x>', target_system_name: '<script>bad()</script>',
  ships: { small_cargo: 2 }, cargo_metal: '100', cargo_crystal: '0', cargo_deuterium: '0',
  departure_time: '2026-11-03 10:00:00', arrival_time: '2026-11-03 11:00:00', returning: '0',
});
const overview = () => ({ success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home' }, { id: 2, name: 'Other' }] });
describe('Authoritative fleet commands and window', () => {
  let api;
  let session;
  let domain;
  let current;
  let unmount;
  beforeEach(async () => {
    current = [fleet()];
    api = {
      get: vi.fn(async (url) => url.includes('overview') ? overview() : { success: true, fleets: structuredClone(current) }),
      post: vi.fn(async (url) => {
        current = url.endsWith('recall') ? [{ ...fleet(), returning: '1' }] : [];
        return { success: true };
      }),
    };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createFleetDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  it('only reads account-wide canonical missions on load, independently of colony selection', async () => {
    await domain.load();
    session.selectColony(2);
    expect(api.get).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=list', { signal: expect.any(AbortSignal) });
    expect(api.post).not.toHaveBeenCalled();
    const copy = domain.getState();
    copy.fleets[0].ships.small_cargo = 99;
    expect(domain.getState().fleets[0].ships.small_cargo).toBe(2);
  });
  it('recalls a loaded outbound fleet then refreshes overview and canonical list without optimistic progress', async () => {
    await domain.load();
    await domain.command('recall', 7);
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=recall', { fleet_id: 7 }, { signal: expect.any(AbortSignal) });
    expect(api.get.mock.calls.map(([url]) => url)).toEqual([
      'api/fleet.php?action=list', 'api/game.php?action=overview', 'api/fleet.php?action=list',
    ]);
    expect(domain.getState()).toMatchObject({ mutating: false, stale: false, fleets: [{ returning: '1' }] });
    await domain.command('recall', 7);
    expect(api.post).toHaveBeenCalledOnce();
    expect(domain.getState().error).toContain('bereits auf dem Rückweg');
  });
  it('only processes arrivals explicitly and invalidates visible colony data after server acceptance', async () => {
    const changed = vi.fn();
    session.events.on('colony:mutation-accepted', changed);
    await domain.load();
    await domain.refresh();
    expect(api.post).not.toHaveBeenCalled();
    await domain.command('check');
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=check', {}, { signal: expect.any(AbortSignal) });
    expect(domain.getState().fleets).toEqual([]);
    expect(changed).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'fleets', allColonies: true });
  });
  it.each([
    { fleets: null }, { fleets: [{ ...fleet(), returning: 'bad' }] },
    { fleets: [{ ...fleet(), ships: null }] }, { fleets: [fleet(), fleet()] },
    { fleets: [{ ...fleet(), target_system: -1 }] }, { success: false, fleets: [] },
  ])('reports malformed read data and preserves the last confirmed missions: %j', async (invalid) => {
    await domain.load();
    api.get.mockResolvedValueOnce({ success: true, ...invalid });
    expect(await domain.load()).toBe(false);
    expect(domain.getState()).toMatchObject({ stale: true, error: 'Ungültige Flottendaten vom Server.', fleets: [{ id: '7' }] });
    await domain.command('recall', 7);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('rejects unknown commands and unloaded IDs without POST and reports rejected server orders', async () => {
    await domain.command('recall', 7);
    await domain.load();
    await domain.command('unknown');
    await domain.command('recall', 999);
    expect(api.post).not.toHaveBeenCalled();
    api.post.mockRejectedValueOnce(new Error('Server rejected recall'));
    await domain.command('recall', 7);
    expect(domain.getState()).toMatchObject({ error: 'Server rejected recall', fleets: [{ returning: '0' }], mutating: false });
  });
  it('serializes commands, aborts pre-command reads and discards late list responses', async () => {
    await domain.load();
    let finishRead;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const pendingRead = domain.load();
    const signal = api.get.mock.calls.at(-1)[1].signal;
    let finishCommand;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finishCommand = resolve; }));
    const pendingCommand = domain.command('recall', 7);
    expect(signal.aborted).toBe(true);
    await domain.command('check');
    await domain.load();
    expect(api.post).toHaveBeenCalledOnce();
    current = [{ ...fleet(), returning: '1' }];
    finishCommand({ success: true });
    await pendingCommand;
    finishRead({ success: true, fleets: [] });
    await pendingRead;
    expect(domain.getState().fleets[0].returning).toBe('1');
  });
  it('does not resubmit accepted recalls when overview refresh fails and requires a fresh list', async () => {
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    await domain.command('recall', 7);
    expect(domain.getState()).toMatchObject({ stale: true, mutating: false });
    expect(domain.getState().error).toContain('Befehl bestätigt');
    await domain.command('recall', 7);
    expect(api.post).toHaveBeenCalledOnce();
    await domain.refresh();
    expect(domain.getState()).toMatchObject({ stale: false, error: '', fleets: [{ returning: '1' }] });
    expect(api.post).toHaveBeenCalledOnce();
  });
  it('does not acknowledge malformed POST responses or emit arrival invalidation for rejected commands', async () => {
    const changed = vi.fn();
    session.events.on('colony:mutation-accepted', changed);
    await domain.load();
    api.post.mockResolvedValueOnce({ success: false, error: 'Rejected' });
    await domain.command('check');
    expect(changed).not.toHaveBeenCalled();
    expect(domain.getState()).toMatchObject({ error: 'Rejected', fleets: [{ returning: '0' }], stale: false });
    api.post.mockResolvedValueOnce(null);
    await domain.command('check');
    expect(domain.getState().error).toContain('Ungültige Befehlsantwort');
    expect(changed).not.toHaveBeenCalled();
  });
  it('discards obsolete reads without reporting them as current errors', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.load();
    const signal = api.get.mock.calls.at(-1)[1].signal;
    await domain.load();
    finish({ success: false });
    await pending;
    expect(signal.aborted).toBe(true);
    expect(domain.getState()).toMatchObject({ loading: false, stale: false, error: '', fleets: [{ id: '7' }] });
  });
  it('retains accepted-command warnings if the post-command list fails', async () => {
    await domain.load();
    api.get.mockResolvedValueOnce(overview()).mockRejectedValueOnce(new Error('List offline'));
    await domain.command('check');
    expect(domain.getState().error).toContain('Befehl bestätigt, Liste');
    expect(domain.getState().stale).toBe(true);
    await domain.refresh();
    expect(domain.getState()).toMatchObject({ fleets: [], stale: false, error: '' });
    expect(api.post).toHaveBeenCalledOnce();
  });
  it.each(['read', 'command'])('aborts pending %s on logout and ignores its late response', async (kind) => {
    await domain.load();
    let finish;
    const method = kind === 'read' ? 'get' : 'post';
    api[method].mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = kind === 'read' ? domain.load() : domain.command('recall', 7);
    const signal = api[method].mock.calls.at(-1).at(-1).signal;
    domain.shutdown();
    expect(signal.aborted).toBe(true);
    finish({ success: true, fleets: [fleet()] });
    await pending;
    expect(domain.getState()).toMatchObject({ fleets: null, mutating: false, loading: false });
  });
  it('renders safe fleet cards, map links, returning states and tears down window bindings', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const trigger = document.createElement('button');
    trigger.dataset.gameFleets = '';
    document.body.append(trigger);
    let config;
    const wm = { body: () => root, register: vi.fn((id, options) => { config = options; }),
      minimize: vi.fn(), close: vi.fn(), open: vi.fn(() => config.onRender()) };
    const galaxy = { navigate: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy, wm });
    trigger.click();
    await vi.waitFor(() => expect(root.textContent).toContain('small cargo'));
    expect(root.textContent).toContain('<img src=x>');
    expect(root.querySelector('img, script')).toBeNull();
    const button = (label) => [...root.querySelectorAll('button')].find((item) => item.textContent === label);
    button('Ziel im Spielfeld').click();
    expect(wm.minimize).toHaveBeenCalledWith('fleet');
    expect(galaxy.navigate).toHaveBeenCalledWith('2', '20');
    button('Herkunft im Spielfeld').click();
    expect(galaxy.navigate).toHaveBeenLastCalledWith('1', '10');
    button('Flotte zurückrufen').click();
    await vi.waitFor(() => expect(button('Flotte zurückrufen').disabled).toBe(true));
    await vi.waitFor(() => expect(root.textContent).toContain('Rückflug'));
    const oldMapButton = button('Ziel im Spielfeld');
    const oldRecallButton = button('Flotte zurückrufen');
    const posts = api.post.mock.calls.length;
    unmount();
    unmount = null;
    trigger.click();
    oldMapButton.click();
    oldRecallButton.dispatchEvent(new MouseEvent('click'));
    expect(api.post).toHaveBeenCalledTimes(posts);
    expect(wm.open).toHaveBeenCalledOnce();
    expect(galaxy.navigate).toHaveBeenCalledTimes(2);
    expect(wm.close).toHaveBeenCalledWith('fleet');
    expect(config.onRender).toBeNull();
  });
});
