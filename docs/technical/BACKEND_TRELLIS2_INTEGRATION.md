# Backend TRELLIS2 Integration – Complete Guide

**Zusammenfassung**: Vollständige Backend-gesteuerte 3D-Asset-Generierung nach Spezies-Vorgaben. Basis-Komponenten werden vom Backend generiert → Spieler individualisiert im Designer.

---

## 🏗 Architektur-Übersicht

```
┌─ Backend (Server-seitig) ──────────────────────────────────┐
│                                                              │
│  trellis2_generator.php                                     │
│  ├── TRELLIS2Client (HTTP REST API zum Docker Container)   │
│  ├── BaseShipComponentGenerator (Komponenten-Generierung)  │
│  │   ├── generateBaseHull()      → canonical hull per faction
│  │   ├── generateWeaponHardpoints()                        │
│  │   ├── generateEngineModules()                           │
│  │   ├── generateShieldModules()                           │
│  │   └── generateSensorArray()                             │
│  └── SpeciesAvatarGenerator (Avatar-Generierung)           │
│      ├── generateSpeciesAvatar() → 3D character (m/f)      │
│      └── buildAvatarPrompt()                               │
│                                                              │
│  ship_designer_enhanced.php                                 │
│  └── EnhancedShipDesigner                                  │
│      ├── getBaseAssets() → Cached base components          │
│      ├── getSpeciesAvatar()                                │
│      ├── customizeShip() → Player customization            │
│      └── refineWithTRELLIS2() → Queue AI refinement        │
│                                                              │
│  Datenbank                                                   │
│  ├── trellis2_generation_queue → Job tracking               │
│  ├── base_ship_components → Cached canonical assets         │
│  ├── species_avatars → Character models                     │
│  └── user_ship_customizations → Player selections           │
│                                                              │
└────────────────────────────────────────────────────────────┘
         │
         │ HTTP REST API
         ↓
    Docker: TRELLIS2
    ├── Text→3D via diffusion model
    ├── Port 7862: Image→3D WebApp
    ├── Port 7863: Text→3D WebApp
    └── GPU acceleration (CUDA)
```

---

## 📦 Komponenten-Architektur

### 1. **TRELLIS2Client** (`trellis2_generator.php`)

Kommuniziert mit dem Docker TRELLIS2 Container über REST API.

```php
$trellis2 = new TRELLIS2Client('http://trellis2:7862');

// Health check
if ($trellis2->healthCheck()) {
    echo "TRELLIS2 operational";
}

// Generate Text→Model (async)
$result = $trellis2->generateText2Model($prompt, ['sync' => false]);
$jobId = $result['job_id'];

// Poll status
$status = $trellis2->getJobStatus($jobId);

// Get output
$glbBuffer = $trellis2->getJobOutput($jobId);
```

**Features**:
- ✓ Health-Check
- ✓ Async job queuing
- ✓ Job polling
- ✓ Output retrieval (base64 → binary)
- ✓ Timeout-Handling

### 2. **BaseShipComponentGenerator** (`trellis2_generator.php`)

Generiert kanonische Komponenten pro Fraktion:

```php
$generator = new BaseShipComponentGenerator($db);

// Queue hull generation
$result = $generator->generateBaseHull('vor_tak');
// → Returns: ['success' => true, 'job_id' => '...']

// Queue all components
$result = $generator->generateWeaponHardpoints('vor_tak');
$result = $generator->generateEngineModules('vor_tak');
$result = $generator->generateShieldModules('vor_tak');
$result = $generator->generateSensorArray('vor_tak');

// Check and finalize
$finalized = $generator->finalizeJob($jobId);
// → Returns: ['complete' => true, 'glb_path' => '...', 'file_size' => ...]

// Get cached components
$cached = $generator->getCachedComponents('vor_tak');
// → Returns: {
//   'hull': { glb_path, metadata, cached_at },
//   'weapons': [...],
//   'engines': [...],
//   ...
// }
```

**Generierte Komponenten**:
| Komponente | Prompt-Basis | Anzahl |
|-----------|----------|--------|
| **Hull** | Fraktions-Silhouette + Materialien | 1 pro Fraktion |
| **Waffen** | 3 Hardpoint-Größen (Small/Medium/Large) | 3 |
| **Triebwerke** | 3 Engine-Größen | 3 |
| **Schilde** | Shield Generator + Emitter | 2 |
| **Sensoren** | Array/Antenna-Design | 1 |

### 3. **SpeciesAvatarGenerator** (`trellis2_generator.php`)

Generiert 3D-Character-Modelle für jede Spezies:

```php
$avatarGen = new SpeciesAvatarGenerator($db);

// Queue both male/female
$result = $avatarGen->generateSpeciesAvatar('vor_tak', 'both');
// → Returns: {
//   'male': ['success' => true, 'job_id' => '...'],
//   'female': ['success' => true, 'job_id' => '...']
// }

// Get cached avatar
$avatar = $avatarGen->getSpeciesAvatar('vor_tak', 'male');
// → Returns: {
//   'glb_path': '...',
//   'thumbnail': '...',
//   'metadata': {...}
// }
```

**Avatar-Features**:
- ✓ Gender-spezifische Varianten (m/f)
- ✓ Fraktions-authentische Designs
- ✓ T-Pose (standardisiert für Game Engine)
- ✓ 5,000–8,000 Triangles (performance optimized)
- ✓ Thumbnail-Generierung

### 4. **EnhancedShipDesigner** (`ship_designer_enhanced.php`)

Kombiniert generierte Basis-Assets mit Spieler-Customization:

```php
$designer = new EnhancedShipDesigner($db);

// 1. Spieler wählt Fraktion → Get base assets
$assets = $designer->getBaseAssets('vor_tak');
// → Returns: {
//   'hull': { path, exists, metadata, size },
//   'components': {
//     'weapons': [...],
//     'engines': [...],
//     ...
//   }
// }

// 2. Spieler individualisiert → Store customization
$custom = $designer->customizeShip([
    'user_id' => $uid,
    'faction_code' => 'vor_tak',
    'ship_class' => 'corvette',
    'ship_name' => 'Vor\'Tak Klingenfang',
    'components' => [
        'weapons' => 'medium_hardpoint',
        'engines' => 'large_engine',
        'shields' => 'standard_shield'
    ],
    'custom_details' => 'sleeker hull, more aggressive angles'
]);
// → Returns: { 'success' => true, 'customization_id' => 42, ... }

// 3. Optional: Queue TRELLIS2 refinement
$refine = $designer->refineWithTRELLIS2(42);
// → Returns: { 'success' => true, 'job_id' => '...', ... }
```

---

## 🗄 Datenbank-Schema

### `trellis2_generation_queue`

Verfolgt alle TRELLIS2-Generierungsjobs:

```sql
CREATE TABLE trellis2_generation_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(128) NOT NULL UNIQUE,
    component_type VARCHAR(32),          -- hull, weapons, engines, avatar
    faction_code VARCHAR(32),
    prompt LONGTEXT,
    metadata JSON,
    status ENUM('queued', 'processing', 'completed', 'failed'),
    glb_path VARCHAR(255),               -- Path to saved GLB file
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL
);
```

### `base_ship_components`

Cache für generierte Basis-Komponenten:

```sql
CREATE TABLE base_ship_components (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_code VARCHAR(32) NOT NULL,
    component_type VARCHAR(32) NOT NULL,
    glb_path VARCHAR(255) NOT NULL,
    metadata JSON,
    version INT DEFAULT 1,
    checksum VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (faction_code, component_type)
);
```

### `species_avatars`

Cache für generierte Character-Modelle:

```sql
CREATE TABLE species_avatars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    species_code VARCHAR(32) NOT NULL,
    gender ENUM('male', 'female') NOT NULL,
    glb_path VARCHAR(255) NOT NULL,
    metadata JSON,
    thumbnail_path VARCHAR(255),
    version INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (species_code, gender)
);
```

### `user_ship_customizations`

Spieler-Customizations:

```sql
CREATE TABLE user_ship_customizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_code VARCHAR(32) NOT NULL,
    ship_class VARCHAR(32) NOT NULL,
    ship_name VARCHAR(128),
    selected_components JSON,           -- which component variants
    custom_details TEXT,                -- player's custom prompt
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 🚀 API-Endpunkte

### **POST** `/api/trellis2_generator.php?action=generate_base_hull`

Queue hull generation für Fraktion.

**Request**:
```json
{
  "faction_code": "vor_tak"
}
```

**Response**:
```json
{
  "success": true,
  "job_id": "trellis2_job_abc123",
  "component_type": "hull",
  "faction_code": "vor_tak"
}
```

### **POST** `/api/trellis2_generator.php?action=generate_components`

Queue alle Komponenten auf einmal.

**Request**:
```json
{
  "faction_code": "syl_nar",
  "component_type": "all"  // or "weapons", "engines", etc.
}
```

**Response**:
```json
{
  "generation_jobs": {
    "hull": { "success": true, "job_id": "..." },
    "weapons": { "success": true, "job_id": "..." },
    "engines": { "success": true, "job_id": "..." },
    ...
  }
}
```

### **GET** `/api/trellis2_generator.php?action=generation_status&job_id=...`

Prüfe Job-Status und finalisiere bei Completion.

**Response**:
```json
{
  "complete": false,
  "status": "processing",
  "progress": 45
}

// Wenn complete:
{
  "complete": true,
  "glb_path": "/generated/trellis2/components/job_id.glb",
  "file_size": 2451234
}
```

### **GET** `/api/trellis2_generator.php?action=base_components&faction_code=vor_tak`

Hole alle gecachten Basis-Komponenten.

**Response**:
```json
{
  "components": {
    "hull": {
      "glb_path": "...",
      "metadata": {...},
      "cached_at": "2026-08-02T14:30:00Z"
    },
    "weapons": [{...}, {...}, {...}],
    "engines": [{...}, {...}, {...}],
    ...
  }
}
```

### **POST** `/api/trellis2_generator.php?action=generate_avatar`

Queue avatar generation.

**Request**:
```json
{
  "species_code": "vor_tak",
  "gender": "both"  // or "male", "female"
}
```

### **GET** `/api/ship_designer_enhanced.php?action=get_base_assets&faction_code=vor_tak`

Hole Basis-Assets für Designer.

**Response**:
```json
{
  "base_assets": {
    "faction_code": "vor_tak",
    "hull": { "path": "...", "exists": true, "metadata": {...} },
    "components": {
      "weapons": [...],
      "engines": [...],
      ...
    }
  }
}
```

### **POST** `/api/ship_designer_enhanced.php?action=customize_ship`

Speichere Spieler-Customization.

**Request**:
```json
{
  "faction_code": "vor_tak",
  "ship_class": "corvette",
  "ship_name": "Void Stalker",
  "components": {
    "weapons": "medium_hardpoint",
    "engines": "large_engine",
    "shields": "standard_shield"
  },
  "custom_details": "sleeker hull, aggressive paint scheme"
}
```

**Response**:
```json
{
  "success": true,
  "customization_id": 42,
  "ready_for_refinement": true
}
```

### **POST** `/api/ship_designer_enhanced.php?action=refine_with_trellis2`

Queue TRELLIS2 Refinement.

**Request**:
```json
{
  "customization_id": 42
}
```

**Response**:
```json
{
  "success": true,
  "job_id": "trellis2_refine_xyz",
  "customization_id": 42,
  "status": "queued"
}
```

---

## 🔧 Setup & Deployment

### 1. Docker TRELLIS2 vorbereiten

```bash
# Start container (GPU)
docker compose --profile ai-3d up -d trellis2

# Check health
curl http://localhost:7862/api/health

# Download models (~15 GB)
python -m scripts.download_trellis2_models
```

### 2. Datenbank-Migration

```bash
# Run migration
php tools/run_migration.php trellis2_generation_queue

# Verify tables
mysql -u user -p galaxyquest -e "SHOW TABLES LIKE 'trellis2%';"
```

### 3. Seed Base Assets (First-Time Setup)

```bash
# Generate all factions + avatars (takes 30+ minutes)
php tools/seed_trellis2_assets.php

# Or specific faction
php tools/seed_trellis2_assets.php --faction vor_tak

# Don't wait for completion
php tools/seed_trellis2_assets.php --no-wait

# Skip avatars
php tools/seed_trellis2_assets.php --skip-avatars
```

### 4. Verify Setup

```bash
# Check cached components
SELECT COUNT(*) as component_count FROM base_ship_components;
SELECT COUNT(*) as avatar_count FROM species_avatars;

# Test endpoint
curl http://localhost/api/trellis2_generator.php?action=status
```

---

## 🎮 Spieler-Workflow

### 1. **Basis-Asset-Auswahl**
```
Spieler wählt Fraktion (z.B. Syl'Nar)
        ↓
GET /api/ship_designer_enhanced.php?action=get_base_assets&faction_code=syl_nar
        ↓
UI zeigt Basis-Hull + verfügbare Komponenten
```

### 2. **Customization**
```
Spieler:
  - Wählt Schiff-Klasse (Frigate)
  - Wählt Komponenten-Varianten (large engines, medium weapons)
  - Gibt Namen & Customization-Details
        ↓
POST /api/ship_designer_enhanced.php?action=customize_ship
        ↓
Backend speichert Customization (ID: 42)
```

### 3. **Optional: TRELLIS2 Refinement**
```
Spieler klickt "Refine with AI"
        ↓
POST /api/ship_designer_enhanced.php?action=refine_with_trellis2
        ↓
Backend queued Generierung:
  - Lädt Basis-Hull
  - Assembliert gewählte Komponenten
  - Wendet Customization-Details an
  - Generiert finales GLB
        ↓
Spieler sieht "Refining... 45%" (WebSocket polling)
        ↓
Finales Schiff bereit zum Speichern
```

---

## 📊 Performance & Optimierungen

| Operation | Zeit | Notes |
|-----------|------|-------|
| Hull generation | 45–60s | Von Scratch mit Diffusion |
| Component generation | 30–45s | Pro Komponenten-Typ |
| Refinement assembly | 20–30s | Komponentenzusammenfügung |
| Avatar generation | 60–90s | Male + Female |
| Gesamte Seeding | 30+ min | Alle 6 Fraktionen × 5 Komponenten |

**Optimierungen**:
- ✓ Basis-Assets werden einmal generiert + gecacht
- ✓ Nur Refinement-Jobs für Player-Customizations neu generiert
- ✓ Async Job Queue (non-blocking)
- ✓ GLB-Streaming (keine In-Memory Buffers)
- ✓ Database Indexierung auf Job-Status

---

## 🧪 Testing

### Unit Tests

```bash
phpunit tests/Unit/TRELLIS2ClientTest.php
phpunit tests/Unit/BaseShipComponentGeneratorTest.php
phpunit tests/Unit/SpeciesAvatarGeneratorTest.php
phpunit tests/Unit/EnhancedShipDesignerTest.php
```

### Integration Tests

```bash
# Requires running TRELLIS2 container
phpunit tests/Integration/TRELLIS2GenerationTest.php
```

### Manual Testing

```bash
# Health check
curl http://localhost/api/trellis2_generator.php?action=status

# Queue hull generation
curl -X POST http://localhost/api/trellis2_generator.php?action=generate_base_hull \
  -H "Content-Type: application/json" \
  -d '{"faction_code":"vor_tak"}'

# Check status
curl "http://localhost/api/trellis2_generator.php?action=generation_status&job_id=..."
```

---

## 📋 Checklist: Production Deployment

- [ ] Docker TRELLIS2 läuft mit GPU-Support
- [ ] Datenbank-Migrations durchgeführt
- [ ] Base Assets geseedet (oder manuell generiert)
- [ ] API-Endpunkte getestet
- [ ] Authentication eingerichtet
- [ ] Error-Logging konfiguriert
- [ ] Cache-Invalidation bei Asset-Updates
- [ ] Disk-Speicher für GLB-Files (~500 MB pro Faction)
- [ ] Monitoring für Generation Jobs
- [ ] Backup-Strategie für gecachte Assets

---

## 🔗 Integration mit bestehendem Ship Designer

Der ursprüngliche `ship_designer_engine.php` bleibt intakt. Der neue `ship_designer_enhanced.php` erweitert ihn um:

1. **Base Asset Management** (statt Mocks)
2. **Backend-gesteuerte Generation** (statt Client-side)
3. **Async Job Queue** (statt Blocking-Calls)
4. **Avatar Integration** (neu)

### Migrationsschritte:
```php
// Alt: Ship Designer (nur Frontend)
const prompt = generatePromptClientSide(faction, customization);
// → Send to Frontend TRELLIS2

// Neu: Enhanced Designer (Backend + Frontend)
const baseAssets = getBaseAssetsFromDB(faction);
// → Show in Designer
// → Player customizes
const refined = queueTRELLIS2Refinement(customization);
// → Backend generiert finales Schiff
```

---

## 📚 Referenzen

- [FACTION_RELATIONS.yaml](../../FACTION_RELATIONS.yaml) – Spezies-Vorgaben
- [TRELLIS2 Docker Setup](../../docker-compose.yml)
- [3D Asset Pipeline](../../docs/technical/3D_ASSET_PIPELINE.md)
- [Original Ship Designer](../../docs/technical/SHIP_DESIGNER_PROMPT_ENGINE.md)
