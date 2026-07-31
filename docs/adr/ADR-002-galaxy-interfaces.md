# ADR-002: Galaxy Context Interface Contracts

**Date**: 2026-07-31

**Status**: Accepted

**Context**

The Galaxy Bounded Context handles all star system queries, coordinate ranges, and system payloads.

To decouple Application services from implementation details, we define contracts (interfaces) for:
1. **Data Access** – `GalaxyRepositoryInterface` (Domain layer)
2. **Encoding** – `SystemPayloadEncoderInterface` (Infrastructure layer)

These interfaces enable:
- Swappable implementations (PDO, ThemisDB, mock)
- Testability via mock objects
- Clear responsibility separation

**Decision**

### 1. GalaxyRepositoryInterface (Domain)

Located: `src/Galaxy/Domain/Interfaces/GalaxyRepositoryInterface.php`

Responsibilities:
- Query systems by coordinates
- Fetch ranges of systems (for viewport/sector loading)
- Count systems in range (for pagination)
- Search systems by name prefix

Implementation constraints:
- No HTTP knowledge
- No encoding/formatting logic
- Pure data access contract
- Throws `\DomainException` on not-found

### 2. SystemPayloadEncoderInterface (Infrastructure)

Located: `src/Galaxy/Infrastructure/Interfaces/SystemPayloadEncoderInterface.php`

Responsibilities:
- Convert system data array to output format (JSON, binary, etc.)
- Report MIME type for Content-Type header
- Report encoding name for metadata

Implementations:
- `JsonSystemPayloadEncoder` – for debugging/web clients
- `BinarySystemPayloadEncoder` – for optimal bandwidth

Implementation constraints:
- Must be deterministic (same input → same output)
- No side effects
- Supports multiple output formats

**Consequences**

**Positive:**
- Application services remain agnostic of storage/encoding
- Easy to test with mock repositories
- Easy to add new encodings without touching domain
- Clear separation between business logic and infrastructure

**Negative:**
- Adds abstraction layers (slight indirection)
- Implementations must satisfy interface contract

**Implementation**

Phase 1: Define interfaces and stubs
Phase 2: Implement `PdoGalaxyRepository` against real database
Phase 3: Test with both JSON and Binary encoders
Phase 4: Measure performance; optimize if needed
