/**
 * runtime-economy-controller.test.js
 *
 * Unit tests for RuntimeEconomyController — Population tab (Sprint 2.2).
 *
 * Covers:
 *   • Population tab renders via _buildFullHtml (tab button visible)
 *   • _renderPopulationTab: colony cards show satisfaction, production_mult, migration
 *   • _satClass colour mapping
 *   • _loadPopulationTab calls api.economyPopStatus
 *   • Pop-policy save button calls api.setPopPolicy with correct params
 *   • refresh() resets popStatus so it re-fetches
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs   from 'node:fs';
import path from 'node:path';

const controllerPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeEconomyController.js');

function loadController() {
  delete window.GQRuntimeEconomyController;
  const src = fs.readFileSync(controllerPath, 'utf8');
  // Execute in the window context
  // eslint-disable-next-line no-eval
  window.eval(src);
  return window.GQRuntimeEconomyController;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApi(overrides = {}) {
  return {
    economyPolicy:         vi.fn(async () => ({ success: true, global_policy: 'free_market', taxes: { income: 0, production: 0, trade: 0 }, subsidies: { agriculture: false, research: false, military: false } })),
    economyOverview:       vi.fn(async () => ({ success: true, colonies: [], war_modifiers: null, pirate_damage_mult: 1 })),
    economyPopClasses:     vi.fn(async () => ({ success: true, pop_classes: {} })),
    economyPopStatus:      vi.fn(async () => ({ success: true, colonies: [] })),
    setEconomyPolicy:      vi.fn(async () => ({ success: true })),
    setEconomyTax:         vi.fn(async () => ({ success: true, rate: 0 })),
    setEconomySubsidy:     vi.fn(async () => ({ success: true })),
    setEconomyProductionMethod: vi.fn(async () => ({ success: true })),
    setPopPolicy:          vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

function makeWm(bodyEl) {
  return { body: vi.fn(() => bodyEl) };
}

// ---------------------------------------------------------------------------
// Helpers: extract internal functions by rendering HTML
// ---------------------------------------------------------------------------

describe('RuntimeEconomyController — Population tab button', () => {
  it('renders a Population tab button in the tab bar', () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const ctrl = createEconomyController({
      wm: makeWm(root),
      api: makeApi(),
      esc: (v) => String(v ?? ''),
    });

    // Trigger a render — it will paint the skeleton while loading
    ctrl.render();

    const tabBtns = [...root.querySelectorAll('[data-economy-tab]')].map((b) => b.dataset.economyTab);
    expect(tabBtns).toContain('population');
  });

  it('renders three tabs: policy, overview, population', () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    createEconomyController({ wm: makeWm(root), api: makeApi(), esc: (v) => String(v ?? '') }).render();

    const tabs = [...root.querySelectorAll('[data-economy-tab]')].map((b) => b.dataset.economyTab);
    expect(tabs).toEqual(['policy', 'overview', 'population']);
  });
});

describe('RuntimeEconomyController — _renderPopulationTab via render()', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('calls api.economyPopStatus when population tab is active', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const api  = makeApi();
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    // Switch to population tab
    const state = ctrl; // access internal state via render
    // Simulate clicking the population tab
    await ctrl.render();
    const popTabBtn = root.querySelector('[data-economy-tab="population"]');
    expect(popTabBtn).not.toBeNull();

    // Click it
    popTabBtn.click();
    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(api.economyPopStatus).toHaveBeenCalled();
  });

  it('shows "no population data" message when colonies list is empty', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const api  = makeApi({ economyPopStatus: vi.fn(async () => ({ success: true, colonies: [] })) });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    expect(root.innerHTML).toMatch(/no population data/i);
  });

  it('renders satisfaction badge and production multiplier for each colony', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const api  = makeApi({
      economyPopStatus: vi.fn(async () => ({
        success: true,
        colonies: [
          { colony_id: 1, name: 'Alpha Prime', avg_satisfaction: 75, avg_employment: 85, avg_migration: 0.2, total_population: 500 },
          { colony_id: 2, name: 'Beta Station', avg_satisfaction: 30, avg_employment: 60, avg_migration: 2.5, total_population: 200 },
        ],
      })),
    });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    const html = root.innerHTML;

    // Colony names
    expect(html).toContain('Alpha Prime');
    expect(html).toContain('Beta Station');

    // Satisfaction values
    expect(html).toContain('75%');
    expect(html).toContain('30%');

    // Production multiplier: 0.5 + sat/100
    // Alpha Prime: 0.5 + 0.75 = 1.250
    expect(html).toContain('1.250');
    // Beta Station: 0.5 + 0.30 = 0.800
    expect(html).toContain('0.800');
  });

  it('marks high migration colonies with text-red', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const api  = makeApi({
      economyPopStatus: vi.fn(async () => ({
        success: true,
        colonies: [
          { colony_id: 3, name: 'Exodus World', avg_satisfaction: 20, avg_employment: 50, avg_migration: 3.5, total_population: 100 },
        ],
      })),
    });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    // Migration > 1 → text-red on that span
    const migSpan = root.querySelector('.text-red');
    expect(migSpan).not.toBeNull();
    expect(migSpan.textContent).toMatch(/3\.50/);
  });
});

describe('RuntimeEconomyController — satisfaction colour class', () => {
  // We test _satClass indirectly by checking badge classes in rendered HTML
  it('renders is-good badge for satisfaction >= 80', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const api  = makeApi({
      economyPopStatus: vi.fn(async () => ({
        success: true,
        colonies: [{ colony_id: 1, name: 'HappyWorld', avg_satisfaction: 85, avg_employment: 95, avg_migration: -0.5, total_population: 300 }],
      })),
    });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    const badge = root.querySelector('.badge.is-good');
    expect(badge).not.toBeNull();
  });

  it('renders is-critical badge for satisfaction < 40', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const api  = makeApi({
      economyPopStatus: vi.fn(async () => ({
        success: true,
        colonies: [{ colony_id: 2, name: 'UnhappyWorld', avg_satisfaction: 25, avg_employment: 40, avg_migration: 4.0, total_population: 80 }],
      })),
    });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    const badge = root.querySelector('.badge.is-critical');
    expect(badge).not.toBeNull();
  });
});

describe('RuntimeEconomyController — pop policy controls', () => {
  it('renders wage/culture/safety sliders for each colony', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const api  = makeApi({
      economyPopStatus: vi.fn(async () => ({
        success: true,
        colonies: [{ colony_id: 42, name: 'Test Colony', avg_satisfaction: 55, avg_employment: 75, avg_migration: 0.0, total_population: 150 }],
      })),
    });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    expect(root.querySelector('.pop-wage-slider[data-colony="42"]')).not.toBeNull();
    expect(root.querySelector('.pop-culture-slider[data-colony="42"]')).not.toBeNull();
    expect(root.querySelector('.pop-safety-slider[data-colony="42"]')).not.toBeNull();
  });

  it('clicking Apply Policy calls api.setPopPolicy with colony_id', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const setPopPolicyMock = vi.fn(async () => ({ success: true }));
    const api = makeApi({
      economyPopStatus: vi.fn(async () => ({
        success: true,
        colonies: [{ colony_id: 7, name: 'Policy Colony', avg_satisfaction: 60, avg_employment: 80, avg_migration: 0.5, total_population: 200 }],
      })),
      setPopPolicy: setPopPolicyMock,
    });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    // Set wage slider to 150 (= 1.50x)
    const wageSlider = root.querySelector('.pop-wage-slider[data-colony="7"]');
    wageSlider.value = '150';

    const saveBtn = root.querySelector('.pop-policy-save[data-colony="7"]');
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(setPopPolicyMock).toHaveBeenCalledOnce();
    const args = setPopPolicyMock.mock.calls[0][0];
    expect(args.colony_id).toBe(7);
    expect(args.wage_adjustment).toBeCloseTo(1.5, 2);
  });
});

describe('RuntimeEconomyController — refresh resets popStatus', () => {
  it('clears popStatus on refresh so population tab re-fetches', async () => {
    const { createEconomyController } = loadController();
    const root = document.createElement('div');
    const popStatusMock = vi.fn(async () => ({ success: true, colonies: [] }));
    const api = makeApi({ economyPopStatus: popStatusMock });
    const ctrl = createEconomyController({ wm: makeWm(root), api, esc: (v) => String(v ?? '') });

    // Load population tab
    await ctrl.render();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));
    const firstCallCount = popStatusMock.mock.calls.length;

    // Refresh should clear cache and re-fetch on next render
    await ctrl.refresh();
    root.querySelector('[data-economy-tab="population"]').click();
    await new Promise((r) => setTimeout(r, 20));

    expect(popStatusMock.mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});

describe('API — economyPopStatus and setPopPolicy methods exist', () => {
  it('economyPopStatus is exposed on window.API', () => {
    const apiPath = path.resolve(process.cwd(), 'js/network/api.js');
    delete window.API;
    const src = fs.readFileSync(apiPath, 'utf8');
    window.eval(src);
    expect(typeof window.API.economyPopStatus).toBe('function');
  });

  it('setPopPolicy is exposed on window.API', () => {
    expect(typeof window.API.setPopPolicy).toBe('function');
  });
});
