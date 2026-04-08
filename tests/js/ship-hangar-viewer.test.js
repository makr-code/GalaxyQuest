/**
 * tests/js/ship-hangar-viewer.test.js
 *
 * Unit tests for ShipHangarViewer:
 *  - Construction / init guard
 *  - loadHull – resolves correct model ID
 *  - applyModules – weapon / shield / engine / utility effects
 *  - getHardpoints / isShieldActive
 *  - dispose
 *  - HULL_MODEL_MAP coverage
 *  - MODULE_VISUALS shape
 *  - Integration: RuntimeShipyardController mounts hangar canvas
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Load module source via eval ───────────────────────────────────────────────
function loadViewer() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'js/ui/ShipHangarViewer.js'),
    'utf8',
  );
  window.eval(src);
}

function loadController() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'js/engine/runtime/RuntimeShipyardController.js'),
    'utf8',
  );
  window.eval(src);
}

// ── Minimal Three.js stub ─────────────────────────────────────────────────────
function makeThreeStub() {
  const store = new Map();

  class Color {
    constructor(v) { this.v = v; }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    setScalar(s) { this.x = this.y = this.z = s; return this; }
  }
  class Box3 {
    setFromObject() { return this; }
    getBoundingSphere(s) { s.radius = 2.0; s.center = new Vector3(); return this; }
    getCenter(v) { v.set(0, 0, 0); return v; }
  }
  class Sphere { constructor() { this.radius = 2.0; this.center = new Vector3(); } }

  class EventTarget2 {
    constructor() { this._listeners = {}; }
    addEventListener(type, fn) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(fn);
    }
    removeEventListener(type, fn) {
      if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
    }
    dispatchEvent(type, event = {}) {
      (this._listeners[type] || []).forEach((fn) => fn(event));
    }
  }

  const mkGeo = () => ({ dispose: vi.fn(), _isGeo: true });
  const mkMat = () => ({
    dispose: vi.fn(),
    _isMat: true,
    opacity: 0.14,
    color: new Color(0),
    emissive: new Color(0),
    emissiveIntensity: 1,
  });

  class Mesh extends EventTarget2 {
    constructor(geo, mat) {
      super();
      this.isMesh = true;
      this.geometry = geo || mkGeo();
      this.material = mat || mkMat();
      this.name = '';
      this.position = new Vector3();
      this.rotation = { set: vi.fn(), x: 0, y: 0, z: 0 };
      this.scale = { setScalar: vi.fn(), x: 1, y: 1, z: 1 };
      this.userData = {};
      this.visible = true;
      this.castShadow = false;
      this.receiveShadow = false;
    }
  }

  class Group extends EventTarget2 {
    constructor() {
      super();
      this.isGroup = true;
      this.children = [];
      this.name = '';
      this.position = new Vector3();
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = { multiplyScalar: vi.fn(), setScalar: vi.fn(), x: 1, y: 1, z: 1 };
      this.userData = {};
      this.castShadow = false;
    }
    add(...items) { items.forEach((i) => this.children.push(i)); return this; }
    remove(item) { this.children = this.children.filter((c) => c !== item); return this; }
    traverse(fn) {
      fn(this);
      this.children.forEach((c) => { if (c.traverse) c.traverse(fn); else fn(c); });
    }
  }

  class Scene extends Group {
    constructor() {
      super();
      this.background = null;
      this.fog = null;
    }
  }

  class Camera {
    constructor() {
      this.position = new Vector3(0, 1.2, 6);
      this.aspect = 1;
      this.near = 0.1;
      this.far = 100;
    }
    lookAt() {}
    updateProjectionMatrix() {}
  }
  class PerspectiveCamera extends Camera {}

  class PointLight {
    constructor(color, intensity, distance) {
      this.color = color; this.intensity = intensity; this.distance = distance;
      this.position = new Vector3();
    }
  }
  class AmbientLight {}
  class SpotLight {
    constructor() { this.position = new Vector3(); this.target = new Group(); this.castShadow = false; this.shadow = { mapSize: { set: vi.fn() } }; }
  }
  class DirectionalLight { constructor() { this.position = new Vector3(); } }

  class FogExp2 {}
  class GridHelper { constructor() { this.position = new Vector3(); } }
  class PlaneGeometry { constructor() {} }
  class CylinderGeometry extends EventTarget2 { constructor() { super(); this.dispose = vi.fn(); } }
  class SphereGeometry   extends EventTarget2 { constructor() { super(); this.dispose = vi.fn(); } }
  class ConeGeometry     extends EventTarget2 { constructor() { super(); this.dispose = vi.fn(); } }
  class BoxGeometry      extends EventTarget2 { constructor() { super(); this.dispose = vi.fn(); } }

  class MeshStandardMaterial {
    constructor(opts = {}) {
      Object.assign(this, opts);
      this._isMat = true;
      this.dispose = vi.fn();
      this.opacity = opts.opacity ?? 1;
    }
  }

  class WebGLRenderer {
    constructor() {
      this.shadowMap = { enabled: false, type: null };
      this.outputColorSpace = null;
    }
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
  }

  class Clock {
    constructor() { this._t = 0; this.elapsedTime = 0; }
    getDelta() { return 0.016; }
  }

  class AnimationMixer {
    constructor() {}
    clipAction() { return { play: vi.fn() }; }
    stopAllAction() {}
    update() {}
  }
  class AnimationClip {
    static parse() { return new AnimationClip(); }
  }

  class ObjectLoader {
    setResourcePath() {}
    parse(descriptor, cb) {
      const g = new Group();
      const hp = descriptor?.object?.userData?.gqHardpoints;
      if (hp) g.userData.gqHardpoints = hp;
      g.userData.nativeClipMap = { idle: [], active: [], alert: [] };
      cb(g);
    }
  }

  const DoubleSide = 2;
  const PCFSoftShadowMap = 2;
  const SRGBColorSpace = 'srgb';

  return {
    THREE: {
      Color, Vector3, Box3, Sphere,
      Mesh, Group, Scene,
      PerspectiveCamera,
      PointLight, AmbientLight, SpotLight, DirectionalLight,
      FogExp2, GridHelper,
      PlaneGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, BoxGeometry,
      MeshStandardMaterial,
      WebGLRenderer, Clock, AnimationMixer, AnimationClip, ObjectLoader,
      DoubleSide, PCFSoftShadowMap, SRGBColorSpace,
    },
  };
}

// ── Canvas stub ───────────────────────────────────────────────────────────────
function makeCanvas(w = 400, h = 280) {
  const el = window.document.createElement('canvas');
  el.width  = w;
  el.height = h;
  return el;
}

// ── Shared corvette descriptor ────────────────────────────────────────────────
const CORVETTE_DESCRIPTOR = {
  metadata: { version: 4.6, type: 'Object' },
  modelId: 'ship_corvette',
  version: 1,
  scale: 1,
  animations: [],
  object: {
    uuid: 'g1', type: 'Group', name: 'ship_corvette',
    userData: {
      gqShipHull: true,
      gqHullClass: 'corvette',
      gqHardpoints: {
        weapon:  [{ name: 'wp_l', position: [-0.55, 0.05, 0.3] }, { name: 'wp_r', position: [0.55, 0.05, 0.3] }],
        shield:  [{ name: 'shield_c', position: [0, 0, 0] }],
        engine:  [{ name: 'eng_main', position: [0, 0, -1.1] }],
        utility: [{ name: 'util_belly', position: [0, -0.35, 0.2] }],
      },
    },
    children: [],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ShipHangarViewer – construction', () => {
  beforeEach(() => { delete window.GQShipHangarViewer; });

  it('exports ShipHangarViewer, HULL_MODEL_MAP, MODULE_VISUALS', () => {
    loadViewer();
    expect(typeof window.GQShipHangarViewer.ShipHangarViewer).toBe('function');
    expect(typeof window.GQShipHangarViewer.HULL_MODEL_MAP).toBe('object');
    expect(typeof window.GQShipHangarViewer.MODULE_VISUALS).toBe('object');
  });

  it('throws without canvas', () => {
    loadViewer();
    const { ShipHangarViewer } = window.GQShipHangarViewer;
    const { THREE } = makeThreeStub();
    expect(() => new ShipHangarViewer(null, { THREE })).toThrow();
  });

  it('throws without THREE', () => {
    loadViewer();
    const { ShipHangarViewer } = window.GQShipHangarViewer;
    expect(() => new ShipHangarViewer(makeCanvas(), {})).toThrow();
  });

  it('constructs successfully with canvas and THREE stub', () => {
    loadViewer();
    const { ShipHangarViewer } = window.GQShipHangarViewer;
    const { THREE } = makeThreeStub();
    window.devicePixelRatio = 1;
    window.requestAnimationFrame = vi.fn();
    const viewer = new ShipHangarViewer(makeCanvas(), { THREE });
    expect(viewer).toBeTruthy();
    viewer.dispose();
  });
});

describe('ShipHangarViewer – HULL_MODEL_MAP', () => {
  beforeEach(() => { delete window.GQShipHangarViewer; });

  it('maps all 4 hull classes', () => {
    loadViewer();
    const { HULL_MODEL_MAP } = window.GQShipHangarViewer;
    expect(HULL_MODEL_MAP.corvette).toBe('ship_corvette');
    expect(HULL_MODEL_MAP.frigate).toBe('ship_frigate');
    expect(HULL_MODEL_MAP.destroyer).toBe('ship_destroyer');
    expect(HULL_MODEL_MAP.cruiser).toBe('ship_cruiser');
  });
});

describe('ShipHangarViewer – MODULE_VISUALS', () => {
  beforeEach(() => { delete window.GQShipHangarViewer; });

  it('has entries for weapon, shield, engine, utility', () => {
    loadViewer();
    const { MODULE_VISUALS } = window.GQShipHangarViewer;
    expect(MODULE_VISUALS).toHaveProperty('weapon');
    expect(MODULE_VISUALS).toHaveProperty('shield');
    expect(MODULE_VISUALS).toHaveProperty('engine');
    expect(MODULE_VISUALS).toHaveProperty('utility');
  });

  it('shield entry has radiusScale', () => {
    loadViewer();
    expect(window.GQShipHangarViewer.MODULE_VISUALS.shield.radiusScale).toBeGreaterThan(1);
  });

  it('weapon entry has geometry descriptor', () => {
    loadViewer();
    const { weapon } = window.GQShipHangarViewer.MODULE_VISUALS;
    expect(weapon.geometry.type).toBe('CylinderGeometry');
  });

  it('engine entry has a PointLight config', () => {
    loadViewer();
    const { engine } = window.GQShipHangarViewer.MODULE_VISUALS;
    expect(engine.light).toBeTruthy();
    expect(engine.light.color).toBeTruthy();
  });
});

describe('ShipHangarViewer – loadHull', () => {
  beforeEach(() => { delete window.GQShipHangarViewer; });

  function makeViewer(fetchFn) {
    loadViewer();
    const { ShipHangarViewer } = window.GQShipHangarViewer;
    const { THREE } = makeThreeStub();
    window.devicePixelRatio = 1;
    window.requestAnimationFrame = vi.fn();
    return new ShipHangarViewer(makeCanvas(), { THREE, fetchModelDescriptor: fetchFn, autoRotate: false });
  }

  it('calls fetchModelDescriptor with correct model ID for corvette', async () => {
    const fetch = vi.fn().mockResolvedValue(CORVETTE_DESCRIPTOR);
    const viewer = makeViewer(fetch);
    await viewer.loadHull('corvette');
    expect(fetch).toHaveBeenCalledWith('ship_corvette');
    viewer.dispose();
  });

  it('calls fetchModelDescriptor with correct model ID for frigate', async () => {
    const fetch = vi.fn().mockResolvedValue({ ...CORVETTE_DESCRIPTOR, modelId: 'ship_frigate' });
    const viewer = makeViewer(fetch);
    await viewer.loadHull('frigate');
    expect(fetch).toHaveBeenCalledWith('ship_frigate');
    viewer.dispose();
  });

  it('falls back to corvette model for unknown hull class', async () => {
    const fetch = vi.fn().mockResolvedValue(CORVETTE_DESCRIPTOR);
    const viewer = makeViewer(fetch);
    await viewer.loadHull('battlecruiser_mk7');
    expect(fetch).toHaveBeenCalledWith('ship_corvette');
    viewer.dispose();
  });

  it('loads fallback geometry when fetch rejects', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network'));
    const viewer = makeViewer(fetch);
    await viewer.loadHull('corvette');
    // Fallback ship group should be set
    expect(viewer._shipGroup).toBeTruthy();
    viewer.dispose();
  });

  it('hardpoints are populated after load', async () => {
    const fetch = vi.fn().mockResolvedValue(CORVETTE_DESCRIPTOR);
    const viewer = makeViewer(fetch);
    await viewer.loadHull('corvette');
    const hp = viewer.getHardpoints();
    expect(hp.weapon.length).toBe(2);
    expect(hp.engine.length).toBe(1);
    viewer.dispose();
  });
});

describe('ShipHangarViewer – applyModules', () => {
  beforeEach(() => { delete window.GQShipHangarViewer; });

  async function makeLoadedViewer() {
    loadViewer();
    const { ShipHangarViewer } = window.GQShipHangarViewer;
    const { THREE } = makeThreeStub();
    window.devicePixelRatio = 1;
    window.requestAnimationFrame = vi.fn();
    const fetch = vi.fn().mockResolvedValue(CORVETTE_DESCRIPTOR);
    const viewer = new ShipHangarViewer(makeCanvas(), { THREE, fetchModelDescriptor: fetch, autoRotate: false });
    await viewer.loadHull('corvette');
    return viewer;
  }

  it('adds weapon barrel meshes for each weapon slot', async () => {
    const viewer = await makeLoadedViewer();
    viewer.applyModules({ weapon: 2 });
    const weaponMeshes = viewer._moduleGroup.children.filter((c) =>
      c.name && c.name.startsWith('weapon_barrel'),
    );
    expect(weaponMeshes.length).toBe(2);
    viewer.dispose();
  });

  it('adds weapon barrel meshes capped to available hardpoints', async () => {
    const viewer = await makeLoadedViewer();
    // Corvette has 2 weapon hardpoints; requesting 5 should cap at 2
    viewer.applyModules({ weapon: 5 });
    const weaponMeshes = viewer._moduleGroup.children.filter((c) =>
      c.name && c.name.startsWith('weapon_barrel'),
    );
    expect(weaponMeshes.length).toBe(2);
    viewer.dispose();
  });

  it('creates shield bubble when shield count > 0', async () => {
    const viewer = await makeLoadedViewer();
    expect(viewer.isShieldActive()).toBe(false);
    viewer.applyModules({ shield: 1 });
    expect(viewer.isShieldActive()).toBe(true);
    viewer.dispose();
  });

  it('shield bubble is removed when shield count is 0', async () => {
    const viewer = await makeLoadedViewer();
    viewer.applyModules({ shield: 1 });
    expect(viewer.isShieldActive()).toBe(true);
    viewer.applyModules({ shield: 0 });
    expect(viewer.isShieldActive()).toBe(false);
    viewer.dispose();
  });

  it('adds engine glow meshes for each engine slot', async () => {
    const viewer = await makeLoadedViewer();
    viewer.applyModules({ engine: 1 });
    const engineMeshes = viewer._moduleGroup.children.filter((c) =>
      c.name && c.name.startsWith('engine_glow'),
    );
    expect(engineMeshes.length).toBe(1);
    viewer.dispose();
  });

  it('adds utility pod meshes for each utility slot', async () => {
    const viewer = await makeLoadedViewer();
    viewer.applyModules({ utility: 1 });
    const utilMeshes = viewer._moduleGroup.children.filter((c) =>
      c.name && c.name.startsWith('utility_pod'),
    );
    expect(utilMeshes.length).toBe(1);
    viewer.dispose();
  });

  it('weapon modules emit point lights into the scene', async () => {
    const viewer = await makeLoadedViewer();
    const lightsBefore = viewer._moduleLights.length;
    viewer.applyModules({ weapon: 2 });
    expect(viewer._moduleLights.length).toBeGreaterThan(lightsBefore);
    viewer.dispose();
  });

  it('clearing modules removes all meshes and lights', async () => {
    const viewer = await makeLoadedViewer();
    viewer.applyModules({ weapon: 2, shield: 1, engine: 1, utility: 1 });
    viewer.applyModules({}); // all zeros
    expect(viewer._moduleGroup.children.length).toBe(0);
    expect(viewer._moduleLights.length).toBe(0);
    expect(viewer.isShieldActive()).toBe(false);
    viewer.dispose();
  });
});

describe('ShipHangarViewer – orbit controls', () => {
  beforeEach(() => { delete window.GQShipHangarViewer; });

  it('setOrbit updates azimuth and elevation', () => {
    loadViewer();
    const { ShipHangarViewer } = window.GQShipHangarViewer;
    const { THREE } = makeThreeStub();
    window.devicePixelRatio = 1;
    window.requestAnimationFrame = vi.fn();
    const viewer = new ShipHangarViewer(makeCanvas(), { THREE, autoRotate: false });
    viewer.setOrbit(1.2, 0.3);
    expect(viewer._orbitAzimuth).toBeCloseTo(1.2);
    expect(viewer._orbitElevation).toBeCloseTo(0.3);
    viewer.dispose();
  });
});

describe('ShipHangarViewer – dispose', () => {
  beforeEach(() => { delete window.GQShipHangarViewer; });

  it('sets _disposed flag and calls renderer.dispose()', () => {
    loadViewer();
    const { ShipHangarViewer } = window.GQShipHangarViewer;
    const { THREE } = makeThreeStub();
    window.devicePixelRatio = 1;
    window.requestAnimationFrame = vi.fn();
    const viewer = new ShipHangarViewer(makeCanvas(), { THREE, autoRotate: false });
    const disposeSpy = vi.spyOn(viewer._renderer, 'dispose');
    viewer.dispose();
    expect(viewer._disposed).toBe(true);
    expect(disposeSpy).toHaveBeenCalled();
  });
});

// ── Controller integration ─────────────────────────────────────────────────────

describe('RuntimeShipyardController – hangar canvas integration', () => {
  beforeEach(() => {
    delete window.GQRuntimeShipyardController;
    delete window.GQShipHangarViewer;
  });

  function makeGQUI(doc) {
    class El {
      constructor(tag = 'div') {
        this.dom = doc.createElement(tag);
      }
      setClass(c) { this.dom.className = c; return this; }
      setTextContent(t) { this.dom.textContent = t; return this; }
      add(...ch) { ch.forEach((c) => this.dom.appendChild(c?.dom ?? c)); return this; }
    }
    class Div extends El { constructor() { super('div'); } }
    class Span extends El { constructor() { super('span'); } }
    class Button extends El { constructor(t = '') { super('button'); this.dom.textContent = t; } }
    return { Div, Span, Button };
  }

  const sampleHulls = [
    {
      code: 'corvette_t1', label: 'Corvette', tier: 1, ship_class: 'corvette',
      role: 'combat', unlocked: true, blockers: [],
      base_stats: { attack: 10, shield: 5, hull: 20, cargo: 50, speed: 1200 },
      slot_profile: { weapon: 2, utility: 1 },
    },
  ];

  it('Design tab contains a #shipyard-hangar-canvas element', async () => {
    loadController();
    const { createShipyardController } = window.GQRuntimeShipyardController;
    const doc = window.document;
    const root = doc.createElement('div');
    const wm = { body: vi.fn(() => root) };
    const controller = createShipyardController({
      wm,
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
      windowRef: window,
      documentRef: doc,
      getCurrentColony: () => ({ id: 1 }),
      updateResourceBar: vi.fn(),
      fmt: (n) => String(n),
      fmtName: (s) => String(s ?? '').replace(/_/g, ' '),
      esc: (s) => String(s ?? ''),
      countdown: () => '0:00',
      showToast: vi.fn(),
      gameLog: vi.fn(),
      gqStatusMsg: vi.fn(),
      GQUI: makeGQUI(doc),
      ShipHangarViewer: null, // no THREE in jsdom — should degrade gracefully
    });
    await controller.render();
    const canvas = root.querySelector('#shipyard-hangar-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
  });

  it('Design tab contains a .shipyard-hangar-wrap container', async () => {
    loadController();
    const { createShipyardController } = window.GQRuntimeShipyardController;
    const doc = window.document;
    const root = doc.createElement('div');
    const wm = { body: vi.fn(() => root) };
    const controller = createShipyardController({
      wm,
      api: {
        ships: vi.fn().mockResolvedValue({ success: true, ships: [], blueprints: [], queue: [] }),
        shipyardHulls: vi.fn().mockResolvedValue({ hulls: sampleHulls }),
        shipyardVessels: vi.fn().mockResolvedValue({ vessels: [] }),
        resources: vi.fn().mockResolvedValue({ success: true, resources: {} }),
      },
      windowRef: window,
      documentRef: doc,
      getCurrentColony: () => ({ id: 1 }),
      updateResourceBar: vi.fn(),
      fmt: (n) => String(n),
      fmtName: (s) => String(s ?? ''),
      esc: (s) => String(s ?? ''),
      countdown: () => '0:00',
      showToast: vi.fn(),
      gameLog: vi.fn(),
      gqStatusMsg: vi.fn(),
      GQUI: makeGQUI(doc),
      ShipHangarViewer: null,
    });
    await controller.render();
    const wrap = root.querySelector('.shipyard-hangar-wrap');
    expect(wrap).not.toBeNull();
  });
});
