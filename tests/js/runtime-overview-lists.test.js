import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeOverviewLists.js');

function renderFleet(fleet) {
  delete window.GQRuntimeOverviewLists;
  window.eval(fs.readFileSync(modulePath, 'utf8'));

  const root = document.createElement('div');
  root.innerHTML = '<div id="fleet-list-wm"></div>';
  let rows = [];
  const controller = window.GQRuntimeOverviewLists.createOverviewLists({
    windowRef: { _GQ_fleets: [fleet] },
    esc: String,
    fmtName: String,
    countdown: () => '',
    api: {},
  });
  controller.renderFleetList({
    root,
    renderTemplateList: (_template, renderedRows) => {
      rows = renderedRows;
      return '';
    },
  });
  return rows[0];
}

describe('RuntimeOverviewLists fleet transit progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
  });

  it('omits transit progress when the timestamps are invalid', () => {
    const row = renderFleet({
      id: 1,
      departure_time: 'not-a-date',
      arrival_time: 'also-not-a-date',
    });

    expect(row.progressHtml).toBe('');
    expect(row.progressPct).toBe('');
  });

  it('renders progress for a valid transit interval', () => {
    const row = renderFleet({
      id: 2,
      departure_time: '2026-01-01T00:00:00Z',
      arrival_time: '2026-01-01T00:10:00Z',
    });

    expect(row.progressHtml).toContain('Fleet transit progress 50%');
    expect(row.progressPct).toBe('50');
  });

  it('escapes fleet values internally and omits mutation controls for invalid IDs', () => {
    delete window.GQRuntimeOverviewLists;
    window.eval(fs.readFileSync(modulePath, 'utf8'));
    const root = document.createElement('div');
    root.innerHTML = '<div id="fleet-list-wm"></div>';
    const fleet = {
      id: '3" onclick="alert(1)',
      fleet_label: '<img src=x onerror=alert(2)>',
      mission: '<svg onload=alert(3)>',
      target_system_name: '<iframe src=javascript:alert(4)>',
      current_pos: { x: 1, y: 2, z: 3 },
      vessels: [{ type: '<b onclick=alert(5)>', count: 2 }],
    };
    const controller = window.GQRuntimeOverviewLists.createOverviewLists({
      windowRef: { _GQ_fleets: [fleet], document },
      esc: String,
      fmtName: () => '<i onclick=alert(6)>',
      countdown: () => '<u onmouseover=alert(7)>',
      api: {},
    });

    controller.renderFleetList({
      root,
      renderTemplateList: (_template, rows) => rows.map((row) => `
        <div class="fleet-row" data-fleet-id="${row.fleetId}">
          ${row.fleetLabelHtml}${row.mission}${row.targetSystemName}
          ${row.positionHtml}${row.vesselListHtml}${row.arrivalCountdown}${row.recallButtonHtml}
        </div>`).join(''),
    });

    expect(root.querySelector('img, svg, iframe, b, i, u')).toBeNull();
    expect(root.querySelector('[onclick], [onerror], [onload], [onmouseover]')).toBeNull();
    expect(root.querySelector('.fleet-label-edit-btn, .recall-btn')).toBeNull();
    expect(root.querySelector('.fleet-pos')?.textContent).toContain('1, 2, 3');
  });

  it('escapes battle API values and number formatter output', () => {
    delete window.GQRuntimeOverviewLists;
    window.eval(fs.readFileSync(modulePath, 'utf8'));
    const root = document.createElement('div');
    root.innerHTML = '<div id="battle-log-wm"></div>';
    const controller = window.GQRuntimeOverviewLists.createOverviewLists({
      windowRef: {
        _GQ_battles: [{
          defender_name: '<img src=x onerror=alert(1)>',
          created_at: '2026-01-01T00:00:00Z',
          report: { attacker_wins: true, loot: { metal: 10 } },
        }],
        document,
      },
      fmt: () => '<svg onload=alert(2)>',
    });

    controller.renderBattleLog({
      root,
      renderTemplateList: (_template, rows) => rows.map((row) => `
        <div class="battle-row ${row.battleClass}">
          ${row.resultLabel}${row.defenderName}${row.createdAt}${row.lootHtml}
        </div>`).join(''),
    });

    expect(root.querySelector('img, svg')).toBeNull();
    expect(root.querySelector('[onerror], [onload]')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('<svg onload=alert(2)>');
  });

  it('rejects tampered fleet IDs before recall and rename requests', async () => {
    delete window.GQRuntimeOverviewLists;
    window.eval(fs.readFileSync(modulePath, 'utf8'));
    const api = { recallFleet: vi.fn(), renameFleet: vi.fn() };
    const root = document.createElement('div');
    root.innerHTML = '<div id="fleet-list-wm"></div>';
    const controller = window.GQRuntimeOverviewLists.createOverviewLists({
      windowRef: { _GQ_fleets: [{ id: 8, fleet_label: 'Scout' }], document },
      api,
    });

    controller.renderFleetList({
      root,
      renderTemplateList: (_template, rows) => rows.map((row) => `
        <div class="fleet-row">${row.fleetLabelHtml}${row.recallButtonHtml}</div>`).join(''),
    });
    root.querySelector('.recall-btn').dataset.fid = '8junk';
    root.querySelector('.fleet-label-edit-btn').dataset.fid = '8.5';
    root.querySelector('.recall-btn').click();
    root.querySelector('.fleet-label-edit-btn').click();

    expect(api.recallFleet).not.toHaveBeenCalled();
    expect(api.renameFleet).not.toHaveBeenCalled();
    expect(root.querySelector('.fleet-label-input')).toBeNull();
  });
});
