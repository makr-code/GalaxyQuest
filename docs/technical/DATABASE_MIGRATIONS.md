# Database Migrations – GalaxyQuest

## Overview

GalaxyQuest uses a **manifest-based migration runner** for database schema changes.
Every migration is a plain `.sql` file stored in `sql/`.  The runner tracks applied migrations in a
`schema_migrations` table and supports dry-run preview, step-limited execution, and rollback via
companion `_down.sql` files.

---

## Quick Start

### Verified actor-history adoption

```bash
php scripts/migrate.php adopt-actors --dry-run
php scripts/migrate.php adopt-actors
```

This narrow reconciliation contract adopts only
`migrate_actor_model_v1.sql` and `migrate_actor_model_v2_drop_is_npc.sql`.
It does not execute either SQL file and does not adopt the other pending
migrations. Adoption requires the canonical sources to match reviewed SHA-256
pins (LF-normalized for Windows checkouts), existing tracking with valid
checksums, and the current InnoDB actor schema without `users.is_npc`.
Controller column types/defaults, the controller index, every controller/login
identity and deleted-account invariants are checked under transaction locks.

`schema_migration_adoptions.sql` creates operator-only evidence infrastructure
on explicit adoption, not during gameplay or a dry-run. Evidence records the
contract ID, source pin, deployment environment, aggregate controller counts
and a hash of the inspected identity snapshot. The original identities are not
copied into the evidence. Evidence and tracking entries commit together;
tracking uses reserved environment `ADOPTED`, not a claim of SQL execution.
CLI status distinguishes `executed` and `adopted`. Missing/tampered provenance
blocks adopted status and deployment verification. Adopted entries cannot
execute rollback SQL. `--step` is invalid for this bounded operation.

The contract is a point-in-time adoption proof, not an immutable promise that
gameplay can never subsequently create or change an actor. It deliberately
does not infer current NPC identities from retired legacy flags.

Pending `migrate_v2.sql` is blocked by Up after actor adoption because it
recreates `is_npc`. Reconcile that migration's remaining schema/data effects
before running a general Up. Do not bypass this guard through direct SQL or
partial manifests. Unified-body adoption and other historical contracts are
not implemented by `adopt-actors`.

Local application on 2026-11-07 preserved the same identity snapshot:
3 human accounts and 44 non-login NPC accounts. History now contains
14 executed entries, 2 adopted entries and 69 pending migrations.
Readiness remains 503. The targeted acceptance passed 18 MySQL tests /
121 assertions (adoption and migration locks), plus 145 runner/CLI/health
tests / 542 assertions. Targeted PHPStan and new-class PHPCS passed; existing
style findings in legacy runner/CLI files were not claimed clean or rewritten.

### Verified native-body adoption

```bash
php scripts/migrate.php adopt-bodies --dry-run
php scripts/migrate.php adopt-bodies
```

The operator-approved `body-native-v1` contract recognizes the current native
catalogue as authoritative. It adopts only `migrate_unified_bodies_v1.sql`
and `migrate_unified_bodies_v2_hardcut.sql`, without executing the obsolete
uninhabited legacy-planet import. Existing native and legacy-prefixed body
identities are preserved, not rewritten, deleted, merged or duplicated.

Required column types/nullability, InnoDB, complete identity indexes and
parent/colony foreign-key rules are validated. Colony and report identities
are locked and checked for missing body references; linked legacy planets
must agree with the native planet's coordinates. Null spy targets remain
allowed. Old report identity columns must already be retired. Self-parented
bodies, inconsistent mappings, missing indexes/constraints, source drift
and unknown provenance reject adoption explicitly.

This contract intentionally does **not** require a body for every uninhabited
legacy planet. The accepted policy, schema hash and colony/report identity
hash are recorded with the common adoption provenance. CLI status and
verification check the body-specific policy/schema evidence; rollback cannot
execute SQL against adopted history.

On 2026-11-07, local adoption preserved 566,764 bodies, 47 colony mappings,
44 NPCs and three human accounts. No body import or gameplay mutation occurred.
History now contains 14 executed, 4 adopted and 67 pending entries.

Final actor/body adoption and advisory-lock acceptance passed 36 real MySQL
tests / 209 assertions, including source/policy drift and rollback rejection.
The runner/CLI/health suite passed 148 tests / 550 assertions. Targeted PHPStan
and the new body-contract PHPCS checks passed. Repeated live dry-run adopted
zero entries and reproduced the same identity/schema hashes; liveness is 200,
while full readiness remains 503.

Legacy-v2 remains blocked separately. A schema-only audit against an isolated
copy found added redundant colony indexes, a differently named equivalent
planet/system foreign key, a leader-column charset declaration normalization,
and recreation of `users.is_npc`. That initial audit was not full data/seed acceptance:
V2 includes achievement catalogue inserts, legacy colony/inventory mappings
and other schema surfaces. No V2 adoption was inferred from table existence,
and no old SQL or tracking checksum was changed.

### Full Legacy-v2 postcondition audit (2026-11-07)

A subsequent audit copied all table definitions and a consistent read-only
snapshot of the 27 V2 data surfaces (205,807 rows) into an isolated replay
database. The large native-body catalogue was not copied or mutated; its
definition was present only to keep reference metadata local. The immutable
V2 source was pinned by LF-normalized SHA-256:
`ae261cb047830139909ebe3266df78dfad5a237718ae0a546ede5940b8cff262`.
Only the `USE galaxyquest` statement was omitted in the isolated replay.

All 306 remaining statements succeeded. Complete original-column row counts
and strict UTF-8 SHA-256 hashes were identical before/after across all 27
copied tables, not merely aggregate resource totals. V2 still recreated the
retired actor flag and added duplicate-name-equivalent planet/system and
inventory indexes. No V2 statement was executed on the live connection.

Separately, V2's CREATE/ADD declarations built an empty independent reference
schema. This bypasses the misleading `CREATE TABLE IF NOT EXISTS` no-op:
an existing but incomplete table is **not** proof that V2 is satisfied.
Required columns, defaults, complete index groups and foreign-key groups
were compared by semantics rather than constraint name alone.

| Surface | Finding / reconciliation requirement |
|---|---|
| Actor flag | `users.is_npc` remains intentionally absent; require the adopted current actor contract, never recreate it. |
| Native colonies and inventory | Nullable legacy planet identity, retired planet FK/unique key, mandatory colony references and native body uniqueness reflect later models. Buildings/ships have covering composite indexes rather than V2's redundant standalone index; a future contract must verify complete prefixes and current constraints explicitly. |
| Star, resource, faction and event types | `WD`, fractional deposit precision, `envoy` and `archaeological_find` are later schema extensions, not permission to narrow types by replay. |
| Achievement catalogue | All 13 stable codes exist with identical categories, titles, rewards and ordering. Three descriptions say `colonies` instead of `planets`, matching the current base schema and colony-based achievement evaluator. No seed insertion or reward rewrite is needed. |
| Quest catalogue | Four genuine missing columns: `active`, `template_code`, `generated_by_npc`, `generated_timestamp`. The existing pending `migrate_npc_daily_quests_v2.sql` is the repair path; V2 replay does not add them to an already-existing table. |
| Quest JSON defaults | `requirements_json` and `progress_json` have no default, matching the current base schema's explicit-input contract rather than historical V2's `{}` expression. Do not silently change this policy during adoption. |
| Faction icon default | Live default bytes are `C3B0C5B8E28098C2BE`, a mojibake variant of the source's `F09F91BE`. MySQL's `information_schema.COLUMNS.COLUMN_DEFAULT` also returns `?` for supplementary Unicode defaults, confirmed with an isolated hex-literal probe; use exact DDL/bytes when proving this surface, not that metadata value alone. No live icon/default rewrite was performed. |

Buildings, ships and fleet origins had zero missing colony references;
colonies had zero missing owners. All four legacy backfill input columns
(`planets.user_id`, `buildings.planet_id`, `ships.planet_id`,
`fleets.origin_planet_id`) are retired, so their backfills are superseded,
not a reason to infer ownership from astronomical planets again.

The existing daily-quest migration was tested against both an old catalogue
missing the four fields and the current base schema. First apply, second
runner no-op and direct SQL repeat preserve every original catalogue field;
the four templates exist exactly once, no player quest or generation-log
entry is created, and no retired actor flag is added. Together with the
existing V2/current-base and legacy-backfill cases: four real MySQL tests /
60 assertions passed. This does not activate the unwired generator.

V2 is still pending: this audit establishes evidence and genuine repair
prerequisites, not an adoption contract or permission to stamp history.
At the end of the audit, live history was 14 executed, 4 adopted and 67
pending, with readiness 503. Additional live repair required an explicitly
scoped deployment.
Both isolated databases and the supplementary-Unicode probe were removed.

### Approved local quest-schema repair (2026-11-07)

The operator subsequently approved applying only the existing
`migrate_npc_daily_quests_v2.sql`. Before deployment, the three existing
affected tables (`faction_quests`, `schema_migrations`,
`schema_migration_adoptions`) were backed up and the persisted copy's SHA-256
was verified. `quest_templates` and `npc_quest_generation_log` did not yet
exist.

A temporary scoped manifest contained the 18 already-tracked entries plus
this one approved migration, preserving canonical order. The existing runner
preflight selected exactly that file; 20 statements executed, a repeated Up
was a no-op, and scoped verification validated all 19 entries. Every original
tracking row/checksum was unchanged. This scoped verification is **not** full
manifest readiness or adoption of the other historical scripts.

All original fields of the 28 catalogue rows were unchanged. Four missing
columns now have the migration's canonical definitions; four templates were
seeded once, and the generation log is empty. The 47 actor identities and
566,764 native bodies were preserved; no player quest was created, no NPC
generator was wired, and no icon/JSON-default policy was changed.

Current local history: **15 executed, 4 adopted, 66 pending**. Liveness
remains 200; full readiness remains 503. Legacy-v2 still requires a tested
explicit postcondition/adoption contract for superseded schemas, seeds and
the icon-default discrepancy. Temporary deployment helpers were removed;
the pre-deployment backup remains outside the repository.

### Verified current Legacy-v2 adoption

```bash
php scripts/migrate.php adopt-v2 --dry-run
php scripts/migrate.php adopt-v2
```

`LegacyV2MigrationAdoption` adopts only `migrate_v2.sql`, never executes it,
and uses the same advisory lock and atomic evidence/tracking mechanism as
actor/body adoption. Its source and generated schema descriptor are pinned
by LF-normalized SHA-256. The descriptor was generated in an isolated
reference schema from all V2 CREATE/ADD declarations: 27 tables, 284 introduced
columns, complete grouped indexes/foreign keys and 13 achievement seeds.
It is not a snapshot of the live schema, and is not a gameplay migration.

The contract first validates the current actor and native-body contracts,
then every required InnoDB table, introduced column type/nullability/default,
collation and extra properties. Known later models are explicit:
`WD`, fractional planet deposits, `envoy`, `archaeological_find`, mandatory
colony inventory/origin references, native colony body identity, colony-based
achievement descriptions and explicit quest JSON inputs. The original leader
role set or its later `advisor` extension is accepted, not arbitrary enum
changes. Additional later columns are allowed; missing required fields are
not.

Index names are not authoritative: nonunique lookups may use a complete
visible leading prefix of a unique composite index, but required uniqueness
must cover exactly the complete original column group. Column order,
prefix lengths and visibility matter. Foreign keys must have the complete
required column group and delete/update rules and remain within this
database. Native-body identity replaces the old unique/cascading colony
planet relationship. Inventory and fleet origins must still reference real
colonies, and the retired ownership/backfill input columns must be absent.

Every V2 data table is read under row locks and hashed without persisting
row contents. User locks precede colony locks; current body/report proofs
are reused. All 13 seed codes and original fields are checked, with only the
three documented colony-description substitutions. Quest requirements and
progress must be explicit JSON objects; invalid JSON, arrays, incompatible
defaults or missing fields reject rather than silently substituting `{}`.
Evidence records table counts/hashes, schema hash and actor/body identity
hashes. Stored JSON key order is canonicalized before proof validation
because MySQL reorders JSON object keys. Status and verify validate evidence;
rollback cannot execute historical SQL against adopted V2.

The approved icon policy requires the correct supplementary-Unicode default.
`migrate_npc_icon_default_v1.sql` is an additive, repeatable repair of **only**
the NPC faction icon default for future inserts. It does not overwrite any
existing faction row, regenerate factions, enable quests or launch battles.
Proof uses exact `SHOW CREATE TABLE` default bytes rather than MySQL's lossy
`information_schema` representation of supplementary characters.

Before deployment, the live dry-run rejected the uncorrected icon default explicitly.
Neither this new migration nor V2 adoption is implicitly authorized by the
previous quest repair; use a separately scoped deployment with backup.
Until applied and verified, the canonical manifest also includes this new
pending repair entry, and full readiness remains blocked.

Local acceptance: 89 V2/CLI/advisory-lock tests / 499 assertions, plus five
additional structural/provenance cases / 52 assertions; 26 existing actor/body
tests / 119 assertions; 129 runner/CLI tests / 471 assertions and 22 health
probe tests / 88 assertions passed. These selectors overlap and their totals
must not be added as a unique test count. Targeted PHPStan and the new contract
PHPCS gate passed; immutable migration checks verified 83 baseline files and
three append-only additions.

### Approved local V2 adoption deployment (2026-11-07)

After separate operator approval, the exact affected tables
`npc_factions`, `schema_migrations` and `schema_migration_adoptions` were
backed up; persisted and container backup SHA-256 hashes agreed.
A bounded manifest containing the 19 existing tracked entries and only the
new icon repair selected exactly one statement. First Up executed it, second
Up was a no-op, and scoped verification validated all 20 records.

The full canonical runner then previewed and adopted only `migrate_v2.sql`
through `adopt-v2`. Its 27-table evidence was identical before adoption and
in a subsequent zero-candidate dry-run. V2 SQL was never replayed. Evidence
and the `ADOPTED` tracking record committed together; all 19 prior tracking
rows and four prior adoption proofs were unchanged.

The 32 existing faction rows/icons, 44 NPCs, three human accounts and
566,764 bodies were preserved. Only the future-insert faction icon default
changed. The recorded V2 schema SHA-256 is
`edfd931b3c39cf84d71dbe4e34ec3f89d65acba59c9a82be073fe9f5d9ca7efd`;
the complete table-snapshot identity SHA-256 is
`c81c26e5900d0caa3282ecc3154f314e067cc27e12de979f92d57c00696ac42b`.

Current local history: **16 executed, 5 adopted, 65 pending**. Scoped
verification does not claim full-manifest readiness; no other pending
migration was executed. Liveness remains 200; readiness remains 503.
No gameplay phase, NPC generator or LLM control was activated. Task-owned
reference schemas/helpers/caches were removed; the backup remains outside
the repository.

### Approved local gameplay/politics deployment (2026-11-07)

Unlike V2/actor/body reconciliation, all ten tables introduced by
`migrate_gameplay_model_v1.sql` and `migrate_politics_model_v1.sql` were absent
locally. Their postconditions did not already exist: adoption would falsely
claim satisfied history. These scripts therefore required actual execution.

The operator explicitly approved both migrations after reviewing their
behavioral impact: the original politics seed assigns **all** existing
accounts, including engine-controlled NPCs, the same baseline
`adaptive_humans` / `stellar_republic` profile and the `meritocracy` and
`adaptive_bureaucracy` civics. This is a separate internal politics/effect
profile, not an overwrite of actor control, faction-specific FTL or existing
character data. The already-wired `empire_dynamic_effects()` reader now
returns the following baseline for those accounts:

| Effect field | Baseline |
|---|---:|
| `resource_output_mult` | +0.06 |
| `food_output_mult` | +0.03 |
| `pop_growth_mult` | +0.08 |
| `research_speed_mult` | +0.06 |
| `happiness_flat` | +8 |
| `public_services_flat` | +4 |
| `faction_pressure_mult` | -0.20 |
| `faction_pressure_score` | 50 |
| `fleet_readiness_mult`, `unrest_active` | 0 |

These are the engine's dynamic-effect read-model values; deployment itself
does not simulate time, recalculate balances, advance situations, start a
battle or run NPC/LLM generation. Future consumers apply the values through
their existing rules; this is not a claim that every economy path or timer
uses every field.

Before deployment, users, colonies and both tracking/provenance tables were
backed up and persisted with matching SHA-256. A temporary bounded manifest
contained the 21 existing tracked records plus exactly the two approved
files in canonical order. The runner executed 9 gameplay statements and
13 politics statements; repeated Up was a no-op. Scoped verification
validated all 23 entries, not the whole canonical manifest.

All 21 previous tracking rows and five adoption proofs were unchanged.
The complete V2 schema/data evidence was identical before/after:
`c81c26e5900d0caa3282ecc3154f314e067cc27e12de979f92d57c00696ac42b`.
All 47 actor identities and 47 colony rows, including balances and
`last_update`, were unchanged.

Created state: 188 baseline internal-faction rows, 47 empire profiles,
94 civic assignments, three species, three governments and four civics.
Situations, stage logs, approval history and dynamic modifier records
remain empty. A separate read-only check verified the exact above effects
for all three human and 44 NPC accounts, without mutating colonies or
creating history.

Four real MySQL tests / 89 assertions cover fresh install, runner/direct
SQL repeats, exact human/NPC defaults, preservation of customized profiles,
faction approval and situation history, plus actual engine-effect and
SELECT-only situation-runtime behavior. Catalog seed upserts intentionally
restore their original definitions; customized player assignments/history
are retained. Historical SQL was not edited.

Current local history: **18 executed, 5 adopted, 63 pending**. Liveness is
200; full readiness remains 503. Both APIs reject unauthenticated requests
with 401. No new scheduler, combat phase or NPC controller was activated.
Only inspected task-owned helpers were removed; the backup is retained
outside the repository. The remaining economy history is the next
reconciliation block, not implicitly covered by this approval.

### Economy postcondition audit (2026-11-07)

The next six pending sources were audited without executing SQL against the
live database: economy V1/V2/V3, policies V1, shortage V1 and empire categories
V1. All source hashes were recorded. Two isolated schemas were used: a
consistent copy of the existing economy data, and an empty reference built
from the original SQL in canonical order. Both schemas were removed after
the audit; evidence is retained outside the repository.

The eleven existing economy tables contain 93 rows: 54 processed-good
inventories, 15 population-class records, 23 market rows and one policy.
All required column types, nullability, defaults, indexes and foreign-key
metadata match the independent ordered reference. In particular, all three
V2 rate/timestamp columns, all five V3 satisfaction columns, both history
tables and the shortage log are present. The 39-statement six-source replay
preserved every existing row's original-column SHA-256; its only structural
additions were the three absent category/espionage tables.

**Policy units must not be inferred from the later CREATE statement.**
Economy V1 creates `global_policy VARCHAR(32)`, fractional `DECIMAL(5,4)`
taxes, `tax_production` and boolean subsidies. The later policies script's
`CREATE TABLE IF NOT EXISTS` cannot replace that existing table with its
integer/whole-percent alternative. The live layout exactly matches the
canonical V1-first result, including the later lookup index. A separate
standalone policies reference proves that the alternate integer layout
exists only when that script creates the table first. The current
`OnDemandEconomy` reader supports both layouts through column-type
introspection; no conversion or policy/balance change was performed.

A replay is **not** a zero-mutation adoption operation: the 23 market
`INSERT IGNORE` attempts preserve evolved seed rows but advance the MySQL
auto-increment sequence. Reconciliation should validate market key coverage
without restoring prices, supply, demand or timestamps to seed defaults.
The multi-column V2/V3 guards are also insufficient proof: a marker column
can exist while a sibling is missing, and the runner then records successful
execution without repairing it. Future adoption must validate every sibling,
not just the marker or source checksum. Existing live siblings were checked
individually and are complete.

**Category/espionage deployment is deferred.** All three target tables are
absent, so adoption would be incorrect. Although the migration itself creates
them successfully and seeds no rows, the current APIs are incompatible:

- Both espionage readers and mission assignment use `completes_at`; the
  historical schema provides `resolves_at` instead.
- The API expects terminal `completed`, but the schema permits
  `active/success/failure/captured`.
- The API accepts `military_recon`, absent from the SQL mission enum.
- The API supplies a one-hour completion time, while the schema declares
  four-hour defaults. Creation alone does not decide the authoritative
  duration or establish a working mission lifecycle.

Five new real MySQL tests / 84 assertions cover original-script repeat preservation of
customized inventories, population, policy and evolved market state;
the exact 23-ID sequence advance; the standalone integer policy layout;
both incomplete-marker counterexamples; and the category schema's concrete
unknown-column error for the current API projection. The existing canonical
on-demand economy integration test also passes. The counterexample tests
document immutable legacy behavior, not acceptance of a partial schema or
authorization to enable espionage.

No live migration or adoption was performed in this block. History remains
**18 executed, 5 adopted, 63 pending**. No settlement, market reset,
population initialization, scheduler, battle phase or NPC/LLM activation
was introduced. A dedicated economy adoption contract and operator approval
are still required; category/espionage needs separate runtime reconciliation.

### Verified ordered economy adoption

```bash
php scripts/migrate.php adopt-economy --dry-run
# Only after backup and explicit deployment approval:
php scripts/migrate.php adopt-economy --env=DEV
```

`adopt-economy` covers exactly the five economy/policy/shortage sources;
`migrate_empire_categories_v1.sql` is excluded. It uses contract
`legacy-economy-ordered-v1` and policy
`preserve-string-fractional-policies-evolved-markets-no-replay`.
Each source has an LF-normalized SHA-256 pin. The independent descriptor
[`economy_schema.json`](../../lib/migration_contracts/economy_schema.json)
was generated by executing those five immutable sources, in canonical order,
in an empty MySQL 8.4 reference with `utf8mb4_0900_ai_ci`; no live table
definitions or data were used to construct it. Its pinned SHA-256 is
`aae751126750f0359b85c4f07da0ea983fc8432c86c025076fc5f3e0e4b6d046`.

The contract requires all eleven InnoDB tables, every original column's
exact type/default/nullability/extra/collation and the audited policy layout.
All rate and satisfaction siblings are checked. Shared semantic index
validation also used by Legacy V2 requires exact unique groups and complete
visible lookup prefixes, never truncated columns; index names are irrelevant.
Unaudited economy foreign keys are rejected rather than silently accepting
different deletion semantics. An integer policy layout requires a separate
audit/contract, not conversion by this command.

Under the existing database-scoped migration advisory lock, validation
locks users before colonies, then snapshots all economy rows by ID with
`FOR UPDATE`. Table reads retain transactional metadata locks while their
schema is inspected. All 23 original market keys must be present; evolved
prices, supply, demand, timestamps and extra future goods remain untouched.
The proof records per-table row counts/hashes and aggregate schema/data
hashes, not raw account or gameplay data.

Dry-run writes no tracking, provenance or gameplay state. Actual adoption
records only currently pending covered sources; existing executed/adopted
records are preserved. The five provenance/tracking pairs commit together
in InnoDB; a failure on the third tracking write rolls back the entire
batch and permits a clean retry. No historical DDL, seed insert, settlement
or auto-increment allocation in economy tables takes place. The operator
environment remains in provenance, while tracking uses reserved `ADOPTED`.

Status, Up and deployment verification reject missing/incompatible source
pins, descriptor/policy drift and corrupt table/hash evidence. MySQL JSON
key reordering is canonicalized before verifying snapshot hashes.
Adoption remains point-in-time proof: future valid gameplay can change
market rows without invalidating historical evidence. A repeated adoption
revalidates current schema/data but never rewrites prior proof. Adopted
history cannot be rolled back through historical down scripts.

Acceptance: 44 focused tests / 449 assertions cover economy rejection,
five-file atomic retry, corrupted proof, existing executed subsets, CLI
failures and Legacy V2 schema/index regressions. A separate final selector
passes 152 runner/CLI/lock/preservation tests / 672 assertions; selectors
overlap and are not a combined test count. Targeted PHPStan level 5 and
PHPCS for both contracts, the shared index helper and CLI unit tests pass.
Immutable-history and whitespace checks pass. Pre-existing runner/CLI and
integration-test PHPCS findings are not globally reformatted.

The local dry-run validates all 93 economy rows and reports five candidates.
Schema hash: `4a824ffa240cbae13fd6c52b01c31bdee4eb23afb1f6427d314a19f13fd4c917`;
data hash: `8e9591ecd5eac9f8687d8290cb4b8310a7ce9f269cddee102d7433308d5edf81`.
This preview is not deployment approval and does not reconcile the remaining
category/espionage or other pending migrations.

### Approved local economy adoption deployment (2026-11-07)

After reviewing the successful dry-run and tests, the operator approved
**backup-and-adopt** for exactly the five covered economy sources.
Category/espionage was explicitly excluded. A consistent dump of 19 exact
tables was persisted and its SHA-256 matched the database-container copy
before adoption: users, colonies, all fifteen economy/ledger tables and
both migration tracking/provenance tables. Backup size: 65,877 bytes.

A temporary bounded manifest contained the 23 previously tracked canonical
records plus the five approved candidates. `adoptEconomyHistory(false)`
committed exactly five new provenance/tracking pairs, without executing
historical SQL. Scoped verification validated all 28 records; repeated
adoption preview returned zero candidates with identical current evidence,
and scoped Up was a no-op. This scoped result is not full-manifest readiness.

All 93 legacy economy rows, their auto-increment/schema definitions, the
modern colony ledger/precision/market/construction data, all 47 user and
colony rows (including balances and `last_update`), and all 23 original
tracking rows/five original adoption proofs were unchanged. Economy schema
and data hashes remain the successful preview values above.
The fresh complete V2 snapshot taken for this deployment was also identical
before/after:
`1b882d0025c26125400a8fc7c6e6db5e79b2ddea2b476ce916875dd72cfbd3e7`.
This is a new point-in-time comparison, not a rewrite of the earlier V2 proof.

Local canonical history is now **18 executed, 10 adopted, 58 pending**.
Liveness is 200 and full readiness remains 503. No settlement, policy
conversion, seed replay, market reset, scheduler, battle phase or NPC/LLM
activation occurred. Only explicitly resolved task-owned helpers, reference
schemas and type-check cache were removed; backup and deployment evidence
remain outside the repository.

### Category/espionage infrastructure with explicit runtime gate

The operator selected **infrastructure-gated**, not implementation or
activation of a new espionage lifecycle. The three historical category/
agent/mission tables remain the intended additive infrastructure. They are
absent locally and therefore require execution, never adoption. Historical
SQL is unchanged; no compatibility column, status conversion, seed,
mission resolver, credit debit rule or scheduler is introduced.

The retired espionage handlers used incompatible columns/statuses, could
insert agents without actually spending their advertised credits, and had
no mission resolver. Their unreachable gameplay implementation is removed
rather than kept behind a user-toggleable flag. All four existing actions
in `api/espionage.php` and `get_espionage_status` in `api/empire.php` use the
shared `require_espionage_runtime()` gate:

- Authentication still precedes action dispatch.
- Existing method restrictions and mutation CSRF checks remain in force.
- Valid authenticated requests return HTTP 503 with an explicit
  `success:false` error explaining the pending mission-lifecycle integration.
- The gate cannot be enabled by configuration and performs no DB access,
  agent insert, mission assignment or result mutation.
- Unknown actions still return 400. Wrong methods, missing authentication
  and invalid CSRF retain their previous rejection semantics.

Empire score/breakdown GETs retain the existing pure read-only calculation;
they do not persist score snapshots or trigger missions. Empty infrastructure
means there are no agents and the existing espionage score is zero, not an
activated new score multiplier. All documented future operational rules
remain unimplemented and require a separate design decision.

Acceptance: 28 targeted tests / 127 assertions pass for executable gate
fixtures with database access forbidden, authentication/method/CSRF
precedence, existing score-read behavior and real MySQL migration repetition.
The migration test proves customized score, agent and terminal mission rows
survive an original SQL replay with unchanged values. It also retains the
counterexample showing why the retired `completes_at` projection could not
work against the immutable historical schema. Actual local migration
execution requires backup and separate explicit operator approval.

### Approved local category infrastructure deployment (2026-11-07)

The operator explicitly approved **backup-and-execute** after selecting
infrastructure-only with blocked espionage. All three target tables were
confirmed absent. Users, colonies and both migration tracking/provenance
tables were backed up, persisted and verified against the database-container
dump by matching SHA-256 before execution.

A temporary bounded manifest included the 28 existing tracked records and
exactly `migrate_empire_categories_v1.sql`. The runner executed its three
CREATE statements; all three new tables are empty InnoDB infrastructure.
Scoped verification validated 29 records and repeated Up did nothing.
All 47 user rows, 47 colony rows including balances and `last_update`,
28 original tracking rows and ten original adoption proofs retained identical
complete row hashes.

HTTP acceptance exposed a tightly coupled pre-existing import error:
`api/empire.php` included the CLI projector, whose shebang/strict-types header
and CLI-only bootstrap abort under HTTP before authentication or the gate.
The unchanged score formulas and persistence helper were extracted into
[`lib/empire_scores.php`](../../lib/empire_scores.php), now shared by the
API and projector. The API never loads/runs the worker; the worker's own
bootstrap and explicit persistence behavior remain unchanged. Executable
gate fixtures reject any worker import or database access. Existing score
formula/upsert and projector preflight/read-only tests pass.

Final acceptance: **55 tests / 319 assertions**, targeted PHPStan level 5
for the changed endpoints/shared score library, PHPCS for new shared libraries
and gate tests, immutable-history and whitespace checks pass. Live
unauthenticated requests to both espionage endpoints return 401, rather
than the former HTTP-200 fatal output from the Empire worker import.
Authenticated valid espionage actions are covered by the executable 503
gate fixtures; no live agent/mission was created to test them.

Local history is now **19 executed, 10 adopted, 57 pending**.
Liveness is 200; full readiness remains 503. The runtime gate has no
configuration bypass. No NPC/LLM controller, espionage resolver, battle
phase, scheduler or new score-effect rule was activated. Persisted backup
and deployment evidence are retained outside the repository; named helpers
and scoped manifest are removed after verification. Auth/RBAC history is
the next reconciliation block, not covered by this execution approval.

### Verified auth adoption and separate RBAC infrastructure

The three pending authentication sources already have complete local
postconditions: `migrate_security_v1.sql`, `migrate_security_v2_totp.sql`,
and `migrate_admin_user_crud_v1.sql`. An empty independent MySQL reference
executed the original 1/22/11 statements against a minimal `users` prerequisite
with only ID and the two column-position anchors. Its database collation was
explicitly `utf8mb4_unicode_ci`, matching the audited historical auth layout.
No live credentials or table definitions were used to generate
[`auth_schema.json`](../../lib/migration_contracts/auth_schema.json).
Descriptor SHA-256:
`550ad2c2a800196ac36789ba32bc71322cb11e3bb59d34be3e4c639f39aec7e2`.

```bash
php scripts/migrate.php adopt-auth --dry-run
# Only after backup and explicit approval:
php scripts/migrate.php adopt-auth --env=DEV
```

Contract `legacy-auth-current-v1` pins all three source hashes and preserves
accounts, TOTP material, pending challenges and IP lockouts. It validates
all five introduced user fields and the complete visible soft-delete index,
not just `deleted_at` as the historical guard does. Both auth tables require
exact introduced columns, InnoDB, complete visible primary/lookup keys and
the database-local single-column TOTP-session FK with exact deletion/update
rules; orphan pending sessions reject adoption. Other modern user columns
are allowed. No conversion, login, setup, challenge consumption, account
deletion or lockout expiry occurs.

The database-scoped migration advisory lock and one transaction cover
user-first row locking, complete hash snapshots and atomic tracking/proof
insertion. Proof contains counts/hashes only, never credential or token
values. Dry-run creates no adoption storage. The reserved `ADOPTED` marker
distinguishes proved history from actual execution; repeated adoption keeps
original proofs. Status/Up/verify reject corrupt source or proof metadata,
and rollback cannot execute adopted down history. Future account/lockout
changes do not invalidate the original point-in-time proof.

The four RBAC tables are **absent** locally and cannot be adopted.
`migrate_rbac_v1.sql` executes eight statements: four CREATEs, five group
seeds, six profile seeds, profile inheritance and five group/profile links.
It creates **zero** user/group assignments and does not change `users.is_admin`,
actor control or login flags. Current runtime authorization still reads
`users.is_admin`; no RBAC consumer, inheritance evaluator or account
assignment is wired by this block.

Original RBAC SQL repeats intentionally restore system group/profile
catalogue values and inheritance, while preserving user assignments. It
must therefore not be blindly replayed over a customized installed catalogue.
Real MySQL tests verify the complete inheritance map, no baseline assignments,
unchanged admin flags, preservation of existing assignments on repeat,
restoration of canonical profile JSON and FK cleanup semantics.

Acceptance: **105 tests / 552 assertions** pass across auth adoption,
schema/index/FK/orphan rejection, whole-batch rollback/retry with an earlier
executed record, changed-source/corrupt-proof rejection, future lockout
updates, CLI and migration concurrency exclusion, and RBAC installation/
repeat behavior. Targeted PHPStan level 5 and PHPCS for the new contract/CLI
unit tests pass; immutable-history and whitespace checks pass.
The local read-only preview reports three auth candidates over 47 accounts
and empty lockout/challenge tables. No real credential or role was changed.
Actual adoption and separate RBAC execution still need explicit approval.

### Approved local auth/RBAC deployment (2026-11-07)

The operator approved **backup-adopt-and-execute** for the three verified
auth histories plus the absent RBAC infrastructure. Seven exact tables were
backed up: users, colonies, login attempts, pending TOTP sessions, remember
tokens and both migration tracking/provenance tables. The 48,016-byte dump
was persisted outside the repository and its SHA-256 matched the
database-container copy before writes.

A temporary bounded manifest contained all 29 previous tracked records
plus the three auth candidates and `migrate_rbac_v1.sql`. The runner first
committed the three auth provenance/tracking pairs atomically, with no
historical auth SQL execution. It then executed exactly the eight RBAC
statements. These are separate operations: MySQL RBAC DDL is not presented
as part of an atomic all-four-migration transaction.

Scoped verification validated 33 records. Repeated auth preview returned
zero candidates and identical current evidence; repeated scoped Up was a
no-op. Complete existing row and DDL hashes confirmed preservation of all
47 accounts, 47 colonies including balances/`last_update`, lockouts, TOTP
material/challenges and remember tokens. All 29 previous tracking records
and ten original adoption proofs were unchanged.

New RBAC state is five groups, six profiles and five group/profile links;
user/group assignments remain empty. No admin flag, control type, login
flag or authorization consumer was changed. Existing runtime authorization
still uses its current admin checks; this deployment does not implement
RBAC evaluation or connect NPC/LLM commands to privileged groups.

Local canonical history is now **20 executed, 13 adopted, 53 pending**.
Liveness is 200 and full readiness remains 503. Unauthenticated `auth/me`,
TOTP status and admin-user list requests return 401. No actual login,
TOTP setup or challenge consumption was performed to verify deployment.
In addition to the 105 focused tests / 552 assertions above, a final
148 runner/CLI/auth-contract tests / 539 assertions pass (selectors overlap).
Targeted type/standards and immutable-history checks pass.

Backup and before/after audit evidence remain outside the repository.
Only explicitly resolved task-owned reference schema, scripts, scoped
manifest, temporary dump copy and type-check cache were removed.
No scheduler, combat phase, espionage action or NPC/LLM controller was
activated. Colonization history is the next pending reconciliation block,
not covered by this approval.

### Colonization audit and read-only runtime preparation (2026-11-07)

All five V1 tables (`sectors`, `sector_systems`, `governors`, `empire_edicts`,
`empire_sprawl_cache`) and V2's three colony fields (`phase`, `sector_id`,
`energy_balance`) are absent locally. These histories require actual
execution, not adoption. The already-tracked colony-buildings migration is
not replayed.

The operator selected **infrastructure-readonly**. All nine recognized
administration mutations now reject with 503 after authentication, POST
validation and CSRF, before database access. The five GET actions remain
read-only; no configurable switch exposes the unfinished commands.
Native-system sprawl counts distinct `(galaxy_index, system_index)` pairs,
not coordinates alone. Different galaxies sharing a system coordinate count
separately, while multiple bodies in one system count once.

This does not activate governor commands, autonomous sectors, salary/edict
debits, sprawl gameplay penalties or colony growth integration. Existing
mutation implementations remain unreachable through the API: native system
identity, MySQL-incompatible insertion, transactional reassignment and
unchanged-value upserts must be corrected before any future command rollout.
Historical tick wording is not approval for a periodic engine.

Real MySQL fixtures execute both original sources against an isolated native
schema, omitting only `USE galaxyquest` routing in the test copies. Exact
population boundaries produce phases `[0,0,1,1,2,2,3,3,4]` for populations
`[0,500,501,2000,2001,10000,10001,50000,50001]`. Original colony fields,
stocks and timestamps survive unchanged; infrastructure is empty,
`sector_id` is null and `energy_balance` defaults to zero. Read-only MySQL
transactions verify pure sprawl/edict reads with non-coordinate system IDs.
V2 adds its foreign key unconditionally: raw SQL replay fails with a duplicate
constraint, whereas verified tracked Up is a no-op. Do not replay V2 directly
or rewrite the immutable source to hide that hazard.

Acceptance passes 78 tests / 235 assertions, targeted PHPStan and the new
executable gate-test PHPCS check. Immutable migration history remains valid.
Deployment is still subject to separate backup-and-execute approval: the
current 47-colony snapshot implies two Phase-1 colonies and 45 Phase-0
colonies. Initial zero energy balances are placeholders, not newly settled
or calculated energy. No live migration has been executed by this preparation.

### Approved local colonization deployment (2026-11-07)

After separate **backup-and-execute** approval, a consistent six-table dump
preserved accounts, colonies, colony-building slots/upgrades and both
tracking/provenance tables. The 47,876-byte dump was persisted outside the
repository; its SHA-256 matched the database-container and staged web-container
copies before execution. Prepared full original-column hashes and source pins
were rechecked immediately before writes.

The bounded manifest contained all 33 previously tracked canonical sources
plus V1/V2. Exactly six V1 and 19 V2 statements executed; no other pending
source or historical SQL was replayed. MySQL DDL is not claimed atomic.
All five infrastructure tables are empty. The 47 colonies now contain
45 Phase-0 rows and two Phase-1 rows, with null sector assignments and zero
energy placeholders. The colony-sector index and SET NULL foreign key are
present.

Full original-column hashes preserve 47 accounts, 47 colony/body mappings,
balances/timestamps, building slots/upgrades, all 33 previous tracking rows
and all 13 adoption proofs. Existing non-colony table definitions are
unchanged apart from the expected tracking-table AUTO_INCREMENT advancement
for the two new records. The first post-check stopped on that sequence-only
DDL hash difference; a subsequent check proved the original tracking
definition after restoring only its original sequence declaration for the
comparison. This validation correction did not replay migration SQL.

Scoped verification accepts 35 records; repeated Up is a no-op. All five
GET handlers were exercised against the live schema inside read-only
transactions with fixture authentication: four return 200; missing sector
detail returns 404. Sector/governor lists are empty and all six edicts are
inactive. Actual unauthenticated colonization GET/POST requests return 401;
no login, administration command, growth settlement or gameplay-cost debit
was performed.

Local canonical history is now **22 executed, 13 adopted, 51 pending**.
Liveness remains 200 and full readiness remains 503. Acceptance remains
78 tests / 235 assertions; a final runtime-only subset passes 76 tests /
206 assertions (overlapping selectors), with targeted type/standard and
immutable-history checks passing. Backup and before/after hash evidence
remain outside the repository. Temporary deployment/read fixtures, bounded
manifest, container dump copies and type-check cache are removed.

### Galaxy geometry and visibility audit (2026-11-08)

The immutable orbital migration is pending, but all requested orbital columns
already exist. All 25,090 star systems have complete galactic polar values;
fleets are empty and all six origin/target values are non-null by schema.
Among 566,764 celestial bodies, exactly 15 lack all seven local/polar fields.
The read-only audit did not change live schema or data.

Before approved deployment, the original orbital source was run on a
MySQL-isolated copy containing those 15 affected bodies plus empty star/fleet
tables. Thirteen bodies receive coordinates/radii/angular velocity from
existing orbital data; two have no radius or period source and receive zero
local coordinates, deterministic phase, zero height/velocity, while
`polar_radius` remains NULL. The source preserved every other body field in
the copy, but MySQL's `ON UPDATE` `updated_at` changed on all 15. Those two
radius-less rows still match the raw SQL's `WHERE polar_radius IS NULL`;
replaying the source outside the migration runner would touch them again.
Use tracked Up only.

The `galaxies` table was absent, although `api/galaxy.php?action=galaxy_meta`
queries it directly before its no-row fallback. Isolated execution of the
immutable metadata source showed that `smbh_tidal_radius_ly DECIMAL(8,1)`
rounds its declared/default/seed value `0.15` to `0.2`, contradicting both the
source comment and API fallback. Historical SQL remains unchanged. The new
append-only `migrate_galaxy_metadata_precision_v1.sql` changes the scale to
two decimals and corrects only the original rounded id-1 seed (`0.20` to
`0.15`), preserving other galaxy-specific values. A real MySQL test executes
the original seed plus the correction, verifies the exact type/default/value,
preserves a custom second galaxy and confirms tracked Up is a no-op on repeat.

Fog of War is already executed, with exact tracking checksum match. The
visibility table has 84 rows: all 47 colony-owned systems match `own`
visibility, with no missing owned systems; the other 37 rows are `stale`.
Its user foreign key cascades as specified. No fog migration replay is needed.

### Approved local Galaxy deployment (2026-11-08)

The operator then approved backup-and-execute. An exact 85,935-byte backup of
the 15 full body rows, affected table definitions, all prior tracking records,
adoption proofs and visibility rows was persisted outside the repository;
its SHA-256 matched the container copy before writes. The bounded manifest
contained 35 tracked entries plus exactly the three selected sources.

Exactly 85 orbital, three metadata and two precision-correction statements
were run. All 15 body rows received the audited derived fields and expected
`updated_at` updates; every other stored field remained identical. The two
radius-less bodies remain `polar_radius=NULL` with zero local coordinates,
deterministic phase, zero height and angular velocity. No body/system/fleet
was created or deleted; star-system and fleet coordinate rows were unchanged.
The new galaxy seed has the corrected `DECIMAL(8,2)` radius value/default
`0.15`. Fog visibility rows and the 13 old adoption proofs are byte-for-byte
unchanged. All 35 previous tracking rows are unchanged.

Scoped verification accepts 38 entries and repeated Up executes nothing.
Local history is now **25 executed, 13 adopted, 49 pending**. The focused
MySQL regression passes (1 test / 11 assertions), and append-only history
validation passes. Liveness remains 200 and full readiness remains 503.
The backup and before/after evidence remain outside the repository.

### Vessel-blueprint and FTL history adoption (2026-11-08)

After operator approval, v1-v11 were recorded with the new
`adopt-vessel-blueprints` contract; their historical SQL was **not replayed**.
The contract pins all eleven immutable sources and verifies the required
InnoDB tables, evolved columns, indexes and foreign keys, the exact 27 faction
affinities, all seven level-zero research seeds for current users, both
canonical wormhole routes and the beacon quest. Existing faction definitions
are preserved because v3 uses `INSERT IGNORE`; the deployed records are
already evolved beyond several original seed values.

The FTL race mapping required no changes. The separate v12 NPC mapping remains
pending: it would change ten NPC drives, and no such gameplay-data change was
approved. Vessel hulls, modules, blueprints, built vessels, fleet assignments,
colony events, FTL gates/resonance nodes and wormhole unlocks remain empty.

Before adoption, the 26,162-byte backup of `schema_migrations` and
`schema_migration_adoptions` was SHA-256 verified as
`39008088b397931e488f89d2baff0e1e08b94f28742b5f5fc98b3256aa6f76f5`.
Restoring it to an isolated schema confirmed all 38 old migration rows and
13 old adoption proofs remain unchanged. Exactly eleven adoption rows/proofs
were added. Current local history is **25 executed, 24 adopted, 38 pending**;
repeated adoption is a no-op. Full `verify` and readiness remain blocked by
pending migrations, including v12.

### Combat and war history audit (2026-11-08; read-only)

The next canonical pending entry remains `migrate_vessel_blueprints_v12_npc_ftl.sql`;
the operator's decision to leave its ten NPC drive updates unapplied is unchanged.
No combat/war migration SQL or database writes were performed during this audit.

| Migration | Live finding |
|---|---|
| `migrate_combat_model_v1.sql` | Pending and not adoptable: `battle_reports` lacks all six combat metadata columns and both indexes; `combat_modifiers` and `user_combat_modifiers` are absent. |
| `migrate_combat_v1_wars.sql` | Pending; `wars`, `war_goals` and `peace_offers` already exist with their expected columns, indexes and user/war foreign keys. Existing war state must be preserved. |
| `migrate_npc_wars_v1.sql` | Pending; the live `wars` table already has nullable `attacker_user_id`, `npc_aggressor_faction_id`, its index, and the expected attacker FK. It contains one active NPC-aggressor war, so replaying the DDL is unnecessary. |
| `migrate_war_v3.sql` | Pending and not adoptable: supply-line, attrition and interdiction tables and the three war summary columns are absent. The war API has supply-route/status handlers; no simulation-tick integration was found. |

### War-history adoption contract (2026-11-08)

`adopt-wars --dry-run` validates the existing war schema without writes.
`adopt-wars` adopts only `migrate_combat_v1_wars.sql` and
`migrate_npc_wars_v1.sql`; it does not replay either migration. The
source-pinned contract requires the exact audited InnoDB columns, indexes and
foreign keys, and records schema and row-snapshot hashes for `wars`,
`war_goals` and `peace_offers`. It deliberately excludes v12, the combat-model
migration and war-v3.

The live dry-run confirmed one existing war row and no war-goal or peace-offer
rows. The first approved history write was refused before inserting proofs
because the locally modified `migrate_v2.sql` removed four `faction_quests`
columns and no longer matched its recorded MD5. The authoritative `HEAD`
source's LF-normalized SHA-256 matched the existing V2 source pin, and its
CRLF worktree bytes reproduced the stored MD5 exactly. With operator approval,
the file was restored from `HEAD`; no database checksum or existing proof was
rewritten.

A pre-adoption backup of `schema_migrations` and
`schema_migration_adoptions` was created and successfully restored into an
isolated database (SHA-256
`71dd007fb3d0bf0037ccdd187b7a9984e344d7a15d1ec89d34ee7af18c88080f`).

After restoring the exact source, the approved adoption recorded only
`migrate_combat_v1_wars.sql` and `migrate_npc_wars_v1.sql`. The active
NPC-aggressor war remained unchanged; v12, the combat-model migration and
war-v3 remain pending. History now contains **25 executed, 26 adopted, 36
pending** entries. Repeated adoption is a no-op, and the decision to leave v12
pending is unchanged.

Verification passed: the complete MySQL migration-runner suite (199 tests /
3,154 assertions), migration CLI suite (80 tests / 271 assertions), targeted
PHPStan and PSR-12 checks. The repeated live dry-run adopted zero additional
migrations and reproduced the same schema and identity hashes.

### Local legacy-history audit (2026-11-07)

The local database had 14 tracked canonical migrations after the approved
battle deployment, with 71 historical entries still pending. A full
schema/data copy was audited in an isolated MySQL database using the existing
MigrationRunner and a database account restricted to that copy. Audit SQL
copies removed `USE galaxyquest` and changed the one hardcoded
`table_schema = 'galaxyquest'` predicate to `DATABASE()`. Repository SQL,
live tracking checksums and the readiness gate were not changed.

All 71 pending scripts executed in the copy, but this **does not authorize
production replay or constitute semantic acceptance**:

| Migration | Observed blocker in copied data |
|---|---|
| `migrate_v2.sql` followed by `migrate_actor_model_v1.sql` | V2 recreates the retired `is_npc` column with default zero. Actor v1 then overwrites current controller/authentication identities: 44 NPC accounts became login-enabled humans; humans increased from 3 to 47. |
| `migrate_unified_bodies_v1.sql` | Legacy `body_uid` backfill added 165,743 bodies (566,764 to 732,507). The copied database contained 165,520 legacy bodies sharing an existing native planet slot. |

The actor corruption also invalidates downstream NPC-assignment acceptance,
even though the corresponding statements succeed. Aggregate checks covered
controller/login identity, key table counts and ship totals; they are not
full row-by-row proofs of every migration's gameplay effects.

Underlying deployment paths can install SQL without canonical history:
Docker initdb mounts historical migrations individually, while legacy setup
also has its own SQL list. Table existence alone cannot prove exact migration
execution or unchanged data transformations.

Do not make readiness green by blindly inserting 71 tracking records,
rewriting stored checksums, editing immutable historical SQL, or disabling
the pending-migration check. A reviewed reconciliation/adoption contract
must prove current schema **and data** invariants for superseded migrations,
preserve native body identities and NPC control/authentication, and record
its provenance explicitly before a controlled live deployment.

No historical script was applied to the live database during this audit.
Live tracking remained 14; the 44 NPC identities remained intact. Battle
receipts and the locally enabled legacy journal remain deployed. Full
readiness still returns 503 until reconciliation is implemented and verified.
The audit database, temporary SQL copies and full dump were removed afterwards.

### Legacy battle encounter journal rollout

Apply `migrate_battle_encounters_v1.sql` through the canonical manifest and
verify all three tables use InnoDB before setting `BATTLE_ENCOUNTERS_ENABLED=1`.
The flag defaults to `0` and only adds a journal to existing `legacy-v1`
fleet-vs-colony resolution. It does not activate longer battles, player
commands, LLM decisions or new damage rules.

`battle_encounters` has one unique source fleet identity and one report
acknowledgement; participants record server-owned human/NPC identities and
initial inventories. Two sequenced events capture creation and resolution.
All records commit with losses, loot, diplomacy, messages, fleet return state
and projection dirty writes. Missing/nontransactional tables reject enabled
resolution explicitly; no fallback silently skips the journal.

Historical fleet, colony, body, user and report IDs are intentionally not
foreign keys: return deletes fleets and other lifecycle cleanup must not
erase the journal. The immutable outcome is retained even if the legacy
report is later removed. Participant/event foreign keys protect the journal
itself. No automatic pruning or destructive down migration is provided;
coordinate future retention and account-deletion policy before production
enablement.

Disabling the flag restores legacy resolution for future arrivals without
deleting stored encounters. `resolving` is transaction-local: only completed
`resolved` encounters become visible after commit. This version creates no
separately committed active battles requiring a background drain on rollback.
Read access is participant-only through
`GET api/fleet.php?action=battle_encounter&encounter_id=...`; GET never advances
arrivals, return or NPC simulation. No public observer mode is enabled.

### Idempotent fleet dispatch rollout

Apply `migrate_fleet_dispatch_receipts_v1.sql` through the canonical manifest
before deploying fleet clients that send `request_id`. Verify the manifest
afterwards. The new `fleet_dispatch_receipts` table must use InnoDB; a missing
or nontransactional table rejects keyed requests explicitly rather than
silently launching without deduplication.

The table stores accepted request identities per user, a SHA-256 payload
fingerprint and the original fleet ID/arrival acknowledgement. Receipt and
fleet/resource/ship changes commit together. Completed fleets can be deleted
without deleting receipts; a late retry still returns the original response,
not a new launch. Deleting a user cascades its receipts.

There is no automatic receipt expiry or destructive down migration. Removing
receipts would allow old requests to launch again. Legacy requests without an
ID remain supported, but are not idempotent. Back up and plan capacity/retention
before production rollout; any future retention policy needs an explicit
retry window and rejection of expired identities.

### On-demand colony economy rollout

Keep `ON_DEMAND_ECONOMY_ENABLED=0` while applying and verifying the canonical
manifest. Its final `migrate_economy_on_demand_v1.sql` migration adds the durable
settlement cursor, spatial construction mappings and indexed system/galaxy
market projections. It also adds `users.credits` only if absent (1,000 initial
credits); existing credit balances are preserved.

After `up` and `verify` succeed, enable the flag in the PHP runtime environment.
The first visit initializes each colony without granting historical economic
output; existing primary stocks, class counts and spatial building levels are
retained/reconciled. More than one offline day requires additional snapshot
requests; HTTP 409 on mutations means catch-up is still needed. Macro reads expose
projection age and coverage and never settle every colony.

There is deliberately no destructive down migration. To stop the new path,
disable the flag; do not delete settlement state or reset cursors. This pauses
the new model but is not a semantic rollback of accrued production or spent
credits. Back up before activation and restore that backup if economic effects
must be reversed. Re-enabling after a legacy-mode interval requires an operator
decision about the retained cursor; it is not an automatic model conversion.

```bash
# Show which migrations are applied / pending
php scripts/migrate.php status

# Apply all pending migrations
php scripts/migrate.php up

# Verify the deployed image's full manifest and exact stored checksums without writing SQL
php scripts/migrate.php verify

# Preview (no DB changes)
php scripts/migrate.php up --dry-run

# Apply only the next 3 pending migrations
php scripts/migrate.php up --step=3

# Roll back the last applied migration
php scripts/migrate.php rollback

# Roll back the last 2 applied migrations
php scripts/migrate.php rollback --step=2

# Roll back (dry-run)
php scripts/migrate.php rollback --dry-run
```

Set `GQ_ENV=PROD` (or any label) to tag migrations in the tracking table:

```bash
GQ_ENV=PROD php scripts/migrate.php up
```

### CLI validation and exit codes

Arguments are validated before loading database configuration or connecting.
Commands are exactly `status`, `verify`, `up`, `rollback`, `adopt-actors` and
`adopt-bodies`; unknown arguments (including
misspelled `--dry-run`), extra commands and duplicate options fail with exit 1.
`--step` must be a positive decimal integer within PHP's integer range; zero,
negative, fractional and overflowing values are rejected, never clamped.
The runner also rejects nonpositive step counts for direct callers.
`status` and `verify` reject `--step` and `--dry-run`, since neither has a defined effect.
Options may precede the command. `--env` / `GQ_ENV` must contain 1-20 ASCII
letters, digits, underscores or hyphens, matching the tracking-column capacity;
labels are stored uppercase. `--sql-dir` must identify a readable directory.

`--help` exits 0 without database dependencies. Successful commands exit 0.
Connection, manifest, lock, integrity and SQL failures are reported on stderr
and exit 1 without an unhandled stack trace or success-shaped summary.
CLI diagnostic details are operator-only, not HTTP responses. Programming
errors are not broadly caught as expected operational failures.
Unit subprocess tests use the actual CLI source with isolated configuration,
DB and runner fixtures to verify routing and error exits; they do not replace
the real MySQL migration gate.

---

## Files

| File | Purpose |
|------|---------|
| `scripts/migrate.php` | CLI entry point |
| `lib/MigrationRunner.php` | Core runner class (apply / rollback / status / deployment verification) |
| `config/migrations_manifest.php` | Canonical ordered list of all migration files |
| `sql/schema_migrations.sql` | DDL for the tracking table |
| `sql/migrate_*.sql` | Forward (up) migration files |
| `sql/migrate_*_down.sql` | Rollback (down) migration files (optional) |
| `docs/technical/DATABASE_MIGRATIONS.md` | This document |

---

## Migration Tracking Table

The `schema_migrations` table is created by explicit bootstrap, CLI `status`
and non-preview migration operations when absent. `verify` never creates it:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    migration_name  VARCHAR(255)  NOT NULL,
    applied_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum        VARCHAR(64)   NOT NULL,   -- MD5 of SQL at application time
    environment     VARCHAR(20)   NOT NULL DEFAULT 'unknown',
    execution_ms    INT           NOT NULL DEFAULT 0,
    UNIQUE KEY uq_migration_name (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Read-only deployment integrity gate

Run `php scripts/migrate.php verify --env=PROD` **from the candidate image**
against the target database after reviewed migrations and before admitting
gameplay traffic. Exit 0 prints the verified forward-migration count only when:

1. The tracking table already exists and can be read.
2. Every tracked name belongs exactly to the candidate's canonical manifest.
3. All applied manifest files are readable and their exact MD5 bytes match
   the stored checksums, using the existing Up/Rollback integrity helper.
4. No manifest migration is pending.

Verification holds the same DB-scoped advisory lock (`GET_LOCK`, timeout 0)
as Up/Rollback from before the tracking probe through checksum comparison.
A competing migration, active MySQL caller transaction, missing selected DB,
rights error, drift, pending migration or manifest-foreign history blocks the
gate. The lock is released on success and failure. SQLite unit fixtures have
no advisory-lock equivalent; MySQL behavior is tested separately.

The gate never executes migration or rollback SQL, creates tracking storage,
rewrites checksums, deletes foreign history, or acquires DDL/DML privileges.
A SELECT-only MySQL test account can verify an already migrated DB; denied
SELECT fails with the original PDO error. CLI `--env` is accepted for consistency
but verification records nothing. `--sql-dir` selects bytes to verify, not an
alternative manifest. A fresh database fails even with an empty manifest unless
existing empty tracking storage is present.

Manifest-foreign history is deliberately stricter than the existing Up/Rollback
preflight and informational `status`: it also prevents an older candidate with
a shorter manifest from being automatically approved against a newer DB.
Do not delete rows or rewrite checksums to pass. Restore the originally applied
release SQL, then use reviewed append-only upgrades. An intentional older-image
rollback needs a reviewed schema-compatibility/recovery process; this gate does
not infer backward compatibility.

**Limits:** matching migration bytes and tracking records do not prove that
every statement previously completed, that nobody manually modified schema/data,
or that the image is authentic. MD5 is historical change detection, not a
cryptographic release attestation. Down-file hashes, full schema diff,
backup/restore rehearsal and gameplay/native-renderer readiness remain separate
gates. Direct SQL and other independent DB servers are not coordinated by this
lock. CLI verification has no end-to-end deadline; do not substitute it for the
bounded public readiness probe or run it on every request.

CI smoke runs Up, second Up, informational Status, then Verify before bounded
HTTP readiness, user seed and browser tests. Local validation includes 119
focused runner/actual-CLI fixture tests and 16 real MySQL tests / 366 assertions:
the complete 64-entry fresh install verifies and its second Up is empty,
SELECT-only verification leaves tracking/data unchanged, drift/foreign/pending
and absent tracking fail, concurrent locks and caller transactions are respected.
Canonical fixture SQL omits hardcoded `USE galaxyquest` for DB-name isolation;
checksums correspond to those executed fixture bytes. This is not a new
production-image or remote-CI certification.

---

## Canonical Migration Order

The canonical migration order is maintained in `config/migrations_manifest.php`.
**New migrations must always be appended to the end** of that array; reordering
existing entries would break incremental upgrades on existing deployments.
The runner rejects non-list manifests, duplicate filenames (including case-only
collisions), paths, non-SQL filenames and `_down.sql` entries at construction.
Only plain forward filenames composed of letters, numbers, `_` and `-` are
accepted; companion rollback files are discovered separately.

### Append-only Git history gate

`npm run check:migration-history -- --base <ancestor-commit>` rejects changes
to established forward migration history before database deployment:

- The old manifest must remain an exact ordered prefix of the candidate:
  deletion, renaming, case changes, insertion between old entries and reordering
  fail. New entries may only be appended.
- Every candidate forward file must exist as a readable regular file; symlinks
  and directories are not migration inputs.
- Existing forward SQL must have the same **Git-clean blob identity** as in the
  baseline. Both staged and unstaged edits are checked; a committed rewrite
  also fails when compared with the original baseline.
- Missing/invalid baseline revisions, unrelated histories, unavailable baseline
  files and invalid manifests fail closed. The checker never repairs files,
  updates the index, creates commits or connects to a database.

The checker parses a restricted declarative PHP manifest without executing it:
`<?php`, optional `declare(strict_types=1);`, `return [...]`, plain quoted
forward filenames, commas, whitespace and `//`/`/* ... */` comments.
Executable expressions, keyed arrays, interpolation, duplicate/case-colliding
names and trailing PHP code fail. Changing this manifest format requires a
reviewed parser change rather than running untrusted PHP inside the gate.

The main CI `lint-js` job fetches full history. Pull requests compare with the
event's base SHA; normal pushes compare with the event's `before` SHA, **not**
the candidate's HEAD. New-branch push events have a zero `before` SHA, so they
compare with the merge base of HEAD and the repository's remote default branch.
Absent remote history fails; non-ancestor force pushes require reviewed history
recovery and are not silently accepted. The gate is already a prerequisite of
the main image publication through `lint-js`. Branch protection and remote CI
execution must still be verified separately.

Local read-only check against the current committed baseline:

```powershell
npm run check:migration-history -- --base HEAD
npx vitest run tests\js\migration-history.test.js --testTimeout=30000
```

`HEAD` is useful for checking local uncommitted work but **not** for detecting
a rewrite already committed in that same HEAD; supply its real prior baseline.
Git-clean comparison deliberately respects checkout line-ending policy
(`core.autocrlf`/attributes). A Windows CRLF checkout of an LF Git blob is not
a historical SQL change. Without Git normalization, an EOL-only edit fails.
This does not replace deployment `migrate.php verify`, whose stored MD5 compares
the exact SQL bytes executed in the image; keep deployment checkout/build
line endings consistent. Custom Git clean filters are trusted Git configuration,
not a release authenticity mechanism.

Local evidence: 47 parser, actual-Git and real-CLI/workflow tests pass, and the
real repository reports 64 immutable forward files with no additions.
Down companions, base `schema.sql`, SQL outside the canonical forward manifest,
semantic schema diffs and live upgrades remain separate review/gates.
Historical SQL errors must be corrected through reviewed **new** migrations,
not by making an old file pass through a new baseline or deleting tracking rows.

### All Migrations (current manifest)

| # | File | Category |
|---|------|----------|
| 1 | `migrate_v2.sql` | Core schema (legacy v2 path) |
| 2 | `migrate_gameplay_model_v1.sql` | Gameplay base model |
| 3 | `migrate_politics_model_v1.sql` | Politics model |
| 4 | `migrate_economy_v1.sql` | Economy |
| 5 | `migrate_economy_v2.sql` | Economy |
| 6 | `migrate_economy_v3.sql` | Economy |
| 7 | `migrate_economy_policies_v1.sql` | Economy policies |
| 8 | `migrate_economy_shortage_v1.sql` | Economy shortages |
| 9 | `migrate_empire_categories_v1.sql` | Empire categories |
| 10 | `migrate_security_v1.sql` | Security / auth |
| 11 | `migrate_security_v2_totp.sql` | TOTP 2FA |
| 12 | `migrate_admin_user_crud_v1.sql` | Admin user CRUD |
| 13 | `migrate_rbac_v1.sql` | Role-based access control |
| 14 | `migrate_actor_model_v1.sql` | NPC actor model |
| 15 | `migrate_actor_model_v2_drop_is_npc.sql` | Actor model v2 |
| 16 | `migrate_colonization_v1.sql` | Colonization |
| 17 | `migrate_colonization_v2.sql` | Colonization v2 |
| 18 | `migrate_colony_buildings_v1.sql` | Colony buildings |
| 19 | `migrate_unified_bodies_v1.sql` | Unified celestial bodies |
| 20 | `migrate_unified_bodies_v2_hardcut.sql` | Unified bodies v2 |
| 21 | `migrate_orbital_polar_coordinates_v1.sql` | Orbital coordinates |
| 22 | `migrate_galaxies_metadata.sql` | Galaxy metadata |
| 23 | `migrate_fog_of_war.sql` | Fog of war |
| 24 | `migrate_vessel_blueprints_v1.sql` | Vessel blueprints v1 |
| 25 | `migrate_vessel_blueprints_v2.sql` | Vessel blueprints v2 |
| 26 | `migrate_vessel_blueprints_v3.sql` | Vessel blueprints v3 |
| 27 | `migrate_vessel_blueprints_v4.sql` | Vessel blueprints v4 |
| 28 | `migrate_vessel_blueprints_v5.sql` | Vessel blueprints v5 |
| 29 | `migrate_vessel_blueprints_v6_planetary_events.sql` | Planetary events |
| 30 | `migrate_vessel_blueprints_v7_research_phase5.sql` | Research phase 5 |
| 31 | `migrate_vessel_blueprints_v8_wormholes.sql` | Wormholes |
| 32 | `migrate_vessel_blueprints_v9_wormhole_beacons.sql` | Wormhole beacons |
| 33 | `migrate_vessel_blueprints_v10_ftl_drives.sql` | FTL drives |
| 34 | `migrate_vessel_blueprints_v11_ftl_phase4.sql` | FTL phase 4 |
| 35 | `migrate_vessel_blueprints_v12_npc_ftl.sql` | NPC FTL |
| 36 | `migrate_combat_model_v1.sql` | Combat model |
| 37 | `migrate_combat_v1_wars.sql` | Wars (combat v1) |
| 38 | `migrate_npc_wars_v1.sql` | NPC wars |
| 39 | `migrate_war_v3.sql` | War v3 |
| 40 | `migrate_fleet_labels_v1.sql` | Fleet labels |
| 41 | `migrate_transport_generic_v1.sql` | Generic transport |
| 42 | `migrate_faction_species_v1.sql` | Faction species |
| 43 | `migrate_faction_agreements_v1.sql` | Faction agreements |
| 44 | `migrate_npc_pve_controller_v1.sql` | NPC PvE controller v1 |
| 45 | `migrate_npc_pve_controller_v2.sql` | NPC PvE controller v2 |
| 46 | `migrate_llm_soc_v1.sql` | LLM SoC / prompt catalog |
| 47 | `migrate_npc_chat_history_v1.sql` | NPC chat history |
| 48 | `migrate_pirates_v2.sql` | Pirate system v2 |
| 49 | `migrate_pirates_v3.sql` | Pirate system v3 |
| 50 | `migrate_traders_system_v1.sql` | Traders system |
| 51 | `migrate_trade_proposals_v1.sql` | Trade proposals |
| 52 | `migrate_marketplace_advisor.sql` | Marketplace advisor |
| 53 | `migrate_projection_system_snapshot_v1.sql` | System snapshots |
| 54 | `migrate_projection_user_overview_v1.sql` | User overview projections |
| 55 | `migrate_projection_runtime_v2.sql` | Runtime projections v2 |
| 56 | `migrate_tts_v1.sql` | Text-to-Speech |
| 57 | `migrate_prolog_quests_v1.sql` | Prolog / onboarding quests |
| 58 | `migrate_world_scenarios_v1.sql` | World scenarios |
| 59 | `migrate_updates_system_v1.sql` | Update metadata |
| 60 | `migrate_server_announcements_v1.sql` | Server announcements |
| 61 | `migrate_faction_homeworlds_v1.sql` | Faction homeworlds |
| 62 | `migrate_registration_drafts_v1.sql` | Registration drafts |
| 63 | `migrate_registration_mentor_drafts_v2.sql` | Mentor drafts |
| 64 | `migrate_registration_portraits_v1.sql` | Registration portraits |
| 65 | `migrate_star_spectral_wd_v1.sql` | White-dwarf spectral schema |
| 66 | `migrate_planet_science_v1.sql` | Legacy planet-science columns |
| 67 | `migrate_app_state_v1.sql` | Legacy seed/tick coordination storage |
| 68 | `migrate_faction_government_v1.sql` | Government, alliance and standing storage |
| 69 | `migrate_ship_build_queue_v1.sql` | Paid ship-construction queue storage |
| 70 | `migrate_glossary_cache_v1.sql` | Generated glossary cache storage |
| 71 | `migrate_alliance_wars_v1.sql` | Multi-party war, side and peace-offer storage |
| 72 | `migrate_projection_claim_token_v1.sql` | Nullable binary-comparison claim token for projector queue fencing |

> **Note:** `migrate_regen_spiral.sql` is a special maintenance migration that
> is only applied on demand via `setup.php --regen-galaxy`.  It is intentionally
> excluded from the regular manifest.

### Star and binary runtime schema boundary

`migrate_star_spectral_wd_v1.sql` is an append-only widening of
`star_systems.spectral_class` to include generated `WD` white dwarfs. The
canonical historical base/v2 already provides the remaining star companion
columns and `binary_systems`, but did not include `WD`. No historical SQL or
stored checksums were rewritten. Existing canonical spectral values, star IDs
and data are preserved. Custom noncanonical spectral enums/data require review
before applying this canonical enum definition.

`ensure_star_system_columns()` and `ensure_binary_systems_table()` now delegate
to [`GalaxySchema`](../../lib/GalaxySchema.php), which only reads the selected
database's metadata. Missing required columns/table or a spectral enum without
WD fails with an explicit migration instruction; PDO metadata errors propagate.
There is no runtime `ALTER TABLE` or `CREATE TABLE` in these two helpers,
no global "done" cache that incorrectly approves a second database, and no
automatic repair. Required column names and WD membership are checked, not a
complete type/index/foreign-key schema diff.

**Rollout order:** apply the canonical migrations, run `migrate.php verify`,
then admit gameplay/seed traffic. Local dev Compose's old init SQL list alone
does not establish this new migration: run the canonical CLI before using the
galaxy. The legacy setup list and isolated registration/homeworld fixture lists
include the new migration explicitly; the legacy setup is still not a replacement
for canonical tracking/deployment verification.

**Recovery:** this widening intentionally has no down companion. Removing `WD`
could truncate already generated white dwarfs and must not be an automatic
rollback. Use a reviewed compatible image rollback or a restore/recovery plan;
selected migration rollback is blocked by the existing missing-down barrier.
Snapshot/backup before production DDL; ALTER may implicitly commit and may
lock/rebuild a populated table. This block does not certify large-table downtime.

Local tests: six unit schema-guard tests, real MySQL preservation/WD insert,
SELECT-only calls to the actual legacy helpers, missing binary table and
unchanged unmigrated enum, plus full 65-entry migration/verify/no-op-second-up.
The real image also applies 65 migrations / 1,040 statements, verifies all 65,
seeds the user start region and passes nine HTTP-health tests.
Chromium remains two passing smoke tests / one skipped, main flow using an
existing fallback; GPU/native/remote production readiness is not implied.
Other application runtime DDL still prevents a claim that the whole
application now runs without DDL privileges.

### Planet-science runtime schema boundary

`migrate_planet_science_v1.sql` appends eleven conditional column additions for
legacy `planets` tables. The base schema already supplies them. Existing columns,
types, defaults and science values are never rewritten; absent columns receive
the original runtime defaults for composition/material, pressure, liquid states,
radiation, habitability, life friendliness and nullable species-affinity JSON.
Custom existing types still require review: this is not schema normalization.

`ensure_planet_science_columns()` delegates to the read-only
[`GalaxySchema::assertPlanets()`](../../lib/GalaxySchema.php).
Missing columns explicitly require canonical migrations, metadata errors
propagate and there is no cross-database success cache or automatic ALTER.
The guard checks column names, not complete types, indexes or constraints.
The legacy setup list includes the upgrade, but canonical tracking remains
necessary for deployment verification.

**Rollout:** back up the target database, apply canonical migrations with the
deployment account, run `migrate.php verify` from the candidate image, then
admit gameplay/seed traffic. Review populated-table lock/rebuild costs; MySQL
DDL may implicitly commit and the eleven additions are not an atomic operation.
If interrupted, inspect partial changes before retrying; conditional additions
preserve already existing columns. Never rewrite tracking checksums to pass.

**Recovery:** no down companion is supplied because dropping these columns
would destroy generated science data. The rollback barrier blocks automatic
removal. Use a reviewed compatible image rollback or restore/recovery plan,
not column deletion. Production backup/restore rehearsal remains open.

Local validation: nine combined schema-guard unit tests / 54 assertions;
two real MySQL legacy-upgrade cases plus the full 66-entry fresh install /
verify / no-op second run (three tests / 326 assertions). Partial populated
schemas retain values and defaults, direct SQL replay is idempotent, all eleven
absent fields are added, and the actual runtime helper works with SELECT-only
rights and refuses missing storage without repairing it.
The full PHP unit suite passes 1,050 tests / 5,061 assertions.
The actual built image applies **66 migrations / 1,084 statements**, verifies
all 66, seeds the start region and passes nine HTTP-health tests.
Chromium was not rerun for this block; the earlier star/binary smoke evidence
does not certify the new image's browser or native/GPU paths.

---

### App-state runtime schema boundary

`migrate_app_state_v1.sql` creates missing legacy coordination storage using
the existing base/runtime definition: `state_key` primary key, non-null
`state_value` and automatically maintained `updated_at`. Existing tables,
custom definitions, seed markers, cooldowns and state values are untouched.
It does not repair an incomplete existing table or normalize custom types.

`ensure_app_state_table()` now delegates to
[`GalaxySchema::assertAppState()`](../../lib/GalaxySchema.php) instead of
executing CREATE on every access. Missing required columns explicitly require
migrations; no table is created and no default is returned for missing storage.
Metadata/rights failures propagate without a DDL fallback. Existing
`app_state_get_int()` defaults for absent keys and nonnumeric values, signed
integer conversion and `app_state_set_int()` upserts/timestamps are retained.
Metadata checks are connection-local and do not implicitly commit transactions.

**Rollout/recovery:** back up the database, apply canonical migrations with
the deployment account, verify from the candidate image, then admit gameplay.
Legacy setup includes the new migration but is not canonical tracking.
Incomplete existing storage requires a reviewed append-only repair; replaying
CREATE does not fix it. No down companion is provided because dropping state
would lose seed/tick coordination and could trigger repeated work.
Use reviewed compatible-image rollback or restore/recovery; never delete state
or tracking to make deployment verification pass.

Three added unit tests cover read-only metadata, incomplete storage and
cross-database isolation. Two actual MySQL cases plus the full fresh-install
regression pass three tests / 297 assertions: existing data and custom
definitions survive migration/replay; SELECT-only can read, denied writes
propagate, and INSERT/UPDATE suffice for upserts without DDL rights.
The real accessors preserve an active transaction and rolled-back state,
and missing storage before/after migration never recreates itself.
The complete PHP unit suite passes 1,053 tests / 5,082 assertions; PHPStan and
the counted PHPCS gate pass (6,831 existing violations / 4,983 fingerprints).
The actual image applies 67 migrations / 1,085 statements, has an empty second
Up, verifies all 67, seeds the start region and passes nine HTTP-health tests.
Chromium smoke passes two tests / skips one; the main flow still uses system
fallback and reports WebGPU/runtime warnings. This is not native/GPU readiness.
Full application least privilege, tick-on-read removal and schema diff remain
separate work; removing the galaxy seed helper's DDL does not certify every API.

### Faction and diplomacy runtime schema boundary

`ensure_pve_faction_tables()` and `ensure_government_tables()` now delegate to
read-only [`GalaxySchema`](../../lib/GalaxySchema.php) guards, removing the
remaining five CREATE paths from `api/galaxy_seed.php`. Canonical base/v2
already supplies `npc_factions` and `faction_quests`, including the broader
canonical faction enum. No historical SQL or enum definition is rewritten.
The new `migrate_faction_government_v1.sql` supplies the previously runtime-only
`faction_government`, `faction_alliances` and `faction_standing_adjustments`
tables with the original defaults, primary keys and faction CASCADE references.
Existing tables, custom definitions and populated diplomacy data are preserved.

Guards check required column names, not complete types/indexes/foreign keys.
Missing tables/columns require migrations; metadata errors propagate, with no
automatic CREATE or cross-database success cache. Seed functions remain DML:
government/alliance initialization and state markers are not moved into schema
migrations, and existing seed configuration, INSERT IGNORE and done-key behavior
are retained. Repeated initialization must preserve player-modified values.

**Rollout:** back up the target database, apply canonical migrations (base/v2
must precede these foreign-key-dependent tables), verify from the candidate,
then admit gameplay or seed traffic. Legacy setup includes the new upgrade but
is not canonical tracking. MySQL DDL implicitly commits; partially applied
table creation requires inspection before retry. Existing incomplete/custom
tables require a reviewed append-only repair, not automatic normalization.

**Recovery:** there is no destructive down companion. Dropping these tables
would erase governments, alliances and standing history; the rollback barrier
blocks that path. Use reviewed compatible-image rollback or restore/recovery.
This is not a production restore rehearsal or full schema-diff certification.

Five added unit cases reject each missing table without DDL. Real MySQL
legacy-upgrade and seed/rights cases pass two tests / 32 assertions, alongside
the complete 68-entry fresh install/verify/no-op regression.
Tests preserve custom definitions and populated data across replay, exercise
SELECT-only guards and SELECT/INSERT/UPDATE seed access without DDL, preserve
an active transaction and rollback, retain modified stability/alliance values
on repeated seed, and verify all three new tables' faction CASCADE behavior.
The full PHP unit gate passes 1,058 tests / 5,125 assertions; PHPStan passes.
Only two resolved PHPCS fingerprints were removed (6,829 existing violations /
4,981 fingerprints), without new exceptions. All 47 Git history tests pass
with a 15-second local test timeout after one five-second fixture timeout under
parallel build load; the repository gate retains 64 immutable files and four
append-only additions.
Actual candidate-image acceptance applies 68 migrations / 1,088 statements,
has a no-op second Up, verifies all 68, seeds the start region and passes nine
HTTP-health tests. Chromium passes two / skips one; main flow still uses a
system fallback and reports existing WebGPU/runtime warnings.

### Building and shipyard runtime schema boundary

`ensure_building_upgrade_queue_table()`, `ensure_ship_build_queue_table()` and
`ensure_built_vessels_table()` delegate to read-only
[`GalaxySchema`](../../lib/GalaxySchema.php) column guards. The three runtime
CREATE statements and global ready flags are removed. Historical base SQL
already supplies `building_upgrade_queue`; canonical blueprint v5 supplies
`built_vessels`. Neither historical file is rewritten.
`migrate_ship_build_queue_v1.sql` creates the previously runtime-only queue with
the original defaults, colony CASCADE reference and colony/status and ETA
indexes. Existing custom definitions, paid costs, quantities, running status
and timestamps are preserved across migration and direct replay.

Missing columns/tables fail explicitly, metadata errors propagate and success
on one connection does not bypass checks against another. Guards check names,
not full types/indexes/constraints. Vessel storage creation no longer suppresses
PDO failures, and ship completion no longer catches every vessel-spawn error.
If due work contains a blueprint and has a colony owner, completion checks
vessel storage before any aggregated ship-count or queue-status mutation.
This deliberately blocks such a batch on missing schema rather than reporting
completed work without individual vessels. Later spawn errors propagate;
this preflight does not make the entire completion algorithm atomic or safe
against concurrent completion/schema changes. Resource-ledger transactions,
claiming/locking and tick-on-read removal remain separate roadmap work.

**Rollout:** back up the DB, apply all canonical migrations, verify from the
candidate image, then admit building/shipyard requests. The queue requires
existing colonies; blueprint v5 requires its canonical predecessors.
Legacy setup includes the new queue migration but does not replace the full
canonical blueprint sequence or tracking verification. Incomplete existing
tables need reviewed append-only repairs, not runtime recreation.

**Recovery:** no down companion is supplied because dropping the queue loses
paid pending/running ship builds. The rollback barrier prevents that destructive
path. Use reviewed compatible-image rollback or restore/recovery; do not
delete queue rows or alter tracking to pass verification. No production
backup/restore or large-table DDL downtime certification is implied.

Nine added unit cases cover valid metadata-only guards, missing columns and
cross-database cache isolation for all three stores. The full PHP unit suite
passes 1,067 tests / 5,186 assertions. Three real MySQL cases initially pass
314 assertions (complete 69-entry fresh install/verify/no-op, custom paid queue
preservation and actual runtime helpers). The expanded runtime case passes
30 assertions, including SELECT-only guards, DML-only vessel spawning,
transaction rollback, JSON/HP snapshots, real completion and repeat completion
without double counting, fail-before-count/status changes on missing vessel
storage, missing queue detection after earlier success and colony CASCADE.
PHPStan passes; only four resolved PHPCS fingerprints are removed (6,825
existing violations / 4,977 fingerprints). All 47 history tests pass with a
15-second local test timeout; the gate preserves 64 original migrations and
five append-only additions.
Actual candidate-image acceptance applies 69 migrations / 1,089 statements,
has a no-op second Up, verifies all 69, seeds the start region and passes nine
HTTP-health tests. Chromium passes two / skips one; main flow still uses system
fallback and reports existing WebGPU/runtime warnings, not native readiness.

### Account and homeworld runtime schema boundary

`ensure_homeworld_support_tables()` in `api/auth.php` and
`ensure_character_profile_tables()` now use read-only
[`GalaxySchema`](../../lib/GalaxySchema.php) guards for `ships`, `messages`
and `user_character_profiles`. The three runtime CREATE statements are removed.
Canonical base SQL already supplies all three stores (v2 also supplies profiles),
so this block adds no migration and does not rewrite historical definitions.

Missing tables/columns explicitly require migrations; metadata errors
propagate rather than triggering automatic repair. Checks have no global
success cache and validate names, not full types/indexes/foreign keys.
An existing character profile with stored JSON/YAML references still returns
unchanged, without regeneration or write privileges. Missing/incomplete profile
storage fails before generation, filesystem writes or the generator's existing
fallback handling. Asset-reference existence is not verified by this guard;
the generator's other fallback/transport behavior is unchanged.

**Rollout/recovery:** apply canonical migrations and verify from the candidate
before account/homeworld traffic. Do not rely on login or profile access to
create missing tables in partial development installations. A manually missing
table despite complete tracking requires a reviewed append-only repair or
restore, not checksum rewrites, state deletion or automatic replay of all
historical SQL. No new rollback boundary or destructive down is introduced.
Full registration/email-verification, asset regeneration and production
backup/restore gates remain separate work.

Five added unit cases cover missing homeworld stores and profile guards,
including cross-database cache isolation. The full PHP unit suite passes
1,072 tests / 5,221 assertions. Two actual MySQL cases / 301 assertions cover
the full unchanged 69-entry fresh-install/verify/no-op and SELECT-only runtime
access to populated storage: ship counts, read messages and stored profile
values remain unchanged, active transactions remain active, and missing
tables or an absent profile column never recreate storage or return a
success-shaped generated profile.
Because importing the legacy auth endpoint dispatches and exits, the test
loads its actual helper source only; profile helpers are imported normally.
PHPStan passes; only two resolved PHPCS fingerprints are removed (6,823
existing violations / 4,975 fingerprints). The history gate preserves the
same 64 original files and five append-only additions.
Actual candidate-image acceptance applies/verifies 69 migrations / 1,089
statements, seeds the start region and passes nine HTTP-health tests. Chromium
passes two / skips one; main flow still uses system fallback and reports
existing WebGPU/runtime warnings. This does not certify full registration or
native/GPU/production readiness.

### Situation runtime schema boundary

`ensure_situations_tables()` in `api/situations.php` now delegates to
[`GalaxySchema::assertSituations()`](../../lib/GalaxySchema.php).
The two runtime CREATE statements and process-global ready flag are removed.
Canonical `migrate_gameplay_model_v1.sql` already supplies both situation states
and stage history, including the additional situation-type index absent from
the old runtime definition. No migration, enum, default, index or historical
SQL is changed.

The guard reads metadata for the selected database on each call. Missing tables
or required columns explicitly require canonical migrations, and metadata
errors propagate without automatic CREATE. Checks validate names, not complete
types/indexes/constraints. Existing read, tick, resolve and stage-transition
behavior remains unchanged; schema preflight does not implicitly commit a
caller's transaction.

**Rollout/recovery:** apply the canonical gameplay migration and verify from
the candidate before situation requests. A partial development database must
not rely on the endpoint to bootstrap storage. Missing storage despite complete
tracking needs a reviewed append-only repair or restore; do not delete tracking
or rewrite checksums to replay old SQL. No new destructive down or rollback
boundary is introduced. Tick claiming/locking, atomic state/history updates and
production restore rehearsal remain separate work.

Two added unit cases reject missing states/history without DDL.
The full PHP unit suite passes 1,074 tests / 5,236 assertions. The complete
unchanged 69-entry fresh-install/verify/no-op test passes, and the focused
actual MySQL situation case passes 25 assertions: SELECT-only guards and
owner-filtered reads preserve populated state, DML-only ticks update progress
and stage history, active transactions survive preflight, rollback restores
state/history, colony deletion sets the colony link NULL and user deletion
cascades both tables. Missing tables after previous success are never recreated.
The test loads actual endpoint helpers without executing its HTTP dispatch,
and uses the application's associative PDO fetch mode.
PHPStan passes; one resolved PHPCS fingerprint is removed (6,822 existing
violations / 4,974 fingerprints), without new exceptions. No image/browser or
remote production acceptance was rerun for this targeted block.

### World-scenario runtime schema boundary

`ScenarioEngine::ensureTables()` now delegates to
[`GalaxySchema::assertWorldScenarios()`](../../lib/GalaxySchema.php).
Three runtime CREATE statements and the broad catch/log-and-continue fallback
are removed. The existing canonical `migrate_world_scenarios_v1.sql` already
owns galactic events, scenario definitions and active events, including foreign
keys absent from the old runtime definitions. No migration or historical SQL
is rewritten.

A due tick checks metadata **before** writing `scenario_engine:last_tick`.
Missing tables/required columns or metadata errors propagate without storage
creation and without consuming the cooldown. A tick that is not due retains
its existing early return and does not perform this schema check.
The outer optional NPC tick dispatcher still logs scenario failures and
continues other subsystems; this does not make the whole gameplay request
fail closed. Column-name checks are not full type/index/constraint validation.
Failures later in event resolution/seed processing and cooldown claiming/
concurrency remain separate work; the ordering change only protects schema
preflight failures, not all failed ticks.

**Rollout/recovery:** apply canonical world-scenario migrations and verify from
the candidate before enabling scenario ticks. Missing storage despite complete
tracking requires reviewed append-only repair or restore; do not rely on the
engine to create partial definitions or rewrite tracking checksums.
No new destructive down/rollback boundary is introduced. Production restoration,
worker leases and atomic event effects remain separate gates.

Three added unit cases reject each missing table without DDL. The complete
PHP unit suite passes 1,077 tests / 5,263 assertions. Two actual MySQL cases /
299 assertions cover unchanged 69-entry fresh-install/verify/no-op and the
real engine: missing schema leaves the original marker unchanged; SELECT-only
can run schema preflight; a due DML-only tick retains existing definitions/
active events and updates its marker; an active transaction remains active
and rollback restores the marker; a not-due SELECT-only tick writes nothing.
Missing active storage after earlier success is not recreated and does not
consume the next cooldown. PHPStan and PHPCS pass with unchanged baselines
(6,822 existing style violations / 4,974 fingerprints).
No image/browser or remote production acceptance was rerun for this block.

### Glossary cache runtime schema boundary

`migrate_glossary_cache_v1.sql` supplies the previously runtime-only glossary
cache with its original columns, defaults, unique term key, indexes and
utf8mb4 Unicode collation. Existing custom table definitions, cached content
and timestamps remain unchanged. The old runtime CREATE was called after
unconditional endpoint exits and therefore never established storage.
It is replaced by a read-only
[`GalaxySchema::assertGlossaryCache()`](../../lib/GalaxySchema.php) guard.

Generation checks storage before cache lookup or any RAG/network work.
Cache reader/writer helpers also check independently. Missing schema is an
explicit migration error, not a cache miss or automatic repair; PDO read/write
errors are logged and rethrown rather than hidden. The generation pipeline's
existing outer error handler remains unchanged. Static definition guidance
does not need cache access. Valid five-day cache hits, missing/expired-key
misses, definition upserts and timestamps retain their existing behavior.
This guard validates column names, not complete types/indexes/collation.

**Rollout/recovery:** back up the database, apply canonical migrations and
verify from the candidate before using generated definitions. Legacy setup
includes the new migration but is not a tracking/verification replacement.
Partial existing schemas need reviewed append-only repair. No down companion
is provided because dropping storage discards generated definitions and may
trigger regeneration work. Use reviewed compatible-image rollback or restore;
do not rewrite historical checksums or delete tracking to pass verification.
RAG transport limits, cache-content validation and external-provider readiness
remain separate work.

Three added unit cases cover valid metadata-only storage, missing columns and
cross-database isolation. The full PHP unit suite passes 1,080 tests / 5,284
assertions. Two actual MySQL cases / 307 assertions cover complete 70-entry
fresh-install/verify/no-op, absent-storage failure before RAG, data/custom
definition retention across replay, SELECT-only hits/misses, denied writes,
DML-only upserts, active transaction/rollback and six-day expiry.
Missing storage after earlier success is not recreated or treated as a miss.
PHPStan and PHPCS pass; one resolved style fingerprint is removed (6,821
existing violations / 4,973 fingerprints). All 47 history tests pass with a
15-second local timeout; 64 original migrations remain unchanged and six are
appended. No image/browser or real external RAG acceptance was run this block.

### Player-alliance runtime schema boundary

`ensure_alliance_schema()` delegates to
[`GalaxySchema::assertAlliances()`](../../lib/GalaxySchema.php), removing four
runtime CREATE statements for alliances, members, relations and messages.
Canonical base/v2 already supplies these stores; no migration or historical
SQL changes. Required column names are checked with read-only metadata,
without automatic repair or process-global success caching. This is not a
complete type/index/foreign-key comparison.

**Rollout/recovery:** apply canonical migrations and verify before alliance
requests. Partial development installations must not rely on API reads to
create storage. Missing tables/columns despite complete tracking need reviewed
append-only repair or restore, not historical checksum rewrites or tracking
deletion. No new rollback boundary is introduced.
Multi-party alliance-war storage is covered by the following migration boundary;
neither block certifies the application's full least privilege.
Alliance action authorization/resource-transaction behavior is unchanged.

Four added unit cases reject each missing table without DDL. The full unit
suite, including existing alliance action tests, passes 1,084 tests / 5,326
assertions. Two actual MySQL tests / 308 assertions cover full unchanged
70-entry fresh-install/verify/no-op and the actual runtime helper: SELECT-only
preflight retains an active transaction, populated DECIMAL treasury values,
membership roles/contributions, relations and messages; other-alliance deletion
sets the relation target NULL, and leader-user deletion cascades owned storage.
Missing messages or treasury columns after prior success fail explicitly.
PHPStan passes; one resolved PHPCS fingerprint is removed (6,820 existing
violations / 4,972 fingerprints), without new exceptions. No new image/browser
or production acceptance was run for this targeted block.

### Multi-party alliance-war runtime schema boundary

`migrate_alliance_wars_v1.sql` creates the three previously runtime-only war,
side and peace-offer tables. The original defaults, unique war/alliance
membership key and user/alliance/war CASCADE references are retained.
The peace-offer TEXT default uses MySQL's required expression syntax `('[]')`
instead of the old invalid plain TEXT default; its value is unchanged.
Existing custom definitions, war scores, exhaustion, sides and offers are
not rewritten. `aw_ensure_schema()` now reads required column metadata via
[`GalaxySchema::assertAllianceWars()`](../../lib/GalaxySchema.php) rather than
executing three CREATE statements on API requests. Missing tables/columns fail
explicitly; there is no automatic repair or global success cache.
Column names are checked, not complete constraints/types.

**Rollout/recovery:** back up the database, apply canonical migrations (users
and alliance base storage must precede this upgrade), verify from the candidate,
then admit war requests. Legacy setup includes the upgrade but is not canonical
tracking. MySQL DDL implicitly commits and partial existing tables need reviewed
append-only repair. There is no destructive down companion: dropping storage
loses wars, side assignments and peace terms. Use reviewed compatible-image
rollback or restore; never rewrite historical checksums/delete tracking.
War-action authorization and resource/concurrency behavior remain unchanged.

Three added unit cases reject each missing table without DDL. The full unit
suite passes 1,087 tests / 5,354 assertions. Two real MySQL cases / 312 assertions
cover complete 71-entry fresh-install/verify/no-op and the actual runtime helper:
fresh creation, default peace terms `[]`, retained populated war data and
custom definitions across replay, SELECT-only preflight with transaction
retention, alliance deletion cascading sides/offers and declarer deletion
cascading wars/sides. Missing offers after earlier success fail without repair.
PHPStan and PHPCS pass; one resolved fingerprint is removed (6,819 existing
style violations / 4,971 fingerprints). No new image/browser, full war-action
or production restore acceptance was run this block.

### Leader marketplace runtime schema boundary

[`ensure_leader_marketplace_schema()`](../../api/leaders.php) and
[`ensure_leaders_marketplace_profile_schema()`](../../api/leaders.php) use
[`GalaxySchema`](../../lib/GalaxySchema.php) metadata guards instead of one
CREATE and fourteen conditional ALTER statements. The canonical base schema
supplies six leader skills; the existing
[`migrate_marketplace_advisor.sql`](../../sql/migrate_marketplace_advisor.sql)
supplies marketplace storage and the additional profile fields. No migration
is added and historical SQL/checksums remain unchanged.

Guards check required column names, not full types/constraints. There is no
global success cache or request-time repair. Existing profile widths/defaults
and candidate prices, hired status and timestamps are not normalized.

**Rollout/recovery:** back up the database, apply the canonical manifest and
verify from the candidate before admitting marketplace requests. A partially
migrated profile needs a reviewed append-only repair, not application DDL.
Do not rerun historical SQL directly to repair missing base skills: its
unconditional role ALTER can implicitly commit. Preserve tracking/checksums.
Use a reviewed compatible-image rollback or restore if needed; never drop
profiles/candidates as a recovery shortcut.

Six added unit cases cover complete, missing-column and database-specific
metadata. Full unit suite: 1,093 tests / 5,394 assertions. Three real MySQL
cases / 318 assertions cover complete 71-entry fresh-install/verify/no-op,
the existing partial-profile upgrade and actual runtime helpers with
SELECT-only privileges. Active transactions and populated data/custom
definitions are retained; a missing skill or marketplace after earlier success
fails without ALTER/CREATE. PHPStan and PHPCS pass; only three resolved style
fingerprints are removed (6,816 violations / 4,968 fingerprints).
No new image/browser or actual hiring-action acceptance was run. Marketplace
resource atomicity, complete schema diff and full production least privilege
remain separate gates.

### Wormhole runtime schema boundary

Fleet listing/routing in [`fleet.php`](../../api/fleet.php), beacon quest rewards
in [`factions.php`](../../api/factions.php) and NPC maintenance in
[`npc_ai.php`](../../api/npc_ai.php) no longer execute six duplicate CREATEs or
two conditional ALTERs. Shared [`GalaxySchema`](../../lib/GalaxySchema.php)
guards check required columns without DDL or success caches. Existing
[`v8`](../../sql/migrate_vessel_blueprints_v8_wormholes.sql) and
[`v9`](../../sql/migrate_vessel_blueprints_v9_wormhole_beacons.sql) migrations
already own routes, permanence and user unlocks; no new migration is added.
Guards check names, not complete types/indexes/foreign-key definitions.

Missing schema or metadata failures propagate instead of returning no route.
Legitimate unavailable-route results (research, unlock, stability, cooldown,
inactive or unmatched endpoints) are unchanged. A due regeneration tick checks
wormholes before writing its ten-minute marker. Not-due early return remains;
the outer optional NPC dispatcher still logs subsystem failures and continues.
Beacon reward preflight precedes resource, standing and claimed-status writes;
ordinary quests do not require unlock storage.

**Rollout/recovery:** back up the database, apply canonical migrations in order
(users/faction quests and v8 must precede v9), verify from the candidate, then
admit wormhole requests and maintenance. Preserve existing routes, labels,
stability, cooldowns and unlock history. Partial legacy tables require reviewed
append-only repair; request-time DDL is not a fallback. MySQL DDL implicitly
commits, and direct historical replay is not a production recovery procedure.
Use a reviewed compatible-image rollback or restore; do not drop routes/unlocks
or edit applied checksums/tracking.

Six added unit cases cover valid, missing and database-specific metadata.
Full unit gate: 1,099 tests / 5,434 assertions. Three real MySQL cases /
390 assertions cover the unchanged complete 71-entry fresh-install/verify/no-op,
populated v8/v9 replay with retained custom labels/definitions, SELECT-only
route/list bodies and DML-only jump/regeneration/reward bodies. Tests exercise
research 4/5, stability 9/10, permanent unlocks, both directions, inactive and
cooling routes, +2 regeneration/clamp 100, expired cooldown clear, unchanged
future cooldowns/inactive stability, active transaction/rollback and unlock
CASCADE. Missing columns/tables after earlier success cannot consume a due
marker or repair storage; missing unlocks fail before reward/status mutations.
The actual listing payload is returned in a test closure rather than serialized
over HTTP; the reward body is tested without authentication/endpoint dispatch.

PHPStan and PHPCS pass (6,801 existing violations / 4,955 fingerprints).
Resolved findings are removed; the existing faction side-effect fingerprint
is rekeyed only after comparing every field except diagnostic line positions.
Touched reward blocks are indented to repository rules rather than adding
style exemptions. No new image/browser or complete HTTP claim acceptance was
run. Later tick failure/claim races, exactly-once quest rewards, full fleet
resource atomicity and production least privilege remain separate gates.

### Projection worker runtime schema boundary

[`project_user_overview.php`](../../scripts/project_user_overview.php) and
[`project_system_snapshots.php`](../../scripts/project_system_snapshots.php)
use shared metadata guards for the queue and their respective read model before
claiming. Four worker CREATE statements are removed; missing storage fails on
stderr with exit 1 rather than continuing after a bootstrap warning.
Canonical projection v1/system v1/runtime v2 migrations remain unchanged.
The system worker now uses the existing `(galaxy, system_index)` helpers;
its conflicting `system_id` schema and syntactically invalid merged code are
removed. No new migration is needed for a canonical deployment.

**Rollout/recovery:** back up and apply the full manifest before starting workers,
then verify from the candidate. A legacy system-ID-only table is incompatible:
the metadata guard rejects it. Review an append-only, data-preserving conversion
using real system-to-galaxy mappings; never recreate it or rewrite historical
SQL/checksums. Validate migration performance with populated queues/read models.
Use reviewed compatible-image rollback or restore if necessary.

Both dry runs are genuinely read-only and can use SELECT-only credentials.
`--max-items` bounds the claim; the soft `--max-seconds` deadline is checked
before claiming, and a claimed batch is finished rather than stranded by normal
limit exits. Workers enable strict projection failures before acknowledgement;
request-side best-effort defaults remain unchanged. See the
[runbook](PROJECTION_RUNBOOK.md) for exact operating limits.

Fifteen additional unit cases cover schema guards, strict database/JSON failures
and explicit batch overrides; full unit gate: 1,114 tests / 5,503 assertions.
Three real MySQL cases / 400 assertions include complete 71-entry
fresh-install/verify/no-op and actual
worker CLI subprocesses. Tests cover retained data/definitions, SELECT-only
dry-run with item cap, active metadata-guard transactions, missing schema before
claim, limited user failures, canonical system/owner/population data, versioning,
stale flags, absent stars, denied persistence with retained/retried queue rows,
successful retry and source-query failures not acknowledged as missing stars.
The original system-worker parse error is reproduced; both repaired scripts
pass PHP syntax checks. PHPStan/PHPCS pass with unchanged baselines.

No complete user live-overview, image/browser, production restore or worker
crash/concurrency acceptance is claimed. Snapshot and acknowledgement are
separate commits; claim fencing, leases, CLI validation and full application
least privilege remain separate work.

### Projection CLI preflight follow-up

Both worker commands reject malformed, unknown, positional or duplicate options
before configuration/database access. Numeric options use `--name=value`, fit
`PHP_INT_MAX`, and reject signed/fractional/whitespace input. Batch must be
positive; zero time/item limits still mean unlimited. Standalone `--help` works
without configuration; mixed help is invalid. Nonpositive configured batch
defaults fail explicitly rather than producing invalid SQL.

**Rollout:** review cron/supervisor flags before deploying; formerly ignored
typos and `--batch=0` now exit 1. Valid configured defaults and explicit overrides
are retained. No SQL migration or checksum change is involved.
Full unit suite passes 1,215 tests / 6,240 assertions, with 101 new parser/actual
CLI subprocess cases proving pre-configuration failure and exact integer
boundaries. Two focused real MySQL worker tests / 121 assertions pass, including
strict typo rejection, retained read-only dry runs and system retry lifecycle.
PHPStan/PHPCS pass without baseline changes; release metadata and append-only
history remain valid. Full fresh-install/image/browser acceptance was not
repeated for this CLI block; hard deadlines, crash leases and atomic queue/
snapshot commits remain open.

### Projection retry/enqueue ordering follow-up

Shared failure handling now updates only `processing` rows and checks affected
row counts before logging retry/dead-letter success. A new enqueue or completed
transition wins: already queued, failed or deleted rows are unchanged by an
older failure. The actual overwrite of reset attempts/error/schedule was
reproduced on MySQL before the fix. No migration or checksum changes are needed.

Three focused real MySQL tests / 152 assertions cover distinct producer/worker
connections and retained new events for both retry and dead-letter paths,
ordinary failure handling, caller transaction rollback, duplicate failures and
new-event revival of dead letters. Full unit gate: 1,218 tests / 6,249 assertions;
PHPStan/PHPCS and release/history gates pass without baseline changes.
See the [runbook](PROJECTION_RUNBOOK.md) for diagnostics and recovery.
This guard is not a claim token: a later claim can restore `processing` while an
old worker remains alive. Leases/fencing, atomic snapshot/queue commits and
parallel crash/reclaim/production acceptance remain open; full manifest/image/
browser acceptance was not repeated for this runtime-only change.

### Projection claim-token fencing follow-up

Migration 72 conditionally adds nullable `claim_token VARCHAR(64)` with ASCII
binary comparison to the existing queue. Existing rows, definitions and tokens
survive replay; historical SQL/checksums are unchanged. Claims generate a fresh
256-bit random token per batch and return it to both workers. Completion, retry
and dead-letter transitions require the row id, processing status and exact
token. Enqueue and failure transitions clear tokens. The separate system
producer also resets status to queued, so newly dirtied processing/dead-letter
systems are actually retried.

Stop all old workers and pause producers before migration/deployment. Apply the
complete canonical manifest and run `verify`; deploy matching producers and
workers together. Review legacy processing rows with null tokens while all
workers are stopped, then selectively requeue them using the runbook. Do not
mix old workers with token-aware workers: old binaries do not enforce fencing.
No automatic recovery or destructive down migration is supplied. Keep the
additive column on application rollback; recovery of interrupted DDL and custom
column types/collations needs operator review.

Tests cover preserved populated legacy queues, SQL replay, complete 72-entry
fresh-install/verify/no-op, actual worker subprocesses, user/system producer
interleavings and stale acknowledgements/retry/dead-letter after replacement
claims. The previous status-only DELETE is reproduced inside a rolled-back
transaction. Queue ownership fencing does **not** fence snapshot writes or
make snapshot/ack atomic; expiring leases, parallel crash recovery and production
acceptance remain open. No new image/browser acceptance is implied.

Local gates: 1,221 unit tests / 6,261 assertions; five MySQL cases / 477
assertions, plus the final expanded user/system ownership and dead-letter
revival case rerun (one test / 52 assertions). All 47 history tests, append-only
64 immutable + eight appended migrations, PHPStan and release checks pass.
PHPCS remains at 6,801 existing violations / 4,955 fingerprints, with no new
baseline exceptions.

### Atomic fenced projection publication follow-up

No additional SQL migration is needed beyond migration 72. Both workers now
publish through a shared transactional completion helper: lock matching
processing row/token, run the strict snapshot writer, delete the owned queue row,
commit. A superseded claim never invokes its writer. Write/ack failure rolls
back the projection and queue together, then ordinary token-aware retry applies.
Caller-owned transactions are rejected; an unrecovered transaction aborts the
worker instead of attempting a retry on that connection.

Worker preflight additionally requires InnoDB queue/read-model tables. Missing
or nontransactional engines fail before claim without runtime conversion.
Use reviewed migrations for custom storage; stop token-only older workers as
well, since those can still publish unfenced snapshots. Low-level write/done
logs are not commit evidence; use `completion_committed` and processed/skipped
worker counters.

Local gates: 1,234 unit tests / 6,321 assertions; four focused real MySQL cases /
254 assertions cover both writers, rollback/visibility, lost and repeated claims,
queue lock contention, no-write completion, actual system CLI ack denial/retry/
recovery and actual MyISAM preflight. Unit tests include original-error
preservation on rollback failure and commit/ack failures.
Final focused unit rerun: 214 tests / 1,363 assertions. PHPStan/PHPCS, release
metadata and append-only history gates pass; PHPCS baseline remains unchanged
at 6,801 existing violations / 4,955 fingerprints. Owned MySQL fixtures were
removed after verifying zero residual test databases/accounts.
Source reads remain outside the completion transaction; request-side writers,
gameplay mutations and enqueue/outbox atomicity are not covered. No expiring
lease, exactly-once guarantee or connection-loss-at-commit/process-crash/restore
acceptance is implied. No new full-manifest/image/browser run for this block.

### Retired destructive ship-designer initializer

`api/_init_tables.php` and `sql/init_ship_designer.sql` are not migration paths.
Their former `DROP TABLE` behavior could destroy user designs/jobs, while the
legacy MyISAM/column definitions conflict with the current API and unmanifested
TRELLIS2 SQL. Both entry points now fail explicitly before DB access or schema
mutation. Do not revive them or claim the feature is initialized. Ship-designer
persistence remains unsupported until a reviewed canonical migration matches
the API/worker contract and preserves existing custom installations.

The actual CLI subprocess proves the PHP path makes no DB connection; a MySQL
regression invokes the standalone SQL against populated design, queue and asset
tables and confirms all definitions and rows survive the explicit SQL error.
No migration was added because the conflicting storage contract has not been
resolved.

## Writing a New Migration

1. Create `sql/migrate_<feature>_v<N>.sql` with the forward SQL.
2. Optionally create `sql/migrate_<feature>_v<N>_down.sql` with the rollback SQL.
3. Append the filename to the **end** of the array in `config/migrations_manifest.php`.
4. Document the migration in this file (append a row to the table above).

### Example: `sql/migrate_example_v1.sql`

```sql
-- migrate_example_v1.sql
-- Adds the `example` table.
CREATE TABLE IF NOT EXISTS example (
    id   INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Example: `sql/migrate_example_v1_down.sql`

```sql
-- migrate_example_v1_down.sql
-- Removes the `example` table (rollback for migrate_example_v1.sql).
DROP TABLE IF EXISTS example;
```

### Working with ALTER TABLE and Data Manipulation

For detailed guidance on ALTER migrations and data manipulation patterns, see:
- **[ALTER_MIGRATIONS_GUIDE.md](./ALTER_MIGRATIONS_GUIDE.md)** — Comprehensive patterns for:
  - Adding/modifying/removing columns
  - Managing indexes and constraints
  - Backfilling data
  - Data cleanup and validation
  - Foreign key management
  - Handling transactions and rollbacks

Example patterns:
- [Pattern 1: Adding New Columns](./ALTER_MIGRATIONS_GUIDE.md#pattern-1-adding-new-columns)
- [Pattern 2: Modifying Existing Columns](./ALTER_MIGRATIONS_GUIDE.md#pattern-2-modifying-existing-columns)
- [Pattern 6: Data Backfilling](./ALTER_MIGRATIONS_GUIDE.md#pattern-6-data-backfilling)

### Reference Migrations

For concrete examples of complex migrations, see:
- **`sql/migrate_alter_examples_v1.sql`** — 15 patterns for ALTER TABLE operations with detailed comments
- **`sql/migrate_data_manipulation_patterns_v1.sql`** — 15 patterns for data manipulation with use cases

> **Note:** These reference migrations are for documentation/learning and should NOT be applied to production databases. They are included only to show best practices.

---

## Rollback Behaviour

| Scenario | Behaviour |
|----------|-----------|
| `_down.sql` exists | Runs the rollback SQL, removes the row from `schema_migrations` only after all statements succeed. MySQL DDL may commit implicitly. |
| Any selected `_down.sql` missing | Reports `no_down_file` for the barrier and blocks the entire selected rollback before SQL; all tracking records are preserved. CLI exits 1, including dry-run. |
| Selected companion exists but is not a readable file | Preflight fails before rollback SQL; no selected migration is reverted. |
| SQL error during rollback | Rolls back any still-active transaction and preserves the tracking record; throws the original SQL error with migration context. Already committed DDL changes remain. |

> **Note:** Many legacy migrations (pre-Sprint 1.4) do not have companion
> `_down.sql` files and cannot be automatically rolled back.  For those,
> manual SQL or a point-in-time backup restore is required.

Rollback preflight examines companions for all selected applied migrations
under the advisory lock before executing the first one. It never skips an
irreversible newer migration to roll back an older dependency, and a barrier
later in the selected range also prevents reverting the newer ones first.
The result remains `no_down_file` for API compatibility, but CLI treats that
result as an explicit blocked operation, not successful completion.
Unknown result statuses also fail instead of printing a successful summary.
Step-limited rollback checks only its selected range: an older barrier outside
that range does not prevent reverting a newer, reversible migration.

This preflight checks existence and readability, not SQL correctness or
semantic reversibility. Once execution begins, invalid SQL can still leave
partially committed DDL. A companion file is not proof that data recovery is
possible; use reviewed recovery procedures and tested backups.

---

## Transaction Safety

The runner begins a `PDO` transaction for each migration (up or down), but
**MySQL/MariaDB DDL is not transactionally reversible**:

- Pure DML against transactional tables (InnoDB) and the tracking update commit
  together; an SQL error rolls back the active transaction.
- Statements such as `CREATE TABLE`, `ALTER TABLE` and `DROP TABLE` implicitly
  commit on MySQL. Earlier changes and subsequent autocommitted statements can
  persist even if a later statement fails.
- The runner commits or rolls back only while `PDO::inTransaction()` is true.
  This prevents a secondary "There is no active transaction" error from masking
  the original failure.
- On failure after an implicit commit, the exception warns that changes may
  already be committed. A failed up-migration is not marked applied; a failed
  down-migration keeps its tracking record. Tracking therefore identifies
  completed migrations, not proof that no partial changes exist.

Back up the database before schema changes. Inspect and reconcile partial DDL
changes before retrying; do not blindly rerun a failed migration or assume a
companion down-file provides atomic recovery.

### Concurrent migration protection

`MigrationRunner::bootstrap()`, `runUp()` and `runRollback()` acquire a
nonblocking MySQL/MariaDB session advisory lock **before** tracking-table DDL
or reading the applied-migration list. The lock covers the entire run, not
individual migrations, including dry runs and final tracking updates.
Nested bootstrap calls use the already-held lock. Lock names are
`gq:migrations:` followed by the first 48 SHA256 characters of `DATABASE()`,
so different databases on the same server do not share a lock. Environment
labels, manifest paths and filesystem locations do not change its identity.

`GET_LOCK(name, 0)` returns immediately. If another connection owns the lock,
the runner fails explicitly; the CLI exits nonzero. Wait for the owning
deployment to finish, inspect its result, then retry. Do not delete tracking
rows or use `RELEASE_ALL_LOCKS` to bypass contention.

Session locks survive commits, rollbacks and MySQL DDL implicit commits.
They are released in `finally` and when the database connection closes.
A failed release is an error after an otherwise successful run. If an
operation already failed, release failures are logged without replacing the
original exception. Use a dedicated nonpersistent connection with a selected
database and no caller transaction; active MySQL transactions are rejected
before any changes so bootstrap cannot implicitly commit caller work.

This coordinates cooperating runners on one MySQL/MariaDB server, not
independent servers, manual SQL, old migration paths, base-schema import or
runtime DDL outside this runner. SQLite keeps the isolated unit-test behavior
and does not provide this advisory-lock guarantee; other drivers fail
explicitly. Status reads are informational snapshots, not locked migration
transactions. Migrations must not change the selected database or manipulate
these session locks.

### Applied-file integrity and deployment preflight

Before up or rollback, including previews and no-op runs, the runner validates
every **applied entry still in the current manifest** against its stored MD5
checksum under the migration lock. Missing/unreadable forward SQL or a checksum
mismatch stops the run before pending migrations or rollback statements execute.
All selected pending forward files are also checked for readability before the
first migration executes; a missing later file cannot leave an earlier DDL
migration applied. Step-limited up checks only the selected pending files, but
always verifies all manifest-listed applied files.

Checksums cover exact file bytes, including comments, whitespace and line endings.
Use immutable release files and consistent checkout line endings across
deployments. MD5 is retained for compatibility with existing tracking records;
this detects drift, not cryptographic authenticity. Files must not be modified
while a deployment is running. Pending SQL is not executed or syntax-validated
by preflight, so syntax errors can still leave partially committed DDL.

If a check fails, restore the originally applied SQL from its release artifact
and investigate the difference. Do not automatically overwrite checksums or
delete tracking rows. Fixes for already-deployed migrations belong in reviewed
new append-only migrations, with schema/data-specific upgrade verification.
Earlier source corrections documented here do not grant permission to rewrite
applied history: existing deployments with those older bytes now fail explicitly
until their original history and a reviewed upgrade path are reconciled.

`status` remains an informational tracking snapshot, not an integrity
certification; use `up --dry-run` to exercise integrity checks without applying
pending migrations. Up/rollback previews on a fresh database treat missing
tracking storage as empty and do not create any tables or execute migration
SQL. They still acquire/release the session advisory lock. Explicit `bootstrap()`,
CLI `status` and real up/rollback runs can create tracking storage on first use.
Only an actual missing-table error triggers bootstrap: MySQL SQLSTATE `42S02`
with driver code 1146, or SQLite's specific missing `schema_migrations` error.
Permission failures, disconnections, locks and unrelated SQL errors propagate
unchanged rather than being replaced by bootstrap errors.
Tracking rows absent from the current manifest are not validated by this
check; reconciliation of historical/alternative migration paths remains open.
Rollback companions have no stored checksum and are not authenticated by the
forward-file check. A backup/restore rehearsal remains mandatory.

### MySQL regression gate

`tests/Integration/MigrationRunnerMySqlTest.php` creates a randomly named
`gq_migration_test_*` database per test and drops only that database afterwards.
It requires an explicitly configured MySQL test server and credentials with
CREATE/DROP DATABASE privileges:

```powershell
$env:GQ_MIGRATION_TEST_DSN = 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4'
$env:GQ_MIGRATION_TEST_USER = 'root'
$env:GQ_MIGRATION_TEST_PASSWORD = '<test-server-password>'
php vendor/bin/phpunit tests/Integration/MigrationRunnerMySqlTest.php --no-coverage --do-not-cache-result --fail-on-warning --fail-on-risky --fail-on-phpunit-deprecation
```

Without `GQ_MIGRATION_TEST_DSN`, these tests are explicitly skipped. CI sets all
three variables and runs this gate before legacy schema initialization, against
its disposable MySQL 8.4 service.

This gate includes runner regression tests and a complete fresh-install test.
It also verifies contention using separate PDO connections, rejection before
tracking-table creation, ownership through DDL and rollback, release after
bootstrap/up/down failures, caller-transaction preservation and database-scope
isolation. `tests/Unit/MigrationLockTest.php` covers unavailable locks, nested
acquisition and release-failure handling with fault injection.
Checksum regressions verify up/rollback previews, unchanged data and tracking
after rejection, removal of an applied file and missing later pending files,
including lock release. SQLite tests additionally cover manifest validation
and checksum failure before any pending SQL.
Fresh-preview tests omit or invalidate bootstrap SQL and verify zero tables,
then verify normal execution still bootstraps. A real MySQL account with CREATE
but no SELECT privilege verifies that tracking permission errors remain 1142
in both normal and preview modes and that the advisory lock is released.
This test additionally requires CREATE USER / DROP USER / GRANT privileges on
the explicitly disposable test server.
The fresh-install test uses a randomly named database, removes only the explicit
`CREATE DATABASE galaxyquest` / `USE galaxyquest` directives from test copies,
and preserves canonical manifest order. It verifies every applied name, tracking
checksum, environment and a no-op second run. Checksums in this isolated fixture
refer to these test copies; deployment tracking uses the original SQL files.
All 84 MariaDB-only conditional ALTER operations in the canonical manifest now
use the existing `information_schema` + `PREPARE` pattern. Each column, index
or constraint is checked independently, so partially applied ALTER groups can
be resumed without adding already-existing objects. Six MySQL test cases read
the actual SQL guards, verify every object exists after application and check
that column definitions, defaults, comments and indexes survive reexecution.
These tests isolate the guards; they do not validate all migration data changes.
A database-independent test rejects reintroduced conditional ALTER syntax.

The complete `migrate_v2.sql` now applies to the current `schema.sql` in a
randomly named MySQL test database. Four legacy data backfills check for their
source columns before execution: `planets.user_id`, `buildings.planet_id`,
`ships.planet_id` and `fleets.origin_planet_id`. When those columns are absent,
the current colony-based model is already in use and no legacy data is copied.
When present, the original backfills still run; missing other required columns
remain errors rather than silently discarding data. Regression fixtures verify
ownership, resources, homeworld flags and timestamps, preserve non-null colony
links, exclude unowned planets and check repeat execution.

The v2 TEXT defaults use MySQL's expression-default syntax (`DEFAULT ('{}')`).
The colony-building-slot foreign key uses signed `INT` to match `colonies.id`;
actual MySQL tests verify cascading colony-ID updates and deletion of slots
and their upgrade queue.

The unified-bodies hardcut also checks for legacy report source columns:
`battle_reports.planet_id` and `spy_reports.target_planet_id`. If present, these
legacy values refer to colony IDs and are mapped through `colonies.body_id`.
Only null target body IDs are backfilled; existing body identities are retained.
Unmatched reports remain null rather than receiving an invented identity.
Adding `spy_reports.target_body_id` no longer depends on a legacy column's
position. MySQL fixtures cover both report schemas, missing target columns,
repeat application and the complete hardcut on the actual current base schema.

NPC FTL assignment uses the canonical `npc_faction_memberships` user-to-faction
mapping, also written by the homeworld seeder. The v12 migration creates this
table before assignment with the same definition as the later homeworld
migration; no existing manifest entry is reordered. It does not invent
memberships for unaffiliated users or rely on an undefined `faction_colonies`
table. The NPC assignment runtime and fleet diplomacy's primary faction lookup
use the same membership source. Database errors in these primary lookups
propagate instead of silently acting as missing membership.

Both migration and runtime preserve human accounts and existing non-default
drives. Tests verify the five faction drive mappings, their `pve_*` aliases,
unaffiliated NPCs and repeat runtime assignment. Runtime assignment checks
the NPC control type and default drive again in its UPDATE.
Already tracked v12 migrations are not automatically replayed; use the corrected
NPC runtime for assignment after canonical memberships have been populated.
Deploy the membership schema before the updated runtime.

The marketplace/advisor migration no longer contains duplicated sections or
stored procedures requiring client `DELIMITER` handling. Eight profile columns
use independent `information_schema` guards, compatible with both the runner
and SQL clients. MySQL fixtures start with an existing rarity column and verify
that missing columns are added while profile values, marketplace entries and
advisor hints survive reexecution. Marketplace backstory remains required with
no default, matching the original first table definition.

Projection timestamp backfill now compares legacy zero dates as strings, avoiding
invalid DATETIME coercion under strict SQL mode. The migration remembers whether
`created_at` existed before ALTERs: newly added timestamps receive historical
`enqueued_at` values, while valid preexisting timestamps are preserved. NULL and
zero-date values are repaired from `enqueued_at`. Regression fixtures verify both
schema states and repetition; the migration does not relax the session SQL mode.

All MySQL regression tests use native PDO prepares, matching `get_db()`.
The SQL splitter preserves backslash-escaped quotes and backslashes in strings,
so species names such as `Vor\'Tak` do not merge adjacent INSERT statements.
World-scenario TEXT defaults use expression syntax, retaining `[]` and `{}`.

Update-system administrator references now target `users`, the actor-model
storage table. Seed configuration entries are inserted only when missing;
reexecution preserves configured values. Tests verify configuration retention
and `ON DELETE SET NULL` for history and configuration audit references.

The complete current manifest now applies **72 migrations** to a fresh MySQL
8.4 database using native prepares; the isolated full-manifest regression checks
deployment verification and a no-op second run. The preceding real image
acceptance applied and verified 69 entries / 1,089 statements; the glossary
addition has not received a new image acceptance. Earlier CLI validation with application-schema
restricted credentials covered the preceding manifest. This is not a complete
populated legacy-upgrade or production restore rehearsal.

CI initializes `sql/schema.sql`, then runs the canonical migration CLI instead
of an alphabetical wildcard loop. Down migrations, maintenance SQL and learning
examples are therefore not accidentally executed. The remote CI run remains
to be verified, and runtime schema completeness beyond the manifest is a
separate audit requirement.
Do not mark a failed migration as applied to bypass this incompatibility.

The corrected SQL files have new checksums. Existing applied tracking records
are retained and migrations are not automatically replayed; do not delete those
records simply to update checksums. Review partial schema changes before retrying
a previously failed migration.

---

## Environments

The `--env` flag (or `GQ_ENV` environment variable) tags each migration
record.  Recommended labels: `DEV`, `TEST`, `PROD`.  This allows you to audit
which environment first applied each migration.

---

## Relationship to `setup.php`

`setup.php` is the **initial bootstrap** script (fresh install + NPC seeding).
`scripts/migrate.php` is the **incremental upgrade** tool for existing
deployments.  In a typical CI/CD pipeline:

1. **Fresh install:** `php setup.php`
2. **Incremental upgrade:** `php scripts/migrate.php up`
3. **Preview before release:** `php scripts/migrate.php up --dry-run`

---

## CI/CD Integration Example

```yaml
# .github/workflows/deploy.yml (excerpt)
- name: Run pending DB migrations
  run: GQ_ENV=PROD php scripts/migrate.php up
  env:
    DB_HOST: ${{ secrets.DB_HOST }}
    DB_NAME: ${{ secrets.DB_NAME }}
    DB_USER: ${{ secrets.DB_USER }}
    DB_PASS: ${{ secrets.DB_PASS }}
```
