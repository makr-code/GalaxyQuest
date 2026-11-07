import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShipyardDomain } from '../../js/engine/runtime/server-shipyard-domain.js';
import { createFleetLaunchDomain } from '../../js/engine/runtime/server-fleet-launch-domain.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { mountShipyardWindow } from '../../js/ui/game-shipyard.js';
import { attachWindowWidgets } from './helpers/window-widget-fixture.js';

const inventory = () => ({ success: true,
  ships: [{ type: 'small_cargo', count: 4, cost: { metal: 2000, crystal: 2000, deuterium: 0 } }],
  blueprints: [{ id: 7, type: 'bp_7', name: '<img src=x>', count: '0', cost: { metal: 100 } }],
  queue: [{ id: 3, position: 1, ship_type: 'small_cargo', quantity: 2, status: 'running',
    eta: '2000-01-01 10:00:00' }],
});
const overview = () => ({ success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home', galaxy: 1, system: 10, position: 3 },
    { id: 2, name: 'Other', galaxy: 2, system: 20, position: 4 }] });

describe('Authoritative shipyard and fleet inventory integration', () => {
  let api;
  let session;
  let domain;
  let unmount;
  let launch;
  let root;
  let wm;
  beforeEach(async () => {
    api = { get: vi.fn(async (url) => url.includes('overview') ? overview()
      : url.includes('ftl_status') ? { success: true, ftl_drive_type: 'aereth', ftl_ready: true,
        ftl_cooldown_remaining_s: 0, gates: [], resonance_nodes: [] } : inventory()),
    post: vi.fn(async () => ({ success: true })) };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createShipyardDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    launch?.shutdown();
    launch = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  function mount() {
    root = document.createElement('div');
    document.body.append(root);
    wm = { body: () => root, register: vi.fn(), open: vi.fn(), close: vi.fn(),
      minimize: vi.fn(), isOpen: () => true };
    unmount = mountShipyardWindow({ session, domain, wm: attachWindowWidgets(wm) });
    return wm.register.mock.calls[0][1].onRender();
  }
  const click = (label) => [...root.querySelectorAll('button')].find((item) => item.textContent === label).click();
  const form = () => root.querySelector('[data-ship-type="small_cargo"] form');
  const input = () => form().querySelector('input');
  const fill = (value) => { input().value = value; input().dispatchEvent(new Event('input')); };
  const submit = () => form().dispatchEvent(new Event('submit', { cancelable: true }));
  it('separates production completion from construction cards and keeps stale commands locked', async () => {
    mount();
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    expect(root.querySelector('.game-shipyard-header h2 svg')).not.toBeNull();
    const production = root.querySelector('[aria-label="Produktionsaufträge"]');
    expect(production.querySelector('.game-shipyard-order-count').textContent).toBe('1 Auftrag');
    const finish = [...production.querySelectorAll('button')].find((item) => item.textContent === 'Fällige Schiffsbauten abschließen');
    expect(finish.disabled).toBe(false);
    expect(production.querySelector('.game-shipyard-queue li')).not.toBeNull();
    expect(production.querySelector('form')).toBeNull();
    expect(root.querySelector('.game-shipyard-cost [aria-label="Basiskosten je Schiff"]')).not.toBeNull();
    expect(root.querySelector('.game-shipyard-help').open).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    api.get.mockRejectedValueOnce(new Error('Inventory unavailable'));
    await domain.load();
    expect(root.querySelector('.game-shipyard-production button').disabled).toBe(true);
    expect(form().querySelector('fieldset').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('only reads canonical catalog, blueprints and overdue queue without automatic completion', async () => {
    await domain.load();
    expect(api.get).toHaveBeenCalledExactlyOnceWith('api/shipyard.php?action=list&colony_id=1', { signal: expect.any(AbortSignal) });
    expect(domain.getState()).toMatchObject({ stale: false, data: { ships: [{ type: 'small_cargo' }, { type: 'bp_7' }], queue: [{ quantity: 2 }] } });
    expect(api.post).not.toHaveBeenCalled();
    const copy = domain.getState();
    copy.data.ships[0].count = 99;
    expect(domain.getState().data.ships[0].count).toBe(4);
  });
  it.each([
    ['small_cargo', { colony_id: 1, type: 'small_cargo', count: 3 }],
    ['bp_7', { colony_id: 1, type: 'bp_7', count: 3, blueprint_id: 7 }],
  ])('builds %s with captured origin and canonical blueprint ID, then refreshes', async (type, body) => {
    const changed = vi.fn();
    session.events.on('colony:mutation-accepted', changed);
    await domain.load();
    await domain.command('build', { type, count: '3' });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/shipyard.php?action=build', body, { signal: expect.any(AbortSignal) });
    expect(changed).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'shipyard', allColonies: false });
    expect(domain.getState()).toMatchObject({ stale: false, mutating: false, error: '' });
    expect(api.get.mock.calls.map(([url]) => url)).toEqual([
      'api/shipyard.php?action=list&colony_id=1', 'api/game.php?action=overview', 'api/shipyard.php?action=list&colony_id=1',
    ]);
  });
  it('completes builds only by an explicit colony-scoped POST', async () => {
    await domain.load();
    await domain.refresh();
    expect(api.post).not.toHaveBeenCalled();
    await domain.command('finish');
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/shipyard.php?action=finish', { colony_id: 1 }, { signal: expect.any(AbortSignal) });
  });
  it.each([{ type: 'unknown', count: 1 }, { type: 'small_cargo', count: 0 },
    { type: 'small_cargo', count: 1.5 }, { type: 'small_cargo', count: true },
    { type: 'small_cargo', count: '' }, { type: 'small_cargo', count: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid build quantities and types: %j', async (value) => {
    await domain.load();
    await expect(domain.command('build', value)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each([
    { ships: null }, { ships: [{ type: 'small_cargo', count: -1 }] },
    { ships: [{ type: 'small_cargo', count: 4, cost: { metal: -1 } }] },
    { blueprints: [{ type: 'bp_7', count: 1, cost: {} }] },
    { queue: null }, { queue: [{ ...inventory().queue[0], status: 'done' }] },
    { queue: [{ ...inventory().queue[0], quantity: 0 }] },
    { queue: [inventory().queue[0], inventory().queue[0]] },
  ])('retains last data and blocks commands after invalid server data: %j', async (invalid) => {
    await domain.load();
    api.get.mockResolvedValueOnce({ ...inventory(), ...invalid });
    expect(await domain.load()).toBe(false);
    expect(domain.getState().stale).toBe(true);
    expect(domain.getState().data.ships[0].count).toBe(4);
    await expect(domain.command('finish')).rejects.toThrow('aktualisieren');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('serializes mutations, prevents external reads from unlocking stale data during commands and recovers without resubmission', async () => {
    await domain.load();
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.command('build', { type: 'small_cargo', count: 2 });
    await domain.command('finish');
    await domain.load();
    await domain.refresh();
    expect(api.get).toHaveBeenCalledOnce();
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    finish({ success: true });
    await pending;
    expect(domain.getState()).toMatchObject({ stale: true, mutating: false });
    expect(domain.getState().error).toContain('Auftrag bestätigt');
    await expect(domain.command('build', { type: 'small_cargo', count: 2 })).rejects.toThrow('aktualisieren');
    expect(api.post).toHaveBeenCalledOnce();
    await domain.refresh();
    expect(domain.getState().stale).toBe(false);
    expect(api.post).toHaveBeenCalledOnce();
  });
  it('invalidates inventory across shipyard, launch and processed arrival commands, not foreign colonies', async () => {
    launch = createFleetLaunchDomain({ api, session });
    await domain.load();
    await launch.load();
    session.events.emit('colony:mutation-accepted', { colonyId: 2, domain: 'shipyard', allColonies: false });
    expect(launch.getState().stale).toBe(false);
    await domain.command('finish');
    expect(launch.getState().stale).toBe(true);
    await launch.load();
    session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'fleet-launch', allColonies: true });
    expect(domain.getState().stale).toBe(true);
    await domain.load();
    session.events.emit('colony:mutation-accepted', { colonyId: 2, domain: 'fleets', allColonies: true });
    expect(domain.getState().stale).toBe(true);
    expect(launch.getState().stale).toBe(true);
  });
  it('does not let pre-mutation reads unlock either shipyard or launch inventory', async () => {
    launch = createFleetLaunchDomain({ api, session });
    for (const target of [domain, launch]) {
      let finish;
      api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const pending = target.load();
      session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'shipyard', allColonies: false });
      finish(inventory());
      await pending;
      expect(target.getState().stale).toBe(true);
      await target.load();
      expect(target.getState().stale).toBe(false);
    }
  });
  it('retains accepted-order protection after a post-command list failure and aborts pending mutations on logout', async () => {
    await domain.load();
    api.get.mockResolvedValueOnce(overview()).mockRejectedValueOnce(new Error('List offline'));
    await domain.command('build', { type: 'small_cargo', count: 2 });
    expect(domain.getState().stale).toBe(true);
    expect(domain.getState().error).toContain('Auftrag bestätigt, Liste');
    await domain.load();
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.command('finish');
    const signal = api.post.mock.calls.at(-1)[2].signal;
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    domain.shutdown();
    finish({ success: true });
    await pending;
    expect(signal.aborted).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
    expect(domain.getState().data).toBeNull();
  });
  it('aborts obsolete colony reads and late responses on logout', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.load();
    const signal = api.get.mock.calls[0][1].signal;
    session.selectColony(2);
    await domain.load();
    finish({ ...inventory(), ships: [] });
    await pending;
    expect(signal.aborted).toBe(true);
    expect(domain.getState()).toMatchObject({ colonyId: 2, data: { ships: [{ type: 'small_cargo' }, { type: 'bp_7' }] } });
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const logoutRead = domain.load();
    const logoutSignal = api.get.mock.calls.at(-1)[1].signal;
    domain.shutdown();
    finish(inventory());
    await logoutRead;
    expect(logoutSignal.aborted).toBe(true);
    expect(domain.getState().data).toBeNull();
  });
  it('renders safe catalog and queue, preserves rejected quantity and resets accepted drafts before failed refresh', async () => {
    mount();
    await vi.waitFor(() => expect(root.querySelector('[data-ship-type="small_cargo"]')).not.toBeNull());
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x>');
    expect(root.textContent).toContain('2000-01-01 10:00:00 (Serverzeit)');
    const card = root.querySelector('[data-ship-type="small_cargo"]');
    expect(card.querySelector('.game-development-card-heading svg')).not.toBeNull();
    expect(card.querySelector('.game-shipyard-stock').textContent).toBe('Verfügbar: 4');
    expect(card.querySelector('[aria-label="Basiskosten je Schiff"]').textContent).toBe('2000 metal2000 crystal');
    expect(card.querySelectorAll('.game-development-costs svg')).toHaveLength(2);
    expect(root.querySelector('[data-ship-type="bp_7"] .game-shipyard-blueprint').textContent).toBe('Bauplan');
    const order = root.querySelector('.game-shipyard-queue li');
    expect(order.dataset.orderState).toBe('running');
    expect(order.querySelector('.wm-timeline-meta').textContent).toContain('#1');
    expect(order.querySelector('.wm-timeline-title').textContent).toBe('2 small cargo');
    expect(order.querySelector('.wm-timeline-state').textContent).toBe('Im Bau');
    expect(root.querySelector('progress, meter')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    fill('3');
    api.post.mockRejectedValueOnce(new Error('Shipyard required'));
    submit();
    await vi.waitFor(() => expect(root.textContent).toContain('Shipyard required'));
    expect(input().value).toBe('3');
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    submit();
    await vi.waitFor(() => expect(root.textContent).toContain('Auftrag bestätigt'));
    expect(input().value).toBe('1');
    expect(form().querySelector('fieldset').disabled).toBe(true);
    click('Werft aktualisieren');
    await vi.waitFor(() => expect(form().querySelector('fieldset').disabled).toBe(false));
    expect(api.post).toHaveBeenCalledTimes(2);
    fill('6');
    session.selectColony(2);
    await vi.waitFor(() => expect(root.textContent).toContain('Other'));
    await vi.waitFor(() => expect(input().value).toBe('1'));
  });
  it('shows waiting orders, zero inventory and empty costs without inferred progress or writes', async () => {
    api.get.mockResolvedValueOnce({ success: true,
      ships: [{ type: 'small_cargo', count: 0, cost: { metal: 0 } }],
      blueprints: [], queue: [{ id: 8, position: 2, ship_type: 'small_cargo',
        label: '<script>queue</script>', quantity: 3, status: 'queued', eta: null }] });
    mount();
    await vi.waitFor(() => expect(root.querySelector('.game-shipyard-stock')).not.toBeNull());
    expect(root.querySelector('.game-shipyard-stock').textContent).toBe('Verfügbar: 0');
    expect(root.querySelector('.game-development-costs').textContent).toBe('0');
    const order = root.querySelector('.game-shipyard-queue li');
    expect(order.dataset.orderState).toBe('queued');
    expect(order.textContent).toContain('Wartet');
    expect(order.textContent).toContain('Start ausstehend');
    expect(order.textContent).toContain('3 <script>queue</script>');
    expect(root.querySelector('script, progress, meter')).toBeNull();
    api.get.mockResolvedValueOnce({ success: true, ships: [], blueprints: [], queue: [] });
    await domain.load();
    expect(root.textContent).toContain('Keine laufenden Schiffsbauten.');
    expect(root.querySelector('.game-shipyard-card')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('filters ships locally while preserving quantities, focus, queue and refresh selections', async () => {
    mount();
    await vi.waitFor(() => expect(input()).not.toBeNull());
    fill('6');
    const originalInput = input();
    const search = root.querySelector('[aria-label="Schiffe suchen"]');
    const filter = root.querySelector('[aria-label="Schiffsauswahl"]');
    const visible = () => [...root.querySelectorAll('.game-shipyard-card')].filter(card => !card.hidden);
    const reads = api.get.mock.calls.length;
    search.focus();
    search.value = ' SMALL ';
    search.dispatchEvent(new Event('input'));
    expect(visible().map(card => card.dataset.shipType)).toEqual(['small_cargo']);
    expect(document.activeElement).toBe(search);
    filter.value = 'blueprints';
    filter.dispatchEvent(new Event('change'));
    expect(visible()).toHaveLength(0);
    expect(root.textContent).toContain('0 von 2 Schiffstypen angezeigt.');
    expect(root.querySelector('.game-shipyard-queue li')).not.toBeNull();
    expect(input()).toBe(originalInput);
    expect(input().value).toBe('6');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(visible().map(card => card.dataset.shipType)).toEqual(['bp_7']);
    expect(visible()[0].querySelector('fieldset').disabled).toBe(false);
    filter.value = 'stock';
    filter.dispatchEvent(new Event('change'));
    expect(visible().map(card => card.dataset.shipType)).toEqual(['small_cargo']);
    expect(api.get).toHaveBeenCalledTimes(reads);
    expect(api.post).not.toHaveBeenCalled();
    await domain.load();
    expect(root.querySelector('[aria-label="Schiffsauswahl"]').value).toBe('stock');
    expect(input().value).toBe('6');
    click('Werftfilter zurücksetzen');
    expect(visible()).toHaveLength(2);
    expect(document.activeElement).toBe(root.querySelector('[aria-label="Schiffe suchen"]'));
    expect(api.post).not.toHaveBeenCalled();
    const detachedSearch = root.querySelector('[aria-label="Schiffe suchen"]');
    unmount();
    unmount = null;
    const before = root.innerHTML;
    detachedSearch.value = 'not loaded';
    detachedSearch.dispatchEvent(new Event('input'));
    expect(root.innerHTML).toBe(before);
  });
  it('opens only owned colony requests and returns to map composition, then removes all bindings', async () => {
    mount();
    await vi.waitFor(() => expect(root.querySelector('[data-ship-type="small_cargo"]')).not.toBeNull());
    session.events.emit('shipyard:open-requested', { colonyId: 2 });
    expect(session.getColony().id).toBe(2);
    expect(wm.open).toHaveBeenCalledWith('shipyard');
    session.events.emit('shipyard:open-requested', { colonyId: 999 });
    expect(session.getColony().id).toBe(2);
    expect(wm.open).toHaveBeenCalledOnce();
    const origin = vi.fn();
    session.events.on('fleet:origin-requested', origin);
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    click('Flotte im Spielfeld zusammenstellen');
    expect(origin).toHaveBeenCalledExactlyOnceWith({ colonyId: 2 });
    expect(wm.minimize).toHaveBeenCalledWith('shipyard');
    unmount();
    unmount = null;
    expect(wm.close).toHaveBeenCalledWith('shipyard');
    expect(wm.register).toHaveBeenLastCalledWith('shipyard', { onRender: null });
  });
});
