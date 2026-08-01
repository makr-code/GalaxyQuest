# AI Coding Context: PHP (Backend API)

**Für:** GitHub Copilot, Claude, Code Generation  
**Projekt:** GalaxyQuest  
**Framework:** PHP 8.1+  
**Datum:** 2026-08-01  
**SOC Score:** 4.4/10 → Target: 8/10

---

## 🎯 Overarching Principles

### Separation of Concerns (SOC) Mandate
- ✅ **Controller** = HTTP routing & request/response handling ONLY
- ✅ **Service** = Business logic (stateless)
- ✅ **Repository** = Database access (abstracted behind interface)
- ✅ **Model** = Data structures (with validation)
- ✅ **No direct SQL in Controller**
- ✅ **No business logic in Repository**
- ❌ **Never mix layers** (e.g., Controller with direct DB queries)

### Architecture Layers
```
┌─────────────────────────────────┐
│ Controller (HTTP)               │  Input validation, routing
├─────────────────────────────────┤
│ Service (Business Logic)        │  Game rules, calculations
├─────────────────────────────────┤
│ Repository (Data Access)        │  Database queries only
├─────────────────────────────────┤
│ Database (MySQL)                │  Persistence
└─────────────────────────────────┘
```

---

## 📐 Object-Oriented Design Patterns

### 1. **Service Layer Pattern** (Mandatory)
```php
<?php

// ❌ BAD: Business logic in controller
class EconomyController {
  public function setTaxRate($rate) {
    $conn = new mysqli(...);
    $tax = $rate;
    
    // Validation logic mixed in
    if ($tax < 0 || $tax > 100) {
      return ['error' => 'Invalid tax'];
    }
    
    // Business logic mixed in
    $newRevenue = $income * ($tax / 100);
    
    // Database logic mixed in
    $result = $conn->query(
      "UPDATE economy SET tax_rate = $tax, revenue = $newRevenue"
    );
    
    return ['success' => true];
  }
}

// ✅ GOOD: Separated concerns
class EconomyService {
  private EconomyRepository $repository;
  
  public function __construct(EconomyRepository $repository) {
    $this->repository = $repository;
  }
  
  /**
   * Set tax rate with business logic
   * @param float $rate Tax rate 0-100
   * @throws InvalidArgumentException If invalid
   * @return array Updated economy state
   */
  public function setTaxRate(float $rate): array {
    // Validation
    $this->validateTaxRate($rate);
    
    // Business logic
    $currentEconomy = $this->repository->getEconomy();
    $newRevenue = $currentEconomy->income * ($rate / 100);
    
    // Persist (repository handles how)
    $this->repository->update([
      'tax_rate' => $rate,
      'revenue' => $newRevenue
    ]);
    
    return [
      'tax_rate' => $rate,
      'revenue' => $newRevenue
    ];
  }
  
  private function validateTaxRate(float $rate): void {
    if (!is_numeric($rate) || $rate < 0 || $rate > 100) {
      throw new InvalidArgumentException("Invalid tax rate: {$rate}");
    }
  }
}

// Controller just routes
class EconomyController {
  private EconomyService $service;
  
  public function __construct(EconomyService $service) {
    $this->service = $service;
  }
  
  public function setTaxRate(Request $request): Response {
    try {
      $rate = (float)$request->input('rate');
      $result = $this->service->setTaxRate($rate);
      
      return new JsonResponse([
        'success' => true,
        'data' => $result
      ]);
    } catch (InvalidArgumentException $e) {
      return new JsonResponse([
        'success' => false,
        'error' => $e->getMessage()
      ], 400);
    }
  }
}
?>
```

### 2. **Repository Pattern** (Data Access Abstraction)
```php
<?php

// Interface defines contract
interface EconomyRepositoryInterface {
  public function getEconomy(): ?EconomyEntity;
  public function update(array $data): bool;
  public function getHistoryByDate(string $date): array;
}

// Implementation with MySQL
class EconomyRepository implements EconomyRepositoryInterface {
  private PDO $pdo;
  
  public function __construct(PDO $pdo) {
    $this->pdo = $pdo;
  }
  
  public function getEconomy(): ?EconomyEntity {
    $stmt = $this->pdo->prepare(
      'SELECT * FROM economy WHERE id = 1'
    );
    $stmt->execute();
    
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    
    return $this->mapToEntity($row);
  }
  
  public function update(array $data): bool {
    $fields = array_keys($data);
    $placeholders = array_map(fn($f) => "$f = ?", $fields);
    $sql = 'UPDATE economy SET ' . implode(', ', $placeholders) . ' WHERE id = 1';
    
    $stmt = $this->pdo->prepare($sql);
    return $stmt->execute(array_values($data));
  }
  
  private function mapToEntity(array $row): EconomyEntity {
    return new EconomyEntity(
      id: (int)$row['id'],
      taxRate: (float)$row['tax_rate'],
      revenue: (float)$row['revenue']
    );
  }
}

// ✅ Easy to swap implementation
class CachedEconomyRepository implements EconomyRepositoryInterface {
  private EconomyRepositoryInterface $inner;
  private array $cache = [];
  
  public function __construct(EconomyRepositoryInterface $inner) {
    $this->inner = $inner;
  }
  
  public function getEconomy(): ?EconomyEntity {
    if (!isset($this->cache['economy'])) {
      $this->cache['economy'] = $this->inner->getEconomy();
    }
    return $this->cache['economy'];
  }
  
  public function update(array $data): bool {
    $result = $this->inner->update($data);
    unset($this->cache['economy']);  // Invalidate cache
    return $result;
  }
  
  public function getHistoryByDate(string $date): array {
    $key = "history_{$date}";
    if (!isset($this->cache[$key])) {
      $this->cache[$key] = $this->inner->getHistoryByDate($date);
    }
    return $this->cache[$key];
  }
}

// Usage:
$db = new PDO('mysql:...');
$repository = new EconomyRepository($db);
$cachedRepository = new CachedEconomyRepository($repository);  // Cached!
$service = new EconomyService($cachedRepository);
?>
```

### 3. **Dependency Injection Container**
```php
<?php

class Container {
  private array $services = [];
  private array $factories = [];
  
  public function register(string $key, callable $factory): void {
    $this->factories[$key] = $factory;
  }
  
  public function get(string $key) {
    if (!isset($this->services[$key])) {
      if (!isset($this->factories[$key])) {
        throw new Exception("Service '{$key}' not registered");
      }
      
      $this->services[$key] = $this->factories[$key]($this);
    }
    
    return $this->services[$key];
  }
}

// Setup (in bootstrap file)
$container = new Container();

$container->register('pdo', function() {
  return new PDO('mysql:host=localhost', 'user', 'pass');
});

$container->register('economy.repository', function($c) {
  return new EconomyRepository($c->get('pdo'));
});

$container->register('economy.service', function($c) {
  return new EconomyService($c->get('economy.repository'));
});

// Usage in controller:
$economyService = $container->get('economy.service');
?>
```

### 4. **DTO (Data Transfer Object) Pattern**
```php
<?php

// ✅ GOOD: Explicit, type-safe
class SetTaxRateRequest {
  public function __construct(
    public readonly float $rate,
    public readonly int $playerId
  ) {
    $this->validate();
  }
  
  private function validate(): void {
    if ($this->rate < 0 || $this->rate > 100) {
      throw new InvalidArgumentException('Invalid tax rate');
    }
    if ($this->playerId <= 0) {
      throw new InvalidArgumentException('Invalid player ID');
    }
  }
}

class EconomyResponse {
  public function __construct(
    public readonly float $taxRate,
    public readonly float $revenue,
    public readonly array $demands
  ) {}
  
  public function toArray(): array {
    return [
      'tax_rate' => $this->taxRate,
      'revenue' => $this->revenue,
      'demands' => $this->demands
    ];
  }
}

// Controller
class EconomyController {
  public function setTaxRate(Request $request): Response {
    try {
      $dto = new SetTaxRateRequest(
        rate: (float)$request->input('rate'),
        playerId: auth()->user()->id
      );
      
      $result = $this->service->setTaxRate($dto);
      
      return new JsonResponse([
        'success' => true,
        'data' => $result->toArray()
      ]);
    } catch (InvalidArgumentException $e) {
      return new JsonResponse([
        'success' => false,
        'error' => $e->getMessage()
      ], 400);
    }
  }
}

// ❌ BAD: No validation, loose typing
function setTaxRate($rate) {
  // $rate could be anything!
}
?>
```

---

## 🏗️ Module Organization

### Standard API Endpoint Structure
```
api/
├─ v2/                          # API version
│  ├─ economy.php               # Endpoint dispatcher
│  ├─ fleet.php
│  ├─ galaxy.php
│  └─ ...
│
├─ controllers/
│  ├─ EconomyController.php     # HTTP handling
│  ├─ FleetController.php
│  └─ ...
│
├─ services/
│  ├─ EconomyService.php        # Business logic
│  ├─ FleetService.php
│  └─ ...
│
├─ repositories/
│  ├─ EconomyRepository.php     # Data access
│  ├─ FleetRepository.php
│  └─ ...
│
├─ models/
│  ├─ EconomyEntity.php         # Data structures
│  ├─ FleetEntity.php
│  └─ ...
│
├─ exceptions/
│  ├─ ValidationException.php    # Custom exceptions
│  ├─ BusinessLogicException.php
│  └─ ...
│
├─ middleware/
│  ├─ AuthMiddleware.php        # Request processing
│  ├─ CsrfMiddleware.php
│  └─ ...
│
└─ bootstrap.php                # DI container setup
```

### Example: Economy Endpoint v2
```php
<?php
// api/v2/economy.php - Dispatcher
header('Content-Type: application/json');

try {
  $method = $_SERVER['REQUEST_METHOD'];
  $action = $_GET['action'] ?? null;
  
  // Load dependencies
  require_once __DIR__ . '/../bootstrap.php';
  
  $controller = $container->get('economy.controller');
  
  // Route to action
  $result = match($method) {
    'GET' => match($action) {
      'getTax' => $controller->getTax(),
      'getHistory' => $controller->getHistory(),
      default => throw new Exception("Unknown action: $action")
    },
    'POST' => match($action) {
      'setTax' => $controller->setTaxRate(new Request($_POST, $_FILES)),
      default => throw new Exception("Unknown action: $action")
    },
    default => throw new Exception("Method not allowed: $method")
  };
  
  echo json_encode([
    'success' => true,
    'data' => $result
  ]);
  
} catch (InvalidArgumentException $e) {
  http_response_code(400);
  echo json_encode([
    'success' => false,
    'error' => $e->getMessage(),
    'code' => 'VALIDATION_ERROR'
  ]);
  
} catch (Exception $e) {
  http_response_code(500);
  error_log("[ERROR] " . $e->getMessage());
  echo json_encode([
    'success' => false,
    'error' => 'Internal server error',
    'code' => 'SERVER_ERROR'
  ]);
}
?>
```

---

## 🔗 Dependency Management

### Dependency Injection Rules
```php
<?php

// ✅ GOOD: Dependencies injected via constructor
class EconomyService {
  public function __construct(
    private EconomyRepositoryInterface $repository,
    private LoggerInterface $logger
  ) {}
}

// ✅ GOOD: Service locator as last resort (in controllers only)
class EconomyController {
  public function __construct(private Container $container) {}
  
  public function getTax() {
    $service = $this->container->get('economy.service');
    return $service->getTaxRate();
  }
}

// ❌ BAD: Global variables
global $pdo;
$result = $pdo->query(...);

// ❌ BAD: Static methods for state
class Database {
  private static $instance;
  public static function getInstance() { return self::$instance; }
}

// ❌ BAD: New in constructor
class BadService {
  public function __construct() {
    $this->repository = new SomeRepository();  // Hard-coded!
  }
}

// ❌ BAD: Circular dependencies
// ServiceA depends on ServiceB, ServiceB depends on ServiceA
?>
```

---

## 🛡️ Error Handling

### Exception Hierarchy
```php
<?php

// Custom exception base
abstract class DomainException extends Exception {}

// Domain-specific exceptions
class ValidationException extends DomainException {
  public array $errors = [];
  
  public function __construct(array $errors = []) {
    $this->errors = $errors;
    parent::__construct('Validation failed');
  }
}

class EntityNotFoundException extends DomainException {}

class BusinessLogicException extends DomainException {}

class AuthorizationException extends DomainException {}

// Usage
try {
  $this->validateTaxRate($rate);
  $this->repository->update($data);
  
} catch (ValidationException $e) {
  return ['success' => false, 'errors' => $e->errors];
  
} catch (EntityNotFoundException $e) {
  return ['success' => false, 'error' => 'Entity not found'];
  
} catch (AuthorizationException $e) {
  http_response_code(403);
  return ['success' => false, 'error' => 'Not authorized'];
  
} catch (Exception $e) {
  error_log('Unexpected error: ' . $e->getMessage());
  http_response_code(500);
  return ['success' => false, 'error' => 'Internal error'];
}

// ❌ BAD: Generic catch
try {
  $this->doSomething();
} catch (Exception $e) {
  echo "Error: " . $e->getMessage();  // No context, hard to debug
}
?>
```

### Error Handling in Services
```php
<?php

class EconomyService {
  public function setTaxRate(float $rate): array {
    // Validation first
    if ($rate < 0 || $rate > 100) {
      throw new ValidationException([
        'rate' => 'Tax rate must be between 0 and 100'
      ]);
    }
    
    // Load entity
    $economy = $this->repository->getEconomy();
    if (!$economy) {
      throw new EntityNotFoundException('Economy record not found');
    }
    
    // Business logic with checks
    if ($economy->isLocked) {
      throw new BusinessLogicException('Economy is locked, cannot update');
    }
    
    // Update
    try {
      $this->repository->update(['tax_rate' => $rate]);
    } catch (PDOException $e) {
      throw new BusinessLogicException('Failed to update tax rate: ' . $e->getMessage());
    }
    
    return ['tax_rate' => $rate];
  }
}
?>
```

---

## 📝 Naming Conventions

### Classes & Methods
```php
<?php

// ✅ GOOD
class EconomyService { }           // PascalCase
class EconomyRepositoryInterface { }
class SetTaxRateRequest { }         // Clear purpose

public function getTaxRate() { }    // camelCase
public function calculateRevenue() { }
private function validateInput() { }

// ❌ BAD
class economyService { }             // lowercase
class EC { }                          // Abbreviations
class service { }                     // Non-descriptive

function get_tax_rate() { }          // snake_case (except constants)
private function v() { }             // Single letter
?>
```

### Constants & Variables
```php
<?php

// ✅ GOOD: Constants
const MAX_TAX_RATE = 100;
const DEFAULT_TIMEOUT_SECONDS = 30;
const ERROR_RATE = 0.05;

// ✅ GOOD: Variables
$economyState = [];
$isValidated = false;
$selectedSystemIds = [];

// ❌ BAD
const max_tax = 100;                // SCREAMING_SNAKE_CASE reserved for constants
$s = [];                             // Non-descriptive
$TEMP = 'value';                     // All caps for non-constant
?>
```

---

## 🧪 Testing Expectations

### Unit Testing Pattern
```php
<?php

namespace Tests;

use PHPUnit\Framework\TestCase;
use App\Services\EconomyService;
use App\Repositories\EconomyRepositoryInterface;

class EconomyServiceTest extends TestCase {
  private EconomyRepositoryInterface $repository;
  private EconomyService $service;
  
  protected function setUp(): void {
    // Mock repository
    $this->repository = $this->createMock(EconomyRepositoryInterface::class);
    $this->service = new EconomyService($this->repository);
  }
  
  public function testSetTaxRateUpdatesState(): void {
    // Arrange
    $this->repository
      ->expects($this->once())
      ->method('update')
      ->with(['tax_rate' => 15.5]);
    
    // Act
    $result = $this->service->setTaxRate(15.5);
    
    // Assert
    $this->assertTrue($result['success']);
    $this->assertEquals(15.5, $result['tax_rate']);
  }
  
  public function testSetTaxRateThrowsOnInvalidRate(): void {
    // Assert
    $this->expectException(ValidationException::class);
    
    // Act
    $this->service->setTaxRate(150);  // Out of range
  }
  
  public function testSetTaxRateRollsBackOnDbError(): void {
    // Arrange
    $this->repository
      ->method('update')
      ->willThrowException(new PDOException('DB Error'));
    
    // Assert
    $this->expectException(BusinessLogicException::class);
    
    // Act
    $this->service->setTaxRate(20);
  }
}
?>
```

---

## 📊 API Response Format

### Standardized JSON Response
```php
<?php

// ✅ GOOD: Consistent response format
class ApiResponse {
  public static function success(array $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    echo json_encode([
      'success' => true,
      'data' => $data,
      'timestamp' => date('c'),
      'errors' => null
    ]);
  }
  
  public static function error(string $message, int $statusCode = 400, array $details = []): void {
    http_response_code($statusCode);
    echo json_encode([
      'success' => false,
      'data' => null,
      'timestamp' => date('c'),
      'errors' => [
        'message' => $message,
        'details' => $details,
        'code' => 'ERROR_' . strtoupper(str_replace(' ', '_', $message))
      ]
    ]);
  }
}

// Usage
ApiResponse::success(['tax_rate' => 15]);
ApiResponse::error('Invalid tax rate', 400, ['rate' => 'Must be 0-100']);

// ❌ BAD: Inconsistent responses
echo json_encode(['error' => 'Failed']);
echo json_encode(['success' => false, 'message' => 'Error']);
echo json_encode(['data' => $result, 'status' => 'ok']);
?>
```

---

## 🚀 Code Generation Guidelines for AI

When generating PHP code:

1. **Always use Service + Repository pattern**
   ```php
   // ❌ Don't put DB logic in controller
   class Controller {
     public function setTax() {
       $pdo->exec("UPDATE economy SET tax = ...");
     }
   }
   
   // ✅ Do use service
   class Controller {
     public function setTax() {
       $this->service->setTaxRate($value);
     }
   }
   ```

2. **Inject dependencies, don't create them**
   ```php
   // ✅ DO inject
   public function __construct(EconomyRepository $repo) {
     $this->repo = $repo;
   }
   
   // ❌ DON'T create internally
   public function __construct() {
     $this->repo = new EconomyRepository();
   }
   ```

3. **Validate inputs early**
   ```php
   // ✅ DO validate in service
   public function setTaxRate($rate) {
     if ($rate < 0 || $rate > 100) {
       throw new ValidationException(...);
     }
   }
   
   // ❌ DON'T skip validation
   public function setTaxRate($rate) {
     $this->repository->update(['tax' => $rate]);
   }
   ```

4. **Use typed parameters and return types**
   ```php
   // ✅ DO use types
   public function setTaxRate(float $rate): array { }
   
   // ❌ DON'T skip types
   public function setTaxRate($rate) { }
   ```

5. **Handle exceptions explicitly**
   ```php
   // ✅ DO catch specific exceptions
   try {
     $result = $this->service->doSomething();
   } catch (ValidationException $e) {
     return ApiResponse::error($e->getMessage(), 400);
   } catch (Exception $e) {
     return ApiResponse::error('Server error', 500);
   }
   
   // ❌ DON'T ignore exceptions
   $result = $this->service->doSomething();
   ```

---

## 🎓 Anti-Patterns to Avoid

| Anti-Pattern | Why Bad | Fix |
|---|---|---|
| SQL in Controller | Hard to test, duplicated | Move to Repository |
| Global state | Concurrent request conflicts | Use DI & local state |
| Silent failures | Users confused | Throw/log errors |
| No validation | Garbage in, garbage out | Validate in Service |
| God objects | Can't understand or test | Split into smaller classes |
| Circular deps | Impossible to test/refactor | Use interfaces & DI |
| No error handling | Debugging impossible | Use exception types |
| Magic strings | Typo-prone, unmaintainable | Use constants |

---

## 📋 Checklist for New Code

Before submitting PHP code:

- [ ] Service logic separated from Controller
- [ ] Database access abstracted in Repository
- [ ] Dependencies injected via constructor
- [ ] Input validation in Service
- [ ] Exception types used for different errors
- [ ] Return type hints documented
- [ ] API response format consistent
- [ ] No global state
- [ ] No direct $_GET/$_POST without validation
- [ ] Error handled gracefully (no raw exceptions to user)
- [ ] Database queries parameterized (no SQL injection)
- [ ] Testable (mocks can be injected)

---

**Last Updated:** 2026-08-01  
**Framework:** PHP 8.1+  
**Questions?** See FULLSTACK_ARCHITECTURE_ANALYSIS.md for deep dive.
