import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeWormholeController.js');

function loadModule() {
  delete window.GQRuntimeWormholeController;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeWormholeController;
}

describe('RuntimeWormholeController DOM output', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('escapes route labels, cooldowns, and formatter output regardless of callbacks', () => {
    const { createWormholeController } = loadModule();
    const controller = createWormholeController({
      getCurrentColony: () => ({ galaxy: 1, system: 2 }),
      esc: String,
      fmt: () => '<img src=x onerror=alert(1)>',
    });
    const html = controller.buildCardsHtml({
      wormholes: [{
        id: 8,
        label: '<svg onload=alert(2)>',
        stability: 80,
        available: true,
        a: { galaxy: 1, system: 2 },
        b: { galaxy: 3, system: 4 },
        cooldown_until: '<img src=x onerror=alert(3)>',
      }],
    });
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('img, svg')).toBeNull();
    expect(root.querySelector('[onerror], [onload]')).toBeNull();
    expect(root.textContent).toContain('<svg onload=alert(2)>');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('.wormhole-use-btn')?.dataset.targetG).toBe('3');
    expect(root.querySelector('.wormhole-use-btn')?.dataset.targetS).toBe('4');
  });

  it('constrains malformed target coordinates before writing action attributes', () => {
    const { createWormholeController } = loadModule();
    const controller = createWormholeController({
      getCurrentColony: () => ({ galaxy: 1, system: 2 }),
    });
    const html = controller.buildCardsHtml({
      wormholes: [{
        id: 9,
        label: 'Route',
        available: true,
        a: { galaxy: 1, system: 2 },
        b: { galaxy: '3" onclick="alert(1)', system: -4 },
      }],
    });
    const root = document.createElement('div');
    root.innerHTML = html;
    const button = root.querySelector('.wormhole-use-btn');

    expect(root.querySelector('[onclick]')).toBeNull();
    expect(button.dataset.targetG).toBe('1');
    expect(button.dataset.targetS).toBe('1');
  });

  it('preserves empty states and binds valid jump targets', async () => {
    const { createWormholeController } = loadModule();
    const openFleetWithWormholeTarget = vi.fn(async () => {});
    const controller = createWormholeController({
      getCurrentColony: () => ({ galaxy: 1, system: 2 }),
      uiKitEmptyStateHTML: () => '<p class="empty-state">No routes</p>',
    });
    expect(controller.buildCardsHtml({ wormholes: [] })).toContain('empty-state');

    const root = document.createElement('div');
    root.innerHTML = controller.buildCardsHtml({
      wormholes: [{
        id: 10,
        label: 'Route',
        available: true,
        a: { galaxy: 1, system: 2 },
        b: { galaxy: 3, system: 4 },
      }],
    });
    controller.openFleetWithWormholeTarget = openFleetWithWormholeTarget;
    controller.bindActions(root);
    root.querySelector('.wormhole-use-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openFleetWithWormholeTarget).toHaveBeenCalledWith({ galaxy: 3, system: 4 });
  });

  it('rejects tampered target coordinates before fleet navigation', async () => {
    const { createWormholeController } = loadModule();
    const openFleetWithWormholeTarget = vi.fn(async () => {});
    const controller = createWormholeController({
      getCurrentColony: () => ({ galaxy: 1, system: 2 }),
    });
    const root = document.createElement('div');
    root.innerHTML = controller.buildCardsHtml({
      wormholes: [{
        id: 11,
        label: 'Route',
        available: true,
        a: { galaxy: 1, system: 2 },
        b: { galaxy: 3, system: 4 },
      }],
    });
    controller.openFleetWithWormholeTarget = openFleetWithWormholeTarget;
    controller.bindActions(root);
    const button = root.querySelector('.wormhole-use-btn');
    button.dataset.targetG = '3junk';
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openFleetWithWormholeTarget).not.toHaveBeenCalled();
  });

  it('rejects invalid fleet targets when called directly', async () => {
    const { createWormholeController } = loadModule();
    const open = vi.fn();
    const controller = createWormholeController({
      wm: { open },
      waitMs: async () => {},
    });

    await controller.openFleetWithWormholeTarget({ galaxy: 2.5, system: 3 });
    await controller.openFleetWithWormholeTarget({ galaxy: 2, system: '4x' });

    expect(open).not.toHaveBeenCalled();
  });
});
