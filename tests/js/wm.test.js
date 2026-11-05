import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('notifies overlay layers after opening or promoting a window', () => {
    const WM = loadWmScript();
    const focused = vi.fn();
    window.addEventListener('wm:focus-changed', focused);
    try {
      WM.register('layer_window', { title: 'Layer', w: 360, h: 200 });
      WM.open('layer_window');
      expect(focused.mock.lastCall[0].detail).toEqual({ id: 'layer_window' });
      const element = document.getElementById('wm-win-layer_window');
      const previousLayer = Number(element.style.zIndex);
      focused.mockClear();
      WM.open('layer_window');
      expect(focused.mock.lastCall[0].detail).toEqual({ id: 'layer_window' });
      expect(element.classList.contains('wm-focused')).toBe(true);
      expect(Number(element.style.zIndex)).toBeGreaterThan(previousLayer);
    } finally {
      window.removeEventListener('wm:focus-changed', focused);
    }
  });

  it('publishes completed window lifecycle changes and restores without re-rendering', () => {
    const WM = loadWmScript();
    const changes = [];
    const record = (event) => {
      changes.push({ ...event.detail, open: WM.isOpen(event.detail.id), minimized: WM.isMinimized(event.detail.id) });
    };
    const render = vi.fn();
    window.addEventListener('wm:window-state-changed', record);
    try {
      WM.register('state_window', { title: 'State', w: 360, h: 200, onRender: render });
      WM.open('state_window');
      WM.minimize('state_window');
      WM.minimize('state_window');
      WM.restore('state_window');
      WM.restore('state_window');
      WM.close('state_window');
      WM.close('state_window');
      expect(changes).toEqual([
        { id: 'state_window', action: 'open', open: true, minimized: false },
        { id: 'state_window', action: 'minimize', open: true, minimized: true },
        { id: 'state_window', action: 'restore', open: true, minimized: false },
        { id: 'state_window', action: 'close', open: false, minimized: false },
      ]);
      expect(render).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('wm:window-state-changed', record);
    }
  });

  it('selects background windows and restores drafts without rendering, but minimizes the active task', () => {
    const WM = loadWmScript();
    const render = vi.fn((root) => { root.innerHTML = '<input value="4.5">'; });
    for (const id of ['task_first', 'task_second']) {
      WM.register(id, { title: id, w: 360, h: 200, onRender: render });
      WM.open(id);
    }
    const first = document.getElementById('wm-win-task_first');
    const firstTask = document.getElementById('wm-task-task_first');
    const secondTask = document.getElementById('wm-task-task_second');
    const input = first.querySelector('input');
    input.value = '7.25';
    expect(firstTask.getAttribute('aria-controls')).toBe(first.id);
    expect(firstTask.getAttribute('aria-pressed')).toBe('false');
    expect(secondTask.getAttribute('aria-pressed')).toBe('true');
    expect(firstTask.title).toContain('Fokus');
    firstTask.click();
    expect(WM.isMinimized('task_first')).toBe(false);
    expect(first.classList.contains('wm-focused')).toBe(true);
    expect(firstTask.getAttribute('aria-pressed')).toBe('true');
    expect(secondTask.getAttribute('aria-pressed')).toBe('false');
    firstTask.click();
    expect(WM.isMinimized('task_first')).toBe(true);
    expect(first.classList.contains('wm-focused')).toBe(false);
    expect(firstTask.getAttribute('aria-pressed')).toBe('false');
    expect(firstTask.title).toContain('Wiederherstellen');
    firstTask.click();
    expect(WM.isMinimized('task_first')).toBe(false);
    expect(first.classList.contains('wm-focused')).toBe(true);
    expect(first.querySelector('input')).toBe(input);
    expect(input.value).toBe('7.25');
    expect(render).toHaveBeenCalledTimes(2);
    WM.setTitle('task_first', 'Changed');
    expect(firstTask.title).toBe('Changed: Minimieren');
    WM.close('task_first');
    expect(document.getElementById('wm-task-task_first')).toBeNull();
  });

  it('preserves task multi-selection without minimizing or focusing another window', () => {
    const WM = loadWmScript();
    for (const id of ['task_first', 'task_second']) {
      WM.register(id, { title: id, w: 360, h: 200 });
      WM.open(id);
    }
    const task = document.getElementById('wm-task-task_first');
    for (const modifier of ['ctrlKey', 'metaKey']) {
      task.dispatchEvent(new MouseEvent('click', { bubbles: true, [modifier]: true }));
      expect(WM.isMinimized('task_first')).toBe(false);
      expect(task.getAttribute('aria-pressed')).toBe('false');
      expect(document.getElementById('wm-task-task_second').getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('reveals an inactive grouped window through its task instead of minimizing a hidden tab', () => {
    const WM = loadWmScript();
    const render = vi.fn();
    for (const id of ['task_first', 'task_second']) {
      WM.register(id, { title: id, w: 360, h: 200, onRender: render });
      WM.open(id);
    }
    const group = WM.createDockGroup(['task_first', 'task_second']);
    const second = document.getElementById('wm-win-task_second');
    const task = document.getElementById('wm-task-task_second');
    expect(second.classList.contains('wm-dock-group-hidden')).toBe(true);
    expect(task.getAttribute('aria-pressed')).toBe('false');
    task.click();
    expect(WM.listDockGroups().find((item) => item.id === group).activeId).toBe('task_second');
    expect(second.classList.contains('wm-dock-group-hidden')).toBe(false);
    expect(WM.isMinimized('task_second')).toBe(false);
    expect(task.getAttribute('aria-pressed')).toBe('true');
    expect(render).toHaveBeenCalledTimes(2);
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
