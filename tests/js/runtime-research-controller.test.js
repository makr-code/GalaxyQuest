/**
 * tests/js/runtime-research-controller.test.js
 *
 * Tests for RuntimeResearchController — research UI/UX layer:
 *   - RESEARCH_UI_META coverage (all known tech types)
 *   - getResearchUiMeta fallback for unknown types
 *   - groupByCategory — correct category assignment
 *   - buildCardHtml — tier badge, icon, description, locked/busy/unlocked states
 *   - buildCardsHtml — category headers, correct ordering, empty-state message
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeResearchController.js');

function loadModule() {
  delete window.GQRuntimeResearchController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeResearchController;
}

function makeController(overrides = {}) {
  const mod = loadModule();
  return mod.createResearchController({
    wm: null,
    api: null,
    getCurrentColony: () => ({ id: 1 }),
    getAudioManager: () => null,
    fmtName: (v) => String(v || ''),
    fmt: (v) => String(v || 0),
    esc: (v) => String(v || '').replace(/"/g, '&quot;'),
    countdown: (v) => String(v || ''),
    showToast: vi.fn(),
    gameLog: vi.fn(),
    ...overrides,
  });
}

function row(type, overrides = {}) {
  return {
    type,
    level: 0,
    research_start: null,
    research_end: null,
    next_cost: { metal: 0, crystal: 800, deuterium: 400 },
    can_research: true,
    missing_prereqs: [],
    ...overrides,
  };
}

// ── RESEARCH_UI_META ─────────────────────────────────────────────────────────

describe('RESEARCH_UI_META', () => {
  it('exports RESEARCH_UI_META with all known tech types', () => {
    const mod = loadModule();
    const knownTechs = [
      'energy_tech', 'ion_tech', 'dark_energy_tap',
      'computer_tech', 'espionage_tech', 'hyperspace_tech', 'quantum_computing', 'stealth_tech',
      'weapons_tech', 'laser_tech', 'plasma_tech',
      'shielding_tech', 'armor_tech',
      'combustion_drive', 'impulse_drive', 'hyperspace_drive',
      'astrophysics', 'intergalactic_network', 'graviton_tech', 'wormhole_theory',
      'nano_materials', 'terraforming_tech',
      'genetic_engineering',
    ];
    for (const tech of knownTechs) {
      expect(mod.RESEARCH_UI_META, `Missing entry for ${tech}`).toHaveProperty(tech);
    }
  });

  it('each entry has cat, tier, icon, desc fields', () => {
    const mod = loadModule();
    for (const [type, meta] of Object.entries(mod.RESEARCH_UI_META)) {
      expect(typeof meta.cat, `${type}.cat`).toBe('string');
      expect(typeof meta.tier, `${type}.tier`).toBe('number');
      expect(typeof meta.icon, `${type}.icon`).toBe('string');
      expect(typeof meta.desc, `${type}.desc`).toBe('string');
    }
  });
});

// ── getResearchUiMeta ────────────────────────────────────────────────────────

describe('getResearchUiMeta', () => {
  it('returns correct meta for a known type', () => {
    const mod = loadModule();
    const meta = mod.getResearchUiMeta('energy_tech');
    expect(meta.cat).toBe('Energy');
    expect(meta.tier).toBe(0);
    expect(meta.icon).toBe('ENE');
  });

  it('returns fallback for unknown type', () => {
    const mod = loadModule();
    const meta = mod.getResearchUiMeta('unknown_tech_xyz');
    expect(meta.cat).toBe('Other');
    expect(meta.tier).toBe(0);
    expect(meta.icon).toBe('RES');
  });

  it('returns fallback for empty string', () => {
    const mod = loadModule();
    const meta = mod.getResearchUiMeta('');
    expect(meta.cat).toBe('Other');
  });
});

// ── RESEARCH_CATEGORY_ORDER ──────────────────────────────────────────────────

describe('RESEARCH_CATEGORY_ORDER', () => {
  it('includes all used categories', () => {
    const mod = loadModule();
    const usedCats = new Set(Object.values(mod.RESEARCH_UI_META).map((m) => m.cat));
    for (const cat of usedCats) {
      expect(mod.RESEARCH_CATEGORY_ORDER).toContain(cat);
    }
  });
});

// ── groupByCategory ──────────────────────────────────────────────────────────

describe('groupByCategory', () => {
  it('groups techs into correct categories', () => {
    const ctrl = makeController();
    const rows = [row('energy_tech'), row('weapons_tech'), row('impulse_drive'), row('quantum_computing')];
    const grouped = ctrl.groupByCategory(rows);
    expect(grouped['Energy']).toHaveLength(1);
    expect(grouped['Energy'][0].type).toBe('energy_tech');
    expect(grouped['Weapons']).toHaveLength(1);
    expect(grouped['Weapons'][0].type).toBe('weapons_tech');
    expect(grouped['Drives']).toHaveLength(1);
    expect(grouped['Computing']).toHaveLength(1);
  });

  it('places unknown types in Other', () => {
    const ctrl = makeController();
    const grouped = ctrl.groupByCategory([row('alien_tech_99')]);
    expect(grouped['Other']).toHaveLength(1);
  });

  it('returns empty object for empty input', () => {
    const ctrl = makeController();
    expect(ctrl.groupByCategory([])).toEqual({});
  });
});

// ── buildCardHtml ────────────────────────────────────────────────────────────

describe('buildCardHtml — tier badge and icon', () => {
  it('includes tier badge with correct tier number', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardHtml(row('energy_tech'));
    expect(html).toContain('research-tier-badge');
    expect(html).toContain('T0');
  });

  it('shows tier 2 for impulse_drive', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardHtml(row('impulse_drive'));
    expect(html).toContain('T2');
  });

  it('includes icon badge', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardHtml(row('energy_tech'));
    expect(html).toContain('research-icon-badge');
    expect(html).toContain('ENE');
  });

  it('includes description text', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardHtml(row('energy_tech'));
    expect(html).toContain('research-desc');
    expect(html).toContain('Foundational energy research');
  });
});

describe('buildCardHtml — locked state', () => {
  it('adds item-card-locked class when locked', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardHtml(row('shielding_tech', {
      can_research: false,
      missing_prereqs: [{ tech: 'energy_tech', required_level: 2 }, { tech: 'weapons_tech', required_level: 1 }],
    }));
    expect(html).toContain('item-card-locked');
    expect(html).toContain('item-locked-badge');
    expect(html).toContain('item-prereq-hint');
    expect(html).toContain('energy_tech');
  });

  it('shows disabled button when locked', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardHtml(row('laser_tech', { can_research: false, missing_prereqs: [] }));
    expect(html).toContain('disabled');
    expect(html).not.toContain('research-btn');
  });
});

describe('buildCardHtml — unlocked state', () => {
  it('shows research-btn when unlocked and not busy', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardHtml(row('energy_tech', { can_research: true }));
    expect(html).toContain('research-btn');
    expect(html).toContain('data-type="energy_tech"');
  });
});

describe('buildCardHtml — busy (in-progress) state', () => {
  it('shows progress bar and timer when research is in progress', () => {
    const ctrl = makeController();
    const start = new Date(Date.now() - 30_000).toISOString();
    const end = new Date(Date.now() + 30_000).toISOString();
    const html = ctrl.buildCardHtml(row('energy_tech', { research_start: start, research_end: end }));
    expect(html).toContain('item-timer');
    expect(html).toContain('entity-bars');
    expect(html).toContain('bar-fill');
    expect(html).toContain(`data-end="${end}"`);
  });

  it('does not show research-btn when busy', () => {
    const ctrl = makeController();
    const start = new Date(Date.now() - 10_000).toISOString();
    const end = new Date(Date.now() + 60_000).toISOString();
    const html = ctrl.buildCardHtml(row('energy_tech', { research_start: start, research_end: end }));
    expect(html).not.toContain('research-btn');
  });
});

// ── buildCardsHtml ───────────────────────────────────────────────────────────

describe('buildCardsHtml — category sections', () => {
  it('renders category headers for present categories', () => {
    const ctrl = makeController();
    const rows = [row('energy_tech'), row('weapons_tech')];
    const html = ctrl.buildCardsHtml(rows);
    expect(html).toContain('research-category');
    expect(html).toContain('research-cat-title');
    expect(html).toContain('Energy');
    expect(html).toContain('Weapons');
  });

  it('does not render empty categories', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardsHtml([row('energy_tech')]);
    expect(html).toContain('Energy');
    expect(html).not.toContain('Weapons');
    expect(html).not.toContain('Drives');
  });

  it('renders all techs inside their category block', () => {
    const ctrl = makeController();
    const rows = [row('energy_tech'), row('ion_tech'), row('dark_energy_tap')];
    const html = ctrl.buildCardsHtml(rows);
    const energyIdx = html.indexOf('Energy');
    const weaponsIdx = html.indexOf('Weapons');
    // All three Energy techs appear before any Weapons header (which shouldn't be there)
    expect(energyIdx).toBeGreaterThanOrEqual(0);
    expect(weaponsIdx).toBe(-1);
    expect(html).toContain('ENE');
    expect(html).toContain('ION');
    expect(html).toContain('DRK');
  });

  it('returns empty-state message for empty input', () => {
    const ctrl = makeController();
    const html = ctrl.buildCardsHtml([]);
    expect(html).toContain('No research data');
  });

  it('respects RESEARCH_CATEGORY_ORDER: Energy before Weapons before Drives', () => {
    const ctrl = makeController();
    const rows = [row('impulse_drive'), row('weapons_tech'), row('energy_tech')];
    const html = ctrl.buildCardsHtml(rows);
    const energyIdx = html.indexOf('>Energy<');
    const weaponsIdx = html.indexOf('>Weapons<');
    const drivesIdx = html.indexOf('>Drives<');
    expect(energyIdx).toBeLessThan(weaponsIdx);
    expect(weaponsIdx).toBeLessThan(drivesIdx);
  });
});
