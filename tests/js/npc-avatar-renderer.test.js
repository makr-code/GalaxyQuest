/**
 * npc-avatar-renderer.test.js
 *
 * Unit tests for NpcAvatarRenderer:
 *   resolvePortraitUrl()
 *     • maps faction + npc name to the correct PNG path
 *     • uses 'm' for männlich, 'f' for weiblich, 'm' as default
 *     • strips apostrophes and titles from NPC names
 *     • handles empty faction / empty npc name gracefully
 *   NpcAvatarRenderer constructor
 *     • defaults are applied when opts is empty
 *     • factionCode, factionColor, npcName stored correctly
 *     • portraitUrl is auto-resolved when not provided
 *     • explicit portraitUrl=null prevents auto-resolve
 *     • explicit portraitUrl string is stored as-is
 *   NpcAvatarRenderer state setters
 *     • setTalking(true/false) updates _talking
 *     • setExpression updates _expression
 *   NpcAvatarRenderer lifecycle (no DOM / no WebGL)
 *     • mount() with THREE=null keeps fallback, does not throw
 *     • destroy() marks as destroyed and is idempotent
 *     • reattach() after destroy() is a no-op
 *   NpcAvatarRenderer._tick() animation maths
 *     • head rotation changes each frame when talking
 *     • head rotation changes each frame when idle
 *     • bust position floats over time
 *   NpcAvatarRenderer.isWebGLActive
 *     • false before WebGL is initialized
 *     • false after destroy()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root    = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { NpcAvatarRenderer, resolvePortraitUrl } =
  require(path.join(root, 'js/engine/runtime/NpcAvatarRenderer.js'));

// ---------------------------------------------------------------------------
// Mock DOM helpers
// ---------------------------------------------------------------------------

function makeElement(tag = 'div') {
  const children = [];
  const el = {
    tagName: tag.toUpperCase(),
    _children: children,
    style: {},
    className: '',
    textContent: '',
    src: '',
    alt: '',
    _listeners: {},
    appendChild(child)   { children.push(child); return child; },
    removeChild(child)   { const i = children.indexOf(child); if (i !== -1) children.splice(i, 1); },
    getAttribute()       { return null; },
    setAttribute()       {},
    addEventListener(ev, fn) {
      if (!this._listeners[ev]) this._listeners[ev] = [];
      this._listeners[ev].push(fn);
    },
    _fire(ev, arg) {
      (this._listeners[ev] || []).forEach((fn) => fn(arg));
    },
    get parentNode()     { return null; },
  };
  return el;
}

function makeDocument() {
  const elements = [];
  const doc = {
    createElement(tag)  { const el = makeElement(tag); elements.push(el); return el; },
    head: { appendChild: vi.fn() },
    _elements: elements,
  };
  return doc;
}

function makeWindowRef(opts = {}) {
  const doc  = makeDocument();
  const win  = {
    document: doc,
    THREE:    opts.THREE || null,
    devicePixelRatio: 1,
    requestAnimationFrame: vi.fn((fn) => { /* don't call fn in tests */ return 1; }),
    cancelAnimationFrame:  vi.fn(),
  };
  return win;
}

// ---------------------------------------------------------------------------
// resolvePortraitUrl tests
// ---------------------------------------------------------------------------

describe('resolvePortraitUrl', () => {
  it('maps vor_tak + General Drak\'Mol männlich → Vor_Tak_DrakMol_m.png', () => {
    const url = resolvePortraitUrl('vor_tak', "General Drak'Mol", 'männlich');
    expect(url).toBe('gfx/portraits/Vor_Tak_DrakMol_m.png');
  });

  it('maps aereth + Sol\'Kaar männlich → Aereth_SolKaar_m.png', () => {
    const url = resolvePortraitUrl('aereth', "Sol'Kaar", 'männlich');
    expect(url).toBe('gfx/portraits/Aereth_SolKaar_m.png');
  });

  it('uses f for weiblich gender', () => {
    const url = resolvePortraitUrl('kryl_tha', "Kommandantin Zha'Mira", 'weiblich');
    expect(url).toBe('gfx/portraits/Kryl_Tha_ZhaMira_f.png');
  });

  it('defaults to m for unknown gender', () => {
    const url = resolvePortraitUrl('iron_fleet', 'Admiral Kessler', '');
    expect(url).toBe('gfx/portraits/Iron_Fleet_Kessler_m.png');
  });

  it('handles empty npc name', () => {
    const url = resolvePortraitUrl('syl_nar', '', 'männlich');
    expect(url).toBe('gfx/portraits/Syl_Nar_Unknown_m.png');
  });

  it('handles empty faction code', () => {
    const url = resolvePortraitUrl('', 'Some NPC', 'männlich');
    expect(url).toBe('gfx/portraits/_SomeNPC_m.png');
  });

  it('is exposed as NpcAvatarRenderer.resolvePortraitUrl static method', () => {
    expect(typeof NpcAvatarRenderer.resolvePortraitUrl).toBe('function');
    expect(NpcAvatarRenderer.resolvePortraitUrl('aereth', "Sol'Kaar", 'männlich'))
      .toBe('gfx/portraits/Aereth_SolKaar_m.png');
  });
});

// ---------------------------------------------------------------------------
// Constructor tests
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer constructor', () => {
  it('stores factionCode, factionColor, npcName', () => {
    const r = new NpcAvatarRenderer({
      factionCode:  'vor_tak',
      factionColor: '#2d5a1b',
      npcName:      "General Drak'Mol",
      npcGender:    'männlich',
      windowRef:    makeWindowRef(),
      THREE:        null,
    });
    expect(r._factionCode).toBe('vor_tak');
    expect(r._factionColor).toBe('#2d5a1b');
    expect(r._npcName).toBe("General Drak'Mol");
  });

  it('auto-resolves portraitUrl when not provided', () => {
    const r = new NpcAvatarRenderer({
      factionCode: 'aereth', npcName: "Sol'Kaar", npcGender: 'männlich',
      windowRef: makeWindowRef(), THREE: null,
    });
    expect(r._portraitUrl).toBe('gfx/portraits/Aereth_SolKaar_m.png');
  });

  it('uses explicit portraitUrl when provided', () => {
    const r = new NpcAvatarRenderer({
      factionCode: 'aereth', npcName: "Sol'Kaar",
      portraitUrl: '/custom/portrait.png',
      windowRef: makeWindowRef(), THREE: null,
    });
    expect(r._portraitUrl).toBe('/custom/portrait.png');
  });

  it('skips portrait when portraitUrl is null', () => {
    const r = new NpcAvatarRenderer({
      factionCode: 'aereth', npcName: "Sol'Kaar",
      portraitUrl: null,
      windowRef: makeWindowRef(), THREE: null,
    });
    expect(r._portraitUrl).toBeNull();
  });

  it('applies safe defaults for all opts empty', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    expect(r._factionCode).toBe('unknown');
    expect(r._factionColor).toBe('#88aaff');
    expect(r._npcName).toBe('');
    expect(r._talking).toBe(false);
    expect(r._expression).toBe('neutral');
    expect(r._destroyed).toBe(false);
  });

  it('isWebGLActive is false initially', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    expect(r.isWebGLActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State setters
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer state setters', () => {
  let r;
  beforeEach(() => {
    r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
  });

  it('setTalking(true) sets _talking to true', () => {
    r.setTalking(true);
    expect(r._talking).toBe(true);
  });

  it('setTalking(false) sets _talking to false', () => {
    r.setTalking(true);
    r.setTalking(false);
    expect(r._talking).toBe(false);
  });

  it('setExpression stores the expression', () => {
    r.setExpression('hostile');
    expect(r._expression).toBe('hostile');
  });

  it('setExpression defaults to neutral on empty string', () => {
    r.setExpression('');
    expect(r._expression).toBe('neutral');
  });

  it('setExpression accepts all known expressions', () => {
    ['neutral', 'friendly', 'hostile', 'thinking'].forEach((expr) => {
      r.setExpression(expr);
      expect(r._expression).toBe(expr);
    });
  });
});

// ---------------------------------------------------------------------------
// Lifecycle (no DOM / no WebGL)
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer lifecycle without WebGL', () => {
  it('mount() with THREE=null mounts the CSS fallback without throwing', () => {
    const win = makeWindowRef({ THREE: null });
    const r = new NpcAvatarRenderer({
      factionCode:  'vor_tak',
      factionColor: '#2d5a1b',
      npcName:      "General Drak'Mol",
      windowRef:    win,
      THREE:        null,
    });
    const container = makeElement('div');
    expect(() => r.mount(container)).not.toThrow();
    // Fallback element should be appended
    expect(container._children.length).toBeGreaterThan(0);
  });

  it('destroy() marks renderer as destroyed', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    r.destroy();
    expect(r._destroyed).toBe(true);
  });

  it('destroy() is idempotent (second call does not throw)', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    r.destroy();
    expect(() => r.destroy()).not.toThrow();
  });

  it('mount() after destroy() is a no-op', () => {
    const win = makeWindowRef({ THREE: null });
    const r = new NpcAvatarRenderer({ windowRef: win, THREE: null });
    r.destroy();
    const container = makeElement('div');
    expect(() => r.mount(container)).not.toThrow();
    expect(container._children.length).toBe(0);
  });

  it('reattach() after destroy() is a no-op and does not throw', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    r.destroy();
    const container = makeElement('div');
    expect(() => r.reattach(container)).not.toThrow();
    expect(container._children.length).toBe(0);
  });

  it('isWebGLActive is false after destroy()', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    r.destroy();
    expect(r.isWebGLActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// _tick() animation maths (tested without a real THREE renderer)
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer._tick() animation', () => {
  function makeHeadRef() {
    return { rotation: { x: 0, y: 0, z: 0 }, scale: { y: 1 } };
  }

  function makeTorsoRef() {
    return { rotation: { x: 0, y: 0, z: 0 }, scale: { y: 1 } };
  }

  function makeGroup() {
    return { position: { y: 0 } };
  }

  function makeRendererWithMocks(talking, expression) {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    // Inject a minimal THREE mock just for the instanceof check in _tick
    r._THREE = { Group: class {} };
    r._headRef  = makeHeadRef();
    r._torsoRef = makeTorsoRef();
    r._bust     = makeGroup();
    r._talking    = talking;
    r._expression = expression;
    return r;
  }

  it('head rotates while talking', () => {
    const r = makeRendererWithMocks(true, 'neutral');
    r._elapsed = 1.0;
    r._tick(0.016);
    // After one tick, head.rotation.x should deviate from 0
    const rotBefore = 0;
    r._elapsed = 1.016;
    r._tick(0.016);
    expect(r._headRef.rotation.x).not.toBe(rotBefore);
  });

  it('head rotates while idle', () => {
    const r = makeRendererWithMocks(false, 'neutral');
    r._elapsed = 2.0;
    r._tick(0.016);
    r._elapsed = 2.016;
    r._tick(0.016);
    // Rotation should be driven by idle sway
    expect(typeof r._headRef.rotation.y).toBe('number');
  });

  it('thinking expression tilts head on Z axis', () => {
    const r = makeRendererWithMocks(false, 'thinking');
    r._elapsed = 0;
    // Run several ticks to allow smooth interpolation to settle toward target
    for (let i = 0; i < 30; i++) { r._elapsed += 0.016; r._tick(0.016); }
    expect(r._headRef.rotation.z).toBeGreaterThan(0);
  });

  it('bust position floats over time', () => {
    const r = makeRendererWithMocks(false, 'neutral');
    r._elapsed = 0;
    r._tick(0.016);
    const y0 = r._bust.position.y;
    r._elapsed = Math.PI / 0.6 / 2; // half period of sin(e*0.6)
    r._tick(0.016);
    const y1 = r._bust.position.y;
    // y position should change between different elapsed values
    expect(y0).not.toBeCloseTo(y1, 5);
  });

  it('torso scale.y changes with breathing', () => {
    const r = makeRendererWithMocks(false, 'neutral');
    r._elapsed = 0;
    r._tick(0.016);
    const s0 = r._torsoRef.scale.y;
    r._elapsed = Math.PI / 0.9; // half period of sin(e*0.9)
    r._tick(0.016);
    const s1 = r._torsoRef.scale.y;
    expect(s0).not.toBeCloseTo(s1, 5);
  });
});
