# Headless Simulation Engine (Phase 1 Slice)

This introduces an explicit simulation runtime path independent from frontend rendering.

## What is included

- Runtime orchestrator: `/home/runner/work/GalaxyQuest/GalaxyQuest/api/simulation_runtime.php`
- Manual trigger endpoint: `/home/runner/work/GalaxyQuest/GalaxyQuest/api/simulation_tick.php`
- Scheduler entry point: `/home/runner/work/GalaxyQuest/GalaxyQuest/scripts/run_simulation_tick.php`
- Canonical event taxonomy: `/home/runner/work/GalaxyQuest/GalaxyQuest/config/simulation_event_taxonomy.json`
- Deterministic shard locator: `/home/runner/work/GalaxyQuest/GalaxyQuest/src/Simulation/Domain/ShardLocator.php`

## Runtime mode

- Single persistent galaxy mode remains active.
- Simulation side-effects on overview reads are now feature-flagged:
  - `SIMULATION_TICK_ON_READ_ENABLED=0` (default, recommended)
  - `SIMULATION_TICK_ON_READ_ENABLED=1` (legacy compatibility)

## Trigger ticks

### CLI (scheduler-friendly)

```bash
php /home/runner/work/GalaxyQuest/GalaxyQuest/scripts/run_simulation_tick.php --scope=global
php /home/runner/work/GalaxyQuest/GalaxyQuest/scripts/run_simulation_tick.php --scope=user --user=123
php /home/runner/work/GalaxyQuest/GalaxyQuest/scripts/run_simulation_tick.php --scope=global --force
```

### HTTP (manual/admin)

```http
POST /api/simulation_tick.php?action=run
X-CSRF-Token: <token>
Content-Type: application/json

{"scope":"global","force":false}
```

`scope=global` requires admin privileges. `scope=user` defaults to the current user.

