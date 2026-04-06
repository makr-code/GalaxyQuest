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
});
