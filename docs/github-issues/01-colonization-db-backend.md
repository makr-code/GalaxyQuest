# [FEATURE] Kolonisierungssystem – Phase A: Datenbank & Backend

**Labels:** `feature`, `backend`, `database`, `colonization`  
**Milestone:** Kolonisierungssystem v1.0  
**Referenz:** `docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md` – Kapitel 14 & 16

---

## Zusammenfassung

Implementierung des serverseitigen Fundaments des Kolonisierungssystems: Datenbankmigrationen, `ColonizationEngine.php` und alle 14 API-Endpunkte in `api/colonization.php`.

---

## Hintergrund

Das Kolonisierungssystem begrenzt Expansion durch **Empire Sprawl** (Verwaltungskapazität AdminCap = 50 Systeme als Basis) und drei interne **Faction Tensions** (Expansionisten / Konservative / Progressisten). Das bestehende `ColonySimulation.js` bleibt erhalten und wird erweitert – dieses Issue betrifft ausschließlich Backend/DB.

---

## Akzeptanzkriterien

- [ ] `sql/migrate_colonization_v1.sql` erstellt und ausführbar:
  - Tabelle `sectors` (`id`, `name`, `player_id`, `governor_id`, `capital_colony_id`, `autonomy_level INT DEFAULT 0`, `tax_rate DECIMAL(3,2) DEFAULT 1.00`, `approval_rating INT DEFAULT 50`, `created_at`)
  - Tabelle `sector_systems` (`sector_id`, `star_system_id`)
  - Tabelle `governors` (`id`, `player_id`, `npc_id`, `sector_id`, `admin_bonus INT`, `salary INT`, `appointed_at`)
  - Tabelle `empire_edicts` (`id`, `player_id`, `edict_type`, `active BOOL`, `cost_per_tick INT`, `activated_at`)
  - Tabelle `empire_sprawl_cache` (`player_id PK`, `sprawl_value DECIMAL(8,2)`, `admin_cap INT`, `sprawl_pct INT`, `updated_at`)
- [ ] `sql/migrate_colonization_v2.sql` erstellt:
  - `colonies` erweitern: `phase TINYINT DEFAULT 0`, `sector_id INT NULL FK`, `energy_balance INT DEFAULT 0`
- [ ] `lib/ColonizationEngine.php` implementiert:
  - `calcSprawl(int $player_id): float` – berechnet aktuellen Sprawl-Wert nach Formel (`SystemSprawl×1 + ColonySprawl×0.5 + FleetSprawl×0.3`)
  - `calcAdminCap(int $player_id): int` – berechnet AdminCap inkl. Governor-Boni, Gebäude-Boni, Policy-Boni
  - `applySprawlMalus(int $player_id): array` – gibt aktive Malus-Modifikatoren zurück (`resource_output_mult`, `happiness_flat` etc.)
  - `getSprawlStatus(int $player_id): string` – `EFFICIENT|STRAINED|OVERSTRETCHED|CRISIS|DISSOLUTION`
  - `canFoundColony(int $player_id): bool|string` – prüft Sprawl < 180 % AdminCap, Ressourcen (200 Prod + 100 Credits + 50 Food), Survey vorhanden
- [ ] `api/colonization.php` implementiert mit 14 Endpunkten:

  | Action | Methode | Beschreibung |
  |--------|---------|--------------|
  | `found_colony` | POST | Neue Kolonie gründen (Survey-Check, Kosten-Abzug, Sprawl-Update) |
  | `list_colonies` | GET | Alle Kolonien mit Phase, Sektor, Energie-Balance |
  | `colony_detail` | GET | Einzelne Kolonie mit Distrikt-Slots, Strata, Phase |
  | `list_sectors` | GET | Alle Sektoren mit Gouverneur, Autonomie, Approval |
  | `create_sector` | POST | Neuen Sektor erstellen (mind. 3 Systeme) |
  | `assign_governor` | POST | NPC-Gouverneur einem Sektor zuweisen |
  | `set_autonomy` | POST | Sektor-Autonomie setzen (0–100) |
  | `sector_detail` | GET | Sektor-Daten inkl. Subsysteme und Budget |
  | `list_edicts` | GET | Aktive und verfügbare Edikte |
  | `activate_edict` | POST | Edikt aktivieren (Kosten-Check) |
  | `deactivate_edict` | POST | Edikt deaktivieren |
  | `faction_tensions` | GET | Aktuelle Tensions der 3 internen Fraktionen (0–100) |
  | `sprawl_status` | GET | Aktueller Sprawl, AdminCap, Prozent, aktive Malus-Effekte |
  | `vassal_transfer` | POST | System als Vasall übergeben (Sprawl −0.7 pro System) |

- [ ] Sprawl-Tick in `api/game_engine.php` eingebaut:
  - `tickColonies()` ruft `ColonizationEngine::applySprawlMalus()` auf und schreibt in `empire_sprawl_cache`
  - Faction-Tensions-Berechnung (Dissatisfaction − Satisfaction) je Tick
  - Ereignis-Trigger bei Tension > 50, 70, 85, 100
- [ ] PHPUnit-Tests für `ColonizationEngine`:
  - `testCalcSprawlEmpty()` – 0 Systeme → Sprawl 0
  - `testCalcSprawlOvercap()` – 80 Systeme → Sprawl > AdminCap
  - `testCanFoundColonyBlocked()` – Sprawl 181 % → false
  - `testApplySprawlMalus()` – 130 % → `-0.15 resource_output_mult`

---

## Technische Details

### Sprawl-Formel
```
EmpireSprawl = (Anzahl Systeme × 1.0)
             + (Anzahl Kolonien × 0.5)
             + (Anzahl Flotten mit > 5 Schiffen × 0.3)

AdminCap = 50 (Base)
         + Σ Governor.adminBonus  (Level 1→5: +5/+8/+12/+18/+25)
         + Senatskammer × 10
         + Administratives Edikt × 15 (Kosten: 50 Credits/Tick)
         + Forschungsbaum "Galaktische Bürokratie" (+5/+10/+15)
         + Vor'Tak-Rasse: +10 BaseAdminCap
```

### Sprawl-Schwellenwerte
| Sprawl / AdminCap | Status | Hauptmalus |
|---|---|---|
| ≤ 100 % | Effizient | +5 % Forschungsbonus |
| 101–120 % | Angespannt | −5 % Ressourceneffizienz |
| 121–150 % | Überdehnt | −15 % Ressourcen, +10 % Unruhe |
| 151–200 % | Krisenmodus | −30 % Ressourcen, +25 % Unruhe |
| > 200 % | Auflösung droht | −50 % Ressourcen, +50 % Unruhe |

---

## Abhängigkeiten

- Setzt bestehende `colonies`-Tabelle voraus
- Setzt bestehende `npc_factions`-Tabelle voraus (für Governor-NPCs)
- Setzt `lib/projection_runtime.php` voraus (für Sprawl-Cache-Invalidierung)
- Blockiert: Issue #02 (ColonySimulation-Erweiterung), Issue #03 (Frontend)

---

## Estimate

**~2 Wochen** (Backend + DB + Tests)
