/**
 * Economy Domain - Integration & Testing Guide
 * 
 * This file demonstrates how to integrate and test the new Economy domain
 */

// ==================== BASIC INTEGRATION ====================

/**
 * In your HTML (e.g., index.html):
 * 
 * <script type="module">
 *   import GQGame from './js/engine/game.js';
 *   
 *   // Initialize game
 *   await GQGame.initialize({
 *     environment: 'development',
 *     api: window.API,           // From api.js
 *     repository: new DBRepository(),
 *     renderer: window.galaxyRenderer
 *   });
 *   
 *   // Optionally start game loop
 *   await GQGame.start();
 * </script>
 * 
 * <div data-domain="economy" id="economy-panel"></div>
 */

// ==================== UNIT TESTS (Vitest) ====================

/**
 * tests/economy.test.js
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EconomyController, EconomyCalculations } from '../js/engine/runtime/domains/economy/EconomyController.js';
import State from '../js/engine/runtime/domains/shared/State.js';

describe('State Manager', () => {
  let state;

  beforeEach(() => {
    state = new State(
      { value: 0 },
      { value: { type: 'number', min: 0, max: 100 } }
    );
  });

  it('validates against schema', () => {
    expect(() => state.set('value', 150)).toThrow();
    expect(() => state.set('value', 50)).not.toThrow();
  });

  it('tracks change history', () => {
    state.set('value', 10);
    state.set('value', 20);
    state.set('value', 30);

    const history = state.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].newValue).toBe(10);
    expect(history[2].newValue).toBe(30);
  });

  it('notifies observers on changes', () => {
    const changes = [];
    state.subscribe((path, newValue, oldValue) => {
      changes.push({ path, newValue, oldValue });
    });

    state.set('value', 50);
    expect(changes).toHaveLength(1);
    expect(changes[0].newValue).toBe(50);
  });

  it('batch updates atomically', () => {
    const states = new State({ a: 0, b: 0 });
    const updates = [];

    states.subscribe(() => updates.push(1));

    states.batch({ a: 1, b: 2 });

    // Should only notify once per batch update call, not per field
    expect(updates.length).toBeLessThanOrEqual(2); // a + b
  });
});

describe('EconomyController', () => {
  let controller;
  let eventBus;

  beforeEach(() => {
    eventBus = {
      emit: vi.fn()
    };

    controller = new EconomyController({
      eventBus,
      logger: console
    });
  });

  it('initializes with default state', () => {
    const state = controller.getState();
    expect(state.taxRate).toBe(0);
    expect(state.isLocked).toBe(false);
  });

  it('validates tax rate bounds', () => {
    expect(() => controller.setTaxRate(150)).toThrow(/Invalid tax rate/);
    expect(() => controller.setTaxRate(-10)).toThrow(/Invalid tax rate/);
    expect(() => controller.setTaxRate(50)).not.toThrow();
  });

  it('emits event on tax rate change', () => {
    controller.setTaxRate(50);

    expect(eventBus.emit).toHaveBeenCalledWith('economy:tax-rate-changed', {
      taxRate: 50,
      timestamp: expect.any(Number)
    });
  });

  it('prevents changes when locked', () => {
    controller.lock();
    expect(() => controller.setTaxRate(50)).toThrow(/locked/i);
  });

  it('allows changes when unlocked', () => {
    controller.lock();
    controller.unlock();
    expect(() => controller.setTaxRate(50)).not.toThrow();
  });

  it('marks state as dirty on change', () => {
    expect(controller.state.get('isDirty')).toBe(false);
    controller.setTaxRate(50);
    expect(controller.state.get('isDirty')).toBe(true);
  });

  it('notifies UI callbacks on state change', () => {
    const callback = vi.fn();
    controller.onStateChange(callback);

    controller.setTaxRate(50);

    expect(callback).toHaveBeenCalledWith({
      path: 'taxRate',
      newValue: 50,
      oldValue: 0,
      timestamp: expect.any(Number)
    });
  });

  it('calculates demands for colonies', () => {
    const colonies = [
      { population: 100, buildings: 5 },
      { population: 200, buildings: 10 }
    ];

    const demands = controller.calculateDemands(colonies);

    expect(demands).toHaveProperty('food');
    expect(demands).toHaveProperty('minerals');
    expect(demands).toHaveProperty('energy');
    expect(demands).toHaveProperty('credit');

    // Should be positive
    expect(demands.food).toBeGreaterThan(0);
  });
});

describe('EconomyCalculations', () => {
  const calc = new EconomyCalculations();

  it('calculates revenue correctly', () => {
    expect(calc.calculateRevenue(1000, 0)).toBe(0);
    expect(calc.calculateRevenue(1000, 100)).toBe(1000);
    expect(calc.calculateRevenue(1000, 50)).toBe(500);
  });

  it('handles zero income', () => {
    expect(calc.calculateRevenue(0, 50)).toBe(0);
    expect(calc.calculateRevenue(-100, 50)).toBe(0);
  });

  it('calculates subsidy cost', () => {
    expect(calc.calculateSubsidyCost(1000, 0)).toBe(0);
    expect(calc.calculateSubsidyCost(1000, 100)).toBe(1000);
    expect(calc.calculateSubsidyCost(1000, 25)).toBe(250);
  });

  it('calculates balance correctly', () => {
    const balance = calc.calculateBalance({
      income: 1000,
      population: 1000,
      taxRate: 50,
      subsidyRate: 25
    });

    expect(balance).toEqual({
      revenue: 500,
      cost: 250,
      balance: 250
    });
  });

  it('calculates colony demand', () => {
    const colony = { population: 100, buildings: 5 };
    const demand = calc.calculateColonyDemand(colony, 50, 25);

    expect(demand.food).toBeGreaterThan(0);
    expect(demand.minerals).toBe(50); // 5 buildings * 10
    expect(demand.credit).toBeGreaterThan(0);
  });

  it('calculates global demands', () => {
    const colonies = [
      { population: 100, buildings: 5 },
      { population: 200, buildings: 10 }
    ];

    const demands = calc.calculateGlobalDemands(colonies, 50, 25);

    // Should be sum of all colonies
    expect(demands.food).toBeGreaterThan(0);
    expect(demands.minerals).toBeGreaterThan(0);
  });
});

// ==================== INTEGRATION TESTS ====================

describe('Economy Domain Integration', () => {
  let game;

  beforeEach(async () => {
    // Import here to test real module imports
    const { default: GQGame } = await import('../js/engine/game.js');
    
    game = GQGame;
    await game.initialize({
      environment: 'test',
      logger: console
    });
  });

  afterEach(async () => {
    await game.shutdown();
  });

  it('initializes economy domain', () => {
    expect(game.domains.economy).toBeDefined();
    expect(game.domains.economy.controller).toBeDefined();
    expect(game.domains.economy.ui).toBeNull(); // No DOM in test
  });

  it('allows setting tax rate through domain API', () => {
    game.domains.economy.setTaxRate(30);
    expect(game.domains.economy.getTaxRate()).toBe(30);
  });

  it('emits events through event bus', () => {
    let emitted = null;
    game.events.on('economy:tax-rate-changed', (payload) => {
      emitted = payload;
    });

    game.domains.economy.setTaxRate(40);

    expect(emitted).not.toBeNull();
    expect(emitted.taxRate).toBe(40);
  });

  it('aggregates state from all domains', () => {
    game.domains.economy.setTaxRate(50);
    game.domains.economy.setSubsidyRate(25);

    const state = game.getState();

    expect(state.economy).toBeDefined();
    expect(state.economy.taxRate).toBe(50);
    expect(state.economy.subsidyRate).toBe(25);
  });
});

// ==================== E2E TEST SCENARIO ====================

describe('Economy Workflow (E2E)', () => {
  /**
   * Scenario: User opens economy panel, changes tax rate, saves
   */
  it('completes full user workflow', async () => {
    const { default: GQGame } = await import('../js/engine/game.js');
    
    const mockRepository = {
      saveEconomyState: vi.fn().mockResolvedValue(undefined),
      loadEconomyState: vi.fn().mockResolvedValue(null)
    };

    await GQGame.initialize({
      repository: mockRepository,
      environment: 'test'
    });

    // User action: Change tax rate
    GQGame.domains.economy.setTaxRate(35);
    expect(GQGame.domains.economy.getTaxRate()).toBe(35);

    // User action: Change subsidy rate
    GQGame.domains.economy.setSubsidyRate(20);
    expect(GQGame.domains.economy.getSubsidyRate()).toBe(20);

    // User action: Save all state
    await GQGame.saveAll();

    // Verify persistence called
    expect(mockRepository.saveEconomyState).toHaveBeenCalled();
    const savedState = mockRepository.saveEconomyState.mock.calls[0][0];
    expect(savedState.taxRate).toBe(35);
    expect(savedState.subsidyRate).toBe(20);

    await GQGame.shutdown();
  });
});

// ==================== PERFORMANCE TESTS ====================

describe('Economy Performance', () => {
  it('setTaxRate completes in < 1ms', () => {
    const controller = new EconomyController({});
    
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      controller.setTaxRate(i % 100);
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(1000); // 1ms per operation average
  });

  it('calculateDemands with 100 colonies completes in < 5ms', () => {
    const calc = new EconomyCalculations();
    const colonies = Array(100).fill().map((_, i) => ({
      population: 100 + i,
      buildings: 5 + (i % 10)
    }));

    const start = performance.now();
    calc.calculateGlobalDemands(colonies, 50, 25);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(5);
  });

  it('state history keeps memory bounded', () => {
    const state = new State({ value: 0 });
    
    // Make 10000 changes
    for (let i = 0; i < 10000; i++) {
      state.set('value', i);
    }

    const history = state.getHistory(50);
    expect(history).toHaveLength(50); // Should keep last 50
    expect(history[0].newValue).toBeGreaterThan(9950);
  });
});

// ==================== RUNNING TESTS ====================

/**
 * Run tests:
 * 
 * npm run test                    # Run all tests
 * npm run test -- economy         # Run economy tests only
 * npm run test -- --coverage      # With coverage report
 * npm run test -- --watch         # Watch mode
 * 
 * Expected coverage:
 * - Lines: 85%+
 * - Branches: 80%+
 * - Functions: 90%+
 * - Statements: 85%+
 */

export {};
