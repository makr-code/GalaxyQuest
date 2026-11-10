import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeLeaderboardController.js');

function loadModule() {
  delete window.GQRuntimeLeaderboardController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeLeaderboardController;
}

describe('RuntimeLeaderboardController DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes leaderboard fields and formatter output even when callbacks return markup', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const controller = loadModule().createLeaderboardController({
      wm: { body: () => root },
      api: {
        leaderboard: async () => ({
          success: true,
          leaderboard: [{
            username: '<img src=x onerror=alert(1)>',
            alliance_tag: '<svg onload=alert(2)>',
            rank_points: 10,
            planet_count: '<b onclick=alert(3)>',
            dark_matter: 20,
          }],
        }),
      },
      fmt: (value) => `<i>${value}</i>`,
      getCurrentUser: () => ({ username: 'other' }),
    });

    await controller.render();

    expect(root.querySelector('img, svg, b, i')).toBeNull();
    expect(root.querySelector('[onerror], [onload], [onclick]')).toBeNull();
    expect(root.querySelector('.lb-name')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('.lb-alliance-tag')?.textContent).toContain('<svg onload=alert(2)>');
    expect(root.querySelectorAll('.lb-stat')[0]?.textContent).toBe('RP <i>10</i>');
    expect(root.querySelectorAll('.lb-stat')[1]?.textContent).toBe('PLANETS <b onclick=alert(3)>');
  });
});
