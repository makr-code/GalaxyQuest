import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePaths = [
  'js/engine/runtime/RuntimeGalaxyDebugLog.js',
  'js/engine/runtime/layers/integration/galaxy/DebugLog.js',
].map((relativePath) => path.resolve(process.cwd(), relativePath));

function loadModule(modulePath) {
  delete window.GQRuntimeGalaxyDebugLog;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeGalaxyDebugLog;
}

describe.each(modulePaths)('Galaxy debug log DOM rendering: %s', (modulePath) => {
  it('renders empty state and dynamic exception details as text while preserving the entry cap', () => {
    const api = loadModule(modulePath);
    const root = document.createElement('main');
    const log = document.createElement('div');
    log.id = 'galaxy-debug-log';
    root.append(log);
    api.configureGalaxyDebugLogRuntime({
      wm: { body: () => root },
      documentRef: document,
      navigatorRef: null,
      maxEntries: 2,
    });

    api.renderGalaxyDebugPanel();
    expect(log.querySelector('.galaxy-debug-empty')?.textContent)
      .toBe('Keine aktuellen Lade-/Renderfehler.');

    api.pushGalaxyDebugError(
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(2)>',
      '<iframe src=javascript:alert(3)>'
    );
    expect(log.querySelector('.galaxy-debug-source')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(log.querySelector('.galaxy-debug-msg')?.textContent).toBe('<svg onload=alert(2)>');
    expect(log.querySelector('.galaxy-debug-extra')?.textContent).toBe('<iframe src=javascript:alert(3)>');
    expect(log.querySelector('img, svg, iframe, [onerror], [onload]')).toBeNull();

    api.pushGalaxyDebugError('older', 'Older error');
    api.pushGalaxyDebugError('latest', 'Latest error');
    expect(log.querySelectorAll('.galaxy-debug-item')).toHaveLength(2);
    expect(log.querySelectorAll('.galaxy-debug-source')[0].textContent).toBe('latest');
    expect(log.querySelectorAll('.galaxy-debug-source')[1].textContent).toBe('older');
  });
});
