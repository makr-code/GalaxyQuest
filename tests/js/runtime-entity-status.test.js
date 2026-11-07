import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const runtimePath = path.resolve(process.cwd(), 'js/engine/runtime');

function loadModule(name, globalName) {
  delete window[globalName];
  window.eval(fs.readFileSync(path.join(runtimePath, `${name}.js`), 'utf8'));
  return window[globalName];
}

describe('RuntimeBuildingsController status bars', () => {
  beforeEach(() => {
    loadModule('RuntimeBuildingsController', 'GQRuntimeBuildingsController');
  });

  it('omits health and shield bars when no status values are provided', () => {
    const { createBuildingsController } = window.GQRuntimeBuildingsController;
    const controller = createBuildingsController({
      getBuildingUiMeta: () => ({ cat: 'Other', icon: '', desc: 'Building' }),
      fmtName: (value) => String(value),
      fmt: String,
      esc: String,
    });
    const html = controller.buildCardsHtml({
      Other: [{
        type: 'habitat',
        level: 1,
        meta: { cat: 'Other', icon: '', desc: 'Building' },
        next_cost: {},
      }],
    }, '');

    expect(html).not.toContain('Building status bars');
    expect(html).not.toContain('Building integrity');
    expect(html).not.toContain('Building shields');
  });
});

describe('RuntimeColonyWarnings status alerts', () => {
  beforeEach(() => {
    loadModule('RuntimeColonyWarnings', 'GQRuntimeColonyWarnings');
  });

  it('does not report missing health or shield values as healthy or depleted status', () => {
    const { createColonyWarnings } = window.GQRuntimeColonyWarnings;
    const warnings = createColonyWarnings().detectColonyWarnings({
      energy: 5000,
      happiness: 70,
      population: 0,
      food: 1000,
      integrity_pct: null,
      shield_pct: null,
    }, null);

    expect(warnings.some(({ title }) => ['STRUCTURAL DAMAGE', 'Colony Damaged', 'Shields Weakening'].includes(title))).toBe(false);
  });

  it('continues to alert on explicitly reported low health and shields', () => {
    const { createColonyWarnings } = window.GQRuntimeColonyWarnings;
    const warnings = createColonyWarnings().detectColonyWarnings({
      energy: 5000,
      happiness: 70,
      population: 0,
      food: 1000,
      integrity_pct: 25,
      shield_pct: 15,
    }, null);

    expect(warnings.map(({ title }) => title)).toContain('STRUCTURAL DAMAGE');
    expect(warnings.map(({ title }) => title)).toContain('Shields Weakening');
  });
});

describe('RuntimeOverviewController colony status bars', () => {
  beforeEach(() => {
    loadModule('RuntimeOverviewController', 'GQRuntimeOverviewController');
  });

  function renderColony(colony) {
    const root = document.createElement('div');
    const { createOverviewController } = window.GQRuntimeOverviewController;
    const controller = createOverviewController({
      wm: { body: () => root },
      api: {},
      windowRef: { _GQ_meta: {}, _GQ_offline: null },
      documentRef: document,
      getColonies: () => [colony],
      setColonies: () => {},
      getCurrentColony: () => null,
      getPlanetSelect: () => null,
      getUiState: () => ({}),
      fmt: (value) => String(value ?? 0),
      fmtName: (value) => String(value ?? ''),
      esc: (value) => String(value ?? ''),
      showToast: () => {},
      shouldRedirectOnAuthLoadError: () => false,
      redirectToLogin: () => {},
      getGalaxy3d: () => null,
      uiKitEmptyStateHTML: () => '',
      focusColonyDevelopment: () => {},
      selectColonyById: () => {},
      buildWarningsHtml: () => '',
      buildOfflineSummaryHtml: () => '',
      buildResourceInsightHtml: () => '',
      evaluateRiskUpgradeBudget: () => ({ ok: true, details: [] }),
      riskFocusFromFlags: () => '',
      signed: String,
      riskLabel: String,
      renderInlineTemplate: () => '',
      renderInlineTemplateList: () => '',
      renderFleetListFn: () => {},
      renderBattleLogFn: () => {},
      bindOverviewActionsFn: () => {},
    });

    controller.render();
    return root;
  }

  it('omits colony health and shield bars when no measurements are supplied', () => {
    const root = renderColony({
      id: 1,
      name: 'Gaia',
      galaxy: 1,
      system: 1,
      position: 1,
      metal: 0,
      crystal: 0,
      deuterium: 0,
      energy: 5000,
      food: 1000,
      happiness: 70,
      public_services: 70,
      population: 0,
      max_population: 500,
      integrity_pct: null,
      shield_pct: null,
    });

    expect(root.querySelector('[aria-label="Colony status bars"]')).toBeNull();
  });

  it('renders only the colony status measurements supplied by the server', () => {
    const root = renderColony({
      id: 2,
      name: 'Ares',
      galaxy: 1,
      system: 2,
      position: 1,
      metal: 0,
      crystal: 0,
      deuterium: 0,
      energy: 5000,
      food: 1000,
      happiness: 70,
      public_services: 70,
      population: 0,
      max_population: 500,
      integrity_pct: 47,
      shield_pct: null,
    });

    expect(root.querySelector('[aria-label="Colony status bars"]')?.textContent).toContain('47%');
    expect(root.querySelector('[aria-label="Colony status bars"]')?.textContent).not.toContain('Shield');
  });
});
