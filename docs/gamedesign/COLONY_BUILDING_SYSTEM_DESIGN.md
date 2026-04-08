# 🏗️ GalaxyQuest — Bausystem für Kolonien & Gebäude

## Game Design Dokument (Outline)

**Version:** 1.0  
**Status:** Design-Blueprint — bereit zur Implementierung  
**Stand:** 2026-04-01  
**Bezug:** [GAMEPLAY_DATA_MODEL.md](GAMEPLAY_DATA_MODEL.md) · [GAMEDESIGN.md](GAMEDESIGN.md) · [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md)

---

## Inhaltsverzeichnis

1. [Executive Summary](#1-executive-summary)
2. [Design-Referenzen](#2-design-referenzen)
3. [Kernkonzepte](#3-kernkonzepte)
4. [Distrikt- & Slot-System](#4-distrikt--slot-system)
5. [Gebäude-Katalog (erweitert)](#5-gebäude-katalog-erweitert)
6. [Produktionsketten](#6-produktionsketten)
7. [Arbeitskräfte & Job-Slots](#7-arbeitskräfte--job-slots)
8. [Konstruktions-Queue & Bauzeiten](#8-konstruktions-queue--bauzeiten)
9. [Gebäude-Upgrades & Spezialisierung](#9-gebäude-upgrades--spezialisierung)
10. [Gebäude-Events & Anomalien](#10-gebäude-events--anomalien)
11. [Datenmodell](#11-datenmodell)
12. [API-Design](#12-api-design)
13. [Frontend UI-Design](#13-frontend-ui-design)
14. [Implementierungs-Roadmap](#14-implementierungs-roadmap)
15. [Offene Fragen & Entscheidungen](#15-offene-fragen--entscheidungen)

---

## 1. Executive Summary

Das **GalaxyQuest-Bausystem** wird von einem einfachen Level-basierten Upgrade-Modell zu einem vollständigen, multidimensionalen **Koloniewirtschaftssystem** weiterentwickelt. Inspiration sind:

- **Victoria 3** (Paradox 2022): Produktionsgebäude mit Arbeitskräften, Güterfluss, gesellschaftliche Strata
- **X4: Foundations** (Egosoft 2018): Modulares Stationsbauen, Produktionsketten, freie Konfigurierbarkeit
- **Anno 1800/2205**: Mehrstufige Versorgungsketten, Bevölkerungsbedarfe, Attraktivitäts-Tradeoffs
- **Bestehende GalaxyQuest-Architektur**: 24 PHP-Gebäudetypen, `ColonySimulation.js`, `colony_layout_profile()`, Pop-Jobs, Trade Chains

### Leitprinzipien

| Prinzip | Beschreibung |
|---|---|
| **Sichtbare Kausalität** | Jede Bau-Entscheidung hat klare, nachvollziehbare Auswirkungen auf Produktion, Bevölkerung und Stabilität |
| **Spezialisierung lohnt sich** | Kolonien sollen distinct verschiedene Rollen einnehmen können (Forge World, Agri World, etc.) |
| **Kein Mikro-Overload** | Automation und Governor-Presets verhindern excessive Micromanagement |
| **Inkrementell baubar** | Das neue System erweitert die bestehende Implementierung ohne Breaking Changes |
| **Backend-Autoritär** | Alle Produktionsberechnungen erfolgen server-seitig; Frontend dient nur zur Darstellung und Eingabe |

---

## 2. Design-Referenzen

### 2.1 Victoria 3 — Was wir übernehmen

Victoria 3 modelliert Wirtschaft durch **Produktionsgebäude** (Buildings), die:
- **Arbeitsstellen** (Job Slots) mit bestimmten Pop-Typen besetzen
- **Güter verbrauchen und produzieren** (Input/Output-Tabellen pro Gebäude)
- **Mehrfach auf einer Karte existieren** können (nicht nur Level 1–10, sondern 1–N Instanzen)
- **Automatisch durch den Markt** reguliert werden (Profitabilität bestimmt Ausbau-Richtung)

**Übertragung auf GalaxyQuest:**
- Jedes Gebäude hat eine **Input-Ressourcenliste** (Verbrauch/Tick) und eine **Output-Ressourcenliste** (Produktion/Tick)
- Pop-Job-Slots pro Gebäude (WORKER, SCIENTIST, RULER etc.) bestimmen die Effizienz
- Gebäude können **mehrfach** auf einer Kolonie errichtet werden (statt nur Levels)
- **Workplace Throughput**: Produktion skaliert mit besetzten Job Slots (`occupied / total_slots * output`)

### 2.2 X4: Foundations — Was wir übernehmen

X4 modelliert **Stationsbau** durch:
- **Modulare Stationskomponenten** die frei kombiniert werden (Produktionsmodul + Lagermodul + Wohnmodul)
- **Verbindungslogik**: Produktionsmodule müssen mit Lager und Dock verbunden sein
- **Ressourcen-Self-Sufficiency**: Stationen versuchen, sich durch eigene Produktion zu versorgen
- **Ausbau in Echtzeit**: Bauprozess dauert, Ressourcen werden schrittweise verbraucht

**Übertragung auf GalaxyQuest:**
- **Zonen-basiertes Layout**: Gebäude gehören zu `surface`, `orbital`, `star_orbit` (bereits implementiert via `zone`-Feld)
- **Bau-Ressourcen schrittweise** abgebucht während der Bauzeit (Phasenmodell)
- **Gebäude-Abhängigkeiten**: Bestimmte Gebäude benötigen andere als Voraussetzung (z.B. Shipyard benötigt Metal Storage)
- **Kapazitäts-Kopplung**: Orbital-Gebäude limitiert durch `orbital_slots`; Oberfläche durch `surface_slots`

### 2.3 Abgrenzung — Was wir NICHT übernehmen

| Feature | Grund |
|---|---|
| Victoria 3 Marktpreise (globale Preisbildung) | Zu komplex für Phase 1; wird in GAMEPLAY_DATA_MODEL.md separat beschrieben |
| X4 Echtzeit-3D-Bauansicht | Scope zu groß; UI bleibt listenbasiert |
| Anno Straßennetz & Logistik-Routing | Nicht kompatibel mit Weltraum-Setting |
| MoO3-Style undurchsichtige Automatisierung | Bewusst vermieden (Lernlektion aus GAMEPLAY_DATA_MODEL.md) |

---

## 3. Kernkonzepte

### 3.1 Gebäude vs. Level — Paradigmenwechsel

**Bisheriges Modell (OGame-Stil):**
```
metal_mine Level 1 → Level 2 → Level 3 → ... → Level 15
(ein Gebäudetyp, ein einziger Integerwert pro Kolonie)
```

**Neues Modell (Victoria 3 / Anno-Stil):**
```
metal_mine × 1  (Level 1) → metal_mine × 2 → metal_mine × 3
ODER
metal_mine Level 1 → Level 2 → Level 3  (für einzigartige Spezialgebäude)
```

**Regel:**
- **Extraktions-, Produktions- und Infrastrukturgebäude** → **Mehrfach-Instanzen** (1..N)
- **Einzigartige Gebäude** (Colony HQ, Terraformer, Stargate) → **Level 1–Max** (wie bisher)

Die PHP-Seite verwendet bereits `buildings`-Tabelle mit `(colony_id, type, level)`. Für Mehrfach-Instanzen wird `level` als **Instanz-Zähler** wiederverwendet, oder eine neue Spalte `instances` wird ergänzt.

### 3.2 Bauslots als harte Kapazitätsgrenze

Jede Kolonie hat eine **feste Anzahl Bauslots** je Zone, berechnet durch `colony_layout_profile()`:
- `surface_slots` = abhängig von Planetendurchmesser (bereits implementiert)
- `orbital_slots` = abhängig von Planetendurchmesser (bereits implementiert)
- `star_orbit_slots` = feste 4 Slots pro Sternensystem (neu)

**Slots sind der harte Limit** — kein Gebäude kann gebaut werden, wenn keine freien Slots vorhanden.

### 3.3 Energie als systemweite Ressource

Neu: **Energie-Budget** pro Kolonie. Jedes Gebäude verbraucht Energie. Solar Plant / Fusion Reactor liefern Energie. Unterschuss → **Produktionsmalus**.

```
energy_balance = sum(producer_output) - sum(consumer_demand)
if energy_balance < 0:
    production_factor *= max(0.2, 1 + energy_balance / total_demand)
```

### 3.4 Arbeitskräfte-Bindung

Jedes Gebäude hat **Job Slots** (Anzahl Pops die es beschäftigt). Die Produktion skaliert mit der Auslastung:

```
throughput = (occupied_slots / total_slots) * base_output
```

Ein unbemanntes Gebäude produziert nichts. Pops können **manuell** oder per **Governor-Automatisierung** auf Gebäude verteilt werden.

---

## 4. Distrikt- & Slot-System

### 4.1 Zonen-Übersicht

| Zone | Beschreibung | Slot-Quelle |
|---|---|---|
| `surface` | Bodengebäude (Minen, Farmen, Wohngebäude) | `colony_layout_profile().grid.surface_slots` |
| `orbital` | Orbital-Stationen (Shipyard, Missile Silo) | `colony_layout_profile().grid.orbital_slots` |
| `star_orbit` | Systemweite Installationen (Stargate, Radar) | 4 Slots fix pro System |
| `underground` | Neu: Unterirdische Anlagen (nur bestimmte Planetenklassen) | Abhängig von Geologie-Typ |

### 4.2 Distrikt-Typen (Victoria 3 Inspiration)

Oberflächen-Slots werden in **Distrikt-Kategorien** aufgeteilt (bestehende `class_caps` in `colony_layout_profile()`):

| Distrikt-Klasse | `class_key` | Typische Gebäude | Anteil (Standard) |
|---|---|---|---|
| Industrial | `industrial` | Minen, Fabriken, Raffinerie | 22% |
| Civic | `civic` | Wohnhäuser, Krankenhaus, Schule | 18% |
| Utility | `utility` | Energiewerke, Silos, Tanks | 16% |
| Science | `science` | Labor, Nanite-Fabrik | 12% |
| Military | `military` | Kaserne, Security Post | 12% |
| Orbital | `orbital` | Schiffswerft, Raketen-Silo | 10% |
| **Flex** | `flex` | Jeder Typ | Rest |

**Regel:** Gebäude des Typs `class_key = 'industrial'` belegen nur `industrial`-Slots oder `flex`-Slots. Dies verhindert, dass eine Kolonie nur aus Minen besteht und keine Wohngebäude hat.

### 4.3 Slot-Visualisierung (Frontend)

Das bestehende `layout`-Objekt wird im UI als **Grid** dargestellt:

```
[ cols × rows Grid ]
[⬡][⬡][🌾][🏠][🔬]  ← Slots mit Gebäude-Icons
[🏠][ ][ ][💎][☀]   ← Leere Slots zeigen verfügbare Distrikt-Typen
[🏥][🎓][🤖][ ][ ]
```

Farb-Codierung nach Distrikt-Klasse (Orange=Industrial, Grün=Civic, Blau=Science etc.)

---

## 5. Gebäude-Katalog (erweitert)

### 5.1 Vollständige Gebäude-Tabelle

Die 24 bestehenden Gebäudetypen werden durch **12 neue Typen** ergänzt. Alle Typen sind in `building_definitions()` (PHP) und `BuildingType` (JS) gepflegt.

#### Kategorie: Extraktion (Rohstoffgewinnung)

| Gebäude | `type` | Zone | Slots | Input | Output/h | Job-Slots | Tech-Req. |
|---|---|---|---|---|---|---|---|
| Metal Mine | `metal_mine` | surface | 2 | energy: 20 | metal: 30×level | 2 WORKER | — |
| Crystal Mine | `crystal_mine` | surface | 2 | energy: 15 | crystal: 20×level | 2 WORKER | — |
| Deuterium Synth | `deuterium_synth` | surface | 2 | energy: 30 | deuterium: 10×level | 1 WORKER | — |
| Rare Earth Drill | `rare_earth_drill` | surface | 2 | energy: 25 | rare_earth: 5×level | 2 WORKER | geology_survey |
| **Dark Matter Extractor** ✨ | `dark_matter_extractor` | orbital | 3 | energy: 80 | dark_matter: 2/h | 1 SCIENTIST | dark_energy_tap |
| **Ice Harvester** ✨ | `ice_harvester` | surface | 2 | energy: 15 | deuterium: 8/h, water: 5/h | 1 WORKER | — (nur Ocean/Ice-Planeten) |

#### Kategorie: Energie

| Gebäude | `type` | Zone | Slots | Input | Output/h | Job-Slots | Tech-Req. |
|---|---|---|---|---|---|---|---|
| Solar Plant | `solar_plant` | surface | 2 | — | energy: 20×level | 0 | — |
| Fusion Reactor | `fusion_reactor` | surface | 3 | deuterium: 5/h | energy: 30×level | 1 WORKER | fusion_tech |
| **Antimatter Reactor** ✨ | `antimatter_reactor` | orbital | 3 | rare_earth: 2/h | energy: 120/h | 2 SCIENTIST | antimatter_tech |
| **Dyson Collector** ✨ | `dyson_collector` | star_orbit | 0 | — | energy: 500/h | 3 SCIENTIST | dyson_tech (T4) |

#### Kategorie: Verarbeitung / Industrie

| Gebäude | `type` | Zone | Slots | Input | Output/h | Job-Slots | Tech-Req. |
|---|---|---|---|---|---|---|---|
| Robotics Factory | `robotics_factory` | surface | 3 | energy: 40, metal: 10 | robotics: 5/h | 2 WORKER | robotics |
| **Alloy Foundry** ✨ | `alloy_foundry` | surface | 3 | energy: 50, metal: 15, crystal: 5 | alloys: 8/h | 3 WORKER | metallurgy |
| **Electronics Plant** ✨ | `electronics_plant` | surface | 2 | energy: 30, crystal: 10, rare_earth: 2 | electronics: 5/h | 2 SCIENTIST | electronics_tech |
| **Fuel Refinery** ✨ | `fuel_refinery` | surface | 2 | energy: 20, deuterium: 8 | fuel_cells: 4/h | 1 WORKER | fuel_tech |
| Nanite Factory | `nanite_factory` | surface | 3 | energy: 60, rare_earth: 5 | nanites: 2/h | 2 SCIENTIST | nano_materials |
| **Ship Parts Assembly** ✨ | `ship_parts_assembly` | orbital | 2 | alloys: 5/h, electronics: 3/h | ship_parts: 4/h | 2 WORKER | shipbuilding_tech |

#### Kategorie: Lebensmittel & Bevölkerung

| Gebäude | `type` | Zone | Slots | Input | Output/h | Job-Slots | Tech-Req. |
|---|---|---|---|---|---|---|---|
| Hydroponic Farm | `hydroponic_farm` | surface | 2 | energy: 15, water: 2 | food: 30×level | 2 FARMER | — |
| Food Silo | `food_silo` | surface | 1 | — | food_storage: +5000 | 0 | — |
| Habitat | `habitat` | surface | 2 | energy: 10 | pop_cap: +200 | 0 | — |
| Hospital | `hospital` | surface | 2 | energy: 20, medical_supplies: 2 | happiness: +10, growth: +5% | 1 SCIENTIST | — |
| School | `school` | surface | 2 | energy: 15 | research: +5, literacy: +5% | 2 SCIENTIST | — |
| Security Post | `security_post` | surface | 1 | energy: 10 | stability: +5, unrest: -10% | 1 SOLDIER | — |
| **Entertainment Hub** ✨ | `entertainment_hub` | surface | 2 | energy: 20, luxury_goods: 1 | happiness: +15 | 2 RULER | — |
| **Immigration Center** ✨ | `immigration_center` | surface | 2 | energy: 15, credits: 50/h | pop_growth: +10% | 1 RULER | diplomacy_lv3 |

#### Kategorie: Forschung & Wissenschaft

| Gebäude | `type` | Zone | Slots | Input | Output/h | Job-Slots | Tech-Req. |
|---|---|---|---|---|---|---|---|
| Research Lab | `research_lab` | surface | 2 | energy: 25 | research: 20×level | 3 SCIENTIST | — |
| **Advanced Research Institute** ✨ | `advanced_research_institute` | surface | 3 | energy: 40, electronics: 2 | research: 50/h, anomaly_chance: +2% | 5 SCIENTIST | quantum_computing |
| **Xenobiology Lab** ✨ | `xenobiology_lab` | surface | 2 | energy: 20, exotic_samples: 1 | research: 30/h, faction_standing: +0.1/h | 3 SCIENTIST | xeno_tech |

#### Kategorie: Militär & Verteidigung

| Gebäude | `type` | Zone | Slots | Input | Output/h | Job-Slots | Tech-Req. |
|---|---|---|---|---|---|---|---|
| Security Post | `security_post` | surface | 1 | energy: 10 | stability: +5 | 1 SOLDIER | — |
| Missile Silo | `missile_silo` | orbital | 2 | energy: 40, fuel_cells: 2 | defense_power: +200 | 2 SOLDIER | missile_tech |
| **Ground Defense Battery** ✨ | `ground_defense_battery` | surface | 2 | energy: 30, alloys: 3 | defense_power: +150 | 2 SOLDIER | weapons_tech |
| **Shield Generator** ✨ | `shield_generator` | surface | 3 | energy: 60, electronics: 5 | colony_shield: +500 | 3 SCIENTIST | shield_tech |
| **Planetary Cannon** ✨ | `planetary_cannon` | orbital | 3 | energy: 80, alloys: 10 | defense_power: +500, orbital_strike: true | 2 SOLDIER | heavy_weapons |

#### Kategorie: Infrastruktur & Logistik

| Gebäude | `type` | Zone | Slots | Input | Output/h | Job-Slots | Tech-Req. |
|---|---|---|---|---|---|---|---|
| Shipyard | `shipyard` | orbital | 2 | energy: 50, metal: 20, crystal: 10 | ship_build_speed: +10% | 3 WORKER | — |
| Metal Storage | `metal_storage` | surface | 2 | — | metal_cap: +5000 | 0 | — |
| Crystal Storage | `crystal_storage` | surface | 2 | — | crystal_cap: +5000 | 0 | — |
| Deuterium Tank | `deuterium_tank` | surface | 2 | — | deuterium_cap: +3000 | 0 | — |
| **Logistics Hub** ✨ | `logistics_hub` | surface | 2 | energy: 20 | trade_route_cap: +3, export_bonus: +10% | 1 RULER | logistics_tech |
| **Spaceport (Tier 2)** ✨ | `advanced_spaceport` | orbital | 3 | energy: 40 | credits: +50/h, fleet_capacity: +10 | 2 RULER | — |

#### Kategorie: Sonder-/Einzigartige Gebäude

| Gebäude | `type` | Zone | Slots | Unique? | Beschreibung |
|---|---|---|---|---|---|
| Colony HQ | `colony_hq` | surface | 3 | ✅ | Zentrale Verwaltung; Level 1–5; schaltet Governor frei |
| Terraformer | `terraformer` | surface | 4 | ✅ | Level 1–3; verändert Planetenklasse langfristig |
| Stargate | `stargate` | star_orbit | 0 | ✅ | FTL-Jump-Anker für kompatible Triebwerke |
| Jump Inhibitor | `jump_inhibitor` | star_orbit | 0 | ✅ | Blockiert FTL-Sprünge im System |
| Relay Station | `relay_station` | star_orbit | 0 | ✅ | Verlängert Kommunikationsreichweite |
| Deep Space Radar | `deep_space_radar` | star_orbit | 0 | ✅ | Sensor-Reichweite +5 Systeme |
| **Precursor Vault** ✨ | `precursor_vault` | underground | 0 | ✅ | Nur via Anomalie freischaltbar; einzigartige Boni |
| **Warp Gate (Mega)** ✨ | `warp_gate_mega` | star_orbit | 0 | ✅ | Level 1 only; Syl'Nar-Technologie; Massentransport |

---

## 6. Produktionsketten

### 6.1 Überblick — Tier-Modell

Produktionsketten sind in **3 Tiers** aufgeteilt (analog Victoria 3 / Anno):

```
Tier 1 (Rohstoffe)          Tier 2 (Zwischenprodukte)        Tier 3 (Endprodukte)
─────────────────           ─────────────────────────         ──────────────────────
metal          ──────────→  alloys           ──────────────→  fleet_modules
crystal        ──────────→  electronics      ──────────────→  ship_parts
deuterium      ──────────→  fuel_cells       ──────────────→  (Flottenversorgung)
rare_earth     ──────────→  nanites          ──────────────→  advanced_tech_items
food           ──────────→  medical_supplies ──────────────→  (Bevölkerungsversorgung)
energy         ──────────→  (systemweit)
```

### 6.2 Detaillierte Produktionsketten

#### Kette 1: Rüstungsindustrie
```
Metal Mine → metal
Crystal Mine → crystal
                │
                ▼
        Alloy Foundry (metal × 2 + crystal × 0.5) → alloys
                │
                ▼
        Ship Parts Assembly (alloys × 3 + electronics × 1) → ship_parts
                │
                ▼
        Shipyard (ship_parts verbraucht) → Schiffbau beschleunigt
```

#### Kette 2: Elektronik & High-Tech
```
Crystal Mine → crystal
Rare Earth Drill → rare_earth
                   │
                   ▼
        Electronics Plant (crystal × 2 + rare_earth × 0.5) → electronics
                   │
                   ├──→ Shield Generator (Input)
                   ├──→ Advanced Research Institute (Input)
                   └──→ Ship Parts Assembly (Input)
```

#### Kette 3: Energieversorgung
```
Solar Plant → energy (free, no input)
Fusion Reactor (deuterium × 0.5/h) → energy (high output)
Antimatter Reactor (rare_earth × 0.2/h) → energy (sehr hoch)
Dyson Collector → energy (maximal, nur star_orbit)
                   │
                   ▼
        (Energie versorgt ALLE anderen Gebäude)
        Energiemangel → Production_Factor sinkt
```

#### Kette 4: Bevölkerungsversorgung
```
Hydroponic Farm → food
Food Silo → food_cap erhöhen
                   │
                   ▼
        (food deckt pop_consumption ab)
        
Hospital (medical_supplies × 0.2/h) → happiness, pop_growth
Entertainment Hub (luxury_goods × 0.1/h) → happiness
Immigration Center → pop_growth_bonus
```

#### Kette 5: Militärische Produktionskette
```
Metal Mine → metal
                │
                ▼
        Alloy Foundry → alloys
Deuterium Synth → fuel_cells (via Fuel Refinery)
                │
                ▼
        Missile Silo (alloys + fuel_cells) → defense_power
        Ground Defense Battery (alloys) → defense_power
        Planetary Cannon (alloys + energy) → orbital_strike
```

### 6.3 Ketten-Effizienz-Formel (Backend)

```php
// Produktion eines Verarbeitungsgebäudes
$effective_output = $base_output
    * $throughput_factor        // occupied_slots / total_slots
    * $energy_supply_factor     // min(1.0, energy_balance / energy_demand)
    * $input_supply_factor      // min(1.0, input_stock / input_per_tick)
    * $colony_type_bonus[$type] // ColonyType-Spezialisierung
    * $happiness_factor         // (happiness - 50) / 100 * 0.3 + 1.0
    * $tech_modifier;           // Forschungsboni
```

### 6.4 Bestandskette aus ColonySimulation.js (beibehalten)

Die bestehende JavaScript-Trade-Chain bleibt erhalten:
```javascript
TRADE_CHAIN = [
  { building: 'factory',   from: 'ore',   rate: 2, to: 'metal',     yieldAmt: 1 },
  { building: 'spaceport', from: 'metal', rate: 3, to: 'shipParts', yieldAmt: 1 },
]
```
Diese wird erweitert, um Tier-2/3-Güter zu berücksichtigen.

---

## 7. Arbeitskräfte & Job-Slots

### 7.1 Pop-Job-Zuweisung pro Gebäude

Jedes Gebäude hat eine `job_slots`-Definition mit erforderlichen Job-Typen:

```php
'alloy_foundry' => [
    'job_slots' => [
        ['type' => 'worker',    'count' => 2, 'output_share' => 0.7],
        ['type' => 'scientist', 'count' => 1, 'output_share' => 0.3],
    ],
    'total_slots' => 3,
]
```

### 7.2 Governor-Automatisierung

Der **Colony Governor** (bestehende Leader-Funktion, `colony_hq` aktiviert) kann Jobs automatisch zuweisen:

```
Governor-Preset:
  - MAXIMIZE_PRODUCTION: Alle freien Pops → WORKER → Industrie-Gebäude
  - MAXIMIZE_RESEARCH:   Alle freien Pops → SCIENTIST → Labs
  - MAXIMIZE_HAPPINESS:  Gleiche Verteilung + Entertainment Hub vorranging
  - BALANCED:            Default-Verteilung nach Bevölkerungsbedarf
```

**Frontend:** Governor-Preset auswählbar per Dropdown im Colony-Fenster.  
**Backend:** `POST /api/buildings.php?action=set_governor_preset` speichert Preset; nächster `tick` wendet es an.

### 7.3 Unemployment-Mechanismus

Wenn mehr Pops als Job-Slots vorhanden:
```
unemployed_pops = total_pops - sum(occupied_job_slots)
happiness -= unemployed_pops * 2          // pro unemployed Pop -2 Happiness
unrest += unemployed_pops * 0.5 / size    // Unruhe-Beitrag
```

Lösungen: Mehr Gebäude bauen, Migration via `immigration_center`, oder Bevölkerungswachstum drosseln.

---

## 8. Konstruktions-Queue & Bauzeiten

### 8.1 Queue-Struktur (Backend, bereits vorhanden)

Die bestehende `building_upgrade_queue`-Tabelle wird für neue Gebäude verwendet:

```sql
-- Bestehend (beibehalten):
building_upgrade_queue (
    id, colony_id, building_type, target_level,
    cost_metal, cost_crystal, cost_deuterium,
    duration_secs, queued_at, started_at, eta, status
)
```

**Erweiterung** für neue Güter:
```sql
ALTER TABLE building_upgrade_queue
    ADD COLUMN cost_rare_earth INT DEFAULT 0,
    ADD COLUMN cost_energy_credits INT DEFAULT 0,
    ADD COLUMN build_phase ENUM('planning','foundation','construction','finishing') DEFAULT 'planning';
```

### 8.2 Bauzeit-Formel

```php
function building_build_time_v2(string $type, int $instanceCount, int $robotics, int $nanite): int {
    $base  = BUILDING_BASE_TIME[$type];           // Sekunden, Basis
    $scale = 1.0 + ($instanceCount - 1) * 0.15;  // +15% pro zusätzlicher Instanz (diminishing returns)
    $rob   = max(0, 1 - $robotics * 0.05);        // Robotics reduziert um 5% pro Level
    $nan   = max(0, 1 - $nanite * 0.10);          // Nanite Factory reduziert um 10% pro Level
    return (int)ceil($base * $scale * $rob * $nan);
}
```

### 8.3 Bauressourcen — Schrittweise Abbuchung (X4-Inspiration)

Statt sofortiger Kostenbuchung wird die **Ressourcenentnahme phasenbasiert** vollzogen:

| Phase | Abbuchung | Dauer |
|---|---|---|
| `planning` | 10% der Kosten (Planung + Material-Sicherung) | 0 sek |
| `foundation` | 30% der Kosten | 20% der Bauzeit |
| `construction` | 50% der Kosten | 60% der Bauzeit |
| `finishing` | 10% der Kosten | 20% der Bauzeit |

**Vorteil:** Spieler können früh abbrechen und erhalten größeren Anteil der Ressourcen zurück.  
**Abbruch-Rückerstattung:** Nicht ausgegebene Phase-Kosten + 50% der bereits verbrauchten Kosten.

### 8.4 Gleichzeitige Bau-Queues

| Gebäudetyp | Max. parallele Builds |
|---|---|
| surface (standard) | 2 gleichzeitig |
| orbital | 1 gleichzeitig |
| star_orbit | 1 gleichzeitig (systemweit) |
| Unique Buildings | 1 gleichzeitig |

Colony HQ Level 3+ schaltet **3 parallele surface-Builds** frei.

---

## 9. Gebäude-Upgrades & Spezialisierung

### 9.1 Level-System für Unique Buildings (wie bisher)

Einzigartige Gebäude (Colony HQ, Terraformer, Stargate etc.) behalten das bestehende Level-1..Max-Modell.

**Maximale Levels:**

| Gebäude | Max Level | Besonderheit |
|---|---|---|
| Colony HQ | 5 | Level 3 → +1 Build-Slot; Level 5 → Governor-KI aktiv |
| Terraformer | 3 | Verändert Planetenklasse nach 72h pro Level |
| Shipyard | 10 | Erhöht max. Schiffsklasse buildbar |
| Research Lab | 10 | Forschungsoutput skaliert |

### 9.2 Gebäude-Spezialisierungen (neue Mechanik)

Bestimmte Gebäude können in **eine von zwei Spezialisierungsrichtungen** entwickelt werden (inspiriert von Stellaris Upgrade-Pfaden):

```
Alloy Foundry Level 3+ → Wahl:
  ┌── [A] Heavy Industry Path
  │       +40% alloy output, -20% energy efficiency, +1 WORKER required
  └── [B] Precision Engineering Path
          +20% alloy output, +30% electronics output (synergy), +1 SCIENTIST required
```

**Implementierung:** `building_specialization`-Spalte in `buildings`-Tabelle; 
`POST /api/buildings.php?action=specialize` triggert den Pfad.

### 9.3 Kolonie-Typ-Boni auf Gebäude (bereits vorhanden, erweitert)

Das bestehende `COLONY_TYPE_BONUS`-System (ColonySimulation.js) und die PHP-Colony-Type-Logik werden für neue Gebäude erweitert:

| Colony Type | Neue Boni |
|---|---|
| `industrial` | Alloy Foundry +25% output; Ship Parts Assembly -10% Kosten |
| `agricultural` | Hydroponic Farm +30% output; Immigration Center -20% Bauzeit |
| `research` | Advanced Research Institute +20% output; Electronics Plant -15% Input |
| `military` | Missile Silo +50% defense_power; Shield Generator -25% Energie-Verbrauch |
| `mining` | Alle Extraktionsgebäude +20% output (bestehend, erweitert) |
| `moon` | Nur Militär + Dark Matter Extractor erlaubt (bestehend) |

---

## 10. Gebäude-Events & Anomalien

### 10.1 Gebäude-spezifische Ereignisse

Aufbauend auf dem bestehenden EventSystem.js und `colony_events_tick_global()` (npc_ai.php) werden **gebäudespezifische Events** ergänzt:

| Event | Trigger | Auswirkung | Choices |
|---|---|---|---|
| **Strukturelles Versagen** | Alloy Foundry Level 3+ nach 200h | Output -50% für 2h | [A] Sofortreparatur (50 Metal) · [B] Abwarten (gratis, 4h) |
| **Produktionspanne** | Electronics Plant wenn Input kurz | 3h Ausfall | [A] Notlieferung kaufen (200 Credits) · [B] Queue pausieren |
| **Minen-Kollaps** | Metal Mine Level 8+ (5% Chance/100h) | Mine geschlossen, 5 WORKER arbeitslos | [A] Wiederaufbau (teuer) · [B] Grube versiegeln (+stability) |
| **Energieüberfluss** | energy_balance > 200% Bedarf | Credits oder Dark Matter | Auto-Bonus |
| **Wissenschaftlicher Durchbruch** | Advanced Research Institute + 5 Scientists | Research ×2 für 1h, Anomalie-Chance +10% | Journal-Eintrag |
| **Arbeitskampf** | Happiness < 40 + WORKER > 60% der Jobs | -30% production für 4h | [A] Lohnerhöhung (-100 Credits/h für 12h) · [B] Sicherheitseinsatz (-happiness -10) |

### 10.2 Anomalie-Freischaltungen

Bestimmte Anomalien (bestehend: `anomalies`-Tabelle) können **spezielle Gebäude** freischalten:

| Anomalie | Freischaltung |
|---|---|
| Precursor Ruins | `precursor_vault` baubar |
| Deep Core Vein | Tiefenmine (doppelter Ore-Output) |
| Alien Biome | `xenobiology_lab` baubar |
| Quantum Resonance Field | `antimatter_reactor` -50% Bauzeit |

---

## 11. Datenmodell

### 11.1 SQL — Neue und geänderte Tabellen

#### Migration: `migrate_building_system_v2.sql`

```sql
-- 1. Neue Güter-Tabelle (Tier-2/3 Produkte)
CREATE TABLE IF NOT EXISTS goods (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    key_name    VARCHAR(64) NOT NULL UNIQUE,
    label       VARCHAR(128) NOT NULL,
    tier        TINYINT NOT NULL DEFAULT 1,    -- 1=raw, 2=intermediate, 3=final
    category    VARCHAR(32) NOT NULL,           -- 'metal','electronic','food',etc.
    base_value  INT NOT NULL DEFAULT 10,        -- Credits-Äquivalent
    perishable  TINYINT DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Gebäude-Stockpile für Tier-2/3 Güter (pro Kolonie)
CREATE TABLE IF NOT EXISTS colony_goods_stockpile (
    colony_id   INT NOT NULL,
    goods_key   VARCHAR(64) NOT NULL,
    amount      BIGINT NOT NULL DEFAULT 0,
    cap         BIGINT NOT NULL DEFAULT 10000,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (colony_id, goods_key),
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE
);

-- 3. Gebäude-Spezialisierung
ALTER TABLE buildings
    ADD COLUMN IF NOT EXISTS instances      INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS specialization VARCHAR(32) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS job_config     JSON DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS enabled        TINYINT DEFAULT 1;

-- 4. Erweiterte Build-Queue
ALTER TABLE building_upgrade_queue
    ADD COLUMN IF NOT EXISTS cost_rare_earth  INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS build_phase      ENUM('planning','foundation','construction','finishing') DEFAULT 'planning',
    ADD COLUMN IF NOT EXISTS phase_started_at TIMESTAMP NULL;

-- 5. Governor-Preset pro Kolonie
ALTER TABLE colonies
    ADD COLUMN IF NOT EXISTS governor_preset  VARCHAR(32) DEFAULT 'balanced',
    ADD COLUMN IF NOT EXISTS energy_balance   INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS build_queue_max  TINYINT DEFAULT 2;

-- 6. Gebäude-Job-Belegung (dynamisch pro Tick)
CREATE TABLE IF NOT EXISTS building_job_slots (
    colony_id       INT NOT NULL,
    building_type   VARCHAR(64) NOT NULL,
    building_idx    TINYINT NOT NULL DEFAULT 0,  -- für Mehrfach-Instanzen
    job_type        VARCHAR(32) NOT NULL,
    assigned_pops   INT NOT NULL DEFAULT 0,
    max_slots       INT NOT NULL DEFAULT 1,
    PRIMARY KEY (colony_id, building_type, building_idx, job_type),
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE
);
```

### 11.2 JavaScript — ColonySimulation.js Erweiterungen

Die bestehenden Enums und Konstanten werden erweitert:

```javascript
// Neue BuildingType-Einträge (ergänzend zu bestehenden)
const BuildingType = Object.freeze({
  // ... bestehende ...
  ALLOY_FOUNDRY:              'alloy_foundry',
  ELECTRONICS_PLANT:          'electronics_plant',
  FUEL_REFINERY:              'fuel_refinery',
  SHIP_PARTS_ASSEMBLY:        'ship_parts_assembly',
  DARK_MATTER_EXTRACTOR:      'dark_matter_extractor',
  ANTIMATTER_REACTOR:         'antimatter_reactor',
  GROUND_DEFENSE_BATTERY:     'ground_defense_battery',
  SHIELD_GENERATOR:           'shield_generator',
  PLANETARY_CANNON:           'planetary_cannon',
  LOGISTICS_HUB:              'logistics_hub',
  ENTERTAINMENT_HUB:          'entertainment_hub',
  IMMIGRATION_CENTER:         'immigration_center',
  ADVANCED_RESEARCH_INSTITUTE:'advanced_research_institute',
});

// Neue GoodType-Enum für Tier-2/3 Güter
const GoodType = Object.freeze({
  // Tier 1 (bestehend)
  ORE:             'ore',
  METAL:           'metal',
  CREDITS:         'credits',
  FOOD:            'food',
  RESEARCH:        'research',
  DARK_MATTER:     'darkMatter',
  // Tier 2 (neu)
  ALLOYS:          'alloys',
  ELECTRONICS:     'electronics',
  FUEL_CELLS:      'fuel_cells',
  NANITES:         'nanites',
  MEDICAL_SUPPLIES:'medical_supplies',
  LUXURY_GOODS:    'luxury_goods',
  ROBOTICS:        'robotics',
  // Tier 3 (neu)
  SHIP_PARTS:      'shipParts',  // bestehend, jetzt Tier 3
  FLEET_MODULES:   'fleet_modules',
});

// Gebäude-Definition mit Job-Slots (neu)
const BUILDING_DEF = Object.freeze({
  [BuildingType.ALLOY_FOUNDRY]: {
    buildTime: 8,
    costs:     { production: 80, metal: 40, crystal: 10 },
    inputs:    { energy: 50, metal: 15, crystal: 5 },    // pro Tick
    outputs:   { alloys: 8 },                             // pro Tick
    jobSlots:  { worker: 2, scientist: 1 },
    zone:      'surface',
    classKey:  'industrial',
    unique:    false,
    techReq:   'metallurgy',
  },
  // ... weitere Definitionen
});

// Energy-Balance im Colony-Tick
Colony.prototype._applyEnergyBalance = function() {
  const produced = this._sumBuildingOutput('energy');
  const consumed = this._sumBuildingInput('energy');
  this.energyBalance = produced - consumed;
  this.energyFactor = this.energyBalance >= 0
    ? 1.0
    : Math.max(0.2, 1.0 + this.energyBalance / Math.max(1, consumed));
};
```

### 11.3 PHP-Konfiguration — `building_definitions()` Erweiterung

```php
// Neue Felder in building_definitions():
'alloy_foundry' => [
    'category'    => 'processing',
    'label'       => 'Alloy Foundry',
    'icon'        => '⚙️',
    'zone'        => 'surface',
    'footprint'   => 3,
    'class_key'   => 'industrial',
    'unique'      => false,           // neu: Mehrfach-Instanz möglich
    'max_instances' => 8,             // neu: Maximum
    'job_slots'   => ['worker' => 2, 'scientist' => 1],  // neu
    'input'       => ['energy' => 50, 'metal' => 15, 'crystal' => 5],   // neu
    'output'      => ['alloys' => 8],  // neu
    'tech_req'    => 'metallurgy',     // neu
    'specializations' => [             // neu
        'heavy_industry'       => ['output_mult' => 1.4, 'energy_mult' => 1.2],
        'precision_engineering' => ['output_mult' => 1.2, 'electronics_synergy' => 0.3],
    ],
],
```

---

## 12. API-Design

### 12.1 Erweiterte Endpunkte (buildings.php)

```
GET  /api/buildings.php?action=list&colony_id=X
     → Bestehend; wird um 'goods_stockpile', 'energy_balance', 'job_assignments' ergänzt

GET  /api/buildings.php?action=catalog
     → NEU: Vollständiger Gebäude-Katalog (alle Typen, Kosten, Voraussetzungen)
     → Payload: { buildings: [...], goods: [...], chains: [...] }

POST /api/buildings.php?action=build
     → NEU: Baut neue Instanz eines Gebäudes (non-unique Typen)
     → Body: { colony_id, type }
     → Prüft: slot_available, tech_req, resources, unique-constraint

POST /api/buildings.php?action=upgrade
     → Bestehend; funktioniert für unique buildings (Level erhöhen)

POST /api/buildings.php?action=demolish
     → NEU: Reißt Gebäude ab (sofort, 50% Rückerstattung)
     → Body: { colony_id, type, instance_idx? }

POST /api/buildings.php?action=specialize
     → NEU: Wählt Spezialisierungspfad für Gebäude Level 3+
     → Body: { colony_id, type, path }

POST /api/buildings.php?action=assign_jobs
     → NEU: Manuelles Job-Assignment zu Gebäude
     → Body: { colony_id, type, instance_idx, job_assignments: { worker: 2, scientist: 1 } }

POST /api/buildings.php?action=set_governor_preset
     → NEU: Governor-Automatisierungs-Preset setzen
     → Body: { colony_id, preset: 'balanced'|'maximize_production'|'maximize_research'|'maximize_happiness' }

POST /api/buildings.php?action=cancel_build
     → NEU: Laufenden Bau abbrechen
     → Body: { colony_id, queue_id }
     → Rückerstattung nach Phase-Modell
```

### 12.2 Response-Format Beispiel (`action=list`)

```json
{
  "buildings": [
    {
      "type": "alloy_foundry",
      "instances": 2,
      "level": 1,
      "specialization": "heavy_industry",
      "enabled": true,
      "job_assignments": { "worker": 4, "scientist": 1 },
      "throughput": 0.83,
      "current_output": { "alloys": 13 },
      "current_input":  { "energy": 100, "metal": 30, "crystal": 10 },
      "upgrade_end": null,
      "meta": { "zone": "surface", "class_key": "industrial", "icon": "⚙️" }
    }
  ],
  "goods_stockpile": {
    "alloys": 450,
    "electronics": 120,
    "fuel_cells": 80
  },
  "energy_balance": 45,
  "energy_factor": 1.0,
  "job_summary": {
    "total_pops": 18,
    "total_slots": 22,
    "unemployed": 0,
    "occupied": 18
  },
  "planet": { ... },
  "layout": { ... },
  "upgrade_queue": [ ... ]
}
```

---

## 13. Frontend UI-Design

### 13.1 Colony-Fenster — Tab-Struktur

Das bestehende Colony-Fenster (im WM-Floating-Window-Manager) erhält **4 Tabs**:

```
[ 📊 Übersicht ] [ 🏗️ Gebäude ] [ 👥 Bevölkerung ] [ ⚙️ Governor ]
```

#### Tab: Gebäude (Haupt-Redesign)

```
┌─────────────────────────────────────────────────────────────────┐
│  Kolonie: Ignis Prime  [Forge World]   Energie: ⚡ +45 überschuss│
│  Slots: 38/52 belegt   Orbital: 4/8   Queue: [🔨×2] [+Bauen]   │
├─────────────────────────────────────────────────────────────────┤
│  KATEGORIE ▾ Alle   🔍 Filter: [Industrie ▾]                   │
├──────────────────────────────────────────────────────────────────┤
│  ⚙️ Alloy Foundry ×2          ████████░ 83% Auslastung          │
│     Input:  ⚡50 ⬡30 💎10    Output: alloys +13/tick            │
│     Jobs:   👷4/6 🔬1/2      [Spezialisiert: Heavy Industry]    │
│     [▲ Instanz hinzufügen] [⚡ Jobs zuweisen] [🗑️ Abreißen]    │
├──────────────────────────────────────────────────────────────────┤
│  🔬 Research Lab ×1           ████████████ 100%                  │
│     Input: ⚡25               Output: research +20/tick          │
│     Jobs:  🔬3/3              [Tech-Req: —]                      │
│     [▲ Instanz hinzufügen] [⚡ Jobs zuweisen]                    │
├──────────────────────────────────────────────────────────────────┤
│  [+ Neues Gebäude bauen]                                         │
└─────────────────────────────────────────────────────────────────┘
```

#### Neues Gebäude bauen — Sidebar/Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  🏗️ Gebäude auswählen                            [×] Schließen  │
├──────────────────────────────────────────────────────────────────┤
│  ● Extraktionsgebäude   ○ Verarbeitung   ○ Militär   ○ Forschung│
├──────────────────────────────────────────────────────────────────┤
│  [⚙️ Alloy Foundry]                     Slots: 3 (Industrial)   │
│  Kosten: ⬡80 💎40 🔵10   Bauzeit: 8 Ticks                      │
│  Output: alloys +8/tick   Jobs: 👷2 🔬1                         │
│  Voraus: Metallurgy-Forschung ✅                                  │
│  [Bauen →]                                                       │
├──────────────────────────────────────────────────────────────────┤
│  [💎 Electronics Plant]                  Slots: 2 (Industrial)  │
│  Kosten: ⬡60 💎80 💜20   Bauzeit: 6 Ticks                      │
│  Output: electronics +5/tick   Jobs: 👷1 🔬2                    │
│  Voraus: Electronics-Forschung 🔒 (benötigt Level 2)            │
│  [Gesperrt]                                                      │
└─────────────────────────────────────────────────────────────────┘
```

#### Tab: Governor

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️ Governor-KI   [Status: Aktiv — Colony HQ Level 3]           │
├──────────────────────────────────────────────────────────────────┤
│  Preset:                                                         │
│  ○ Balanced (Standard)                                          │
│  ● Maximize Production — Pops priorisiert in Industrie-Slots   │
│  ○ Maximize Research   — Pops priorisiert in Wissenschaft       │
│  ○ Maximize Happiness  — Entertainment Hub + Hospitals zuerst   │
│                                                                  │
│  Automatik-Bauqueue (optional):                                  │
│  ☑ Energie-Defizit → Solar Plant bauen                          │
│  ☑ Food-Defizit → Hydroponic Farm bauen                         │
│  ☐ Fehlende Jobs → Habitat bauen                                │
│                                                                  │
│  [Speichern]                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 13.2 Produktionsketten-Visualizer (neu)

Ein eigenes Panel (Floating Window: **⛓️ Produktionsketten**) zeigt:

```
  ⬡ Metal Mine ──→ [⚙️ Alloy Foundry] ──→ [🛰️ Ship Parts Assembly] ──→ Shipyard
  💎 Crystal Mine ─┘                   └──→ [💎 Electronics Plant] ──→ [🔬 Advanced Lab]
  ⚡ Fusion Reactor ──────────────────────────────(Energie-Bus)────────────────────────→
```

Farbcodierung:
- 🟢 Grün: Kette vollständig versorgt
- 🟡 Gelb: Teilweise versorgt (< 80% Input)
- 🔴 Rot: Kette unterbrochen (0% Input oder Gebäude fehlt)

### 13.3 GQUI-Integration

Das UI nutzt den bestehenden **GQUI-Fluent-DOM-Builder** (kein innerHTML):

```javascript
// Beispiel: Gebäude-Karte rendern
function renderBuildingCard(b) {
  return GQUI.div('building-card')
    .append(
      GQUI.span('building-icon').text(b.meta.icon),
      GQUI.strong().text(`${b.meta.label} ×${b.instances}`),
      GQUI.div('throughput-bar').attr('data-pct', b.throughput),
      GQUI.div('io-row')
        .append(renderInputs(b.current_input))
        .append(renderOutputs(b.current_output)),
      GQUI.div('job-row').append(renderJobSlots(b.job_assignments)),
      GQUI.div('actions')
        .append(GQUI.btn('+ Instanz').on('click', () => buildInstance(b.type)))
        .append(GQUI.btn('Jobs').on('click', () => openJobAssign(b)))
    );
}
```

---

## 14. Implementierungs-Roadmap

### Phase B1 — Datenbankfundament (1–2 Tage)

- [ ] `migrate_building_system_v2.sql` erstellen und anwenden
  - Neue Spalten in `buildings` (instances, specialization, job_config, enabled)
  - Neue Tabellen: `goods`, `colony_goods_stockpile`, `building_job_slots`
  - Erweiterung von `building_upgrade_queue` (cost_rare_earth, build_phase)
  - Erweiterung von `colonies` (governor_preset, energy_balance, build_queue_max)
- [ ] `goods`-Tabelle mit Tier-2/3 Gütern befüllen (SQL-Seed)
- [ ] Bestehende Buildings kompatibel halten (keine Breaking Changes)

### Phase B2 — Backend-Kernlogik (3–4 Tage)

- [ ] `building_definitions()` in `game_engine.php` erweitern
  - Neue Felder: `unique`, `max_instances`, `job_slots`, `input`, `output`, `tech_req`, `specializations`
  - 12 neue Gebäudetypen hinzufügen
- [ ] `update_colony_resources()` um Energie-Balance und Tier-2/3-Güter erweitern
- [ ] `buildings.php` neue Endpunkte: `build`, `demolish`, `specialize`, `assign_jobs`, `set_governor_preset`, `cancel_build`
- [ ] Phase-basierte Bauabrechnung in `complete_upgrades()` implementieren
- [ ] Governor-Preset-Logik im Colony-Tick (npc_ai.php / game_engine.php)
- [ ] Produktionsketten-Berechnung: Input-Supply-Factor pro Gebäude

### Phase B3 — Frontend-Kernlogik (3–4 Tage)

- [ ] `ColonySimulation.js` erweitern:
  - Neue BuildingType-Einträge und BUILDING_DEF
  - GoodType-Enum
  - `_applyEnergyBalance()` Methode
  - Job-Slot-Auslastungsberechnung
  - Mehrfach-Instanzen in `buildings`-Map (von `{type: count}` zu `{type: {count, specialization, jobs}}`)
- [ ] `api.js` — Neue API-Methoden: `buildBuilding()`, `demolishBuilding()`, `specializeBuilding()`, `assignJobs()`, `setGovernorPreset()`
- [ ] `game.js` — BuildingsController überarbeiten (GQUI, neue Tab-Struktur)

### Phase B4 — UI-Erweiterungen (2–3 Tage)

- [ ] Gebäude-Grid/Slot-Visualisierung (Colony-Layout-Panel)
- [ ] Produktionsketten-Visualizer (neues Floating Window)
- [ ] Governor-Tab im Colony-Fenster
- [ ] Job-Assignment-Dialog (Popup pro Gebäude)
- [ ] Spezialisierungs-Dialog (Upgrade-Pfad-Auswahl)
- [ ] Energie-Balance-Anzeige im Colony-Header

### Phase B5 — Gebäude-Events & Anomalien (1–2 Tage)

- [ ] Gebäude-Events in EventSystem.js / `colony_events_tick_global()` ergänzen
- [ ] Anomalie-Freischaltungen für spezielle Gebäude verdrahten

### Phase B6 — Tests & Balance (2–3 Tage)

- [ ] Tests für ColonySimulation.js (neue Methoden + Produktionsketten)
- [ ] Backend-Integration-Tests für neue API-Endpunkte
- [ ] Balance-Pass: Produktionswerte, Bauzeiten, Kosten
- [ ] NPC-Bot-Logik anpassen (npc_player_account_tick): neue Gebäudetypen bauen

**Gesamt-Estimate:** ~12–16 Entwicklertage für vollständige Implementierung aller Phasen.

---

## 15. Offene Fragen & Entscheidungen

| # | Frage | Optionen | Empfehlung |
|---|---|---|---|
| 1 | Mehrfach-Instanzen: `instances`-Spalte vs. `level` als Zähler? | A: Neue Spalte `instances` · B: `level` weiter nutzen | **A** — klarer semantisch, weniger Regressions-Risiko |
| 2 | Güter-Stockpile: separate Tabelle oder JSON in `colonies`? | A: `colony_goods_stockpile` · B: `goods_stockpile` JSON-Spalte | **A** — SQL-fähig für Queries; B für späte Phase als Cache-Layer |
| 3 | Energie als Sofort-Constraint oder Soft-Malus? | A: Sofort stopp wenn Energie < 0 · B: Produktion-Malus (wie design) | **B** — weniger frustrierend, konsistent mit Hunger/Unrest-Mechanik |
| 4 | Governor-KI: PHP-Server-seitig oder JS-Client-seitig? | A: PHP-Tick · B: JS-Simulation (ColonySimulation.js) | **A** — persistente Entscheidungen müssen server-autorisiert sein |
| 5 | Spezialisierungen: sofort wählen oder als Forschung? | A: Sofort per Button · B: Eigene Forschungs-Technologie nötig | **A für Phase 1**, Forschungs-Gating in Phase 2 ergänzen |
| 6 | Baukosten für neue Güter (alloys, electronics)? | A: Nur klassische Ressourcen (metal/crystal/deut) · B: Tier-2-Güter als Baukosten | **A für Phase B1/B2**; Tier-2-Güter in Baukosten ab Phase B4 |
| 7 | Wie werden `underground`-Slots auf UI dargestellt? | A: Eigener Tab · B: Filter in bestehendem Gebäude-Tab | **B** — weniger UI-Komplexität |
| 8 | Balancing von Energie-System: Startwert neuer Kolonien? | Solar Plant Level 2 as Default · oder nur Level 1 | **Level 1 Solar + 1 Fusion Reactor** für neue Kolonien |

---

## Anhang A — Neue Ressourcen-Typen (Übersicht)

| Ressource | Tier | Produziert von | Verbraucht von | Storage |
|---|---|---|---|---|
| `alloys` | 2 | Alloy Foundry | Ship Parts Assembly, Ground Defense Battery | `colony_goods_stockpile` |
| `electronics` | 2 | Electronics Plant | Shield Generator, Advanced Research Institute, Ship Parts Assembly | `colony_goods_stockpile` |
| `fuel_cells` | 2 | Fuel Refinery | Missile Silo, fleet maintenance | `colony_goods_stockpile` |
| `nanites` | 2 | Nanite Factory | (passive Bauzeit-Bonus, Terraformer) | `colony_goods_stockpile` |
| `medical_supplies` | 2 | Hospital (produziert + verbraucht) | Hospital | `colony_goods_stockpile` |
| `luxury_goods` | 2 | Handelsnetz/Import | Entertainment Hub | `colony_goods_stockpile` |
| `robotics` | 2 | Robotics Factory | (passive Bauzeit-Bonus) | `colony_goods_stockpile` |
| `fleet_modules` | 3 | Ship Parts Assembly | Shipyard (für Upgrades) | `colony_goods_stockpile` |
| `energy` | — | Solar/Fusion/Antimatter | Alle Gebäude | Kein Storage (Echtzeit-Balance) |
| `water` | 1 | Ice Harvester | Hydroponic Farm | `colony_goods_stockpile` |
| `exotic_samples` | 1 | Anomalie-Event | Xenobiology Lab | `colony_goods_stockpile` |

---

## Anhang B — Gebäude-Tech-Voraussetzungen (Matrix)

| Gebäude | Forschungs-Voraussetzung | Level |
|---|---|---|
| Alloy Foundry | metallurgy _(neu)_ | 1 |
| Electronics Plant | electronics_tech _(neu)_ | 2 |
| Fuel Refinery | fuel_tech _(neu)_ | 1 |
| Ship Parts Assembly | shipbuilding_tech | 1 |
| Dark Matter Extractor | dark_energy_tap | 1 |
| Antimatter Reactor | antimatter_tech _(neu)_ | 3 |
| Dyson Collector | dyson_tech _(neu)_ | 4 |
| Ground Defense Battery | weapons_tech | 2 |
| Shield Generator | shield_tech _(neu)_ | 3 |
| Planetary Cannon | heavy_weapons _(neu)_ | 3 |
| Advanced Research Institute | quantum_computing | 1 |
| Xenobiology Lab | xeno_tech _(neu)_ | 2 |
| Immigration Center | diplomacy | 3 |
| Logistics Hub | logistics_tech | 1 |
| Warp Gate (Mega) | wormhole_theory | 1 |
| Ice Harvester | — _(nur Planet-Typ)_ | — |
| Precursor Vault | — _(nur via Anomalie)_ | — |

---

## Anhang C — Kompatibilität mit bestehender Implementierung

| Bestehend | Kompatibilität | Aktion |
|---|---|---|
| `buildings`-Tabelle mit `(colony_id, type, level)` | ✅ Vollständig kompatibel | Neue Spalten addieren (non-breaking) |
| `building_definitions()` PHP-Funktion | ✅ Erweiterbar | Neue Felder hinzufügen, bestehende bleiben |
| `BuildingType` Enum in ColonySimulation.js | ✅ Erweiterbar | Neue Einträge hinzufügen |
| `BUILDING_COST` in ColonySimulation.js | ✅ Erweiterbar | `BUILDING_DEF` als Superset einführen |
| `colony_layout_profile()` mit `class_caps` | ✅ Direkt genutzt | Slot-Verfügbarkeits-Prüfung daran anhängen |
| `building_upgrade_queue`-Tabelle | ✅ Erweiterbar | Neue Spalten per Migration |
| Trade Chains (Ore→Metal→ShipParts) | ✅ Beibehalten | Tier-2/3-Ketten als Erweiterung |
| Pop-Jobs (FARMER/WORKER/SCIENTIST etc.) | ✅ Beibehalten | Job-Slots pro Gebäude nutzen bestehendes System |
| Colony Events in `colony_events_tick_global()` | ✅ Erweiterbar | Neue Event-Typen hinzufügen |
| GQUI Fluent DOM-Builder | ✅ Genutzt | Frontend-Komponenten in GQUI-Stil implementieren |
| Governor/Leader-System | ✅ Erweiterbar | Governor-Preset als neue Kolonie-Eigenschaft |

---

*Dokument-Ende · GalaxyQuest Bausystem-Design v1.0 · Stand 2026-04-01*
