import { describe, expect, it, vi } from 'vitest';
import { loadAuthGalaxySamples } from '../../js/rendering/auth-galaxy-loader.js';

describe('auth galaxy progressive loader', () => {
  it('requests increasingly detailed samples and reports each response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        stars: [{ system_index: fetchImpl.mock.calls.length }],
        occupied_systems: [1],
        system_max: 50000,
        arm_count: 6,
        pitch_angle_deg: 14,
      }),
    }));
    const onSample = vi.fn();

    await loadAuthGalaxySamples({ fetchImpl, onSample });

    expect(fetchImpl.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      'api/v1/galaxy.php?action=auth_stars&galaxy=1&from=1&max_points=1200',
      'api/v1/galaxy.php?action=auth_stars&galaxy=1&from=1&max_points=4500',
      'api/v1/galaxy.php?action=auth_stars&galaxy=1&from=1&max_points=9000',
    ]);
    expect(onSample).toHaveBeenCalledTimes(3);
    expect(onSample.mock.calls.map(([sample]) => sample.maxPoints)).toEqual([1200, 4500, 9000]);
    expect(onSample.mock.calls[2][0]).toMatchObject({
      stars: [{ system_index: 3 }],
      occupiedSystems: [1],
      systemMax: 50000,
      armCount: 6,
      pitchAngleDeg: 14,
    });
  });

  it('stops issuing requests when aborted between samples', async () => {
    const abortController = new AbortController();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, stars: [], occupied_systems: [] }),
    }));
    const onSample = vi.fn(() => abortController.abort());

    await loadAuthGalaxySamples({
      fetchImpl,
      onSample,
      signal: abortController.signal,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSample).toHaveBeenCalledTimes(1);
  });

  it('reports server errors instead of treating them as successful empty data', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));

    await expect(loadAuthGalaxySamples({
      fetchImpl,
      onSample: vi.fn(),
    })).rejects.toThrow('Auth galaxy request failed with HTTP 503');
  });

  it('rejects malformed response payloads', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, stars: null }),
    }));

    await expect(loadAuthGalaxySamples({
      fetchImpl,
      onSample: vi.fn(),
    })).rejects.toThrow('Auth galaxy request returned an invalid payload');
  });
});
