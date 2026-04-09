import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const facadePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeMinimapFacade.js');

function loadModule() {
  delete window.GQRuntimeMinimapFacade;
  window.eval(fs.readFileSync(facadePath, 'utf8'));
  return window.GQRuntimeMinimapFacade;
}

function createInjectedApis(spies = {}) {
  return {
    runtimeMinimapHelpersApi: {
      createMinimapHelpers: vi.fn(() => ({
        projectPoint: vi.fn(() => ({ x: 0, y: 0 })),
        clampCanvasPoint: vi.fn((_, p) => p || { x: 0, y: 0 }),
        unprojectPoint: vi.fn(() => ({ x: 0, y: 0 })),
        resolveRendererPose: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      })),
    },
    runtimeMinimapCameraControlsApi: {
      createMinimapCameraControls: vi.fn(() => ({
        setTarget: vi.fn(),
        zoom: vi.fn(),
        queueTarget: vi.fn(),
      })),
    },
    runtimeMinimapOverlayApi: {
      createMinimapOverlay: vi.fn(() => ({
        drawCameraOverlay: vi.fn(),
      })),
    },
    runtimeMinimapRendererApi: {
      createMinimapRenderer: vi.fn(() => ({
        draw: vi.fn(),
      })),
    },
    runtimeMinimapInteractionsApi: {
      createMinimapInteractions: vi.fn(() => ({
        bind: vi.fn(),
      })),
    },
    runtimeMinimapLoopApi: {
      createMinimapLoop: vi.fn(() => ({
        ensureLoop: vi.fn(),
      })),
    },
    runtimeMinimapSeedApi: {
      createMinimapSeed: vi.fn(() => ({
        seedIfNeeded: vi.fn(),
      })),
    },
    runtimeMinimapDomScaffoldApi: {
      createMinimapDomScaffold: vi.fn(() => ({
        ensure: vi.fn(() => ({ wrap: {}, canvas: {}, hud: {} })),
      })),
    },
    runtimeMinimapNavigationBindingApi: {
      createMinimapNavigationBinding: vi.fn(() => ({
        bindOnce: spies.bindOnceSpy || vi.fn(),
      })),
    },
    runtimeMinimapRenderOrchestratorApi: {
      createMinimapRenderOrchestrator: vi.fn(() => ({
        render: spies.renderSpy || vi.fn(),
      })),
    },
  };
}

describe('RuntimeMinimapFacade injected APIs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.GQRuntimeMinimapFacade;
  });

  it('uses injected minimap APIs without requireRuntimeApi fallback', () => {
    const mod = loadModule();
    const bindOnceSpy = vi.fn();
    const renderSpy = vi.fn();
    const injectedApis = createInjectedApis({ bindOnceSpy, renderSpy });

    const facade = mod.createMinimapFacade({
      requireRuntimeApi: vi.fn(() => {
        throw new Error('requireRuntimeApi should not be called when APIs are injected');
      }),
      getGalaxy3d: () => ({ camera: {} }),
      getMinimapCamera: () => ({ x: 0, y: 0 }),
      getGalaxyStars: () => [],
      getColonies: () => [],
      getUiState: () => ({ activeGalaxy: 1 }),
      getTradeRoutes: () => [],
      getGalaxyBody: () => document.createElement('div'),
      renderGalaxyDetails: vi.fn(),
      openWindow: vi.fn(),
      isWindowOpen: vi.fn(() => true),
      requestFrame: vi.fn(),
      ...injectedApis,
    });

    facade.bindNavigationOnce();
    facade.render(document.createElement('div'));

    expect(bindOnceSpy).toHaveBeenCalledOnce();
    expect(renderSpy).toHaveBeenCalledOnce();
    expect(injectedApis.runtimeMinimapHelpersApi.createMinimapHelpers).toHaveBeenCalledOnce();
    expect(injectedApis.runtimeMinimapRenderOrchestratorApi.createMinimapRenderOrchestrator).toHaveBeenCalledOnce();
  });
});
