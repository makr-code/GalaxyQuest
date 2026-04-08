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
- [x] `js/network/api.js` — 15 Client-Methoden: `colonizationSprawl`, `colonizationSectors`, `colonizationSectorDetail`, `colonizationCreateSector`, `colonizationUpdateSector`, `colonizationDeleteSector`, `colonizationAssignSystem`, `colonizationRemoveSystem`, `colonizationGovernors`, `colonizationAppointGovernor`, `colonizationDismissGovernor`, `colonizationEdicts`, `colonizationActivateEdict`, `colonizationDeactivateEdict`
- [ ] Frontend: `RuntimeColonizationController.js` — Sprawl-Panel, Sektor-Verwaltung, Gouverneurs-Zuweisung, Edikt-Liste
- [ ] Tests: `tests/Unit/ColonizationEngineTest.php`

---

### A-2 Empire-Kategorien & Spionage 🔴
**Referenz:** `docs/gamedesign/EMPIRE_CATEGORIES.md`, `docs/github-issues/06`  
**Design:** 7 normierte Scores (0–100), Spionage-Subsystem mit Agenten

- [ ] `scripts/project_user_overview.php` — `calc_economy_score()`, `calc_military_score()`, `calc_research_score()`, `calc_growth_score()`, `calc_stability_score()`, `calc_diplomacy_score()`, `calc_espionage_score()`
- [ ] `sql/migrate_empire_categories_v1.sql` — Tabelle `empire_category_scores`, `espionage_agents`, `espionage_missions`
- [ ] `api/empire.php` — `get_scores`, `get_score_breakdown`, `get_espionage_status`
- [ ] `api/espionage.php` — `hire_agent`, `assign_mission`, `get_active_missions`, `mission_result`
- [ ] Frontend: `RuntimeEmpireCategoriesPanel.js` — Spider-Chart / Balken-Dashboard für 7 Scores
- [ ] Frontend: `RuntimeEspionageController.js` — Agenten-Verwaltung, Missions-Zuweisung

---

### A-3 Colony-Buildings-Backend 🔴
**Referenz:** `COLONY_BUILDING_SYSTEM_DESIGN.md`, `COLONY_BUILDING_WEBGPU_DESIGN.md`, `docs/github-issues/09–10`  
**Design:** Isometrisches 3D-Bausystem, Gebäude-Slots, WebGPU-Integration

- [ ] `api/colony_buildings.php` — `get_layout`, `place_building`, `remove_building`, `upgrade_slot`, `get_slot_info`
- [ ] `sql/migrate_colony_buildings_v1.sql` — Tabelle `colony_building_slots`, `colony_building_upgrades`
- [ ] Frontend-Backend-Binding: `js/ui/IsometricModuleRenderer.js` → API-Calls verdrahten (aktuell nur UI-Stub)
- [ ] Tests: API-Endpunkt Smoke-Tests

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

### B-1 War-System Frontend 🟡
**Referenz:** `IMPLEMENTATION_STATUS_SUMMARY.md` (§3), `COMBAT_SYSTEM_DESIGN.md`, `docs/github-issues/07`  
**Status:** Backend ~80 %, Frontend ~40 %

- [ ] War Declaration Dialog vollständig verdrahten (`RuntimeWarController.js`)
- [ ] Goal-Customization UI (Preset-Auswahl + Freitext-Ziele)
- [ ] Casus-Belli-Auswahl im Deklarations-Dialog
- [ ] War-Intelligence-Panel (feindliche Flottenanzahl, Ressourcen-Scan)
- [ ] Peace-Negotiation: Counter-Offer-UI (nicht nur Accept/Reject)
- [ ] Allianz-Kriege: N-vs-M Szenarien (Backend-Stub vorhanden)
- [ ] War-Goal-Score sichtbar in Frontend (Backend trackt, Frontend zeigt "unknown")
- [ ] `tests/js/war-events.test.js` erstellen

---

### B-2 Economy — Produktionsketten & Policy-Enforcement 🟡
**Referenz:** `IMPLEMENTATION_STATUS_SUMMARY.md` (§2), `WAVE_17_IMPLEMENTATION_PLAN.md`  
**Status:** API ~75 %, Integration ~60 %

- [ ] Tier-2 Güter-Produktionsrezepte vollständig verdrahten (`api/economy.php`)
- [ ] Tier-3 Güter (Luxus, Militär, Forschung) implementieren
- [ ] Pop-Class-Satisfaction an Güterverbrauch koppeln
- [ ] Shortage/Starvation-Events triggern
- [ ] War-Economy-Policy (+30 % Militär, −20 % Konsumgüter) erzwingen
- [ ] Autarkie-Policy vollständig integrieren (Stub vorhanden)
- [ ] Merkantilismus: Import-Einschränkungen in `api/market.php` einbauen
- [ ] Subventionen (Landwirtschaft/Forschung/Militär) Boost-Logik finalisieren
- [ ] Manufacturing-Bottleneck-Warnungen im Frontend

---

### B-3 Pirates — Konsequenzen & Interaktionen 🟡
**Referenz:** `IMPLEMENTATION_STATUS_SUMMARY.md` (§1)  
**Status:** ~60 % Feature-Complete

- [ ] Raid-Konsequenzen: Kolonien-Ressourcen bei Überfall abziehen
- [ ] Countermeasures-System: Credits/Militär ausgeben um Raids abzuwehren
- [ ] Pirate-Kontrakte/Verhandlungen: Tributbeziehungen, Handel
- [ ] Standing-Decay-Sichtbarkeit im Frontend (Backend liefert Wert)
- [ ] Historisches Raid-Archiv (>24h, Paginierung)

---

## Kategorie C — Refactoring-Ziele (TODOs in bestehenden Docs)

### C-1 JS-Refactor Phase 2–4 🟡
**Referenz:** `docs/technical/JS_REFACTOR_ZIELSTRUKTUR_TODO.md`  
**Status:** Phase 1 ✅ (Layer-Struktur 1–14 fertig), Phase 2–4 ausstehend

- [ ] `RuntimeMessage*`, `RuntimeTrade*`, `RuntimeWar*`, `RuntimePirates*` in Domain-Subtrees unter `js/engine/runtime/layers/domain/` migrieren
- [ ] Minimap in eigenes Runtime-Modul auslagern
- [ ] `SettingsController` in Runtime-Teilmodule aufsplitten
- [ ] `js/network/api.js` → in `api-transport.js`, `api-queue.js`, `api-cache.js`, `api-schema-adapters.js`, `api-session.js` zerlegen
- [ ] `js/network/auth.js` → `auth-shell.js`, `auth-boot-assets.js`, `auth-ui-state.js`, `auth-audio.js`, `auth-reachability.js`, `auth-2fa.js`

---

### C-2 Selection Unification 🟡
**Referenz:** `docs/technical/SELECTION_UNIFICATION_TODO.md`  
**Status:** Alle 6 Phasen ausstehend

- [ ] Zentralen Selection Store einführen (`uiState.selectionState`)
- [ ] Einheitlichen Selection-Key (kind + ids + scope) definieren
- [ ] Persistenten Selection-Marker (getrennt vom Hover-Marker)
- [ ] Ownership-Visuals in Galaxy-, System-, Approach-, Colony-View vereinheitlichen
- [ ] Gruppen-Selektion generalisieren (Cluster → Fraktion)
- [ ] Multi-Select UX (Ctrl/Shift)
- [ ] Accessibility: Tastatur-Navigation + aria-live für Selections
- [ ] Unit-Tests für Selection-Key, State-Reducer, Group-Selection

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
