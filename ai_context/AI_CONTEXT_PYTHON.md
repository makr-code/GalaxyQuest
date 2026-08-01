# AI Coding Context: Python (FastAPI Services)

**Für:** GitHub Copilot, Claude, Code Generation  
**Projekt:** GalaxyQuest  
**Framework:** FastAPI 0.100+, Pydantic 2.0+, Python 3.11+  
**Datum:** 2026-08-01  
**SOC Score:** 7.2/10 → Target: 9/10

---

## 🎯 Overarching Principles

### Separation of Concerns (SOC) Mandate
- ✅ **Router** = HTTP endpoint definitions (thin layer)
- ✅ **Service** = Business logic (stateless, pure functions)
- ✅ **Repository** = Database access via SQLAlchemy ORM
- ✅ **Schema** = Pydantic models for validation (request/response)
- ✅ **Config** = Environment-based settings (pydantic-settings)
- ✅ **Async/Await** for all I/O (HTTP, DB, files)
- ❌ **Never mix layers** or use blocking operations in async context

### Architecture Layers
```
┌──────────────────────────────────┐
│ FastAPI Router                   │  Path → Handler
├──────────────────────────────────┤
│ Pydantic Schema                  │  Input validation & serialization
├──────────────────────────────────┤
│ Service Layer                    │  Business logic
├──────────────────────────────────┤
│ Repository + SQLAlchemy          │  Database queries
├──────────────────────────────────┤
│ PostgreSQL / SQLite              │  Persistence
└──────────────────────────────────┘
```

---

## 📐 Object-Oriented Design Patterns

### 1. **Dependency Injection with FastAPI** (Preferred)
```python
# ✅ GOOD: Dependency injection via FastAPI
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session

app = FastAPI()

# Service with injected dependencies
class EconomyService:
  def __init__(self, repo: EconomyRepository) -> None:
    self.repo = repo

  async def set_tax_rate(self, rate: float) -> dict[str, Any]:
    if rate < 0 or rate > 100:
      raise ValueError("Invalid tax rate")
    
    result = await self.repo.update_tax_rate(rate)
    return {"tax_rate": result.tax_rate}

# Repository layer
class EconomyRepository:
  def __init__(self, db: Session) -> None:
    self.db = db

  async def update_tax_rate(self, rate: float) -> EconomyModel:
    economy = self.db.query(Economy).first()
    economy.tax_rate = rate
    self.db.commit()
    self.db.refresh(economy)
    return economy

# Dependency functions
async def get_db() -> AsyncGenerator[Session, None]:
  async with AsyncSessionLocal() as session:
    yield session

def get_economy_repo(db: Session = Depends(get_db)) -> EconomyRepository:
  return EconomyRepository(db)

def get_economy_service(
  repo: EconomyRepository = Depends(get_economy_repo)
) -> EconomyService:
  return EconomyService(repo)

# Router endpoint
@app.post("/api/economy/tax")
async def set_tax_rate(
  request: SetTaxRateRequest,
  service: EconomyService = Depends(get_economy_service)
) -> dict[str, Any]:
  return await service.set_tax_rate(request.rate)

# ❌ BAD: Direct imports and instantiation
@app.post("/api/economy/tax")
async def bad_endpoint(request: dict) -> dict:
  db = Session()  # Direct instantiation
  repo = EconomyRepository(db)  # Not injected
  service = EconomyService(repo)
  
  return await service.set_tax_rate(request['rate'])
```

### 2. **Pydantic Models for Validation** (Always)
```python
from pydantic import BaseModel, Field, field_validator
from typing import Literal

# ✅ GOOD: Request schema with validation
class SetTaxRateRequest(BaseModel):
  rate: float = Field(
    ...,
    ge=0,  # >= 0
    le=100,  # <= 100
    description="Tax rate as percentage"
  )
  player_id: int = Field(..., gt=0)
  reason: str | None = None
  
  @field_validator('rate')
  @classmethod
  def validate_rate_precision(cls, v: float) -> float:
    # Only 2 decimal places
    if len(str(v).split('.')[-1]) > 2:
      raise ValueError('Rate can have max 2 decimal places')
    return v
  
  model_config = {
    "json_schema_extra": {
      "example": {
        "rate": 15.5,
        "player_id": 123,
        "reason": "Economic policy adjustment"
      }
    }
  }

# ✅ GOOD: Response schema
class EconomyResponse(BaseModel):
  tax_rate: float
  revenue: float
  demands: dict[str, float]
  timestamp: datetime
  
  class Config:
    json_encoders = {
      datetime: lambda v: v.isoformat()
    }

# ✅ GOOD: Error response
class ErrorResponse(BaseModel):
  success: bool = False
  error: str
  code: str
  timestamp: datetime = Field(default_factory=datetime.now)

# ❌ BAD: No validation
@app.post("/api/economy/tax")
async def bad_endpoint(data: dict) -> dict:
  rate = data.get('rate')  # No type checking!
  # rate could be string, list, null, anything
  
  return {"tax": rate}
```

### 3. **Service Layer with Business Logic**
```python
from datetime import datetime
from typing import Sequence

class EconomyService:
  def __init__(self, repo: EconomyRepository) -> None:
    self.repo = repo
  
  async def set_tax_rate(self, rate: float, player_id: int) -> dict[str, Any]:
    """
    Set tax rate with validation and side effects.
    
    Args:
      rate: Tax rate 0-100
      player_id: Player ID
    
    Returns:
      Updated economy state
    
    Raises:
      ValueError: If rate invalid
      PermissionError: If player not authorized
    """
    # Validation
    if rate < 0 or rate > 100:
      raise ValueError(f"Invalid tax rate: {rate}")
    
    # Authorization (business logic)
    player = await self.repo.get_player(player_id)
    if not player.can_modify_economy:
      raise PermissionError("Player not authorized to modify economy")
    
    # Business logic
    old_rate = player.economy.tax_rate
    new_revenue = player.empire.income * (rate / 100)
    
    # Persist
    await self.repo.update_economy({
      'tax_rate': rate,
      'revenue': new_revenue,
      'last_modified': datetime.now()
    })
    
    # Audit
    await self.repo.log_audit({
      'player_id': player_id,
      'action': 'tax_rate_change',
      'old_value': old_rate,
      'new_value': rate,
      'timestamp': datetime.now()
    })
    
    return {
      'tax_rate': rate,
      'revenue': new_revenue,
      'audit_id': audit_id
    }
  
  async def get_economy_history(
    self,
    player_id: int,
    days: int = 30
  ) -> Sequence[EconomyHistoryResponse]:
    """Get economy history for player."""
    history = await self.repo.get_economy_history(player_id, days)
    return [EconomyHistoryResponse.model_validate(h) for h in history]

# ❌ BAD: Business logic in endpoint
@app.post("/api/economy/tax")
async def bad_endpoint(
  request: SetTaxRateRequest,
  db: Session = Depends(get_db)
) -> dict:
  # Validation in endpoint
  if request.rate < 0 or request.rate > 100:
    raise HTTPException(status_code=400)
  
  # Business logic in endpoint
  player = db.query(Player).get(request.player_id)
  economy = player.economy
  old_rate = economy.tax_rate
  new_revenue = player.empire.income * (request.rate / 100)
  
  # Database logic in endpoint
  economy.tax_rate = request.rate
  economy.revenue = new_revenue
  db.commit()
  
  return {'tax': request.rate}
```

### 4. **Repository Pattern with SQLAlchemy**
```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Interface (Protocol)
from typing import Protocol

class IEconomyRepository(Protocol):
  async def get_economy(self, player_id: int) -> Economy: ...
  async def update_economy(self, data: dict) -> Economy: ...

# Implementation
class EconomyRepository:
  def __init__(self, db: AsyncSession) -> None:
    self.db = db
  
  async def get_economy(self, player_id: int) -> Economy | None:
    """Get economy for player."""
    stmt = select(Economy).where(Economy.player_id == player_id)
    result = await self.db.execute(stmt)
    return result.scalar_one_or_none()
  
  async def update_economy(self, player_id: int, data: dict) -> Economy:
    """Update economy fields."""
    economy = await self.get_economy(player_id)
    if not economy:
      raise ValueError(f"Economy not found for player {player_id}")
    
    # Update fields
    for key, value in data.items():
      if hasattr(economy, key):
        setattr(economy, key, value)
    
    await self.db.commit()
    await self.db.refresh(economy)
    return economy
  
  async def get_economy_history(
    self,
    player_id: int,
    days: int
  ) -> Sequence[EconomyHistory]:
    """Get economy history."""
    cutoff = datetime.now() - timedelta(days=days)
    stmt = (
      select(EconomyHistory)
      .where(EconomyHistory.player_id == player_id)
      .where(EconomyHistory.created_at >= cutoff)
      .order_by(EconomyHistory.created_at.desc())
    )
    result = await self.db.execute(stmt)
    return result.scalars().all()
  
  async def log_audit(self, data: dict) -> None:
    """Log audit event."""
    audit = AuditLog(**data)
    self.db.add(audit)
    await self.db.commit()

# ✅ GOOD: Caching layer on top
class CachedEconomyRepository:
  def __init__(
    self,
    inner: EconomyRepository,
    cache: AsyncLRU
  ) -> None:
    self.inner = inner
    self.cache = cache
  
  async def get_economy(self, player_id: int) -> Economy | None:
    cache_key = f"economy:{player_id}"
    
    # Try cache
    cached = await self.cache.get(cache_key)
    if cached:
      return cached
    
    # Fetch from inner
    economy = await self.inner.get_economy(player_id)
    
    # Cache result
    if economy:
      await self.cache.set(cache_key, economy, ttl=300)  # 5 min TTL
    
    return economy
  
  async def update_economy(self, player_id: int, data: dict) -> Economy:
    result = await self.inner.update_economy(player_id, data)
    
    # Invalidate cache
    cache_key = f"economy:{player_id}"
    await self.cache.delete(cache_key)
    
    return result
```

---

## 🏗️ Module Organization

### Standard Project Structure
```
tts_service/
├─ main.py                         # App entry point
├─ config.py                       # Settings (pydantic-settings)
├─ dependencies.py                 # DI container
│
├─ api/
│  ├─ __init__.py
│  ├─ routers/
│  │  ├─ economy.py               # Economy endpoints
│  │  ├─ fleet.py
│  │  └─ galaxy.py
│  ├─ schemas/
│  │  ├─ economy.py               # Pydantic models
│  │  ├─ fleet.py
│  │  └─ common.py
│  ├─ middleware/
│  │  ├─ auth.py
│  │  ├─ error_handler.py
│  │  └─ logging.py
│  └─ v1/                          # API versions
│     └─ ...
│
├─ services/
│  ├─ __init__.py
│  ├─ economy.py                  # Business logic
│  ├─ fleet.py
│  └─ base.py
│
├─ repositories/
│  ├─ __init__.py
│  ├─ economy.py                  # Data access
│  ├─ fleet.py
│  └─ base.py
│
├─ models/
│  ├─ __init__.py
│  ├─ economy.py                  # SQLAlchemy ORM models
│  ├─ fleet.py
│  ├─ base.py
│  └─ database.py
│
├─ exceptions/
│  ├─ __init__.py
│  ├─ business.py                 # Custom exceptions
│  └─ handlers.py
│
├─ utils/
│  ├─ __init__.py
│  ├─ logging.py
│  ├─ cache.py
│  └─ validators.py
│
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ conftest.py
│
└─ requirements.txt
```

### Example: Economy Router
```python
# tts_service/api/routers/economy.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from tts_service.api.schemas.economy import (
  SetTaxRateRequest,
  EconomyResponse,
  ErrorResponse
)
from tts_service.services.economy import EconomyService
from tts_service.dependencies import get_economy_service

router = APIRouter(prefix="/api/v1/economy", tags=["economy"])

@router.post(
  "/tax",
  response_model=EconomyResponse,
  responses={
    400: {"model": ErrorResponse, "description": "Validation error"},
    401: {"model": ErrorResponse, "description": "Not authorized"},
    500: {"model": ErrorResponse, "description": "Server error"}
  }
)
async def set_tax_rate(
  request: SetTaxRateRequest,
  service: EconomyService = Depends(get_economy_service)
) -> EconomyResponse:
  """Set player tax rate."""
  try:
    result = await service.set_tax_rate(
      rate=request.rate,
      player_id=request.player_id
    )
    return EconomyResponse(**result)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
  except PermissionError as e:
    raise HTTPException(status_code=401, detail=str(e))

@router.get(
  "/history",
  response_model=list[dict[str, Any]]
)
async def get_history(
  player_id: int,
  days: int = 30,
  service: EconomyService = Depends(get_economy_service)
) -> list[dict[str, Any]]:
  """Get economy history."""
  history = await service.get_economy_history(player_id, days)
  return [h.model_dump() for h in history]
```

---

## 🔗 Dependency Management

### Config Management (pydantic-settings)
```python
# tts_service/config.py
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Literal

class Settings(BaseSettings):
  # App settings
  app_name: str = "GalaxyQuest TTS Service"
  debug: bool = Field(False, env="DEBUG")
  environment: Literal["development", "staging", "production"] = "development"
  
  # Database
  database_url: str = Field(
    ...,
    env="DATABASE_URL",
    description="SQLAlchemy database URL"
  )
  database_pool_size: int = 20
  database_max_overflow: int = 10
  
  # Redis (optional)
  redis_url: str | None = Field(None, env="REDIS_URL")
  
  # API
  api_base_url: str = "http://localhost:8000"
  api_timeout_seconds: int = 30
  
  # Authentication
  jwt_secret: str = Field(..., env="JWT_SECRET")
  jwt_algorithm: str = "HS256"
  jwt_expire_minutes: int = 60
  
  # Logging
  log_level: str = "INFO"
  log_format: str = "json"  # json or text
  
  class Config:
    env_file = ".env"
    env_file_encoding = "utf-8"
    case_sensitive = False

# Load settings
settings = Settings()

# ✅ GOOD: Use settings throughout app
@app.get("/health")
async def health() -> dict:
  return {
    "status": "ok",
    "app": settings.app_name,
    "environment": settings.environment
  }

# ❌ BAD: Hardcoded values
DATABASE_URL = "postgresql://..."
JWT_SECRET = "super_secret"  # Never hardcode secrets!
```

### Dependency Container
```python
# tts_service/dependencies.py
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from functools import lru_cache

from tts_service.config import settings
from tts_service.models.database import async_session_maker
from tts_service.repositories.economy import EconomyRepository
from tts_service.services.economy import EconomyService

# Database dependency
async def get_db() -> AsyncGenerator[AsyncSession, None]:
  async with async_session_maker() as session:
    try:
      yield session
    finally:
      await session.close()

# Repository dependency
def get_economy_repo(
  db: AsyncSession = Depends(get_db)
) -> EconomyRepository:
  return EconomyRepository(db)

# Service dependency
def get_economy_service(
  repo: EconomyRepository = Depends(get_economy_repo)
) -> EconomyService:
  return EconomyService(repo)

# Cache dependency (optional)
@lru_cache(maxsize=1)
def get_cache():
  return AsyncLRU(maxsize=1000)
```

---

## 🛡️ Error Handling

### Custom Exception Hierarchy
```python
# tts_service/exceptions/business.py

class BaseAppException(Exception):
  """Base exception for all app errors."""
  def __init__(self, message: str, code: str, status_code: int = 500):
    self.message = message
    self.code = code
    self.status_code = status_code
    super().__init__(self.message)

class ValidationError(BaseAppException):
  def __init__(self, message: str, field: str | None = None):
    super().__init__(message, "VALIDATION_ERROR", 400)
    self.field = field

class NotFoundError(BaseAppException):
  def __init__(self, resource: str, identifier: Any):
    message = f"{resource} not found: {identifier}"
    super().__init__(message, "NOT_FOUND", 404)

class PermissionError(BaseAppException):
  def __init__(self, message: str = "Permission denied"):
    super().__init__(message, "PERMISSION_DENIED", 403)

class ConflictError(BaseAppException):
  def __init__(self, message: str):
    super().__init__(message, "CONFLICT", 409)

# ✅ GOOD: Using custom exceptions
class EconomyService:
  async def set_tax_rate(self, rate: float) -> dict:
    if rate < 0 or rate > 100:
      raise ValidationError("Tax rate out of range", field="rate")
    
    economy = await self.repo.get_economy()
    if not economy:
      raise NotFoundError("Economy", "player_1")
    
    if economy.is_locked:
      raise ConflictError("Economy is locked for maintenance")
    
    return await self.repo.update_tax_rate(rate)

# ❌ BAD: Using generic exceptions
async def bad_service():
  if rate < 0 or rate > 100:
    raise Exception("Invalid rate")  # Too generic
  raise RuntimeError("Not found")  # Misleading
```

### Exception Middleware
```python
# tts_service/api/middleware/error_handler.py
from fastapi import Request
from fastapi.responses import JSONResponse
from datetime import datetime

from tts_service.exceptions.business import BaseAppException

@app.exception_handler(BaseAppException)
async def app_exception_handler(request: Request, exc: BaseAppException):
  return JSONResponse(
    status_code=exc.status_code,
    content={
      "success": False,
      "error": {
        "message": exc.message,
        "code": exc.code
      },
      "timestamp": datetime.now().isoformat(),
      "path": request.url.path
    }
  )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
  import logging
  logger = logging.getLogger(__name__)
  logger.error(f"Unhandled exception: {exc}", exc_info=True)
  
  return JSONResponse(
    status_code=500,
    content={
      "success": False,
      "error": {
        "message": "Internal server error",
        "code": "INTERNAL_ERROR"
      },
      "timestamp": datetime.now().isoformat()
    }
  )
```

### Async Error Handling
```python
# ✅ GOOD: Async/await with proper error handling
async def load_galaxy(player_id: int) -> dict:
  try:
    galaxy_data = await self.api.get_galaxy(player_id)
    return await self.process_galaxy(galaxy_data)
  except asyncio.TimeoutError:
    raise ServiceError("Galaxy load timeout")
  except Exception as e:
    logger.error(f"Failed to load galaxy: {e}")
    raise

# ✅ GOOD: Exception groups (Python 3.11+)
async def batch_load():
  tasks = [load_galaxy(pid) for pid in player_ids]
  results = await asyncio.gather(*tasks, return_exceptions=True)
  
  errors = [r for r in results if isinstance(r, Exception)]
  if errors:
    logger.warning(f"Failed to load {len(errors)} galaxies")

# ❌ BAD: Blocking in async context
async def bad_function():
  # This blocks the event loop!
  time.sleep(1)
  
  # Use instead:
  await asyncio.sleep(1)
```

---

## 📝 Naming Conventions

### Python Style (PEP 8)
```python
# ✅ GOOD: Classes (PascalCase)
class EconomyService: pass
class SetTaxRateRequest: pass
class IEconomyRepository(Protocol): pass

# ✅ GOOD: Functions/Methods (snake_case)
async def get_economy_by_player_id(player_id: int) -> Economy: pass
def calculate_tax_revenue(rate: float, income: float) -> float: pass
def _private_helper() -> None: pass

# ✅ GOOD: Constants (SCREAMING_SNAKE_CASE)
MAX_TAX_RATE = 100
DEFAULT_RETRY_ATTEMPTS = 3
CACHE_TTL_SECONDS = 300

# ✅ GOOD: Type hints (informative)
economy_states: dict[int, EconomyState] = {}
selected_system_ids: list[str] = []
is_player_authorized: bool = False

# ❌ BAD: Non-descriptive names
def f(x): pass
e = EconomyService()
MAX_VALUE = 100  # What value?

# ❌ BAD: Mixed case conventions
class economyService: pass  # Should be PascalCase
CALCULATE_TAX = lambda x: x  # Should be snake_case
```

### Async Function Naming
```python
# ✅ GOOD: Async functions usually use same names
async def get_economy(player_id: int) -> Economy:
  pass

async def load_data() -> dict:
  pass

# ⚠️ AVOID: Prefixing with "async_" (unnecessary with async/await)
async def async_get_economy():  # Don't do this
  pass
```

---

## 🧪 Testing Expectations

### Unit Testing with pytest
```python
# tests/unit/test_economy_service.py
import pytest
from unittest.mock import AsyncMock, MagicMock

from tts_service.services.economy import EconomyService
from tts_service.repositories.economy import EconomyRepository
from tts_service.exceptions.business import ValidationError, PermissionError

@pytest.fixture
def mock_repository():
  return AsyncMock(spec=EconomyRepository)

@pytest.fixture
def service(mock_repository):
  return EconomyService(mock_repository)

@pytest.mark.asyncio
async def test_set_tax_rate_updates_state(service, mock_repository):
  # Arrange
  mock_repository.get_economy.return_value = MagicMock(is_locked=False)
  mock_repository.update_economy.return_value = MagicMock(
    tax_rate=15.5
  )
  
  # Act
  result = await service.set_tax_rate(15.5, player_id=1)
  
  # Assert
  assert result['tax_rate'] == 15.5
  mock_repository.update_economy.assert_called_once()

@pytest.mark.asyncio
async def test_set_tax_rate_validates_input(service):
  # Assert
  with pytest.raises(ValidationError) as exc_info:
    await service.set_tax_rate(150, player_id=1)  # Out of range
  
  assert "tax rate" in str(exc_info.value).lower()

@pytest.mark.asyncio
async def test_set_tax_rate_checks_permissions(service, mock_repository):
  # Arrange
  mock_repository.get_player.return_value = MagicMock(
    can_modify_economy=False
  )
  
  # Assert
  with pytest.raises(PermissionError):
    await service.set_tax_rate(15.5, player_id=1)
```

### Integration Testing
```python
# tests/integration/test_economy_endpoints.py
@pytest.mark.asyncio
async def test_set_tax_rate_endpoint(client, db_session):
  # Setup
  player = await create_test_player(db_session)
  
  # Act
  response = await client.post(
    "/api/v1/economy/tax",
    json={"rate": 20.0, "player_id": player.id}
  )
  
  # Assert
  assert response.status_code == 200
  assert response.json()["tax_rate"] == 20.0
```

---

## 🚀 Code Generation Guidelines for AI

When generating Python code:

1. **Always use async/await for I/O**
   ```python
   # ✅ DO use async
   async def load_galaxy(player_id: int) -> dict:
     return await self.api.get_galaxy(player_id)
   
   # ❌ DON'T use blocking calls
   def load_galaxy(player_id: int) -> dict:
     return requests.get(f"/api/galaxy/{player_id}").json()
   ```

2. **Inject dependencies, never hardcode**
   ```python
   # ✅ DO inject
   def __init__(self, repo: EconomyRepository) -> None:
     self.repo = repo
   
   # ❌ DON'T hardcode
   def __init__(self) -> None:
     self.repo = EconomyRepository()  # Hard-coded!
   ```

3. **Use Pydantic for validation**
   ```python
   # ✅ DO use Pydantic
   class Request(BaseModel):
     rate: float = Field(..., ge=0, le=100)
   
   # ❌ DON'T validate in function
   def process(data: dict):
     if data['rate'] < 0 or data['rate'] > 100:
       raise ValueError()
   ```

4. **Add type hints everywhere**
   ```python
   # ✅ DO type all
   async def set_rate(rate: float, player_id: int) -> dict[str, Any]:
     pass
   
   # ❌ DON'T skip types
   async def set_rate(rate, player_id):
     pass
   ```

5. **Use custom exceptions**
   ```python
   # ✅ DO use custom
   raise ValidationError("Invalid rate", field="rate")
   
   # ❌ DON'T use generic
   raise ValueError("Invalid")
   ```

---

## 🎓 Anti-Patterns to Avoid

| Anti-Pattern | Why Bad | Fix |
|---|---|---|
| Blocking in async | Event loop freezes | Use `await` or `run_in_executor` |
| Hardcoded credentials | Security risk | Use .env + pydantic-settings |
| No type hints | Hard to understand/refactor | Add type hints everywhere |
| Silent exceptions | Debugging nightmare | Log and re-raise or handle explicitly |
| God services | Can't test/understand | Split into smaller services |
| Direct SQL | SQL injection risk | Use SQLAlchemy ORM |
| Circular imports | Breaks imports | Use TYPE_CHECKING guard |
| Mutable default args | Shared state bugs | Use `None` + initialize in function |

---

## 📋 Checklist for New Code

Before submitting Python code:

- [ ] All functions use `async/await` for I/O
- [ ] Dependencies injected via constructor/FastAPI Depends
- [ ] Input validated with Pydantic models
- [ ] Exception types are custom (ValidationError, NotFoundError, etc.)
- [ ] Type hints on all parameters and returns
- [ ] Docstring with Args, Returns, Raises
- [ ] No hardcoded values (use config/constants)
- [ ] No circular dependencies
- [ ] Testable (pure functions where possible)
- [ ] Database access via Repository only
- [ ] Business logic in Service, not Endpoint
- [ ] Error handling with proper status codes

---

**Last Updated:** 2026-08-01  
**Framework:** FastAPI 0.100+, Pydantic 2.0+, Python 3.11+  
**Questions?** See FULLSTACK_ARCHITECTURE_ANALYSIS.md for deep dive.
