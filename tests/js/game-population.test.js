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
    unmount = mountPopulationWindow({ session, domain, wm: attachWindowWidgets(wm) });
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  const click = (text) => [...root.querySelectorAll('button')].find((item) => item.textContent === text).click();
  it('searches, filters and sorts class measurements locally without renormalizing shares or replacing the visual distribution', async () => {
    data.pop_classes = { colonist: 90, citizen: 10, specialist_class: 0 };
    await domain.load();
    api.get.mockClear();
    const table = () => root.querySelector('.game-population-class-table');
    const rows = () => [...table().querySelectorAll('tbody tr')].filter(row => !row.querySelector('.wm-table-empty'));
    const visible = () => rows().filter(row => !row.hidden);
    const distribution = root.querySelector('.game-population-distribution');
    const disclosure = root.querySelector('.game-population-class-measurements');
    expect(disclosure.open).toBe(false);
    disclosure.open = true;
    expect(table().querySelectorAll('tbody th[scope="row"]')).toHaveLength(3);
    const search = table().querySelector('input');
    search.focus();
    search.value = 'CITIZEN';
    search.dispatchEvent(new Event('input'));
    expect(visible()).toHaveLength(1);
    expect(visible()[0].children[2].textContent).toBe('10');
    expect(document.activeElement).toBe(search);
    const filter = table().querySelector('select');
    filter.value = 'empty';
    filter.dispatchEvent(new Event('change'));
    expect(visible()).toHaveLength(0);
    expect(table().querySelector('.wm-table-empty').textContent).toContain('Keine Bevölkerungsklassen für diese Suche');
    search.value = 'specialist_class';
    search.dispatchEvent(new Event('input'));
    expect(visible()[0].textContent).toBe('specialist class00');
    table().querySelector('.wm-table-tools > button').click();
    table().querySelectorAll('thead th button')[1].click();
    expect(rows().map(row => row.children[1].textContent)).toEqual(['0', '10', '90']);
    table().querySelectorAll('thead th button')[1].click();
    expect(rows().map(row => row.children[1].textContent)).toEqual(['90', '10', '0']);
    expect(root.querySelector('.game-population-distribution')).toBe(distribution);
    expect(distribution.querySelectorAll('li')).toHaveLength(3);
    expect(api.get).not.toHaveBeenCalled();
    const refreshedSearch = table().querySelector('input');
    refreshedSearch.value = 'citizen';
    refreshedSearch.dispatchEvent(new Event('input'));
    data.pop_classes = { colonist: 180, citizen: 20, specialist_class: 0 };
    await domain.refresh();
    expect(root.querySelector('.game-population-class-measurements').open).toBe(true);
    expect(table().querySelector('input').value).toBe('citizen');
    expect(table().querySelectorAll('thead th')[1].getAttribute('aria-sort')).toBe('descending');
    expect(visible()[0].children[1].textContent).toBe('20');
    expect(visible()[0].children[2].textContent).toBe('10');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('keeps zero-population shares finite and distinguishes no classes from filtered classes', async () => {
    data.pop_classes = { citizen: 0 };
    await domain.load();
    const table = () => root.querySelector('.game-population-class-table');
    expect(table().querySelector('tbody tr').textContent).toBe('citizen00');
    const filter = table().querySelector('select');
    filter.value = 'populated';
    filter.dispatchEvent(new Event('change'));
    expect(table().querySelector('.wm-table-empty').textContent).toContain('Keine Bevölkerungsklassen für diese Suche');
    await domain.refresh();
    expect(table().querySelector('select').value).toBe('populated');
    data.pop_classes = {};
    await domain.refresh();
    expect(table().querySelector('.wm-table-empty').textContent).toBe('Keine Bevölkerungsklassen gemeldet.');
    expect(table().textContent).not.toMatch(/NaN|Infinity/);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('uses shared measured properties and keeps help expanded through updates without issuing commands', async () => {
    await domain.load();
    const measurements = root.querySelector('[data-good="food"] .wm-properties');
    expect(measurements.classList.contains('game-supply-measurements')).toBe(true);
    expect([...measurements.querySelectorAll('.wm-property-row dd')].map(e => e.textContent)).toEqual(['0', '2', '5']);
    root.querySelector('.game-population-help').open = true;
    data.economy.shortages = {};
    await domain.refresh();
    expect(root.querySelector('.game-population-help').open).toBe(true);
    expect(root.querySelector('.game-population-supply .wm-notice').dataset.state).toBe('empty');
    delete data.economy.shortages;
    await domain.refresh();
    expect(root.querySelector('.game-population-supply .wm-notice').dataset.state).toBe('info');
    expect(root.querySelector('.game-population-help').open).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
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
    const gap = root.querySelector('[data-good="food"]');
    expect(gap.querySelector('.game-population-gap').textContent).toBe('Fehlmenge/h: 3');
    expect([...gap.querySelectorAll('dt')].map(e => e.textContent)).toEqual(['Bestand', 'Produktion/h', 'Verbrauch/h']);
    expect([...gap.querySelectorAll('dd')].map(e => e.textContent)).toEqual(['0', '2', '5']);
    expect(root.querySelector('[data-good="metal"]')).toBeNull();
    expect(root.querySelector('input:not([type="search"])')).toBeNull();
    expect(root.querySelector('.game-population-header h2 svg')).not.toBeNull();
    expect(root.querySelector('[aria-label="Koloniegesellschaft"] [aria-label="Bevölkerungskennzahlen"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Koloniegesellschaft"] [aria-label="Bevölkerungsklassen"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Versorgungslage"] [data-good="food"]')).toBe(gap);
    expect(gap.querySelector('button svg')).not.toBeNull();
    expect(root.querySelector('.game-population-help').open).toBe(false);
    expect(root.querySelector('.game-population-footer > [data-game-economy] svg')).not.toBeNull();
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
  it('keeps shortage measurements individually unknown without hiding a confirmed gap', async () => {
    data.economy.stock = {};
    delete data.economy.production;
    await domain.load();
    const gap = root.querySelector('[data-good="food"]');
    expect(gap.querySelector('.game-population-gap strong').textContent).toBe('Fehlmenge/h: 3');
    expect([...gap.querySelectorAll('dd')].map(e => e.textContent)).toEqual(['Nicht verfügbar', 'Nicht verfügbar', '5']);
    expect(gap.querySelector('h4 svg')).not.toBeNull();
    expect(gap.querySelector('.game-population-gap svg').getAttribute('aria-hidden')).toBe('true');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('visualizes measured capacity, satisfaction, occupancy and class shares without changing values', async () => {
    await domain.load();
    const meters = [...root.querySelectorAll('.game-population-metric meter')];
    expect(meters.map((meter) => [meter.value, meter.max])).toEqual([[100, 1000], [42, 100], [0.75, 1]]);
    expect(root.querySelectorAll('.game-population-metric svg')).toHaveLength(4);
    expect(root.querySelector('[data-population-class="colonist"] .game-population-track > span').style.width).toBe('90%');
    expect(root.querySelector('[data-population-class="citizen"]').textContent).toContain('10 %');
    expect(root.querySelector('.game-population-deficit').textContent).toContain('Bevölkerungswachstum/h: -1');
    expect(root.querySelector('.game-population-shortage h4 svg').getAttribute('aria-hidden')).toBe('true');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('retains over-capacity counts and avoids invented meters for unknown metrics or invalid shares at zero population', async () => {
    data.colony.max_population = 50;
    delete data.economy.satisfaction;
    delete data.economy.employment;
    await domain.load();
    expect(root.querySelectorAll('meter')).toHaveLength(1);
    expect(root.querySelector('meter').value).toBe(50);
    expect(root.textContent).toContain('Bevölkerung: 100');
    expect(root.textContent).toContain('Über Bevölkerungskapazität');
    data.pop_classes = { colonist: 0 };
    await domain.load();
    expect(root.querySelector('.game-population-track > span').style.width).toBe('0%');
    expect(root.querySelector('[data-population-class]').textContent).toContain('0 %');
    data.pop_classes = {};
    await domain.load();
    expect(root.textContent).toContain('Keine Bevölkerungsklassen gemeldet.');
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
    expect(root.querySelector('[role="alert"] .wm-notice-message').textContent).toBe('Supply offline');
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
    await vi.waitFor(() => expect(root.querySelector('[data-good="food"] dd').textContent).toBe('10'));
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
import { attachWindowWidgets } from './helpers/window-widget-fixture.js';
