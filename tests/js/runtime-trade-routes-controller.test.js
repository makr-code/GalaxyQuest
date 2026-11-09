import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/layers/domain/trade/RuntimeTradeRoutesController.js');

function loadModule() {
  delete window.GQRuntimeTradeRoutesController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeTradeRoutesController;
}

describe('RuntimeTradeRoutesController dynamic HTML', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes suggestion values and constrains embedded IDs and numeric cargo', () => {
    const controller = loadModule().createTradeRoutesController({
      wm: { body: () => document.createElement('div') },
      api: {},
      documentRef: document,
      esc: (value) => String(value ?? ''),
    });
    const host = document.createElement('div');
    host.innerHTML = controller.renderSuggestionCard({
      origin_name: '<img src=x onerror=alert(1)>',
      target_name: '"><svg onload=alert(1)>',
      resource_type: '<iframe src=javascript:alert(1)>',
      interval_hours: 24,
      estimated_distance_ly: 1.5,
      cargo: {
        metal: '<img src=x onerror=alert(1)>',
        '<svg onload=alert(1)>': 100,
      },
      origin_colony_id: '1"><img src=x onerror=alert(1)>',
      target_colony_id: 2,
      priority: '<img src=x onerror=alert(1)>',
      priority_score: 1,
      priority_multiplier: 1,
      reason: 'welfare-shortage',
    }, 'colony');

    expect(host.querySelector('img, svg, iframe')).toBeNull();
    expect(host.querySelector('[onerror], [onload]')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.textContent).toContain('<svg onload=alert(1)>');
    expect(host.textContent).toContain('<iframe src=javascript:alert(1)>');
    expect(host.querySelector('[data-apply-suggestion]').getAttribute('data-apply-suggestion')).toMatch(/^0\|2\|/);
    expect(host.querySelector('[data-apply-suggestion]').getAttribute('data-apply-suggestion')).not.toContain('<');
  });

  it('escapes route names and converts IDs, cargo, and intervals to safe numeric output', () => {
    const controller = loadModule().createTradeRoutesController({
      wm: { body: () => document.createElement('div') },
      api: {},
      documentRef: document,
      esc: (value) => String(value ?? ''),
    });
    const host = document.createElement('div');
    host.innerHTML = controller.renderRouteCard({
      id: '3" onclick="alert(1)',
      origin_name: '<img src=x onerror=alert(1)>',
      target_name: '<svg onload=alert(1)>',
      interval_hours: '<b onclick=alert(1)>12</b>',
      is_active: true,
      is_due: false,
      cargo: {
        metal: '<img src=x onerror=alert(1)>',
        crystal: 10,
        deuterium: 5,
      },
    });

    expect(host.querySelector('img, svg, b')).toBeNull();
    expect(host.querySelector('[onclick], [onerror], [onload]')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.textContent).toContain('<svg onload=alert(1)>');
    expect(host.textContent).toContain('Interval: 24h');
    expect(host.querySelector('[data-toggle-route]').dataset.toggleRoute).toBe('0');
    expect(host.querySelector('[data-delete-route]').dataset.deleteRoute).toBe('0');
  });
});
