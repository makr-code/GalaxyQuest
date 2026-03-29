import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const wmPath = path.resolve(process.cwd(), 'js/wm.js');

function loadWmScript() {
  delete window.WM;
  const source = fs.readFileSync(wmPath, 'utf8');
  window.eval(source);
  return window.WM;
}

describe('WM lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="wm-taskbar"></div>';
    localStorage.clear();
  });

  it('opens and closes a registered window', () => {
    const WM = loadWmScript();
    WM.register('unit_window', {
      title: 'Unit Window',
      w: 420,
      h: 260,
      onRender: () => {
        const root = WM.body('unit_window');
        if (root) root.innerHTML = '<p>ready</p>';
      },
    });

    WM.open('unit_window');

    expect(WM.isOpen('unit_window')).toBe(true);
    expect(WM.body('unit_window')).not.toBeNull();
    expect(document.getElementById('wm-win-unit_window')).not.toBeNull();

    WM.close('unit_window');

    expect(WM.isOpen('unit_window')).toBe(false);
    expect(document.getElementById('wm-win-unit_window')).toBeNull();
  });

  it('updates title via setTitle', () => {
    const WM = loadWmScript();
    WM.register('title_window', {
      title: 'Initial',
      w: 360,
      h: 200,
      onRender: () => {},
    });

    WM.open('title_window');
    WM.setTitle('title_window', 'Updated Title');

    const titleEl = document.querySelector('#wm-win-title_window .wm-title');
    expect(titleEl?.textContent).toBe('Updated Title');
  });
});
