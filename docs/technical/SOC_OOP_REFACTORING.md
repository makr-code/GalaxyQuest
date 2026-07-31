# SOC/OOP Architecture Refactoring

**Status**: In Progress (Phase 1-2 active)  
**Started**: 2026-07-31  
**Owner**: Core Team (Backend + Frontend)

---

## Overview

GalaxyQuest is migrating from a procedural, monolithic architecture toward a layered, Domain-Driven Design (DDD) structure with clear Separation of Concerns (SOC) and Object-Oriented Programming (OOP) principles.

This refactoring is implemented incrementally using the **Strangler Fig Pattern**: new code coexists with legacy, old code gradually gets replaced, zero disruption to users.

### Why This Matters

- **Testability**: Isolated layers are easier to unit test
- **Maintainability**: Clear responsibility separation reduces cognitive load
- **Scalability**: Feature toggles + vertical slices enable team parallelism
- **Quality**: Architecture rules enforced via CI (no SQL in Presentation, etc.)

---

## Target Architecture

### Layered Structure

```
┌─────────────────────────────────────┐
│  Presentation Layer                 │
│  (Controllers, HTTP handling)        │  ← Only HTTP I/O, no business logic
│  src/*/Presentation/                │     No SQL statements
└─────────────────┬───────────────────┘
                  │ calls
                  ▼
┌─────────────────────────────────────┐
│  Application Layer                  │
│  (Use Cases, Services, Orchestration)│  ← Coordinates Domain + Repositories
│  src/*/Application/                 │     No HTTP, no persistence details
└─────────────────┬───────────────────┘
                  │ uses
                  ▼
┌─────────────────────────────────────┐
│  Domain Layer                       │
│  (Business Rules, Value Objects)    │  ← Pure logic, framework-agnostic
│  src/*/Domain/                      │     No PDO, no HTTP, no side effects
└─────────────────┬───────────────────┘
                  │ implements
                  ▼
┌─────────────────────────────────────┐
│  Infrastructure Layer               │
│  (Repositories, Adapters, External) │  ← Database, file system, APIs
│  src/*/Infrastructure/              │     Implements Domain interfaces
└─────────────────────────────────────┘
```

### Bounded Contexts (Bounded Contexts = Mini-Domains)

Each bounded context is a vertical slice with all 4 layers:

| Context | Focus | Status | Owner |
|---------|-------|--------|-------|
| **Shared** | Error envelopes, RequestContext, support utils | ✅ Phase 1 Complete | Core |
| **Galaxy** | Star systems, coordinates, viewport queries | 🔄 Phase 1-2 Active | Backend Lead |
| **Identity** | Login, logout, session, CSRF, 2FA | ⏳ Phase 2 Planned | Auth Lead |
| **Colony** | Resources, buildings, research, shipyard | ⏳ Phase 2 Planned | Gameplay Lead |
| **Fleet** | Missions, flight times, recall, combat | ⏳ Phase 2 Planned | Combat Lead |
| **Diplomacy** | Factions, standing, trade offers, quests | ⏳ Phase 3 Planned | Diplomacy Lead |
| **Messaging** | Inbox, read, send, delete, notifications | ⏳ Phase 3 Planned | Social Lead |

---

## Shared Foundation (Phase 1 Complete)

### `src/Shared/Http/`

**ApiResponse.php**
- Unified success/error envelope for all responses
- Metadata: trace_id, timestamp
- JSON-serializable for API consumption

**ApiError.php**
- Error code registry (9 codes: AUTH_UNAUTHORIZED, VALIDATION_FAILED, etc.)
- Prevents ad-hoc error messages
- Supports optional details for debugging

**RequestContext.php**
- Encapsulates authenticated user, CSRF token, session ID
- Injected into controllers instead of using $_SESSION directly
- Enables testing without session bootstrapping

---

## Galaxy Context (Phase 1-2 In Progress)

### Directory Structure

```
src/Galaxy/
├── Domain/
│   ├── Interfaces/
│   │   └── GalaxyRepositoryInterface.php
│   └── RangeValidator.php              ← Business rules for coordinate ranges
├── Application/
│   ├── GetStarsRangeService.php        ← Use case: fetch systems in range
│   └── GetSystemPayloadService.php    ← Use case: fetch single system
├── Infrastructure/
│   ├── Interfaces/
│   │   └── SystemPayloadEncoderInterface.php
│   ├── PdoGalaxyRepository.php         ← Queries star_systems table
│   └── Encoders/
│       ├── JsonSystemPayloadEncoder.php
│       └── BinarySystemPayloadEncoder.php
└── Presentation/
    └── GalaxyController.php            ← HTTP handlers
```

### Key Design Decisions

1. **Repository Pattern**
   - All database access through `GalaxyRepositoryInterface`
   - `PdoGalaxyRepository` implements with prepared statements
   - Enables mock testing without database

2. **Encoder Strategy**
   - `SystemPayloadEncoderInterface` abstracts output format
   - JSON encoder for debugging / web clients
   - Binary encoder for optimal bandwidth (future optimization)

3. **Error Handling**
   - Throws `\DomainException` if system not found
   - Controller catches and translates to `ApiError`
   - No raw exceptions leaked to API consumer

4. **Validation**
   - `RangeValidator` enforces business rules (coordinate bounds, range size limits)
   - Domain service, no framework dependencies
   - Testable in isolation

### Frontend Architecture (`js/features/galaxy/`)

```
js/services/
└── api-client.js              ← HTTP client with retry logic

js/features/galaxy/
├── galaxy-service.js           ← Application service (orchestrates API calls)
├── galaxy-controller.js        ← UI controller (manages DOM, events, state)
└── legacy-bridge.js            ← Adapter pattern for gradual migration
```

**Data Flow**:
```
User clicks "Load Systems"
  │
  ▼
GalaxyController.loadViewport()
  │ calls
  ▼
GalaxyService.getStarsRange()
  │ calls
  ▼
ApiClient.get('/api/galaxy/range', params)
  │ HTTP request
  ▼
GalaxyController (PHP) → GetStarsRangeService → PdoGalaxyRepository → star_systems table
  │ HTTP response (ApiResponse envelope)
  ▼
ApiClient parses & retries on errors
  │ result
  ▼
GalaxyController.renderSystems()
  │ DOM update
  ▼
Map displays systems
```

---

## API Response Format (Unified Envelope)

All endpoints return the same structure:

**Success (200 OK):**
```json
{
  "success": true,
  "data": {
    "systems": [...],
    "total_count": 250,
    "range_min": {"x": 0, "y": 0},
    "range_max": {"x": 100, "y": 100}
  },
  "meta": {
    "trace_id": "abc123...",
    "ts": 1722435015684
  }
}
```

**Error (4xx/5xx):**
```json
{
  "success": false,
  "error": {
    "code": "GALAXY_RANGE_INVALID",
    "message": "Range size must not exceed 1000 light-years",
    "details": { "x_range": 1500, "max_allowed": 1000 }
  },
  "meta": {
    "trace_id": "abc123...",
    "ts": 1722435015684
  }
}
```

**Error Codes Registry** (see `src/Shared/Http/ApiError.php`):
- `AUTH_UNAUTHORIZED` – user not authenticated
- `AUTH_CSRF_INVALID` – CSRF token expired/invalid
- `VALIDATION_FAILED` – input validation failed
- `GALAXY_RANGE_INVALID` – range constraints violated
- `GALAXY_SYSTEM_NOT_FOUND` – system at coordinates doesn't exist
- `COLONY_NOT_FOUND` – colony lookup failed
- `FLEET_NOT_FOUND` – fleet lookup failed
- `NETWORK_UNREACHABLE` – external service unavailable
- `INTERNAL_ERROR` – server-side error (generic fallback)

---

## Architecture Rules (Enforced)

### Rule 1: No SQL in Presentation Layer
- Controllers must not contain `SELECT`, `INSERT`, etc.
- All data access goes through injected repositories
- **Tool**: `tools/arch-lint.php` checks this in CI

### Rule 2: No HTTP in Domain Layer
- Domain classes must not know about `$_GET`, `$_POST`, HTTP status codes
- Domain stays framework-agnostic (testable with POJO)

### Rule 3: No PDO in Application/Domain
- Application/Domain don't reference PDO, prepared statements, or table schemas
- Abstracted behind repository interfaces

### Rule 4: All Public APIs Use ApiError/ApiResponse
- No heterogeneous error formats
- Controllers use: `ApiResponse::success($data)` or `ApiResponse::error($error)`

### Rule 5: Dependencies Injected, Not Static
- Controllers receive repositories in constructor, not `global` or `static`
- Enables testing with mocks

### Rule 6: Tests for Every Public Service/Use Case
- Minimum: happy path + 1 error case
- Unit tests for pure logic (Domain/Application)
- Integration tests for repositories against test database

---

## CI Gates

**Architecture Lint** (`tools/arch-lint.php`):
- ✅ No SQL in Presentation layer
- ✅ No HTTP/PDO in Domain layer
- ✅ All error codes from registry

**Test Gate** (PHPUnit):
- ✅ Unit tests pass
- ✅ Code coverage ≥ 80% for new code

**Linting** (PHP CS Fixer):
- ✅ PSR-12 style compliance
- ✅ Type hints on all functions

**Release Gate**:
- ✅ Smoke test: login → load galaxy → click system
- ✅ Performance: p95 latency < 1s
- ✅ No new warnings/errors in logs

---

## Migration Playbook (Next Contexts)

When starting a new bounded context (e.g., Identity/Auth):

1. **Define Interfaces** (Domain layer)
   - Create `src/Identity/Domain/Interfaces/UserRepositoryInterface.php`
   - Define methods needed by business logic

2. **Implement Domain Logic** (Domain layer)
   - Pure functions: no side effects, testable in isolation
   - Example: `LoginValidator`, `PasswordHasher`

3. **Write Application Services** (Application layer)
   - Orchestrate Domain + Repositories
   - Example: `LoginService` calls `UserRepository` + `LoginValidator`

4. **Implement Repository** (Infrastructure layer)
   - Queries real database (MySQL)
   - Implements Domain interface
   - Uses prepared statements

5. **Build Controller** (Presentation layer)
   - Parses HTTP input
   - Calls Application service
   - Returns `ApiResponse::success()` or `ApiResponse::error()`

6. **Write Tests**
   - Unit: Domain validators (no DB)
   - Integration: Repository against test DB
   - Contract: API envelope schema

7. **Create Legacy Bridge** (if replacing old code)
   - Adapter intercepts old API calls
   - Routes to new service if healthy, else fallback

8. **Deploy & Monitor**
   - Feature flag for new implementation
   - Monitor error rate, p95 latency
   - Keep flag on for at least 2 releases

---

## Documentation & Tools

- **[docs/adr/](../adr/)** – Architecture Decision Records (ADR-001, ADR-002, ...)
- **[docs/technical/MIGRATION_PROGRESS.md](./MIGRATION_PROGRESS.md)** – Status tracker
- **[tools/arch-lint.php](../../tools/arch-lint.php)** – Linter for architecture rules
- **[phpunit.xml](../../phpunit.xml)** – Test runner configuration

---

## FAQ

**Q: Why not rewrite everything at once (Big Bang)?**
A: Big Bang risks regression, long-lived branches, team bottlenecks. Strangler Fig: keep the system live while migrating piece by piece.

**Q: How do we handle cross-context dependencies?**
A: Use event-driven architecture (publish system events) or query repositories in Application layer. Avoid deep coupling. Details in ADR-003 (future).

**Q: What about performance?**
A: Layering adds indirection (~5% overhead). Mitigated by: opcode caching (OPcache), database query optimization, binary encoding for large payloads.

**Q: Can old code and new code coexist?**
A: Yes. Legacy bridge translates calls. Once new code is stable, old code can be deleted. Gradual migration = safe migration.

**Q: How long does this take?**
A: ~6-8 weeks for all contexts at current pace (2-3 batches/week). Parallelizable: different teams work on different contexts.

---

## References

- [MIGRATION_STRATEGY_OOP.md](./MIGRATION_STRATEGY_OOP.md) – Original strategic plan
- [MIGRATION_PROGRESS.md](./MIGRATION_PROGRESS.md) – Real-time status & burndown
- [ADR-001: Error Envelope](../adr/ADR-001-error-envelope.md)
- [ADR-002: Galaxy Interfaces](../adr/ADR-002-galaxy-interfaces.md)
