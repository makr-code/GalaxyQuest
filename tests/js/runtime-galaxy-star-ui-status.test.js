import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePaths = [
  'js/engine/runtime/RuntimeGalaxyStarUiStatus.js',
  'js/engine/runtime/layers/integration/galaxy/UiStatus.js',
  'js/engine/runtime/layers/ui/galaxy/StarUiStatus.js',
].map((relativePath) => path.resolve(process.cwd(), relativePath));

function loadModule(modulePath) {
  delete window.GQRuntimeGalaxyStarUiStatus;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeGalaxyStarUiStatus;
}

describe.each(modulePaths)('Galaxy star UI status DOM rendering: %s', (modulePath) => {
  it('renders status variants as text nodes with their existing state classes', () => {
    const api = loadModule(modulePath);
    const details = document.createElement('div');

    api.setLoadingStatus(details);
    expect(details.querySelector('.text-muted')?.textContent).toBe('Loading star cloud...');

    api.setCacheStatus(details, 12, true);
    expect(details.querySelector('.text-cyan')?.textContent)
      .toBe('Cache: 12 stars loaded (complete range). Syncing live data...');

    api.setPolicySkipStatus(details, 4, 9);
    expect(details.querySelector('.text-cyan')?.textContent)
      .toBe('Policy hit: fresh range from cache (4-9), network refresh skipped.');

    api.setNetworkErrorStatus(details, 'auth');
    expect(details.querySelector('.text-red')?.textContent).toBe('Session expired. Please log in again.');

    api.setNetworkErrorStatus(details, 'schema');
    expect(details.querySelector('.text-red')?.textContent).toBe('Could not load stars (schema mismatch).');

    api.setNetworkErrorStatus(details, 'stale');
    expect(details.querySelector('.text-yellow')?.textContent).toBe('Star data is stale.');

    api.setNetworkErrorStatus(details, '<img src=x onerror=alert(1)>');
    expect(details.querySelector('.text-red')?.textContent).toBe('Could not load stars (network).');

    api.setStaleStatus(details);
    expect(details.querySelector('.text-yellow')?.textContent).toBe('Loaded stale star data; resyncing...');

    api.setLoadedStatus(details, 20, 1, 100, 2);
    expect(details.querySelector('.text-cyan')?.textContent)
      .toBe('Loaded 20 stars from systems 1..100 (stride 2).');
    expect(details.querySelector('img, [onerror]')).toBeNull();
    expect(details.children).toHaveLength(1);
  });

  it('keeps range input limits and treats a missing details node as a no-op', () => {
    const api = loadModule(modulePath);
    const root = document.createElement('div');
    root.innerHTML = '<input id="gal-from"><input id="gal-to">';

    api.setRangeInputMax(root, 250);
    api.setLoadingStatus(null);
    api.setCacheStatus(null, Symbol('ignored'), true);

    expect(root.querySelector('#gal-from').max).toBe('250');
    expect(root.querySelector('#gal-to').max).toBe('250');
  });
});
