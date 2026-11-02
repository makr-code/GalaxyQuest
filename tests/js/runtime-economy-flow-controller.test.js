import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

let createController;
beforeEach(() => {
  window.eval(fs.readFileSync('js/engine/runtime/RuntimeEconomyFlowController.js', 'utf8'));
  createController = window.GQRuntimeEconomyFlowController.createEconomyFlowController;
});

describe('Authoritative economy flows', () => {
  it('uses the server food rates, including a real zero', () => {
    const controller = createController({
      getColonies: () => [
        { id: 1, population: 1000, food: 200, food_per_hour: 0, food_consumption_per_hour: 10 },
        { id: 2, population: 100, food: 50, food_per_hour: 13, food_consumption_per_hour: 1 },
      ],
    });
    const flow = controller.calculateColonyFlows('food');
    expect(flow.totalProduction).toBe(13);
    expect(flow.totalConsumption).toBe(11);
    expect(flow.empireBalance).toBe(2);
    expect(flow.colonies.find((c) => c.colonyId === 1).deficit).toBe(10);
  });

  it('does not invent recurring metal consumption or use obsolete production fields', () => {
    const controller = createController({
      getColonies: () => [{ id: 1, metal_per_hour: '33', metal_production: 999, metal: 500 }],
    });
    const flow = controller.calculateColonyFlows('metal');
    expect(flow.totalProduction).toBe(33);
    expect(flow.totalConsumption).toBe(0);
    expect(flow.colonies[0].storageCurrentLevel).toBe(500);
  });

  it('rejects missing and malformed snapshot rates rather than fabricating a flow', () => {
    const controller = createController();
    for (const value of [undefined, null, '', ' ', false, true, [], {}, 'not-a-number', Infinity, -1]) {
      expect(() => controller.estimateColonyProduction({ id: 1, food_per_hour: value }, 'food')).toThrow();
    }
    expect(() => controller.estimateColonyConsumption({ id: 1, population: 100 }, 'food')).toThrow();
  });

  it('reports an unavailable snapshot visibly and logs the error', async () => {
    const root = document.createElement('div');
    const log = vi.fn();
    const controller = createController({
      wm: { body: () => root }, getColonies: () => [{ id: 1 }], gameLog: log,
    });
    await controller.render();
    expect(root.textContent).toContain('Failed to render');
    expect(log).toHaveBeenCalledOnce();
  });
});
