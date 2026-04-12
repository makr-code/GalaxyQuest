# tests/scripts/

Standalone CLI diagnostic and smoke-test scripts.

These scripts are **not** part of the PHPUnit test suite.  They are one-shot
command-line tools intended to be run manually against a running GalaxyQuest
environment for quick sanity-checks or diagnostics.

## Usage

Run from the **project root** (or with PHP's `-d include_path` option):

```sh
# From project root
php tests/scripts/test_trader_lifecycle.php
php tests/scripts/test_wd_gen.php
```

All scripts resolve their dependencies via `__DIR__ . '/../../...'` paths so
they work correctly from any working directory.

## Files

| File | Purpose |
|---|---|
| `test_db_cli.php` | Basic DB connectivity check |
| `test_e2e_faction_gen.php` | E2E faction generation smoke test |
| `test_faction_files.php` | Faction YAML/JSON file validation |
| `test_faction_prompts.php` | LLM prompt template validation |
| `test_faction_quick.php` | Quick faction loading check |
| `test_lifecycle_sql.sql` | Trader lifecycle SQL dump for manual inspection |
| `test_pop_satisfaction_phase1.php` | Population satisfaction phase-1 smoke |
| `test_species_loading.php` | Species loading and profile-gen check |
| `test_system_planets.php` | Planet generation validation |
| `test_trader_lifecycle.php` | Trader lifecycle function smoke test |
| `test_trader_setup.sql` | Trader test-data SQL seed |
| `test_traders_complete.php` | Full trader system end-to-end smoke |
| `test_wd_gen.php` | White-dwarf star generation validation |
