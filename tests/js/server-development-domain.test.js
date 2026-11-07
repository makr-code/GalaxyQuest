import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { createDevelopmentDomain } from '../../js/engine/runtime/server-development-domain.js';
import { mountDevelopmentWindows } from '../../js/ui/game-development.js';
import { attachWindowWidgets } from './helpers/window-widget-fixture.js';

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
    const unmount = mountDevelopmentWindows({ session, domains, wm: attachWindowWidgets(wm) });
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
  it('filters catalogues locally without resetting focus or bypassing a hidden running research', async () => {
    const roots = { buildings: document.createElement('div'), research: document.createElement('div') };
    document.body.append(...Object.values(roots));
    const wm = { register: vi.fn(), body: kind => roots[kind], isOpen: () => true,
      close: vi.fn(), open: vi.fn() };
    const unmount = mountDevelopmentWindows({ session, domains, wm: attachWindowWidgets(wm) });
    try {
      await domains.buildings.load();
      await domains.research.load();
      const root = roots.research;
      expect(root.querySelector('.game-development-workspace-header h2 svg')).not.toBeNull();
      expect(root.querySelector('.game-development-orders').textContent).toContain('Keine laufende Forschung.');
      expect(root.querySelector('.game-development-orders button').textContent).toBe('Fällige Aufträge abschließen');
      expect(root.querySelector('.game-development-help').open).toBe(false);
      expect(root.querySelector('.game-development-project-costs [aria-label="Kosten der nächsten Stufe"]')).not.toBeNull();
      const search = root.querySelector('input[type="search"]');
      const status = root.querySelector('[aria-label="Auftragsstatus"]');
      const visible = () => [...root.querySelectorAll('article')].filter(card => !card.hidden);
      const calls = api.get.mock.calls.length;
      search.focus();
      search.value = ' LASER ';
      search.dispatchEvent(new Event('input'));
      expect(document.activeElement).toBe(search);
      expect(visible().map(card => card.dataset.type)).toEqual(['laser_tech']);
      expect(root.textContent).toContain('1 von 2 Einträgen angezeigt.');
      status.value = 'request';
      status.dispatchEvent(new Event('change'));
      expect(visible()).toHaveLength(0);
      expect(root.textContent).toContain('Keine passenden Einträge.');
      expect(roots.buildings.querySelector('article').hidden).toBe(false);
      expect(api.get).toHaveBeenCalledTimes(calls);
      expect(api.post).not.toHaveBeenCalled();
      const running = structuredClone(research);
      running.research[0].research_end = '2030-01-01 10:00:00';
      api.get.mockResolvedValueOnce(running);
      await domains.research.load();
      expect(root.querySelector('input').value).toBe(' LASER ');
      expect(root.querySelector('[aria-label="Auftragsstatus"]').value).toBe('request');
      expect(visible()).toHaveLength(0);
      const currentResearch = root.querySelector('[aria-label="Laufende Forschung"]');
      expect(currentResearch.textContent).toContain('energy tech → 1');
      expect(currentResearch.textContent).toContain('2030-01-01 10:00:00 (Serverzeit)');
      expect(currentResearch.closest('[hidden]')).toBeNull();
      [...root.querySelectorAll('button')].find(button => button.textContent === 'Katalogfilter zurücksetzen').click();
      expect(visible()).toHaveLength(2);
      expect(document.activeElement).toBe(root.querySelector('input'));
      expect([...root.querySelectorAll('article button')].every(button => button.disabled)).toBe(true);
      const buildingSearch = roots.buildings.querySelector('input');
      buildingSearch.value = 'no match';
      buildingSearch.dispatchEvent(new Event('input'));
      expect(roots.buildings.querySelector('article').hidden).toBe(true);
      session.events.emit('buildings:open-requested', { colonyId: 1, buildingType: 'metal_mine' });
      expect(roots.buildings.querySelector('article').hidden).toBe(false);
      expect(roots.buildings.querySelector('input').value).toBe('');
      expect(document.activeElement).toBe(roots.buildings.querySelector('article h3'));
      expect(api.post).not.toHaveBeenCalled();
    } finally {
      unmount();
      Object.values(domains).forEach(domain => domain.shutdown());
      Object.values(roots).forEach(root => root.remove());
    }
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
    const unmount = mountDevelopmentWindows({ session, domains, wm: attachWindowWidgets(wm) });
    configs.buildings.onRender();
    await vi.waitFor(() => expect(roots.buildings.querySelector('article')).not.toBeNull());
    expect(roots.buildings.querySelector('img')).toBeNull();
    expect(roots.buildings.textContent).toContain('<img src=x>');
    expect(roots.buildings.querySelector('.game-development-level').textContent).toBe('Stufe 2');
    expect(roots.buildings.querySelector('.game-development-costs').textContent).toBe('135 metal');
    expect(roots.buildings.querySelector('.game-development-costs svg').getAttribute('aria-hidden')).toBe('true');
    expect(roots.buildings.querySelector('.game-development-queue').textContent).toBe('Keine Bauaufträge.');
    expect(roots.buildings.querySelector('progress')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    configs.research.onRender();
    await vi.waitFor(() => expect(roots.research.querySelectorAll('article')).toHaveLength(2));
    expect(roots.research.querySelectorAll('article button')[1].disabled).toBe(true);
    expect(roots.research.querySelector('[data-type="laser_tech"] [data-order-state]').dataset.orderState).toBe('blocked');
    expect(roots.research.querySelector('[data-type="energy_tech"] .game-development-costs').textContent).toBe('800 crystal');
    const prerequisites = roots.research.querySelector('.game-research-prerequisites');
    expect(prerequisites.getAttribute('aria-label')).toBe('Fehlende Forschungsvoraussetzungen');
    expect(prerequisites.querySelector('strong').textContent).toBe('energy_tech');
    expect(prerequisites.textContent).toContain('Benötigt: Stufe 1');
    expect(prerequisites.textContent).toContain('Vorhanden: Stufe 0');
    expect(prerequisites.querySelector('meter').value).toBe(0);
    expect(prerequisites.querySelector('meter').max).toBe(1);
    expect(roots.research.querySelector('[data-type="energy_tech"] .game-research-prerequisites')).toBeNull();
    const updatedResearch = structuredClone(research);
    updatedResearch.research[1].missing_prereqs = [
      { tech: '<img src=x>', required_level: '4', current_level: '2' },
      { tech: 'unknown', required_level: null, current_level: '' },
      { tech: 'server_blocked', required_level: 1, current_level: 3 },
    ];
    api.get.mockResolvedValueOnce(updatedResearch);
    await domains.research.load();
    const rows = roots.research.querySelectorAll('.game-research-prerequisites li');
    expect(rows[0].querySelector('meter').value).toBe(2);
    expect(rows[0].querySelector('meter').max).toBe(4);
    expect(rows[0].querySelector('strong').textContent).toBe('<img src=x>');
    expect(roots.research.querySelector('img')).toBeNull();
    expect(rows[1].querySelector('meter')).toBeNull();
    expect(rows[1].textContent).toContain('Nicht verfügbar');
    expect(rows[2].querySelector('meter').value).toBe(1);
    expect(rows[2].textContent).toContain('Vorhanden: Stufe 3');
    expect(roots.research.querySelector('[data-type="laser_tech"] button').disabled).toBe(true);
    const updated = structuredClone(buildings);
    updated.upgrade_queue = [{ type: 'metal_mine', target_level: 3, status: '<img src=x>', eta: '2030-01-01 10:00:00' }];
    updated.buildings[0].upgrade_end = '2030-01-01 10:00:00';
    updated.buildings[0].next_cost = { metal: 'invalid', crystal: 0 };
    api.get.mockResolvedValueOnce(updated);
    await domains.buildings.load();
    expect(roots.buildings.querySelector('[data-order-state="running"]').textContent).toBe('In Arbeit');
    expect(roots.buildings.querySelector('.game-development-costs').textContent).toBe('Nicht verfügbar metal');
    expect(roots.buildings.querySelector('.game-development-queue').textContent).toContain('2030-01-01 10:00:00');
    expect(roots.buildings.querySelector('img')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
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
