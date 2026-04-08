/**
 * galaxy-territory-layer.test.js
 *
 * Unit tests for GalaxyTerritoryLayer.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'js/engine/runtime/GalaxyTerritoryLayer.js'),
  'utf8'
);

function loadModule() {
  delete window.GQGalaxyTerritoryLayer;
  window.eval(src);
  return window.GQGalaxyTerritoryLayer;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStar(overrides = {}) {
  return Object.assign({
    galaxy_index: 1,
    system_index: 10,
    x_ly: 100,
    y_ly: 200,
    colony_count: 2,
    colony_population: 500000,
    colony_owner_user_id: 42,
    colony_owner_color: '#3399ff',
    colony_owner_name: 'TestPlayer',
    colony_is_player: 1,
  }, overrides);
}

function makeMinimapState() {
  return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, scale: 0.3, offX: 10, offY: 10, width: 320, height: 320 };
}

function projectPoint(state, x, y) {
  return {
    x: state.offX + (x - state.minX) * state.scale,
    y: state.offY + (y - state.minY) * state.scale,
  };
}

// ── _hexToRgb ──────────────────────────────────────────────────────────────

describe('GalaxyTerritoryLayer._hexToRgb', () => {
  let api;
  beforeEach(() => { api = loadModule(); });

  it('parses 6-char hex', () => {
    expect(api._hexToRgb('#3399ff')).toEqual({ r: 0x33, g: 0x99, b: 0xff });
  });

  it('parses 3-char hex', () => {
    expect(api._hexToRgb('#39f')).toEqual({ r: 0x33, g: 0x99, b: 0xff });
  });

  it('returns null for invalid input', () => {
    expect(api._hexToRgb('notacolor')).toBeNull();
    expect(api._hexToRgb('')).toBeNull();
    expect(api._hexToRgb(null)).toBeNull();
  });
});

// ── _resolveColor ──────────────────────────────────────────────────────────

describe('GalaxyTerritoryLayer._resolveColor', () => {
  let api;
  beforeEach(() => { api = loadModule(); });

  it('passes through a valid hex color', () => {
    expect(api._resolveColor('#aabbcc', 'uid:1')).toBe('#aabbcc');
  });

  it('generates a deterministic color from key when raw color is invalid', () => {
    const c1 = api._resolveColor('', 'uid:42');
    const c2 = api._resolveColor('', 'uid:42');
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('generates different colors for different keys', () => {
    const c1 = api._resolveColor('', 'uid:1');
    const c2 = api._resolveColor('', 'uid:2');
    expect(c1).not.toBe(c2);
  });
});

// ── _systemRadius ──────────────────────────────────────────────────────────

describe('GalaxyTerritoryLayer._systemRadius', () => {
  let api;
  beforeEach(() => { api = loadModule(); });

  it('returns a positive number', () => {
    const r = api._systemRadius(1, 0, 0.3);
    expect(r).toBeGreaterThan(0);
  });

  it('grows with more colonies', () => {
    const r1 = api._systemRadius(1, 0, 0.3);
    const r5 = api._systemRadius(5, 0, 0.3);
    expect(r5).toBeGreaterThan(r1);
  });

  it('grows with larger population', () => {
    const rLow  = api._systemRadius(1, 100,       0.3);
    const rHigh = api._systemRadius(1, 10_000_000, 0.3);
    expect(rHigh).toBeGreaterThan(rLow);
  });

  it('is finite for extreme inputs', () => {
    expect(Number.isFinite(api._systemRadius(0,   0,         0))).toBe(true);
    expect(Number.isFinite(api._systemRadius(999, 1e12, 10))).toBe(true);
  });
});

// ── buildTerritoryGroups ───────────────────────────────────────────────────

describe('GalaxyTerritoryLayer.buildTerritoryGroups', () => {
  let api;
  beforeEach(() => { api = loadModule(); });

  it('returns empty map for no stars', () => {
    const groups = api.buildTerritoryGroups([], makeMinimapState(), projectPoint);
    expect(groups.size).toBe(0);
  });

  it('returns empty map when minimapState is null', () => {
    const groups = api.buildTerritoryGroups([makeStar()], null, projectPoint);
    expect(groups.size).toBe(0);
  });

  it('ignores stars without colonies', () => {
    const star = makeStar({ colony_count: 0 });
    const groups = api.buildTerritoryGroups([star], makeMinimapState(), projectPoint);
    expect(groups.size).toBe(0);
  });

  it('creates one group per unique owner', () => {
    const stars = [
      makeStar({ system_index: 1, colony_owner_user_id: 1, x_ly: 100, y_ly: 100 }),
      makeStar({ system_index: 2, colony_owner_user_id: 1, x_ly: 200, y_ly: 200 }),
      makeStar({ system_index: 3, colony_owner_user_id: 2, colony_owner_color: '#ff0000', x_ly: 300, y_ly: 300 }),
    ];
    const groups = api.buildTerritoryGroups(stars, makeMinimapState(), projectPoint);
    expect(groups.size).toBe(2);
  });

  it('puts two same-owner systems in the same group', () => {
    const stars = [
      makeStar({ system_index: 1, colony_owner_user_id: 5, x_ly: 10, y_ly: 10 }),
      makeStar({ system_index: 2, colony_owner_user_id: 5, x_ly: 20, y_ly: 20 }),
    ];
    const groups = api.buildTerritoryGroups(stars, makeMinimapState(), projectPoint);
    expect(groups.size).toBe(1);
    const [group] = groups.values();
    expect(group.systems).toHaveLength(2);
  });

  it('marks player group with isPlayer=true', () => {
    const star = makeStar({ colony_is_player: 1 });
    const groups = api.buildTerritoryGroups([star], makeMinimapState(), projectPoint);
    const [group] = groups.values();
    expect(group.isPlayer).toBe(true);
  });

  it('group color is valid hex', () => {
    const star = makeStar({ colony_owner_color: '#3399ff' });
    const groups = api.buildTerritoryGroups([star], makeMinimapState(), projectPoint);
    const [group] = groups.values();
    expect(group.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it('each system entry has cx, cy, r properties', () => {
    const star = makeStar();
    const groups = api.buildTerritoryGroups([star], makeMinimapState(), projectPoint);
    const [group] = groups.values();
    const sys = group.systems[0];
    expect(typeof sys.cx).toBe('number');
    expect(typeof sys.cy).toBe('number');
    expect(typeof sys.r).toBe('number');
    expect(sys.r).toBeGreaterThan(0);
  });

  it('falls back to color string as key when user_id is 0', () => {
    const star = makeStar({ colony_owner_user_id: 0, colony_owner_color: '#abcdef' });
    const groups = api.buildTerritoryGroups([star], makeMinimapState(), projectPoint);
    expect(groups.size).toBe(1);
  });
});

// ── drawTerritoryLayer / drawTerritoryBorders ──────────────────────────────

describe('GalaxyTerritoryLayer.drawTerritoryLayer / drawTerritoryBorders', () => {
  let api;
  beforeEach(() => { api = loadModule(); });

  function makeCtx() {
    const calls = [];
    return {
      calls,
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
    };
  }

  it('drawTerritoryLayer does nothing for empty groups', () => {
    const ctx = makeCtx();
    api.drawTerritoryLayer(ctx, new Map(), makeMinimapState());
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('drawTerritoryLayer calls arc for each system', () => {
    const star1 = makeStar({ system_index: 1, x_ly: 100, y_ly: 100 });
    const star2 = makeStar({ system_index: 2, x_ly: 200, y_ly: 200 });
    const state = makeMinimapState();
    const groups = api.buildTerritoryGroups([star1, star2], state, projectPoint);
    const ctx = makeCtx();
    api.drawTerritoryLayer(ctx, groups, state);
    // 2 systems → 2 arc calls (one per fill)
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it('drawTerritoryBorders calls arc for each system', () => {
    const star = makeStar();
    const state = makeMinimapState();
    const groups = api.buildTerritoryGroups([star], state, projectPoint);
    const ctx = makeCtx();
    api.drawTerritoryBorders(ctx, groups, state);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('drawTerritoryBorders does nothing for null ctx', () => {
    // Should not throw
    expect(() => api.drawTerritoryBorders(null, new Map(), makeMinimapState())).not.toThrow();
  });

  it('drawTerritoryLayer does nothing for null ctx', () => {
    expect(() => api.drawTerritoryLayer(null, new Map(), makeMinimapState())).not.toThrow();
  });
});

// ── drawTerritoryLegend ────────────────────────────────────────────────────

describe('GalaxyTerritoryLayer.drawTerritoryLegend', () => {
  let api;
  beforeEach(() => { api = loadModule(); });

  it('does nothing for empty groups', () => {
    const ctx = {
      save: vi.fn(), restore: vi.fn(),
      fillRect: vi.fn(), fillText: vi.fn(),
      fillStyle: '', font: '', textBaseline: '', textAlign: '',
    };
    api.drawTerritoryLegend(ctx, new Map(), 320, 320);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('draws swatches for each entry', () => {
    const stars = [
      makeStar({ system_index: 1, colony_owner_user_id: 1, colony_is_player: 1 }),
      makeStar({ system_index: 2, colony_owner_user_id: 2, colony_is_player: 0, colony_owner_color: '#ff0000', colony_owner_name: 'Enemy' }),
    ];
    const state = makeMinimapState();
    const groups = api.buildTerritoryGroups(stars, state, projectPoint);
    const ctx = {
      save: vi.fn(), restore: vi.fn(),
      fillRect: vi.fn(), fillText: vi.fn(),
      fillStyle: '', font: '', textBaseline: '', textAlign: '',
    };
    api.drawTerritoryLegend(ctx, groups, 320, 320);
    // 2 groups → 2 swatches + 2 text labels
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('player entry appears first (label "Du")', () => {
    const stars = [
      makeStar({ system_index: 1, colony_owner_user_id: 99, colony_is_player: 0, colony_owner_name: 'Alien', colony_owner_color: '#ff0000' }),
      makeStar({ system_index: 2, colony_owner_user_id: 1,  colony_is_player: 1 }),
    ];
    const state = makeMinimapState();
    const groups = api.buildTerritoryGroups(stars, state, projectPoint);
    const texts = [];
    const ctx = {
      save: vi.fn(), restore: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn((...args) => texts.push(args[0])),
      fillStyle: '', font: '', textBaseline: '', textAlign: '',
    };
    api.drawTerritoryLegend(ctx, groups, 320, 320);
    expect(texts[0]).toBe('Du');
  });
});
