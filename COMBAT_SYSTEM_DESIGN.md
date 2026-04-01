# ⚔️ GalaxyQuest — Kampfsystem Design Document

**Version:** 1.0  
**Status:** Blaupause für Implementierung  
**Erstellt:** 2026-04-01  
**Inspirationsquellen:** Victoria 3 (Paradox, 2022) · X4: Foundations (Egosoft, 2018) · OGame · Stellaris  
**Basis-Implementierungen:** `BattleSimulator.js` · `ColonySimulation.js` · `EventSystem.js`

---

## Inhaltsverzeichnis

1. [Executive Summary & Designphilosophie](#1-executive-summary--designphilosophie)
2. [Strategische Kriegsebene (Victoria-3-Inspiration)](#2-strategische-kriegsebene-victoria-3-inspiration)
3. [Raumkampf-Engine (X4-Inspiration)](#3-raumkampf-engine-x4-inspiration)
4. [Bodenkampf & Invasion](#4-bodenkampf--invasion)
5. [Taktische Formationen & Flottenbefehle](#5-taktische-formationen--flottenbefehle)
6. [Diplomatie, Krieg & Frieden](#6-diplomatie-krieg--frieden)
7. [Waffensysteme & Schiffsmodule](#7-waffensysteme--schiffsmodule)
8. [Kampf-UI & Frontend](#8-kampf-ui--frontend)
9. [Backend-Architektur & API](#9-backend-architektur--api)
10. [Integration mit bestehenden Systemen](#10-integration-mit-bestehenden-systemen)
11. [Balancing-Parameter & Tuning-Knöpfe](#11-balancing-parameter--tuning-knöpfe)
12. [Implementierungs-Roadmap](#12-implementierungs-roadmap)

---

## 1. Executive Summary & Designphilosophie

### 1.1 Vision

GalaxyQuest kombiniert zwei Kampf-Ebenen zu einem kohärenten System:

| Ebene | Inspiration | Charakter |
|---|---|---|
| **Strategischer Krieg** | Victoria 3 | Kriegsziele, Erschöpfung, Friedensverhandlungen, politische Konsequenzen |
| **Taktischer Raumkampf** | X4: Foundations | Flottenverhalten, Distanzmanagement, Formationen, Waffenreichweiten |
| **Bodenkampf** | bestehende `ColonySimulation.invade()` | Truppen, Garnisonen, Rundenbasiert |

Das System soll:

- **Transparent** sein: Ergebnis nachvollziehbar ohne Black-Box-Zufall
- **Strategisch bedeutsam** sein: Kriegsführung hat politische, wirtschaftliche und narrative Konsequenzen
- **Skalierbar** sein: Kleine Piraten-Scharmützel und Großkriege nutzen dieselbe Engine
- **Deterministische Kern-Engine behalten**: `BattleSimulator.simulate()` bleibt die Grundlage; neue Schichten wrappen sie

### 1.2 Abgrenzung zu existierender Implementierung

```
Bestehend (beibehalten)                 Neu (dieses Dokument)
─────────────────────────────────────── ──────────────────────────────────────
BattleSimulator — Schadens-Resolver    Kriegsdeklarations-System
ColonySimulation.invade() — Bodenkampf Kriegsziele & Friedensverhandlungen
EventSystem — Kriegs-Events            War-Exhaustion-Tracker
BattleFleet / SHIP_STATS               Flottenformationen & Kampfcomputer
FleetFormation.js                      Taktische Gefechtsphase UI
FTL-Drive-System                       Vorposten / Frontier-Logik
```

---

## 2. Strategische Kriegsebene (Victoria-3-Inspiration)

### 2.1 Kriegsdeklaration & Kriegsziele

Angelehnt an Victoria 3's „Wargoal"-System. Ein Krieg beginnt nicht ad hoc durch einen Flotten-Angriff, sondern durch eine formale **Kriegserklärung** mit klar definierten Kriegszielen.

#### Kriegsziele (`WarGoal`)

| ID | Name | Bedingung | Siegpunkte bei Erfüllung |
|---|---|---|---|
| `OCCUPY_SYSTEM` | Systembesetzung | Ziel-Sternsystem 14 Tage gehalten | 30 |
| `CONQUER_COLONY` | Kolonie annektieren | Invasion erfolgreich | 50 |
| `HUMILIATE` | Demütigung | Gegner akzeptiert Friedensvertrag | 20 |
| `LIBERATE_COLONY` | Befreiung | Kolonie-Übergabe | 40 |
| `RESOURCE_CLAIM` | Ressourcenanspruch | 1000 Einheiten als Kriegsbeute | 25 |
| `DESTROY_FLEET` | Flottenvernichtung | Feindflotte auf < 10 % reduziert | 35 |
| `ENFORCE_TRIBUTE` | Tributpflicht | Gegner zahlt 500 DM/Tick über 10 Ticks | 30 |

Ein Krieg kann **1–3 Kriegsziele** gleichzeitig haben. Der Angreifer definiert seine Ziele bei der Kriegserklärung; der Verteidiger darf **Gegenziele** deklarieren (analog Victoria 3's Defender-Wargoals).

#### Kriegserklärung — Ablauf

```
Spieler → [Kriegserklärung UI]
  → wählt 1–3 WarGoals
  → Validierung: Casus Belli vorhanden?
  → Kühzeit-Prüfung: letzter Krieg gegen diesen Gegner < 30 Tage?
  → POST /api/war.php  { action: 'declare', target_user_id, war_goals: [...] }
  → Server: War-Eintrag erstellen, Diplomatie-Achsen aktualisieren
  → EventSystem: EventType.FLEET → 'war:declared' Event für beide Spieler
```

#### Casus Belli (`CasusBelli`)

Ohne Casus Belli sinkt die eigene Popularität/Legitimitätspunkte bei anderen Fraktionen:

| Casus Belli | Erwerb |
|---|---|
| `BORDER_INCIDENT` | Feindflotte trat in eigenes System ein |
| `COLONY_RAID` | Feind hat eigene Kolonie angegriffen |
| `ALLIANCE_CALL` | Verbündeter wurde angegriffen |
| `TERRITORIAL_CLAIM` | Forschungs-Anomalie gibt Anspruch auf System |
| `REVENGE_WAR` | Letzter Krieg endete mit > 40 Kriegserschöpfung |
| `NAKED_AGGRESSION` | Kein Casus Belli — Strafpunkte bei allen Neutralen |

### 2.2 War Score & Kriegserschöpfung

**Zwei getrennte Achsen** (angelehnt an Victoria 3):

#### War Score (0–100 pro Seite)

Zeigt, welche Seite ihre Kriegsziele mehr erfüllt. Berechnet aus:

```
warScore = Σ(erfüllte WarGoals × Siegpunkte)
         + Σ(gehaltene feindliche Systeme × 2 pro Tag)
         + Σ(gewonnene Raumschlachten × 5)
         + Σ(erfolgreiche Invasionen × 10)
         - Σ(verlorene Raumschlachten × 3)
```

#### War Exhaustion / Kriegserschöpfung (0–100 pro Seite)

Victoria 3's War Exhaustion ist das zentrale Friedens-Druckmittel. Steigt mit:

| Ereignis | Erschöpfungs-Zuwachs |
|---|---|
| Jeder Kampftick (passiv) | +0.5 / Tag |
| Verlorene Raumschlacht | +5 |
| Verlorene Kolonie | +15 |
| Blockiertes Heimatsystem | +3 / Tag |
| Totale Zerstörung einer Flotte | +10 |
| Feindliche Bombardierung | +2 / Tag |

Erschöpfung-Effekte:

```
Erschöpfung < 30:  Normal
Erschöpfung 30–59: Kolonieproduktion -10 %, Truppenmoral -10 %
Erschöpfung 60–79: Kolonieproduktion -25 %, Bevölkerungsunruhen +20 %
Erschöpfung 80–99: Automatischer Friedens-Druck, NPC-Diplomaten aktiv
Erschöpfung = 100: Erzwungener White-Peace (Status-Quo)
```

> **Designziel**: Bei 100 Erschöpfung erzwingt das System automatisch einen Status-Quo-Frieden — kein Krieg zieht sich endlos hin.

### 2.3 Friedensverhandlungen

Angelehnt an Victoria 3's Friedensverhandlungen (kein Echtzeit-Diktat, sondern Paket-Angebote):

```
Friedensangebot-Paket:
  {
    from:        spieler_id,
    to:          gegner_id,
    terms: [
      { type: 'transfer_system', system_id: 42 },
      { type: 'pay_tribute',     amount: 500, duration_ticks: 10 },
      { type: 'demilitarize',    system_id: 42, duration_ticks: 30 },
      { type: 'white_peace' },
      { type: 'vassalize' },
    ],
    expires_at:  tick + 48,   // 48 Spielticks Gültigkeitsfenster
  }
```

Friedens-Konditionen sind an **War Score** gebunden:

```
Erzwingbare Bedingungen = f(eigener War Score - gegnerischer War Score)

Differenz ≥ 50:  darf Annexion anbieten
Differenz 30–49: darf Systemübergabe + Tribut fordern
Differenz 10–29: darf Demütigung + Ressourcen fordern
Differenz < 10:  nur White Peace möglich
```

---

## 3. Raumkampf-Engine (X4-Inspiration)

### 3.1 Überblick: Zwei-Phasen-Kampf

X4's Kampfsystem kombiniert Distanzmanagement mit Waffenreichweiten-Logik. GalaxyQuest adaptiert dies als deterministische **Phasen-Simulation** auf Basis der bestehenden `BattleSimulator.simulate()`-Engine.

```
Phase 1: APPROACH (Annäherungsphase)     — bestimmt initiale Formation
Phase 2: ENGAGEMENT (Gefechtsphase)      — BattleSimulator-Kern-Rounds
Phase 3: RESOLUTION (Auflösungsphase)    — Überlebende, Retreat, Loot
```

### 3.2 Kampfdistanzen & Waffenreichweiten

Jede Waffe hat eine optimale Reichweite. Schiffe in falscher Distanz kämpfen mit Malus:

| Distanz-Band | Meter (abstrakt) | Bevorzugte Schiffe |
|---|---|---|
| `MELEE` (0–1) | Ramm-/Nahkampf | Corvette, Fighter |
| `SHORT` (1–3) | Nahkampf-Laser | Fighter, Bomber, Frigate |
| `MEDIUM` (3–8) | Standard-Kanonen | Destroyer, Cruiser |
| `LONG` (8–15) | Langstreckenartillerie | Battleship |
| `EXTREME` (15+) | Bombardment | Battleship (vs. Planeten) |

Distanz-Malus auf Schaden:

```javascript
// Pseudo-Code — wird in BattleSimulator als opts.distanceFactor übergeben
const RANGE_EFFICIENCY = {
  optimal:  1.00,
  adjacent: 0.80,
  off:      0.50,
};
```

### 3.3 Kampfcomputer (`CombatComputer`)

X4 unterscheidet zwischen verschiedenen Kampfcomputer-Modi. GalaxyQuest implementiert **5 Taktik-Modi** pro Flotte:

| Modus | Verhalten | Stärke | Schwäche |
|---|---|---|---|
| `AGGRESSIVE` | Maximale Feuerkraft, keine Rückzugsoption | +15 % Schaden | Keine Retreat-Option |
| `BALANCED` | Standard-Engagement | — | — |
| `DEFENSIVE` | Hält Distanz, bevorzugt mittlere Reichweite | +10 % Shield-Regen | -10 % Schaden |
| `EVASIVE` | Kleinere Schiffe fliehen bei 50 % Verlusten | Verlustminimierung | Schlechtere Kill-Rate |
| `ESCORT` | Schützt Carrier/Träger prioritär | Träger-Schutz | Vernachlässigt andere Ziele |

```javascript
// Erweiterung von BattleSimulator.simulate():
const report = BattleSimulator.simulate(attacker, defender, {
  attackerTactic: 'AGGRESSIVE',
  defenderTactic: 'DEFENSIVE',
});
// Taktik-Modifikatoren werden als opts.tacticModifiers auf SHIP_STATS angewendet
```

### 3.4 Flottenformationen (Erweiterung `FleetFormation.js`)

Das bestehende `FleetFormation.js` wird um Kampf-relevante Formationen erweitert:

| Formation | Effekt | Typischer Einsatz |
|---|---|---|
| `DELTA` | Standard, keine Boni/Mali | Allgemein |
| `WALL` | +20 % Shield, -10 % Manöver | Frontalangriff halten |
| `PINCER` | +15 % Schaden, -15 % Defense | Flankenangriff |
| `SCREEN` | Kleinschifte schützen Großkampfschiffe | Carrier-Schutz |
| `SPREAD` | +20 % Ausweichen gegen AOE, -10 % Konzentration | Vs. Bomben-Schwärme |
| `TORPEDO_RUN` | Bomber erhalten +30 % Rapid-Fire gegen Großkampfschiffe | Schlachtschiff-Jagd |

### 3.5 Kampfphasen im Detail

```
┌─────────────────────────────────────────────────────────┐
│ PHASE 1: APPROACH                                        │
│   - Beide Seiten wählen Formation + Taktik-Modus        │
│   - Server berechnet initiales Distanz-Band             │
│   - FTL-Antrieb: Vel'Ar-Stealth gibt Überraschungs-     │
│     bonus (+1 freie Runde für Angreifer)                │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ PHASE 2: ENGAGEMENT (bis zu MAX_ROUNDS = 6)              │
│   - _simulateRound() mit Taktik- und Formations-Modif.  │
│   - Nach jeder Runde: Retreat-Check (EVASIVE-Modus)     │
│   - Carrier-Mechanik: Träger entsenden Jäger-Wellen     │
│   - Spezial-Aktionen: EMP, Boarding, Overload           │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ PHASE 3: RESOLUTION                                      │
│   - Loot-Berechnung (50 % Metallwert Verteidiger-       │
│     Verluste, wie bisher)                               │
│   - Überlebende fliehen / halten System                  │
│   - Wrack-Feld erzeugt DebrisField (EnvironmentFX)      │
│   - War Score Update                                    │
│   - BattleReport.serialize() → DB → Spieler-Journal     │
└─────────────────────────────────────────────────────────┘
```

### 3.6 Spezial-Aktionen (neue Mechaniken)

Jede Flotte kann **1 Spezial-Aktion pro Kampf** ausführen (X4-inspiriert):

| Aktion | Voraussetzung | Effekt |
|---|---|---|
| `EMP_BURST` | Forschung: EMP-Tech Lvl 2 | Gegnerische Schilde für 1 Runde deaktiviert |
| `BOARDING_ACTION` | Forschung: Boarding-Kapseln | 1–3 Feindschiffe gekapert statt zerstört |
| `OVERLOAD_WEAPONS` | keine | +50 % Schaden 1 Runde, danach 1 Runde Abkühlung |
| `EMERGENCY_RETREAT` | keine | Flotte zieht sich zurück, 30 % Schiffe verloren, keine weiteren Verluste |
| `SHIELD_OVERCHARGE` | Forschung: Shield-Boost | Shields für 1 Runde verdoppelt |
| `FIGHTER_WAVE` | Carrier vorhanden | +20 % Rapid-Fire-Bonus für alle Jäger 1 Runde |

---

## 4. Bodenkampf & Invasion

### 4.1 Bestehende Basis (`ColonySimulation.invade()`)

Die existierende Invasion-Engine bleibt als Kern erhalten:

```javascript
// Bestehende Konstanten (ColonySimulation.js) — NICHT ändern
TROOP_ATTACK_VALUE   = 15   // Schaden pro Angreifer-Truppe pro Runde
TROOP_DEFENSE_VALUE  = 50   // Verteidigung pro garnisonierter Truppe
DEFENSE_DPS_FACTOR   = 0.20 // 20 % der Verteidigungsmacht tötet Angreifer/Runde
MAX_INVASION_ROUNDS  = 5
INVASION_LOOT_FRACTION = 0.30
```

### 4.2 Erweiterungen: Bodenkriegs-Tiefe

#### Truppengattungen (neu)

| Gattung | Angriffswert | Verteidigungswert | Spezialfähigkeit |
|---|---|---|---|
| `INFANTRY` | 15 | 50 | Standard (wie bisher) |
| `ARMOR` | 30 | 40 | Ignoriert 20 % Fortifikation |
| `ARTILLERY` | 50 | 20 | +20 % Schaden/Runde, Fernkampf |
| `SPEC_OPS` | 25 | 30 | Kann Kolonie sabotieren vor Invasion |
| `GARRISON` | 10 | 70 | Nur in Verteidigung |

#### Fortifikationsstufen (neu, für Gebäude-Erweiterung)

| Stufe | Beschreibung | Vert.-Multiplikator |
|---|---|---|
| 0 | Keine Befestigung | ×1.0 |
| 1 | Barrikaden | ×1.3 |
| 2 | Bunker | ×1.6 |
| 3 | Festungsanlage | ×2.0 |
| 4 | Orbitale Verteidigung | ×2.5 + 5 Schaden/Runde vs. Angriffsflotte |

Neues Gebäude: `PLANETARY_FORTRESS` (Fortifikation Stufe 3–4), baut auf `BARRACKS` auf.

#### Orbital-Bombardment

Bevor eine Bodeninvasion beginnt, kann der Angreifer bombardieren:

```
Bombardment-Optionen:
  SURGICAL:   Zielt auf Militär     → -20 % Garrison, -10 % Bevölkerung, -Infrastruktur ×0.9
  HEAVY:      Zielt auf Infrastruktur → -30 % Fortifikation, Kolonieproduktion -40 % für 10 Ticks
  CARPET:     Maximale Zerstörung   → -50 % Garrison, -30 % Bevölkerung, kolonieweite Unruhe
```

> **Design-Grenze (Victoria 3 inspiriert):** Carpet-Bombardment erzeugt maximale War Exhaustion (+20) und aktiviert War-Crimes-Events, die Fraktionsbeziehungen dauerhaft verschlechtern.

### 4.3 Invasionsbericht-Erweiterung

`InvasionReport` erhält neue Felder:

```javascript
{
  // Bestehend
  result:        InvasionResult,   // SUCCESS / REPELLED / DRAW
  roundsFought:  number,
  attackerLost:  number,
  defenderLost:  number,
  loot:          ResourceBundle,

  // Neu
  fortificationDestroyed: number,  // Fortifikationsstufen reduziert
  bombardmentDamage:      number,  // Falls Vorabbombardierung
  colonyCaptured:         boolean,
  colonyDamagePercent:    number,  // 0–1: Infrastrukturschäden
  warScoreGain:           number,  // Einfluss auf den War Score
  warExhaustionGain:      number,  // Erschöpfungszuwachs für beide Seiten
}
```

---

## 5. Taktische Formationen & Flottenbefehle

### 5.1 Schlachtordnung (Kampf-UI)

Inspiriert von X4's Flottenbefehlssystem — Spieler ordnen Schiffe in **3 Kampflager** an:

```
┌─────────┐   ┌─────────┐   ┌─────────┐
│  VORTRAB │ → │ HAUPTKORPS│ → │ RESERVE │
│ Fighters │   │ Cruisers │   │ Carriers│
│ Frigates │   │Destroyers│   │Battleshp│
└─────────┘   └─────────┘   └─────────┘
```

**Vortrab**: Zieht Feuerresist auf sich; nimmt Schaden zuerst. Bonus: +10 % Evasion.  
**Hauptkorps**: Maximale Feuerkraft. Keine Boni/Mali.  
**Reserve**: Tritt erst ein wenn Vortrab < 50 %. Bonus: Schilde zu Kampfbeginn bei 150 %.

### 5.2 Automatische Schlachtordnung (KI-Empfehlung)

Bei Klick auf „Automatisch anordnen" sortiert der Server nach:

```
Vortrab  ← Fighter, Bomber, Corvette, Frigate
Hauptkorps ← Destroyer, Cruiser
Reserve  ← Battleship, Carrier
```

### 5.3 Flottenbefehle außerhalb des Kampfes

Erweiterung der bestehenden Fleet-Mission-Liste (aktuell: Attack · Transport · Colonize · Spy · Harvest):

| Befehl | Beschreibung |
|---|---|
| `PATROL` | Wiederkehrendes Patrol-Muster in definiertem Radius; greift feindliche Flotten an |
| `BLOCKADE` | Besetzt Sternsystem; blockiert Ressourcen-Import/Export des Gegners |
| `BOMBARDMENT` | Orbitales Bombardment ohne Bodeninvasion; erhöht War Exhaustion beider Seiten |
| `ESCORT` | Folgt Ziel-Flotte und greift Angreifer automatisch an |
| `RESERVE` | Wartet auf Abfangrequest durch verbündete Flotte |
| `REINFORCE` | Schließt sich Kampf anderer eigener Flotte an (wenn < 3 Systemsprünge entfernt) |

---

## 6. Diplomatie, Krieg & Frieden

### 6.1 Diplomatische Beziehungsachsen

Analog zu Stellaris/Victoria 3 — zwei unabhängige Achsen:

```
VERTRAUEN  (Trust)   : -100 … +100   (aufgebaut durch Verträge, Handel, Hilfe)
BEDROHUNG  (Threat)  : 0 … +100      (steigt mit Kriegserklärungen, Flottengröße)
```

Kombinierte Diplo-Stance:

| Vertrauen | Bedrohung | Haltung |
|---|---|---|
| > +50 | < 20 | `ALLY` — automatische Kriegshilfe |
| +20 … +50 | < 40 | `FRIENDLY` — keine Agression |
| -20 … +20 | beliebig | `NEUTRAL` — individuell verhandelbar |
| < -20 | > 40 | `RIVAL` — kann Kriegsziele gegen diesen Spieler deklarieren |
| < -50 | > 60 | `ENEMY` — aktiver Kriegszustand möglich |

### 6.2 Allianz-System

Erweiterung von `faction_relations.php`:

| Typ | Mechanik |
|---|---|
| `NON_AGGRESSION_PACT` | Kein Angriff für X Ticks |
| `TRADE_AGREEMENT` | +15 % Handelserträge beider Partner |
| `DEFENSIVE_PACT` | Automatische Kriegshilfe wenn Partner angegriffen |
| `MILITARY_ALLIANCE` | Kriegshilfe + gemeinsame Kriegsziele |
| `VASSALAGE` | Vasall zahlt Tribut, Überherr schützt |

### 6.3 Kriegsmüdigkeit als Friedensmechanismus (Victoria 3)

Das zentrale Design-Ziel: **Kriege sollen enden**. War Exhaustion ist der primäre Friedens-Druck-Mechanismus:

```
Exhaustion 80–99:
  → NPC-Diplomaten (EventSystem) bieten Vermittlung an
  → Eigene Kolonisten veranstalten Friedensproteste (colony:unrest += 20)
  → Militärproduktion -20 %

Exhaustion 100:
  → Automatischer White Peace (Status Quo ante bellum)
  → Beide Seiten erhalten: cooldown_war = 30 Ticks
  → Beide Seiten erhalten: Stabilisierungs-Bonus +20 für 10 Ticks
```

### 6.4 Kriegsverbrechen & moralische Konsequenzen

Bestimmte Aktionen erzeugen permanente Diplomatie-Strafen:

| Aktion | Konsequenz |
|---|---|
| Carpet-Bombardment | Trust -30 bei allen beobachtenden Fraktionen |
| Slaverei-Steuern auf annektierter Kolonie | Faction-Standing -50 bei allen Gilden-NPCs |
| Gefangene exekutieren | Faction-Standing -25, Eventchain: „Kriegsverbrechen-Tribunal" |
| Sternsystem-Zerstörung (Endgame) | Permanent-Feindschaft aller Fraktionen |

---

## 7. Waffensysteme & Schiffsmodule

### 7.1 Waffenkategorien

Aufbauend auf `VESSEL_MODULE_BLUEPRINT_DESIGN.md` — Waffen sind jetzt auch **kampfsystemrelevant**:

| Kategorie | Gegen | Stärke |
|---|---|---|
| `KINETIC` | Hull | Ignoriert 50 % Shield |
| `ENERGY` (Laser) | Shield | +50 % vs. Shield, -30 % vs. Hull |
| `MISSILE` | alle | Rapid-Fire gegen Großkampfschiffe |
| `PLASMA` | Hull + Shield | Balanced, teuer |
| `EMP` | Shield + Elektronik | Deaktiviert Schilde 1 Runde |
| `TORPEDO` | Hull | Enorm vs. Battleship/Carrier, langsam |
| `POINT_DEFENSE` | gegnerische Raketen | Reduziert Missile-Schaden um 60 % |

Jede Schiffsklasse hat **Waffenslots** (angelehnt an Vessel Module Blueprints):

```
Fighter:    1× Small Weapon
Corvette:   2× Small Weapon + 1× Medium Weapon
Frigate:    3× Medium Weapon
Destroyer:  2× Medium + 1× Large + 1× Point Defense
Cruiser:    2× Large + 2× Medium + 2× Point Defense
Battleship: 3× Large + 1× XL (Torpedo/Bombardment)
Carrier:    2× Medium (Träger-Verteidigung) + 4× Fighter Bays
```

### 7.2 Schiffsklassen-Stärken-Schwächen Matrix

Aktualisierung der bestehenden `rapidFire`-Tabelle um Waffenklassen-Boni:

```
                 vs. Fighter  vs. Corvette  vs. Frigate  vs. Destroyer  vs. Cruiser  vs. Battleship  vs. Carrier
Fighter          ×1.0         ×0.8          ×0.6         ×0.3           ×0.2         ×0.1            ×0.2
Bomber           ×0.5         ×0.7          ×0.8         ×1.5           ×1.2         ×2.0 (RF×10)    ×1.5
Frigate          ×2.0 (RF×5)  ×1.5 (RF×3)  ×1.0         ×0.8           ×0.5         ×0.3            ×0.4
Destroyer        ×3.0 (RF×10) ×2.0 (RF×5)  ×1.2 (RF×3)  ×1.0           ×0.7         ×0.5            ×0.6
Cruiser          ×5.0 (RF×20) ×4.0 (RF×15) ×2.0 (RF×8)  ×1.5           ×1.0         ×0.8            ×0.9
Battleship       ×6.0 (RF×30) ×5.0 (RF×25) ×3.0 (RF×15) ×1.5 (RF×5)   ×1.2         ×1.0            ×1.5
Carrier          ×0.3         ×0.4          ×0.5         ×0.6           ×0.7         ×0.8            ×1.0
```

---

## 8. Kampf-UI & Frontend

### 8.1 Kampf-Vorschau-Panel (Pre-Battle Screen)

Vor dem Angriff zeigt das UI eine **Kampf-Vorschau** (X4-Style Flottenvergleich):

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚔️  KAMPF-VORSCHAU                                               │
│─────────────────────────────────────────────────────────────────│
│  ANGREIFER                          VERTEIDIGER                 │
│  Deine Flotte                       NPC: Piraten-Basis          │
│  ─────────────                      ──────────────────          │
│  20× Fighter   [██████████░░]       5× Destroyer  [████████░░] │
│  5× Destroyer  [████░░░░░░░░]       2× Cruiser    [██████░░░░] │
│  2× Cruiser    [██░░░░░░░░░░]                                    │
│                                                                  │
│  Flottenstärke: 124.500              Flottenstärke: 98.200      │
│  Siegchance:    ~67 %               ─────────────────────────  │
│                                                                  │
│  Formation: [DELTA ▼]   Taktik: [AGGRESSIVE ▼]                 │
│  Spezial-Aktion: [EMP_BURST ▼]                                  │
│                                                                  │
│  [Angriff starten]   [Abbrechen]                                │
└─────────────────────────────────────────────────────────────────┘
```

Implementierung: `CombatPreviewPanel` als neue Klasse, GQUI-Fluent-Builder (wie `ShipyardController`).

### 8.2 Echtzeit-Kampf-Visualisierung

Während die `BattleSimulator.simulate()` läuft (server-side), wird das Ergebnis runden-weise an das Frontend gesendet:

```
Server → SSE (Server-Sent Events) oder WebSocket:
  {
    type: 'battle:round',
    round: 1,
    attackerShips: { fighter: 18, destroyer: 5, cruiser: 2 },  // nach dieser Runde
    defenderShips: { destroyer: 4, cruiser: 2 },
    attackerDamage: 12400,
    defenderDamage: 8900,
  }
```

Das Frontend animiert die Runden mit den bestehenden **CombatFX-System** (`CombatFX.js`, `BeamEffect.js`, `GPUParticleSystem.js`):

- `WeaponType.LASER` → `BeamEffect` (bestehend)
- `ExplosionType.SHIP_DESTRUCTION` → `VoxelDebris` (bestehend)
- `ShieldImpactType.BUBBLE` → `ParticleEmitter` (bestehend)

### 8.3 Kampfbericht-Panel

Erweiterung des bestehenden Reports-Systems (`reports.php`):

```
┌─────────────────────────────────────────────────────────────────┐
│  📋 KAMPFBERICHT #4821 — System Kepler-442                       │
│─────────────────────────────────────────────────────────────────│
│  ✅ SIEG (Angreifer)  ·  3 Runden  ·  Koordinaten: [3,7,12]    │
│─────────────────────────────────────────────────────────────────│
│  VERLUSTE                                                        │
│  Angreifer: -8 Fighter, -1 Destroyer       Metallwert: 28.000   │
│  Verteidiger: -5 Destroyer, -2 Cruiser     Metallwert: 260.000  │
│─────────────────────────────────────────────────────────────────│
│  🎁 Beute: 130.000 Metall                                        │
│  📊 War Score: +15 Punkte                                        │
│  😰 Kriegserschöpfung: +5                                        │
│─────────────────────────────────────────────────────────────────│
│  Runde 1: ATT 45.200 Dmg ← DEF 31.100 Dmg                      │
│  Runde 2: ATT 41.800 Dmg ← DEF 28.900 Dmg                      │
│  Runde 3: ATT 38.600 Dmg ← DEF 12.400 Dmg                      │
│─────────────────────────────────────────────────────────────────│
│  [Flotte anzeigen]  [System besuchen]  [Kriegs-Übersicht]       │
└─────────────────────────────────────────────────────────────────┘
```

### 8.4 Kriegs-Übersichts-Panel

Neues Panel `WarOverviewPanel` mit:

- Aktive Kriege (eigene + NPC-Kriege, die den Spieler betreffen)
- War Score Balken (beide Seiten)
- War Exhaustion Fortschrittsbalken mit Farb-Eskalation (grün → gelb → orange → rot)
- Kriegsziele-Liste mit Status (erfüllt / in Bearbeitung / fehlgeschlagen)
- Friedensangebot-Button
- Waffenstillstand-Button

### 8.5 Bodenkampf-Visualisierung

Erweiterung des Colony-Panels:

```
┌─────────────────────────────────────────────────────────────────┐
│  🪖 INVASION: Kepler-442b                                         │
│─────────────────────────────────────────────────────────────────│
│  Angreifer: 50 Truppen (25 Infantry, 15 Armor, 10 Artillery)    │
│  Verteidiger: Garrison 20 + Fortifikation Lvl 2                 │
│─────────────────────────────────────────────────────────────────│
│  [████████████████░░░░░░░░░░░] Runde 1 — Gefecht läuft...       │
│─────────────────────────────────────────────────────────────────│
│  Bombardment-Option: ○ Chirurgisch  ○ Schwer  ● Keins           │
│─────────────────────────────────────────────────────────────────│
│  [Invasion starten]  [Rückzug]                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Backend-Architektur & API

### 9.1 Neue Datenbanktabellen

```sql
-- Aktive Kriege
CREATE TABLE wars (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  attacker_id     INT NOT NULL REFERENCES users(id),
  defender_id     INT NOT NULL REFERENCES users(id),
  started_at      BIGINT NOT NULL,           -- game tick
  ended_at        BIGINT,
  war_score_att   INT NOT NULL DEFAULT 0,    -- 0–100
  war_score_def   INT NOT NULL DEFAULT 0,
  exhaustion_att  INT NOT NULL DEFAULT 0,    -- 0–100
  exhaustion_def  INT NOT NULL DEFAULT 0,
  status          ENUM('active','peace','white_peace','victory_att','victory_def') DEFAULT 'active',
  casus_belli     VARCHAR(64),
  INDEX (attacker_id), INDEX (defender_id)
);

-- Kriegsziele
CREATE TABLE war_goals (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  war_id      INT NOT NULL REFERENCES wars(id),
  owner_id    INT NOT NULL REFERENCES users(id),
  goal_type   VARCHAR(64) NOT NULL,           -- OCCUPY_SYSTEM etc.
  target_id   INT,                            -- system_id / colony_id etc.
  fulfilled   TINYINT(1) DEFAULT 0,
  score_value INT NOT NULL DEFAULT 0
);

-- Friedensangebote
CREATE TABLE peace_offers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  war_id      INT NOT NULL REFERENCES wars(id),
  from_id     INT NOT NULL REFERENCES users(id),
  terms_json  TEXT NOT NULL,                  -- JSON-Bedingungen
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  status      ENUM('pending','accepted','rejected','expired') DEFAULT 'pending'
);

-- Kampfberichte (Erweiterung)
-- Bestehende battle_reports Tabelle erhält neue Spalten:
ALTER TABLE battle_reports ADD COLUMN war_id INT REFERENCES wars(id);
ALTER TABLE battle_reports ADD COLUMN tactic_att VARCHAR(32);
ALTER TABLE battle_reports ADD COLUMN tactic_def VARCHAR(32);
ALTER TABLE battle_reports ADD COLUMN formation_att VARCHAR(32);
ALTER TABLE battle_reports ADD COLUMN formation_def VARCHAR(32);
ALTER TABLE battle_reports ADD COLUMN special_action_att VARCHAR(32);
ALTER TABLE battle_reports ADD COLUMN war_score_delta INT DEFAULT 0;
ALTER TABLE battle_reports ADD COLUMN exhaustion_delta INT DEFAULT 0;
ALTER TABLE battle_reports ADD COLUMN round_log JSON;  -- Rundenweise Daten für Replay
```

### 9.2 Neue API-Endpunkte (`api/war.php`)

```
POST /api/war.php
  action=declare
    → { target_user_id, war_goals: [{type, target_id}], casus_belli }
    ← { war_id, status, war_score, exhaustion }

  action=offer_peace
    → { war_id, terms: [{type, ...}] }
    ← { offer_id, expires_at }

  action=respond_peace
    → { offer_id, accept: bool }
    ← { war_status, new_state }

  action=get_status
    → { war_id }
    ← { war_score_att, war_score_def, exhaustion_att, exhaustion_def, goals: [...] }

  action=list
    → {}
    ← { wars: [{ war_id, opponent, war_score, exhaustion, status }] }
```

### 9.3 Erweiterung `api/fleet.php`

```
POST /api/fleet.php
  action=attack (bestehend — erweitert)
    → { + tactic, formation, special_action }
    ← { + war_score_delta, exhaustion_delta, tactic_applied }

  action=bombard (neu)
    → { fleet_id, colony_id, mode: 'SURGICAL'|'HEAVY'|'CARPET' }
    ← { damage_report, war_score_delta, exhaustion_delta }

  action=patrol (neu)
    → { fleet_id, system_id, radius }
    ← { patrol_id }

  action=blockade (neu)
    → { fleet_id, system_id }
    ← { blockade_id, started_at }
```

### 9.4 Erweiterung `api/game_engine.php` (Tick-Loop)

Im Game-Engine-Tick werden folgende Aktionen ergänzt:

```php
// Im Tick-Loop ergänzen:
process_war_exhaustion();     // War Exhaustion pro Tag erhöhen
check_war_goals();            // Kriegsziele auf Erfüllung prüfen
process_peace_timeouts();     // Abgelaufene Friedensangebote ablehnen
check_forced_peace();         // Bei Exhaustion 100 → White Peace erzwingen
process_blockade_effects();   // Blockade-Ressourcen-Malus anwenden
fire_war_events();            // EventSystem: Kriegs-bezogene Events triggern
```

### 9.5 Projektion-Integration (`lib/projection_runtime.php`)

Das bestehende Projektion-System wird für Kriegs-State-Snapshots genutzt:

```
scripts/project_war_snapshots.php:
  - enqueue_projection_dirty() für alle aktiven Kriege
  - Berechnet: Prognose war_score bei aktueller Aktivität
  - Aktualisiert: users.war_exhaustion_summary (für UI-Darstellung)
```

---

## 10. Integration mit bestehenden Systemen

### 10.1 EventSystem-Integration

Neue Events für das Kampfsystem (in `EventSystem.js`):

```javascript
// Neue EventType-Werte (zu bestehenden hinzufügen):
WAR_DECLARED:      'war:declared',
WAR_ENDED:         'war:ended',
BATTLE_WON:        'battle:won',
BATTLE_LOST:       'battle:lost',
WAR_EXHAUSTION_HIGH: 'war:exhaustion:high',
PEACE_OFFERED:     'peace:offered',
SYSTEM_BLOCKADED:  'system:blockaded',
COLONY_BOMBARDED:  'colony:bombarded',
```

Neue Journal-Einträge (Victoria-3-Style Objectives):

```javascript
defineJournalEntry({
  id: 'FIRST_WAR_VICTORY',
  title: 'Erster Kriegssieg',
  description: 'Gewinne einen Krieg gegen einen anderen Spieler.',
  condition: (gs) => gs.wars.some(w => w.winner === gs.userId),
  reward: { darkMatter: 200 },
});

defineJournalEntry({
  id: 'TOTAL_ANNIHILATION',
  title: 'Totale Vernichtung',
  description: 'Zerstöre eine feindliche Flotte vollständig in einer einzigen Schlacht.',
  condition: (gs) => gs.lastBattle?.winner === 'attacker' && gs.lastBattle?.defenderRemaining.isEmpty,
  reward: { darkMatter: 500 },
});
```

### 10.2 ColonySimulation-Integration

Kriegs-Effekte auf Kolonien:

```javascript
// ColonySimulation.tick() ergänzen:
if (colony.isBlockaded) {
  colony._stockpile.food    *= 0.85;   // Importe blockiert
  colony._stockpile.credits *= 0.90;
  colony.happiness          -= 5;
}
if (colony.isBombarded) {
  colony.population -= Math.floor(colony.population * 0.02);
  colony.unrest     += 10;
}
```

### 10.3 ResearchTree-Integration

Neue Forschungen für das Kampfsystem (in `ResearchTree.js`):

| Tech-ID | Name | Effekt |
|---|---|---|
| `COMBAT_AI_1` | Basis-Kampfcomputer | Taktik-Modi freigeschaltet |
| `COMBAT_AI_2` | Fortgeschrittener Kampfcomputer | +10 % Feuerkraft |
| `EMP_TECH` | EMP-Technologie | EMP_BURST Spezial-Aktion |
| `BOARDING_CAPS` | Enterkapsel-Technologie | BOARDING_ACTION Spezial-Aktion |
| `SHIELD_BOOST` | Schild-Überladung | SHIELD_OVERCHARGE Spezial-Aktion |
| `ORBITAL_DEFENSE` | Orbitale Verteidigung | Fortifikation Lvl 4 für Kolonien |
| `WAR_DOCTRINE` | Kriegsdoktrin | War Exhaustion -20 % Aufbaurate |
| `DIPLOMATIC_CORPS` | Diplomatisches Korps | Friedensverhandlungs-Bonus |

### 10.4 FTL-System-Integration

Bestehende FTL-Antriebe haben Kampf-Effekte:

| FTL-Antrieb | Kampf-Effekt |
|---|---|
| `Vel'Ar OD-5` (Stealth) | Überraschungsangriff: +1 freie Angriffsrunde |
| `Kryl'Tha` (hull_damage) | Bei Retreat: Schiff verliert 15 % Hull aber rettet sich |
| `Vor'Tak` (Carrier-Bonus) | Carrier-Welle: +1 Fighter-Welle pro Kampf |
| `Syl'Nar` (Gate-Bau) | Gate-Nexus: Verstärkungen können sofort teleportieren |

### 10.5 CombatFX-System-Integration

Bestehende FX-Systeme werden an Kampfereignisse geknüpft:

```javascript
// BattleEventBridge — neues Modul
// Verbindet BattleReport-Rounds mit CombatFX-Animationen

import { CombatFX, WeaponType, ExplosionType } from '../fx/CombatFX.js';
import { BeamEffect } from '../fx/BeamEffect.js';
import { VoxelDebris } from '../fx/VoxelDebris.js';

function animateBattleRound(roundData, scene) {
  // Beam-Effekte für Laser-Treffer
  roundData.hits.forEach(hit => {
    if (hit.weaponType === 'ENERGY') {
      new BeamEffect(scene, hit.from, hit.to).play();
    }
  });

  // Explosion für zerstörte Schiffe
  roundData.destroyed.forEach(ship => {
    CombatFX.createExplosion(scene, ship.position, ExplosionType.SHIP_DESTRUCTION);
    VoxelDebris.spawn(scene, ship.position, ship.class);
  });
}
```

---

## 11. Balancing-Parameter & Tuning-Knöpfe

### 11.1 Zentrale Konstanten (neue `config/combat_config.php`)

```php
// Strategische Ebene
define('WAR_EXHAUSTION_PASSIVE_PER_DAY',    0.5);
define('WAR_EXHAUSTION_LOST_BATTLE',        5);
define('WAR_EXHAUSTION_LOST_COLONY',        15);
define('WAR_EXHAUSTION_BLOCKADE_PER_DAY',   3);
define('WAR_EXHAUSTION_FORCED_PEACE',       100);
define('WAR_SCORE_OCCUPY_PER_DAY',          2);
define('WAR_COOLDOWN_TICKS',                30);

// Taktische Ebene
define('TACTIC_AGGRESSIVE_DAMAGE_BONUS',    0.15);
define('TACTIC_DEFENSIVE_SHIELD_REGEN',     0.10);
define('TACTIC_EVASIVE_RETREAT_THRESHOLD',  0.50);
define('FORMATION_WALL_SHIELD_BONUS',       0.20);
define('FORMATION_PINCER_DAMAGE_BONUS',     0.15);
define('SURPRISE_ATTACK_FREE_ROUNDS',       1);

// Bodenkampf
define('BOMBARDMENT_SURGICAL_GARRISON_LOSS',  0.20);
define('BOMBARDMENT_HEAVY_FORTIF_LOSS',       0.30);
define('BOMBARDMENT_CARPET_GARRISON_LOSS',    0.50);
define('BOMBARDMENT_CARPET_POP_LOSS',         0.30);
define('BOMBARDMENT_CARPET_EXHAUSTION',       20);
define('FORTIFICATION_LVL3_DEFENSE_MULT',     2.0);
define('FORTIFICATION_LVL4_DEFENSE_MULT',     2.5);
```

### 11.2 Balancing-Richtlinien

- **Kein Snowball-Effekt**: Ein früher Kriegssieg soll nicht exponentiell weitere Vorteile geben. War Exhaustion steigt für den Sieger ebenfalls.
- **Verteidigungsbonus**: Verteidiger sollten strukturell leicht im Vorteil sein (Fortifikationen, System-Kenntnis). Verhältnis: ~1.2× für gleiche Flottensträrke.
- **Kosten des Krieges**: Kriegsführung soll wirtschaftlich spürbar sein. Kolonieproduktion -10 % nach 1 Woche Krieg als Basis.
- **Diplomatische Alternativen**: Krieg soll immer die riskantere Option gegenüber Diplomatie sein.

---

## 12. Implementierungs-Roadmap

### Phase K-1: Strategie-Grundlage (Backend)

- [ ] `sql/migrate_combat_v1_wars.sql` — Tabellen `wars`, `war_goals`, `peace_offers`
- [ ] `api/war.php` — declare, offer_peace, respond_peace, get_status, list
- [ ] `api/game_engine.php` — War-Exhaustion-Tick, forced-peace-Logik
- [ ] `config/combat_config.php` — Alle Balancing-Konstanten

### Phase K-2: BattleSimulator-Erweiterungen (Frontend/Engine)

- [ ] `js/engine/game/BattleSimulator.js` — Taktik-Modi als `opts.tactic*`
- [ ] `js/engine/game/BattleSimulator.js` — Formations-Modifikatoren als `opts.formation*`
- [ ] `js/engine/game/BattleSimulator.js` — Spezial-Aktionen als `opts.specialAction*`
- [ ] `js/engine/game/BattleSimulator.js` — Distanz-Band-Logik
- [ ] Tests: `tests/js/battle-simulator-extended.test.js`

### Phase K-3: Bodenkampf-Erweiterungen

- [ ] `js/engine/game/ColonySimulation.js` — Truppengattungen
- [ ] `js/engine/game/ColonySimulation.js` — Fortifikationsstufen
- [ ] `api/fleet.php` — `action=bombard`
- [ ] Tests: `tests/js/colony-invasion-extended.test.js`

### Phase K-4: Diplomatie-System

- [ ] `api/faction_relations.php` — Trust/Threat-Achsen
- [ ] `api/war.php` — Allianz-System
- [ ] `js/engine/game/EventSystem.js` — Kriegs-Events + Journal-Einträge
- [ ] Tests: `tests/js/war-events.test.js`

### Phase K-5: Frontend-UI

- [ ] `js/game.js` — `CombatPreviewPanel` (GQUI-Fluent-Builder)
- [ ] `js/game.js` — `WarOverviewPanel`
- [ ] `js/game.js` — Erweiterter Kampfbericht
- [ ] `js/game.js` — Bodenkampf-Visualisierung im Colony-Panel
- [ ] `js/api.js` — Neue API-Aufrufe für war.php

### Phase K-6: FX-Integration

- [ ] `js/engine/fx/BattleEventBridge.js` — Verbindet BattleReport mit CombatFX
- [ ] Integration: `BeamEffect`, `VoxelDebris`, `GPUParticleSystem` mit Kampfphasen
- [ ] `EnvironmentFX.DebrisField` nach Kampfende im Sternsystem
- [ ] Tests: `tests/js/battle-fx-bridge.test.js`

### Phase K-7: Balancing & Projektionen

- [ ] `scripts/project_war_snapshots.php`
- [ ] Balance-Testläufe: 1000× simulierte Kriege mit Zufalls-Flotten
- [ ] Anpassung der Konstanten in `combat_config.php`

---

## Anhang A: Glossar

| Begriff | Bedeutung |
|---|---|
| **War Score** | 0–100 Punkte, zeigt Kriegs-Fortschritt einer Seite |
| **War Exhaustion** | 0–100 Punkte, erzwingt bei 100 Waffenstillstand |
| **WarGoal** | Spezifisches Kriegsziel (Systemannexion, Tribut etc.) |
| **Casus Belli** | Rechtmäßiger Kriegsgrund |
| **White Peace** | Status-quo-Frieden ohne Änderungen |
| **CombatComputer** | KI-Taktik-Modus einer Flotte |
| **BattleFleet** | Bestehende JS-Klasse mit Schiffs-Komposition |
| **BattleReport** | Bestehende JS-Klasse mit Kampf-Ergebnis |
| **InvasionResult** | Bestehende Enum: SUCCESS / REPELLED / DRAW |
| **Formation** | Anordnung der Schiffe in Kampflager (Vortrab/Hauptkorps/Reserve) |
| **Rapid-Fire** | Bestehende Mechanik: n Schüsse gegen spezifischen Schiffstyp |
| **Fortifikation** | Gebäude-gestützte Boden-Verteidigungsstufe |

## Anhang B: Referenz-Implementierungen

| Datei | Relevanz |
|---|---|
| `js/engine/game/BattleSimulator.js` | Kern-Kampf-Engine (beibehalten) |
| `js/engine/game/ColonySimulation.js` | Invasion/Garrison-System (erweitern) |
| `js/engine/game/EventSystem.js` | Event/Journal-System (erweitern) |
| `js/engine/game/FleetFormation.js` | Formationen (erweitern) |
| `js/engine/game/ResearchTree.js` | Forschung (erweitern) |
| `js/engine/fx/CombatFX.js` | Waffen-FX (integrieren) |
| `js/engine/fx/BeamEffect.js` | Strahl-FX (integrieren) |
| `js/engine/fx/VoxelDebris.js` | Trümmer-FX (integrieren) |
| `js/engine/fx/EnvironmentFX.js` | Umgebungs-FX (Wrack-Feld) |
| `api/fleet.php` | Fleet-Aktionen (erweitern) |
| `api/game_engine.php` | Tick-Loop (erweitern) |
| `api/faction_relations.php` | Diplomatie (erweitern) |
| `FTL_DRIVE_DESIGN.md` | FTL-Kampf-Integrationen |
| `VESSEL_MODULE_BLUEPRINT_DESIGN.md` | Waffenslots |
| `GAMEPLAY_DATA_MODEL.md` | Victoria-3-Designmuster |
