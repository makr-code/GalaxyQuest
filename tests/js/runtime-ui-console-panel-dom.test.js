import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeUiConsolePanel.js');

function loadModule() {
  delete window.GQRuntimeUiConsolePanel;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeUiConsolePanel;
}

describe('RuntimeUiConsolePanel DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui-console-log"></div>';
  });

  it('renders log lines as text nodes even when an identity escaper is supplied', () => {
    const lines = [
      '<img src=x onerror=alert(1)>',
      '"><svg onload=alert(2)>',
      '',
    ];
    const store = {
      push: vi.fn(),
      getVisibleLines: () => lines,
    };
    const controller = loadModule().createUiConsoleController({
      store,
      esc: String,
      documentRef: document,
    });
    const log = document.getElementById('ui-console-log');

    controller.render();

    expect(log.children).toHaveLength(3);
    expect(log.querySelector('img, svg')).toBeNull();
    expect(log.querySelector('[onerror], [onload]')).toBeNull();
    expect(Array.from(log.children, (entry) => entry.textContent)).toEqual(lines);
  });

  it('replaces stale entries when the visible history changes', () => {
    let lines = ['first', 'second'];
    const controller = loadModule().createUiConsoleController({
      store: { push: vi.fn(), getVisibleLines: () => lines },
      documentRef: document,
    });
    const log = document.getElementById('ui-console-log');

    controller.render();
    lines = ['updated'];
    controller.render();

    expect(log.children).toHaveLength(1);
    expect(log.textContent).toBe('updated');
  });
});
