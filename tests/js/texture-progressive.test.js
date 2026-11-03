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

  const mockPostResponse = (response) => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('auth.php?action=csrf')) {
        return Promise.resolve({ ok: true, json: async () => ({ token: 'test-csrf-token' }) });
      }
      return Promise.resolve(response);
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts for high-res JSON then loads the returned image and emits an upgrade', async () => {
    const texture = {};
    loadAsync.mockResolvedValue(texture);
    mockPostResponse({
      ok: true,
      json: async () => ({ success: true, phase: 'high_res_ready', high_res: { path: 'generated/high.png' } })
    });
    const request = { action: 'progressive', phase: 'high_res', target_size: 512 };
    await manager._loadHighResProgressiveTextureAsync(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
    }));
    expect(fetchMock.mock.calls[1][0]).toContain('api/textures-ai.php?action=progressive');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'test-csrf-token' }),
      body: JSON.stringify({ phase: 'high_res', target_size: 512 }),
    }));
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
    mockPostResponse(response);
    await manager._loadHighResProgressiveTextureAsync({ action: 'progressive', phase: 'high_res' });
    expect(loadAsync).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('reports image failures without emitting upgrades', async () => {
    mockPostResponse({
      ok: true,
      json: async () => ({ success: true, phase: 'high_res_ready', high_res: { path: 'high.png' } })
    });
    loadAsync.mockRejectedValue(new Error('image unavailable'));
    await manager._loadHighResProgressiveTextureAsync({ action: 'progressive', phase: 'high_res' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('keeps low-res loading and returns a high-res POST request descriptor', async () => {
    const highRequest = { action: 'progressive', target_size: 513, phase: 'high_res', seed: 0 };
    mockPostResponse({
      ok: true,
      json: async () => ({ success: true, low_res: { path: 'low.png' }, high_res_request: highRequest })
    });
    const high = vi.spyOn(manager, '_loadHighResProgressiveTextureAsync').mockResolvedValue();
    const result = await manager.requestProgressiveTexture({ seed: 0 }, { size: 513 });
    expect(loadAsync).toHaveBeenCalledExactlyOnceWith('low.png');
    expect(high).toHaveBeenCalledExactlyOnceWith(highRequest);
    expect(result.success).toBe(true);
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('textures-ai.php'));
    expect(post[1].method).toBe('POST');
    expect(post[1].credentials).toBe('same-origin');
    expect(post[1].headers['X-CSRF-Token']).toBe('test-csrf-token');
    expect(JSON.parse(post[1].body).seed).toBe(0);
    expect(JSON.parse(post[1].body).target_size).toBe(513);
  });
});
