import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

function pointer(target, type, x, y, overrides = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...overrides });
  Object.defineProperties(event, {
    pointerId: { value: overrides.pointerId ?? 1 },
    isPrimary: { value: overrides.isPrimary ?? true },
    pointerType: { value: overrides.pointerType ?? 'mouse' },
  });
  target.dispatchEvent(event);
}

describe('window pointer interactions', () => {
  let WM;
  const windows = [];
  beforeEach(() => {
    document.body.innerHTML = '<div id="wm-taskbar"></div>';
    localStorage.clear();
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 800);
    window.eval(fs.readFileSync('js/ui/gq-ui.js', 'utf8'));
    window.eval(fs.readFileSync('js/runtime/wm.js', 'utf8'));
    WM = window.WMCore.create({
      storagePrefix: 'pointer_test_',
      getViewportInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0, titlebarBottom: null, resourceBottom: null }),
    });
  });
  afterEach(() => {
    windows.splice(0).forEach((id) => WM.close(id));
    vi.unstubAllGlobals();
  });

  function open(id = 'drag', cfg = {}) {
    windows.push(id);
    WM.register(id, { title: id, w: 360, h: 240, defaultX: 200, defaultY: 160, ...cfg });
    WM.open(id);
    const el = document.getElementById(`wm-win-${id}`);
    Object.defineProperties(el, {
      offsetWidth: { configurable: true, get: () => parseFloat(el.style.width) },
      offsetHeight: { configurable: true, get: () => parseFloat(el.style.height) },
    });
    return el;
  }

  it('moves by the pointer delta, focuses the window and persists only on release', () => {
    const el = open();
    open('other');
    pointer(el.querySelector('.wm-titlebar'), 'pointerdown', 240, 180);
    pointer(document, 'pointermove', 360, 260);
    expect(el.style.left).toBe('320px');
    expect(el.style.top).toBe('240px');
    expect(el.classList.contains('wm-focused')).toBe(true);
    expect(localStorage.getItem('pointer_test_wpos_drag')).toBeNull();
    pointer(document, 'pointerup', 360, 260);
    expect(el.classList.contains('wm-dragging')).toBe(false);
    expect(JSON.parse(localStorage.getItem('pointer_test_wpos_drag'))).toMatchObject({ x: 320, y: 240 });
    pointer(document, 'pointermove', 600, 400);
    expect(el.style.left).toBe('320px');
  });

  it('keeps an edge dock intact on a click or small pointer jitter', () => {
    const el = open('docked', { defaultDock: 'left', autoDockOnOpen: true });
    const original = el.style.left;
    const bar = el.querySelector('.wm-titlebar');
    pointer(bar, 'pointerdown', 40, 180);
    pointer(document, 'pointermove', 42, 181);
    pointer(document, 'pointerup', 42, 181);
    expect(el.dataset.wmDocked).toBe('left');
    expect(el.style.left).toBe(original);
    expect(localStorage.getItem('pointer_test_wpos_docked')).toBeNull();
  });

  it.each([{ button: 2 }, { button: 1 }, { isPrimary: false }])('ignores non-primary gestures: %j', (overrides) => {
    const el = open();
    pointer(el.querySelector('.wm-titlebar'), 'pointerdown', 240, 180, overrides);
    pointer(document, 'pointermove', 360, 260);
    pointer(document, 'pointerup', 360, 260);
    expect(el.style.left).toBe('200px');
    expect(el.classList.contains('wm-dragging')).toBe(false);
  });

  it('does not drag through window controls or dock-group tabs', () => {
    const el = open();
    open('other');
    WM.createDockGroup(['drag', 'other']);
    for (const selector of ['.wm-btn-menu', '.wm-btn-min', '.wm-btn-close', '.wm-dock-group-tab']) {
      pointer(el.querySelector(selector), 'pointerdown', 240, 180);
      pointer(document, 'pointermove', 360, 260);
      pointer(document, 'pointerup', 360, 260);
      expect(el.style.left).toBe('200px');
    }
  });

  it('keeps dock tabs attached between pressing and clicking so native clicks can activate them', () => {
    const el = open();
    open('other');
    const group = WM.createDockGroup(['drag', 'other']);
    const tab = el.querySelector('[data-dock-tab-win-id="other"]');
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(tab.isConnected).toBe(true);
    tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    tab.focus();
    tab.click();
    expect(WM.listDockGroups().find((entry) => entry.id === group).activeId).toBe('other');
    expect(document.getElementById('wm-win-other').style.left).toBe(el.style.left);
    expect(document.activeElement.dataset.dockTabWinId).toBe('other');
  });

  it('docks on release, removes the dock only after dragging away and handles null top anchors', () => {
    const el = open();
    const bar = el.querySelector('.wm-titlebar');
    pointer(bar, 'pointerdown', 240, 180);
    pointer(document, 'pointermove', 10, 300);
    expect(el.dataset.wmDocked).toBeUndefined();
    expect(document.body.classList.contains('wm-dock-preview-left')).toBe(true);
    pointer(document, 'pointerup', 10, 300);
    expect(el.dataset.wmDocked).toBe('left');
    expect(JSON.parse(localStorage.getItem('pointer_test_wdock_drag')).side).toBe('left');
    pointer(bar, 'pointerdown', 30, 300);
    pointer(document, 'pointermove', 500, 300);
    pointer(document, 'pointerup', 500, 300);
    expect(el.dataset.wmDocked).toBeUndefined();
    expect(localStorage.getItem('pointer_test_wdock_drag')).toBeNull();
    pointer(bar, 'pointerdown', 500, 300);
    pointer(document, 'pointermove', 500, 5);
    pointer(document, 'pointerup', 500, 5);
    expect(el.dataset.wmDocked).toBe('top');
  });

  it.each(['pointercancel', 'blur', 'Escape', 'lostpointercapture'])('rolls back a cancelled drag: %s', (type) => {
    const el = open('docked', { defaultDock: 'left', autoDockOnOpen: true });
    const original = { left: el.style.left, top: el.style.top };
    const bar = el.querySelector('.wm-titlebar');
    pointer(bar, 'pointerdown', 40, 180);
    pointer(document, 'pointermove', 500, 250);
    if (type === 'blur') window.dispatchEvent(new Event('blur'));
    else if (type === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else pointer(type === 'lostpointercapture' ? bar : document, type, 500, 250);
    expect(el.style.left).toBe(original.left);
    expect(el.style.top).toBe(original.top);
    expect(el.dataset.wmDocked).toBe('left');
    expect(el.classList.contains('wm-dragging')).toBe(false);
    expect(document.body.className).not.toContain('wm-dock-preview');
    expect(localStorage.getItem('pointer_test_wpos_docked')).toBeNull();
    pointer(document, 'pointermove', 800, 400);
    expect(el.style.left).toBe(original.left);
  });

  it('ignores another pointer and accepts pen/touch pointers on a desktop-sized viewport', () => {
    const el = open();
    pointer(el.querySelector('.wm-titlebar'), 'pointerdown', 240, 180, { pointerType: 'touch' });
    pointer(document, 'pointermove', 600, 400, { pointerId: 2 });
    pointer(document, 'pointerup', 600, 400, { pointerId: 2 });
    expect(el.style.left).toBe('200px');
    pointer(document, 'pointermove', 360, 260);
    pointer(document, 'pointerup', 360, 260);
    expect(el.style.left).toBe('320px');
  });

  it.each(['close', 'minimize'])('cancels an active drag when the window is %s', (action) => {
    const el = open();
    pointer(el.querySelector('.wm-titlebar'), 'pointerdown', 240, 180);
    pointer(document, 'pointermove', 10, 300);
    WM[action]('drag');
    pointer(document, 'pointermove', 600, 400);
    pointer(document, 'pointerup', 600, 400);
    expect(el.style.left).toBe('200px');
    expect(document.body.className).not.toContain('wm-dock-preview');
    expect(localStorage.getItem('pointer_test_wpos_drag')).toBeNull();
  });

  it('resizes with pointer input and restores size on cancellation', () => {
    const el = open();
    const handle = el.querySelector('.wm-resize-handle');
    pointer(handle, 'pointerdown', 560, 400);
    pointer(document, 'pointermove', 660, 450);
    expect(el.style.width).toBe('460px');
    expect(el.style.height).toBe('290px');
    pointer(document, 'pointercancel', 660, 450);
    expect(el.style.width).toBe('360px');
    expect(el.style.height).toBe('240px');
    pointer(handle, 'pointerdown', 560, 400);
    pointer(document, 'pointermove', 660, 450);
    pointer(document, 'pointerup', 660, 450);
    expect(JSON.parse(localStorage.getItem('pointer_test_wpos_drag'))).toMatchObject({ w: 460, h: 290 });
  });

  it('opens the accessible window action menu without moving the window', async () => {
    const el = open();
    const menu = el.querySelector('.wm-btn-menu');
    menu.click();
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    await vi.waitFor(() => expect(document.activeElement.classList.contains('wm-context-menu-item')).toBe(true));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
    expect(el.style.left).toBe('200px');
  });

  it('groups permitted docking actions into a submenu and detaches without rebuilding content', () => {
    const el = open('limited', { dockableSides: ['left', 'right'] });
    const body = WM.body('limited');
    const input = document.createElement('input');
    input.value = 'draft';
    body.appendChild(input);
    const action = (label) => {
      const button = [...document.querySelectorAll('.wm-context-menu-item')].find((node) => node.textContent === label);
      expect(button).toBeTruthy();
      return button;
    };
    el.querySelector('.wm-btn-menu').click();
    const docking = action('Dock to edge');
    docking.click();
    expect(docking.getAttribute('aria-expanded')).toBe('true');
    const submenu = document.querySelector('.wm-context-submenu');
    expect([...submenu.querySelectorAll('button')].map((node) => node.textContent)).toEqual(['Dock left', 'Dock right']);
    action('Dock right').click();
    expect(el.dataset.wmDocked).toBe('right');
    el.querySelector('.wm-btn-menu').click();
    action('Detach from edge').click();
    expect(el.dataset.wmDocked).toBeUndefined();
    expect(localStorage.getItem('pointer_test_wdock_limited')).toBeNull();
    expect(body.firstChild).toBe(input);
    expect(input.value).toBe('draft');
  });

  it('resizes a right-docked window while keeping its edge anchor', () => {
    const el = open('right', { defaultDock: 'right', autoDockOnOpen: true });
    pointer(el.querySelector('.wm-resize-handle'), 'pointerdown', 1268, 400);
    pointer(document, 'pointermove', 1208, 450);
    pointer(document, 'pointerup', 1208, 450);
    expect(el.dataset.wmDocked).toBe('right');
    expect(el.style.width).toBe('300px');
    expect(parseFloat(el.style.left) + parseFloat(el.style.width)).toBe(1268);
  });

  it('adds actions to an adopted titlebar and preserves its bindings across reopening', () => {
    const host = document.createElement('div');
    host.id = 'adopted-host';
    const el = document.createElement('section');
    el.className = 'wm-adaptable-window';
    el.innerHTML = '<div class="wm-titlebar"><span class="wm-title">Adopted</span>'
      + '<div class="wm-controls"><button class="wm-btn-min">-</button><button class="wm-btn-close">X</button></div></div>'
      + '<div class="wm-body"><input value="draft"></div>';
    host.appendChild(el);
    document.body.appendChild(host);
    windows.push('adopted');
    WM.adopt('adopted', { sectionId: host.id, title: 'Adopted', w: 360, h: 240 });
    expect(el.querySelectorAll('.wm-btn-menu')).toHaveLength(1);
    WM.close('adopted');
    WM.open('adopted');
    expect(el.querySelectorAll('.wm-btn-menu')).toHaveLength(1);
    el.querySelector('.wm-btn-menu').click();
    expect(el.querySelector('.wm-btn-menu').getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('input').value).toBe('draft');
  });

  it('keeps mobile and explicitly pinned windows out of free dragging', () => {
    const el = open('pinned', { forceDockSide: 'bottom' });
    pointer(el.querySelector('.wm-titlebar'), 'pointerdown', 240, 180);
    pointer(document, 'pointermove', 360, 260);
    pointer(document, 'pointerup', 360, 260);
    expect(el.dataset.wmDocked).toBe('bottom');
    const mobile = open('mobile');
    vi.stubGlobal('innerWidth', 600);
    pointer(mobile.querySelector('.wm-titlebar'), 'pointerdown', 240, 180);
    pointer(document, 'pointermove', 360, 260);
    pointer(document, 'pointerup', 360, 260);
    expect(mobile.style.left).toBe('200px');
  });
});
