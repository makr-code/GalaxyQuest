import { describe, expect, it, vi } from 'vitest';
import { createEconomyResourceCards } from '../../js/ui/game-economy-visuals.js';

describe('Visual economy resources', () => {
  function chart(overrides = {}, options = {}) {
    return createEconomyResourceCards({
      storage: { metal: 100 },
      economy: { stock: { metal: 50, food: 0 }, production: { metal: 10, food: 0 },
        consumption: { metal: 20, food: 0 } },
      ...overrides,
    }, { onInspect: vi.fn(), ...options });
  }
  it('renders exact stocks, real capacity and shared-scale rate bars with a negative balance', () => {
    const root = chart();
    const metal = root.querySelector('[data-resource-card="metal"]');
    expect(metal.querySelector('.game-economy-amount').textContent).toBe('50');
    expect(metal.querySelector('meter').value).toBe(50);
    expect(metal.querySelector('meter').max).toBe(100);
    expect(metal.querySelector('[data-rate="production"] .game-economy-rate-track > span').style.width).toBe('50%');
    expect(metal.querySelector('[data-rate="consumption"] .game-economy-rate-track > span').style.width).toBe('100%');
    expect(metal.querySelector('.game-economy-deficit').textContent).toBe('Bilanz/h: -10');
    expect(root.querySelector('[data-resource-card="food"] meter')).toBeNull();
    expect(root.querySelector('[data-resource-card="food"] .game-economy-surplus').textContent).toBe('Bilanz/h: 0');
  });
  it('does not fabricate missing rates, capacity or balances', () => {
    const root = chart({ storage: { metal: 0 }, economy: {
      stock: { metal: 0 }, production: { metal: 5 }, consumption: {},
    } });
    expect(root.querySelector('meter')).toBeNull();
    expect(root.querySelector('[data-rate="consumption"]').textContent).toContain('Nicht verfügbar');
    expect(root.querySelector('article > p').textContent).toBe('Bilanz/h: Nicht verfügbar');
    expect(root.querySelector('.game-economy-surplus')).toBeNull();
    expect(root.querySelector('.game-economy-chart-note').textContent).toContain('keine Prognose');
  });
  it('shows over-capacity stocks without changing them and handles zero rates', () => {
    const root = chart({ economy: { stock: { metal: 150 }, production: { metal: 0 }, consumption: { metal: 0 } } });
    expect(root.querySelector('.game-economy-amount').textContent).toBe('150');
    expect(root.querySelector('meter').value).toBe(100);
    expect(root.querySelector('.game-economy-deficit').textContent).toBe('Über Kapazität');
    expect([...root.querySelectorAll('.game-economy-rate-track > span')].map((bar) => bar.style.width))
      .toEqual(['0%', '0%']);
  });
  it('keeps selection, accessible labels and safe fallback resource names', () => {
    const onInspect = vi.fn();
    const root = chart({ storage: {}, economy: { stock: { '<img src=x>': 1 } } },
      { selectedResource: '<img src=x>', onInspect });
    expect(root.querySelector('article').getAttribute('aria-current')).toBe('true');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('button').getAttribute('aria-label')).toBe('<img src=x> Bestandsdetails');
    root.querySelector('svg').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onInspect).toHaveBeenCalledExactlyOnceWith('<img src=x>');
  });
});
