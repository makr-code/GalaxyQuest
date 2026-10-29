const AUTH_GALAXY_SAMPLE_LEVELS = [1200, 4500, 9000];

export async function loadAuthGalaxySamples({ onSample, fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof onSample !== 'function') {
    throw new TypeError('onSample must be a function');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  for (const maxPoints of AUTH_GALAXY_SAMPLE_LEVELS) {
    if (signal?.aborted) return;

    const endpoint = `api/v1/galaxy.php?action=auth_stars&galaxy=1&from=1&max_points=${maxPoints}`;
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      throw new Error(`Auth galaxy request failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data?.success !== true || !Array.isArray(data.stars)) {
      throw new Error('Auth galaxy request returned an invalid payload');
    }
    if (signal?.aborted) return;

    await onSample({
      maxPoints,
      stars: data.stars,
      occupiedSystems: Array.isArray(data.occupied_systems) ? data.occupied_systems : [],
      systemMax: Number(data.system_max) || null,
    });
  }
}
