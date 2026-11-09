import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/layers/domain/trade/RuntimeTradersDashboardController.js');

function loadModule() {
  delete window.GQRuntimeTradersDashboardController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeTradersDashboardController;
}

describe('RuntimeTradersDashboardController dynamic HTML', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes API-provided trader, route, and opportunity fields despite an identity escaper', () => {
    const root = document.createElement('div');
    const controller = loadModule().createTradersDashboardController({
      wm: { body: () => root },
      api: {},
      documentRef: document,
      esc: (value) => String(value ?? ''),
    });
    controller.state = {
      status: { traders: '<img src=x onerror=alert(1)>', routes: { active: 2 }, opportunities: 1, total_profit: 0 },
      traders: [{
        name: '<svg onload=alert(1)>',
        faction_name: '"><img src=x onerror=alert(1)>',
        strategy: '<iframe src=javascript:alert(1)>',
      }],
      routes: [{
        id: '<b onclick=alert(1)>1</b>',
        trader_name: '<img src=x onerror=alert(1)>',
        resource_type: 'metal',
        status: '<svg onload=alert(1)>',
      }],
      opportunities: [{
        resource_type: '<iframe src=javascript:alert(1)>',
        source_system: '<img src=x onerror=alert(1)>',
        target_system: 2,
      }],
    };

    const host = document.createElement('div');
    host.innerHTML = controller.renderDashboardHtml();

    expect(host.querySelector('img, svg, iframe, b')).toBeNull();
    expect(host.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(host.textContent).toContain('<svg onload=alert(1)>');
    expect(host.textContent).toContain('<iframe src=javascript:alert(1)>');
    expect(host.textContent).toContain('S0 -> S2');
  });

  it('ignores trader event names outside the fixed supported action set', async () => {
    const root = document.createElement('div');
    const tradersEvent = vi.fn(async () => ({ success: true }));
    const controller = loadModule().createTradersDashboardController({
      wm: { body: () => root },
      api: {
        tradersEvent,
        tradersStatus: vi.fn(async () => ({ success: true })),
        tradersList: vi.fn(async () => ({ success: true, traders: [] })),
        tradersRoutes: vi.fn(async () => ({ success: true, routes: [] })),
        traderOpportunities: vi.fn(async () => ({ success: true, alerts: [] })),
      },
      documentRef: document,
    });
    const button = document.createElement('button');
    button.dataset.tradersEvent = 'unexpected_action';
    root.appendChild(button);
    controller.attachEventListeners(root);

    button.click();
    await Promise.resolve();

    expect(tradersEvent).not.toHaveBeenCalled();
  });
});
