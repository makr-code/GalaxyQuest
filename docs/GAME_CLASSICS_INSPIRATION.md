# GAME_CLASSICS_INSPIRATION.md

# Spieleklassiker-Inspirationen für GalaxyQuest

Eine dokumentierte Analyse der übernommenen Konzepte, Mechaniken und Design-Prinzipien
aus etablierten Space-Strategy-Titeln.

---

## Übersicht

| Spiel | Studio | Genre | Was übernommen |
|---|---|---|---|
| **Master of Orion** | SimTex (1993) | 4X Turn-based | Colony-Allokation, Forschungsbaum, Schiffsdesign |
| **X4: Foundations** | Egosoft (2018) | Space Sandbox | Multi-Viewport-Kameras, Wing-System, Eigentumsmanagement |
| **Endless Space 2** | Amplitude Studios (2017) | 4X Turn-based | Tech-Affinitäten, FIDS-System, Flotten-Karten |
| **Victoria 3** | Paradox (2022) | Grand Strategy | Pop-System, Jobs, Waren-Ketten, Journal-Events |
| **Stellaris** | Paradox (2016) | 4X Real-time | Events mit Choices, Anomalie-System, Planeten-Distrikte |
| **Homeworld** | Relic (1999) | RTS 3D Space | 3D-Formationen, cinematic Kamera, Ressourcensammler |
| **Elite Dangerous** | Frontier (2014) | Space Sim | Multi-Panel Cockpit-UI, Wing-System, System-Scanner |
| **EVE Online** | CCP Games (2003) | MMORPG Space | Multi-Window-UI, Markt-System, Flotten-Warps |

---

## 1. Master of Orion (1993 / 2016)

### Übernommene Konzepte

#### Colony Pop Allocation (`js/engine/game/ColonySimulation.js`)
Das klassische **Farmer / Worker / Scientist**-Dreieck aus MoO1 ist direkt in
`ColonySimulation.js` abgebildet:

```javascript
// MoO-Konzept: jeder Pop hat einen Job-Typ
const PopJob = {
  FARMER:    'farmer',    // → Nahrung (verhindert Hunger)
  WORKER:    'worker',    // → Produktion (Schiffe, Gebäude)
  SCIENTIST: 'scientist', // → Forschungspunkte
  SOLDIER:   'soldier',   // → Verteidigung (MoO: Marine)
};
```

**Erweiterung gegenüber MoO:** Pop-Wachstum als logistische Kurve (schneller
bei niedriger Auslastung), Stabilitätsmechanik (Victoria 3-inspiriert),
Unrest-Feedback-Loop.

#### Research Tree (`js/engine/game/ResearchTree.js`)
MoO2 hat 6 Forschungskategorien mit Prerequisite-Abhängigkeiten —
identisch zu unserem `ResearchCategory`-Enum:

```javascript
// MoO2-Kategorien direkt mappbar:
PROPULSION  → Warp Drive Tiers
WEAPONS     → Energy / Physical / Missiles
SHIELDS     → Armour / Deflectors
COMPUTING   → Computers / Electronics
```

---

## 2. X4: Foundations (2018)

### Übernommene Konzepte

#### Multi-Viewport Kameras (`js/engine/ViewportManager.js`)
X4 hat **Satellitenkameras** und **Anflugkameras**, die als kleine HUD-Panels
angezeigt werden. Exakt das, was `ViewportManager.js` implementiert:

```javascript
// X4: Player-owned assets können überwacht werden
engine.addFollowViewport('carrier-nemesis', myCarrier, {
  label: 'ANS Nemesis',
  mode: FollowMode.ORBIT,
  distance: 500,
});
```

**Technische Anlehnung:** X4 nutzt identisches CSS-ähnliches Panel-System
mit Drag + Close + Resize. Die WGSL-Phase wird echte GPU-Subpasses nutzen.

#### Wing System (`js/engine/game/FleetFormation.js`)
X4's **Wing Assignments** (Pilot → Subordinate → Wing) sind in `FleetFormation.js`
abgebildet mit gleicher Terminologie:

```javascript
const alphaWing = formations.createWing('Alpha Wing', FormationShape.WEDGE, {
  leader:  flagshipNemesis,
  spacing: 120,
});
alphaWing.add(fighter1);
alphaWing.add(fighter2);
```

**Formation Shapes** direkt aus X4: Attack Formation (= WEDGE), Defensive
Formation (= SPHERE), Column Formation (= COLUMN).

---

## 3. Endless Space 2 (2017)

### Übernommene Konzepte

#### Research Affinities (`js/engine/game/ResearchTree.js`)
ES2's **Affinity System** (manche Fraktionen forschen schneller in bestimmten
Bereichen) ist 1:1 in `ResearchTree` übernommen:

```javascript
// Sophon-Fraktion: +50% Forschungsgeschwindigkeit überall
tree.setAffinity(ResearchCategory.COMPUTING, 1.5);

// Cravers: schnelle Industrie, langsame Biologie
tree.setAffinity(ResearchCategory.INDUSTRY,  1.8);
tree.setAffinity(ResearchCategory.BIOLOGY,   0.4);
```

#### FIDS-System Ressourcen
ES2's **Food, Industry, Dust (Credits), Science** sind direkt die Ressourcen
in `ColonySimulation.stockpile`:

```javascript
// ES2 FIDS → GalaxyQuest
Food       → stockpile.food
Industry   → stockpile.production
Dust       → stockpile.credits
Science    → stockpile.research
```

#### Fleet Battle Cards → EventSystem
ES2's Karten-basiertes Kampfsystem hat eine direkte Parallele im
`EventSystem` (Choices = Karten):

```javascript
evtSys.define({
  id: 'battle.ambush',
  type: EventType.FLEET,
  choices: [
    { label: 'Battle Formation',    effect: (gs) => gs.combat_bonus += 20 },
    { label: 'Evasive Maneuvers',   effect: (gs) => gs.evasion      += 15 },
    { label: 'Emergency Warp Out',  effect: (gs) => gs.fleet_lost   = false },
  ],
});
```

---

## 4. Victoria 3 (2022)

### Übernommene Konzepte

#### Pop-System mit Jobs (`js/engine/game/ColonySimulation.js`)
Victoria 3 hat das detaillierteste Pop-System aller Strategie-Spiele.
Übernommene Elemente:

- **Pops als zählbare Einheiten** (nicht abstrahiert)
- **Job-Hierarchie** mit Produktivitätsunterschieden (Ruler > Scientist > Worker)
- **Goods Consumption** → hier: `food` als primäre Verbrauchsressource
- **Stability / Unrest Feedback Loop:**
  ```
  Unemployment → Unrest steigt → Stability sinkt → Produktivität sinkt
  → weniger Credits → weniger Armeen → weniger Stability
  ```

#### Journal Events (`js/engine/game/EventSystem.js`)
Victoria 3's **Journal Entries** (laufende Quest-Events mit Choices) sind
die direkte Inspiration für `EventSystem`:

```javascript
evtSys.define({
  id:   'political.workers_strike',
  type: EventType.POLITICAL,
  title: 'Industriearbeiter streiken',
  body:  'Die Werftarbeiter auf Ignis Prime fordern bessere Bedingungen…',
  condition: (gs) => gs.colony('ignis').unrest > 0.5,
  choices: [
    { label: 'Forderungen erfüllen',  effect: (gs) => { gs.credits -= 500; gs.colony('ignis').happiness += 0.2; } },
    { label: 'Militär einsetzen',     effect: (gs) => { gs.colony('ignis').stability -= 0.1; } },
    { label: 'Verhandlungen führen',  effect: (gs) => { /* nothing */ } },
  ],
});
```

---

## 5. Stellaris (2016)

### Übernommene Konzepte

#### Anomalie-Events mit Conditions
Stellaris' **Anomaly System** (wissenschaftliche Schiffe entdecken zufällige
Anomalien mit gewichteter Zufallsauswahl) ist in `EventSystem._tryFireRandom()`
implementiert:

```javascript
// Gewichtete Zufallsziehung wie Stellaris
_tryFireRandom(gameState, cycle) {
  const candidates = [];
  for (const def of this._library.values()) {
    if (def.condition && !def.condition(gameState)) continue;
    for (let w = 0; w < def.weight; w++) candidates.push(def.id);
  }
  // Uniformes Zufalls-Pick = gewichtete Verteilung
  const id = candidates[Math.floor(Math.random() * candidates.length)];
  this.schedule(id);
}
```

#### Pop Growth (Logistic Curve)
Stellaris' Pop-Wachstums-Formel ist logistisch (wird langsamer nahe der
Kapazitätsgrenze):

```javascript
// Identisch zu Stellaris' Wachstums-Formel:
const growthRate = 0.02 * (1 - relPop) * (1 + foodSurplusBonus);
```

---

## 6. Homeworld (1999)

### Übernommene Konzepte

#### 3D Sphere Formation (`js/engine/game/FleetFormation.js`)
Homeworlds ikonische **Sphere Formation** ist exakt implementiert:

```javascript
// Fibonacci-Sphere-Sampling (mathematisch gleichmäßig)
case FormationShape.SPHERE: {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y2     = 1 - (slotIndex / maxSlots) * 2;
  const r      = Math.sqrt(1 - y2 * y2) * spacing;
  const theta  = golden * slotIndex;
  dx = Math.cos(theta) * r;
  dy = y2 * spacing;
  dz = Math.sin(theta) * r;
}
```

#### Cinematic Follow Camera
Homeworld's Kamerasystem (freies 3D-Orbit mit Maussteuerung) ist die Basis
für `FollowCamera` im ORBIT-Modus:

```javascript
cam.orbitPan(dAzimuth);    // Homeworld: Mittelmaus-Drag horizontal
cam.orbitTilt(dElevation); // Homeworld: Mittelmaus-Drag vertikal
cam.orbitZoom(factor);     // Homeworld: Mausrad
```

---

## 7. Elite Dangerous (2014)

### Übernommene Konzepte

#### Multi-Panel Cockpit Layout → ViewportManager
Elite's **Cockpit-Panels** (links: Navigation, mitte: HUD, rechts: Status)
sind das UX-Vorbild für `ViewportManager`:
- Gleiche Drag-to-Reposition-Logik
- Gleiche Close-Button-Position (oben rechts)
- Gleiche Transparenz + Blur-Hintergrund

#### Wing System
Elite's **Wing-System** (bis 4 Spieler fliegen gemeinsam) hat die Wing-Konzepte
in `FleetFormation` beeinflusst:
- Wing Leader + Subordinates
- Shared Waypoints (= Formation-Follow-Target)

---

## 8. EVE Online (2003)

### Übernommene Konzepte

#### Multi-Window Interface
EVE's berühmtes **Multi-Window Undocking-Interface** (jedes Fenster frei
positionierbar und skalierbar) ist die Design-Vorlage für die PiP-Viewports:

```css
/* EVE-Style: dunkler Hintergrund, Cyan-Akzentfarbe, monospace Font */
.gq-viewport { background: rgba(6, 12, 26, 0.88); }
.gq-viewport__label { color: rgba(150, 220, 255, 0.9); font-family: monospace; }
```

---

## Lizenz-Compliance

Alle übernommenen Konzepte sind **Design-Inspirationen**, kein Sourcecode-
Kopieren. Reverse-Engineering von Spielmechaniken ist urheberrechtlich
zulässig (Funktionsprinzipien sind nicht schützbar, nur konkrete Ausdrucksform).

| Konzept | Quelle | Rechtliche Einordnung |
|---|---|---|
| Pop-Allokation | Master of Orion | Game mechanic (nicht schützbar) |
| Affinity System | Endless Space 2 | Game mechanic (nicht schützbar) |
| Event mit Choices | Stellaris/Victoria 3 | Design pattern (nicht schützbar) |
| Formation Shapes | Homeworld/X4 | Mathematical concept (nicht schützbar) |
| Multi-Viewport UI | X4/EVE/Elite | UI pattern (nicht schützbar) |

**GalaxyQuest-Code-Lizenz: MIT**
