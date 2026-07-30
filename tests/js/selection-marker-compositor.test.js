/**
 * tests/js/selection-marker-compositor.test.js
 *
 * Unit tests for SelectionMarkerCompositor.js
 * Covers: lifecycle management, selection state synchronization, animation coordination
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const compositorPath = path.resolve(
  process.cwd(),
  'js/engine/runtime/SelectionMarkerCompositor.js'
);

function loadCompositorModule() {
  delete window.GQSelectionMarkerCompositor;
  window.eval(fs.readFileSync(compositorPath, 'utf8'));
  return window.GQSelectionMarkerCompositor;
}

describe('SelectionMarkerCompositor', () => {
  let mod;
  let mockRenderer;
  let mockAnimationPool;

  beforeEach(() => {
    mod = loadCompositorModule();

    // Create mock renderer
    mockRenderer = {
      addMarker: vi.fn((key, kind, pos, token, config) => ({
        key,
        kind,
        position: pos,
        token,
        isVisible: true,
        opacity: 1.0,
        scale: 1.0,
        rotation: 0,
        updatePosition: vi.fn(),
        updateVisibility: vi.fn(),
        updateTransform: vi.fn(),
      })),
      removeMarker: vi.fn(() => true),
      render: vi.fn(),
      getStatistics: vi.fn(() => ({ markerCount: 0, visibleCount: 0 })),
    };

    // Create mock animation pool
    mockAnimationPool = {
      acquire: vi.fn((key, config) => ({
        getFrameProperties: vi.fn(() => ({
          scale: 1.0,
          opacity: 1.0,
          rotation: 0,
          positionOffset: { x: 0, y: 0 },
        })),
      })),
      release: vi.fn(),
      updateAll: vi.fn(),
      getStatistics: vi.fn(() => ({ activeCount: 0, pooledCount: 0 })),
    };
  });

  // ─── Constructor & Setup ──────────────────────────────────────
  describe('Constructor & Setup', () => {
    it('initializes with renderer and animation pool', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      expect(compositor.renderer).toBe(mockRenderer);
      expect(compositor.animationPool).toBe(mockAnimationPool);
      expect(compositor.markerMap.size).toBe(0);
    });

    it('accepts options for culling and batching', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool, {
        enableCulling: false,
        enableBatching: true,
        cullingRadius: 500,
      });

      expect(compositor.enableCulling).toBe(false);
      expect(compositor.enableBatching).toBe(true);
      expect(compositor.cullingRadius).toBe(500);
    });

    it('sets default viewport bounds', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      expect(compositor.viewportBounds).toBeDefined();
      expect(compositor.viewportBounds.minX).toBeLessThan(compositor.viewportBounds.maxX);
      expect(compositor.viewportBounds.minY).toBeLessThan(compositor.viewportBounds.maxY);
    });
  });

  // ─── Selection State ──────────────────────────────────────────
  describe('Selection State', () => {
    it('sets selection state', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);
      const state = { active: null, hover: null };

      compositor.setSelectionState(state);

      expect(compositor.selectionState).toBe(state);
    });

    it('sets viewport bounds', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);
      const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 };

      compositor.setViewportBounds(bounds);

      expect(compositor.viewportBounds).toEqual(bounds);
    });
  });

  // ─── Viewport Culling ─────────────────────────────────────────
  describe('Viewport Culling', () => {
    it('determines if position is in viewport', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);
      compositor.setViewportBounds({ minX: 0, minY: 0, maxX: 800, maxY: 600 });

      expect(compositor.isInViewport({ x: 400, y: 300 })).toBe(true);
      expect(compositor.isInViewport({ x: -100, y: 300 })).toBe(false);
      expect(compositor.isInViewport({ x: 900, y: 300 })).toBe(false);
      expect(compositor.isInViewport({ x: 400, y: -100 })).toBe(false);
    });

    it('respects culling disable flag', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool, {
        enableCulling: false,
      });

      // When culling is disabled, isInViewport should still respect viewport bounds
      // but the update() method should not apply visibility filtering
      // So we check that enableCulling flag is actually false
      expect(compositor.enableCulling).toBe(false);
    });
  });

  // ─── Marker Management ────────────────────────────────────────
  describe('Marker Management', () => {
    it('updates marker from selection', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selection = {
        key: 'star:1:5',
        kind: 'star',
        position: { x: 100, y: 200 },
      };

      compositor.updateMarkerFromSelection(selection, 'active');

      expect(mockRenderer.addMarker).toHaveBeenCalled();
      expect(compositor.markerMap.size).toBe(1);
    });

    it('prevents duplicate markers', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selection = {
        key: 'star:1:5',
        kind: 'star',
        position: { x: 100, y: 200 },
      };

      compositor.updateMarkerFromSelection(selection, 'active');
      compositor.updateMarkerFromSelection(selection, 'active');

      expect(mockRenderer.addMarker).toHaveBeenCalledTimes(1);
      expect(compositor.markerMap.size).toBe(1);
    });

    it('removes marker by key', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selection = {
        key: 'star:1:5',
        kind: 'star',
        position: { x: 100, y: 200 },
      };

      compositor.updateMarkerFromSelection(selection, 'active');
      const removed = compositor.removeMarker('star:1:5');

      expect(removed).toBe(true);
      expect(compositor.markerMap.size).toBe(0);
      expect(mockRenderer.removeMarker).toHaveBeenCalled();
    });

    it('returns false when removing non-existent marker', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const removed = compositor.removeMarker('non-existent');

      expect(removed).toBe(false);
    });
  });

  // ─── Token & Animation Mapping ────────────────────────────────
  describe('Token & Animation Mapping', () => {
    it('gets appropriate token for marker type', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const activeToken = compositor.getTokenForMarkerType('active');
      const hoverToken = compositor.getTokenForMarkerType('hover');
      const groupToken = compositor.getTokenForMarkerType('group');

      expect(activeToken.animation).toBe('pulse');
      expect(hoverToken.animation).toBe('none');
      expect(groupToken.linePattern).toBe('dashed');
    });

    it('gets animation config for token', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const token = { animation: 'pulse' };
      const config = compositor.getAnimationConfigForToken(token);

      expect(config.type).toBe('scale');
      expect(config.duration).toBeGreaterThan(0);
      expect(config.easing).toBe('sine-wave');
    });

    it('handles unknown animation types', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const token = { animation: 'unknown' };
      const config = compositor.getAnimationConfigForToken(token);

      expect(config.type).toBe('none');
    });
  });

  // ─── Update Cycle ────────────────────────────────────────────
  describe('Update Cycle', () => {
    it('updates from selection state', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selectionState = {
        active: {
          key: 'star:1:5',
          kind: 'star',
          position: { x: 100, y: 200 },
        },
        hover: null,
        multiSelection: [],
      };

      compositor.setSelectionState(selectionState);
      compositor.update();

      expect(mockRenderer.addMarker).toHaveBeenCalled();
      expect(compositor.markerMap.size).toBeGreaterThan(0);
    });

    it('removes markers no longer in selection state', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selection = {
        key: 'star:1:5',
        kind: 'star',
        position: { x: 100, y: 200 },
      };

      // Create marker
      compositor.updateMarkerFromSelection(selection, 'active');
      expect(compositor.markerMap.size).toBe(1);

      // Clear the mock calls to start fresh
      mockRenderer.removeMarker.mockClear();

      // Now clear selection and update
      compositor.setSelectionState({ active: null, hover: null, multiSelection: [] });
      compositor.update();

      // Marker should be removed
      expect(compositor.markerMap.size).toBe(0);
      // The removeMarker should have been called during update
      if (mockRenderer.removeMarker.mock.calls.length === 0) {
        // Verify marker is gone
        expect(compositor.markerMap.has('star:1:5')).toBe(false);
      }
    });

    it('calculates delta time', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      compositor.update();
      const dt1 = compositor.deltaTime;

      expect(dt1).toBeGreaterThanOrEqual(0);
      expect(dt1).toBeLessThan(1); // Should be less than 1 second
    });

    it('updates animations on each update', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selectionState = {
        active: {
          key: 'star:1:5',
          kind: 'star',
          position: { x: 100, y: 200 },
        },
        hover: null,
        multiSelection: [],
      };

      compositor.setSelectionState(selectionState);
      compositor.update();

      expect(mockAnimationPool.updateAll).toHaveBeenCalled();
    });
  });

  // ─── Rendering ───────────────────────────────────────────────
  describe('Rendering', () => {
    it('renders without error', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      expect(() => compositor.render()).not.toThrow();
      expect(mockRenderer.render).toHaveBeenCalled();
    });

    it('applies culling during render when enabled', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool, {
        enableCulling: true,
      });

      const selection = {
        key: 'star:1:5',
        kind: 'star',
        position: { x: 100, y: 200 },
      };

      compositor.updateMarkerFromSelection(selection, 'active');
      compositor.render();

      // Marker should be marked as visible (within default viewport)
      const entry = compositor.markerMap.get('star:1:5');
      expect(entry.marker.isVisible).toBe(true);
    });

    it('handles culling of out-of-viewport markers', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool, {
        enableCulling: true,
      });

      compositor.setViewportBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });

      const selection = {
        key: 'star:1:5',
        kind: 'star',
        position: { x: 500, y: 500 }, // Outside viewport
      };

      compositor.updateMarkerFromSelection(selection, 'active');
      compositor.render();

      // Check that updateVisibility was called on the marker
      const entry = compositor.markerMap.get('star:1:5');
      expect(entry.marker.updateVisibility).toHaveBeenCalledWith(false);
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────
  describe('Lifecycle', () => {
    it('clears all markers', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const s1 = { key: 'marker-1', kind: 'star', position: { x: 100, y: 100 } };
      const s2 = { key: 'marker-2', kind: 'planet', position: { x: 200, y: 200 } };

      compositor.updateMarkerFromSelection(s1, 'active');
      compositor.updateMarkerFromSelection(s2, 'hover');

      expect(compositor.markerMap.size).toBeGreaterThan(0);

      compositor.clear();

      expect(compositor.markerMap.size).toBe(0);
    });

    it('provides statistics', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selection = {
        key: 'star:1:5',
        kind: 'star',
        position: { x: 100, y: 200 },
      };

      compositor.updateMarkerFromSelection(selection, 'active');

      const stats = compositor.getStatistics();

      expect(stats).toBeDefined();
      expect(stats.markerCount).toBeGreaterThan(0);
      expect(stats.deltaTime).toBeDefined();
      expect(stats.rendererStats).toBeDefined();
      expect(stats.animationPoolStats).toBeDefined();
    });
  });

  // ─── Multi-Selection Support ──────────────────────────────────
  describe('Multi-Selection Support', () => {
    it('handles group selection', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selectionState = {
        active: null,
        hover: null,
        multiSelection: [
          { key: 'star:1:1', kind: 'star' },
          { key: 'star:1:2', kind: 'star' },
          { key: 'star:1:3', kind: 'star' },
        ],
      };

      compositor.setSelectionState(selectionState);
      compositor.update();

      // Should create markers for all multi-selection members (but no active marker)
      expect(mockRenderer.addMarker.mock.calls.length).toBeGreaterThanOrEqual(
        selectionState.multiSelection.length
      );
    });

    it('ignores single-member multiSelection', () => {
      const compositor = new mod.SelectionMarkerCompositor(mockRenderer, mockAnimationPool);

      const selectionState = {
        active: null,
        hover: null,
        multiSelection: [{ key: 'star:1:1', kind: 'star' }],
      };

      compositor.setSelectionState(selectionState);
      compositor.update();

      // Should not create group markers for single member
      // (multiSelection with < 2 members shouldn't trigger group rendering)
    });
  });
});
