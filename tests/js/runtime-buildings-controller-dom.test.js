import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const runtimePath = path.resolve(process.cwd(), 'js/engine/runtime');

function loadModule(name, globalName) {
  delete window[globalName];
  window.eval(fs.readFileSync(path.join(runtimePath, `${name}.js`), 'utf8'));
  return window[globalName];
}

describe('RuntimeBuildingsController DOM output', () => {
  beforeEach(() => {
    loadModule('RuntimeBuildingsController', 'GQRuntimeBuildingsController');
  });

  it('escapes API and formatter values and omits invalid building actions', () => {
    const { createBuildingsController } = window.GQRuntimeBuildingsController;
    const controller = createBuildingsController({
      getBuildingUiMeta: () => ({ cat: 'Other', icon: '<svg onload=alert(1)>', desc: '<img src=x onerror=alert(2)>' }),
      fmtName: (value) => `<img src=x onerror=alert(3)>${value}`,
      fmt: () => '<img src=x onerror=alert(4)>',
      countdown: () => '<img src=x onerror=alert(5)>',
      esc: String,
    });
    const byCategory = controller.groupByCategory([{
      type: 'bad" onclick="alert(6)',
      level: 1,
      next_cost: { metal: 10 },
      upgrade_end: '2026-01-01',
    }]);
    const html = controller.buildCardsHtml(byCategory, '<img src=x onerror=alert(7)>');
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('img, svg')).toBeNull();
    expect(root.querySelector('[onclick], [onerror], [onload]')).toBeNull();
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(5)&gt;');
    expect(html).not.toContain('upgrade-btn');
  });

  it('escapes building queue formatter output', () => {
    const { createBuildingsController } = window.GQRuntimeBuildingsController;
    const controller = createBuildingsController({
      fmtName: () => '<img src=x onerror=alert(1)>',
      countdown: () => '<img src=x onerror=alert(2)>',
      esc: String,
    });
    const html = controller.buildQueueHtml([{
      status: 'running',
      type: 'habitat',
      eta: '<svg onload=alert(3)>',
    }]);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;svg onload=alert(3)&gt;');
  });
});

describe('RuntimeBuildingUpgradePreview DOM output', () => {
  beforeEach(() => {
    loadModule('RuntimeBuildingUpgradePreview', 'GQRuntimeBuildingUpgradePreview');
  });

  it('escapes dynamic preview values regardless of injected formatters', () => {
    const { createBuildingUpgradePreview } = window.GQRuntimeBuildingUpgradePreview;
    const preview = createBuildingUpgradePreview({
      fmt: () => '<img src=x onerror=alert(1)>',
      fmtName: () => '<svg onload=alert(2)>',
      esc: String,
      getCurrentColony: () => ({ metal: 0, crystal: 0, deuterium: 0 }),
    });
    const html = preview.buildUpgradePreviewModal(
      { type: 'habitat', production_rate: 1 },
      {
        currentLevel: '<img src=x onerror=alert(3)>',
        nextLevel: '<img src=x onerror=alert(4)>',
        cost: { metal: 10, crystal: 0, deuterium: 0 },
        description: '<img src=x onerror=alert(5)>',
        estimatedTimeToBuild: '<svg onload=alert(6)>',
      },
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;img src=x onerror=alert(3)&gt;');
    expect(html).toContain('&lt;svg onload=alert(6)&gt;');
  });
});
