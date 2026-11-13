import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePaths = [
  'js/engine/runtime/RuntimeGalaxyStarErrorUi.js',
  'js/engine/runtime/layers/integration/galaxy/ErrorUi.js',
  'js/engine/runtime/layers/ui/galaxy/StarErrorUi.js',
].map((relativePath) => path.resolve(process.cwd(), relativePath));

function loadModule(modulePath) {
  delete window.GQRuntimeGalaxyStarErrorUi;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeGalaxyStarErrorUi;
}

describe.each(modulePaths)('Galaxy star error UI DOM rendering: %s', (modulePath) => {
  it('renders recovered fallback details with text nodes and preserves fallback handling', () => {
    const api = loadModule(modulePath);
    const details = document.createElement('div');
    const renderFallbackList = vi.fn();
    const stars = [{ id: 1 }, { id: 2 }];

    const result = api.applyRecoveredFallback({
      root: document.createElement('main'),
      details,
      from: 2,
      to: 4,
      galaxyIndex: 0,
      errMsg: '<img src=x onerror=alert(1)>',
      fallbackStars: stars,
      galaxyStars: [],
      uiState: {},
      mergeGalaxyStarsBySystem: (_current, fallback) => fallback,
      applyStarsToRenderer: () => false,
      renderGalaxyFallbackList: renderFallbackList,
    });

    expect(result).toEqual({ handled: true, galaxyStars: stars });
    expect(renderFallbackList).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      stars,
      2,
      4,
      'network error (fallback): <img src=x onerror=alert(1)>'
    );
    expect(details.querySelector('span.text-yellow')?.textContent)
      .toBe('Netzwerkfehler bei 2..4; nutze lokalen Fallback mit 2 Sternen.');
    expect(details.querySelector('img, [onerror]')).toBeNull();
  });

  it('renders terminal errors as text and preserves fallback-list callback', () => {
    const api = loadModule(modulePath);
    const details = document.createElement('div');
    const renderFallbackList = vi.fn();
    const error = '<img src=x onerror=alert(2)>';
    const root = document.createElement('main');

    api.configureGalaxyStarErrorUiRuntime({ renderGalaxyFallbackList: renderFallbackList });
    api.renderTerminalFailure({
      root,
      details,
      from: 5,
      to: 7,
      errMsg: error,
      galaxyStars: [{ id: 9 }],
    });

    expect(details.querySelector('span.text-red')?.textContent).toBe(`Failed to load stars: ${error}`);
    expect(details.querySelector('img, [onerror]')).toBeNull();
    expect(renderFallbackList).toHaveBeenCalledWith(root, [{ id: 9 }], 5, 7, error);
  });
});
