// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let controller;

beforeEach(() => {
  window.eval(readFileSync(path.resolve('js/engine/runtime/RuntimeFactionsController.js'), 'utf8'));
  controller = window.GQRuntimeFactionsController.createFactionsController({
    esc: (value) => String(value ?? ''),
  });
  controller.lastFactions = [{
    id: 7,
    name: '<img src=x onerror=alert(1)>',
    color: 'red; background-image:url(javascript:alert(1))',
    icon: '<svg onload=alert(1)>',
  }];
  controller.setNpcSession(7, {
    npcName: '<script>alert(1)</script>',
    model: '<img src=x>',
    history: [{ role: 'assistant', content: '<iframe src=javascript:alert(1)></iframe>' }],
    suggestedReplies: ['<img src=x onerror=alert(1)>'],
    loading: false,
  });
});

describe('Runtime factions NPC chat rendering', () => {
  it('escapes untrusted faction and chat values even if an identity escaper is injected', () => {
    const panel = document.createElement('div');
    panel.innerHTML = controller.buildNpcChatPanel(7);

    expect(panel.querySelector('img, svg, script, iframe')).toBeNull();
    expect(panel.querySelector('h4').textContent).toContain('<script>alert(1)</script>');
    expect(panel.querySelector('#npc-chat-transcript').textContent)
      .toContain('<iframe src=javascript:alert(1)></iframe>');
    expect(panel.querySelector('.npc-chat-suggestion').textContent)
      .toBe('<img src=x onerror=alert(1)>');
  });

  it('uses a safe fallback color when faction color contains CSS syntax', () => {
    const panel = document.createElement('div');
    panel.innerHTML = controller.buildNpcChatPanel(7);

    const heading = panel.querySelector('h4');
    expect(heading.getAttribute('style')).toContain('color:#88aaff');
    expect(heading.getAttribute('style')).not.toContain('background-image');
    expect(panel.querySelector('#npc-chat-transcript > div > div').getAttribute('style'))
      .not.toContain('javascript:');
  });

  it('escapes faction card fields and validates colors before CSS interpolation', () => {
    const html = controller.buildMainView({
      factions: [{
        id: '7" onclick="alert(1)',
        name: '<img src=x onerror=alert(1)>',
        color: 'red;background-image:url(javascript:alert(1))',
        icon: '<svg onload=alert(1)>',
        standing: 20,
        trust_level: 50,
        threat_level: 10,
        description: '<iframe src=javascript:alert(1)>',
        aggression: '<img src=x>',
        trade_willingness: '<img src=x>',
        quests_done: '<img src=x>',
      }],
      politicsProfile: null,
      dynamicEffects: {},
      presets: [],
      activeUnrest: null,
      activeEvent: null,
    });
    const host = document.createElement('div');
    host.innerHTML = html;

    expect(host.querySelector('img, svg, iframe')).toBeNull();
    expect(host.querySelector('[onclick]')).toBeNull();
    expect(host.querySelector('.diplomacy-card-name').textContent)
      .toBe('<img src=x onerror=alert(1)>');
    expect(host.querySelector('.diplomacy-card-image').getAttribute('style'))
      .toContain('#88aaff22');
    expect(host.querySelector('.diplomacy-card-image').getAttribute('style'))
      .not.toContain('javascript:');
  });

  it('escapes trade offer payloads in rendered details', async () => {
    const api = {
      tradeOffers: async () => ({
        success: true,
        standing: '<img src=x>',
        offers: [{
          offer_amount: 10,
          offer_resource: '<svg onload=alert(1)>',
          request_amount: 20,
          request_resource: '<img src=x>',
          valid_until: '2026-01-01T00:00:00Z',
          claims_count: 0,
          max_claims: 1,
          id: '1" onclick="alert(1)',
        }],
      }),
    };
    const apiController = window.GQRuntimeFactionsController.createFactionsController({ api });
    const root = document.createElement('div');
    root.innerHTML = '<div id="faction-detail"></div>';

    await apiController.renderDetail(root, 7, 'trade');

    const detail = root.querySelector('#faction-detail');
    expect(detail.querySelector('img, svg')).toBeNull();
    expect(detail.querySelector('[onclick]')).toBeNull();
    expect(detail.textContent).toContain('<svg onload=alert(1)>');
  });

  it('escapes faction quest payloads in rendered details', async () => {
    const api = {
      factionQuests: async () => ({
        success: true,
        standing: '<img src=x>',
        quests: [{
          title: '<svg onload=alert(1)>',
          description: '<img src=x>',
          difficulty: '<script>alert(1)</script>',
          quest_type: '<iframe src=javascript:alert(1)>',
          reward_metal: '<img src=x>',
          reward_crystal: 0,
          reward_rank_points: 0,
          reward_standing: 0,
          taken: false,
          id: '2" onclick="alert(1)',
        }],
      }),
    };
    const apiController = window.GQRuntimeFactionsController.createFactionsController({ api });
    const root = document.createElement('div');
    root.innerHTML = '<div id="faction-detail"></div>';

    await apiController.renderDetail(root, 7, 'quests');

    const detail = root.querySelector('#faction-detail');
    expect(detail.querySelector('img, svg, script, iframe')).toBeNull();
    expect(detail.querySelector('[onclick]')).toBeNull();
    expect(detail.querySelector('.quest-card').textContent).toContain('<iframe src=javascript:alert(1)>');
  });
});
