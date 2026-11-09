import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeAlliancesController.js');

function loadModule() {
  delete window.GQRuntimeAlliancesController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeAlliancesController;
}

describe('RuntimeAlliancesController dynamic HTML', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes alliance data and restricts inline handler IDs to numeric values', async () => {
    const root = document.createElement('div');
    const controller = loadModule().createAlliancesController({
      wm: { body: () => root },
      api: {
        alliances: vi.fn(async () => ({
          user_alliance_id: '1);alert(1)//',
          alliances: [{
            id: '2);alert(1)//',
            tag: '<svg onload=alert(1)>',
            name: '<img src=x onerror=alert(1)>',
            leader_name: 'Leader "><svg onload=alert(1)>',
            member_count: '<b onclick=alert(1)>2</b>',
            description: '<iframe src=javascript:alert(1)>',
          }],
        })),
      },
      documentRef: document,
      uiKitSkeletonHTML: () => '',
      uiKitEmptyStateHTML: () => '',
      esc: (value) => String(value ?? ''),
    });

    await controller.render();

    expect(root.querySelector('img, svg, iframe, b')).toBeNull();
    expect(root.querySelector('[onerror], [onload]')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('<svg onload=alert(1)>');
    expect(root.querySelector('button').getAttribute('onclick')).toBe('GQAlliancesController.showAllianceDetails(0)');
  });

  it('escapes relation data and formatted treasury values even when identity formatters are injected', async () => {
    const root = document.createElement('div');
    const controller = loadModule().createAlliancesController({
      wm: { body: () => root },
      api: {
        allianceDetails: vi.fn(async () => ({
          alliance: {
            id: 8,
            tag: '<svg onload=alert(1)>',
            name: '<img src=x onerror=alert(1)>',
            description: '',
            leader_id: '5"><img src=x onerror=alert(1)>',
            created_at: '2026-01-01T00:00:00Z',
            treasury: {
              metal: '<img src=x onerror=alert(1)>',
              crystal: 2,
              deuterium: 3,
              dark_matter: 4,
            },
          },
          members: [],
          is_member: true,
          user_role: 'leader',
        })),
        allianceRelations: vi.fn(async () => ({
          relations: [{
            relation_type: 'war"><img src=x onerror=alert(1)>',
            other_alliance_tag: '<svg onload=alert(1)>',
            other_alliance_name: '<img src=x onerror=alert(1)>',
          }],
        })),
      },
      documentRef: document,
      esc: (value) => String(value ?? ''),
      fmt: (value) => String(value ?? ''),
    });

    await controller.showAllianceDetails(8);

    expect(root.querySelector('img, svg')).toBeNull();
    expect(root.querySelector('[onerror], [onload]')).toBeNull();
    expect(root.textContent).toContain('Metal <img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('[<svg onload=alert(1)>] <img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('(war"><img src=x onerror=alert(1)>)');
  });
});
