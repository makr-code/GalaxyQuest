# [FEATURE] Kampfsystem – Phase K-1+K-2: Strategie-Backend & BattleSimulator-Erweiterungen

**Labels:** `feature`, `backend`, `engine`, `combat`, `war`  
**Milestone:** Kampfsystem v1.0  
**Referenz:** `COMBAT_SYSTEM_DESIGN.md` – Kapitel 2, 3, 5 & 12 Phase K-1+K-2

---

## Zusammenfassung

Implementierung des strategischen Kriegssystems (Kriegserklärung, War Score, Erschöpfung, Friedensverhandlungen) und Erweiterung der bestehenden `BattleSimulator.simulate()`-Engine um Taktik-Modi, Flottenformationen, Spezial-Aktionen und Distanzband-Logik.

---

## Hintergrund

Die bestehende `BattleSimulator.js`-Engine (deterministische Runden, 8 Schiffsklassen, Rapid-Fire, Shield-Regen) bleibt unverändert als Kernmotor erhalten. Dieses Issue fügt neue **Wrapper-Schichten** hinzu, ohne die Kern-Engine zu brechen.

---

## Akzeptanzkriterien – Phase K-1: Strategie-Backend

### `sql/migrate_combat_v1_wars.sql`

- [ ] Tabelle `wars`:
  ```sql
  CREATE TABLE wars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    attacker_id INT NOT NULL,
    defender_id INT NOT NULL,
    status ENUM('ACTIVE','WHITE_PEACE','ATTACKER_WINS','DEFENDER_WINS','STALEMATE') DEFAULT 'ACTIVE',
    attacker_war_score INT DEFAULT 0,
    defender_war_score INT DEFAULT 0,
    attacker_exhaustion DECIMAL(5,2) DEFAULT 0.0,
    defender_exhaustion DECIMAL(5,2) DEFAULT 0.0,
    declared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    INDEX idx_players (attacker_id, defender_id)
  );
  ```
- [ ] Tabelle `war_goals`:
  ```sql
  CREATE TABLE war_goals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    war_id INT NOT NULL,
    player_id INT NOT NULL,
    goal_type ENUM('OCCUPY_SYSTEM','CONQUER_COLONY','HUMILIATE','LIBERATE_COLONY','RESOURCE_CLAIM','DESTROY_FLEET','ENFORCE_TRIBUTE'),
    target_system_id INT NULL,
    target_colony_id INT NULL,
    victory_points INT NOT NULL,
    fulfilled BOOL DEFAULT FALSE,
    fulfilled_at TIMESTAMP NULL
  );
  ```
- [ ] Tabelle `peace_offers`:
  ```sql
  CREATE TABLE peace_offers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    war_id INT NOT NULL,
    from_player_id INT NOT NULL,
    to_player_id INT NOT NULL,
    terms JSON NOT NULL,      -- [{type, system_id?, amount?, duration_ticks?}]
    status ENUM('PENDING','ACCEPTED','REJECTED','EXPIRED') DEFAULT 'PENDING',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

### `config/combat_config.php` (neue Datei)

- [ ] Alle Balancing-Konstanten auslagern:
  ```php
  define('WAR_EXHAUSTION_PASSIVE',      0.5);  // /Tick
  define('WAR_EXHAUSTION_LOST_BATTLE',  5.0);
  define('WAR_EXHAUSTION_LOST_COLONY',  15.0);
  define('WAR_EXHAUSTION_BLOCKADE',     3.0);  // /Tick
  define('WAR_EXHAUSTION_FORCED_PEACE', 100);
  define('WAR_COOLDOWN_TICKS',          30);   // Min-Ticks zwischen zwei Kriegen
  define('WAR_GOAL_MAX',                3);
  define('PEACE_OFFER_EXPIRY_TICKS',    48);
  // ... alle weiteren Konstanten aus COMBAT_SYSTEM_DESIGN.md §11
  ```

### `api/war.php` (neue Datei)

- [ ] `POST action=declare`:
  - Parameter: `target_user_id`, `war_goals: [{goal_type, target_system_id?, target_colony_id?}]`
  - Validierung: Casus-Belli vorhanden (aus `BORDER_INCIDENT|COLONY_RAID|ALLIANCE_CALL|TERRITORIAL_CLAIM|REVENGE_WAR`), max. 3 Kriegsziele, Cooldown-Prüfung
  - Erstellt `wars`-Eintrag + `war_goals`-Einträge
  - EventSystem: `war:declared`-Journal-Eintrag für beide Spieler
- [ ] `POST action=offer_peace`:
  - Parameter: `war_id`, `terms: [{type, ...}]`
  - Validierung: War Score prüft erzwingbare Konditionen (`diff ≥ 50` → Annexion erlaubt etc.)
  - Erstellt `peace_offers`-Eintrag
- [ ] `POST action=respond_peace`:
  - Parameter: `offer_id`, `accept: bool`
  - Bei Annahme: Konditionen ausführen (Systemtransfer, Tribut etc.), `wars.status` setzen
- [ ] `GET action=get_status`:
  - Parameter: `war_id`
  - Gibt aktuellen War Score, Exhaustion, aktive Kriegsziele, Friedensangebote zurück
- [ ] `GET action=list`:
  - Alle aktiven Kriege des Spielers

### War-Exhaustion-Tick in `api/game_engine.php`

- [ ] Passiver Erschöpfungs-Zuwachs (+0.5/Tick) für alle aktiven Kriege
- [ ] Blockade-Erschöpfung wenn feindliche Flotte in eigenem Heimsystem (+3/Tick)
- [ ] Automatischer White-Peace bei Erschöpfung = 100 (beide Seiten):
  - `wars.status = 'WHITE_PEACE'`
  - Journal-Event `war:white_peace`
- [ ] Forced-Peace-Druck bei Erschöpfung 80–99: NPC-Diplomatieevents

---

## Akzeptanzkriterien – Phase K-2: BattleSimulator-Erweiterungen

### Taktik-Modi (`js/engine/game/BattleSimulator.js`)

- [ ] `opts.attackerTactic` / `opts.defenderTactic` Parameter implementieren:
  ```js
  const TACTIC_MODIFIERS = {
    AGGRESSIVE: { damageMult: 1.15, shieldRegenMult: 1.0,  retreatThreshold: 0 },
    BALANCED:   { damageMult: 1.0,  shieldRegenMult: 1.0,  retreatThreshold: 0 },
    DEFENSIVE:  { damageMult: 0.90, shieldRegenMult: 1.10, retreatThreshold: 0 },
    EVASIVE:    { damageMult: 0.85, shieldRegenMult: 1.05, retreatThreshold: 0.5 },
    ESCORT:     { damageMult: 0.90, shieldRegenMult: 1.0,  retreatThreshold: 0, carrierProtect: true },
  };
  ```
- [ ] EVASIVE: Rückzug wenn eigene Schiffe < 50 % der ursprünglichen Anzahl (DRAW-Ergebnis)
- [ ] `BattleReport` um `attackerTactic`, `defenderTactic` erweitern

### Formations-Modifikatoren (`js/engine/game/BattleSimulator.js`)

- [ ] `opts.attackerFormation` / `opts.defenderFormation` Parameter implementieren:
  ```js
  const FORMATION_MODIFIERS = {
    DELTA:       { shieldMult: 1.0,  damageMult: 1.0,  evasionMult: 1.0  },
    WALL:        { shieldMult: 1.20, damageMult: 1.0,  evasionMult: 0.90 },
    PINCER:      { shieldMult: 0.85, damageMult: 1.15, evasionMult: 1.0  },
    SCREEN:      { shieldMult: 1.10, damageMult: 0.90, evasionMult: 1.0, carrierBonus: true },
    SPREAD:      { shieldMult: 1.0,  damageMult: 0.90, evasionMult: 1.20 },
    TORPEDO_RUN: { shieldMult: 0.90, damageMult: 1.0,  rapidFireBomberBonus: 1.30 },
  };
  ```
- [ ] `BattleReport` um `attackerFormation`, `defenderFormation` erweitern

### Spezial-Aktionen (`js/engine/game/BattleSimulator.js`)

- [ ] `opts.attackerSpecialAction` / `opts.defenderSpecialAction` (je 1 pro Kampf):
  ```js
  const SPECIAL_ACTIONS = {
    EMP_BURST:          { requiresResearch: 'EMP_TECH_2', effect: 'disable_shields_1_round' },
    BOARDING_ACTION:    { requiresResearch: 'BOARDING_CAPSULES', effect: 'capture_1_to_3_ships' },
    OVERLOAD_WEAPONS:   { effect: 'damage_mult_1.5_then_cooldown_1_round' },
    EMERGENCY_RETREAT:  { effect: 'retreat_30pct_loss_no_further' },
    SHIELD_OVERCHARGE:  { requiresResearch: 'SHIELD_BOOST', effect: 'shields_doubled_1_round' },
    FIGHTER_WAVE:       { requiresCarrier: true, effect: 'rapid_fire_fighters_plus_20pct' },
  };
  ```
- [ ] Validierung: Nur 1 Spezial-Aktion pro Seite pro Kampf
- [ ] `BattleReport` um `attackerSpecialAction`, `defenderSpecialAction`, Effekt-Log erweitern

### Distanzband-Logik (`js/engine/game/BattleSimulator.js`)

- [ ] `opts.initialDistanceBand` Parameter (default: `MEDIUM`):
  ```js
  const DISTANCE_BANDS = { MELEE: 0, SHORT: 1, MEDIUM: 2, LONG: 3, EXTREME: 4 };
  const RANGE_EFFICIENCY = {
    optimal:  1.00,
    adjacent: 0.80,
    off:      0.50,
  };
  ```
- [ ] Schiffsklasse hat bevorzugte Distanz (z.B. FIGHTER → SHORT, BATTLESHIP → LONG)
- [ ] Schaden-Malus wenn Schiff in falscher Distanz kämpft
- [ ] FTL-Vel'Ar-Stealth: wenn `opts.attackerFtlType === 'VEL_AR'` → +1 Bonusrunde für Angreifer

### Tests

- [ ] `tests/js/battle-simulator-extended.test.js` (neue Datei):
  - `testAggressiveTacticIncreaseDamage()` – AGGRESSIVE → +15 % Schaden
  - `testEvasiveTacticRetreats()` – EVASIVE bei 50 % Verlust → DRAW
  - `testPincerFormationBonus()` – PINCER → +15 % Schaden, −15 % Shield
  - `testEmpBurstDisablesShields()` – EMP_BURST → Schilde 0 für 1 Runde
  - `testOverloadWeapons()` – OVERLOAD → Schaden ×1.5 Runde 1, Cooldown Runde 2
  - `testDistanceBandMalus()` – BATTLESHIP in MELEE → 50 % Schaden-Effizienz
  - `testVelArSteathBonus()` – Vel'Ar-Angreifer → 1 freie Bonusrunde
  - `testExistingTestsStillPass()` – Rückwärtskompatibilität

---

## Abhängigkeiten

- Setzt bestehende `BattleSimulator.js` (8 Schiffsklassen, SHIP_STATS) voraus
- Setzt bestehende `FleetFormation.js` voraus
- Blockiert: Issue #08 (Bodenkampf, Frontend, FX-Integration)

---

## Estimate

**~2 Wochen** (K-1 Backend ~1 Woche + K-2 Engine-Erweiterungen ~1 Woche)
