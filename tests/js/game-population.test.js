import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { createEconomyDomain } from '../../js/engine/runtime/server-economy-domain.js';
import { mountPopulationWindow } from '../../js/ui/game-population.js';

const overview = () => ({ success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home', galaxy: 1, system: 10, position: 3 },
    { id: 2, name: 'Frontier', galaxy: 2, system: 20, position: 4 }] });
const snapshot = (id = 1) => ({
  success: true, colony: { id, max_population: 1000 },
  economy: { settled_at: 1700000000, pending_seconds: 10, stock: { food: 0 },
    satisfaction: 42, employment: 0.75, population_growth_per_hour: -1,
    production: { food: 2 }, consumption: { food: 5 }, shortages: { food: 3, metal: 0 } },
  pop_classes: { colonist: 90, citizen: 10 }, storage: { food: 100 },
  buildings: [], methods: {}, catalog: {},
});
const policy = () => ({ success: true, global_policy: 'free_market',
  taxes: { income: 0.15, production: 0, trade: 0.05 },
  tax_steps: { income: 0.01, production: 0.01, trade: 0.01 },
  subsidies: { agriculture: false, research: false, military: false } });

describe('Canonical population and supply overlay', () => {
  let api;
  let session;
  let domain;
  let wm;
  let root;
  let unmount;
  let data;
  beforeEach(async () => {
    data = snapshot();
    api = { get: vi.fn(async (url) => {
      if (url.includes('overview')) return overview();
      if (url.includes('get_policy')) return policy();
      return { ...data, colony: { ...data.colony,
        id: Number(new URL(url, 'http://localhost').searchParams.get('colony_id')) } };
    }), post: vi.fn(async () => ({ success: true })) };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createEconomyDomain({ api, session });
    root = document.createElement('div');
    document.body.append(root);
    wm = { register: vi.fn(), body: () => root, open: vi.fn(), close: vi.fn(),
      minimize: vi.fn(), isOpen: (kind) => kind === 'population' };
    unmount = mountPopulationWindow({ session, domain, wm });
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  const click = (text) => [...root.querySelectorAll('button')].find((item) => item.textContent === text).click();
  it('reuses the economy domain and displays measured population, workplace occupancy and only positive supply gaps', async () => {
    wm.register.mock.calls[0][1].onRender();
    await vi.waitFor(() => expect(root.querySelector('[data-good="food"]')).not.toBeNull());
    expect(api.get.mock.calls.some(([url]) => url.includes('get_pop_status') || url.includes('get_pop_classes'))).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Bevölkerung: 100');
    expect(root.textContent).toContain(`Kapazität: ${new Intl.NumberFormat().format(1000)}`);
    expect(root.textContent).toContain('Zufriedenheit: 42');
    expect(root.textContent).toContain('Bevölkerungswachstum/h: -1');
    expect(root.textContent).toContain('Arbeitsplatzbesetzung: 75 %');
    expect(root.querySelector('[data-good="food"]').textContent).toContain('Fehlmenge/h: 3 · Bestand: 0 · Produktion/h: 2 · Verbrauch/h: 5');
    expect(root.querySelector('[data-good="metal"]')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
  });
  it('does not replace missing metrics with healthy zeroes or invent a remaining supply duration', async () => {
    data = { ...snapshot(), colony: { id: 1 }, economy: {
      settled_at: 1700000000, pending_seconds: 0, stock: {},
    } };
    await domain.load();
    expect(root.textContent).toContain('Kapazität: —');
    expect(root.textContent).toContain('Zufriedenheit: —');
    expect(root.textContent).toContain('Arbeitsplatzbesetzung: — %');
    expect(root.textContent).toContain('Keine Engpassmesswerte');
    expect(root.textContent).not.toContain('Keine positiven Engpässe');
    data.economy.shortages = {};
    await domain.load();
    expect(root.textContent).toContain('Keine positiven Engpässe');
  });
  it('hands off the selected colony and good without a quantity, trade or policy mutation', async () => {
    await domain.load();
    const requested = vi.fn();
    session.events.on('market:open-requested', requested);
    click('food im Markt öffnen');
    expect(wm.minimize).toHaveBeenCalledExactlyOnceWith('population');
    expect(requested).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, goodType: 'food' });
    expect(api.post).not.toHaveBeenCalled();
    expect(root.querySelector('[data-game-economy]')).not.toBeNull();
  });
  it('retains confirmed data on failed reads and disables shortage actions until recovery', async () => {
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Supply offline'));
    await domain.load();
    expect(root.querySelector('[role="alert"]').textContent).toBe('Supply offline');
    expect(root.textContent).toContain('Letzter bestätigter Stand');
    expect([...root.querySelectorAll('button')].find((entry) => entry.textContent === 'food im Markt öffnen').disabled).toBe(true);
    click('Versorgung aktualisieren');
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).toBeNull());
    expect([...root.querySelectorAll('button')].find((entry) => entry.textContent === 'food im Markt öffnen').disabled).toBe(false);
  });
  it('refreshes an open supply snapshot on accepted trade, not on unrelated colony changes', async () => {
    await domain.load();
    api.get.mockClear();
    session.events.emit('colony:mutation-accepted', { colonyId: 2, domain: 'market', allColonies: false });
    expect(api.get).not.toHaveBeenCalled();
    data.economy.stock.food = 10;
    session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'market', allColonies: false });
    await vi.waitFor(() => expect(root.textContent).toContain('Bestand: 10'));
    expect(api.get.mock.calls.filter(([url]) => url.includes('snapshot'))).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('opens from the resource button or owned colony request, follows selection and tears down on logout', async () => {
    const trigger = document.createElement('button');
    trigger.dataset.resource = 'population';
    document.body.append(trigger);
    trigger.click();
    expect(wm.open).toHaveBeenCalledWith('population');
    trigger.dataset.resource = 'happiness';
    trigger.click();
    expect(wm.open).toHaveBeenCalledTimes(2);
    session.events.emit('population:open-requested', { colonyId: 2 });
    await vi.waitFor(() => expect(root.textContent).toContain('Frontier [2:20:4]'));
    const request = vi.fn();
    session.events.on('market:open-requested', request);
    await vi.waitFor(() => expect(root.querySelector('[data-good="food"]')).not.toBeNull());
    click('food im Markt öffnen');
    expect(request).toHaveBeenCalledExactlyOnceWith({ colonyId: 2, goodType: 'food' });
    const before = wm.open.mock.calls.length;
    unmount();
    unmount = null;
    trigger.click();
    session.events.emit('population:open-requested', { colonyId: 1 });
    expect(wm.open).toHaveBeenCalledTimes(before);
    expect(wm.close).toHaveBeenCalledWith('population');
    expect(wm.register).toHaveBeenLastCalledWith('population', { onRender: null });
  });
  it.each([
    { economy: { ...snapshot().economy, satisfaction: 101 } },
    { economy: { ...snapshot().economy, employment: -1 } },
    { economy: { ...snapshot().economy, employment: 1.01 } },
    { economy: { ...snapshot().economy, population_growth_per_hour: '10' } },
    { pop_classes: { colonist: -1 } }, { pop_classes: { colonist: 1.5 } },
    { colony: { id: 1, max_population: -1 } },
  ])('reports malformed population metrics rather than rendering success: %j', async (invalid) => {
    data = { ...snapshot(), ...invalid };
    await domain.load();
    expect(domain.getState().error).toBe('Invalid economy data returned by the server.');
    expect(root.querySelector('[data-good]')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});
