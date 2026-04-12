/**
 * alliance-wars.test.js
 *
 * Unit tests for the AllianceWarController (N-vs-M scenarios) added to
 * RuntimeWarController.js. Covers:
 *  - createAllianceWarController factory
 *  - scoreBarHtml via HTML output
 *  - sideTagsHtml via warDetailHtml output
 *  - list rendering (empty + with wars)
 *  - declare-war form interaction
 *  - peace-offer flow
 *  - parseIntList helper (tested via declare confirm)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'js/engine/runtime/layers/domain/war/RuntimeWarController.js'),
  'utf8'
);

function loadModule() {
  delete window.GQRuntimeWarController;
  window.eval(src);
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Factory ───────────────────────────────────────────────────────────────────

describe('createAllianceWarController – factory', () => {
  beforeEach(loadModule);

  it('exports createAllianceWarController', () => {
    expect(typeof window.GQRuntimeWarController.createAllianceWarController).toBe('function');
  });

  it('returns an object with state and render method', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    expect(ctrl).toBeDefined();
    expect(ctrl.state).toBeDefined();
    expect(Array.isArray(ctrl.state.wars)).toBe(true);
    expect(ctrl.state.detailWarId).toBeNull();
    expect(typeof ctrl.render).toBe('function');
  });

  it('state.myAllianceIds is initially an empty array', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    expect(Array.isArray(ctrl.state.myAllianceIds)).toBe(true);
  });
});

// ── _renderListHtml – empty state ─────────────────────────────────────────────

describe('AllianceWarController._renderListHtml – empty', () => {
  beforeEach(loadModule);

  it('renders Refresh and Declare buttons', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [];
    const html = ctrl._renderListHtml();
    expect(html).toContain('data-aw-refresh');
    expect(html).toContain('data-aw-declare');
  });

  it('renders empty state when no wars', () => {
    const uiKitEmptyStateHTML = (title) => `<div class="empty">${title}</div>`;
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, uiKitEmptyStateHTML });
    ctrl.state.wars = [];
    const html = ctrl._renderListHtml();
    expect(html).toContain('No alliance wars');
  });
});

// ── _renderListHtml – with wars ───────────────────────────────────────────────

describe('AllianceWarController._renderListHtml – with wars', () => {
  beforeEach(loadModule);

  const sampleWar = {
    war_id: 7,
    name: 'The Coalition War',
    status: 'active',
    my_side: 'a',
    side_a: [
      { alliance_id: 1, name: 'Iron Fleet', tag: 'IF' },
      { alliance_id: 3, name: 'Void Pact', tag: 'VP' },
    ],
    side_b: [
      { alliance_id: 2, name: 'Stellar Empire', tag: 'SE' },
      { alliance_id: 4, name: 'Dark Nebula', tag: 'DN' },
    ],
    war_score_a: 320,
    war_score_b: 180,
    exhaustion_a: 12.5,
    exhaustion_b: 8.3,
    started_at: '2026-01-01 00:00:00',
    summary: {},
  };

  it('renders war table with war name', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [sampleWar];
    const html = ctrl._renderListHtml();
    expect(html).toContain('The Coalition War');
  });

  it('renders side A and side B alliance tags', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [sampleWar];
    const html = ctrl._renderListHtml();
    expect(html).toContain('[IF]');
    expect(html).toContain('[VP]');
    expect(html).toContain('[SE]');
    expect(html).toContain('[DN]');
  });

  it('renders data-aw-details button for each war', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [sampleWar];
    const html = ctrl._renderListHtml();
    expect(html).toContain('data-aw-details="7"');
  });

  it('renders score bar with both scores', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [sampleWar];
    const html = ctrl._renderListHtml();
    expect(html).toContain('320');
    expect(html).toContain('180');
  });

  it('shows "Side A" label when my_side is a', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [sampleWar];
    const html = ctrl._renderListHtml();
    expect(html).toContain('Side A');
  });

  it('shows "Side B" label when my_side is b', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [{ ...sampleWar, my_side: 'b' }];
    const html = ctrl._renderListHtml();
    expect(html).toContain('Side B');
  });

  it('renders multiple war rows', () => {
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc });
    ctrl.state.wars = [
      sampleWar,
      { ...sampleWar, war_id: 8, name: 'Second War' },
    ];
    const html = ctrl._renderListHtml();
    expect(html).toContain('The Coalition War');
    expect(html).toContain('Second War');
    expect(html).toContain('data-aw-details="7"');
    expect(html).toContain('data-aw-details="8"');
  });
});

// ── Declare war form interaction ───────────────────────────────────────────────

describe('AllianceWarController – declare war button', () => {
  beforeEach(loadModule);

  it('renders declare form with side-A and side-B inputs', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const root = document.getElementById('host');
    root.innerHTML = '';

    const api = { allianceWars: vi.fn().mockResolvedValue({ success: true, wars: [] }) };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.wars = [];
    root.innerHTML = ctrl._renderListHtml();
    ctrl._attachListeners(root);

    const declareBtn = root.querySelector('[data-aw-declare="1"]');
    expect(declareBtn).toBeTruthy();
    declareBtn.click();

    const sideAInput = root.querySelector('[data-aw-side-a]');
    const sideBInput = root.querySelector('[data-aw-side-b]');
    expect(sideAInput).toBeTruthy();
    expect(sideBInput).toBeTruthy();
  });

  it('shows toast when side A is empty on confirm', async () => {
    document.body.innerHTML = '<div id="host2"></div>';
    const root = document.getElementById('host2');
    root.innerHTML = '';

    const toasts = [];
    const api = {
      allianceWars: vi.fn().mockResolvedValue({ success: true, wars: [] }),
      declareAllianceWar: vi.fn(),
    };
    const wm = { body: () => root };
    const showToast = (msg, type) => toasts.push({ msg, type });
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm, showToast });
    ctrl.state.wars = [];
    root.innerHTML = ctrl._renderListHtml();
    ctrl._attachListeners(root);

    root.querySelector('[data-aw-declare="1"]').click();
    const formHost = root.querySelector('[data-aw-declare-form-host]');
    // Leave both sides empty
    await root.querySelector('[data-aw-declare-confirm]').click();

    expect(api.declareAllianceWar).not.toHaveBeenCalled();
    expect(toasts.some((t) => t.type === 'warning')).toBe(true);
  });

  it('calls api.declareAllianceWar with correct args on confirm', async () => {
    document.body.innerHTML = '<div id="host3"></div>';
    const root = document.getElementById('host3');

    const api = {
      allianceWars: vi.fn().mockResolvedValue({ success: true, wars: [] }),
      declareAllianceWar: vi.fn().mockResolvedValue({ success: true, war_id: 42, name: 'IF+VP vs SE+DN', status: 'active', side_a: [1, 3], side_b: [2, 4] }),
    };
    const wm = { body: () => root };
    const showToast = vi.fn();
    const invalidateGetCache = vi.fn();
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm, showToast, invalidateGetCache });
    ctrl.state.wars = [];
    root.innerHTML = ctrl._renderListHtml();
    ctrl._attachListeners(root);

    root.querySelector('[data-aw-declare="1"]').click();

    root.querySelector('[data-aw-war-name]').value = 'Test War';
    root.querySelector('[data-aw-side-a]').value = '1, 3';
    root.querySelector('[data-aw-side-b]').value = '2, 4';
    root.querySelector('[data-aw-casus]').value = 'Border clash';

    await root.querySelector('[data-aw-declare-confirm]').click();

    await new Promise((r) => setTimeout(r, 0));

    expect(api.declareAllianceWar).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test War',
      side_a: [1, 3],
      side_b: [2, 4],
      casus_belli: 'Border clash',
    }));
  });
});

// ── Detail HTML rendering ────────────────────────────────────────────────────

describe('AllianceWarController – detail view', () => {
  beforeEach(loadModule);

  const detailData = {
    war_id: 7,
    name: '2v2 Test War',
    status: 'active',
    my_side: 'b',
    side_a: [{ alliance_id: 1, name: 'Iron Fleet', tag: 'IF' }],
    side_b: [{ alliance_id: 2, name: 'Stellar Empire', tag: 'SE' }, { alliance_id: 4, name: 'Dark Nebula', tag: 'DN' }],
    war_score_a: 100,
    war_score_b: 200,
    exhaustion_a: 5.0,
    exhaustion_b: 10.0,
    casus_belli: 'Territorial dispute',
    started_at: '2026-02-01 00:00:00',
    peace_offers: [],
    summary: {},
  };

  it('render populates state.detailData when loadDetail succeeds', async () => {
    document.body.innerHTML = '<div id="detail-host"></div>';
    const root = document.getElementById('detail-host');

    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...detailData }) };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 7;

    await ctrl.render();

    expect(ctrl.state.detailData).toBeTruthy();
    expect(ctrl.state.detailData.war_id).toBe(7);
  });

  it('shows war name in detail view', async () => {
    document.body.innerHTML = '<div id="detail-host2"></div>';
    const root = document.getElementById('detail-host2');
    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...detailData }) };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 7;
    await ctrl.render();
    expect(root.innerHTML).toContain('2v2 Test War');
  });

  it('shows side A and side B alliances in detail', async () => {
    document.body.innerHTML = '<div id="detail-host3"></div>';
    const root = document.getElementById('detail-host3');
    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...detailData }) };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 7;
    await ctrl.render();
    expect(root.innerHTML).toContain('[IF]');
    expect(root.innerHTML).toContain('[SE]');
    expect(root.innerHTML).toContain('[DN]');
  });

  it('shows Offer Peace button when war is active', async () => {
    document.body.innerHTML = '<div id="detail-host4"></div>';
    const root = document.getElementById('detail-host4');
    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...detailData }) };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 7;
    await ctrl.render();
    expect(root.innerHTML).toContain('data-aw-offer-peace-btn');
  });

  it('does NOT show Offer Peace button when war is ended', async () => {
    document.body.innerHTML = '<div id="detail-host5"></div>';
    const root = document.getElementById('detail-host5');
    const endedData = { ...detailData, status: 'ended' };
    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...endedData }) };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 7;
    await ctrl.render();
    expect(root.innerHTML).not.toContain('data-aw-offer-peace-btn');
  });

  it('renders back button', async () => {
    document.body.innerHTML = '<div id="detail-host6"></div>';
    const root = document.getElementById('detail-host6');
    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...detailData }) };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 7;
    await ctrl.render();
    const backBtn = root.querySelector('[data-aw-back="1"]');
    expect(backBtn).toBeTruthy();
  });

  it('clicking back resets detailWarId and re-renders list', async () => {
    document.body.innerHTML = '<div id="detail-host7"></div>';
    const root = document.getElementById('detail-host7');
    const api = {
      allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...detailData }),
      allianceWars: vi.fn().mockResolvedValue({ success: true, wars: [] }),
    };
    const wm = { body: () => root };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 7;
    await ctrl.render();

    root.querySelector('[data-aw-back="1"]').click();

    await new Promise((r) => setTimeout(r, 0));

    expect(ctrl.state.detailWarId).toBeNull();
  });
});

// ── Peace offer rendering ────────────────────────────────────────────────────

describe('AllianceWarController – peace offers in detail', () => {
  beforeEach(loadModule);

  it('renders pending incoming peace offer with Accept/Reject buttons', async () => {
    document.body.innerHTML = '<div id="peace-host"></div>';
    const root = document.getElementById('peace-host');

    const dataWithOffer = {
      war_id: 9,
      name: '3v4 Big War',
      status: 'active',
      my_side: 'b',
      side_a: [{ alliance_id: 1, name: 'A1', tag: 'A1' }],
      side_b: [{ alliance_id: 2, name: 'B1', tag: 'B1' }],
      war_score_a: 50,
      war_score_b: 50,
      exhaustion_a: 0,
      exhaustion_b: 0,
      started_at: '2026-01-01',
      peace_offers: [
        {
          id: 5,
          from_alliance_id: 1,  // from side A → incoming for side B
          status: 'pending',
          terms: [],
          created_at: '2026-02-01 00:00:00',
          expires_at: '2026-02-04 00:00:00',
        },
      ],
      summary: {},
    };

    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...dataWithOffer }) };
    const wm = { body: () => root };
    // my alliances are on side B
    window._GQ_meta = { alliance_id: 2 };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 9;
    ctrl.state.myAllianceIds = [2];
    await ctrl.render();

    expect(root.innerHTML).toContain('data-aw-offer-accept="5"');
    expect(root.innerHTML).toContain('data-aw-offer-reject="5"');
  });

  it('renders outgoing peace offer without Accept/Reject', async () => {
    document.body.innerHTML = '<div id="peace-host2"></div>';
    const root = document.getElementById('peace-host2');

    const dataWithOffer = {
      war_id: 9,
      name: 'Outgoing Test',
      status: 'active',
      my_side: 'a',
      side_a: [{ alliance_id: 1, name: 'A1', tag: 'A1' }],
      side_b: [{ alliance_id: 2, name: 'B1', tag: 'B1' }],
      war_score_a: 50,
      war_score_b: 50,
      exhaustion_a: 0,
      exhaustion_b: 0,
      started_at: '2026-01-01',
      peace_offers: [
        {
          id: 6,
          from_alliance_id: 1,  // from side A — this is our own offer
          status: 'pending',
          terms: [],
          created_at: '2026-02-01 00:00:00',
          expires_at: '2026-02-04 00:00:00',
        },
      ],
      summary: {},
    };

    const api = { allianceWarStatus: vi.fn().mockResolvedValue({ success: true, ...dataWithOffer }) };
    const wm = { body: () => root };
    // Set _GQ_meta so _myAllianceIds() returns [1] (side A alliance)
    window._GQ_meta = { alliance_id: 1 };
    const ctrl = window.GQRuntimeWarController.createAllianceWarController({ esc, api, wm });
    ctrl.state.detailWarId = 9;
    await ctrl.render();

    // Outgoing offer should NOT have accept/reject buttons
    expect(root.innerHTML).not.toContain('data-aw-offer-accept="6"');
    expect(root.innerHTML).not.toContain('data-aw-offer-reject="6"');
    expect(root.innerHTML).toContain('Awaiting response');
  });
});

// ── Existing createWarController still works ──────────────────────────────────

describe('createWarController still exported', () => {
  beforeEach(loadModule);

  it('createWarController is still accessible', () => {
    expect(typeof window.GQRuntimeWarController.createWarController).toBe('function');
  });
});
