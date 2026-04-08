import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dataModelPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeDiplomacyDataModel.js');
const panelPath     = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeDiplomacyPanel.js');

function loadDataModel() {
  delete window.GQRuntimeDiplomacyDataModel;
  window.eval(fs.readFileSync(dataModelPath, 'utf8'));
  return window.GQRuntimeDiplomacyDataModel;
}

function loadPanel() {
  delete window.GQRuntimeDiplomacyPanel;
  window.eval(fs.readFileSync(panelPath, 'utf8'));
  return window.GQRuntimeDiplomacyPanel;
}

// ── RuntimeDiplomacyDataModel ──────────────────────────────────────────────

describe('RuntimeDiplomacyDataModel', () => {
  let dm;
  beforeEach(() => { dm = loadDataModel(); });

  it('exposes 4 agreement types', () => {
    expect(dm.getTypes()).toHaveLength(4);
    const codes = dm.getTypes().map((t) => t.code);
    expect(codes).toContain('non_aggression');
    expect(codes).toContain('trade');
    expect(codes).toContain('research');
    expect(codes).toContain('alliance');
  });

  it('getType returns correct type by code', () => {
    const t = dm.getType('trade');
    expect(t).toBeTruthy();
    expect(t.icon).toBe('💰');
    expect(t.minStanding).toBe(-10);
  });

  it('getType returns null for unknown code', () => {
    expect(dm.getType('unknown')).toBeNull();
  });

  it('standingMeta: allied ≥ 50', () => {
    expect(dm.standingMeta(75).cls).toBe('chip-allied');
    expect(dm.standingMeta(75).label).toBe('Allied');
  });

  it('standingMeta: friendly 10..49', () => {
    expect(dm.standingMeta(20).cls).toBe('chip-friendly');
  });

  it('standingMeta: neutral -9..9', () => {
    expect(dm.standingMeta(0).cls).toBe('chip-neutral');
  });

  it('standingMeta: hostile -49..-10', () => {
    expect(dm.standingMeta(-25).cls).toBe('chip-hostile');
  });

  it('standingMeta: war ≤ -50', () => {
    expect(dm.standingMeta(-80).cls).toBe('chip-war');
  });

  it('statusClass maps all statuses', () => {
    expect(dm.statusClass('active')).toBe('active');
    expect(dm.statusClass('proposed')).toBe('proposed');
    expect(dm.statusClass('rejected')).toBe('rejected');
    expect(dm.statusClass('cancelled')).toBe('cancelled');
    expect(dm.statusClass('expired')).toBe('expired');
    expect(dm.statusClass('??')).toBe('unknown');
  });

  it('acceptanceBarHTML renders a bar with the given pct', () => {
    const html = dm.acceptanceBarHTML(74);
    expect(html).toContain('74%');
  });

  it('acceptanceBarHTML clamps to 0–100', () => {
    expect(dm.acceptanceBarHTML(-10)).toContain('0%');
    expect(dm.acceptanceBarHTML(200)).toContain('100%');
  });

  it('standingMeterHTML contains standing label', () => {
    const html = dm.standingMeterHTML(60, 10);
    expect(html).toContain('Allied');
    expect(html).toContain('+10');
  });

  it('filterByStatus keeps matching statuses', () => {
    const agreements = [
      { status: 'active' },
      { status: 'proposed' },
      { status: 'rejected' },
      { status: 'cancelled' },
    ];
    const result = dm.filterByStatus(agreements, 'active', 'proposed');
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.status)).toEqual(['active', 'proposed']);
  });

  it('filterByStatus returns empty for no matches', () => {
    const agreements = [{ status: 'expired' }];
    expect(dm.filterByStatus(agreements, 'active')).toHaveLength(0);
  });

  it('filterByStatus handles null/empty input', () => {
    expect(dm.filterByStatus(null, 'active')).toHaveLength(0);
    expect(dm.filterByStatus([], 'active')).toHaveLength(0);
  });
});

// ── RuntimeDiplomacyPanel (render / tab switching) ─────────────────────────

describe('RuntimeDiplomacyPanel', () => {
  let dm;
  let panelApi;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    dm = loadDataModel();
    panelApi = loadPanel();
    // Make data model available globally as the panel uses it
    window.GQRuntimeDiplomacyDataModel = dm;
  });

  function makeAPI(agreements = []) {
    return {
      factionAgreementsList: vi.fn().mockResolvedValue({ success: true, agreements }),
      factionAgreementsRespond: vi.fn().mockResolvedValue({ success: true, outcome: 'accepted', standing_gain: 12 }),
      factionAgreementsCancel:  vi.fn().mockResolvedValue({ success: true, standing_penalty: 12 }),
    };
  }

  const fakeFaction = { id: 1, name: 'Vor\'tak', icon: '🦎', color: '#e74c3c', standing: 20 };

  it('renders the diplomacy panel header', async () => {
    const api = makeAPI();
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-diplomacy-panel');
    expect(container.innerHTML).toContain("Vor'tak");
  });

  it('renders type tabs for all agreement types', async () => {
    const api = makeAPI();
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    const tabs = container.querySelectorAll('.gq-contract-type-tab');
    expect(tabs.length).toBe(4);
  });

  it('renders empty state when no agreements of the active tab type exist', async () => {
    const api = makeAPI([]);
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-contract-empty');
    expect(container.innerHTML).toContain('+ Propose');
  });

  it('renders active agreement cards', async () => {
    const agreements = [{
      id: 7, agreement_type: 'trade', status: 'active',
      player_offer: [{ term: 'trade_route', label: 'Open trade route' }],
      faction_demand: [{ term: 'resource_access', label: 'Raw material access' }],
      ai_acceptance_pct: 70, expires_at: null,
      faction_icon: '🦎', faction_name: "Vor'tak", faction_color: '#e74c3c',
    }];
    const api = makeAPI(agreements);
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    // switch to trade tab to see it
    await panel.render(container, fakeFaction);
    const tradeTab = [...container.querySelectorAll('.gq-contract-type-tab')]
      .find((b) => b.dataset.tab === 'trade');
    tradeTab?.click();
    expect(container.innerHTML).toContain('gq-contract-panel');
    expect(container.innerHTML).toContain('Open trade route');
  });

  it('calls onNegotiate when + New Agreement is clicked', async () => {
    const api = makeAPI([]);
    const onNegotiate = vi.fn();
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm, onNegotiate });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    const newBtn = container.querySelector('.gq-contract-new-btn');
    expect(newBtn).toBeTruthy();
    newBtn.click();
    expect(onNegotiate).toHaveBeenCalledWith(fakeFaction, expect.any(String));
  });

  it('shows error when API fails', async () => {
    const api = { factionAgreementsList: vi.fn().mockRejectedValue(new Error('Network error')) };
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('error');
  });

  it('shows ai acceptance bar for proposed agreements', async () => {
    const agreements = [{
      id: 3, agreement_type: 'non_aggression', status: 'proposed',
      player_offer: [], faction_demand: [],
      ai_acceptance_pct: 62, expires_at: null,
      faction_icon: '🦎', faction_name: "Vor'tak", faction_color: '#aaa',
    }];
    const api = makeAPI(agreements);
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    const nagTab = [...container.querySelectorAll('.gq-contract-type-tab')]
      .find((b) => b.dataset.tab === 'non_aggression');
    nagTab?.click();
    expect(container.innerHTML).toContain('gq-ai-confidence');
    expect(container.innerHTML).toContain('62%');
  });
});
