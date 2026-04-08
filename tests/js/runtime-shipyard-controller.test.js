/**
 * runtime-shipyard-controller.test.js
 *
 * Unit tests for RuntimeShipyardController:
 *  - Tabbed layout (Design / Blueprints / Flotte / Bauschacht / Rümpfe / Klassisch)
 *  - Visual hull picker card rendering and selection
 *  - Doctrine selector rendering
 *  - Blueprint delete button
 *  - Build queue badge count
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadController() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'js/engine/runtime/RuntimeShipyardController.js'),
    'utf8',
  );
  window.eval(src);
}

// ── Minimal GQUI stub ─────────────────────────────────────────────────────────
function makeGQUI(doc) {
  class El {
    constructor(tag = 'div') {
      this.dom = doc.createElement(tag);
    }
    setClass(cls) { this.dom.className = cls; return this; }
    setTextContent(t) { this.dom.textContent = t; return this; }
    add(...children) {
      children.forEach((c) => this.dom.appendChild(c?.dom ?? c));
      return this;
    }
  }
  class Div extends El { constructor() { super('div'); } }
  class Span extends El { constructor() { super('span'); } }
  class Button extends El {
    constructor(text = '') {
      super('button');
      this.dom.textContent = text;
    }
  }
  return { Div, Span, Button };
}

// ── Factory ──────────────────────────────────────────────────────────────────
function makeController(overrides = {}) {
  loadController();
  const { createShipyardController } = window.GQRuntimeShipyardController;

  const doc = window.document;
  const GQUI = makeGQUI(doc);

  const root = doc.createElement('div');
  const wm = { body: vi.fn(() => root) };

  const defaultApi = {
    ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
    shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
    shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
    buildShip: vi.fn().mockResolvedValue({ success: true, queue_position: 1 }),
    createBlueprint: vi.fn().mockResolvedValue({ success: true }),
    deleteBlueprint: vi.fn().mockResolvedValue({ success: true }),
    decommissionVessel: vi.fn().mockResolvedValue({ success: true }),
    resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
  };

  const controller = createShipyardController({
    wm,
    api: Object.assign({}, defaultApi, overrides.api),
    windowRef: window,
    documentRef: doc,
    getCurrentColony: overrides.getCurrentColony ?? (() => ({ id: 1 })),
    updateResourceBar: vi.fn(),
    fmt: (n) => String(n),
    fmtName: (s) => String(s ?? '').replace(/_/g, ' '),
    esc: (s) => String(s ?? ''),
    countdown: () => '0:00',
    showToast: vi.fn(),
    gameLog: vi.fn(),
    gqStatusMsg: vi.fn(),
    GQUI,
  });

  return { controller, root, wm, doc, defaultApi };
}

const sampleHulls = [
  {
    code: 'corvette_t1',
    label: 'Corvette',
    tier: 1,
    ship_class: 'corvette',
    role: 'combat',
    unlocked: true,
    blockers: [],
    base_stats: { attack: 10, shield: 5, hull: 20, cargo: 50, speed: 1200 },
    slot_profile: { weapon: 2, utility: 1 },
    slot_variations: {},
  },
  {
    code: 'frigate_t2',
    label: 'Frigate',
    tier: 2,
    ship_class: 'frigate',
    role: 'combat',
    unlocked: false,
    blockers: ['Research: Advanced Hull'],
    base_stats: { attack: 25, shield: 15, hull: 50, cargo: 80, speed: 900 },
    slot_profile: { weapon: 3, utility: 2 },
    slot_variations: { aggressive: { label: 'Aggressive', slot_adjustments: { weapon: 1 } } },
  },
];

const sampleBlueprints = [
  {
    id: 7,
    name: 'Aegis',
    type: 'bp_aegis',
    ship_class: 'corvette',
    slot_layout_code: 'default',
    count: 3,
    running_count: 0,
    queued_count: 0,
    cost: { metal: 200, crystal: 100, deuterium: 50 },
    stats: { attack: 15, shield: 8, hull: 25, cargo: 60, speed: 1100 },
    slot_profile: { weapon: 2, utility: 1 },
  },
];

// ── Tab layout ─────────────────────────────────────────────────────────────────

describe('RuntimeShipyardController – tabbed layout', () => {
  beforeEach(() => {
    delete window.GQRuntimeShipyardController;
  });

  it('renders a tab bar with 6 tabs after render()', async () => {
    const { controller, root, defaultApi } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const tabBtns = root.querySelectorAll('.ui-tab-btn');
    expect(tabBtns.length).toBe(6);
  });

  it('first tab (Design) is active by default', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const activeTab = root.querySelector('.ui-tab-btn.is-active');
    expect(activeTab).not.toBeNull();
    expect(activeTab.dataset.tabTarget).toBe('design');
    const activePanel = root.querySelector('.ui-tab-panel.is-active');
    expect(activePanel).not.toBeNull();
    expect(activePanel.dataset.tabId).toBe('design');
  });

  it('clicking a tab activates its panel', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();

    const bpTab = root.querySelector('.ui-tab-btn[data-tab-target="blueprints"]');
    bpTab.click();

    expect(bpTab.classList.contains('is-active')).toBe(true);
    const bpPanel = root.querySelector('.ui-tab-panel[data-tab-id="blueprints"]');
    expect(bpPanel.classList.contains('is-active')).toBe(true);
    // design panel should be deactivated
    const designPanel = root.querySelector('.ui-tab-panel[data-tab-id="design"]');
    expect(designPanel.classList.contains('is-active')).toBe(false);
  });

  it('queue tab label shows count when queue is non-empty', async () => {
    const queue = [
      { id: 1, ship_type: 'corvette', label: 'Corvette', quantity: 1, status: 'running',
        position: 1, duration_secs: 60, eta: null, started_at: null, cost: {} },
    ];
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const queueBtn = root.querySelector('.ui-tab-btn[data-tab-target="queue"]');
    expect(queueBtn.textContent).toContain('1');
  });
});

// ── Hull picker ────────────────────────────────────────────────────────────────

describe('RuntimeShipyardController – hull picker', () => {
  beforeEach(() => {
    delete window.GQRuntimeShipyardController;
  });

  it('renders a hull card for each hull', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const cards = root.querySelectorAll('.shipyard-hull-card');
    expect(cards.length).toBe(2);
  });

  it('selects first unlocked hull even when first array entry is locked', async () => {
    const hulls = [
      { ...sampleHulls[1], unlocked: false },  // locked first
      { ...sampleHulls[0], unlocked: true },   // unlocked second
    ];
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const selected = root.querySelector('.shipyard-hull-card.is-selected');
    expect(selected).not.toBeNull();
    expect(selected.classList.contains('is-locked')).toBe(false);
    expect(selected.dataset.hullCode).toBe('corvette_t1');
  });

  it('first unlocked hull card is pre-selected', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const selected = root.querySelector('.shipyard-hull-card.is-selected');
    expect(selected).not.toBeNull();
    expect(selected.dataset.hullCode).toBe('corvette_t1');
  });

  it('locked hull card gets is-locked class', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const lockedCard = root.querySelector('.shipyard-hull-card[data-hull-code="frigate_t2"]');
    expect(lockedCard.classList.contains('is-locked')).toBe(true);
  });

  it('hull cards carry base stat data attributes', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const card = root.querySelector('.shipyard-hull-card[data-hull-code="corvette_t1"]');
    expect(card.dataset.attack).toBe('10');
    expect(card.dataset.shield).toBe('5');
    expect(card.dataset.hull).toBe('20');
  });

  it('hidden hull input is set to first unlocked hull after render', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const hidden = root.querySelector('#shipyard-blueprint-hull');
    expect(hidden).not.toBeNull();
    expect(hidden.value).toBe('corvette_t1');
  });

  it('clicking an unlocked hull card selects it and updates hidden input', async () => {
    // All hulls unlocked for this test
    const hulls = sampleHulls.map((h) => ({ ...h, unlocked: true }));
    const fetchModuleCatalogFn = vi.fn().mockResolvedValue({
      success: true,
      module_groups: [],
      hull_unlocked: true,
    });
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        shipyardModules: fetchModuleCatalogFn,
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();

    const frigateCard = root.querySelector('.shipyard-hull-card[data-hull-code="frigate_t2"]');
    frigateCard.click();

    await new Promise((r) => setTimeout(r, 20));

    const hidden = root.querySelector('#shipyard-blueprint-hull');
    expect(hidden.value).toBe('frigate_t2');
    expect(frigateCard.classList.contains('is-selected')).toBe(true);
    const corvetteCard = root.querySelector('.shipyard-hull-card[data-hull-code="corvette_t1"]');
    expect(corvetteCard.classList.contains('is-selected')).toBe(false);
  });
});

// ── Doctrine selector ─────────────────────────────────────────────────────────

describe('RuntimeShipyardController – doctrine selector', () => {
  beforeEach(() => {
    delete window.GQRuntimeShipyardController;
  });

  it('renders doctrine buttons', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const doctrineBtns = root.querySelectorAll('#shipyard-doctrine-selector .shipyard-doctrine-btn');
    expect(doctrineBtns.length).toBeGreaterThanOrEqual(4);
  });

  it('custom doctrine is active by default', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const activeBtn = root.querySelector('#shipyard-doctrine-selector .shipyard-doctrine-btn.is-active');
    expect(activeBtn).not.toBeNull();
    expect(activeBtn.dataset.doctrine).toBe('custom');
  });

  it('clicking a doctrine button activates it exclusively', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();

    const assaultBtn = root.querySelector('.shipyard-doctrine-btn[data-doctrine="assault"]');
    assaultBtn.click();

    const activeBtns = root.querySelectorAll('.shipyard-doctrine-btn.is-active');
    expect(activeBtns.length).toBe(1);
    expect(activeBtns[0].dataset.doctrine).toBe('assault');
  });
});

// ── Blueprint delete ──────────────────────────────────────────────────────────

describe('RuntimeShipyardController – blueprint delete', () => {
  beforeEach(() => {
    delete window.GQRuntimeShipyardController;
  });

  it('each blueprint card has a delete button', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({
          success: true, ships: [], blueprints: sampleBlueprints, queue: [],
        }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();

    // Switch to blueprints tab to ensure the blueprint card is rendered
    const bpTab = root.querySelector('.ui-tab-btn[data-tab-target="blueprints"]');
    bpTab.click();

    const deleteBtn = root.querySelector('.blueprint-delete-btn[data-blueprint-id="7"]');
    expect(deleteBtn).not.toBeNull();
  });

  it('delete button carries blueprint name as dataset attribute', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({
          success: true, ships: [], blueprints: sampleBlueprints, queue: [],
        }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();

    // Switch to blueprints tab so card is visible
    const bpTab = root.querySelector('.ui-tab-btn[data-tab-target="blueprints"]');
    bpTab.click();

    const deleteBtn = root.querySelector('.blueprint-delete-btn[data-blueprint-id="7"]');
    expect(deleteBtn.dataset.blueprintName).toBe('Aegis');
  });

  it('clicking delete with confirmation calls api.deleteBlueprint', async () => {
    const deleteBlueprint = vi.fn().mockResolvedValue({ success: true });
    const ships = vi.fn().mockResolvedValue({
      success: true, ships: [], blueprints: sampleBlueprints, queue: [],
    });
    const { controller, root } = makeController({
      api: {
        ships,
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        deleteBlueprint,
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });

    // confirm = true
    window.confirm = vi.fn(() => true);

    await controller.render();

    const deleteBtn = root.querySelector('.blueprint-delete-btn[data-blueprint-id="7"]');
    deleteBtn.click();

    await new Promise((r) => setTimeout(r, 20));

    expect(deleteBlueprint).toHaveBeenCalledWith(7);
  });

  it('clicking delete without confirmation does NOT call api.deleteBlueprint', async () => {
    const deleteBlueprint = vi.fn().mockResolvedValue({ success: true });
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({
          success: true, ships: [], blueprints: sampleBlueprints, queue: [],
        }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        deleteBlueprint,
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });

    window.confirm = vi.fn(() => false);

    await controller.render();

    const deleteBtn = root.querySelector('.blueprint-delete-btn[data-blueprint-id="7"]');
    deleteBtn.click();

    await new Promise((r) => setTimeout(r, 20));

    expect(deleteBlueprint).not.toHaveBeenCalled();
  });
});

// ── Flotte tab ────────────────────────────────────────────────────────────────

describe('RuntimeShipyardController – flotte tab', () => {
  beforeEach(() => {
    delete window.GQRuntimeShipyardController;
  });

  it('shows empty message when no vessels are docked', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const flotteTab = root.querySelector('.ui-tab-btn[data-tab-target="flotte"]');
    flotteTab.click();
    const flottePanel = root.querySelector('.ui-tab-panel[data-tab-id="flotte"]');
    expect(flottePanel.textContent).toContain('Keine Schiffe angedockt');
  });

  it('renders vessel cards when vessels are present', async () => {
    const vessels = [
      {
        id: 42,
        status: 'docked',
        bp_name: 'Orion',
        hull_class: 'corvette',
        hull_tier: 1,
        hull_label: 'Corvette T1',
        stats: { attack: 10, shield: 5, hull: 20, cargo: 50, speed: 1200 },
        hp_state: { hp: 20, max_hp: 20, shield: 5, max_shield: 5 },
      },
    ];
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const flotteTab = root.querySelector('.ui-tab-btn[data-tab-target="flotte"]');
    flotteTab.click();
    const vesselCard = root.querySelector('.vessel-card[data-vessel-id="42"]');
    expect(vesselCard).not.toBeNull();
  });
});

// ── Vessel Repair ────────────────────────────────────────────────────────────

describe('RuntimeShipyardController – vessel repair', () => {
  beforeEach(() => {
    delete window.GQRuntimeShipyardController;
  });

  const damagedVessel = {
    id: 99,
    status: 'docked',
    bp_name: 'Wounded Eagle',
    hull_class: 'corvette',
    hull_tier: 1,
    hull_label: 'Corvette T1',
    stats: { attack: 10, shield: 5, hull: 20, cargo: 50, speed: 1200 },
    hp_state: { hp: 10, max_hp: 20, shield: 2, max_shield: 5 },
  };

  const healthyVessel = {
    id: 55,
    status: 'docked',
    bp_name: 'Iron Citadel',
    hull_class: 'cruiser',
    hull_tier: 3,
    hull_label: 'Cruiser T3',
    stats: { attack: 40, shield: 20, hull: 80, cargo: 200, speed: 700 },
    hp_state: { hp: 80, max_hp: 80, shield: 20, max_shield: 20 },
  };

  it('shows repair button for damaged vessel', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [damagedVessel] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const repairBtn = root.querySelector(`.vessel-card[data-vessel-id="99"] .vessel-repair-btn`);
    expect(repairBtn).not.toBeNull();
  });

  it('does not show repair button for fully healthy vessel', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [healthyVessel] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const repairBtn = root.querySelector(`.vessel-card[data-vessel-id="55"] .vessel-repair-btn`);
    expect(repairBtn).toBeNull();
  });

  it('repair button has correct data-vessel-id', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [damagedVessel] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const repairBtn = root.querySelector('.vessel-repair-btn');
    expect(repairBtn.dataset.vesselId).toBe('99');
  });

  it('clicking repair button calls api.repairVessel with vessel id', async () => {
    const repairVessel = vi.fn().mockResolvedValue({ success: true, hp: 20, max_hp: 20, cost_metal: 5 });
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [damagedVessel] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
        repairVessel,
      },
    });
    await controller.render();
    const repairBtn = root.querySelector('.vessel-repair-btn');
    repairBtn.click();
    await vi.waitFor(() => expect(repairVessel).toHaveBeenCalledWith(99));
  });

  it('after successful repair: HP bar is set to 100% and repair button is removed', async () => {
    const repairVessel = vi.fn().mockResolvedValue({ success: true, hp: 20, max_hp: 20, cost_metal: 5 });
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [damagedVessel] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
        repairVessel,
      },
    });
    await controller.render();
    const repairBtn = root.querySelector('.vessel-repair-btn');
    repairBtn.click();
    await vi.waitFor(() => {
      const card = root.querySelector('.vessel-card[data-vessel-id="99"]');
      const hpFill = card.querySelector('.vessel-hp-fill');
      expect(hpFill.style.width).toBe('100%');
      expect(hpFill.classList.contains('is-good')).toBe(true);
      expect(card.querySelector('.vessel-repair-btn')).toBeNull();
    });
  });

  it('failed repair shows alert', async () => {
    const repairVessel = vi.fn().mockResolvedValue({ success: false, error: 'Insufficient metal. Repair requires 10 metal.' });
    const alertSpy = vi.fn();
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [damagedVessel] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
        repairVessel,
      },
    });
    window.alert = alertSpy;
    await controller.render();
    const repairBtn = root.querySelector('.vessel-repair-btn');
    repairBtn.click();
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Insufficient metal')));
  });

  it('decommission button still present alongside repair button for damaged vessel', async () => {
    const { controller, root } = makeController({
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: [] }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [damagedVessel] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
    });
    await controller.render();
    const card = root.querySelector('.vessel-card[data-vessel-id="99"]');
    expect(card.querySelector('.vessel-repair-btn')).not.toBeNull();
    expect(card.querySelector('.vessel-decommission-btn')).not.toBeNull();
  });
});
