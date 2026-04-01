# [FEATURE] Empire-Kategoriesystem: Score-Berechnung, API & Espionage

**Labels:** `feature`, `backend`, `frontend`, `espionage`, `empire`  
**Milestone:** Empire-Kategoriesystem v1.0  
**Referenz:** `docs/gamedesign/EMPIRE_CATEGORIES.md` – vollständig  

---

## Zusammenfassung

Das Empire-Kategoriesystem fasst den Imperiumszustand in 7 normierten Scores (0–100) zusammen: Wirtschaft, Militär, Forschung, Wachstum, Stabilität, Diplomatie, Spionage. Die Scores erzeugen direkte Spieleffekte, beeinflussen sich gegenseitig und fließen als Schwellwert-Trigger in alle Systeme ein. Dazu kommt ein vollständiges Spionage-Subsystem.

---

## Akzeptanzkriterien – Phase A: Score-Berechnung

### Score-Formeln implementieren in `scripts/project_user_overview.php`

- [ ] `calc_economy_score(array $data): int`:
  ```
  economy_score = clamp(
    0.30 × production_efficiency
  + 0.25 × market_balance
  + 0.25 × trade_route_coverage
  + 0.20 × treasury_buffer       // Reserven in Stunden Vollversorgung, capped @48h→1.0
  , 0, 100)
  ```
- [ ] `calc_military_score(array $data): int`:
  ```
  military_score = clamp(
    0.40 × fleet_power_rel        // aus BattleSimulator.fleetPower()
  + 0.25 × fleet_readiness
  + 0.20 × garrison_coverage
  + 0.15 × military_tech_level   // ResearchTree MILITARY, normiert 0..1
  , 0, 100)
  ```
- [ ] `calc_research_score(array $data): int`:
  ```
  research_score = clamp(
    0.50 × tech_completeness
  + 0.30 × research_rate_rel
  + 0.20 × breakthrough_bonus
  , 0, 100)
  ```
- [ ] `calc_growth_score(array $data): int`:
  ```
  growth_score = clamp(
    0.35 × pop_growth_rate_rel
  + 0.30 × colony_expansion_rate  // neue Kolonien letzte 30 Tage
  + 0.20 × food_surplus_ratio
  + 0.15 × housing_fulfillment
  , 0, 100)
  ```
- [ ] `calc_stability_score(array $data): int`:
  ```
  stability_score = clamp(
    0.40 × weighted_happiness
  + 0.30 × (1.0 − crime_rate)
  + 0.30 × supply_coverage
  , 0, 100)
  ```
- [ ] `calc_diplomacy_score(array $data): int`:
  ```
  diplomacy_score = clamp(
    0.40 × alliance_coverage     // Tier-3+4-Fraktionen / Gesamtfraktionen
  + 0.35 × trust_avg             // Durchschnittliches Trust-Level
  + 0.25 × treaty_count_norm
  , 0, 100)
  ```
- [ ] `calc_espionage_score(array $data): int`:
  ```
  espionage_score = clamp(
    0.50 × network_strength_avg
  + 0.30 × intel_coverage        // aufgedeckte Systeme / Gesamtsysteme
  + 0.20 × counter_intel_rating
  , 0, 100)
  ```
- [ ] Scores in `user_empire_category_scores`-Tabelle speichern (neue Tabelle):
  ```sql
  CREATE TABLE user_empire_category_scores (
    player_id INT PRIMARY KEY,
    economy INT, military INT, research INT,
    growth INT, stability INT, diplomacy INT, espionage INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

### Schwellwert-Effekte in `api/game_engine.php`

- [ ] Schwellwert-Effekte für alle 7 Kategorien implementieren:

  | Kategorie | Score < 20 | Score > 75 |
  |-----------|-----------|-----------|
  | economy | Situation `economic_crisis` auslösen | +10 % Güterproduktion, +5 Happiness |
  | military | Situation `military_collapse` auslösen | Abschreckung: Raids −50 %; +8 Diplomatie-Score |
  | research | Situation `research_stagnation` (keine neuen Techs) | Durchbruchwahrscheinlichkeit ×2 |
  | growth | Situation `demographic_crisis` | +15 % Pop-Wachstum |
  | stability | Situation `civil_unrest` | +10 Happiness empire-weit |
  | diplomacy | Situation `diplomatic_isolation` | +5 zu allen neutralen Fraktionen |
  | espionage | Situation `intelligence_blackout` | Spionage-Effizienz ×1.5 |

- [ ] Journal-Event bei Kategorie < 35 (Frühwarnung):
  - ID: `category_warning_[name]`
  - Einmalig pro Absinken unter 35 (Reset wenn Score wieder über 40)

---

## Akzeptanzkriterien – Phase B: Radar-Chart UI (`js/game.js`)

- [ ] `EmpireOverviewController` – neuer Tab „Imperium" im Hauptmenü:
  - **7-Achsen-Radar-Chart** (SVG-basiert, kein Canvas):
    - Achsen: Wirtschaft, Militär, Forschung, Wachstum, Stabilität, Diplomatie, Spionage
    - Aktuelle Werte als ausgefülltes Polygon (halbtransparent)
    - Referenz-Polygon (Score = 50) als gestrichelte Linie
    - Klick auf Achse öffnet Kategorie-Detailansicht
  - **Kategorie-Detailkarten** unter dem Radar:
    - Score-Wert + Trend (↑/↓/→)
    - Haupteingabefaktoren (Top 3 positiv/negativ)
    - Aktuelle Schwellwert-Effekte
- [ ] Daten via `GET api/empire.php?action=category_scores`

---

## Akzeptanzkriterien – Phase C: Espionage-Datenmodell

### `sql/migrate_espionage_v1.sql`

- [ ] Tabelle `spy_networks`:
  ```sql
  CREATE TABLE spy_networks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    player_id INT NOT NULL,
    target_player_id INT,      -- NULL = gegen NPC-Fraktion
    target_faction_code VARCHAR(50),
    network_strength DECIMAL(5,2) DEFAULT 0.0,  -- 0..100
    detection_chance DECIMAL(4,3) DEFAULT 0.25,
    agent_count INT DEFAULT 0,
    established_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```
- [ ] Tabelle `spy_operations`:
  ```sql
  CREATE TABLE spy_operations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    player_id INT NOT NULL,
    network_id INT NOT NULL,
    op_type ENUM('STEAL_RESEARCH','SABOTAGE_PRODUCTION','ASSASSINATE_GOVERNOR','PLANT_AGENT','COUNTER_INTEL'),
    status ENUM('RUNNING','SUCCESS','FAILED','DETECTED') DEFAULT 'RUNNING',
    target_colony_id INT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    outcome JSON NULL
  );
  ```
- [ ] Tabelle `detected_threats`:
  ```sql
  CREATE TABLE detected_threats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    defending_player_id INT NOT NULL,
    suspected_attacker_id INT NULL,
    op_type VARCHAR(50),
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    evidence_level TINYINT DEFAULT 1  -- 1=schwach, 2=mittel, 3=eindeutig
  );
  ```

---

## Akzeptanzkriterien – Phase D: Espionage API (`api/espionage.php`)

- [ ] `POST api/espionage.php?action=launch_operation`:
  - Parameter: `op_type`, `target_user_id` oder `target_faction_code`, `target_colony_id` (optional)
  - Validierung: Netzwerk vorhanden, Stärke ≥ 10, keine laufende Operation dieses Typs
  - Vel'Ar-Bonus: +15 % `network_strength`, −20 % `detection_chance`
  - Laufzeit: `ESPIONAGE_OP_BASE_DURATION_H = 6` × (1 − network_strength/200) Stunden
  - Rückgabe: `operation_id`, `expires_at`, `detection_chance`
- [ ] `GET api/espionage.php?action=network_status`:
  - Alle eigenen Netzwerke + Status (strength, agent_count, aktive Operationen)
- [ ] `GET api/espionage.php?action=detected_threats`:
  - Erkannte feindliche Operationen der letzten 7 Tage
- [ ] Operationstypen-Effekte bei SUCCESS:
  | Op-Typ | Effekt |
  |--------|--------|
  | `STEAL_RESEARCH` | +50–150 Research-Punkte (abhängig von network_strength) |
  | `SABOTAGE_PRODUCTION` | Ziel-Kolonie −30 % Output für 10 Ticks |
  | `ASSASSINATE_GOVERNOR` | Gouverneur entfernt (Sektor ohne Verwaltung 30 Ticks) |
  | `PLANT_AGENT` | Netzwerk-Stärke im Ziel-System +10 permanent |
  | `COUNTER_INTEL` | Feindliches Netzwerk −20 Stärke, `detected_threats` Eintrag |

---

## Akzeptanzkriterien – Phase F: Siegpfad-Tracking (`api/empire.php`)

- [ ] `GET api/empire.php?action=victory_status`:
  - Alle 4 Siegpfade mit aktuellem Fortschritt:
    | Siegpfad | Bedingung |
    |---------|-----------|
    | Militärisch | military_score > 90 für 30 Ticks + 60 % der Galaxie kontrolliert |
    | Wirtschaftlich | economy_score > 90 für 30 Ticks + 5 Tier-4-Handelspakte |
    | Diplomatisch | diplomacy_score > 90 + Tier 3+ mit 8 von 11 Fraktionen |
    | Wissenschaftlich | research_score > 90 für 30 Ticks + alle Forschungsbäume vollständig |

---

## Estimate

| Phase | Aufwand |
|-------|---------|
| A – Score-Berechnung | 1–2 Tage |
| B – Radar-Chart UI | 1 Tag |
| C – Espionage DB | 1 Tag |
| D – Espionage API | 3–4 Tage |
| E – Vel'Ar-Integration | 1 Tag |
| F – Siegpfad-Tracking | 2 Tage |
| **Gesamt** | **~10–12 Tage** |
