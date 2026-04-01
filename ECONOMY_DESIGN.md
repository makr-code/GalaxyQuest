# 💹 GalaxyQuest — Wirtschaftssystem Design Document

**Version:** 1.0  
**Status:** Outline / Blaupause für Implementierung  
**Letztes Update:** 2026-04-01  
**Inspirationsquellen:** Victoria 3 (Paradox, 2022) · X4: Foundations (Egosoft, 2018)

---

## Inhaltsverzeichnis

1. [Executive Summary & Design-Ziele](#1-executive-summary--design-ziele)
2. [Ressourcen-Hierarchie](#2-ressourcen-hierarchie)
3. [Produktionsketten (Supply Chains)](#3-produktionsketten-supply-chains)
4. [Galaktischer Markt & Preisbildung](#4-galaktischer-markt--preisbildung)
5. [Pop-Wirtschaft (Lebensstandard & Konsum)](#5-pop-wirtschaft-lebensstandard--konsum)
6. [Fraktions-Wirtschaft & NPC-Ökonomie](#6-fraktions-wirtschaft--npc-ökonomie)
7. [Handelsrouten & Logistik](#7-handelsrouten--logistik)
8. [Wirtschaftspolitik](#8-wirtschaftspolitik)
9. [Technologie-Integration](#9-technologie-integration)
10. [UI/UX-Spezifikation (Frontend)](#10-uiux-spezifikation-frontend)
11. [Backend-API & Datenbankschema](#11-backend-api--datenbankschema)
12. [Implementierungs-Roadmap](#12-implementierungs-roadmap)
13. [Balancing-Grundsätze](#13-balancing-grundsätze)
14. [Offene Design-Fragen](#14-offene-design-fragen)

---

## 1. Executive Summary & Design-Ziele

### Vision

Das GalaxyQuest-Wirtschaftssystem soll ein **lebendes, reaktives Marktökosystem** schaffen, in dem Spieler nicht nur Ressourcen schürfen, sondern komplexe Produktionsketten aufbauen, Handelsstrategien entwickeln und auf Marktpreisschwankungen reagieren.

### Kerninspirationen

| Spiel | Übernommenes Konzept |
|---|---|
| **Victoria 3** | Pop-Konsum-Bedürfnisse · Warenmarkt mit dynamischen Preisen · Produktionsmethoden · Wirtschaftspolitik-Gesetze |
| **X4: Foundations** | Modulare Stationen als Wirtschaftsknoten · Angebot/Nachfrage-Preisbildung · Waren-Transportlogistik · NPC-Händler |
| **Stellaris** | Planetare Distrikte · Pop-Jobs · Fraktions-Wirtschaft |
| **Master of Orion** | Farmer/Worker/Scientist-Allokation |

### Design-Ziele

1. **Tiefe ohne Überwältigung:** Komplexe Interdependenzen, aber intuitive Darstellung
2. **Reaktive Wirtschaft:** Preise und Nachfrage reagieren auf Spielerentscheidungen und Weltgeschehen
3. **Fraktions-Integration:** NPC-Fraktionen nehmen am Markt teil, schaffen Wettbewerb und Kooperationsmöglichkeiten
4. **Colony-Spezialisierung sinnvoll machen:** Wirtschaftliche Vorteile, die echte strategische Entscheidungen erzwingen
5. **Rückwärtskompatibilität:** Aufbauend auf bestehenden Ressourcen (metal, crystal, deuterium, rare_earth, food, dark_matter)

### Nicht-Ziele

- Kein Echtzeit-Börsensimulator (zuviel Micromanagement)
- Keine vollständige Planwirtschaft (kein Befehlssystem à la Totalwar)
- Kein primärer Wirtschaftsfokus — Wirtschaft ist Mittel zum Zweck (Schiffsbau, Forschung, Expansion)

---

## 2. Ressourcen-Hierarchie

Das System erweitert die bestehenden **Primär-Ressourcen** um **Zwischenprodukte** und **Fertigwaren**.

### 2.1 Tier 1 — Primär-Ressourcen (bestehend, ✅ implementiert)

| Ressource | Symbol | Quelle | Verwendung |
|---|---|---|---|
| **Metall** | ⬡ | Metal Mine | Alles |
| **Kristall** | 💎 | Crystal Mine | Schilde, Forschung |
| **Deuterium** | 🔵 | Deuterium Synth | FTL, Reaktoren |
| **Seltene Erden** | 💜 | Rare Earth Drill | High-Tech, Module |
| **Nahrung** | 🌾 | Hydroponic Farm | Pop-Ernährung |
| **Energie** | ⚡ | Solar/Fusion | Gebäudebetrieb |
| **Dunkle Materie** | ✨ | DM Mine / Quests | Premium-Käufe |

### 2.2 Tier 2 — Zwischenprodukte (neu, 🎯 zu implementieren)

Zwischenprodukte werden in **Verarbeitungsbetrieben** aus Primär-Ressourcen hergestellt.

| Produkt | Symbol | Eingaben | Gebäude | Verwendung |
|---|---|---|---|---|
| **Stahl-Legierung** | 🔩 | 2× Metall + 1× Energie | Metallurgie-Werk | Schiffbau Tier 2+, schwere Gebäude |
| **Fokus-Kristalle** | 🔷 | 3× Kristall + 1× Seltene Erden | Kristall-Schleiferei | Waffen, Forschungsgeräte |
| **Reaktorbrennstoff** | 🔋 | 2× Deuterium + 1× Seltene Erden | Raffinerie | Reaktoren, FTL-Antriebe |
| **Biokompost** | 🌱 | 2× Nahrung + 1× Energie | Bioreaktor | Pop-Wohlstand, Agrar-Kolonie-Bonus |
| **Elektronik-Bauteile** | 💡 | 1× Kristall + 1× Seltene Erden | Elektronik-Fabrik | KI-Systeme, Stationsmodule |

### 2.3 Tier 3 — Fertigwaren (neu, 💡 mittelfristig)

Fertigwaren entstehen durch Kombination von Zwischenprodukten und verleihen Pops Lebensstandard-Boni.

| Ware | Symbol | Eingaben | Effekt |
|---|---|---|---|
| **Konsumgüter** | 🛍 | 1× Stahl-Legierung + 1× Elektronik-Bauteile | Pop-Zufriedenheit +10, Credits +2/Pop |
| **Luxusgüter** | 💎 | 1× Fokus-Kristalle + 1× Biokompost | Pop-Zufriedenheit +20, Loyalität +5% |
| **Militär-Ausrüstung** | ⚔ | 2× Stahl-Legierung + 1× Fokus-Kristalle | Truppen-Kampfwert +20%, Invasions-Erfolg +10% |
| **Forschungs-Kits** | 🔬 | 1× Fokus-Kristalle + 1× Elektronik-Bauteile | Forschungs-Output +15% auf Kolonie |
| **Kolonisierungs-Pakete** | 🏗 | 1× Stahl-Legierung + 1× Biokompost + 1× Reaktorbrennstoff | Kolonie-Wachstum +25% für 10 Ticks |

### 2.4 Ressourcen-Lager

Jede Kolonie hat begrenzte Lagerkapazität. Überschuss wird automatisch zum galaktischen Markt angeboten.

```
Lager-Kapazität = Basis-Kapazität × (1 + 0.1 × Lager-Gebäude-Level)
Basis: Metal/Crystal/Deuterium = 50,000, Rare Earth = 10,000
Zwischenprodukte: 5,000 pro Typ, Fertigwaren: 2,000 pro Typ
```

---

## 3. Produktionsketten (Supply Chains)

### 3.1 Produktionskette — Schiffbau (Beispiel)

```
Metall (Tier 1)
    └─► Stahl-Legierung (Tier 2, Metallurgie-Werk)
            └─► Schiffsrumpf → Schiff Tier 2+

Kristall (Tier 1)
Seltene Erden (Tier 1)
    └─► Fokus-Kristalle (Tier 2, Kristall-Schleiferei)
            └─► Waffensysteme

Deuterium (Tier 1)
Seltene Erden (Tier 1)
    └─► Reaktorbrennstoff (Tier 2, Raffinerie)
            └─► Antrieb
```

**Vollständige Kette für Schlachtschiff Tier 3:**
- 500 Stahl-Legierung (= 1.000 Metall + 500 Energie)
- 200 Fokus-Kristalle (= 600 Kristall + 200 Seltene Erden)
- 100 Reaktorbrennstoff (= 200 Deuterium + 100 Seltene Erden)
- Bauzeit: 24h → reduzierbar durch Industrie-Kolonie-Bonus (-10%)

### 3.2 Produktionskette — Pop-Wohlstand

```
Nahrung (Tier 1)
Energie (Tier 1)
    └─► Biokompost (Tier 2, Bioreaktor)

Metall (Tier 1)
Kristall (Tier 1)
Seltene Erden (Tier 1)
    └─► Elektronik-Bauteile (Tier 2, Elektronik-Fabrik)
    └─► Stahl-Legierung (Tier 2, Metallurgie-Werk)

Stahl-Legierung + Elektronik-Bauteile
    └─► Konsumgüter (Tier 3)
            └─► Pop-Zufriedenheit +10, Credits +2/Pop/Tick
```

### 3.3 Produktionsmethoden (Victoria 3 inspiriert)

Jedes Verarbeitungsgebäude hat **wählbare Produktionsmethoden**, die Input/Output-Verhältnisse ändern:

| Gebäude | Methode A (Standard) | Methode B (Effizient) | Methode C (Premium) |
|---|---|---|---|
| Metallurgie-Werk | 2 Metall → 1 Stahl | 3 Metall → 2 Stahl | 2 Metall + 1 RE → 2 Stahl + 0.1 seltene Legierung |
| Raffinerie | 2 Deut → 1 Brennstoff | 2 Deut + 0.5 RE → 1.5 Brennstoff | Fusion-Katalysator: 1.5 Deut → 1 Brennstoff |
| Elektronik-Fabrik | Standard | Mit Robotik: +20% Output, +10% Energie-Kosten | Quantenelektronik: +50% Output, braucht Forschung lvl 8 |

---

## 4. Galaktischer Markt & Preisbildung

### 4.1 Markt-Mechanismus (X4 + Victoria 3 Hybrid)

Der **Galaktische Markt** (GalacticExchange) aggregiert Angebot und Nachfrage über alle Spieler und NPC-Fraktionen in einem Sternensystem-Cluster.

#### Preisbildung (dynamisch)

```
Preis(t) = Basispreis × Preismultiplikator(Angebot, Nachfrage)

Preismultiplikator = clamp(
    (Nachfrage / max(1, Angebot))^0.4,
    minMulti, maxMulti
)

Standardwerte:
  minMulti = 0.30  (−70% unter Basis)
  maxMulti = 3.50  (250% über Basis)
```

#### Basis-Preistabelle

| Ressource | Basispreis (Credits) | Min-Preis | Max-Preis |
|---|---|---|---|
| Metall | 10 | 3 | 35 |
| Kristall | 15 | 5 | 52 |
| Deuterium | 20 | 6 | 70 |
| Seltene Erden | 50 | 15 | 175 |
| Nahrung | 8 | 2 | 28 |
| Stahl-Legierung | 35 | 12 | 122 |
| Fokus-Kristalle | 60 | 20 | 210 |
| Reaktorbrennstoff | 55 | 18 | 192 |
| Konsumgüter | 80 | 25 | 280 |
| Luxusgüter | 200 | 60 | 700 |
| Militär-Ausrüstung | 150 | 45 | 525 |

### 4.2 Marktstrukturen

#### Lokaler Markt (Sternensystem)
- Jedes besiedelte Sternensystem hat einen **lokalen Markt**
- Radius: alle Kolonien im selben Sternensystem teilen denselben Markt
- Transportkosten: keine (inner-system)
- Aktualisierung: alle 15 Minuten (Echtzeit)

#### Regionaler Markt (Galaxie-Sektor)
- Aggregiert 3–5 benachbarte Sternensysteme (< 20 Lichtjahre)
- Transportkosten: +5% Preis pro 5 Lichtjahre Entfernung
- Aktualisierung: stündlich

#### Galaktischer Markt (Helion-Konföderation)
- Ein universeller Handelsplatz, über den jede Ressource kaufbar/verkaufbar ist
- Lieferzeit: Simulierter Transport (2–48h je nach Entfernung) → sofort kaufbar mit Aufpreis (+20%)
- Setzt Preis-Floor und Preis-Ceiling weltweit
- Zugang: Erfordert Handelsabkommen mit der Helion-Konföderation

### 4.3 Markteinschränkungen

- **Embargo:** Kriegsfraktionen können keine Waren an den Spieler verkaufen/kaufen
- **Monopol:** Wenn eine Fraktion >60% des Angebots einer Ware kontrolliert, kann sie den Preis manipulieren
- **Black Market:** Piraten-Fraktionen (Khar'Morr) bieten verbotene Güter zu +50% Preis an, ohne Fraktion

### 4.4 Markt-Events (Victoria 3 inspiriert)

Regelmäßige Ereignisse beeinflussen die Preise:

| Event | Effekt | Dauer |
|---|---|---|
| **Seuche** | Nahrung-Nachfrage ×2, Biokompost ×1.5 | 24–72h |
| **Piraterie-Welle** | Transport-Kosten +30%, unsichere Routen | 12–24h |
| **Technologiedurchbruch** | Bestimmte Fertigwaren -20% Kosten | 48h |
| **Ressourcen-Knappheit** | Zufällige Ressource: Angebot -50% | 6–48h |
| **Handels-Boom** | Credits +15%, alle Handelsvolumina ×1.3 | 12–24h |
| **Galaktischer Krieg** | Militär-Ausrüstung-Nachfrage ×3 | bis Kriegsende |

---

## 5. Pop-Wirtschaft (Lebensstandard & Konsum)

### 5.1 Pop-Bedürfnispyramide (Victoria 3 inspiriert)

Jede Pop-Einheit hat **Bedürfnisse** in drei Kategorien:

```
Tier 3 – Luxus-Bedürfnisse:      Luxusgüter       → Zufriedenheit +20, Loyalität +5%
Tier 2 – Komfort-Bedürfnisse:    Konsumgüter       → Zufriedenheit +10, Credits +2/Pop
Tier 1 – Basis-Bedürfnisse:      Nahrung + Energie → Überleben (existiert bereits ✅)
```

#### Konsum-Mechanik

Jede Pop-Einheit konsumiert pro Tick:
- **Nahrung:** 1.0 Einheit (bestehend ✅)
- **Konsumgüter:** 0.2 Einheiten (neu — wenn verfügbar)
- **Luxusgüter:** 0.05 Einheiten (neu — wenn verfügbar)

Bei fehlendem Konsum:
- Keine Konsumgüter → Zufriedenheit −10, Credits-Produktion −20%
- Keine Luxusgüter → kein Zufriedenheits-Bonus (kein Malus)

### 5.2 Pop-Job-Erweiterung

Die bestehenden Pop-Jobs ([ColonySimulation.js](js/engine/game/ColonySimulation.js)) werden um wirtschaftliche Rollen erweitert:

| Job (neu) | Ausgabe | Benötigt Gebäude |
|---|---|---|
| **HÄNDLER** (Trader) | Credits +5, Markt-Zugang ×1.1 | Raumhafen (Spaceport) |
| **TECHNIKER** (Engineer) | Produktionsmethode-Effizienz +5%, Produktion +2 | Fabrik Level 3+ |
| **DIPLOMAT** | Fraktions-Beziehung +1/Tick, Handelsabkommen-Kosten −10% | Diplomatisches Zentrum |

### 5.3 Bevölkerungswachstum & Wirtschaft

Das bestehende Wachstumsmodell aus `ColonySimulation.js` (logistisch, nahrungsabhängig) wird mit wirtschaftlichen Modifikatoren erweitert:

```
Wachstumsmodifikator = 1.0
  + (Zufriedenheit - 50) / 100 × 0.3    // ±15%
  + (Konsumgüter-Versorgungsgrad) × 0.2  // bis +20%
  - (Arbeitslosigkeit / Gesamtpops) × 0.5 // bis -50%
```

---

## 6. Fraktions-Wirtschaft & NPC-Ökonomie

### 6.1 Fraktions-Wirtschaftsprofile

Jede NPC-Fraktion hat ein wirtschaftliches Spezialprofil:

| Fraktion | Wirtschafts-Typ | Exportiert | Importiert | Besonderheit |
|---|---|---|---|---|
| **Helion-Konföderation** | Freier Markt | Konsumgüter, Elektronik | Seltene Erden, Deuterium | Marktpreise stabilisieren |
| **Eisenflotte** | Kriegswirtschaft | Militär-Ausrüstung, Stahl | Nahrung, Konsumgüter | Blockiert Handelsrouten im Krieg |
| **Vor'Tak-Konvergenz** | Militär-Industrie | Militär-Ausrüstung, Stahl | Nahrung, Luxusgüter | Militärtechnologie +15% |
| **Omniscienta-KI** | Effiziente Planwirtschaft | Elektronik, Forschungs-Kits | Metall, Energie | Keine Verhandlung, Fixpreise |
| **Myr'Keth-Schwärme** | Extraktiv | Metall, Seltene Erden | Nahrung, Konsumgüter | Massiver Ressourcen-Output |
| **Aethernox-Wächter** | Post-Knappheit | Graviton-Relikte | Nichts (self-sufficient) | Exklusive Relikt-Technologien |
| **Khar'Morr-Piraten** | Schwarzmarkt | Militär-Ausrüstung, Luxus | Deuterium, Elektronik | −50% Preis, kein Ansehen-Verlust |

### 6.2 NPC-Handelskorporationen (X4 inspiriert)

Analog zu X4-Händlern gibt es **NPC-Handelsschiffe** die autonom zwischen Märkten navigieren:

- **Helion-Handelsflotten:** 5–15 Schiffe pro Sektor, kaufen günstig/verkaufen teuer
- **Fraktionsversorgung:** Fraktionen bauen eigene Wirtschaft auf, brauchen Ressourcen
- **Konvoi-Angriffe:** Spieler können feindliche Konvois abfangen (Piraterie-Option)

### 6.3 Wirtschaftliche Fraktions-Beziehungen

Die Fraktions-Beziehungen (bestehend in `faction_relations`) werden um wirtschaftliche Dimensionen erweitert:

```
Handelsbeziehung = Freundschaft(0-100) × Handelsbereitschaft(0-100) / 100

Handelsbereitschaft (faction_type spezifisch):
  trade    → 90  (Helion)
  science  → 60
  military → 40
  pirate   → 20 (nur Schwarzmarkt)
  ancient  → 5  (sehr selten, sehr wertvoll)
```

---

## 7. Handelsrouten & Logistik

### 7.1 Bestehende Grundlage (✅ implementiert)

- `trade_routes`-Tabelle: origin/target colony, cargo_json, interval_hours
- Player-to-Player Trade Proposals: `trade_proposals`-Tabelle
- Automatischer Dispatch über `fleet.php`

### 7.2 Erweiterungen (🎯 geplant)

#### Handelsrouten-Effizienz

```
Transportkosten pro Route:
  Basiskosten = Entfernung_in_ly × 0.1 Deuterium
  Warenverlust = Piraterie-Risiko × Warenwert × 0.02
  Zeit = Entfernung_in_ly / fleet_speed_ly_per_h
```

#### Routen-Typen (neu)

| Typ | Beschreibung | Implementierung |
|---|---|---|
| **Manuelle Route** | Spieler konfiguriert manuell (bestehend ✅) | trade_routes |
| **Automatisierte Route** | Trade Director Leader optimiert automatisch | trade_director + leader skill |
| **Fraktion-Route** | NPC-Fraktion nutzt Route, Spieler erhält Gebühr | faction_trade_routes |
| **Notfallversorgung** | Auto-Route bei Ressourcenknappheit | event-triggered |

#### Logistik-Knoten (X4 inspiriert)

Kolonien können zu **Handelszentren** aufgerüstet werden:
- **Raumhafen (Spaceport) Level 3+** → Aktiviert Logistik-Hub-Funktion
- Hub verarbeitet bis zu 10 aktive Routen gleichzeitig (ohne Hub: max 3)
- Hub-Gebühr: 2% auf durchlaufende Waren → passive Credits-Einnahme

### 7.3 Transport-Flotte (Trade Director)

Der neue **Trade Director**-Leader (✅ bereits in DB definiert als Role) bekommt wirtschaftliche Fähigkeiten:

| Skill Level | Fähigkeit |
|---|---|
| 1–3 | Routenoptimierung: Transportkosten −5% |
| 4–6 | Auto-Händler: 1 autonomes Handelsschiff aktiviert |
| 7–9 | Marktanalyse: Preisvorhersage +24h sichtbar |
| 10 | Handelsdominanz: Marktpreise um ±5% beeinflussbar |

---

## 8. Wirtschaftspolitik

### 8.1 Steuer-System

Jede Kolonie hat einstellbare Steuersätze (Victoria 3 inspiriert):

| Steuer | Bereich | Effekt auf Produktion | Effekt auf Zufriedenheit |
|---|---|---|---|
| Einkommenssteuer | 0–40% | Credits −Steuer% | Zufriedenheit −Steuer×0.3 |
| Produktionssteuer | 0–30% | Ressourcen-Output −Steuer% | Zufriedenheit −Steuer×0.2 |
| Handelssteuer | 0–25% | Import-/Export-Kosten +Steuer% | Neutral |

**Global-Optionen (Spieler-Empire-weite Politiken):**

| Politik | Voraussetzung | Bonus | Malus |
|---|---|---|---|
| **Freier Markt** | Standard | +15% Credits, +10% Handelsbeschleunigung | Keine |
| **Staatliche Subventionen** | Industriekolonie vorhanden | −20% Baukosten für Fabriken | −10% Credits-Einnahmen |
| **Merkantilismus** | Handelsabkommen ×3 | +20% Export-Einnahmen | Import um 20% teurer |
| **Autarkie** | Alle 5 Grundressourcen selbst produziert | Keine Import-Abhängigkeit | Keine Import-Möglichkeit |
| **Kriegswirtschaft** | Krieg aktiv | +30% Militär-Produktion | −20% Konsumgüter, −10% Zufriedenheit |

### 8.2 Subventionen

Spieler können bestimmte Produktionsbereiche subventionieren:

- **Agrar-Subvention:** Nahrungs-Produktionskosten −15% (Kosten: 500 Credits/Tick global)
- **Forschungs-Förderung:** Forschungs-Kit-Produktion −10%, Forschungspunkte +5% (Kosten: 300 Credits/Tick)
- **Rüstungs-Programm:** Militär-Ausrüstungs-Produktion +20%, Waffenqualität +1 Tier (Kosten: 1.000 Credits/Tick)

---

## 9. Technologie-Integration

### 9.1 Neue Forschungskategorie: ECONOMY

Die bestehende [ResearchTree.js](js/engine/game/ResearchTree.js) wird um die Kategorie `ECONOMY` erweitert:

```javascript
ResearchCategory.ECONOMY = 'economy'; // Handelsrouten, Märkte, Produktionsmethoden
```

### 9.2 Wirtschafts-Forschungsbaum

```
Era 1:
  economy.basic_trade          → Handelsbasis (Trade-Route +1 Slot)
  economy.metallurgy_i         → Metallurgie I (Stahl-Legierung freigeschaltet)

Era 2:
  economy.market_analysis      → Marktanalyse (Preisschwankungen 12h vorher sehen)
  economy.refined_crystals     → Kristallverarbeitung (Fokus-Kristalle freigeschaltet)
  economy.fuel_synthesis       → Treibstoffsynthese (Reaktorbrennstoff freigeschaltet)
  economy.basic_manufacturing  → Grundfertigung (Konsumgüter freigeschaltet)

Era 3:
  economy.logistics_network    → Logistik-Netz (Hub-Funktion + 5 Routen)
  economy.electronics_i        → Elektronik I (Elektronik-Bauteile freigeschaltet)
  economy.bioeconomy           → Bioökonomie (Biokompost freigeschaltet)
  economy.trade_agreements     → Handelsabkommen (Fraktions-Handelsverträge)

Era 4:
  economy.luxury_goods         → Luxusproduktion (Luxusgüter freigeschaltet)
  economy.military_industrial  → Rüstungsindustrie (Militär-Ausrüstung freigeschaltet)
  economy.research_economy     → Wissensökonomie (Forschungs-Kits freigeschaltet)
  economy.market_manipulation  → Marktmanipulation (Trade Director lvl 10 Bonus)

Era 5:
  economy.galactic_exchange    → Galaktische Börse (globaler Markt, Preisvorhersagen 48h)
  economy.post_scarcity        → Post-Knappheit (automatische Ressourcen-Balance)
```

### 9.3 Tech-Effekte auf bestehende Systeme

| Technologie | Effekt auf bestehende API |
|---|---|
| `economy.metallurgy_i` | Neue Produktionsmethode in `api/buildings.php` |
| `economy.trade_agreements` | Neue `faction_trade_contracts`-Tabelle, `api/trade.php` erweitern |
| `economy.logistics_network` | `trade_routes.max_slots` erhöhen per Forschungslevel |

---

## 10. UI/UX-Spezifikation (Frontend)

### 10.1 Wirtschafts-Dashboard (neues Floating Window)

**Window-ID:** `economy`  
**Icon:** 💹  
**Größe:** 720×500px (resizable)  
**Controller:** `EconomyController` in `js/game.js`

#### Tabs:

```
[📊 Übersicht] [🏭 Produktion] [📈 Markt] [🚀 Routen] [📜 Politik]
```

#### Tab 1: Übersicht
- Ressourcen-Flussdiagramm: Primär → Zwischen → Fertig (Sankey-ähnlich, Canvas-basiert)
- Kredite/Tick live
- Wichtigste Engpässe (fehlende Eingaben für Produktionsketten)
- Wirtschafts-Score (Effizienzwert 0–100)

#### Tab 2: Produktion
- Pro Kolonie: aktive Produktionsmethoden, Output/Tick, Energie-Verbrauch
- Gebäude-Upgrade-Vorschläge
- Produktionsmethode umschalten (dropdown per Gebäude)

#### Tab 3: Markt
- Live-Preistabelle aller handelbaren Waren
- Sparklines (letzte 24h Preisverlauf)
- Kauf/Verkauf-Buttons mit Menge-Slider
- Filter: lokaler Markt / regionaler Markt / galaktischer Markt
- Markt-Events-Ticker oben

#### Tab 4: Handelsrouten
- Liste aller aktiven Routen (wie bestehend, erweitert um Effizienz-Anzeige)
- Neue Route erstellen: visueller Wizard (Quelle → Ziel → Ware → Menge → Intervall)
- Kosten/Gewinn-Kalkulator live
- Risiko-Anzeige (Piraterie-Wahrscheinlichkeit auf Route)

#### Tab 5: Wirtschaftspolitik
- Steuer-Slider pro Kolonie oder global
- Aktivierte Politik-Optionen (Radio-Buttons)
- Subventions-Schalter mit laufenden Kosten
- Handelsabkommen mit Fraktionen anzeigen/abschließen

### 10.2 Markt-Ticker (Statuszeile)

Oben im Hauptfenster: scrollender Ticker mit aktuellen Preisbewegungen:
```
💹 Stahl +8%  |  🔷 Fokus-Kristalle −12%  |  ⚔ Militär-Ausrüstung +35%  (Galaktischer Krieg!)
```

### 10.3 Kolonie-Panel Erweiterung

Im bestehenden Kolonie-Fenster wird ein neuer Bereich **"Wirtschaft"** hinzugefügt:
- Produktionsmethoden aktiver Gebäude anzeigen/ändern
- Verbrauch vs. Produktion je Ressource (Bilanz)
- Steuer-Level per Kolonie einstellbar

### 10.4 GQUI-Konventionen

Alle neuen Komponenten folgen dem bestehenden [GQUI Fluent DOM-Builder](js/gq-ui.js):

```javascript
// Beispiel: Markt-Preis-Zeile
GQUI.div('market-row')
  .append(GQUI.span('resource-icon').text('⬡'))
  .append(GQUI.span('resource-name').text('Metall'))
  .append(GQUI.span('price current').text('12 Cr'))
  .append(GQUI.span('price-delta positive').text('+8%'))
  .append(GQUI.btn('Kaufen', () => openBuyDialog('metal')))
```

---

## 11. Backend-API & Datenbankschema

### 11.1 Neue Datenbanktabellen

#### `processed_goods` — Zwischenprodukt-Lager pro Kolonie

```sql
CREATE TABLE processed_goods (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    colony_id    INT NOT NULL,
    good_type    ENUM(
        'steel_alloy', 'focus_crystals', 'reactor_fuel',
        'biocompost', 'electronics_components',
        'consumer_goods', 'luxury_goods', 'military_equipment',
        'research_kits', 'colonization_packs'
    ) NOT NULL,
    quantity     DECIMAL(12,2) NOT NULL DEFAULT 0,
    capacity     DECIMAL(12,2) NOT NULL DEFAULT 5000,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY uq_colony_good (colony_id, good_type)
) ENGINE=InnoDB;
```

#### `production_methods` — Aktive Produktionsmethode pro Gebäude

```sql
CREATE TABLE production_methods (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    colony_id    INT NOT NULL,
    building_type VARCHAR(32) NOT NULL,
    method       ENUM('standard', 'efficient', 'premium') NOT NULL DEFAULT 'standard',
    set_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY uq_colony_building_method (colony_id, building_type)
) ENGINE=InnoDB;
```

#### `market_prices` — Aktuelle Marktpreise (aggregiert, stündlich aktualisiert)

```sql
CREATE TABLE market_prices (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    scope         ENUM('global', 'sector', 'system') NOT NULL DEFAULT 'global',
    scope_id      INT NULL,        -- NULL für global, system_id für system
    resource_type VARCHAR(32) NOT NULL,
    base_price    DECIMAL(10,4) NOT NULL,
    current_price DECIMAL(10,4) NOT NULL,
    supply        DECIMAL(16,2) NOT NULL DEFAULT 0,
    demand        DECIMAL(16,2) NOT NULL DEFAULT 0,
    price_mult    DECIMAL(6,4) NOT NULL DEFAULT 1.0,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_scope_resource (scope, resource_type),
    INDEX idx_scope_id (scope_id)
) ENGINE=InnoDB;
```

#### `market_transactions` — Kauf/Verkauf-History

```sql
CREATE TABLE market_transactions (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    colony_id     INT NOT NULL,
    resource_type VARCHAR(32) NOT NULL,
    direction     ENUM('buy', 'sell') NOT NULL,
    quantity      DECIMAL(12,2) NOT NULL,
    unit_price    DECIMAL(10,4) NOT NULL,
    total_credits DECIMAL(16,2) NOT NULL,
    market_scope  ENUM('local', 'regional', 'galactic') NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)   ON DELETE CASCADE,
    FOREIGN KEY (colony_id)  REFERENCES colonies(id) ON DELETE CASCADE,
    INDEX idx_user_time (user_id, created_at)
) ENGINE=InnoDB;
```

#### `economy_policies` — Wirtschaftspolitik pro Spieler

```sql
CREATE TABLE economy_policies (
    user_id         INT PRIMARY KEY,
    global_policy   ENUM('free_market', 'subsidies', 'mercantilism', 'autarky', 'war_economy')
                    NOT NULL DEFAULT 'free_market',
    income_tax_pct  TINYINT UNSIGNED NOT NULL DEFAULT 15,
    prod_tax_pct    TINYINT UNSIGNED NOT NULL DEFAULT 10,
    trade_tax_pct   TINYINT UNSIGNED NOT NULL DEFAULT 5,
    subsidy_agri    TINYINT(1) NOT NULL DEFAULT 0,
    subsidy_research TINYINT(1) NOT NULL DEFAULT 0,
    subsidy_military TINYINT(1) NOT NULL DEFAULT 0,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

#### `market_events` — Wirtschaftliche Ereignisse

```sql
CREATE TABLE market_events (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    event_type    VARCHAR(32) NOT NULL,
    affected_good VARCHAR(32) DEFAULT NULL,
    price_mult    DECIMAL(5,3) NOT NULL DEFAULT 1.0,
    demand_mult   DECIMAL(5,3) NOT NULL DEFAULT 1.0,
    description   TEXT NOT NULL,
    starts_at     DATETIME NOT NULL,
    ends_at       DATETIME NOT NULL,
    INDEX idx_active (starts_at, ends_at)
) ENGINE=InnoDB;
```

#### `faction_trade_contracts` — Handelsverträge mit Fraktionen

```sql
CREATE TABLE faction_trade_contracts (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    faction_code    VARCHAR(32) NOT NULL,
    contract_type   ENUM('export', 'import', 'mutual') NOT NULL,
    resource_type   VARCHAR(32) NOT NULL,
    quantity_per_h  DECIMAL(10,2) NOT NULL,
    price_per_unit  DECIMAL(10,4) NOT NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    expires_at      DATETIME DEFAULT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_faction (user_id, faction_code)
) ENGINE=InnoDB;
```

### 11.2 Neue API-Endpunkte

#### `api/economy.php` — Haupt-Wirtschafts-API

| Action | Methode | Beschreibung |
|---|---|---|
| `get_overview` | GET | Wirtschafts-Dashboard-Daten (Ressourcenfluss, Credits/Tick) |
| `get_production` | GET | Produktionsmethoden aller Kolonien |
| `set_production_method` | POST | Produktionsmethode für Gebäude ändern |
| `get_processed_goods` | GET | Zwischenprodukt-Bestände per Kolonie |
| `process_goods` | POST | Manuell Produktionszyklus anstoßen (für Test/Debug) |

#### `api/market.php` — Markt-API

| Action | Methode | Beschreibung |
|---|---|---|
| `get_prices` | GET | Aktuelle Marktpreise (scope: local/regional/global) |
| `buy` | POST | Ware kaufen (resource_type, quantity, colony_id, scope) |
| `sell` | POST | Ware verkaufen (resource_type, quantity, colony_id, scope) |
| `get_history` | GET | Preis-History letzten 24h |
| `get_active_events` | GET | Aktive Markt-Events |
| `get_transactions` | GET | Eigene Transaktions-History |

#### `api/economy_policy.php` — Wirtschaftspolitik-API

| Action | Methode | Beschreibung |
|---|---|---|
| `get` | GET | Aktuelle Politiken und Steuern |
| `set_global_policy` | POST | Globale Politik wechseln |
| `set_taxes` | POST | Steuersätze anpassen |
| `toggle_subsidy` | POST | Subvention an/aus |
| `get_faction_contracts` | GET | Aktive Fraktions-Handelsverträge |
| `create_faction_contract` | POST | Neuen Vertrag mit Fraktion abschließen |
| `cancel_faction_contract` | POST | Vertrag kündigen |

### 11.3 Erweiterung bestehender APIs

#### `api/game_engine.php` — Erweiterungen

```php
/**
 * Verarbeitungsgebäude-Tick: verarbeitet Rohstoffe zu Zwischenprodukten.
 *
 * @param PDO $db       Datenbankverbindung
 * @param int $colonyId ID der zu verarbeitenden Kolonie
 * @return void
 * @throws RuntimeException bei fehlendem Eintrag in processed_goods
 */
function process_manufacturing_tick(PDO $db, int $colonyId): void {
    // Liest Produktionsmethoden aus production_methods
    // Verbraucht Primär-/Zwischenprodukte aus colonies / processed_goods
    // Schreibt Output in processed_goods
    // Berücksichtigt Energie-Balance der Kolonie
}

/**
 * Marktpreis-Update: berechnet aktuelle Preise aus Angebot und Nachfrage.
 *
 * @param PDO    $db    Datenbankverbindung
 * @param string $scope Marktebene: 'global' | 'sector' | 'system'
 * @return void
 */
function update_market_prices(PDO $db, string $scope = 'global'): void {
    // Aggregiert Angebot aus allen Kolonien (processed_goods + colonies)
    // Berechnet Nachfrage aus Pop-Bedarf + Schiffbau-Queue + Forschungs-Queue
    // Berechnet neuen Preis per Preismultiplikator-Formel
    // Schreibt in market_prices
}
```

#### `update_colony_resources()` — Erweiterung

Die bestehende Funktion wird um folgende Schritte erweitert:
1. Pop-Konsum von Konsumgütern / Luxusgütern aus `processed_goods`
2. Credits-Berechnung nach Steuerpolitik
3. Call von `process_manufacturing_tick()` für Verarbeitungsgebäude

### 11.4 Projection-System Integration

Wirtschafts-Snapshots werden in das bestehende [Projection-System](lib/projection_runtime.php) integriert:

```php
// scripts/project_economy_snapshot.php
// Projiziert stündlich:
//   - Marktpreise (market_prices)
//   - Wirtschafts-KPIs pro Spieler (credits_per_h, trade_volume)
//   - Fraktions-Wirtschaftsstärke

enqueue_projection_dirty('economy_snapshot', $userId, ['scope' => 'user']);
enqueue_projection_dirty('market_prices',    null,     ['scope' => 'global']);
```

---

## 12. Implementierungs-Roadmap

### Phase E1 — Grundlagen (🎯 Priorität: Hoch)
*Ziel: Infrastruktur für Zwischenprodukte und Markt*

| ID | Aufgabe | Aufwand | Status |
|---|---|---|---|
| E1.1 | DB-Migration: `processed_goods`, `production_methods` | Klein | 🔲 |
| E1.2 | DB-Migration: `economy_policies` | Klein | 🔲 |
| E1.3 | `api/economy.php`: `get_overview`, `get_production`, `set_production_method` | Mittel | 🔲 |
| E1.4 | `process_manufacturing_tick()` in `game_engine.php` (Stahl-Legierung) | Mittel | 🔲 |
| E1.5 | `update_colony_resources()` erweitern: Konsumgüter-Verbrauch durch Pops | Klein | 🔲 |
| E1.6 | ResearchTree: Kategorie ECONOMY + Era-1/2-Knoten | Mittel | 🔲 |
| E1.7 | Frontend: EconomyController Grundgerüst + Tab "Produktion" | Mittel | 🔲 |

**Definition of Done E1:**
- Stahl-Legierung wird in Metallurgie-Werken produziert
- Spieler sieht seinen Bestand an Zwischenprodukten
- Grundlegende Produktionsmethoden umschaltbar

---

### Phase E2 — Markt (💡 Priorität: Mittel)
*Ziel: Funktionierender Handelsmarkt*

| ID | Aufgabe | Aufwand | Status |
|---|---|---|---|
| E2.1 | DB-Migration: `market_prices`, `market_transactions`, `market_events` | Mittel | 🔲 |
| E2.2 | `api/market.php`: buy, sell, get_prices | Mittel | 🔲 |
| E2.3 | Marktpreis-Update-Skript (cron/projection) | Mittel | 🔲 |
| E2.4 | Markt-Events: 5 Basis-Events implementieren | Klein | 🔲 |
| E2.5 | Frontend: Markt-Tab mit Preis-Tabelle, Kauf/Verkauf | Groß | 🔲 |
| E2.6 | Fraktions-Wirtschaftsprofile in NPC-AI (`api/npc_ai.php`) | Mittel | 🔲 |

**Definition of Done E2:**
- Spieler können Ressourcen am Markt kaufen/verkaufen
- Preise reagieren dynamisch auf Angebot/Nachfrage
- Markt-Events beeinflussen Preise

---

### Phase E3 — Pop-Wirtschaft & Politik (💡 Priorität: Mittel)
*Ziel: Fertigwaren und Wirtschaftspolitik*

| ID | Aufgabe | Aufwand | Status |
|---|---|---|---|
| E3.1 | Alle Zwischenprodukte (Tier 2) + `api/economy.php` erweitern | Mittel | 🔲 |
| E3.2 | Fertigwaren (Tier 3) + Pop-Konsum-Mechanik | Groß | 🔲 |
| E3.3 | `api/economy_policy.php`: Steuern + globale Politik | Mittel | 🔲 |
| E3.4 | Pop-Zufriedenheit-Modifikator durch Konsumgüter-Versorgung | Klein | 🔲 |
| E3.5 | Frontend: Politik-Tab + Steuer-Slider | Mittel | 🔲 |
| E3.6 | ResearchTree: Era 3/4 Wirtschaftsknoten | Mittel | 🔲 |

**Definition of Done E3:**
- Pop-Zufriedenheit reagiert auf Konsumgüter-Versorgung
- Wirtschaftspolitik-Entscheidungen haben spürbare Effekte
- Fertigwaren beeinflussen Kolonie-Performance

---

### Phase E4 — Fraktionen & Handelsverträge (🔭 Priorität: Lang)
*Ziel: NPC-Ökonomie und galaktischer Markt*

| ID | Aufgabe | Aufwand | Status |
|---|---|---|---|
| E4.1 | `faction_trade_contracts`-Tabelle + API | Mittel | 🔲 |
| E4.2 | NPC-Handelsschiffe simulieren (Fraktions-Konvois) | Groß | 🔲 |
| E4.3 | Galaktischer Markt (Helion-Konföderation) | Groß | 🔲 |
| E4.4 | Trade Director Leader: Auto-Händler-Funktion | Groß | 🔲 |
| E4.5 | Markt-Manipulation-Mechanilik (Era-5-Tech) | Mittel | 🔲 |
| E4.6 | ResearchTree: Era 4/5 + `economy.galactic_exchange` | Klein | 🔲 |

**Definition of Done E4:**
- NPC-Fraktionen handeln aktiv auf dem Markt
- Spieler können Langzeit-Handelsverträge mit Fraktionen abschließen
- Trade Director Leader hat wirtschaftliche Gameplay-Wirkung

---

## 13. Balancing-Grundsätze

### 13.1 Wirtschaft als Mittel, nicht als Selbstzweck

- Wirtschaft unterstützt Schiffbau, Forschung und Expansion
- Ein Spieler der Wirtschaft ignoriert, kann noch kompetitiv sein (aber langsamer)
- Wirtschafts-Optimierung gibt 15–30% Produktionsvorteil gegenüber Basisstrategie

### 13.2 Preis-Volatilität

- Marktpreise sollten **moderat volatil** sein (±30% bei normalem Spielverlauf)
- Extrempreise (+200%) nur bei dramatischen Events (Krieg, Seuche)
- Spieler sollten auf Preistrends reagieren können (Vorausplanung ≥ 30 Minuten)

### 13.3 Ressourcen-Knappheit

```
Ziel-Knappheitsindex (pro Ressource):
  Sehr knapp  (>200% Nachfrage/Angebot): selten, max 10% der Spielzeit
  Knapp       (120–200%):                ca. 25% der Spielzeit
  Ausgeglichen (80–120%):                ca. 50% der Spielzeit
  Überschuss  (<80%):                    ca. 15% der Spielzeit
```

### 13.4 Einsteiger-Freundlichkeit

- Zwischenprodukte werden erst durch Forschung (Era 2) freigeschalten
- Fertigwaren erst Era 3 verfügbar
- Automatischer Handel (Trade Director) ab Leader-Level 4 → Micromanagement optional

### 13.5 Spieler-zu-Spieler-Balance

- Kein Monopol-Schutz auf kleinen Märkten → Wettbewerb erwünscht
- Großspieler können Preise beeinflussen, aber nicht vollständig kontrollieren (NPC-Fraktionen als Puffer)
- Neue Spieler erhalten 72h "Newcomer Shield" auf Handelstransaktionen (kein Unterbietungs-Angriff)

---

## 14. Offene Design-Fragen

| # | Frage | Optionen | Priorität |
|---|---|---|---|
| OD-1 | Wie wird **Energie** als Ressource in Produktionsketten eingesetzt? (Energie ist derzeit ein Kolonie-Attribut, keine handelbare Ressource) | A: Energie bleibt intern, wird nur als Produktionskosten abgezogen · B: Energie wird handelbar als "Energiezellen" | Hoch |
| OD-2 | Sollen **Seltene Erden** durch **Spezial-Ressourcen pro Fraktion** ersetzt oder ergänzt werden? (z.B. Aethernox-Graviton, Myr'Keth-Bio-Metall) | A: Seltene Erden als Sammelkategorie behalten · B: 3–5 spezifische seltene Materialien (wie X4: Terranite, Nividium) | Mittel |
| OD-3 | **Dunkle Materie als Wirtschafts-Währung?** Soll DM Teil des Wirtschaftssystems werden oder Premium-Währung bleiben? | A: DM als ultraseltene Handelsware (nicht kaufbar) · B: DM als Premiumwährung (Status quo) | Hoch |
| OD-4 | **Automatisierungsgrad:** Wie viel soll der Trade Director automatisieren? | A: Nur Kosten-Optimierung · B: Vollautomatisches Handeln ohne Spieler-Input | Mittel |
| OD-5 | **Inflation:** Soll es eine Credit-Inflation geben, um Ressourcenansammlungen zu begrenzen? | A: Keine Inflation (simpel) · B: Jährliche Inflation 2–5% (Victoria 3-ähnlich) | Niedrig |
| OD-6 | **Schwarzmarkt-Risiko:** Sollen Khar'Morr-Käufe Konsequenzen haben (Ruf-Verlust bei anderen Fraktionen)? | A: Anonym, kein Ruf-Effekt · B: Tracking: −5 Ansehen bei Konvergenz pro Kauf | Mittel |

---

## Anhang A — Glossar

| Begriff | Definition |
|---|---|
| **Angebot** | Gesamte verfügbare Menge einer Ressource auf dem Markt (Spieler + NPC) |
| **Nachfrage** | Gesamter Bedarf (Pop-Konsum + Schiffbau + Forschung + NPC-Käufe) |
| **Preismultiplikator** | Faktor, mit dem der Basispreis multipliziert wird |
| **Produktionsmethode** | Wählbares Produktionsverfahren eines Verarbeitungsgebäudes |
| **Zwischenprodukt** | Tier-2-Ressource, aus Primärressourcen gefertigt |
| **Fertigware** | Tier-3-Ressource, konsumierbar von Pops oder für Militär |
| **Logistik-Hub** | Raumhafen Lvl 3+, der mehr Handelsrouten und Durchsatz ermöglicht |
| **Trade Director** | Leader-Rolle für Wirtschafts-Automatisierung |
| **Konvoi** | NPC-Handelsflotte, die autonom zwischen Märkten navigiert |
| **Handelsabkommen** | Fraktionsvertrag, der Handelskonditionen regelt |

## Anhang B — Integration mit bestehenden Systemen

| Bestehendes System | Integrationspunkt | Änderungsumfang |
|---|---|---|
| `ColonySimulation.js` | Pop-Konsum von Konsumgütern, neue Job-Typen | Mittel |
| `ResearchTree.js` | Neue Kategorie ECONOMY, 12 neue Knoten | Klein |
| `BattleSimulator.js` | Militär-Ausrüstung beeinflusst Truppen-Stats | Klein |
| `EventSystem.js` | Markt-Events als Journal-Einträge | Klein |
| `api/game_engine.php` | `update_colony_resources()` + `process_manufacturing_tick()` | Mittel |
| `api/trade.php` | Routen-Effizienz + Fraktions-Kontrakte | Mittel |
| `api/npc_ai.php` | Fraktions-Wirtschaftsprofile + Konvoi-Logik | Groß |
| `lib/projection_runtime.php` | Wirtschafts-Snapshots (stündlich) | Klein |

---

*Dieses Dokument ist die verbindliche Design-Grundlage für die Wirtschaftssystem-Implementierung in GalaxyQuest.*  
*Änderungen müssen im Changelog vermerkt und mit dem Team abgestimmt werden.*

**Verwandte Dokumente:**
- [GAMEDESIGN.md](GAMEDESIGN.md) — Haupt-GDD
- [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md) — Feature-Roadmap
- [FTL_DRIVE_DESIGN.md](FTL_DRIVE_DESIGN.md) — FTL-System Design
- [GAMEPLAY_DATA_MODEL.md](GAMEPLAY_DATA_MODEL.md) — Datenbankschema
- [VESSEL_MODULE_BLUEPRINT_DESIGN.md](VESSEL_MODULE_BLUEPRINT_DESIGN.md) — Schiffsmodule
