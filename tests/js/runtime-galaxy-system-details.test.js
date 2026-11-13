import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePaths = [
  'js/engine/runtime/RuntimeGalaxySystemDetailsFacade.js',
  'js/engine/runtime/layers/ui/galaxy/SystemDetailsFacade.js',
].map((relativePath) => path.resolve(process.cwd(), relativePath));

function loadModule(modulePath) {
  delete window.GQRuntimeGalaxySystemDetailsFacade;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeGalaxySystemDetailsFacade;
}

function createRoot() {
  const root = document.createElement('main');
  const details = document.createElement('div');
  details.id = 'galaxy-system-details';
  root.append(details);
  return { root, details };
}

describe.each(modulePaths)('Galaxy system details DOM rendering: %s', (modulePath) => {
  it('renders empty-state navigation with DOM nodes and preserves its action', () => {
    const api = loadModule(modulePath);
    const triggerGalaxyNavAction = vi.fn();
    const { root, details } = createRoot();
    const facade = api.createGalaxySystemDetailsFacade({
      triggerGalaxyNavAction,
      getWindowRef: () => ({ _GQ_fleets: [] }),
    });

    facade.renderGalaxySystemDetails(root, null, false);

    expect(details.querySelector('.galaxy-detail-nav')).not.toBeNull();
    expect(details.querySelector('.text-muted')?.textContent).toContain('Press I for this overlay.');
    details.querySelector('[data-nav-action="home"]').click();
    expect(triggerGalaxyNavAction).toHaveBeenCalledWith('home', root);
  });

  it('renders cluster text safely and keeps cluster loading and navigation actions', async () => {
    const api = loadModule(modulePath);
    const triggerGalaxyNavAction = vi.fn();
    const applyClusterRangeToControls = vi.fn(() => ({ from: 1, to: 2 }));
    const loadGalaxyStars3D = vi.fn(async () => {});
    const { root, details } = createRoot();
    const facade = api.createGalaxySystemDetailsFacade({
      triggerGalaxyNavAction,
      applyClusterRangeToControls,
      loadGalaxyStars3D,
      getWindowRef: () => ({ _GQ_fleets: [] }),
    });
    const payload = '<img src=x onerror=alert(1)>';

    facade.renderGalaxySystemDetails(root, {
      __kind: 'cluster',
      label: payload,
      __clusterSystems: [1, 2],
      faction: { name: payload },
      __clusterSize: { x: 1, y: 2, z: 3 },
      __clusterCenter: { x: 4, y: 5, z: 6 },
    }, false);

    expect(details.querySelector('.system-title')?.textContent).toBe(payload);
    expect(details.querySelector('.system-row')?.textContent).toContain(payload);
    expect(details.querySelector('img, [onerror]')).toBeNull();
    details.querySelector('[data-nav-action="home"]').click();
    expect(triggerGalaxyNavAction).toHaveBeenCalledWith('home', root);

    details.querySelector('#gal-load-cluster-range-btn').click();
    await vi.waitFor(() => expect(loadGalaxyStars3D).toHaveBeenCalledOnce());
    expect(applyClusterRangeToControls).toHaveBeenCalledWith(root, expect.objectContaining({ __kind: 'cluster' }), { toast: true });
  });

  it('renders star and colony data as text and rejects untrusted colony CSS colors', () => {
    const api = loadModule(modulePath);
    const addFavorite = vi.fn();
    const prefillFleetTarget = vi.fn();
    const { root, details } = createRoot();
    const facade = api.createGalaxySystemDetailsFacade({
      addFavorite,
      prefillFleetTarget,
      isFavoriteStar: () => false,
      getGalaxy3d: () => ({ galaxyFleetEntries: [{}], isFollowingSelection: () => false }),
      getWindowRef: () => ({ _GQ_fleets: [] }),
    });
    const payload = '<img src=x onerror=alert(1)>';
    const maliciousColor = 'red; background-image:url(javascript:alert(1))';
    const star = {
      name: payload,
      catalog_name: payload,
      galaxy_index: 2,
      system_index: 4,
      spectral_class: 'G',
      subtype: 2,
      x_ly: 1,
      y_ly: 2,
      z_ly: 3,
      hz_inner_au: 0.8,
      hz_outer_au: 1.2,
      planet_count: 2,
      colony_count: 1,
      colony_population: 1000,
      colony_owner_color: maliciousColor,
      colony_owner_name: payload,
      visibility_level: payload,
    };

    facade.renderGalaxySystemDetails(root, star, false);

    expect(details.querySelector('.system-title')?.textContent).toBe(payload);
    expect(details.querySelector('.system-row-colony')?.textContent).toContain(payload);
    expect(details.querySelector('.system-row-colony')?.textContent).toContain('Aussenposten');
    expect(details.querySelector('img, [onerror]')).toBeNull();
    const swatch = details.querySelector('.system-colony-swatch');
    expect(swatch.style.backgroundColor).not.toContain('url');
    expect(swatch.style.boxShadow).not.toContain('javascript');
    details.querySelector('[data-system-action="fleet"]').click();
    expect(prefillFleetTarget).toHaveBeenCalledWith(
      { galaxy: 2, system: 4, position: 1 },
      'transport',
      { owner: payload }
    );
    details.querySelector('#gal-quicknav-fav-btn').click();
    expect(addFavorite).toHaveBeenCalledWith(star);
    expect(details.querySelector('#gal-quicknav-fav-btn').textContent).toBe('Favorit entfernen');
  });
});
