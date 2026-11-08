import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFleetDomain } from '../../js/engine/runtime/server-fleet-domain.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { mountFleetWindow } from '../../js/ui/game-fleets.js';

const fleet = () => ({
  id: '7', mission: 'transport', origin_colony_id: '1',
  origin_galaxy: '1', origin_system: '10', origin_position: '3',
  target_galaxy: '2', target_system: '20', target_position: '4',
  fleet_label: '<img src=x>', target_system_name: '<script>bad()</script>',
  hull_damage_pct: '10',
  ships: { small_cargo: 2 }, cargo_metal: '100', cargo_crystal: '0', cargo_deuterium: '0',
  departure_time: '2026-11-03 10:00:00', arrival_time: '2026-11-03 11:00:00', returning: '0',
});
const overview = () => ({ success: true, user_meta: {}, fleets: [],
  colonies: [{ id: 1, name: 'Home' }, { id: 2, name: 'Other' }] });
describe('Authoritative fleet commands and window', () => {
  let api;
  let session;
  let domain;
  let current;
  let unmount;
  beforeEach(async () => {
    current = [fleet()];
    api = {
      get: vi.fn(async (url) => url.includes('overview') ? overview()
        : url.includes('battle_reports') ? { success: true, battle_reports: [] }
          : { success: true, fleets: structuredClone(current) }),
      post: vi.fn(async (url) => {
        current = url.endsWith('recall') ? [{ ...fleet(), returning: '1' }] : [];
        return { success: true };
      }),
    };
    session = createServerGameSession(api);
    await session.refresh();
    domain = createFleetDomain({ api, session });
    api.get.mockClear();
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    domain.shutdown();
    session.shutdown();
    document.body.replaceChildren();
  });
  it('only reads account-wide canonical missions on load, independently of colony selection', async () => {
    await domain.load();
    session.selectColony(2);
    expect(api.get).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=list', { signal: expect.any(AbortSignal) });
    expect(api.post).not.toHaveBeenCalled();
    const copy = domain.getState();
    copy.fleets[0].ships.small_cargo = 99;
    expect(domain.getState().fleets[0].ships.small_cargo).toBe(2);
  });
  it('uses participant-scoped read endpoints for battle reports without issuing commands', async () => {
    const controller = new AbortController();
    api.get.mockResolvedValueOnce({ success: true, battle_reports: [] });
    expect(await domain.battleReports({ signal: controller.signal })).toEqual({
      success: true, battle_reports: [],
    });
    expect(api.get).toHaveBeenLastCalledWith('api/reports.php?action=battle_reports', {
      signal: controller.signal,
    });
    await domain.battleEncounterForReport(38);
    expect(api.get).toHaveBeenLastCalledWith('api/fleet.php?action=battle_encounter&report_id=38', {});
    await expect(domain.battleEncounterForReport(0)).rejects.toThrow('Ungültige Schlachtbericht-ID');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('recalls a loaded outbound fleet then refreshes overview and canonical list without optimistic progress', async () => {
    await domain.load();
    await domain.command('recall', 7);
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=recall', { fleet_id: 7 }, { signal: expect.any(AbortSignal) });
    expect(api.get.mock.calls.map(([url]) => url)).toEqual([
      'api/fleet.php?action=list', 'api/game.php?action=overview', 'api/fleet.php?action=list',
    ]);
    expect(domain.getState()).toMatchObject({ mutating: false, stale: false, fleets: [{ returning: '1' }] });
    await domain.command('recall', 7);
    expect(api.post).toHaveBeenCalledOnce();
    expect(domain.getState().error).toContain('bereits auf dem Rückweg');
  });
  it('only processes arrivals explicitly and invalidates visible colony data after server acceptance', async () => {
    const changed = vi.fn();
    session.events.on('colony:mutation-accepted', changed);
    await domain.load();
    await domain.refresh();
    expect(api.post).not.toHaveBeenCalled();
    await domain.command('check');
    expect(api.post).toHaveBeenCalledExactlyOnceWith('api/fleet.php?action=check', {}, { signal: expect.any(AbortSignal) });
    expect(domain.getState().fleets).toEqual([]);
    expect(changed).toHaveBeenCalledExactlyOnceWith({ colonyId: 1, domain: 'fleets', allColonies: true });
  });
  it.each([
    { fleets: null }, { fleets: [{ ...fleet(), returning: 'bad' }] },
    { fleets: [{ ...fleet(), hull_damage_pct: -1 }] },
    { fleets: [{ ...fleet(), hull_damage_pct: 101 }] },
    { fleets: [{ ...fleet(), hull_damage_pct: '10.5' }] },
    { fleets: [{ ...fleet(), ships: null }] }, { fleets: [fleet(), fleet()] },
    { fleets: [{ ...fleet(), target_system: -1 }] }, { success: false, fleets: [] },
  ])('reports malformed read data and preserves the last confirmed missions: %j', async (invalid) => {
    await domain.load();
    api.get.mockResolvedValueOnce({ success: true, ...invalid });
    expect(await domain.load()).toBe(false);
    expect(domain.getState()).toMatchObject({ stale: true, error: 'Ungültige Flottendaten vom Server.', fleets: [{ id: '7' }] });
    await domain.command('recall', 7);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('rejects unknown commands and unloaded IDs without POST and reports rejected server orders', async () => {
    await domain.command('recall', 7);
    await domain.load();
    await domain.command('unknown');
    await domain.command('recall', 999);
    expect(api.post).not.toHaveBeenCalled();
    api.post.mockRejectedValueOnce(new Error('Server rejected recall'));
    await domain.command('recall', 7);
    expect(domain.getState()).toMatchObject({ error: 'Server rejected recall', fleets: [{ returning: '0' }], mutating: false });
  });
  it('serializes commands, aborts pre-command reads and discards late list responses', async () => {
    await domain.load();
    let finishRead;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const pendingRead = domain.load();
    const signal = api.get.mock.calls.at(-1)[1].signal;
    let finishCommand;
    api.post.mockImplementationOnce(() => new Promise((resolve) => { finishCommand = resolve; }));
    const pendingCommand = domain.command('recall', 7);
    expect(signal.aborted).toBe(true);
    await domain.command('check');
    await domain.load();
    expect(api.post).toHaveBeenCalledOnce();
    current = [{ ...fleet(), returning: '1' }];
    finishCommand({ success: true });
    await pendingCommand;
    finishRead({ success: true, fleets: [] });
    await pendingRead;
    expect(domain.getState().fleets[0].returning).toBe('1');
  });
  it('does not resubmit accepted recalls when overview refresh fails and requires a fresh list', async () => {
    await domain.load();
    api.get.mockRejectedValueOnce(new Error('Overview offline'));
    await domain.command('recall', 7);
    expect(domain.getState()).toMatchObject({ stale: true, mutating: false });
    expect(domain.getState().error).toContain('Befehl bestätigt');
    await domain.command('recall', 7);
    expect(api.post).toHaveBeenCalledOnce();
    await domain.refresh();
    expect(domain.getState()).toMatchObject({ stale: false, error: '', fleets: [{ returning: '1' }] });
    expect(api.post).toHaveBeenCalledOnce();
  });
  it('does not acknowledge malformed POST responses or emit arrival invalidation for rejected commands', async () => {
    const changed = vi.fn();
    session.events.on('colony:mutation-accepted', changed);
    await domain.load();
    api.post.mockResolvedValueOnce({ success: false, error: 'Rejected' });
    await domain.command('check');
    expect(changed).not.toHaveBeenCalled();
    expect(domain.getState()).toMatchObject({ error: 'Rejected', fleets: [{ returning: '0' }], stale: false });
    api.post.mockResolvedValueOnce(null);
    await domain.command('check');
    expect(domain.getState().error).toContain('Ungültige Befehlsantwort');
    expect(changed).not.toHaveBeenCalled();
  });
  it('discards obsolete reads without reporting them as current errors', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = domain.load();
    const signal = api.get.mock.calls.at(-1)[1].signal;
    await domain.load();
    finish({ success: false });
    await pending;
    expect(signal.aborted).toBe(true);
    expect(domain.getState()).toMatchObject({ loading: false, stale: false, error: '', fleets: [{ id: '7' }] });
  });
  it('retains accepted-command warnings if the post-command list fails', async () => {
    await domain.load();
    api.get.mockResolvedValueOnce(overview()).mockRejectedValueOnce(new Error('List offline'));
    await domain.command('check');
    expect(domain.getState().error).toContain('Befehl bestätigt, Liste');
    expect(domain.getState().stale).toBe(true);
    await domain.refresh();
    expect(domain.getState()).toMatchObject({ fleets: [], stale: false, error: '' });
    expect(api.post).toHaveBeenCalledOnce();
  });
  it.each(['read', 'command'])('aborts pending %s on logout and ignores its late response', async (kind) => {
    await domain.load();
    let finish;
    const method = kind === 'read' ? 'get' : 'post';
    api[method].mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = kind === 'read' ? domain.load() : domain.command('recall', 7);
    const signal = api[method].mock.calls.at(-1).at(-1).signal;
    domain.shutdown();
    expect(signal.aborted).toBe(true);
    finish({ success: true, fleets: [fleet()] });
    await pending;
    expect(domain.getState()).toMatchObject({ fleets: null, mutating: false, loading: false });
  });
  it('renders safe fleet cards, map links, returning states and tears down window bindings', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const trigger = document.createElement('button');
    trigger.dataset.gameFleets = '';
    document.body.append(trigger);
    let config;
    const wm = { body: () => root, register: vi.fn((id, options) => { config = options; }),
      minimize: vi.fn(), close: vi.fn(), open: vi.fn(() => config.onRender()) };
    const galaxy = { navigate: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy, wm: attachWindowWidgets(wm) });
    trigger.click();
    await vi.waitFor(() => expect(root.textContent).toContain('small cargo'));
    expect(root.textContent).toContain('<img src=x>');
    expect(root.querySelector('img, script')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(root.querySelector('.game-fleet-card').dataset.direction).toBe('outbound');
    expect(root.querySelector('.game-fleet-mission').textContent).toBe('Transport');
    expect(root.querySelector('.game-fleet-route').getAttribute('aria-label')).toBe('Hinflug zum Ziel');
    expect(root.querySelector('.game-fleet-route-arrow').textContent).toBe('→');
    expect(root.querySelector('[data-endpoint="origin"]').textContent).toContain('[1:10:3]');
    expect(root.querySelector('[data-endpoint="target"]').textContent).toContain('[2:20:4]');
    expect(root.querySelector('[aria-label="Schiffe"]').textContent).toBe('2 small cargo');
    expect(root.querySelectorAll('[aria-label="Fracht"] svg')).toHaveLength(3);
    expect(root.querySelector('[aria-label="Fracht"]').textContent).toBe('100 Metall0 Kristall0 Deuterium');
    expect(root.querySelector('.game-fleet-arrival').textContent).toContain('Ankunft2026-11-03 11:00:00Serverzeit');
    expect(root.querySelector('details').open).toBe(false);
    expect(root.querySelector('details').textContent).toContain('Abflug: 2026-11-03 10:00:00');
    expect(root.querySelector('progress, meter')).toBeNull();
    const button = (label) => [...root.querySelectorAll('button')].find((item) => item.textContent === label);
    button('Ziel im Spielfeld').click();
    expect(wm.minimize).toHaveBeenCalledWith('fleet');
    expect(galaxy.navigate).toHaveBeenCalledWith('2', '20');
    button('Herkunft im Spielfeld').click();
    expect(galaxy.navigate).toHaveBeenLastCalledWith('1', '10');
    button('Flotte zurückrufen').click();
    await vi.waitFor(() => expect(button('Flotte zurückrufen').disabled).toBe(true));
    await vi.waitFor(() => expect(root.querySelector('.game-fleet-direction').textContent).toBe('Rückflug'));
    expect(root.querySelector('.game-fleet-card').dataset.direction).toBe('return');
    expect(root.querySelector('.game-fleet-route').getAttribute('aria-label')).toBe('Rückflug zur Herkunft');
    expect(root.querySelector('.game-fleet-route-arrow').textContent).toBe('←');
    expect(root.querySelector('.game-fleet-arrival').textContent).toContain('Rückkehr');
    const oldMapButton = button('Ziel im Spielfeld');
    const oldRecallButton = button('Flotte zurückrufen');
    const posts = api.post.mock.calls.length;
    unmount();
    unmount = null;
    trigger.click();
    oldMapButton.click();
    oldRecallButton.dispatchEvent(new MouseEvent('click'));
    expect(api.post).toHaveBeenCalledTimes(posts);
    expect(wm.open).toHaveBeenCalledOnce();
    expect(galaxy.navigate).toHaveBeenCalledTimes(2);
    expect(wm.close).toHaveBeenCalledWith('fleet');
    expect(config.onRender).toBeNull();
  });
  it('opens a Hero replay only from a participant-authorized completed encounter', async () => {
    const report = { id: 38, role: 'attacker', replay_available: true, created_at: '2026-11-08 12:00:00',
      report: { attacker_wins: true } };
    const encounter = { id: 21, status: 'resolved', battle_report_id: 38 };
    api.get.mockImplementation(async (url) => {
      if (url.includes('action=battle_reports')) return { success: true, battle_reports: [report] };
      if (url.includes('action=battle_encounter')) return { success: true, encounter };
      if (url.includes('action=list')) return { success: true, fleets: structuredClone(current) };
      return { success: true };
    });
    const root = document.createElement('div');
    document.body.append(root);
    let config;
    const wm = { body: () => root, register: vi.fn((id, options) => { config = options; }),
      close: vi.fn(), minimize: vi.fn(), open: vi.fn(() => config.onRender()) };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });
    const onReplay = vi.fn();
    window.addEventListener('gq:show-battle-encounter', onReplay);

    wm.open('fleet');
    await vi.waitFor(() => expect(root.querySelector('[data-battle-replay-report="38"]')).not.toBeNull());
    root.querySelector('[data-battle-replay-report="38"]').click();
    await vi.waitFor(() => expect(onReplay).toHaveBeenCalledOnce());

    expect(onReplay.mock.calls[0][0].detail).toBe(encounter);
    expect(api.get).toHaveBeenCalledWith(
      'api/fleet.php?action=battle_encounter&report_id=38',
      { signal: expect.any(AbortSignal) },
    );
    expect(wm.minimize).toHaveBeenCalledWith('fleet');
    window.removeEventListener('gq:show-battle-encounter', onReplay);
  });
  it('does not offer Hero replay for historical reports without a resolved encounter journal', async () => {
    const reports = [
      { id: 38, role: 'attacker', replay_available: true, report: { attacker_wins: true } },
      { id: 39, role: 'defender', replay_available: false, report: { attacker_wins: false } },
      { id: 40, role: 'attacker', report: { attacker_wins: true } },
    ];
    api.get.mockImplementation(async (url) => url.includes('action=battle_reports')
      ? { success: true, battle_reports: reports }
      : { success: true, fleets: structuredClone(current) });
    const root = document.createElement('div');
    document.body.append(root);
    let config;
    const wm = { body: () => root, register: vi.fn((id, options) => { config = options; }),
      close: vi.fn(), minimize: vi.fn(), open: vi.fn(() => config.onRender()) };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });

    wm.open('fleet');
    await vi.waitFor(() => expect(root.querySelectorAll('[data-battle-report-id]').length).toBe(3));

    expect(root.querySelector('[data-battle-replay-report="38"]')).not.toBeNull();
    expect(root.querySelector('[data-battle-report-id="39"] [data-battle-replay-report]')).toBeNull();
    expect(root.querySelector('[data-battle-report-id="40"] [data-battle-replay-report]')).toBeNull();
    expect(root.querySelectorAll('.game-development-card p').length).toBeGreaterThan(0);
    expect(root.querySelector('[data-battle-report-id="39"]').textContent)
      .toContain('Replay ist für diesen Bericht nicht verfügbar.');
    expect(root.querySelector('[data-battle-report-id="39"]').textContent).not.toContain('historischer Bericht');
  });
  it('uses linked local filter fields and preserves each fleet disclosure independently across updates and filtering', async () => {
    current = [fleet(), { ...fleet(), id: '8', returning: '1' }];
    const root = document.createElement('div');
    document.body.append(root);
    const wm = { body: () => root, register: vi.fn(), close: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });
    await domain.load();
    const direction = root.querySelector('[aria-label="Flugrichtung"]');
    expect(root.querySelector(`label[for="${direction.id}"]`).textContent).toBe('Flugrichtung');
    expect(document.getElementById(direction.getAttribute('aria-describedby')).textContent).toContain('keine Flottenbefehle');
    expect(root.querySelector('.game-fleet-dashboard-summary').classList.contains('wm-properties')).toBe(true);
    const times = id => root.querySelector(`[data-fleet-id="${id}"] details`);
    times('7').open = true;
    root.querySelector('.game-fleet-dashboard-help').open = true;
    direction.value = 'return';
    direction.dispatchEvent(new Event('change'));
    expect(times('7')).toBeNull();
    expect(times('8').open).toBe(false);
    await domain.refresh();
    expect(root.querySelector('[aria-label="Flugrichtung"]').value).toBe('return');
    const select = root.querySelector('[aria-label="Flugrichtung"]');
    select.value = 'all';
    select.dispatchEvent(new Event('change'));
    expect(times('7').open).toBe(true);
    expect(times('8').open).toBe(false);
    expect(root.querySelector('.game-fleet-dashboard-help').open).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
    current = [];
    await domain.refresh();
    expect(root.querySelector('.wm-notice[data-state="empty"]').textContent).toContain('Keine laufenden Flottenmissionen.');
    expect([...root.querySelectorAll('.game-fleet-dashboard-summary dd')].map(e => e.textContent)).toEqual(['0', '0', '0']);
  });
  it('searches and combines table filters independently of cards, sorts raw ship totals and coordinates and retains state on refresh', async () => {
    current = [
      { ...fleet(), fleet_label: 'Transport 10', ships: { small_cargo: '10' }, target_system: '20' },
      { ...fleet(), id: '8', fleet_label: 'Transport 2', returning: '1', ships: { small_cargo: '2', fighter: '1' }, target_system: '3' },
      { ...fleet(), id: '9', fleet_label: 'Angriff', mission: 'attack', ships: { fighter: '1' }, target_system: '10' },
    ];
    const root = document.createElement('div');
    document.body.append(root);
    const wm = { body: () => root, register: vi.fn(), close: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });
    await domain.load();
    api.get.mockClear();
    const table = () => root.querySelector('.game-fleet-table');
    const rows = () => [...table().querySelectorAll('tbody tr')].filter(row => !row.querySelector('.wm-table-empty'));
    const visible = () => rows().filter(row => !row.hidden);
    const disclosure = root.querySelector('.game-fleet-measurements');
    disclosure.open = true;
    const cards = [...root.querySelectorAll('.game-fleet-card')];
    const search = table().querySelector('input');
    search.focus();
    search.value = 'fighter';
    search.dispatchEvent(new Event('input'));
    expect(visible()).toHaveLength(2);
    expect(document.activeElement).toBe(search);
    const mission = table().querySelector('[aria-label="Tabellenmission"]');
    mission.value = 'transport';
    mission.dispatchEvent(new Event('change'));
    expect(visible()).toHaveLength(1);
    expect(visible()[0].firstChild.textContent).toBe('Transport 2');
    const direction = table().querySelector('[aria-label="Tabellenflugrichtung"]');
    direction.value = 'outbound';
    direction.dispatchEvent(new Event('change'));
    expect(visible()).toHaveLength(0);
    expect(table().querySelector('.wm-table-empty').textContent).toContain('Keine Einsätze');
    expect([...root.querySelectorAll('.game-fleet-card')]).toEqual(cards);
    expect(api.get).not.toHaveBeenCalled();
    table().querySelector('.wm-table-tools > button').click();
    table().querySelectorAll('thead th button')[5].click();
    expect(rows().map(row => row.children[5].textContent)).toEqual(['1', '3', '10']);
    table().querySelectorAll('thead th button')[4].click();
    expect(rows().map(row => row.firstChild.textContent)).toEqual(['Transport 2', 'Angriff', 'Transport 10']);
    table().querySelectorAll('thead th button')[0].click();
    expect(rows().map(row => row.firstChild.textContent)).toEqual(['Angriff', 'Transport 2', 'Transport 10']);
    const refreshedMission = table().querySelector('[aria-label="Tabellenmission"]');
    refreshedMission.value = 'attack';
    refreshedMission.dispatchEvent(new Event('change'));
    await domain.refresh();
    expect(root.querySelector('.game-fleet-measurements').open).toBe(true);
    expect(table().querySelector('[aria-label="Tabellenmission"]').value).toBe('attack');
    expect(table().querySelector('thead th').getAttribute('aria-sort')).toBe('ascending');
    current = [current[0]];
    await domain.refresh();
    expect(table().querySelector('[aria-label="Tabellenmission"]').value).toBe('attack');
    expect(visible()).toHaveLength(0);
    expect(root.querySelectorAll('.game-fleet-card')).toHaveLength(1);
    table().querySelector('.wm-table-tools > button').click();
    expect(visible()).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('keeps empty ship totals at zero and renders unknown table missions as safe text', async () => {
    current = [{ ...fleet(), mission: '<img src=x>', ships: { small_cargo: 0 } }];
    const root = document.createElement('div');
    document.body.append(root);
    const wm = { body: () => root, register: vi.fn(), close: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });
    await domain.load();
    const table = () => root.querySelector('.game-fleet-table');
    expect(table().querySelector('tbody tr').children[5].textContent).toBe('0');
    expect(table().querySelector('tbody tr').children[1].textContent).toBe('Mission: <img src=x>');
    expect(table().querySelector('img, script')).toBeNull();
    current = [];
    await domain.refresh();
    expect(table().querySelector('.wm-table-empty').textContent).toBe('Keine laufenden Flottenmissionen.');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('renders empty ship inventories and zero cargo without invented quantities', async () => {
    current = [{ ...fleet(), ships: { small_cargo: 0 }, cargo_metal: '0' }];
    const root = document.createElement('div');
    const wm = { body: () => root, register: vi.fn(), close: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });
    expect(root.querySelector('.game-fleet-dashboard-summary')).toBeNull();
    const loading = domain.load();
    expect(root.querySelector('[aria-label="Ankunftsverarbeitung"] button').disabled).toBe(true);
    await loading;
    expect(root.querySelector('[aria-label="Schiffe"]').textContent).toBe('Keine Schiffe');
    expect(root.querySelector('[aria-label="Fracht"]').textContent).toBe('0 Metall0 Kristall0 Deuterium');
    expect(api.post).not.toHaveBeenCalled();
    current = [];
    await domain.load();
    expect(root.textContent).toContain('Keine laufenden Flottenmissionen.');
    expect(root.querySelector('.game-fleet-card')).toBeNull();
    expect([...root.querySelectorAll('.game-fleet-dashboard-summary dd')].map(e => e.textContent)).toEqual(['0', '0', '0']);
  });
  it('combines local mission and direction filters, retains zero matches on refresh and resets without reads', async () => {
    current = [fleet(), { ...fleet(), id: '8', mission: 'attack', returning: '1' },
      { ...fleet(), id: '9', mission: 'attack' }, { ...fleet(), id: '10', mission: '<img src=x>' }];
    const root = document.createElement('div');
    document.body.append(root);
    const wm = { body: () => root, register: vi.fn(), close: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });
    await domain.load();
    const calls = api.get.mock.calls.length;
    const missionButton = mission => root.querySelector(`[data-mission="${mission}"]`).closest('button');
    expect(root.querySelectorAll('.game-fleet-card')).toHaveLength(4);
    expect(root.querySelector('.game-fleet-dashboard-header svg')).not.toBeNull();
    expect(root.querySelector('.game-fleet-dashboard-help').open).toBe(false);
    expect(root.querySelector('[data-game-fleet-launch]').classList.contains('btn-primary')).toBe(true);
    expect([...root.querySelectorAll('.game-fleet-dashboard-summary dd')].map(e => e.textContent)).toEqual(['4', '3', '1']);
    expect(missionButton('attack').textContent).toBe('Angriff (2)');
    missionButton('attack').click();
    expect(root.querySelectorAll('.game-fleet-card')).toHaveLength(2);
    expect(document.activeElement).toBe(missionButton('attack'));
    expect(missionButton('attack').getAttribute('aria-pressed')).toBe('true');
    let direction = root.querySelector('[aria-label="Flugrichtung"]');
    direction.value = 'return';
    direction.dispatchEvent(new Event('change'));
    expect(root.querySelectorAll('.game-fleet-card')).toHaveLength(1);
    expect(root.querySelector('.game-fleet-card').dataset.fleetId).toBe('8');
    expect(root.textContent).toContain('1 von 4 Missionen angezeigt.');
    expect([...root.querySelectorAll('.game-fleet-dashboard-summary dd')].map(e => e.textContent)).toEqual(['4', '3', '1']);
    expect(document.activeElement).toBe(root.querySelector('[aria-label="Flugrichtung"]'));
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(api.post).not.toHaveBeenCalled();
    current = [fleet()];
    await domain.load();
    expect(root.querySelectorAll('.game-fleet-card')).toHaveLength(0);
    expect(root.textContent).toContain('Keine Missionen für diese Filter.');
    expect(missionButton('attack').textContent).toBe('Angriff (0)');
    direction = root.querySelector('[aria-label="Flugrichtung"]');
    expect(direction.value).toBe('return');
    const reads = api.get.mock.calls.length;
    [...root.querySelectorAll('button')].find(e => e.textContent === 'Filter zurücksetzen').click();
    expect(root.querySelectorAll('.game-fleet-card')).toHaveLength(1);
    expect(root.querySelector('[aria-label="Flugrichtung"]').value).toBe('all');
    expect(document.activeElement).toBe(root.querySelector('[data-mission-filter-index="0"]'));
    expect(api.get).toHaveBeenCalledTimes(reads);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('filters unknown server missions safely and disables detached filters after unmount', async () => {
    current = [{ ...fleet(), mission: '<img src=x>' }, { ...fleet(), id: '8' }];
    const root = document.createElement('div');
    const wm = { body: () => root, register: vi.fn(), close: vi.fn() };
    unmount = mountFleetWindow({ domain, galaxy: {}, wm: attachWindowWidgets(wm) });
    await domain.load();
    const unknown = root.querySelector('.game-fleet-filter-missions [data-mission="unknown"]').closest('button');
    expect(unknown.textContent).toBe('Mission: <img src=x> (1)');
    expect(root.querySelector('img')).toBeNull();
    unknown.click();
    expect(root.querySelectorAll('.game-fleet-card')).toHaveLength(1);
    expect(root.querySelector('.game-fleet-card').dataset.fleetId).toBe('7');
    const all = root.querySelector('[data-mission-filter-index="0"]');
    unmount();
    unmount = null;
    const before = root.innerHTML;
    all.click();
    expect(root.innerHTML).toBe(before);
    expect(api.post).not.toHaveBeenCalled();
  });
});
import { attachWindowWidgets } from './helpers/window-widget-fixture.js';
