/**
 * runtime-quests.test.js
 *
 * Unit tests for the RuntimeQuests* modules:
 *  - RuntimeQuestsDataModel  (faction category included)
 *  - RuntimeQuestsCardTemplate  (faction_quest source, reward_standing, claim routing)
 *  - RuntimeQuestsClaimBindings (achievement + faction quest claim buttons)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const base = path.resolve(process.cwd(), 'js/engine/runtime');

function loadModule(name) {
  const src = fs.readFileSync(path.join(base, `${name}.js`), 'utf8');
  window.eval(src);
}

function loadAll() {
  loadModule('RuntimeQuestsDataModel');
  loadModule('RuntimeQuestsCardTemplate');
  loadModule('RuntimeQuestsClaimBindings');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => Number(n).toLocaleString();

// ── RuntimeQuestsDataModel ────────────────────────────────────────────────────

describe('RuntimeQuestsDataModel – faction category', () => {
  beforeEach(() => {
    delete window.GQRuntimeQuestsDataModel;
    loadAll();
  });

  it('categoryOrder starts with faction', () => {
    const { createQuestsDataModelBuilder } = window.GQRuntimeQuestsDataModel;
    const builder = createQuestsDataModelBuilder();
    const { categoryOrder } = builder.build({ achievements: [] });
    expect(categoryOrder[0]).toBe('faction');
  });

  it('categoryLabels has a label for faction', () => {
    const { createQuestsDataModelBuilder } = window.GQRuntimeQuestsDataModel;
    const builder = createQuestsDataModelBuilder();
    const { categoryLabels } = builder.build({ achievements: [] });
    expect(typeof categoryLabels.faction).toBe('string');
    expect(categoryLabels.faction.length).toBeGreaterThan(0);
  });

  it('groups faction quests under the faction key', () => {
    const { createQuestsDataModelBuilder } = window.GQRuntimeQuestsDataModel;
    const builder = createQuestsDataModelBuilder();
    const achievements = [
      { id: 1, category: 'faction', title: 'Q1', completed: 0, reward_claimed: 0 },
      { id: 2, category: 'tutorial', title: 'T1', completed: 0, reward_claimed: 0 },
    ];
    const { groups } = builder.build({ achievements });
    expect(groups.faction).toHaveLength(1);
    expect(groups.tutorial).toHaveLength(1);
  });

  it('all five classic categories are present in categoryOrder', () => {
    const { createQuestsDataModelBuilder } = window.GQRuntimeQuestsDataModel;
    const builder = createQuestsDataModelBuilder();
    const { categoryOrder } = builder.build({ achievements: [] });
    for (const cat of ['tutorial', 'economy', 'expansion', 'combat', 'milestone']) {
      expect(categoryOrder).toContain(cat);
    }
  });
});

// ── RuntimeQuestsCardTemplate ─────────────────────────────────────────────────

describe('RuntimeQuestsCardTemplate – regular achievement', () => {
  beforeEach(() => {
    delete window.GQRuntimeQuestsCardTemplate;
    loadAll();
  });

  it('renders a pending achievement card', () => {
    const { createQuestsCardTemplateBuilder } = window.GQRuntimeQuestsCardTemplate;
    const builder = createQuestsCardTemplateBuilder();
    const html = builder.build({
      quest: { id: 5, title: 'Test', description: 'Desc', completed: 0, reward_claimed: 0, progress: 0, goal: 1 },
      esc,
      fmt,
    });
    expect(html).toContain('quest-pending');
    expect(html).toContain('Test');
  });

  it('renders a claimable achievement with .claim-btn (not .faction-claim-btn)', () => {
    const { createQuestsCardTemplateBuilder } = window.GQRuntimeQuestsCardTemplate;
    const builder = createQuestsCardTemplateBuilder();
    const html = builder.build({
      quest: { id: 7, title: 'Done', description: 'Yep', completed: 1, reward_claimed: 0, progress: 1, goal: 1 },
      esc,
      fmt,
    });
    expect(html).toContain('claim-btn');
    expect(html).not.toContain('faction-claim-btn');
    expect(html).toContain('data-aid="7"');
  });

  it('renders a claimed achievement with claimed label', () => {
    const { createQuestsCardTemplateBuilder } = window.GQRuntimeQuestsCardTemplate;
    const builder = createQuestsCardTemplateBuilder();
    const html = builder.build({
      quest: { id: 9, title: 'Old', description: 'Old desc', completed: 1, reward_claimed: 1, progress: 1, goal: 1, completed_at: null },
      esc,
      fmt,
    });
    expect(html).toContain('quest-claimed');
    expect(html).toContain('Claimed');
  });
});

describe('RuntimeQuestsCardTemplate – faction quest', () => {
  beforeEach(() => {
    delete window.GQRuntimeQuestsCardTemplate;
    loadAll();
  });

  it('renders faction quest pending card', () => {
    const { createQuestsCardTemplateBuilder } = window.GQRuntimeQuestsCardTemplate;
    const builder = createQuestsCardTemplateBuilder();
    const html = builder.build({
      quest: {
        id: 11, user_quest_id: 42, source: 'faction_quest',
        title: 'Patrouille', description: 'Inspiziere die Korvetten',
        completed: 0, reward_claimed: 0, progress: 0, goal: 1,
        reward_metal: 5000, reward_standing: 10,
      },
      esc,
      fmt,
    });
    expect(html).toContain('quest-pending');
    expect(html).toContain('Patrouille');
    expect(html).toContain('+10 Standing');
  });

  it('claimable faction quest uses .faction-claim-btn with data-uqid', () => {
    const { createQuestsCardTemplateBuilder } = window.GQRuntimeQuestsCardTemplate;
    const builder = createQuestsCardTemplateBuilder();
    const html = builder.build({
      quest: {
        id: 11, user_quest_id: 42, source: 'faction_quest',
        title: 'Done Patrouille', description: 'Done',
        completed: 1, reward_claimed: 0, progress: 1, goal: 1,
        reward_standing: 10,
      },
      esc,
      fmt,
    });
    expect(html).toContain('faction-claim-btn');
    expect(html).toContain('data-uqid="42"');
    // Faction quest claim button should use data-uqid, not data-aid on the claim button
    expect(html).not.toContain('<button class="btn btn-primary btn-sm claim-btn"');
  });

  it('does not show claim button for already-claimed faction quest', () => {
    const { createQuestsCardTemplateBuilder } = window.GQRuntimeQuestsCardTemplate;
    const builder = createQuestsCardTemplateBuilder();
    const html = builder.build({
      quest: {
        id: 11, user_quest_id: 42, source: 'faction_quest',
        title: 'Claimed', description: 'Done and claimed',
        completed: 1, reward_claimed: 1, progress: 1, goal: 1,
      },
      esc,
      fmt,
    });
    expect(html).toContain('quest-claimed');
    expect(html).not.toContain('faction-claim-btn');
  });

  it('shows reward_standing even when other rewards are zero', () => {
    const { createQuestsCardTemplateBuilder } = window.GQRuntimeQuestsCardTemplate;
    const builder = createQuestsCardTemplateBuilder();
    const html = builder.build({
      quest: {
        id: 12, user_quest_id: 55, source: 'faction_quest',
        title: 'Standing Only', description: 'Diplomacy',
        completed: 0, reward_claimed: 0, progress: 0, goal: 1,
        reward_metal: 0, reward_crystal: 0, reward_deuterium: 0,
        reward_dark_matter: 0, reward_rank_points: 0, reward_standing: 15,
      },
      esc,
      fmt,
    });
    expect(html).toContain('+15 Standing');
  });
});

// ── RuntimeQuestsClaimBindings ────────────────────────────────────────────────

describe('RuntimeQuestsClaimBindings – achievement claim', () => {
  beforeEach(() => {
    delete window.GQRuntimeQuestsClaimBindings;
    loadAll();
  });

  it('calls api.claimAchievement with the correct achievement id', async () => {
    const { createQuestsClaimBindings } = window.GQRuntimeQuestsClaimBindings;
    const bindings = createQuestsClaimBindings();

    document.body.innerHTML = `<div id="root"><button class="claim-btn" data-aid="7">Claim</button></div>`;
    const root = document.getElementById('root');

    const claimAchievement = vi.fn(async () => ({ success: true, message: 'OK' }));
    const showToast = vi.fn();
    const loadOverview = vi.fn(async () => {});
    const rerenderQuests = vi.fn();

    bindings.bindClaimButtons({
      root,
      api: { claimAchievement },
      showToast,
      loadOverview,
      rerenderQuests,
    });

    root.querySelector('.claim-btn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(claimAchievement).toHaveBeenCalledWith(7);
    expect(showToast).toHaveBeenCalledWith('OK', 'success');
  });

  it('re-enables button on achievement claim failure', async () => {
    const { createQuestsClaimBindings } = window.GQRuntimeQuestsClaimBindings;
    const bindings = createQuestsClaimBindings();

    document.body.innerHTML = `<div id="root"><button class="claim-btn" data-aid="3">Claim</button></div>`;
    const root = document.getElementById('root');
    const btn = root.querySelector('.claim-btn');

    bindings.bindClaimButtons({
      root,
      api: { claimAchievement: async () => ({ success: false, error: 'nope' }) },
      showToast: vi.fn(),
      loadOverview: vi.fn(async () => {}),
      rerenderQuests: vi.fn(),
    });

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(btn.disabled).toBe(false);
  });
});

describe('RuntimeQuestsClaimBindings – faction quest claim', () => {
  beforeEach(() => {
    delete window.GQRuntimeQuestsClaimBindings;
    loadAll();
  });

  it('calls api.claimFactionQuest with user_quest_id', async () => {
    const { createQuestsClaimBindings } = window.GQRuntimeQuestsClaimBindings;
    const bindings = createQuestsClaimBindings();

    document.body.innerHTML = `<div id="root"><button class="faction-claim-btn" data-uqid="42">Claim</button></div>`;
    const root = document.getElementById('root');

    const claimFactionQuest = vi.fn(async () => ({ success: true, message: 'Gut!' }));
    const showToast = vi.fn();
    const loadOverview = vi.fn(async () => {});
    const rerenderQuests = vi.fn();

    bindings.bindClaimButtons({
      root,
      api: { claimFactionQuest },
      showToast,
      loadOverview,
      rerenderQuests,
    });

    root.querySelector('.faction-claim-btn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(claimFactionQuest).toHaveBeenCalledWith(42);
    expect(showToast).toHaveBeenCalledWith('Gut!', 'success');
    expect(rerenderQuests).toHaveBeenCalled();
  });

  it('re-enables button on faction quest claim failure', async () => {
    const { createQuestsClaimBindings } = window.GQRuntimeQuestsClaimBindings;
    const bindings = createQuestsClaimBindings();

    document.body.innerHTML = `<div id="root"><button class="faction-claim-btn" data-uqid="9">Claim</button></div>`;
    const root = document.getElementById('root');
    const btn = root.querySelector('.faction-claim-btn');

    bindings.bindClaimButtons({
      root,
      api: { claimFactionQuest: async () => ({ success: false, error: 'nicht gefunden' }) },
      showToast: vi.fn(),
      loadOverview: vi.fn(async () => {}),
      rerenderQuests: vi.fn(),
    });

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(btn.disabled).toBe(false);
  });

  it('handles a mix of achievement and faction quest claim buttons in the same root', async () => {
    const { createQuestsClaimBindings } = window.GQRuntimeQuestsClaimBindings;
    const bindings = createQuestsClaimBindings();

    document.body.innerHTML = `
      <div id="root">
        <button class="claim-btn" data-aid="5">Claim Achievement</button>
        <button class="faction-claim-btn" data-uqid="88">Claim Faction Quest</button>
      </div>`;
    const root = document.getElementById('root');

    const claimAchievement = vi.fn(async () => ({ success: true, message: 'Done' }));
    const claimFactionQuest = vi.fn(async () => ({ success: true, message: 'Done' }));

    bindings.bindClaimButtons({
      root,
      api: { claimAchievement, claimFactionQuest },
      showToast: vi.fn(),
      loadOverview: vi.fn(async () => {}),
      rerenderQuests: vi.fn(),
    });

    root.querySelector('.claim-btn').click();
    await new Promise((r) => setTimeout(r, 0));
    root.querySelector('.faction-claim-btn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(claimAchievement).toHaveBeenCalledWith(5);
    expect(claimFactionQuest).toHaveBeenCalledWith(88);
  });
});
