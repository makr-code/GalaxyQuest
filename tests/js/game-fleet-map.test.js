import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFleetMap } from '../../js/ui/game-fleet-map.js';
import { createFleetDomain } from '../../js/engine/runtime/server-fleet-domain.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';

const fleet = () => ({
  id: 7, mission: 'transport', origin_colony_id: 1,
  origin_galaxy: 1, origin_system: 10, origin_position: 3,
  target_galaxy: 2, target_system: 20, target_position: 4,
  fleet_label: '<img src=x>', ships: { small_cargo: 2 },
  cargo_metal: 100, cargo_crystal: 0, cargo_deuterium: 0, returning: 0,
  departure_time: '2000-01-01 10:00:00', arrival_time: '2000-01-01 11:00:00',
});
const point = (fleetIds = [7]) => ({ key: '1:10:3', galaxy: 1, system: 10, position: 3,
  fleetIds, x: 200, y: 200 });

describe('Canonical fleet endpoints on the shared map', () => {
  let session;
  let domain;
  let api;
  let galaxy;
  let project;
  let getFleets;
  let stopProjection;
  let unmount;
  let current;
  let failOverview;
  const context = () => document.getElementById('game-fleet-context');
  const badge = () => document.querySelector('#game-fleet-markers button');
  const click = (label) => [...context().querySelectorAll('button')].find((item) => item.textContent === label).click();
  beforeEach(async () => {
    current = [fleet()];
    failOverview = false;
    document.body.innerHTML = '<section id="wm-galaxy-section"><canvas id="starfield" tabindex="0"></canvas></section>';
    const stage = document.getElementById('wm-galaxy-section');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
    api = {
      get: vi.fn(async (url) => {
        if (url.includes('overview')) {
          if (failOverview) throw new Error('Overview offline');
          return { success: true, user_meta: {}, colonies: [{ id: 1 }], fleets: [] };
        }
        return { success: true, fleets: structuredClone(current) };
      }),
      post: vi.fn(async (url) => {
        current = url.endsWith('check') ? [] : current.map((item) => ({ ...item, returning: 1 }));
        return { success: true };
      }),
    };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createFleetDomain({ api, session });
    galaxy = { navigate: vi.fn() };
    stopProjection = vi.fn();
    const renderer = { observeFleetEndpoints: vi.fn((get, callback) => {
      getFleets = get;
      project = callback;
      return stopProjection;
    }) };
    unmount = mountFleetMap({ domain, galaxy, renderer, session, stage });
    await vi.waitFor(() => expect(domain.getState().fleets).toHaveLength(1));
    project([point()]);
  });
  afterEach(() => {
    unmount?.();
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  it('reads canonical missions once and selects safe endpoint details without processing overdue arrivals', () => {
    expect(api.get.mock.calls.filter(([url]) => url.includes('fleet.php'))).toHaveLength(1);
    expect(getFleets()).toEqual([fleet()]);
    expect(badge().textContent).toBe('F 1');
    badge().click();
    expect(context().hidden).toBe(false);
    expect(context().textContent).toContain('<img src=x>');
    expect(context().querySelector('img')).toBeNull();
    expect(context().textContent).toContain('2000-01-01 11:00:00 (Serverzeit)');
    expect(context().textContent).toContain('2 small cargo');
    expect(context().textContent).toContain('100 Metall');
    expect(api.post).not.toHaveBeenCalled();
    expect(document.activeElement.textContent).toBe('Flottenauswahl schließen');
  });
  it('updates projected badges without replacing focused buttons and groups missions at one endpoint', async () => {
    current.push({ ...fleet(), id: 8 });
    await domain.load();
    project([point([7, 8])]);
    const original = badge();
    original.focus();
    project([{ ...point([7, 8]), x: 250, y: 220 }]);
    expect(badge()).toBe(original);
    expect(document.activeElement).toBe(original);
    expect(original.style.left).toBe('268px');
    expect(original.textContent).toBe('F 2');
    original.click();
    expect(context().querySelectorAll('article')).toHaveLength(2);
    current.push({ ...fleet(), id: 9 });
    await domain.load();
    project([point([7, 8, 9])]);
    expect(context().querySelectorAll('article')).toHaveLength(3);
  });
  it('returns keyboard focus to the canvas when an unselected endpoint badge disappears', () => {
    const marker = badge();
    marker.focus();
    project([]);
    expect(badge()).toBeNull();
    expect(document.activeElement.id).toBe('starfield');
  });
  it('recalls only explicitly and locks accepted commands until failed refresh is recovered', async () => {
    badge().click();
    failOverview = true;
    click('Flotte zurückrufen');
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(false));
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=recall',
      { fleet_id: 7 }, { signal: expect.any(AbortSignal) });
    expect(context().textContent).toContain('Befehl bestätigt');
    expect(document.getElementById('game-fleet-map-status').hidden).toBe(true);
    expect([...context().querySelectorAll('button')].find((item) => item.textContent === 'Flotte zurückrufen').disabled).toBe(true);
    failOverview = false;
    click('Flotten aktualisieren');
    await vi.waitFor(() => expect(context().textContent).toContain('Rückflug'));
    expect(api.post).toHaveBeenCalledOnce();
    click('Fällige Ankünfte verarbeiten');
    await vi.waitFor(() => expect(domain.getState().fleets).toEqual([]));
    project([]);
    expect(context().hidden).toBe(true);
    expect(badge()).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(2);
  });
  it('moves focus to the stable close action while recall is pending and retains it after refresh', async () => {
    badge().click();
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    context().querySelector('[data-fleet-action="recall-7"]').click();
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(true));
    expect(document.activeElement.dataset.fleetAction).toBe('close');
    expect(context().querySelector('[data-fleet-action="recall-7"]').disabled).toBe(true);
    finish({ success: true });
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(false));
    expect(document.activeElement.dataset.fleetAction).toBe('close');
    expect(context().hidden).toBe(false);
  });
  it('exposes failed reads and retry without inventing markers', async () => {
    api.get.mockRejectedValueOnce(new Error('Fleet offline'));
    await domain.load();
    const status = document.getElementById('game-fleet-map-status');
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('Fleet offline');
    status.querySelector('button').click();
    await vi.waitFor(() => expect(status.hidden).toBe(true));
    expect(api.post).not.toHaveBeenCalled();
  });
  it('removes the shared frame subscription while no missions exist and resumes it on a fresh list', async () => {
    current = [];
    await domain.load();
    expect(stopProjection).toHaveBeenCalledOnce();
    expect(badge()).toBeNull();
    await domain.load();
    expect(stopProjection).toHaveBeenCalledOnce();
    current = [fleet()];
    await domain.load();
    project([point()]);
    expect(badge()).not.toBeNull();
    unmount();
    unmount = null;
    expect(stopProjection).toHaveBeenCalledTimes(2);
  });
  it('navigates canonical endpoints, clears departed selections and cancels selection with Escape', () => {
    badge().click();
    click('Ziel im Spielfeld');
    expect(galaxy.navigate).toHaveBeenCalledExactlyOnceWith(2, 20);
    expect(context().hidden).toBe(true);
    badge().click();
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    document.getElementById('starfield').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(context().hidden).toBe(true);
    expect(document.activeElement.id).toBe('starfield');
    badge().click();
    project([]);
    expect(context().hidden).toBe(true);
    expect(badge()).toBeNull();
    expect(document.activeElement.id).toBe('starfield');
  });
  it('hides endpoint controls during target picking and tears down subscriptions on logout', () => {
    badge().click();
    session.events.emit('fleet:target-picking', { active: true });
    expect(document.getElementById('game-fleet-markers').hidden).toBe(true);
    expect(context().hidden).toBe(true);
    badge().click();
    expect(context().hidden).toBe(true);
    session.events.emit('fleet:target-picking', { active: false });
    expect(document.getElementById('game-fleet-markers').hidden).toBe(false);
    const old = badge();
    unmount();
    unmount = null;
    expect(stopProjection).toHaveBeenCalledOnce();
    expect(document.querySelector('[id^="game-fleet-"]')).toBeNull();
    old.click();
    project([point()]);
    expect(document.querySelector('[id^="game-fleet-"]')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});
