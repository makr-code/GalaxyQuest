/**
 * system-bodies-card-window.test.js
 *
 * Unit tests for SystemBodiesCardWindow.
 *
 * Tests cover:
 *  • Construction
 *  • init() — finds grid and count elements by id
 *  • updateBodies() — null payload clears entries
 *  • updateBodies() — star entry created
 *  • updateBodies() — planet and moon entries created
 *  • updateBodies() — auto-names moons
 *  • _renderCards() — card DOM nodes appended to grid
 *  • clear() — empties grid
 *  • destroy() — nulls references
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { SystemBodiesCardWindow } =
  require(path.join(root, 'js/ui/system-bodies-card-window.js'));

// ---------------------------------------------------------------------------
// Minimal DOM mocks
// ---------------------------------------------------------------------------

function makeElement(tag, id = '') {
  const attrs   = {};
  const classes = new Set();
  const children = [];
  let innerHTML = '';
  const el = {
    tagName: tag.toUpperCase(),
    id,
    style: {},
    _attrs: attrs,
    _classes: classes,
    children,
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v); },
    addEventListener: () => {},
    get innerHTML() { return innerHTML; },
    set innerHTML(v) { innerHTML = v; children.length = 0; },
    appendChild: (child) => { children.push(child); return child; },
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: {
      add:      (...cs) => cs.forEach((c) => classes.add(c)),
      remove:   (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle:   (c, f) => { if (f === undefined) f = !classes.has(c); if (f) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
  };
  return el;
}

function makeDocument(elements = {}) {
  const registry = {};
  Object.entries(elements).forEach(([id, el]) => { registry[id] = el; });
  return {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => registry[id] || null,
    _register: (id, el) => { registry[id] = el; },
  };
}

function makeWindow(overrides = {}) {
  return { ...overrides };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSbcw(winId = 'system-bodies-cards') {
  const grid  = makeElement('div', `${winId}-grid`);
  const count = makeElement('span', `${winId}-count`);
  const doc   = makeDocument({ [`${winId}-grid`]: grid, [`${winId}-count`]: count });
  const win   = makeWindow({ WM: { open: () => {}, close: () => {} } });
  const sbcw  = new SystemBodiesCardWindow(winId, { documentRef: doc, windowRef: win });
  sbcw.init();
  return { sbcw, grid, count, doc };
}

const SOL_PAYLOAD = {
  star_system: { name: 'Sol', spectral_class: 'G' },
  planets: [
    {
      position: 3,
      generated_planet: {
        name: 'Terra',
        planet_class: 'terraform',
        moons: [
          { name: 'Luna', planet_class: 'barren' },
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('SystemBodiesCardWindow — construction', () => {
  it('stores the winId', () => {
    const sbcw = new SystemBodiesCardWindow('my-win');
    expect(sbcw._winId).toBe('my-win');
  });

  it('defaults _entries to []', () => {
    const sbcw = new SystemBodiesCardWindow('x');
    expect(sbcw._entries).toHaveLength(0);
  });

  it('_gridEl and _countEl are null before init()', () => {
    const sbcw = new SystemBodiesCardWindow('x');
    expect(sbcw._gridEl).toBeNull();
    expect(sbcw._countEl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

describe('SystemBodiesCardWindow — init()', () => {
  it('resolves _gridEl from document', () => {
    const { sbcw, grid } = makeSbcw();
    expect(sbcw._gridEl).toBe(grid);
  });

  it('resolves _countEl from document', () => {
    const { sbcw, count } = makeSbcw();
    expect(sbcw._countEl).toBe(count);
  });

  it('graceful no-op when document is null', () => {
    const sbcw = new SystemBodiesCardWindow('x', { documentRef: null });
    expect(() => sbcw.init()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateBodies() — entry parsing
// ---------------------------------------------------------------------------

describe('SystemBodiesCardWindow — updateBodies() entry parsing', () => {
  it('null payload → 0 entries', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies(null, null);
    expect(sbcw._entries).toHaveLength(0);
  });

  it('star entry created', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    const star = sbcw._entries.find((e) => e.kind === 'star');
    expect(star).toBeDefined();
    expect(star.name).toBe('Sol');
    expect(star.spectralClass).toBe('G');
  });

  it('planet entry created', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    const planet = sbcw._entries.find((e) => e.kind === 'planet');
    expect(planet).toBeDefined();
    expect(planet.name).toBe('Terra');
    expect(planet.planetClass).toBe('terraform');
  });

  it('moon entry created', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    const moon = sbcw._entries.find((e) => e.kind === 'moon');
    expect(moon).toBeDefined();
    expect(moon.name).toBe('Luna');
  });

  it('total entries: 1 star + 1 planet + 1 moon = 3', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    expect(sbcw._entries).toHaveLength(3);
  });

  it('auto-names moons when name absent', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies({
      planets: [{
        position: 1,
        generated_planet: {
          name: 'Eos',
          planet_class: 'desert',
          moons: [{}, {}],
        },
      }],
    }, null);
    const moons = sbcw._entries.filter((e) => e.kind === 'moon');
    expect(moons[0].name).toBe('Eos a');
    expect(moons[1].name).toBe('Eos b');
  });

  it('ownerColor stored on planet entry', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies({
      planets: [{
        position: 1,
        generated_planet: { name: 'P', planet_class: 'ocean', moons: [], owner_color: '#ff0000' },
      }],
    }, null);
    const planet = sbcw._entries.find((e) => e.kind === 'planet');
    expect(planet.ownerColor).toBe('#ff0000');
  });

  it('handles missing planets array gracefully', () => {
    const { sbcw } = makeSbcw();
    expect(() => sbcw.updateBodies({ star_system: { name: 'X' } }, null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateBodies() — DOM rendering
// ---------------------------------------------------------------------------

describe('SystemBodiesCardWindow — updateBodies() DOM', () => {
  it('appends one card per entry to grid', () => {
    const { sbcw, grid } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    // 3 entries → 3 children in the grid mock
    expect(grid.children).toHaveLength(3);
  });

  it('count element receives non-empty text for >0 entries', () => {
    const { sbcw, count } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    expect(String(count.textContent || '')).toContain('3');
  });

  it('null payload → count text is empty', () => {
    const { sbcw, count } = makeSbcw();
    sbcw.updateBodies(null, null);
    expect(count.textContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe('SystemBodiesCardWindow — clear()', () => {
  it('resets entries array', () => {
    const { sbcw } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    sbcw.clear();
    expect(sbcw._entries).toHaveLength(0);
  });

  it('clears the grid innerHTML', () => {
    const { sbcw, grid } = makeSbcw();
    sbcw.updateBodies(SOL_PAYLOAD, null);
    sbcw.clear();
    expect(grid.innerHTML).toBe('');
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('SystemBodiesCardWindow — destroy()', () => {
  it('nulls _gridEl', () => {
    const { sbcw } = makeSbcw();
    sbcw.destroy();
    expect(sbcw._gridEl).toBeNull();
  });

  it('nulls _countEl', () => {
    const { sbcw } = makeSbcw();
    sbcw.destroy();
    expect(sbcw._countEl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// open() / close() — graceful no-op when WM absent
// ---------------------------------------------------------------------------

describe('SystemBodiesCardWindow — open/close without WM', () => {
  it('open() does not throw when WM is absent', () => {
    const doc  = makeDocument({});
    const sbcw = new SystemBodiesCardWindow('x', { documentRef: doc, windowRef: {} });
    expect(() => sbcw.open()).not.toThrow();
  });

  it('close() does not throw when WM is absent', () => {
    const doc  = makeDocument({});
    const sbcw = new SystemBodiesCardWindow('x', { documentRef: doc, windowRef: {} });
    expect(() => sbcw.close()).not.toThrow();
  });
});
