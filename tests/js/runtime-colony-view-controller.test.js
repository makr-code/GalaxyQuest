import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeColonyViewController.js');

function renderColonyView(activeEvent, overrides = {}) {
  delete window.GQRuntimeColonyViewController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));

  const { createColonyViewController } = window.GQRuntimeColonyViewController;
  const controller = createColonyViewController({
    getCurrentColony: () => ({
      id: 1,
      name: 'Test Colony',
      planet_class: 'terrestrial',
      active_event: activeEvent,
      ...(overrides.colony || {}),
    }),
    buildColonyGridCells: overrides.buildColonyGridCells || (() => ({ cols: 1, cells: [] })),
    buildingZoneLabel: overrides.buildingZoneLabel,
    pickZoneBuildFocus: overrides.pickZoneBuildFocus,
    fmtName: overrides.fmtName || String,
    esc: String,
  });
  return controller.buildViewHtml({
    layout: overrides.layout || {},
    buildings: overrides.buildings || [],
    orbital_facilities: overrides.orbitalFacilities || [],
  });
}

describe('RuntimeColonyViewController event progress', () => {
  it('does not present a missing remaining time as a completed event', () => {
    const html = renderColonyView({
      type: 'solar_flare',
      started_at: '2025-12-31 23:00:00',
      expires_at: '2026-01-01 01:00:00',
    });

    expect(html).toContain('ends in time unavailable');
    expect(html).not.toContain('Event elapsed');
    expect(html).not.toContain('100%');
  });

  it('calculates elapsed progress from event timestamps and valid remaining time', () => {
    const html = renderColonyView({
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
    const html = renderColonyView({
      type: 'solar_flare',
      started_at: 'invalid',
      expires_at: 'invalid',
      ends_in_min: -1,
    });

    expect(html).toContain('ends in time unavailable');
    expect(html).not.toContain('Event elapsed');
  });

  it('escapes dynamic payloads and constrains values used in classes, attributes, and styles', () => {
    const html = renderColonyView(
      { type: '<img src=x onerror=alert(1)>' },
      {
        colony: { name: '<img src=x onerror=alert(2)>' },
        layout: { grid: { cols: '1);color:red' } },
        buildColonyGridCells: () => ({
          cols: '1);color:red',
          cells: [{ zone: 'flex" onclick="alert(3)', building: null }],
        }),
        buildingZoneLabel: () => '<img src=x onerror=alert(4)>',
        pickZoneBuildFocus: () => 'bad" onclick="alert(5)',
        fmtName: String,
      },
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onclick=');
    expect(html).toContain('colony-zone-flex');
    expect(html).toContain('repeat(1, minmax(0, 1fr))');
    expect(html).toContain('data-focus-building="colony_hq"');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).not.toContain('color:red');
  });
});
