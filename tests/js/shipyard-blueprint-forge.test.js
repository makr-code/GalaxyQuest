/**
 * tests/js/shipyard-blueprint-forge.test.js
 *
 * Comprehensive test suite for ShipyardBlueprintForge interactive UI
 * - Inventory loading from API
 * - Hull selection and slot initialization
 * - Module assignment and stats calculation
 * - Blueprint save/load/export workflows
 * - Preset management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShipyardBlueprintForge } from '../../js/ui/ShipyardBlueprintForge.js';

// Mock fetch
global.fetch = vi.fn();
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

// Mock IsometricModuleRenderer globally
window.GQIsometricModuleRenderer = {
  IsometricModuleRenderer: class {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.opts = opts;
    }
    render(opts) {}
    renderGrid(modules, cols) {}
  },
  ModuleType: {
    ENERGY: 'energy',
    WEAPON: 'weapon',
    SHIELD: 'shield',
    ARMOR: 'armor',
    PROPULSION: 'propulsion',
    COMMAND: 'command',
    AUXILIARY: 'auxiliary',
    HULL: 'hull',
  },
};

// Mock API responses
const mockHulls = {
  hulls: [
    {
      id: 1,
      code: 'SCOUT',
      label: 'Scout Class',
      ship_class: 'Light',
      base_cost: 5000,
      base_cargo: 100,
      base_speed: 8,
      base_attack: 2,
      base_shield: 50,
      base_hull: 150,
      base_mass: 1.2,
      base_energy_output: 100,
      base_energy_capacity: 100,
      base_energy_upkeep: 10,
      slot_profile_json: '{"weapon":2,"energy":1,"shield":1}',
    },
    {
      id: 2,
      code: 'CRUISER',
      label: 'Cruiser Class',
      ship_class: 'Medium',
      base_cost: 15000,
      base_cargo: 500,
      base_speed: 5,
      base_attack: 5,
      base_shield: 200,
      base_hull: 500,
      base_mass: 3.5,
      base_energy_output: 200,
      base_energy_capacity: 250,
      base_energy_upkeep: 25,
      slot_profile_json: '{"weapon":4,"energy":2,"shield":2}',
    },
  ],
  faction_affinities: { faction_id: [1, 2, 3] },
};

const mockModules = {
  modules_by_group: {
    weapon: [
      {
        id: 101,
        code: 'LASER_I',
        label: 'Laser I',
        module_type: 'laser',
        tier: 1,
        cost: 1000,
        mass: 0.5,
        bonus_attack: 5,
        bonus_speed: 0,
        bonus_shield: 0,
        bonus_cargo: 0,
        energy_upkeep: 20,
      },
      {
        id: 102,
        code: 'LASER_II',
        label: 'Laser II',
        module_type: 'laser',
        tier: 2,
        cost: 2500,
        mass: 0.7,
        bonus_attack: 10,
        bonus_speed: 0,
        bonus_shield: 0,
        bonus_cargo: 0,
        energy_upkeep: 35,
      },
    ],
    energy: [
      {
        id: 201,
        code: 'REACTOR_I',
        label: 'Reactor I',
        module_type: 'reactor',
        tier: 1,
        cost: 2000,
        mass: 1.0,
        bonus_attack: 0,
        bonus_speed: 0,
        bonus_shield: 0,
        bonus_cargo: 0,
        energy_upkeep: -50,
      },
    ],
    shield: [
      {
        id: 301,
        code: 'SHIELD_I',
        label: 'Shield I',
        module_type: 'shield',
        tier: 1,
        cost: 1500,
        mass: 0.8,
        bonus_attack: 0,
        bonus_speed: 0,
        bonus_shield: 75,
        bonus_cargo: 0,
        energy_upkeep: 25,
      },
    ],
  },
};

describe('ShipyardBlueprintForge', () => {
  let forge;
  let container;

  beforeEach(() => {
    // Setup DOM
    container = document.createElement('div');
    document.body.appendChild(container);

    // Reset mocks
    vi.clearAllMocks();
    global.fetch.mockReset();

    // Setup default fetch responses
    global.fetch.mockImplementation((url) => {
      if (url.includes('action=list_hulls')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockHulls),
        });
      }
      if (url.includes('action=list_modules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockModules),
        });
      }
      return Promise.reject(new Error('Unexpected mock URL: ' + url));
    });

    forge = new ShipyardBlueprintForge({
      container,
      colonyId: 42,
      apiBase: '/api',
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Initialization', () => {
    it('should initialize with default options', () => {
      expect(forge.container).toBe(container);
      expect(forge.colonyId).toBe(42);
      expect(forge.apiBase).toBe('/api');
      expect(forge.currentHull).toBeNull();
      expect(forge.currentSlots.size).toBe(0);
      expect(forge._selectedPresetName).toBe('');
      expect(forge._blueprintDraftName).toBe('');
    });

    it('should load inventory on init', async () => {
      const result = await forge.init();
      expect(result).toBe(true);
      expect(forge.availableHulls.length).toBe(2);
      expect(forge.availableModules.weapon.length).toBe(2);
      expect(forge.availableModules.energy.length).toBe(1);
    });

    it('should set default hull after init', async () => {
      await forge.init();
      expect(forge.currentHull).not.toBeNull();
      expect(forge.currentHull.code).toBe('SCOUT');
    });

    it('should initialize slots based on hull profile', async () => {
      await forge.init();
      // SCOUT has: weapon x2, energy x1, shield x1
      expect(forge.currentSlots.size).toBe(4);
      expect(forge.currentSlots.has('weapon_0')).toBe(true);
      expect(forge.currentSlots.has('weapon_1')).toBe(true);
      expect(forge.currentSlots.has('energy_0')).toBe(true);
      expect(forge.currentSlots.has('shield_0')).toBe(true);
    });

    it('should handle init errors gracefully', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));
      const result = await forge.init();
      expect(result).toBe(false);
      expect(forge.lastError).toContain('Network error');
    });
  });

  describe('Hull Selection', () => {
    beforeEach(async () => {
      await forge.init();
    });

    it('should support hull switching', async () => {
      const cruiser = forge.availableHulls.find(h => h.code === 'CRUISER');
      forge.currentHull = cruiser;
      forge._initializeSlots();
      // CRUISER has: weapon x4, energy x2, shield x2
      expect(forge.currentSlots.size).toBe(8);
    });

    it('should recalculate slots when switching hulls', async () => {
      const oldSize = forge.currentSlots.size;
      const cruiser = forge.availableHulls.find(h => h.code === 'CRUISER');
      forge.currentHull = cruiser;
      forge._initializeSlots();
      expect(forge.currentSlots.size).toBeGreaterThan(oldSize);
    });

    it('should clear module slots when switching hulls', async () => {
      // Assign a module
      const weapons = forge.availableModules.weapon;
      forge.currentSlots.set('weapon_0', weapons[0]);
      expect(forge.currentSlots.get('weapon_0')).not.toBeNull();

      // Switch hull
      const cruiser = forge.availableHulls.find(h => h.code === 'CRUISER');
      forge.currentHull = cruiser;
      forge._initializeSlots();

      // All slots should be empty (null)
      forge.currentSlots.forEach((mod) => {
        expect(mod).toBeNull();
      });
    });
  });

  describe('Stats Calculation', () => {
    beforeEach(async () => {
      await forge.init();
    });

    it('should calculate base hull stats', () => {
      forge._updateStatsPreview();
      expect(forge.currentStats.cost).toBe(5000); // SCOUT base_cost
      expect(forge.currentStats.attack).toBe(2); // base_attack
      expect(forge.currentStats.shield).toBe(50); // base_shield
      expect(forge.currentStats.hull).toBe(150); // base_hull
    });

    it('should aggregate module bonuses into stats', () => {
      const laserI = forge.availableModules.weapon[0];
      forge.currentSlots.set('weapon_0', laserI);
      forge._updateStatsPreview();

      expect(forge.currentStats.cost).toBe(5000 + laserI.cost);
      expect(forge.currentStats.attack).toBe(2 + laserI.bonus_attack);
      expect(forge.currentStats.mass).toBeGreaterThan(1.2);
    });

    it('should handle multiple module assignments', () => {
      const laserI = forge.availableModules.weapon[0];
      const laserII = forge.availableModules.weapon[1];
      const reactor = forge.availableModules.energy[0];

      forge.currentSlots.set('weapon_0', laserI);
      forge.currentSlots.set('weapon_1', laserII);
      forge.currentSlots.set('energy_0', reactor);
      forge._updateStatsPreview();

      expect(forge.currentStats.cost)
        .toBe(5000 + laserI.cost + laserII.cost + reactor.cost);
      expect(forge.currentStats.attack)
        .toBe(2 + laserI.bonus_attack + laserII.bonus_attack);
    });

    it('should calculate energy efficiency correctly', () => {
      forge._updateStatsPreview();
      const baseEff = (100 - 10) / 100 * 100; // (output - upkeep) / output * 100
      expect(parseFloat(forge.currentStats.energyEfficiency)).toBeCloseTo(baseEff, 1);
    });

    it('should calculate mass ratio (attack per mass)', () => {
      forge._updateStatsPreview();
      const ratio = 2 / 1.2;
      expect(parseFloat(forge.currentStats.massRatio)).toBeCloseTo(ratio, 1);
    });

    it('should fire stats change event', () => {
      return new Promise((resolve) => {
        const listener = (ev) => {
          expect(ev.detail).toEqual(forge.currentStats);
          window.removeEventListener('gq:blueprint-stats-changed', listener);
          resolve();
        };
        window.addEventListener('gq:blueprint-stats-changed', listener);
        forge._updateStatsPreview();
      });
    });
  });

  describe('Module Assignment', () => {
    beforeEach(async () => {
      await forge.init();
    });

    it('should assign module to slot', () => {
      const laser = forge.availableModules.weapon[0];
      forge.currentSlots.set('weapon_0', laser);
      expect(forge.currentSlots.get('weapon_0')).toBe(laser);
    });

    it('should remove module from slot', () => {
      const laser = forge.availableModules.weapon[0];
      forge.currentSlots.set('weapon_0', laser);
      forge.currentSlots.set('weapon_0', null);
      expect(forge.currentSlots.get('weapon_0')).toBeNull();
    });

    it('should support multiple slot assignments', () => {
      const laserI = forge.availableModules.weapon[0];
      const laserII = forge.availableModules.weapon[1];

      forge.currentSlots.set('weapon_0', laserI);
      forge.currentSlots.set('weapon_1', laserII);

      expect(forge.currentSlots.get('weapon_0')).toBe(laserI);
      expect(forge.currentSlots.get('weapon_1')).toBe(laserII);
    });
  });

  describe('Blueprint Save/Load', () => {
    beforeEach(async () => {
      await forge.init();
    });

    it('should save blueprint via API', async () => {
      const laser = forge.availableModules.weapon[0];
      forge.currentSlots.set('weapon_0', laser);

      global.fetch.mockImplementation((url, opts) => {
        if (url.includes('action=create_blueprint')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 999, name: 'Test Blueprint' }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const result = await forge.saveBlueprint('Test Blueprint');
      expect(result.id).toBe(999);
      expect(result.name).toBe('Test Blueprint');
    });

    it('should invoke onBlueprintSave callback', async () => {
      const callback = vi.fn();
      forge.onBlueprintSave = callback;
      forge.currentSlots.set('weapon_0', forge.availableModules.weapon[0]);

      global.fetch.mockImplementation((url, opts) => {
        if (url.includes('action=create_blueprint')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 888, name: 'Preset' }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      await forge.saveBlueprint('Preset');
      expect(callback).toHaveBeenCalled();
    });

    it('should load blueprint by ID', async () => {
      global.fetch.mockImplementation((url) => {
        if (url.includes('action=list_blueprints')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              blueprints: [
                {
                  id: 1,
                  hull_code: 'SCOUT',
                  modules: [
                    { slot_id: 'weapon_0', module_id: 101, code: 'LASER_I' },
                  ],
                },
              ],
            }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const loaded = await forge.loadBlueprint(1);
      expect(loaded).toBe(true);
      expect(forge.currentHull.code).toBe('SCOUT');
      expect(forge.currentSlots.get('weapon_0')).not.toBeNull();
    });

    it('should handle blueprint not found', async () => {
      global.fetch.mockImplementation((url) => {
        if (url.includes('action=list_blueprints')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ blueprints: [] }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const loaded = await forge.loadBlueprint(999);
      expect(loaded).toBe(false);
    });
  });

  describe('Build Ship', () => {
    beforeEach(async () => {
      await forge.init();
    });

    it('should build ship with current configuration', async () => {
      forge.currentSlots.set('weapon_0', forge.availableModules.weapon[0]);
      forge.currentSlots.set('energy_0', forge.availableModules.energy[0]);

      global.fetch.mockImplementation((url, opts) => {
        if (url.includes('action=build')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ vessel_id: 777, name: 'New Vessel' }),
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const result = await forge.buildShip();
      expect(result.vessel_id).toBe(777);
    });

    it('should reject build with empty slots', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const result = await forge.buildShip();
      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('action=build'), expect.anything());
    });

    it('should reject build without hull', async () => {
      forge.currentHull = null;
      const result = await forge.buildShip();
      expect(result).toBe(false);
    });
  });

  describe('Export/Import', () => {
    beforeEach(async () => {
      await forge.init();
    });

    it('should export configuration as JSON', () => {
      const laser = forge.availableModules.weapon[0];
      forge.currentSlots.set('weapon_0', laser);
      forge._updateStatsPreview();

      const exported = forge.export();
      expect(exported.hull).toBe(forge.currentHull);
      expect(exported.slots['weapon_0']).toBe(laser);
      expect(exported.stats).toBeDefined();
      expect(exported.timestamp).toBeDefined();
    });

    it('should import configuration from JSON', () => {
      const laser = forge.availableModules.weapon[0];
      const config = {
        hull: forge.availableHulls[0],
        slots: { weapon_0: laser },
        stats: {},
      };

      forge.import(config);
      expect(forge.currentHull).toBe(config.hull);
      expect(forge.currentSlots.get('weapon_0')).toBe(laser);
    });

    it('should reject import without hull', () => {
      const config = { slots: {}, stats: {} };
      const result = forge.import(config);
      expect(result).toBe(false);
    });
  });

  describe('Presets Storage', () => {
    it('should load presets from localStorage on init', () => {
      const presets = { preset1: { test: true } };
      global.localStorage.getItem.mockReturnValue(JSON.stringify(presets));

      const forge2 = new ShipyardBlueprintForge({ container });
      expect(forge2._presets).toEqual(presets);
    });

    it('should handle corrupted localStorage gracefully', () => {
      global.localStorage.getItem.mockReturnValue('invalid json');
      const forge2 = new ShipyardBlueprintForge({ container });
      expect(forge2._presets).toEqual({});
    });

    it('should save presets to localStorage', () => {
      forge._presets = { presetA: { hull: 'SCOUT' } };
      forge._savePresetsToStorage();
      expect(global.localStorage.setItem).toHaveBeenCalledWith(
        'gq-shipyard-presets',
        JSON.stringify({ presetA: { hull: 'SCOUT' } })
      );
    });

    it('should save current configuration as preset', async () => {
      await forge.init();
      forge.currentSlots.set('weapon_0', forge.availableModules.weapon[0]);

      const ok = forge.saveCurrentAsPreset('combat-alpha');
      expect(ok).toBe(true);
      expect(forge._presets['combat-alpha']).toBeDefined();
      expect(forge._presets['combat-alpha'].hullCode).toBe('SCOUT');
      expect(forge._presets['combat-alpha'].slots.length).toBe(1);
    });

    it('should apply a saved preset', async () => {
      await forge.init();
      forge.currentSlots.set('weapon_0', forge.availableModules.weapon[0]);
      forge.saveCurrentAsPreset('combat-alpha');

      forge.currentSlots.set('weapon_0', null);
      const ok = forge.applyPreset('combat-alpha');

      expect(ok).toBe(true);
      expect(forge.currentSlots.get('weapon_0')).not.toBeNull();
      expect(forge.currentSlots.get('weapon_0').id).toBe(101);
    });

    it('should delete preset', async () => {
      await forge.init();
      forge.currentSlots.set('weapon_0', forge.availableModules.weapon[0]);
      forge.saveCurrentAsPreset('combat-alpha');

      const deleted = forge.deletePreset('combat-alpha');
      expect(deleted).toBe(true);
      expect(forge._presets['combat-alpha']).toBeUndefined();
    });

    it('should list preset names sorted', async () => {
      await forge.init();
      forge.currentSlots.set('weapon_0', forge.availableModules.weapon[0]);
      forge.saveCurrentAsPreset('zeta');
      forge.saveCurrentAsPreset('alpha');

      expect(forge.listPresetNames()).toEqual(['alpha', 'zeta']);
    });
  });

  describe('Module Comparison', () => {
    beforeEach(async () => {
      await forge.init();
    });

    it('should calculate module deltas correctly', () => {
      const currentMod = forge.availableModules.weapon[0];
      const candidateMod = forge.availableModules.weapon[1];

      const delta = forge._calculateModuleDelta(currentMod, candidateMod);

      expect(delta.bonus_attack).toBe(5);
      expect(delta.cost).toBe(1500);
      expect(delta.mass).toBeCloseTo(0.2, 5);
      expect(delta.bonus_shield).toBe(0);
    });

    it('should treat missing current module as zero baseline', () => {
      const candidateMod = forge.availableModules.energy[0];
      const delta = forge._calculateModuleDelta(null, candidateMod);

      expect(delta.cost).toBe(candidateMod.cost);
      expect(delta.energy_upkeep).toBe(candidateMod.energy_upkeep);
    });

    it('should render inline comparison panel', () => {
      const currentMod = forge.availableModules.weapon[0];
      const candidateMod = forge.availableModules.weapon[1];
      const panel = document.createElement('div');

      forge._renderInlineModuleComparison(panel, 'weapon_0', candidateMod, currentMod);

      expect(panel.style.display).toBe('block');
      expect(panel.textContent).toContain('Compare in weapon_0');
      expect(panel.querySelectorAll('tr').length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should capture API errors in lastError', async () => {
      global.fetch.mockImplementation((url) => {
        if (url.includes('action=list_hulls')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Unauthorized' }),
          });
        }
        return Promise.reject(new Error('Network error'));
      });

      const result = await forge.init();
      expect(result).toBe(false);
      expect(forge.lastError).toBeDefined();
    });

    it('should render and auto-remove toast', () => {
      vi.useFakeTimers();
      forge._showToast('Saved!', 'success');

      expect(document.body.textContent).toContain('Saved!');
      vi.advanceTimersByTime(2300);
      expect(document.body.textContent).not.toContain('Saved!');

      vi.useRealTimers();
    });
  });

  describe('Responsive Toolbar', () => {
    it('should return mobile columns for small width', () => {
      expect(forge._getActionToolbarColumns(700)).toBe('repeat(2, minmax(140px, 1fr))');
    });

    it('should return tablet columns for medium width', () => {
      expect(forge._getActionToolbarColumns(980)).toBe('repeat(4, minmax(140px, 1fr))');
    });

    it('should return compact desktop columns for large width', () => {
      expect(forge._getActionToolbarColumns(1280))
        .toBe('minmax(220px, 1fr) minmax(220px, 1fr) repeat(4, auto)');
    });

    it('should apply layout columns to toolbar element', () => {
      const section = document.createElement('div');
      forge._applyActionToolbarLayout(section, 700);
      expect(section.style.gridTemplateColumns).toBe('repeat(2, minmax(140px, 1fr))');
    });

    it('should make toolbar sticky on mobile width', () => {
      const section = document.createElement('div');
      forge._applyActionToolbarLayout(section, 700);
      expect(section.style.position).toBe('sticky');
      expect(section.style.bottom).toContain('safe-area-inset-bottom');
    });

    it('should expose safe-area sticky offset helper', () => {
      expect(forge._getStickyBottomOffset()).toContain('safe-area-inset-bottom');
    });

    it('should reset sticky behavior on desktop width', () => {
      const section = document.createElement('div');
      forge._applyActionToolbarLayout(section, 700);
      forge._applyActionToolbarLayout(section, 1200);
      expect(section.style.position).toBe('static');
    });

    it('should apply larger touch targets for mobile controls', () => {
      const section = document.createElement('div');
      const button = document.createElement('button');
      button.setAttribute('data-role', 'forge-action-build');
      section.appendChild(button);

      forge._applyActionToolbarItemLayout(section, 700);
      expect(button.style.minHeight).toBe('44px');
      expect(button.style.fontSize).toBe('13px');
    });
  });
});
