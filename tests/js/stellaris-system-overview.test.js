/**
 * stellaris-system-overview.test.js
 *
 * Unit tests for StellarisSystemOverview and its helper functions.
 *
 * Tests cover:
 *  • spectralToRgb() — spectral-class colour mapping
 *  • planetClassToRgb() — planet-class colour mapping
 *  • hexToRgbFloat() — hex-to-float RGB conversion (string + integer)
 *  • buildBodyShader() — WGSL string generation
 *  • StellarisSystemOverview construction
 *  • updateBodies() — DOM card creation, body parsing (star/planet/moon)
 *  • setFocusedBody() — focus class toggling
 *  • hide() — removes sso-visible
 *  • destroy() — clears container and stops RAF
 *  • Graceful no-op when container not found
 *  • Graceful no-op when WebGPU unavailable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const {
  StellarisSystemOverview,
  spectralToRgb,
  planetClassToRgb,
  hexToRgbFloat,
  buildBodyShader,
} = require(path.join(root, 'js/ui/stellaris-system-overview.js'));

// ---------------------------------------------------------------------------
// Minimal DOM helpers (no jsdom dependency)
// ---------------------------------------------------------------------------

function makeElement(tag, id = '') {
  const attrs   = {};
  const classes = new Set();
  const children = [];
  let innerHTML = '';
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: '',
    style: {},
    _attrs: attrs,
    _classes: classes,
    children: [],
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v); },
    addEventListener: () => {},
    classList: {
      add:    (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) force = !classes.has(c);
        if (force) classes.add(c); else classes.delete(c);
      },
      contains: (c) => classes.has(c),
    },
    get innerHTML() { return innerHTML; },
    set innerHTML(v) {
      innerHTML = v;
      children.length = 0;
    },
    appendChild: (child) => { children.push(child); return child; },
    querySelectorAll: (sel) => {
      const out = [];
      const attr = sel.match(/\[([^\]]+)\]/)?.[1];
      const dotClass = sel.match(/\.([^\s.\[]+)/)?.[1];
      function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (attr && node._attrs?.[attr] !== undefined) out.push(node);
        if (dotClass && node._classes?.has(dotClass)) out.push(node);
        (node.children || []).forEach(walk);
      }
      walk(el);
      return out;
    },
  };
  return el;
}

function makeDocument(container) {
  const elements = {};
  if (container) elements[container.id] = container;

  return {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => elements[id] || null,
    _register: (el) => { elements[el.id] = el; },
  };
}

function makeWindow(overrides = {}) {
  let rafCb = null;
  return {
    requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
    cancelAnimationFrame: () => { rafCb = null; },
    dispatchEvent: () => {},
    CustomEvent: class CustomEvent {
      constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
    },
    _triggerRaf: (ts = 16) => { if (rafCb) rafCb(ts); },
    navigator: overrides.navigator || {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// spectralToRgb
// ---------------------------------------------------------------------------

describe('spectralToRgb', () => {
  it('O class → blueish', () => {
    const [r, g, b] = spectralToRgb('O');
    expect(b).toBeGreaterThan(r);
  });

  it('M class → warm / reddish', () => {
    const [r, , b] = spectralToRgb('M');
    expect(r).toBeGreaterThan(b);
  });

  it('G class (sol-like) → warm white', () => {
    const [r, g] = spectralToRgb('G');
    expect(r).toBeCloseTo(1.0, 2);
    expect(g).toBeGreaterThan(0.9);
  });

  it('unknown class → fallback (defined array)', () => {
    const rgb = spectralToRgb('X');
    expect(Array.isArray(rgb)).toBe(true);
    expect(rgb).toHaveLength(3);
  });

  it('accepts lowercase input', () => {
    const upper = spectralToRgb('K');
    const lower = spectralToRgb('k');
    expect(upper).toEqual(lower);
  });
});

// ---------------------------------------------------------------------------
// planetClassToRgb
// ---------------------------------------------------------------------------

describe('planetClassToRgb', () => {
  it('gas giant → brownish', () => {
    const [r, , b] = planetClassToRgb('Gas Giant');
    expect(r).toBeGreaterThan(0.7);
    expect(b).toBeLessThan(0.6);
  });

  it('ocean world → blue', () => {
    const [r, , b] = planetClassToRgb('ocean world');
    expect(b).toBeGreaterThan(r);
  });

  it('lava planet → warm', () => {
    const [r, , b] = planetClassToRgb('lava');
    expect(r).toBeGreaterThan(b);
  });

  it('terra planet → greenish', () => {
    const [, g, b] = planetClassToRgb('terraform');
    expect(g).toBeGreaterThan(b);
  });

  it('empty string → fallback array of length 3', () => {
    const rgb = planetClassToRgb('');
    expect(rgb).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// hexToRgbFloat
// ---------------------------------------------------------------------------

describe('hexToRgbFloat', () => {
  it('parses "#ff8000"', () => {
    const [r, g, b] = hexToRgbFloat('#ff8000');
    expect(r).toBeCloseTo(1.0, 3);
    expect(g).toBeCloseTo(0.502, 2);
    expect(b).toBeCloseTo(0.0, 3);
  });

  it('parses "ff8000" (no hash)', () => {
    const [r] = hexToRgbFloat('ff8000');
    expect(r).toBeCloseTo(1.0, 3);
  });

  it('parses integer 0xff8000', () => {
    const [r, g, b] = hexToRgbFloat(0xff8000);
    expect(r).toBeCloseTo(1.0, 3);
    expect(g).toBeCloseTo(0.502, 2);
    expect(b).toBeCloseTo(0.0, 3);
  });

  it('returns fallback for invalid string', () => {
    const rgb = hexToRgbFloat('not-a-color');
    expect(rgb).toHaveLength(3);
    rgb.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });

  it('parses "#ffffff" → [1,1,1]', () => {
    const [r, g, b] = hexToRgbFloat('#ffffff');
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(1, 3);
  });
});

// ---------------------------------------------------------------------------
// buildBodyShader
// ---------------------------------------------------------------------------

describe('buildBodyShader', () => {
  it('returns non-empty WGSL string', () => {
    const src = buildBodyShader('planet', [0.3, 0.5, 0.8], [0.5, 0.7, 1.0]);
    expect(typeof src).toBe('string');
    expect(src.length).toBeGreaterThan(200);
  });

  it('contains @vertex and @fragment', () => {
    const src = buildBodyShader('moon', [0.5, 0.5, 0.5], [0.6, 0.6, 0.65]);
    expect(src).toContain('@vertex');
    expect(src).toContain('@fragment');
  });

  it('star shader embeds pulse logic', () => {
    const src = buildBodyShader('star', [1.0, 0.9, 0.7], [1.0, 0.95, 0.8]);
    expect(src).toContain('pulse');
  });

  it('planet shader embeds fresnel diffuse (no pulse)', () => {
    const src = buildBodyShader('planet', [0.3, 0.5, 0.8], [0.5, 0.7, 1.0]);
    expect(src).toContain('fresnel');
    expect(src).not.toContain('pulse');
  });

  it('embeds base colour values', () => {
    const src = buildBodyShader('planet', [0.25, 0.50, 0.75], [0.6, 0.7, 0.8]);
    expect(src).toContain('0.2500');
    expect(src).toContain('0.5000');
    expect(src).toContain('0.7500');
  });
});

// ---------------------------------------------------------------------------
// StellarisSystemOverview — construction
// ---------------------------------------------------------------------------

describe('StellarisSystemOverview — construction', () => {
  it('can be instantiated with a container id', () => {
    const sso = new StellarisSystemOverview('test-container');
    expect(sso).toBeDefined();
    expect(sso._containerId).toBe('test-container');
  });

  it('_device is null before init()', () => {
    const sso = new StellarisSystemOverview('x');
    expect(sso._device).toBeNull();
  });

  it('_entries is empty before updateBodies()', () => {
    const sso = new StellarisSystemOverview('x');
    expect(sso._entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// StellarisSystemOverview — init() without WebGPU
// ---------------------------------------------------------------------------

describe('StellarisSystemOverview — init() without WebGPU', () => {
  it('resolves without throwing when navigator.gpu is absent', async () => {
    const win = makeWindow({ navigator: {} });
    const sso = new StellarisSystemOverview('c', { windowRef: win });
    await expect(sso.init()).resolves.toBeUndefined();
    expect(sso._device).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StellarisSystemOverview — updateBodies() DOM
// ---------------------------------------------------------------------------

function makeSso(containerEl) {
  const doc = makeDocument(containerEl);
  const win = makeWindow({ navigator: {} });
  return new StellarisSystemOverview(containerEl.id, { documentRef: doc, windowRef: win });
}

describe('StellarisSystemOverview — updateBodies()', () => {
  let container;
  let sso;

  beforeEach(() => {
    container = makeElement('div', 'sso-test');
    sso = makeSso(container);
  });

  afterEach(() => {
    sso.destroy();
  });

  it('null payload clears entries and empties container', () => {
    sso.updateBodies(null, null);
    expect(sso._entries).toHaveLength(0);
  });

  it('payload with star creates one star entry', () => {
    sso.updateBodies({ star_system: { name: 'Sol', spectral_class: 'G' }, planets: [] }, null);
    const star = sso._entries.find((e) => e.kind === 'star');
    expect(star).toBeDefined();
    expect(star.name).toBe('Sol');
    expect(star.spectralClass).toBe('G');
  });

  it('payload with one planet creates one planet entry', () => {
    sso.updateBodies({
      star_system: { name: 'Sol', spectral_class: 'G' },
      planets: [
        { position: 1, generated_planet: { name: 'Terra', planet_class: 'terraform', moons: [] } },
      ],
    }, null);
    const planet = sso._entries.find((e) => e.kind === 'planet');
    expect(planet).toBeDefined();
    expect(planet.name).toBe('Terra');
    expect(planet.planetClass).toBe('terraform');
  });

  it('moon entries are created for each moon in planet payload', () => {
    sso.updateBodies({
      planets: [
        {
          position: 2,
          generated_planet: {
            name: 'Gaia',
            planet_class: 'ocean',
            moons: [
              { name: 'Luna', planet_class: 'barren' },
              { name: 'Selene', planet_class: 'barren' },
            ],
          },
        },
      ],
    }, null);
    const moons = sso._entries.filter((e) => e.kind === 'moon');
    expect(moons).toHaveLength(2);
    expect(moons[0].name).toBe('Luna');
    expect(moons[1].name).toBe('Selene');
  });

  it('auto-names moons when name is absent', () => {
    sso.updateBodies({
      planets: [
        {
          position: 3,
          generated_planet: {
            name: 'Eos',
            planet_class: 'desert',
            moons: [{}, {}],
          },
        },
      ],
    }, null);
    const moons = sso._entries.filter((e) => e.kind === 'moon');
    expect(moons[0].name).toBe('Eos a');
    expect(moons[1].name).toBe('Eos b');
  });

  it('container gets sso-visible class after updateBodies()', () => {
    sso.updateBodies({ star_system: { name: 'X', spectral_class: 'M' }, planets: [] }, null);
    expect(container._classes.has('sso-visible')).toBe(true);
  });

  it('each entry receives a canvas element', () => {
    sso.updateBodies({
      star_system: { name: 'Y', spectral_class: 'K' },
      planets: [
        { position: 1, generated_planet: { name: 'P1', planet_class: 'barren', moons: [] } },
      ],
    }, null);
    sso._entries.forEach((e) => {
      expect(e.canvas).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// StellarisSystemOverview — setFocusedBody()
// ---------------------------------------------------------------------------

describe('StellarisSystemOverview — setFocusedBody()', () => {
  it('sets _currentFocusedId', () => {
    const container = makeElement('div', 'sso-f');
    const sso = makeSso(container);
    sso.updateBodies({ star_system: { name: 'Sol', spectral_class: 'G' }, planets: [] }, null);
    sso.setFocusedBody('star');
    expect(sso._currentFocusedId).toBe('star');
    sso.destroy();
  });
});

// ---------------------------------------------------------------------------
// StellarisSystemOverview — hide()
// ---------------------------------------------------------------------------

describe('StellarisSystemOverview — hide()', () => {
  it('removes sso-visible from the container', () => {
    const container = makeElement('div', 'sso-h');
    const sso = makeSso(container);
    sso.updateBodies({ star_system: { name: 'Sol', spectral_class: 'G' }, planets: [] }, null);
    expect(container._classes.has('sso-visible')).toBe(true);
    sso.hide();
    expect(container._classes.has('sso-visible')).toBe(false);
    sso.destroy();
  });
});

// ---------------------------------------------------------------------------
// StellarisSystemOverview — destroy()
// ---------------------------------------------------------------------------

describe('StellarisSystemOverview — destroy()', () => {
  it('clears all entries', () => {
    const container = makeElement('div', 'sso-d');
    const sso = makeSso(container);
    sso.updateBodies({ star_system: { name: 'Sol', spectral_class: 'G' }, planets: [] }, null);
    sso.destroy();
    expect(sso._entries).toHaveLength(0);
  });

  it('stops the RAF loop (_rafId becomes null)', () => {
    const container = makeElement('div', 'sso-raf');
    const sso = makeSso(container);
    sso._startRaf();
    expect(sso._rafId).not.toBeNull();
    sso.destroy();
    expect(sso._rafId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StellarisSystemOverview — no container graceful no-op
// ---------------------------------------------------------------------------

describe('StellarisSystemOverview — missing container', () => {
  it('updateBodies() does not throw when container not in DOM', () => {
    const doc = makeDocument(null); // no container registered
    const win = makeWindow({ navigator: {} });
    const sso = new StellarisSystemOverview('nonexistent', { documentRef: doc, windowRef: win });
    expect(() => sso.updateBodies({ star_system: { name: 'X' }, planets: [] }, null)).not.toThrow();
  });
});
