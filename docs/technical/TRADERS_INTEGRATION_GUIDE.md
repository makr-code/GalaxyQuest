# 🤝 Traders System — Integration Guide

## Quick Start

```bash
# 1. Deploy database migration
docker compose exec -T db mysql -uroot -proot galaxyquest < sql/migrate_traders_system_v1.sql

# 2. Initialize traders
docker compose exec -T web php scripts/initialize_traders_system.php

# 3. Check initial state
curl 'http://localhost/api/traders.php?action=list_traders'
curl 'http://localhost/api/traders.php?action=list_opportunities&min_margin=10'
```

---

## Architecture Overview

### Data Flow: Supply/Demand → Prices → Trading Opportunities

```
┌─────────────────────────────────┐
│ 1. SUPPLY/DEMAND CALCULATION    │
│ (Colony production/consumption) │
└────────────┬────────────────────┘
             ↓
    ┌─────────────────────────────┐
    │ market_supply_demand table  │ ← Updated hourly
    └────────────┬────────────────┘
                 ↓
    ┌────────────────────────────────────────────┐
    │ 2. OPPORTUNITY DETECTION                   │
    │ (Find arbitrage: buyer_price - seller_price)│
    └────────────┬─────────────────────────────────┘
                 ↓
    ┌─────────────────────────────┐
    │ trade_opportunities table   │ ← Ranked by margin
    └────────────┬────────────────┘
                 ↓
    ┌────────────────────────────────────────────┐
    │ 3. TRADER DECISION MAKING                  │
    │ (Allocate capital, launch fleets)          │
    └────────────┬─────────────────────────────────┘
                 ↓
    ┌─────────────────────────────┐
    │ trader_routes table         │ ← Active trading
    └────────────┬────────────────┘
                 ↓
    ┌────────────────────────────────────────────┐
    │ 4. MARKET IMPACT                           │
    │ (Trades adjust prices → new opportunities) │
    └─────────────────────────────────────────────┘
```

---

## Core Components

### 1. **Supply/Demand Calculator** — `api/market_analysis.php`

```php
// Calculates what each system produces/consumes
calculate_system_supply_demand($db, $galaxy, $system)
  → Returns: ['metal' => ['production' => 1000, 'consumption' => 500, ...], ...]

// Aggregates into persistent table (updated hourly)
update_supply_demand_table($db)
  → Updates: market_supply_demand

// Example result:
[
  'metal' => [
    'production'      => 2000 units/h,
    'consumption'     => 1500 units/h,
    'available_supply' => 8000 units (in storage),
    'desired_demand'  => 3000 units (unfulfilled),
    'net_balance'     => 5000 units (surplus),
  ]
]
```

**Key Insight:** Net balance > 0 = seller system, < 0 = buyer system

### 2. **Opportunity Finder** — `api/market_analysis.php`

```php
find_and_rank_trade_opportunities($db, $min_margin_pct = 15.0)
  
Algorithm:
  1. For each resource type across all systems:
  2. Find (seller_system, buyer_system) pairs
  3. Check: seller has surplus AND buyer has deficit
  4. Calculate profit = (buyer_price - seller_price - transport) / seller_price
  5. Only keep if profit > min_margin
  6. Rank by profit_per_unit * tradeable_quantity
```

**Formula:**
```
Dynamic Price = BasepPrice × (Demand / Supply) ^ 0.4

Profit Margin = (BuyerPrice - TransportCost - SellerPrice) / SellerPrice × 100%
```

### 3. **Trader Engine** — `api/traders.php`

```php
// Trader entities (NPC corporations)
struct NPC_Trader {
  faction_id,
  strategy: 'profit_max' | 'volume' | 'stabilize',
  capital_credits,      // Available to invest
  active_fleets,        // Current missions
  max_fleets,           // Parallel limit
  total_profit,         // Career earnings
}

// Routes with lifecycle
struct TraderRoute {
  status: 'planning' → 'acquiring' → 'in_transit' → 'delivering' → 'completed'
  quantity_planned,
  quantity_acquired,    // How much actually bought
  quantity_delivered,   // How much sold
  expected_profit,
  actual_profit,        // After delivery
}
```

### 4. **Market Integration** — Updates to `api/market.php`

When traders execute transactions:

```php
// Before: price = base * (local_demand / local_supply) ^ 0.4
// After: Supply/Demand updated → price adjusts automatically

// Example:
// Trader buys 1000 metal at cheap system
// → available_supply decreases → price rises
// → Margin shrinks → opportunity disappears
// → Next opportunities emerge elsewhere
```

---

## API Endpoints

### `GET /api/traders.php?action=list_opportunities`

List profitable trade routes sorted by margin.

**Parameters:**
- `min_margin` (float, default 10): Minimum profit % to show
- `limit` (int, default 50): Max results

**Response:**
```json
{
  "count": 5,
  "opportunities": [
    {
      "id": 123,
      "source_system": 5,
      "target_system": 12,
      "resource_type": "metal",
      "source_price": 10.5,
      "target_price": 14.2,
      "profit_margin_pct": 25.7,
      "trade_qty": 500,
      "total_profit_est": 1850,
      "confidence": 0.85,
      "minutes_remaining": 45
    }
  ]
}
```

### `GET /api/traders.php?action=list_traders`

Get all active NPC traders with stats.

**Response:**
```json
{
  "traders": [
    {
      "id": 1,
      "name": "Helion Trading Co. #0",
      "faction_name": "Helion-Konföderation",
      "strategy": "profit_max",
      "capital_credits": 75000,
      "total_profit": 8500,
      "active_fleets": "2/5",
      "session_profit": 2300
    }
  ]
}
```

### `GET /api/traders.php?action=market_analysis&system=5&galaxy=1`

Get supply/demand breakdown for a system.

**Response:**
```json
{
  "system": 5,
  "resources": [
    {
      "resource_type": "metal",
      "production": 2000,
      "consumption": 1500,
      "net_production": 500,
      "available": 8000,
      "demanded": 3000,
      "net_balance": 5000,
      "status": "surplus"
    },
    {
      "resource_type": "food",
      "production": 800,
      "consumption": 1200,
      "net_balance": -400,
      "status": "deficit"
    }
  ]
}
```

### `POST /api/traders.php?action=process_trader_tick`

Execute periodic updates (call every 10-15 minutes):

```bash
curl -X POST http://localhost/api/traders.php?action=process_trader_tick

# Response:
{
  "status": "ok",
  "message": "Trader tick completed",
  "timestamp": "2026-04-04 15:30:00"
}
```

---

## Integration Checklist

- [ ] **Database:** Run migration SQL
- [ ] **API Endpoints:** Register in game.php or frontend router
- [ ] **Initialization:** Run initialize_traders_system.php
- [ ] **Periodic Tasks:** Schedule process_trader_tick every 10-15 min (via cron/tasks)
- [ ] **Frontend UI:** Create Traders Dashboard window (see UI spec below)
- [ ] **Market Link:** Ensure api/market.php reflects updated prices
- [ ] **Testing:** Verify trades execute and prices adjust

---

## Configuration & Tuning

### Supply/Demand Sensitivity

**File:** `api/market_analysis.php`

```php
// Colony consumption per pop per hour
const FOOD_CONSUMPTION_PER_POP = 1.0
const GOODS_CONSUMPTION_PER_POP = 0.2

// Export these as admin-configurable params if needed
```

### Trader Behavior

**File:** `api/traders.php` (when implementing execute_trader_decisions)

```php
// How aggressive traders are
const CAPITAL_DEPLOYMENT_RATIO = 0.7  // 70% of capital in play
const STRATEGY_DRIFT_CHANCE = 0.1     // 10% chance to switch strategy per tick

// Margin thresholds by strategy
STRATEGY_MIN_MARGIN = [
  'profit_max'  => 15.0,   // 15% minimum
  'volume'      => 5.0,    // Willing to take lower margins
  'stabilize'   => 8.0,    // Moderate
]
```

### Market Price Damping

**File:** `api/market.php`

```php
// When a trader buys 1000 units, how much does it affect price?
const PRICE_IMPACT_MULTIPLIER = 0.02

// Meaning: supply decreases 2% → demand/supply ratio increases
// → price increases accordingly
```

---

## Testing Strategy

### Unit Tests

```php
// tests/traders.test.php

test('supply_demand_calculation', () => {
  // Create test colony with 1000 pop
  // Mock: 1000 pop eats 1000 food/h
  // Expected: desired_demand = 1000, net_balance < 0 (deficit)
});

test('opportunity_detection', () => {
  // Create two systems: A (metal surplus) and B (metal deficit)
  // Expected: trade opportunity A→B found with positive margin
});

test('price_adjustment_on_trade', () => {
  // Initial: A has 8000 metal, supply/demand = favorable
  // Trade: 1000 metal removed
  // Expected: price increases by ~10-15%
});
```

### Integration Tests

```php
// scripts/test_traders_e2e.php

scenario('Full trade cycle', () => {
  1. Initialize system with traders
  2. Let traders discover opportunities (process_trader_tick x 3)
  3. Verify trader launches fleet
  4. Fleet delivers goods
  5. Check profit was recorded
  6. Verify prices adjusted
});
```

### Performance Tests

```bash
# Simulate 100 traders, 50 active routes, check query times

# Should complete in < 500ms per tick
curl -w "Time: %{time_total}s\n" \
  http://localhost/api/traders.php?action=process_trader_tick
```

---

## Future Enhancements (Phase 2+)

1. **Trade Director Leader Integration** —已 designed, ready for implementation
   - Leader skill: ±5% price influence
   - Auto-trader fleet allocation
   - Profit sharing with faction

2. **Player Trader Mode** — Let players engage as merchants
   - Access to same opportunities as NPCs
   - Compete with NPC traders
   - Profit scaling

3. **Black Market Traders** — Pirate faction specials
   - Operate at 150% markup
   - No customs/taxes
   - Higher risk

4. **Seasonal Events** — Market shocks
   - Galactic wars increase military equipment demand 3×
   - Harvest seasons drop food prices
   - Tech breakthroughs shift specializations

---

## Debugging Commands

```bash
# Show all traders
sqlite3 galaxyquest.db "SELECT * FROM npc_traders LIMIT 5"

# Show top opportunities by profit
sqlite3 galaxyquest.db \
  "SELECT * FROM trade_opportunities ORDER BY profit_margin DESC LIMIT 10"

# Show system supply/demand snapshot
sqlite3 galaxyquest.db \
  "SELECT resource_type, net_balance FROM market_supply_demand WHERE system_index=5"

# Count active routes by status
sqlite3 galaxyquest.db \
  "SELECT status, COUNT(*) FROM trader_routes GROUP BY status"
```

---

## FAQ

**Q: Will traders manipulate prices too much?**  
A: No — margin requirements and competition between traders naturally stabilize prices. Monitor via market_analysis endpoint; adjust MIN_MARGIN threshold if needed.

**Q: Can a single trader monopolize a resource?**  
A: With current parameters, no. Traders are capped at 3-5 concurrent fleets. Add monopoly-breaking logic if needed: if one trader controls >60% of supply, reduce their capital or margin access.

**Q: How do I seed traders with starter items?**  
A: In initialize_traders_system.php, add colony initial resources. Traders buy from market, not from inventory.

**Q: Should traders form alliances/cooperatives?**  
A: Future feature — would require faction_relations extension and collective capital pooling.

---

## Next Steps

1. **Immediate:** Deploy + test basic flows (already implemented)
2. **Week 1:** Implement trader_tick lifecycle transitions (planning→completed)
3. **Week 2:** Add Trade Director leader integration
4. **Week 3:** Build frontend dashboard
5. **Week 4:** Balance & polish, add market events

