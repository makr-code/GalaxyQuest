import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { createGalaxyDomain } from '../../js/engine/runtime/server-galaxy-domain.js';
import { mountGameGalaxy } from '../../js/ui/game-galaxy.js';
import { createGameGalaxyRenderer } from '../../js/rendering/game-galaxy-renderer.js';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';

const star = { galaxy_index: 1, system_index: 10, name: '<img src=x>', x_ly: 10, y_ly: 15, z_ly: 2 };
const systemPayload = (system = 10) => ({
  success: true, galaxy: 1, system, star_system: { ...star, system_index: system }, server_ts_ms: system,
  visibility: { level: 'own' }, planets: [{ position: 3, player_planet: { id: 1, name: 'Home', position: 3, user_id: 42 } },
    { position: 4, player_planet: { id: 99, name: 'Foreign', user_id: 99 } }],
});

describe('Authoritative galaxy playing field', () => {
  let api;
  let session;
  let domain;
  const cleanups = [];
  beforeEach(async () => {
    document.body.className = 'auth-page';
    document.body.innerHTML = '<header id="topbar-section"></header><div id="resource-section"></div>'
      + '<section id="wm-galaxy-section"><div id="galaxy-bg-wrapper" aria-hidden="true">'
      + '<div id="galaxy-3d-host"><canvas id="starfield"></canvas></div></div></section><button id="topbar-home-btn"></button>';
    window.GQAuthGalaxyBackgroundControl = undefined;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    api = {
      get: vi.fn(async (url) => {
        if (url.includes('game.php')) return { success: true, user_meta: {}, fleets: [],
          colonies: [{ id: 1, name: 'Home', galaxy: 1, system: 10, position: 3 },
            { id: 2, name: 'Other', galaxy: 1, system: 20, position: 2 }] };
        if (url.includes('action=stars')) return { success: true, galaxy: 1, stars: [star] };
        return systemPayload(Number(new URL(url, 'http://localhost').searchParams.get('system')));
      }),
      post: vi.fn(),
    };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createGalaxyDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    domain.shutdown();
    session.shutdown();
    vi.unstubAllGlobals();
  });
  it('uses authenticated canonical read APIs, not auth samples or mutation commands', async () => {
    await domain.home();
    expect(api.get.mock.calls.map(([url]) => url)).toEqual([
      'api/galaxy.php?action=stars&galaxy=1&from=1&max_points=9000',
      'api/galaxy.php?action=system&galaxy=1&system=10&format=json',
    ]);
    expect(domain.getState()).toMatchObject({ galaxy: 1, selected: star, system: { system: 10 }, error: '', loading: false });
    expect(api.post).not.toHaveBeenCalled();
    const copy = domain.getState();
    copy.stars[0].name = 'Mutated';
    expect(domain.getState().stars[0].name).toBe(star.name);
  });
  it('reuses the catalog and adds the actual selected star when sampling omitted it', async () => {
    await domain.home();
    await domain.navigate(1, 25);
    expect(api.get.mock.calls.filter(([url]) => url.includes('action=stars'))).toHaveLength(1);
    expect(domain.getState().stars.map((entry) => entry.system_index)).toEqual([10, 25]);
  });
  it('follows colony selection but does not reload for same-colony HUD refresh', async () => {
    await domain.home();
    await session.refresh();
    expect(api.get.mock.calls.filter(([url]) => url.includes('action=system'))).toHaveLength(1);
    session.selectColony(2);
    await vi.waitFor(() => expect(domain.getState().system?.system).toBe(20));
  });
  it('aborts obsolete navigation and discards late replies and failures', async () => {
    await domain.home();
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const request = domain.navigate(1, 25);
    const signal = api.get.mock.calls.at(-1)[1].signal;
    await domain.navigate(1, 30);
    expect(signal.aborted).toBe(true);
    resolve(systemPayload(25));
    await request;
    expect(domain.getState().system.system).toBe(30);
  });
  it('cancels a pending system navigation when another star is selected', async () => {
    await domain.home();
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const request = domain.navigate(1, 25);
    domain.select(star);
    resolve(systemPayload(25));
    await request;
    expect(domain.getState()).toMatchObject({ selected: star, system: null, loading: false });
  });
  it('clears private data and ignores outstanding replies after shutdown', async () => {
    await domain.home();
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const request = domain.navigate(1, 25);
    domain.shutdown();
    resolve(systemPayload(25));
    await request;
    expect(domain.getState()).toMatchObject({ stars: [], selected: null, system: null, galaxy: null });
  });
  it('surfaces invalid coordinates and malformed API data without fabricating world data', async () => {
    const errorEvent = vi.fn();
    window.addEventListener('gq:game-data-error', errorEvent);
    try {
      await domain.navigate(NaN, -1);
      expect(api.get).not.toHaveBeenCalled();
      expect(domain.getState().error).toContain('koordinaten');
      api.get.mockResolvedValueOnce({ success: true, galaxy: 1, stars: [{ ...star, x_ly: 'bad' }] });
      await domain.overview();
      expect(domain.getState()).toMatchObject({ stars: [], galaxy: null });
      expect(domain.getState().error).toContain('Galaxiedaten');
      expect(errorEvent).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener('gq:game-data-error', errorEvent); }
  });
  it('keeps the existing canvas, displays server errors, retries and only offers owned colony management', async () => {
    const canvas = document.getElementById('starfield');
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(), focusOnStar: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(), setGalaxyFleets: vi.fn(),
      nudgeZoom: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
    renderer.refreshColony = vi.fn();
    renderer.returnTo = vi.fn(async () => true);
    const factory = vi.fn().mockRejectedValueOnce(new Error('GPU unavailable')).mockResolvedValue(renderer);
    const unmount = mountGameGalaxy({ session, domain, createRenderer: factory });
    cleanups.push(unmount);
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(document.getElementById('game-renderer-status').textContent).toBe('GPU unavailable'));
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    [...document.querySelectorAll('button')].find((item) => item.textContent === '3D erneut starten').click();
    await vi.waitFor(() => expect(document.getElementById('game-renderer-status').textContent).toContain('webgpu'));
    await domain.home();
    const rendererOptions = factory.mock.calls.at(-1)[1];
    rendererOptions.onViewChange({ level: 'building', planetPosition: 3 });
    const path = document.getElementById('game-camera-path');
    expect(path.hidden).toBe(false);
    expect(path.querySelector('[aria-current="location"]').dataset.level).toBe('building');
    expect(path.querySelector('[data-level="system"]').title).toContain('<img src=x>');
    expect(path.querySelector('img')).toBeNull();
    let finishNavigation;
    renderer.returnTo.mockImplementationOnce(() => new Promise((resolve) => { finishNavigation = resolve; }));
    path.querySelector('[data-level="system"]').click();
    expect(path.getAttribute('aria-busy')).toBe('true');
    path.querySelector('[data-level="galaxy"]').click();
    await vi.waitFor(() => expect(renderer.returnTo).toHaveBeenCalledExactlyOnceWith('system'));
    finishNavigation(true);
    await vi.waitFor(() => expect(path.getAttribute('aria-busy')).toBe('false'));
    expect(document.activeElement).toBe(canvas);
    rendererOptions.onViewChange({ level: 'planet', planetPosition: 3 });
    expect(path.querySelector('[data-level="colony"]').hidden).toBe(true);
    expect(path.querySelector('[data-level="planet"]').disabled).toBe(true);
    renderer.returnTo.mockRejectedValueOnce(new Error('Reverse transition failed'));
    path.querySelector('[data-level="system"]').click();
    await vi.waitFor(() => expect(document.getElementById('game-renderer-status').textContent).toBe('Reverse transition failed'));
    expect(document.getElementById('game-renderer-status').hidden).toBe(false);
    expect(document.getElementById('game-renderer-status').getAttribute('role')).toBe('alert');
    expect(path.getAttribute('aria-busy')).toBe('false');
    path.querySelector('[data-level="system"]').click();
    await vi.waitFor(() => expect(path.getAttribute('aria-busy')).toBe('false'));
    expect(document.getElementById('game-renderer-status').hidden).toBe(true);
    rendererOptions.onViewChange({ level: 'galaxy', planetPosition: null });
    expect(path.hidden).toBe(true);
    expect(document.getElementById('starfield')).toBe(canvas);
    expect(document.querySelector('#game-galaxy-selection img')).toBeNull();
    expect(document.querySelector('#game-galaxy-selection').textContent).toContain('<img src=x>');
    const management = [...document.querySelectorAll('#game-galaxy-selection button')]
      .filter((element) => element.textContent.endsWith(' verwalten'));
    expect(management).toHaveLength(1);
    expect(management[0].textContent).toBe('Home verwalten');
    session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'buildings', allColonies: false });
    expect(renderer.refreshColony).toHaveBeenCalledExactlyOnceWith(1);
    session.events.emit('colony:mutation-accepted', { colonyId: 2, domain: 'economy', allColonies: true });
    expect(renderer.refreshColony).toHaveBeenLastCalledWith(null);
    unmount();
    path.querySelector('[data-level="system"]').dispatchEvent(new MouseEvent('click'));
    expect(renderer.returnTo).toHaveBeenCalledTimes(3);
    session.events.emit('colony:mutation-accepted', { colonyId: 1, domain: 'buildings', allColonies: false });
    expect(renderer.refreshColony).toHaveBeenCalledTimes(2);
    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(document.getElementById('starfield')).toBe(canvas);
    expect(document.getElementById('game-galaxy-ui')).toBeNull();
    cleanups.pop();
  });
  it('uses the menu renderer and same device, clears player scene on return, and removes controls', async () => {
    const space = new PerspectiveSpaceFlight();
    const canvas = document.getElementById('starfield');
    const raw = {
      renderer: { domElement: canvas }, getSpaceView: () => space,
      setFlightScene: vi.fn((scene) => { if (scene.sceneGraph) return space.setSystem(scene); return true; }),
      setStars: vi.fn(), setSpatialLabelStars: vi.fn(), cancelCameraFlight: vi.fn(),
      setGalaxyFleets: vi.fn(), resize: vi.fn(), getRenderStats: () => ({ backend: 'webgpu', frameTick: 20 }),
      getSharedZoomBackend: () => ({ addFrameHook: vi.fn(() => vi.fn()) }),
    };
    const control = { acquireGameView: vi.fn(async () => raw), getVisualStars: () => [{ visual_only: true }],
      returnToMenu: vi.fn() };
    window.GQAuthGalaxyBackgroundControl = control;
    const adapter = await createGameGalaxyRenderer(canvas.parentElement, { onClick: vi.fn(), onDoubleClick: vi.fn() });
    adapter.setStars([star]);
    expect(raw.setStars.mock.calls[0][0]).toHaveLength(2);
    expect(raw.setSpatialLabelStars).toHaveBeenCalledWith([star]);
    adapter.enterSystemView(star, systemPayload());
    expect(space.bodies.filter((body) => body.userData.type === 'planet')).toHaveLength(2);
    adapter.exitSystemView();
    expect(space.bodies).toHaveLength(0);
    adapter.destroy();
    expect(control.returnToMenu).toHaveBeenCalledOnce();
    space.dispose();
  });
  it('connects canonical planet context to canvas selection and gates private actions to owned colonies', async () => {
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(), setGalaxyFleets: vi.fn(),
      focusPlanet: vi.fn(), focusColony: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn().mockResolvedValue(renderer);
    const unmount = mountGameGalaxy({ session, domain, createRenderer: factory });
    cleanups.push(unmount);
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(window.galaxy3d).toBe(renderer));
    await domain.home();
    const callbacks = factory.mock.calls[0][1];
    callbacks.onViewChange({ level: 'system', planetPosition: null });
    const context = document.getElementById('game-planet-context');
    const action = (label) => [...context.querySelectorAll('button')].find((item) => item.textContent === label);
    expect(context.hidden).toBe(true);
    expect(document.getElementById('game-galaxy-selection').textContent).not.toContain('Kolonie auf Foreign ansehen');
    callbacks.onClick({ __kind: 'planet', position: 3, name: 'Untrusted click label' });
    expect(context.hidden).toBe(false);
    expect(context.textContent).toContain('Home · Position 3');
    expect(context.textContent).not.toContain('Untrusted click label');
    expect(document.getElementById('game-galaxy-details').open).toBe(false);
    expect(document.querySelector('li[data-position="3"]').getAttribute('aria-current')).toBe('true');
    action('Planet annähern').click();
    expect(renderer.focusPlanet).toHaveBeenCalledExactlyOnceWith(3);
    action('Kolonieoberfläche öffnen').click();
    expect(renderer.focusColony).toHaveBeenCalledExactlyOnceWith(3);
    const open = vi.fn();
    const unsubscribe = session.events.on('buildings:open-requested', open);
    action('Kolonie verwalten').click();
    expect(open).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, buildingType: '' });
    await domain.refresh();
    expect(context.hidden).toBe(false);
    expect(context.textContent).toContain('Home · Position 3');
    let finishRefresh;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const refresh = domain.refresh();
    expect(action('Planet annähern').disabled).toBe(true);
    expect(action('Kolonieoberfläche öffnen').disabled).toBe(true);
    action('Kolonieoberfläche öffnen').dispatchEvent(new MouseEvent('click'));
    expect(renderer.focusColony).toHaveBeenCalledTimes(1);
    finishRefresh({ success: true, galaxy: 1, stars: [star] });
    await refresh;
    expect(action('Planet annähern').disabled).toBe(false);
    callbacks.onClick({ __kind: 'planet', position: 4 });
    expect(context.textContent).toContain('keine eigene Kolonie');
    const requestedTarget = vi.fn();
    const unsubscribeTarget = session.events.on('fleet:target-requested', requestedTarget);
    session.events.emit('fleet:target-picking', { active: true });
    expect(document.getElementById('wm-galaxy-section').classList.contains('fleet-target-picking')).toBe(true);
    callbacks.onClick({ __kind: 'planet', position: 4 });
    expect(requestedTarget).toHaveBeenCalledExactlyOnceWith({ galaxy: 1, system: 10, position: 4 });
    expect(session.getColony().id).toBe(1);
    session.events.emit('fleet:target-picking', { active: false });
    const originRequested = vi.fn();
    const unsubscribeOrigin = session.events.on('fleet:origin-requested', originRequested);
    callbacks.onClick({ __kind: 'planet', position: 3 });
    action('Flotte hier auswählen').click();
    expect(originRequested).toHaveBeenCalledExactlyOnceWith({ colonyId: 1 });
    const populationRequested = vi.fn();
    const unsubscribePopulation = session.events.on('population:open-requested', populationRequested);
    action('Bevölkerung dieser Kolonie').click();
    expect(populationRequested).toHaveBeenCalledExactlyOnceWith({ colonyId: 1 });
    callbacks.onClick({ __kind: 'planet', position: 4 });
    expect(action('Flotte hier auswählen').hidden).toBe(true);
    expect(action('Bevölkerung dieser Kolonie').hidden).toBe(true);
    action('Bevölkerung dieser Kolonie').dispatchEvent(new MouseEvent('click'));
    expect(populationRequested).toHaveBeenCalledOnce();
    unsubscribePopulation();
    unsubscribeOrigin();
    unsubscribeTarget();
    expect(action('Kolonieoberfläche öffnen').hidden).toBe(true);
    expect(action('Kolonie verwalten').hidden).toBe(true);
    action('Kolonieoberfläche öffnen').dispatchEvent(new MouseEvent('click'));
    action('Kolonie verwalten').dispatchEvent(new MouseEvent('click'));
    expect(renderer.focusColony).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    callbacks.onViewChange({ level: 'planet', planetPosition: 3 });
    expect(context.textContent).toContain('Home · Position 3');
    callbacks.onViewChange({ level: 'colony', planetPosition: 3 });
    expect(context.hidden).toBe(true);
    callbacks.onViewChange({ level: 'planet', planetPosition: 3 });
    expect(context.hidden).toBe(false);
    action('Planetenauswahl aufheben').click();
    expect(context.hidden).toBe(true);
    expect(document.querySelector('[data-position][aria-current]')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('starfield'));
    callbacks.onClick({ __kind: 'planet', position: 3 });
    await domain.navigate(1, 20);
    expect(context.hidden).toBe(true);
    callbacks.onClick({ __kind: 'planet', position: 999 });
    expect(context.hidden).toBe(true);
    callbacks.onClick({ __kind: 'planet', position: 4 });
    const changed = systemPayload(20);
    changed.planets[1].player_planet.name = '<img src=x onerror=alert(1)>';
    api.get.mockImplementationOnce(async () => ({ success: true, galaxy: 1, stars: [star] }))
      .mockResolvedValueOnce(changed);
    await domain.refresh();
    expect(context.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(context.querySelector('img')).toBeNull();
    const removed = systemPayload(20);
    removed.planets = [];
    api.get.mockImplementationOnce(async () => ({ success: true, galaxy: 1, stars: [star] }))
      .mockResolvedValueOnce(removed);
    await domain.refresh();
    expect(context.hidden).toBe(true);
    await domain.refresh();
    expect(context.hidden).toBe(true);
    callbacks.onViewChange({ level: 'galaxy', planetPosition: null });
    expect(context.hidden).toBe(true);
    session.events.emit('fleet:target-picking', { active: true });
    await domain.overview();
    callbacks.onClick(star);
    await vi.waitFor(() => expect(domain.getState().system?.system).toBe(10));
    session.events.emit('fleet:target-picking', { active: false });
    unsubscribe();
    unmount();
    action('Planet annähern').dispatchEvent(new MouseEvent('click'));
    expect(renderer.focusPlanet).toHaveBeenCalledTimes(1);
    expect(document.getElementById('game-planet-context')).toBeNull();
    cleanups.pop();
  });
  it('does not attach late renderer controls after logout', async () => {
    const controller = new AbortController();
    const setFlightScene = vi.fn();
    window.GQAuthGalaxyBackgroundControl = { acquireGameView: async () => ({ setFlightScene }) };
    const result = createGameGalaxyRenderer(document.getElementById('galaxy-3d-host'), { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(setFlightScene).not.toHaveBeenCalled();
  });
});
