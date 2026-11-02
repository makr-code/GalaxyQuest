import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const mocks = vi.hoisted(() => ({ preload: vi.fn(), coreLoaded: vi.fn() }));

vi.mock('../../js/runtime/model_registry.js', () => {
  window.__GQ_ModelRegistry = { preload: mocks.preload };
  return {};
});
vi.mock('../../js/rendering/galaxy-renderer-core.js', () => {
  mocks.coreLoaded({
    generator: window.GQProceduralMeshGenerator?.ProceduralMeshGenerator,
    bodies: window.GQSystemSpecialBodiesRenderer,
  });
  return {};
});

describe('normal runtime asteroid activation', () => {
  beforeEach(() => {
    vi.resetModules();
    window.THREE = THREE;
    delete window.GQProceduralMeshGenerator;
    delete window.GQSystemSpecialBodiesRenderer;
    mocks.preload.mockReset().mockImplementation(() => new Promise(() => {}));
    mocks.coreLoaded.mockReset();
  });

  afterEach(() => {
    delete window.THREE;
    delete window.GQProceduralMeshGenerator;
    delete window.GQSystemSpecialBodiesRenderer;
    delete window.__GQ_ModelRegistry;
  });

  it('loads the seeded geometry and special-body factories before the core without awaiting network preload', async () => {
    const { loadRuntimeModule } = await import('../../js/runtime/runtime-module-loader.js');
    const pending = loadRuntimeModule('js/rendering/galaxy-renderer-core.js?v=1');
    expect(loadRuntimeModule('js/rendering/galaxy-renderer-core.js?v=2')).toBe(pending);
    await pending;
    expect(mocks.preload).toHaveBeenCalledOnce();
    expect(mocks.coreLoaded).toHaveBeenCalledWith({
      generator: expect.any(Function),
      bodies: expect.objectContaining({ buildSpecialBodyMesh: expect.any(Function) }),
    });
  });

  it('can load the special-body module directly with its procedural dependency', async () => {
    const { loadRuntimeModule } = await import('../../js/runtime/runtime-module-loader.js');
    await loadRuntimeModule('js/rendering/SystemSpecialBodiesRenderer.js');
    expect(window.GQProceduralMeshGenerator?.ProceduralMeshGenerator).toBeTypeOf('function');
    expect(window.GQSystemSpecialBodiesRenderer?.buildSpecialBodyMesh).toBeTypeOf('function');
    expect(mocks.preload).not.toHaveBeenCalled();
  });
});
