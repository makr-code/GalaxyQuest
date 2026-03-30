import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const apiPath = path.resolve(process.cwd(), 'js/network/api.js');

function loadApiScript() {
  delete window.API;
  const source = fs.readFileSync(apiPath, 'utf8');
  window.eval(source);
  return window.API;
}

function okJson(data) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
    },
    json: async () => data,
    clone() {
      return this;
    },
  };
}

describe('API wrapper versioning', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('fetch', vi.fn(async (endpoint) => {
      const ep = String(endpoint || '');
      if (ep.includes('auth.php?action=csrf')) {
        return okJson({ success: true, token: 'csrf_token_test' });
      }
      return okJson({ success: true, endpoint: ep });
    }));
  });

  it('rewrites relative api endpoints to api/v1', async () => {
    const API = loadApiScript();

    await API.get('api/game.php?action=health', { cacheMode: 'no-store' });

    expect(global.fetch).toHaveBeenCalled();
    const calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    expect(calledEndpoint).toContain('api/v1/game.php?action=health');
  });

  it('keeps absolute URLs unchanged', async () => {
    const API = loadApiScript();

    await API.get('https://example.com/api/ping', { cacheMode: 'no-store' });

    const calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    expect(calledEndpoint).toBe('https://example.com/api/ping');
  });
});
