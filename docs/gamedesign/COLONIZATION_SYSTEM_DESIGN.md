# Kolonisierungssystem – Game Design Dokument

> **GalaxyQuest · Kalytherion-Konvergenz**  
> Version 1.0 · Stand: April 2026  
> Inspirationsquellen: Stellaris, Victoria 3, X4: Foundations, Master of Orion

---

## Inhaltsverzeichnis

1. [Design-Philosophie & Ziele](#1-design-philosophie--ziele)
2. [Empire Sprawl – Imperiumsausdehnung](#2-empire-sprawl--imperiumsausdehnung)
3. [Innere Spannungen (Faction Tensions)](#3-innere-spannungen-faction-tensions)
4. [Sektorsystem](#4-sektorsystem)
5. [Koloniegründung & Wachstumsphasen](#5-koloniegrndung--wachstumsphasen)
6. [Kolonietypen & Spezialisierung](#6-kolonietypen--spezialisierung)
7. [Gebäudesystem & Distrikte](#7-gebudesystem--distrikte)
8. [Bevölkerungssystem](#8-bevlkerungssystem)
9. [Ressourcen & Wirtschaft](#9-ressourcen--wirtschaft)
10. [Gouverneurs- & Verwaltungssystem](#10-gouverneurs---verwaltungssystem)
11. [Edikt- & Politiksystem](#11-edikt---politiksystem)
12. [Ereignissystem (Colony Events)](#12-ereignissystem-colony-events)
13. [Frontend-Implementierung](#13-frontend-implementierung)
14. [Backend-Implementierung](#14-backend-implementierung)
15. [Balancing-Rahmen & Zahlenwerte](#15-balancing-rahmen--zahlenwerte)
16. [Implementierungs-Roadmap](#16-implementierungs-roadmap)

---

## 1. Design-Philosophie & Ziele

### 1.1 Kernziel

Der Spieler soll **im Regelfall 40–60 Sternensysteme** verwalten. Erfahrene Spieler können bis zu 80 Systeme effizient führen, aber oberhalb dieser Grenze greifen spürbare Malus-Mechaniken ein. Das Spiel belohnt **Qualität der Expansion** statt roher Quantität.

> *„Weniger Systeme, besser verwaltet" ist immer stärker als maximale Expansion.*

### 1.2 Inspiration

| Spiel | Übernommene Mechanik |
|-------|---------------------|
| **Stellaris** | Empire Sprawl: Verwaltungskapazität limitiert Expansion; Überausdehnung erzeugt Malus |
| **Victoria 3** | Bevölkerungsschichten (Strata), Fraktions-Approval, Produktionsketten, Gebäude-Slots |
| **X4: Foundations** | Sektoren mit Gouverneuren, autonome Wirtschaft, lokale Märkte |
| **Master of Orion** | Planetentypen, Kolonisierungsschiffe, Spezial-Ressourcen |

### 1.3 Abgrenzung von bestehendem System

Das bestehende `ColonySimulation.js` liefert das solide Fundament:
- **PopJob** (FARMER → RULER), **BuildingType**, **ColonyType**, Invasionssystem, Handelsketten
- Diese bleiben erhalten und werden **erweitert**, nicht ersetzt.

---

## 2. Empire Sprawl – Imperiumsausdehnung

### 2.1 Konzept

**Sprawl** misst die administrative Last des Imperiums. Je mehr Systeme, Kolonien und Bevölkerung, desto höher der Sprawl-Wert. Sobald der Sprawl die **Verwaltungskapazität (AdminCap)** überschreitet, entstehen Empire-weite Malus-Effekte.

### 2.2 Sprawl-Formel

```
EmpireSprawl = Σ(SystemSprawl) + Σ(ColonySprawl) + Σ(FleetSprawl)

SystemSprawl   = Anzahl kontrollierter Systeme × 1.0
ColonySprawl   = Anzahl Kolonien × 0.5
FleetSprawl    = Anzahl Flotten > 5 Schiffe × 0.3

AdminCap       = BaseAdminCap + Σ(Governor.adminBonus) + PolicyBonus
BaseAdminCap   = 50  (Startwert; entspricht ~50 Systemen)
```

**Verwaltungskapazität-Boni (AdminCap-Erhöhungen):**

| Quelle | +AdminCap |
|--------|-----------|
| Gouverneur (Level 1–5) | +5 / +8 / +12 / +18 / +25 |
| Senatskammer-Gebäude | +10 |
| Administratives Edikt | +15 (Kosten: 50 Credits/Tick) |
| Forschungsbaum „Galaktische Bürokratie" | +5 / +10 / +15 pro Stufe |
| Rasse Vor'Tak (disziplinierte Hierarchie) | +10 BaseAdminCap |

### 2.3 Sprawl-Schwellenwerte & Malus-Tabelle

| Sprawl / AdminCap | Status | Effekte |
|-------------------|--------|---------|
| ≤ 100 % | **Effizient** | Kein Malus; +5 % Forschungsbonus |
| 101–120 % | **Angespannt** | −5 % Ressourceneffizienz |
| 121–150 % | **Überdehnt** | −15 % Ressourcen, +10 % Unruhe, Fraktionen unzufriedener |
| 151–200 % | **Krisenmodus** | −30 % Ressourcen, +25 % Unruhe, Rebellionsevents aktiviert |
| > 200 % | **Auflösung droht** | −50 % Ressourcen, +50 % Unruhe, separatistische Kriege möglich |

### 2.4 Sprawl-Reduktion

Spieler können Sprawl senken durch:
- **Systemaufgabe** (`dissolve`-Aktion): Verlust der Kolonie, aber AdminCap-Entlastung
- **Vasallenstaat-Vertrag**: System wird halbautonomem Vasallen übergeben (−0.7 pro System)
- **Sektor-Autonomie erhöhen**: Sektor läuft selbstständig, niedrigerer Sprawl-Beitrag (−0.3 je System im Sektor)
- **Forschung**: Verwaltungseffizienz-Technologien reduzieren `SystemSprawl`-Multiplikator

---

## 3. Innere Spannungen (Faction Tensions)

### 3.1 Konzept

Drei interne Fraktionen bewerten die Politik des Spielers permanent. Unzufriedenheit führt zu konkreten Spielwelt-Konsequenzen und ist die zweite Expansion-Bremse neben Sprawl.

### 3.2 Fraktionen

| Fraktion | Vertritt | Kerninteresse | Auslöser für Unzufriedenheit |
|----------|---------|---------------|------------------------------|
| **Expansionisten** | Militär, Flottenkommandanten, Kolonisatoren | Mehr Systeme, starke Flotte | Zu wenig Expansion, Friedensverträge |
| **Konservative** | Händler, Kolonisten, Handwerker | Stabile Wirtschaft, Sicherheit | Zu hoher Sprawl, Kriege, hohe Steuern |
| **Progressisten** | Wissenschaftler, Reformer, Diplomaten | Forschung, Diplomatie, interne Reform | Vernachlässigung von Forschung, Autokratie |

### 3.3 Tensions-Berechnung

```
FactionTension(f) = MAX(0, Dissatisfaction(f) - Satisfaction(f))

GlobalTension = Σ(FactionTension) / 3

Dissatisfaction wächst durch:
  - Sprawl > AdminCap → +2/Tick pro 10% Überschreitung
  - Hunger/Unruhe in Kolonien → +1/Tick je eskalierter Kolonie
  - Verluste in Schlachten → +1/Tick (Konservative)
  - Lange Kriege ohne Fortschritt → +2/Tick (alle)

Satisfaction wächst durch:
  - Neue Kolonien gegründet → Expansionisten +5
  - Positive Handelsbilanz → Konservative +3/Tick
  - Forschungsdurchbrüche → Progressisten +5
  - Gouverneur mit hoher Popularity
```

### 3.4 Konsequenzen hoher Innerer Spannungen

| GlobalTension | Konsequenz |
|---------------|-----------|
| 30–50 | Protestevents in einzelnen Kolonien |
| 51–70 | Streiks: Fabrik-Output −20 % für 10 Ticks |
| 71–85 | Attentat auf Gouverneur möglich (Random Event) |
| 86–100 | **Bürgerkriegs-Situation**: Rebellionsflotten entstehen |

### 3.5 Entspannungs-Aktionen

- Edikt erlassen, das die unzufriedene Fraktion priorisiert (Kosten in Credits/Einfluss)
- Kolonie-Befestigungen bauen → beruhigt Konservative
- Diplomatie-Mission → beruhigt Progressisten
- Frieden schließen → Spannungen sinken um −15 sofort

---

## 4. Sektorsystem

### 4.1 Konzept (X4-inspiriert)

Systeme werden in **Sektoren** von 8–12 Sternensystemen gruppiert. Jeder Sektor hat:
- Einen zugewiesenen **Gouverneur** (NPC oder Spieler-Delegat)
- Eine **Sektorhauptstadt** (stärkste Kolonie des Sektors)
- Einen **lokalen Haushalt** und **lokale Handelsbilanz**
- Eine **Sektor-Autonomie** (0–100 %), die Sprawl-Kosten senkt, aber Kontrolle reduziert

### 4.2 Sektor-Datenmodell

```
sectors
  id, name, player_id, governor_id
  capital_colony_id
  autonomy_level        -- 0..100
  tax_rate              -- 0..1 (Anteil der Credits, die zum Imperium fließen)
  approval_rating       -- 0..100 (lokale Bevölkerungszufriedenheit)
  created_at

sector_systems
  sector_id, star_system_id
```

### 4.3 Sektorautonomie

| Autonomie | AdminCap-Entlastung | Steuer-Ertrag | Kontrolle |
|-----------|--------------------|--------------|---------| 
| 0 % (Direkte Kontrolle) | −0 % | 100 % | Volle Kontrolle |
| 25 % | −10 % Sprawl | 85 % | Gouverneurs-Edikte möglich |
| 50 % | −20 % Sprawl | 70 % | Lokale Fraktionsevents autonom |
| 75 % | −30 % Sprawl | 55 % | Militär-Anforderungen schwieriger |
| 100 % (Vasall) | −40 % Sprawl | 40 % | Nur Diplomatie/Handel |

---

## 5. Koloniegründung & Wachstumsphasen

### 5.1 Voraussetzungen

1. **Survey abgeschlossen**: Sternensystem muss gescannt sein (bestehende Survey-Mission)
2. **Kolonisierungsschiff** vorhanden (neues Schiffklasse `COLONY_SHIP`)
3. **Ressourcen**: 200 Production + 100 Credits + 50 Food (Koloniegründungskosten)
4. **Sprawl-Check**: Founding blockiert, wenn Sprawl > 180 % AdminCap (harte Grenze)
5. **Planet-Habitabilität**: ≥ 20 % (Bewohnbarkeit; berechnet aus Systemdaten)

### 5.2 Wachstumsphasen

| Phase | Name | Ticks | Merkmale |
|-------|------|-------|----------|
| 0 | **Außenposten** | 0–10 | 1 Pop, nur FARM & MINE baubar, keine Handelswege |
| 1 | **Pionierkolonie** | 11–30 | 2–5 Pops, alle Gebäude-Basistypen, erster Handelszugang |
| 2 | **Kolonie** | 31–80 | 6–15 Pops, Spezialisierung wählbar, Gouverneur zuweisbar |
| 3 | **Stadtkolonie** | 81–200 | 16–30 Pops, Sektor-Hauptstadt möglich, besondere Gebäude |
| 4 | **Metropole** | 201+ | 31+ Pops, maximal 5 Gebäude-Slots erweitert, Kapital-Option |

### 5.3 Kolonisierungsschiff (COLONY_SHIP)

Neuer Schiffstyp in `BattleSimulator` / Shipyard:

```js
// Ergänzung in ShipClass-Enum (BattleSimulator.js)
COLONY_SHIP: 'colony_ship'

SHIP_STATS.colony_ship = {
  hull: 200, shields: 50, weapons: 0, speed: 1.5,
  maintenance: 8,        // Credits/Tick
  cargoCapacity: 500,    // Trägt Kolonie-Starter-Ressourcen
  canColonize: true
}
```

---

## 6. Kolonietypen & Spezialisierung

### 6.1 Bestehende Typen (ColonySimulation.js)

Die bestehenden 6 Typen bleiben erhalten und werden durch **Tier-Boni** erweitert:

| Typ | Kernbonus | Neuer Tier-3-Bonus |
|-----|-----------|-------------------|
| STANDARD | Ausgewogen | +5 % auf alle Yields |
| AGRICULTURAL | +1.5× Food | Kann Food exportieren (Trade Route Priority) |
| INDUSTRIAL | +1.5× Production | Kann Fabrikmodule upgraden |
| RESEARCH | +1.5× Research | +1 Forschungsbreakthrough/50 Ticks |
| MILITARY | +2× Defence | Kann Verstärkungsflotten stationieren |
| MOON | +1.5× Defence, max 5 Pop | Null Unruhe-Malus bei Invasion |

### 6.2 Neue Kolonietypen

| Typ | Hauptbonus | Sprawl-Beitrag | Anforderung |
|-----|-----------|----------------|------------|
| **TRADE_HUB** | +3× Credits, Handelszentrum | 1.5× (hohe Verwaltung) | Phase 3 + Spaceport |
| **FORTRESS** | +3× Defence, Flottenstützpunkt | 0.7× (militärisch effizient) | Phase 2 + Barracks |
| **RESORT** | +2× Bevölkerungszufriedenheit, −10 % GlobalTension | 0.8× | Phase 3, keine Minen |
| **ECOSPHERE** | +2× Food, Fertility-Regeneration | 0.6× (gering verwaltet) | Phase 2, kein FACTORY |

### 6.3 Spezialisierungswahl

Spezialisierung ist ab **Phase 2 (Kolonie)** möglich. Ein Typwechsel kostet:
- 50 Production + 30 Credits
- 10 Ticks Umstellungszeit (reduzierte Produktion −50 %)
- Kann maximal 1× pro 100 Ticks gewechselt werden

---

## 7. Gebäudesystem & Distrikte

### 7.1 Bestehende Gebäude (ColonySimulation.js)

Alle 7 bestehenden Gebäude bleiben erhalten: FARM, MINE, FACTORY, LAB, BARRACKS, SPACEPORT, DARK_MATTER_MINE.

### 7.2 Gebäude-Slots

Kolonien haben **begrenzte Gebäude-Slots** basierend auf Wachstumsphase und Größe:

```
MaxBuildingSlots = Phase × 3 + floor(size / 3)
// Phase 0: 3 Slots, Phase 1: 6, Phase 2: 9, Phase 3: 12, Phase 4: 15
```

### 7.3 Neue Gebäude (Distrikt-System)

Inspiriert von Stellaris-Distrikten: Gebäude gehören zu **Gebäudekategorien** (Distrikte).

#### Basis-Distrikte (je 1 Slot, stapelbar bis 3×)

| Gebäude | Kategorie | Kosten | Ertrag | Anforderung |
|---------|-----------|--------|--------|-------------|
| FARM | Agriculture | 20 Prod, 3 Ticks | +5 Food + 2 Farmer-Jobs | – |
| MINE | Extraction | 30 Prod, 4 Ticks | +4 Ore + 2 Worker-Jobs | – |
| SOLAR_ARRAY | Energy | 25 Prod, 3 Ticks | +3 Energy (neue Ressource) | Phase 1 |
| WATER_PROCESSOR | Agriculture | 30 Prod + 10 Ore, 4 Ticks | −10 % Hunger-Rate | Phase 1 |

#### Industrie-Distrikte

| Gebäude | Kategorie | Kosten | Ertrag | Anforderung |
|---------|-----------|--------|--------|-------------|
| FACTORY | Industry | 50 Prod + 10 Ore, 6 Ticks | Ore→Metal | Phase 1 |
| SHIPYARD_COMPLEX | Industry | 120 Prod + 40 Metal, 12 Ticks | +20 % Schiffbaugeschwindigkeit | Phase 3 + SPACEPORT |
| REFINERY | Industry | 80 Prod + 30 Ore, 8 Ticks | +2× Metal-Konversion | Phase 2 + FACTORY |

#### Wissenschafts-Distrikte

| Gebäude | Kategorie | Kosten | Ertrag | Anforderung |
|---------|-----------|--------|--------|-------------|
| LAB | Science | 40 Prod + 20 Credits, 5 Ticks | +5 Research | – |
| INSTITUTE | Science | 100 Prod + 50 Credits, 10 Ticks | +15 Research + Anomaly-Chance | Phase 3 + 2× LAB |
| XENOBIOLOGY_LAB | Science | 70 Prod + 30 Credits, 7 Ticks | +5 Research + Fertility-Info | Phase 2 + LAB |

#### Verwaltungs- & Civic-Distrikte

| Gebäude | Kategorie | Kosten | Ertrag | Anforderung |
|---------|-----------|--------|--------|-------------|
| BARRACKS | Military | 35 Prod + 10 Credits, 4 Ticks | +4 Defence | – |
| SENATE_CHAMBER | Civic | 80 Prod + 40 Credits, 8 Ticks | +10 AdminCap | Phase 3 |
| PLEASURE_DOME | Civic | 60 Prod + 30 Credits, 6 Ticks | +15 Happiness, −5 Tensions | Phase 2 |
| IMMIGRATION_CENTER | Civic | 50 Prod + 20 Credits, 5 Ticks | +20 % Pop-Growth | Phase 2 |

#### Ressourcen-Spezialgebäude

| Gebäude | Kategorie | Kosten | Ertrag | Anforderung |
|---------|-----------|--------|--------|-------------|
| SPACEPORT | Trade | 80 Prod + 20 Metal, 10 Ticks | +8 Credits, Handelszugang | Phase 1 |
| DARK_MATTER_MINE | Exotic | 100 Prod + 50 Credits, 15 Ticks | +1 Dark Matter | Spezial-Anomalie |
| ORBITAL_STATION | Military | 150 Prod + 60 Metal, 15 Ticks | +8 Defence, Flottenstützpunkt | Phase 3 |

### 7.4 Gebäude-Upgrade-Pfade

```
FARM (Lvl 1) → FARM+ (Lvl 2, Kosten ×1.5, +8 Food) → AGRI_COMPLEX (Lvl 3, +12 Food, +Pop-Growth)
MINE (Lvl 1) → MINE+ (Lvl 2) → DEEP_CORE_MINE (Lvl 3, Ore ×3 aber −10 % Stability)
LAB (Lvl 1) → INSTITUTE (Lvl 3, neues Gebäude, erfordert 2× LAB)
```

### 7.5 Gebäude-Abbruch & Kosten

Bestehend: Abriss gibt 50 % Kosten zurück. Neu: Abriss eines Tier-2/3-Gebäudes kostet zusätzlich −5 Happiness für 20 Ticks.

---

## 8. Bevölkerungssystem

### 8.1 Bestehende PopJobs (ColonySimulation.js)

FARMER, WORKER, SCIENTIST, SOLDIER, RULER, UNEMPLOYED bleiben erhalten.

### 8.2 Neue Bevölkerungsschichten (Strata)

Inspiriert von GAMEPLAY_DATA_MODEL.md und Victoria 3:

| Stratum | Jobs | Bedürfnisse | Auswirkung bei Unzufriedenheit |
|---------|------|-------------|-------------------------------|
| **Unterschicht** | FARMER, WORKER (ungelernt) | Food, Wasser (Basis) | Unruhe steigt schnell |
| **Mittelschicht** | WORKER (gelernt), SCIENTIST | Food + Consumer Goods | Fraktion-Tension +2/Tick |
| **Oberschicht** | RULER, Händler, Gouverneurs-Stab | Luxury Goods | Separatismus-Events |

### 8.3 Bevölkerungswachstum

```
PopGrowthRate = BaseGrowth × FertilityMult × HappinessMult × FoodMult

BaseGrowth    = 0.1 Pop/Tick
FertilityMult = planet.fertility (0.5–2.0)
HappinessMult = colony.happiness (0.3–1.5)
FoodMult      = MIN(1.0, stockpile.food / (pops × 2))
```

### 8.4 Migration

Spieler kann **Umsiedelungsbefehle** erteilen:
- Kosten: 10 Credits + 5 Ticks Reisezeit pro Pop
- Sendet Pop von überbesiedelter Kolonie zu neuer Kolonie
- Begrenzt auf 3 Migration-Aufträge gleichzeitig

### 8.5 Happiness & Stability (bestehende + neue Faktoren)

**Bonus-Quellen:**
- PLEASURE_DOME: +15 Happiness
- Gouverneur mit Civic-Trait: +5 Happiness
- Niedrige Steuern: +10 Happiness
- Kein aktiver Krieg: +5 Happiness

**Malus-Quellen:**
- Sprawl > 150 % AdminCap: −10 Happiness empire-weit
- Hohe GlobalTension (>60): −5 Happiness/Tick
- Invasion (nachher): bestehende INVASION_CONQUEST_PENALTIES
- Steuern > 50 %: −15 Happiness

---

## 9. Ressourcen & Wirtschaft

### 9.1 Ressourcen-Übersicht

| Ressource | Erzeuger | Verbraucher | Neue Funktion |
|-----------|----------|------------|--------------|
| **Food** | FARMER, FARM | Pop-Versorgung | Überschuss → Export-Route |
| **Production** | WORKER, FACTORY | Bauprojekte, Schiffe | – |
| **Research** | SCIENTIST, LAB | Technologien | – |
| **Credits** | RULER, SPACEPORT, Steuern | Gebäudekosten, Gouverneure, Edikte | Neu: Sektor-Budget |
| **Ore** | MINE | FACTORY (→Metal) | – |
| **Metal** | FACTORY (Ore→Metal) | Schiffe, Spaceport | – |
| **Ship Parts** | SPACEPORT (Metal→ShipParts) | Flottenwartung | – |
| **Dark Matter** | DARK_MATTER_MINE | FTL-Upgrades | – |
| **Energy** *(neu)* | SOLAR_ARRAY | INSTITUTE, ORBITAL_STATION | Neue Grundressource |
| **Influence** *(neu)* | RULER, Forschung | Edikte, Diplomatie | Empire-weite Policy-Währung |
| **Luxury Goods** *(neu)* | FACTORY (Metal→Luxury) | Oberschicht-Needs | Happiness +20 für Elite |

### 9.2 Energie als neue Grundressource

```
EnergyBalance = Σ(SOLAR_ARRAY.output) - Σ(EnergyConsumers)
EnergyConsumers: INSTITUTE (+5/Tick), ORBITAL_STATION (+8/Tick), DARK_MATTER_MINE (+3/Tick)

Wenn EnergyBalance < 0: Colony-Output −20 %, Event "Energiemangel" getriggert
```

### 9.3 Einfluss (Influence)

```
InfluenceGain/Tick = (RULERs × 3) + GovernorBonus + DiplomacyBonus
InfluenceCost:
  Edikt erlassen:     20–50 Influence
  Sektor gründen:     30 Influence
  Vasall-Vertrag:     50 Influence
  Fraktions-Appease:  15–40 Influence
```

### 9.4 Empire-weiter Haushalt

```
EmpireBudget:
  Einnahmen: Σ(colony.credits) × (1 - SectorTaxRetention)
  Ausgaben:  Σ(fleet.maintenance) + Σ(governor.salary) + Σ(edicts.cost)
  Saldo:     Einnahmen - Ausgaben

Wenn Saldo < 0 für 5 Ticks: Empire-weiter Debuff −10 % Produktion
```

---

## 10. Gouverneurs- & Verwaltungssystem

### 10.1 Gouverneur-NPC

Jeder Gouverneur ist ein NPC (aus dem bestehenden NPC-System) mit Eigenschaften:

```
Governor:
  id, name, player_id, sector_id (optional)
  admin_bonus:    0–25 (AdminCap-Erhöhung)
  civic_trait:    DEVELOPER | MILITARIST | TRADER | SCHOLAR | CORRUPT
  loyalty:        0–100
  salary:         15 Credits/Tick (Level 3), 25/Tick (Level 5)
  events_chance:  Wahrscheinlichkeit für Gouverneurs-Events
```

**Civic Traits:**

| Trait | Effekt |
|-------|--------|
| DEVELOPER | +15 % Baugeschwindigkeit in Sektor |
| MILITARIST | +10 % Defence, −5 Tensions (Expansionisten) |
| TRADER | +10 % Credits in Sektor |
| SCHOLAR | +10 % Research, +5 Tensions (Progressisten) |
| CORRUPT | −20 % Credits; Risiko: Korruptionsevent |

### 10.2 Gouverneurs-Loyalität

```
Loyalty steigt: Regelmäßige Zahlung, Erfolge, +5/Tick bei >80 % Sektor-Approval
Loyalty sinkt:  Gehaltsausfall, zu hohe Sektor-Steuern, Empire-Krise, −5/Tick bei <30 % Approval

Loyalty < 20: Gouverneur kann "Unabhängigkeitserklärung" triggern (Bürgerkriegs-Situation)
Loyalty < 10: Gouverneur setzt sich ab, AdminCap −Gouverneur.admin_bonus sofort
```

### 10.3 Gouverneur-Zuweisung

- Maximal **1 Gouverneur pro Sektor**
- Unbesetzte Sektoren: AdminCap −5 pauschal
- Gouverneure können manuell oder per NPC-AI zugeteilt werden

---

## 11. Edikt- & Politiksystem

### 11.1 Empire-Edikte (dauerhaft, kündbar)

| Edikt | Kosten/Tick | Effekt | Fraktionsreaktion |
|-------|-------------|--------|-------------------|
| Expansionspolitik | 30 Credits + 20 Inf | −10 % Koloniegründungskosten, +5 SystemSprawl | Expansionisten +10 |
| Stabilisierungspaket | 40 Credits + 25 Inf | −15 GlobalTension, +10 Happiness | Konservative +15 |
| Wissenschaftsförderung | 35 Credits + 20 Inf | +20 % Research empire-weit | Progressisten +15 |
| Mobilmachung | 50 Credits + 30 Inf | +30 % Defence, +20 GlobalTension | Expansionisten +10, Konservative −10 |
| Handelsliberalisierung | 20 Credits + 15 Inf | +15 % Credits aus Handelsrouten | Konservative +8 |
| Dezentralisierung | 60 Inf | −15 % Sprawl empire-weit, −5 % Tax | Alle +5 |

### 11.2 Sofort-Edikte (einmalig, Kosten sofort)

| Edikt | Kosten | Effekt |
|-------|--------|--------|
| Notstandshilfe | 100 Credits | Sofort −30 Hunger in einer Kolonie |
| Militärparade | 50 Credits + 20 Inf | −20 GlobalTension für 20 Ticks |
| Koloniegründungs-Boost | 80 Credits | Nächste Kolonie braucht −50 % Gründungszeit |
| Begnadigung | 30 Inf | Gouverneurs-Loyalität +30 |

---

## 12. Ereignissystem (Colony Events)

### 12.1 Kategorien

Das bestehende `EventSystem.js` (mit Journal, JournalStatus, defineJournalEntry) wird um colony-spezifische Events erweitert.

### 12.2 Expansions-Events (Sprawl-abhängig)

| Event | Trigger | Auswahl A | Auswahl B |
|-------|---------|-----------|-----------|
| **"Überdehnte Versorgungsketten"** | Sprawl > 130 % | +30 Credits/Tick für 20 Ticks (Abhilfe), −10 Production | System-Autonomie +25 % (Sprawl −5 %) |
| **"Separatistische Bewegung"** | Sprawl > 160 %, Tension > 60 | Militär entsenden (Kosten: 50 Credits, Tension +10) | Verhandlungen (Kosten: 40 Inf, Tension −20) |
| **"Gouverneurs-Intrige"** | Loyalty < 25 | Gouverneur absetzen (AdminCap −Governor.bonus) | Bestechung (Kosten: 80 Credits, Loyalty +40) |

### 12.3 Wachstums-Events

| Event | Trigger | Effekt |
|-------|---------|--------|
| **"Pioniergeist"** | Kolonie erreicht Phase 2 | +10 Pops sofort, Happiness +20 für 30 Ticks |
| **"Rohstoff-Entdeckung"** | Zufällig (5 % Chance/100 Ticks), Kolonie Phase 1+ | +2 Ore/Food/Research permanent |
| **"Demografische Explosion"** | Happiness > 80, Food-Überschuss | +30 % Pop-Growth für 30 Ticks |

### 12.4 Krisen-Events (Stellaris Situation-Framework)

Schwere Situations-Ereignisse mit 4 Eskalationsstufen (bestehend: GAMEPLAY_DATA_MODEL.md Situation-Framework):

| Situation | Stufe I | Stufe II | Stufe III | Stufe IV |
|-----------|---------|---------|---------|---------|
| **Großer Hunger** | 1 Kolonie hungert | 3 Kolonien hungern | Empire-weiter Food-Debuff −30 % | Große Migration, Popverlust −20 % |
| **Expansionskrise** | Sprawl > 140 % | Sprawl > 170 %, Tension steigt | Rebellionsflotte entsteht | Sezession einer Kolonie |
| **Korruptionskrise** | 1 korrupter Gouverneur | 3 Gouverneure verdächtig | Credits −30 % empire-weit | Gouverneurs-Aufstand |

---

## 13. Frontend-Implementierung

### 13.1 Neue UI-Komponenten

#### 13.1.1 Empire-Sprawl-Indikator (Header)

Persistenter Status-Banner in der Hauptnavigation:

```js
// Ergänzung in js/game.js – Header-Bereich
class EmpireStatusBar {
  render() {
    const sprawl = this.state.empire.sprawl;
    const adminCap = this.state.empire.adminCap;
    const ratio = sprawl / adminCap;
    const status = ratio <= 1.0 ? 'efficient'
                 : ratio <= 1.2 ? 'strained'
                 : ratio <= 1.5 ? 'overstretched'
                 : 'critical';
    return GQUI.div({ class: `empire-sprawl empire-sprawl--${status}` }, [
      GQUI.span({ class: 'sprawl-label' }, 'Verwaltung:'),
      GQUI.div({ class: 'sprawl-bar' }, [
        GQUI.div({ class: 'sprawl-fill', style: `width:${Math.min(ratio*100,200)}%` })
      ]),
      GQUI.span({ class: 'sprawl-value' }, `${sprawl}/${adminCap}`)
    ]);
  }
}
```

#### 13.1.2 Sektor-Verwaltungs-Panel

Neues Panel im Hauptmenü: Übersicht aller Sektoren mit:
- Sektor-Name, Gouverneur, Autonomie-Regler (Slider 0–100 %)
- Systeme & Kolonien im Sektor
- Sektor-Haushalt (Credits-Einnahmen vs. -Ausgaben)
- Sektor-Approval (Balken)

```js
class SectorManagerController {
  // Nutzt bestehende GQUI-API (js/gq-ui.js)
  render(sectors) { /* ... */ }
  onAutonomyChange(sectorId, value) { API.setSectorAutonomy({sector_id: sectorId, level: value}); }
  onGovernorAssign(sectorId, governorId) { API.assignGovernor({sector_id: sectorId, governor_id: governorId}); }
}
window.GQSectorManagerController = new SectorManagerController();
```

#### 13.1.3 Innere-Spannungs-Panel (Faction Dashboard)

```js
class FactionDashboardController {
  render(factions) {
    return factions.map(f => GQUI.div({ class: 'faction-card' }, [
      GQUI.strong({}, f.name),
      GQUI.div({ class: 'faction-bar' }, [ /* Tension-Bar */ ]),
      GQUI.span({}, `Tension: ${f.tension}/100`),
      GQUI.btn({ onclick: () => this.onAppease(f.id) }, 'Besänftigen')
    ]));
  }
}
window.GQFactionDashboardController = new FactionDashboardController();
```

#### 13.1.4 Erweiterter Colony-View

Bestehender `ColonyViewController` (game.js) erhält neue Tabs:
- **Distrikte**: Gebäude-Slot-Grid (max. 15 Slots), kategorisiert nach Gebäudetyp
- **Bevölkerung**: Strata-Balken, Migration-Button
- **Lage**: Phase-Anzeige, Happiness-/Stability-/Hunger-Gauge

#### 13.1.5 Kolonie-Gründungs-Wizard

Mehrstufiger Modal-Dialog:
1. System auswählen (Karte mit Habitabilitätslayer)
2. Kolonietyp vorwählen
3. Koloniekapazität prüfen (Ressourcen, Sprawl-Vorschau)
4. Kolonisierungsschiff entsenden

### 13.2 WebGPU Colony-Renderer (Erweiterung COLONY_BUILDING_WEBGPU_DESIGN.md)

Der bestehende `ColonyGridRenderer` (Isometric, 30° Elevation) wird erweitert:

- **Distrikt-Zonen**: Farbcodierte Bereiche im Grid (Grün=Agriculture, Grau=Industry, Blau=Science)
- **Phase-Overlay**: Visuelle Unterscheidung der 5 Wachstumsphasen (Outpost → Metropole)
- **Sektor-Karte**: Galaxy-Map-Overlay färbt Sektoren in Spieler-Farben mit Sprawl-Heatmap

### 13.3 Sprawl-Heatmap (Galaxy-Renderer)

```js
// Ergänzung in js/galaxy-renderer-core.js
setColonizationOverlay(sectors, sprawlData) {
  // Pro System: Farbe basierend auf Sprawl-Beitrag
  // Rot = hoher Sprawl, Grün = effizienter Bereich
}
```

---

## 14. Backend-Implementierung

### 14.1 Neue Datenbanktabellen

```sql
-- Migration: migrate_colonization_v1.sql

-- Sektoren
CREATE TABLE sectors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  player_id   INT NOT NULL,
  name        VARCHAR(100) NOT NULL,
  capital_colony_id INT,
  governor_id INT,
  autonomy_level    TINYINT DEFAULT 0,   -- 0..100
  tax_rate          DECIMAL(3,2) DEFAULT 1.00,
  approval_rating   TINYINT DEFAULT 50,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sector_systems (
  sector_id     INT NOT NULL,
  star_system_id INT NOT NULL,
  PRIMARY KEY (sector_id, star_system_id),
  FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE CASCADE
);

-- Gouverneure
CREATE TABLE governors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  player_id   INT NOT NULL,
  sector_id   INT,
  name        VARCHAR(100) NOT NULL,
  admin_bonus TINYINT DEFAULT 5,
  civic_trait VARCHAR(20) DEFAULT 'DEVELOPER',
  loyalty     TINYINT DEFAULT 70,
  salary      INT DEFAULT 15,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE SET NULL
);

-- Empire-Edikte (aktive)
CREATE TABLE empire_edicts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  player_id   INT NOT NULL,
  edict_type  VARCHAR(50) NOT NULL,
  enacted_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  credits_per_tick INT DEFAULT 0,
  influence_per_tick INT DEFAULT 0,
  UNIQUE KEY uniq_player_edict (player_id, edict_type),
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Fraktionsstatus
CREATE TABLE faction_status (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  player_id   INT NOT NULL,
  faction     ENUM('EXPANSIONISTS','CONSERVATIVES','PROGRESSISTS') NOT NULL,
  tension     TINYINT DEFAULT 10,
  satisfaction TINYINT DEFAULT 50,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_player_faction (player_id, faction),
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Empire Sprawl (Cache für schnelle Abfragen)
CREATE TABLE empire_sprawl_cache (
  player_id   INT PRIMARY KEY,
  sprawl      DECIMAL(8,2) DEFAULT 0,
  admin_cap   INT DEFAULT 50,
  ratio       DECIMAL(5,3) DEFAULT 0,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bestehende colonies-Tabelle: Erweiterung
ALTER TABLE colonies
  ADD COLUMN phase           TINYINT DEFAULT 0,
  ADD COLUMN sector_id       INT,
  ADD COLUMN energy_balance  INT DEFAULT 0,
  ADD FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE SET NULL;
```

### 14.2 Neue API-Endpunkte

#### `api/colonization.php`

| Action | Methode | Parameter | Beschreibung |
|--------|---------|-----------|-------------|
| `found_colony` | POST | `star_system_id, colony_type, colony_ship_id` | Neue Kolonie gründen |
| `get_sprawl` | GET | `player_id` | Sprawl + AdminCap abrufen |
| `list_sectors` | GET | – | Alle Sektoren des Spielers |
| `create_sector` | POST | `name, system_ids[]` | Neuen Sektor anlegen |
| `assign_system_to_sector` | POST | `star_system_id, sector_id` | System zu Sektor zuweisen |
| `set_sector_autonomy` | POST | `sector_id, level` | Sektorautonomie setzen |
| `assign_governor` | POST | `sector_id, governor_id` | Gouverneur zuweisen |
| `fire_governor` | POST | `governor_id` | Gouverneur entlassen |
| `enact_edict` | POST | `edict_type` | Edikt erlassen |
| `revoke_edict` | POST | `edict_type` | Edikt aufheben |
| `get_faction_status` | GET | – | Fraktionsstatus abrufen |
| `appease_faction` | POST | `faction, method` | Fraktion besänftigen |
| `migrate_pop` | POST | `from_colony_id, to_colony_id, count` | Population migrieren |

#### Erweiterung `api/game.php`

```php
// Ergänzung: Neues overview-Feld
'empire' => [
  'sprawl'       => $empire->getSprawl(),
  'admin_cap'    => $empire->getAdminCap(),
  'sprawl_ratio' => $empire->getSprawlRatio(),
  'sprawl_status'=> $empire->getSprawlStatus(),  // efficient|strained|overstretched|critical
  'global_tension'=> $empire->getGlobalTension(),
  'faction_status'=> $empire->getFactionStatus(),
]
```

### 14.3 Sprawl-Berechnung (Server-seitig)

```php
// lib/ColonizationEngine.php

class ColonizationEngine {

  public static function calcSprawl(int $playerId): array {
    $systems  = DB::scalar('SELECT COUNT(*) FROM star_systems WHERE owner_id = ?', [$playerId]);
    $colonies = DB::scalar('SELECT COUNT(*) FROM colonies WHERE player_id = ?', [$playerId]);
    $fleets   = DB::scalar('SELECT COUNT(*) FROM fleets WHERE player_id = ? AND ship_count > 5', [$playerId]);

    $sectorAutonomyReduction = DB::scalar(
      'SELECT COALESCE(SUM(s.autonomy_level * 0.004 * COUNT(ss.star_system_id)), 0)
       FROM sectors s JOIN sector_systems ss ON s.id = ss.sector_id
       WHERE s.player_id = ?',
      [$playerId]
    );

    $sprawl = ($systems * 1.0) + ($colonies * 0.5) + ($fleets * 0.3) - $sectorAutonomyReduction;

    $adminCap = self::calcAdminCap($playerId);

    return [
      'sprawl'    => $sprawl,
      'admin_cap' => $adminCap,
      'ratio'     => $sprawl / max(1, $adminCap),
      'status'    => self::sprawlStatus($sprawl / max(1, $adminCap)),
    ];
  }

  public static function calcAdminCap(int $playerId): int {
    $base      = 50;
    $govBonus  = DB::scalar('SELECT COALESCE(SUM(admin_bonus),0) FROM governors WHERE player_id = ? AND sector_id IS NOT NULL', [$playerId]);
    $edictBonus= DB::scalar('SELECT COUNT(*)*15 FROM empire_edicts WHERE player_id = ? AND edict_type = ?', [$playerId, 'ADMINISTRATIVE_EFFICIENCY']);
    $buildings = DB::scalar('SELECT COUNT(*)*10 FROM colony_buildings cb JOIN colonies c ON cb.colony_id = c.id WHERE c.player_id = ? AND cb.building_type = ?', [$playerId, 'SENATE_CHAMBER']);
    // Rassenbonus wird aus player.race_id abgeleitet
    $raceBonus = self::getRaceAdminBonus($playerId);

    return $base + $govBonus + $edictBonus + $buildings + $raceBonus;
  }

  private static function sprawlStatus(float $ratio): string {
    if ($ratio <= 1.0) return 'efficient';
    if ($ratio <= 1.2) return 'strained';
    if ($ratio <= 1.5) return 'overstretched';
    if ($ratio <= 2.0) return 'critical';
    return 'dissolution';
  }

  public static function applySprawlMalus(int $playerId, float $ratio): array {
    // Gibt Malus-Faktoren zurück, die in der Colony-Tick-Berechnung angewandt werden
    if ($ratio <= 1.0) return ['resource_efficiency' => 1.0, 'unrest_modifier' => 1.0, 'research_bonus' => 1.05];
    if ($ratio <= 1.2) return ['resource_efficiency' => 0.95, 'unrest_modifier' => 1.0, 'research_bonus' => 1.0];
    if ($ratio <= 1.5) return ['resource_efficiency' => 0.85, 'unrest_modifier' => 1.1, 'research_bonus' => 1.0];
    if ($ratio <= 2.0) return ['resource_efficiency' => 0.70, 'unrest_modifier' => 1.25, 'research_bonus' => 1.0];
    return ['resource_efficiency' => 0.50, 'unrest_modifier' => 1.50, 'research_bonus' => 1.0];
  }
}
```

### 14.4 Colony-Tick-Integration

```php
// Ergänzung in api/game_engine.php – tick()-Funktion

function tickColonies(int $playerId) {
  $sprawlData = ColonizationEngine::calcSprawl($playerId);
  $malus      = ColonizationEngine::applySprawlMalus($playerId, $sprawlData['ratio']);

  foreach (getPlayerColonies($playerId) as $colony) {
    $yield = $colony->computeYield();
    // Sprawl-Malus auf Ressourcen anwenden
    $yield['production'] *= $malus['resource_efficiency'];
    $yield['food']       *= $malus['resource_efficiency'];
    $yield['research']   *= $malus['resource_efficiency'];
    $colony->unrest      *= $malus['unrest_modifier'];
    // ... Colony-Tick fortsetzen
  }

  // Sprawl-Cache aktualisieren
  DB::execute(
    'INSERT INTO empire_sprawl_cache (player_id, sprawl, admin_cap, ratio) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE sprawl=VALUES(sprawl), admin_cap=VALUES(admin_cap), ratio=VALUES(ratio)',
    [$playerId, $sprawlData['sprawl'], $sprawlData['admin_cap'], $sprawlData['ratio']]
  );
}
```

### 14.5 Migration-Dateien

```
sql/migrate_colonization_v1.sql     -- Neue Tabellen (sectors, governors, empire_edicts, faction_status, empire_sprawl_cache)
sql/migrate_colonization_v2.sql     -- colonies: ADD COLUMN phase, sector_id, energy_balance
```

---

## 15. Balancing-Rahmen & Zahlenwerte

### 15.1 Sweet-Spot-Kalibrierung

| Szenario | Systeme | Sprawl | AdminCap | Ratio | Status |
|---------|---------|--------|----------|-------|--------|
| Anfangsspiel | 10 | 12 | 50 | 0.24 | Effizient |
| Mittleres Spiel | 30 | 38 | 55 | 0.69 | Effizient |
| **Optimum** | **50** | **60** | **65** | **0.92** | **Effizient (+5 % Research)** |
| Überausdehnung | 70 | 88 | 70 | 1.26 | Angespannt (−5 % Ressourcen) |
| Krise | 90 | 112 | 75 | 1.49 | Überdehnt (−15 %) |
| Kollaps | 120 | 148 | 80 | 1.85 | Kritisch (−30 %) |

*AdminCap wächst durch Gouverneure und Forschung; die Tabelle zeigt einen Durchschnittsspieler ohne intensive AdminCap-Optimierung.*

### 15.2 Spannungs-Kalibrierung

Ziel: Bei optimalem Spiel (50 Systeme) sollte GlobalTension um **20–35** pendeln (entspanntes Spiel). Eskalation zu > 60 sollte Spieler-Fehler oder externe Schocks erfordern.

| Zustand | GlobalTension | Einfluss auf Gameplay |
|---------|--------------|----------------------|
| Entspannt | 0–20 | Kein Einfluss; Forschungsbonus möglich |
| Normal | 21–40 | Gelegentliche Protest-Events |
| Angespannt | 41–60 | Streiks, Fraktion-Edikte teurer |
| Krise | 61–80 | Attentat-Events, Rebellionsflotten-Warnung |
| Bürgerkrieg | 81–100 | Aktive Rebellionsflotten; Sezessions-Situation |

### 15.3 Koloniegründungs-Kosten-Kurve

Jede weitere Kolonie kostet progressiv mehr:

```
ColonyCost(n) = BASE_COST × (1 + n × COST_SCALING)
BASE_COST    = 200 Production + 100 Credits + 50 Food
COST_SCALING = 0.05  (5 % Aufschlag pro existierender Kolonie)

Beispiel:
  1. Kolonie: 200 Production + 100 Credits + 50 Food
  25. Kolonie: 400 Production + 200 Credits + 100 Food  (+100%)
  50. Kolonie: 700 Production + 350 Credits + 175 Food  (+250%)
```

Diese Kurve stellt sicher, dass massive Expansion wirtschaftlich unattraktiv wird.

### 15.4 Wichtigste Tuning-Parameter

```js
// config/colonization_config.js
export const COLONIZATION_CONFIG = {
  BASE_ADMIN_CAP:           50,
  SYSTEM_SPRAWL_VALUE:       1.0,
  COLONY_SPRAWL_VALUE:       0.5,
  FLEET_SPRAWL_VALUE:        0.3,
  SPRAWL_STRAINED_THRESHOLD: 1.2,   // 120 %
  SPRAWL_CRISIS_THRESHOLD:   1.5,   // 150 %
  SPRAWL_CRITICAL_THRESHOLD: 2.0,   // 200 %

  BASE_COLONY_COST_PRODUCTION: 200,
  BASE_COLONY_COST_CREDITS:    100,
  BASE_COLONY_COST_FOOD:        50,
  COLONY_COST_SCALING:          0.05,

  COLONY_FOUNDING_BLOCKED_RATIO: 1.8,  // Blockiert bei >180 % AdminCap

  TENSION_PROTEST_THRESHOLD:   30,
  TENSION_STRIKE_THRESHOLD:    51,
  TENSION_CIVIL_WAR_THRESHOLD: 86,

  GOVERNOR_BASE_SALARY:       15,
  MIGRATION_POP_COST_CREDITS:  10,
  MAX_CONCURRENT_MIGRATIONS:    3,
};
```

---

## 16. Implementierungs-Roadmap

### Phase A – Datenmodell & Backend (2 Wochen)

- [ ] `migrate_colonization_v1.sql` (sectors, governors, empire_edicts, faction_status, empire_sprawl_cache)
- [ ] `migrate_colonization_v2.sql` (colonies erweitern: phase, sector_id, energy_balance)
- [ ] `lib/ColonizationEngine.php` (Sprawl-Berechnung, AdminCap, Malus-Anwendung)
- [ ] `api/colonization.php` (14 Endpunkte: found_colony, sectors, governors, edicts, factions)
- [ ] Sprawl-Integration in `api/game_engine.php` tick()-Funktion
- [ ] Unit-Tests für ColonizationEngine (PHPUnit)

### Phase B – Colony-Kern & Buildings (1.5 Wochen)

- [ ] `js/engine/game/ColonySimulation.js` erweitern: Energy-Ressource, Strata, Phase-System, neue BuildingTypes (SOLAR_ARRAY, INSTITUTE, SENATE_CHAMBER, PLEASURE_DOME, etc.)
- [ ] `COLONIZATION_CONFIG` als zentrales Config-Objekt einführen
- [ ] Sprawl-Malus in `ColonySimulation.tick()` einbauen
- [ ] Vitest-Tests für neue Colony-Mechaniken erweitern
- [ ] COLONY_SHIP in BattleSimulator.js / Shipyard ergänzen

### Phase C – Sektorsystem & Gouverneure (1 Woche)

- [ ] `js/engine/game/SectorSimulation.js` (neues Modul: Sektor-Verwaltung, AdminCap-Beiträge)
- [ ] `api/colonization.php` Sektor-Aktionen implementieren
- [ ] Gouverneurs-NPC-Integration (Verknüpfung mit bestehendem NPC-System)
- [ ] Fraktions-Tension-Berechnung in game_engine.php

### Phase D – Events & Edikte (1 Woche)

- [ ] Expansion-Events in `js/engine/game/EventSystem.js` definieren (defineJournalEntry)
- [ ] Krisen-Situations-Framework (Stufe I–IV) für Expansion/Hunger/Korruption
- [ ] Edikte-System in `api/colonization.php` + Frontend-Panel
- [ ] Colony-Gründungs-Wizard (Frontend, Mehrstufiger Modal)

### Phase E – Frontend & WebGPU (1.5 Wochen)

- [ ] `EmpireStatusBar` (Sprawl-Indikator in Header)
- [ ] `SectorManagerController` (Sektor-Verwaltungs-Panel)
- [ ] `FactionDashboardController` (Spannungs-Dashboard)
- [ ] `ColonyViewController` erweitern (Distrikte-Tab, Phase-Anzeige, Strata)
- [ ] Sprawl-Heatmap in `js/galaxy-renderer-core.js`
- [ ] Distrikt-Zonen im WebGPU-Colony-Renderer (Farbcodierung)

### Phase F – Balancing & Tests (1 Woche)

- [ ] Spieltest mit 50-Systeme-Szenario
- [ ] Sprawl-Kurve und Tension-Thresholds iterativ anpassen
- [ ] Integration-Tests (Playwright) für Colony-Gründungsflow
- [ ] Performance-Test: Tick-Loop mit 100 Kolonien / 50 Spielern

---

## Anhang: Rassen-Spezifika

### AdminCap-Rassen-Boni

| Rasse | Bonus | Begründung |
|-------|-------|------------|
| **Vor'Tak** | +10 BaseAdminCap | Disziplinierte Hierarchie, militärische Effizienz |
| **Syl'Nar** | +5 BaseAdminCap, Sektoren kosten −20 % Influence | Mystische Verwaltungsnetzwerke |
| **Aereth** | +15 % Research, −5 BaseAdminCap | Forschungsfokus, schlechtere Bürokratie |
| **Kryl'Tha** | Kein AdminCap-Bonus; Colonies wachsen 20 % schneller | Schwarmmentalität, organisches Wachstum |
| **Zhareen** | Forschung gibt +2 AdminCap permanent | Kristall-Archive = perfekte Verwaltungsstruktur |
| **Vel'Ar** | Gouverneure kosten −30 % Gehalt; Korruptions-Events seltener | Gasförmige Netzwerkintelligenz = verteilte Kontrolle |

### Sektor-Autonomie-Empfehlungen nach Spielphase

| Spielphase | Empfohlene Autonomie | Begründung |
|-----------|---------------------|-----------|
| Früh (< 20 Systeme) | 0–10 % | Volle Kontrolle nötig, wenig Sprawl |
| Mittel (20–50 Systeme) | 20–40 % | Balance zwischen Kontrolle und AdminCap |
| Spät (50–80 Systeme) | 40–60 % | Autonome Sektoren stabilisieren Empire |
| Überausdehnung (> 80) | 60–80 % | Sprawl-Reduktion kritisch; Kontrolle opfern |

---

*Dieses Dokument referenziert: `js/engine/game/ColonySimulation.js`, `js/engine/game/EventSystem.js`, `js/engine/game/BattleSimulator.js`, `docs/gamedesign/GAMEPLAY_DATA_MODEL.md`, `docs/gamedesign/GAMEDESIGN.md`, `FTL_DRIVE_DESIGN.md`.*
