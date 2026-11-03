import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { mountGameOverview } from '../../js/ui/game-overview.js';

const payload = () => ({
  success: true, user_meta: { dark_matter: '12' }, fleets: [],
  colonies: [
    { id: 1, name: 'Home', galaxy: 1, system: 10, position: 3, metal: '2365.4', energy: -5, population: 1500 },
    { id: 2, name: '<img src=x>', galaxy: 2, system: 20, position: 4, metal: 700, energy: 0 },
  ],
});

describe('Authoritative game session and HUD', () => {
  let api;
  let session;
  beforeEach(() => {
    api = { get: vi.fn(async () => payload()) };
    session = createServerGameSession(api);
  });
  it('loads real state once for concurrent refreshes and publishes usable events', async () => {
    const listener = vi.fn();
    session.events.on('overview:updated', listener);
    await Promise.all([session.refresh(), session.refresh()]);
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith('api/game.php?action=overview', { signal: expect.any(AbortSignal) });
    expect(listener).toHaveBeenCalledOnce();
    expect(session.getColony().metal).toBe('2365.4');
    const copy = session.getState();
    copy.colonies[0].metal = 0;
    expect(session.getColony().metal).toBe('2365.4');
  });
  it('preserves selected colony on refresh and rejects unknown colonies', async () => {
    await session.refresh();
    session.selectColony(2);
    await session.refresh();
    expect(session.getColony().id).toBe(2);
    expect(() => session.selectColony(999)).toThrow('current account');
    api.get.mockResolvedValueOnce({ ...payload(), colonies: [] });
    await session.refresh();
    expect(session.getColony()).toBeNull();
  });
  it('rejects malformed or failed responses instead of fabricating empty data', async () => {
    api.get.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ ...payload(), success: false });
    await expect(session.refresh()).rejects.toThrow('Invalid server overview');
    await expect(session.refresh()).rejects.toThrow('Invalid server overview');
    expect(session.getState()).toBeNull();
    await session.refresh();
    api.get.mockRejectedValueOnce(new Error('Offline'));
    await expect(session.refresh()).rejects.toThrow('Offline');
    expect(session.getColony().id).toBe(1);
  });
  it('aborts in-flight work and ignores late responses after logout', async () => {
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const request = session.refresh();
    const signal = api.get.mock.calls[0][1].signal;
    session.shutdown();
    expect(signal.aborted).toBe(true);
    resolve(payload());
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.getState()).toBeNull();
    await session.refresh();
    expect(session.getColony().id).toBe(1);
  });
  it('renders server values safely, refreshes on demand and cleans up bindings', async () => {
    const html = new DOMParser().parseFromString(fs.readFileSync('index.html', 'utf8'), 'text/html');
    document.body.replaceChildren(
      html.getElementById('topbar-section'), html.getElementById('resource-section'),
    );
    const unmount = mountGameOverview(session, { username: 'Commander' });
    await session.refresh();
    expect(document.getElementById('res-metal').textContent).toBe(new Intl.NumberFormat().format(2365));
    expect(document.getElementById('res-energy').textContent).toBe('-5');
    const select = document.getElementById('game-colony-select');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(session.getColony().id).toBe(2);
    expect(select.querySelector('img')).toBeNull();
    expect(document.getElementById('res-metal').textContent).toBe('700');
    expect(document.getElementById('res-energy').textContent).toBe('0');
    api.get.mockRejectedValueOnce(new Error('Server unavailable'));
    document.getElementById('topbar-title-btn').click();
    await vi.waitFor(() => expect(document.getElementById('game-data-status').textContent).toContain('Server unavailable'));
    expect(document.getElementById('res-metal').textContent).toBe('700');
    unmount();
    expect(select.options.length).toBe(0);
    expect(document.getElementById('res-metal').textContent).toBe('\u2014');
    api.get.mockClear();
    document.getElementById('topbar-title-btn').click();
    expect(api.get).not.toHaveBeenCalled();
  });
});
