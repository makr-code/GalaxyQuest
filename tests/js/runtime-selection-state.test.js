/**
 * tests/js/runtime-selection-state.test.js
 *
 * Unit tests for RuntimeSelectionState.js — Selection Unification Phase 1.
 * Covers: createSelectionStore, buildSelectionKey, normalizeRendererSelection,
 * commitSelectionState (hover + active), resolveSelectionGroupMembers,
 * getSelectionGroupHighlightedSystems.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(
  process.cwd(),
  'js/engine/runtime/RuntimeSelectionState.js'
);

function loadModule() {
  delete window.GQRuntimeSelectionState;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeSelectionState;
}

describe('RuntimeSelectionState', () => {
  let mod;

  beforeEach(() => {
    mod = loadModule();
  });

  // ── createSelectionStore ──────────────────────────────────────────────────
  describe('createSelectionStore', () => {
    it('returns an object with all required fields', () => {
      const store = mod.createSelectionStore();
      expect(store).toMatchObject({
        active: null,
        hover: null,
        multiSelection: [],
        group: null,
        mode: 'galaxy',
        sourceView: 'renderer',
        updatedAt: 0,
      });
    });

    it('returns a fresh object each call (not a singleton)', () => {
      const a = mod.createSelectionStore();
      const b = mod.createSelectionStore();
      expect(a).not.toBe(b);
    });

    it('has an independent multiSelection array per store', () => {
      const a = mod.createSelectionStore();
      const b = mod.createSelectionStore();
      a.multiSelection.push({ key: 'star:1:2' });
      expect(b.multiSelection).toHaveLength(0);
    });
  });

  // ── buildSelectionKey ─────────────────────────────────────────────────────
  describe('buildSelectionKey', () => {
    it('generates a star key', () => {
      expect(mod.buildSelectionKey({ __kind: 'star', galaxy_index: 1, system_index: 42 }))
        .toBe('star:1:42');
    });

    it('generates a cluster key', () => {
      expect(mod.buildSelectionKey({ __kind: 'cluster', __clusterIndex: 7 }))
        .toBe('cluster:7');
    });

    it('generates a planet key', () => {
      const target = {
        __kind: 'planet',
        __sourceStar: { galaxy_index: 1, system_index: 5 },
        id: 3,
      };
      expect(mod.buildSelectionKey(target)).toBe('planet:1:5:3');
    });

    it('generates a fleet key', () => {
      expect(mod.buildSelectionKey({ __kind: 'galaxy_fleet', id: 99 }))
        .toBe('galaxy_fleet:99');
    });

    it('generates an ftl_node key', () => {
      expect(mod.buildSelectionKey({ __kind: 'ftl_node', id: 12 }))
        .toBe('ftl_node:12');
    });

    it('returns null for null / non-object input', () => {
      expect(mod.buildSelectionKey(null)).toBeNull();
      expect(mod.buildSelectionKey(undefined)).toBeNull();
    });
  });

  // ── normalizeRendererSelection ────────────────────────────────────────────
  describe('normalizeRendererSelection', () => {
    it('returns null key/kind when target is null', () => {
      const result = mod.normalizeRendererSelection(null, null, 'hover');
      expect(result.key).toBeNull();
      expect(result.kind).toBeNull();
    });

    it('normalizes a star target', () => {
      const target = { __kind: 'star', galaxy_index: 1, system_index: 3 };
      const result = mod.normalizeRendererSelection(target, { x: 10, y: 20 }, 'click');
      expect(result.kind).toBe('star');
      expect(result.key).toBe('star:1:3');
      expect(result.eventType).toBe('click');
      expect(result.position).toEqual({ x: 10, y: 20 });
    });

    it('ignores invalid position', () => {
      const target = { __kind: 'star', galaxy_index: 0, system_index: 0 };
      const result = mod.normalizeRendererSelection(target, { x: NaN, y: 0 }, 'hover');
      expect(result.position).toBeNull();
    });
  });

  // ── commitSelectionState ──────────────────────────────────────────────────
  describe('commitSelectionState', () => {
    let store;

    beforeEach(() => {
      store = mod.createSelectionStore();
      mod.configureSelectionRuntime({
        getIsSystemMode: () => false,
        getClusterSummary: () => [],
        getSelectionState: () => store,
        setActiveStar: () => {},
        setActiveSystem: () => {},
        applySelectionGroupHighlight: () => {},
      });
    });

    it('commits a hover event', () => {
      const target = { __kind: 'star', galaxy_index: 1, system_index: 10 };
      mod.commitSelectionState('hover', target, null, 'hover');
      expect(store.hover).not.toBeNull();
      expect(store.hover.kind).toBe('star');
      expect(store.active).toBeNull();
    });

    it('clears hover when target is null', () => {
      store.hover = { key: 'star:1:1' };
      mod.commitSelectionState('hover', null, null, 'hover');
      expect(store.hover).toBeNull();
    });

    it('commits an active selection and builds multiSelection', () => {
      const target = { __kind: 'star', galaxy_index: 1, system_index: 5 };
      mod.commitSelectionState('active', target, null, 'click');
      expect(store.active).not.toBeNull();
      expect(store.active.kind).toBe('star');
      expect(Array.isArray(store.multiSelection)).toBe(true);
      expect(store.updatedAt).toBeGreaterThan(0);
    });

    it('clears active and multiSelection when target is null', () => {
      store.active = { key: 'star:1:5' };
      store.multiSelection = [{ key: 'star:1:5' }];
      mod.commitSelectionState('active', null, null, 'click');
      expect(store.active).toBeNull();
      expect(store.multiSelection).toHaveLength(0);
    });

    it('updates mode from target', () => {
      const target = { __kind: 'star', galaxy_index: 0, system_index: 0 };
      mod.commitSelectionState('hover', target, null, 'hover');
      expect(store.mode).toBe('galaxy');
    });
  });

  // ── resolveSelectionGroupMembers ──────────────────────────────────────────
  describe('resolveSelectionGroupMembers', () => {
    it('returns a single-member group for a non-cluster target', () => {
      const normalized = { key: 'star:1:5', kind: 'star', target: {}, system: 5 };
      const result = mod.resolveSelectionGroupMembers(normalized);
      expect(result.members).toHaveLength(1);
      expect(result.group.type).toBe('single');
    });

    it('returns cluster members for a cluster target', () => {
      const clusterTarget = {
        __kind: 'cluster',
        __clusterIndex: 2,
        __clusterSystems: [3, 7, 9],
        faction: { id: 0 },
      };
      const normalized = {
        key: 'cluster:2',
        kind: 'cluster',
        target: clusterTarget,
        system: 0,
      };
      const result = mod.resolveSelectionGroupMembers(normalized);
      expect(result.members).toHaveLength(3);
      expect(result.group.type).toBe('cluster');
      expect(result.group.systems).toEqual([3, 7, 9]);
    });

    it('returns empty members for null normalized', () => {
      const result = mod.resolveSelectionGroupMembers(null);
      expect(result.members).toHaveLength(0);
      expect(result.group).toBeNull();
    });
  });

  // ── getSelectionGroupHighlightedSystems ───────────────────────────────────
  describe('getSelectionGroupHighlightedSystems', () => {
    it('returns unique system indices from group.systems', () => {
      const state = { group: { systems: [1, 2, 2, 3] } };
      expect(mod.getSelectionGroupHighlightedSystems(state)).toEqual([1, 2, 3]);
    });

    it('returns empty array when group is absent', () => {
      expect(mod.getSelectionGroupHighlightedSystems({})).toEqual([]);
      expect(mod.getSelectionGroupHighlightedSystems(null)).toEqual([]);
    });
  });
});
