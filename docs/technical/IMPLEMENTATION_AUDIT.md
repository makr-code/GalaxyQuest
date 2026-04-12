# GalaxyQuest — Implementierungs-Audit

> **Stand:** 11. April 2026  
> **Basis:** Vollständige Analyse des Quellcodes, aller API-Endpunkte, SQL-Migrationen, Frontend-Module und Design-Dokumente  
> **Zweck:** Objektive Bestandsaufnahme — was ist fertig, was fehlt, welche technischen Schulden bestehen

---

## 1. Executive Summary

| Merkmal | Details |
|---|---|
| **Projekttyp** | Browser-basiertes Multiplayer-Weltraum-4X-Strategiespiel (MMO) |
| **Tech-Stack** | PHP 8 Backend · Vanilla JS/ES2020 Frontend · MySQL 8.4 · Docker |
| **Rendering** | WebGPU (primär) · WebGL2/Three.js (Fallback) · Post-Processing-Pipeline |
| **AI/LLM** | Ollama (lokal) für NPC-Steuerung, Glossar, Portraits, TTS |
| **Gesamtfortschritt** | **~60 %** des finalen Produkts |
| **Codebasis-Alter** | ~14 Tage (gestartet ca. 28.03.2026), sehr aktive Entwicklung |
| **Größe** | ~148 MB · 60+ API-Endpunkte · 50+ SQL-Migrationen · 20+ Fraktionen |
| **Architektur** | Kein Framework, kein Build-Step, server-autoritativ, tick-free |

GalaxyQuest besitzt ein solides Kern-Gameplay (Bauen, Forschen, Kämpfen, Handeln, Diplomatie) und eine bemerkenswert ausgereifte Engine für ein zwei Wochen altes Projekt. Die größten Lücken zum finalen Produkt liegen in der **Tiefe der Wirtschafts-Simulation**, dem **Diplomatie-Eskalationsmodell**, den **Endgame-Mechaniken** und dem **Tutorial/Onboarding**.

---

## 2. Fortschritts-Dashboard

```
GalaxyQuest — Implementierungsfortschritt (Stand 11.04.2026)
═══════════════════════════════════════════════════════════════════

Infrastruktur & DevOps         ████████████████████░░░░  ~85%  ✅ Produktionsreif
Auth & Security                ████████████████████████  ~95%  ✅ Produktionsreif
Galaxie-Generation & Kosmos    ████████████████████████  ~95%  ✅ Produktionsreif
3D-Engine (WebGPU/WebGL)       ██████████████████████░░  ~90%  ✅ Produktionsreif
Koloniesystem (Basis)          ████████████████████░░░░  ~85%  ✅ Funktional
Wirtschaft (Basis)             ██████████████████░░░░░░  ~75%  🟡 Funktional mit Lücken
Wirtschaft (Zielmodell)        ████████░░░░░░░░░░░░░░░░  ~35%  🔴 Erhebliche Lücken
Militär & Flotten              ████████████████████░░░░  ~80%  ✅ Funktional
Kriegssystem                   ████████████████░░░░░░░░  ~70%  🟡 Backend stark, Frontend unvollständig
Piraten-System                 ████████████████░░░░░░░░  ~65%  🟡 Backend funktional, Konsequenzmechanik fehlt
Diplomatie (Basis)             ████████████████░░░░░░░░  ~70%  🟡 Funktional mit Lücken
Diplomatie (Diplomatic Plays)  ██████████░░░░░░░░░░░░░░  ~40%  🔴 Erhebliche Lücken
LLM/AI-Integration             ████████████████████░░░░  ~80%  ✅ Funktional
NPC-System                     ████████████████████░░░░  ~80%  ✅ Funktional
Allianz-System                 ██████████████████████░░  ~90%  ✅ Produktionsreif
Content & Lore                 ██████████████████░░░░░░  ~75%  🟡 Gut, aber ausbaufähig
Kolonisierung (Sektoren etc.)  ████████████████████░░░░  ~85%  ✅ Kürzlich implementiert
Empire-Kategorien & Spionage   ████████████████████░░░░  ~80%  ✅ Kürzlich implementiert
Colony Buildings (Isometrisch) ██████████████████░░░░░░  ~75%  🟡 Backend+Frontend vorhanden
Multiplayer/Echtzeit           ████████████░░░░░░░░░░░░  ~50%  🟡 SSE vorhanden, WebSocket fehlt
Tutorial/Onboarding            ██░░░░░░░░░░░░░░░░░░░░░░  ~10%  🔴 Nur Design vorhanden
Situations-Framework           ███████░░░░░░░░░░░░░░░░░  ~30%  🔴 Nur partiell
Siegpfade                      ██░░░░░░░░░░░░░░░░░░░░░░  ~10%  🔴 Nur Design vorhanden
Endgame-Krisen                 █░░░░░░░░░░░░░░░░░░░░░░░   ~5%  🔴 Nur Konzept
ThemisDB-Migration             ████░░░░░░░░░░░░░░░░░░░░  ~15%  🔴 Nur Phase 0

═══════════════════════════════════════════════════════════════════
GESAMT (vs. finale Vision)                                  ~60%
```

**Legende:** ✅ Produktionsreif · 🟡 Funktional mit Lücken · 🔴 Erhebliche Lücken / Nur Design

---

## 3. Detailanalyse pro Bereich

### 3.1 Infrastruktur & DevOps (~85%)

**Fertig implementiert:**
- Docker Compose (`docker-compose.yml`): Web + DB + TTS + optionaler ThemisDB-Container
- Unified Setup-Script (`setup.php`): vollautomatisches Onboarding inkl. Schema-Migration
- 50+ versionierte SQL-Migrationen (`sql/migrate_*.sql`)
- JS-Minification/Gzip-Pipeline (PHP-basiert, `setup.php`)
- `.env.example` mit vollständiger Konfigurationsdokumentation
- Xdebug-Integration für lokale Entwicklung
- Performance-Telemetrie-Endpunkt (`api/perf_telemetry.php`)

**Fehlend:**
- ❌ CI/CD-Pipeline (keine GitHub Actions konfiguriert)
- ❌ Versioniertes Migrationssystem (derzeit manuelle SQL-Anwendung)
- ❌ Produktions-Deployment-Konfiguration (HTTPS, Secrets Management)
- ❌ Load-Testing-Setup (100+ gleichzeitige Spieler)

**Referenz:** `docker-compose.yml`, `setup.php`, `sql/migrate_*.sql`

---

### 3.2 Authentifizierung & Sicherheit (~95%)

**Fertig implementiert:**
- Register/Login/Logout mit CSRF-Schutz und Session-Management (`api/auth.php`)
- 2FA (TOTP) vollständig implementiert
- RBAC (Rollenbasierte Zugriffskontrolle) mit Admin-Interface
- Rate-Limiting / Account-Lockout nach `LOGIN_MAX_ATTEMPTS` Fehlversuchen (`sql/migrate_security_v1.sql`)
- Security-Headers: `Content-Security-Policy`, `X-Frame-Options`, etc. (`api/helpers.php`)
- Passwordloser Registrierungsprolog (5-stufig, `js/ui/prolog.js`, `api/auth.php`)
- Welpenschutz: Rang 1 + Account < 30 Tage → Kriegsgenehmigung verweigert

**Fehlend:**
- ❌ Produktionshärtung (TLS-Zertifikate, Secrets-Vault)

**Referenz:** `api/auth.php`, `sql/migrate_security_v1.sql`, `api/helpers.php`

---

### 3.3 Galaxie-Generation & Kosmos (~95%)

**Fertig implementiert:**
- Prozedurale Spiralgalaxie mit 25.000 Sternsystemen (deterministisch, `bootstrap_25k.php`)
- Wissenschaftliche Planetengenerierung: Kopparapu-Habitabilität, Kepler-Perioden, IMF-Sternmassen, Binärsterne
- Fog of War (pro Benutzer, `api/galaxy.php`)
- Wormhole-Netzwerk: stabile/instabile Wurmlöcher, Beacon-Unlocks (`api/fleet.php`)
- FTL-Antriebssystem: 6 fraktionsspezifische Drives (Vor'Tak KF-Jump, Syl'Nar Gate, Vel'Ar Blind-Jump, Zhareen Crystal, Aereth Alcubierre, Kryl'Tha Swarm-Tunnel)
- Resonanznodes und FTL-Gate-Infrastruktur (`api/fleet.php?action=ftl_map`)

**Fehlend:**
- ❌ Anomalien-System: kein `anomalies`-API-Endpunkt; nur Konzept im GAMEPLAY_DATA_MODEL.md

**Referenz:** `api/galaxy.php`, `api/fleet.php`, `docs/gamedesign/FTL_DRIVE_DESIGN.md`

---

### 3.4 3D-Engine (WebGPU/WebGL) (~90%)

**Fertig implementiert:**
- WebGPU-Renderer (`js/engine/`, WGSL-Shader, interaktive Star-Points)
- WebGL2-Fallback mit Three.js
- Post-Processing-Pipeline (alle 5 Phasen vollständig): Bloom, Vignette, Chromatic Aberration, SSAO, Film Grain, Color Grading, Star Scintillation, Disk Rotation Parallax, Jet Lighting, Tone Mapping, Lens Flare, Dust Layer, Motion Blur
- Combat FX: GPU-Partikel, Beam-Effects, Voxel-Debris (Phases 1–3)
- Window Manager (`js/engine/wm/`): drag/resize/minimize/persist
- 3D-Modell-System: 7+ Stationen/Schiffe, 13 Fraktions-Starter-Modelle
- SeamlessZoom-Orchestrator mit `SPATIAL_DEPTH` 0–4
- HybridPhysicsEngine + NPCPathfindingCompute (WebGPU-Compute-Shader)
- Hardware-in-Loop CI für WGSL-Shader-Validierung (14 Shader × `compilationInfo()`)

**Fehlend:**
- ❌ Isometrisches Colony-Building-Frontend vollständig mit der 3D-Engine verdrahtet
- ❌ WebSocket-Integration für Echtzeit-Multiplayer

**Referenz:** `js/engine/`, `docs/technical/webgpu_migration_roadmap.md`, `docs/technical/GALAXY_POSTPROCESS_ROADMAP.md`

---

### 3.5 Koloniesystem – Basis (~85%)

**Fertig implementiert:**
- Colony-Hierarchie: Galaxy → System → Planet → Colony → Buildings
- 22 Gebäudetypen in 8 Kategorien mit asynchroner Upgrade-Queue (`api/buildings.php`)
- Food / Population / Happiness / Public Services im Colony-Tick
- Energy Balance, Build-Queue, Colony-Phasen (`colonies.phase`)
- Sektoren, Gouverneure, Edikte (Empire Sprawl/AdminCap via `lib/ColonizationEngine.php`)
- 14 Kolonisierungs-API-Endpunkte (`api/colonization.php`)
- Isometrisches Colony-Building-Backend (`api/colony_buildings.php`, `sql/migrate_colony_buildings_v1.sql`)
- Frontend: `RuntimeColonizationController.js`, `RuntimeSocialControllersBootstrap.js`

**Fehlend:**
- ❌ Pop-Satisfaction-Mechanik vollständig an Güterverbrauch gekoppelt (Tabelle existiert, Logik fehlt)
- ❌ Population Migration/Resettlement zwischen Kolonien
- ❌ Isometrisches 3D-Frontend für Colony-Buildings vollständig verdrahtet

**Referenz:** `api/colonization.php`, `lib/ColonizationEngine.php`, `docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md`

---

### 3.6 Wirtschaft – Basis (~75%)

**Fertig implementiert:**
- Advanced Economy: T2–T5 Güter (18 Typen), Pop-Klassen, Galactic Market (`api/economy.php`, `api/market.php`)
- Trade Routes: permanente Inter-Colony-Routen mit Auto-Dispatch (`api/trade.php`)
- Player-to-Player-Handelsvorschläge (`api/trade.php?action=propose/accept/reject`)
- Economy-Policies: Steuern, Subventionen, Produktionsmethoden-Wechsel
- Rare-Earth-Deposits (endlich, klassabhängige Reichhaltigkeit)
- Economy-Flush-System (regelmäßiges Market-Rebalancing)
- Market Events mit Preismodifikatoren
- Händler-System (NPC-Trader, `docs/technical/TRADERS_README.md`)

**Fehlend:**
- ❌ Tier-2 Güter-Produktionsrezepte nicht vollständig verdrahtet
- ❌ Tier-3 Güter (Luxus, Militär, Forschung) nicht vollständig implementiert
- ❌ Pop-Class-Satisfaction an Güterverbrauch nicht gekoppelt
- ❌ Shortage/Starvation-Events nicht implementiert

**Referenz:** `api/economy.php`, `api/market.php`, `api/trade.php`, `docs/technical/IMPLEMENTATION_STATUS_SUMMARY.md`

---

### 3.7 Wirtschaft – Zielmodell GAMEPLAY_DATA_MODEL (~35%)

**Fehlend (nach GAMEPLAY_DATA_MODEL.md):**
- ❌ Mehrstufige Produktionsketten (Anno-Muster): Rohstoff → Zwischenprodukt → Endprodukt
- ❌ Colony Goods Flow (`colony_goods_flow`-Tabelle live berechnen)
- ❌ MarketRegion + MarketQuotes: Regionale Preisbildung mit α-Formel
- ❌ Logistics Routes: automatische + manuelle Inter-Colony-Lieferungen
- ❌ Population Strata vollständig: Workers/Specialists/Elites mit Loyalty/Radicalization
- ❌ Colony Needs: Bedarfserfüllung tracken, Shortage-Counter
- ❌ Economy-Telemetrie-Snapshots für Makro-Dashboard
- ❌ Policy-Enforcement: War-Economy-Policy, Autarkie, Merkantilismus vollständig durchgesetzt

**Referenz:** `docs/gamedesign/GAMEPLAY_DATA_MODEL.md`, `docs/gamedesign/ECONOMY_DESIGN.md`, `docs/technical/GAP_TODO.md` B-2

---

### 3.8 Militär & Flotten (~80%)

**Fertig implementiert:**
- 16+ Schiffstypen mit Blueprint/Modul-System (`docs/gamedesign/VESSEL_MODULE_BLUEPRINT_DESIGN.md`)
- Fleet Dispatch: Attack, Transport, Colonize, Spy, Harvest (`api/fleet.php`)
- 3D Newton'sche Flottenbewegung (x/y/z LY-Koordinaten, Echtzeit)
- Combat mit Tech/Commander-Boni, Shield-Penetration, Casualties
- Kampf-Strategie und Battle-Simulator (`docs/github-issues/07`)
- Pirate Raids auf ungeschützte Kolonien (via `api/npc_ai.php`)
- Hospital Ship / Science Vessel passive Boni

**Fehlend:**
- ❌ Fleet Supply & Readiness (aus GAMEPLAY_DATA_MODEL.md): Supply Range, Maintenance Drain
- ❌ Fleet Damage Carryover zwischen Schlachten
- ❌ Megastructures (sehr spätes Spiel)

**Referenz:** `api/fleet.php`, `api/game_engine.php`, `docs/gamedesign/VESSEL_MODULE_BLUEPRINT_DESIGN.md`

---

### 3.9 Kriegssystem (~70%)

**Fertig implementiert:**
- War Declaration, List, Status, Peace Offer/Respond (`api/war.php`)
- War Score Tracking, Exhaustion System, Forced-Peace-Logik
- War Goals (annex_system, reparations, humiliation, etc.)
- Peace Offer Expiration + Auto-Cleanup
- Territory Control Detection
- Multi-Goal-Declaration-Dialog (5 Ziele mit Casus-Belli-Eingabe)
- Peace-Terms-Checkboxen + Counter-Offer-UI (`js/engine/runtime/RuntimeWarController.js`)

**Fehlend (GAP_TODO B-1):**
- ❌ War-Intelligence-Panel (feindliche Flottenanzahl, Ressourcen-Scan)
- ❌ Allianz-Kriege: N-vs-M Szenarien (Backend-Stub vorhanden)
- ❌ War-Goal-Score sichtbar im Frontend
- ❌ War-Attrition an aktiven Combat gekoppelt
- ❌ Supply-Line-Disruption
- ❌ War Exhaustion → Status-Quo-Erzwingung vollständig

**Referenz:** `api/war.php`, `docs/gamedesign/COMBAT_SYSTEM_DESIGN.md`, `docs/technical/GAP_TODO.md` B-1

---

### 3.10 Piraten-System (~65%)

**Fertig implementiert:**
- Pirate-Fraktionen in `npc_factions` (faction_type = "pirate")
- Diplomacy-Standing (Decay-System)
- Raid-Konsequenzen: Metal, Crystal, Deuterium abziehen (`maybe_pirate_raid()`)
- Countermeasures-Effektivität berücksichtigt (`raid_countermeasures + colony_defense_infrastructure`)
- Historisches Raid-Archiv in `pirate_raid_history`
- `GREATEST(0, col - steal)` verhindert negative Ressourcenwerte
- Frontend: `RuntimePiratesController.js` (Threat-Intelligence-Panel, Recent Raids)

**Fehlend (GAP_TODO B-3):**
- ❌ Pirate-Kontrakte/Verhandlungen: Tributbeziehungen, Handel
- ❌ Standing-Decay-Sichtbarkeit im Frontend
- ❌ Historisches Raid-Archiv > 24h mit Paginierung
- ❌ Konsequenz-Mechanik vollständig (Raid-Eskalation)

**Referenz:** `api/pirates.php`, `api/npc_ai.php`, `docs/technical/IMPLEMENTATION_STATUS_SUMMARY.md`

---

### 3.11 Diplomatie – Basis (~70%)

**Fertig implementiert:**
- Diplomacy Standing (−100 bis +100) pro Fraktion
- Faction Trade Offers (AI-generiert, zeitbegrenzt)
- Faction Quests (8 geseedet, 5 Schwierigkeitsstufen)
- Alliance-System: Membership, Rollen (leader/diplomat/officer/member), Treasury
- Alliance-Diplomatie: War, NAP, Alliance Relations zwischen Allianzen
- Alliance Chat + Shared Intel
- Politics-Modell: Species, Government Forms, Civics, Colony-Effekte

**Fehlend:**
- ❌ Trust/Threat als getrennte Diplomatie-Achsen (derzeit nur `standing`)
- ❌ Diplomatische Plays: 4-Phasen-System (Proposal → Counter → Mobilization → Resolution)
- ❌ NPC-Diplomatiereaktionen bei Kriegserklärungen

**Referenz:** `api/alliances.php`, `api/factions.php`, `docs/technical/GAP_TODO.md`

---

### 3.12 Diplomatie – Zielmodell: Diplomatic Plays (~40%)

**Fehlend (nach GAMEPLAY_DATA_MODEL.md):**
- ❌ 4-Phasen-Eskalationsmodell für diplomatische Konflikte
- ❌ Trust-Achse: langfristiges Vertrauen aus Abkommen-Einhaltung
- ❌ Threat-Achse: militärische Bedrohungswahrnehmung
- ❌ Internal Factions: Approval + Support-gewichteter Stabilitätsdruck
- ❌ Colony Modifiers: dynamische Modifier mit Ablaufdatum

**Referenz:** `docs/gamedesign/GAMEPLAY_DATA_MODEL.md`

---

### 3.13 LLM/AI-Integration (~80%)

**Fertig implementiert:**
- Ollama-Gateway: Chat, Generate, Status (`api/llm.php`)
- SoC Prompt-Profile (YAML/JSON, `api/llm_soc/`): Catalog, Compose, ChatProfile
- NPC/PvE LLM-Controller mit deterministischem Fallback (`api/npc_ai.php`)
- NPC Chat Sessions (`api/llm_soc/NpcChatSessionRepository.php`)
- Iron Fleet Mini-Fraktionen: 6 YAML-Specs + `IronFleetPromptVarsComposer`
- Wikipedia RAG für Glossar
- NPC-Portrait-Generierung (SwarmUI)
- TTS-Service (Piper, Deutsch, `tts_service/`)

**Fehlend:**
- ❌ Vollständige RAG-Pipeline für NPC-Dialog-Embedding (ThemisDB Phase 4)
- ❌ Vector-Similarity-Search für kontextuelle NPC-Antworten

**Referenz:** `api/llm.php`, `api/llm_soc/`, `docs/technical/TTS_SYSTEM_DESIGN.md`

---

### 3.14 NPC-System (~80%)

**Fertig implementiert:**
- 6 Hauptfraktionen (Vor'Tak, Syl'Nar, Aereth, Kryl'Tha, Zhareen, Vel'Ar)
- 14+ Nebenfraktionen inkl. Iron Fleet mit 6 Mini-Fraktionen, Aethernox, Omniscienta, etc.
- NPC-Player-Accounts (Bots) mit kolonie-typ-bewussten Strategien
- Dynamic Faction Events (Galactic War, Trade Boom, Pirate Surge)
- Planetary Events & Colony Events (Solar Flare, Disease, Archaeological Find)
- Fleet Commander Active Decisions (Defensive Recall, Auto-Intercept, Auto-Scout)
- 1 World-Scenario (Iron Fleet Global Council)

**Fehlend:**
- ❌ Weitere World-Scenarios (über Iron Fleet hinaus)
- ❌ Faction Introduction Flow (nur Design: `FACTION_INTRODUCTION.md`)

**Referenz:** `api/npc_ai.php`, `fractions/`, `docs/gamedesign/FACTION_INTRODUCTION.md`

---

### 3.15 Allianz-System (~90%)

**Fertig implementiert:**
- `alliances`, `alliance_members`, `alliance_relations`, `alliance_messages` Tabellen
- Vollständiger Membership-Lifecycle: create, join, leave, disband, remove_member, set_role
- Alliance Treasury: Einzahlung/Auszahlung
- Alliance-Diplomatie: War, NAP, Alliance Relations, Revoke
- Alliance Chat + Shared Intel (Spy-Reports aller Mitglieder)
- War Map für Allianzen
- Leaderboard mit `[TAG]`-Badge

**Fehlend:**
- ❌ Alliance Wars (N-vs-M Szenarien im Kriegssystem)
- ❌ Alliance-Megastructures (sehr spät)

**Referenz:** `api/alliances.php`, `js/engine/runtime/AlliancesController.js`

---

### 3.16 Content & Lore (~75%)

**Fertig implementiert:**
- 6 Hauptfraktionen mit vollständiger Spezifikation (Biology, Portraiture, LLM-Voice, Quotes)
- 14+ Nebenfraktionen (12 Lore-Dateien in `docs/lore/side_factions/`)
- Detaillierte FTL-Drive-Designs pro Fraktion
- Fraktions-3D-Designsprache und Generation Examples

**Fehlend:**
- ❌ Weitere World-Scenarios
- ❌ Faction Introduction Flow als spielbares Tutorial-Erlebnis

**Referenz:** `fractions/`, `docs/lore/`, `docs/gamedesign/FACTION_INTRODUCTION.md`

---

### 3.17 Kolonisierung – COLONIZATION_SYSTEM_DESIGN (~85%)

**Fertig implementiert (GAP_TODO A-1 ✅):**
- `sql/migrate_colonization_v1.sql`: `sectors`, `sector_systems`, `governors`, `empire_edicts`, `empire_sprawl_cache`
- `lib/ColonizationEngine.php`: `recalcSprawl()`, `calcAdminCap()`, `calcColonyPhase()`, `createSector()`, `appointGovernor()`, `setEdictActive()`, `tick()`
- `api/colonization.php`: 14 Endpunkte
- `js/engine/runtime/RuntimeColonizationController.js`: Sprawl-Panel, Sektoren, Gouverneure, Edikte

**Fehlend:**
- ❌ Pop-Strata vollständig: Workers/Specialists/Elites mit Migration im Tick

**Referenz:** `lib/ColonizationEngine.php`, `docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md`

---

### 3.18 Empire-Kategorien & Spionage (~80%)

**Fertig implementiert (GAP_TODO A-2 ✅):**
- 7 normierte Scores (0–100): Wirtschaft, Militär, Forschung, Wachstum, Stabilität, Diplomatie, Spionage
- `sql/migrate_empire_categories_v1.sql`: `empire_category_scores`, `espionage_agents`, `espionage_missions`
- Score-Berechnung in `scripts/project_user_overview.php`
- `api/empire.php`: `get_scores`, `get_score_breakdown`, `get_espionage_status`
- `api/espionage.php`: `hire_agent`, `assign_mission`, `get_active_missions`, `mission_result`
- Frontend: `RuntimeEmpireCategoriesPanel.js` (Spider-Chart), `RuntimeEspionageController.js`

**Fehlend:**
- ❌ Spy Counter-Intelligence (Sonde-Detektion)

**Referenz:** `api/empire.php`, `api/espionage.php`, `docs/gamedesign/EMPIRE_CATEGORIES.md`

---

### 3.19 Colony Buildings – Isometrisch (~75%)

**Fertig implementiert (GAP_TODO A-3 ✅):**
- `api/colony_buildings.php`: `get_layout`, `place_building`, `remove_building`, `upgrade_slot`, `get_slot_info`
- `sql/migrate_colony_buildings_v1.sql`: `colony_building_slots`, `colony_building_upgrades`
- `js/ui/IsometricModuleRenderer.js` → API-Calls verdrahtet
- `tests/Unit/ColonyBuildingsTest.php`: 25 Smoke-Tests

**Fehlend:**
- ❌ Vollständige WebGPU-Integration für isometrische 3D-Darstellung
- ❌ Interaktive Gebäude-Platzierung im 3D-View

**Referenz:** `api/colony_buildings.php`, `docs/technical/COLONY_BUILDING_WEBGPU_DESIGN.md`

---

### 3.20 Multiplayer/Echtzeit (~50%)

**Fertig implementiert:**
- Server-Sent Events (SSE) für: `fleet_arrived`, `fleet_returning`, `incoming_attack`, `new_messages`, `connected`, `reconnect` (`api/events.php`)
- Auto-Reconnect mit exponentiellem Backoff
- Session-Lock sofort freigegeben (keine Blockierung anderer Requests)
- Achievements, Leaderboard, In-Game-Messaging

**Fehlend:**
- ❌ WebSocket für bidirektionale Echtzeit-Kommunikation
- ❌ Realtime Alliance/Faction/Global Chat (derzeit Polling)
- ❌ Anti-Cheat-Härtung für echten Multiplayer-Betrieb
- ❌ Concurrency-Behandlung bei simultanen Flotten-Angriffen

**Referenz:** `api/events.php`, `js/runtime/game.js`

---

### 3.21 Tutorial/Onboarding (~10%)

**Fertig implementiert:**
- `GQProlog` (`js/ui/prolog.js`): 5-stufiger passwordloser Registrierungs-Flow
- Herald-NPC-Fraktionen (faction_type = 'envoy') für Fraktions-Intro
- Fraktionsspezifische Initial-Quests bei Registrierung (`sql/migrate_prolog_quests_v1.sql`)

**Fehlend (nur Design vorhanden):**
- ❌ Interaktiver narrativer Prolog (5-stufig, fraktionsspezifisch) aus `ONBOARDING_PROLOGUE_DESIGN.md`
- ❌ Vollständiger Faction Introduction Flow aus `FACTION_INTRODUCTION.md`
- ❌ In-Game-Tutorial-Mechanik (Tooltip-Ketten, Guided Missions)

**Referenz:** `js/ui/prolog.js`, `docs/gamedesign/ONBOARDING_PROLOGUE_DESIGN.md`, `docs/gamedesign/FACTION_INTRODUCTION.md`

---

### 3.22 Situations-Framework (~30%)

**Fertig implementiert:**
- `api/situations.php` existiert (partiell)
- Colony Events (Solar Flare, Disease, etc.) als Vorstufe

**Fehlend:**
- ❌ Stellaris-inspiriertes Situations-Framework: mehrstufige Incidents mit Approaches
- ❌ Situations mit mehreren Lösungspfaden und Konsequenzen
- ❌ Galaktische Krisen-Events

**Referenz:** `docs/gamedesign/GAMEPLAY_DATA_MODEL.md`

---

### 3.23 Siegpfade (~10%)

**Nur Konzept:**
- ❌ Wirtschafts-Siegpfad (Galactic Market Dominanz)
- ❌ Wissenschafts-Siegpfad (Forschungs-Meilensteine)
- ❌ Diplomatie-Siegpfad (Galaktische Liga)
- ❌ Dominanz-Siegpfad (militärische Hegemonie)
- ❌ Spionage-Siegpfad

**Referenz:** `docs/gamedesign/GAMEPLAY_DATA_MODEL.md`

---

### 3.24 Endgame-Krisen (~5%)

**Nur Konzept:**
- ❌ Precursor-Erwachen (zeitgesteuerte galaktische Krise)
- ❌ Grey Goo / Swarm-Invasion
- ❌ Void Entity
- ❌ Kein Code vorhanden

**Referenz:** `docs/gamedesign/GAMEPLAY_DATA_MODEL.md`

---

### 3.25 ThemisDB-Migration (~15%)

**Fertig implementiert (Phase 0):**
- Docker-Setup (`themisdb/`)
- Basis-Provisioner vorhanden

**Fehlend (GAP_TODO A-4):**
- ❌ Phase 1: Schema-Mapping (35 Kerntabellen → AQL Collections)
- ❌ Phase 2: LLM-Migration (`themis_llm_chat()`, Prompt-Template-Migration)
- ❌ Phase 3: Graph-Modell (Fraktions- & Diplomatienetz als Property Graph)
- ❌ Phase 4: Vector/RAG (NPC-Dialog-Embedding, Similarity-Search)
- ❌ Phase 5: LoRA-Training-Pipeline
- ❌ Phase 6: Security (TLS, RBAC, Field-Level-Encryption)

**Referenz:** `docs/technical/THEMISDB_MIGRATION_ROADMAP.md`

---

## 4. Querverweis-Matrix: Design-Dokument → Implementierungsstand

| Design-Dokument | Impl.-Grad | Status | Referenz |
|---|---|---|---|
| `GAMEPLAY_DATA_MODEL.md` | ~35% | 🔴 Phase A–E definiert, wenig implementiert | Wirtschaft, Diplomatie, Endgame fehlen |
| `COLONIZATION_SYSTEM_DESIGN.md` | ~85% | ✅ | GAP_TODO A-1 ✅ |
| `COMBAT_SYSTEM_DESIGN.md` | ~70% | 🟡 | GAP_TODO B-1 🟡 |
| `COLONY_BUILDING_SYSTEM_DESIGN.md` | ~75% | 🟡 | GAP_TODO A-3 ✅ (Backend), 3D fehlt |
| `EMPIRE_CATEGORIES.md` | ~80% | ✅ | GAP_TODO A-2 ✅ |
| `ECONOMY_DESIGN.md` | ~60% | 🟡 | GAP_TODO B-2 🟡 |
| `VESSEL_MODULE_BLUEPRINT_DESIGN.md` | ~85% | ✅ | Weitgehend umgesetzt |
| `FTL_DRIVE_DESIGN.md` | ~95% | ✅ | Vollständig implementiert |
| `ONBOARDING_PROLOGUE_DESIGN.md` | ~10% | 🔴 | Nur Design, kein Code |
| `FACTION_INTRODUCTION.md` | ~10% | 🔴 | Nur Design, Herald-NPCs vorhanden |
| `BONUS_MALUS_DESIGN.md` | ~70% | 🟡 | Colony-Type-Boni verdrahtet |
| `GAMEDESIGN.md` | ~65% | 🟡 | Kern-Loop implementiert |
| `GAME_DESIGN_DOCUMENT.md` | ~65% | 🟡 | Überlappend mit GAMEDESIGN.md |

---

## 5. Technische Schulden

### 5.1 JS-Refactoring (Phase 2–4)

**Referenz:** `docs/technical/JS_REFACTOR_ZIELSTRUKTUR_TODO.md`  
**Status:** Phase 1 ✅, Phase 2 ✅ (Domain-Subtrees migriert), Phase 3–4 ausstehend

| Aufgabe | Status |
|---|---|
| `RuntimeMessage*`, `RuntimeTrade*`, `RuntimeWar*`, `RuntimePirates*` in Domain-Subtrees unter `js/engine/runtime/layers/domain/` migrieren | ✅ Sprint 1.2 |
| Minimap in eigenes Runtime-Modul auslagern | ⬜ offen |
| `SettingsController` in Runtime-Teilmodule aufsplitten | ⬜ offen |
| `js/network/api.js` → `api-transport.js`, `api-queue.js`, `api-cache.js`, `api-schema-adapters.js`, `api-session.js` | ⬜ offen |
| `js/network/auth.js` → `auth-shell.js`, `auth-boot-assets.js`, `auth-ui-state.js`, `auth-audio.js`, `auth-reachability.js`, `auth-2fa.js` | ⬜ offen |

### 5.2 Selection Unification

**Referenz:** `docs/technical/SELECTION_UNIFICATION_TODO.md`  
**Status:** Phase 1 teilweise ✅ (Central Store + Key), Phase 2–4 ausstehend

| Aufgabe | Status |
|---|---|
| Zentralen Selection Store einführen (`uiState.selectionState`) | ✅ Sprint 1.2 |
| Einheitlichen Selection-Key (kind + ids + scope) definieren | ✅ Sprint 1.2 |
| Unit-Tests für Selection-Key, State-Reducer, Group-Selection | ✅ Sprint 1.2 |
| Persistenten Selection-Marker (getrennt vom Hover-Marker) | ⬜ offen |
| Ownership-Visuals in Galaxy-, System-, Approach-, Colony-View vereinheitlichen | ⬜ offen |
| Gruppen-Selektion generalisieren (Cluster → Fraktion) | ⬜ offen |
| Multi-Select UX (Ctrl/Shift) | ⬜ offen |

### 5.3 Template System Migration

**Referenz:** `docs/technical/TEMPLATE_SYSTEM_DESIGN.md`  
**Status:** Konzept vorhanden, Migration nicht gestartet

Aktuell wird HTML größtenteils als String-Interpolation in PHP/JS erzeugt. Ziel ist eine Mustache-basierte Template-Engine.

### 5.4 ThemisDB Migration

**Referenz:** `docs/technical/THEMISDB_MIGRATION_ROADMAP.md`  
**Status:** Nur Phase 0 (Infrastruktur), Phase 1–6 ausstehend (Aufwand ~80–100h)

### 5.5 CI/CD-Pipeline

**Status:** ✅ Sprint 1.2 — `.github/workflows/ci.yml` eingerichtet  
Läuft Vitest (JS) + PHPUnit (PHP) auf jedem Push/PR gegen `main`/`master`.

### 5.6 Root-Level Test-Dateien

**Status:** ✅ Sprint 1.2 — 13 Skripte nach `tests/scripts/` verschoben.

`tests/scripts/README.md` dokumentiert Zweck und Verwendung aller Skripte.

### 5.7 API-Versioning Konsistenz

`config/api_version.php` ist vorhanden, aber nicht alle Endpunkte verwenden das Versionierungs-Präfix konsistent.

---

## 6. Zusammenfassung der kritischen Lücken (Priorität für Launch)

| Priorität | Lücke | Aufwand | Referenz |
|---|---|---|---|
| 🔴 Hoch | CI/CD Pipeline | ~8h | Sprint 1 |
| 🔴 Hoch | Wirtschaft Tier-2/3 Produktionsketten | ~20h | Sprint 2, GAP_TODO B-2 |
| 🔴 Hoch | War-Frontend Completion | ~12h | Sprint 3, GAP_TODO B-1 |
| 🔴 Hoch | Diplomatic Plays (4-Phasen) | ~20h | Sprint 3 |
| 🔴 Hoch | Tutorial/Onboarding-Prolog | ~30h | Sprint 6 |
| 🟡 Mittel | Pop-Satisfaction vollständig koppeln | ~12h | Sprint 2 |
| 🟡 Mittel | Anomalien-System | ~10h | Sprint 4 |
| 🟡 Mittel | Situations-Framework | ~20h | Sprint 4 |
| 🟡 Mittel | Siegpfade (4 Pfade) | ~30h | Sprint 5 |
| 🟡 Mittel | WebSocket Echtzeit-Multiplayer | ~20h | Sprint 7 |
| 🟢 Niedrig | ThemisDB Phase 1–6 | ~100h | Langfristig |
| 🟢 Niedrig | Megastructures | ~20h | Post-Launch |

---

*Dieser Audit wurde am 11. April 2026 auf Basis einer vollständigen Code-Analyse erstellt und soll als Living Document nach jeder größeren Implementierungsphase aktualisiert werden.*
