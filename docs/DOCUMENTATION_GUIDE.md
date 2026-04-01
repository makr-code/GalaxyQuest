# Documentation Guide — GalaxyQuest

This guide explains how the documentation is organised and how to navigate it effectively.

---

## Where to Start

| Goal | Document |
|---|---|
| **Install the project** | [../README.md](../README.md) — Docker setup, Quick Start |
| **Understand the architecture** | [ARCHITECTURE.md](ARCHITECTURE.md) — technical reference |
| **Understand game mechanics** | [GAMEPLAY_DATA_MODEL.md](GAMEPLAY_DATA_MODEL.md) |
| **See all docs at a glance** | [INDEX.md](INDEX.md) — full documentation index |

---

## Documentation Layout

All documentation (except the project README) lives in `docs/`.

```
docs/
├── INDEX.md                   ← Navigation index for all docs
├── ARCHITECTURE.md            ← Technical architecture reference
├── DOCUMENTATION_GUIDE.md     ← This file
├── GAMEPLAY_DATA_MODEL.md     ← Game mechanics and data model
├── GAMEDESIGN.md              ← Full game design document
├── webgpu_architecture.md     ← WebGPU engine architecture
├── FTL_DRIVE_DESIGN.md        ← FTL drive system design
├── VESSEL_MODULE_BLUEPRINT_DESIGN.md ← Vessel blueprint system
├── ROADMAP.md                 ← Development roadmap
├── FUTURE_ENHANCEMENTS.md     ← Planned features
└── …
```

---

## Document Categories

### 🏗️ Technical Docs (for developers)

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — The main technical reference covering:
  backend (PHP), frontend (JS), WebGPU engine, database schema, security, testing, and extension points.
- **[GAMEPLAY_DATA_MODEL.md](GAMEPLAY_DATA_MODEL.md)** — Game formulas, resource model, and mechanics.
- **[PROJECTION_RUNBOOK.md](PROJECTION_RUNBOOK.md)** — Operations guide for the projection runtime.
- **[MIGRATION_STRATEGY_OOP.md](MIGRATION_STRATEGY_OOP.md)** — Refactoring conventions.
- **[webgpu_architecture.md](webgpu_architecture.md)** — Engine internals.

### 🎮 Game Design Docs

- **[GAMEDESIGN.md](GAMEDESIGN.md)** — The definitive game design document.
- **[ARCHITECTURE_GAMEDESIGN.md](ARCHITECTURE_GAMEDESIGN.md)** — How the design docs are structured.
- **[FTL_DRIVE_DESIGN.md](FTL_DRIVE_DESIGN.md)** — FTL drive mechanics and balancing.
- **[VESSEL_MODULE_BLUEPRINT_DESIGN.md](VESSEL_MODULE_BLUEPRINT_DESIGN.md)** — Ship building system.

### ⚡ Performance & Encoding

- **[BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md)** and **[BENCHMARK_QUICKSTART.md](BENCHMARK_QUICKSTART.md)**
- **[BINARY_ENCODING_V2.md](BINARY_ENCODING_V2.md)** — Binary network protocol V2.
- **[DELTA_ENCODING_V3.md](DELTA_ENCODING_V3.md)** — Delta encoding V3.

---

## API Documentation

Backend API endpoints are documented inline in their PHP source files (`api/*.php`).
Each file begins with a block comment listing its actions and request format.

Example: `api/politics.php` starts with:
```
GET  /api/politics.php?action=catalog
GET  /api/politics.php?action=status
POST /api/politics.php?action=configure
     body: {primary_species_key, government_key, civic_keys: []}
```

The frontend API contract validators are in `js/network/api-contracts.js`.

---

## Contribution Guidelines

### Code Style

- **PHP**: PSR-12-ish, no framework, PDO prepared statements only.
- **JavaScript**: ES2020+, `'use strict'`, no build step, no framework, no bundler in source.
- **SQL**: `UPPER CASE` keywords, `snake_case` identifiers, `IF NOT EXISTS` in migrations.

### Adding a New Feature

1. Check [ARCHITECTURE.md § Extension Points](ARCHITECTURE.md#11-extension-points) for the right pattern.
2. Add a SQL migration in `sql/migrate_<feature>_vN.sql`.
3. Implement the backend in `api/<domain>.php`.
4. Implement the frontend in `js/runtime/game.js` or a new `js/ui/` component.
5. Add tests in `tests/Unit/` (PHP) and/or `tests/js/` (Vitest).
6. Update this documentation if the architecture changes.

### Commit Messages

Use imperative mood: `Add FTL gate survey mission`, `Fix alliance join race condition`.

---

## Running Tests

```bash
# PHP unit tests
docker compose exec web vendor/bin/phpunit

# JavaScript tests (Vitest, no GPU required)
npm test

# End-to-end tests (Playwright)
npx playwright test
```

---

## Getting Help

- Open an issue on GitHub
- Check [START_HERE.md](START_HERE.md) for orientation
- Check [DEV_USERS.md](DEV_USERS.md) for pre-seeded dev accounts
