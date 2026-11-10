import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/layers/domain/pirates/RuntimePiratesController.js');

function loadModule() {
  delete window.GQRuntimePiratesController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimePiratesController;
}

describe('RuntimePiratesController dynamic HTML', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes API-provided faction, raid, forecast, and contract data despite an identity escaper', () => {
    const controller = loadModule().createPiratesController({
      wm: { body: () => document.createElement('div') },
      api: {},
      esc: (value) => String(value ?? ''),
    });
    controller.state.status = {
      summary: { pirate_factions: '<img src=x onerror=alert(1)>' },
      factions: [{
        id: 1,
        icon: '<svg onload=alert(1)>',
        name: '<img src=x onerror=alert(1)>',
        standing: 2,
        aggression: 3,
        power_level: 4,
        threat_score: 5,
        threat_level: '<iframe src=javascript:alert(1)>',
      }],
    };
    controller.state.raids = [{
      id: 7,
      sent_at: '"><svg onload=alert(1)>',
      body: '<img src=x onerror=alert(1)>',
      is_read: 0,
    }];
    controller.state.forecast = {
      risk_index: 1,
      risk_level: '<b onclick=alert(1)>high</b>',
      raids_last_24h: 2,
      recommended_action: '<iframe src=javascript:alert(1)>',
    };
    controller.state.contracts = [{
      faction_icon: '<svg onload=alert(1)>',
      faction_name: '<img src=x onerror=alert(1)>',
      contract_type: '<b onclick=alert(1)>tribute</b>',
      credit_payment: 100,
      expires_at: '<img src=x onerror=alert(1)>',
    }];

    const host = document.createElement('div');
    host.innerHTML = controller.renderHtml();

    expect(host.querySelector('img, svg, iframe, b')).toBeNull();
    expect(host.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.textContent).toContain('<svg onload=alert(1)>');
    expect(host.textContent).toContain('<iframe src=javascript:alert(1)>');
  });

  it('refuses to submit a contract when the selected faction ID is invalid', async () => {
    const root = document.createElement('div');
    const proposeContract = vi.fn(async () => ({ accepted: true }));
    const showToast = vi.fn();
    const controller = loadModule().createPiratesController({
      wm: { body: () => root },
      api: { piratesProposeContract: proposeContract },
      showToast,
    });
    controller.state.status = {
      summary: {},
      factions: [{ id: '1"><img src=x onerror=alert(1)>', icon: 'P', name: 'Pirates' }],
    };
    root.innerHTML = controller.renderHtml();
    controller.attachEventListeners(root);

    root.querySelector('[data-pirates-propose-contract]').click();
    expect(root.querySelector('[data-cf-faction] option').value).toBe('0');
    root.querySelector('[data-cf-submit]').click();
    await Promise.resolve();

    expect(proposeContract).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Invalid contract data.', 'error');
  });
});
