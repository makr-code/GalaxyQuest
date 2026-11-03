import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../js/api.js';

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Module API uses real transport and session helpers', () => {
  beforeEach(() => {
    window.APISession.resetSessionState();
    vi.stubGlobal('fetch', vi.fn(async () => response({ success: true })));
  });
  it('uses versioned, no-store, same-origin GET requests', async () => {
    await expect(API.get('api/game.php?action=overview')).resolves.toEqual({ success: true });
    expect(fetch).toHaveBeenCalledWith('api/v1/game.php?action=overview', expect.objectContaining({
      method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: expect.any(AbortSignal),
    }));
  });
  it('fetches a real CSRF token before mutations and never retries a failed POST', async () => {
    fetch.mockResolvedValueOnce(response({ success: true, token: 'token' }))
      .mockResolvedValueOnce(response({ success: false, error: 'Conflict' }, 409));
    await expect(API.post('api/game.php?action=rename_colony', { colony_id: 1, name: 'New' }))
      .rejects.toMatchObject({ status: 409, message: 'Conflict' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('token');
  });
  it('refuses a mutation when CSRF retrieval fails', async () => {
    fetch.mockResolvedValueOnce(response({ success: true }));
    await expect(API.post('api/game.php?action=rename_colony', {})).rejects.toThrow('CSRF token');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('rejects success-shaped transport responses with failed application status', async () => {
    fetch.mockResolvedValueOnce(response({ success: false, error: 'Denied' }));
    await expect(API.get('api/game.php?action=overview')).rejects.toThrow('Denied');
  });
  it('does not send a request after its signal has already been aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(API.get('api/game.php?action=overview', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not submit a command after logout while its CSRF request was pending', async () => {
    const controller = new AbortController();
    let resolve;
    fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const command = API.post('api/buildings.php?action=upgrade', { colony_id: 1, type: 'metal_mine' },
      { signal: controller.signal });
    controller.abort();
    resolve(response({ success: true, token: 'old-session' }));
    await expect(command).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
