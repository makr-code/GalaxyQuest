/**
 * MarketController - Manages galaxy-wide trade and commerce
 * Responsible for: commodity prices, trading, market conditions, supply/demand
 * Uses: EventBus for communication, State.js for management
 */

import State from '../shared/State.js';

export class MarketController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;

    this.state = new State({
      commodities: {}, // { name: { name, basePrice, currentPrice, supply, demand, volatility } }
      trades: {}, // { tradeId: { buyer, seller, commodity, quantity, price, status } }
      factionInventory: {}, // { factionId: { commodity: quantity } }
      priceHistory: {}, // { commodity: [{ price, timestamp }, ...] }
      marketTrends: {}, // { commodity: { trend: 'up'|'down'|'stable', momentum: -1 to 1 } }
      totalTrades: 0,
      totalVolume: 0,
      averagePrice: 0,
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      totalTrades: { type: 'number', min: 0 },
      totalVolume: { type: 'number', min: 0 },
      isLocked: { type: 'boolean' },
    });

    this.calculations = new MarketCalculations();
    this._initializeCommodities();
    this.onStateChange = null;
    this.onError = null;
  }

  /**
   * Initialize default commodities
   */
  _initializeCommodities() {
    const commodities = {
      'minerals': {
        name: 'Minerals',
        basePrice: 100,
        currentPrice: 100,
        supply: 10000,
        demand: 8000,
        volatility: 0.15,
      },
      'energy': {
        name: 'Energy',
        basePrice: 80,
        currentPrice: 80,
        supply: 8000,
        demand: 9000,
        volatility: 0.20,
      },
      'food': {
        name: 'Food',
        basePrice: 60,
        currentPrice: 62,
        supply: 5000,
        demand: 6000,
        volatility: 0.10,
      },
      'technology': {
        name: 'Technology',
        basePrice: 500,
        currentPrice: 480,
        supply: 1000,
        demand: 1500,
        volatility: 0.25,
      },
      'luxury': {
        name: 'Luxury Goods',
        basePrice: 200,
        currentPrice: 210,
        supply: 2000,
        demand: 2500,
        volatility: 0.30,
      },
    };

    this.state.set('commodities', commodities);

    // Initialize inventory for test factions
    const factionInventory = {
      'player_faction': { minerals: 1000, energy: 500, food: 300, technology: 50, luxury: 100 },
      'npc_1': { minerals: 800, energy: 600, food: 400, technology: 30, luxury: 200 },
      'npc_2': { minerals: 1200, energy: 400, food: 500, technology: 80, luxury: 150 },
    };

    this.state.set('factionInventory', factionInventory);

    // Initialize price history
    const priceHistory = {};
    Object.keys(commodities).forEach(name => {
      priceHistory[name] = [
        { price: commodities[name].basePrice, timestamp: Date.now() }
      ];
    });
    this.state.set('priceHistory', priceHistory);

    // Initialize market trends
    const marketTrends = {};
    Object.keys(commodities).forEach(name => {
      marketTrends[name] = { trend: 'stable', momentum: 0 };
    });
    this.state.set('marketTrends', marketTrends);
  }

  /**
   * Update commodity prices based on supply/demand
   */
  updatePrices() {
    if (this.state.get('isLocked')) return;

    const commodities = this.state.get('commodities');
    const priceHistory = this.state.get('priceHistory');
    const marketTrends = this.state.get('marketTrends');

    Object.entries(commodities).forEach(([name, commodity]) => {
      const supplyDemandRatio = commodity.supply / commodity.demand;
      
      // Price adjustment based on supply/demand
      let priceChange = 0;
      if (supplyDemandRatio < 0.8) {
        // High demand, low supply → price up
        priceChange = commodity.currentPrice * 0.05;
      } else if (supplyDemandRatio > 1.2) {
        // Low demand, high supply → price down
        priceChange = -commodity.currentPrice * 0.03;
      }

      // Random volatility
      const volatilityFactor = (Math.random() - 0.5) * commodity.volatility * commodity.currentPrice;
      priceChange += volatilityFactor;

      const oldPrice = commodity.currentPrice;
      commodity.currentPrice = Math.max(commodity.basePrice * 0.5, commodity.currentPrice + priceChange);

      // Update trend
      if (commodity.currentPrice > oldPrice * 1.02) {
        marketTrends[name].trend = 'up';
        marketTrends[name].momentum = Math.min(1, marketTrends[name].momentum + 0.1);
      } else if (commodity.currentPrice < oldPrice * 0.98) {
        marketTrends[name].trend = 'down';
        marketTrends[name].momentum = Math.max(-1, marketTrends[name].momentum - 0.1);
      } else {
        marketTrends[name].trend = 'stable';
        marketTrends[name].momentum *= 0.8; // Decay
      }

      // Record price in history
      if (!priceHistory[name]) priceHistory[name] = [];
      priceHistory[name].push({
        price: commodity.currentPrice,
        timestamp: Date.now()
      });

      // Keep history to last 100 records
      if (priceHistory[name].length > 100) {
        priceHistory[name].shift();
      }

      commodities[name] = commodity;
    });

    this.state.set('commodities', commodities);
    this.state.set('priceHistory', priceHistory);
    this.state.set('marketTrends', marketTrends);
    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('market:prices-updated', {
        commodities: Object.fromEntries(
          Object.entries(commodities).map(([k, v]) => [k, v.currentPrice])
        ),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Execute trade between factions
   */
  executeTrade(buyerFactionId, sellerFactionId, commodityName, quantity) {
    if (this.state.get('isLocked')) {
      throw new Error('Market system is locked');
    }

    const commodities = this.state.get('commodities');
    const commodity = commodities[commodityName];

    if (!commodity) {
      throw new Error(`Commodity ${commodityName} not found`);
    }

    const price = commodity.currentPrice;
    const totalCost = price * quantity;

    // Check seller inventory
    const factionInventory = this.state.get('factionInventory');
    const sellerInventory = factionInventory[sellerFactionId];

    if (!sellerInventory || (sellerInventory[commodityName] || 0) < quantity) {
      throw new Error('Seller has insufficient inventory');
    }

    // Execute trade
    const tradeId = `trade_${buyerFactionId}_${sellerFactionId}_${Date.now()}`;
    const trades = this.state.get('trades');

    trades[tradeId] = {
      id: tradeId,
      buyer: buyerFactionId,
      seller: sellerFactionId,
      commodity: commodityName,
      quantity,
      price,
      totalCost,
      status: 'completed',
      timestamp: Date.now(),
    };

    this.state.set('trades', trades);

    // Update inventory
    sellerInventory[commodityName] = (sellerInventory[commodityName] || 0) - quantity;
    if (!factionInventory[buyerFactionId]) {
      factionInventory[buyerFactionId] = {};
    }
    factionInventory[buyerFactionId][commodityName] = (factionInventory[buyerFactionId][commodityName] || 0) + quantity;
    this.state.set('factionInventory', factionInventory);

    // Update market statistics
    this.state.set('totalTrades', this.state.get('totalTrades') + 1);
    this.state.set('totalVolume', this.state.get('totalVolume') + quantity);

    this.state.set('lastModified', Date.now());
    this.state.set('isDirty', true);

    if (this.eventBus) {
      this.eventBus.emit('market:trade-executed', {
        tradeId,
        buyer: buyerFactionId,
        seller: sellerFactionId,
        commodity: commodityName,
        quantity,
        price,
        totalCost,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) this.onStateChange({ type: 'trade-executed' });
  }

  /**
   * Get commodity details
   */
  getCommodity(commodityName) {
    return this.state.get('commodities')?.[commodityName] || null;
  }

  /**
   * Get all commodities
   */
  getAllCommodities() {
    return Object.values(this.state.get('commodities') || {});
  }

  /**
   * Get faction inventory
   */
  getInventory(factionId) {
    return this.state.get('factionInventory')?.[factionId] || {};
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit = 10) {
    const trades = this.state.get('trades') || {};
    return Object.values(trades).slice(-limit).reverse();
  }

  /**
   * Get price history
   */
  getPriceHistory(commodityName, limit = 50) {
    const history = this.state.get('priceHistory')?.[commodityName] || [];
    return history.slice(-limit);
  }

  /**
   * Get market trend
   */
  getMarketTrend(commodityName) {
    return this.state.get('marketTrends')?.[commodityName] || null;
  }

  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('market:locked', {});
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('market:unlocked', {});
  }

  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('market-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('market:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('market-state');
      if (data) this.state = new State(data, this.state.schema);
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  getState() {
    return this.state.clone();
  }
}

/**
 * MarketCalculations - Pure math
 */
class MarketCalculations {
  /**
   * Calculate profit margin
   */
  calculateProfitMargin(buyPrice, sellPrice, quantity) {
    const profit = (sellPrice - buyPrice) * quantity;
    const margin = ((sellPrice - buyPrice) / buyPrice) * 100;
    return { profit, margin };
  }

  /**
   * Predict price trend
   */
  predictPriceMovement(currentPrice, demand, supply, volatility) {
    const ratio = demand / supply;
    const baseMovement = (ratio - 1) * 10; // -10 to +10
    const randomNoise = (Math.random() - 0.5) * volatility * currentPrice;
    return baseMovement + (randomNoise / currentPrice) * 100;
  }

  /**
   * Calculate market saturation
   */
  calculateSaturation(demand, supply) {
    return Math.min(100, (demand / supply) * 100);
  }

  /**
   * Calculate optimal buy quantity
   */
  calculateOptimalBuyQuantity(availableCredits, pricePerUnit, maxCapacity) {
    const byCredits = Math.floor(availableCredits / pricePerUnit);
    return Math.min(byCredits, maxCapacity);
  }
}

export { MarketCalculations };
