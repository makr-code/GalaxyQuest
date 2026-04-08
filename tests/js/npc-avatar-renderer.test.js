/**
 * npc-avatar-renderer.test.js
 *
 * Unit tests for NpcAvatarRenderer (JSON 3D model + AnimationMixer, PNG fallback, CSS fallback).
 *
 *   resolvePortraitUrl()
 *   NpcAvatarRenderer constructor defaults & opts
 *   State setters: setTalking, setExpression
 *   Lifecycle without WebGL: mount, destroy, reattach
 *   isWebGLActive flag
 *   _updateAnimationState / _playExpressionOnce with mock mixer
 *   _loadJsonBust: returns null on fetch failure
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
// Minimal DOM mocks
// ---------------------------------------------------------------------------

function makeElement(tag = 'div') {
  const children = [];
  const el = {
    tagName: tag.toUpperCase(), _children: children,
    style: {}, className: '', textContent: '', src: '', alt: '',
    _listeners: {},
    appendChild(child)  { children.push(child); return child; },
    removeChild(child)  { const i = children.indexOf(child); if (i !== -1) children.splice(i, 1); },
    getAttribute()      { return null; },
    setAttribute()      {},
    addEventListener(ev, fn) {
      if (!this._listeners[ev]) this._listeners[ev] = [];
      this._listeners[ev].push(fn);
    },
    get parentNode() { return null; },
  };
  return el;
}

function makeDocument() {
  return {
    createElement(tag)  { return makeElement(tag); },
    head: { appendChild: vi.fn() },
  };
}

function makeWindowRef(opts = {}) {
  return {
    document: makeDocument(),
    THREE:    opts.THREE || null,
    devicePixelRatio: 1,
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame:  vi.fn(),
    fetch: opts.fetch || vi.fn(() => Promise.reject(new Error('no fetch'))),
  };
}

// ---------------------------------------------------------------------------
// resolvePortraitUrl
// ---------------------------------------------------------------------------

describe('resolvePortraitUrl', () => {
  it("vor_tak + General Drak'Mol männlich → Vor_Tak_DrakMol_m.png", () => {
    expect(resolvePortraitUrl('vor_tak', "General Drak'Mol", 'männlich'))
      .toBe('gfx/portraits/Vor_Tak_DrakMol_m.png');
  });

  it("aereth + Sol'Kaar männlich → Aereth_SolKaar_m.png", () => {
    expect(resolvePortraitUrl('aereth', "Sol'Kaar", 'männlich'))
      .toBe('gfx/portraits/Aereth_SolKaar_m.png');
  });

  it('uses f for weiblich gender', () => {
    expect(resolvePortraitUrl('kryl_tha', "Kommandantin Zha'Mira", 'weiblich'))
      .toBe('gfx/portraits/Kryl_Tha_ZhaMira_f.png');
  });

  it('defaults to m for unknown gender', () => {
    expect(resolvePortraitUrl('iron_fleet', 'Admiral Kessler', ''))
      .toBe('gfx/portraits/Iron_Fleet_Kessler_m.png');
  });

  it('handles empty npc name', () => {
    expect(resolvePortraitUrl('syl_nar', '', 'männlich'))
      .toBe('gfx/portraits/Syl_Nar_Unknown_m.png');
  });

  it('handles empty faction code', () => {
    expect(resolvePortraitUrl('', 'Some NPC', 'männlich'))
      .toBe('gfx/portraits/_SomeNPC_m.png');
  });

  it('is exposed as NpcAvatarRenderer.resolvePortraitUrl static method', () => {
    expect(typeof NpcAvatarRenderer.resolvePortraitUrl).toBe('function');
    expect(NpcAvatarRenderer.resolvePortraitUrl('aereth', "Sol'Kaar", 'männlich'))
      .toBe('gfx/portraits/Aereth_SolKaar_m.png');
  });
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer constructor', () => {
  it('stores factionCode, factionColor, npcName', () => {
    const r = new NpcAvatarRenderer({
      factionCode: 'vor_tak', factionColor: '#2d5a1b',
      npcName: "General Drak'Mol", npcGender: 'männlich',
      windowRef: makeWindowRef(), THREE: null,
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
      portraitUrl: null, windowRef: makeWindowRef(), THREE: null,
    });
    expect(r._portraitUrl).toBeNull();
  });

  it('applies safe defaults when opts is empty', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    expect(r._factionCode).toBe('unknown');
    expect(r._factionColor).toBe('#88aaff');
    expect(r._npcName).toBe('');
    expect(r._talking).toBe(false);
    expect(r._expression).toBe('neutral');
    expect(r._destroyed).toBe(false);
  });

  it('uses default modelBasePath when not provided', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    expect(r._modelBasePath).toBe('models/npc_avatars');
  });

  it('accepts custom modelBasePath', () => {
    const r = new NpcAvatarRenderer({ modelBasePath: '/custom/path', windowRef: makeWindowRef(), THREE: null });
    expect(r._modelBasePath).toBe('/custom/path');
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
// Lifecycle without WebGL
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer lifecycle without WebGL', () => {
  it('mount() with THREE=null mounts a CSS fallback without throwing', () => {
    const win = makeWindowRef({ THREE: null });
    const r = new NpcAvatarRenderer({
      factionCode: 'vor_tak', factionColor: '#2d5a1b',
      npcName: "General Drak'Mol", windowRef: win, THREE: null,
    });
    const container = makeElement('div');
    expect(() => r.mount(container)).not.toThrow();
    expect(container._children.length).toBeGreaterThan(0);
  });

  it('destroy() marks renderer as destroyed', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: null });
    r.destroy();
    expect(r._destroyed).toBe(true);
  });

  it('destroy() is idempotent', () => {
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
// _updateAnimationState with mock mixer
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer._updateAnimationState()', () => {
  function makeAction() {
    return {
      _playing: false,
      enabled: false,
      crossFadeTo: vi.fn(),
      reset: vi.fn().mockReturnThis(),
      play:  vi.fn().mockReturnThis(),
      stop:  vi.fn(),
      isRunning: vi.fn(() => false),
    };
  }

  function makeRenderer(talking) {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: { LoopRepeat: 2201, LoopOnce: 2200 } });
    r._webglReady = true;
    r._mixer = { stopAllAction: vi.fn(), update: vi.fn() };
    r._actionIdle = makeAction();
    r._actionTalk = makeAction();
    r._talking = talking;
    return r;
  }

  it('crossFades to talk clip when setTalking(true)', () => {
    const r = makeRenderer(false);
    r.setTalking(true);
    expect(r._actionIdle.crossFadeTo).toHaveBeenCalledWith(r._actionTalk, 0.2, false);
  });

  it('crossFades back to idle when setTalking(false)', () => {
    const r = makeRenderer(true);
    // Start already talking so the setter triggers the transition
    r._talking = true;
    r.setTalking(false);
    expect(r._actionTalk.crossFadeTo).toHaveBeenCalledWith(r._actionIdle, 0.3, false);
  });

  it('no-op when setTalking called with same value', () => {
    const r = makeRenderer(false);
    r.setTalking(false); // already false
    expect(r._actionIdle.crossFadeTo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// _playExpressionOnce with mock mixer/clips
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer._playExpressionOnce()', () => {
  it('plays the matching expression clip once', () => {
    const r = new NpcAvatarRenderer({
      windowRef: makeWindowRef(),
      THREE: { LoopOnce: 2200 },
    });
    r._webglReady = true;
    const mockAction = {
      setLoop: vi.fn(),
      reset:   vi.fn().mockReturnThis(),
      play:    vi.fn().mockReturnThis(),
      clampWhenFinished: false,
    };
    r._mixer = { clipAction: vi.fn(() => mockAction), stopAllAction: vi.fn() };
    r._clips = [
      { name: 'expression_friendly' },
      { name: 'expression_hostile' },
    ];
    r._playExpressionOnce('friendly');
    expect(r._mixer.clipAction).toHaveBeenCalledWith({ name: 'expression_friendly' });
    expect(mockAction.setLoop).toHaveBeenCalledWith(2200, 1);
    expect(mockAction.reset).toHaveBeenCalled();
    expect(mockAction.play).toHaveBeenCalled();
  });

  it('does nothing when clip not found', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: {} });
    r._webglReady = true;
    r._mixer = { clipAction: vi.fn(), stopAllAction: vi.fn() };
    r._clips = [{ name: 'expression_friendly' }];
    expect(() => r._playExpressionOnce('thinking')).not.toThrow();
    expect(r._mixer.clipAction).not.toHaveBeenCalled();
  });

  it('does nothing without a mixer', () => {
    const r = new NpcAvatarRenderer({ windowRef: makeWindowRef(), THREE: {} });
    r._webglReady = true;
    r._mixer = null;
    r._clips = [{ name: 'expression_hostile' }];
    expect(() => r._playExpressionOnce('hostile')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// _loadJsonBust: returns null on fetch failure
// ---------------------------------------------------------------------------

describe('NpcAvatarRenderer._loadJsonBust()', () => {
  it('returns null when fetch rejects', async () => {
    const win = makeWindowRef({ fetch: vi.fn(() => Promise.reject(new Error('network error'))) });
    const r = new NpcAvatarRenderer({ factionCode: 'vor_tak', windowRef: win, THREE: null });
    const THREE_mock = {};
    const result = await r._loadJsonBust(THREE_mock);
    expect(result).toBeNull();
  });

  it('returns null when fetch returns non-ok status', async () => {
    const win = makeWindowRef({
      fetch: vi.fn(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) })),
    });
    const r = new NpcAvatarRenderer({ factionCode: 'vor_tak', windowRef: win, THREE: null });
    const result = await r._loadJsonBust({});
    expect(result).toBeNull();
  });

  it('returns null when descriptor has no object field', async () => {
    const win = makeWindowRef({
      fetch: vi.fn(() => Promise.resolve({
        ok: true,
        json: async () => ({ metadata: { type: 'Object' }, animations: [] }),
      })),
    });
    const r = new NpcAvatarRenderer({ factionCode: 'vor_tak', windowRef: win, THREE: null });
    const result = await r._loadJsonBust({});
    expect(result).toBeNull();
  });
});
