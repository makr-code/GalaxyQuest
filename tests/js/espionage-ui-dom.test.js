import { describe, expect, it, vi } from 'vitest';
import { EspionageUI } from '../../js/engine/runtime/domains/espionage/EspionageUI.js';

describe('EspionageUI DOM output', () => {
  it('renders spy, intelligence, and operation data as text', () => {
    const container = document.createElement('div');
    const controller = {
      getFactionSpies: vi.fn(() => [{
        status: 'active',
        name: '<img src=x onerror=alert(1)>',
        targetFaction: '<svg onload=alert(2)>',
        skill: 73.6,
      }]),
      getFactionIntelligence: vi.fn(() => [{
        discovered: false,
        type: '<iframe src=javascript:alert(3)>',
        target: '<b onclick=alert(4)>',
        reliability: 86.4,
      }]),
      getOperations: vi.fn(() => [{
        status: 'active',
        targetType: '<img src=x onerror=alert(5)>',
        target: '<svg onload=alert(6)>',
        progress: 150,
      }]),
      onStateChange: null,
    };

    new EspionageUI(controller, container);

    expect(container.querySelector('img, svg, iframe, b')).toBeNull();
    expect(container.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(container.querySelector('.spies li')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('.intelligence li')?.textContent).toContain('<iframe src=javascript:alert(3)>');
    expect(container.querySelector('.operations li')?.textContent).toContain('(100%)');
  });

  it('renders empty states for all sections', () => {
    const container = document.createElement('div');
    const controller = {
      getFactionSpies: () => [],
      getFactionIntelligence: () => [],
      getOperations: () => [],
      onStateChange: null,
    };

    new EspionageUI(controller, container);

    expect(container.querySelector('.spies')?.textContent).toContain('No active spies');
    expect(container.querySelector('.intelligence')?.textContent).toContain('No intelligence gathered');
    expect(container.querySelector('.operations')?.textContent).toContain('No active operations');
  });
});
