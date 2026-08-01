/**
 * Market Domain Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketController, MarketCalculations } from '../js/engine/runtime/domains/market/MarketController.js';

describe('MarketController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn() };
    controller = new MarketController({ eventBus: mockEventBus, repository: null });
  });

  describe('updatePrices', () => {
    it('should update commodity prices', () => {
      const before = controller.getCommodity('minerals').currentPrice;
      controller.updatePrices();
      const after = controller.getCommodity('minerals').currentPrice;

      expect(after).toBeGreaterThan(0);
    });

    it('should emit prices-updated event', () => {
      controller.updatePrices();

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'market:prices-updated',
        expect.any(Object)
      );
    });
  });

  describe('executeTrade', () => {
    it('should execute trade', () => {
      const before = controller.getRecentTrades().length;
      
      controller.executeTrade('player_faction', 'npc_1', 'minerals', 100);

      const after = controller.getRecentTrades().length;
      expect(after).toBe(before + 1);
    });

    it('should update inventory', () => {
      const buyerBefore = controller.getInventory('player_faction').minerals || 0;
      
      controller.executeTrade('player_faction', 'npc_1', 'minerals', 100);

      const buyerAfter = controller.getInventory('player_faction').minerals;
      expect(buyerAfter).toBeGreaterThan(buyerBefore);
    });

    it('should throw error if insufficient inventory', () => {
      expect(() => {
        controller.executeTrade('player_faction', 'npc_1', 'minerals', 100000);
      }).toThrow('insufficient');
    });

    it('should emit trade-executed event', () => {
      controller.executeTrade('player_faction', 'npc_1', 'energy', 50);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'market:trade-executed',
        expect.any(Object)
      );
    });
  });

  describe('getPriceHistory', () => {
    it('should return price history', () => {
      controller.updatePrices();
      controller.updatePrices();

      const history = controller.getPriceHistory('minerals', 10);
      expect(history.length).toBeGreaterThan(0);
    });
  });
});

describe('MarketCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new MarketCalculations();
  });

  describe('calculateProfitMargin', () => {
    it('should calculate profit', () => {
      const result = calc.calculateProfitMargin(100, 120, 10);
      expect(result.profit).toBe(200);
      expect(result.margin).toBe(20);
    });
  });

  describe('calculateSaturation', () => {
    it('should calculate market saturation', () => {
      const saturation = calc.calculateSaturation(100, 100);
      expect(saturation).toBe(100);
    });
  });
});
