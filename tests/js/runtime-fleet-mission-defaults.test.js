import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeFleetMissionDefaults.js');

function loadHelper() {
  delete window.GQRuntimeFleetMissionDefaults;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeFleetMissionDefaults.createFleetMissionDefaultsHelper({
    getCurrentColony: () => null,
    esc: (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  });
}

describe('RuntimeFleetMissionDefaults scanned target status', () => {
  let helper;
  let root;

  beforeEach(() => {
    helper = loadHelper();
    root = document.createElement('div');
    root.innerHTML = `
      <input type="radio" name="mission" value="survey">
      <div id="fleet-default-hint"></div>`;
  });

  it('shows only status percentages explicitly present in a scan report', () => {
    helper.applyMissionDefaults(root, [], {
      intel: {
        intel: {
          latest_scan_at: '2026-11-07 07:00:00',
          latest_scan: { health_pct: 42, shield_pct: null },
        },
      },
    });

    expect(root.querySelector('#fleet-default-hint').textContent).toContain('Aufklärung: Hülle 42%');
    expect(root.querySelector('#fleet-default-hint').textContent).not.toContain('Schild');
  });

  it('does not invent scan measurements when the report has none or invalid values', () => {
    helper.applyMissionDefaults(root, [], {
      intel: {
        intel: {
          latest_scan_at: '2026-11-07 07:00:00',
          latest_scan: { health_pct: 120, shield_pct: null },
        },
      },
    });

    expect(root.querySelector('#fleet-default-hint').textContent).not.toContain('Aufklärung:');
  });
});
