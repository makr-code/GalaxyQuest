# [FEATURE] Bonus/Malus-System – Phase 1+2: DB, Tier-Logik & API-Erweiterungen

**Labels:** `feature`, `backend`, `database`, `diplomacy`, `bonus-malus`  
**Milestone:** Bonus/Malus-System v1.0  
**Referenz:** `docs/gamedesign/BONUS_MALUS_DESIGN.md` – Kapitel 4, 5, 11 & 13 Phase 1+2

---

## Zusammenfassung

Das Bonus/Malus-System erweitert das bestehende `diplomacy`-Fraktionsstehungs-System (−100…+100) um ein **tier-basiertes Modifier-Modell**. Jede der 11 NPC-Fraktionen aktiviert je nach Reputationswert empire-weite Boni oder Mali. Dieses Issue implementiert das Datenbankfundament, die Tier-Logik im Backend und die API-Erweiterungen.

---

## Hintergrund & Tier-Definition

Die `standing`-Werte der `diplomacy`-Tabelle werden in 5 Tiers eingeteilt:

| Tier | Name | Standing-Bereich | UI-Farbe |
|------|------|-----------------|----------|
| 0 | FEINDSELIG | −100 … −41 | Rot `#c0392b` |
| 1 | KALT | −40 … −11 | Orange `#e67e22` |
| 2 | NEUTRAL | −10 … +20 | Grau `#95a5a6` |
| 3 | VERBÜNDET | +21 … +60 | Grün `#27ae60` |
| 4 | STRATEGISCHER_PARTNER | +61 … +100 | Gold `#f1c40f` |

---

## Akzeptanzkriterien – Phase 1: Datenbankfundament & Tier-Logik

### Migration `sql/migrate_bonus_malus_v1.sql`

- [ ] Neue Tabelle `faction_tier_modifiers`:
  ```sql
  CREATE TABLE faction_tier_modifiers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_code VARCHAR(50) NOT NULL,
    tier TINYINT NOT NULL,           -- 0..4
    modifier_key VARCHAR(60) NOT NULL,
    modifier_value DECIMAL(8,4) NOT NULL,
    modifier_type ENUM('mult','flat') NOT NULL DEFAULT 'mult',
    INDEX idx_faction_tier (faction_code, tier)
  );
  ```
- [ ] `faction_tier_modifiers` befüllen mit Katalogdaten für alle 11 Fraktionen × 5 Tiers (aus Dokument §15)
- [ ] `npc_factions`-Tabelle erweitern:
  ```sql
  ALTER TABLE npc_factions
    ADD COLUMN tier_0_threshold INT DEFAULT -41,
    ADD COLUMN tier_1_threshold INT DEFAULT -11,
    ADD COLUMN tier_2_threshold INT DEFAULT 20,
    ADD COLUMN tier_3_threshold INT DEFAULT 60;
  ```
- [ ] `diplomacy`-Tabelle erweitern:
  ```sql
  ALTER TABLE diplomacy
    ADD COLUMN current_tier TINYINT DEFAULT 2,
    ADD COLUMN tier_changed_at TIMESTAMP NULL,
    ADD COLUMN tier_hysteresis_ticks INT DEFAULT 0;
  ```
- [ ] Neue Modifier-Schlüssel in `user_empire_modifiers` unterstützen (keine Schema-Änderung nötig, nur Dokumentation):
  - `trade_income_mult`, `spy_detection_flat`, `dark_matter_income_flat`, `colony_stability_flat`, `invasion_penalty_mult`, `quest_reward_mult`

### PHP-Hilfsfunktionen (`api/game_engine.php`)

- [ ] `get_reputation_tier(int $player_id, string $faction_code): int` – gibt 0–4 zurück, nutzt `diplomacy.standing` + `npc_factions.tier_*_threshold`
- [ ] `sync_faction_tier_modifiers(int $player_id): void`:
  - Löscht alle `user_empire_modifiers` mit `source_type = 'faction_tier'`
  - Liest `faction_tier_modifiers` für alle Fraktionen × aktuellen Tier des Spielers
  - Schreibt neue Zeilen in `user_empire_modifiers`
  - Aktualisiert `diplomacy.current_tier` + `tier_changed_at` bei Änderung
  - Feuert Journal-Event via `enqueue_projection_dirty()` wenn Tier gewechselt
- [ ] `get_tier_name(int $tier): string` – gibt `FEINDSELIG|KALT|NEUTRAL|VERBÜNDET|STRATEGISCHER_PARTNER` zurück
- [ ] Modifier-Caps in `empire_dynamic_effects()`:
  - `resource_output_mult` nicht unter 0.30 (30 % Minimum)
  - `research_speed_mult` nicht unter 0.40
  - `colony_stability_flat` nicht unter −30

### Tier-Sync in `api/npc_ai.php`

- [ ] Nach jeder Stehungsänderung (`standing`-Update) `sync_faction_tier_modifiers()` aufrufen
- [ ] `attack_on_sight`-Flag für Tier-0-Fraktionen setzen (in `npc_fleet_behavior`-Logik)
- [ ] Hysterese: Tier-0 → Tier-1 benötigt Stehung > −30 (nicht nur > −41) um Tier-0-Ping-Pong zu verhindern

### PHPUnit-Tests

- [ ] `testGetReputationTierBoundaries()` – alle 5 Grenzen korrekt
- [ ] `testSyncModifiersInsertsCorrectRows()` – Tier 3 → korrekte Modifier-Einträge
- [ ] `testSyncModifiersDeletesOldRows()` – Tier-Wechsel bereinigt alte Einträge
- [ ] `testModifierCapsApplied()` – `resource_output_mult` nicht unter 0.30

---

## Akzeptanzkriterien – Phase 2: API-Erweiterungen

### `api/factions.php`

- [ ] `action=list` – Antwort um folgende Felder erweitern:
  ```json
  {
    "faction_code": "vor_tak",
    "standing": 45,
    "current_tier": 3,
    "tier_name": "VERBÜNDET",
    "tier_progress": 0.60,
    "next_tier_threshold": 61,
    "active_modifiers": [
      { "key": "fleet_readiness_mult", "value": 0.08, "type": "mult" },
      { "key": "resource_output_mult", "value": 0.05, "type": "mult" }
    ]
  }
  ```
- [ ] `action=tier_modifiers` (neu):
  - Parameter: `faction_code` (optional, alle Fraktionen wenn weggelassen)
  - Antwort: vollständiger Modifier-Katalog pro Fraktion × Tier
  - Zeigt an, was Spieler bei Tier-Aufstieg gewinnt / bei Tier-Abstieg verliert

### `api/politics.php`

- [ ] `action=status` – Antwort um `faction_pressure_summary` erweitern:
  ```json
  {
    "faction_pressure_summary": {
      "total_pressure": 12.5,
      "dominant_faction": "kryltha",
      "hostile_factions": ["aethernox"],
      "allied_factions": ["vor_tak", "syl_nar"],
      "net_modifier_preview": {
        "resource_output_mult": 0.08,
        "research_speed_mult": -0.03
      }
    }
  }
  ```

### `api/game.php`

- [ ] `action=overview` – Antwort um `faction_pressure_summary` erweitern (selbe Struktur wie oben, kompaktere Form)

### PHPUnit-Tests (API)

- [ ] `testFactionsListIncludesTier()` – Tier + active_modifiers in Antwort vorhanden
- [ ] `testTierModifiersEndpoint()` – Katalog korrekt strukturiert
- [ ] `testPoliticsStatusPressureSummary()` – net_modifier_preview korrekt berechnet

---

## Modifier-Übersicht Tier 0 / Tier 4 (Auszug – vollständig im Designdokument §15)

### Tier 0 – FEINDSELIG (alle Fraktionen)
| Schlüssel | Wert |
|-----------|------|
| `trade_income_mult` | −0.25 |
| `colony_stability_flat` | −8 |
| `spy_detection_flat` | −10 |
| `resource_output_mult` | −0.05 |
| `fleet_readiness_mult` | −0.05 |

### Tier 4 – STRATEGISCHER_PARTNER (Vor'Tak Beispiel)
| Schlüssel | Wert |
|-----------|------|
| `fleet_readiness_mult` | +0.15 |
| `resource_output_mult` | +0.08 |
| `dark_matter_income_flat` | +2 DM/h |
| `spy_detection_flat` | +8 |
| `quest_reward_mult` | +0.20 |

---

## Abhängigkeiten

- Setzt bestehende `diplomacy`-Tabelle und `user_empire_modifiers`-Infrastruktur voraus
- Setzt `npc_factions`-Tabelle voraus
- Blockiert: Issue #05 (Frontend: Tier-Badge, Modifier-Übersicht)

---

## Estimate

**~1.5 Wochen** (DB + PHP-Funktionen + API-Tests)
