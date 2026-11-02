import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preload: vi.fn(), coreLoaded: vi.fn() }));

vi.mock('../../js/runtime/model_registry.js', () => {
  window.__GQ_ModelRegistry = { preload: mocks.preload };
  return {};
});
vi.mock('../../js/rendering/galaxy-renderer-core.js', () => {
  mocks.coreLoaded();
  return {};
});

describe('model registry runtime activation', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.preload.mockReset().mockResolvedValue([]);
    mocks.coreLoaded.mockReset();
  });

  afterEach(() => { delete window.__GQ_ModelRegistry; });

  it('registers the registry locally without blocking core loading on never-settling preloads', async () => {
    mocks.preload.mockImplementation(() => new Promise(() => {}));
    const { loadRuntimeModule } = await import('../../js/runtime/runtime-module-loader.js');
    await loadRuntimeModule('js/runtime/model_registry.js');
    expect(window.__GQ_ModelRegistry).toBeDefined();
    expect(mocks.preload).not.toHaveBeenCalled();
    const pending = loadRuntimeModule('js/rendering/galaxy-renderer-core.js?v=1');
    expect(loadRuntimeModule('js/rendering/galaxy-renderer-core.js?v=2')).toBe(pending);
    await pending;
    expect(mocks.preload).toHaveBeenCalledOnce();
    expect(mocks.coreLoaded).toHaveBeenCalledOnce();
  });

  it('catches background preload failure without preventing core initialization', async () => {
    const failure = new Error('network unavailable');
    mocks.preload.mockRejectedValue(failure);
    window.__GQ_ModelRegistry = { preload: mocks.preload };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadRuntimeModule } = await import('../../js/runtime/runtime-module-loader.js');
    await expect(loadRuntimeModule('js/rendering/galaxy-renderer-core.js')).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      '[ModelRegistry] background preload failed:', failure,
    ));
  });
});
