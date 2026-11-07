import { describe, expect, it } from 'vitest';
import { createGameIcon, createFleetMissionBadge, createStockChart, decorateGameAction } from '../../js/ui/game-ui-visuals.js';

describe('Visual game UI', () => {
  it('labels all launch missions with distinct icons and safely preserves unknown missions', () => {
    const missions = { transport: 'Transport', attack: 'Angriff', spy: 'Spionage',
      colonize: 'Kolonisieren', harvest: 'Rohstoffe sammeln', survey: 'System erkunden' };
    const icons = [];
    for (const [mission, label] of Object.entries(missions)) {
      const badge = createFleetMissionBadge(mission);
      expect(badge.textContent).toBe(label);
      expect(badge.dataset.mission).toBe(mission);
      expect(badge.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
      icons.push(badge.querySelector('path').getAttribute('d'));
    }
    expect(new Set(icons).size).toBe(6);
    for (const mission of ['new_mission', '<img src=x>', 'constructor']) {
      const badge = createFleetMissionBadge(mission);
      expect(badge.dataset.mission).toBe('unknown');
      expect(badge.textContent).toBe(`Mission: ${mission.replaceAll('_', ' ')}`);
      expect(badge.querySelector('img')).toBeNull();
    }
  });
  it('distinguishes every canonical market good and uses a neutral fallback for unknown names', () => {
    const goods = ['metal', 'crystal', 'deuterium', 'rare_earth', 'food',
      'steel_alloy', 'focus_crystals', 'reactor_fuel', 'biocompost', 'electronics_components',
      'consumer_goods', 'luxury_goods', 'military_equipment', 'research_kits', 'colonization_packs',
      'neural_implants', 'quantum_circuits', 'bio_supplements', 'stellar_art', 'advanced_propulsion',
      'void_crystals', 'synthetic_consciousness', 'temporal_luxuries'];
    const path = name => createGameIcon(name).querySelector('path').getAttribute('d');
    const neutral = path('goods');
    const icons = goods.map(path);
    expect(new Set(icons).size).toBe(goods.length);
    expect(icons.every(icon => icon !== neutral && icon !== path('planet'))).toBe(true);
    for (const name of ['unknown_good', '<img src=x>', 'constructor', '__proto__', 'toString']) {
      expect(path(name)).toBe(neutral);
      expect(createGameIcon(name).querySelector('img')).toBeNull();
    }
  });
  it('creates decorative vector icons with readable and injection-safe action captions', () => {
    const button = document.createElement('button');
    decorateGameAction(button, 'research', '<img src=x>');
    expect(button.textContent).toBe('<img src=x>');
    expect(button.querySelector('img')).toBeNull();
    expect(button.title).toBe('<img src=x>');
    const icon = button.querySelector('svg');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('focusable')).toBe('false');
    expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(createGameIcon('buildings').querySelector('path').getAttribute('d'))
      .not.toBe(icon.querySelector('path').getAttribute('d'));
  });
  it('shows exact stock values with bars relative to the largest shown stock, not capacity', () => {
    const chart = createStockChart({ metal: 200, crystal: '100', deuterium: 0, food: 50, rare_earth: 1.25 });
    const bars = [...chart.querySelectorAll('.game-stock-track > span')];
    expect(bars.map((bar) => bar.style.width)).toEqual(['100%', '50%', '0%', '25%', '0.625%']);
    expect(chart.querySelector('[data-resource="rare_earth"] .game-stock-value').textContent)
      .toBe(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(1.25));
    expect(chart.querySelector('p').textContent).toContain('keine Lagerkapazität');
    expect([...chart.querySelectorAll('.game-stock-track')].every((track) => track.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
  it('does not turn unknown values into zero or generate invalid bar dimensions', () => {
    const chart = createStockChart({ metal: null, crystal: '', deuterium: false, food: Infinity, rare_earth: 'invalid' });
    expect([...chart.querySelectorAll('.game-stock-value')].map((value) => value.textContent))
      .toEqual(Array(5).fill('Nicht verfügbar'));
    expect([...chart.querySelectorAll('.game-stock-track > span')].map((bar) => bar.style.width))
      .toEqual(Array(5).fill('0%'));
    const negative = createStockChart({ metal: -10, crystal: 0 });
    expect(negative.querySelector('.game-stock-value').textContent).toBe('-10');
    expect(negative.querySelector('.game-stock-track > span').style.width).toBe('0%');
  });
});
