import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountGameOverlayShell } from '../../js/ui/game-overlay-shell.js';

describe('Minimal overlay shell', () => {
  let unmount;
  function windowManager() {
    document.body.innerHTML = '<section id="topbar-section"><div id="topbar-player"></div></section>'
      + '<section id="resource-section"></section>';
    const windows = new Map();
    const notify = (id, action) => window.dispatchEvent(new CustomEvent('wm:window-state-changed', { detail: { id, action } }));
    const wm = {
      isOpen: (id) => windows.has(id), isMinimized: (id) => windows.get(id)?.minimized === true,
      open: vi.fn((id) => {
        windows.set(id, { minimized: false });
        if (!document.getElementById(`wm-win-${id}`)) {
          const element = document.createElement('section');
          element.id = `wm-win-${id}`;
          element.innerHTML = '<span class="wm-title"></span>';
          document.body.append(element);
        }
        notify(id, 'open');
      }),
      minimize: vi.fn((id) => { windows.get(id).minimized = true; notify(id, 'minimize'); }),
      restore: vi.fn((id) => { windows.get(id).minimized = false; notify(id, 'restore'); }),
      saveLayoutProfile: vi.fn(() => true),
      loadLayoutProfile: vi.fn(() => true),
    };
    function add(id, layer, minimized = false) {
      const element = document.createElement('section');
      element.id = `wm-win-${id}`;
      element.style.zIndex = String(layer);
      element.innerHTML = '<input aria-label="Draft" value="4.5">';
      document.body.append(element);
      windows.set(id, { minimized });
      notify(id, 'open');
      return element;
    }
    return { wm, windows, add, notify };
  }
  afterEach(() => {
    unmount?.();
    unmount = null;
    document.body.replaceChildren();
    document.body.className = '';
  });
  it('starts collapsed, preserves existing controls and restores their positions on logout', () => {
    document.body.innerHTML = '<section id="topbar-section"><div id="topbar-player"><button>Play</button></div></section>'
      + '<section id="resource-section"><nav class="game-development-actions"><button>Gebäude</button></nav>'
      + '<button data-resource="metal">Metall</button></section>'
      + '<section id="taskbar-section"><div id="wm-taskbar"></div></section>';
    const audio = document.getElementById('topbar-player');
    const topbar = document.getElementById('topbar-section');
    const resources = document.getElementById('resource-section');
    const gameActions = resources.querySelector('.game-development-actions');
    const taskbar = document.getElementById('taskbar-section');
    unmount = mountGameOverlayShell();
    expect(document.getElementById('game-overlay-dockbars').classList.contains('game-overlay-dockbars')).toBe(true);
    expect([...document.querySelectorAll('#game-overlay-dockbars [data-dock-side]')]
      .map((bar) => bar.dataset.dockSide)).toEqual(['top', 'bottom', 'left', 'right']);
    expect(document.getElementById('game-overlay-dockbars').getAttribute('aria-hidden')).toBe('true');
    const drawer = document.getElementById('game-command-overlay');
    const toggle = document.getElementById('game-command-toggle');
    const resourceMenu = document.querySelector('.game-overlay-resource-menu');
    expect(drawer.hidden).toBe(true);
    expect(audio.closest('.game-overlay-dock')).not.toBeNull();
    expect(drawer.contains(topbar)).toBe(true);
    expect(resourceMenu.contains(resources)).toBe(true);
    expect(resourceMenu.contains(gameActions)).toBe(false);
    expect(drawer.contains(gameActions)).toBe(true);
    expect(resourceMenu.open).toBe(false);
    expect(drawer.contains(taskbar)).toBe(true);
    resourceMenu.querySelector('summary').click();
    expect(resourceMenu.open).toBe(true);
    toggle.click();
    expect(resourceMenu.open).toBe(true);
    document.querySelector('[data-resource]').click();
    expect(resourceMenu.open).toBe(false);
    expect(drawer.hidden).toBe(true);
    toggle.click();
    expect(drawer.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(drawer.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    toggle.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(drawer.hidden).toBe(true);
    unmount();
    unmount = null;
    expect(audio.parentElement).toBe(topbar);
    expect(topbar.parentElement).toBe(document.body);
    expect(resources.parentElement).toBe(document.body);
    expect(gameActions.parentElement).toBe(resources);
    expect(taskbar.parentElement).toBe(document.body);
    expect(document.getElementById('game-overlay-shell')).toBeNull();
    expect(document.body.classList.contains('game-overlay-layout')).toBe(false);
  });
  it('gets the command drawer out of the way for game commands or switching the fleet origin', () => {
    document.body.innerHTML = '<section id="topbar-section"><div id="topbar-player"></div>'
      + '<select id="game-colony-select"><option>Home</option></select></section>'
      + '<section id="resource-section"><button data-game-fleet-launch>Flotte</button><button data-game-shipyard>Werft</button><button data-game-market>Markt</button><button data-game-population>Bevölkerung</button><button data-resource="population">100</button>'
      + '<button data-game-development="buildings">Gebäude</button><button data-game-development="research">Forschung</button><button data-game-economy>Wirtschaft</button><button data-game-fleets>Flotten</button><button data-resource="metal">Metall</button></section>'
      + '<section id="taskbar-section"><button class="wm-task-btn">Gebäude</button></section>'
      + '<section id="game-fleet-command" hidden></section>';
    unmount = mountGameOverlayShell();
    const drawer = document.getElementById('game-command-overlay');
    const toggle = document.getElementById('game-command-toggle');
    toggle.click();
    document.querySelector('[data-game-fleet-launch]').click();
    expect(drawer.hidden).toBe(true);
    toggle.click();
    document.querySelector('[data-game-shipyard]').click();
    expect(drawer.hidden).toBe(true);
    toggle.click();
    document.querySelector('[data-game-market]').click();
    expect(drawer.hidden).toBe(true);
    for (const selector of ['[data-game-population]', '[data-resource="population"]', '[data-game-development="buildings"]',
      '[data-game-development="research"]', '[data-game-economy]', '[data-game-fleets]', '[data-resource="metal"]', '.wm-task-btn']) {
      toggle.click();
      document.querySelector(selector).click();
      expect(drawer.hidden).toBe(true);
    }
    toggle.click();
    document.getElementById('game-colony-select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(drawer.hidden).toBe(false);
    document.getElementById('game-fleet-command').hidden = false;
    document.getElementById('game-colony-select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(drawer.hidden).toBe(true);
  });
  it('keeps the dock and command drawer above promoted game windows without polling', () => {
    document.body.innerHTML = '<section id="topbar-section"><div id="topbar-player"></div></section>'
      + '<section id="resource-section"></section><section class="wm-window" style="z-index:2700"></section>';
    unmount = mountGameOverlayShell();
    const root = document.getElementById('game-overlay-shell');
    const toggle = document.getElementById('game-command-toggle');
    expect(root.style.zIndex).toBe('2701');
    toggle.click();
    expect(root.style.zIndex).toBe('2701');
    toggle.click();
    expect(root.style.zIndex).toBe('2701');
    document.querySelector('.wm-window').style.zIndex = '2800';
    window.dispatchEvent(new CustomEvent('wm:focus-changed', { detail: { id: 'test' } }));
    expect(root.style.zIndex).toBe('2801');
    toggle.click();
    expect(root.style.zIndex).toBe('2801');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.style.zIndex).toBe('2801');
    unmount();
    unmount = null;
    document.querySelector('.wm-window').style.zIndex = '2900';
    window.dispatchEvent(new CustomEvent('wm:focus-changed', { detail: { id: 'test' } }));
    expect(root.style.zIndex).toBe('2801');
  });
  it('moves focus into selected task windows, or back to the dock after minimization', () => {
    const { wm, add } = windowManager();
    const element = add('trade', 300);
    element.insertAdjacentHTML('afterbegin', '<span class="wm-title">Markt</span>');
    const taskbar = document.createElement('section');
    taskbar.id = 'taskbar-section';
    taskbar.innerHTML = '<button class="wm-task-btn" id="wm-task-trade">Markt</button>';
    document.body.append(taskbar);
    unmount = mountGameOverlayShell({ wm });
    const toggle = document.getElementById('game-command-toggle');
    const drawer = document.getElementById('game-command-overlay');
    const task = document.getElementById('wm-task-trade');
    for (const modifier of ['ctrlKey', 'metaKey']) {
      toggle.click();
      task.dispatchEvent(new MouseEvent('click', { bubbles: true, [modifier]: true }));
      expect(drawer.hidden).toBe(false);
      toggle.click();
    }
    toggle.click();
    task.click();
    expect(drawer.hidden).toBe(true);
    expect(document.activeElement).toBe(element.querySelector('.wm-title'));
    wm.minimize('trade');
    toggle.click();
    task.click();
    expect(drawer.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });
  it('lets players dynamically show and hide colony, galaxy, and economy windows', () => {
    const { wm } = windowManager();
    unmount = mountGameOverlayShell({ wm });
    const buildings = document.querySelector('[data-window-id="buildings"]');
    const fleet = document.querySelector('[data-window-id="fleet"]');
    const market = document.querySelector('[data-window-id="trade"]');
    expect(buildings.closest('.game-window-picker-group').querySelector('strong').textContent).toBe('Kolonie');
    expect(fleet.closest('.game-window-picker-group').querySelector('strong').textContent).toBe('Galaxie');
    expect(market.closest('.game-window-picker-group').querySelector('strong').textContent).toBe('Wirtschaft');
    expect(buildings.getAttribute('aria-pressed')).toBe('false');

    document.getElementById('game-command-toggle').click();
    buildings.click();
    expect(wm.open).toHaveBeenCalledExactlyOnceWith('buildings');
    expect(buildings.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#wm-win-buildings .wm-title'));

    document.getElementById('game-command-toggle').click();
    buildings.click();
    expect(wm.minimize).toHaveBeenCalledExactlyOnceWith('buildings');
    expect(buildings.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('game-command-toggle'));

    document.getElementById('game-command-toggle').click();
    buildings.click();
    expect(wm.open).toHaveBeenCalledTimes(2);
    expect(buildings.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#wm-win-buildings .wm-title'));
  });
  it('lets players save and restore the standard window layout with visible feedback', () => {
    const { wm } = windowManager();
    unmount = mountGameOverlayShell({ wm });
    const save = [...document.querySelectorAll('#game-window-picker button')]
      .find((button) => button.textContent === 'Standardlayout speichern');
    const load = [...document.querySelectorAll('#game-window-picker button')]
      .find((button) => button.textContent === 'Standardlayout laden');
    const status = document.querySelector('.game-window-layout-status');

    load.click();
    expect(wm.loadLayoutProfile).toHaveBeenCalledExactlyOnceWith('quick', { scope: 'global' });
    expect(status.textContent).toBe('Gespeichertes Standardlayout geladen.');
    save.click();
    expect(wm.saveLayoutProfile).toHaveBeenCalledExactlyOnceWith('quick', { scope: 'global' });
    expect(status.textContent).toBe('Aktuelles Fensterlayout als Standard gespeichert.');

    wm.loadLayoutProfile.mockReturnValue(false);
    load.click();
    expect(status.textContent).toBe('Es wurde noch kein Standardlayout gespeichert.');
    wm.saveLayoutProfile.mockReturnValue(false);
    save.click();
    expect(status.textContent).toBe('Das Fensterlayout konnte nicht gespeichert werden.');
  });
  it('minimizes only visible management windows and restores their stacking without touching draft DOM', () => {
    const { wm, add } = windowManager();
    const market = add('trade', 300);
    add('fleet', 350);
    add('research', 400);
    add('population', 240, true);
    add('galaxy', 1);
    add('console', 500);
    unmount = mountGameOverlayShell({ wm });
    const field = document.getElementById('game-field-toggle');
    expect(field.hidden).toBe(false);
    expect(field.textContent).toBe('Spielfeld');
    const draft = market.querySelector('input');
    draft.value = '7.5';
    document.getElementById('game-command-toggle').click();
    field.click();
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    expect(wm.minimize.mock.calls).toEqual([['research'], ['fleet'], ['trade']]);
    expect(field.textContent).toBe('Fenster (3)');
    expect(document.activeElement).toBe(field);
    field.click();
    expect(wm.restore.mock.calls).toEqual([['trade'], ['fleet'], ['research']]);
    expect(wm.isMinimized('population')).toBe(true);
    expect(market.querySelector('input')).toBe(draft);
    expect(draft.value).toBe('7.5');
    expect(field.textContent).toBe('Spielfeld');
  });
  it('does not resurrect manually closed windows and tracks manual taskbar restores', () => {
    const { wm, windows, add, notify } = windowManager();
    unmount = mountGameOverlayShell({ wm });
    const field = document.getElementById('game-field-toggle');
    expect(field.hidden).toBe(true);
    add('trade', 250);
    add('shipyard', 260);
    expect(field.hidden).toBe(false);
    field.click();
    expect(field.textContent).toBe('Fenster (2)');
    wm.restore('trade');
    expect(field.textContent).toBe('Spielfeld');
    windows.delete('shipyard');
    notify('shipyard', 'close');
    field.click();
    expect(field.textContent).toBe('Fenster (1)');
    windows.delete('trade');
    notify('trade', 'close');
    expect(field.hidden).toBe(true);
    add('trade', 270, true);
    expect(field.hidden).toBe(true);
    expect(wm.restore).toHaveBeenCalledExactlyOnceWith('trade');
  });
  it('hides the contextual control when the last window is manually minimized and removes listeners on teardown', () => {
    const { wm, add } = windowManager();
    add('economy', 250);
    unmount = mountGameOverlayShell({ wm });
    const field = document.getElementById('game-field-toggle');
    wm.minimize('economy');
    expect(field.hidden).toBe(true);
    wm.restore('economy');
    expect(field.hidden).toBe(false);
    unmount();
    unmount = null;
    wm.minimize('economy');
    expect(field.hidden).toBe(false);
    expect(document.getElementById('game-field-toggle')).toBeNull();
  });
});
