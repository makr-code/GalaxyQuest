import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeIntelController.js');

function loadController(detail) {
  delete window.GQRuntimeIntelController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));

  const root = document.createElement('div');
  const controller = window.GQRuntimeIntelController.createIntelController({
    wm: { body: () => root },
    documentRef: document,
    api: {
      spyReports: async () => ({ success: true, spy_reports: [] }),
      battleReports: async () => ({
        success: true,
        battle_reports: [{ id: 7, created_at: '2026-01-01', report: { rounds: [] } }],
      }),
      fleets: async () => ({ success: true, fleets: [] }),
      battleReportDetail: async () => detail,
    },
    uiKitSkeletonHTML: () => '',
    uiKitEmptyStateHTML: () => '',
    esc: (value) => String(value),
    fmt: (value) => String(value),
    fmtName: (value) => value,
    showToast: vi.fn(),
  });

  return { controller, root };
}

describe('RuntimeIntelController battle round integrity', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function renderDetail(rounds) {
    const { controller, root } = loadController({
      success: true,
      battle_report: { report: { rounds } },
    });
    await controller.render();
    root.querySelector('[data-battle-detail="7"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return document.querySelector('#intel-battle-detail-body');
  }

  it('omits missing and invalid integrity values instead of displaying them as zero', async () => {
    const body = await renderDetail([
      { round: 1, attacker_integrity_remaining: null, defender_integrity_remaining: 'invalid' },
      { round: 2, attacker_integrity_remaining: 12 },
    ]);

    expect(body.textContent).toContain('aggregate relative index');
    expect(body.querySelectorAll('.entity-bar-row')).toHaveLength(1);
    expect(body.querySelector('.entity-bar-label').textContent).toBe('A-Int');
    expect(body.querySelector('.entity-bar-value').textContent).toBe('12');
  });

  it('normalizes valid integrity values to the highest reported value per side', async () => {
    const body = await renderDetail([
      { round: 1, attacker_integrity_remaining: 20, defender_integrity_remaining: 30 },
      { round: 2, attacker_integrity_remaining: 10, defender_integrity_remaining: 0 },
    ]);

    const bars = body.querySelectorAll('.bar-fill');
    expect(bars[0].style.width).toBe('100%');
    expect(bars[1].style.width).toBe('100%');
    expect(bars[2].style.width).toBe('50%');
    expect(bars[3].style.width).toBe('0%');
  });
});
