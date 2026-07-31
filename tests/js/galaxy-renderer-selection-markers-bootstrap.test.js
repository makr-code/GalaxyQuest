import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const bootstrapPath = path.resolve(
  process.cwd(),
  'js/rendering/GalaxyRendererBootstrap-SelectionMarkers.js'
);

describe('GalaxyRendererBootstrap-SelectionMarkers', () => {
  let originalReadyState;
  let originalGlobals;

  beforeEach(() => {
    originalReadyState = Object.getOwnPropertyDescriptor(document, 'readyState');
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading',
    });

    originalGlobals = {
      Galaxy3DRendererWebGPU: window.Galaxy3DRendererWebGPU,
      GQGalaxy3DRendererWebGPU: window.GQGalaxy3DRendererWebGPU,
      Galaxy3DView: window.Galaxy3DView,
      GQSelectionMarkerOverlay: window.GQSelectionMarkerOverlay,
      GQGalaxy3DRendererWebGPUSelectionMarkerIntegration: window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration,
      GQRuntimeSelectionState: window.GQRuntimeSelectionState,
      GQSelectionMarkerStyleTokens: window.GQSelectionMarkerStyleTokens,
      GQPersistentSelectionMarkerRenderer: window.GQPersistentSelectionMarkerRenderer,
      GQSelectionMarkerCompositor: window.GQSelectionMarkerCompositor,
      GQSelectionMarkerAnimationEngine: window.GQSelectionMarkerAnimationEngine,
      GQGalaxyRendererBootstrapSelectionMarkers: window.GQGalaxyRendererBootstrapSelectionMarkers,
    };

    vi.spyOn(console, 'group').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalReadyState) {
      Object.defineProperty(document, 'readyState', originalReadyState);
    } else {
      delete document.readyState;
    }

    Object.entries(originalGlobals).forEach(([key, value]) => {
      if (typeof value === 'undefined') {
        delete window[key];
      } else {
        window[key] = value;
      }
    });
  });

  it('wraps the renderer class without invoking it as a plain function', () => {
    const apply = vi.fn().mockReturnValue(true);

    class MockRenderer {
      static getBackendName() {
        return 'mock-webgpu';
      }

      constructor(container, opts = {}) {
        this.container = container;
        this.opts = opts;
        this.constructed = true;
      }
    }

    window.Galaxy3DRendererWebGPU = MockRenderer;
    window.GQGalaxy3DRendererWebGPU = MockRenderer;
    window.Galaxy3DView = MockRenderer;
    window.GQSelectionMarkerOverlay = function() {};
    window.GQGalaxy3DRendererWebGPUSelectionMarkerIntegration = { apply };
    window.GQRuntimeSelectionState = {};
    window.GQSelectionMarkerStyleTokens = {};
    window.GQPersistentSelectionMarkerRenderer = {};
    window.GQSelectionMarkerCompositor = {};
    window.GQSelectionMarkerAnimationEngine = {};

    window.eval(fs.readFileSync(bootstrapPath, 'utf8'));

    expect(window.GQGalaxyRendererBootstrapSelectionMarkers.initialize()).toBe(true);

    const container = { id: 'canvas-host' };
    const renderer = new window.Galaxy3DRendererWebGPU(container, { mode: 'test' });

    expect(renderer).toBeInstanceOf(MockRenderer);
    expect(renderer.constructed).toBe(true);
    expect(renderer.container).toBe(container);
    expect(renderer.opts).toEqual({ mode: 'test' });
    expect(apply).toHaveBeenCalledWith(renderer);
    expect(window.Galaxy3DRendererWebGPU.getBackendName()).toBe('mock-webgpu');
    expect(window.Galaxy3DView).toBe(window.Galaxy3DRendererWebGPU);
  });
});
