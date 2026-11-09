import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/layers/domain/trade/RuntimeTradeProposalsController.js');

function loadModule() {
  delete window.GQRuntimeTradeProposalsController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeTradeProposalsController;
}

describe('RuntimeTradeProposalsController dynamic HTML', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes proposal data and only renders actions for safe numeric IDs', async () => {
    const root = document.createElement('div');
    const api = {
      listTradeProposals: vi.fn(async () => ({
        proposals: [
          {
            id: '7" onclick="alert(1)',
            is_mine: false,
            initiator_name: '<img src=x onerror=alert(1)>',
            status: '<svg onload=alert(1)>',
            offer: { metal: '<img src=x onerror=alert(1)>', crystal: 10, deuterium: 0 },
            request: { metal: 0, crystal: 0, deuterium: 0 },
            message: '<iframe src=javascript:alert(1)>',
            expires_at: '2026-12-01T00:00:00Z',
          },
          {
            id: 8,
            is_mine: false,
            initiator_name: 'Valid trader',
            status: 'pending',
            offer: { metal: 1, crystal: 0, deuterium: 0 },
            request: { metal: 0, crystal: 0, deuterium: 0 },
            message: '',
            expires_at: '2026-12-01T00:00:00Z',
          },
        ],
      })),
    };
    const controller = loadModule().createTradeProposalsController({
      wm: { body: () => root },
      api,
      documentRef: document,
      esc: (value) => String(value ?? ''),
    });

    await controller.render();

    expect(root.querySelector('img, svg, iframe')).toBeNull();
    expect(root.querySelector('[onclick], [onerror], [onload]')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('<svg onload=alert(1)>');
    expect(root.textContent).toContain('<iframe src=javascript:alert(1)>');
    expect(root.querySelectorAll('[data-accept]')).toHaveLength(1);
    expect(root.querySelector('[data-accept]').dataset.accept).toBe('8');
    expect(root.querySelector('[data-reject]').dataset.reject).toBe('8');
  });

  it('escapes target names and resource metadata in the proposal dialog despite identity escapers', () => {
    const targetName = '"><img src=x onerror=alert(1)>';
    const controller = loadModule().createTradeProposalsController({
      wm: { body: () => document.createElement('div') },
      api: {},
      documentRef: document,
      esc: (value) => String(value ?? ''),
      getResourceInsightConfig: () => ({
        key: 'metal',
        tradeable: true,
        icon: '<svg onload=alert(1)>',
        label: '<img src=x onerror=alert(1)>',
      }),
    });

    controller.showProposeDialog(0, targetName, { resourceKey: 'metal', mode: 'request' });

    const dialog = document.getElementById('trade-propose-dialog');
    expect(dialog.querySelector('img, svg')).toBeNull();
    expect(dialog.querySelector('[onerror], [onload]')).toBeNull();
    expect(dialog.querySelector('#tp-target-name').value).toBe(targetName);
    expect(dialog.textContent).toContain('<svg onload=alert(1)>');
    expect(dialog.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
