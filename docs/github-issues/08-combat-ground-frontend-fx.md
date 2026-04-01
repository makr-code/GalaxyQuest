# [FEATURE] Kampfsystem – Phase K-3–K-7: Bodenkampf, Diplomatie, Frontend, FX & Balancing

**Labels:** `feature`, `frontend`, `engine`, `fx`, `combat`, `ui`  
**Milestone:** Kampfsystem v1.0  
**Referenz:** `COMBAT_SYSTEM_DESIGN.md` – Kapitel 4, 6, 8, 9 & 12 Phase K-3–K-7  
**Abhängigkeit:** Issue #07 (Phase K-1+K-2) muss abgeschlossen sein

---

## Zusammenfassung

Vervollständigung des Kampfsystems: Truppengattungen und Fortifikationen im Bodenkampf, Trust/Threat-Diplomatie-Achsen, komplettes Kampf-Frontend (CombatPreviewPanel, WarOverviewPanel), FX-Bridge für visuelle Kampfeffekte und Balancing-Pass.

---

## Akzeptanzkriterien – Phase K-3: Bodenkampf-Erweiterungen

### Truppengattungen (`js/engine/game/ColonySimulation.js`)

- [ ] `TroopType`-Enum einführen:
  ```js
  export const TroopType = { INFANTRY: 'INFANTRY', ARMOR: 'ARMOR', MECH: 'MECH', ORBITAL_DROP: 'ORBITAL_DROP' };
  ```
- [ ] `TROOP_STATS` je Typ:
  ```js
  export const TROOP_STATS = {
    INFANTRY:     { attackValue: 12, defenseValue: 45, cost: 30,  supplyPerTick: 1 },
    ARMOR:        { attackValue: 20, defenseValue: 60, cost: 80,  supplyPerTick: 3 },
    MECH:         { attackValue: 35, defenseValue: 80, cost: 150, supplyPerTick: 5 },
    ORBITAL_DROP: { attackValue: 50, defenseValue: 30, cost: 200, supplyPerTick: 0, singleUse: true },
  };
  ```
- [ ] `Colony.garrison` um `troopType`-Feld erweitern (bisher nur Anzahl)
- [ ] `Colony.garrisonTroops(count, troopType)` / `Colony.ungarrisonTroops()` anpassen
- [ ] `ColonySimulation.invade()` – `opts.attackerTroops: [{type, count}]` statt einfacher Zahl
- [ ] `InvasionReport` um Truppengattungs-Breakdown erweitern

### Fortifikationsstufen (`js/engine/game/ColonySimulation.js`)

- [ ] `FORTIFICATION`-Gebäudetyp mit Stufen 0–4 (in BuildingType-Enum):
  ```js
  FORTIFICATION_L1: { defensePowerBonus: 50,  buildCost: { production: 60, metal: 20  } },
  FORTIFICATION_L2: { defensePowerBonus: 100, buildCost: { production: 120, metal: 50 } },
  FORTIFICATION_L3: { defensePowerBonus: 180, buildCost: { production: 200, metal: 90 } },
  FORTIFICATION_L4: { defensePowerBonus: 280, buildCost: { production: 350, metal: 150 } },
  ```
- [ ] `Colony.defensePower` inkludiert Fortifikations-Level in Berechnung

### Bombardierungs-API (`api/fleet.php`)

- [ ] `POST action=bombard`:
  - Parameter: `fleet_id`, `target_colony_id`, `mode: SURGICAL|HEAVY|CARPET`
  - Modus-Effekte:
    | Modus | Gebäude-Schaden | Pop-Verlust | War-Exhaustion |
    |-------|----------------|------------|---------------|
    | SURGICAL | 5–15 % | 0 % | +2 |
    | HEAVY | 20–35 % | 2–5 % | +5 |
    | CARPET | 40–60 % | 10–20 % | +15 |
  - Flotte muss im gleichen System sein (Distanz-Check)
  - Rückgabe: `BuildingDamageReport`, `PopLoss`, `WarExhaustionGained`
- [ ] Vitest-Tests in `tests/js/colony-invasion-extended.test.js`:
  - `testMechTroopsHigherAttack()` – MECH > INFANTRY Angriffswert
  - `testFortificationBoostDefense()` – L3 Fortifikation +180 defensePower
  - `testSurgicalBombardmentNoPopLoss()` – SURGICAL → 0 % Pop-Verlust

---

## Akzeptanzkriterien – Phase K-4: Diplomatie-System

### Trust/Threat-Achsen (`api/faction_relations.php`)

- [ ] `faction_relations`-Tabelle um Achsen erweitern:
  ```sql
  ALTER TABLE faction_relations
    ADD COLUMN trust_level DECIMAL(5,2) DEFAULT 0.0,  -- 0..100
    ADD COLUMN threat_level DECIMAL(5,2) DEFAULT 0.0, -- 0..100
    ADD COLUMN trust_decay_rate DECIMAL(4,3) DEFAULT 0.5;  -- /Stunde
  ```
- [ ] Trust-Aufbau: Handelsverträge +5, gemeinsame Kriegführung +10, erfolgreiche Diplomatie +3
- [ ] Trust-Verfall: `DIPLOMACY_TRUST_DECAY_H = 0.5` / Stunde ohne Interaktion
- [ ] Threat-Anstieg: Colonization nahe Fraktion +2/System, War-Declaration +25

### Allianz-System (`api/war.php`)

- [ ] `POST action=alliance_request`:
  - Typ: `OFFENSIVE|DEFENSIVE|NON_AGGRESSION`
  - Defensive Allianz: Bei Angriff auf Verbündeten → automatische Kriegserklärung
  - Nicht-Angriffspakt: Keine Kriegserklärung möglich (Cooldown 30 Ticks nach Kündigung)
- [ ] `POST action=leave_alliance` + Cooldown-Logik

### Kriegs-Events (`js/engine/game/EventSystem.js`)

- [ ] Neue Journal-Einträge via `defineJournalEntry()`:
  | ID | Auslöser |
  |----|---------|
  | `war:declared` | Kriegserklärung erhalten/gesendet |
  | `war:white_peace` | Erschöpfung 100 → Waffenstillstand |
  | `war:attacker_wins` | Alle Kriegsziele erfüllt |
  | `war:exhaustion_warning` | Eigene Erschöpfung > 60 |
  | `war:alliance_call` | Verbündeter wird angegriffen |
  | `war:peace_offer_received` | Friedensangebot eingegangen |
- [ ] Vitest-Tests in `tests/js/war-events.test.js`

---

## Akzeptanzkriterien – Phase K-5: Frontend-UI (`js/game.js`)

Alle Komponenten verwenden **GQUI-Fluent-Builder**.

### CombatPreviewPanel

- [ ] Schwebendes Fenster vor einem Kampf (öffnet sich nach `attack`-Aktion):
  - **Flotten-Vergleich**: Eigene vs. feindliche Flotte (Stärke-Balken, Schiffsanzahl je Klasse)
  - **Taktik-Auswahl**: Dropdown (AGGRESSIVE/BALANCED/DEFENSIVE/EVASIVE/ESCORT)
  - **Formations-Auswahl**: Dropdown (DELTA/WALL/PINCER/SCREEN/SPREAD/TORPEDO_RUN)
  - **Spezial-Aktion**: Auswahl (wenn Voraussetzung erfüllt) oder „–" (keine)
  - **Vorschau**: Geschätzter Ausgang basierend auf `BattleSimulator.fleetPower()` (Siegwahrscheinlichkeit in %)
  - Schaltflächen: „Angreifen" | „Abbrechen"
- [ ] POST `api/fleet.php?action=attack` mit Taktik/Formation/SpezialAktion-Parametern

### WarOverviewPanel

- [ ] Tab oder schwebendes Fenster „Aktive Kriege":
  - Für jeden aktiven Krieg: Gegner-Name, War Score (eigener/gegnerischer Balken), Erschöpfungs-Balken
  - Aktive Kriegsziele mit Fortschritts-Indikator (✓/✗ je Ziel)
  - Schaltfläche „Frieden anbieten" (öffnet Friedens-Konditioneneditor)
  - Schaltfläche „Kriegszustand" (Detailansicht: Schlachten-Log, Systeme-Status)
- [ ] Daten via `GET api/war.php?action=list`

### Erweiterter Kampfbericht

- [ ] Bestehenden Kampfbericht um neue Felder erweitern:
  - Taktik + Formation beider Seiten
  - Spezial-Aktionen und ihre Effekte
  - Rundenweise Breakdown (Schäden je Runde, Shield-Status)
  - War-Score-Änderung durch diesen Kampf
  - Kriegserschöpfungs-Änderung

### Bodenkampf-Visualisierung im Colony-Panel

- [ ] Truppengattungs-Anzeige in Colony-Verteidigungsübersicht:
  - Icons je Typ (INFANTRY/ARMOR/MECH) + Anzahl
  - Fortifikations-Level-Anzeige (0–4 Sterne)
- [ ] Bombardierungs-Button im Colony-Panel (nur sichtbar wenn eigene Flotte im System)
- [ ] `api/fleet.php?action=bombard`-Aufruf mit Modus-Auswahl

### `js/api.js` – Neue Aufrufe

- [ ] `API.warDeclare(targetUserId, warGoals)` → POST war.php
- [ ] `API.warOfferPeace(warId, terms)` → POST war.php
- [ ] `API.warRespondPeace(offerId, accept)` → POST war.php
- [ ] `API.warGetStatus(warId)` → GET war.php
- [ ] `API.warList()` → GET war.php

---

## Akzeptanzkriterien – Phase K-6: FX-Integration

### `js/engine/fx/BattleEventBridge.js` (neue Datei)

- [ ] Klasse `BattleEventBridge`:
  ```js
  class BattleEventBridge {
    constructor(combatFX, particleSystem, beamEffect, voxelDebris) {}
    
    // Mapped BattleReport-Events auf FX-Calls
    processReport(report, scene, camera) {
      // Für jeden Kill in report.rounds: VoxelDebris.spawn()
      // Für jeden Hit: BeamEffect (Waffentyp aus ShipClass)
      // Für jede Explosion: GPUParticleSystem-Burst
    }
    
    onBattleEnd(report, systemPosition) {
      // EnvironmentFX.DebrisField nach Kampf im Sternsystem
    }
  }
  ```
- [ ] Export aus `js/engine/index.js`
- [ ] Mapping: BATTLESHIP → schwere Beam-FX, FIGHTER → schnelle Partikel-Salven
- [ ] Vitest-Tests in `tests/js/battle-fx-bridge.test.js`

### EnvironmentFX-Integration (`api/fleet.php` nach Kampf)

- [ ] Nach erfolgreicher Kampf-Abwicklung: `debris_field`-Flag in System-DB setzen
- [ ] Galaxy-Renderer rendert Debris-Feld (bestehendes `EnvironmentFX.DebrisField`) für 60 Ticks

---

## Akzeptanzkriterien – Phase K-7: Balancing & Projektionen

- [ ] `scripts/project_war_snapshots.php`:
  - Nutzt bestehende `projection_runtime.php`-Infrastruktur
  - Snapshots: War Score, Erschöpfung, Kriegsziel-Fortschritt je aktiven Krieg
  - Worker-Args: `--batch`, `--max-seconds`, `--dry-run`
- [ ] Balance-Testläufe: 1000× simulierte Kriege (zufällige Flotten) – Siegwahrscheinlichkeit 40–60 % für ausgeglichene Flotten
- [ ] Balancing-Anpassungen in `config/combat_config.php` nach Testläufen

---

## Estimate

**~2.5 Wochen** (K-3 ~0.5 Woche + K-4 ~0.5 Woche + K-5 ~1 Woche + K-6 ~0.5 Woche + K-7 ~0.5 Woche)
