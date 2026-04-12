import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dataModelPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeDiplomaticPlaysDataModel.js');
const panelPath     = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeDiplomaticPlaysPanel.js');

function loadDataModel() {
  delete window.GQRuntimeDiplomaticPlaysDataModel;
  window.eval(fs.readFileSync(dataModelPath, 'utf8'));
  return window.GQRuntimeDiplomaticPlaysDataModel;
}

function loadPanel() {
  delete window.GQRuntimeDiplomaticPlaysPanel;
  window.eval(fs.readFileSync(panelPath, 'utf8'));
  return window.GQRuntimeDiplomaticPlaysPanel;
}

// ── RuntimeDiplomaticPlaysDataModel ───────────────────────────────────────────

describe('RuntimeDiplomaticPlaysDataModel', () => {
  let dm;
  beforeEach(() => { dm = loadDataModel(); });

  // ── Phases ──────────────────────────────────────────────────────────────────

  it('exposes exactly 4 phases', () => {
    expect(dm.getPhases()).toHaveLength(4);
  });

  it('phases are ordered cooperation→threat→ultimatum→war', () => {
    const keys = dm.getPhases().map((p) => p.key);
    expect(keys).toEqual(['cooperation', 'threat', 'ultimatum', 'war']);
  });

  it('getPhase returns correct phase by key', () => {
    const p = dm.getPhase('threat');
    expect(p).toBeTruthy();
    expect(p.icon).toBe('⚠️');
    expect(p.color).toBeTruthy();
  });

  it('getPhase returns null for unknown key', () => {
    expect(dm.getPhase('unknown')).toBeNull();
    expect(dm.getPhase('')).toBeNull();
    expect(dm.getPhase(null)).toBeNull();
  });

  it('phaseIndex returns 0 for cooperation', () => {
    expect(dm.phaseIndex('cooperation')).toBe(0);
  });

  it('phaseIndex returns 3 for war', () => {
    expect(dm.phaseIndex('war')).toBe(3);
  });

  it('phaseIndex returns -1 for unknown key', () => {
    expect(dm.phaseIndex('unknown')).toBe(-1);
  });

  // ── Goal types ──────────────────────────────────────────────────────────────

  it('exposes at least 3 goal types', () => {
    expect(dm.getGoalTypes().length).toBeGreaterThanOrEqual(3);
  });

  it('getGoalType returns correct goal by code', () => {
    const g = dm.getGoalType('diplomatic');
    expect(g).toBeTruthy();
    expect(g.label).toContain('Diplomatic');
  });

  it('getGoalType returns null for unknown code', () => {
    expect(dm.getGoalType('nonexistent')).toBeNull();
  });

  // ── Outcome meta ────────────────────────────────────────────────────────────

  it('outcomeMeta returns deal metadata', () => {
    const m = dm.outcomeMeta('deal');
    expect(m.label).toContain('Deal');
    expect(m.cls).toContain('deal');
  });

  it('outcomeMeta returns war metadata', () => {
    const m = dm.outcomeMeta('war');
    expect(m.label).toContain('War');
  });

  it('outcomeMeta returns fallback for unknown outcome', () => {
    const m = dm.outcomeMeta('nonexistent');
    expect(m.cls).toBe('outcome-unknown');
  });

  // ── Trust bar ───────────────────────────────────────────────────────────────

  it('trustBarHTML renders a bar element', () => {
    const html = dm.trustBarHTML(50);
    expect(html).toContain('gq-trust-bar');
    expect(html).toContain('+50');
  });

  it('trustBarHTML shows negative trust value', () => {
    const html = dm.trustBarHTML(-30);
    expect(html).toContain('-30');
  });

  it('trustBarHTML clamps to -100..+100', () => {
    const hi = dm.trustBarHTML(200);
    expect(hi).toContain('+100');
    const lo = dm.trustBarHTML(-200);
    expect(lo).toContain('-100');
  });

  it('trustBarHTML width for 0 trust is 50%', () => {
    const html = dm.trustBarHTML(0);
    expect(html).toContain('width:50%');
  });

  // ── Threat bar ──────────────────────────────────────────────────────────────

  it('threatBarHTML renders a bar element', () => {
    const html = dm.threatBarHTML(75);
    expect(html).toContain('gq-threat-bar');
    expect(html).toContain('75');
  });

  it('threatBarHTML clamps to 0..100', () => {
    const hi = dm.threatBarHTML(200);
    expect(hi).toContain('width:100%');
    const lo = dm.threatBarHTML(-10);
    expect(lo).toContain('width:0%');
  });

  // ── Phase stepper ───────────────────────────────────────────────────────────

  it('phaseStepperHTML renders all 4 steps', () => {
    const html = dm.phaseStepperHTML('cooperation');
    const matches = html.match(/gq-phase-step/g) || [];
    // 4 steps
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('phaseStepperHTML marks current phase as active', () => {
    const html = dm.phaseStepperHTML('threat');
    expect(html).toContain('gq-phase-step--active');
  });

  it('phaseStepperHTML marks earlier phases as done', () => {
    const html = dm.phaseStepperHTML('ultimatum');
    const done = html.match(/gq-phase-step--done/g) || [];
    expect(done.length).toBe(2);  // cooperation + threat are done
  });

  it('phaseStepperHTML marks later phases as pending', () => {
    const html = dm.phaseStepperHTML('cooperation');
    const pending = html.match(/gq-phase-step--pending/g) || [];
    expect(pending.length).toBe(3);  // threat + ultimatum + war are pending
  });

  // ── Play card ───────────────────────────────────────────────────────────────

  it('playCardHTML renders a play card with phase and faction', () => {
    const play = {
      id: 1,
      phase: 'cooperation',
      status: 'active',
      goal_type: 'diplomatic',
      faction_name: "Vor'tak",
      faction_icon: '🦎',
      outcome: null,
      player_demands: [],
      faction_demands: [],
    };
    const html = dm.playCardHTML(play, (v) => String(v ?? ''));
    expect(html).toContain('gq-play-card');
    expect(html).toContain("Vor'tak");
    expect(html).toContain('Cooperation');
  });

  it('playCardHTML renders action buttons for cooperation phase', () => {
    const play = {
      id: 2, phase: 'cooperation', status: 'active', goal_type: 'diplomatic',
      faction_name: 'Test', faction_icon: '🤖', outcome: null,
    };
    const html = dm.playCardHTML(play, (v) => String(v ?? ''));
    expect(html).toContain('gq-play-btn--counter');
    expect(html).toContain('gq-play-btn--resolve-deal');
  });

  it('playCardHTML renders mobilize button for threat phase', () => {
    const play = {
      id: 3, phase: 'threat', status: 'active', goal_type: 'territorial',
      faction_name: 'Test', faction_icon: '🤖', outcome: null,
    };
    const html = dm.playCardHTML(play, (v) => String(v ?? ''));
    expect(html).toContain('gq-play-btn--mobilize');
  });

  it('playCardHTML renders war and withdrawal buttons for ultimatum phase', () => {
    const play = {
      id: 4, phase: 'ultimatum', status: 'active', goal_type: 'tribute',
      faction_name: 'Test', faction_icon: '🤖', outcome: null,
    };
    const html = dm.playCardHTML(play, (v) => String(v ?? ''));
    expect(html).toContain('gq-play-btn--resolve-war');
    expect(html).toContain('gq-play-btn--withdraw');
  });

  it('playCardHTML shows no action buttons for resolved plays', () => {
    const play = {
      id: 5, phase: 'war', status: 'resolved', outcome: 'war', goal_type: 'diplomatic',
      faction_name: 'Test', faction_icon: '🤖',
    };
    const html = dm.playCardHTML(play, (v) => String(v ?? ''));
    expect(html).not.toContain('gq-play-btn');
  });

  it('playCardHTML shows outcome chip for resolved plays', () => {
    const play = {
      id: 6, phase: 'war', status: 'resolved', outcome: 'deal', goal_type: 'diplomatic',
      faction_name: 'Test', faction_icon: '🤖',
    };
    const html = dm.playCardHTML(play, (v) => String(v ?? ''));
    expect(html).toContain('outcome-deal');
  });
});

// ── RuntimeDiplomaticPlaysPanel ───────────────────────────────────────────────

describe('RuntimeDiplomaticPlaysPanel', () => {
  let dm;
  let panelApi;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    dm       = loadDataModel();
    panelApi = loadPanel();
    window.GQRuntimeDiplomaticPlaysDataModel = dm;
  });

  function makeAPI(plays = [], trust = 20, threat = 10) {
    return {
      diplomaticPlaysList:        vi.fn().mockResolvedValue({ success: true, plays }),
      diplomaticPlaysTrustThreat: vi.fn().mockResolvedValue({ success: true, trust, threat }),
      diplomaticPlaysPropose:     vi.fn().mockResolvedValue({ success: true, play_id: 99, phase: 'cooperation' }),
      diplomaticPlaysCounter:     vi.fn().mockResolvedValue({ success: true, play_id: 1,  phase: 'threat' }),
      diplomaticPlaysMobilize:    vi.fn().mockResolvedValue({ success: true, play_id: 1,  phase: 'ultimatum' }),
      diplomaticPlaysResolve:     vi.fn().mockResolvedValue({ success: true, outcome: 'deal', standing_delta: 15, trust_delta: 10 }),
    };
  }

  const fakeFaction = { id: 5, name: "Vor'tak", icon: '🦎', color: '#e74c3c', standing: 20 };

  it('renders the panel header with faction name', async () => {
    const api = makeAPI();
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-diplo-plays-panel');
    expect(container.innerHTML).toContain("Vor'tak");
  });

  it('renders trust and threat bars', async () => {
    const api = makeAPI([], 35, 25);
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-trust-bar');
    expect(container.innerHTML).toContain('gq-threat-bar');
    expect(container.innerHTML).toContain('+35');
    expect(container.innerHTML).toContain('25');
  });

  it('renders empty state when no active plays', async () => {
    const api = makeAPI([]);
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-play-empty');
  });

  it('renders the new play form', async () => {
    const api = makeAPI([]);
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-play-form');
    expect(container.innerHTML).toContain('gq-play-form__submit');
  });

  it('renders active play cards', async () => {
    const plays = [{
      id: 1, phase: 'cooperation', status: 'active', goal_type: 'diplomatic',
      faction_id: 5, faction_name: "Vor'tak", faction_icon: '🦎', faction_color: '#e74c3c',
      player_demands: [], faction_demands: [], outcome: null,
      trust_snapshot: 10, threat_snapshot: 5,
    }];
    const api = makeAPI(plays);
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-play-card');
    expect(container.innerHTML).toContain('Cooperation');
  });

  it('renders past plays in a collapsible section', async () => {
    const plays = [{
      id: 2, phase: 'war', status: 'resolved', goal_type: 'diplomatic', outcome: 'deal',
      faction_id: 5, faction_name: "Vor'tak", faction_icon: '🦎', faction_color: '#e74c3c',
      player_demands: [], faction_demands: [],
      trust_snapshot: 10, threat_snapshot: 5,
    }];
    const api = makeAPI(plays);
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-play-history');
    expect(container.innerHTML).toContain('Past Plays');
  });

  it('shows error when API fails', async () => {
    const api = {
      diplomaticPlaysList:        vi.fn().mockRejectedValue(new Error('Network error')),
      diplomaticPlaysTrustThreat: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('error');
  });

  it('submitting the new play form calls diplomaticPlaysPropose', async () => {
    const api = makeAPI([]);
    const toast = vi.fn();
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm, showToast: toast });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);

    // Fill the demands input and submit
    const form = container.querySelector('.gq-play-form');
    expect(form).toBeTruthy();
    const demandsInput = form.querySelector('[name=player_demands]');
    if (demandsInput) demandsInput.value = 'open borders, trade route';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Wait a tick for async
    await new Promise((r) => setTimeout(r, 50));
    expect(api.diplomaticPlaysPropose).toHaveBeenCalledWith(
      expect.objectContaining({ faction_id: fakeFaction.id, goal_type: expect.any(String) }),
    );
  });

  it('phase stepper is rendered inside play cards', async () => {
    const plays = [{
      id: 3, phase: 'threat', status: 'active', goal_type: 'territorial',
      faction_id: 5, faction_name: "Vor'tak", faction_icon: '🦎', faction_color: '#e74c3c',
      player_demands: [], faction_demands: [], outcome: null,
      trust_snapshot: 5, threat_snapshot: 20,
    }];
    const api = makeAPI(plays);
    const panel = panelApi.createDiplomaticPlaysPanel({ api, dataModel: dm });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await panel.render(container, fakeFaction);
    expect(container.innerHTML).toContain('gq-phase-stepper');
    expect(container.innerHTML).toContain('gq-phase-step--active');
  });
});
