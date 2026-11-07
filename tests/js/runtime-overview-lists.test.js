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
});
