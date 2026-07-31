/**
 * tests/js/persistent-selection-marker-renderer.test.js
 *
 * Unit tests for PersistentSelectionMarkerRenderer.js
 * Covers: SelectionMarker, CanvasMarkerRenderer, marker lifecycle
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(
  process.cwd(),
  'js/engine/runtime/PersistentSelectionMarkerRenderer.js'
);

function loadModule() {
  delete window.GQPersistentSelectionMarkerRenderer;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQPersistentSelectionMarkerRenderer;
}

describe('PersistentSelectionMarkerRenderer', () => {
  let mod;
  let canvas;
  let ctx;

  beforeEach(() => {
    mod = loadModule();

    // Create mock canvas
    canvas = {
      getContext: vi.fn(),
    };

    ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      beginPath: vi.fn(),
      setLineDash: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fill: vi.fn(),  // Add missing fill method
      globalAlpha: 1,
      strokeStyle: '',
      lineWidth: 1,
      fillStyle: '',
      filter: '',
    };

    canvas.getContext.mockReturnValue(ctx);
  });

  // ─── SelectionMarker ──────────────────────────────────────────
  describe('SelectionMarker', () => {
    it('initializes with all required properties', () => {
      const marker = new mod.SelectionMarker(
        1,
        'star:1:5',
        'star',
        { x: 100, y: 200 },
        { color: 'red' },
        {}
      );

      expect(marker.markerId).toBe(1);
      expect(marker.key).toBe('star:1:5');
      expect(marker.kind).toBe('star');
      expect(marker.position).toEqual({ x: 100, y: 200 });
      expect(marker.isVisible).toBe(true);
      expect(marker.opacity).toBe(1.0);
      expect(marker.scale).toBe(1.0);
    });

    it('updates position', () => {
      const marker = new mod.SelectionMarker(1, 'test', 'star', { x: 0, y: 0 }, {}, {});
      const createdAt = marker.createdAt;

      // Add a small delay to ensure timestamp difference
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 10);

      marker.updatePosition(50, 75);

      expect(marker.position).toEqual({ x: 50, y: 75 });
      expect(marker.lastUpdatedAt).toBeGreaterThanOrEqual(createdAt);

      Date.now = originalNow;
    });

    it('updates visibility', () => {
      const marker = new mod.SelectionMarker(1, 'test', 'star', { x: 0, y: 0 }, {}, {});

      marker.updateVisibility(false);

      expect(marker.isVisible).toBe(false);
    });

    it('updates transform properties', () => {
      const marker = new mod.SelectionMarker(1, 'test', 'star', { x: 0, y: 0 }, {}, {});

      marker.updateTransform(1.2, 0.8, 0.5);

      expect(marker.scale).toBe(1.2);
      expect(marker.opacity).toBe(0.8);
      expect(marker.rotation).toBe(0.5);
    });

    it('calculates age in seconds', () => {
      const marker = new mod.SelectionMarker(1, 'test', 'star', { x: 0, y: 0 }, {}, {});

      const age = marker.getAge();

      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(1); // Should be very small, just created
    });
  });

  // ─── CanvasMarkerRenderer ─────────────────────────────────────
  describe('CanvasMarkerRenderer', () => {
    it('initializes with canvas and options', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas, { baseRadius: 25 });

      expect(renderer.canvas).toBe(canvas);
      expect(renderer.baseRadius).toBe(25);
      expect(renderer.markers.size).toBe(0);
    });

    it('adds a marker', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red', outerWidth: 4 };

      const marker = renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});

      expect(marker).toBeDefined();
      expect(marker.key).toBe('marker-1');
      expect(renderer.markers.size).toBe(1);
    });

    it('prevents duplicate markers', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red' };

      const m1 = renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      const m2 = renderer.addMarker('marker-1', 'star', { x: 200, y: 200 }, token, {});

      expect(m1).toBe(m2);
      expect(renderer.markers.size).toBe(1);
    });

    it('removes a marker', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red' };

      renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      const removed = renderer.removeMarker('marker-1');

      expect(removed).toBe(true);
      expect(renderer.markers.size).toBe(0);
    });

    it('gets marker by key', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red' };

      renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      const marker = renderer.getMarker('marker-1');

      expect(marker).toBeDefined();
      expect(marker.key).toBe('marker-1');
    });

    it('updates marker position', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red' };

      renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      renderer.updateMarkerPosition('marker-1', 200, 300);

      const marker = renderer.getMarker('marker-1');
      expect(marker.position).toEqual({ x: 200, y: 300 });
    });

    it('updates marker transform', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red' };

      renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      renderer.updateMarkerTransform('marker-1', 1.5, 0.8, Math.PI);

      const marker = renderer.getMarker('marker-1');
      expect(marker.scale).toBe(1.5);
      expect(marker.opacity).toBe(0.8);
      expect(marker.rotation).toBe(Math.PI);
    });

    it('clears all markers', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red' };

      renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      renderer.addMarker('marker-2', 'planet', { x: 200, y: 200 }, token, {});

      renderer.clear();

      expect(renderer.markers.size).toBe(0);
    });

    it('gets statistics', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red' };

      renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      renderer.addMarker('marker-2', 'planet', { x: 200, y: 200 }, token, {});

      const stats = renderer.getStatistics();

      expect(stats.markerCount).toBe(2);
      expect(stats.visibleCount).toBe(2);
      expect(stats.nextMarkerId).toBeGreaterThan(0);
    });

    it('renders without error', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = {
        color: 'red',
        outerStroke: 'red',
        outerWidth: 4,
        innerStroke: 'pink',
        innerWidth: 2,
        outerRadius: 0.33,
        innerRadius: 0.11,
        linePattern: 'solid',
        zIndex: 20,
      };

      renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});

      expect(() => renderer.render()).not.toThrow();
    });

    it('handles line patterns', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);

      expect(renderer.getLinePattern('solid')).toEqual([]);
      expect(renderer.getLinePattern('dashed')).toEqual([5, 5]);
      expect(renderer.getLinePattern('dotted')).toEqual([2, 3]);
      expect(renderer.getLinePattern('dot-dash')).toEqual([2, 3, 5, 3]);
      expect(renderer.getLinePattern('long-dash')).toEqual([10, 5]);
    });
  });

  // ─── Factory Function ─────────────────────────────────────────
  describe('createMarkerRenderer', () => {
    beforeEach(() => {
      // Mock rendering contexts for this test
      if (typeof CanvasRenderingContext2D === 'undefined') {
        window.CanvasRenderingContext2D = function () {};
      }
      if (typeof WebGLRenderingContext === 'undefined') {
        window.WebGLRenderingContext = function () {};
      }
      if (typeof WebGL2RenderingContext === 'undefined') {
        window.WebGL2RenderingContext = function () {};
      }
    });

    it('creates canvas renderer for 2D context', () => {
      const mockCtx = Object.create(CanvasRenderingContext2D.prototype);
      const renderer = mod.createMarkerRenderer(mockCtx);

      expect(renderer).toBeInstanceOf(mod.CanvasMarkerRenderer);
    });

    it('throws for unsupported context', () => {
      expect(() => {
        mod.createMarkerRenderer({});
      }).toThrow('Unsupported rendering context');
    });
  });

  // ─── Integration ──────────────────────────────────────────────
  describe('Integration', () => {
    it('manages multiple markers with different states', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);

      const selectionToken = {
        color: 'gold',
        outerStroke: 'gold',
        innerStroke: 'light-gold',
        outerRadius: 0.33,
        innerRadius: 0.11,
        zIndex: 21,
      };

      const hoverToken = {
        color: 'blue',
        outerStroke: 'blue',
        innerStroke: 'light-blue',
        outerRadius: 0.29,
        innerRadius: 0.14,
        zIndex: 20,
      };

      const m1 = renderer.addMarker('selected', 'star', { x: 100, y: 100 }, selectionToken, {});
      const m2 = renderer.addMarker('hover', 'planet', { x: 200, y: 200 }, hoverToken, {});

      expect(renderer.markers.size).toBe(2);
      expect(m1.token).toEqual(selectionToken);
      expect(m2.token).toEqual(hoverToken);
    });

    it('supports marker lifecycle', () => {
      const renderer = new mod.CanvasMarkerRenderer(canvas);
      const token = { color: 'red', outerStroke: 'red', outerRadius: 0.3, innerRadius: 0.1 };

      const marker = renderer.addMarker('marker-1', 'star', { x: 100, y: 100 }, token, {});
      expect(marker.isVisible).toBe(true);

      marker.updateVisibility(false);
      expect(marker.isVisible).toBe(false);

      renderer.removeMarker('marker-1');
      expect(renderer.getMarker('marker-1')).toBeUndefined();
    });
  });
});
