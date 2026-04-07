# ThemisDB Migration Roadmap

**Scope**: GalaxyQuest → ThemisDB (v1.8.0+)  
**Status**: Phase 0 – Infrastructure & Proof of Concept  
**Last updated**: 2026-04-07

---

## Ausgangssituation

### GalaxyQuest (aktueller Stack)

| Komponente | Technologie | Dateien |
|---|---|---|
| Datenbank | MySQL 8 InnoDB, PDO/PHP | `config/db.php`, `sql/schema.sql` (35 Tabellen), 44 Migrationsskripte |
| LLM-Inferenz | Ollama HTTP-REST (llama3.1:8b) | `api/ollama_client.php` |
| LLM-Architektur | PromptCatalogRepository, LlmPromptService, LlmRequestLogRepository, IronFleetPromptVarsComposer | `api/llm_soc/` |
| Prompt-Templates | MySQL-Tabelle (`llm_prompt_profiles`) + JSON (`config/llm_profiles.json`) | `sql/migrate_llm_soc_v1.sql` |
| NPC-Chats | MySQL (`npc_chat_sessions`) + JSON-Dateien auf Disk | `generated/npc_chats/u_{uid}/…/session_{id}.json` |
| Image-Generation | SwarmUI (Stable Diffusion) | `api/swarmui_client.php` |
| TTS | FastAPI + Piper/XTTS | `tts_service/`, `api/tts_client.php` |
| Vector / Graph | **nicht vorhanden** | – |

### ThemisDB (Zielsystem, v1.8.0+)

| Fähigkeit | Details |
|---|---|
| Multi-Model | Relational (AQL), Property Graph, Vector (HNSW), Document |
| Native LLM | llama.cpp embedded, INFER/RAG/EMBED, LoRA, FLARE adaptive retrieval |
| Protokolle | HTTP/2, gRPC, PostgreSQL Wire, GraphQL, WebSocket, MQTT |
| Performance | 45K writes/s, 120K reads/s, SIMD-optimiert, GPU optional |
| Sicherheit | TLS 1.3, RBAC, field-level encryption (AES-256-GCM), MVCC, ACID |
| Observability | Prometheus, OpenTelemetry, QueryProfiler, Alerting |

---

## Phasenübersicht

```
Phase 0 ──► Phase 1 (Relational) ──► Phase 2 (LLM) ──► Phase 3 (Graph)
                                                              │
                                                              ▼
                                                        Phase 4 (Vector/RAG)
                                                              │
                                                              ▼
                                                        Phase 5 (Training) [optional]

Phase 6 (Security/Prod) ─────────────────────────── parallel ab Phase 1
```

---

## Phase 0 – Infrastruktur & Proof of Concept

**Ziel**: Parallelbetrieb MySQL + ThemisDB, Risikobewertung  
**Aufwand**: 2–3 Wochen

### Deliverables (implementiert)

| Datei | Beschreibung |
|---|---|
| `docker-compose.yml` | ThemisDB COMMUNITY Service (opt-in via `--profile themisdb`) |
| `config/config.php` | `THEMISDB_*` Konstanten (ENABLED, BASE_URL, TIMEOUT, DUAL_WRITE, API_TOKEN) |
| `lib/ThemisDbClient.php` | PHP HTTP-Abstraktionsschicht für ThemisDB REST/AQL API |
| `tools/mysql_to_themis_export.php` | Bulk-Export aller MySQL-Tabellen als JSONL für ThemisDB-Import |
| `docs/technical/THEMISDB_MIGRATION_ROADMAP.md` | Dieses Dokument |

### Docker-Setup (Phase 0)

```bash
# ThemisDB neben MySQL starten (opt-in profile)
docker compose --profile themisdb up -d

# Health-Check
curl http://localhost:8090/health

# Dual-write aktivieren (in .env oder docker-compose.yml)
THEMISDB_ENABLED=1
THEMISDB_DUAL_WRITE=1
THEMISDB_BASE_URL=http://themisdb:8080
```

### Smoke-Tests

```bash
# 1. users-Insert via ThemisDB
curl -X POST http://localhost:8090/api/collections/users/documents \
  -H 'Content-Type: application/json' \
  -d '{"_key":"smoke_1","username":"smoke_user","email":"smoke@test.invalid"}'

# 2. colonies-Read via AQL
curl -X POST http://localhost:8090/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"FOR c IN colonies FILTER c.user_id == @uid RETURN c","bind_vars":{"uid":1}}'

# 3. fleets-Update via AQL
curl -X POST http://localhost:8090/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"FOR f IN fleets FILTER f._key == @k UPDATE f WITH {updated:true} IN fleets","bind_vars":{"k":"1"}}'
```

### Export-Tool

```bash
# Alle Tabellen nach /tmp/themis_export exportieren
php tools/mysql_to_themis_export.php --output-dir=/tmp/themis_export

# Bestimmte Tabellen
php tools/mysql_to_themis_export.php --tables=users,colonies,fleets

# Export + direkt in ThemisDB importieren
php tools/mysql_to_themis_export.php --push --push-url=http://localhost:8090

# Dry-run (keine Dateien schreiben)
php tools/mysql_to_themis_export.php --dry-run

# Export + Push + Validierung (Row-Count-Vergleich)
php tools/mysql_to_themis_export.php --push --validate
```

### PHP-Client-Verwendung

```php
// In jedem API-Endpunkt nutzbar:
require_once __DIR__ . '/../lib/ThemisDbClient.php';

$themis = ThemisDbClient::instance();

// Gesundheitsprüfung
if ($themis->isHealthy()) { /* ... */ }

// AQL-Query
$result = $themis->queryAql(
    'FOR u IN users FILTER u.id == @id RETURN u',
    ['id' => $userId]
);
if ($result['ok']) {
    $rows = $result['data']['result'];
}

// Dual-Write (fire-and-forget, MySQL bleibt primär)
$themis->dualWriteDocument('colonies', $colonyData, 'colony_create');
```

### Entscheidungspunkt: PostgreSQL Wire vs. AQL Native

| Kriterium | PostgreSQL Wire | AQL Native |
|---|---|---|
| PHP-Migrationsaufwand | Minimal (PDO Drop-in) | Hoch (~150 Queries umschreiben) |
| Multi-Model-Nutzung | Nur relational | Voll: Graph, Vector, LLM |
| Performance | ~80% von AQL | 100% |
| Empfehlung für Phase | Phase 1 (Übergang) | Phase 2–5 |

---

## Phase 1 – Relationale Datenmigration

**Ziel**: MySQL vollständig durch ThemisDB ersetzen (relationale Parität)  
**Aufwand**: 4–6 Wochen

### 1.1 Schema-Mapping (MySQL → AQL Collections)

Alle 35 Kerntabellen + ~45 Migrationstabellen werden als AQL-Collections modelliert:

| MySQL-Tabelle | ThemisDB-Typ | Besonderheit |
|---|---|---|
| `users` | Collection | RBAC statt `is_admin`-Flag (Phase 6) |
| `star_systems` | Collection → Graph Node (Phase 3) | `x_ly/y_ly/z_ly` → Geo-Index (3D) |
| `planets` | Collection → Graph Node | `species_affinity_json` → embedded doc |
| `fleets` | Collection | Orbital-Koordinaten + Temporal |
| `diplomacy` | Collection → Graph Edge (Phase 3) | Übergangsweise Collection |
| `alliance_relations` | Collection → Graph Edge (Phase 3) | Übergangsweise Collection |
| `npc_chat_sessions` | Document Collection | JSON bereits strukturiert |
| `battle_reports` | Document Collection | JSON-Payload direkt |
| `user_character_profiles` | Document Collection | `profile_json`, `vita` |
| `llm_prompt_profiles` | Document Collection | `input_schema_json` |

### 1.2 Migrations-Tooling

```bash
# 1. JSONL-Export aller Tabellen
php tools/mysql_to_themis_export.php --output-dir=/tmp/gq_export --batch-size=5000

# 2. Push nach ThemisDB
php tools/mysql_to_themis_export.php --push --push-url=http://themisdb:8080

# 3. Validierung (Row-Count-Checksummen)
php tools/mysql_to_themis_export.php --push --validate
```

### 1.3 PHP-Layer Update

`api/helpers.php` → `get_db()` bleibt zunächst unverändert (MySQL-primär).  
Neue Wrapper-Funktion `get_themis()` nutzt `ThemisDbClient::instance()`:

```php
function get_themis(): ThemisDbClient {
    static $client = null;
    if ($client === null) {
        require_once __DIR__ . '/../lib/ThemisDbClient.php';
        $client = ThemisDbClient::instance();
    }
    return $client;
}
```

**Migration-Reihenfolge** (nach Kritikalität):
1. `api/auth.php` – Login, Session, Register
2. `api/fleet.php` – Fleet-Launch (Multi-Statement-Transaktion)
3. `api/economy_flush.php` – Ressourcen-Tick
4. `api/game.php` – Allgemeine Spielaktionen
5. Alle anderen Endpunkte

### 1.4 Transaktions-Parität

Multi-Statement-Transaktionen werden als ThemisDB SAGA-Transaktionen modelliert:

```aql
-- Beispiel: Fleet-Launch (Colony-Ressourcen abziehen + Fleet erstellen)
BEGIN TRANSACTION
  UPDATE colonies SET metal = metal - @cost WHERE id = @colony_id;
  INSERT INTO fleets VALUES (@fleet_data);
COMMIT
```

MVCC-Testszenarien:
- Gleichzeitige Flotten-Aktionen zweier Spieler auf dieselbe Kolonie
- NPC-Tick vs. User-Request (Colony-Ressourcen)
- Fleet-Arrive + Battle-Initiation (Race Condition)

---

## Phase 2 – LLM-Inferencing Migration

**Ziel**: Ollama durch ThemisDB-native LLM ersetzen  
**Aufwand**: 3–4 Wochen

### 2.1 Modell-Integration

```aql
-- Basismodell laden
LLM MODEL LOAD 'models/llama3.1-8b-instruct.gguf'
  ALIAS 'gq-main'
  GPU_LAYERS 32

-- Fraktions-LoRA-Adapter laden (6 Fraktionen)
LLM LORA LOAD 'adapters/vor_tak.safetensors'   ALIAS 'vor_tak'   BASE_MODEL 'gq-main'
LLM LORA LOAD 'adapters/aereth.safetensors'    ALIAS 'aereth'    BASE_MODEL 'gq-main'
LLM LORA LOAD 'adapters/syl_nar.safetensors'   ALIAS 'syl_nar'   BASE_MODEL 'gq-main'
LLM LORA LOAD 'adapters/vel_ar.safetensors'    ALIAS 'vel_ar'    BASE_MODEL 'gq-main'
LLM LORA LOAD 'adapters/zhareen.safetensors'   ALIAS 'zhareen'   BASE_MODEL 'gq-main'
LLM LORA LOAD 'adapters/kryl_tha.safetensors'  ALIAS 'kryl_tha'  BASE_MODEL 'gq-main'
```

**PHP-Adapter**: `api/ollama_client.php` → neues `themis_llm_chat()` via `ThemisDbClient::llmInfer()`:

```php
function themis_llm_chat(array $messages, array $options = []): array {
    $client = ThemisDbClient::instance();
    $prompt = format_messages_as_prompt($messages); // bestehende Logik
    return $client->llmInfer($prompt, [
        'model'       => $options['model']       ?? 'gq-main',
        'lora'        => $options['lora']        ?? null,
        'temperature' => $options['temperature'] ?? 0.7,
        'max_tokens'  => $options['max_tokens']  ?? 512,
    ]);
}
```

### 2.2 Prompt-Template-Migration

`PromptCatalogRepository` → ThemisDB `PromptManager`:

```bash
# config/llm_profiles.json → ThemisDB PromptManager (YAML bulk-load)
curl -X POST http://localhost:8090/api/prompt-manager/import \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/llm_profiles_export.json
```

Aktivierte Features:
- Git-ähnliche Versionierung: Branches `prod/dev/experimental`
- A/B-Testing mit Welch's t-Test (NPC-Dialog-Qualität)
- `SelfImprovementOrchestrator`: automatische Prompt-Optimierung im Hintergrund

### 2.3 NPC-Chat-System

`NpcChatSessionRepository` + JSON-Dateien → ThemisDB Document Collection:

```aql
-- Session anlegen
INSERT INTO npc_chat_sessions VALUES @session_doc

-- Summary generieren (bei close_npc_session)
LET summary = (LLM INFER @summary_prompt MODEL 'gq-main' LORA @faction_lora MAX_TOKENS 256)
UPDATE { _key: @session_key } WITH { summary: summary } IN npc_chat_sessions
```

Aktuell: `generated/npc_chats/u_{uid}/{faction_code}/{npc_slug}/session_{id}.json`  
→ Ziel: ThemisDB `npc_chat_sessions` Collection mit field-level encryption auf `messages_json`

### 2.4 IronFleet-Prompt-Composer

`IronFleetPromptVarsComposer` (6 Mini-Fraktionen: parade, pr, tech, clan, archive, shadow) bleibt als PHP-Variable-Builder erhalten. Nur der Inferenz-Aufruf wechselt:

```php
// Vorher:
$llm = ollama_chat($messages, $options);

// Nachher:
$llm = $themis->llmInfer($prompt, ['model' => 'gq-main', 'lora' => $divisionCode]);
```

`PromptInjectionDetector` (10+ built-in Patterns) für alle NPC-Chat-Eingaben aktivieren.

---

## Phase 3 – Graph-Modell: Fraktions- & Diplomatienetz

**Ziel**: Relational gespeicherte Beziehungsstrukturen als Property Graph  
**Aufwand**: 4–5 Wochen

### 3.1 Fraktions-Graph

**Vertices**:
- `npc_factions` → `FactionVertex` (code, name, faction_type, aggression, power_level)
- `users` → `PlayerVertex` (id, username, ftl_drive_type)
- `leaders` → `LeaderVertex` (faction_code, role, skill_*)

**Edges**:
- `diplomacy` (user↔faction) → `STANDING_EDGE` (standing, attacks_against)
- `alliance_members` → `MEMBER_OF_EDGE`
- `alliance_relations` → `ALLIED_WITH_EDGE` / `AT_WAR_WITH_EDGE` (status, score)
- `FACTION_RELATIONS.yaml` Matrix → `FACTION_TO_FACTION_EDGE` (standing)

**AQL-Queries**:

```aql
-- Kürzester Diplomatie-Pfad zwischen zwei Fraktionen
FOR v, e, p IN 1..5 OUTBOUND 'factions/empire' GRAPH 'diplomacy_net'
  FILTER e.standing > 0
  RETURN { path: p, weight: e.standing }

-- Konflikt-Vorhersage: feindliche Nachbarn
FOR faction IN factions
  FOR enemy, rel IN 1..1 OUTBOUND faction GRAPH 'diplomacy_net'
    FILTER rel.standing < -50
    RETURN { attacker: faction.code, target: enemy.code }

-- Handelsrouten mit Fraktions-Constraint
FOR route IN 1..3 OUTBOUND @origin_colony GRAPH 'trade_net'
  FILTER route.faction_standing >= @min_standing
  SORT route.profit DESC
  LIMIT 5
  RETURN route
```

### 3.2 Wormhole & FTL-Netz als Graph

- `star_systems` → `StarSystemVertex` (x_ly, y_ly, z_ly als Geo-Properties)
- `wormholes` → `WORMHOLE_EDGE` (bidirektional, stability, type, cooldown_until)
- `ftl_gates` → `FTL_GATE_EDGE` (faction_owner, activation_cost)

Kürzeste FTL-Route via ThemisDB A*-Traversal:

```aql
LET route = (
  FOR v, e IN 1..20 OUTBOUND @origin GRAPH 'ftl_net'
    OPTIONS { algorithm: 'astar', heuristic: 'euclidean_3d' }
    FILTER v._key == @destination
    RETURN { system: v, hop: e }
)
RETURN route
```

### 3.3 Trade-Route-Netz

```aql
FOR colony IN colonies
  FOR target, route IN 1..2 OUTBOUND colony GRAPH 'trade_net'
    FILTER route.active == true
    FILTER target.faction_standing >= @player_standing
    SORT route.profit DESC
    RETURN { from: colony.name, to: target.name, profit: route.profit }
```

### 3.4 PHP-Integration

```php
// api/faction_relations.php – get_faction_to_faction_standing()
$result = $themis->queryAql(
    'FOR e IN faction_to_faction_edges
       FILTER e._from == @fa AND e._to == @fb
       RETURN e.standing',
    ['fa' => "factions/{$factionA}", 'fb' => "factions/{$factionB}"]
);

// api/faction_relations.php – predict_conflicts()
$result = $themis->queryAql(
    'FOR f IN factions
       FOR enemy, rel IN 1..1 OUTBOUND f GRAPH "diplomacy_net"
         FILTER rel.standing < @threshold
         RETURN { attacker: f.code, target: enemy.code }',
    ['threshold' => -50]
);
```

---

## Phase 4 – Vector-Embeddings & RAG-Pipeline

**Ziel**: Semantische Suche, NPC-Langzeitgedächtnis, Lore-RAG  
**Aufwand**: 5–6 Wochen

### 4.1 Embedding-Collections

| Quelle | Collection | Embedding-Feld | Verwendung |
|---|---|---|---|
| `user_character_profiles.vita` | `character_embeddings` | `vita_vec` | Semantische NPC-Ähnlichkeit |
| `faction_quests.description` | `quest_embeddings` | `desc_vec` | Quest-Empfehlungen |
| `npc_chat_sessions.summary` | `chat_memory_embeddings` | `summary_vec` | NPC-Langzeitgedächtnis |
| `battle_reports` | `battle_embeddings` | `narrative_vec` | Taktik-RAG |
| Faction-Lore YAML-Specs | `lore_embeddings` | `lore_vec` | Kontextuelles NPC-Antworten |
| `leaders.vita` | `leader_embeddings` | `vita_vec` | Leader-Persönlichkeitsmatch |

### 4.2 Embedding-Generierung

```aql
-- Batch-Embedding aller Charakter-Profile (Einmal-Job)
FOR profile IN user_character_profiles
  LET vec = (LLM EMBED profile.vita MODEL 'all-minilm-l6-v2' RETURN AS ARRAY)
  UPDATE profile WITH { vita_vec: vec } IN user_character_profiles

-- Faction-Lore aus YAML-Specs einbetten
FOR lore IN raw_lore_docs
  LET vec = (LLM EMBED lore.text MODEL 'all-minilm-l6-v2' RETURN AS ARRAY)
  INSERT { _key: lore._key, faction_code: lore.faction, lore_vec: vec, text: lore.text }
  INTO lore_embeddings
```

PHP-Wrapper via `ThemisDbClient::llmEmbed()`:

```php
$embedding = $themis->llmEmbed($characterProfile['vita']);
// $embedding['data']['vector'] → float[]
```

### 4.3 NPC-Langzeitgedächtnis via RAG

```aql
-- Beim NPC-Chat: relevante Session-Summaries abrufen
FOR mem IN chat_memory_embeddings
  LET score = SIMILARITY(mem.summary_vec, @current_context_vec)
  FILTER score > 0.72
  FILTER mem.user_id == @uid AND mem.npc_slug == @slug
  SORT score DESC
  LIMIT 5
  RETURN mem.summary
```

Abgerufene Summaries werden als Kontext in den NPC-Prompt eingebettet.

### 4.4 Fraktions-Lore RAG

```aql
LLM RAG @user_message
  SEARCH IN lore_embeddings
  FILTER lore_embeddings.faction_code == @faction
  TOP 8
  MODEL 'gq-main'
  LORA @faction_lora
  TEMPERATURE 0.7
```

PHP-Wrapper:

```php
$answer = $themis->llmRag($userMessage, 'lore_embeddings', [
    'lora'   => $factionCode,
    'filter' => ['faction_code' => $factionCode],
    'top_k'  => 8,
]);
```

### 4.5 Semantische Quest-Empfehlungen

```aql
FOR quest IN quest_embeddings
  LET score = SIMILARITY(quest.desc_vec, @player_profile_vec)
  FILTER quest.faction_id IN @player_faction_ids
  FILTER quest.min_standing <= @standing
  SORT score DESC
  LIMIT 10
  RETURN { quest, score }
```

### 4.6 RAG-Judge Integration

- `RagJudge` (faithfulness/relevance/completeness) für NPC-Antwort-QA
- `BiasDetector` für faire Darstellung aller 6 Hauptfraktionen
- `KnowledgeGapDetector` → fehlende Lore automatisch flaggen

---

## Phase 5 – Training & Domänen-LoRA (optional/iterativ)

**Ziel**: GalaxyQuest-spezifische LLM-Fine-Tuning-Pipeline  
**Aufwand**: 6–8 Wochen

### 5.1 Trainings-Datensatz

- `KnowledgeGraphEnricher`: Fraktions-Graph + Lore-Embeddings anreichern
- NPC-Chat-Logs (JSON) → `IncrementalLoRATrainer`: Chat → (instruction, response) Pairs
- YAML-Specs (fractions/*/spec.yaml) → strukturierte Labels via `LegalAutoLabeler`-Muster

### 5.2 Pro-Fraktion LoRA

- Ein LoRA-Adapter pro Hauptfraktion (aereth, vor_tak, syl_nar, vel_ar, zhareen, kryl_tha)
- Checkpoint/Resume via `IncrementalLoRATrainer`
- Confidence-Gating: `< 0.55` → manuelle Review (Äquivalent zu `NPC_LLM_CONTROLLER_MIN_CONFIDENCE`)
- Adapter-Version-Management: deploy/rollback/traffic-splitting (80/20)

### 5.3 IronFleet Mini-Fraktion LoRA

- 6 sub-LoRA-Adapter (parade, pr, tech, clan, archive, shadow)
- Traffic-Splitting: 80% stabile Version / 20% neue Adapter-Version für A/B

---

## Phase 6 – Sicherheit, Observability & Produktion

**Ziel**: Enterprise-Readiness, GDPR-Compliance  
**Aufwand**: 3–4 Wochen (parallel ab Phase 1)

### 6.1 Sicherheits-Migration

| MySQL/PHP | ThemisDB |
|---|---|
| `is_admin`-Flag in `users` | `RbacManager` mit Rollen: player/moderator/admin |
| PHP-Session-Auth | `JWTValidator` als Auth-Backend (Session-Upgrade) |
| `migrate_security_v2_totp.sql` | ThemisDB MFA-Modul (TOTP) |
| Plaintext `email` in DB | `FieldEncryption` (AES-256-GCM) |
| `error_log()` / perf_telemetry | ThemisDB Audit-Trail (SOC2-kompatibel) |
| Keine LLM-Eingaben-Prüfung | `PromptInjectionDetector` auf allen NPC-Chat-Eingaben |

### 6.2 Observability

- ThemisDB Prometheus-Endpoint `:4318/metrics` → Grafana-Dashboard
- OpenTelemetry für Distributed Tracing: PHP → ThemisDB LLM → Response
- `QueryProfiler` für AQL-Queries langsamer als `SLOW_QUERY_THRESHOLD_MS`
- Alerting: LLM-Latenz, Query-Fehlerrate, NPC-Tick-Failures, Speicherdruck

### 6.3 GDPR

- `PiiDetector` auf `vita`, `profile_json`, `messages_json` in Chat-Sessions
- `DataRetentionPolicies`: `battle_reports` (90 Tage), `spy_reports` (60 Tage), `npc_chat_sessions` (180 Tage)
- `ComplianceReporter` für DSGVO-Auskunft (`/api/auth.php?action=data_export`)

### 6.4 Zero-Downtime

- `HotReloadEngine`: Schema-Änderungen ohne Spielunterbrechung
- Atomisches Rollback bei fehlgeschlagenen Migrationen
- Raft-Consensus für Multi-Instanz (falls Multi-Node geplant)

---

## Risiken & Mitigationen

| Risiko | Auswirkung | Mitigation |
|---|---|---|
| AQL ≠ SQL: PHP-Queries komplex umzuschreiben | Hoch | PostgreSQL-Wire-Adapter als Übergangsbrücke Phase 1; schrittweise pro Endpunkt |
| ThemisDB noch kein stabiler Produktionsstand | Mittel-Hoch | Dual-Write bis Phase 3 stabil; MySQL als Fallback |
| LLM-Inferenz-Latenz (embedded vs. Ollama) | Mittel | Async Inference Engine + Priority Queue; Benchmark vor Phase 2-Commit |
| LoRA-Adapter-Format-Kompatibilität | Mittel | `.safetensors` via ThemisDB `LoraFramework` testen; ggf. Konvertierung via llama.cpp |
| Graph-Migration: zirkuläre Diplomatie-Referenzen | Niedrig | SAGA-Transaktionen für Graph-Writes; Konsistenzvalidierung nach Bulk-Import |
| Vector-Embedding-Kosten (CPU-Zeit) | Mittel | Batch-Processing (Nacht); GPU-Layer optional für Embedding-Generation |
| GDPR: NPC-Chat-JSON auf Disk | Mittel | Frühzeitig Phase 2: in ThemisDB encrypted Document Collection migrieren |

---

## Nutzen der Migration

| Bereich | Aktuell | Nach Migration |
|---|---|---|
| NPC-Dialog | Stateless, kein Gedächtnis | RAG-gestütztes Langzeitgedächtnis via HNSW |
| Fraktionsdiplomatie | PHP-Array-Lookups, YAML-Matrix | Graph-Traversal, Dijkstra-Routing |
| Quest-Empfehlungen | Keine | Vektor-Ähnlichkeitssuche (Spielerprofil ↔ Quest) |
| FTL-Routenplanung | Keine | A*/Dijkstra auf Wormhole-Graph |
| Prompt-Management | MySQL + PHP-Klassen | Versioniertes PromptManager-System |
| LLM-Qualitätssicherung | Keine | RAG-Judge, BiasDetector, InjectionDetector |
| Sicherheit | `is_admin`-Flag, PHP-Session | RBAC, JWT, Field-Encryption, Audit |
| Observability | `perf_telemetry.php` | Prometheus + OpenTelemetry |

---

## Datei-Referenzen

| Datei | Phase | Beschreibung |
|---|---|---|
| `docker-compose.yml` | 0 | ThemisDB Service (`--profile themisdb`) |
| `config/config.php` | 0 | `THEMISDB_*` Konstanten |
| `lib/ThemisDbClient.php` | 0 | PHP HTTP-Client (AQL, CRUD, LLM, Dual-Write) |
| `tools/mysql_to_themis_export.php` | 0/1 | MySQL → JSONL → ThemisDB Bulk-Export |
| `api/ollama_client.php` | 2 | Ziel: durch `ThemisDbClient::llmInfer()` ersetzen |
| `api/llm_soc/PromptCatalogRepository.php` | 2 | Ziel: ThemisDB PromptManager |
| `api/llm_soc/LlmRequestLogRepository.php` | 2 | Ziel: ThemisDB `LLM STATS` |
| `api/llm_soc/NpcChatSessionRepository.php` | 2 | Ziel: ThemisDB Document Collection |
| `api/faction_relations.php` | 3 | Ziel: AQL Graph-Traversal |
| `api/war.php`, `api/alliances.php` | 3 | Ziel: Graph-Writes (addEdge/updateEdge) |
| `sql/schema.sql` | 1 | Alle 35 Kerntabellen → AQL Collections |

---

*Dieses Dokument wird mit jeder abgeschlossenen Phase aktualisiert.*
