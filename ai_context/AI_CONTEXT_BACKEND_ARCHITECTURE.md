# AI Context: Backend Architecture – PHP + Python Hybrid

**Status**: Established Best Practice  
**Last Updated**: 2026-08-02  
**Scope**: GalaxyQuest backend design patterns & deployment

---

## 🎯 ARCHITEKTUR-ENTSCHEIDUNG: Warum PHP + Python?

GalaxyQuest nutzt ein **bewusstes Hybrid-Modell**:

| Komponente | Technologie | Grund |
|-----------|-----------|-------|
| **Game Engine, APIs, DB-Logic** | PHP 8.1 | Schnell (5-50ms), einfach, stabil |
| **3D-Generierung (TRELLIS2)** | Python + CUDA | GPU-native, Text-to-3D ML |
| **Audio-Synthese (TTS)** | Python FastAPI | Audio-ML spezialisiert |
| **CLI-Tools, DevOps** | Python 3.11+ | Scripting, Automation, Type-safety |

**Kernprinzip**: Jede Komponente tut das, worin sie am besten ist. Entkopplung durch HTTP + Shared Database.

---

## ✅ WANN PHP NUTZEN (Frontend zum Game-Server)

### Verantwortungen:
- Request-Routing (match/switch statements)
- Session/Auth Management (JWT, CORS)
- Spiellogik (Bewegung, Kämpfe, Diplomatie, Wirtschaft)
- Database-Zugriff (PDO prepared statements)
- Cache-Invalidation (gq_cache_* functions)
- Schnelle Responses (<50ms target)

### Code Pattern:
```php
<?php
// api/ship_designer_enhanced.php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';

final class EnhancedShipDesigner {
    private PDO $db;
    
    public function customizeShip(array $data): array {
        // ✅ Validiere Input
        $validator = new ShipCustomizationValidator($data);
        if (!$validator->isValid()) {
            return ['error' => $validator->getErrors()];
        }
        
        // ✅ Speichere in DB (schnell)
        $stmt = $this->db->prepare(
            'INSERT INTO ship_customizations (faction_code, components, details) 
             VALUES (?, ?, ?)'
        );
        $stmt->execute([$data['faction'], json_encode($data['components']), $data['details']]);
        
        return [
            'success' => true,
            'customization_id' => $this->db->lastInsertId()
        ];
    }
    
    // ✅ Nur Queueing, nicht Verarbeitung!
    public function refineWithTRELLIS2(int $customizationId): array {
        $prompt = $this->buildPrompt($customizationId);
        
        // Send to Python service (async)
        $jobId = $this->queueGenerationJob('trellis2_refine', [
            'customization_id' => $customizationId,
            'prompt' => $prompt
        ]);
        
        return [
            'job_id' => $jobId,
            'status' => 'queued',
            'poll_url' => "/api/generation_status?job_id=$jobId"
        ];
    }
}
```

---

## ✅ WANN PYTHON NUTZEN (Specialized Services)

### 1. **TRELLIS2 3D-Generator** (Docker Container)
```python
# trellis2_service/app.py
from fastapi import FastAPI
from typing import Optional
import torch
from trellis.models import TRELLIS2

app = FastAPI()
model = TRELLIS2.from_pretrained("jrchen/trellis-base")

@app.post("/api/generate")
async def generate_text_to_model(prompt: str, sync: bool = False) -> dict:
    """
    Text-to-3D generation
    
    Args:
        prompt: Detailed geometry/texture specification
        sync: If False, queue job and return job_id (preferred)
    
    Returns:
        {
            "job_id": "trellis2_abc123",
            "glb_data": b"...",  # wenn sync=True
            "status": "completed"
        }
    """
    with torch.no_grad():
        outputs = model(prompt)
    
    return {"glb_data": outputs.to_glb(), "status": "completed"}
```

**Warum Python?**
- GPU/CUDA native (nicht in PHP)
- ML Frameworks (PyTorch, TensorFlow)
- Async/await eleganter für lange Jobs
- Type Hints, Pydantic Validation

### 2. **TTS Audio Service** (Docker Container)
```python
# tts_service/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import asyncio

class SynthesisRequest(BaseModel):
    text: str
    speaker_id: int
    language: str = "en"

@app.post("/api/synthesize")
async def synthesize(req: SynthesisRequest) -> dict:
    audio_wav = await synthesize_text(req.text, req.speaker_id)
    return {
        "audio_url": f"/audio/{req.speaker_id}/{hash(req.text)}.mp3",
        "duration_ms": calculate_duration(audio_wav)
    }
```

### 3. **CLI Tools & Batch Processing**
```python
# scripts/seed_trellis2_assets.py
from typing import Optional
import asyncio

async def seed_assets(faction_code: Optional[str] = None, no_wait: bool = False) -> None:
    """
    Batch-generate all ship components for faction(s)
    
    Usage:
        python scripts/seed_trellis2_assets.py --faction vor_tak --no-wait
    """
    db = await connect_db()
    
    factions = [faction_code] if faction_code else PLAYABLE_FACTIONS
    
    for faction in factions:
        job_id = await queue_generation(
            component_type='base_hull',
            faction_code=faction,
            prompt=ShipComponentPromptLibrary.get_hull_prompt(faction)
        )
        
        if not no_wait:
            await wait_for_job(job_id, timeout=300)
            print(f"✓ {faction} hull generated")
```

---

## 🚨 ANTI-PATTERNS: Was NICHT tun

### ❌ 1. Synchrone Python-Aufrufe aus PHP
```php
// FALSCH: PHP blockiert bis Python fertig
$result = exec('python3 /app/scripts/generate_ship.py --id=' . $shipId);
// → Dauert 45 Sekunden, Client hängt, Timeout-Fehler
```

**Fix**: Nur asynchrones Queueing
```php
// ✅ RICHTIG: PHP returned sofort
$jobId = $this->queueGenerationJob('trellis2_generate', ['ship_id' => $shipId]);
return ['job_id' => $jobId, 'status_url' => '/api/job_status?id=' . $jobId];
// → Instant response, Client pollt asynchron
```

### ❌ 2. Python-Business-Logic im Backend
```python
# FALSCH: Game-Logik sollte nicht in Python sein
def calculate_fleet_damage(attacker_ships, defender_ships):
    # Komplexe Diplomatie/Krieg-Formeln
    # → Schwer zu debuggen, nicht mit PHP synchronisiert
    ...
```

**Fix**: Business-Logic bleibt in PHP
```php
// ✅ RICHTIG: PHP macht Spiellogik
class FleetCombatCalculator {
    public function calculateDamage(Fleet $attacker, Fleet $defender): int {
        // Deterministisch, getestet, schnell
    }
}
// Python macht nur spezialisierte Tasks (KI, ML, Audio)
```

### ❌ 3. Direct shell_exec() ohne Timeout
```php
// FALSCH: Blockiert, keine Error-Handling
$output = shell_exec('python3 script.py');
```

**Fix**: HTTP-basierte Kommunikation
```php
// ✅ RICHTIG: Non-blocking HTTP Client
$client = new HttpClient(['timeout' => 2]); // 2s timeout
$response = $client->post('http://trellis2:7862/api/generate', [
    'timeout' => 2 // Non-blocking, fail-fast
]);
```

### ❌ 4. Race Conditions bei Shared State
```python
# FALSCH: Python schreibt Cache während PHP liest
redis.set(f"ship:{ship_id}:components", new_components)
```

**Fix**: Database ist Source of Truth
```python
# ✅ RICHTIG: Nur DB schreibt
await db.update_ship_components(ship_id, new_components)
# PHP liest immer von DB, Cache ist nur Read-Through
```

---

## 🏗️ DEPLOYMENT ARCHITECTURE

### Docker Compose Structure:
```yaml
services:
  # Tier 1: Game Server (Synchron, Fast)
  web:
    image: php:8.1-fpm
    environment:
      - TRELLIS2_API_URL=http://trellis2:7862
      - TTS_API_URL=http://tts_service:8000
    depends_on:
      - db

  # Shared State
  db:
    image: mysql:8.4
    ports:
      - "3306:3306"

  # Tier 2: Specialized Services (Async, ML)
  trellis2:
    build:
      context: .
      dockerfile: docker/trellis2/Dockerfile
    runtime: nvidia  # GPU access
    environment:
      - TRELLIS2_MODEL=jrchen/trellis-base
    ports:
      - "7862:7862"

  tts_service:
    build:
      context: tts_service/
    environment:
      - TRELLIS_API_URL=http://trellis2:7862
    ports:
      - "8000:8000"
```

**Kommunikation**:
- PHP → TRELLIS2: HTTP REST (async)
- PHP → TTS: HTTP REST (async)
- PHP ↔ Database: PDO/MySQL (sync)
- Services ↔ Database: Same (optional ORM)

---

## 📊 PERFORMANCE TARGETS

| Operation | Target | PHP | Python | Notes |
|-----------|--------|-----|--------|-------|
| Simple API | <10ms | ✓ 5ms | ✗ 50ms | PHP wins |
| Game Query | <50ms | ✓ 20ms | ~ 100ms | DB-bound |
| 3D Generation | ~45s | ✗ N/A | ✓ 45s | Async job |
| TTS Synthesis | <500ms | ✗ N/A | ✓ 300ms | Streaming |

**Rule of Thumb**: If response <100ms, use PHP. If >1s, use Python async.

---

## 🔐 SECURITY CONSIDERATIONS

### Authentication:
```php
// PHP validates auth (same as all requests)
$user = authenticate_jwt($_SERVER['HTTP_AUTHORIZATION']);
if (!$user) return error_response(401, 'Unauthorized');

// When queuing Python job, include user context
$jobId = queue_job('trellis2_generate', [
    'user_id' => $user['id'],
    'faction_code' => $user['faction_code'],
    'prompt' => ...
]);
```

### Data Validation:
```python
# Python also validates (defense in depth)
from pydantic import BaseModel, validator

class GenerationRequest(BaseModel):
    prompt: str
    faction_code: str
    
    @validator('faction_code')
    def valid_faction(cls, v):
        if v not in VALID_FACTIONS:
            raise ValueError(f"Invalid faction: {v}")
        return v
```

---

## 📋 CODING STANDARDS

### PHP (when to use):
- ✅ Full type hints on public methods
- ✅ PDO prepared statements only
- ✅ No `shell_exec()` for long operations
- ✅ Use gq_cache_* for caching
- ✅ Structlog for logging
- ✅ Keep responses <50ms

**Standard**: `/github/copilot-instructions.md` Python section

### Python (when to use):
- ✅ Type hints (Python 3.11+)
- ✅ Async/await for I/O
- ✅ Pydantic for validation
- ✅ httpx for HTTP (not urllib)
- ✅ structlog for structured logging
- ✅ Pytest for testing

**Standard**: `RespoTemplate-Python` + `/github/copilot-instructions.md`

---

## 🧪 TESTING STRATEGY

### PHP (Unit + Integration):
```php
// tests/EnhancedShipDesignerTest.php
class EnhancedShipDesignerTest extends TestCase {
    public function test_customize_ship_returns_correct_structure() {
        // Mock DB
        // Assert response structure
        // No actual Python calls
    }
    
    public function test_refine_queues_job_without_blocking() {
        // Verify job was queued in DB
        // Assert immediate response (<10ms)
        // Do NOT wait for Python result
    }
}
```

### Python (Pytest):
```python
# trellis2_service/tests/test_generation.py
@pytest.mark.asyncio
async def test_generate_returns_valid_glb():
    glb_data = await generate_text_to_model("test prompt")
    assert isinstance(glb_data, bytes)
    assert glb_data[:4] == b'glTF'  # GLB magic number
```

### Integration (E2E):
```bash
# Docker Compose up, run full workflow
docker compose up -d
php -d error_reporting=E_ALL scripts/test_e2e.php
```

---

## 📚 KEY FILES REFERENCE

| File | Purpose | Language |
|------|---------|----------|
| `api/ship_designer_enhanced.php` | Main Game API | PHP |
| `api/trellis2_generator.php` | TRELLIS2 Client | PHP |
| `api/ship_component_prompts.php` | Prompt Library | PHP |
| `trellis2_service/app.py` | 3D Generator Service | Python |
| `tts_service/main.py` | Audio Service | Python |
| `scripts/seed_trellis2_assets.py` | Batch Processing | Python |
| `docker-compose.yml` | Deployment Config | YAML |

---

## 🚀 WHEN TO ADD A NEW SERVICE

1. **Does it require:** GPU, Heavy ML, Audio, or >10s processing?
   → Use **Python Container**

2. **Does it need:** Sub-50ms response, auth, cache, DB queries?
   → Use **PHP API**

3. **Is it:** One-time setup, data migration, CI/CD automation?
   → Use **Python CLI Script**

4. **Can it wait:** Async queuing with polling?
   → Use **Docker Service** + **Job Queue** pattern

---

## ✅ CHECKLIST FOR NEW BACKEND FEATURE

- [ ] Is this synchronous (game logic) or asynchronous (generation)?
- [ ] Does it need GPU/ML libraries?
- [ ] Will it complete in <100ms or >10s?
- [ ] Is the response needed immediately or can it be polled?
- [ ] Which service should own it (PHP or Python)?
- [ ] How will services communicate (HTTP, Database, Shared Cache)?
- [ ] Are inputs validated in both PHP AND Python (defense in depth)?
- [ ] Is there a timeout and graceful degradation?
- [ ] Are long operations queued as async jobs?
- [ ] Can services fail independently without taking down the whole game?

---

**Rule**: When in doubt, use PHP for game logic, Python for specialized tasks.  
**Value**: Clear separation, easy debugging, efficient resource use, independent scaling.
