// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let widgetApi;

beforeEach(() => {
  document.body.innerHTML = '<div id="advisor-hints"></div>';
  delete window.GQRuntimeAdvisorWidget;
  window.eval(readFileSync(path.resolve('js/engine/runtime/RuntimeAdvisorWidget.js'), 'utf8'));
  widgetApi = window.GQRuntimeAdvisorWidget;
});

function createWidget(api) {
  let onRender;
  const wm = {
    body: vi.fn(() => document.querySelector('#advisor-hints')),
    open: vi.fn(),
    register: vi.fn((_id, options) => {
      onRender = options.onRender;
    }),
  };
  const widget = widgetApi.createAdvisorWidget({ api, wm, documentRef: document });
  widget.register();
  return { widget, wm, render: () => onRender() };
}

describe('RuntimeAdvisorWidget DOM rendering', () => {
  it('renders advisor and hint payloads as text and restricts hint classes and action windows', async () => {
    const api = {
      advisorHints: vi.fn().mockResolvedValue({
        success: true,
        advisor: {
          name: '<img src=x onerror=alert(1)>',
          portrait: '<svg onload=alert(1)>',
          tagline: '<iframe src=javascript:alert(1)>',
        },
        hints: [
          {
            id: '7',
            hint_type: 'warning',
            title: '<img src=x onerror=alert(1)>',
            body: '<svg onload=alert(1)>',
            action_label: '<b>Open Research</b>',
            action_window: 'research',
          },
          {
            id: '8" onclick="alert(1)',
            hint_type: 'warning" onclick="alert(1)',
            title: 'Invalid metadata',
            body: 'Still plain text',
            action_label: 'Injected action',
            action_window: 'javascript:alert(1)',
          },
        ],
      }),
      dismissHint: vi.fn(),
      advisorTick: vi.fn(),
    };
    const { widget, wm, render } = createWidget(api);

    await widget.load();
    render();

    const root = document.querySelector('#advisor-hints');
    expect(root.querySelector('img, svg, iframe, b')).toBeNull();
    expect(document.querySelector('#advisor-bubble-portrait').textContent).toBe('<svg onload=alert(1)>');
    expect(root.querySelector('strong').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('.advisor-hint-title').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('.advisor-hint-body').textContent).toBe('<svg onload=alert(1)>');
    expect(root.querySelector('.advisor-hint-card').className).toBe('advisor-hint-card hint-warning');
    expect(root.querySelectorAll('.advisor-hint-card')).toHaveLength(2);
    expect(root.querySelectorAll('.hint-action-btn')).toHaveLength(1);
    expect(root.querySelector('.hint-action-btn').textContent).toBe('<b>Open Research</b>');
    expect(root.querySelector('.hint-action-btn').dataset.window).toBe('research');
    expect(root.querySelector('.advisor-hint-card[data-hid="7"]')).not.toBeNull();
    expect(root.querySelector('.advisor-hint-card[data-hid]')).toBe(root.querySelector('.advisor-hint-card'));
    expect(wm.open).not.toHaveBeenCalled();

    root.querySelector('.hint-action-btn').click();
    expect(wm.open).toHaveBeenCalledWith('research');
  });

  it('does not expose dismiss actions for invalid hint IDs', async () => {
    const api = {
      advisorHints: vi.fn().mockResolvedValue({
        success: true,
        advisor: { name: 'Advisor' },
        hints: [{ id: 'Infinity', hint_type: 'tip', title: 'Hint', body: 'Body' }],
      }),
      dismissHint: vi.fn(),
      advisorTick: vi.fn(),
    };
    const { widget, render } = createWidget(api);

    await widget.load();
    render();

    const root = document.querySelector('#advisor-hints');
    expect(root.querySelector('.dismiss-hint-btn')).toBeNull();
    expect(root.querySelector('.advisor-hint-card').hasAttribute('data-hid')).toBe(false);
  });
});
