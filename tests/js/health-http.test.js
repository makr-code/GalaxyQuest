// @vitest-environment node
import { describe, expect, it } from 'vitest';

const base = process.env.GQ_BASE_URL || 'http://localhost:8081';
const ready = process.env.GQ_HEALTH_EXPECT_READY === '1';

describe.skipIf(process.env.GQ_HEALTH_HTTP_TESTS !== '1')('real HTTP health probe contract', () => {
  async function request(path, method = 'GET') {
    return fetch(new URL(path, base), {
      method, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
  }

  it('serves dependency-independent liveness with exact JSON and no session', async () => {
    const response = await request('/health/live');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ status: 'alive' });
  });
  it('reflects DB migration readiness without leaking internal details', async () => {
    const response = await request('/health/ready');
    expect(response.status).toBe(ready ? 200 : 503);
    expect(await response.json()).toEqual({ status: ready ? 'ready' : 'unavailable' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('retry-after')).toBe(ready ? null : '5');
  });
  it.each(['/health/live', '/health/ready'])('HEAD %s keeps status without a body', async (path) => {
    const response = await request(path, 'HEAD');
    expect(response.status).toBe(path.endsWith('ready') && !ready ? 503 : 200);
    expect(await response.text()).toBe('');
  });
  it.each(['/health/live', '/health/ready'])('rejects POST %s before probing', async (path) => {
    const response = await request(path, 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(await response.json()).toEqual({ status: 'method_not_allowed' });
  });
  it.each(['/health/unknown', '/health.php'])('does not fall through unknown probe %s to HTML', async (path) => {
    const response = await request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'not_found' });
  });
  it('ignores query parameters without switching the liveness probe to DB readiness', async () => {
    const response = await request('/health/live?mode=ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'alive' });
  });
});
