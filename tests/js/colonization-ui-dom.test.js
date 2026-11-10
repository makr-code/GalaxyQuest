import { describe, expect, it, vi } from 'vitest';
import { ColonizationUI } from '../../js/engine/runtime/domains/colonization/ColonizationUI.js';

function createController(colony) {
  const state = {
    get(key) {
      if (key === 'totalPopulation') return colony ? colony.population : 0;
      if (key === 'totalColonies') return colony ? 1 : 0;
      if (key === 'buildingTypes') {
        return {
          factory: {
            id: 'factory"><img src=x onerror=alert(1)>',
            name: '<svg onload=alert(2)>',
          },
        };
      }
      return undefined;
    },
  };

  return {
    state,
    onStateChange: null,
    getAllColonies: vi.fn(() => colony ? [colony] : []),
    getColony: vi.fn(() => colony),
    addBuilding: vi.fn(),
    save: vi.fn(),
  };
}

describe('ColonizationUI DOM output', () => {
  it('renders colony data as text and dispatches build actions without HTML attributes', () => {
    const container = document.createElement('div');
    const colony = {
      id: 'colony"><img src=x onerror=alert(3)>',
      name: '<img src=x onerror=alert(4)>',
      status: 'active" onclick="alert(5)',
      population: 120,
      populationCap: 100,
      growthRate: 0.05,
      resources: {
        credits: '<iframe src=javascript:alert(6)>',
        minerals: 2,
        energy: 3,
        food: 4,
      },
      buildings: {
        factory: { count: 2 },
      },
    };
    const controller = createController(colony);

    new ColonizationUI(controller, container);

    expect(container.querySelector('img, svg, iframe')).toBeNull();
    expect(container.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(container.querySelector('.colony-name')?.textContent).toBe(colony.name);
    expect(container.querySelector('.colony-status')?.textContent).toBe('unknown');
    expect(container.querySelector('.population-fill')?.style.width).toBe('100%');
    expect(container.querySelector('.colony-resources')?.textContent).toContain('💰 0');

    container.querySelector('.colony-card').click();
    expect(controller.getColony).toHaveBeenCalledWith(colony.id);
    expect(container.querySelector('.colonization-section-details')?.textContent).toContain(colony.name);
    expect(container.querySelector('button.build-btn')?.textContent).toContain('<svg onload=alert(2)>');

    container.querySelector('button.build-btn').click();
    expect(controller.addBuilding).toHaveBeenCalledWith(colony.id, 'factory"><img src=x onerror=alert(1)>', 1);
    expect(container.querySelector('img, svg, iframe')).toBeNull();
  });

  it('renders an empty-state message when there are no colonies', () => {
    const container = document.createElement('div');
    const controller = createController(null);

    new ColonizationUI(controller, container);

    expect(container.querySelector('.empty-message')?.textContent).toBe('No colonies yet. Colonize a planet to begin.');
    expect(container.querySelector('.colonies-list')?.children).toHaveLength(0);
  });
});
