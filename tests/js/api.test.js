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

  it('sends the legacy fleet helper through the canonical action with its retry identity unchanged', async () => {
    const API = loadApiScript();
    const body = { origin_colony_id: 1, ships: { light_fighter: 40 }, request_id: 'stable-request-123' };
    await API.sendFleet(body);
    const [endpoint, request] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toBe('api/v1/fleet.php?action=send');
    expect(JSON.parse(request.body)).toEqual(body);
    expect(request.method).toBe('POST');
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

  it('marks a message as read through an explicit POST mutation', async () => {
    const API = loadApiScript();
    window.APISession.getCsrfToken = () => 'csrf_token_test';

    await API.readMsg(42);

    const [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/messages.php?action=read');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({ id: 42 });
    expect(requestInit.headers['X-CSRF-Token']).toBe('csrf_token_test');
  });

  it('generates glossary definitions through an explicit CSRF-protected POST', async () => {
    const API = loadApiScript();
    window.APISession.getCsrfToken = () => 'csrf_token_test';

    await API.generateGlossaryDefinition('white_dwarf');

    const [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/glossary.php?action=generate');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({ term: 'white_dwarf' });
    expect(requestInit.headers['X-CSRF-Token']).toBe('csrf_token_test');
  });

  it('keeps fleet listing read-only and exposes explicit arrival processing as a POST', async () => {
    const API = loadApiScript();

    await API.fleets({ cacheMode: 'no-store' });
    let [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/fleet.php?action=list');
    expect(requestInit.method).toBe('GET');

    await API.processFleetArrivals();
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/fleet.php?action=check');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({});
  });

  it('keeps trade listing read-only and exposes due-route dispatch as a POST', async () => {
    const API = loadApiScript();

    await API.tradeRoutes({ cacheMode: 'no-store' });
    let [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/trade.php?action=list');
    expect(requestInit.method).toBe('GET');

    await API.dispatchTradeRoutes();
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/trade.php?action=dispatch_due');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({});
  });

  it('uses explicit POST actions to settle building and shipyard queues', async () => {
    const API = loadApiScript();

    await API.finishBuilding(17);
    let [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/buildings.php?action=finish');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({ colony_id: 17 });

    await API.finishShipyard(17);
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/shipyard.php?action=finish');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({ colony_id: 17 });
  });

  it('keeps achievement progress checks explicit and reads fresh list data', async () => {
    const API = loadApiScript();

    await API.checkAchievements();
    let [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/achievements.php?action=check');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({});

    await API.achievements();
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/achievements.php?action=list');
    expect(requestInit.method).toBe('GET');
  });

  it('refreshes the leader marketplace through POST and reads candidates through GET', async () => {
    const API = loadApiScript();

    await API.refreshLeaderMarketplace();
    let [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/leaders.php?action=refresh_marketplace');
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(requestInit.body)).toEqual({});

    await API.leaderMarketplace();
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/leaders.php?action=marketplace');
    expect(requestInit.method).toBe('GET');
  });

  it('keeps building and shipyard data reads on list GET endpoints', async () => {
    const API = loadApiScript();

    await API.buildings(17);
    let [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/buildings.php?action=list&colony_id=17');
    expect(requestInit.method).toBe('GET');

    await API.ships(17);
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/shipyard.php?action=list&colony_id=17');
    expect(requestInit.method).toBe('GET');

    await API.shipyardHulls(17);
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/shipyard.php?action=list_hulls&colony_id=17');
    expect(requestInit.method).toBe('GET');

    await API.shipyardVessels(17);
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/shipyard.php?action=list_vessels&colony_id=17');
    expect(requestInit.method).toBe('GET');

    await API.shipyardModules(17, 'hull-a', 'compact');
    [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
    expect(String(endpoint)).toContain('api/v1/shipyard.php?action=list_modules');
    expect(String(endpoint)).toContain('colony_id=17');
    expect(String(endpoint)).toContain('hull_code=hull-a');
    expect(String(endpoint)).toContain('slot_layout_code=compact');
    expect(requestInit.method).toBe('GET');
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

describe('Colony buildings API methods', () => {
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

  it('uses the colony buildings endpoints and forwards mutation payloads', async () => {
    const API = loadApiScript();

    await API.colonyBuildingsLayout(17);
    let colonyBuildingRequests = global.fetch.mock.calls.filter(([endpoint]) =>
      String(endpoint).includes('api/v1/colony_buildings.php'),
    );
    expect(colonyBuildingRequests.map(([endpoint, init]) => [String(endpoint), init?.method || 'GET'])).toEqual([
      ['api/v1/colony_buildings.php?action=settle', 'POST'],
      ['api/v1/colony_buildings.php?action=get_layout&colony_id=17', 'GET'],
    ]);
    expect(JSON.parse(colonyBuildingRequests[0][1].body)).toEqual({ colony_id: 17 });

    const requests = [
      ['colonyBuildingsPlace', 'place_building', { colony_id: 17, building_type: 'farm', slot_x: 2, slot_y: 3 }],
      ['colonyBuildingsRemove', 'remove_building', { colony_id: 17, slot_x: 2, slot_y: 3 }],
      ['colonyBuildingsUpgrade', 'upgrade_slot', { colony_id: 17, slot_x: 2, slot_y: 3, completes_in_seconds: 45 }],
    ];

    for (const [method, action, payload] of requests) {
      await API[method](payload);

      const [endpoint, requestInit] = global.fetch.mock.calls.at(-1);
      expect(String(endpoint)).toContain(`api/v1/colony_buildings.php?action=${action}`);
      expect(requestInit.method).toBe('POST');
      expect(JSON.parse(requestInit.body)).toEqual(payload);
    }

    await API.colonyBuildingsSlotInfo(17, 2, 3);
    colonyBuildingRequests = global.fetch.mock.calls.filter(([endpoint]) =>
      String(endpoint).includes('api/v1/colony_buildings.php'),
    );
    expect(colonyBuildingRequests.slice(-2).map(([endpoint, init]) => [String(endpoint), init?.method || 'GET'])).toEqual([
      ['api/v1/colony_buildings.php?action=settle', 'POST'],
      ['api/v1/colony_buildings.php?action=get_slot_info&colony_id=17&slot_x=2&slot_y=3', 'GET'],
    ]);
  });
});

describe('API chatNpc', () => {
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

  it('calls chat_npc endpoint with faction_code, npc_name and player_message', async () => {
    const API = loadApiScript();

    await API.chatNpc({
      faction_code: 'vor_tak',
      npc_name: "General Drak'Mol",
      player_message: 'Was sind eure Absichten?',
    });

    const calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    const requestInit = global.fetch.mock.calls.at(-1)[1] || {};
    const payload = JSON.parse(String(requestInit.body || '{}'));

    expect(calledEndpoint).toContain('api/v1/llm.php?action=chat_npc');
    expect(payload.faction_code).toBe('vor_tak');
    expect(payload.npc_name).toBe("General Drak'Mol");
    expect(payload.player_message).toBe('Was sind eure Absichten?');
  });

  it('forwards optional session_id to continue existing session', async () => {
    const API = loadApiScript();

    await API.chatNpc({
      faction_code: 'vor_tak',
      npc_name: 'Admiral',
      player_message: 'Continue?',
      session_id: 17,
    });

    const requestInit = global.fetch.mock.calls.at(-1)[1] || {};
    const payload = JSON.parse(String(requestInit.body || '{}'));

    expect(payload.session_id).toBe(17);
  });

  it('exposes chatNpc on window.GQ_LLM', async () => {
    loadApiScript();
    expect(typeof window.GQ_LLM.chatNpc).toBe('function');
  });

  it('chatNpc forwards optional model and temperature', async () => {
    const API = loadApiScript();

    await API.chatNpc({
      faction_code: 'iron_fleet',
      npc_name: 'Admiral',
      player_message: 'Surrender?',
      model: 'llama3.1:8b',
      temperature: 0.7,
    });

    const requestInit = global.fetch.mock.calls.at(-1)[1] || {};
    const payload = JSON.parse(String(requestInit.body || '{}'));

    expect(payload.model).toBe('llama3.1:8b');
    expect(payload.temperature).toBe(0.7);
  });

  it('calls close_npc_session endpoint with session_id', async () => {
    const API = loadApiScript();

    await API.closeNpcSession({ session_id: 42 });

    const calledEndpoint = String(global.fetch.mock.calls.at(-1)[0] || '');
    const requestInit = global.fetch.mock.calls.at(-1)[1] || {};
    const payload = JSON.parse(String(requestInit.body || '{}'));

    expect(calledEndpoint).toContain('api/v1/llm.php?action=close_npc_session');
    expect(payload.session_id).toBe(42);
  });

  it('exposes closeNpcSession on window.GQ_LLM', async () => {
    loadApiScript();
    expect(typeof window.GQ_LLM.closeNpcSession).toBe('function');
  });

  it('chatNpc response passes through suggested_replies from server', async () => {
    const suggestions = ['Ich stimme zu.', 'Ich bin skeptisch.', 'Das lehne ich ab.'];
    vi.stubGlobal('fetch', vi.fn(async (endpoint) => {
      const ep = String(endpoint || '');
      if (ep.includes('auth.php?action=csrf')) {
        return okJson({ success: true, token: 'csrf_token_test' });
      }
      return okJson({
        success: true,
        session_id: 1,
        reply: 'Antwort des NPC.',
        suggested_replies: suggestions,
        is_yes_no: false,
      });
    }));
    const API = loadApiScript();

    const result = await API.chatNpc({
      faction_code: 'vor_tak',
      npc_name: 'Admiral',
      player_message: 'Was plant ihr?',
    });

    expect(result.suggested_replies).toEqual(suggestions);
    expect(result.is_yes_no).toBe(false);
  });

  it('chatNpc response passes through is_yes_no=true for yes/no questions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (endpoint) => {
      const ep = String(endpoint || '');
      if (ep.includes('auth.php?action=csrf')) {
        return okJson({ success: true, token: 'csrf_token_test' });
      }
      return okJson({
        success: true,
        session_id: 2,
        reply: 'Wollt ihr kapitulieren?',
        suggested_replies: ['Ja', 'Nein'],
        is_yes_no: true,
      });
    }));
    const API = loadApiScript();

    const result = await API.chatNpc({
      faction_code: 'iron_fleet',
      npc_name: 'Admiral',
      player_message: 'Erklärt euch!',
    });

    expect(result.is_yes_no).toBe(true);
    expect(result.suggested_replies).toEqual(['Ja', 'Nein']);
  });
});
