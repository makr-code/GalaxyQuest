import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const clientPath = path.resolve(process.cwd(), 'js/systems/game_guide_system.js');

function loadGameGuideSystem() {
  delete window.GameGuideSystem;
  delete window.gameState;
  delete window.APISession;
  window.eval(fs.readFileSync(clientPath, 'utf8'));
  return window.GameGuideSystem;
}

function okJson(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

describe('Game guide session request contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('fetch', vi.fn(async (endpoint) => {
      if (String(endpoint).includes('auth.php?action=csrf')) {
        return okJson({ success: true, token: 'csrf-token' });
      }
      return okJson({ success: true, ok: true, greeting: 'Welcome' });
    }));
  });

  it('uses the same-origin session for authenticated reads without a bearer token', async () => {
    const GameGuideSystem = loadGameGuideSystem();
    const guide = new GameGuideSystem();

    await guide.getGreeting();

    const [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('/api/game_guide.php?action=greeting');
    expect(requestInit.method).toBe('GET');
    expect(requestInit.credentials).toBe('same-origin');
    expect(requestInit.headers.Authorization).toBeUndefined();
  });

  it('fetches a CSRF token and sends it with session-authenticated mutations', async () => {
    const GameGuideSystem = loadGameGuideSystem();
    const guide = new GameGuideSystem();

    await guide.recordCheckpoint('game_started');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [csrfEndpoint, csrfInit] = global.fetch.mock.calls[0];
    expect(String(csrfEndpoint)).toContain('/api/auth.php?action=csrf');
    expect(csrfInit.credentials).toBe('same-origin');

    const [, requestInit] = global.fetch.mock.calls[1];
    expect(requestInit.method).toBe('POST');
    expect(requestInit.credentials).toBe('same-origin');
    expect(requestInit.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(requestInit.body.get('csrf_token')).toBe('csrf-token');
    expect(requestInit.headers.Authorization).toBeUndefined();
  });
});
