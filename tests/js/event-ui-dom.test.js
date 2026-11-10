import { describe, expect, it, vi } from 'vitest';
import { EventUI } from '../../js/engine/runtime/domains/event/EventUI.js';

describe('EventUI DOM output', () => {
  it('renders event and log data as text and dispatches only the selected event type', () => {
    const container = document.createElement('div');
    let triggered = false;
    const event = {
      type: 'supernova"><img src=x onerror=alert(1)>',
      title: '<svg onload=alert(2)>',
      description: '<iframe src=javascript:alert(3)>',
      severity: 'constructor',
      triggered: false,
    };
    const controller = {
      onStateChange: null,
      getAllEvents: vi.fn(() => [{ ...event, triggered }]),
      getEventLog: vi.fn(() => [{
        title: '<img src=x onerror=alert(4)>',
        timestamp: 0,
        severity: 'major" onclick="alert(5)',
        consequences: ['<b onclick=alert(6)>damage</b>'],
      }]),
      triggerEvent: vi.fn(() => {
        triggered = true;
      }),
      save: vi.fn(),
    };

    new EventUI(controller, container);

    expect(container.querySelector('img, svg, iframe, b')).toBeNull();
    expect(container.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(container.querySelector('.event-card')?.textContent).toContain(event.title);
    expect(container.querySelector('.event-desc')?.textContent).toBe(event.description);
    expect(container.querySelector('.event-log')?.textContent).toContain('<img src=x onerror=alert(4)>');
    expect(container.querySelector('.event-card')?.getAttribute('data-event-type')).toBe(event.type);

    container.querySelector('.btn-trigger').click();

    expect(controller.triggerEvent).toHaveBeenCalledWith(event.type);
    expect(container.querySelector('.btn-trigger')?.disabled).toBe(true);
    expect(container.querySelector('img, svg, iframe, b')).toBeNull();
  });

  it('renders an empty log and does not trigger an event removed since rendering', () => {
    const container = document.createElement('div');
    const controller = {
      onStateChange: null,
      getAllEvents: vi.fn(() => [{ type: 'famine', title: 'Famine', triggered: false }]),
      getEventLog: () => [],
      triggerEvent: vi.fn(),
      save: vi.fn(),
    };

    new EventUI(controller, container);
    controller.getAllEvents.mockReturnValue([]);
    container.querySelector('.btn-trigger').click();

    expect(controller.triggerEvent).not.toHaveBeenCalled();
    expect(container.querySelector('.event-log')?.textContent).toContain('No events triggered');
  });
});
