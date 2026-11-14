import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarketDomain } from '../../js/engine/runtime/server-market-domain.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { mountMarketWindow } from '../../js/ui/game-market.js';

const overview = () => ({ success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home', galaxy: 1, system: 10, position: 3 },
    { id: 2, name: 'Other', galaxy: 2, system: 20, position: 4 }] });
const prices = () => ({ success: true, prices: [
  { good_type: 'metal', price: 12.5, base_price: 10, supply: 10, demand: 20 },
  { good_type: '<img src=x>', price: 20, base_price: 20, supply: 0, demand: 0 },
] });
const history = () => ({ success: true, transactions: [{ id: 8, colony_id: 2, good_type: 'metal',
  direction: 'sell', quantity: 2.5, price_per_unit: 10, total_credits: 25, net_credits: 23.75,
  trade_tax_rate: 0.05, transacted_at: '2026-11-03 10:00:00' }] });
const order = () => ({ side: 'sell', good_type: 'metal', quantity: '2', limit_price: '10.00' });
const economicRequest = (overrides = {}) => ({ id: 31, colony_id: 1, type: 'supply', good_type: 'metal',
  quantity: 4, price_cents: 1501, total_cents: 6004, expires_at: Math.floor(Date.now() / 1000) + 86400,
  status: 'pending', player_order: null, ...overrides });

describe('Canonical market commands and overlay', () => {
  let api;
  let session;
  let domain;
  let unmount;
  let root;
  let wm;
  beforeEach(async () => {
    api = {
      get: vi.fn(async (url) => {
        if (url.includes('overview')) return overview();
        if (url.includes('get_prices')) return prices();
        if (url.includes('get_history')) return history();
        if (url.includes('list_orders')) return { success: true, orders: [] };
        return { success: true, colony: { id: Number(new URL(url, 'http://localhost').searchParams.get('colony_id')) },
          economy: { stock: { metal: 10 } } };
      }),
      post: vi.fn(async () => ({ success: true })),
    };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createMarketDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  function mount(tradeTransports) {
    root = document.createElement('div');
    document.body.append(root);
    wm = { body: () => root, register: vi.fn(), open: vi.fn(), close: vi.fn(), isOpen: () => true };
    unmount = mountMarketWindow({ session, domain, wm: attachWindowWidgets(wm), tradeTransports });
    wm.register.mock.calls[0][1].onRender();
  }
  const quantity = () => root.querySelector('[aria-label="NPC-Auftragsmenge"]');
  const fill = (value) => { quantity().value = value; quantity().dispatchEvent(new Event('input')); };
  const submit = () => root.querySelector('[aria-label="NPC-Auftrag erstellen"]')
    .dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
  const limit = (value) => {
    const input = root.querySelector('[aria-label="NPC-Limitpreis"]');
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  function serveRequests(requests, now = Math.floor(Date.now() / 1000)) {
    const get = api.get.getMockImplementation();
    api.get.mockImplementation((url, options) => url.includes('list_orders')
      ? Promise.resolve({ success: true, orders: [], requests, now_unix: now }) : get(url, options));
  }
  it('shows only this colony’s physical deliveries and no NPC fleet controls', async () => {
    const now = Math.floor(Date.now() / 1000);
    const transport = { route_id: 8, fleet_id: 9, source_colony_id: 1, target_colony_id: 2,
      phase: 'outbound', good_type: 'metal', quantity: 3, departure_unix: now - 60, arrival_unix: now - 1 };
    const feed = { getState: () => ({ transports: [transport, { ...transport, route_id: 11,
      phase: 'return', good_type: null, quantity: 0 }, { ...transport, route_id: 10,
      source_colony_id: 3, target_colony_id: 4 }], offset: 0 }), subscribe: () => () => {} };
    mount(feed);
    await vi.waitFor(() => expect(root.querySelector('.game-market-deliveries')).not.toBeNull());
    const deliveries = root.querySelector('.game-market-deliveries');
    expect(deliveries.textContent).toContain('Transport #8');
    expect(deliveries.textContent).toContain('Wartet auf Serverbestätigung');
    expect(deliveries.textContent).toContain('Transport #11 · Rückflug · leer');
    expect(deliveries.textContent).not.toContain('Transport #10');
    expect(deliveries.querySelector('button')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('uses immutable invitation IDs only and blocks acceptance at the exact server deadline', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000);
    try {
      serveRequests([economicRequest({ expires_at: 1000 })], 999);
      await domain.load();
      await domain.command('accept_request', { request_id: 31, quantity: 999, price_cents: 1, colony_id: 2 });
      expect(api.post).toHaveBeenCalledWith('api/market.php?action=accept_request',
        { request_id: 31 }, { signal: expect.any(AbortSignal) });
      serveRequests([economicRequest({ expires_at: 1000 })], 1000);
      await domain.load();
      api.post.mockClear();
      await expect(domain.command('accept_request', { request_id: 31 })).rejects.toThrow('abgelaufen');
      expect(api.post).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it('renders scoped terms safely and only actionable requests receive reservation controls', async () => {
    serveRequests([
      economicRequest({ good_type: '<img src=x>' }),
      economicRequest({ id: 32, status: 'expired' }),
      economicRequest({ id: 33, status: 'declined' }),
      economicRequest({ id: 34, status: 'unavailable' }),
      economicRequest({ id: 35, status: 'accepted', player_order: { id: 71, colony_id: 1, status: 'active', quantity_remaining: 4 } }),
    ]);
    mount();
    await vi.waitFor(() => expect(root.querySelector('.game-market-economic-requests')).not.toBeNull());
    const section = root.querySelector('.game-market-economic-requests');
    expect(section.querySelector('img')).toBeNull();
    expect(section.textContent).toContain('<img src=x>');
    expect(section.textContent).toContain('kostenfreier Verfall');
    expect(section.textContent).toContain('Keine sofortige Lieferung');
    expect(section.textContent).toContain('Bestätigter Auftrag #71');
    expect(section.querySelectorAll('[data-economy-request-action]')).toHaveLength(2);
    expect(api.post).not.toHaveBeenCalled();
    session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'economy', allColonies: true });
    expect([...root.querySelectorAll('[data-economy-request-action]')].every(button => button.disabled)).toBe(true);
  });
  it('shows server unavailability explicitly and requires a fresh read after a failed response', async () => {
    serveRequests([economicRequest()]);
    mount();
    await vi.waitFor(() => expect(root.querySelector('[data-economy-request-action]')).not.toBeNull());
    api.post.mockRejectedValueOnce(new Error('NPC-Auftrag ist nicht mehr verfügbar; es wurde nichts reserviert.'));
    root.querySelector('[data-economy-request-action="accept_request"]').click();
    await vi.waitFor(() => expect(root.textContent).toContain('es wurde nichts reserviert'));
    expect(domain.getState().stale).toBe(true);
    expect([...root.querySelectorAll('[data-economy-request-action]')].every(button => button.disabled)).toBe(true);
  });
  it('distinguishes a purchase and requires explicit maximum credit reservation', async () => {
    serveRequests([economicRequest({ type: 'purchase' })]);
    mount();
    await vi.waitFor(() => expect(root.querySelector('[data-economy-request-action]')).not.toBeNull());
    const section = root.querySelector('.game-market-economic-requests');
    expect(section.textContent).toContain('NPC-Überschuss kaufen');
    expect(section.textContent).toContain('15.01 Credits/Einheit');
    expect(section.textContent).toContain('maximal 60.04 Credits');
    expect(section.textContent).toContain('Bestand wird bei Annahme erneut geprüft');
    expect(section.querySelector('[data-economy-request-action="accept_request"]').textContent).toContain('Credits reservieren');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('disables duplicate clicks while mutating and displays only refreshed confirmed request states', async () => {
    const pending = [economicRequest()];
    serveRequests(pending);
    mount();
    await vi.waitFor(() => expect(root.querySelector('[data-economy-request-action]')).not.toBeNull());
    let resolve;
    api.post.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    root.querySelector('[data-economy-request-action="accept_request"]').click();
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(true));
    expect([...root.querySelectorAll('[data-economy-request-action]')].every(button => button.disabled)).toBe(true);
    pending[0] = economicRequest({ status: 'accepted', player_order: { id: 72, colony_id: 1, status: 'active', quantity_remaining: 4 } });
    resolve({ success: true });
    await vi.waitFor(() => expect(root.textContent).toContain('Bestätigter Auftrag #72'));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-economy-request-action]')).toBeNull();
  });
  it('rejects foreign-colony request payloads rather than enabling their controls', async () => {
    serveRequests([economicRequest({ colony_id: 2 })]);
    expect(await domain.load()).toBe(false);
    expect(domain.getState()).toMatchObject({ stale: true, error: 'Ungültige Marktdaten vom Server.' });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('uses shared trade fields with linked help and retains decimal drafts and focus on read updates', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    const goods = root.querySelector('[aria-label="Handelsgut"]');
    expect(goods.closest('.wm-field')).not.toBeNull();
    expect(root.querySelector(`label[for="${goods.id}"]`).textContent).toBe('Handelsgut');
    const amount = quantity();
    expect(amount.closest('.wm-field')).not.toBeNull();
    expect(document.getElementById(amount.getAttribute('aria-describedby')).textContent).toContain('Ganze Einheiten');
    expect(amount.min).toBe('1');
    expect(amount.step).toBe('1');
    fill('2');
    amount.focus();
    await domain.load();
    expect(quantity().value).toBe('2');
    expect(document.activeElement).toBe(quantity());
    expect(api.post).not.toHaveBeenCalled();
  });
  it('marks a requested unavailable good invalid without assigning generic command failures to quantity', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    session.events.emit('market:open-requested', { colonyId: 1, goodType: 'unavailable_good' });
    const goods = root.querySelector('[aria-label="Handelsgut"]');
    expect(goods.getAttribute('aria-invalid')).toBe('true');
    expect(goods.closest('.wm-field').querySelector('.wm-field-error').textContent).toContain('nicht handelbar');
    expect([...root.querySelectorAll('[data-trade-action]')].every(button => button.disabled)).toBe(true);
    expect(quantity().hasAttribute('aria-invalid')).toBe(false);
    goods.value = 'metal';
    goods.dispatchEvent(new Event('change'));
    expect(root.querySelector('[aria-label="Handelsgut"]').hasAttribute('aria-invalid')).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('reads local prices before stock, includes account history and never trades while opening', async () => {
    await domain.load();
    expect(api.get.mock.calls.map(([url]) => url)).toEqual([
      'api/market.php?action=get_prices&colony_id=1', 'api/colony_economy.php?action=snapshot&colony_id=1',
      'api/market.php?action=get_history&limit=20',
      'api/market.php?action=list_orders&colony_id=1',
    ]);
    expect(domain.getState()).toMatchObject({ stale: false, data: { stock: { metal: 10 }, transactions: [{ colony_id: 2 }] } });
    expect(api.post).not.toHaveBeenCalled();
    const copy = domain.getState();
    copy.data.stock.metal = 999;
    expect(domain.getState().data.stock.metal).toBe(10);
  });
  it('carries active world events from the price read and lists them in the market window', async () => {
    api.get.mockImplementation(async (url) => {
      if (url.includes('get_prices')) {
        return { ...prices(), world_events: [
          { id: 3, event_type: 'supply_shock', label: 'Versorgungsengpass', scope_type: 'system', galaxy: 1,
            system: 10, good_type: 'metal', modifiers: { price: 1.2 }, starts_at: 1, ends_at: 1800000000 },
          { label: 42 },
        ] };
      }
      if (url.includes('get_history')) return history();
      if (url.includes('list_orders')) return { success: true, orders: [] };
      return { success: true, colony: { id: 1 }, economy: { stock: { metal: 10 } } };
    });
    await domain.load();
    expect(domain.getState().data.events).toHaveLength(1);
    mount();
    await vi.waitFor(() => expect(root.querySelector('.game-market-world-events')).not.toBeNull());
    expect(root.querySelector('.game-market-world-events li').textContent).toContain('Versorgungsengpass (System 1:10 · metal)');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('defaults to no world events when the price read omits them', async () => {
    await domain.load();
    expect(domain.getState().data.events).toEqual([]);
  });
  it('creates explicit finite contracts with server-owned prices and separate cancellation payloads', async () => {
    const get = api.get.getMockImplementation();
    const standing = { id: 11, colony_id: 1, good_type: 'metal', side: 'buy', quantity_initial: 4,
      quantity_remaining: 4, limit_price_cents: 1502, escrow_cents: 6008, status: 'active' };
    api.get.mockImplementation((url, options) => url.includes('list_orders')
      ? Promise.resolve({ success: true, orders: [standing] }) : get(url, options));
    await domain.load();
    await domain.command('create_order', { side: 'buy', good_type: 'metal', quantity: '4', limit_price: '15.02' });
    expect(api.post).toHaveBeenLastCalledWith('api/market.php?action=create_order',
      { colony_id: 1, side: 'buy', good_type: 'metal', quantity: 4, limit_price: '15.02' },
      { signal: expect.any(AbortSignal) });
    await domain.command('cancel_order', { order_id: 11, quantity: 999, refund: 999 });
    expect(api.post).toHaveBeenLastCalledWith('api/market.php?action=cancel_order',
      { order_id: 11 }, { signal: expect.any(AbortSignal) });
    await expect(domain.command('cancel_order', { order_id: 999 })).rejects.toThrow('Aktiven eigenen Auftrag');
  });
  it.each([
    { side: 'buy', quantity: 1.5, limit_price: '10.00' },
    { side: 'sell', quantity: 1, limit_price: '10.001' },
    { side: 'buy', quantity: 1000001, limit_price: '10.00' },
    { side: 'buy', quantity: 1000000, limit_price: '1000000' },
    { side: 'automatic', quantity: 1, limit_price: '10.00' },
  ])('rejects invalid standing orders without sending reservation commands: %j', async (value) => {
    await domain.load();
    await expect(domain.command('create_order', { good_type: 'metal', ...value })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('keeps NPC consent disabled by default and exposes reservation errors and stale locks separately', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    const section = () => root.querySelector('.game-market-standing-orders');
    expect(section().textContent).toContain('Automatischer Handel ist deaktiviert');
    expect(section().textContent).toContain('Bereits gestartete Lieferungen');
    expect(api.post).not.toHaveBeenCalled();
    const set = (label, value) => {
      const input = root.querySelector(`[aria-label="${label}"]`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('NPC-Auftragsmenge', '4');
    set('NPC-Limitpreis', '15.02');
    api.post.mockRejectedValueOnce(new Error('Nicht genügend Credits für die Reservierung.'));
    root.querySelector('[aria-label="NPC-Auftrag erstellen"]').dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Nicht genügend Credits'));
    expect(root.querySelector('.game-market-ticket')).not.toBeNull();
    session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'economy', allColonies: true });
    expect(section().querySelector('fieldset').disabled).toBe(true);
  });
  it('rejects foreign-colony or malformed standing-order reads instead of silently enabling trades', async () => {
    const get = api.get.getMockImplementation();
    api.get.mockImplementation((url, options) => url.includes('list_orders')
      ? Promise.resolve({ success: true, orders: [{ id: 1, colony_id: 2 }] }) : get(url, options));
    expect(await domain.load()).toBe(false);
    expect(domain.getState()).toMatchObject({ stale: true, data: null, error: 'Ungültige Marktdaten vom Server.' });
  });
  it.each(['buy', 'sell'])('rejects retired %s without sending a command', async (action) => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domain.load();
    await expect(domain.command(action, order())).rejects.toThrow('Soforthandel wurde eingestellt');
    expect(api.post).not.toHaveBeenCalled();
    expect(accepted).not.toHaveBeenCalled();
    expect(domain.getState()).toMatchObject({ stale: false, mutating: false, error: '' });
  });
  it.each([null, { good_type: 'unknown', quantity: 1 }, { good_type: 'metal', quantity: 0 },
    { good_type: 'metal', quantity: -1 }, { good_type: 'metal', quantity: true },
    { good_type: 'metal', quantity: '' }, { good_type: 'metal', quantity: Infinity },
  ])('rejects invalid trading quantities and unavailable goods: %j', async (value) => {
    await domain.load();
    await expect(domain.command('buy', value)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each([
    { success: false }, { prices: null }, { prices: [] },
    { prices: [{ ...prices().prices[0], price: -1 }] },
    { prices: [prices().prices[0], prices().prices[0]] },
  ])('rejects malformed prices while retaining confirmed data: %j', async (invalid) => {
    await domain.load();
    api.get.mockResolvedValueOnce({ ...prices(), ...invalid });
    expect(await domain.load()).toBe(false);
    expect(domain.getState().error).toBe('Ungültige Marktdaten vom Server.');
    expect(domain.getState().data.stock.metal).toBe(10);
    await expect(domain.command('create_order', order())).rejects.toThrow('aktualisieren');
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each([
    { transactions: null }, { transactions: [{ ...history().transactions[0], direction: 'bad' }] },
    { transactions: [{ ...history().transactions[0], net_credits: null }] },
    { transactions: [history().transactions[0], history().transactions[0]] },
  ])('rejects malformed account history: %j', async (invalid) => {
    api.get.mockImplementation(async (url) => url.includes('get_prices') ? prices()
      : url.includes('get_history') ? { ...history(), ...invalid }
        : url.includes('list_orders') ? { success: true, orders: [] }
        : { success: true, colony: { id: 1 }, economy: { stock: {} } });
    await domain.load();
    expect(domain.getState()).toMatchObject({ stale: true, data: null, error: 'Ungültige Marktdaten vom Server.' });
  });
  it.each([{ id: 2, stock: { metal: 1 } }, { id: 1, stock: null }, { id: 1, stock: { metal: 'bad' } }])('rejects wrong colony or malformed stock: %j', async ({ id, stock }) => {
    api.get.mockImplementation(async (url) => url.includes('get_prices') ? prices()
      : url.includes('get_history') ? history() : url.includes('list_orders') ? { success: true, orders: [] }
        : { success: true, colony: { id }, economy: { stock } });
    expect(await domain.load()).toBe(false);
    expect(domain.getState().data).toBeNull();
  });
  it('requires fresh reads after accepted trades with failed refresh and never auto-repeats the order', async () => {
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    await domain.command('create_order', order());
    expect(domain.getState()).toMatchObject({ stale: true, mutating: false });
    expect(domain.getState().error).toContain('Auftrag bestätigt');
    await expect(domain.command('create_order', order())).rejects.toThrow('aktualisieren');
    await domain.refresh();
    expect(domain.getState().stale).toBe(false);
    expect(api.post).toHaveBeenCalledOnce();
    api.get.mockResolvedValueOnce(overview()).mockRejectedValueOnce(new Error('Prices offline'));
    await domain.command('create_order', order());
    expect(domain.getState().error).toContain('Auftrag bestätigt, Liste');
    expect(domain.getState().stale).toBe(true);
  });
  it('serializes commands, blocks reads while mutating and keeps pre-mutation snapshots stale', async () => {
    await domain.load();
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.command('create_order', order());
    await domain.command('create_order', order());
    const calls = api.get.mock.calls.length;
    await domain.load();
    await domain.refresh();
    expect(api.get).toHaveBeenCalledTimes(calls);
    finish({ success: true });
    await pending;
    expect(api.post).toHaveBeenCalledOnce();
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const read = domain.load();
    session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'economy', allColonies: true });
    finish(prices());
    await read;
    expect(domain.getState().stale).toBe(true);
    await domain.load();
    expect(domain.getState().stale).toBe(false);
  });
  it('discards obsolete colony reads and late logout mutation responses', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.load();
    const signal = api.get.mock.calls[0][1].signal;
    session.selectColony(2);
    await domain.load();
    finish(prices());
    await pending;
    expect(signal.aborted).toBe(true);
    expect(domain.getState().colonyId).toBe(2);
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const mutation = domain.command('create_order', order());
    const mutationSignal = api.post.mock.calls[0][2].signal;
    domain.shutdown();
    finish({ success: true });
    await mutation;
    expect(mutationSignal.aborted).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
    expect(domain.getState().data).toBeNull();
  });
  it('groups the order ticket separately from goods and locks both sections on stale snapshots', async () => {
    mount();
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    expect(root.querySelector('.game-market-header h2 svg')).not.toBeNull();
    const catalogue = root.querySelector('.game-market-catalogue');
    const ticket = root.querySelector('.game-market-ticket');
    expect(catalogue.querySelector('legend').textContent).toBe('Warenauswahl');
    expect(ticket.querySelector('legend').textContent).toBe('Unverbindliche Marktübersicht');
    expect(catalogue.querySelector('.game-market-good')).not.toBeNull();
    expect(ticket.querySelector('.game-market-good')).toBeNull();
    const goods = ticket.querySelector('[aria-label="Handelsgut"]');
    expect(ticket.querySelector(`label[for="${goods.id}"]`).textContent).toBe('Handelsgut');
    expect(root.querySelectorAll('[data-trade-action]')).toHaveLength(0);
    expect(root.querySelector('[aria-label="NPC-Auftrag erstellen"]')).not.toBeNull();
    expect(root.querySelector('.game-market-help').open).toBe(false);
    expect(ticket.textContent).toContain('garantieren weder Angebot noch Lieferung');
    expect(catalogue.disabled).toBe(false);
    expect(ticket.disabled).toBe(false);
    api.get.mockRejectedValueOnce(new Error('Market unavailable'));
    await domain.load();
    expect(root.querySelector('.game-market-catalogue').disabled).toBe(true);
    expect(root.querySelector('.game-market-ticket').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('filters only loaded history while retaining trade drafts, focus and expanded settlement details', async () => {
    const get = api.get.getMockImplementation();
    api.get.mockImplementation(async (url, options) => url.includes('get_history')
      ? { success: true, transactions: [
        history().transactions[0],
        { ...history().transactions[0], id: 9, colony_id: 1, good_type: 'steel_alloy', direction: 'buy' },
        { ...history().transactions[0], id: 10, good_type: '<img src=x>', direction: 'buy' },
      ] } : get(url, options));
    mount();
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    api.get.mockClear();
    fill('3.25');
    const form = root.querySelector('form');
    const goods = root.querySelector('[aria-label="Handelsgut"]');
    const search = () => root.querySelector('[aria-label="Handelshistorie durchsuchen"]');
    const direction = () => root.querySelector('[aria-label="Handelsrichtung"]');
    const result = () => root.querySelector('[aria-label="Historientreffer"]').textContent;
    const reset = () => [...root.querySelectorAll('button')].find((item) => item.textContent === 'Historienfilter zurücksetzen');
    const entries = () => [...root.querySelectorAll('.game-market-history tbody tr[data-transaction-id]')];
    const setSearch = (value) => {
      search().value = value;
      search().dispatchEvent(new Event('input'));
    };
    const details = entries()[1].querySelector('details');
    details.open = true;
    search().focus();
    setSearch(' STEEL_ALLOY ');
    expect(result()).toBe('1 von 3 geladenen Kontotransaktionen angezeigt (höchstens letzte 20).');
    expect(entries().map((item) => item.hidden)).toEqual([true, false, true]);
    expect(details.open).toBe(true);
    expect(search().closest('form')).toBeNull();
    expect(document.activeElement).toBe(search());
    setSearch('steel alloy');
    expect(entries()[1].hidden).toBe(false);
    direction().value = 'sell';
    direction().dispatchEvent(new Event('change'));
    expect(result()).toContain('0 von 3');
    expect(entries()[1].querySelector('details').open).toBe(true);
    expect(root.textContent).toContain('Keine passenden Transaktionen unter den letzten 20');
    expect(details.open).toBe(true);
    expect(root.querySelector('form')).toBe(form);
    expect(quantity().value).toBe('3.25');
    expect(goods.value).toBe('metal');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    await domain.refresh();
    expect(search().value).toBe('steel alloy');
    expect(direction().value).toBe('sell');
    expect(entries()[1].querySelector('details').open).toBe(true);
    expect(result()).toContain('0 von 3');
    reset().click();
    expect(document.activeElement).toBe(search());
    expect(reset().disabled).toBe(true);
    expect(entries().every((item) => !item.hidden)).toBe(true);
    direction().value = 'buy';
    direction().dispatchEvent(new Event('change'));
    expect(entries().map((item) => item.hidden)).toEqual([true, false, false]);
    expect(result()).toContain('2 von 3');
    setSearch('<img');
    expect(result()).toContain('1 von 3');
    expect(root.querySelector('img')).toBeNull();
    const detachedSearch = search();
    const detachedResult = root.querySelector('[aria-label="Historientreffer"]');
    unmount();
    detachedSearch.value = 'absent';
    detachedSearch.dispatchEvent(new Event('input'));
    expect(detachedResult.textContent).toContain('1 von 3');
    expect(root.querySelector('.wm-window-frame')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('sorts raw history numbers and server times, preserves row identity and restores sorting across refresh without trading', async () => {
    const get = api.get.getMockImplementation();
    api.get.mockImplementation(async (url, options) => url.includes('get_history')
      ? { success: true, transactions: [
        { ...history().transactions[0], quantity: '10', net_credits: '100', transacted_at: '2026-11-03 12:00:00' },
        { ...history().transactions[0], id: 9, quantity: '2.5', net_credits: '9', transacted_at: '2026-11-03 09:00:00' },
        { ...history().transactions[0], id: 10, quantity: '0.5', net_credits: '20', transacted_at: '2026-11-03 11:00:00' },
      ] } : get(url, options));
    mount();
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    api.get.mockClear();
    fill('3.25');
    const form = root.querySelector('form');
    const table = () => root.querySelector('.game-market-history');
    const rows = () => [...table().querySelectorAll('tbody tr[data-transaction-id]')];
    const ids = () => rows().map(row => row.dataset.transactionId);
    const sort = index => table().querySelectorAll('thead th button')[index].click();
    const details = rows()[0].querySelector('details');
    details.open = true;
    sort(2);
    expect(ids()).toEqual(['10', '9', '8']);
    expect(rows()[2].querySelector('details')).toBe(details);
    sort(3);
    expect(ids()).toEqual(['9', '10', '8']);
    sort(5);
    expect(ids()).toEqual(['9', '10', '8']);
    sort(5);
    expect(ids()).toEqual(['8', '10', '9']);
    const search = table().querySelector('input');
    search.value = '2026-11-03 12:00:00';
    search.dispatchEvent(new Event('input'));
    expect(rows().filter(row => !row.hidden).map(row => row.dataset.transactionId)).toEqual(['8']);
    expect(root.querySelector('form')).toBe(form);
    expect(quantity().value).toBe('3.25');
    expect(api.get).not.toHaveBeenCalled();
    await domain.refresh();
    expect(ids()).toEqual(['8', '10', '9']);
    expect(rows()[0].querySelector('details').open).toBe(true);
    expect(table().querySelector('input').value).toBe('2026-11-03 12:00:00');
    expect(table().querySelectorAll('thead th')[5].getAttribute('aria-sort')).toBe('descending');
    table().querySelector('.wm-table-tools > button').click();
    expect(ids()).toEqual(['8', '9', '10']);
    expect(rows().every(row => !row.hidden)).toBe(true);
    expect(quantity().value).toBe('3.25');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('renders safe server values and account history, keeps rejected drafts and clears accepted quantities before recovery', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x>');
    expect(root.textContent).toContain('Kolonie 2');
    expect(root.textContent).toContain('23.75 Credits abgerechnet');
    expect(root.textContent).toContain('Bestand: 10');
    expect(root.querySelector('.game-market-summary h3 svg')).not.toBeNull();
    expect(root.querySelectorAll('.game-market-metric')).toHaveLength(2);
    expect(root.querySelector('[data-measure="supply"] .game-market-balance-track span').style.width).toBe('50%');
    expect(root.querySelector('[data-measure="demand"] .game-market-balance-track span').style.width).toBe('100%');
    expect(root.querySelector('.game-market-history tbody tr').dataset.direction).toBe('sell');
    expect(root.querySelector('.game-market-history details').open).toBe(false);
    expect(root.querySelector('.game-market-history details').textContent).toContain('Handelssteuer 5%');
    expect(root.querySelector('[data-trade-action]')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    fill('2');
    limit('10');
    api.post.mockRejectedValueOnce(new Error('Autarky blocks imports'));
    submit();
    await vi.waitFor(() => expect(root.textContent).toContain('Autarky blocks imports'));
    expect(quantity().value).toBe('2');
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    submit();
    await vi.waitFor(() => expect(root.textContent).toContain('Auftrag bestätigt'));
    expect(quantity().value).toBe('');
    expect(root.querySelector('fieldset').disabled).toBe(true);
    [...root.querySelectorAll('button')].find((item) => item.textContent === 'Markt aktualisieren').click();
    await vi.waitFor(() => expect(root.querySelector('fieldset').disabled).toBe(false));
    fill('8');
    session.selectColony(2);
    await vi.waitFor(() => expect(quantity()?.value).toBe(''));
    expect(root.textContent).toContain('Other [2:20:4]');
    const open = document.createElement('button');
    open.dataset.gameMarket = '';
    document.body.append(open);
    open.click();
    expect(wm.open).toHaveBeenCalledExactlyOnceWith('trade');
    unmount();
    unmount = null;
    open.click();
    expect(wm.open).toHaveBeenCalledOnce();
    expect(wm.close).toHaveBeenCalledWith('trade');
    expect(wm.register).toHaveBeenLastCalledWith('trade', { onRender: null });
  });
  it('opens requested colony goods with an empty quantity and rejects unavailable goods without substitution', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    fill('99');
    session.events.emit('market:open-requested', { colonyId: 2, goodType: 'metal' });
    await vi.waitFor(() => expect(quantity()?.value).toBe(''));
    expect(session.getColony().id).toBe(2);
    expect(root.querySelector('select').value).toBe('metal');
    expect(wm.open).toHaveBeenCalledWith('trade');
    session.events.emit('market:open-requested', { colonyId: 2, goodType: 'unlisted_good' });
    expect(root.querySelector('select').value).toBe('unlisted_good');
    expect(root.textContent).toContain('nicht handelbar');
    expect(root.querySelector('[data-trade-action]')).toBeNull();
    expect(root.querySelector('.game-market-summary').textContent).toBe('Kein bestätigter Marktpreis für dieses Gut.');
    expect(root.querySelector('.game-market-balance')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    const select = root.querySelector('select');
    select.value = 'metal';
    select.dispatchEvent(new Event('change'));
    expect(document.activeElement).toBe(root.querySelector('select'));
    expect(root.querySelector('[data-trade-action]')).toBeNull();
    expect(root.textContent).not.toContain('nicht handelbar');
    expect(quantity().value).toBe('');
    unmount();
    unmount = null;
    const calls = wm.open.mock.calls.length;
    session.events.emit('market:open-requested', { colonyId: 1, goodType: 'metal' });
    expect(wm.open).toHaveBeenCalledTimes(calls);
  });
  it('updates visual goods safely, preserves quantity and displays unknown stock and zero market activity', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    fill('3.5');
    const select = root.querySelector('select');
    select.value = '<img src=x>';
    select.dispatchEvent(new Event('change'));
    expect(root.querySelector('.game-market-summary h3').textContent).toBe('<img src=x>');
    expect(root.querySelector('img, script')).toBeNull();
    expect(root.querySelector('.game-market-metric').textContent).toBe('Bestand: Nicht verfügbar');
    expect([...root.querySelectorAll('.game-market-balance-track span')].map(e => e.style.width)).toEqual(['0%', '0%']);
    expect(quantity().value).toBe('3.5');
    expect(document.activeElement).toBe(root.querySelector('select'));
    expect(api.post).not.toHaveBeenCalled();
  });
  it('does not change origin or order during an active trade when a supply link is requested', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fill('2');
    limit('10');
    submit();
    session.events.emit('market:open-requested', { colonyId: 2, goodType: 'metal' });
    expect(session.getColony().id).toBe(1);
    expect(root.textContent).toContain('Handelsauftrag läuft');
    expect(wm.open).not.toHaveBeenCalled();
    finish({ success: true });
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(false));
    expect(api.post).toHaveBeenCalledOnce();
  });
  it('searches goods without changing selection, quantity, focus or making requests', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    fill('4.5');
    let search = root.querySelector('[aria-label="Waren suchen"]');
    expect(search.closest('form')).toBeNull();
    const reads = api.get.mock.calls.length;
    search.focus();
    search.value = ' IMG ';
    search.dispatchEvent(new Event('input'));
    const visible = () => [...root.querySelectorAll('.game-market-good')].filter(e => !e.hidden);
    expect(visible()).toHaveLength(1);
    expect(root.textContent).toContain('1 von 2 Waren angezeigt.');
    expect(document.activeElement).toBe(search);
    expect(root.querySelector('select').value).toBe('metal');
    expect(quantity().value).toBe('4.5');
    expect(root.querySelector('.game-market-summary h3').textContent).toBe('metal');
    search.value = 'not loaded';
    search.dispatchEvent(new Event('input'));
    expect(visible()).toHaveLength(0);
    expect(root.textContent).toContain('Die Handelsauswahl bleibt unverändert.');
    expect(api.get).toHaveBeenCalledTimes(reads);
    expect(api.post).not.toHaveBeenCalled();
    await domain.load();
    search = root.querySelector('[aria-label="Waren suchen"]');
    expect(search.value).toBe('not loaded');
    [...root.querySelectorAll('button')].find(e => e.textContent === 'Warensuche zurücksetzen').click();
    expect(visible()).toHaveLength(2);
    expect(document.activeElement).toBe(search);
    search.value = 'not loaded';
    search.dispatchEvent(new Event('input'));
    session.events.emit('market:open-requested', { colonyId: 1, goodType: 'metal' });
    expect(root.querySelector('[aria-label="Waren suchen"]').value).toBe('');
    expect(visible()).toHaveLength(2);
    const detachedSearch = root.querySelector('[aria-label="Waren suchen"]');
    const detachedCatalogue = root.querySelector('.game-market-goods');
    unmount();
    unmount = null;
    detachedSearch.value = 'absent';
    detachedSearch.dispatchEvent(new Event('input'));
    expect([...detachedCatalogue.children].filter(tile => !tile.hidden)).toHaveLength(2);
    expect(root.querySelector('.wm-window-frame')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('matches multiword goods through underscore or spaced search terms', async () => {
    api.get.mockImplementation(async url => url.includes('overview') ? overview()
      : url.includes('get_prices') ? { success: true, prices: [{ ...prices().prices[0], good_type: 'steel_alloy' }] }
        : url.includes('get_history') ? history()
          : url.includes('list_orders') ? { success: true, orders: [] }
          : { success: true, colony: { id: 1 }, economy: { stock: {} } });
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    const search = root.querySelector('[aria-label="Waren suchen"]');
    for (const query of ['STEEL_ALLOY', 'steel alloy']) {
      search.value = query;
      search.dispatchEvent(new Event('input'));
      expect(root.querySelector('.game-market-good').hidden).toBe(false);
    }
    expect(api.post).not.toHaveBeenCalled();
  });
  it('selects goods through safe price tiles without reads or trades and preserves the order quantity', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    const calls = api.get.mock.calls.length;
    expect(root.querySelectorAll('.game-market-good')).toHaveLength(2);
    expect(root.querySelector('.game-market-good[aria-pressed="true"]').textContent).toBe('metalRichtpreis 12.5 Credits/Einheit');
    fill('7.5');
    root.querySelector('[data-market-good-index="1"]').click();
    const selected = root.querySelector('[data-market-good-index="1"]');
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.textContent).toBe('<img src=x>Richtpreis 20 Credits/Einheit');
    expect(document.activeElement).toBe(selected);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('select').value).toBe('<img src=x>');
    expect(quantity().value).toBe('7.5');
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(api.post).not.toHaveBeenCalled();
    const select = root.querySelector('select');
    select.value = 'metal';
    select.dispatchEvent(new Event('change'));
    expect(root.querySelector('[data-market-good-index="0"]').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-market-good-index="1"]').getAttribute('aria-pressed')).toBe('false');
    const detached = root.querySelector('[data-market-good-index="1"]');
    api.get.mockRejectedValueOnce(new Error('Market offline'));
    await domain.load();
    expect(root.querySelector('fieldset').disabled).toBe(true);
    detached.click();
    expect(root.querySelector('select').value).toBe('metal');
    expect(api.post).not.toHaveBeenCalled();
    await domain.load();
    const tile = root.querySelector('[data-market-good-index="1"]');
    const detachedGoods = root.querySelector('select');
    unmount();
    unmount = null;
    tile.click();
    expect(detachedGoods.value).toBe('metal');
    expect(root.querySelector('.wm-window-frame')).toBeNull();
  });
});
import { attachWindowWidgets } from './helpers/window-widget-fixture.js';
