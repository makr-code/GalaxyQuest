import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { createGalaxyDomain } from '../../js/engine/runtime/server-galaxy-domain.js';
import { mountGameGalaxy } from '../../js/ui/game-galaxy.js';
import { createGameGalaxyRenderer } from '../../js/rendering/game-galaxy-renderer.js';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { API } from '../../js/api.js';

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
  it('replaces stale catalog coordinates with validated system data while preserving catalog metadata', async () => {
    api.get.mockResolvedValueOnce({ success: true, galaxy: 1, stars: [{ ...star, faction_color: '#abcdef' }] });
    await domain.overview();
    const updated = systemPayload();
    updated.star_system = { ...star, name: 'Updated star', x_ly: 200, y_ly: 300 };
    api.get.mockResolvedValueOnce(updated);
    await domain.home();
    const current = domain.getState();
    expect(current.stars).toEqual([{ ...updated.star_system, faction_color: '#abcdef' }]);
    expect(current.selected).toEqual(current.stars[0]);
    domain.select(star);
    expect(domain.getState().selected).toEqual(current.selected);
    expect(api.post).not.toHaveBeenCalled();
    delete updated.star_system.x_ly;
    api.get.mockResolvedValueOnce(updated);
    await domain.home();
    expect(domain.getState().error).toContain('Systemposition fehlt');
    expect(domain.getState().stars).toEqual(current.stars);
  });
  it('never sends a second-stage system read after a superseded catalog response arrives late', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const old = domain.navigate(2, 25);
    const signal = api.get.mock.calls[0][1].signal;
    await domain.home();
    const count = api.get.mock.calls.length;
    expect(signal.aborted).toBe(true);
    finish({ success: true, galaxy: 2, stars: [{ ...star, galaxy_index: 2 }] });
    await old;
    expect(api.get).toHaveBeenCalledTimes(count);
    expect(api.get.mock.calls.some(([url]) => url.includes('system=25'))).toBe(false);
    expect(domain.getState().system.system).toBe(10);
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
      setSpatialLabelMode: vi.fn(() => true), nudgeZoom: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
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
    const badgeMode = document.getElementById('game-spatial-badges-dom-toggle');
    expect(badgeMode.checked).toBe(false);
    badgeMode.checked = true;
    badgeMode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(renderer.setSpatialLabelMode).toHaveBeenLastCalledWith('dom');
    badgeMode.checked = false;
    badgeMode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(renderer.setSpatialLabelMode).toHaveBeenLastCalledWith('webgpu');
    await domain.home();
    const catalogCard = document.querySelector('.game-system-catalog-card');
    expect(catalogCard.querySelector('svg')).not.toBeNull();
    expect(catalogCard.querySelector('strong').textContent).toBe('<img src=x>');
    expect(catalogCard.getAttribute('aria-current')).toBe('location');
    expect(catalogCard.querySelector('img')).toBeNull();
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
    const planets = document.querySelector('.game-system-planets');
    expect(planets.getAttribute('aria-label')).toBe('Systemplaneten');
    expect(planets.children).toHaveLength(2);
    const own = planets.querySelector('[data-position="3"]');
    const foreign = planets.querySelector('[data-position="4"]');
    expect(own.dataset.owned).toBe('true');
    expect(own.querySelector('.game-system-ownership').textContent).toBe('Kolonie · Home');
    expect(own.querySelector('.game-development-level').textContent).toBe('Position 3');
    expect(own.querySelectorAll('button')).toHaveLength(3);
    expect(own.querySelectorAll('button svg')).toHaveLength(3);
    expect(own.querySelector('.game-system-planet-actions').getAttribute('aria-label')).toBe('Aktionen für Home');
    expect([...document.querySelectorAll('.game-planet-action-group')].map((group) => group.getAttribute('aria-label')))
      .toEqual(['Ansicht', 'Flotte', 'Kolonie']);
    expect(document.querySelector('.game-planet-action-group[aria-label="Kolonie"] h4').textContent).toBe('Kolonie');
    expect(own.querySelector('.game-system-planet-heading .game-development-level').textContent).toBe('Position 3');
    expect(foreign.dataset.owned).toBeUndefined();
    expect(foreign.querySelector('.game-system-ownership')).toBeNull();
    expect(foreign.querySelectorAll('button')).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
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
  it('starts a pending battle replay only after target-system navigation finishes', async () => {
    window.GQAuthGalaxyBackgroundControl = {
      getViewTarget: () => ({ galaxy: 1, system: 10 }),
    };
    const renderer = {
      getRenderStats: () => ({ backend: 'webgpu', cameraControl: { level: 'system', transitioning: false } }),
      setStars: vi.fn(),
      fitCameraToStars: vi.fn(),
      enterSystemView: vi.fn(),
      exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(),
      setSpatialLabelMode: vi.fn(() => true),
      setSystemVisualizationOptions: vi.fn(() => true),
      playBattleEncounter: vi.fn(() => ({ finished: Promise.resolve() })),
      resize: vi.fn(),
      destroy: vi.fn(),
      refreshColony: vi.fn(),
      returnTo: vi.fn(async () => true),
    };
    cleanups.push(mountGameGalaxy({
      session,
      domain,
      createRenderer: vi.fn().mockResolvedValue(renderer),
    }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(domain.getState().system?.system).toBe(10));

    let finishNavigation;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finishNavigation = resolve; }));
    window.dispatchEvent(new CustomEvent('gq:show-battle-encounter', {
      detail: {
        id: 21,
        events: [{
          event_type: 'encounter_created',
          payload: { target: { galaxy: 1, system: 10, position: 3 } },
        }],
      },
    }));
    await vi.waitFor(() => expect(finishNavigation).toBeTypeOf('function'));
    expect(domain.getState()).toMatchObject({ loading: true, system: { system: 10 } });
    expect(renderer.playBattleEncounter).not.toHaveBeenCalled();

    finishNavigation({ ...systemPayload(10), server_ts_ms: 11 });
    await vi.waitFor(() => expect(renderer.playBattleEncounter).toHaveBeenCalledOnce());
    expect(renderer.enterSystemView.mock.invocationCallOrder.at(-1))
      .toBeLessThan(renderer.playBattleEncounter.mock.invocationCallOrder[0]);
  });
  it('filters local system cards with an accurate capped count and no additional reads', async () => {
    cleanups.push(mountGameGalaxy({ session, domain,
      createRenderer: vi.fn().mockRejectedValue(new Error('No GPU in catalogue test')) }));
    api.get.mockResolvedValueOnce({ success: true, galaxy: 1,
      stars: Array.from({ length: 45 }, (_, index) => ({ ...star, system_index: index + 1, name: `Star ${index + 1}` })) });
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(document.querySelectorAll('.game-system-catalog-card')).toHaveLength(40));
    const list = document.getElementById('game-galaxy-system-list');
    const search = document.querySelector('[aria-label="Sternsysteme filtern"]');
    expect(list.querySelectorAll('button')).toHaveLength(40);
    expect(list.querySelector('[role="status"]').textContent).toContain('40 von 45 Treffern');
    const calls = api.get.mock.calls.length;
    search.value = 'Star 45';
    search.dispatchEvent(new Event('input'));
    expect(list.querySelectorAll('button')).toHaveLength(1);
    expect(list.textContent).toContain('[1:45]');
    expect(list.querySelector('[role="status"]').textContent).toContain('1 von 1 Treffern');
    search.value = 'not loaded';
    search.dispatchEvent(new Event('input'));
    expect(list.querySelectorAll('button')).toHaveLength(0);
    expect(list.textContent).toContain('Keine passenden geladenen Sternsysteme.');
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('shows system visualization toggles only in system view and applies their state', async () => {
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(), setSystemVisualizationOptions: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn().mockResolvedValue(renderer);
    cleanups.push(mountGameGalaxy({ session, domain, createRenderer: factory }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(window.galaxy3d).toBe(renderer));

    const controls = document.getElementById('game-system-visualizations');
    const orbits = document.getElementById('game-system-orbits-toggle');
    const planes = document.getElementById('game-system-planes-toggle');
    const distanceLine = document.getElementById('game-system-distance-line-toggle');
    const apsides = document.getElementById('game-system-apsides-toggle');
    const phaseArc = document.getElementById('game-system-phase-arc-toggle');
    const selection = document.getElementById('game-system-selection-toggle');
    expect(controls.hidden).toBe(true);
    expect(orbits.checked).toBe(true);
    expect(planes.checked).toBe(false);
    expect(distanceLine.checked).toBe(false);
    expect(apsides.checked).toBe(false);
    expect(phaseArc.checked).toBe(false);
    expect(selection.checked).toBe(true);
    expect(renderer.setSystemVisualizationOptions).toHaveBeenCalledWith({
      orbits: true, planes: false, distanceLine: false, apsides: false, phaseArc: false, selection: true,
    });

    factory.mock.calls.at(-1)[1].onViewChange({ level: 'system', planetPosition: null });
    expect(controls.hidden).toBe(false);
    orbits.click();
    expect(renderer.setSystemVisualizationOptions).toHaveBeenLastCalledWith({
      orbits: false, planes: false, distanceLine: false, apsides: false, phaseArc: false, selection: true,
    });
    planes.click();
    expect(renderer.setSystemVisualizationOptions).toHaveBeenLastCalledWith({
      orbits: false, planes: true, distanceLine: false, apsides: false, phaseArc: false, selection: true,
    });
    distanceLine.click();
    expect(renderer.setSystemVisualizationOptions).toHaveBeenLastCalledWith({
      orbits: false, planes: true, distanceLine: true, apsides: false, phaseArc: false, selection: true,
    });
    apsides.click();
    expect(renderer.setSystemVisualizationOptions).toHaveBeenLastCalledWith({
      orbits: false, planes: true, distanceLine: true, apsides: true, phaseArc: false, selection: true,
    });
    selection.click();
    expect(renderer.setSystemVisualizationOptions).toHaveBeenLastCalledWith({
      orbits: false, planes: true, distanceLine: true, apsides: true, phaseArc: false, selection: false,
    });

    factory.mock.calls.at(-1)[1].onViewChange({ level: 'planet', planetPosition: 3 });
    expect(controls.hidden).toBe(true);
  });
  it('shows a clearly marked estimated stellar distance when the measurement line is enabled', async () => {
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(), setSystemVisualizationOptions: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn().mockResolvedValue(renderer);
    cleanups.push(mountGameGalaxy({ session, domain, createRenderer: factory }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(window.galaxy3d).toBe(renderer));
    await domain.home();

    const options = factory.mock.calls.at(-1)[1];
    options.onViewChange({ level: 'system', planetPosition: null });
    options.onClick({ __kind: 'planet', position: 3 });
    const readout = document.getElementById('game-planet-distance');
    expect(readout.hidden).toBe(true);

    document.getElementById('game-system-distance-line-toggle').click();
    expect(readout.hidden).toBe(false);
    expect(readout.textContent).toMatch(/^Sternabstand: \d.* AU · schematisch geschätzt$/);

    options.onViewChange({ level: 'planet', planetPosition: 3 });
    expect(readout.hidden).toBe(true);
  });
  it('shows estimated periapsis and apoapsis measurements when the extrema helper is enabled', async () => {
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(), setSystemVisualizationOptions: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn().mockResolvedValue(renderer);
    cleanups.push(mountGameGalaxy({ session, domain, createRenderer: factory }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(window.galaxy3d).toBe(renderer));
    await domain.home();

    const options = factory.mock.calls.at(-1)[1];
    options.onViewChange({ level: 'system', planetPosition: null });
    options.onClick({ __kind: 'planet', position: 3 });
    const readout = document.getElementById('game-planet-distance');
    expect(readout.hidden).toBe(true);

    document.getElementById('game-system-apsides-toggle').click();
    expect(readout.hidden).toBe(false);
    expect(readout.textContent).toMatch(
      /^Periapsis \(grün, nächster Punkt\): 3 AU · Apoapsis \(orange gestrichelt, fernster Punkt\): 3 AU · schematisch geschätzt$/,
    );

    options.onViewChange({ level: 'planet', planetPosition: 3 });
    expect(readout.hidden).toBe(true);
  });
  it('labels estimated orbital phase when the phase arc helper is enabled', async () => {
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(), setSystemVisualizationOptions: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn().mockResolvedValue(renderer);
    cleanups.push(mountGameGalaxy({ session, domain, createRenderer: factory }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(window.galaxy3d).toBe(renderer));
    await domain.home();

    const options = factory.mock.calls.at(-1)[1];
    options.onViewChange({ level: 'system', planetPosition: null });
    options.onClick({ __kind: 'planet', position: 3 });
    const readout = document.getElementById('game-planet-distance');
    document.getElementById('game-system-phase-arc-toggle').click();

    expect(readout.hidden).toBe(false);
    expect(readout.textContent).toBe('Phasenbogen: Periapsis bis Planetenposition · Position schematisch geschätzt');
    expect(renderer.setSystemVisualizationOptions).toHaveBeenLastCalledWith({
      orbits: true, planes: false, distanceLine: false, apsides: false, phaseArc: true, selection: true,
    });
  });
  it('uses the menu renderer and same device, clears player scene on return, and removes controls', async () => {
    const space = new PerspectiveSpaceFlight();
    const canvas = document.getElementById('starfield');
    const raw = {
      renderer: { domElement: canvas }, getSpaceView: () => space,
      setFlightScene: vi.fn((scene) => { if (scene.sceneGraph) return space.setSystem(scene); return true; }),
      setStars: vi.fn(), setSpatialLabelStars: vi.fn(), cancelCameraFlight: vi.fn(),
      setSystemVisualizationOptions: vi.fn(() => true),
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
    expect(adapter.setSystemVisualizationOptions({ orbits: false, selection: true })).toBe(true);
    expect(raw.setSystemVisualizationOptions).toHaveBeenCalledWith({ orbits: false, selection: true });
    adapter.enterSystemView(star, systemPayload());
    expect(space.bodies.filter((body) => body.userData.type === 'planet')).toHaveLength(2);
    adapter.exitSystemView();
    expect(space.bodies).toHaveLength(0);
    adapter.destroy();
    adapter.destroy();
    expect(control.returnToMenu).toHaveBeenCalledOnce();
    space.dispose();
  });
  it('updates changed system contents with the same timestamp and leaves identical snapshots alone', async () => {
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn().mockResolvedValue(renderer);
    cleanups.push(mountGameGalaxy({ session, domain, createRenderer: factory }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(window.galaxy3d).toBe(renderer));
    await domain.home();
    renderer.enterSystemView.mockClear();
    renderer.fitCameraToStars.mockClear();
    const changed = systemPayload();
    changed.planets[0].player_planet.name = 'Updated home';
    changed.planets.push({ position: 5, generated_planet: { position: 5, name: 'New planet' } });
    const original = api.get.getMockImplementation();
    api.get.mockImplementation(async (url) => url.includes('game.php') ? original(url)
      : url.includes('action=stars') ? { success: true, galaxy: 1, stars: [star] } : structuredClone(changed));
    await domain.refresh();
    expect(renderer.enterSystemView).toHaveBeenCalledExactlyOnceWith(star, changed);
    expect(document.getElementById('game-galaxy-selection').textContent).toContain('Updated home');
    await domain.refresh();
    await session.refresh();
    expect(renderer.enterSystemView).toHaveBeenCalledOnce();
    expect(renderer.fitCameraToStars).not.toHaveBeenCalled();
    changed.planets = [];
    await domain.refresh();
    expect(renderer.enterSystemView).toHaveBeenCalledTimes(2);
    expect(renderer.enterSystemView.mock.lastCall[1].planets).toEqual([]);
  });
  it('rolls back a partially synchronized renderer and retries with the current canonical system', async () => {
    await domain.home();
    const makeRenderer = () => ({
      getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(), resize: vi.fn(), destroy: vi.fn(),
    });
    const failed = makeRenderer();
    failed.setGalaxyFleets.mockImplementation(() => { throw new Error('Scene synchronization failed'); });
    const recovered = makeRenderer();
    const factory = vi.fn().mockResolvedValueOnce(failed).mockResolvedValue(recovered);
    cleanups.push(mountGameGalaxy({ session, domain, createRenderer: factory }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    const status = document.getElementById('game-renderer-status');
    await vi.waitFor(() => expect(status.textContent).toBe('Scene synchronization failed'));
    expect(status.hidden).toBe(false);
    expect(failed.destroy).toHaveBeenCalledOnce();
    expect(window.galaxy3d).not.toBe(failed);
    const stale = factory.mock.calls[0][1];
    stale.onViewChange({ level: 'planet', planetPosition: 3 });
    stale.onError(new Error('Late obsolete error'));
    stale.onClick(star);
    expect(status.textContent).toBe('Scene synchronization failed');
    expect(document.getElementById('game-camera-path').hidden).toBe(true);
    await domain.navigate(1, 20);
    const reads = api.get.mock.calls.length;
    let finish;
    factory.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const retry = [...document.querySelectorAll('button')].find((item) => item.textContent === '3D erneut starten');
    retry.click();
    expect(retry.disabled).toBe(true);
    expect(status.getAttribute('role')).toBe('status');
    retry.dispatchEvent(new MouseEvent('click'));
    expect(factory).toHaveBeenCalledTimes(2);
    finish(recovered);
    await vi.waitFor(() => expect(window.galaxy3d).toBe(recovered));
    expect(recovered.setStars).toHaveBeenCalledOnce();
    expect(recovered.enterSystemView).toHaveBeenCalledWith(
      expect.objectContaining({ system_index: 20 }), expect.objectContaining({ system: 20 }));
    expect(api.get).toHaveBeenCalledTimes(reads);
    stale.onError(new Error('Late obsolete error'));
    stale.onOverview();
    expect(status.textContent).toBe('3D aktiv: webgpu');
    expect(domain.getState().system.system).toBe(20);
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('disposes late initialization after logout without publishing a renderer or accepting callbacks', async () => {
    let finish;
    const factory = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const unmount = mountGameGalaxy({ session, domain, createRenderer: factory });
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    const callbacks = factory.mock.calls[0][1];
    unmount();
    const destroy = vi.fn();
    finish({ destroy });
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    const reads = api.get.mock.calls.length;
    callbacks.onError(new Error('Late error'));
    callbacks.onViewChange({ level: 'colony', planetPosition: 3 });
    callbacks.onDoubleClick(star);
    callbacks.onOverview();
    expect(api.get).toHaveBeenCalledTimes(reads);
    expect(callbacks.signal.aborted).toBe(true);
    expect(document.getElementById('game-galaxy-ui')).toBeNull();
    expect(window.galaxy3d).toBeUndefined();
  });
  it('keeps independent scene errors through camera movement and clears only recovered contexts', async () => {
    const renderer = { getRenderStats: () => ({ backend: 'webgpu' }), setStars: vi.fn(),
      fitCameraToStars: vi.fn(), enterSystemView: vi.fn(), exitSystemView: vi.fn(),
      setGalaxyFleets: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn().mockResolvedValue(renderer);
    cleanups.push(mountGameGalaxy({ session, domain, createRenderer: factory }));
    window.dispatchEvent(new CustomEvent('gq:authenticated'));
    await vi.waitFor(() => expect(window.galaxy3d).toBe(renderer));
    const callbacks = factory.mock.calls[0][1];
    const get = vi.spyOn(API, 'get').mockResolvedValue({ success: true, buildings: [] });
    try {
      const data = { focusPlanet: {}, systemPayload: { galaxy: 1, system: 10 } };
      const first = await callbacks.loadColonyData(3, data);
      callbacks.onViewChange({ level: 'colony', planetPosition: 3 });
      first.onError(new Error('Snapshot unavailable'));
      callbacks.onViewChange({ level: 'colony', planetPosition: 3 });
      const status = document.getElementById('game-renderer-status');
      expect(status.hidden).toBe(false);
      expect(status.getAttribute('role')).toBe('alert');
      expect(status.textContent).toBe('Snapshot unavailable');
      callbacks.onError(new Error('Camera operation failed'));
      first.onSnapshotLoaded();
      expect(status.hidden).toBe(false);
      expect(status.textContent).toBe('Camera operation failed');
      first.onError(new Error('Snapshot unavailable again'));
      callbacks.onViewChange({ level: 'building', planetPosition: 3 });
      expect(status.hidden).toBe(false);
      expect(status.textContent).toBe('Snapshot unavailable again');
      const second = await callbacks.loadColonyData(3, data);
      second.onError(new Error('Current snapshot failed'));
      first.onSnapshotLoaded();
      first.onError(new Error('Late obsolete snapshot'));
      expect(status.textContent).toBe('Current snapshot failed');
      callbacks.onViewChange({ level: 'planet', planetPosition: 3 });
      expect(status.hidden).toBe(true);
      second.onError(new Error('Late departed snapshot'));
      expect(status.hidden).toBe(true);
      expect(status.getAttribute('role')).toBe('status');
    } finally {
      get.mockRestore();
    }
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
    expect(context.dataset.ownership).toBe('own');
    expect(context.querySelector('.game-planet-context-heading svg')).not.toBeNull();
    expect(context.querySelectorAll('.game-planet-action-grid button svg')).toHaveLength(8);
    expect(action('Kolonie verwalten').title).toBe('Kolonie verwalten');
    expect(action('Planetenauswahl aufheben').querySelector('svg').getAttribute('aria-hidden')).toBe('true');
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
    expect(context.dataset.ownership).toBe('settled');
    expect(action('Kolonie verwalten').hidden).toBe(true);
    const requestedTarget = vi.fn();
    const unsubscribeTarget = session.events.on('fleet:target-requested', requestedTarget);
    session.events.emit('fleet:target-picking', { active: true });
    expect(document.getElementById('wm-galaxy-section').classList.contains('fleet-target-picking')).toBe(true);
    const targetPicker = document.getElementById('game-fleet-target-picker');
    expect(targetPicker.hidden).toBe(false);
    expect(targetPicker.textContent).toContain('Ziel in diesem Sternsystem wählen');
    expect(targetPicker.querySelectorAll('button')).toHaveLength(3);
    const coordinateRequested = vi.fn();
    const unsubscribeCoordinates = session.events.on('fleet:target-coordinate-requested', coordinateRequested);
    targetPicker.querySelector('button:last-child').click();
    expect(coordinateRequested).toHaveBeenCalledOnce();
    unsubscribeCoordinates();
    let finishSystem;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finishSystem = resolve; }));
    const navigation = domain.navigate(1, 20);
    await vi.waitFor(() => expect(finishSystem).toBeTypeOf('function'));
    expect(targetPicker.textContent).toContain('Planeten des ausgewählten Sternsystems werden geladen.');
    expect(targetPicker.querySelectorAll('[aria-label^="Flottenziel wählen:"]')).toHaveLength(0);
    finishSystem(systemPayload(20));
    await navigation;
    expect(targetPicker.querySelector('[aria-label="Flottenziel wählen: Foreign · Position 4"]')).not.toBeNull();
    api.get.mockRejectedValueOnce(new Error('System offline'));
    await domain.navigate(1, 30);
    expect(targetPicker.textContent).toContain('Systemziele nicht verfügbar: System offline');
    expect(targetPicker.querySelectorAll('[aria-label^="Flottenziel wählen:"]')).toHaveLength(0);
    await domain.navigate(1, 20);
    expect(targetPicker.querySelector('[aria-label="Flottenziel wählen: Foreign · Position 4"]')).not.toBeNull();
    targetPicker.querySelector('[aria-label="Flottenziel wählen: Foreign · Position 4"]').click();
    expect(requestedTarget).toHaveBeenCalledExactlyOnceWith({
      galaxy: 1, system: 20, position: 4, targetName: '<img src=x> · Foreign',
    });
    callbacks.onClick({ __kind: 'planet', position: 4 });
    expect(requestedTarget).toHaveBeenCalledTimes(2);
    expect(session.getColony().id).toBe(1);
    session.events.emit('fleet:target-picking', { active: false });
    expect(targetPicker.hidden).toBe(true);
    const malformedSystem = systemPayload();
    malformedSystem.planets.push(
      { position: 0, generated_planet: { name: 'Invalid position', position: 0 } },
      { generated_planet: { name: 'Missing position' } },
    );
    api.get.mockResolvedValueOnce({ success: true, galaxy: 1, stars: [star] });
    api.get.mockResolvedValueOnce(malformedSystem);
    await domain.navigate(1, 10, true);
    session.events.emit('fleet:target-picking', { active: true });
    expect(targetPicker.querySelectorAll('button')).toHaveLength(3);
    expect(targetPicker.textContent).not.toContain('Invalid position');
    expect(targetPicker.textContent).not.toContain('Missing position');
    callbacks.onClick({ __kind: 'planet', position: 0 });
    expect(requestedTarget).toHaveBeenCalledTimes(2);
    session.events.emit('fleet:target-picking', { active: false });
    const originRequested = vi.fn();
    const unsubscribeOrigin = session.events.on('fleet:origin-requested', originRequested);
    session.events.emit('fleet:origin-picking', { active: true });
    expect(document.getElementById('wm-galaxy-section').classList.contains('fleet-origin-picking')).toBe(true);
    callbacks.onClick({ __kind: 'planet', position: 4 });
    expect(originRequested).not.toHaveBeenCalled();
    callbacks.onClick({ __kind: 'planet', position: 3 });
    expect(originRequested).toHaveBeenCalledExactlyOnceWith({ colonyId: 1 });
    const canvas = document.getElementById('starfield');
    for (const composing of [true, false]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true, isComposing: composing,
      });
      if (!composing) event.preventDefault();
      canvas.dispatchEvent(event);
      expect(document.getElementById('wm-galaxy-section').classList.contains('fleet-origin-picking')).toBe(true);
      expect(document.activeElement).toBe(canvas);
    }
    const cancelOrigin = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    canvas.dispatchEvent(cancelOrigin);
    expect(cancelOrigin.defaultPrevented).toBe(true);
    expect(document.getElementById('wm-galaxy-section').classList.contains('fleet-origin-picking')).toBe(false);
    session.events.emit('fleet:origin-picking', { active: false });
    expect(document.getElementById('wm-galaxy-section').classList.contains('fleet-origin-picking')).toBe(false);
    originRequested.mockClear();
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
