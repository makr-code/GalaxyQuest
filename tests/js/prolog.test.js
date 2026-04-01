/**
 * prolog.test.js — Unit tests for the GQProlog onboarding module.
 *
 * Tests cover:
 *   • FACTIONS data completeness and structure
 *   • esc() HTML-escaping helper
 *   • Colony name used in transition text (never hardcoded)
 *   • show() graceful fallback when #prolog-section is absent
 *   • DOM: faction cards are built correctly
 *   • DOM: phase transitions hide/show elements
 *   • DOM: colony name appears in phase 4 transition text
 *   • DOM: faction story appears in phase 3
 */

import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const prologPath = path.resolve(process.cwd(), 'js/ui/prolog.js');

function loadProlog() {
  delete window.GQProlog;
  window.eval(fs.readFileSync(prologPath, 'utf8'));
  return window.GQProlog;
}

// ── FACTIONS data ────────────────────────────────────────────────────────────

describe('GQProlog – FACTIONS data', () => {
  let GQProlog;
  beforeEach(() => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    GQProlog = loadProlog();
  });

  it('exposes exactly 6 factions', () => {
    expect(GQProlog._test.FACTIONS).toHaveLength(6);
  });

  const expectedIds = ['vor_tak', 'syl_nar', 'aereth', 'kryl_tha', 'zhareen', 'vel_ar'];
  it.each(expectedIds)('contains faction id "%s"', (id) => {
    const faction = GQProlog._test.getFactionById(id);
    expect(faction).toBeDefined();
  });

  it('every faction has required fields', () => {
    const required = ['id', 'emoji', 'name', 'subtitle', 'herald', 'heraldRole', 'color',
      'promise', 'demand', 'confirmQuote', 'story', 'mission'];
    GQProlog._test.FACTIONS.forEach((f) => {
      required.forEach((key) => {
        expect(f[key], `faction ${f.id} missing field "${key}"`).toBeDefined();
      });
    });
  });

  it('every faction has a non-empty story array', () => {
    GQProlog._test.FACTIONS.forEach((f) => {
      expect(Array.isArray(f.story)).toBe(true);
      expect(f.story.length).toBeGreaterThan(0);
    });
  });

  it('no faction story text contains hardcoded "Khal\'Vethis"', () => {
    GQProlog._test.FACTIONS.forEach((f) => {
      f.story.forEach((line) => {
        expect(line, `faction ${f.id} story hardcodes "Khal'Vethis"`).not.toContain("Khal'Vethis");
      });
    });
  });

  it('INTRO_LINES is a non-empty array', () => {
    expect(Array.isArray(GQProlog._test.INTRO_LINES)).toBe(true);
    expect(GQProlog._test.INTRO_LINES.length).toBeGreaterThan(0);
  });
});

// ── esc() helper ─────────────────────────────────────────────────────────────

describe('GQProlog – esc() helper', () => {
  let GQProlog;
  beforeEach(() => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    GQProlog = loadProlog();
  });

  it('escapes ampersand', () => {
    expect(GQProlog._test.esc('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(GQProlog._test.esc('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(GQProlog._test.esc('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(GQProlog._test.esc("it's")).toBe("it&#x27;s");
  });

  it('returns empty string for null/undefined', () => {
    expect(GQProlog._test.esc(null)).toBe('');
    expect(GQProlog._test.esc(undefined)).toBe('');
  });

  it('leaves safe text unchanged', () => {
    expect(GQProlog._test.esc('Hello World 123')).toBe('Hello World 123');
  });
});

// ── show() – fallback when section missing ───────────────────────────────────

describe('GQProlog – show() graceful fallback', () => {
  it('calls onComplete immediately when #prolog-section is absent', () => {
    document.body.innerHTML = '';
    loadProlog();
    let called = false;
    window.GQProlog.show({ onComplete: () => { called = true; } });
    expect(called).toBe(true);
  });
});

// ── DOM: show() builds faction cards ─────────────────────────────────────────

describe('GQProlog – DOM: faction cards', () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    loadProlog();
    window.GQProlog.show({ username: 'Tester', colonyName: 'Testkolonie', onComplete: () => {} });
  });

  it('builds 6 faction cards in #prolog-cards', () => {
    const cards = document.querySelectorAll('#prolog-cards .prolog-card');
    expect(cards).toHaveLength(6);
  });

  it('each card has a data-faction-id attribute', () => {
    const cards = document.querySelectorAll('#prolog-cards .prolog-card');
    cards.forEach((card) => {
      expect(card.dataset.factionId).toBeTruthy();
    });
  });

  it('faction card ids match the six expected factions', () => {
    const cards = document.querySelectorAll('#prolog-cards .prolog-card');
    const ids = Array.from(cards).map((c) => c.dataset.factionId);
    expect(ids).toContain('vor_tak');
    expect(ids).toContain('vel_ar');
    expect(ids).toContain('aereth');
  });

  it('removes hidden class and shows #prolog-section', () => {
    const section = document.getElementById('prolog-section');
    expect(section.classList.contains('hidden')).toBe(false);
  });

  it('phase 1 is active on start', () => {
    const p1 = document.getElementById('prolog-p1');
    expect(p1).not.toBeNull();
    expect(p1.classList.contains('is-active')).toBe(true);
    expect(p1.hidden).toBe(false);
  });

  it('phases 2-4 are hidden on start', () => {
    ['prolog-p2', 'prolog-p3', 'prolog-p4'].forEach((id) => {
      const el = document.getElementById(id);
      expect(el.hidden, id + ' should be hidden').toBe(true);
    });
  });
});

// ── DOM: colony name in phase 4 ───────────────────────────────────────────────

describe('GQProlog – colony name in transition text', () => {
  const COLONY = 'Meine Testkolonie';

  beforeEach(() => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    loadProlog();
    window.GQProlog.show({ username: 'TestCmd', colonyName: COLONY, onComplete: () => {} });
  });

  it('uses the dynamic colony name in phase 4 (not hardcoded)', () => {
    // Advance to phase 4 by clicking faction card then confirm then next
    const firstCard = document.querySelector('#prolog-cards .prolog-card');
    firstCard.click();
    document.getElementById('prolog-confirm-yes').click();
    document.getElementById('prolog-next3').click();

    const transText = document.getElementById('prolog-transition-text');
    expect(transText).not.toBeNull();
    expect(transText.textContent).toContain(COLONY);
  });

  it('never contains "Khal\'Vethis" in transition text', () => {
    const firstCard = document.querySelector('#prolog-cards .prolog-card');
    firstCard.click();
    document.getElementById('prolog-confirm-yes').click();
    document.getElementById('prolog-next3').click();

    const transText = document.getElementById('prolog-transition-text');
    expect(transText.textContent).not.toContain("Khal'Vethis");
  });

  it('includes username in transition text', () => {
    const firstCard = document.querySelector('#prolog-cards .prolog-card');
    firstCard.click();
    document.getElementById('prolog-confirm-yes').click();
    document.getElementById('prolog-next3').click();

    const transText = document.getElementById('prolog-transition-text');
    expect(transText.textContent).toContain('TestCmd');
  });
});

// ── DOM: faction story in phase 3 ────────────────────────────────────────────

describe('GQProlog – faction story in phase 3', () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    loadProlog();
    window.GQProlog.show({ username: 'Tester', colonyName: 'Alpha', onComplete: () => {} });
  });

  it('faction story text is populated after card click + confirm', () => {
    const cards = document.querySelectorAll('#prolog-cards .prolog-card');
    // Click the first card (vor_tak)
    cards[0].click();
    document.getElementById('prolog-confirm-yes').click();

    const storyEl = document.getElementById('prolog-story');
    expect(storyEl).not.toBeNull();
    expect(storyEl.textContent.trim().length).toBeGreaterThan(0);
  });

  it('first mission is populated in phase 3', () => {
    const cards = document.querySelectorAll('#prolog-cards .prolog-card');
    cards[0].click();
    document.getElementById('prolog-confirm-yes').click();

    const missionEl = document.getElementById('prolog-mission');
    expect(missionEl.textContent).toContain('Erster Auftrag');
  });

  it('confirm back button hides the confirm overlay', () => {
    const cards = document.querySelectorAll('#prolog-cards .prolog-card');
    cards[0].click();
    const confirm = document.getElementById('prolog-confirm');
    expect(confirm.classList.contains('is-visible')).toBe(true);

    document.getElementById('prolog-confirm-back').click();
    expect(confirm.classList.contains('is-visible')).toBe(false);
  });
});

// ── DOM: complete / launch button ────────────────────────────────────────────

describe('GQProlog – complete flow', () => {
  it('calls onComplete when launch button is clicked', () => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    loadProlog();
    let completeCalled = false;
    window.GQProlog.show({
      username: 'Tester',
      colonyName: 'TestPlanet',
      onComplete: () => { completeCalled = true; },
    });

    // Navigate to phase 4
    const card = document.querySelector('#prolog-cards .prolog-card');
    card.click();
    document.getElementById('prolog-confirm-yes').click();
    document.getElementById('prolog-next3').click();
    document.getElementById('prolog-launch').click();

    expect(completeCalled).toBe(true);
  });

  it('hides the prolog section when complete', () => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    loadProlog();
    window.GQProlog.show({ username: 'T', colonyName: 'C', onComplete: () => {} });

    const card = document.querySelector('#prolog-cards .prolog-card');
    card.click();
    document.getElementById('prolog-confirm-yes').click();
    document.getElementById('prolog-next3').click();
    document.getElementById('prolog-launch').click();

    const section = document.getElementById('prolog-section');
    expect(section.classList.contains('hidden')).toBe(true);
  });
});

// ── Skip button ───────────────────────────────────────────────────────────────

describe('GQProlog – skip button', () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="prolog-section" class="prolog-section hidden"></section>';
    loadProlog();
    window.GQProlog.show({ username: 'Tester', colonyName: 'Skip', onComplete: () => {} });
  });

  it('skip jumps directly to phase 2', () => {
    document.getElementById('prolog-skip').click();
    const p2 = document.getElementById('prolog-p2');
    expect(p2.hidden).toBe(false);
    expect(p2.classList.contains('is-active')).toBe(true);
  });
});
