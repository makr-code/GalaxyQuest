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

  it('omits upgrade progress when timestamps are missing or invalid', () => {
    const { createBuildingsController } = window.GQRuntimeBuildingsController;
    const controller = createBuildingsController({
      getBuildingUiMeta: () => ({ cat: 'Other', icon: '', desc: 'Building' }),
      fmtName: (value) => String(value),
      fmt: String,
      esc: String,
      countdown: () => 'time remaining',
    });
    const html = controller.buildCardsHtml({
      Other: [{
        type: 'habitat',
        level: 1,
        meta: { cat: 'Other', icon: '', desc: 'Building' },
        next_cost: {},
        upgrade_start: 'not-a-date',
        upgrade_end: 'also-not-a-date',
      }],
    }, '');

    expect(html).toContain('item-timer');
    expect(html).not.toContain('Upgrade progress');
    expect(html).not.toContain('>0%</span>');
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

  function renderColony(colony, { fmt, fmtName, populateSelect = false } = {}) {
    const root = document.createElement('div');
    const planetSelect = populateSelect ? document.createElement('select') : null;
    root.planetSelect = planetSelect;
    const { createOverviewController } = window.GQRuntimeOverviewController;
    const controller = createOverviewController({
      wm: { body: () => root },
      api: {},
      windowRef: { _GQ_meta: {}, _GQ_offline: null },
      documentRef: document,
      getColonies: () => [colony],
      setColonies: () => {},
      getCurrentColony: () => null,
      getPlanetSelect: () => planetSelect,
      getUiState: () => ({}),
      fmt: fmt || ((value) => String(value ?? 0)),
      fmtName: fmtName || ((value) => String(value ?? '')),
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

    if (populateSelect) controller.populatePlanetSelect();
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

  it('escapes colony API values and constrains inline percentage styles', () => {
    const root = renderColony({
      id: '1"><img src=x onerror=alert(1)>',
      name: '<img src=x onerror=alert(2)>',
      galaxy: '1"><svg onload=alert(3)>',
      system: 2,
      position: 3,
      planet_type: '<iframe src=javascript:alert(4)>',
      leaders: [{
        role: 'colony_manager',
        level: '1"><img src=x onerror=alert(5)>',
        last_action: '<svg onload=alert(6)>',
        name: '<img src=x onerror=alert(7)>',
      }],
      metal: 10,
      crystal: 10,
      deuterium: 10,
      energy: 5000,
      food: 10,
      happiness: '70%;background:url(javascript:alert(8))',
      public_services: '80%;background:url(javascript:alert(9))',
      population: 0,
      max_population: 500,
    }, {
      fmt: (value) => `<b onclick=alert(10)>${value}</b>`,
      fmtName: () => '<svg onload=alert(11)>',
      populateSelect: true,
    });

    expect(root.querySelector('img, svg, iframe, b')).toBeNull();
    expect(root.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(root.querySelector('.planet-card-name')?.textContent).toContain('<img src=x onerror=alert(2)>');
    expect(root.querySelector('.planet-card-coords')?.textContent).toContain('<svg onload=alert(3)>');
    expect(root.querySelector('.planet-card-type')?.textContent).toContain('<svg onload=alert(11)>');
    expect(Array.from(root.querySelectorAll('.bar-happiness, .bar-services'))
      .map((bar) => bar.style.width)).toEqual(['70%', '70%', '0%']);
    expect(root.planetSelect.options[0]?.value).toBe('1"><img src=x onerror=alert(1)>');
    expect(root.planetSelect.options[0]?.textContent)
      .toContain('<img src=x onerror=alert(2)> [1"><svg onload=alert(3)>:2:3]');
    expect(root.querySelector('.planet-card')?.getAttribute('data-cid'))
      .toBe('1"><img src=x onerror=alert(1)>');
  });
});
