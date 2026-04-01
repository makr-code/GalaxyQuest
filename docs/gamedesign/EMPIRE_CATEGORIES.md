# GalaxyQuest – Empire-Kategoriesystem

Status: autoritativ  
Version: 1.0  
Stand: 01.04.2026  
Referenz: GAMEPLAY_DATA_MODEL.md

---

## 1. Überblick

Das Empire-Kategoriesystem fasst den Gesamtzustand eines Reiches in sieben messbaren
Dimensionen zusammen. Jede Kategorie besitzt einen normierten Score (0–100), berechnet
sich aus konkreten Spielzustandsgrößen und erzeugt direkte Spieleffekte.

| # | Kategorie    | Kurzname    | Kernfrage                                   |
|---|--------------|-------------|---------------------------------------------|
| 1 | Wirtschaft   | `economy`   | Wie produktiv und stabil ist der Markt?     |
| 2 | Militär      | `military`  | Wie stark und einsatzbereit sind die Flotten? |
| 3 | Forschung    | `research`  | Wie schnell schreitet die Technologie voran? |
| 4 | Wachstum     | `growth`    | Wie stark expandiert Bevölkerung und Reich? |
| 5 | Stabilität   | `stability` | Wie geordnet ist die innere Lage?           |
| 6 | Diplomatie   | `diplomacy` | Wie verlässlich ist das Bündnisnetz?        |
| 7 | Spionage     | `espionage` | Wie weit reicht das Informationsnetz?       |

Die Scores fließen als Multiplikatoren und Schwellwertauslöser in alle Spielsysteme ein,
beeinflussen sich gegenseitig und erzeugen so die charakteristischen Tradeoffs des Spiels.

---

## 2. Wirtschaft (`economy`)

### 2.1 Scoreformel

```
economy_score = clamp(
  0.30 * production_efficiency     // Güterfluss vs. Nachfrage
+ 0.25 * market_balance            // (Angebot – Nachfrage) / max(Angebot, 1)  normiert 0..1
+ 0.25 * trade_route_coverage      // aktive Routen / benötigte Routen
+ 0.20 * treasury_buffer           // Reserven in Stunden Vollversorgung (capped @ 48 h → 1.0)
, 0, 100)
```

### 2.2 Eingabefaktoren

| Faktor                  | Quelle                              | Richtung |
|-------------------------|-------------------------------------|----------|
| Produktionsketten       | `colony_goods_flow`                 | +        |
| Kolonie-Spezialisierung | `colony.type` (Forge/Agri/…)        | +        |
| Logistikrouten          | `logistics_routes`                  | +        |
| Marktpreisschwankung    | `market_quotes.alpha`               | –        |
| Policy-Upkeep           | `empire_policies`                   | –        |
| Handelspakte            | `diplomatic_plays` (treaty)         | +        |
| Kriegszustand           | aktiver `war_state`                 | –        |
| Stabilität (§5)         | `stability_score`                   | +        |

### 2.3 Spieleffekte

| Schwellwert        | Effekt                                                         |
|--------------------|----------------------------------------------------------------|
| > 75               | +10 % Güterproduktion, +5 Happiness empire-weit               |
| 50 – 75            | Neutral (Referenz)                                             |
| 35 – 50            | –5 % Produktion; Marktgebühren +20 %                          |
| 20 – 35            | –15 % Produktion; Kolonieunruhen wahrscheinlicher              |
| < 20               | Wirtschaftskrise: Situation `economic_crisis` wird ausgelöst  |

### 2.4 Querverflechtungen

- `economy → research`: Höherer Economy-Score finanziert mehr Research-Punkte/Tick.
- `economy → growth`: Güterversorgung ist Voraussetzung für Bevölkerungswachstum.
- `economy → diplomacy`: Wirtschaftliche Macht erhöht Verhandlungsgewicht in Diplomatic Plays.

---

## 3. Militär (`military`)

### 3.1 Scoreformel

```
military_score = clamp(
  0.40 * fleet_power_rel           // eigene fleet_power / (eigene + mittl. Gegnermacht) → 0..1
+ 0.25 * fleet_readiness           // Durchschn. Fleet Readiness (0..1)
+ 0.20 * garrison_coverage         // Kolonien mit Garrison / Gesamtkolonien
+ 0.15 * military_tech_level       // Research-Baum "Military", normiert 0..1
, 0, 100)
```

Wobei `fleet_power` aus `BattleSimulator.fleetPower()` stammt (siehe
`js/engine/game/BattleSimulator.js`).

### 3.2 Eingabefaktoren

| Faktor               | Quelle                                  | Richtung |
|----------------------|-----------------------------------------|----------|
| Flottenzusammensetzung | `ships`, `fleets`                      | +        |
| Fleet Readiness      | Versorgung + Maintenance (§6.5 GDM)     | +        |
| Garnisonstruppen     | `Colony.garrison`                       | +        |
| Militär-Technologie  | `ResearchTree` (Kategorie MILITARY)     | +        |
| Flottenverluste      | `BattleReport`                          | –        |
| Supply-Defizit       | fuel/spare_parts Verbrauch              | –        |
| Kriegserschöpfung    | `war_exhaustion`                        | –        |

### 3.3 Spieleffekte

| Schwellwert        | Effekt                                                              |
|--------------------|---------------------------------------------------------------------|
| > 75               | Abschreckung: NPCs starten seltener Raids; +8 Diplomatie-Score     |
| 50 – 75            | Neutral                                                             |
| 35 – 50            | Invasionsrisiko +20 %; Piraterie-Events häufiger                    |
| 20 – 35            | Kolonien angreifbar; Garnisonstruppenmoral sinkt                    |
| < 20               | Militärkrise: Situation `military_collapse` ausgelöst              |

### 3.4 Querverflechtungen

- `military → diplomacy`: Hoher Militär-Score erhöht Druckmittel in Verhandlungen (§6.4 GDM).
- `military → stability`: Garrison schützt Kolonien, senkt Unruhesrisiko.
- `military ↔ economy`: Flottenunterhalt kostet Ressourcen; Wirtschaftskrise senkt Readiness.

---

## 4. Forschung (`research`)

### 4.1 Scoreformel

```
research_score = clamp(
  0.50 * tech_completeness          // freigeschaltete Techs / Gesamttechs (0..1)
+ 0.30 * research_rate_rel          // eigene RP/Tick / maximale RP/Tick des Spielers
+ 0.20 * breakthrough_bonus         // aktive Anomalie-/Relic-Boni (normiert)
, 0, 100)
```

### 4.2 Eingabefaktoren

| Faktor                | Quelle                              | Richtung |
|-----------------------|-------------------------------------|----------|
| Wissenschaftler-Pops  | `ColonySimulation` (SCIENTIST jobs) | +        |
| Labor-Gebäude         | `buildings` (LAB)                   | +        |
| Forschungskolonien    | `Colony.type = RESEARCH`            | +        |
| Anomalie-Boni         | `anomalies` (tech_fragments)        | +        |
| Stabilität (§5)       | niedrige Stabilität → Streiks        | –        |
| Economy-Score (§2)    | finanziert Research-Budget           | +        |
| Wirtschaftskrise      | senkt Research-Rate um 30 %          | –        |

### 4.3 Spieleffekte

| Score-Band | Effekt                                                                    |
|------------|---------------------------------------------------------------------------|
| > 75       | Durchbruchwahrscheinlichkeit × 2; +10 % auf alle Produktionsmultiplikatoren |
| 50 – 75    | Neutral                                                                   |
| 35 – 50    | Tech-Unlock verzögert (–20 % RP/Tick)                                    |
| < 20       | Tech-Stagnation: keine neuen Techs; Situation `research_stagnation`       |

Freigeschaltete Technologien wirken als `colony_modifiers` oder globale Multiplikatoren
in der `dynamische_Effektmatrix` (§6.7 GDM): `resource_output_mult`, `research_speed_mult`,
`fleet_readiness_mult` usw.

### 4.4 Querverflechtungen

- `research → all`: Technologien verbessern jeden anderen Score direkt (auch Stabilität, s. Matrix §9).
- `research → stability`: Medizin-, Energie- und Nahrungstechnologien verbessern Versorgung und senken Radicalization.
- `research → military`: Waffensysteme, Schilde, FTL-Antriebe.
- `research → economy`: Produktionsketten-Effizienz, neue Güter.
- `research → espionage`: Spionagetechnologie (Tarnung, Signalerkennung).

---

## 5. Wachstum (`growth`)

### 5.1 Scoreformel

```
growth_score = clamp(
  0.35 * pop_growth_rate_rel        // Bevölkerungswachstum / angestrebtes Wachstum
+ 0.30 * colony_expansion_rate      // neue Kolonien letzte 30d / Zielrate
+ 0.20 * food_surplus_ratio         // food_surplus / (0.5 * population)  capped @ 1.0
+ 0.15 * housing_fulfillment        // housing_available / housing_needed
, 0, 100)
```

### 5.2 Eingabefaktoren

| Faktor               | Quelle                                  | Richtung |
|----------------------|-----------------------------------------|----------|
| Nahrungsproduktion   | `colony_goods_flow` (food)              | +        |
| Wohngebäude          | `buildings` (HOUSING-Typ)              | +        |
| Happiness            | `Colony.happiness`                      | +        |
| Öffentliche Dienste  | `Colony.public_services`               | +        |
| Neue Kolonien        | `colonies` (created_at letzte 30 Tage)  | +        |
| Nahrungsdefizit      | food_per_capita < 1.0                   | –        |
| Energiedefizit       | energy < 0                             | –        |
| Stabilitätskrise     | stability < 20                          | –        |

### 5.3 Spieleffekte

| Score-Band | Effekt                                                                  |
|------------|-------------------------------------------------------------------------|
| > 75       | +15 % Pop-Wachstum; Kolonisierungsschiffe bauen 20 % schneller          |
| 50 – 75    | Neutral                                                                 |
| 35 – 50    | Pop-Wachstum –10 %; Einwanderungssaldo sinkt                            |
| 20 – 35    | Bevölkerungsrückgang in Randkolonien                                    |
| < 20       | Demografie-Krise: Situation `demographic_crisis`; pop_growth_mult –50 % |

### 5.4 Querverflechtungen

- `growth → economy`: Mehr Bevölkerung → mehr Arbeitskraft → höhere Produktion.
- `growth → military`: Mehr Soldier-Pops → größere Garrison-Kapazität.
- `growth → stability`: Übervölkerung ohne Ressourcen destabilisiert Kolonien.
- `growth → research`: Mehr Scientist-Pops → mehr Research-Punkte/Tick.

---

## 6. Stabilität (`stability`)

### 6.1 Scoreformel

```
stability_score = clamp(
  empire_stability_avg              // gewichteter Durchschnitt über alle Kolonien
, 0, 100)

colony_stability = clamp(
  0.30 * happiness
+ 0.25 * public_services
+ 0.25 * need_fulfillment           // (1 - shortage_severity)  → 0..1
- 0.20 * radicalization             // aus population_strata
, 0, 100)
```

Schwellwerte für Krisenauslösung auf Kolonieebene:
- `< 35`: Streiks und Produktionsmalus (–15 %)
- `< 20`: Aufstandsevent; Invasion einfacher (–20 % defense_power)

### 6.2 Eingabefaktoren

| Faktor                  | Quelle                                     | Richtung |
|-------------------------|--------------------------------------------|----------|
| Happiness               | `Colony.happiness`                         | +        |
| Öffentliche Dienste     | `Colony.public_services`                   | +        |
| Bedarfserfüllung        | `colony_needs.fulfillment_ratio`           | +        |
| Bevölkerungs-Strata     | `population_strata.radicalization`         | –        |
| Interne Fraktionen      | `faction_approval` weighted average         | +/–      |
| Tax Pressure            | Policy-Niveau `TAX_LEVEL`                  | –        |
| Energiedefizit          | energy < –8 (watch), < –22 (strain)        | –        |
| Nahrungsdefizit         | food decline > –12/h (watch), > –28 (strain)| –       |
| Garrison                | `Colony.garrison` > 0                      | +5 flat  |

### 6.3 Spieleffekte

Die Stabilität wirkt als `productivity_factor` in der Produktionsformel (§6.1 GDM):

```
produced = base_rate
  * building_level_factor
  * workforce_factor
  * (0.5 + 0.5 * stability_factor)   // stability_factor = stability_score / 100
  * energy_factor
  * policy_factor
```

Zusätzlich:
- Niedrige Stabilität → NPC-Raids und Invasionen wahrscheinlicher.
- Niedrige Stabilität → `war_exhaustion` wächst schneller.
- Stabilität > 75 → +5 Happiness empire-weit durch Stabilitätsbonus.

### 6.4 Querverflechtungen

- `stability → economy`: Streiks reduzieren Güterproduktion direkt.
- `stability → military`: Aufstände binden Garnison, reduzieren effektive Flottenstärke.
- `stability → growth`: Niedrige Stabilität stoppt Pop-Wachstum.
- `stability → diplomacy`: Innere Unruhen reduzieren diplomatisches Gewicht (–5 Diplomatie).

---

## 7. Diplomatie (`diplomacy`)

### 7.1 Scoreformel

```
diplomacy_score = clamp(
  0.35 * trust_network_quality      // Durchschn. Trust zu positiven Fraktionen (0..1)
+ 0.30 * pact_coverage              // aktive Pakte / mögliche Pakte
+ 0.20 * war_pressure_inverse       // 1 – (aktive Kriegsfronten / max_fronten)
+ 0.15 * diplomatic_win_progress    // Fortschritt Siegpfad Diplomatie (0..1)
, 0, 100)
```

### 7.2 Eingabefaktoren

| Faktor                  | Quelle                                   | Richtung |
|-------------------------|------------------------------------------|----------|
| Faction Standing        | `user_faction_standing`                  | +        |
| Trust-Score             | bilateral Trust (wächst durch Kooperation)| +       |
| Threat-Score            | bilateral Threat (steigt durch Aggression)| –       |
| Aktive Pakte            | `diplomatic_plays` (treaty)              | +        |
| Pakt-Upkeep eingehalten | `policy_upkeep` für Pakte                | +        |
| Kriegszustand           | `war_state`                              | –        |
| Militär-Score (§3)      | höher = mehr Verhandlungsmacht           | +        |
| Economy-Score (§2)      | wirtsch. Abhängigkeit als Hebel          | +        |

### 7.3 Spieleffekte

| Score-Band | Effekt                                                                       |
|------------|------------------------------------------------------------------------------|
| > 75       | Verbündete leisten militärischen Beistand; Handelsrouten +15 % Kapazität     |
| 50 – 75    | Neutral                                                                      |
| 35 – 50    | Embargo-Risiko; NPCs fordern höhere Konzessionen in Plays                    |
| 20 – 35    | Verbündete verlassen Pakte; Threat +10 bei Gegnern                           |
| < 20       | Diplomatische Isolation: keine neuen Pakte; Situation `diplomatic_crisis`    |

### 7.4 Querverflechtungen

- `diplomacy → economy`: Handelspakte erhöhen Exportvolumen und senken Marktgebühren.
- `diplomacy → military`: Verbündete Flotten unterstützen im Krieg.
- `diplomacy → espionage`: Hohes Vertrauen senkt feindliche Spionageerfolge gegen das Reich.

---

## 8. Spionage (`espionage`)

### 8.1 Konzept

Spionage repräsentiert die Reichweite des eigenen Geheimdienstnetzes und die Fähigkeit,
feindliche Aktionen zu unterbinden. Der Score hat zwei Dimensionen:

- **Offensiv** (`espionage_offensive`): Eigene Infiltration feindlicher Reiche.
- **Defensiv** (`espionage_defensive`): Schutz des eigenen Reiches vor Fremdspionage.

```
espionage_score = clamp(
  0.50 * espionage_offensive
+ 0.50 * espionage_defensive
, 0, 100)

espionage_offensive = clamp(
  agency_network_strength           // Spionagegebäude × Tech-Level × Vel'Ar-Bonus
* intel_budget_factor               // dark_matter_spent / dark_matter_budget_max
, 0, 100)

espionage_defensive = clamp(
  counter_intel_strength            // Counter-Intel-Gebäude + Security-Policy
- infiltration_detected_penalty     // erkannte feindl. Agenten × –5
, 0, 100)
```

### 8.2 Datenmodell (neue Tabellen)

Diese Tabellen werden additiv zur bestehenden Datenbankstruktur hinzugefügt:

```sql
-- Spionagenetzwerk pro Benutzer
-- Maximal ein Eintrag pro (user_id, target_user_id):
--   target_user_id IS NULL  → eigene defensive Infrastruktur
--   target_user_id NOT NULL → offensives Netz gegen diesen Spieler
CREATE TABLE espionage_networks (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    target_user_id  INT,                        -- NULL = eigene Defensive
    network_level   TINYINT  DEFAULT 0,         -- 0..5
    budget_dm       INT      DEFAULT 0,         -- Dark Matter Budget/Tick
    last_action_at  DATETIME,
    created_at      DATETIME DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id),
    -- Sicherstellt: max. ein Defensiv-Eintrag (NULL) + max. ein Eintrag je Ziel-User
    UNIQUE KEY uq_network (user_id, target_user_id)
);

-- Spionage-Operationen
-- op_type ENUM muss mit der Operationstabelle in §8.4 synchron gehalten werden.
CREATE TABLE espionage_operations (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id   INT NOT NULL,
    target_user_id  INT NOT NULL,
    op_type         ENUM(
                      'intel_gather',          -- §8.4
                      'tech_steal',            -- §8.4
                      'sabotage_production',   -- §8.4
                      'sow_unrest',            -- §8.4
                      'assassinate_leader',    -- §8.4
                      'counter_intel'          -- §8.4
                    ) NOT NULL,
    status          ENUM('queued','active','success','failed','detected') DEFAULT 'queued',
    started_at      DATETIME,
    resolved_at     DATETIME,
    result_payload  JSON,
    FOREIGN KEY (actor_user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
);

-- Erkannte feindliche Agenten
CREATE TABLE espionage_detections (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    defender_user_id INT NOT NULL,
    attacker_user_id INT,                       -- NULL = unbekannt
    detected_at     DATETIME DEFAULT NOW(),
    op_type         VARCHAR(64),
    colony_id       INT,
    FOREIGN KEY (defender_user_id) REFERENCES users(id)
);
```

### 8.3 Eingabefaktoren

| Faktor                    | Richtung | Beschreibung                                     |
|---------------------------|----------|--------------------------------------------------|
| Spionage-Gebäude          | +        | `INTELLIGENCE_AGENCY` Gebäudetyp pro Kolonie     |
| Vel'Ar-Fraktionsbonus     | +        | Vel'Ar-Mitgliedschaft: `espionage_offensive` +20 |
| Dark-Matter-Budget        | +        | Investition in Netzwerke und Operationen          |
| Forschungs-Technologie    | +        | Spionage-Techs im Research-Baum (COMPUTING-Zweig)|
| Counter-Intel-Gebäude     | +        | Senkt `infiltration_detected_penalty`            |
| Security-Policy           | +        | Empire-Policy `SECURITY_STATE` (Level 0–3)       |
| Stability (§6)            | –        | Niedrige Stabilität macht Kolonien angreifbarer  |
| Diplomacy (§7)            | –/+      | Hoher Trust senkt offensiven Erfolg beim Partner |

### 8.4 Operationstypen und Effekte

| Operation               | Erfolgs­voraussetzung              | Effekt bei Erfolg                          | Effekt bei Entdeckung                  |
|-------------------------|-------------------------------------|--------------------------------------------|----------------------------------------|
| `intel_gather`          | `offensive ≥ 20`                    | Offenbart Scores + Top-Ressourcen des Ziels | −5 Trust beim Ziel                    |
| `tech_steal`            | `offensive ≥ 50`, Ziel hat höhere Tech | +1 Tech-Fragment; Forschungsbonus          | −15 Trust; diplomatisches Incident     |
| `sabotage_production`   | `offensive ≥ 40`                    | Zielkolonie: −20 % Produktion für 24 h     | −10 Trust; Situation `espionage_war`  |
| `sow_unrest`            | `offensive ≥ 35`                    | Zielkolonie: −15 Stabilität für 48 h       | −10 Trust; Militärreaktion möglich    |
| `assassinate_leader`    | `offensive ≥ 70`                    | Ziel-NPC-Fraktion: −25 Approval für 7 Tage | Kriegsausbruchsrisiko +30 %           |
| `counter_intel`         | `defensive ≥ 30`                    | Neutralisiert feindliche Operation          | N/A                                    |

### 8.5 Spieleffekte des Spionage-Scores

| Score-Band | Effekt                                                                       |
|------------|------------------------------------------------------------------------------|
| > 75       | Gegnerische Operationen gegen das eigene Reich scheitern mit 80 % Wahrsch.   |
| 50 – 75    | Neutral                                                                      |
| 35 – 50    | Eigene Operationen haben –20 % Erfolgswahrscheinlichkeit                     |
| < 20       | Keine offensiven Operationen möglich; defensiver Score fällt auf 10          |

### 8.6 Vel'Ar-Fraktionsintegration

Die Vel'Ar-Fraktion (Meister der Tarnung und Infiltration, aus `GAMEDESIGN.md`) erhält
eine direkte Spielmechanikverknüpfung:

- **Vel'Ar-Bündnis aktiv**: `espionage_offensive` +20, `espionage_defensive` +10.
- **Vel'Ar-Mission `shadow_network`**: Schaltet `INTELLIGENCE_AGENCY` Tier 3 frei.
- **Vel'Ar-Konflikt**: Gegner erhält `espionage_offensive` +30 gegen das eigene Reich.

### 8.7 Querverflechtungen

- `espionage → military`: Erfolgreiche Sabotage senkt feindliche Fleet Readiness.
- `espionage → economy`: Industriesabotage unterbricht Produktionsketten.
- `espionage → stability`: `sow_unrest` destabilisiert Zielkolonien direkt.
- `espionage → diplomacy`: Entdeckte Operationen senken Trust und können Diplomatic Plays auslösen.

---

## 9. Kategorie-Interaktionsmatrix

Die folgende Matrix zeigt, welche Kategorie (Zeile) welche andere (Spalte) beeinflusst.
`+` = positiver Einfluss, `–` = negativer Einfluss, `·` = kein direkter Einfluss.

|              | Wirtschaft | Militär | Forschung | Wachstum | Stabilität | Diplomatie | Spionage |
|--------------|:----------:|:-------:|:---------:|:--------:|:----------:|:----------:|:--------:|
| **Wirtschaft**   | —      | +       | +         | +        | +          | +          | ·        |
| **Militär**      | –      | —       | ·         | ·        | +          | +          | ·        |
| **Forschung**    | +      | +       | —         | ·        | +          | ·          | +        |
| **Wachstum**     | +      | +       | +         | —        | –/+        | ·          | ·        |
| **Stabilität**   | +      | +       | +         | +        | —          | +          | ·        |
| **Diplomatie**   | +      | +       | ·         | ·        | ·          | —          | –        |
| **Spionage**     | ·      | –(fein.) | +        | ·        | –(fein.)   | –(fein.)   | —        |

*„(fein.)" = betrifft Feind, nicht das eigene Reich*

---

## 10. Scoring-Gewichtung für Siegpfade

Jeder Siegpfad aus §5.3 GDM bevorzugt andere Kategorien:

| Siegpfad            | Primärkategorie | Sekundärkategorien              |
|---------------------|-----------------|---------------------------------|
| Wirtschaftshegemonie | Wirtschaft      | Wachstum, Diplomatie            |
| Wissenschaft         | Forschung       | Wirtschaft, Stabilität          |
| Diplomatischer Sieg  | Diplomatie      | Wirtschaft, Stabilität          |
| Militärische Dominanz| Militär         | Forschung, Wirtschaft           |
| Spionage-Hegemonie   | Spionage        | Forschung, Militär              |

---

## 11. UI-Integration

### 11.1 Empire Status Panel (Overview)

Das bestehende Overview-Widget (§11 GDM) wird um einen **Category Radar** erweitert:

- Sieben-Achsen-Radar-Chart mit Score je Kategorie.
- Farbcodierung: grün (> 65), gelb (35–65), rot (< 35).
- Klick auf Achse öffnet Detailpanel mit Aufschlüsselung.

### 11.2 Colony Window

- Jede Kolonie zeigt ihren Beitrag zu den Kategorien (Tooltip).
- Warnsymbol bei Kolonien, die eine Kategorie kritisch belasten.

### 11.3 Notifications

Kategorie-Schwellwertübergänge (insbesondere < 35) erzeugen Journal-Einträge
(`defineJournalEntry()` in `EventSystem.js`).

---

## 12. API-Erweiterungen

Neue Endpunkte (additiv zu §10 GDM):

```
GET  api/empire.php?action=category_scores
     → { economy, military, research, growth, stability, diplomacy, espionage }

GET  api/empire.php?action=category_breakdown&category=espionage
     → Detailaufschlüsselung mit Eingabefaktoren und Teilscores

POST api/espionage.php?action=launch_operation
     → { op_type, target_user_id, target_colony_id? }

GET  api/espionage.php?action=network_status
     → eigenes Netzwerk + aktive Operationen

GET  api/espionage.php?action=detected_threats
     → erkannte feindliche Operationen der letzten 7 Tage
```

---

## 13. Umsetzungsreihenfolge

| Phase | Inhalt                                         | Aufwand    |
|-------|------------------------------------------------|------------|
| A     | Category-Score-Berechnung in Projection einbauen | 1–2 Tage  |
| B     | Radar-Chart UI im Overview                     | 1 Tag      |
| C     | Espionage-Datenmodell (SQL-Migration)          | 1 Tag      |
| D     | Espionage-Operationen API (`espionage.php`)    | 3–4 Tage  |
| E     | Vel'Ar-Fraktionsintegration (Bonus-Mechanik)   | 1–2 Tage  |
| F     | Siegpfad-Tracking und Endbedingungen           | 2–3 Tage  |

---

## 14. Balancing-Parameter

| Parameter                      | Initialwert | Beschreibung                                  |
|--------------------------------|-------------|-----------------------------------------------|
| `STABILITY_PRODUCTION_FLOOR`   | 0.5         | Minimum-Produktionsfaktor bei stability = 0  |
| `ESPIONAGE_OP_BASE_DURATION_H` | 6           | Basisdauer einer Spionageoperation in Stunden |
| `ESPIONAGE_DETECTION_CHANCE`   | 0.25        | Basisentdeckungswahrscheinlichkeit            |
| `DIPLOMACY_TRUST_DECAY_H`      | 0.5         | Trust-Abfall pro Stunde ohne Interaktion      |
| `GROWTH_POP_DOUBLING_TICKS`    | 720         | Ticks für Verdoppelung bei score = 100        |
| `MILITARY_READINESS_REGEN`     | 2.0         | Readiness-Regen pro Tick bei Vollversorgung   |
| `ECONOMY_ALPHA`                | 0.03        | Preisanpassungsrate (vgl. §6.1 GDM)          |

---

## 15. Definition of Done

Für jede Kategorie gilt implementiert, wenn:

1. Score-Berechnung in `lib/projection_runtime.php` / `scripts/project_user_overview.php`
   läuft und korrekte Werte liefert.
2. `api/empire.php?action=category_scores` valide JSON-Antwort gibt.
3. Schwellwerteffekte in `api/game_engine.php` greifen.
4. Journal-Event bei Kategorieübergang < 35 ausgelöst wird.
5. UI-Radar sichtbar und klickbar ist.
