# Body resource foundation

## Status and authority

This is the first economy implementation slice, not an activated economy rewrite.
The existing production runtime still uses `planets.deposit_*`. Neither generation,
profile capture nor reading a profile extracts resources or regenerates biomass.
Three.js, WebGPU and rendering interfaces are unchanged.

Generated `bodies[].resource_profile` describes potential sources, **not current
stock**. It must not be rendered as a surveyed reserve or used as an inventory.
Only the flattened body catalog is enriched; existing nested planet/moon data and
geometry are unchanged.

## Source contract (version 1)

- `finite`: nonnegative remaining quantity, no regeneration. Zero means depleted.
- `regenerating`: bounded quantity, positive capacity and hourly recovery rate.
- `unlimited`: quantities/capacity are null; there is no unlimited production rate.
  Extraction is still subject to facilities, energy and labour in the next slice.
- `unassessed`: no estimate is available. This is not a known empty body.

Mineral estimates reuse the existing class/richness rules. Small moons, comets and
rogue planets are scaled below the legacy planet mass floor rather than inheriting
parent-sized reserves. Gas deposits require atmospheric extraction; core minerals
require deep-core facilities. These method names are requirements, not newly
implemented buildings.

A renewable gameplay biomass source is assigned only from the body's own liquid
water, nitrogen/oxygen atmosphere, habitability >= 65 and 240..330 K temperature.
Capacity is 10,000 units per Earth mass (0.001..3 Earth masses); recovery is 0.1%
of capacity per hour. This is a versioned initial gameplay estimate, not evidence
of real life, food production, or an active regeneration loop.

Rings have no generated mass. They remain unassessed rather than receiving
invented mineral quantities based on visual dimensions. Mining stations and ring
assessment are later extensions.

## Persistence and explicit capture

Append-only migration `migrate_body_resources_v1.sql` creates
`body_resource_profiles` and `body_resource_sources`. It does not modify existing
deposits, colonies, resource stockpiles or owners. Apply through the existing
migration runner, with normal database backup/review procedures.

Preview at most 100 bodies without writes:

```sh
php scripts/capture_body_resources.php
php scripts/capture_body_resources.php --after=100 --limit=100
```

Explicitly capture a batch after applying the migration:

```sh
php scripts/capture_body_resources.php --apply --after=0 --limit=100
```

Use the returned `next_after` for subsequent batches. `--limit` is 1..1000.
Each capture owns a transaction and locks the body (and legacy planet on MySQL).
Concurrent captures serialize on that body. A captured profile, including an
unassessed one, is never regenerated or replenished by another capture.

For root planets, live `planets` rows are matched by galaxy/system/position.
The `-1` sentinel becomes an explicit unlimited source. Finite legacy **remaining**
values, including zero, are retained; their unknown original quantities are null.
Moons never read a parent's planet row just because their positions match.
There is no silent fallback for corrupt data or a missing persistence schema.

## Next slice / cutover requirement

Captured inventories are staging snapshots. They can become stale while legacy
production runs. **Do not activate extraction against them yet.** The economy
cutover must quiesce the old writer, reconcile legacy mineral remaining quantities
under locks, then switch all production to one authoritative inventory. Capture
must not be used as a reset/reconciliation command.

The existing colony economy now settles on demand with shared read-only
calculations, fractional growth and atomic legacy deposit accounting; see
[Colony on-demand economy](COLONY_ON_DEMAND_ECONOMY.md). This does **not** activate
the staged body inventories or their regeneration.

The next slices must implement body-inventory cutover/regeneration, labour and
real extraction requirements, processing and shared atomic reservations. Initial
start-world guarantees and visibility/survey rules also remain pending. No new
resource endpoint exposes undiscovered world inventories.

## Verification

```sh
vendor/bin/phpunit tests/Unit/BodyResourceProfileTest.php tests/Integration/BodyResourceRepositoryTest.php
```

Repository tests use SQLite by default, executing the same migration with only
MySQL ENUM/engine syntax adapted. For actual MySQL constraints and locks, set
`GQ_BODY_RESOURCE_TEST_DSN`, `GQ_BODY_RESOURCE_TEST_USER` and
`GQ_BODY_RESOURCE_TEST_PASSWORD`; each test creates/drops its own random database.
Use a dedicated disposable server account permitted to create test databases and
temporary users/grants (the CLI test creates and removes an isolated login).
