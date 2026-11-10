import { describe, expect, it, vi } from 'vitest';
import { AllianceUI } from '../../js/engine/runtime/domains/alliance/AllianceUI.js';

describe('AllianceUI DOM output', () => {
  it('renders alliance data as text and preserves selection details', () => {
    const container = document.createElement('div');
    const alliance = {
      id: 'alliance"><img src=x onerror=alert(1)>',
      name: '<img src=x onerror=alert(2)>',
      leader: '<svg onload=alert(3)>',
      members: ['<iframe src=javascript:alert(4)>'],
      treasury: {
        credits: '<b onclick=alert(5)>100</b>',
        minerals: 50,
        energy: 25,
      },
    };
    const controller = {
      getAllAlliances: vi.fn(() => [alliance]),
      getAlliance: vi.fn(() => alliance),
      onStateChange: null,
    };

    new AllianceUI(controller, container);

    expect(container.querySelector('img, svg, iframe, b')).toBeNull();
    expect(container.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(container.querySelector('.alliance-card')?.textContent).toContain(alliance.name);
    expect(container.querySelector('.alliance-name')?.textContent).toBe(alliance.name);

    container.querySelector('.alliance-card').click();

    expect(controller.getAlliance).toHaveBeenCalledWith(alliance.id);
    expect(container.querySelector('.alliance-card')?.classList.contains('selected')).toBe(true);
    expect(container.querySelector('.alliance-section-details')?.textContent).toContain(alliance.leader);
    expect(container.querySelector('.alliance-section-details')?.textContent).toContain(alliance.members[0]);
    expect(container.querySelector('.alliance-section-details')?.textContent).toContain(alliance.treasury.credits);
    expect(container.querySelector('img, svg, iframe, b')).toBeNull();
  });
});
