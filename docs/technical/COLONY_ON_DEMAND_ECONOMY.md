# Colony on-demand economy

## Execution model

There is **no periodic economy tick, scheduler or separate engine** in this slice.
Existing callers invoke `update_colony_resources()` on demand. The function
settles elapsed time since the colony's persisted `last_update`, including
individual seconds, and atomically advances that timestamp with the stockpiles,
population and geological deposits.

Long elapsed intervals are integrated in numerical steps of **at most** 60
seconds inside that same call, including the final partial minute. These are not
scheduled game ticks. Frequent calls are not required for growth or production.
The entire elapsed interval is settled before returning; offline time is not
capped or left waiting for another access.

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

Migration `migrate_colony_economy_precision_v1.sql` converts legacy mineral
deposits to `DECIMAL(20,6)` without changing their values and creates
`colony_economy_precision`. It preserves population, dark-matter and sub-stock-unit
remainders across requests. Colony stockpiles remain `DECIMAL(20,4)`; extraction
credits/debits the same four-decimal amount. Residual deposits below 0.0001 cannot
be credited until stockpile precision is extended.

Apply the migration through the normal migration runner **before deploying these
runtime changes**. Missing schema/corrupt precision state fails explicitly.
No runtime DDL or automatic migration runs on a gameplay request.

MySQL locking reads serialize simultaneous settlements and avoid reusing stale
repeatable-read snapshots. A standalone call owns its transaction. A call inside
an existing transaction uses a savepoint, never commits its caller, and rolls back
its own changes on error. Production modifiers must not mutate behind these locks
without first settling the old interval when future mutation paths are unified.

## DOM and market integration

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
action integration. Different sub-minute access patterns may have small numerical
integration differences when population or welfare changes; there is no per-call
growth rounding or loss of fractional food/extraction.

## Focused verification

```sh
vendor/bin/phpunit tests/Unit/ColonyEconomyCalculationTest.php tests/Integration/ColonyEconomyPersistenceTest.php
npm run test:unit:js -- tests/js/runtime-economy-flow-controller.test.js
```

Persistence tests use SQLite by default. `GQ_BODY_RESOURCE_TEST_DSN` and the
corresponding `_USER`/`_PASSWORD` variables enable isolated MySQL databases and
the real precision migration, including stale-snapshot locking coverage.
