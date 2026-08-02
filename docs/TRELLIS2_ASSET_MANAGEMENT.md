# TRELLIS2 Asset Management Architecture

**Last Updated**: 2026-08-02  
**Version**: 1.0  
**Status**: ✅ Database schema & PHP integration complete

---

## 📊 System Overview

TRELLIS2 Asset Management bridges user-customized ship designs to AI-generated 3D models through a layered architecture:

```
User Input (Species + Customizations)
    ↓
Vessel Design JSON (Immutable, Filesystem)
    ↓
TRELLIS2 Prompt Builder (Python)
    ↓
Generation Queue (Async Worker)
    ↓
3D Asset (GLB + Metadata on Filesystem)
    ↓
Database References (Paths, Status, Audit)
    ↓
Frontend 3D Display (WebGL/Three.js)
```

---

## 🗂️ File Organization

### **Layer 1: User Designs (JSON)**
```
generated/designs/
└── {user_id}/
    ├── ship_name_20260802_102046.json    # Immutable snapshot
    ├── ship_name_20260802_102100.json    # Updated version
    └── ...
```

**Contents**:
```json
{
  "species_code": "kryltha",
  "customizations": {
    "carapace_color": "#2d5f4f",
    "detail_level": 85,
    "surface_complexity": 75
  },
  "enhancement_history": [
    {
      "pattern": "model_detail_enhancement",
      "timestamp": "2026-08-02T10:20:46Z",
      "parameters": {...}
    }
  ],
  "created_at": "2026-08-02T10:14:44Z",
  "version": 1
}
```

### **Layer 2: Generated 3D Assets (Binary)**
```
generated/trellis2/models/
└── {generation_uuid}/
    ├── model.glb                    # Binary 3D model (50-500 MB)
    ├── model.thumbnail.png          # Web preview (100-500 KB)
    ├── metadata.json                # Geometry info
    └── textures/
        ├── base_color.png
        ├── normal.png
        └── roughness.png
```

**Metadata Contents**:
```json
{
  "width_cm": 220,
  "height_cm": 45,
  "length_cm": 180,
  "triangle_count": 142500,
  "material_count": 8,
  "texture_resolution": "4k",
  "vertex_count": 71250,
  "generation_time_ms": 8240,
  "model_variant": "text-large"
}
```

### **Layer 3: Database Records (Metadata Only)**

**vessel_designs**
- Stores user customizations + JSON file paths
- Links to latest generation
- Audit: created_at, updated_at, version

**asset_generations**
- Stores completed job metadata
- References filesystem paths (not binaries)
- Tracks generation time, status, errors
- Deduplication via prompt_hash

**generation_queue**
- Async job queue for TRELLIS2 worker
- Priority-based processing
- Status: queued → processing → complete/failed

**user_asset_quotas**
- Storage limits (e.g., 5 GB per user)
- Monthly generation limits (e.g., 100/month)
- Automatic quota enforcement

**generation_audit_log**
- Immutable audit trail for compliance
- Track all state changes

---

## 🔄 Workflow: Design → Generation → Display

### **Step 1: User Creates Design**
```php
$manager = new TRELLIS2AssetManager($db);
$design = $manager->createDesign(
    user_id: 123,
    species_code: 'kryltha',
    customizations: ['carapace_color' => '#2d5f4f', 'detail_level' => 85],
    design_name: 'Insectoid Cruiser'
);
// Returns: {id: 456, design_json_path: "generated/designs/123/...", ...}
```

**What happens:**
- ✅ JSON file saved to `generated/designs/123/Insectoid_Cruiser_20260802_102046.json`
- ✅ DB record inserted into `vessel_designs` table
- ✅ design_json_hash (SHA-256) calculated for deduplication

### **Step 2: Build TRELLIS2 Prompt (Python)**
```python
from tools.trellis2.species_design_templates import SpeciesDesignTemplateLoader
from scripts.trellis2_prompt_enhancement import PromptBuilder

loader = SpeciesDesignTemplateLoader()
builder = PromptBuilder(loader)

# Load design JSON from filesystem
design_json = json.load(open("generated/designs/123/Insectoid_Cruiser_...json"))

# Generate prompt
prompt = builder.build_prompt(
    species_code=design_json['species_code'],
    customizations=design_json['customizations'],
    ship_name='Insectoid Cruiser',
    ship_length=220
)
# Returns: "A Kryl'Tha warship, 220m, with carapace_color=#2d5f4f, ..."
```

**Deduplication Check:**
```python
prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
# Query DB: SELECT id FROM asset_generations WHERE prompt_hash = ?
# If found: return existing GLB (cache hit)
# If not found: queue new generation
```

### **Step 3: Queue Generation Job**
```php
$job_id = $manager->queueGeneration(
    design_id: 456,
    prompt_text: "A Kryl'Tha warship, 220m, ...",
    priority: 0  // 0=normal, higher=faster
);
// Returns: 789 (queue ID)

// INSERT INTO generation_queue (user_id, vessel_design_id, prompt_text, status='queued')
// INSERT INTO generation_audit_log (event='queued', queue_id=789, design_id=456)
```

### **Step 4: Worker Processes Queue (Async)**
```python
# TRELLIS2 Worker Container (Docker)
# Polls: SELECT * FROM generation_queue WHERE status='queued' ORDER BY priority DESC

import httpx
from pathlib import Path

queue_entry = db.fetch_queue_entry()  # {id, prompt_text, vessel_design_id, user_id}

# Call TRELLIS2 API
response = httpx.post('http://trellis2:7862/api/predict', 
    json={'text': queue_entry['prompt_text']},
    timeout=300
)

# Save GLB binary
output_dir = Path(f"generated/trellis2/models/{uuid.uuid4()}")
output_dir.mkdir(parents=True)

glb_path = output_dir / "model.glb"
with open(glb_path, 'wb') as f:
    f.write(response.content)

# Generate thumbnail (PNG)
thumbnail_path = create_thumbnail(glb_path)

# Extract metadata
metadata = extract_glb_metadata(glb_path)

# Register generation
manager.registerGeneration(queue_entry['id'], {
    'glb_path': str(glb_path),
    'thumbnail_path': str(thumbnail_path),
    'metadata': metadata,
    'generation_time_ms': int(response.elapsed.total_seconds() * 1000),
    'generation_uuid': str(output_dir.name)
})
```

**What happens:**
- ✅ INSERT into `asset_generations` with GLB path + metadata
- ✅ UPDATE `vessel_designs` to link latest_generation_id
- ✅ UPDATE `generation_queue` status='complete'
- ✅ UPDATE `user_asset_quotas` storage_used_gb
- ✅ INSERT into `generation_audit_log` for audit trail

### **Step 5: Frontend Displays 3D Model**
```javascript
// GET /api/vessel_designs/456
// Response: {
//   id: 456,
//   design_name: "Insectoid Cruiser",
//   species_code: "kryltha",
//   latest_generation: {
//     id: 999,
//     glb_path: "generated/trellis2/models/abc123/model.glb",
//     thumbnail_path: "generated/trellis2/models/abc123/model.thumbnail.png",
//     status: "complete"
//   }
// }

// Load GLB via Three.js
const loader = new THREE.GLTFLoader();
loader.load('/generated/trellis2/models/abc123/model.glb', (gltf) => {
  scene.add(gltf.scene);
});

// Or show thumbnail while loading
img.src = '/generated/trellis2/models/abc123/model.thumbnail.png';
```

---

## 💾 Database Schema (Quick Reference)

### **vessel_designs**
| Column | Type | Purpose |
|--------|------|---------|
| id | BIGINT | Primary key |
| user_id | INT | FK to users |
| design_name | VARCHAR(255) | Display name |
| species_code | VARCHAR(64) | Reference to YAML template |
| design_json_path | VARCHAR(255) | Filesystem path |
| design_json_hash | VARCHAR(64) | SHA-256 for dedup |
| customizations_json | JSON | Serialized customizations |
| latest_generation_id | BIGINT | FK to asset_generations |
| is_deleted | TINYINT | Soft delete flag |

### **asset_generations**
| Column | Type | Purpose |
|--------|------|---------|
| id | BIGINT | Primary key |
| generation_uuid | VARCHAR(36) | Directory name |
| user_id | INT | Owner |
| vessel_design_id | BIGINT | Parent design |
| prompt_text | LONGTEXT | TRELLIS2 prompt (immutable) |
| prompt_hash | VARCHAR(64) | SHA-256 for dedup |
| glb_path | VARCHAR(255) | Filesystem path to GLB |
| glb_file_size | BIGINT | For quota tracking |
| thumbnail_path | VARCHAR(255) | Preview PNG |
| metadata_json | JSON | {triangles, materials, size, ...} |
| status | ENUM | queued/processing/complete/failed |
| generation_time_ms | INT | Execution time |

### **generation_queue**
| Column | Type | Purpose |
|--------|------|---------|
| id | BIGINT | Primary key |
| status | ENUM | queued/processing/complete/failed |
| priority | SMALLINT | Higher = processed sooner |
| user_id | INT | Requestor |
| vessel_design_id | BIGINT | What to generate |
| prompt_text | LONGTEXT | Input to TRELLIS2 |
| worker_id | VARCHAR(64) | Which container is working on this |
| generation_id | BIGINT | Result reference (once complete) |

---

## 🔐 Quota System

### **Per-User Limits**
```sql
SELECT * FROM user_asset_quotas WHERE user_id = 123;
-- storage_limit_gb: 5.0
-- storage_used_gb: 2.3
-- monthly_generation_limit: 100
-- monthly_generations_used: 42
```

### **Automatic Enforcement**
- ✅ `validateQuota()` called before queueing
- ✅ Throws `RuntimeException` if over limit
- ✅ Trigger `trg_update_storage_on_generation_complete` updates storage_used on completion
- ✅ Trigger `trg_update_monthly_generations` increments monthly_generations_used

### **Admin/Supporter Tiers**
```php
// User quota by priority_level
'free'      → 5 GB storage, 100 generations/month
'supporter' → 20 GB storage, 500 generations/month
'premium'   → 100 GB storage, unlimited
'admin'     → unlimited
```

---

## 🚀 Cache Hit Detection

**Prompt Deduplication**:
1. Calculate SHA-256 hash of TRELLIS2 prompt
2. Query `asset_generations` for matching prompt_hash with status='complete'
3. If found: return existing generation (cache hit, no TRELLIS2 call)
4. If not found: queue new generation

**Example:**
```sql
SELECT id, glb_path, thumbnail_path 
FROM asset_generations 
WHERE prompt_hash = SHA2('A Kryl''Tha warship...', 256) 
  AND status = 'complete' 
  AND is_deleted = 0
LIMIT 1;
-- Result: (999, "generated/trellis2/models/xyz/model.glb", ...)
```

---

## 📝 API Integration Points

### **Create Design**
```php
POST /api/vessel_designs
Body: {
  species_code: 'kryltha',
  design_name: 'Cruiser Alpha',
  customizations: {carapace_color: '#2d5f4f', ...}
}
Response: {
  design_id: 456,
  design_json_path: 'generated/designs/123/...',
  status: 'created'
}
```

### **Queue Generation**
```php
POST /api/vessel_designs/456/generate
Body: {prompt_text: '...TRELLIS2 formatted...'}
Response: {
  queue_id: 789,
  status: 'queued',
  position: 5,  // in queue
  estimated_wait_seconds: 120
}
```

### **Poll Status**
```php
GET /api/vessel_designs/456/generations/999
Response: {
  status: 'complete',
  glb_path: 'generated/trellis2/models/abc/model.glb',
  thumbnail_path: '...',
  metadata: {triangles: 142500, ...},
  completed_at: '2026-08-02T10:20:50Z'
}
```

### **List User Designs**
```php
GET /api/vessel_designs?user_id=123
Response: [
  {
    id: 456,
    design_name: 'Cruiser Alpha',
    species_code: 'kryltha',
    created_at: '...',
    latest_generation: {...}
  },
  ...
]
```

---

## 🛠️ Installation & Setup

### **1. Run Database Migration**
```bash
mysql -u root -p galaxyquest < sql/migrate_trellis2_integration_v1.sql
```

### **2. Load PHP Helper**
```php
require_once __DIR__ . '/api/trellis2_asset_manager.php';

$manager = new TRELLIS2AssetManager($db);
```

### **3. Test Cache Hit Detection**
```php
$design = $manager->createDesign(123, 'kryltha', [...]);
$job1 = $manager->queueGeneration($design['id'], 'A Kryl\'Tha warship...');
$job2 = $manager->queueGeneration($design['id'], 'A Kryl\'Tha warship...');
// job2 should be a cache hit, not queued again
```

---

## 📊 Views for Operations

### **v_user_designs_with_status**
```sql
SELECT * FROM v_user_designs_with_status 
WHERE user_id = 123
ORDER BY created_at DESC;
```
Shows all designs with latest generation status (cached).

### **v_generation_queue_status**
```sql
SELECT * FROM v_generation_queue_status 
WHERE status IN ('queued', 'processing')
ORDER BY queue_position;
```
Shows current queue with position and ETA.

### **v_user_storage_usage**
```sql
SELECT * FROM v_user_storage_usage 
WHERE user_id = 123;
```
Shows storage utilization, quota, and remaining capacity.

---

## 🔍 Debugging & Monitoring

### **Check Queue Backlog**
```sql
SELECT status, COUNT(*) AS count, AVG(TIMESTAMPDIFF(MINUTE, created_at, NOW())) AS avg_wait_min
FROM generation_queue
GROUP BY status;
```

### **Find Slow Generations**
```sql
SELECT id, generation_time_ms, glb_file_size
FROM asset_generations
WHERE generation_time_ms > 20000
ORDER BY generation_time_ms DESC;
```

### **Audit Trail for Design**
```sql
SELECT * FROM generation_audit_log
WHERE vessel_design_id = 456
ORDER BY created_at DESC;
```

### **Cache Hit Ratio**
```sql
SELECT 
  COUNT(*) AS total_queries,
  COUNT(CASE WHEN prompt_hash IN (
    SELECT prompt_hash FROM asset_generations GROUP BY prompt_hash HAVING COUNT(*) > 1
  ) THEN 1 END) AS cache_hits
FROM asset_generations;
```

---

## ✅ Verification Checklist

- [ ] `sql/migrate_trellis2_integration_v1.sql` executed without errors
- [ ] All 6 tables created (`vessel_designs`, `asset_generations`, etc.)
- [ ] All views created (`v_user_designs_with_status`, etc.)
- [ ] All triggers created (quota updates, audit logging)
- [ ] `api/trellis2_asset_manager.php` loaded in relevant endpoints
- [ ] TRELLIS2 Docker service running (`docker compose up trellis2 -d`)
- [ ] Generated directories exist (`generated/designs/`, `generated/trellis2/models/`)
- [ ] Test creation and queueing of a design
- [ ] Test cache hit detection on duplicate prompt

---

## 📚 Related Files

- **Python Prompt Builder**: `scripts/trellis2_prompt_enhancement.py`
- **Species Templates**: `tools/trellis2/species_design_templates.yaml`
- **Frontend UI**: `js/ui/ship-designer.js`, `js/ui/ship-designer-enhanced.js`
- **TRELLIS2 Generator API**: `api/trellis2_generator.php`
- **Test Suite**: `scripts/trellis2_prompt_enhancement_test.py`

---

**Questions? Check the conversation history in the session for architecture decisions.** 🚀
