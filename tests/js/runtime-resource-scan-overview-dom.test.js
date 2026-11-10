import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeResourceScanOverview.js');

function loadModule() {
  delete window.GQRuntimeResourceScanOverview;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeResourceScanOverview;
}

describe('RuntimeResourceScanOverview DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes system fields internally and constrains API colors to hex', () => {
    const root = document.createElement('div');
    const controller = loadModule().createResourceScanOverviewController({
      wm: { body: () => root },
      api: {},
      esc: (value) => String(value),
    });

    const html = controller.renderSystemCard({
      star: {
        name: '<img src=x onerror=alert(1)>',
        galaxy_index: '1"><svg onload=alert(2)>',
        system_index: '2"><img src=x onerror=alert(3)>',
        spectral_class: 'G',
        subtype: 2,
        colony_count: 1,
        colony_owner_color: 'red; background-image:url(javascript:alert(4))',
        colony_owner_name: '<b onclick=alert(5)>Owner</b>',
        planets: [],
      },
      isOwn: false,
      surveys: [],
    });
    root.innerHTML = html;

    expect(root.querySelector('img, svg, b')).toBeNull();
    expect(root.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(root.querySelector('span[style*="background-image"]')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('1"><svg onload=alert(2)>:2"><img src=x onerror=alert(3)>');
    expect(Array.from(root.querySelectorAll('span[style*="color:"]'))
      .some((span) => span.getAttribute('style').includes('#7db7ee'))).toBe(true);
  });

  it('escapes saved search text and preserves static scan controls', () => {
    const controller = loadModule().createResourceScanOverviewController({
      wm: { body: () => document.createElement('div') },
      api: {},
      esc: (value) => String(value),
      uiKitEmptyStateHTML: () => '',
    });
    controller.search = '" onfocus="alert(1)';
    controller.scannedSystems = [];

    const root = document.createElement('div');
    root.innerHTML = controller.buildHtml();

    expect(root.querySelector('[onfocus]')).toBeNull();
    expect(root.querySelector('[data-scan-search]').value).toBe('" onfocus="alert(1)');
    expect(root.querySelectorAll('[data-scan-filter]')).toHaveLength(3);
  });

  it('renders trusted static skeleton and empty-state callbacks as before', async () => {
    const root = document.createElement('div');
    const controller = loadModule().createResourceScanOverviewController({
      wm: { body: () => root },
      api: {
        processFleetArrivals: vi.fn(async () => {}),
        fleets: vi.fn(async () => ({ fleets: [] })),
      },
      uiKitSkeletonHTML: () => '<p class="skeleton">Loading</p>',
      uiKitEmptyStateHTML: () => '<p class="empty-state">No systems</p>',
      getGalaxyStars: () => [],
    });

    const renderPromise = controller.render();
    expect(root.querySelector('.skeleton')).not.toBeNull();
    await renderPromise;
    expect(root.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders non-finite deposit amounts as safe zero values', () => {
    const controller = loadModule().createResourceScanOverviewController({
      wm: { body: () => document.createElement('div') },
      api: {},
      esc: String,
    });
    const root = document.createElement('div');
    root.innerHTML = controller.renderSystemCard({
      star: {
        name: 'Safe system',
        galaxy_index: 1,
        system_index: 2,
        colony_count: Infinity,
        planets: [{ deposit_metal: Infinity }],
      },
      isOwn: false,
      surveys: [],
    });

    expect(root.querySelector('span[title^="Metall:"]')?.textContent).toContain('0');
    expect(root.textContent).not.toContain('Infinity');
    expect(root.textContent).toContain('0');
    expect(root.textContent).toContain('Unbewohnt');
  });
});
