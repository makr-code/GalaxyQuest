import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePaths = [
  'js/engine/runtime/RuntimeGalaxyControllerWindow.js',
  'js/engine/runtime/layers/ui/galaxy/ControllerWindow.js',
].map((relativePath) => path.resolve(process.cwd(), relativePath));

function loadModule(modulePath) {
  delete window.GQRuntimeGalaxyControllerWindow;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeGalaxyControllerWindow;
}

describe.each(modulePaths)('Galaxy controller window DOM rendering: %s', (modulePath) => {
  it('renders controls as DOM nodes, keeps bounded settings, and treats profile labels as text', () => {
    const api = loadModule(modulePath);
    const root = document.createElement('main');
    const bindGalaxyWindowControls = vi.fn();
    const profileLabel = '<img src=x onerror=alert(1)>';
    const facade = api.createGalaxyControllerWindow({
      galaxySystemMax: 12,
      getActivePolicyMode: () => 'manual',
      getActivePolicyProfile: () => 'custom',
      policyProfiles: {
        custom: { label: profileLabel },
        balanced: { label: 'Balanced' },
      },
      settingsState: {
        clusterDensityMode: 'max',
        hoverMagnetStarPx: 100,
        hoverMagnetPlanetPx: 1,
        hoverMagnetClusterPx: 50,
      },
      bindGalaxyWindowControls,
    });

    facade.renderWindowShell(root);

    expect(root.querySelector('.galaxy-3d-stage')).not.toBeNull();
    expect(root.querySelector('#gal-from').getAttribute('max')).toBe('12');
    expect(root.querySelector('#gal-to').value).toBe('12');
    expect(root.querySelector('#gal-magnet-star-px').value).toBe('64');
    expect(root.querySelector('#gal-magnet-planet-px').value).toBe('8');
    expect(root.querySelector('#gal-magnet-cluster-px').value).toBe('50');
    expect(root.querySelector('#gal-cluster-density').value).toBe('max');

    const policyOptions = root.querySelectorAll('#gal-policy-profile option');
    expect(policyOptions).toHaveLength(4);
    expect(policyOptions[0].textContent).toBe(`Auto (${profileLabel})`);
    expect(root.querySelector('img, [onerror]')).toBeNull();
    expect(bindGalaxyWindowControls).toHaveBeenCalledOnce();
    expect(bindGalaxyWindowControls).toHaveBeenCalledWith(root);

    const stage = root.querySelector('.galaxy-3d-stage');
    facade.renderWindowShell(root);
    expect(root.querySelectorAll('.galaxy-3d-stage')).toHaveLength(1);
    expect(root.querySelector('.galaxy-3d-stage')).toBe(stage);
    expect(bindGalaxyWindowControls).toHaveBeenCalledOnce();
  });
});
