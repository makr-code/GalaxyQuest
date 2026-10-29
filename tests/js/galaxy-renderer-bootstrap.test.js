import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { bootstrapSeamlessZoomOrchestrator } = require(path.join(root, 'js/engine/runtime/GalaxyRendererBootstrap.js'));

describe('GalaxyRendererBootstrap', () => {
  it('registers available WebGPU zoom levels even without Three.js counterparts', () => {
    const register = vi.fn();
    const initialize = vi.fn().mockResolvedValue(undefined);
    const zoomTo = vi.fn().mockResolvedValue(undefined);

    class MockOrchestrator {
      constructor(_canvas, opts) {
        this.opts = opts;
        this.register = register;
        this.initialize = initialize;
        this.zoomTo = zoomTo;
        this.dispose = vi.fn();
      }
    }

    const galaxyWebGPU = class {};
    const systemWebGPU = class {};
    const canvas = document.createElement('canvas');

    const orchestrator = bootstrapSeamlessZoomOrchestrator({
      sharedCanvas: canvas,
      settingsState: { renderQualityProfile: 'medium' },
      SeamlessZoomOrchestrator: MockOrchestrator,
      ZOOM_LEVEL: { GALAXY: 0, SYSTEM: 1 },
      levels: { galaxyWebGPU, systemWebGPU },
      adoptSharedRendererIfAvailable: () => {},
      initDirectRendererFallback: () => {},
    });

    expect(register).toHaveBeenCalledWith(0, { webgpu: galaxyWebGPU, threejs: undefined });
    expect(register).toHaveBeenCalledWith(1, { webgpu: systemWebGPU, threejs: undefined });
    expect(orchestrator.opts.rendererHint).toBe('webgpu');
  });

  it('creates one shared renderer backend for the zoom orchestrator', () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    let sharedRenderer = null;
    class MockRenderer {
      constructor(container, opts) {
        this.container = container;
        this.opts = opts;
        this.init = initialize;
        sharedRenderer = this;
      }
    }

    class MockOrchestrator {
      constructor(_canvas, opts) {
        this.opts = opts;
        this.register = vi.fn();
        this.initialize = vi.fn().mockResolvedValue(undefined);
        this.zoomTo = vi.fn().mockResolvedValue(undefined);
        this.dispose = vi.fn();
      }
    }

    const { host, canvas } = (() => {
      const host = document.createElement('div');
      const canvas = document.createElement('canvas');
      host.appendChild(canvas);
      return { host, canvas };
    })();
    const rendererOptions = { qualityProfile: 'webgpu' };
    const orchestrator = bootstrapSeamlessZoomOrchestrator({
      sharedCanvas: canvas,
      rendererCtor: MockRenderer,
      rendererContainer: host,
      rendererOptions,
      SeamlessZoomOrchestrator: MockOrchestrator,
      ZOOM_LEVEL: { GALAXY: 0 },
      levels: { galaxyWebGPU: class {} },
    });

    expect(sharedRenderer.container).toBe(host);
    expect(sharedRenderer.opts).toMatchObject({
      qualityProfile: 'webgpu',
      externalCanvas: canvas,
      interactive: true,
    });
    expect(orchestrator.opts.backend).toBe(sharedRenderer);
    expect(orchestrator.opts.requireSharedBackend).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('registers COLONY_BUILDING level when provided', () => {
    const register = vi.fn();
    const initialize = vi.fn().mockResolvedValue(undefined);
    const zoomTo = vi.fn().mockResolvedValue(undefined);

    class MockOrchestrator {
      constructor(_canvas, opts) {
        this.opts = opts;
        this.register = register;
        this.initialize = initialize;
        this.zoomTo = zoomTo;
        this.dispose = vi.fn();
      }
    }

    const canvas = document.createElement('canvas');

    bootstrapSeamlessZoomOrchestrator({
      currentOrchestrator: null,
      setOrchestrator: () => {},
      getCurrentOrchestrator: () => null,
      sharedCanvas: canvas,
      settingsState: { renderQualityProfile: 'webgpu' },
      SeamlessZoomOrchestrator: MockOrchestrator,
      ZOOM_LEVEL: {
        GALAXY: 0,
        SYSTEM: 1,
        PLANET_APPROACH: 2,
        COLONY_SURFACE: 3,
        OBJECT_APPROACH: 4,
        COLONY_BUILDING: 5,
      },
      levels: {
        galaxyWebGPU: class {}, galaxyThreeJS: class {},
        systemWebGPU: class {}, systemThreeJS: class {},
        planetWebGPU: class {}, planetThreeJS: class {},
        colonyWebGPU: class {}, colonyThreeJS: class {},
        objectWebGPU: class {}, objectThreeJS: class {},
        colonyBuildingWebGPU: class {}, colonyBuildingThreeJS: class {},
      },
      adoptSharedRendererIfAvailable: () => {},
      initDirectRendererFallback: () => {},
      onDisposeError: () => {},
      onInitFailed: () => {},
    });

    expect(register.mock.calls.length).toBeGreaterThan(0);
    expect(register).toHaveBeenCalledWith(5, expect.objectContaining({
      webgpu: expect.any(Function),
      threejs: expect.any(Function),
    }));
  });

  it('ignores stale initialize callbacks once a newer orchestrator replaced it', async () => {
    let current = null;
    let resolveInitialize = null;
    const onInitFailed = vi.fn();

    class MockOrchestrator {
      constructor() {
        this.register = vi.fn();
        this.dispose = vi.fn();
        this.zoomTo = vi.fn().mockRejectedValue(new Error('stale-zoom'));
        this.initialize = vi.fn().mockImplementation(() => new Promise((resolve) => {
          resolveInitialize = resolve;
        }));
      }
    }

    const canvasA = document.createElement('canvas');
    const canvasB = document.createElement('canvas');
    const zoomLevels = {
      GALAXY: 0,
      SYSTEM: 1,
      PLANET_APPROACH: 2,
      COLONY_SURFACE: 3,
      OBJECT_APPROACH: 4,
      COLONY_BUILDING: 5,
    };
    const levels = {
      galaxyWebGPU: class {}, galaxyThreeJS: class {},
      systemWebGPU: class {}, systemThreeJS: class {},
      planetWebGPU: class {}, planetThreeJS: class {},
      colonyWebGPU: class {}, colonyThreeJS: class {},
      objectWebGPU: class {}, objectThreeJS: class {},
    };

    const first = bootstrapSeamlessZoomOrchestrator({
      currentOrchestrator: null,
      setOrchestrator: (next) => { current = next; },
      getCurrentOrchestrator: () => current,
      sharedCanvas: canvasA,
      settingsState: { renderQualityProfile: 'webgpu' },
      SeamlessZoomOrchestrator: MockOrchestrator,
      ZOOM_LEVEL: zoomLevels,
      levels,
      adoptSharedRendererIfAvailable: () => {},
      initDirectRendererFallback: () => {},
      onDisposeError: () => {},
      onInitFailed,
    });

    const second = bootstrapSeamlessZoomOrchestrator({
      currentOrchestrator: first,
      setOrchestrator: (next) => { current = next; },
      getCurrentOrchestrator: () => current,
      sharedCanvas: canvasB,
      settingsState: { renderQualityProfile: 'webgpu' },
      SeamlessZoomOrchestrator: MockOrchestrator,
      ZOOM_LEVEL: zoomLevels,
      levels,
      adoptSharedRendererIfAvailable: () => {},
      initDirectRendererFallback: () => {},
      onDisposeError: () => {},
      onInitFailed,
    });

    expect(current).toBe(second);

    resolveInitialize();
    await Promise.resolve();
    await Promise.resolve();

    expect(onInitFailed).not.toHaveBeenCalled();
    expect(current).toBe(second);
  });
});
