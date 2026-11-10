// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let controllerApi;

beforeEach(() => {
  document.body.innerHTML = '<div id="colonization"></div>';
  delete window.GQRuntimeColonizationController;
  window.eval(readFileSync(path.resolve('js/engine/runtime/RuntimeColonizationController.js'), 'utf8'));
  controllerApi = window.GQRuntimeColonizationController;
});

function createController() {
  const root = document.querySelector('#colonization');
  const api = {
    colonizationSprawl: vi.fn().mockResolvedValue({
      success: true,
      sprawl_value: 10,
      admin_cap: 50,
      sprawl_pct: 20,
      malus: { status: '<img src=x onerror=alert(1)>' },
    }),
    colonizationSectors: vi.fn().mockResolvedValue({
      success: true,
      sectors: [
        { id: '7" onclick="alert(1)', name: '<img src=x onerror=alert(1)>', system_count: 2 },
        { id: '42', name: '<svg onload=alert(1)>', system_count: 1 },
      ],
    }),
    colonizationGovernors: vi.fn().mockResolvedValue({
      success: true,
      governors: [
        { id: '9" onclick="alert(1)', sector_id: 1, sector_name: '<iframe src=javascript:alert(1)>' },
        { id: 8, sector_id: null },
      ],
    }),
    colonizationEdicts: vi.fn().mockResolvedValue({
      success: true,
      edicts: [
        { edict_type: 'administrative_efficiency', active: true, cost_per_tick: 10 },
        { edict_type: 'unknown" onclick="alert(1)', active: false, cost_per_tick: 5 },
      ],
    }),
  };
  const controller = controllerApi.createColonizationController({
    wm: { body: () => root },
    api,
    esc: (value) => String(value ?? ''),
  });
  return { controller, root, api };
}

describe('RuntimeColonizationController rendering', () => {
  it('escapes API payloads internally and excludes invalid IDs and edict actions', async () => {
    const { controller, root } = createController();

    await controller.render();

    expect(root.querySelector('img, svg, iframe')).toBeNull();
    expect(root.querySelector('td').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('.sec-delete-btn').dataset.sectorId).toBe('42');
    expect(root.querySelector('.sec-delete-btn').dataset.sectorName).toBe('<svg onload=alert(1)>');
    expect(root.querySelector('.gov-dismiss-btn')).toBeNull();
    expect(root.querySelector('.gov-appoint-btn').dataset.governorId).toBe('8');
    expect(root.querySelectorAll('.edict-activate-btn, .edict-deactivate-btn')).toHaveLength(1);
    expect(root.querySelector('[data-edict-type="administrative_efficiency"]')).not.toBeNull();
    expect(root.textContent).toContain('<iframe src=javascript:alert(1)>');
    expect(root.textContent).toContain('Unbekanntes Edikt');
  });
});
