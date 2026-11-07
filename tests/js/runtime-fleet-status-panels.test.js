import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeFleetStatusPanels.js');

function loadHelper() {
  delete window.GQRuntimeFleetStatusPanels;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeFleetStatusPanels.createFleetStatusPanelsHelper();
}

describe('RuntimeFleetStatusPanels gate health', () => {
  let helper;
  let root;

  beforeEach(() => {
    helper = loadHelper();
    root = document.createElement('div');
    root.innerHTML = '<div id="fleet-ftl-status"></div>';
  });

  it('omits health bars and counts only gates when health is a valid measurement', () => {
    helper.applyFtlStatus(root, {
      success: true,
      ftl_drive_type: 'syl_nar',
      ftl_ready: true,
      gates: [
        { galaxy_a: 1, system_a: 3, galaxy_b: 1, system_b: 8, is_active: 1, health: null },
        { galaxy_a: 1, system_a: 5, galaxy_b: 1, system_b: 9, is_active: 1, health: 35 },
      ],
    });

    expect(root.querySelector('#fleet-ftl-status').textContent).toContain('1 gate(s) active');
    expect(root.querySelectorAll('.entity-bar-row')).toHaveLength(1);
    expect(root.querySelector('.entity-bar-value').textContent).toBe('35%');
  });

  it('does not clamp malformed gate health into a status bar', () => {
    helper.applyFtlStatus(root, {
      success: true,
      ftl_drive_type: 'syl_nar',
      ftl_ready: true,
      gates: [
        { galaxy_a: 1, system_a: 3, galaxy_b: 1, system_b: 8, is_active: 1 },
        { galaxy_a: 1, system_a: 5, galaxy_b: 1, system_b: 9, is_active: 1, health: 130 },
        { galaxy_a: 1, system_a: 7, galaxy_b: 1, system_b: 9, is_active: 1, health: 0 },
      ],
    });

    expect(root.querySelector('#fleet-ftl-status').textContent).toContain('0 gate(s) active');
    expect(root.querySelectorAll('.entity-bar-row')).toHaveLength(1);
    expect(root.querySelector('.entity-bar-value').textContent).toBe('0%');
  });
});
