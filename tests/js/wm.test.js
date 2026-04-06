import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const gqUiPath  = path.resolve(process.cwd(), 'js/ui/gq-ui.js');
const wmPath    = path.resolve(process.cwd(), 'js/runtime/wm.js');
const gqwmPath  = path.resolve(process.cwd(), 'js/runtime/gqwm.js');

function loadWmScript() {
  delete window.GQUI;
  delete window.WMCore;
  delete window.WM;
  window.eval(fs.readFileSync(gqUiPath, 'utf8'));
  window.eval(fs.readFileSync(wmPath,   'utf8'));
  window.eval(fs.readFileSync(gqwmPath, 'utf8'));
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

  it('minimap window registers and opens with canvas body', () => {
    const WM = loadWmScript();

    let renderRoot = null;
    WM.register('minimap', {
      title: '🗺 Minimap',
      w: 290,
      h: 310,
      onRender: (root) => {
        renderRoot = root;
        if (!root) return;
        let wrap = root.querySelector('.minimap-wrap');
        if (!wrap) {
          root.innerHTML = '';
          wrap = document.createElement('div');
          wrap.className = 'minimap-wrap';
          root.appendChild(wrap);
        }
        let canvas = wrap.querySelector('.minimap-canvas');
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.className = 'minimap-canvas';
          wrap.appendChild(canvas);
        }
      },
    });

    WM.open('minimap');

    expect(WM.isOpen('minimap')).toBe(true);
    expect(renderRoot).not.toBeNull();
    expect(renderRoot.querySelector('.minimap-wrap')).not.toBeNull();
    expect(renderRoot.querySelector('.minimap-canvas')).not.toBeNull();

    WM.close('minimap');
    expect(WM.isOpen('minimap')).toBe(false);
  });

  it('minimap window can be minimised and restored', () => {
    const WM = loadWmScript();
    WM.register('minimap', {
      title: '🗺 Minimap',
      w: 290,
      h: 310,
      onRender: () => {},
    });

    WM.open('minimap');
    expect(WM.isOpen('minimap')).toBe(true);

    // Simulate minimise via the button
    const minBtn = document.querySelector('#wm-win-minimap .wm-btn-min');
    expect(minBtn).not.toBeNull();
    minBtn.click();

    // After minimise the window element still exists but is not in focus
    expect(document.getElementById('wm-win-minimap')).not.toBeNull();

    // Re-opening restores it
    WM.open('minimap');
    expect(WM.isOpen('minimap')).toBe(true);
  });
});
