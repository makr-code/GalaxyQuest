# Colony on-demand economy

## Execution model

The on-demand ledger (`src/Economy/OnDemandEconomy.php`,
`ColonyEconomySimulation.php`, `ResourceLedger.php`) is the **only** colony
economy path. There is no feature flag (`ON_DEMAND_ECONOMY_ENABLED` was removed),
no periodic production/population tick, scheduler or lazy flush
(`api/economy_flush.php` was removed). The global simulation tick
(`scripts/run_simulation_tick.php --scope=global`) does not run economy
subsystems.

`update_colony_resources()` delegates to `OnDemandEconomy::settle()`. Settlement
advances the colony's persisted economy cursor in numerical steps of
`ColonyEconomySimulation::STEP_SECONDS` (300 s), at most `MAX_STEPS` (288, i.e.
24 h) per call. A mutation additionally integrates the final partial step. These
are not scheduled game ticks; any remaining backlog is settled on the next access.
Production-changing commands reject with HTTP 409 while the colony is still
catching up (`assertCaughtUp`).

Mutations (market, research, shipyard, buildings, fleet launch, trade) run inside
`OnDemandEconomy::transaction()`. Top-level MySQL transactions use
`READ COMMITTED` isolation so that guards evaluated after acquiring the user and
colony row locks see committed state instead of a snapshot taken by an earlier
non-locking read. This requires row-based or mixed binary logging (MySQL default);
`binlog_format=STATEMENT` is not supported.

## Shared calculation

`calculate_colony_consumption_snapshot()` is the read-only calculator used by
settlement and overview/trade snapshots. Research, manager bonuses, colony
specialization, energy shortages, events and hospital ships use the same formulas.
`load_colony_economy_context()` reads those modifiers without settling resources.
Snapshot creation does not write or advance time. Existing callers that explicitly
settle on reads retain their behavior; this slice does not turn them into jobs.

- Population consumes **1 food per 100 inhabitants per hour**.
- Stored food, including fleet imports, fulfils needs before starvation is
  evaluated. Reserves alone provide normal coverage; surplus production can
  increase it. Food production now also requires its share of available energy.
- Hourly growth stays fractional. Signed population remainders persist until a
  whole inhabitant is gained/lost. Reduced housing stops growth rather than
  deleting existing people.
- Extraction is limited **after all bonuses** by elapsed production, available
  storage and actual remaining deposits. Only credited quantities are depleted.
  Full storage does not waste deposits; above-cap imported stock is not truncated.
- Unlimited legacy deposits retain `-1`. No staged body-resource source becomes
  authoritative in this slice.
- Galaxy catalog refreshes initialize deposits only for new planets. They no
  longer restore depleted or fractional reserves on existing planets.

The ledger schema is created by `sql/migrate_economy_on_demand_v1.sql` (plus the
colony-building and body-development migrations it depends on). Apply all pending
migrations through the normal migration runner **before deploying runtime
changes**; there is no legacy fallback when the schema is missing. No runtime DDL
or automatic migration runs on a gameplay request. The older
`colony_economy_precision` table is no longer read or written at runtime.

## DOM and market integration

### Opt-in NPC production decisions

The existing hourly NPC-account pipeline can now choose one method adjustment
and one affordable construction for an explicitly bound economic actor, sharing
the existing standing-order window marker and finite budget. Unbound/human
accounts are unchanged; bound accounts already bypass the legacy multi-round
controller. No actor, research, stock, credits or colony is provisioned.

Next-hour counterfactuals use the real recipe and raw-production calculators,
including population/employment, energy/input limits, research and available
deposits/storage. Method switching requires a stable >5% weighted reserve-
shortfall improvement; premium is not a default. Construction uses player queue
preflight, body layout/class capacity, research/discounts and ledger costs.
An active queue prevents another structural choice; on-demand settlement remains
the only way queued levels complete or production advances.

Construction's market-valued resource cost and new buy escrow share the profile
cap. Valuation is policy accounting, not a credit grant or resource conversion:
actual unreserved goods must still fund every cost. Food-reserve deficits defer
industrial construction, while food/energy repairs remain possible. Decisions
and all effects commit atomically; same-hour force/retries cannot spend again.

`scripts\npc_economy.php preview|status` are strictly read-only, including when a
queue is due. Stale preview cursors explicitly defer rather than settling. Saved
diagnostics include methods/levels, beneficiary needs, costs, reservations,
budget, window and constraint reasons. See
`TRADERS_INTEGRATION_GUIDE.md` for explicit activation and verification.

Overview colonies expose `*_per_hour`, `food_consumption_per_hour`,
`food_coverage` and `population_growth_per_hour`. The economy-flow DOM controller
uses these values instead of invented population multipliers and raw-material
upkeep. Missing snapshot fields produce a visible error, not fictitious rates.
Rebuild existing overview read models after deployment to populate the new fields.

Production fields describe a next-hour estimate constrained by current reserves
and space, not an unlimited factory potential. `food_consumption_per_hour`
describes need; `food_supplied_per_hour` in the detailed snapshot describes how
much can actually be supplied over the projected interval. Market analysis uses
the same food need and no longer adds a second population-wide consumer-goods
consumption on top of processed-goods rates.

## Boundaries still pending

This is not yet the complete economy loop. Labour allocation, processing inputs,
construction/research chronology, market stock unification, staged body-resource
cutover and renewable-source recovery remain separate implementation slices.

Numerical steps recompute current population, food and welfare, but modifiers are
loaded once per demand-driven settlement. Historical building completions,
research and event changes are not replayed; that requires the pending chronological
action integration. Different sub-step access patterns may have small numerical
integration differences when population or welfare changes; there is no per-call
growth rounding or loss of fractional food/extraction.

## Focused verification

```sh
vendor/bin/phpunit tests/Unit/ColonyEconomyCalculationTest.php tests/Integration/OnDemandEconomyTest.php
```

`GQ_RESOURCE_LEDGER_TEST_DSN` with the corresponding `_USER`/`_PASSWORD`
variables enables the isolated MySQL concurrency tests
(`ResourceMutationApiConcurrencyTest`, `ResourceLedgerConcurrencyTest`,
`FleetMySqlConcurrencyTest`).
