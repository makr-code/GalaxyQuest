<!-- This file is too large to display in full; showing sections -->
# SOC/OOP Migration Playbook

**Purpose**: Template and step-by-step guide for migrating new bounded contexts following the Galaxy pattern.

**Audience**: Backend/Frontend developers implementing new SOC (Service-Oriented Context) modules.

**Updated**: 2026-07-31

---

## Table of Contents

1. [Overview](#overview)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Phase 0: Context Scaffolding](#phase-0-context-scaffolding)
4. [Phase 1: Backend Implementation](#phase-1-backend-implementation)
5. [Phase 2: Frontend Integration](#phase-2-frontend-integration)
6. [Phase 3: Testing & Validation](#phase-3-testing--validation)
7. [Phase 4: CI Integration & Documentation](#phase-4-ci-integration--documentation)
8. [Common Patterns & Anti-Patterns](#common-patterns--anti-patterns)
9. [Troubleshooting](#troubleshooting)

---

## Overview

This playbook documents the **Galaxy bounded context pattern** proven in Batches 1-6. The approach:

1. **Layer-based architecture**: Domain → Application → Infrastructure → Presentation
2. **Interface-driven design**: Contracts before implementations
3. **Gradual migration**: Old and new code coexist via integration bridge
4. **Test-first validation**: Unit → Integration → Contract → Performance tests
5. **CI-enforced rules**: Linting and contract tests on every PR

### Context Structure Template

```
src/{ContextName}/
├── Domain/
│   ├── Interfaces/
│   │   └── {Model}RepositoryInterface.php       # Data access contract
│   ├── {Model}Entity.php                        # Value objects, rules
│   └── {Validator}Validator.php                 # Business logic validation
├── Application/
│   └── Get{Resource}Service.php                 # Use cases, orchestration
├── Infrastructure/
│   ├── Interfaces/
│   │   └── {Payload}EncoderInterface.php        # Serialization contract
│   ├── Pdo{Context}Repository.php               # Real database access
│   └── Encoders/
│       ├── Json{Payload}Encoder.php             # JSON serialization
│       └── Binary{Payload}Encoder.php           # Binary serialization (optional)
└── Presentation/
    └── {Context}Controller.php                  # HTTP handlers

js/features/{context}/
├── {Context}Service.js                         # Frontend business logic
├── {Context}Controller.js                       # State management
├── legacy-bridge.js                             # Adapter for old code
└── tests/
    └── {context}.test.js                        # Integration tests
```

---

## Pre-Migration Checklist

Before starting implementation, complete:

- [ ] Database schema designed and migrated (use `sql/migrate_*.sql` pattern)
- [ ] Entity models defined (what data does this context manage?)
- [ ] Use cases documented (what operations on that data?)
- [ ] Error scenarios identified (what can go wrong?)
- [ ] Legacy integration points mapped (which old endpoints to replace?)
- [ ] Team agreed on context name and scope
- [ ] Performance requirements established (latency targets, throughput)

### Example: Identity/Auth Context

**What it manages**: Users, roles, permissions, tokens

**Key entities**: UserEntity, RoleEntity, PermissionEntity

**Use cases**: RegisterUser, AuthenticateUser, RefreshToken, UpdatePermissions

**Error scenarios**: InvalidCredentials, UserNotFound, TokenExpired, PermissionDenied

**Legacy integration**: Replace old `api/auth.php` procedural code

**Performance targets**: Login <200ms p95, Token refresh <50ms p95

---

## Phase 0: Context Scaffolding

### Step 1: Create Directory Structure

```bash
# Backend
mkdir -p src/{ContextName}/{Domain,Application,Infrastructure,Presentation}
mkdir -p src/{ContextName}/Domain/Interfaces
mkdir -p src/{ContextName}/Infrastructure/Interfaces
mkdir -p src/{ContextName}/Infrastructure/Encoders
mkdir -p tests/Unit/{ContextName}

# Frontend
mkdir -p js/features/{context}
mkdir -p tests/js/features
```

### Step 2: Create Repository Interface

**File**: `src/{ContextName}/Domain/Interfaces/{Model}RepositoryInterface.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\{ContextName}\Domain\Interfaces;

/**
 * {Model}RepositoryInterface – Data access contract for {context} bounded context.
 *
 * Implementations must provide all CRUD operations without leaking SQL details.
 * All queries are read-only; mutations through Application layer only.
 */
interface {Model}RepositoryInterface
{
    /**
     * Retrieve a single {model} by primary key.
     *
     * @param mixed $id Unique identifier
     *
     * @return array<string, mixed>|null The {model} data or null if not found
     */
    public function get($id): ?array;

    /**
     * Retrieve multiple {models} matching criteria.
     *
     * @param array<string, mixed> $criteria Filter conditions
     * @param array<string> $orderBy Sort fields
     * @param int $limit Result limit
     * @param int $offset Skip N results
     *
     * @return array<int, array<string, mixed>> Matching records
     */
    public function find(array $criteria = [], array $orderBy = [], int $limit = 100, int $offset = 0): array;

    /**
     * Check if a {model} exists.
     *
     * @param mixed $id Unique identifier
     *
     * @return bool True if exists, false otherwise
     */
    public function exists($id): bool;

    /**
     * Count total {models} matching criteria.
     *
     * @param array<string, mixed> $criteria Filter conditions
     *
     * @return int Count of matching records
     */
    public function count(array $criteria = []): int;
}
```

### Step 3: Create Encoder Interface (if serialization needed)

**File**: `src/{ContextName}/Infrastructure/Interfaces/{Payload}EncoderInterface.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\{ContextName}\Infrastructure\Interfaces;

/**
 * {Payload}EncoderInterface – Serialization contract for {context} data.
 *
 * Multiple implementations allow JSON, binary, or other formats without domain knowledge.
 */
interface {Payload}EncoderInterface
{
    /**
     * Encode data to serialized format.
     *
     * @param array<string, mixed> $data Input data
     *
     * @return string|array<string, mixed> Encoded result
     */
    public function encode(array $data);

    /**
     * Get MIME type for encoded format.
     *
     * @return string MIME type (e.g., application/json)
     */
    public function getMimeType(): string;

    /**
     * Get encoding name for Content-Encoding header.
     *
     * @return string Encoding name (e.g., utf-8)
     */
    public function getEncodingName(): string;
}
```

---

## Phase 1: Backend Implementation

### Step 1: Implement Repository

**File**: `src/{ContextName}/Infrastructure/Pdo{Context}Repository.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\{ContextName}\Infrastructure;

use PDO;
use GalaxyQuest\{ContextName}\Domain\Interfaces\{Model}RepositoryInterface;

class Pdo{Context}Repository implements {Model}RepositoryInterface
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function get($id): ?array
    {
        // SELECT * FROM {table} WHERE id = ?
        // Return single row or null
        // Never return raw PDO results; always map to domain model
    }

    public function find(array $criteria = [], array $orderBy = [], int $limit = 100, int $offset = 0): array
    {
        // Build dynamic query from $criteria
        // Apply $orderBy, $limit, $offset
        // Validate $limit (default 100, max 1000)
        // Return array of rows
    }

    public function exists($id): bool
    {
        // COUNT(*) query for performance
    }

    public function count(array $criteria = []): int
    {
        // COUNT(*) with criteria
    }
}
```

**Key rules**:
- Never expose PDO or SQL to callers
- Always return arrays, never raw database objects
- Validate input (SQL injection prevention)
- Use prepared statements (parameterized queries)
- Catch and translate PDOException to domain exceptions

### Step 2: Create Domain Entities/Validators

**File**: `src/{ContextName}/Domain/{Model}Entity.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\{ContextName}\Domain;

final class {Model}Entity
{
    /**
     * Create from database row.
     *
     * @param array<string, mixed> $row Database record
     */
    public static function fromArray(array $row): self
    {
        // Validate data
        // Create entity with typed properties
        return new self(
            id: (int)$row['id'],
            name: (string)$row['name'],
            // ...
        );
    }

    public function __construct(
        private readonly int $id,
        private readonly string $name,
        // ... typed properties
    ) {
        // Domain logic: validate invariants
        if (empty($name)) {
            throw new \InvalidArgumentException('Name cannot be empty');
        }
    }

    public function getId(): int { return $this->id; }
    public function getName(): string { return $this->name; }
}
```

### Step 3: Create Application Service

**File**: `src/{ContextName}/Application/Get{Resource}Service.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\{ContextName}\Application;

use GalaxyQuest\{ContextName}\Domain\Interfaces\{Model}RepositoryInterface;

final class Get{Resource}Service
{
    public function __construct(
        private readonly {Model}RepositoryInterface $repository,
        // Inject other services/utilities as needed
    ) {
    }

    /**
     * Execute use case.
     *
     * @param array<string, mixed> $criteria Input parameters
     *
     * @return array<string, mixed> Result data
     *
     * @throws \DomainException if validation fails
     */
    public function execute(array $criteria): array
    {
        // 1. Validate input
        // 2. Call repository
        // 3. Transform to output DTO
        // 4. Return result
    }
}
```

**Key rules**:
- Services are stateless
- Accept simple types (arrays), not objects from presentation layer
- Throw exceptions for domain errors
- Return arrays for API serialization
- Can call multiple repositories (orchestration)

### Step 4: Create Controller

**File**: `src/{ContextName}/Presentation/{Context}Controller.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\{ContextName}\Presentation;

use GalaxyQuest\Shared\Http\ApiResponse;
use GalaxyQuest\Shared\Http\ApiError;
use GalaxyQuest\{ContextName}\Application\Get{Resource}Service;

final class {Context}Controller
{
    public function __construct(
        private readonly Get{Resource}Service $service,
    ) {
    }

    /**
     * Handle HTTP request.
     *
     * @param array<string, mixed> $params Query/path parameters
     *
     * @return ApiResponse
     */
    public function handle{Action}(array $params): ApiResponse
    {
        try {
            // 1. Validate params
            // 2. Call service
            // 3. Return success response
            $result = $this->service->execute($params);
            return ApiResponse::success($result);
        } catch (\DomainException $e) {
            // 3. Convert domain exception to API error
            $error = new ApiError('CONTEXT_SPECIFIC_ERROR', $e->getMessage());
            return ApiResponse::error($error);
        } catch (\Throwable $e) {
            // 4. Log and return generic error
            $error = new ApiError('INTERNAL_ERROR', 'An unexpected error occurred');
            return ApiResponse::error($error);
        }
    }
}
```

**Key rules**:
- Controllers are thin (no business logic)
- All HTTP parsing here; nothing passes to services
- Return ApiResponse (never raw arrays)
- Catch domain exceptions and convert to ApiError codes
- Log unexpected errors

---

## Phase 2: Frontend Integration

### Step 1: Create Service Layer

**File**: `js/features/{context}/{Context}Service.js`

```javascript
/**
 * {Context}Service – Business logic for {context} feature.
 *
 * Responsibilities:
 * - Validation (coordinate checks, range bounds, etc)
 * - Caching (with TTL and eviction)
 * - Error transformation (HTTP errors → domain errors)
 * - Result formatting (standardize output shape)
 */
export class {Context}Service {
    constructor(apiClient, options = {}) {
        this.apiClient = apiClient;
        this.cache = new Map();
        this.maxCacheSize = options.maxCacheSize ?? 100;
        this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000; // 5 min
    }

    /**
     * Get {resource} from API.
     *
     * @param {object} criteria Filter conditions
     * @returns {Promise<array>} Results
     */
    async get{Resource}(criteria) {
        // 1. Validate input
        this.#validateCriteria(criteria);

        // 2. Check cache
        const cached = this.#getCachedResult(criteria);
        if (cached) return cached;

        // 3. Call API
        const response = await this.apiClient.get(`/api/{context}`, { params: criteria });

        // 4. Transform error if needed
        if (!response.success) {
            throw new Error(response.error.message);
        }

        // 5. Cache and return
        this.#setCachedResult(criteria, response.data);
        return response.data;
    }

    #validateCriteria(criteria) {
        // Domain-level validation
        if (!criteria || typeof criteria !== 'object') {
            throw new Error('Criteria must be an object');
        }
    }

    #getCachedResult(key) {
        const cached = this.cache.get(JSON.stringify(key));
        if (cached && Date.now() - cached.ts < this.cacheTtlMs) {
            return cached.data;
        }
        return null;
    }

    #setCachedResult(key, data) {
        const keys = Array.from(this.cache.keys());
        if (keys.length >= this.maxCacheSize) {
            // FIFO eviction: remove oldest
            this.cache.delete(keys[0]);
        }
        this.cache.set(JSON.stringify(key), { data, ts: Date.now() });
    }
}
```

### Step 2: Create State Manager

**File**: `js/features/{context}/{Context}Controller.js`

```javascript
/**
 * {Context}Controller – State management and event emission for {context} UI.
 *
 * Responsibilities:
 * - Maintain current state (what's loaded, selected, etc)
 * - Emit events for UI components to react to
 * - Delegate operations to service layer
 * - Handle loading and error states
 */
export class {Context}Controller {
    constructor(service) {
        this.service = service;
        this.state = {
            currentResults: null,
            currentError: null,
            isLoading: false,
            selectedItem: null,
        };
        this.listeners = new Map();
    }

    /**
     * Load {resource} and emit events.
     *
     * @param {object} criteria
     */
    async load{Resource}(criteria) {
        this.state.isLoading = true;
        this.#emit('loading');

        try {
            const results = await this.service.get{Resource}(criteria);
            this.state.currentResults = results;
            this.state.currentError = null;
            this.#emit('{resource}Loaded', results);
        } catch (error) {
            this.state.currentError = error.message;
            this.#emit('error', error);
        } finally {
            this.state.isLoading = false;
        }
    }

    /**
     * Register listener for event.
     *
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);

        // Return unsubscribe function
        return () => {
            const list = this.listeners.get(event);
            list.splice(list.indexOf(callback), 1);
        };
    }

    #emit(event, ...args) {
        const callbacks = this.listeners.get(event) ?? [];
        callbacks.forEach(cb => {
            try {
                cb(...args);
            } catch (err) {
                console.error(`Error in listener for ${event}:`, err);
            }
        });
    }

    getState() {
        return { ...this.state };
    }

    clear() {
        this.state = {
            currentResults: null,
            currentError: null,
            isLoading: false,
            selectedItem: null,
        };
        this.#emit('cleared');
    }
}
```

### Step 3: Create Legacy Bridge

**File**: `js/features/{context}/legacy-bridge.js`

```javascript
/**
 * Legacy bridge – Adapter for old game.js code.
 *
 * Maintains backward compatibility while new code migrates to service/controller pattern.
 * Supports both promise and callback styles.
 */

let _globalController = null;

export function initializeLegacyBridge(controller) {
    _globalController = controller;
}

/**
 * Old API: game.get{Resource}(criteria, callback)
 * New API: controller.load{Resource}(criteria).then(...)
 */
export function get{Resource}(criteria, callback) {
    if (!_globalController) {
        throw new Error('{Context} not initialized');
    }

    // Support both callback and promise styles
    const promise = _globalController.service.get{Resource}(criteria);

    if (typeof callback === 'function') {
        // Callback style
        promise
            .then(result => callback(null, result))
            .catch(error => callback(error, null));
    } else {
        // Promise style
        return promise;
    }
}

export function get{Resource}Cached(criteria) {
    if (!_globalController) {
        throw new Error('{Context} not initialized');
    }
    return _globalController.state.currentResults;
}
```

---

## Phase 3: Testing & Validation

### Step 1: Unit Tests

**File**: `tests/Unit/{ContextName}/{Entity}Test.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit\{ContextName};

use PHPUnit\Framework\TestCase;
use GalaxyQuest\{ContextName}\Domain\{Model}Entity;

class {Model}EntityTest extends TestCase
{
    public function testConstructorValidatesInvariants(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new {Model}Entity(id: 1, name: '');
    }

    public function testFromArrayCreatesEntity(): void
    {
        $entity = {Model}Entity::fromArray(['id' => 1, 'name' => 'Test']);
        self::assertEquals(1, $entity->getId());
        self::assertEquals('Test', $entity->getName());
    }
}
```

### Step 2: Integration Tests

**File**: `tests/Integration/{ContextName}IntegrationTest.php`

```php
<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration;

use PHPUnit\Framework\TestCase;
use PDO;
use GalaxyQuest\{ContextName}\Infrastructure\Pdo{Context}Repository;

class {ContextName}IntegrationTest extends TestCase
{
    private static ?PDO $testDb = null;

    public static function setUpBeforeClass(): void
    {
        self::$testDb = new PDO('sqlite::memory:');
        // Setup schema and test data
    }

    public function testRepositoryRetrievesRecord(): void
    {
        $repo = new Pdo{Context}Repository(self::$testDb);
        $record = $repo->get(1);
        self::assertNotNull($record);
        self::assertEquals('expected_value', $record['field']);
    }
}
```

### Step 3: Contract Tests

**File**: `tests/Unit/{ContextName}ApiContractTest.php`

Verify API response envelope structure, error formats, and metadata.

---

## Phase 4: CI Integration & Documentation

### Step 1: Add Linting Rules

Update `.eslintrc.galaxy.js` and `ruleset.xml` to validate new context:

```javascript
// .eslintrc.galaxy.js
module.exports = {
    rules: {
        'no-restricted-globals': ['error', {
            name: 'fetch',
            message: 'Use ApiClient, not fetch(). See {ContextName}/legacy-bridge.js.',
        }],
    },
};
```

```xml
<!-- ruleset.xml -->
<rule ref="Generic.PHP.ForbiddenFunctions">
    <exclude-pattern>*/src/{ContextName}/Infrastructure/*</exclude-pattern>
</rule>
```

### Step 2: Document Architecture

Create or update:
- `docs/technical/{CONTEXT_NAME}_ARCHITECTURE.md` – Detailed design
- `docs/technical/ADR-XXX-{Decision}.md` – Key decisions
- Update main `ARCHITECTURE.md` with new context diagram

### Step 3: Update CI Pipeline

Extend `.github/workflows/ci.yml`:

```yaml
lint-{context}:
  name: {Context} Architecture Validation
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: vendor/bin/phpcs --standard=ruleset.xml src/{ContextName}/
    - run: npx eslint js/features/{context}/ --config .eslintrc.galaxy.js
```

---

## Common Patterns & Anti-Patterns

### ✅ CORRECT

1. **Inject dependencies**: Constructor injection for repo, services, config
2. **Exception handling**: Throw domain exceptions in services, catch in controllers
3. **Query objects**: Use value objects for complex query parameters
4. **Repository contracts**: Interface in Domain, implementation in Infrastructure
5. **Error mapping**: Domain exceptions → ApiError codes

### ❌ ANTI-PATTERNS

1. **SQL in controllers**: All queries must go through repository
2. **Direct PDO access**: Never pass PDO/mysqli objects outside Infrastructure
3. **Global state**: No static properties or singletons; inject everything
4. **Mixed concerns**: Controllers must not contain business logic
5. **Heterogeneous errors**: All API errors via ApiError/ApiResponse
6. **Missing validation**: Always validate input at service layer
7. **Hardcoded strings**: Use constants for error codes, MIME types, etc

---

## Troubleshooting

### Issue: "Unknown error code" when creating ApiError

**Cause**: Error code not registered in ApiError::ERROR_CODES

**Solution**: Add your error codes to `src/Shared/Http/ApiError.php`

```php
private const ERROR_CODES = [
    'YOUR_CONTEXT_ERROR' => 'Description...',
];
```

### Issue: Tests pass locally but fail in CI

**Cause**: Test environment differences (PHP version, extensions, database)

**Solution**:
1. Check CI job PHP version in `.github/workflows/ci.yml`
2. Verify test database setup matches CI
3. Use same MySQL/SQLite versions locally and in CI
4. Enable all required extensions (`pdo, pdo_mysql, json, mbstring`)

### Issue: "No SQL in Presentation layer" rule violations in CI

**Cause**: Query logic in controller or presentation class

**Solution**: Move query to repository method, call from service

```php
// WRONG (in controller)
$result = $this->pdo->query("SELECT ...");

// RIGHT (repository)
public function get($id): ?array {
    $stmt = $this->pdo->prepare("SELECT ...");
    return $stmt->fetch(PDO::FETCH_ASSOC);
}

// RIGHT (controller)
$result = $this->repository->get($id);
```

### Issue: Cache inconsistency between requests

**Cause**: Cache key doesn't include all query parameters

**Solution**: Serialize entire criteria object for cache key

```php
// WRONG
$key = "user_" . $userId;

// RIGHT
$key = hash('sha256', json_encode($criteria));
```

---

## Checklist: Ready for Production

Before deploying a new context:

- [ ] All unit tests passing (>80% coverage)
- [ ] All integration tests passing
- [ ] All contract tests passing
- [ ] CI linting passes (no architecture violations)
- [ ] Code review completed (domain logic, error handling)
- [ ] Performance tested (p95/p99 latency acceptable)
- [ ] Error scenarios tested (not found, validation, timeout)
- [ ] Legacy bridge working with old code
- [ ] Database migrations applied
- [ ] Documentation updated
- [ ] Team trained on new patterns
- [ ] Rollback plan documented

---

## Questions? Gaps?

See `ARCHITECTURE.md` for system overview or check specific ADRs for decisions:
- ADR-001: Unified API Response Envelope
- ADR-002: Bounded Context Separation
- ADR-003: Retry Policy & Error Handling
- ADR-004: Frontend-Backend API Bridge
- ADR-005: Serialization Strategy

Good luck! 🚀
