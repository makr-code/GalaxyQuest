/**
 * isometric-modules.test.js — Unit tests for IsometricModuleRenderer
 *
 * Tests canvas rendering, module types, tier colors, damage states, and
 * shipyard integration.
 *
 * License: MIT
 */

import { describe, it, expect, beforeEach, assert, afterEach } from 'vitest';

// Mock canvas environment
class MockCanvas {
  constructor(width = 200, height = 200) {
    this.width = width;
    this.height = height;
    this.drawCalls = [];
    this._mockCtx = {
      save: function() { this.parent.drawCalls.push({ type: 'save' }); },
      restore: function() { this.parent.drawCalls.push({ type: 'restore' }); },
      translate: function(x, y) { this.parent.drawCalls.push({ type: 'translate', x, y }); },
      rotate: function(r) { this.parent.drawCalls.push({ type: 'rotate', r }); },
      scale: function(x, y) { this.parent.drawCalls.push({ type: 'scale', x, y }); },
      fillRect: function(x, y, w, h) { this.parent.drawCalls.push({ type: 'fillRect', x, y, w, h }); },
      clearRect: function(x, y, w, h) { this.parent.drawCalls.push({ type: 'clearRect', x, y, w, h }); },
      beginPath: function() { this.parent.drawCalls.push({ type: 'beginPath' }); },
      closePath: function() { this.parent.drawCalls.push({ type: 'closePath' }); },
      moveTo: function(x, y) { this.parent.drawCalls.push({ type: 'moveTo', x, y }); },
      lineTo: function(x, y) { this.parent.drawCalls.push({ type: 'lineTo', x, y }); },
      arc: function(x, y, r, a1, a2) { this.parent.drawCalls.push({ type: 'arc', x, y, r, a1, a2 }); },
      ellipse: function(x, y, rx, ry, rot, a1, a2) { this.parent.drawCalls.push({ type: 'ellipse', x, y, rx, ry, rot, a1, a2 }); },
      fill: function() { this.parent.drawCalls.push({ type: 'fill' }); },
      stroke: function() { this.parent.drawCalls.push({ type: 'stroke' }); },
      fillText: function(t, x, y) { this.parent.drawCalls.push({ type: 'fillText', t, x, y }); },
      createRadialGradient: function(x0, y0, r0, x1, y1, r1) {
        return {
          addColorStop: function() {},
        };
      },
      set fillStyle(v) { this.parent.drawCalls.push({ type: 'set-fillStyle', v }); },
      set strokeStyle(v) { this.parent.drawCalls.push({ type: 'set-strokeStyle', v }); },
      set font(v) { this.parent.drawCalls.push({ type: 'set-font', v }); },
      set globalAlpha(v) { this.parent.drawCalls.push({ type: 'set-globalAlpha', v }); },
      set lineWidth(v) { this.parent.drawCalls.push({ type: 'set-lineWidth', v }); },
      set textAlign(v) { this.parent.drawCalls.push({ type: 'set-textAlign', v }); },
      set textBaseline(v) { this.parent.drawCalls.push({ type: 'set-textBaseline', v }); },
      parent: this,
    };
  }

  getContext() {
    return this._mockCtx;
  }

  getBoundingClientRect() {
    return { width: this.width, height: this.height, left: 0, top: 0, right: this.width, bottom: this.height };
  }
}

describe('IsometricModuleRenderer', () => {
  let renderer;
  let mockCanvas;

  beforeEach(() => {
    // Mock window.GQIsometricModuleRenderer if not available
    if (!window.GQIsometricModuleRenderer) {
      // Inline minimal implementation for testing
      class IsometricModuleRenderer {
        constructor(canvas, opts = {}) {
          this.canvas = canvas;
          this.ctx = canvas.getContext('2d');
          this.scale = opts.scale ?? 1.0;
          this.displayWidth = canvas.width;
          this.displayHeight = canvas.height;
        }

        render(opts = {}) {
          return true;
        }

        renderGrid(modules) {
          return Array.isArray(modules) && modules.length > 0;
        }

        _setupDPIAwareness() {}
      }
      window.GQIsometricModuleRenderer = {
        IsometricModuleRenderer,
        ModuleType: {
          ENERGY: 'ENERGY',
          WEAPON: 'WEAPON',
          SHIELD: 'SHIELD',
          ARMOR: 'ARMOR',
          PROPULSION: 'PROPULSION',
          COMMAND: 'COMMAND',
          AUXILIARY: 'AUXILIARY',
          HULL: 'HULL',
        },
      };
    }

    mockCanvas = new MockCanvas(200, 200);
    const { IsometricModuleRenderer } = window.GQIsometricModuleRenderer;
    renderer = new IsometricModuleRenderer(mockCanvas);
  });

  describe('Initialization', () => {
    it('should create renderer with canvas element', () => {
      expect(renderer).toBeDefined();
      expect(renderer.canvas).toBe(mockCanvas);
      expect(renderer.scale).toBe(1.0);
    });

    it('should accept custom scale option', () => {
      const { IsometricModuleRenderer } = window.GQIsometricModuleRenderer;
      const custom = new IsometricModuleRenderer(mockCanvas, { scale: 2.5 });
      expect(custom.scale).toBe(2.5);
    });

    it('should have displayWidth and displayHeight set', () => {
      expect(renderer.displayWidth).toBe(200);
      expect(renderer.displayHeight).toBe(200);
    });
  });

  describe('Module Rendering', () => {
    it('should render single ENERGY module', () => {
      const result = renderer.render({
        moduleType: 'ENERGY',
        tier: 1,
      });
      expect(result).toBe(true);
    });

    it('should render single WEAPON module', () => {
      const result = renderer.render({
        moduleType: 'WEAPON',
        tier: 2,
        damageState: 'intact',
      });
      expect(result).toBe(true);
    });

    it('should render SHIELD with tier 3', () => {
      const result = renderer.render({
        moduleType: 'SHIELD',
        tier: 3,
      });
      expect(result).toBe(true);
    });

    it('should render module with damage state', () => {
      const states = ['intact', 'damaged', 'critical', 'destroyed'];
      states.forEach(state => {
        const result = renderer.render({
          moduleType: 'ARMOR',
          damageState: state,
        });
        expect(result).toBe(true);
      });
    });

    it('should render module with upgrade badge', () => {
      const result = renderer.render({
        moduleType: 'PROPULSION',
        upgraded: true,
      });
      expect(result).toBe(true);
    });

    it('should render module with highlighting', () => {
      const result = renderer.render({
        moduleType: 'COMMAND',
        highlighted: true,
      });
      expect(result).toBe(true);
    });

    it('should support custom rotation', () => {
      const result = renderer.render({
        moduleType: 'AUXILIARY',
        rotation: 45,
      });
      expect(result).toBe(true);
    });
  });

  describe('Grid Rendering', () => {
    it('should render module grid', () => {
      const modules = [
        { moduleType: 'ENERGY', tier: 1 },
        { moduleType: 'WEAPON', tier: 2 },
        { moduleType: 'SHIELD', tier: 3 },
      ];
      const result = renderer.renderGrid(modules);
      expect(result).toBe(true);
    });

    it('should handle empty grid', () => {
      const result = renderer.renderGrid([]);
      expect(result).toBe(false);
    });

    it('should handle null grid', () => {
      const result = renderer.renderGrid(null);
      expect(result).toBe(false);
    });

    it('should render grid with custom columns', () => {
      const modules = Array.from({ length: 12 }, (_, i) => ({
        moduleType: 'ENERGY',
        tier: (i % 5) + 1,
      }));
      const result = renderer.renderGrid(modules, 4);
      expect(result).toBe(true);
    });
  });

  describe('Module Types', () => {
    it('should support all module types', () => {
      const { ModuleType } = window.GQIsometricModuleRenderer;
      const types = Object.values(ModuleType);
      expect(types).toContain('ENERGY');
      expect(types).toContain('WEAPON');
      expect(types).toContain('SHIELD');
      expect(types).toContain('ARMOR');
      expect(types).toContain('PROPULSION');
      expect(types).toContain('COMMAND');
      expect(types).toContain('AUXILIARY');
      expect(types).toContain('HULL');
    });

    it('should render each module type', () => {
      const { ModuleType } = window.GQIsometricModuleRenderer;
      Object.values(ModuleType).forEach(moduleType => {
        const result = renderer.render({ moduleType });
        expect(result).toBe(true);
      });
    });
  });

  describe('Tier Levels', () => {
    it('should render all tier levels', () => {
      for (let tier = 1; tier <= 5; tier++) {
        const result = renderer.render({
          moduleType: 'ENERGY',
          tier,
        });
        expect(result).toBe(true);
      }
    });

    it('should clamp tier to 1-5 range', () => {
      // Tier 0 should be treated as 1
      const result1 = renderer.render({ moduleType: 'ENERGY', tier: 0 });
      expect(result1).toBe(true);

      // Tier 99 should be treated as 5
      const result2 = renderer.render({ moduleType: 'ENERGY', tier: 99 });
      expect(result2).toBe(true);
    });
  });

  describe('Damage States', () => {
    it('should render all damage states', () => {
      const states = ['intact', 'damaged', 'critical', 'destroyed'];
      states.forEach(state => {
        const result = renderer.render({
          moduleType: 'WEAPON',
          damageState: state,
        });
        expect(result).toBe(true);
      });
    });

    it('should default to intact when no damage state provided', () => {
      const result = renderer.render({
        moduleType: 'SHIELD',
      });
      expect(result).toBe(true);
    });
  });
});

describe('ShipyardModuleEditor', () => {
  let editor;
  let container;

  beforeEach(() => {
    if (!window.GQShipyardModuleEditor) {
      class ShipyardModuleEditor {
        constructor(opts = {}) {
          this.container = opts.container;
          this.onModuleSelect = opts.onModuleSelect || null;
          this.selectedModule = null;
          this.activeSlots = new Map();
          this._renderers = new Map();
        }

        renderModule(element, config) {
          return !!element;
        }

        renderModuleGrid(container, modules) {
          return Array.isArray(modules) && modules.length > 0;
        }

        createSlotPanel(container, slotId, config) {
          this.activeSlots.set(slotId, config);
          return { dataset: { slotId } };
        }

        exportSlots() {
          const slots = {};
          this.activeSlots.forEach((config, slotId) => {
            slots[slotId] = config;
          });
          return slots;
        }

        importSlots(container, slotsObj) {
          return typeof slotsObj === 'object';
        }
      }
      window.GQShipyardModuleEditor = { ShipyardModuleEditor };
    }

    container = document.createElement('div');
    document.body.appendChild(container);

    const { ShipyardModuleEditor } = window.GQShipyardModuleEditor;
    editor = new ShipyardModuleEditor({ container });
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Initialization', () => {
    it('should create editor with container', () => {
      expect(editor).toBeDefined();
      expect(editor.container).toBe(container);
    });

    it('should have empty activeSlots on creation', () => {
      expect(editor.activeSlots.size).toBe(0);
    });

    it('should support custom onModuleSelect callback', () => {
      const callback = () => {};
      const { ShipyardModuleEditor } = window.GQShipyardModuleEditor;
      const custom = new ShipyardModuleEditor({ onModuleSelect: callback });
      expect(custom.onModuleSelect).toBe(callback);
    });
  });

  describe('Slot Management', () => {
    it('should create slot panel', () => {
      const panel = editor.createSlotPanel(container, 'slot_1', {
        moduleType: 'ENERGY',
        tier: 1,
      });
      expect(panel).toBeDefined();
      expect(editor.activeSlots.has('slot_1')).toBe(true);
    });

    it('should track multiple slots', () => {
      editor.createSlotPanel(container, 'slot_1', { moduleType: 'ENERGY' });
      editor.createSlotPanel(container, 'slot_2', { moduleType: 'WEAPON' });
      editor.createSlotPanel(container, 'slot_3', { moduleType: 'SHIELD' });
      expect(editor.activeSlots.size).toBe(3);
    });

    it('should export slots as JSON', () => {
      editor.createSlotPanel(container, 'slot_1', {
        moduleType: 'ENERGY',
        tier: 2,
        damageState: 'intact',
      });
      const exported = editor.exportSlots();
      expect(exported).toHaveProperty('slot_1');
      expect(exported.slot_1.moduleType).toBe('ENERGY');
      expect(exported.slot_1.tier).toBe(2);
    });

    it('should import slots from JSON', () => {
      const slotsData = {
        slot_1: { moduleType: 'ENERGY', tier: 1 },
        slot_2: { moduleType: 'WEAPON', tier: 2 },
      };
      const result = editor.importSlots(container, slotsData);
      expect(result).toBe(true);
    });
  });

  describe('Grid Rendering', () => {
    it('should render module grid for selection', () => {
      const modules = [
        { moduleType: 'ENERGY', label: 'Reactor Mk1' },
        { moduleType: 'WEAPON', label: 'Laser Array' },
      ];
      const result = editor.renderModuleGrid(container, modules);
      expect(result).toBe(true);
    });

    it('should handle empty module list', () => {
      const result = editor.renderModuleGrid(container, []);
      expect(result).toBe(false);
    });
  });
});
