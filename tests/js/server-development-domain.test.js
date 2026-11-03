import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { createDevelopmentDomain } from '../../js/engine/runtime/server-development-domain.js';
import { mountDevelopmentWindows } from '../../js/ui/game-development.js';

const overview = {
  success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home' }, { id: 2, name: 'Frontier' }],
};
const buildings = {
  success: true, upgrade_queue: [],
  buildings: [{ type: 'metal_mine', level: 2, next_cost: { metal: 135 }, meta: { label: '<img src=x>' } }],
};
const research = {
  success: true, research: [
    { type: 'energy_tech', level: 0, can_research: true, next_cost: { crystal: 800 }, missing_prereqs: [] },
    { type: 'laser_tech', level: 0, can_research: false, next_cost: {}, missing_prereqs: [{ tech: 'energy_tech', required_level: 1, current_level: 0 }] },
  ],
};

describe('Server-backed construction and research', () => {
  let api;
  let session;
  let domains;
  beforeEach(async () => {
    api = {
      get: vi.fn(async (url) => structuredClone(url.includes('overview') ? overview : url.includes('buildings') ? buildings : research)),
      post: vi.fn(async () => ({ success: true })),
    };
    session = createServerGameSession(api);
    await session.refresh();
    domains = Object.fromEntries(['buildings', 'research'].map((kind) =>
      [kind, createDevelopmentDomain(kind, { api, session })]));
    api.get.mockClear();
  });
  it('only reads lists when loading, with defensive copies and no completion POST', async () => {
    await domains.buildings.load();
    expect(api.get).toHaveBeenCalledWith('api/buildings.php?action=list&colony_id=1', { signal: expect.any(AbortSignal) });
    expect(api.post).not.toHaveBeenCalled();
    const state = domains.buildings.getState();
    state.data.buildings[0].level = 99;
    expect(domains.buildings.getState().data.buildings[0].level).toBe(2);
  });
  it.each(['buildings', 'research'])('uses canonical %s commands and then reloads actual server state', async (kind) => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domains[kind].load();
    const type = kind === 'buildings' ? 'metal_mine' : 'energy_tech';
    await domains[kind].command('start', type);
    expect(api.post).toHaveBeenCalledWith(`api/${kind}.php?action=${kind === 'buildings' ? 'upgrade' : 'research'}`,
      { colony_id: 1, type }, { signal: expect.any(AbortSignal) });
    expect(api.get).toHaveBeenCalledWith('api/game.php?action=overview', { signal: expect.any(AbortSignal) });
    await domains[kind].command('finish');
    expect(api.post).toHaveBeenLastCalledWith(`api/${kind}.php?action=finish`,
      kind === 'buildings' ? { colony_id: 1 } : {}, { signal: expect.any(AbortSignal) });
    expect(accepted.mock.calls.map(([event]) => event)).toEqual([
      { colonyId: 1, domain: kind, allColonies: false },
      { colonyId: 1, domain: kind, allColonies: kind === 'research' },
    ]);
  });
  it('does not let a late old-colony reply replace the current list', async () => {
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const loading = domains.buildings.load();
    const signal = api.get.mock.calls[0][1].signal;
    session.selectColony(2);
    expect(signal.aborted).toBe(true);
    expect(domains.buildings.getState()).toMatchObject({ colonyId: 2, data: null, loading: false });
    await domains.buildings.load();
    resolve({ ...buildings, buildings: [] });
    await loading;
    expect(domains.buildings.getState().data.buildings).toHaveLength(1);
  });
  it('blocks duplicate submits and preserves the captured colony during a switch', async () => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domains.buildings.load();
    let resolve;
    api.post.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const command = domains.buildings.command('start', 'metal_mine');
    session.selectColony(2);
    await domains.buildings.command('finish');
    expect(api.post).toHaveBeenCalledOnce();
    resolve({ success: true });
    await command;
    expect(api.post.mock.calls[0][1].colony_id).toBe(1);
    expect(domains.buildings.getState().colonyId).toBe(2);
    expect(accepted).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'buildings', allColonies: false });
  });
  it('reports server rejection without retry or fabricated progress', async () => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domains.research.load();
    api.post.mockRejectedValueOnce(new Error('Not enough crystal.'));
    await domains.research.command('start', 'energy_tech');
    expect(api.post).toHaveBeenCalledOnce();
    expect(domains.research.getState().error).toBe('Not enough crystal.');
    expect(domains.research.getState().data.research[0].level).toBe(0);
    expect(accepted).not.toHaveBeenCalled();
  });
  it('distinguishes an accepted command from a failed refresh', async () => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domains.buildings.load();
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    await domains.buildings.command('start', 'metal_mine');
    expect(domains.buildings.getState().error).toContain('Auftrag bestätigt');
    expect(api.post).toHaveBeenCalledOnce();
    expect(accepted).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'buildings', allColonies: false });
    await domains.buildings.refresh();
    expect(api.post).toHaveBeenCalledOnce();
    expect(domains.buildings.getState().error).toBe('');
    expect(api.get).toHaveBeenLastCalledWith('api/buildings.php?action=list&colony_id=1', { signal: expect.any(AbortSignal) });
  });
  it('starts a new overview after a pre-command overview completes', async () => {
    await domains.buildings.load();
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const old = session.refresh();
    const command = domains.buildings.command('start', 'metal_mine');
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    resolve(overview);
    await Promise.all([old, command]);
    expect(api.get.mock.calls.filter(([url]) => url.includes('action=overview'))).toHaveLength(2);
  });
  it('clears listeners and cancels in-flight mutation on logout without refreshing another session', async () => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domains.buildings.load();
    let resolve;
    api.post.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const command = domains.buildings.command('start', 'metal_mine');
    const signal = api.post.mock.calls[0][2].signal;
    api.get.mockClear();
    domains.buildings.shutdown();
    expect(signal.aborted).toBe(true);
    resolve({ success: true });
    await command;
    expect(api.get).not.toHaveBeenCalled();
    expect(domains.buildings.getState().data).toBeNull();
    expect(accepted).not.toHaveBeenCalled();
  });
  it('surfaces malformed lists explicitly', async () => {
    api.get.mockResolvedValueOnce({ success: true, buildings: [] });
    expect(await domains.buildings.load()).toBe(false);
    expect(domains.buildings.getState().error).toContain('Invalid development data');
  });
  it('opens the requested owned-colony building after async loading, safely focuses it and clears on colony changes', async () => {
    const roots = { buildings: document.createElement('div'), research: document.createElement('div') };
    document.body.replaceChildren(...Object.values(roots));
    const configs = {};
    const wm = {
      register: vi.fn((id, config) => { configs[id] = config; }),
      body: (id) => roots[id], isOpen: () => true, close: vi.fn(),
      open: vi.fn((id) => configs[id].onRender()),
    };
    const unmount = mountDevelopmentWindows({ session, domains, wm });
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    session.events.emit('buildings:open-requested', { colonyId: 1, buildingType: 'metal_mine' });
    expect(api.post).not.toHaveBeenCalled();
    expect(roots.buildings.querySelector('[aria-current]')).toBeNull();
    finish(structuredClone(buildings));
    await vi.waitFor(() => expect(roots.buildings.querySelector('[aria-current="true"]')).not.toBeNull());
    const heading = roots.buildings.querySelector('[aria-current="true"] h3');
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent).toBe('<img src=x>');
    expect(roots.buildings.querySelector('img')).toBeNull();
    session.selectColony(2);
    await vi.waitFor(() => expect(domains.buildings.getState().loading).toBe(false));
    expect(roots.buildings.querySelector('[aria-current]')).toBeNull();
    session.events.emit('buildings:open-requested', { colonyId: 2, buildingType: 'metal_mine' });
    await vi.waitFor(() => expect(roots.buildings.querySelector('[aria-current="true"]')).not.toBeNull());
    [...roots.buildings.querySelectorAll('button')].find((item) => item.textContent === 'Gebäudeauswahl aufheben').click();
    expect(roots.buildings.querySelector('[aria-current]')).toBeNull();
    session.events.emit('buildings:open-requested', { colonyId: 2, buildingType: 'missing' });
    await vi.waitFor(() => expect(roots.buildings.textContent).toContain('nicht mehr verfügbar'));
    expect(roots.buildings.querySelector('[aria-current]')).toBeNull();
    const opened = wm.open.mock.calls.length;
    unmount();
    session.events.emit('buildings:open-requested', { colonyId: 1, buildingType: 'metal_mine' });
    expect(wm.open).toHaveBeenCalledTimes(opened);
    Object.values(domains).forEach((domain) => domain.shutdown());
  });
  it('uses existing WM windows, safe text, explicit finish and tears down subscriptions', async () => {
    const roots = { buildings: document.createElement('div'), research: document.createElement('div') };
    const configs = {};
    const wm = {
      register: vi.fn((id, config) => { configs[id] = config; }),
      body: (id) => roots[id],
      isOpen: () => true,
      close: vi.fn(),
      open: vi.fn((id) => configs[id].onRender()),
    };
    const unmount = mountDevelopmentWindows({ session, domains, wm });
    configs.buildings.onRender();
    await vi.waitFor(() => expect(roots.buildings.querySelector('article')).not.toBeNull());
    expect(roots.buildings.querySelector('img')).toBeNull();
    expect(roots.buildings.textContent).toContain('<img src=x>');
    expect(api.post).not.toHaveBeenCalled();
    configs.research.onRender();
    await vi.waitFor(() => expect(roots.research.querySelectorAll('article')).toHaveLength(2));
    expect(roots.research.querySelectorAll('article button')[1].disabled).toBe(true);
    const finish = Array.from(roots.research.querySelectorAll('button')).find((entry) => entry.textContent.includes('Fällige'));
    finish.click();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    unmount();
    expect(wm.close).toHaveBeenCalledWith('buildings');
    expect(wm.close).toHaveBeenCalledWith('research');
    expect(configs.research.onRender).toBeNull();
    Object.values(domains).forEach((domain) => domain.shutdown());
  });
});
