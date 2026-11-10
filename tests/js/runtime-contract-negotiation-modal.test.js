import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeContractNegotiationModal.js');

function loadModule() {
  delete window.GQRuntimeContractNegotiationModal;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeContractNegotiationModal;
}

describe('RuntimeContractNegotiationModal dynamic HTML', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes faction and agreement data, validates faction IDs, and restricts CSS colors', async () => {
    const modal = vi.fn();
    const controller = loadModule().createModal({
      api: {
        factionAgreementsTypes: vi.fn(async () => ({
          types: [{
            code: '"><img src=x onerror=alert(1)>',
            icon: '<svg onload=alert(1)>',
            label: '<img src=x onerror=alert(1)>',
            player_offer_slots: [{
              term: '"><input autofocus onfocus=alert(1)>',
              label: '<iframe src=javascript:alert(1)>',
              resource: '<img src=x onerror=alert(1)>',
            }],
            faction_demand_templates: [{
              term: 'tribute',
              label: '<svg onload=alert(1)>',
            }],
            min_standing: 0,
            standing_reward: 10,
          }],
        })),
      },
      wm: { modal },
      esc: (value) => String(value ?? ''),
      dataModel: {
        getType: () => null,
        getTypes: () => [],
        standingMeterHTML: () => '<div class="standing-meter">meter</div>',
        acceptanceBarHTML: () => '<div class="acceptance-bar">bar</div>',
      },
    });

    await controller.open({
      id: '7" onmouseover="alert(1)',
      name: '<img src=x onerror=alert(1)>',
      icon: '<svg onload=alert(1)>',
      color: 'red;background:url(javascript:alert(1))',
      standing: 20,
    });

    const modalOptions = modal.mock.calls[0][1];
    const host = document.createElement('div');
    host.innerHTML = modalOptions.html;

    expect(host.querySelector('img, svg, iframe, input[autofocus]')).toBeNull();
    expect(host.querySelector('[onerror], [onload], [onfocus], [onmouseover]')).toBeNull();
    expect(host.querySelector('.gq-negotiate-modal').dataset.factionId).toBe('0');
    expect(host.querySelector('.gq-negotiate-modal__faction').style.color).toBe('rgb(255, 255, 255)');
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.textContent).toContain('<svg onload=alert(1)>');
    expect(host.querySelector('#gq-neg-type-select option').value).toBe('"><img src=x onerror=alert(1)>');
  });
});
