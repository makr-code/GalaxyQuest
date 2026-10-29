// @vitest-environment node
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import configure from '../../vite.config.mjs';

let vite;
let backend;

afterEach(async () => {
  await vite?.close();
  if (backend?.listening) await new Promise((resolve) => backend.close(resolve));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('proxies PHP APIs with session cookies and returns an explicit JSON error when PHP is offline', async () => {
  const requests = [];
  backend = createHttpServer((req, res) => {
    requests.push({ url: req.url, cookie: req.headers.cookie, method: req.method });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'PHPSESSID=proxy-test; Path=/; HttpOnly',
    });
    res.end(JSON.stringify({ success: true, source: 'php-fixture' }));
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  vi.stubEnv('GQ_PHP_BACKEND_URL', `http://127.0.0.1:${backend.address().port}`);
  const config = configure({ mode: 'test' });
  vite = await createServer({
    ...config,
    configFile: false,
    server: { ...config.server, port: 0, watch: null, hmr: false },
  });
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  for (const endpoint of [
    '/api/auth.php?action=register_catalog',
    '/api/v1/server_announcements.php?action=list',
    '/api/registration_narration.php?clip=teaser-distance',
  ]) {
    const response = await fetch(`${base}${endpoint}`, { headers: { Cookie: 'PHPSESSID=existing-session' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, source: 'php-fixture' });
    expect(response.headers.get('set-cookie')).toContain('PHPSESSID=proxy-test');
    expect(requests.at(-1)).toEqual({ url: endpoint, cookie: 'PHPSESSID=existing-session', method: 'GET' });
  }
  const posted = await fetch(`${base}/api/auth.php?action=register_prepare`, { method: 'POST', body: '{}' });
  expect(posted.status).toBe(200);
  expect(requests.at(-1).method).toBe('POST');
  const audio = await fetch(`${base}/api/audio.php?action=list`);
  expect(audio.status).toBe(200);
  expect((await audio.json()).tracks.length).toBeGreaterThan(1);
  await new Promise((resolve) => backend.close(resolve));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const offline = await fetch(`${base}/api/auth.php?action=register_catalog`);
  expect(offline.status).toBe(502);
  expect(offline.headers.get('content-type')).toContain('application/json');
  expect(await offline.json()).toEqual({ success: false, error: expect.stringContaining('PHP backend unavailable') });
  expect(errors).toHaveBeenCalled();
});
