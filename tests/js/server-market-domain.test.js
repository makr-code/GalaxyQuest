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
const order = () => ({ good_type: 'metal', quantity: '2.5' });

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
  function mount() {
    root = document.createElement('div');
    document.body.append(root);
    wm = { body: () => root, register: vi.fn(), open: vi.fn(), close: vi.fn(), isOpen: () => true };
    unmount = mountMarketWindow({ session, domain, wm });
    wm.register.mock.calls[0][1].onRender();
  }
  const quantity = () => root.querySelector('[aria-label="Handelsmenge"]');
  const fill = (value) => { quantity().value = value; quantity().dispatchEvent(new Event('input')); };
  const submit = (action) => root.querySelector('form').dispatchEvent(new SubmitEvent('submit',
    { cancelable: true, submitter: root.querySelector(`button[value="${action}"]`) }));
  it('reads local prices before stock, includes account history and never trades while opening', async () => {
    await domain.load();
    expect(api.get.mock.calls.map(([url]) => url)).toEqual([
      'api/market.php?action=get_prices&colony_id=1', 'api/colony_economy.php?action=snapshot&colony_id=1',
      'api/market.php?action=get_history&limit=20',
    ]);
    expect(domain.getState()).toMatchObject({ stale: false, data: { stock: { metal: 10 }, transactions: [{ colony_id: 2 }] } });
    expect(api.post).not.toHaveBeenCalled();
    const copy = domain.getState();
    copy.data.stock.metal = 999;
    expect(domain.getState().data.stock.metal).toBe(10);
  });
  it.each(['buy', 'sell'])('sends exact %s decimal payload and publishes accepted colony mutation', async (action) => {
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    await domain.load();
    await domain.command(action, order());
    expect(api.post).toHaveBeenCalledExactlyOnceWith(`api/market.php?action=${action}`,
      { colony_id: 1, good_type: 'metal', quantity: 2.5 }, { signal: expect.any(AbortSignal) });
    expect(accepted).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'market', allColonies: false });
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
    await expect(domain.command('buy', order())).rejects.toThrow('aktualisieren');
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each([
    { transactions: null }, { transactions: [{ ...history().transactions[0], direction: 'bad' }] },
    { transactions: [{ ...history().transactions[0], net_credits: null }] },
    { transactions: [history().transactions[0], history().transactions[0]] },
  ])('rejects malformed account history: %j', async (invalid) => {
    api.get.mockImplementation(async (url) => url.includes('get_prices') ? prices()
      : url.includes('get_history') ? { ...history(), ...invalid }
        : { success: true, colony: { id: 1 }, economy: { stock: {} } });
    await domain.load();
    expect(domain.getState()).toMatchObject({ stale: true, data: null, error: 'Ungültige Marktdaten vom Server.' });
  });
  it.each([{ id: 2, stock: { metal: 1 } }, { id: 1, stock: null }, { id: 1, stock: { metal: 'bad' } }])('rejects wrong colony or malformed stock: %j', async ({ id, stock }) => {
    api.get.mockImplementation(async (url) => url.includes('get_prices') ? prices()
      : url.includes('get_history') ? history() : { success: true, colony: { id }, economy: { stock } });
    expect(await domain.load()).toBe(false);
    expect(domain.getState().data).toBeNull();
  });
  it('requires fresh reads after accepted trades with failed refresh and never auto-repeats the order', async () => {
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    await domain.command('buy', order());
    expect(domain.getState()).toMatchObject({ stale: true, mutating: false });
    expect(domain.getState().error).toContain('Auftrag bestätigt');
    await expect(domain.command('buy', order())).rejects.toThrow('aktualisieren');
    await domain.refresh();
    expect(domain.getState().stale).toBe(false);
    expect(api.post).toHaveBeenCalledOnce();
    api.get.mockResolvedValueOnce(overview()).mockRejectedValueOnce(new Error('Prices offline'));
    await domain.command('sell', order());
    expect(domain.getState().error).toContain('Auftrag bestätigt, Liste');
    expect(domain.getState().stale).toBe(true);
  });
  it('serializes commands, blocks reads while mutating and keeps pre-mutation snapshots stale', async () => {
    await domain.load();
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.command('buy', order());
    await domain.command('sell', order());
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
    const mutation = domain.command('sell', order());
    const mutationSignal = api.post.mock.calls[0][2].signal;
    domain.shutdown();
    finish({ success: true });
    await mutation;
    expect(mutationSignal.aborted).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
    expect(domain.getState().data).toBeNull();
  });
  it('renders safe server values and account history, keeps rejected drafts and clears accepted quantities before recovery', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x>');
    expect(root.textContent).toContain('Kolonie 2');
    expect(root.textContent).toContain('23.75 Credits abgerechnet');
    expect(root.textContent).toContain('Bestand: 10');
    fill('2.5');
    api.post.mockRejectedValueOnce(new Error('Autarky blocks imports'));
    submit('buy');
    await vi.waitFor(() => expect(root.textContent).toContain('Autarky blocks imports'));
    expect(quantity().value).toBe('2.5');
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    submit('sell');
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
    expect(root.querySelector('button[value="buy"]').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
    const select = root.querySelector('select');
    select.value = 'metal';
    select.dispatchEvent(new Event('change'));
    expect(document.activeElement).toBe(root.querySelector('select'));
    expect(root.querySelector('button[value="buy"]').disabled).toBe(false);
    expect(root.textContent).not.toContain('nicht handelbar');
    expect(quantity().value).toBe('');
    unmount();
    unmount = null;
    const calls = wm.open.mock.calls.length;
    session.events.emit('market:open-requested', { colonyId: 1, goodType: 'metal' });
    expect(wm.open).toHaveBeenCalledTimes(calls);
  });
  it('does not change origin or order during an active trade when a supply link is requested', async () => {
    mount();
    await vi.waitFor(() => expect(quantity()).not.toBeNull());
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fill('2.5');
    submit('buy');
    session.events.emit('market:open-requested', { colonyId: 2, goodType: 'metal' });
    expect(session.getColony().id).toBe(1);
    expect(root.textContent).toContain('Handelsauftrag läuft');
    expect(wm.open).not.toHaveBeenCalled();
    finish({ success: true });
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(false));
    expect(api.post).toHaveBeenCalledOnce();
  });
});
