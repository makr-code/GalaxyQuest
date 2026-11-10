import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeLeadersController.js');

function loadModule() {
  delete window.GQRuntimeLeadersController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeLeadersController;
}

describe('RuntimeLeadersController DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes marketplace text and limits rarity, role, skill, and candidate ID fields', () => {
    const controller = loadModule().createLeadersController({
      wm: { body: () => document.createElement('div') },
      api: {},
      documentRef: document,
      esc: String,
    });
    const html = controller.renderCard({
      id: '7"><img src=x onerror=alert(1)>',
      rarity: 'rare" onclick="alert(2)',
      role: 'colony_manager',
      name: '<img src=x onerror=alert(3)>',
      portrait: '<svg onload=alert(4)>',
      tagline: '<iframe src=javascript:alert(5)>',
      trait_1: '<b onclick=alert(6)>Trait</b>',
      backstory: '<img src=x onerror=alert(7)>',
      skill_production: 999,
      skill_construction: -20,
      hire_metal: 1000,
      hire_crystal: 0,
      hire_deuterium: 0,
      is_hired: 0,
    });
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('img, svg, iframe, b')).toBeNull();
    expect(root.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(root.querySelector('.leader-card')?.classList.contains('rarity-common')).toBe(true);
    expect(root.querySelector('.leader-card-role')?.textContent).toBe('Colony Manager');
    expect(root.querySelector('.hire-candidate-btn')).toBeNull();
    expect(Array.from(root.querySelectorAll('.skill-bar-fill'))
      .map((fill) => fill.getAttribute('style'))).toEqual(['width:100%', 'width:0%']);
  });

  it('escapes assigned leader fields and only emits positive safe leader IDs', () => {
    const controller = loadModule().createLeadersController({
      wm: { body: () => document.createElement('div') },
      api: {},
      documentRef: document,
      esc: String,
      getColonies: () => [{ id: '4"><img src=x onerror=alert(1)>', name: '<svg onload=alert(2)>' }],
    });
    const html = controller.renderMyLeaders([{
      id: '1"><img src=x onerror=alert(3)>',
      role: '__proto__',
      rarity: 'legendary" onclick="alert(4)',
      name: '<img src=x onerror=alert(5)>',
      portrait: '<svg onload=alert(6)>',
      level: '<b onclick=alert(7)>4</b>',
      autonomy: 1,
      last_action: '<img src=x onerror=alert(8)>',
      colony_name: '',
      fleet_id: '0',
    }]);
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('img, svg, b')).toBeNull();
    expect(root.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(root.querySelector('.dismiss-btn')).toBeNull();
    expect(root.querySelector('.assign-col-btn')).toBeNull();
    expect(root.querySelector('.leader-card')).toBeNull();
    expect(root.textContent).toContain('__proto__');
  });

  it('rejects invalid IDs and autonomy values before dispatching mutations', async () => {
    const api = {
      hireCandidate: vi.fn(),
      setAutonomy: vi.fn(),
      dismissLeader: vi.fn(),
      assignLeader: vi.fn(),
    };
    const controller = loadModule().createLeadersController({
      wm: { body: () => document.createElement('div') },
      api,
      documentRef: document,
      showToast: vi.fn(),
    });
    const root = document.createElement('div');
    root.innerHTML = `
      <button class="hire-candidate-btn" data-cid="4junk">Hire</button>
      <select class="autonomy-sel" data-lid="2" value="8"><option value="8" selected>invalid</option></select>
      <button class="dismiss-btn" data-lid="3junk">Dismiss</button>
      <button class="assign-col-btn" data-lid="5">Assign</button>
      <select class="assign-col-sel" data-lid="5"><option value="0" selected>bad</option></select>
    `;

    controller.bindHireCandidateButtons(root);
    controller.bindAutonomyControls(root);
    controller.bindDismissControls(root);
    controller.bindAssignmentControls(root);
    root.querySelector('.hire-candidate-btn').click();
    root.querySelector('.autonomy-sel').dispatchEvent(new Event('change'));
    root.querySelector('.dismiss-btn').click();
    root.querySelector('.assign-col-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.hireCandidate).not.toHaveBeenCalled();
    expect(api.setAutonomy).not.toHaveBeenCalled();
    expect(api.dismissLeader).not.toHaveBeenCalled();
    expect(api.assignLeader).not.toHaveBeenCalled();
  });
});
