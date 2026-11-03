import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { createEconomyDomain } from '../../js/engine/runtime/server-economy-domain.js';
import { mountEconomyWindow } from '../../js/ui/game-economy.js';

const overview = {
  success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home' }, { id: 2, name: 'Frontier' }],
};
const snapshot = () => ({
  success: true, colony: { id: 1, energy: -5 },
  economy: { settled_at: 1700000000, pending_seconds: 300, satisfaction: 70,
    stock: { metal: 0, food: 123.5 }, production: { metal: 12 }, consumption: { food: 2 },
    shortages: { consumer_goods: 3 } },
  pop_classes: { colonist: 100 }, storage: { metal: 10000, food: 1000 },
  buildings: [{ type: 'metallurgy', level: 1 }], methods: { metallurgy: 'standard' },
  catalog: { metallurgy: { label: '<img src=x>', good: 'steel_alloy', inputs: { metal: 2 }, research: 'energy_tech' } },
});
const policy = () => ({
  success: true, global_policy: 'free_market', taxes: { income: 0.15, production: 0, trade: 0.05 },
  tax_steps: { income: 0.01, production: 0.01, trade: 0.01 },
  subsidies: { agriculture: false, research: false, military: false },
});

describe('Authoritative economy domain and window', () => {
  let api;
  let session;
  let domain;
  let unmountWindow;
  beforeEach(async () => {
    document.body.replaceChildren();
    api = {
      get: vi.fn(async (url) => {
        if (url.includes('game.php')) return structuredClone(overview);
        if (url.includes('get_policy')) return policy();
        return { ...snapshot(), colony: { id: Number(new URL(url, 'http://localhost').searchParams.get('colony_id')), energy: -5 } };
      }),
      post: vi.fn(async () => ({ success: true })),
    };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createEconomyDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    unmountWindow?.();
    unmountWindow = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  function mountResourceWindow() {
    const root = document.createElement('div');
    const controls = document.createElement('section');
    controls.id = 'resource-section';
    document.body.append(controls, root);
    let config;
    const wm = {
      register: vi.fn((_id, next) => { config = next; }), body: () => root,
      isOpen: () => true, close: vi.fn(), minimize: vi.fn(),
      open: vi.fn(() => config.onRender()),
    };
    unmountWindow = mountEconomyWindow({ session, domain, wm });
    const openResource = (good) => {
      const trigger = document.createElement('button');
      trigger.dataset.resource = good;
      trigger.innerHTML = '<span>Resource</span>';
      controls.append(trigger);
      trigger.firstChild.click();
      return trigger;
    };
    return { root, controls, wm, openResource };
  }
  it('reads canonical snapshots and policy without mutations or invented rates', async () => {
    await domain.load();
    expect(api.get).toHaveBeenCalledWith('api/colony_economy.php?action=snapshot&colony_id=1', { signal: expect.any(AbortSignal) });
    expect(api.get).toHaveBeenCalledWith('api/economy.php?action=get_policy', { signal: expect.any(AbortSignal) });
    expect(api.post).not.toHaveBeenCalled();
    expect(domain.getState().data.snapshot.economy.production.food).toBeUndefined();
    const copy = domain.getState();
    copy.data.snapshot.economy.stock.metal = 999;
    expect(domain.getState().data.snapshot.economy.stock.metal).toBe(0);
  });
  it.each([
    ['policy', 'autarky', 'api/economy.php?action=set_policy', { policy: 'autarky' }],
    ['tax', { type: 'income', rate: 0 }, 'api/economy.php?action=set_tax', { type: 'income', rate: 0 }],
    ['tax', { type: 'production', rate: 0.3 }, 'api/economy.php?action=set_tax', { type: 'production', rate: 0.3 }],
    ['subsidy', { sector: 'research', enabled: false }, 'api/economy.php?action=set_subsidy', { sector: 'research', enabled: false }],
    ['method', { building_type: 'metallurgy', method: 'efficient' }, 'api/colony_economy.php?action=set_method',
      { colony_id: 1, building_type: 'metallurgy', method: 'efficient' }],
  ])('submits canonical %s settings then reloads server snapshots and HUD', async (action, value, endpoint, body) => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domain.load();
    await domain.command(action, value);
    expect(api.post).toHaveBeenCalledExactlyOnceWith(endpoint, body, { signal: expect.any(AbortSignal) });
    expect(api.get).toHaveBeenCalledWith('api/game.php?action=overview', { signal: expect.any(AbortSignal) });
    expect(api.get.mock.calls.filter(([url]) => url.includes('action=snapshot'))).toHaveLength(2);
    expect(accepted).toHaveBeenCalledExactlyOnceWith({
      colonyId: 1, domain: 'economy', allColonies: action !== 'method',
    });
  });
  it('rejects invalid tax bounds and unavailable building methods before submission', async () => {
    await domain.load();
    await expect(domain.command('tax', { type: 'trade', rate: 0.26 })).rejects.toThrow('Invalid economy command');
    await expect(domain.command('tax', { type: 'trade', rate: NaN })).rejects.toThrow('Invalid economy command');
    await expect(domain.command('method', { building_type: 'unknown', method: 'premium' })).rejects.toThrow('Invalid economy command');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('discards late snapshots after changing colony and aborts both requests', async () => {
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const loading = domain.load();
    const signal = api.get.mock.calls[0][1].signal;
    session.selectColony(2);
    expect(signal.aborted).toBe(true);
    expect(domain.getState()).toMatchObject({ colonyId: 2, data: null, loading: false });
    await domain.load();
    resolve(snapshot());
    await loading;
    expect(domain.getState().data.snapshot.colony.id).toBe(2);
  });
  it('retains the original command colony and suppresses duplicates during a switch', async () => {
    await domain.load();
    let resolve;
    api.post.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const command = domain.command('method', { building_type: 'metallurgy', method: 'efficient' });
    session.selectColony(2);
    await domain.command('policy', 'autarky');
    expect(api.post).toHaveBeenCalledOnce();
    resolve({ success: true });
    await command;
    expect(api.post.mock.calls[0][1].colony_id).toBe(1);
    expect(domain.getState().data.snapshot.colony.id).toBe(2);
  });
  it('preserves server state on rejection and refreshes without retrying an accepted command', async () => {
    await domain.load();
    api.post.mockRejectedValueOnce(new Error('Research missing'));
    await domain.command('method', { building_type: 'metallurgy', method: 'premium' });
    expect(domain.getState().error).toBe('Research missing');
    expect(domain.getState().data.snapshot.methods.metallurgy).toBe('standard');
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    await domain.command('policy', 'autarky');
    expect(domain.getState().error).toContain('Auftrag bestätigt');
    await domain.refresh();
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(domain.getState().error).toBe('');
  });
  it.each([
    { ...snapshot(), colony: { id: 999 } },
    { ...snapshot(), economy: { ...snapshot().economy, stock: { metal: 'bad' } } },
    { ...snapshot(), catalog: { metallurgy: {} } },
    { ...snapshot(), methods: {} },
  ])('reports malformed server data rather than fabricating fallback values', async (data) => {
    api.get.mockResolvedValueOnce(data);
    expect(await domain.load()).toBe(false);
    expect(domain.getState().error).toBe('Invalid economy data returned by the server.');
  });
  it('aborts logout work and ignores a late accepted command', async () => {
    await domain.load();
    let resolve;
    api.post.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const command = domain.command('policy', 'autarky');
    const signal = api.post.mock.calls[0][2].signal;
    api.get.mockClear();
    domain.shutdown();
    expect(signal.aborted).toBe(true);
    resolve({ success: true });
    await command;
    expect(api.get).not.toHaveBeenCalled();
    expect(domain.getState().data).toBeNull();
  });
  it('renders safe server values and submits percentage inputs without local simulation', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    let config;
    const wm = {
      register: vi.fn((_id, next) => { config = next; }), body: () => root,
      isOpen: () => true, close: vi.fn(), open: vi.fn(),
    };
    const unmount = mountEconomyWindow({ session, domain, wm });
    config.onRender();
    await vi.waitFor(() => expect(root.querySelector('table')).not.toBeNull());
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x>');
    expect(root.querySelector('[data-good="metal"]').textContent).toContain('0');
    expect(root.querySelector('[data-good="food"]').lastChild.textContent).toBe('2');
    expect(root.querySelector('[data-good="food"]').children[3].textContent).toBe('\u2014');
    const input = root.querySelector('[aria-label="Einkommensteuer (%)"]');
    expect(input.step).toBe('1');
    input.value = '1';
    await session.refresh();
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('1');
    input.closest('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(api.post.mock.calls[0][1]).toEqual({ type: 'income', rate: 0.01 });
    unmount();
    expect(wm.close).toHaveBeenCalledWith('economy');
    expect(config.onRender).toBeNull();
    domain.shutdown();
  });
  it.each(['metal', 'crystal', 'deuterium', 'food', 'rare_earth'])('opens %s from the HUD without substituting overview values', async (good) => {
    const { root, openResource, wm } = mountResourceWindow();
    openResource(good);
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const detail = root.querySelector('[data-resource-detail]');
    expect(detail.dataset.resourceDetail).toBe(good);
    expect(wm.open).toHaveBeenCalledExactlyOnceWith('economy');
    expect(document.activeElement).toBe(detail.querySelector('h3'));
    if (['metal', 'food'].includes(good)) {
      const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(snapshot().economy.stock[good]);
      expect(detail.textContent).toContain(`Bestand: ${value}`);
      expect(root.querySelector(`tr[data-good="${good}"]`).getAttribute('aria-current')).toBe('true');
    } else {
      expect(detail.textContent).toContain('Kein Bestandsmesswert');
      expect(root.querySelector('tr[aria-current]')).toBeNull();
    }
    expect(api.post).not.toHaveBeenCalled();
  });
  it('links selected stocks to the market with just the current colony and good, not a trade', async () => {
    const { root, openResource, wm } = mountResourceWindow();
    const requested = vi.fn();
    session.events.on('market:open-requested', requested);
    openResource('metal');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    root.querySelector('[data-resource-detail] button').click();
    expect(wm.minimize).toHaveBeenCalledExactlyOnceWith('economy');
    expect(requested).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, goodType: 'metal' });
    expect(api.post).not.toHaveBeenCalled();
    root.querySelector('tr[data-good="food"] button').click();
    expect(root.querySelector('[data-resource-detail]').dataset.resourceDetail).toBe('food');
    expect(document.activeElement.textContent).toBe('food');
    root.querySelector('[data-resource-detail] button').click();
    expect(requested).toHaveBeenLastCalledWith({ colonyId: 1, goodType: 'food' });
  });
  it('shows energy as a signed server balance without storage or a market action', async () => {
    const { root, openResource } = mountResourceWindow();
    openResource('energy');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const detail = root.querySelector('[data-resource-detail]');
    expect(detail.textContent).toContain('Energie: -5');
    expect(detail.textContent).toContain('kein lagerbares Handelsgut');
    expect(detail.textContent).not.toContain('im Markt öffnen');
    expect(detail.textContent).not.toContain('Kapazität');
    api.get.mockImplementationOnce(async () => ({ ...snapshot(), colony: { id: 1 } }));
    await domain.load();
    expect(root.querySelector('[data-resource-detail]').textContent).toContain('Energie: —');
    expect(root.textContent).not.toContain('Energie: 0');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('retains failed resource measurements but blocks handoff until fresh data arrives', async () => {
    const { root, openResource } = mountResourceWindow();
    openResource('metal');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    api.get.mockRejectedValueOnce(new Error('Resource offline'));
    await domain.load();
    expect(root.querySelector('[role="alert"]').textContent).toBe('Resource offline');
    expect(root.textContent).toContain('Letzter bestätigter Stand');
    expect(root.querySelector('[data-resource-detail] button').disabled).toBe(true);
    await domain.load();
    expect(root.querySelector('[data-resource-detail] button').disabled).toBe(false);
  });
  it('does not focus stale details or enable handoff while reloading a previously opened resource view', async () => {
    const { root, controls, openResource } = mountResourceWindow();
    await domain.load();
    const outside = document.createElement('button');
    controls.append(outside);
    outside.focus();
    let finishRead;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    openResource('metal');
    expect(domain.getState().loading).toBe(true);
    expect(document.activeElement).toBe(outside);
    expect(root.querySelector('[data-resource-detail] button').disabled).toBe(true);
    finishRead(snapshot());
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    expect(document.activeElement).toBe(root.querySelector('[data-resource-detail] h3'));
    expect(root.querySelector('[data-resource-detail] button').disabled).toBe(false);
  });
  it('clears resource selection on colony changes, generic navigation and explicit reset', async () => {
    const { root, openResource, controls } = mountResourceWindow();
    openResource('metal');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    session.selectColony(2);
    await vi.waitFor(() => expect(domain.getState().data.snapshot.colony.id).toBe(2));
    expect(root.querySelector('[data-resource-detail]')).toBeNull();
    openResource('food');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const requested = vi.fn();
    session.events.on('market:open-requested', requested);
    root.querySelector('[data-resource-detail] button').click();
    expect(requested).toHaveBeenCalledExactlyOnceWith({ colonyId: 2, goodType: 'food' });
    const generic = document.createElement('button');
    generic.dataset.gameEconomy = '';
    controls.append(generic);
    generic.click();
    expect(root.querySelector('[data-resource-detail]')).toBeNull();
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    root.querySelector('tr[data-good="food"] button').click();
    root.querySelector('[data-resource-detail] button:last-child').click();
    expect(root.querySelector('[data-resource-detail]')).toBeNull();
    expect(root.querySelector('tr[aria-current]')).toBeNull();
  });
  it('does not steal focus on later snapshots or respond to resource clicks after logout', async () => {
    const { openResource, controls, wm } = mountResourceWindow();
    const trigger = openResource('food');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const outside = document.createElement('button');
    controls.append(outside);
    outside.focus();
    await domain.load();
    expect(document.activeElement).toBe(outside);
    const before = wm.open.mock.calls.length;
    unmountWindow();
    unmountWindow = null;
    trigger.click();
    expect(wm.open).toHaveBeenCalledTimes(before);
    expect(wm.close).toHaveBeenCalledWith('economy');
    expect(wm.register).toHaveBeenLastCalledWith('economy', { onRender: null });
  });
});
