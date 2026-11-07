import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGameOverlayShell } from '../../js/ui/game-overlay-shell.js';

describe('Minimal overlay shell', () => {
  let unmount;
  let resize;
  let disconnect;
  beforeEach(() => {
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { disconnect(); }
    });
  });
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
    vi.unstubAllGlobals();
  });
  it('starts collapsed, preserves existing controls and restores their positions on logout', () => {
    document.body.innerHTML = '<section id="topbar-section"><div id="topbar-player"><button>Play</button></div></section>'
      + '<section id="resource-section"><p id="game-data-status" role="status">Serverdaten geladen.</p><nav class="game-development-actions"><button>Gebäude</button></nav>'
      + '<button data-resource="metal">Metall</button></section>'
      + '<section id="taskbar-section"><div id="wm-taskbar"></div></section>';
    const audio = document.getElementById('topbar-player');
    const topbar = document.getElementById('topbar-section');
    const resources = document.getElementById('resource-section');
    const dataStatus = document.getElementById('game-data-status');
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
    const commandToolbar = drawer.querySelector('.game-command-toolbar');
    expect(commandToolbar).toBe(drawer.firstElementChild);
    expect(commandToolbar.querySelector('strong').textContent).toBe('Kommando');
    expect(commandToolbar.querySelector('button').getAttribute('aria-label')).toBe('Kommandomenü schließen');
    expect(audio.closest('.game-overlay-dock')).not.toBeNull();
    expect(drawer.contains(topbar)).toBe(true);
    expect(dataStatus.previousElementSibling).toBe(topbar);
    expect(dataStatus.nextElementSibling).toBe(document.getElementById('game-window-picker'));
    expect(dataStatus.getAttribute('role')).toBe('status');
    expect(dataStatus.textContent).toBe('Serverdaten geladen.');
    expect(resourceMenu.contains(dataStatus)).toBe(false);
    expect([...drawer.children].indexOf(topbar)).toBeLessThan(
      [...drawer.children].indexOf(document.getElementById('game-window-picker')));
    expect(document.querySelector('.game-window-layout-menu').open).toBe(false);
    expect(resourceMenu.contains(resources)).toBe(true);
    expect(resourceMenu.contains(gameActions)).toBe(false);
    expect(drawer.contains(gameActions)).toBe(true);
    expect(resourceMenu.open).toBe(false);
    expect(drawer.contains(taskbar)).toBe(true);
    resourceMenu.querySelector('summary').click();
    expect(resourceMenu.open).toBe(true);
    toggle.click();
    expect(resourceMenu.open).toBe(false);
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
    expect(dataStatus.parentElement).toBe(resources);
    expect(resources.firstElementChild).toBe(dataStatus);
    expect(gameActions.parentElement).toBe(resources);
    expect(taskbar.parentElement).toBe(document.body);
    expect(document.getElementById('game-overlay-shell')).toBeNull();
    expect(document.body.classList.contains('game-overlay-layout')).toBe(false);
  });
  it('closes the command drawer with its toolbar button without minimizing management windows', () => {
    const { wm, add } = windowManager();
    add('trade', 250);
    unmount = mountGameOverlayShell({ wm });
    const toggle = document.getElementById('game-command-toggle');
    const drawer = document.getElementById('game-command-overlay');
    toggle.click();
    const close = drawer.querySelector('.game-command-toolbar button');
    expect(document.activeElement).toBe(close);
    close.click();
    expect(drawer.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    expect(wm.minimize).not.toHaveBeenCalled();
    expect(wm.isOpen('trade')).toBe(true);
    toggle.click();
    expect(document.activeElement).toBe(close);
  });
  it('mirrors data status on the command trigger without opening the drawer and clears recovered states', async () => {
    windowManager();
    const status = document.createElement('p');
    status.id = 'game-data-status';
    status.dataset.state = 'error';
    status.textContent = 'Aktualisierung fehlgeschlagen: Verbindung getrennt.';
    document.getElementById('resource-section').append(status);
    unmount = mountGameOverlayShell();
    const toggle = document.getElementById('game-command-toggle');
    const badge = toggle.querySelector('.game-command-data-badge');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('Datenfehler');
    expect(toggle.title).toBe(status.textContent);
    expect(toggle.getAttribute('aria-describedby')).toBe(status.id);
    expect(badge.hasAttribute('aria-live')).toBe(false);
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    for (const [state, caption] of [['loading', 'Lädt'], ['empty', 'Keine Kolonie']]) {
      status.dataset.state = state;
      status.firstChild.data = `Status: ${state}`;
      await vi.waitFor(() => expect(badge.textContent).toBe(caption));
      expect(toggle.dataset.dataState).toBe(state);
      expect(toggle.title).toBe(status.textContent);
      expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    }
    for (const state of ['ready', 'idle', 'unknown', 'error']) {
      status.dataset.state = state;
      status.textContent = state === 'error' ? '' : 'Serverdaten geladen.';
      await vi.waitFor(() => expect(badge.hidden).toBe(true));
      expect(badge.textContent).toBe('');
      expect(toggle.hasAttribute('data-data-state')).toBe(false);
      expect(toggle.hasAttribute('aria-describedby')).toBe(false);
      expect(toggle.hasAttribute('title')).toBe(false);
    }
    unmount();
    unmount = null;
    status.dataset.state = 'loading';
    status.textContent = 'Späte Aktualisierung';
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(badge.hidden).toBe(true);
    expect(toggle.hasAttribute('data-data-state')).toBe(false);
  });
  it('positions menus below the measured dock and disconnects its observer on teardown', () => {
    windowManager();
    unmount = mountGameOverlayShell();
    const root = document.getElementById('game-overlay-shell');
    const dock = root.querySelector('.game-overlay-dock');
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({ bottom: 116 });
    resize();
    expect(root.style.getPropertyValue('--game-overlay-menu-top')).toBe('124px');
    dock.getBoundingClientRect.mockReturnValue({ bottom: 60 });
    window.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--game-overlay-menu-top')).toBe('68px');
    unmount();
    unmount = null;
    expect(disconnect).toHaveBeenCalledOnce();
    dock.getBoundingClientRect.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(dock.getBoundingClientRect).not.toHaveBeenCalled();
  });
  it('keeps resources and commands mutually exclusive and closes resources for the field action', async () => {
    const { wm, add } = windowManager();
    add('trade', 250);
    unmount = mountGameOverlayShell({ wm });
    const menu = document.querySelector('.game-overlay-resource-menu');
    const summary = menu.querySelector('summary');
    const drawer = document.getElementById('game-command-overlay');
    const toggle = document.getElementById('game-command-toggle');
    toggle.click();
    summary.click();
    expect(menu.open).toBe(true);
    expect(drawer.hidden).toBe(true);
    toggle.click();
    expect(menu.open).toBe(false);
    expect(drawer.hidden).toBe(false);
    menu.open = true;
    await vi.waitFor(() => expect(drawer.hidden).toBe(true));
    expect(document.activeElement).toBe(summary);
    document.getElementById('game-field-toggle').click();
    expect(menu.open).toBe(false);
  });
  it('dismisses resources with Escape but preserves composition, handled keys and destination focus', () => {
    windowManager();
    unmount = mountGameOverlayShell();
    const menu = document.querySelector('.game-overlay-resource-menu');
    const summary = menu.querySelector('summary');
    const input = document.createElement('input');
    document.getElementById('resource-section').append(input);
    summary.click();
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true, isComposing: true,
    }));
    expect(menu.open).toBe(true);
    input.addEventListener('keydown', event => event.preventDefault(), { once: true });
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(menu.open).toBe(true);
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    try {
      const dismiss = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(dismiss);
      expect(menu.open).toBe(false);
      expect(document.activeElement).toBe(summary);
      expect(dismiss.defaultPrevented).toBe(true);
      expect(outer).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', outer);
    }
    summary.click();
    input.focus();
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.open).toBe(true);
    const destination = document.createElement('button');
    document.body.append(destination);
    destination.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    destination.focus();
    summary.click();
    destination.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(destination);
  });
  it('preserves composition and handled Escape, then consumes its own dismissal without closing another overlay', () => {
    windowManager();
    unmount = mountGameOverlayShell();
    const drawer = document.getElementById('game-command-overlay');
    const toggle = document.getElementById('game-command-toggle');
    toggle.click();
    const input = document.createElement('input');
    drawer.append(input);
    input.focus();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    try {
      const composing = new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true, isComposing: true,
      });
      input.dispatchEvent(composing);
      expect(composing.defaultPrevented).toBe(false);
      expect(drawer.hidden).toBe(false);
      expect(document.activeElement).toBe(input);
      input.addEventListener('keydown', event => event.preventDefault(), { once: true });
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(drawer.hidden).toBe(false);
      expect(document.activeElement).toBe(input);
      outer.mockClear();
      const dismiss = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(dismiss);
      expect(drawer.hidden).toBe(true);
      expect(document.activeElement).toBe(toggle);
      expect(dismiss.defaultPrevented).toBe(true);
      expect(outer).not.toHaveBeenCalled();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(outer).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', outer);
    }
  });
  it('moves resource-action focus into the opened window without overriding domain focus', async () => {
    const { wm } = windowManager();
    const resources = document.getElementById('resource-section');
    resources.innerHTML = '<button data-resource="metal">Metall</button><button data-resource="population">Bevölkerung</button>';
    unmount = mountGameOverlayShell({ wm });
    const summary = document.querySelector('.game-overlay-resource-menu > summary');
    let focusDetail = false;
    const open = event => {
      const resource = event.target.closest?.('[data-resource]')?.dataset.resource;
      if (!resource) return;
      const id = resource === 'population' ? 'population' : 'economy';
      wm.open(id);
      if (focusDetail) {
        const detail = document.createElement('h3');
        detail.tabIndex = -1;
        document.getElementById(`wm-win-${id}`).append(detail);
        detail.focus();
      }
    };
    document.addEventListener('click', open);
    try {
      for (const resource of ['metal', 'population']) {
        summary.click();
        const button = resources.querySelector(`[data-resource="${resource}"]`);
        button.focus();
        button.click();
        const id = resource === 'population' ? 'population' : 'economy';
        await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector(`#wm-win-${id} .wm-title`)));
      }
      focusDetail = true;
      summary.click();
      resources.querySelector('[data-resource="metal"]').focus();
      resources.querySelector('[data-resource="metal"]').click();
      await new Promise(requestAnimationFrame);
      expect(document.activeElement.tagName).toBe('H3');
    } finally {
      document.removeEventListener('click', open);
    }
  });
  it('keeps focus on a visible trigger if a resource window does not open and cancels queued focus on teardown', async () => {
    const { wm } = windowManager();
    const button = document.createElement('button');
    button.dataset.resource = 'metal';
    document.getElementById('resource-section').append(button);
    unmount = mountGameOverlayShell({ wm });
    const summary = document.querySelector('.game-overlay-resource-menu > summary');
    summary.click();
    button.focus();
    button.click();
    await new Promise(requestAnimationFrame);
    expect(document.activeElement).toBe(summary);
    wm.open('economy');
    const title = document.querySelector('#wm-win-economy .wm-title');
    summary.click();
    button.focus();
    button.click();
    unmount();
    unmount = null;
    await new Promise(requestAnimationFrame);
    expect(document.activeElement).not.toBe(title);
  });
  it('does not steal external focus for programmatic menu actions and recovers focus for drawer actions', async () => {
    windowManager();
    document.getElementById('resource-section').innerHTML = '<nav class="game-development-actions"><button data-game-economy>Wirtschaft</button></nav><button data-resource="metal">Metall</button>';
    unmount = mountGameOverlayShell();
    const external = document.createElement('button');
    document.body.append(external);
    external.focus();
    document.querySelector('[data-resource]').click();
    await Promise.resolve();
    expect(document.activeElement).toBe(external);
    const toggle = document.getElementById('game-command-toggle');
    toggle.click();
    const action = document.querySelector('[data-game-economy]');
    action.focus();
    action.click();
    expect(document.activeElement).toBe(toggle);
  });
  it('navigates available resources without activating them, wrapping or focusing passive balances', () => {
    windowManager();
    const resources = document.getElementById('resource-section');
    resources.innerHTML = '<button data-resource="metal">Metall</button>'
      + '<button data-resource="crystal" disabled>Kristall</button>'
      + '<div hidden><button data-resource="food">Nahrung</button></div>'
      + '<button data-resource="energy">Energie</button><div class="dark-matter">Dunkle Materie</div>';
    unmount = mountGameOverlayShell();
    const menu = document.querySelector('.game-overlay-resource-menu');
    const summary = menu.querySelector('summary');
    const metal = resources.querySelector('[data-resource="metal"]');
    const energy = resources.querySelector('[data-resource="energy"]');
    const activate = vi.fn();
    resources.addEventListener('click', activate);
    metal.scrollIntoView = vi.fn();
    energy.scrollIntoView = vi.fn();
    const key = (target, value) => {
      const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    summary.click();
    key(summary, 'ArrowDown');
    expect(document.activeElement).toBe(metal);
    key(metal, 'ArrowDown');
    expect(document.activeElement).toBe(energy);
    key(energy, 'ArrowDown');
    expect(document.activeElement).toBe(energy);
    key(energy, 'Home');
    expect(document.activeElement).toBe(metal);
    key(metal, 'ArrowUp');
    expect(document.activeElement).toBe(metal);
    key(metal, 'End');
    expect(document.activeElement).toBe(energy);
    key(energy, 'ArrowUp');
    expect(document.activeElement).toBe(metal);
    key(summary, 'ArrowUp');
    expect(document.activeElement).toBe(energy);
    expect(energy.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(activate).not.toHaveBeenCalled();
    expect(menu.open).toBe(true);
  });
  it('preserves native keys, modifiers, IME, handled events and closed or empty resource menus', () => {
    windowManager();
    const resources = document.getElementById('resource-section');
    resources.innerHTML = '<button data-resource="metal">Metall</button><input>';
    unmount = mountGameOverlayShell();
    const menu = document.querySelector('.game-overlay-resource-menu');
    const summary = menu.querySelector('summary');
    const button = resources.querySelector('[data-resource]');
    const send = (target, key, options = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    };
    send(summary, 'ArrowDown');
    summary.click();
    button.focus();
    for (const key of ['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight']) send(button, key);
    for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) {
      send(button, 'ArrowDown', { [flag]: true });
    }
    send(summary, 'Home');
    send(resources.querySelector('input'), 'ArrowDown');
    button.addEventListener('keydown', event => event.preventDefault(), { once: true });
    const handled = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    const scroll = vi.fn();
    button.scrollIntoView = scroll;
    button.dispatchEvent(handled);
    expect(scroll).not.toHaveBeenCalled();
    button.disabled = true;
    send(summary, 'ArrowDown');
    expect(document.activeElement).toBe(button);
    unmount();
    unmount = null;
    button.disabled = false;
    send(button, 'ArrowDown');
  });
  it('closes resources explicitly, restores summary focus and removes the toolbar on logout', () => {
    windowManager();
    unmount = mountGameOverlayShell();
    const menu = document.querySelector('.game-overlay-resource-menu');
    const summary = menu.querySelector('summary');
    const close = menu.querySelector('.game-resource-toolbar button');
    expect(close.type).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('Ressourcenmenü schließen');
    summary.click();
    close.focus();
    close.click();
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    summary.click();
    expect(menu.open).toBe(true);
    unmount();
    unmount = null;
    expect(document.querySelector('.game-resource-toolbar')).toBeNull();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    close.click();
    expect(document.activeElement).toBe(outside);
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
  it('opens, focuses and restores windows without toggling visible windows off', () => {
    const { wm } = windowManager();
    unmount = mountGameOverlayShell({ wm });
    const buildings = document.querySelector('[data-window-id="buildings"]');
    const fleet = document.querySelector('[data-window-id="fleet"]');
    const market = document.querySelector('[data-window-id="trade"]');
    expect(buildings.closest('.game-window-picker-group').querySelector('strong').textContent).toBe('Kolonie');
    expect(fleet.closest('.game-window-picker-group').querySelector('strong').textContent).toBe('Galaxie');
    expect(market.closest('.game-window-picker-group').querySelector('strong').textContent).toBe('Wirtschaft');
    expect(buildings.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('#game-command-toggle svg')).not.toBeNull();
    expect(document.querySelector('.game-overlay-resource-menu summary svg')).not.toBeNull();
    expect(buildings.closest('.game-window-picker-group').querySelector('.game-window-picker-count').textContent).toBe('0/4');

    document.getElementById('game-command-toggle').click();
    expect(document.querySelector('#game-command-toggle[aria-expanded="true"]')).not.toBeNull();
    buildings.click();
    expect(wm.open).toHaveBeenCalledExactlyOnceWith('buildings');
    expect(buildings.getAttribute('aria-pressed')).toBe('true');
    expect(buildings.closest('.game-window-picker-group').querySelector('.game-window-picker-count').textContent).toBe('1/4');
    expect(buildings.classList.contains('is-active')).toBe(true);
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#wm-win-buildings .wm-title'));

    document.getElementById('game-command-toggle').click();
    buildings.click();
    expect(wm.minimize).not.toHaveBeenCalled();
    expect(wm.open).toHaveBeenCalledTimes(2);
    expect(buildings.getAttribute('aria-pressed')).toBe('true');
    expect(buildings.closest('.game-window-picker-group').querySelector('.game-window-picker-count').textContent).toBe('1/4');
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#wm-win-buildings .wm-title'));

    wm.minimize('buildings');
    document.getElementById('game-command-toggle').click();
    buildings.click();
    expect(wm.open).toHaveBeenCalledTimes(3);
    expect(buildings.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#wm-win-buildings .wm-title'));
  });
  it('keeps the picker open with explicit feedback when a window cannot be opened, then clears it on success', () => {
    const { wm } = windowManager();
    const open = wm.open.getMockImplementation();
    wm.open.mockImplementation(() => {});
    unmount = mountGameOverlayShell({ wm });
    document.getElementById('game-command-toggle').click();
    const control = document.querySelector('[data-window-id="buildings"]');
    control.focus();
    control.click();
    const status = document.querySelector('.game-window-picker-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('Gebäude konnte nicht geöffnet werden.');
    expect(document.getElementById('game-command-overlay').hidden).toBe(false);
    expect(document.activeElement).toBe(control);
    wm.open.mockImplementation(open);
    control.click();
    expect(status.textContent).toBe('');
    expect(document.getElementById('game-command-overlay').hidden).toBe(true);
  });
  it('announces unavailable window management instead of silently ignoring picker actions', () => {
    windowManager();
    unmount = mountGameOverlayShell({ wm: null });
    document.getElementById('game-command-toggle').click();
    document.querySelector('[data-window-id="trade"]').click();
    expect(document.querySelector('.game-window-picker-status').textContent).toBe('Markt ist derzeit nicht verfügbar.');
    expect(document.getElementById('game-command-overlay').hidden).toBe(false);
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
  it('mounts the empire overview only for a connected session and hides it behind the command drawer', () => {
    const { wm } = windowManager();
    const unsubscribe = vi.fn();
    const session = { getState: () => ({ colonies: [{ id: 1, name: 'Home', galaxy: 1, system: 1, position: 1 }] }),
      getColony: () => ({ id: 1, name: 'Home' }),
      events: { on: vi.fn(() => unsubscribe) } };
    const galaxy = { getState: () => ({ loading: false, error: '' }), subscribe: vi.fn(() => unsubscribe) };
    unmount = mountGameOverlayShell({ wm, session, galaxy });
    const panel = document.getElementById('game-empire-outliner');
    expect(panel.hidden).toBe(false);
    expect([...panel.querySelectorAll('[data-empire-window]')].map((control) => control.dataset.empireWindow))
      .toEqual(['buildings', 'research', 'population', 'shipyard', 'economy', 'trade']);
    panel.querySelector('[data-empire-window="research"]').click();
    expect(wm.open).toHaveBeenCalledExactlyOnceWith('research');
    document.getElementById('game-command-toggle').click();
    expect(panel.hidden).toBe(true);
    document.getElementById('game-command-toggle').click();
    expect(panel.hidden).toBe(false);
    unmount();
    unmount = null;
    expect(unsubscribe).toHaveBeenCalledTimes(3);
    expect(document.getElementById('game-empire-outliner')).toBeNull();
  });
  it('updates resource colony context without replacing controls or moving focus and cleans it up on logout', () => {
    windowManager();
    const unsubscribe = vi.fn();
    let update;
    let colony = { name: '<Heimat>', galaxy: 1, system: 20, position: 3 };
    const session = {
      getColony: () => colony,
      events: { on: vi.fn((event, callback) => { update = callback; return unsubscribe; }) },
    };
    unmount = mountGameOverlayShell({ session });
    expect(session.events.on).toHaveBeenCalledWith('overview:updated', expect.any(Function));
    const header = document.querySelector('.game-resource-context');
    expect(header.hidden).toBe(false);
    expect(header.querySelector('strong').textContent).toBe('<Heimat>');
    expect(header.querySelector('span').textContent).toBe('[1:20:3]');
    expect(header.querySelector('heimat')).toBeNull();
    const menu = document.querySelector('.game-overlay-resource-menu');
    menu.querySelector('summary').click();
    const control = document.createElement('button');
    control.textContent = 'Metall';
    document.getElementById('resource-section').append(control);
    control.focus();
    colony = { name: 'Außenposten', galaxy: 2, system: 30, position: 4 };
    update();
    expect(header.querySelector('strong').textContent).toBe('Außenposten');
    expect(header.querySelector('span').textContent).toBe('[2:30:4]');
    expect(document.activeElement).toBe(control);
    expect(menu.open).toBe(true);
    colony = null;
    update();
    expect(header.querySelector('strong').textContent).toBe('Keine aktive Kolonie');
    expect(header.querySelector('span').textContent).toBe('Kolonie im Kommandomenü auswählen.');
    expect(document.activeElement).toBe(control);
    unmount();
    unmount = null;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(document.querySelector('.game-resource-context')).toBeNull();
    expect(control.parentElement.id).toBe('resource-section');
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
