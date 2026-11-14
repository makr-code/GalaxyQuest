# 🤝 Traders System — Integration Guide

> Historical integration examples, not a current executable runbook. The traders API requires an authenticated session and CSRF tokens for POST actions. The Quick Start `curl` commands below omit credentials and will not work as written; later mutation examples show the required session and CSRF headers.

## Current funded standing orders

Deploy the appended `migrate_standing_trade_orders_v1.sql` through the canonical
migration runner before using this version. It creates **no** accounts, colonies,
credits, goods or default orders. Human and NPC counterparties are disabled unless
they explicitly submit backed orders. Existing instant `buy`/`sell` remains a
separate external market-maker; supply/demand opportunities are advisory only,
not permission to take colony stock.
Existing `trade.php` proposals are targeted bilateral barter for three raw
resources, without credit escrow or standing catalog offers; they remain separate.

- Authenticated, CSRF-protected `POST market.php?action=create_order` accepts
  `{colony_id, side: "buy"|"sell", good_type, quantity, limit_price}`.
  Quantity is a whole number from 1 to 1,000,000; price has at most two decimals,
  0.01–1,000,000 credits; total budget is capped at 10,000,000,000 credits.
  The shared catalog and current ownership/policy are checked server-side.
- Buy orders debit the complete maximum budget into `escrow_cents`; sell orders
  reserve goods through the common on-demand ledger immediately. Finite
  `quantity_remaining` means **unallocated**, not necessarily already delivered.
- Pure `GET market.php?action=list_orders&colony_id=N` lists the owner's last
  200 orders, prioritizing active reservations. Price/order GETs do not settle
  or mutate colonies.
- Authenticated, CSRF-protected `POST market.php?action=cancel_order` accepts
  `{order_id}`. Only unallocated quantity/budget is returned, exactly once.
  Already allocated flights retain their buyer obligation despite cancellation
  or subsequent policy changes; filled portions are never refunded.
- Traders pair active sell/buy orders in different systems of the same galaxy.
  Quantity is bounded by both residual quantities, buyer escrow, trader capital
  and the explicit existing virtual-logistics cap (10,000 units per route;
  no physical ships are provisioned). Seller ask and buyer bid are contractual
  execution prices, not changing market quotes.
- At acquisition NPC capital pays the seller account and reserved goods enter
  transit. Buyer quantity/escrow is removed from the order and earmarked as
  `trader_routes.buyer_escrow_cents`. Completion atomically delivers cargo and
  moves that earmark to NPC capital. There are no new taxes or minted sale credits.
  Conservation is users + NPC capital + order escrow + route escrow; goods are
  stock + unallocated sell reservations + cargo (apart from ordinary settlement).
- Every financial mutation uses the ledger transaction/savepoint. Routes lock
  participant users in ascending order, then colonies, then route/trader/orders;
  order IDs are deterministic, including same-owner pairs. Due colony settlement
  precedes deltas; bounded catch-up defers routes or rejects commands with 409.

### Legacy deployment handling

Unfunded legacy planning routes with no acquired cargo are failed without any
stock/payment change. Legacy acquired, in-transit or delivering routes are
**quarantined** on their next pass (`funding_status='quarantined'`): status,
cargo/fleet and historical accounting are retained, no player is charged and no
new revenue is minted. `list_routes` exposes funding status and order links.
Operators must reconcile these individually from `trader_transactions` and
fleet cargo; this block intentionally supplies no automatic refund/relaunch
command because historical owner payment/consent cannot be proven.
Quarantined routes keep their fleet slot and ordinary arrival exclusion.
No migration or scheduler was run automatically.

### Opt-in autonomous NPC colonies

`NpcStandingOrders` now runs inside the existing hourly global NPC account
pipeline. **It is inactive until an operator explicitly binds an existing colony.**
The append-only `migrate_npc_economy_orders_v1.sql` adds only profiles, last-window
summaries and managed-order expiry metadata; it provisions nothing.

Activation, performed offline by an authorized deployment operator:

1. Verify the canonical migration runner's configured database, then run
   `php scripts/migrate.php up` and `php scripts/migrate.php verify`.
   All earlier actor, on-demand economy and funded-order migrations are required.
2. Identify existing `users` with `control_type='npc_engine'`, `auth_enabled=0`,
   `deleted_at IS NULL`, and a colony actually owned by that account. Existing
   `faction_homeworlds`/`npc_faction_memberships` may help identify actors; do **not**
   run the homeworld seeder or allocate occupied bodies as part of this activation.
   Select the budget from the account's current credits; there is no funding grant.
3. Set **explicit** CLI connection variables `GQ_NPC_ECONOMY_DSN`,
   `GQ_NPC_ECONOMY_USER`, `GQ_NPC_ECONOMY_PASSWORD`. The DSN must be MySQL and
   include the intended database. This CLI never falls back to application
   credentials. `--expected-db` is verified with `SELECT DATABASE()` before writes.
4. Preview binding, substitute verified IDs/database and a finite credit cap:

   ```powershell
   php scripts\npc_economy.php bind --actor=ACTOR_ID --colony=COLONY_ID --profile=industry --budget=1000.00 --expected-db=DB_NAME
   ```

   Add `--apply` to that same command to activate. Binding rejects human,
   authenticating/deleted actors, wrong ownership, insufficient existing credits,
   duplicate profiles and caps outside 0.01–100,000.00 credits. One colony per
   account is intentionally supported; existing bindings are not overwritten.
5. Read status or preview the next decision:

   ```powershell
   php scripts\npc_economy.php status --actor=ACTOR_ID --expected-db=DB_NAME
   php scripts\npc_economy.php preview --actor=ACTOR_ID --expected-db=DB_NAME
   ```

   Decision preview and status are strictly read-only: no settlement, queue
   completion, cancellation/refund, reservation, or consumed auto-increment IDs.
   Preview reports `stale_catchup` when the saved cursor needs settlement; it
   does not secretly catch up just to propose an action. Binding without `--apply`
   validates prerequisites without inserting a profile.
   Neither command starts a scheduler, publishes mail,
   creates a route, nor modifies political membership/species.

Thereafter the already-configured `scripts/run_simulation_tick.php --scope=global`
NPC step decides once per actor per UTC hour, **including under `--force`**.
At most 64 actors are visited per global pass; bound actors are prioritized by
their oldest decision window. Bound accounts do not also execute the old
multi-round build/research/ship/LLM controller. No new worker or production tick
exists: only the one bound colony is settled when its actor actually decides.
Catch-up is limited to the existing one-day ledger batch; backlog commits a
`deferred` summary without orders and retries in the next hour, never spending
stale stock. Unbound accounts retain the existing controller.

#### Production choices in the same hourly decision

Each bound actor may change **one production method** and enqueue **one
construction** per UTC hour, in addition to the existing four create/cancel
order operations. All effects and diagnostics use the existing profile window
marker; repeated or forced passes do not repeat any action. No second account
controller or new schema/migration is needed.

Choices compare next-hour counterfactuals through `ColonyEconomySimulation` and
the ordinary raw-production calculator: actual population/employment, inputs,
storage/deposits, energy, welfare and unlocked recipe tiers constrain output.
Only reductions exceeding 5% of the current weighted reserve shortfall (and
0.01 weighted credits) justify switching away from the current method. Food
has survival priority; industry weights manufactured-chain deficits more heavily.
Efficient/standard/premium are evaluated, not universally promoted; premium
requires actual quantum-computing research and pays its ordinary extra energy
and rare-earth inputs. Profiles remain unrelated to species/political membership.

Construction uses the **same preflight and queue mutation as players**, including
research, nano-material discounts, existing building availability, surface-grid
and class/flex capacity, slot limits, queue cap and full physical cost. No
building/level/research grant occurs. Any active queue defers further structural
choices until on-demand completion; the pending target is shown in diagnostics.
Industrial construction defers while food is below its reserve and current food
production cannot cover demand; food/energy repairs remain eligible.

The finite hourly budget now covers construction resource cost valued at the
existing galaxy market quotes **plus buy escrow**, not merely buy escrow.
This valuation is only an NPC policy cap: it is not an extra credit debit, an
exchange, or permission to ignore missing stock. Current building costs contain
metal/crystal/deuterium and no direct credit charge. Existing buy escrow and
reserved sell stock are already absent from spendable balances; shared ledger
checks remain authoritative. Construction precedes new surplus reservations,
and new buys may use only the cap remaining after construction.

`status`/`preview` include current/target methods or levels, measured beneficiary
shortfalls, full available cost breakdown, valuation rates, population/energy,
reservations and budget/window. Genuine constraints report research,
unaffordable resources, window budget, food reserve, slots/capacity, active queue,
stale catch-up or no improvement. Unexpected database errors roll back the
entire actor/hour (methods, ledger, queue, orders and marker) and escape for retry.
Production and queued completion still advance **only on demand**.

Demand is a **non-persisting forecast through the authoritative recipe/class
calculation**, including unmet inputs, active levels, research, methods and
existing economy policies. It grants no forecast goods. Reserves cover six
hours plus two safety hours (`subsistence`: four safety hours). Food is first;
`industry` then prioritizes manufacturing inputs, `subsistence`/`agriculture`
population goods, and `trade` remaining deficits with seeded tie-breaking.
These operator-selected profiles describe economic strategy, not political
factions or species; operators can choose them for existing agricultural,
industrial, balanced or trade colonies independently of faction affiliation.
Existing autarky prohibits imports.

Only whole measured surplus above gross reserves is sold. Buy budgets use
current spendable account credits and the per-hour cap; four create/cancel
operations maximum. Quotes use the existing last-settled **galaxy** market:
buyer limit +10%, seller limit −10%, bounded by the normal cent/quantity limits.
There are no instant market-maker calls or automatic stock/credit top-ups.
Unallocated buy quantities and backed in-transit quantities count toward needs.
Existing reservations are maintained conservatively rather than stacked; a
partially funded order can leave a reported deficit until filled or refreshed.
Only this controller's orders expire after 24 windows (or become unsuitable when
stock/policy changes), via ordinary cancellation
of the **unallocated** residual; transit cargo/escrow remains owed. More than
128 active orders defers the actor for operator intervention.

Summaries expose actor/colony/window, per-good reserve/stock/incoming/deficit,
credits before/after, created/maintained/cancelled/deferred orders and errors.
They persist atomically with effects and are available via `status`; existing
NPC logs emit `npc_economy_decision` or `npc_economy_error`. Create failures roll
back all effects and the window marker, leaving the error in logs for retry.
Ownership/controller changes exclude the actor, without confiscating historical
contracts or their obligations.

`EconomyAutonomyScenarioTest` exercises seven simulated days with two bound NPC
colonies in different systems, a human and an existing trader. Its finite
endowment yields 147 NPC orders and 87 completed paid routes (2,529 metal and
48 steel alloy); no resources are injected after initialization. At zero tax,
the 500,000-credit sum including trader and both escrow types remains unchanged.
Hourly duplicate decisions, event generation and request ticks do not duplicate
effects; ignored requests expire without changing the human ledger. A funded
human sell changes the next shipment from 208 to 1 metal in paired runs.

The four-day interruption case verifies capped catch-up, current-window-only
decisions, a rolled-back acquisition retry and exactly-once delayed delivery;
the destination is settled before the delivery, not credited retroactively.
A separate funded fixture completes an NPC construction on demand. The
seven-day case has no executed method or construction choices; their independent
guards and execution remain covered by `NpcStandingOrdersTest`. The stock
accounting case verifies one actual production/consumption step and full-storage
extraction blocking, not a seven-day per-recipe material balance. These tests
are not a profitability, shortage-free survival, live deployment, or automatic
world-provisioning guarantee.

The six SQLite scenario cases passed with 4,292 assertions. A separate
seven-day case in `StandingOrdersMySqlTest` passed with 850 assertions against
a dedicated MySQL 8.4 server and a freshly created database after the canonical
manifest was applied and verified; its fixture and quantities differ from the
SQLite scenario. No live database or SMTP transport was used.

Production-choice verification: 89 targeted SQLite tests / 755 assertions across
`NpcStandingOrdersTest`, `OnDemandEconomyTest`, `TraderRouteLogisticsTest` and
`EconomicRequestsTest`; the existing `GalaxyNewsTest` doc-comment metadata
deprecation remains. Five isolated MySQL cases / 84 assertions in
`StandingOrdersMySqlTest` additionally exercise explicit CLI
previews, same-window retries, current ownership, funded queue serialization and
outer-savepoint rollback. PHP 8.2.35 / MySQL 8.4.11; no live database, actor
activation, SMTP, scheduler, or deployment action is part of verification.

Trading additionally requires **existing funded traders** and the existing
global trader route step. Routes still need different systems in the same galaxy,
available trader capital/fleet slots and profitable asks/bids. Travel takes real
time; stale destination settlement can defer delivery. An eight-hour reserve
does not guarantee delivery before shortages on long routes. Unprovisioned
faction worlds do not run automatically. This block intentionally omits new
building choices and combat/research/prologue actions. The following bounded
block now adds voluntary player supply and NPC surplus purchase requests with deadlines.

### Voluntary supply and surplus purchase requests

Deploy append-only `migrate_economy_requests_v1.sql` and
`migrate_economy_request_purchase_v1.sql` **before this application version**.
The new down migration refuses rollback while any purchase request history exists.
The original `_down.sql` refuses rollback while any private paired
order is active; pause API/worker mutations before rollback, explicitly cancel
unallocated commitments first, and never refund route-backed obligations.
No accounts, colonies, credits, goods, default orders or automatic binding are
seeded. Existing NPC profile activation, funded traders and global hourly ticks
remain prerequisites; no new scheduler or production scan is introduced.

After ordinary NPC/trader decisions, the global `economy_requests` step expires
deadlines and offers supply invitations from actual active, funded NPC buy
orders and purchase invitations from policy-created, already reserved NPC sell
orders. Both directions share the same selection and limits. Pending invitations do not reserve player stock/money or block NPCs
from trading with other actors. Selection uses `HourlyWindow::random`, at most
64 bound NPCs per pass, one invitation per actor/hour, one per actor/player per
24 hours, one per order/player, and three unexpired outstanding requests per
player. Eligible recipients are active authenticating humans with existing
colonies in the same galaxy and a different system. No new reputation gate,
political membership or species logic is involved.

- Pure authenticated `GET market.php?action=list_orders&colony_id=N` additionally
  returns owned-colony `requests` and `now_unix`. It never settles a colony,
  persists expiry or discloses NPC account IDs/colonies/hidden coordinates.
  States are `pending`, `accepted`, `declined`, `expired`, `unavailable`.
- Terms are immutable: supply 1–100 whole catalog units at a fixed integer-cent
  seller price or buy 1–100 units at a fixed maximum total. Seller price is the source
  NPC order's buy limit **minus one cent per unit**, the ordinary trader spread.
  The player purchase limit is the NPC sell limit **plus one cent per unit**;
  quantity × that limit is the maximum credit reservation, shown before consent.
  No future market quote is substituted. `expires_at` is an absolute Unix UTC
  deadline, at most 24 hours and capped by the original NPC order expiry.
- CSRF-protected authenticated `POST market.php?action=accept_request` accepts
  **only** `{request_id}`. `now >= expires_at` returns 409. Under ascending owner,
  colony and order locks, acceptance checks current human/NPC eligibility,
  ownership, policy, catalog, route geography, original price, residual quantity
  and escrow. It creates the exact player sell order via `StandingOrders`,
  moves that quantity/budget out of the public NPC buy order into a dedicated
  buy order, and binds the pair using `paired_order_id`, in the same transaction
  as the accepted state. No new NPC debit or invented funds; no oversized terms.
  Insufficient player goods rolls back everything. Filled/cancelled/unfunded
  NPC backing becomes unavailable (409), with no player goods spent.
  For purchase, the player buy order reserves exactly the quoted maximum via
  `StandingOrders`, while the private NPC sell order receives only stock carved
  from the existing public reservation. Insufficient credits or autarky rolls
  back the transaction; no stock or credit is created.
- Duplicate acceptance returns the same confirmed player order; it never
  repeats reservation, even if that confirmed order was subsequently cancelled.
  Normal traders enforce the pairing both during selection and acquisition.
  The NPC maintenance controller does not expire the private child order.
  Fulfilment is delayed, not instant or promised by a deadline; trader funding,
  compatible specialization, fleet slots, policy and real travel remain required.
- `POST market.php?action=decline_request` accepts `{request_id}`, idempotently.
  Decline/default expiry charges nothing and carries no penalty. Explicit
  cancellation of the accepted player order releases both **unallocated**
  residuals; existing route backing, cargo and payments are never refunded.
- Invitation, one in-game message and one deduplicated `mail_outbox` row commit
  together. NPC/disabled accounts are never recipients; opted-out humans get a
  skipped row. There is no mail send on acceptance/decline/GET. Transport
  failures remain independent. Internal links contain only request/owned-colony
  IDs and open the market, not an automatically accepting URL.

The canonical market domain/UI displays scoped requests, deadline, exact terms
and explicit reservation warnings. Terminal states have no controls; stale,
mutating or locally elapsed requests are disabled. Server errors are visible
and require refresh, without automatic acceptance retries or user-data HTML.
Legacy `trade_proposals` remains targeted three-resource barter with its own
fleet settlement; it cannot represent arbitrary catalog goods, cent prices,
funded standing orders or private pairs. Therefore this small invitation
record supplements the same funded exchange, rather than duplicating a barter
engine. There is no faction-mandate/advice/reputation system, Vethisit catalog,
surplus-purchase request or live rollout in this block.

Player-request validation: **65 PHP tests / 838 assertions**, PHP 8.2.35:
`EconomicRequestsTest`, `TraderRouteLogisticsTest`, `NpcStandingOrdersTest`,
`WorldEventsTickTest` (SQLite) and `StandingOrdersMySqlTest` (explicitly isolated
MySQL 8.4 fixture; never application-default credentials). The latter creates
and drops its own guarded fixture schema and runs real lock-barrier workers.
This includes duplicate acceptance, competing recipients for final escrow,
accept/cancel races, migration down/up and refusal to publish private pairs.
**54 JS tests** cover the market domain/UI and unchanged legacy proposal UI.
Affected PHPStan, PHP syntax, ESLint and `check_migration_history.mjs --base HEAD`
pass. No fixture sends SMTP or invokes a production tick.

Verification for the preceding autonomous NPC-profile block: **78 tests / 1,410 assertions**, PHP 8.2.35 and
isolated MySQL 8.4.11; no live schema or scheduler was used. The targeted set
includes 14 autonomous SQLite regressions (two NPC colonies exchanging metal
and manufactured steel through real funded routes over three fixture-clock
windows), existing ledger/route/hourly/read regressions, and 10 MySQL tests.
Three new MySQL cases certify actual CLI activation/rollback previews,
concurrent same-window decisions, current actor ownership under an outer
REPEATABLE READ snapshot and atomic managed-order persistence failure.
Affected PHPStan and PHP syntax checks pass. The complete repository/browser
suites and live activation were intentionally not run.

### MySQL 8.4 concurrency certification

`tests/Integration/StandingOrdersMySqlTest.php` is an opt-in executable regression
suite using the existing `GQ_RESOURCE_LEDGER_TEST_DSN`, `_USER`, `_PASSWORD`
connection convention. Point these **only at a disposable MySQL server**: the
suite creates and drops its own `gq_standing_mysql_<random>` database, replays the
complete canonical manifest through `MigrationRunner`, and uses subprocess
barriers confirmed by real InnoDB lock waits. Generated SQL fixtures stay under
`tests/Integration` and are removed afterwards. It does not use the configured
application/live connection.

Verified on isolated MySQL **8.4.11**, native PDO prepares, PHP 8.2:
**7 focused integration regressions; 24 tests / 960 assertions** in the combined
standing-order, canonical-migration/on-demand and existing funded-logistics run.

- Competing finite sell/buy reservations commit once or reject atomically.
  Acquisition/cancellation races, two-trader partial fills, stale route replay,
  reverse cross-owner routes and same-owner delivery preserve cents and goods.
  Fixtures have zero population and inactive factories; the conserved good is
  `steel_alloy`, not an unaccounted continuously produced raw resource.
- Cancelled in-flight obligations remain funded; concurrent due completions,
  ordinary fleet claims and another ledger receipt produce one trader delivery,
  payment and fleet-slot decrement. The ordinary-arrival fixture executes the
  real claim/exclusion SQL, not the unrelated combat/cache/mail handlers.
- Top-level transactions actually use READ COMMITTED. Nested savepoints also
  read locked current ledger rows, so a prior outer REPEATABLE READ snapshot
  cannot restore already spent processed goods. Ownership is revalidated after
  the account/colony lock wait. Forced acquisition and sale writes roll back
  reservations, balances, cargo and route state; a caller's unrelated outer
  write survives a savepoint rollback.
- The trader account is included in sorted participant locks before fleet
  insertion can acquire its account foreign-key lock.
- Delivery validates the linked orders against the current endpoint owners.
  Missing/deleted orders or destinations and ownership changes quarantine
  acquired obligations without crediting a different owner or erasing cargo.
  FK-disabled corruption is simulated only inside the disposable test schema.

The new, unreleased standing-order migration enforces integer quantity/budget
checks and one route per non-null fleet ID. It replaces the legacy trader-delete
CASCADE with RESTRICT: colony/account/trader destruction cannot silently remove
orders or funded route escrow. **Even cancelled/filled orders and historical
routes block parent deletion**; there is no destructive refund/archive workflow.
Rollback is deliberately non-reversible (`no_down_file`), preserving migration
status, goods and escrow rather than dropping funded tables. Previously committed
canonical migrations are unchanged.

Limitations: these are focused interleavings, not a proof against every game-wide
lock path. No generic deadlock retry is installed; errors propagate and rollback,
including MySQL's automatic whole-transaction rollback, without hiding failures.
Existing duplicate legacy fleet bindings will reject the unique-index migration
and require explicit operator reconciliation, not automatic deletion. No live
migration, production rollout, scheduler/mail startup or NPC provisioning was
performed.

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
    │ market_supply_demand table  │ ← Updated by global simulation runs
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

// Aggregates into the persistent table when the trader cycle runs
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

### Route execution (current implementation)

The global trader pass advances each route under its own transaction/savepoint
after re-reading and locking the persisted route. A planning route can acquire
goods and launch in the same pass; an already-due flight can deliver and finish
in that pass as well. A future flight remains `in_transit`. `arrival_at` and
`departure_at` are the scheduled timestamps; legacy in-transit routes without an
`arrival_at` use the linked fleet's `arrival_time`. Route-owned fleets are
excluded from ordinary fleet-arrival resolution, which prevents a second cargo
delivery.

The route catalog is the OnDemandEconomy catalog: all five primary resources
and every processed good. Before source inventory is read or destination cargo
is applied, the colony is settled through `OnDemandEconomy`; a colony with
unsettled catch-up backlog is not traded against. Its normally capped settlement
cursor may advance while the route remains unchanged for a later pass.
Acquisitions and deliveries use the ledger's spend/receive mutations so the
saved cursor and market projection stay aligned. A delayed route only receives its cargo when processed;
settling a destination first does not retroactively produce the undelivered
goods. Missed trader decision/opportunity windows are not replayed.

The NPC logistics rule uses the existing 3-D system coordinates and transit-time
helper at a fixed 100 ly/h. NPC fleets have no ships, so faction/species FTL
rules are not applied. The current system-coordinate model does not distinguish
orbital offsets for bodies in the same system; such routes use the helper's
30-second minimum flight.

Counterparty accounting now uses finite backed standing orders described above.
Acquisition consumes sell reservations, not unconsented colony inventory.
Unfunded legacy routes do not use the current delivery/payment path.

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

Execute a trader update manually. This mutating endpoint requires an authenticated
session and a CSRF token; it is not a supported cron/worker interface.
The current action processes route transitions, recalculates supply/demand,
refreshes opportunities, and makes trader decisions under a global simulation
lock. Do not rely on the sample response as a complete response schema.

```bash
# session.cookies must contain an authenticated session.
CSRF_TOKEN=$(curl -s -b session.cookies \
  http://localhost/api/auth.php?action=csrf | jq -r '.token')
curl -b session.cookies -H "X-CSRF-Token: $CSRF_TOKEN" \
  -X POST http://localhost/api/traders.php?action=process_trader_tick

# Response:
{
  "status": "ok",
  "message": "Trader tick completed",
  "timestamp": "2026-04-04 15:30:00"
}
```

---

## Integration Checklist

> This checklist is a historical integration proposal, not the current
> deployment checklist. Trader-cycle scheduling and locking are documented in
> [HEADLESS_SIMULATION_ENGINE.md](HEADLESS_SIMULATION_ENGINE.md); do not add a
> second scheduler based on this list.

- [ ] **Database:** Run migration SQL
- [ ] **API Endpoints:** Register in game.php or frontend router
- [ ] **Initialization:** Run initialize_traders_system.php
- [x] **Periodic Tasks:** Use the existing global simulation tick (`php scripts/run_simulation_tick.php --scope=global`); its trader subsystem has a 15-minute cooldown. Do not schedule the HTTP mutation endpoint as a worker. The former standalone `scripts/traders_background_job.php` has been removed.
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

# Should complete in < 500ms per tick. Run only with an authenticated
# session and CSRF token; this HTTP action is not a worker interface.
CSRF_TOKEN=$(curl -s -b session.cookies \
  http://localhost/api/auth.php?action=csrf | jq -r '.token')
curl -b session.cookies -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
  -w "Time: %{time_total}s\n" \
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

## Historical Next Steps (Not Current Backlog)

The phases below were planning notes from this guide's original snapshot. They are
not a current delivery plan or evidence that the listed integrations are complete.

1. Deploy + test basic flows
2. Implement trader lifecycle transitions
3. Add Trade Director leader integration
4. Build frontend dashboard
5. Balance and add market events
