import { beforeEach, describe, expect, it } from 'vitest';
import { DiplomacyUI } from '../../js/engine/runtime/domains/diplomacy/DiplomacyUI.js';

describe('DiplomacyUI DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes faction and incident content and bounds relation scores', () => {
    const container = document.createElement('div');
    const controller = {
      getAllRelations: () => [
        {
          factions: ['<img src=x onerror=alert(1)>', '<svg onload=alert(2)>'],
          status: 'enemy" onclick="alert(3)',
          score: 150,
        },
        {
          factions: ['Alpha', 'Beta'],
          status: 'ally',
          score: -10,
        },
      ],
      getIncidents: () => [{
        between: ['<b onclick=alert(5)>A</b>', '<iframe src=javascript:alert(6)>B</iframe>'],
        type: '<img src=x onerror=alert(7)>',
        severity: '<svg onload=alert(8)>',
      }],
      save: async () => {},
    };

    new DiplomacyUI(controller, container);

    expect(container.querySelector('img, svg, b, iframe')).toBeNull();
    expect(container.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(container.querySelectorAll('.relation-fill')[0].style.width).toBe('100%');
    expect(container.querySelectorAll('.relation-fill')[0].style.background).toBe('gray');
    expect(container.querySelectorAll('.relation-fill')[1].style.width).toBe('0%');
    expect(container.querySelector('tr td:nth-child(3)')?.textContent).toBe('neutral');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('<img src=x onerror=alert(7)>');
  });
});
