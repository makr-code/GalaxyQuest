import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFleetLaunchDomain } from '../../js/engine/runtime/server-fleet-launch-domain.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { mountFleetCommandOverlay } from '../../js/ui/game-fleet-launch.js';

const inventory = () => ({ success: true, ships: [{ type: 'small_cargo', count: 4 }],
  blueprints: [{ type: 'bp_7', name: '<img src=x>', count: '2' }] });
const transit = (type = 'aereth') => ({ success: true, ftl_drive_type: type,
  ftl_ready: true, ftl_cooldown_remaining_s: 0, gates: [], resonance_nodes: [] });
const overview = () => ({ success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home', galaxy: 1, system: 10, position: 3 },
    { id: 2, name: 'Other', galaxy: 2, system: 20, position: 4 }] });
const order = () => ({ mission: 'transport', target_galaxy: '2', target_system: '2000', target_position: '4',
  ships: { small_cargo: '2', bp_7: 1 }, cargo: { metal: '12.5', crystal: 0, deuterium: 0 } });
describe('Canonical fleet composition and launch', () => {
  let api;
  let session;
  let domain;
  let cleanup;
  beforeEach(async () => {
    api = { get: vi.fn(async (url) => url.includes('overview') ? overview()
      : url.includes('ftl_status') ? transit() : inventory()),
      post: vi.fn(async () => ({ success: true, arrival_time: '2026-11-03 20:00:00' })) };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createFleetLaunchDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  it('only reads owned-colony canonical inventory and combines standard ships and blueprints', async () => {
    await domain.load();
    expect(api.get).toHaveBeenCalledWith('api/shipyard.php?action=list&colony_id=1', { signal: expect.any(AbortSignal) });
    expect(api.get).toHaveBeenCalledWith('api/fleet.php?action=ftl_status', { signal: expect.any(AbortSignal) });
    expect(domain.getState().data.ships).toHaveLength(2);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('starts 3D target picking immediately after choosing a fleet origin without issuing a command', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    const root = document.getElementById('game-fleet-command');

    session.events.emit('fleet:origin-requested', { colonyId: 2 });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));

    expect(session.getColony().id).toBe(2);
    expect(root.hidden).toBe(false);
    expect(root.dataset.picking).toBe('true');
    expect(root.textContent).toContain('Schritt 2 von 3: Öffne ein Sternsystem per Doppelklick im 3D-Spielfeld');
    expect(root.textContent).toContain('oder über die Systemliste und wähle danach den Zielplaneten.');
    expect(root.querySelector('.game-fleet-command-steps [aria-current="step"]').textContent).toContain('Ziel');
    expect(root.querySelector('form')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    session.events.emit('fleet:target-requested', { galaxy: 3, system: 30, position: 5, targetName: 'Alpha · Haven' });
    expect(root.dataset.picking).toBe('false');
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('30');
    expect(root.querySelector('[aria-label="Geplante Route"] .game-fleet-endpoint:last-child strong').textContent)
      .toBe('Ziel · Alpha · Haven');
    expect(root.querySelector('[aria-label="Flottenziel im 3D-Spielfeld ändern"]')).not.toBeNull();
    expect(root.querySelector('form')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('switches from the 3D target picker to focused coordinate entry without losing the target draft', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4, targetName: 'Alpha · Haven' });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    root.querySelector('[aria-label="Flottenziel im 3D-Spielfeld ändern"]').click();
    expect(root.dataset.picking).toBe('true');
    const readsBeforeCoordinateEntry = api.get.mock.calls.length;

    session.events.emit('fleet:target-coordinate-requested');

    expect(root.dataset.picking).toBe('false');
    expect(root.querySelector('[aria-label="Zielgalaxie"]').value).toBe('2');
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('20');
    expect(root.querySelector('[aria-label="Zielposition"]').value).toBe('4');
    expect(document.activeElement).toBe(root.querySelector('[aria-label="Zielgalaxie"]'));
    expect(api.get).toHaveBeenCalledTimes(readsBeforeCoordinateEntry);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('distinguishes an empty owned-colony list from unavailable session data', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    vi.spyOn(session, 'getState').mockReturnValue({ colonies: [] });
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4 });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));

    [...root.querySelectorAll('button')]
      .find((item) => item.textContent === 'Herkunft im 3D-Spielfeld ändern').click();

    expect(root.textContent).toContain('In den geladenen Serverdaten sind keine eigenen Kolonien verfügbar.');
    expect(root.querySelector('[aria-label="Eigene Kolonie als Herkunft wählen"]').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('preserves composition and already-handled Escape in fleet composition and target picking', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"><canvas id="starfield" tabindex="0"></canvas></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4 });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const root = document.getElementById('game-fleet-command');
    const input = root.querySelector('[aria-label="Fracht Metall"]');
    input.value = '12.5';
    input.dispatchEvent(new Event('input'));
    input.focus();
    function ignoredEscape(target) {
      for (const composing of [true, false]) {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape', bubbles: true, cancelable: true, isComposing: composing,
        });
        if (!composing) event.preventDefault();
        target.dispatchEvent(event);
        expect(root.hidden).toBe(false);
        expect(document.activeElement).toBe(target);
      }
    }
    ignoredEscape(input);
    expect(input.value).toBe('12.5');
    root.querySelector('[aria-label="Flottenziel im 3D-Spielfeld ändern"]').click();
    const canvas = document.getElementById('starfield');
    canvas.focus();
    ignoredEscape(canvas);
    expect(root.dataset.picking).toBe('true');
    const cancel = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    canvas.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(root.dataset.picking).toBe('false');
    expect(document.activeElement)
      .toBe(root.querySelector('[aria-label="Flottenziel im 3D-Spielfeld ändern"]'));
    expect(root.querySelector('[aria-label="Fracht Metall"]').value).toBe('12.5');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('clears only the selected destination and disables launch without sending a command', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:target-requested', {
      galaxy: 2, system: 20, position: 4, targetName: 'Beta · Haven',
    });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const shipInput = root.querySelector('[aria-label="small cargo (4 verfügbar)"]');
    shipInput.value = '2';
    shipInput.dispatchEvent(new Event('input'));
    expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
    api.get.mockClear();

    root.querySelector('[aria-label="Flottenziel aus dem Entwurf entfernen"]').click();

    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('small cargo: 2');
    expect(root.querySelector('[aria-label="Geplante Route"]').textContent).not.toContain('Beta · Haven');
    expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Flottenziel im 3D-Spielfeld wählen');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('clears a partial coordinate destination in one action without changing composition', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4, targetName: 'Beta · Haven' });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const shipInput = root.querySelector('[aria-label="small cargo (4 verfügbar)"]');
    shipInput.value = '2';
    shipInput.dispatchEvent(new Event('input'));
    const targetSystem = root.querySelector('[aria-label="Zielsystem"]');
    targetSystem.value = '';
    targetSystem.dispatchEvent(new Event('input'));
    expect(root.querySelector('[aria-label="Flottenziel aus dem Entwurf entfernen"]')).not.toBeNull();
    api.get.mockClear();

    root.querySelector('[aria-label="Flottenziel aus dem Entwurf entfernen"]').click();

    expect(root.querySelector('[aria-label="Zielgalaxie"]').value).toBe('');
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('');
    expect(root.querySelector('[aria-label="Zielposition"]').value).toBe('');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('small cargo: 2');
    expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('offers keyboard coordinate entry directly from 3D target picking and focuses the first field', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:origin-requested', { colonyId: 1 });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));

    [...root.querySelectorAll('button')]
      .find((item) => item.textContent === 'Ziel stattdessen per Koordinaten eingeben').click();

    expect(root.dataset.picking).toBe('false');
    expect([...root.querySelectorAll('details')].find((item) => item.textContent.includes('Zielkoordinaten')).open).toBe(true);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Zielgalaxie');
    expect(root.querySelector('.game-fleet-command-steps [aria-current="step"]').textContent).toContain('Ziel');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('allows changing the origin in the 3D scene and resumes target picking after selection', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section><canvas id="starfield" tabindex="0"></canvas>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:origin-requested', { colonyId: 1 });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4 });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const mission = root.querySelector('[aria-label="Mission"]');
    expect(mission.getAttribute('aria-describedby')).toBe('fleet-mission-description');
    expect(root.querySelector(`#${mission.getAttribute('aria-describedby')}`).textContent)
      .toContain('ausgewählte Metall-, Kristall- und Deuteriumfracht');
    mission.value = 'attack';
    mission.dispatchEvent(new Event('change'));
    const cargo = root.querySelector('[aria-label="Fracht Metall"]');
    cargo.value = '25';
    cargo.dispatchEvent(new Event('input'));
    const ships = root.querySelector('[aria-label="small cargo (4 verfügbar)"]');
    ships.value = '2';
    ships.dispatchEvent(new Event('input'));
    const picking = vi.fn();
    const unsubscribe = session.events.on('fleet:origin-picking', picking);

    const changeOrigin = [...root.querySelectorAll('button')]
      .find((item) => item.textContent === 'Herkunft im 3D-Spielfeld ändern');
    expect(changeOrigin.closest('.game-fleet-endpoint'))
      .toBe(root.querySelector('[aria-label="Geplante Route"] .game-fleet-endpoint:first-child'));
    changeOrigin.click();

    expect(root.dataset.picking).toBe('true');
    expect(root.textContent).toContain('Klicke ein Sternsystem und danach eine eigene Kolonie an.');
    expect(root.querySelector('.game-fleet-command-steps [aria-current="step"]').textContent).toContain('Herkunft');
    expect(picking).toHaveBeenLastCalledWith({ active: true });
    let originSelect = root.querySelector('[aria-label="Eigene Kolonie als Herkunft wählen"]');
    expect([...originSelect.options].map((option) => option.textContent)).toEqual([
      'Kolonie auswählen …', 'Home [1:10:3]', 'Other [2:20:4]',
    ]);
    [...root.querySelectorAll('button')]
      .find((item) => item.textContent === 'Herkunftswahl abbrechen').click();
    expect(document.activeElement)
      .toBe(root.querySelector('[aria-label="Flottenherkunft im 3D-Spielfeld ändern"]'));
    root.querySelector('[aria-label="Flottenherkunft im 3D-Spielfeld ändern"]').click();
    session.events.emit('fleet:origin-picking', { active: false });
    expect(document.activeElement)
      .toBe(root.querySelector('[aria-label="Flottenherkunft im 3D-Spielfeld ändern"]'));
    root.querySelector('[aria-label="Flottenherkunft im 3D-Spielfeld ändern"]').click();
    originSelect = root.querySelector('[aria-label="Eigene Kolonie als Herkunft wählen"]');
    originSelect.value = '2';
    originSelect.dispatchEvent(new Event('change'));
    expect(document.activeElement).toBe(document.getElementById('starfield'));
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    [...root.querySelectorAll('button')]
      .find((item) => item.textContent === 'Zielwahl abbrechen').click();

    expect(session.getColony().id).toBe(2);
    expect(root.dataset.picking).toBe('false');
    expect(root.querySelector('[aria-label="Geplante Route"]').textContent).toContain('[2:20:4]');
    expect(root.querySelector('[aria-label="Mission"]').value).toBe('attack');
    expect(root.querySelector('[aria-label="Fracht Metall"]').value).toBe('25');
    expect(root.querySelector('[aria-label="small cargo (4 verfügbar)"]').value).toBe('0');
    expect(picking).toHaveBeenLastCalledWith({ active: false });
    expect(api.post).not.toHaveBeenCalled();
    unsubscribe();
  });
  it.each(['vor_tak', 'syl_nar', 'vel_ar', 'zhareen', 'aereth', 'kryl_tha'])('uses server-selected %s transit without overriding dispatch mechanics', async (type) => {
    api.get.mockImplementation(async (url) => url.includes('overview') ? overview()
      : url.includes('ftl_status') ? transit(type) : inventory());
    await domain.load();
    expect(domain.getState().data.transit.ftl_drive_type).toBe(type);
    await domain.command('send', order());
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('ftl_drive_type');
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('use_wormhole');
  });
  it.each([null, { ...transit(), ftl_drive_type: 'unknown' },
    { ...transit(), ftl_ready: 'true' }, { ...transit(), ftl_cooldown_remaining_s: -1 }])('refuses invalid transit status without substituting a generic drive: %j', async (status) => {
    api.get.mockImplementation(async (url) => url.includes('ftl_status') ? status : inventory());
    await domain.load();
    expect(domain.getState()).toMatchObject({ data: null, stale: true, error: 'Ungültiger Transitstatus vom Server.' });
    await expect(domain.command('send', order())).rejects.toThrow('aktualisieren');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('sends exact captured origin, mission, ship counts and decimal cargo without a local simulation', async () => {
    const changed = vi.fn();
    session.events.on('colony:mutation-accepted', changed);
    await domain.load();
    await domain.command('send', order());
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=send', {
      origin_colony_id: 1, mission: 'transport', target_galaxy: 2, target_system: 2000, target_position: 4,
      ships: { small_cargo: 2, bp_7: 1 }, cargo: { metal: 12.5, crystal: 0, deuterium: 0 },
      request_id: expect.any(String),
    }, { signal: expect.any(AbortSignal) });
    expect(changed).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'fleet-launch', allColonies: true });
    expect(domain.getState()).toMatchObject({ stale: false, error: '', mutating: false });
  });
  it('keeps the same request identity after a lost response even when refreshed inventory is depleted', async () => {
    await domain.load();
    api.post.mockRejectedValueOnce(new Error('Response lost after server commit'));
    await domain.command('send', order());
    const first = api.post.mock.calls[0][1];
    expect(first.request_id).toMatch(/^[a-f0-9-]{36}$/);
    api.get.mockImplementation(async (url) => url.includes('overview') ? overview()
      : url.includes('ftl_status') ? transit() : { success: true, ships: [], blueprints: [] });
    await domain.refresh();
    expect(domain.getState().data.ships).toEqual([]);
    await domain.command('send', order());
    expect(api.post.mock.calls[1][1]).toEqual(first);
    expect(domain.getState().error).toBe('');
  });
  it('issues a new identity only for a different order or an already acknowledged new launch', async () => {
    await domain.load();
    api.post.mockRejectedValueOnce(new Error('Uncertain result'));
    await domain.command('send', order());
    const originalId = api.post.mock.calls[0][1].request_id;
    await domain.command('send', { ...order(), target_position: 5 });
    const otherId = api.post.mock.calls[1][1].request_id;
    expect(otherId).not.toBe(originalId);
    await domain.command('send', order());
    expect(api.post.mock.calls[2][1].request_id).toBe(originalId);
    await domain.command('send', order());
    expect(api.post.mock.calls[3][1].request_id).not.toBe(originalId);
  });
  it.each([
    { mission: 'unknown' }, { target_galaxy: 10 }, { target_system: 1.5 }, { target_position: 0 },
    { ships: {} }, { ships: { unknown: 1 } }, { ships: { small_cargo: 5 } },
    { ships: { small_cargo: 1.5 } }, { ships: { small_cargo: -1 } },
    { cargo: { metal: -1, crystal: 0, deuterium: 0 } },
    { cargo: { metal: '', crystal: 0, deuterium: 0 } },
  ])('rejects invalid launch data before POST: %j', async (invalid) => {
    await domain.load();
    await expect(domain.command('send', { ...order(), ...invalid })).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('blocks stale inventory after failed read and after accepted launch with failed overview refresh', async () => {
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Inventory unavailable'));
    await domain.load();
    expect(domain.getState().stale).toBe(true);
    await expect(domain.command('send', order())).rejects.toThrow('aktualisieren');
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Overview unavailable'));
    await domain.command('send', order());
    expect(domain.getState()).toMatchObject({ stale: true, mutating: false });
    expect(domain.getState().error).toContain('Auftrag bestätigt');
    await expect(domain.command('send', order())).rejects.toThrow('aktualisieren');
    expect(api.post).toHaveBeenCalledOnce();
    await domain.refresh();
    expect(domain.getState().stale).toBe(false);
    expect(api.post).toHaveBeenCalledOnce();
  });
  it('aborts obsolete inventory on colony switch and ignores late replies', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.load();
    const signal = api.get.mock.calls[0][1].signal;
    session.selectColony(2);
    await domain.load();
    finish({ success: true, ships: [], blueprints: [] });
    await pending;
    expect(signal.aborted).toBe(true);
    expect(domain.getState()).toMatchObject({ colonyId: 2, stale: false });
    expect(domain.getState().data.ships).toHaveLength(2);
  });
  it('prevents duplicate launch and preserves the captured origin during a colony switch', async () => {
    await domain.load();
    let finish;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.command('send', order());
    session.selectColony(2);
    await domain.command('send', order());
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post.mock.calls[0][1].origin_colony_id).toBe(1);
    finish({ success: true });
    await pending;
    expect(domain.getState()).toMatchObject({ colonyId: 2, mutating: false, stale: false });
  });
  it.each(['read', 'send'])('aborts outstanding %s on logout without publishing a late success', async (kind) => {
    await domain.load();
    let finish;
    const method = kind === 'read' ? 'get' : 'post';
    api[method].mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = kind === 'read' ? domain.load() : domain.command('send', order());
    const signal = api[method].mock.calls.at(-1).at(-1).signal;
    const accepted = vi.fn();
    session.events.on('colony:mutation-accepted', accepted);
    domain.shutdown();
    expect(signal.aborted).toBe(true);
    finish(kind === 'read' ? inventory() : { success: true });
    await pending;
    expect(domain.getState()).toMatchObject({ data: null, mutating: false });
    expect(accepted).not.toHaveBeenCalled();
  });
  it.each([{ ships: null }, { ships: [{ type: 'bad', count: -1 }] },
    { blueprints: [{ type: 'small_cargo', count: 1 }] }])('reports malformed inventory: %j', async (invalid) => {
    api.get.mockResolvedValueOnce({ ...inventory(), ...invalid });
    await domain.load();
    expect(domain.getState().error).toContain('Ungültiger Schiffsbestand');
    expect(domain.getState().data).toBeNull();
  });
  it.each(['accepted', 'rejected', 'refresh'])('keeps pending map handoffs from changing the captured order (%s)', async (phase) => {
    const accepted = phase !== 'rejected';
    document.body.innerHTML = '<section id="wm-galaxy-section"></section><canvas id="starfield" tabindex="0"></canvas><button data-game-fleet-launch>Flotte</button>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 2000, position: 4 });
    const root = document.getElementById('game-fleet-command');
    await vi.waitFor(() => expect(root.textContent).toContain('small cargo'));
    const input = root.querySelector('[aria-label="small cargo (4 verfügbar)"]');
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    let finish;
    let reject;
    api[phase === 'refresh' ? 'get' : 'post'].mockImplementationOnce(() => new Promise((resolve, fail) => {
      finish = resolve;
      reject = fail;
    }));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(domain.getState().mutating).toBe(true);
    api.get.mockClear();
    session.events.emit('fleet:target-requested', { galaxy: 9, system: 99, position: 9 });
    session.events.emit('fleet:origin-requested', { colonyId: 2 });
    document.querySelector('[data-game-fleet-launch]').click();
    expect(root.querySelector('[role="alert"]').textContent).toContain('erst danach geändert');
    expect(session.getColony().id).toBe(1);
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('2000');
    expect(root.querySelector('[aria-label="small cargo (4 verfügbar)"]').value).toBe(phase === 'refresh' ? '0' : '2');
    expect(document.activeElement).toBe(root);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.post.mock.calls[0][1]).toMatchObject({ origin_colony_id: 1, target_system: 2000, ships: { small_cargo: 2 } });
    if (accepted) finish(phase === 'refresh' ? overview() : { success: true });
    else reject(new Error('Send rejected'));
    await vi.waitFor(() => expect(domain.getState().mutating).toBe(false));
    expect(root.textContent).not.toContain('erst danach geändert');
    expect(root.querySelector('[aria-label="small cargo (4 verfügbar)"]').value).toBe(accepted ? '0' : '2');
    if (!accepted) expect(root.querySelector('[role="alert"]').textContent).toContain('Send rejected');
    session.events.emit('fleet:target-requested', { galaxy: 9, system: 99, position: 9 });
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('99');
    session.events.emit('fleet:origin-requested', { colonyId: 2 });
    expect(session.getColony().id).toBe(2);
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
  });
  it('shows incomplete draft routes and cooldowns without claiming route clearance', async () => {
    api.get.mockImplementation(async (url) => url.includes('overview') ? overview()
      : url.includes('ftl_status') ? { ...transit(), ftl_ready: false, ftl_cooldown_remaining_s: 42 } : inventory());
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:origin-requested', { colonyId: 1 });
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    const root = document.getElementById('game-fleet-command');
    [...root.querySelectorAll('button')].find((item) => item.textContent === 'Zielwahl abbrechen').click();
    expect(root.querySelector('.game-fleet-command-route [data-empty="true"]')).not.toBeNull();
    expect(root.querySelector('.game-fleet-drive-status').textContent).toBe('Aufladung · 42 s (Serverstand)');
    const details = root.querySelector('.game-fleet-transit-details');
    expect(details.open).toBe(false);
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await domain.refresh();
    expect(root.querySelector('.game-fleet-transit-details').open).toBe(true);
    expect(root.querySelector('[aria-label="Flottensteuerung schließen"] svg')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('filters fleet inventory locally without dropping hidden selections, cargo or launch validation', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4 });
    const root = document.getElementById('game-fleet-command');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    api.get.mockClear();
    const search = () => root.querySelector('[aria-label="Schiffsbestand durchsuchen"]');
    const count = () => root.querySelector('[aria-label="Gefilterter Flottenbestand"]').textContent;
    const card = (type) => root.querySelector(`[data-ship-type="${type}"]`);
    const set = (element, value) => {
      element.value = value;
      element.dispatchEvent(new Event('input'));
    };
    const toggle = () => [...root.querySelectorAll('button')].find((item) => item.textContent === 'Nur gewählte');
    const form = root.querySelector('form');
    const ship = card('small_cargo').querySelector('input');
    set(ship, '2');
    set(root.querySelector('[aria-label="Fracht Metall"]'), '12.5');
    search().focus();
    set(search(), ' SMALL_CARGO ');
    expect(count()).toBe('1 von 2 Schiffstypen angezeigt.');
    expect(document.activeElement).toBe(search());
    expect(search().closest('form')).toBeNull();
    expect(card('bp_7').hidden).toBe(true);
    set(search(), 'small cargo');
    expect(count()).toBe('1 von 2 Schiffstypen angezeigt.');
    set(search(), 'bp_7');
    expect(card('small_cargo').hidden).toBe(true);
    expect(ship.value).toBe('2');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toBe('small cargo: 2');
    toggle().click();
    expect(count()).toBe('0 von 2 Schiffstypen angezeigt.');
    expect(root.textContent).toContain('Keine passenden Schiffstypen.');
    expect(root.querySelector('form')).toBe(form);
    expect(root.querySelector('[aria-label="Fracht Metall"]').value).toBe('12.5');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    await domain.refresh();
    expect(search().value).toBe('bp_7');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(count()).toBe('0 von 2 Schiffstypen angezeigt.');
    const reset = [...root.querySelectorAll('button')].find((item) => item.textContent === 'Flottenfilter zurücksetzen');
    reset.click();
    expect(document.activeElement).toBe(search());
    expect(count()).toBe('2 von 2 Schiffstypen angezeigt.');
    expect(reset.disabled).toBe(true);
    toggle().click();
    const currentShip = card('small_cargo').querySelector('input');
    currentShip.focus();
    set(currentShip, '-1');
    expect(card('small_cargo').hidden).toBe(false);
    set(currentShip, '');
    expect(card('small_cargo').hidden).toBe(false);
    set(currentShip, '0');
    expect(card('small_cargo').hidden).toBe(true);
    expect(document.activeElement).toBe(search());
    toggle().click();
    set(currentShip, '2');
    set(search(), 'absent');
    api.post.mockRejectedValueOnce(new Error('Rejected test launch'));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(api.post.mock.calls[0][1]).toMatchObject({ ships: { small_cargo: 2 }, cargo: { metal: 12.5 } });
    await vi.waitFor(() => expect(root.textContent).toContain('Rejected test launch'));
    const detachedSearch = search();
    cleanup();
    set(detachedSearch, 'small');
    expect(count()).toBe('0 von 2 Schiffstypen angezeigt.');
  });
  it('quickly selects all available ships or clears the draft without sending a command', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4 });
    const root = document.getElementById('game-fleet-command');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    api.get.mockClear();

    [...root.querySelectorAll('button')]
      .find((item) => item.textContent === 'Alle verfügbaren übernehmen').click();

    expect(root.querySelector('[data-ship-type="small_cargo"] input').value).toBe('4');
    expect(root.querySelector('[data-ship-type="bp_7"] input').value).toBe('2');
    expect(root.querySelector('[data-ship-type="small_cargo"] [data-ship-selection-status]').textContent)
      .toBe('4 von 4 ausgewählt');
    expect(root.querySelector('[data-ship-type="bp_7"] [data-ship-selection-status]').textContent)
      .toBe('2 von 2 ausgewählt');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('small cargo: 4');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();

    [...root.querySelectorAll('button')].find((item) => item.textContent === 'Schiffsauswahl leeren').click();

    expect(root.querySelector('[data-ship-type="small_cargo"] input').value).toBe('0');
    expect(root.querySelector('[data-ship-type="bp_7"] input').value).toBe('0');
    expect(root.querySelector('[data-ship-type="small_cargo"] [data-ship-selection-status]').textContent)
      .toBe('0 von 4 ausgewählt');
    expect(root.querySelector('[data-ship-type="bp_7"] [data-ship-selection-status]').textContent)
      .toBe('0 von 2 ausgewählt');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toBe('Keine Schiffe gewählt.');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('increments and decrements ship counts within available inventory without sending a command', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4 });
    const root = document.getElementById('game-fleet-command');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    api.get.mockClear();

    const input = root.querySelector('[data-ship-type="small_cargo"] input');
    const increase = root.querySelector('[aria-label="small cargo erhöhen"]');
    const decrease = root.querySelector('[aria-label="small cargo verringern"]');
    const maximum = root.querySelector('[aria-label="small cargo maximal auswählen"]');
    expect(decrease.disabled).toBe(true);

    increase.click();
    expect(input.value).toBe('1');
    expect(decrease.disabled).toBe(false);
    increase.click();
    increase.click();
    increase.click();
    expect(input.value).toBe('4');
    expect(increase.disabled).toBe(true);
    expect(maximum.disabled).toBe(true);
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('small cargo: 4');

    decrease.click();
    expect(input.value).toBe('3');
    expect(increase.disabled).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();

    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    maximum.click();
    expect(input.value).toBe('4');
    expect(root.querySelector('[data-ship-type="bp_7"] input').value).toBe('0');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('updates safe draft chips without requests, replacing inputs or losing focus and restores them after refresh', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section>';
    cleanup = mountFleetCommandOverlay({ domain, fleets: { load: vi.fn() }, session });
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 20, position: 4 });
    const root = document.getElementById('game-fleet-command');
    await vi.waitFor(() => expect(domain.getState().loading).toBe(false));
    api.get.mockClear();
    const form = root.querySelector('form');
    const input = root.querySelector('[data-ship-type="bp_7"] input');
    const set = (element, value) => {
      element.value = value;
      element.dispatchEvent(new Event('input'));
    };
    input.focus();
    set(input, '2');
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('form')).toBe(form);
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toBe('<img src=x>: 2');
    expect(root.querySelector('img')).toBeNull();
    set(input, '-1');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('Ungültige Menge');
    set(input, '9007199254740992');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('Ungültige Menge');
    const otherShip = root.querySelector('[data-ship-type="small_cargo"] input');
    set(otherShip, '2');
    root.querySelector('[data-ship-type="bp_7"] .game-fleet-quantity-controls button:last-child').click();
    expect(input.value).toBe('0');
    expect(otherShip.value).toBe('2');
    expect(root.querySelector('[data-ship-type="bp_7"] [data-ship-selection-status]').textContent)
      .toBe('0 von 2 ausgewählt');
    set(input, '2');
    set(root.querySelector('[aria-label="Fracht Metall"]'), '1.25');
    set(root.querySelector('[aria-label="Fracht Kristall"]'), '3');
    const cargo = root.querySelector('[aria-label="Gewählte Fracht"]');
    expect([...cargo.children].map((item) => item.textContent)).toEqual(['Metall: 1.25', 'Kristall: 3']);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    await domain.refresh();
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toBe('small cargo: 2<img src=x>: 2');
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent).toContain('Metall: 1.25');
    const detached = root.querySelector('[aria-label="Fracht Metall"]');
    cleanup();
    set(detached, '9');
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent).toContain('Metall: 1.25');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('prefills target without changing origin, preserves rejected draft and clears accepted composition even if refresh fails', async () => {
    document.body.innerHTML = '<section id="wm-galaxy-section"></section><canvas id="starfield" tabindex="0"></canvas>';
    const fleets = { load: vi.fn() };
    cleanup = mountFleetCommandOverlay({ domain, fleets, session });
    const root = document.getElementById('game-fleet-command');
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 2000, position: 4 });
    await vi.waitFor(() => expect(root.textContent).toContain('small cargo'));
    expect(document.activeElement).toBe(root);
    expect(session.getColony().id).toBe(1);
    expect(root.querySelector('img')).toBeNull();
    const input = (label) => root.querySelector(`[aria-label="${label}"]`);
    const fill = (label, value) => {
      input(label).value = value;
      input(label).dispatchEvent(new Event('input'));
    };
    expect(input('Zielsystem').value).toBe('2000');
    expect(root.textContent).toContain('Aereth · Alcubierre-Warp');
    const mission = root.querySelector('[aria-label="Mission"]');
    const shipInput = root.querySelector('[aria-label="small cargo (4 verfügbar)"]');
    expect(root.querySelector('.game-fleet-mission-preview p').textContent)
      .toContain('ausgewählte Metall-, Kristall- und Deuteriumfracht');
    shipInput.value = '2';
    shipInput.dispatchEvent(new Event('input'));
    mission.value = 'attack';
    mission.dispatchEvent(new Event('change'));
    expect(root.querySelector('.game-fleet-mission').textContent).toBe('Angriff');
    expect(root.querySelector('.game-fleet-mission-preview p').textContent)
      .toContain('PvP-Modus und Schutzregeln prüft der Server.');
    expect(root.querySelector(`#${mission.getAttribute('aria-describedby')}`).textContent)
      .toContain('PvP-Modus und Schutzregeln prüft der Server.');
    expect(shipInput.isConnected).toBe(true);
    expect(shipInput.value).toBe('2');
    expect(root.querySelector('[data-ship-type="small_cargo"] [data-ship-selection-status]').textContent)
      .toBe('2 von 4 ausgewählt');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toBe('small cargo: 2');
    expect(root.querySelector('[aria-label="Summe gewählter Schiffe"]').textContent)
      .toBe('Insgesamt 2 Schiffe ausgewählt.');
    fill('Fracht Metall', '12.5');
    fill('Fracht Kristall', '3');
    fill('Fracht Deuterium', '8');
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent)
      .toBe('Metall: 12.5Kristall: 3Deuterium: 8');
    fill('Fracht Metall', '-1');
    const metalInput = root.querySelector('[aria-label="Fracht Metall"]');
    expect(metalInput.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector(`#${metalInput.getAttribute('aria-describedby')}`).textContent)
      .toBe('Gib eine Zahl größer oder gleich null ein.');
    expect(root.querySelector(`#${metalInput.getAttribute('aria-describedby')}`).hidden).toBe(false);
    expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(root.textContent).toContain('Frachtwerte müssen gültige Zahlen größer oder gleich null sein.');
    root.querySelector('[aria-label="Metall aus der Fracht leeren"]').click();
    expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(root.querySelector('[role="status"]').textContent)
      .not.toContain('Frachtwerte müssen gültige Zahlen größer oder gleich null sein.');
    fill('Fracht Metall', '12.5');
    root.querySelector('[aria-label="Metall aus der Fracht leeren"]').click();
    expect(metalInput.value).toBe('0');
    expect(metalInput.hasAttribute('aria-invalid')).toBe(false);
    expect(root.querySelector(`#${metalInput.getAttribute('aria-describedby')}`).hidden).toBe(true);
    expect(root.querySelector('[aria-label="Fracht Kristall"]').value).toBe('3');
    expect(root.querySelector('[aria-label="Fracht Deuterium"]').value).toBe('8');
    fill('Fracht Metall', '-1');
    root.querySelector('[aria-label="Metall aus der Fracht leeren"]').click();
    expect(root.querySelector('[aria-label="Fracht Metall"]').value).toBe('0');
    expect(root.querySelector('[aria-label="Fracht Kristall"]').value).toBe('3');
    root.querySelector('[aria-label="Gesamte Fracht im Entwurf leeren"]').click();
    expect(root.querySelector('[aria-label="Fracht Metall"]').value).toBe('0');
    expect(root.querySelector('[aria-label="Fracht Kristall"]').value).toBe('0');
    expect(root.querySelector('[aria-label="Fracht Deuterium"]').value).toBe('0');
    expect(root.querySelector('[aria-label="Metall aus der Fracht leeren"]').disabled).toBe(true);
    expect(root.querySelector('[aria-label="Kristall aus der Fracht leeren"]').disabled).toBe(true);
    expect(root.querySelector('[aria-label="Deuterium aus der Fracht leeren"]').disabled).toBe(true);
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent).toBe('Keine Fracht gewählt.');
    expect(root.querySelector('[aria-label="small cargo (4 verfügbar)"]').value).toBe('2');
    expect(root.querySelector('[aria-label="Mission"]').value).toBe('attack');
    expect(root.querySelector('[aria-label="Zielsystem"]').value).toBe('2000');
    expect(api.post).not.toHaveBeenCalled();
    const blueprintInput = root.querySelector('[data-ship-type="bp_7"] input');
    blueprintInput.value = '1';
    blueprintInput.dispatchEvent(new Event('input'));
    shipInput.value = '5';
    shipInput.dispatchEvent(new Event('input'));
    expect(root.querySelector('[data-ship-type="small_cargo"] [data-ship-selection-status]').textContent)
      .toBe('Gültig: 0 bis 4.');
    expect(root.querySelector('[data-ship-type="small_cargo"] [data-ship-selection-status]').dataset.invalid).toBe('true');
    expect(shipInput.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector(`#${shipInput.getAttribute('aria-describedby')}`).textContent).toBe('Gültig: 0 bis 4.');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('Ungültige Menge');
    expect(root.querySelector('[aria-label="Summe gewählter Schiffe"]').textContent).toBe('Schiffsmengen prüfen.');
    expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(root.textContent).toContain('Schiffsmengen müssen ganze Zahlen innerhalb des verfügbaren Bestands sein.');
    blueprintInput.value = '0';
    blueprintInput.dispatchEvent(new Event('input'));
    expect(blueprintInput.hasAttribute('aria-invalid')).toBe(false);
    shipInput.value = '1.5';
    shipInput.dispatchEvent(new Event('input'));
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toContain('Ungültige Menge');
    expect(root.querySelector('[data-ship-type="small_cargo"] [data-ship-selection-status]').textContent)
      .toBe('Gib eine ganze Zahl ein.');
    fill('Fracht Metall', '');
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent).toContain('Ungültige Menge');
    fill('Fracht Metall', '0');
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent).toBe('Keine Fracht gewählt.');
    mission.value = 'transport';
    mission.dispatchEvent(new Event('change'));
    shipInput.value = '0';
    shipInput.dispatchEvent(new Event('input'));
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toBe('Keine Schiffe gewählt.');
    expect(root.querySelector('[aria-label="Summe gewählter Schiffe"]').textContent)
      .toBe('Insgesamt 0 Schiffe ausgewählt.');
    expect(root.querySelector('.game-fleet-transit').dataset.ready).toBe('true');
    expect(root.querySelector('.game-fleet-transit h3 svg')).not.toBeNull();
    expect(root.querySelector('[data-ship-type="small_cargo"] .game-fleet-selection-stock').textContent).toBe('4 verfügbar');
    expect(root.querySelector('[data-ship-type="small_cargo"] input').max).toBe('4');
    expect(root.querySelectorAll('.game-fleet-selection')).toHaveLength(2);
    expect(root.querySelectorAll('.game-fleet-selection')[1].querySelectorAll('svg')).toHaveLength(3);
    expect(root.querySelector('progress, meter')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(root.querySelector('.game-fleet-transit-details').open).toBe(false);
    expect(root.querySelector('[aria-label="Geplante Route"]').textContent).toContain('[2:2000:4]');
    expect(root.querySelectorAll('.game-fleet-command-route .game-fleet-endpoint svg')).toHaveLength(2);
    expect(root.querySelector('.game-fleet-command-route .game-fleet-endpoint:last-child button').textContent)
      .toBe('Ziel im Spielfeld ändern');
    const coordinateInput = input('Zielsystem');
    coordinateInput.focus();
    fill('Zielsystem', '2001');
    expect(root.querySelector('[aria-label="Geplante Route"]').textContent).toContain('[2:2001:4]');
    expect(document.activeElement).toBe(coordinateInput);
    fill('Zielsystem', '2000');
    fill('small cargo (4 verfügbar)', '2');
    fill('Zielposition', '');
    expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(root.textContent).toContain('Für ein Koordinatenziel müssen Galaxie, System und Position vollständig sein.');
    expect(root.querySelector('.game-fleet-command-steps [aria-current="step"]').textContent).toContain('Ziel');
    const positionInput = input('Zielposition');
    expect(positionInput.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector(`#${positionInput.getAttribute('aria-describedby')}`).textContent)
      .toContain('Galaxie, System und Position vollständig');
    fill('Zielposition', '4');
    expect(positionInput.hasAttribute('aria-invalid')).toBe(false);
    expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(root.querySelector('.game-fleet-command-steps [aria-current="step"]').textContent).toContain('Flotte prüfen');
    const galaxyInput = input('Zielgalaxie');
    fill('Zielgalaxie', '10');
    expect(galaxyInput.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector(`#${galaxyInput.getAttribute('aria-describedby')}`).textContent)
      .toContain('ganze Zahl von 1 bis 9');
    expect(root.textContent).toContain('Zielkoordinaten müssen innerhalb der gültigen Ganzzahlbereiche liegen.');
    expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(root.querySelector('.game-fleet-command-steps [aria-current="step"]').textContent).toContain('Ziel');
    fill('Zielgalaxie', '2');
    expect(galaxyInput.hasAttribute('aria-invalid')).toBe(false);
    expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(root.querySelector('.game-fleet-command-steps [aria-current="step"]').textContent).toContain('Flotte prüfen');
    fill('small cargo (4 verfügbar)', '0');
    expect(root.querySelector('.game-fleet-drive-status').textContent).toBe('Keine globale Aufladung');
    const picking = vi.fn();
    const unsubscribePicking = session.events.on('fleet:target-picking', picking);
    const pickButton = () => [...root.querySelectorAll('button')]
      .find((item) => item.getAttribute('aria-label') === 'Flottenziel im 3D-Spielfeld ändern');
    pickButton().click();
    expect(document.activeElement).toBe(document.getElementById('starfield'));
    expect(root.querySelector('form')).toBeNull();
    expect(picking).toHaveBeenLastCalledWith({ active: true });
    document.getElementById('starfield').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picking).toHaveBeenLastCalledWith({ active: false });
    expect(document.activeElement)
      .toBe(root.querySelector('[aria-label="Flottenziel im 3D-Spielfeld ändern"]'));
    expect(input('Zielsystem').value).toBe('2000');
    expect(root.querySelector('form')).not.toBeNull();
    unsubscribePicking();
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(api.post).not.toHaveBeenCalled();
    fill('small cargo (4 verfügbar)', '2');
    expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
    fill('Fracht Metall', '25');
    api.post.mockRejectedValueOnce(new Error('Not enough fuel'));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Not enough fuel'));
    expect(input('small cargo (4 verfügbar)').value).toBe('2');
    expect(input('Fracht Metall').value).toBe('25');
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent).toBe('Metall: 25');
    api.get.mockRejectedValueOnce(new Error('Overview unavailable'));
    root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Auftrag bestätigt'));
    expect(input('small cargo (4 verfügbar)').value).toBe('0');
    expect(input('Fracht Metall').value).toBe('0');
    expect(root.querySelector('[aria-label="Gewählte Schiffe"]').textContent).toBe('Keine Schiffe gewählt.');
    expect(root.querySelector('[aria-label="Gewählte Fracht"]').textContent).toBe('Keine Fracht gewählt.');
    expect(input('Zielsystem').value).toBe('2000');
    expect(fleets.load).toHaveBeenCalledOnce();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('starfield'));
    session.events.emit('fleet:target-requested', { galaxy: 2, system: 2000, position: 4 });
    expect(root.hidden).toBe(false);
    expect(document.activeElement).toBe(root);
    session.selectColony(2);
    await vi.waitFor(() => expect(root.textContent).toContain('Herkunft: Other'));
    expect(input('Zielsystem').value).toBe('');
    cleanup();
    cleanup = null;
    expect(document.getElementById('game-fleet-command')).toBeNull();
    session.events.emit('fleet:target-requested', { galaxy: 1, system: 10, position: 3 });
    expect(document.getElementById('game-fleet-command')).toBeNull();
  });
});
