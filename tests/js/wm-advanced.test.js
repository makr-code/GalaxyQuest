import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const gqUiPath = path.resolve(process.cwd(), 'js/ui/gq-ui.js');
const wmPath = path.resolve(process.cwd(), 'js/runtime/wm.js');
const gqwmPath = path.resolve(process.cwd(), 'js/runtime/gqwm.js');

function loadWmScript() {
  delete window.GQUI;
  delete window.WMCore;
  delete window.WM;
  window.eval(fs.readFileSync(gqUiPath, 'utf8'));
  window.eval(fs.readFileSync(wmPath, 'utf8'));
  window.eval(fs.readFileSync(gqwmPath, 'utf8'));
  return window.WM;
}

describe('WM advanced features', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="wm-taskbar"></div>';
    localStorage.clear();
  });

  it('executes registered commands and lists them', () => {
    const WM = loadWmScript();
    let hit = 0;

    WM.registerCommand('unit.command', {
      label: 'Unit Command',
      shortcut: 'Ctrl+Shift+U',
      execute: () => { hit += 1; },
    });

    const cmds = WM.listCommands('unit');
    expect(cmds.some((c) => c.id === 'unit.command')).toBe(true);

    const ok = WM.executeCommand('unit.command', { source: 'test' });
    expect(ok).toBe(true);
    expect(hit).toBe(1);
  });

  it('creates dock group and switches active tab', () => {
    const WM = loadWmScript();

    WM.register('dock_a', { title: 'Dock A', w: 260, h: 180, onRender: () => {} });
    WM.register('dock_b', { title: 'Dock B', w: 260, h: 180, onRender: () => {} });

    WM.open('dock_a');
    WM.open('dock_b');

    const gid = WM.createDockGroup(['dock_a', 'dock_b']);
    expect(typeof gid).toBe('string');

    let groups = WM.listDockGroups();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].activeId).toBe('dock_a');

    const switched = WM.activateDockTab(gid, 'dock_b');
    expect(switched).toBe(true);

    groups = WM.listDockGroups();
    const group = groups.find((g) => g.id === gid);
    expect(group?.activeId).toBe('dock_b');

    const reordered = WM.reorderDockTab(gid, 'dock_b', 0);
    expect(reordered).toBe(true);
    groups = WM.listDockGroups();
    const reorderedGroup = groups.find((g) => g.id === gid);
    expect(reorderedGroup?.tabs?.[0]).toBe('dock_b');
  });

  it('activateDockTab transfers geometry from previous active window', () => {
    const WM = loadWmScript();

    WM.register('geo_a', { title: 'Geo A', w: 300, h: 200, onRender: () => {} });
    WM.register('geo_b', { title: 'Geo B', w: 300, h: 200, onRender: () => {} });
    WM.open('geo_a');
    WM.open('geo_b');

    // Set an explicit geometry on geo_a (the initial active tab)
    const elA = document.getElementById('wm-win-geo_a');
    elA.style.left   = '120px';
    elA.style.top    = '60px';
    elA.style.width  = '400px';
    elA.style.height = '300px';

    const gid = WM.createDockGroup(['geo_a', 'geo_b']);
    WM.activateDockTab(gid, 'geo_b');

    const elB = document.getElementById('wm-win-geo_b');
    expect(elB.style.left).toBe('120px');
    expect(elB.style.top).toBe('60px');
    expect(elB.style.width).toBe('400px');
    expect(elB.style.height).toBe('300px');
  });

  it('minimize active dock tab promotes next visible tab', () => {
    const WM = loadWmScript();

    WM.register('min_a', { title: 'Min A', w: 280, h: 190, onRender: () => {} });
    WM.register('min_b', { title: 'Min B', w: 280, h: 190, onRender: () => {} });
    WM.open('min_a');
    WM.open('min_b');

    const gid = WM.createDockGroup(['min_a', 'min_b']);
    // min_a is active; minimize it → group should promote min_b
    WM.minimize('min_a');

    const groups = WM.listDockGroups();
    const group = groups.find((g) => g.id === gid);
    expect(group?.activeId).toBe('min_b');
  });

  it('restore puts window back as active dock tab', () => {
    const WM = loadWmScript();

    WM.register('rst_a', { title: 'Rst A', w: 280, h: 190, onRender: () => {} });
    WM.register('rst_b', { title: 'Rst B', w: 280, h: 190, onRender: () => {} });
    WM.open('rst_a');
    WM.open('rst_b');

    const gid = WM.createDockGroup(['rst_a', 'rst_b']);
    WM.minimize('rst_a');   // promotes rst_b
    WM.restore('rst_a');    // should make rst_a active again

    const groups = WM.listDockGroups();
    const group = groups.find((g) => g.id === gid);
    expect(group?.activeId).toBe('rst_a');
  });

  it('saves and loads a layout profile', () => {
    const WM = loadWmScript();

    WM.register('layout_a', { title: 'Layout A', w: 300, h: 190, onRender: () => {} });
    WM.open('layout_a');

    const saved = WM.saveLayoutProfile('unit_quick', { scope: 'global' });
    expect(saved).toBe(true);

    const list = WM.listLayoutProfiles({ scope: 'global' });
    expect(list.includes('unit_quick')).toBe(true);

    const loaded = WM.loadLayoutProfile('unit_quick', { scope: 'global' });
    expect(loaded).toBe(true);
  });

  it('persists dock groups in layout profiles', () => {
    const WM = loadWmScript();

    WM.register('dock_group_a', { title: 'Dock A', w: 300, h: 190, onRender: () => {} });
    WM.register('dock_group_b', { title: 'Dock B', w: 300, h: 190, onRender: () => {} });
    WM.open('dock_group_a');
    WM.open('dock_group_b');

    const gid = WM.createDockGroup(['dock_group_a', 'dock_group_b']);
    WM.activateDockTab(gid, 'dock_group_b');

    // Save layout with dock group
    WM.saveLayoutProfile('dock_layout', { scope: 'global' });

    // Close both windows and clear
    WM.close('dock_group_a');
    WM.close('dock_group_b');
    WM.clearWindowSelection();
    expect(WM.listDockGroups().length).toBe(0);

    // Load layout and verify dock group is restored
    const loaded = WM.loadLayoutProfile('dock_layout', { scope: 'global' });
    expect(loaded).toBe(true);

    const restored = WM.listDockGroups();
    expect(restored.length).toBe(1);
    expect(restored[0].tabs).toContain('dock_group_a');
    expect(restored[0].tabs).toContain('dock_group_b');
    expect(restored[0].activeId).toBe('dock_group_b');
  });

  it('preserves minimized window state in layout profiles', () => {
    const WM = loadWmScript();

    WM.register('min_a', { title: 'Min A', w: 300, h: 190, onRender: () => {} });
    WM.register('min_b', { title: 'Min B', w: 300, h: 190, onRender: () => {} });
    WM.open('min_a');
    WM.open('min_b');
    WM.minimize('min_a');

    // Save layout with one window minimized
    WM.saveLayoutProfile('minimized_layout', { scope: 'global' });

    // Close and verify they're gone
    WM.close('min_a');
    WM.close('min_b');

    // Load layout and verify minimized state
    const loaded = WM.loadLayoutProfile('minimized_layout', { scope: 'global' });
    expect(loaded).toBe(true);

    expect(WM.isMinimized('min_a')).toBe(true);
    expect(WM.isMinimized('min_b')).toBe(false);
  });

  it('registers and dispatches hotkeys for commands', () => {
    const WM = loadWmScript();
    let executed = 0;

    WM.registerCommand('unit.hotkey', {
      label: 'Unit Hotkey Command',
      shortcuts: ['Ctrl+H', 'Shift+U'],
      execute() { executed++; },
    });

    // Verify command was registered with hotkeys
    const cmds = WM.listCommands('unit.hotkey');
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds[0].shortcuts || cmds[0].shortcut).toBeDefined();

    // Simulate Ctrl+H keypress
    const event1 = new KeyboardEvent('keydown', {
      key: 'h',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event1);
    expect(executed).toBe(1);

    // Simulate Shift+U keypress
    const event2 = new KeyboardEvent('keydown', {
      key: 'u',
      shiftKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event2);
    expect(executed).toBe(2);

    // Simulate unrelated keypress (no execution)
    const event3 = new KeyboardEvent('keydown', {
      key: 'x',
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event3);
    expect(executed).toBe(2);
  });

  it('rejects conflicting hotkey registrations across commands', () => {
    const WM = loadWmScript();
    let hitsA = 0;
    let hitsB = 0;

    const okA = WM.registerCommand('unit.hotkey.a', {
      label: 'Hotkey A',
      shortcut: 'Ctrl+J',
      execute() { hitsA++; },
    });
    expect(okA).toBe(true);

    const okB = WM.registerCommand('unit.hotkey.b', {
      label: 'Hotkey B',
      shortcut: 'Ctrl+J',
      execute() { hitsB++; },
    });
    expect(okB).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      bubbles: true,
    }));
    expect(hitsA).toBe(1);
    expect(hitsB).toBe(0);
  });

  it('updates shortcuts on re-register without stale bindings', () => {
    const WM = loadWmScript();
    let hits = 0;

    const first = WM.registerCommand('unit.hotkey.update', {
      label: 'Hotkey Update',
      shortcut: 'Ctrl+1',
      execute() { hits++; },
    });
    expect(first).toBe(true);

    const second = WM.registerCommand('unit.hotkey.update', {
      label: 'Hotkey Update',
      shortcut: 'Ctrl+2',
      execute() { hits++; },
    });
    expect(second).toBe(true);

    // Old binding should no longer execute.
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '1',
      ctrlKey: true,
      bubbles: true,
    }));
    expect(hits).toBe(0);

    // New binding should execute.
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '2',
      ctrlKey: true,
      bubbles: true,
    }));
    expect(hits).toBe(1);
  });

  it('toggles window selection with Ctrl+Click', () => {
    const WM = loadWmScript();

    WM.register('sel_a', { title: 'Sel A', w: 280, h: 180, onRender: () => {} });
    WM.register('sel_b', { title: 'Sel B', w: 280, h: 180, onRender: () => {} });
    WM.open('sel_a');
    WM.open('sel_b');

    const elA = document.getElementById('wm-win-sel_a');
    const evToggleOn = new MouseEvent('click', { bubbles: true, ctrlKey: true });
    elA.dispatchEvent(evToggleOn);
    expect(WM.getSelectedWindows()).toContain('sel_a');

    const evToggleOff = new MouseEvent('click', { bubbles: true, ctrlKey: true });
    elA.dispatchEvent(evToggleOff);
    expect(WM.getSelectedWindows()).not.toContain('sel_a');
  });

  it('selects a range with Shift+Click using last selected anchor', () => {
    const WM = loadWmScript();

    WM.register('range_a', { title: 'Range A', w: 280, h: 180, onRender: () => {} });
    WM.register('range_b', { title: 'Range B', w: 280, h: 180, onRender: () => {} });
    WM.register('range_c', { title: 'Range C', w: 280, h: 180, onRender: () => {} });
    WM.open('range_a');
    WM.open('range_b');
    WM.open('range_c');

    const elA = document.getElementById('wm-win-range_a');
    const elC = document.getElementById('wm-win-range_c');

    // Set anchor via Ctrl+Click on first window
    elA.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(WM.getSelectedWindows()).toContain('range_a');

    // Shift+Click on third window should select a..c range
    elC.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    const selected = WM.getSelectedWindows();
    expect(selected).toContain('range_a');
    expect(selected).toContain('range_b');
    expect(selected).toContain('range_c');
  });

    it('switches dock tabs with Ctrl+Tab and Ctrl+Shift+Tab', () => {
      const WM = loadWmScript();

      WM.register('tab_a', { title: 'Tab A', w: 300, h: 190, onRender: () => {} });
      WM.register('tab_b', { title: 'Tab B', w: 300, h: 190, onRender: () => {} });
      WM.register('tab_c', { title: 'Tab C', w: 300, h: 190, onRender: () => {} });
      WM.open('tab_a');
      WM.open('tab_b');
      WM.open('tab_c');

      const gid = WM.createDockGroup(['tab_a', 'tab_b', 'tab_c']);
      expect(WM.listDockGroups().find((g) => g.id === gid)?.activeId).toBe('tab_a');

      // Simulate Ctrl+Tab (next tab)
      const nextEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(nextEvent);
      expect(WM.listDockGroups().find((g) => g.id === gid)?.activeId).toBe('tab_b');

      document.dispatchEvent(nextEvent);
      expect(WM.listDockGroups().find((g) => g.id === gid)?.activeId).toBe('tab_c');

      // Simulate Ctrl+Shift+Tab (previous tab)
      const prevEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      });
      document.dispatchEvent(prevEvent);
      expect(WM.listDockGroups().find((g) => g.id === gid)?.activeId).toBe('tab_b');

      document.dispatchEvent(prevEvent);
      expect(WM.listDockGroups().find((g) => g.id === gid)?.activeId).toBe('tab_a');

      // Wrap around: Ctrl+Shift+Tab from first tab goes to last
      document.dispatchEvent(prevEvent);
      expect(WM.listDockGroups().find((g) => g.id === gid)?.activeId).toBe('tab_c');
  });

  it('cycles focused windows with Alt+Tab and Alt+Shift+Tab', () => {
    const WM = loadWmScript();

    WM.register('focus_a', { title: 'Focus A', w: 280, h: 180, onRender: () => {} });
    WM.register('focus_b', { title: 'Focus B', w: 280, h: 180, onRender: () => {} });
    WM.register('focus_c', { title: 'Focus C', w: 280, h: 180, onRender: () => {} });
    WM.open('focus_a');
    WM.open('focus_b');
    WM.open('focus_c');

    const currentFocusedId = () => {
      const focused = document.querySelector('.wm-window.wm-focused');
      return focused ? focused.id.replace(/^wm-win-/, '') : null;
    };

    // Initial focus is on last opened window
    expect(currentFocusedId()).toBe('focus_c');

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      altKey: true,
      bubbles: true,
    }));
    expect(currentFocusedId()).toBe('focus_a');

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      altKey: true,
      bubbles: true,
    }));
    expect(currentFocusedId()).toBe('focus_b');

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      altKey: true,
      shiftKey: true,
      bubbles: true,
    }));
    expect(currentFocusedId()).toBe('focus_a');
  });
});
