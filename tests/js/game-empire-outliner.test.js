import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountEmpireOutliner } from '../../js/ui/game-empire-outliner.js';
import { createServerGameSession } from '../../js/engine/runtime/server-game-session.js';
import { createGalaxyDomain } from '../../js/engine/runtime/server-galaxy-domain.js';

describe('Empire outliner', () => {
  let session;
  let galaxy;
  let api;
  let unmount;
  const colonies = [
    { id: 1, name: '<img src=x>', galaxy: 1, system: 10, position: 3 },
    { id: 2, name: 'New Hope', galaxy: 2, system: 20, position: 5 },
  ];
  beforeEach(async () => {
    api = { get: vi.fn(async (url) => {
      if (url.includes('game.php')) return { success: true, user_meta: {}, colonies, fleets: [] };
      if (url.includes('action=stars')) return { success: true, galaxy: 2, stars: [] };
      return { success: true, galaxy: 2, system: 20, planets: [],
        star_system: { x_ly: 1, y_ly: 2, z_ly: 3 } };
    }) };
    session = createServerGameSession(api);
    await session.refresh();
    galaxy = createGalaxyDomain({ api, session });
    document.body.innerHTML = '<div id="host"></div>';
    unmount = mountEmpireOutliner({ host: document.getElementById('host'), session, galaxy });
    api.get.mockClear();
  });
  afterEach(() => {
    unmount?.();
    galaxy.shutdown();
    session.shutdown();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  const row = (id) => document.querySelector(`[data-colony-id="${id}"]`);
  function management() {
    unmount();
    const opened = new Map();
    const wm = {
      isOpen: (id) => opened.has(id),
      isMinimized: (id) => opened.get(id) === true,
      open: vi.fn((id) => {
        opened.set(id, false);
        window.dispatchEvent(new CustomEvent('wm:window-state-changed'));
      }),
    };
    unmount = mountEmpireOutliner({ host: document.getElementById('host'), session, galaxy, wm,
      windows: [['buildings', 'Gebäude'], ['research', 'Forschung']] });
    return { wm, opened };
  }
  it('opens management windows for the active colony and focuses their existing title', async () => {
    const { wm } = management();
    const title = document.createElement('span');
    title.className = 'wm-title';
    const win = document.createElement('section');
    win.id = 'wm-win-buildings';
    win.append(title);
    document.body.append(win);
    const control = document.querySelector('[data-empire-window="buildings"]');
    const heading = document.querySelector('.game-empire-management-header > strong');
    expect(heading.textContent).toBe('Verwalten: <img src=x>');
    expect(heading.querySelector('img')).toBeNull();
    expect(control.querySelector('svg')).not.toBeNull();
    expect(document.querySelectorAll('.game-stock-row')).toHaveLength(5);
    control.click();
    expect(wm.open).toHaveBeenCalledExactlyOnceWith('buildings');
    expect(control.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(title);
    expect(api.get).not.toHaveBeenCalled();
    row(2).querySelector('button').click();
    expect(heading.textContent).toBe('Verwalten: New Hope');
    document.querySelector('[data-empire-window="research"]').click();
    expect(wm.open).toHaveBeenLastCalledWith('research');
    expect(session.getColony().id).toBe(2);
    await vi.waitFor(() => expect(galaxy.getState().loading).toBe(false));
  });
  it('refreshes the visual stock overview from server data while preserving action focus', async () => {
    management();
    const button = document.querySelector('[data-empire-window="buildings"]');
    button.focus();
    api.get.mockResolvedValueOnce({ success: true, user_meta: {}, fleets: [],
      colonies: [{ ...colonies[0], metal: 100, crystal: 25 }] });
    await session.refresh();
    expect(document.querySelector('[data-resource="metal"] .game-stock-value').textContent).toBe('100');
    expect(document.querySelector('[data-resource="crystal"] .game-stock-track > span').style.width).toBe('25%');
    expect(document.activeElement).toBe(button);
    expect(document.querySelector('.game-empire-management-header > strong').textContent).toContain(colonies[0].name);
    expect(document.querySelector('.game-empire-management-header > .game-empire-coordinates').textContent)
      .toBe('[1:10:3]');
  });
  it('restores minimized windows, tracks external visibility and cleans up management listeners', () => {
    const { wm, opened } = management();
    const control = document.querySelector('[data-empire-window="buildings"]');
    opened.set('buildings', true);
    window.dispatchEvent(new CustomEvent('wm:window-state-changed'));
    expect(control.getAttribute('aria-pressed')).toBe('false');
    control.click();
    expect(control.getAttribute('aria-pressed')).toBe('true');
    opened.set('buildings', true);
    window.dispatchEvent(new CustomEvent('wm:window-state-changed'));
    expect(control.getAttribute('aria-pressed')).toBe('false');
    control.click();
    expect(control.getAttribute('aria-pressed')).toBe('true');
    unmount();
    unmount = null;
    wm.open.mockClear();
    control.click();
    opened.clear();
    window.dispatchEvent(new CustomEvent('wm:window-state-changed'));
    expect(wm.open).not.toHaveBeenCalled();
    expect(control.getAttribute('aria-pressed')).toBe('true');
  });
  it('reports unavailable windows and disables management when the active colony disappears', async () => {
    const { wm } = management();
    wm.open.mockImplementation(() => {});
    const control = document.querySelector('[data-empire-window="buildings"]');
    control.click();
    expect(document.querySelector('.game-empire-management [role="status"]').textContent)
      .toBe('Gebäude konnte nicht geöffnet werden.');
    control.focus();
    api.get.mockResolvedValueOnce({ success: true, user_meta: {}, colonies: [], fleets: [] });
    await session.refresh();
    expect(control.disabled).toBe(true);
    expect(document.querySelector('.game-empire-management').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('input'));
    expect(document.querySelector('.game-empire-management [role="status"]').textContent).toBe('');
  });
  it('reorders existing colony rows to match server updates while retaining focus and search', async () => {
    const first = row(1);
    const second = row(2);
    const search = document.getElementById('game-empire-search');
    search.value = 'o';
    search.dispatchEvent(new Event('input'));
    const focused = second.querySelector('[data-empire-action="select"]');
    focused.focus();
    api.get.mockResolvedValueOnce({ success: true, user_meta: {}, fleets: [],
      colonies: [colonies[1], { id: 3, name: 'Other', galaxy: 3, system: 30, position: 4 }, colonies[0]] });
    await session.refresh();
    const list = document.querySelector('ul');
    expect([...list.children].map(element => element.dataset.colonyId)).toEqual(['2', '3', '1']);
    expect(row(1)).toBe(first);
    expect(row(2)).toBe(second);
    expect(search.value).toBe('o');
    expect(document.activeElement).toBe(focused);
    expect(first.hidden).toBe(true);
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    focused.dispatchEvent(down);
    expect(document.activeElement).toBe(row(3).querySelector('[data-empire-action="select"]'));
    const reordered = vi.fn();
    const observer = new MutationObserver(reordered);
    observer.observe(list, { childList: true });
    try {
      api.get.mockResolvedValueOnce({ success: true, user_meta: {}, fleets: [],
        colonies: [colonies[1], { id: 3, name: 'Other', galaxy: 3, system: 30, position: 4 }, colonies[0]] });
      await session.refresh();
      expect(reordered).not.toHaveBeenCalled();
      expect(observer.takeRecords()).toEqual([]);
    } finally {
      observer.disconnect();
    }
  });
  it('uses existing overview data safely without requesting data or commands at mount', () => {
    const header = document.querySelector('.game-empire-search-header');
    expect(header.querySelector('label').htmlFor).toBe(header.querySelector('input').id);
    expect(header.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(header.closest('section').querySelector('ul')).not.toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    expect(document.querySelector('summary').textContent).toBe('Imperium · 2 Kolonien');
    expect(document.querySelector('summary svg')).not.toBeNull();
    expect(document.querySelector('details').open).toBe(true);
    expect(row(1).querySelector('img')).toBeNull();
    expect(row(1).textContent).toContain('<img src=x>');
    expect(row(1).querySelector('button').getAttribute('aria-pressed')).toBe('true');
    expect(row(2).querySelector('button').getAttribute('aria-pressed')).toBe('false');
    expect(row(1).dataset.active).toBe('true');
    expect(row(1).querySelector('.game-empire-active-badge').hidden).toBe(false);
    expect(row(2).querySelector('.game-empire-active-badge').hidden).toBe(true);
  });
  it('filters by name or coordinates without replacing focused rows and provides an empty state', () => {
    const search = document.querySelector('[aria-label="Kolonien nach Name oder Koordinaten durchsuchen"]');
    const first = row(1);
    const filter = (value) => { search.value = value; search.dispatchEvent(new Event('input')); };
    filter('HOPE');
    expect(first.hidden).toBe(true);
    expect(row(2).hidden).toBe(false);
    filter('1:10:3');
    expect(first.hidden).toBe(false);
    expect(row(2).hidden).toBe(true);
    filter('missing');
    expect(document.querySelector('.game-empire-outliner-empty p').textContent).toBe('Keine passenden Kolonien.');
    filter('');
    expect(row(1)).toBe(first);
  });
  it('matches accent-insensitive tokens across names and coordinates in any order', async () => {
    api.get.mockResolvedValueOnce({ success: true, user_meta: {}, fleets: [],
      colonies: [colonies[0], { ...colonies[1], name: 'Métal Haven' }] });
    await session.refresh();
    api.get.mockClear();
    const search = document.getElementById('game-empire-search');
    const original = row(2);
    for (const query of ['HAVEN metal', '20:5   metal', 'me\u0301tal haven']) {
      search.value = query;
      search.dispatchEvent(new Event('input'));
      expect(row(1).hidden).toBe(true);
      expect(row(2)).toBe(original);
      expect(row(2).hidden).toBe(false);
    }
    search.value = 'metal missing';
    search.dispatchEvent(new Event('input'));
    expect(row(2).hidden).toBe(true);
    expect(session.getColony().id).toBe(1);
    expect(api.get).not.toHaveBeenCalled();
  });
  it('retains the committed search during composition and server refreshes, then applies the final text once', async () => {
    const search = document.getElementById('game-empire-search');
    search.value = 'Hope';
    search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new CompositionEvent('compositionstart'));
    search.value = 'unfinished';
    search.dispatchEvent(new InputEvent('input', { isComposing: true }));
    expect(row(2).hidden).toBe(false);
    await session.refresh();
    expect(row(2).hidden).toBe(false);
    expect(search.value).toBe('unfinished');
    search.value = '1:10:3';
    search.dispatchEvent(new CompositionEvent('compositionend'));
    expect(row(1).hidden).toBe(false);
    expect(row(2).hidden).toBe(true);
    const observer = new MutationObserver(() => {});
    observer.observe(document.getElementById('game-empire-outliner'), { subtree: true, childList: true, attributes: true });
    try {
      search.dispatchEvent(new InputEvent('input'));
      expect(observer.takeRecords()).toEqual([]);
    } finally {
      observer.disconnect();
    }
  });
  it('focuses first and last visible results from search without activating them', () => {
    const search = document.getElementById('game-empire-search');
    const select = vi.spyOn(session, 'selectColony');
    for (const [key, id] of [['ArrowDown', 1], ['ArrowUp', 2]]) {
      search.focus();
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      search.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(row(id).querySelector('[data-empire-action="select"]'));
    }
    search.value = 'Hope';
    search.dispatchEvent(new Event('input'));
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(row(2).querySelector('[data-empire-action="select"]'));
    expect(select).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });
  it.each(['select', 'locate'])('navigates visible %s actions without activating them or wrapping', async (action) => {
    api.get.mockResolvedValueOnce({ success: true, user_meta: {}, fleets: [],
      colonies: [...colonies, { id: 3, name: 'Third', galaxy: 3, system: 30, position: 5 }] });
    await session.refresh();
    api.get.mockClear();
    const select = vi.spyOn(session, 'selectColony');
    const control = id => row(id).querySelector(`[data-empire-action="${action}"]`);
    function press(key, id) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      document.activeElement.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(control(id));
    }
    control(1).focus();
    press('ArrowUp', 1);
    press('ArrowDown', 2);
    press('End', 3);
    press('ArrowDown', 3);
    press('Home', 1);
    if (action === 'locate') control(2).disabled = true;
    else row(2).hidden = true;
    press('ArrowDown', 3);
    press('ArrowUp', 1);
    expect(select).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('preserves native result keys and ignores modified, handled or composing navigation', () => {
    const control = row(1).querySelector('button');
    control.focus();
    for (const options of [{ key: 'Tab' }, { key: 'Enter' }, { key: ' ' }, { key: 'ArrowLeft' },
      { key: 'ArrowDown', ctrlKey: true }, { key: 'ArrowDown', isComposing: true }]) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(control);
    }
    const handled = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    handled.preventDefault();
    control.dispatchEvent(handled);
    expect(document.activeElement).toBe(control);
    unmount();
    unmount = null;
    const detached = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    control.dispatchEvent(detached);
    expect(detached.defaultPrevented).toBe(false);
  });
  it('leaves native search keys, composition, modifiers and empty results untouched', () => {
    const search = document.getElementById('game-empire-search');
    search.focus();
    for (const options of [{ key: 'ArrowDown', isComposing: true }, { key: 'ArrowDown', ctrlKey: true },
      { key: 'ArrowUp', shiftKey: true }, { key: 'ArrowDown', altKey: true },
      { key: 'ArrowUp', metaKey: true }, { key: 'ArrowLeft' }, { key: 'Enter' }, { key: 'Tab' }]) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
      search.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(search);
    }
    search.dispatchEvent(new CompositionEvent('compositionstart'));
    const composing = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    search.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    search.dispatchEvent(new CompositionEvent('compositionend'));
    search.value = 'missing';
    search.dispatchEvent(new Event('input'));
    const empty = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    search.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(search);
    unmount();
    unmount = null;
    const detached = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    search.dispatchEvent(detached);
    expect(detached.defaultPrevented).toBe(false);
  });
  it('separates active management colony from map navigation and avoids repeat selection requests', async () => {
    const select = vi.spyOn(session, 'selectColony');
    const locate = row(2).querySelector('[data-empire-action="locate"]');
    locate.click();
    await vi.waitFor(() => expect(galaxy.getState().system?.system).toBe(20));
    expect(session.getColony().id).toBe(1);
    expect(select).not.toHaveBeenCalled();
    const choose = row(2).querySelector('button');
    choose.focus();
    choose.click();
    expect(session.getColony().id).toBe(2);
    expect(choose.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(choose);
    choose.click();
    expect(select).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(galaxy.getState().loading).toBe(false));
  });
  it('disables repeated navigation while loading and surfaces canonical navigation errors', async () => {
    let finish;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const locate = row(2).querySelector('[data-empire-action="locate"]');
    locate.focus();
    locate.click();
    expect(locate.disabled).toBe(true);
    expect(document.activeElement).toBe(row(2).querySelector('[data-empire-action="select"]'));
    expect(session.getColony().id).toBe(1);
    expect(locate.closest('ul').getAttribute('aria-busy')).toBe('true');
    expect(document.getElementById(locate.getAttribute('aria-describedby')).getAttribute('role')).toBe('status');
    expect(document.querySelector('[role="status"]').textContent).toContain('geladen');
    locate.click();
    expect(api.get).toHaveBeenCalledTimes(1);
    finish({ success: false });
    await vi.waitFor(() => expect(locate.disabled).toBe(false));
    expect(locate.closest('ul').getAttribute('aria-busy')).toBe('false');
    expect(document.activeElement).toBe(row(2).querySelector('[data-empire-action="select"]'));
    expect(document.querySelector('[role="status"]').textContent).toBe(galaxy.getState().error);
    expect(galaxy.getState().error).not.toBe('');
  });
  it('does not collapse during composition or after a foreground control handles Escape', () => {
    const panel = document.getElementById('game-empire-outliner');
    const input = panel.querySelector('input');
    input.value = 'New';
    input.dispatchEvent(new Event('input'));
    input.focus();
    const composing = new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true, isComposing: true,
    });
    input.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    expect(panel.open).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('New');
    input.addEventListener('keydown', event => event.preventDefault(), { once: true });
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel.open).toBe(true);
    expect(document.activeElement).toBe(input);
    const dismiss = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(dismiss);
    expect(dismiss.defaultPrevented).toBe(true);
    expect(panel.open).toBe(true);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel.open).toBe(false);
    expect(document.activeElement).toBe(panel.querySelector('summary'));
    expect(api.get).not.toHaveBeenCalled();
  });
  it('collapses on Escape, handles colony removal and cleans up subscriptions', async () => {
    const button = row(2).querySelector('button');
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('details').open).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('summary'));
    document.querySelector('details').open = true;
    button.focus();
    api.get.mockResolvedValueOnce({ success: true, user_meta: {}, colonies: [colonies[0]], fleets: [] });
    await session.refresh();
    expect(row(2)).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('input'));
    const panel = document.querySelector('details');
    unmount();
    unmount = null;
    expect(document.getElementById('game-empire-outliner')).toBeNull();
    session.shutdown();
    expect(panel.querySelector('summary').textContent).toBe('Imperium · 1 Kolonie');
  });
  it('recovers search locally with stable rows, result counts and no active-colony change', () => {
    const search = document.getElementById('game-empire-search');
    const clear = document.querySelector('[aria-label="Koloniesuche löschen"]');
    const recover = document.querySelector('.game-empire-outliner-empty button');
    const first = row(1);
    expect(clear.disabled).toBe(true);
    for (const control of [clear, recover]) {
      search.value = 'missing';
      search.dispatchEvent(new Event('input'));
      expect(document.querySelector('.game-empire-search-results').textContent).toBe('0 von 2 Kolonien');
      control.focus();
      control.click();
      expect(search.value).toBe('');
      expect(document.activeElement).toBe(search);
      expect(row(1)).toBe(first);
      expect(row(1).hidden).toBe(false);
      expect(document.querySelector('.game-empire-search-results').textContent).toBe('2 von 2 Kolonien');
      expect(session.getColony().id).toBe(1);
    }
    expect(api.get).not.toHaveBeenCalled();
    unmount();
    unmount = null;
    search.value = 'detached';
    clear.click();
    recover.click();
    expect(search.value).toBe('detached');
  });
  it('removes recovery actions for empty data and restores focus before hiding them', async () => {
    const search = document.getElementById('game-empire-search');
    search.value = 'missing';
    search.dispatchEvent(new Event('input'));
    const recover = document.querySelector('.game-empire-outliner-empty button');
    recover.focus();
    api.get.mockResolvedValueOnce({ success: true, user_meta: {}, colonies: [], fleets: [] });
    await session.refresh();
    expect(recover.hidden).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(document.querySelector('.game-empire-outliner-empty p').textContent).toBe('Keine Kolonien vorhanden.');
    expect(document.querySelector('.game-empire-search-results').textContent).toBe('0 von 0 Kolonien');
  });
});
