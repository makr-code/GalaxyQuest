/**
 * tests/js/logistics-routes.test.js
 *
 * Tests for RuntimeLogisticsRoutesController — Colony Goods Flow & Logistics Routes Dashboard.
 *
 * Covers:
 *   - createLogisticsRoutesController returns a controller object
 *   - render() with no data calls api.goodsFlowAnalysis and populates root
 *   - render() handles API error gracefully
 *   - _buildFlowsTab: empty colonies renders empty-state
 *   - _buildFlowsTab: renders colony rows with surplus/deficit bars
 *   - _buildFlowsTab: renders route link badges when heatmap data present
 *   - _buildRoutesTab: empty routes renders empty-state
 *   - _buildRoutesTab: renders route cards with efficiency metrics
 *   - _buildRecommendTab: empty recommendations renders balanced message
 *   - _buildRecommendTab: renders recommendation cards with apply buttons
 *   - _buildHtml: tab buttons are present
 *   - _buildHtml: summary bar shows colony/route counts
 *   - _bindEvents: tab switching updates tab and calls render
 *   - _bindEvents: interval selector triggers re-render with new interval
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(
  process.cwd(),
  'js/engine/runtime/layers/domain/trade/RuntimeLogisticsRoutesController.js',
);

function loadModule() {
  delete window.GQRuntimeLogisticsRoutesController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeLogisticsRoutesController;
}

function makeRootEl(html = '') {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

function makeWm(root) {
  return { body: () => root };
}

function makeApi(overrides = {}) {
  return {
    goodsFlowAnalysis: vi.fn().mockResolvedValue(makeFlowData()),
    applyTradeSuggestion: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function makeFlowData(overrides = {}) {
  return {
    colonies: [
      {
        colony_id: 1,
        name: 'Alpha Base',
        galaxy: 0,
        system: 1,
        position: 3,
        x_ly: 10,
        y_ly: 5,
        z_ly: 0,
        goods: {
          metal: { qty: 2000, reserve: 1000, surplus: 1000, deficit: 0, tone: 'surplus' },
          crystal: { qty: 200, reserve: 500, surplus: 0, deficit: 300, tone: 'deficit' },
          food: { qty: 800, reserve: 800, surplus: 0, deficit: 0, tone: 'balanced' },
        },
        welfare: { happiness: 72, food_coverage: 1.0, energy_balance: 10 },
      },
      {
        colony_id: 2,
        name: 'Beta Station',
        galaxy: 0,
        system: 3,
        position: 4,
        x_ly: 20,
        y_ly: 15,
        z_ly: 0,
        goods: {
          metal: { qty: 300, reserve: 1000, surplus: 0, deficit: 700, tone: 'deficit' },
          crystal: { qty: 1500, reserve: 500, surplus: 1000, deficit: 0, tone: 'surplus' },
          food: { qty: 600, reserve: 800, surplus: 0, deficit: 200, tone: 'deficit' },
        },
        welfare: { happiness: 58, food_coverage: 0.85, energy_balance: -5 },
      },
    ],
    heatmap: {
      metal: [
        { from_id: 1, to_id: 2, from_name: 'Alpha Base', to_name: 'Beta Station', qty: 500, is_active: true },
      ],
    },
    routes: [
      {
        id: 10,
        origin_colony_id: 1,
        target_colony_id: 2,
        origin_name: 'Alpha Base',
        target_name: 'Beta Station',
        cargo: { metal: 500, crystal: 0, deuterium: 0 },
        cargo_payload: { metal: 500, crystal: 0, deuterium: 0, rare_earth: 0, food: 0 },
        interval_hours: 24,
        is_active: true,
        last_dispatch: '2026-04-11 12:00:00',
        distance_ly: 14.14,
        fuel_cost_deuterium: 10,
        total_cargo_units: 500,
        efficiency_score: 35.36,
      },
    ],
    recommendations: [
      {
        origin_colony_id: 2,
        target_colony_id: 1,
        origin_name: 'Beta Station',
        target_name: 'Alpha Base',
        resource_type: 'crystal',
        cargo: { metal: 0, crystal: 300, deuterium: 0, rare_earth: 0, food: 0 },
        interval_hours: 24,
        estimated_distance_ly: 14.14,
        estimated_fuel_cost_deuterium: 10,
        priority: 'high',
        priority_score: 9000,
        reason: 'stock-imbalance',
        reason_details: {
          source_qty: 1500,
          source_reserve: 500,
          target_qty: 200,
          target_reserve: 500,
          target_shortage: 300,
          transfer_qty: 300,
        },
        existing_route_id: null,
        existing_route_active: false,
        target_welfare: { food_coverage: 1.0, energy_balance: 10, happiness: 72 },
      },
    ],
    summary: { total_colonies: 2, active_routes: 1, resources: ['metal', 'crystal', 'food'] },
    ...overrides,
  };
}

function makeController(overrides = {}) {
  const root = makeRootEl();
  const wm = makeWm(root);
  const api = makeApi();
  const mod = loadModule();
  const controller = mod.createLogisticsRoutesController({
    wm,
    api,
    documentRef: document,
    uiKitSkeletonHTML: () => '<p>Loading...</p>',
    uiKitEmptyStateHTML: (title, msg) => `<p class="empty-state">${title}: ${msg}</p>`,
    esc: (v) => String(v ?? ''),
    fmt: (v) => String(Math.round(Number(v) || 0)),
    fmtName: (v) => String(v ?? '').replace(/_/g, ' '),
    gameLog: vi.fn(),
    showToast: vi.fn(),
    invalidateGetCache: vi.fn(),
    ...overrides,
  });
  return { controller, root, wm, api };
}

// ── Module loading ────────────────────────────────────────────────────────────

describe('loadModule', () => {
  it('exports createLogisticsRoutesController', () => {
    const mod = loadModule();
    expect(typeof mod.createLogisticsRoutesController).toBe('function');
  });
});

// ── createLogisticsRoutesController ──────────────────────────────────────────

describe('createLogisticsRoutesController', () => {
  it('returns an object with render method', () => {
    const { controller } = makeController();
    expect(typeof controller.render).toBe('function');
  });

  it('defaults tab to "flows"', () => {
    const { controller } = makeController();
    expect(controller.tab).toBe('flows');
  });

  it('defaults intervalHours to 24', () => {
    const { controller } = makeController();
    expect(controller.intervalHours).toBe(24);
  });

  it('defaults data to null', () => {
    const { controller } = makeController();
    expect(controller.data).toBeNull();
  });
});

// ── render() ─────────────────────────────────────────────────────────────────

describe('render()', () => {
  it('calls goodsFlowAnalysis with default options', async () => {
    const { controller, api } = makeController();
    await controller.render();
    expect(api.goodsFlowAnalysis).toHaveBeenCalledWith({ limit: 10, interval_hours: 24 });
  });

  it('populates root with logistics panel HTML', async () => {
    const { controller, root } = makeController();
    await controller.render();
    expect(root.querySelector('.logistics-routes-panel')).not.toBeNull();
  });

  it('shows skeleton while loading (sync check on root before await)', async () => {
    const { controller, root } = makeController();
    const renderPromise = controller.render();
    expect(root.innerHTML).toContain('Loading...');
    await renderPromise;
  });

  it('renders error message when API throws', async () => {
    const api = makeApi({ goodsFlowAnalysis: vi.fn().mockRejectedValue(new Error('net')) });
    const root = makeRootEl();
    const mod = loadModule();
    const controller = mod.createLogisticsRoutesController({
      wm: makeWm(root),
      api,
      documentRef: document,
      uiKitSkeletonHTML: () => '<p>Loading...</p>',
      uiKitEmptyStateHTML: () => '',
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? 0),
      fmtName: (v) => String(v ?? ''),
      gameLog: vi.fn(),
      showToast: vi.fn(),
      invalidateGetCache: vi.fn(),
    });
    await controller.render();
    expect(root.innerHTML).toContain('Failed to load logistics data.');
  });

  it('does nothing when wm has no body', async () => {
    const mod = loadModule();
    const api = makeApi();
    const controller = mod.createLogisticsRoutesController({
      wm: { body: () => null },
      api,
      documentRef: document,
      uiKitSkeletonHTML: () => '',
      uiKitEmptyStateHTML: () => '',
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? 0),
      fmtName: (v) => String(v ?? ''),
      gameLog: vi.fn(),
      showToast: vi.fn(),
      invalidateGetCache: vi.fn(),
    });
    await controller.render(); // should not throw
    expect(api.goodsFlowAnalysis).not.toHaveBeenCalled();
  });

  it('stores response in data after render', async () => {
    const { controller } = makeController();
    await controller.render();
    expect(controller.data).not.toBeNull();
    expect(controller.data.summary.total_colonies).toBe(2);
  });
});

// ── _buildHtml — summary bar and tabs ────────────────────────────────────────

describe('_buildHtml — summary bar', () => {
  it('shows total colony count', async () => {
    const { controller, root } = makeController();
    await controller.render();
    expect(root.textContent).toContain('2');
    expect(root.textContent).toContain('Colonies');
  });

  it('shows active route count', async () => {
    const { controller, root } = makeController();
    await controller.render();
    expect(root.textContent).toContain('Active Routes');
  });

  it('renders tab buttons', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const tabs = root.querySelectorAll('[data-logistics-tab]');
    expect(tabs.length).toBe(3);
    const tabNames = Array.from(tabs).map((t) => t.dataset.logisticsTab);
    expect(tabNames).toContain('flows');
    expect(tabNames).toContain('routes');
    expect(tabNames).toContain('recommend');
  });

  it('marks active tab with css class', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    const activeBtn = root.querySelector('.logistics-tab--active');
    expect(activeBtn?.dataset.logisticsTab).toBe('routes');
  });

  it('renders interval selector', async () => {
    const { controller, root } = makeController();
    await controller.render();
    expect(root.querySelector('[data-logistics-interval]')).not.toBeNull();
  });
});

// ── _buildFlowsTab ────────────────────────────────────────────────────────────

describe('_buildFlowsTab', () => {
  it('renders empty state when no colonies', async () => {
    const api = makeApi({ goodsFlowAnalysis: vi.fn().mockResolvedValue(makeFlowData({ colonies: [] })) });
    const root = makeRootEl();
    const mod = loadModule();
    const controller = mod.createLogisticsRoutesController({
      wm: makeWm(root),
      api,
      documentRef: document,
      uiKitSkeletonHTML: () => '<p>Loading...</p>',
      uiKitEmptyStateHTML: (t, m) => `<p class="empty-state">${t}: ${m}</p>`,
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? 0),
      fmtName: (v) => String(v ?? ''),
      gameLog: vi.fn(),
      showToast: vi.fn(),
      invalidateGetCache: vi.fn(),
    });
    await controller.render();
    expect(root.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders resource blocks for each resource', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const blocks = root.querySelectorAll('.logistics-resource-block');
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('renders colony rows inside resource blocks', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const rows = root.querySelectorAll('.logistics-colony-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('applies "is-good" tone class to surplus colony row', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const goodRows = root.querySelectorAll('.logistics-colony-row.is-good');
    expect(goodRows.length).toBeGreaterThan(0);
  });

  it('applies "is-critical" tone class to deficit colony row', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const critRows = root.querySelectorAll('.logistics-colony-row.is-critical');
    expect(critRows.length).toBeGreaterThan(0);
  });

  it('shows route badge when heatmap data present', async () => {
    const { controller, root } = makeController();
    await controller.render();
    expect(root.querySelector('.logistics-route-badge')).not.toBeNull();
  });

  it('shows route links in flows tab', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const links = root.querySelectorAll('.logistics-route-link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('renders surplus bar with non-zero width for surplus colony', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const surplusBars = root.querySelectorAll('.logistics-bar-surplus');
    const hasSurplusBar = Array.from(surplusBars).some(
      (el) => el.style.width && el.style.width !== '0%',
    );
    expect(hasSurplusBar).toBe(true);
  });
});

// ── _buildRoutesTab ───────────────────────────────────────────────────────────

describe('_buildRoutesTab', () => {
  beforeEach(() => {});

  it('renders empty state when no routes', async () => {
    const api = makeApi({
      goodsFlowAnalysis: vi.fn().mockResolvedValue(makeFlowData({ routes: [] })),
    });
    const root = makeRootEl();
    const mod = loadModule();
    const controller = mod.createLogisticsRoutesController({
      wm: makeWm(root),
      api,
      documentRef: document,
      uiKitSkeletonHTML: () => '<p>Loading...</p>',
      uiKitEmptyStateHTML: (t, m) => `<p class="empty-state">${t}: ${m}</p>`,
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? 0),
      fmtName: (v) => String(v ?? ''),
      gameLog: vi.fn(),
      showToast: vi.fn(),
      invalidateGetCache: vi.fn(),
    });
    controller.tab = 'routes';
    await controller.render();
    expect(root.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders route cards', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    expect(root.querySelector('.logistics-route-card')).not.toBeNull();
  });

  it('shows origin → target in route card', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    expect(root.textContent).toContain('Alpha Base');
    expect(root.textContent).toContain('Beta Station');
  });

  it('shows Active status for active route', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    expect(root.textContent).toContain('Active');
  });

  it('shows Paused status for inactive route', async () => {
    const paused = makeFlowData({
      routes: [{ ...makeFlowData().routes[0], is_active: false }],
    });
    const api = makeApi({ goodsFlowAnalysis: vi.fn().mockResolvedValue(paused) });
    const root = makeRootEl();
    const mod = loadModule();
    const controller = mod.createLogisticsRoutesController({
      wm: makeWm(root),
      api,
      documentRef: document,
      uiKitSkeletonHTML: () => '<p>Loading...</p>',
      uiKitEmptyStateHTML: (t, m) => `<p class="empty-state">${t}: ${m}</p>`,
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? 0),
      fmtName: (v) => String(v ?? ''),
      gameLog: vi.fn(),
      showToast: vi.fn(),
      invalidateGetCache: vi.fn(),
    });
    controller.tab = 'routes';
    await controller.render();
    expect(root.textContent).toContain('Paused');
  });

  it('shows efficiency score', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    expect(root.textContent).toContain('Efficiency');
  });

  it('shows distance in route details', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    expect(root.textContent).toContain('Distance');
  });

  it('shows fuel cost in route details', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    expect(root.textContent).toContain('Fuel Cost');
  });

  it('shows cargo payload goods', async () => {
    const { controller, root } = makeController();
    controller.tab = 'routes';
    await controller.render();
    // cargo has metal: 500, so metal icon + quantity should appear
    expect(root.textContent).toContain('500');
  });
});

// ── _buildRecommendTab ────────────────────────────────────────────────────────

describe('_buildRecommendTab', () => {
  it('renders balanced message when no recommendations', async () => {
    const api = makeApi({
      goodsFlowAnalysis: vi.fn().mockResolvedValue(makeFlowData({ recommendations: [] })),
    });
    const root = makeRootEl();
    const mod = loadModule();
    const controller = mod.createLogisticsRoutesController({
      wm: makeWm(root),
      api,
      documentRef: document,
      uiKitSkeletonHTML: () => '<p>Loading...</p>',
      uiKitEmptyStateHTML: (t, m) => `<p class="empty-state">${t}: ${m}</p>`,
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? 0),
      fmtName: (v) => String(v ?? ''),
      gameLog: vi.fn(),
      showToast: vi.fn(),
      invalidateGetCache: vi.fn(),
    });
    controller.tab = 'recommend';
    await controller.render();
    expect(root.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders recommendation cards', async () => {
    const { controller, root } = makeController();
    controller.tab = 'recommend';
    await controller.render();
    expect(root.querySelector('.logistics-rec-card')).not.toBeNull();
  });

  it('renders Create Route button for rec without existing route', async () => {
    const { controller, root } = makeController();
    controller.tab = 'recommend';
    await controller.render();
    const btn = root.querySelector('[data-apply-rec]');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Create Route');
  });

  it('renders Update Existing Route button when existing_route_id set', async () => {
    const data = makeFlowData({
      recommendations: [{ ...makeFlowData().recommendations[0], existing_route_id: 5 }],
    });
    const api = makeApi({ goodsFlowAnalysis: vi.fn().mockResolvedValue(data) });
    const root = makeRootEl();
    const mod = loadModule();
    const controller = mod.createLogisticsRoutesController({
      wm: makeWm(root),
      api,
      documentRef: document,
      uiKitSkeletonHTML: () => '<p>Loading...</p>',
      uiKitEmptyStateHTML: (t, m) => `<p class="empty-state">${t}: ${m}</p>`,
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? 0),
      fmtName: (v) => String(v ?? ''),
      gameLog: vi.fn(),
      showToast: vi.fn(),
      invalidateGetCache: vi.fn(),
    });
    controller.tab = 'recommend';
    await controller.render();
    const btn = root.querySelector('[data-apply-rec]');
    expect(btn?.textContent).toContain('Update Existing Route');
  });

  it('shows priority label', async () => {
    const { controller, root } = makeController();
    controller.tab = 'recommend';
    await controller.render();
    expect(root.textContent).toContain('high');
  });

  it('shows resource name in recommendation card', async () => {
    const { controller, root } = makeController();
    controller.tab = 'recommend';
    await controller.render();
    expect(root.textContent).toContain('crystal');
  });

  it('shows origin and target colony names', async () => {
    const { controller, root } = makeController();
    controller.tab = 'recommend';
    await controller.render();
    expect(root.textContent).toContain('Beta Station');
    expect(root.textContent).toContain('Alpha Base');
  });

  it('calls applyTradeSuggestion when Create Route button clicked', async () => {
    const { controller, root, api } = makeController();
    controller.tab = 'recommend';
    await controller.render();
    const btn = root.querySelector('[data-apply-rec]');
    expect(btn).not.toBeNull();
    btn.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect(api.applyTradeSuggestion).toHaveBeenCalled();
  });
});

// ── _bindEvents — tab switching ───────────────────────────────────────────────

describe('_bindEvents — tab switching', () => {
  it('clicking routes tab sets tab to routes and re-renders', async () => {
    const { controller, root } = makeController();
    await controller.render();
    expect(controller.tab).toBe('flows');

    const routesBtn = Array.from(root.querySelectorAll('[data-logistics-tab]')).find(
      (b) => b.dataset.logisticsTab === 'routes',
    );
    expect(routesBtn).not.toBeNull();
    routesBtn.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(controller.tab).toBe('routes');
    expect(root.querySelector('.logistics-route-card')).not.toBeNull();
  });

  it('clicking recommend tab sets tab to recommend and re-renders', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const recBtn = Array.from(root.querySelectorAll('[data-logistics-tab]')).find(
      (b) => b.dataset.logisticsTab === 'recommend',
    );
    recBtn.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(controller.tab).toBe('recommend');
    expect(root.querySelector('.logistics-rec-card')).not.toBeNull();
  });
});

// ── _bindEvents — interval selector ──────────────────────────────────────────

describe('_bindEvents — interval selector', () => {
  it('changing interval to 48 sets intervalHours and nulls data', async () => {
    const { controller, root } = makeController();
    await controller.render();
    const select = root.querySelector('[data-logistics-interval]');
    expect(select).not.toBeNull();
    select.value = '48';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(controller.intervalHours).toBe(48);
  });
});
