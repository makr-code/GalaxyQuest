import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { GalaxyLevelWebGPU } = require(path.join(root, 'js/engine/zoom/levels/GalaxyLevelWebGPU.js'));
const { GalaxyLevelThreeJS } = require(path.join(root, 'js/engine/zoom/levels/GalaxyLevelThreeJS.js'));
const { SystemLevelWebGPU } = require(path.join(root, 'js/engine/zoom/levels/SystemLevelWebGPU.js'));
const { SystemLevelThreeJS } = require(path.join(root, 'js/engine/zoom/levels/SystemLevelThreeJS.js'));

function makeCanvasHost() {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  return { host, canvas };
}

describe('Zoom level renderers shared init integration', () => {
  beforeEach(() => {
    window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU = undefined;
    window.__GQ_LEVEL_SHARED_RENDERER_THREEJS = undefined;
    window.__GQ_LEVEL_RENDERER_OPTIONS = undefined;
    window.GQGalaxy3DRendererWebGPU = undefined;
    window.Galaxy3DRendererWebGPU = undefined;
    window.Galaxy3DRenderer = undefined;
    window.GalaxyRendererCore = undefined;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU = undefined;
    window.__GQ_LEVEL_SHARED_RENDERER_THREEJS = undefined;
    window.__GQ_LEVEL_RENDERER_OPTIONS = undefined;
    window.GQGalaxy3DRendererWebGPU = undefined;
    window.Galaxy3DRendererWebGPU = undefined;
    window.Galaxy3DRenderer = undefined;
    window.GalaxyRendererCore = undefined;
  });

  it('GalaxyLevelWebGPU constructs with runtime options and stores shared instance', async () => {
    const { canvas } = makeCanvasHost();
    const init = vi.fn(async () => undefined);
    const ctor = vi.fn(function (_container, opts) {
      this._opts = opts;
      this.init = init;
      this.setStars = vi.fn();
      this.setClusterAuras = vi.fn();
      this.setFtlInfrastructure = vi.fn();
      this.setGalaxyFleets = vi.fn();
      this.dispose = vi.fn();
      return this;
    });

    window.GQGalaxy3DRendererWebGPU = ctor;
    window.__GQ_LEVEL_RENDERER_OPTIONS = {
      qualityProfile: 'low',
      onHover: vi.fn(),
    };

    const level = new GalaxyLevelWebGPU();
    await level.initialize(canvas, {});

    expect(ctor).toHaveBeenCalledTimes(1);
    const passedOpts = ctor.mock.calls[0][1];
    expect(passedOpts.externalCanvas).toBe(canvas);
    expect(passedOpts.interactive).toBe(true);
    expect(passedOpts.qualityProfile).toBe('low');
    expect(typeof passedOpts.onHover).toBe('function');
    expect(init).toHaveBeenCalledTimes(1);
    expect(window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU).toBe(level._starfield);
  });

  it('GalaxyLevelWebGPU reuses shared renderer and merges runtime options into _opts', async () => {
    const { canvas } = makeCanvasHost();
    const shared = {
      _opts: { interactive: true },
      dispose: vi.fn(),
      setStars: vi.fn(),
      setClusterAuras: vi.fn(),
      setFtlInfrastructure: vi.fn(),
      setGalaxyFleets: vi.fn(),
    };
    window.__GQ_LEVEL_SHARED_RENDERER_WEBGPU = shared;
    window.__GQ_LEVEL_RENDERER_OPTIONS = { qualityProfile: 'ultra', onClick: vi.fn() };
    window.GQGalaxy3DRendererWebGPU = vi.fn();

    const level = new GalaxyLevelWebGPU();
    await level.initialize(canvas, {});

    expect(level._starfield).toBe(shared);
    expect(shared._opts.qualityProfile).toBe('ultra');
    expect(typeof shared._opts.onClick).toBe('function');
    expect(window.GQGalaxy3DRendererWebGPU).not.toHaveBeenCalled();
  });

  it('GalaxyLevelThreeJS constructs with runtime options and stores shared instance', async () => {
    const { canvas } = makeCanvasHost();
    const ctor = vi.fn(function (_container, opts) {
      this.opts = opts;
      this.setStars = vi.fn();
      this.dispose = vi.fn();
      return this;
    });

    window.Galaxy3DRenderer = ctor;
    window.__GQ_LEVEL_RENDERER_OPTIONS = {
      qualityProfile: 'medium',
      onDoubleClick: vi.fn(),
    };

    const level = new GalaxyLevelThreeJS();
    await level.initialize(canvas, {});

    expect(ctor).toHaveBeenCalledTimes(1);
    const passedOpts = ctor.mock.calls[0][1];
    expect(passedOpts.externalCanvas).toBe(canvas);
    expect(passedOpts.interactive).toBe(true);
    expect(passedOpts.qualityProfile).toBe('medium');
    expect(typeof passedOpts.onDoubleClick).toBe('function');
    expect(window.__GQ_LEVEL_SHARED_RENDERER_THREEJS).toBe(level._renderer);
  });

  it('GalaxyLevelThreeJS reuses shared renderer and merges runtime options into opts', async () => {
    const { canvas } = makeCanvasHost();
    const shared = {
      opts: { interactive: true },
      setStars: vi.fn(),
      dispose: vi.fn(),
    };
    window.__GQ_LEVEL_SHARED_RENDERER_THREEJS = shared;
    window.__GQ_LEVEL_RENDERER_OPTIONS = { qualityProfile: 'high', onHover: vi.fn() };
    window.Galaxy3DRenderer = vi.fn();

    const level = new GalaxyLevelThreeJS();
    await level.initialize(canvas, {});

    expect(level._renderer).toBe(shared);
    expect(shared.opts.qualityProfile).toBe('high');
    expect(typeof shared.opts.onHover).toBe('function');
    expect(window.Galaxy3DRenderer).not.toHaveBeenCalled();
  });

  it('SystemLevelThreeJS enter prefers sceneData systemPayload over transition payload', async () => {
    const level = new SystemLevelThreeJS();
    const enterSystemView = vi.fn();
    level._renderer = { enterSystemView };

    const sceneStar = { id: 'scene-star' };
    const scenePayload = { planets: [{ slot_index: 1 }] };
    level.setSceneData({ star: sceneStar, systemPayload: scenePayload });

    await level.enter(null, { star: { id: 'transition-star' }, planets: [] });

    expect(enterSystemView).toHaveBeenCalledTimes(1);
    expect(enterSystemView).toHaveBeenCalledWith(sceneStar, scenePayload);
  });

  it('SystemLevelWebGPU enter prefers sceneData systemPayload over transition payload', async () => {
    const level = new SystemLevelWebGPU();
    const enterSystemView = vi.fn();
    level._starfield = { enterSystemView };

    const sceneStar = { id: 'scene-star' };
    const scenePayload = { planets: [{ slot_index: 2 }] };
    level.setSceneData({ star: sceneStar, systemPayload: scenePayload });

    await level.enter(null, { star: { id: 'transition-star' }, planets: [] });

    expect(enterSystemView).toHaveBeenCalledTimes(1);
    expect(enterSystemView).toHaveBeenCalledWith(sceneStar, scenePayload);
  });

  it('SystemLevelThreeJS applies focusPlanet from sceneData', () => {
    const level = new SystemLevelThreeJS();
    const focusOnSystemPlanet = vi.fn();
    level._renderer = { focusOnSystemPlanet };

    const focusPlanet = { position: 3 };
    level.setSceneData({ focusPlanet });

    expect(focusOnSystemPlanet).toHaveBeenCalledTimes(1);
    expect(focusOnSystemPlanet).toHaveBeenCalledWith(focusPlanet, true);
  });

  it('SystemLevelWebGPU applies focusPlanet from sceneData', () => {
    const level = new SystemLevelWebGPU();
    const focusOnSystemPlanet = vi.fn();
    level._starfield = { focusOnSystemPlanet };

    const focusPlanet = { position: 4 };
    level.setSceneData({ focusPlanet });

    expect(focusOnSystemPlanet).toHaveBeenCalledTimes(1);
    expect(focusOnSystemPlanet).toHaveBeenCalledWith(focusPlanet, true);
  });
});
