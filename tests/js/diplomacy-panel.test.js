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

  // ── Trust / Threat helpers ────────────────────────────────────────────────

  it('trustMeta: high trust ≥ 75', () => {
    expect(dm.trustMeta(80).cls).toBe('trust-high');
    expect(dm.trustMeta(80).label).toBe('High Trust');
  });

  it('trustMeta: moderate trust 40..74', () => {
    expect(dm.trustMeta(55).cls).toBe('trust-moderate');
  });

  it('trustMeta: low trust 15..39', () => {
    expect(dm.trustMeta(20).cls).toBe('trust-low');
  });

  it('trustMeta: no trust < 15', () => {
    expect(dm.trustMeta(0).cls).toBe('trust-none');
  });

  it('threatMeta: critical threat ≥ 75', () => {
    expect(dm.threatMeta(90).cls).toBe('threat-critical');
    expect(dm.threatMeta(90).label).toBe('Critical Threat');
  });

  it('threatMeta: high threat 50..74', () => {
    expect(dm.threatMeta(60).cls).toBe('threat-high');
  });

  it('threatMeta: moderate threat 25..49', () => {
    expect(dm.threatMeta(35).cls).toBe('threat-moderate');
  });

  it('threatMeta: low threat < 25', () => {
    expect(dm.threatMeta(10).cls).toBe('threat-low');
  });

  it('diploStance: ALLY when trust ≥ 75 and threat < 20', () => {
    expect(dm.diploStance(80, 10).code).toBe('ALLY');
  });

  it('diploStance: FRIENDLY when trust 40..74 and threat < 40', () => {
    expect(dm.diploStance(50, 25).code).toBe('FRIENDLY');
  });

  it('diploStance: HOSTILE when threat ≥ 75', () => {
    expect(dm.diploStance(10, 80).code).toBe('HOSTILE');
  });

  it('diploStance: TENSE when threat 50..74', () => {
    expect(dm.diploStance(20, 60).code).toBe('TENSE');
  });

  it('diploStance: NEUTRAL fallback', () => {
    expect(dm.diploStance(10, 10).code).toBe('NEUTRAL');
  });

  it('trustThreatBarsHTML renders trust and threat bars', () => {
    const html = dm.trustThreatBarsHTML(60, 30);
    expect(html).toContain('gq-trust-threat-bars');
    expect(html).toContain('60');
    expect(html).toContain('30');
    expect(html).toContain('gq-axis-fill--trust');
    expect(html).toContain('gq-axis-fill--threat');
  });

  it('trustThreatBarsHTML shows stance chip', () => {
    const html = dm.trustThreatBarsHTML(80, 5);
    expect(html).toContain('stance-ally');
    expect(html).toContain('Ally');
  });

  it('trustThreatBarsHTML clamps values to 0–100', () => {
    const html = dm.trustThreatBarsHTML(-20, 150);
    expect(html).toContain('0');
    expect(html).toContain('100');
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

  it('renders trust/threat bars in panel header', async () => {
    const api = makeAPI([]);
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const factionWithTrustThreat = { ...fakeFaction, trust_level: 65, threat_level: 20 };
    await panel.render(container, factionWithTrustThreat);
    expect(container.innerHTML).toContain('gq-trust-threat-bars');
    expect(container.innerHTML).toContain('65');
    expect(container.innerHTML).toContain('20');
  });

  it('renders NEUTRAL stance when trust and threat are both 0', async () => {
    const api = makeAPI([]);
    const panel = panelApi.createDiplomacyPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const neutralFaction = { ...fakeFaction, trust_level: 0, threat_level: 0 };
    await panel.render(container, neutralFaction);
    expect(container.innerHTML).toContain('stance-neutral');
  });
});
