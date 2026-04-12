# GalaxyQuest — Gap TODO (docs/ vs. Implementierung)

> **Erstellt:** 2026-04-08  
> **Basis:** Vollständige Gap-Analyse der docs/ gegen die reale Implementierung  
> **Status:** Living document — nach jeder Implementierung aktualisieren

---

## Legende

| Symbol | Bedeutung |
|---|---|
| ✅ | Implementiert und Doku korrekt |
| 🔴 | Kritisch — Implementierung 0 %, nur Design vorhanden |
| 🟡 | Partiell — Backend vorhanden, Frontend/Integration fehlt |
| 🔵 | Organisatorisch — kein Codefehler, aber Doku-Drift |
| ⬜ | Todo — noch nicht begonnen |

---

## Kategorie A — Kritische Gaps (Implementierung 0 %)

### A-1 Kolonisierungssystem 🔴 🚧
**Referenz:** `docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md`, `docs/github-issues/01–03`  
**Design:** Empire Sprawl, AdminCap, Sektoren, Gouverneure, Edikte, Pop-Strata, Produktionsketten

- [x] `sql/migrate_colonization_v1.sql` — Tabellen: `sectors`, `sector_systems`, `governors`, `empire_edicts`, `empire_sprawl_cache`
- [x] `sql/migrate_colonization_v2.sql` — `colonies`-Erweiterungen: `phase`, `sector_id`, `energy_balance`
- [x] `lib/ColonizationEngine.php` — `recalcSprawl()`, `calcAdminCap()`, `getMalusEffects()`, `calcColonyPhase()`, `createSector()`, `assignSystemToSector()`, `appointGovernor()`, `setEdictActive()`, `listEdicts()`, `tick()`
- [x] `api/colonization.php` — 14 Endpunkte: `sprawl_status`, `list_sectors`, `sector_detail`, `create_sector`, `update_sector`, `delete_sector`, `assign_system`, `remove_system`, `list_governors`, `appoint_governor`, `dismiss_governor`, `list_edicts`, `activate_edict`, `deactivate_edict`
- [x] `js/network/api.js` — 14 Client-Methoden: `colonizationSprawl`, `colonizationSectors`, `colonizationEdicts` etc.
- [x] `js/engine/runtime/RuntimeColonizationController.js` — Sprawl-Panel, Sektor-Liste, Gouverneur-Zuweisung, Edikt-Toggle-UI
- [x] `js/engine/runtime/RuntimeSocialControllersBootstrap.js` — colonizationController integriert
- [x] `js/runtime/game.js` — `runtimeColonizationControllerApi`, `colonizationController`, `renderColonization()`, `window.GQColonizationController` registriert
- [x] `tests/Unit/ColonizationEngineTest.php` — 37 Tests, 60 Assertions, alle ✅

---

### A-2 Empire-Kategorien & Spionage 🔴
**Referenz:** `docs/gamedesign/EMPIRE_CATEGORIES.md`, `docs/github-issues/06`  
**Design:** 7 normierte Scores (0–100), Spionage-Subsystem mit Agenten

- [x] `scripts/project_user_overview.php` — `calc_economy_score()`, `calc_military_score()`, `calc_research_score()`, `calc_growth_score()`, `calc_stability_score()`, `calc_diplomacy_score()`, `calc_espionage_score()`
- [x] `sql/migrate_empire_categories_v1.sql` — Tabelle `empire_category_scores`, `espionage_agents`, `espionage_missions`
- [x] `api/empire.php` — `get_scores`, `get_score_breakdown`, `get_espionage_status`
- [x] `api/espionage.php` — `hire_agent`, `assign_mission`, `get_active_missions`, `mission_result`
- [x] Frontend: `RuntimeEmpireCategoriesPanel.js` — Spider-Chart / Balken-Dashboard für 7 Scores
- [x] Frontend: `RuntimeEspionageController.js` — Agenten-Verwaltung, Missions-Zuweisung
- [x] `tests/Unit/EmpireCategoriesTest.php` — 21 Tests für Score-Berechnung und Upsert

---

### A-3 Colony-Buildings-Backend 🔴
**Referenz:** `COLONY_BUILDING_SYSTEM_DESIGN.md`, `COLONY_BUILDING_WEBGPU_DESIGN.md`, `docs/github-issues/09–10`  
**Design:** Isometrisches 3D-Bausystem, Gebäude-Slots, WebGPU-Integration

- [x] `api/colony_buildings.php` — `get_layout`, `place_building`, `remove_building`, `upgrade_slot`, `get_slot_info`
- [x] `sql/migrate_colony_buildings_v1.sql` — Tabelle `colony_building_slots`, `colony_building_upgrades`
- [x] Frontend-Backend-Binding: `js/ui/IsometricModuleRenderer.js` → API-Calls verdrahten (IsometricColonyBuildingManager)
- [x] Tests: `tests/Unit/ColonyBuildingsTest.php` — 25 Smoke-Tests für SQL, PHP-API, JS-Client, Renderer-Wiring

---

### A-4 ThemisDB Migration Phase 1–5 🔴
**Referenz:** `docs/technical/THEMISDB_MIGRATION_ROADMAP.md`  
**Status:** Nur Phase 0 (Infrastruktur) implementiert

- [ ] **Phase 1**: Schema-Mapping (alle 35 Kerntabellen → AQL Collections), PHP-Layer-Update (`get_themis()`), Transaktions-Parität
- [ ] **Phase 2**: LLM-Migration — `themis_llm_chat()`, Prompt-Template-Migration via PromptManager
- [ ] **Phase 3**: Graph-Modell — Fraktions- & Diplomatienetz als Property Graph
- [ ] **Phase 4**: Vector/RAG — NPC-Dialog-Embedding, Similarity-Search
- [ ] **Phase 5**: LoRA-Training-Pipeline (optional)
- [ ] **Phase 6**: Security — TLS, RBAC, Field-Level-Encryption (parallel zu Phase 1+)

---

## Kategorie B — Partielle Gaps (Backend ✅, Frontend/Integration fehlend)

### B-1 War-System Frontend 🟡 🚧
**Referenz:** `IMPLEMENTATION_STATUS_SUMMARY.md` (§3), `COMBAT_SYSTEM_DESIGN.md`, `docs/github-issues/07`  
**Status:** Backend ~85 %, Frontend ~90 % (Sprint 3.1 abgeschlossen)

- [x] War Declaration Dialog: Multi-Goal-Checkboxen statt Single-Select (5 Ziele mit Beschreibung)
- [x] Casus-Belli-Eingabe im Deklarations-Dialog
- [x] Peace-Negotiation: Counter-Offer-UI (counterOfferFormHtml, counterTerms-Checkboxen)
- [x] Peace-Terms-Auswahl beim Senden (White Peace, Reparations, System Handover, Vassal, Resource Tribute)
- [x] War-Intelligence-Panel (feindliche Flottenanzahl, Ressourcen-Scan) — `get_intel` Endpunkt + `🔍 Scan Enemy`-Button im Detail-View
- [x] Allianz-Kriege: N-vs-M Szenarien sichtbar — `alliance_wars`-Endpunkt + Alliance Wars-Sektion im War-Overview
- [x] War-Goal-Score sichtbar in Frontend (Backend trackt, `score_value`-Spalte im Goals-Table)
- [x] `tests/js/war-events.test.js` erstellen (31 Tests)

---

### B-2 Economy — Produktionsketten & Policy-Enforcement 🟡
**Referenz:** `IMPLEMENTATION_STATUS_SUMMARY.md` (§2), `WAVE_17_IMPLEMENTATION_PLAN.md`  
**Status:** API ~85 %, Integration ~85 %

- [ ] Tier-2 Güter-Produktionsrezepte vollständig verdrahten (`api/economy.php`)
- [ ] Tier-3 Güter (Luxus, Militär, Forschung) implementieren
- [ ] Pop-Class-Satisfaction an Güterverbrauch koppeln
- [ ] Shortage/Starvation-Events triggern
- [x] War-Economy-Policy (+30 % Militär, −20 % Konsumgüter) erzwingen — `economy_flush.php` + `EconomySimulation.js` `processTick()`
- [x] Autarkie-Policy vollständig integrieren — Import-Blockierung in `api/market.php`, Produktion +10 % in `economy_flush.php` + `EconomySimulation.js`
- [x] Merkantilismus: Import-Einschränkungen in `api/market.php` (Buy +20 %), Export-Bonus (Sell +20 %) — Integer-Policy-Bug gefixt
- [x] Subventionen (Landwirtschaft/Forschung/Militär) Boost-Logik — `economy_flush.php` + `EconomyPolicy.productionMultipliers()`
- [x] Manufacturing-Bottleneck-Warnungen im Frontend — `_renderPolicyEffectsPanel()` + `_renderConflictWarnings()` Bug gefixt

---

### B-2a Colony Goods Flow & Logistics Routes ✅ (Sprint 2.5)
**Referenz:** `ECONOMY_DESIGN.md` §7, `GAP_TODO.md`  
**Status:** Vollständig implementiert

- [x] `api/trade.php` — neuer `goods_flow`-Endpunkt: per-colony Surplus/Deficit-Matrix, Inter-Colony-Heatmap, AI-Empfehlungen
- [x] `js/network/api.js` — `goodsFlowAnalysis({ limit, interval_hours })` Client-Methode
- [x] `js/engine/runtime/layers/domain/trade/RuntimeLogisticsRoutesController.js` — Dashboard-Controller mit 3 Tabs: Flows (Heatmap), Routes (Effizienz-Metriken), Recommendations (KI-Empfehlungen)
- [x] `js/engine/runtime/RuntimeSocialControllersBootstrap.js` — `logisticsRoutesController` verdrahtet
- [x] `js/engine/runtime/RuntimeDesktopShell.js` — Fenster `logistics-routes` (680×680) registriert
- [x] `js/runtime/boot-manifest.js` — Controller im Boot-Manifest aufgenommen
- [x] `js/runtime/game.js` — `runtimeLogisticsRoutesControllerApi`, `logisticsRoutesController`, `renderLogisticsRoutes`, `window.GQLogisticsRoutesController` verdrahtet
- [x] `js/engine/runtime/RuntimeOpenWindowCommand.js` — `logistics-routes` im erlaubten Fenstersatz
- [x] `tests/js/logistics-routes.test.js` — 44 Unit-Tests (alle ✅)

---

### B-3 Pirates — Konsequenzen & Interaktionen 🟡 🚧
**Referenz:** `IMPLEMENTATION_STATUS_SUMMARY.md` (§1)  
**Status:** ~75 % Feature-Complete (teilweise implementiert)

- [x] Raid-Konsequenzen: Metal, Crystal, **Deuterium** bei Überfall abziehen (`maybe_pirate_raid()`)
- [x] Countermeasures-Effektivität in `maybe_pirate_raid()` berücksichtigt (raid_countermeasures + colony_defense_infrastructure)
- [x] Historisches Raid-Archiv in `pirate_raid_history` loggen (raid_success, goods_stolen)
- [x] `GREATEST(0, col - steal)` verhindert negative Ressourcenwerte
- [ ] Pirate-Kontrakte/Verhandlungen: Tributbeziehungen, Handel
- [ ] Standing-Decay-Sichtbarkeit im Frontend (Backend liefert Wert)
- [ ] Historisches Raid-Archiv >24h mit Paginierung im Frontend

---

## Kategorie C — Refactoring-Ziele (TODOs in bestehenden Docs)

### C-1 JS-Refactor Phase 2–4 🟡
**Referenz:** `docs/technical/JS_REFACTOR_ZIELSTRUKTUR_TODO.md`  
**Status:** Phase 1 ✅ (Layer-Struktur 1–14 fertig), Phase 2 ✅ (Domain-Subtrees), Phase 3–4 ausstehend

- [x] `RuntimeMessage*`, `RuntimeTrade*`, `RuntimeWar*`, `RuntimePirates*` in Domain-Subtrees unter `js/engine/runtime/layers/domain/` migrieren
- [ ] Minimap in eigenes Runtime-Modul auslagern
- [ ] `SettingsController` in Runtime-Teilmodule aufsplitten
- [ ] `js/network/api.js` → in `api-transport.js`, `api-queue.js`, `api-cache.js`, `api-schema-adapters.js`, `api-session.js` zerlegen
- [ ] `js/network/auth.js` → `auth-shell.js`, `auth-boot-assets.js`, `auth-ui-state.js`, `auth-audio.js`, `auth-reachability.js`, `auth-2fa.js`

---

### C-2 Selection Unification 🟡
**Referenz:** `docs/technical/SELECTION_UNIFICATION_TODO.md`  
**Status:** Phase 1 teilweise ✅ (Selection Store + Key), Phase 2–4 ausstehend

- [x] Zentralen Selection Store einführen (`uiState.selectionState` via `createSelectionStore()`)
- [x] Einheitlichen Selection-Key (kind + ids + scope) definieren (`buildSelectionKey`)
- [x] Unit-Tests für Selection-Key, State-Reducer, Group-Selection (22 Tests in `tests/js/runtime-selection-state.test.js`)
- [ ] Persistenten Selection-Marker (getrennt vom Hover-Marker)
- [ ] Ownership-Visuals in Galaxy-, System-, Approach-, Colony-View vereinheitlichen
- [ ] Gruppen-Selektion generalisieren (Cluster → Fraktion)
- [ ] Multi-Select UX (Ctrl/Shift)
- [ ] Accessibility: Tastatur-Navigation + aria-live für Selections

---

## Kategorie D — Dokumentations-Drift (kein Codefehler)

### D-1 GALAXY_POSTPROCESS_ROADMAP.md — veralteter Footer 🔵 ✅
**Datei:** `docs/technical/GALAXY_POSTPROCESS_ROADMAP.md`

- [x] Footer-Status aktualisiert: alle 5 Phasen ✅ COMPLETE
- [x] Phase 3a (DOF) und Phase 4c (Atmospheric Glow Halo) als deferred/not implemented markiert

---

### D-2 PROGRESS_BARS_ROADMAP.md — Phase 9/10 bereits implementiert 🔵 ✅
**Datei:** `docs/technical/PROGRESS_BARS_ROADMAP.md`

- [x] Phase 9 Items als ✅ markiert (Colony Events, Fleet Movement, Storage Capacity — alle bereits implementiert)
- [x] Phase 10 Items als ✅ markiert (Energy Balance ✅, Population ✅ implementiert)

---

### D-3 FUTURE_ENHANCEMENTS.md — §3.4 War Declarations Status 🔵 ✅
**Datei:** `docs/technical/FUTURE_ENHANCEMENTS.md`

- [x] §3.4 von 🔭 auf 🚧 Partial aktualisiert mit detailliertem Backend/Frontend-Status

---

### D-4 Root-Level Markdown-Dateien → docs/ verschieben 🔵 ✅
**Dateien im Root-Verzeichnis:**

- [x] `COMBAT_SYSTEM_DESIGN.md` → `docs/gamedesign/COMBAT_SYSTEM_DESIGN.md`
- [x] `COLONY_BUILDING_SYSTEM_DESIGN.md` → `docs/gamedesign/COLONY_BUILDING_SYSTEM_DESIGN.md`
- [x] `COLONY_BUILDING_WEBGPU_DESIGN.md` → `docs/technical/COLONY_BUILDING_WEBGPU_DESIGN.md`
- [x] `WAVE_17_IMPLEMENTATION_PLAN.md` → `docs/technical/WAVE_17_IMPLEMENTATION_PLAN.md`
- [x] `TRADERS_SYSTEM_IMPLEMENTATION.md` → `docs/technical/TRADERS_SYSTEM_IMPLEMENTATION.md`
- [x] `TRADERS_README.md` → `docs/technical/TRADERS_README.md`
- [x] `TRADERS_INTEGRATION_GUIDE.md` → `docs/technical/TRADERS_INTEGRATION_GUIDE.md`
- [x] `VFX_PROJECT_completion_REPORT.md` → `docs/technical/VFX_PROJECT_COMPLETION_REPORT.md`
- [x] `PHASE_1_COMPLETION_SUMMARY.md` → `docs/technical/PHASE_1_COMPLETION_SUMMARY.md`
- [x] `PHASE_2_COMPLETION.md` → `docs/technical/PHASE_2_COMPLETION.md`
- [x] `PHASE_2_IMPLEMENTATION.md` → `docs/technical/PHASE_2_IMPLEMENTATION.md`
- [x] `PHASE_2_VERIFICATION.md` → `docs/technical/PHASE_2_VERIFICATION.md`
- [x] `PHASE_3_COMPLETION.md` → `docs/technical/PHASE_3_COMPLETION.md`
- [x] `PHASE_3_DEBRIS_SYSTEM.md` → `docs/technical/PHASE_3_DEBRIS_SYSTEM.md`
- [x] `LORA_TRAINING_GUIDE.md` → `docs/lore/LORA_TRAINING_GUIDE.md`
- [x] `WEAPON_FIRE_INTEGRATION.md` → `docs/technical/WEAPON_FIRE_INTEGRATION.md`
- [x] `IMPLEMENTATION_STATUS_SUMMARY.md` → `docs/technical/IMPLEMENTATION_STATUS_SUMMARY.md`
- [x] `IMPLEMENTATION_CHECKLIST.md` → `docs/technical/IMPLEMENTATION_CHECKLIST.md`
- [x] `docs/INDEX.md` — Neue Einträge für alle verschobenen Dateien ergänzt

---

## Implementierungs-Reihenfolge (empfohlen)

| Priorität | Modul | Aufwand | Wert |
|---|---|---|---|
| 1 | D-1 bis D-3: Doc-Statusdrift beheben | ~1h | Sofort sauber |
| 2 | D-4: Root-MDs nach docs/ verschieben + INDEX.md | ~1h | Sofort navigierbar |
| 3 | A-1: Kolonisierungssystem DB-Migrationen | ~4h | Fundament |
| 4 | A-1: Kolonisierungssystem Backend (ColonizationEngine + API) | ~8h | Kern-Feature |
| 5 | B-1: War-Frontend Dialog-UI | ~4h | UX-Critical-Path |
| 6 | B-3: Pirates Raid-Konsequenzen | ~3h | Gameplay-Loop |
| 7 | B-2: Economy Policy-Enforcement | ~6h | Gameplay-Tiefe |
| 8 | A-2: Empire-Kategorien Score-Berechnung | ~8h | Dashboard |
| 9 | C-1: JS-Refactor Phase 2 (Domain-Subtrees) | ~8h | Code-Hygiene |
| 10 | C-2: Selection Unification Phase 1–2 | ~8h | UX-Qualität |
| 11 | A-3: Colony-Buildings-Backend | ~6h | Wenn Design finalisiert |
| 12 | A-4: ThemisDB Phase 1 | ~20h | Infrastruktur |

---

## Fortschrittslog

| Datum | Modul | Erledigte Items |
|---|---|---|
| 2026-04-08 | Modul 0 | Dieses Dokument erstellt |
| 2026-04-08 | Modul 1 (D-1) | GALAXY_POSTPROCESS_ROADMAP.md Footer + Remaining-Work korrigiert |
| 2026-04-08 | Modul 1 (D-2) | PROGRESS_BARS_ROADMAP.md Phase 9+10 als ✅ markiert |
| 2026-04-08 | Modul 1 (D-3) | FUTURE_ENHANCEMENTS.md §3.4 auf 🚧 Partial aktualisiert |
| 2026-04-08 | Modul 2 (D-4) | 18 Root-MDs nach docs/{gamedesign,technical,lore}/ verschoben; INDEX.md vollständig aktualisiert |
| 2026-04-08 | Modul 3 (A-1) | `sql/migrate_colonization_v1.sql` + `v2.sql` — 5 neue Tabellen + colonies-Erweiterung |
| 2026-04-08 | Modul 4 (A-1) | `lib/ColonizationEngine.php` (10 Methoden) + `api/colonization.php` (14 Endpunkte) + `api.js` (14 Client-Methoden) |
| 2026-04-08 | Modul 5 (A-1) | `RuntimeColonizationController.js` — Sprawl-Panel, Sektoren, Gouverneure, Edikte-Toggle; Bootstrap + game.js integriert |
| 2026-04-08 | Modul 6 (A-1) | `tests/Unit/ColonizationEngineTest.php` — 37 Tests, 60 Assertions ✅ |
| 2026-04-08 | Modul 7 (B-1) | `RuntimeWarController.js`: Multi-Goal-Declaration, Peace-Terms-Checkboxen, counterOfferFormHtml() |
| 2026-04-08 | Modul 8 (B-2) | `api/npc_ai.php::maybe_pirate_raid()`: Deuterium-Loot, Countermeasure-Effektivität, pirate_raid_history-Log |
| 2026-04-12 | Sprint 1.2 (C-1) | Domain-Subtrees: 9 RuntimeMessage*/Trade*/War*/Pirates* → `layers/domain/`; boot-manifest.js + Audit-Test aktualisiert |
| 2026-04-12 | Sprint 1.2 (C-2) | Selection Unification Phase 1: `createSelectionStore()`, `uiState.selectionState`, 22 Unit-Tests |
| 2026-04-12 | Sprint 1.2 (5.5) | CI/CD: `.github/workflows/ci.yml` — Vitest + PHPUnit auf Push/PR |
| 2026-04-12 | Sprint 1.2 (5.6) | Root-Test-Dateien: 13 Skripte nach `tests/scripts/` verschoben, Pfade korrigiert, README.md erstellt |
| 2026-04-12 | Sprint 3.1 (B-1) | War-Frontend-Completion: `get_intel`+`alliance_wars` Endpunkte, War-Intelligence-Panel, Alliance-Wars-Sektion, `warIntel`+`warAllianceList` in api.js, 11 neue Tests (31 total) |
