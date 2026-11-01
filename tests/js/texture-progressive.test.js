import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../js/rendering/texture-manager.js';

describe('actual progressive texture manager', () => {
  let manager;
  let loadAsync;
  let fetchMock;
  let dispatch;

  beforeEach(() => {
    loadAsync = vi.fn().mockResolvedValue({});
    manager = new window.GQTextureManager({
      three: { TextureLoader: class { loadAsync = loadAsync; }, SRGBColorSpace: 'srgb' }
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    dispatch = vi.spyOn(window, 'dispatchEvent');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches high-res JSON then loads the returned image and emits an upgrade', async () => {
    const texture = {};
    loadAsync.mockResolvedValue(texture);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, phase: 'high_res_ready', high_res: { path: 'generated/high.png' } })
    });
    await manager._loadHighResProgressiveTextureAsync('api/textures-ai.php?phase=high_res');
    expect(fetchMock).toHaveBeenCalledWith('api/textures-ai.php?phase=high_res', expect.objectContaining({ method: 'GET' }));
    expect(loadAsync).toHaveBeenCalledExactlyOnceWith('generated/high.png');
    expect(texture).toEqual({ colorSpace: 'srgb', needsUpdate: true });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].type).toBe('GQ:textureUpgrade');
    expect(dispatch.mock.calls[0][0].detail.texture).toBe(texture);
  });

  it.each([
    { ok: false, status: 500 },
    { ok: true, json: async () => ({ success: false, error: 'failed' }) },
    { ok: true, json: async () => ({ success: true, phase: 'low_res_ready', low_res: { path: 'low.png' } }) },
    { ok: true, json: async () => ({ success: true, phase: 'high_res_ready' }) },
    { ok: true, json: async () => ({ success: true, phase: 'high_res_ready', high_res: { path: {} } }) },
    { ok: true, json: async () => { throw new Error('invalid JSON'); } }
  ])('does not load an image or emit an upgrade on invalid backend response %#', async (response) => {
    fetchMock.mockResolvedValue(response);
    await manager._loadHighResProgressiveTextureAsync('api/high');
    expect(loadAsync).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('reports image failures without emitting upgrades', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, phase: 'high_res_ready', high_res: { path: 'high.png' } })
    });
    loadAsync.mockRejectedValue(new Error('image unavailable'));
    await manager._loadHighResProgressiveTextureAsync('api/high');
    expect(dispatch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('keeps low-res loading and follows the high-res API URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, low_res: { path: 'low.png' }, high_res_url: 'api/high' })
    });
    const high = vi.spyOn(manager, '_loadHighResProgressiveTextureAsync').mockResolvedValue();
    const result = await manager.requestProgressiveTexture({ seed: 0 }, { size: 513 });
    expect(loadAsync).toHaveBeenCalledExactlyOnceWith('low.png');
    expect(high).toHaveBeenCalledExactlyOnceWith('api/high');
    expect(result.success).toBe(true);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('seed')).toBe('0');
    expect(url.searchParams.get('target_size')).toBe('513');
  });
});
