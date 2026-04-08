/**
 * fleet-labels-hotkeys.test.js
 *
 * Unit tests for:
 *  - RuntimeOverviewLists: fleet label rendering + inline edit binding
 *  - RuntimeDesktopShell: registerGlobalHotkeys
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const baseRuntime = path.resolve(process.cwd(), 'js/engine/runtime');

function loadModule(name) {
  const src = fs.readFileSync(path.join(baseRuntime, `${name}.js`), 'utf8');
  window.eval(src);
}

// ── helpers ───────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => String(n ?? 0);
const fmtName = (s) => String(s || '');
const countdown = () => '-';

function makeApi(overrides = {}) {
  return {
    recallFleet: vi.fn(async () => ({ success: true })),
    renameFleet: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

function makeWm(overrides = {}) {
  const opened = [];
  const toggled = [];
  const commands = new Map();
  return {
    open: vi.fn((win) => opened.push(win)),
    toggle: vi.fn((win) => toggled.push(win)),
    registerCommand: vi.fn((id, def) => commands.set(id, def)),
    showCommandPalette: vi.fn(),
    _opened: opened,
    _toggled: toggled,
    _commands: commands,
    ...overrides,
  };
}

// ── RuntimeOverviewLists: fleet label HTML ────────────────────────────────────

describe('RuntimeOverviewLists – fleet label rendering', () => {
  beforeEach(() => {
    delete window.GQRuntimeOverviewLists;
    loadModule('RuntimeOverviewLists');
  });

  function makeRoot(fleetsData) {
    const div = document.createElement('div');
    div.innerHTML = '<div id="fleet-list-wm"></div>';
    window._GQ_fleets = fleetsData;
    return div;
  }

  function makeRenderTemplateList() {
    return (tplName, rows) => rows.map((row) =>
      `<div class="fleet-row" data-fleet-id="${row.fleetId}">${row.fleetLabelHtml}${row.mission}</div>`
    ).join('');
  }

  it('renders named fleet label', () => {
    const { createOverviewLists } = window.GQRuntimeOverviewLists;
    const ol = createOverviewLists({ esc, fmt, fmtName, countdown, api: makeApi(), showToast: vi.fn(), windowRef: window });
    const root = makeRoot([{ id: 7, fleet_label: 'Alpha Strike', mission: 'attack', target_galaxy: 1, target_system: 2, target_position: 3, arrival_time: new Date(Date.now() + 60000).toISOString() }]);
    ol.renderFleetList({ root, renderTemplateList: makeRenderTemplateList(), onReload: async () => {} });
    const fleetList = root.querySelector('#fleet-list-wm');
    expect(fleetList.innerHTML).toContain('Alpha Strike');
  });

  it('renders edit button for unnamed fleet', () => {
    const { createOverviewLists } = window.GQRuntimeOverviewLists;
    const ol = createOverviewLists({ esc, fmt, fmtName, countdown, api: makeApi(), showToast: vi.fn(), windowRef: window });
    const root = makeRoot([{ id: 3, fleet_label: null, mission: 'transport', target_galaxy: 1, target_system: 1, target_position: 1, arrival_time: new Date(Date.now() + 60000).toISOString() }]);
    ol.renderFleetList({ root, renderTemplateList: makeRenderTemplateList(), onReload: async () => {} });
    expect(root.querySelector('.fleet-label-edit-btn')).not.toBeNull();
  });

  it('fleet-label-edit-btn carries data-fid attribute', () => {
    const { createOverviewLists } = window.GQRuntimeOverviewLists;
    const ol = createOverviewLists({ esc, fmt, fmtName, countdown, api: makeApi(), showToast: vi.fn(), windowRef: window });
    const root = makeRoot([{ id: 42, fleet_label: 'Wolf Pack', mission: 'spy', target_galaxy: 1, target_system: 1, target_position: 1, arrival_time: new Date(Date.now() + 60000).toISOString() }]);
    ol.renderFleetList({ root, renderTemplateList: makeRenderTemplateList(), onReload: async () => {} });
    const btn = root.querySelector('.fleet-label-edit-btn');
    expect(btn.dataset.fid).toBe('42');
  });

  it('clicking edit button creates an input field', () => {
    const { createOverviewLists } = window.GQRuntimeOverviewLists;
    const ol = createOverviewLists({ esc, fmt, fmtName, countdown, api: makeApi(), showToast: vi.fn(), windowRef: window });
    const root = makeRoot([{ id: 5, fleet_label: 'Recon', mission: 'spy', target_galaxy: 1, target_system: 1, target_position: 1, arrival_time: new Date(Date.now() + 60000).toISOString() }]);
    ol.renderFleetList({ root, renderTemplateList: makeRenderTemplateList(), onReload: async () => {} });
    const btn = root.querySelector('.fleet-label-edit-btn');
    btn.click();
    expect(root.querySelector('.fleet-label-input')).not.toBeNull();
  });

  it('pressing Escape removes input without saving', async () => {
    const api = makeApi();
    const { createOverviewLists } = window.GQRuntimeOverviewLists;
    const ol = createOverviewLists({ esc, fmt, fmtName, countdown, api, showToast: vi.fn(), windowRef: window });
    const root = makeRoot([{ id: 6, fleet_label: 'Vanguard', mission: 'attack', target_galaxy: 1, target_system: 1, target_position: 1, arrival_time: new Date(Date.now() + 60000).toISOString() }]);
    ol.renderFleetList({ root, renderTemplateList: makeRenderTemplateList(), onReload: async () => {} });
    root.querySelector('.fleet-label-edit-btn').click();
    const input = root.querySelector('.fleet-label-input');
    expect(input).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.fleet-label-input')).toBeNull();
    expect(api.renameFleet).not.toHaveBeenCalled();
  });

  it('pressing Enter saves label and calls api.renameFleet', async () => {
    const api = makeApi();
    const showToast = vi.fn();
    const { createOverviewLists } = window.GQRuntimeOverviewLists;
    const ol = createOverviewLists({ esc, fmt, fmtName, countdown, api, showToast, windowRef: window });
    const root = makeRoot([{ id: 9, fleet_label: '', mission: 'transport', target_galaxy: 1, target_system: 1, target_position: 1, arrival_time: new Date(Date.now() + 60000).toISOString() }]);
    ol.renderFleetList({ root, renderTemplateList: makeRenderTemplateList(), onReload: async () => {} });
    root.querySelector('.fleet-label-edit-btn').click();
    const input = root.querySelector('.fleet-label-input');
    input.value = 'Nighthawks';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect(api.renameFleet).toHaveBeenCalledWith(9, 'Nighthawks');
  });

  it('label max 48 chars enforced on Enter', async () => {
    const api = makeApi();
    const { createOverviewLists } = window.GQRuntimeOverviewLists;
    const ol = createOverviewLists({ esc, fmt, fmtName, countdown, api, showToast: vi.fn(), windowRef: window });
    const root = makeRoot([{ id: 11, fleet_label: null, mission: 'transport', target_galaxy: 1, target_system: 1, target_position: 1, arrival_time: new Date(Date.now() + 60000).toISOString() }]);
    ol.renderFleetList({ root, renderTemplateList: makeRenderTemplateList(), onReload: async () => {} });
    root.querySelector('.fleet-label-edit-btn').click();
    const input = root.querySelector('.fleet-label-input');
    input.value = 'A'.repeat(60);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    const [, label] = api.renameFleet.mock.calls[0];
    expect(label.length).toBe(48);
  });
});

// ── RuntimeDesktopShell: registerGlobalHotkeys ────────────────────────────────

describe('RuntimeDesktopShell – registerGlobalHotkeys', () => {
  beforeEach(() => {
    delete window.GQRuntimeDesktopShell;
    loadModule('RuntimeDesktopShell');
  });

  function makeWindowRef() {
    const handlers = [];
    return {
      addEventListener: vi.fn((evt, fn) => handlers.push({ evt, fn })),
      removeEventListener: vi.fn(),
      _handlers: handlers,
      _fire(key, opts = {}) {
        handlers.filter((h) => h.evt === 'keydown').forEach((h) => {
          h.fn(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
        });
      },
    };
  }

  it('registerGlobalHotkeys is exported', () => {
    expect(typeof window.GQRuntimeDesktopShell.registerGlobalHotkeys).toBe('function');
  });

  it('registers keydown listener on windowRef', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    expect(windowRef.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('b key toggles buildings window', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    windowRef._fire('b');
    expect(wm.toggle).toHaveBeenCalledWith('buildings');
  });

  it('r key toggles research window', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    windowRef._fire('r');
    expect(wm.toggle).toHaveBeenCalledWith('research');
  });

  it('f key toggles fleet window', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    windowRef._fire('f');
    expect(wm.toggle).toHaveBeenCalledWith('fleet');
  });

  it('g key toggles galaxy window', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    windowRef._fire('g');
    expect(wm.toggle).toHaveBeenCalledWith('galaxy');
  });

  it('m key toggles messages window', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    windowRef._fire('m');
    expect(wm.toggle).toHaveBeenCalledWith('messages');
  });

  it('Ctrl+K opens command palette', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    windowRef._fire('k', { ctrlKey: true });
    expect(wm.showCommandPalette).toHaveBeenCalled();
  });

  it('does not fire when Ctrl modifier held (non-Ctrl+K key)', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    windowRef._fire('b', { ctrlKey: true });
    expect(wm.toggle).not.toHaveBeenCalled();
  });

  it('destroy() removes event listener', () => {
    const wm = makeWm();
    const windowRef = makeWindowRef();
    const handle = window.GQRuntimeDesktopShell.registerGlobalHotkeys({ wm, windowRef });
    handle.destroy();
    expect(windowRef.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
