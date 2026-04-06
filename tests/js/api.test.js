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

  it('exposes war list and status getters on the shared API wrapper', async () => {
    const API = loadApiScript();

    await API.wars();
    let calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    expect(calledEndpoint).toContain('api/v1/war.php?action=list');

    await API.warStatus(42);
    calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    expect(calledEndpoint).toContain('api/v1/war.php?action=get_status&war_id=42');
  });

  it('normalizes strategic war mutation payloads before posting', async () => {
    const API = loadApiScript();

    await API.declareStrategicWar({
      target_user_id: '7',
      war_goals: [{ type: 'annex_system', target_id: 4 }],
      casus_belli: 99,
    });
    let calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    let requestInit = global.fetch.mock.calls.at(-1)[1] || {};
    let payload = JSON.parse(String(requestInit.body || '{}'));
    expect(calledEndpoint).toContain('api/v1/war.php?action=declare');
    expect(payload).toMatchObject({
      target_user_id: 7,
      war_goals: [{ type: 'annex_system', target_id: 4 }],
      casus_belli: '99',
    });

    await API.offerPeace({ war_id: '15', terms: 'white-peace' });
    calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    requestInit = global.fetch.mock.calls.at(-1)[1] || {};
    payload = JSON.parse(String(requestInit.body || '{}'));
    expect(calledEndpoint).toContain('api/v1/war.php?action=offer_peace');
    expect(payload).toEqual({ war_id: 15, terms: [] });

    await API.respondPeaceOffer({ offer_id: '23', accept: 1 });
    calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    requestInit = global.fetch.mock.calls.at(-1)[1] || {};
    payload = JSON.parse(String(requestInit.body || '{}'));
    expect(calledEndpoint).toContain('api/v1/war.php?action=respond_peace');
    expect(payload).toEqual({ offer_id: 23, accept: true });
  });
});
