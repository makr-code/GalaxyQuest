import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeColonyViewController.js');

function renderColonyEvent(activeEvent) {
  delete window.GQRuntimeColonyViewController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));

  const { createColonyViewController } = window.GQRuntimeColonyViewController;
  const controller = createColonyViewController({
    getCurrentColony: () => ({
      id: 1,
      name: 'Test Colony',
      planet_class: 'terrestrial',
      active_event: activeEvent,
    }),
    buildColonyGridCells: () => ({ cols: 1, cells: [] }),
    esc: String,
    fmtName: String,
  });
  return controller.buildViewHtml({ layout: {}, buildings: [], orbital_facilities: [] });
}

describe('RuntimeColonyViewController event progress', () => {
  it('does not present a missing remaining time as a completed event', () => {
    const html = renderColonyEvent({
      type: 'solar_flare',
      started_at: '2025-12-31 23:00:00',
      expires_at: '2026-01-01 01:00:00',
    });

    expect(html).toContain('ends in time unavailable');
    expect(html).not.toContain('Event elapsed');
    expect(html).not.toContain('100%');
  });

  it('calculates elapsed progress from event timestamps and valid remaining time', () => {
    const html = renderColonyEvent({
      type: 'solar_flare',
      started_at: '2025-12-31 23:00:00',
      expires_at: '2026-01-01 01:00:00',
      ends_in_min: 60,
    });

    expect(html).toContain('ends in 1h 0m');
    expect(html).toContain('Event elapsed 50%');
    expect(html).toContain('>50%</span>');
  });

  it('omits elapsed progress when event timestamps or remaining time are invalid', () => {
    const html = renderColonyEvent({
      type: 'solar_flare',
      started_at: 'invalid',
      expires_at: 'invalid',
      ends_in_min: -1,
    });

    expect(html).toContain('ends in time unavailable');
    expect(html).not.toContain('Event elapsed');
  });
});
